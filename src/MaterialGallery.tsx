import { useEffect, useRef, useState } from 'react';
import { Application, createScene, nodes, OrbitController } from 'clayflow/web';
import type { MaterialName, NodeDefinition } from 'clayflow/web';
import { H, W } from './scenes/size';
import { MATERIAL_FAMILIES, materialStage, type MaterialStage } from './scenes/materiais';
import { FpsCounter } from './ScenePanel';
import { heading, panel, type GraphEdit, type Param, type Value } from './MaterialNodes';
import { MaterialWorkbench, type ActiveMaterial } from './MaterialWorkbench';
import { HideButton, PanelTab, usePanel } from './panels';
import type { Vec3 } from './project';

const LIST_W = 190;

// A galeria individual dos materiais (spec 011): `?material=<nome>` abre um material numa esfera, com os parâmetros que
// ele expõe (editáveis ao vivo, sem recompilar: os valores da função) e o grafo de nós de que é feito.

/**
 * A galeria: a lista dos materiais (à esquerda), o palco e a bancada do material (o inspetor à direita e o painel de nós
 * embaixo, os mesmos das vitrines).
 */
export function MaterialGallery({ name }: { readonly name: MaterialName }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState<Application | null>(null);
    // O palco é do motor (as funções do material e do deslocamento, cujos valores mudam no lugar): fora do estado.
    const stageRef = useRef<MaterialStage | null>(null);
    const definition = nodes.material[name] as NodeDefinition;
    const params = definition.params as Readonly<Record<string, Param>>;
    const [values, setValues] = useState<Record<string, Value>>({});
    // O canvas do motor em uso e o centro da peça: a miniatura do inspetor recorta a peça dele.
    const [surface, setSurface] = useState<{ canvas: HTMLCanvasElement; at: Vec3 } | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (host === null) return;
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.objectFit = 'contain';
        canvas.style.display = 'block';
        host.appendChild(canvas);
        let app: Application | undefined;
        let disposed = false;
        void (async () => {
            try {
                canvas.width = W;
                canvas.height = H;
                const created = await Application.create({
                    canvas,
                    scene: createScene(),
                    autoResize: false,
                });
                if (disposed) {
                    created.dispose();
                    return;
                }
                app = created;
                const made = materialStage(created, name);
                // A câmera em órbita: arrastar gira, a roda aproxima.
                created.world.attach(
                    made.camera,
                    new OrbitController({
                        target: [...made.target],
                        eye: [...made.eye],
                        damping: 0.85,
                    }),
                );
                created.start();
                setRunning(created);
                setSurface({ canvas, at: made.target });
                stageRef.current = made;
                setValues({ ...made.staged } as Record<string, Value>);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            disposed = true;
            setRunning(null);
            setSurface(null);
            stageRef.current = null;
            app?.dispose();
            canvas.remove();
        };
    }, [name]);

    const current = (key: string): Value => values[key] ?? params[key]?.default ?? 0;
    const change = (key: string, value: Value): void => {
        setValues((v) => ({ ...v, [key]: value }));
        const stage = stageRef.current;
        if (stage === null) return;
        stage.material.values[key] = value;
        // O relevo é um só para a cor e a geometria: o mesmo valor no deslocamento, quando ele tem o parâmetro.
        if (stage.displacement !== undefined && key in stage.displacement.params) {
            stage.displacement.values[key] = value;
        }
    };
    const reset = (): void => {
        const staged = stageRef.current?.staged ?? {};
        for (const key of Object.keys(values)) {
            const back = staged[key] ?? params[key]?.default;
            if (back !== undefined) change(key, back as Value);
        }
        setValues({ ...staged } as Record<string, Value>);
    };

    // Os mesmos valores nos controles expostos e nos nós do grafo (o parâmetro exposto se edita nos dois lugares).
    const edit: GraphEdit = { params, value: current, change };

    const [list, setList] = usePanel('materiais');
    const active: ActiveMaterial | undefined =
        surface === null
            ? undefined
            : // A peça do palco: a esfera de raio 1 no alvo da câmera.
              { name, edit, reset, at: surface.at, radius: 1 };
    return (
        <div>
            {list ? (
                <nav style={{ ...panel, position: 'fixed', left: 0, top: 0, bottom: 'var(--dock, 0px)', width: LIST_W, boxSizing: 'border-box', zIndex: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <a href="?" style={{ color: '#8ec7ff' }}>
                            ← cenas
                        </a>
                        <HideButton onClick={() => setList(false)} />
                    </div>
                    {MATERIAL_FAMILIES.map(([family, names]) => (
                        <div key={family}>
                            <div style={heading}>{family}</div>
                            {names.map((n) => (
                                <a
                                    key={n}
                                    href={`?material=${n}`}
                                    style={{
                                        display: 'block',
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        textDecoration: 'none',
                                        color: n === name ? '#0d0d12' : '#d8d8e0',
                                        background: n === name ? '#8ec7ff' : 'transparent',
                                    }}
                                >
                                    {n}
                                </a>
                            ))}
                        </div>
                    ))}
                </nav>
            ) : (
                <PanelTab label="Materiais ▸" onClick={() => setList(true)} style={{ top: 8, left: 8 }} />
            )}
            {/* O palco ocupa o que os painéis deixam livre; a imagem cabe inteira nele, sem distorcer. */}
            <main
                style={{
                    position: 'fixed',
                    top: 0,
                    left: list ? LIST_W : 0,
                    right: 'var(--inspetor, 0px)',
                    bottom: 'var(--dock, 0px)',
                    background: '#0d0d12',
                }}
            >
                <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
                {error !== null && (
                    <pre style={{ position: 'absolute', left: 0, top: 0, color: '#f66', padding: 12 }}>{error}</pre>
                )}
                <div style={{ position: 'absolute', left: 10, bottom: 6, color: '#888', font: '11px system-ui, sans-serif' }}>
                    arrastar: girar · roda: aproximar · H: oculta ou mostra todos os painéis
                </div>
            </main>
            {running !== null && <FpsCounter app={running} />}
            {running !== null && surface !== null && (
                <MaterialWorkbench app={running} canvas={surface.canvas} active={active} />
            )}
        </div>
    );
}
