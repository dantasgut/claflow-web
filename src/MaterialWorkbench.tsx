import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { nodes, subgraphOrigin } from 'clayflow/web';
import type { Application, MaterialName, NodeDefinition } from 'clayflow/web';
import {
    ExposedParams,
    GraphView,
    NodeParams,
    type GraphEdit,
    type NodeSelection,
} from './MaterialNodes';
import { HideButton, keepKeys, PanelTab, usePanel } from './panels';
import { projectSphere, type Vec3 } from './project';

// A bancada de um material, a mesma na galeria (`?material=`) e nas vitrines (`?scene=vitrine-*`): o painel de nós
// embaixo, na largura da tela (o grafo, com arrastar e roda), e o inspetor à direita — a miniatura do material ativo e
// os parâmetros do nó escolhido no grafo, ou, sem nó escolhido, os parâmetros do material.

/** O material ativo: os valores ao vivo dele e onde a peça está na cena (para a miniatura). */
export interface ActiveMaterial {
    readonly name: MaterialName;
    readonly edit: GraphEdit;
    /** Volta os valores aos da montagem. */
    reset(): void;
    readonly at: Vec3;
    readonly radius: number;
}

const INSPECTOR_W = 340;
const THUMB = 120;

/**
 * A miniatura do material ativo: o recorte do canvas da cena em volta da peça (o centro e o raio projetados pela câmera
 * do quadro), copiado para um canvas 2D pequeno algumas vezes por segundo — sem segundo renderizador. A cópia é feita
 * no fim do quadro do motor (`frameComplete`), quando a imagem do canvas WebGPU ainda está lá; se ainda assim vier vazia
 * (seis cópias seguidas sem um pixel), a fonte passa a ser o vídeo de `canvas.captureStream()`.
 */
function Thumbnail({
    app,
    canvas,
    at,
    radius,
}: {
    readonly app: Application;
    readonly canvas: HTMLCanvasElement;
    readonly at: Vec3;
    readonly radius: number;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [source, setSource] = useState<'direto' | 'vídeo'>('direto');
    const [x, y, z] = at;
    useEffect(() => {
        const out = ref.current?.getContext('2d');
        if (out === null || out === undefined) return;
        let video: HTMLVideoElement | undefined;
        let stream: MediaStream | undefined;
        let blank = 0;
        let checks = 0;
        let last = 0;
        const draw = (): void => {
            const now = performance.now();
            if (now - last < 200) return;
            last = now;
            const p = projectSphere(app, canvas, [x, y, z], radius);
            if (p === undefined) return;
            if (video !== undefined && video.readyState < 2) return;
            const side = 2.5 * p.r;
            out.fillStyle = '#000';
            out.fillRect(0, 0, THUMB, THUMB);
            try {
                out.drawImage(video ?? canvas, p.x - side / 2, p.y - side / 2, side, side, 0, 0, THUMB, THUMB);
            } catch {
                return;
            }
            // As primeiras cópias diretas são conferidas: vazias (só o preto do fundo), troca a fonte pelo vídeo.
            if (video !== undefined || checks >= 12) return;
            checks++;
            const data = out.getImageData(0, 0, THUMB, THUMB).data;
            let lit = false;
            for (let i = 0; i < data.length && !lit; i += 4) {
                lit = (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0;
            }
            blank = lit ? 0 : blank + 1;
            if (blank < 6) return;
            stream = canvas.captureStream(5);
            video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            void video.play().catch(() => undefined);
            setSource('vídeo');
        };
        const off = app.events.on('frameComplete', draw);
        return () => {
            off?.();
            for (const track of stream?.getTracks() ?? []) track.stop();
            if (video !== undefined) video.srcObject = null;
        };
    }, [app, canvas, x, y, z, radius]);
    return (
        <canvas
            ref={ref}
            width={THUMB}
            height={THUMB}
            title={`miniatura: recorte ao vivo da peça na cena (${source})`}
            style={styles.thumb}
        />
    );
}

/**
 * A bancada: o inspetor (à direita; `children` vai no topo dele — a lista de materiais da vitrine) e o painel de nós
 * (embaixo). Publica em `--dock` e `--inspetor` (no documento) a altura e a largura que ocupam, para os outros painéis
 * e o palco da galeria darem lugar.
 */
export function MaterialWorkbench({
    app,
    canvas,
    active,
    children,
}: {
    readonly app: Application;
    readonly canvas: HTMLCanvasElement;
    readonly active: ActiveMaterial | undefined;
    readonly children?: ReactNode;
}) {
    const [inspector, setInspector] = usePanel('inspetor');
    const [dock, setDock] = usePanel('nos');
    const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38));
    const [picked, setPicked] = useState<string | null>(null);
    const [selection, setSelection] = useState<NodeSelection | null>(null);
    const [lit, setLit] = useState<string | null>(null);
    const name = active?.name;
    useEffect(() => {
        setPicked(null);
        setLit(null);
    }, [name]);
    useEffect(() => {
        const root = document.documentElement.style;
        root.setProperty('--dock', `${dock ? height : 0}px`);
        root.setProperty('--inspetor', `${inspector ? INSPECTOR_W + 16 : 0}px`);
    }, [dock, height, inspector]);
    useEffect(
        () => () => {
            const root = document.documentElement.style;
            root.removeProperty('--dock');
            root.removeProperty('--inspetor');
        },
        [],
    );

    const definition = name === undefined ? undefined : (nodes.material[name] as NodeDefinition);
    const hasGraph = definition !== undefined && subgraphOrigin(definition) !== undefined;
    // Arrastar a borda de cima do painel de nós muda a altura dele.
    const resize = useRef<{ y: number; from: number } | null>(null);
    return (
        <>
            {inspector ? (
                <div
                    style={styles.inspector}
                    onKeyDown={keepKeys}
                >
                    <div style={styles.top}>
                        <strong>Inspetor</strong>
                        <HideButton onClick={() => setInspector(false)} />
                    </div>
                    {children}
                    {active !== undefined && definition !== undefined && (
                        <>
                            <div style={{ display: 'flex', gap: 10, margin: '8px 0' }}>
                                <Thumbnail app={app} canvas={canvas} at={active.at} radius={active.radius} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={styles.hint}>material ativo</div>
                                    <strong style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{active.name}</strong>
                                    <div style={{ marginTop: 6 }}>
                                        <button style={styles.button} onClick={() => active.reset()}>
                                            restaurar valores
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {selection !== null ? (
                                <>
                                    <div style={styles.top}>
                                        <span style={styles.section}>Nó {selection.box.id}</span>
                                        <button style={styles.button} onClick={() => setPicked(null)}>
                                            ← material
                                        </button>
                                    </div>
                                    <div style={styles.hint}>
                                        {selection.box.kind}
                                        {selection.live
                                            ? ' · os parâmetros que o material expõe se editam aqui, ao vivo'
                                            : ' · nó de um sub-grafo aberto (só leitura)'}
                                    </div>
                                    <div style={{ margin: '0 -8px' }}>
                                        <NodeParams
                                            box={selection.box}
                                            links={selection.links}
                                            exposed={selection.exposed}
                                            edit={selection.live ? active.edit : undefined}
                                        />
                                    </div>
                                    <div style={styles.hint}>
                                        ligações:{' '}
                                        {selection.links
                                            .filter((l) => l.from === selection.box.id || l.to === selection.box.id)
                                            .map((l) => `${l.from}.${l.port.replace(' → ', ` → ${l.to}.`)}`)
                                            .join(' · ') || '—'}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={styles.section}>Parâmetros do material</div>
                                    <div style={{ ...styles.hint, marginBottom: 8 }}>
                                        os valores que o material deixa ajustar sem recompilar; clique num nó do grafo
                                        para ver os parâmetros dele
                                    </div>
                                    {Object.keys(active.edit.params).length === 0 ? (
                                        <div style={styles.hint}>este material não tem parâmetros ajustáveis</div>
                                    ) : (
                                        <ExposedParams definition={definition} edit={active.edit} onLit={setLit} />
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <PanelTab label="◂ Inspetor" onClick={() => setInspector(true)} style={{ top: 40, right: 8 }} />
            )}
            {!dock && <PanelTab label="Nós ▴" onClick={() => setDock(true)} style={{ bottom: 0, left: 8 }} />}
            {/* Oculto, o painel de nós fica montado: o grafo guarda a posição, os nós abertos e o escolhido. */}
            <div
                style={{ ...styles.dock, height, display: dock ? 'flex' : 'none' }}
                onKeyDown={keepKeys}
            >
                <div
                    title="arrastar muda a altura do painel"
                    style={styles.grip}
                    onPointerDown={(e) => {
                        resize.current = { y: e.clientY, from: height };
                        e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                        const r = resize.current;
                        if (r === null) return;
                        const top = Math.max(120, window.innerHeight - 60);
                        setHeight(Math.round(Math.min(top, Math.max(120, r.from + r.y - e.clientY))));
                    }}
                    onPointerUp={() => {
                        resize.current = null;
                    }}
                    onPointerCancel={() => {
                        resize.current = null;
                    }}
                />
                <div style={{ ...styles.top, padding: '0 10px' }}>
                    <strong>Nós{name !== undefined ? ` de ${name}` : ''}</strong>
                    <HideButton onClick={() => setDock(false)} />
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: '6px 10px 8px' }}>
                    {definition === undefined ? (
                        <div style={styles.hint}>escolha um material para ver os nós dele</div>
                    ) : !hasGraph ? (
                        <div style={styles.hint}>este material não é um sub-grafo de nós</div>
                    ) : (
                        <GraphView
                            key={name}
                            root={definition}
                            lit={lit}
                            edit={active?.edit}
                            picked={picked}
                            onPick={setPicked}
                            onSelect={setSelection}
                        />
                    )}
                </div>
            </div>
        </>
    );
}

const font = '12px/1.4 system-ui, -apple-system, sans-serif';

const styles = {
    inspector: {
        position: 'fixed',
        top: 40,
        right: 8,
        width: INSPECTOR_W,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 48px - var(--dock, 0px))',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(12, 12, 18, 0.9)',
        color: '#ddd',
        font,
        zIndex: 10,
    },
    dock: {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'column',
        boxSizing: 'border-box',
        background: 'rgba(12, 12, 18, 0.94)',
        borderTop: '1px solid #2a2a36',
        color: '#ddd',
        font,
        zIndex: 12,
    },
    grip: { height: 7, flex: 'none', cursor: 'ns-resize', background: '#1f1f2c', touchAction: 'none' },
    top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 },
    section: { color: '#8cf', fontWeight: 600 },
    hint: { color: '#888', fontSize: 11, margin: '2px 0' },
    thumb: {
        width: THUMB,
        height: THUMB,
        flex: 'none',
        borderRadius: 6,
        border: '1px solid #2a2a36',
        background: '#000',
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
