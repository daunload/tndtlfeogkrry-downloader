import { join } from 'path';
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL, GEMINI_MAX_RETRIES } from '../../shared/config';

// OS 수준 암호화(safeStorage)로 API 키를 보호. 파일에는 바이너리 암호문만 저장됨.
const API_KEY_FILE = join(app.getPath('userData'), 'gemini-key.enc');

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

export async function transcribeOne(mp3Path: string, apiKey: string): Promise<string> {
  const audioData = readFileSync(mp3Path);
  const base64Audio = audioData.toString('base64');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'audio/mp3',
        data: base64Audio
      }
    },
    {
      text: '이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. 강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.'
    }
  ]);

  return result.response.text();
}

export async function summarizeText(text: string, apiKey: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

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
/** 429 Rate Limit 시 지수 백오프(2s→4s→8s)로 재시도. 그 외 에러는 즉시 throw. */
export async function transcribeWithRetry(
  mp3Path: string,
  apiKey: string,
  maxRetries: number = GEMINI_MAX_RETRIES
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await transcribeOne(mp3Path, apiKey);
    } catch (err) {
      const message = (err as Error).message || '';
      if (message.includes('429') && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('최대 재시도 횟수 초과');
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
