/* Node CommonJS harness: executes TypeScript modules with mocked Electron/Worker APIs. */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

function load(file, imports = {}, globals = {}) {
  const source = readFileSync(file, 'utf8').replaceAll(
    'import.meta.url',
    "'file:///app/bridge.js'"
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(
    code,
    {
      exports,
      require: (id) => (id in imports ? imports[id] : require(id)),
      console: { warn() {}, error() {} },
      URL,
      Float32Array,
      Int16Array,
      setTimeout,
      clearTimeout,
      ...globals
    },
    { filename: file }
  );
  return exports;
}

function bridgeHarness(throws = false) {
  let receive;
  const results = [],
    workers = [];
  class Worker {
    constructor() {
      if (throws) throw new Error('startup failed');
      workers.push(this);
    }
    postMessage(request) {
      this.request = request;
    }
    terminate() {
      this.terminated = true;
    }
  }
  load(
    'src/renderer/src/whisper/bridge.ts',
    {},
    {
      Worker,
      window: {
        api: {
          onWhisperJob: (fn) => {
            receive = fn;
          },
          sendWhisperJobResult: (result) => results.push(result)
        }
      }
    }
  ).initWhisperBridge();
  const start = (jobId) => {
    receive({ type: 'start', jobId, totalSamples: 2 });
    receive({ type: 'chunk', jobId, offset: 0, samples: new Int16Array([-32768, 16384]) });
    receive({ type: 'run', jobId });
  };
  return { start, receive, results, workers };
}

test('Worker crash reports failure and next job creates a new worker', () => {
  const h = bridgeHarness();
  h.start('first');
  assert.deepEqual(Array.from(h.workers[0].request.audio), [-1, 0.5]);
  h.workers[0].onerror({ message: 'crashed', preventDefault() {} });
  assert.equal(h.results[0].fatal, true);
  assert.equal(h.results[0].jobId, 'first');
  assert.equal(h.workers[0].terminated, true);
  h.start('second');
  assert.equal(h.workers.length, 2);
  h.workers[1].onmessage({ data: { type: 'done', jobId: 'second', text: '완료' } });
  assert.equal(h.results[1].text, '완료');
});

test('Worker construction failure is returned immediately', () => {
  const h = bridgeHarness(true);
  h.start('first');
  assert.match(h.results[0].message, /startup failed/);
});

test('cancel terminates Worker and ignores its late result', () => {
  const h = bridgeHarness();
  h.start('first');
  const late = h.workers[0].onmessage;
  h.receive({ type: 'cancel', jobId: 'first' });
  late({ data: { type: 'done', jobId: 'first', text: 'stale' } });
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.results.length, 0);
  h.start('next');
  assert.equal(h.workers.length, 2);
});

async function workerHarness(failureStage, cpuFails = false) {
  const results = [],
    devices = [];
  let disposed = false;
  const self = { postMessage: (result) => results.push(result) };
  load(
    'src/renderer/src/whisper/whisper.worker.ts',
    {
      '@huggingface/transformers': {
        env: { backends: { onnx: { wasm: {} } } },
        pipeline: async (_task, _model, { device }) => {
          devices.push(device);
          if ((failureStage === 'load' && device === 'webgpu') || (cpuFails && device === 'wasm'))
            throw new Error('load failed');
          const pipeline = async () => {
            if (device === 'webgpu') throw new Error('GPU lost');
            return { text: '한국어 전사' };
          };
          pipeline.dispose = async () => {
            disposed = true;
          };
          return pipeline;
        }
      },
      '../../../shared/config': { WHISPER_SAMPLE_RATE: 16000, WHISPER_MODEL_ID: 'test' }
    },
    {
      self,
      navigator: { gpu: { requestAdapter: async () => ({ features: { has: () => true } }) } }
    }
  );
  self.onmessage({ data: { jobId: 'first', audio: new Float32Array(1600) } });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return { results, devices, disposed };
}

for (const stage of ['load', 'inference']) {
  test(`GPU ${stage} failure retries on CPU and preserves output`, async () => {
    const h = await workerHarness(stage);
    assert.deepEqual(h.devices, ['webgpu', 'wasm']);
    assert.equal(h.results.at(-1).text, '한국어 전사');
    if (stage === 'inference') assert.equal(h.disposed, true);
  });
}

test('CPU failure after GPU failure returns a fatal error without retry loop', async () => {
  const h = await workerHarness('load', true);
  assert.deepEqual(h.devices, ['webgpu', 'wasm']);
  assert.equal(h.results.at(-1).type, 'error');
  assert.equal(h.results.at(-1).fatal, true);
});

test('idle timeout cancels job, clears listeners and releases queue', async () => {
  const ipcMain = new EventEmitter();
  const sender = new EventEmitter();
  const sent = [],
    timers = new Map();
  let timerId = 0;
  sender.isDestroyed = () => false;
  sender.send = (_channel, message) => sent.push(message);
  const service = load(
    'src/main/services/whisper.ts',
    {
      electron: { ipcMain },
      '../../shared/channels': { IPC_EVENT: { WHISPER_JOB: 'job', WHISPER_JOB_RESULT: 'result' } },
      '../../shared/config': { WHISPER_IDLE_TIMEOUT_MS: 100, WHISPER_IPC_CHUNK_SAMPLES: 2 },
      './media': { decodeToPcm16k: async () => new Int16Array([1, 2]) }
    },
    {
      setTimeout: (fn) => {
        timers.set(++timerId, fn);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id)
    }
  );
  const first = service.transcribeWithWhisper(sender, 'audio', () => {});
  const rejected = assert.rejects(first, /15분/);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const firstId = sent[0].jobId;
  const oldTimer = timerId;
  ipcMain.emit('result', { sender }, { type: 'progress', jobId: firstId, percent: 1 });
  assert.equal(timers.has(oldTimer), false);
  timers.get(timerId)();
  await rejected;
  assert.equal(sent.at(-1).type, 'cancel');
  assert.equal(sender.listenerCount('destroyed'), 0);
  const second = service.transcribeWithWhisper(sender, 'audio', () => {});
  for (let i = 0; i < 6; i++) await Promise.resolve();
  ipcMain.emit('result', { sender }, { type: 'done', jobId: sent.at(-1).jobId, text: 'next' });
  assert.equal(await second, 'next');
  assert.equal(timers.size, 0);
});

test('Whisper saves transcript and batch continues when Gemini summary fails', async () => {
  const handlers = new Map(),
    writes = [];
  let verified = false;
  const sender = { send() {} };
  load('src/main/ipc/transcribe.ts', {
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    fs: { existsSync: () => true, writeFileSync: (...args) => writes.push(args) },
    '../../shared/channels': {
      IPC: {
        TRANSCRIBE_AUDIO: 'single',
        TRANSCRIBE_BATCH: 'batch',
        DOWNLOAD_AND_TRANSCRIBE_ALL: 'all'
      },
      IPC_EVENT: { TRANSCRIBE_PROGRESS: 'progress' }
    },
    '../../shared/config': { MAX_CONCURRENT_TRANSCRIPTIONS: 2 },
    '../services/gemini': {
      GeminiFatalError: class extends Error {},
      loadGeminiApiKey: () => 'invalid-key',
      loadGeminiModel: () => 'test-model',
      verifyGemini: async () => {
        verified = true;
        return { ok: false, error: 'invalid key' };
      },
      summarizeWithRetry: async () => {
        throw new Error('invalid key');
      },
      groupMp3Files: () =>
        new Map([
          ['one', ['one.mp3']],
          ['two', ['two.mp3']]
        ])
    },
    '../services/whisper': {
      WhisperFatalError: class extends Error {},
      transcribeWithWhisper: async () => '전사 결과'
    },
    '../services/transcribeEngine': { loadTranscribeEngine: () => 'whisper' },
    '../services/download': {},
    '../services/media': {},
    '../services/history': {}
  }).registerTranscribeHandlers();
  const single = await handlers.get('single')({ sender }, '/virtual/lecture.mp4', true);
  assert.equal(single.success, true);
  assert.equal(single.text, '전사 결과');
  assert.equal(single.summaryError, 'invalid key');
  assert.equal(single.txtPath, '/virtual/lecture.txt');
  const batch = await handlers.get('batch')({ sender }, '/virtual', true);
  assert.equal(verified, false);
  assert.equal(batch.successCount, 2);
  assert.equal(batch.results[1].summaryError, 'invalid key');
  assert.equal(writes.length, 3);
});
