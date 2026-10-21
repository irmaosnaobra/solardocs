// ─────────────────────────────────────────────────────────────────────────────
// PIX SOB DEMANDA — quando o cliente PEDE pra pagar no Pix.
//
// O caminho padrão de venda virou site + cupom (08/08/2026). Mas quem pede Pix
// recebe Pix: tem gente sem cartão, e recusar é perder a venda. Regra do Thiago
// junto com isso: **sempre pedir o e-mail e o comprovante**.
//
// O e-mail não é formalidade. A liberação automática do comprovante precisa saber
// A QUEM creditar, e ela só sabia isso quando o telefone batia com um checkout
// abandonado (que já tinha e-mail). Quem chegou por outro caminho — anúncio,
// indicação, Instagram — pagava e ficava no limbo. Este módulo guarda, por
// telefone: que mandamos um Pix, de quanto, e o e-mail que ele informou.
//
// Mora em `system_state` (chave única, já usada pelas travas do Pix) pra não
// precisar de tabela nova.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';

export interface ComprovantePendente {
  valor: number;
  dedupKey: string;
  passou: boolean;
  em: string;
  // Chave `pix_e2e:` do comprovante (quando o ID de Pix foi lido). Fica aqui pra
  // que a liberação feita DEPOIS, quando o e-mail chega, grave a mesma trava.
  e2eKey?: string | null;
  // O Thiago já foi avisado de que a conta não pôde ser criada pra este pendente.
  // Sem isto, cada nova tentativa (a Giovanna chama a mesma função) avisaria de novo.
  avisadoFalha?: boolean;
  // Como o comprovante foi validado (ver `modo` em pixComprovanteService) e a data
  // impressa nele. Sem `modo`, o pendente é de antes da regra dos R$ 67 e segue a
  // tabela antiga de valores.
  modo?: 'tabela' | 'entrada' | 'cheio' | 'parcial';
  data?: string | null;
  // Código da transação lido no comprovante, JÁ normalizado (null = ilegível).
  // Quando o e-mail chega, a liberação reserva este código antes de soltar o acesso.
  txid?: string | null;
}

export interface PixSolicitado {
  valor: number;
  email: string | null;
  nome: string | null;
  em: string;
  // Comprovante que chegou ANTES do e-mail (a ordem mais comum: a pessoa manda a
  // foto e só depois o e-mail). Fica guardado aqui pra liberar assim que o
  // e-mail chegar, em vez de morrer num aviso pro Thiago resolver na mão.
  comprovante?: ComprovantePendente | null;
  // 'desconhecido' = o registro nasceu de um comprovante de número que nenhum fluxo
  // nosso conhecia (sem checkout, sem Pix pedido). A imagem seguinte do mesmo número
  // continua passando pelo ramo do desconhecido (com a trava de ID de Pix), e não
  // pelo ramo antigo, que não exige essa prova.
  origem?: 'desconhecido' | null;
}

// Validade do registro: depois disso, um comprovante que chega sem contexto não
// deve ser casado com um Pix que mandamos semanas atrás.
const VALIDADE_DIAS = 30;

// Chave por telefone. NÃO use sufixo curto aqui: dois clientes que terminam nos
// mesmos 8 dígitos dividiriam o registro, e o mês pago de um liberaria o acesso
// do outro (é a mesma classe de bug já corrigida neste subsistema). 11 dígitos =
// DDD + número, que é o formato estável mesmo quando o Z-API manda com ou sem o
// DDI 55 na frente.
export function chaveTelefone(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  // Com DDI: 12 dígitos (sem o 9) ou 13 (com o 9). Tirar o 55 antes de cortar; o
  // corte pelos últimos 11 dava chaves DIFERENTES pro mesmo número com e sem o 9.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  else if (d.length > 11) d = d.slice(-11);
  // Celular antigo sem o 9 (DDD + 8 dígitos começando em 6-9): põe o 9. Fixo
  // (2-5) fica como está.
  if (d.length === 10 && /[6-9]/.test(d[2] ?? '')) d = d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

function chave(phone: string): string {
  return `pix_solicitado:${chaveTelefone(phone)}`;
}

// Chave ANTIGA (até 20/10/2026): últimos 11 dígitos, sem tirar o 55. Dava chave
// diferente pro mesmo número com e sem o 9, e pra 12 e 10 dígitos dava uma chave
// que não é a nova. Registros gravados nos 30 dias anteriores ficam sob ela, então a
// leitura tenta a nova e, se não achar, esta.
export function chaveTelefoneLegada(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  return d.length > 11 ? d.slice(-11) : d;
}
function chaveLegada(phone: string): string {
  return `pix_solicitado:${chaveTelefoneLegada(phone)}`;
}

export async function registrarPixEnviado(phone: string, valor: number, nome?: string | null): Promise<void> {
  const atual = await lerPixSolicitado(phone);
  const payload: PixSolicitado = {
    valor,
    // Não perde o e-mail que ele já tinha mandado antes do Pix.
    email: atual?.email ?? null,
    nome: nome ?? atual?.nome ?? null,
    em: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('system_state')
    .upsert({ key: chave(phone), value: payload }, { onConflict: 'key' });
  if (error) {
    // Sem este registro o comprovante dele cai no limbo — vale log de erro.
    logger.error('pix-solicitado', `não gravei o Pix enviado pra ${phone}`, error);
  }
}

export async function lerPixSolicitado(phone: string): Promise<PixSolicitado | null> {
  let { data } = await supabase
    .from('system_state').select('value').eq('key', chave(phone)).maybeSingle();
  let v = (data as { value?: PixSolicitado } | null)?.value;
  if (!v?.em && chaveLegada(phone) !== chave(phone)) {
    ({ data } = await supabase
      .from('system_state').select('value').eq('key', chaveLegada(phone)).maybeSingle());
    v = (data as { value?: PixSolicitado } | null)?.value;
  }
  if (!v?.em) return null;
  if (Date.now() - new Date(v.em).getTime() > VALIDADE_DIAS * 864e5) return null;
  return v;
}

// Há comprovante Pix esperando o e-mail deste telefone? Serve pra Duda (recepção
// da linha IO) ceder: a resposta com o e-mail é do Pix, não de triagem. Nunca
// lança: na dúvida (banco fora) devolve false e o fluxo segue como antes.
//
// `maxHoras`: o pendente só conta enquanto for RECENTE (48h por padrão). A Duda e o
// webhook não podem calar por 30 dias por causa de um comprovante que ninguém
// respondeu; quem quer o prazo inteiro do registro (liberar quando o e-mail chega)
// passa um número maior.
export async function temComprovantePendente(phone: string, maxHoras = 48): Promise<boolean> {
  try {
    const reg = await lerPixSolicitado(phone);
    const pend = reg?.comprovante;
    if (!pend) return false;
    const desde = Date.parse(pend.em);
    // Sem data legível, não dá pra provar que é recente: conta como pendente (o
    // registro já expira sozinho em 30 dias).
    if (Number.isNaN(desde)) return true;
    return Date.now() - desde <= maxHoras * 3_600_000;
  } catch {
    return false;
  }
}

// Guarda o comprovante que chegou sem e-mail. Se não havia nem registro de Pix
// (comprovante espontâneo), cria um — o pagamento existe de qualquer jeito.
export async function guardarComprovantePendente(
  phone: string, comprovante: ComprovantePendente, extra: { origem?: 'desconhecido' } = {},
): Promise<void> {
  const atual = await lerPixSolicitado(phone);
  const payload: PixSolicitado = {
    valor: atual?.valor ?? comprovante.valor,
    email: atual?.email ?? null,
    nome: atual?.nome ?? null,
    em: atual?.em ?? new Date().toISOString(),
    comprovante,
    origem: extra.origem ?? null,
  };
  const { error } = await supabase
    .from('system_state').upsert({ key: chave(phone), value: payload }, { onConflict: 'key' });
  if (error) logger.error('pix-solicitado', `não guardei o comprovante pendente de ${phone}`, error);
}

// Marca no pendente que o aviso de falha ao criar a conta já foi dado.
export async function marcarAvisoFalhaPendente(phone: string): Promise<void> {
  const atual = await lerPixSolicitado(phone);
  if (!atual?.comprovante) return;
  await supabase.from('system_state').upsert({
    key: chave(phone),
    value: { ...atual, comprovante: { ...atual.comprovante, avisadoFalha: true } },
  }, { onConflict: 'key' });
}

// Limpa o comprovante depois de liberado (o registro fica, o pendente sai).
export async function limparComprovantePendente(phone: string): Promise<void> {
  const atual = await lerPixSolicitado(phone);
  if (!atual) return;
  await supabase.from('system_state')
    .upsert({ key: chave(phone), value: { ...atual, comprovante: null } }, { onConflict: 'key' });
}

// Primeiro e-mail plausível de um texto de WhatsApp. Conservador de propósito:
// e-mail errado cria conta errada e libera acesso pra quem não pagou.
export function acharEmail(texto: string): string | null {
  const m = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(texto || '');
  return m ? m[0].toLowerCase().trim() : null;
}

// Guarda o e-mail que o cliente mandou na conversa.
//
// Grava MESMO sem Pix pendente, de propósito: a ordem "manda o e-mail primeiro,
// paga depois" é comum, e exigir registro prévio jogava esse e-mail fora — aí o
// comprovante chegava e a gente pedia de novo uma informação que ele já tinha
// dado. O registro é inerte enquanto não houver comprovante, e expira em 30 dias.
// Retorna o e-mail quando guardou.
export async function guardarEmailSePendente(phone: string, texto: string, nome?: string | null): Promise<string | null> {
  const email = acharEmail(texto);
  if (!email) return null;
  const atual = await lerPixSolicitado(phone);

  const payload: PixSolicitado = {
    valor: atual?.valor ?? 0,          // 0 = ainda não mandamos Pix, só temos o e-mail
    email,
    nome: nome ?? atual?.nome ?? null,
    em: atual?.em ?? new Date().toISOString(),
    comprovante: atual?.comprovante ?? null,
    origem: atual?.origem ?? null,
  };
  const { error } = await supabase
    .from('system_state').upsert({ key: chave(phone), value: payload }, { onConflict: 'key' });
  if (error) {
    logger.error('pix-solicitado', `não guardei o e-mail de ${phone}`, error);
    return null;
  }
  logger.info('pix-solicitado', `e-mail guardado pra ${phone}: ${email}`);
  return email;
}

// As bolhas do Pix. A instrução é SEMPRE a mesma nos dois pedidos — comprovante
// E e-mail — porque é o par mínimo pra liberar sozinho.
/**
 * Partes do Pix pedido à Giovanna de suporte: texto, instrução do comprovante e o
 * copia-e-cola POR ÚLTIMO (com maxBolhas 1 o texto vira 1 bolha e o código, que nunca é
 * fundido, vem sozinho depois dela).
 */
export function partesPixSobDemanda(copiaECola: string, valor: number): string[] {
  return [...bolhasPix(copiaECola, valor).slice(1), copiaECola];
}

export function bolhasPix(copiaECola: string, valor: number): string[] {
  return [
    copiaECola,
    `São R$ ${valor} (um mês do plano completo).`,
    'Depois de pagar, me manda aqui o *comprovante* e o *e-mail* que você usa (ou vai usar) no SolarDoc — é com ele que eu libero seu acesso 🙌',
  ];
}
