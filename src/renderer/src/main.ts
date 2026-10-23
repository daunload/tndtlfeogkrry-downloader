import './assets/main.css';

import { createApp } from 'vue';
import App from './App.vue';
import { initWhisperBridge } from './whisper/bridge';

initWhisperBridge();

createApp(App).mount('#app');
