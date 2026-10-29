import { useEffect, useRef, useState } from 'react';
import { Application, createScene } from 'clayflow/web';
import { H, SHOTS, W } from './scenes/catalog';

const NAMES = Object.keys(SHOTS);

/**
 * O catálogo de cenas do clayflow-web (spec 038): `?scene=<nome>` abre a cena no canvas pelo `clayflow/web`, com o laço
 * do navegador e o movimento da cena por quadro (o mesmo da gravação); sem cena, a lista.
 */
export default function App() {
    const scene = new URLSearchParams(location.search).get('scene');
    if (scene === null || !(scene in SHOTS)) {
        return (
            <main style={{ padding: 24 }}>
                <h1>clayflow-web</h1>
                <p>As cenas do motor clayflow.</p>
                <ul>
                    {NAMES.map((n) => (
                        <li key={n}>
                            <a href={`?scene=${n}`}>{n}</a>
                        </li>
                    ))}
                </ul>
            </main>
        );
    }
    return <ScenePlayer name={scene} />;
}

/** A cena no canvas, quadro a quadro pelo laço do navegador; Espaço pausa. */
function ScenePlayer({ name }: { readonly name: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        const shot = SHOTS[name];
        if (canvas === null || shot === undefined) return;
        let app: Application | undefined;
        let disposed = false;
        let paused = false;
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || app === undefined) return;
            paused = !paused;
            if (paused) app.stop();
            else app.start();
        };
        void (async () => {
            try {
                canvas.width = W;
                canvas.height = H;
                const created = await Application.create({ canvas, scene: createScene(), autoResize: false });
                if (disposed) {
                    created.dispose();
                    return;
                }
                app = created;
                const update = shot.build(created);
                let frame = 0;
                update(frame);
                created.events.on('frameTick', () => {
                    update(++frame % shot.frames);
                });
                window.addEventListener('keydown', onKey);
                created.start();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            disposed = true;
            window.removeEventListener('keydown', onKey);
            app?.dispose();
        };
    }, [name]);
    return (
        <div>
            <canvas ref={canvasRef} style={{ width: '100vw', height: 'auto', display: 'block' }} />
            {error !== null && <pre style={{ color: '#f66' }}>{error}</pre>}
        </div>
    );
}
