// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS DOS AVISOS DO QUIZ SOLAR (redator, 24/10/2026). Arquivo PURO: monta texto, não lê banco e não envia.
//
// Regras de escrita da casa: toda linha começa com maiúscula, sem travessão, emoji só na 1ª linha, resposta que
// faltar vira "Não respondeu". O telefone entra sempre com o 55 na frente.
//
//   T1  aviso "agora" para a Nilce (1 mensagem só)      T5  aviso de 10 min para o Thiago
//   T1a abertura sugerida                               T6  cartão agrupado (mais de 12 por hora)
//   T2  aviso "saiu sem marcar"                         T7  página do "falei com o cliente"
//   T3  lista das 07:00                                 (T4 é o segundo aviso de 5 min)
// ─────────────────────────────────────────────────────────────────────────────

import { rotuloDaFaixa, KWH_VISITA } from '../agenda/solarRota';
import {
  emojiDaNota, FONTE_DO_ANUNCIO, nomeEUfDaCidade, rotuloDaResposta, rotExtra, brl0, linhaDoDiagnostico,
  type Respostas, type RespostasExtra, type Diagnostico,
} from './solarQuiz';

export const NAO_RESPONDEU = 'Não respondeu';

const BRT = 'America/Sao_Paulo';

/** "14:32", horário de Brasília. */
export const horaBonita = (ms: number): string =>
  new Date(ms).toLocaleTimeString('pt-BR', { timeZone: BRT, hour: '2-digit', minute: '2-digit' });

/** Primeiro nome com a inicial maiúscula. */
export function primeiroNomeDe(nome: string): string {
  const n = String(nome ?? '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : 'Cliente';
}

export const linkWa = (tel55: string): string => `https://wa.me/${String(tel55).replace(/\D/g, '')}`;

/** Onde o cliente saiu: o que o beacon da página manda. */
export type OndeSaiu = 'diagnostico' | 'whatsapp' | 'horarios';
export const ONDE_SAIU_LONGO: Record<OndeSaiu, string> = {
  diagnostico: 'Saiu no diagnóstico, sem clicar no especialista',
  whatsapp: 'Saiu na tela do WhatsApp, antes de ver o diagnóstico',
  horarios: 'Saiu na escolha do horário, sem marcar',
};
export const ONDE_SAIU_CURTO: Record<OndeSaiu, string> = {
  diagnostico: 'No diagnóstico, sem clicar no especialista',
  whatsapp: 'Na tela do WhatsApp, antes de ver o diagnóstico',
  horarios: 'Na escolha do horário, sem marcar',
};

export interface DadosDaFicha {
  nome: string;
  /** Com o 55. */
  tel: string;
  nota: number;
  /** "Uberlândia-MG" (ou o que o cliente digitou, se não veio do IBGE). */
  cidadeUf: string;
  resp: Respostas;
  extra: RespostasExtra;
  diag: Diagnostico | null;
  kwh: number | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
}

const o = (campo: Parameters<typeof rotuloDaResposta>[0], v: string | null | undefined): string =>
  rotuloDaResposta(campo, v ?? null) ?? NAO_RESPONDEU;
const x = (campo: Parameters<typeof rotExtra>[0], v: string | null | undefined): string => rotExtra(campo, v) ?? NAO_RESPONDEU;

/** "Instagram, campanha X" ou "Sem anúncio (link direto)". */
export function origemDoAnuncio(source?: string | null, campaign?: string | null): string {
  const fonte = String(source ?? '').trim();
  const camp = String(campaign ?? '').trim();
  if (!fonte && !camp) return 'Sem anúncio (link direto)';
  return [FONTE_DO_ANUNCIO[fonte.toLowerCase()] || fonte, camp ? `campanha ${camp}` : ''].filter(Boolean).join(', ');
}

const GANCHO: Record<string, string> = {
  contas: 'Você marcou que quer folga para as outras contas.',
  guardar: 'Você marcou que quer guardar esse dinheiro.',
  reformar: 'Você marcou que quer usar esse dinheiro para reformar a casa.',
  conforto: 'Você marcou que quer usar o ar-condicionado sem culpa.',
  viajar: 'Você marcou que quer viajar mais.',
  negocio: 'Você marcou que quer investir no negócio.',
  producao: 'Você marcou que quer investir na produção.',
  lucro: 'Você marcou que quer aumentar o lucro.',
};
const PERGUNTA: Record<string, string> = {
  caro: 'Posso te mostrar como ficaria a parcela?',
  valia: 'Posso te mostrar quanto essa economia soma ao longo dos anos?',
  confianca: 'Posso te mandar fotos de obras que a gente fez?',
  tempo: 'Posso resolver tudo por aqui, no seu ritmo, sem tomar o seu dia?',
};
const PERGUNTA_PADRAO = 'Posso te fazer umas perguntas rápidas para fechar o seu estudo?';

/** T1a: uma frase por linha. */
export function aberturaSugerida(d: Pick<DadosDaFicha, 'nome' | 'cidadeUf' | 'diag' | 'extra'>): string {
  const cidade = nomeEUfDaCidade(d.cidadeUf).nome || d.cidadeUf;
  const gancho = d.extra.desejo ? GANCHO[d.extra.desejo] : '';
  const pergunta = (d.extra.travou && PERGUNTA[d.extra.travou]) || PERGUNTA_PADRAO;
  return [
    `Oi, ${primeiroNomeDe(d.nome)}!`,
    'Aqui é a Nilce, da Irmãos na Obra.',
    'Fiz a conta com as suas respostas.',
    d.diag && d.diag.economia_mes !== null ? `Em ${cidade}, dá para economizar cerca de ${brl0(d.diag.economia_mes)} por mês.` : '',
    gancho,
    pergunta,
  ].filter(Boolean).join('\n');
}

/** A ficha do T1, de "Quando:" até "Origem:". `quando` é o texto depois de "Quando: ". */
export function fichaDoAviso(d: DadosDaFicha, quando: string): string[] {
  const { resp, extra } = d;
  const kwh = d.kwh ?? d.diag?.kwh_mes ?? null;
  const L: string[] = [
    `Quando: ${quando}`,
    `Cliente: ${d.nome}`,
    `WhatsApp: ${linkWa(d.tel)}`,
    `Cidade: ${d.cidadeUf || NAO_RESPONDEU} · Tipo: ${o('tipo', resp.tipo)}`,
    `Conta: ${rotuloDaFaixa(resp.conta) ?? NAO_RESPONDEU} · Consumo: cerca de ${kwh !== null ? kwh.toLocaleString('pt-BR') : '?'} kWh`,
  ];
  if (kwh !== null && kwh > KWH_VISITA) L.push('Qualifica visita técnica, acima de 1.000 kWh');
  L.push(
    `Telhado: ${x('telhado', extra.telhado)} · Sombra: ${x('sombra', extra.sombra)} · Imóvel: ${o('imovel', resp.imovel)}`,
    `Vai aumentar o consumo: ${x('aumento', extra.aumento)}`,
    `Dor: ${x('dor', extra.dor)}`,
    // "Travou" só existe se a pergunta apareceu (tempo diferente de "agora").
    `Pensa em solar: ${x('tempo', extra.tempo)}${extra.tempo && extra.tempo !== 'agora' ? ` · Travou: ${x('travou', extra.travou)}` : ''}`,
    `Desejo: ${x('desejo', extra.desejo)}`,
    `Mais importante na empresa: ${x('criterio', extra.criterio)}`,
    `Prazo: ${o('urgencia', resp.urgencia)} · Paga: ${o('pagamento', resp.pagamento)}`,
    `Decide: ${o('decisor', resp.decisor)} · Já tem orçamento: ${o('concorrente', resp.concorrente)}`,
  );
  if (d.diag) L.push(`Diagnóstico: ${linhaDoDiagnostico(d.diag)}`);
  L.push(`Origem: ${origemDoAnuncio(d.utmSource, d.utmCampaign)}`);
  return L;
}

export const linkFalei = (codigo: string, base = (process.env.API_URL || 'https://api.solardoc.app')): string =>
  `${base.replace(/\/+$/, '')}/io/solar/falei/${codigo}`;

/** T1. `horaTexto` é a hora da ligação ("14:35"). */
export function avisoAgora(d: DadosDaFicha, horaTexto: string, codigo: string): string {
  return [
    `${emojiDaNota(d.nota)} *NOTA ${d.nota} · LIGAR AGORA*`,
    ...fichaDoAviso(d, `hoje, ${horaTexto}`),
    '',
    'Abertura sugerida:',
    aberturaSugerida(d),
    '',
    `Falou com o cliente? Toque aqui: ${linkFalei(codigo)}`,
  ].join('\n');
}

/** T2. */
export function avisoSaiuSemMarcar(d: DadosDaFicha, onde: OndeSaiu, horaTexto: string, codigo: string): string {
  return [
    `${emojiDaNota(d.nota)} *NOTA ${d.nota} · SAIU SEM MARCAR · LIGAR AGORA*`,
    ONDE_SAIU_LONGO[onde],
    ...fichaDoAviso(d, `hoje, ${horaTexto}`),
    '',
    'Abertura sugerida:',
    aberturaSugerida(d),
    '',
    `Falou com o cliente? Toque aqui: ${linkFalei(codigo)}`,
  ].join('\n');
}

export interface ItemDaLista { nome: string; nota: number; cidadeUf: string; conta: string; onde: OndeSaiu; tel: string }

/** T3: uma mensagem com N clientes. */
export function listaDas7(itens: readonly ItemDaLista[]): string {
  const blocos = itens.map(i => [
    `Nome: ${i.nome}, nota ${i.nota}`,
    `Cidade: ${i.cidadeUf || NAO_RESPONDEU} · Conta: ${i.conta || NAO_RESPONDEU}`,
    `Saiu: ${ONDE_SAIU_CURTO[i.onde]}`,
    `WhatsApp: ${linkWa(i.tel)}`,
  ].join('\n'));
  return [`☀️ *BOM DIA · LIGAR HOJE · ${itens.length} FORA DO HORÁRIO*`, 'Estes clientes saíram do quiz fora do horário, sem marcar.', '', blocos.join('\n\n')].join('\n');
}

export interface DadosCurtos { nome: string; nota: number; cidadeUf: string; tel: string; conta?: string }

/** T4. */
export function segundoAviso(d: DadosCurtos, codigo: string): string {
  return [
    `⏰ *${d.nome.toUpperCase()} ESPERANDO · LIGAR AGORA*`,
    `Nota ${d.nota}, ${d.cidadeUf || NAO_RESPONDEU}.`,
    'Faz 5 minutos que o aviso chegou e o link ainda não foi tocado.',
    `WhatsApp: ${linkWa(d.tel)}`,
    `Já falou com ${d.nome}? Toque aqui: ${linkFalei(codigo)}`,
  ].join('\n');
}

/** T5. */
export function avisoParaOThiago(d: DadosCurtos, minutos: number): string {
  return [
    `⚠️ *LEAD PARADO · ${d.nome}*`,
    `Parado há ${minutos} min, e a Nilce ainda não tocou no link.`,
    `Nota ${d.nota}, ${d.cidadeUf || NAO_RESPONDEU}.`,
    'Só a Nilce atende solar, então não tem para quem passar.',
    `WhatsApp: ${linkWa(d.tel)}`,
  ].join('\n');
}

/** T6. */
export function cartaoAgrupado(itens: readonly DadosCurtos[]): string {
  return [
    `📋 *${itens.length} AVISOS NOS ÚLTIMOS 10 MIN · LIGAR*`,
    'Chegou muita gente de uma vez, juntei tudo aqui.',
    ...itens.map(i => `Nota ${i.nota}, ${i.nome}, ${i.cidadeUf || NAO_RESPONDEU}, conta ${i.conta || NAO_RESPONDEU}: ${linkWa(i.tel)}`),
  ].join('\n');
}

// ── T7: a página do "falei com o cliente" (sem emoji) ───────────────────────
export const TEXTOS_FALEI = {
  titulo: (nome: string) => `Você já falou com ${nome}?`,
  frase: 'Abrir esta página não marca nada. Só o botão abaixo conta como atendido.',
  botao: 'Falei com o cliente',
  marcado: (nome: string, hora: string) => `Pronto, marcado às ${hora}. ${nome} está como atendido. Pode fechar esta página.`,
  jaEstava: (hora: string) => `Já estava marcado às ${hora}. Não precisa tocar de novo.`,
  erro: 'Não deu certo. Toque no botão de novo.',
  invalido: 'Este link não vale mais.',
} as const;

const esc = (s: string): string => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const CSS = 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1a33;color:#fff;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}'
  + 'main{max-width:420px;width:100%;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#c9d3e6;line-height:1.5;margin:0 0 24px}'
  + 'button{width:100%;padding:16px;font-size:18px;font-weight:700;border:0;border-radius:12px;background:#f0c163;color:#0b1a33;cursor:pointer}';

/** A página inteira. `acao` = o botão (POST); sem ela, só a mensagem. Tudo escapado. */
export function paginaFalei(p: { titulo: string; frase: string; acao?: string; botao?: string }): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex,nofollow"><title>${esc(p.titulo)}</title><style>${CSS}</style></head><body><main>`
    + `<h1>${esc(p.titulo)}</h1><p>${esc(p.frase)}</p>`
    + (p.acao ? `<form method="post" action="${esc(p.acao)}"><button type="submit">${esc(p.botao || TEXTOS_FALEI.botao)}</button></form>` : '')
    + `</main></body></html>`;
}
