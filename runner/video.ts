import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { EnvironmentError, launchBrowser } from './browser';
import { startServer } from './server';

/**
 * Grava vídeos das cenas do clayflow-web (`src/scenes/catalog.ts`, spec 038; antes no motor, spec 034 US6) com a imagem
 * lida direto da GPU:
 *
 *   npm run video -- <cena>[,<cena>…] [--frames N] [--out pasta] [--lossless] [--10bit] [--size 1280x720]
 *                     [--timeout s] [--aa off|temporal|msaa|accumulate]
 *
 * A página monta a cena, espera o motor pronto e, quadro a quadro com passo fixo de 1/60 s, lê o quadro apresentado
 * (`readCanvas`, sem canvas 2D nem JPEG) e o entrega por função exposta; o runner escreve os pixels no `stdin` do
 * ffmpeg. Saídas por cena em `--out` (padrão `bench/results/videos/`):
 *   - `<cena>.mp4` — H.264 High, 4:2:0, CRF 8, 60 FPS (abre no celular);
 *   - `<cena>-10bit.mp4` com `--10bit` — HEVC Main10 (`hvc1`, CRF 8), a partir do canvas em `rgba16float` (sem quantizar em
 *     8 bits antes do codificador; SDR BT.709, não é HDR10/PQ);
 *   - `<cena>-lossless.mkv` com `--lossless` — FFV1, os quadros exatos.
 * O vídeo é conferido contra os quadros exatos (FFV1 sempre gravado; apagado sem `--lossless`), quadro a quadro: brilho
 * ≥ 50 dB e RGB ≥ 45 dB contra o exato já em 4:2:0 (SC-010; a subamostragem de cor do formato não conta). Cada processo tem prazo; navegador e ffmpeg são encerrados em
 * qualquer saída. Saída 0 se todas gravaram e passaram, 1 se alguma falhou, 3 em erro de ambiente.
 */

interface VideoArgs {
    readonly scenes: readonly string[];
    readonly frames: number | undefined;
    readonly out: string;
    readonly lossless: boolean;
    readonly tenBit: boolean;
    readonly width: number;
    readonly height: number;
    readonly timeoutMs: number;
    readonly aa: string | undefined;
}

const PORT = 5184;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../videos');
/** PSNR mínimo do brilho de cada quadro decodificado contra o exato (SC-010). */
const MIN_LUMA = 50;
/** PSNR mínimo em RGB contra o quadro exato em 4:2:0 (a perda do codificador). */
const MIN_RGB = 45;
/** Prazo do ffmpeg para fechar o arquivo depois do último quadro. */
const FFMPEG_CLOSE_MS = 120_000;

function parse(argv: readonly string[]): VideoArgs {
    const scenes: string[] = [];
    let frames: number | undefined;
    let out = OUT;
    let lossless = false;
    let tenBit = false;
    let width = 1280;
    let height = 720;
    let timeoutMs = 900_000;
    let aa: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] ?? '';
        if (a === '--frames') {
            frames = Number(argv[++i]);
            if (!Number.isInteger(frames) || frames < 1)
                throw new Error('--frames espera inteiro ≥ 1');
        } else if (a === '--out') out = argv[++i] ?? OUT;
        else if (a === '--lossless') lossless = true;
        else if (a === '--10bit') tenBit = true;
        else if (a === '--size') {
            const m = /^(\d+)x(\d+)$/.exec(argv[++i] ?? '');
            if (m === null) throw new Error('--size espera LxA (ex.: 1280x720)');
            width = Number(m[1]);
            height = Number(m[2]);
        } else if (a === '--timeout') {
            const v = Number(argv[++i]);
            if (!Number.isFinite(v) || v <= 0) throw new Error('--timeout espera segundos > 0');
            timeoutMs = v * 1000;
        } else if (a === '--aa') aa = argv[++i];
        else if (a.startsWith('--')) throw new Error(`opção desconhecida: ${a}`);
        else scenes.push(...a.split(',').filter((n) => n.length > 0));
    }
    if (scenes.length === 0)
        throw new Error('informe ao menos uma cena (ex.: npm run video -- lente)');
    return { scenes, frames, out, lossless, tenBit, width, height, timeoutMs, aa };
}

function requireFfmpeg(): void {
    if (spawnSync('ffmpeg', ['-version']).status !== 0)
        throw new EnvironmentError('ffmpeg não encontrado no PATH.');
}

/** Um ffmpeg lendo quadros crus do `stdin`. */
interface Encoder {
    readonly proc: ChildProcessWithoutNullStreams;
    readonly done: Promise<void>;
    stderr: string;
}

function encoder(args: readonly string[]): Encoder {
    const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
    const e: Encoder = {
        proc,
        stderr: '',
        done: new Promise<void>((resolve, reject) => {
            proc.on('error', reject);
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg saiu com ${code}: ${e.stderr.trim()}`));
            });
        }),
    };
    proc.stderr.on('data', (d: Buffer) => {
        e.stderr += d.toString();
    });
    return e;
}

/** Escreve respeitando o `drain` (o ffmpeg mais lento que a página não acumula memória sem limite). */
async function write(e: Encoder, bytes: Buffer): Promise<void> {
    if (e.proc.stdin.write(bytes)) return;
    await new Promise<void>((resolve) => e.proc.stdin.once('drain', resolve));
}

/** Espera o processo terminar, no prazo; senão o mata. */
async function closeWithin(e: Encoder, ms: number): Promise<void> {
    e.proc.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            e.done,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`ffmpeg não terminou em ${ms / 1000} s`));
                }, ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Formato do canvas → formato de pixel do ffmpeg (e se precisa converter de meia precisão para 16 bits). */
function pixelFormat(format: string): { pixFmt: string; half: boolean } {
    if (format === 'bgra8unorm') return { pixFmt: 'bgra', half: false };
    if (format === 'rgba8unorm') return { pixFmt: 'rgba', half: false };
    if (format === 'rgba16float') return { pixFmt: 'rgba64le', half: true };
    throw new Error(`formato de canvas não suportado: ${format}`);
}

/** Meia precisão (IEEE 754 binary16) → [0, 1] em u16 (o canvas guarda o sRGB codificado em [0, 1]). */
function halfToU16(src: Buffer): Buffer {
    const out = Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i += 2) {
        const h = src.readUInt16LE(i);
        const e = (h >> 10) & 0x1f;
        const m = h & 0x3ff;
        const v = e === 0 ? (m / 1024) * 2 ** -14 : e === 31 ? 1 : (1 + m / 1024) * 2 ** (e - 15);
        const s = h & 0x8000 ? 0 : v;
        out.writeUInt16LE(Math.round(Math.min(1, Math.max(0, s)) * 65535), i);
    }
    return out;
}

/** PSNR mínimo (em RGB) dos quadros do vídeo contra os exatos. */
/** Fidelidade do vídeo contra os quadros exatos (mínimos por quadro, em dB). */
interface Fidelity {
    /** Brilho (luma Y) do vídeo contra o exato convertido para o mesmo YUV. */
    readonly luma: number;
    /** RGB do vídeo contra o exato convertido para 4:2:0 e de volta (a perda do codificador, sem a do formato). */
    readonly rgb: number;
}

/** Roda um grafo de comparação do ffmpeg e devolve o mínimo por quadro do campo pedido. */
function psnrMin(
    video: string,
    exact: string,
    graph: string,
    field: 'psnr_y' | 'psnr_avg',
): number {
    const r = spawnSync(
        'ffmpeg',
        ['-loglevel', 'error', '-i', video, '-i', exact, '-lavfi', graph, '-f', 'null', '-'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: FFMPEG_CLOSE_MS },
    );
    if (r.status !== 0) throw new Error(`psnr falhou: ${r.stderr}`);
    const values = [...r.stdout.matchAll(new RegExp(`${field}:(\\S+)`, 'g'))].map((m) =>
        m[1] === 'inf' ? Infinity : Number(m[1]),
    );
    if (values.length === 0) throw new Error('psnr: nenhum quadro comparado');
    return Math.min(...values);
}

/**
 * Fidelidade (SC-010, decisão do usuário em 2026-10-20): o brilho do vídeo contra o do exato (≥ 50 dB) e o RGB contra
 * o exato já em 4:2:0 (≥ 45 dB) — a subamostragem de cor do formato que abre no celular não conta contra o vídeo.
 * Pela ordem dos quadros (o .mkv guarda o tempo em ms e desalinha a 60 FPS), BT.709 em faixa limitada, na
 * profundidade do vídeo (reduzir 16 bits a 8 aplica dither em cada lado e mediria ruído que não existe).
 */
function fidelity(video: string, exact: string, deep: boolean): Fidelity {
    const yuv = deep ? 'yuv420p10le' : 'yuv420p';
    const rgb = deep ? 'rgb48le' : 'rgb24';
    const order = 'setpts=N/(60*TB)';
    const toYuv = `scale=out_color_matrix=bt709:out_range=tv,format=${yuv}`;
    const toRgb = `scale=in_color_matrix=bt709:in_range=tv,format=${rgb}`;
    const luma = psnrMin(
        video,
        exact,
        `[0:v]${order},format=${yuv}[a];[1:v]${order},${toYuv}[b];[a][b]psnr=stats_file=-`,
        'psnr_y',
    );
    const color = psnrMin(
        video,
        exact,
        `[0:v]${order},${toRgb}[a];[1:v]${order},${toYuv},${toRgb}[b];[a][b]psnr=stats_file=-`,
        'psnr_avg',
    );
    return { luma, rgb: color };
}

async function record(
    args: VideoArgs,
    scene: string,
    page: Page,
    state: {
        onStart?: (w: number, h: number, f: string) => Promise<void>;
        onFrame?: (i: number, b64: string) => Promise<void>;
    },
): Promise<{ frames: number; fidelity: Fidelity; files: string[] }> {
    const files: string[] = [];
    const encoders: Encoder[] = [];
    let half = false;
    let frames = 0;
    const exact = join(args.out, `${scene}-lossless.mkv`);
    state.onStart = (w, h, format) => {
        const px = pixelFormat(format);
        half = px.half;
        const input = [
            '-f',
            'rawvideo',
            '-pix_fmt',
            px.pixFmt,
            '-s',
            `${w}x${h}`,
            '-r',
            '60',
            '-i',
            '-',
        ];
        const mp4 = join(args.out, args.tenBit ? `${scene}-10bit.mp4` : `${scene}.mp4`);
        const codec = args.tenBit
            ? [
                  '-c:v',
                  'libx265',
                  '-pix_fmt',
                  'yuv420p10le',
                  '-crf',
                  '8',
                  '-preset',
                  'slow',
                  '-tag:v',
                  'hvc1',
              ]
            : [
                  '-c:v',
                  'libx264',
                  '-profile:v',
                  'high',
                  '-pix_fmt',
                  'yuv420p',
                  '-crf',
                  '8',
                  '-preset',
                  'slow',
              ];
        // Conversão RGB → YUV explícita em BT.709, faixa limitada (a que o vídeo declara; o padrão do ffmpeg é BT.601).
        const color = [
            '-vf',
            'scale=out_color_matrix=bt709:out_range=tv',
            '-color_range',
            'tv',
            '-colorspace',
            'bt709',
            '-color_primaries',
            'bt709',
            '-color_trc',
            'iec61966-2-1',
        ];
        encoders.push(encoder([...input, ...codec, ...color, '-movflags', '+faststart', mp4]));
        encoders.push(encoder([...input, '-c:v', 'ffv1', '-level', '3', exact]));
        files.push(mp4, exact);
        return Promise.resolve();
    };
    state.onFrame = async (_i, b64) => {
        const raw = Buffer.from(b64, 'base64');
        const bytes = half ? halfToU16(raw) : raw;
        for (const e of encoders) await write(e, bytes);
        frames++;
    };
    const query = new URLSearchParams({
        scene,
        w: String(args.width),
        h: String(args.height),
        ...(args.tenBit ? { bits: '16' } : {}),
        ...(args.frames !== undefined ? { frames: String(args.frames) } : {}),
        ...(args.aa !== undefined ? { aa: args.aa } : {}),
    });
    const server = `http://localhost:${PORT}/`;
    await page.goto(`${server}recorder.html?${query.toString()}`);
    const started = Date.now();
    let text = '';
    try {
        while (Date.now() - started < args.timeoutMs) {
            text = (await page.locator('#log').textContent()) ?? '';
            if (text.includes('FAIL:') || text.includes('VIDEO DONE')) break;
            await page.waitForTimeout(250);
        }
        if (!text.includes('VIDEO DONE'))
            throw new Error(
                text.includes('FAIL:') ? text.slice(text.indexOf('FAIL:')) : 'prazo esgotado',
            );
        for (const e of encoders) await closeWithin(e, FFMPEG_CLOSE_MS);
        // O que a página mediu (o tempo de GPU por quadro).
        for (const line of text.split('\n'))
            if (line.includes('GPU por quadro')) console.log(`  ${line}`);
    } finally {
        for (const e of encoders) if (e.proc.exitCode === null) e.proc.kill('SIGKILL');
    }
    const [video] = files;
    if (video === undefined) throw new Error('nenhum quadro recebido');
    const result = fidelity(video, exact, args.tenBit);
    if (!args.lossless) {
        await rm(exact, { force: true });
        files.pop();
    }
    return { frames, fidelity: result, files };
}

async function main(): Promise<number> {
    const args = parse(process.argv.slice(2));
    try {
        requireFfmpeg();
    } catch (e) {
        console.error((e as Error).message);
        return 3;
    }
    await mkdir(args.out, { recursive: true });
    let server;
    let launched;
    try {
        server = await startServer(PORT);
        launched = await launchBrowser(true);
    } catch (e) {
        await server?.close();
        if (e instanceof EnvironmentError) {
            console.error(e.message);
            return 3;
        }
        throw e;
    }
    const failed: string[] = [];
    try {
        for (const scene of args.scenes) {
            const context = await launched.browser.newContext({
                viewport: { width: 800, height: 600 },
            });
            const state: Parameters<typeof record>[3] = {};
            await context.exposeFunction('__videoStart', (w: number, h: number, f: string) =>
                state.onStart?.(w, h, f),
            );
            await context.exposeFunction('__videoFrame', (i: number, b64: string) =>
                state.onFrame?.(i, b64),
            );
            const page = await context.newPage();
            page.on('pageerror', (err) => {
                console.error(`  [pageerror] ${err.message}`);
            });
            console.log(`▶ ${scene}`);
            try {
                const r = await record(args, scene, page, state);
                const ok = r.fidelity.luma >= MIN_LUMA && r.fidelity.rgb >= MIN_RGB;
                console.log(
                    `${ok ? '✔' : '✘'} ${scene}: ${r.frames} quadros, brilho ${r.fidelity.luma.toFixed(2)} dB (≥ ${MIN_LUMA}), RGB contra o exato em 4:2:0 ${r.fidelity.rgb.toFixed(2)} dB (≥ ${MIN_RGB}) → ${r.files.join(', ')}`,
                );
                if (!ok) failed.push(scene);
            } catch (e) {
                console.log(`✘ ${scene}: ${(e as Error).message}`);
                failed.push(scene);
            } finally {
                await context.close().catch(() => undefined);
            }
        }
    } finally {
        await launched.shutdown();
        await server.close();
    }
    if (failed.length > 0) console.error(`Falharam: ${failed.join(', ')}`);
    return failed.length > 0 ? 1 : 0;
}

main().then(
    (code) => process.exit(code),
    (e: unknown) => {
        console.error(e);
        process.exit(1);
    },
);
