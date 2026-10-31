/**
 * A água em tempo real numa janela nativa (spec 038, `clayflow/deno`): a cena do tanque (a barragem PBF, a caixa
 * submersa, as paredes de vidro, o spray e as cáusticas) com a câmera orbital.
 * Arrastar: girar · roda: aproximar · espaço: pausar a simulação · R: recomeçar · fechar a janela: sair.
 * O FPS, a GPU por quadro e a velocidade da simulação saem no terminal a cada meio segundo.
 *
 *   deno task agua [largura altura]      (padrão 960 540, um pixel por ponto)
 */
import {
    Application,
    Camera,
    EnvironmentMap,
    GlobalIllumination,
    OrbitController,
    Transform,
    createScene,
} from 'clayflow/deno';
import { decodeHdr } from '../src/scenes/support/hdr.ts';
import { waterScene } from '../src/scenes/support/waterScene.ts';

/** A escala da panorâmica na cena (a mesma da cena `agua` do app). */
const ENVIRONMENT_INTENSITY = 0.6;

const [w, h] = Deno.args.map(Number);
const W = Number.isInteger(w) && w! > 0 ? w! : 960;
const H = Number.isInteger(h) && h! > 0 ? h! : 540;

async function open(): Promise<'restart' | 'close'> {
    const app = await Application.create({
        window: { title: 'clayflow — água', width: W, height: H, highDpi: false },
        scene: createScene(),
        profiling: 'frame',
        captureErrors: true,
    });
    // O que o motor recusar no Deno (o compilador de WGSL do wgpu, o naga, é mais estrito que o do Chrome): cada
    // erro uma vez, no terminal.
    const seen = new Set<string>();
    app.events.on('engineError', (e) => {
        const line = `${e.stage}: ${e.message}`;
        if (seen.has(line)) return;
        seen.add(line);
        console.error(`ERRO ${line.slice(0, 600)}`);
    });
    const camera = new Camera({ fov: Math.PI / 4, aspect: W / H, aspectMode: 'fixed', near: 0.05, far: 50 })
        .add(new Transform())
        .add(new OrbitController({ target: [0, 0.2, 0], distance: 2.8, damping: 0.85 }));
    waterScene(app, { width: W, height: H, box: true, camera, material: { ripple: { strength: 0.12 } } });
    // A imagem do mundo (panorâmica HDR, Poly Haven, CC0) para a água e o vidro refletirem; ela é o fundo.
    app.defaults.ambient.background = false;
    const hdr = decodeHdr(await Deno.readFile(new URL('../public/env/quarry_cloudy_1k.hdr', import.meta.url)));
    app.world.insert(new EnvironmentMap({ ...hdr, intensity: ENVIRONMENT_INTENSITY }));
    // A luz global (spec 033): as sondas de irradiância pela cena.
    app.world.insert(new GlobalIllumination({ quality: 'medium', probeSpacing: 0.4 }));
    // O traçado da água e do vidro não sorteia o lobo (spec 039): o filtro do sinal só borraria o que se vê.
    app.defaults.renderer.temporalFilter.enabled = false;
    console.log('compilando…');
    await app.whenReady({ timeoutMs: 300_000 });
    console.log('arrastar: girar · roda: aproximar · espaço: pausar · R: recomeçar · fechar a janela: sair');

    let frames = 0;
    let gpuSum = 0;
    let last = performance.now();
    let simLast = app.time.simulated;
    let paused = false;
    app.events.on('gpuFrameTimed', (e) => {
        frames++;
        gpuSum += e.totalMs;
    });
    app.events.on('frameComplete', () => {
        const now = performance.now();
        if (now - last < 500) return;
        const fps = (frames * 1000) / (now - last);
        const gpu = frames > 0 ? gpuSum / frames : 0;
        const rate = (app.time.simulated - simLast) / ((now - last) / 1000);
        console.log(
            `água PBF · ${W}×${H} · ${fps.toFixed(1)} FPS · GPU ${gpu.toFixed(1)} ms/quadro · simulação ${(100 * rate).toFixed(0)} % do tempo real${paused ? ' · pausada' : ''}`,
        );
        frames = 0;
        gpuSum = 0;
        last = now;
        simLast = app.time.simulated;
    });
    let outcome: 'restart' | 'close' = 'close';
    app.events.on('keyDown', (e) => {
        if (e.code === 'Space') {
            paused = !paused;
            if (paused) app.time.pausePhysics();
            else app.time.resumePhysics();
        } else if (e.code === 'KeyR') {
            outcome = 'restart';
            app.stop();
        }
    });
    const closed = app.run();
    // R para o laço sem fechar a janela: espera um dos dois.
    await Promise.race([
        closed,
        new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                if (outcome === 'restart') {
                    clearInterval(timer);
                    resolve();
                }
            }, 50);
            void closed.then(() => clearInterval(timer));
        }),
    ]);
    app.dispose();
    return outcome;
}

while ((await open()) === 'restart') console.log('recomeçando…');
