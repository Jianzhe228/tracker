import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import { invokeCommand } from './services/commands/invoke';
import './assets/base.css';

const isTauri = '__TAURI_INTERNALS__' in window;

function setupResizeRenderingGuard(): void {
  const root = document.documentElement;
  let clearTimer: number | null = null;

  const markResizing = (): void => {
    root.classList.add('window-resizing');
    if (clearTimer != null) {
      window.clearTimeout(clearTimer);
    }
    clearTimer = window.setTimeout(() => {
      root.classList.remove('window-resizing');
      clearTimer = null;
    }, 180);
  };

  window.addEventListener('resize', markResizing, { passive: true });
}

function disableContextMenu(): void {
  document.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  });
}

async function setupContextMenuPolicy(): Promise<void> {
  if (!isTauri) return;

  try {
    const isDebugBuild = await invokeCommand<boolean>('is_debug_build');
    if (!isDebugBuild) {
      disableContextMenu();
    }
  } catch (error) {
    console.warn('[context-menu] failed to detect build profile, fallback to release policy', error);
    disableContextMenu();
  }
}

void setupContextMenuPolicy();
setupResizeRenderingGuard();

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');
