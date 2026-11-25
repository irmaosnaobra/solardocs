'use client';

// ───────────────────────────────────────────────────────────────────────────
// Faixa dos países no topo da Domina IA (19/11/2026): bandeira, hora local ao vivo
// e um balão com as vendas do país no período escolhido. Fica acima das sub-abas.
//
// Vendas: vendas.porPais do resumo (DominaiaResumoContexto). Visitantes: só quando o
// Funil já leu o período sem filtro (sem chamada a mais). Resumo fora = só bandeira e hora.
// Ordem: mais vendas, depois mais visitantes, depois alfabética.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import st from './DominaiaPaises.module.css';
import { fmtInt, fmtUsd } from './dominaiaComum';
import { nomePais } from './dominaiaResumoComum';
import { useResumoDominaia } from './DominaiaResumoContexto';
import { CONHECIDOS, PUBLICO, TURNO_NOME, horaLocal, type PaisFixo } from './dominaiaPaisesDados';

// Relógio: muda a cada 30 s. No servidor não há hora (evita diferença na hidratação).
const PASSO = 30_000;
const assinarRelogio = (avisar: () => void) => { const id = window.setInterval(avisar, PASSO); return () => window.clearInterval(id); };
const useAgora = () => useSyncExternalStore(assinarRelogio, () => Math.floor(Date.now() / PASSO) * PASSO, () => 0);

const plural = (n: number, um: string, varios: string) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

type Cartao = PaisFixo & { nome: string; vendas: number; receita: number; visitas: number | null };

function montar(porPais: { pais: string; compras: number; receitaCentavos: number }[], visitas: Record<string, number> | null): Cartao[] {
  const codigos = new Set(PUBLICO.map((p) => p.codigo));
  const valido = (c: string) => /^[A-Z]{2}$/.test(c);
  for (const v of porPais) if (valido(v.pais.toUpperCase())) codigos.add(v.pais.toUpperCase());
  for (const c of Object.keys(visitas ?? {})) if (valido(c)) codigos.add(c);

  const lista = [...codigos].map((codigo): Cartao => {
    const fixo = CONHECIDOS[codigo] ?? { codigo, curto: nomePais(codigo), fuso: '' };
    const v = porPais.find((x) => x.pais.toUpperCase() === codigo);
    return { ...fixo, nome: nomePais(codigo), vendas: v?.compras ?? 0, receita: v?.receitaCentavos ?? 0, visitas: visitas ? visitas[codigo] ?? 0 : null };
  });
  return lista.sort((a, b) => b.vendas - a.vendas || (b.visitas ?? 0) - (a.visitas ?? 0) || a.curto.localeCompare(b.curto, 'pt-BR'));
}

/** "2 vendas · US$ 27,80 · 31 visitantes": o que se sabe do país no período. */
function numeros(c: Cartao, comVendas: boolean): string[] {
  const partes: string[] = [];
  if (comVendas) {
    partes.push(plural(c.vendas, 'venda', 'vendas'));
    if (c.vendas) partes.push(fmtUsd(c.receita));
  }
  if (c.visitas !== null) partes.push(plural(c.visitas, 'visitante', 'visitantes'));
  return partes;
}

const VENDAS_EM: Record<string, string> = {
  hoje: 'Vendas de hoje', ontem: 'Vendas de ontem', '7dias': 'Vendas em 7 dias', '30dias': 'Vendas em 30 dias', maximo: 'Vendas em todo o período',
};

export default function DominaiaPaises() {
  const { dados, periodo, visitasPais } = useResumoDominaia();
  const agora = useAgora();
  const comVendas = !!dados && !dados.indisponivel;
  const cartoes = montar(comVendas ? dados.vendas.porPais : [], visitasPais);

  const caixa = useRef<HTMLElement>(null);
  const trilho = useRef<HTMLUListElement>(null);
  // O detalhe mora fora do trilho (que rola e o cortaria). Abre alinhado ao cartão, pela
  // esquerda; perto da borda direita, alinha pela direita.
  const [aberto, setAberto] = useState<{ codigo: string; esq: number; dir: number; largura: number } | null>(null);
  const ponteiro = useRef('');
  const [bordas, setBordas] = useState({ ini: false, fim: true });

  const medirBordas = () => {
    const t = trilho.current;
    if (!t) return;
    setBordas({ ini: t.scrollLeft > 4, fim: t.scrollLeft + t.clientWidth < t.scrollWidth - 4 });
  };
  // A ordem muda quando as vendas chegam: o trilho volta ao começo, onde estão os que venderam.
  // (Sem isso o encaixe da rolagem segura o cartão que estava na frente e esconde o primeiro.)
  const ordem = cartoes.map((c) => c.codigo).join(',');
  useEffect(() => { trilho.current?.scrollTo({ left: 0 }); }, [ordem]);
  useEffect(() => {
    const t = trilho.current;
    if (!t) return;
    const ro = new ResizeObserver(medirBordas);
    ro.observe(t);
    return () => ro.disconnect();
  }, []);

  // Toque fora ou Esc fecham o detalhe.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(null); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const abrir = (codigo: string, el: Element | null | undefined) => {
    const base = caixa.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (base && r) setAberto({ codigo, esq: Math.max(r.left - base.left, 8), dir: Math.max(base.right - r.right, 8), largura: base.width });
  };
  // Rolou com o detalhe aberto (foco pelo teclado, por exemplo): o detalhe acompanha o cartão.
  const aoRolar = () => {
    medirBordas();
    if (aberto) abrir(aberto.codigo, trilho.current?.querySelector(`[data-codigo="${aberto.codigo}"]`));
  };
  const rolar = (lado: 1 | -1) => trilho.current?.scrollBy({ left: lado * trilho.current.clientWidth * 0.8, behavior: 'smooth' });

  const brasilia = horaLocal('America/Sao_Paulo', agora);
  const atual = aberto ? cartoes.find((c) => c.codigo === aberto.codigo) : null;

  return (
    <section className={st.faixa} aria-labelledby="dm-paises-titulo" ref={caixa}>
      <div className={st.cabeca}>
        <h3 id="dm-paises-titulo" className={st.titulo}>Hora em cada país</h3>
        <p className={st.legenda}>
          {agora > 0 && brasilia && <span>Brasília {brasilia.hora}</span>}
          {comVendas && <span className={st.legendaVendas}><i className={st.legendaBalao} aria-hidden="true" />{VENDAS_EM[periodo] ?? 'Vendas no período'}</span>}
        </p>
      </div>

      <div className={`${st.janela} ${bordas.ini ? st.sombraIni : ''} ${bordas.fim ? st.sombraFim : ''}`}>
        <button type="button" className={`${st.seta} ${st.setaIni}`} aria-label="Ver países anteriores" hidden={!bordas.ini} onClick={() => rolar(-1)}>‹</button>
        <ul className={st.trilho} ref={trilho} onScroll={aoRolar}>
          {cartoes.map((c) => {
            const h = agora > 0 ? horaLocal(c.fuso, agora) : null;
            const texto = [c.nome, h ? `${h.hora}, ${TURNO_NOME[h.turno]}` : '', ...numeros(c, comVendas)].filter(Boolean).join(' · ');
            const B = c.Bandeira;
            return (
              <li key={c.codigo}>
                <button
                  type="button"
                  className={`${st.cartao} ${h?.turno === 'madrugada' ? st.dormindo : ''}`}
                  aria-label={texto}
                  data-codigo={c.codigo}
                  data-aberto={aberto?.codigo === c.codigo || undefined}
                  onPointerDown={(e) => { ponteiro.current = e.pointerType; }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') abrir(c.codigo, e.currentTarget); }}
                  onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAberto(null); }}
                  onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) abrir(c.codigo, e.currentTarget); }}
                  onBlur={() => setAberto(null)}
                  onClick={(e) => {
                    // Com mouse quem abre é passar por cima; no toque e no teclado, o toque alterna.
                    if (ponteiro.current === 'mouse') { ponteiro.current = ''; return; }
                    if (aberto?.codigo === c.codigo) setAberto(null); else abrir(c.codigo, e.currentTarget);
                  }}
                >
                  <span className={st.bandeiraCaixa}>
                    {B ? <B className={st.bandeira} aria-hidden="true"/> : <span className={`${st.bandeira} ${st.semBandeira}`} aria-hidden="true">{c.codigo}</span>}
                    {comVendas && c.vendas > 0 && <span className={st.balao} aria-hidden="true">{c.vendas > 99 ? '99+' : c.vendas}</span>}
                  </span>
                  <span className={st.texto} aria-hidden="true">
                    <span className={st.nome}>{c.curto}</span>
                    <span className={st.hora}>
                      {h ? h.hora : '--:--'}
                      {h && <span className={st.turno}>{TURNO_NOME[h.turno]}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={`${st.seta} ${st.setaFim}`} aria-label="Ver mais países" hidden={!bordas.fim} onClick={() => rolar(1)}>›</button>
      </div>

      {atual && aberto && (() => {
        const h = agora > 0 ? horaLocal(atual.fuso, agora) : null;
        const linha = numeros(atual, comVendas);
        return (
          <div className={st.dica} role="tooltip" style={aberto.esq + 300 <= aberto.largura ? { left: aberto.esq } : { right: Math.min(aberto.dir, Math.max(aberto.largura - 300, 8)) }}>
            <strong>{atual.nome}{h ? ` · ${h.hora}` : ''}</strong>
            <span>{linha.length ? linha.join(' · ') : 'Vendas indisponíveis agora'}{h ? ` · ${TURNO_NOME[h.turno]}` : ''}</span>
          </div>
        );
      })()}
    </section>
  );
}
