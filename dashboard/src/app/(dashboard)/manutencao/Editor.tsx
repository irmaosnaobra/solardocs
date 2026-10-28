'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, Camera, ListChecks, Wrench, Repeat } from 'lucide-react';
import api from '@/services/api';
import { Escolha, Escolhas } from '@/components/Escolha/Escolha';
import Assinatura from './Assinatura';
import { CampoNumero } from './Campos';
import { EstadoCarregando, EstadoErro, EstadoMigracao, Salvamento, SeloChip, type EstadoSalvar } from './Comum';
import Concluido from './Concluido';
import FotosGrupo, { type FotoLocal } from './FotosGrupo';
import { comprimirFoto } from './imagem';
import {
  ATIVIDADES, AVISO_ASSINATURA_CLIENTE, AVISO_SEM_STATUS, CHECKLIST, GRUPOS_EXTRA, LIMITE_FOTOS_GRUPO,
  PERIODICIDADES, PRIORIDADE, SELOS, STATUS_ATIV, STATUS_ITEM, TELHADOS, TIPOS_SISTEMA,
  codigoVisivel, dataLonga, ehMigracaoPendente, faltamDoErro, logUso, msgErro, normalizarDados, soData, statusHttp, textoFaltam,
  type Dados, type Linha, type Resumo, type StatusItem,
} from './tipos';

interface Form { clienteNome: string; dataInsp: string; dados: Dados }
interface Empresa { nome: string; responsaveis: { nome: string; registro: string }[] }

const PASSOS = ['Cliente e sistema', 'Inspeção', 'Atividades e fotos', 'Conclusão', 'Assinaturas'];

let CID = 0;
const novoCid = () => `f${Date.now()}_${CID++}`;

function Campo({ label, children, dica }: { label: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="mnt-field">
      <label className="mnt-label">{label}</label>
      {children}
      {dica && <p className="mnt-hint">{dica}</p>}
    </div>
  );
}

export default function Editor({ id, onSair }: { id: string; onSair: () => void }) {
  const [fase, setFase] = useState<'carregando' | 'ok' | 'erro' | 'migracao'>('carregando');
  const [linha, setLinha] = useState<Linha | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [fotos, setFotos] = useState<Record<string, FotoLocal[]>>({});
  const [assinUrls, setAssinUrls] = useState<{ tecnico?: string; cliente?: string }>({});
  const [assinNomes, setAssinNomes] = useState<{ tecnico: string; registro: string; cliente: string }>({ tecnico: '', registro: '', cliente: '' });
  const [empresa, setEmpresa] = useState<Empresa>({ nome: '', responsaveis: [] });
  const [passo, setPasso] = useState(0);
  const [salvar, setSalvar] = useState<EstadoSalvar>('salvo');
  const [aviso, setAviso] = useState('');
  const [faltam, setFaltam] = useState(0);
  const [erroGeral, setErroGeral] = useState('');
  const [concluindo, setConcluindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[] | null>(null);

  const topoRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<Form | null>(null);
  const clienteIdRef = useRef<string | null>(null);
  const sujo = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drenando = useRef<Promise<boolean> | null>(null);
  const fila = useRef<{ cid: string; grupo: string; file: File }[]>([]);
  const filaP = useRef<Promise<void> | null>(null);
  const excluido = useRef(false);
  const erroRef = useRef<HTMLParagraphElement>(null);
  const drenarRef = useRef<(() => Promise<boolean>) | null>(null);

  // ── Carga ──
  const aplicar = useCallback((l: Linha) => {
    const f: Form = { clienteNome: l.cliente_nome || '', dataInsp: soData(l.data_inspecao), dados: normalizarDados(l.dados) };
    formRef.current = f;
    clienteIdRef.current = l.cliente_id;
    setClienteId(l.cliente_id);
    setTrocando(false);
    sujo.current = false;
    setForm(f);
    setLinha(l);
    setResumo(l.resumo || null);
    setSalvar('salvo');
    const fu = l.fotos_url || {};
    const grupos: Record<string, FotoLocal[]> = {};
    for (const [g, lista] of Object.entries(fu)) grupos[g] = lista.map((x) => ({ cid: x.path, path: x.path, url: x.url ?? null }));
    setFotos(grupos);
    setAssinUrls(l.assinaturas_url || {});
    setAssinNomes({
      tecnico: l.assinaturas?.tecnico?.nome || f.dados.responsavel.nome,
      registro: l.assinaturas?.tecnico?.registro || f.dados.responsavel.registro,
      cliente: l.assinaturas?.cliente?.nome || f.clienteNome,
    });
    setFase('ok');
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const r = await api.get(`/manutencoes/${id}`);
      aplicar(r.data as Linha);
    } catch (err) {
      setFase(ehMigracaoPendente(err) ? 'migracao' : 'erro');
    }
  }, [id, aplicar]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      const c = (data?.company || {}) as Record<string, string | undefined>;
      const resp: { nome: string; registro: string }[] = [];
      for (const [n, r] of [['tecnico_nome', 'tecnico_crt_cft'], ['tecnico2_nome', 'tecnico2_crt_cft'], ['tecnico3_nome', 'tecnico3_crt_cft'], ['engenheiro_nome', 'engenheiro_crea']]) {
        if (c[n]) resp.push({ nome: c[n]!, registro: c[r] || '' });
      }
      setEmpresa({ nome: c.nome_fantasia || c.nome || '', responsaveis: resp });
    }).catch(() => {});
  }, []);

  // Ao sair da tela, salva o que falta em vez de só cancelar o debounce.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (sujo.current && !excluido.current) void drenarRef.current?.();
  }, []);

  // Avisa antes de fechar a aba com alteração não salva ou foto ainda subindo.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (sujo.current || drenando.current || filaP.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, []);

  // Mostra o erro novo à vista: o botão que falhou pode estar longe dele.
  useEffect(() => {
    if (erroGeral) erroRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [erroGeral]);

  // ── Autosave ──
  // Um PUT por vez. O PUT substitui `dados` no servidor, então duas requisições em voo
  // poderiam chegar fora de ordem e gravar o estado velho por cima do novo. Se a pessoa
  // edita durante um PUT, marca sujo e o laço manda o estado mais recente em seguida.
  // A resposta só renova o resumo: o texto digitado vive sempre no estado local.
  const drenar = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (drenando.current) return drenando.current;
    const p = (async () => {
      // Sem este await o corpo terminaria antes de `drenando.current = p` e deixaria uma promise
      // já resolvida presa ali, e nenhum PUT sairia mais.
      await null;
      let ok = true;
      while (sujo.current && !excluido.current) {
        sujo.current = false;
        setSalvar('salvando');
        const f = formRef.current;
        if (!f) break;
        try {
          const corpo: Record<string, unknown> = { dados: f.dados, cliente_nome: f.clienteNome };
          if (f.dataInsp) corpo.data_inspecao = f.dataInsp;
          corpo.cliente_id = clienteIdRef.current; // null solta o vínculo
          const r = await api.put(`/manutencoes/${id}`, corpo);
          if (r.data?.resumo) setResumo(r.data.resumo as Resumo);
        } catch (err) {
          if (!excluido.current) sujo.current = true;
          ok = false;
          if (ehMigracaoPendente(err)) setFase('migracao');
          else if (statusHttp(err) === 409) setErroGeral('Este relatório já foi concluído. Recarregue a página.');
          setSalvar('erro');
          break;
        }
      }
      if (ok) setSalvar('salvo');
      return ok;
    })();
    drenando.current = p;
    void p.finally(() => { if (drenando.current === p) drenando.current = null; });
    return p;
  }, [id]);
  drenarRef.current = drenar;

  const mudar = useCallback((fn: (f: Form) => Form) => {
    const atual = formRef.current;
    if (!atual) return;
    const prox = fn(atual);
    formRef.current = prox;
    setForm(prox);
    sujo.current = true;
    setSalvar('salvando');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void drenar(); }, 800);
  }, [drenar]);

  const mudarDados = (fn: (d: Dados) => Dados) => mudar((f) => ({ ...f, dados: fn(f.dados) }));

  // ── Fotos: uma por vez ──
  const setGrupo = useCallback((grupo: string, fn: (l: FotoLocal[]) => FotoLocal[]) => {
    setFotos((prev) => ({ ...prev, [grupo]: fn(prev[grupo] || []) }));
  }, []);

  const rodarFila = useCallback((): Promise<void> => {
    if (filaP.current) return filaP.current;
    const p = (async () => {
      await null; // mesma razão do drenar: `filaP.current = p` precisa vir antes do fim do corpo
      while (fila.current.length) {
        const t = fila.current.shift()!;
        try {
          const c = await comprimirFoto(t.file);
          setGrupo(t.grupo, (l) => l.map((x) => (x.cid === t.cid ? { ...x, preview: c.preview } : x)));
          const r = await api.post(`/manutencoes/${id}/foto`, { grupo: t.grupo, base64: c.base64, media_type: 'image/jpeg' });
          setGrupo(t.grupo, (l) => l.map((x) => (x.cid === t.cid
            ? { ...x, path: r.data.path, url: r.data.url ?? null, uploading: false } : x)));
        } catch (err) {
          setGrupo(t.grupo, (l) => l.map((x) => (x.cid === t.cid ? { ...x, uploading: false, erro: true } : x)));
          setErroGeral(msgErro(err) || 'Uma foto não subiu. Toque no X para tirar e tente de novo.');
        }
      }
    })();
    filaP.current = p;
    void p.finally(() => { if (filaP.current === p) filaP.current = null; });
    return p;
  }, [id, setGrupo]);

  /** Espera a fila de fotos esvaziar (inclusive fotos que entrarem enquanto espera). */
  const esperarFotos = useCallback(async () => {
    while (filaP.current) {
      const p = filaP.current;
      await p;
      if (filaP.current === p) filaP.current = null; // nunca fica preso numa promise já resolvida
    }
  }, []);

  function adicionarFotos(grupo: string, files: File[]) {
    setErroGeral('');
    const jaTem = (fotos[grupo] || []).length;
    const cabem = Math.max(0, LIMITE_FOTOS_GRUPO - jaTem);
    if (files.length > cabem) setErroGeral(`Cabem mais ${cabem} foto(s) neste grupo. As demais foram ignoradas.`);
    const aceitas = files.slice(0, cabem);
    const novas: FotoLocal[] = aceitas.map(() => ({ cid: novoCid(), uploading: true }));
    setGrupo(grupo, (l) => [...l, ...novas]);
    aceitas.forEach((file, i) => fila.current.push({ cid: novas[i].cid, grupo, file }));
    void rodarFila();
  }

  async function apagarFoto(grupo: string, foto: FotoLocal) {
    if (!foto.path) { setGrupo(grupo, (l) => l.filter((x) => x.cid !== foto.cid)); return; }
    setGrupo(grupo, (l) => l.map((x) => (x.cid === foto.cid ? { ...x, uploading: true } : x)));
    try {
      await api.delete(`/manutencoes/${id}/foto`, { data: { path: foto.path } });
      setGrupo(grupo, (l) => l.filter((x) => x.cid !== foto.cid));
    } catch (err) {
      setGrupo(grupo, (l) => l.map((x) => (x.cid === foto.cid ? { ...x, uploading: false } : x)));
      setErroGeral(msgErro(err) || 'Não consegui apagar a foto. Tente de novo.');
    }
  }

  const blocoFotos = (grupo: string, rotulo: string) => (
    <FotosGrupo
      rotulo={rotulo}
      fotos={fotos[grupo] || []}
      onAdd={(files) => adicionarFotos(grupo, files)}
      onRemove={(f) => apagarFoto(grupo, f)}
    />
  );

  // ── Assinaturas ──
  async function recarregarAssinaturas() {
    try {
      const r = await api.get(`/manutencoes/${id}`);
      setAssinUrls((r.data as Linha).assinaturas_url || {});
    } catch { /* a imagem aparece na próxima carga */ }
  }

  async function salvarAssinatura(quem: 'tecnico' | 'cliente', base64: string, nome: string, registro: string): Promise<string | null> {
    try {
      await api.post(`/manutencoes/${id}/assinatura`, { quem, base64, nome, ...(quem === 'tecnico' ? { registro } : {}) });
      setAssinNomes((a) => (quem === 'tecnico' ? { ...a, tecnico: nome, registro } : { ...a, cliente: nome }));
      await recarregarAssinaturas();
      return null;
    } catch (err) {
      return msgErro(err) || 'Não consegui salvar a assinatura. Tente de novo.';
    }
  }

  async function removerAssinatura(quem: 'tecnico' | 'cliente'): Promise<string | null> {
    try {
      await api.delete(`/manutencoes/${id}/assinatura`, { data: { quem } });
      setAssinUrls((u) => ({ ...u, [quem]: undefined }));
      return null;
    } catch (err) {
      return msgErro(err) || 'Não consegui apagar a assinatura. Tente de novo.';
    }
  }

  // ── Navegação e ações ──
  async function irPara(n: number) {
    setPasso(n);
    setAviso(''); setFaltam(0);
    topoRef.current?.scrollIntoView({ block: 'start' });
    if (n >= 3) await drenar(); // o resumo do passo 4 só vale depois do último PUT
  }

  async function sair() {
    setErroGeral('');
    const ok = await drenar();
    if (!ok) {
      setErroGeral('Não consegui salvar as últimas alterações, então não saí da tela. Confira a conexão e tente de novo.');
      return;
    }
    onSair();
  }

  async function concluir() {
    if (!form) return;
    setErroGeral(''); setAviso(''); setFaltam(0);
    const sem = form.dados.itens.filter((i) => i.status == null).length;
    if (sem > 0) { setFaltam(sem); setAviso(AVISO_SEM_STATUS); return; }
    if (!form.dados.atividades.some((a) => a.feita)) {
      setErroGeral('Marque pelo menos uma atividade realizada.');
      return;
    }
    setConcluindo(true);
    try {
      // Espera as fotos da fila, cancela o debounce, manda o que falta e espera o último PUT:
      // senão o servidor valida dados velhos e a foto fica de fora do relatório.
      await esperarFotos();
      const salvou = await drenar();
      if (!salvou) { setErroGeral('Não consegui salvar as últimas alterações. Confira a conexão e tente de novo.'); return; }
      await api.post(`/manutencoes/${id}/concluir`);
      logUso('concluido');
      await recarregar();
      window.scrollTo({ top: 0 });
    } catch (err) {
      const n = faltamDoErro(err);
      if (n != null && n > 0) { setFaltam(n); setAviso(AVISO_SEM_STATUS); }
      else if (ehMigracaoPendente(err)) setFase('migracao');
      else setErroGeral(msgErro(err) || 'Não consegui concluir. Tente de novo.');
    } finally {
      setConcluindo(false);
    }
  }

  async function reabrir() {
    setOcupado(true); setErroGeral('');
    try {
      await api.post(`/manutencoes/${id}/reabrir`);
      setPasso(4);
      await recarregar();
    } catch (err) {
      setErroGeral(msgErro(err) || 'Não consegui reabrir. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm('Excluir este relatório e todas as fotos dele? Isso não pode ser desfeito.')) return;
    setOcupado(true); setErroGeral('');
    // Nada a salvar num relatório apagado: o autosave e o desmonte não mandam mais PUT.
    excluido.current = true;
    const tinhaPendente = sujo.current;
    sujo.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      await api.delete(`/manutencoes/${id}`);
      onSair();
    } catch (err) {
      excluido.current = false;
      sujo.current = tinhaPendente; // o relatório continua existindo: só o que já estava pendente volta a valer
      setErroGeral(msgErro(err) || 'Não consegui excluir. Tente de novo.');
      setOcupado(false);
    }
  }

  // ── Estados de tela ──
  if (fase === 'carregando') return <div className="mnt-page"><EstadoCarregando texto="Abrindo o relatório..." /></div>;
  if (fase === 'migracao') return <div className="mnt-page"><EstadoMigracao /></div>;
  if (fase === 'erro' || !form || !linha) {
    return (
      <div className="mnt-page">
        <EstadoErro texto="Não consegui abrir este relatório." onTentar={() => { setFase('carregando'); void recarregar(); }} />
        <button type="button" className="mnt-voltar" onClick={onSair}><ArrowLeft size={18} /> Relatórios</button>
      </div>
    );
  }

  if (linha.status === 'concluida') {
    return (
      <Concluido linha={linha} resumo={resumo} empresa={empresa.nome} ocupado={ocupado} erro={erroGeral}
        onReabrir={reabrir} onExcluir={excluir} onSair={onSair} />
    );
  }

  const d = form.dados;
  const marcados = d.itens.filter((i) => i.status != null).length;
  const semStatus = d.itens.length - marcados;
  const subindoFotos = Object.values(fotos).some((l) => l.some((f) => f.uploading));
  const ok1 = form.clienteNome.trim().length > 0;
  const ok2 = semStatus === 0;
  const ok3 = d.atividades.some((a) => a.feita);
  const completas = [ok1, ok2, ok3, ok2 && ok3, false];

  async function abrirTroca() {
    setTrocando(true);
    if (clientes) return;
    try {
      const { data } = await api.get('/clients');
      setClientes(Array.isArray(data?.clients) ? data.clients : []);
    } catch {
      setClientes([]);
    }
  }

  function escolherCliente(novoId: string) {
    const c = (clientes || []).find((x) => x.id === novoId);
    if (!c) return;
    clienteIdRef.current = c.id;
    setClienteId(c.id);
    setTrocando(false);
    mudar((f) => ({ ...f, clienteNome: c.nome }));
  }

  function soONome() {
    clienteIdRef.current = null;
    setClienteId(null);
    setTrocando(false);
    mudar((f) => ({ ...f })); // grava o desvínculo
  }

  // ── Passo 1: cliente e sistema ──
  const passo1 = (
    <>
      <section className="mnt-card">
        <h2 className="mnt-h2">Cliente</h2>
        {clienteId && !trocando ? (
          <Campo label="Cliente cadastrado" dica="O nome vem do cadastro do cliente.">
            <input className="mnt-input mnt-inputLeitura" value={form.clienteNome} readOnly aria-label="Nome do cliente (do cadastro)" />
            <button type="button" className="mnt-btn mnt-btnGhost" onClick={abrirTroca}>
              <Repeat size={18} /> Trocar cliente
            </button>
          </Campo>
        ) : clienteId && trocando ? (
          <Campo label="Escolha o cliente">
            {clientes === null ? <p className="mnt-hint">Carregando seus clientes...</p> : (
              <select className="mnt-input" value="" aria-label="Escolher cliente cadastrado" onChange={(e) => escolherCliente(e.target.value)}>
                <option value="">{clientes.length ? 'Escolha um cliente' : 'Nenhum cliente cadastrado'}</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            )}
            <button type="button" className="mnt-btn mnt-btnGhost" onClick={soONome}>Digitar só o nome</button>
            <button type="button" className="mnt-btn mnt-btnTexto" onClick={() => setTrocando(false)}>Manter {form.clienteNome || 'o cliente atual'}</button>
          </Campo>
        ) : (
          <Campo label="Nome do cliente">
            <input className="mnt-input" value={form.clienteNome} maxLength={255}
              onChange={(e) => mudar((f) => ({ ...f, clienteNome: e.target.value }))} />
          </Campo>
        )}
        <Campo label="Data da inspeção">
          <input className="mnt-input" type="date" value={form.dataInsp}
            onChange={(e) => mudar((f) => ({ ...f, dataInsp: e.target.value }))} />
        </Campo>
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Sistema</h2>
        <Campo label="Tipo">
          <Escolhas colunas="auto">
            {TIPOS_SISTEMA.map((t) => (
              <Escolha key={t.valor} on={d.sistema.tipo === t.valor} titulo={t.label}
                onClick={() => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, tipo: t.valor } }))} />
            ))}
          </Escolhas>
        </Campo>
        <div className="mnt-grid2">
          <Campo label="Quantidade de módulos">
            <CampoNumero milhar valor={d.sistema.qtd_modulos}
              onChange={(n) => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, qtd_modulos: n == null ? null : Math.round(n) } }))} />
          </Campo>
          <Campo label="Potência">
            <CampoNumero sufixo="kWp" valor={d.sistema.potencia_kwp}
              onChange={(n) => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, potencia_kwp: n } }))} />
          </Campo>
        </div>
        <Campo label="Modelo do módulo">
          <input className="mnt-input" value={d.sistema.modulo_modelo} maxLength={200}
            onChange={(e) => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, modulo_modelo: e.target.value } }))} />
        </Campo>

        <Campo label="Inversores">
          {d.sistema.inversores.length === 0 && <p className="mnt-hint">Nenhum inversor adicionado.</p>}
          {d.sistema.inversores.map((inv, idx) => (
            <div key={idx} className="mnt-inversor">
              <div className="mnt-inversorTopo">
                <strong>Inversor {idx + 1}</strong>
                <button type="button" className="mnt-btn mnt-btnTexto" aria-label={`Remover inversor ${idx + 1}`}
                  onClick={() => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, inversores: x.sistema.inversores.filter((_, i) => i !== idx) } }))}>
                  <Trash2 size={17} /> Remover
                </button>
              </div>
              {(['marca', 'modelo', 'serie'] as const).map((campo) => (
                <input key={campo} className="mnt-input" aria-label={`Inversor ${idx + 1}, ${campo === 'serie' ? 'número de série' : campo}`}
                  placeholder={campo === 'marca' ? 'Marca' : campo === 'modelo' ? 'Modelo' : 'Número de série'}
                  value={inv[campo]} maxLength={120}
                  onChange={(e) => mudarDados((x) => ({
                    ...x,
                    sistema: { ...x.sistema, inversores: x.sistema.inversores.map((v, i) => (i === idx ? { ...v, [campo]: e.target.value } : v)) },
                  }))} />
              ))}
            </div>
          ))}
          <button type="button" className="mnt-btn mnt-btnGhost" disabled={d.sistema.inversores.length >= 10}
            onClick={() => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, inversores: [...x.sistema.inversores, { marca: '', modelo: '', serie: '' }] } }))}>
            <Plus size={18} /> Adicionar inversor
          </button>
        </Campo>

        <Campo label="Telhado" dica="Pode marcar mais de um.">
          <Escolhas colunas="auto">
            {TELHADOS.map((t) => {
              const on = d.sistema.telhado.includes(t.valor);
              return (
                <Escolha key={t.valor} on={on} titulo={t.label}
                  onClick={() => mudarDados((x) => ({
                    ...x,
                    sistema: { ...x.sistema, telhado: on ? x.sistema.telhado.filter((v) => v !== t.valor) : [...x.sistema.telhado, t.valor] },
                  }))} />
              );
            })}
          </Escolhas>
        </Campo>
        <Campo label="Endereço do sistema">
          <input className="mnt-input" value={d.sistema.endereco} maxLength={300}
            onChange={(e) => mudarDados((x) => ({ ...x, sistema: { ...x.sistema, endereco: e.target.value } }))} />
        </Campo>
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Responsável pela manutenção</h2>
        {empresa.responsaveis.length > 0 && (
          <Campo label="Escolher da empresa">
            <select className="mnt-input" value="" aria-label="Escolher responsável da empresa"
              onChange={(e) => {
                const r = empresa.responsaveis[Number(e.target.value)];
                if (r) mudarDados((x) => ({ ...x, responsavel: { nome: r.nome, registro: r.registro } }));
              }}>
              <option value="">Escolha uma pessoa</option>
              {empresa.responsaveis.map((r, i) => <option key={i} value={i}>{r.nome}{r.registro ? ` (${r.registro})` : ''}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Nome">
          <input className="mnt-input" value={d.responsavel.nome} maxLength={200}
            onChange={(e) => mudarDados((x) => ({ ...x, responsavel: { ...x.responsavel, nome: e.target.value } }))} />
        </Campo>
        <Campo label="Registro (CREA, CFT ou CRT)">
          <input className="mnt-input" value={d.responsavel.registro} maxLength={60}
            onChange={(e) => mudarDados((x) => ({ ...x, responsavel: { ...x.responsavel, registro: e.target.value } }))} />
        </Campo>
      </section>
    </>
  );

  // ── Passo 2: inspeção ──
  const passo2 = (
    <>
      <div className="mnt-progresso" role="status">
        <strong>{marcados} de {d.itens.length} itens marcados</strong>
        <div className="mnt-barra"><div className="mnt-barraFill" style={{ width: `${(marcados / d.itens.length) * 100}%` }} /></div>
      </div>
      {CHECKLIST.map((c, idx) => {
        const item = d.itens[idx];
        const abre = item.status === 'atencao' || item.status === 'nao_conforme';
        const setItem = (patch: Partial<typeof item>) => mudarDados((x) => ({ ...x, itens: x.itens.map((i, k) => (k === idx ? { ...i, ...patch } : i)) }));
        return (
          <section key={c.key} className={`mnt-card mnt-item ${item.status ? `mnt-item-${item.status}` : ''}`}>
            <div className="mnt-itemTopo">
              <span className={`mnt-num ${item.status ? 'mnt-numFeito' : ''}`}>{item.status ? <Check size={14} strokeWidth={3.2} /> : idx + 1}</span>
              <div>
                <h3 className="mnt-h3">{c.label}</h3>
                <p className="mnt-hint">{c.dica}</p>
              </div>
            </div>
            <div className="mnt-status" role="group" aria-label={`Status: ${c.label}`}>
              {STATUS_ITEM.map((s) => (
                <button key={s.valor} type="button" aria-pressed={item.status === s.valor}
                  className={`mnt-sbtn mnt-sbtn-${s.valor} ${item.status === s.valor ? 'mnt-sbtnOn' : ''}`}
                  onClick={() => setItem({ status: s.valor as StatusItem })}>
                  {s.botao}
                </button>
              ))}
            </div>
            {abre && (
              <>
                <Campo label="O que foi visto">
                  <textarea className="mnt-input mnt-area" rows={3} maxLength={2000}
                    placeholder="Descreva o que você viu. Exemplo: dois módulos com sujeira acumulada."
                    value={item.visto} onChange={(e) => setItem({ visto: e.target.value })} />
                </Campo>
                <Campo label="Providência">
                  <textarea className="mnt-input mnt-area" rows={3} maxLength={2000}
                    placeholder="Escreva o que foi feito ou o que você recomenda."
                    value={item.providencia} onChange={(e) => setItem({ providencia: e.target.value })} />
                </Campo>
              </>
            )}
            <div className="mnt-fotosTitulo"><Camera size={16} /> Fotos deste item</div>
            {blocoFotos(c.key, c.label)}
          </section>
        );
      })}
    </>
  );

  // ── Passo 3: atividades e fotos ──
  const passo3 = (
    <>
      <section className="mnt-card">
        <h2 className="mnt-h2">Atividades realizadas</h2>
        <p className="mnt-hint">Ligue o que você fez nesta visita.</p>
        {ATIVIDADES.map((a, idx) => {
          const at = d.atividades[idx];
          const setAt = (patch: Partial<typeof at>) => mudarDados((x) => ({ ...x, atividades: x.atividades.map((v, k) => (k === idx ? { ...v, ...patch } : v)) }));
          return (
            <div key={a.key} className={`mnt-ativ ${at.feita ? 'mnt-ativOn' : ''}`}>
              <button type="button" role="switch" aria-checked={at.feita} className="mnt-ativLinha" onClick={() => setAt({ feita: !at.feita })}>
                <span>{a.label}</span>
                <span className={`mnt-switch ${at.feita ? 'mnt-switchOn' : ''}`}><span /></span>
              </button>
              {at.feita && (
                <div className="mnt-ativCorpo">
                  <div className="mnt-ativStatus" role="group" aria-label={`Resultado: ${a.label}`}>
                    {STATUS_ATIV.map((s) => (
                      <button key={s.valor} type="button" aria-pressed={at.status === s.valor}
                        className={`mnt-ativBtn ${at.status === s.valor ? 'mnt-ativBtnOn' : ''}`}
                        onClick={() => setAt({ status: s.valor })}>{s.label}</button>
                    ))}
                  </div>
                  <input className="mnt-input" placeholder="Observação (opcional)" aria-label={`Observação: ${a.label}`}
                    value={at.obs} maxLength={2000} onChange={(e) => setAt({ obs: e.target.value })} />
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Geração do mês</h2>
        <p className="mnt-hint">Opcional. Se preencher os dois números, o relatório mostra a geração medida em relação à esperada.</p>
        <div className="mnt-grid2">
          <Campo label="Esperada">
            <CampoNumero milhar sufixo="kWh/mês" valor={d.geracao.esperada_kwh}
              onChange={(n) => mudarDados((x) => ({ ...x, geracao: { ...x.geracao, esperada_kwh: n } }))} />
          </Campo>
          <Campo label="Medida">
            <CampoNumero milhar sufixo="kWh/mês" valor={d.geracao.medida_kwh}
              onChange={(n) => mudarDados((x) => ({ ...x, geracao: { ...x.geracao, medida_kwh: n } }))} />
          </Campo>
        </div>
      </section>

      {GRUPOS_EXTRA.map((g) => (
        <section key={g.key} className="mnt-card">
          <h2 className="mnt-h2">{g.label}</h2>
          {blocoFotos(g.key, g.label)}
        </section>
      ))}
    </>
  );

  // ── Passo 4: conclusão ──
  const manual = d.conclusao_manual !== null;
  const passo4 = (
    <>
      <section className="mnt-card mnt-seloCard">
        <SeloChip selo={resumo?.selo || null} grande />
        {resumo?.selo
          ? <p className="mnt-seloFrase">{SELOS[resumo.selo].frase}</p>
          : <p className="mnt-seloFrase">O selo aparece quando todos os itens da inspeção têm status.</p>}
        {resumo && resumo.faltam_status > 0 && (
          <p className="mnt-aviso">{textoFaltam(resumo.faltam_status)} {AVISO_SEM_STATUS}</p>
        )}
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Pendências e prioridades</h2>
        {resumo && resumo.pendencias.length > 0 ? (
          <ul className="mnt-pend">
            {resumo.pendencias.map((p) => (
              <li key={p.key} className={`mnt-pendItem mnt-pend-${p.prioridade}`}>
                <div className="mnt-pendTopo">
                  <strong>{p.label}</strong>
                  <span className={`mnt-prio mnt-prio-${p.prioridade}`}>{PRIORIDADE[p.prioridade].titulo}</span>
                </div>
                <p className="mnt-hint">{PRIORIDADE[p.prioridade].frase}</p>
                {p.visto && <p className="mnt-pendTxt"><b>Visto:</b> {p.visto}</p>}
                {p.providencia && <p className="mnt-pendTxt"><b>Providência:</b> {p.providencia}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mnt-hint">Nenhuma pendência registrada nesta visita.</p>
        )}
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Recomendações</h2>
        <Campo label="Recomendações ao cliente">
          <textarea className="mnt-input mnt-area" rows={4} maxLength={2000} value={d.recomendacoes}
            onChange={(e) => mudarDados((x) => ({ ...x, recomendacoes: e.target.value }))} />
        </Campo>
        <Campo label="Observações para a próxima visita">
          <textarea className="mnt-input mnt-area" rows={3} maxLength={2000} value={d.observacoes_proxima}
            onChange={(e) => mudarDados((x) => ({ ...x, observacoes_proxima: e.target.value }))} />
        </Campo>
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Próxima visita</h2>
        <Campo label="Periodicidade">
          <Escolhas colunas={3}>
            {PERIODICIDADES.map((p) => (
              <Escolha key={p.valor} on={d.periodicidade_meses === p.valor} titulo={p.label}
                onClick={() => mudarDados((x) => ({ ...x, periodicidade_meses: p.valor }))} />
            ))}
          </Escolhas>
        </Campo>
        <p className="mnt-proxima">
          {resumo?.proxima_visita ? <>Próxima visita: <strong>{dataLonga(resumo.proxima_visita)}</strong></> : 'A data aparece depois de salvar.'}
        </p>
      </section>

      <section className="mnt-card">
        <h2 className="mnt-h2">Conclusão</h2>
        {manual ? (
          <>
            <textarea className="mnt-input mnt-area" rows={8} maxLength={2000} aria-label="Conclusão do relatório"
              value={d.conclusao_manual || ''} onChange={(e) => mudarDados((x) => ({ ...x, conclusao_manual: e.target.value }))} />
            <button type="button" className="mnt-btn mnt-btnGhost" onClick={() => mudarDados((x) => ({ ...x, conclusao_manual: null }))}>
              Voltar à conclusão automática
            </button>
          </>
        ) : (
          <>
            <p className="mnt-conclusao">{resumo?.conclusao_sugerida || 'A conclusão automática aparece quando o relatório tem os dados do sistema.'}</p>
            <button type="button" className="mnt-btn mnt-btnGhost" disabled={!resumo?.conclusao_sugerida}
              onClick={() => mudarDados((x) => ({ ...x, conclusao_manual: resumo?.conclusao_sugerida || '' }))}>
              Editar conclusão
            </button>
          </>
        )}
      </section>
    </>
  );

  // ── Passo 5: assinaturas e concluir ──
  const passo5 = (
    <>
      <Assinatura
        rotulo="Assinatura do técnico"
        url={assinUrls.tecnico}
        nomeInicial={assinNomes.tecnico}
        registroInicial={assinNomes.registro}
        comRegistro
        onSalvar={(png, nome, reg) => salvarAssinatura('tecnico', png, nome, reg)}
        onRemover={() => removerAssinatura('tecnico')}
      />
      <Assinatura
        rotulo="Assinatura do cliente"
        aviso={AVISO_ASSINATURA_CLIENTE}
        url={assinUrls.cliente}
        nomeInicial={assinNomes.cliente}
        onSalvar={(png, nome) => salvarAssinatura('cliente', png, nome, '')}
        onRemover={() => removerAssinatura('cliente')}
      />

      <section className="mnt-card">
        {aviso && (
          <div className="mnt-aviso" role="alert">
            <strong>{faltam > 0 ? textoFaltam(faltam) : aviso}</strong>
            <span> {AVISO_SEM_STATUS}</span>
            <button type="button" className="mnt-btn mnt-btnGhost" onClick={() => irPara(1)}><ListChecks size={18} /> Ir para a inspeção</button>
          </div>
        )}
        <button type="button" className="mnt-btn mnt-btnPrimary mnt-btnGrande" disabled={concluindo || subindoFotos} onClick={concluir}>
          {subindoFotos
            ? <><span className="mnt-spin" aria-hidden /> Enviando fotos...</>
            : <><Check size={20} strokeWidth={2.6} /> {concluindo ? 'Concluindo...' : 'Concluir relatório'}</>}
        </button>
      </section>
    </>
  );

  const conteudo = [passo1, passo2, passo3, passo4, passo5][passo];

  return (
    <div className="mnt-page" ref={topoRef}>
      <div className="mnt-editorTopo">
        <button type="button" className="mnt-voltar" disabled={concluindo} onClick={sair}><ArrowLeft size={18} /> Relatórios</button>
        <Salvamento estado={salvar} onTentar={() => { void drenar(); }} />
      </div>
      <header className="mnt-cab">
        <p className="mnt-codigo">{codigoVisivel(linha.codigo)}</p>
        <h1 className="mnt-titulo">{form.clienteNome || 'Cliente sem nome'}</h1>
      </header>

      {/* Enquanto conclui, nada pode mudar: o PUT final e o POST de concluir já saíram com este estado. */}
      <fieldset className="mnt-fieldset" disabled={concluindo} aria-busy={concluindo}>
      <nav className="mnt-passos" aria-label="Etapas do relatório">
        {PASSOS.map((nome, i) => {
          const completa = completas[i];
          const faltando = i === 1 ? semStatus : 0;
          const estado = completa ? ', completa' : faltando > 0 ? `, ${faltando} ${faltando === 1 ? 'item sem status' : 'itens sem status'}` : '';
          return (
            <button key={nome} type="button" aria-current={i === passo ? 'step' : undefined} aria-label={`Etapa ${i + 1}: ${nome}${estado}`}
              className={`mnt-passo ${i === passo ? 'mnt-passoOn' : ''} ${completa ? 'mnt-passoFeito' : ''}`}
              onClick={() => irPara(i)}>
              <span className="mnt-passoNum">{completa ? <Check size={14} strokeWidth={3.2} /> : i + 1}</span>
              {faltando > 0 && <span className="mnt-passoFalta" aria-hidden>{faltando}</span>}
              <span className="mnt-passoNome">{nome}</span>
            </button>
          );
        })}
      </nav>
      <p className="mnt-passoAtual"><Wrench size={15} /> {passo + 1} de 5: {PASSOS[passo]}</p>

      {conteudo}

      {erroGeral && <p ref={erroRef} className="mnt-erro" role="alert">{erroGeral}</p>}

      <div className="mnt-nav">
        {passo > 0 && (
          <button type="button" className="mnt-btn mnt-btnGhost" onClick={() => irPara(passo - 1)}><ArrowLeft size={18} /> Voltar</button>
        )}
        {passo < 4 && (
          <button type="button" className="mnt-btn mnt-btnPrimary" onClick={() => irPara(passo + 1)}>Continuar <ArrowRight size={18} /></button>
        )}
      </div>
      {passo === 4 && (
        <button type="button" className="mnt-btn mnt-btnTexto mnt-excluir" disabled={ocupado} onClick={excluir}>
          <Trash2 size={17} /> Excluir relatório
        </button>
      )}
      </fieldset>
    </div>
  );
}
