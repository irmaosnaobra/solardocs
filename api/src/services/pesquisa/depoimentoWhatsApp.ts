// ─────────────────────────────────────────────────────────────────────────────
// A CARLA PEDE O DEPOIMENTO (04/11/2026). Robô `depoimento_pedido` (frio_p5). UMA bolha, sem link, por sendFrio, pela linha 5040,
// uma vez por pessoa, para sempre. Aprovado pelo chefe-antiban com estas condições, todas aqui:
//   · quem: pagante (pro/ilimitado, billing ativo) com 20 ou mais propostas solares em 30 dias E telefone de `users.whatsapp`
//     (NUNCA de sales.phone nem de company.whatsapp: não é o número que a pessoa deu à SolarDoc para ser chamada);
//   · quando: das 9h às 20h, de segunda a sábado, fora de feriado (a janela da Base); teto do frio com {robo} e espaçamento da linha;
//   · 1 envio por tick, e o tick PARA no primeiro erro; claim `depo_sent:<userId>` por INSERT, ANTES do envio. O `depo_sent:` conta como frio na linha,
//     então só fica para o que SAIU (enviado ou incerto). Todo desfecho sem mensagem (sem WhatsApp, conta que mudou, token ou posse que falhou, pausa
//     humana que calou) apaga o `depo_sent:` e deixa `depo_fora:<userId>`, prefixo FORA das listas da linha: não gasta vaga nem trava o espaçamento,
//     e os filtros leem os dois, então a pessoa não recebe o pedido de novo;
//   · fora: opt-out, supressão, bloqueio, mudo, pausa humana, quem já respondeu o formulário (`pesquisa_depoimento:<userId>`), quem recebeu
//     a pesquisa de satisfação nos últimos 30 dias e quem recebeu o e-mail de depoimento HOJE (`pesquisa_depo_email:<userId>`);
//   · a resposta é da Carla: no envio o robô abre a posse dela com `origem: 'pedido_depoimento'` (7 dias) e o link do formulário com o token
//     (`pesquisa_tok:` gravado como no e-mail). Por isso só envia com a Carla atendendo ESTE número, a IA no ar e a linha sem pausa;
//   · DEPOIMENTO_PEDIDO_OFF=1 desliga sem deploy.
// Telefone cru nunca vai para system_state ou log: a chave leva o id da conta.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { numeroTemWhatsApp, sendFrio } from '../agents/zapiClient';
import { dentroDaJanelaDaBaseLinha, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha } from '../agents/whatsapp/lineThrottle';
import { carregarPausas } from '../agents/whatsapp/pausaHumana';
import { motivosDaSupressao } from '../agents/whatsapp/silenciar';
import { hmacDe } from '../agentes5040/hmac';
import { carregarListasDeBarragem, type ListasDeBarragem } from '../agentes5040/contexto';
import { liberarChave, reservarChave } from '../agentes5040/cota';
import {
  ORIGEM_PEDIDO_DEPOIMENTO, PEDIDO_DEPOIMENTO_VALE_MS, agenteAtendeEste, assumirPosse, desfazerPosseNova, type ResultadoAssumir,
} from '../agentes5040/posse';
import { diaBRT } from '../agentes5040/relogio';
import { primeiroNome } from '../nexus/email';
import { lerCarlaAtendeTodos, lerIaParada, lerLinhaPausada } from '../solardoc/retomadaUsuariosEstado';
import { TELEFONE_DA_LINHA_5040, ehContaDeTeste, pagaHoje, telefoneDoUsuario, telefoneNoPadrao } from '../solardoc/retomadaUsuariosRegras';
import { chaveDoTelefone } from '../solardoc/quizSolardoc';
import { linkPesquisa } from '../../utils/mailerPesquisa';
import { lerChavesPorPrefixo, lerGrandesUsuarios } from './publico';
import { registrarToken } from './token';
import {
  PREFIXO_EMAIL_DEPO, PREFIXO_WA_DEPO, PREFIXO_WA_DEPO_FORA, ROBO_DEPOIMENTO_PEDIDO, recebeuSatisfacaoRecente, textoDepoimentoWhatsApp, type UsuarioPesq,
} from './regras';

const LOG = 'depoimento-pedido';
/** Quantas pessoas um tick avalia no máximo (cada uma gasta leituras e, no fim, um phone-exists). */
export const AVALIACOES_POR_TICK = 6;

export interface CandidatoDepo { u: UsuarioPesq; tel: string; chave: string; propostas: number }

export interface DepsDepo {
  desligado(): boolean;
  segredoOk(): boolean;
  janela(agora: Date): boolean;
  linhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'>;
  /** A Carla atende todos? E a IA está parada? Sem a Carla no ar, ninguém responderia à resposta. */
  carlaAtendeTodos(): Promise<boolean>;
  iaParada(agora: Date): Promise<boolean>;
  carlaAtende(tel: string): Promise<boolean>;
  tetoHorario(): Promise<boolean>;
  espacamento(): Promise<boolean>;
  /** Pagantes com 20+ propostas e telefone de users.whatsapp, do mais ativo ao menos. Erro LANÇA. */
  candidatos(agora: Date): Promise<CandidatoDepo[]>;
  /** Ids que já têm `depo_sent:` ou `depo_fora:`, ids que já responderam o formulário e ids com e-mail de depoimento HOJE. Erro LANÇA. */
  filtros(agora: Date): Promise<{ claimados: Set<string>; responderam: Set<string>; emailHoje: Set<string> }>;
  listas(): Promise<ListasDeBarragem>;
  supressao(tel: string): Promise<string[] | null>;
  podeFalarAgora(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  telefoneExiste(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  /** A conta de novo, logo antes do envio. 'sumiu' = não existe mais. null = não deu para ler. */
  contaAgora(userId: string): Promise<Pick<UsuarioPesq, 'plano' | 'billing_status' | 'plano_expira_em' | 'whatsapp_opt_out'> | 'sumiu' | null>;
  claim(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  /** Grava `pesquisa_tok:` e devolve o link do formulário do depoimento com o token. Erro LANÇA. */
  registrarLink(userId: string): Promise<string>;
  assumirPosse(tel: string, em: string, extra: Record<string, unknown>): Promise<ResultadoAssumir>;
  desfazerPosse(tel: string, em: string): Promise<boolean>;
  marcar(chave: string, valor: Record<string, unknown>): Promise<void>;
  /** Desfecho SEM mensagem: apaga o `depo_sent:<userId>` (se houver) e grava `depo_fora:<userId>` com o estado. Nunca lança. */
  descartar(userId: string, estado: string, agora: Date): Promise<void>;
  enviar(tel: string, texto: string): Promise<boolean>;
}

export interface RelatorioDepo {
  ok: boolean;
  motivo: string | null;
  enviou: boolean;
  avaliados: number;
  puladas: Record<string, number>;
}

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

export async function runDepoimentoPedidoTick(opts: { agora?: Date } = {}, deps?: DepsDepo): Promise<RelatorioDepo> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReaisDepo();
  const r: RelatorioDepo = { ok: true, motivo: null, enviou: false, avaliados: 0, puladas: {} };
  try {
    if (d.desligado()) return { ...r, motivo: 'desligado' };
    if (!d.segredoOk()) return { ...r, ok: false, motivo: 'sem_segredo_de_hmac' };
    if (!d.janela(agora)) return { ...r, motivo: 'fora_da_janela' };
    const pausa = await d.linhaPausada(agora);
    if (pausa !== 'nao') return { ...r, motivo: pausa === 'sim' ? 'linha_pausada' : 'leitura_da_pausa_falhou' };
    if (!(await d.carlaAtendeTodos())) return { ...r, motivo: 'carla_nao_atende_todos' };
    if (await d.iaParada(agora)) return { ...r, motivo: 'ia_parada' };
    if (!(await d.tetoHorario())) return { ...r, motivo: 'teto_da_linha' };
    if (!(await d.espacamento())) return { ...r, motivo: 'espacamento_da_linha' };

    const todos = await d.candidatos(agora);
    if (!todos.length) return { ...r, motivo: 'ninguem_na_fila' };
    const f = await d.filtros(agora);
    const fila = todos.filter(c => !f.claimados.has(c.u.id) && !f.responderam.has(c.u.id) && !f.emailHoje.has(c.u.id));
    if (!fila.length) return { ...r, motivo: 'ninguem_na_fila' };
    const listas = await d.listas();

    for (const c of fila) {
      if (r.avaliados >= AVALIACOES_POR_TICK) { soma(r.puladas, 'limite_por_tick'); break; }
      r.avaliados++;
      if (listas.silenciado(c.tel)) { soma(r.puladas, 'suprimido'); continue; }
      if (listas.bloqueado(c.tel)) { soma(r.puladas, 'bloqueado'); continue; }
      if (listas.mudo(c.tel)) { soma(r.puladas, 'mudo'); continue; }
      const sup = await d.supressao(c.tel);
      if (sup === null) { r.motivo = 'leitura_falhou'; break; }
      if (sup.length) { soma(r.puladas, 'suprimido'); continue; }
      const pode = await d.podeFalarAgora(c.tel);
      if (pode === 'erro') { r.motivo = 'leitura_falhou'; break; }
      if (pode === 'nao') { soma(r.puladas, 'humano_na_conversa'); continue; }

      const chave = `${PREFIXO_WA_DEPO}${c.u.id}`;
      if (!(await d.carlaAtende(c.tel))) { soma(r.puladas, 'carla_nao_atende'); continue; }
      const existe = await d.telefoneExiste(c.tel);
      if (existe === 'erro') { r.motivo = 'phone_exists_falhou'; break; }
      if (existe === 'nao') {
        // Sem WhatsApp: `depo_fora:` (nunca tenta de novo) e não conta como frio.
        await d.descartar(c.u.id, 'sem_whatsapp', agora);
        soma(r.puladas, 'sem_whatsapp');
        continue;
      }

      // As travas de novo, logo antes do claim: a avaliação pode ter atravessado as 20h ou gasto o teto.
      const agora2 = opts.agora ?? new Date();
      if (!d.janela(agora2)) { r.motivo = 'fora_da_janela'; break; }
      if (!(await d.tetoHorario()) || !(await d.espacamento())) { r.motivo = 'teto_da_linha'; break; }

      // O claim por INSERT, ANTES do envio.
      const tomou = await d.claim(chave, { user_id: c.u.id, estado: 'reservado' }, agora2);
      if (tomou === 'ja') { soma(r.puladas, 'ja_reivindicado'); continue; }
      if (tomou === 'erro') { r.motivo = 'erro_no_claim'; break; }

      // A conta de novo: pediu para parar ou passou a não pagar desde a leitura? Vira `depo_fora:` (não insiste) e ninguém é chamado.
      const conta = await d.contaAgora(c.u.id);
      if (conta === null || conta === 'sumiu' || conta.whatsapp_opt_out === true || !pagaHoje(conta, agora2.getTime())) {
        await d.descartar(c.u.id, 'abortou', agora2);
        soma(r.puladas, 'conta_mudou');
        continue;
      }

      // O link do formulário (com o token registrado) e a posse da Carla ANTES do envio: quem responde logo não pode cair sem dona.
      const em = agora2.toISOString();
      let link: string;
      try { link = await d.registrarLink(c.u.id); } catch {
        await d.descartar(c.u.id, 'abortou', agora2);
        r.motivo = 'token_falhou';
        break;
      }
      const posse = await d.assumirPosse(c.tel, em, {
        origem: ORIGEM_PEDIDO_DEPOIMENTO,
        pedido_depoimento: { user_id: c.u.id, link, em, ate: new Date(agora2.getTime() + PEDIDO_DEPOIMENTO_VALE_MS).toISOString() },
      });
      if (posse !== 'assumida') {
        await d.descartar(c.u.id, 'abortou', agora2);
        if (posse === 'ja_tinha_dona') { soma(r.puladas, 'posse_ocupada'); continue; }
        r.motivo = 'posse_falhou';
        break;
      }

      const texto = textoDepoimentoWhatsApp(primeiroNome(c.u.nome));
      let saiu = false;
      try {
        saiu = await d.enviar(c.tel, texto);
      } catch (e) {
        // Pode ter saído: o claim fica como incerto e a posse também (a resposta tem dona). O tick PARA.
        await d.marcar(chave, { user_id: c.u.id, estado: 'incerto', em: agora2.toISOString() });
        logger.error(LOG, `envio falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
        r.ok = false;
        r.motivo = 'envio_falhou';
        break;
      }
      if (!saiu) {
        // A pausa humana calou: nada saiu. O `depo_sent:` vira `depo_fora:` (1 por pessoa), a posse volta e o tick para.
        await d.desfazerPosse(c.tel, em);
        await d.descartar(c.u.id, 'nao_saiu', agora2);
        r.motivo = 'envio_nao_saiu';
        break;
      }
      await d.marcar(chave, { user_id: c.u.id, estado: 'enviado', em: agora2.toISOString() });
      r.enviou = true;
      break;
    }
    return r;
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    return { ...r, ok: false, motivo: 'a_rodada_falhou' };
  }
}

export function depsReaisDepo(): DepsDepo {
  return {
    desligado: () => process.env.DEPOIMENTO_PEDIDO_OFF === '1',
    segredoOk: () => !!hmacDe('depoimento-pedido'),
    janela: (agora) => dentroDaJanelaDaBaseLinha(agora),
    linhaPausada: (agora) => lerLinhaPausada(agora),
    carlaAtendeTodos: () => lerCarlaAtendeTodos(),
    iaParada: (agora) => lerIaParada(agora),
    carlaAtende: (tel) => agenteAtendeEste('carla', tel),
    tetoHorario: () => dentroDoTetoHorarioLinha({ robo: ROBO_DEPOIMENTO_PEDIDO }),
    espacamento: () => respeitaEspacamentoLinha(),
    async candidatos(agora) {
      const agoraMs = agora.getTime();
      const out: CandidatoDepo[] = [];
      for (const g of await lerGrandesUsuarios(agora)) {
        const u = g.u;
        if (u.whatsapp_opt_out === true || ehContaDeTeste(u) || recebeuSatisfacaoRecente(u, agoraMs)) continue;
        const t = telefoneDoUsuario(u);
        if (!t || !telefoneNoPadrao(u, t.chave)) continue;
        if (t.chave === chaveDoTelefone(TELEFONE_DA_LINHA_5040)) continue;
        out.push({ u, tel: t.tel, chave: t.chave, propostas: g.propostas });
      }
      return out;
    },
    async filtros(agora) {
      const [claims, fora, resp, emails] = await Promise.all([
        lerChavesPorPrefixo(PREFIXO_WA_DEPO), lerChavesPorPrefixo(PREFIXO_WA_DEPO_FORA), lerChavesPorPrefixo('pesquisa_depoimento:'), lerChavesPorPrefixo(PREFIXO_EMAIL_DEPO),
      ]);
      const hoje = diaBRT(agora);
      const emailHoje = new Set<string>();
      for (const [id, v] of emails) {
        const em = typeof v.value?.em === 'string' ? v.value.em : v.updated_at;
        if (em && diaBRT(em) === hoje) emailHoje.add(id);
      }
      return { claimados: new Set([...claims.keys(), ...fora.keys()]), responderam: new Set(resp.keys()), emailHoje };
    },
    listas: () => carregarListasDeBarragem(),
    async supressao(tel) { try { return await motivosDaSupressao(tel); } catch { return null; } },
    async podeFalarAgora(tel) {
      try { return (await carregarPausas({ estrito: true }))(tel).pode ? 'sim' : 'nao'; } catch { return 'erro'; }
    },
    telefoneExiste: (tel) => numeroTemWhatsApp(tel, 'io'),
    async contaAgora(userId) {
      try {
        const { data, error } = await supabase.from('users').select('plano, billing_status, plano_expira_em, whatsapp_opt_out').eq('id', userId).maybeSingle();
        if (error) return null;
        return data ? (data as Pick<UsuarioPesq, 'plano' | 'billing_status' | 'plano_expira_em' | 'whatsapp_opt_out'>) : 'sumiu';
      } catch { return null; }
    },
    claim: async (chave, valor, agora) => {
      const v = await reservarChave(chave, valor, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    registrarLink: async (userId) => linkPesquisa('depoimento', await registrarToken(userId, 'depoimento')),
    assumirPosse: (tel, em, extra) => assumirPosse(tel, 'carla', null, em, extra),
    desfazerPosse: (tel, em) => desfazerPosseNova(tel, 'carla', em),
    async marcar(chave, valor) {
      try { await supabase.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave); } catch { /* o claim já vale */ }
    },
    async descartar(userId, estado, agora) {
      const iso = agora.toISOString();
      try {
        await supabase.from('system_state').upsert({ key: `${PREFIXO_WA_DEPO_FORA}${userId}`, value: { user_id: userId, estado, em: iso }, updated_at: iso }, { onConflict: 'key' });
        await liberarChave(`${PREFIXO_WA_DEPO}${userId}`);
      } catch (e) { logger.error(LOG, `descartar falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
    enviar: async (tel, texto) => (await sendFrio(tel, [texto], 'io')) === true,
  };
}
