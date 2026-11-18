// ─────────────────────────────────────────────────────────────────────────────
// E-MAIL DA RETOMADA DA BASE (18/11/2026): os textos aprovados pelo redator e o HTML. Arquivo PURO: nada aqui lê banco, relógio ou env.
//
// 3 segmentos (o e-mail 1, 2 e 3 do redator), assunto A ou B (hash estável do id da conta), pré-cabeçalho, corpo, botão e P.S.
// O botão leva ao Pix automático com o e-mail da pessoa já preenchido e a origem marcada (utm_campaign = base_<segmento>, utm_content = A ou B).
// O envio, a segmentação e as travas moram em emailRetomada.ts; o descadastro e o List-Unsubscribe entram no sendMarketingEmail (utils/mailer.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { hashEstavel } from './retomadaUsuariosRegras';

export const SEGMENTOS_EMAIL = ['gratis_usou', 'gratis_nunca_usou', 'ex_assinante'] as const;
export type SegmentoEmailRetomada = typeof SEGMENTOS_EMAIL[number];
export type VarianteEmail = 'A' | 'B';

/** O endereço do botão: sempre o domínio da SolarDoc, nunca o da env (o link vai na caixa de entrada de quem não está logado). */
export const BASE_LINK_RETOMADA = 'https://solardoc.app/';

interface TextoEmail {
  /** O assunto A sem o nome: com nome vira "Nome, <resto>", sem nome vira o resto com a 1ª letra maiúscula. */
  assuntoA: string;
  assuntoB: string;
  preCabecalho: string;
  corpo: readonly string[];
  botao: string;
  ps: string;
}

const ASSINATURA = 'Carla, da SolarDoc';

export const TEXTOS_EMAIL_RETOMADA: Readonly<Record<SegmentoEmailRetomada, TextoEmail>> = Object.freeze({
  // 1. Grátis que já usou e nunca pagou.
  gratis_usou: {
    assuntoA: 'a SolarDoc mudou bastante desde o seu teste',
    assuntoB: 'Proposta Moderna com a logo da sua empresa na capa',
    preCabecalho: 'Proposta Moderna nova, IA que lê a conta de luz e link rastreado. R$ 67 por mês.',
    corpo: [
      'Você já testou a SolarDoc, e queremos te mostrar o que mudou.',
      'Saiu a nova proposta Moderna, em folhas A4 com a logo da sua empresa em destaque na capa.',
      'A IA lê a conta de luz e preenche o cadastro do cliente.',
      'A proposta aceita vários inversores de marcas diferentes e com bateria.',
      'O link da proposta é rastreado: você é avisado quando o cliente abre.',
      'São 8 documentos com a sua logo, a sua cor e o seu CNPJ, sem limite de documentos.',
      'O plano é único: R$ 67 por mês, sem fidelidade e com garantia de 7 dias.',
      'No Pix automático você autoriza uma vez no app do banco, e o banco debita todo mês.',
      'Para cancelar, é só entrar no app do banco.',
    ],
    botao: 'Ativar Pix automático',
    ps: 'Tem garantia de 7 dias, então dá para testar com calma.',
  },
  // 2. Grátis que criou a conta e nunca montou proposta.
  gratis_nunca_usou: {
    assuntoA: 'falta só a sua primeira proposta',
    assuntoB: 'A IA lê a conta de luz e preenche o cadastro para você',
    preCabecalho: 'A IA lê a conta de luz e preenche o cadastro do cliente. Sua logo, sua cor, seu CNPJ.',
    corpo: [
      'Você criou a sua conta na SolarDoc, mas ainda não montou nenhuma proposta.',
      'Sem problema. Dá para começar pelo caminho mais curto.',
      'A IA lê a conta de luz e preenche o cadastro do cliente.',
      'Você escolhe o modelo, e o documento sai com a sua logo, a sua cor e o seu CNPJ.',
      'Lançamos a nova proposta Moderna, em folhas A4 com a logo da sua empresa em destaque na capa.',
      'Além da proposta, tem mais 7 documentos: orçamento de 1 página, contrato de compra e venda, procuração, recibo, prestação de serviço, checklist de vistoria e proposta pro banco.',
      'O plano é único: R$ 67 por mês, sem limite de documentos e sem fidelidade.',
      'Você paga pelo Pix automático e cancela quando quiser.',
    ],
    botao: 'Assinar com Pix automático',
    ps: 'Se não fizer sentido para você, a garantia é de 7 dias.',
  },
  // 3. Ex-assinante.
  ex_assinante: {
    assuntoA: 'entrou muita coisa nova na SolarDoc desde que você saiu',
    assuntoB: 'Vistoria com assinatura, 12 bancos e proposta Moderna',
    preCabecalho: 'Proposta Moderna, Vistoria com assinatura, 12 bancos e Fio B. Sem fidelidade.',
    corpo: [
      'Faz um tempo que você saiu da SolarDoc, e tudo bem. Cada um para quando precisa.',
      'Passei só para contar que entrou muita coisa nova.',
      'A nova proposta Moderna, em folhas A4 com a sua logo em destaque na capa.',
      'Proposta Completa + Banco, com 12 bancos e Fio B.',
      'Vistoria completa com assinatura do cliente e PDF.',
      'Manutenção preventiva com registro de visitas.',
      'Link da proposta rastreado, que avisa quando o cliente abre.',
      'Todo documento fica na nuvem, organizado por cliente.',
      'Se quiser voltar, o plano é único: R$ 67 por mês, sem fidelidade e com garantia de 7 dias.',
      'No Pix automático você autoriza uma vez no app do banco, e o banco debita todo mês.',
    ],
    botao: 'Voltar com Pix automático',
    ps: 'Cancelar é pelo próprio app do banco.',
  },
});

/** A variante da pessoa: A ou B pelo hash estável do id da conta (o mesmo id cai sempre na mesma). */
export const varianteDoUsuario = (userId: string): VarianteEmail => (hashEstavel(userId) % 2 === 0 ? 'A' : 'B');

/** O link do botão: Pix automático com o e-mail codificado e a origem marcada. */
export function linkDaRetomada(email: string, segmento: SegmentoEmailRetomada, variante: VarianteEmail): string {
  const q = [
    'pagar=pix',
    `email=${encodeURIComponent(String(email ?? '').trim())}`,
    'utm_source=email',
    'utm_medium=retomada',
    `utm_campaign=base_${segmento}`,
    `utm_content=${variante}`,
  ];
  return `${BASE_LINK_RETOMADA}?${q.join('&')}`;
}

const escapar = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const maiuscula = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s);

export interface EmailMontado { subject: string; preheader: string; html: string; link: string }

/** Monta o e-mail inteiro. `nome` é o primeiro nome já limpo ('' = sem nome: o "Oi." e o assunto não levam vocativo). */
export function montarEmailRetomada(
  a: { nome?: string | null; email: string; segmento: SegmentoEmailRetomada; variante: VarianteEmail },
): EmailMontado {
  const t = TEXTOS_EMAIL_RETOMADA[a.segmento];
  const nome = String(a.nome ?? '').trim();
  const subject = a.variante === 'A' ? (nome ? `${nome}, ${t.assuntoA}` : maiuscula(t.assuntoA)) : t.assuntoB;
  const link = linkDaRetomada(a.email, a.segmento, a.variante);
  const p = (txt: string): string => `<p style="margin:0 0 14px;">${escapar(txt)}</p>`;
  const html = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff;">${escapar(t.preCabecalho)}</div>
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px 16px;color:#0f172a;font-size:16px;line-height:1.6;">
${p(nome ? `Oi, ${nome}.` : 'Oi.')}
${t.corpo.map(p).join('\n')}
<p style="margin:22px 0;"><a href="${escapar(link)}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:16px;padding:14px 28px;border-radius:10px;text-decoration:none;">${escapar(t.botao)}</a></p>
${p(ASSINATURA)}
<p style="margin:0 0 14px;color:#475569;">PS: ${escapar(t.ps)}</p>
</div>`;
  return { subject, preheader: t.preCabecalho, html, link };
}
