// E-mail do Portal do Parceiro NEXUS: oportunidade oferecida ao parceiro e convite às contas do SolarDoc com CNPJ.
//
// E-mail NÃO é WhatsApp (sem chefe-antiban), mas as mesmas manhas valem: a TRAVA por insert em system_state vem ANTES de
// cada envio (chave única), e nada sai fora das regras da v3:
//   - oportunidade: `nexus_email_op:<oportunidade_id>:<user_id>`, uma por oportunidade e parceiro; NEXUS_EMAIL_OPORTUNIDADE=0
//     desliga (conferido ANTES de tomar a trava); nunca leva o contato do cliente final.
//   - convite: `nexus_convite_email:<user_id>`, uma por conta, com o descadastro da casa (unsubToken + List-Unsubscribe).
// Nenhuma das duas chaves começa com prefixo de BOT_SENT_PREFIXES do lineThrottle (esse é de WhatsApp).
//
// A Resend é criada DENTRO da função: o construtor lança sem RESEND_API_KEY e não pode derrubar o boot.

import { Resend } from 'resend';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { unsubToken } from '../../controllers/unsubscribeController';
import { Linha } from './repositorio';
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

function moldura(titulo: string, corpo: string, rodape: string): string {
  return `<div style="background:${COR.cinza};padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:${COR.fundo};padding:20px 28px;">
      <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:2px;">NEXUS ELETROPOSTOS</p>
    </div>
    <div style="padding:28px;color:${COR.texto};font-size:15px;line-height:1.7;">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${COR.fundo};">${titulo}</h1>
      ${corpo}
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
  const cidade = String(o.cidade ?? '').trim();
  const uf = String(o.uf ?? '').trim();
  const lugar = cidade ? `${cidade}${uf ? '/' + uf : ''}` : uf;
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

export const ASSUNTO_CONVITE = 'Seu login do SolarDoc agora abre o Portal do Parceiro NEXUS';
export const PREVIA_CONVITE = 'Venda ou instale carregadores rápidos NEXUS. Grátis para empresas.';

const apiUrl = () => process.env.API_URL || 'https://api.solardoc.app';
export const urlDescadastro = (userId: string): string =>
  `${apiUrl()}/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`;

export function htmlConvite(userId: string): string {
  const p = (t: string) => `<p style="margin:0 0 14px;">${t}</p>`;
  const corpo =
    // Texto de pré-visualização da caixa de entrada (escondido no corpo).
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escaparHtml(PREVIA_CONVITE)}</div>` +
    p('Olá!') +
    p('Você já usa o SolarDoc para fazer propostas solares. Agora o mesmo login dá acesso ao Portal do Parceiro NEXUS Eletropostos.') +
    p('O portal é grátis e só para empresas com CNPJ ativo.') +
    p('Você pode entrar como Revenda, vendendo o carregador NEXUS aos seus clientes, com preço de parceiro negociado com o comercial. Ou como Montagem e Engenharia, executando as obras chave na mão na sua região. Ou os dois.') +
    p('Cada proposta sai com &quot;NEXUS em parceria com&quot; e o logo da sua empresa.') +
    p('Entre com o seu e-mail e senha do SolarDoc e comece pelo simulador em PDF.') +
    botao(URL_CONVITE, 'Acessar o portal');
  const rodape =
    `Você recebe este e-mail porque tem uma conta com CNPJ no SolarDoc. ` +
    `<a href="${escaparHtml(urlDescadastro(userId))}" style="color:${COR.suave};text-decoration:underline;">Descadastrar destes e-mails</a>.`;
  return moldura('Portal do Parceiro NEXUS', corpo, rodape);
}

export async function enviarConvite(userId: string, email: string): Promise<void> {
  await enviador.enviar({
    to: email,
    subject: ASSUNTO_CONVITE,
    html: htmlConvite(userId),
    headers: {
      'List-Unsubscribe': `<${urlDescadastro(userId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
