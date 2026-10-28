'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, ChevronRight, ClipboardList, PenLine, Plus, Type, UserPlus, Users, Wrench } from 'lucide-react';
import api from '@/services/api';
import ClientModal from '@/components/ClientModal/ClientModal';
import { Aba, Abas } from '@/components/Escolha/Escolha';
import { EstadoCarregando, EstadoErro, EstadoMigracao, SeloChip } from './Comum';
import Editor from './Editor';
import {
  codigoVisivel, dataCurta, dataLonga, ehMigracaoPendente, logUso, msgErro, prazo,
  type ItemLista, type Proxima,
} from './tipos';
import './manutencao.css';

interface Cliente { id: string; nome: string }

type Vista = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editor'; id: string };

export default function ManutencaoPage() {
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const aberto = useRef(false);

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

// ── Lista ────────────────────────────────────────────────────────────────────

function Lista({ onNovo, onAbrir }: { onNovo: () => void; onAbrir: (id: string) => void }) {
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [proximas, setProximas] = useState<Proxima[]>([]);
  const [fase, setFase] = useState<'carregando' | 'ok' | 'erro' | 'migracao'>('carregando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.get('/manutencoes/list'),
      api.get('/manutencoes/proximas').catch((e) => { if (ehMigracaoPendente(e)) throw e; return { data: [] }; }),
    ]).then(([l, p]) => {
      if (!vivo) return;
      setItens(Array.isArray(l.data) ? l.data : []);
      setProximas(Array.isArray(p.data) ? p.data : []);
      setFase('ok');
    }).catch((e) => {
      if (vivo) setFase(ehMigracaoPendente(e) ? 'migracao' : 'erro');
    });
    return () => { vivo = false; };
  }, [tentativa]);

  const emAndamento = itens.filter((it) => it.status !== 'concluida');
  const demais = itens.filter((it) => it.status === 'concluida');

  const linhaRelatorio = (it: ItemLista) => (
    <li key={it.id}>
      <button type="button" className="mnt-linhaBtn" onClick={() => onAbrir(it.id)}>
        <span className="mnt-linhaTxt">
          <strong>{it.cliente_nome || 'Cliente sem nome'}</strong>
          <span className="mnt-meta">{codigoVisivel(it.codigo)} · {dataCurta(it.data_inspecao)}</span>
          <span className="mnt-chips">
            {it.status === 'concluida' ? <SeloChip selo={it.selo} /> : null}
            <span className={`mnt-st ${it.status === 'concluida' ? 'mnt-stOk' : ''}`}>
              {it.status === 'concluida' ? 'Concluída' : 'Em andamento'}
            </span>
            {it.status === 'concluida' && it.proxima_visita && (
              <span className="mnt-meta">Próxima: {dataLonga(it.proxima_visita)}</span>
            )}
          </span>
        </span>
        <ChevronRight size={18} />
      </button>
    </li>
  );

  const cabecalho = (
    <header className="mnt-hero">
      <div>
        <span className="mnt-badge"><Wrench size={15} strokeWidth={2.4} /> Manutenção</span>
        <h1 className="mnt-titulo">Manutenção preventiva</h1>
        <p className="mnt-sub">Faça a vistoria no local e entregue ao cliente um relatório pronto.</p>
      </div>
      {fase === 'ok' && (
        <button type="button" className="mnt-btn mnt-btnPrimary mnt-btnAuto" onClick={onNovo}>
          <Plus size={19} strokeWidth={2.6} /> Novo relatório
        </button>
      )}
    </header>
  );

  if (fase === 'carregando') {
    return <div className="mnt-page">{cabecalho}<EstadoCarregando /></div>;
  }
  if (fase === 'migracao') return <div className="mnt-page">{cabecalho}<EstadoMigracao /></div>;
  if (fase === 'erro') {
    return (
      <div className="mnt-page">
        {cabecalho}
        <EstadoErro texto="Não consegui carregar os relatórios." onTentar={() => { setFase('carregando'); setTentativa((t) => t + 1); }} />
      </div>
    );
  }

  return (
    <div className="mnt-page">
      {cabecalho}

      {itens.length === 0 ? (
        <div className="mnt-vazio">
          <span className="mnt-estadoIcone"><ClipboardList size={30} /></span>
          <h2 className="mnt-h2">Nenhum relatório ainda</h2>
          <p>Quando você concluir a primeira manutenção, o relatório aparece aqui.</p>
          <button type="button" className="mnt-btn mnt-btnPrimary mnt-btnAuto" onClick={onNovo}>
            <Plus size={19} strokeWidth={2.6} /> Novo relatório
          </button>
        </div>
      ) : (
        <>
          {emAndamento.length > 0 && (
            <section className="mnt-card mnt-continuar" aria-labelledby="mnt-continuar-t">
              <h2 className="mnt-h2" id="mnt-continuar-t"><PenLine size={18} /> Continuar de onde parou</h2>
              <ul className="mnt-lista">{emAndamento.map(linhaRelatorio)}</ul>
            </section>
          )}

          <div className="mnt-listaGrid">
            <section className="mnt-card mnt-proximas">
              <h2 className="mnt-h2"><CalendarClock size={18} /> Próximas visitas</h2>
              {proximas.length === 0 ? (
                <p className="mnt-hint">Nenhuma visita agendada.</p>
              ) : (
                <ul className="mnt-lista">
                  {proximas.slice(0, 5).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="mnt-linhaBtn" onClick={() => onAbrir(p.id)}>
                        <span className="mnt-linhaTxt">
                          <strong>{p.cliente_nome || 'Cliente sem nome'}</strong>
                          <span className={`mnt-prazo ${p.dias < 0 ? 'mnt-prazoVenc' : p.dias <= 7 ? 'mnt-prazoPerto' : ''}`}>{prazo(p.dias)}</span>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {demais.length > 0 && (
              <section className="mnt-card mnt-relatorios">
                <h2 className="mnt-h2">{emAndamento.length > 0 ? 'Relatórios concluídos' : 'Relatórios'}</h2>
                <ul className="mnt-lista">{demais.map(linhaRelatorio)}</ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
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
