import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ---------------------------------------------------------------------------
// EL SWITCH DEL MOTOR
//
// Los cuatro pisos del sistema hablan el mismo formato (OpenAI), asi que el
// front no necesita enterarse de a cual le esta pegando. Cambiar DESTINO es
// todo lo que hace falta para pasar de uno al otro: React no se toca.
// ---------------------------------------------------------------------------
const MOTOR = {
  /** LM Studio. Streamea de verdad, no tiene corpus ni citas. Para desarrollar. */
  lmStudio: 'http://127.0.0.1:1234',
  /** El backend Express del repo -> meridianGraph -> qvac serve. El producto real. */
  backend: 'http://127.0.0.1:3001',
}

const DESTINO = MOTOR.lmStudio

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // '@/components/x' en vez de '../../components/x'
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Reenvia /v1/* al motor para que el navegador vea un solo origen (evita CORS).
    proxy: {
      '/v1': { target: DESTINO, changeOrigin: true },
    },
  },
})
