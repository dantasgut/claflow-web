// Cenas da luz global do app (spec 038: a parte de montagem no motor das cenas dos smokes, sem a referência da CPU):
// placas difusas e emissoras, o sol, o céu físico, a caixa de Cornell, o cômodo com janela e o pano.
import {
    BoxGeometry,
    Camera,
    DirectionalLight,
    GravityField,
    MaterialFunction,
    Sky,
    SoftBody,
    StandardMaterial,
    Transform,
    type Engine as Application,
} from 'clayflow';

export type Vec3 = readonly [number, number, number];

/** Placa da cena: caixa alinhada, cor difusa e o id da região. */
export interface Slab {
    readonly id: number;
    readonly min: Vec3;
    readonly max: Vec3;
    readonly color: Vec3;
    /** Radiância emitida (default nenhuma). */
    readonly emission?: Vec3;
}

/** Cena das medidas: placas, o sol (direção de propagação e iluminância) e a câmera. */
export interface GiScene {
    readonly slabs: readonly Slab[];
    /** O sol (direção de propagação e iluminância); sem ele, a cena só tem as placas emissoras. */
    readonly sun?: { readonly direction: Vec3; readonly illuminance: number };
    readonly camera: { readonly position: Vec3; readonly target: Vec3; readonly fovY: number };
    /** Regiões medidas (id → nome). */
    readonly regions: ReadonlyMap<number, string>;
    /** Centro do volume de sondas (o interior medido). */
    readonly probeCenter: Vec3;
    /** Espaçamento das sondas do mundo (m). Default 0,3. */
    readonly probeSpacing?: number;
    /** Céu físico (o `Sky` ligado ao sol; na referência, a tabela da mesma atmosfera e o sol atenuado). */
    readonly sky?: boolean;
}

const WHITE: Vec3 = [0.73, 0.73, 0.73];

const RED: Vec3 = [0.63, 0.065, 0.05];

const GREEN: Vec3 = [0.14, 0.45, 0.091];

const T = 0.15;

/** As placas da caixa de Cornell de 2 m (aberta na frente, +z) com um buraco de 0,6 m no teto. */
function cornellSlabs(): Slab[] {
    const h = 0.3;
    return [
        { id: 1, min: [-1, -T, -1], max: [1, 0, 1], color: WHITE },
        { id: 2, min: [-1, -T, -1 - T], max: [1, 2 + T, -1], color: WHITE },
        { id: 3, min: [-1 - T, -T, -1 - T], max: [-1, 2 + T, 1], color: RED },
        { id: 4, min: [1, -T, -1 - T], max: [1 + T, 2 + T, 1], color: GREEN },
        // Teto em quatro placas em volta do buraco.
        { id: 5, min: [-1, 2, -1], max: [1, 2 + T, -h], color: WHITE },
        { id: 5, min: [-1, 2, h], max: [1, 2 + T, 1], color: WHITE },
        { id: 5, min: [-1, 2, -h], max: [-h, 2 + T, h], color: WHITE },
        { id: 5, min: [h, 2, -h], max: [1, 2 + T, h], color: WHITE },
        // Dois blocos brancos fora do feixe do sol (a luz direta deles é a do mapa de sombra, exata só longe das bordas).
        { id: 6, min: [-0.8, 0, -0.75], max: [-0.35, 1.1, -0.3], color: WHITE },
        { id: 7, min: [0.4, 0, 0.2], max: [0.85, 0.55, 0.65], color: WHITE },
    ];
}

/** Regiões medidas da caixa de Cornell. */
const CORNELL_REGIONS: ReadonlyMap<number, string> = new Map([
    [1, 'chão'],
    [2, 'fundo'],
    [3, 'parede vermelha'],
    [4, 'parede verde'],
    [5, 'teto'],
    [6, 'bloco alto'],
    [7, 'bloco baixo'],
]);

const CORNELL_CAMERA = {
    position: [0, 1, 4.2],
    target: [0, 1, 0],
    fovY: (40 * Math.PI) / 180,
} as const;

/** Caixa de Cornell com o sol a pino entrando pelo buraco do teto. */
export function cornellBox(): GiScene {
    return {
        slabs: cornellSlabs(),
        sun: { direction: [0, -1, 0], illuminance: 100 },
        camera: CORNELL_CAMERA,
        probeCenter: [0, 1, 0],
        regions: CORNELL_REGIONS,
    };
}

/** Direção de propagação do sol com a elevação e o azimute dados (graus; azimute 0 = vindo de +x). */
export function sunFrom(elevation: number, azimuth: number): Vec3 {
    const e = (elevation * Math.PI) / 180;
    const a = (azimuth * Math.PI) / 180;
    return [-Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
}

export function windowRoom(): GiScene {
    const wall: Vec3 = [0.75, 0.75, 0.72];
    const floor: Vec3 = [0.45, 0.4, 0.35];
    const ceil: Vec3 = [0.8, 0.8, 0.8];
    const [x0, x1, y1, z0, z1] = [-2, 2, 2.5, -2, 2];
    const [wy0, wy1, wz0, wz1] = [0.9, 1.9, -0.6, 0.6];
    return {
        slabs: [
            { id: 1, min: [x0 - T, -T, z0 - T], max: [x1 + T, 0, z1 + T], color: floor },
            { id: 2, min: [x0 - T, y1, z0 - T], max: [x1 + T, y1 + T, z1 + T], color: ceil },
            { id: 3, min: [x0, 0, z0 - T], max: [x1, y1, z0], color: wall },
            { id: 5, min: [x0 - T, 0, z0 - T], max: [x0, y1, z1 + T], color: wall },
            { id: 6, min: [x0, 0, z1], max: [x1, y1, z1 + T], color: wall },
            // A parede da janela em quatro placas em volta da abertura.
            { id: 4, min: [x1, 0, z0 - T], max: [x1 + T, wy0, z1 + T], color: wall },
            { id: 4, min: [x1, wy1, z0 - T], max: [x1 + T, y1, z1 + T], color: wall },
            { id: 4, min: [x1, wy0, z0 - T], max: [x1 + T, wy1, wz0], color: wall },
            { id: 4, min: [x1, wy0, wz1], max: [x1 + T, wy1, z1 + T], color: wall },
        ],
        sun: { direction: sunFrom(35, 0), illuminance: 100000 },
        sky: true,
        camera: {
            position: [-1.7, 1.5, 1.7],
            target: [0.6, 0.7, -0.9],
            fovY: (65 * Math.PI) / 180,
        },
        probeCenter: [0, 1.25, 0],
        probeSpacing: 0.33,
        regions: new Map([
            [1, 'chão'],
            [2, 'teto'],
            [3, 'parede do fundo'],
            [4, 'parede da janela'],
        ]),
    };
}

/**
 * Função `material` difusa pura (Lambert) com a cor do material — o mesmo material do traçador de caminhos —, mais a
 * emissão dada.
 */
export function diffuseFunction(emission?: Vec3): MaterialFunction {
    const body =
        emission === undefined
            ? 'closure_diffuse(m.albedo.rgb, 0.0)'
            : `closure_add(closure_diffuse(m.albedo.rgb, 0.0), closure_emission(vec3f(${emission.map((v) => v.toFixed(6)).join(', ')}), 1.0))`;
    return new MaterialFunction({
        code: `fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {\n    return ${body};\n}`,
        lobes: emission === undefined ? ['diffuse'] : ['diffuse', 'emission'],
    });
}

/** O que a cena montada no motor devolve: o sol (se houver) e o `Transform` da câmera. */
export interface BuiltGiScene {
    readonly sun: DirectionalLight | undefined;
    readonly view: Transform;
}

/** Monta a cena no motor (placas difusas e emissoras, o sol com sombra, a câmera). */
export function buildGiScene(
    app: Application,
    scene: GiScene,
    aspect: number,
    diffuseFn = true,
): BuiltGiScene {
    for (const s of scene.slabs) {
        const size = [0, 1, 2].map((k) => s.max[k]! - s.min[k]!);
        const center = [0, 1, 2].map((k) => (s.max[k]! + s.min[k]!) / 2);
        const e = new BoxGeometry({ size })
            .add(new StandardMaterial({ albedo: [...s.color, 1], roughness: 1 }))
            .add(new Transform({ position: [...center, 1] }));
        if (diffuseFn || s.emission !== undefined) e.add(diffuseFunction(s.emission));
        app.world.insert(e);
    }
    const sun =
        scene.sun === undefined
            ? undefined
            : new DirectionalLight({
                  direction: [...scene.sun.direction, 0],
                  intensity: scene.sun.illuminance,
                  castShadow: true,
                  shadow: { size: [2048, 2048] },
              });
    if (sun !== undefined) app.world.insert(sun);
    if (scene.sky === true && sun !== undefined)
        app.world.insert(new Sky({ sun, sunDisk: false, night: [0, 0, 0] }));
    const c = scene.camera;
    const view = new Transform({
        position: [...c.position, 1],
        rotation: Transform.lookRotation(c.position, c.target),
    });
    app.world.insert(
        new Camera({ fov: c.fovY, aspect, aspectMode: 'fixed', near: 0.05, far: 60 }).add(view),
    );
    return { sun, view };
}

/** Pano vermelho (corpo mole XPBD, escrito na GPU) preso pelos dois cantos de trás, caindo sobre o palco em x = −0,9. */
export function insertCloth(app: Application): void {
    const side = 16;
    const spacing = 0.05;
    const position: number[] = [];
    const mass: number[] = [];
    const uvs: number[] = [];
    for (let j = 0; j < side; j++)
        for (let i = 0; i < side; i++) {
            position.push(-0.9 + (i - (side - 1) / 2) * spacing, 1.3, -1.0 + j * spacing);
            mass.push(j === 0 && (i === 0 || i === side - 1) ? 0 : 0.01);
            uvs.push(i / (side - 1), j / (side - 1));
        }
    const at = (i: number, j: number): number => j * side + i;
    const a: number[] = [];
    const b: number[] = [];
    const triangles: number[] = [];
    for (let j = 0; j < side; j++)
        for (let i = 0; i < side; i++) {
            if (i + 1 < side) {
                a.push(at(i, j));
                b.push(at(i + 1, j));
            }
            if (j + 1 < side) {
                a.push(at(i, j));
                b.push(at(i, j + 1));
            }
            if (i + 1 < side && j + 1 < side) {
                a.push(at(i, j), at(i + 1, j));
                b.push(at(i + 1, j + 1), at(i, j + 1));
                triangles.push(
                    at(i, j),
                    at(i, j + 1),
                    at(i + 1, j),
                    at(i + 1, j),
                    at(i, j + 1),
                    at(i + 1, j + 1),
                );
            }
        }
    app.world.insert(new GravityField({ acceleration: [0, -9.81, 0, 0] }));
    app.world.insert(
        new SoftBody({
            algorithm: 'XPBD',
            position,
            mass,
            edges: { a, b },
            surface: { triangles, uvs },
        })
            .add(new StandardMaterial({ albedo: [0.85, 0.1, 0.08, 1], roughness: 1 }))
            .add(new Transform()),
    );
}

