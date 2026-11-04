import { useEffect, useState, type CSSProperties } from 'react';
import { SPEEDS, type TimeNavigator } from './TimeNavigator';

/**
 * A barra do tempo (embaixo, no meio): pausa e continua (Espaço), um quadro adiante com o tempo pausado (→), a
 * velocidade, a câmera seguindo o tempo ou livre (C: arrastar gira, roda aproxima — também com o tempo congelado) e o
 * tempo da cena.
 */
export function TimeControls({ nav }: { readonly nav: TimeNavigator }) {
    const [, redraw] = useState(0);
    useEffect(() => {
        const off = nav.onChange(() => redraw((n) => n + 1));
        // O relógio da barra (o quadro anda sem aviso enquanto o tempo corre).
        const timer = setInterval(() => redraw((n) => n + 1), 100);
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault();
                nav.togglePause();
            } else if (e.code === 'ArrowRight') nav.stepForward();
            else if (e.code === 'KeyC') nav.setCamera(nav.camera === 'tempo' ? 'livre' : 'tempo');
        };
        window.addEventListener('keydown', onKey);
        return () => {
            off();
            clearInterval(timer);
            window.removeEventListener('keydown', onKey);
        };
    }, [nav]);
    return (
        <div style={styles.bar}>
            <button style={styles.button} onClick={() => nav.togglePause()} title="Espaço">
                {nav.paused ? '▶ continuar' : '⏸ pausar'}
            </button>
            <button
                style={{ ...styles.button, opacity: nav.paused ? 1 : 0.4 }}
                disabled={!nav.paused}
                onClick={() => nav.stepForward()}
                title="→ (com o tempo pausado)"
            >
                ⏭ quadro
            </button>
            <label style={styles.label}>
                velocidade
                <select
                    style={styles.select}
                    value={nav.speed}
                    onChange={(e) => nav.setSpeed(Number(e.target.value))}
                >
                    {SPEEDS.map((s) => (
                        <option key={s} value={s}>
                            {s}×
                        </option>
                    ))}
                </select>
            </label>
            <label style={styles.label}>
                câmera
                <select
                    style={styles.select}
                    value={nav.camera}
                    onChange={(e) => nav.setCamera(e.target.value === 'livre' ? 'livre' : 'tempo')}
                    title="C"
                >
                    <option value="tempo">segue o tempo</option>
                    <option value="livre">livre</option>
                </select>
            </label>
            <span style={styles.clock}>
                {nav.paused ? 'pausado · ' : ''}t = {(nav.frame / 60).toFixed(2)} s · quadro {nav.frame}
            </span>
        </div>
    );
}

const font = '12px ui-sans-serif, system-ui, sans-serif';

const styles = {
    bar: {
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        padding: '6px 12px',
        borderRadius: 8,
        background: 'rgba(12, 12, 18, 0.85)',
        color: '#ddd',
        font,
        zIndex: 10,
        maxWidth: 'calc(100vw - 24px)',
    },
    button: {
        font,
        color: '#fff',
        background: '#2a2f3a',
        border: '1px solid #445',
        borderRadius: 4,
        padding: '4px 10px',
        cursor: 'pointer',
    },
    label: { display: 'flex', gap: 6, alignItems: 'center' },
    select: { font, background: '#2a2f3a', color: '#fff', border: '1px solid #445', borderRadius: 4 },
    clock: { fontVariantNumeric: 'tabular-nums', color: '#9cf' },
} as const satisfies Record<string, CSSProperties>;
