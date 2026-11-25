import { useState } from 'react';
import { frameChoice, H, setFrameChoice, sizeOf, W, type FrameChoice, type FramePreset } from './scenes/size';

// A resolução do quadro (o grupo "Render"): o motor renderiza num tamanho fixo e o canvas é esticado para a largura
// da janela — com menos pixels que os da tela, a imagem sai borrada e serrilhada. Escolhe-se uma predefinida ou
// digitam-se a largura e a altura; aplicar recarrega a página (o motor é criado com o tamanho do canvas).

const PRESETS: readonly (readonly [FramePreset, string])[] = [
    ['nativa', 'nativa da tela'],
    ['janela', 'largura da janela'],
    ['720p', '1280 × 720 (rápido)'],
];

const box: React.CSSProperties = {
    background: '#0d0d12',
    color: '#d8d8e0',
    border: '1px solid #2a2a36',
    borderRadius: 4,
    padding: '2px 4px',
};

/** O controle da resolução do quadro: as predefinidas, a largura e a altura digitadas e o tamanho em uso. */
export function FrameSizeControl() {
    const choice = frameChoice();
    const [w, setW] = useState(String(W));
    const [h, setH] = useState(String(H));
    const apply = (next: FrameChoice): void => {
        setFrameChoice(next);
        // `?w=` e `?h=` na URL mandam mais que a escolha: saem, para a escolha valer.
        const url = new URL(location.href);
        url.searchParams.delete('w');
        url.searchParams.delete('h');
        location.href = url.toString();
    };
    const pixels = (W * H) / 1e6;
    return (
        <div style={{ margin: '6px 0 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 600 }}>
                <span>Resolução do quadro</span>
                <span style={{ opacity: 0.7, fontWeight: 400 }}>
                    {W} × {H} ({pixels.toFixed(1)} MP)
                </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {PRESETS.map(([key, label]) => {
                    const [pw, ph] = sizeOf(key);
                    return (
                        <button
                            key={key}
                            title={`${pw} × ${ph}`}
                            onClick={() => apply(key)}
                            style={{
                                ...box,
                                cursor: 'pointer',
                                borderColor: choice === key ? '#8ec7ff' : '#2a2a36',
                                color: choice === key ? '#8ec7ff' : '#d8d8e0',
                            }}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
            <form
                style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}
                onSubmit={(e) => {
                    e.preventDefault();
                    const pw = Math.round(Number(w));
                    const ph = Math.round(Number(h));
                    if (pw > 0 && ph > 0) apply(`${pw}x${ph}`);
                }}
            >
                <input
                    type="number"
                    aria-label="largura do quadro em pixels"
                    value={w}
                    min={320}
                    max={7680}
                    step={2}
                    onChange={(e) => setW(e.target.value)}
                    style={{ ...box, width: 64 }}
                />
                <span>×</span>
                <input
                    type="number"
                    aria-label="altura do quadro em pixels"
                    value={h}
                    min={180}
                    max={4320}
                    step={2}
                    onChange={(e) => setH(e.target.value)}
                    style={{ ...box, width: 64 }}
                />
                <button type="submit" style={{ ...box, cursor: 'pointer' }}>
                    aplicar
                </button>
            </form>
            <div style={{ opacity: 0.6, marginTop: 4 }}>
                o custo cresce com os pixels; aplicar recarrega a página
            </div>
        </div>
    );
}
