'use client';

// As peças da espera do Pix automático, iguais nas três telas React (modal da
// LP, /pix-automatico e /pix-recorrente). Cada tela põe as cores dela pelas
// variáveis --pix-* (ver PixEstados.module.css) e passa a classe do próprio botão.

import { useEffect, useRef } from 'react';
import { B64_RE, TXT_PIX, corpoSemPagamento, pixAcessoLiberado, qrSrc, type FimPix, type PixStatus } from '@/lib/pixEspera';
import s from './PixEstados.module.css';

type Nivel = 'h1' | 'h2';

function useChegou<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calmo ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, []);
  return ref;
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

// ── Pix pago ─────────────────────────────────────────────────────────────────
interface PagoProps {
  dados: PixStatus | null;
  pagoAoReabrir: boolean;
  demorou?: boolean; // pago, mas o acesso não saiu em 15 min: troca o giro por um bloco final
  temConta: boolean;
  hrefConta: string; // para onde vai o botão (criar senha ou entrar)
  hrefEntrar?: string; // botão do bloco "demorou" (sem isso, usa hrefConta quando já tem conta ou é tela logada, senão /auth?mode=login)
  classeBotao: string;
  nivel?: Nivel;
  idTitulo?: string;
  // Tela logada: a pessoa já está dentro, então não há senha a criar nem login a fazer.
  logado?: boolean;
}

export function PixPagoBloco({ dados, pagoAoReabrir, demorou, temConta, hrefConta, hrefEntrar, classeBotao, nivel = 'h2', idTitulo, logado }: PagoProps) {
  const foco = useChegou<HTMLDivElement>();
  const liberado = pixAcessoLiberado(dados);
  const Titulo = nivel;
  const corpo = logado
    ? 'Recebemos seu pagamento. Seu acesso já está liberado.'
    : temConta ? TXT_PIX.pagoContaExiste : TXT_PIX.pagoContaNova;
  const final = liberado || Boolean(demorou); // com o giro só enquanto ainda dá para esperar
  const botaoHref = liberado ? hrefConta : (hrefEntrar ?? (logado || temConta ? hrefConta : '/auth?mode=login'));
  const botaoTexto = liberado && !logado && !temConta ? TXT_PIX.criarSenha : TXT_PIX.entrar;
  const corpoDemora = logado || temConta ? TXT_PIX.pagoDemoraConta : TXT_PIX.pagoDemoraNova;
  return (
    <section className={s.pago} aria-labelledby={idTitulo}>
      <div className={s.selo} aria-hidden="true"><span className={s.seloDisco}><Check /></span></div>
      <div ref={foco} className={s.pagoStatus} role="status" tabIndex={-1}>
        <Titulo id={idTitulo} className={s.pagoTitulo}>{TXT_PIX.pagoTitulo}</Titulo>
        {pagoAoReabrir && <p className={s.retomado}>{TXT_PIX.retomado}</p>}
        {liberado ? (
          <p className={s.pagoTexto}>{corpo}</p>
        ) : demorou ? (
          <p className={s.pagoTexto}>{corpoDemora}</p>
        ) : (
          <>
            <p className={s.pagoTexto}>{TXT_PIX.pagoLiberando}</p>
            <p className={s.passo}><span className={s.spin} aria-hidden="true" />{TXT_PIX.pagoLiberandoPasso}</p>
          </>
        )}
      </div>
      {final && (
        <a className={`${classeBotao} ${s.botao}`} href={botaoHref}>
          {botaoTexto}
        </a>
      )}
    </section>
  );
}

// ── Vencido ou recusado, sem pagamento ───────────────────────────────────────
interface FimProps {
  fim: FimPix;
  nadaCobrado: boolean;
  classeBotao: string;
  classeBotao2: string;
  onGerar: () => void;
  gerando?: boolean;
  cartao?: { href: string } | { onClick: () => void } | null; // sem caminho de cartão: null
  nivel?: Nivel;
  idTitulo?: string;
}

export function PixSemPagamentoBloco({ fim, nadaCobrado, classeBotao, classeBotao2, onGerar, gerando, cartao, nivel = 'h2', idTitulo }: FimProps) {
  const foco = useChegou<HTMLDivElement>();
  const Titulo = nivel;
  return (
    <section className={s.fim} aria-labelledby={idTitulo}>
      <div className={s.fimIcone} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
      </div>
      <div ref={foco} className={s.pagoStatus} role="status" tabIndex={-1}>
        <Titulo id={idTitulo} className={s.fimTitulo}>{fim === 'vencido' ? TXT_PIX.vencidoTitulo : TXT_PIX.recusadoTitulo}</Titulo>
        <p className={s.pagoTexto}>{corpoSemPagamento(fim, nadaCobrado, Boolean(cartao))}</p>
      </div>
      <button type="button" className={`${classeBotao} ${s.botao}`} onClick={onGerar} disabled={gerando}>
        {TXT_PIX.gerarOutro}
      </button>
      {cartao && ('href' in cartao ? (
        <a className={`${classeBotao2} ${s.botao2}`} href={cartao.href}>{TXT_PIX.pagarCartao}</a>
      ) : (
        <button type="button" className={`${classeBotao2} ${s.botao2}`} onClick={cartao.onClick}>{TXT_PIX.pagarCartao}</button>
      ))}
    </section>
  );
}

// ── Esperando: aviso vivo + código e QR ──────────────────────────────────────
export function PixEsperaAviso({ semConexao }: { semConexao: boolean }) {
  return (
    <div className={s.espera} role="status">
      <span className={s.spin} aria-hidden="true" />
      <div>
        <p className={s.esperaTexto}>{TXT_PIX.esperandoCorpo}</p>
        {semConexao && <p className={s.semConexao}>{TXT_PIX.semConexao}</p>}
      </div>
    </div>
  );
}

interface CodigoProps {
  payload: string;
  imagem: string; // base64, ou ''
  validade: string; // "hoje às 14:30", ou ''
  copiado: boolean;
  onCopiar: () => void;
  classeBotao: string;
  idCodigo: string;
}

export function PixCodigoBloco({ payload, imagem, validade, copiado, onCopiar, classeBotao, idCodigo }: CodigoProps) {
  const imgOk = Boolean(imagem) && B64_RE.test(imagem);
  return (
    <div className={s.codigoBloco}>
      <div className={s.codigoGrade}>
      <div className={s.codigoLado}>
        <button type="button" className={`${classeBotao} ${s.botao}`} onClick={onCopiar}>
          {copiado ? TXT_PIX.copiado : TXT_PIX.copiar}
        </button>
        {validade && <p className={s.validade}>Este código vale até {validade}</p>}
        <label className={s.rotulo} htmlFor={idCodigo}>Pix copia e cola</label>
        <textarea
          id={idCodigo}
          className={s.codigo}
          readOnly
          rows={3}
          value={payload}
          spellCheck={false}
          translate="no"
          onFocus={(e) => e.currentTarget.select()}
        />
        {!imgOk && <p className={s.apoio}>{TXT_PIX.esperandoApoio}</p>}
      </div>
      {imgOk && (
        <figure className={s.qrFig}>
          <img className={s.qr} src={qrSrc(imagem)} alt="QR Code do Pix automático" width={176} height={176} />
          <figcaption className={s.apoio}>{TXT_PIX.esperandoApoio}</figcaption>
        </figure>
      )}
      </div>
    </div>
  );
}
