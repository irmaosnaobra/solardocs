'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, MoreVertical, Plus, Search } from 'lucide-react';
import api from '@/services/api';
import { prewarmPdf, shareOrDownloadPdf } from '@/services/downloadPdf';
import { fmtDateBR } from '@/utils/brasilia';
import { chaveCliente, linkPastaCliente } from '@/utils/chaveCliente';
import { logDocumentos } from '../documentos/forms/useEdicaoDocumento';
import { useEsconderWhatsFab } from '@/components/AreaTrabalho/AreaTrabalho';
import styles from './historico.module.css';

interface Doc {
  id: string;
  tipo: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  codigo_curto: string | null;
  created_at: string;
  signed_url: string | null;
  pdf_disponivel: boolean;
  link_publico: string | null;
}

interface Pasta {
  chave: string;
  cliente_id: string | null;
  nome: string;
  total: number;
  tipos: Record<string, number>;
  ultimo: string | null;
}

interface Resumo {
  indicadores: {
    documentos_mes: number;
    propostas_mes: number;
    contratos_procuracoes_mes: number;
    clientes_com_documento: number;
    total: number;
  };
  pastas: Pasta[];
}

interface ItemCampo {
  id: string;
  codigo?: string | null;
  codigo_curto?: string | null;
  status?: string | null;
  selo?: string | null;
  data_inspecao?: string | null;
  created_at?: string;
}

interface PorCliente {
  vistorias: ItemCampo[];
  manutencoes: ItemCampo[];
}

const TIPO_LABEL: Record<string, string> = {
  contratoSolar:    'Contrato Solar',
  proposta:         'Proposta',
  procuracao:       'Procuração',
  recibo:           'Recibo',
  prestacaoServico: 'Prestação de Serviço',
  contratoPJ:       'Contrato Vendedor',
  propostaBanco:    'Proposta Bancária',
  vistoria:         'Vistoria CheckList',
  propostaSolar:    'Proposta Solar',
  propostaOffGrid:  'Proposta Off-Grid',
};

// "contratos_proc" só é escolhido pelo indicador "Contratos e procurações no mês"; não aparece na lista.
const GRUPOS = [
  { id: 'todos',       label: 'Todos',       tipos: '' },
  { id: 'propostas',   label: 'Propostas',   tipos: 'propostaSolar,propostaOffGrid,proposta' },
  { id: 'contratos',   label: 'Contratos',   tipos: 'contratoSolar,contratoPJ,prestacaoServico' },
  { id: 'procuracoes', label: 'Procurações', tipos: 'procuracao' },
  { id: 'recibos',     label: 'Recibos',     tipos: 'recibo' },
  { id: 'outros',      label: 'Outros',      tipos: 'propostaBanco,vistoria' },
  { id: 'contratos_proc', label: 'Contratos e procurações', tipos: 'contratoSolar,contratoPJ,prestacaoServico,procuracao' },
];

const PERIODOS = [
  { id: '30',   label: '30 dias', dias: 30 },
  { id: '90',   label: '90 dias', dias: 90 },
  { id: 'tudo', label: 'Tudo',    dias: 0 },
];

// Qual formulário reabre cada tipo. Proposta off-grid e vistoria não entram: a primeira
// nasce de uma calculadora (os campos guardados são o resultado dela, não o formulário)
// e a vistoria tem tela própria.
const EDITAR_TELA: Record<string, string> = {
  propostaSolar:    'proposta',
  contratoSolar:    'contrato-solar',
  contratoPJ:       'contrato-pj',
  procuracao:       'procuracao',
  recibo:           'recibo',
  propostaBanco:    'proposta-bancaria',
  prestacaoServico: 'prestacao-servico',
};

const POR_PAGINA = 50;

const rotuloTipo = (t: string) => TIPO_LABEL[t] ?? t;

function ehIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iP(hone|od|ad)/.test(navigator.userAgent || '')) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function dataDesde(dias: number): string {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

function editarHref(doc: Doc): string | null {
  const tela = EDITAR_TELA[doc.tipo];
  return tela ? `/documentos?tipo=${tela}&doc=${doc.id}` : null;
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={<div className={styles.page}><p className={styles.estado}>Carregando...</p></div>}>
      <HistoricoConteudo />
    </Suspense>
  );
}

function HistoricoConteudo() {
  // No celular o botão flutuante do WhatsApp cobre as ações da linha: some nesta tela (como na Vistoria).
  useEsconderWhatsFab(true, true);
  const router = useRouter();
  const sp = useSearchParams();
  const pastaId = sp.get('cliente_id');
  const pastaChave = sp.get('cliente_chave');
  const pastaNome = sp.get('nome');
  const emPasta = !!(pastaId || pastaChave);

  const [vista, setVista] = useState<'lista' | 'cliente'>('lista');
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [grupo, setGrupo] = useState('todos');
  const [periodo, setPeriodo] = useState('tudo');

  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState('');

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [porCliente, setPorCliente] = useState<PorCliente | null>(null);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  const pedido = useRef(0);
  const primeiroFiltro = useRef(true);

  // Busca com atraso: cada letra digitada não vira uma chamada.
  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { logDocumentos('lista_aberta'); }, []);

  useEffect(() => {
    api.get('/documents/resumo').then(({ data }) => setResumo(data)).catch(() => { /* sem os números a lista segue */ });
  }, []);

  // Pasta aberta: documentos, vistorias e manutenções do cliente.
  useEffect(() => {
    setPorCliente(null);
    if (!emPasta) return;
    logDocumentos('pasta_cliente');
    const params: Record<string, string> = {};
    if (pastaId) params.cliente_id = pastaId;
    if (pastaChave) params.cliente_chave = pastaChave;
    api.get('/documents/por-cliente', { params })
      .then(({ data }) => setPorCliente({ vistorias: data.vistorias ?? [], manutencoes: data.manutencoes ?? [] }))
      .catch(() => setPorCliente({ vistorias: [], manutencoes: [] }));
  }, [emPasta, pastaId, pastaChave]);

  // Dentro da pasta não há filtros: os que sobraram da lista não podem continuar valendo calados.
  useEffect(() => {
    if (!emPasta) return;
    setVista('lista'); setGrupo('todos'); setPeriodo('tudo'); setQ(''); setQAplicada('');
  }, [emPasta]);

  const buscar = useCallback(async (pg: number, acrescentar: boolean) => {
    const meu = ++pedido.current;
    if (acrescentar) setCarregandoMais(true); else setCarregando(true);
    setErro('');
    try {
      const params: Record<string, string | number> = { page: pg, limit: POR_PAGINA };
      const tipos = GRUPOS.find((g) => g.id === grupo)?.tipos;
      if (tipos) params.tipo = tipos;
      if (qAplicada) params.q = qAplicada;
      const dias = PERIODOS.find((p) => p.id === periodo)?.dias ?? 0;
      if (dias) params.de = dataDesde(dias);
      if (pastaId) params.cliente_id = pastaId;
      if (pastaChave) params.cliente_chave = pastaChave;
      const { data } = await api.get('/documents/list', { params });
      if (meu !== pedido.current) return; // chegou uma resposta mais nova
      setDocs((antes) => (acrescentar ? [...antes, ...(data.documents ?? [])] : (data.documents ?? [])));
      setTotal(data.total ?? 0);
      setPagina(pg);
    } catch {
      if (meu === pedido.current) setErro('Não consegui carregar os documentos. Tente de novo.');
    } finally {
      if (meu === pedido.current) { setCarregando(false); setCarregandoMais(false); }
    }
  }, [grupo, qAplicada, periodo, pastaId, pastaChave]);

  useEffect(() => { buscar(1, false); }, [buscar]);

  useEffect(() => {
    if (primeiroFiltro.current) { primeiroFiltro.current = false; return; }
    logDocumentos('filtro', { tipo: grupo, periodo, busca: !!qAplicada });
  }, [grupo, periodo, qAplicada]);

  // Fecha o menu de três pontos ao clicar fora.
  useEffect(() => {
    if (!menuAberto) return;
    const fecha = () => setMenuAberto(null);
    document.addEventListener('click', fecha);
    return () => document.removeEventListener('click', fecha);
  }, [menuAberto]);

  function mostraAviso(texto: string) {
    setAviso(texto);
    setTimeout(() => setAviso(''), 4000);
  }

  async function baixar(doc: Doc) {
    // Abre a folha de compartilhamento nativa do iOS (ou baixa no desktop/Android).
    // Não prende o PWA. Ver downloadPdf.ts.
    setOcupado(doc.id);
    try {
      const r = await shareOrDownloadPdf(doc.id);
      if (r === 'no-token') mostraAviso('Sua sessão expirou. Entre de novo.');
      else if (r === 'error') mostraAviso('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      setOcupado(null);
    }
  }

  async function abrir(doc: Doc) {
    // No iOS instalado, abrir outra aba prende o app: lá o caminho é a folha de compartilhar.
    if (ehIOS()) { await baixar(doc); return; }
    const aba = window.open('', '_blank');
    if (!aba) { await baixar(doc); return; }
    setOcupado(doc.id);
    try {
      const asset = await prewarmPdf(doc.id);
      aba.location.href = URL.createObjectURL(new Blob([asset.blob], { type: 'application/pdf' }));
    } catch {
      aba.close();
      mostraAviso('Não foi possível abrir o PDF. Tente de novo.');
    } finally {
      setOcupado(null);
    }
  }

  async function copiarLink(doc: Doc) {
    if (!doc.link_publico) return;
    const url = `${window.location.origin}${doc.link_publico}`;
    try {
      await navigator.clipboard.writeText(url);
      mostraAviso('Link copiado.');
    } catch {
      mostraAviso(`Copie o link: ${url}`);
    }
    logDocumentos('link_copiado', { tipo: doc.tipo });
  }

  function abrirPasta(p: { cliente_id: string | null; nome: string }) {
    router.push(linkPastaCliente(p.cliente_id, p.nome));
  }

  const pastasFiltradas = useMemo(() => {
    const todas = resumo?.pastas ?? [];
    const k = chaveCliente(qAplicada);
    return k ? todas.filter((p) => chaveCliente(p.nome).includes(k)) : todas;
  }, [resumo, qAplicada]);

  // Os números do topo são filtros: "Propostas no mês" abre a lista só de propostas dos últimos 30 dias.
  function filtrarPor(g: string, p: string, v: 'lista' | 'cliente' = 'lista') {
    setGrupo(g);
    setPeriodo(p);
    setQ('');
    setQAplicada('');
    setVista(v);
  }

  const ind = resumo?.indicadores;
  const nenhumDocumento = !!ind && ind.total === 0;
  const vazioGeral = !carregando && !erro && total === 0 && !qAplicada && grupo === 'todos' && periodo === 'tudo' && !emPasta;
  const nomePasta = pastaNome || 'Pasta do cliente';
  const contagemPasta = [
    contar(total, 'documento', 'documentos'),
    porCliente ? contar(porCliente.vistorias.length, 'vistoria', 'vistorias') : null,
    porCliente ? contar(porCliente.manutencoes.length, 'manutenção', 'manutenções') : null,
  ].filter(Boolean).join(' · ');
  const novoParaCliente = `/documentos?tipo=proposta&cliente=${encodeURIComponent(nomePasta)}`;

  return (
    <div className={styles.page}>
      <header className={styles.cabecalho}>
        <div>
          <h1 className={styles.titulo}>{emPasta ? nomePasta : 'Meus documentos'}</h1>
          <p className={styles.apoio}>
            {emPasta
              ? (carregando ? 'Carregando...' : contagemPasta)
              : 'Todos os documentos que você gerou, guardados na nuvem. Abra, edite ou envie de novo quando quiser.'}
          </p>
        </div>
        {emPasta ? (
          <Link href={novoParaCliente} className={`btn-primary ${styles.novo}`}>
            <Plus size={16} /> Novo documento para este cliente
          </Link>
        ) : (
          <Link href="/documentos?tipo=proposta" className={`btn-primary ${styles.novo}`}>
            <Plus size={16} /> Novo documento
          </Link>
        )}
      </header>

      {emPasta && (
        <button type="button" className={styles.voltar} onClick={() => router.push('/historico')}>
          <ChevronLeft size={16} /> Todos os documentos
        </button>
      )}

      {!emPasta && !nenhumDocumento && (
        <section className={styles.faixa} aria-label="Resumo do mês">
          <IndicadorFaixa valor={ind?.documentos_mes} rotulo="Documentos no mês" onClick={() => filtrarPor('todos', '30')} />
          <IndicadorFaixa valor={ind?.propostas_mes} rotulo="Propostas no mês" onClick={() => filtrarPor('propostas', '30')} />
          <IndicadorFaixa valor={ind?.contratos_procuracoes_mes} rotulo="Contratos e procurações no mês" onClick={() => filtrarPor('contratos_proc', '30')} />
          <IndicadorFaixa valor={ind?.clientes_com_documento} rotulo="Clientes com documento" onClick={() => filtrarPor('todos', 'tudo', 'cliente')} />
        </section>
      )}

      {!emPasta && !vazioGeral && (
        <div className={styles.barra}>
          <label className={styles.busca}>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={vista === 'cliente' ? 'Buscar cliente' : 'Buscar por cliente ou código'}
              aria-label="Buscar documentos"
            />
          </label>

          {vista === 'lista' && (
            <>
              <select className={styles.seletor} value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Tipo de documento">
                {GRUPOS.filter((g) => g.id !== 'contratos_proc' || grupo === 'contratos_proc').map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <select className={styles.seletor} value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
                {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </>
          )}

          <div className={styles.alterna} role="group" aria-label="Forma de ver">
            <button type="button" aria-pressed={vista === 'lista'} className={vista === 'lista' ? styles.alternaAtivo : ''} onClick={() => setVista('lista')}>Lista</button>
            <button type="button" aria-pressed={vista === 'cliente'} className={vista === 'cliente' ? styles.alternaAtivo : ''} onClick={() => setVista('cliente')}>Por cliente</button>
          </div>
        </div>
      )}

      {aviso && <p className={styles.aviso} role="status">{aviso}</p>}

      {vista === 'cliente' && !emPasta ? (
        <PastasLista pastas={pastasFiltradas} carregando={!resumo} onAbrir={abrirPasta} />
      ) : (
        <>
          {emPasta && <h2 className={styles.secaoPrimeira}>Documentos</h2>}
          {carregando ? (
            <p className={styles.estado}>Carregando...</p>
          ) : erro ? (
            <div className={styles.estado}>
              <p>{erro}</p>
              <button type="button" className="btn-secondary" onClick={() => buscar(1, false)}>Tentar de novo</button>
            </div>
          ) : vazioGeral ? (
            <section className={styles.vazio} aria-label="O que você ganha ao gerar documentos">
              <div>
                <h2>Tudo guardado na nuvem</h2>
                <p>Cada documento que você gera fica salvo na sua conta, em qualquer plano.</p>
              </div>
              <div>
                <h2>Edite quando precisar</h2>
                <p>Corrija um documento pronto sem gerar outro e sem gastar do seu limite.</p>
              </div>
              <div>
                <h2>Organizado por cliente</h2>
                <p>Abra a pasta de cada cliente e veja documentos, vistorias e manutenções juntos.</p>
              </div>
            </section>
          ) : docs.length === 0 ? (
            <p className={styles.estado}>Nenhum documento com esses filtros.</p>
          ) : (
            <>
              <table className={styles.tabela}>
                <colgroup>
                  <col className={emPasta ? undefined : styles.colTipo} />
                  {!emPasta && <col />}
                  <col className={styles.colCodigo} />
                  <col className={styles.colData} />
                  <col className={styles.colAcoes} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    {!emPasta && <th>Cliente</th>}
                    <th>Código</th>
                    <th>Data</th>
                    <th><span className={styles.soLeitor}>Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <LinhaDoc
                      key={doc.id}
                      doc={doc}
                      semCliente={emPasta}
                      ocupado={ocupado === doc.id}
                      menuAberto={menuAberto === doc.id}
                      onMenu={(aberto) => setMenuAberto(aberto ? doc.id : null)}
                      onAbrir={() => abrir(doc)}
                      onBaixar={() => baixar(doc)}
                      onLink={() => copiarLink(doc)}
                    />
                  ))}
                </tbody>
              </table>
              {docs.length < total && (
                <div className={styles.rodape}>
                  <span>{docs.length} de {total}</span>
                  <button type="button" className="btn-secondary" disabled={carregandoMais} onClick={() => buscar(pagina + 1, true)}>
                    {carregandoMais ? 'Carregando...' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {emPasta && (
        <>
          <h2 className={styles.secao}>Vistorias</h2>
          <ListaCampo itens={porCliente?.vistorias} carregando={!porCliente} vazio="Nenhuma vistoria deste cliente." tipo="vistoria" />
          <h2 className={styles.secao}>Manutenções</h2>
          <ListaCampo itens={porCliente?.manutencoes} carregando={!porCliente} vazio="Nenhuma manutenção deste cliente." tipo="manutencao" />
        </>
      )}
    </div>
  );
}

function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function IndicadorFaixa({ valor, rotulo, onClick }: { valor: number | undefined; rotulo: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.indicador} onClick={onClick}>
      <span className={styles.indicadorValor}>{valor ?? '-'}</span>
      <span className={styles.indicadorRotulo}>{rotulo}</span>
    </button>
  );
}

function LinhaDoc({ doc, semCliente, ocupado, menuAberto, onMenu, onAbrir, onBaixar, onLink }: {
  doc: Doc;
  semCliente: boolean;
  ocupado: boolean;
  menuAberto: boolean;
  onMenu: (aberto: boolean) => void;
  onAbrir: () => void;
  onBaixar: () => void;
  onLink: () => void;
}) {
  const editar = editarHref(doc);
  const pdf = doc.pdf_disponivel;
  // No computador só Abrir e Editar ficam à vista; o resto vai no menu "...". No celular o menu leva tudo.
  const temExtras = pdf || !!doc.link_publico;
  const temMenu = temExtras || !!editar;
  return (
    <tr className={styles.linha}>
      <td className={styles.tipo}>{rotuloTipo(doc.tipo)}</td>
      {!semCliente && <td className={styles.cliente} title={doc.cliente_nome || undefined}>{doc.cliente_nome || 'Sem nome'}</td>}
      <td className={styles.codigo}>{doc.codigo_curto || '-'}</td>
      <td className={styles.data}>
        {fmtDateBR(doc.created_at)}
        {!pdf && <span className={styles.soMobile}> · Processando...</span>}
      </td>
      <td className={styles.acoes}>
        <div className={styles.acoesInterno}>
          <span className={`${styles.slotAbrir} ${styles.soDesktop}`}>
            {pdf
              ? <button type="button" className={styles.acao} onClick={onAbrir} disabled={ocupado}>Abrir</button>
              : <span className={styles.processando}>Processando...</span>}
          </span>
          <span className={`${styles.slotEditar} ${styles.soDesktop}`}>
            {editar && <Link href={editar} className={styles.acao}>Editar</Link>}
          </span>
          {temMenu ? (
            <span className={`${styles.menuWrap} ${temExtras ? '' : styles.soMobile}`}>
              <button
                type="button"
                className={styles.maisBtn}
                aria-label="Mais ações do documento"
                aria-haspopup="menu"
                aria-expanded={menuAberto}
                onClick={(e) => { e.stopPropagation(); onMenu(!menuAberto); }}
              >
                <MoreVertical size={18} />
              </button>
              {menuAberto && (
                <span className={styles.menu} role="menu">
                  {pdf && <button type="button" role="menuitem" className={styles.soMobile} onClick={onAbrir}>Abrir</button>}
                  {editar && <Link href={editar} role="menuitem" className={styles.soMobile}>Editar</Link>}
                  {doc.link_publico && <button type="button" role="menuitem" onClick={onLink}>Copiar link</button>}
                  {pdf && <button type="button" role="menuitem" onClick={onBaixar} disabled={ocupado}>{ocupado ? 'Preparando...' : 'Baixar PDF'}</button>}
                </span>
              )}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function PastasLista({ pastas, carregando, onAbrir }: {
  pastas: Pasta[];
  carregando: boolean;
  onAbrir: (p: Pasta) => void;
}) {
  if (carregando) return <p className={styles.estado}>Carregando...</p>;
  if (pastas.length === 0) return <p className={styles.estado}>Nenhum cliente com documento.</p>;
  return (
    <ul className={styles.pastas} aria-label="Clientes">
      {pastas.map((p) => {
        const tipos = Object.entries(p.tipos).sort((a, b) => b[1] - a[1]);
        return (
          <li key={`${p.cliente_id ?? 'nome'}:${p.chave}`}>
            <button type="button" className={styles.pasta} onClick={() => onAbrir(p)}>
              <span className={styles.pastaNome} title={p.nome}>{p.nome}</span>
              <span className={styles.pastaTipos}>
                {tipos.slice(0, 4).map(([t, n]) => (
                  <span key={t} className={styles.etiqueta}>{rotuloTipo(t)} {n}</span>
                ))}
                {tipos.length > 4 && <span className={styles.etiqueta}>+{tipos.length - 4}</span>}
              </span>
              <span className={styles.pastaTotal}>{contar(p.total, 'documento', 'documentos')}</span>
              <span className={styles.pastaData}>{p.ultimo ? `Último em ${fmtDateBR(p.ultimo)}` : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListaCampo({ itens, carregando, vazio, tipo }: {
  itens: ItemCampo[] | undefined;
  carregando: boolean;
  vazio: string;
  tipo: 'vistoria' | 'manutencao';
}) {
  if (carregando) return <p className={styles.estado}>Carregando...</p>;
  if (!itens || itens.length === 0) return <p className={styles.estado}>{vazio}</p>;
  const status = (i: ItemCampo) => (i.status === 'concluida' ? 'Concluída' : 'Em andamento');
  return (
    <ul className={styles.campo} aria-label={tipo === 'vistoria' ? 'Vistorias' : 'Manutenções'}>
      {itens.map((i) => (
        <li key={i.id} className={styles.campoLinha}>
          <span className={styles.tipo}>{tipo === 'vistoria' ? 'Vistoria' : 'Manutenção'}</span>
          <span className={styles.codigo}>{i.codigo || i.codigo_curto || '-'}</span>
          <span className={styles.data}>{fmtDateBR(i.data_inspecao ? `${i.data_inspecao}T12:00:00Z` : (i.created_at ?? ''))}</span>
          <span className={styles.etiqueta}>{status(i)}</span>
        </li>
      ))}
    </ul>
  );
}
