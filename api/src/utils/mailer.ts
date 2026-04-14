import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await transporter.sendMail({
    from: `"SolarDoc Pro" <${process.env.SMTP_USER}>`,
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
          <a href="${resetUrl}" style="display: inline-block; background: #f59e0b; color: #0f172a; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; text-decoration: none;">
            Redefinir minha senha
          </a>
          <p style="color: #475569; font-size: 12px; margin: 28px 0 0; line-height: 1.6;">
            Se você não solicitou a redefinição, ignore este email. Sua senha permanece a mesma.
          </p>
        </div>
      </div>
    `,
  });
}

interface SuggestionEmailOptions {
  titulo: string;
  descricao: string;
  userEmail: string;
  arquivoNome?: string;
  arquivoBase64?: string;
}

export async function sendSuggestionEmail(opts: SuggestionEmailOptions) {
  const attachments: nodemailer.Attachment[] = [];

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
