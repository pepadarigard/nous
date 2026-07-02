import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Совместимость с Tauri: фиксированный порт, не чистить экран, игнорировать src-tauri.
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
