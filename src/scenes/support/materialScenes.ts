// Materiais do app pelo grafo de nós e por função (spec 038: a parte das cenas dos smokes que monta materiais).
import { MaterialFunction, NodeGraph, nodes } from 'clayflow';
import type { LobeName } from 'clayflow';

/** Grafo de material: os nós dados, as ligações e a saída do nó `out` (um fechamento) em `output.closure`. */
export function materialGraph(
    graphNodes: ConstructorParameters<typeof NodeGraph>[0]['nodes'],
    links: ConstructorParameters<typeof NodeGraph>[0]['links'],
    out: string,
): MaterialFunction {
    return new MaterialFunction({
        graph: new NodeGraph({
            nodes: { ...graphNodes, material_out: nodes.output.closure },
            links: [...links, [out, 'material_out.closure']],
            output: 'material_out.value',
        }),
    });
}

/** Função `material` de fechamento escrita em WGSL, com os lobos declarados. */
export function closureFn(
    body: string,
    lobes: readonly LobeName[],
    params: Readonly<Record<string, 'f32' | 'vec3f'>> = {},
    values: Readonly<Record<string, number | number[]>> = {},
): MaterialFunction {
    return new MaterialFunction({
        code: `fn material_fn(s: SurfaceSample, m: StandardMaterial, data: MaterialFnParams) -> Closure {\n${body}\n}`,
        params,
        values,
        lobes,
    });
}

