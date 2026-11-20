'use client';

// "Tentaram pagar e não pagaram": quem abriu o pagamento do Monjour e não terminou, com o motivo.
// Vem de resumo.checkouts (o site lê a Stripe). O período é o que o painel já usa.
// O sid abre a jornada da sessão numa gaveta, a mesma da aba Funil.
import { useMemo, useState } from 'react';
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import g from './MonjourJornadas.module.css';
import { fmtInt, fmtUsd } from './monjourComum';
import { fmtQuando, nomePais, nomePlano } from './monjourResumoComum';
import MonjourGaveta from './MonjourGaveta';
import MonjourSessaoJornada from './MonjourSessaoJornada';
import type { CheckoutMonjour, CheckoutsMonjour } from './hubMonjourResumo.types';

const FALHA_3DS = new Set(['authentication_required', 'payment_intent_authentication_failure', 'authentication_not_supported']);
const TEXTOS: Record<string, string> = {
  card_declined: 'Cartão recusado',
  insufficient_funds: 'Sem saldo',
  expired_card: 'Cartão vencido',
  incorrect_cvc: 'Código de segurança errado',
};

/** O motivo em português. Código que não conhecemos aparece como veio, para não esconder nada. */
export function nomeMotivo(c: Pick<CheckoutMonjour, 'motivo' | 'status'>): string {
  if (TEXTOS[c.motivo]) return TEXTOS[c.motivo];
  if (FALHA_3DS.has(c.motivo)) return 'Não confirmou no banco';
  if (c.motivo === 'sem_tentativa' || !c.motivo) return c.status === 'expired' ? 'Saiu sem tentar pagar' : 'Ainda na tela de pagamento';
  return c.motivo;
}

const seloDe = (c: Pick<CheckoutMonjour, 'motivo' | 'status'>) =>
  c.motivo === 'sem_tentativa' || !c.motivo ? (c.status === 'expired' ? r.seloAtencao : r.seloPlus) : r.seloRuim;

/**
 * Totais por motivo, do `porMotivo` da api (conta tudo, mesmo quando a lista vem cortada). Motivos que dão o mesmo
 * texto somam. O "sem tentativa" só se divide em "saiu" e "ainda está lá" quando a lista tem todas as linhas;
 * cortada, vira um total só. Mais comum primeiro.
 */
export function totaisPorMotivo(c: Extract<CheckoutsMonjour, { indisponivel: false }>): { texto: string; n: number; classe: string }[] {
  const mapa = new Map<string, { texto: string; n: number; classe: string }>();
  const soma = (texto: string, n: number, classe: string) => {
    if (n <= 0) return;
    const atual = mapa.get(texto) ?? { texto, n: 0, classe };
    atual.n += n;
    mapa.set(texto, atual);
  };
  const completa = c.lista.length >= c.abertos + c.expirados;
  for (const [motivo, n] of Object.entries(c.porMotivo)) {
    if (motivo !== 'sem_tentativa') { soma(nomeMotivo({ motivo, status: 'open' }), n, r.seloRuim); continue; }
    if (!completa) { soma('Não chegou a tentar pagar', n, r.seloAtencao); continue; }
    for (const status of ['expired', 'open']) {
      soma(nomeMotivo({ motivo, status }), c.lista.filter((x) => x.motivo === motivo && x.status === status).length, status === 'expired' ? r.seloAtencao : r.seloPlus);
    }
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n);
}

export default function MonjourCheckoutsSecao({ checkouts }: { checkouts: CheckoutsMonjour | null }) {
  const [sid, setSid] = useState<string | null>(null);
  const lista = checkouts && !checkouts.indisponivel ? checkouts.lista : null;
  const totais = useMemo(() => (checkouts && !checkouts.indisponivel ? totaisPorMotivo(checkouts) : []), [checkouts]);

  // Site antigo, sem o bloco: não mostra nada, para não prometer o que não existe.
  if (!checkouts) return null;

  if (checkouts.indisponivel) {
    return (
      <section className={s.bloco} aria-labelledby="mj-checkouts">
        <h3 id="mj-checkouts" className={s.blocoTitulo}>Tentaram pagar e não pagaram</h3>
        <p className={r.nota}>
          {checkouts.motivo === 'tempo'
            ? 'A Stripe demorou demais para responder.'
            : `Não deu para ler os pagamentos abertos na Stripe agora${checkouts.motivo ? ` (${checkouts.motivo})` : ''}.`}{' '}
          As vendas abaixo seguem certas.
        </p>
      </section>
    );
  }

  const total = checkouts.abertos + checkouts.expirados;
  const depois = checkouts.pagaramDepois;
  const notaDepois = depois > 0
    ? <p className={r.nota}>{fmtInt(depois)} {depois === 1 ? 'pagou' : 'pagaram'} depois, em outra tentativa, e não aparece{depois === 1 ? '' : 'm'} aqui.</p>
    : null;
  return (
    <section className={s.bloco} aria-labelledby="mj-checkouts">
      <div className={s.blocoTopo}>
        <h3 id="mj-checkouts" className={s.blocoTitulo}>Tentaram pagar e não pagaram</h3>
        {total > 0 && (
          <span className={r.resumoLinha}>
            {fmtInt(total)} {total === 1 ? 'tentativa' : 'tentativas'} · {fmtInt(checkouts.comFalha)} com falha no pagamento
          </span>
        )}
      </div>

      {lista && lista.length === 0 && (
        <p className={r.nota}>Ninguém abriu o pagamento sem pagar neste período.</p>
      )}

      {notaDepois}

      {lista && lista.length > 0 && (
        <>
          <ul className={r.totaisMotivo} aria-label="Total por motivo">
            {totais.map((t) => (
              <li key={t.texto}><span className={`${r.selo} ${t.classe}`}>{t.texto}</span> <b>{fmtInt(t.n)}</b></li>
            ))}
          </ul>

          <div className={r.rolagem}>
            <table className={`${r.tabela} ${r.cartoes}`}>
              <thead>
                <tr>
                  <th scope="col">Data</th><th scope="col">País</th><th scope="col">E-mail</th><th scope="col">Plano</th>
                  <th scope="col" className={r.direita}>Valor</th><th scope="col">Motivo</th><th scope="col">Sessão</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((x, i) => (
                  <tr key={`${x.criado}-${x.email}-${i}`}>
                    <td data-rotulo="Data" className={r.nowrap}>{fmtQuando(x.criado)}</td>
                    <td data-rotulo="País" className={r.nowrap}>{x.pais ? nomePais(x.pais) : <span className={r.mudo}>Não informado</span>}</td>
                    <td data-rotulo="E-mail" className={r.email} title={x.email}>{x.email || <span className={r.mudo}>Sem e-mail</span>}</td>
                    <td data-rotulo="Plano">{x.plano ? nomePlano(x.plano) : '—'}</td>
                    <td data-rotulo="Valor" className={`${r.direita} ${r.forte}`}>{fmtUsd(x.valor)}</td>
                    <td data-rotulo="Motivo" title={x.mensagem || undefined}>
                      <span className={`${r.selo} ${seloDe(x)}`}>{nomeMotivo(x)}</span>
                    </td>
                    <td data-rotulo="Sessão" className={r.nowrap}>
                      {x.sid ? (
                        <button type="button" className={g.abrirSessao} title={x.sid} onClick={() => setSid(x.sid)}>
                          {x.sid.slice(0, 8)}
                          <span className={g.someVisual}>, ver a jornada</span>
                        </button>
                      ) : <span className={r.mudo}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(checkouts.truncado || lista.length < total) && (
            <p className={r.nota}>Mostrando só os pagamentos mais novos que couberam na leitura. Há mais no período.</p>
          )}
        </>
      )}

      <MonjourGaveta aberta={!!sid} aoFechar={() => setSid(null)} titulo="Jornada da sessão" sub="Aberta a partir de quem tentou pagar" larga chave={sid ?? ''}>
        {sid && <MonjourSessaoJornada sid={sid} nomeEtapa={(n) => `Tela ${n}`} />}
      </MonjourGaveta>
    </section>
  );
}
