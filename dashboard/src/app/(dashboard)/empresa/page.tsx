'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import InfoHint from '@/components/InfoHint/InfoHint';
import PrimeirosPassos from '@/components/PrimeirosPassos/PrimeirosPassos';
import { useDashboard } from '@/contexts/DashboardContext';
import { usuarioComum } from '@/utils/usuarioComum';
import GaleriaPortfolio, { type ImagemObra } from '../documentos/forms/GaleriaPortfolio';
import { maskCpf, maskCnpj, soAlfanum, cnpjValido } from '@/utils/documento';
import styles from './empresa.module.css';

interface Company {
  nome_fantasia?: string;
  id: string;
  nome: string;
  cnpj: string;
  endereco?: string;
  logo_base64?: string;
  cor_marca?: string;
  cor_secundaria?: string;
  socio_adm?: string;
  engenheiro_nome?: string;
  engenheiro_cpf?: string;
  engenheiro_crea?: string;
  engenheiro_rg?: string;
  engenheiro_nacionalidade?: string;
  engenheiro_estado_civil?: string;
  engenheiro_profissao?: string;
  engenheiro_endereco?: string;
  tecnico_nome?: string;
  tecnico_cpf?: string;
  tecnico_rg?: string;
  tecnico_crt_cft?: string;
  tecnico_nacionalidade?: string;
  tecnico_estado_civil?: string;
  tecnico_endereco?: string;
  tecnico2_nome?: string;
  tecnico2_cpf?: string;
  tecnico2_rg?: string;
  tecnico2_crt_cft?: string;
  tecnico2_nacionalidade?: string;
  tecnico2_estado_civil?: string;
  tecnico2_endereco?: string;
  tecnico3_nome?: string;
  tecnico3_cpf?: string;
  tecnico3_rg?: string;
  tecnico3_crt_cft?: string;
  tecnico3_nacionalidade?: string;
  tecnico3_estado_civil?: string;
  tecnico3_endereco?: string;
}

const emptyForm = {
  nome: '', nome_fantasia: '', cnpj: '', endereco: '', cidade: '', logo_base64: '', cor_marca: '', cor_secundaria: '', socio_adm: '', whatsapp: '',
  engenheiro_nome: '', engenheiro_cpf: '', engenheiro_crea: '',
  engenheiro_rg: '', engenheiro_nacionalidade: '', engenheiro_estado_civil: '', engenheiro_profissao: '',
  engenheiro_endereco: '',
  tecnico_nome: '', tecnico_cpf: '',
  tecnico_rg: '', tecnico_crt_cft: '', tecnico_nacionalidade: '', tecnico_estado_civil: '',
  tecnico_endereco: '',
  tecnico2_nome: '', tecnico2_cpf: '',
  tecnico2_rg: '', tecnico2_crt_cft: '', tecnico2_nacionalidade: '', tecnico2_estado_civil: '',
  tecnico2_endereco: '',
  tecnico3_nome: '', tecnico3_cpf: '',
  tecnico3_rg: '', tecnico3_crt_cft: '', tecnico3_nacionalidade: '', tecnico3_estado_civil: '',
  tecnico3_endereco: '',
};

const LIMITE_FOTOS_OBRAS = 12;

type DadosBancarios = {
  banco: string; agencia: string; conta: string; tipo_conta: '' | 'corrente' | 'poupanca';
  titular: string; documento: string; pix: string;
};
const bancarioVazio: DadosBancarios = { banco: '', agencia: '', conta: '', tipo_conta: '', titular: '', documento: '', pix: '' };

/** CPF ou CNPJ do titular. Com letra ou mais de 11 caracteres é CNPJ (o novo aceita letras). */
function maskDocumento(v: string): string {
  const d = soAlfanum(v);
  return /[A-Z]/.test(d) || d.length > 11 ? maskCnpj(d) : maskCpf(d);
}

// Telefone da conta vem só com dígitos (DDD + 8 ou 9). Mostra no mesmo formato do
// placeholder do campo; qualquer coisa fora desse tamanho não é preenchida.
function formatarWhatsapp(v: string): string {
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return '';
}

/** Foto de obra vinda do servidor: só item com `path`; `url` é a miniatura assinada. */
function fotosDoServidor(v: unknown): ImagemObra[] {
  if (!Array.isArray(v)) return [];
  const out: ImagemObra[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.path !== 'string' || !o.path) continue;
    out.push({
      path: o.path,
      ...(typeof o.url === 'string' && o.url ? { url: o.url } : {}),
      ...(typeof o.legenda === 'string' ? { legenda: o.legenda } : {}),
    });
    if (out.length >= LIMITE_FOTOS_OBRAS) break;
  }
  return out;
}

function bancarioDoServidor(v: unknown): DadosBancarios {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...bancarioVazio };
  const o = v as Record<string, unknown>;
  const t = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  return {
    banco: t('banco'), agencia: t('agencia'), conta: t('conta'),
    tipo_conta: o.tipo_conta === 'corrente' || o.tipo_conta === 'poupanca' ? o.tipo_conta : '',
    titular: t('titular'),
    documento: maskDocumento(t('documento')),
    pix: t('pix'),
  };
}

function fmtCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

type CnpjStatus = 'idle' | 'checking' | 'valid' | 'unverified' | 'invalid';

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={styles.infoValue}>{value}</span>
    </div>
  );
}

export default function EmpresaPage() {
  const router = useRouter();
  const { user } = useDashboard();
  const [company, setCompany] = useState<Company | null>(null);
  // Empresa abre SEMPRE no formulário editável (sem etapa de "Editar")
  const [editing, setEditing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Fotos e dados bancários ficam fora do `form` (que só tem texto). Só vão no
  // salvamento se a pessoa mexeu: sem isso, quem nunca abriu estas seções mandaria
  // `[]`/`null` e apagaria o que já estava guardado.
  const [fotosObras, setFotosObras] = useState<ImagemObra[]>([]);
  const [dadosBanc, setDadosBanc] = useState<DadosBancarios>({ ...bancarioVazio });
  const fotosMexidas = useRef(false);
  const bancoMexido = useRef(false);

  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>('idle');
  const [cnpjError, setCnpjError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [isWelcome, setIsWelcome] = useState(false);
  // Veio do link de criar senha depois de pagar (?reset=ok): mesma boas-vindas do pagante.
  const [veioDaSenha, setVeioDaSenha] = useState(false);
  const [welcomePlan, setWelcomePlan] = useState<string | null>(null);
  // CNPJ que já foi validado nesta sessão de edição
  const validatedCnpjRef = useRef('');
  // O WhatsApp da conta entra no campo vazio uma vez só: se a pessoa apagar, não volta.
  const whatsappPreenchido = useRef(false);

  useEffect(() => {
    // Vindo direto do checkout do Stripe (?welcome=1&plan=ilimitado|pro)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setIsWelcome(params.get('welcome') === '1');
      setVeioDaSenha(params.get('reset') === 'ok');
      setWelcomePlan(params.get('plan'));
    }
  }, []);

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company) {
        const c = data.company;
        setCompany(c);
        setFotosObras(fotosDoServidor(c.fotos_obras));
        setDadosBanc(bancarioDoServidor(c.dados_bancarios));
        setForm({
          nome: c.nome || '', nome_fantasia: c.nome_fantasia || '', cnpj: c.cnpj || '', endereco: c.endereco || '', cidade: c.cidade || '',
          logo_base64: c.logo_base64 || '', cor_marca: c.cor_marca || '', cor_secundaria: c.cor_secundaria || '', socio_adm: c.socio_adm || '', whatsapp: c.whatsapp || '',
          engenheiro_nome: c.engenheiro_nome || '', engenheiro_cpf: c.engenheiro_cpf || '',
          engenheiro_crea: c.engenheiro_crea || '', engenheiro_rg: c.engenheiro_rg || '',
          engenheiro_nacionalidade: c.engenheiro_nacionalidade || '', engenheiro_estado_civil: c.engenheiro_estado_civil || '',
          engenheiro_profissao: c.engenheiro_profissao || '', engenheiro_endereco: c.engenheiro_endereco || '',
          tecnico_nome: c.tecnico_nome || '', tecnico_cpf: c.tecnico_cpf || '',
          tecnico_rg: c.tecnico_rg || '', tecnico_crt_cft: c.tecnico_crt_cft || '',
          tecnico_nacionalidade: c.tecnico_nacionalidade || '',
          tecnico_estado_civil: c.tecnico_estado_civil || '', tecnico_endereco: c.tecnico_endereco || '',
          tecnico2_nome: c.tecnico2_nome || '', tecnico2_cpf: c.tecnico2_cpf || '',
          tecnico2_rg: c.tecnico2_rg || '', tecnico2_crt_cft: c.tecnico2_crt_cft || '',
          tecnico2_nacionalidade: c.tecnico2_nacionalidade || '',
          tecnico2_estado_civil: c.tecnico2_estado_civil || '', tecnico2_endereco: c.tecnico2_endereco || '',
          tecnico3_nome: c.tecnico3_nome || '', tecnico3_cpf: c.tecnico3_cpf || '',
          tecnico3_rg: c.tecnico3_rg || '', tecnico3_crt_cft: c.tecnico3_crt_cft || '',
          tecnico3_nacionalidade: c.tecnico3_nacionalidade || '',
          tecnico3_estado_civil: c.tecnico3_estado_civil || '', tecnico3_endereco: c.tecnico3_endereco || '',
        });
        // CNPJ já salvo é considerado válido
        if (c.cnpj) {
          setCnpjStatus('valid');
          validatedCnpjRef.current = soAlfanum(c.cnpj);
        }
      } else {
        setEditing(true);
      }
    }).finally(() => setLoading(false));
  }, []);

  // Pré-preenche o WhatsApp do responsável com o da conta (cadastro ou compra),
  // depois que a empresa carregou e só se o campo continua vazio. Segue editável e
  // obrigatório.
  const whatsappConta = user?.whatsapp;
  useEffect(() => {
    if (loading || whatsappPreenchido.current || !whatsappConta) return;
    whatsappPreenchido.current = true;
    const formatado = formatarWhatsapp(whatsappConta);
    if (!formatado) return;
    setForm(f => (f.whatsapp ? f : { ...f, whatsapp: formatado }));
  }, [loading, whatsappConta]);

  function set(field: keyof typeof emptyForm, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function setBanc<K extends keyof DadosBancarios>(k: K, v: DadosBancarios[K]) {
    bancoMexido.current = true;
    setDadosBanc(d => ({ ...d, [k]: v }));
  }

  function handleCnpjChange(raw: string) {
    const formatted = maskCnpj(raw);
    set('cnpj', formatted);
    const digits = soAlfanum(formatted);
    // Resetar status se o usuário alterou o CNPJ
    if (digits !== validatedCnpjRef.current) {
      setCnpjStatus('idle');
      setCnpjError('');
    }
  }

  async function handleCnpjBlur() {
    const digits = soAlfanum(form.cnpj);

    // Já validado e não mudou
    if (digits === validatedCnpjRef.current && cnpjStatus === 'valid') return;
    if (digits.length < 14) return;

    if (!cnpjValido(digits)) {
      setCnpjStatus('invalid');
      setCnpjError('CNPJ inválido — verifique os dígitos informados.');
      return;
    }

    setCnpjStatus('checking');
    setCnpjError('');

    // Timeout de 4s — se BrasilAPI demorar/falhar, aceita o CNPJ como
    // 'unverified' (DV já validados acima) e segue o fluxo. Não bloqueia o lead.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);

    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!res.ok) {
        // BrasilAPI não achou: pode ser empresa nova / dado defasado.
        // Aceita mesmo assim — DV já bate, conferimos depois se precisar.
        setCnpjStatus('unverified');
        validatedCnpjRef.current = digits;
        return;
      }
      const data = await res.json();
      setCnpjStatus('valid');
      validatedCnpjRef.current = digits;

      // Preenche razão social automaticamente se o campo estiver vazio
      if (!form.nome && data.razao_social) {
        set('nome', data.razao_social);
      }
    } catch {
      clearTimeout(timer);
      // Timeout ou rede caiu: aceita unverified.
      setCnpjStatus('unverified');
      validatedCnpjRef.current = digits;
    }
  }

  const handleLogoFile = useCallback((file: File | undefined) => {
    if (!file) return;
    setLogoError('');

    if (!file.type.startsWith('image/')) {
      setLogoError('Arquivo inválido. Envie uma imagem (JPG, PNG, etc).');
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoError(`Imagem muito grande (${(file.size / 1024).toFixed(0)} KB). Use uma imagem menor que 1 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      set('logo_base64', ev.target?.result as string);
      setLogoError('');
    };
    reader.onerror = () => setLogoError('Erro ao ler o arquivo. Tente novamente.');
    reader.readAsDataURL(file);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Aceita CNPJ confirmado pela Receita ('valid') OU validado pelos dígitos
    // verificadores quando a BrasilAPI não responde ('unverified').
    if (cnpjStatus !== 'valid' && cnpjStatus !== 'unverified') {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido antes de salvar.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const isNew = !company;
      const eventId = `creg-${Date.now()}`;
      const method = isNew ? 'post' : 'put';
      const payload: Record<string, unknown> = { ...form };
      if (fotosMexidas.current) {
        payload.fotos_obras = fotosObras
          .filter(f => !!f.path)
          .map(f => ({ path: f.path, ...(f.legenda?.trim() ? { legenda: f.legenda.trim() } : {}) }));
      }
      if (bancoMexido.current) {
        const limpo: Record<string, string> = {};
        for (const [k, v] of Object.entries(dadosBanc)) {
          const t = String(v ?? '').trim();
          if (t) limpo[k] = t;
        }
        payload.dados_bancarios = Object.keys(limpo).length > 0 ? limpo : null;
      }
      const { data } = await api[method]('/company', payload, {
        headers: isNew ? { 'x-meta-event-id': eventId } : {},
      });
      setCompany(data.company);
      // O servidor devolve as fotos com a URL assinada nova.
      if (Array.isArray(data.company?.fotos_obras)) setFotosObras(fotosDoServidor(data.company.fotos_obras));
      fotosMexidas.current = false;
      bancoMexido.current = false;
      // Continua no formulário editável após salvar (não volta pra view)
      setMessage({ type: 'success', text: 'Empresa salva com sucesso!' });
      setTimeout(() => setMessage(null), 3000);

      // Meta pixel client-side — apenas no primeiro cadastro da empresa (dedup com CAPI via eventId). É evento personalizado:
      // o CompleteRegistration fica só no cadastro do usuário (authController + RegisterForm), senão contava 2 por pessoa.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- O pixel do Meta fica no window e não tem tipo.
      if (isNew && typeof window !== 'undefined' && (window as any).fbq) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- O pixel do Meta fica no window e não tem tipo.
        (window as any).fbq('trackCustom', 'EmpresaCriada', {}, { eventID: eventId });
      }

      // Notifica o layout para desbloquear a sidebar
      window.dispatchEvent(new CustomEvent('company-saved'));
      // O quadro "Primeiros passos" recarrega o que falta (empresa, logo e fotos salvam por aqui).
      window.dispatchEvent(new Event('primeiros-passos:atualizar'));

      // Empresa nova (free ou pagante) → direto pro primeiro orçamento. Edição de
      // empresa existente continua na tela.
      if (isNew) {
        setTimeout(() => router.push('/documentos?tipo=proposta'), 800);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setMessage({ type: 'error', text: error.response?.data?.error || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  }

  // Vindo do quadro "Primeiros passos" (/empresa#empresa-fotos): a página só monta o formulário depois de
  // carregar, então a rolagem até a seção espera o `loading` virar falso.
  useEffect(() => {
    if (loading || typeof window === 'undefined') return;
    const id = window.location.hash.replace('#', '');
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [loading]);

  if (loading) return <div className={styles.loading}>Carregando...</div>;

  // Link de criar senha depois de pagar: boas-vindas do pagante. Conta free mantém o aviso âmbar de antes.
  const boasVindasSenha = veioDaSenha && !loading && !company && user?.plano !== 'free';

  // ── VIEW ─────────────────────────────────────────────────
  if (company && !editing) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Minha Empresa</h1>
            <p className={styles.subtitle}>Dados usados automaticamente em todos os documentos</p>
          </div>
          <button className="btn-secondary" onClick={() => setEditing(true)}>Editar</button>
        </div>

        {message && (
          <p className={message.type === 'error' ? 'error-message' : 'success-message'} style={{ marginBottom: 16 }}>
            {message.text}
          </p>
        )}

        <div className={styles.sections}>
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Dados da Empresa</h2>
            {company.logo_base64 && (
              <div className={styles.logoPreviewWrap}>
                <img src={company.logo_base64} alt="Logo" className={styles.logoPreview} />
              </div>
            )}
            <div className={styles.infoGrid}>
              <InfoRow label="Razão Social" value={company.nome} />
              <InfoRow label="CNPJ" value={company.cnpj} />
              <InfoRow label="Endereço Completo" value={company.endereco} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Campo extra da empresa que não está no tipo. */}
              <InfoRow label="Cidade (Foro)" value={(company as any).cidade} />
              <InfoRow label="Sócio Administrador" value={company.socio_adm} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Campo extra da empresa que não está no tipo. */}
              <InfoRow label="WhatsApp do Responsável" value={(company as any).whatsapp} />
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Engenheiro Responsável</h2>
            {company.engenheiro_nome ? (
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.engenheiro_nome} />
                <InfoRow label="Profissão" value={company.engenheiro_profissao} />
                <InfoRow label="Nacionalidade" value={company.engenheiro_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.engenheiro_estado_civil} />
                <InfoRow label="CPF" value={company.engenheiro_cpf} />
                <InfoRow label="RG" value={company.engenheiro_rg} />
                <InfoRow label="CREA" value={company.engenheiro_crea} />
                <InfoRow label="Endereço" value={company.engenheiro_endereco} />
              </div>
            ) : (
              <p className={styles.emptySection}>Nenhum engenheiro cadastrado</p>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Técnico Responsável</h2>
            {company.tecnico_nome ? (
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.tecnico_nome} />
                <InfoRow label="Nacionalidade" value={company.tecnico_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.tecnico_estado_civil} />
                <InfoRow label="CPF" value={company.tecnico_cpf} />
                <InfoRow label="RG" value={company.tecnico_rg} />
                <InfoRow label="CRT / CFT" value={company.tecnico_crt_cft} />
                <InfoRow label="Endereço" value={company.tecnico_endereco} />
              </div>
            ) : (
              <p className={styles.emptySection}>Nenhum técnico cadastrado</p>
            )}
          </section>

          {company.tecnico2_nome && (
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>2º Técnico Responsável</h2>
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.tecnico2_nome} />
                <InfoRow label="Nacionalidade" value={company.tecnico2_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.tecnico2_estado_civil} />
                <InfoRow label="CPF" value={company.tecnico2_cpf} />
                <InfoRow label="RG" value={company.tecnico2_rg} />
                <InfoRow label="CRT / CFT" value={company.tecnico2_crt_cft} />
                <InfoRow label="Endereço" value={company.tecnico2_endereco} />
              </div>
            </section>
          )}

          {company.tecnico3_nome && (
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>3º Técnico Responsável</h2>
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.tecnico3_nome} />
                <InfoRow label="Nacionalidade" value={company.tecnico3_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.tecnico3_estado_civil} />
                <InfoRow label="CPF" value={company.tecnico3_cpf} />
                <InfoRow label="RG" value={company.tecnico3_rg} />
                <InfoRow label="CRT / CFT" value={company.tecnico3_crt_cft} />
                <InfoRow label="Endereço" value={company.tecnico3_endereco} />
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // ── CNPJ status helpers ────────────────────────────────────
  const cnpjHint =
    cnpjStatus === 'checking'    ? { color: 'var(--color-text-muted)', text: 'Consultando Receita Federal...' } :
    cnpjStatus === 'valid'       ? { color: 'var(--ink-green)', text: 'CNPJ válido e encontrado na Receita Federal' } :
    cnpjStatus === 'unverified'  ? { color: 'var(--ink-amber)', text: 'CNPJ aceito (não conseguimos confirmar na Receita agora — pode prosseguir)' } :
    cnpjStatus === 'invalid'     ? { color: 'var(--ink-red)', text: cnpjError } :
    null;

  // ── EDIT ─────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{company ? 'Editar Empresa' : 'Cadastrar Empresa'}</h1>
          <p className={styles.subtitle}>Dados usados automaticamente em todos os documentos</p>
        </div>
        {company && (
          <button className="btn-secondary" onClick={() => router.push('/documentos?tipo=proposta')}>Voltar</button>
        )}
      </div>

      <PrimeirosPassos mostrar={usuarioComum(user)} userId={user?.id} />

      {isWelcome && welcomePlan === 'free' && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(245,158,11,0.10))',
          border: '1px solid rgba(34,197,94,0.4)',
          borderRadius: 12,
          padding: '18px 22px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: '#22c55e', color: '#0f172a',
            display: 'grid', placeItems: 'center',
            fontSize: 22, fontWeight: 900, flexShrink: 0,
          }}>✓</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--color-text)', fontSize: 15.5, display: 'block', marginBottom: 2 }}>
              Conta criada! Você tem 10 propostas grátis pra usar.
            </strong>
            Cadastre sua empresa abaixo (2 min) e já libera o Gerador de Proposta — sai com sua logo e contato.
          </div>
        </div>
      )}

      {((isWelcome && welcomePlan !== 'free') || (boasVindasSenha && !isWelcome)) && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(245,158,11,0.10))',
          border: '1px solid rgba(34,197,94,0.4)',
          borderRadius: 12,
          padding: '18px 22px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: '#22c55e', color: '#0f172a',
            display: 'grid', placeItems: 'center',
            fontSize: 22, fontWeight: 900, flexShrink: 0,
          }}>✓</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--color-text)', fontSize: 15.5, display: 'block', marginBottom: 2 }}>
              Bem-vindo ao SolarDoc
            </strong>
            Primeiro passo: cadastre sua empresa. Leva 1 minuto, e suas propostas já saem com a sua marca.
          </div>
        </div>
      )}

      {!company && !isWelcome && !boasVindasSenha && (
        <div style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-muted)', flex: '1 1 320px', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--color-text)' }}>Cadastre o CNPJ pra gerar propostas.</strong><br />
            Sua logo e contato vão aparecer em toda proposta que você criar.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>

        <section className={styles.card} id="empresa-dados">
          <h2 className={styles.sectionTitle}>Dados da Empresa</h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull} id="empresa-logo">
              <label className={styles.label}>Logo da empresa</label>

              {logoError && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: 'var(--ink-red)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 8 }}>
                  {logoError}
                </div>
              )}

              {form.logo_base64 ? (
                <div className={styles.logoPreviewRow}>
                  <img src={form.logo_base64} alt="Logo" className={styles.logoPreview} />
                  <div className={styles.logoPreviewInfo}>
                    <span className={styles.logoPreviewLabel}>Logo carregada com sucesso</span>
                    <div className={styles.logoPreviewActions}>
                      <label className={styles.logoChangeBtn}>
                        Trocar imagem
                        <input type="file" accept="image/*" onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                      <button type="button" className={styles.removeLogo} onClick={() => { set('logo_base64', ''); setLogoError(''); }}>
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <label
                  className={`${styles.logoUploadZone} ${dragging ? styles.logoUploadZoneDrag : ''} ${logoError ? styles.logoUploadZoneError : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); handleLogoFile(e.dataTransfer.files?.[0]); }}
                >
                  <input type="file" accept="image/*" onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
                  <span className={styles.logoUploadTitle}>{logoError ? 'Tente enviar outra imagem' : 'Clique aqui para adicionar a logo da sua empresa'}</span>
                  <span className={styles.logoUploadSub}>ou arraste a imagem para cá</span>
                  <span className={styles.logoUploadBtn}>Escolher arquivo</span>
                  <span className={styles.logoUploadSub}>Aceita JPG, PNG ou qualquer imagem · máx. 1 MB</span>
                </label>
              )}

              <span className={styles.logoHint}>
                Dica: PNG com fundo transparente fica mais bonito nos documentos. Tamanho ideal: <strong>150 × 100 px</strong>.{' '}
                <a
                  href="https://www.iloveimg.com/resize-image#resize-options,pixels"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.logoHintLink}
                >
                  Redimensionar gratuitamente (150×100 px) →
                </a>
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Cores da empresa<InfoHint>O toque de marca nos documentos: a principal vai em títulos e bordas; a de destaque nos realces da proposta. Cores claras são escurecidas automaticamente pra manter a legibilidade.</InfoHint></label>
              {/* 2 opções prontas — clica e usa; edita à vontade nos seletores abaixo */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {[
                  { nome: 'Laranja + Azul', c1: '#F26513', c2: '#14235B' },
                  { nome: 'Azul + Âmbar', c1: '#14235B', c2: '#F7B500' },
                ].map((p) => (
                  <button key={p.nome} type="button" onClick={() => { set('cor_marca', p.c1); set('cor_secundaria', p.c2); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 42, padding: '10px 16px', borderRadius: 999, border: '1px solid var(--color-border)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.c1 }} />
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.c2 }} />
                    {p.nome}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600 }}>Principal</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={form.cor_marca || '#F26513'} onChange={(e) => set('cor_marca', e.target.value)}
                      style={{ width: 58, height: 44, border: '1px solid var(--color-border)', borderRadius: 9, padding: 2, cursor: 'pointer', background: 'none' }} />
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{(form.cor_marca || '').toUpperCase() || '—'}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600 }}>Destaque</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={form.cor_secundaria || '#F7B500'} onChange={(e) => set('cor_secundaria', e.target.value)}
                      style={{ width: 58, height: 44, border: '1px solid var(--color-border)', borderRadius: 9, padding: 2, cursor: 'pointer', background: 'none' }} />
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{(form.cor_secundaria || '').toUpperCase() || '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>CNPJ *</label>
              {company?.cnpj ? (
                <>
                  <input
                    type="text"
                    value={form.cnpj}
                    className="input-field"
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                    O CNPJ não pode ser alterado. Entre em contato com o suporte se necessário.
                  </span>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={form.cnpj}
                    onChange={e => handleCnpjChange(e.target.value)}
                    onBlur={handleCnpjBlur}
                    placeholder="00.000.000/0000-00"
                    className="input-field"
                    required
                    maxLength={18}
                  />
                  {cnpjHint && (
                    <span style={{ fontSize: 12, color: cnpjHint.color, marginTop: 4, display: 'block' }}>
                      {cnpjHint.text}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Razão Social *</label>
              <input type="text" value={form.nome} onChange={e => set('nome', e.target.value)}
                placeholder="Preenchido automaticamente após validar o CNPJ" className="input-field" required />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome fantasia<InfoHint>É o nome que aparece nos documentos e no app (na logo, no cabeçalho da proposta, etc.). Vazio = usa a razão social. Ex.: razão social “Aioros”, nome fantasia “Irmãos na Obra”.</InfoHint></label>
              <input type="text" value={form.nome_fantasia} onChange={e => set('nome_fantasia', e.target.value)}
                placeholder="Ex: Irmãos na Obra (deixe vazio pra usar a razão social)" className="input-field" />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Sócio Administrador</label>
              <input type="text" value={form.socio_adm} onChange={e => set('socio_adm', e.target.value)}
                placeholder="Nome do sócio administrador" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>WhatsApp do Responsável *<InfoHint>Usado para contato e suporte.</InfoHint></label>
              <input type="tel" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)}
                placeholder="Ex: (34) 99999-0000" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Endereço Completo</label>
              <input type="text" value={form.endereco} onChange={e => set('endereco', e.target.value)}
                placeholder="Ex: Rua das Flores, 123, Centro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade (Foro)<InfoHint>Usada como foro em contratos.</InfoHint></label>
              <input type="text" value={form.cidade} onChange={e => set('cidade', e.target.value)}
                placeholder="Ex: São Paulo/SP" className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card} id="empresa-fotos">
          <h2 className={styles.sectionTitle}>Fotos dos seus trabalhos <span className={styles.optional}>opcional</span></h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Elas já entram na proposta Completa + Banco. Mande 6, 9 ou 12 fotos. A proposta mostra sempre fileiras completas de 3.
          </p>
          <GaleriaPortfolio
            tipo="obra"
            titulo="Fotos de obras"
            max={LIMITE_FOTOS_OBRAS}
            itens={fotosObras}
            onChange={v => { fotosMexidas.current = true; setFotosObras(v); }}
          />
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Dados bancários <span className={styles.optional}>opcional</span></h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Saem na proposta Completa + Banco para o banco pagar a sua empresa.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Banco</label>
              <input type="text" value={dadosBanc.banco} onChange={e => setBanc('banco', e.target.value)}
                placeholder="Ex: Sicredi" className="input-field" maxLength={60} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Tipo de conta</label>
              <select value={dadosBanc.tipo_conta} onChange={e => setBanc('tipo_conta', e.target.value as DadosBancarios['tipo_conta'])} className="input-field">
                <option value="">Selecione</option>
                <option value="corrente">Corrente</option>
                <option value="poupanca">Poupança</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Agência</label>
              <input type="text" inputMode="numeric" value={dadosBanc.agencia} onChange={e => setBanc('agencia', e.target.value)}
                placeholder="Ex: 0001" className="input-field" maxLength={12} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Conta</label>
              <input type="text" value={dadosBanc.conta} onChange={e => setBanc('conta', e.target.value)}
                placeholder="Ex: 12345-6" className="input-field" maxLength={20} />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Titular</label>
              <input type="text" value={dadosBanc.titular} onChange={e => setBanc('titular', e.target.value)}
                placeholder="Nome de quem recebe" className="input-field" maxLength={120} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF ou CNPJ do titular</label>
              <input type="text" value={dadosBanc.documento}
                onChange={e => setBanc('documento', maskDocumento(e.target.value))}
                placeholder="CPF ou CNPJ" className="input-field" maxLength={20} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Chave Pix</label>
              <input type="text" value={dadosBanc.pix} onChange={e => setBanc('pix', e.target.value)}
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória" className="input-field" maxLength={120} />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Engenheiro Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.engenheiro_nome} onChange={e => set('engenheiro_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Profissão</label>
              <input type="text" value={form.engenheiro_profissao} onChange={e => set('engenheiro_profissao', e.target.value)}
                placeholder="Ex: engenheiro eletricista" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.engenheiro_nacionalidade} onChange={e => set('engenheiro_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.engenheiro_estado_civil} onChange={e => set('engenheiro_estado_civil', e.target.value)}
                placeholder="Ex: solteiro, casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.engenheiro_cpf} onChange={e => set('engenheiro_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.engenheiro_rg} onChange={e => set('engenheiro_rg', e.target.value)}
                placeholder="Ex: 3.176.474" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CREA</label>
              <input type="text" value={form.engenheiro_crea} onChange={e => set('engenheiro_crea', e.target.value)}
                placeholder="Ex: CREA-DF sob o n° 27202" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.engenheiro_endereco} onChange={e => set('engenheiro_endereco', e.target.value)}
                placeholder="cidade de ..., à Rua ..." className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Técnico Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.tecnico_nome} onChange={e => set('tecnico_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.tecnico_nacionalidade} onChange={e => set('tecnico_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.tecnico_estado_civil} onChange={e => set('tecnico_estado_civil', e.target.value)}
                placeholder="Ex: casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.tecnico_cpf} onChange={e => set('tecnico_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.tecnico_rg} onChange={e => set('tecnico_rg', e.target.value)}
                placeholder="Ex: 2.456.789" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CRT / CFT</label>
              <input type="text" value={form.tecnico_crt_cft} onChange={e => set('tecnico_crt_cft', e.target.value)}
                placeholder="Ex: CRT-MG 0001234" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.tecnico_endereco} onChange={e => set('tecnico_endereco', e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF" className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>2º Técnico Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.tecnico2_nome} onChange={e => set('tecnico2_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.tecnico2_nacionalidade} onChange={e => set('tecnico2_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.tecnico2_estado_civil} onChange={e => set('tecnico2_estado_civil', e.target.value)}
                placeholder="Ex: casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.tecnico2_cpf} onChange={e => set('tecnico2_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.tecnico2_rg} onChange={e => set('tecnico2_rg', e.target.value)}
                placeholder="Ex: 2.456.789" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CRT / CFT</label>
              <input type="text" value={form.tecnico2_crt_cft} onChange={e => set('tecnico2_crt_cft', e.target.value)}
                placeholder="Ex: CRT-MG 0001234" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.tecnico2_endereco} onChange={e => set('tecnico2_endereco', e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF" className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>3º Técnico Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.tecnico3_nome} onChange={e => set('tecnico3_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.tecnico3_nacionalidade} onChange={e => set('tecnico3_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.tecnico3_estado_civil} onChange={e => set('tecnico3_estado_civil', e.target.value)}
                placeholder="Ex: casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.tecnico3_cpf} onChange={e => set('tecnico3_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.tecnico3_rg} onChange={e => set('tecnico3_rg', e.target.value)}
                placeholder="Ex: 2.456.789" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CRT / CFT</label>
              <input type="text" value={form.tecnico3_crt_cft} onChange={e => set('tecnico3_crt_cft', e.target.value)}
                placeholder="Ex: CRT-MG 0001234" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.tecnico3_endereco} onChange={e => set('tecnico3_endereco', e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF" className="input-field" />
            </div>
          </div>
        </section>

        {message && (
          <p className={message.type === 'error' ? 'error-message' : 'success-message'}>{message.text}</p>
        )}

        <div className={styles.saveBar}>
          {company && (
            <button type="button" className="btn-secondary" onClick={() => router.push('/documentos?tipo=proposta')}>Voltar</button>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || cnpjStatus === 'checking' || cnpjStatus === 'invalid'}
            title={cnpjStatus !== 'valid' ? 'Valide o CNPJ antes de salvar' : undefined}
          >
            {saving ? 'Salvando...' : company ? 'Salvar alterações' : 'Cadastrar empresa'}
          </button>
        </div>
      </form>
    </div>
  );
}
