'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, Plus, Type, UserPlus, Users } from 'lucide-react';
import api from '@/services/api';
import ClientModal from '@/components/ClientModal/ClientModal';
import { Aba, Abas } from '@/components/Escolha/Escolha';
import {
  AgendaLateral, Cabecalho, DuasColunas, EstadoErroLista, EstadoVazio, Etiqueta, Indicadores, Pagina, PainelTabela,
  useEsconderWhatsFab, estilos as e, type ColunaTabela, type Indicador, type ItemAgenda,
} from '@/components/AreaTrabalho/AreaTrabalho';
import { EstadoMigracao } from './Comum';
import Editor from './Editor';
import {
  SELOS, codigoVisivel, dataCurta, ehMigracaoPendente, logUso, msgErro, prazo,
  type ItemLista, type Proxima,
} from './tipos';
import './manutencao.css';

interface Cliente { id: string; nome: string }

type Vista = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editor'; id: string };

export default function ManutencaoPage() {
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const aberto = useRef(false);
  // O botão flutuante do WhatsApp cobre campos e botões no celular: some nesta tela abaixo de 720 px.
  useEsconderWhatsFab(true, true);

  useEffect(() => {
    if (!aberto.current) { aberto.current = true; logUso('aberto'); }
  }, []);

  const irLista = useCallback(() => {
    setVista({ tipo: 'lista' });
    window.scrollTo({ top: 0 });
  }, []);

  if (vista.tipo === 'editor') return <Editor key={vista.id} id={vista.id} onSair={irLista} />;
  if (vista.tipo === 'novo') {
    return <Novo onVoltar={irLista} onCriado={(id) => { setVista({ tipo: 'editor', id }); window.scrollTo({ top: 0 }); }} />;
  }
  return <Lista onNovo={() => setVista({ tipo: 'novo' })} onAbrir={(id) => setVista({ tipo: 'editor', id })} />;
}

// ── Lista: área de trabalho ───────────────────────────────────────────────────

const situacaoDe = (it: ItemLista): 'andamento' | 'concluida' => (it.status === 'concluida' ? 'concluida' : 'andamento');
const textoBuscaDe = (it: ItemLista): string => `${it.cliente_nome || 'Cliente sem nome'} ${codigoVisivel(it.codigo)}`;
const idDe = (it: ItemLista): string => it.id;
const rotuloAcaoDe = (it: ItemLista): string => (it.status === 'concluida' ? 'Abrir' : 'Continuar');

/** Situação numa coluna só: em andamento, o selo da manutenção concluída, ou "Concluída" quando não há selo. */
function Situacao({ it }: { it: ItemLista }) {
  if (it.status !== 'concluida') return <Etiqueta tom="neutro">Em andamento</Etiqueta>;
  if (!it.selo) return <Etiqueta tom="ok">Concluída</Etiqueta>;
  return <Etiqueta tom={it.selo === 'conforme' ? 'ok' : it.selo === 'atencao' ? 'atencao' : 'erro'}>{SELOS[it.selo].titulo}</Etiqueta>;
}

const proximaDe = (it: ItemLista): string => (it.status === 'concluida' && it.proxima_visita ? dataCurta(it.proxima_visita) : 'Sem data');

const COLUNAS: ColunaTabela<ItemLista>[] = [
  {
    titulo: 'Cliente',
    render: (it) => (
      <>
        <span className={e.nome}>{it.cliente_nome || 'Cliente sem nome'}</span>
        <span className={e.sub}>{codigoVisivel(it.codigo) || 'Sem código'}</span>
      </>
    ),
  },
  { titulo: 'Inspeção', largura: '104px', render: (it) => <span className={e.num}>{dataCurta(it.data_inspecao)}</span> },
  { titulo: 'Situação', largura: '196px', render: (it) => <Situacao it={it} /> },
  { titulo: 'Próxima visita', largura: '124px', render: (it) => <span className={e.num}>{proximaDe(it)}</span> },
];

const mobileDe = (it: ItemLista) => ({
  titulo: it.cliente_nome || 'Cliente sem nome',
  detalhe: `${codigoVisivel(it.codigo) || 'Sem código'}, ${dataCurta(it.data_inspecao)}${it.status === 'concluida' && it.proxima_visita ? `. Próxima visita: ${dataCurta(it.proxima_visita)}` : ''}`,
  etiquetas: <Situacao it={it} />,
});

const DIA = 86_400_000;
const diasDesde = (isoData: string): number => {
  const t = Date.parse(`${isoData.slice(0, 10)}T12:00:00`);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / DIA;
};

/** Filtro que cada indicador aplica à tabela. */
function predicadoDoIndicador(kpi: string | null, diasPorId: Map<string, number>): ((it: ItemLista) => boolean) | null {
  if (kpi === 'andamento') return (it) => it.status !== 'concluida';
  if (kpi === 'recentes') return (it) => it.status === 'concluida' && diasDesde(it.data_inspecao) <= 30;
  if (kpi === 'proximas') return (it) => { const d = diasPorId.get(it.id); return d !== undefined && d >= 0 && d <= 30; };
  if (kpi === 'vencidas') return (it) => { const d = diasPorId.get(it.id); return d !== undefined && d < 0; };
  return null;
}

function Lista({ onNovo, onAbrir }: { onNovo: () => void; onAbrir: (id: string) => void }) {
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [proximas, setProximas] = useState<Proxima[]>([]);
  const [fase, setFase] = useState<'carregando' | 'ok' | 'erro' | 'migracao'>('carregando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.get('/manutencoes/list'),
      api.get('/manutencoes/proximas').catch((er) => { if (ehMigracaoPendente(er)) throw er; return { data: [] }; }),
    ]).then(([l, p]) => {
      if (!vivo) return;
      setItens(Array.isArray(l.data) ? l.data : []);
      setProximas(Array.isArray(p.data) ? p.data : []);
      setFase('ok');
    }).catch((er) => {
      if (vivo) setFase(ehMigracaoPendente(er) ? 'migracao' : 'erro');
    });
    return () => { vivo = false; };
  }, [tentativa]);

  // Em andamento primeiro; dentro de cada grupo a lista já chega do mais recente para o mais antigo.
  const ordenada = useMemo(
    () => [...itens].sort((a, b) =>
      (a.status === 'concluida' ? 1 : 0) - (b.status === 'concluida' ? 1 : 0) || b.created_at.localeCompare(a.created_at)),
    [itens],
  );

  const [kpi, setKpi] = useState<string | null>(null);
  const diasPorId = useMemo(() => new Map(proximas.map((p) => [p.id, p.dias])), [proximas]);

  const indicadores = useMemo((): Indicador[] => [
    { id: 'andamento', rotulo: 'Em andamento', valor: itens.filter((it) => it.status !== 'concluida').length },
    { id: 'recentes', rotulo: 'Concluídas em 30 dias', valor: itens.filter((it) => it.status === 'concluida' && diasDesde(it.data_inspecao) <= 30).length },
    { id: 'proximas', rotulo: 'Visitas nos próximos 30 dias', valor: proximas.filter((p) => p.dias >= 0 && p.dias <= 30).length },
    { id: 'vencidas', rotulo: 'Visitas vencidas', valor: proximas.filter((p) => p.dias < 0).length, alerta: proximas.some((p) => p.dias < 0) },
  ], [itens, proximas]);

  const predicadoKpi = predicadoDoIndicador(kpi, diasPorId);
  const rotuloKpi = kpi ? indicadores.find((i) => i.id === kpi)?.rotulo : undefined;

  const agenda: ItemAgenda[] = useMemo(() => proximas.slice(0, 8).map((p) => ({
    id: p.id,
    data: p.proxima_visita,
    titulo: p.cliente_nome || 'Cliente sem nome',
    etiqueta: prazo(p.dias),
    tom: p.dias < 0 ? 'erro' : p.dias <= 7 ? 'atencao' : 'neutro',
  })), [proximas]);

  const falha = fase === 'erro' || fase === 'migracao';

  return (
    <Pagina>
      <Cabecalho
        titulo="Manutenções"
        apoio="Relatórios de manutenção preventiva e agenda das próximas visitas."
        botao={{ texto: 'Novo relatório', icone: Plus, onClick: onNovo, desativado: fase === 'migracao' }}
      />

      {fase === 'ok' && itens.length > 0 && <Indicadores itens={indicadores} ativo={kpi} onEscolher={setKpi} />}

      <DuasColunas
        principal={(
          <PainelTabela
            itens={ordenada}
            getId={idDe}
            colunas={COLUNAS}
            textoBusca={textoBuscaDe}
            situacao={situacaoDe}
            onAbrir={(it) => onAbrir(it.id)}
            rotuloAcao={rotuloAcaoDe}
            mobile={mobileDe}
            carregando={fase === 'carregando'}
            placeholderBusca="Buscar por cliente ou código"
            predicado={predicadoKpi}
            rotuloPredicado={rotuloKpi}
            onLimparPredicado={() => setKpi(null)}
            erro={fase === 'erro'
              ? <EstadoErroLista texto="Não consegui carregar os relatórios." onTentar={() => { setFase('carregando'); setTentativa((t) => t + 1); }} />
              : fase === 'migracao'
                ? <div className={e.vazio}><p className={e.vazioFrase}>A manutenção está sendo liberada. Volte em alguns minutos.</p></div>
                : undefined}
            vazio={(
              <EstadoVazio
                icone={ClipboardList}
                frase="Nenhum relatório ainda. Quando você concluir a primeira manutenção, ela aparece aqui."
                botao={{ texto: 'Novo relatório', icone: Plus, onClick: onNovo }}
              />
            )}
          />
        )}
        lateral={falha ? undefined : (
          <AgendaLateral
            titulo="Próximas visitas"
            itens={agenda}
            vazio="Nenhuma visita agendada."
            onAbrir={onAbrir}
            carregando={fase === 'carregando'}
          />
        )}
      />
    </Pagina>
  );
}

// ── Novo relatório: escolher o cliente ───────────────────────────────────────

function Novo({ onVoltar, onCriado }: { onVoltar: () => void; onCriado: (id: string) => void }) {
  const [modo, setModo] = useState<'cadastrado' | 'nome'>('cadastrado');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [clienteId, setClienteId] = useState('');
  const [nome, setNome] = useState('');
  const [modal, setModal] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');
  const [migracao, setMigracao] = useState(false);

  const carregarClientes = useCallback(() => {
    api.get('/clients')
      .then(({ data }) => setClientes(Array.isArray(data?.clients) ? data.clients : []))
      .catch(() => {})
      .finally(() => setCarregandoClientes(false));
  }, []);

  useEffect(() => { carregarClientes(); }, [carregarClientes]);

  const nomeDoCliente = clientes.find((c) => c.id === clienteId)?.nome || '';
  const pronto = modo === 'cadastrado' ? !!clienteId : nome.trim().length > 0;

  async function criar() {
    setErro(''); setCriando(true);
    try {
      const corpo = modo === 'cadastrado'
        ? { cliente_id: clienteId, cliente_nome: nomeDoCliente }
        : { cliente_nome: nome.trim() };
      const r = await api.post('/manutencoes', corpo);
      logUso('criado');
      onCriado(r.data.id as string);
    } catch (err) {
      if (ehMigracaoPendente(err)) setMigracao(true);
      else setErro(msgErro(err) || 'Não consegui criar o relatório. Tente de novo.');
      setCriando(false);
    }
  }

  if (migracao) return <div className="mnt-page"><EstadoMigracao /></div>;

  return (
    <div className="mnt-page">
      {modal && (
        <ClientModal client={null} onClose={() => setModal(false)}
          onSave={(c) => { setModal(false); setClientes((l) => [...l.filter((x) => x.id !== c.id), { id: c.id, nome: c.nome }]); setClienteId(c.id); setModo('cadastrado'); carregarClientes(); }} />
      )}
      <button type="button" className="mnt-voltar" onClick={onVoltar}><ArrowLeft size={18} /> Relatórios</button>
      <header className="mnt-hero">
        <div>
          <h1 className="mnt-titulo">Novo relatório</h1>
          <p className="mnt-sub">Para quem é esta manutenção?</p>
        </div>
      </header>

      <section className="mnt-card mnt-cardNovo">
        <Abas>
          <Aba on={modo === 'cadastrado'} onClick={() => setModo('cadastrado')} icone={Users}>Já é cliente</Aba>
          <Aba on={modo === 'nome'} onClick={() => setModo('nome')} icone={Type}>Só o nome</Aba>
        </Abas>

        {modo === 'cadastrado' && (
          <div className="mnt-field mnt-espaco">
            {carregandoClientes ? (
              <p className="mnt-hint">Carregando seus clientes...</p>
            ) : clientes.length === 0 ? (
              <p className="mnt-hint">Nenhum cliente cadastrado ainda. Cadastre agora ou use Só o nome.</p>
            ) : (
              <>
                <label className="mnt-label" htmlFor="mnt-cliente">Cliente</label>
                <select id="mnt-cliente" className="mnt-input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                  <option value="">Escolha um cliente</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </>
            )}
            <button type="button" className="mnt-btn mnt-btnGhost mnt-espacoTopo" onClick={() => setModal(true)}>
              <UserPlus size={18} /> Cadastrar cliente novo
            </button>
          </div>
        )}

        {modo === 'nome' && (
          <div className="mnt-field mnt-espaco">
            <label className="mnt-label" htmlFor="mnt-nome">Nome do cliente ou do imóvel</label>
            <input id="mnt-nome" className="mnt-input" value={nome} maxLength={255} onChange={(e) => setNome(e.target.value)} />
          </div>
        )}

        {erro && <p className="mnt-erro" role="alert">{erro}</p>}
        <button type="button" className="mnt-btn mnt-btnPrimary mnt-btnGrande mnt-espacoTopo" disabled={!pronto || criando} onClick={criar}>
          {criando ? 'Criando...' : <><Plus size={19} strokeWidth={2.6} /> Começar relatório</>}
        </button>
      </section>
    </div>
  );
}
