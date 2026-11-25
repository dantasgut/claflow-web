import { useEffect, useRef, useState } from 'react';
import { Application, createScene } from 'clayflow/web';
import { H, SHOTS, W } from './scenes/catalog';
import { FpsCounter, ScenePanel } from './ScenePanel';
import type { MaterialName } from 'clayflow/web';
import { MaterialGallery } from './MaterialGallery';
import { MATERIAL_FAMILIES } from './scenes/materiais';
import { ShowcasePanel } from './ShowcasePanel';
import { TimeControls } from './TimeControls';
import { TimeNavigator } from './TimeNavigator';

const NAMES = Object.keys(SHOTS);

/** O material pedido na URL (`?material=<nome>`; nome desconhecido: o primeiro), ou `undefined` sem o parâmetro. */
function galleryMaterial(): MaterialName | undefined {
    const name = new URLSearchParams(location.search).get('material');
    if (name === null) return undefined;
    const all = MATERIAL_FAMILIES.flatMap(([, names]) => names);
    return all.find((n) => n === name) ?? all[0];
}

/**
 * O catálogo de cenas do clayflow-web (spec 038): `?scene=<nome>` abre a cena no canvas pelo `clayflow/web`, com o laço
 * do navegador e o movimento da cena por quadro (o mesmo da gravação); sem cena, a lista.
 */
export default function App() {
    const material = galleryMaterial();
    if (material !== undefined) return <MaterialGallery name={material} />;
    const scene = new URLSearchParams(location.search).get('scene');
    if (scene === null || !(scene in SHOTS)) {
        return (
            <main style={{ padding: 24 }}>
                <h1>clayflow-web</h1>
                <p>As cenas do motor clayflow.</p>
                <p style={{ margin: '12px 0' }}>
                    <a href="?material=gold">Galeria de materiais</a> — um material por vez, com os nós e os
                    parâmetros.
                </p>
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

/**
 * A cena no canvas, quadro a quadro pelo laço do navegador, com a navegação no tempo (`TimeNavigator`: pausa, quadro a
 * quadro, velocidade, câmera seguindo o tempo ou livre). A taxa de quadros, o painel e a barra do tempo por cima.
 */
function ScenePlayer({ name }: { readonly name: string }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState<Application | null>(null);
    // O canvas do motor em uso: o painel da vitrine acha a peça clicada nele.
    const [surface, setSurface] = useState<HTMLCanvasElement | null>(null);
    const [nav, setNav] = useState<TimeNavigator | null>(null);
    useEffect(() => {
        const host = hostRef.current;
        const shot = SHOTS[name];
        if (host === null || shot === undefined) return;
        // Um canvas por motor: o motor descartado (o React monta o efeito duas vezes em desenvolvimento, e a criação é
        // assíncrona) desconfigura o contexto do canvas dele, nunca o do motor que ficou.
        const canvas = document.createElement('canvas');
        canvas.style.width = '100vw';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        host.appendChild(canvas);
        let app: Application | undefined;
        let disposed = false;
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
                const navigator = new TimeNavigator(created, shot.build(created), shot.frames);
                created.start();
                setRunning(created);
                setSurface(canvas);
                setNav(navigator);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            disposed = true;
            setRunning(null);
            setSurface(null);
            setNav(null);
            app?.dispose();
            canvas.remove();
        };
    }, [name]);
    return (
        <div>
            <div ref={hostRef} />
            {running !== null && <FpsCounter app={running} />}
            {running !== null && <ScenePanel app={running} />}
            {running !== null && surface !== null && name.startsWith('vitrine-') && (
                <ShowcasePanel app={running} canvas={surface} family={name.slice('vitrine-'.length)} />
            )}
            {nav !== null && <TimeControls nav={nav} />}
            {error !== null && <pre style={{ color: '#f66' }}>{error}</pre>}
        </div>
    );
}
