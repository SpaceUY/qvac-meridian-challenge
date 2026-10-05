import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BACKEND = 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Proxies to the backend so the browser sees a single origin (avoids CORS).
    proxy: {
      '/v1': { target: BACKEND, changeOrigin: true },
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
})
