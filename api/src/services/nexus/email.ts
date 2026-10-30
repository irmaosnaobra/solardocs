// E-mail do Portal do Parceiro NEXUS: oportunidade oferecida ao parceiro e convite às contas do SolarDoc com CNPJ.
//
// E-mail NÃO é WhatsApp (sem chefe-antiban), mas as mesmas manhas valem: a TRAVA por insert em system_state vem ANTES de
// cada envio (chave única), e nada sai fora das regras da v3:
//   - oportunidade: `nexus_email_op:<oportunidade_id>:<user_id>`, uma por oportunidade e parceiro; NEXUS_EMAIL_OPORTUNIDADE=0
//     desliga (conferido ANTES de tomar a trava); nunca leva o contato do cliente final.
//   - convite: `nexus_convite_email:<user_id>`, uma por conta, com o descadastro da casa (unsubToken + List-Unsubscribe).
//     A trava é tomada pela ROTA (geradorNexusConvite), nunca por enviarConvite: enviarConvite só monta e manda, não grava nada.
//     O TESTE para o sócio (enviarConviteTeste) usa essa mesma parte que só monta e manda: sem trava, sem marca, fora do lote.
// Nenhuma das duas chaves começa com prefixo de BOT_SENT_PREFIXES do lineThrottle (esse é de WhatsApp).
//
// A Resend é criada DENTRO da função: o construtor lança sem RESEND_API_KEY e não pode derrubar o boot.

import { Resend } from 'resend';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { unsubToken } from '../../controllers/unsubscribeController';
import { Linha, cidadeUf } from './repositorio';
import { formatarBRT } from './tempo';

export const PREFIXO_TRAVA_OPORTUNIDADE = 'nexus_email_op:';
export const PREFIXO_TRAVA_CONVITE = 'nexus_convite_email:';

export const URL_PORTAL = 'https://solardoc.app/nexus/app';
export const URL_OPORTUNIDADES = `${URL_PORTAL}#oportunidades`;
export const URL_CONVITE = `${URL_PORTAL}?o=convite_email`;

const COR = { fundo: '#0B1A2B', azul: '#0085FF', azulTexto: '#0060C7', cinza: '#E5E7EB', texto: '#1f2937', suave: '#64748b' };

export function escaparHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Envio {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

/** Envio pela Resend. Lança se a Resend recusar. Ponto único de rede deste arquivo (os testes trocam esta função). */
export const enviador = {
  async enviar(e: Envio): Promise<void> {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'NEXUS Eletropostos <equipe@solardoc.app>';
    const replyTo = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';
    const { error } = await resend.emails.send({ from, to: e.to, replyTo, subject: e.subject, html: e.html, headers: e.headers });
    if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
  },
};

/** Insere a trava. 'ok' = tomou; 'duplicada' = já existia; 'erro' = sem trava confiável (não envie). */
export async function tomarTrava(chave: string, valor: Record<string, unknown>): Promise<'ok' | 'duplicada' | 'erro'> {
  const agora = new Date().toISOString();
  const { error } = await supabase.from('system_state').insert({ key: chave, value: { ...valor, em: agora }, updated_at: agora });
  if (!error) return 'ok';
  if ((error as { code?: string }).code === '23505') return 'duplicada';
  logger.error('nexus-email', 'trava do e-mail falhou, não vou arriscar enviar em dobro', error);
  return 'erro';
}

/**
 * Moldura comum dos e-mails do portal. `titulo` vazio = sem título (o convite abre direto na saudação).
 * `previa` = texto de pré-visualização da caixa de entrada: vai ESCONDIDO e como PRIMEIRO texto do HTML, antes da faixa da
 * marca; no fim do corpo o Gmail mostraria "NEXUS ELETROPOSTOS" no lugar dele.
 */
function moldura(titulo: string, corpo: string, rodape: string, previa = ''): string {
  const pre = previa
    ? `\n  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escaparHtml(previa)}</div>`
    : '';
  const h1 = titulo ? `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${COR.fundo};">${titulo}</h1>\n      ` : '';
  return `<div style="background:${COR.cinza};padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">${pre}
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:${COR.fundo};padding:20px 28px;">
      <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:2px;">NEXUS ELETROPOSTOS</p>
    </div>
    <div style="padding:28px;color:${COR.texto};font-size:15px;line-height:1.7;">
      ${h1}${corpo}
    </div>
  </div>
  <p style="max-width:560px;margin:12px auto 0;color:${COR.suave};font-size:12px;line-height:1.6;text-align:center;">${rodape}</p>
</div>`;
}

const botao = (url: string, texto: string) =>
  `<p style="margin:24px 0 8px;"><a href="${escaparHtml(url)}" style="display:inline-block;background:${COR.azul};color:#ffffff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;">${escaparHtml(texto)}</a></p>`;

// ── Oportunidade oferecida ao parceiro ───────────────────────────────────────

export const ASSUNTO_OPORTUNIDADE = 'Nova oportunidade NEXUS na sua região';

/** Corpo do e-mail. Só tipo, cidade, pedido e prazo: o contato do cliente final NUNCA entra aqui. */
export function htmlOportunidade(o: { tipo: unknown; cidade: unknown; uf: unknown; descricao: unknown; prazo_aceite: unknown }): string {
  const tipo = o.tipo === 'obra' ? 'Obra de eletroposto' : 'Cliente para atender';
  const lugar = cidadeUf(o.cidade, o.uf);
  const pedido = String(o.descricao ?? '').trim().slice(0, 400);
  const prazo = o.prazo_aceite ? formatarBRT(String(o.prazo_aceite)) : '';
  const linha = (rotulo: string, valor: string) =>
    valor ? `<p style="margin:0 0 6px;"><strong style="color:${COR.azulTexto};">${rotulo}:</strong> ${escaparHtml(valor)}</p>` : '';
  const corpo =
    `<p style="margin:0 0 16px;">A equipe NEXUS ofereceu uma oportunidade para a sua empresa.</p>` +
    linha('Tipo', tipo) + linha('Cidade', lugar) + linha('Pedido', pedido) + linha('Prazo para aceitar', prazo ? `${prazo} (horário de Brasília)` : '') +
    `<p style="margin:16px 0 0;">Os dados de contato do cliente aparecem no portal depois que você aceita.</p>` +
    botao(URL_OPORTUNIDADES, 'Ver a oportunidade');
  return moldura('Você recebeu uma nova oportunidade', corpo, 'Você recebe este aviso porque a sua empresa é parceira no Portal do Parceiro NEXUS.');
}

export type ResultadoEmailOportunidade = 'enviado' | 'desligado' | 'sem_email' | 'duplicado' | 'falhou';

/**
 * Avisa o parceiro por e-mail que recebeu uma oportunidade. Nunca lança (o PATCH da equipe não pode falhar por isto).
 * A env NEXUS_EMAIL_OPORTUNIDADE=0 desliga e é conferida ANTES da trava.
 */
export async function emailOportunidadeOferecida(o: Linha, parceiroUserId: string): Promise<ResultadoEmailOportunidade> {
  try {
    if (String(process.env.NEXUS_EMAIL_OPORTUNIDADE ?? '').trim() === '0') return 'desligado';
    const { data, error } = await supabase.from('users').select('email').eq('id', parceiroUserId).limit(1);
    if (error) throw error;
    const email = String(((data as Linha[] | null) ?? [])[0]?.email ?? '').trim();
    if (!email.includes('@')) return 'sem_email';

    const trava = await tomarTrava(`${PREFIXO_TRAVA_OPORTUNIDADE}${o.id}:${parceiroUserId}`, { tipo: 'oportunidade' });
    if (trava !== 'ok') return 'duplicado';
    try {
      await enviador.enviar({ to: email, subject: ASSUNTO_OPORTUNIDADE, html: htmlOportunidade(o as never) });
    } catch (e) {
      logger.error('nexus-email', 'e-mail da oportunidade não saiu (a trava fica, não reenvia)', e);
      return 'falhou';
    }
    return 'enviado';
  } catch (e) {
    logger.error('nexus-email', 'e-mail da oportunidade falhou', e);
    return 'falhou';
  }
}

// ── Convite às contas do SolarDoc com CNPJ ───────────────────────────────────

// Texto do convite (30/10/2026): apresenta a NEXUS como distribuidora e chama para o Portal do Parceiro. Sem preço, prazo,
// "grátis" nem número: o dono não prometeu nada disso. Mudou o texto? Mostre o TESTE (botão do /nexus/adm) ao dono antes do lote.
export const ASSUNTO_CONVITE = 'Conheça a NEXUS, a nossa distribuidora';
export const PREVIA_CONVITE = 'Procuramos parceiros que queiram entrar no mercado de carregadores. Veja o que temos.';
const BOTAO_CONVITE = 'Conhecer a NEXUS';
const ASSINATURA_CONVITE = 'Equipe SolarDoc';
const ITENS_CONVITE = ['Carregadores', 'Mentoria', 'Suporte', 'Engenharia', 'Indicação de clientes', 'E muito mais'];

/** Id que NÃO é de nenhuma conta, usado no descadastro do e-mail de TESTE: o descadastro da casa desliga e-mail E WhatsApp,
 *  e o sócio que clica "Descadastrar" no próprio teste não pode cortar a si mesmo. */
export const ID_CONVITE_TESTE = '00000000-0000-4000-8000-000000000000';

const apiUrl = () => process.env.API_URL || 'https://api.solardoc.app';
export const urlDescadastro = (userId: string): string =>
  `${apiUrl()}/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`;

/** Títulos que abrem um nome ("Eng Flavio Peetz", "Dra. Maria"). Nome que abre com título não é saudado, nem pelo token seguinte,
 *  que pode ser profissão ou empresa ("Eng Civil Flavio", "DR Solar"). Comparados pela chave de `chaveTitulo` (sem ponto, que o
 *  corte em ponto já tira, sem acento, em minúscula, e com "º", "ª" e "°" valendo "o", "a" e "o"): "Engº" cai em "engo", "Engª"
 *  em "enga", "Profª" em "profa" e "Profº" e "Prof°" em "profo". */
const TITULOS = ['eng', 'engo', 'enga', 'dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'profo'];
const TITULOS_DE_NOME = new Set(TITULOS);

/** O maior título tem 5 letras, mais 1 de folga. Token maior que isso nunca é título e nem chega a ser normalizado: o NFKD de um
 *  texto enorme é lento, e nome de gente não passa de poucas dezenas de letras. */
const TAMANHO_MAX_TITULO = Math.max(...TITULOS.map((t) => t.length)) + 1;

/** Tira o acento. NFKD também leva "º" a "o" e "ª" a "a", e só o teste de título quer isso. O teste de vogal usa NFD, para
 *  "Mª" não ganhar uma vogal que não é letra do nome. */
const tiraAcento = (t: string, forma: 'NFD' | 'NFKD'): string => t.normalize(forma).replace(/[\u0300-\u036f]/g, '');

/** Chave de comparação com a lista de títulos. O grau "°", que o teclado dá no lugar do "º", vale "o" (o NFKD não o leva a "o"). */
const chaveTitulo = (t: string): string =>
  t.length > TAMANHO_MAX_TITULO ? '' : tiraAcento(t, 'NFKD').replace(/\xb0/g, 'o').toLowerCase();

const ehTitulo = (t: string): boolean => TITULOS_DE_NOME.has(chaveTitulo(t));

/**
 * Primeiro nome para a saudação do convite. Vazio quando o texto não parece nome de gente (e-mail, número, símbolo, sigla): aí
 * o e-mail diz só "Olá." e nunca "Olá, 11999990000." nem "Olá, Vsp.". Corta no espaço, no ponto e no sublinhado ("ana.paula"
 * vira "Ana"). Título no começo (Eng, Engº, Engª, Dr, Dra, Sr, Sra, Srta, Prof, Profª, Profº, com ou sem ponto, com "°" no
 * lugar do "º", em qualquer caixa) dá vazio e NÃO é pulado: o token seguinte pode ser profissão ou empresa ("Eng Civil Flavio",
 * "Eng. Eletricista Flavio", "DR Solar", "SR Energia Solar"), e chamar o cliente por isso é pior do que um "Olá." seco. Vale
 * para "Eng Flavio Peetz" e para "Prof.ª Ana" (o ponto separa o ordinal, mas o primeiro token já é o título). Token sem nenhuma
 * vogal (a, e, i, o, u, y, com ou sem acento) é sigla, não nome: "MF", "Vs", "VSP" e "CM" dão vazio, e a sigla não passa a vez
 * para o token seguinte. Nome todo em minúscula ou todo em maiúscula (o do login do Gerador é o começo do e-mail: "thiago")
 * ganha a inicial maiúscula e o resto minúsculo; nome já misturado ("McDonald") fica como veio.
 */
export function primeiroNome(nome: unknown): string {
  const p = String(nome ?? '').trim().split(/[\s._]+/)[0] ?? '';
  if (ehTitulo(p)) return '';
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(p)) return '';
  if (!/[aeiouy]/i.test(tiraAcento(p, 'NFD'))) return '';
  const resto = p === p.toLowerCase() || p === p.toUpperCase() ? p.slice(1).toLowerCase() : p.slice(1);
  return p.charAt(0).toUpperCase() + resto;
}

export function htmlConvite(userId: string, nome?: unknown): string {
  const p = (t: string) => `<p style="margin:0 0 14px;">${t}</p>`;
  const primeiro = primeiroNome(nome);
  const lista =
    `<ul style="margin:0 0 14px;padding-left:22px;">` +
    ITENS_CONVITE.map((i) => `<li style="margin:0 0 4px;">${escaparHtml(i)}</li>`).join('') +
    `</ul>`;
  const corpo =
    p(primeiro ? `Olá, ${escaparHtml(primeiro)}.` : 'Olá.') +
    p('Você já usa o SolarDoc. Agora queremos apresentar a NEXUS, a nossa distribuidora.') +
    p('Procuramos parceiros que queiram entrar no mercado de carregadores para veículos elétricos e ter equipamento de qualidade. Estamos formando a rede de parceiros da NEXUS e queremos a sua empresa nela.') +
    `<p style="margin:0 0 6px;">Na NEXUS você tem:</p>` + lista +
    p('Para conhecer, é só entrar no Portal do Parceiro NEXUS com o mesmo login do SolarDoc.') +
    botao(URL_CONVITE, BOTAO_CONVITE) +
    `<p style="margin:16px 0 0;">${escaparHtml(ASSINATURA_CONVITE)}</p>`;
  const rodape =
    `Você recebeu este e-mail porque tem uma conta no SolarDoc. ` +
    `<a href="${escaparHtml(urlDescadastro(userId))}" style="color:${COR.suave};text-decoration:underline;">Descadastrar destes e-mails</a>.`;
  return moldura('', corpo, rodape, PREVIA_CONVITE);
}

/** Só MONTA e MANDA. Não grava nada (a trava `nexus_convite_email:<user_id>` é tomada pela rota, antes de chamar esta função). */
export async function enviarConvite(userId: string, email: string, nome?: unknown): Promise<void> {
  await enviador.enviar({
    to: email,
    subject: ASSUNTO_CONVITE,
    html: htmlConvite(userId, nome),
    headers: {
      'List-Unsubscribe': `<${urlDescadastro(userId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/**
 * O MESMO e-mail do convite (assunto, texto, botão, cabeçalhos), para um sócio conferir antes de disparar o lote. Não toma
 * trava, não marca ninguém como convidado, não passa pelo banco. O descadastro leva um id que não é de nenhuma conta.
 */
export async function enviarConviteTeste(email: string, nome?: unknown): Promise<void> {
  await enviarConvite(ID_CONVITE_TESTE, email, nome);
}
