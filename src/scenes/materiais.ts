// As cenas dos vídeos da biblioteca de materiais (spec 011, T112): os quadros da galeria do smoke `materials` do motor
// (as mesmas cenas, luzes e escalas: `src/__smokes__/materials.ts`, o caso `gallery`) com a câmera orbitando devagar e
// a luz dando a volta — `materiais-metais`, `materiais-madeiras`, `materiais-translucidos`, `materiais-relevo` —, e um
// material com os valores do grafo mudando a cada quadro — `editado-pinho`, `editado-pintura`, `editado-verniz`,
// `editado-mistura`. Os valores mudam pelo registro de parâmetros da função (`values`), sem recompilar.
import {
    BoxGeometry,
    Camera,
    DirectionalLight,
    Displacements,
    FontLoader,
    GlobalIllumination,
    Materials,
    MeshGeometry,
    nodes,
    ParametricSurface,
    PlaneGeometry,
    RectLight,
    Sky,
    SphereGeometry,
    StandardMaterial,
    SurfaceFunction,
    Transform,
    UiPanel,
    UiText,
} from 'clayflow/web';
import type { Application, MaterialFunction, MaterialName } from 'clayflow/web';
import type { Shot } from './catalog';
import { H, W } from './size';
import { materialGraph } from './support/materialScenes';

type Vec3 = readonly [number, number, number];
type Values = Record<string, number | number[]>;
/** Uma função de extensão com o registro de parâmetros (o material e o deslocamento). */
export interface Valued {
    readonly params: Readonly<Record<string, unknown>>;
    readonly values: Record<string, unknown>;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const unit3 = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
};
/** Giro em torno do eixo y. */
const turn = (v: Vec3, a: number): Vec3 => [
    v[0] * Math.cos(a) + v[2] * Math.sin(a),
    v[1],
    -v[0] * Math.sin(a) + v[2] * Math.cos(a),
];
const DEG = Math.PI / 180;
const smooth = (t: number): number => {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// ── A galeria do smoke `materials` (as mesmas constantes) ───────────────────────────────────────────────────────────
/** Unidades por metro: as contas de 2 cm dos materiais com subsuperfície e as bolas de 20 cm dos de relevo. */
const GALLERY_SCALE = 55;
const RELIEF_SCALE = 5.5;
const BARK_SCALE = 3.5;
const GALLERY_R = 0.55;
const GALLERY_PLAIN_R = 0.68;
const GALLERY_PLAIN_Z = [-1.55, 1.3] as const;
const GALLERY_DX = 1.6;
const GALLERY_DZ = 1.2;
const GALLERY_EYE: Vec3 = [0, 5.2, 8.23];
const GALLERY_TARGET: Vec3 = [0, 0.45, 0];
const GALLERY_FOV = 21 * DEG;
const GALLERY_SUN: Vec3 = [0.45, 0.8, 0.55];
const GALLERY_RIM: Vec3 = [-0.65, 0.22, -0.72];
const GALLERY_PANEL_TARGET: Vec3 = [0, 0.6, 0];
const GALLERY_STUDIO_AMBIENT = 0.08;
const POLE_TILT = 35 * DEG;
const RELIEF_KEY: Vec3 = [-0.5, 0.2, 0.84];
const PINE_KEY: Vec3 = [-0.4, 0.9, -0.05];
const RELIEF_MESH = { patches: [32, 16], maxLevel: 5, screen: 0.0022 } as const;
const SSS_BACK: Vec3 = [-0.22, 0.42, -0.88];
const SSS_SIDE: Vec3 = [-0.85, 0.35, 0.4];
const SSS_CANDLE = 0.44;
const SSS_MARBLE = 0.0825;
const SSS_JADE = 0.11;

interface StudioPanel {
    readonly at: Vec3;
    readonly size: readonly [number, number];
    readonly luminance: number;
}
const GALLERY_PANELS: readonly StudioPanel[] = [
    { at: [-3.2, 4.6, 3.4], size: [4, 1.8], luminance: 7 },
    { at: [3.8, 2.6, 2.2], size: [2.2, 1.4], luminance: 5 },
    { at: [0.6, 5.2, -3.6], size: [4.4, 1], luminance: 6 },
];

/** A esfera de parametrização frontal da galeria (o uv não aperta nos polos). */
const FRONT_SPHERE_CODE = `fn surface_fn(u: f32, v: f32, time: f32, data: SurfaceFnParams) -> vec3f {
    let a = clamp(2.0 * u - 1.0, -1.0, 1.0);
    let b = clamp(2.0 * v - 1.0, -1.0, 1.0);
    let d = vec2f(a * sqrt(1.0 - 0.5 * b * b), b * sqrt(1.0 - 0.5 * a * a));
    let r2 = min(dot(d, d), 1.0);
    let k = 2.0 * sqrt(1.0 - r2);
    return data.radius * vec3f(d.x * k, d.y * k, 1.0 - 2.0 * r2);
}`;

/** Os valores de um material pronto na galeria: as repetições do padrão e a escala do mundo, nos que os expõem. */
function galleryValues(name: MaterialName, pattern: readonly [number, number], radius: number): Values {
    const params = nodes.material[name].params;
    const scale = 'radius' in params ? GALLERY_SCALE : RELIEF_SCALE;
    return {
        ...('pattern_scale' in params ? { pattern_scale: [...pattern] } : {}),
        ...('scale' in params ? { scale } : {}),
        // Uma unidade do padrão em metros (os flocos da pintura): meia volta da esfera, a 5,5 unidades por metro.
        ...('pattern_size' in params ? { pattern_size: (Math.PI * radius) / RELIEF_SCALE } : {}),
    };
}

/** Difuso de cor uniforme (o chão e o fundo neutros). */
function neutral(value: number): MaterialFunction {
    return materialGraph(
        { d: nodes.bsdf.diffuse.with({ color: [value, value, value * 0.98] }) },
        [],
        'd.value',
    );
}

/** O chão (em `y`) e a parede do fundo, neutros. */
function backdrop(app: Application, y: number, ground: number, wall = ground): void {
    app.world.insert(
        new PlaneGeometry({ size: [40, 40] })
            .add(new StandardMaterial())
            .add(new Transform({ position: [0, y, 0, 1] }))
            .add(neutral(ground)),
    );
    app.world.insert(
        new PlaneGeometry({ size: [40, 20] })
            .add(new StandardMaterial())
            .add(
                new Transform({
                    position: [0, 5, -6, 1],
                    rotation: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)],
                }),
            )
            .add(neutral(wall)),
    );
}

/** A câmera da galeria, a `distance` vezes a distância do quadro; devolve a órbita (o ângulo em torno do alvo). */
function galleryCamera(app: Application, distance = 1): (angle: number) => Vec3 {
    const arm = sub3(GALLERY_EYE, GALLERY_TARGET).map((c) => c * distance) as unknown as Vec3;
    const at = (angle: number): Vec3 => {
        const r = turn(arm, angle);
        return [GALLERY_TARGET[0] + r[0], GALLERY_TARGET[1] + r[1], GALLERY_TARGET[2] + r[2]];
    };
    const eye = at(0);
    const view = new Transform({
        position: [...eye, 1],
        rotation: Transform.lookRotation([...eye], [...GALLERY_TARGET]),
    });
    app.world.insert(
        new Camera({
            projection: 'perspective',
            fov: GALLERY_FOV,
            aspect: W / H,
            aspectMode: 'fixed',
            near: 0.5,
            far: 60,
        }).add(view),
    );
    return (angle) => {
        const p = at(angle);
        view.data.position = [...p, 1];
        view.data.rotation = Transform.lookRotation([...p], [...GALLERY_TARGET]);
        return p;
    };
}

/** Pixel do ponto de mundo `p` na câmera em `eye` olhando o alvo da galeria. */
function pixel(p: Vec3, eye: Vec3): [number, number] {
    const f = unit3(sub3(GALLERY_TARGET, eye));
    const r = unit3(cross3(f, [0, 1, 0]));
    const u = cross3(r, f);
    const d = sub3(p, eye);
    const focal = H / 2 / Math.tan(GALLERY_FOV / 2);
    const z = dot3(d, f);
    return [W / 2 + (focal * dot3(d, r)) / z, H / 2 - (focal * dot3(d, u)) / z];
}

/**
 * Os rótulos e o painel de valores, pelo texto da interface do motor (`UiText` sobre `UiPanel`, com o atlas do
 * `FontLoader`): `label` prende um nome a um ponto do mundo, `place` os reposiciona para a câmera do quadro e `hud`
 * devolve quem escreve o painel fixo do canto.
 */
function overlay(app: Application): {
    label(text: string, anchor: Vec3): void;
    place(eye: Vec3): void;
    hud(lines: number): (text: string) => void;
} {
    const size = 22;
    const pad = 7;
    let advance: ((ch: string) => number) | undefined;
    let failure: string | undefined;
    const labels: { text: string; anchor: Vec3; panel: UiPanel; ui: UiText }[] = [];
    const panelOf = (text: string): { panel: UiPanel; ui: UiText } => {
        const panel = new UiPanel();
        panel.background = [0.04, 0.04, 0.05, 0.78];
        panel.visible = false;
        const ui = new UiText();
        ui.text = text;
        ui.fontSize = size;
        ui.color = [1, 1, 1, 1];
        panel.add(ui);
        app.defaults.ui.ui.add(panel);
        return { panel, ui };
    };
    new FontLoader()
        .load('Helvetica Neue, Arial, sans-serif', '', { fontSize: 2 * size })
        .then((font) => {
            app.defaults.ui.setFont(font);
            advance = (ch) => (font.glyphs.get(ch)?.advance ?? size) / 2;
        })
        .catch((e: unknown) => {
            failure = String(e);
        });
    return {
        label(text, anchor) {
            labels.push({ text, anchor, ...panelOf(text) });
        },
        place(eye) {
            if (failure !== undefined) throw new Error(`fonte dos rótulos: ${failure}`);
            if (advance === undefined) return;
            for (const { text, anchor, panel, ui } of labels) {
                const [x, y] = pixel(anchor, eye);
                let width = 0;
                for (const ch of text) width += advance(ch);
                panel.bounds = {
                    x: Math.round(Math.min(Math.max(x - width / 2 - pad, 4), W - width - 2 * pad - 4)),
                    y: Math.round(Math.min(Math.max(y - size / 2 - pad, 4), H - size - 2 * pad - 6)),
                    width: Math.round(width + 2 * pad),
                    height: size + 2 * pad,
                };
                ui.bounds = {
                    x: panel.bounds.x + pad,
                    y: panel.bounds.y + pad - 2,
                    width: 0,
                    height: size,
                };
                panel.visible = true;
            }
        },
        hud(lines) {
            const { panel, ui } = panelOf('');
            const line = Math.round(size * 1.3);
            panel.bounds = { x: 28, y: 28, width: 500, height: lines * line + 2 * pad + 4 };
            ui.bounds = { x: 28 + pad + 4, y: 28 + pad, width: 0, height: size };
            return (text) => {
                if (failure !== undefined) throw new Error(`fonte dos rótulos: ${failure}`);
                ui.text = text;
                panel.visible = advance !== undefined;
            };
        },
    };
}

/** Uma peça: o material, o centro, o raio e, nas de relevo, a malha adaptativa com o deslocamento. */
interface Piece {
    readonly name: MaterialName;
    readonly at: Vec3;
    readonly radius: number;
    /** Valores a mais do material (por cima dos da galeria). */
    readonly values?: Values;
    /** O relevo na geometria (`Displacements.<nome>` numa `ParametricSurface`), com a escala e o padrão dados. */
    readonly displaced?: { readonly scale: number; readonly pattern: readonly [number, number] };
    /** A esfera de parametrização frontal (com `displaced`). */
    readonly front?: boolean;
}

/** Põe a peça na cena; devolve o material e o deslocamento (para mudar os valores depois). */
function ball(app: Application, piece: Piece): { material: Valued; displacement?: Valued } {
    const { name, at, radius: R } = piece;
    const tilt = [Math.sin(-POLE_TILT / 2), 0, 0, Math.cos(-POLE_TILT / 2)];
    if (piece.displaced === undefined) {
        const material = Materials[name]({ ...galleryValues(name, [2, 1], R), ...piece.values });
        app.world.insert(
            new SphereGeometry({ radius: R, latSegments: 96, lonSegments: 192 })
                .add(new StandardMaterial())
                .add(new Transform({ position: [...at, 1], rotation: tilt }))
                .add(material),
        );
        return { material: material as unknown as Valued };
    }
    // O padrão maciço (a posição no objeto) tem uma escala só; o do uv, uma por eixo.
    const solid = nodes.material[name].params.pattern_scale?.type === 'f32';
    const values: Values = {
        pattern_scale: solid ? piece.displaced.pattern[0] : [...piece.displaced.pattern],
        scale: piece.displaced.scale,
    };
    const surface =
        piece.front === true
            ? new ParametricSurface({
                  domain: [0, 1, 0, 1],
                  adaptive: { ...RELIEF_MESH, patches: [24, 24], periodic: [false, false] },
              }).add(
                  new SurfaceFunction({
                      code: FRONT_SPHERE_CODE,
                      params: { radius: 'f32' },
                      values: { radius: R },
                  }),
              )
            : new ParametricSurface({ preset: 'sphere', params: [R], adaptive: RELIEF_MESH });
    const material = Materials[name]({ ...values, ...piece.values });
    const displacement = Displacements[name as keyof typeof Displacements](values);
    surface
        .add(new StandardMaterial())
        .add(new Transform({ position: [...at, 1], rotation: tilt }))
        .add(material)
        .add(displacement);
    app.world.insert(surface);
    return {
        material: material as unknown as Valued,
        displacement: displacement as unknown as Valued,
    };
}

/** Muda um valor do registro de parâmetros (sem recompilar); o nome tem de existir. */
function set(fn: Valued, name: string, value: number | number[]): void {
    if (!(name in fn.params))
        throw new Error(`parâmetro '${name}' não existe (há ${Object.keys(fn.params).join(', ')})`);
    fn.values[name] = value;
}

/** Os painéis do estúdio da galeria e o ambiente escuro; devolve o giro deles em torno do meio da cena. */
function studio(app: Application, gain = 1): (angle: number) => void {
    app.defaults.ambient.data.skyColor = [1, 1, 1, 1];
    app.defaults.ambient.data.groundColor = [1, 1, 1, 1];
    app.defaults.ambient.data.intensity = GALLERY_STUDIO_AMBIENT * gain;
    const lights = GALLERY_PANELS.map((panel) => {
        const aim = unit3(sub3(GALLERY_PANEL_TARGET, panel.at));
        const light = new RectLight({
            position: [...panel.at, 1],
            direction: [...aim, 0],
            right: cross3(aim, [0, 1, 0]),
            size: panel.size,
            intensity: panel.luminance * gain,
        });
        app.world.insert(light);
        const d = light.data.direction;
        const x = light.data.axis;
        return {
            light,
            at: panel.at,
            normal: [d[0]!, d[1]!, d[2]!] as Vec3,
            axis: [x[0]!, x[1]!, x[2]!] as Vec3,
        };
    });
    gi(app);
    return (angle) => {
        for (const { light, at, normal, axis } of lights) {
            light.data.position = [...turn(at, angle), 1];
            light.data.direction = [...turn(normal, angle), 0];
            light.data.axis = [...turn(axis, angle), 0];
        }
    };
}

function gi(app: Application): void {
    app.world.insert(
        new GlobalIllumination({
            quality: 'medium',
            probeSpacing: 0.5,
            center: [0, 0.6, 0],
            screenGather: false,
        }),
    );
}

/** Luz direcional vinda de `from`; devolve quem a muda de lugar. */
function directional(
    app: Application,
    from: Vec3,
    intensity: number,
    castShadow = false,
): { light: DirectionalLight; from(v: Vec3): void } {
    const light = new DirectionalLight({
        direction: [-from[0], -from[1], -from[2], 0],
        intensity,
        ...(castShadow ? { castShadow: true } : {}),
    });
    app.world.insert(light);
    return {
        light,
        from(v) {
            light.data.direction = [-v[0], -v[1], -v[2], 0];
        },
    };
}

/**
 * A luz dos quadros ao sol da galeria: o sol, o céu físico dele, a luz rebatida e a luz de recorte; `castShadow`: o sol
 * projeta sombra (a esfera grande dos trechos do material editado apoia no chão).
 */
function sunlight(app: Application, castShadow = false): void {
    const sun = directional(app, GALLERY_SUN, 3, castShadow);
    app.world.insert(new Sky({ sun: sun.light, sunDisk: false }));
    gi(app);
    directional(app, GALLERY_RIM, 1.2);
}

/** Quadros de cada trecho da galeria (7,5 s a 30 quadros por segundo) e os do aquecimento (as sondas acumulam). */
const GALLERY_FRAMES = 225;
const EDIT_FRAMES = 195;
const WARMUP = 240;
/** A órbita da câmera num trecho: de −14° a +14°. */
const orbit = (t: number): number => mix(-14, 14, t) * DEG;

/** Duas fileiras de esferas no chão dos quadros só de esferas; devolve os centros. */
function rows(
    back: readonly string[],
    front: readonly string[],
    radius: number,
    dx: number,
): Map<string, Vec3> {
    const at = new Map<string, Vec3>();
    [back, front].forEach((row, j) => {
        row.forEach((name, i) => {
            at.set(name, [(i - (row.length - 1) / 2) * dx, radius - 0.1, GALLERY_PLAIN_Z[j]!]);
        });
    });
    return at;
}

/** O ponto do rótulo: na fileira da frente, no chão diante da peça; na de trás, acima dela. */
function anchor(at: Vec3, radius: number, top = at[1] + radius): Vec3 {
    return at[2] > 0 ? [at[0], -0.1, at[2] + radius + 0.42] : [at[0], top + 0.14, at[2]];
}

/** A esfera grande dos trechos do material editado. */
const EDIT_R = 1.05;
const EDIT_AT: Vec3 = [0.55, EDIT_R - 0.1, 1];

const hsv = (h: number, s: number, v: number): number[] => {
    const f = (n: number): number => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
};

// ── A vitrine: todos os materiais da biblioteca, uma cena por família ────────────────────────────────────────────────
/** Uma família da vitrine: a fileira de trás e a da frente. */
interface Showcase {
    readonly back: readonly MaterialName[];
    readonly front: readonly MaterialName[];
}

/** As peças da vitrine com o relevo na geometria (as outras: a esfera pronta, o relevo na normal). */
const SHOWCASE_RELIEF: Partial<Record<MaterialName, NonNullable<Piece['displaced']>>> = {
    woodAshBrushed: { scale: 20, pattern: [1.5, 1.5] },
    woodPineFine: { scale: 20, pattern: [1.2, 1.2] },
    woodSolid: { scale: 20, pattern: [1, 1] },
    bark: { scale: BARK_SCALE, pattern: [1.5, 1.5] },
    barkPine: { scale: BARK_SCALE, pattern: [1.5, 1.5] },
    barkBirch: { scale: RELIEF_SCALE, pattern: [1, 1] },
};

/** As famílias da vitrine: os 75 materiais da biblioteca, cada um numa cena. */
const SHOWCASE: Readonly<Record<string, Showcase>> = {
    metais: {
        back: ['gold', 'copper', 'brass', 'chrome'],
        front: ['aluminiumAnodized', 'metalPolished', 'metalBrushed', 'metalHammered'],
    },
    'metais-acabados': {
        back: ['castIron', 'bronzePatina', 'metalOxidized', 'carbonFiber'],
        front: ['carPaint', 'carPaintSilver', 'carPaintFlake'],
    },
    madeiras: {
        back: ['woodPine', 'woodOak', 'woodWalnut', 'woodMahogany'],
        front: ['woodOakVarnished', 'woodVarnishedGloss', 'woodVarnishedMatte', 'woodRaw'],
    },
    'madeiras-relevo': {
        back: ['woodRough', 'woodAsh', 'woodFloorPlanks', 'woodFloorHerringbone'],
        front: ['woodAshBrushed', 'woodPineFine', 'woodSolid'],
    },
    tecidos: {
        back: ['cotton', 'wool', 'denim', 'sheerFabric'],
        front: ['velvet', 'silk', 'leather', 'paper'],
    },
    pedra: {
        back: ['concrete', 'granite', 'sandstone', 'plaster'],
        front: ['brick', 'tile', 'terracotta', 'asphalt'],
    },
    'terra-plasticos': {
        back: ['driedMud', 'sand', 'roofTile', 'roofSlate'],
        front: ['rubber', 'ceramic', 'plasticMatte', 'plasticGloss'],
    },
    plantas: {
        back: ['bark', 'barkPine', 'barkBirch'],
        front: ['leaf', 'leafMatte', 'leafDry', 'cork', 'corkStopper'],
    },
    translucidos: {
        back: ['glass', 'ice', 'porcelain', 'marble'],
        front: ['skin', 'wax', 'jade', 'milk'],
    },
    organicos: { back: ['skinDetailed', 'eye'], front: ['soap', 'ivory', 'motherOfPearl', 'snow'] },
};

/**
 * A cena de uma família da vitrine: as esferas com o rótulo sob os painéis do estúdio, que dão a volta, mais uma luz
 * direcional com sombra (a subsuperfície e o relevo respondem a ela), a câmera orbitando devagar.
 */
function showcase(family: Showcase): Shot {
    return {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const R = 0.6;
            const move = galleryCamera(app, 1.17);
            const lights = studio(app);
            directional(app, GALLERY_SUN, 1.5, true);
            backdrop(app, -0.1, 0.12);
            const text = overlay(app);
            for (const [name, c] of rows(family.back, family.front, R, 1.45)) {
                const displaced = SHOWCASE_RELIEF[name as MaterialName];
                ball(app, {
                    name: name as MaterialName,
                    at: c,
                    radius: R,
                    ...(displaced !== undefined ? { displaced, front: true } : {}),
                });
                text.label(name, anchor(c, R));
            }
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                lights(2 * Math.PI * t);
                text.place(move(orbit(t)));
            };
        },
    };
}

// ── A pele num rosto: a malha base do MakeHuman (CC0) ───────────────────────────────────────────────────────────────
/** Unidades por metro da cena do rosto: a cabeça de 26 cm com 1,6 unidade de altura. */
const FACE_SCALE = 6.2;
/** Abaixo desta altura (em decímetros, a unidade do arquivo) a malha é o corpo: fica a cabeça com o pescoço. */
const FACE_NECK = 5.9;
const FACE_KEY: Vec3 = [-0.55, 0.45, 0.7];
const FACE_BACK: Vec3 = [0.75, 0.3, -0.6];

/**
 * O globo ocular com a córnea: a esfera de parametrização frontal (o centro do uv voltado para +z, o olhar) com a
 * calota da córnea saliente — o raio cresce `bulge` no eixo do olhar e volta ao do globo onde o seno do ângulo com o
 * eixo chega a `cornea` (a borda da íris).
 */
const EYE_CODE = `fn surface_fn(u: f32, v: f32, time: f32, data: SurfaceFnParams) -> vec3f {
    let a = clamp(2.0 * u - 1.0, -1.0, 1.0);
    let b = clamp(2.0 * v - 1.0, -1.0, 1.0);
    let d = vec2f(a * sqrt(1.0 - 0.5 * b * b), b * sqrt(1.0 - 0.5 * a * a));
    let r2 = min(dot(d, d), 1.0);
    let k = 2.0 * sqrt(1.0 - r2);
    let dir = vec3f(d.x * k, d.y * k, 1.0 - 2.0 * r2);
    let w = 1.0 - smoothstep(0.0, data.cornea, length(dir.xy));
    let lift = select(0.0, data.bulge * w * w, dir.z > 0.0);
    return data.radius * (1.0 + lift) * dir;
}`;

/** A posição no objeto de um ponto da malha do MakeHuman (em decímetros no arquivo). */
const facePoint = (x: number, y: number, z: number): Vec3 => {
    const k = FACE_SCALE / 10;
    return [x * k, (y - FACE_NECK) * k, (z - 0.6) * k];
};
/** O centro e o raio dos globos oculares na malha (os grupos `helper-l-eye` e `helper-r-eye`). */
const FACE_EYES: readonly Vec3[] = [facePoint(0.308, 7.284, 1.245), facePoint(-0.308, 7.284, 1.245)];
const FACE_EYE_RADIUS = (0.138 * FACE_SCALE) / 10;

/**
 * A pele do rosto: `skinDetailed` com as entradas por região ligadas a máscaras na posição do objeto — o sangue mais
 * perto da superfície nas bochechas, no nariz e nas orelhas; o óleo na testa e no nariz; os lábios mais vermelhos,
 * mais escuros e mais brilhantes. Cada máscara: 1 dentro do raio interno em volta do ponto, 0 fora do externo.
 */
function faceSkin(values: Values): MaterialFunction {
    const graph: Record<string, unknown> = {
        s: nodes.input.surfaceSample(),
        skin: nodes.material.skinDetailed.with({ scale: FACE_SCALE, ...values }),
    };
    const links: [string, string][] = [];
    /** Soma `weight` × máscara em volta de `at` (esticada por `stretch`) ao acumulador `to`; devolve a saída. */
    const blob = (
        id: string,
        at: Vec3,
        inner: number,
        outer: number,
        stretch: Vec3 = [1, 1, 1],
    ): string => {
        graph[`${id}_k`] = nodes.math.value3.with({ value: [...stretch] });
        graph[`${id}_p`] = nodes.math.mul3;
        graph[`${id}_c`] = nodes.math.value3.with({
            value: [at[0] * stretch[0], at[1] * stretch[1], at[2] * stretch[2]],
        });
        graph[`${id}_d`] = nodes.math.distance;
        graph[id] = nodes.map.range.with({ in_min: outer, in_max: inner, out_min: 0, out_max: 1 });
        links.push(
            ['s.object_position', `${id}_p.a`],
            [`${id}_k.value`, `${id}_p.b`],
            [`${id}_p.value`, `${id}_d.a`],
            [`${id}_c.value`, `${id}_d.b`],
            [`${id}_d.value`, `${id}.x`],
        );
        return `${id}.value`;
    };
    /** 1 + a soma das máscaras pesadas. */
    const total = (id: string, parts: readonly (readonly [string, number])[]): string => {
        graph[`${id}_one`] = nodes.math.value.with({ value: 1 });
        let last = `${id}_one.value`;
        parts.forEach(([mask, weight], i) => {
            const scaled = `${id}_m${i}`;
            const sum = `${id}_s${i}`;
            graph[`${id}_w${i}`] = nodes.math.value.with({ value: weight });
            graph[scaled] = nodes.math.mul;
            graph[sum] = nodes.math.add;
            links.push(
                [mask, `${scaled}.a`],
                [`${id}_w${i}.value`, `${scaled}.b`],
                [`${scaled}.value`, `${sum}.a`],
                [last, `${sum}.b`],
            );
            last = `${sum}.value`;
        });
        return last;
    };
    const cheekL = blob('cheek_l', facePoint(0.5, 6.85, 1.25), 0.05, 0.3);
    const cheekR = blob('cheek_r', facePoint(-0.5, 6.85, 1.25), 0.05, 0.3);
    const nose = blob('nose', facePoint(0, 6.93, 1.62), 0.03, 0.16);
    const earL = blob('ear_l', facePoint(0.85, 7.2, 0.35), 0.06, 0.26);
    const earR = blob('ear_r', facePoint(-0.85, 7.2, 0.35), 0.06, 0.26);
    const brow = blob('brow', facePoint(0, 7.85, 1.4), 0.1, 0.42);
    const lips = blob('lips', facePoint(0, 6.6, 1.58), 0.08, 0.2, [1, 2.8, 1]);
    // O contorno dos olhos: a pele fina das pálpebras, mais vermelha e mais escura.
    const socketL = blob('socket_l', facePoint(0.31, 7.27, 1.3), 0.07, 0.2, [1, 1.5, 1]);
    const socketR = blob('socket_r', facePoint(-0.31, 7.27, 1.3), 0.07, 0.2, [1, 1.5, 1]);
    links.push(
        [
            total('blood', [
                [cheekL, 3],
                [cheekR, 3],
                [nose, 2.4],
                [earL, 3.5],
                [earR, 3.5],
                [lips, 4],
                [socketL, 0.8],
                [socketR, 0.8],
            ]),
            'skin.blood_mask',
        ],
        [
            total('oil', [
                [brow, 0.7],
                [nose, 1],
                [lips, 1.5],
            ]),
            'skin.oil_mask',
        ],
    );
    graph.lip_a = nodes.math.value3.with({ value: [1, 1, 1] });
    graph.lip_b = nodes.math.value3.with({ value: [0.78, 0.44, 0.43] });
    graph.lip = nodes.math.mix3;
    graph.lid_b = nodes.math.value3.with({ value: [0.88, 0.78, 0.76] });
    graph.lid_sum = nodes.math.max;
    graph.lid = nodes.math.mix3;
    links.push(
        ['lip_a.value', 'lip.a'],
        ['lip_b.value', 'lip.b'],
        [lips, 'lip.t'],
        [socketL, 'lid_sum.a'],
        [socketR, 'lid_sum.b'],
        ['lip.value', 'lid.a'],
        ['lid_b.value', 'lid.b'],
        ['lid_sum.value', 'lid.t'],
        ['lid.value', 'skin.tint'],
    );
    return materialGraph(graph as Parameters<typeof materialGraph>[0], links, 'skin.value');
}

/** A cabeça da malha base do MakeHuman, com o material `fn`, e os dois globos oculares; devolve quando entrou. */
function face(app: Application, fn: MaterialFunction, iris: Values): Promise<void> {
    const k = FACE_SCALE / 10;
    const lift = -0.1;
    for (const c of FACE_EYES) {
        app.world.insert(
            new ParametricSurface({
                domain: [0, 1, 0, 1],
                adaptive: { ...RELIEF_MESH, patches: [24, 24], periodic: [false, false] },
            })
                .add(
                    new SurfaceFunction({
                        code: EYE_CODE,
                        params: { radius: 'f32', bulge: 'f32', cornea: 'f32' },
                        values: { radius: FACE_EYE_RADIUS, bulge: 0.11, cornea: 0.52 },
                    }),
                )
                .add(new StandardMaterial())
                .add(new Transform({ position: [c[0], c[1] + lift, c[2], 1] }))
                .add(Materials.eye({ scale: FACE_SCALE, ...iris })),
        );
    }
    return fetch(`${import.meta.env.BASE_URL}models/makehuman-base.obj`)
        .then((response) => {
            if (!response.ok) throw new Error(`rosto: o modelo respondeu ${response.status}`);
            return response.text();
        })
        .then((text) => {
            app.world.insert(
                MeshGeometry.fromObj(text, {
                    groups: ['body'],
                    scale: k,
                    offset: [0, -FACE_NECK * k, -0.6 * k],
                    keep: (_x, y) => y > 0,
                })
                    .add(new StandardMaterial())
                    .add(new Transform({ position: [0, lift, 0, 1] }))
                    .add(fn),
            );
        });
}

/**
 * A cena do rosto: a luz principal de frente e de lado, com sombra, a contraluz por trás da orelha e os painéis do
 * estúdio (o reflexo nos olhos), a câmera orbitando; `close`: a câmera de perto, na altura dos olhos.
 */
function faceShot(skin: Values, iris: Values = {}, close = false, hard = false): Shot {
    return {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const target: Vec3 = close ? [0, 0.72, 0.3] : [0, 0.8, 0];
            const arm: Vec3 = close ? [0, 0.05, 2.1] : [0, 0.15, 4.6];
            const eye = (a: number): Vec3 => {
                const r = turn(arm, a);
                return [target[0] + r[0], target[1] + r[1], target[2] + r[2]];
            };
            const from = eye(0);
            const view = new Transform({
                position: [...from, 1],
                rotation: Transform.lookRotation([...from], [...target]),
            });
            app.world.insert(
                new Camera({
                    projection: 'perspective',
                    fov: 24 * DEG,
                    aspect: W / H,
                    aspectMode: 'fixed',
                    near: 0.3,
                    far: 60,
                }).add(view),
            );
            if (hard) {
                // A luz dura de lado e a contraluz atrás da orelha, quase sem preenchimento: o terminador cruza o
                // rosto e a luz atravessa a orelha — onde o espalhamento sob a pele aparece.
                studio(app, 0.08);
                directional(app, [0.9, 0.3, 0.45], 2.6, true);
                directional(app, [-0.5, 0.3, -0.8], 1.3, true);
            } else {
                // Os painéis a um terço (a luz de preenchimento e o reflexo nos olhos): a principal modela o rosto.
                studio(app, 0.33);
                directional(app, FACE_KEY, 2, true);
                // A contraluz projeta sombra: é do mapa de sombra dela que sai a espessura que a luz atravessa (a orelha).
                directional(app, FACE_BACK, 1.8, true);
                // A caixa de luz do retrato, à frente e acima: a luz macia no rosto e o reflexo dela na córnea.
                const box: Vec3 = [-1.5, 2.1, 3.4];
                const aim = unit3(sub3([0, 0.75, 0.3], box));
                app.world.insert(
                    new RectLight({
                        position: [...box, 1],
                        direction: [...aim, 0],
                        right: cross3(aim, [0, 1, 0]),
                        size: [1.2, 1.2],
                        intensity: 8,
                    }),
                );
            }
            backdrop(app, -0.1, 0.07);
            void face(app, faceSkin(skin), iris);
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                const p = eye(mix(-32, 32, t) * DEG);
                view.data.position = [...p, 1];
                view.data.rotation = Transform.lookRotation([...p], [...target]);
            };
        },
    };
}

// ── A galeria individual: um material por vez, com os valores editáveis ─────────────────────────────────────────────
/** As famílias da galeria (as da vitrine): o nome e os materiais de cada uma. */
export const MATERIAL_FAMILIES: readonly (readonly [string, readonly MaterialName[]])[] = Object.entries(
    SHOWCASE,
).map(([name, family]) => [name, [...family.back, ...family.front]]);

/** O palco de um material: a função do material e a do deslocamento (quando o relevo vai à geometria) e a câmera. */
export interface MaterialStage {
    readonly material: Valued;
    readonly displacement?: Valued;
    /** Os valores que o palco deu ao material (a escala do mundo e a do padrão), por cima dos padrões da biblioteca. */
    readonly staged: Values;
    readonly camera: Camera;
    readonly eye: Vec3;
    readonly target: Vec3;
}

/**
 * Monta o palco do material `name`: uma esfera grande sob os painéis do estúdio e uma luz direcional com sombra, no
 * chão neutro; a esfera é a de malha adaptativa com o deslocamento quando o material tem o relevo na geometria.
 */
export function materialStage(app: Application, name: MaterialName): MaterialStage {
    const R = 1;
    const target: Vec3 = [0, R - 0.1, 0];
    const eye: Vec3 = [0, 2.3, 5.4];
    const camera = new Camera({
        projection: 'perspective',
        fov: 26 * DEG,
        aspect: W / H,
        aspectMode: 'fixed',
        near: 0.3,
        far: 60,
    });
    camera.add(
        new Transform({
            position: [...eye, 1],
            rotation: Transform.lookRotation([...eye], [...target]),
        }),
    );
    app.world.insert(camera);
    studio(app);
    directional(app, GALLERY_SUN, 1.5, true);
    backdrop(app, -0.1, 0.12);
    const displaced = SHOWCASE_RELIEF[name];
    const piece: Piece = {
        name,
        at: [0, R - 0.1, 0],
        radius: R,
        ...(displaced !== undefined ? { displaced, front: true } : {}),
    };
    const made = ball(app, piece);
    const staged: Values =
        displaced !== undefined
            ? {
                  pattern_scale:
                      nodes.material[name].params.pattern_scale?.type === 'f32'
                          ? displaced.pattern[0]
                          : [...displaced.pattern],
                  scale: displaced.scale,
              }
            : galleryValues(name, [2, 1], R);
    return { ...made, staged, camera, eye, target };
}

export const MATERIAL_SHOTS: Record<string, Shot> = {
    // A pele no rosto da malha base do MakeHuman.
    'pele-rosto': faceShot({}),
    'pele-rosto-luz-dura-sem': faceShot({ radius: [0, 0, 0] }, {}, true, true),
    'pele-rosto-luz-dura': faceShot({}, {}, true, true),
    'pele-rosto-perto': faceShot({}, {}, true),
    'pele-rosto-escura': faceShot(
        { melanin: 0.85, blood: 0.3, freckles: 0 },
        { iris_color: [0.16, 0.08, 0.03], iris_edge_color: [0.05, 0.025, 0.01] },
    ),
    // A vitrine: `vitrine-<família>`, todos os materiais.
    ...Object.fromEntries(
        Object.entries(SHOWCASE).map(([name, family]) => [`vitrine-${name}`, showcase(family)]),
    ),
    // Os metais sob os painéis do estúdio da galeria, que dão a volta: os realces correm pelas esferas.
    'materiais-metais': {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const R = 0.6;
            const move = galleryCamera(app, 1.17);
            const lights = studio(app);
            backdrop(app, -0.1, 0.12);
            const text = overlay(app);
            const at = rows(
                ['gold', 'copper', 'metalBrushed', 'metalOxidized'],
                ['metalPolished', 'metalHammered', 'carPaint', 'carPaintSilver'],
                R,
                1.45,
            );
            for (const [name, c] of at) {
                ball(app, { name: name as MaterialName, at: c, radius: R });
                text.label(name, anchor(c, R));
            }
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                lights(2 * Math.PI * t);
                text.place(move(orbit(t)));
            };
        },
    },
    // As madeiras sob os mesmos painéis; o pinho de veio fino e o freixo escovado com o relevo na geometria.
    'materiais-madeiras': {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const R = GALLERY_PLAIN_R;
            const move = galleryCamera(app);
            const lights = studio(app);
            backdrop(app, -0.1, 0.12);
            const text = overlay(app);
            const at = rows(
                ['woodOakVarnished', 'woodMahogany', 'woodWalnut'],
                ['woodPineFine', 'woodFloorHerringbone', 'woodAshBrushed'],
                R,
                GALLERY_DX,
            );
            const relief: Partial<Record<string, Piece['displaced']>> = {
                woodPineFine: { scale: 20, pattern: [1.2, 1.2] },
                woodAshBrushed: { scale: 20, pattern: [1.5, 1.5] },
            };
            for (const [name, c] of at) {
                const displaced = relief[name];
                ball(app, {
                    name: name as MaterialName,
                    at: c,
                    radius: R,
                    ...(displaced !== undefined ? { displaced, front: true } : {}),
                });
                text.label(name, anchor(c, R));
            }
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                lights(2 * Math.PI * t);
                text.place(move(orbit(t)));
            };
        },
    },
    // O quadro da subsuperfície da galeria: a contraluz rasante (com sombra) anda por trás das peças.
    'materiais-translucidos': {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const R = GALLERY_R;
            const move = galleryCamera(app);
            app.defaults.ambient.data.intensity = 0.12;
            const back = directional(app, SSS_BACK, 6, true);
            directional(app, SSS_SIDE, 1.6);
            backdrop(app, 0, 0.18, 0.12);
            const text = overlay(app);
            const front = (i: number): Vec3 => [(i - 1) * GALLERY_DX, R, GALLERY_DZ];
            const rear = (i: number, h: number): Vec3 => [(i - 1) * GALLERY_DX, h / 2, -GALLERY_DZ];
            const sphere = (label: string, c: Vec3, fn: MaterialFunction): void => {
                app.world.insert(
                    new SphereGeometry({ radius: R, latSegments: 96, lonSegments: 192 })
                        .add(new StandardMaterial())
                        .add(new Transform({ position: [...c, 1] }))
                        .add(fn),
                );
                text.label(label, [c[0], 0, c[2] + R + 0.42]);
            };
            const block = (label: string, c: Vec3, size: Vec3, fn: MaterialFunction): void => {
                app.world.insert(
                    new BoxGeometry({ size: [...size] })
                        .add(new StandardMaterial())
                        .add(new Transform({ position: [...c, 1] }))
                        .add(fn),
                );
                text.label(label, [c[0], size[1] + 0.2, c[2]]);
            };
            sphere('wax, raio 0', front(0), Materials.wax({ scale: GALLERY_SCALE, radius: [0, 0, 0] }));
            sphere('wax', front(1), Materials.wax({ scale: GALLERY_SCALE }));
            sphere('skin', front(2), Materials.skin({ scale: GALLERY_SCALE }));
            block(
                'wax (vela, 8 mm)',
                rear(0, 1.7),
                [SSS_CANDLE, 1.7, SSS_CANDLE],
                Materials.wax({ scale: GALLERY_SCALE }),
            );
            block(
                'marble (1.5 mm)',
                rear(1, 1.3),
                [1.2, 1.3, SSS_MARBLE],
                Materials.marble({ scale: GALLERY_SCALE, pattern_scale: [1, 1] }),
            );
            block(
                'jade (2 mm)',
                rear(2, 1.3),
                [1.2, 1.3, SSS_JADE],
                Materials.jade({ scale: GALLERY_SCALE }),
            );
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                back.from(turn(SSS_BACK, mix(40, -45, t) * DEG));
                text.place(move(orbit(t)));
            };
        },
    },
    // O relevo na geometria (malha adaptativa): a luz rasante com sombra vai da esquerda à direita.
    'materiais-relevo': {
        frames: GALLERY_FRAMES,
        warmup: WARMUP,
        build(app) {
            const R = GALLERY_PLAIN_R;
            const move = galleryCamera(app);
            const sun = directional(app, GALLERY_SUN, 1.2);
            app.world.insert(new Sky({ sun: sun.light, sunDisk: false }));
            gi(app);
            const key = directional(app, RELIEF_KEY, 3.5, true);
            backdrop(app, -0.1, 0.12);
            const text = overlay(app);
            const at = rows(
                ['brick', 'driedMud', 'roofTile'],
                ['bark', 'barkPine', 'barkBirch'],
                R,
                GALLERY_DX,
            );
            const relief: Record<string, NonNullable<Piece['displaced']>> = {
                bark: { scale: BARK_SCALE, pattern: [1.5, 1.5] },
                barkPine: { scale: BARK_SCALE, pattern: [1.5, 1.5] },
                barkBirch: { scale: RELIEF_SCALE, pattern: [1, 1] },
            };
            for (const [name, c] of at) {
                const bark = relief[name];
                ball(app, {
                    name: name as MaterialName,
                    at: c,
                    radius: R,
                    displaced: bark ?? { scale: RELIEF_SCALE, pattern: [2, 1] },
                    front: bark !== undefined,
                });
                text.label(name, anchor(c, R));
            }
            return (i) => {
                const t = i / (GALLERY_FRAMES - 1);
                key.from(turn(RELIEF_KEY, mix(-50, 80, t) * DEG));
                text.place(move(orbit(t)));
            };
        },
    },
    // O pinho de veio fino (o quadro `madeira-pinho` da galeria, numa bola só): os anéis, os nós e a altura do relevo
    // mudam — os mesmos valores no material e no deslocamento.
    'editado-pinho': {
        frames: EDIT_FRAMES,
        warmup: WARMUP,
        build(app) {
            galleryCamera(app);
            const sun = directional(app, GALLERY_SUN, 1.2);
            app.world.insert(new Sky({ sun: sun.light, sunDisk: false }));
            const panel = GALLERY_PANELS[0]!;
            const aim = unit3(sub3(GALLERY_PANEL_TARGET, panel.at));
            app.world.insert(
                new RectLight({
                    position: [...panel.at, 1],
                    direction: [...aim, 0],
                    right: cross3(aim, [0, 1, 0]),
                    size: panel.size,
                    intensity: 5,
                }),
            );
            gi(app);
            directional(app, PINE_KEY, 3.5, true);
            backdrop(app, -0.1, 0.3);
            const { material, displacement } = ball(app, {
                name: 'woodPineFine',
                at: EDIT_AT,
                radius: EDIT_R,
                displaced: { scale: 20, pattern: [1.2, 1.2] },
                front: true,
            });
            const write = overlay(app).hud(4);
            return (i) => {
                const t = i / (EDIT_FRAMES - 1);
                const rings = mix(170, 45, smooth(t / 0.34));
                const knots = mix(4.5, 9, smooth((t - 0.34) / 0.3));
                const height = mix(0.5, 2.5, smooth((t - 0.66) / 0.3));
                set(material, 'material_ring_count', rings);
                set(material, 'material_knot_density', knots);
                set(material, 'material_ring_height', height);
                if (displacement !== undefined) {
                    set(displacement, 'relief_ring_count', rings);
                    set(displacement, 'relief_knot_density', knots);
                    set(displacement, 'relief_ring_height', height);
                }
                write(
                    `Materials.woodPineFine\nring_count ${rings.toFixed(0)}\nknot_density ${knots.toFixed(1)}\nring_height ${height.toFixed(2)} mm`,
                );
            };
        },
    },
    // A pintura de carro (o quadro `pintura`): a cor dos flocos dá a volta no matiz e o floco cresce de 15 a 400 µm.
    'editado-pintura': {
        frames: EDIT_FRAMES,
        warmup: WARMUP,
        build(app) {
            galleryCamera(app);
            sunlight(app, true);
            backdrop(app, -0.1, 0.12);
            const { material } = ball(app, { name: 'carPaint', at: EDIT_AT, radius: EDIT_R });
            const write = overlay(app).hud(3);
            return (i) => {
                const t = i / (EDIT_FRAMES - 1);
                const hue = mix(0, 0.64, smooth(t / 0.55));
                const color = hsv(hue, 0.94, 0.56);
                const size = 15 * (400 / 15) ** smooth((t - 0.58) / 0.38);
                set(material, 'material_flake_color', color);
                set(material, 'material_flake_edge_tint', hsv(hue, 0.96, 0.3));
                set(material, 'material_base_color', hsv(hue, 0.97, 0.2));
                set(material, 'material_flake_size', size);
                write(
                    `Materials.carPaint\nflake_color ${color.map((c) => c.toFixed(2)).join(' ')}\nflake_size ${size.toFixed(0)} um`,
                );
            };
        },
    },
    // A madeira envernizada (o quadro `madeira-couro`): a rugosidade do verniz, do brilhante ao fosco.
    'editado-verniz': {
        frames: EDIT_FRAMES,
        warmup: WARMUP,
        build(app) {
            galleryCamera(app);
            sunlight(app, true);
            backdrop(app, -0.1, 0.3);
            const { material } = ball(app, {
                name: 'woodVarnishedGloss',
                at: EDIT_AT,
                radius: EDIT_R,
            });
            const write = overlay(app).hud(2);
            return (i) => {
                const t = i / (EDIT_FRAMES - 1);
                const roughness = mix(0.03, 0.6, smooth((t - 0.08) / 0.84));
                set(material, 'material_coat_roughness', roughness);
                write(`Materials.woodVarnishedGloss\ncoat_roughness ${roughness.toFixed(2)}`);
            };
        },
    },
    // A mistura de dois materiais por ruído (o grafo do `library-compose`), com o limiar da máscara andando.
    'editado-mistura': {
        frames: EDIT_FRAMES,
        warmup: WARMUP,
        build(app) {
            galleryCamera(app);
            sunlight(app, true);
            backdrop(app, -0.1, 0.3);
            const material = materialGraph(
                {
                    s: nodes.input.surfaceSample(),
                    a: nodes.material.woodRaw,
                    b: nodes.material.metalBrushed,
                    n: nodes.noise.gradient3.with({ scale: 3 }),
                    mask: nodes.map.range.with({ in_min: -0.5, in_max: -0.4 }),
                    x: nodes.closure.mix,
                },
                [
                    ['s.world_position', 'n.p'],
                    ['n.value', 'mask.x'],
                    ['a.value', 'x.a'],
                    ['b.value', 'x.b'],
                    ['mask.value', 'x.t'],
                ],
                'x.value',
            );
            app.world.insert(
                new SphereGeometry({ radius: EDIT_R, latSegments: 96, lonSegments: 192 })
                    .add(new StandardMaterial())
                    .add(new Transform({ position: [...EDIT_AT, 1] }))
                    .add(material),
            );
            const fn = material as unknown as Valued;
            const write = overlay(app).hud(3);
            return (i) => {
                const t = i / (EDIT_FRAMES - 1);
                const threshold = mix(-0.45, 0.45, smooth(t));
                set(fn, 'mask_in_min', threshold - 0.05);
                set(fn, 'mask_in_max', threshold + 0.05);
                write(
                    `closure.mix(woodRaw, metalBrushed)\nmascara: noise.gradient3 > limiar\nlimiar ${threshold.toFixed(2)}`,
                );
            };
        },
    },
};
