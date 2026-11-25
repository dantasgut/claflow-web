// O tamanho do quadro das cenas: num módulo próprio, para o catálogo e as cenas dos materiais o lerem sem um importar
// o outro. Por ordem: `?w=` e `?h=` na URL; a escolha guardada no navegador (o controle "Resolução do quadro" do
// painel de render: 1280 × 720, a largura da janela, a nativa da tela — a da janela pela densidade de pixels — ou a
// largura e a altura digitadas); sem escolha, a nativa da tela (1280 × 720 nos vídeos e nas capturas, que rodam num
// navegador comandado por automação). O canvas é esticado para a largura da janela: um quadro com menos pixels que os
// da tela sai ampliado — borrado e serrilhado ao mesmo tempo.
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** As escolhas do controle de resolução: as predefinidas, ou `<largura>x<altura>`. */
export type FramePreset = '720p' | 'janela' | 'nativa';
export type FrameChoice = FramePreset | `${number}x${number}`;
const KEY = 'claflow.quadro';

/** A largura e a altura de uma escolha digitada (pares, de 320 × 180 a 7680 × 4320), ou `undefined`. */
export function customSize(choice: string): readonly [number, number] | undefined {
    const m = /^(\d+)x(\d+)$/.exec(choice);
    if (m === null) return undefined;
    const even = (v: number, lo: number, hi: number): number => 2 * Math.round(Math.min(hi, Math.max(lo, v)) / 2);
    return [even(Number(m[1]), 320, 7680), even(Number(m[2]), 180, 4320)];
}

/** A escolha guardada; sem nenhuma, a nativa da tela (no navegador comandado por automação, 1280 × 720). */
export function frameChoice(): FrameChoice {
    const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
    const fallback: FrameChoice = automated ? '720p' : 'nativa';
    try {
        const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
        if (v === 'janela' || v === 'nativa' || v === '720p') return v;
        if (v !== null && customSize(v) !== undefined) return v as FrameChoice;
        return fallback;
    } catch {
        return fallback;
    }
}

/** Guarda a escolha; vale na próxima carga da página. */
export function setFrameChoice(choice: FrameChoice): void {
    try {
        localStorage.setItem(KEY, choice);
    } catch {
        // Sem armazenamento (navegação privada): a escolha não persiste.
    }
}

/** O tamanho do quadro de uma escolha, nesta janela e nesta tela (16:9 nas predefinidas). */
export function sizeOf(choice: FrameChoice): readonly [number, number] {
    const custom = customSize(choice);
    if (custom !== undefined) return custom;
    if (choice === '720p' || typeof window === 'undefined') return [1280, 720];
    const density = choice === 'nativa' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    const w = Math.min(7680, Math.max(640, 2 * Math.round((window.innerWidth * density) / 2)));
    return [w, 2 * Math.round((w * 9) / 32)];
}

const chosen = sizeOf(frameChoice());
export const W = Number(q.get('w') ?? chosen[0]);
export const H = Number(q.get('h') ?? (q.get('w') === null ? chosen[1] : 2 * Math.round((W * 9) / 32)));
