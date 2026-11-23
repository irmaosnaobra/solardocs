'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FIN_BOTOES, FIN_CARENCIA_MAX, FIN_PRAZO_MAX, carenciaDias, comCarenciaPadrao, dataBRFin, dataIsoValida, diasEntreIso,
  lerDinheiroFin, limitarPrimeiraParcela, parcelaAutomaticaFin, parcelaFinanciamento, parcelaManualFin,
  prazosFinanciamento, primeiraParcelaFin, somarDiasIso, taxaPrazoFin,
} from '@/lib/propostaFinanciamento';
import css from './FinanciamentoCampos.module.css';

/**
 * Campos do financiamento da proposta solar e da off-grid: prazos em botões (12 a 96) mais "Outro prazo" (até 120),
 * carência em dias, data da 1ª parcela (as duas ligadas) e parcela digitada por prazo. Quem usa só passa os dados no
 * formato do servidor (`pag_fin_N`, `fin_*`) e recebe de volta o que mudou. As contas moram em
 * lib/propostaFinanciamento.ts, a mesma do PDF.
 *
 * Regra: se o preço do projeto ou a taxa de um prazo mudar, a parcela digitada volta ao automático (preço: todas).
 */

type Dados = Record<string, unknown>;

export interface FinanciamentoCamposProps {
  /** Campos como o servidor lê: pag_fin_N, taxa_fin_N, taxa_fin_livre, fin_carencia_dias, fin_primeira_parcela, fin_prazo_livre, fin_parcela_manual_N. */
  dados: Dados;
  /** Devolve só o que mudou, com os mesmos nomes. */
  onPatch: (patch: Dados) => void;
  investimento: number;
  /** Data base (aaaa-mm-dd): o dia da proposta. A 1ª parcela fica entre ela e ela + 120 dias. */
  baseIso: string;
  /** Mostra a taxa ao mês de cada prazo (proposta solar). Na off-grid a taxa é uma só e fica fora daqui. */
  taxaPorPrazo?: boolean;
  /** Classe dos campos de texto da tela que usa: 'input-field' (solar) ou 'og-input' (off-grid). */
  classeInput?: string;
  /** Esconde os valores (teste grátis da off-grid). */
  oculto?: boolean;
}

const OCULTO = 'R$ •••••';

const brl2 = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soDigitos = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);
const ehBotaoFin = (n: number) => (FIN_BOTOES as readonly number[]).includes(n);

/** "123456" vira "1.234,56". */
function mascaraMoeda(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  const n = parseInt(d, 10);
  return `${Math.floor(n / 100).toLocaleString('pt-BR')},${String(n % 100).padStart(2, '0')}`;
}

export default function FinanciamentoCampos({
  dados, onPatch, investimento, baseIso, taxaPorPrazo = false, classeInput = 'input-field', oculto = false,
}: FinanciamentoCamposProps) {
  // Campo de carência vazio conta como 90 na tela, nunca como documento antigo.
  const f: Dados = comCarenciaPadrao(dados);
  const dias = carenciaDias(f);
  const dataTexto = dataIsoValida(dados.fin_primeira_parcela) ?? primeiraParcelaFin(f, baseIso).iso;
  const limiteMax = somarDiasIso(baseIso, FIN_CARENCIA_MAX);
  const foraDoLimite = diasEntreIso(baseIso, dataTexto) < 0 || diasEntreIso(baseIso, dataTexto) > FIN_CARENCIA_MAX;
  const ativos = prazosFinanciamento(f);
  const livreTexto = String(dados.fin_prazo_livre ?? '');
  const txt = (v: number) => (oculto ? OCULTO : brl2(v));

  // Taxa que vale em cada prazo dos botões (e a do "Outro prazo", na chave 0). Muda a conta, então muda a assinatura.
  const taxas: Record<number, number> = { 0: taxaPrazoFin(f, 0) };
  for (const n of FIN_BOTOES) taxas[n] = taxaPrazoFin(f, n);
  const assinaturaTaxas = [0, ...FIN_BOTOES].map((n) => taxas[n]).join('|');

  // Valor que mudou (preço ou taxa): a parcela digitada volta ao automático e a pessoa é avisada.
  const [avisoVolta, setAvisoVolta] = useState(false);
  const ultimo = useRef({ dados, onPatch });
  const anterior = useRef<{ inv: number; taxas: Record<number, number> } | null>(null);
  useEffect(() => { ultimo.current = { dados, onPatch }; });
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = { inv: investimento, taxas };
    if (!antes) return; // primeira vez na tela: documento aberto não perde o que foi digitado
    const todas = antes.inv > 0 && antes.inv !== investimento;
    const patch: Dados = {};
    for (const k of Object.keys(ultimo.current.dados)) {
      const m = /^fin_parcela_manual_(\d+)$/.exec(k);
      if (!m || lerDinheiroFin(ultimo.current.dados[k]) <= 0) continue;
      const n = Number(m[1]);
      const chave = ehBotaoFin(n) ? n : 0;
      if (todas || antes.taxas[chave] !== taxas[chave]) patch[k] = '';
    }
    if (Object.keys(patch).length === 0) return;
    ultimo.current.onPatch(patch);
    setAvisoVolta(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `taxas` sai de assinaturaTaxas
  }, [investimento, assinaturaTaxas]);
  useEffect(() => {
    if (!avisoVolta) return;
    const t = setTimeout(() => setAvisoVolta(false), 12000);
    return () => clearTimeout(t);
  }, [avisoVolta]);

  const mudarDias = (texto: string) => {
    const d = soDigitos(texto, 3);
    if (!d) { onPatch({ fin_carencia_dias: '' }); return; }
    const n = Math.min(FIN_CARENCIA_MAX, parseInt(d, 10));
    onPatch({ fin_carencia_dias: String(n), fin_primeira_parcela: somarDiasIso(baseIso, n) });
  };
  const mudarData = (iso: string) => {
    if (!dataIsoValida(iso)) return;
    const n = Math.min(FIN_CARENCIA_MAX, Math.max(0, diasEntreIso(baseIso, iso)));
    onPatch({ fin_primeira_parcela: iso, fin_carencia_dias: String(n) });
  };
  const fecharData = () => {
    // Fora do limite, a data volta para dentro dele quando o campo perde o foco.
    const iso = dataIsoValida(dados.fin_primeira_parcela);
    if (!iso) { onPatch({ fin_primeira_parcela: somarDiasIso(baseIso, dias) }); return; }
    const lim = limitarPrimeiraParcela(iso, baseIso);
    if (lim !== iso) mudarData(lim);
  };
  const fecharDias = () => {
    if (String(dados.fin_carencia_dias ?? '').trim() === '') mudarDias('90');
  };
  const mudarLivre = (texto: string) => {
    const d = soDigitos(texto, 3);
    const n = d ? Math.min(FIN_PRAZO_MAX, parseInt(d, 10)) : 0;
    onPatch({ fin_prazo_livre: d ? String(n) : '' });
  };
  const digitarParcela = (n: number, texto: string) => {
    setAvisoVolta(false);
    onPatch({ [`fin_parcela_manual_${n}`]: mascaraMoeda(texto) });
  };

  const linhas = ativos.map((n) => {
    // Proposta salva guarda a parcela digitada como número: na tela volta com a máscara (1234.5 vira 1.234,50).
    const bruto = dados[`fin_parcela_manual_${n}`];
    const manualTxt = typeof bruto === 'number' ? (bruto > 0 ? bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') : String(bruto ?? '');
    const digitada = parcelaManualFin(f, n);
    // Digitada acima do valor financiado não vale (o cálculo usa a automática): a tela diz isso em vez de marcar "Digitada".
    const ignorada = digitada > 0 && investimento > 0 && digitada > investimento;
    const temManual = digitada > 0 && !ignorada;
    const auto = parcelaAutomaticaFin(f, investimento, n);
    const valor = parcelaFinanciamento(f, investimento, n);
    const chaveTaxa = ehBotaoFin(n) ? `taxa_fin_${n}` : 'taxa_fin_livre';
    return { n, manualTxt, temManual, ignorada, auto, valor, chaveTaxa };
  });

  return (
    <div className={css.bloco}>
      <div className={css.grupo} role="group" aria-labelledby="fin-t-prazos">
        <div className={css.tit} id="fin-t-prazos">Prazos</div>
        <p className={css.dica}>Marque um ou mais. A proposta mostra uma linha por prazo.</p>
        <div className={css.chips}>
          {FIN_BOTOES.map((n) => {
            const on = dados[`pag_fin_${n}`] === true;
            return (
              <button key={n} type="button" aria-pressed={on} className={`${css.chip} ${on ? css.chipOn : ''}`}
                onClick={() => onPatch({ [`pag_fin_${n}`]: !on })}>
                {on && (
                  <svg className={css.tique} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>
                )}
                {n}x
              </button>
            );
          })}
        </div>
        <div className={css.livre}>
          <label className={css.rot} htmlFor="fin-livre">Outro prazo (meses)</label>
          <input id="fin-livre" type="text" inputMode="numeric" autoComplete="off" className={classeInput} placeholder={`1 a ${FIN_PRAZO_MAX}`}
            value={livreTexto} onChange={(e) => mudarLivre(e.target.value)} style={{ minHeight: 44 }} />
        </div>
      </div>

      <div className={css.grupo} role="group" aria-labelledby="fin-t-carencia">
        <div className={css.tit} id="fin-t-carencia">Carência e 1ª parcela</div>
        <p className={css.dica}>
          Mudar uma atualiza a outra. A data vai de {dataBRFin(baseIso)} a {dataBRFin(limiteMax)}.
        </p>
        <div className={css.par}>
          <div>
            <label className={css.rot} htmlFor="fin-carencia">Carência (dias)</label>
            <input id="fin-carencia" type="text" inputMode="numeric" autoComplete="off" className={classeInput} placeholder="90"
              value={String(dados.fin_carencia_dias ?? '')} onChange={(e) => mudarDias(e.target.value)} onBlur={fecharDias}
              style={{ minHeight: 44 }} />
          </div>
          <div>
            <label className={css.rot} htmlFor="fin-data">Data da 1ª parcela</label>
            <input id="fin-data" type="date" className={classeInput} min={baseIso} max={limiteMax}
              value={dataTexto} onChange={(e) => mudarData(e.target.value)} onBlur={fecharData}
              style={{ minHeight: 44 }} />
          </div>
        </div>
        {foraDoLimite && <p className={css.alerta} role="alert">A data está fora do limite e será ajustada.</p>}
      </div>

      {linhas.length > 0 && (
        <div className={css.grupo} role="group" aria-labelledby="fin-t-parcelas">
          <div className={css.tit} id="fin-t-parcelas">Parcela de cada prazo</div>
          <p className={css.dica}>
            Já vem calculada. O valor em destaque é o que sai na proposta. Para trocar, digite a parcela.
          </p>
          {avisoVolta && (
            <p className={css.aviso} role="status">
              As parcelas digitadas voltaram ao automático porque o valor mudou.
            </p>
          )}
          <div className={css.lista}>
            {linhas.map((l) => (
              <div key={l.n} role="group" aria-label={`Parcela de ${l.n} meses`} className={`${css.item} ${l.temManual ? css.itemManual : ''}`}>
                <div className={css.topo}>
                  <div className={css.prazo}>
                    <b>{l.n}x</b>
                    <span className={`${css.tag} ${l.temManual ? css.tagManual : css.tagAuto}`}>
                      {l.temManual ? 'Digitada' : 'Automática'}
                    </span>
                  </div>
                  <span className={css.valor}>{investimento > 0 ? txt(l.valor) : '—'}</span>
                </div>
                <div className={css.campos} style={{ gridTemplateColumns: taxaPorPrazo ? 'minmax(0, 1fr) minmax(0, 1.5fr)' : 'minmax(0, 280px)' }}>
                  {taxaPorPrazo && (
                    <div>
                      <label className={css.rot} htmlFor={`fin-taxa-${l.n}`}>Taxa ao mês (%)</label>
                      <input id={`fin-taxa-${l.n}`} type="text" inputMode="decimal" autoComplete="off" className={classeInput} placeholder="2,20"
                        value={String(dados[l.chaveTaxa] ?? '')} onChange={(e) => onPatch({ [l.chaveTaxa]: e.target.value })}
                        style={{ minHeight: 44 }} />
                    </div>
                  )}
                  <div>
                    <label className={css.rot} htmlFor={`fin-manual-${l.n}`}>Digitar a parcela (R$)</label>
                    <input id={`fin-manual-${l.n}`} type="text" inputMode="numeric" autoComplete="off"
                      className={`${classeInput} ${l.temManual ? css.manual : ''}`}
                      placeholder={investimento > 0 && !oculto ? brl2(l.auto).replace('R$ ', '') : '0,00'} disabled={oculto}
                      value={l.manualTxt} onChange={(e) => digitarParcela(l.n, e.target.value)}
                      style={{ minHeight: 44 }} />
                  </div>
                </div>
                {l.ignorada && (
                  <div className={css.rodape}>
                    <span>Parcela maior que o valor financiado. Vale a automática.</span>
                    <button type="button" className={css.voltar} onClick={() => onPatch({ [`fin_parcela_manual_${l.n}`]: '' })}>
                      Limpar
                    </button>
                  </div>
                )}
                {l.temManual && (
                  <div className={css.rodape}>
                    <span>Automática: <b>{investimento > 0 ? txt(l.auto) : '—'}</b></span>
                    <button type="button" className={css.voltar} onClick={() => onPatch({ [`fin_parcela_manual_${l.n}`]: '' })}>
                      Voltar ao automático
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
