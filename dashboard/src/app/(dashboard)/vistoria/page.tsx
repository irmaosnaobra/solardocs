'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type ComponentProps } from 'react';
import {
  ClipboardCheck, Camera, Paperclip, Check, X, RefreshCw, Share2, Copy, Plus, Trash2, FileText, Download,
  MapPin, LocateFixed, UserPlus, Users, Type, CheckCircle2, RotateCcw, FileDown,
} from 'lucide-react';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import ClientModal from '@/components/ClientModal/ClientModal';
import { Abas, Aba } from '@/components/Escolha/Escolha';
import {
  Pagina, Cabecalho, Indicadores, PainelTabela, Gaveta, EstadoVazio, EstadoErroLista, Etiqueta, Progresso,
  useEsconderWhatsFab, estilos as e, type ColunaTabela, type Indicador,
} from '@/components/AreaTrabalho/AreaTrabalho';
import './vistoria.css';
import StatusItem from './StatusItem';
import { criarGravadorStatus } from './gravadorStatus';
import Assinaturas from './Assinaturas';
import {
  ITENS_COM_STATUS, SELOS, TEXTOS, dataCurta, ehMigracaoPendente,
  type AssinaturasEstado, type ItemLista, type MapaStatus, type Resumo, type StatusKey,
} from './tipos';

// Telemetria de uso (não abate crédito — vistoria é ferramenta de campo).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'vistoria', event_type }).catch(() => {});
}

interface Client { id: string; nome: string; docs?: string[] }
interface Grupo { empresa: string; clientes: Client[] }

// Documento escaneado que será arquivado no cliente após o cadastro.
type DocTipo = 'conta_luz' | 'identidade';
interface DocPendente { base64: string; media_type: string; nome: string }

// Uma foto/arquivo no estado do cliente. `url` só existe depois de subir.
interface Foto {
  cid: string;                 // id client-side (chave de render/estado)
  url?: string;                // caminho no Storage (vem do servidor)
  signed?: string | null;      // signed url pra exibir (vem do servidor)
  preview?: string;            // data URL local (imagem) pra mostrar na hora
  tipo: 'image' | 'file';
  nome?: string;
  uploading?: boolean;
  error?: boolean;
}

interface Item { key: string; label: string; dica: string; obs: string; fotos: Foto[] }
interface Localizacao { lat: number | null; lng: number | null; link: string | null; texto: string | null; origem: 'gps' | 'colado'; em: string }
interface Vistoria { id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: Item[]; localizacao?: Localizacao | null }

interface DetalheApi {
  id: string; cliente_id: string | null; cliente_nome: string | null; status: string; localizacao?: Localizacao | null;
  itens: { key: string; label: string; dica: string; obs?: string; fotos?: { url: string; signed: string | null; tipo: 'image' | 'file'; nome?: string }[] }[];
  status_itens?: MapaStatus;
  assinaturas?: { tecnico?: { nome: string; registro?: string }; cliente?: { nome: string } };
  assinaturas_url?: { tecnico?: string; cliente?: string };
  resumo?: Resumo;
  extras_disponiveis?: boolean;
}

const MAX_DIM = 1568;
let CID = 0;
const novoCid = () => `f${Date.now()}_${CID++}`;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(file);
  });
}

// Imagem: redimensiona e recomprime pra JPEG leve. Devolve base64 + preview.
async function compress(file: File): Promise<{ base64: string; preview: string }> {
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Imagem inválida.'));
    im.src = dataUrl;
  });
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_DIM) {
    const s = MAX_DIM / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador sem suporte a canvas.');
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: jpeg.split(',')[1] || '', preview: jpeg };
}

function apiError(err: unknown): string {
  const er = err as { response?: { data?: { error?: string } } };
  return er?.response?.data?.error || '';
}

type Modo = 'nome' | 'cadastrado' | 'novo';

/** O que uma gravação de status carrega: a vistoria e o mapa inteiro, como estavam quando o técnico tocou. */
interface CargaStatus { id: string; mapa: MapaStatus }

// ── Tabela da tela inicial ──
const situacaoDe = (v: ItemLista): 'andamento' | 'concluida' => (v.status === 'concluida' ? 'concluida' : 'andamento');
const textoBuscaDe = (v: ItemLista): string => v.cliente_nome || TEXTOS.clienteSemNome;
const idDe = (v: ItemLista): string => v.id;
const rotuloAcaoDe = (v: ItemLista): string => (v.status === 'concluida' ? TEXTOS.abrir : TEXTOS.continuar);

/** Situação numa coluna só: em andamento mostra o progresso; concluída mostra o selo, ou "Concluída" sem selo. */
function Situacao({ v }: { v: ItemLista }) {
  if (v.status !== 'concluida') {
    return (
      <span className={e.situacao}>
        <Etiqueta tom="neutro">Em andamento</Etiqueta>
        <Progresso feitos={v.preenchidos} total={v.total} />
      </span>
    );
  }
  if (!v.selo) return <Etiqueta tom="ok">Concluída</Etiqueta>;
  return <Etiqueta tom={v.selo === 'conforme' ? 'ok' : v.selo === 'atencao' ? 'atencao' : 'erro'}>{SELOS[v.selo].titulo}</Etiqueta>;
}

const COLUNAS: ColunaTabela<ItemLista>[] = [
  {
    titulo: 'Cliente',
    render: (v) => (
      <>
        <span className={e.nome}>{v.cliente_nome || TEXTOS.clienteSemNome}</span>
        {v.tem_local && <span className={e.sub}>Localização salva</span>}
      </>
    ),
  },
  { titulo: 'Data', largura: '104px', render: (v) => <span className={e.num}>{dataCurta(v.created_at)}</span> },
  { titulo: 'Situação', largura: '270px', render: (v) => <Situacao v={v} /> },
];

const mobileDe = (v: ItemLista) => ({
  titulo: v.cliente_nome || TEXTOS.clienteSemNome,
  detalhe: `${dataCurta(v.created_at)}, ${v.preenchidos}/${v.total} itens`,
  etiquetas: <Situacao v={v} />,
});

const DIA = 86_400_000;

/** Filtro que cada indicador aplica à tabela. */
function predicadoDoIndicador(kpi: string | null): ((v: ItemLista) => boolean) | null {
  if (kpi === 'andamento') return (v) => v.status !== 'concluida';
  if (kpi === 'recentes') return (v) => v.status === 'concluida' && Date.now() - new Date(v.created_at).getTime() <= 30 * DIA;
  if (kpi === 'pendencia') return (v) => v.selo === 'atencao' || v.selo === 'nao_conforme';
  return null;
}

export default function VistoriaPage() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [modo, setModo] = useState<Modo>('cadastrado');
  const [clienteId, setClienteId] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);

  const [lista, setLista] = useState<ItemLista[]>([]);
  const [faseLista, setFaseLista] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [abrindo, setAbrindo] = useState(false);

  const [vistoria, setVistoria] = useState<Vistoria | null>(null);
  const [starting, setStarting] = useState(false);
  const [concluida, setConcluida] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [lightbox, setLightbox] = useState<{ itemKey: string; foto: Foto } | null>(null);

  // Avaliação (colunas novas): status por item técnico e assinaturas. Sem a migration, a API
  // responde extras_disponiveis=false e a tela esconde os dois, funcionando como antes.
  const [statusItens, setStatusItens] = useState<MapaStatus>({});
  const [extrasOk, setExtrasOk] = useState(true);
  const [assinaturas, setAssinaturas] = useState<AssinaturasEstado>({});
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false);

  // LOCALIZAÇÃO — o caminho principal é COLAR o que o cliente mandou no WhatsApp,
  // não o GPS: quem pediu (Gedalih, 24/08/2026) perdeu justamente a localização que
  // recebeu por mensagem, e ele não está no sítio quando ela chega.
  const [localTxt, setLocalTxt] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState('');

  // "Cadastrar Cliente": dados lidos dos documentos (conta de luz + RG/CNH) que
  // pré-preenchem o ClientModal. scanBusy = leitura em andamento.
  const [seedNovo, setSeedNovo] = useState<Record<string, string>>({});
  const [scanBusy, setScanBusy] = useState<'' | 'conta' | 'documento'>('');
  // Arquivos escaneados guardados pra arquivar no cliente após o cadastro.
  const [docsPendentes, setDocsPendentes] = useState<Partial<Record<DocTipo, DocPendente>>>({});
  const docsPendentesRef = useRef<Partial<Record<DocTipo, DocPendente>>>({});

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const scanRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const obsTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const opened = useRef(false);

  // Status: o mapa mais recente fica num ref, e a tela sempre manda o mapa INTEIRO (sem closure velha).
  const vistoriaIdRef = useRef('');
  const statusRef = useRef<MapaStatus>({});
  const statusSujo = useRef(false);           // há troca que o servidor ainda não confirmou
  const statusLogadoDe = useRef('');
  const acoesStatus = useRef<{ enviar: (c: CargaStatus) => Promise<boolean>; aoFechar: (c: CargaStatus) => void }>({ enviar: async () => true, aoFechar: () => {} });
  // Gravações em ordem: uma só no ar por vez. Cada troca leva o id da vistoria e o mapa capturados na hora do
  // toque, para uma gravação atrasada nunca mandar o mapa de uma vistoria para outra (ver gravadorStatus.ts).
  const [gravador] = useState(() => criarGravadorStatus<CargaStatus>({
    enviar: (c) => acoesStatus.current.enviar(c),
    aoDescarregar: (c) => acoesStatus.current.aoFechar(c),
  }));
  const [kpi, setKpi] = useState<string | null>(null);

  // O botão flutuante do WhatsApp cobre campos e botões no celular: some nesta tela abaixo de 720 px.
  useEsconderWhatsFab(true, true);

  const carregarGrupos = useCallback(() => {
    api.get('/vistorias/clientes').then((r) => setGrupos(r.data || [])).catch(() => {});
  }, []);

  const carregarLista = useCallback(() => {
    api.get('/vistorias/list')
      .then((r) => { setLista(Array.isArray(r.data) ? r.data : []); setFaseLista('ok'); })
      .catch(() => setFaseLista('erro'));
  }, []);

  // Abre uma vistoria existente (da tabela ou de ?id=) no editor, ou no painel final se já concluída.
  const abrir = useCallback(async (id: string) => {
    setErro(''); setAbrindo(true);
    try {
      // Antes de trocar os refs do status, termina de gravar o que ficou da vistoria anterior.
      await gravador.esperar();
      statusSujo.current = false;
      const r = await api.get(`/vistorias/${id}`);
      const d = r.data as DetalheApi;
      const itens: Item[] = (Array.isArray(d.itens) ? d.itens : []).map((it) => ({
        key: it.key, label: it.label, dica: it.dica, obs: it.obs || '',
        fotos: (Array.isArray(it.fotos) ? it.fotos : []).map((f) => ({
          cid: novoCid(), url: f.url, signed: f.signed, tipo: f.tipo, nome: f.nome,
        })),
      }));
      const url = d.assinaturas_url || {};
      const ass: AssinaturasEstado = {};
      if (d.assinaturas?.tecnico) ass.tecnico = { nome: d.assinaturas.tecnico.nome, registro: d.assinaturas.tecnico.registro, url: url.tecnico };
      if (d.assinaturas?.cliente) ass.cliente = { nome: d.assinaturas.cliente.nome, url: url.cliente };
      const mapa = d.status_itens || {};
      vistoriaIdRef.current = d.id;
      statusRef.current = mapa;
      setStatusItens(mapa);
      setExtrasOk(d.extras_disponiveis !== false);
      setAssinaturas(ass);
      setResumo(d.resumo || null);
      setVistoria({ id: d.id, cliente_id: d.cliente_id, cliente_nome: d.cliente_nome, status: d.status, localizacao: d.localizacao, itens });
      setConcluida(d.status === 'concluida');
      setConfirmandoReabrir(false);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setErro(apiError(err) || 'Não consegui abrir a vistoria. Tente de novo.');
    } finally {
      setAbrindo(false);
    }
  }, [gravador]);

  useEffect(() => {
    if (!opened.current) { opened.current = true; logUso('open'); }
    carregarGrupos();
    carregarLista();
    const id = new URLSearchParams(window.location.search).get('id');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void abrir(id);
  }, [carregarGrupos, carregarLista, abrir]);

  const fecharNova = useCallback(() => setNovaAberta(false), []);

  // ── Localização ──
  async function salvarLocal(corpo: { colado?: string; lat?: number; lng?: number }) {
    if (!vistoria) return;
    setLocalBusy(true); setLocalMsg('');
    try {
      const r = await api.put(`/vistorias/${vistoria.id}/localizacao`, corpo);
      const loc = r.data.localizacao as Localizacao | null;
      setVistoria((v) => v && ({ ...v, localizacao: loc }));
      setLocalTxt('');
      setLocalMsg(loc ? 'Localização salva.' : 'Localização removida.');
      setTimeout(() => setLocalMsg(''), 3000);
    } catch (err: unknown) {
      setErro(apiError(err) || 'Não consegui salvar a localização.');
    } finally {
      setLocalBusy(false);
    }
  }

  // Botão do GPS: só serve pra quem JÁ está no local. É o caminho secundário.
  function usarLocalAtual() {
    if (!navigator.geolocation) { setErro('Este aparelho não informa a localização.'); return; }
    setLocalBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { void salvarLocal({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setLocalBusy(false); setErro('Não consegui pegar a localização. Autorize no navegador ou cole o link do cliente.'); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  // ── Mutação de estado: mexe nas fotos de um item ──
  function setItemFotos(itemKey: string, fn: (fotos: Foto[]) => Foto[]) {
    setVistoria((v) => v && ({ ...v, itens: v.itens.map((it) => it.key === itemKey ? { ...it, fotos: fn(it.fotos) } : it) }));
  }

  async function iniciar() {
    setErro(''); setStarting(true);
    try {
      const body =
        modo === 'nome' ? { cliente_nome: clienteNome.trim() || null } :
        clienteId ? { cliente_id: clienteId } : { cliente_nome: null };
      const r = await api.post('/vistorias', body);
      logUso('start');
      setNovaAberta(false);
      await abrir((r.data as { id: string }).id);
      carregarLista();
    } catch (err) {
      setErro(apiError(err) || 'Não consegui iniciar a vistoria. Tente de novo.');
    } finally {
      setStarting(false);
    }
  }

  function guardarPendente(tipo: DocTipo, doc: DocPendente) {
    setDocsPendentes((prev) => { const n = { ...prev, [tipo]: doc }; docsPendentesRef.current = n; return n; });
  }

  // Cliente novo cadastrado no modal → arquiva os documentos lidos NELE, seleciona
  // e vira modo "cadastrado".
  async function onClienteCriado(c: Client) {
    setModalOpen(false);
    const pend = docsPendentesRef.current;
    // Arquiva conta de luz / identidade no cliente recém-criado (best-effort).
    await Promise.all((Object.keys(pend) as DocTipo[]).map((tipo) => {
      const d = pend[tipo]!;
      return api.post(`/clients/${c.id}/documento`, { tipo, base64: d.base64, media_type: d.media_type, nome: d.nome }).catch(() => {});
    }));
    setSeedNovo({}); setDocsPendentes({}); docsPendentesRef.current = {};
    setClienteId(c.id);
    setClienteNome(c.nome);
    setModo('cadastrado');
    carregarGrupos(); // recarrega a lista agrupada já com o novo cliente + docs
  }

  // Lê um documento (conta de luz ou RG/CNH) via IA, mescla os campos no seed do
  // cadastro E guarda o arquivo pra arquivar no cliente. Vazio não sobrescreve.
  async function scanDoc(kind: 'conta' | 'documento', file: File) {
    setErro(''); setScanBusy(kind);
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      let base64 = ''; let media_type = 'image/jpeg';
      if (isPdf) {
        base64 = (await readAsDataUrl(file)).split(',')[1] || '';
        media_type = 'application/pdf';
      } else {
        base64 = (await compress(file)).base64;
      }
      const url = kind === 'conta' ? '/clients/scan' : '/clients/scan-documento';
      const r = await api.post(url, { file_base64: base64, media_type });
      const cli = (r.data?.cliente || {}) as Record<string, unknown>;
      const limpos: Record<string, string> = {};
      for (const [k, v] of Object.entries(cli)) {
        if (typeof v === 'string' && v.trim()) limpos[k] = v;
      }
      setSeedNovo((prev) => ({ ...prev, ...limpos }));
      // Guarda o arquivo pra ser arquivado no cliente ao cadastrar.
      guardarPendente(kind === 'conta' ? 'conta_luz' : 'identidade', { base64, media_type, nome: file.name });
    } catch (err) {
      setErro(apiError(err) || 'Não consegui ler o documento. Tente uma foto mais nítida.');
    } finally {
      setScanBusy('');
    }
  }

  function onPickScan(kind: 'conta' | 'documento', files: FileList | null) {
    const f = files?.[0];
    if (f) scanDoc(kind, f);
  }

  // Antes de escanear: se já existe esse tipo, avisa (evita redundância) e deixa
  // decidir se adiciona/substitui.
  function tentarScan(kind: 'conta' | 'documento') {
    const tipo: DocTipo = kind === 'conta' ? 'conta_luz' : 'identidade';
    if (docsPendentes[tipo]) {
      const nome = kind === 'conta' ? 'uma conta de luz' : 'um documento';
      if (!window.confirm(`Você já adicionou ${nome}. Deseja substituir pelo novo?`)) return;
    }
    scanRefs.current[kind]?.click();
  }

  const addArquivo = useCallback(async (itemKey: string, file: File) => {
    if (!vistoria) return;
    setErro('');
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const cid = novoCid();
    let base64 = ''; let preview = ''; let media_type = 'image/jpeg';
    try {
      if (isPdf) {
        base64 = (await readAsDataUrl(file)).split(',')[1] || '';
        media_type = 'application/pdf';
      } else {
        const c = await compress(file);
        base64 = c.base64; preview = c.preview;
      }
    } catch {
      setErro('Não consegui processar esse arquivo. Tente outro.');
      return;
    }
    // Otimista: mostra na hora, marcado como subindo.
    setItemFotos(itemKey, (f) => [...f, { cid, preview, tipo: isPdf ? 'file' : 'image', nome: file.name, uploading: true }]);
    try {
      const r = await api.post(`/vistorias/${vistoria.id}/foto`, { item_key: itemKey, base64, media_type, nome: file.name });
      const foto = r.data.foto as { url: string; signed: string | null; tipo: 'image' | 'file'; nome?: string };
      setItemFotos(itemKey, (f) => f.map((x) => x.cid === cid
        ? { ...x, url: foto.url, signed: foto.signed, tipo: foto.tipo, nome: foto.nome, uploading: false }
        : x));
    } catch (err) {
      setItemFotos(itemKey, (f) => f.map((x) => x.cid === cid ? { ...x, uploading: false, error: true } : x));
      setErro(apiError(err) || 'Um arquivo não subiu. Toque no X pra remover e tente de novo.');
    }
  }, [vistoria]);

  function onPick(itemKey: string, files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => addArquivo(itemKey, f));
  }

  async function removeFoto(itemKey: string, foto: Foto) {
    setItemFotos(itemKey, (f) => f.filter((x) => x.cid !== foto.cid));
    setLightbox(null);
    if (foto.url && vistoria) {
      api.delete(`/vistorias/${vistoria.id}/foto`, { data: { item_key: itemKey, url: foto.url } }).catch(() => {});
    }
  }

  function salvarObs(itemKey: string, obs: string) {
    setVistoria((v) => v && ({ ...v, itens: v.itens.map((it) => it.key === itemKey ? { ...it, obs } : it) }));
    clearTimeout(obsTimers.current[itemKey]);
    obsTimers.current[itemKey] = setTimeout(() => {
      if (vistoria) api.patch(`/vistorias/${vistoria.id}/item`, { item_key: itemKey, obs }).catch(() => {});
    }, 700);
  }

  // ── Status dos itens técnicos: salva com debounce mandando sempre o mapa inteiro ──
  async function enviarStatus(c: CargaStatus): Promise<boolean> {
    if (!c.id) return true;
    try {
      await api.put(`/vistorias/${c.id}/status`, { status_itens: c.mapa });
      if (vistoriaIdRef.current === c.id && statusRef.current === c.mapa) statusSujo.current = false;
      return true;
    } catch (err) {
      // Só o 503 da migration esconde status e assinatura. Qualquer outro erro mostra a mensagem e deixa tentar de novo.
      if (ehMigracaoPendente(err)) {
        if (vistoriaIdRef.current === c.id) { setExtrasOk(false); statusSujo.current = false; }
        return true;
      }
      setErro(apiError(err) || 'Não consegui salvar o status. Tente de novo.');
      return false;
    }
  }

  // Aba fechando com troca ainda no debounce: manda na hora, com keepalive, para a requisição sobreviver.
  // Fica FORA da cadeia (a aba não vai esperar). Janela aceita: um PUT da cadeia ainda no ar pode chegar
  // depois, mas ele carrega um mapa mais antigo; o keepalive leva o mais novo.
  function enviarAoFechar(c: CargaStatus) {
    if (!c.id) return;
    const base = String(api.defaults.baseURL || '');
    const token = getToken();
    fetch(`${base}/vistorias/${c.id}/status`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ status_itens: c.mapa }),
    }).catch(() => {});
  }

  useEffect(() => {
    acoesStatus.current = { enviar: enviarStatus, aoFechar: enviarAoFechar };
  });

  useEffect(() => {
    const sair = () => { if (gravador.pendente()) gravador.descarregar(); };
    const oculta = () => { if (document.visibilityState === 'hidden') sair(); };
    window.addEventListener('pagehide', sair);
    document.addEventListener('visibilitychange', oculta);
    return () => { window.removeEventListener('pagehide', sair); document.removeEventListener('visibilitychange', oculta); };
  }, [gravador]);

  function mudarStatus(itemKey: string, valor: StatusKey) {
    const novo = { ...statusRef.current };
    if (novo[itemKey] === valor) delete novo[itemKey]; else novo[itemKey] = valor;
    statusRef.current = novo;
    statusSujo.current = true;
    setStatusItens(novo);
    if (statusLogadoDe.current !== vistoriaIdRef.current) { statusLogadoDe.current = vistoriaIdRef.current; logUso('status'); }
    gravador.agendar({ id: vistoriaIdRef.current, mapa: novo });
  }

  // Antes de concluir: cancela o debounce (esperar dispara a troca pendente DENTRO da cadeia), espera a cadeia
  // toda e, se ainda sobrou troca não confirmada (a última falhou), enfileira o mapa atual NA cadeia.
  // Repete enquanto houver pendência, e só então o Concluir chama /concluir.
  async function esperarStatus(): Promise<boolean> {
    for (let volta = 0; volta < 5; volta++) {
      let ok = await gravador.esperar();
      if (statusSujo.current) ok = await gravador.enfileirar({ id: vistoriaIdRef.current, mapa: statusRef.current });
      if (!ok) return false;
      if (!gravador.pendente() && !statusSujo.current) return true;
    }
    return !statusSujo.current;
  }

  async function concluir() {
    setErro('');
    if (!(await esperarStatus())) return;
    try {
      const r = await api.post(`/vistorias/${vistoria!.id}/concluir`);
      setResumo((r.data?.resumo as Resumo) || null);
      setConcluida(true);
      logUso('complete');
    } catch (err) {
      setErro(apiError(err) || 'Não consegui concluir. Tente de novo.');
    }
  }

  async function reabrir() {
    if (!vistoria) return;
    setErro('');
    try {
      await api.post(`/vistorias/${vistoria.id}/reabrir`);
      logUso('reabrir');
      await abrir(vistoria.id);
    } catch (err) {
      setErro(apiError(err) || 'Não consegui reabrir a vistoria. Tente de novo.');
    }
  }

  function reset() {
    // Troca ainda no debounce não se perde: dispara agora. Os refs do status ficam como estão (a gravação lê
    // o id e o mapa quando roda) e são trocados quando a próxima vistoria abrir.
    void gravador.esperar();
    setKpi(null);
    setVistoria(null); setConcluida(false); setErro('');
    setStatusItens({}); setAssinaturas({}); setResumo(null); setExtrasOk(true); setConfirmandoReabrir(false);
    setModo('cadastrado'); setClienteId(''); setClienteNome(''); setSeedNovo({});
    setDocsPendentes({}); docsPendentesRef.current = {};
    carregarLista();
    window.scrollTo({ top: 0 });
  }

  const total = vistoria?.itens.length ?? 0;
  const feitos = vistoria?.itens.filter((i) => i.fotos.length > 0).length ?? 0;
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  const reportUrl = vistoria && typeof window !== 'undefined' ? `${window.location.origin}/v/${vistoria.id}` : '';

  function copiar() {
    if (!reportUrl) return;
    logUso('link');
    navigator.clipboard?.writeText(reportUrl).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }).catch(() => {});
  }
  const waMsg = encodeURIComponent(`Relatório da vistoria${vistoria?.cliente_nome ? ' de ' + vistoria.cliente_nome : ''}, com as fotos:\n${reportUrl}`);

  function baixarPdf() {
    logUso('pdf');
    setGerandoPdf(true);
    setTimeout(() => setGerandoPdf(false), 8000);
  }

  // ── Dados da tela inicial ──
  const ordenada = useMemo(
    () => [...lista].sort((a, b) =>
      (a.status === 'concluida' ? 1 : 0) - (b.status === 'concluida' ? 1 : 0) || b.created_at.localeCompare(a.created_at)),
    [lista],
  );
  const indicadores = useMemo((): Indicador[] => {
    const agora = Date.now();
    const andamento = lista.filter((v) => v.status !== 'concluida').length;
    const recentes = lista.filter((v) => v.status === 'concluida' && agora - new Date(v.created_at).getTime() <= 30 * DIA).length;
    const temAvaliacao = lista.some((v) => !!v.selo);
    const comPendencia = lista.filter((v) => v.selo === 'atencao' || v.selo === 'nao_conforme').length;
    return [
      { id: 'andamento', rotulo: 'Em andamento', valor: andamento },
      { id: 'recentes', rotulo: 'Concluídas em 30 dias', valor: recentes },
      ...(temAvaliacao ? [{ id: 'pendencia', rotulo: 'Com pendência', valor: comPendencia, alerta: comPendencia > 0 }] : []),
      { id: 'total', rotulo: 'Total', valor: lista.length },
    ];
  }, [lista]);

  const predicadoKpi = predicadoDoIndicador(kpi);
  const rotuloKpi = kpi && kpi !== 'total' ? indicadores.find((i) => i.id === kpi)?.rotulo : undefined;

  // Até 5 clientes usados nas últimas vistorias (a lista já vem do mais recente para o mais antigo).
  const recentes = useMemo(() => {
    const validos = new Set(grupos.flatMap((g) => g.clientes.map((c) => c.id)));
    const vistos = new Set<string>();
    const out: { id: string; nome: string }[] = [];
    for (const v of lista) {
      if (!v.cliente_id || !v.cliente_nome || vistos.has(v.cliente_id) || !validos.has(v.cliente_id)) continue;
      vistos.add(v.cliente_id);
      out.push({ id: v.cliente_id, nome: v.cliente_nome });
      if (out.length === 5) break;
    }
    return out;
  }, [lista, grupos]);

  // ── Tela inicial ──
  if (!vistoria) {
    return (
      <Pagina>
        {modalOpen && <ClientModal client={null} seed={seedNovo as ComponentProps<typeof ClientModal>['seed']} onClose={() => setModalOpen(false)} onSave={onClienteCriado} />}

        <Cabecalho
          titulo="Vistorias"
          apoio="Visitas técnicas antes da instalação, com fotos, avaliação e relatório para o cliente."
          botao={{ texto: 'Nova vistoria', icone: Plus, onClick: () => { setErro(''); setNovaAberta(true); }, desativado: abrindo }}
        />

        {faseLista === 'ok' && lista.length > 0 && <Indicadores itens={indicadores} ativo={kpi} onEscolher={setKpi} />}

        {erro && !novaAberta && <p className="vst-err" role="alert" style={{ marginBottom: 12 }}>{erro}</p>}

        <PainelTabela
          itens={ordenada}
          getId={idDe}
          colunas={COLUNAS}
          textoBusca={textoBuscaDe}
          situacao={situacaoDe}
          onAbrir={(v) => { if (!abrindo) void abrir(v.id); }}
          rotuloAcao={rotuloAcaoDe}
          mobile={mobileDe}
          carregando={faseLista === 'carregando'}
          placeholderBusca="Buscar por cliente"
          predicado={predicadoKpi}
          rotuloPredicado={rotuloKpi}
          onLimparPredicado={() => setKpi(null)}
          erro={faseLista === 'erro' ? <EstadoErroLista texto="Não consegui carregar as vistorias." onTentar={() => { setFaseLista('carregando'); carregarLista(); }} /> : undefined}
          vazio={(
            <EstadoVazio
              icone={ClipboardCheck}
              frase="Quando você concluir a primeira vistoria, ela aparece aqui."
              botao={{ texto: 'Nova vistoria', icone: Plus, onClick: () => setNovaAberta(true) }}
              passos={[
                { titulo: 'Escolha o cliente', texto: 'Use um cliente cadastrado, cadastre um novo ou digite só o nome.' },
                { titulo: 'Fotografe os 12 itens', texto: 'Cada item abre a câmera ou anexa um arquivo. Tudo sobe na hora.' },
                { titulo: 'Envie o link ou o PDF', texto: 'Ao concluir, o relatório fica pronto para o cliente.' },
              ]}
            />
          )}
        />

        <Gaveta aberta={novaAberta && !modalOpen} titulo="Nova vistoria" onFechar={fecharNova}>
          <label className="vst-label">Cliente</label>
          <Abas>
            <Aba on={modo === 'novo'} onClick={() => setModo('novo')} icone={UserPlus}>Cadastrar</Aba>
            <Aba on={modo === 'cadastrado'} onClick={() => setModo('cadastrado')} icone={Users}>Já é cliente</Aba>
            <Aba on={modo === 'nome'} onClick={() => setModo('nome')} icone={Type}>Só o nome</Aba>
          </Abas>

          {modo === 'cadastrado' && (
            grupos.some((g) => g.clientes.length > 0) ? (
              <>
                {recentes.length > 0 && (
                  <div className="vst-recentes">
                    <p className="vst-recentesTit">Clientes recentes</p>
                    <div className="vst-recentesLista">
                      {recentes.map((c) => (
                        <button key={c.id} type="button" aria-pressed={clienteId === c.id} className={`vst-recente ${clienteId === c.id ? 'on' : ''}`}
                          onClick={() => { setClienteId(c.id); setClienteNome(c.nome); }}>
                          {clienteId === c.id && <Check size={14} strokeWidth={3} aria-hidden="true" />} {c.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <select className="vst-select" aria-label="Escolha um cliente" value={clienteId} onChange={(ev) => setClienteId(ev.target.value)} style={{ marginBottom: clienteId ? 8 : 14 }}>
                  <option value="">Escolha um cliente</option>
                  {grupos.filter((g) => g.clientes.length > 0).map((g) => (
                    <optgroup key={g.empresa} label={g.empresa}>
                      {g.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </optgroup>
                  ))}
                </select>
                {(() => {
                  const sel = clienteId ? grupos.flatMap((g) => g.clientes).find((c) => c.id === clienteId) : null;
                  const docs = sel?.docs || [];
                  if (!clienteId) return null;
                  return (
                    <div className="vst-docBadges">
                      <span className={`vst-docBadge ${docs.includes('conta_luz') ? 'on' : ''}`}>{docs.includes('conta_luz') && <Check size={13} strokeWidth={3} />} Conta de luz</span>
                      <span className={`vst-docBadge ${docs.includes('identidade') ? 'on' : ''}`}>{docs.includes('identidade') && <Check size={13} strokeWidth={3} />} Documento</span>
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="vst-heroSub" style={{ marginBottom: 14 }}>Nenhum cliente cadastrado ainda. Use “Cadastrar” ou “Só o nome”.</p>
            )
          )}
          {modo === 'nome' && (
            <input className="vst-input" placeholder="Nome do cliente ou do imóvel (opcional)" aria-label="Nome do cliente ou do imóvel"
              value={clienteNome} onChange={(ev) => setClienteNome(ev.target.value)} style={{ marginBottom: 14 }} />
          )}
          {modo === 'novo' && (
            <div style={{ marginBottom: 14 }}>
              {/* inputs escondidos: aceitam foto (câmera/galeria) OU PDF, do celular ou PC */}
              <input ref={(el) => { scanRefs.current.conta = el; }} type="file" accept="image/*,application/pdf"
                style={{ display: 'none' }} onChange={(ev) => { onPickScan('conta', ev.target.files); ev.target.value = ''; }} />
              <input ref={(el) => { scanRefs.current.documento = el; }} type="file" accept="image/*,application/pdf"
                style={{ display: 'none' }} onChange={(ev) => { onPickScan('documento', ev.target.files); ev.target.value = ''; }} />

              {clienteId ? (
                <p className="vst-heroSub">Cliente cadastrado: <strong>{clienteNome}</strong></p>
              ) : (
                <>
                  <p className="vst-heroSub" style={{ marginBottom: 10 }}>
                    Envie os documentos que a IA preenche o cadastro sozinha (opcional):
                  </p>
                  <div className="vst-addBtns">
                    <button className="vst-addBtn" disabled={!!scanBusy} onClick={() => tentarScan('conta')}>
                      {scanBusy === 'conta' ? <span className="vst-spin" /> : docsPendentes.conta_luz ? <Check size={16} color="#16a34a" /> : <FileText size={16} />} Conta de luz
                    </button>
                    <button className="vst-addBtn" disabled={!!scanBusy} onClick={() => tentarScan('documento')}>
                      {scanBusy === 'documento' ? <span className="vst-spin" /> : docsPendentes.identidade ? <Check size={16} color="#16a34a" /> : <Paperclip size={16} />} Identidade / CNH
                    </button>
                  </div>

                  {(seedNovo.nome || seedNovo.cpf_cnpj || seedNovo.endereco || docsPendentes.conta_luz || docsPendentes.identidade) && (
                    <div className="vst-scanInfo">
                      <strong>Dados lidos:</strong>
                      {seedNovo.nome ? <span>Nome: {seedNovo.nome}</span> : null}
                      {seedNovo.cpf_cnpj ? <span>Documento: {seedNovo.cpf_cnpj}</span> : null}
                      {seedNovo.endereco ? <span>Endereço: {seedNovo.endereco}</span> : null}
                      {(docsPendentes.conta_luz || docsPendentes.identidade) && (
                        <span style={{ color: 'var(--ink-green)' }}>
                          Será arquivado no cliente: {[docsPendentes.conta_luz && 'conta de luz', docsPendentes.identidade && 'documento'].filter(Boolean).join(' + ')}
                        </span>
                      )}
                    </div>
                  )}

                  <button className="vst-ghostBtn" style={{ marginTop: 12 }} onClick={() => setModalOpen(true)}>
                    <Plus size={15} /> {Object.keys(seedNovo).length ? 'Revisar e cadastrar' : 'Cadastrar manualmente'}
                  </button>
                </>
              )}
            </div>
          )}

          <button className={e.btnPrim} style={{ width: '100%', minHeight: 44 }} onClick={iniciar}
            disabled={starting || (modo === 'cadastrado' && !clienteId) || (modo === 'novo' && !clienteId)}>
            {starting ? 'Iniciando...' : <><Plus size={18} strokeWidth={2.4} /> Iniciar vistoria</>}
          </button>
          {erro && <p className="vst-err" role="alert">{erro}</p>}
        </Gaveta>
      </Pagina>
    );
  }

  // ── Painel final (vistoria concluída) ──
  if (concluida) {
    const selo = resumo?.selo ?? null;
    return (
      <div className="vst-page">
        <div className="vst-card" style={{ textAlign: 'center' }}>
          <CheckCircle2 size={40} strokeWidth={2} style={{ color: 'var(--ink-green)' }} aria-hidden="true" />
          <h1 className="vst-heroTitle" style={{ marginTop: 8 }}>Vistoria concluída</h1>
          <p className="vst-heroSub">{feitos} de {total} itens registrados.</p>
          {vistoria.cliente_nome && <p className="vst-heroSub">Cliente: {vistoria.cliente_nome}</p>}

          {selo && (
            <div className={`vst-selo vst-selo-${selo}`}>
              <strong>{SELOS[selo].titulo}</strong>
              <span>{SELOS[selo].frase}</span>
            </div>
          )}

          <div className="vst-linkBox">
            <input className="vst-input" readOnly value={reportUrl} aria-label="Link do relatório" onFocus={(ev) => ev.target.select()} />
            <button className="vst-copyBtn" onClick={copiar} aria-label="Copiar link"><Copy size={15} /></button>
          </div>
          {copiado && <p className="vst-toast">Link copiado!</p>}
          <a className="vst-wa" href={`https://wa.me/?text=${waMsg}`} target="_blank" rel="noopener noreferrer" onClick={() => logUso('whatsapp')}><Share2 size={18} /> Enviar no WhatsApp</a>
          <a className="vst-primaryBtn" href={`${reportUrl}/pdf`} target="_blank" rel="noopener noreferrer" onClick={baixarPdf} style={{ marginTop: 10, textDecoration: 'none' }}><FileDown size={18} strokeWidth={2.4} /> {TEXTOS.baixarPdf}</a>
          {gerandoPdf && <p className="vst-toast" role="status">{TEXTOS.gerandoPdf}</p>}
          <a className="vst-ghostBtn" href={`${reportUrl}/fotos.zip`} onClick={() => logUso('zip')} style={{ marginTop: 10 }}><Download size={16} /> Baixar todas as fotos</a>
          <a className="vst-ghostBtn" href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>Abrir relatório</a>

          {confirmandoReabrir ? (
            <div className="vst-confirma" role="alertdialog" aria-label={TEXTOS.reabrir}>
              <p>{TEXTOS.confirmarReabrir}</p>
              <div className="vst-confirmaBtns">
                <button className="vst-ghostBtn" onClick={() => setConfirmandoReabrir(false)}>{TEXTOS.cancelar}</button>
                <button className="vst-primaryBtn" onClick={reabrir}>{TEXTOS.confirmar}</button>
              </div>
            </div>
          ) : (
            <button className="vst-ghostBtn" onClick={() => setConfirmandoReabrir(true)} style={{ marginTop: 10 }}><RotateCcw size={15} /> {TEXTOS.reabrir}</button>
          )}
          <button className="vst-ghostBtn" onClick={reset} style={{ marginTop: 10 }}><RefreshCw size={15} /> Voltar para a lista</button>
          {erro && <p className="vst-err" role="alert">{erro}</p>}
        </div>
      </div>
    );
  }

  // ── Tela do checklist ──
  return (
    <div className="vst-page">
      {lightbox && (
        <div className="vst-lightbox" onClick={() => setLightbox(null)}>
          {lightbox.foto.tipo === 'image'
            ? <img src={lightbox.foto.signed || lightbox.foto.preview} alt="Conferência" onClick={(ev) => ev.stopPropagation()} />
            : <div className="vst-card" onClick={(ev) => ev.stopPropagation()}><FileText size={48} /><p>{lightbox.foto.nome || 'Arquivo'}</p></div>}
          <div className="vst-lbActions" onClick={(ev) => ev.stopPropagation()}>
            <button className="vst-lbBtn vst-lbDel" onClick={() => removeFoto(lightbox.itemKey, lightbox.foto)}><Trash2 size={15} /> Não ficou boa</button>
            <button className="vst-lbBtn vst-lbClose" onClick={() => setLightbox(null)}>Fechar</button>
          </div>
        </div>
      )}

      <header className="vst-hero" style={{ paddingBottom: 4 }}>
        <div className="vst-heroBadge"><ClipboardCheck size={16} strokeWidth={2.2} /> Vistoria Solar</div>
        <h1 className="vst-heroTitle" style={{ fontSize: 20 }}>{vistoria.cliente_nome || TEXTOS.clienteSemNome}</h1>
      </header>

      <div className="vst-progressWrap">
        <div className="vst-progressHead">
          <strong>{feitos}/{total} itens</strong>
          <span>Câmera ou arquivo · várias por item</span>
        </div>
        <div className="vst-progressBar"><div className="vst-progressFill" style={{ width: `${pct}%` }} /></div>
      </div>

      {/* LOCALIZAÇÃO DO LOCAL — fica ANTES dos itens de propósito: é a primeira coisa
          que se perde e a última que alguém lembra de anotar. O campo de colar vem
          primeiro que o botão de GPS porque o caso real é a mensagem do cliente. */}
      <div className="vst-item2" style={{ marginBottom: 12 }}>
        <div className="vst-itemTitle">
          <span className={`vst-itemNum ${vistoria.localizacao ? 'done' : ''}`}>
            {vistoria.localizacao ? <Check size={13} strokeWidth={3} /> : <MapPin size={13} strokeWidth={2.6} />}
          </span>
          <div>
            <strong>Localização do local</strong>
            <p className="vst-itemDica">Cole o ponto que o cliente mandou no WhatsApp: link do mapa ou as coordenadas.</p>
          </div>
        </div>

        {vistoria.localizacao ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <a
              className="vst-ghostBtn"
              style={{ marginTop: 0 }}
              href={vistoria.localizacao.lat != null && vistoria.localizacao.lng != null
                ? `https://maps.google.com/?q=${vistoria.localizacao.lat},${vistoria.localizacao.lng}`
                : (vistoria.localizacao.link || '#')}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin size={15} />{' '}
              {vistoria.localizacao.lat != null && vistoria.localizacao.lng != null
                ? `${vistoria.localizacao.lat.toFixed(5)}, ${vistoria.localizacao.lng.toFixed(5)}`
                : (vistoria.localizacao.texto || 'Abrir no mapa')}
            </a>
            <button className="vst-ghostBtn" style={{ marginTop: 0 }} disabled={localBusy} onClick={() => void salvarLocal({ colado: '' })}>
              <Trash2 size={15} /> Trocar
            </button>
          </div>
        ) : (
          <>
            <div className="vst-linkBox" style={{ marginTop: 10 }}>
              <input
                className="vst-input"
                value={localTxt}
                onChange={(ev) => setLocalTxt(ev.target.value)}
                placeholder="Cole aqui: link do mapa ou -22.12345, -45.67890"
                aria-label="Localização do local"
              />
              <button
                className="vst-copyBtn"
                disabled={localBusy || !localTxt.trim()}
                onClick={() => void salvarLocal({ colado: localTxt })}
                title="Salvar localização"
                aria-label="Salvar localização"
              >
                <Check size={15} />
              </button>
            </div>
            <button className="vst-ghostBtn" style={{ marginTop: 10 }} disabled={localBusy} onClick={usarLocalAtual}>
              <LocateFixed size={15} /> Estou no local agora
            </button>
          </>
        )}
        {localMsg && <p className="vst-toast" style={{ marginTop: 8 }}>{localMsg}</p>}
      </div>

      {!extrasOk && <p className="vst-liberando" role="status">{TEXTOS.statusLiberando}</p>}

      <div className="vst-items" key={vistoria.id}>
        {vistoria.itens.map((item, idx) => {
          const done = item.fotos.some((f) => f.url);
          return (
            <div key={item.key} className={`vst-item2 ${done ? 'vst-done' : ''}`}>
              {/* inputs escondidos: câmera (mobile) e arquivo (PC/galeria + PDF) */}
              <input ref={(el) => { inputRefs.current[`${item.key}-cam`] = el; }} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={(ev) => { onPick(item.key, ev.target.files); ev.target.value = ''; }} />
              <input ref={(el) => { inputRefs.current[`${item.key}-file`] = el; }} type="file" accept="image/*,application/pdf" multiple
                style={{ display: 'none' }} onChange={(ev) => { onPick(item.key, ev.target.files); ev.target.value = ''; }} />

              <div className="vst-itemTitle">
                <span className={`vst-itemNum ${done ? 'done' : ''}`}>{done ? <Check size={13} strokeWidth={3} /> : idx + 1}</span>
                {item.label}
              </div>
              <p className="vst-itemDica">{item.dica}</p>

              {item.fotos.length > 0 && (
                <div className="vst-gallery">
                  {item.fotos.map((foto) => (
                    <div key={foto.cid} className="vst-photo"
                      onClick={() => { if (!foto.uploading && !foto.error) setLightbox({ itemKey: item.key, foto }); }}>
                      {foto.tipo === 'image'
                        ? <img src={foto.signed || foto.preview} alt={item.label} />
                        : <div className="vst-fileChip"><FileText size={22} />{foto.nome?.slice(0, 18) || 'arquivo'}</div>}
                      {foto.uploading && <div className="vst-photoUp"><span className="vst-spin" /></div>}
                      {foto.error && <div className="vst-photoErr">falhou</div>}
                      {!foto.uploading && (
                        <button className="vst-photoDel" aria-label="Remover" onClick={(ev) => { ev.stopPropagation(); removeFoto(item.key, foto); }}><X size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="vst-addBtns">
                <button className="vst-addBtn" onClick={() => inputRefs.current[`${item.key}-cam`]?.click()}><Camera size={16} /> Câmera</button>
                <button className="vst-addBtn" onClick={() => inputRefs.current[`${item.key}-file`]?.click()}><Paperclip size={16} /> Arquivo</button>
              </div>

              {extrasOk && ITENS_COM_STATUS.includes(item.key) && (
                <StatusItem itemKey={item.key} valor={statusItens[item.key]} onMudar={mudarStatus} />
              )}

              <textarea className="vst-obs" placeholder="Observação (opcional)" aria-label={`Observação: ${item.label}`} defaultValue={item.obs}
                onChange={(ev) => salvarObs(item.key, ev.target.value)} style={{ marginTop: 10 }} />
            </div>
          );
        })}
      </div>

      {extrasOk && (
        <div className="vst-bloco">
          <Assinaturas
            vistoriaId={vistoria.id}
            valor={assinaturas}
            onMudou={setAssinaturas}
            onSalvou={() => logUso('assinatura')}
            onIndisponivel={() => setExtrasOk(false)}
            nomeSugerido={vistoria.cliente_nome || ''}
          />
        </div>
      )}

      {erro && <p className="vst-err" role="alert">{erro}</p>}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560, marginInline: 'auto' }}>
        <button className="vst-primaryBtn" onClick={concluir}><Check size={18} strokeWidth={2.4} /> Concluir e gerar link</button>
        <button className="vst-ghostBtn" onClick={reset}>Sair sem concluir</button>
      </div>
    </div>
  );
}
