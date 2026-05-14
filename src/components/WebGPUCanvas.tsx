import { useEffect, useRef } from 'react';
import {
    Application, OrbitController, InteractionSystem,
    Bloom, ToneMapping, Fxaa, Vignette,
} from 'webgpu-engine';
import {
    BoxGeometry, SphereGeometry, PlaneGeometry,
    BoxCollider, PlaneCollider, SphereCollider,
    Camera, DirectionalLight, GravityField,
    LCPFlow, RigidBody, LCPSchema,
    StandardMaterial, Transform,
} from 'webgpu-engine';

const FLOOR_Y = -0.5;
const PLATFORM_Y = 0;
const BALL_RADIUS = 0.4;
const BAT_HALF_HEIGHT = 0.75;

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

            const camera = new Camera({ aspect: canvas.width / canvas.height });
            a.world.insert(camera);

            interaction = new InteractionSystem({ canvas, window }, a.events);
            interaction.attach();
            interaction.addController(new OrbitController(camera, {
                target: [0, 1, 0], distance: 8,
                autoRotate: true, autoRotateSpeed: 0.3,
                damping: 0.85,
            }));

            a.world.insert(new DirectionalLight({
                direction: [0.4, -1, 0.6, 0],
                color: [1, 1, 0.95, 1],
                castShadow: true,
            }));

            const floor = new PlaneGeometry({ size: [12, 12] });
            floor.add(new StandardMaterial({ albedo: [0.35, 0.35, 0.4, 1], roughness: 0.95 }));
            floor.add(new Transform({ position: [0, FLOOR_Y, 0, 1] }));
            floor.add(new PlaneCollider({ normal: [0, 1, 0, 0], offset: FLOOR_Y }));
            a.world.insert(floor);

            const platformHalf: [number, number, number, number] = [1.5, 0.15, 1.5, 0];
            const platform = new BoxGeometry({ size: [3, 0.3, 3] });
            platform.add(new StandardMaterial({ albedo: [0.55, 0.4, 0.25, 1], roughness: 0.7 }));
            platform.add(new Transform({ position: [0, PLATFORM_Y, 0, 1] }));
            platform.add(new BoxCollider({ halfExtents: platformHalf, center: [0, 0, 0, 1] }));
            a.world.insert(platform);

            const ball = new SphereGeometry({ radius: BALL_RADIUS, latSegments: 24, lonSegments: 32 });
            ball.add(new StandardMaterial({ albedo: [0.9, 0.25, 0.25, 1], roughness: 0.35 }));
            ball.add(new Transform({ position: [-0.4, 4, 0, 1] }));
            ball.add(new RigidBody({
                schema: LCPSchema,
                data: {
                    pos: [-0.4, 4, 0, 1.0],
                    rot: [0, 0, 0, 1],
                    rot_pred: [0, 0, 0, 1],
                    I_inv: [1, 1, 1, 0],
                    mat_props: [0.45, 0.3, 0.05, 0.05],
                    body_shape: [0, BALL_RADIUS, BALL_RADIUS, BALL_RADIUS],
                },
            }));
            ball.add(new SphereCollider({ radius: BALL_RADIUS, center: [0, 0, 0, 1] }));
            a.world.insert(ball);

            const batHalf: [number, number, number, number] = [0.075, BAT_HALF_HEIGHT, 0.075, 0];
            const bat = new BoxGeometry({ size: [0.15, BAT_HALF_HEIGHT * 2, 0.15] });
            bat.add(new StandardMaterial({ albedo: [0.85, 0.75, 0.4, 1], roughness: 0.4 }));
            bat.add(new Transform({ position: [0.6, 5.5, 0, 1] }));
            bat.add(new RigidBody({
                schema: LCPSchema,
                data: {
                    pos: [0.6, 5.5, 0, 0.8],
                    rot: [0, 0, 0, 1],
                    rot_pred: [0, 0, 0, 1],
                    I_inv: [1, 1, 1, 0],
                    mat_props: [0.3, 0.4, 0.05, 0.1],
                    body_shape: [1, batHalf[0], batHalf[1], batHalf[2]],
                },
            }));
            bat.add(new BoxCollider({ halfExtents: batHalf, center: [0, 0, 0, 1] }));
            a.world.insert(bat);

            a.world.insert(new GravityField({ acceleration: [0, -9.81, 0, 0] }));
            a.flows.register(new LCPFlow(a.core, a.world, a.resources));

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
