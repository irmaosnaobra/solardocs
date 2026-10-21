// ─────────────────────────────────────────────────────────────────────────────
// UM TURNO, do contexto pronto até o `pensar`. Ensaio e replay compartilham este miolo.
// Sem banco e sem envio: quem chama lê o que precisa e grava o resultado.
//
// Obrigações de quem chama a trava (sem isto as falas certas são barradas):
//  · `agora` (horário real do turno) e `acoesSemFala` em todo turno;
//  · `qualificado` recalculado a cada turno (Helena), do que o lead escreveu e dos `dados` dos
//    turnos ANTERIORES. Nunca dos `dados` da chamada em curso: a saída do modelo não se autoriza;
//  · `valoresDaPessoa`: reais que o lead escreveu (texto, transcrição de áudio), os dos `dados`
//    anteriores que falam de conta e o total que a LEITURA da conta de luz (imagem ou PDF) mostrou,
//    lido numa chamada à parte, sem a persona;
//  · `prazosDaPessoa`: os prazos que o lead disse;
//  · 'abertura' só quando o turno é a primeira mensagem nossa da conversa.
// ─────────────────────────────────────────────────────────────────────────────

import { MODELO_RESERVA, montarPedido, pensar, type ClienteIA, type Pensamento } from './ia';
import { prepararMidia, type BlocoMidia, type CacheMidia } from './midia';
import { ACOES_SEM_FALA } from './personas/comum';
import { personaDef } from './personas';
import { semAcento, valoresEmReais } from './trava';
import { diaBRT } from './relogio';
import type { DecisaoPorteiro } from './porteiro';
import type { MsgGravada, TurnoGravado } from './armazem';
import type { ContextoLead, MsgConversa, Persona } from './tipos';

// ── textos que o lead disse ──────────────────────────────────────────────────

const PREFIXO_AUDIO = '(áudio transcrito) ';

/** Põe a transcrição (do cache de mídia) nas mensagens de áudio que ainda não a têm. Devolve cópias. */
export function comTranscricoes(msgs: readonly MsgConversa[], cache: CacheMidia): MsgConversa[] {
  return msgs.map(m => {
    if (m.tipo !== 'audio' || m.transcricao) return m;
    const b = cache.get(m.id);
    if (b && b.tipo === 'texto' && b.texto.startsWith(PREFIXO_AUDIO)) {
      return { ...m, transcricao: b.texto.slice(PREFIXO_AUDIO.length) };
    }
    return m;
  });
}

/** O que o lead escreveu ou falou (texto digitado e áudio transcrito), uma entrada por mensagem. */
export function textosDoLead(msgs: readonly MsgConversa[], midias: readonly BlocoMidia[] = []): string[] {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.autor !== 'lead') continue;
    const t = String(m.texto ?? '').trim() || String(m.transcricao ?? '').trim();
    if (t) out.push(t);
  }
  for (const b of midias) {
    if (b.tipo === 'texto' && b.texto.startsWith(PREFIXO_AUDIO)) out.push(b.texto.slice(PREFIXO_AUDIO.length));
  }
  return out;
}

// ── valores, prazos e qualificação ───────────────────────────────────────────

const CHAVE_DE_VALOR = /valor|conta|gasto|reais|fatura|luz/;
const CHAVE_DE_ENERGIA = /kwh|consumo|potencia/;
const CHAVE_DE_PRAZO = /prazo|quando|inicio|comec/;

/** Número solto de um valor de `dados` ("480", "1.250,90", "R$ 480"): reais inteiros ou com centavos. */
function numeroDeDados(v: string): number | null {
  const m = /^\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:reais)?\s*$/i.exec(v);
  if (!m) return null;
  const txt = m[1]!;
  const milhar = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(txt);
  const n = Number(milhar ? txt.replace(/\./g, '').replace(',', '.') : txt.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Valores em reais que a PESSOA deu: o que escreveu/falou e os `dados` anteriores sobre conta. */
export function valoresDaPessoaDe(
  textos: readonly string[], dadosAnteriores: Record<string, string>, daConta: readonly number[] = [],
): number[] {
  const achados = new Set<number>(daConta.filter(n => Number.isFinite(n) && n > 0));
  for (const t of textos) for (const v of valoresEmReais(semAcento(t), false)) achados.add(v);
  for (const [k, v] of Object.entries(dadosAnteriores)) {
    const chave = semAcento(k);
    if (CHAVE_DE_ENERGIA.test(chave)) continue;
    for (const x of valoresEmReais(semAcento(v), false)) achados.add(x);
    if (CHAVE_DE_VALOR.test(chave)) {
      const n = numeroDeDados(v);
      if (n !== null) achados.add(n);
    }
  }
  return [...achados];
}

/** Os prazos que o lead disse (textos dele) e os `dados` anteriores sobre prazo. */
export function prazosDaPessoaDe(textos: readonly string[], dadosAnteriores: Record<string, string>): string[] {
  const doDados = Object.entries(dadosAnteriores).filter(([k]) => CHAVE_DE_PRAZO.test(semAcento(k))).map(([, v]) => v);
  return [...textos, ...doDados];
}

const NUMERO_VAGAS = String.raw`(?:\d+|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)`;
const RE_IMOVEL = /\b(?:propriet\w*|dono|dona|inquilin\w*|alugad[oa]|alugo|locatari\w*|proprio|propria|(?:e|eh)\s+(?:meu|minha)|meu (?:ponto|terreno|imovel|posto|espaco|lote))\b/;
const RE_PADRAO = /\b(?:monofasic\w*|bifasic\w*|trifasic\w*)\b/;
const RE_VAGAS = new RegExp(String.raw`\b${NUMERO_VAGAS}\s+vagas?\b|\bvagas?\b[^.?!]{0,15}\b${NUMERO_VAGAS}\b`);

export interface Qualificacao { imovel: boolean; padrao: boolean; vagas: boolean; completa: boolean }

/** Helena: imóvel, padrão de energia e vagas já respondidos? Do que o lead disse e dos `dados` anteriores. */
export function qualificacaoDe(textos: readonly string[], dadosAnteriores: Record<string, string>): Qualificacao {
  const t = semAcento(textos.join('\n'));
  const tem = (k: string): boolean => String(dadosAnteriores[k] ?? '').trim() !== '';
  const imovel = tem('imovel') || RE_IMOVEL.test(t);
  const padrao = tem('padrao') || RE_PADRAO.test(t);
  const vagas = tem('vagas') || RE_VAGAS.test(t);
  return { imovel, padrao, vagas, completa: imovel && padrao && vagas };
}

/** Une os `dados` de turnos anteriores, do mais antigo ao mais novo (o mais novo vence). */
export function juntarDados(lista: ReadonlyArray<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of lista) for (const [k, v] of Object.entries(d)) if (String(v ?? '').trim()) out[k] = v;
  return out;
}

// ── leitura da conta de luz (imagem ou PDF) ──────────────────────────────────

const SCHEMA_CONTA = {
  type: 'object',
  properties: {
    e_conta_de_luz: { type: 'boolean' },
    valor_total_reais: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['e_conta_de_luz', 'valor_total_reais'],
  additionalProperties: false,
};

/**
 * O total em reais de uma conta de luz mostrada em imagem ou PDF, lido numa chamada à parte (modelo da
 * reserva, sem a persona). Sem imagem/PDF, ou se a leitura falhar, devolve []. Conta como uma chamada da cota.
 */
export async function lerValorDaConta(midias: readonly BlocoMidia[], cliente: ClienteIA): Promise<number[]> {
  const visuais = midias.filter(b => b.tipo === 'imagem' || b.tipo === 'pdf');
  if (!visuais.length) return [];
  try {
    const conteudo: Array<Record<string, unknown>> = visuais.map(b =>
      b.tipo === 'imagem' ? { type: 'image', source: b.source } : { type: 'document', source: (b as { source: unknown }).source });
    conteudo.push({ type: 'text', text: 'Isto é uma conta de luz? Se for, diga o valor total a pagar em reais (número). Se não for ou não der para ler, valor_total_reais nulo.' });
    const r = await cliente.messages.create({
      model: MODELO_RESERVA,
      max_tokens: 300,
      system: [{ type: 'text', text: 'Você lê contas de luz brasileiras. Responda só o JSON pedido.' }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA_CONTA } },
      messages: [{ role: 'user', content: conteudo }],
    }, { timeout: 60_000, maxRetries: 0 });
    const texto = (Array.isArray(r?.content) ? r.content : []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('');
    const j = JSON.parse(texto) as { e_conta_de_luz?: boolean; valor_total_reais?: number | null };
    const v = Number(j.valor_total_reais);
    return j.e_conta_de_luz === true && Number.isFinite(v) && v > 0 ? [v] : [];
  } catch {
    return [];
  }
}

// ── o turno ──────────────────────────────────────────────────────────────────

export interface EntradaTurno {
  persona: Persona;
  /** Contexto já montado: `msgs` é o histórico ATÉ este turno (inclusive o bloco do lead) e `agora` é o instante do turno. */
  ctx: ContextoLead;
  /** O bloco do lead que originou o turno (vazio na abertura). */
  novas: readonly MsgConversa[];
  /** `dados` dos turnos anteriores desta conversa (nunca os desta chamada). */
  dadosAnteriores: Record<string, string>;
  /** Primeira mensagem nossa da conversa (a conversa começou por nós). */
  abertura: boolean;
  cliente: ClienteIA;
  /** Mídias já lidas (histórico e novas). Recebe o que for lido agora. */
  cacheMidia: CacheMidia;
}

export interface ResultadoTurno {
  pensamento: Pensamento;
  qualificado: boolean;
  valoresDaPessoa: number[];
  /** Ids das mídias lidas AGORA (não vinham do cache): quem chama persiste. */
  midiasNovas: BlocoMidia[];
}

export async function pensarTurno(e: EntradaTurno): Promise<ResultadoTurno> {
  const jaTinha = new Set(e.cacheMidia.keys());
  const midias = await prepararMidia(e.novas, e.cacheMidia);
  const midiasNovas = midias.filter(b => !jaTinha.has(b.msgId));

  const msgs = comTranscricoes(e.ctx.msgs, e.cacheMidia);
  const textos = textosDoLead(msgs, midias);
  const daConta = e.persona === 'carla' ? [] : await lerValorDaConta(midias, e.cliente);
  const valores = valoresDaPessoaDe(textos, e.dadosAnteriores, daConta);
  const qualificado = e.persona === 'helena' ? qualificacaoDe(textos, e.dadosAnteriores).completa : false;

  const ctx: ContextoLead = { ...e.ctx, msgs, qualificado };
  const def = personaDef(e.persona);
  const pensamento = await pensar({
    persona: def,
    pedido: montarPedido(def, ctx),
    conv: msgs,
    midias,
    cliente: e.cliente,
    trava: {
      completa: ctx.completa,
      qualificado,
      valoresDaPessoa: valores,
      acoesSemFala: ACOES_SEM_FALA,
      agora: ctx.agora,
      prazosDaPessoa: prazosDaPessoaDe(textos, e.dadosAnteriores),
      ...(e.abertura ? { permiteIniciativa: 'abertura' as const } : {}),
    },
  });
  return { pensamento, qualificado, valoresDaPessoa: valores, midiasNovas };
}

// ── o que NÃO é registro de silêncio ─────────────────────────────────────────

/**
 * A agente não falou por motivo de infraestrutura (crédito, chave, limite, queda, teto/disjuntor): o turno
 * NÃO é gravado como "a agente calou", e a reserva da vez é solta para tentar de novo.
 */
export function falhaDeInfra(p: Pensamento): boolean {
  if (p.falou) return false;
  return p.causa === 'ia_sem_credito' || p.causa === 'ia_chave' || p.causa === 'ia_limite' || p.causa === 'outro';
}

// ── o registro do turno (o que vai ao bucket) ────────────────────────────────


export function paraGravada(m: MsgConversa): MsgGravada {
  return {
    id: m.id, autor: m.autor, tipo: m.tipo,
    texto: (String(m.texto ?? '').trim() || String(m.transcricao ?? '').trim()) || null,
    momento: m.momment,
  };
}

/** As mensagens nossas que vieram logo depois do bloco do lead (a resposta de verdade), até o lead falar de novo. */
export function respostaReal(depois: readonly MsgConversa[]): MsgConversa[] {
  const out: MsgConversa[] = [];
  for (const m of depois) {
    if (m.autor === 'lead') break;
    out.push(m);
  }
  return out;
}

export interface ArgsGravado {
  origem: 'vivo' | 'replay';
  hmac: string;
  kind: 'resposta' | 'abertura';
  waId: number;
  momento: string;
  decisao: DecisaoPorteiro;
  /** Persona que chamou o modelo; null quando o porteiro barrou. */
  persona: Persona | null;
  resultado: ResultadoTurno | null;
  entrada: readonly MsgConversa[];
  nHistorico: number;
  real: readonly MsgConversa[] | null;
  agora: Date;
}

/** Monta o JSON do turno. O texto do lead entra aqui (bucket privado) e em nenhum outro lugar. */
export function montarGravado(a: ArgsGravado): TurnoGravado {
  const p = a.resultado?.pensamento ?? null;
  const falou = !!p && p.falou === true;
  const saida = p && p.falou ? p.saida : null;
  const uso = p ? p.uso : null;
  return {
    v: 1,
    origem: a.origem,
    dia: diaBRT(a.momento),
    hmac: a.hmac,
    wa_id: a.waId,
    momento: a.momento,
    kind: a.kind,
    dona: a.decisao.dona,
    passo: a.decisao.passo,
    motivo_porteiro: a.decisao.motivo,
    persona: a.persona,
    falou,
    bolhas: saida?.bolhas ?? [],
    acao: saida?.acao ?? null,
    peca: saida?.peca ?? null,
    dados: saida?.dados ?? {},
    resumo: saida?.resumo ?? null,
    motivo_silencio: !p ? a.decisao.motivo : p.falou ? null : p.motivo,
    reescrita: p && p.falou ? (p.reescrita ?? null) : null,
    modelo: p ? p.modelo : null,
    uso: uso ? { entrada: uso.entrada, cache_criado: uso.cache_criado, cache_lido: uso.cache_lido, saida: uso.saida } : null,
    qualificado: a.resultado && a.persona === 'helena' ? a.resultado.qualificado : null,
    pergunta_porteiro: a.decisao.pergunta ?? null,
    entrada: a.entrada.map(paraGravada),
    n_historico: a.nHistorico,
    real: a.real ? a.real.map(paraGravada) : null,
    gravado_em: a.agora.toISOString(),
  };
}

/** A dona que o próximo turno herda: a persona do último turno com resposta, ou o alvo de um passar_*. */
export function donaAtualDe(turnos: ReadonlyArray<Pick<TurnoGravado, 'persona' | 'acao' | 'falou'>>): Persona | null {
  for (let i = turnos.length - 1; i >= 0; i--) {
    const t = turnos[i]!;
    if (!t.persona) continue;
    const passou = /^passar_(carla|duda|helena)$/.exec(String(t.acao ?? ''));
    if (t.falou && passou) return passou[1] as Persona;
    return t.persona;
  }
  return null;
}
