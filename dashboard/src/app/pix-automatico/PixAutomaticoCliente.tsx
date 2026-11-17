'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { registrarEvento } from '@/hooks/useLpTracking';
import {
  guardarPix, lerPixGuardado, limparPixGuardado, primeiraVezPago, usePixEspera, validadeTexto, type PixStatus,
} from '@/lib/pixEspera';
import PixCartao from '@/components/PixPago/PixCartao';
import styles from './pix-automatico.module.css';

const TELA = 'auto'; // chave do contrato guardado no aparelho
const ESPERA_MAX_MS = 60 * 60 * 1000; // sem expiraEm da api

const ASSINATURA = {
  preco: '67',
  desc: 'Documentos ilimitados, histórico permanente e todo recurso novo.',
};

interface Criado {
  id: string | null;
  modo: 'automatico' | 'assinatura';
  plano: string;
  valor: number;
  primeiroMes: number;
  cupom: string | null;
  qrPayload: string | null;
  qrImagemBase64: string | null;
  status: string;
  temConta: boolean;
  instrucao: string;
  expiraEm?: string | null;
}

// O que a tela precisa para esperar: vem do POST ou do aparelho (24 h).
interface Espera {
  id: string;
  payload: string;
  imagem: string;
  temConta: boolean;
  email: string;
  fimMs: number;
  validade: string;
  instrucao: string;
  retomada: boolean;
}

function esperaGuardada(): Espera | null {
  if (typeof window === 'undefined') return null;
  const g = lerPixGuardado(TELA);
  if (!g) return null;
  return {
    id: g.id, payload: g.payload, imagem: '', temConta: g.temConta, email: '', fimMs: g.fimMs,
    validade: g.fimMs > Date.now() ? validadeTexto(g.fimMs) : '', instrucao: '', retomada: true,
  };
}

// Máscara só visual — quem valida CPF/CNPJ de verdade é o Asaas.
function mascaraDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export default function PixAutomaticoCliente() {
  const params = useSearchParams();
  const cupomUrl = (params.get('cupom') || '').trim().toUpperCase();
  // Hoje existe um preço só. O plano continua viajando na URL porque é o que o
  // Asaas recebe — se um dia voltarem dois, ninguém recomeça no plano errado.
  const plano = 'ilimitado';

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState('');
  const [fone, setFone] = useState('');

  const [criando, setCriando] = useState(false);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [espera, setEspera] = useState<Espera | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [cupomOk, setCupomOk] = useState<{ codigo: string; primeiroMes: number; precoCheio: number } | null>(null);

  const jaMediu = useRef(false);
  const leuGuardado = useRef(false);

  // CHEGOU. Este é o número que não existia: até aqui dava pra saber quantos
  // pagaram (linha no banco) e nenhum dos que olharam e foram embora. Uma vez
  // por montagem — StrictMode em dev monta duas vezes e dobraria a contagem.
  useEffect(() => {
    if (jaMediu.current) return;
    jaMediu.current = true;
    registrarEvento('pix_abriu', {
      tela: 'automatico',
      via: params.get('via') || null,
      plano: params.get('plano') || null,
      cupom: cupomUrl || null,
      // `cancelado=1` só existe no cancel_url da Stripe: separa quem desistiu
      // do cartão de quem chegou aqui por link direto.
      doCheckout: params.get('cancelado') === '1',
    });
  }, [params, cupomUrl]);

  // Cupom do link. Inválido some em silêncio — a pessoa assina pelo preço
  // normal em vez de ver um erro que ela não sabe resolver.
  useEffect(() => {
    if (!cupomUrl) return;
    api.get(`/payments/cupom/${encodeURIComponent(cupomUrl)}`, { params: { plano } })
      .then(({ data }) => { if (data?.valido) setCupomOk(data); })
      .catch(() => setCupomOk(null));
  }, [cupomUrl, plano]);

  // Pix gerado nas últimas 24 h neste aparelho: volta ao mesmo código, ou já mostra
  // que foi pago. Lido depois de montar porque o localStorage só existe no cliente.
  useEffect(() => {
    if (leuGuardado.current) return;
    leuGuardado.current = true;
    const g = esperaGuardada();
    if (g) setEspera(g);
  }, []);

  // Enquanto o pagamento não cai, a tela pergunta sozinha pela chave pública
  // (o uuid do contrato) e pergunta na hora quando a pessoa volta do banco.
  const idEspera = espera?.id ?? null;
  const buscar = useCallback(async (comQr: boolean): Promise<PixStatus | null> => {
    if (!idEspera) return null;
    const { data } = await api.get(`/payments/pix-recorrente/publico/${encodeURIComponent(idEspera)}`, { timeout: 12000, ...(comQr ? { params: { qr: 1 } } : {}) });
    return (data ?? null) as PixStatus | null;
  }, [idEspera]);
  // Fecha o funil na PRÓPRIA tela, uma vez por contrato. O banco já sabe quem
  // pagou; o que só daqui se enxerga é que a pessoa estava com a tela aberta.
  const aoPagar = useCallback((d: PixStatus, retomado: boolean) => {
    if (!idEspera || !primeiraVezPago(idEspera)) return;
    registrarEvento('pix_pago', { tela: 'automatico', contrato: idEspera, modo: d.modo ?? null, ...(retomado ? { retomado: true } : {}) });
  }, [idEspera]);
  const est = usePixEspera({ chave: idEspera, fimMs: espera?.fimMs ?? 0, retomada: espera?.retomada ?? false, temImagem: Boolean(espera?.imagem), buscar, aoPagar });
  const pagou = espera !== null && est.fase === 'pago';
  const encerrou = espera !== null && est.fase === 'encerrado';
  const sumiu = espera !== null && est.fase === 'sumiu';

  useEffect(() => {
    if (pagou || encerrou || sumiu) limparPixGuardado(TELA);
  }, [pagou, encerrou, sumiu]);

  const docOk = doc.replace(/\D/g, '').length >= 11;
  const podeGerar = Boolean(nome.trim()) && EMAIL_RE.test(email.trim()) && docOk && !criando;

  async function gerar() {
    setCriando(true);
    setErro(null);
    try {
      const { data } = await api.post('/payments/pix-recorrente/publico', {
        plan: plano,
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        cpfCnpj: doc.replace(/\D/g, ''),
        whatsapp: fone.replace(/\D/g, '') || undefined,
        cupom: cupomUrl || undefined,
      });
      const cr = data as Criado;
      setCriado(cr);
      if (cr.id && cr.qrPayload) {
        const expira = typeof cr.expiraEm === 'string' ? Date.parse(cr.expiraEm) : NaN;
        const comExpira = Number.isFinite(expira) && expira > Date.now() + 60 * 1000;
        const nova: Espera = {
          id: String(cr.id), payload: cr.qrPayload, imagem: cr.qrImagemBase64 || '', temConta: Boolean(cr.temConta),
          email: email.trim().toLowerCase(), fimMs: comExpira ? expira : Date.now() + ESPERA_MAX_MS,
          validade: comExpira ? validadeTexto(expira) : '', instrucao: cr.instrucao || '', retomada: false,
        };
        setEspera(nova);
        guardarPix(TELA, { id: nova.id, t: Date.now(), fimMs: nova.fimMs, payload: nova.payload, temConta: nova.temConta });
      } else {
        setEspera(null);
      }
      registrarEvento('pix_gerou', {
        tela: 'automatico',
        modo: (data as Criado).modo,
        contrato: (data as Criado).id,
        temConta: (data as Criado).temConta,
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const motivo = e?.response?.data?.error ?? 'erro-desconhecido';
      // Falha ao gerar é o buraco mais caro do funil: a pessoa QUIS pagar e não
      // conseguiu. Sem isto ela some entre "chegou" e "gerou" sem deixar rastro.
      registrarEvento('pix_falhou', { tela: 'automatico', motivo });
      setErro(e?.response?.data?.error ?? 'Não consegui gerar o Pix agora. Tenta de novo em instantes.');
    } finally {
      setCriando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      registrarEvento('pix_copiou', { tela: 'automatico' });
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      (document.getElementById('pix-codigo') as HTMLTextAreaElement | null)?.select();
      setErro('Seu navegador bloqueou a cópia. Selecione o código e copie na mão.');
    }
  }

  // Venceu ou não foi concluído: volta ao formulário com os dados ainda preenchidos.
  function gerarOutro() {
    limparPixGuardado(TELA);
    setEspera(null);
    setCriado(null);
    setCopiado(false);
    setErro(null);
  }

  const hrefCartao = `/assinar${cupomUrl ? `?cupom=${encodeURIComponent(cupomUrl)}` : ''}`;
  const emailConta = (espera?.email || email).trim().toLowerCase();

  const cartaoPix = espera && (
    <PixCartao
      est={est}
      payload={espera.payload}
      imagem={espera.imagem}
      validade={espera.validade}
      instrucao={espera.instrucao}
      copiado={copiado}
      onCopiar={() => copiar(espera.payload)}
      temConta={espera.temConta}
      hrefConta={espera.temConta
        ? '/auth?mode=login'
        : `/auth?mode=register${emailConta ? `&email=${encodeURIComponent(emailConta)}` : ''}`}
      onGerar={gerarOutro}
      cartao={{ href: hrefCartao }}
      css={{ card: `${styles.card} ${styles.cardPix}`, titulo: styles.cardTitleGrande, texto: `${styles.cardText} ${styles.instrucao}`, btn: styles.btnPrimary, btn2: styles.btnSecondary }}
    />
  );

  // Pago, ou vencido sem pagamento: o resultado ocupa a tela, sem o título de preço.
  if (pagou || encerrou) return <div className={styles.page}>{cartaoPix}</div>;

  const esperando = espera !== null && !sumiu;

  return (
    <div className={styles.page}>
      {!esperando && (
        <>
          <h1 className={styles.title}>Não tem cartão? Dá pra assinar no Pix</h1>
          <p className={styles.subtitle}>
            Mesma plataforma, mesmo preço. A mensalidade sai no Pix e você não precisa de cartão de crédito.
          </p>
        </>
      )}

      {esperando ? cartaoPix : criado && !criado.qrPayload ? (
        // Cobrança criada mas QR não veio: dizer isso é melhor que mostrar uma
        // caixa vazia e o cliente achar que travou.
        <div className={styles.card}>
          <div className={styles.aviso}>
            A cobrança foi criada, mas o código demorou a chegar. Recarregue a página em
            alguns segundos ou chame a gente no WhatsApp (34) 99816-5040.
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Sua assinatura</div>

          {cupomOk && (
            <p className={styles.cardText}>
              Cupom <strong>{cupomOk.codigo}</strong> aplicado: você paga{' '}
              <strong>R$ {cupomOk.primeiroMes} no primeiro mês</strong> e R$ {cupomOk.precoCheio}/mês depois.
            </p>
          )}

          <div className={styles.planos}>
            <div className={`${styles.plano} ${styles.planoAtivo}`}>
              <div className={styles.planoPreco}>R$ {ASSINATURA.preco}<span>/mês</span></div>
              <div className={styles.planoDesc}>{ASSINATURA.desc}</div>
            </div>
          </div>

          <label className={styles.label} htmlFor="nome">Seu nome completo</label>
          <input
            id="nome" className={styles.input} value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como está no seu documento" autoComplete="name"
          />

          <label className={styles.label} htmlFor="email">E-mail</label>
          <input
            id="email" className={styles.input} value={email} type="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com.br" autoComplete="email" inputMode="email"
          />

          <label className={styles.label} htmlFor="doc">CPF ou CNPJ do pagador</label>
          <input
            id="doc" className={styles.input} value={doc}
            onChange={(e) => setDoc(mascaraDoc(e.target.value))}
            placeholder="000.000.000-00" inputMode="numeric"
          />

          <label className={styles.label} htmlFor="fone">WhatsApp (para avisar do vencimento)</label>
          <input
            id="fone" className={styles.input} value={fone}
            onChange={(e) => setFone(e.target.value)}
            placeholder="(34) 99999-9999" inputMode="tel" autoComplete="tel"
          />

          <div className={styles.row}>
            <button className={styles.btnPrimary} onClick={gerar} disabled={!podeGerar}>
              {criando ? 'Gerando Pix...' : 'Gerar Pix da assinatura'}
            </button>
          </div>

          {/* Aqui NÃO entra razão social nem CNPJ (decisão do Thiago, 03/09):
              em tela de cliente a gente é Irmãos na Obra. O nome jurídico do
              recebedor o banco mostra na hora de autorizar, como manda o Pix. */}
          <div className={styles.aviso}>
            Se o seu banco já suporta Pix Automático, a mensalidade passa a ser debitada sozinha —
            e você cancela quando quiser, aqui ou no próprio app do banco.
          </div>
        </div>
      )}

      {erro && <p className={styles.erro}>{erro}</p>}

      {/* Cartão continua a um clique: quem só queria trocar o cartão não fica preso no Pix. */}
      {!esperando && !criado && (
        <p className={styles.cardText} style={{ textAlign: 'center', marginTop: 18 }}>
          Prefere cartão de crédito?{' '}
          <a className={styles.btnLink} href={hrefCartao}>
            Voltar para o checkout no cartão
          </a>
        </p>
      )}
    </div>
  );
}
