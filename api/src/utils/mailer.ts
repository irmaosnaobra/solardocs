import { Resend } from 'resend';
import { unsubToken } from '../controllers/unsubscribeController';

const resend = new Resend(process.env.RESEND_API_KEY);

const APP_URL = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://solardoc.app';
const API_URL = process.env.API_URL || 'https://api.solardoc.app';

const FROM_EMAIL = process.env.MAIL_FROM || 'SolarDoc Pro <equipe@solardoc.app>';
const REPLY_TO = process.env.MAIL_REPLY_TO || 'aiorosgroup@gmail.com';

function unsubUrl(userId: string): string {
  return `${API_URL}/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`;
}

function unsubFooter(userId: string): string {
  const url = unsubUrl(userId);
  return `<div style="max-width:580px;margin:14px auto 0;padding:0 12px;font-family:'Segoe UI',Arial,sans-serif;color:#64748b;font-size:11px;text-align:center;line-height:1.6;">
    <p style="margin:0 0 4px;">SolarDoc Pro — automacao de documentos para integradores solares</p>
    <p style="margin:0;">Voce esta recebendo esse email porque criou uma conta na plataforma. <a href="${url}" style="color:#94a3b8;text-decoration:underline;">Descadastrar destes emails</a>.</p>
  </div>`;
}

async function sendMarketingEmail(opts: { to: string; userId: string; subject: string; html: string }): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    replyTo: REPLY_TO,
    subject: opts.subject,
    html: opts.html + unsubFooter(opts.userId),
    headers: {
      'List-Unsubscribe': `<${unsubUrl(opts.userId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

const followupEmails: Record<number, { subject: string; html: string }> = {
  // Cadência (2026-05-21): 13 emails ao longo de 365 dias, foco no Gerador de Proposta Personalizado.
  // 7 templates onboarding (idx 1-7) + 5 variantes ongoing (cnpjOngoingEmails) cicladas via modulo.
  // Disparada às 8h30 BRT via master cron. Audiência: usuários sem CNPJ (não-ativos na plataforma).
  1: {
    subject: '🎨 Sua próxima proposta solar pode ter A SUA cara',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro · Novidade</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Gerador de Proposta com a sua marca, suas cores, seu portfólio.</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Você criou sua conta no SolarDoc mas ainda não cadastrou o CNPJ — e acabou perdendo o lançamento mais importante da plataforma:</p>
          <div style="background:#1e293b;border-left:4px solid #f59e0b;padding:18px 22px;margin:0 0 24px;border-radius:0 10px 10px 0;">
            <p style="color:#f59e0b;font-weight:800;font-size:14px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">Gerador de Proposta Personalizado</p>
            <p style="color:#e2e8f0;font-size:15px;line-height:1.6;margin:0;">Uma proposta moderna, com a <strong>SUA logo</strong>, <strong>SUA cor</strong> e <strong>SUAS fotos de portfólio</strong> — pronta em 30 segundos pra mandar no WhatsApp do cliente.</p>
          </div>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Chega de mandar proposta com a cara dos outros. Cadastre seu CNPJ e ative gratuitamente.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Quero o gerador com a minha marca →</a>
          <p style="color:#475569;font-size:13px;margin:32px 0 0;line-height:1.6;">10 propostas e documentos grátis, sem cartão de crédito.</p>
        </div>
      </div>`,
  },
  2: {
    subject: 'R$ 200/mês em gerador de proposta? Aqui vem incluso a partir de R$ 27',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Cansado de pagar caro só pra ter "uma proposta bonita"?</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Os geradores especializados do mercado cobram entre <strong style="color:#f59e0b;">R$ 100 e R$ 300 por mês</strong> — e te entregam um template engessado, igual ao do concorrente.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 22px;">No SolarDoc, o Gerador de Proposta vem <strong style="color:#fbbf24;">incluso no plano a partir de R$ 27/mês</strong> — e ainda vem com:</p>
          <div style="margin:0 0 28px;">
            <p style="color:#e2e8f0;font-size:14px;line-height:2;margin:0;">
              ✓ Contratos de compra e venda solar<br>
              ✓ Procuração para concessionária<br>
              ✓ Proposta bancária (financiamento)<br>
              ✓ Contrato vendedor e prestação de serviço
            </p>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Ativar minha conta gratuitamente →</a>
          <p style="color:#475569;font-size:13px;margin:32px 0 0;">Começa com 10 documentos grátis. Cancela quando quiser.</p>
        </div>
      </div>`,
  },
  3: {
    subject: 'Logo, cor da empresa, foto do portfólio — em cada proposta',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro · Gerador de Proposta</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">A proposta sai com a sua identidade visual, não com a dos outros.</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 24px;">Quando o cliente recebe sua proposta, ele já reconhece a marca da sua empresa — não um modelo genérico que metade do mercado já mandou pra ele:</p>
          <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
            <span style="color:#f59e0b;font-size:22px;margin-right:14px;">🎨</span>
            <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Sua logo no topo</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Em alta resolução, sem perda de qualidade</p></div>
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
            <span style="color:#f59e0b;font-size:22px;margin-right:14px;">🎯</span>
            <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">A cor da empresa em todo PDF</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Tom da sua identidade visual, não amarelo padrão</p></div>
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
            <span style="color:#f59e0b;font-size:22px;margin-right:14px;">📸</span>
            <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Fotos do seu portfólio real</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Mostre obras suas, não stock photo</p></div>
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:22px;display:flex;align-items:center;">
            <span style="color:#f59e0b;font-size:22px;margin-right:14px;">⚡</span>
            <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Geração em 30 segundos</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Preenche kWp, consumo, valor — pronto</p></div>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Personalizar agora →</a>
        </div>
      </div>`,
  },
  4: {
    subject: 'Canadian Solar, Trina, BYD, Growatt — todos no nosso gerador',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro · Catálogo</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Não importa o equipamento que você instala — está no nosso gerador.</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">O Gerador de Proposta do SolarDoc é <strong style="color:#f59e0b;">aberto a todos os equipamentos do mercado</strong> — não te prende em fabricantes parceiros.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 16px;"><strong style="color:#e2e8f0;">Painéis:</strong> Canadian Solar, Trina Solar, JA Solar, BYD, Risen, Astronergy, Longi, Jinko Solar, ZNShine, OSDA...</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 16px;"><strong style="color:#e2e8f0;">Inversores:</strong> Growatt, Fronius, Solis, Goodwe, Deye, SAJ, Hoymiles, SMA, Sungrow, Huawei...</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Se o seu fornecedor mudou ou você quer comparar kits de fabricantes diferentes, basta selecionar no dropdown — sem burocracia, sem ficar amarrado a uma marca só.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Ver catálogo completo →</a>
        </div>
      </div>`,
  },
  5: {
    subject: '10 propostas grátis ainda te esperam — falta só o CNPJ',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Sua conta tá parada há mais de um mês — vamos ativar?</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Faz mais de um mês que você criou a conta e o CNPJ da empresa ainda não foi informado.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 22px;">Você ainda tem <strong style="color:#fbbf24;">10 documentos grátis</strong> esperando — inclui o Gerador de Proposta com a sua marca, contratos, procurações e propostas bancárias. Não vence.</p>
          <div style="background:#1e293b;border-radius:12px;padding:22px;margin:0 0 28px;">
            <p style="color:#f59e0b;font-weight:700;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">Pra ativar você precisa só de:</p>
            <p style="color:#e2e8f0;font-size:15px;line-height:1.9;margin:0;">→ Informar o CNPJ da sua empresa<br>→ Subir a logo e definir a cor da marca<br>→ Pronto. Primeira proposta sai em 30 seg.</p>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:16px;padding:18px 40px;border-radius:10px;text-decoration:none;">Ativar agora — é grátis →</a>
          <p style="color:#334155;font-size:12px;margin:36px 0 0;line-height:1.6;">Se preferir não receber mais comunicações de boas-vindas, basta clicar no link de descadastro abaixo.</p>
        </div>
      </div>`,
  },
  6: {
    subject: 'Como integradores estão fechando mais com menos burocracia',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Mais propostas fechadas, menos tempo no escritório</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Integradores que adotaram o SolarDoc Pro relatam uma mudança simples mas poderosa: <strong style="color:#f59e0b;">conseguem enviar o contrato para o cliente no mesmo dia da visita técnica.</strong></p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">Antes precisavam voltar ao escritório, abrir o Word, ajustar o modelo, conferir cláusula por cláusula, salvar em PDF, mandar por WhatsApp e torcer para o cliente não perder o arquivo.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Hoje fazem isso direto do celular, em menos de 2 minutos, com o documento pronto para enviar ao cliente.</p>
          <div style="background:#1e293b;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:20px 24px;margin:0 0 28px;">
            <p style="color:#e2e8f0;font-style:italic;font-size:15px;line-height:1.7;margin:0;">"A ferramenta foi feita por quem entende do setor. Os documentos já saem corretos, não preciso revisar nada."</p>
            <p style="color:#64748b;font-size:13px;margin:12px 0 0;">— Integrador solar, 8 anos de mercado</p>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Quero essa agilidade também</a>
        </div>
      </div>`,
  },
  7: {
    subject: 'Vai deixar o mercado te passar na frente?',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Vai deixar o mercado te passar na frente?</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Faz alguns meses que sua conta foi criada e o CNPJ ainda não foi informado.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">O SolarDoc Pro foi construído ao longo de 8 anos de experiência real como integradores para resolver o problema que todo integrador enfrenta: <strong style="color:#f8fafc;">burocracia que consome tempo de venda.</strong></p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Seus 10 documentos gratuitos continuam disponíveis. Basta informar o CNPJ e começar.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:16px;padding:18px 40px;border-radius:10px;text-decoration:none;">Ativar agora — é grátis</a>
        </div>
      </div>`,
  },
};

export async function sendFollowupEmail(email: string, userId: string, day: number): Promise<void> {
  const template = followupEmails[day];
  if (!template) return;
  await sendMarketingEmail({ to: email, userId, subject: template.subject, html: template.html });
}

// ── Nudge de CONVERSÃO free->pago ──────────────────────────────────────────
// Alvo: free ENGAJADO (já tem CNPJ e gerou 3+ propostas). O delta deles NÃO é
// "proposta com sua marca" (já têm, vem com o CNPJ no free) — é destravar os
// OUTROS tipos de documento (contrato, procuração, recibo, vistoria...) que o
// free tranca, e sair do teto de 10 docs/mês. A copy fala exatamente disso.
// 3 toques (idx 1/2/3) com angulação diferente. Via sendMarketingEmail →
// List-Unsubscribe + footer de descadastro (entregabilidade + compliance).
const UPGRADE_NUDGE: Record<number, (firstName: string, docsFeitos: number) => { subject: string; html: string }> = {
  1: (nome, docs) => ({
    subject: `${nome}, você já fez ${docs} propostas no SolarDoc — falta destravar o resto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:30px 36px;">
    <p style="margin:0;color:#0f172a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Você já tá usando — só falta destravar tudo</h1>
  </div>
  <div style="padding:32px 36px;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${nome}, você já gerou <strong style="color:#fbbf24;">${docs} propostas</strong> com a sua marca. 👏</p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 22px;">Mas toda vez que você tenta gerar um <strong style="color:#f8fafc;">contrato</strong>, uma <strong style="color:#f8fafc;">procuração</strong> ou um <strong style="color:#f8fafc;">recibo</strong>, esbarra no aviso de upgrade. No plano grátis, só a proposta é liberada.</p>
    <div style="background:#1e293b;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:18px 22px;margin:0 0 24px;">
      <p style="color:#fbbf24;font-weight:800;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">No PRO você destrava</p>
      <p style="color:#e2e8f0;font-size:14.5px;line-height:1.7;margin:0;">📄 Contrato solar · Procuração · Recibo · Vistoria · Prestação de serviço · Proposta bancária<br/>📈 E sai do teto de 10 documentos/mês.</p>
    </div>
    <div style="text-align:center;margin:8px 0;">
      <a href="${APP_URL}/planos" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:16px 40px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(245,158,11,0.4);">Quero destravar tudo →</a>
    </div>
  </div>
</div>`,
  }),
  2: (nome, docs) => ({
    subject: `${nome}, seu contrato solar ainda tá no Word?`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:30px 36px;">
    <p style="margin:0;color:#0f172a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">A proposta sai daqui. E o contrato?</h1>
  </div>
  <div style="padding:32px 36px;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${nome}, suas <strong style="color:#fbbf24;">${docs} propostas</strong> já saem prontas e bonitas no SolarDoc.</p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 22px;">Mas aí pra fechar você ainda abre o Word pra montar o contrato na mão, ajusta a procuração, digita o recibo… O cliente esfria nesse vai-e-vem.</p>
    <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 24px;">No <strong style="color:#fbbf24;">PRO</strong>, contrato, procuração e recibo saem com os mesmos dados da proposta — em segundos, já com a sua marca. Fecha na hora.</p>
    <div style="text-align:center;margin:8px 0;">
      <a href="${APP_URL}/planos" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:16px 40px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(245,158,11,0.4);">Virar PRO e fechar mais rápido →</a>
    </div>
  </div>
</div>`,
  }),
  3: (nome, docs) => ({
    subject: `${nome}, última chamada — destrave os documentos do PRO`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:30px 36px;">
    <p style="margin:0;color:#0f172a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Você é dos que mais usam o SolarDoc</h1>
  </div>
  <div style="padding:32px 36px;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">${nome}, com <strong style="color:#fbbf24;">${docs} propostas geradas</strong>, você está entre os integradores que mais aproveitam a plataforma — ainda no plano grátis.</p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 24px;">Quem usa desse jeito fecha mais quando tem o kit completo de documentos na mão. É o último empurrão: destrava contrato, procuração, recibo e o resto — e tira o limite de 10/mês.</p>
    <div style="text-align:center;margin:8px 0;">
      <a href="${APP_URL}/planos" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:16px 40px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(245,158,11,0.4);">Fazer upgrade agora →</a>
    </div>
    <p style="color:#64748b;font-size:13px;margin:20px 0 0;line-height:1.6;text-align:center;">Dúvida sobre qual plano? Chama a Giovanna no WhatsApp (34) 99816-5040.</p>
  </div>
</div>`,
  }),
};

export async function sendUpgradeNudgeEmail(email: string, userId: string, toque: number, nome: string | null, docsFeitos: number): Promise<void> {
  const builder = UPGRADE_NUDGE[toque];
  if (!builder) return;
  const firstName = (nome || '').trim().split(/\s+/)[0] || 'Olá';
  const { subject, html } = builder(firstName, docsFeitos);
  await sendMarketingEmail({ to: email, userId, subject, html });
}

// Email pra quem cadastrou mas não passou cartão (abandonou o checkout do Stripe).
// Diferente do followup CNPJ — copy é cirúrgico no plano VIP + trial.
export async function sendCheckoutRecoveryEmail(email: string, userId: string): Promise<void> {
  const subject = 'Faltou só o cartão — seus 7 dias grátis estão te esperando';
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:32px 36px;">
    <p style="margin:0;color:#0f172a;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:26px;font-weight:900;line-height:1.2;letter-spacing:-0.5px;">
      Você criou a conta mas não terminou o cadastro
    </h1>
  </div>
  <div style="padding:32px 36px;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">
      Vi aqui que você começou a ativar o <strong style="color:#fbbf24;">Plano VIP</strong> mas parou na hora do cartão.
    </p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 18px;">
      <strong style="color:#f8fafc;">Lembrando o que você ganha nos 7 dias grátis:</strong>
    </p>
    <ul style="color:#cbd5e1;font-size:14.5px;line-height:1.9;margin:0 0 24px;padding-left:22px;">
      <li>Documentos <strong style="color:#f8fafc;">ilimitados</strong></li>
      <li>Procuração, Vistoria Técnica, Contrato PJ, Contrato Vendedor</li>
      <li>Gerador de Proposta com sua marca</li>
      <li>Suporte VIP por WhatsApp</li>
    </ul>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 24px;">
      <strong style="color:#fbbf24;">Nada é cobrado nos 7 primeiros dias.</strong> Se não gostar, cancela em 1 clique e zero cobrança.
    </p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${APP_URL}/auth?mode=login" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:18px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
        Continuar de onde parei →
      </a>
    </div>
    <p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.6;text-align:center;">
      Já entra na sua conta — o botão pra liberar o trial tá esperando lá dentro.
    </p>
  </div>
</div>`;
  await sendMarketingEmail({ to: email, userId, subject, html });
}

const noContractsEmails: Array<{ subject: string; html: (nome: string | null) => string }> = [
  {
    subject: 'Sua conta SolarDoc Pro está parada — vamos voltar?',
    html: (nome) => `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Faz uns dias que você não gera um documento</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">${nome ? `Oi ${nome.split(' ')[0]}!` : 'Olá!'} Sua empresa já está cadastrada e pronta para usar — só faltou abrir e gerar.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Em menos de 2 minutos você sai com um contrato, procuração ou proposta bancária pronta para enviar ao cliente.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Gerar um documento agora</a>
        </div>
      </div>`,
  },
  {
    subject: 'Quantos contratos você poderia ter fechado essa semana?',
    html: (nome) => `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Velocidade fecha venda</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">${nome ? `${nome.split(' ')[0]},` : 'Olha só:'} integrador que envia o contrato no mesmo dia da visita técnica fecha 3x mais que quem demora.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Sua plataforma SolarDoc Pro está pronta — abre e em 2 minutos o cliente recebe o documento por WhatsApp.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Abrir SolarDoc Pro</a>
        </div>
      </div>`,
  },
  {
    subject: 'Ainda dá tempo de fechar mais nesse mês',
    html: (nome) => `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">5 documentos que fecham venda</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">${nome ? `${nome.split(' ')[0]}, dá uma olhada` : 'Dá uma olhada'} no que você pode mandar pro seu cliente hoje:</p>
          <ul style="color:#94a3b8;font-size:15px;line-height:2;margin:0 0 28px;padding-left:20px;">
            <li>Contrato de instalação solar</li>
            <li>Proposta bancária para financiamento</li>
            <li>Procuração para distribuidora</li>
            <li>Contrato Vendedor</li>
            <li>Contrato de prestação de serviço (O&amp;M)</li>
          </ul>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Gerar agora</a>
        </div>
      </div>`,
  },
  {
    subject: 'Lembrete rápido: SolarDoc Pro tá te esperando',
    html: (nome) => `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Tudo pronto, é só abrir</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">${nome ? `${nome.split(' ')[0]},` : 'Ei,'} sua empresa, seus clientes e seus templates estão todos salvos. É só logar e gerar o próximo documento.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Cada dia parado é cliente que pode fechar com a concorrência.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Entrar agora</a>
        </div>
      </div>`,
  },
  {
    subject: 'Como tá indo a operação de documentos aí?',
    html: (nome) => `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Quer ajuda pra automatizar mais?</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">${nome ? `${nome.split(' ')[0]},` : 'Olá,'} se tá perdendo tempo com algum tipo de documento que ainda não está na plataforma, responde esse email — a gente cria o template pra você.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Enquanto isso, seu acesso continua ativo e seus 5 modelos prontos esperando.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Voltar ao SolarDoc Pro</a>
        </div>
      </div>`,
  },
];

export async function sendNoContractsReminderEmail(email: string, userId: string, nome: string | null, variantIdx: number): Promise<void> {
  const tpl = noContractsEmails[variantIdx % noContractsEmails.length];
  await sendMarketingEmail({ to: email, userId, subject: tpl.subject, html: tpl.html(nome) });
}

// Variantes para a fase semanal (após 10 dias diários sem CNPJ).
// Tom diferente da sequência inicial — não fala "última mensagem" e não promete
// que vai parar, porque vai durar até 1 ano.
const cnpjOngoingEmails: Array<{ subject: string; html: string }> = [
  {
    subject: 'Seu CNPJ ainda não foi cadastrado no SolarDoc Pro',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Sua conta segue ativa, só faltou o CNPJ</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Seus 10 documentos gratuitos continuam te esperando. Em 30 segundos você cadastra o CNPJ e libera tudo.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Cadastrar meu CNPJ</a>
        </div>
      </div>`,
  },
  {
    subject: 'Quanto tempo você ainda vai gastar fazendo contrato no Word?',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Cada semana sem automatizar é tempo perdido</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">3 a 5 horas por semana é o que integradores perdem em formatação manual. Em 1 ano isso vira ~200 horas — uma equipe inteira de meio expediente.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Cadastra o CNPJ e libera os 10 docs grátis pra começar:</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Liberar acesso</a>
        </div>
      </div>`,
  },
  {
    subject: 'Lembrete: 10 documentos gratuitos te esperando',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Sem cartão, sem prazo, sem pegadinha</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Os 10 documentos gratuitos não expiram. Você usa quando quiser — só precisa cadastrar o CNPJ uma vez.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Ativar minha conta</a>
        </div>
      </div>`,
  },
  {
    subject: 'Novidades no SolarDoc Pro — vale dar uma olhada',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">A plataforma evoluiu desde a última vez</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Templates novos, geração ainda mais rápida e o Gerador de Proposta com a sua marca. Tudo isso libera com seu CNPJ.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Conhecer as novidades</a>
        </div>
      </div>`,
  },
  {
    subject: 'Seu concorrente já automatizou. E você?',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Velocidade fecha venda</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Quem responde a um pedido de orçamento em até 1h fecha 7x mais. SolarDoc Pro foi feito pra você ganhar essa janela.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Cadastrar CNPJ agora</a>
        </div>
      </div>`,
  },
];

export async function sendCnpjOngoingEmail(email: string, userId: string, variantIdx: number): Promise<void> {
  const tpl = cnpjOngoingEmails[variantIdx % cnpjOngoingEmails.length];
  await sendMarketingEmail({ to: email, userId, subject: tpl.subject, html: tpl.html });
}

// Recuperação pós-checkout PÚBLICO: pessoa passou o cartão (sub trialing criada)
// mas NÃO voltou pra concluir o cadastro — não existe linha em `users`. Sem userId,
// então é transacional 1-a-1 (sem footer de unsub, igual ao reset de senha).
// Disparado pelo webhook em checkout.session.completed quando o órfão é detectado.
export async function sendCheckoutCompletionEmail(opts: { to: string; sessionId: string; plano?: string | null }): Promise<void> {
  const planoLabel = opts.plano === 'ilimitado' ? 'VIP' : opts.plano === 'pro' ? 'PRO' : null;
  const completeUrl = `${APP_URL}/auth?mode=register&session=${encodeURIComponent(opts.sessionId)}`;
  const loginUrl = `${APP_URL}/auth`;
  // Tom A (transacional / "recibo de compra"): o CTA "definir senha" é o
  // protagonista absoluto (é o único passo que destrava a conta). Abaixo dele,
  // SECUNDÁRIOS e mais leves, vêm "o que te espera" + "instalar como app" — pra
  // plantar a semana de onboarding sem competir com o CTA. Quem paga e some
  // (maior fatia do churn silencioso) é justo quem precisa ver isso já aqui,
  // pois pode nunca chegar ao sendWelcomeEmail (que só dispara pós-signup).
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:32px 36px;">
    <p style="margin:0;color:#0f172a;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:26px;font-weight:900;line-height:1.2;letter-spacing:-0.5px;">
      Pagamento aprovado${planoLabel ? ` — acesso ${planoLabel} liberado` : ''} ✅
    </h1>
  </div>
  <div style="padding:32px 36px;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 18px;">
      <strong style="color:#fbbf24;">Pagamento aprovado!</strong> Seus <strong style="color:#fbbf24;">7 dias grátis</strong>${planoLabel ? ` no plano <strong style="color:#fbbf24;">${planoLabel}</strong>` : ''} já estão ativos.
    </p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Falta só <strong style="color:#f8fafc;">definir sua senha</strong> pra entrar na plataforma — seu e-mail e plano já estão garantidos. É 1 passo, leva 10 segundos:
    </p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${completeUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:18px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
        Definir senha e entrar →
      </a>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:20px 0 0;line-height:1.6;text-align:center;">
      Já definiu sua senha? É só entrar em <a href="${loginUrl}" style="color:#fbbf24;text-decoration:none;font-weight:700;">solardoc.app/auth</a>.
    </p>
  </div>

  <div style="padding:0 36px;"><div style="border-top:1px solid #1e293b;"></div></div>

  <div style="padding:26px 36px 6px;">
    <p style="margin:0 0 4px;color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Assim que entrar</p>
    <p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.7;">
      1️⃣ Cadastre o <strong style="color:#f8fafc;">CNPJ da empresa</strong> &nbsp;·&nbsp; 2️⃣ Suba <strong style="color:#f8fafc;">logo e cor</strong> &nbsp;·&nbsp; 3️⃣ Gere propostas e documentos com a <strong style="color:#f8fafc;">sua marca</strong>.
    </p>
  </div>

  <div style="padding:18px 36px 8px;">
    <p style="margin:0 0 10px;color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">📱 Deixe como app no celular</p>
    <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.7;">
      <strong style="color:#e2e8f0;">iPhone:</strong> abra no Safari → Compartilhar (↑) → "Adicionar à Tela de Início".<br/>
      <strong style="color:#e2e8f0;">Android:</strong> abra no Chrome → 3 pontinhos → "Instalar app".
    </p>
  </div>

  <div style="padding:18px 36px 28px;text-align:center;">
    <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
      Dúvidas? Chama a gente no WhatsApp (34) 99943-7831.
    </p>
  </div>
</div>`;
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    replyTo: REPLY_TO,
    subject: `✅ Pagamento aprovado — falta 1 passo pra entrar no SolarDoc${planoLabel ? ` ${planoLabel}` : ''}`,
    html,
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  try {
    console.log(`[Mailer] Tentando enviar reset para ${email}...`);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      replyTo: REPLY_TO,
      subject: 'Redefinição de senha — SolarDoc Pro',
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden;">
          <div style="background: #f59e0b; padding: 24px 32px;">
            <h1 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 800;">SolarDoc Pro</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #f8fafc; font-size: 18px; margin: 0 0 12px;">Redefinição de senha</h2>
            <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 28px;">
              Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha. O link expira em <strong style="color: #f8fafc;">1 hora</strong>.
            </p>
            <div style="text-align: center;">
              <a href="${resetUrl}" style="display: inline-block; background: #f59e0b; color: #0f172a; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; text-decoration: none;">
                Redefinir minha senha
              </a>
            </div>
            <p style="color: #475569; font-size: 12px; margin: 28px 0 0; line-height: 1.6;">
              Se você não solicitou a redefinição, ignore este email. Sua senha permanece a mesma.
            </p>
          </div>
        </div>
      `,
    });
    if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
    console.log(`[Mailer] E-mail enviado! ID: ${data?.id}`);
    return data;
  } catch (err) {
    console.error('[Mailer] Erro crítico no envio:', err);
    throw err;
  }
}

interface SuggestionEmailOptions {
  titulo: string;
  descricao: string;
  userEmail: string;
  arquivoNome?: string;
  arquivoBase64?: string;
}

export async function sendSuggestionEmail(opts: SuggestionEmailOptions) {
  const attachments: any[] = [];

  if (opts.arquivoBase64 && opts.arquivoNome) {
    // arquivoBase64 vem como data URL: "data:<mime>;base64,<dados>"
    const match = opts.arquivoBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      attachments.push({
        filename: opts.arquivoNome,
        content: Buffer.from(match[2], 'base64'),
        contentType: match[1],
      });
    }
  }

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: 'aiorosgroup@gmail.com',
    replyTo: opts.userEmail,
    subject: `💎 Sugestão VIP: ${opts.titulo}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <div style="background: #f59e0b; padding: 20px 28px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; color: #0F172A; font-size: 20px;">💎 Nova Sugestão VIP</h1>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 6px; font-size: 13px; color: #64748b;">De</p>
          <p style="margin: 0 0 20px; font-weight: 600;">${opts.userEmail}</p>

          <p style="margin: 0 0 6px; font-size: 13px; color: #64748b;">Título</p>
          <p style="margin: 0 0 20px; font-size: 18px; font-weight: 700;">${opts.titulo}</p>

          <p style="margin: 0 0 6px; font-size: 13px; color: #64748b;">Mensagem</p>
          <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; white-space: pre-wrap; line-height: 1.6;">
${opts.descricao}
          </div>

          ${opts.arquivoNome ? `
          <p style="margin: 0; font-size: 13px; color: #64748b;">
            📎 Arquivo anexado: <strong>${opts.arquivoNome}</strong>
          </p>` : '<p style="color: #94a3b8; font-size: 13px;">Sem arquivo anexado.</p>'}
        </div>
      </div>
    `,
    attachments,
  });
  if (error) throw new Error(`Resend error: ${error.name} - ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// EMAIL DE BOAS-VINDAS — disparado após signup com sucesso
// ════════════════════════════════════════════════════════════
export async function sendWelcomeEmail(opts: { to: string; userId: string; nome: string | null }): Promise<void> {
  const firstName = (opts.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">

  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:32px 36px;">
    <p style="margin:0;color:#0f172a;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:28px;font-weight:900;line-height:1.15;letter-spacing:-0.5px;">Bem-vindo, ${firstName}! 🌞</h1>
    <p style="margin:8px 0 0;color:#0f172a;font-size:15px;font-weight:600;opacity:0.85;">Seu acesso ao SolarDoc Pro já tá ativo.</p>
  </div>

  <div style="padding:32px 36px 24px;text-align:center;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 22px;">Te enviamos o link de acesso pra você salvar — use no celular ou no PC, do jeito que preferir.</p>
    <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:18px 44px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
      🔓 ENTRAR NA PLATAFORMA
    </a>
    <p style="margin:14px 0 0;color:#64748b;font-size:13px;">solardoc.app/auth</p>
  </div>

  <div style="padding:0 36px;"><div style="border-top:1px solid #1e293b;"></div></div>

  <div style="padding:28px 36px 8px;">
    <p style="margin:0 0 4px;color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Seu acesso grátis</p>
    <h2 style="margin:0 0 18px;color:#f8fafc;font-size:20px;font-weight:800;line-height:1.3;">10 documentos grátis + Gerador de Proposta com a sua marca</h2>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 18px;">Você já pode gerar contratos, procurações, propostas bancárias e a <strong style="color:#fbbf24;">proposta solar personalizada</strong> — com a sua logo, sua cor e suas fotos de portfólio.</p>
    <div style="background:#1e293b;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:18px 22px;margin:0 0 8px;">
      <p style="margin:0 0 6px;color:#f59e0b;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Próximo passo</p>
      <p style="margin:0;color:#e2e8f0;font-size:14.5px;line-height:1.6;">Cadastre o <strong style="color:#f8fafc;">CNPJ da sua empresa</strong> dentro da plataforma para liberar os 10 documentos gratuitos e personalizar o gerador com sua marca.</p>
    </div>
  </div>

  <div style="padding:0 36px;"><div style="border-top:1px solid #1e293b;margin-top:20px;"></div></div>

  <div style="padding:28px 36px 16px;">
    <p style="margin:0 0 4px;color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Instalar como app</p>
    <h2 style="margin:0 0 22px;color:#f8fafc;font-size:20px;font-weight:800;line-height:1.3;">Em 1 toque vira ícone na tua tela</h2>
  </div>

  <div style="margin:0 24px 12px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #f59e0b;">
    <p style="margin:0 0 6px;color:#fbbf24;font-size:14px;font-weight:800;">📱 iPhone / iPad</p>
    <p style="margin:0 0 8px;color:#e2e8f0;font-size:14px;line-height:1.6;">Abre o link no <strong style="color:#f8fafc;">Safari</strong> (não Chrome!):</p>
    <ol style="margin:0;padding-left:20px;color:#cbd5e1;font-size:13px;line-height:1.7;">
      <li>Toca no botão <strong>Compartilhar</strong> (quadrado com seta pra cima ↑)</li>
      <li>Rola e escolhe <strong>"Adicionar à Tela de Início"</strong></li>
      <li>Confirma. Ícone do SolarDoc aparece na sua home.</li>
    </ol>
  </div>

  <div style="margin:0 24px 12px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #10b981;">
    <p style="margin:0 0 6px;color:#34d399;font-size:14px;font-weight:800;">📱 Android</p>
    <p style="margin:0 0 8px;color:#e2e8f0;font-size:14px;line-height:1.6;">Abre o link no <strong style="color:#f8fafc;">Chrome</strong>:</p>
    <ol style="margin:0;padding-left:20px;color:#cbd5e1;font-size:13px;line-height:1.7;">
      <li>Toca nos <strong>3 pontinhos</strong> do menu</li>
      <li>Escolhe <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong></li>
      <li>Confirma. Pronto, app na home.</li>
    </ol>
  </div>

  <div style="margin:0 24px 8px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #0ea5e9;">
    <p style="margin:0 0 6px;color:#38bdf8;font-size:14px;font-weight:800;">💻 Computador (Windows / Mac)</p>
    <p style="margin:0 0 12px;color:#e2e8f0;font-size:14px;line-height:1.6;">Duas opções — escolhe a que preferir:</p>

    <div style="background:#0f172a;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <p style="margin:0 0 4px;color:#f8fafc;font-size:13px;font-weight:700;">⭐ Opção 1 — Favoritar (rápido)</p>
      <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.6;">No navegador, aperta <kbd style="background:#334155;color:#f8fafc;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:12px;">Ctrl + D</kbd> <span style="color:#64748b;">(Cmd+D no Mac)</span> → renomeia pra "SolarDoc" → salva na <strong>Barra de Favoritos</strong>.</p>
    </div>

    <div style="background:#0f172a;border-radius:8px;padding:12px 14px;">
      <p style="margin:0 0 4px;color:#f8fafc;font-size:13px;font-weight:700;">🚀 Opção 2 — Instalar como app (PWA)</p>
      <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.6;">No Chrome ou Edge, clica no ícone <strong>"+"</strong> na barra de endereço (ou Menu → "Instalar SolarDoc Pro"). Vira app de verdade — janela própria, atalho na área de trabalho.</p>
    </div>
  </div>

  <div style="padding:24px 36px 28px;text-align:center;">
    <p style="margin:0 0 6px;color:#94a3b8;font-size:14px;">Travou em algo? Chama a gente.</p>
    <p style="margin:0;color:#f8fafc;font-size:15px;font-weight:700;">📞 (34) 99943-7831</p>
    <p style="margin:18px 0 0;color:#475569;font-size:13px;">Bom uso! 🚀<br/><span style="color:#64748b;">Equipe SolarDoc Pro</span></p>
  </div>

</div>
`;

  await sendMarketingEmail({
    to: opts.to,
    userId: opts.userId,
    subject: `🌞 Bem-vindo ao SolarDoc Pro, ${firstName} — seu acesso já tá ativo`,
    html,
  });
}

// Email de boas-vindas para quem COMPROU (PRO/VIP). Transacional: confirma a
// compra, o plano, e dá as instruções de início. NÃO usa o copy de "10 grátis"
// (esse é do cadastro FREE). Suporte direto = Giovanna / (34) 99816-5040.
export async function sendPurchaseEmail(opts: { to: string; userId: string; nome: string | null; plano: string }): Promise<void> {
  const firstName = (opts.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const planoLabel = opts.plano === 'ilimitado' ? 'VIP' : 'PRO';
  const planoDesc = opts.plano === 'ilimitado'
    ? 'Documentos <strong style="color:#fbbf24;">ilimitados</strong> + Gerador de Proposta com a sua marca'
    : '90 documentos/mês + Gerador de Proposta com a sua marca';
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">

  <div style="background:linear-gradient(135deg,#f59e0b 0%,#fbbf24 100%);padding:32px 36px;">
    <p style="margin:0;color:#0f172a;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">SolarDoc Pro · Plano ${planoLabel}</p>
    <h1 style="margin:8px 0 0;color:#0f172a;font-size:28px;font-weight:900;line-height:1.15;letter-spacing:-0.5px;">Compra confirmada, ${firstName}! 🎉</h1>
    <p style="margin:8px 0 0;color:#0f172a;font-size:15px;font-weight:600;opacity:0.85;">Obrigada pela confiança. Seu plano ${planoLabel} já tá ativo.</p>
  </div>

  <div style="padding:32px 36px 24px;text-align:center;">
    <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 22px;">Entre com o <strong style="color:#f8fafc;">e-mail e a senha</strong> que você cadastrou:</p>
    <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:900;font-size:16px;padding:18px 44px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
      🔓 ENTRAR NA PLATAFORMA
    </a>
    <p style="margin:14px 0 0;color:#64748b;font-size:13px;">solardoc.app/auth</p>
  </div>

  <div style="padding:0 36px;"><div style="border-top:1px solid #1e293b;"></div></div>

  <div style="padding:28px 36px 8px;">
    <p style="margin:0 0 4px;color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Seu plano ${planoLabel}</p>
    <h2 style="margin:0 0 18px;color:#f8fafc;font-size:20px;font-weight:800;line-height:1.3;">${planoDesc}</h2>
    <div style="background:#1e293b;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:18px 22px;margin:0 0 8px;">
      <p style="margin:0 0 6px;color:#f59e0b;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Primeiro passo — faça agora</p>
      <p style="margin:0 0 6px;color:#e2e8f0;font-size:14.5px;line-height:1.6;">1️⃣ Cadastre o <strong style="color:#f8fafc;">CNPJ da sua empresa</strong> em <strong>Empresa</strong>.</p>
      <p style="margin:0 0 6px;color:#e2e8f0;font-size:14.5px;line-height:1.6;">2️⃣ Suba sua <strong style="color:#f8fafc;">logo, cor e fotos</strong> — todo documento e proposta sai com a sua marca.</p>
      <p style="margin:0;color:#e2e8f0;font-size:14.5px;line-height:1.6;">3️⃣ Pronto: gere contratos, procurações e propostas solares personalizadas.</p>
    </div>
  </div>

  <div style="padding:0 36px;"><div style="border-top:1px solid #1e293b;margin-top:20px;"></div></div>

  <!-- UPSELL TRÁFEGO — diagnóstico, NÃO oferta. Pergunta planta a semente; o pacote
       é escolhido na REUNIÃO. Sem tabela de preços (ancoraria a relação em R$2k antes
       de sentir a plataforma). Só: pergunta + diferencial (leads no Gerador) + ancora
       leve + CTA de call. Ativação acima continua sendo o protagonista. -->
  <div style="padding:28px 36px 4px;">
    <p style="margin:0 0 4px;color:#34d399;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Uma pergunta que pode mudar seu faturamento</p>
    <h2 style="margin:0 0 14px;color:#f8fafc;font-size:20px;font-weight:800;line-height:1.3;">Você tem o melhor tráfego pago da sua região?</h2>
    <p style="margin:0 0 14px;color:#cbd5e1;font-size:14.5px;line-height:1.7;">Quando alguém na sua cidade pesquisa <strong style="color:#f8fafc;">"energia solar"</strong>, é o <strong style="color:#f8fafc;">seu</strong> anúncio que aparece primeiro? Ou é do concorrente?</p>
    <p style="margin:0 0 16px;color:#cbd5e1;font-size:14.5px;line-height:1.7;">A gente faz tráfego pago pro nosso próprio negócio de solar — e dá pra montar isso pra você com uma vantagem que nenhuma agência tem: <strong style="color:#34d399;">os leads caem direto aqui no seu Gerador</strong>, prontos pra virar proposta na hora.</p>
    <div style="background:#0f231a;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 18px;">
      <p style="margin:0;color:#cbd5e1;font-size:13.5px;line-height:1.6;">Gestão a partir de <strong style="color:#34d399;">R$ 997/mês</strong> + a verba de anúncio que você escolher. Temos pacotes do "testar" ao "dominar a cidade" — eu te mostro qual encaixa numa call rápida.</p>
    </div>
    <div style="text-align:center;margin:0 0 4px;">
      <a href="https://wa.me/5534998165040?text=${encodeURIComponent('Oi! Quero saber sobre o tráfego pago pra minha região')}" style="display:inline-block;background:#10b981;color:#0f172a;font-weight:900;font-size:15px;padding:15px 36px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(16,185,129,0.35);">📲 Quero marcar uma call de 20 min →</a>
    </div>
  </div>

  <div style="padding:24px 36px 0;"><div style="border-top:1px solid #1e293b;"></div></div>

  <div style="padding:28px 36px 16px;">
    <p style="margin:0 0 4px;color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Instalar como app</p>
    <h2 style="margin:0 0 22px;color:#f8fafc;font-size:20px;font-weight:800;line-height:1.3;">Em 1 toque vira ícone na tua tela</h2>
  </div>

  <div style="margin:0 24px 12px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #f59e0b;">
    <p style="margin:0 0 6px;color:#fbbf24;font-size:14px;font-weight:800;">📱 iPhone / iPad</p>
    <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.7;">Abre o link no <strong style="color:#f8fafc;">Safari</strong> → botão <strong>Compartilhar</strong> (↑) → <strong>"Adicionar à Tela de Início"</strong>.</p>
  </div>

  <div style="margin:0 24px 12px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #10b981;">
    <p style="margin:0 0 6px;color:#34d399;font-size:14px;font-weight:800;">📱 Android</p>
    <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.7;">Abre no <strong style="color:#f8fafc;">Chrome</strong> → <strong>3 pontinhos</strong> → <strong>"Instalar app"</strong>.</p>
  </div>

  <div style="margin:0 24px 8px;background:#1e293b;border-radius:12px;padding:20px 22px;border-left:4px solid #0ea5e9;">
    <p style="margin:0 0 6px;color:#38bdf8;font-size:14px;font-weight:800;">💻 Computador</p>
    <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.7;">No Chrome ou Edge, clica no ícone <strong>"+"</strong> na barra de endereço (ou Menu → "Instalar SolarDoc Pro").</p>
  </div>

  <div style="padding:24px 36px 28px;text-align:center;">
    <p style="margin:0 0 6px;color:#94a3b8;font-size:14px;">Qualquer dúvida, fala com a Giovanna — respondo rápido:</p>
    <p style="margin:0;color:#f8fafc;font-size:15px;font-weight:700;">📞 (34) 99816-5040</p>
    <p style="margin:18px 0 0;color:#475569;font-size:13px;">Boas vendas! 🚀<br/><span style="color:#64748b;">Giovanna · Equipe SolarDoc Pro</span></p>
  </div>

</div>
`;

  await sendMarketingEmail({
    to: opts.to,
    userId: opts.userId,
    subject: `🎉 Compra confirmada, ${firstName} — seu plano ${planoLabel} no SolarDoc Pro já tá ativo`,
    html,
  });
}
