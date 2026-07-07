'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ScanLine, Camera, Upload, FileText, CheckCircle2,
  AlertTriangle, Zap, ArrowRight, RefreshCw, Sparkles,
} from 'lucide-react';
import api from '@/services/api';
import { clientsApi } from '@/services/api';
import ClientModal from '@/components/ClientModal/ClientModal';
import './escanear-conta.css';

// Telemetria de uso (mesma da calculadora/inventário — NÃO abate crédito).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'escanear_conta', event_type }).catch(() => {});
}

interface Client {
  id: string;
  nome: string;
  tipo: 'PF' | 'PJ';
  cpf_cnpj?: string;
  cidade?: string;
  uf?: string;
  concessionaria?: string;
}

interface ScanResult {
  cliente: Partial<Client> & Record<string, string>;
  detectado: {
    consumo_medio_kwh: number | null;
    historico_kwh: number[];
    cpf_mascarado: boolean;
    confianca: 'alta' | 'media' | 'baixa';
    observacoes: string;
  };
}

const MAX_DIM = 1568; // Anthropic recomenda ≤1568px no maior lado
const MAX_B64 = 4_000_000; // teto de body seguro pro serverless (~3MB reais)

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Não consegui abrir o arquivo.'));
    reader.readAsDataURL(file);
  });
}

// Imagem: redimensiona e recomprime pra JPEG leve (rápido de subir + dentro do
// limite da Anthropic). PDF: manda como está.
async function prepareFile(file: File): Promise<{ base64: string; media_type: string; preview: string; isPdf: boolean }> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const dataUrl = await readAsDataUrl(file);

  if (isPdf) {
    return { base64: dataUrl.split(',')[1] || '', media_type: 'application/pdf', preview: '', isPdf: true };
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não consegui ler essa imagem. Tente outra foto.'));
    image.src = dataUrl;
  });

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não suporta o processamento da imagem.');
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: jpeg.split(',')[1] || '', media_type: 'image/jpeg', preview: jpeg, isPdf: false };
}

function apiError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || '';
}

type Phase = 'idle' | 'reading' | 'error';

export default function EscanearContaPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [created, setCreated] = useState<Client | null>(null);
  const router = useRouter();

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      logUso('open');
    }
  }, []);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setErrorMsg('');
    setCreated(null);
    setPhase('reading');
    logUso('scan_start');
    try {
      const prepared = await prepareFile(file);
      if (!prepared.base64) throw new Error('Arquivo vazio ou ilegível.');
      if (prepared.base64.length > MAX_B64) {
        throw new Error('Arquivo muito pesado. Envie uma foto da conta (em vez do PDF) ou um PDF menor.');
      }
      setPreview(prepared.preview);
      setPreviewIsPdf(prepared.isPdf);

      const { data } = await clientsApi.scan(prepared.base64, prepared.media_type);
      setScan(data as ScanResult);
      setModalOpen(true);
      setPhase('idle');
      logUso('scan_success');
    } catch (err) {
      const msg = apiError(err) || (err instanceof Error ? err.message : '') || 'Não consegui ler a conta. Tente novamente.';
      setErrorMsg(msg);
      setPhase('error');
      logUso('scan_fail');
    }
  }

  function reset() {
    setScan(null);
    setModalOpen(false);
    setPreview('');
    setPreviewIsPdf(false);
    setCreated(null);
    setErrorMsg('');
    setPhase('idle');
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleSaved(client: Client) {
    setCreated(client);
    setModalOpen(false);
    logUso('cliente_criado');
  }

  // Gera proposta JÁ preenchida: semeia o rascunho que o PropostaSolarForm
  // restaura no mount (chave estável 'proposta-solar-draft-v1'). Preenche nome,
  // cidade/UF e o consumo (kWh) — que a proposta usa pra dimensionar o sistema.
  function gerarProposta() {
    try {
      const cidadeUf = [created?.cidade, created?.uf].filter(Boolean).join('/');
      const consumo = scan?.detectado?.consumo_medio_kwh;
      localStorage.setItem('proposta-solar-draft-v1', JSON.stringify({
        clienteNome: created?.nome || '',
        cidadeUf,
        fields: consumo ? { consumo_kwh: String(consumo) } : {},
      }));
    } catch { /* localStorage indisponível: segue sem prefill */ }
    logUso('gerar_proposta_prefill');
    router.push('/documentos?tipo=proposta');
  }

  const det = scan?.detectado;

  // Aviso contextual dentro do modal de revisão
  const notice = det ? (
    <>
      <strong style={{ color: '#22c55e' }}>Li a conta e preenchi os campos abaixo.</strong>{' '}
      Confira e complete o que faltar.
      {det.consumo_medio_kwh != null && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#fbbf24', fontWeight: 700 }}>
          <Zap size={15} strokeWidth={2.2} /> Consumo médio detectado: {det.consumo_medio_kwh.toLocaleString('pt-BR')} kWh/mês
        </div>
      )}
      {det.cpf_mascarado && (
        <div style={{ marginTop: 6, color: '#f59e0b' }}>
          O CPF/CNPJ veio <strong>mascarado</strong> na conta — digite o número completo.
        </div>
      )}
      {det.confianca === 'baixa' && (
        <div style={{ marginTop: 6, color: '#f59e0b' }}>
          A leitura ficou incerta — confira todos os campos com atenção.
        </div>
      )}
      {det.observacoes && (
        <div style={{ marginTop: 6, color: 'var(--color-text-muted, #94a3b8)' }}>
          Obs.: {det.observacoes}
        </div>
      )}
    </>
  ) : null;

  return (
    <div className="ec-page">
      {/* Inputs escondidos: câmera (mobile) e arquivo (foto ou PDF) */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {/* Foto e PDF: caminho de PDF verificado ao vivo (5/5 distribuidoras,
          jul/2026) — o modelo aceita o bloco 'document' application/pdf. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <header className="ec-hero">
        <div className="ec-heroBadge"><ScanLine size={16} strokeWidth={2.2} /> Escanear Conta</div>
        <h1 className="ec-heroTitle">Tire uma foto da conta de luz e cadastre o cliente sozinho</h1>
        <p className="ec-heroSub">
          A IA lê a fatura, preenche nome, endereço, concessionária, padrão de energia e mais.
          Você só confere e salva.
        </p>
      </header>

      {/* ── SUCESSO ── */}
      {created ? (
        <section className="ec-card ec-success">
          <div className="ec-successIcon"><CheckCircle2 size={40} strokeWidth={2} /></div>
          <h2 className="ec-successTitle">Cliente cadastrado!</h2>
          <p className="ec-successName">{created.nome}</p>
          <div className="ec-successActions">
            <button className="ec-primaryBtn" onClick={gerarProposta}>
              <Sparkles size={17} strokeWidth={2} /> Gerar proposta com os dados preenchidos
            </button>
            <Link href="/clientes" className="ec-ghostBtn">Ver em Clientes</Link>
            <button className="ec-ghostBtn" onClick={reset}>
              <RefreshCw size={15} strokeWidth={2} /> Escanear outra
            </button>
          </div>
        </section>

      ) : phase === 'reading' ? (
        <section className="ec-card ec-reading">
          {preview && !previewIsPdf ? (
            <img src={preview} alt="Conta enviada" className="ec-readingImg" />
          ) : (
            <div className="ec-readingImg ec-pdfThumb"><FileText size={40} strokeWidth={1.6} /></div>
          )}
          <div className="ec-spinner" />
          <p className="ec-readingText">Lendo a conta…</p>
          <p className="ec-readingHint">Extraindo os dados do cliente. Leva alguns segundos.</p>
        </section>

      ) : scan && !modalOpen ? (
        <section className="ec-card ec-summary">
          <div className="ec-summaryHead">
            <CheckCircle2 size={22} strokeWidth={2} color="#22c55e" />
            <span>Li a conta. Revise os dados para cadastrar o cliente.</span>
          </div>
          {det?.consumo_medio_kwh != null && (
            <div className="ec-chip"><Zap size={14} strokeWidth={2.2} /> {det.consumo_medio_kwh.toLocaleString('pt-BR')} kWh/mês</div>
          )}
          <div className="ec-summaryActions">
            <button className="ec-primaryBtn" onClick={() => setModalOpen(true)}>
              Revisar e cadastrar <ArrowRight size={16} strokeWidth={2.2} />
            </button>
            <button className="ec-ghostBtn" onClick={reset}>
              <RefreshCw size={15} strokeWidth={2} /> Escanear outra
            </button>
          </div>
        </section>

      ) : (
        <>
          <section
            className="ec-drop"
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
          >
            <div className="ec-dropIcon"><Upload size={30} strokeWidth={1.8} /></div>
            <p className="ec-dropText">Anexar foto ou PDF da conta</p>
            <p className="ec-dropHint">Arraste aqui ou clique para escolher — JPG, PNG ou PDF</p>
          </section>

          <div className="ec-btnRow">
            <button className="ec-primaryBtn ec-cameraBtn" onClick={() => cameraRef.current?.click()}>
              <Camera size={18} strokeWidth={2} /> Tirar foto agora
            </button>
            <button className="ec-ghostBtn" onClick={() => fileRef.current?.click()}>
              <FileText size={16} strokeWidth={2} /> Escolher arquivo
            </button>
          </div>

          {errorMsg && (
            <div className="ec-error">
              <AlertTriangle size={16} strokeWidth={2} /> {errorMsg}
            </div>
          )}

          <div className="ec-steps">
            <div className="ec-step"><span className="ec-stepNum">1</span> Fotografe ou anexe a conta</div>
            <div className="ec-step"><span className="ec-stepNum">2</span> A IA lê e preenche tudo</div>
            <div className="ec-step"><span className="ec-stepNum">3</span> Você confere e salva o cliente</div>
          </div>
        </>
      )}

      {/* Modal de revisão: reusa o ClientModal em modo criação, pré-preenchido */}
      {modalOpen && scan && (
        <ClientModal
          client={null}
          seed={scan.cliente}
          notice={notice}
          onClose={() => setModalOpen(false)}
          onSave={handleSaved}
        />
      )}
    </div>
  );
}
