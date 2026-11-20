'use client';

// Topo da aba: as fábricas lado a lado, cada uma num cartão ilustrado.
// O cartão inteiro leva até a seção da fábrica, mais abaixo.
import type { Snapshot } from './tipos';
import { REDES } from './tipos';
import {
  contasFabrica, dia, emQuanto, hora, horariosFabrica, idFabrica, nomeFabrica, NOME_ETAPA, NOME_REDE, num,
  numCurto, prontosPauta, proximoPost, situacaoFabrica,
} from './formato';
import { IconeRede } from './Icones';
import { CenaFabrica } from './Ilustracoes';
import { Situacao } from './Cabeca';
import f from './fabricas.module.css';

function Numero({ fab }: { fab: Snapshot }) {
  const pauta = fab.pauta;
  if (pauta && pauta.itens.length > 0) {
    const etapas = pauta.etapas;
    const prontos = prontosPauta(fab);
    return (
      <div className={f.cNumero}>
        <p className={f.cNumeroLinha}>
          <b>{prontos}</b>
          <span>de {pauta.itens.length} prontos na semana</span>
        </p>
        <span className={f.cSegmentos} aria-hidden="true">
          {pauta.itens.map((i) => {
            const pos = Math.max(0, etapas.indexOf(i.etapa));
            return <span key={i.slug} data-etapa={i.etapa} style={{ opacity: 0.35 + (0.65 * (pos + 1)) / etapas.length }} title={NOME_ETAPA[i.etapa] ?? i.etapa} />;
          })}
        </span>
      </div>
    );
  }
  if (fab.plano) {
    const feitos = fab.plano.marcos.filter((m) => m.feito).length;
    return (
      <div className={f.cNumero}>
        <p className={f.cNumeroLinha}>
          <b>{feitos}</b>
          <span>de {fab.plano.marcos.length} marcos feitos</span>
        </p>
        <span className={f.cSegmentos} aria-hidden="true">
          {fab.plano.marcos.map((m) => <span key={m.titulo} data-etapa={m.feito ? 'publicado' : 'falta'} />)}
        </span>
      </div>
    );
  }
  const t = fab.totais;
  const soma = REDES.reduce((acc, r) => acc + (t.porRede[r]?.views ?? 0), 0);
  return (
    <div className={f.cNumero}>
      <p className={f.cNumeroLinha}>
        <b>{numCurto(t.views)}</b>
        <span>views no total</span>
      </p>
      {soma > 0 ? (
        <span className={f.cSegmentos} aria-label={REDES.map((r) => `${NOME_REDE[r]} ${num(t.porRede[r]?.views ?? 0)}`).join(', ')} role="img">
          {REDES.filter((r) => (t.porRede[r]?.views ?? 0) > 0).map((r) => (
            <span key={r} data-rede={r} style={{ flexGrow: t.porRede[r]?.views ?? 0 }} />
          ))}
        </span>
      ) : null}
    </div>
  );
}

export default function Cartoes({ fabricas, agora }: { fabricas: Snapshot[]; agora: number }) {
  return (
    <section aria-label="As fábricas" className={f.cartoesSec}>
      <ol className={f.cartoes} data-qtd={fabricas.length}>
        {fabricas.map((fab, i) => {
          const id = idFabrica(fab);
          const contas = contasFabrica(fab);
          const horarios = horariosFabrica(fab);
          const prox = proximoPost(fab, agora);
          return (
            <li key={id}>
              <a href={`#fab-${id}`} className={f.cartao} data-fab={id}>
                <CenaFabrica id={id} personagem={fab.personagem} />
                <span className={f.cCorpo}>
                  <span className={f.cTopo}>
                    <span className={f.cOrdem}>Fábrica {String(fab.ordem ?? i + 1).padStart(2, '0')}</span>
                    <Situacao situacao={situacaoFabrica(fab)} />
                  </span>
                  <span className={f.cNome}>{nomeFabrica(fab)}</span>
                  <span className={f.cContas}>
                    {contas.length > 0 ? (
                      <>
                        <span className={f.cIcones}>
                          {contas.map((c) => (
                            <span key={c.rede} data-rede={c.rede} title={NOME_REDE[c.rede]}>
                              <IconeRede rede={c.rede} size={15} />
                              <span className={f.sr}>{NOME_REDE[c.rede]}</span>
                            </span>
                          ))}
                        </span>
                        <span className={f.cHandle}>{[...new Set(contas.map((c) => c.handle))].join(' · ')}</span>
                      </>
                    ) : (
                      <>
                        <span className={f.cIcones}><span data-rede="youtube"><IconeRede rede="youtube" size={15} /></span></span>
                        <span className={f.cHandleMudo}>Canal a definir</span>
                      </>
                    )}
                  </span>
                  <span className={f.cFatos}>
                    <span>
                      <span className={f.cRotulo}>{horarios.length > 0 ? 'Horário' : 'Formato'}</span>
                      <span className={f.cValor}>{horarios.length > 0 ? horarios.map((h) => h.replace(':00', 'h')).join(' e ') : '16:9, 20+ min'}</span>
                    </span>
                    <span>
                      <span className={f.cRotulo}>Próximo post</span>
                      {prox ? (
                        <span className={f.cValor}>
                          {dia(prox.quando)} · {hora(prox.quando)} <span className={f.cEm}>{emQuanto(prox.quando, agora)}</span>
                        </span>
                      ) : (
                        <span className={f.cValorMudo}>{fab.plano ? 'Depois do piloto' : 'Sem data'}</span>
                      )}
                    </span>
                  </span>
                  {prox ? <span className={f.cProxTitulo}>{prox.titulo}</span> : null}
                  <Numero fab={fab} />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
