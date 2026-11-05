import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { fmtPhone, sendFrio, type ZapiInstance } from '../agents/zapiClient';
import { motivosDaSupressao } from '../agents/whatsapp/silenciar';
import { liberarChave, reservarChave } from '../agentes5040/cota';
import { diaBRT } from '../agentes5040/relogio';

// ─────────────────────────────────────────────────────────────────────────────
// LINK DE SENHA (04/11/2026). Cliente pago que esqueceu a senha recupera sozinho, a qualquer hora:
// o link vai pelo e-mail E pelo WhatsApp cadastrado na conta, tanto pelo "Esqueci minha senha" do site
// quanto pela Giovanna (reenviar_acesso).
//
// Regras que seguram este arquivo:
//  • O token e a URL NUNCA vão para console, logger, sessão, registrarMsgProativa nem modelo. Só o corpo
//    da mensagem de WhatsApp e do e-mail carregam o link.
//  • O WhatsApp sai como mensagem de resposta a um PEDIDO da própria pessoa (não é toque frio de verdade),
//    por isso sem janela de horário: tem que sair às 22h30. O link pedido no SITE passa mesmo com atendente
//    humano na conversa (sendFrio com `transacional`, que só dispensa a pausa; aprovado pelo chefe anti-ban em
//    05/11/2026); o da Giovanna ainda confere a pausa (sendFrio sem `transacional`). A supressão vale, e há tetos: 3 por conta em 24 h (e 1 por 10 min, que mata o duplo
//    clique) e, para proteger a linha, 6 por hora e 20 por dia no robô inteiro (carimbo link_senha_sent:).
//  • Nunca lança: quem chama decide o que dizer ao cliente pelo status devolvido.
// ─────────────────────────────────────────────────────────────────────────────

const VALE_MS = 24 * 3_600_000;
const SOBRA_MINIMA_MS = 60 * 60_000;
const TETO_CONTA_24H = 3;
const JANELA_DUPLO_CLIQUE_MS = 600_000;
const TETO_ROBO_HORA = 6;
const TETO_ROBO_DIA = 20;
const ESPACAMENTO_MS = 10_000;
const PASSOS_TENTATIVAS = 3;

export const PREFIXO_CARIMBO_ROBO = 'link_senha_sent:';
/** O passo de 10 s do envio. Fica FORA de BOT_SENT_PREFIXES e PREFIXOS_AGENDA: não é mensagem enviada, só a reserva da vez. */
export const PREFIXO_PASSO = 'link_senha_passo:';
export const PREFIXO_CONTA = (userId: string) => `link_senha_conta:${userId}:`;

/** Ponto de troca para os testes (a espera de 10 s não pode travar a suíte). */
export const _deps = {
  dormir: (ms: number): Promise<void> => new Promise(ok => setTimeout(ok, ms)),
};

export type StatusEnvioLink = 'enviado' | 'teto_conta' | 'teto_robo' | 'suprimido' | 'pausa' | 'sem_whatsapp' | 'erro';

export interface LinkDeSenha {
  url: string;
  token: string;
  reaproveitado: boolean;
}

function urlDoLink(token: string): string {
  const base = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim().replace(/\/$/, '');
  return `${base}/auth?mode=redefinir&token=${token}`;
}

async function lerToken(userId: string): Promise<{ token: string | null; expira: number }> {
  const { data, error } = await supabase.from('users').select('reset_token, reset_token_expires').eq('id', userId).maybeSingle();
  if (error) throw Object.assign(new Error('leitura do link de senha falhou'), { causa: error });
  if (!data) throw new Error('conta não encontrada');
  const r = data as { reset_token: string | null; reset_token_expires: string | null };
  return { token: r.reset_token ?? null, expira: Date.parse(String(r.reset_token_expires ?? '')) };
}

const vale = (t: { token: string | null; expira: number }): t is { token: string; expira: number } =>
  !!t.token && Number.isFinite(t.expira) && t.expira >= Date.now() + SOBRA_MINIMA_MS;

/**
 * Tira o token e a URL de um texto de erro ANTES de cortá-lo (cortar primeiro deixaria um pedaço do token passar).
 * Além do token e da URL que a gente conhece, apaga qualquer `token=<hex>` e qualquer link de redefinição que apareça.
 */
export function semSegredo(texto: unknown, ...segredos: Array<string | null | undefined>): string {
  let t = texto instanceof Error ? texto.message : String(texto ?? '');
  for (const sg of segredos) if (sg) t = t.split(sg).join('***');
  return t.replace(/https?:\/\/\S*mode=redefinir\S*/g, '[link]').replace(/token=[0-9a-zA-Z_-]+/g, 'token=***');
}

/** Conta que paga hoje (mesmo critério do followupService, `acessoPago`): plano pago com cobrança ativa ou em teste, ou Pix com vigência. */
export function contaPaga(u: { plano?: string | null; billing_status?: string | null; plano_expira_em?: string | null } | null | undefined): boolean {
  if (!u) return false;
  const cobrando = !!u.plano && u.plano !== 'free' && ['active', 'trialing'].includes(String(u.billing_status ?? ''));
  const pixVivo = !!u.plano_expira_em && Date.parse(u.plano_expira_em) > Date.now();
  return cobrando || pixVivo;
}

/**
 * O link vivo da conta. Quem manda é SEMPRE o token que está no banco:
 *  • token que vale (>= 60 min): reaproveita; se o vencimento está a menos de 24 h, renova para agora + 24 h (nunca encurta um
 *    token mais longo, como o de 30 dias de quem ainda não criou a senha), para a promessa "vale por 24 horas" ser sempre verdadeira;
 *  • sem token, ou vencido: grava um novo de 24 h.
 * As duas gravações são CONDICIONAIS ao token que lemos (`reset_token is null` ou `reset_token = <lido>`): se o site e a Giovanna
 * correm ao mesmo tempo, só uma grava; a outra não muda nada. Depois relê e usa o do banco, então quem perdeu a corrida usa o do vencedor.
 * Lança se não conseguir (quem chama decide: o site vira 503, a Giovanna recusa).
 */
export async function linkVivoDeSenha(userId: string): Promise<LinkDeSenha> {
  const atual = await lerToken(userId);
  const vence24h = Date.now() + VALE_MS;
  let gravado: string | null = null;   // o token que ESTA chamada tentou gravar (para saber se reaproveitou)

  if (vale(atual)) {
    if (atual.expira < vence24h) {
      const { error } = await supabase.from('users').update({ reset_token_expires: new Date(vence24h).toISOString() })
        .eq('id', userId).eq('reset_token', atual.token);
      if (error) throw Object.assign(new Error('renovação do link de senha falhou'), { causa: error });
    }
  } else {
    gravado = crypto.randomBytes(32).toString('hex');
    const q = supabase.from('users').update({ reset_token: gravado, reset_token_expires: new Date(vence24h).toISOString() }).eq('id', userId);
    const { error } = await (atual.token === null ? q.is('reset_token', null) : q.eq('reset_token', atual.token));
    if (error) throw Object.assign(new Error('gravação do link de senha falhou'), { causa: error });
  }

  const relido = await lerToken(userId);
  if (!vale(relido)) throw new Error('o link não ficou gravado');
  return { url: urlDoLink(relido.token), token: relido.token, reaproveitado: relido.token !== gravado };
}

async function chavesDesde(prefixo: string, desdeMs: number): Promise<Array<{ key: string; updated_at: string }>> {
  const { data, error } = await supabase.from('system_state').select('key, updated_at')
    .like('key', `${prefixo}%`).gte('updated_at', new Date(Date.now() - desdeMs).toISOString()).limit(200);
  if (error) throw new Error('leitura dos tetos falhou');
  return (data ?? []) as Array<{ key: string; updated_at: string }>;
}

/** Reserva a vaga do dia do robô (link_senha_sent:<dia>:<n>, n de 1 a 20). Devolve a chave, ou o motivo. */
async function reservarVagaDoRobo(agora: Date): Promise<{ chave: string } | { motivo: 'teto_robo' | 'erro' }> {
  const dia = diaBRT(agora);
  if (!dia) return { motivo: 'erro' };
  const { count, error } = await supabase.from('system_state')
    .select('key', { count: 'exact', head: true }).like('key', `${PREFIXO_CARIMBO_ROBO}${dia}:%`);
  if (error) return { motivo: 'erro' };
  const base = count ?? 0;
  for (let i = 0; i < TETO_ROBO_DIA; i++) {
    const n = base + 1 + i;
    if (n > TETO_ROBO_DIA) return { motivo: 'teto_robo' };
    const chave = `${PREFIXO_CARIMBO_ROBO}${dia}:${n}`;
    const r = await reservarChave(chave, { origem: 'link_senha' }, agora);
    if (r === 'reservada') return { chave };
    if (r === 'erro') return { motivo: 'erro' };
  }
  return { motivo: 'teto_robo' };
}

/**
 * Manda o link pelo WhatsApp cadastrado na conta. Nunca lança. A ordem importa:
 * número válido, supressão, teto da conta, teto do robô, envio.
 */
export async function enviarLinkDeSenha(
  userId: string,
  origem: 'site' | 'giovanna',
  instancia: ZapiInstance = 'solardoc',
  url: string,
): Promise<StatusEnvioLink> {
  try {
    // 1. número da conta
    const { data: u, error: eU } = await supabase.from('users').select('whatsapp').eq('id', userId).maybeSingle();
    if (eU) return 'erro';
    const bruto = (u as { whatsapp?: string | null } | null)?.whatsapp;
    const tel = String(bruto ?? '').replace(/\D/g, '');
    if (tel.length < 10 || tel.length > 13) return 'sem_whatsapp';

    // 2. supressão (opt-out, denúncia...): erro de leitura também barra
    try {
      const motivos = await motivosDaSupressao(tel);
      if (motivos.length > 0) return 'suprimido';
    } catch {
      return 'suprimido';
    }

    // 3. teto por conta: 3 em 24 h; janela móvel de 10 min contra o duplo clique (qualquer reserva da conta há menos de 10 min barra);
    // e a chave do bloco de 10 min fecha a corrida de dois pedidos no mesmo instante.
    const naConta = await chavesDesde(PREFIXO_CONTA(userId), 24 * 3_600_000);
    if (naConta.length >= TETO_CONTA_24H) return 'teto_conta';
    if (naConta.some(r => Date.now() - Date.parse(r.updated_at) < JANELA_DUPLO_CLIQUE_MS)) return 'teto_conta';
    const agora = new Date();
    const candidataConta = `${PREFIXO_CONTA(userId)}${Math.floor(agora.getTime() / JANELA_DUPLO_CLIQUE_MS)}`;
    const rc = await reservarChave(candidataConta, { origem }, agora);
    if (rc === 'ja_existe') return 'teto_conta';
    if (rc === 'erro') return 'erro';
    const chaveConta = candidataConta;
    let chaveRobo: string | null = null;
    const devolve = async (status: StatusEnvioLink): Promise<StatusEnvioLink> => {
      await liberarChave(chaveConta);
      if (chaveRobo) await liberarChave(chaveRobo);
      return status;
    };

    // 4. teto do robô (carimbo da linha): 6 por hora, 20 por dia, no máximo 1 a cada 10 s. Tudo por RESERVA, não por leitura:
    // instâncias da Vercel em paralelo leem o mesmo número e passariam todas juntas.
    const naHora = await chavesDesde(PREFIXO_CARIMBO_ROBO, 3_600_000);
    if (naHora.length >= TETO_ROBO_HORA) return devolve('teto_robo');   // saída rápida; a conta que vale é a de depois da reserva

    // 4a. o passo de 10 s: uma reserva por janela de 10 s. Já tomada, espera a próxima janela (até 3 tentativas).
    let passou = false;
    for (let tentativa = 0; tentativa < PASSOS_TENTATIVAS && !passou; tentativa++) {
      const r = await reservarChave(`${PREFIXO_PASSO}${Math.floor(Date.now() / ESPACAMENTO_MS)}`, { origem: 'link_senha' }, new Date());
      if (r === 'reservada') passou = true;
      else if (r === 'erro') return devolve('erro');
      else if (tentativa < PASSOS_TENTATIVAS - 1) await _deps.dormir(ESPACAMENTO_MS - (Date.now() % ESPACAMENTO_MS) + 25);
    }
    if (!passou) return devolve('teto_robo');

    // 4b. a vaga do dia e a RECONTAGEM da hora já com a própria chave: passou de 6, devolve as duas e desiste.
    const vaga = await reservarVagaDoRobo(new Date());
    if (!('chave' in vaga)) return devolve(vaga.motivo);
    chaveRobo = vaga.chave;
    let naHoraDepois: number;
    try {
      naHoraDepois = (await chavesDesde(PREFIXO_CARIMBO_ROBO, 3_600_000)).length;
    } catch {
      return devolve('erro');
    }
    if (naHoraDepois > TETO_ROBO_HORA) return devolve('teto_robo');

    // 5. envio: o pedido do SITE leva `transacional`, que no sendFrio só dispensa a pausa humana (como no evento do dunning,
    // dunningService.ts:338); bolha, desvio e o freio de 60 s continuam valendo. A origem `giovanna` NÃO leva, então a pausa vale para ela.
    const texto = `Aqui está o link para você criar uma senha nova na SolarDoc:\n${url}\nEle vale por 24 horas. Se não foi você que pediu, pode ignorar esta mensagem.`;
    const saiu = await sendFrio(fmtPhone(tel), [texto], instancia, origem === 'site' ? { transacional: true } : undefined);

    // 6. pausa humana (só pode acontecer na origem `giovanna`): nada saiu, devolve as duas vagas
    if (saiu === false) return devolve('pausa');

    // 7. registro na sessão, SEM o link (só quando a pessoa não estava falando com a Giovanna: lá o turno já registra)
    if (origem === 'site') {
      try {
        const { registrarMsgProativa } = await import('../agents/whatsapp/whatsappAgentService');
        await registrarMsgProativa({
          userId, phone: String(bruto), content: 'Mandei o link para criar uma senha nova na SolarDoc, aqui e no e-mail. Ele vale por 24 horas.',
        });
      } catch { /* o registro é só contexto para a Giovanna; não muda o resultado do envio */ }
    }
    return 'enviado';
  } catch (err) {
    // Erro da Z-API (ou outro): as chaves ficam, para não repetir a tentativa em rajada. Sem token no log.
    logger.warn('link-de-senha', 'o WhatsApp do link de senha não saiu', {
      userId, origem, erro: semSegredo(err, url, url.split('token=')[1]).slice(0, 200),
    });
    return 'erro';
  }
}
