'use client';

// O cartão da espera do Pix nas telas claras (/pix-automatico e /pix-recorrente):
// esperando (aviso, código e QR), Pix pago, ou vencido/recusado sem pagamento.
// Cada tela passa as próprias classes; a lógica vem de usePixEspera.

import type { EstadoPix } from '@/lib/pixEspera';
import { TXT_PIX } from '@/lib/pixEspera';
import { PixCodigoBloco, PixEsperaAviso, PixPagoBloco, PixSemPagamentoBloco } from './PixEstados';

interface Props {
  est: EstadoPix;
  payload: string;
  imagem: string;
  validade: string;
  instrucao: string;
  copiado: boolean;
  onCopiar: () => void;
  temConta: boolean;
  hrefConta: string;
  logado?: boolean;
  onGerar: () => void;
  cartao: { href: string } | null;
  css: { card: string; titulo: string; texto: string; btn: string; btn2: string };
}

export default function PixCartao(p: Props) {
  const { est, css } = p;
  if (est.fase === 'pago') {
    return (
      <div className={css.card}>
        <PixPagoBloco
          dados={est.dados}
          pagoAoReabrir={est.pagoAoReabrir}
          demorou={est.demorou}
          temConta={p.temConta}
          logado={p.logado}
          hrefConta={p.hrefConta}
          classeBotao={css.btn}
          nivel="h1"
        />
      </div>
    );
  }
  if (est.fase === 'encerrado') {
    return (
      <div className={css.card}>
        <PixSemPagamentoBloco
          fim={est.fim}
          nadaCobrado={est.nadaCobrado}
          classeBotao={css.btn}
          classeBotao2={css.btn2}
          onGerar={p.onGerar}
          cartao={p.cartao}
          nivel="h1"
        />
      </div>
    );
  }
  return (
    <div className={css.card}>
      <h1 className={css.titulo}>{TXT_PIX.esperandoTitulo}</h1>
      <PixEsperaAviso semConexao={est.semConexao} />
      <PixCodigoBloco
        payload={p.payload || est.dados?.qrPayload || ''}
        imagem={p.imagem || est.dados?.qrImagemBase64 || ''}
        validade={p.validade}
        copiado={p.copiado}
        onCopiar={p.onCopiar}
        classeBotao={css.btn}
        idCodigo="pix-codigo"
      />
      {p.instrucao && <p className={css.texto}>{p.instrucao}</p>}
    </div>
  );
}
