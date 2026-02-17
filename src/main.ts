import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import './assets/base.css';

// Disable browser context menu in Tauri (allow in editable elements)
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');
