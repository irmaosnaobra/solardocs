// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS DA RECUPERAÇÃO PESADA DO QUIZ E DO PIX DO SOLARDOC (16/11/2026). Texto do redator, com o remodelamento do chefe anti-ban:
//   - 1 bolha de até 900 caracteres por toque, linhas curtas juntas com quebra de linha;
//   - 1 forma de pagamento por toque: o código do Pix automático SOZINHO na 2ª mensagem (quem tem CPF salvo), ou 1 link inteiro (https://solardoc.app/...);
//   - 3 variações por toque, escolhidas pelo hmac da pessoa (a mesma pessoa sempre ouve a mesma variação);
//   - nunca "venceu", "falhou", "travou" nem "fora do ar": não houve falha no Pix, e o texto não diz que houve.
// Diferenças do texto do redator, todas pela regra de 1 forma de pagamento por toque: o "já te mando os dois" saiu, a outra forma vira "me fala que eu te
// mando", e "Se travar em algum passo" virou "Se ficar alguma dúvida em algum passo". O toque 4 do redator não existe (o chefe barrou: 3 toques no máximo).
// O valor: `[[com valor|sem valor]]` escolhe a frase; `{valor}` é a mensalidade REAL de quem recebe (R$ 67 no link; no código, a do contrato, que pode ter
// adicionais do bump). Sem o valor certo, a frase sai sem número: nunca "R$ 67" para quem o banco vai debitar outro valor.
// Nada aqui lê banco, relógio ou env. Quem confere é o teste `recuperacaoPesada.test.ts` (tamanho no pior caso, travessão, emoji, palavras proibidas).
// ─────────────────────────────────────────────────────────────────────────────

export type SituacaoPesada = 'quiz' | 'pix';
export type FormaPesada = { tipo: 'codigo' } | { tipo: 'link_pix'; link: string } | { tipo: 'link_cartao'; link: string };

// ── 1º toque, quem fez o quiz e chegou na hora de pagar (Texto 1 A e B do redator; a C é o toque 1 A do Texto 3) ─────────────────────────────────
export const T1_QUIZ: readonly string[] = [
  'Oi, [nome], aqui é a Carla, da SolarDoc.\nVi que você fez seu diagnóstico e chegou na hora de pagar, mas não concluiu.\nTeve algum problema ou dúvida nessa hora?\nSe teve, me conta que eu te ajudo por aqui.\nJá te mando o jeito de pagar.\n[pagamento]',
  'Oi, [nome], é a Carla, da SolarDoc.\nPassando para saber se deu algum problema na hora de pagar.\nÀs vezes é só uma dúvida, e eu te respondo rapidinho.\nJá te mando o jeito de pagar.\n[pagamento]',
  'Oi, [nome], aqui é a Carla, da SolarDoc.\nVocê deixou seu WhatsApp no diagnóstico e não chegou a assinar.\nTeve algum problema para pagar?\nJá te mando o jeito de pagar, caso queira terminar agora.\n[pagamento]',
];

// ── 1º toque, quem começou o Pix automático e não concluiu (Texto 2 A e B do redator; a C segue o mesmo tom) ────────────────────────────────────────
export const T1_PIX: readonly string[] = [
  'Oi, [nome], aqui é a Carla, da SolarDoc.\nVi que a autorização do seu Pix automático não foi concluída.\nDeu algum problema na hora de autorizar no banco?\nSe ficar alguma dúvida em algum passo, me diz qual que eu te ajudo.\n[pagamento]',
  'Oi, [nome], é a Carla, da SolarDoc.\nSeu Pix automático ficou sem concluir, e queria saber se o banco deu algum problema.\nJá te mando o pagamento.\n[pagamento]',
  'Oi, [nome], aqui é a Carla, da SolarDoc.\nVi que você começou a assinar no Pix automático e não chegou a concluir.\nFicou alguma dúvida ou deu algum problema no banco? Me conta aqui.\n[pagamento]',
];

// ── 2º toque, a partir do dia útil seguinte (Texto 3, toque 2 A e B; a C pergunta a dúvida primeiro) ───────────────────────────────────────────────
export const T2: readonly string[] = [
  'Oi, [nome], a Carla de novo, da SolarDoc.\n[resultado]\nNo SolarDoc você monta suas propostas e documentos no app, sem limite de documentos.\n[[São {valor} por mês|É uma mensalidade]], sem fidelidade.\nE tem garantia de 7 dias: se não servir, o valor volta inteiro. É só pedir pelo WhatsApp.\nJá te mando o pagamento.\n[pagamento]',
  'Oi, [nome], é a Carla, da SolarDoc, voltando aqui.\n[resultado]\nO SolarDoc monta a proposta no app, com documentos ilimitados.\n[[Assinar custa {valor} por mês|Assinar é uma mensalidade]] e você cancela quando quiser.\nSe não servir, a garantia de 7 dias devolve o valor inteiro.\nTe mando o pagamento agora.\n[pagamento]',
  'Oi, [nome], a Carla de novo, da SolarDoc.\nFicou alguma dúvida sobre a SolarDoc ou sobre o pagamento? Pode me perguntar aqui.\n[resultado]\n[[São {valor} por mês|É uma mensalidade]], você cancela quando quiser, e a garantia de 7 dias devolve o valor inteiro se não servir.\n[pagamento]',
];

// ── 3º e último toque, 2 dias úteis depois do 2º (Texto 3, toque 3 A e B; a C é a pergunta do plano) ────────────────────────────────────────────────
export const T3: readonly string[] = [
  'Oi, [nome], é a Carla, da SolarDoc.\nÚltimo chamado por aqui: ainda quer assinar?\nTe mando o pagamento agora.\n[pagamento]',
  'Oi, [nome], a Carla de novo.\nSe ainda faz sentido para você, te mando o pagamento aqui.\n[pagamento]\nSe não faz, sem problema nenhum, é só me avisar que eu paro de chamar.',
  'Oi, [nome], aqui é a Carla, da SolarDoc.\nPosso te ajudar a terminar a assinatura, ou prefere que eu pare de chamar?\n[pagamento]',
];

// ── a forma de pagamento: `completo` leva a frase do débito (1º e 3º toque); o 2º toque já fala do preço e da garantia no corpo ──────────────────────
const DEBITO = 'É a mensalidade [[de {valor}|do plano]], você cancela quando quiser e a garantia de 7 dias devolve o valor.';
const PAG_CODIGO = 'É o Pix automático. [debito] Se preferir o cartão, me fala que eu te mando o link. O código vai logo abaixo, é só copiar e colar no Pix copia e cola do seu banco.';
const PAG_CODIGO_CURTO = 'Se preferir o cartão, me fala que eu te mando o link. O código do Pix automático vai logo abaixo, é só copiar e colar no Pix copia e cola do seu banco.';
const PAG_LINK_PIX = 'Para assinar no Pix automático, é só abrir [link] e terminar por lá. [debito] Se preferir o cartão, me fala que eu te mando.';
const PAG_LINK_PIX_CURTO = 'Para assinar no Pix automático, é só abrir [link] e terminar por lá. Se preferir o cartão, me fala que eu te mando.';
const PAG_LINK_CARTAO = 'Para assinar no cartão, é só abrir [link] e terminar por lá. [debito] Se preferir o Pix automático, me fala que eu te mando.';
const PAG_LINK_CARTAO_CURTO = 'Para assinar no cartão, é só abrir [link] e terminar por lá. Se preferir o Pix automático, me fala que eu te mando.';

export const LIMITE_TEXTO_PESADA = 900;
const MAX_NOME = 20;

/** Escolhe a variação pelo hmac: estável para a pessoa, espalhada entre pessoas. */
export function variacaoDoHmac(hmac: string, n: number): number {
  const v = parseInt(String(hmac ?? '').slice(0, 6), 16);
  return Number.isFinite(v) && n > 0 ? v % n : 0;
}

/** "R$ 67", "R$ 84" ou "R$ 84,90". null = sem valor. */
export function valorPorExtenso(v: number | null): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Number.isInteger(v) ? `R$ ${v}` : `R$ ${v.toFixed(2).replace('.', ',')}`;
}

/** Resolve `[[com valor|sem valor]]` e `{valor}`. */
function comValor(t: string, valor: string | null): string {
  return t.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, (_m, com: string, sem: string) => (valor ? com.replace('{valor}', () => valor) : sem));
}

function frasePagamento(f: FormaPesada, completo: boolean): string {
  const debito = completo ? DEBITO : '';
  const modelo = f.tipo === 'codigo' ? (completo ? PAG_CODIGO : PAG_CODIGO_CURTO)
    : f.tipo === 'link_pix' ? (completo ? PAG_LINK_PIX : PAG_LINK_PIX_CURTO)
      : (completo ? PAG_LINK_CARTAO : PAG_LINK_CARTAO_CURTO);
  const link = f.tipo === 'codigo' ? '' : f.link;
  return modelo.replace('[debito]', () => debito).replace('[link]', () => link).replace(/\s+/g, ' ').trim();
}

export interface EntradaPesada {
  toque: 1 | 2 | 3;
  /** 'quiz' = fez o diagnóstico; 'pix' = começou o Pix automático (LP ou quiz) e tem contrato. Só muda o 1º toque. */
  situacao: SituacaoPesada;
  /** Primeiro nome já limpo, ou null ("Oi, aqui é a Carla"). */
  nome: string | null;
  /** A frase do diagnóstico ("O seu diagnóstico deu 37 de 100, com velocidade pesando mais."), ou null (a linha sai). */
  resultado: string | null;
  forma: FormaPesada;
  hmac: string;
  /** A mensalidade REAL desta pessoa (R$ 67 no link; a do contrato no código), ou null: o texto não cita valor. Obrigatório de propósito. */
  valorMensal: number | null;
}

/** O texto do toque, 1 bolha. Sem nome: "Oi, aqui é a Carla". Sem resultado: a linha sai. Nunca leva o código (ele vai sozinho na 2ª mensagem). */
export function montarToquePesado(e: EntradaPesada): string {
  const lista = e.toque === 1 ? (e.situacao === 'pix' ? T1_PIX : T1_QUIZ) : e.toque === 2 ? T2 : T3;
  const modelo = lista[variacaoDoHmac(e.hmac, lista.length)] as string;
  const nome = e.nome ? e.nome.trim().slice(0, MAX_NOME).trim() : '';
  const texto = (nome ? modelo : modelo.replace(', [nome],', ','))
    .replace('[nome]', () => nome)
    .replace('[pagamento]', () => frasePagamento(e.forma, e.toque !== 2))
    .replace('[resultado]', () => (e.resultado ?? '').trim());
  return comValor(texto, valorPorExtenso(e.valorMensal)).split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

/** Todos os modelos e frases, para o teste varrer (travessão, emoji, palavras proibidas). */
export const MODELOS_PESADA: readonly string[] = [
  ...T1_QUIZ, ...T1_PIX, ...T2, ...T3, DEBITO, PAG_CODIGO, PAG_CODIGO_CURTO, PAG_LINK_PIX, PAG_LINK_PIX_CURTO, PAG_LINK_CARTAO, PAG_LINK_CARTAO_CURTO,
];
