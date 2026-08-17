'use client';

// ─────────────────────────────────────────────────────────────────────────────
// CONEXÃO ELETROPOSTO — os dois lados, lado a lado, pra casar na mão.
//
// A régua da LP diz que NOTA 1 é quem não tem local. Resultado: a base inteira é
// UM lado do negócio (42 das 55 primeiras fichas declararam capital). O outro —
// quem tem o estacionamento, o pátio, o terreno na rota — só existe desde que
// /io/eletroposto/parceria abriu a porta dele.
//
// Esta tela NÃO sugere par automaticamente. Cidade igual não quer dizer ponto
// compatível, e um "match" errado exposto num painel vira ligação errada. O que
// ela faz é mostrar onde os dois lados existem no mesmo lugar — e deixar o
// endereço à mão pra quem sabe olhar.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Ponto {
  id: number; created_at: string; nome: string; telefone: string; cidade: string | null;
  ponto_relacao: string | null; ponto_tipo: string | null; ponto_endereco: string | null;
  ponto_vagas: string | null; ponto_fluxo: string | null; ponto_energia: string | null;
  obs: string | null; origem: string; par_id: number | null;
}
interface Capital {
  id: number; created_at: string; nome: string; telefone: string; cidade: string | null;
  capital_faixa: string | null; prazo: string | null; origem: string;
}
interface Ficha {
  id: number; created_at: string; nome: string | null; telefone: string | null;
  cidade: string | null; invest: string | null; pts: number | null;
}
interface Dados {
  pontos: Ponto[];
  capital_cadastrado: Capital[];
  capital_da_ficha: Ficha[];
  cidades_com_par: Array<{ cidade: string; pontos: number; capital: number }>;
}

const hora = (s: string) => new Date(s)
  .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const wa = (t: string | null) => (t ? `https://wa.me/${String(t).replace(/\D/g, '')}` : '#');

export default function ConexaoPanel() {
  const [data, setData] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/eletroposto-parceria')
      .then((r) => setData(r.data as Dados)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const pontos = data?.pontos ?? [];
  const capCad = data?.capital_cadastrado ?? [];
  const capFicha = data?.capital_da_ficha ?? [];
  const pares = data?.cidades_com_par ?? [];
  const totalCapital = capCad.length + capFicha.length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>solardoc.app/io/eletroposto/parceria</span>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Pontos oferecidos</div>
          {/* Laranja quando é zero: não é "nada aconteceu", é o lado que falta —
              e enquanto ele for zero, os investidores da coluna ao lado não têm
              o que receber. É o número que decide se a página funcionou. */}
          <div className={styles.cardValue} style={{ color: pontos.length ? '#2F7A4F' : '#C87A1E' }}>
            {pontos.length}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>quem tem o local e quer arrendar</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Com capital</div>
          <div className={styles.cardValue}>{totalCapital}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {capCad.length} cadastrados · {capFicha.length} vindos da ficha
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Cidades com os dois lados</div>
          <div className={styles.cardValue} style={{ color: pares.length ? '#2F7A4F' : undefined }}>{pares.length}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>onde uma apresentação sai hoje</div>
        </div>
      </div>

      {pares.length > 0 && (
        <div className={styles.card} style={{ marginTop: 14, borderLeft: '3px solid #2F7A4F' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Onde os dois lados se encontram</div>
          <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 10 }}>
            Cidade igual é <strong>proximidade, não compatibilidade</strong>: quem diz se o ponto
            serve pro investidor é o endereço, e quem lê o endereço é o especialista.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pares.map((c) => (
              <span key={c.cidade} style={{
                background: 'rgba(47,122,79,.12)', border: '1px solid rgba(47,122,79,.35)',
                borderRadius: 8, padding: '6px 11px', fontSize: 12.5, fontWeight: 600, textTransform: 'capitalize',
              }}>
                {c.cidade} <span style={{ opacity: 0.65, fontWeight: 500 }}>· {c.pontos} ponto{c.pontos > 1 ? 's' : ''} / {c.capital} com capital</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Pontos oferecidos</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          O ativo escasso. Cada linha aqui é um local que alguém topa arrendar — e a equipe
          recebe um aviso no WhatsApp no minuto em que ele entra.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Quando</th><th>Nome</th><th>Cidade</th><th>Tipo</th><th>Endereço</th><th>Vagas</th><th>Movimento</th><th>Trifásica</th></tr>
            </thead>
            <tbody>
              {pontos.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{hora(p.created_at)}</td>
                  <td>
                    <a href={wa(p.telefone)} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{p.nome}</a>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{p.ponto_relacao || '—'}</div>
                  </td>
                  <td>{p.cidade || '—'}</td>
                  <td>{p.ponto_tipo || '—'}</td>
                  <td style={{ maxWidth: 260 }}>{p.ponto_endereco || '—'}</td>
                  <td>{p.ponto_vagas || '—'}</td>
                  <td>{p.ponto_fluxo || '—'}</td>
                  <td>{p.ponto_energia || '—'}</td>
                </tr>
              ))}
              {!pontos.length && (
                <tr><td colSpan={8} style={{ opacity: 0.6 }}>
                  Nenhum ponto cadastrado ainda. Enquanto esta lista estiver vazia, o grupo dos
                  investidores não tem o que receber — divulgar a porta do ponto é o que destrava.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Quem tem o capital</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          Duas origens na mesma tabela, e a diferença importa: <strong>cadastrado</strong> escolheu
          a porta na página; <strong>da ficha</strong> declarou recurso na LP, foi recusado por não
          ter local e ninguém falou com ele desde então.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Quando</th><th>Nome</th><th>Cidade</th><th>Capital</th><th>Prazo</th><th>Origem</th></tr>
            </thead>
            <tbody>
              {capCad.map((c) => (
                <tr key={`c${c.id}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{hora(c.created_at)}</td>
                  <td><a href={wa(c.telefone)} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{c.nome}</a></td>
                  <td>{c.cidade || '—'}</td>
                  <td>{c.capital_faixa || '—'}</td>
                  <td>{c.prazo || '—'}</td>
                  <td><span style={{ fontSize: 11.5, color: '#2F7A4F', fontWeight: 600 }}>cadastrado</span></td>
                </tr>
              ))}
              {capFicha.map((f) => (
                <tr key={`f${f.id}`} style={{ opacity: 0.82 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{hora(f.created_at)}</td>
                  <td><a href={wa(f.telefone)} target="_blank" rel="noopener noreferrer">{f.nome || '—'}</a></td>
                  <td>{f.cidade || '—'}</td>
                  <td>{f.invest || '—'}</td>
                  <td style={{ opacity: 0.6 }}>—</td>
                  <td><span style={{ fontSize: 11.5, opacity: 0.7 }}>da ficha (nota 1)</span></td>
                </tr>
              ))}
              {!totalCapital && (
                <tr><td colSpan={6} style={{ opacity: 0.6 }}>Ninguém com capital declarado ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
