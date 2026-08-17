'use client';

// ─────────────────────────────────────────────────────────────────────────────
// NOTA 1 → PÁGINA DE MATERIAL — o que acontece com quem a LP recusa.
// Lê /admin/nota1-funil. A pergunta é uma só: de quem é recusado no formulário,
// quantos chegam na oferta de entrada?
//
// DUAS UNIDADES DIFERENTES NA MESMA TELA, e a tela precisa dizer isso:
//   · "mandados" são FICHAS (banco do gerador, uma por lead recusado)
//   · "chegaram" são SESSÕES de navegador (banco do SolarDoc, pc_eventos)
// Não existe chave ligando as duas — o total é o número pra olhar, a linha do
// dia serve pra achar buraco. Quem preenche 23h58 e abre a página 00h01 cai em
// dias diferentes, e isso não é erro.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Linha {
  dia: string;
  mandados: number; chegaram: number; chegaram_fora: number; rolaram: number;
  checkout: number; checkout_fora: number; voltaram: number; compras: number;
  medicao_furada: boolean;
}
interface Ficha {
  quando: string; nome: string | null; telefone: string | null;
  cidade: string | null; pts: number | null; motivos: string[]; origem: string | null;
}
interface Venda {
  created_at: string; nome: string | null; email: string | null;
  item_slug: string | null; valor_centavos: number | null; status: string | null;
}
interface Funil {
  desde: string; dias: number; piso: string; teto?: string; encerrado?: boolean;
  mandados: number; chegaram: number; chegaram_fora: number; rolaram: number;
  checkout: number; checkout_fora: number; voltaram: number; compras: number;
  conv_mandado_chegou: number | null; conv_chegou_checkout: number | null;
  dias_sem_medicao: string[];
  linhas: Linha[]; fichas: Ficha[]; vendas: Venda[];
}

const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
const dia = (s: string) => new Date(`${s}T12:00:00-03:00`)
  .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const hora = (s: string) => new Date(s)
  .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const brl = (c: number | null) => 'R$ ' + ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Nota1Panel() {
  const [data, setData] = useState<Funil | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/nota1-funil').then((r) => setData(r.data as Funil)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const conv = data?.conv_mandado_chegou ?? null;
  // Desde 17/08 o nota 1 vai pras DUAS PORTAS, não pra página de material: as
  // fichas continuam chegando e as visitas ao material param. Sem esta trava a
  // conversão despencaria sozinha e o card acusaria defeito num caminho que foi
  // desligado de propósito — exatamente o tipo de número que mente.
  const encerrado = data?.encerrado === true;
  // Verde a partir de 90%: enquanto o caminho existia, era um redirect na mesma
  // aba — perder gente ali não era "conversão baixa", era coisa quebrada.
  const corConv = encerrado || conv == null ? undefined
    : conv >= 90 ? '#2F7A4F' : conv >= 70 ? '#C87A1E' : '#A53B29';
  const furados = data?.dias_sem_medicao ?? [];

  const etapas: Array<[string, number, string]> = [
    ['Recusados na LP', data?.mandados ?? 0, 'fichas nota 1'],
    ['Abriram a página', data?.chegaram ?? 0, 'sessões com carimbo da recusa'],
    ['Rolaram a página', data?.rolaram ?? 0, 'inclui quem veio de fora'],
    ['Foram pro checkout', data?.checkout ?? 0, 'só nota 1'],
    ['Compraram', data?.compras ?? 0, 'da página inteira'],
  ];
  const maxEtapa = etapas.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Desde {data?.piso ? dia(data.piso) : '07/08'} · solardoc.app/io/eletroposto/material
        </span>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      {encerrado && (
        <div className={styles.card} style={{ marginBottom: 14, borderLeft: '3px solid #8B857A' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Este funil está encerrado — é história, não termômetro
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.6 }}>
            Em {data?.teto ? dia(data.teto) : '17/08'} o nota 1 deixou de cair na página de material e
            passou a cair em <strong>/io/eletroposto/parceria</strong>, a página das duas portas.
            Os recusados continuam chegando e as visitas ao material param — então a conversão
            abaixo <strong>vai cair sozinha, e isso não é defeito</strong>. O que mede o caminho de
            hoje é a aba <strong>Conexão</strong>. O saldo de 07 a 17/08: 110 visitas, 11 checkouts,
            nenhuma compra.
          </div>
        </div>
      )}

      {furados.length > 0 && (
        <div className={styles.card} style={{ marginBottom: 14, borderLeft: '3px solid #A53B29' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#A53B29' }}>
            {furados.length === 1 ? 'Um dia' : `${furados.length} dias`} com rolagem e nenhuma visita gravada
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.6 }}>
            Ninguém rola uma página que não abriu — quando isso aparece, o beacon da visita
            está quebrado e os números abaixo estão <strong>subcontados nesses dias</strong>.
            Aconteceu de 12 a 14/08/26 (o endereço da API era lido antes de existir) e o
            conserto foi um deploy. Se voltar, é a mesma família de problema: olhe o console
            da página antes de acreditar na queda.
          </div>
          <div style={{ fontSize: 12, marginTop: 8, fontFamily: 'monospace', opacity: 0.9 }}>
            {furados.map((d) => dia(d)).join(' · ')}
          </div>
        </div>
      )}

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Recusado → abriu a página</div>
          <div className={styles.cardValue} style={{ color: corConv }}>{pct(conv)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {encerrado
              ? 'caminho desligado em 17/08 — a queda aqui é o esperado, não defeito'
              : 'é um redirect na mesma aba: abaixo de 90% procure defeito, não copy'}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Recusados na LP</div>
          <div className={styles.cardValue}>{(data?.mandados ?? 0).toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>fichas nota 1</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Chegaram na página</div>
          <div className={styles.cardValue}>{(data?.chegaram ?? 0).toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>sessões vindas da recusa</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Entraram por fora</div>
          <div className={styles.cardValue} style={{ opacity: 0.85 }}>{(data?.chegaram_fora ?? 0).toLocaleString('pt-BR')}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>link direto ou anúncio do curso</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Checkout (nota 1)</div>
          <div className={styles.cardValue} style={{ color: (data?.checkout ?? 0) > 0 ? '#C87A1E' : undefined }}>
            {(data?.checkout ?? 0).toLocaleString('pt-BR')}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            + {(data?.checkout_fora ?? 0).toLocaleString('pt-BR')} de quem veio por fora
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Compras</div>
          <div className={styles.cardValue} style={{ color: (data?.compras ?? 0) > 0 ? '#2F7A4F' : undefined }}>
            {(data?.compras ?? 0).toLocaleString('pt-BR')}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>da página inteira — a venda não carimba origem</div>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Do formulário recusado até a compra</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          As duas primeiras barras são unidades diferentes: ficha de lead contra sessão de
          navegador, em bancos que não se conversam. Serve pra ver buraco, não pra apontar pessoa.
        </div>
        {etapas.map(([label, n, nota]) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>{label} <span style={{ opacity: 0.5, fontSize: 11.5 }}>· {nota}</span></span>
              <strong>{n.toLocaleString('pt-BR')}</strong>
            </div>
            <div style={{ height: 8, background: 'rgba(148,163,184,.15)', borderRadius: 999 }}>
              <div style={{
                width: maxEtapa ? `${Math.max(2, (n / maxEtapa) * 100)}%` : '2%',
                height: '100%', background: '#8B857A', borderRadius: 999,
              }} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Dia a dia</div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Dia</th><th>Recusados</th><th>Chegaram</th><th>Por fora</th>
                <th>Rolaram</th><th>Checkout</th><th>Voltaram ao form</th><th>Compras</th>
              </tr>
            </thead>
            <tbody>
              {(data?.linhas ?? []).map((l) => (
                <tr key={l.dia} style={l.medicao_furada ? { background: 'rgba(165,59,41,.10)' } : undefined}>
                  <td>{dia(l.dia)}{l.medicao_furada && <span title="rolagem sem visita: beacon quebrado neste dia" style={{ color: '#A53B29', marginLeft: 6 }}>⚠</span>}</td>
                  <td>{l.mandados || '—'}</td>
                  <td><strong>{l.chegaram || '—'}</strong></td>
                  <td style={{ opacity: 0.7 }}>{l.chegaram_fora || '—'}</td>
                  <td style={{ opacity: 0.7 }}>{l.rolaram || '—'}</td>
                  <td>{l.checkout || '—'}</td>
                  <td style={{ opacity: 0.7 }}>{l.voltaram || '—'}</td>
                  <td>{l.compras || '—'}</td>
                </tr>
              ))}
              {!data?.linhas?.length && (
                <tr><td colSpan={8} style={{ opacity: 0.6 }}>Nenhum nota 1 recusado no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Quem foi recusado</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          O motivo é o que a página usa pra escolher a abertura do texto — e é ele que
          carimba a visita como “veio da recusa”.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Quando</th><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Pontos</th><th>Motivo</th></tr>
            </thead>
            <tbody>
              {(data?.fichas ?? []).map((f, i) => (
                <tr key={`${f.telefone}-${i}`}>
                  <td>{hora(f.quando)}</td>
                  <td>{f.nome || '—'}</td>
                  <td>{f.telefone || '—'}</td>
                  <td>{f.cidade || '—'}</td>
                  <td>{f.pts ?? '—'}</td>
                  <td style={{ opacity: 0.8 }}>{f.motivos?.length ? f.motivos.join(', ') : '—'}</td>
                </tr>
              ))}
              {!data?.fichas?.length && (
                <tr><td colSpan={6} style={{ opacity: 0.6 }}>Ninguém foi recusado no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(data?.vendas?.length ?? 0) > 0 && (
        <div className={styles.card} style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Compras da oferta</div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Quando</th><th>Quem</th><th>Item</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {(data?.vendas ?? []).map((v, i) => (
                  <tr key={`${v.email}-${i}`}>
                    <td>{hora(v.created_at)}</td>
                    <td>{v.nome || v.email || '—'}</td>
                    <td>{v.item_slug || '—'}</td>
                    <td>{brl(v.valor_centavos)}</td>
                    <td style={{ color: v.status === 'pago' || v.status === 'paid' ? '#2F7A4F' : '#C87A1E' }}>{v.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
