'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { MessageCircle, Link as LinkIcon, Download, RotateCcw, ScanLine } from 'lucide-react';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null; codigo?: string | null; codigo_curto?: string | null; empresa_slug?: string | null; resumo_whatsapp?: string | null }

// Comprime imagem pra max 1200px largura, JPEG 0.82.
// Foto de celular típica (3-5MB) cai pra ~120-180kb.
async function compressImage(file: File, maxW = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width > maxW ? maxW / img.width : 1;
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = String(e.target?.result || '');
    };
    reader.onerror = () => reject(new Error('reader'));
    reader.readAsDataURL(file);
  });
}

const PALETAS = [
  { id: 'solar',    nome: 'Solar',    c1: '#B45309', c2: '#D97706' },
  { id: 'oceano',   nome: 'Oceano',   c1: '#1E3A8A', c2: '#1D4ED8' },
  { id: 'floresta', nome: 'Floresta', c1: '#065F46', c2: '#047857' },
  { id: 'royal',    nome: 'Royal',    c1: '#8B5CF6', c2: '#A78BFA' },
  { id: 'carbono',  nome: 'Carbono',  c1: '#1F2937', c2: '#F59E0B' },
] as const;

const TIPOS_TELHADO = ['Cerâmico', 'Fibrocimento', 'Metálico', 'Cimento', 'Laje', 'Solo', 'Carport'] as const;

const initialFields = {
  paleta: 'solar' as string, // 'solar'|'oceano'|... | 'custom' | 'empresa'
  paleta_c1: '', // cor escolhida no color picker (hex) quando paleta==='custom'
  cidade: '',
  uf: '',
  consumo_kwh: '',
  qtd_modulos: '',
  marca_modulo: '',
  potencia_modulo: '',
  qtd_inversores: '1',
  marca_inversor: '',
  potencia_inversor: '',
  // Bateria (opcional) — só aparece na proposta se a marca estiver preenchida.
  // Padrão render-if-filled, mesmo idioma das garantias extras (nada é persistido
  // como "tem bateria": deriva de marca preenchida → propostas antigas intactas).
  bateria_marca: '',
  bateria_capacidade_kwh: '',
  bateria_potencia_kw: '',
  bateria_ciclos: '',
  bateria_garantia_anos: '',
  tipo_telhado: '' as '' | typeof TIPOS_TELHADO[number],
  // Geração média mensal (kWh). Pré-preenchida com estimativa (kWp × HSP × 365 × 0.80 / 12)
  // quando o consultor preenche kWp + UF. Editável — o que vier daqui vale, e o
  // gráfico aplica a sazonalidade da região por cima preservando essa média.
  geracao_media_kwh: '',
  investimento: '',
  preco_avista: '',
  foto_telhado_b64: '', // dataURL JPEG comprimido
  // Campos editáveis (defaults aplicados no servidor se vierem vazios).
  // tarifa_kwh: deixar vazio = usa default do estado. Preencher = override por proposta.
  tarifa_kwh: '',
  taxa_minima: '90',
  prazo_instalacao_dias: '45',
  garantia_paineis: '25',
  garantia_inversor: '10',
  garantia_estrutura: '10',
  garantia_instalacao: '1',
  inflacao_aa: '6',
  taxa_minima_inflacao_aa: '6',
  // Formas de pagamento — consultor escolhe o que aparece para o cliente.
  // Padrão 2026-05-21: vista + cartão 10x + fin 48x/60x fixos. 36x opcional.
  // Entrada livre (valor + modo de quitação do restante) é off por padrão.
  pag_vista: true,
  pag_cartao: true,
  // Cartão de crédito: 1x a 21x. Defaults marcados: 6x, 12x, 18x, 21x.
  // Taxas Elo padrão (editáveis pelo consultor por proposta).
  pag_cartao_1: false,
  pag_cartao_2: false,
  pag_cartao_3: false,
  pag_cartao_4: false,
  pag_cartao_5: false,
  pag_cartao_6: true,
  pag_cartao_7: false,
  pag_cartao_8: false,
  pag_cartao_9: false,
  pag_cartao_10: false,
  pag_cartao_11: false,
  pag_cartao_12: true,
  pag_cartao_13: false,
  pag_cartao_14: false,
  pag_cartao_15: false,
  pag_cartao_16: false,
  pag_cartao_17: false,
  pag_cartao_18: true,
  pag_cartao_19: false,
  pag_cartao_20: false,
  pag_cartao_21: true,
  taxa_cartao_1: '3.99',
  taxa_cartao_2: '5.30',
  taxa_cartao_3: '5.99',
  taxa_cartao_4: '6.68',
  taxa_cartao_5: '7.35',
  taxa_cartao_6: '8.02',
  taxa_cartao_7: '9.47',
  taxa_cartao_8: '10.13',
  taxa_cartao_9: '10.78',
  taxa_cartao_10: '11.43',
  taxa_cartao_11: '12.06',
  taxa_cartao_12: '12.70',
  taxa_cartao_13: '13.32',
  taxa_cartao_14: '13.94',
  taxa_cartao_15: '14.56',
  taxa_cartao_16: '15.17',
  taxa_cartao_17: '15.77',
  taxa_cartao_18: '16.37',
  taxa_cartao_19: '16.97',
  taxa_cartao_20: '17.57',
  taxa_cartao_21: '18.17',
  pag_fin: true,
  // Financiamento: 36x/48x/60x/84x. Default marcados: 36x e 48x.
  // Taxa mensal editável (default 2,2% a.m. — Price com 120 dias de carência).
  pag_fin_36: true,
  pag_fin_48: true,
  pag_fin_60: false,
  pag_fin_84: false,
  taxa_fin_36: '2.20',
  taxa_fin_48: '2.20',
  taxa_fin_60: '2.20',
  taxa_fin_84: '2.20',
  pag_entrada: false,
  entrada_valor: '',
  entrada_modo: 'dias' as 'dias' | 'entrega' | 'montagem' | 'liberacao',
  entrada_dias: '30',
  pag_custom: '',
};

// Rótulo do marco que o integrador escolhe pra quitação do saldo.
const ENTRADA_MODO_LABEL: Record<'dias' | 'entrega' | 'montagem' | 'liberacao', string> = {
  dias:      'Em X dias',
  entrega:   'Na entrega do material',
  montagem:  'Na montagem do sistema',
  liberacao: 'Na liberação do sistema',
};

// PMT Price com carência: juros capitalizam durante a carência, depois Price padrão
function pmtPriceCarencia(pv: number, i: number, n: number, carenciaMeses: number) {
  if (!pv || pv <= 0) return 0;
  const saldo = pv * Math.pow(1 + i, carenciaMeses);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

// "Uberlândia/MG" / "Uberlândia, MG" / "Uberlandia - MG" → { cidade, uf }.
// Aceita também só cidade (sem UF) — backend cai pro default SP.
function parseCidadeUf(input: string): { cidade: string; uf: string } {
  const raw = input.trim();
  if (!raw) return { cidade: '', uf: '' };
  const m = raw.match(/^(.+?)[\s,/\-]+([A-Za-z]{2})$/);
  if (m) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: raw, uf: '' };
}

// ── Máscaras de número (pontuação automática pt-BR) ──────────────────
const soDigitos = (s: string) => String(s ?? '').replace(/\D/g, '');
// Moeda estilo centavos: digita 1025050 → "10.250,50"; 100 → "1,00".
function maskMoeda(raw: string): string {
  const d = soDigitos(raw);
  if (!d) return '';
  const n = parseInt(d, 10);
  return `${Math.floor(n / 100).toLocaleString('pt-BR')},${String(n % 100).padStart(2, '0')}`;
}
// Inteiro com separador de milhar: 20000 → "20.000"; 1000 → "1.000".
function maskMilhar(raw: string): string {
  const d = soDigitos(raw);
  if (!d) return '';
  return parseInt(d, 10).toLocaleString('pt-BR');
}
// Parser robusto: "10.250,50" → 10250.5; "20.000" → 20000. Tira R$/espaço/milhar.
function parseBRL(v: string): number {
  return parseFloat(String(v ?? '').replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
}

export default function PropostaSolarPage() {
  const [clienteNome, setClienteNome] = useState('');
  const [cidadeUf, setCidadeUf] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [copyMsg, setCopyMsg] = useState('');
  // Validação inline: quais campos obrigatórios estão faltando (pra marcar de vermelho).
  const [faltando, setFaltando] = useState<Set<string>>(new Set());

  // Cor de marca da empresa (cadastrada em Empresa) — habilita a paleta
  // "Cores da empresa". Só o swatch/enable usa isso no front; a geração lê
  // company.cor_marca direto no backend.
  const [corEmpresa, setCorEmpresa] = useState('');
  useEffect(() => {
    api.get('/company').then(({ data }) => {
      const c = data?.company?.cor_marca;
      if (c) setCorEmpresa(String(c));
    }).catch(() => {});
  }, []);

  // ── Autosave (item 1): rascunho em localStorage, debounce 600ms. Um erro de
  // rede/timeout não apaga mais os ~40 campos. Restaura ao montar, limpa no sucesso.
  const DRAFT_KEY = 'proposta-solar-draft-v1';
  const draftLoaded = useRef(false);

  // Restaura rascunho ao montar (1x).
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.clienteNome) setClienteNome(d.clienteNome);
      if (d.cidadeUf) setCidadeUf(d.cidadeUf);
      if (d.fields) setFields(f => ({ ...f, ...d.fields }));
    } catch { /* rascunho corrompido — ignora */ }
  }, []);

  // Salva o rascunho (debounce). Só depois do load inicial pra não sobrescrever.
  useEffect(() => {
    if (!draftLoaded.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ clienteNome, cidadeUf, fields }));
      } catch { /* quota/privado — ignora */ }
    }, 600);
    return () => clearTimeout(t);
  }, [clienteNome, cidadeUf, fields]);

  function limparRascunho() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignora */ }
  }

  // ── Marcas recentes (item 2): lembra as últimas marcas de módulo/inversor
  // digitadas, pra autocompletar via <datalist> (não redigitar toda proposta).
  const MARCAS_MOD_KEY = 'proposta-marcas-modulo';
  const MARCAS_INV_KEY = 'proposta-marcas-inversor';
  const MARCAS_BAT_KEY = 'proposta-marcas-bateria';
  function lerMarcas(key: string): string[] {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function salvarMarca(key: string, valor: string) {
    const v = valor.trim();
    if (!v) return;
    try {
      const atuais = lerMarcas(key).filter(m => m.toLowerCase() !== v.toLowerCase());
      localStorage.setItem(key, JSON.stringify([v, ...atuais].slice(0, 8)));
    } catch { /* ignora */ }
  }
  const [marcasMod, setMarcasMod] = useState<string[]>([]);
  const [marcasInv, setMarcasInv] = useState<string[]>([]);
  const [marcasBat, setMarcasBat] = useState<string[]>([]);
  useEffect(() => { setMarcasMod(lerMarcas(MARCAS_MOD_KEY)); setMarcasInv(lerMarcas(MARCAS_INV_KEY)); setMarcasBat(lerMarcas(MARCAS_BAT_KEY)); }, []);

  // kWp deriva de qtd_modulos × potencia_modulo (verdade técnica: 10×620W = 6,2 kWp)
  const kwpCalc = (() => {
    const qtd = parseInt(fields.qtd_modulos, 10);
    const pot = parseInt(fields.potencia_modulo, 10);
    if (qtd > 0 && pot > 0) return ((qtd * pot) / 1000);
    return 0;
  })();

  // Estimativa de geração média mensal (kWh) — só pra placeholder do input.
  // Usa HSP médio do Brasil (5.2) com eficiência 80%. O backend tem a tabela
  // completa por UF/cidade, então o valor real do PDF pode diferir um pouco.
  const geracaoMediaSugerida = kwpCalc > 0 ? Math.round((kwpCalc * 5.2 * 365 * 0.80) / 12) : 0;

  // Sugere qtd_modulos baseado no consumo (estimativa: kWh/mês ÷ 115 = kWp).
  // Divisor 115 gera ~10% de oversize pra cobrir degradação dos painéis (~0,5% a.a.)
  // — sem isso, no ano 2-3 o sistema já fica deficitário.
  useEffect(() => {
    const kwh = parseBRL(fields.consumo_kwh);
    const potMod = parseInt(fields.potencia_modulo, 10);
    if (kwh && potMod && !fields.qtd_modulos) {
      const kwpEst = kwh / 115;
      const qtd = Math.ceil((kwpEst * 1000) / potMod);
      setFields(f => ({ ...f, qtd_modulos: String(qtd) }));
    }
  }, [fields.consumo_kwh, fields.potencia_modulo, fields.qtd_modulos]);

  // Parcelas no cartão — taxa total Elo padrão (editável por proposta).
  // Fórmula: valor parcela = (investimento × (1 + taxa%)) / N
  const invNum = (() => {
    const v = parseBRL(fields.investimento);
    return v > 0 ? v : 0;
  })();
  function parseTaxa(s: string): number {
    const v = parseFloat(String(s || '').replace(',', '.'));
    return v > 0 ? v : 0;
  }
  function valorParcela(n: number, taxaPct: number): number {
    if (invNum <= 0 || n <= 0) return 0;
    return Math.ceil((invNum * (1 + taxaPct / 100)) / n);
  }
  // Financiamento Price com 120 dias (4 meses) de carência.
  // Taxa mensal editável por proposta (default 2,2% a.m.)
  const FIN_CARENCIA_MESES = 4;
  function valorFinanciamento(n: number, taxaMensalPct: number): number {
    if (invNum <= 0 || n <= 0 || taxaMensalPct <= 0) return 0;
    return Math.ceil(pmtPriceCarencia(invNum, taxaMensalPct / 100, n, FIN_CARENCIA_MESES));
  }
  // Entrada + saldo: integrador define a entrada (R$) e como/quando quitar o restante
  const entradaValor = (() => {
    const v = parseBRL(fields.entrada_valor);
    return v > 0 ? v : 0;
  })();
  const entradaRestante = invNum > 0 && entradaValor > 0 ? Math.max(0, invNum - entradaValor) : 0;
  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    setFields(f => ({ ...f, [k]: v }));
  }

  // Marca visual de campo faltante (item 3): borda vermelha + data-invalid pro
  // scrollIntoView achar o primeiro. Ao digitar, tira a marca daquele campo.
  function invalidProps(campo: string) {
    const invalido = faltando.has(campo);
    return {
      'data-invalid': invalido ? 'true' : undefined,
      style: invalido ? { borderColor: 'var(--ink-red, #DC2626)', boxShadow: '0 0 0 2px rgba(220,38,38,0.15)' } : undefined,
    };
  }
  function clearFaltando(campo: string) {
    if (!faltando.has(campo)) return;
    setFaltando(prev => { const n = new Set(prev); n.delete(campo); return n; });
  }

  // "Nova proposta" (item 4): zera os dados DO CLIENTE e do sistema desta venda,
  // pra não mandar proposta com nome/valor do cliente anterior. Mantém o que é
  // template reutilizável (garantias, taxas, formas de pagamento, paleta).
  function novaProposta() {
    setGenerated(null);
    setError('');
    setFaltando(new Set());
    setClienteNome('');
    setCidadeUf('');
    setFields(f => ({
      ...f,
      // específicos do cliente/venda — zerados:
      consumo_kwh: '', qtd_modulos: '', potencia_modulo: '',
      qtd_inversores: initialFields.qtd_inversores, potencia_inversor: '',
      // bateria: capacidade/potência/ciclos são específicos da venda; marca e
      // garantia ficam (template do integrador, igual marca_inversor).
      bateria_capacidade_kwh: '', bateria_potencia_kw: '', bateria_ciclos: '',
      geracao_media_kwh: '', investimento: '', preco_avista: '',
      foto_telhado_b64: '', tipo_telhado: '',
      // marca/garantias/pagamento ficam como estão (template do integrador).
    }));
    limparRascunho();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();

    // Validação inline (item 3): junta TODOS os faltantes, marca os campos de
    // vermelho e rola até o primeiro — em vez de 1 erro de texto no rodapé.
    const faltam = new Set<string>();
    if (!clienteNome.trim()) faltam.add('clienteNome');
    if (!cidadeUf.trim()) faltam.add('cidadeUf');
    if (!fields.qtd_modulos || !fields.potencia_modulo) {
      if (!fields.qtd_modulos) faltam.add('qtd_modulos');
      if (!fields.potencia_modulo) faltam.add('potencia_modulo');
    }
    if (!fields.investimento) faltam.add('investimento');

    if (faltam.size > 0) {
      setFaltando(faltam);
      setError(`Preencha os campos destacados (${faltam.size} pendente${faltam.size > 1 ? 's' : ''}).`);
      // Rola até o primeiro campo faltante.
      const primeiro = document.querySelector('[data-invalid="true"]');
      primeiro?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setFaltando(new Set());
    setError('');
    setGenerating(true);
    try {
      const { cidade, uf } = parseCidadeUf(cidadeUf);
      const payload: Record<string, unknown> = {
        tipo: 'propostaSolar',
        fields: { ...fields, cidade, uf },
        useTemplate: true,
        modeloNumero: 1,
        cliente_nome_avulso: clienteNome.trim(),
      };
      const { data } = await api.post('/documents/generate', payload);
      setGenerated(data);
      // Sucesso: limpa o rascunho e lembra as marcas usadas (itens 1 e 2).
      limparRascunho();
      salvarMarca(MARCAS_MOD_KEY, fields.marca_modulo);
      salvarMarca(MARCAS_INV_KEY, fields.marca_inversor);
      salvarMarca(MARCAS_BAT_KEY, fields.bateria_marca);
      setMarcasMod(lerMarcas(MARCAS_MOD_KEY));
      setMarcasInv(lerMarcas(MARCAS_INV_KEY));
      setMarcasBat(lerMarcas(MARCAS_BAT_KEY));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao gerar proposta');
    } finally {
      setGenerating(false);
    }
  }

  function handleDownloadPdf() {
    if (!generated?.doc_id) return;

    const token = getToken();
    if (!token) {
      setCopyMsg('Sessão expirou. Faça login novamente.');
      setTimeout(() => setCopyMsg(''), 4000);
      return;
    }

    // Download via navegação MESMA-ORIGEM (/_api em produção) — mesmo padrão do
    // DocumentPreview. Crítico pra mobile: iOS Safari frequentemente ignora o
    // download via blob (createObjectURL + a.click()) — abre em aba ou "nada
    // acontece". A navegação direta pra uma URL com Content-Disposition:
    // attachment funciona no iOS, e mesma-origem evita o cross-origin do
    // solardocs-api.vercel.app. O token vai na query porque navegação não manda
    // header Authorization (a rota /documents/:id/pdf aceita ?token= via
    // downloadAuth).
    const base = (typeof window !== 'undefined' && window.location.hostname !== 'localhost')
      ? '/_api'
      : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
    window.location.href = `${base}/documents/${generated.doc_id}/pdf?token=${encodeURIComponent(token)}`;
  }

  // Identificador público preferencial:
  //  1. slug.codigo_curto (irmaosnaobra.20260001) — novo padrão, mais bonito
  //  2. codigo de 12-dig (YYYYUUUUNNNN) — legacy
  //  3. UUID — fallback
  const publicId = (generated?.empresa_slug && generated?.codigo_curto)
    ? `${generated.empresa_slug}.${generated.codigo_curto}`
    : (generated?.codigo || generated?.doc_id);

  function handleCopyLink() {
    if (!publicId) return;
    const url = `${window.location.origin}/p/${publicId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copiado!');
      setTimeout(() => setCopyMsg(''), 2200);
    });
  }

  // Mensagem curta de hand-off pro WhatsApp. Os números calculados (economia,
  // payback) vivem no HTML do backend, então NÃO recalculamos aqui — o link
  // abre a proposta completa com os valores corretos. Só usamos o que está
  // garantido em escopo (nome, sistema, investimento) + o link.
  function handleCopyWhatsApp() {
    if (!publicId) return;
    const url = `${window.location.origin}/p/${publicId}`;
    // Texto rico (sistema, geração, economia, garantias, cartão, financiamento)
    // vem PRONTO do backend — mesmos números do PDF. Aqui só anexa o link.
    let txt: string;
    if (generated?.resumo_whatsapp) {
      txt = `${generated.resumo_whatsapp}\n\n${url}`;
    } else {
      // Fallback: proposta gerada antes deste recurso → texto curto de antes.
      const nome = (generated?.cliente_nome || clienteNome || '').trim();
      const sistemaLinhas: string[] = [];
      if (kwpCalc > 0) {
        const mod = [fields.qtd_modulos && `${fields.qtd_modulos}x`, fields.marca_modulo]
          .filter(Boolean).join(' ');
        sistemaLinhas.push(`🔋 ${kwpCalc.toFixed(2).replace('.', ',')} kWp${mod ? ` · ${mod}` : ''}`);
      }
      if (invNum > 0) {
        sistemaLinhas.push(`💰 Investimento: R$ ${invNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }
      txt = [
        '☀️ *Proposta de Energia Solar*',
        '',
        nome ? `Olá ${nome}! Segue sua proposta:` : 'Segue sua proposta:',
        ...(sistemaLinhas.length ? ['', ...sistemaLinhas] : []),
        '',
        'Proposta completa (link):',
        url,
      ].join('\n');
    }
    navigator.clipboard.writeText(txt).then(() => {
      setCopyMsg('Mensagem copiada! Cole no WhatsApp');
      setTimeout(() => setCopyMsg(''), 2800);
    });
  }

  // Quando preview ativo, fica fullscreen com iframe + ações
  if (generated) {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <button type="button" onClick={novaProposta} style={{ ...btn('ghost'), display: 'inline-flex', alignItems: 'center', gap: 6 }}><RotateCcw size={15} /> Nova proposta</button>
          {publicId && (
            <span style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.35)',
              color: 'var(--color-primary)',
              fontFamily: 'monospace',
              fontSize: 13,
              fontWeight: 700,
            }}>
              {publicId}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleCopyWhatsApp} style={{ ...btn('whatsapp'), display: 'inline-flex', alignItems: 'center', gap: 6 }}><MessageCircle size={15} /> Copiar WhatsApp</button>
          <button type="button" onClick={handleCopyLink} style={{ ...btn('primary'), display: 'inline-flex', alignItems: 'center', gap: 6 }}><LinkIcon size={15} /> Copiar link</button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!generated.doc_id}
            style={{ ...btn('outline'), opacity: !generated.doc_id ? 0.6 : 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={15} /> Baixar PDF
          </button>
          {/* Cor do toast: vermelho só no erro de sessão; sucesso (copiado) fica verde. */}
          {copyMsg && <span style={{ color: copyMsg.startsWith('Sessão') ? 'var(--ink-red)' : 'var(--ink-green)', fontSize: 13, fontWeight: 600 }}>{copyMsg}</span>}
        </div>
        <div style={{
          background: '#F3F4F6',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
          height: 'calc(100vh - 200px)',
          minHeight: 600,
        }}>
          <iframe
            ref={iframeRef}
            srcDoc={generated.content}
            title="Preview da Proposta"
            style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
          />
        </div>
      </div>
    );
  }

  const PaletaPicker = (
    <div>
      <label className={styles.label}>Cor da proposta</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {/* Cores da empresa — usa a cor de marca cadastrada em Empresa (automática).
            Só aparece quando a empresa tem cor definida. */}
        {corEmpresa && (
          <button
            type="button"
            onClick={() => setField('paleta', 'empresa')}
            style={{
              padding: '10px 14px', borderRadius: 10,
              border: fields.paleta === 'empresa' ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
              background: corEmpresa,
              color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', minWidth: 88,
              boxShadow: fields.paleta === 'empresa' ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              textShadow: '0 1px 2px rgba(0,0,0,0.35)', transition: 'all 0.15s',
            }}
            title="Usa a cor de marca cadastrada em Empresa"
          >
            Empresa
          </button>
        )}
        {PALETAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setField('paleta', p.id)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: fields.paleta === p.id ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
              background: `linear-gradient(135deg, ${p.c1}, ${p.c2})`,
              color: 'white',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              minWidth: 88,
              boxShadow: fields.paleta === p.id ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {p.nome}
          </button>
        ))}

        {/* Cor personalizada — color picker nativo (o input fica sobreposto e
            transparente: clicar em qualquer parte do swatch abre o seletor).
            A escolha (paleta='custom' + hex) fica salva no rascunho automático. */}
        <label
          style={{
            padding: '10px 14px', borderRadius: 10,
            border: fields.paleta === 'custom' ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
            background: fields.paleta === 'custom' && fields.paleta_c1
              ? fields.paleta_c1
              : 'linear-gradient(135deg, #ec4899, #8b5cf6, #06b6d4)',
            color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            minWidth: 88, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: fields.paleta === 'custom' ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
            position: 'relative', transition: 'all 0.15s',
          }}
          title="Escolher uma cor personalizada"
        >
          {fields.paleta === 'custom' && fields.paleta_c1 ? fields.paleta_c1.toUpperCase() : 'Personalizar'}
          <input
            type="color"
            value={fields.paleta_c1 || '#B45309'}
            onChange={e => { setField('paleta_c1', e.target.value); setField('paleta', 'custom'); }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
          />
        </label>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
        Cores claras são escurecidas automaticamente pra manter o texto legível na proposta.
      </p>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Proposta Solar</h1>
        <p className={styles.subtitle}>Gera proposta comercial bonita pra cliente final — copia link, manda WhatsApp ou imprime</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Link
          href="/escanear-conta"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '10px 16px', borderRadius: 10, fontSize: '0.92rem', fontWeight: 700,
            textDecoration: 'none', color: '#0f172a',
            background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
            boxShadow: '0 4px 14px rgba(245,158,11,0.3)', whiteSpace: 'nowrap',
          }}
        >
          <ScanLine size={17} /> Escanear Conta
        </Link>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          Tem a conta de luz? Escaneie pra puxar os dados do cliente automaticamente.
        </span>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        {/* PALETA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Visual</h2>
          {PaletaPicker}
        </div>

        {/* CLIENTE */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -4, marginBottom: 10 }}>
            Seu nome e WhatsApp já vêm do cadastro da empresa.
          </p>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome do cliente *</label>
              <input
                type="text"
                value={clienteNome}
                onChange={e => { setClienteNome(e.target.value); clearFaltando('clienteNome'); }}
                placeholder="Ex: João da Silva"
                className="input-field"
                required
                {...invalidProps('clienteNome')}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade/UF *</label>
              <input
                type="text"
                value={cidadeUf}
                onChange={e => { setCidadeUf(e.target.value); clearFaltando('cidadeUf'); }}
                placeholder="Ex: São Paulo/SP"
                className="input-field"
                required
                {...invalidProps('cidadeUf')}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Consumo médio (kWh/mês) *</label>
              <input type="text" inputMode="numeric" value={fields.consumo_kwh} onChange={e => setField('consumo_kwh', maskMilhar(e.target.value))} placeholder="Ex: 450" className="input-field" required />
            </div>
          </div>
        </div>

        {/* SISTEMA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sistema fotovoltaico</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade de módulos *</label>
              <input type="text" inputMode="numeric" value={fields.qtd_modulos} onChange={e => { setField('qtd_modulos', e.target.value); clearFaltando('qtd_modulos'); }} placeholder="Ex: 10" className="input-field" required {...invalidProps('qtd_modulos')} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência por módulo (W) *</label>
              <input type="text" inputMode="numeric" value={fields.potencia_modulo} onChange={e => { setField('potencia_modulo', e.target.value); clearFaltando('potencia_modulo'); }} placeholder="Ex: 620" className="input-field" required {...invalidProps('potencia_modulo')} />
            </div>
            <div className={styles.fieldFull}>
              <div style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px dashed rgba(245,158,11,0.4)',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Potência calculada (qtd × W ÷ 1000)
                </span>
                <strong style={{ fontSize: 18, color: 'var(--color-primary)' }}>
                  {kwpCalc > 0 ? kwpCalc.toFixed(2).replace('.', ',') + ' kWp' : '—'}
                </strong>
              </div>
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Geração média mensal (kWh)</label>
              <input
                type="text"
                inputMode="numeric"
                value={fields.geracao_media_kwh}
                onChange={e => setField('geracao_media_kwh', maskMilhar(e.target.value))}
                placeholder={geracaoMediaSugerida > 0 ? `Estimado: ${geracaoMediaSugerida.toLocaleString('pt-BR')} kWh/mês (deixe vazio pra usar)` : 'Preencha kWp e cidade pra ver estimativa'}
                className="input-field"
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                O que você colocar aqui vira a média anual da proposta. Vazio = sistema calcula via HSP da cidade. O gráfico aplica a sazonalidade da região em cima desse valor.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca dos módulos *</label>
              <input type="text" list="marcas-modulo" value={fields.marca_modulo} onChange={e => setField('marca_modulo', e.target.value)} placeholder="Ex: Canadian Solar" className="input-field" required />
              <datalist id="marcas-modulo">{marcasMod.map(m => <option key={m} value={m} />)}</datalist>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade de inversores</label>
              <input type="text" inputMode="numeric" value={fields.qtd_inversores} onChange={e => setField('qtd_inversores', e.target.value)} className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca do inversor *</label>
              <input type="text" list="marcas-inversor" value={fields.marca_inversor} onChange={e => setField('marca_inversor', e.target.value)} placeholder="Ex: Growatt" className="input-field" required />
              <datalist id="marcas-inversor">{marcasInv.map(m => <option key={m} value={m} />)}</datalist>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência do inversor (kW) *</label>
              <input type="text" inputMode="decimal" value={fields.potencia_inversor} onChange={e => setField('potencia_inversor', e.target.value)} placeholder="Ex: 1,875 ou 5" className="input-field" required />
            </div>
            {/* GARANTIAS fixas — junto das marcas/potências (mesma grade). */}
            <div className={styles.field}>
              <label className={styles.label}>Garantia dos painéis (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_paineis} onChange={e => setField('garantia_paineis', e.target.value)} placeholder="25" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia do inversor (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_inversor} onChange={e => setField('garantia_inversor', e.target.value)} placeholder="10" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia da estrutura (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_estrutura} onChange={e => setField('garantia_estrutura', e.target.value)} placeholder="10" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia da instalação (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_instalacao} onChange={e => setField('garantia_instalacao', e.target.value)} placeholder="1" className="input-field" />
            </div>
          </div>

          {/* BATERIA (opcional) — render-if-filled: só aparece na proposta se a marca
              estiver preenchida. Nada é persistido como "tem bateria". */}
          <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '18px 0 6px' }}>
            Bateria (opcional) — só aparece na proposta se preencher a marca. Sistemas sem bateria ficam intactos.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Marca da bateria</label>
              <input type="text" list="marcas-bateria" value={fields.bateria_marca} onChange={e => setField('bateria_marca', e.target.value)} placeholder="Ex: BYD, Pylontech, Foxess" className="input-field" />
              <datalist id="marcas-bateria">{marcasBat.map(m => <option key={m} value={m} />)}</datalist>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Capacidade (kWh)</label>
              <input type="text" inputMode="decimal" value={fields.bateria_capacidade_kwh} onChange={e => setField('bateria_capacidade_kwh', e.target.value)} placeholder="Ex: 5 ou 10,24" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência (kW)</label>
              <input type="text" inputMode="decimal" value={fields.bateria_potencia_kw} onChange={e => setField('bateria_potencia_kw', e.target.value)} placeholder="Ex: 5" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Ciclos de vida</label>
              <input type="text" inputMode="numeric" value={fields.bateria_ciclos} onChange={e => setField('bateria_ciclos', e.target.value)} placeholder="Ex: 6000" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia da bateria (anos)</label>
              <input type="text" inputMode="numeric" value={fields.bateria_garantia_anos} onChange={e => setField('bateria_garantia_anos', e.target.value)} placeholder="Ex: 10" className="input-field" />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label className={styles.label}>Tipo de instalação</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {TIPOS_TELHADO.map((t) => {
                const selected = fields.tipo_telhado === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setField('tipo_telhado', selected ? '' : t)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: selected ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
                      background: selected ? 'var(--color-text)' : 'var(--color-surface)',
                      color: selected ? 'var(--color-bg)' : 'var(--color-text)',
                      fontSize: 13,
                      fontWeight: selected ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* FOTO DO TELHADO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Foto do telhado (opcional)</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Se enviar foto real do telhado, ganha autoridade — cliente vê que você esteve lá. Sem foto, a proposta sai limpa sem essa seção.
          </p>
          {fields.foto_telhado_b64 ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <img
                src={fields.foto_telhado_b64}
                alt="Foto do telhado"
                style={{ width: 180, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--color-border)' }}
              />
              <button
                type="button"
                onClick={() => setField('foto_telhado_b64', '')}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #EF4444', background: 'transparent', color: 'var(--ink-red)', cursor: 'pointer', fontSize: 13 }}
              >
                Remover foto
              </button>
            </div>
          ) : (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '32px 20px',
              border: '2px dashed var(--color-border)',
              borderRadius: 12,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 14,
            }}>
              Selecionar arquivo do dispositivo
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const b64 = await compressImage(file);
                    setField('foto_telhado_b64', b64);
                  } catch {
                    alert('Erro ao processar imagem. Tente outra.');
                  }
                }}
              />
            </label>
          )}
        </div>

        {/* INVESTIMENTO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Investimento</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Preço do projeto (R$) *</label>
              <input type="text" inputMode="numeric" value={fields.investimento} onChange={e => { setField('investimento', maskMoeda(e.target.value)); clearFaltando('investimento'); }} placeholder="Ex: 22.000,00" className="input-field" required {...invalidProps('investimento')} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Desconto especial à vista (R$)</label>
              <input type="text" inputMode="numeric" value={fields.preco_avista} onChange={e => setField('preco_avista', maskMoeda(e.target.value))} placeholder="Ex: 21.300,00 (opcional)" className="input-field" />
            </div>
          </div>
          <div style={{
            marginTop: 16,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.25)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
              Formas de pagamento que aparecem na proposta
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              {invNum > 0
                ? 'Marque o que o cliente vai ver. Desmarcar esconde da proposta gerada.'
                : 'Preencha o preço do projeto acima pra ver os valores das parcelas.'}
            </div>

            {/* À VISTA */}
            <PagGrupo
              checked={fields.pag_vista}
              onToggle={(v) => setField('pag_vista', v)}
              titulo="À vista"
              valor={invNum > 0
                ? `R$ ${(parseBRL(fields.preco_avista) > 0 && parseBRL(fields.preco_avista) < invNum ? parseBRL(fields.preco_avista) : invNum).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            />

            {/* CARTÃO DE CRÉDITO — 1x a 21x, cada uma com taxa editável ao lado */}
            <PagGrupo
              checked={fields.pag_cartao}
              onToggle={(v) => setField('pag_cartao', v)}
              titulo="Cartão de crédito"
            >
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '2px 6px 8px', lineHeight: 1.4 }}>
                <strong>Obs:</strong> taxa padronizada — adeque a sua realidade no campo de taxa ao lado de cada parcela.
              </div>
              {Array.from({ length: 21 }, (_, i) => i + 1).map((n) => {
                const ativoKey = `pag_cartao_${n}` as keyof typeof fields;
                const taxaKey = `taxa_cartao_${n}` as keyof typeof fields;
                const taxaPct = parseTaxa(String(fields[taxaKey] || ''));
                const valor = valorParcela(n, taxaPct);
                return (
                  <PagSubItemTaxa
                    key={n}
                    checked={Boolean(fields[ativoKey])}
                    onToggle={(v) => setField(ativoKey, v as never)}
                    label={`${n}x`}
                    taxa={String(fields[taxaKey] || '')}
                    onTaxaChange={(v) => setField(taxaKey, v as never)}
                    valor={invNum > 0 ? `R$ ${valor.toLocaleString('pt-BR')}/mês` : '—'}
                  />
                );
              })}
            </PagGrupo>

            {/* FINANCIAMENTO — 36x/48x/60x/84x, cada uma com taxa mensal editável */}
            <PagGrupo
              checked={fields.pag_fin}
              onToggle={(v) => setField('pag_fin', v)}
              titulo="Financiamento"
              subtitulo="120 dias de carência"
            >
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '2px 6px 8px', lineHeight: 1.4 }}>
                <strong>Obs:</strong> taxa mensal padrão 2,2% a.m. — adeque a sua realidade no campo de taxa ao lado de cada parcela.
              </div>
              {[36, 48, 60, 84].map((n) => {
                const ativoKey = `pag_fin_${n}` as keyof typeof fields;
                const taxaKey = `taxa_fin_${n}` as keyof typeof fields;
                const taxaPct = parseTaxa(String(fields[taxaKey] || ''));
                const valor = valorFinanciamento(n, taxaPct);
                return (
                  <PagSubItemTaxa
                    key={n}
                    checked={Boolean(fields[ativoKey])}
                    onToggle={(v) => setField(ativoKey, v as never)}
                    label={`${n}x`}
                    taxa={String(fields[taxaKey] || '')}
                    onTaxaChange={(v) => setField(taxaKey, v as never)}
                    valor={invNum > 0 ? `R$ ${valor.toLocaleString('pt-BR')}/mês` : '—'}
                  />
                );
              })}
            </PagGrupo>

            {/* ENTRADA + SALDO — integrador define entrada e modo de quitação do restante */}
            <PagGrupo
              checked={fields.pag_entrada}
              onToggle={(v) => setField('pag_entrada', v)}
              titulo="Entrada + saldo"
              subtitulo="integrador define o valor"
            >
              <div style={{ display: 'grid', gap: 10, padding: '4px 0 2px' }}>
                <div className={styles.field}>
                  <label className={styles.label} style={{ fontSize: 12 }}>Entrada (R$)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fields.entrada_valor}
                    onChange={(e) => setField('entrada_valor', maskMoeda(e.target.value))}
                    placeholder="Ex: 5.000,00"
                    className="input-field"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} style={{ fontSize: 12 }}>
                    Restante {invNum > 0 && entradaValor > 0 ? `(R$ ${entradaRestante.toLocaleString('pt-BR')})` : ''}
                  </label>
                  <select
                    value={fields.entrada_modo}
                    onChange={(e) => setField('entrada_modo', e.target.value as typeof fields.entrada_modo)}
                    className="input-field"
                  >
                    {(['dias', 'entrega', 'montagem', 'liberacao'] as const).map((m) => (
                      <option key={m} value={m}>{ENTRADA_MODO_LABEL[m]}</option>
                    ))}
                  </select>
                  {fields.entrada_modo === 'dias' && (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fields.entrada_dias}
                      onChange={(e) => setField('entrada_dias', e.target.value)}
                      placeholder="30"
                      className="input-field"
                      style={{ marginTop: 6 }}
                    />
                  )}
                </div>
              </div>
            </PagGrupo>

            {/* PAGAMENTO CUSTOMIZADO — texto livre */}
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 8,
            }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--color-text)', marginBottom: 6 }}>
                Outro tipo de pagamento
              </label>
              <input
                type="text"
                value={fields.pag_custom}
                onChange={(e) => setField('pag_custom', e.target.value)}
                placeholder='Ex: "Boleto em 5x sem juros" ou "Permuta + saldo em 90 dias"'
                className="input-field"
                style={{ width: '100%' }}
              />
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Se preenchido, vai aparecer como um card extra na proposta. Deixe vazio pra esconder.
              </span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Payback calculado automaticamente baseado no kWp, UF e inflação configurada abaixo. Geração mensal usa o valor que você preencheu na seção Sistema (vazio = calcula via HSP da cidade).
          </p>
        </div>

        {/* DETALHES EDITÁVEIS (abertos por padrão — afetam payback/economia) */}
        <details className={styles.section} style={{ cursor: 'pointer' }} open>
          <summary style={{
            listStyle: 'none',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-text)',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>Tarifa, taxa mínima e prazo</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>
              ajuste por região se preciso
            </span>
          </summary>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '10px 0 14px' }}>
            Tarifa muda por região e concessionária. Os outros valores funcionam pra maioria dos casos.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Tarifa de energia (R$/kWh)</label>
              <input type="text" inputMode="decimal" value={fields.tarifa_kwh} onChange={e => setField('tarifa_kwh', e.target.value)} placeholder="vazio = default do estado" className="input-field" />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Ex: MG ≈ 1,20 · SP ≈ 0,92 · BA ≈ 0,99. Olha a conta de luz do cliente pra ser exato.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Taxa mínima da concessionária (R$/mês)</label>
              <input type="text" inputMode="decimal" value={fields.taxa_minima} onChange={e => setField('taxa_minima', e.target.value)} placeholder="90" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de instalação (dias úteis)</label>
              <input type="text" inputMode="numeric" value={fields.prazo_instalacao_dias} onChange={e => setField('prazo_instalacao_dias', e.target.value)} placeholder="45" className="input-field" />
            </div>
          </div>
        </details>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteNome.trim()}>
          {generating ? 'Gerando...' : 'Gerar Proposta'}
        </button>
      </form>
    </div>
  );
}

function PagGrupo({
  checked, onToggle, titulo, subtitulo, valor, children,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  titulo: string;
  subtitulo?: string;
  valor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
      opacity: checked ? 1 : 0.55,
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
        />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>
          {titulo}{subtitulo && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: 11 }}> · {subtitulo}</span>}
        </span>
        {valor && <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>{valor}</span>}
      </label>
      {children && (
        <div style={{ marginTop: 8, paddingLeft: 27, display: 'grid', gap: 4, pointerEvents: checked ? 'auto' : 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function PagSubItem({
  checked, onToggle, label, sub, valor,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  sub?: string;
  valor: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', padding: '4px 6px', borderRadius: 6 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
      />
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>
        {label}{sub && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {sub}</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)' }}>{valor}</span>
    </label>
  );
}

function PagSubItemTaxa({
  checked, onToggle, label, taxa, onTaxaChange, valor,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  taxa: string;
  onTaxaChange: (v: string) => void;
  valor: string;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '18px 56px 110px 1fr',
      alignItems: 'center',
      gap: 10,
      padding: '4px 6px',
      borderRadius: 6,
      opacity: checked ? 1 : 0.6,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
      />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="text"
          inputMode="decimal"
          value={taxa}
          onChange={(e) => onTaxaChange(e.target.value)}
          className="input-field"
          style={{ width: 70, padding: '4px 6px', fontSize: 12, textAlign: 'right' }}
          placeholder="0,00"
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>%</span>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)', textAlign: 'right' }}>{valor}</span>
    </div>
  );
}

function btn(variant: 'primary' | 'outline' | 'ghost' | 'whatsapp'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.15s',
  };
  if (variant === 'primary') return { ...base, background: 'var(--color-primary, #F59E0B)', color: '#0F172A' };
  if (variant === 'whatsapp') return { ...base, background: '#25D366', color: '#fff' };
  if (variant === 'outline') return { ...base, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' };
  return { ...base, background: 'transparent', color: 'var(--color-text-muted)' };
}
