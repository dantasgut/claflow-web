// As cenas do clayflow-web (spec 038; vieram de `src/__smokes__/videoScenes.ts` do motor, o mesmo código de montagem):
// lente (esfera de vidro num palco ao ar livre — céu físico, sol, piso quadriculado e colunas —, uma esfera branca opaca
// rolando atrás dela e a câmera se aproximando), dispersao (o mesmo palco, esfera de Abbe 20, câmera orbitando), agua
// (barragem no tanque, câmera parada), molhar (a barragem com a física das superfícies), causticasvidro, causticas (água
// agitada vista de cima, fundo de areia), natureza (vale com relevo, céu, luz global e o lago), cornell (caixa de Cornell
// com a luz global), dia (cômodo com janela, o sol andando), nevoa (o mesmo cômodo com névoa), pano (tecido XPBD), sprites
// (partículas e os vértices de uma esfera como sprites), ondulacao (lâmina de água com ondulações e a esfera de vidro
// meio mergulhada) e as de pendência da 034 (pend*). O tamanho vem da URL (`?w=`, `?h=`; padrão 1280 × 720).
import * as clayflow from 'clayflow/web';
import {
    Application,
    FogVolume,
    GlobalIllumination,
    SphereGeometry,
    StandardMaterial,
    Transform,
} from 'clayflow/web';
import {
    buildGiScene,
    cornellBox,
    insertCloth,
    sunFrom,
    windowRoom,
    type Vec3,
} from './support/giScenes';
import { closureFn, materialGraph } from './support/materialScenes';
import { CAUSTIC_SPHERE, CAUSTIC_SUN } from './support/causticScenes';
import { WATER_SPACING, waterLook, waterScene } from './support/waterScene';


const q = new URLSearchParams(location.search);
export const W = Number(q.get('w') ?? 1280);
export const H = Number(q.get('h') ?? 720);


/** Uma cena: quadros padrão e a montagem, que devolve o movimento por quadro. */
export interface Shot {
    readonly frames: number;
    build(app: Application): (i: number) => void;
}

/** Câmera móvel por `Transform`. */
function camera(
    app: Application,
    fovY: number,
    position: Vec3,
    target: Vec3,
): (p: Vec3, t: Vec3) => void {
    const view = new Transform({
        position: [...position, 1],
        rotation: Transform.lookRotation(position, target),
    });
    app.world.insert(
        new clayflow.Camera({
            fov: fovY,
            aspect: W / H,
            aspectMode: 'fixed',
            near: 0.05,
            far: 60,
        }).add(view),
    );
    return (p, t) => {
        view.data.position = [...p, 1];
        view.data.rotation = Transform.lookRotation(p, t);
    };
}

/**
 * Esfera de vidro pelo grafo de nós (`bsdf.dielectric` + `bsdf.transmission`; índice e número de Abbe; a prioridade do
 * meio por `closure.mediumPriority`, quando dada).
 */
function glassSphere(
    app: Application,
    center: Vec3,
    radius: number,
    ior: number,
    abbe: number,
    priority?: number,
): void {
    const graph: Record<string, clayflow.GraphNode> = {
        reflect: clayflow.nodes.bsdf.dielectric.with({ ior, roughness: 0 }),
        transmit: clayflow.nodes.bsdf.transmission.with({ ior, abbe }),
        glass: clayflow.nodes.closure.add,
    };
    const links: [string, string][] = [
        ['reflect.value', 'glass.a'],
        ['transmit.value', 'glass.b'],
    ];
    let out = 'glass.value';
    if (priority !== undefined) {
        graph.priority = clayflow.nodes.closure.mediumPriority.with({ priority });
        links.push([out, 'priority.c']);
        out = 'priority.value';
    }
    app.world.insert(
        new SphereGeometry({ radius, latSegments: 96, lonSegments: 192 })
            .add(new StandardMaterial())
            .add(new Transform({ position: [...center, 1] }))
            .add(materialGraph(graph, links, out)),
    );
}

/**
 * Palco das cenas de vidro: o céu físico com o sol a 40° vindo da frente e da direita da câmera, a luz global, um piso quadriculado de 12 × 12 m (ladrilhos de 0,25 m),
 * quatro colunas coloridas ao fundo e a esfera de vidro de raio 0,45 apoiada no piso (índice e número de Abbe). O
 * raio que escapa do vidro vê o céu; o que acerta o piso ou as colunas, a luz do sol com sombra.
 */
function glassStage(app: Application, ior: number, abbe: number, priority?: number): void {
    const sun = new clayflow.DirectionalLight({
        direction: [...sunFrom(40, 60), 0],
        intensity: 100000,
        castShadow: true,
        shadow: { size: [2048, 2048] },
    });
    app.world.insert(sun);
    app.world.insert(new clayflow.Sky({ sun, sunDisk: false, night: [0, 0, 0] }));
    // A luz do céu e a rebatida nas faces e sombras do raster (o traçado do vidro já as tem): cena aberta, as cascatas
    // acompanham a câmera.
    app.world.insert(new GlobalIllumination({ quality: 'medium', probeSpacing: 0.5 }));
    // Ar livre ao sol (EV100 ≈ 14–15, a regra do "sunny 16"), contra o −10 do cômodo com janela.
    app.defaults.presentation.data.exposure = -14;
    app.world.insert(
        new clayflow.PlaneGeometry({ size: [12, 12] })
            .add(new StandardMaterial({ albedo: [0.7, 0.7, 0.7, 1], roughness: 0.9 }))
            .add(new Transform())
            .add(
                new clayflow.MaterialFunction({
                    code: 'fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {\n    let c = (floor(s.world_position.x * 4.0) + floor(s.world_position.z * 4.0)) % 2.0;\n    return closure_diffuse(mix(vec3f(0.12), vec3f(0.75), abs(c)), 0.0);\n}',
                }),
            ),
    );
    const columns: readonly [number, readonly [number, number, number]][] = [
        [-1.5, [0.63, 0.065, 0.05]],
        [-0.5, [0.14, 0.45, 0.091]],
        [0.5, [0.1, 0.2, 0.6]],
        [1.5, [0.8, 0.6, 0.1]],
    ];
    for (const [x, color] of columns)
        app.world.insert(
            new clayflow.BoxGeometry({ size: [0.4, 1.4, 0.4] })
                .add(new StandardMaterial({ albedo: [...color, 1], roughness: 0.8 }))
                .add(new Transform({ position: [x, 0.7, -2.2, 1] })),
        );
    glassSphere(app, [0, 0.45, 0], 0.45, ior, abbe, priority);
}

/**
 * Lâmina de água pelo grafo (spec 034, T065b): o dielétrico de índice 1,33 com a absorção do meio (`bsdf.transmission`:
 * a cor atingida a 2 m) e as ondulações (`surface.ripple` na posição, normal e tempo simulado da amostra, até
 * `closure.normal`) — uma caixa de malha, ainda sem a simulação (a água das partículas pelo traçado é a T065d–f).
 */
function rippledWater(app: Application, size: Vec3, center: Vec3): void {
    app.world.insert(
        new clayflow.BoxGeometry({ size: [...size] })
            .add(new StandardMaterial())
            .add(new Transform({ position: [...center, 1] }))
            .add(
                materialGraph(
                    {
                        s: clayflow.nodes.input.surfaceSample(),
                        reflect: clayflow.nodes.bsdf.dielectric.with({ ior: 1.33, roughness: 0 }),
                        transmit: clayflow.nodes.bsdf.transmission.with({
                            ior: 1.33,
                            abbe: 55.7,
                            color: [0.55, 0.8, 0.85],
                            depth: 2,
                        }),
                        water: clayflow.nodes.closure.add,
                        ripple: clayflow.nodes.surface.ripple.with({
                            strength: 0.25,
                            size: 0.3,
                            speed: 1,
                        }),
                        bump: clayflow.nodes.closure.normal,
                    },
                    [
                        ['reflect.value', 'water.a'],
                        ['transmit.value', 'water.b'],
                        ['s.world_position', 'ripple.position'],
                        ['s.normal', 'ripple.normal'],
                        ['s.time', 'ripple.time'],
                        ['water.value', 'bump.c'],
                        ['ripple.value', 'bump.normal'],
                    ],
                    'bump.value',
                ),
            ),
    );
}

export const SHOTS: Record<string, Shot> = {
    lente: {
        frames: 360,
        build(app) {
            const look = camera(app, (40 * Math.PI) / 180, [0, 0.9, 2.4], [0, 0.45, 0]);
            glassStage(app, 1.5, 0);
            const ball = new Transform({ position: [-1.4, 0.18, -1.1, 1] });
            app.world.insert(
                new SphereGeometry({ radius: 0.18, latSegments: 48, lonSegments: 96 })
                    .add(new StandardMaterial({ albedo: [0.85, 0.85, 0.85, 1], roughness: 0.6 }))
                    .add(ball),
            );
            return (i) => {
                const t = i / 359;
                ball.data.position = [
                    -1.4 + 2.8 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)),
                    0.18,
                    -1.1,
                    1,
                ];
                look(
                    [0, 0.9 - 0.2 * Math.sin(Math.PI * t), 2.4 - 0.8 * Math.sin(Math.PI * t)],
                    [0, 0.45, 0],
                );
            };
        },
    },
    dispersao: {
        frames: 300,
        build(app) {
            const look = camera(app, (40 * Math.PI) / 180, [0, 0.9, 2.2], [0, 0.45, 0]);
            glassStage(app, 1.7, 20);
            return (i) => {
                const a = (2 * Math.PI * i) / 300;
                look(
                    [2.2 * Math.sin(0.5 * a), 0.9 + 0.2 * Math.cos(a), 2.2 * Math.cos(0.5 * a)],
                    [0, 0.45, 0],
                );
            };
        },
    },
    ondulacao: {
        frames: 360,
        build(app) {
            // A esfera de vidro (prioridade 1: dentro dela a borda da água não é interface) apoiada no piso, quase metade
            // dentro de uma lâmina de água de 0,4 m com ondulações; a câmera gira devagar.
            const look = camera(app, (40 * Math.PI) / 180, [0, 1.1, 2.6], [0, 0.3, 0]);
            glassStage(app, 1.5, 0, 1);
            rippledWater(app, [4, 0.4, 3], [0, 0.19, 0]);
            return (i) => {
                const a = (0.6 * Math.PI * i) / 359;
                look([2.6 * Math.sin(a - 0.3), 1.1, 2.6 * Math.cos(a - 0.3)], [0, 0.3, 0]);
            };
        },
    },
    agua: {
        frames: 420,
        build(app) {
            // A câmera é a da cena do tanque (parada): o movimento é o da barragem.
            waterScene(app, { width: W, height: H, box: true, eye: [1.3, 1.25, 1.9] });
            return () => undefined;
        },
    },
    molhar: {
        frames: 360,
        build(app) {
            // A barragem no tanque com a física das superfícies (spec 034): o chão de concreto absorve e escurece, as
            // paredes de vidro deixam a película romper a borda e escorrer, a caixa de tijolo segura e absorve.
            waterScene(app, {
                width: W,
                height: H,
                box: true,
                eye: [1.3, 1.25, 1.9],
                surfaces: {
                    floor: clayflow.SurfacePhysics.CONCRETE,
                    walls: clayflow.SurfacePhysics.GLASS,
                    box: clayflow.SurfacePhysics.BRICK,
                },
            });
            return () => undefined;
        },
    },
    causticasvidro: {
        frames: 360,
        build(app) {
            // As cáusticas da esfera de vidro pelos fótons da GI (spec 034, T067b: o estado medido antes da T067c): a
            // esfera da US5 sobe e desce de 0,8 a 1,2 vez a distância focal sobre o chão claro, sol a pino.
            const { radius, ior, focal } = CAUSTIC_SPHERE;
            buildGiScene(
                app,
                {
                    slabs: [
                        { id: 1, min: [-2, -0.05, -2], max: [2, 0, 2], color: [0.8, 0.8, 0.8] },
                    ],
                    // A cena é linear: o sol mais fraco que o da medida (100 lx) só para caber na exposição padrão.
                    sun: { direction: [0, -1, 0], illuminance: CAUSTIC_SUN / 40 },
                    camera: {
                        position: [0, 0.75, 0.95],
                        target: [0, 0.05, 0],
                        fovY: (40 * Math.PI) / 180,
                    },
                    probeCenter: [0, 0.5, 0],
                    probeSpacing: 0.16,
                    regions: new Map([[1, 'chão']]),
                },
                W / H,
            );
            const place = new clayflow.Transform({ position: [0, focal, 0, 1] });
            app.world.insert(
                new clayflow.SphereGeometry({ radius, latSegments: 96, lonSegments: 192 })
                    .add(new clayflow.StandardMaterial())
                    .add(place)
                    .add(
                        closureFn(
                            `return closure_add(
        closure_dielectric(data.ior, vec3f(1.0), 0.0, 0.0, vec3f(0.0)),
        closure_transmission(data.ior, vec3f(1.0), 0.0, 0.0, 0.0),
    );`,
                            ['specular', 'transmission'],
                            { ior: 'f32' },
                            { ior },
                        ),
                    ),
            );
            app.world.insert(
                new GlobalIllumination({
                    quality: 'high',
                    bounces: 1,
                    probeSpacing: 0.16,
                    cascades: 1,
                    center: [0, 0.5, 0],
                }),
            );
            return (i) => {
                const h = focal * (1 + 0.2 * Math.sin((2 * Math.PI * i) / 360));
                place.data.position = [0, h, 0, 1];
            };
        },
    },
    causticas: {
        frames: 360,
        build(app) {
            waterScene(app, {
                width: W,
                height: H,
                dam: [24, 24, 32],
                floor: 'sand',
                eye: [0, 2.1, 0.01],
            });
            return () => undefined;
        },
    },
    // As pendências do smoke `fluidSurface` (T067c), nas mesmas cenas dele: a água límpida vista de cima.
    pendparada: {
        frames: 360,
        build(app) {
            // A camada parada (sem ondulação do material): o smoke mede a variação do fundo no quadro 300.
            waterScene(app, {
                width: W,
                height: H,
                layer: 6,
                material: { absorption: [0, 0, 0], abbe: 0, ripple: false },
                eye: [0, 2.1, 0.01],
            });
            return () => undefined;
        },
    },
    pendagitada: {
        frames: 240,
        build(app) {
            waterScene(app, {
                width: W,
                height: H,
                dam: [24, 24, 32],
                material: { absorption: [0, 0, 0], abbe: 0 },
                eye: [0, 2.1, 0.01],
            });
            return () => undefined;
        },
    },
    pendagitadasem: {
        frames: 240,
        build(app) {
            // A mesma barragem com as cáusticas desligadas (o recurso inserido antes da água, a padrão não entra).
            app.world.insert(new clayflow.Caustics({ enabled: false }));
            waterScene(app, {
                width: W,
                height: H,
                dam: [24, 24, 32],
                material: { absorption: [0, 0, 0], abbe: 0 },
                eye: [0, 2.1, 0.01],
            });
            return () => undefined;
        },
    },
    pendcoexistencia: {
        frames: 240,
        build(app) {
            waterScene(app, { width: W, height: H, dam: [16, 24, 20], box: true });
            const position: number[] = [];
            for (let i = 0; i < 400; i++)
                position.push(
                    0.4 + (i % 8) * WATER_SPACING,
                    0.3 + Math.floor(i / 64) * WATER_SPACING,
                    ((i >> 3) % 8) * WATER_SPACING,
                );
            app.world.insert(
                new clayflow.FluidBody({ algorithm: 'PBF', position }).add(
                    new clayflow.PointSpriteMaterial({
                        color: [1, 0.2, 0.1, 1],
                        radius: WATER_SPACING * 0.5,
                    }),
                ),
            );
            return () => undefined;
        },
    },
    penddentro: {
        frames: 240,
        build(app) {
            waterScene(app, {
                width: W,
                height: H,
                eye: [-0.55, 0.4, 0.05],
                target: [0.5, 0.2, 0],
            });
            return () => undefined;
        },
    },
    natureza: {
        frames: 480,
        build(app) {
            // Um vale natural ao sol (spec 034): o terreno com relevo pela função de superfície (uma bacia com ondulações
            // de várias escalas), areia no fundo, grama nas encostas e rocha onde é íngreme; o céu físico com o sol a 35°
            // e a luz global; um bloco de água (PBF, 2,5 cm) que cai no vale e forma o lago, com o spray, a espuma e as
            // bolhas (spec 010) e as cáusticas. A câmera gira devagar em volta do vale.
            const sun = new clayflow.DirectionalLight({
                direction: [...sunFrom(35, 40), 0],
                intensity: 100000,
                castShadow: true,
                shadow: { size: [4096, 4096] },
            });
            app.world.insert(sun);
            app.world.insert(new clayflow.Sky({ sun, sunDisk: true }));
            app.world.insert(new GlobalIllumination({ quality: 'medium', probeSpacing: 0.4 }));
            app.defaults.presentation.data.exposure = -14;
            const half = 3;
            app.world.insert(
                new clayflow.ParametricSurface({
                    resolution: [256, 256],
                    domain: [-half, half, -half, half],
                })
                    .add(
                        new clayflow.SurfaceFunction({
                            code: `fn surface_fn(u: f32, v: f32, time: f32, data: SurfaceFnParams) -> vec3f {
    let r2 = u * u + v * v;
    var h = 0.5 * r2 / (2.2 * 2.2) - 0.5;
    h += 0.07 * sin(2.1 * v + 0.3) * cos(1.7 * u + 1.1);
    h += 0.035 * sin(4.3 * v - 3.1 * u + 0.7);
    h += 0.015 * sin(9.7 * v + 7.3 * u) * sin(8.1 * u - 2.9 * v);
    h += 0.006 * sin(23.0 * v + 3.0) * sin(19.0 * u + 1.0);
    return vec3f(v, h, u);
}`,
                        }),
                    )
                    .add(new clayflow.SurfaceCollider({ mode: 'height', resolution: 256 }))
                    .add(new StandardMaterial({ albedo: [0.7, 0.65, 0.5, 1], roughness: 0.9 }))
                    .add(
                        new clayflow.MaterialFunction({
                            code: `fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {
    let y = s.world_position.y;
    let slope = 1.0 - clamp(s.normal.y, 0.0, 1.0);
    let grain = fract(sin(dot(floor(s.world_position.xz * 60.0), vec2f(12.9898, 78.233))) * 43758.5453);
    let sand = vec3f(0.74, 0.67, 0.5) * (0.92 + 0.08 * grain);
    let grass = vec3f(0.22, 0.34, 0.12) * (0.85 + 0.15 * grain);
    let rock = vec3f(0.42, 0.4, 0.38) * (0.9 + 0.1 * grain);
    var c = mix(sand, grass, smoothstep(-0.25, -0.05, y));
    c = mix(c, rock, smoothstep(0.25, 0.45, slope));
    return closure_diffuse(c, 0.0);
}`,
                        }),
                    )
                    .add(new Transform()),
            );
            app.world.insert(new clayflow.GravityField({ acceleration: [0, -9.81, 0, 0] }));
            app.world.insert(
                new clayflow.ParticlePhysics({
                    ...clayflow.ParticlePhysics.WATER,
                    particleSpacing: WATER_SPACING,
                    bounds: 'open',
                    domainMin: [-1.6, -0.7, -1.6],
                    domainMax: [1.6, 1.0, 1.6],
                }),
            );
            const position: number[] = [];
            const s = WATER_SPACING;
            for (let y = 0; y < 28; y++)
                for (let z = 0; z < 22; z++)
                    for (let x = 0; x < 22; x++)
                        position.push(
                            -0.55 + s * (x + 0.5) + ((x * 7 + y * 3 + z * 5) % 11) * s * 0.01,
                            -0.25 + s * (y + 0.5),
                            -0.35 + s * (z + 0.5) + ((x * 3 + y * 5 + z * 7) % 13) * s * 0.01,
                        );
            const body = new clayflow.FluidBody({ algorithm: 'PBF', position }).add(waterLook());
            app.world.insert(body);
            app.world.insert(new clayflow.DiffuseParticles({ source: body, maxParticles: 65_536 }));
            const look = camera(app, (45 * Math.PI) / 180, [2.55, 1.6, 2.55], [0, -0.35, 0]);
            return (i) => {
                const a = Math.PI / 4 + (0.5 * Math.PI * i) / 479;
                look([3.6 * Math.cos(a), 1.6, 3.6 * Math.sin(a)], [0, -0.35, 0]);
            };
        },
    },
    cornell: {
        frames: 300,
        build(app) {
            const scene = cornellBox();
            buildGiScene(app, scene, W / H);
            app.world.insert(
                new GlobalIllumination({
                    quality: 'medium',
                    probeSpacing: scene.probeSpacing ?? 0.3,
                    center: scene.probeCenter,
                }),
            );
            return () => undefined;
        },
    },
    dia: {
        frames: 480,
        build(app) {
            const scene = windowRoom();
            const built = buildGiScene(app, scene, W / H);
            app.world.insert(
                new GlobalIllumination({
                    quality: 'medium',
                    probeSpacing: scene.probeSpacing ?? 0.3,
                    center: scene.probeCenter,
                }),
            );
            app.defaults.presentation.data.exposure = -10;
            return (i) => {
                const d = sunFrom(20 + 30 * (i / 479), -25 + 50 * (i / 479));
                if (built.sun !== undefined) built.sun.data.direction = [...d, 0];
            };
        },
    },
    nevoa: {
        frames: 480,
        build(app) {
            // O cômodo com janela inteiro (paredes claras, céu físico e a luz global): o feixe do sol na névoa e a sala
            // iluminada pelo rebatimento.
            const scene = windowRoom();
            const built = buildGiScene(app, scene, W / H);
            app.world.insert(
                new GlobalIllumination({
                    quality: 'medium',
                    probeSpacing: scene.probeSpacing ?? 0.3,
                    center: scene.probeCenter,
                }),
            );
            app.world.insert(
                new FogVolume({
                    shape: { box: [4, 2.5, 4] },
                    center: [0, 1.25, 0],
                    density: 0.15,
                    albedo: [0.9, 0.9, 0.9],
                    anisotropy: 0.3,
                }),
            );
            app.defaults.presentation.data.exposure = -10;
            return (i) => {
                const d = sunFrom(20 + 30 * (i / 479), -25 + 50 * (i / 479));
                if (built.sun !== undefined) built.sun.data.direction = [...d, 0];
            };
        },
    },
    sprites: {
        frames: 300,
        build(app) {
            // Sprites em movimento sobre o xadrez (spec 034, T031): 400 partículas (SPH, sem gravidade) atravessando a
            // cena a 1 m/s e os vértices de uma esfera como sprites girando em volta do centro.
            app.world.insert(
                new clayflow.DirectionalLight({
                    direction: [-0.4, -1, -0.3, 0],
                    intensity: 3,
                    castShadow: true,
                    shadow: { size: [2048, 2048] },
                }),
            );
            app.world.insert(
                new clayflow.PlaneGeometry({ size: [8, 8] })
                    .add(new StandardMaterial({ albedo: [0.7, 0.7, 0.7, 1], roughness: 0.9 }))
                    .add(new Transform())
                    .add(
                        new clayflow.MaterialFunction({
                            code: 'fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {\n    let c = (floor(s.world_position.x * 10.0) + floor(s.world_position.z * 10.0)) % 2.0;\n    return closure_diffuse(mix(vec3f(0.1), vec3f(0.8), abs(c)), 0.0);\n}',
                        }),
                    ),
            );
            app.world.insert(new clayflow.GravityField({ acceleration: [0, 0, 0, 0] }));
            const position: number[] = [];
            const velocity: number[] = [];
            for (let k = 0; k < 400; k++) {
                position.push(
                    -2.4 + 1.2 * ((k * 0.618) % 1),
                    0.5 + 0.6 * ((k * 0.381) % 1),
                    -0.6 + 1.2 * ((k * 0.271) % 1),
                );
                velocity.push(1, 0, 0);
            }
            app.world.insert(
                new clayflow.FluidBody({ algorithm: 'SPH', position, velocity }).add(
                    new clayflow.PointSpriteMaterial({ color: [1, 0.8, 0.2, 1], radius: 0.04 }),
                ),
            );
            const ball = new Transform({ position: [0, 0.4, 0, 1] });
            app.world.insert(
                new SphereGeometry({ radius: 0.25, latSegments: 8, lonSegments: 16 })
                    .add(
                        new clayflow.PointSpriteMaterial({ color: [0.2, 0.6, 1, 1], radius: 0.03 }),
                    )
                    .add(ball),
            );
            camera(app, 0.8, [0, 1, 3], [0, 0.4, 0]);
            return (i) => {
                const a = (2 * Math.PI * i) / 150;
                ball.data.position = [0.9 * Math.cos(a), 0.4, 0.9 * Math.sin(a), 1];
            };
        },
    },
    pano: {
        frames: 300,
        build(app) {
            app.world.insert(
                new clayflow.DirectionalLight({
                    direction: [-0.3, -1, -0.4, 0],
                    intensity: 3,
                    castShadow: true,
                    shadow: { size: [2048, 2048] },
                }),
            );
            app.world.insert(
                new clayflow.PlaneGeometry({ size: [6, 6] })
                    .add(new StandardMaterial({ albedo: [0.6, 0.6, 0.62, 1], roughness: 0.9 }))
                    .add(new Transform({ position: [-0.9, 0, -0.6, 1] })),
            );
            insertCloth(app);
            camera(app, Math.PI / 4, [0.4, 1.4, 1.2], [-0.9, 0.7, -0.6]);
            return () => undefined;
        },
    },
};

/** Base64 de bytes grandes (em blocos, sem estourar a pilha). */
