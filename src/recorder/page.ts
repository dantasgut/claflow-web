// Página do gravador (spec 038; veio de `src/__smokes__/videoScenes.ts` do motor): monta a cena pedida (`?scene=`),
// espera o motor pronto e, quadro a quadro com passo fixo de 1/60 s, lê o quadro apresentado direto da GPU
// (`readCanvas`) e o entrega ao runner (`__videoFrame`), que o escreve no ffmpeg. Nada passa pelo canvas 2D nem por JPEG.
// `?bits=16` usa o canvas em `rgba16float` (mapeamento de tons sem quantizar em 8 bits) para o vídeo de 10 bits.
import * as clayflow from 'clayflow/web';
import { Application, createScene } from 'clayflow/web';
import { H, SHOTS, W } from '../scenes/catalog';

declare global {
    interface Window {
        /** O runner recebe cada quadro (base64 dos pixels, sem preenchimento) e o escreve no ffmpeg. */
        __videoFrame?: (index: number, base64: string) => Promise<void>;
        /** O runner recebe as dimensões e o formato antes do primeiro quadro (para abrir o ffmpeg). */
        __videoStart?: (
            width: number,
            height: number,
            format: string,
            frames: number,
        ) => Promise<void>;
    }
}


const q = new URLSearchParams(location.search);
const BITS = q.get('bits') === '16' ? 16 : 8;
/** Diagnóstico: `?aa=off|temporal|msaa|accumulate` troca o antisserrilhado (padrão: o do motor). */
const AA = q.get('aa');
/** `?profile=high|medium|low`: o perfil do renderizador (spec 039), antes da cena (o que ela ajusta vale por cima). */
const PROFILE = q.get('profile');

function log(msg: string): void {
    console.log(`[gravador] ${msg}`);
    const el = document.getElementById('log');
    if (el !== null) el.textContent += `${msg}\n`;
}

function toBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

async function main(): Promise<void> {
    const name = q.get('scene') ?? '';
    const shot = SHOTS[name];
    if (shot === undefined)
        throw new Error(`cena desconhecida: ${name} (há ${Object.keys(SHOTS).join(', ')})`);
    const frames = Number(q.get('frames') ?? shot.frames);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.appendChild(canvas);
    const app = await Application.create({
        canvas,
        scene: createScene(),
        autoResize: false,
        profiling: q.has('passes') ? true : 'frame',
        ...(AA !== null ? { antialias: AA as clayflow.AntialiasingMode } : {}),
        canvasOptions: {
            capture: true,
            ...(BITS === 16 ? { format: 'rgba16float' as const } : {}),
        },
    });
    const errors: string[] = [];
    app.events.on('engineError', (e) => errors.push(`${e.stage}: ${e.message}`));
    // Tempo de GPU por quadro (profiling do quadro): quantos quadros por segundo o motor gera nesta cena.
    const gpuMs: number[] = [];
    // Por passe (spec 041): a mediana de cada passe nos quadros gravados, os mais caros no fim.
    const passMs: Record<string, number>[] = [];
    app.events.on('gpuFrameTimed', (e) => {
        gpuMs.push(e.totalMs);
        passMs.push({ ...e.passesMs });
    });
    if (PROFILE !== null) app.defaults.renderer.profile = PROFILE as clayflow.RenderProfile;
    const update = shot.build(app);
    update(0);
    await app.whenReady({ timeoutMs: 120_000 });
    // O aquecimento: quadros parados no primeiro, sem gravar (cada um espera o quadro apresentado, sem empilhar).
    for (let i = 0; i < (shot.warmup ?? 0); i++) {
        update(0);
        app.step(1 / 60);
        await app.core.readCanvas();
    }
    for (let i = 0; i < frames; i++) {
        update(i);
        app.step(1 / 60);
        // Na mesma tarefa do quadro: a textura do canvas ainda é a apresentada.
        const pixels = await app.core.readCanvas();
        if (i === 0)
            await window.__videoStart?.(pixels.width, pixels.height, pixels.format, frames);
        await window.__videoFrame?.(i, toBase64(pixels.data));
        if (errors.length > 0) throw new Error(errors.join(' | '));
    }
    app.dispose();
    canvas.remove();
    log(`${name}: ${frames} quadros ${W}×${H} lidos da GPU (${BITS} bits)`);
    if (passMs.length > 0) {
        const keys = new Set(passMs.flatMap((x) => Object.keys(x)));
        const med = [...keys].map((k): [string, number] => {
            const v = passMs.map((x) => x[k] ?? 0).sort((a, b) => a - b);
            return [k, v[Math.floor(v.length / 2)]!];
        });
        med.sort((a, b) => b[1] - a[1]);
        log(`${name}: passes (mediana, ms) ${med.slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ')}`);
    }
    if (gpuMs.length > 0) {
        const s = [...gpuMs].sort((a, b) => a - b);
        const at = (f: number): number => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
        const mean = gpuMs.reduce((a, b) => a + b, 0) / gpuMs.length;
        const fps = (ms: number): string => (1000 / ms).toFixed(1);
        log(
            `${name}: GPU por quadro média ${mean.toFixed(2)} ms (${fps(mean)} FPS), mediana ${at(0.5).toFixed(2)} ms (${fps(at(0.5))} FPS), p95 ${at(0.95).toFixed(2)} ms (${fps(at(0.95))} FPS), pior ${s.at(-1)!.toFixed(2)} ms — ${gpuMs.length} quadros medidos`,
        );
    }
    log('VIDEO DONE');
}

main().catch((err: unknown) => {
    log(`FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});

