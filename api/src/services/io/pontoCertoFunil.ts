// ─────────────────────────────────────────────────────────────────────────────
// FUNIL DO PONTO CERTO — de quem a régua recusa por falta de local até a venda.
//
// A pergunta que esta tela responde é uma só: quem tem o dinheiro e não tem o
// ponto está chegando no material que ensina a achar o ponto?
//
// O caminho, desde 01/09/2026:
//   LP do eletroposto → NOTA 1 → /io/eletroposto/parceria (porta do capital)
//   → cadastro gravado → 4s → /ponto-certo → Kiwify.
//
// TRÊS BANCOS, DUAS UNIDADES, UMA JUNÇÃO QUE NÃO EXISTE. A tela precisa dizer
// isso em voz alta, porque somar as etapas como se fossem a mesma coisa é o
// jeito mais rápido de inventar uma conversão:
//   · ficha e cadastro são LINHAS DE LEAD, no banco do gerador;
//   · visita e checkout são SESSÕES DE NAVEGADOR, no banco do SolarDoc;
//   · venda é PEDIDO, e o gateway não sabe de onde a pessoa veio.
// Não há chave ligando as três. Cada etapa é um total honesto; a passagem entre
// elas é estimativa, e está rotulada como tal.
//
// O QUE AINDA NÃO SE MEDE. A landing /ponto-certo é HTML puro, sem uma linha de
// script — nem pixel, nem beacon. Enquanto ela não avisar que foi aberta, as
// etapas de visita e de checkout voltam `null`, e null vira travessão na tela.
// Zero seria mentira: zero diz "ninguém abriu", e o que acontece é "ninguém
// contou".
// ─────────────────────────────────────────────────────────────────────────────

/** O dia em que o investidor deixou de parar na tela de "cadastro recebido". */
export const REDIRECT_DESDE = '2026-09-01';

/**
 * Faixas de capital que contam como "tem o dinheiro".
 *
 * Fica aqui, exportada, porque hoje existem DUAS listas divergentes na casa: o
 * /admin usa quatro slugs e o /gerador usa cinco, com `fin_banco` a mais. Quem
 * declarou que vai financiar mas ainda não foi ao banco aparece num painel e
 * some no outro, e ninguém percebe porque os dois números nunca são olhados
 * lado a lado.
 *
 * Aqui ele ENTRA: a página das portas não pergunta se o banco já aprovou, e a
 * lista deste funil precisa bater com quem a LP de fato manda pra lá — que é
 * todo mundo cujo `invest` não é 'naosei'.
 */
export const CAPITAL_DECLARADO = [
  'proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj', 'fin_banco',
];

/** Eventos que a landing do Ponto Certo dispara. Ver `ev()` no HTML dela. */
export const PONTO_CERTO_TIPOS = ['pc_lp_view', 'pc_lp_rolou', 'pc_lp_checkout'];

export interface FichaNota1 {
  created_at: string;
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  origem: string | null;
  capital_faixa: string | null;
  tem_ponto: string | null;
  lado: string | null;
  lado_em: string | null;
  motivo_descarte: string[] | null;
}

export interface Cadastro {
  created_at: string;
  lado: string | null;
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  capital_faixa: string | null;
  status: string | null;
}

export interface EventoLp {
  tipo: string;
  session_id: string | null;
  created_at: string;
}

export interface Venda {
  created_at: string;
  nome: string | null;
  email: string | null;
  valor_centavos: number | null;
  status: string | null;
}

export interface LinhaDia {
  dia: string;
  /** Fichas NOTA 1 com capital declarado — as que a LP mandou pras portas. */
  mandados: number;
  /** Dessas fichas, quantas terminaram cadastradas do lado do capital. */
  cadastraram: number;
  /** Sessões que abriram a landing. `null` enquanto não houver medição no dia. */
  visitas: number | null;
  /** Sessões que clicaram no checkout da Kiwify. */
  checkout: number | null;
  vendas: number;
}

const fmtSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** ISO → 'AAAA-MM-DD' no fuso de Uberlândia, que é onde o dia comercial vira. */
export const diaSP = (iso: string): string => fmtSP.format(new Date(iso));

export function inicioDaJanela(dias: number, agora: number = Date.now()): string {
  return new Date(agora - dias * 86400_000).toISOString();
}

const temCapital = (faixa: string | null): boolean =>
  !!faixa && CAPITAL_DECLARADO.includes(faixa);

/**
 * Monta a série diária. Sessões só entram nos dias em que houve ALGUMA sessão
 * medida — antes do beacon existir, a coluna é `null` e não zero, senão o
 * gráfico desenha uma queda que nunca aconteceu.
 */
export function linhasDoFunil(
  fichas: FichaNota1[],
  eventos: EventoLp[],
  vendas: Venda[],
): LinhaDia[] {
  const dias = new Map<string, LinhaDia>();
  const pega = (d: string): LinhaDia => {
    let l = dias.get(d);
    if (!l) {
      l = { dia: d, mandados: 0, cadastraram: 0, visitas: null, checkout: null, vendas: 0 };
      dias.set(d, l);
    }
    return l;
  };

  for (const f of fichas) {
    if (!temCapital(f.capital_faixa)) continue;
    const l = pega(diaSP(f.created_at));
    l.mandados++;
    // Conta no dia da FICHA, não no do cadastro: a pergunta é quantos dos
    // mandados naquele dia chegaram do outro lado, e a pessoa que preenche
    // 23h58 e cadastra 00h03 não pode virar uma perda de um dia e um ganho
    // do outro.
    if (f.lado === 'capital') l.cadastraram++;
  }

  // Sessão distinta por dia e por tipo. Um mesmo navegador rolando a página dez
  // vezes é uma visita, não dez.
  const sessoes = new Map<string, Map<string, Set<string>>>();
  for (const e of eventos) {
    const d = diaSP(e.created_at);
    if (!sessoes.has(d)) sessoes.set(d, new Map());
    const porTipo = sessoes.get(d)!;
    if (!porTipo.has(e.tipo)) porTipo.set(e.tipo, new Set());
    porTipo.get(e.tipo)!.add(e.session_id || `anon:${e.created_at}`);
  }
  for (const [d, porTipo] of sessoes) {
    const l = pega(d);
    l.visitas = porTipo.get('pc_lp_view')?.size ?? 0;
    l.checkout = porTipo.get('pc_lp_checkout')?.size ?? 0;
  }

  for (const v of vendas) pega(diaSP(v.created_at)).vendas++;

  return [...dias.values()].sort((a, b) => (a.dia < b.dia ? 1 : -1));
}

/** Soma uma coluna tratando `null` como ausência de medição, não como zero. */
export function somaColuna(linhas: LinhaDia[], chave: keyof LinhaDia): number | null {
  const medidos = linhas.map((l) => l[chave]).filter((v): v is number => typeof v === 'number');
  return medidos.length ? medidos.reduce((s, n) => s + n, 0) : null;
}

/** Percentual de a→b, ou `null` quando qualquer ponta não foi medida. */
export function conversao(de: number | null, para: number | null): number | null {
  if (de == null || para == null || de === 0) return null;
  return +((para / de) * 100).toFixed(1);
}

export interface Fila {
  capital: number;
  ponto: number;
  integrador: number;
  /** Cadastros do lado capital anteriores ao redirect — nunca viram a página. */
  capital_antes_do_redirect: number;
}

/**
 * A fila é contada sobre a base INTEIRA, não sobre a janela: a desproporção
 * entre quem tem dinheiro e quem tem ponto é o retrato do negócio, e recortá-la
 * em trinta dias esconde justamente o acúmulo que ela existe pra mostrar.
 */
export function filaDosCadastros(todos: Cadastro[]): Fila {
  const doLado = (l: string) => todos.filter((c) => c.lado === l);
  const capital = doLado('capital');
  return {
    capital: capital.length,
    ponto: doLado('ponto').length,
    integrador: doLado('integrador').length,
    capital_antes_do_redirect: capital.filter((c) => diaSP(c.created_at) < REDIRECT_DESDE).length,
  };
}
