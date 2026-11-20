import type { Fase2 } from './geradorJornadaObra';
import { logErroJornada, type GuardaObra } from './geradorJornadaGuarda';
import { CURTOS_ETAPA, NOMES_ETAPA, donosDaEtapa, iniciais, podeConcluir } from '../services/gerador/jornadaSolar';
import { ehRecusa, type Recusa } from '../services/gerador/jornadaSolarBanco';
import { etapaAtualCompleta, itensDaEtapaObra, prazoDaEtapaObra, situacaoObra, type ObraPrivada } from '../services/gerador/jornadaObra';
import { mudarObra, mudarObraPrivada, normalizarObraPrivada, obraVazia } from '../services/gerador/jornadaObraBanco';
import { aplicarPortoes, forcarEtapa } from '../services/gerador/obraPortoes';
import { recortarLivro, veRetiradaDosSocios } from '../services/gerador/jornadaDinheiro';

// ─────────────────────────────────────────────────────────────────────────────
// AS ETAPAS 4 A 8 DA OBRA SOLAR, COMO A TELA AS VÊ (19/11/2026): os itens de cada etapa por quem pergunta, a lista das abas, o botão final do Comissionamento e a
// abertura FORÇADA pelo ADM. Vive à parte de `geradorJornadaObra.ts` (que não pode crescer). Só TIPOS vêm de lá (sem ciclo de boot).
// ─────────────────────────────────────────────────────────────────────────────

const MSG_FECHADA = 'A conta desta obra está fechada. Só o Thiago reabre.';
export const fonteItens = (f: Fase2) => ({ jo: f.joView, privada: f.privada, livro: f.din.livro, slots: f.slotsMap, docsIds: f.docsIds });

/**
 * Os itens do portão como a pessoa pode ver. O item "A receber e a pagar zerados" da etapa 8 usa o livro inteiro; para quem não vê a retirada dos
 * sócios, quando o que falta é só o que ela não vê, o texto vira genérico (nem valor, nem qual é a pendência).
 */
export function itensParaQuem(n: number, f: Fase2, g: GuardaObra) {
  const itens = itensDaEtapaObra(n, fonteItens(f));
  if (n !== 8 || veRetiradaDosSocios(g.nome, g.adm)) return itens;
  const visivelFecha = recortarLivro(f.din.livro, false).fechamento.pode_fechar_sem_material;
  return itens.map((i) => (i.chave === 'dinheiro' && !i.feito && visivelFecha ? { ...i, texto: 'Falta uma pendência que o Thiago resolve' } : i));
}

/**
 * O botão final do Comissionamento (etapas 7 e 8 juntas): quem pode, e o que falta de OBRIGATÓRIO nas etapas que ainda não estão concluídas
 * (o que já passou continua passado). Inclui o fechamento: todo material comprado, a receber e a pagar zerados, comprovantes e avarias resolvidas.
 * Quem pode é quem conclui a etapa 8 hoje.
 */
export function finalDoComissionamento(g: GuardaObra, f: Fase2): { aberta: boolean; pode: boolean; falta: ReturnType<typeof itensParaQuem>; pronto: boolean } {
  const atual = f.etapa;
  const aberta = !f.din.cancelada && !f.din.fechada && atual !== null && (atual === 7 || atual === 8);
  const falta = !aberta ? [] : ([7, 8] as const).filter((n) => !f.joView?.etapas[n].concluida_em)
    .flatMap((n) => itensParaQuem(n, f, g)).filter((i) => !i.feito && i.nivel === 'obrigatorio');
  const pode = aberta && podeConcluir(g.nome, 8, f.vend);
  return { aberta, pode, falta, pronto: aberta && falta.length === 0 };
}

/** As etapas 4 a 8 e as abas da obra, na ordem da tela: a Compra é a etapa 4, a Logística a 5, a Obra a 6 e o Comissionamento junta a 7 e a 8. */
export function etapasEAbas(g: GuardaObra, f: Fase2, hoje: string) {
  const etapas = [4, 5, 6, 7, 8].map((n) => {
    const e = f.joView?.etapas[n as 4 | 5 | 6 | 7 | 8];
    // A etapa 8 (liberação e fechamento) é a segunda metade do Comissionamento: a lista dela aparece junto com a da 7.
    const itens = f.joView && (e?.aberta_em || (n === 8 && f.joView.etapas[7].aberta_em)) ? itensParaQuem(n, f, g) : [];
    return {
      n, nome: NOMES_ETAPA[n], curto: CURTOS_ETAPA[n], dono: donosDaEtapa(n, f.vend).map((d) => ({ nome: d, iniciais: iniciais(d) })),
      aberta_em: e?.aberta_em ?? null, concluida_em: e?.concluida_em ?? null,
      prazo: prazoDaEtapaObra(n, f.js, f.joView), situacao: situacaoObra(n, f.js, f.joView, hoje),
      // `falta` conta só o OBRIGATÓRIO (o que trava); `falta_opcional` é o amarelo. As etapas 4, 5 e 6 abrem sozinhas pelo dado: sem botão Concluir.
      // Etapa já concluída (inclusive no estado antigo) não cobra nada: o que já passou continua passado.
      itens, falta: e?.concluida_em ? 0 : itens.filter((i) => !i.feito && i.nivel === 'obrigatorio').length,
      falta_opcional: e?.concluida_em ? 0 : itens.filter((i) => !i.feito && i.nivel === 'opcional').length,
      abre_sozinha: n <= 6,
    };
  });
  const abaDe = (aba: string, numero: number, ns: number[]) => {
    const es = etapas.filter((x) => ns.includes(x.n));
    const concluida = es.every((x) => !!x.concluida_em);
    return {
      aba, numero, etapas: ns, aberta: es.some((x) => !!x.aberta_em), concluida,
      falta: concluida ? 0 : es.reduce((a, x) => a + x.falta, 0), falta_opcional: concluida ? 0 : es.reduce((a, x) => a + x.falta_opcional, 0),
    };
  };
  return { etapas, abas: [abaDe('compra', 6, [4]), abaDe('logistica', 7, [5]), abaDe('obra', 8, [6]), abaDe('comissionamento', 9, [7, 8])] };
}

/** Pode o ADM forçar a abertura da próxima etapa? As etapas 4 a 7 abrem sozinhas pelo dado; a obra que ficou sem saída precisa dessa porta. */
export const podeForcarAbertura = (g: GuardaObra, f: Fase2): boolean =>
  g.adm && !f.din.cancelada && !f.din.fechada && f.etapa !== null && f.etapa >= 4 && f.etapa <= 7;

/**
 * POST etapa-obra com `forcar: true` (só ADM): conclui a etapa da vez (4 a 7) e abre a seguinte mesmo sem o dado, para a obra que ficou presa (item antigo de
 * tipo `outro`, kit numa linha só da nota). Nada volta de etapa. O histórico leva `forcar`, `concluir` e `abrir` com o nome do ADM; o motivo (opcional, até 300
 * caracteres) mora no `obra.json` privado (`forcadas`), nunca no estado assinado. `preparar` materializa os dois estados (a primeira escrita).
 */
export async function forcarAbertura(g: GuardaObra, f: Fase2, n: 4 | 5 | 6 | 7, motivoBruto: unknown, preparar: () => Promise<void>): Promise<{ http: number; json: Record<string, unknown> }> {
  if (motivoBruto !== undefined && typeof motivoBruto !== 'string') return { http: 400, json: { ok: false, error: 'Pedido inválido.' } };
  const motivo = (motivoBruto ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (!g.adm) return { http: 403, json: { ok: false, error: 'Só o administrador força a abertura de uma etapa.' } };
  if (f.din.cancelada) return { http: 409, json: { ok: false, error: 'Venda cancelada.' } };
  if (f.din.fechada) return { http: 409, json: { ok: false, error: MSG_FECHADA } };
  if (f.etapa !== n) return { http: 409, json: { ok: false, error: 'Esta etapa não é a da vez.' } };
  await preparar();
  const agora = new Date().toISOString();
  const naoVez = { recusa: 'Esta etapa não é a da vez.', http: 409 } as Recusa;
  const r = await mudarObra(g.id, () => obraVazia(g.id), (e0) => {
    if (e0.fechada) return { recusa: MSG_FECHADA, http: 409 } as Recusa;
    const e = aplicarPortoes(e0, { privada: f.privada, docsIds: f.docsIds, slots: f.slotsMap }, agora, 'leitura');
    if (etapaAtualCompleta(null, e, null) !== n) return naoVez;
    return forcarEtapa(e, n, agora, g.nome) ?? naoVez;
  });
  if (ehRecusa(r)) return { http: r.http, json: { ok: false, error: r.recusa } };
  try { await mudarObraPrivada(g.id, g.nome, null, null, (p) => ({ ...p, forcadas: [...p.forcadas, { em: agora, por: g.nome, etapa: n, motivo }].slice(-10) })); }
  catch (e) { logErroJornada('forcar_motivo', e); }   // a abertura já valeu; só o motivo não ficou
  return { http: 200, json: { ok: true, forcada: true, etapa_atual: etapaAtualCompleta(null, r, null) } };
}

/** Os campos do item da Compra que são EQUIPAMENTO (sempre editáveis, até com a conta fechada). Valor, orçado, comprado, compra e documento ficam de fora. */
const CAMPOS_EQUIPAMENTO = ['descricao', 'tipo', 'marca', 'modelo', 'potencia_w', 'potencia_kw', 'quantidade', 'garantia_fabricacao_anos', 'garantia_desempenho_anos', 'garantia_anos', 'serie'] as const;
const RECUSA_FECHADA = { recusa: MSG_FECHADA, http: 409 } as Recusa;

/**
 * O PUT da seção Compra com a CONTA FECHADA: só os campos de equipamento dos itens que já existem (casados pelo id) mudam. Se o corpo trouxer DINHEIRO ou estrutura
 * alterados (item novo ou removido, compras, valor, orçado, o tique "Comprado", a ligação com a compra), a resposta é a recusa 409 de hoje. Quem não vê o livro
 * não manda valor (vem nulo): o valor não entra na comparação. O normalizador limpa e limita cada valor.
 */
export function equipamentoComContaFechada(p: ObraPrivada, dados: Record<string, unknown>, veDinheiro: boolean): ObraPrivada | Recusa {
  const brutos = Array.isArray(dados.itens) ? dados.itens : [];
  const doCliente = new Map<string, Record<string, unknown>>();
  for (const x of brutos) if (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') doCliente.set((x as { id: string }).id, x as Record<string, unknown>);
  if (brutos.length !== p.compra.itens.length || p.compra.itens.some((i) => !doCliente.has(i.id))) return RECUSA_FECHADA;
  const comprasIds = (Array.isArray(dados.compras) ? dados.compras : []).map((c) => (c as { id?: unknown } | null)?.id);
  if (comprasIds.length !== p.compra.compras.length || p.compra.compras.some((c) => !comprasIds.includes(c.id))) return RECUSA_FECHADA;
  const igual = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
  const itens = p.compra.itens.map((i) => {
    const o = doCliente.get(i.id) as Record<string, unknown>;
    const mexeu = (veDinheiro && (!igual(o.valor_centavos, i.valor_centavos) || !igual(o.orcado_centavos, i.orcado_centavos)))
      || (typeof o.comprado === 'boolean' && o.comprado !== i.comprado) || (o.compra_id !== undefined && !igual(o.compra_id, i.compra_id));
    if (mexeu) return null;
    const novo: Record<string, unknown> = { ...i };
    for (const k of CAMPOS_EQUIPAMENTO) if (k in o) novo[k] = o[k];
    return novo as unknown as ObraPrivada['compra']['itens'][number];
  });
  if (itens.includes(null)) return RECUSA_FECHADA;
  return normalizarObraPrivada({ ...p, compra: { ...p.compra, itens } });
}
