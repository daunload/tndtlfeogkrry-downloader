import { basename, dirname, extname, join } from 'path';
import { statSync } from 'fs';
import { unlink } from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { SPLIT_THRESHOLD_BYTES, WHISPER_SAMPLE_RATE } from '../../shared/config';
import { IPC_EVENT } from '../../shared/channels';

// asar 패키징 시 경로 보정
const ffmpegPath = ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked');
const ffprobePath = ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/** MP4에서 오디오만 추출하여 MP3로 변환. libmp3lame 코덱, 품질 2 (~190kbps VBR). */
export function convertToMp3(mp4Path: string, mp3Path: string): Promise<void> {
  return new Promise((res, rej) => {
    ffmpeg(mp4Path)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioQuality(2)
      .output(mp3Path)
      .on('end', () => res())
      .on('error', (err) => rej(err))
      .run();
  });
}

/** 오디오/비디오 파일을 Whisper 입력용 16kHz 모노 16bit PCM(s16le)으로 디코딩한다. */
export function decodeToPcm16k(filePath: string): Promise<Int16Array> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    const stream = ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(WHISPER_SAMPLE_RATE)
      .format('s16le')
      .on('error', (err) => rej(err))
      .pipe();

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      // Buffer는 풀링된(정렬되지 않은) 메모리일 수 있어 새 ArrayBuffer로 복사 (x64/arm64 모두 리틀엔디언)
      const byteLength = buf.length - (buf.length % 2);
      res(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + byteLength)));
    });
    stream.on('error', (err) => rej(err));
  });
}

export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Gemini API 업로드 제한(20MB)을 맞추기 위해 대용량 MP3를 시간 기반으로 분할한다.
 * 분할 파일명: "{원본}_part{N}.mp3" (groupMp3Files()가 이 패턴으로 재그룹핑)
 * 분할 완료 후 원본 MP3는 삭제된다.
 * @returns 분할된 파일 경로 배열. 임계값 이하면 원본 경로 1개만 반환.
 */
export async function splitMp3(
  mp3Path: string,
  contentId: string,
  sender: Electron.WebContents
): Promise<string[]> {
  const fileSize = statSync(mp3Path).size;
  if (fileSize <= SPLIT_THRESHOLD_BYTES) return [mp3Path];

  const duration = await getAudioDuration(mp3Path);
  // 각 파트가 ~19MB가 되도록 분할 수 계산
  const partCount = Math.ceil(fileSize / (19 * 1024 * 1024));
  const partDuration = duration / partCount;

  const dir = dirname(mp3Path);
  const name = basename(mp3Path, extname(mp3Path));
  const parts: string[] = [];

  for (let i = 0; i < partCount; i++) {
    const partPath = join(dir, `${name}_part${i + 1}.mp3`);
    const startTime = i * partDuration;

    sender.send(IPC_EVENT.DOWNLOAD_PROGRESS, {
      contentId,
      downloaded: i,
      total: partCount,
      percent: 96 + Math.round((i / partCount) * 4),
      status: 'splitting',
      splitCurrent: i + 1,
      splitTotal: partCount
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg(mp3Path)
        .setStartTime(startTime)
        .setDuration(partDuration)
        .audioCodec('copy') // 재인코딩 없이 무손실 분할
        .output(partPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    parts.push(partPath);
  }

  await unlink(mp3Path);

  sender.send(IPC_EVENT.DOWNLOAD_PROGRESS, {
    contentId,
    downloaded: partCount,
    total: partCount,
    percent: 100,
    status: 'split-done',
    splitTotal: partCount
  });

  return parts;
}
