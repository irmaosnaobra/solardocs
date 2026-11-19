'use client';

// "O que mais gostam": o que os membros do Monjour mais usam no app, no período.
// Hábitos (lista, peso, instalou), quem volta (D1 a D21), em que dia do plano param,
// receitas, infusões e abas. Lê GET /admin/monjour/gostos (contrato de 19/11/2026).
// As porcentagens vêm de 0 a 100, como o pct() da api do funil.
import s from './MonjourFunilPanel.module.css';
import m from './MonjourMembros.module.css';
import { Titulo, fmtInt } from './monjourComum';
import { nomeTipoReceita } from './monjourMembrosComum';
import type { Gostos, ItemGosto } from './hubMonjourJornadas.types';

const pct = (v: number) => `${Math.round(Math.max(0, Math.min(100, v || 0))).toLocaleString('pt-BR')}%`;
const ABA: Record<string, string> = { hoy: 'Hoy', recetas: 'Recetas', compras: 'Compras', progreso: 'Progreso', plus: 'Plus', ayuda: 'Ayuda' };

export default function MonjourGostos({ g, carregando }: { g: Gostos | null; carregando: boolean }) {
  // Site fora: o uso do app chega inteiro; só a retenção (que depende das compras) fica sem dado.
  const semUso = g && !g.abas.some((a) => a.vezes > 0) && !g.recetasVistas.length && !g.infusoes.length;

  return (
    <section className={`${s.bloco} ${carregando ? m.esmaecido : ''}`} aria-labelledby="mj-gostos" aria-busy={carregando}>
      <div className={s.blocoTopo}>
        <span id="mj-gostos">
          <Titulo dica="O que os membros fizeram no app neste período. Pessoas = membros diferentes. Vezes = cada toque. O app não manda peso, medidas nem alertas de saúde: só que a pessoa registrou.">
            O que mais gostam
          </Titulo>
        </span>
      </div>

      {g?.indisponivel && (
        <p className={m.mudo} role="status">
          As compras do site não chegaram{g.motivo ? ` (${g.motivo})` : ''}. Por isso a retenção ficou sem dados. O resto é o uso do app. Tente Atualizar.
        </p>
      )}
      {!g && <p className={m.mudo}>{carregando ? 'Lendo o uso do app…' : 'Sem leitura do uso agora.'}</p>}
      {g && semUso && (
        <div className={s.vazio}>
          <strong>Ainda sem uso do app neste período.</strong>
          <span>O histórico começa no dia em que o rastreio do app foi publicado. Antes disso, o uso só existe no aparelho de cada pessoa.</span>
        </div>
      )}

      {g && !semUso && (
        <>
          <div className={m.habitos}>
            <Habito rotulo="Usam a lista de mercado" v={g.usoLista} />
            <Habito rotulo="Registram o peso" v={g.registraPeso} />
            <Habito rotulo="Instalaram o app" v={g.instalou} />
          </div>

          <div className={m.duasGraf}>
            <Retencao pontos={g.retencao} />
            <Param pontos={g.paramNoDia} />
          </div>

          <div className={m.listas3}>
            <Ranking titulo="Receitas mais vistas" itens={g.recetasVistas} unidade="vezes" />
            <Ranking titulo="Receitas mais feitas" itens={g.recetasFeitas} unidade="vezes" />
            <Ranking titulo="Receitas mais favoritadas" itens={g.favoritas} unidade="pessoas" />
          </div>
          <div className={m.listas2}>
            <Ranking titulo="Infusões mais marcadas" itens={g.infusoes} unidade="vezes" />
            <Ranking
              titulo="Uso de cada aba"
              itens={[...g.abas].sort((a, b) => b.pessoas - a.pessoas).map((a) => ({ alvo: a.aba, nome: ABA[a.aba] ?? a.aba, vezes: a.vezes, pessoas: a.pessoas }))}
              unidade="pessoas"
              todos
            />
          </div>
        </>
      )}
    </section>
  );
}

function Habito({ rotulo, v }: { rotulo: string; v: number }) {
  return (
    <div className={m.habito}>
      <div className={m.habitoValor}>{pct(v)}</div>
      <div className={m.habitoRotulo}>{rotulo}</div>
      <div className={m.habitoTrilho} aria-hidden="true"><span style={{ width: pct(v) }} /></div>
    </div>
  );
}

// Quem volta ao app N dias depois da compra: cinco colunas, D1 a D21.
function Retencao({ pontos }: { pontos: Gostos['retencao'] }) {
  const ordem = [1, 3, 7, 14, 21].map((dia) => ({ dia, pct: pontos.find((p) => p.dia === dia)?.pct ?? null }));
  const resumo = ordem.map((p) => `D${p.dia} ${p.pct === null ? 'sem dado' : pct(p.pct)}`).join(', ');
  return (
    <figure className={m.graf}>
      <figcaption className={m.grafTitulo}>Voltam ao app depois da compra</figcaption>
      <div className={m.colunas} role="img" aria-label={`Voltam ao app: ${resumo}`}>
        {ordem.map((p) => (
          <div key={p.dia} className={m.coluna}>
            <span className={m.colunaValor} title={p.pct === null ? 'Ainda não dá para medir: ninguém que comprou no período completou esse dia.' : undefined}>
              {p.pct === null ? '—' : pct(p.pct)}
            </span>
            <span className={m.colunaTrilho}><span style={{ height: `${Math.max(p.pct ?? 0, 0)}%` }} /></span>
            <span className={m.colunaDia}>D{p.dia}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

// Em que dia do plano as pessoas param: uma coluna fina por dia, a maior em destaque.
function Param({ pontos }: { pontos: Gostos['paramNoDia'] }) {
  const dias = Array.from({ length: 21 }, (_, i) => ({ dia: i + 1, pessoas: pontos.find((p) => p.dia === i + 1)?.pessoas ?? 0 }));
  const max = Math.max(1, ...dias.map((d) => d.pessoas));
  const pior = dias.reduce((a, d) => (d.pessoas > a.pessoas ? d : a), dias[0]);
  const total = dias.reduce((t, d) => t + d.pessoas, 0);
  return (
    <figure className={m.graf}>
      <figcaption className={m.grafTitulo}>
        Em que dia do plano param
        {total > 0 && <span className={m.grafNota}>Mais gente para no dia {pior.dia}: {fmtInt(pior.pessoas)} {pior.pessoas === 1 ? 'pessoa' : 'pessoas'}</span>}
      </figcaption>
      <div className={m.dias} role="img" aria-label={total ? `Pessoas que pararam por dia do plano. ${dias.filter((d) => d.pessoas).map((d) => `Dia ${d.dia}: ${d.pessoas}`).join(', ')}` : 'Ninguém parou ainda'}>
        {dias.map((d) => (
          <span key={d.dia} className={`${m.dia} ${total && d.dia === pior.dia ? m.diaPior : ''}`} title={`Dia ${d.dia}: ${fmtInt(d.pessoas)}`}>
            <span className={m.diaBarra} style={{ height: `${d.pessoas ? Math.max(6, (d.pessoas / max) * 100) : 0}%` }} />
            <span className={m.diaN}>{[1, 5, 10, 15, 21].includes(d.dia) ? d.dia : ''}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function Ranking({ titulo, itens, unidade, todos }: { titulo: string; itens: ItemGosto[]; unidade: 'vezes' | 'pessoas'; todos?: boolean }) {
  const lista = todos ? itens : itens.slice(0, 5);
  const max = Math.max(1, ...lista.map((x) => x[unidade]));
  return (
    <div className={m.ranking}>
      <h4 className={m.rankingTitulo}>{titulo}</h4>
      {lista.length === 0 ? <p className={m.mudo}>Nada ainda.</p> : (
        <ol className={m.rankingLista}>
          {lista.map((x, i) => (
            <li key={x.alvo || i} className={m.rankingItem}>
              <span className={m.rankingPos}>{i + 1}</span>
              <span className={m.rankingNome}>
                <span title={x.nome || x.alvo}>{x.nome || x.alvo}</span>
                {x.tipo && <small>{nomeTipoReceita(x.tipo)}</small>}
              </span>
              <span className={m.rankingNum}>
                <b>{fmtInt(x[unidade])}</b>
                <small>{unidade === 'vezes' ? `${fmtInt(x.pessoas)} ${x.pessoas === 1 ? 'pessoa' : 'pessoas'}` : `${fmtInt(x.vezes)} vezes`}</small>
              </span>
              <span className={m.rankingTrilho} aria-hidden="true"><span style={{ width: `${(x[unidade] / max) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
