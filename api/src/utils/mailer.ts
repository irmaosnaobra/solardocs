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
