import { frameChoice, H, setFrameChoice, W, type FrameChoice } from './scenes/size';

// O controle da resolução do quadro (o grupo "Render"): o quadro é renderizado num tamanho fixo e esticado para a
// largura da janela; menor que ela, sai borrado e serrilhado. Trocar recarrega a página (o motor é criado com o
// tamanho do canvas).

const LABELS: Readonly<Record<FrameChoice, string>> = {
    '720p': '1280 × 720 (rápido)',
    janela: 'largura da janela',
    nativa: 'nativa da tela (mais lenta)',
};

/** O seletor da resolução do quadro, com o tamanho em uso. */
export function FrameSizeControl() {
    return (
        <label style={{ display: 'block', margin: '6px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>resolução do quadro</span>
                <span style={{ opacity: 0.6 }}>
                    {W} × {H}
                </span>
            </div>
            <select
                value={frameChoice()}
                onChange={(e) => {
                    setFrameChoice(e.target.value as FrameChoice);
                    location.reload();
                }}
                style={{
                    width: '100%',
                    marginTop: 4,
                    background: '#0d0d12',
                    color: '#d8d8e0',
                    border: '1px solid #2a2a36',
                    borderRadius: 4,
                    padding: '2px 4px',
                }}
            >
                {(Object.keys(LABELS) as FrameChoice[]).map((k) => (
                    <option key={k} value={k}>
                        {LABELS[k]}
                    </option>
                ))}
            </select>
        </label>
    );
}
