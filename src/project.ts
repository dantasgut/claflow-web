import * as clayflow from 'clayflow/web';
import type { Application } from 'clayflow/web';

// A projeção de um ponto da cena no canvas, pela câmera como ela está no quadro (a que segue o tempo, a livre, a da
// órbita): o clique numa peça da vitrine e o recorte da miniatura do material usam a mesma conta.

export type Vec3 = readonly [number, number, number];

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

/** Uma esfera projetada: o centro e o raio em pixels do canvas, e a distância à câmera ao longo do eixo de visão. */
export interface Projected {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly z: number;
}

/**
 * Projeta a esfera de centro `at` e raio `radius` no canvas pela primeira câmera em perspectiva da cena; `undefined`
 * sem câmera ou com a esfera atrás dela.
 */
export function projectSphere(
    app: Application,
    canvas: HTMLCanvasElement,
    at: Vec3,
    radius: number,
): Projected | undefined {
    for (const record of app.world.allRecords()) {
        if (!(record.root instanceof clayflow.Camera)) continue;
        const transform = record.resources.find((r) => r instanceof clayflow.Transform);
        if (!(transform instanceof clayflow.Transform)) continue;
        const fov = record.root.data.fov;
        if (!(fov > 0)) return undefined;
        const p = transform.data.position;
        const q = transform.data.rotation;
        const d: Vec3 = [at[0] - (p[0] ?? 0), at[1] - (p[1] ?? 0), at[2] - (p[2] ?? 0)];
        const z = dot(d, rotate(q, [0, 0, -1]));
        if (z <= 0) return undefined;
        const focal = canvas.height / 2 / Math.tan(fov / 2);
        return {
            x: canvas.width / 2 + (focal * dot(d, rotate(q, [1, 0, 0]))) / z,
            y: canvas.height / 2 - (focal * dot(d, rotate(q, [0, 1, 0]))) / z,
            r: (focal * radius) / z,
            z,
        };
    }
    return undefined;
}
