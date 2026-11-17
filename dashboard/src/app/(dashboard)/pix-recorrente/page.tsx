'use client';

// Tela do Pix recorrente. Existe porque a Stripe não entrega Pix Automático pra
// conta brasileira (a doc deles é explícita, e na nossa conta o Pix nem aparece
// como disponível) — quem cobra por aqui é o Asaas.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import api from '@/services/api';
import { registrarEvento } from '@/hooks/useLpTracking';
import { LinhaAdicionaisPix, corpoAdicionaisDaUrl } from '@/components/CheckoutAdicional/AdicionaisPix';
import { primeiraVezPago, usePixEspera, validadeTexto, type PixStatus } from '@/lib/pixEspera';
import PixCartao from '@/components/PixPago/PixCartao';
import styles from './pix-recorrente.module.css';
const ESPERA_MAX_MS = 60 * 60 * 1000; // sem expiraEm da api, a tela espera 60 min

// PREÇO ÚNICO: uma assinatura só. Aqui eram dois botões (PRO R$27 × VIP R$67) —
// virou resumo do que vai ser cobrado. O estado `plano` continua em 'ilimitado'
// porque é ele que o Asaas recebe.
const ASSINATURA = {
  preco: '67',
  desc: 'Documentos ilimitados, histórico permanente e todo recurso novo.',
};

interface Contrato {
  modo: 'automatico' | 'assinatura';
  status: string;
  plano: string;
  valor: number; totalMensal?: number; // totalMensal: com adicionais (bump do /assinar) junto; ausente = só o plano
  qrPayload: string | null;
  ultimoPagamentoEm: string | null;
  proximoVencimento: string | null;
  // Campos somados pela api em 16/11 (ausentes na api antiga).
  pago?: boolean;
  pagoEm?: string | null;
  situacao?: string | null;
  criadoEm?: string | null;
  expiraEm?: string | null;
}

interface Criado {
  modo: 'automatico' | 'assinatura';
  plano: string;
  valor: number;         // mensalidade cheia
  primeiroMes: number;   // com cupom, é o que ele paga agora
  totalMensal?: number;  // com adicionais (bump): o mês inteiro; ausente = só o plano (o 1º pagamento vem na `instrucao`)
  cupom: string | null;
  qrPayload: string | null;
  qrImagemBase64: string | null;
  status: string;
  instrucao: string;
  id?: string | null;
  expiraEm?: string | null;
}

// Máscara só visual — quem valida CPF/CNPJ de verdade é o Asaas.
function mascaraDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export default function PixRecorrentePage() {
  const { user } = useDashboard();
  // Cupom vem do link que o Thiago manda (/assinar?cupom=… encaminha pra cá).
  const cupomUrl = (useSearchParams().get('cupom') || '').trim().toUpperCase();

  const [carregando, setCarregando] = useState(true);
  const [disponivel, setDisponivel] = useState(true);
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [acessoAte, setAcessoAte] = useState<string | null>(null);

  // Fixo: preço único. Continua sendo state só porque é o valor mandado pro Asaas.
  const [plano] = useState('ilimitado');
  const [doc, setDoc] = useState('');
  const [fone, setFone] = useState('');
  const [criando, setCriando] = useState(false);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [cupomOk, setCupomOk] = useState<{ codigo: string; primeiroMes: number; precoCheio: number } | null>(null);

  const [fimMs, setFimMs] = useState(0); // até quando o código gerado aqui vale
  const jaMediu = useRef(false);

  // CHEGOU. Mesmo evento da tela pública, com `tela` diferente — os dois
  // caminhos de Pix caem no mesmo funil e dá pra comparar quem tem conta com
  // quem veio do anúncio sem conta nenhuma.
  useEffect(() => {
    if (jaMediu.current) return;
    jaMediu.current = true;
    registrarEvento('pix_abriu', { tela: 'recorrente', cupom: cupomUrl || null });
  }, [cupomUrl]);

  // Confere o cupom do link. Inválido/vencido some em silêncio — a pessoa
  // assina pelo preço normal em vez de ver um erro que não sabe resolver.
  useEffect(() => {
    if (!cupomUrl) return;
    let vivo = true;
    api.get(`/payments/cupom/${encodeURIComponent(cupomUrl)}`, { params: { plano } })
      .then(({ data }) => {
        if (vivo && data?.valido) setCupomOk({ codigo: data.codigo, primeiroMes: data.primeiroMes, precoCheio: data.precoCheio });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [cupomUrl, plano]);

  // Estado da assinatura. Só lê: o "pagou" é medido pela espera abaixo, uma vez por contrato.
  const carregarStatus = useCallback(async (): Promise<Contrato | null> => {
    try {
      const { data } = await api.get('/payments/pix-recorrente', { timeout: 12000 });
      setDisponivel(data.disponivel !== false);
      setContrato(data.contrato ?? null);
      setAcessoAte(data.acessoAte ?? null);
      return (data.contrato ?? null) as Contrato | null;
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { void carregarStatus().catch(() => {}); }, [carregarStatus]);

  // Código gerado aqui: pergunta a cada 3 s e na volta do banco. Sem contrato na resposta (a lista
  // da api não traz recusado), espera até o prazo e diz que venceu, sem afirmar que nada foi cobrado.
  const chaveEspera = criado ? (criado.id || 'recorrente') : null;
  // Aqui a leitura é a da própria conta (não a pública): não há ?qr=1, o QR vem da criação.
  const buscar = useCallback(async (): Promise<PixStatus | null> => {
    const c = await carregarStatus();
    return c ?? { status: 'desconhecido' };
  }, [carregarStatus]);
  const aoPagar = useCallback((d: PixStatus) => {
    const id = criado?.id || `rec-${(d as Contrato).criadoEm || ''}`;
    if (!primeiraVezPago(id)) return;
    registrarEvento('pix_pago', { tela: 'recorrente', modo: d.modo ?? null });
  }, [criado?.id]);
  const est = usePixEspera({ chave: chaveEspera, fimMs, retomada: false, temImagem: true, buscar, aoPagar });
  const pagou = criado !== null && est.fase === 'pago', encerrou = criado !== null && est.fase === 'encerrado';

  async function criar() {
    setCriando(true);
    setErro(null);
    try {
      const { data } = await api.post('/payments/pix-recorrente', {
        plan: plano,
        cpfCnpj: doc.replace(/\D/g, ''),
        whatsapp: fone.replace(/\D/g, '') || undefined,
        cupom: cupomUrl || undefined, ...corpoAdicionaisDaUrl(), // ferramentas do order bump do /assinar
      });
      const expira = typeof data?.expiraEm === 'string' ? Date.parse(data.expiraEm) : NaN;
      setFimMs(Number.isFinite(expira) && expira > Date.now() + 60 * 1000 ? expira : Date.now() + ESPERA_MAX_MS);
      setCopiado(false);
      setCriado(data);
      registrarEvento('pix_gerou', { tela: 'recorrente', modo: data?.modo ?? null, contrato: data?.id ?? null });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      registrarEvento('pix_falhou', { tela: 'recorrente', motivo: e?.response?.data?.error ?? 'erro-desconhecido' });
      setErro(e?.response?.data?.error ?? 'Não consegui gerar o Pix agora. Tenta de novo em instantes.');
    } finally {
      setCriando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      registrarEvento('pix_copiou', { tela: 'recorrente' });
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      (document.getElementById('pix-codigo') as HTMLTextAreaElement | null)?.select();
      setErro('Seu navegador bloqueou a cópia. Selecione o código e copie na mão.');
    }
  }

  async function cancelar() {
    if (!confirm('Cancelar a cobrança mensal por Pix? Seu acesso continua até o fim do período já pago.')) return;
    try {
      const { data } = await api.post('/payments/pix-recorrente/cancelar');
      alert(data.mensagem);
      setCriado(null);
      await carregarStatus();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setErro(e?.response?.data?.error ?? 'Não consegui cancelar agora.');
    }
  }

  if (!user) return null;
  if (carregando) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Pagar por Pix</h1>
        <p className={styles.subtitle}>Carregando...</p>
      </div>
    );
  }

  if (!disponivel) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Pagar por Pix</h1>
        <p className={styles.subtitle}>Assinatura mensal no Pix, sem cartão.</p>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Ainda não está no ar</div>
          <p className={styles.cardText}>
            Estamos ligando o pagamento recorrente por Pix. Enquanto isso, fale com a gente no
            WhatsApp que liberamos seu acesso na hora: (34) 99816-5040.
          </p>
        </div>
      </div>
    );
  }

  const ativo = contrato?.status === 'ativo';
  const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

  const cartaoPix = criado?.qrPayload ? (
    <PixCartao
      est={est}
      payload={criado.qrPayload}
      imagem={criado.qrImagemBase64 || ''}
      validade={fimMs && criado.expiraEm ? validadeTexto(fimMs) : ''}
      instrucao={criado.instrucao}
      copiado={copiado}
      onCopiar={() => copiar(criado.qrPayload as string)}
      temConta
      logado
      hrefConta="/dashboard"
      onGerar={() => { setCriado(null); setCopiado(false); setErro(null); }}
      cartao={null}
      css={{ card: `${styles.card} ${styles.cardPix}`, titulo: styles.cardTitleGrande, texto: `${styles.cardText} ${styles.instrucao}`, btn: styles.btnPrimary, btn2: styles.btnSecondary }}
    />
  ) : null;

  // Código gerado aqui e já pago (ou vencido): o resultado ocupa a tela inteira.
  if (pagou || encerrou) return <div className={styles.page}>{cartaoPix}</div>;

  const esperando = Boolean(criado) && !ativo;

  return (
    <div className={styles.page}>
      {!esperando && (
        <>
          <h1 className={styles.title}>Pagar por Pix</h1>
          <p className={styles.subtitle}>Assinatura mensal no Pix, sem precisar de cartão de crédito.</p>
        </>
      )}

      {ativo && contrato && (
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            Sua assinatura por Pix está ativa <span className={`${styles.badge} ${styles.badgeOk}`}>ativa</span>
          </div>
          <p className={styles.cardText}>
            R$ {contrato.totalMensal ?? contrato.valor}/mês ·{' '}
            {contrato.modo === 'automatico'
              ? 'débito automático autorizado no seu banco'
              : 'cobrança mensal por Pix'}
            .<br />
            Acesso garantido até <strong>{dataBR(acessoAte)}</strong>
            {contrato.ultimoPagamentoEm ? ` · último pagamento em ${dataBR(contrato.ultimoPagamentoEm)}` : ''}.
          </p>
          {contrato.modo === 'assinatura' && (
            <div className={styles.aviso}>
              Todo mês enviamos um novo código Pix no seu WhatsApp e e-mail. Assim que você paga,
              o acesso renova sozinho. Não precisa mandar comprovante.
            </div>
          )}
          <div className={styles.row}>
            <button className={styles.btnLink} onClick={cancelar}>Cancelar cobrança mensal</button>
          </div>
        </div>
      )}

      {esperando && (cartaoPix ?? (
        // Cobrança criada mas QR não veio: dizer isso é melhor que
        // mostrar uma caixa vazia e o cliente achar que travou.
        <div className={styles.card}>
          <div className={styles.aviso}>
            A cobrança foi criada, mas o código demorou a chegar. Recarregue a página em
            alguns segundos ou chame a gente no WhatsApp (34) 99816-5040.
          </div>
        </div>
      ))}

      {!ativo && !criado && (
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
          <LinhaAdicionaisPix plano={Number(ASSINATURA.preco)} cupom={cupomOk} className={styles.cardText} />

          <label className={styles.label} htmlFor="doc">CPF ou CNPJ do pagador</label>
          <input
            id="doc"
            className={styles.input}
            value={doc}
            onChange={(e) => setDoc(mascaraDoc(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
          />

          <label className={styles.label} htmlFor="fone">WhatsApp (para avisar do vencimento)</label>
          <input
            id="fone"
            className={styles.input}
            value={fone}
            onChange={(e) => setFone(e.target.value)}
            placeholder="(34) 99999-9999"
            inputMode="tel"
          />

          <div className={styles.row}>
            <button
              className={styles.btnPrimary}
              onClick={criar}
              disabled={criando || doc.replace(/\D/g, '').length < 11}
            >
              {criando ? 'Gerando Pix...' : 'Gerar Pix'}
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
    </div>
  );
}
