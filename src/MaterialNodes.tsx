import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { subgraphOrigin } from 'clayflow/web';
import type { NodeDefinition } from 'clayflow/web';

// Os nós de um material (spec 011), usados pela galeria (`?material=`) e pelo painel da vitrine (`?scene=vitrine-*`):
// os controles dos parâmetros expostos e o grafo de nós, cada nó um painel que recolhe e abre, com os parâmetros dentro.

export type Value = number | number[];
export interface Param {
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

export const panel: React.CSSProperties = {
    background: '#14141c',
    color: '#d8d8e0',
    font: '12px/1.4 system-ui, sans-serif',
    overflow: 'auto',
    padding: 12,
};
export const heading: React.CSSProperties = { color: '#8ec7ff', fontWeight: 600, margin: '14px 0 6px' };
export const numberBox: React.CSSProperties = {
    width: 62,
    background: '#0d0d12',
    color: '#d8d8e0',
    border: '1px solid #2a2a36',
    borderRadius: 4,
    padding: '2px 4px',
};

/** O controle de um parâmetro: cursor para escalar, seletor para cor, caixas para vetor. */
export function Control({
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

/**
 * Os parâmetros que o sub-grafo `definition` expõe: `nó.parâmetro` → o nome exposto (`nó_parâmetro`, ou o nome próprio
 * dado em `['nó.parâmetro', 'nome']`).
 */
export function exposedPorts(definition: NodeDefinition): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const item of subgraphOrigin(definition)?.options.expose ?? []) {
        if (typeof item === 'string') map.set(item, item.replace('.', '_'));
        else map.set(item[0], item[1]);
    }
    return map;
}

/** Os valores ao vivo do material mostrado: o grafo edita no próprio nó os parâmetros que o material expõe. */
export interface GraphEdit {
    readonly params: Readonly<Record<string, Param>>;
    value(name: string): Value;
    change(name: string, value: Value): void;
}

/** Os controles dos parâmetros expostos de um material; passar o ponteiro por um acende o nó de onde ele vem. */
export function ExposedParams({
    definition,
    edit,
    onLit,
}: {
    readonly definition: NodeDefinition;
    readonly edit: GraphEdit;
    readonly onLit?: (node: string | null) => void;
}) {
    /** Parâmetro exposto → o nó do grafo de onde vem. */
    const source = useMemo(() => {
        const map = new Map<string, string>();
        for (const [port, alias] of exposedPorts(definition)) map.set(alias, port.split('.')[0] ?? '');
        return map;
    }, [definition]);
    return (
        <>
            {Object.entries(edit.params).map(([key, p]) => (
                <div
                    key={key}
                    onMouseEnter={() => onLit?.(source.get(key) ?? null)}
                    onMouseLeave={() => onLit?.(null)}
                    style={{ marginBottom: 8 }}
                >
                    <Control name={key} param={p} value={edit.value(key)} onChange={(v) => edit.change(key, v)} />
                </div>
            ))}
        </>
    );
}

const show = (v: Value | undefined): string =>
    v === undefined ? '—' : Array.isArray(v) ? `(${v.map((c) => Number(c.toFixed(4))).join(', ')})` : String(v);

export interface Link {
    readonly from: string;
    readonly to: string;
    readonly port: string;
}

export interface Box {
    readonly id: string;
    readonly kind: string;
    readonly inner: NodeDefinition | undefined;
    readonly values: Readonly<Record<string, Value>>;
    /** Os parâmetros, as entradas e as saídas da definição do nó (o painel do nó mostra todos). */
    readonly params: Readonly<Record<string, Param>>;
    readonly inputs: Readonly<Record<string, string>>;
    readonly outputs: Readonly<Record<string, string>>;
}

const mark: React.CSSProperties = { fontSize: 10, textAlign: 'right' };

/**
 * O corpo do painel de um nó: todos os parâmetros da definição dele com o valor em uso (o que o grafo deu, ou o padrão
 * do nó), o que está ligado a outro nó e o que o material expõe — este com o controle, editável no próprio nó (o mesmo
 * valor do controle exposto); as entradas e as saídas com o tipo.
 */
export function NodeParams({
    box,
    links,
    exposed,
    edit,
}: {
    readonly box: Box;
    readonly links: readonly Link[];
    readonly exposed: ReadonlyMap<string, string>;
    readonly edit: GraphEdit | undefined;
}) {
    const linked = new Map(
        links
            .filter((l) => l.to === box.id)
            .map((l) => [l.port.split(' → ')[1] ?? '', `${l.from}.${l.port.split(' → ')[0] ?? ''}`]),
    );
    const names = [...new Set([...Object.keys(box.params), ...Object.keys(box.inputs)])];
    const outputs = Object.entries(box.outputs);
    return (
        <div style={{ padding: '4px 8px 6px' }}>
            {names.length === 0 && <div style={{ color: '#888' }}>nó sem parâmetros</div>}
            {names.map((k) => {
                const p = box.params[k];
                const set = k in box.values;
                const from = linked.get(k);
                const alias = exposed.get(`${box.id}.${k}`);
                const live = alias !== undefined && from === undefined ? edit?.params[alias] : undefined;
                return (
                    <div key={k} style={{ padding: '2px 0', borderTop: '1px solid #24243a' }}>
                        {live !== undefined && edit !== undefined && alias !== undefined ? (
                            <Control
                                name={k}
                                param={live}
                                value={edit.value(alias)}
                                onChange={(v) => edit.change(alias, v)}
                            />
                        ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <span style={{ color: '#e6e6ee' }}>{k}</span>
                                <span style={{ color: '#777', fontSize: 10 }}>{p?.type ?? box.inputs[k]}</span>
                                <span
                                    style={{
                                        marginLeft: 'auto',
                                        textAlign: 'right',
                                        overflowWrap: 'anywhere',
                                        color: from !== undefined ? '#8ec7ff' : set ? '#f0d28a' : '#b8b8c8',
                                    }}
                                >
                                    {from !== undefined
                                        ? `← ligado a ${from}`
                                        : p === undefined
                                          ? 'entrada sem ligação'
                                          : show(box.values[k] ?? p.default)}
                                </span>
                            </div>
                        )}
                        {from === undefined && p !== undefined && !set && live === undefined && (
                            <div style={{ ...mark, color: '#777' }}>padrão</div>
                        )}
                        {alias !== undefined && <div style={{ ...mark, color: '#9bd29b' }}>exposto: {alias}</div>}
                    </div>
                );
            })}
            <div style={{ color: '#888', marginTop: 4, borderTop: '1px solid #24243a', paddingTop: 2 }}>
                saídas:{' '}
                {outputs.length === 0
                    ? '—'
                    : outputs.map(([k, t]) => (
                          <span key={k} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                              <span style={{ color: '#b8b8c8' }}>{k}</span> {t}
                          </span>
                      ))}
            </div>
        </div>
    );
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

/** O nó escolhido no grafo, para o inspetor: a caixa, as ligações e os expostos do grafo em que ele está. */
export interface NodeSelection {
    readonly box: Box;
    readonly links: readonly Link[];
    readonly exposed: ReadonlyMap<string, string>;
    /** O nó é do grafo do próprio material (os expostos têm o valor ao vivo), não de um sub-grafo aberto. */
    readonly live: boolean;
}

const NODE_W = 230;
const HEAD_H = 36;
const GAP_X = 46;
const GAP_Y = 10;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

interface View {
    readonly x: number;
    readonly y: number;
    readonly k: number;
}
const HOME: View = { x: 0, y: 0, k: 1 };

/**
 * O grafo de nós de um material em colunas (da entrada à saída), com as ligações, ocupando a altura do painel em que
 * está. Arrastar o fundo move o grafo, a roda rola, Ctrl + roda aproxima. Cada nó é um painel: o triângulo do cabeçalho
 * recolhe e abre (começam recolhidos); aberto, mostra os parâmetros e as saídas dentro da própria caixa. O clique no
 * cabeçalho escolhe o nó (`onSelect`, para o inspetor); o clique no fundo desfaz a escolha. As caixas têm a altura do
 * conteúdo e as ligações seguem as posições medidas. Um sub-grafo abre no lugar. Com `edit`, os parâmetros que o
 * material expõe são editáveis no nó.
 */
export function GraphView({
    root,
    lit,
    edit,
    picked = null,
    onPick,
    onSelect,
}: {
    readonly root: NodeDefinition;
    readonly lit: string | null;
    readonly edit?: GraphEdit;
    /** O identificador do nó escolhido (o estado é de quem usa o grafo: o inspetor também desfaz a escolha). */
    readonly picked?: string | null;
    readonly onPick?: (id: string | null) => void;
    /** O nó escolhido, com o que o inspetor precisa para mostrar os parâmetros dele. */
    readonly onSelect?: (selection: NodeSelection | null) => void;
}) {
    const setPicked = (id: string | null): void => onPick?.(id);
    const [path, setPath] = useState<readonly NodeDefinition[]>([root]);
    const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
    const [hover, setHover] = useState<string | null>(null);
    const [view, setView] = useState<View>(HOME);
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
                inner:
                    d.inner !== undefined && subgraphOrigin(d.inner) !== undefined ? d.inner : undefined,
                values: d.values,
                params: (d.inner?.params ?? {}) as Readonly<Record<string, Param>>,
                inputs: (d.inner?.inputs ?? {}) as Readonly<Record<string, string>>,
                outputs: (d.inner?.outputs ?? {}) as Readonly<Record<string, string>>,
            });
        }
        const links: Link[] = (graph.links as readonly (readonly [string, string])[]).map(([from, to]) => ({
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
        const byDepth = new Map<number, Box[]>();
        for (const box of boxes.values()) {
            const d = depth.get(box.id) ?? 0;
            byDepth.set(d, [...(byDepth.get(d) ?? []), box]);
        }
        const columns = [...byDepth].sort((a, b) => a[0] - b[0]).map(([, column]) => column);
        return { boxes, links, columns };
    }, [shown]);
    // Os parâmetros internos que o sub-grafo expõe: `nó.parâmetro` → o nome exposto.
    const exposed = useMemo(() => exposedPorts(shown), [shown]);

    // O nó escolhido vai ao inspetor (fora do grafo); sem grafo ou ao sair dele, nenhum.
    useEffect(() => {
        if (onSelect === undefined) return;
        const box = picked === null ? undefined : layout?.boxes.get(picked);
        onSelect(
            box === undefined || layout === undefined
                ? null
                : { box, links: layout.links, exposed, live: shown === root },
        );
    }, [onSelect, picked, layout, exposed, shown, root]);
    useEffect(() => () => onSelect?.(null), [onSelect]);

    // As posições das caixas, medidas: a altura de cada uma é a do conteúdo (recolhida, só o cabeçalho), e as de baixo
    // na coluna descem ou sobem com ela — as ligações são redesenhadas a cada mudança de tamanho.
    const hostRef = useRef<HTMLDivElement>(null);
    const nodeRefs = useRef(new Map<string, HTMLDivElement>());
    const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(new Map());
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (host === null) return;
        const measure = (): void => {
            const next = new Map<string, Rect>();
            for (const [id, el] of nodeRefs.current) {
                next.set(id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
            }
            setRects((prev) => {
                if (prev.size !== next.size) return next;
                for (const [id, r] of next) {
                    const p = prev.get(id);
                    if (p === undefined || p.x !== r.x || p.y !== r.y || p.w !== r.w || p.h !== r.h) return next;
                }
                return prev;
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        for (const el of nodeRefs.current.values()) observer.observe(el);
        return () => observer.disconnect();
    }, [layout]);

    // A roda: rola o grafo; com Ctrl (ou o gesto de pinça), aproxima em torno do ponteiro. O ouvinte é direto no
    // elemento, não passivo, para a página não rolar junto.
    const viewportRef = useRef<HTMLDivElement>(null);
    const hasGraph = layout !== undefined;
    useEffect(() => {
        const el = viewportRef.current;
        if (el === null) return;
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            const box = el.getBoundingClientRect();
            const [cx, cy] = [e.clientX - box.left, e.clientY - box.top];
            setView((v) => {
                if (!e.ctrlKey && !e.metaKey) return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
                const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * Math.exp(-e.deltaY * 0.004)));
                return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [hasGraph]);
    // Arrastar o fundo move o grafo; o clique parado no fundo desfaz a escolha do nó.
    const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null);

    if (layout === undefined) return <p>Sem grafo.</p>;
    const go = (next: readonly NodeDefinition[]): void => {
        setPath(next);
        setOpened(new Set());
        setHover(null);
        setPicked(null);
        setView(HOME);
    };
    const toggle = (id: string): void => {
        const next = new Set(opened);
        if (!next.delete(id)) next.add(id);
        setOpened(next);
    };
    const allOpen = opened.size >= layout.boxes.size;
    // Só o grafo do próprio material tem os valores ao vivo: dentro de um sub-grafo, os expostos são os do nó de fora.
    const live = shown === root ? edit : undefined;
    const tool: React.CSSProperties = { ...numberBox, width: 'auto', cursor: 'pointer' };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>
                    {path.map((d, i) => (
                        <span key={i}>
                            {i > 0 && ' › '}
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    go(path.slice(0, i + 1));
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
                </span>
                <button
                    onClick={() => setOpened(allOpen ? new Set() : new Set(layout.boxes.keys()))}
                    style={tool}
                >
                    {allOpen ? 'colapsar todos' : 'expandir todos'}
                </button>
                <button onClick={() => setView(HOME)} style={tool} title="volta o grafo ao canto, sem aproximação">
                    recentrar · {Math.round(view.k * 100)}%
                </button>
                <span style={{ color: '#777' }}>
                    arrastar o fundo: mover · roda: rolar · Ctrl + roda: aproximar · clique no nó: inspecionar
                </span>
            </div>
            <div
                ref={viewportRef}
                onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as Element).closest('[data-node]') !== null) return;
                    drag.current = { x: e.clientX, y: e.clientY, from: view, moved: false };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                    const d = drag.current;
                    if (d === null) return;
                    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
                    if (Math.hypot(dx, dy) > 3) d.moved = true;
                    if (d.moved) setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy });
                }}
                onPointerUp={() => {
                    const d = drag.current;
                    drag.current = null;
                    if (d !== null && !d.moved) setPicked(null);
                }}
                onPointerCancel={() => {
                    drag.current = null;
                }}
                style={{
                    flex: 1,
                    minHeight: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    border: '1px solid #2a2a36',
                    borderRadius: 6,
                    background: '#101018',
                    cursor: 'grab',
                    touchAction: 'none',
                }}
            >
                <div
                    ref={hostRef}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                        transformOrigin: '0 0',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: GAP_X,
                        padding: 10,
                        width: 'max-content',
                    }}
                >
                    <svg
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none',
                        }}
                    >
                        {layout.links.map((l, i) => {
                            const a = rects.get(l.from);
                            const b = rects.get(l.to);
                            if (a === undefined || b === undefined) return null;
                            const [x1, y1] = [a.x + a.w, a.y + HEAD_H / 2];
                            const [x2, y2] = [b.x, b.y + HEAD_H / 2];
                            const on =
                                hover === l.from || hover === l.to || picked === l.from || picked === l.to;
                            return (
                                <path
                                    key={i}
                                    d={`M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`}
                                    fill="none"
                                    stroke={on ? '#8ec7ff' : '#4a4a5c'}
                                    strokeWidth={on ? 1.6 : 1}
                                    style={{ pointerEvents: 'stroke' }}
                                >
                                    <title>{`${l.from}.${l.port.replace(' → ', ` → ${l.to}.`)}`}</title>
                                </path>
                            );
                        })}
                    </svg>
                    {layout.columns.map((column, c) => (
                        <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: GAP_Y }}>
                            {column.map((box) => {
                                const chosen = picked === box.id;
                                const on = chosen || hover === box.id || lit === box.id;
                                const open = opened.has(box.id);
                                return (
                                    <div
                                        key={box.id}
                                        data-node={box.id}
                                        ref={(el) => {
                                            if (el === null) nodeRefs.current.delete(box.id);
                                            else nodeRefs.current.set(box.id, el);
                                        }}
                                        onMouseEnter={() => setHover(box.id)}
                                        onMouseLeave={() => setHover((h) => (h === box.id ? null : h))}
                                        style={{
                                            position: 'relative',
                                            width: NODE_W,
                                            boxSizing: 'border-box',
                                            borderRadius: 5,
                                            background: '#1b1b26',
                                            cursor: 'default',
                                            border: `1px solid ${
                                                on ? '#8ec7ff' : box.inner !== undefined ? '#c9a45c' : '#34344a'
                                            }`,
                                            boxShadow: chosen ? '0 0 0 2px #8ec7ff' : 'none',
                                        }}
                                    >
                                        <div
                                            onClick={() => setPicked(chosen ? null : box.id)}
                                            title="inspecionar o nó no painel da direita"
                                            style={{
                                                height: HEAD_H,
                                                boxSizing: 'border-box',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '0 8px 0 2px',
                                                cursor: 'pointer',
                                                userSelect: 'none',
                                                borderRadius: open ? '4px 4px 0 0' : 4,
                                                background: chosen ? '#2b4a6b' : on ? '#22344a' : '#232334',
                                            }}
                                        >
                                            <span
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggle(box.id);
                                                }}
                                                title={open ? 'recolher o nó' : 'abrir o nó'}
                                                style={{
                                                    color: '#c8c8d8',
                                                    width: 20,
                                                    alignSelf: 'stretch',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                {open ? '▾' : '▸'}
                                            </span>
                                            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
                                                <span
                                                    style={{
                                                        display: 'block',
                                                        color: '#e6e6ee',
                                                        fontWeight: 600,
                                                        fontSize: 11,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {box.id}
                                                </span>
                                                <span
                                                    style={{
                                                        display: 'block',
                                                        color: '#9a9ab0',
                                                        fontSize: 10,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {box.kind}
                                                </span>
                                            </span>
                                            {box.inner !== undefined && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        go([...path, box.inner as NodeDefinition]);
                                                    }}
                                                    title="abrir sub-grafo"
                                                    style={{
                                                        ...numberBox,
                                                        width: 'auto',
                                                        cursor: 'pointer',
                                                        fontSize: 10,
                                                        borderColor: '#c9a45c',
                                                    }}
                                                >
                                                    abrir sub-grafo
                                                </button>
                                            )}
                                        </div>
                                        {open && (
                                            <NodeParams
                                                box={box}
                                                links={layout.links}
                                                exposed={exposed}
                                                edit={live}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
