'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Plus, Printer, Search, ChevronDown, ShoppingCart, Sparkles, X } from 'lucide-react';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import Cadeado from '@/components/Cadeado/Cadeado';
import ConfirmarExclusao from '@/components/ConfirmarExclusao/ConfirmarExclusao';
import Skeleton from '@/components/Skeleton/Skeleton';
import { formatarQuantidade } from '@/lib/estoque/numero';
import { faltaRepor, normaliza, valorDoItem } from '@/lib/estoque/regras';
import { CATALOGO, MARCAS_COMUNS } from './catalogo';
import { ICONE_LOCAL, iconeDoMaterial, Tomada } from './icones';
import { KIT_INICIAL } from './kitInicial';
import { msgErro, type Item, type TipoMov } from './tipos';
import FolhaItem from './_componentes/FolhaItem';
import QuadroMovimento from './_componentes/QuadroMovimento';
import ListaCompra from './_componentes/ListaCompra';
import NovoItem, { type DadosNovoItem } from './_componentes/NovoItem';
import Folha from './_componentes/Folha';
import './inventario.css';

// Analytics de uso (mesma telemetria da calculadora, não abate crédito).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'inventario', event_type }).catch(() => {});
}

const fmt = (n: number) =>
  'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nQtd = (n: number) => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

interface Company {
  nome?: string;
  cnpj?: string;
  logo_base64?: string | null;
}

interface Aviso {
  tipo: 'erro' | 'ok';
  texto: string;
  desfazer?: () => void;
}

const MS_DESFAZER = 6000;
const LOCAIS_CATALOGO = CATALOGO.map((l) => l.local);

function InventarioPageInterna() {
  const [items, setItems] = useState<Item[]>([]);
  // 'carregando' | 'ok' | 'erro'. O kit de exemplo só é oferecido com 'ok' e lista vazia.
  const [status, setStatus] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [company, setCompany] = useState<Company | null>(null);
  // /company falhou (rede ou servidor): o PDF sairia sem logo e sem dados da empresa, então avisamos antes de imprimir.
  const [empresaFalhou, setEmpresaFalhou] = useState(false);
  const [pdfAviso, setPdfAviso] = useState<{ tentando: boolean; ainda: boolean } | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [semeando, setSemeando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<string>('todos'); // 'todos' | 'repor' | nome do local
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [mov, setMov] = useState<{ id: string; tipo: TipoMov } | null>(null);
  const [listaAberta, setListaAberta] = useState(false);
  const [novo, setNovo] = useState<{ local?: string } | null>(null);
  const [aRemover, setARemover] = useState<Item | null>(null);

  const itemsRef = useRef<Item[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendente = useRef<{ item: Item; timer: ReturnType<typeof setTimeout> } | null>(null);
  const openLogged = useRef(false);

  // ── Aviso na página (no lugar do alert do navegador) ──
  const mostrar = useCallback((a: Aviso, ms = 5000) => {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso(a);
    avisoTimer.current = setTimeout(() => setAviso(null), a.tipo === 'erro' ? Math.max(ms, 8000) : ms);
  }, []);
  const fecharAviso = () => {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso(null);
  };

  // ── Carga ──
  const [tentativa, setTentativa] = useState(0);
  const carregar = () => {
    setStatus('carregando');
    setTentativa((t) => t + 1);
  };

  useEffect(() => {
    if (!openLogged.current) {
      openLogged.current = true;
      logUso('open');
    }
    let vivo = true;
    (async () => {
      try {
        let falhouEmpresa = false;
        const [inv, comp] = await Promise.all([
          api.get('/inventory'),
          api.get('/company').catch(() => { falhouEmpresa = true; return { data: { company: null } }; }),
        ]);
        if (!vivo) return;
        setItems(inv.data.items ?? []);
        setCompany(comp.data.company ?? null);
        setEmpresaFalhou(falhouEmpresa);
        setStatus('ok');
      } catch {
        if (vivo) setStatus('erro');
      }
    })();
    return () => { vivo = false; };
  }, [tentativa]);

  // ── Remoção com "Desfazer": o DELETE só sai depois do prazo ──
  const executarRemocao = useCallback(async (item: Item) => {
    pendente.current = null;
    try {
      await api.delete(`/inventory/${item.id}`);
    } catch (e) {
      const status404 = (e as { response?: { status?: number } })?.response?.status === 404;
      if (status404) return; // já não existia: o resultado é o mesmo
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
      mostrar({ tipo: 'erro', texto: `Não deu para tirar ${item.nome} do estoque. Ele voltou para a lista.` });
    }
  }, [mostrar]);

  const executarPendenteJa = useCallback(() => {
    const p = pendente.current;
    if (!p) return;
    clearTimeout(p.timer);
    void executarRemocao(p.item);
  }, [executarRemocao]);

  // Saiu da tela dentro do prazo: quem confirmou "Tirar" espera o item apagado, então apaga agora.
  useEffect(() => () => executarPendenteJa(), [executarPendenteJa]);

  // Fechou a aba ou o navegador dentro do prazo: a requisição do axios morreria junto com a página,
  // então o DELETE pendente sai por fetch com keepalive (mesma URL, mesmo token).
  useEffect(() => {
    const aoSair = () => {
      const p = pendente.current;
      if (!p) return;
      clearTimeout(p.timer);
      pendente.current = null;
      const token = getToken();
      try {
        void fetch(`${api.defaults.baseURL ?? ''}/inventory/${p.item.id}`, {
          method: 'DELETE',
          keepalive: true,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch { /* sem rede: o item continua no estoque, que é o lado seguro */ }
    };
    window.addEventListener('pagehide', aoSair);
    window.addEventListener('beforeunload', aoSair);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      window.removeEventListener('beforeunload', aoSair);
    };
  }, []);

  const agendarRemocao = (item: Item) => {
    executarPendenteJa();
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const timer = setTimeout(() => { void executarRemocao(item); }, MS_DESFAZER);
    pendente.current = { item, timer };
    logUso('remove_item');
    mostrar(
      {
        tipo: 'ok',
        texto: `${item.nome} saiu do estoque.`,
        desfazer: () => {
          const p = pendente.current;
          if (!p || p.item.id !== item.id) return;
          clearTimeout(p.timer);
          pendente.current = null;
          setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
          mostrar({ tipo: 'ok', texto: `${item.nome} voltou para o estoque.` }, 3000);
        },
      },
      MS_DESFAZER,
    );
  };

  // ── Alterar um item: valor novo na tela na hora; se o servidor recusar, volta ao anterior e avisa ──
  const patchItem = async (id: string, patch: Partial<Item>, avisoOk?: string): Promise<boolean> => {
    const antes = itemsRef.current.find((i) => i.id === id);
    if (!antes) return false;
    const chaves = Object.keys(patch) as (keyof Item)[];
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    try {
      const { data } = await api.put(`/inventory/${id}`, patch);
      setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
      if (avisoOk) mostrar({ tipo: 'ok', texto: avisoOk }, 3500);
      return true;
    } catch {
      const volta: Partial<Item> = {};
      for (const k of chaves) (volta as Record<string, unknown>)[k] = antes[k];
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...volta } : i)));
      mostrar({ tipo: 'erro', texto: `Não deu para salvar a alteração em ${antes.nome}. O valor anterior foi mantido.` });
      return false;
    }
  };

  const valorInvalido = () =>
    mostrar({ tipo: 'erro', texto: 'Esse campo não pode ficar vazio. Em número, use só dígitos, por exemplo 1.500 ou 1,5.' });

  // ── Cadastrar ──
  const criarItem = async (d: DadosNovoItem): Promise<string | null> => {
    const { quantidade, ...resto } = d;
    try {
      const { data } = await api.post('/inventory', resto);
      let item: Item = data.item;
      logUso('add_item');
      let msg = `${item.nome} entrou em ${item.local}.`;
      let tipo: Aviso['tipo'] = 'ok';
      // O saldo inicial entra como movimento, para o histórico começar certo.
      if (quantidade && quantidade > 0) {
        try {
          const r = await api.post(`/inventory/${item.id}/movement`, { tipo: 'entrada', quantidade, observacao: 'Saldo inicial' });
          item = r.data.item;
        } catch {
          tipo = 'erro';
          msg = `${item.nome} foi cadastrado, mas a quantidade não entrou. Use "Chegou" para lançar.`;
        }
      }
      setItems((prev) => [...prev, item]);
      setNovo(null);
      mostrar({ tipo, texto: msg });
      return null;
    } catch (e) {
      return msgErro(e, 'Não deu para cadastrar. Confira a internet e tente de novo.');
    }
  };

  const semearKit = async () => {
    if (semeando || status !== 'ok' || itemsRef.current.length > 0) return;
    setSemeando(true);
    const criados: Item[] = [];
    for (const k of KIT_INICIAL) {
      try {
        const { data } = await api.post('/inventory', k);
        if (data?.item) criados.push(data.item);
      } catch { /* conta no total de falhas abaixo */ }
    }
    if (criados.length) setItems((prev) => [...prev, ...criados]);
    logUso('kit_inicial');
    setSemeando(false);
    const falhas = KIT_INICIAL.length - criados.length;
    if (falhas === KIT_INICIAL.length) {
      mostrar({ tipo: 'erro', texto: 'Não deu para montar o exemplo. Confira a internet e tente de novo.' });
    } else if (falhas > 0) {
      mostrar({ tipo: 'erro', texto: `${falhas} de ${KIT_INICIAL.length} itens do exemplo não entraram. Cadastre os que faltarem.` });
    } else {
      mostrar({ tipo: 'ok', texto: `${criados.length} itens de exemplo montados. Troque pelos seus valores.` });
    }
  };

  // ── Derivados ──
  const locais = useMemo(() => {
    const extras = Array.from(new Set(items.map((i) => i.local))).filter((l) => !LOCAIS_CATALOGO.includes(l));
    extras.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return [...LOCAIS_CATALOGO, ...extras];
  }, [items]);

  const ordenados = useMemo(() => {
    const pos = (l: string) => locais.indexOf(l);
    return [...items].sort(
      (a, b) =>
        pos(a.local) - pos(b.local) ||
        (a.ordem ?? 0) - (b.ordem ?? 0) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }, [items, locais]);

  const baixos = useMemo(() => ordenados.filter(faltaRepor), [ordenados]);
  const totalGeral = useMemo(() => items.reduce((s, i) => s + valorDoItem(i), 0), [items]);
  const locaisComItem = useMemo(() => locais.filter((l) => items.some((i) => i.local === l)), [locais, items]);
  const filtroAtivo = filtro === 'todos' || filtro === 'repor' || locaisComItem.includes(filtro) ? filtro : 'todos';

  const visiveis = useMemo(() => {
    const termo = normaliza(busca);
    return ordenados.filter((i) => {
      if (filtroAtivo === 'repor' && !faltaRepor(i)) return false;
      if (filtroAtivo !== 'todos' && filtroAtivo !== 'repor' && i.local !== filtroAtivo) return false;
      if (termo && !normaliza(i.nome).includes(termo) && !normaliza(i.marca ?? '').includes(termo)) return false;
      return true;
    });
  }, [ordenados, busca, filtroAtivo]);

  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of visiveis) (m.get(i.local) ?? m.set(i.local, []).get(i.local)!).push(i);
    return Array.from(m.entries());
  }, [visiveis]);

  const filtrando = busca.trim() !== '' || filtroAtivo !== 'todos';
  const itemAberto = abertoId ? items.find((i) => i.id === abertoId) ?? null : null;
  const itemMov = mov ? items.find((i) => i.id === mov.id) ?? null : null;

  const alternarLocal = (l: string) =>
    setFechados((p) => {
      const n = new Set(p);
      if (n.has(l)) n.delete(l); else n.add(l);
      return n;
    });

  const imprimirAgora = () => {
    logUso('print');
    window.print();
  };
  const imprimir = () => {
    if (empresaFalhou) { setPdfAviso({ tentando: false, ainda: false }); return; }
    imprimirAgora();
  };
  const tentarEmpresaDeNovo = async () => {
    setPdfAviso({ tentando: true, ainda: false });
    try {
      const { data } = await api.get('/company');
      setCompany(data.company ?? null);
      setEmpresaFalhou(false);
      setPdfAviso(null);
      // Espera a área de impressão redesenhar com a logo antes de abrir o PDF.
      setTimeout(imprimirAgora, 150);
    } catch {
      setPdfAviso({ tentando: false, ainda: true });
    }
  };

  const abrirLista = () => {
    logUso('lista_compra');
    setListaAberta(true);
  };

  const dataHoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const vazioDeVerdade = status === 'ok' && items.length === 0;

  return (
    <div className="est-wrap">
      {/* ══════════ TELA ══════════ */}
      <div className="est-screen">
        <header className="est-hero">
          <div className="est-hero-txt">
            <h1>Estoque em Dia</h1>
            <p>Tudo o que a sua equipe tem, onde está e o que falta.</p>
          </div>
          {status === 'ok' && (
            <div className="est-hero-num" aria-label="Resumo do estoque">
              <div><span>Patrimônio</span><strong>{fmt(totalGeral)}</strong></div>
              <div><span>Itens</span><strong>{items.length}</strong></div>
            </div>
          )}
          {status === 'ok' && !vazioDeVerdade && (
            <div className="est-hero-bt">
              <button type="button" className="est-btn" onClick={() => setNovo({})}>
                <Plus size={18} /> Cadastrar item
              </button>
              <button type="button" className="est-btn-sec" onClick={imprimir} aria-label="Gerar PDF do estoque">
                <Printer size={17} /> PDF
              </button>
            </div>
          )}
        </header>

        {status === 'carregando' && (
          <div className="est-carregando" role="status" aria-label="Carregando o seu estoque">
            <Skeleton height={52} radius={12} />
            <Skeleton height={44} radius={12} />
            <div className="est-locais">
              <Skeleton height={170} radius={12} />
              <Skeleton height={170} radius={12} />
            </div>
          </div>
        )}

        {status === 'erro' && (
          <div className="est-falha" role="alert">
            <strong>Não deu para carregar o seu estoque.</strong>
            <span>Seus itens estão guardados. Confira a internet e tente de novo.</span>
            <button type="button" className="est-btn" onClick={carregar}>Tentar de novo</button>
          </div>
        )}

        {vazioDeVerdade && (
          <section className="est-primeiro">
            <h2>Comece em um minuto</h2>
            <p>Monte com itens de exemplo e troque pelos seus valores, ou cadastre o seu primeiro item.</p>
            <div className="est-dois">
              <button type="button" className="est-btn" onClick={semearKit} disabled={semeando}>
                <Sparkles size={17} /> {semeando ? 'Montando...' : `Montar com ${KIT_INICIAL.length} itens de exemplo`}
              </button>
              <button type="button" className="est-btn-sec" onClick={() => setNovo({})} disabled={semeando}>
                Cadastrar um item
              </button>
            </div>
            <ol className="est-passos">
              <li>Cadastre o item e diga onde ele está.</li>
              <li>Toque em Saiu ou Chegou quando ele mexer.</li>
              <li>Defina o mínimo e veja a lista de compra.</li>
            </ol>
          </section>
        )}

        {status === 'ok' && !vazioDeVerdade && (
          <>
            {baixos.length > 0 && (
              <div className="est-faixa" role="status">
                <span>
                  <b>{baixos.length}</b> {baixos.length === 1 ? 'item no mínimo' : 'itens no mínimo'}.
                </span>
                <button type="button" className="est-btn-faixa" onClick={abrirLista}>
                  <ShoppingCart size={16} /> Ver lista de compra
                </button>
              </div>
            )}

            <div className="est-busca">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label="Buscar item"
                placeholder="Buscar item"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {busca && (
                <button type="button" className="est-busca-x" onClick={() => setBusca('')} aria-label="Limpar a busca">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="est-chips" role="group" aria-label="Filtrar por local">
              <button type="button" className={`est-chip${filtroAtivo === 'todos' ? ' on' : ''}`} aria-pressed={filtroAtivo === 'todos'} onClick={() => setFiltro('todos')}>
                Todos
              </button>
              <button type="button" className={`est-chip${filtroAtivo === 'repor' ? ' on' : ''}`} aria-pressed={filtroAtivo === 'repor'} onClick={() => setFiltro('repor')}>
                Falta repor{baixos.length > 0 ? ` (${baixos.length})` : ''}
              </button>
              {locaisComItem.map((l) => (
                <button key={l} type="button" className={`est-chip${filtroAtivo === l ? ' on' : ''}`} aria-pressed={filtroAtivo === l} onClick={() => setFiltro(l)}>
                  {l}
                </button>
              ))}
            </div>

            {grupos.length === 0 ? (
              <div className="est-vazio-filtro">
                <p>Nenhum item encontrado.</p>
                <button type="button" className="est-btn-sec" onClick={() => { setBusca(''); setFiltro('todos'); }}>
                  Limpar busca e filtros
                </button>
              </div>
            ) : (
              <div className="est-locais">
                {grupos.map(([local, lista]) => {
                  const aberto = filtrando || !fechados.has(local);
                  const Icone = ICONE_LOCAL[local] ?? Tomada;
                  const subtotal = lista.reduce((s, i) => s + valorDoItem(i), 0);
                  return (
                    <section className="est-local" key={local}>
                      <button
                        type="button"
                        className="est-local-topo"
                        aria-expanded={aberto}
                        onClick={() => alternarLocal(local)}
                      >
                        <Icone size={20} className="est-local-ic" />
                        <span className="est-local-nome">
                          <strong>{local}</strong>
                          <em>{lista.length === 1 ? '1 item' : `${lista.length} itens`} · {fmt(subtotal)}</em>
                        </span>
                        <ChevronDown size={18} className={`est-chev${aberto ? ' on' : ''}`} aria-hidden="true" />
                      </button>

                      {aberto && (
                        <>
                          <ul className="est-itens">
                            {lista.map((i) => {
                              const IconeItem = iconeDoMaterial(i.nome, local);
                              const baixo = faltaRepor(i);
                              return (
                                <li className={`est-item${baixo ? ' baixo' : ''}`} key={i.id}>
                                  <button type="button" className="est-item-abre" onClick={() => setAbertoId(i.id)} aria-label={`Abrir detalhes de ${i.nome}`}>
                                    <IconeItem size={20} className="est-item-ic" />
                                    <span className="est-item-txt">
                                      <strong>{i.nome}</strong>
                                      <em>
                                        {nQtd(Number(i.quantidade))} {i.unidade}
                                        {baixo && <span className="est-selo">Falta repor</span>}
                                      </em>
                                    </span>
                                  </button>
                                  <div className="est-item-bt">
                                    <button type="button" className="est-mv" aria-label={`Saiu: registrar saída de ${i.nome}`} onClick={() => setMov({ id: i.id, tipo: 'saida' })}>
                                      Saiu
                                    </button>
                                    <button type="button" className="est-mv" aria-label={`Chegou: registrar chegada de ${i.nome}`} onClick={() => setMov({ id: i.id, tipo: 'entrada' })}>
                                      Chegou
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          <button type="button" className="est-add-local" onClick={() => setNovo({ local })}>
                            <Plus size={16} /> Adicionar em {local}
                          </button>
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}

        <datalist id="est-marcas">
          {MARCAS_COMUNS.map((m) => <option key={m} value={m} />)}
        </datalist>
        <datalist id="est-locais">
          {locais.map((l) => <option key={l} value={l} />)}
        </datalist>
      </div>

      {/* ══════════ BLOCO DE IMPRESSÃO (só no PDF) ══════════ */}
      <div className="est-print-area">
        <div className="est-print-head">
          {company?.logo_base64 && <img src={company.logo_base64} alt="" className="est-print-logo" />}
          <div>
            <h2>{company?.nome || 'Estoque da empresa'}</h2>
            <p>
              {company?.cnpj ? `CNPJ ${company.cnpj} · ` : ''}
              Estoque emitido em {dataHoje}
            </p>
          </div>
          <div className="est-print-total">
            <span>Patrimônio total</span>
            <strong>{fmt(totalGeral)}</strong>
          </div>
        </div>

        {locais.filter((l) => ordenados.some((i) => i.local === l)).map((local) => {
          const lista = ordenados.filter((i) => i.local === local);
          return (
            <div className="est-print-sec" key={local}>
              <h3>{local} <span>{fmt(lista.reduce((s, i) => s + valorDoItem(i), 0))}</span></h3>
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Marca</th><th className="r">Qtd</th>
                    <th className="r">Valor un.</th><th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((i) => (
                    <tr key={i.id}>
                      <td>{i.nome}</td>
                      <td>{i.marca || 'Sem marca'}</td>
                      <td className="r">{nQtd(Number(i.quantidade))} {i.unidade}</td>
                      <td className="r">{fmt(Number(i.valor_unitario))}</td>
                      <td className="r">{fmt(valorDoItem(i))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <div className="est-print-foot">Gerado por SolarDoc Pro · solardoc.app</div>
      </div>

      {/* ══════════ JANELAS ══════════ */}
      {itemAberto && (
        <FolhaItem
          item={itemAberto}
          onFechar={() => setAbertoId(null)}
          onSalvar={(patch, ok) => patchItem(itemAberto.id, patch, ok)}
          onMovimento={(tipo) => setMov({ id: itemAberto.id, tipo })}
          onRemover={() => setARemover(itemAberto)}
          onValorInvalido={valorInvalido}
        />
      )}

      {itemMov && mov && (
        <QuadroMovimento
          key={`${itemMov.id}-${mov.tipo}`}
          item={itemMov}
          tipoInicial={mov.tipo}
          onFechar={() => setMov(null)}
          onFeito={(atualizado) => {
            setItems((prev) => prev.map((i) => (i.id === atualizado.id ? atualizado : i)));
            logUso('movement');
            setMov(null);
            mostrar({ tipo: 'ok', texto: `${atualizado.nome}: agora são ${formatarQuantidade(Number(atualizado.quantidade))} ${atualizado.unidade}.` }, 3500);
          }}
        />
      )}

      {pdfAviso && (
        <Folha titulo="PDF sem os dados da empresa" onFechar={() => { if (!pdfAviso.tentando) setPdfAviso(null); }}>
          <p className="est-dica">Não deu para carregar a logo e os dados da empresa. O PDF vai sair sem eles.</p>
          {pdfAviso.ainda && (
            <p className="est-erro-linha" role="alert">Ainda não deu. Tente de novo ou imprima assim mesmo.</p>
          )}
          <div className="est-dois">
            <button type="button" className="est-btn" onClick={tentarEmpresaDeNovo} disabled={pdfAviso.tentando}>
              {pdfAviso.tentando ? 'Tentando...' : 'Tentar de novo'}
            </button>
            <button
              type="button"
              className="est-btn-sec"
              disabled={pdfAviso.tentando}
              onClick={() => { setPdfAviso(null); setTimeout(imprimirAgora, 150); }}
            >
              Imprimir assim mesmo
            </button>
          </div>
        </Folha>
      )}

      {listaAberta && <ListaCompra itens={baixos} empresa={company?.nome} onFechar={() => setListaAberta(false)} />}

      {novo && (
        <NovoItem
          locais={locais}
          localInicial={novo.local}
          onFechar={() => setNovo(null)}
          onCriar={criarItem}
        />
      )}

      <ConfirmarExclusao
        aberto={!!aRemover}
        titulo="Tirar do estoque?"
        resumo={aRemover ? <strong>{aRemover.nome}</strong> : null}
        avisos={[
          'O item sai da lista e do patrimônio.',
          'Você tem alguns segundos para desfazer no aviso de baixo.',
        ]}
        onConfirmar={async () => {
          if (aRemover) agendarRemocao(aRemover);
          setARemover(null);
          setAbertoId(null);
        }}
        onFechar={() => setARemover(null)}
      />

      {aviso && (
        <div className={`est-aviso ${aviso.tipo}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
          <span>{aviso.texto}</span>
          {aviso.desfazer && (
            <button type="button" className="est-aviso-bt" onClick={() => { aviso.desfazer?.(); }}>
              Desfazer
            </button>
          )}
          <button type="button" className="est-aviso-x" onClick={fecharAviso} aria-label="Fechar o aviso">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A ferramenta virou produto: quem não comprou (nem tem pela assinatura) vê o
 * convite, não uma tela vazia. Quem já usava antes de virar paga continua com
 * acesso enquanto a conta existir (backfill em MIGRATION_entitlements.sql).
 */
export default function InventarioPage() {
  return (
    <Cadeado produto="inventario">
      <InventarioPageInterna />
    </Cadeado>
  );
}
