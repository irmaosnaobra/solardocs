// ─────────────────────────────────────────────────────────────────────────────
// A RESPOSTA DO CURIOSO VIRA VALOR (21/09/2026)
//
// O Curioso é quem ainda não disse quanto investe. A pauta do grupo pergunta, e
// este arquivo lê a resposta: se ela disser R$ 70 mil ou mais, o valor é gravado
// na linha da pessoa, e só isso já a leva pra Investidores, porque a aba e os pares
// classificam pelo valor gravado (destinoDe).
//
// SÓ SOBE, NUNCA DESCE. Três regras seguram isso:
//   1. Só vale valor CLARO de 70 ou mais, dito em "mil" ou "milhão", ou em R$
//      com o valor inteiro ("R$ 100.000,00"). O resto fica pro consultor ler no
//      "Responderam". A régua saiu das mensagens REAIS da linha (67 candidatas dos
//      últimos 30 dias, 21/09): número solto ("300", "Umas 100") era conta de luz
//      ou kWh; "R$ 680,00" era a conta, não 680 mil; "80k" era carregador de 80
//      kW; "12 mil" era BTU. Nenhuma delas pode promover ninguém.
//   2. Resposta abaixo de 70 não é gravada. Tirar alguém de "não disse" pra "disse
//      abaixo" muda a conversa do consultor, e um erro de leitura aí custa caro.
//   3. Só grava em quem AINDA está no Curioso. Valor que o consultor registrou,
//      ou que já qualifica, nunca é sobrescrito.
//
// ECO: quem cola a nossa pergunta de volta traz junto os exemplos "70 mil, 140 mil
// ou 280 mil". Sem reconhecer o eco, isso viraria R$ 280 mil e uma promoção falsa.
// O rodapé colado de volta ("a gente tira da lista") também não é pedido pra sair.
//
// SAIR: o rodapé promete tirar da lista quem pedir. Mensagem CURTA com "não tenho
// interesse", "sair", "parar", "não quero" marca sem_interesse na linha, que a fila
// de Avisos e a aba respeitam. Frase longa com condição ("se for franquia, não tenho
// interesse") é conversa, e fica com gente.
//
// Roda de 5 em 5 min, na carona do tick dos Avisos, e não manda mensagem nenhuma.
// É idempotente: o envio decidido ganha `resposta_valor` e não é relido.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { curiosos } from './eletropostoPares';

export type LeituraResposta = { tipo: 'valor'; mil: number } | { tipo: 'sair' } | null;

/** Pedido pra sair. Só vale em mensagem curta (até 8 palavras), e o "me" é
 *  obrigatório no "tira da lista": sem ele, é o nosso rodapé colado de volta. */
const SAIR: RegExp[] = [
  /^(sair|parar|pare|stop|remover|descadastrar|cancelar)[\s.!]*$/,
  /n[aã]o (tenho|tem) (mais )?interesse/,
  /\bsem interesse\b/,
  /n[aã]o quero (mais )?(receber|mensage)/,
  /\bme (tir[ae]m?|remov[ae]m?)\b/,
  /\btir[ae]m? (o )?meu (n[uú]mero|contato)/,
  /parem? de (me )?mandar/,
  /n[aã]o me (mande|mandem|envie)/,
  /^n[aã]o,? (quero|obrigad[oa])[\s.,!]*(obrigad[oa])?[\s.!]*$/,
];

/**
 * O que a resposta decide, ou null quando ela não decide nada com segurança.
 * Null não é erro: é a resposta que o consultor lê e resolve na mão.
 */
export function lerValorDaResposta(texto: unknown): LeituraResposta {
  const t = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/voc[eê] recebe isso porque/.test(t)) return null;   // o nosso rodapé colado de volta
  if (t.split(' ').length <= 8 && SAIR.some(re => re.test(t))) return { tipo: 'sair' };
  // Pergunta não é resposta ("precisa de 70 mil?"). Negação e condição tornam o
  // número ambíguo ("não tenho 70 mil", "depende do ponto"). Teto e faixa aberta
  // ("até 100 mil", "menos de 200") não garantem os 70. Tudo isso fica com gente.
  if (t.includes('?')) return null;
  // (`\b` não funciona depois de letra acentuada: "até" termina em "é", que o
  // regex não conta como letra. Por isso o lookahead.)
  if (/\bn[aã]o\b|\bnunca\b|\bnenhum|depende|\bat[eé](?![a-z])|menos de|abaixo de|no m[aá]ximo|\bse\b/.test(t)) return null;
  // Conta, consumo, aluguel, parcela: o número é de outra conversa com a linha.
  if (/\bconta\b|energia|consumo|\bluz\b|kwh|\bkw\b|kilowat|por m[eê]s|mensa(l|is)|aluguel|loca[cç][aã]o|parcela|\bbtus?\b/.test(t)) return null;
  const mil = valorClaro(t);
  if (mil === null || !(mil >= 70) || mil > 100000) return null;
  return { tipo: 'valor', mil };
}

/** "100.000" = 100000 · "1,5" = 1.5 · "680" = 680 */
function numero(bruto: string): number {
  return /^\d{1,3}(\.\d{3})+$/.test(bruto) ? Number(bruto.replace(/\./g, '')) : Number(bruto.replace(',', '.'));
}

/**
 * O menor valor em dinheiro que a frase diz, em mil, ou null. Só conta número com
 * unidade de dinheiro: "mil", "milhão" ou R$/reais (e aí o valor é em reais: "R$
 * 680,00" é 0,68 mil). Número colado em outra coisa ("12 mil btu", "150 mil
 * habitantes") não é dinheiro. Faixa ("80 a 120 mil") volta null: o piso dela
 * depende de como a pessoa escreveu, e isso é leitura de gente.
 */
function valorClaro(t: string): number | null {
  if (/\d[\d.,]*\s*(mil)?\s*(a|e|-|ou)\s*(r\$\s*)?\d/.test(t)) return null;
  const re = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d+)?)\s*(milh[aãoõ]es|milh[aã]o|mil\b|reais\b)?/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const unid = m[3] || '';
    const depois = t.slice(re.lastIndex, re.lastIndex + 20);
    if (/^\s*(de )?(btus?|habitantes|pessoas|kw|kwh|km|metros|m2|m²|carros|litros|watts?|w)\b/.test(depois)) continue;
    const bruto = m[2].replace(/,\d{1,2}$/, c => (unid ? c : ''));   // centavo de reais não conta
    const n = numero(bruto);
    if (!isFinite(n)) continue;
    if (/^milh/.test(unid)) vals.push(n * 1000);
    else if (unid === 'mil') vals.push(n);
    else if (unid === 'reais' || m[1]) vals.push(n / 1000);
  }
  return vals.length ? Math.min(...vals) : null;
}

/** O valor no formato das opções da LP, que o classificador lê de volta igual. */
export function valorNormalizado(mil: number): string {
  const br = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (mil >= 1000) return `R$ ${br(mil / 1000)} ${mil >= 2000 ? 'milhões' : 'milhão'}`;
  return `R$ ${br(mil)} mil`;
}

const achatar = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

/** A fala é a nossa própria pergunta colada de volta, inteira ou em pedaço? */
export function ehEcoDaPauta(fala: unknown, corpo: unknown): boolean {
  const f = achatar(fala);
  if (!f) return false;
  const pedacos = achatar(corpo)
    .replace(/\{(nome|cidade)\}/g, ' ')
    .split(/[.!?\n]+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 20);
  return pedacos.some(p => f.includes(p));
}

/** A Z-API às vezes entrega o número sem o nono dígito: pergunta pelas duas formas. */
function variantes(phone: string): string[] {
  const d = String(phone || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) out.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...out];
}

/** Resposta que chega depois disso é conversa nova, não resposta à pergunta. */
const JANELA_DIAS = 14;
const TABELA: Record<string, string> = { nota1: 'eletroposto_nota1', parceria: 'eletroposto_parceria' };

export interface ResultadoLeitura { olhados: number; subiram: number; sairam: number }

export async function lerRespostasCurioso(): Promise<ResultadoLeitura> {
  const r: ResultadoLeitura = { olhados: 0, subiram: 0, sairam: 0 };
  if ((process.env.CURIOSO_RESPOSTAS_OFF || '').trim() === '1') return r;

  // A leitura segue a PAUTA que pergunta o valor (tem o grupo Curioso), não o
  // grupo de cada envio. Numa pauta com Investidores E Curioso, os curiosos que
  // também são cadastro saem carimbados 'capital' (o cadastro vem primeiro na
  // audiência), e filtrar por envio deixaria a resposta deles sem ler nunca.
  const { data: pautas, error: errPautas } = await supabaseGerador.from('avisos')
    .select('id, corpo').contains('publicos', ['curioso']);
  if (errPautas) throw new Error(`pautas do curioso: ${errPautas.message}`);
  const corpoDe = new Map(((pautas || []) as Array<{ id: string; corpo: string }>).map(p => [p.id, p.corpo]));
  if (!corpoDe.size) return r;

  const desde = new Date(Date.now() - JANELA_DIAS * 86400_000).toISOString();
  const { data: envios, error } = await supabaseGerador.from('aviso_envios')
    .select('id, aviso_id, phone, enviado_em, origem_ref, resposta_valor')
    .in('aviso_id', [...corpoDe.keys()]).eq('status', 'ok').gte('enviado_em', desde).limit(1000);
  if (error) throw new Error(`envios do curioso: ${error.message}`);
  type Envio = { id: number; aviso_id: string; phone: string; enviado_em: string; origem_ref: string | null; resposta_valor: string | null };
  const abertos = ((envios || []) as Envio[]).filter(e => e.origem_ref && !e.resposta_valor);
  if (!abertos.length) return r;
  r.olhados = abertos.length;

  const { data: falas, error: errFalas } = await supabase.from('wa_mensagens').select('telefone, momment, texto')
    .eq('from_me', false).eq('is_group', false)
    .in('telefone', [...new Set(abertos.flatMap(e => variantes(e.phone)))])
    .gte('momment', abertos.reduce((min, e) => (e.enviado_em < min ? e.enviado_em : min), abertos[0].enviado_em))
    .order('momment', { ascending: true }).limit(5000);
  if (errFalas) throw new Error(`respostas do curioso: ${errFalas.message}`);
  const falasDe = new Map<string, Array<{ momment: string; texto: string | null }>>();
  for (const f of (falas || []) as Array<{ telefone: string; momment: string; texto: string | null }>) {
    const k = chaveContato(f.telefone) || f.telefone;
    if (!falasDe.has(k)) falasDe.set(k, []);
    falasDe.get(k)!.push(f);
  }

  // A ÚLTIMA fala decisiva de cada um manda: quem disse um valor e depois pediu
  // pra sair, saiu. A lista de hoje só é lida se alguém decidiu alguma coisa.
  let aindaCurioso: Set<string> | null = null;
  for (const e of abertos) {
    const k = chaveContato(e.phone) || e.phone;
    let decisiva: { l: NonNullable<LeituraResposta>; texto: string } | null = null;
    const enviadoEm = Date.parse(e.enviado_em);
    for (const f of falasDe.get(k) || []) {
      if (!(Date.parse(f.momment) > enviadoEm) || ehEcoDaPauta(f.texto, corpoDe.get(e.aviso_id))) continue;
      const l = lerValorDaResposta(f.texto);
      if (l) decisiva = { l, texto: String(f.texto || '') };
    }
    if (!decisiva) continue;

    const [origem, idTxt] = String(e.origem_ref).split(':');
    const tabela = TABELA[origem];
    if (!tabela || !Number(idTxt)) continue;
    const agora = new Date().toISOString();
    let marca: string;
    if (decisiva.l.tipo === 'valor') {
      marca = valorNormalizado(decisiva.l.mil);
      if (!aindaCurioso) aindaCurioso = new Set((await curiosos()).map(c => c.ref));
      if (aindaCurioso.has(String(e.origem_ref))) {
        const campo = origem === 'nota1' ? 'valor_investir' : 'capital_faixa';
        const { error: errGrava } = await supabaseGerador.from(tabela).update({ [campo]: marca }).eq('id', Number(idTxt));
        // Sem gravar, o envio NÃO é marcado: o próximo tick tenta de novo.
        if (errGrava) { logger.error('curioso', `não gravei o valor de ${e.origem_ref}`, errGrava); continue; }
        r.subiram++;
        logger.info('curioso', `${e.origem_ref} respondeu ${marca} e foi pra Investidores`);
      }
    } else {
      marca = 'sem interesse';
      const { error: errSai } = await supabaseGerador.from(tabela).update({ status: 'sem_interesse' }).eq('id', Number(idTxt));
      if (errSai) { logger.error('curioso', `não marquei ${e.origem_ref} como sem interesse`, errSai); continue; }
      r.sairam++;
    }
    await supabaseGerador.from('aviso_envios').update({
      resposta_valor: marca, resposta_texto: decisiva.texto.slice(0, 500), resposta_lida_em: agora,
    }).eq('id', e.id);
  }
  return r;
}

/** Nunca derruba quem chama: erro aqui vira log, e o próximo tick tenta de novo. */
export async function lerRespostasCuriosoSeguro(): Promise<ResultadoLeitura | { erro: string }> {
  try {
    return await lerRespostasCurioso();
  } catch (err) {
    logger.error('curioso', 'leitura das respostas falhou', err);
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}
