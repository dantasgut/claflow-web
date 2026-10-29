/**
 * Grava a cena do tanque pelo Deno (spec 038, `clayflow/deno`; spec 039: o traçado em ondas): desenho numa textura,
 * um quadro de 1/60 s por vez, cada quadro lido de volta e passado ao ffmpeg (H.264, CRF 8, 60 FPS). Cada quadro tem
 * prazo: o que não volta em `FRAME_TIMEOUT_MS` encerra a gravação (o ffmpeg e o processo), sem tentar de novo.
 *
 *   deno task video [quadros] [largura altura] [saída]   (padrão 180 quadros, 960 × 540, videos/agua-deno.mp4)
 */
import { Application, createScene } from 'clayflow/deno';
import { waterScene } from '../src/scenes/support/waterScene.ts';

const [framesArg, wArg, hArg, outArg] = Deno.args;
const FRAMES = Number.isInteger(Number(framesArg)) && Number(framesArg) > 0 ? Number(framesArg) : 180;
const W = Number.isInteger(Number(wArg)) && Number(wArg) > 0 ? Number(wArg) : 960;
const H = Number.isInteger(Number(hArg)) && Number(hArg) > 0 ? Number(hArg) : 540;
const OUT = outArg ?? 'videos/agua-deno.mp4';
/** Prazo de um quadro (desenho e leitura de volta). */
const FRAME_TIMEOUT_MS = 60_000;

function deadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(`${what}: passou de ${ms / 1000} s`)), ms);
        p.then(
            (v) => {
                clearTimeout(id);
                resolve(v);
            },
            (e) => {
                clearTimeout(id);
                reject(e);
            },
        );
    });
}

const app = await Application.create({
    target: { width: W, height: H },
    scene: createScene(),
    captureErrors: true,
});
const seen = new Set<string>();
app.events.on('engineError', (e) => {
    const line = `${e.stage}: ${e.message}`;
    if (seen.has(line)) return;
    seen.add(line);
    console.error(`ERRO ${line.slice(0, 600)}`);
});
waterScene(app, { width: W, height: H, box: true, eye: [1.3, 1.25, 1.9] });
console.log('compilando…');
await app.whenReady({ timeoutMs: 300_000 });

await Deno.mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
let encoder: Deno.ChildProcess | undefined;
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
const t0 = performance.now();
try {
    for (let k = 0; k < FRAMES; k++) {
        const t = performance.now();
        app.step(1 / 60);
        const px = await deadline(app.read(), FRAME_TIMEOUT_MS, `quadro ${k + 1}`);
        if (encoder === undefined) {
            const format = px.format === 'bgra8unorm' ? 'bgra' : px.format === 'rgba8unorm' ? 'rgba' : 'rgba64le';
            encoder = new Deno.Command('ffmpeg', {
                args: [
                    '-y', '-loglevel', 'error',
                    '-f', 'rawvideo', '-pix_fmt', format, '-s', `${px.width}x${px.height}`, '-r', '60', '-i', '-',
                    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '8', '-movflags', '+faststart',
                    OUT,
                ],
                stdin: 'piped',
            }).spawn();
            writer = encoder.stdin.getWriter();
        }
        await writer!.write(px.data);
        console.log(`quadro ${k + 1}/${FRAMES} ${(performance.now() - t).toFixed(0)} ms`);
    }
    await writer?.close();
    const status = await deadline(encoder!.status, 120_000, 'ffmpeg');
    console.log(
        `${status.success ? 'GRAVADO' : 'FFMPEG FALHOU'} ${OUT}: ${FRAMES} quadros em ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
    Deno.exit(status.success ? 0 : 1);
} catch (e) {
    console.error(`PARADO: ${e instanceof Error ? e.message : String(e)}`);
    try {
        encoder?.kill();
    } catch {
        // já encerrado
    }
    Deno.exit(2);
}
