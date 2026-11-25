import { useEffect, useState, type CSSProperties } from 'react';
import { HideButton, PanelTab, usePanel } from './panels';
import { SPEEDS, type TimeNavigator } from './TimeNavigator';

/**
 * A barra do tempo (embaixo, no meio): pausa e continua (Espaço), um quadro adiante com o tempo pausado (→), a
 * velocidade, a câmera seguindo o tempo ou livre (C: arrastar gira, roda aproxima — também com o tempo congelado), a
 * linha do tempo do roteiro da cena (arrastar leva a cena ao quadro; ← e → com o tempo pausado andam um quadro) e o
 * tempo da cena. Oculta (o botão, ou o H com os outros painéis), fica uma aba; os atalhos seguem valendo. Sobe para
 * dar lugar ao painel de nós, quando há um embaixo (`--dock`).
 */
export function TimeControls({ nav }: { readonly nav: TimeNavigator }) {
    const [, redraw] = useState(0);
    const [open, setOpen] = usePanel('tempo');
    useEffect(() => {
        const off = nav.onChange(() => redraw((n) => n + 1));
        // O relógio da barra (o quadro anda sem aviso enquanto o tempo corre).
        const timer = setInterval(() => redraw((n) => n + 1), 100);
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault();
                nav.togglePause();
            } else if (e.code === 'ArrowRight') nav.stepForward();
            else if (e.code === 'ArrowLeft' && nav.paused) nav.seek(nav.position - 1);
            else if (e.code === 'KeyC') nav.setCamera(nav.camera === 'tempo' ? 'livre' : 'tempo');
        };
        window.addEventListener('keydown', onKey);
        return () => {
            off();
            clearInterval(timer);
            window.removeEventListener('keydown', onKey);
        };
    }, [nav]);
    if (!open) {
        return (
            <PanelTab
                label="Tempo ▴"
                onClick={() => setOpen(true)}
                style={{ bottom: 'calc(var(--dock, 0px) + 4px)', left: '50%', transform: 'translateX(-50%)' }}
            />
        );
    }
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
            <input
                type="range"
                style={styles.timeline}
                min={0}
                max={nav.length - 1}
                step={1}
                value={nav.position}
                onChange={(e) => nav.seek(Number(e.target.value))}
                // As setas no controle são as da barra (um quadro), não as do navegador.
                onKeyDown={(e) => e.preventDefault()}
                title="linha do tempo da cena (arrastar leva ao quadro)"
            />
            <span style={styles.clock}>
                {nav.paused ? 'pausado · ' : ''}quadro {nav.position} de {nav.length - 1} · t ={' '}
                {(nav.frame / 60).toFixed(2)} s
            </span>
            <HideButton onClick={() => setOpen(false)} />
        </div>
    );
}

const font = '12px ui-sans-serif, system-ui, sans-serif';

const styles = {
    bar: {
        position: 'fixed',
        bottom: 'calc(var(--dock, 0px) + 12px)',
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
    timeline: { width: 320, accentColor: '#9cf', cursor: 'pointer' },
    clock: { fontVariantNumeric: 'tabular-nums', color: '#9cf' },
} as const satisfies Record<string, CSSProperties>;
