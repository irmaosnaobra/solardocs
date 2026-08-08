'use client';

// Link único de "quero pagar por Pix", usado nas três telas onde o cliente sem
// cartão trava: modal de upgrade, free esgotado e conta suspensa.
//
// Enquanto o trilho recorrente está dark (sem conta Asaas ligada), ele NÃO pode
// apontar pra uma tela que responde "ainda não está no ar" — quem clica aqui
// está com a carteira na mão. Sem a variável, o link vai pro WhatsApp do
// atendimento, que é o Pix que funciona hoje (liberação na hora pelo comprovante).
// Com NEXT_PUBLIC_PIX_RECORRENTE=on, passa a levar pra assinatura por Pix.

export const pixRecorrenteLigado = process.env.NEXT_PUBLIC_PIX_RECORRENTE === 'on';

const WHATS_PIX = `https://wa.me/5534998165040?text=${encodeURIComponent('Oi! Quero assinar o SolarDoc pagando por Pix.')}`;

export function hrefPagarPix(): string {
  return pixRecorrenteLigado ? '/pix-recorrente' : WHATS_PIX;
}

interface Props {
  className?: string;
  style?: React.CSSProperties;
  texto?: string;
}

export default function LinkPagarPix({ className, style, texto }: Props) {
  const ligado = pixRecorrenteLigado;
  return (
    <a
      className={className}
      style={style}
      href={hrefPagarPix()}
      {...(ligado ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
    >
      {texto ?? (ligado ? 'Não tem cartão? Assine pagando por Pix' : 'Não tem cartão? Pague por Pix pelo WhatsApp')}
    </a>
  );
}
