// Leitura de imagens Radiance HDR (RGBE, `.hdr`): o cabeçalho, as linhas com a compressão por comprimento (RLE nova, por
// canal) ou sem ela, e a conversão para RGBA linear em float — o que o `EnvironmentMap` do motor recebe (o motor não lê
// arquivos).

/** Uma imagem HDR decodificada: largura, altura e RGBA linear por pixel (a primeira linha é o topo). */
export interface HdrImage {
    readonly width: number;
    readonly height: number;
    readonly pixels: Float32Array;
}

/** Decodifica os bytes de um `.hdr` (formato `32-bit_rle_rgbe`, orientação `-Y h +X w`). */
export function decodeHdr(bytes: Uint8Array): HdrImage {
    let pos = 0;
    const line = (): string => {
        let s = '';
        while (pos < bytes.length && bytes[pos] !== 0x0a) s += String.fromCharCode(bytes[pos++]!);
        pos++;
        return s;
    };
    const magic = line();
    if (!magic.startsWith('#?')) throw new Error('HDR: cabeçalho sem #?RADIANCE/#?RGBE');
    for (;;) {
        const l = line();
        if (l === '') break;
        if (l.startsWith('FORMAT=') && l !== 'FORMAT=32-bit_rle_rgbe')
            throw new Error(`HDR: formato ${l} não suportado`);
        if (pos >= bytes.length) throw new Error('HDR: cabeçalho sem fim');
    }
    const size = line().match(/^-Y (\d+) \+X (\d+)$/);
    if (size === null) throw new Error('HDR: orientação diferente de -Y h +X w');
    const height = Number(size[1]);
    const width = Number(size[2]);
    const rgbe = new Uint8Array(width * height * 4);
    const scan = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
        const rle =
            width >= 8 && width < 0x8000 && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2]! & 0x80) === 0;
        if (!rle) {
            // Sem compressão: os quatro bytes de cada pixel em sequência.
            rgbe.set(bytes.subarray(pos, pos + width * 4), y * width * 4);
            pos += width * 4;
            continue;
        }
        if (((bytes[pos + 2]! << 8) | bytes[pos + 3]!) !== width) throw new Error('HDR: largura da linha errada');
        pos += 4;
        // Cada canal da linha em sequência, por corridas (repetição) ou trechos literais.
        for (let c = 0; c < 4; c++) {
            let x = 0;
            while (x < width) {
                let count = bytes[pos++]!;
                if (count > 128) {
                    count -= 128;
                    const value = bytes[pos++]!;
                    for (let k = 0; k < count; k++) scan[(x++) * 4 + c] = value;
                } else {
                    for (let k = 0; k < count; k++) scan[(x++) * 4 + c] = bytes[pos++]!;
                }
            }
        }
        rgbe.set(scan, y * width * 4);
    }
    const pixels = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const e = rgbe[i * 4 + 3]!;
        const f = e === 0 ? 0 : 2 ** (e - 136);
        pixels[i * 4] = rgbe[i * 4]! * f;
        pixels[i * 4 + 1] = rgbe[i * 4 + 1]! * f;
        pixels[i * 4 + 2] = rgbe[i * 4 + 2]! * f;
        pixels[i * 4 + 3] = 1;
    }
    return { width, height, pixels };
}

/** Busca e decodifica um `.hdr`. */
export async function loadHdr(url: string): Promise<HdrImage> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HDR: ${url} respondeu ${response.status}`);
    return decodeHdr(new Uint8Array(await response.arrayBuffer()));
}
