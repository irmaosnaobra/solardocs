'use client';

// Assinar no Pix automático, sem sair da LP. Mesma API, mesmos textos e mesma
// lógica do quiz (/diagnostico) e da tela /pix-automatico: o POST cria o
// contrato e devolve o código; a tela pergunta a cada 3 s se o Pix foi pago e,
// quando a pessoa volta do app do banco, pergunta na hora (lib/pixEspera.ts).
// O contrato fica guardado no aparelho por 24 h (só o id, o código e o prazo, sem
// e-mail): quem fecha a aba ou recarrega a LP reencontra o mesmo código, com o
// QR vindo da api, ou a confirmação de que pagou.

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { getCheckoutAttribution, registrarEvento, novoIcEventId } from '@/hooks/useLpTracking';
import {
  guardarPix, lerPixGuardado, limparPixGuardado, primeiraVezPago, usePixEspera, validadeTexto,
  TXT_PIX, type PixStatus,
} from '@/lib/pixEspera';
import { PixCodigoBloco, PixEsperaAviso, PixPagoBloco, PixSemPagamentoBloco } from '@/components/PixPago/PixEstados';
import { digitosFone, docValido, foneValido, mascaraDoc, mascaraFone, soDigitos } from './pixDoc';
import styles from './PixAutomaticoModal.module.css';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const PIX_OFF = 'Não deu para gerar o Pix automático agora. Tente de novo em instantes.';
const PIX_JA = 'Já existe uma assinatura no Pix para este CPF ou e-mail. Use outro CPF ou CNPJ.';
const PIX_CAMPOS = 'Confira o e-mail e o CPF ou CNPJ.';
const PIX_DOC_ERRO = 'Esse CPF ou CNPJ não confere. Confira os números.';
const PIX_FONE_ERRO = 'Confira o WhatsApp com DDD.';
// Texto do botão "Falar com a Carla". Leva sempre o código; sem ele (a API não
// devolveu nenhum), vai o mesmo texto sem a última frase.
const msgCarla = (c: string) =>
  'Oi, Carla! Gerei meu Pix da SolarDoc e quero ajuda para ativar.' + (c ? ' Código ' + c : '');
const CODIGO_RE = /^SD-[A-Z0-9]{4,6}$/;

const ESPERA_MAX_MS = 60 * 60 * 1000; // vale quando a API não manda expiraEm
const COPIADO_MS = 3000;
const SK_LEAD_SESSAO = 'sd-pix-lead-sessao';
const TELA = 'lp'; // chave do contrato guardado

// Celular completo: DDD (11 a 99) + 9 + 8 dígitos. É o que a captura exige.
const celularCompleto = (d: string) => /^\d{2}9\d{8}$/.test(d) && Number(d.slice(0, 2)) >= 11;

// Id aleatório da sessão, guardado em sessionStorage. Sem storage, vale só nesta tela.
let sessaoMemoria = '';
function sessaoLead(): string {
  const novo = () => 'pl_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try {
    let id = sessionStorage.getItem(SK_LEAD_SESSAO);
    if (!id) { id = novo(); sessionStorage.setItem(SK_LEAD_SESSAO, id); }
    return id;
  } catch {
    if (!sessaoMemoria) sessaoMemoria = novo();
    return sessaoMemoria;
  }
}

interface Cobranca {
  id: string;
  payload: string;
  imagem: string;
  temConta: boolean;
  email: string;
  codigo: string; // SD-XXXX, quando a API devolve; '' se não
  fimMs: number; // até quando esperar o pagamento (expiraEm da API, ou 60 min)
  validade: string; // "hoje às 14:30"; '' quando a API não mandou expiraEm
  retomada: boolean; // veio do aparelho (aba fechada, página recarregada)
}

// Contrato guardado nas últimas 24 h, se houver. A LP abre o modal sozinha com ele.
export function temPixGuardadoLp(): boolean {
  return lerPixGuardado(TELA) !== null;
}

function cobrancaGuardada(): Cobranca | null {
  const g = lerPixGuardado(TELA);
  if (!g) return null;
  return {
    id: g.id, payload: g.payload, imagem: '', temConta: g.temConta, email: '',
    codigo: '', fimMs: g.fimMs, validade: g.fimMs > Date.now() ? validadeTexto(g.fimMs) : '', retomada: true,
  };
}

interface Props {
  origem: string; // 'retomada' quando a LP abriu sozinha com um contrato guardado
  whatsappUrl: string; // https://wa.me/<número da 5040>
  onFechar: () => void;
  onCartao?: () => void; // fecha o modal e vai ao checkout do cartão
}

type FbqWindow = Window & { fbq?: (...args: unknown[]) => void };

export default function PixAutomaticoModal({ origem, whatsappUrl, onFechar, onCartao }: Props) {
  const [email, setEmail] = useState('');
  const [fone, setFone] = useState('');
  const [doc, setDoc] = useState('');
  const [erroEmail, setErroEmail] = useState('');
  const [erroFone, setErroFone] = useState('');
  const [erroDoc, setErroDoc] = useState('');
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [cobranca, setCobranca] = useState<Cobranca | null>(cobrancaGuardada);
  const [leadCodigo, setLeadCodigo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const painel = useRef<HTMLDivElement>(null);
  const campoEmail = useRef<HTMLInputElement>(null);
  const jaMediu = useRef(false);
  const leadFone = useRef(''); // último número enviado à captura (ou em voo)

  const zapUrl = `${whatsappUrl}?text=${encodeURIComponent(msgCarla(cobranca?.codigo || leadCodigo))}`;

  const idCobranca = cobranca?.id ?? null;
  const buscar = useCallback(async (comQr: boolean): Promise<PixStatus | null> => {
    if (!idCobranca) return null;
    const { data } = await api.get(`/payments/pix-recorrente/publico/${encodeURIComponent(idCobranca)}`, { timeout: 12000, ...(comQr ? { params: { qr: 1 } } : {}) });
    return (data ?? null) as PixStatus | null;
  }, [idCobranca]);
  const aoPagar = useCallback((_d: PixStatus, retomado: boolean) => {
    if (!idCobranca || !primeiraVezPago(idCobranca)) return;
    registrarEvento('pix_pago', { tela: 'lp', modo: 'automatico', contrato: idCobranca, ...(retomado ? { retomado: true } : {}) });
  }, [idCobranca]);
  const espera = usePixEspera({
    chave: idCobranca,
    fimMs: cobranca?.fimMs ?? 0,
    retomada: cobranca?.retomada ?? false,
    temImagem: Boolean(cobranca?.imagem),
    buscar,
    aoPagar,
  });

  const pagou = cobranca !== null && espera.fase === 'pago';
  const encerrou = cobranca !== null && espera.fase === 'encerrado';
  const sumiu = cobranca !== null && espera.fase === 'sumiu';
  const polling = cobranca !== null && espera.fase === 'esperando';

  // Pago, vencido ou contrato que não existe mais: o código guardado já cumpriu o papel.
  useEffect(() => {
    if (pagou || encerrou || sumiu) limparPixGuardado(TELA);
  }, [pagou, encerrou, sumiu]);

  // Abriu: mede uma vez (StrictMode monta duas vezes em dev), guarda quem abriu
  // para devolver o foco, trava a rolagem da página e leva o foco ao 1º campo.
  // Reaberto sozinho pela LP (origem 'retomada') não conta como abertura nova.
  useEffect(() => {
    const abriu = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    campoEmail.current?.focus();
    if (!jaMediu.current) {
      jaMediu.current = true;
      if (origem !== 'retomada') registrarEvento('pix_abriu', { tela: 'lp', origem });
    }
    return () => {
      document.body.style.overflow = overflow;
      if (abriu && document.contains(abriu)) abriu.focus();
    };
  }, [origem]);

  // Fechar (X, Esc) com o Pix na tela esperando pagamento: antes de sair, o modal
  // pergunta por dentro. Sem window.confirm.
  const tentarFechar = useCallback(() => {
    if (saindo) { setSaindo(false); return; }
    if (polling) { setSaindo(true); return; }
    onFechar();
  }, [saindo, polling, onFechar]);

  // Esc fecha. Tab fica preso dentro do modal.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); tentarFechar(); return; }
      if (e.key !== 'Tab' || !painel.current) return;
      const itens = Array.from(painel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      )).filter((el) => el.offsetParent !== null);
      if (!itens.length) return;
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const ativo = document.activeElement;
      if (!painel.current.contains(ativo)) { e.preventDefault(); primeiro.focus(); }
      else if (e.shiftKey && ativo === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [tentarFechar]);

  function recomecar() {
    limparPixGuardado(TELA);
    setCobranca(null);
    setCopiado(false);
    setSaindo(false);
    setErro('');
  }

  function fbq(nome: string) {
    const w = window as FbqWindow;
    if (w.fbq) w.fbq('track', 'InitiateCheckout', { content_name: nome, value: 67, currency: 'BRL' }, { eventID: novoIcEventId() });
  }

  // Saiu do campo do WhatsApp com celular completo: avisa a api, uma vez por número.
  // Falha fica em silêncio: o formulário segue como se nada tivesse acontecido.
  async function capturarLead() {
    const fn = digitosFone(fone);
    if (!celularCompleto(fn) || leadFone.current === fn) return;
    leadFone.current = fn;
    try {
      const em = email.trim().toLowerCase();
      const { data } = await api.post('/payments/pix-recorrente/lead-lp', {
        whatsapp: '55' + fn,
        ...(EMAIL_RE.test(em) ? { email: em } : {}),
        sessao: sessaoLead(),
        ...getCheckoutAttribution(),
      });
      if (leadFone.current !== fn) return; // o número mudou enquanto a resposta vinha
      if (typeof data?.codigo === 'string' && CODIGO_RE.test(data.codigo)) setLeadCodigo(data.codigo);
    } catch {
      if (leadFone.current === fn) leadFone.current = ''; // tenta de novo na próxima saída do campo
    }
  }

  // Os três campos valem? Sem focar nem marcar erro (usado pelo "Gerar outro código").
  const camposOk = () => EMAIL_RE.test(email.trim().toLowerCase()) && foneValido(digitosFone(fone)) && docValido(soDigitos(doc));

  async function gerar(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (criando) return;
    const em = email.trim().toLowerCase();
    const dd = soDigitos(doc);
    const fn = digitosFone(fone);
    const emOk = EMAIL_RE.test(em);
    const fnOk = foneValido(fn);
    const ddOk = docValido(dd);
    setErroEmail(emOk ? '' : 'Confira o e-mail.');
    setErroFone(fnOk ? '' : PIX_FONE_ERRO);
    setErroDoc(ddOk ? '' : PIX_DOC_ERRO);
    setErro('');
    if (!ddOk) {
      registrarEvento('pix_doc_invalido', { tela: 'lp', motivo: dd.length === 11 || dd.length === 14 ? 'digito' : 'tamanho' });
    }
    if (!emOk || !fnOk || !ddOk) {
      const id = !emOk ? 'pix-email' : !fnOk ? 'pix-fone' : 'pix-doc';
      document.getElementById(id)?.focus();
      return;
    }

    setCriando(true);
    try {
      const { data } = await api.post('/payments/pix-recorrente/publico', {
        plan: 'ilimitado',
        nome: 'Cliente',
        email: em,
        cpfCnpj: dd,
        whatsapp: '55' + fn,
        origem: 'lp_solardoc',
        ...getCheckoutAttribution(),
      });
      if (!data || data.modo !== 'automatico') {
        registrarEvento('pix_falhou', { tela: 'lp', motivo: 'modo_' + (data?.modo ?? 'vazio') });
        setCobranca(null);
        setErro(PIX_OFF);
        return;
      }
      if (!data.qrPayload || data.status === 'ativo' || !data.id) {
        registrarEvento('pix_falhou', { tela: 'lp', motivo: 'ja_existe' });
        setCobranca(null);
        setErro(PIX_JA);
        return;
      }
      // Sem expiraEm válido (ou já vencido pelo relógio daqui), mantém os 60 min de sempre.
      const expira = typeof data.expiraEm === 'string' ? Date.parse(data.expiraEm) : NaN;
      const comExpira = Number.isFinite(expira) && expira > Date.now() + 60 * 1000;
      const nova: Cobranca = {
        id: String(data.id),
        payload: data.qrPayload,
        imagem: data.qrImagemBase64 || '',
        temConta: Boolean(data.temConta),
        email: em,
        codigo: typeof data.codigo === 'string' && CODIGO_RE.test(data.codigo) ? data.codigo : '',
        fimMs: comExpira ? expira : Date.now() + ESPERA_MAX_MS,
        validade: comExpira ? validadeTexto(expira) : '',
        retomada: false,
      };
      setCopiado(false);
      setSaindo(false);
      setCobranca(nova);
      guardarPix(TELA, { id: nova.id, t: Date.now(), fimMs: nova.fimMs, payload: nova.payload, temConta: nova.temConta });
      registrarEvento('pix_gerou', { tela: 'lp', modo: 'automatico', contrato: data.id, temConta: data.temConta });
      fbq('vip_pix_auto'); // só depois de chegar o id: um 400 com nova tentativa não conta duas vezes
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      registrarEvento('pix_falhou', { tela: 'lp', motivo: e?.response?.data?.error ?? 'erro-desconhecido' });
      setCobranca(null);
      setErro(e?.response?.status === 400 ? PIX_CAMPOS : PIX_OFF);
    } finally {
      setCriando(false);
    }
  }

  // Venceu ou não foi concluído: com os campos ainda na tela, gera direto; senão volta ao formulário.
  function gerarOutro() {
    if (camposOk()) { void gerar(); return; }
    recomecar();
  }

  async function copiar() {
    const texto = cobranca?.payload;
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      registrarEvento('pix_copiou', { tela: 'lp', modo: 'automatico' });
      setCopiado(true);
      setTimeout(() => setCopiado(false), COPIADO_MS);
    } catch {
      (document.getElementById('pix-codigo') as HTMLTextAreaElement | null)?.select();
      setErro('Seu navegador bloqueou a cópia. Selecione o código e copie na mão.');
    }
  }

  const emailConta = (cobranca?.email || email).trim().toLowerCase();
  const hrefConta = cobranca?.temConta
    ? '/auth?mode=login'
    : `/auth?mode=register${emailConta ? `&email=${encodeURIComponent(emailConta)}` : ''}`;

  return (
    <div className={styles.fundo}>
      <div
        ref={painel}
        className={styles.painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pix-modal-titulo"
      >
        <button type="button" className={styles.fechar} onClick={tentarFechar} aria-label="Fechar">
          <span aria-hidden="true">×</span>
        </button>
        <div className={styles.rolagem}>
        {pagou && cobranca ? (
          <PixPagoBloco
            dados={espera.dados}
            pagoAoReabrir={espera.pagoAoReabrir}
            demorou={espera.demorou}
            temConta={cobranca.temConta}
            hrefConta={hrefConta}
            classeBotao={styles.btnPrincipal}
            idTitulo="pix-modal-titulo"
          />
        ) : encerrou && cobranca ? (
          <>
            <PixSemPagamentoBloco
              fim={espera.fim}
              nadaCobrado={espera.nadaCobrado}
              classeBotao={styles.btnPrincipal}
              classeBotao2={styles.btnSecundario}
              onGerar={gerarOutro}
              gerando={criando}
              cartao={onCartao ? { onClick: onCartao } : null}
              idTitulo="pix-modal-titulo"
            />
            {erro && <p className={styles.erro} role="alert">{erro}</p>}
          </>
        ) : cobranca && !sumiu ? (
          <>
            <h2 id="pix-modal-titulo" className={styles.titulo}>{TXT_PIX.esperandoTitulo}</h2>
            {saindo ? (
              <div className={styles.travou} role="alertdialog" aria-label="Sair sem pagar?">
                <p>Se você já pagou, o acesso chega no seu e-mail do mesmo jeito.</p>
                <button type="button" className={styles.btnSecundario} onClick={onFechar}>Fechar mesmo assim</button>
                <button type="button" className={styles.btnPrincipal} onClick={() => setSaindo(false)} autoFocus>Voltar ao código</button>
              </div>
            ) : (
              <>
                <PixEsperaAviso semConexao={espera.semConexao} />
                <PixCodigoBloco
                  payload={cobranca.payload}
                  imagem={cobranca.imagem || espera.dados?.qrImagemBase64 || ''}
                  validade={cobranca.validade}
                  copiado={copiado}
                  onCopiar={copiar}
                  classeBotao={styles.btnPrincipal}
                  idCodigo="pix-codigo"
                />
                <a
                  className={styles.btnSecundario}
                  href={zapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => registrarEvento('pix_ajuda_whatsapp', { tela: 'lp', modo: 'automatico' })}
                >
                  Falar com a Carla no WhatsApp
                </a>
              </>
            )}
            {erro && <p className={styles.erro} role="alert">{erro}</p>}
          </>
        ) : (
          <form onSubmit={gerar} noValidate>
            <h2 id="pix-modal-titulo" className={styles.titulo}>Assinar no Pix automático</h2>
            <p className={styles.sub}>
              R$ 67 por mês, debitado sozinho pelo seu banco. Você cancela quando quiser pelo app do banco.
            </p>

            <label className={styles.rotulo} htmlFor="pix-email">Seu e-mail</label>
            <input
              id="pix-email" ref={campoEmail} className={styles.campo} type="email" inputMode="email"
              autoComplete="email" maxLength={120} value={email} spellCheck={false}
              onChange={(e) => { setEmail(e.target.value); setErroEmail(''); }}
              aria-describedby="pix-email-dica pix-email-erro" aria-invalid={erroEmail ? true : undefined}
            />
            <p id="pix-email-dica" className={styles.dica}>O acesso chega nele.</p>
            <p id="pix-email-erro" className={styles.erro} role="alert">{erroEmail}</p>

            <label className={styles.rotulo} htmlFor="pix-fone">Seu WhatsApp</label>
            <input
              id="pix-fone" className={styles.campo} type="tel" inputMode="tel" autoComplete="tel-national"
              placeholder="(34) 99999-9999" maxLength={15} value={fone}
              onChange={(e) => { setFone(mascaraFone(e.target.value)); setErroFone(''); }}
              onBlur={() => { void capturarLead(); }}
              aria-describedby="pix-fone-dica pix-fone-erro" aria-invalid={erroFone ? true : undefined}
            />
            <p id="pix-fone-dica" className={styles.dica}>
              Com DDD. A Carla, da SolarDoc, pode te chamar no WhatsApp para ajudar no pagamento.
            </p>
            <p id="pix-fone-erro" className={styles.erro} role="alert">{erroFone}</p>

            <label className={styles.rotulo} htmlFor="pix-doc">CPF ou CNPJ de quem paga</label>
            <input
              id="pix-doc" className={styles.campo} type="text" inputMode="numeric" autoComplete="off"
              placeholder="000.000.000-00" maxLength={18} value={doc}
              onChange={(e) => { setDoc(mascaraDoc(e.target.value)); setErroDoc(''); }}
              aria-describedby="pix-doc-dica pix-doc-erro" aria-invalid={erroDoc ? true : undefined}
            />
            <p id="pix-doc-dica" className={styles.dica}>O banco pede esse número para ligar o Pix automático.</p>
            <p id="pix-doc-erro" className={styles.erro} role="alert">{erroDoc}</p>

            {erro && <p className={styles.erro} role="alert">{erro}</p>}

            <button type="submit" className={styles.btnPrincipal} disabled={criando}>
              {criando ? 'Gerando o Pix' : 'Gerar o Pix'}
            </button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
