'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, Copy, Lock, X } from 'lucide-react';
import { useEsconderWhatsFab } from '@/components/AreaTrabalho/AreaTrabalho';
import { recarregarAcessos, useAcessos } from '@/hooks/useAcessos';
import { cpfValido, maskCpf, soDigitos } from '@/utils/documento';
import {
  brl, produtoDaLoja, produtoDoUpsell, type ProdutoDaLoja, type ProximoDaApi,
} from '@/lib/loja/catalogo';
import {
  classificarErro, consultarPix, criarPix, MSG, srcDoQr, statusHttp, type CobrancaPix, type ConsultaPix,
} from '@/lib/loja/pix';
import s from './CheckoutPix.module.css';

/**
 * O CHECKOUT PIX, UM SÓ PARA TODO BOTÃO DE COMPRA (loja, páginas de venda, Off-grid).
 *
 * A cobrança sai no CPF da pessoa, pelo Asaas; o valor vem do catálogo da api (a tela mostra o `valor` que a cobrança
 * devolve). Depois de gerar, a tela consulta a cobrança a cada 3 s (para quando a aba some e volta quando ela aparece)
 * e, quando o Pix cai, mostra "Pagamento confirmado" e destrava o menu e a loja sem recarregar a página
 * (`recarregarAcessos`).
 *
 * Quem abre o checkout (`useCheckoutPix`) tem que guardar o `{modal}` num lugar que NÃO desmonta quando o acesso libera:
 * é nele que "Pagamento confirmado" e o upsell aparecem.
 *
 * Quando a resposta traz `proximo`, oferece o upsell: o mesmo CPF, um toque, direto para o QR.
 */

const INTERVALO_MS = 3000;
/** Com o modal aberto, a consulta desiste depois disto e pede para a pessoa atualizar. */
const TETO_CONSULTA_MS = 10 * 60 * 1000;
/** Enquanto a cobrança estiver pendente, relê os acessos nesse ritmo: cobre a cobrança antiga que "Gerar outro" deixa viva. */
const RELEITURA_ACESSOS_MS = 15_000;

export interface CheckoutPixProps {
  /** id do produto no catálogo (`offgrid`, `inventario`, `curso-fechamento`, `curso-limpapro`). */
  produto: string;
  /** Abre já gerando o Pix com o CPF que a pessoa usou antes (o upsell). */
  usarCpfSalvo?: boolean;
  onFechar: () => void;
  /** O produto foi liberado (Pix caiu ou a conta já o tinha). A tela que abriu o checkout usa para se atualizar. */
  onConfirmado?: (produto: string) => void;
}

export default function CheckoutPix({ produto, usarCpfSalvo, onFechar, onConfirmado }: CheckoutPixProps) {
  // O produto do upsell troca o alvo sem fechar a caixa: `n` zera o fluxo de dentro. `preco` é o que a api mandou no `proximo`.
  const [alvo, setAlvo] = useState<{ id: string; salvo: boolean; n: number; preco?: number }>({ id: produto, salvo: !!usarCpfSalvo, n: 0 });
  /** Há uma cobrança gerada e ainda não confirmada: fechar a caixa não pode perder o pagamento de vista. */
  const vivaRef = useRef(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  const fechar = useCallback(() => {
    if (vivaRef.current) {
      // A pessoa pode ter pago e fechado: relê os acessos agora e mais duas vezes, para o menu destravar sozinho.
      recarregarAcessos(true);
      window.setTimeout(() => recarregarAcessos(true), 4000);
      window.setTimeout(() => recarregarAcessos(true), 12_000);
    }
    onFechar();
  }, [onFechar]);

  const base = produtoDaLoja(alvo.id);
  if (!base) return null;
  const p: ProdutoDaLoja = alvo.preco !== undefined ? { ...base, preco: alvo.preco } : base;
  return (
    <Caixa onFechar={fechar} caixaRef={caixaRef} fundoFecha={() => !vivaRef.current}>
      <Fluxo
        key={`${alvo.id}:${alvo.n}`}
        produto={p}
        usarSalvo={alvo.salvo}
        vivaRef={vivaRef}
        caixaRef={caixaRef}
        onFechar={fechar}
        onConfirmado={onConfirmado}
        onOferecer={(outro, preco) => setAlvo((a) => ({ id: outro.id, salvo: true, n: a.n + 1, preco }))}
      />
    </Caixa>
  );
}

/* ── A caixa: fundo, foco, Escape, rolagem da página travada. O checkout do adicional mensal usa a mesma. ── */
export function Caixa({ children, onFechar, caixaRef, fundoFecha }: {
  children: ReactNode;
  onFechar: () => void;
  caixaRef: RefObject<HTMLDivElement | null>;
  /** O clique no fundo fecha? Com um Pix no ar, não: um toque fora sem querer não pode esconder o QR. */
  fundoFecha: () => boolean;
}) {
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });
  useEsconderWhatsFab(true);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    caixaRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      const caixa = caixaRef.current;
      if (e.key === 'Escape') { fecharRef.current(); return; }
      if (e.key !== 'Tab' || !caixa) return;
      const alvos = Array.from(caixa.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)'));
      if (alvos.length === 0) { e.preventDefault(); caixa.focus(); return; }
      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || atual === caixa)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && atual === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = rolagem;
      anterior?.focus?.();
    };
  }, [caixaRef]);

  return (
    <div className={s.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget && fundoFecha()) onFechar(); }}>
      <div className={s.caixa} ref={caixaRef} role="dialog" aria-modal="true" aria-labelledby="co-titulo" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

type Fase = 'cpf' | 'gerando' | 'pix' | 'ok' | 'jaTem';

export function Topo({ titulo, onFechar }: { titulo: string; onFechar: () => void }) {
  return (
    <div className={s.topo}>
      <h2 id="co-titulo">{titulo}</h2>
      <button type="button" className={s.fechar} onClick={onFechar} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
    </div>
  );
}

/** `valor`: o que a api cobra. Antes de existir cobrança, o preço do espelho local. */
function Resumo({ p, valor }: { p: ProdutoDaLoja; valor: number }) {
  return (
    <div className={s.resumo}>
      <div className={s.resumoImg}>
        <Image src={p.imagem} alt="" fill sizes="56px" />
      </div>
      <p>Você está liberando <b>{p.nome}</b> por <b>{brl(valor)}</b>.</p>
    </div>
  );
}

const Confianca = ({ texto }: { texto: string }) => (
  <p className={s.confianca}><Lock size={13} aria-hidden="true" />{texto}</p>
);

/** Copia para a área de transferência. Sem a API moderna (http, webview antigo), cai no campo temporário. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
  } catch { /* cai no plano B */ }
  try {
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(t);
    return ok;
  } catch { return false; }
}

function Fluxo({ produto, usarSalvo, vivaRef, caixaRef, onFechar, onConfirmado, onOferecer }: {
  produto: ProdutoDaLoja;
  usarSalvo: boolean;
  vivaRef: RefObject<boolean>;
  caixaRef: RefObject<HTMLDivElement | null>;
  onFechar: () => void;
  onConfirmado?: (produto: string) => void;
  onOferecer: (p: ProdutoDaLoja, preco: number) => void;
}) {
  const { tem } = useAcessos();
  const [fase, setFase] = useState<Fase>(usarSalvo ? 'gerando' : 'cpf');
  const [cpf, setCpf] = useState('');
  const [cpfErro, setCpfErro] = useState(false);
  const [banner, setBanner] = useState('');
  const [cobranca, setCobranca] = useState<CobrancaPix | null>(null);
  const [vencido, setVencido] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [naoVimos, setNaoVimos] = useState(false);
  const [naoAchou, setNaoAchou] = useState(false);
  /** A consulta automática parou (404 ou teto de 10 min). "Já paguei" continua consultando. */
  const [parou, setParou] = useState(false);
  const [proximo, setProximo] = useState<ProximoDaApi | null>(null);
  const [recusou, setRecusou] = useState(false);
  /** A pessoa já pagou e a api ainda está liberando (409 `pagoAguardando`): relê os acessos até o produto aparecer. */
  const [aguardando, setAguardando] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const iniciou = useRef(false);
  const gerandoRef = useRef(false);
  const consultandoRef = useRef(false);
  const ofereceuRef = useRef(false);
  const confirmouRef = useRef(false);
  const cobrancaRef = useRef<CobrancaPix | null>(null);
  const inicioRef = useRef(0);
  const ultimaReleituraRef = useRef(0);

  // O produto pode aparecer liberado nos acessos por outro caminho: a cobrança antiga que "Gerar outro" deixou viva e
  // que a pessoa pagou, ou o Pix que caiu com a tela fechada e reaberta. Mostra "Pagamento confirmado" do mesmo jeito.
  const liberadoPorAcesso = (!!cobranca || aguardando) && tem(produto.id);
  const faseEf: Fase = liberadoPorAcesso && fase !== 'jaTem' ? 'ok' : fase;

  useEffect(() => {
    if (!liberadoPorAcesso || confirmouRef.current) return;
    confirmouRef.current = true;
    vivaRef.current = false;
    onConfirmado?.(produto.id);
    // Os acessos chegaram antes da consulta (foco da aba, releitura): busca o `proximo` para o upsell não se perder.
    const id = cobrancaRef.current?.cobrancaId;
    if (id) consultarPix(id).then((r) => { if (r.liberado && r.proximo) setProximo(r.proximo); }).catch(() => {});
  }, [liberadoPorAcesso, onConfirmado, produto.id, vivaRef]);

  // Pagou e a api ainda libera: relê os acessos a cada poucos segundos até o produto aparecer (sem o id da cobrança paga
  // não há o que consultar).
  useEffect(() => {
    if (!aguardando || liberadoPorAcesso) return;
    // Teto de 3 minutos: depois disso para de reler (o foco da aba e o botão de fechar ainda releem).
    const inicio = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - inicio > 3 * 60 * 1000) { window.clearInterval(t); return; }
      recarregarAcessos(true);
    }, 3000);
    return () => window.clearInterval(t);
  }, [aguardando, liberadoPorAcesso]);

  // A cada troca de fase o foco volta para a caixa: o botão que estava em foco some e o leitor de tela se perderia.
  useEffect(() => { caixaRef.current?.focus(); }, [faseEf, caixaRef]);

  const gerar = useCallback(async (digitos: string | null) => {
    if (gerandoRef.current) return;
    gerandoRef.current = true;
    setBanner('');
    setCpfErro(false);
    setFase('gerando');
    try {
      const c = await criarPix(produto.id, digitos);
      cobrancaRef.current = c;
      vivaRef.current = true;
      inicioRef.current = Date.now();
      ultimaReleituraRef.current = Date.now();
      setCobranca(c);
      setVencido(false);
      setCopiado(false);
      setNaoVimos(false);
      setNaoAchou(false);
      setParou(false);
      setFase('pix');
    } catch (err) {
      const erro = classificarErro(err);
      if (erro.tipo === 'jaTem') {
        vivaRef.current = false;
        recarregarAcessos(true);
        onConfirmado?.(produto.id);
        setFase('jaTem');
      } else if (erro.tipo === 'conflito') {
        // Ex.: "Seu Pix já foi pago, estamos liberando". Mostra a frase da api, relê os acessos e volta a consultar.
        recarregarAcessos(true);
        setBanner(erro.mensagem);
        if (erro.pagoAguardando) setAguardando(true);
        if (cobrancaRef.current) {
          inicioRef.current = Date.now();
          setVencido(false);
          setNaoAchou(false);
          setParou(false);
          setFase('pix');
        } else setFase('cpf');
      } else if (erro.tipo === 'cpf') {
        // Sem CPF lembrado (o upsell não achou o da pessoa): pede o CPF, sem acusar erro de quem ainda não digitou.
        setCpfErro(digitos !== null);
        setFase('cpf');
      } else {
        // Falha ao gerar o novo. Se já havia um Pix no ar, volta para ele (ainda vale) com o aviso.
        setBanner(erro.mensagem ?? MSG.gerar);
        setFase(cobrancaRef.current ? 'pix' : 'cpf');
      }
    } finally { gerandoRef.current = false; }
  }, [produto.id, onConfirmado, vivaRef]);

  // O upsell já nasce gerando: a pessoa tocou em "com o mesmo CPF".
  useEffect(() => {
    if (!usarSalvo || iniciou.current) return;
    iniciou.current = true;
    void gerar(null);
  }, [usarSalvo, gerar]);

  const confirmar = useCallback((r: ConsultaPix) => {
    confirmouRef.current = true;
    vivaRef.current = false;
    setProximo(r.proximo ?? null);
    setFase('ok');
    // O menu e a loja destravam sem recarregar. A segunda leitura cobre o intervalo entre o Pix cair e a posse gravar.
    recarregarAcessos(true);
    window.setTimeout(() => recarregarAcessos(true), 4000);
    onConfirmado?.(produto.id);
  }, [onConfirmado, produto.id, vivaRef]);

  const aplicar = useCallback((r: ConsultaPix, manual: boolean) => {
    // Pago mas ainda não liberado: a api está gravando o acesso. Segue consultando, sem anunciar antes da hora.
    if (r.status === 'pago') { if (r.liberado) confirmar(r); else if (manual) setNaoVimos(true); return; }
    if (r.status === 'expirado' || r.status === 'cancelado') { setVencido(true); return; }
    if (manual) setNaoVimos(true);
    // Pendente: a pessoa pode ter pago a cobrança ANTIGA (depois de "Gerar outro"). Relê os acessos de tempos em tempos.
    if (Date.now() - ultimaReleituraRef.current >= RELEITURA_ACESSOS_MS) {
      ultimaReleituraRef.current = Date.now();
      recarregarAcessos(true);
    }
  }, [confirmar]);
  const aplicarRef = useRef(aplicar);
  useEffect(() => { aplicarRef.current = aplicar; });

  const cobrancaId = cobranca?.cobrancaId ?? null;
  // Consulta a cada 3 s. Aba escondida para; ao voltar, consulta na hora e retoma. Para em 404 e no teto de 10 minutos.
  useEffect(() => {
    if (faseEf !== 'pix' || !cobrancaId || vencido || parou) return;
    let ativo = true;
    let voando = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const parar = () => { if (timer) { clearInterval(timer); timer = null; } };
    const consultar = async () => {
      if (voando || !ativo) return;
      if (Date.now() - inicioRef.current > TETO_CONSULTA_MS) { parar(); setNaoVimos(true); setParou(true); return; }
      voando = true;
      try {
        const r = await consultarPix(cobrancaId);
        if (ativo) aplicarRef.current(r, false);
      } catch (err) {
        if (ativo && statusHttp(err) === 404) { parar(); setNaoAchou(true); setParou(true); }
        /* outro erro: o próximo ciclo tenta de novo */
      } finally { voando = false; }
    };
    const iniciar = () => { if (!timer) timer = setInterval(consultar, INTERVALO_MS); };
    const visibilidade = () => {
      if (document.visibilityState === 'hidden') parar();
      else { void consultar(); iniciar(); }
    };
    if (document.visibilityState !== 'hidden') iniciar();
    document.addEventListener('visibilitychange', visibilidade);
    return () => { ativo = false; parar(); document.removeEventListener('visibilitychange', visibilidade); };
  }, [faseEf, cobrancaId, vencido, parou]);

  const jaPaguei = async () => {
    if (!cobrancaId || consultandoRef.current) return;
    consultandoRef.current = true;
    setConsultando(true);
    setNaoVimos(false);
    try {
      const r = await consultarPix(cobrancaId);
      aplicar(r, true);
    } catch (err) {
      if (statusHttp(err) === 404) { setNaoAchou(true); setParou(true); } else setNaoVimos(true);
    } finally { consultandoRef.current = false; setConsultando(false); }
  };

  const copiar = async () => {
    if (!cobranca) return;
    if (await copiarTexto(cobranca.qrPayload)) setCopiado(true);
  };

  const submeter = () => {
    if (!cpfValido(cpf)) { setCpfErro(true); return; }
    void gerar(soDigitos(cpf));
  };

  /** "Gerar outro": com o CPF digitado, um toque; sem ele (veio do upsell), com o CPF já lembrado. */
  const gerarOutro = () => { void gerar(cpfValido(cpf) ? soDigitos(cpf) : null); };

  const upsell = produtoDoUpsell(proximo);
  /** O preço do upsell é o que a api mandou; o espelho local só dá nome, imagem e promessa. */
  const precoUpsell = proximo && Number.isFinite(proximo.preco) ? proximo.preco : upsell?.preco ?? 0;
  const oferecer = () => {
    if (!upsell || ofereceuRef.current) return;
    ofereceuRef.current = true;
    onOferecer(upsell, precoUpsell);
  };
  /** O que a api cobra, quando já existe cobrança. */
  const valor = cobranca && Number.isFinite(cobranca.valor) ? cobranca.valor : produto.preco;

  /* ── Pagamento confirmado ── */
  if (faseEf === 'ok' || faseEf === 'jaTem') {
    const jaTinha = faseEf === 'jaTem';
    const comUpsell = !jaTinha && !!upsell && !recusou;
    return (
      <>
        <Topo titulo={jaTinha ? 'Você já tem' : 'Pagamento confirmado'} onFechar={onFechar} />
        <div className={s.conf} role="status" aria-live="polite">
          <div className={s.okGrande}><Check size={28} aria-hidden="true" /></div>
          {jaTinha && <h2>{produto.nome}</h2>}
          <p>{jaTinha ? MSG.jaTem : `Pronto, ${produto.nome} está liberado na sua conta.`}</p>
          {!jaTinha && (
            <div className={s.prox}><small>Próximo passo</small><p>{produto.proximo}</p></div>
          )}

          {comUpsell && upsell && (
            <div className={s.upsell}>
              <h3>Aproveite e libere também</h3>
              <div className={s.upsellCorpo}>
                <div className={s.upsellImg}><Image src={upsell.imagem} alt="" fill sizes="72px" /></div>
                <div className={s.upsellTxt}>
                  <strong>{upsell.nome}</strong>
                  <p>{upsell.promessa}</p>
                  <span className={s.upsellPreco}>{brl(precoUpsell)} <small>Um pagamento, sem mensalidade.</small></span>
                </div>
              </div>
              <button type="button" className={`${s.btn} ${s.btnPrim}`} onClick={oferecer}>
                Liberar por {brl(precoUpsell)} com o mesmo CPF
              </button>
              <button type="button" className={`${s.btn} ${s.btnLink}`} onClick={() => setRecusou(true)}>Agora não</button>
            </div>
          )}

          <Link
            href={produto.rotaAbrir}
            className={`${s.btn} ${comUpsell ? s.btnSec : s.btnPrim}`}
            onClick={onFechar}
          >
            {produto.abrirBotao}
          </Link>
          <Link href="/produtos" className={`${s.btn} ${s.btnLink}`} onClick={onFechar}>Voltar para a loja</Link>
        </div>
      </>
    );
  }

  /* ── Já pagou, a api está liberando (sem cobrança nesta tela) ── */
  if (aguardando && !cobranca) {
    return (
      <>
        <Topo titulo="Finalize a sua compra" onFechar={onFechar} />
        <Resumo p={produto} valor={produto.preco} />
        {banner && <div className={s.aviso} role="status">{banner}</div>}
        <div className={s.gerando} role="status"><span className={s.giro} aria-hidden="true" />Aguardando a liberação do acesso.</div>
      </>
    );
  }

  /* ── Gerando o Pix do upsell (CPF já lembrado) ── */
  if (faseEf === 'gerando' && usarSalvo && !cobranca) {
    return (
      <>
        <Topo titulo="Finalize a sua compra" onFechar={onFechar} />
        <Resumo p={produto} valor={produto.preco} />
        <div className={s.gerando} role="status"><span className={s.giro} aria-hidden="true" />Gerando o seu Pix com o mesmo CPF.</div>
      </>
    );
  }

  /* ── Aguardando o pagamento ── */
  if (cobranca && (faseEf === 'pix' || faseEf === 'gerando')) {
    const c = cobranca;
    return (
      <>
        <Topo titulo="Finalize a sua compra" onFechar={onFechar} />
        <Resumo p={produto} valor={valor} />
        {banner && <div className={s.banner} role="alert">{banner}</div>}
        {vencido ? (
          <div className={s.venceu} role="alert">
            <p>O código venceu. Gere outro para continuar.</p>
            <button type="button" className={`${s.btn} ${s.btnPrim}`} onClick={gerarOutro} disabled={faseEf === 'gerando'}>Gerar outro</button>
          </div>
        ) : (
          <>
            <div className={s.pix}>
              <div className={s.qr}>
                <img src={srcDoQr(c.qrImagemBase64)} alt="QR do Pix para pagar no app do banco" width={192} height={192} />
              </div>
              <div className={s.cod}>
                <span className={s.rotulo}>Pix copia e cola</span>
                <p className={s.codTexto} data-testid="codigo-pix">{c.qrPayload}</p>
                <button type="button" className={`${s.btn} ${s.btnPrim}`} onClick={copiar}>
                  <Copy size={17} aria-hidden="true" />Copiar código Pix
                </button>
                {copiado && <p className={s.copiado} role="status">Código copiado. Cole no app do seu banco.</p>}
              </div>
            </div>
            <div className={s.aguardando} role="status">
              <span className={s.ponto} aria-hidden="true" />
              <div>
                <b>Aguardando o pagamento.</b>
                Esta tela confere sozinha e libera o acesso assim que o pagamento cair. Pode deixar aberta.
              </div>
            </div>
            <p className={s.dica}>Se o código vencer, gere outro.</p>
            {naoAchou && <p className={`${s.dica} ${s.dicaErro}`} role="alert">{MSG.naoAchou}</p>}
            {naoVimos && !naoAchou && <p className={`${s.dica} ${s.dicaErro}`} role="alert">{MSG.naoVimos}</p>}
            <Confianca texto="Cobrança emitida pelo Asaas." />
            <div className={s.acoes}>
              <button type="button" className={`${s.btn} ${s.btnSec}`} onClick={jaPaguei} disabled={consultando}>
                {consultando ? 'Conferindo' : 'Já paguei'}
              </button>
              <button type="button" className={`${s.btn} ${s.btnSec}`} onClick={gerarOutro} disabled={faseEf === 'gerando'}>Gerar outro</button>
            </div>
          </>
        )}
      </>
    );
  }

  /* ── CPF ── */
  const ocupado = faseEf === 'gerando';
  return (
    <>
      <Topo titulo="Finalize a sua compra" onFechar={onFechar} />
      <Resumo p={produto} valor={produto.preco} />
      {banner && <div className={s.banner} role="alert">{banner}</div>}
      <div className={s.sec}>
        <h3>Pagamento por Pix</h3>
        <p className={s.dica}>Pagamento único, sem mensalidade. O acesso libera assim que o Pix cair.</p>
      </div>
      <form className={s.sec} onSubmit={(e) => { e.preventDefault(); submeter(); }} noValidate>
        <p className={s.aviso}>A cobrança sai no seu CPF. Confira o número antes de pagar.</p>
        <label className={s.rotulo} htmlFor="co-cpf">CPF</label>
        <input
          id="co-cpf"
          className={`${s.campo} ${cpfErro ? s.campoErro : ''}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(e) => { setCpf(maskCpf(e.target.value)); if (cpfErro) setCpfErro(false); }}
          aria-invalid={cpfErro || undefined}
          aria-describedby={cpfErro ? 'co-cpf-erro' : undefined}
        />
        {cpfErro && <p className={`${s.dica} ${s.dicaErro}`} id="co-cpf-erro" role="alert">{MSG.cpf}</p>}
        <div style={{ marginTop: 14 }}>
          <button type="submit" className={`${s.btn} ${s.btnPrim}`} disabled={ocupado}>
            {ocupado ? 'Gerando o Pix' : 'Gerar Pix'}
          </button>
        </div>
        <Confianca texto="Cobrança emitida pelo Asaas." />
      </form>
    </>
  );
}
