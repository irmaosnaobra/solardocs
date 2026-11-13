'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, ChevronRight, Copy, CreditCard, Lock, QrCode } from 'lucide-react';
import { Caixa, Topo, copiarTexto } from '@/components/CheckoutPix/CheckoutPix';
import { recarregarAcessos } from '@/hooks/useAcessos';
import { cpfValido, maskCpf, soDigitos } from '@/utils/documento';
import { brl, PRODUTOS_DA_LOJA, produtoDaLoja } from '@/lib/loja/catalogo';
import { MSG, srcDoQr } from '@/lib/loja/pix';
import {
  ativoQueCobre, comprarAdicional, cpfSalvo, fraseDoErro, recarregarAdicionais, useOfertaAdicionais,
  type ItemAdicional, type QrDoAdicional,
} from '@/lib/loja/adicionais';
import s from '@/components/CheckoutPix/CheckoutPix.module.css';
import a from './CheckoutAdicional.module.css';

/**
 * O CHECKOUT DO ADICIONAL MENSAL, dentro do app (só com a oferta ligada).
 *
 * Primeiro a pessoa escolhe o meio. Cartão: a api devolve o Checkout da Stripe (a tela vai para lá) ou `ok` quando o
 * item entrou na assinatura que ela já tem. Pix: pede o CPF (ou usa o que ela já usou na loja), mostra o QR da
 * autorização do Pix Automático e confere sozinha, de 4 em 4 segundos, até o adicional aparecer ativo.
 *
 * Mesma caixa do checkout Pix de compra única (foco preso, Escape, rolagem travada).
 */

const INTERVALO_MS = 4000;
const TETO_MS = 10 * 60 * 1000;

const ERRO_CARTAO = 'Não consegui abrir o pagamento. Tenta de novo, ou chama a gente no WhatsApp (34) 99816-5040.';

type Fase = 'meio' | 'cartao' | 'cpf' | 'gerando' | 'pix' | 'ok';

export default function CheckoutAdicional({ item, onFechar, onConfirmado }: {
  item: ItemAdicional;
  onFechar: () => void;
  onConfirmado?: (item: string) => void;
}) {
  const oferta = useOfertaAdicionais();
  const caixaRef = useRef<HTMLDivElement>(null);
  const [fase, setFase] = useState<Fase>('meio');
  const [banner, setBanner] = useState('');
  const [cpf, setCpf] = useState('');
  const [cpfErro, setCpfErro] = useState(false);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [qr, setQr] = useState<QrDoAdicional | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [naoVimos, setNaoVimos] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const confirmou = useRef(false);

  const pacote = item === 'pacote';
  const produto = pacote ? null : produtoDaLoja(item);
  const nome = pacote ? 'As 4 ferramentas' : produto?.nome ?? 'A ferramenta';
  const valor = pacote ? oferta.precos.pacoteApp : oferta.precos.avulso;

  // A cada troca de fase o foco volta para a caixa: o botão que estava em foco some.
  useEffect(() => { caixaRef.current?.focus(); }, [fase]);

  const confirmar = useCallback(() => {
    if (confirmou.current) return;
    confirmou.current = true;
    setFase('ok');
    recarregarAcessos(true);
    window.setTimeout(() => recarregarAcessos(true), 4000);
    onConfirmado?.(item);
  }, [item, onConfirmado]);

  /** Pergunta à api se o adicional já está ativo. */
  const conferir = useCallback(async (manual: boolean) => {
    const e = await recarregarAdicionais();
    const cobre = item === 'pacote' ? e.ativos.some((x) => x.id === 'pacote') : !!ativoQueCobre(item, e.ativos);
    if (cobre) {
      confirmar();
      return true;
    }
    if (manual) setNaoVimos(true);
    return false;
  }, [item, confirmar]);

  // Com o QR na tela, confere sozinha. Aba escondida para; ao voltar, confere na hora.
  useEffect(() => {
    if (fase !== 'pix') return;
    const inicio = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const parar = () => { if (timer) { clearInterval(timer); timer = null; } };
    const passo = () => {
      if (Date.now() - inicio > TETO_MS) { parar(); setNaoVimos(true); return; }
      void conferir(false);
    };
    const iniciar = () => { if (!timer) timer = setInterval(passo, INTERVALO_MS); };
    const vis = () => { if (document.visibilityState === 'hidden') parar(); else { passo(); iniciar(); } };
    if (document.visibilityState !== 'hidden') iniciar();
    document.addEventListener('visibilitychange', vis);
    return () => { parar(); document.removeEventListener('visibilitychange', vis); };
  }, [fase, conferir]);

  const pagarCartao = async () => {
    setBanner('');
    setFase('cartao');
    try {
      const r = await comprarAdicional(item, 'cartao');
      if (r.tipo === 'redirecionar') { window.location.href = r.url; return; }
      await recarregarAdicionais();
      confirmar();
    } catch (err) {
      setBanner(fraseDoErro(err) ?? ERRO_CARTAO);
      setFase('meio');
    }
  };

  const irProPix = () => {
    setBanner('');
    setFase('cpf');
    void cpfSalvo().then(setSalvo);
  };

  const gerar = async (doc: { digitos: string } | { salvo: true }) => {
    setBanner('');
    setCpfErro(false);
    setFase('gerando');
    try {
      const r = await comprarAdicional(item, 'pix', doc);
      if (r.tipo !== 'pix') { confirmar(); return; }
      setQr(r.qr);
      setCopiado(false);
      setNaoVimos(false);
      setFase('pix');
    } catch (err) {
      const frase = fraseDoErro(err);
      if (frase && /cpf/i.test(frase)) { setCpfErro(true); setFase('cpf'); return; }
      setBanner(frase ?? MSG.gerar);
      setFase('cpf');
    }
  };

  const submeter = () => {
    if (!cpfValido(cpf)) { setCpfErro(true); return; }
    void gerar({ digitos: soDigitos(cpf) });
  };

  const jaPaguei = async () => {
    setConferindo(true);
    setNaoVimos(false);
    try { await conferir(true); } finally { setConferindo(false); }
  };

  const resumo = (
    <div className={s.resumo}>
      {pacote ? (
        <div className={a.pilha} aria-hidden="true">
          {PRODUTOS_DA_LOJA.map((p) => (
            <span key={p.id}><Image src={p.imagem} alt="" fill sizes="40px" /></span>
          ))}
        </div>
      ) : produto ? (
        <div className={s.resumoImg}><Image src={produto.imagem} alt="" fill sizes="56px" /></div>
      ) : null}
      <p>Você está liberando <b>{nome}</b> por <b>{brl(valor)} por mês</b>.</p>
    </div>
  );

  /* ── Confirmado ── */
  if (fase === 'ok') {
    return (
      <Caixa onFechar={onFechar} caixaRef={caixaRef} fundoFecha={() => true}>
        <Topo titulo="Pagamento confirmado" onFechar={onFechar} />
        <div className={s.conf} role="status" aria-live="polite">
          <div className={s.okGrande}><Check size={28} aria-hidden="true" /></div>
          <p>Pronto, {nome} {pacote ? 'estão liberadas' : 'está liberado'} na sua conta.</p>
          {produto && (
            <div className={s.prox}><small>Próximo passo</small><p>{produto.proximo}</p></div>
          )}
          {produto ? (
            <Link href={produto.rotaAbrir} className={`${s.btn} ${s.btnPrim}`} onClick={onFechar}>{produto.abrirBotao}</Link>
          ) : null}
          <Link href="/produtos" className={`${s.btn} ${produto ? s.btnLink : s.btnPrim}`} onClick={onFechar}>Voltar para a loja</Link>
        </div>
      </Caixa>
    );
  }

  return (
    <Caixa onFechar={onFechar} caixaRef={caixaRef} fundoFecha={() => fase !== 'pix'}>
      <Topo titulo="Finalize a sua compra" onFechar={onFechar} />
      {resumo}
      {banner && <div className={s.banner} role="alert">{banner}</div>}

      {/* ── O meio ── */}
      {(fase === 'meio' || fase === 'cartao') && (
        <div className={s.sec}>
          <h3 className={a.titulo}>Como você quer pagar?</h3>
          <div className={a.meios}>
            <button type="button" className={a.meio} onClick={pagarCartao} disabled={fase === 'cartao'}>
              <span className={a.meioIcone} aria-hidden="true">
                {fase === 'cartao' ? <span className={s.giro} /> : <CreditCard size={20} />}
              </span>
              <span className={a.meioTexto}>
                <b>Pagar com cartão</b>
                <small>Cobrado no cartão todo mês.</small>
              </span>
              <ChevronRight size={18} className={a.meioSeta} aria-hidden="true" />
            </button>
            <button type="button" className={a.meio} onClick={irProPix} disabled={fase === 'cartao'}>
              <span className={a.meioIcone} aria-hidden="true"><QrCode size={20} /></span>
              <span className={a.meioTexto}>
                <b>Pagar com Pix</b>
                <small>Você autoriza uma vez e o Pix é cobrado na sua conta todo mês.</small>
              </span>
              <ChevronRight size={18} className={a.meioSeta} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* ── CPF do Pix ── */}
      {(fase === 'cpf' || fase === 'gerando') && (
        <form className={s.sec} onSubmit={(e) => { e.preventDefault(); submeter(); }} noValidate>
          <label className={a.rotuloCpf} htmlFor="ad-cpf">Para o Pix, informe o seu CPF.</label>
          <input
            id="ad-cpf"
            name="cpf"
            className={`${s.campo} ${cpfErro ? s.campoErro : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => { setCpf(maskCpf(e.target.value)); if (cpfErro) setCpfErro(false); }}
            aria-invalid={cpfErro || undefined}
            aria-describedby={cpfErro ? 'ad-cpf-erro' : undefined}
          />
          {cpfErro && <p className={`${s.dica} ${s.dicaErro}`} id="ad-cpf-erro" role="alert">{MSG.cpf}</p>}
          <div className={a.pilhaBotoes}>
            <button type="submit" className={`${s.btn} ${s.btnPrim}`} disabled={fase === 'gerando'}>
              {fase === 'gerando' ? 'Gerando o Pix' : 'Gerar Pix'}
            </button>
            {salvo && (
              <button type="button" className={`${s.btn} ${s.btnSec}`} disabled={fase === 'gerando'} onClick={() => void gerar({ salvo: true })}>
                Usar o mesmo CPF ({salvo})
              </button>
            )}
            <button type="button" className={`${s.btn} ${s.btnLink}`} onClick={() => { setBanner(''); setFase('meio'); }} disabled={fase === 'gerando'}>
              Voltar
            </button>
          </div>
          <p className={s.confianca}><Lock size={13} aria-hidden="true" />Cobrança emitida pelo Asaas.</p>
        </form>
      )}

      {/* ── QR da autorização ── */}
      {fase === 'pix' && qr && (
        <>
          {qr.instrucao && <p className={a.instrucao}>{qr.instrucao}</p>}
          {qr.qrPayload ? (
            <div className={s.pix}>
              {qr.qrImagemBase64 && (
                <div className={s.qr}>
                  <img src={srcDoQr(qr.qrImagemBase64)} alt="QR do Pix para pagar no app do banco" width={192} height={192} />
                </div>
              )}
              <div className={s.cod}>
                <span className={s.rotulo}>Pix copia e cola</span>
                <p className={s.codTexto}>{qr.qrPayload}</p>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnPrim}`}
                  onClick={async () => { if (qr.qrPayload && await copiarTexto(qr.qrPayload)) setCopiado(true); }}
                >
                  <Copy size={17} aria-hidden="true" />Copiar código Pix
                </button>
                {copiado && <p className={s.copiado} role="status">Código copiado. Cole no app do seu banco.</p>}
              </div>
            </div>
          ) : (
            <div className={s.aviso}>
              A cobrança foi criada, mas o código demorou a chegar. Recarregue a página em
              alguns segundos ou chame a gente no WhatsApp (34) 99816-5040.
            </div>
          )}
          <div className={s.aguardando} role="status">
            <span className={s.ponto} aria-hidden="true" />
            <div>
              <b>Aguardando o pagamento.</b>
              Esta tela confere sozinha e libera o acesso assim que o pagamento cair. Pode deixar aberta.
            </div>
          </div>
          {naoVimos && <p className={`${s.dica} ${s.dicaErro}`} role="alert">{MSG.naoVimos}</p>}
          <p className={s.confianca}><Lock size={13} aria-hidden="true" />Cobrança emitida pelo Asaas.</p>
          <div className={a.pilhaBotoes}>
            <button type="button" className={`${s.btn} ${s.btnSec}`} onClick={jaPaguei} disabled={conferindo}>
              {conferindo ? 'Conferindo' : 'Já paguei'}
            </button>
          </div>
        </>
      )}
    </Caixa>
  );
}
