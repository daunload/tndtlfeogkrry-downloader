import { join } from 'path';
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { DownloadRecord } from '../../shared/types';

const HISTORY_FILE = join(app.getPath('userData'), 'download-history.json');

export function loadHistory(): DownloadRecord[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw) as DownloadRecord[];
  } catch {
    return [];
  }
}

function saveHistory(records: DownloadRecord[]): void {
  writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

/** contentId 기준 upsert: 동일 contentId가 있으면 교체, 없으면 추가 */
export function addRecord(record: DownloadRecord): void {
  const records = loadHistory();
  const idx = records.findIndex((r) => r.contentId === record.contentId);
  if (idx >= 0) {
    // 기존 레코드의 텍스트 변환 정보는 유지
    record.txtPath = record.txtPath ?? records[idx].txtPath;
    record.summaryPath = record.summaryPath ?? records[idx].summaryPath;
    records[idx] = record;
  } else {
    records.push(record);
  }
  saveHistory(records);
}

/** 텍스트 변환 결과 경로 업데이트 */
export function updateTranscription(
  contentId: string,
  txtPath: string,
  summaryPath?: string
): void {
  const records = loadHistory();
  const record = records.find((r) => r.contentId === contentId);
  if (!record) return;
  record.txtPath = txtPath;
  if (summaryPath) record.summaryPath = summaryPath;
  saveHistory(records);
}

/** 히스토리에서 레코드 제거 */
export function removeRecord(contentId: string): void {
  const records = loadHistory().filter((r) => r.contentId !== contentId);
  saveHistory(records);
}
