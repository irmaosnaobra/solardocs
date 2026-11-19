'use client';

// Uma linha da tabela do NEXUS Instagram (e o detalhe que abre embaixo dela).
// No celular (até 760 px) a linha vira cartão pelo CSS: cada célula leva data-rotulo.
import { Fragment } from 'react';
import { UTM_CHAVES, fmtData, fmtTel, fmtCep, waLink, rot, lista, type Row } from './nexusInstagramDados';
import { CAMINHO, MOB, OBJ, INV, REC, WHATS, par, respostasDe, whatsDe, type Whats } from './nexusInstagramRotulos';
import styles from './NexusInstagramPanel.module.css';

const SELO_CLASSE: Record<Whats, string> = { ok: styles.seloOk, sem: styles.seloSem, nv: styles.seloNv };
const SELO_ICONE: Record<Whats, string> = { ok: 'M3 8.5l3 3 7-7', sem: 'M4 4l8 8M12 4l-8 8', nv: 'M4 8h8' };

export function SeloWhats({ r }: { r: Row }) {
  const w = whatsDe(r);
  return (
    <span className={`${styles.selo} ${SELO_CLASSE[w]}`} title={`WhatsApp: ${WHATS[w]}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={SELO_ICONE[w]} /></svg>
      {WHATS[w]}
    </span>
  );
}

export default function NexusInstagramLinha({ r, aberto, onAlternar }: { r: Row; aberto: boolean; onAlternar: () => void }) {
  const ep = lista(r.eletroposto);
  const mob = lista(r.mobilidade);
  const respostas = respostasDe(r);
  const temMob = !!(r.objetivo || r.investimento || r.recurso);
  return (
    <Fragment>
      <tr className={`${styles.linha} ${aberto ? styles.linhaAberta : ''}`}>
        <td className={styles.colAbrir}>
          <button
            type="button" className={styles.abrir} aria-expanded={aberto} aria-controls={`det-${r.id}`}
            aria-label={`${aberto ? 'Fechar' : 'Abrir'} detalhes de ${r.nome}`}
            onClick={onAlternar}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
          </button>
        </td>
        <td className={styles.data}>
          {fmtData(r.criado_em)}
          {r.teste && <span className={styles.tagTeste}>Teste</span>}
        </td>
        <td className={styles.nome}>
          <strong>{r.nome}</strong>
          <span className={styles.sob}>{[r.cidade, r.uf].filter(Boolean).join('-')}</span>
        </td>
        <td className={styles.contato}>
          <a className={styles.wa} href={waLink(r.telefone)} target="_blank" rel="noopener noreferrer" title="Abrir a conversa no WhatsApp">
            {fmtTel(r.telefone)}
          </a>
          <SeloWhats r={r} />
          {r.email
            ? <a className={styles.email} href={`mailto:${r.email}`} title={r.email}>{r.email}</a>
            : <span className={`${styles.sob} ${styles.mudo}`}>Sem e-mail</span>}
        </td>
        <td className={styles.interesses} data-rotulo="Interesses">
          <div className={styles.chips}>
            {ep.map((k) => <span key={`e-${k}`} className={styles.chipEp}>{rot(CAMINHO, k)}</span>)}
            {mob.map((k) => <span key={`m-${k}`} className={styles.chip}>{rot(MOB, k)}</span>)}
          </div>
          {r.outro && <p className={styles.outro} title={r.outro}>Escreveu: “{r.outro}”</p>}
        </td>
        <td className={styles.perfil} data-rotulo="Perfil">
          {temMob && (
            <>
              <strong>{rot(OBJ, r.objetivo)}</strong>
              <span className={styles.faixa}>{rot(INV, r.investimento)}</span>
              <span className={styles.sob}>{rot(REC, r.recurso)}</span>
            </>
          )}
          {respostas.slice(0, temMob ? 0 : 1).map((x) => (
            <ul key={x.caminho} className={styles.respCurta}>
              {x.itens.map(([c, v]) => <li key={c}><span>{par(c, v).slice(0, -v.length).trim()}</span> {v}</li>)}
            </ul>
          ))}
          {!temMob && !respostas.length && <span className={styles.mudo}>Sem respostas</span>}
        </td>
      </tr>
      {aberto && (
        <tr className={styles.detalhe} id={`det-${r.id}`}>
          <td colSpan={6}>
            {respostas.map((x) => (
              <section key={x.caminho} className={styles.respBloco} aria-label={`Respostas de ${rot(CAMINHO, x.caminho)}`}>
                <p className={styles.respTit}>{rot(CAMINHO, x.caminho)}</p>
                <ul>
                  {x.itens.map(([c, v]) => <li key={c}><span>{par(c, v).slice(0, -v.length).trim()}</span> {v}</li>)}
                </ul>
              </section>
            ))}
            <dl className={styles.grade}>
              <div><dt>Endereço</dt><dd>{r.endereco || 'Não informado'}</dd></div>
              <div><dt>Bairro</dt><dd>{r.bairro || 'Não informado'}</dd></div>
              <div><dt>CEP</dt><dd>{fmtCep(r.cep) || 'Não informado'}</dd></div>
              <div><dt>Cidade</dt><dd>{[r.cidade, r.uf].filter(Boolean).join('-') || 'Não informado'}</dd></div>
              <div><dt>WhatsApp</dt><dd>{WHATS[whatsDe(r)]}</dd></div>
              <div><dt>Origem</dt><dd>{r.origem || 'Não informado'}</dd></div>
              <div><dt>Atualizado em</dt><dd>{fmtData(r.atualizado_em) || fmtData(r.criado_em)}</dd></div>
              {UTM_CHAVES.map((k) => (
                <div key={k}><dt>utm_{k}</dt><dd>{r.utm?.[k] || '-'}</dd></div>
              ))}
              {r.outro && <div className={styles.largo}><dt>O que escreveu</dt><dd>{r.outro}</dd></div>}
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
