import * as clayflow from 'clayflow/web';
import type { Application } from 'clayflow/web';

/** Modo da câmera: segue o tempo (o movimento da cena) ou livre (arrastar gira, roda aproxima), com o tempo andando ou não. */
export type CameraMode = 'tempo' | 'livre';

/** Velocidades do tempo oferecidas. */
export const SPEEDS = [0.25, 0.5, 1, 2] as const;

/** A câmera da cena: a entidade (para anexar o controle livre) e o `Transform` dela. */
interface SceneCamera {
    readonly entity: clayflow.Camera;
    readonly transform: clayflow.Transform;
}

function findCamera(app: Application): SceneCamera | undefined {
    for (const record of app.world.allRecords()) {
        if (!(record.root instanceof clayflow.Camera)) continue;
        const transform = record.resources.find((r) => r instanceof clayflow.Transform);
        if (transform instanceof clayflow.Transform) return { entity: record.root, transform };
    }
    return undefined;
}

/** A direção para onde a rotação `q` (x, y, z, w) olha (o −z da câmera). */
function forwardOf(q: readonly number[]): [number, number, number] {
    const [x = 0, y = 0, z = 0, w = 1] = q;
    return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/**
 * A navegação no tempo de uma cena do catálogo. O tempo é o do motor (`Time`): a pausa é a escala 0 — o laço segue
 * desenhando (a câmera responde, a imagem converge), a simulação e o movimento da cena param; o passo avança um quadro
 * de 1/60 s; a velocidade é a escala. O movimento da cena (`update(i)`, o mesmo da gravação) segue o quadro do tempo
 * simulado. A câmera segue o tempo (o roteiro da cena, ou o controle que a cena pôs nela) ou fica livre: um
 * `OrbitController` assume a câmera onde ela está, e o movimento da cena deixa de mexer nela.
 */
export class TimeNavigator {
    paused = false;
    speed = 1;
    camera: CameraMode = 'tempo';
    private free: clayflow.OrbitController | undefined;
    private readonly listeners = new Set<() => void>();
    private readonly app: Application;
    private readonly update: (i: number) => void;
    private readonly frames: number;
    /** Deslocamento do roteiro da cena em relação ao tempo simulado (quadros): a posição escolhida na linha do tempo. */
    private offset = 0;

    constructor(app: Application, update: (i: number) => void, frames: number) {
        this.app = app;
        this.update = update;
        this.frames = frames;
        this.update(0);
        app.events.on('frameTick', () => this.tick());
    }

    /**
     * O quadro do tempo simulado (passos de 1/60 s, como na gravação): o roteiro da cena anda com a física — sem
     * GPU para 60 quadros por segundo, os passos por quadro têm teto e o tempo decorrido passaria à frente dela.
     */
    get frame(): number {
        return Math.round(this.app.time.simulated * 60);
    }

    /** Quantos quadros tem o roteiro da cena (o laço). */
    get length(): number {
        return this.frames;
    }

    /** O quadro do roteiro da cena que está na tela (0 a `length` − 1): o do tempo simulado mais o deslocamento. */
    get position(): number {
        return (((this.frame + this.offset) % this.frames) + this.frames) % this.frames;
    }

    /**
     * Leva o roteiro da cena (a câmera, as luzes, o que `update` move) ao quadro `i` da linha do tempo. O tempo
     * simulado não volta: o que a simulação já fez (partículas, corpo mole) fica como está.
     */
    seek(i: number): void {
        const target = Math.min(Math.max(Math.round(i), 0), this.frames - 1);
        this.offset += target - this.position;
        this.changed();
    }

    /** Avisa quem desenha os controles. */
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    togglePause(): void {
        this.paused = !this.paused;
        this.app.time.scale = this.paused ? 0 : this.speed;
        this.changed();
    }

    setSpeed(speed: number): void {
        this.speed = speed;
        if (!this.paused) this.app.time.scale = speed;
        this.changed();
    }

    /** Um quadro adiante (1/60 s de tempo da cena), com o tempo pausado. */
    stepForward(): void {
        if (!this.paused) return;
        const running = this.app.isRunning();
        if (running) this.app.stop();
        this.app.time.scale = 1;
        this.app.step(1 / 60);
        this.app.time.scale = 0;
        if (running) this.app.start();
        this.changed();
    }

    setCamera(mode: CameraMode): void {
        if (mode === this.camera) return;
        const camera = findCamera(this.app);
        if (camera === undefined) return;
        if (mode === 'livre') {
            // A órbita em volta do ponto do eixo de visão mais perto da origem da cena, a partir de onde a câmera está.
            const eye = camera.transform.data.position.slice(0, 3) as [number, number, number];
            const f = forwardOf(camera.transform.data.rotation);
            const along = Math.max(0.5, -(eye[0] * f[0] + eye[1] * f[1] + eye[2] * f[2]));
            const target: [number, number, number] = [
                eye[0] + f[0] * along,
                eye[1] + f[1] * along,
                eye[2] + f[2] * along,
            ];
            this.free = new clayflow.OrbitController({ target, eye, damping: 0.85 });
            this.app.world.attach(camera.entity, this.free);
        } else if (this.free !== undefined) {
            this.app.world.detach(camera.entity, this.free);
            this.free = undefined;
        }
        this.camera = mode;
        this.changed();
    }

    /**
     * O movimento da cena no quadro do tempo. Com a câmera livre, o roteiro da cena segue movendo o resto (as luzes, as
     * peças), mas o que ele escreve na câmera vai para um rascunho: a pose dela tem um dono só, o controle livre (antes
     * o roteiro escrevia a pose dele e ela era desfeita no mesmo quadro: duas mudanças de câmera por quadro).
     */
    private tick(): void {
        const camera = this.free === undefined ? undefined : findCamera(this.app);
        if (camera === undefined) {
            this.update(this.position);
            return;
        }
        const live = camera.transform.data;
        const draft = { ...live, position: [...live.position], rotation: [...live.rotation] };
        Object.defineProperty(camera.transform, 'data', {
            configurable: true,
            get: () => draft,
            set: () => undefined,
        });
        try {
            this.update(this.position);
        } finally {
            // Tira o rascunho: volta o acessor do motor (o do protótipo).
            delete (camera.transform as { data?: unknown }).data;
        }
    }

    private changed(): void {
        for (const l of this.listeners) l();
    }
}
