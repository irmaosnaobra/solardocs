// ─────────────────────────────────────────────────────────────────────────────
// A RESPOSTA DO CURIOSO VIRA VALOR (21/09/2026)
//
// O Curioso é quem ainda não disse quanto investe. A pauta do grupo pergunta, e
// este arquivo lê a resposta: se ela disser R$ 50 mil ou mais (o piso,
// PISO_INVESTIDOR_MIL), o valor é gravado na linha da pessoa, e só isso já a leva
// pra Investidores, porque a aba e os pares classificam pelo valor gravado.
//
// A PROMOÇÃO É SILENCIOSA, ENTÃO O LEITOR SÓ DECIDE O ÓBVIO. Duas rodadas de
// revisão adversarial (21/09) derrubaram as versões anteriores, que liam frase por
// frase e barravam por exceção: "paguei 60 mil no carro", "quem me dera ter" /
// "100 mil" em dois balões, "Não me tira da lista", "30 pra 60 mil", "1 milhão 😂"
// passavam. O desenho que ficou:
//
//   1. A RESPOSTA É A CONVERSA, NÃO O BALÃO. Tudo o que a pessoa escreveu depois da
//      pergunta é juntado e lido de uma vez, e só depois de 10 minutos de silêncio
//      (o tick não pode pegar o primeiro balão antes do segundo).
//   2. FORMA FECHADA. Pra subir sozinha, a mensagem inteira, tirado o cumprimento,
//      tem que ser só a resposta: "tenho 80 mil", "uns 100 mil pra investir",
//      "R$ 60.000,00", "posso colocar 1 milhão". Pra sair, só o pedido: "não tenho
//      interesse", "me tira da lista". Qualquer coisa a mais vai pro consultor.
//   3. CONTEXTO LIMPO. Só vale enquanto a última coisa que a linha disse à pessoa
//      foi a nossa pergunta, e só se não havia conversa da linha com ela nas 24 h
//      antes. Limite conhecido: o que um consultor digita no celular fica gravado
//      sob outro identificador (o LID do WhatsApp) e esta leitura não enxerga; a
//      forma fechada é o que segura esse caso.
//
// SÓ SOBE, NUNCA DESCE: abaixo do piso não é gravado, acima de R$ 2 milhões fica
// com gente, e só grava em quem AINDA está no Curioso. Todo o resto aparece no
// "Responderam" da pauta, e o consultor registra na mão.
//
// Roda de 5 em 5 min, na carona do tick dos Avisos, e não manda mensagem nenhuma.
// É idempotente: o envio decidido ganha `resposta_valor` e não é relido.
// Kill-switch: CURIOSO_RESPOSTAS_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { curiosos, PISO_INVESTIDOR_MIL } from './eletropostoPares';

export type LeituraResposta = { tipo: 'valor'; mil: number } | { tipo: 'sair' } | null;

/** Acima disso é piada, loteria ou erro de digitação: fica com gente. */
const TETO_SANIDADE_MIL = 2000;

// ── A LEITURA DO TEXTO ──────────────────────────────────────────────────────

/** Emoji que não muda o sentido: só joinha, mãos juntas, visto e aperto de mão.
 *  Qualquer outro manda pro consultor: "tenho 1 milhão 😂" é piada, "100 mil 🤔" é
 *  dúvida, e sorriso e aplauso ao lado de "2 milhões" também costumam ser ironia. */
const EMOJI_NEUTRO = /[\u{1F44D}\u{1F64F}\u{2705}\u{1F91D}]/gu;

/** Cumprimento e agradecimento, que podem vir antes ou depois da resposta. */
const CORTESIA = '(?:oi+|ol[aá]|opa|bom dia|boa tarde|boa noite|tudo bem|td bem|tudo bom|td bom|'
  + 'sim|ok|blz|beleza|muito obrigad[oa]|obrigad[oa]|obg|grat[oa]|valeu|por favor|pfv|pensando bem|'
  + 'olha|desculp[ae]|agrade[cç]o)';
const RE_CORTESIA_INICIO = new RegExp('^(?:(?:tudo bem|td bem|tudo bom|td bom)[\\s,.!;:?]*|' + CORTESIA + '(?![a-zà-ú])[\\s,.!;:]*)');
const RE_CORTESIA_FIM = new RegExp('[\\s,.!;:]*' + CORTESIA + '(?: pela aten[cç][aã]o)?[\\s,.!]*$');

const EXTENSO: Record<string, number> = {
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, duzentos: 200,
  trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700,
  oitocentos: 800, novecentos: 900,
};

/** Minúsculas, emoji neutro fora, "50mil" separado, extenso em número e sem
 *  cumprimento nas pontas. Devolve null se sobrou emoji que muda o sentido. */
function nucleo(texto: unknown): string | null {
  let t = String(texto ?? '').toLowerCase().replace(EMOJI_NEUTRO, ' ');
  if (/\p{Extended_Pictographic}/u.test(t) || /[？]/.test(t)) return null;
  t = t
    .replace(/(\d)(mil|milh)/g, '$1 $2')
    .replace(/\bmeio milh[aã]o\b/g, '500 mil')
    .replace(/\bum milh[aã]o\b/g, '1 milhão')
    .replace(/\b(cinquenta|sessenta|setenta|oitenta|noventa|cem|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos) mil\b/g,
      (_, w: string) => `${EXTENSO[w]} mil`)
    .replace(/\s+/g, ' ').trim();
  // "tá?" no fim não é pergunta. ("né?" é: "1 milhão né?" pede confirmação.)
  t = t.replace(/[,\s]*(t[aá]|ok|blz)\s*\?+[\s.!]*$/, '');
  // Reticência é hesitação ("Olha, 50 mil..."): fica com o consultor.
  if (/(\.\.\.|…)\s*$/.test(t)) return null;
  for (let i = 0; i < 4; i++) {
    const antes = t;
    t = t.replace(RE_CORTESIA_INICIO, '').replace(RE_CORTESIA_FIM, '').trim();
    if (t === antes) break;
  }
  return t.replace(/[\s.!]+$/, '').trim();
}

/** O valor: "80 mil", "1,5 milhão", "R$ 60.000,00", "60.000 reais", "R$ 60 mil". */
const VALOR = '(?:r\\$ ?)?(?:(\\d{1,3}(?:[.,]\\d{1,2})?) (mil|milh[aã]o|milh[oõ]es)|(\\d{1,3}(?:\\.\\d{3})+)(?:,\\d{2})?)';
const RE_VALOR = new RegExp(
  '^(?:(?:eu|n[oó]s) )?'
  + '(?:(?:tenho|temos|posso|podemos|consigo|conseguimos|pretendo|penso|pensei|invisto|investiria|poderia|conseguiria)'
  + '(?: (?:investir|colocar|aplicar|botar|em investir))? '
  + '|(?:quero|queremos) (?:investir|colocar|aplicar|botar) )?'
  + '(?:(?:uns|umas|cerca de|em torno de|mais ou menos|aproximadamente|aprox\\.?|tipo|por volta de) )?'
  + VALOR
  + '(?: reais)?'
  + '(?: (?:pra|para) investir| dispon[ií]ve(?:l|is)| guardad[oa]s?| reservad[oa]s?| [aà] vista| no momento| hoje'
  + '| de capital(?: pr[oó]prio)?| em caixa| livres?| (?:pra|para) come[cç]ar| inicialmente)*$');

/** O pedido pra sair, de ponta a ponta. Antes dele só cumprimento (tirado em nucleo)
 *  ou "não," com vírgula ("não, não tenho interesse"). */
const NEG = '(?:n[aã]o|ñ|n)';
// "cancelar" e "remover" soltos NÃO entram: o Curioso da LP tem reunião marcada pela
// agenda, e "Cancelar" responde a ela. "grupo" também não: "me tira do grupo" é outro grupo.
const FORMAS_NEGATIVAS = `${NEG} tenho (?:mais )?(?:nenhum )?interesse(?: (?:mais|nenhum|n[aã]o))?`
  + '|sem interesse(?: nenhum)?'
  + `|${NEG} quero(?: mais)?(?: receber(?: mais)?(?: (?:mensage\\w*|isso|nada))?| mensage\\w*| n[aã]o| mais nada)?`
  + `|${NEG} (?:estou|to|tô) interessad[oa]`
  + `|${NEG} me interessa`;
const RE_SAIR = new RegExp('^(?:'
  + 'sair|parar|pare|stop|descadastrar'
  + '|(?:quero )?sair d[aeo] lista|quero sair'
  + '|(?:n[aã]o, ?)?(?:' + FORMAS_NEGATIVAS + ')'
  + '|(?:pode )?me (?:tir(?:a|e|em|ar)|remov(?:e|a|am|er)|exclu(?:i|a|am|ir))(?: (?:d[aeo]|dess[ae]|dest[ae]) (?:lista|cadastro)(?: de transmiss[aã]o)?| daqui)?'
  + '|(?:pode )?(?:tir(?:a|e|em|ar)|remov(?:e|a|am|er)|descadastr(?:e|a|ar)) (?:o )?meu (?:n[uú]mero|contato)(?: d[aeo] lista)?'
  + '|parem? de (?:me )?(?:mandar|enviar)(?: (?:mensage\\w*|isso))?'
  + `|${NEG} (?:me )?(?:mande|mandem|envie|enviem) mais(?: (?:mensage\\w*|nada|isso))?`
  + ')$');

/**
 * O que a resposta decide, ou null quando ela não decide nada com segurança.
 * Null não é erro: é a resposta que o consultor lê e resolve na mão.
 */
export function lerValorDaResposta(texto: unknown): LeituraResposta {
  const cru = String(texto ?? '').toLowerCase().replace(EMOJI_NEUTRO, ' ').replace(/\s+/g, ' ').trim();
  if (!cru || /voc[eê] recebe isso porque/.test(cru)) return null;   // o nosso rodapé colado de volta
  if (/^(n[aã]o|ñ),? (muito )?(obrigad[oa]|obg|valeu)[\s.!]*$/.test(cru)) return { tipo: 'sair' };
  const t = nucleo(texto);
  if (!t || t.includes('?')) return null;
  // "Obrigado, mas não tenho interesse" é pedido pra sair. Pro VALOR a ressalva fica:
  // "Obrigado, mas 50 mil..." não é declaração.
  const semMas = t.replace(/^((obrigad[oa]|agrade[cç]o|desculp[ae])[,.!]* )?mas /, '');
  if (RE_SAIR.test(t) || RE_SAIR.test(semMas)) return { tipo: 'sair' };
  const m = t.match(RE_VALOR);
  if (!m) return null;
  // Milhar em reais ("R$ 60.000,00", "60.000 reais") só vale com R$ ou "reais":
  // "60.000" sozinho pode ser BTU, CEP ou habitante.
  if (m[3] && !/r\$|reais/.test(t)) return null;
  const n = m[3] ? Number(m[3].replace(/\./g, '')) / 1000 : Number(m[1].replace(',', '.'));
  const mil = m[2] && /^milh/.test(m[2]) ? n * 1000 : n;
  if (!isFinite(mil) || mil < PISO_INVESTIDOR_MIL || mil > TETO_SANIDADE_MIL) return null;
  return { tipo: 'valor', mil };
}

/** O valor no formato das opções da LP, que o classificador lê de volta igual.
 *  Arredonda ANTES de escolher a palavra: 999,96 vira "R$ 1 milhão", não "R$ 1000 mil". */
export function valorNormalizado(mil: number): string {
  const arred = Math.round(mil * 10) / 10;
  const br = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (arred >= 1000) {
    const mi = Math.round(arred / 100) / 10;
    return `R$ ${br(mi)} ${mi >= 2 ? 'milhões' : 'milhão'}`;
  }
  return `R$ ${br(arred)} mil`;
}

const achatar = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

/** A fala é a nossa própria pergunta colada de volta (ou o eco do nosso envio)? */
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

// ── A DECISÃO POR PESSOA ────────────────────────────────────────────────────

export interface Fala { momment: string; texto: string | null; from_me: boolean | null; tipo?: string | null }
export type DecisaoPessoa =
  | { decide: LeituraResposta & object; texto: string }
  | { decide: null; motivo: 'sem_resposta' | 'esperando_silencio' | 'conversa_antes' | 'nao_e_texto' | 'consultor' ; texto?: string };

/** Só pauta que PERGUNTA O VALOR é lida: resposta a pauta de oportunidade não é valor. */
const PERGUNTA_VALOR = /quanto voc[eê].{0,40}investir/i;
const SILENCIO_MS = 10 * 60_000;
/** Pra tirar da lista, a espera é maior: "Não quero" + "perder essa oportunidade"
 *  pode chegar 15 minutos depois, e sem_interesse tira a pessoa de tudo. */
const SILENCIO_SAIR_MS = 3 * 3600_000;
const JANELA_RESPOSTA_MS = 72 * 3600_000;
const ANTES_MS = 24 * 3600_000;

/**
 * O que fazer com uma pessoa, olhando a linha do tempo dela. Pura: é a regra que
 * mexe na lista sem ninguém olhar, então tem que dar pra testar sem banco.
 *
 * `enviadoEm` é a pergunta mais recente que ela recebeu; `corpo`, o texto dela.
 */
export function decidirPessoa(falas: Fala[], enviadoEm: number, corpo: string, agora: number): DecisaoPessoa {
  const quando = (f: Fala) => Date.parse(f.momment);
  // O eco do NOSSO envio: a fala da linha que tem a pergunta do valor. Só a
  // saudação ("Aqui é da Irmãos na Obra") não basta, porque outra pauta abre igual.
  const eco = (f: Fala) => !!f.from_me && ehEcoDaPauta(f.texto, corpo) && PERGUNTA_VALOR.test(achatar(f.texto));
  // Conversa nas 24 h ANTES da pergunta, de qualquer lado: a resposta pode ser àquilo.
  // Conta também a fala da própria pessoa, porque o que o consultor digita no
  // celular fica sob o LID e aqui não aparece. (Os 2 min de folga são o nosso envio.)
  if (falas.some(f => !eco(f) && quando(f) >= enviadoEm - ANTES_MS && quando(f) < enviadoEm - 2 * 60_000)) {
    return { decide: null, motivo: 'conversa_antes' };
  }
  // Depois da pergunta, a primeira fala da linha que NÃO é a pergunta encerra a janela.
  const corte = falas
    .filter(f => f.from_me && !eco(f) && quando(f) > enviadoEm - 2 * 60_000)
    .reduce((min, f) => Math.min(min, quando(f)), enviadoEm + JANELA_RESPOSTA_MS);
  const dela = falas.filter(f => !f.from_me && quando(f) > enviadoEm && quando(f) <= corte);
  if (!dela.length) return { decide: null, motivo: 'sem_resposta' };
  const ultima = dela.reduce((max, f) => Math.max(max, quando(f)), 0);
  if (agora - ultima < SILENCIO_MS) return { decide: null, motivo: 'esperando_silencio' };
  // Áudio, foto, documento: não dá pra ler, e pode dizer o contrário do texto.
  if (dela.some(f => f.tipo && f.tipo !== 'texto')) return { decide: null, motivo: 'nao_e_texto' };
  const texto = dela.map(f => String(f.texto || '').trim()).filter(Boolean).join(' ');
  if (!texto) return { decide: null, motivo: 'sem_resposta' };
  // Ela colou um pedaço da nossa pergunta junto do que escreveu: quem lê é gente.
  if (dela.some(f => ehEcoDaPauta(f.texto, corpo))) return { decide: null, motivo: 'consultor', texto };
  const l = lerValorDaResposta(texto);
  if (!l) return { decide: null, motivo: 'consultor', texto };
  if (l.tipo === 'sair' && agora - ultima < SILENCIO_SAIR_MS) return { decide: null, motivo: 'esperando_silencio' };
  return { decide: l, texto };
}

// ── A VARREDURA ─────────────────────────────────────────────────────────────

/** A Z-API às vezes entrega o número sem o nono dígito, ou sem o 55: pergunta por todas. */
function variantes(phone: string): string[] {
  const d = String(phone || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) out.add(d.slice(0, 4) + '9' + d.slice(4));
  for (const v of [...out]) if (v.startsWith('55') && v.length >= 12) out.add(v.slice(2));
  return [...out];
}

/** Instância da linha IO em `wa_mensagens` (o mesmo fallback da sentinela e do placar). */
const INSTANCIA_IO = (): string =>
  (process.env.ZAPI_INSTANCE_ID_IO || '').trim() || '3F26F6ECE67D72BB7FCA6244BF24326C';

/** Resposta que chega depois disso é conversa nova, não resposta à pergunta. */
const JANELA_DIAS = 14;
const TABELA: Record<string, string> = { nota1: 'eletroposto_nota1', parceria: 'eletroposto_parceria' };

export interface ResultadoLeitura { olhados: number; subiram: number; sairam: number }

export async function lerRespostasCurioso(): Promise<ResultadoLeitura> {
  const r: ResultadoLeitura = { olhados: 0, subiram: 0, sairam: 0 };
  if ((process.env.CURIOSO_RESPOSTAS_OFF || '').trim() === '1') return r;

  // A leitura segue a PAUTA que pergunta o valor (tem o grupo Curioso e o texto
  // pergunta), não o grupo de cada envio: numa pauta com Investidores E Curioso, os
  // curiosos que também são cadastro saem carimbados 'capital'.
  const { data: pautas, error: errPautas } = await supabaseGerador.from('avisos')
    .select('id, corpo').contains('publicos', ['curioso']);
  if (errPautas) throw new Error(`pautas do curioso: ${errPautas.message}`);
  const corpoDe = new Map(((pautas || []) as Array<{ id: string; corpo: string }>)
    .filter(p => PERGUNTA_VALOR.test(String(p.corpo || ''))).map(p => [p.id, p.corpo]));
  if (!corpoDe.size) return r;

  const desde = new Date(Date.now() - JANELA_DIAS * 86400_000).toISOString();
  const { data: envios, error } = await supabaseGerador.from('aviso_envios')
    .select('id, aviso_id, phone, enviado_em, origem_ref, resposta_valor')
    .in('aviso_id', [...corpoDe.keys()]).eq('status', 'ok').is('resposta_valor', null)
    .gte('enviado_em', desde).order('enviado_em', { ascending: true }).limit(1000);
  if (error) throw new Error(`envios do curioso: ${error.message}`);
  type Envio = { id: number; aviso_id: string; phone: string; enviado_em: string; origem_ref: string | null; resposta_valor: string | null };
  const abertos = ((envios || []) as Envio[]).filter(e => e.origem_ref && !e.resposta_valor);
  if (!abertos.length) return r;

  // Uma decisão por PESSOA, ancorada na pergunta mais recente que ela recebeu.
  const porPessoa = new Map<string, Envio[]>();
  for (const e of abertos) {
    const k = chaveContato(e.phone) || e.phone;
    if (!porPessoa.has(k)) porPessoa.set(k, []);
    porPessoa.get(k)!.push(e);
  }
  r.olhados = porPessoa.size;

  // As falas dos dois lados, desde 24 h antes da pergunta mais antiga. Paginado até
  // acabar: consulta truncada leria só o começo e decidiria pelo balão errado. Se
  // bater no teto, não decide nada nesta passada (fail-closed).
  const inicio = new Date(Date.parse(abertos[0].enviado_em) - ANTES_MS).toISOString();
  const fones = [...new Set(abertos.flatMap(e => variantes(e.phone)))];
  const PAGINA = 1000, TETO = 20000;
  const falas: Array<Fala & { telefone: string }> = [];
  for (let de = 0; ; ) {
    const { data, error: errFalas } = await supabase.from('wa_mensagens')
      .select('telefone, momment, texto, from_me, tipo')
      .eq('instancia', INSTANCIA_IO()).eq('is_group', false)
      .in('telefone', fones).gte('momment', inicio)
      .order('momment', { ascending: true }).range(de, de + PAGINA - 1);
    if (errFalas) throw new Error(`respostas do curioso: ${errFalas.message}`);
    const lote = (data || []) as Array<Fala & { telefone: string }>;
    falas.push(...lote);
    de += lote.length;
    if (lote.length < PAGINA) break;
    if (de >= TETO) { logger.warn('curioso', `teto de ${TETO} falas: nada decidido nesta passada`); return r; }
  }
  const falasDe = new Map<string, Fala[]>();
  for (const f of falas) {
    const k = chaveContato(f.telefone) || f.telefone;
    if (!falasDe.has(k)) falasDe.set(k, []);
    falasDe.get(k)!.push(f);
  }

  const agora = Date.now();
  let atuais: Map<string, string> | null = null;   // chave do telefone -> ref de quem AINDA é curioso
  for (const [k, dele] of porPessoa) {
    const ancora = dele[dele.length - 1];              // a pergunta mais recente
    const d = decidirPessoa(falasDe.get(k) || [], Date.parse(ancora.enviado_em), String(corpoDe.get(ancora.aviso_id) || ''), agora);
    if (!d.decide) continue;

    if (!atuais) {
      atuais = new Map();
      for (const c of await curiosos()) { const kk = chaveContato(c.telefone); if (kk) atuais.set(kk, c.ref); }
    }
    const refAtual = atuais.get(k) || null;
    let marca: string;
    if (d.decide.tipo === 'valor') {
      const valor = valorNormalizado(d.decide.mil);
      if (refAtual) {
        // Grava na linha ATUAL da pessoa: a que venceu no agrupamento de hoje.
        const [origem, idTxt] = refAtual.split(':');
        const tabela = TABELA[origem];
        if (!tabela) continue;
        const campo = origem === 'nota1' ? 'valor_investir' : 'capital_faixa';
        const { error: errGrava } = await supabaseGerador.from(tabela).update({ [campo]: valor }).eq('id', Number(idTxt));
        // Sem gravar, o envio NÃO é marcado: o próximo tick tenta de novo.
        if (errGrava) { logger.error('curioso', `não gravei o valor de ${refAtual}`, errGrava); continue; }
        r.subiram++;
        marca = valor;
        logger.info('curioso', `${refAtual} respondeu ${valor} e foi pra Investidores`);
      } else {
        marca = `lido sem mudança: ${valor}`;   // já tinha saído do Curioso
      }
    } else if (refAtual) {
      // Só tira da lista quem AINDA é curioso: quem já virou investidor pode estar
      // respondendo a um consultor (pelo celular, sob o LID, que aqui não aparece).
      const [origem, idTxt] = refAtual.split(':');
      const tabela = TABELA[origem];
      if (!tabela) continue;
      const { error: errSai } = await supabaseGerador.from(tabela).update({ status: 'sem_interesse' }).eq('id', Number(idTxt));
      if (errSai) { logger.error('curioso', `não marquei ${refAtual} como sem interesse`, errSai); continue; }
      r.sairam++;
      marca = 'sem interesse';
    } else {
      marca = 'lido sem mudança: pediu pra sair';
    }
    const { error: errMarca } = await supabaseGerador.from('aviso_envios').update({
      resposta_valor: marca, resposta_texto: d.texto.slice(0, 500), resposta_lida_em: new Date(agora).toISOString(),
    }).in('id', dele.map(e => e.id));
    if (errMarca) logger.error('curioso', `não marquei os envios de ${k} como lidos`, errMarca);
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
