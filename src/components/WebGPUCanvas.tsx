import { useEffect, useRef } from 'react';
import {
    Scene, Mesh, Entity,
    PerspectiveCamera,
    BoxGeometry, SphereGeometry, PlaneGeometry,
    StandardMaterial, WireframeMaterial,
    WebGPURenderer,
    PhysicsWorld, RigidBody, SoftBody, SphereShape, BoxShape, PlaneShape,
    CPURigidBodySolver, XPBDSoftBodySolver, ConstantForce, CollisionAlgorithmType, ResolutionType,
    AmbientLight, DirectionalLight,
    type ResolutionConfig, type SoftBodySimConfig,
} from 'webgpu-engine';
export function WebGPUCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let rafId = 0;
        let running = true;

        async function init() {
            // ── Câmera e cena ─────────────────────────────────────────────
            const scene = new Scene();
            const camera = new PerspectiveCamera(Math.PI / 4, canvas!.width / canvas!.height, 0.1, 100);
            camera.position[0] = 3;
            camera.position[1] = 5;
            camera.position[2] = 12;
            scene.add(camera);

            // ── Luzes ─────────────────────────────────────────────────────
            const ambient = new Entity();
            ambient.add(new AmbientLight([1, 1, 1], 0.2));
            scene.add(ambient);

            const sun = new Entity();
            const sunLight = new DirectionalLight([1.0, 0.95, 0.85], 1.2);
            sunLight.direction[0] = 0.5;
            sunLight.direction[1] = -1.0;
            sunLight.direction[2] = -0.3;
            sun.add(sunLight);
            scene.add(sun);

            // ── Física — pipelines independentes para RigidBody e SoftBody ────
            //
            // RigidBody pipeline — selecionável via ?rb=si|impulse|xpbd|lcp
            //   si (default):  Sequential Impulse — PGS k=10, warm start, estável em pilhas
            //   impulse:       1-pass impulse resolver — simples, menos estável em empilhamento
            //   xpbd:          Position-Based (XPBD) — predict/solve/velocity-recovery
            //   lcp:           PGS-LCP GPU — formulação formal LCP com warm start e Baumgarte
            //
            // SoftBody pipeline — sempre XPBD (único backend implementado)
            //   Independente do pipeline rígido. Futuros backends: GPU spring-mass, FEM, MPM.

            const params   = new URLSearchParams(window.location.search);
            const rbParam  = params.get('rb') ?? 'si';
            const profilerInterval = parseInt(params.get('profilerInterval') ?? '60', 10);
            const rigidResolutionType: ResolutionType =
                rbParam === 'xpbd'    ? ResolutionType.XPBD :
                rbParam === 'impulse' ? ResolutionType.IMPULSE :
                rbParam === 'lcp'     ? ResolutionType.LCP :
                                        ResolutionType.SEQUENTIAL_IMPULSE;

            // ── Pipeline RigidBody ────────────────────────────────────────────
            const rigidResolution: ResolutionConfig = {
                type: rigidResolutionType,
                restitution: 0.1,
                restitutionThreshold: 1.5,
                friction: 0.5,
                // SI: iterações PGS + warm start
                iterations: 10,
                warmStarting: true,
                // XPBD: compliance da constraint de contato + escala de correção angular
                compliance: 1e-4,
                // 0.1: correção angular suave — estabiliza contatos face-chão durante
                // tombamento sem travar o bastão na vertical (0=livre demais, 1=trava).
                angularCorrectionScale: 0.1,
            };

            // ── Pipeline SoftBody — GPU compute XPBD ─────────────────────────
            const softBodyConfig: SoftBodySimConfig = {
                resolution: { type: ResolutionType.XPBD },
                iterations: 15,
                backend: 'gpu',
                restitution: 0.05,
            };

            const world = new PhysicsWorld({
                collision: {
                    narrowphase: { boxBox: CollisionAlgorithmType.SAT },
                    // Contatos especulativos: detecta colisão na posição prevista
                    // para corpos rápidos, prevenindo tunneling do bastão ao tombar.
                    predictiveContacts: true,
                    predictiveContactsThreshold: 2.0,
                },
                rigidBody: { resolution: rigidResolution, backend: 'gpu', profilerLogInterval: profilerInterval },
                softBody: { ...softBodyConfig, profilerLogInterval: profilerInterval },
            });
            world.setSolver('RigidBody', new CPURigidBodySolver());
            world.setSolver('SoftBody', new XPBDSoftBodySolver());
            world.addForce(new ConstantForce('gravity', new Float32Array([0, -9.81, 0])));

            // ── Renderer — recebe o mundo GPU para que encodeSyncPasses funcione ──
            // O renderer chama world.step() internamente; não chamar world.step() no tick.
            const renderer = new WebGPURenderer(world);
            await renderer.initialize(canvas!);
            renderer.setClearColor(0.08, 0.08, 0.12, 1.0);

            // ── Chão finito 12×12 ─────────────────────────────────────────
            // PlaneShape(normal, offset, halfWidth, halfDepth) respeita limites.
            // Objetos fora de ±6 em X ou Z caem no vazio.
            const ground = new Mesh(
                new PlaneGeometry(12, 12),
                new StandardMaterial({ color: [0.25, 0.25, 0.30, 1] }),
            );
            ground.addPhysics(new RigidBody({ mass: 0, friction: 0.8, isKinematic: true }));
            ground.addPhysics(new PlaneShape([0, 1, 0], 0, 6, 6));
            scene.add(ground);

            // ── Pano XPBD (20×20 = 441 partículas, ~800 constraints) ─────
            // Elevado a y=10 — acima do bastão (y=6, h=4) e da esfera (y=5).
            // Cai sob gravidade, drapa sobre os corpos rígidos e colide com o
            // chão — permite validar que nenhum objeto atravessa o outro.
            const SEGS = 20;
            const clothGeo = new PlaneGeometry(6, 6, SEGS, SEGS);
            const clothBody = new SoftBody({
                mass: 1.0,
                compliance: 1e-5,
                damping: 0.02,
                particleRadius: 0.12,
                offset: [0, 10, -1],
                targetGeometry: clothGeo,
            });
            const cloth = new Mesh(clothGeo, new StandardMaterial({ color: [0.9, 0.2, 0.2, 1], roughness: 0.5 }));
            cloth.addPhysics(clothBody);
            scene.add(cloth);

            // ── Bastão quase vertical (chão, lado esquerdo) ───────────────
            // Cai no chão com 12° de inclinação. O primeiro contato gera
            // impulso angular — a gravidade no CM decide para qual lado cai.
            // Longe da plataforma e dos outros objetos para não interagir.
            const anguloBastao = Math.PI * 12 / 180;
            const bastao = new Mesh(
                new BoxGeometry(0.4, 4.0, 0.4),
                new StandardMaterial({ color: [0.9, 0.2, 0.2, 1], roughness: 0.5 }),
            );
            bastao.position[0] = 2;
            bastao.position[1] = 6.0;
            bastao.position[2] = -1;
            bastao.rotation[2] = Math.sin(anguloBastao / 2);
            bastao.rotation[3] = Math.cos(anguloBastao / 2);
            bastao.addPhysics(new RigidBody({ mass: 1.0, friction: 0.2, linearDamping: 0.01, angularDamping: 0.4 }));
            bastao.addPhysics(new BoxShape(0.2, 2.0, 0.2));
            scene.add(bastao);

            // ── Cubo inclinado (plataforma) ───────────────────────────────
            // 30° de inclinação em Z: a aresta inferior direita toca primeiro
            // a plataforma → impulso off-center → rotação visível → rola e cai.
            const anguloCubo = Math.PI * 30 / 180;
            const cubo = new Mesh(
                new BoxGeometry(),
                new WireframeMaterial({ color: [0.2, 0.9, 0.4, 1], lineWidth: 2 }),
            );
            cubo.position[0] = 0.0;
            cubo.position[1] = 4.0;
            cubo.position[2] = -1.0;
            cubo.rotation[2] = Math.sin(anguloCubo / 2);
            cubo.rotation[3] = Math.cos(anguloCubo / 2);
            cubo.addPhysics(new RigidBody({ mass: 1.0, friction: 0.8, linearDamping: 0.01, angularDamping: 0.4 }));
            cubo.addPhysics(new BoxShape(0.5, 0.5, 0.5));
            scene.add(cubo);

            // ── Esfera laranja (borda da plataforma) ──────────────────────
            // Cai na borda da plataforma → rola para fora e cai no chão.
            const esfera = new Mesh(
                new SphereGeometry(0.5, 24, 16),
                new StandardMaterial({ color: [1.0, 0.55, 0.1, 1], roughness: 0.3 }),
            );
            esfera.position[0] = 1.0;
            esfera.position[1] = 5.0;
            esfera.position[2] = -1.0;
            esfera.addPhysics(new RigidBody({ mass: 1.2, friction: 0.4, linearDamping: 0.01, angularDamping: 0.4 }));
            esfera.addPhysics(new SphereShape(0.5));
            scene.add(esfera);

            // ── Cubo azul estático ────────────────────────────────────────
            const platform = new Mesh(
                new BoxGeometry(3, 1, 3),
                new StandardMaterial({ color: [0.2, 0.4, 0.9, 1], roughness: 0.6 }),
            );
            platform.position[1] = 0.5;
            platform.position[2] = -1;
            platform.addPhysics(new RigidBody({ mass: 0, isKinematic: true }));
            platform.addPhysics(new BoxShape(1.5, 0.5, 1.5));
            scene.add(platform);

            // ── Resize ────────────────────────────────────────────────────
            const onResize = () => {
                canvas!.width = canvas!.clientWidth * devicePixelRatio;
                canvas!.height = canvas!.clientHeight * devicePixelRatio;
                renderer.setSize(canvas!.width, canvas!.height);
                camera.setPerspective(Math.PI / 4, canvas!.width / canvas!.height, 0.1, 100);
            };
            window.addEventListener('resize', onResize);
            onResize();

            // ── Game loop ─────────────────────────────────────────────────
            const tick = async () => {
                if (!running) return;
                // Renderer gerencia dt e world.step() internamente — não chamar world.step() aqui
                await renderer.render(scene, camera);
                rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);

            return () => window.removeEventListener('resize', onResize);
        }

        let cleanup: (() => void) | undefined;
        init().then(fn => { cleanup = fn; });

        return () => {
            running = false;
            cancelAnimationFrame(rafId);
            cleanup?.();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ display: 'block', width: '100%', height: '100%' }}
        />
    );
}
