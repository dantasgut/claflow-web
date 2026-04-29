import { useEffect, useRef } from 'react';
import {
    Application, OrbitController, InteractionSystem,
    Bloom, ToneMapping, Fxaa, Vignette,
} from 'webgpu-engine';
import {
    BoxGeometry, SphereGeometry, PlaneGeometry,
    Camera, DirectionalLight, GravityField,
    LCPFlow, RigidBody,
    StandardMaterial, Transform,
} from 'webgpu-engine';

/**
 * Demo consumer da clay-engine via clean API.
 *
 * Cena fixa: cubo + esfera + ground + RigidBody (esfera caindo) + 1
 * directional light com sombra + chain de post effects.
 *
 * Para configurações avançadas (substeps custom, FEM, MPM, cloth XPBD com
 * DistanceConstraint, etc.) veja `engine/src/main.ts` e os smokes em
 * cada fase em `feature/hardening`.
 */
export function WebGPUCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(canvas.clientWidth * dpr);
        canvas.height = Math.floor(canvas.clientHeight * dpr);

        let app: Application | null = null;
        let interaction: InteractionSystem | null = null;
        let cancelled = false;

        (async () => {
            const a = await Application.create({ canvas });
            if (cancelled) { a.dispose?.(); return; }
            app = a;

            // ── Câmera com OrbitController auto-rotate + damping ─────
            const camera = new Camera({ aspect: canvas.width / canvas.height });
            a.world.insert(camera);

            interaction = new InteractionSystem({ canvas, window }, a.events);
            interaction.attach();
            interaction.addController(new OrbitController(camera, {
                target: [0, 0.5, 0], distance: 7,
                autoRotate: true, autoRotateSpeed: 0.4,
                damping: 0.85,
            }));

            // ── Luz direcional com sombra ────────────────────────────
            a.world.insert(new DirectionalLight({
                direction: [0.4, -1, 0.6, 0],
                color: [1, 1, 0.95, 1],
                castShadow: true,
            }));

            // ── Chão ─────────────────────────────────────────────────
            const ground = new PlaneGeometry({ size: [12, 12] });
            ground.add(new StandardMaterial({ albedo: [0.4, 0.4, 0.45, 1], roughness: 0.9 }));
            ground.add(new Transform({ position: [0, -0.5, 0, 1] }));
            a.world.insert(ground);

            // ── Cubo estático ────────────────────────────────────────
            const cube = new BoxGeometry({ size: [1, 1, 1] });
            cube.add(new StandardMaterial({ albedo: [0.85, 0.4, 0.25, 1], roughness: 0.4 }));
            cube.add(new Transform({ position: [-1.5, 0, 0, 1] }));
            a.world.insert(cube);

            // ── Esfera estática ──────────────────────────────────────
            const sphere = new SphereGeometry({ radius: 0.6, latSegments: 24, lonSegments: 32 });
            sphere.add(new StandardMaterial({ albedo: [0.25, 0.65, 0.85, 1], roughness: 0.3 }));
            sphere.add(new Transform({ position: [1.5, 0, 0, 1] }));
            a.world.insert(sphere);

            // ── Física: RigidBody caindo ─────────────────────────────
            a.world.insert(new GravityField({ acceleration: [0, -9.81, 0, 0] }));
            a.world.insert(new RigidBody({ position: [0, 4, 0, 1], mass: 1.0, restitution: 0.3 }));
            a.flows.register(new LCPFlow(a.core, a.world, a.resources));

            // ── Post-processing chain ────────────────────────────────
            a.defaults.post.addEffect(new ToneMapping({ strength: 1.0 }));
            a.defaults.post.addEffect(new Bloom({ aux: [0.6, 0, 0] }));
            a.defaults.post.addEffect(new Fxaa({ strength: 0.5 }));
            a.defaults.post.addEffect(new Vignette({ strength: 0.3 }));

            a.start();
        })();

        return () => {
            cancelled = true;
            interaction?.detach();
            app?.stop();
            app?.dispose?.();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            id="gpuCanvas"
            style={{ display: 'block', width: '100%', height: '100%' }}
        />
    );
}
