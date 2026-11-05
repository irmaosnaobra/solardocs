// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): a BASE das mensagens. LÊ e TRAVA; NÃO ENVIA.
//
// Tudo aqui nunca lança (erro vira `'erro'` ou `null`). Toda trava é um INSERT com chave única (nunca upsert); o `valor` da trava chega
// PRONTO do arquivo de envio, com o nome do robô dentro: esta base não escreve nome de robô (a `chefeGuarda` lê o `robo` pelo arquivo).
// Nada pessoal em chave, valor ou log: só o id do card e o código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { linhaEmCooldown } from '../agents/zapiClient';
import { chavesExistentes, liberarChave, reservarChave } from '../agentes5040/cota';
import { CHAVE_LINHA_PAUSA } from '../agentes5040/vivoEnvio';
import { ehDestinoInterno } from '../chefe/destinos';
import { classificarErroEnvio } from '../chefe/decidir';
import { prefixosTotalDaLinha } from '../agents/whatsapp/lineThrottle';
import { TEL_AVISO } from './solarEquipe';
import { PREFIXO_ENV, PREFIXO_VEZ, minutoDaVez, semComprovanteDoLivro, type DinheiroObra, type ObraFila } from './jornadaMensagensPuro';
import { lerTodasJornadas, lerPrivadoJornada } from '../gerador/jornadaSolarBanco';
import { ehFinalizada, lerContextoDasVendas, lerCorte } from '../gerador/jornadaCorte';
import { lerObraPrivada, lerTodasObras } from '../gerador/jornadaObraBanco';
import { ehCardSolarVendido, lerCardsPorIds, lerTodasLigacoes, type Ligacao } from '../gerador/vendaSolarHub';
import type { CardVendido } from '../gerador/fichaEletroposto';
import { nomeSimples } from '../gerador/solarObras';
import { itensDaEtapa, type EstadoJornada } from '../gerador/jornadaSolar';
import { itensDaEtapaObra, materialDaCompra, pendenciasDaObra, etapaAtualCompleta, type EstadoObra } from '../gerador/jornadaObra';
import { AJUSTES_PADRAO, livroDaObra, regraDoVendedor } from '../gerador/jornadaDinheiro';
import { lerAjustes, lerLancamentosDaObra } from '../gerador/jornadaDinheiroBanco';
import { lerDocsComVersao } from '../gerador/docsClienteBanco';
import { lerCadastroVisto } from '../gerador/cadastroVenda';
import { lerProposta } from '../gerador/dossieVenda';

export const TELEFONE_DA_SONDA = '34900000000';
const POR_HORA_MS = 3600_000;

export interface Leitura {
  obras: ObraFila[];
  cards: Map<number, CardVendido>;
  ligs: Map<number, Ligacao>;
}

const logBase = (que: string, err?: unknown): void =>
  console.error(`[jornada-msg] ${que}`, (err as { code?: unknown; codigo?: unknown } | null)?.code ?? (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

// ── A vez, as travas e os carimbos ──────────────────────────────────────────────────────────────────────────────────

/** A vez desta rodada (minuto par UTC), por INSERT: quem perde não manda nada nesta rodada. */
export async function tomarVez(agora: Date): Promise<'tomada' | 'ocupada' | 'erro'> {
  const r = await reservarChave(PREFIXO_VEZ + minutoDaVez(agora), {}, agora);
  return r === 'reservada' ? 'tomada' : r === 'ja_existe' ? 'ocupada' : 'erro';
}

/** Apaga as vezes com mais de 2 h. Erro é ignorado. */
export async function faxinaDasVezes(agora: Date): Promise<void> {
  try { await supabase.from('system_state').delete().like('key', `${PREFIXO_VEZ}%`).lt('updated_at', new Date(agora.getTime() - 2 * POR_HORA_MS).toISOString()); } catch { /* a próxima faxina leva */ }
}

/** A trava É o carimbo: INSERT com chave única, ANTES do envio. `ja` = já existia (outra rodada ou envio anterior). */
export async function travar(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'ok' | 'ja' | 'erro'> {
  const r = await reservarChave(chave, valor, agora);
  return r === 'reservada' ? 'ok' : r === 'ja_existe' ? 'ja' : 'erro';
}

/** Marca o resultado na MESMA chave (update por `key`, nunca upsert). Erro é só log. */
export async function marcarTrava(chave: string, campos: Record<string, unknown>, agora: Date = new Date()): Promise<void> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    const antigo = ((data as { value?: Record<string, unknown> } | null)?.value) ?? {};
    await supabase.from('system_state').update({ value: { ...antigo, ...campos, em: antigo.em ?? agora.toISOString() }, updated_at: agora.toISOString() }).eq('key', chave);
  } catch (err) { logBase('marcar', err); }
}

export const soltarTrava = (chave: string): Promise<void> => liberarChave(chave);

/** Quais destas chaves já existem; `null` = não deu para ler (quem chama NÃO envia). */
export async function jaTravadas(chaves: readonly string[]): Promise<Set<string> | null> {
  try { return await chavesExistentes(chaves); } catch (err) { logBase('ja_travadas', err); return null; }
}

/** Envios da pessoa na última hora (carimbos `jornada_env:` que terminam em `:<pessoa>`). `null` = erro de leitura. */
export async function enviosDaPessoaNaHora(pessoa: string, agora: Date): Promise<number | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_ENV}%`).gte('updated_at', new Date(agora.getTime() - POR_HORA_MS).toISOString()).limit(200);
    if (error) return null;
    return ((data ?? []) as Array<{ key: string; value?: { sonda?: boolean } | null }>)
      .filter((l) => String(l.key).startsWith(PREFIXO_ENV) && String(l.key).endsWith(`:${pessoa}`) && l.value?.sonda !== true).length;
  } catch { return null; }
}

/** A linha está livre? Nem em cooldown da Z-API, nem pausada por erros seguidos. Erro de leitura dá false. */
export async function linhaLivre(agora: Date): Promise<boolean> {
  try {
    if (linhaEmCooldown('io')) return false;
    const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
    if (error) return false;
    const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
    return !(Number.isFinite(ate) && ate > agora.getTime());
  } catch { return false; }
}

/** O teto de envios da linha por hora para um aviso à equipe (o mesmo de `avisoGrupoSolardoc`: 40). */
export const LINHA_MAX_HORA_PARA_AVISAR = 40;

/** Cabe mais um aviso na linha? Conta todos os carimbos da linha na última hora; leitura que falha vale "não cabe" (o aviso fica para a próxima rodada). */
export async function cabeNaLinha(agora: Date): Promise<boolean> {
  try {
    const filtro = prefixosTotalDaLinha().map((p) => `key.like.${p}%`).join(',');
    const { data, error } = await supabase.from('system_state').select('key').or(filtro)
      .gte('updated_at', new Date(agora.getTime() - POR_HORA_MS).toISOString()).limit(LINHA_MAX_HORA_PARA_AVISAR + 1);
    return !error && (data?.length ?? 0) < LINHA_MAX_HORA_PARA_AVISAR;
  } catch { return false; }
}

/** O erro de envio é da LINHA (5xx, timeout, instância fora)? Erro do destino ou desconhecido dá false. */
export const erroEhDaLinha = (err: unknown): boolean => classificarErroEnvio(err) === 'linha';

// ── Telefones da equipe: da fonte que já existe, nunca escritos aqui ──────────────────────────────────────────────────────

export const TEL_EQUIPE = (): Record<string, string> => TEL_AVISO;
/** O telefone da pessoa, SE ele está na lista da equipe e passa no `ehDestinoInterno`; senão null. */
export function telefoneDaEquipe(pessoa: string): string | null {
  const tel = TEL_AVISO[pessoa];
  return tel && ehDestinoInterno(tel, Object.values(TEL_AVISO)) ? tel : null;
}

// ── A leitura do mundo ───────────────────────────────────────────────────────────────────────────────────────────────

const obraDe = (id: number, card: CardVendido, js: EstadoJornada | null, jo: EstadoObra | null, lig: Ligacao | undefined): ObraFila => ({
  card: id, codigo: lig?.venda ?? null, cliente: String(card.cliente_nome ?? ''), cidade: String(card.cidade ?? ''),
  vendedor: js?.vendedor || nomeSimples(card.vendedor_nome), js, jo, cancelada: !!js?.cancelada,
});

/** Todos os estados assinados mais os cards. Só card solar vendido e que não é o da sonda. `null` = a leitura falhou (ninguém envia). */
export async function lerTudo(): Promise<Leitura | null> {
  try {
    const [jornadas, obras, ligs, corte] = await Promise.all([lerTodasJornadas(), lerTodasObras(), lerTodasLigacoes(), lerCorte()]);
    const ids = [...new Set([...jornadas.keys(), ...obras.keys()])];
    const cards = await lerCardsPorIds(ids);
    const contextoDe = await lerContextoDasVendas(ids, jornadas, corte);
    const saida: ObraFila[] = [];
    for (const id of ids) {
      const card = cards.get(id);
      if (!card || !ehCardSolarVendido(card) || String(card.cliente_telefone ?? '').replace(/\D/g, '').endsWith(TELEFONE_DA_SONDA)) continue;
      // Venda FINALIZADA fica fora de todo robô (fila das 08:00, "É sua", escalada, placar, aviso de venda, aniversários, liberação): nada a cobrar nem a anunciar.
      if (ehFinalizada(jornadas.get(id) ?? null, obras.get(id) ?? null, corte, contextoDe(id))) continue;
      saida.push(obraDe(id, card, jornadas.get(id) ?? null, obras.get(id) ?? null, ligs.get(id)));
    }
    return { obras: saida.sort((a, b) => a.card - b.card), cards, ligs };
  } catch (err) { logBase('leitura', err); return null; }
}

/** A leitura de UM card (a sonda): o estado gravado dele, mesmo sendo o card de teste. */
export async function lerUmCard(id: number): Promise<Leitura | null> {
  try {
    const [jornadas, obras, ligs] = await Promise.all([lerTodasJornadas(), lerTodasObras(), lerTodasLigacoes()]);
    const card = (await lerCardsPorIds([id])).get(id);
    if (!card) return null;
    return { obras: [obraDe(id, card, jornadas.get(id) ?? null, obras.get(id) ?? null, ligs.get(id))], cards: new Map([[id, card]]), ligs };
  } catch (err) { logBase('leitura_card', err); return null; }
}

// ── O dinheiro pendente e o "Falta" (só dentro da janela da fila; nunca nas outras rodadas) ───────────────────────────────

/** Faz `f` em lotes de `n` em paralelo; a obra que falha sai da lista (só ela). */
async function emLotes<T, R>(lista: readonly T[], n: number, f: (x: T) => Promise<R | null>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < lista.length; i += n) {
    const r = await Promise.all(lista.slice(i, i + n).map((x) => f(x).catch((err) => { logBase('obra', err); return null; })));
    for (const x of r) if (x) saida.push(x);
  }
  return saida;
}

/** O dinheiro pendente das obras abertas (não canceladas, não fechadas): comissão por pagar, a receber, e o que a IA não conferiu. */
export async function dinheiroDasObras(obras: readonly ObraFila[]): Promise<DinheiroObra[]> {
  let ajustes = AJUSTES_PADRAO;
  try { const l = await lerAjustes(); if (l.valido) ajustes = l.ajustes; } catch (err) { logBase('ajustes', err); }
  const abertas = obras.filter((o) => (o.js || o.jo) && !o.cancelada && !o.jo?.fechada);
  return emLotes(abertas, 4, async (o) => {
    const [{ lancamentos, ignoradas }, privada, privJ] = await Promise.all([lerLancamentosDaObra(o.card), lerObraPrivada(o.card), lerPrivadoJornada(o.card)]);
    const v = privJ?.venda?.valor_centavos ?? 0;
    const congelada = privada?.regra_comissao ?? null;
    const pela = regraDoVendedor(o.vendedor, ajustes);
    const regra = congelada ? congelada.linhas.map((l) => ({ ...l })) : pela.linhas;
    const livro = livroDaObra({
      lancamentos, ignoradas, vendaCentavos: v > 0 ? v : null, vendedor: o.vendedor, regra, regraCongelada: !!congelada, regraAviso: congelada ? null : pela.aviso,
      previsto: privada?.previsto ?? null, pendenciasDaObra: pendenciasDaObra(privada, lancamentos), engenheiroAPagar: o.js?.etapas[3].engenheiro === 'a_pagar',
      material: materialDaCompra(privada, lancamentos), adm: false,
    });
    const naoConf = (retirada: boolean) => livro.linhas.filter((l) => !l.estorno_de && !l.estornada && (l.conferencia === 'sem_leitura' || l.conferencia === 'baixa_confianca' || l.conferencia === 'divergente')
      && (l.grupo === 'retirada') === retirada).length;
    const x: DinheiroObra = {
      card: o.card, rotulo: (o.codigo && /^#\d{3,6}$/.test(o.codigo) ? `${o.codigo} ` : '') + String(o.cliente ?? '').replace(/[*_~]/g, '').trim(),
      comissoes: livro.a_pagar.filter((p) => p.tipo === 'comissao' && !p.devolver && (p.valor_centavos ?? 0) > 0)
        .map((p) => ({ valor_centavos: p.valor_centavos as number, papel: p.papel === 'socio' ? 'socio' as const : 'venda' as const })),
      a_receber_centavos: livro.a_receber && livro.a_receber > 0 ? livro.a_receber : 0,
      nao_conferidas: naoConf(false), nao_conferidas_retirada: naoConf(true),
      sem_comprovante: semComprovanteDoLivro(livro.linhas),
    };
    return x.comissoes.length || x.a_receber_centavos || x.nao_conferidas || x.nao_conferidas_retirada || (x.sem_comprovante?.length ?? 0) ? x : null;
  });
}

/**
 * O "Falta" de uma obra parada: os itens da etapa atual que ainda não estão feitos. Etapas 4 a 8 usam a mesma conta da tela; as etapas 1 a 3
 * usam os arquivos do PRÓPRIO card (o dossiê da proposta ligada fica de fora, então na etapa 1 só entram os itens que não dependem de
 * arquivo: os do bloco Venda, o e-mail e o excedente). Erro de leitura devolve lista vazia (a linha "Falta" some, a obra continua na escalada).
 */
export async function faltaDaObra(o: ObraFila, ligs: ReadonlyMap<number, Ligacao>): Promise<string[]> {
  try {
    const n = etapaAtualCompleta(o.js, o.jo, null);
    if (n === null || n < 1 || n > 8) return [];
    const { reg } = await lerDocsComVersao('vendasolar', String(o.card));
    if (n >= 4) {
      const [privada, { lancamentos, ignoradas }] = await Promise.all([lerObraPrivada(o.card), lerLancamentosDaObra(o.card)]);
      if (!privada) return [];
      const livro = livroDaObra({
        lancamentos, ignoradas, vendaCentavos: null, vendedor: o.vendedor, regra: [], previsto: null, pendenciasDaObra: pendenciasDaObra(privada, lancamentos),
        material: materialDaCompra(privada, lancamentos), adm: false,
      });
      const slots = new Map<string, string[]>();
      for (const a of reg.arquivos) slots.set(a.slot, [...(slots.get(a.slot) ?? []), a.id]);
      return itensDaEtapaObra(n, { jo: o.jo, privada, livro, slots, docsIds: new Set(reg.arquivos.map((a) => a.id)) }).filter((i) => !i.feito).map((i) => i.texto);
    }
    const [cad, privado] = await Promise.all([lerCadastroVisto(o.card, 'vendasolar'), lerPrivadoJornada(o.card)]);
    const lig = ligs.get(o.card) ?? { proposta: null, venda: null, por: '', em: '' };
    const itens = itensDaEtapa(n, { lig, slots: new Set(reg.arquivos.map((a) => a.slot)), cad, privado, estado: o.js });
    const semArquivo = new Set(['proposta', 'kit', 'valor', 'prazo', 'email', 'excedente']);
    return itens.filter((i) => !i.feito && (n !== 1 || semArquivo.has(i.chave))).map((i) => i.texto);
  } catch (err) { logBase('falta', err); return []; }
}

/** A proposta ligada ao card (kWp e placas do aviso de venda), só na hora de enviar. Erro dá null. */
export async function propostaDoCard(codigo: string | null): Promise<{ qtd_placas: number | null; inversor: string | null; qtd_inversor: number | null; dados: Record<string, unknown> } | null> {
  if (!codigo) return null;
  try {
    const p = await lerProposta(codigo);
    return p ? { qtd_placas: p.qtd_placas, inversor: p.inversor, qtd_inversor: p.qtd_inversor, dados: p.dados } : null;
  } catch (err) { logBase('proposta', err); return null; }
}

// ── O contrato dos três arquivos de envio e do tick ─────────────────────────────────────────────────────────────────────

import type { GrupoMsg } from './jornadaMensagensPuro';
/** `vez.tomar()` toma a vez da rodada UMA vez e lembra o resultado. No modo `sonda` o transporte é FALSO (nenhuma chamada à Z-API). */
export interface CtxMsg {
  agora: Date;
  ligados: Record<GrupoMsg, string | null>;
  /** O `primeiro_ligado_em` de cada grupo (a elegibilidade dos aniversários). */
  primeiros: Partial<Record<GrupoMsg, string | null>>;
  vez: { tomar(): Promise<boolean> };
  sonda: boolean;
}
export interface ResultadoMsg { enviado: boolean; parar: boolean; motivo: string; chave?: string; travadas?: string[]; jaTravadas?: number }
export const nada = (motivo: string): ResultadoMsg => ({ enviado: false, parar: false, motivo });
export const parou = (motivo: string): ResultadoMsg => ({ enviado: false, parar: true, motivo });
