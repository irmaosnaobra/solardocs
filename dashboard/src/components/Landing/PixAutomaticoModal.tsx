'use client';

// Assinar no Pix automático, sem sair da LP. Mesma API, mesmos textos e mesma
// lógica do quiz (/diagnostico) e da tela /pix-automatico: o POST cria o
// contrato e devolve o código; a tela pergunta a cada 5 s se ficou ativo.

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { getCheckoutAttribution, registrarEvento } from '@/hooks/useLpTracking';
import { digitosFone, docValido, foneValido, mascaraDoc, mascaraFone, soDigitos } from './pixDoc';
import styles from './PixAutomaticoModal.module.css';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const PIX_OFF = 'Não deu para gerar o Pix automático agora. Tente de novo em instantes.';
const PIX_JA = 'Já existe uma assinatura no Pix para este CPF ou e-mail. Use outro CPF ou CNPJ.';
const PIX_CAMPOS = 'Confira o e-mail e o CPF ou CNPJ.';
const PIX_DOC_ERRO = 'Esse CPF ou CNPJ não confere. Confira os números.';
const PIX_FONE_ERRO = 'Confira o WhatsApp com DDD.';
const MSG_WHATS = 'Oi! Vim pelo site da SolarDoc e quero assinar no Pix.';
// Mesmo texto do MSG.pix(c) do quiz (/diagnostico). Sem código, vale o texto de sempre.
const msgComCodigo = (c: string) => 'Quero saber como assinar o SolarDoc no Pix. Meu código é ' + c + '.';
const CODIGO_RE = /^SD-[A-Z0-9]{4,6}$/;

const ESPERA_TRAVOU_MS = 3 * 60 * 1000;
const ESPERA_MAX_MS = 60 * 60 * 1000;
const COPIADO_MS = 3000;

interface Cobranca {
  id: string;
  payload: string;
  imagem: string;
  temConta: boolean;
  codigo: string; // SD-XXXX, quando a API devolve; '' se não
}

interface Props {
  origem: string;
  whatsappUrl: string; // https://wa.me/<número da 5040>
  onFechar: () => void;
}

type FbqWindow = Window & { fbq?: (...args: unknown[]) => void };

export default function PixAutomaticoModal({ origem, whatsappUrl, onFechar }: Props) {
  const [email, setEmail] = useState('');
  const [fone, setFone] = useState('');
  const [doc, setDoc] = useState('');
  const [erroEmail, setErroEmail] = useState('');
  const [erroFone, setErroFone] = useState('');
  const [erroDoc, setErroDoc] = useState('');
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [pagou, setPagou] = useState(false);
  const [vencido, setVencido] = useState(false);
  const [travou, setTravou] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const painel = useRef<HTMLDivElement>(null);
  const campoEmail = useRef<HTMLInputElement>(null);
  const jaMediu = useRef(false);
  const ocupado = useRef(false);

  const zapUrl = `${whatsappUrl}?text=${encodeURIComponent(cobranca?.codigo ? msgComCodigo(cobranca.codigo) : MSG_WHATS)}`;

  // Abriu: mede uma vez (StrictMode monta duas vezes em dev), guarda quem abriu
  // para devolver o foco, trava a rolagem da página e leva o foco ao 1º campo.
  useEffect(() => {
    const abriu = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    campoEmail.current?.focus();
    if (!jaMediu.current) {
      jaMediu.current = true;
      registrarEvento('pix_abriu', { tela: 'lp', origem });
    }
    return () => {
      document.body.style.overflow = overflow;
      if (abriu && document.contains(abriu)) abriu.focus();
    };
  }, [origem]);

  // Enquanto o pagamento não cai, pergunta a cada 5 s. Para no primeiro "ativo".
  const consultar = useCallback(async (c: Cobranca) => {
    if (ocupado.current) return;
    ocupado.current = true;
    try {
      const { data } = await api.get(`/payments/pix-recorrente/publico/${encodeURIComponent(c.id)}`);
      if (data?.status === 'ativo') {
        registrarEvento('pix_pago', { tela: 'lp', modo: 'automatico', contrato: c.id });
        setPagou(true);
      }
    } catch {
      // Sem rede agora: a próxima rodada tenta de novo.
    } finally {
      ocupado.current = false;
    }
  }, []);

  const polling = cobranca !== null && !pagou && !vencido;
  useEffect(() => {
    if (!polling || !cobranca) return;
    const fim = Date.now() + ESPERA_MAX_MS;
    const iv = setInterval(() => {
      if (Date.now() >= fim) { clearInterval(iv); setVencido(true); return; }
      void consultar(cobranca);
    }, 5000);
    return () => clearInterval(iv);
  }, [polling, cobranca, consultar]);

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

  // Passados 3 minutos sem pagar, oferece o WhatsApp (a consulta segue).
  useEffect(() => {
    if (!polling) { setTravou(false); return; }
    const t = setTimeout(() => setTravou(true), ESPERA_TRAVOU_MS);
    return () => clearTimeout(t);
  }, [polling]);

  function recomecar() {
    setCobranca(null);
    setPagou(false);
    setVencido(false);
    setTravou(false);
    setCopiado(false);
    setSaindo(false);
    setErro('');
  }

  function fbq(nome: string) {
    const w = window as FbqWindow;
    if (w.fbq) w.fbq('track', 'InitiateCheckout', { content_name: nome, value: 67, currency: 'BRL' });
  }

  async function gerar(ev: React.FormEvent) {
    ev.preventDefault();
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
        setErro(PIX_OFF);
        return;
      }
      if (!data.qrPayload || data.status === 'ativo' || !data.id) {
        registrarEvento('pix_falhou', { tela: 'lp', motivo: 'ja_existe' });
        setErro(PIX_JA);
        return;
      }
      setCobranca({
        id: String(data.id),
        payload: data.qrPayload,
        imagem: data.qrImagemBase64 || '',
        temConta: Boolean(data.temConta),
        codigo: typeof data.codigo === 'string' && CODIGO_RE.test(data.codigo) ? data.codigo : '',
      });
      registrarEvento('pix_gerou', { tela: 'lp', modo: 'automatico', contrato: data.id, temConta: data.temConta });
      fbq('vip_pix_auto'); // só depois de chegar o id: um 400 com nova tentativa não conta duas vezes
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      registrarEvento('pix_falhou', { tela: 'lp', motivo: e?.response?.data?.error ?? 'erro-desconhecido' });
      setErro(e?.response?.status === 400 ? PIX_CAMPOS : PIX_OFF);
    } finally {
      setCriando(false);
    }
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

  const imgOk = Boolean(cobranca?.imagem) && /^[A-Za-z0-9+/=]+$/.test(cobranca?.imagem || '');

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
        {pagou ? (
          <>
            <h2 id="pix-modal-titulo" className={styles.titulo}>Pagamento confirmado</h2>
            <p className={styles.sub}>Sua assinatura por Pix está ativa.</p>
            <p className={styles.texto}>
              {cobranca?.temConta
                ? 'Sua conta já existe: é só entrar com o seu e-mail e a plataforma está liberada.'
                : 'Agora crie sua senha para entrar. Usamos o mesmo e-mail que você informou aqui.'}
            </p>
            <a
              className={styles.btnPrincipal}
              href={cobranca?.temConta
                ? '/auth?mode=login'
                : `/auth?mode=register&email=${encodeURIComponent(email.trim().toLowerCase())}`}
            >
              {cobranca?.temConta ? 'Entrar na plataforma' : 'Criar minha senha'}
            </a>
          </>
        ) : cobranca ? (
          <>
            <h2 id="pix-modal-titulo" className={styles.titulo}>Pague para ativar</h2>
            {saindo ? (
              <div className={styles.travou} role="alertdialog" aria-label="Sair sem pagar?">
                <p>Se você já pagou, o acesso chega no seu e-mail do mesmo jeito.</p>
                <button type="button" className={styles.btnSecundario} onClick={onFechar}>Fechar mesmo assim</button>
                <button type="button" className={styles.btnPrincipal} onClick={() => setSaindo(false)} autoFocus>Voltar ao código</button>
              </div>
            ) : vencido ? (
              <>
                <p className={styles.texto} role="status">O código venceu. Gere outro.</p>
                <button type="button" className={styles.btnPrincipal} onClick={recomecar}>Gerar outro Pix</button>
              </>
            ) : (
              <>
                <button type="button" className={styles.btnPrincipal} onClick={copiar}>
                  {copiado ? 'Código copiado' : 'Copiar código Pix'}
                </button>
                <ol className={styles.passos}>
                  <li>Toque em Copiar código Pix.</li>
                  <li>No app do seu banco, escolha Pix copia e cola.</li>
                  <li>Cole o código e autorize o Pix automático.</li>
                </ol>
                <label className={styles.rotulo} htmlFor="pix-codigo">Pix copia e cola</label>
                <textarea id="pix-codigo" className={styles.codigo} readOnly rows={4} value={cobranca.payload} />
                {imgOk && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={styles.qr}
                      src={`data:image/png;base64,${cobranca.imagem}`}
                      alt="QR Code do Pix automático"
                    />
                    <p className={styles.legendaQr}>Ou leia o QR em outro aparelho</p>
                  </>
                )}
                <p className={styles.espera} role="status">Esperando o pagamento.</p>
                {travou && (
                  <div className={styles.ajudaCarla}>
                    <p>Ficou alguma dúvida? A Carla responde agora no WhatsApp.</p>
                    <a
                      className={styles.btnPrincipal}
                      href={zapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => registrarEvento('pix_ajuda_whatsapp', { tela: 'lp', modo: 'automatico' })}
                    >
                      Falar com a Carla agora
                    </a>
                  </div>
                )}
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
              autoComplete="email" maxLength={120} value={email}
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
              aria-describedby="pix-fone-dica pix-fone-erro" aria-invalid={erroFone ? true : undefined}
            />
            <p id="pix-fone-dica" className={styles.dica}>Com DDD.</p>
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
