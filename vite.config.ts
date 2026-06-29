import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    // 显式绑定 IPv4 回环。不设 host 时 Node 会把 localhost 解析为 ::1（仅 IPv6），
    // 而 Tauri CLI 按 IPv4 探测 devUrl，会永远卡在 "Waiting for your frontend dev server"。
    host: '127.0.0.1',
    port: 1500,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 1500,
    },
  },
  clearScreen: false
});
