'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import './mao-de-obra.css';

type Especialidade = 'instalacao_solar' | 'manutencao' | 'ambos';
type Status = 'pendente' | 'aprovado' | 'suspenso';

interface Regiao { cidade: string; estado: string; }

interface Prestador {
  id: string;
  nome_empresa: string | null;
  responsavel: string;
  whatsapp: string;
  anos_experiencia: number | null;
  time_size: number | null;
  especialidade: Especialidade | null;
  capacidade_kwp_mes: number | null;
  observacoes: string | null;
  ativo: boolean;
  status: Status;
  created_at: string;
}

const STATUS_LABEL: Record<Status, { label: string; color: string; bg: string }> = {
  pendente: { label: '⏳ Aguardando aprovação', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  aprovado: { label: '✓ Aprovado',              color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  suspenso: { label: '⏸ Suspenso',              color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

export default function MaoDeObraPage() {
  const { user } = useDashboard();
  const isVip = user?.plano === 'ilimitado' || (user as any)?.is_admin;

  const [prestador, setPrestador] = useState<Prestador | null>(null);
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Form state
  const [responsavel, setResponsavel] = useState('');
  const [nomeEmpresa, setNomeEmpresa] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [anos, setAnos] = useState('');
  const [timeSize, setTimeSize] = useState('');
  const [especialidade, setEspecialidade] = useState<Especialidade>('instalacao_solar');
  const [capacidade, setCapacidade] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [novaCidade, setNovaCidade] = useState('');
  const [novoEstado, setNovoEstado] = useState('MG');

  const loadProfile = useCallback(async () => {
    try {
      const r = await api.get('/prestadores/me');
      const p: Prestador | null = r.data.prestador;
      setPrestador(p);
      setRegioes(r.data.regioes ?? []);
      if (p) {
        setResponsavel(p.responsavel ?? '');
        setNomeEmpresa(p.nome_empresa ?? '');
        setWhatsapp(p.whatsapp ?? '');
        setAnos(p.anos_experiencia != null ? String(p.anos_experiencia) : '');
        setTimeSize(p.time_size != null ? String(p.time_size) : '');
        setEspecialidade((p.especialidade ?? 'instalacao_solar') as Especialidade);
        setCapacidade(p.capacidade_kwp_mes != null ? String(p.capacidade_kwp_mes) : '');
        setObservacoes(p.observacoes ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  function adicionarRegiao() {
    const cidade = novaCidade.trim();
    if (cidade.length < 2) return;
    if (regioes.some(r => r.cidade.toLowerCase() === cidade.toLowerCase() && r.estado === novoEstado)) return;
    setRegioes([...regioes, { cidade, estado: novoEstado }]);
    setNovaCidade('');
  }

  function removerRegiao(idx: number) {
    setRegioes(regioes.filter((_, i) => i !== idx));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (regioes.length === 0) {
      alert('Adicione pelo menos 1 cidade que você atende.');
      return;
    }
    setSalvando(true);
    try {
      await api.post('/prestadores/me', {
        nome_empresa: nomeEmpresa || null,
        responsavel,
        whatsapp,
        anos_experiencia: anos ? parseInt(anos, 10) : null,
        time_size: timeSize ? parseInt(timeSize, 10) : null,
        especialidade,
        capacidade_kwp_mes: capacidade ? parseFloat(capacidade) : null,
        observacoes: observacoes || null,
        regioes,
      });
      await loadProfile();
      alert('Cadastro salvo! Aguarde aprovação do admin.');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (!isVip) {
    return (
      <div className="mob-wrap">
        <header className="mob-hero">
          <h1>🔧 Cadastro de Mão de Obra</h1>
          <p>Recurso exclusivo do plano VIP. Cadastre seu time e receba obras prontas pra executar.</p>
          <a href="/conta/mao-de-obra" className="mob-vip-cta">★ Liberar com VIP</a>
        </header>
      </div>
    );
  }

  if (loading) {
    return <div className="mob-wrap"><p className="mob-loading">Carregando...</p></div>;
  }

  return (
    <div className="mob-wrap">
      <header className="mob-hero">
        <h1>🔧 Cadastro de Mão de Obra</h1>
        <p>Cadastre seu time e as cidades que atende. Quando tivermos venda na sua região, você é acionado.</p>
        {prestador && STATUS_LABEL[prestador.status] && (
          <span className="mob-status" style={{
            color: STATUS_LABEL[prestador.status].color,
            background: STATUS_LABEL[prestador.status].bg,
          }}>
            {STATUS_LABEL[prestador.status].label}
          </span>
        )}
      </header>

      <form className="mob-form" onSubmit={salvar}>
        <div className="mob-grid">
          <label>
            <span>Responsável *</span>
            <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)} required minLength={2} />
          </label>
          <label>
            <span>Nome da empresa</span>
            <input type="text" value={nomeEmpresa} onChange={e => setNomeEmpresa(e.target.value)} placeholder="Opcional" />
          </label>
          <label>
            <span>WhatsApp *</span>
            <input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="DDD + número" required />
          </label>
          <label>
            <span>Anos de experiência</span>
            <input type="number" value={anos} onChange={e => setAnos(e.target.value)} min={0} max={80} />
          </label>
          <label>
            <span>Tamanho do time</span>
            <input type="number" value={timeSize} onChange={e => setTimeSize(e.target.value)} min={1} max={500} placeholder="Quantas pessoas" />
          </label>
          <label>
            <span>Especialidade</span>
            <select value={especialidade} onChange={e => setEspecialidade(e.target.value as Especialidade)}>
              <option value="instalacao_solar">Instalação Solar</option>
              <option value="manutencao">Manutenção</option>
              <option value="ambos">Instalação + Manutenção</option>
            </select>
          </label>
          <label>
            <span>Capacidade (kWp/mês)</span>
            <input type="number" value={capacidade} onChange={e => setCapacidade(e.target.value)} min={0} step={0.1} placeholder="Quantos kWp instala por mês" />
          </label>
        </div>

        <label>
          <span>Observações</span>
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={3} placeholder="Diferenciais, certificações, equipamento próprio..." />
        </label>

        <div className="mob-regioes-block">
          <h3>📍 Cidades atendidas *</h3>
          <p className="mob-help">Adicione todas as cidades onde seu time pode executar obras.</p>

          <div className="mob-regiao-add">
            <input
              type="text"
              placeholder="Cidade (ex: Uberlândia)"
              value={novaCidade}
              onChange={e => setNovaCidade(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarRegiao(); } }}
            />
            <select value={novoEstado} onChange={e => setNovoEstado(e.target.value)}>
              {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
            <button type="button" onClick={adicionarRegiao}>+ Adicionar</button>
          </div>

          {regioes.length > 0 && (
            <ul className="mob-regioes-list">
              {regioes.map((r, i) => (
                <li key={i}>
                  <span>📍 {r.cidade}/{r.estado}</span>
                  <button type="button" onClick={() => removerRegiao(i)} title="Remover">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" disabled={salvando} className="mob-btn-primary">
          {salvando ? 'Salvando...' : prestador ? 'Atualizar cadastro' : 'Enviar pra aprovação'}
        </button>
      </form>
    </div>
  );
}
