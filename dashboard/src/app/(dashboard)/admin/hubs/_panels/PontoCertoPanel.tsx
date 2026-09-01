'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PONTO CERTO — quem tem o dinheiro e não tem o lugar.
//
// Lê /admin/ponto-certo-funil. A pergunta da tela é uma só: o investidor que a
// régua recusa por falta de local está chegando no material que ensina a achar
// o local?
//
// TRÊS UNIDADES DIFERENTES, e a tela diz isso em voz alta:
//   · mandado e cadastro são FICHAS DE LEAD (banco do gerador)
//   · visita e checkout são SESSÕES DE NAVEGADOR (banco do SolarDoc)
//   · venda é PEDIDO, e o gateway não sabe de onde a pessoa veio
// Não há chave ligando os três. Cada total é honesto; a passagem entre eles é
// estimativa, e está rotulada como estimativa.
//
// TRAVESSÃO NÃO É ZERO. Enquanto a landing não tiver medição no período, visita
// e checkout vêm null e aparecem como "—". Zero diria "ninguém abriu"; o que
// acontece é "ninguém contou".
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Linha {
  dia: string;
  mandados: number; cadastraram: number;
  visitas: number | null; checkout: number | null; vendas: number;
}
interface Sumido {
  quando: string; nome: string | null; telefone: string | null;
  cidade: string | null; capital: string | null; ponto: string | null;
}
interface Cadastrado {
  created_at: string; nome: string | null; telefone: string | null;
  cidade: string | null; capital_faixa: string | null; status: string | null;
}
interface Venda {
  created_at: string; nome: string | null; email: string | null;
  valor_centavos: number | null; status: string | null;
}
interface Fila {
  capital: number; ponto: number; integrador: number;
  capital_antes_do_redirect: number;
}
interface Funil {
  desde: string; dias: number; redirect_desde: string; lp_medida: boolean;
  mandados: number | null; cadastraram: number | null;
  visitas: number | null; checkout: number | null; compras: number | null;
  perdidos_no_caminho: number | null;
  conv_mandado_cadastro: number | null; conv_cadastro_visita: number | null;
  conv_visita_checkout: number | null; conv_checkout_compra: number | null;
  fila: Fila; receita_centavos: number;
  linhas: Linha[]; sumidos: Sumido[]; cadastrados: Cadastrado[]; vendas: Venda[];
}

const VERDE = '#2F7A4F';
const AMBAR = '#C87A1E';
const VERMELHO = '#A53B29';

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR'));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
const brl = (c: number | null | undefined) =>
  'R$ ' + ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (s: string) => new Date(`${s}T12:00:00-03:00`)
  .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const hora = (s: string) => new Date(s).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

// Rótulos como o formulário pergunta, não como o banco guarda.
const CAPITAL: Record<string, string> = {
  proprio: 'recurso próprio',
  proprio_credito: 'próprio + crédito',
  fin_aprovado: 'financiamento aprovado',
  fin_cnpj: 'financiamento pelo CNPJ',
  fin_banco: 'vai buscar no banco',
  naosei: 'não sabe como pagar',
};
const PONTO: Record<string, string> = {
  sem_ideia: 'sem ideia de onde',
  em_vista: 'tem um em vista',
  negociando: 'negociando',
  definido: 'ponto definido',
};

export default function PontoCertoPanel() {
  const [data, setData] = useState<Funil | null>(null);
  const [dias, setDias] = useState(30);
  const [loading, setLoading] = useState(false);

  const load = useCallback((d: number) => {
    setLoading(true);
    api.get(`/admin/ponto-certo-funil?dias=${d}`)
      .then((r) => setData(r.data as Funil))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(dias); }, [load, dias]);

  const f = data;
  const conv = f?.conv_mandado_cadastro ?? null;
  // A passagem da LP pra página das portas é um redirect na mesma aba: perder
  // gente ali não é copy fraca, é atrito de tela. Por isso a régua é dura.
  const corConv = conv == null ? undefined : conv >= 60 ? VERDE : conv >= 35 ? AMBAR : VERMELHO;

  const etapas: Array<[string, number | null, string]> = [
    ['Recusados com o dinheiro na mão', f?.mandados ?? null, 'fichas nota 1 com capital declarado'],
    ['Se cadastraram na porta do capital', f?.cadastraram ?? null, 'ficha de lead'],
    ['Abriram a página do material', f?.visitas ?? null, 'sessões de navegador'],
    ['Clicaram pra comprar', f?.checkout ?? null, 'sessões que foram pra Kiwify'],
    ['Compraram', f?.compras ?? null, 'pedidos aprovados'],
  ];
  const maxEtapa = etapas.reduce((m, [, n]) => Math.max(m, n ?? 0), 0);
  const fila = f?.fila;
  const filaMax = Math.max(fila?.capital ?? 0, fila?.ponto ?? 0, fila?.integrador ?? 0, 1);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          solardoc.app/ponto-certo · R$ 297 na Kiwify · redirect ligado em{' '}
          {f?.redirect_desde ? dia(f.redirect_desde) : '01/09'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`${styles.periodBtn} ${dias === d ? styles.periodActive : ''}`}
              onClick={() => setDias(d)}
            >
              {d}d
            </button>
          ))}
          <button className={styles.periodBtn} disabled={loading} onClick={() => load(dias)}>
            {loading ? 'Atualizando…' : '↻'}
          </button>
        </div>
      </div>

      {f && !f.lp_medida && (
        <div className={styles.card} style={{ marginBottom: 14, borderLeft: `3px solid ${AMBAR}` }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            A página ainda não reportou nenhuma visita neste período
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.6 }}>
            A landing ganhou medição em 01/09/2026 — antes disso ela era HTML puro, sem pixel e
            sem beacon. Enquanto não houver sessão gravada na janela escolhida, <strong>visita e
            checkout aparecem como travessão, não como zero</strong>: a diferença é entre
            &quot;ninguém abriu&quot; e &quot;ninguém contou&quot;. Se um dia com cadastro aparecer
            sem visita nenhuma, o beacon quebrou — olhe o console da página antes de acreditar na
            queda.
          </div>
        </div>
      )}

      {!!fila?.capital_antes_do_redirect && (
        <div className={styles.card} style={{ marginBottom: 14, borderLeft: `3px solid ${VERMELHO}` }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: VERMELHO }}>
            {fila.capital_antes_do_redirect} investidores cadastrados antes do caminho existir
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.6 }}>
            Eles se cadastraram na porta do capital antes de {dia(f!.redirect_desde)}, quando a tela
            de &quot;cadastro recebido&quot; ainda era o fim do caminho. <strong>Nenhum deles viu a
            página do Ponto Certo</strong>, e nenhuma régua automática os alcança hoje — as duas
            que rodam no cron ainda mandam o link do grupo. É a maior lista pronta que existe pra
            este produto, e ela só sai daqui na mão.
          </div>
        </div>
      )}

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Recusado → se cadastrou</div>
          <div className={styles.cardValue} style={{ color: corConv }}>{pct(conv)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            é um redirect na mesma aba — abaixo de 60% o atrito está na tela, não na oferta
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Tinham o dinheiro</div>
          <div className={styles.cardValue}>{num(f?.mandados)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>fichas nota 1 com capital declarado</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Sumiram no caminho</div>
          <div className={styles.cardValue} style={{ color: (f?.perdidos_no_caminho ?? 0) > 0 ? VERMELHO : undefined }}>
            {num(f?.perdidos_no_caminho)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            foram mandados pras portas e não preencheram nada
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Abriram a página</div>
          <div className={styles.cardValue}>{num(f?.visitas)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>sessões — outra unidade, não some com a de cima</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Foram pro checkout</div>
          <div className={styles.cardValue} style={{ color: (f?.checkout ?? 0) > 0 ? AMBAR : undefined }}>
            {num(f?.checkout)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>clicaram num botão que leva à Kiwify</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Compraram</div>
          <div className={styles.cardValue} style={{ color: (f?.compras ?? 0) > 0 ? VERDE : undefined }}>
            {num(f?.compras)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{brl(f?.receita_centavos)} no período</div>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Da recusa até a compra</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          As duas primeiras barras são fichas de lead; as duas seguintes são sessões de navegador,
          em outro banco. Não existe chave ligando as duas metades — serve pra achar buraco, não
          pra apontar pessoa.
        </div>
        {etapas.map(([label, n, nota]) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>
                {label} <span style={{ opacity: 0.5, fontSize: 11.5 }}>· {nota}</span>
              </span>
              <strong>{num(n)}</strong>
            </div>
            <div className={styles.funnelBar}>
              <div
                className={styles.funnelFill}
                style={{ width: maxEtapa ? `${((n ?? 0) / maxEtapa) * 100}%` : '0%', opacity: n == null ? 0.25 : 1 }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>A fila, dos dois lados</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          Cadastros na página das portas, base inteira — sem recorte de período, porque a
          desproporção é acúmulo e trinta dias escondem justamente o que ela mostra. Quando um lado
          é muito maior que o outro, esperar aparecer contraparte é esperar o que não existe: é
          esse desequilíbrio que sustenta o produto.
        </div>
        {([
          ['Têm o capital', fila?.capital ?? 0, 'e nenhum lugar pra instalar'],
          ['Têm o ponto', fila?.ponto ?? 0, 'e precisam de quem banque'],
          ['Integradores', fila?.integrador ?? 0, 'querem instalar pra terceiros'],
        ] as Array<[string, number, string]>).map(([label, n, nota]) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>
                {label} <span style={{ opacity: 0.5, fontSize: 11.5 }}>· {nota}</span>
              </span>
              <strong>{num(n)}</strong>
            </div>
            <div className={styles.funnelBar}>
              <div className={styles.funnelFill} style={{ width: `${(n / filaMax) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Dia a dia</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 10 }}>
          Quem preenche 23h58 e cadastra 00h03 cai em dias diferentes. Isso não é erro — a linha do
          dia serve pra achar buraco, o total é o número pra olhar.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Dia</th>
                <th style={{ textAlign: 'right' }}>Com dinheiro</th>
                <th style={{ textAlign: 'right' }}>Cadastraram</th>
                <th style={{ textAlign: 'right' }}>Abriram</th>
                <th style={{ textAlign: 'right' }}>Checkout</th>
                <th style={{ textAlign: 'right' }}>Vendas</th>
              </tr>
            </thead>
            <tbody>
              {(f?.linhas ?? []).map((l) => (
                <tr key={l.dia}>
                  <td>{dia(l.dia)}</td>
                  <td style={{ textAlign: 'right' }}>{num(l.mandados)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {num(l.cadastraram)}
                    {l.mandados > 0 && (
                      <span style={{ opacity: 0.45, fontSize: 11.5 }}>
                        {' '}({Math.round((l.cadastraram / l.mandados) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }} className={l.visitas == null ? styles.mutedCell : undefined}>
                    {num(l.visitas)}
                  </td>
                  <td style={{ textAlign: 'right' }} className={l.checkout == null ? styles.mutedCell : undefined}>
                    {num(l.checkout)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{l.vendas || ''}</td>
                </tr>
              ))}
              {!f?.linhas?.length && (
                <tr><td colSpan={6} className={styles.empty}>Nenhum movimento no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          Tinham o dinheiro e não se cadastraram
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 10 }}>
          Cada linha aqui é um investidor que a régua recusou, que declarou ter o recurso, e que
          fechou a aba antes de preencher a porta do capital. É a lista de trabalho da tela: nenhuma
          automação alcança essas pessoas hoje.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quando</th><th>Nome</th><th>Telefone</th><th>Cidade</th>
                <th>Dinheiro</th><th>Local</th>
              </tr>
            </thead>
            <tbody>
              {(f?.sumidos ?? []).map((s, i) => (
                <tr key={`${s.telefone}-${i}`}>
                  <td>{hora(s.quando)}</td>
                  <td>{s.nome || '—'}</td>
                  <td>{s.telefone || '—'}</td>
                  <td>{s.cidade || '—'}</td>
                  <td>{CAPITAL[s.capital || ''] || s.capital || '—'}</td>
                  <td>{PONTO[s.ponto || ''] || s.ponto || '—'}</td>
                </tr>
              ))}
              {!f?.sumidos?.length && (
                <tr><td colSpan={6} className={styles.empty}>Ninguém sumiu no caminho neste período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!!f?.vendas?.length && (
        <div className={styles.card} style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Vendas do Ponto Certo</div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Quando</th><th>Nome</th><th>E-mail</th><th>Valor</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {f.vendas.map((v, i) => (
                  <tr key={`${v.email}-${i}`}>
                    <td>{hora(v.created_at)}</td>
                    <td>{v.nome || '—'}</td>
                    <td>{v.email || '—'}</td>
                    <td>{brl(v.valor_centavos)}</td>
                    <td>{v.status || '—'}</td>
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
