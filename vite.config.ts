import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// O motor pelas fontes (spec 038): `clayflow` (o núcleo) e `clayflow/web` (o ponto de entrada do navegador) apontam
// para o código-fonte do clayflow vizinho — mudanças no motor aparecem no app pelo HMR, sem rebuild da lib; os shaders
// `?raw` do motor o Vite resolve como no próprio motor.
// `CLAYFLOW_ENGINE` aponta para outra cópia do motor (ex.: um worktree num commit anterior), sem mudar o app.
const engine = path.resolve(__dirname, process.env.CLAYFLOW_ENGINE ?? '../clayflow', 'src');

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: /^clayflow\/web$/, replacement: path.join(engine, 'platform/web/index.ts') },
            { find: /^clayflow$/, replacement: path.join(engine, 'index.ts') },
        ],
    },
    server: {
        fs: { allow: [path.resolve(__dirname, '..')] },
        // Isolamento cross-origin: `performance.now()` com resolução de µs (como no harness do motor).
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
                recorder: path.resolve(__dirname, 'recorder.html'),
            },
        },
    },
});
