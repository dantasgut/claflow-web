import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

/** Servidor Vite do app (o `vite.config.ts` da raiz, com o motor pelas fontes). */
export interface AppServer {
    readonly url: string;
    close(): Promise<void>;
}

/** Sobe o Vite do app programaticamente na porta pedida. */
export async function startServer(port: number): Promise<AppServer> {
    const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
    const server: ViteDevServer = await createServer({
        configFile,
        root: fileURLToPath(new URL('..', import.meta.url)),
        server: { port, strictPort: true },
    });
    await server.listen();
    return {
        url: `http://localhost:${port}/`,
        close: () => server.close(),
    };
}
