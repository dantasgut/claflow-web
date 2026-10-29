// Cena de água dos smokes da superfície de fluido (spec 017): tanque sobre chão quadriculado (ladrilhos claros e
// escuros: a refração e a absorção aparecem no padrão), paredes de vidro de 0,5 m (desenhadas onde colidem, com a física da
// superfície do vidro), luz direcional com sombra,
// câmera e uma barragem de partículas. A aparência da água é um material do grafo (spec 034, T066: o mesmo dielétrico do vidro).
// Determinística: as fixtures dependem só do código.
import {
    BoxCollider,
    BoxGeometry,
    Camera,
    DiffuseParticles,
    DirectionalLight,
    FluidBody,
    GravityField,
    ParticlePhysics,
    PlaneGeometry,
    PointSpriteMaterial,
    Sky,
    StandardMaterial,
    Transform,
    nodes,
    SurfacePhysics,
} from 'clayflow';
import type {
    Engine as Application,
    MaterialFunction,
    ParticlePhysicsOptions,
    SurfacePhysicsOptions,
} from 'clayflow';
import { materialGraph } from './materialScenes.ts';
import { mulberry32 as rng } from './random.ts';

/** Meia largura interna do tanque em x e z (m). */
export const WATER_TANK: readonly [number, number] = [0.8, 0.4];
/** Espaçamento das partículas da água (m). */
export const WATER_SPACING = 0.025;

/** A aparência da água pelo grafo (spec 034, T066). */
export interface WaterLook {
    /** Índice de refração (padrão 1,333). */
    readonly ior?: number;
    /**
     * Número de Abbe da dispersão (padrão 0, sem dispersão — decisão do usuário, 2026-10-29: no respingo as cores se
     * separam abaixo do pixel e, traçadas com uma amostra por canal, viravam pontos coloridos; a água real é 55,7).
     */
    readonly abbe?: number;
    /** Absorção por metro por canal (padrão a da água: 0,45; 0,09; 0,06). */
    readonly absorption?: readonly [number, number, number];
    /** Rugosidade da superfície (padrão 0,02). */
    readonly roughness?: number;
    /** Ondulações da superfície (nó `surface.ripple`; padrão inclinação 0,3, 6 cm, velocidade 1); `false` sem. */
    readonly ripple?:
        | { readonly strength?: number; readonly size?: number; readonly speed?: number }
        | false;
}

/**
 * O material da água pelo grafo: o dielétrico de índice `ior` com a transmissão (a absorção por metro como a cor a 1 m,
 * `exp(−absorção)`, e o Abbe) e as ondulações na normal da superfície (`surface.ripple` na posição, normal e tempo
 * simulado da amostra, até `closure.normal`).
 */
export function waterLook(look: WaterLook = {}): MaterialFunction {
    const ior = look.ior ?? 1.333;
    const absorption = look.absorption ?? [0.45, 0.09, 0.06];
    const graph = {
        reflect: nodes.bsdf.dielectric.with({ ior, roughness: look.roughness ?? 0.02 }),
        transmit: nodes.bsdf.transmission.with({
            ior,
            abbe: look.abbe ?? 0,
            color: absorption.map((a) => Math.exp(-a)),
            depth: 1,
        }),
        water: nodes.closure.add,
    };
    const links: [string, string][] = [
        ['reflect.value', 'water.a'],
        ['transmit.value', 'water.b'],
    ];
    if (look.ripple === false) return materialGraph(graph, links, 'water.value');
    return materialGraph(
        {
            ...graph,
            s: nodes.input.surfaceSample(),
            ripple: nodes.surface.ripple.with({
                strength: look.ripple?.strength ?? 0.3,
                size: look.ripple?.size ?? 0.06,
                speed: look.ripple?.speed ?? 1,
            }),
            bump: nodes.closure.normal,
        },
        [
            ...links,
            ['s.world_position', 'ripple.position'],
            ['s.normal', 'ripple.normal'],
            ['s.time', 'ripple.time'],
            ['water.value', 'bump.c'],
            ['ripple.value', 'bump.normal'],
        ],
        'bump.value',
    );
}

/** Opções da cena. */
export interface WaterSceneOptions {
    /** Lado da imagem (para o aspecto da câmera). */
    readonly width: number;
    readonly height: number;
    /** Partículas da barragem em x, y, z (padrão 24 × 48 × 32 = 36 864). */
    readonly dam?: readonly [number, number, number];
    /** Camada parada no fundo em vez da barragem: altura em partículas (água plana). */
    readonly layer?: number;
    /** Algoritmo do fluido (padrão PBF: incompressível, com o confinamento de vorticidade; spec 034). */
    readonly algorithm?: 'SPH' | 'PBF' | 'MPM';
    /** Aparência do corpo: água pelo grafo (opções) ou sprites. */
    readonly material?: WaterLook | 'sprites' | 'none';
    /** Caixa submersa no centro do tanque. */
    readonly box?: boolean;
    /** Fundo: quadriculado (padrão; mostra a refração) ou areia clara (mostra as cáusticas). */
    readonly floor?: 'checker' | 'sand';
    /** Direção da luz. */
    readonly light?: readonly [number, number, number];
    /** Posição e alvo da câmera. */
    readonly eye?: readonly [number, number, number];
    readonly target?: readonly [number, number, number];
    /** A câmera, já com o `Transform` que quem chama move; sem ela, uma parada em `eye` olhando `target`. */
    readonly camera?: Camera;
    /** Física das partículas (padrão: a da água, `ParticlePhysics.WATER`, no espaçamento da cena). */
    readonly physics?: ParticlePhysicsOptions;
    /** Espaçamento das partículas (m; padrão `WATER_SPACING`): a barragem e a camada mantêm o volume. */
    readonly spacing?: number;
    /** Partículas secundárias do corpo (spray, espuma e bolhas; padrão ligadas com a água pelo grafo). */
    readonly diffuse?: boolean;
    /**
     * O céu físico (`Sky`, com o disco do sol) como fundo e ambiente — o que a água e o vidro refletem —, em unidades reais:
     * o sol a 100 000 lux e a exposição e o ambiente na mesma escala (o brilho da cena fica o de sem ele). Padrão sem.
     */
    readonly sky?: boolean;
    /** A física da superfície dos sólidos diante da água (spec 034; sem ela, a padrão: lisa e impermeável). */
    readonly surfaces?: {
        readonly floor?: SurfacePhysicsOptions;
        readonly walls?: SurfacePhysicsOptions;
        readonly box?: SurfacePhysicsOptions;
    };
}

/** A intensidade do sol da cena (unidades relativas, sem o céu físico). */
const SUN_INTENSITY = 1.2;
/** O sol com o céu físico (lux ao nível do chão, dia claro). */
const SKY_SUN_LUX = 100000;

/** O collider com a física da superfície, se dada. */
function solid(collider: BoxCollider, surface: SurfacePhysicsOptions | undefined): BoxCollider {
    return surface === undefined ? collider : collider.add(new SurfacePhysics(surface));
}

/** Monta a cena; devolve o corpo (ou `undefined` sem água). */
export function waterScene(app: Application, options: WaterSceneOptions): FluidBody | undefined {
    const world = app.world;
    // O fundo é o hemisfério (spec 034): o mundo que a água reflete e refrata é o que se vê atrás da cena.
    app.defaults.ambient.background = true;
    const spacing = options.spacing ?? WATER_SPACING;
    const eye = options.eye ?? [0, 1.25, 1.55];
    const target = options.target ?? [0, 0.1, 0];
    world.insert(
        options.camera
            ?? new Camera({
                fov: Math.PI / 4,
                aspect: options.width / options.height,
                aspectMode: 'fixed',
                near: 0.05,
                far: 20,
            }).add(
                new Transform({
                    position: [...eye, 1],
                    rotation: Transform.lookRotation(eye, target),
                }),
            ),
    );
    const dir = options.light ?? [-0.25, -1, -0.35];
    // Com o céu físico, o sol em lux reais; a exposição e o ambiente sobem na mesma razão.
    const scale = options.sky === true ? SKY_SUN_LUX / SUN_INTENSITY : 1;
    const sun = new DirectionalLight({
        direction: [...dir, 0],
        color: [1, 1, 1, 1],
        intensity: SUN_INTENSITY * scale,
        castShadow: true,
        // O disco do sol (raio angular de 0,267°): o brilho dele na água e no vidro.
        angularRadius: 0.00466,
    });
    world.insert(sun);
    if (options.sky === true) {
        world.insert(new Sky({ sun, sunDisk: true }));
        app.defaults.presentation.data.exposure = -Math.log2(scale);
        app.defaults.ambient.data.intensity *= scale;
    }
    world.insert(new GravityField({ acceleration: [0, -9.81, 0, 0] }));
    world.insert(
        new ParticlePhysics(
            options.physics ?? { ...ParticlePhysics.WATER, particleSpacing: spacing },
        ),
    );
    floor(app, options.floor ?? 'checker', options.surfaces?.floor);
    walls(app, options.surfaces?.walls);
    if (options.box === true) {
        const box = new BoxGeometry({ size: [2 * BOX_HALF, 2 * BOX_HALF, 2 * BOX_HALF] });
        box.add(
            new StandardMaterial({ albedo: [0.85, 0.55, 0.2, 1], roughness: 0.6, metallic: 0 }),
        );
        box.add(new Transform({ position: [...BOX_CENTER, 1] }));
        world.insert(box);
        world.insert(
            solid(
                new BoxCollider({
                    halfExtents: [BOX_HALF, BOX_HALF, BOX_HALF, 0],
                    center: [...BOX_CENTER, 1],
                }),
                options.surfaces?.box,
            ),
        );
    }
    if (options.material === 'none') return undefined;
    const position =
        options.layer !== undefined
            ? layer(options.layer, options.box === true, spacing)
            : dam(options.dam, spacing);
    const body = new FluidBody({ algorithm: options.algorithm ?? 'PBF', position });
    body.add(
        options.material === 'sprites'
            ? new PointSpriteMaterial({ color: [0.2, 0.5, 1, 1], radius: spacing * 0.5 })
            : waterLook(options.material ?? {}),
    );
    world.insert(body);
    if (options.material !== 'sprites' && options.diffuse !== false)
        world.insert(new DiffuseParticles({ source: body }));
    return body;
}

/**
 * Meia largura do chão (m): o desenhado é o de colisão, para o que respinga fora do tanque cair num chão visível; largo o
 * bastante para o que a água e o vidro refratam para baixo cair nele (com 2 m, os raios que a coluna da barragem
 * desviava para baixo passavam da borda e o pé da coluna ficava escuro).
 */
const FLOOR_HALF = 6;

/** Cores das casas do chão: a clara e a escura de cada fundo. */
const FLOOR_COLORS = {
    checker: [
        [0.92, 0.92, 0.88],
        [0.25, 0.27, 0.3],
    ],
    sand: [
        [0.86, 0.82, 0.7],
        [0.82, 0.78, 0.66],
    ],
} as const;

/** Lado da casa do chão (m). */
const FLOOR_TILE = 0.1;

/**
 * O material do chão pelo grafo: o xadrez de casas de `FLOOR_TILE` no plano xz da posição de mundo (`pattern.checker2`,
 * filtrado pela largura do pixel ou do cone do raio na amostra), a cor pela rampa (a clara nas casas pares) e o mesmo
 * fechamento do `StandardMaterial` fosco (difuso mais o dielétrico 1,5 de rugosidade 0,9). O padrão é material,
 * calculado por pixel: o chão é um plano só.
 */
function floorLook(kind: 'checker' | 'sand'): MaterialFunction {
    const [light, dark] = FLOOR_COLORS[kind];
    return materialGraph(
        {
            s: nodes.input.surfaceSample(),
            split: nodes.math.split3,
            xz: nodes.math.combine2,
            tiles: nodes.pattern.checker2.with({ scale: 1 / FLOOR_TILE }),
            paint: nodes.color.ramp.with({ color_a: [...light], color_b: [...dark] }),
            diffuse: nodes.bsdf.diffuse,
            specular: nodes.bsdf.dielectric.with({ ior: 1.5, roughness: 0.9 }),
            surface: nodes.closure.add,
        },
        [
            ['s.world_position', 'split.v'],
            ['split.x', 'xz.x'],
            ['split.z', 'xz.y'],
            ['xz.value', 'tiles.p'],
            ['s.footprint', 'tiles.width'],
            ['tiles.value', 'paint.t'],
            ['paint.color', 'diffuse.color'],
            ['diffuse.value', 'surface.a'],
            ['specular.value', 'surface.b'],
        ],
        'surface.value',
    );
}

/** Chão quadriculado: um plano com o xadrez no material (o padrão do tanque continua fora dele). */
function floor(app: Application, kind: 'checker' | 'sand', surface?: SurfacePhysicsOptions): void {
    const plane = new PlaneGeometry({ size: [2 * FLOOR_HALF, 2 * FLOOR_HALF] });
    plane.add(new StandardMaterial({ roughness: 0.9, metallic: 0 })).add(floorLook(kind));
    plane.add(new Transform({ position: [0, 0, 0, 1] }));
    app.world.insert(plane);
    // Chão de colisão (o topo em y = 0).
    app.world.insert(
        solid(
            new BoxCollider({
                halfExtents: [FLOOR_HALF, 0.5, FLOOR_HALF, 0],
                center: [0, -0.5, 0, 1],
            }),
            surface,
        ),
    );
}

/** O vidro das paredes pelo grafo: dielétrico liso e transmissão de índice 1,5, prioridade de meio 1. */
function glassLook(): MaterialFunction {
    const ior = 1.5;
    return materialGraph(
        {
            reflect: nodes.bsdf.dielectric.with({ ior, roughness: 0 }),
            transmit: nodes.bsdf.transmission.with({ ior, abbe: 0 }),
            glass: nodes.closure.add,
            priority: nodes.closure.mediumPriority.with({ priority: 1 }),
        },
        [
            ['reflect.value', 'glass.a'],
            ['transmit.value', 'glass.b'],
            ['glass.value', 'priority.c'],
        ],
        'priority.value',
    );
}

/** Altura das paredes do tanque (m). */
const WALL = 0.5;

/**
 * Paredes do tanque: vidro de 1 cm de espessura (o dielétrico com a transmissão, índice 1,5; prioridade de meio 1:
 * dentro do vidro a borda da água não é interface) com a física da superfície do vidro (`SurfacePhysics.GLASS`, salvo
 * outra pedida), desenhadas até onde colidem (0,5 m: a água que bate nelas, molha e escorre fica à vista; a da barragem
 * que passa da borda transborda — spec 034). A luz que as atravessa chega ao tanque pelas cáusticas (T067c). A colisão
 * desce 10 cm abaixo do chão.
 */
function walls(app: Application, surface?: SurfacePhysicsOptions): void {
    const [hx, hz] = WATER_TANK;
    const t = 0.005;
    const h = (WALL + 0.1) / 2;
    for (const [x, z, ex, ez] of [
        [hx + t, 0, t, hz + 2 * t],
        [-(hx + t), 0, t, hz + 2 * t],
        [0, hz + t, hx, t],
        [0, -(hz + t), hx, t],
    ] as const) {
        app.world.insert(
            solid(
                new BoxCollider({ halfExtents: [ex, h, ez, 0], center: [x, WALL - h, z, 1] }),
                surface ?? SurfacePhysics.GLASS,
            ),
        );
        const wall = new BoxGeometry({ size: [2 * ex, WALL, 2 * ez] });
        wall.add(new StandardMaterial()).add(glassLook());
        wall.add(new Transform({ position: [x, WALL / 2, z, 1] }));
        app.world.insert(wall);
    }
}

/**
 * Barragem encostada na parede −x (x, y, z por partícula, com jitter determinístico); `size` em partículas do
 * espaçamento padrão, escalado para manter o volume no espaçamento `s`.
 */
function dam(size: readonly [number, number, number] = [24, 48, 32], s: number): number[] {
    const [nx, ny, nz] = size.map((n) => Math.round((n * WATER_SPACING) / s)) as [
        number,
        number,
        number,
    ];
    const [hx, hz] = WATER_TANK;
    const r = rng(17);
    const out: number[] = [];
    const z0 = -hz + s * 0.5 + (2 * hz - nz * s) / 2;
    for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++)
            for (let x = 0; x < nx; x++)
                out.push(
                    -hx + s * (x + 0.5) + (r() - 0.5) * s * 0.1,
                    s * (y + 0.5) + (r() - 0.5) * s * 0.1,
                    z0 + s * z + (r() - 0.5) * s * 0.1,
                );
    return out;
}

/** Caixa submersa: centro e meio lado (m). */
const BOX_CENTER: readonly [number, number, number] = [0.15, 0.12, 0];
const BOX_HALF = 0.12;

/** Camada no fundo cobrindo o tanque (água parada depois de assentar), fora da caixa quando há caixa. */
function layer(height: number, box: boolean, s: number): number[] {
    const [hx, hz] = WATER_TANK;
    const nx = Math.floor((2 * hx) / s);
    const nz = Math.floor((2 * hz) / s);
    const r = rng(23);
    const out: number[] = [];
    for (let y = 0; y < height; y++)
        for (let z = 0; z < nz; z++)
            for (let x = 0; x < nx; x++) {
                const p = [
                    -hx + s * (x + 0.5) + (r() - 0.5) * s * 0.05,
                    s * (y + 0.5),
                    -hz + s * (z + 0.5) + (r() - 0.5) * s * 0.05,
                ] as const;
                const inside = p.every((v, k) => Math.abs(v - BOX_CENTER[k]!) < BOX_HALF + s * 0.5);
                if (!box || !inside) out.push(...p);
            }
    return out;
}
