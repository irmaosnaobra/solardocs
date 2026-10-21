// ─────────────────────────────────────────────────────────────────────────────
// SILENCIAR CONTATO, um lugar só pra "esta pessoa pediu pra parar".
//
// Por que existe. Em 31/08/2026 a tabela whatsapp_suppression tinha QUATRO
// linhas na base inteira, e três handlers de opt-out (Bia, gerador, LimpaPro)
// detectavam "para de me mandar", respondiam "sem problema, parei por aqui" e
// gravavam só no estado da própria sessão, que nenhum agente de SAÍDA lê. Ou
// seja: a pessoa pedia pra parar, era acolhida, e continuava recebendo de todas
// as outras trilhas. Não existe jeito mais rápido de virar denúncia, e denúncia
// é o que a Meta usa pra derrubar número.
//
// A CHAVE, que é o segundo bug e o mais silencioso. A supressão antiga casava
// por `slice(-10)`, os dez últimos dígitos. No Brasil isso QUEBRA, porque a
// Z-API alterna o nono dígito entre mensagens do mesmo contato:
//
//   5534991360172 (13 dígitos) → slice(-10) = "4991360172"
//    553491360172 (12 dígitos) → slice(-10) = "3491360172"
//
// É o MESMO telefone e dá duas chaves diferentes. Quem pediu pra parar num
// formato voltava a receber no outro, e ninguém veria: falha de chave não dá
// erro, dá silêncio do lado errado.
//
// A chave daqui é DDD + os 8 últimos dígitos, que é estável nas duas formas
// (34 + 91360172 nos dois casos acima). Fixo não vira celular e vice-versa,
// porque o que muda entre as duas formas é sempre o nono dígito, nunca o DDD.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';

/**
 * Chave estável de contato: DDD + os 8 últimos dígitos.
 *
 * Devolve null pro que não dá pra normalizar com segurança (curto demais, ou
 * id de grupo, que tem 18 dígitos e nenhum DDD). Null nunca casa com nada, e é
 * de propósito: na dúvida a mensagem passa, porque silenciar por engano é pior
 * do que deixar passar uma.
 */
export function chaveContato(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;   // > 13 é grupo, não pessoa
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (semDdi.length < 10) return null;
  return semDdi.slice(0, 2) + semDdi.slice(-8);
}

export type MotivoSilencio = 'opt_out' | 'denuncia' | 'nunca_respondeu'
  | 'pediu_humano' | 'fora_do_padrao';

/**
 * MODO ESTRITO das leituras de bloqueio (11/10/2026).
 *
 * O padrão das funções de carregar daqui é falhar ABERTO: se o banco piscar,
 * ninguém é barrado, porque a régua inteira parando custa mais que um toque a
 * mais. Isso vale para quem drena fila de quem já é nosso. Não vale para
 * ABERTURA FRIA: ali, sem saber quem pediu para parar, o certo é não mandar para
 * ninguém.
 *
 * Com { estrito: true } o erro de leitura SOBE, e a leitura vem paginada (o
 * PostgREST corta em 1000 linhas, e lista cortada também é "não saber"). Sem o
 * parâmetro nada muda para os outros robôs.
 */
export interface LeituraEstrita { estrito?: boolean }

const PAGINA_ESTRITA = 1000;
const TETO_ESTRITO = 100_000;

const mensagemDoErro = (err: unknown): string =>
  String((err as { message?: string })?.message || err).slice(0, 200);

/** Os telefones da supressão, inteiros (paginado). Motivo nulo = todos. Erro sobe. */
async function lerSupressaoInteira(motivo: string | null): Promise<string[]> {
  const out: string[] = [];
  for (let de = 0; ; de += PAGINA_ESTRITA) {
    let q = supabase.from('whatsapp_suppression').select('phone');
    if (motivo) q = q.eq('motivo', motivo);
    const { data, error } = await q.order('phone', { ascending: true }).range(de, de + PAGINA_ESTRITA - 1);
    if (error) throw error;
    const lote = (data ?? []) as { phone: string }[];
    for (const r of lote) out.push(r.phone);
    if (lote.length < PAGINA_ESTRITA) return out;
    if (de >= TETO_ESTRITO) throw new Error('supressão grande demais para ler inteira');
  }
}

/**
 * Os MOTIVOS de supressão gravados para este telefone (todos os formatos do mesmo contato), em leitura ESTRITA:
 * erro de leitura SOBE (quem chama barra). Existe para quem RESPONDE a quem acabou de escrever: ali só alguns
 * motivos barram (opt_out, denuncia, fora_do_padrao) e 'pediu_humano' manda a conversa para uma pessoa;
 * 'nunca_respondeu' é regra de toque proativo e não vale para resposta. `[]` = sem registro.
 * A tabela guarda o telefone em dígitos de formatos variados: acha pelos 8 últimos e confere a chave inteira.
 */
export async function motivosDaSupressao(phone: string | null | undefined): Promise<string[]> {
  const k = chaveContato(phone);
  if (!k) throw new Error('telefone sem chave');
  const { data, error } = await supabase.from('whatsapp_suppression').select('phone, motivo').like('phone', `%${k.slice(-8)}`);
  if (error) throw new Error('leitura da supressão falhou: ' + mensagemDoErro(error));
  return ((data ?? []) as { phone: string; motivo: string | null }[])
    .filter(r => chaveContato(r.phone) === k)
    .map(r => String(r.motivo ?? ''));
}

/**
 * Grava o pedido de parada. Idempotente, e nunca derruba o atendimento: quem
 * chama está no meio de responder ao cliente, e falhar aqui não pode virar
 * silêncio pra quem acabou de escrever.
 *
 * Guarda o telefone em dígitos puros, como a tabela sempre guardou, porque a
 * leitura normaliza dos dois lados. Assim linhas antigas continuam valendo.
 */
export async function silenciarContato(
  phone: string,
  motivo: MotivoSilencio,
  origem: string,
): Promise<void> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits || !chaveContato(digits)) return;
  try {
    await supabase.from('whatsapp_suppression').upsert(
      { phone: digits, motivo, origem, user_deletado: false },
      { onConflict: 'phone' },
    );
    logger.info('silenciar', `${digits} silenciado (${motivo} via ${origem})`);
  } catch (err) {
    logger.error('silenciar', `falhou ao silenciar ${digits}`, err);
  }
}

/**
 * Devolve um predicado "este telefone pediu pra parar?".
 *
 * Lê a tabela uma vez e devolve função, porque quem usa isso está num laço de
 * disparo e não pode fazer um select por contato.
 *
 * Fail-open com log: se a leitura falhar, ninguém é bloqueado. Um disparo a mais
 * é ruim; a régua inteira parando porque o banco piscou é pior, e sem o log
 * viraria mistério.
 */
export async function carregarSilenciados(opts: LeituraEstrita = {}): Promise<(phone: string) => boolean> {
  const chaves = new Set<string>();
  try {
    if (opts.estrito) {
      for (const phone of await lerSupressaoInteira(null)) { const k = chaveContato(phone); if (k) chaves.add(k); }
    } else {
      const { data, error } = await supabase.from('whatsapp_suppression').select('phone');
      if (error) throw error;
      for (const r of data ?? []) {
        const k = chaveContato((r as { phone: string }).phone);
        if (k) chaves.add(k);
      }
    }
  } catch (err) {
    if (opts.estrito) throw new Error('leitura do opt-out falhou: ' + mensagemDoErro(err));
    logger.error('silenciar', 'leitura da supressão falhou: ninguém será bloqueado nesta rodada', err);
  }
  return (phone: string): boolean => {
    const k = chaveContato(phone);
    return k !== null && chaves.has(k);
  };
}

/** Toques sem resposta a partir dos quais o robô para de insistir. */
export const TOQUES_ATE_DESISTIR = Number(process.env.ANTIBAN_TOQUES_MUDO || 3);

/**
 * Predicado "esta pessoa nunca deu sinal de vida e já levou toque demais".
 *
 * É a regra que mais reduz risco de ban, porque falar três vezes com quem nunca
 * respondeu é exatamente o que produz o "bloquear e denunciar", e denúncia é o
 * que a Meta usa pra derrubar número. Medido em 60 dias: 230 contatos nessa
 * situação, depois de já descontar quem tem conta.
 *
 * O SINAL DE VIDA NÃO É SÓ RESPONDER NO WHATSAPP, e isso não é detalhe: 54 dos
 * 415 mudos TÊM CONTA na plataforma. São clientes cadastrados que nunca
 * escreveram no zap, e um corte por "não respondeu" calaria o follow-up de quem
 * paga. A função wa_mudos no banco já exclui esses.
 *
 * SÓ VALE PRA TOQUE PROATIVO. Quem escreveu primeiro é sempre respondido, e
 * mensagem transacional sobre algo que a própria pessoa marcou (confirmação de
 * reunião) também passa: ali o sinal de contato é o formulário que ela preencheu.
 *
 * Fail-open com log, pelo mesmo motivo do carregarSilenciados: banco fora do ar
 * não pode calar a régua inteira.
 */
export async function carregarMudos(
  minToques = TOQUES_ATE_DESISTIR,
  dias = 60,
  opts: LeituraEstrita = {},
): Promise<(phone: string) => boolean> {
  const chaves = new Set<string>();
  try {
    if (opts.estrito) {
      // Paginado: com 2 toques a lista pode passar das 1000 linhas do PostgREST.
      for (let de = 0; ; de += PAGINA_ESTRITA) {
        const { data, error } = await supabase.rpc('wa_mudos', { min_toques: minToques, dias }).range(de, de + PAGINA_ESTRITA - 1);
        if (error) throw error;
        const lote = (data ?? []) as { telefone: string }[];
        for (const r of lote) if (r.telefone) chaves.add(r.telefone);
        if (lote.length < PAGINA_ESTRITA) break;
        if (de >= TETO_ESTRITO) throw new Error('lista de mudos grande demais para ler inteira');
      }
    } else {
      const { data, error } = await supabase.rpc('wa_mudos', { min_toques: minToques, dias });
      if (error) throw error;
      for (const r of (data ?? []) as { telefone: string }[]) {
        if (r.telefone) chaves.add(r.telefone);
      }
    }
    logger.info('antiban', `${chaves.size} contatos mudos com ${minToques}+ toques`);
  } catch (err) {
    if (opts.estrito) throw new Error('leitura dos mudos falhou: ' + mensagemDoErro(err));
    logger.error('antiban', 'leitura de mudos falhou: ninguém será barrado nesta rodada', err);
  }
  return (phone: string): boolean => {
    const k = chaveContato(phone);
    return k !== null && chaves.has(k);
  };
}

/**
 * ── FORA DO PADRÃO: o bloqueio definitivo (02/10/2026) ──────────────────────
 *
 * Ordem do dono: "coloque alguma forma que esse cliente fique bloqueado, sem
 * condições nenhuma de nenhuma opção, não tem perigo dele aparecer de novo em
 * outras formas". E depois: "de um jeito que fique sem nenhuma etiqueta, apenas
 * FORA DO PADRÃO".
 *
 * É O MESMO LUGAR DO OPT-OUT, de propósito. Este arquivo já existe porque em
 * 31/08 havia TRÊS handlers de "para de me mandar" gravando cada um no seu canto,
 * e a pessoa continuava recebendo por todas as outras trilhas. Criar uma segunda
 * lista de bloqueio seria repetir exatamente esse erro. Então o bloqueio manual é
 * mais um `motivo` na MESMA tabela, com a MESMA chave estável.
 *
 * O QUE MUDA ENTRE OS MOTIVOS, e por isso `carregarBloqueados` existe separado:
 *   · `nunca_respondeu` é antiban: para de INSISTIR, mas o card segue vivo e um
 *     consultor pode ligar. Reciclar o card dele é legítimo.
 *   · `fora_do_padrao` é decisão de gente: o card não volta, não vira lembrete,
 *     não recebe nada, e nenhuma ficha nova se abre pra esse número.
 * Misturar os dois faria o reciclo parar de devolver 230 cards que a casa quer
 * trabalhar — medido no comentário do `carregarMudos` logo acima.
 */
export const MOTIVO_FORA_DO_PADRAO = 'fora_do_padrao';

/**
 * Predicado "este telefone foi bloqueado À MÃO".
 *
 * Só o bloqueio manual, nunca os outros motivos: ver o parágrafo acima.
 *
 * FAIL-OPEN com log, igual às irmãs deste arquivo. Dá pra argumentar que bloqueio
 * deveria ser fail-CLOSED ("na dúvida, não fale"), e eu escolhi o contrário de
 * propósito: um banco fora do ar faria TODA a régua parar de trabalhar todo mundo,
 * e um dia inteiro de agenda parada custa mais que um toque a mais em quem pediu
 * pra parar. O log é o que torna isso recuperável; sem ele seria mistério.
 */
export async function carregarBloqueados(opts: LeituraEstrita = {}): Promise<(phone: string) => boolean> {
  const chaves = new Set<string>();
  try {
    if (opts.estrito) {
      for (const phone of await lerSupressaoInteira(MOTIVO_FORA_DO_PADRAO)) { const k = chaveContato(phone); if (k) chaves.add(k); }
    } else {
      const { data, error } = await supabase
        .from('whatsapp_suppression')
        .select('phone')
        .eq('motivo', MOTIVO_FORA_DO_PADRAO);
      if (error) throw error;
      for (const r of data ?? []) {
        const k = chaveContato((r as { phone: string }).phone);
        if (k) chaves.add(k);
      }
    }
  } catch (err) {
    if (opts.estrito) throw new Error('leitura dos bloqueados falhou: ' + mensagemDoErro(err));
    logger.error('silenciar',
      'leitura dos bloqueados falhou: NINGUEM sera bloqueado nesta rodada', err);
  }
  return (phone: string): boolean => {
    const k = chaveContato(phone);
    return k !== null && chaves.has(k);
  };
}

/** UM telefone está bloqueado? Consulta de uma linha, pra quem vai criar UMA
 *  ficha e não está num laço — a LP, a indicação, o convite.
 *
 *  FAIL-OPEN, igual às irmãs: banco fora do ar não pode impedir um lead novo de
 *  entrar. Um card a mais de alguém bloqueado se apaga em dois cliques; uma LP
 *  que para de criar ficha enquanto o banco pisca custa leads que ninguém vê. */
export async function estaBloqueado(phone: string | null | undefined): Promise<boolean> {
  const k = chaveContato(phone);
  if (!k) return false;
  // FILTRA PELOS 8 ULTIMOS NO SERVIDOR, e so depois confere a chave inteira aqui.
  //
  // A primeira versao trazia a tabela TODA e peneirava em JS. Funciona com 10
  // bloqueados e vira varredura completa a cada lead que entra — e esta funcao
  // roda no caminho quente da LP, do ManyChat e do cron do Meta, que e de onde
  // vem 577 das 1.230 fichas.
  //
  // Os 8 ultimos digitos sao substring do telefone gravado em qualquer formato
  // (medido: 0 de 1.000 fichas tem caractere nao-digito). O DDD e conferido
  // depois, em JS, porque `chaveContato` e quem sabe a regra do nono digito.
  const ult8 = String(phone ?? '').replace(/\D/g, '').slice(-8);
  if (ult8.length < 8) return false;
  try {
    const { data, error } = await supabase
      .from('whatsapp_suppression').select('phone')
      .eq('motivo', MOTIVO_FORA_DO_PADRAO)
      .ilike('phone', `%${ult8}`);
    if (error) throw error;
    return (data ?? []).some((r) => chaveContato((r as { phone: string }).phone) === k);
  } catch (err) {
    logger.error('silenciar', 'checagem de bloqueio falhou: deixando passar', err);
    return false;
  }
}

/** As chaves bloqueadas, pra tela conferir sem um select por card.
 *
 *  A tela precisa da LISTA e não de um predicado porque o bloqueio é por
 *  TELEFONE e o card é por id: uma ficha NOVA do mesmo número também tem que
 *  aparecer bloqueada, e isso só funciona comparando a chave. */
export async function listarBloqueados(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_suppression')
      .select('phone')
      .eq('motivo', MOTIVO_FORA_DO_PADRAO);
    if (error) throw error;
    const chaves = new Set<string>();
    for (const r of data ?? []) {
      const k = chaveContato((r as { phone: string }).phone);
      if (k) chaves.add(k);
    }
    return [...chaves];
  } catch (err) {
    logger.error('silenciar', 'listagem dos bloqueados falhou', err);
    return [];
  }
}

/** Desfaz o bloqueio. Clique errado tem que ter volta: sem isto, marcar FORA DO
 *  PADRÃO por engano seria irreversível pela tela, e irreversível pela tela
 *  significa "me chama no WhatsApp pra arrumar no banco". */
export async function desbloquearContato(phone: string): Promise<void> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const k = chaveContato(digits);
  if (!k) return;
  try {
    // apaga por CHAVE, não pelo texto do telefone: a mesma pessoa pode ter sido
    // gravada com e sem o nono dígito, e apagar só a forma exata deixaria a outra
    // linha bloqueando em silêncio.
    const { data, error } = await supabase
      .from('whatsapp_suppression')
      .select('phone')
      .eq('motivo', MOTIVO_FORA_DO_PADRAO);
    if (error) throw error;
    const alvos = (data ?? [])
      .map((r) => (r as { phone: string }).phone)
      .filter((p) => chaveContato(p) === k);
    if (!alvos.length) return;
    const { error: e2 } = await supabase
      .from('whatsapp_suppression').delete().in('phone', alvos);
    if (e2) throw e2;
    logger.info('silenciar', `${digits} desbloqueado (${alvos.length} linha(s))`);
  } catch (err) {
    logger.error('silenciar', `falhou ao desbloquear ${digits}`, err);
  }
}
