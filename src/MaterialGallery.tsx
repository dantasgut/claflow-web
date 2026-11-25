import { useEffect, useRef, useState } from 'react';
import { Application, createScene, nodes, OrbitController, subgraphOrigin } from 'clayflow/web';
import type { MaterialName, NodeDefinition } from 'clayflow/web';
import { H, W } from './scenes/size';
import { MATERIAL_FAMILIES, materialStage, type MaterialStage } from './scenes/materiais';
import { FpsCounter } from './ScenePanel';
import {
    ExposedParams,
    GraphView,
    heading,
    numberBox,
    panel,
    type GraphEdit,
    type Param,
    type Value,
} from './MaterialNodes';

// A galeria individual dos materiais (spec 011): `?material=<nome>` abre um material numa esfera, com os parâmetros que
// ele expõe (editáveis ao vivo, sem recompilar: os valores da função) e o grafo de nós de que é feito.

/** A galeria: a lista dos materiais, o palco e o painel de parâmetros e nós. */
export function MaterialGallery({ name }: { readonly name: MaterialName }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState<Application | null>(null);
    // O palco é do motor (as funções do material e do deslocamento, cujos valores mudam no lugar): fora do estado.
    const stageRef = useRef<MaterialStage | null>(null);
    const definition = nodes.material[name] as NodeDefinition;
    const params = definition.params as Readonly<Record<string, Param>>;
    const [values, setValues] = useState<Record<string, Value>>({});
    const [lit, setLit] = useState<string | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (host === null) return;
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
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
                stageRef.current = made;
                setValues({ ...made.staged } as Record<string, Value>);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            disposed = true;
            setRunning(null);
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

    const origin = subgraphOrigin(definition);
    // Os mesmos valores nos controles expostos e nos nós do grafo (o parâmetro exposto se edita nos dois lugares).
    const edit: GraphEdit = { params, value: current, change };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 340px', height: '100vh' }}>
            <nav style={panel}>
                <a href="?" style={{ color: '#8ec7ff' }}>
                    ← cenas
                </a>
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
            <main style={{ overflow: 'auto', background: '#0d0d12' }}>
                <div ref={hostRef} />
                {running !== null && <FpsCounter app={running} />}
                {error !== null && <pre style={{ color: '#f66', padding: 12 }}>{error}</pre>}
                <div style={{ ...panel, background: 'transparent' }}>
                    <div style={heading}>Nós de {name}</div>
                    {origin === undefined ? (
                        <p>Este material não é um sub-grafo de nós.</p>
                    ) : (
                        <GraphView key={name} root={definition} lit={lit} edit={edit} />
                    )}
                </div>
            </main>
            <aside style={{ ...panel, paddingTop: 44 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 15 }}>{name}</strong>
                    <button onClick={reset} style={{ ...numberBox, width: 'auto', cursor: 'pointer' }}>
                        restaurar
                    </button>
                </div>
                <p style={{ color: '#888', marginTop: 4 }}>arrastar: girar · roda: aproximar</p>
                <div style={heading}>Parâmetros</div>
                <ExposedParams definition={definition} edit={edit} onLit={setLit} />
            </aside>
        </div>
    );
}
