// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS DA RECUPERAÇÃO FORTE DO PIX AUTOMÁTICO (05/11/2026). Texto do redator, aprovado pelo dono.
//
// TUDO que a pessoa lê nesta frente mora AQUI, em constantes com colchetes `[nome]`, para trocar sem mexer em lógica. As funções `montar*` só preenchem os
// colchetes (sempre com o replacer `() =>`, para um `$` no nome não virar padrão) e aplicam os cortes de tamanho. Nada aqui lê banco, relógio ou env.
//
// Regras: sem travessão, sem emoji, começo em maiúscula, link com https:// dentro da frase, sem parede de texto. Quem confere é o teste
// `recuperacaoTextos.test.ts` (tamanho no pior caso, travessão, emoji e `[validade]` sempre preenchido).
// ─────────────────────────────────────────────────────────────────────────────

// ── depoimentos (uma frase literal cada: sem link, sem colchete, sem travessão) ─────────────────────────────────────────────────────────────────────
export const DEP_VANDERLEI =
  'O Vanderlei, da American Energy Solar, de Rondonópolis/MT, conta: "Entre todas que já usei e outras que apenas testei, essa é a que conseguimos gerar propostas mais rapidamente."';
export const DEP_ALESSANDRO =
  'O Alessandro Goulart, da Força Solar, de Feliz/RS, conta: "Aqui, com quatro, cinco cliques eu consigo montar uma proposta."';
export const DEP_GSI =
  'A GSI Energia Solar, de Unaí/MG, conta: "Tenho me surpreendido positivamente com o nível de detalhes das propostas."';

// ── 1. Código vivo (1º toque, 1 bolha; o código vai sozinho na 2ª mensagem) ──────────────────────────────────────────────────────────────────────
export const TEXTO_CODIGO_VIVO =
  'Oi, [nome], aqui é a Carla, da SolarDoc. Seu Pix da [empresa] continua valendo [validade]. [depoimento] É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. É só copiar e colar no Pix copia e cola do seu banco. O código vai logo abaixo.';

// ── 2a. Código novo, mesmo dia ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_CODIGO_NOVO_HOJE =
  'Oi, [nome], aqui é a Carla, da SolarDoc. O Pix que você gerou venceu, então gerei um novo para você. [depoimento] É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. É só copiar e colar no Pix copia e cola do seu banco. O código novo vai logo abaixo.';

// ── 2b. Código novo, dia seguinte (2º toque) ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_CODIGO_NOVO_DIA2 =
  '[saudacao], [nome], aqui é a Carla, da SolarDoc. Voltei porque o Pix que você gerou venceu, então já deixei um novo pronto. [depoimento] É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. É só copiar e colar no Pix copia e cola do seu banco. O código vai logo abaixo.';

// ── 3. Abandono da LP sem Pix (frio, 1 bolha, sem código) ────────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_ABANDONO_LP =
  '[saudacao], [nome], aqui é a Carla, da SolarDoc. Vi que você começou a assinar e não chegou a terminar, ficou alguma dúvida? Se foi só a correria, é só abrir [link] e terminar, leva 1 minuto. Qualquer coisa me responde por aqui que eu te ajudo.';

// ── 4. Resposta na conversa, com o código (1 bolha; o código vai sozinho depois) ─────────────────────────────────────────────────────────────────
export const TEXTO_RESPOSTA_CODIGO =
  'Fechado, [nome]. É o Pix automático de R$ 67 por mês, e você cancela quando quiser pelo app do banco. O código vai aqui embaixo.';
export const TEXTO_RESPOSTA_CODIGO_SEM_NOME =
  'Fechado. É o Pix automático de R$ 67 por mês, e você cancela quando quiser pelo app do banco. O código vai aqui embaixo.';

// ── 5. Pedido de CPF (resposta, nunca toque) ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_PEDIDO_CPF =
  '[nome], o Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu. Me manda aqui, por favor? Assim eu gero o código.';
export const TEXTO_PEDIDO_CPF_SEM_NOME =
  'O Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu. Me manda aqui, por favor? Assim eu gero o código.';

// ── 7. Respostas quando o código não é o caso (redator, 05/11/2026) ─────────────────────────────────────────────────────────────────────────────
export const TEXTO_PIX_JA_PAGOU =
  'Boa notícia, [nome]: seu pagamento já entrou e a SolarDoc já está liberada na sua conta. É só entrar em https://solardoc.app com o seu e-mail.';
export const TEXTO_PIX_JA_PAGOU_SEM_NOME =
  'Boa notícia: seu pagamento já entrou e a SolarDoc já está liberada na sua conta. É só entrar em https://solardoc.app com o seu e-mail.';
/** `[hora]` sai como "15h40" ou "21h" (Brasília). O código ainda vale, mas por menos de 30 min: NADA de código novo. */
export const TEXTO_PIX_AGUARDE =
  'Oi, [nome]. Seu código ainda vale, mas só até [hora]. Se não der tempo, me chama aqui depois desse horário que eu mando um novo.';
export const TEXTO_PIX_AGUARDE_SEM_NOME =
  'Seu código ainda vale, mas só até [hora]. Se não der tempo, me chama aqui depois desse horário que eu mando um novo.';

// ── 6. E-mail da noite com o código ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const EMAIL_CODIGO_ASSUNTO = 'Seu Pix da SolarDoc vale [validade]';
export const EMAIL_CODIGO_CORPO = [
  'Oi, [nome], aqui é a Carla, da SolarDoc.',
  '',
  'Você gerou um Pix para assinar a SolarDoc e ele ainda não foi pago. Ele continua valendo [validade].',
  '',
  'Para pagar, é só copiar o código abaixo e colar no Pix copia e cola do app do seu banco:',
  '',
  '[codigo]',
  '',
  'É o Pix automático: R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc. O banco debita sozinho e você cancela quando quiser pelo app do banco.',
  '',
  'Se preferir, abra a página e gere o pagamento por lá: [link]',
  '',
  'Carla',
  'SolarDoc',
].join('\n');

// ── limites (conferidos no teste, no pior caso já preenchido) ────────────────────────────────────────────────────────────────────────────────────
export const LIMITE_TEXTO_CODIGO = 600;
export const LIMITE_TEXTO_CURTO = 160;
export const LIMITE_TEXTO_LP_SEM_LINK = 400;
export const MAX_NOME = 20;
export const MAX_EMPRESA = 40;

// ── funções ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const corta = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '').trim() || s.slice(0, max).trim());
const nomeCurto = (n: string | null | undefined): string | null => { const t = String(n ?? '').trim(); return t ? corta(t, MAX_NOME) : null; };

/** "Oi, [nome], aqui é a Carla" sem nome vira "Oi, aqui é a Carla" (e "[saudacao], [nome], aqui" vira "[saudacao], aqui"). */
function semNome(texto: string): string { return texto.replace(', [nome], aqui', ', aqui'); }

function preencher(modelo: string, campos: Record<string, string>): string {
  return modelo.replace(/\[([a-z_]+)\]/g, (m, k: string) => (k in campos ? campos[k] : m));
}

export interface EntradaCodigoVivo { nome: string | null; empresa: string | null; validade: string; depoimento: string }
/** Texto 1: o código da véspera (ou do mesmo dia) ainda vale. Sem nome: "Oi, aqui é a Carla". Sem empresa: "Seu Pix continua valendo [validade]". */
export function montarTextoCodigoVivo(e: EntradaCodigoVivo): string {
  const nome = nomeCurto(e.nome);
  const empresa = e.empresa ? corta(e.empresa.trim(), MAX_EMPRESA) : '';
  let modelo = nome ? TEXTO_CODIGO_VIVO : semNome(TEXTO_CODIGO_VIVO);
  if (!empresa) modelo = modelo.replace('Seu Pix da [empresa] continua', 'Seu Pix continua');
  return preencher(modelo, { nome: nome ?? '', empresa, validade: e.validade, depoimento: e.depoimento });
}

export interface EntradaCodigoNovo { nome: string | null; depoimento: string; /** só a 2b usa: "Bom dia" antes das 12h, senão "Oi". */ saudacao?: string }
/** Texto 2a (mesmo dia). */
export function montarTextoCodigoNovoHoje(e: EntradaCodigoNovo): string {
  const nome = nomeCurto(e.nome);
  return preencher(nome ? TEXTO_CODIGO_NOVO_HOJE : semNome(TEXTO_CODIGO_NOVO_HOJE), { nome: nome ?? '', depoimento: e.depoimento });
}
/** Texto 2b (2º toque, dia seguinte). */
export function montarTextoCodigoNovoDia2(e: EntradaCodigoNovo): string {
  const nome = nomeCurto(e.nome);
  return preencher(nome ? TEXTO_CODIGO_NOVO_DIA2 : semNome(TEXTO_CODIGO_NOVO_DIA2), { nome: nome ?? '', depoimento: e.depoimento, saudacao: e.saudacao ?? 'Oi' });
}

/** Texto 3: o abandono da LP. `link` é o `?pagar=pix` com UTMs. */
export function montarTextoAbandonoLp(e: { nome: string | null; saudacao: string; link: string }): string {
  const nome = nomeCurto(e.nome);
  return preencher(nome ? TEXTO_ABANDONO_LP : semNome(TEXTO_ABANDONO_LP), { nome: nome ?? '', saudacao: e.saudacao, link: e.link });
}

/** Texto 4. */
export function montarTextoRespostaCodigo(nome: string | null): string {
  const n = nomeCurto(nome);
  return n ? TEXTO_RESPOSTA_CODIGO.replace('[nome]', () => n) : TEXTO_RESPOSTA_CODIGO_SEM_NOME;
}

/** Texto 5. */
export function montarTextoPedidoCpf(nome: string | null): string {
  const n = nomeCurto(nome);
  return n ? TEXTO_PEDIDO_CPF.replace('[nome]', () => n) : TEXTO_PEDIDO_CPF_SEM_NOME;
}

/** Texto 7a: o pagamento já entrou. Só sai quando a regra de pagamento confirma. */
export function montarTextoPixJaPagou(nome: string | null): string {
  const n = nomeCurto(nome);
  return n ? TEXTO_PIX_JA_PAGOU.replace('[nome]', () => n) : TEXTO_PIX_JA_PAGOU_SEM_NOME;
}

/** Texto 7b: o código vale por pouco. `hora` já vem como "15h40" ou "21h". */
export function montarTextoPixAguarde(e: { nome: string | null; hora: string }): string {
  const n = nomeCurto(e.nome);
  return (n ? TEXTO_PIX_AGUARDE.replace('[nome]', () => n) : TEXTO_PIX_AGUARDE_SEM_NOME).replace('[hora]', () => e.hora);
}

/** E-mail 6 (texto puro). Sem nome: "Oi, aqui é a Carla, da SolarDoc.". */
export function montarEmailCodigo(e: { nome: string | null; validade: string; codigo: string; link: string }): { assunto: string; corpo: string } {
  const n = nomeCurto(e.nome);
  const corpo = n ? EMAIL_CODIGO_CORPO : EMAIL_CODIGO_CORPO.replace('Oi, [nome], aqui', 'Oi, aqui');
  const campos = { nome: n ?? '', validade: e.validade, codigo: e.codigo, link: e.link };
  return { assunto: preencher(EMAIL_CODIGO_ASSUNTO, campos), corpo: preencher(corpo, campos) };
}

/** Todos os textos de WhatsApp desta frente, para o teste varrer (travessão, emoji, tamanho). */
export const MODELOS_WHATSAPP: Record<string, string> = {
  TEXTO_CODIGO_VIVO, TEXTO_CODIGO_NOVO_HOJE, TEXTO_CODIGO_NOVO_DIA2, TEXTO_ABANDONO_LP, TEXTO_RESPOSTA_CODIGO, TEXTO_RESPOSTA_CODIGO_SEM_NOME,
  TEXTO_PEDIDO_CPF, TEXTO_PEDIDO_CPF_SEM_NOME, TEXTO_PIX_JA_PAGOU, TEXTO_PIX_JA_PAGOU_SEM_NOME, TEXTO_PIX_AGUARDE, TEXTO_PIX_AGUARDE_SEM_NOME,
};
