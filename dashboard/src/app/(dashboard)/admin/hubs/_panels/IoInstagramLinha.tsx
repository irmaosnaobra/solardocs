'use client';

// Uma linha da tabela do Irmãos na Obra Instagram (e o detalhe que abre embaixo dela).
// No celular (até 760 px) a linha vira cartão pelo CSS.
import { Fragment } from 'react';
import { UTM_CHAVES, fmtData, fmtTel, fmtCep, waLink, type Row } from './ioInstagramDados';
import { PORTA, WHATS, blocosDe, cardsDe, par, portasDe, semCardEsperado, whatsDe, type Whats } from './ioInstagramRotulos';
import styles from './IoInstagramPanel.module.css';

const SELO_CLASSE: Record<Whats, string> = { ok: styles.seloOk, sem: styles.seloSem, nv: styles.seloNv };
const SELO_ICONE: Record<Whats, string> = { ok: 'M3 8.5l3 3 7-7', sem: 'M4 4l8 8M12 4l-8 8', nv: 'M4 8h8' };
const CURTO: Record<string, string> = { solar: 'Solar', eletroposto: 'Eletroposto' };

function SeloWhats({ r }: { r: Row }) {
  const w = whatsDe(r);
  return (
    <span className={`${styles.selo} ${SELO_CLASSE[w]}`} title={`WhatsApp: ${WHATS[w]}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={SELO_ICONE[w]} /></svg>
      {WHATS[w]}
    </span>
  );
}

function Agenda({ r }: { r: Row }) {
  const cards = cardsDe(r);
  const falta = semCardEsperado(r);
  if (!cards.length && !falta) return <span className={styles.mudo}>Só lista</span>;
  return (
    <div className={styles.agenda}>
      {cards.map((c) => (
        <span key={c.porta} className={styles.cardSim} title={`Card ${c.id}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
          {CURTO[c.porta]} na agenda
        </span>
      ))}
      {falta && <span className={styles.cardNao} title="Teste, telefone bloqueado ou já tinha card vivo">Sem card</span>}
    </div>
  );
}

export default function IoInstagramLinha({ r, aberto, onAlternar }: { r: Row; aberto: boolean; onAlternar: () => void }) {
  const portas = portasDe(r);
  const blocos = blocosDe(r);
  return (
    <Fragment>
      <tr className={`${styles.linha} ${aberto ? styles.linhaAberta : ''}`}>
        <td className={styles.colAbrir}>
          <button
            type="button" className={styles.abrir} aria-expanded={aberto} aria-controls={`io-det-${r.id}`}
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
        <td className={styles.respostas}>
          <div className={styles.chips}>
            {portas.map((p) => <span key={p} className={`${styles.chip} ${styles[`chip_${p}`]}`}>{PORTA[p]}</span>)}
          </div>
          {blocos.slice(0, 2).map((b) => (
            <ul key={b.titulo} className={styles.respCurta} aria-label={b.titulo}>
              {b.porta === 'eletroposto' && <li className={styles.respSub}>{b.titulo.replace('Eletroposto · ', '')}</li>}
              {b.itens.map(([c, v]) => <li key={c}><span>{par(c, v).slice(0, -v.length).trim()}</span> {v}</li>)}
            </ul>
          ))}
          {r.outro && <p className={styles.outro} title={r.outro}>Escreveu: “{r.outro}”</p>}
          {!portas.length && <span className={styles.mudo}>Sem respostas</span>}
        </td>
        <td className={styles.colAgenda}><Agenda r={r} /></td>
      </tr>
      {aberto && (
        <tr className={styles.detalhe} id={`io-det-${r.id}`}>
          <td colSpan={6}>
            {blocos.map((b) => (
              <section key={b.titulo} className={styles.respBloco} aria-label={`Respostas de ${b.titulo}`}>
                <p className={styles.respTit}>{b.titulo}</p>
                <ul>
                  {b.itens.length
                    ? b.itens.map(([c, v]) => <li key={c}><span>{par(c, v).slice(0, -v.length).trim()}</span> {v}</li>)
                    : <li><span>Sem respostas gravadas</span></li>}
                </ul>
              </section>
            ))}
            <dl className={styles.grade}>
              <div><dt>Endereço</dt><dd>{r.endereco || 'Não informado'}</dd></div>
              <div><dt>Bairro</dt><dd>{r.bairro || 'Não informado'}</dd></div>
              <div><dt>CEP</dt><dd>{fmtCep(r.cep) || 'Não informado'}</dd></div>
              <div><dt>Cidade</dt><dd>{[r.cidade, r.uf].filter(Boolean).join('-') || 'Não informado'}</dd></div>
              <div><dt>WhatsApp</dt><dd>{WHATS[whatsDe(r)]}</dd></div>
              <div><dt>Card solar</dt><dd>{r.card_solar_id ?? '-'}</dd></div>
              <div><dt>Card eletroposto</dt><dd>{r.card_eletroposto_id ?? '-'}</dd></div>
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
