'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Boxes, Plus, Trash2, Printer, ArrowDownCircle, ArrowUpCircle, X, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { CATALOGO, UNIDADES, MARCAS_COMUNS, ICONE_LOCAL_CUSTOM } from './catalogo';
import './inventario.css';

// Analytics de uso (mesma telemetria da calculadora — NÃO abate crédito).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'inventario', event_type }).catch(() => {});
}

const fmt = (n: number) =>
  'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nQtd = (n: number) => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// Parse tolerante a vírgula; vazio/NaN => 0.
const num = (v: string | number) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat((v || '').toString().replace(',', '.'));
  return isFinite(n) ? n : 0;
};

interface Item {
  id: string;
  local: string;
  nome: string;
  marca: string | null;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  estoque_minimo: number;
  ordem: number;
}

interface Company {
  nome?: string;
  cnpj?: string;
  logo_base64?: string | null;
  cidade?: string;
  whatsapp?: string;
}

const ICONE_LOCAL: Record<string, string> = Object.fromEntries(
  CATALOGO.map((l) => [l.local, l.icone]),
);

export default function InventarioPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [customLocais, setCustomLocais] = useState<string[]>([]);
  const [novoLocal, setNovoLocal] = useState('');
  const [outroDe, setOutroDe] = useState<string | null>(null); // local aguardando nome custom
  const [outroNome, setOutroNome] = useState('');
  const [mov, setMov] = useState<{ item: Item; tipo: 'entrada' | 'saida'; qtd: string; obs: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const openLogged = useRef(false);

  useEffect(() => {
    if (!openLogged.current) {
      openLogged.current = true;
      logUso('open');
    }
    (async () => {
      try {
        const [inv, comp] = await Promise.all([
          api.get('/inventory'),
          api.get('/company').catch(() => ({ data: { company: null } })),
        ]);
        setItems(inv.data.items ?? []);
        setCompany(comp.data.company ?? null);
      } catch {
        /* fail-silent: mantém vazio */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Locais exibidos: catálogo + locais custom (dos itens e criados na sessão) ──
  const locais = useMemo(() => {
    const catalogo = CATALOGO.map((l) => l.local);
    const dosItens = items.map((i) => i.local);
    const extras = [...dosItens, ...customLocais].filter((l) => !catalogo.includes(l));
    return [...catalogo, ...Array.from(new Set(extras))];
  }, [items, customLocais]);

  const porLocal = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const l of locais) map[l] = [];
    for (const i of items) {
      (map[i.local] ??= []).push(i);
    }
    return map;
  }, [items, locais]);

  const totalGeral = useMemo(
    () => items.reduce((s, i) => s + num(i.quantidade) * num(i.valor_unitario), 0),
    [items],
  );
  const subtotal = (local: string) =>
    (porLocal[local] || []).reduce((s, i) => s + num(i.quantidade) * num(i.valor_unitario), 0);

  const isBaixo = (i: Item) => num(i.estoque_minimo) > 0 && num(i.quantidade) <= num(i.estoque_minimo);
  const baixos = useMemo(() => items.filter(isBaixo), [items]);

  // ── Mutations ──
  const addItem = async (local: string, nome: string, unidade = 'un') => {
    setBusy(true);
    try {
      const { data } = await api.post('/inventory', { local, nome, unidade });
      setItems((prev) => [...prev, data.item]);
      logUso('add_item');
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  // Persiste um patch e sincroniza o item com o retorno do servidor.
  const patchItem = async (id: string, patch: Partial<Item>) => {
    try {
      const { data } = await api.put(`/inventory/${id}`, patch);
      setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    } catch {
      /* mantém o valor local */
    }
  };

  // Edita em memória (input controlado); persiste no blur/change.
  const editLocal = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await api.delete(`/inventory/${id}`);
    } catch {
      /* se falhar, o próximo reload corrige */
    }
  };

  const submitMov = async () => {
    if (!mov) return;
    const qtd = num(mov.qtd);
    if (qtd <= 0) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/inventory/${mov.item.id}/movement`, {
        tipo: mov.tipo,
        quantidade: qtd,
        observacao: mov.obs || undefined,
      });
      setItems((prev) => prev.map((i) => (i.id === data.item.id ? data.item : i)));
      logUso('movement');
      setMov(null);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Não foi possível registrar a movimentação.');
    } finally {
      setBusy(false);
    }
  };

  const addLocalCustom = () => {
    const nome = novoLocal.trim();
    if (!nome || locais.includes(nome)) {
      setNovoLocal('');
      return;
    }
    setCustomLocais((p) => [...p, nome]);
    setNovoLocal('');
  };

  const onSelectMaterial = (local: string, value: string) => {
    if (!value) return;
    if (value === '__outro__') {
      setOutroDe(local);
      setOutroNome('');
      return;
    }
    const mat = CATALOGO.find((l) => l.local === local)?.materiais.find((m) => m.nome === value);
    addItem(local, value, mat?.unidade || 'un');
  };

  const confirmarOutro = () => {
    const nome = outroNome.trim();
    if (nome && outroDe) addItem(outroDe, nome);
    setOutroDe(null);
    setOutroNome('');
  };

  const imprimir = () => {
    logUso('print');
    window.print();
  };

  const dataHoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="inv-wrap">
      {/* ══════════ TELA (interativa) ══════════ */}
      <div className="inv-screen">
        <header className="inv-hero">
          <div className="inv-hero-l">
            <div className="inv-hero-ic"><Boxes size={22} /></div>
            <div>
              <h1>Inventário</h1>
              <p>Controle de patrimônio, ferramentas e estoque da sua empresa</p>
            </div>
          </div>
          <div className="inv-hero-r">
            <div className="inv-total-card">
              <span className="cap">Patrimônio total</span>
              <strong>{fmt(totalGeral)}</strong>
            </div>
            <button className="inv-print-btn" onClick={imprimir} title="Imprimir / salvar PDF">
              <Printer size={17} /> Imprimir
            </button>
          </div>
        </header>

        {baixos.length > 0 && (
          <div className="inv-alert">
            <AlertTriangle size={18} />
            <span>
              <b>{baixos.length}</b> {baixos.length === 1 ? 'item atingiu' : 'itens atingiram'} o estoque mínimo — hora de repor.
            </span>
          </div>
        )}

        {loading ? (
          <div className="inv-loading">Carregando inventário…</div>
        ) : (
          <>
            {locais.map((local) => {
              const lista = porLocal[local] || [];
              const catMats = CATALOGO.find((l) => l.local === local)?.materiais || [];
              return (
                <section className="inv-card" key={local}>
                  <div className="inv-card-head">
                    <div className="inv-card-title">
                      <span className="inv-loc-ic">{ICONE_LOCAL[local] || ICONE_LOCAL_CUSTOM}</span>
                      {local}
                      <span className="inv-count">{lista.length}</span>
                    </div>
                    <div className="inv-card-sub">{fmt(subtotal(local))}</div>
                  </div>

                  {lista.length > 0 && (
                    <div className="inv-table">
                      <div className="inv-tr inv-th">
                        <span>Material</span>
                        <span>Marca</span>
                        <span className="r">Qtd</span>
                        <span className="r">Valor un.</span>
                        <span className="r">Total</span>
                        <span className="r">Mín.</span>
                        <span />
                      </div>
                      {lista.map((i) => (
                        <div className={`inv-tr${isBaixo(i) ? ' baixo' : ''}`} key={i.id}>
                          <span className="inv-nome" title={i.nome}>
                            {isBaixo(i) && <AlertTriangle size={13} className="inv-warn-ic" />}
                            {i.nome}
                          </span>
                          <span>
                            <input
                              className="inv-in inv-marca"
                              list="inv-marcas"
                              placeholder="—"
                              value={i.marca ?? ''}
                              onChange={(e) => editLocal(i.id, { marca: e.target.value })}
                              onBlur={(e) => patchItem(i.id, { marca: e.target.value || null })}
                            />
                          </span>
                          <span className="r inv-qtd-cell">
                            <input
                              className="inv-in num"
                              type="number"
                              inputMode="decimal"
                              value={i.quantidade ?? 0}
                              onChange={(e) => editLocal(i.id, { quantidade: num(e.target.value) })}
                              onBlur={(e) => patchItem(i.id, { quantidade: num(e.target.value) })}
                            />
                            <select
                              className="inv-un"
                              value={i.unidade}
                              onChange={(e) => { editLocal(i.id, { unidade: e.target.value }); patchItem(i.id, { unidade: e.target.value }); }}
                            >
                              {[...new Set([i.unidade, ...UNIDADES])].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </span>
                          <span className="r">
                            <input
                              className="inv-in num money"
                              type="number"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={i.valor_unitario ?? 0}
                              onChange={(e) => editLocal(i.id, { valor_unitario: num(e.target.value) })}
                              onBlur={(e) => patchItem(i.id, { valor_unitario: num(e.target.value) })}
                            />
                          </span>
                          <span className="r inv-line-total">
                            {fmt(num(i.quantidade) * num(i.valor_unitario))}
                          </span>
                          <span className="r">
                            <input
                              className="inv-in num min"
                              type="number"
                              inputMode="decimal"
                              placeholder="0"
                              value={i.estoque_minimo ?? 0}
                              onChange={(e) => editLocal(i.id, { estoque_minimo: num(e.target.value) })}
                              onBlur={(e) => patchItem(i.id, { estoque_minimo: num(e.target.value) })}
                            />
                          </span>
                          <span className="inv-actions">
                            <button title="Entrada" className="mv ent" onClick={() => setMov({ item: i, tipo: 'entrada', qtd: '', obs: '' })}>
                              <ArrowDownCircle size={17} />
                            </button>
                            <button title="Saída" className="mv sai" onClick={() => setMov({ item: i, tipo: 'saida', qtd: '', obs: '' })}>
                              <ArrowUpCircle size={17} />
                            </button>
                            <button title="Excluir" className="mv del" onClick={() => removeItem(i.id)}>
                              <Trash2 size={16} />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Adicionar material: a "seta" com a lista pronta do local */}
                  {outroDe === local ? (
                    <div className="inv-add-outro">
                      <input
                        autoFocus
                        className="inv-in"
                        placeholder={`Novo material em ${local}…`}
                        value={outroNome}
                        onChange={(e) => setOutroNome(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmarOutro()}
                      />
                      <button className="inv-add-ok" onClick={confirmarOutro} disabled={busy || !outroNome.trim()}>
                        <Plus size={16} /> Adicionar
                      </button>
                      <button className="inv-add-cancel" onClick={() => setOutroDe(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <div className="inv-add-row">
                      <Plus size={15} className="inv-add-ic" />
                      <select
                        className="inv-add-select"
                        value=""
                        disabled={busy}
                        onChange={(e) => { onSelectMaterial(local, e.target.value); e.target.value = ''; }}
                      >
                        <option value="">Adicionar material…</option>
                        {catMats.map((m) => (
                          <option key={m.nome} value={m.nome}>{m.nome}</option>
                        ))}
                        <option value="__outro__">Outro (digitar)…</option>
                      </select>
                    </div>
                  )}
                </section>
              );
            })}

            {/* Criar novo local */}
            <div className="inv-novo-local">
              <input
                className="inv-in"
                placeholder="Criar novo local (ex: Almoxarifado, Obra X)…"
                value={novoLocal}
                onChange={(e) => setNovoLocal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLocalCustom()}
              />
              <button className="inv-add-ok" onClick={addLocalCustom} disabled={!novoLocal.trim()}>
                <Plus size={16} /> Criar local
              </button>
            </div>
          </>
        )}

        <datalist id="inv-marcas">
          {MARCAS_COMUNS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {/* ══════════ BLOCO DE IMPRESSÃO (só no print) ══════════ */}
      <div className="inv-print-area">
        <div className="inv-print-head">
          {company?.logo_base64 && <img src={company.logo_base64} alt="" className="inv-print-logo" />}
          <div>
            <h2>{company?.nome || 'Inventário da empresa'}</h2>
            <p>
              {company?.cnpj ? `CNPJ ${company.cnpj} · ` : ''}
              Inventário emitido em {dataHoje}
            </p>
          </div>
          <div className="inv-print-total">
            <span>Patrimônio total</span>
            <strong>{fmt(totalGeral)}</strong>
          </div>
        </div>

        {locais.filter((l) => (porLocal[l] || []).length > 0).map((local) => (
          <div className="inv-print-sec" key={local}>
            <h3>{ICONE_LOCAL[local] || ''} {local} <span>{fmt(subtotal(local))}</span></h3>
            <table>
              <thead>
                <tr>
                  <th>Material</th><th>Marca</th><th className="r">Qtd</th>
                  <th className="r">Valor un.</th><th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {(porLocal[local] || []).map((i) => (
                  <tr key={i.id}>
                    <td>{i.nome}</td>
                    <td>{i.marca || '—'}</td>
                    <td className="r">{nQtd(i.quantidade)} {i.unidade}</td>
                    <td className="r">{fmt(i.valor_unitario)}</td>
                    <td className="r">{fmt(num(i.quantidade) * num(i.valor_unitario))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="inv-print-foot">Gerado por SolarDoc Pro · solardoc.app</div>
      </div>

      {/* ══════════ MODAL DE MOVIMENTAÇÃO ══════════ */}
      {mov && (
        <div className="inv-modal-bg" onClick={() => setMov(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <button className="inv-modal-x" onClick={() => setMov(null)}><X size={18} /></button>
            <h3>{mov.tipo === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}</h3>
            <p className="inv-modal-item">{mov.item.nome} · saldo atual {nQtd(mov.item.quantidade)} {mov.item.unidade}</p>
            <div className="inv-modal-toggle">
              <button className={mov.tipo === 'entrada' ? 'on' : ''} onClick={() => setMov({ ...mov, tipo: 'entrada' })}>
                <ArrowDownCircle size={16} /> Entrada
              </button>
              <button className={mov.tipo === 'saida' ? 'on' : ''} onClick={() => setMov({ ...mov, tipo: 'saida' })}>
                <ArrowUpCircle size={16} /> Saída
              </button>
            </div>
            <label className="inv-modal-lbl">Quantidade</label>
            <input
              autoFocus
              className="inv-in"
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={mov.qtd}
              onChange={(e) => setMov({ ...mov, qtd: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submitMov()}
            />
            <label className="inv-modal-lbl">Observação (opcional)</label>
            <input
              className="inv-in"
              placeholder="Ex: obra do João, compra fornecedor…"
              value={mov.obs}
              onChange={(e) => setMov({ ...mov, obs: e.target.value })}
            />
            <button className={`inv-modal-go ${mov.tipo}`} onClick={submitMov} disabled={busy || num(mov.qtd) <= 0}>
              Confirmar {mov.tipo === 'entrada' ? 'entrada' : 'saída'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
