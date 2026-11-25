import { MeshGeometry } from 'clayflow/web';

// A lapidação brilhante redonda (57 facetas, as proporções de Tolkowsky 1919): a pedra é o sólido convexo limitado
// pelos planos das facetas — a mesa, as 8 estrelas, as 8 principais da coroa (as pipas), as 16 da cintura de cima, a
// cintura, as 16 da cintura de baixo e as 8 principais do pavilhão, que fecham na culaça. O brilho de uma gema é desta
// geometria: os ângulos do pavilhão (40,75°) e da coroa (34,5°) fazem a luz que entra pela mesa refletir duas vezes
// por dentro (reflexão total) e voltar pela coroa — cada faceta devolve um pedaço do ambiente, e o desenho de claros e
// escuros muda a cada movimento (a cintilação).

type V3 = readonly [number, number, number];
/** Um semi-espaço: os pontos com n · x ≤ d. */
interface Plane {
    readonly n: V3;
    readonly d: number;
}

const DEG = Math.PI / 180;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** A faceta de azimute `a` inclinada `tilt` do plano da cintura (para cima com `up` = 1, para baixo com −1), por `at`. */
function facet(a: number, tilt: number, up: number, at: V3): Plane {
    const n: V3 = [Math.cos(a) * Math.sin(tilt), up * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
    return { n, d: dot(n, at) };
}

/** Os planos da lapidação brilhante de raio 1 na cintura (a cintura no plano y = 0). */
function brilliantPlanes(): Plane[] {
    const TABLE = 0.53;
    const CROWN = 34.5 * DEG;
    const PAVILION = 40.75 * DEG;
    const GIRDLE = 0.018;
    const height = (1 - TABLE) * Math.tan(CROWN);
    const planes: Plane[] = [{ n: [0, 1, 0], d: GIRDLE + height }];
    const ring = (a: number, y: number): V3 => [Math.cos(a), y, Math.sin(a)];
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const between = a + Math.PI / 8;
        // As principais da coroa e do pavilhão, pela cintura.
        planes.push(facet(a, CROWN, 1, ring(a, GIRDLE)));
        planes.push(facet(a, PAVILION, -1, ring(a, -GIRDLE)));
        // A estrela: entre duas principais, mais deitada, pelo meio da aresta da mesa.
        const edge = TABLE * Math.cos(Math.PI / 8);
        planes.push(
            facet(between, 21 * DEG, 1, [
                edge * Math.cos(between),
                GIRDLE + height,
                edge * Math.sin(between),
            ]),
        );
        // As da cintura, de cima e de baixo: duas de cada entre duas principais, mais íngremes, pela cintura.
        for (const side of [-1, 1]) {
            const g = between + (side * Math.PI) / 16;
            planes.push(facet(g, 42 * DEG, 1, ring(g, GIRDLE)));
            planes.push(facet(g, 42.4 * DEG, -1, ring(g, -GIRDLE)));
        }
    }
    // A cintura: a faixa quase vertical em volta, de 32 lados.
    for (let j = 0; j < 32; j++) {
        const a = (j * Math.PI) / 16;
        planes.push({ n: [Math.cos(a), 0, Math.sin(a)], d: 1 });
    }
    return planes;
}

/** As faces do sólido convexo limitado pelos planos: um cubo grande cortado por um plano de cada vez. */
function convexFaces(planes: readonly Plane[]): V3[][] {
    const S = 8;
    const c = (x: number, y: number, z: number): V3 => [x * S, y * S, z * S];
    let faces: V3[][] = [
        [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)],
        [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
        [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
        [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
        [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)],
        [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    ];
    const EPS = 1e-9;
    for (const plane of planes) {
        const cut: V3[] = [];
        const kept: V3[][] = [];
        for (const face of faces) {
            const out: V3[] = [];
            for (let i = 0; i < face.length; i++) {
                const p = face[i]!;
                const q = face[(i + 1) % face.length]!;
                const dp = dot(plane.n, p) - plane.d;
                const dq = dot(plane.n, q) - plane.d;
                if (dp <= EPS) out.push(p);
                // O vértice que já está no plano também é da tampa (as facetas passam por vértices das vizinhas).
                if (Math.abs(dp) <= EPS) cut.push(p);
                if ((dp < -EPS && dq > EPS) || (dp > EPS && dq < -EPS)) {
                    const t = dp / (dp - dq);
                    const x: V3 = [
                        p[0] + t * (q[0] - p[0]),
                        p[1] + t * (q[1] - p[1]),
                        p[2] + t * (q[2] - p[2]),
                    ];
                    out.push(x);
                    cut.push(x);
                }
            }
            if (out.length >= 3) kept.push(out);
        }
        // A tampa: os pontos do corte em volta do centro deles, ordenados pelo ângulo no plano.
        if (cut.length >= 3) {
            const centre: V3 = [0, 1, 2].map(
                (k) => cut.reduce((sum, p) => sum + p[k]!, 0) / cut.length,
            ) as unknown as V3;
            const u = unit(sub(cut[0]!, centre));
            const v = cross(plane.n, u);
            const angle = (p: V3): number => Math.atan2(dot(sub(p, centre), v), dot(sub(p, centre), u));
            const sorted = [...cut].sort((a, b) => angle(a) - angle(b));
            const cap = sorted.filter(
                (p, i) =>
                    (i === 0 || Math.hypot(...sub(p, sorted[i - 1]!)) > 1e-7)
                    && (i < sorted.length - 1 || Math.hypot(...sub(p, sorted[0]!)) > 1e-7),
            );
            // Só com área: o plano que apenas encosta numa aresta ou num vértice não faz faceta.
            let area = 0;
            for (let i = 1; i + 1 < cap.length; i++)
                area += Math.hypot(...cross(sub(cap[i]!, cap[0]!), sub(cap[i + 1]!, cap[0]!)));
            if (cap.length >= 3 && area > 1e-9) kept.push(cap);
        }
        faces = kept;
    }
    return faces;
}

/**
 * A malha da lapidação brilhante redonda de raio `radius` na cintura: cada faceta plana com os seus vértices e a normal
 * da face (as arestas vivas), em leque a partir do primeiro vértice.
 */
export function brilliantCut(radius: number): MeshGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const inside: V3 = [0, -0.2, 0];
    for (const face of convexFaces(brilliantPlanes())) {
        // A normal da faceta, para fora do sólido (a ordem dos vértices acompanha).
        let n: V3 = [0, 0, 0];
        for (let i = 1; i + 1 < face.length && Math.hypot(...n) < 1e-9; i++)
            n = cross(sub(face[i]!, face[0]!), sub(face[i + 1]!, face[0]!));
        if (Math.hypot(...n) < 1e-9) continue;
        n = unit(n);
        const flip = dot(n, sub(face[0]!, inside)) < 0;
        if (flip) n = [-n[0], -n[1], -n[2]];
        const ordered = flip ? [...face].reverse() : face;
        const first = positions.length / 3;
        for (const p of ordered) {
            positions.push(p[0] * radius, p[1] * radius, p[2] * radius);
            normals.push(n[0], n[1], n[2]);
        }
        for (let i = 1; i + 1 < ordered.length; i++) indices.push(first, first + i, first + i + 1);
    }
    return new MeshGeometry({
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        normals: new Float32Array(normals),
    });
}
