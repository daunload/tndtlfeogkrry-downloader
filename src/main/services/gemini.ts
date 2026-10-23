import { basename, join } from 'path';
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { DEFAULT_GEMINI_MODEL, GEMINI_MAX_RETRIES, isGeminiModel } from '../../shared/config';
import type { GeminiModelId } from '../../shared/types';

// OS 수준 암호화(safeStorage)로 API 키를 보호. 파일에는 바이너리 암호문만 저장됨.
const API_KEY_FILE = join(app.getPath('userData'), 'gemini-key.enc');
const MODEL_FILE = join(app.getPath('userData'), 'gemini-model.json');

export function saveGeminiApiKey(key: string): void {
  const encrypted = safeStorage.encryptString(key);
  writeFileSync(API_KEY_FILE, encrypted);
}

export function loadGeminiApiKey(): string | null {
  if (!existsSync(API_KEY_FILE)) return null;
  try {
    const encrypted = readFileSync(API_KEY_FILE);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

export function deleteGeminiApiKey(): void {
  // 파일 삭제 대신 빈 문자열로 덮어쓰기 → loadGeminiApiKey()가 복호화 실패로 null 반환
  if (existsSync(API_KEY_FILE)) {
    writeFileSync(API_KEY_FILE, '');
  }
}

export function saveGeminiModel(model: GeminiModelId): void {
  writeFileSync(MODEL_FILE, JSON.stringify({ model }), 'utf-8');
}

export function loadGeminiModel(): GeminiModelId {
  if (!existsSync(MODEL_FILE)) return DEFAULT_GEMINI_MODEL;

  try {
    const raw = readFileSync(MODEL_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { model?: string };
    return parsed.model && isGeminiModel(parsed.model) ? parsed.model : DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VERIFY_TIMEOUT_MS = 10_000;

/** 재시도/다음 파일 진행이 의미 없는 오류 (키·권한·모델·할당량 문제) */
export class GeminiFatalError extends Error {}

/**
 * Gemini API 오류를 사용자용 한국어 메시지로 변환한다.
 * 키/권한/모델/할당량 문제는 GeminiFatalError로 반환해 배치 작업이 즉시 중단되도록 한다.
 */
export function toGeminiError(err: unknown, model?: GeminiModelId): Error {
  if (err instanceof GeminiFatalError) return err;

  const message = (err as Error)?.message || String(err);
  const status = (err as { status?: number })?.status;
  const has = (code: number): boolean => status === code || message.includes(`[${code} `);

  // 잘못된 키는 401이 아니라 400 + API_KEY_INVALID로 응답된다
  if (message.includes('API_KEY_INVALID') || message.includes('API key not valid') || has(401)) {
    return new GeminiFatalError(
      'Gemini API 키가 유효하지 않습니다. 설정에서 키를 다시 입력해주세요.'
    );
  }
  if (message.includes('API_KEY_EXPIRED') || message.includes('API key expired')) {
    return new GeminiFatalError('Gemini API 키가 만료되었습니다. 설정에서 새 키를 입력해주세요.');
  }
  if (has(403) || message.includes('PERMISSION_DENIED')) {
    return new GeminiFatalError(
      'Gemini API 키에 권한이 없습니다. Google AI Studio에서 키 상태와 API 사용 설정을 확인해주세요.'
    );
  }
  // File API 404(파일 없음)와 구분하기 위해 models/ 경로가 포함된 경우만 모델 오류로 본다
  if (
    (has(404) && message.includes('models/')) ||
    /is not supported for generateContent/i.test(message)
  ) {
    return new GeminiFatalError(
      `선택한 Gemini 모델${model ? `(${model})` : ''}을 사용할 수 없습니다. 설정에서 다른 모델을 선택해주세요.`
    );
  }
  // 2026-09부터 선불(Prepay) 크레딧 소진 시 429 대신 402를 반환한다. 크레딧을 충전하기 전에는 재시도해도 실패.
  if (has(402) || message.includes('Payment Required')) {
    return new GeminiFatalError(
      'Gemini API 선불 크레딧이 소진되었습니다. Google AI Studio의 결제(Billing) 페이지에서 크레딧을 충전하거나 자동 충전을 설정해주세요.'
    );
  }
  if (isQuotaExhausted(message)) {
    return new GeminiFatalError(
      'Gemini API 무료 할당량이 소진되었습니다. Google AI Studio에서 요금제를 확인하거나, 할당량이 초기화될 때까지 기다려주세요.'
    );
  }
  if (has(429)) {
    return new Error('Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * API 키(및 모델)가 실제로 사용 가능한지 가벼운 조회 요청으로 확인한다.
 * model을 넘기면 해당 모델 존재 여부까지 확인한다.
 */
export async function verifyGemini(
  apiKey: string,
  model?: GeminiModelId
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = model ? `${GEMINI_API_BASE}/models/${model}` : `${GEMINI_API_BASE}/models?pageSize=1`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    });
  } catch {
    return {
      ok: false,
      error:
        'Gemini 서버에 연결할 수 없어 API 키를 확인하지 못했습니다. 네트워크 상태를 확인해주세요.'
    };
  }

  if (res.ok) return { ok: true };

  const body = await res.text().catch(() => '');
  const err = Object.assign(new Error(`[${res.status} ${res.statusText}] ${body}`), {
    status: res.status
  });
  return { ok: false, error: toGeminiError(err, model).message };
}

/** File API로 파일을 업로드하고 ACTIVE 상태가 될 때까지 대기한다. */
async function uploadAndWaitForActive(
  mp3Path: string,
  apiKey: string
): Promise<{ fileUri: string; mimeType: string; fileName: string }> {
  const fileManager = new GoogleAIFileManager(apiKey);

  const uploadResult = await fileManager.uploadFile(mp3Path, {
    mimeType: 'audio/mp3',
    displayName: basename(mp3Path)
  });

  let file = uploadResult.file;
  while (file.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(file.name);
  }

  if (file.state === FileState.FAILED) {
    throw new Error('Gemini File API: 파일 처리에 실패했습니다.');
  }

  return { fileUri: file.uri, mimeType: file.mimeType, fileName: file.name };
}

/** 업로드된 File API 파일을 삭제한다. 실패해도 무시 (48시간 후 자동 삭제됨). */
async function deleteUploadedFile(fileName: string, apiKey: string): Promise<void> {
  try {
    const fileManager = new GoogleAIFileManager(apiKey);
    await fileManager.deleteFile(fileName);
  } catch {
    // 삭제 실패는 무시 — 48시간 후 자동 만료됨
  }
}

export async function transcribeOne(
  mp3Path: string,
  apiKey: string,
  modelName: GeminiModelId,
  useFileApi: boolean = false
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  let audioPart:
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } };
  let uploadedFileName: string | null = null;

  if (useFileApi) {
    const { fileUri, mimeType, fileName } = await uploadAndWaitForActive(mp3Path, apiKey);
    audioPart = { fileData: { fileUri, mimeType } };
    uploadedFileName = fileName;
  } else {
    const base64Audio = readFileSync(mp3Path).toString('base64');
    audioPart = { inlineData: { mimeType: 'audio/mp3', data: base64Audio } };
  }

  try {
    const result = await model.generateContent([
      audioPart,
      {
        text: '이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.'
      }
    ]);

    return result.response.text();
  } finally {
    if (uploadedFileName) {
      await deleteUploadedFile(uploadedFileName, apiKey);
    }
  }
}

async function summarizeText(
  text: string,
  apiKey: string,
  modelName: GeminiModelId
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `아래 강의 원문을 시험 대비용으로 요약하세요.
요구사항:
1) 핵심 개념 정의 3~5개
2) 개념 간 관계를 3줄 이내 설명
3) 기억해야 할 포인트 5개 bullet
4) 마지막에 한 줄 결론

모든 내용은 원문 근거 기반으로 작성하고, 없는 내용은 추가하지 마세요.
`;

  const result = await model.generateContent([
    {
      text: text
    },
    { text: prompt }
  ]);

  return result.response.text();
}

async function summarizePdfFile(
  pdfPath: string,
  apiKey: string,
  modelName: GeminiModelId
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const fileManager = new GoogleAIFileManager(apiKey);

  const uploadResult = await fileManager.uploadFile(pdfPath, {
    mimeType: 'application/pdf',
    displayName: basename(pdfPath)
  });

  let file = uploadResult.file;
  while (file.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(file.name);
  }

  if (file.state === FileState.FAILED) {
    throw new Error('Gemini File API: PDF 파일 처리에 실패했습니다.');
  }

  try {
    const result = await model.generateContent([
      {
        fileData: {
          fileUri: file.uri,
          mimeType: file.mimeType
        }
      },
      {
        text: `이 PDF 강의자료를 한국어로 요약하세요.
요구사항:
1) 핵심 개념 3~5개
2) 중요 포인트 5개 bullet
3) 마지막에 한 줄 결론

원문에 없는 내용은 추측하지 마세요.`
      }
    ]);
    return result.response.text();
  } finally {
    await deleteUploadedFile(file.name, apiKey);
  }
}
/**
 * 에러 메시지에서 retryDelay 값을 추출한다.
 * Gemini API가 "Please retry in XX.XXs" 형태로 권장 대기 시간을 알려준다.
 */
function parseRetryDelay(message: string): number | null {
  const match = message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
}

/**
 * 할당량 완전 소진(quota exceeded) 여부를 판별한다.
 * 일시적 rate limit과 달리 재시도해도 해결되지 않는다.
 */
function isQuotaExhausted(message: string): boolean {
  return (
    message.includes('exceeded your current quota') ||
    (message.includes('Quota exceeded') && message.includes('limit: 0'))
  );
}

/**
 * 429 Rate Limit 시 지수 백오프로 재시도. 키/모델/할당량 문제는 즉시 실패.
 * 던지는 오류는 항상 toGeminiError()로 변환된 사용자용 메시지다.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  model: GeminiModelId,
  maxRetries: number = GEMINI_MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = (err as Error).message || '';
      const mapped = toGeminiError(err, model);

      if (
        !(mapped instanceof GeminiFatalError) &&
        message.includes('429') &&
        attempt < maxRetries - 1
      ) {
        const serverDelay = parseRetryDelay(message);
        const backoffDelay = Math.pow(2, attempt) * 2000;
        const delay = serverDelay ?? backoffDelay;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw mapped;
    }
  }
  throw new Error('최대 재시도 횟수 초과');
}

export function transcribeWithRetry(
  mp3Path: string,
  apiKey: string,
  model: GeminiModelId,
  useFileApi: boolean = false,
  maxRetries: number = GEMINI_MAX_RETRIES
): Promise<string> {
  return withRetry(() => transcribeOne(mp3Path, apiKey, model, useFileApi), model, maxRetries);
}

export function summarizeWithRetry(
  text: string,
  apiKey: string,
  model: GeminiModelId,
  maxRetries: number = GEMINI_MAX_RETRIES
): Promise<string> {
  return withRetry(() => summarizeText(text, apiKey, model), model, maxRetries);
}

export function summarizePdfWithRetry(
  pdfPath: string,
  apiKey: string,
  model: GeminiModelId,
  maxRetries: number = GEMINI_MAX_RETRIES
): Promise<string> {
  return withRetry(() => summarizePdfFile(pdfPath, apiKey, model), model, maxRetries);
}

/**
 * 분할 MP3 파일을 원본 기준으로 그룹핑한다.
 * 예: "강의1_part1.mp3", "강의1_part2.mp3" → { "강의1": [".../강의1_part1.mp3", ".../강의1_part2.mp3"] }
 * 분할되지 않은 "강의2.mp3" → { "강의2": [".../강의2.mp3"] }
 */
export function groupMp3Files(dirPath: string): Map<string, string[]> {
  const files = readdirSync(dirPath)
    .filter((f) => f.endsWith('.mp3'))
    .sort();
  const groups = new Map<string, string[]>();

  for (const file of files) {
    // splitMp3()가 생성하는 "_partN.mp3" 패턴에서 원본 이름 추출 (macOS NFD 정규화 대응)
    const normalizedFile = file.normalize('NFC');
    const partMatch = normalizedFile.match(/^(.+)_part\d+\.mp3$/);
    const baseName = partMatch ? partMatch[1] : normalizedFile.replace(/\.mp3$/, '');

    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName)!.push(join(dirPath, file));
  }

  return groups;
}
