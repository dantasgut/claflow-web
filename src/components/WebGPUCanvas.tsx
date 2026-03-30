import { useEffect, useRef } from 'react';
import {
    Scene, Mesh, Entity,
    PerspectiveCamera,
    BoxGeometry, SphereGeometry, PlaneGeometry,
    StandardMaterial, WireframeMaterial,
    WebGPURenderer,
    PhysicsWorld, RigidBody, SphereShape, BoxShape, PlaneShape,
    ConstantForce,
    AmbientLight, DirectionalLight,
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
            camera.position[0] = 1;
            camera.position[1] = 1.5;
            camera.position[2] = 11;
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

            // ── Física GPU-only ───────────────────────────────────────────────
            const params = new URLSearchParams(window.location.search);
            const profilerInterval = parseInt(params.get('profilerInterval') ?? '60', 10);

            const world = new PhysicsWorld({
                substeps: 8,
                rigidBody: {
                    iterations: 10,
                    restitutionThreshold: 0.5,   // quica a partir de 0.5 m/s de aproximação
                    baumgarteBeta: 0.1,           // menor beta → menos oscilação ao repousar
                    sleepLinThreshold: 0.1,       // dorme a 0.1 m/s — elimina oscilação residual
                    profilerLogInterval: profilerInterval,
                },
                softBody: {
                    iterations: 15,
                    restitution: 0.05,
                    profilerLogInterval: profilerInterval,
                },
                fem: {
                    substeps: 20,
                    iterations: 20,
                },
            });
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
            ground.addPhysics(new RigidBody({ mass: 1.0, friction: 0.8, isKinematic: true }));
            ground.addPhysics(new PlaneShape([0, 1, 0], 0, 6, 6));
            scene.add(ground);

            // ── Pano XPBD (20×20 = 441 partículas, ~800 constraints) ─────
            // Elevado a y=10 — acima do bastão (y=6, h=4) e da esfera (y=5).
            // Cai sob gravidade, drapa sobre os corpos rígidos e colide com o
            // chão — permite validar que nenhum objeto atravessa o outro.
            /*const SEGS = 20;
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
            scene.add(cloth);*/

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
            bastao.addPhysics(new RigidBody({ mass: 1.0, friction: 0.2, restitution: 0.4, linearDamping: 0.05, angularDamping: 0.4 }));
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
            cubo.addPhysics(new RigidBody({ mass: 1.0, friction: 0.8, restitution: 0.3, linearDamping: 0.05, angularDamping: 0.1 }));
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
            esfera.position[2] = 3.0;  // separada de bastão/cubo (z=-1) para não ser empurrada
            esfera.addPhysics(new RigidBody({ mass: 1.2, friction: 0.4, restitution: 0.5, linearDamping: 0.05, angularDamping: 0.4 }));
            esfera.addPhysics(new SphereShape(0.5));
            scene.add(esfera);

            // ── Plataforma gelatina FEM ───────────────────────────────────
            /*const { youngsModulus: E, poissonsRatio: nu } = GEL_MATERIAL;
            const mu = E / (2 * (1 + nu));
            const lambda = E * nu / ((1 + nu) * (1 - 2 * nu));

            const gelGeo = new FEMBoxGeometry(
                GEL_MESH.width, GEL_MESH.height, GEL_MESH.depth,
                GEL_MESH.cellsX, GEL_MESH.cellsY, GEL_MESH.cellsZ,
                0,     // offsetX
                0.02,  // offsetY — base em y=0.02 (quase no chão), impacto mínimo
                -1,    // offsetZ
            );

            const platform = new Mesh(
                gelGeo,
                new StandardMaterial({ color: GEL_MESH.color, roughness: GEL_MESH.roughness }),
            );

            const gelBody = new FEMBody({
                mass: GEL_MATERIAL.mass,
                mu,
                lambda,
                damping: GEL_MATERIAL.damping,
                collisionRadius: GEL_MATERIAL.collisionRadius,
                restitution: GEL_MATERIAL.restitution,
            });

            const { nodes, elements } = boxToFEMBody(
                GEL_MESH.width, GEL_MESH.height, GEL_MESH.depth,
                GEL_MESH.cellsX, GEL_MESH.cellsY, GEL_MESH.cellsZ,
                // Sem pinnedBottom: todos os nós livres caem até o chão.
                // O FEM collision kernel cuida do contato com a PlaneShape.
                { offsetX: 0, offsetY: 0.02, offsetZ: -1 },
            );
            gelBody.nodes = nodes;
            gelBody.elements = elements;

            platform.addPhysics(gelBody);
            scene.add(platform);*/

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
