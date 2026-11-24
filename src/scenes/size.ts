// O tamanho do quadro das cenas (`?w=` e `?h=` na URL; 1280 × 720): num módulo próprio, para o catálogo e as cenas
// dos materiais o lerem sem um importar o outro.
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const W = Number(q.get('w') ?? 1280);
export const H = Number(q.get('h') ?? 720);
