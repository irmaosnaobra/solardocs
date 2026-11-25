'use client';

// Quem chegou e quem saiu numa tela do funil da Domina IA. Abre na gaveta ao clicar no
// número de uma etapa. Duas abas (Chegaram, Saíram aqui), 50 por página até 500,
// com os mesmos filtros do funil. Clicar numa sessão abre a jornada dela ali mesmo.
// Lê GET /admin/dominaia/quiz-funil/sessoes (contrato de 19/11/2026).
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import g from './DominaiaJornadas.module.css';
import { fmtInt } from './dominaiaComum';
import { fmtQuando } from './dominaiaResumoComum';
import DominaiaGaveta from './DominaiaGaveta';
import DominaiaSessaoJornada, { Local, Aparelho, Resultado } from './DominaiaSessaoJornada';
import { lerPaginaSessoes, type PaginaSessoes, type SessaoQuiz, type TipoSessoes } from './hubDominaiaJornadas.types';

export type FiltrosFunil = { periodo: string; pais: string; disp: string; anuncio: string; conjunto: string };
export type AlvoSessoes = { n: number; rotulo: string; chegaram: number; sairam: number; temSaida: boolean; tipo: TipoSessoes };

export default function DominaiaSessoesGaveta({ alvo, filtros, resumoFiltros, nomeEtapa, aoFechar }: {
  alvo: AlvoSessoes | null;
  filtros: FiltrosFunil;
  /** "Hoje · México · Celular": o que vale na lista, escrito. */
  resumoFiltros: string;
  nomeEtapa: (n: number) => string;
  aoFechar: () => void;
}) {
  const [sid, setSid] = useState<string | null>(null);
  const titulo = alvo ? `${alvo.n}. ${alvo.rotulo}` : '';

  return (
    <DominaiaGaveta
      aberta={!!alvo}
      aoFechar={() => { setSid(null); aoFechar(); }}
      larga
      chave={sid ?? 'lista'}
      titulo={sid ? 'Jornada da sessão' : titulo}
      sub={sid ? `Aberta a partir de ${titulo}` : resumoFiltros}
      aoVoltar={sid ? () => setSid(null) : undefined}
      rotuloVoltar="Lista"
    >
      {alvo && (
        <>
          {/* A lista fica montada atrás da jornada: voltar não lê de novo e mantém a página. */}
          <div hidden={!!sid}>
            <ListaSessoes key={`${alvo.n}-${alvo.tipo}`} alvo={alvo} filtros={filtros} nomeEtapa={nomeEtapa} abrir={setSid} />
          </div>
          {sid && <DominaiaSessaoJornada sid={sid} nomeEtapa={nomeEtapa} />}
        </>
      )}
    </DominaiaGaveta>
  );
}

function ListaSessoes({ alvo, filtros, nomeEtapa, abrir }: {
  alvo: AlvoSessoes; filtros: FiltrosFunil; nomeEtapa: (n: number) => string; abrir: (sid: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoSessoes>(alvo.tipo);
  const [cursores, setCursores] = useState<(string | null)[]>([null]);
  const [dados, setDados] = useState<PaginaSessoes | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const pagina = cursores.length - 1;
  const cursor = cursores[pagina];

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ period: filtros.periodo, passo: String(alvo.n), tipo });
    for (const k of ['pais', 'disp', 'anuncio', 'conjunto'] as const) if (filtros[k]) q.set(k, filtros[k]);
    if (cursor) q.set('cursor', cursor);
    api.get(`/admin/dominaia/quiz-funil/sessoes?${q.toString()}`)
      .then((r) => {
        if (!vivo) return;
        const d = lerPaginaSessoes(r.data);
        if (d) { setDados(d); setErro(''); } else setErro('Resposta inesperada da api');
      })
      .catch((e) => { if (vivo) setErro(String(e?.response?.data?.error || e?.message || e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [alvo.n, tipo, cursor, filtros]);

  const trocarTipo = (t: TipoSessoes) => { if (t !== tipo) { setCarregando(true); setTipo(t); setCursores([null]); setDados(null); } };
  const avancar = () => { if (dados?.proximo) { setCarregando(true); setCursores((c) => [...c, dados.proximo]); } };
  const recuar = () => { if (pagina > 0) { setCarregando(true); setCursores((c) => c.slice(0, -1)); } };

  const itens = dados?.itens ?? [];
  const total = dados?.total ?? 0;
  const de = pagina * 50 + 1;
  const ate = pagina * 50 + itens.length;
  const ABAS: { k: TipoSessoes; label: string; n: number }[] = [{ k: 'chegaram', label: 'Chegaram', n: alvo.chegaram }];
  if (alvo.temSaida) ABAS.push({ k: 'sairam', label: 'Saíram aqui', n: alvo.sairam });

  return (
    <>
      <div className={g.abas} role="group" aria-label="Quem mostrar">
        {ABAS.map((a) => (
          <button key={a.k} type="button" aria-pressed={tipo === a.k} className={g.aba} onClick={() => trocarTipo(a.k)}>
            {a.label} <span className={g.abaNum}>{fmtInt(a.n)}</span>
          </button>
        ))}
      </div>

      <div className={g.listaTopo} aria-live="polite">
        {carregando && <span>Lendo as sessões…</span>}
        {!carregando && dados && total > 0 && (
          <span>{fmtInt(de)} a {fmtInt(ate)} de {fmtInt(total)} {total === 1 ? 'sessão' : 'sessões'}{total > 500 ? '. A lista vai até as 500 primeiras.' : ''}</span>
        )}
      </div>

      {erro && <div className={`${admin.card} ${g.aviso}`} role="alert">Não consegui ler as sessões: {erro}. Feche e abra de novo.</div>}
      {!erro && dados && itens.length === 0 && (
        <div className={g.vazioGaveta}>
          <strong>{tipo === 'sairam' ? 'Ninguém saiu nesta tela.' : 'Ninguém chegou nesta tela.'}</strong>
          <span>Com o período e os filtros de agora.</span>
        </div>
      )}

      {itens.length > 0 && (
        <div className={`${g.rolagem} ${carregando ? g.esmaecido : ''}`}>
          <table className={g.tabela}>
            <thead>
              <tr>
                <th scope="col">Entrou</th><th scope="col">Local</th><th scope="col">Aparelho</th>
                <th scope="col">Idade</th><th scope="col">Objetivo</th><th scope="col">Corpo</th>
                <th scope="col">Anúncio e conjunto</th><th scope="col">Até a tela</th><th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((x) => <LinhaSessao key={x.sid} x={x} nomeEtapa={nomeEtapa} abrir={abrir} />)}
            </tbody>
          </table>
        </div>
      )}

      {dados && (pagina > 0 || dados.proximo) && (
        <nav className={g.paginas} aria-label="Páginas">
          <button type="button" className={admin.periodBtn} disabled={pagina === 0 || carregando} onClick={recuar}>
            <ChevronLeft size={16} aria-hidden="true" /> Anterior
          </button>
          <span>Página {pagina + 1} de {Math.max(1, Math.ceil(Math.min(total, 500) / 50))}</span>
          <button type="button" className={admin.periodBtn} disabled={!dados.proximo || carregando} onClick={avancar}>
            Próxima <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </>
  );
}

function LinhaSessao({ x, nomeEtapa, abrir }: { x: SessaoQuiz; nomeEtapa: (n: number) => string; abrir: (sid: string) => void }) {
  const ate = nomeEtapa(x.maxPasso);
  return (
    <tr className={g.linhaClicavel} onClick={() => abrir(x.sid)}>
      <td data-rotulo="Entrou" className={g.celEntrou}>
        <button type="button" className={g.abrirSessao} onClick={(e) => { e.stopPropagation(); abrir(x.sid); }}>
          {fmtQuando(x.entrou)}
          <span className={g.someVisual}>, ver a jornada</span>
        </button>
      </td>
      <td data-rotulo="Local"><Local x={x} /></td>
      <td data-rotulo="Aparelho"><Aparelho x={x} /></td>
      <td data-rotulo="Idade" className={g.celIdade}>{x.idade || <span className={g.mudo}>—</span>}</td>
      <td data-rotulo="Objetivo" className={g.celTexto} title={x.objetivo}>{x.objetivo || <span className={g.mudo}>—</span>}</td>
      <td data-rotulo="Corpo" className={g.celTexto} title={x.cuerpo}>{x.cuerpo || <span className={g.mudo}>—</span>}</td>
      <td data-rotulo="Anúncio" className={g.celAnuncio}>
        <span className={g.duasLinhas} title={x.anuncio}>{x.anuncio || 'Sem anúncio'}</span>
        {x.conjunto && <small>{x.conjunto}</small>}
      </td>
      <td data-rotulo="Até a tela" className={g.celAte} title={`${x.maxPasso}. ${ate}`}>
        <b>{x.maxPasso}</b> <span>{ate}</span>
      </td>
      <td data-rotulo="Resultado"><Resultado x={x} /></td>
    </tr>
  );
}
