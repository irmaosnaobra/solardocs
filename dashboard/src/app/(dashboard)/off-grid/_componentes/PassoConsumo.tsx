'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  Search, X, Plus, ChevronDown, CircleAlert,
  Sun, CloudSun, Cloud, Moon, Home, Lightbulb, ShieldCheck, Wallet,
} from 'lucide-react';
import type { EntradaOffGrid, ResultadoOffGrid, CargaLivre } from '@/lib/offgrid/engine';
import { CARGAS, GRUPOS_CARGA, ORDEM_GRUPOS, PERFIS, type Carga, type GrupoCarga } from '@/lib/offgrid/catalogo';
import { CARGAS_BLOQUEADAS } from '@/lib/offgrid/constantes';
import { lerNumero, formatarNumero } from '@/lib/offgrid/dinheiro';
import { iconeDaCarga, ICONE_GRUPO, ICONE_PERFIL, Tomada } from '@/lib/offgrid/icones';
import { Escolha, Escolhas } from '@/components/Escolha/Escolha';
import InfoHint from '@/components/InfoHint/InfoHint';
import { nb } from './util';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const horasTxt = (h: number) => String(h).replace('.', ',');

/** Campo de horas com texto próprio: a vírgula não some enquanto a pessoa digita. */
function CampoHoras({ valor, onValor, rotulo }: { valor: number; onValor: (n: number) => void; rotulo: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <input className="og-input og2-pequeno" type="text" inputMode="decimal" aria-label={rotulo}
      value={txt ?? horasTxt(valor)}
      onChange={(ev) => { setTxt(ev.target.value); onValor(Math.min(24, lerNumero(ev.target.value))); }}
      onBlur={() => setTxt(null)} />
  );
}

export default function PassoConsumo({
  e, setE, r,
}: {
  e: EntradaOffGrid;
  setE: Dispatch<SetStateAction<EntradaOffGrid>>;
  r: ResultadoOffGrid;
}) {
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState<GrupoCarga | ''>('');
  const [mostrarLivre, setMostrarLivre] = useState(false);
  const [novo, setNovo] = useState({ nome: '', w: '', h: '', qtd: '1', motor: false });
  const [consumoTxt, setConsumoTxt] = useState<string | null>(null);

  const set = <K extends keyof EntradaOffGrid>(k: K, v: EntradaOffGrid[K]) =>
    setE((prev) => ({ ...prev, [k]: v }));

  const qtdDe = (id: string) => e.qtds[id] || 0;
  const mudaQtd = (id: string, delta: number) =>
    setE((prev) => ({ ...prev, qtds: { ...prev.qtds, [id]: Math.max(0, Math.min(99, (prev.qtds[id] || 0) + delta)) } }));
  const horasDe = (c: Carga) => (typeof e.horas[c.id] === 'number' ? e.horas[c.id] : c.h);
  const essDe = (c: Carga) => (typeof e.essenciais[c.id] === 'boolean' ? e.essenciais[c.id] : !!c.essencial);

  const marcadas = CARGAS.filter((c) => qtdDe(c.id) > 0);
  const total = marcadas.length + e.personalizados.length;

  /** Perfil pronto substitui a lista inteira (não soma na que já estava). */
  const aplicarPerfil = (qtds: Record<string, number>) => {
    setE((prev) => ({ ...prev, modoConsumo: 'cargas', qtds: { ...qtds }, horas: {}, essenciais: {}, personalizados: [] }));
    setBusca(''); setGrupo('');
  };

  const termo = semAcento(busca);
  const achados: Carga[] = termo
    ? CARGAS.filter((c) => semAcento(c.nome).includes(termo)).slice(0, 12)
    : grupo ? CARGAS.filter((c) => c.grupo === grupo) : [];

  const addLivre = () => {
    const w = lerNumero(novo.w);
    if (!novo.nome.trim() || w <= 0) return;
    const item: CargaLivre = {
      id: `livre-${Date.now()}`,
      nome: novo.nome.trim().slice(0, 80),
      w,
      h: Math.min(24, lerNumero(novo.h) || 1),
      qtd: Math.max(1, Math.round(lerNumero(novo.qtd)) || 1),
      motor: novo.motor, momentanea: false, essencial: false,
    };
    setE((prev) => ({ ...prev, personalizados: [...prev.personalizados, item] }));
    setNovo({ nome: '', w: '', h: '', qtd: '1', motor: false });
  };
  const mudaLivre = (id: string, patch: Partial<CargaLivre>) =>
    setE((prev) => ({ ...prev, personalizados: prev.personalizados.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const removeLivre = (id: string) =>
    setE((prev) => ({ ...prev, personalizados: prev.personalizados.filter((p) => p.id !== id) }));

  const usaKwh = e.modoConsumo === 'conta';

  return (
    <div className="og-card">
      <h2 className="og2-h2">O que vai ligar</h2>
      <p className="og2-sub">Escolha um perfil e ajuste a lista abaixo.</p>

      <div className="og2-perfis">
        {PERFIS.map((p) => {
          const IP = ICONE_PERFIL[p.id] ?? Tomada;
          return (
            <button key={p.id} type="button" className="og2-perfil" onClick={() => aplicarPerfil(p.qtds)}>
              <IP size={18} />
              <b>{p.nome}</b>
              <small>{p.desc}</small>
            </button>
          );
        })}
      </div>

      <div className={`og2-sec ${usaKwh ? 'og2-off' : ''}`}>
        <div className="og2-sec-topo">
          <h3>Aparelhos</h3>
          {total > 0 && (
            <button type="button" className="og2-link" onClick={() => aplicarPerfil({})}>Limpar a lista</button>
          )}
        </div>

        {total === 0 && <p className="og-hint">Nenhum aparelho na lista. Escolha um perfil ou adicione abaixo.</p>}

        <div className="og2-aps">
          {marcadas.map((c) => {
            const q = qtdDe(c.id);
            const h = horasDe(c);
            const IC = iconeDaCarga(c.id, c.grupo);
            return (
              <div className="og2-ap" key={c.id}>
                <div className="og2-ap-nome">
                  <IC size={20} className="og2-ap-ic" />
                  <div>
                    <div className="og2-ap-n">{c.nome}</div>
                    <div className="og2-ap-m">
                      {c.w} W
                      {c.motor && <span className="og-tag" title="Puxa 3 a 5 vezes na partida">motor</span>}
                      {c.momentanea && <span className="og-tag" title="Uso rápido: pesa no pico, quase nada no consumo">uso rápido</span>}
                    </div>
                  </div>
                </div>
                <div className="og-stepper" aria-label={`Quantidade de ${c.nome}`}>
                  <button type="button" onClick={() => mudaQtd(c.id, -1)} aria-label="menos">−</button>
                  <span>{q}</span>
                  <button type="button" onClick={() => mudaQtd(c.id, +1)} aria-label="mais">+</button>
                </div>
                <label className="og2-ap-h">
                  <CampoHoras valor={h} rotulo={`Horas por dia de ${c.nome}`}
                    onValor={(n) => setE((prev) => ({ ...prev, horas: { ...prev.horas, [c.id]: n } }))} />
                  <span>{c.continuo ? 'h/dia de motor' : 'h/dia'}</span>
                </label>
                <button type="button" className={`og-ess ${essDe(c) ? 'on' : ''}`}
                  onClick={() => setE((prev) => ({ ...prev, essenciais: { ...prev.essenciais, [c.id]: !essDe(c) } }))}
                  title="Precisa continuar funcionando nos dias sem sol?">
                  {essDe(c) ? 'Essencial' : 'Pode faltar'}
                </button>
                <button type="button" className="og2-rm" aria-label={`Remover ${c.nome}`}
                  onClick={() => setE((prev) => ({ ...prev, qtds: { ...prev.qtds, [c.id]: 0 } }))}>
                  <X size={16} />
                </button>
              </div>
            );
          })}

          {e.personalizados.map((p) => (
            <div className="og2-ap" key={p.id}>
              <div className="og2-ap-nome">
                <Tomada size={20} className="og2-ap-ic" />
                <div>
                  <div className="og2-ap-n">{p.nome || 'Aparelho sem nome'}</div>
                  <div className="og2-ap-m">
                    {nb(p.w, 0)} W
                    {p.motor && <span className="og-tag">motor</span>}
                  </div>
                </div>
              </div>
              <div className="og-stepper" aria-label={`Quantidade de ${p.nome}`}>
                <button type="button" onClick={() => mudaLivre(p.id, { qtd: Math.max(1, p.qtd - 1) })} aria-label="menos">−</button>
                <span>{p.qtd}</span>
                <button type="button" onClick={() => mudaLivre(p.id, { qtd: Math.min(99, p.qtd + 1) })} aria-label="mais">+</button>
              </div>
              <label className="og2-ap-h">
                <CampoHoras valor={p.h} rotulo={`Horas por dia de ${p.nome}`} onValor={(n) => mudaLivre(p.id, { h: n })} />
                <span>h/dia</span>
              </label>
              <button type="button" className={`og-ess ${p.essencial ? 'on' : ''}`}
                onClick={() => mudaLivre(p.id, { essencial: !p.essencial })}>
                {p.essencial ? 'Essencial' : 'Pode faltar'}
              </button>
              <button type="button" className="og2-rm" aria-label={`Remover ${p.nome}`} onClick={() => removeLivre(p.id)}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="og2-add">
          <div className="og-buscabar">
            <Search size={15} />
            <input className="og-buscainput" type="text" value={busca} aria-label="Buscar aparelho"
              placeholder={`Adicionar aparelho (ex.: air fryer, bomba, ar). São ${CARGAS.length} no catálogo.`}
              onChange={(ev) => setBusca(ev.target.value)} />
          </div>
          <div className="og-chips og2-gchips">
            {ORDEM_GRUPOS.map((g) => {
              const IG = ICONE_GRUPO[g];
              return (
                <button key={g} type="button" className={`og-chip og2-chip-peq ${grupo === g && !termo ? 'on' : ''}`}
                  aria-pressed={grupo === g && !termo}
                  onClick={() => { setBusca(''); setGrupo(grupo === g ? '' : g); }}>
                  <IG size={15} /> {GRUPOS_CARGA[g]}
                </button>
              );
            })}
          </div>
          {(termo || grupo) && (
            achados.length === 0
              ? <p className="og-hint">Nenhum aparelho com esse nome. Use &ldquo;Adicionar um aparelho que não está na lista&rdquo;.</p>
              : (
                <div className="og2-achados">
                  {achados.map((c) => {
                    const IC = iconeDaCarga(c.id, c.grupo);
                    const q = qtdDe(c.id);
                    return (
                      <button key={c.id} type="button" className="og2-achado" onClick={() => mudaQtd(c.id, +1)}>
                        <IC size={18} />
                        <span>{c.nome} <small>{c.w} W</small></span>
                        <em>{q > 0 ? `na lista: ${q}` : 'adicionar'}</em>
                        <Plus size={15} />
                      </button>
                    );
                  })}
                </div>
              )
          )}

          <button type="button" className="og2-acc" aria-expanded={mostrarLivre} onClick={() => setMostrarLivre((v) => !v)}>
            <span>Adicionar um aparelho que não está na lista</span>
            <ChevronDown size={16} className={mostrarLivre ? 'og-chev og-chev-on' : 'og-chev'} />
          </button>
          {mostrarLivre && (
            <div className="og2-livre">
              <div className="og2-livre-form">
                <input className="og-input" type="text" placeholder="Nome do aparelho" aria-label="Nome do aparelho" value={novo.nome}
                  onChange={(ev) => setNovo({ ...novo, nome: ev.target.value })} />
                <input className="og-input" type="text" placeholder="Watts" aria-label="Potência em watts" inputMode="decimal" value={novo.w}
                  onChange={(ev) => setNovo({ ...novo, w: ev.target.value })} />
                <input className="og-input" type="text" placeholder="h/dia" aria-label="Horas por dia" inputMode="decimal" value={novo.h}
                  onChange={(ev) => setNovo({ ...novo, h: ev.target.value })} />
                <input className="og-input" type="text" placeholder="Qtd" aria-label="Quantidade" inputMode="numeric" value={novo.qtd}
                  onChange={(ev) => setNovo({ ...novo, qtd: ev.target.value })} />
              </div>
              <label className="og2-chk">
                <input type="checkbox" checked={novo.motor} onChange={(ev) => setNovo({ ...novo, motor: ev.target.checked })} />
                <span>Tem motor (compressor, bomba ou qualquer coisa que gire)</span>
              </label>
              <button type="button" className="og-btn og-btn-ghost og2-btn-sm" onClick={addLivre}
                disabled={!novo.nome.trim() || lerNumero(novo.w) <= 0}>
                Adicionar aparelho
              </button>
              <p className="og-hint">A potência está na etiqueta do aparelho ou no manual. Motor muda a conta do inversor.</p>
            </div>
          )}
        </div>
      </div>

      <label className="og2-chk og2-chk-kwh">
        <input type="checkbox" checked={usaKwh} onChange={(ev) => set('modoConsumo', ev.target.checked ? 'conta' : 'cargas')} />
        <span>Prefiro digitar o consumo do mês (kWh)</span>
      </label>
      {usaKwh && (
        <div className="og2-grid2">
          <div>
            <label className="og-label" htmlFor="og-kwh">Consumo do mês (kWh), sem o chuveiro</label>
            <input id="og-kwh" className="og-input" type="text" inputMode="decimal"
              value={consumoTxt ?? formatarNumero(e.consumoMensalKwh)}
              onChange={(ev) => { setConsumoTxt(ev.target.value); set('consumoMensalKwh', lerNumero(ev.target.value)); }}
              onBlur={() => setConsumoTxt(null)} />
          </div>
          <div>
            <label className="og-label" htmlFor="og-ess-frac">
              Quanto disso é essencial
              <InfoHint>
                O essencial é o que não pode faltar nos dias sem sol. É ele que define o tamanho da bateria.
              </InfoHint>
            </label>
            <select id="og-ess-frac" className="og-select" value={String(e.fracaoEssencial)}
              onChange={(ev) => set('fracaoEssencial', parseFloat(ev.target.value))}>
              <option value="0.3">30%: só geladeira e luz</option>
              <option value="0.45">45%: geladeira, luz, água, internet</option>
              <option value="0.6">60%: quase tudo menos conforto</option>
              <option value="1">100%: a casa inteira</option>
            </select>
          </div>
        </div>
      )}

      {!usaKwh && total > 0 && (
        <div className="og-resumo-cargas">
          <div><span>Consumo total</span><strong>{nb(r.consumoTotalDia)} kWh/dia</strong></div>
          <div><span>Do essencial</span><strong>{nb(r.consumoEssencialDia)} kWh/dia</strong></div>
          <div><span>Pico exigido</span><strong>{nb(r.demandaPico / 1000, 1)} kW</strong></div>
        </div>
      )}

      <details className="og2-bloq">
        <summary><CircleAlert size={14} /> O que não entra em off-grid</summary>
        <ul>
          {CARGAS_BLOQUEADAS.map((b) => (
            <li key={b.nome}><strong>{b.nome}</strong> ({b.w.toLocaleString('pt-BR')} W): troque por {b.saida.toLowerCase()}</li>
          ))}
        </ul>
        <p className="og-hint">Um banho de 15 minutos come 1,4 kWh, quase um terço de uma bateria.</p>
      </details>

      <div className="og2-sec">
        <h3>Quantos dias sem sol o sistema precisa aguentar</h3>
        <Escolhas colunas={5}>
          {([[1, 'o mais barato'], [2, 'o equilibrado'], [3, 'bem tranquilo'],
             [4, 'sítio isolado'], [5, 'sem socorro perto']] as const).map(([d, desc]) => (
            <Escolha key={d} numero on={e.diasAutonomia === d} onClick={() => set('diasAutonomia', d)}
              titulo={String(d)} desc={`${d === 1 ? 'dia' : 'dias'}: ${desc}`} />
          ))}
        </Escolhas>
      </div>

      <details className="og2-avancado">
        <summary>Ajustes avançados <span>(o que o banco segura, sombra, uso de dia, critério de sol)</span></summary>
        <div className="og2-av-corpo">
          <label className="og-label">O banco segura o quê</label>
          <Escolhas colunas={2}>
            <Escolha on={e.autonomiaSobre === 'essencial'} icone={Lightbulb} onClick={() => set('autonomiaSobre', 'essencial')}
              titulo="Só o essencial" desc="geladeira, luz, água e internet" />
            <Escolha on={e.autonomiaSobre === 'tudo'} icone={Home} onClick={() => set('autonomiaSobre', 'tudo')}
              titulo="A casa inteira" desc="tudo que está marcado" />
          </Escolhas>

          <label className="og-label og2-mt">Sombra nas placas</label>
          <Escolhas colunas={3}>
            {([['nenhuma', 'Sem sombra', 'telhado limpo o dia todo', Sun],
               ['leve', 'Sombra leve', 'perde 8% da geração', CloudSun],
               ['media', 'Sombra média', 'perde 18%, kit maior', Cloud]] as const).map(([id, t, d, Ic]) => (
              <Escolha key={id} on={e.sombra === id} icone={Ic} onClick={() => set('sombra', id)} titulo={t} desc={d} />
            ))}
          </Escolhas>

          <label className="og-label og2-mt">Quanto do consumo roda de dia</label>
          <Escolhas colunas={3}>
            {([[0.2, 'Quase à noite', 'banco trabalha mais', Moon],
               [0.4, 'Metade a metade', 'o mais comum', CloudSun],
               [0.65, 'Mais de dia', 'bomba e ar com sol', Sun]] as const).map(([v, t, d, Ic]) => (
              <Escolha key={v} on={Math.abs(e.fracaoDiurna - v) < 0.01} icone={Ic} onClick={() => set('fracaoDiurna', v)} titulo={t} desc={d} />
            ))}
          </Escolhas>

          <label className="og-label og2-mt">
            Critério de sol
            <InfoHint>
              Pelo mês de menos sol, o sistema fecha a conta em junho também. Pela média o kit sai mais barato, mas no
              inverno o banco não recompõe e o cliente sente.
            </InfoHint>
          </label>
          <Escolhas colunas={2}>
            <Escolha on={e.criterioHsp === 'pior'} icone={ShieldCheck} onClick={() => set('criterioHsp', 'pior')}
              titulo="Mês de menos sol" desc="fecha a conta em junho também" />
            <Escolha on={e.criterioHsp === 'media'} icone={Wallet} onClick={() => set('criterioHsp', 'media')}
              titulo="Média do ano" desc="mais barato, falta no inverno" />
          </Escolhas>

          {usaKwh && (
            <div className="og2-mt">
              <label className="og-label" htmlFor="og-motor">
                Maior motor da instalação
                <InfoHint>
                  Motor puxa de 3 a 5 vezes a potência na partida. Com a lista de aparelhos, a ferramenta calcula o maior
                  motor sozinha. Só preencha se digitar o consumo do mês.
                </InfoHint>
              </label>
              <select id="og-motor" className="og-select" value={String(e.maiorMotorW)}
                onChange={(ev) => set('maiorMotorW', parseFloat(ev.target.value))}>
                <option value="150">Só geladeira</option>
                <option value="550">Bomba d&apos;água 1/2 cv</option>
                <option value="750">Ar-condicionado 9.000 BTU</option>
                <option value="1100">Bomba de 1 cv</option>
                <option value="2200">Bomba submersa de 2 cv</option>
              </select>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
