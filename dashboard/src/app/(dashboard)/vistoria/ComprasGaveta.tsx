'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Gaveta, estilos as e } from '@/components/AreaTrabalho/AreaTrabalho';
import { parseNumero } from '../manutencao/Campos';
import { CATALOGO, CATEGORIAS, OBSERVACOES_PRONTAS } from './catalogoCompras';
import { TEXTOS_COMPRAS as T } from './comprasTextos';
import {
  atualizarLinha, buscar, criarId, itemQueDispara, lerQtd, limparTexto, linhaDoCatalogo, linhaLivre, linhaNota,
  loteDeSugeridas, sugerir, sugestoesDoItem, textoCliente, textoFornecedor,
} from './comprasPuro';
import {
  ABREV_UNIDADE, CHAVES_ITENS, LIMITES, QUEM, ROTULO_ITEM, ROTULO_QUEM, ROTULO_STATUS, ROTULO_UNIDADE, UNIDADES,
  type EntradaCatalogo, type LinhaCompra, type MapaStatus, type Quem, type Unidade,
} from './comprasTipos';
import { ControleQtd, textoDaSituacao } from './Compras';
import { preencher, type ResultadoAdicao, type SessaoCompras, type UsoCompras } from './useCompras';

// A folha da lista de compras (seção 7.6 do plano): sugestões de um item, todas as sugestões, busca, material fora
// do catálogo, observações, edição de uma linha e o texto para o WhatsApp. Usa a `Gaveta` do app SEM alterá-la.
//
// A `Gaveta` foca o PRIMEIRO input, select ou textarea quando abre (e senão o primeiro botão). Por isso as vistas de
// lista não têm nenhum campo na primeira renderização: o teclado cobriria a lista no celular. A busca e a escrita
// de uma observação só ganham o campo depois do toque.
//
// Cada toque em "Adicionar" já grava (o useCompras envia); "Pronto" só fecha a folha.

export type VistaFolha = 'item' | 'todas' | 'buscar' | 'livre' | 'obs' | 'editar' | 'texto';

export interface AberturaFolha {
  /** Muda a cada abertura de fora. É a `key` do conteúdo, então cada abertura começa do zero. */
  seq: number;
  vista: VistaFolha;
  /** Chave do item da vistoria (vista `item`). */
  item?: string;
  /** Id da linha (vista `editar`). */
  id?: string;
}

/** Troca de vista de dentro da folha. `nome` pré-preenche o material fora da lista. */
export interface MudancaVista {
  vista: VistaFolha;
  item?: string;
  id?: string;
  nome?: string;
}

interface Contexto {
  compras: UsoCompras;
  sessao: SessaoCompras;
  statusItens: MapaStatus;
  aoLogar: (tipo: string) => void;
  aoFechar: () => void;
  irPara: (m: MudancaVista) => void;
}

// ---------------------------------------------------------------------------------------------------------
// Rascunhos dos formulários (ficam na folha: fechar e reabrir restaura)
// ---------------------------------------------------------------------------------------------------------

interface Rascunho {
  nome: string;
  esp: string;
  /** Texto digitado; vazio quer dizer "a definir". */
  qtd: string;
  un: Unidade;
  quem: Quem;
  /** Chave do item da vistoria, ou '' para nenhum. */
  item: string;
  /** Nota da linha (material) ou o texto da observação. */
  obs: string;
}

const RASCUNHO_VAZIO: Rascunho = { nome: '', esp: '', qtd: '', un: 'un', quem: 'a_definir', item: '', obs: '' };

function rascunhoDaLinha(l: LinhaCompra): Rascunho {
  return {
    nome: l.nome ?? '',
    esp: l.esp ?? '',
    qtd: l.qtd == null ? '' : String(l.qtd).replace('.', ','),
    un: l.un ?? 'un',
    quem: l.quem ?? 'a_definir',
    item: l.item ?? '',
    obs: l.obs ?? '',
  };
}

/** Quantidade digitada: vazia e serviço dão "a definir" (null); inválida ou zero barra o envio. */
function lerQtdRascunho(r: Rascunho): { ok: boolean; qtd: number | null } {
  if (r.un === 'servico' || !r.qtd.trim()) return { ok: true, qtd: null };
  const v = lerQtd(parseNumero(r.qtd, true));
  return v === null ? { ok: false, qtd: null } : { ok: true, qtd: v };
}

// ---------------------------------------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------------------------------------

function pararTimer(timer: { current: ReturnType<typeof setTimeout> | null }) {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
}

interface Aviso { texto: string; desfazer?: () => void }

/** Aviso curto da folha, por 6 s, com "Desfazer" quando houver. */
function useAviso(): { aviso: Aviso | null; mostrar: (texto: string, desfazer?: () => void) => void } {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => pararTimer(timer), []);

  const mostrar = useCallback((texto: string, desfazer?: () => void) => {
    pararTimer(timer);
    setAviso({
      texto,
      desfazer: desfazer ? () => { desfazer(); pararTimer(timer); setAviso(null); } : undefined,
    });
    timer.current = setTimeout(() => { timer.current = null; setAviso(null); }, 6000);
  }, []);

  return { aviso, mostrar };
}

function BarraAviso({ aviso }: { aviso: Aviso | null }) {
  return (
    <div className="vst-cmpAviso" role="status" aria-live="polite">
      {aviso && (
        <>
          <span>{aviso.texto}</span>
          {aviso.desfazer && <button type="button" className="vst-cmpLink" onClick={aviso.desfazer}>{T.desfazer}</button>}
        </>
      )}
    </div>
  );
}

/**
 * "Pronto" (ou "Pronto, 3 na lista"): sempre à vista no pé da folha. Quando a lista NÃO está indo para o servidor (sem
 * conexão, erro ao salvar ou vistoria concluída em outro aparelho) o pé também diz isso: a seção que traz o aviso e o
 * ponto da pílula ficam atrás da folha no celular, e quem adiciona vários materiais não veria nada.
 */
function Rodape({ compras, aoFechar }: { compras: UsoCompras; aoFechar: () => void }) {
  const total = compras.estado.linhas.length;
  const situacao = compras.situacao;
  const problema = situacao === 'sem_rede' || situacao === 'erro' || situacao === 'conflito';
  return (
    <div className="vst-cmpRodape">
      {problema && <p className={`vst-cmpRodapeEstado vst-cmpEstado-${situacao}`} role="status">{textoDaSituacao(compras)}</p>}
      <button type="button" className={e.btnPrim} onClick={aoFechar}>
        {total > 0 ? preencher(T.prontoN, { n: total }) : T.pronto}
      </button>
    </div>
  );
}

function EntradaLinha({
  entrada, linha, aoAdicionar, aoQtd,
}: {
  entrada: EntradaCatalogo;
  /** A linha da lista que veio desta entrada (mesmo cid), se já foi adicionada. */
  linha?: LinhaCompra;
  aoAdicionar: () => void;
  aoQtd: (id: string, qtd: number) => void;
}) {
  return (
    <li className="vst-cmpEntrada">
      <div className="vst-cmpTexto">
        <strong className="vst-cmpNome">{entrada.nome}</strong>
        <span className="vst-cmpRotulos">{ABREV_UNIDADE[entrada.un]} · {ROTULO_QUEM[entrada.quem]}</span>
        <span className="vst-cmpEsp">{entrada.esp}</span>
      </div>
      <div className="vst-cmpEntradaAcao">
        {!linha ? (
          <button type="button" className={e.btnSec} onClick={aoAdicionar}>{T.adicionar}</button>
        ) : entrada.un === 'servico' ? (
          <span className="vst-cmpNaListaTag"><Check size={16} aria-hidden="true" /> Na lista</span>
        ) : (
          <ControleQtd nome={entrada.nome} qtd={linha.qtd ?? null} un={entrada.un} aoMudar={(q) => aoQtd(linha.id, q)} />
        )}
      </div>
    </li>
  );
}

interface EntradaComItem { entrada: EntradaCatalogo; item?: string }

function ListaEntradas({
  entradas, porCid, aoAdicionar, aoQtd,
}: {
  entradas: EntradaComItem[];
  porCid: Map<string, LinhaCompra>;
  aoAdicionar: (entrada: EntradaCatalogo, item?: string) => void;
  aoQtd: (id: string, qtd: number) => void;
}) {
  return (
    <ul className="vst-cmpLista">
      {entradas.map(({ entrada, item }) => (
        <EntradaLinha
          key={entrada.cid}
          entrada={entrada}
          linha={porCid.get(entrada.cid)}
          aoAdicionar={() => aoAdicionar(entrada, item)}
          aoQtd={aoQtd}
        />
      ))}
    </ul>
  );
}

/** O que as vistas de lista têm em comum: o aviso, o mapa cid para linha e as ações de adicionar. */
function useAdicao(ctx: Contexto) {
  const { compras, sessao } = ctx;
  const { aviso, mostrar } = useAviso();
  const linhas = compras.estado.linhas;
  const porCid = useMemo(() => {
    const m = new Map<string, LinhaCompra>();
    for (const l of linhas) if (l.cid) m.set(l.cid, l);
    return m;
  }, [linhas]);

  function dizer(r: ResultadoAdicao, quandoEntrou?: string) {
    if (r === 'adicionada' && quandoEntrou) mostrar(quandoEntrou);
    else if (r === 'duplicada') mostrar(T.jaEstava);
    else if (r === 'cheia') mostrar(T.limite);
  }

  function adicionarEntrada(entrada: EntradaCatalogo, item?: string) {
    const linha = linhaDoCatalogo(entrada, { item, agora: new Date().toISOString(), id: criarId() });
    dizer(sessao.adicionar(linha));
  }

  function adicionarNota(texto: string, item?: string) {
    const linha = linhaNota({ obs: texto, item }, { agora: new Date().toISOString(), id: criarId() });
    dizer(sessao.adicionar(linha), T.notaAdd);
  }

  function mudarQtd(id: string, qtd: number) {
    compras.mudar((c) => atualizarLinha(c, id, { qtd }, new Date().toISOString()));
  }

  return { aviso, mostrar, porCid, adicionarEntrada, adicionarNota, mudarQtd };
}

// ---------------------------------------------------------------------------------------------------------
// Vista "item": as sugestões de UM item (a faixa "Sugestões de compra: n")
// ---------------------------------------------------------------------------------------------------------

function VistaItem({ ctx, item }: { ctx: Contexto; item: string }) {
  const { compras, sessao, statusItens } = ctx;
  const { aviso, mostrar, porCid, adicionarEntrada, adicionarNota, mudarQtd } = useAdicao(ctx);
  // A folha guarda o que o item sugeria quando abriu: ao tocar em "Adicionar" a entrada deixaria de ser pendente e
  // sumiria. Assim ela vira o contador no mesmo lugar, e o estado atual só diz o que já está na lista (pelo cid).
  const [foto] = useState(() => sugestoesDoItem(CATALOGO, item, statusItens, compras.estado.linhas, sessao.dispensadas));
  const [todas, setTodas] = useState(false);

  const principais = foto.principais;
  const visiveis = todas ? principais : principais.slice(0, 4);
  const escondidas = principais.length - visiveis.length;
  const pendentes = principais.filter((x) => !porCid.has(x.entrada.cid));
  // O que "Adicionar as sugeridas" leva: as alternativas excludentes (telha ou laje) nunca entram, e a remoção de telhado
  // com amianto também não (só por toque direto: a vistoria não sabe que a telha é de fibrocimento).
  const lote = loteDeSugeridas(pendentes);
  const notas = OBSERVACOES_PRONTAS.filter((o) => o.itens.includes(item));

  function adicionarLote() {
    // Cada linha leva um instante distinto no id, para duas do mesmo lote nunca baterem no sorteio das letras.
    const agora = new Date();
    const base = agora.getTime();
    const iso = agora.toISOString();
    const linhas = lote.map((x, i) => linhaDoCatalogo(x.entrada, { item, agora: iso, id: criarId(base + i) }));
    const ids = sessao.adicionarVarias(linhas);
    if (ids.length === 0) return;
    mostrar(ids.length === 1 ? T.loteUma : preencher(T.lote, { n: ids.length }), () => sessao.removerVarias(ids));
  }

  return (
    <>
      {lote.length > 0 && (
        <button type="button" className={`${e.btnPrim} vst-cmpLote`} onClick={adicionarLote}>
          {preencher(T.adicionarSugeridas, { n: lote.length })}
        </button>
      )}
      <BarraAviso aviso={aviso} />

      {principais.length > 0 && (
        <ListaEntradas
          entradas={visiveis.map((x) => ({ entrada: x.entrada, item }))}
          porCid={porCid}
          aoAdicionar={adicionarEntrada}
          aoQtd={mudarQtd}
        />
      )}
      {escondidas > 0 && (
        <button type="button" className="vst-cmpLink vst-cmpMais" onClick={() => setTodas(true)}>
          {preencher(T.mostrarMais, { n: escondidas })}
        </button>
      )}

      {foto.alternativas.map((g) => (
        <section key={g.grupo} className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{g.grupo === 'telha' ? T.escolhaTelha : T.seForLaje}</h3>
          <ListaEntradas
            entradas={g.entradas.map((x) => ({ entrada: x.entrada, item }))}
            porCid={porCid}
            aoAdicionar={adicionarEntrada}
            aoQtd={mudarQtd}
          />
        </section>
      ))}

      {notas.length > 0 && (
        <section className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{T.obsProntas}</h3>
          <ul className="vst-cmpLista">
            {notas.map((o) => (
              <li key={o.texto}>
                <button type="button" className="vst-cmpNotaPronta" onClick={() => adicionarNota(o.texto, item)}>{o.texto}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className={`${e.btnSec} vst-cmpBuscarBtn`} onClick={() => ctx.irPara({ vista: 'buscar' })}>
        <Search size={17} aria-hidden="true" /> {T.buscarBotao}
      </button>
      <Rodape compras={compras} aoFechar={ctx.aoFechar} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Vista "todas": tudo o que os itens marcados sugerem, os últimos usados, as categorias e os comuns
// ---------------------------------------------------------------------------------------------------------

function VistaTodas({ ctx }: { ctx: Contexto }) {
  const { compras, sessao, statusItens } = ctx;
  const { aviso, porCid, adicionarEntrada, mudarQtd } = useAdicao(ctx);
  const [grupos] = useState(() => sugerir(CATALOGO, statusItens, compras.estado.linhas, sessao.dispensadas));
  const [categoria, setCategoria] = useState<string | null>(null);

  // Na busca livre, o item só é preenchido se algum item marcado dispara a entrada neste momento.
  const comItem = (entradas: EntradaCatalogo[]): EntradaComItem[] =>
    entradas.map((entrada) => ({ entrada, item: itemQueDispara(entrada, statusItens) }));

  const recentes = sessao.recentes
    .map((cid) => CATALOGO.find((x) => x.cid === cid))
    .filter((x): x is EntradaCatalogo => !!x)
    .slice(0, 8);
  const comuns = CATALOGO.filter((x) => x.sempre);

  return (
    <>
      <button type="button" className={`${e.btnSec} vst-cmpBuscarBtn`} onClick={() => ctx.irPara({ vista: 'buscar' })}>
        <Search size={17} aria-hidden="true" /> {T.buscarBotao}
      </button>
      <BarraAviso aviso={aviso} />

      {grupos.map((g) => (
        <section key={g.item} className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{preencher(T.motivo, { Item: ROTULO_ITEM[g.item] ?? g.item, Status: ROTULO_STATUS[g.status] })}</h3>
          <ListaEntradas
            entradas={g.entradas.map((x) => ({ entrada: x.entrada, item: g.item }))}
            porCid={porCid}
            aoAdicionar={adicionarEntrada}
            aoQtd={mudarQtd}
          />
        </section>
      ))}

      {recentes.length > 0 && (
        <section className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{T.recentes}</h3>
          <ListaEntradas entradas={comItem(recentes)} porCid={porCid} aoAdicionar={adicionarEntrada} aoQtd={mudarQtd} />
        </section>
      )}

      <section className="vst-cmpSecao">
        <h3 className="vst-cmpSubtitulo">{T.categorias}</h3>
        <ul className="vst-cmpCategorias">
          {CATEGORIAS.map((c) => {
            const aberta = categoria === c.chave;
            return (
              <li key={c.chave}>
                <button type="button" className="vst-cmpCategoria" aria-expanded={aberta} onClick={() => setCategoria(aberta ? null : c.chave)}>
                  <span>{c.rotulo}</span>
                  {aberta ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                </button>
                {aberta && (
                  <ListaEntradas
                    entradas={comItem(CATALOGO.filter((x) => x.cat === c.chave))}
                    porCid={porCid}
                    aoAdicionar={adicionarEntrada}
                    aoQtd={mudarQtd}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {comuns.length > 0 && (
        <section className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{T.comuns}</h3>
          <ListaEntradas entradas={comItem(comuns)} porCid={porCid} aoAdicionar={adicionarEntrada} aoQtd={mudarQtd} />
        </section>
      )}

      <Rodape compras={compras} aoFechar={ctx.aoFechar} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Vista "buscar"
// ---------------------------------------------------------------------------------------------------------

function VistaBuscar({ ctx }: { ctx: Contexto }) {
  const { compras, statusItens } = ctx;
  const { aviso, porCid, adicionarEntrada, mudarQtd } = useAdicao(ctx);
  const [texto, setTexto] = useState('');
  const termo = texto.trim();
  const resultados = useMemo(() => buscar(CATALOGO, texto), [texto]);

  return (
    <>
      <div className="vst-cmpBusca">
        <Search size={18} aria-hidden="true" />
        <input
          className="vst-input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoFocus
          placeholder={T.buscarPlaceholder}
          aria-label={T.buscarAria}
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
        />
      </div>
      <BarraAviso aviso={aviso} />

      {termo && resultados.length === 0 && <p className="vst-cmpDica">{preencher(T.nadaEncontrado, { texto: termo })}</p>}
      {resultados.length > 0 && (
        <ListaEntradas
          entradas={resultados.map((entrada) => ({ entrada, item: itemQueDispara(entrada, statusItens) }))}
          porCid={porCid}
          aoAdicionar={adicionarEntrada}
          aoQtd={mudarQtd}
        />
      )}
      {termo && (
        <button type="button" className="vst-cmpLivreLinha" onClick={() => ctx.irPara({ vista: 'livre', nome: termo })}>
          {preencher(T.adicionarLivre, { texto: termo })}
        </button>
      )}
      <Rodape compras={compras} aoFechar={ctx.aoFechar} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Formulários: material fora do catálogo ("livre") e edição de uma linha ("editar")
// ---------------------------------------------------------------------------------------------------------

function CampoItem({ id, valor, aoMudar }: { id: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <>
      <label className="vst-label" htmlFor={id}>{T.rotItem}</label>
      <select id={id} className="vst-select" value={valor} onChange={(ev) => aoMudar(ev.target.value)}>
        <option value="">Nenhum</option>
        {CHAVES_ITENS.map((k) => <option key={k} value={k}>{ROTULO_ITEM[k]}</option>)}
      </select>
    </>
  );
}

/**
 * Põe no campo a altura do texto: zera a altura, lê o conteúdo e soma a borda, que o scrollHeight não conta. Campo
 * vazio mede o exemplo (placeholder) no lugar do texto, para ele aparecer inteiro: o valor volta a ser vazio antes de
 * a tela pintar e nenhum evento é disparado. Fora da tela a medida vem zerada, e então a altura mínima do CSS segura
 * o campo.
 */
function ajustarAltura(campo: HTMLTextAreaElement, placeholder: string) {
  campo.style.height = 'auto';
  const vazio = campo.value === '';
  if (vazio) campo.value = placeholder;
  const medida = campo.scrollHeight;
  if (vazio) campo.value = '';
  if (medida > 0) campo.style.height = `${medida + (campo.offsetHeight - campo.clientHeight)}px`;
}

/**
 * Campo de texto de uma linha lógica (nome, especificação, nota) que mostra o texto inteiro: um `textarea` que cresce
 * com o conteúdo. O `input` de uma linha só mostrava o que cabia na borda, e no celular o texto longo e o exemplo do
 * campo vazio ficavam cortados. Não aceita quebra de linha: Enter não faz nada e texto colado com quebra troca
 * a quebra por espaço (a lista guarda o texto numa linha só, como `limparTexto` faz ao gravar).
 */
function CampoTexto({
  id, valor, aoMudar, maxLength, placeholder,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  maxLength: number;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Mede de novo a cada mudança do texto, antes de a tela pintar.
  useLayoutEffect(() => {
    if (ref.current) ajustarAltura(ref.current, placeholder);
  }, [valor, placeholder]);
  // E a cada mudança de largura (aparelho girado, janela redimensionada): o texto passa a quebrar em outros pontos, e
  // a altura de antes cortaria a última linha. Só a largura conta (a altura muda por causa deste próprio ajuste), e a
  // medida espera o quadro seguinte para não mexer no tamanho dentro da própria notificação do observador.
  useEffect(() => {
    const campo = ref.current;
    if (!campo || typeof ResizeObserver === 'undefined') return;
    let largura = campo.clientWidth;
    let quadro = 0;
    const observador = new ResizeObserver(() => {
      if (campo.clientWidth === largura) return;
      largura = campo.clientWidth;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => ajustarAltura(campo, placeholder));
    });
    observador.observe(campo);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
    };
  }, [placeholder]);
  return (
    <textarea
      ref={ref} id={id} className="vst-input vst-cmpCampoTexto" rows={1} autoComplete="off" maxLength={maxLength}
      placeholder={placeholder} value={valor}
      onChange={(ev) => aoMudar(ev.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(ev) => { if (ev.key === 'Enter') ev.preventDefault(); }}
    />
  );
}

function FormMaterial({ r, aoMudar }: { r: Rascunho; aoMudar: (parcial: Partial<Rascunho>) => void }) {
  return (
    <div className="vst-cmpForm">
      <label className="vst-label" htmlFor="vst-cmp-nome">{T.rotNome}</label>
      <CampoTexto
        id="vst-cmp-nome" maxLength={LIMITES.nome} placeholder={T.phNome}
        valor={r.nome} aoMudar={(v) => aoMudar({ nome: v })}
      />

      <label className="vst-label" htmlFor="vst-cmp-esp">{T.rotEsp}</label>
      <CampoTexto
        id="vst-cmp-esp" maxLength={LIMITES.esp} placeholder={T.phEsp}
        valor={r.esp} aoMudar={(v) => aoMudar({ esp: v })}
      />

      {r.un !== 'servico' && (
        <>
          <label className="vst-label" htmlFor="vst-cmp-qtd">{T.rotQtd}</label>
          <input
            id="vst-cmp-qtd" className="vst-input" type="text" inputMode="decimal" autoComplete="off" maxLength={10}
            placeholder="A definir" value={r.qtd} onChange={(ev) => aoMudar({ qtd: ev.target.value })}
          />
        </>
      )}

      <span className="vst-label" id="vst-cmp-un-t">{T.rotUn}</span>
      <div className="vst-cmpGrade vst-cmpGrade3" role="group" aria-labelledby="vst-cmp-un-t">
        {UNIDADES.map((u) => (
          <button
            key={u} type="button" aria-pressed={r.un === u}
            className={`vst-cmpOpcao${r.un === u ? ' vst-cmpOpcaoOn' : ''}`}
            onClick={() => aoMudar({ un: u })}
          >
            {ROTULO_UNIDADE[u]}
          </button>
        ))}
      </div>

      <span className="vst-label" id="vst-cmp-quem-t">{T.rotQuem}</span>
      <div className="vst-cmpGrade vst-cmpGrade3" role="group" aria-labelledby="vst-cmp-quem-t">
        {QUEM.map((q) => (
          <button
            key={q} type="button" aria-pressed={r.quem === q}
            className={`vst-cmpOpcao vst-cmpOpcaoAlta${r.quem === q ? ' vst-cmpOpcaoOn' : ''}`}
            onClick={() => aoMudar({ quem: q })}
          >
            {ROTULO_QUEM[q]}
          </button>
        ))}
      </div>

      <CampoItem id="vst-cmp-item" valor={r.item} aoMudar={(v) => aoMudar({ item: v })} />

      <label className="vst-label" htmlFor="vst-cmp-nota">{T.rotNota}</label>
      <CampoTexto
        id="vst-cmp-nota" maxLength={LIMITES.obsLinha} placeholder={T.phNota}
        valor={r.obs} aoMudar={(v) => aoMudar({ obs: v })}
      />
    </div>
  );
}

function VistaLivre({
  ctx, rascunho, setRascunho,
}: {
  ctx: Contexto;
  rascunho: Rascunho;
  setRascunho: (r: Rascunho) => void;
}) {
  const { aviso, mostrar } = useAviso();
  const nomeOk = limparTexto(rascunho.nome, LIMITES.nome).length >= 2;

  function enviar() {
    const q = lerQtdRascunho(rascunho);
    if (!q.ok) { mostrar(T.qtdInvalida); return; }
    const linha = linhaLivre(
      {
        nome: rascunho.nome, esp: rascunho.esp, qtd: q.qtd, un: rascunho.un, quem: rascunho.quem,
        item: rascunho.item || undefined, obs: rascunho.obs,
      },
      { agora: new Date().toISOString(), id: criarId() },
    );
    const r = ctx.sessao.adicionar(linha);
    if (r === 'adicionada') { setRascunho(RASCUNHO_VAZIO); ctx.aoFechar(); return; }
    mostrar(r === 'duplicada' ? T.jaEsta : r === 'cheia' ? T.limite : T.nomeVazio);
  }

  return (
    <>
      <FormMaterial r={rascunho} aoMudar={(p) => setRascunho({ ...rascunho, ...p })} />
      <BarraAviso aviso={aviso} />
      {!nomeOk && <p className="vst-cmpDica">{T.nomeVazio}</p>}
      <button type="button" className={`${e.btnPrim} vst-cmpEnviar`} disabled={!nomeOk} onClick={enviar}>{T.btnAddLista}</button>
    </>
  );
}

function VistaEditar({
  ctx, id, rascunho, setRascunho,
}: {
  ctx: Contexto;
  id: string;
  rascunho: { id: string; r: Rascunho } | null;
  setRascunho: (r: { id: string; r: Rascunho } | null) => void;
}) {
  const { aviso, mostrar } = useAviso();
  const linha = ctx.compras.estado.linhas.find((l) => l.id === id);

  if (!linha) return <Rodape compras={ctx.compras} aoFechar={ctx.aoFechar} />;

  const material = linha.tipo === 'material';
  const r = rascunho && rascunho.id === id ? rascunho.r : rascunhoDaLinha(linha);
  const mudar = (p: Partial<Rascunho>) => setRascunho({ id, r: { ...r, ...p } });
  const textoOk = material
    ? limparTexto(r.nome, LIMITES.nome).length >= 2
    : limparTexto(r.obs, LIMITES.obsNota).length >= 1;

  function fechar() {
    setRascunho(null);
    ctx.aoFechar();
  }

  function salvar() {
    const agora = new Date().toISOString();
    if (material) {
      const q = lerQtdRascunho(r);
      if (!q.ok) { mostrar(T.qtdInvalida); return; }
      ctx.compras.mudar((c) => atualizarLinha(c, id, {
        nome: r.nome, esp: r.esp, qtd: q.qtd, un: r.un, quem: r.quem, item: r.item || undefined, obs: r.obs,
      }, agora));
    } else {
      ctx.compras.mudar((c) => atualizarLinha(c, id, { obs: r.obs, item: r.item || undefined }, agora));
    }
    fechar();
  }

  function apagar() {
    ctx.sessao.apagar(id);
    fechar();
  }

  return (
    <>
      {material ? (
        <FormMaterial r={r} aoMudar={mudar} />
      ) : (
        <div className="vst-cmpForm">
          <label className="vst-label" htmlFor="vst-cmp-obs-texto">{T.anotar}</label>
          <textarea
            id="vst-cmp-obs-texto" className="vst-obs vst-cmpTextarea" rows={5} maxLength={LIMITES.obsNota}
            placeholder={T.phObs} value={r.obs} onChange={(ev) => mudar({ obs: ev.target.value })}
          />
          <CampoItem id="vst-cmp-item" valor={r.item} aoMudar={(v) => mudar({ item: v })} />
        </div>
      )}
      <BarraAviso aviso={aviso} />
      {!textoOk && <p className="vst-cmpDica">{material ? T.nomeVazio : T.phObs}</p>}
      <div className="vst-cmpBotoesForm">
        <button type="button" className={e.btnPrim} disabled={!textoOk} onClick={salvar}>{T.salvar}</button>
        <button type="button" className="vst-cmpPerigo" onClick={apagar}>{T.apagarLinha}</button>
        <button type="button" className="vst-ghostBtn" onClick={fechar}>{T.cancelar}</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Vista "obs": observações prontas e texto livre
// ---------------------------------------------------------------------------------------------------------

function VistaObs({ ctx }: { ctx: Contexto }) {
  const { compras, sessao, statusItens } = ctx;
  const { aviso, mostrar } = useAviso();
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [item, setItem] = useState('');

  // Itens marcados Atenção ou Não conforme (os não conformes antes, cada bloco na ordem do checklist) e SEMPRE a
  // conta de luz e o documento, que não têm status.
  const naoConformes = CHAVES_ITENS.filter((k) => statusItens[k] === 'nao_conforme');
  const atencoes = CHAVES_ITENS.filter((k) => statusItens[k] === 'atencao');
  const ordem: string[] = [...naoConformes, ...atencoes, 'conta_luz', 'documento_pessoal'];
  const usadas = new Set<string>();
  const grupos = ordem
    .map((k) => {
      const notas = OBSERVACOES_PRONTAS.filter((o) => o.itens.includes(k) && !usadas.has(o.texto));
      for (const o of notas) usadas.add(o.texto);
      return { item: k, notas };
    })
    .filter((g) => g.notas.length > 0);

  function adicionar(obs: string, deItem?: string): boolean {
    const linha = linhaNota({ obs, item: deItem }, { agora: new Date().toISOString(), id: criarId() });
    const r = sessao.adicionar(linha);
    if (r === 'adicionada') { mostrar(T.notaAdd); return true; }
    if (r === 'duplicada') mostrar(T.jaEstava);
    else if (r === 'cheia') mostrar(T.limite);
    return false;
  }

  function adicionarTexto() {
    if (adicionar(texto, item || undefined)) {
      setTexto('');
      setEscrevendo(false);
    }
  }

  return (
    <>
      <BarraAviso aviso={aviso} />

      {grupos.map((g) => (
        <section key={g.item} className="vst-cmpSecao">
          <h3 className="vst-cmpSubtitulo">{ROTULO_ITEM[g.item]}</h3>
          <ul className="vst-cmpLista">
            {g.notas.map((o) => (
              <li key={o.texto}>
                <button type="button" className="vst-cmpNotaPronta" onClick={() => adicionar(o.texto, g.item)}>{o.texto}</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="vst-cmpSecao">
        {escrevendo ? (
          <div className="vst-cmpForm">
            <label className="vst-label" htmlFor="vst-cmp-obs-livre">{T.anotar}</label>
            <textarea
              id="vst-cmp-obs-livre" className="vst-obs vst-cmpTextarea" rows={4} autoFocus maxLength={LIMITES.obsNota}
              placeholder={T.phObs} value={texto} onChange={(ev) => setTexto(ev.target.value)}
            />
            <CampoItem id="vst-cmp-obs-item" valor={item} aoMudar={setItem} />
            <button
              type="button" className={`${e.btnPrim} vst-cmpEnviar`}
              disabled={limparTexto(texto, LIMITES.obsNota) === ''} onClick={adicionarTexto}
            >
              {T.btnAddLista}
            </button>
          </div>
        ) : (
          // Parece o campo, mas só vira campo no toque: com ele já na tela a Gaveta o focaria e o teclado cobriria as
          // observações prontas.
          <button type="button" className="vst-cmpCampoFalso" onClick={() => setEscrevendo(true)}>{T.phObs}</button>
        )}
      </section>

      <Rodape compras={compras} aoFechar={ctx.aoFechar} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Vista "texto": copiar para o WhatsApp (fornecedor e cliente)
// ---------------------------------------------------------------------------------------------------------

/** O link wa.me some se o texto codificado passar disto: o WhatsApp corta o que vem depois. */
const LIMITE_LINK_WHATSAPP = 1800;

function VistaTexto({
  ctx, clienteNome, urlRelatorio,
}: {
  ctx: Contexto;
  clienteNome: string | null;
  urlRelatorio: string;
}) {
  const { compras, statusItens, aoLogar } = ctx;
  const estado = compras.estado;
  // Lista visível no relatório: só então o texto do cliente leva o link.
  const incluirLink = estado.publica && estado.linhas.length > 0;
  // Abre na aba que tem texto: se não há nada a cotar com o fornecedor e há item do cliente, começa pelo cliente.
  const [aba, setAba] = useState<'fornecedor' | 'cliente'>(() => {
    if (textoFornecedor(estado, { clienteNome }).pode) return 'fornecedor';
    return textoCliente(estado, statusItens, { clienteNome, urlRelatorio, incluirLink }).pode ? 'cliente' : 'fornecedor';
  });
  const [aviso, setAviso] = useState('');
  const caixa = useRef<HTMLTextAreaElement>(null);
  const haMaterial = estado.linhas.some((l) => l.tipo === 'material');

  const fornecedor = useMemo(() => textoFornecedor(estado, { clienteNome }), [estado, clienteNome]);
  const cliente = useMemo(
    () => textoCliente(estado, statusItens, { clienteNome, urlRelatorio, incluirLink }),
    [estado, statusItens, clienteNome, urlRelatorio, incluirLink],
  );
  const atual = aba === 'fornecedor' ? fornecedor : cliente;
  const codificado = encodeURIComponent(atual.texto);
  const linkCurto = codificado.length <= LIMITE_LINK_WHATSAPP;

  function trocar(nova: 'fornecedor' | 'cliente') {
    setAba(nova);
    setAviso('');
  }

  // A caixa cresce até o texto caber inteiro, contando as linhas que a largura quebra (o `rows` só vê as quebras do
  // texto, e no celular o fim do texto e o link do relatório ficavam escondidos). O teto de 60% da tela é do CSS.
  const ajustarCaixa = useCallback(() => {
    const el = caixa.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, []);
  useLayoutEffect(() => { ajustarCaixa(); }, [ajustarCaixa, atual.texto, atual.pode, aba]);
  useEffect(() => {
    window.addEventListener('resize', ajustarCaixa);
    return () => window.removeEventListener('resize', ajustarCaixa);
  }, [ajustarCaixa]);

  // A cópia roda DIRETO no toque, com o texto já pronto: o Safari do iPhone recusa a cópia depois de um await.
  function copiar() {
    if (!atual.pode) return;
    aoLogar(aba === 'fornecedor' ? 'compras_copiar_fornecedor' : 'compras_copiar_cliente');
    let promessa: Promise<void>;
    try {
      promessa = Promise.resolve(navigator.clipboard.writeText(atual.texto));
    } catch {
      promessa = Promise.reject(new Error('sem acesso à área de transferência'));
    }
    promessa.then(
      () => setAviso(T.copiou),
      () => {
        caixa.current?.focus();
        caixa.current?.select();
        setAviso(T.naoCopiou);
      },
    );
  }

  return (
    <>
      <div className="vst-cmpSeg" role="group" aria-label={T.btnWhatsapp}>
        <button type="button" aria-pressed={aba === 'fornecedor'} className={`vst-cmpOpcao${aba === 'fornecedor' ? ' vst-cmpOpcaoOn' : ''}`} onClick={() => trocar('fornecedor')}>
          {T.abaForn}
        </button>
        <button type="button" aria-pressed={aba === 'cliente'} className={`vst-cmpOpcao${aba === 'cliente' ? ' vst-cmpOpcaoOn' : ''}`} onClick={() => trocar('cliente')}>
          {T.abaCli}
        </button>
      </div>

      {atual.pode ? (
        <textarea
          ref={caixa}
          className="vst-cmpCaixa"
          readOnly
          rows={4}
          aria-label={aba === 'fornecedor' ? T.abaForn : T.abaCli}
          value={atual.texto}
        />
      ) : (
        <p className="vst-cmpDica">
          {aba === 'fornecedor' ? (haMaterial ? T.semItemFornecedor : T.dicaSemMaterial) : T.semItemCliente}
        </p>
      )}

      {atual.fora && <p className="vst-cmpNotaTexto">{atual.fora}</p>}
      {atual.avisos.map((a) => <p key={a} className="vst-cmpNotaTexto">{a}</p>)}
      <p className="vst-cmpNotaTexto">{T.notaPrivacidade}</p>
      {aba === 'fornecedor' && <p className="vst-cmpNotaTexto">{T.notaLink}</p>}

      <div className="vst-cmpAviso" role="status" aria-live="polite">{aviso && <span>{aviso}</span>}</div>

      <div className="vst-cmpBotoesForm">
        <button type="button" className={e.btnPrim} disabled={!atual.pode} onClick={copiar}>{T.copiarTexto}</button>
        {atual.pode && linkCurto ? (
          <a
            className={`${e.btnSec} vst-cmpLinkZap`}
            href={`https://wa.me/?text=${codificado}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => aoLogar('compras_whatsapp')}
          >
            {T.abrirZap}
          </a>
        ) : (
          atual.pode && <p className="vst-cmpNotaTexto">{T.listaLonga}</p>
        )}
      </div>
      <Rodape compras={compras} aoFechar={ctx.aoFechar} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// A folha
// ---------------------------------------------------------------------------------------------------------

function tituloDe(a: AberturaFolha | null, statusItens: MapaStatus): string {
  if (!a) return '';
  switch (a.vista) {
    case 'item': {
      const chave = a.item ?? '';
      const rotulo = ROTULO_ITEM[chave] ?? '';
      const st = statusItens[chave];
      return st === 'atencao' || st === 'nao_conforme'
        ? preencher(T.folhaItem, { Item: rotulo, Status: ROTULO_STATUS[st] })
        : rotulo;
    }
    case 'todas': return T.folhaGeral;
    case 'buscar': return T.buscarBotao;
    case 'livre': return T.formLivre;
    case 'obs': return T.anotar;
    case 'editar': return T.editarLinha;
    case 'texto': return T.btnWhatsapp;
  }
}

export default function ComprasGaveta({
  abertura, aoMudarVista, aoFechar, compras, sessao, statusItens, clienteNome, urlRelatorio, aoLogar,
}: {
  /** null = fechada. */
  abertura: AberturaFolha | null;
  aoMudarVista: (m: MudancaVista) => void;
  aoFechar: () => void;
  compras: UsoCompras;
  sessao: SessaoCompras;
  statusItens: MapaStatus;
  clienteNome: string | null;
  urlRelatorio: string;
  aoLogar: (tipo: string) => void;
}) {
  // Os rascunhos moram aqui, que fica montada com a tela: fechar a folha e reabrir restaura o que estava digitado.
  const [livre, setLivre] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [editar, setEditar] = useState<{ id: string; r: Rascunho } | null>(null);

  function irPara(m: MudancaVista) {
    if (m.vista === 'livre' && m.nome !== undefined) setLivre({ ...RASCUNHO_VAZIO, nome: m.nome });
    aoMudarVista(m);
  }

  const ctx: Contexto = { compras, sessao, statusItens, aoLogar, aoFechar, irPara };

  return (
    <Gaveta aberta={abertura !== null} titulo={tituloDe(abertura, statusItens)} onFechar={aoFechar}>
      {abertura && (
        <div className="vst-cmpFolha" key={abertura.seq}>
          {abertura.vista === 'item' && <VistaItem ctx={ctx} item={abertura.item ?? ''} />}
          {abertura.vista === 'todas' && <VistaTodas ctx={ctx} />}
          {abertura.vista === 'buscar' && <VistaBuscar ctx={ctx} />}
          {abertura.vista === 'livre' && <VistaLivre ctx={ctx} rascunho={livre} setRascunho={setLivre} />}
          {abertura.vista === 'obs' && <VistaObs ctx={ctx} />}
          {abertura.vista === 'editar' && <VistaEditar ctx={ctx} id={abertura.id ?? ''} rascunho={editar} setRascunho={setEditar} />}
          {abertura.vista === 'texto' && <VistaTexto ctx={ctx} clienteNome={clienteNome} urlRelatorio={urlRelatorio} />}
        </div>
      )}
    </Gaveta>
  );
}
