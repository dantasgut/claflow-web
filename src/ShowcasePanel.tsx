import { useEffect, useState, type CSSProperties } from 'react';
import { nodes } from 'clayflow/web';
import type { Application, MaterialName, NodeDefinition } from 'clayflow/web';
import type { GraphEdit, Param, Value } from './MaterialNodes';
import { MaterialWorkbench, type ActiveMaterial } from './MaterialWorkbench';
import { projectSphere } from './project';
import { MATERIAL_FAMILIES, showcasePieces, type ShowcasePiece } from './scenes/materiais';

// Os materiais das cenas `vitrine-<família>`: a lista dos materiais da família no topo do inspetor (à direita);
// escolhido um (na lista ou com um clique na peça, no canvas), a bancada do material — a miniatura, os parâmetros
// (editáveis ao vivo naquela peça da cena, sem recompilar) e, embaixo, o grafo de nós de que é feito.

/**
 * A peça da vitrine sob o ponto (`px`, `py`, em pixels do canvas): cada peça é o disco do centro e do raio projetados
 * pela câmera da cena como ela está no quadro (a que segue o tempo ou a livre); a mais próxima vence.
 */
function pieceAt(app: Application, canvas: HTMLCanvasElement, px: number, py: number): string | undefined {
    let best: string | undefined;
    let nearest = Infinity;
    for (const [name, piece] of showcasePieces(app)) {
        const p = projectSphere(app, canvas, piece.at, piece.radius);
        if (p === undefined || p.z >= nearest || Math.hypot(px - p.x, py - p.y) > p.r) continue;
        best = name;
        nearest = p.z;
    }
    return best;
}

/** O material ativo de uma peça da vitrine: os valores são os do motor (a função do material da peça), mudados no lugar. */
function activeOf(name: MaterialName, piece: ShowcasePiece, changed: () => void): ActiveMaterial {
    const params = (nodes.material[name] as NodeDefinition).params as Readonly<Record<string, Param>>;
    const change = (key: string, value: Value): void => {
        piece.material.values[key] = value;
        // O relevo é um só para a cor e a geometria: o mesmo valor no deslocamento, quando ele tem o parâmetro.
        if (piece.displacement !== undefined && key in piece.displacement.params) {
            piece.displacement.values[key] = value;
        }
        changed();
    };
    const edit: GraphEdit = {
        params,
        value: (key) => (piece.material.values[key] as Value | undefined) ?? params[key]?.default ?? 0,
        change,
    };
    return {
        name,
        edit,
        reset() {
            for (const key of Object.keys(params)) {
                const back = piece.staged[key] ?? params[key]?.default;
                if (back !== undefined) change(key, Array.isArray(back) ? [...back] : back);
            }
        },
        at: piece.at,
        radius: piece.radius,
    };
}

/** A bancada da vitrine da família `family`, sobre a cena de `app` desenhada em `canvas`. */
export function ShowcasePanel({
    app,
    canvas,
    family,
}: {
    readonly app: Application;
    readonly canvas: HTMLCanvasElement;
    readonly family: string;
}) {
    const [picked, setPicked] = useState<string | null>(null);
    const [, redraw] = useState(0);
    const names = MATERIAL_FAMILIES.find(([f]) => f === family)?.[1] ?? [];

    // O clique numa peça, no canvas: só o clique parado (arrastar gira a câmera livre).
    useEffect(() => {
        let down: { x: number; y: number } | undefined;
        const onDown = (e: PointerEvent): void => {
            down = { x: e.clientX, y: e.clientY };
        };
        const onUp = (e: PointerEvent): void => {
            const from = down;
            down = undefined;
            if (from === undefined || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
            const box = canvas.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return;
            const name = pieceAt(
                app,
                canvas,
                ((e.clientX - box.left) * canvas.width) / box.width,
                ((e.clientY - box.top) * canvas.height) / box.height,
            );
            if (name !== undefined) setPicked(name);
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);
        return () => {
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointerup', onUp);
        };
    }, [app, canvas]);

    const piece = picked === null ? undefined : showcasePieces(app).get(picked);
    const active =
        piece === undefined || picked === null
            ? undefined
            : activeOf(picked as MaterialName, piece, () => redraw((n) => n + 1));
    return (
        <MaterialWorkbench app={app} canvas={canvas} active={active}>
            <div style={styles.hint}>materiais · {family}</div>
            <div style={styles.list}>
                {names.map((n) => (
                    <button
                        key={n}
                        onClick={() => setPicked(n === picked ? null : n)}
                        style={{
                            ...styles.item,
                            color: n === picked ? '#0d0d12' : '#d8d8e0',
                            background: n === picked ? '#8ec7ff' : '#1b1b26',
                        }}
                    >
                        {n}
                    </button>
                ))}
            </div>
            {active === undefined ? (
                <div style={styles.hint}>escolha um material na lista ou clique numa peça da cena</div>
            ) : (
                <a href={`?material=${active.name}`} style={{ color: '#8ec7ff', fontSize: 11 }}>
                    abrir {active.name} na galeria
                </a>
            )}
        </MaterialWorkbench>
    );
}

const styles = {
    hint: { color: '#888', fontSize: 11, margin: '6px 0 2px' },
    list: { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 6px' },
    item: {
        border: '1px solid #2a2a36',
        borderRadius: 4,
        padding: '2px 7px',
        cursor: 'pointer',
        font: 'inherit',
    },
} as const satisfies Record<string, CSSProperties>;
