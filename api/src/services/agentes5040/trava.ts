// ─────────────────────────────────────────────────────────────────────────────
// TRAVA DE ESCRITA DAS AGENTES 5040. PURA: sem banco, sem rede, sem IA.
//
// REJEITA, NUNCA CORRIGE. Se a saída do modelo quebra uma regra, `validarFala`
// devolve os motivos; quem chama (ia.ts) pede UMA reescrita e, se quebrar de novo,
// a agente não fala. A regra que precisa valer 100% das vezes é código, não pedido.
//
// Cuidado de projeto: esta trava NÃO é a violaRegras da Helena antiga. Aquela
// barrava "garantia", "60 kW", "90 dias" e todo link, coisas que aqui são fatos
// permitidos (25 anos de garantia de geração, 2 anos de garantia do equipamento,
// carência de 90 dias, 60 kW por R$ 135 mil depois da qualificação). Falso positivo
// aqui cala a agente em silêncio, então só os PARSERS de valor foram copiados
// (investidorAgentePuro.ts ~1533-1590: NUM, lerNumero, multiplicador, valoresEmReais).
//
// Nada aqui passa pelo `bolhas.ts`: ele tira travessão e junta bolha, que é corrigir.
// ─────────────────────────────────────────────────────────────────────────────

import type { EstadoConversa, MsgConversa, Persona, SaidaAgente } from './tipos';
import { VALORES_PERMITIDOS_CARLA } from './conhecimento/solardoc';
import { PERCENTUAIS_PUBLICOS_ELETROPOSTO, REAIS_PUBLICOS_ELETROPOSTO } from './conhecimento/eletroposto';
import { MAX_DEPOIMENTOS_POR_CONVERSA } from './conhecimento/depoimentos';
import { horarioComercial, type Instante } from './relogio';
import { AVISO_IA_NA_PRIMEIRA_MSG, motivoSemAviso, temAvisoDeIA } from './avisoIA';

// ── parâmetros ───────────────────────────────────────────────────────────────

export interface ParametrosTrava {
  persona: Persona;
  /** A conversa foi lida inteira? false = a agente não fala. */
  completa: boolean;
  /** Helena: imóvel, padrão e vagas já foram respondidos? Desconhecido = false (valor fica bloqueado). */
  qualificado?: boolean;
  /** Valores em reais que o próprio lead escreveu (Helena pode repeti-los). */
  valoresDaPessoa?: readonly number[];
  /** Ações em que bolhas vazias são válidas (a agente passa a vez calada). Padrão: nenhuma. */
  acoesSemFala?: readonly string[];
  /** Instante de referência (Brasília é calculada daqui). Sem ele, "ligar agora" não passa. */
  agora?: Instante;
  /**
   * 'abertura': deixa passar a PRIMEIRA fala da agente quando ela ainda não falou nada na conversa
   * (abertura depois do cadastro). Sem isto valem "o lead ainda não escreveu" e "duas falas seguidas".
   * 'retomada' (B4b, a Base): deixa passar a fala que vem depois de uma fala NOSSA sem o lead escrever, desde que o lead
   * já tenha escrito alguma vez ("o lead ainda não escreveu" continua valendo). Só a retomada fria liga isto.
   */
  permiteIniciativa?: 'abertura' | 'retomada';
  /** Prazos que o lead disse (textos dele, ex.: "dois meses"): a Duda pode repetir o eco. */
  prazosDaPessoa?: readonly string[];
  /** Depoimentos já mandados segundo quem chama (vale o maior entre isto e o que a conversa mostra). */
  depoimentosJaEnviados?: number;
  /**
   * A agente ainda não se apresentou a este lead (lead_data.apresentada falsa): a bolha 1 tem que trazer o aviso de IA
   * ("Aqui é a Duda, do atendimento com IA da Irmãos na Obra."). Sem bolha (calar) não há o que conferir.
   */
  exigeAviso?: boolean;
}

export const MOTIVO_HISTORICO_INCOMPLETO = 'histórico incompleto: a agente não fala';
export const MOTIVO_SEM_CONTEXTO = 'a agente não sabe o contexto (sabe_contexto=false): não fala';

/** Motivos que NÃO ganham reescrita: reescrever não conserta falta de contexto. */
export function permiteReescrita(motivos: readonly string[]): boolean {
  return !motivos.some(m => m === MOTIVO_HISTORICO_INCOMPLETO || m === MOTIVO_SEM_CONTEXTO);
}

// ── parsers de valor (cópia de investidorAgentePuro.ts) ──────────────────────

export const semAcento = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;

/** "140.000" e "1.500,50" são milhar com ponto; "1,5" e "1.5" são decimal. */
function lerNumero(txt: string): number {
  const milhar = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(txt);
  const limpo = milhar ? txt.replace(/\./g, '').replace(',', '.') : txt.replace(',', '.');
  return Number(limpo);
}

function multiplicador(sufixo: string | undefined): number {
  if (!sufixo) return 1;
  if (sufixo === 'mil' || sufixo === 'k') return 1_000;
  if (/^milh/.test(sufixo)) return 1_000_000;
  return 1;
}

/**
 * Os valores em reais citados num texto SEM ACENTO e em minúsculo, já em reais
 * (140 mil = R$ 140 mil = 140000). `soComMoeda`: só `R$ n` ou `n` + mil/reais/milhão
 * (leitura estreita da fala da agente); sem ela, "140k" e "300000" também contam.
 */
export function valoresEmReais(textoSemAcento: string, soComMoeda: boolean): number[] {
  const t = textoSemAcento;
  const achados: number[] = [];
  const comCifrao = new RegExp(String.raw`r\$\s*(` + NUM + String.raw`)(?:\s*(mil|k|milhoes|milhao)\b)?`, 'g');
  for (const m of t.matchAll(comCifrao)) achados.push(lerNumero(m[1]!) * multiplicador(m[2]));
  const comPalavra = new RegExp(String.raw`(?<![\d.,])(` + NUM + String.raw`)\s*(mil\s+reais|reais|milhoes|milhao)\b`, 'g');
  for (const m of t.matchAll(comPalavra)) {
    const suf = m[2]!.startsWith('mil ') ? 'mil' : m[2];
    achados.push(lerNumero(m[1]!) * multiplicador(suf));
  }
  const sufixoMil = soComMoeda ? 'mil' : 'mil|k';
  const mil = new RegExp(String.raw`(?<![\d.,])(` + NUM + String.raw`)\s*(` + sufixoMil + String.raw`)\b`, 'g');
  for (const m of t.matchAll(mil)) achados.push(lerNumero(m[1]!) * 1_000);
  if (!soComMoeda) {
    for (const m of t.matchAll(/(?<![\d.,])(\d{6,})(?![\d.,])/g)) achados.push(Number(m[1]));
  }
  return [...new Set(achados.filter(n => Number.isFinite(n) && n > 0))];
}

// ── retrato da conversa ──────────────────────────────────────────────────────

const ehImagem = (m: Pick<MsgConversa, 'tipo'>): boolean => m.tipo === 'image' || m.tipo === 'imagem';
const contaComoFala = (m: Pick<MsgConversa, 'tipo'>): boolean => m.tipo !== 'reacao' && m.tipo !== 'notificacao';

export function estadoDaConversa(conv: readonly MsgConversa[]): EstadoConversa {
  const msgs = conv.filter(contaComoFala);
  let falasDoLead = 0;
  let falasNossas = 0;
  let imagensNossas = 0;
  let ultimaImagem = -1;
  let jaMandamosLink = false;
  let depoimentosNossos = 0;
  msgs.forEach((m, i) => {
    if (m.autor === 'lead') { falasDoLead++; return; }
    falasNossas++;
    if (ehImagem(m)) { imagensNossas++; ultimaImagem = i; }
    if (/https?:\/\//i.test(String(m.texto ?? ''))) jaMandamosLink = true;
    if (ehImagem(m) && /\/depoimentos\//i.test(String(m.media_url ?? ''))) depoimentosNossos++;
  });
  const ultima = msgs[msgs.length - 1];
  const leadFalouDepoisDaImagem = ultimaImagem < 0 || msgs.slice(ultimaImagem + 1).some(m => m.autor === 'lead');
  return {
    falasDoLead, falasNossas,
    ultimaFoiDoLead: !!ultima && ultima.autor === 'lead',
    imagensNossas, leadFalouDepoisDaImagem, jaMandamosLink, depoimentosNossos,
  };
}

// ── regras gerais ────────────────────────────────────────────────────────────

const TETO_BOLHA = 160;
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|️|⃣/u;

/** Domínios que a agente pode mandar no link da segunda bolha (host exato, só https). */
export const DOMINIOS_LINK_PERMITIDOS: readonly string[] = ['solardoc.app'];

/** O link da segunda bolha: https, sozinho, host na lista e sem usuário, senha ou porta. */
export function linkPermitido(s: string): boolean {
  if (!/^https:\/\/\S+$/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && DOMINIOS_LINK_PERMITIDOS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** O link por extenso (com %XX desfeito) e sem acento, para as regras de cupom e de preço olharem dentro dele. */
function textoDoLink(s: SaidaAgente): string {
  if (s.peca?.tipo !== 'link' || s.bolhas.length < 2) return '';
  const bruto = String(s.bolhas[1] ?? '');
  let dec = bruto;
  try { dec = decodeURIComponent(bruto); } catch { /* fica o bruto */ }
  return semAcento(dec);
}

const LIGAR_AGORA = /\b(?:ligar|liga|ligo|ligamos|ligue|chamar|chamo)\b[^.!?]{0,30}\bagora\b|\bagora\b[^.!?]{0,30}\b(?:ligar|liga|ligo|ligamos|chamar|chamo)\b|\bligacao\s+agora\b|\b(?:te|lhe)\s+lig\w+\s+(?:ja|em instantes|daqui a pouco)\b/;

function regrasGerais(s: SaidaAgente, est: EstadoConversa, p: ParametrosTrava): string[] {
  const m: string[] = [];
  const b = s.bolhas.map(x => String(x ?? ''));

  if (b.length === 0) {
    if (!(p.acoesSemFala ?? []).includes(s.acao)) m.push('sem bolhas');
    return m;
  }
  if (b.length > 2) m.push(`${b.length} bolhas (o máximo é 2)`);
  const primeira = b[0]!.trim();
  if (!primeira) m.push('a primeira bolha está vazia');
  if (primeira.length > TETO_BOLHA) m.push(`a bolha passa de ${TETO_BOLHA} caracteres (${primeira.length})`);

  // Bolha 1: sem endereço de site nem link.
  if (/https?:\/\/|www\./i.test(primeira) || /\b[a-z0-9][a-z0-9-]*\.(?:com|app|br|net|me|io|org)\b/i.test(semAcento(primeira))) {
    m.push('endereço de site ou link na primeira bolha');
  }

  // Bolha 2: só link https de domínio permitido, sozinho, ou Pix, e combinando com a peça declarada.
  const segunda = b.length > 1 ? b[1]!.trim() : null;
  const tipoPeca = s.peca?.tipo ?? null;
  if (segunda !== null) {
    if (tipoPeca === 'link') {
      if (!linkPermitido(segunda)) m.push(`a segunda bolha tem que ser só um link https de ${DOMINIOS_LINK_PERMITIDOS.join(', ')}`);
    } else if (tipoPeca === 'pix') {
      if (!segunda || /\s/.test(segunda) || /^https?:/i.test(segunda) || segunda.length > 800) {
        m.push('a segunda bolha do Pix tem que ser só o código ou a chave');
      }
    } else {
      m.push('a segunda bolha só existe para link ou Pix declarado em peca');
    }
  } else if (tipoPeca === 'link' || tipoPeca === 'pix') {
    m.push(`peca ${tipoPeca} sem a segunda bolha`);
  }
  if (tipoPeca === 'imagem' && b.length > 1) m.push('imagem não leva segunda bolha');
  // Uma peça só por resposta: nenhuma URL fora da bolha 2 (já barrado acima) e só uma dentro dela.
  if (segunda !== null && (segunda.match(/https?:\/\//gi) ?? []).length > 1) m.push('mais de um link');

  // As regras de TEXTO valem para a bolha 1 (e para a 2 só quando ela não é link nem Pix, caso já barrado
  // acima). O link e o código do Pix são validados pela forma: "?utm_", "menu" ou "videos" dentro de uma
  // URL não pode virar "mais de uma pergunta" ou "palavra proibida". Cupom e preço olham o link à parte.
  const tudo = (tipoPeca === 'link' || tipoPeca === 'pix' ? [b[0]!] : b).join('\n');
  const t = semAcento(tudo);

  // A regra da casa é não começar com minúscula; dígito ("2 horários: ...") passa.
  if (/^\p{Ll}/u.test(primeira)) m.push('a bolha começa com letra minúscula');
  if (/[—–]/.test(tudo)) m.push('travessão (U+2014 ou U+2013)');
  if (EMOJI.test(tudo)) m.push('emoji');
  if (/^\s*\d+\s*[.)\-:]\s+\S/m.test(tudo) || /(?:^|\s)1\s*[.)]\s.*\s2\s*[.)]\s/s.test(tudo)) m.push('lista numerada');
  if (/^\s*[-*•]\s+\S/m.test(tudo)) m.push('lista com marcador');
  if (/\bmenu\b/.test(t) || /\bdigite\s+(?:o\s+)?(?:numero\s+)?\d/.test(t)
      || /\b(?:responda|mande|envie)\s+(?:com\s+)?(?:o\s+)?(?:numero\s+)?\d\b/.test(t)
      || /\bop[cç][aã]o\s*\d\b/.test(tudo.toLowerCase()) || /\bopcao\s*\d\b/.test(t)) {
    m.push('menu ou "digite 1"');
  }
  const proibida = /\b(videos?|videochamadas?|video\s*chamadas?|assistente virtual)\b/.exec(t);
  if (proibida) m.push(`palavra proibida ("${proibida[0]}")`);
  if (/\bnao sou (?:uma |um )?(?:ia|robo|bot|inteligencia artificial)\b/.test(t) || /\bsou (?:uma )?(?:pessoa|humana|humano)\b/.test(t)) {
    m.push('negou ser IA');
  }
  if ((tudo.match(/\?/g) ?? []).length > 1) m.push('mais de uma pergunta');

  // Cupom dentro do link (ex.: ?coupon=ACESSO19) reprova para qualquer persona.
  if (/\bcupom\b|\bcupons\b|\bcoupon\b|\bacesso19\b/.test(textoDoLink(s))) m.push('cupom dentro do link');

  // Ligar agora: só em horário comercial de Brasília (8h às 18h, segunda a sexta, fora de feriado).
  if (s.acao === 'ligar_agora' || LIGAR_AGORA.test(t)) {
    if (p.agora === undefined) m.push('ligação agora sem horário de referência para conferir o horário comercial');
    else if (!horarioComercial(p.agora)) m.push('ligação agora fora do horário comercial (8h às 18h, segunda a sexta, Brasília)');
  }

  // Imagem.
  if (tipoPeca === 'imagem') {
    if (est.falasNossas === 0) m.push('imagem na primeira mensagem');
    if (est.jaMandamosLink) m.push('imagem depois do link');
    if (est.imagensNossas >= 3) m.push('já foram 3 imagens nesta conversa');
    if (!est.leadFalouDepoisDaImagem) m.push('o lead não falou desde a última imagem');
    if (String(s.peca?.id ?? '').startsWith('depoimento:')
        && Math.max(est.depoimentosNossos, p.depoimentosJaEnviados ?? 0) >= MAX_DEPOIMENTOS_POR_CONVERSA) {
      m.push(`já foram ${MAX_DEPOIMENTOS_POR_CONVERSA} depoimentos nesta conversa`);
    }
  }

  // Duas falas seguidas: a última mensagem da conversa tem que ser do lead.
  // Exceção: iniciativa de ABERTURA (depois do cadastro) quando a agente ainda não falou nada.
  const abertura = p.permiteIniciativa === 'abertura' && est.falasNossas === 0;
  const retomada = p.permiteIniciativa === 'retomada';
  if (!abertura) {
    if (est.falasDoLead === 0) m.push('o lead ainda não escreveu');
    else if (!est.ultimaFoiDoLead && !retomada) m.push('duas falas seguidas sem o lead escrever');
  }

  return m;
}

// ── regras por persona ───────────────────────────────────────────────────────

/** Frases (com o delimitador), para regras que olham uma frase por vez. */
const frases = (t: string): string[] => t.split(/(?<=[.!?])/).map(x => x.trim()).filter(Boolean);

/** Valor liberado: bate com algum da lista até meio centavo (R$ 67,40 NÃO é o 67). */
const batePreciso = (v: number, lista: readonly number[]): boolean => lista.some(x => Math.abs(x - v) < 0.005);
/** Valor liberado em reais inteiros (Helena: 135,5 mil = 135500). */
const bateInteiro = (v: number, lista: readonly number[]): boolean => lista.some(x => Math.round(x) === Math.round(v));

const FALA_NUM = String.raw`(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa|alguns|algumas|poucos|poucas|varios|varias|uns|umas)`;
const TEMPO = new RegExp(String.raw`\b${FALA_NUM}\s+(?:dias?|semanas?|mes(?:es)?)\b`);

/**
 * Promessa do NOSSO prazo: a gente instala, monta, entrega, a obra leva, fica pronto, está funcionando.
 * "montar"/"instalar" no infinitivo é intenção do lead ("e montar em até dois meses") e NÃO entra aqui.
 */
const NOSSO_PRAZO = new RegExp(String.raw`\b(?:instala|instalamos|instalo|instalaremos|monta|montamos|montaremos|entrega|entregamos|entregaremos|`
  + String.raw`(?:instalacao|montagem|obra|entrega)\s+(?:fica|ficam|leva|levam|demora|demoram|sai|saem|dura|e feita|e em)|`
  + String.raw`(?:fica|ficam|ficara|ficarao)\s+pront\w+|(?:esta|estao|estara|estarao)\s+funcionando|funcionando)\b`);
/** leva/demora só contam como prazo nosso quando a frase fala do serviço. */
const LEVA_DEMORA = /\b(?:leva|levamos|levam|demora|demoramos|demoram)\b/;
const DO_SERVICO = /\b(?:instal\w*|obra|montagem|sistema|projeto|pront\w+|funcion\w+|entrega\w*)\b/;

const NUMEROS_POR_EXTENSO: Record<string, string> = {
  um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7',
  oito: '8', nove: '9', dez: '10', onze: '11', doze: '12', quinze: '15', vinte: '20', trinta: '30',
  quarenta: '40', cinquenta: '50', sessenta: '60', noventa: '90',
};
/** "dois meses" e "2 meses" são o mesmo prazo: número em dígitos e unidade no singular. */
function prazoCanonico(trecho: string): string {
  const [n, u] = trecho.trim().split(/\s+/);
  const unidade = (u ?? '').replace(/^(dia|semana|mes)(?:es|s)?$/, '$1');
  return `${NUMEROS_POR_EXTENSO[n ?? ''] ?? n} ${unidade}`;
}
/** Os prazos (canônicos) que aparecem nos textos que o lead disse. */
function prazosEm(textos: readonly string[]): Set<string> {
  const re = new RegExp(TEMPO.source, 'g');
  const out = new Set<string>();
  for (const x of textos) for (const k of semAcento(x).matchAll(re)) out.add(prazoCanonico(k[0]));
  return out;
}

/** Tira de dentro do texto o que é energia (1000 kWh, 5 kWp), para "mil" e "k" não virarem dinheiro. */
const semEnergia = (t: string): string =>
  t.replace(/(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s*(?:mil\s*)?(?:kwh|kwp|kw|wp|wh|w)\b/g, ' ');

function regrasDuda(t: string, link: string, p: ParametrosTrava): string[] {
  const m: string[] = [];
  const liberados = p.valoresDaPessoa ?? [];
  if (/\bprecos?\b/.test(t + ' ' + link)) m.push('Duda falou de preço');
  // "R$" e "reais" sem número passam ("em reais ou kWh?"). Valor em reais só se o lead (ou a conta lida) disse.
  const fora = valoresEmReais(semEnergia(t), false).find(v => !batePreciso(v, liberados));
  if (fora !== undefined) m.push(`Duda citou valor em reais que o lead não disse (R$ ${fora.toLocaleString('pt-BR')})`);
  if (/\bparcel\w*|\bjuros\b|\b\d{1,3}\s*x\b|\b\d+\s*vezes\b/.test(t)) m.push('Duda falou de parcela');
  if (/%|\bpor cento\b/.test(t)) m.push('Duda citou percentual');
  for (const fr of frases(t)) {
    if (/\beconom\w*\b/.test(fr) && /\d/.test(fr)) { m.push('Duda citou economia com número'); break; }
    if (/\b(?:metade|dobro|triplo|zer(?:a|ar|o|am))\b/.test(fr) && /\b(?:conta|econom\w*|luz|fatura|gasto)\b/.test(fr)) {
      m.push('Duda prometeu efeito na conta (metade, dobro, zera)'); break;
    }
  }
  // Só barra promessa do NOSSO prazo. Eco do que o lead disse (prazosDaPessoa) e pedido ao lead
  // ("me diz um mês aproximado", "montar em até dois meses") passam.
  const doLead = prazosEm(p.prazosDaPessoa ?? []);
  for (const fr of frases(t)) {
    const tempo = TEMPO.exec(fr);
    if (!tempo) continue;
    const promete = NOSSO_PRAZO.test(fr) || (LEVA_DEMORA.test(fr) && DO_SERVICO.test(fr));
    if (!promete) continue;
    if (doLead.has(prazoCanonico(tempo[0]))) continue;
    m.push(`Duda prometeu prazo de instalação ("${tempo[0]}")`);
    break;
  }
  return m;
}

const PALAVRA_DE_RENDIMENTO = /\b(?:retornos?|rendimentos?|rende|rendem|rendendo|rendeu|rendas?|payback|rentabilidade|rentav\w*|lucros?|lucrativ\w*)\b/;
const PROMESSA = /\b(?:bom|boa|bons|boas|alto|alta|altos|altas|otimo|otima|otimos|excelente|excelentes|rapido|rapida|rapidos|rapidas|curto|curta|garant\w*|certeza|compensa\w*|vai (?:render|dar|pagar)|sem risco)\b/;

/** Tira horários e datas ("10h", "10:30", "13/10", "dia 13", "às 10", "30 minutos") antes de procurar número. */
const semHorarioEData = (t: string): string => t
  .replace(/\b\d{1,2}\s*h(?:\s*\d{2})?\b/g, ' ')
  .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
  .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
  .replace(/\b(?:as|dia)\s+\d{1,2}\b/g, ' ')
  .replace(/\b\d+\s*(?:minutos?|min)\b/g, ' ')
  .replace(/\bbom dia\b|\bboa tarde\b|\bboa noite\b/g, ' ');

function regrasHelena(t: string, p: ParametrosTrava): string[] {
  const m: string[] = [];
  if (/\bse pagam?\b/.test(t)) m.push('Helena falou que o ponto "se paga"');
  // A palavra sozinha passa ("quanto rende, eu não chuto"); junto de número, %, valor ou promessa, não.
  for (const fr of frases(t)) {
    const palavra = PALAVRA_DE_RENDIMENTO.exec(fr);
    if (!palavra) continue;
    const limpa = semHorarioEData(fr);
    if (/\d/.test(limpa) || /%|\bpor cento\b/.test(limpa) || /r\$|\breais\b|\bmil\b|\bmilh/.test(limpa) || PROMESSA.test(limpa)) {
      m.push(`Helena falou de rendimento com número, valor ou promessa ("${palavra[0]}")`);
      break;
    }
  }
  // Porcentagem: só as que existem no conhecimento (100% e 50% dos modelos 01 e 02).
  for (const x of t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    const n = Number(x[1]!.replace(',', '.'));
    if (!PERCENTUAIS_PUBLICOS_ELETROPOSTO.includes(n)) { m.push(`Helena citou percentual (${x[1]}%)`); break; }
  }
  if (/\bpor cento\b/.test(t)) m.push('Helena citou percentual por extenso');
  for (const frase of t.split(/[.!?]+/)) {
    if (/\bganh\w*/.test(frase) && (/\d/.test(frase) || /\bpor mes\b/.test(frase))) { m.push('Helena falou em ganho com número'); break; }
  }
  const liberados = [...REAIS_PUBLICOS_ELETROPOSTO, ...(p.valoresDaPessoa ?? [])];
  const citados = valoresEmReais(t, true);
  const fora = citados.find(v => !bateInteiro(v, liberados));
  if (fora !== undefined) m.push(`Helena citou valor que não é o público (R$ ${fora.toLocaleString('pt-BR')})`);
  else if (citados.length && !p.qualificado) m.push('Helena citou valor antes da qualificação (imóvel, padrão e vagas)');
  return m;
}

const DATA_NA_FRASE = /\b\d{1,2}\s*\/\s*\d{1,2}\b|\bdia\s+\d{1,2}\b|\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|\b(?:amanha|semana que vem|proxim[oa]\s+(?:semana|mes|segunda|terca|quarta|quinta|sexta)|ate o fim d[oe]|fim do mes|em\s+\d+\s+(?:dias?|semanas?|mes(?:es)?))\b/;

function regrasCarla(t: string, link: string): string[] {
  const m: string[] = [];
  // SÓ os valores do catálogo (67, 27, 97). Valor derivado ("R$ 2,23 por dia") e centavos (67,40) não passam.
  const fora = valoresEmReais(t + ' ' + link, true).find(v => !batePreciso(v, VALORES_PERMITIDOS_CARLA));
  if (fora !== undefined) m.push(`Carla citou valor fora da tabela (R$ ${fora.toLocaleString('pt-BR')})`);
  if (/\bcupom\b|\bcupons\b|\bcoupon\b|\bacesso19\b/.test(t + ' ' + link)) m.push('Carla falou de cupom');
  if (/\banual\b|\banuais\b|\bplano anual\b/.test(t + ' ' + link)) m.push('Carla falou de plano anual');
  if (/\bdevolv(?:i|emos|eu)\b|\bestorn\w+|\breembolsei\b|\breembolsamos\b/.test(t)) m.push('Carla disse que devolveu o dinheiro (reembolso é da Giovanna)');
  for (const frase of t.split(/[.!?]+/)) {
    if (/\bplanilha\b/.test(frase) && DATA_NA_FRASE.test(frase)) { m.push('Carla deu data para a planilha de eletroposto'); break; }
  }
  return m;
}

// ── a validação ──────────────────────────────────────────────────────────────

/**
 * Devolve os motivos pelos quais a fala NÃO pode sair. Lista vazia = pode.
 * `conv` é a conversa lida (mais antiga primeiro), SEM a fala nova.
 */
export function validarFala(s: SaidaAgente, conv: readonly MsgConversa[], p: ParametrosTrava): string[] {
  if (p.completa !== true) return [MOTIVO_HISTORICO_INCOMPLETO];
  if (s.sabe_contexto === false) return [MOTIVO_SEM_CONTEXTO];
  const est = estadoDaConversa(conv);
  const motivos = regrasGerais(s, est, p);
  if (AVISO_IA_NA_PRIMEIRA_MSG && p.exigeAviso === true && s.bolhas.length > 0 && !temAvisoDeIA(s.bolhas[0], p.persona)) motivos.push(motivoSemAviso(p.persona));
  // O texto da persona é a bolha 1 (o link e o código do Pix não são fala). O link entra à parte, para cupom e preço.
  const t = semAcento((s.peca?.tipo === 'link' || s.peca?.tipo === 'pix' ? s.bolhas.slice(0, 1) : s.bolhas).join('\n'));
  const link = textoDoLink(s);
  if (p.persona === 'duda') motivos.push(...regrasDuda(t, link, p));
  else if (p.persona === 'helena') motivos.push(...regrasHelena(t, p));
  else if (p.persona === 'carla') motivos.push(...regrasCarla(t, link));
  return motivos;
}

/** O recado que volta ao modelo quando a fala foi barrada: UMA segunda chance. */
export function pedidoDeReescrita(pedido: string, motivos: readonly string[], s: Pick<SaidaAgente, 'bolhas'>): string {
  return [
    pedido,
    '',
    'ATENÇÃO: a resposta que você escreveu foi barrada e NÃO foi enviada. Motivos: ' + motivos.join('; ') + '.',
    'O que você tinha escrito: ' + s.bolhas.join(' / '),
    'Reescreva do zero, sem quebrar nenhuma regra: 1 bolha de até 160 caracteres, sem começar com letra minúscula, sem traço longo, sem emoji, sem lista, uma pergunta só, e só números e fatos que estão no seu conhecimento.',
  ].join('\n');
}
