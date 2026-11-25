import { useEffect, useState, type CSSProperties } from 'react';
import * as clayflow from 'clayflow/web';
import { nodes, subgraphOrigin } from 'clayflow/web';
import type { Application, MaterialName, NodeDefinition } from 'clayflow/web';
import { ExposedParams, GraphView, type GraphEdit, type Param, type Value } from './MaterialNodes';
import { Section } from './ScenePanel';
import { MATERIAL_FAMILIES, showcasePieces, type ShowcasePiece } from './scenes/materiais';

// O painel dos materiais das cenas `vitrine-<família>` (à direita): a lista dos materiais da família; escolhido um (na
// lista ou com um clique na peça, no canvas), os parâmetros que ele expõe — editáveis ao vivo naquela peça da cena, sem
// recompilar — e o grafo de nós de que é feito.

type Vec3 = readonly [number, number, number];

/** O vetor `v` girado pela rotação `q` (x, y, z, w). */
function rotate(q: readonly number[], v: Vec3): Vec3 {
    const [x = 0, y = 0, z = 0, w = 1] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    ];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A peça da vitrine sob o ponto (`px`, `py`, em pixels do canvas): os centros das peças projetados pela câmera da cena
 * como ela está no quadro (a que segue o tempo ou a livre), cada peça um disco do raio projetado; a mais próxima vence.
 */
function pieceAt(
    app: Application,
    canvas: HTMLCanvasElement,
    px: number,
    py: number,
): string | undefined {
    let eye: Vec3 | undefined;
    let rotation: readonly number[] = [0, 0, 0, 1];
    let fov = 0;
    for (const record of app.world.allRecords()) {
        if (!(record.root instanceof clayflow.Camera)) continue;
        const transform = record.resources.find((r) => r instanceof clayflow.Transform);
        if (!(transform instanceof clayflow.Transform)) continue;
        const p = transform.data.position;
        eye = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
        rotation = transform.data.rotation;
        fov = record.root.data.fov;
        break;
    }
    if (eye === undefined || !(fov > 0)) return undefined;
    const forward = rotate(rotation, [0, 0, -1]);
    const right = rotate(rotation, [1, 0, 0]);
    const up = rotate(rotation, [0, 1, 0]);
    const focal = canvas.height / 2 / Math.tan(fov / 2);
    let best: string | undefined;
    let nearest = Infinity;
    for (const [name, piece] of showcasePieces(app)) {
        const d: Vec3 = [piece.at[0] - eye[0], piece.at[1] - eye[1], piece.at[2] - eye[2]];
        const z = dot(d, forward);
        if (z <= 0 || z >= nearest) continue;
        const x = canvas.width / 2 + (focal * dot(d, right)) / z;
        const y = canvas.height / 2 - (focal * dot(d, up)) / z;
        if (Math.hypot(px - x, py - y) > (focal * piece.radius) / z) continue;
        best = name;
        nearest = z;
    }
    return best;
}

/** O painel da vitrine da família `family`, sobre a cena de `app` desenhada em `canvas`. */
export function ShowcasePanel({
    app,
    canvas,
    family,
}: {
    readonly app: Application;
    readonly canvas: HTMLCanvasElement;
    readonly family: string;
}) {
    const [open, setOpen] = useState(true);
    const [wide, setWide] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);
    const [lit, setLit] = useState<string | null>(null);
    const [, redraw] = useState(0);
    const names = MATERIAL_FAMILIES.find(([f]) => f === family)?.[1] ?? [];
    const pieces = showcasePieces(app);

    // O clique numa peça, no canvas: só o clique parado (arrastar gira a câmera livre).
    useEffect(() => {
        let down: { x: number; y: number } | undefined;
        const onDown = (e: PointerEvent): void => {
            down = { x: e.clientX, y: e.clientY };
        };
        const onUp = (e: PointerEvent): void => {
            const from = down;
            down = undefined;
            if (from === undefined || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
            const box = canvas.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return;
            const name = pieceAt(
                app,
                canvas,
                ((e.clientX - box.left) * canvas.width) / box.width,
                ((e.clientY - box.top) * canvas.height) / box.height,
            );
            if (name !== undefined) {
                setPicked(name);
                setOpen(true);
            }
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);
        return () => {
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointerup', onUp);
        };
    }, [app, canvas]);

    const piece = picked === null ? undefined : pieces.get(picked);
    return (
        <div
            style={{ ...styles.panel, width: wide ? 'min(960px, 72vw)' : 400 }}
            // As teclas do painel não chegam à cena (o Espaço pausa, o P recolhe o outro painel).
            onKeyDown={(e) => e.stopPropagation()}
        >
            <div style={styles.top}>
                <span style={styles.title} onClick={() => setOpen((o) => !o)}>
                    {open ? '▾' : '▸'} Materiais · {family}
                </span>
                {open && (
                    <button style={styles.button} onClick={() => setWide((w) => !w)}>
                        {wide ? 'estreitar' : 'alargar'}
                    </button>
                )}
            </div>
            {open && (
                <>
                    <div style={styles.list}>
                        {names.map((n) => (
                            <button
                                key={n}
                                onClick={() => setPicked(n === picked ? null : n)}
                                style={{
                                    ...styles.item,
                                    color: n === picked ? '#0d0d12' : '#d8d8e0',
                                    background: n === picked ? '#8ec7ff' : '#1b1b26',
                                }}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                    {piece === undefined || picked === null ? (
                        <div style={styles.hint}>escolha um material na lista ou clique numa peça da cena</div>
                    ) : (
                        <Selected
                            key={picked}
                            name={picked as MaterialName}
                            piece={piece}
                            lit={lit}
                            onLit={setLit}
                            changed={() => redraw((n) => n + 1)}
                        />
                    )}
                </>
            )}
        </div>
    );
}

/** O material escolhido: os parâmetros expostos (os valores da peça na cena, mudados no lugar) e o grafo de nós. */
function Selected({
    name,
    piece,
    lit,
    onLit,
    changed,
}: {
    readonly name: MaterialName;
    readonly piece: ShowcasePiece;
    readonly lit: string | null;
    readonly onLit: (node: string | null) => void;
    readonly changed: () => void;
}) {
    const definition = nodes.material[name] as NodeDefinition;
    const params = definition.params as Readonly<Record<string, Param>>;
    // Os valores são os do motor (a função do material da peça), lidos a cada desenho do painel: fora do estado.
    const change = (key: string, value: Value): void => {
        piece.material.values[key] = value;
        // O relevo é um só para a cor e a geometria: o mesmo valor no deslocamento, quando ele tem o parâmetro.
        if (piece.displacement !== undefined && key in piece.displacement.params) {
            piece.displacement.values[key] = value;
        }
        changed();
    };
    const edit: GraphEdit = {
        params,
        value: (key) => (piece.material.values[key] as Value | undefined) ?? params[key]?.default ?? 0,
        change,
    };
    const reset = (): void => {
        for (const key of Object.keys(params)) {
            const back = piece.staged[key] ?? params[key]?.default;
            if (back !== undefined) change(key, Array.isArray(back) ? [...back] : back);
        }
    };
    return (
        <>
            <div style={styles.top}>
                <strong style={{ fontSize: 14 }}>{name}</strong>
                <span>
                    <a href={`?material=${name}`} style={{ color: '#8ec7ff', marginRight: 8 }}>
                        abrir na galeria
                    </a>
                    <button style={styles.button} onClick={reset}>
                        restaurar
                    </button>
                </span>
            </div>
            <Section title="Parâmetros expostos">
                {Object.keys(params).length === 0 ? (
                    <div style={styles.hint}>este material não expõe parâmetros</div>
                ) : (
                    <ExposedParams definition={definition} edit={edit} onLit={onLit} />
                )}
            </Section>
            <Section title="Nós">
                {subgraphOrigin(definition) === undefined ? (
                    <div style={styles.hint}>este material não é um sub-grafo de nós</div>
                ) : (
                    <GraphView root={definition} lit={lit} edit={edit} />
                )}
            </Section>
        </>
    );
}

const styles = {
    panel: {
        position: 'fixed',
        top: 40,
        right: 8,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(12, 12, 18, 0.9)',
        color: '#ddd',
        font: '12px/1.4 system-ui, -apple-system, sans-serif',
        zIndex: 10,
    },
    top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 },
    title: { fontWeight: 600, cursor: 'pointer', userSelect: 'none' },
    hint: { color: '#888', fontSize: 11, margin: '6px 0 2px' },
    list: { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '8px 0' },
    item: {
        border: '1px solid #2a2a36',
        borderRadius: 4,
        padding: '2px 7px',
        cursor: 'pointer',
        font: 'inherit',
    },
    button: {
        background: '#0d0d12',
        color: '#d8d8e0',
        border: '1px solid #2a2a36',
        borderRadius: 4,
        padding: '2px 6px',
        cursor: 'pointer',
        font: 'inherit',
    },
} as const satisfies Record<string, CSSProperties>;
