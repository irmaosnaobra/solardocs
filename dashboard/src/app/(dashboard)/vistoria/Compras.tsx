'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Minus, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { estilos as e } from '@/components/AreaTrabalho/AreaTrabalho';
import { parseNumero } from '../manutencao/Campos';
import { CATALOGO } from './catalogoCompras';
import { TEXTOS_COMPRAS as T } from './comprasTextos';
import { atualizarLinha, criarId, formatarQtd, lerQtd, linhaDoCatalogo, sugerir } from './comprasPuro';
import {
  ABREV_UNIDADE, LIMITES, ROTULO_ITEM, ROTULO_QUEM, ROTULO_STATUS,
  type EntradaCatalogo, type LinhaCompra, type MapaStatus, type Unidade,
} from './comprasTipos';
import { preencher, type SessaoCompras, type UsoCompras } from './useCompras';
import type { AberturaFolha } from './ComprasGaveta';

// Seção "Lista de compras" do editor da vistoria (seção 7.6 do plano). Cada toque grava (o useCompras cuida do
// envio): não há botão Salvar e apagar não pede confirmação, tem "Desfazer" por 6 s. Quem providencia e a
// unidade só mudam na folha de edição, nunca por toque solto na lista, porque mudar quem paga por engano vai
// parar no relatório do cliente.

/** Entradas do catálogo que avisam de amianto: a linha criada por elas mostra a faixa amarela. */
const CIDS_AMIANTO = new Set(CATALOGO.filter((c) => c.aviso === 'amianto').map((c) => c.cid));

const nomeDe = (l: LinhaCompra): string => (l.tipo === 'material' && l.nome ? l.nome : 'observação');

/** "Cliente · Padrão de entrada": quem providencia e o item da vistoria, só o que existir. */
function rotulosDe(l: LinhaCompra): string {
  const partes: string[] = [];
  if (l.tipo === 'material' && l.quem) partes.push(ROTULO_QUEM[l.quem]);
  if (l.item && ROTULO_ITEM[l.item]) partes.push(ROTULO_ITEM[l.item]);
  return partes.join(' · ');
}

/**
 * O texto do estado da gravação. A seção "Lista de compras" e o pé da folha usam este mesmo: no celular a folha cobre a
 * seção, e quem adiciona vários materiais sem rede precisa ver o aviso dentro da folha.
 */
export function textoDaSituacao(c: Pick<UsoCompras, 'situacao' | 'mensagem'>): string {
  if (c.situacao === 'salvo') return T.salvo;
  if (c.situacao === 'salvando') return c.mensagem || T.salvando;
  if (c.situacao === 'conflito') return c.mensagem || T.conflito;
  return c.mensagem || (c.situacao === 'sem_rede' ? T.semRede : T.erroSalvar);
}

// ---------------------------------------------------------------------------------------------------------
// Quantidade: "-", número, "+" (o número vira campo ao toque) ou "Informar quantidade"
// ---------------------------------------------------------------------------------------------------------

/**
 * Controle de quantidade de uma linha de material. Serviço não tem. Com número: "-" (não passa de 1), o número
 * (toque para digitar; "1.200" vale 1200 e "8,5" vale 8,5) e "+". Sem número (metro, barra e peça nascem "a
 * definir"): o botão "Informar quantidade" e o aviso "Falta a quantidade". Quantidade vazia, zero ou inválida
 * volta ao valor de antes com o aviso de quantidade inválida. Também é usado pela folha.
 */
export function ControleQtd({
  nome, qtd, un, aoMudar,
}: {
  nome: string;
  qtd: number | null;
  un: Unidade;
  aoMudar: (qtd: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  // Enter e a saída do campo chamam confirmar() quase juntas: só a primeira vale.
  const resolvido = useRef(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Ao abrir o campo o número de antes vem TODO selecionado: o que o técnico digita troca o número em vez de emendar nele
  // (digitar 1.200 sobre "1" gravava 11200). O `autoFocus` do React deixa o cursor no fim e nada selecionado; por isso o foco
  // e a seleção ficam aqui. O setSelectionRange cobre o teclado do iPhone, que nem sempre aceita o select().
  useEffect(() => {
    if (!editando) return;
    const el = campo.current;
    if (!el) return;
    el.focus();
    el.select();
    try { el.setSelectionRange(0, el.value.length); } catch { /* campo sem seleção: o select() acima já valeu */ }
  }, [editando]);

  if (un === 'servico') return null;

  function abrirCampo() {
    resolvido.current = false;
    setTexto(qtd === null ? '' : String(qtd).replace('.', ','));
    setAviso('');
    setEditando(true);
  }

  function confirmar() {
    if (resolvido.current) return;
    resolvido.current = true;
    setEditando(false);
    const valor = lerQtd(parseNumero(texto, true));
    if (valor === null) { setAviso(T.qtdInvalida); return; }
    if (valor !== qtd) aoMudar(valor);
  }

  function cancelar() {
    resolvido.current = true;
    setEditando(false);
  }

  function menos() {
    if (qtd === null) return;
    aoMudar(Math.max(1, Math.round((qtd - 1) * 100) / 100));
  }

  function mais() {
    if (qtd === null) return;
    const valor = lerQtd(Math.round((qtd + 1) * 100) / 100);
    if (valor !== null) aoMudar(valor);
  }

  const abrev = ABREV_UNIDADE[un];

  return (
    <div className="vst-cmpQtdBloco">
      {editando ? (
        <div className="vst-cmpQtd">
          <input
            ref={campo}
            className="vst-cmpQtdCampo"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={10}
            aria-label={T.rotQtd}
            value={texto}
            onChange={(ev) => setTexto(ev.target.value)}
            onBlur={confirmar}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
              else if (ev.key === 'Escape') { ev.preventDefault(); cancelar(); }
            }}
          />
          <span className="vst-cmpUn">{abrev}</span>
        </div>
      ) : qtd === null ? (
        <div className="vst-cmpQtd vst-cmpQtdFalta">
          <button type="button" className="vst-cmpInformar" onClick={abrirCampo}>{T.informarQtd}</button>
          <span className="vst-cmpFalta">{T.faltaQtd}</span>
        </div>
      ) : (
        <div className="vst-cmpQtd">
          <button type="button" className="vst-cmpIcone" disabled={qtd <= 1} aria-label={preencher(T.diminuirAria, { nome })} onClick={menos}>
            <Minus size={18} aria-hidden="true" />
          </button>
          <button type="button" className="vst-cmpNumero" aria-label={preencher(T.numeroAria, { nome, n: formatarQtd(qtd) })} onClick={abrirCampo}>
            {formatarQtd(qtd)}
          </button>
          <button type="button" className="vst-cmpIcone" aria-label={preencher(T.aumentarAria, { nome })} onClick={mais}>
            <Plus size={18} aria-hidden="true" />
          </button>
          <span className="vst-cmpUn">{abrev}</span>
        </div>
      )}
      {aviso && <p className="vst-cmpAvisoQtd" role="status">{aviso}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Uma linha da lista
// ---------------------------------------------------------------------------------------------------------

function LinhaLista({
  linha, destaque, aoQtd, aoEditar, aoApagar,
}: {
  linha: LinhaCompra;
  destaque: boolean;
  aoQtd: (id: string, qtd: number) => void;
  aoEditar: (id: string) => void;
  aoApagar: (id: string) => void;
}) {
  const nome = nomeDe(linha);
  const material = linha.tipo === 'material';
  const un: Unidade = linha.un ?? 'un';
  const rotulos = rotulosDe(linha);
  const amianto = !!linha.cid && CIDS_AMIANTO.has(linha.cid);
  return (
    <li id={`vst-cmp-linha-${linha.id}`} className={`vst-cmpLinha${destaque ? ' vst-cmpNova' : ''}`}>
      <div className="vst-cmpLinhaTopo">
        <div className="vst-cmpTexto">
          {material ? (
            <>
              <strong className="vst-cmpNome">{linha.nome}</strong>
              {linha.esp && <span className="vst-cmpEsp">{linha.esp}</span>}
            </>
          ) : (
            <>
              <span className="vst-cmpEtiqueta">Observação</span>
              <span className="vst-cmpNota">{linha.obs}</span>
            </>
          )}
          {rotulos && <span className="vst-cmpRotulos">{rotulos}</span>}
        </div>
        <div className="vst-cmpBotoes">
          <button type="button" className="vst-cmpIcone" aria-label={preencher(T.editarAria, { nome })} onClick={() => aoEditar(linha.id)}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" className="vst-cmpIcone" aria-label={preencher(T.apagarAria, { nome })} onClick={() => aoApagar(linha.id)}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      {material && (
        <div className="vst-cmpLinhaBase">
          {un === 'servico'
            ? <span className="vst-cmpTag">{ABREV_UNIDADE.servico}</span>
            : <ControleQtd nome={nome} qtd={linha.qtd ?? null} un={un} aoMudar={(q) => aoQtd(linha.id, q)} />}
        </div>
      )}
      {amianto && <p className="vst-cmpAmianto" role="note">{T.amiantoAviso}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------
// A seção
// ---------------------------------------------------------------------------------------------------------

export default function Compras({
  compras, sessao, statusItens, abrirFolha,
}: {
  compras: UsoCompras;
  sessao: SessaoCompras;
  statusItens: MapaStatus;
  abrirFolha: (a: Omit<AberturaFolha, 'seq'>) => void;
}) {
  const { estado, situacao } = compras;
  const { linhas, publica } = estado;
  const { novaId, apagada, dispensadas } = sessao;

  const grupos = useMemo(() => sugerir(CATALOGO, statusItens, linhas, dispensadas), [statusItens, linhas, dispensadas]);
  // As 3 melhores, sem as alternativas excludentes (telha ou laje): essas só aparecem na folha.
  const topo = useMemo(() => grupos
    .flatMap((g) => g.entradas.filter((x) => !x.entrada.alternativa).map((x) => ({ entrada: x.entrada, item: g.item, status: g.status })))
    .slice(0, 3), [grupos]);
  const totalSugestoes = useMemo(() => grupos.reduce((n, g) => n + g.entradas.length, 0), [grupos]);

  const cheia = linhas.length >= LIMITES.linhas;
  const temMaterial = linhas.some((l) => l.tipo === 'material');

  // A linha nova rola até o centro (o destaque de 2 s é a classe vst-cmpNova).
  useEffect(() => {
    if (!novaId) return;
    const el = document.getElementById(`vst-cmp-linha-${novaId}`);
    if (!el) return;
    const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calmo ? 'auto' : 'smooth' });
  }, [novaId]);

  function adicionarSugestao(entrada: EntradaCatalogo, item: string) {
    const linha = linhaDoCatalogo(entrada, { item, agora: new Date().toISOString(), id: criarId() });
    sessao.adicionar(linha);
  }

  function mudarQtd(id: string, qtd: number) {
    compras.mudar((c) => atualizarLinha(c, id, { qtd }, new Date().toISOString()));
  }

  function alternarPublica() {
    compras.mudar((c) => ({ ...c, publica: !c.publica }));
  }

  const textoEstado = textoDaSituacao(compras);

  return (
    <section className="vst-cmp" aria-labelledby="vst-cmp-titulo">
      <h2 className="vst-secTitulo" id="vst-cmp-titulo">{T.titulo}</h2>
      <p className="vst-cmpApoio">{publica ? T.apoioPublica : T.apoioPrivada}</p>

      <button type="button" role="switch" aria-checked={publica} className="vst-cmpSwitch" onClick={alternarPublica}>
        <span className="vst-cmpSwitchTxt">{T.interruptor}</span>
        <span className="vst-cmpTrilho" aria-hidden="true"><span className="vst-cmpBola" /></span>
      </button>

      <p className={`vst-cmpEstado vst-cmpEstado-${situacao}`} aria-live="polite">
        <span>{textoEstado}</span>
        {situacao === 'sem_rede' && <span> {T.semRedeAviso}</span>}
      </p>

      {topo.length > 0 && (
        <div className="vst-cmpSugeridos">
          <h3 className="vst-cmpSubtitulo">{T.sugeridosTitulo}</h3>
          <ul className="vst-cmpLista">
            {topo.map(({ entrada, item, status }) => (
              <li key={entrada.cid} className="vst-cmpSugestao">
                <div className="vst-cmpTexto">
                  <strong className="vst-cmpNome">{entrada.nome}</strong>
                  <span className="vst-cmpRotulos">{ABREV_UNIDADE[entrada.un]} · {ROTULO_QUEM[entrada.quem]}</span>
                  <span className="vst-cmpMotivo">{preencher(T.motivo, { Item: ROTULO_ITEM[item] ?? item, Status: ROTULO_STATUS[status] })}</span>
                </div>
                <div className="vst-cmpSugAcoes">
                  <button type="button" className={e.btnSec} disabled={cheia} onClick={() => adicionarSugestao(entrada, item)}>{T.adicionar}</button>
                  <button type="button" className="vst-cmpLink" aria-label={preencher(T.dispensarAria, { nome: entrada.nome })} onClick={() => sessao.dispensar(entrada.cid)}>
                    {T.dispensar}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="vst-cmpLink vst-cmpVerTodas" onClick={() => abrirFolha({ vista: 'todas' })}>
            {preencher(T.verTodas, { n: totalSugestoes })}
          </button>
        </div>
      )}

      {linhas.length === 0 ? (
        <div className="vst-cmpVazio">
          <strong>{T.vazioTitulo}</strong>
          <p>
            {totalSugestoes === 0
              ? T.vazioDica
              : totalSugestoes === 1 ? T.vazioComSugestao : preencher(T.vazioComSugestoes, { n: totalSugestoes })}
          </p>
        </div>
      ) : (
        <div className="vst-cmpNaLista">
          <h3 className="vst-cmpSubtitulo">{preencher(T.naLista, { n: linhas.length })}</h3>
          <ul className="vst-cmpLista">
            {linhas.map((l) => (
              <LinhaLista
                key={l.id}
                linha={l}
                destaque={novaId === l.id}
                aoQtd={mudarQtd}
                aoEditar={(id) => abrirFolha({ vista: 'editar', id })}
                aoApagar={sessao.apagar}
              />
            ))}
          </ul>
        </div>
      )}

      {apagada && (
        <div className="vst-cmpDesfazer" role="status">
          <span>{T.apagada}</span>
          <button type="button" className="vst-cmpLink" onClick={sessao.desfazerApagada}>
            <Undo2 size={16} aria-hidden="true" /> {T.desfazer}
          </button>
        </div>
      )}

      <div className="vst-cmpAcoes">
        <button type="button" className={e.btnPrim} disabled={cheia} onClick={() => abrirFolha({ vista: 'todas' })}>
          <Plus size={17} aria-hidden="true" /> {T.btnAdicionar}
        </button>
        <button type="button" className={e.btnSec} disabled={cheia} onClick={() => abrirFolha({ vista: 'obs' })}>
          {T.btnObservacao}
        </button>
        <button type="button" className="vst-ghostBtn" disabled={!temMaterial} onClick={() => abrirFolha({ vista: 'texto' })}>
          <Copy size={15} aria-hidden="true" /> {T.btnWhatsapp}
        </button>
      </div>
      {cheia && <p className="vst-cmpDica">{T.limite}</p>}
      {!temMaterial && <p className="vst-cmpDica">{T.dicaSemMaterial}</p>}
    </section>
  );
}
