'use client';

// Tela do Pix recorrente. Existe porque a Stripe não entrega Pix Automático pra
// conta brasileira (a doc deles é explícita, e na nossa conta o Pix nem aparece
// como disponível) — quem cobra por aqui é o Asaas.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import api from '@/services/api';
import { registrarEvento } from '@/hooks/useLpTracking';
import styles from './pix-recorrente.module.css';

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
  valor: number;
  qrPayload: string | null;
  ultimoPagamentoEm: string | null;
  proximoVencimento: string | null;
}

interface Criado {
  modo: 'automatico' | 'assinatura';
  plano: string;
  valor: number;         // mensalidade cheia
  primeiroMes: number;   // com cupom, é o que ele paga agora
  cupom: string | null;
  qrPayload: string | null;
  qrImagemBase64: string | null;
  status: string;
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

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const carregarStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/payments/pix-recorrente');
      setDisponivel(data.disponivel !== false);
      // Fecha o funil na própria tela: dispara UMA vez, na virada pra ativo.
      // Sem a comparação com o estado anterior, cada rodada do poll (5 em 5
      // segundos) mandaria um "pagou" novo e o número viraria ficção.
      setContrato((antes) => {
        const agora = data.contrato ?? null;
        if (agora?.status === 'ativo' && antes?.status !== 'ativo') {
          registrarEvento('pix_pago', { tela: 'recorrente', modo: agora.modo ?? null });
        }
        return agora;
      });
      setAcessoAte(data.acessoAte ?? null);
      return data.contrato?.status as string | undefined;
    } catch {
      return undefined;
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregarStatus(); }, [carregarStatus]);

  // Enquanto o pagamento não cai, a tela pergunta sozinha — o cliente não precisa
  // recarregar nem avisar ninguém. Para no primeiro "ativo".
  useEffect(() => {
    if (!criado || contrato?.status === 'ativo') {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(() => { void carregarStatus(); }, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [criado, contrato?.status, carregarStatus]);

  async function criar() {
    setCriando(true);
    setErro(null);
    try {
      const { data } = await api.post('/payments/pix-recorrente', {
        plan: plano,
        cpfCnpj: doc.replace(/\D/g, ''),
        whatsapp: fone.replace(/\D/g, '') || undefined,
        cupom: cupomUrl || undefined,
      });
      setCriado(data);
      registrarEvento('pix_gerou', { tela: 'recorrente', modo: data?.modo ?? null, contrato: data?.id ?? null });
      await carregarStatus();
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
      setTimeout(() => setCopiado(false), 2500);
    } catch {
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

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Pagar por Pix</h1>
      <p className={styles.subtitle}>Assinatura mensal no Pix, sem precisar de cartão de crédito.</p>

      {ativo && contrato && (
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            Sua assinatura por Pix está ativa <span className={`${styles.badge} ${styles.badgeOk}`}>ativa</span>
          </div>
          <p className={styles.cardText}>
            R$ {contrato.valor}/mês ·{' '}
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
              o acesso renova sozinho — não precisa mandar comprovante.
            </div>
          )}
          <div className={styles.row}>
            <button className={styles.btnLink} onClick={cancelar}>Cancelar cobrança mensal</button>
          </div>
        </div>
      )}

      {!ativo && criado && (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Pague para ativar</div>
          <p className={styles.cardText}>{criado.instrucao}</p>

          <div className={styles.pagamento} style={{ marginTop: 18 }}>
            {criado.qrImagemBase64 && (
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
                // Cobrança criada mas QR não veio: dizer isso é melhor que
                // mostrar uma caixa vazia e o cliente achar que travou.
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
      )}

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
