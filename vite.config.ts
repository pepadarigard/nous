import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

// Совместимость с Tauri: фиксированный порт, не чистить экран, игнорировать src-tauri.
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Версия приложения одна и та же в package.json, в установщике и на экране.
  // Раньше в коде лежала своя копия строкой, и она отстала на две версии.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
