// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZAR OS DOCUMENTOS DEPOIS DA LEITURA POR IA (eletroposto). A leitura devolve, para cada arquivo lido, o tipo e um
// rótulo; aqui o SERVIDOR aplica:
//   - arquivo que está em `outros` e cujo tipo é um item do catálogo que aceita aquele formato e tem espaço -> vai para lá
//     (só metadado: o caminho no bucket não tem o item). Arquivo num item que a pessoa escolheu NUNCA é movido;
//   - rótulo da IA gravado só onde não há rótulo manual (o manual sempre vence).
//
// Roda DEPOIS da chamada ao modelo (que pode levar 90 s e nunca fica dentro da trava de 15 s) e relê tudo dentro da trava
// da venda: o que foi lido antes da chamada está velho. A trava NÃO protege o registro dos documentos (envio e remoção não
// a pegam), então a mudança de item passa pelo compare-and-swap de `gravarDocs`, recalculada a cada tentativa.
//
// Nunca lança: falha vira `aviso`, e as sugestões de campos seguem. Nada de rótulo, tipo ou nome em log: só o código.
// Não importa rota (ciclo de boot em CommonJS): quem chama passa `lerRegistro`.
// ─────────────────────────────────────────────────────────────────────────────
import { comTrava } from './cadastroVendaBanco';
import { itemDoCatalogo, mimeServeAoItem, comArquivoMovido, motivoSemEspacoParaMover, type Linha, type RegistroDocs } from './docsCliente';
import { gravarDocs } from './docsClienteBanco';
import { lerRotulos, gravarRotulos, travaDaVenda, type Rotulos } from './docsRotulos';

const TENTATIVAS = 4;
const SEM_TIPO = new Set(['', 'outro', 'outros']);
export const AVISO_MOVER = 'Não consegui mover os arquivos para os itens certos agora.';
export const AVISO_NOMES = 'Não consegui salvar os nomes dos documentos agora.';
export const AVISO_GERAL = 'Não consegui organizar os documentos agora. Aperte Ler de novo.';

/** `slot`: onde o arquivo estava quando foi lido. `rotulo`: já limpo ('' = a IA não deu rótulo aproveitável). */
export interface DocLido { id: string; slot: string; tipo: string; rotulo: string }
export interface Organizado { id: string; de: string; para: string; rotulo: string }
export interface ContextoOrganizar { linha: Linha; codigo: string; nome: string }
export type LerRegistro = () => Promise<{ reg: RegistroDocs; versao: string | null }>;

const codigoDe = (e: unknown): string => String((e as { codigo?: unknown } | null)?.codigo ?? 'interno');

export async function organizarDocs(
  ctx: ContextoOrganizar, docs: DocLido[], lerRegistro: LerRegistro, agora: string = new Date().toISOString(),
): Promise<{ organizados: Organizado[]; aviso?: string }> {
  if (!docs.length) return { organizados: [] };
  try {
    return await comTrava(travaDaVenda(ctx.linha, ctx.codigo), ctx.nome, async () => {
      const avisos: string[] = [];

      // Rótulos primeiro (só leitura): se falhar, os arquivos ainda podem ser movidos.
      let rot: Rotulos | null = null;
      try { rot = await lerRotulos(ctx.linha, ctx.codigo); } catch (e) { console.error('[docs-organizar] ler rótulos', codigoDe(e)); }

      // Mudança de item: compare-and-swap, recalculada do zero a cada tentativa.
      let movidos = new Map<string, { de: string; para: string }>();
      let ultimo: RegistroDocs | null = null;
      try {
        let gravou = false;
        for (let t = 0; t < TENTATIVAS && !gravou; t++) {
          const { reg, versao } = await lerRegistro();
          ultimo = reg;
          let atual = reg;
          const feitos = new Map<string, { de: string; para: string }>();
          for (const d of docs) {
            const a = atual.arquivos.find((x) => x.id === d.id);
            if (!a || a.slot !== 'outros' || SEM_TIPO.has(d.tipo)) continue;   // sumiu, ou a pessoa já o pôs num item
            const item = itemDoCatalogo(ctx.linha, d.tipo);
            if (!item || item.chave === a.slot || !mimeServeAoItem(item, a.mime)) continue;
            if (motivoSemEspacoParaMover(atual, a.id, item)) continue;   // item único ocupado (inclui um irmão movido agora há pouco)
            atual = comArquivoMovido(atual, a.id, item.chave, ctx.nome, agora);
            feitos.set(a.id, { de: a.slot, para: item.chave });
          }
          if (!feitos.size) { movidos = feitos; ultimo = atual; gravou = true; break; }
          if (await gravarDocs(ctx.linha, ctx.codigo, atual, versao, agora)) { movidos = feitos; ultimo = atual; gravou = true; }
        }
        if (!gravou) avisos.push(AVISO_MOVER);
      } catch (e) {
        console.error('[docs-organizar] mover', codigoDe(e));
        avisos.push(AVISO_MOVER);
        movidos = new Map();
      }

      // Rótulos: o manual vence. Também varre os rótulos de arquivo que já não existe (a gravação é um bom momento).
      const vivos = ultimo ? new Set(ultimo.arquivos.map((a) => a.id)) : null;
      const efetivo = new Map<string, string>();
      const daIa = new Set<string>();
      let rotuloGravado = false;
      if (rot) {
        let mudou = false;
        for (const d of docs) {
          const ja = rot.rotulos[d.id];
          if (ja?.fonte === 'manual') { efetivo.set(d.id, ja.rotulo); continue; }
          if (vivos && !vivos.has(d.id)) continue;
          if (!d.rotulo) { if (ja) efetivo.set(d.id, ja.rotulo); continue; }
          if (ja?.rotulo !== d.rotulo || ja?.fonte !== 'ia') {
            rot.rotulos[d.id] = { rotulo: d.rotulo, fonte: 'ia', por: ctx.nome, em: agora };
            mudou = true;
          }
          efetivo.set(d.id, d.rotulo);
          daIa.add(d.id);
        }
        if (vivos) for (const id of Object.keys(rot.rotulos)) if (!vivos.has(id)) { delete rot.rotulos[id]; mudou = true; }
        if (mudou) {
          try { await gravarRotulos(ctx.linha, ctx.codigo, rot, agora); rotuloGravado = true; } catch (e) {
            console.error('[docs-organizar] gravar rótulos', codigoDe(e));
            if (daIa.size) avisos.push(AVISO_NOMES);   // só varreu rótulo órfão: não há nome perdido para avisar
          }
        } else rotuloGravado = true;   // nada a mudar: o que está lá já é o efetivo
      } else if (docs.some((d) => d.rotulo)) avisos.push(AVISO_NOMES);   // sem nome a gravar, não há o que avisar

      const organizados: Organizado[] = [];
      for (const d of docs) {
        const mov = movidos.get(d.id);
        const rotulou = rotuloGravado && daIa.has(d.id);
        if (!mov && !rotulou) continue;
        const slotAgora = ultimo?.arquivos.find((a) => a.id === d.id)?.slot ?? d.slot;
        organizados.push({
          id: d.id, de: mov?.de ?? slotAgora, para: mov?.para ?? slotAgora,
          rotulo: rotuloGravado ? (efetivo.get(d.id) ?? '') : '',
        });
      }
      return { organizados, ...(avisos.length ? { aviso: avisos.join(' ') } : {}) };
    });
  } catch (e) {
    // Trava ocupada, trava fora do ar ou qualquer outra coisa: as sugestões de campos seguem.
    console.error('[docs-organizar] falhou', codigoDe(e));
    return { organizados: [], aviso: AVISO_GERAL };
  }
}
