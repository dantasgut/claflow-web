import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import * as clayflow from 'clayflow/web';
import type { Application } from 'clayflow/web';

/** A taxa de quadros (canto superior direito): os quadros completos no último segundo. */
export function FpsCounter({ app }: { readonly app: Application }) {
    const [fps, setFps] = useState(0);
    useEffect(() => {
        let frames = 0;
        let t0 = performance.now();
        const off = app.events.on('frameComplete', () => {
            frames++;
        });
        const timer = setInterval(() => {
            const now = performance.now();
            setFps((frames * 1000) / (now - t0));
            frames = 0;
            t0 = now;
        }, 500);
        return () => {
            off?.();
            clearInterval(timer);
        };
    }, [app]);
    return (
        <div style={styles.fps}>
            {fps.toFixed(0)} FPS · {fps > 0 ? (1000 / fps).toFixed(1) : '–'} ms
        </div>
    );
}

/** O que o painel acha na cena: as cáusticas (na cena com o primeiro transmissivo) e a primeira luz direcional. */
interface Found {
    readonly caustics: clayflow.CausticsSettings | undefined;
    readonly sun: clayflow.DirectionalLight | undefined;
}

function findInScene(app: Application): Found {
    const renderer = app.defaults.renderer;
    const caustics =
        app.world.entityIdOfResource(renderer.causticsResource) === undefined ? undefined : renderer.caustics;
    let sun: clayflow.DirectionalLight | undefined;
    for (const record of app.world.allRecords()) {
        for (const r of record.resources) {
            if (sun === undefined && r instanceof clayflow.DirectionalLight) sun = r;
        }
    }
    return { caustics, sun };
}

/**
 * A intensidade com que a cena montou cada luz (a primeira lida): os controles são relativos a ela — a cena pode estar
 * em unidades relativas (1,2) ou reais (100 000 lux com o céu físico).
 */
const initial = new WeakMap<object, number>();
function initialOf(owner: object, current: number): number {
    let v = initial.get(owner);
    if (v === undefined) {
        v = current > 0 ? current : 1;
        initial.set(owner, v);
    }
    return v;
}

/** A exposição com que a cena montou a imagem (a primeira lida): o controle soma a ela. */
const baseExposure = new WeakMap<object, number>();
function baseExposureOf(owner: { readonly data: { readonly exposure: number } }): number {
    let v = baseExposure.get(owner);
    if (v === undefined) {
        v = owner.data.exposure;
        baseExposure.set(owner, v);
    }
    return v;
}

/** Azimute e elevação (graus) da direção para onde a luz aponta. */
function anglesOf(direction: readonly number[]): [number, number] {
    const [x, y, z] = [-(direction[0] ?? 0), -(direction[1] ?? -1), -(direction[2] ?? 0)];
    const len = Math.hypot(x, y, z) || 1;
    const elevation = (Math.asin(Math.max(-1, Math.min(1, y / len))) * 180) / Math.PI;
    const azimuth = ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360;
    return [azimuth, elevation];
}

function directionOf(azimuth: number, elevation: number): number[] {
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    return [-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a), 0];
}

/**
 * As escritas nos recursos do motor (fora do componente: são objetos do motor, mudados em tempo real por design, não
 * estado do React). O motor percebe a mudança pelo `data` de cada recurso.
 */
const engine = {
    refraction(app: Application, on: boolean): void {
        app.defaults.renderer.lightPaths.refraction = on;
    },
    interfaces(app: Application, n: number): void {
        app.defaults.renderer.lightPaths.transmission = n;
    },
    denoise(app: Application, on: boolean): void {
        app.defaults.renderer.temporalFilter.enabled = on;
    },
    caustics(c: clayflow.CausticsSettings, on: boolean): void {
        c.enabled = on;
    },
    sunIntensity(sun: clayflow.DirectionalLight, v: number): void {
        sun.data.intensity = v;
    },
    sunDirection(sun: clayflow.DirectionalLight, azimuth: number, elevation: number): void {
        sun.data.direction = directionOf(azimuth, elevation);
    },
    sky(app: Application, v: number): void {
        app.defaults.ambient.data.intensity = v;
    },
    background(app: Application, on: boolean): void {
        app.defaults.ambient.background = on;
    },
    profile(app: Application, p: clayflow.RenderProfile): void {
        app.defaults.renderer.profile = p;
    },
    exposure(app: Application, v: number): void {
        app.defaults.renderer.output.data.exposure = v;
    },
};

/** O painel de parâmetros (canto superior esquerdo; `P` ou o título recolhe): refração, cáusticas, luz, ambiente, tom. */
export function ScenePanel({ app }: { readonly app: Application }) {
    const [open, setOpen] = useState(true);
    const [found, setFound] = useState<Found>(() => findInScene(app));
    const [, redraw] = useState(0);
    const refresh = () => redraw((n) => n + 1);
    useEffect(() => {
        // As cáusticas entram por evento quando a cena recebe um transmissivo: procura de novo até achar.
        const timer = setInterval(() => {
            const next = findInScene(app);
            setFound((prev) =>
                prev.caustics === next.caustics && prev.sun === next.sun ? prev : next,
            );
        }, 1000);
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'KeyP') setOpen((o) => !o);
        };
        window.addEventListener('keydown', onKey);
        return () => {
            clearInterval(timer);
            window.removeEventListener('keydown', onKey);
        };
    }, [app]);

    const { renderer, ambient } = app.defaults;
    const presentation = renderer.output;
    const { caustics, sun } = found;
    const [azimuth, elevation] = sun === undefined ? [0, 90] : anglesOf(sun.data.direction);

    return (
        <div style={styles.panel}>
            <div style={styles.title} onClick={() => setOpen((o) => !o)}>
                {open ? '▾' : '▸'} Parâmetros <span style={styles.hint}>(P)</span>
            </div>
            {open && (
                <>
                    <Section title="Refração">
                        <Toggle
                            label="ligada"
                            value={renderer.lightPaths.refraction}
                            set={(v) => {
                                engine.refraction(app, v);
                                refresh();
                            }}
                        />
                        <Slider
                            label="interfaces por caminho"
                            min={1}
                            max={32}
                            step={1}
                            value={renderer.lightPaths.transmission}
                            set={(v) => {
                                engine.interfaces(app, v);
                                refresh();
                            }}
                        />
                        <Toggle
                            label="filtro do sinal traçado"
                            value={app.defaults.renderer.temporalFilter.enabled}
                            set={(v) => {
                                engine.denoise(app, v);
                                refresh();
                            }}
                        />
                    </Section>
                    <Section title="Cáusticas">
                        {caustics === undefined ? (
                            <div style={styles.hint}>sem cáusticas na cena</div>
                        ) : (
                            <>
                                <Toggle
                                    label="ligadas"
                                    value={caustics.enabled}
                                    set={(v) => {
                                        engine.caustics(caustics, v);
                                        refresh();
                                    }}
                                />
                                <div style={styles.hint}>{caustics.photons.toLocaleString('pt-BR')} fótons por quadro</div>
                            </>
                        )}
                    </Section>
                    <Section title="Luz direcional">
                        {sun === undefined ? (
                            <div style={styles.hint}>sem luz direcional na cena</div>
                        ) : (
                            <>
                                <Slider
                                    label="intensidade (× a da cena)"
                                    min={0}
                                    max={4}
                                    step={0.05}
                                    value={sun.data.intensity / initialOf(sun, sun.data.intensity)}
                                    set={(v) => {
                                        engine.sunIntensity(sun, v * initialOf(sun, sun.data.intensity));
                                        refresh();
                                    }}
                                />
                                <Slider
                                    label="azimute (°)"
                                    min={0}
                                    max={360}
                                    step={1}
                                    value={azimuth}
                                    set={(v) => {
                                        engine.sunDirection(sun, v, elevation);
                                        refresh();
                                    }}
                                />
                                <Slider
                                    label="elevação (°)"
                                    min={5}
                                    max={90}
                                    step={1}
                                    value={elevation}
                                    set={(v) => {
                                        engine.sunDirection(sun, azimuth, v);
                                        refresh();
                                    }}
                                />
                            </>
                        )}
                    </Section>
                    <Section title="Ambiente">
                        <Slider
                            label="intensidade do céu (× a da cena)"
                            min={0}
                            max={4}
                            step={0.05}
                            value={ambient.data.intensity / initialOf(ambient, ambient.data.intensity)}
                            set={(v) => {
                                engine.sky(app, v * initialOf(ambient, ambient.data.intensity));
                                refresh();
                            }}
                        />
                        <Toggle
                            label="céu ao fundo"
                            value={ambient.background}
                            set={(v) => {
                                engine.background(app, v);
                                refresh();
                            }}
                        />
                    </Section>
                    <Section title="Imagem">
                        <Slider
                            label="exposição (EV, + a da cena)"
                            min={-4}
                            max={4}
                            step={0.1}
                            value={presentation.data.exposure - baseExposureOf(presentation)}
                            set={(v) => {
                                engine.exposure(app, v + baseExposureOf(presentation));
                                refresh();
                            }}
                        />
                    </Section>
                    <Section title="Desempenho">
                        <label style={styles.row}>
                            perfil
                            <select
                                value={renderer.profile}
                                onChange={(e) => {
                                    engine.profile(app, e.target.value as clayflow.RenderProfile);
                                    refresh();
                                }}
                            >
                                <option value="high">alto</option>
                                <option value="medium">médio</option>
                                <option value="low">baixo</option>
                            </select>
                        </label>
                        <StageTimes app={app} />
                    </Section>
                    <div style={styles.hint}>Espaço: pausa · arrastar: girar · roda: aproximar</div>
                </>
            )}
        </div>
    );
}

/**
 * O tempo de GPU de cada estágio (a média do último meio segundo, pelos escopos da C2): liga a medida por passe enquanto
 * aberta. No Apple os carimbos por passe deixam os passes de desenho mais lentos — a tabela compara estágios, não mede o
 * quadro (o contador de FPS sem ela é o tempo real).
 */
function StageTimes({ app }: { readonly app: Application }) {
    const [on, setOn] = useState(false);
    const [rows, setRows] = useState<readonly (readonly [string, number])[]>([]);
    useEffect(() => {
        if (!on) return;
        app.setProfiling('passes', 2048);
        const sum = new Map<string, number>();
        let frames = 0;
        const off = app.events.on('gpuFrameTimed', (e) => {
            frames++;
            for (const [flow, ms] of Object.entries(e.flowsMs)) sum.set(flow, (sum.get(flow) ?? 0) + ms);
        });
        const timer = setInterval(() => {
            if (frames === 0) return;
            setRows([...sum].map(([k, v]) => [k, v / frames] as const).sort((a, b) => b[1] - a[1]).slice(0, 12));
            sum.clear();
            frames = 0;
        }, 500);
        return () => {
            off?.();
            clearInterval(timer);
            app.setProfiling(false);
        };
    }, [app, on]);
    return (
        <>
            <Toggle label="tempos por estágio (GPU)" value={on} set={setOn} />
            {on &&
                rows.map(([flow, ms]) => (
                    <div key={flow} style={styles.sliderLabel}>
                        <span>{flow}</span>
                        <span style={styles.value}>{ms.toFixed(2)} ms</span>
                    </div>
                ))}
            {on && <div style={styles.hint}>com os carimbos por passe o desenho fica mais lento no Apple</div>}
        </>
    );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <div style={styles.section}>
            <div style={styles.sectionTitle}>{title}</div>
            {children}
        </div>
    );
}

function Toggle(props: { readonly label: string; readonly value: boolean; readonly set: (v: boolean) => void }) {
    return (
        <label style={styles.row}>
            <input type="checkbox" checked={props.value} onChange={(e) => props.set(e.target.checked)} />
            <span>{props.label}</span>
        </label>
    );
}

function Slider(props: {
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly value: number;
    readonly set: (v: number) => void;
}) {
    return (
        <label style={styles.slider}>
            <span style={styles.sliderLabel}>
                {props.label}
                <span style={styles.value}>{Number.isInteger(props.step) ? props.value.toFixed(0) : props.value.toFixed(2)}</span>
            </span>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step}
                value={props.value}
                onChange={(e) => props.set(Number(e.target.value))}
                // As teclas do painel não chegam à cena (o Espaço pausa).
                onKeyDown={(e) => e.stopPropagation()}
            />
        </label>
    );
}

const font = '12px system-ui, -apple-system, sans-serif';

const styles = {
    fps: {
        position: 'fixed',
        top: 8,
        right: 8,
        padding: '4px 8px',
        borderRadius: 4,
        background: 'rgba(0, 0, 0, 0.6)',
        color: '#9f9',
        font: `bold 13px ui-monospace, monospace`,
        pointerEvents: 'none',
        zIndex: 10,
    },
    panel: {
        position: 'fixed',
        top: 8,
        left: 8,
        width: 240,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(12, 12, 18, 0.85)',
        color: '#ddd',
        font,
        zIndex: 10,
    },
    title: { fontWeight: 600, cursor: 'pointer', userSelect: 'none' },
    hint: { color: '#888', fontSize: 11, margin: '2px 0' },
    section: { marginTop: 10 },
    sectionTitle: { color: '#8cf', fontWeight: 600, marginBottom: 4 },
    row: { display: 'flex', gap: 6, alignItems: 'center', margin: '3px 0' },
    slider: { display: 'flex', flexDirection: 'column', margin: '4px 0' },
    sliderLabel: { display: 'flex', justifyContent: 'space-between' },
    value: { color: '#fff', fontVariantNumeric: 'tabular-nums' },
} as const satisfies Record<string, CSSProperties>;
