import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT?.trim()) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER?.trim(),
    pass: process.env.SMTP_PASS?.trim(),
  },
});

const APP_URL = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://solardocs-dashboard.vercel.app';

const followupEmails: Record<number, { subject: string; html: string }> = {
  1: {
    subject: 'Falta só 1 passo para começar no SolarDoc Pro',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Você está a 1 passo de transformar sua operação</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Olá! Percebemos que você criou sua conta mas ainda não informou o CNPJ da sua empresa.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Com o CNPJ cadastrado, você já pode gerar contratos, procurações, propostas bancárias e muito mais — tudo em menos de 2 minutos, sem retrabalho.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Completar meu cadastro agora</a>
          <p style="color:#475569;font-size:13px;margin:32px 0 0;line-height:1.6;">Criado por integradores solares com mais de 8 anos de mercado. Sabemos exatamente o que você precisa.</p>
        </div>
      </div>`,
  },
  2: {
    subject: 'Quanto tempo você perde com contratos por mês?',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Cada contrato manual custa tempo que você não tem</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Integradores que trabalham sem ferramenta certa perdem em média <strong style="color:#f59e0b;">3 a 5 horas por semana</strong> só formatando e revisando documentos.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 16px;">Com o SolarDoc Pro você:</p>
          <ul style="color:#94a3b8;font-size:15px;line-height:2;margin:0 0 28px;padding-left:20px;">
            <li>Gera contratos completos em menos de 2 minutos</li>
            <li>Preenche os dados do cliente uma vez e reutiliza em todos os documentos</li>
            <li>Envia para assinatura digital direto da plataforma</li>
            <li>Mantém todo o histórico organizado em um só lugar</li>
          </ul>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Ativar minha conta gratuitamente</a>
          <p style="color:#475569;font-size:13px;margin:32px 0 0;">Seu teste gratuito inclui 10 documentos sem precisar de cartão de crédito.</p>
        </div>
      </div>`,
  },
  3: {
    subject: '8 anos no setor solar nos ensinaram uma coisa',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Criado por quem vive o mesmo mercado que você</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">O SolarDoc Pro não foi criado por uma startup de tecnologia que nunca instalou um painel. Foi criado por <strong style="color:#f59e0b;">integradores solares com 8 anos de mercado</strong> que se cansaram de usar Word, PDF genérico e planilha para fechar negócio.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">Sabemos o que um contrato de sistema solar precisa ter. Sabemos o que os bancos exigem numa proposta. Sabemos o que a ANEEL pede numa procuração de acesso.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Por isso cada documento na plataforma já nasce correto, completo e profissional — você só preenche os dados.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Começar meu teste gratuito</a>
        </div>
      </div>`,
  },
  4: {
    subject: '5 documentos que você pode gerar em menos de 2 minutos',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Tudo que você precisa, pronto para assinar</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 24px;">Veja o que você pode gerar hoje mesmo, sem modelo no Google Drive, sem copiar e colar:</p>
          <div style="margin:0 0 12px;">
            <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
              <span style="color:#f59e0b;font-size:20px;margin-right:14px;">⚡</span>
              <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Contrato de Instalação Solar</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Completo, com cláusulas de garantia e responsabilidade técnica</p></div>
            </div>
            <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
              <span style="color:#f59e0b;font-size:20px;margin-right:14px;">🏦</span>
              <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Proposta Bancária (Financiamento)</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Formatada para aprovação em bancos e fintechs do setor</p></div>
            </div>
            <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
              <span style="color:#f59e0b;font-size:20px;margin-right:14px;">📋</span>
              <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Procuração de Acesso à Distribuidora</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Modelo aceito pelas principais distribuidoras do Brasil</p></div>
            </div>
            <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
              <span style="color:#f59e0b;font-size:20px;margin-right:14px;">💼</span>
              <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Contrato PJ (Pessoa Jurídica)</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Para clientes empresa com CNPJ</p></div>
            </div>
            <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;">
              <span style="color:#f59e0b;font-size:20px;margin-right:14px;">🤝</span>
              <div><p style="margin:0;color:#f8fafc;font-weight:700;font-size:14px;">Contrato de Prestação de Serviço</p><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Para O&M, manutenção e monitoramento</p></div>
            </div>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;margin-top:8px;">Quero gerar meu primeiro documento</a>
        </div>
      </div>`,
  },
  5: {
    subject: 'Seu teste gratuito ainda está esperando por você',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">10 documentos gratuitos, sem cartão, sem prazo</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Você tem <strong style="color:#f59e0b;">10 documentos gratuitos</strong> esperando por você na plataforma. Sem cartão de crédito. Sem período de expiração do trial. Você usa quando quiser.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">Só precisa do CNPJ da sua empresa para ativar. É o único dado que falta.</p>
          <div style="background:#1e293b;border-radius:12px;padding:24px;margin:0 0 28px;">
            <p style="color:#f59e0b;font-weight:700;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">O que você ganha de graça</p>
            <p style="color:#94a3b8;font-size:14px;line-height:2;margin:0;">✓ 10 documentos gerados por IA<br>✓ Histórico de todos os documentos<br>✓ Assinatura digital via Autentique<br>✓ Cadastro ilimitado de clientes</p>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Ativar meu teste gratuito</a>
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
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Hoje fazem isso direto do celular, em menos de 2 minutos, com link de assinatura digital incluído.</p>
          <div style="background:#1e293b;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:20px 24px;margin:0 0 28px;">
            <p style="color:#e2e8f0;font-style:italic;font-size:15px;line-height:1.7;margin:0;">"A ferramenta foi feita por quem entende do setor. Os documentos já saem corretos, não preciso revisar nada."</p>
            <p style="color:#64748b;font-size:13px;margin:12px 0 0;">— Integrador solar, 8 anos de mercado</p>
          </div>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;padding:16px 36px;border-radius:10px;text-decoration:none;">Quero essa agilidade também</a>
        </div>
      </div>`,
  },
  7: {
    subject: 'Último lembrete — seu acesso gratuito ainda está aqui',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;">
        <div style="background:#f59e0b;padding:28px 36px;">
          <p style="margin:0;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SolarDoc Pro</p>
          <h1 style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:900;line-height:1.2;">Vai deixar o mercado te passar na frente?</h1>
        </div>
        <div style="padding:36px;">
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Essa é nossa última mensagem por agora. Sua conta foi criada há 7 dias e o CNPJ da empresa ainda não foi informado.</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">O SolarDoc Pro foi construído ao longo de 8 anos de experiência real como integradores para resolver o problema que todo integrador enfrenta: <strong style="color:#f8fafc;">burocracia que consome tempo de venda.</strong></p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Seus 10 documentos gratuitos continuam disponíveis. Basta informar o CNPJ e começar.</p>
          <a href="${APP_URL}/auth" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:16px;padding:18px 40px;border-radius:10px;text-decoration:none;">Ativar agora — é grátis</a>
          <p style="color:#334155;font-size:12px;margin:36px 0 0;line-height:1.6;">Não quer mais receber esses emails? Basta ignorar — só enviaremos comunicações importantes da sua conta a partir de agora.</p>
        </div>
      </div>`,
  },
};

export async function sendFollowupEmail(email: string, day: number): Promise<void> {
  const template = followupEmails[day];
  if (!template) return;

  await transporter.sendMail({
    from: `"SolarDoc Pro" <${process.env.SMTP_USER}>`,
    to: email,
    subject: template.subject,
    html: template.html,
  });
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
            <li>Contrato PJ</li>
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

export async function sendNoContractsReminderEmail(email: string, nome: string | null, variantIdx: number): Promise<void> {
  const tpl = noContractsEmails[variantIdx % noContractsEmails.length];
  await transporter.sendMail({
    from: `"SolarDoc Pro" <${process.env.SMTP_USER}>`,
    to: email,
    subject: tpl.subject,
    html: tpl.html(nome),
  });
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
          <p style="color:#e2e8f0;font-size:16px;line-height:1.7;margin:0 0 20px;">Templates novos, geração ainda mais rápida e assinatura digital integrada. Tudo isso libera com seu CNPJ.</p>
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

export async function sendCnpjOngoingEmail(email: string, variantIdx: number): Promise<void> {
  const tpl = cnpjOngoingEmails[variantIdx % cnpjOngoingEmails.length];
  await transporter.sendMail({
    from: `"SolarDoc Pro" <${process.env.SMTP_USER}>`,
    to: email,
    subject: tpl.subject,
    html: tpl.html,
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  try {
    console.log(`[Mailer] Tentando enviar reset para ${email}...`);
    const info = await transporter.sendMail({
      from: `"SolarDoc Pro" <${process.env.SMTP_USER?.trim()}>`,
      to: email,
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
    console.log(`[Mailer] E-mail enviado! ID: ${info.messageId}`);
    return info;
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
        content: match[2],
        encoding: 'base64',
        contentType: match[1],
      });
    }
  }

  await transporter.sendMail({
    from: `"SolarDoc Pro" <${process.env.SMTP_USER}>`,
    to: 'agenntaix@gmail.com',
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
}
