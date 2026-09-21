// ─────────────────────────────────────────────────────────────────────────────
// A RESPOSTA DO CURIOSO VIRA VALOR (21/09/2026)
//
// O Curioso é quem ainda não disse quanto investe. A pauta do grupo pergunta, e
// este arquivo lê a resposta: se ela disser R$ 70 mil ou mais, o valor é gravado
// na linha da pessoa, e só isso já a leva pra Investidores, porque a aba e os pares
// classificam pelo valor gravado (destinoDe).
//
// SÓ SOBE, NUNCA DESCE. Três regras seguram isso:
//   1. Só vale valor CLARO de 70 ou mais: com R$, mil, k ou milhão, ou a mensagem
//      inteira sendo só o número ("140"). "Tenho 2 carregadores", "2025" e "não
//      tenho 70 mil" não viram valor e ficam pro consultor ler no "Responderam".
//   2. Resposta abaixo de 70 não é gravada. Tirar alguém de "não disse" pra "disse
//      abaixo" muda a conversa do consultor, e um erro de leitura aí custa caro.
//   3. Só grava em quem AINDA está no Curioso. Valor que o consultor registrou,
//      ou que já qualifica, nunca é sobrescrito.
//
// ECO: quem cola a nossa pergunta de volta traz junto os exemplos "70 mil, 140 mil
// ou 280 mil". Sem reconhecer o eco, isso viraria R$ 280 mil e uma promoção falsa.
//
// SAIR: o rodapé promete tirar da lista quem pedir. "Não tenho interesse", "sair"
// e "parar" marcam sem_interesse na linha, que a fila de Avisos e a aba respeitam.
//
// Roda de 5 em 5 min, na carona do tick dos Avisos, e não manda mensagem nenhuma.
// É idempotente: o envio decidido ganha `resposta_valor` e não é relido.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { curiosos, numerosEmMil } from './eletropostoPares';

export type LeituraResposta = { tipo: 'valor'; mil: number } | { tipo: 'sair' } | null;

/** Pedido pra sair da lista. Frase inteira ou expressão inequívoca: "não quero"
 *  solto no meio de "não quero perder essa oportunidade" NÃO é pedido pra sair. */
const SAIR: RegExp[] = [
  /^(sair|parar|pare|stop|remover|descadastrar|cancelar)[\s.!]*$/,
  /n[aã]o (tenho|tem) (mais )?interesse/,
  /\bsem interesse\b/,
  /n[aã]o quero (mais )?(receber|mensage)/,
  /(me )?(tir[ae]m?|remov[ae]m?) (da|dessa|desta) lista/,
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
  if (SAIR.some(re => re.test(t))) return { tipo: 'sair' };
  // Pergunta não é resposta ("precisa de 70 mil?"). Negação e condição tornam o
  // número ambíguo ("não tenho 70 mil", "depende do ponto"). Teto e faixa aberta
  // ("até 100 mil", "menos de 200") não garantem os 70. Tudo isso fica com gente.
  if (t.includes('?')) return null;
  // (`\b` não funciona depois de letra acentuada: "até" termina em "é", que o
  // regex não conta como letra. Por isso o lookahead.)
  if (/\bn[aã]o\b|\bnunca\b|\bnenhum|depende|\bat[eé](?![a-z])|menos de|abaixo de|no m[aá]ximo/.test(t)) return null;

  let mil: number | null = null;
  if (/r\$|\breais\b|\d\s*(mil\b|k\b)|milh[aãoõ]|\d{1,3}(\.\d{3})+/.test(t)) {
    mil = valorClaro(t);
  } else {
    // A mensagem inteira é só o número, respondendo "quanto pensa em investir?"
    // com as opções em mil: "140" é 140 mil; "70000" é setenta mil reais.
    const curto = t.match(/^(?:uns|umas|cerca de|mais ou menos|aproximadamente|tipo)?\s*(\d{2,8})[\s.!]*$/);
    if (curto) {
      const n = Number(curto[1]);
      mil = curto[1].length <= 3 ? n : n / 1000;
    }
  }
  if (mil === null || !(mil >= 70) || mil > 100000) return null;
  return { tipo: 'valor', mil };
}

/**
 * O menor valor que a frase garante, em mil. Fora de faixa, só conta número com
 * cara de dinheiro (R$, mil, k, milhão, reais ou milhar com ponto): em "150 mil
 * pra 1 ponto" o valor é 150, não 1. Numa faixa ("50 a 100 mil", "entre 80 e 120
 * mil") vale o PISO, com todos os números: "50 a 100" não garante os 70.
 */
function valorClaro(t: string): number | null {
  const limpo = t.replace(/(\d{1,3}(?:\.\d{3})+),\d{1,2}\b/g, '$1');   // "100.000,00": centavo não é número
  if (/\d[\d.,]*\s*(mil|k)?\s*(a|e|-)\s*(r\$\s*)?\d/.test(limpo)) {
    const nums = numerosEmMil(limpo);
    return nums.length ? Math.min(...nums) : null;
  }
  const re = /(r\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(milh[aãoõ]es|milh[aã]o|mi\b|mil\b|k\b|reais\b)?/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpo))) {
    if (!m[1] && !m[3] && !/[.\s]\d{3}$/.test(m[2])) continue;
    const n = numerosEmMil(m[0].replace(/r\$|reais/g, ' '));
    if (n.length) vals.push(n[0]);
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

  const desde = new Date(Date.now() - JANELA_DIAS * 86400_000).toISOString();
  const { data: envios, error } = await supabaseGerador.from('aviso_envios')
    .select('id, aviso_id, phone, enviado_em, origem_ref, resposta_valor')
    .eq('lado', 'curioso').eq('status', 'ok').gte('enviado_em', desde).limit(1000);
  if (error) throw new Error(`envios do curioso: ${error.message}`);
  type Envio = { id: number; aviso_id: string; phone: string; enviado_em: string; origem_ref: string | null; resposta_valor: string | null };
  const abertos = ((envios || []) as Envio[]).filter(e => e.origem_ref && !e.resposta_valor);
  if (!abertos.length) return r;
  r.olhados = abertos.length;

  const [{ data: pautas, error: errPautas }, { data: falas, error: errFalas }] = await Promise.all([
    supabaseGerador.from('avisos').select('id, corpo').in('id', [...new Set(abertos.map(e => e.aviso_id))]),
    supabase.from('wa_mensagens').select('telefone, momment, texto')
      .eq('from_me', false).eq('is_group', false)
      .in('telefone', [...new Set(abertos.flatMap(e => variantes(e.phone)))])
      .gte('momment', abertos.reduce((min, e) => (e.enviado_em < min ? e.enviado_em : min), abertos[0].enviado_em))
      .order('momment', { ascending: true }).limit(5000),
  ]);
  if (errPautas) throw new Error(`pautas do curioso: ${errPautas.message}`);
  if (errFalas) throw new Error(`respostas do curioso: ${errFalas.message}`);
  const corpoDe = new Map(((pautas || []) as Array<{ id: string; corpo: string }>).map(p => [p.id, p.corpo]));
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
