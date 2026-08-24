'use client';

import { useState, useEffect, useRef, useId } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageCircle, Link as LinkIcon, Download, RotateCcw, ScanLine, Pencil, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { prewarmPdf, sharePrewarmedPdf, type PdfAsset } from '@/services/downloadPdf';
import InfoHint from '@/components/InfoHint/InfoHint';
import { Escolha, Escolhas } from '@/components/Escolha/Escolha';
import { Home, Building2, Factory, Layers, Mountain, Car, Grid3x3, FileText, LineChart, BookOpen } from 'lucide-react';
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

/** Ícone por tipo de telhado — a escolha entra pelos olhos antes da palavra. */
const ICONE_TELHADO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'Cerâmico': Home,
  'Fibrocimento': Building2,
  'Metálico': Factory,
  'Cimento': Layers,
  'Laje': Grid3x3,
  'Solo': Mountain,
  'Carport': Car,
};

const TIPOS_TELHADO = ['Cerâmico', 'Fibrocimento', 'Metálico', 'Cimento', 'Laje', 'Solo', 'Carport'] as const;

const initialFields = {
  paleta: 'solar' as string, // 'solar'|'oceano'|... | 'custom' | 'empresa'
  paleta_c1: '', // cor escolhida no color picker (hex) quando paleta==='custom'
  // Rodapé da proposta. Os três vêm FIXOS do cadastro da empresa (preenchidos
  // ao abrir o form) e o consultor pode editar por proposta ou desmarcar pra a
  // linha não sair no documento. Não entram em CLIENTE_ONLY no backend, então
  // seguem no kit do vendedor: o que ele ajustou volta na próxima proposta.
  mostrar_vendedor_nome: true,
  mostrar_vendedor_contato: true,
  mostrar_cnpj: true,
  vendedor_nome: '',
  vendedor_whatsapp: '',
  empresa_cnpj: '',
  cidade: '',
  uf: '',
  consumo_kwh: '',
  qtd_modulos: '',
  area_m2: '',
  marca_modulo: '',
  potencia_modulo: '',
  qtd_inversores: '1',
  marca_inversor: '',
  potencia_inversor: '',
  // Bateria (opcional) — só aparece na proposta se a marca estiver preenchida.
  // Padrão render-if-filled, mesmo idioma das garantias extras (nada é persistido
  // como "tem bateria": deriva de marca preenchida → propostas antigas intactas).
  bateria_marca: '',
  // Quantidade de baterias. Pedido da GSI em 19/08/2026 — o campo NAO existia, nem
  // aqui nem no template, entao "a quantidade nao aparece no PDF" nunca foi bug de
  // renderizacao. Vazio ou 1 sai igual ao que ja' saia; de 2 pra cima vira "2× BYD".
  bateria_qtd: '',
  bateria_capacidade_kwh: '',
  bateria_potencia_kw: '',
  bateria_ciclos: '',
  bateria_garantia_anos: '',
  tipo_telhado: '' as '' | typeof TIPOS_TELHADO[number],
  // Geração média mensal (kWh). Pré-preenchida com estimativa (kWp × HSP × 365 × 0.80 / 12)
  // quando o consultor preenche kWp + UF. Editável — o que vier daqui vale, e o
  // gráfico aplica a sazonalidade da região por cima preservando essa média.
  geracao_media_kwh: '',
  // HSP (horas de sol pleno): vazio = usa o padrão da região; preenchido = override.
  hsp: '',
  investimento: '',
  preco_avista: '',
  foto_telhado_b64: '', // dataURL JPEG comprimido
  // Campos editáveis (defaults aplicados no servidor se vierem vazios).
  // tarifa_kwh: deixar vazio = usa default do estado. Preencher = override por proposta.
  tarifa_kwh: '',
  taxa_minima: '90',
  prazo_instalacao_dias: '45',
  // Validade da proposta em dias corridos. Vazio = 7 (default do servidor).
  // Vai no kit do vendedor, então a escolha se repete nas próximas propostas.
  validade_dias: '7',
  garantia_paineis: '25',
  garantia_inversor: '10',
  garantia_estrutura: '10',
  garantia_instalacao: '1',
  garantia_instalacao_unidade: 'anos', // 'anos' | 'meses' — mão de obra às vezes é 6 meses
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
  // Vírgula, não ponto: quem lê a tela é brasileiro, e "10.13" numa linha de
  // taxa se lê como dez mil. Os dois leitores da API (templateService) já
  // normalizam vírgula antes do parseFloat, e o parseTaxa daqui também.
  taxa_cartao_1: '3,99',
  taxa_cartao_2: '5,30',
  taxa_cartao_3: '5,99',
  taxa_cartao_4: '6,68',
  taxa_cartao_5: '7,35',
  taxa_cartao_6: '8,02',
  taxa_cartao_7: '9,47',
  taxa_cartao_8: '10,13',
  taxa_cartao_9: '10,78',
  taxa_cartao_10: '11,43',
  taxa_cartao_11: '12,06',
  taxa_cartao_12: '12,70',
  taxa_cartao_13: '13,32',
  taxa_cartao_14: '13,94',
  taxa_cartao_15: '14,56',
  taxa_cartao_16: '15,17',
  taxa_cartao_17: '15,77',
  taxa_cartao_18: '16,37',
  taxa_cartao_19: '16,97',
  taxa_cartao_20: '17,57',
  taxa_cartao_21: '18,17',
  pag_fin: true,
  // Financiamento: 36x/48x/60x/84x. Default marcados: 36x e 48x.
  // Taxa mensal editável (default 2,2% a.m. — Price com 120 dias de carência).
  pag_fin_36: true,
  pag_fin_48: true,
  pag_fin_60: false,
  pag_fin_84: false,
  taxa_fin_36: '2,20',
  taxa_fin_48: '2,20',
  taxa_fin_60: '2,20',
  taxa_fin_84: '2,20',
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
// Telefone BR enquanto digita: 17996243536 → "(17) 99624-3536". O DDI só cai
// fora quando o número já está completo (senão apagaria o "55" de quem digita
// devagar). O backend limpa pra dígitos de novo — isso aqui é só leitura.
function maskTel(raw: string): string {
  const d = soDigitos(raw).replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
// CNPJ: 12345678000190 → "12.345.678/0001-90".
function maskCnpj(raw: string): string {
  const d = soDigitos(raw).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export default function PropostaSolarPage() {
  const [clienteNome, setClienteNome] = useState('');
  const [cidadeUf, setCidadeUf] = useState('');
  const [fields, setFields] = useState(initialFields);
  // Modelo da proposta: 1 = "1 Página" (padrão) · 2 = "Moderno" (completo)
  // · 3 = o MESMO Moderno com uma folha de rosto na frente (pedido do Eduardo
  // Boso, 21/08/2026: "falta uma capa na proposta"). O 3 nao muda o 2 — quem
  // ja' manda o Moderno continua mandando exatamente o mesmo PDF.
  const [modelo, setModelo] = useState<1 | 2 | 3>(1);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  // Corrigindo uma proposta JÁ emitida: volta pro form com tudo preenchido e o
  // submit reemite o mesmo documento (mesmo link, mesmo número) em vez de criar outro.
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [copyMsg, setCopyMsg] = useState('');
  // Validação inline: quais campos obrigatórios estão faltando (pra marcar de vermelho).
  const [faltando, setFaltando] = useState<Set<string>>(new Set());
  // PDF pré-aquecido pro compartilhamento nativo do iOS (ver downloadPdf.ts).
  const [pdfAsset, setPdfAsset] = useState<PdfAsset | null>(null);
  const [pdfWarming, setPdfWarming] = useState(false);
  // Reemitir mantém o doc_id, então o pré-aquecimento não reagiria sozinho e o botão
  // mandaria o PDF de antes da correção. Esse contador força buscar o PDF novo.
  const [pdfVersion, setPdfVersion] = useState(0);

  // ?doc=<id> — veio do botão "Editar" do /histórico: abre a proposta salva já em
  // modo edição, em vez de um formulário em branco.
  const router = useRouter();
  const searchParams = useSearchParams();
  const docParam = searchParams.get('doc');
  const docCarregado = useRef(false);
  const [carregandoDoc, setCarregandoDoc] = useState(false);

  // Cor de marca da empresa (cadastrada em Empresa) — habilita a paleta
  // "Cores da empresa". Só o swatch/enable usa isso no front; a geração lê
  // company.cor_marca direto no backend.
  const [corEmpresa, setCorEmpresa] = useState('');   // cor principal (cor_marca)
  const [corSec, setCorSec] = useState('');           // cor de destaque (cor_secundaria)
  // O que o cadastro diz — vira o valor fixo dos três campos do rodapé e fica
  // guardado pro botão "usar o do cadastro" de cada um.
  const [padraoEmpresa, setPadraoEmpresa] = useState({ vendedor: '', whatsapp: '', cnpj: '' });
  useEffect(() => {
    api.get('/company').then(({ data }) => {
      const c = (data?.company || {}) as Record<string, string>;
      setCorEmpresa(String(c.cor_marca || ''));
      setCorSec(String(c.cor_secundaria || ''));
      const pad = {
        vendedor: String(c.socio_adm || c.nome_fantasia || c.nome || '').trim(),
        whatsapp: maskTel(String(c.whatsapp || '')),
        cnpj: maskCnpj(String(c.cnpj || '')),
      };
      setPadraoEmpresa(pad);
      // Só preenche o que está VAZIO. Vale nas duas ordens de chegada: se a
      // proposta salva (?doc=) carregar depois, o spread dela sobrescreve; se
      // carregar antes, o `||` respeita o que ela gravou. Proposta antiga não
      // tem esses campos — aí o form mostra o mesmo que o PDF já imprime, em
      // vez de três caixas vazias.
      setFields(f => ({
        ...f,
        vendedor_nome:     f.vendedor_nome     || pad.vendedor,
        vendedor_whatsapp: f.vendedor_whatsapp || pad.whatsapp,
        empresa_cnpj:      f.empresa_cnpj      || pad.cnpj,
      }));
    }).catch(() => {});
  }, []);
  // ── Autosave (item 1): rascunho em localStorage, debounce 600ms. Um erro de
  // rede/timeout não apaga mais os ~40 campos. Restaura ao montar, limpa no sucesso.
  const DRAFT_KEY = 'proposta-solar-draft-v1';
  const draftLoaded = useRef(false);
  const temRascunho = useRef(false);           // havia rascunho neste aparelho?
  // A quantidade de módulos foi escrita por uma PESSOA (digitada, restaurada de
  // rascunho, do histórico do cliente ou de um doc em edição)? Só então a sugestão
  // automática cala a boca. Sem esta distinção, o "já tem valor" incluía o valor
  // que a própria sugestão acabou de escrever — ver o useEffect lá embaixo.
  const qtdModulosManual = useRef(false);
  // Mesma ideia pra metragem do telhado: 2,5 m² por módulo é chute de catálogo,
  // e quem subiu no telhado tem o número de verdade. Escreveu, é dele.
  const areaManual = useRef(false);
  // Campos que a PESSOA mexeu nesta sessão do formulário. Preenchimento
  // automático que chega depois (kit do vendedor, que vem por rede) não escreve
  // por cima deles. Regra da casa: o que o cliente coloca, fica.
  const camposTocados = useRef(new Set<string>());
  const [clientesHist, setClientesHist] = useState<string[]>([]); // clientes com histórico

  // Restaura rascunho ao montar (1x). Abrindo pra editar um doc salvo (?doc=), o
  // rascunho de outra proposta não pode entrar por cima — nem ser sobrescrito por
  // esta edição (o autosave abaixo só liga quando draftLoaded vira true).
  useEffect(() => {
    if (docParam || draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      temRascunho.current = true;
      const d = JSON.parse(raw);
      if (d.clienteNome) setClienteNome(d.clienteNome);
      if (d.cidadeUf) setCidadeUf(d.cidadeUf);
      if (d.fields) setFields(f => ({ ...f, ...d.fields }));
      // Rascunho já tinha quantidade: era escolha da pessoa, a sugestão não mexe.
      if (d.fields?.qtd_modulos) qtdModulosManual.current = true;
      if (d.fields?.area_m2) areaManual.current = true;
    } catch { /* rascunho corrompido — ignora */ }
    // Roda de novo quando o ?doc= sai da URL ("Nova proposta" depois de uma edição):
    // é o que religa o autosave, que fica desligado durante a edição.
  }, [docParam]);

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

  // ── Auto-preenchimento (servidor) ──
  // Kit do vendedor (marcas/garantias/taxas/paleta da última proposta) pré-preenche
  // todo doc novo — só quando NÃO há rascunho local (o rascunho já traz o kit).
  // Também carrega a lista de clientes com histórico pro seletor.
  useEffect(() => {
    api.get('/documents/proposta-prefill').then(({ data }) => {
      setClientesHist(Array.isArray(data?.clientes) ? data.clientes : []);
      // Editando um doc salvo, o kit não entra: os dois chegam por rede e o kit
      // poderia aterrissar depois, trocando as marcas/taxas daquela proposta.
      if (!docParam && !temRascunho.current && data?.kit && Object.keys(data.kit).length) {
        // O kit chega pela REDE, então corre contra os dedos de quem já começou a
        // preencher. Campo que a pessoa tocou não é sobrescrito — ela veria o
        // próprio texto sumir sozinho meio segundo depois de escrever.
        setFields(f => {
          const merged: Record<string, unknown> = { ...f };
          for (const [k, v] of Object.entries(data.kit as Record<string, unknown>)) {
            if (!camposTocados.current.has(k)) merged[k] = v;
          }
          return merged as typeof f;
        });
      }
    }).catch(() => { /* sem histórico ainda — ignora */ });
  }, [docParam]);

  // Abre a proposta salva já no modo edição (veio do /histórico).
  useEffect(() => {
    if (!docParam || docCarregado.current) return;
    docCarregado.current = true;
    setCarregandoDoc(true);
    api.get(`/documents/${docParam}/edit`).then(({ data }) => {
      const d = data?.document;
      if (!d) throw new Error('sem documento');
      const dados = (d.dados_json ?? {}) as Record<string, string>;
      // Proposta sem os dados do formulário salvos (doc antigo/importado): reemitir
      // por cima escreveria um formulário em branco em cima de uma proposta boa.
      if (!Object.keys(dados).length) throw new Error('sem dados do formulário');
      setFields(f => ({ ...f, ...dados }));
      // Proposta já emitida: a quantidade dela é decisão tomada, não palpite.
      if (dados.qtd_modulos) qtdModulosManual.current = true;
      if (dados.area_m2) areaManual.current = true;
      setClienteNome(String(d.cliente_nome || ''));
      const cid = String(dados.cidade || '').trim(), uf = String(dados.uf || '').trim();
      if (cid || uf) setCidadeUf([cid, uf].filter(Boolean).join(' - '));
      setModelo(d.modelo_numero === 2 ? 2 : d.modelo_numero === 3 ? 3 : 1);
      setGenerated({
        content: String(d.content || ''),
        modelo_usado: `modelo-${d.modelo_numero}`,
        cliente_nome: String(d.cliente_nome || ''),
        doc_id: d.doc_id,
        codigo: d.codigo ?? null,
        codigo_curto: d.codigo_curto ?? null,
        empresa_slug: d.empresa_slug ?? null,
        // O resumo de WhatsApp é calculado na emissão e não fica salvo — depois de
        // atualizar ele volta; até lá o botão usa o texto curto de fallback.
        resumo_whatsapp: null,
      });
      setEditando(true);
    }).catch(() => {
      setError('Não consegui abrir essa proposta pra edição. Ela pode ter sido removida, ou é antiga demais e não guardou os dados do formulário.');
    }).finally(() => setCarregandoDoc(false));
  }, [docParam]);

  // Carrega a última proposta de um cliente (histórico por cliente) e preenche tudo.
  const [carregandoCliente, setCarregandoCliente] = useState(false);
  async function carregarCliente(nome: string) {
    if (!nome.trim()) return;
    setCarregandoCliente(true);
    try {
      const { data } = await api.get('/documents/proposta-prefill', { params: { cliente_nome: nome } });
      const c = data?.cliente;
      if (c && Object.keys(c).length) {
        setFields(f => ({ ...f, ...c }));
        // Veio a quantidade da última proposta dele: é dado real, não sugestão.
        if (c.qtd_modulos) qtdModulosManual.current = true;
        // A metragem do telhado dele não muda de uma proposta pra outra.
        if (c.area_m2) areaManual.current = true;
        setClienteNome(nome);
        const cid = String(c.cidade || '').trim(), uf = String(c.uf || '').trim();
        if (cid || uf) setCidadeUf([cid, uf].filter(Boolean).join(' - '));
      }
    } catch { /* ignora */ } finally { setCarregandoCliente(false); }
  }

  // kWp deriva de qtd_modulos × potencia_modulo (verdade técnica: 10×620W = 6,2 kWp)
  const kwpCalc = (() => {
    const qtd = parseInt(fields.qtd_modulos, 10);
    const pot = parseInt(fields.potencia_modulo, 10);
    if (qtd > 0 && pot > 0) return ((qtd * pot) / 1000);
    return 0;
  })();

  // Consumo alto demais pra ser mensal. 10.000 kWh/mês é ~R$ 10 mil de conta:
  // existe, mas é raro, e ali em cima quase sempre é o consumo do ANO ou o valor
  // da conta em reais digitado no campo errado. Encontrados 6 casos na base
  // (49.801, 84.000, 150.000 kWh/mês) — o formulário aceitava calado e a
  // proposta saía dimensionada em cima do número errado.
  const consumoForaDaEscala = parseBRL(fields.consumo_kwh) > 10000;

  // Estimativa de geração média mensal (kWh) — só pra placeholder do input.
  // Usa HSP médio do Brasil (5.2) com eficiência 80%. O backend tem a tabela
  // completa por UF/cidade, então o valor real do PDF pode diferir um pouco.
  const geracaoMediaSugerida = kwpCalc > 0 ? Math.round((kwpCalc * 5.2 * 365 * 0.80) / 12) : 0;

  // Sugere qtd_modulos baseado no consumo (estimativa: kWh/mês ÷ 115 = kWp).
  // Divisor 115 gera ~10% de oversize pra cobrir degradação dos painéis (~0,5% a.a.)
  // — sem isso, no ano 2-3 o sistema já fica deficitário.
  //
  // A sugestão ACOMPANHA o que está sendo digitado, e para de vez assim que a
  // pessoa escreve a quantidade na mão. A versão anterior travava no primeiro
  // dígito do consumo: o kit do vendedor já traz `potencia_modulo` da proposta
  // anterior, então o "1" de 1.250 virava 1 kWh → 1 módulo, e a guarda
  // `!fields.qtd_modulos` (que não separava valor da pessoa de valor da própria
  // sugestão) impedia qualquer recálculo. O integrador pedia 1.250 kWh e levava
  // 0,63 kWp pro cliente. Relatado em 13/08/2026.
  useEffect(() => {
    if (qtdModulosManual.current) return;
    const kwh = parseBRL(fields.consumo_kwh);
    const potMod = parseInt(fields.potencia_modulo, 10);
    if (!kwh || !potMod) return;
    const qtd = String(Math.ceil((kwh / 115 * 1000) / potMod));
    setFields(f => (f.qtd_modulos === qtd ? f : { ...f, qtd_modulos: qtd }));
  }, [fields.consumo_kwh, fields.potencia_modulo]);

  // Área que os módulos ocupam: 2,5 m² cada (módulo de 60/72 células com a folga
  // de fixação). É o mesmo número que o PDF calculava sozinho — a diferença é que
  // agora ele aparece na tela e dá pra trocar pela metragem medida no telhado.
  const areaSugerida = (() => {
    const qtd = parseInt(fields.qtd_modulos, 10);
    return qtd > 0 ? Math.round(qtd * 2.5 * 10) / 10 : 0;
  })();

  // Acompanha a quantidade de módulos até alguém escrever a metragem na mão.
  useEffect(() => {
    if (areaManual.current) return;
    const valor = areaSugerida > 0 ? String(areaSugerida).replace('.', ',') : '';
    setFields(f => (f.area_m2 === valor ? f : { ...f, area_m2: valor }));
  }, [areaSugerida]);

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

  // Validade: mostra o texto exato que vai sair no cabeçalho da proposta.
  // Calculado só depois de montar (a data depende do fuso do aparelho — no SSR
  // daria hidratação divergente na virada do dia).
  const [validadeLabel, setValidadeLabel] = useState('');
  useEffect(() => {
    // String(...) porque o valor pode voltar do kit (dados_json) como número.
    const n = parseInt(String(fields.validade_dias ?? '').replace(/\D/g, ''), 10);
    const dias = n > 0 ? n : 7;
    const ate = new Date(Date.now() + dias * 86400000).toLocaleDateString('pt-BR');
    setValidadeLabel(`Válido por ${dias} ${dias === 1 ? 'dia' : 'dias'} · até ${ate}`);
  }, [fields.validade_dias]);

  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    // O que a pessoa digita é sagrado: fica marcado aqui pra nenhum
    // preenchimento automático escrever por cima depois (ver o kit do vendedor).
    camposTocados.current.add(String(k));
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
    setEditando(false);
    setError('');
    setFaltando(new Set());
    setClienteNome('');
    setCidadeUf('');
    // Documento novo: a sugestão de módulos volta a valer e nada está "tocado".
    qtdModulosManual.current = false;
    areaManual.current = false;
    camposTocados.current.clear();
    setFields(f => ({
      ...f,
      // específicos do cliente/venda — zerados:
      consumo_kwh: '', qtd_modulos: '', area_m2: '', potencia_modulo: '',
      qtd_inversores: initialFields.qtd_inversores, potencia_inversor: '',
      // bateria: capacidade/potência/ciclos são específicos da venda; marca e
      // garantia ficam (template do integrador, igual marca_inversor).
      bateria_qtd: '', bateria_capacidade_kwh: '', bateria_potencia_kw: '', bateria_ciclos: '',
      geracao_media_kwh: '', hsp: '', investimento: '', preco_avista: '',
      foto_telhado_b64: '', tipo_telhado: '',
      // marca/garantias/pagamento ficam como estão (template do integrador).
    }));
    limparRascunho();
    // Veio do /histórico (?doc=): tira o parâmetro pra proposta nova não ficar
    // amarrada ao doc antigo (e o efeito do rascunho religa o autosave).
    if (docParam) router.replace('/documentos?tipo=proposta');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // "Editar proposta": volta pro formulário com tudo que gerou esta proposta ainda
  // preenchido (nada limpa os fields na emissão). O PDF antigo é descartado aqui pra
  // ninguém compartilhar a versão errada no meio da correção.
  function editarProposta() {
    setEditando(true);
    setError('');
    setCopyMsg('');
    setPdfAsset(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Desistiu da correção: volta pra proposta como estava (nada foi reemitido).
  function cancelarEdicao() {
    setEditando(false);
    setError('');
    setFaltando(new Set());
    setPdfVersion(v => v + 1); // re-aquece o PDF que foi descartado ao entrar na edição
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
        modeloNumero: modelo,
        cliente_nome_avulso: clienteNome.trim(),
      };
      // Editando: reemite o MESMO documento (mesmo link /p/:id, mesmo número, sem
      // consumir cota) em vez de criar uma proposta nova ao lado da errada.
      const editandoId = editando ? generated?.doc_id : null;
      const { data } = editandoId
        ? await api.post(`/documents/${editandoId}/regenerate`, payload)
        : await api.post('/documents/generate', payload);
      setGenerated(data);
      setEditando(false);
      if (editandoId) {
        // Link e PDF apontam pro mesmo doc: força buscar o PDF corrigido.
        setPdfAsset(null);
        setPdfVersion(v => v + 1);
        setCopyMsg('Proposta atualizada — mesmo link e mesmo número.');
        setTimeout(() => setCopyMsg(''), 4000);
      }
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
      setError(error.response?.data?.error || (editando ? 'Erro ao atualizar a proposta' : 'Erro ao gerar proposta'));
    } finally {
      setGenerating(false);
    }
  }

  // Pré-aquece o PDF quando a proposta fica pronta, pro navigator.share disparar
  // no clique sem await (transient activation do iOS). Ver downloadPdf.ts.
  useEffect(() => {
    const id = generated?.doc_id;
    if (!id) { setPdfAsset(null); return; }
    setPdfWarming(true);
    let cancelled = false;
    prewarmPdf(id)
      .then(asset => { if (!cancelled) { setPdfAsset(asset); } })
      .catch(() => { if (!cancelled) setPdfAsset(null); })
      .finally(() => { if (!cancelled) setPdfWarming(false); });
    return () => { cancelled = true; };
  }, [generated?.doc_id, pdfVersion]);

  async function handleDownloadPdf() {
    if (!generated?.doc_id) return;
    // Caminho feliz: PDF pré-aquecido → folha de compartilhamento nativa do iOS
    // no gesto (não prende o PWA). Ver downloadPdf.ts.
    if (pdfAsset) {
      await sharePrewarmedPdf(pdfAsset);
      return;
    }
    // Ainda aquecendo/falhou: busca agora (fallback baixa se o share não rolar).
    setCopyMsg('Preparando PDF...');
    try {
      const asset = await prewarmPdf(generated.doc_id);
      setPdfAsset(asset);
      await sharePrewarmedPdf(asset);
      setCopyMsg('');
    } catch (err) {
      const e = err as { response?: { status?: number } };
      setCopyMsg(e?.response?.status === 401 ? 'Sessão expirou. Faça login novamente.' : 'Não foi possível gerar o PDF. Tente de novo.');
      setTimeout(() => setCopyMsg(''), 5000);
    }
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

  // Abrindo do /histórico: segura a tela até os dados chegarem, senão o consultor
  // veria um formulário em branco e começaria a digitar por cima.
  if (carregandoDoc) {
    return (
      <div className={styles.page}>
        <p style={{ padding: '48px 0', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Abrindo a proposta pra edição...
        </p>
      </div>
    );
  }

  // Quando preview ativo, fica fullscreen com iframe + ações
  if (generated && !editando) {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          {/* Achou erro na proposta pronta? Corrige e reemite a MESMA (mesmo link).
              Fica antes do "Nova proposta" porque esse zera os dados do cliente. */}
          <button type="button" onClick={editarProposta} style={{ ...btn('outline'), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Pencil size={15} /> Editar esta proposta</button>
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
            disabled={!generated.doc_id || pdfWarming}
            style={{ ...btn('outline'), opacity: (!generated.doc_id || pdfWarming) ? 0.6 : 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={15} /> {pdfWarming ? 'Preparando...' : 'Baixar / Enviar PDF'}
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
        <h1 className={styles.title}>{editando ? 'Editar proposta' : 'Proposta Solar'}</h1>
        <p className={styles.subtitle}>
          {editando
            ? 'Corrija o que estiver errado e atualize — a proposta é reemitida no mesmo link, com o mesmo número.'
            : 'Gera proposta comercial bonita pra cliente final — copia link, manda WhatsApp ou imprime'}
        </p>
      </div>

      {/* Modo edição: deixa explícito que NÃO nasce proposta nova e dá a saída sem alterar. */}
      {editando && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          marginBottom: 16, padding: '12px 16px', borderRadius: 12,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)',
        }}>
          <Pencil size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--color-text)', flex: 1, minWidth: 200 }}>
            Editando a proposta {publicId ? <strong style={{ fontFamily: 'monospace' }}>{publicId}</strong> : 'atual'}.
            O link já enviado passa a mostrar a versão corrigida — e não conta como proposta nova.
          </span>
          <button type="button" onClick={cancelarEdicao} style={{ ...btn('ghost'), whiteSpace: 'nowrap' }}>
            Voltar sem alterar
          </button>
        </div>
      )}

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

          {/* Modelo da proposta. Os botoes eram feitos a mao, com "●/○" no texto
              e style inline; agora usam o card padrao da plataforma, o mesmo do
              Kit Off-Grid e da Precificacao. */}
          <label className={styles.label}>Modelo da proposta</label>
          <div style={{ marginTop: 6 }}>
            <Escolhas colunas={2}>
              <Escolha
                on={modelo === 1}
                icone={FileText}
                onClick={() => setModelo(1)}
                titulo="1 Página"
                desc="A4 compacto — padrão"
              />
              <Escolha
                on={modelo === 2}
                icone={LineChart}
                onClick={() => setModelo(2)}
                titulo="Moderno"
                desc="completo, com gráfico de 25 anos"
              />
              <Escolha
                on={modelo === 3}
                icone={BookOpen}
                onClick={() => setModelo(3)}
                titulo="Moderno com capa"
                desc="o mesmo, com folha de rosto na frente"
              />
            </Escolhas>
          </div>

          {/* A COR MORA NA EMPRESA, e num lugar só. Editar a mesma coisa em duas
              telas faz a pessoa não saber qual vale — e aqui era pior: o campo
              dizia "sua proposta" mas salvava no cadastro da empresa, mudando
              todos os documentos futuros sem avisar. */}
          <p style={{ fontSize: 12.5, color: 'var(--color-text-dim)', margin: '14px 0 0', lineHeight: 1.5 }}>
            As cores da proposta vêm do cadastro da sua empresa.{' '}
            <Link href="/empresa" style={{ color: 'var(--color-primary)', fontWeight: 700, textDecoration: 'underline' }}>
              Trocar as cores
            </Link>
          </p>
        </div>

        {/* CLIENTE */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente</h2>

          {/* Histórico por cliente: recarrega tudo que foi usado na última proposta dele */}
          {clientesHist.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label className={styles.label}>Cliente com histórico<InfoHint>Traz de volta tudo da última proposta desse cliente: consumo, kWp, tarifa, marcas…</InfoHint></label>
              <select
                className="input-field"
                value=""
                disabled={carregandoCliente}
                onChange={e => { if (e.target.value) carregarCliente(e.target.value); }}
              >
                <option value="">{carregandoCliente ? 'Carregando…' : '↺ Carregar dados de um cliente…'}</option>
                {clientesHist.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

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
              {/* Só cutuca — não corrige, não bloqueia, não some com o que foi digitado. */}
              {consumoForaDaEscala && (
                <p className={styles.avisoCampo}>
                  <AlertTriangle size={14} aria-hidden />
                  <span>
                    {parseBRL(fields.consumo_kwh).toLocaleString('pt-BR')} kWh <strong>por mês</strong> é consumo de indústria.
                    Confere se não é o consumo do ano, ou o valor da conta em reais — o sistema é dimensionado em cima desse número.
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* RODAPÉ — vendedor e CNPJ que saem no documento */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Contato no rodapé da proposta</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -4, marginBottom: 12 }}>
            Já vem preenchido com o cadastro da sua empresa. Edite pra esta proposta — ou desmarque pra a linha não sair no documento.
          </p>
          <RodapeCampo
            checked={fields.mostrar_vendedor_nome}
            onToggle={v => setField('mostrar_vendedor_nome', v)}
            titulo="Nome do vendedor"
            value={fields.vendedor_nome}
            onChange={v => setField('vendedor_nome', v)}
            placeholder={padraoEmpresa.vendedor || 'Ex: Jair'}
            padrao={padraoEmpresa.vendedor}
          />
          <RodapeCampo
            checked={fields.mostrar_vendedor_contato}
            onToggle={v => setField('mostrar_vendedor_contato', v)}
            titulo="Telefone / WhatsApp"
            subtitulo="é ele que vai no QR Code"
            value={fields.vendedor_whatsapp}
            onChange={v => setField('vendedor_whatsapp', maskTel(v))}
            placeholder="(17) 99624-3536"
            padrao={padraoEmpresa.whatsapp}
            inputMode="tel"
          />
          <RodapeCampo
            checked={fields.mostrar_cnpj}
            onToggle={v => setField('mostrar_cnpj', v)}
            titulo="CNPJ da empresa"
            value={fields.empresa_cnpj}
            onChange={v => setField('empresa_cnpj', maskCnpj(v))}
            placeholder="00.000.000/0001-00"
            padrao={padraoEmpresa.cnpj}
            inputMode="numeric"
          />
        </div>

        {/* SISTEMA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sistema fotovoltaico</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade de módulos *</label>
              {/* Digitou aqui? a sugestão automática se cala. Apagou o campo? ela volta. */}
              <input type="text" inputMode="numeric" value={fields.qtd_modulos} onChange={e => { qtdModulosManual.current = e.target.value.trim() !== ''; setField('qtd_modulos', e.target.value); clearFaltando('qtd_modulos'); }} placeholder="Ex: 10" className="input-field" required {...invalidProps('qtd_modulos')} />
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
              <label className={styles.label}>Geração média mensal (kWh)<InfoHint>Vira a média anual da proposta. Vazio = o sistema calcula pelo HSP da cidade. O gráfico aplica a sazonalidade da região em cima desse valor.</InfoHint></label>
              <input
                type="text"
                inputMode="numeric"
                value={fields.geracao_media_kwh}
                onChange={e => setField('geracao_media_kwh', maskMilhar(e.target.value))}
                placeholder={geracaoMediaSugerida > 0 ? `Estimado: ${geracaoMediaSugerida.toLocaleString('pt-BR')} kWh/mês (deixe vazio pra usar)` : 'Preencha kWp e cidade pra ver estimativa'}
                className="input-field"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Área do telhado (m²)<InfoHint>Sai na proposta como a área que o sistema ocupa. Vem preenchida por 2,5 m² por módulo — se você foi no telhado e mediu, escreve a sua metragem que ela manda.</InfoHint></label>
              {/* Preenchida sozinha enquanto ninguém mexeu; escreveu, é dele. */}
              <input
                type="text"
                inputMode="decimal"
                value={fields.area_m2}
                onChange={e => { areaManual.current = e.target.value.trim() !== ''; setField('area_m2', e.target.value); }}
                placeholder={areaSugerida > 0 ? `Ex: ${areaSugerida.toLocaleString('pt-BR')}` : 'Preencha a quantidade de módulos'}
                className="input-field"
              />
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
              <label className={styles.label}>Garantia da instalação (mão de obra)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" inputMode="numeric" value={fields.garantia_instalacao} onChange={e => setField('garantia_instalacao', e.target.value)} placeholder="1" className="input-field" style={{ flex: 1, minWidth: 0 }} />
                <select
                  value={fields.garantia_instalacao_unidade}
                  onChange={e => setField('garantia_instalacao_unidade', e.target.value)}
                  className="input-field"
                  style={{ flex: '0 0 auto', width: 'auto' }}
                  aria-label="Unidade da garantia de instalação"
                >
                  <option value="anos">anos</option>
                  <option value="meses">meses</option>
                </select>
              </div>
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
              <label className={styles.label}>Quantidade</label>
              <input type="text" inputMode="numeric" value={fields.bateria_qtd} onChange={e => setField('bateria_qtd', e.target.value)} placeholder="Ex: 2" className="input-field" />
            </div>
            <div className={styles.field}>
              {/* "cada" entra sozinho na proposta quando a quantidade passa de 1 —
                  senao um banco lendo "10,24 kWh" entende como o banco inteiro. */}
              <label className={styles.label}>Capacidade (kWh, por bateria)</label>
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
            {/* Cada telhado tem um icone porque a escolha e' visual na cabeca de
                quem instala — ele "ve" o telhado antes de ler a palavra. */}
            <div style={{ marginTop: 6 }}>
              <Escolhas colunas={4}>
                {TIPOS_TELHADO.map((t) => {
                  const Ic = ICONE_TELHADO[t] ?? Home;
                  const selected = fields.tipo_telhado === t;
                  return (
                    <Escolha key={t} on={selected} icone={Ic}
                      onClick={() => setField('tipo_telhado', selected ? '' : t)}
                      titulo={t} />
                  );
                })}
              </Escolhas>
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
            <span>Tarifa, taxa mínima, prazo e validade</span>
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
            <div className={styles.field}>
              <label className={styles.label}>Validade da proposta (dias)<InfoHint>Dias corridos que a proposta vale, contados da emissão. Aparece no cabeçalho com a data limite e congela ali — proposta antiga não se renova sozinha. Vazio = 7 dias.</InfoHint></label>
              <input type="text" inputMode="numeric" maxLength={4} value={fields.validade_dias} onChange={e => setField('validade_dias', e.target.value.replace(/\D/g, ''))} placeholder="7" className="input-field" />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {validadeLabel ? `Sai na proposta: "${validadeLabel}"` : 'Vazio = 7 dias.'}
              </span>
            </div>
          </div>
        </details>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteNome.trim()}>
          {editando
            ? (generating ? 'Atualizando...' : 'Atualizar Proposta')
            : (generating ? 'Gerando...' : 'Gerar Proposta')}
        </button>
      </form>
    </div>
  );
}

// Linha do rodapé: checkbox (sai ou não sai no documento) + o texto editável.
// Desmarcado não apaga o que está escrito — remarcar devolve o valor de antes.
function RodapeCampo({
  checked, onToggle, titulo, subtitulo, value, onChange, placeholder, padrao, inputMode,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  titulo: string;
  subtitulo?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  padrao?: string;
  inputMode?: 'text' | 'tel' | 'numeric';
}) {
  // Telefone e CNPJ comparam por dígito: pontuação diferente não é edição.
  const norm = (s: string) => (inputMode === 'text' || !inputMode ? s.trim() : s.replace(/\D/g, ''));
  const alterado = Boolean(padrao) && norm(value) !== norm(padrao as string);
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
      opacity: checked ? 1 : 0.55,
    }}>
      {/* 21px de altura era menor que o dedo. O texto nao muda de lugar: o
          minHeight so' abre respiro em volta. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
        />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>
          {titulo}{subtitulo && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: 11 }}> · {subtitulo}</span>}
        </span>
        {!checked && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>não sai na proposta</span>}
      </label>
      <div style={{ marginTop: 8, paddingLeft: 27 }}>
        <input
          type="text"
          inputMode={inputMode || 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={!checked}
          className="input-field"
          style={{ width: '100%' }}
        />
        {alterado && checked && (
          <button
            type="button"
            onClick={() => onChange(padrao as string)}
            style={{ ...btn('ghost'), padding: '4px 0', fontSize: 11, marginTop: 4 }}
          >
            ↺ voltar pro cadastro ({padrao})
          </button>
        )}
      </div>
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
      {/* 21px de altura era menor que o dedo. O texto nao muda de lugar: o
          minHeight so' abre respiro em volta. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer', userSelect: 'none' }}>
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
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer', userSelect: 'none', padding: '4px 8px', borderRadius: 6 }}>
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
  const idCx = useId();
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '92px 110px 1fr',
      alignItems: 'center',
      gap: 10,
      padding: '4px 6px',
      borderRadius: 6,
      opacity: checked ? 1 : 0.6,
    }}>
      {/* Esta linha e' um DIV, nao um label — entao a caixinha de 15px era o
          unico ponto clicavel de uma linha de 54px. A linha nao pode virar
          label inteira porque tem o campo da taxa dentro (clicar pra digitar
          desmarcaria a parcela). A saida e' um rotulo cobrindo a caixa E o
          "1x" numa coluna so': 92x40 de alvo, e o campo da taxa fica de fora. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer', userSelect: 'none' }}>
        <input
          id={idCx}
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="text"
          inputMode="decimal"
          value={taxa}
          onChange={(e) => onTaxaChange(e.target.value)}
          className="input-field"
          style={{ width: 76, minHeight: 40, padding: '8px 8px', fontSize: 13, textAlign: 'right' }}
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
