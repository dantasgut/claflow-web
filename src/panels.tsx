import { useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';

// Os painéis do app (a lista de materiais, o de render, o inspetor, o de nós, a barra do tempo): cada um se oculta por
// conta própria, deixando só uma aba fina para reabrir, e a tecla H oculta ou mostra todos de uma vez.

const open = new Map<string, boolean>();
const listeners = new Set<() => void>();
/** Os painéis que estavam abertos quando o H ocultou todos (o H seguinte reabre esses). */
let hiddenByKey: string[] | undefined;

const notify = (): void => {
    for (const l of listeners) l();
};
const subscribe = (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

/** Abre ou oculta o painel `id`. */
export function setPanel(id: string, value: boolean): void {
    if ((open.get(id) ?? true) === value) return;
    open.set(id, value);
    hiddenByKey = undefined;
    notify();
}

/** Oculta todos os painéis abertos; com todos ocultos, reabre os que o H ocultou (ou todos). */
export function toggleAllPanels(): void {
    const shown = [...open].filter(([, v]) => v).map(([id]) => id);
    if (shown.length > 0) {
        for (const id of shown) open.set(id, false);
        hiddenByKey = shown;
    } else {
        for (const id of hiddenByKey ?? open.keys()) open.set(id, true);
        hiddenByKey = undefined;
    }
    notify();
}

/** O estado (aberto ou oculto) do painel `id` e quem o muda. */
export function usePanel(id: string): readonly [boolean, (value: boolean) => void] {
    if (!open.has(id)) open.set(id, true);
    const value = useSyncExternalStore(subscribe, () => open.get(id) ?? true);
    return [value, (v) => setPanel(id, v)];
}

const isField = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyH' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        // Não dispara enquanto se digita num campo.
        if (isField(e.target)) return;
        toggleAllPanels();
    });
}

/**
 * Para o `onKeyDown` de um painel: as teclas dadas dentro dele não chegam à cena (o Espaço pausa, o P recolhe o painel
 * de render) — só o H passa, fora dos campos, para ocultar ou mostrar todos.
 */
export function keepKeys(e: ReactKeyboardEvent): void {
    if (e.code !== 'KeyH' || isField(e.target)) e.stopPropagation();
}

const base: CSSProperties = {
    font: '11px system-ui, -apple-system, sans-serif',
    color: '#d8d8e0',
    background: 'rgba(12, 12, 18, 0.9)',
    border: '1px solid #2a2a36',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
};

/** A aba fina que fica no lugar de um painel oculto (o clique reabre). */
export function PanelTab({
    label,
    onClick,
    style,
}: {
    readonly label: string;
    readonly onClick: () => void;
    readonly style: CSSProperties;
}) {
    return (
        <button onClick={onClick} title="mostrar o painel (H mostra ou oculta todos)" style={{ ...base, position: 'fixed', zIndex: 11, ...style }}>
            {label}
        </button>
    );
}

/** O botão de ocultar no cabeçalho de um painel. */
export function HideButton({ onClick }: { readonly onClick: () => void }) {
    return (
        <button onClick={onClick} title="ocultar o painel (H oculta ou mostra todos)" style={base}>
            ocultar
        </button>
    );
}
