// As cenas do clayflow-web (spec 038; vieram de `src/__smokes__/videoScenes.ts` do motor, o mesmo código de montagem):
// lente (esfera de vidro num palco ao ar livre — céu físico, sol, piso quadriculado e colunas —, uma esfera branca opaca
// rolando atrás dela e a câmera se aproximando), dispersao (o mesmo palco, esfera de Abbe 20, câmera orbitando), agua
// (barragem no tanque, câmera parada), molhar (a barragem com a física das superfícies), causticasvidro, causticas (água
// agitada vista de cima, fundo de areia), natureza (vale com relevo, céu, luz global e o lago), cornell (caixa de Cornell
// com a luz global), dia (cômodo com janela, o sol andando), nevoa (o mesmo cômodo com névoa), pano (tecido XPBD), sprites
// (partículas e os vértices de uma esfera como sprites), ondulacao (lâmina de água com ondulações e a esfera de vidro
// meio mergulhada), as de pendência da 034 (pend*) e as das nuvens da 041 (nuvens, pordosol, solposto, raios, raios-vaos, raios-chao, solpostolento, solpostooposto, voo, sombrasnuvens,
// tempestade). O tamanho vem da URL (`?w=`, `?h=`; padrão 1280 × 720).
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
import { loadHdr } from './support/hdr';

/**
 * A luz de um dia de sol na `agua`: o sol direto 6 a 8 vezes a luz do céu no chão (medido com a panorâmica a 0,6 e o
 * sol a 1,2: o céu dava ~80 % da luz do chão — luz de dia encoberto, em que não há cáustica nem sombra). O céu da
 * panorâmica a 1/8 e o sol 4 vezes: o brilho do chão fica no de antes, e a luz que a água concentra aparece.
 */
const ENVIRONMENT_INTENSITY = 0.075;
const SUN_INTENSITY = 4.8;


const q = new URLSearchParams(location.search);
export const W = Number(q.get('w') ?? 1280);
export const H = Number(q.get('h') ?? 720);
/** `?girar` (0,3 rad/s) ou `?girar=<rad/s>`: a câmera orbital gira sozinha enquanto a animação roda. */
const SPIN = q.has('girar') ? Number(q.get('girar') || 0.3) : 0;


/** Uma cena: quadros padrão e a montagem, que devolve o movimento por quadro. */
export interface Shot {
    readonly frames: number;
    /**
     * Quadros simulados antes da gravação, parados no primeiro (o histórico que converge com o tempo: o cache de
     * espalhamento das nuvens soma um caminho por sonda a cada 8 quadros).
     */
    readonly warmup?: number;
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
    app.defaults.renderer.output.data.exposure = -14;
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

/**
 * O fotômetro de luz incidente (C = 250, padrão de ponto médio de 18 %) pela elevação do sol: a exposição (EV,
 * multiplicador 2^EV) que levaria a iluminância horizontal no chão (o sol pela transmitância e o céu pela integral da
 * radiância, na atmosfera de referência f64 do motor, `scene/reference/atmosphere.ts`; 100 000 lx no topo) ao ponto médio,
 * `0,526 − EV100`. Ao meio dia, −14,47 (a regra do "sunny 16", EV100 15). A câmera segue só uma fração dele
 * (`METER_FOLLOW`).
 */
const METER: readonly (readonly [number, number])[] = [
    [-4, -3.69],
    [-3, -5.05],
    [-2, -6.18],
    [-1, -7.1],
    [0, -7.81],
    [1, -8.5],
    [2, -9.12],
    [4, -10.1],
    [6, -10.81],
    [8, -11.33],
    [12, -12.07],
    [20, -12.95],
    [30, -13.59],
    [40, -13.99],
    [60, -14.47],
    [90, -14.7],
];

/**
 * Derivadas de Fritsch–Carlson nos nós da tabela (a curva por Hermite cúbica é monótona e de derivada contínua: a
 * interpolação linear tinha um bico em cada nó).
 */
const METER_SLOPES: readonly number[] = (() => {
    const n = METER.length;
    const h = METER.slice(1).map(([e], k) => e - METER[k]![0]);
    const d = METER.slice(1).map(([, x], k) => (x - METER[k]![1]) / h[k]!);
    const m = METER.map((_, k) => {
        if (k === 0) return d[0]!;
        if (k === n - 1) return d[n - 2]!;
        const a = d[k - 1]!;
        const b = d[k]!;
        if (a * b <= 0) return 0;
        const w1 = 2 * h[k]! + h[k - 1]!;
        const w2 = h[k]! + 2 * h[k - 1]!;
        return (w1 + w2) / (w1 / a + w2 / b);
    });
    return m;
})();

/** O fotômetro (EV) e a derivada dele (EV/°) na elevação `e` (−4° a 90°). */
function meterAt(e: number): readonly [number, number] {
    let k = 0;
    while (k < METER.length - 2 && METER[k + 1]![0] < e) k++;
    const [e0, x0] = METER[k]!;
    const [e1, x1] = METER[k + 1]!;
    const h = e1 - e0;
    const t = (e - e0) / h;
    const m0 = METER_SLOPES[k]! * h;
    const m1 = METER_SLOPES[k + 1]! * h;
    const t2 = t * t;
    const t3 = t2 * t;
    const value =
        (2 * t3 - 3 * t2 + 1) * x0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * x1 + (t3 - t2) * m1;
    const slope =
        ((6 * t2 - 6 * t) * x0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * x1 + (3 * t2 - 2 * t) * m1) / h;
    return [value, slope];
}

/**
 * A fração da mudança do fotômetro que a câmera acompanha (spec 041): a metade, em todas as elevações — a regra do
 * "sunny 16" seguida em parte, como no lapso de tempo do dia para a noite (a exposição corrigida aos poucos, sem anular a
 * queda da luz). Do meio dia ao sol a 20°, a imagem escurece 0,9 EV; a 5°, 2,1 EV; no horizonte, 3,4 EV; a −4°, 5,5 EV —
 * o crepúsculo escurece como no olho e na câmera; o fotômetro inteiro levava o chão ao mesmo brilho até 11° e escondia a
 * queda.
 */
const METER_FOLLOW = 0.5;

/** A exposição (EV, multiplicador 2^EV) com o sol a `elevation` graus: a do meio dia mais a fração da mudança do fotômetro. */
function meterExposure(elevation: number): number {
    const e = Math.min(90, Math.max(-4, elevation));
    const noon = meterAt(90)[0];
    return noon + METER_FOLLOW * (meterAt(e)[0] - noon);
}

/**
 * Extinção das nuvens das cenas (1/m na densidade 1): a de um cúmulo com ~0,4 g/m³ de água líquida e gotículas de 20 µm
 * (`3·LWC/(2·ρ·r)` ≈ 0,06/m na densidade média da forma, ~0,7). O padrão da camada (0,04) é o de nuvens mais finas.
 */
const CUMULUS_DENSITY = 0.08;

/**
 * A turbidez das cenas do pôr do sol (spec 041): 8 × os aerossóis de Hillaire — profundidade ótica vertical ~0,04 a 550 nm
 * e visibilidade de ~80 km, o ar limpo de um fim de tarde no campo (a média continental fica em 0,1–0,2). Os aerossóis
 * espalham para a frente: a auréola do sol, o laranja do horizonte e os feixes de luz e sombra entre as nuvens.
 */
const SUNSET_TURBIDITY = 8;

/**
 * O céu físico e a camada de nuvens (spec 041) com o sol a `elevation` graus e a câmera em `eye` olhando `target`. A
 * turbidez multiplica os aerossóis do `Sky` (1: os de Hillaire, profundidade ótica vertical 0,005 a 550 nm — ar de
 * montanha, visibilidade de ~200 km).
 */
function cloudSky(
    app: Application,
    elevation: number,
    values: clayflow.CloudLayerValues,
    eye: Vec3,
    target: Vec3,
    turbidity = 1,
    haze?: { readonly extinction: number; readonly scaleHeight?: number },
): { sun: clayflow.DirectionalLight; move: (p: Vec3, t: Vec3) => void; setSun: (elevation: number) => void } {
    const direction = (el: number): [number, number, number, number] => {
        const e = (el * Math.PI) / 180;
        return [-Math.cos(e) * 0.8, -Math.sin(e), -Math.cos(e) * 0.6, 0];
    };
    const sun = new clayflow.DirectionalLight({
        direction: direction(elevation),
        intensity: 100_000,
        castShadow: true,
    });
    app.world.insert(sun);
    app.world.insert(new clayflow.Sky({ sun, turbidity, ...(haze === undefined ? {} : { haze }) }));
    app.world.insert(new clayflow.CloudLayer({ density: CUMULUS_DENSITY, ...values }));
    const view = new Transform({ position: [...eye, 1], rotation: Transform.lookRotation(eye, target) });
    app.world.insert(
        new clayflow.Camera({ fov: Math.PI / 3, aspect: W / H, aspectMode: 'fixed', near: 0.5, far: 200_000 }).add(view),
    );
    app.defaults.renderer.output.data.exposure = meterExposure(elevation);
    // A curva de tom que guarda a matiz e a saturação até perto do branco (Khronos PBR Neutral, spec 041): o AgX leva os
    // realces saturados ao branco — o horizonte do lado do sol a 1° (2100 K na referência f64 da atmosfera, x 0,50 y 0,40)
    // saía a ~4200 K na tela, e as nuvens douradas do sol baixo, quase brancas.
    app.defaults.renderer.output.data.operator = 'neutral';
    // O espalhamento da lente (spec 041): 4 % da luz em θ⁻³, sem limiar — o clarão em volta do sol com a energia inteira
    // do disco.
    app.defaults.post.addEffect(new clayflow.Bloom());
    return {
        sun,
        move: (p, t) => {
            view.data.position = [...p, 1];
            view.data.rotation = Transform.lookRotation(p, t);
        },
        setSun: (el) => {
            sun.data.direction = direction(el);
            app.defaults.renderer.output.data.exposure = meterExposure(el);
        },
    };
}

/**
 * O tempo acelerado da `tempestade` (spec 041, R19): a escala do relógio (1 quadro de 1/60 s = 2 s: 4 h em 120 s) e o
 * passo fixo igual a um quadro (o tempo simulado anda um passo por quadro, sem o teto de passos cortar o tempo). A
 * reconstrução temporal das nuvens junta ~7 amostras por pixel (a média exponencial de peso 0,25, cada pixel marchado a
 * cada 4 quadros): com a nuvem mudando a cada quadro ela não acumula, e as bordas ralas ficam com o ruído de uma amostra
 * (medido na borda de baixo de um cúmulo, o passa-alta 5 × 5: 0,96 a 4 s por quadro, 0,77 a 2 s, 0,64 a 1 s; a 1/60 s,
 * liso em 60 quadros). A 18 s por quadro (a primeira gravação) as nuvens andavam 100–250 m por quadro.
 */
const STORM_TIME = 120;

/**
 * O campo de pressão da `tempestade` (WGSL do ponto `cloud_pressure`, no referencial que anda com o vento de condução):
 * uma baixa de mesoescala (σ = 12 km: a subida até ~17 km do centro, o tamanho de um sistema convectivo) que se aprofunda
 * de 0 a 1,5 hPa entre 1 h e 4 h de tempo simulado. O vento de condução (3,7 m/s de oeste, `STORM_WIND`) traz o
 * centro de 65 km (40 min, o início da gravação) a 12 km (4 h 40, o fim: a câmera debaixo da bigorna) da câmera, na
 * direção em que ela olha (a leste, `STORM_VIEW`); o centro no referencial é o do mundo aos 40 min menos o vento × 40
 * min.
 */
const STORM_PRESSURE = `fn pressure_fn(xz: vec2f, time: f32, data: PressureFnParams) -> f32 {
    let d = xz - vec2f(71912.0, -16759.0);
    return -150.0 * smoothstep(3600.0, 14400.0, time) * exp(-dot(d, d) / 2.88e8);
}`;

/**
 * A direção (x, z) em que a câmera da `tempestade` olha: 50° à esquerda do azimute do sol (fora do quadro, atrás e à
 * direita da torre: o lado dela virado para a câmera fica na sombra, e a bigorna que chega fica entre o sol e o chão).
 */
const STORM_VIEW: [number, number] = [0.974, -0.227];
/** O vento de condução da `tempestade` (m/s): 3,7 m/s vindo da direção da torre, que se aproxima. */
const STORM_WIND: [number, number] = [-3.584, 0.835];

/** Lago escavado no terreno das nuvens: o centro (x, z), a meia largura da caixa de água (m) e a cota da borda (m). */
interface TerrainLake {
    readonly center: readonly [number, number];
    readonly half: number;
    readonly rim: number;
}

/**
 * O terreno das cenas das nuvens (spec 041): colinas até o horizonte pela função de superfície (ruído de valor em cinco
 * oitavas, de 1,6 km a ~100 m; colinas de 400–900 m com ±22 m e encostas de 15–25 %, ondulações de 120–250 m e lombas de
 * 15–60 m), planas na origem (a câmera a 2 m do chão) e mais altas com a distância — ±2 m no pasto perto, até ~60 m a
 * 4–6 km, menos de 1° acima do horizonte: o relevo não tapa o céu. Com o sol baixo, as encostas viradas para ele acendem
 * e as do outro lado ficam na sombra (a das colinas, pelo mapa de sombra). Malha adaptativa na GPU
 * (o domínio esticado: segmentos de ~0,5 m perto da origem e ~20 m na borda). Coberto de gramado pelo material por pixel
 * (o mesmo caminho da `natureza`): manchas de grama verde e seca de ~25 m e de ~250 m, touceiras de ~40 cm e o grão de
 * ~4 cm, cada oitava apagada quando cai abaixo de 3 pixels (a pegada `s.footprint`), e terra onde a encosta é íngreme. A
 * sombra das nuvens chega por `light_transmission`, como em toda superfície. Com `lake`, uma bacia redonda dentro
 * da caixa de água (o terreno em volta acima da água: as paredes e os cantos da caixa enterrados).
 */
function cloudTerrain(app: Application, lake?: TerrainLake): void {
    const HALF = 6000;
    const lakeCode =
        lake === undefined
            ? ''
            : `    let ld = length(p - vec2f(${lake.center[0].toFixed(1)}, ${lake.center[1].toFixed(1)}));
    // Em volta do lago (até além dos cantos da caixa) o chão fica acima da borda da água; dentro, a bacia redonda.
    h = mix(max(h, ${lake.rim.toFixed(2)}), h, smoothstep(${(lake.half * 1.5).toFixed(1)}, ${(lake.half * 2).toFixed(1)}, ld));
    h = mix(-1.6, h, smoothstep(${(lake.half - 10).toFixed(1)}, ${(lake.half - 3.5).toFixed(1)}, ld));
`;
    app.world.insert(
        new clayflow.ParametricSurface({
            domain: [-1, 1, -1, 1],
            adaptive: { patches: [48, 48], maxLevel: 5, screen: 0.01, tolerance: 0.05, refreshDistance: 1 },
        })
            .add(
                new clayflow.SurfaceFunction({
                    code: `fn tr_hash(c: vec2f) -> f32 {
    var p3 = fract(vec3f(c.x, c.y, c.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn tr_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let a = mix(tr_hash(i), tr_hash(i + vec2f(1.0, 0.0)), u.x);
    let b = mix(tr_hash(i + vec2f(0.0, 1.0)), tr_hash(i + vec2f(1.0, 1.0)), u.x);
    return mix(a, b, u.y) * 2.0 - 1.0;
}
fn surface_fn(u: f32, v: f32, time: f32, data: SurfaceFnParams) -> vec3f {
    // O domínio [−1, 1]² esticado para o mundo (x = v, z = u, a normal da malha para cima): x = L·(c·v + (1 − c)·v³) —
    // a grade densa perto da origem (segmentos de ~0,5 m: a margem do lago e as lombas perto da câmera) e larga longe
    // (~20 m na borda, a 6 km), com a mesma quantidade de vértices.
    let c = 0.06;
    let p = ${HALF}.0 * vec2f(c * v + (1.0 - c) * v * v * v, c * u + (1.0 - c) * u * u * u);
    let r = length(p);
    var n = 0.0;
    var amp = 0.55;
    var f = 1.0 / 1600.0;
    for (var k = 0u; k < 5u; k++) {
        n += amp * tr_noise(p * f + vec2f(f32(k) * 13.7, f32(k) * 5.3));
        amp *= 0.48;
        f *= 2.17;
    }
    // Colinas de 400–900 m (±30 m: encostas de 15–25 %, que o sol baixo ilumina de um lado e deixa na sombra do
    // outro) e ondulações de 120–250 m (±4 m), três oitavas cada.
    var hill = 0.0;
    var ha = 1.0;
    var hf = 1.0 / 700.0;
    for (var k = 0u; k < 3u; k++) {
        hill += ha * tr_noise(p * hf + vec2f(f32(k) * 3.3 - 70.0, f32(k) * 9.1 + 25.0));
        ha *= 0.5;
        hf *= 2.3;
    }
    var swell = 0.0;
    var sa = 1.0;
    var sf = 1.0 / 180.0;
    for (var k = 0u; k < 3u; k++) {
        swell += sa * tr_noise(p * sf + vec2f(f32(k) * 5.7 + 13.0, f32(k) * 2.9 - 31.0));
        sa *= 0.5;
        sf *= 2.2;
    }
    // Lombas de 15–60 m de comprimento (±1,5 m), o que dá o chão irregular perto da câmera.
    var bump = 0.0;
    var ba = 1.5;
    var bf = 1.0 / 60.0;
    for (var k = 0u; k < 3u; k++) {
        bump += ba * tr_noise(p * bf + vec2f(f32(k) * 7.9 + 40.0, f32(k) * 3.1 - 11.0));
        ba *= 0.55;
        bf *= 2.1;
    }
    // Pasto ondulado perto (±2 m), as colinas a partir de ~100 m e as maiores longe (até ~60 m acima do plano a 4–6 km:
    // menos de 1° acima do horizonte, o relevo não tapa o céu); plano em volta da origem (a câmera a 2 m do chão).
    let far = smoothstep(1500.0, 4500.0, r);
    let edge = smoothstep(${HALF - 1500}.0, ${HALF}.0, max(abs(p.x), abs(p.y)));
    let near = smoothstep(6.0, 40.0, r);
    let height = mix(4.0, 110.0, smoothstep(250.0, 4500.0, r)) * smoothstep(10.0, 90.0, r);
    // Um vale largo no rumo do poente e do nascente (o azimute do sol das cenas, (0,8; 0,6), e o oposto): as colinas a um
    // quarto ali, o horizonte do sol baixo e o do lado oposto (a sombra da Terra) ficam abertos.
    let toward = abs(dot(p, vec2f(0.8, 0.6))) / max(r, 1.0);
    let across = abs(p.x * 0.6 - p.y * 0.8) / max(r, 1.0);
    let opening = mix(1.0, mix(0.25, 1.0, smoothstep(0.08, 0.35, across)), smoothstep(0.0, 0.5, toward));
    let rolling = smoothstep(60.0, 400.0, r) * (1.0 - 0.5 * far) * opening;
    var h = height * (n + 0.4 * far) + rolling * (22.0 * hill + 4.0 * swell) + near * bump + 25.0 * edge;
${lakeCode}    return vec3f(p.x, h, p.y);
}`,
                }),
            )
            .add(new clayflow.StandardMaterial({ albedo: [0.2, 0.3, 0.1, 1], roughness: 0.95 }))
            .add(
                new clayflow.MaterialFunction({
                    code: `fn gr_hash(c: vec2f) -> f32 {
    var p3 = fract(vec3f(c.x, c.y, c.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn gr_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = mix(gr_hash(i), gr_hash(i + vec2f(1.0, 0.0)), u.x);
    let b = mix(gr_hash(i + vec2f(0.0, 1.0)), gr_hash(i + vec2f(1.0, 1.0)), u.x);
    return mix(a, b, u.y) * 2.0 - 1.0;
}
fn gr_fbm(p: vec2f, scale: f32, footprint: f32) -> f32 {
    var sum = 0.0;
    var norm = 0.0;
    var amp = 0.5;
    var f = scale;
    for (var k = 0u; k < 5u; k++) {
        let w = select(1.0, clamp((1.0 / (f * footprint) - 1.5) / 1.5, 0.0, 1.0), footprint > 0.0);
        sum += amp * w * gr_noise(p * f + vec2f(f32(k) * 17.3, f32(k) * 7.1));
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}
fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {
    let xz = s.world_position.xz;
    let slope = 1.0 - clamp(s.normal.y, 0.0, 1.0);
    // Manchas de ~250 m e de ~25 m (verde e seca), touceiras de ~40 cm, o grão de ~4 cm.
    let field = gr_fbm(xz, 0.004, s.footprint);
    let spot = gr_fbm(xz + vec2f(31.0, 5.0), 0.04, s.footprint);
    let clump = gr_fbm(xz + vec2f(3.0, 47.0), 2.5, s.footprint);
    let grain = gr_fbm(xz + vec2f(71.0, 13.0), 25.0, s.footprint);
    let lush = vec3f(0.06, 0.1, 0.035);
    let green = vec3f(0.1, 0.14, 0.05);
    let dry = vec3f(0.24, 0.22, 0.11);
    var grass = mix(lush, green, smoothstep(-0.4, 0.4, field));
    grass = mix(grass, dry, smoothstep(0.15, 0.6, spot + 0.3 * field));
    grass *= 1.0 + 0.35 * clump + 0.45 * grain;
    let soil = vec3f(0.3, 0.24, 0.16) * (1.0 + 0.3 * clump + 0.3 * grain);
    let c = mix(grass, soil, smoothstep(0.3, 0.45, slope + 0.08 * clump));
    return closure_diffuse(clamp(c, vec3f(0.0), vec3f(1.0)), 0.0);
}`,
                }),
            )
            .add(new Transform()),
    );
}

export const SHOTS: Record<string, Shot> = {
    nuvens: {
        frames: 480,
        warmup: 600,
        build(app) {
            // Meio dia (spec 041): cúmulos com vento, a câmera no chão girando do horizonte para o alto.
            cloudTerrain(app);
            const { move } = cloudSky(app, 60, { coverage: 0.5, type: 0.5, wind: [12, 3] }, [0, 2, 0], [1000, 300, 0]);
            return (i) => {
                const a = (i / 479) * 0.9;
                move([0, 2, 0], [1000 * Math.cos(a), 250 + 500 * (i / 479), 1000 * Math.sin(a)]);
            };
        },
    },
    pordosol: {
        frames: 480,
        warmup: 600,
        build(app) {
            // O sol descendo de 12° a 1° atrás das nuvens (spec 041), a câmera olhando para ele (o azimute do sol é
            // (0,8; 0,6): de costas para o sol, o céu baixo não fica laranja); a exposição pelo fotômetro.
            cloudTerrain(app);
            const { setSun } = cloudSky(
                app,
                12,
                { coverage: 0.45, type: 0.55, wind: [8, 0] },
                [0, 2, 0],
                [800, 130, 600],
                SUNSET_TURBIDITY,
            );
            return (i) => setSun(12 - 11 * (i / 479));
        },
    },
    solposto: {
        frames: 1200,
        warmup: 600,
        build(app) {
            // Do meio dia até abaixo do horizonte (spec 041): o sol desce de 60° a −4° no azimute (0,8; 0,6), a câmera no
            // chão olhando para o lado dele, um pouco acima do horizonte (o céu passa do azul ao laranja e ao vermelho, as
            // nuvens recebem a luz alaranjada e ficam contra o céu); a exposição pelo fotômetro.
            cloudTerrain(app);
            // A névoa seca do fim da tarde perto do chão (spec 041, R21: 0,15/km, 600 m — ~20 km de visibilidade, o ar
            // úmido da foto do pôr do sol): o ar onde os feixes aparecem.
            const { setSun } = cloudSky(
                app,
                60,
                { coverage: 0.4, type: 0.5, wind: [6, 2] },
                [0, 2, 0],
                [800, 260, 600],
                SUNSET_TURBIDITY,
                { extinction: 0.15, scaleHeight: 0.6 },
            );
            return (i) => {
                const t = i / 1199;
                // Mais tempo perto do horizonte (onde a cor muda): a elevação desce pela raiz do tempo invertida.
                setSun(-4 + 64 * (1 - t) ** 1.6);
            };
        },
    },
    raios: {
        frames: 900,
        warmup: 600,
        build(app) {
            // Raios de sol no céu azul (spec 041, R21): a câmera no chão olhando contra o sol a 38°, cúmulos de tempo bom
            // passando na frente dele com o vento e o ar úmido perto do chão (névoa seca de 0,25/km até ~1,2 km: ~15 km de
            // visibilidade, como na foto do céu azul com névoa) — os feixes de luz
            // e de sombra saem dos vãos das nuvens no ar entre elas e a câmera (a atmosfera nos froxels, com a sombra das
            // nuvens e do terreno).
            cloudTerrain(app);
            const { move } = cloudSky(
                app,
                38,
                { coverage: 0.5, type: 0.45, wind: [9, 4], base: 1300, top: 2900 },
                [0, 2, 0],
                [800, 560, 600],
                2,
                { extinction: 0.25, scaleHeight: 1.2 },
            );
            return (i) => {
                // Um giro lento de 6° para o lado do sol durante a tomada.
                const a = Math.atan2(0.6, 0.8) - 0.05 + (i / 899) * 0.1;
                move([0, 2, 0], [1000 * Math.cos(a), 560, 1000 * Math.sin(a)]);
            };
        },
    },
    'raios-vaos': {
        frames: 900,
        warmup: 600,
        build(app) {
            // Os raios das fotos (spec 041, R21): o sol a 15° atrás de uma camada de estratocúmulos fragmentados (1,4–2,1 km,
            // cobertura 0,7, células de ~3 km com vãos de centenas de metros) entre a câmera e ele, a câmera no chão olhando
            // para o sol 5° abaixo dele e o ar úmido de ~13 km de visibilidade (névoa seca de 0,3/km até 1,5 km): o feixe é o
            // ar entre a câmera e a base da camada, aceso pelo vão e escuro na sombra.
            cloudTerrain(app);
            const target = (el: number, az: number): Vec3 => {
                const e = (el * Math.PI) / 180;
                const a = Math.atan2(0.6, 0.8) + (az * Math.PI) / 180;
                return [1000 * Math.cos(e) * Math.cos(a), 2 + 1000 * Math.sin(e), 1000 * Math.cos(e) * Math.sin(a)];
            };
            const { move } = cloudSky(
                app,
                15,
                {
                    coverage: 0.7,
                    type: 0.2,
                    base: 1400,
                    top: 2100,
                    wind: [4, 1],
                    shapeScale: 3000,
                    detailScale: 600,
                },
                [0, 2, 0],
                target(10, 0),
                2,
                { extinction: 0.3, scaleHeight: 1.5 },
            );
            return (i) => move([0, 2, 0], target(10, -3 + (6 * i) / 899));
        },
    },
    'raios-chao': {
        frames: 960,
        warmup: 600,
        build(app) {
            // Os raios chegando ao chão (spec 041, R21; pedido do usuário): o sol dourado a 12°, estratocúmulos fragmentados
            // (1,2–1,9 km, cobertura 0,6, células de ~3 km com vãos) andando com o vento, o ar úmido de ~15 km de
            // visibilidade (névoa seca de 0,25/km até 1,2 km), a câmera a 5 m olhando na diagonal, 22° ao lado do sol (fora
            // do quadro), 5° acima do horizonte, com as colinas e a grama à frente: os feixes descem dos vãos até o chão e
            // terminam em manchas de sol na grama, ao lado das sombras das nuvens. A 65° do sol, o feixe de 400 m soma 1 % à
            // luz do ar (a névoa úmida espalha para a frente; referência f64); a 22°, ~20 %.
            cloudTerrain(app);
            const target = (el: number, az: number): Vec3 => {
                const e = (el * Math.PI) / 180;
                const a = Math.atan2(0.6, 0.8) + (az * Math.PI) / 180;
                return [1000 * Math.cos(e) * Math.cos(a), 5 + 1000 * Math.sin(e), 1000 * Math.cos(e) * Math.sin(a)];
            };
            const { move } = cloudSky(
                app,
                12,
                {
                    coverage: 0.6,
                    type: 0.3,
                    base: 1200,
                    top: 1900,
                    wind: [9, 4],
                    shapeScale: 3000,
                    detailScale: 600,
                },
                [0, 5, 0],
                target(5, 22),
                2,
                { extinction: 0.25, scaleHeight: 1.2 },
            );
            return (i) => move([0, 5, 0], target(5, 26 - (8 * i) / 959));
        },
    },
    solpostolento: {
        frames: 3600,
        warmup: 600,
        build(app) {
            // O `solposto` mais devagar (spec 041): o sol desce de 20° a −4° em 60 s, linear (0,4°/s, ~100 × o real).
            cloudTerrain(app);
            const { setSun } = cloudSky(
                app,
                20,
                { coverage: 0.4, type: 0.5, wind: [6, 2] },
                [0, 2, 0],
                [800, 260, 600],
                SUNSET_TURBIDITY,
            );
            return (i) => setSun(20 - 24 * (i / 3599));
        },
    },
    solpostooposto: {
        frames: 2400,
        warmup: 600,
        build(app) {
            // O lado oposto ao pôr do sol (spec 041): a câmera de costas para o sol, olhando 6° acima do horizonte no azimute
            // (−0,8; −0,6) enquanto o sol desce de 8° a −5° em 40 s — a sombra da Terra subindo do horizonte com o cinturão
            // de Vênus (o rosa acima dela) e os raios anticrepusculares (as sombras das nuvens do lado do sol, convergindo
            // para o ponto oposto a ele).
            cloudTerrain(app);
            const { setSun } = cloudSky(
                app,
                8,
                { coverage: 0.4, type: 0.5, wind: [6, 2] },
                [0, 2, 0],
                [-800, 110, -600],
                SUNSET_TURBIDITY,
            );
            return (i) => setSun(8 - 13 * (i / 2399));
        },
    },
    voo: {
        frames: 600,
        warmup: 600,
        build(app) {
            // Do chão até acima da camada (spec 041): céu com nuvens, névoa densa dentro, mar de nuvens de cima.
            cloudTerrain(app);
            const { move } = cloudSky(
                app,
                40,
                { coverage: 0.55, type: 0.5, wind: [6, 0], base: 1500, top: 3500 },
                [0, 2, 0],
                [1000, 600, 0],
            );
            return (i) => {
                const t = i / 599;
                const y = 2 + 5500 * t * t;
                move([400 * t, y, 0], [400 * t + 1000, y + 600 - 900 * t, 200]);
            };
        },
    },
    tempestade: {
        frames: 7200,
        warmup: 1200,
        build(app) {
            // Uma tempestade se formando numa baixa sobre o terreno gramado (spec 041, R19) e chegando à câmera, com o
            // tempo acelerado (`STORM_TIME`: o aquecimento cobre os 40 min antes, a gravação de 40 min a 4 h 40). Os cúmulos
            // rasos do tempo bom (cobertura 0,3, topo a 2,8 km); a baixa se aprofunda a 65 km: a convergência sobe o ar e
            // as células mais fortes viram cúmulos-nimbos até a tropopausa (11 km), com a água da torre (a base escura) e,
            // depois, a bigorna de gelo levada pelo vento da alta troposfera (5 × o de condução: 18 m/s) à frente do sistema,
            // por cima da câmera; no fim o centro está a 12 km e a câmera debaixo do sistema — o céu escurece e a
            // sombra dela chega pelo terreno. A câmera a 60 m sobre as colinas (o
            // chão visível vai de ~200 m a ~6 km: a sombra de uma nuvem anda pelo terreno, não cobre o chão inteiro de uma
            // vez como na câmera a 2 m, que via só os primeiros metros) olhando a leste, 12° para cima; o sol de fim de
            // tarde a 20°, 50° à direita da torre (fora do quadro): o lado dela virado para a câmera fica na sombra.
            app.time.scale = STORM_TIME;
            app.time.fixedDt = STORM_TIME / 60;
            cloudTerrain(app);
            const eye: Vec3 = [0, 60, 0];
            cloudSky(
                app,
                20,
                {
                    coverage: 0.3,
                    type: 0.5,
                    base: 1200,
                    top: 2800,
                    wind: STORM_WIND,
                    weather: {
                        latitude: 40,
                        scale: 192_000,
                        formation: 1800,
                        tropopause: 11_000,
                        shear: 5,
                        pressure: { code: STORM_PRESSURE },
                    },
                },
                eye,
                [STORM_VIEW[0] * 1000, 60 + 213, STORM_VIEW[1] * 1000],
            );
            return () => {};
        },
    },
    sombrasnuvens: {
        frames: 480,
        warmup: 600,
        build(app) {
            // As sombras das nuvens correndo pelo terreno com vento forte, a água de um lago escavado nele (o reflexo das
            // nuvens) e uma esfera de vidro (a refração das nuvens) (spec 041).
            cloudTerrain(app, { center: [40, 30], half: 30, rim: 0.25 });
            rippledWater(app, [60, 2, 60], [40, -0.9, 30]);
            glassSphere(app, [30, 3, 22], 3, 1.5, 60);
            // O sol a 70° e a cobertura de 0,35: a borda de uma sombra passa pelo lago durante a tomada (vista de cima, a 50°
            // e 0,45 o lago ficava no meio de uma sombra de ~1 km o tempo todo).
            const { move } = cloudSky(
                app,
                70,
                { coverage: 0.35, type: 0.5, wind: [25, 5] },
                [0, 14, 0],
                [40, 0, 30],
            );
            return (i) => {
                const a = (i / 479) * 0.6;
                move([0, 14, 0], [40 * Math.cos(a) - 10 * Math.sin(a), 0, 30 + 10 * Math.sin(a)]);
            };
        },
    },
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
            // A câmera orbita o tanque (arrastar: girar · roda: aproximar); parada sem entrada (ou girando sozinha com
            // `?girar`), o movimento é o da barragem.
            const camera = new clayflow.Camera({
                fov: Math.PI / 4,
                aspect: W / H,
                aspectMode: 'fixed',
                near: 0.05,
                far: 50,
            })
                .add(new Transform())
                .add(
                    new clayflow.OrbitController({
                        target: [0, 0.2, 0],
                        distance: 2.8,
                        damping: 0.85,
                        autoRotate: SPIN !== 0,
                        autoRotateSpeed: SPIN,
                    }),
                );
            waterScene(app, {
                width: W,
                height: H,
                box: true,
                camera,
            });
            for (const record of app.world.allRecords())
                for (const r of record.resources)
                    if (r instanceof clayflow.DirectionalLight) r.data.intensity = SUN_INTENSITY;
            // A imagem do mundo (panorâmica HDR, Poly Haven, CC0) para a água e o vidro refletirem; ela é o fundo.
            app.defaults.ambient.background = false;
            void loadHdr(`${import.meta.env.BASE_URL}env/quarry_cloudy_1k.hdr`).then((img) => {
                app.world.insert(new clayflow.EnvironmentMap({ ...img, intensity: ENVIRONMENT_INTENSITY }));
            });
            // O traçado da água e do vidro não sorteia o lobo (spec 039): o filtro do sinal só borraria o que se vê.
            app.defaults.renderer.temporalFilter.enabled = false;
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
                    walls: clayflow.SurfacePhysics.WINDOW_GLASS,
                    box: clayflow.SurfacePhysics.BRICK,
                },
            });
            return () => undefined;
        },
    },
    molharperto: {
        frames: 360,
        build(app) {
            // A barragem vista de perto (a 12 cm da parede de vidro da frente, spec 034 T066d — a escala de uma foto de
            // vidro molhado: a gota de 2 mm cobre ~10 pixels). A barragem é mais baixa que a da `molhar` (16 × 40 × 32:
            // a água assenta a ~0,24 m) e a câmera olha a parede acima da linha d'água: a onda sobe pelo vidro, desce e
            // deixa nele as gotas — cada uma uma lente do quadriculado atrás — e os filetes que descem. Com a barragem
            // da `molhar`, a água assenta a ~0,45 m e a parede na vista fica submersa: sem película (a do lado de dentro
            // é a própria água do tanque).
            waterScene(app, {
                width: W,
                height: H,
                box: true,
                dam: [16, 40, 32],
                eye: [0.2, 0.37, 0.53],
                target: [0.12, 0.34, 0.4],
                surfaces: {
                    floor: clayflow.SurfacePhysics.CONCRETE,
                    walls: clayflow.SurfacePhysics.WINDOW_GLASS,
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
            // A mesma barragem com as cáusticas desligadas pelo renderizador.
            app.defaults.renderer.caustics.enabled = false;
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
            app.defaults.renderer.output.data.exposure = -14;
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
                            // O chão em várias escalas, por pixel: manchas de grama seca (~1,4 m), touceiras (~17 cm) e
                            // o grão (~1,7 cm), cada oitava apagada quando o comprimento de onda dela cai abaixo de 3 pixels (a pegada `s.footprint`;
                            // some de vez em 1,5), e as
                            // bordas da areia, da grama e da rocha recortadas pelo mesmo ruído.
                            code: `fn nat_hash(c: vec2f) -> f32 {
    var p3 = fract(vec3f(c.x, c.y, c.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn nat_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = mix(nat_hash(i), nat_hash(i + vec2f(1.0, 0.0)), u.x);
    let b = mix(nat_hash(i + vec2f(0.0, 1.0)), nat_hash(i + vec2f(1.0, 1.0)), u.x);
    return mix(a, b, u.y) * 2.0 - 1.0;
}
fn nat_fbm(p: vec2f, scale: f32, footprint: f32) -> f32 {
    var sum = 0.0;
    var norm = 0.0;
    var amp = 0.5;
    var f = scale;
    for (var k = 0u; k < 5u; k++) {
        let w = select(1.0, clamp((1.0 / (f * footprint) - 1.5) / 1.5, 0.0, 1.0), footprint > 0.0);
        sum += amp * w * nat_noise(p * f + vec2f(f32(k) * 17.3, f32(k) * 7.1));
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}
fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {
    let xz = s.world_position.xz;
    let y = s.world_position.y;
    let slope = 1.0 - clamp(s.normal.y, 0.0, 1.0);
    let big = nat_fbm(xz, 0.7, s.footprint);
    let mid = nat_fbm(xz + vec2f(31.0, 5.0), 6.0, s.footprint);
    let fine = nat_fbm(xz + vec2f(3.0, 47.0), 60.0, s.footprint);
    let sand = vec3f(0.74, 0.67, 0.5) * (1.0 + 0.06 * mid + 0.14 * fine);
    let lush = vec3f(0.13, 0.24, 0.06);
    let dry = vec3f(0.3, 0.3, 0.12);
    let grass = mix(lush, dry, smoothstep(0.2, 0.65, big)) * (1.0 + 0.35 * mid + 0.5 * fine);
    let rock = vec3f(0.42, 0.4, 0.38) * (1.0 + 0.25 * mid + 0.3 * fine);
    let edge = y + 0.06 * mid + 0.04 * big;
    var c = mix(sand, grass, smoothstep(-0.17, -0.12, edge));
    c = mix(c, rock, smoothstep(0.28, 0.38, slope + 0.05 * mid));
    return closure_diffuse(clamp(c, vec3f(0.0), vec3f(1.0)), 0.0);
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
            app.defaults.renderer.output.data.exposure = -10;
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
            app.defaults.renderer.output.data.exposure = -10;
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
            // Os sprites projetam sombra (opção do material: por padrão, sprites e linhas não projetam).
            const dots = new clayflow.PointSpriteMaterial({ color: [1, 0.8, 0.2, 1], radius: 0.04 });
            dots.castsShadow = true;
            app.world.insert(
                new clayflow.FluidBody({ algorithm: 'SPH', position, velocity }).add(dots),
            );
            const ball = new Transform({ position: [0, 0.4, 0, 1] });
            const beads = new clayflow.PointSpriteMaterial({ color: [0.2, 0.6, 1, 1], radius: 0.03 });
            beads.castsShadow = true;
            app.world.insert(
                new SphereGeometry({ radius: 0.25, latSegments: 8, lonSegments: 16 })
                    .add(beads)
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
