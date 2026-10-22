// ─────────────────────────────────────────────────────────────────────────────
// A RETOMADA FRIA DA BASE DAS AGENTES DA 5040 (B4b). Quarto arquivo da pasta agentes5040/ que importa o zapiClient (os
// outros: fichaEnvio.ts, vivoEnvio.ts e agendaEnvio.ts). Robô `base_retomada_5040` (frio_p5, 1 bolha de até 160 caracteres,
// sendFrio, respeita pausa humana, carimbo `ag5040_retomada:<hmac>:<n>`). As regras puras moram em baseRegras.ts.
//
// Uma rodada a cada 10 minutos (cron próprio) e UM envio por rodada, nesta ordem EXATA (a primeira que barrar encerra e
// nada foi reservado, carimbado nem enviado antes dela):
//   1. janela de 9h às 20h, segunda a sábado, fixa (e a diurna da linha);
//   2. linha pausada por erros seguidos (ag5040_linha_pausa);
//   3. dentroDoTetoHorarioLinha() (6/h e 30/24 h de frio, com a reserva do transacional);
//   4. respeitaEspacamentoLinha() (10 a 15 min do último envio da linha);
//   5. checagem PRÓPRIA de 2 min contra o último ag5040_sent: (a resposta ao vivo passa na frente);
//   6. a vez da rodada, por insert em ag5040_base_vez:<faixa de 10 min> (23505 = outra chamada já tem a vez);
//   7. o alvo: posse viva de dona ligada e no escopo, sem card do produto, sem régua, sem outro robô, última mensagem
//      NOSSA (da própria agente) e lead calado há 3 h ou mais, 2 retomadas no máximo (ver baseRegras.ts);
//   8. a IA da dona (pensarTurno no modo retomada, SEM ação: só continuar com 1 bolha, ou calar = não retomar), com a trava;
//   9. relê a última mensagem da conversa (qualquer mensagem nova aborta);
//  10. espaçamento de novo (e os 2 min);
//  11. pausa humana e supressão do telefone, estritas, de novo (o sendFrio devolve calado quando há humano: aqui não);
//  12. o claim do carimbo, por insert (23505 = já saiu, nada sai);
//  13. sendFrio. Recusa certa (cooldown, credencial, destino) = apaga o claim e para; timeout, 5xx e falha genérica = o claim FICA
//      (pode ter saído) e a tentativa vira permanente; saiu = lead_data.base.retomadas + 1 (o envio real).
// A IA é chamada no máximo UMA vez por rodada. Tentativa que não termina em envio fica marcada em lead_data.base.tentativa,
// presa ao id da última mensagem: sem mensagem nova a mesma conversa não gasta o modelo de novo (permanente) ou espera
// 30 min (transitória). O dry (?dry=1) lista toda posse avaliada com o motivo e NÃO reserva, não chama o modelo, não envia
// e não grava nada.
//
// Telefone cru nunca vai para system_state, log ou relatório: só hmac, hmac8 e ids. O número de ENVIO sai de wa_mensagens
// (ou do mapa de LID), nunca da chave da posse (ela perdeu o nono dígito); LID sem mapa = a pessoa não recebe nada.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { sendFrio } from '../agents/zapiClient';
import {
  dentroDaJanelaDiurna, dentroDoTetoHorarioLinha, prefixosDaLinha, PREFIXOS_AGENDA, respeitaEspacamentoLinha,
} from '../agents/whatsapp/lineThrottle';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import { chaveContato, motivosDaSupressao } from '../agents/whatsapp/silenciar';
import {
  CHAVE_FILA_BASE, LIMITES_BASE, PREFIXO_RETOMADA, PREFIXO_VEZ_BASE, chaveRetomada, chaveVezBase, decidirBolhaDaRetomada,
  dentroDaJanelaBase, juntarBase, lerBaseDaPosse, patchDepoisDaRetomada, resumirConversa, triagemDaConversa, triagemDaPosse,
  triagemDoContexto, type BaseDaPosse, type CarimboProprio, type DecisaoDaBolha, type FatosDoContexto, type MotivoBase,
  type ResumoConversa,
} from './baseRegras';
import { lerMidiaCache } from './armazem';
import { carregarListasDeBarragem, lerCards, lerConversa, lerFatosPorteiro, montarContexto, type ConversaLida, type ListasDeBarragem } from './contexto';
import { clienteComCota, disjuntorAberto, liberarChave, reservarChave, type EstadoCota } from './cota';
import { violacaoDaBolha } from './helenaEp';
import { erroProvaQueNaoSaiu } from './fichaEnvio';
import { hmacDe } from './hmac';
import type { ClienteIA } from './ia';
import type { DonaViva } from './interruptores';
import { agenteAtendeEste, atualizarPosse, lerPosse } from './posse';
import { donasDaRodadaLigadas } from './posseLeitura';
import { falhaDeInfra, juntarDados, pensarTurno } from './turno';
import { lerTurnos } from './armazem';
import { codigoDoErroDeEnvio, erroEhDoDestino, CHAVE_LINHA_ERROS, CHAVE_LINHA_PAUSA } from './vivoEnvio';
import type { CardResumo, MsgConversa, Persona } from './tipos';

const LOG = 'base-5040';

export type DonaBase = 'duda' | 'helena';
const DONAS_DA_BASE: readonly DonaBase[] = ['duda', 'helena'];

/** O que a rodada precisa de uma posse (lead_data inteiro, para juntar o `base` sem apagar nada). */
export interface PosseBase { chave: string; dona: DonaBase; lead_data: Record<string, unknown>; updated_at: string }

export interface AlvoBase {
  posse: PosseBase;
  base: BaseDaPosse;
  hmac: string;
  n: number;
  via: boolean;
  resumo: ResumoConversa;
  msgs: MsgConversa[];
  telefone: string;
}

export type ResultadoIA =
  | { tipo: 'texto'; bolha: string }
  | { tipo: 'nao_retomar'; motivo: string }
  | { tipo: 'barrada'; motivo: string }
  | { tipo: 'infra'; motivo: string }
  | { tipo: 'parou'; motivo: string };

export interface DecisaoBase { hmac8: string; dona: string; resultado: string; motivo: string | null; n?: number }

export interface RelatorioBase {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  /** Por que a rodada parou antes do alvo (ou null). No dry o gate que falhou aparece aqui e a leitura segue. */
  motivo: string | null;
  avaliadas: number;
  elegiveis: number;
  cortou: boolean;
  chamadasIA: number;
  enviou: boolean;
  puladas: Record<string, number>;
  decisoes: DecisaoBase[];
  /** Só no dry: quantas posses a leitura trouxe. */
  posses?: number;
}

export interface OpcoesBase { dry?: boolean; agora?: Date; cliente?: ClienteIA }

/** Tudo que a rodada lê ou escreve fora dela. Os testes passam um falso; a rodada de verdade usa depsReais(). */
export interface DepsBase {
  donasLigadas(): Promise<DonaBase[]>;
  segredoOk(): boolean;
  janelaDaLinha(agora: Date): boolean;
  linhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'>;
  tetoHorario(): Promise<boolean>;
  espacamento(): Promise<boolean>;
  /** ms do último ag5040_sent: (null = nenhum; 'erro' = não deu para ler). */
  ultimaRespostaViva(): Promise<number | null | 'erro'>;
  tomarVez(agora: Date): Promise<'tomada' | 'ocupada' | 'erro'>;
  listarPosses(agora: Date, donas: readonly DonaBase[]): Promise<PosseBase[] | null>;
  escopo(dona: DonaBase, chave: string): Promise<boolean>;
  listas(): Promise<ListasDeBarragem>;
  conversa(chave: string): Promise<ConversaLida>;
  cartoes(chave: string): Promise<CardResumo[] | null>;
  fatos(chave: string, msgs: readonly MsgConversa[], listas: ListasDeBarragem, agora: Date): Promise<FatosPorteiroBase>;
  carimbos(hmac: string, chave: string, lead: { id: number; momment: string }, agora: Date): Promise<CarimbosLidos | null>;
  telefone(chave: string, waIdDoLead: number): Promise<string | null>;
  pensar(alvo: AlvoBase, agora: Date): Promise<ResultadoIA & { chamadas: number }>;
  ultimoId(chave: string): Promise<number | null>;
  podeFalarAgora(telefone: string): Promise<boolean>;
  claim(chave: string, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  apagarClaim(chave: string): Promise<void>;
  enviar(telefone: string, bolha: string): Promise<void>;
  erroDeLinha(err: unknown, agora: Date): Promise<void>;
  envioOk(agora: Date): Promise<void>;
  gravarBase(posse: PosseBase, patch: Record<string, unknown>): Promise<boolean>;
  gravarFila(vazia: boolean, agora: Date): Promise<void>;
  limparVezes(agora: Date): Promise<void>;
}

export interface FatosPorteiroBase {
  leituraOk: boolean; humanoNaConversa: boolean; naoIncomodar: boolean; bloqueado: boolean; mudo: boolean;
  outroRoboAtivo: boolean; ehClienteSolarDoc: boolean;
}

export interface CarimbosLidos { respostasDaAgenteAposLead: number; retomadas: CarimboProprio[]; outroRobo24h: boolean }

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);
const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
const ehEletroposto = (c: Pick<CardResumo, 'created_by'>): boolean => String(c.created_by ?? '').toLowerCase().includes('eletroposto');

// ── a rodada ─────────────────────────────────────────────────────────────────

const vazioR = (dry: boolean, extra: Partial<RelatorioBase> = {}): RelatorioBase => ({
  ok: true, ligado: true, dry, motivo: null, avaliadas: 0, elegiveis: 0, cortou: false, chamadasIA: 0, enviou: false,
  puladas: {}, decisoes: [], ...extra,
});

export async function runBaseTick(opts: OpcoesBase = {}, deps?: DepsBase): Promise<RelatorioBase> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReais(opts);
  const r = vazioR(dry);
  try {
    // 0. nada ligado: sai sem ler nada além do interruptor (cache de 60 s)
    const donas = await d.donasLigadas();
    if (!donas.length) return { ...r, ligado: false, motivo: 'nenhuma_dona_ligada' };
    if (!d.segredoOk()) return { ...r, ok: false, motivo: 'sem_segredo_de_hmac' };

    // 1 a 5. os portões, na ordem. No dry o primeiro que falhar aparece em `motivo` e a leitura segue (a sonda lista os alvos).
    let gate: string | null = null;
    const barra = (m: string): boolean => { gate ??= m; return !dry; };
    if (!dentroDaJanelaBase(agora) || !d.janelaDaLinha(agora)) { if (barra('fora_da_janela')) return { ...r, motivo: gate }; }
    if (!gate) {
      const pausa = await d.linhaPausada(agora);
      if (pausa !== 'nao' && barra(pausa === 'sim' ? 'linha_pausada' : 'leitura_da_pausa_falhou')) return { ...r, motivo: gate };
    }
    if (!gate && !(await d.tetoHorario()) && barra('teto_da_linha')) return { ...r, motivo: gate };
    if (!gate && !(await d.espacamento()) && barra('espacamento_da_linha')) return { ...r, motivo: gate };
    if (!gate) {
      const ult = await d.ultimaRespostaViva();
      if (ult === 'erro') { if (barra('leitura_da_resposta_viva_falhou')) return { ...r, motivo: gate }; }
      else if (ult !== null && agora.getTime() - ult < LIMITES_BASE.respostaVivaMs && barra('resposta_viva_recente')) return { ...r, motivo: gate };
    }
    if (gate) r.motivo = gate;

    // 6. a vez da rodada (o dry não reserva)
    if (!dry) {
      const vez = await d.tomarVez(agora);
      if (vez !== 'tomada') return { ...r, motivo: vez === 'ocupada' ? 'vez_ocupada' : 'vez_nao_reservada' };
    }

    // 7. o alvo
    const posses = await d.listarPosses(agora, donas);
    if (!posses) return { ...r, ok: false, motivo: 'leitura_das_posses_falhou' };
    if (dry) r.posses = posses.length;
    let listas: ListasDeBarragem;
    try { listas = await d.listas(); } catch (e) { logger.error(LOG, `listas de barragem falharam (${codigoDe(e)})`); return { ...r, ok: false, motivo: 'listas_falharam' }; }

    let alvo: AlvoBase | null = null;
    const agoraMs = agora.getTime();
    for (const p of posses) {
      const hmac = hmacDe(p.chave);
      if (!hmac) { soma(r.puladas, 'sem_hmac'); continue; }
      const hmac8 = hmac.slice(0, 8);
      const nota = (resultado: string, motivo: string | null, n?: number): void => {
        r.decisoes.push({ hmac8, dona: p.dona, resultado, motivo, ...(n !== undefined ? { n } : {}) });
        if (motivo) soma(r.puladas, motivo);
      };
      if (!donas.includes(p.dona)) { nota('pulou', 'dona_desligada'); continue; }
      const base = lerBaseDaPosse(p.lead_data);
      const t1 = triagemDaPosse(base, agoraMs);
      if (!t1.ok) { nota('pulou', t1.motivo); continue; }
      if (!(await d.escopo(p.dona, p.chave))) { nota('pulou', 'fora_do_escopo'); continue; }
      if (r.avaliadas >= LIMITES_BASE.avaliacoesPorRodada) { r.cortou = true; break; }
      r.avaliadas++;

      const conv = await d.conversa(p.chave);
      if (!conv.completa || !/^\d{10}$/.test(p.chave)) { nota('pulou', 'conversa_incompleta'); continue; }
      const resumo = resumirConversa(conv.msgs);
      const t2 = triagemDaConversa(resumo, base, t1.viaEstacionado, agoraMs);
      if (!t2.ok) { nota('pulou', t2.motivo); continue; }
      const lead = resumo.lastLead!;

      const cartoes = await d.cartoes(p.chave);
      const fp = await d.fatos(p.chave, conv.msgs, listas, agora);
      const car = await d.carimbos(hmac, p.chave, lead, agora);
      if (!cartoes || !car) { nota('pulou', 'leitura_falhou'); continue; }
      const telefone = await d.telefone(p.chave, lead.id);
      const doProduto = p.dona === 'helena';
      const fatos: FatosDoContexto = {
        cardDoProduto: cartoes.some(c => ehEletroposto(c) === doProduto),
        cardAtivoDoOutroProduto: cartoes.some(c => ehEletroposto(c) !== doProduto && String(c.status ?? '').trim().toLowerCase() !== 'cancelado'),
        leituraOk: fp.leituraOk, humanoNaConversa: fp.humanoNaConversa, silenciado: fp.naoIncomodar, bloqueado: fp.bloqueado,
        mudo: fp.mudo, outroRoboAtivo: fp.outroRoboAtivo, ehClienteSolarDoc: fp.ehClienteSolarDoc,
        respostasDaAgenteAposLead: car.respostasDaAgenteAposLead, retomadasCarimbadas: car.retomadas,
        carimboDeOutroRobo24h: car.outroRobo24h, telefoneResolvido: !!telefone,
      };
      const v = triagemDoContexto(fatos, resumo, base, t1.viaEstacionado, agoraMs);
      if (!v.ok) { nota('pulou', v.motivo); continue; }

      r.elegiveis++;
      nota(dry ? 'sairia' : 'alvo', null, v.n);
      if (!alvo) alvo = { posse: p, base, hmac, n: v.n, via: t1.viaEstacionado, resumo, msgs: conv.msgs, telefone: telefone! };
      if (!dry) break;
    }

    // A fila da Base (a B4c lê): vazia = nenhum alvo ELEGÍVEL. Leitura cortada sem alvo não afirma nada.
    if (!dry) {
      if (alvo) await d.gravarFila(false, agora);
      else if (!r.cortou) await d.gravarFila(true, agora);
      await d.limparVezes(agora);
    }
    if (!alvo || dry) return r;

    // 8. a IA (uma chamada por rodada). A tentativa que não envia fica marcada na posse, presa à última mensagem.
    const ultimoId = alvo.resumo.last!.id;
    const marcar = async (motivo: string, permanente: boolean): Promise<void> => {
      await d.gravarBase(alvo!.posse, { tentativa: { wa_id: ultimoId, em: agora.toISOString(), motivo, permanente } });
    };
    const ia = await d.pensar(alvo, agora);
    r.chamadasIA = ia.chamadas;
    const hmac8 = alvo.hmac.slice(0, 8);
    const fim = (resultado: string, motivo: string | null): RelatorioBase => {
      r.decisoes.push({ hmac8, dona: alvo!.posse.dona, resultado, motivo, n: alvo!.n });
      if (motivo) soma(r.puladas, motivo);
      return r;
    };
    if (ia.tipo === 'parou') return fim('ia_parou', ia.motivo);
    if (ia.tipo === 'infra') { await marcar(`ia_${ia.motivo}`, false); return fim('ia_indisponivel', ia.motivo); }
    if (ia.tipo === 'nao_retomar') { await marcar(`ia_${ia.motivo}`, true); return fim('ia_nao_retomou', ia.motivo); }
    if (ia.tipo === 'barrada') { await marcar(`barrada_${ia.motivo}`, true); return fim('bolha_barrada', ia.motivo); }
    const bolha = ia.bolha;

    // 9. relê a última mensagem: qualquer mensagem nova (o lead escrevendo, a equipe, outro robô) aborta
    const relido = await d.ultimoId(alvo.posse.chave);
    if (relido === null) { await marcar('releitura_falhou', false); return fim('abortou', 'releitura_falhou'); }
    if (relido !== ultimoId) return fim('abortou', 'mensagem_nova_depois_da_ia');

    // 10. o espaçamento de novo (e os 2 min da resposta ao vivo)
    const agora2 = opts.agora ?? new Date();
    if (!(await d.espacamento())) { await marcar('espacamento_depois_da_ia', false); return fim('abortou', 'espacamento_depois_da_ia'); }
    const ult2 = await d.ultimaRespostaViva();
    if (ult2 === 'erro' || (ult2 !== null && agora2.getTime() - ult2 < LIMITES_BASE.respostaVivaMs)) {
      await marcar('resposta_viva_depois_da_ia', false);
      return fim('abortou', 'resposta_viva_depois_da_ia');
    }

    // 11. pausa humana e supressão, estritas, antes do claim (o sendFrio devolve calado quando há humano)
    if (!(await d.podeFalarAgora(alvo.telefone))) { await marcar('humano_ou_supressao', false); return fim('abortou', 'humano_ou_supressao'); }

    // 12. o claim do carimbo. Recusa ('ja' ou 'erro') marca a tentativa (transitória): sem isto a IA seria chamada de novo a cada 10 min.
    const chave = chaveRetomada(alvo.hmac, alvo.n);
    const claim = await d.claim(chave, agora2);
    if (claim === 'ja') { await marcar('claim_ja_existe', false); return fim('abortou', 'ja_reivindicado'); }
    if (claim === 'erro') { await marcar('claim_erro', false); return fim('abortou', 'erro_no_claim'); }

    // 13. o envio. O carimbo só é apagado quando a recusa é CERTA antes de sair (cooldown da linha, credenciais, erro de destino:
    // 4xx do Z-API). Timeout, 5xx e falha genérica podem ter saído: o carimbo FICA (apagar reenviaria a mesma fala), a tentativa
    // vira permanente e o erro conta para a pausa da linha, como o vivoEnvio faz.
    try {
      await d.enviar(alvo.telefone, bolha);
    } catch (err) {
      const cod = codigoDoErroDeEnvio(err);
      logger.error(LOG, `retomada ${hmac8}:${alvo.n} falhou (${cod})`);
      const destino = erroEhDoDestino(err);
      if (erroProvaQueNaoSaiu(err) || destino) {
        await d.apagarClaim(chave);
        if (!destino) await d.erroDeLinha(err, agora2);
        // Destino ruim (número inválido): nunca tenta de novo a cada 30 min; só com mensagem nova. Cooldown/credencial passa.
        await marcar(`envio_${cod}`, destino);
      } else {
        await d.erroDeLinha(err, agora2);
        await marcar(`envio_${cod}`, true);
      }
      return fim('envio_falhou', cod);
    }
    await d.envioOk(agora2);
    const gravou = await d.gravarBase(alvo.posse, patchDepoisDaRetomada(alvo.base, alvo.n, alvo.via, agora2));
    if (!gravou) logger.error(LOG, `retomada ${hmac8}:${alvo.n} enviada, mas a posse não anotou (o carimbo vale)`);
    r.enviou = true;
    return fim('enviada', null);
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${codigoDe(e)})`);
    return { ...r, ok: false, motivo: 'a_rodada_falhou' };
  }
}

// ── as dependências de verdade ───────────────────────────────────────────────

const TENTATIVAS_LINHA = 2;
const PAGINA = 1000;
const MAX_PAGINAS = 5;

/** Os prefixos de OUTROS robôs que amarram o carimbo ao telefone na chave (a Base nunca vê o próprio nem os do ag5040_). */
function prefixosDeOutrosRobos(): string[] {
  return [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA])].filter(p => !p.startsWith('ag5040_'));
}

export function depsReais(opts: OpcoesBase = {}): DepsBase {
  const inicio = Date.now();
  let estado: EstadoCota | null = null;
  let cliente: ClienteIA | null = null;
  const clienteDaRodada = (agora: Date): ClienteIA => {
    if (cliente) return cliente;
    let base: ClienteIA | null = null;
    const lazy: ClienteIA = { messages: { create: (b: any, o?: any) => (base ??= opts.cliente ?? (novoAnthropic() as unknown as ClienteIA)).messages.create(b, o) } };
    const c = clienteComCota('resposta', () => new Date(), lazy, inicio + 90_000);
    estado = c.estado;
    cliente = c.cliente;
    void agora;
    return cliente;
  };

  return {
    async donasLigadas() {
      return (await donasDaRodadaLigadas()).filter((x): x is DonaBase => (DONAS_DA_BASE as readonly string[]).includes(x));
    },
    segredoOk: () => !!hmacDe('base-5040'),
    janelaDaLinha: (agora) => dentroDaJanelaDiurna(agora),

    async linhaPausada(agora) {
      const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
      if (error) return 'erro';
      const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
      return Number.isFinite(ate) && ate > agora.getTime() ? 'sim' : 'nao';
    },
    tetoHorario: () => dentroDoTetoHorarioLinha(),
    espacamento: () => respeitaEspacamentoLinha(),

    async ultimaRespostaViva() {
      const { data, error } = await supabase.from('system_state').select('updated_at').like('key', 'ag5040_sent:%')
        .order('updated_at', { ascending: false }).limit(1);
      if (error) return 'erro';
      const t = Date.parse(String(((data ?? []) as Array<{ updated_at?: string }>)[0]?.updated_at ?? ''));
      return Number.isFinite(t) ? t : null;
    },

    async tomarVez(agora) {
      const v = await reservarChave(chaveVezBase(agora), {}, agora);
      return v === 'reservada' ? 'tomada' : v === 'ja_existe' ? 'ocupada' : 'erro';
    },

    async listarPosses(agora, donas) {
      try {
        const desde = new Date(agora.getTime() - LIMITES_BASE.posseJanelaMs).toISOString();
        const porChave = new Map<string, PosseBase>();
        const ler = async (comEstacionado: boolean): Promise<void> => {
          for (let de = 0; de < PAGINA * MAX_PAGINAS; de += PAGINA) {
            let q = supabase.from('whatsapp_sessions').select('phone, lead_data, updated_at')
              .eq('tipo', 'ag5040').eq('lead_data->>estado', 'viva').in('lead_data->>dona', [...donas]);
            q = comEstacionado ? q.not('lead_data->base->>estacionado_ate', 'is', null) : q.gte('updated_at', desde);
            const { data, error } = await q.order('updated_at', { ascending: true }).range(de, de + PAGINA - 1);
            if (error) throw new Error(`leitura das posses falhou (${codigoDe(error)})`);
            const lote = (data ?? []) as Array<{ phone: string; lead_data: Record<string, unknown> | null; updated_at: string }>;
            for (const l of lote) {
              const dona = String(l.lead_data?.dona ?? '');
              if (!l.lead_data || !(DONAS_DA_BASE as readonly string[]).includes(dona) || !l.phone) continue;
              porChave.set(l.phone, { chave: l.phone, dona: dona as DonaBase, lead_data: l.lead_data, updated_at: String(l.updated_at ?? '') });
            }
            if (lote.length < PAGINA) return;
          }
        };
        await ler(false);
        await ler(true);
        return [...porChave.values()].sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
      } catch (e) {
        logger.error(LOG, String((e as Error)?.message ?? 'leitura das posses falhou').slice(0, 120));
        return null;
      }
    },

    escopo: (dona, chave) => agenteAtendeEste(dona as DonaViva, chave),
    listas: () => carregarListasDeBarragem(),
    conversa: (chave) => lerConversa(chave),

    async cartoes(chave) {
      try { return await lerCards(chave); } catch (e) { logger.error(LOG, `leitura dos cartões falhou (${codigoDe(e)})`); return null; }
    },

    async fatos(chave, msgs, listas, agora) {
      const f = await lerFatosPorteiro(chave, msgs, null, { completa: true, listas, agora });
      return {
        leituraOk: f.leituraOk, humanoNaConversa: f.humanoNaConversa, naoIncomodar: f.naoIncomodar, bloqueado: f.bloqueado,
        mudo: f.mudo, outroRoboAtivo: f.outroRoboAtivo, ehClienteSolarDoc: f.ehClienteSolarDoc,
      };
    },

    async carimbos(hmac, chave, lead, agora) {
      try {
        const resp = await supabase.from('system_state').select('key').in('key', [`ag5040_sent:${lead.id}:1`, `ag5040_sent:${lead.id}:2`]);
        if (resp.error) throw new Error('resp');
        const ret = await supabase.from('system_state').select('key, updated_at').like('key', `${PREFIXO_RETOMADA}${hmac}:%`);
        if (ret.error) throw new Error('ret');
        const retomadas: CarimboProprio[] = [];
        for (const l of (ret.data ?? []) as Array<{ key: string; updated_at: string }>) {
          const n = Number(l.key.split(':').pop());
          if (Number.isInteger(n) && n > 0) retomadas.push({ n, em: String(l.updated_at ?? '') });
        }
        const cauda = chave.slice(-8);
        const desde = new Date(agora.getTime() - LIMITES_BASE.carimbosOutrosMs).toISOString();
        const filtro = prefixosDeOutrosRobos().map(p => `key.like.${p}%${cauda}%`).join(',');
        const outros = await supabase.from('system_state').select('key').or(filtro).gte('updated_at', desde).limit(1);
        if (outros.error) throw new Error('outros');
        return {
          respostasDaAgenteAposLead: ((resp.data ?? []) as unknown[]).length,
          retomadas: retomadas.sort((a, b) => a.n - b.n),
          outroRobo24h: ((outros.data ?? []) as unknown[]).length > 0,
        };
      } catch (e) {
        logger.error(LOG, `leitura dos carimbos falhou (${String((e as Error)?.message ?? '').slice(0, 20)})`);
        return null;
      }
    },

    /** O número de ENVIO: o da própria fala do lead (wa_mensagens) ou, se for LID, o do mapa. null = não dá para falar. */
    async telefone(chave, waIdDoLead) {
      try {
        const { data, error } = await supabase.from('wa_mensagens').select('telefone').eq('id', waIdDoLead).maybeSingle();
        if (error) return null;
        const dig = soDigitos((data as { telefone?: string | null } | null)?.telefone);
        if (dig && chaveContato(dig) === chave) return dig;
        const lid = await supabase.from('wa_lid_telefone').select('telefone').eq('chave', chave).limit(1);
        if (lid.error) return null;
        const t = soDigitos(((lid.data ?? []) as Array<{ telefone?: string | null }>)[0]?.telefone);
        return t && chaveContato(t) === chave ? t : null;
      } catch { return null; }
    },

    async pensar(alvo, agora) {
      const dona = alvo.posse.dona as Persona;
      try {
        if (await disjuntorAberto(agora)) return { tipo: 'parou', motivo: 'disjuntor', chamadas: 0 };
        const cli = clienteDaRodada(agora);
        const ctx0 = await montarContexto(alvo.posse.chave, { msgs: alvo.msgs, completa: true }, { agora: agora.toISOString() });
        if (!ctx0.completa) return { tipo: 'infra', motivo: 'contexto_incompleto', chamadas: 0 };
        if (dona === 'helena') { ctx0.card = null; ctx0.cardSolar = null; }
        let turnos;
        try { turnos = await lerTurnos(alvo.hmac); } catch { return { tipo: 'infra', motivo: 'armazem_falhou', chamadas: 0 }; }
        const dadosAnt = juntarDados(turnos.filter(t => t.falou).map(t => t.dados));
        const audios = alvo.msgs.filter(m => m.autor === 'lead' && m.tipo === 'audio' && m.media_url).slice(-10).map(m => m.id);
        const cacheMidia = await lerMidiaCache(audios);
        const res = await pensarTurno({
          persona: dona, ctx: ctx0, novas: [], dadosAnteriores: dadosAnt, abertura: false, retomada: true, cliente: cli, cacheMidia,
        });
        const chamadas = (estado as EstadoCota | null)?.chamadas ?? 0;
        if ((estado as EstadoCota | null)?.parou) return { tipo: 'parou', motivo: String((estado as EstadoCota).parou), chamadas };
        if (falhaDeInfra(res.pensamento)) return { tipo: 'infra', motivo: 'falha_de_infra', chamadas };
        if (!res.pensamento.falou) return { tipo: 'barrada', motivo: res.pensamento.motivo.slice(0, 60), chamadas };
        const dec: DecisaoDaBolha = decidirBolhaDaRetomada(res.pensamento.saida);
        if (dec.tipo === 'texto' && dona === 'helena') {
          const viol = violacaoDaBolha(dec.bolha, false);
          if (viol) return { tipo: 'barrada', motivo: `helena:${String(viol).slice(0, 40)}`, chamadas };
        }
        return { ...dec, chamadas };
      } catch (e) {
        logger.error(LOG, `a IA da retomada falhou (${codigoDe(e)})`);
        return { tipo: 'infra', motivo: 'erro', chamadas: (estado as EstadoCota | null)?.chamadas ?? 0 };
      }
    },

    async ultimoId(chave) {
      const c = await lerConversa(chave);
      if (!c.completa) return null;
      return c.msgs.length ? c.msgs[c.msgs.length - 1]!.id : null;
    },

    async podeFalarAgora(telefone) {
      try {
        if (!chaveContato(telefone)) return false;
        const g = await podeFalarComLead(telefone);
        if (!g.pode) return false;
        const m = await motivosDaSupressao(telefone);
        return !m.some(x => x === 'opt_out' || x === 'denuncia' || x === 'fora_do_padrao' || x === 'pediu_humano');
      } catch { return false; }
    },

    claim: async (chave, agora) => {
      const v = await reservarChave(chave, { em: agora.toISOString() }, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    apagarClaim: (chave) => liberarChave(chave),
    enviar: (telefone, bolha) => sendFrio(telefone, [bolha], 'io'),

    async erroDeLinha(_err, agora) {
      try {
        const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
        const n = (Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0) || 0) + 1;
        const iso = agora.toISOString();
        await supabase.from('system_state').upsert({ key: CHAVE_LINHA_ERROS, value: { n, em: iso }, updated_at: iso }, { onConflict: 'key' });
        if (n >= TENTATIVAS_LINHA) {
          await supabase.from('system_state').upsert({
            key: CHAVE_LINHA_PAUSA, value: { ate: new Date(agora.getTime() + 15 * 60_000).toISOString(), motivo: 'erros_seguidos', n }, updated_at: iso,
          }, { onConflict: 'key' });
        }
      } catch (e) { logger.error(LOG, `contagem de erro da linha falhou (${codigoDe(e)})`); }
    },
    async envioOk(agora) {
      try {
        const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
        if ((Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0) || 0) > 0) {
          const iso = agora.toISOString();
          await supabase.from('system_state').upsert({ key: CHAVE_LINHA_ERROS, value: { n: 0, em: iso }, updated_at: iso }, { onConflict: 'key' });
        }
      } catch { /* o contador só pausa a linha; errar para zerar não derruba a rodada */ }
    },

    async gravarBase(posse, patch) {
      const atual = await lerPosse(posse.chave).catch(() => null);
      if (!atual) return false;
      return atualizarPosse(posse.chave, { base: juntarBase(atual, patch) });
    },

    async gravarFila(vazia, agora) {
      try {
        const iso = agora.toISOString();
        const { error } = await supabase.from('system_state').upsert({ key: CHAVE_FILA_BASE, value: { vazia, em: iso }, updated_at: iso }, { onConflict: 'key' });
        if (error) logger.warn(LOG, `a fila não foi gravada (${codigoDe(error)})`);
      } catch (e) { logger.warn(LOG, `a fila não foi gravada (${codigoDe(e)})`); }
    },

    /** As vezes de 10 min ficam 2 h e saem (a faxina da cota não conhece este prefixo). */
    async limparVezes(agora) {
      try {
        await supabase.from('system_state').delete().like('key', `${PREFIXO_VEZ_BASE}%`)
          .lt('updated_at', new Date(agora.getTime() - 2 * 3_600_000).toISOString());
      } catch { /* sobra no máximo 12 linhas por hora até a próxima rodada */ }
    },
  };
}
