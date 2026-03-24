import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Resolve webgpu-engine direto nos fontes TypeScript do engine.
// Isso elimina a necessidade de rebuild da lib — mudanças no engine
// aparecem instantaneamente no app via HMR, sem restart do servidor.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'webgpu-engine': path.resolve(__dirname, '../engine/src/index.ts'),
    },
  },
})
