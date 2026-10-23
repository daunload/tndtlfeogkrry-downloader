import { join } from 'path';
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { DEFAULT_TRANSCRIBE_ENGINE, isTranscribeEngine } from '../../shared/config';
import type { TranscribeEngine } from '../../shared/types';

const ENGINE_FILE = join(app.getPath('userData'), 'transcribe-engine.json');

export function saveTranscribeEngine(engine: TranscribeEngine): void {
  writeFileSync(ENGINE_FILE, JSON.stringify({ engine }), 'utf-8');
}

export function loadTranscribeEngine(): TranscribeEngine {
  if (!existsSync(ENGINE_FILE)) return DEFAULT_TRANSCRIBE_ENGINE;

  try {
    const parsed = JSON.parse(readFileSync(ENGINE_FILE, 'utf-8')) as { engine?: string };
    return parsed.engine && isTranscribeEngine(parsed.engine)
      ? parsed.engine
      : DEFAULT_TRANSCRIBE_ENGINE;
  } catch {
    return DEFAULT_TRANSCRIBE_ENGINE;
  }
}
