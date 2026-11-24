import { useEffect, useMemo, useRef, useState } from 'react';
import { Application, createScene, nodes, OrbitController, subgraphOrigin } from 'clayflow/web';
import type { MaterialName, NodeDefinition } from 'clayflow/web';
import { H, W } from './scenes/size';
import { MATERIAL_FAMILIES, materialStage, type MaterialStage } from './scenes/materiais';
import { FpsCounter } from './ScenePanel';

// A galeria individual dos materiais (spec 011): `?material=<nome>` abre um material numa esfera, com os parâmetros que
// ele expõe (editáveis ao vivo, sem recompilar: os valores da função) e o grafo de nós de que é feito.

type Value = number | number[];
interface Param {
    readonly type: string;
    readonly default?: Value;
}

const toSrgb = (c: number): number =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const toLinear = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const hex = (rgb: readonly number[]): string =>
    '#'
    + rgb
          .slice(0, 3)
          .map((c) =>
              Math.round(255 * Math.min(1, Math.max(0, toSrgb(c))))
                  .toString(16)
                  .padStart(2, '0'),
          )
          .join('');
const unhex = (h: string): number[] =>
    [1, 3, 5].map((i) => Number(toLinear(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)));

/** A faixa do controle de um parâmetro escalar, pelo nome e pelo valor padrão. */
function range(name: string, value: number): { min: number; max: number; step: number } {
    if (/ior/.test(name)) return { min: 1, max: 3, step: 0.01 };
    if (/seed|octaves/.test(name)) return { min: 0, max: 16, step: 1 };
    const top = Math.abs(value) <= 1 ? 1 : Math.abs(value) * 4;
    if (/height|depth|size|scale|count|density|thickness/.test(name)) {
        const max = value === 0 ? 2 : Math.abs(value) * 4;
        return { min: 0, max, step: max / 200 };
    }
    return { min: 0, max: top, step: top / 200 };
}

const isColor = (name: string, p: Param): boolean =>
    p.type === 'vec3f' && /color|tint/.test(name);

const panel: React.CSSProperties = {
    background: '#14141c',
    color: '#d8d8e0',
    font: '12px/1.4 system-ui, sans-serif',
    overflow: 'auto',
    padding: 12,
};
const heading: React.CSSProperties = { color: '#8ec7ff', fontWeight: 600, margin: '14px 0 6px' };
const numberBox: React.CSSProperties = {
    width: 62,
    background: '#0d0d12',
    color: '#d8d8e0',
    border: '1px solid #2a2a36',
    borderRadius: 4,
    padding: '2px 4px',
};

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
    /** Parâmetro exposto → o nó do grafo de onde vem (`nó.parâmetro`). */
    const source = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of (origin?.options.expose ?? []) as readonly (string | readonly string[])[]) {
            const [port, alias] = typeof item === 'string' ? [item, item.replace('.', '_')] : item;
            if (port !== undefined && alias !== undefined) map.set(alias, port.split('.')[0] ?? '');
        }
        return map;
    }, [origin]);

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
                        <GraphView key={name} root={definition} lit={lit} />
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
                {Object.entries(params).map(([key, p]) => (
                    <div
                        key={key}
                        onMouseEnter={() => setLit(source.get(key) ?? null)}
                        onMouseLeave={() => setLit(null)}
                        style={{ marginBottom: 8 }}
                    >
                        <Control
                            name={key}
                            param={p}
                            value={current(key)}
                            onChange={(v) => change(key, v)}
                        />
                    </div>
                ))}
            </aside>
        </div>
    );
}

/** O controle de um parâmetro: cursor para escalar, seletor para cor, caixas para vetor. */
function Control({
    name,
    param,
    value,
    onChange,
}: {
    readonly name: string;
    readonly param: Param;
    readonly value: Value;
    readonly onChange: (v: Value) => void;
}) {
    const label = <span style={{ flex: 1 }}>{name}</span>;
    const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
    if (typeof value === 'number') {
        const base = typeof param.default === 'number' ? param.default : value;
        const r = range(name, base);
        const max = Math.max(r.max, value);
        return (
            <div>
                <div style={row}>
                    {label}
                    <input
                        type="number"
                        value={value}
                        step={r.step}
                        onChange={(e) => onChange(Number(e.target.value))}
                        style={numberBox}
                    />
                </div>
                <input
                    type="range"
                    min={r.min}
                    max={max}
                    step={r.step}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>
        );
    }
    if (isColor(name, param)) {
        return (
            <div style={row}>
                {label}
                <input
                    type="color"
                    value={hex(value)}
                    onChange={(e) => onChange(unhex(e.target.value))}
                />
            </div>
        );
    }
    return (
        <div style={row}>
            {label}
            {value.map((c, i) => (
                <input
                    key={i}
                    type="number"
                    value={c}
                    step={Math.max(Math.abs(c) / 20, 0.01)}
                    onChange={(e) => onChange(value.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                    style={{ ...numberBox, width: 54 }}
                />
            ))}
        </div>
    );
}

interface Box {
    readonly id: string;
    readonly kind: string;
    readonly inner: NodeDefinition | undefined;
    readonly values: Readonly<Record<string, Value>>;
    x: number;
    y: number;
}

/** O nome do tipo de um nó do grafo e a definição dele (para abrir, se for um sub-grafo). */
function describe(node: unknown): { kind: string; inner?: NodeDefinition; values: Record<string, Value> } {
    const n = node as { definition?: NodeDefinition; values?: Record<string, Value>; name?: string };
    if (n.definition !== undefined) {
        return { kind: n.definition.name, inner: n.definition, values: n.values ?? {} };
    }
    if (typeof n.name === 'string' && 'outputs' in (n as object)) {
        return { kind: n.name, inner: n as unknown as NodeDefinition, values: {} };
    }
    return { kind: 'entrada do ponto', values: {} };
}

const BOX_W = 150;
const BOX_H = 38;
const GAP_X = 46;
const GAP_Y = 10;

/** O grafo de nós de um material em colunas (da entrada à saída), com as ligações; um sub-grafo abre no lugar. */
function GraphView({ root, lit }: { readonly root: NodeDefinition; readonly lit: string | null }) {
    const [path, setPath] = useState<readonly NodeDefinition[]>([root]);
    const [picked, setPicked] = useState<string | null>(null);
    const shown = path[path.length - 1] ?? root;
    const layout = useMemo(() => {
        const graph = subgraphOrigin(shown)?.graph;
        if (graph === undefined) return undefined;
        const boxes = new Map<string, Box>();
        for (const [id, node] of Object.entries(graph.nodes)) {
            const d = describe(node);
            boxes.set(id, {
                id,
                kind: d.kind,
                inner: d.inner !== undefined && subgraphOrigin(d.inner) !== undefined ? d.inner : undefined,
                values: d.values,
                x: 0,
                y: 0,
            });
        }
        const links = (graph.links as readonly (readonly [string, string])[]).map(([from, to]) => ({
            from: from.split('.')[0] ?? '',
            to: to.split('.')[0] ?? '',
            port: `${from.split('.').slice(1).join('.')} → ${to.split('.').slice(1).join('.')}`,
        }));
        // A coluna de cada nó: o caminho mais longo desde uma entrada (o grafo é acíclico; o laço tem teto).
        const depth = new Map<string, number>([...boxes.keys()].map((id) => [id, 0]));
        for (let pass = 0; pass < boxes.size; pass++) {
            let moved = false;
            for (const l of links) {
                const d = (depth.get(l.from) ?? 0) + 1;
                if (d > (depth.get(l.to) ?? 0)) {
                    depth.set(l.to, d);
                    moved = true;
                }
            }
            if (!moved) break;
        }
        const columns = new Map<number, Box[]>();
        for (const box of boxes.values()) {
            const d = depth.get(box.id) ?? 0;
            columns.set(d, [...(columns.get(d) ?? []), box]);
        }
        let height = 0;
        for (const [d, column] of columns) {
            column.forEach((box, i) => {
                box.x = d * (BOX_W + GAP_X);
                box.y = i * (BOX_H + GAP_Y);
            });
            height = Math.max(height, column.length * (BOX_H + GAP_Y));
        }
        return { boxes, links, width: columns.size * (BOX_W + GAP_X), height };
    }, [shown]);
    if (layout === undefined) return <p>Sem grafo.</p>;
    const chosen = picked === null ? undefined : layout.boxes.get(picked);
    return (
        <div>
            <div style={{ marginBottom: 6 }}>
                {path.map((d, i) => (
                    <span key={i}>
                        {i > 0 && ' › '}
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                setPath(path.slice(0, i + 1));
                                setPicked(null);
                            }}
                            style={{ color: '#8ec7ff' }}
                        >
                            {d.name}
                        </a>
                    </span>
                ))}
                <span style={{ color: '#888' }}>
                    {' '}
                    · {layout.boxes.size} nós, {layout.links.length} ligações
                </span>
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #2a2a36', borderRadius: 6 }}>
                <svg width={layout.width + 8} height={layout.height + 8} style={{ display: 'block' }}>
                    <g transform="translate(4,4)">
                        {layout.links.map((l, i) => {
                            const a = layout.boxes.get(l.from);
                            const b = layout.boxes.get(l.to);
                            if (a === undefined || b === undefined) return null;
                            const [x1, y1] = [a.x + BOX_W, a.y + BOX_H / 2];
                            const [x2, y2] = [b.x, b.y + BOX_H / 2];
                            const on = picked === l.from || picked === l.to;
                            return (
                                <path
                                    key={i}
                                    d={`M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`}
                                    fill="none"
                                    stroke={on ? '#8ec7ff' : '#4a4a5c'}
                                    strokeWidth={on ? 1.6 : 1}
                                >
                                    <title>{`${l.from}.${l.port.replace(' → ', ` → ${l.to}.`)}`}</title>
                                </path>
                            );
                        })}
                        {[...layout.boxes.values()].map((box) => {
                            const on = picked === box.id || lit === box.id;
                            return (
                                <g
                                    key={box.id}
                                    transform={`translate(${box.x},${box.y})`}
                                    onClick={() => setPicked(box.id === picked ? null : box.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <rect
                                        width={BOX_W}
                                        height={BOX_H}
                                        rx={5}
                                        fill={on ? '#22344a' : '#1b1b26'}
                                        stroke={on ? '#8ec7ff' : box.inner !== undefined ? '#c9a45c' : '#34344a'}
                                    />
                                    <text x={8} y={15} fill="#e6e6ee" fontSize={11} fontWeight={600}>
                                        {box.id}
                                    </text>
                                    <text x={8} y={29} fill="#9a9ab0" fontSize={10}>
                                        {box.kind}
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                </svg>
            </div>
            {chosen !== undefined && (
                <div style={{ marginTop: 8 }}>
                    <strong>{chosen.id}</strong> <span style={{ color: '#9a9ab0' }}>{chosen.kind}</span>
                    {chosen.inner !== undefined && (
                        <button
                            onClick={() => {
                                setPath([...path, chosen.inner as NodeDefinition]);
                                setPicked(null);
                            }}
                            style={{ ...numberBox, width: 'auto', marginLeft: 8, cursor: 'pointer' }}
                        >
                            abrir sub-grafo
                        </button>
                    )}
                    <div style={{ color: '#b8b8c8', marginTop: 4 }}>
                        {Object.entries(chosen.values).length === 0
                            ? 'valores padrão do nó'
                            : Object.entries(chosen.values)
                                  .map(([k, v]) => `${k} = ${Array.isArray(v) ? `(${v.join(', ')})` : String(v)}`)
                                  .join(' · ')}
                    </div>
                    <div style={{ color: '#888', marginTop: 4 }}>
                        {layout.links
                            .filter((l) => l.from === chosen.id || l.to === chosen.id)
                            .map((l) => `${l.from}.${l.port.replace(' → ', ` → ${l.to}.`)}`)
                            .join(' · ')}
                    </div>
                </div>
            )}
        </div>
    );
}
