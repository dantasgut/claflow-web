// O tamanho do quadro das cenas: num módulo próprio, para o catálogo e as cenas dos materiais o lerem sem um importar
// o outro. Por ordem: `?w=` e `?h=` na URL; a escolha guardada no navegador (o controle "resolução do quadro" do
// app: a largura da janela, ou a nativa da tela — a da janela pela densidade de pixels); 1280 × 720 (o tamanho dos
// vídeos e das capturas, que rodam num navegador sem escolha guardada). O quadro é sempre 16:9; o canvas é esticado
// para a largura da janela, então um quadro menor que ela sai ampliado — borrado e serrilhado ao mesmo tempo.
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** As escolhas do controle de resolução. */
export type FrameChoice = '720p' | 'janela' | 'nativa';
const KEY = 'claflow.quadro';

/** A escolha guardada (sem nenhuma: 720p). */
export function frameChoice(): FrameChoice {
    try {
        const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
        return v === 'janela' || v === 'nativa' ? v : '720p';
    } catch {
        return '720p';
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

function chosenWidth(): number {
    const choice = frameChoice();
    if (choice === '720p' || typeof window === 'undefined') return 1280;
    const density = choice === 'nativa' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    // Par, no mínimo 640 e no máximo 3840 de largura.
    return Math.min(3840, Math.max(640, 2 * Math.round((window.innerWidth * density) / 2)));
}

export const W = Number(q.get('w') ?? chosenWidth());
export const H = Number(q.get('h') ?? 2 * Math.round((W * 9) / 32));
