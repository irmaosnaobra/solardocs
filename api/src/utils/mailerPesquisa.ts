// ─────────────────────────────────────────────────────────────────────────────
// E-MAILS DAS PESQUISAS (04/11/2026): a entrevista de saída (quem parou de pagar) e o pedido de depoimento (quem mais usa).
// Arquivo à parte do mailer.ts de propósito: o mailer.ts não exporta o cliente do Resend nem o remetente, então este arquivo cria o seu
// com as MESMAS envs (RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO) e os mesmos valores padrão. O descadastro por link usa o mesmo token do
// resto da casa (unsubToken); o rodapé visível é o combinado com o dono ("Responda este e-mail com SAIR").
// Os builders são puros (o teste confere o texto); só os dois `send*` falam com o Resend.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';
import { unsubToken } from '../controllers/unsubscribeController';

const resend = new Resend(process.env.RESEND_API_KEY);

const APP_URL = 'https://solardoc.app';
const API_URL = process.env.API_URL || 'https://api.solardoc.app';
const FROM_EMAIL = process.env.MAIL_FROM || 'SolarDoc Pro <equipe@solardoc.app>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';

export const RODAPE_SAIR = 'Não quer mais receber? Responda este e-mail com SAIR.';

export const ASSUNTO_SAIDA = 'Posso te fazer 3 perguntas sobre a SolarDoc?';
export const ASSUNTO_DEPOIMENTO = 'Seu depoimento sobre a SolarDoc, em 2 frases';

export const linkPesquisa = (tipo: 'saida' | 'depoimento', token: string): string =>
  `${APP_URL}/pesquisa/${tipo}?t=${encodeURIComponent(token)}`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Oi, Ana," ou "Oi," quando não há primeiro nome de gente. */
export function saudacaoEmail(nome: string | null | undefined): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  return p ? `Oi, ${p},` : 'Oi,';
}

const P = 'margin:0 0 14px;';

function moldura(corpo: string): string {
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;font-size:16px;line-height:1.7;">
${corpo}
  <p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">${RODAPE_SAIR}</p>
</div>`;
}

const botao = (href: string, rotulo: string): string =>
  `<p style="margin:22px 0;"><a href="${esc(href)}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">${esc(rotulo)}</a></p>`;

export function emailSaida(nome: string | null | undefined, token: string): { subject: string; html: string } {
  const html = moldura(`  <p style="${P}">${esc(saudacaoEmail(nome))}</p>
  <p style="${P}">Obrigado pelo tempo em que você usou a SolarDoc.</p>
  <p style="${P}">Queria entender 3 coisas, com toda a sinceridade:</p>
  <p style="margin:0 0 6px;">1. Por que você saiu?</p>
  <p style="margin:0 0 6px;">2. Qual é a sua crítica sincera?</p>
  <p style="${P}">3. O que faria você voltar?</p>
  <p style="${P}">Leva 1 minuto, e a sua resposta vai direto para o dono.</p>
  ${botao(linkPesquisa('saida', token), 'Responder em 1 minuto')}
  <p style="margin:0;">Equipe SolarDoc</p>`);
  return { subject: ASSUNTO_SAIDA, html };
}

export function emailDepoimento(nome: string | null | undefined, token: string): { subject: string; html: string } {
  const html = moldura(`  <p style="${P}">${esc(saudacaoEmail(nome))}</p>
  <p style="${P}">Você é uma das pessoas que mais usa a SolarDoc, e isso significa muito para nós.</p>
  <p style="${P}">Você topa contar em 2 frases o que ela mudou no seu trabalho? A ideia é mostrar para outros integradores.</p>
  <p style="${P}">Só publicamos com a sua autorização.</p>
  ${botao(linkPesquisa('depoimento', token), 'Escrever meu depoimento')}
  <p style="margin:0;">Equipe SolarDoc</p>`);
  return { subject: ASSUNTO_DEPOIMENTO, html };
}

async function enviar(to: string, userId: string, m: { subject: string; html: string }): Promise<void> {
  const url = `${API_URL}/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`;
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    replyTo: REPLY_TO,
    subject: m.subject,
    html: m.html,
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

export const sendPesquisaSaidaEmail = (o: { to: string; userId: string; nome?: string | null; token: string }): Promise<void> =>
  enviar(o.to, o.userId, emailSaida(o.nome, o.token));

export const sendPesquisaDepoimentoEmail = (o: { to: string; userId: string; nome?: string | null; token: string }): Promise<void> =>
  enviar(o.to, o.userId, emailDepoimento(o.nome, o.token));
