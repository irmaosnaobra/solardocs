'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import styles from './pix-automatico.module.css';

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
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [cupomOk, setCupomOk] = useState<{ codigo: string; primeiroMes: number; precoCheio: number } | null>(null);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cupom do link. Inválido some em silêncio — a pessoa assina pelo preço
  // normal em vez de ver um erro que ela não sabe resolver.
  useEffect(() => {
    if (!cupomUrl) return;
    api.get(`/payments/cupom/${encodeURIComponent(cupomUrl)}`, { params: { plano } })
      .then(({ data }) => { if (data?.valido) setCupomOk(data); })
      .catch(() => setCupomOk(null));
  }, [cupomUrl, plano]);

  // Enquanto o pagamento não cai, a tela pergunta sozinha pela chave pública
  // (o uuid do contrato). Para no primeiro "ativo".
  const consultar = useCallback(async () => {
    if (!criado?.id) return;
    try {
      const { data } = await api.get(`/payments/pix-recorrente/publico/${criado.id}`);
      setStatus(data?.status ?? null);
    } catch {
      // Falha de rede no meio da espera não vira erro na tela: a próxima rodada
      // tenta de novo e o pagamento não depende desta consulta.
    }
  }, [criado?.id]);

  useEffect(() => {
    if (!criado?.id || status === 'ativo') {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(() => { void consultar(); }, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [criado?.id, status, consultar]);

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
      setCriado(data as Criado);
      setStatus((data as Criado).status);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setErro(e?.response?.data?.error ?? 'Não consegui gerar o Pix agora. Tenta de novo em instantes.');
    } finally {
      setCriando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Seu navegador bloqueou a cópia. Selecione o código e copie na mão.');
    }
  }

  // ── pago ───────────────────────────────────────────────────────────────────
  if (status === 'ativo') {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Pagamento confirmado</h1>
        <p className={styles.subtitle}>Sua assinatura por Pix está ativa.</p>
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            Tudo certo <span className={`${styles.badge} ${styles.badgeOk}`}>ativa</span>
          </div>
          <p className={styles.cardText}>
            {criado?.temConta
              ? 'Sua conta já existe: é só entrar com o seu e-mail e a plataforma está liberada.'
              : 'Agora crie sua senha para entrar. Usamos o mesmo e-mail que você informou aqui.'}
          </p>
          <div className={styles.row}>
            <a
              className={styles.btnPrimary}
              href={criado?.temConta
                ? '/auth?mode=login'
                : `/auth?mode=register&email=${encodeURIComponent(email.trim().toLowerCase())}`}
            >
              {criado?.temConta ? 'Entrar na plataforma' : 'Criar minha senha'}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Não tem cartão? Dá pra assinar no Pix</h1>
      <p className={styles.subtitle}>
        Mesma plataforma, mesmo preço — a mensalidade sai no Pix e você não precisa de cartão de crédito.
      </p>

      {criado ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Pague para ativar</div>
          <p className={styles.cardText}>{criado.instrucao}</p>

          <div className={styles.pagamento} style={{ marginTop: 18 }}>
            {criado.qrImagemBase64 && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                className={styles.qr}
                src={`data:image/png;base64,${criado.qrImagemBase64}`}
                alt="QR Code do Pix"
              />
            )}
            <div className={styles.pagamentoLado}>
              {criado.qrPayload ? (
                <>
                  <label className={styles.label}>Pix copia e cola</label>
                  <textarea className={styles.copiaCola} readOnly value={criado.qrPayload} rows={4} />
                  <div className={styles.row}>
                    <button className={styles.btnPrimary} onClick={() => copiar(criado.qrPayload as string)}>
                      {copiado ? 'Código copiado' : 'Copiar código'}
                    </button>
                    <span className={styles.badge}>aguardando pagamento</span>
                  </div>
                </>
              ) : (
                // Cobrança criada mas QR não veio: dizer isso é melhor que mostrar
                // uma caixa vazia e o cliente achar que travou.
                <div className={styles.aviso}>
                  A cobrança foi criada, mas o código demorou a chegar. Recarregue a página em
                  alguns segundos ou chame a gente no WhatsApp (34) 99816-5040.
                </div>
              )}

              <ol className={styles.passos}>
                <li>Abra o app do seu banco e pague o Pix acima.</li>
                {criado.modo === 'automatico'
                  ? <li>O banco vai perguntar se você autoriza a cobrança mensal de R$ {criado.valor} — confirme.</li>
                  : <li>Todo mês você recebe um novo código; a confirmação é automática.</li>}
                <li>Esta tela libera seu acesso sozinha assim que o pagamento cair.</li>
              </ol>
            </div>
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

          <div className={styles.aviso}>
            O Pix é da <strong>AIOROS LTDA (CNPJ 63.636.043/0001-88)</strong>. Se o seu banco já
            suporta Pix Automático, a mensalidade passa a ser debitada sozinha — e você cancela
            quando quiser, aqui ou no próprio app do banco.
          </div>
        </div>
      )}

      {erro && <p className={styles.erro}>{erro}</p>}

      {/* Cartão continua a um clique: quem só queria trocar o cartão não fica preso no Pix. */}
      {!criado && (
        <p className={styles.cardText} style={{ textAlign: 'center', marginTop: 18 }}>
          Prefere cartão de crédito?{' '}
          <a className={styles.btnLink} href={`/assinar${cupomUrl ? `?cupom=${encodeURIComponent(cupomUrl)}` : ''}`}>
            Voltar para o checkout no cartão
          </a>
        </p>
      )}
    </div>
  );
}
