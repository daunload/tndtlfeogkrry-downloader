import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          'fluent-ffmpeg',
          '@ffmpeg-installer/ffmpeg',
          '@ffprobe-installer/ffprobe',
          'electron-updater'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // 사전 번들링하면 onnxruntime-web의 wasm 상대 경로(new URL(..., import.meta.url))가 깨져
    // 개발 서버에서 Whisper 모델 로드가 실패한다
    optimizeDeps: {
      exclude: ['@huggingface/transformers']
    },
    plugins: [vue(), tailwindcss()]
  }
});
