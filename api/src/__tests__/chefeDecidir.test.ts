import { describe, it, expect } from 'vitest';
import {
  decidir, classeEfetiva, classificarErroEnvio, Estado, Pedido, Decisao, ContagemPorClasse, JanelaContagem,
} from '../services/chefe/decidir';
import { lerRegulamento, REGULAMENTO_PADRAO, dentroDaJanela } from '../services/chefe/regulamento';
import { montarEstado, EnvioLivro } from '../services/chefe/estado';
import { CLASSE_POR_ROBO, Classe, MetaRobo, ROBO_DESCONHECIDO } from '../services/chefe/classes';

// ─────────────────────────────────────────────────────────────────────────────
// A função pura do CHEFE, uma regra por caso, e depois ~2.000 estados sorteados
// por semente fixa com um oráculo escrito à parte (números cravados aqui, não
// lidos do regulamento). O oráculo confere duas coisas: que o motivo de cada
// 'adiar' é verdade no estado (sem mentira), e que sem regra no limite a
// resposta é 'enviar_agora' (sem vaga parada com demanda esperando).
// Telefones fictícios.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const brt = (s: string): number => Date.parse(`${s}:00-03:00`);

const T = brt('2026-10-05T10:00');            // segunda, 10h
const DOMINGO_10H = brt('2026-10-04T10:00');
const SABADO_20H01 = brt('2026-10-03T20:01');
const SEGUNDA_9H = brt('2026-10-05T09:00');
const EQUIPE = ['34900000001'];
const LEAD = '5534900000099';

type Contagens = Partial<Record<JanelaContagem, ContagemPorClasse>>;

/** Estado vazio com o que o caso pedir por cima. Contagem de 1h entra também em 3h, 6h e 24h. */
function est(over: Partial<Estado> & { h1?: ContagemPorClasse; m10?: ContagemPorClasse; h24?: ContagemPorClasse } = {}): Estado {
  const { h1, m10, h24, ...resto } = over;
  const c: Contagens = {};
  const soma = (a: ContagemPorClasse | undefined, b: ContagemPorClasse | undefined): ContagemPorClasse => {
    const out: ContagemPorClasse = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b ?? {})) out[k as Classe] = (out[k as Classe] ?? 0) + (v ?? 0);
    return out;
  };
  if (m10) c['10min'] = { ...m10 };
  const hora = soma(h1, m10);
  c['1h'] = hora; c['3h'] = { ...hora }; c['6h'] = { ...hora };
  c['24h'] = soma(hora, h24);
  return { contagens: c, errosLinhaSeguidos: 0, equipe: EQUIPE, ...resto };
}

const ped = (robo: string, extra: Partial<Pedido> = {}): Pedido => ({ robo, destino: LEAD, ...extra });
const comEntrada = (min: number): Partial<Estado> => ({ destino: { ultimaEntradaEm: T - min * MIN } });

function adiar(d: Decisao) {
  if (d.acao !== 'adiar') throw new Error(`esperava adiar, veio ${JSON.stringify(d)}`);
  return d;
}

describe('decidir: uma regra por caso', () => {
  it('7º frio na hora: adiar até a saída do mais antigo', () => {
    const e = est({ h1: { frio_p5: 6 }, maisAntigoEm: { frio_1h: T - 50 * MIN }, ultimoEm: { frio: T - 20 * MIN, carimbado: T - 20 * MIN, fisica: T - 20 * MIN } });
    const d = adiar(decidir(e, ped('semente'), T));
    expect(d.motivo).toBe('teto_frio_hora');
    expect(d.escopo).toBe('linha');
    expect(d.ate).toBeGreaterThanOrEqual(T + 10 * MIN);
    expect(d.ate).toBeLessThanOrEqual(T + 10 * MIN + 90_000);
  });

  it('frio no domingo às 10h e no sábado às 20h01: adiar para segunda às 9h', () => {
    for (const agora of [DOMINGO_10H, SABADO_20H01]) {
      const d = adiar(decidir(est(), ped('semente'), agora));
      expect(d.motivo).toBe('fora_da_janela');
      expect(d.ate).toBeGreaterThanOrEqual(SEGUNDA_9H);
      expect(d.ate).toBeLessThanOrEqual(SEGUNDA_9H + 90_000);
    }
  });

  it('frio colado num lembrete de 1 min atrás espera 10 a 15 min (o lembrete é carimbado, como no HEAD)', () => {
    const d = adiar(decidir(est({ ultimoEm: { carimbado: T - MIN, fisica: T - MIN } }), ped('bia_recuperacao'), T));
    expect(d.motivo).toBe('espaco_frio');
    expect(d.ate).toBeGreaterThanOrEqual(T + 9 * MIN);
    expect(d.ate).toBeLessThanOrEqual(T + 14 * MIN + 90_000);
  });

  it('frio 1 min depois de uma resposta (não carimbada) espera 2 min; 3 min depois passa', () => {
    const d = adiar(decidir(est({ ultimoEm: { fisica: T - MIN } }), ped('semente'), T));
    expect(d.motivo).toBe('espaco_frio');
    expect(d.ate).toBeLessThanOrEqual(T + MIN + 90_000);
    expect(decidir(est({ ultimoEm: { fisica: T - 3 * MIN } }), ped('semente'), T).acao).toBe('enviar_agora');
  });

  it('com o frio travado, o lembrete de 5 min (P1) passa', () => {
    const e = est({ h1: { frio_p5: 6 } });
    expect(decidir(e, ped('semente'), T).acao).toBe('adiar');
    const d = decidir(e, ped('ep_agenda', { prazo: T + 5 * MIN }), T);
    expect(d).toMatchObject({ acao: 'enviar_agora', classe: 'lembrete_p1' });
  });

  it('frio barrado quando sobram menos de 4 vagas na hora; o transacional passa', () => {
    const e = est({ h1: { transacional_agenda_p3: 20 } });
    expect(adiar(decidir(e, ped('semente'), T)).motivo).toBe('reserva_transacional');
    expect(decidir(e, ped('ep_agenda'), T).acao).toBe('enviar_agora');
  });

  it('frio barrado com a linha em 190 em 24h (reserva de 10); o transacional passa até 200', () => {
    const e = est({ h24: { transacional_agenda_p3: 190 } });
    expect(adiar(decidir(e, ped('semente'), T)).motivo).toBe('reserva_transacional');
    expect(decidir(e, ped('ep_agenda'), T).acao).toBe('enviar_agora');
    const cheio = est({ h24: { transacional_agenda_p3: 200 } });
    expect(adiar(decidir(cheio, ped('ep_agenda'), T)).motivo).toBe('teto_linha_dia');
  });

  it('rampa dia 0: transacional para em 10/h e o frio em 1/dia (o dia da rampa menos a reserva); lembrete e resposta passam', () => {
    const r = { reconectadoEm: T - 2 * HORA };
    expect(adiar(decidir(est({ ...r, h1: { transacional_agenda_p3: 10 } }), ped('ep_agenda'), T)).motivo).toBe('rampa_hora');
    // Dia 1 da rampa: frio em 3/h (e 10/dia).
    expect(adiar(decidir(est({ reconectadoEm: T - 36 * HORA, h1: { frio_p5: 3 } }), ped('semente'), T)).motivo).toBe('teto_frio_hora');
    expect(adiar(decidir(est({ ...r, h24: { frio_p5: 1 } }), ped('semente'), T)).motivo).toBe('teto_frio_dia');
    expect(decidir(est({ ...r, h1: { transacional_agenda_p3: 10 } }), ped('ep_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
    expect(decidir(est({ ...r, h1: { transacional_agenda_p3: 10 }, ...comEntrada(1) }), ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
  });

  it('rampa some depois de 72h', () => {
    expect(decidir(est({ reconectadoEm: T - 73 * HORA, h1: { transacional_agenda_p3: 10 } }), ped('ep_agenda'), T).acao).toBe('enviar_agora');
  });

  it('pausa humana: quem respeita a pausa adia até ela esfriar, só para aquele destino', () => {
    const pausa = { destino: { pausa: { ultimaFalaEm: T - HORA } } };
    const d = adiar(decidir(est(pausa), ped('giovanna_agenda'), T));
    expect(d).toMatchObject({ motivo: 'pausa_humana', escopo: 'destino' });
    expect(d.ate).toBeGreaterThanOrEqual(T + 23 * HORA);
    // A agenda do eletroposto não checa pausa hoje; a vendedora reativa também não.
    expect(decidir(est(pausa), ped('ep_agenda'), T).acao).toBe('enviar_agora');
    expect(decidir(est({ destino: { pausa: { ultimaFalaEm: T - HORA }, ultimaEntradaEm: T - MIN } }), ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    // A Duda cala.
    expect(adiar(decidir(est({ destino: { pausa: { ultimaFalaEm: T - HORA }, ultimaEntradaEm: T - MIN } }), ped('duda_recepcao'), T)).motivo).toBe('pausa_humana');
    // Esfriou (25h): volta.
    expect(decidir(est({ destino: { pausa: { ultimaFalaEm: T - 25 * HORA } } }), ped('giovanna_agenda'), T).acao).toBe('enviar_agora');
  });

  // [revisão] As mudanças de pausa escritas em DIVERGENCIAS só eram pegas pelo
  // oráculo sorteado: tirar a pausa da cobrança do SIM, das boas-vindas ou do
  // reativo rebaixado a frio não derrubava nenhum caso.
  it('pausa fixada robô a robô: cobrança do SIM, boas-vindas e Giovanna esperam, com prazo também; reativo rebaixado a frio espera', () => {
    const comPausa = (extra: Partial<NonNullable<Estado['destino']>> = {}) => est({ destino: { pausa: { ultimaFalaEm: T - HORA }, ...extra } });
    for (const robo of ['ep_cobra_sim', 'solar_boas_vindas', 'giovanna_agenda']) {
      // Sem prazo (P3) e com prazo (vira lembrete_p1): a pausa segura os dois.
      expect({ robo, d: adiar(decidir(comPausa(), ped(robo), T)) }).toMatchObject({ robo, d: { classe: 'transacional_agenda_p3', motivo: 'pausa_humana', escopo: 'destino' } });
      expect({ robo, d: adiar(decidir(comPausa(), ped(robo, { prazo: T + 5 * MIN }), T)) }).toMatchObject({ robo, d: { classe: 'lembrete_p1', motivo: 'pausa_humana', escopo: 'destino' } });
      // Pausa esfriada (25h): sai.
      expect(decidir(est({ destino: { pausa: { ultimaFalaEm: T - 25 * HORA } } }), ped(robo, { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
    }
    // A vendedora reativa passa com o lead que escreveu agora; atrasada, vira frio, e frio espera a pausa.
    expect(decidir(comPausa({ ultimaEntradaEm: T - MIN }), ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    expect(adiar(decidir(comPausa({ ultimaEntradaEm: T - 3 * HORA }), ped('giovanna_reativa'), T))).toMatchObject({ classe: 'frio_p5', motivo: 'pausa_humana' });
    expect(adiar(decidir(comPausa({ ultimaEntradaEm: T - 3 * HORA }), ped('manual_crm'), T))).toMatchObject({ classe: 'frio_p5', motivo: 'pausa_humana' });
    // O aviso rebaixado a frio (destino de fora) também espera.
    expect(adiar(decidir(comPausa(), ped('ep_respostas_aviso'), T))).toMatchObject({ classe: 'frio_p5', motivo: 'pausa_humana' });
    // A agenda do eletroposto não confere a pausa hoje, nem com prazo.
    expect(decidir(comPausa(), ped('ep_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
  });

  it('pausa (destino) e janela (linha) juntas: o escopo é da linha', () => {
    const d = adiar(decidir(est({ destino: { pausa: { ultimaFalaEm: DOMINGO_10H - HORA } } }), ped('semente'), DOMINGO_10H));
    expect(d.escopo).toBe('linha');
  });

  it('2 erros de linha seguidos: proativa adia 15 min, evento vai para a caixa, resposta e lembrete tentam', () => {
    const e = est({ errosLinhaSeguidos: 2, ultimoErroLinhaEm: T - 5 * MIN, ...comEntrada(1) });
    const d = adiar(decidir(e, ped('ep_agenda'), T));
    expect(d.motivo).toBe('freio_de_erro');
    expect(d.ate).toBeGreaterThanOrEqual(T + 10 * MIN);
    expect(decidir(e, ped('solardoc_compra'), T)).toMatchObject({ acao: 'caixa_de_saida', motivo: 'freio_de_erro' });
    expect(decidir(e, ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    expect(decidir(e, ped('ep_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
  });

  it('durante o freio, resposta e lembrete são a sonda: no máximo 1 tentativa a cada 5 min', () => {
    const e = est({ errosLinhaSeguidos: 3, ultimoErroLinhaEm: T - MIN, ...comEntrada(1) });
    const d = adiar(decidir(e, ped('ep_agenda', { prazo: T + 30 * MIN }), T));
    expect(d.motivo).toBe('freio_de_erro');
    expect(d.ate).toBeGreaterThanOrEqual(T + 4 * MIN);
    expect(d.ate).toBeLessThanOrEqual(T + 4 * MIN + 90_000);
    expect(adiar(decidir(e, ped('giovanna_reativa'), T)).motivo).toBe('freio_de_erro');
  });

  it('1 erro de linha não freia; freio de 16 min atrás já acabou', () => {
    expect(decidir(est({ errosLinhaSeguidos: 1, ultimoErroLinhaEm: T - MIN }), ped('ep_agenda'), T).acao).toBe('enviar_agora');
    expect(decidir(est({ errosLinhaSeguidos: 3, ultimoErroLinhaEm: T - 16 * MIN }), ped('ep_agenda'), T).acao).toBe('enviar_agora');
  });

  it('chave repetida em 15 min: adiar ja_reservado no destino; evento repetido vai para a caixa', () => {
    const e = est({ destino: { chaveReservadaEm: T - 5 * MIN } });
    expect(adiar(decidir(e, ped('ep_agenda', { chave: 'ep_agenda_sent:7:manha' }), T))).toMatchObject({ motivo: 'chave_repetida', escopo: 'destino' });
    expect(decidir(e, ped('solardoc_compra', { chave: 'compra:7' }), T)).toMatchObject({ acao: 'caixa_de_saida', motivo: 'chave_repetida' });
    expect(decidir(est({ destino: { chaveReservadaEm: T - 20 * MIN } }), ped('ep_agenda', { chave: 'x' }), T).acao).toBe('enviar_agora');
  });

  it('destino da equipe declarado como frio vira aviso_interno (sem janela e sem gastar o frio)', () => {
    const d = decidir(est({ h1: { frio_p5: 6 } }), ped('semente', { destino: '5534900000001' }), brt('2026-10-04T23:00'));
    expect(d).toMatchObject({ acao: 'enviar_agora', classe: 'aviso_interno_p2' });
  });

  // [revisão] Aviso ao time com destino FORA da equipe era aviso_interno_p2: sem
  // janela, sem pausa, sem orçamento do frio. O eletropostoRespostas.ts podia
  // pedir como ep_respostas_aviso e mandar a oferta fria a lead no domingo às 3h.
  it('aviso para destino fora da equipe é frio: domingo às 3h não sai, nem com prazo', () => {
    const tres = brt('2026-10-04T03:00');
    for (const robo of ['ep_alerta_10min', 'ep_respostas_aviso', 'ep_card_ping', 'sentinela_vacuo', 'lembrete_followup']) {
      const d = adiar(decidir(est(), ped(robo), tres));
      expect({ robo, classe: d.classe, motivo: d.motivo }).toEqual({ robo, classe: 'frio_p5', motivo: 'fora_da_janela' });
    }
    // Com prazo, o alerta de 10 min para lead não vira lembrete (era P1 sem pausa).
    expect(adiar(decidir(est(), ped('ep_alerta_10min', { prazo: tres + 10 * MIN }), tres))).toMatchObject({ classe: 'frio_p5', motivo: 'fora_da_janela' });
    expect(decidir(est(), ped('ep_alerta_10min', { prazo: T + 10 * MIN }), T).classe).toBe('frio_p5');
    // O aviso que nasce de evento vai para a caixa como frio, não sai.
    expect(decidir(est(), ped('ep_aviso_ficha'), tres)).toMatchObject({ acao: 'caixa_de_saida', classe: 'frio_p5', motivo: 'fora_da_janela' });
    // No orçamento do frio: o 7º da hora espera.
    expect(adiar(decidir(est({ h1: { frio_p5: 6 } }), ped('ep_respostas_aviso'), T)).motivo).toBe('teto_frio_hora');
    // Para a equipe, continua aviso e continua sem janela.
    expect(decidir(est(), ped('ep_respostas_aviso', { destino: EQUIPE[0] }), tres)).toMatchObject({ acao: 'enviar_agora', classe: 'aviso_interno_p2' });
    expect(decidir(est(), ped('ep_alerta_10min', { destino: EQUIPE[0], prazo: T + 10 * MIN }), T).classe).toBe('lembrete_p1');
  });

  it('robô com classe declarada para lead usa a dele com destino de fora (nenhum robô de hoje declara)', () => {
    const meta: MetaRobo = { ...CLASSE_POR_ROBO.ep_alerta_10min!, classeComLead: 'transacional_agenda_p3' };
    expect(classeEfetiva(meta, ped('ep_alerta_10min'), { equipe: EQUIPE }, T)).toBe('transacional_agenda_p3');
    expect(classeEfetiva(meta, ped('ep_alerta_10min', { prazo: T + 10 * MIN }), { equipe: EQUIPE }, T)).toBe('lembrete_p1');
    expect(classeEfetiva(meta, ped('ep_alerta_10min', { destino: EQUIPE[0] }), { equipe: EQUIPE }, T)).toBe('aviso_interno_p2');
  });

  // [revisão] Qualquer grupo virava destino interno, para qualquer robô: o frio,
  // o robô sem registro e a rota da queda de 30/08 saíam como aviso para
  // '...-group', fora da janela e do orçamento do frio. A linha é membro do
  // grupo do eletroposto, onde entra lead.
  it('grupo não é interno por padrão: frio, robô sem registro e lote do admin para grupo continuam frio', () => {
    const tres = brt('2026-10-04T03:00');
    for (const destino of ['120363410228854732-group', '120363000000000000@g.us']) {
      for (const robo of ['semente', 'robo_novo_sem_registro', 'zapi_admin_lote']) {
        const d = adiar(decidir(est(), ped(robo, { destino }), tres));
        expect({ robo, destino, classe: d.classe, motivo: d.motivo }).toEqual({ robo, destino, classe: 'frio_p5', motivo: 'fora_da_janela' });
      }
    }
    // Grupo da lista explícita (com o sufixo trocado) é interno.
    const lista = { gruposInternos: ['120363424419098566-group'] };
    expect(decidir(est(lista), ped('semente', { destino: '120363424419098566@g.us' }), tres)).toMatchObject({ acao: 'enviar_agora', classe: 'aviso_interno_p2' });
    expect(decidir(est(lista), ped('semente', { destino: '120363410228854732-group' }), tres).classe).toBe('frio_p5');
    // O robô do cartão de agendamento é de grupo; para telefone de lead, é frio.
    expect(decidir(est(), ped('sdr_grupo_interno', { destino: '120363424419098566-group' }), tres)).toMatchObject({ acao: 'enviar_agora', classe: 'aviso_interno_p2' });
    expect(decidir(est(), ped('sdr_grupo_interno'), tres).classe).toBe('frio_p5');
  });

  it('13º aviso na hora: o de tick adia, o de evento vai para a caixa, o urgente passa', () => {
    const e = est({ h1: { aviso_interno_p2: 12 } });
    expect(adiar(decidir(e, ped('sentinela_vacuo', { destino: EQUIPE[0] }), T)).motivo).toBe('sublimite_aviso');
    expect(decidir(e, ped('webhook_aviso_equipe', { destino: EQUIPE[0] }), T)).toMatchObject({ acao: 'caixa_de_saida', motivo: 'sublimite_aviso' });
    expect(decidir(e, ped('ep_aviso_ficha', { destino: EQUIPE[0] }), T).acao).toBe('enviar_agora');
  });

  it('1 toque = 1 mensagem: frio pedindo 3 bolhas sai em 1; resposta em 2; Pix ganha bolha própria', () => {
    const bolhas = (d: Decisao) => (d.acao === 'enviar_agora' ? d.maxBolhas : -1);
    expect(bolhas(decidir(est(), ped('semente', { bolhas: 3 }), T))).toBe(1);
    expect(bolhas(decidir(est(comEntrada(1)), ped('giovanna_reativa', { bolhas: 3 }), T))).toBe(2);
    expect(bolhas(decidir(est(), ped('recuperacao_checkout', { bolhas: 1, temPix: true }), T))).toBe(2);
    expect(bolhas(decidir(est(comEntrada(1)), ped('giovanna_reativa', { bolhas: 3, temPix: true }), T))).toBe(3);
    expect(bolhas(decidir(est(), ped('solardoc_compra', { bolhas: 2 }), T))).toBe(1);
    expect(bolhas(decidir(est(), ped('ep_agenda', { bolhas: 5 }), T))).toBe(1);
  });

  it('reativo sem mensagem nos últimos 15 min vira FRIO, com ou sem conversa em 24h (o P3 é só de robô de agenda)', () => {
    // Antes: quem escreveu há 3h rebaixava a P3 e saía a 24/h, fora do frio.
    expect(decidir(est(comEntrada(3 * 60)), ped('giovanna_reativa'), T).classe).toBe('frio_p5');
    expect(decidir(est(comEntrada(20 * 60)), ped('manual_crm'), T).classe).toBe('frio_p5');
    expect(decidir(est(comEntrada(3 * 24 * 60)), ped('giovanna_reativa'), T).classe).toBe('frio_p5');
    expect(decidir(est(), ped('manual_crm'), T).classe).toBe('frio_p5');
    expect(adiar(decidir(est(), ped('manual_crm'), DOMINGO_10H)).motivo).toBe('fora_da_janela');
    // No orçamento do frio: o 7º da hora espera, mesmo para quem escreveu ontem.
    expect(adiar(decidir(est({ h1: { frio_p5: 6 }, ...comEntrada(20 * 60) }), ped('manual_crm'), T)).motivo).toBe('teto_frio_hora');
    // Quem escreveu agora continua resposta.
    expect(decidir(est(comEntrada(5)), ped('manual_crm'), T).classe).toBe('reativo_p1');
  });

  it('manual_crm é de 1 destino por chamada: chamada com mais de um é lote e sai como o robô de lote (frio)', () => {
    const d = decidir(est(comEntrada(5)), ped('manual_crm', { destinosNaChamada: 60 }), T);
    expect(d.classe).toBe('frio_p5');
    expect(d.prioridade).toBe(56); // a subprioridade do zapi_admin_lote, não a do humano digitando
    expect(decidir(est(comEntrada(5)), ped('manual_crm', { destinosNaChamada: 1 }), T).classe).toBe('reativo_p1');
    // Robô sem limite de destinos não muda com o número.
    expect(decidir(est(comEntrada(5)), ped('giovanna_reativa', { destinosNaChamada: 60 }), T).classe).toBe('reativo_p1');
  });

  it('evento nunca é adiado: domingo às 3h com a linha cheia, sai agora', () => {
    const cheia = est({ m10: { transacional_agenda_p3: 6 }, h1: { transacional_agenda_p3: 18 }, h24: { transacional_agenda_p3: 180 } });
    const d = decidir(cheia, ped('solardoc_compra'), brt('2026-10-04T03:00'));
    expect(d).toMatchObject({ acao: 'enviar_agora', classe: 'evento_p0' });
  });

  it('evento no teto de emergência (60/h) vai para a caixa de saída', () => {
    const d = decidir(est({ h1: { reativo_p1: 60 } }), ped('dunning_d0'), T);
    expect(d).toMatchObject({ acao: 'caixa_de_saida', motivo: 'teto_emergencia' });
  });

  it('urgente obedece só ao espaçamento curto, como espera em processo de até 10 s', () => {
    const d = decidir(est({ ultimoEm: { fisica: T - 4000 } }), ped('solardoc_ativacao'), T);
    expect(d).toMatchObject({ acao: 'enviar_agora', esperarMs: 6000 });
    expect(decidir(est({ ultimoEm: { fisica: T - 30_000 } }), ped('solardoc_ativacao'), T)).toMatchObject({ esperarMs: 0 });
  });

  it('rajada: 6 proativas em 10 min seguram a 7ª; proativa a 10 s da anterior espera; a 61 s passa', () => {
    expect(adiar(decidir(est({ m10: { transacional_agenda_p3: 6 } }), ped('ep_agenda'), T)).motivo).toBe('rajada_10min');
    expect(adiar(decidir(est({ ultimoEm: { proativa: T - 10_000 } }), ped('ep_agenda'), T)).motivo).toBe('espaco_proativa');
    expect(decidir(est({ ultimoEm: { proativa: T - 61_000 } }), ped('ep_agenda'), T).acao).toBe('enviar_agora');
  });

  it('volume sustentado sem conversa: 40 em 3h ou 60 em 6h seguram P3 para quem não escreveu; quem conversa passa', () => {
    expect(adiar(decidir(est({ semConversa: { '3h': 40 } }), ped('ep_agenda'), T)).motivo).toBe('volume_sustentado');
    expect(adiar(decidir(est({ semConversa: { '6h': 60 } }), ped('ep_agenda'), T)).motivo).toBe('volume_sustentado');
    expect(decidir(est({ semConversa: { '3h': 40 }, ...comEntrada(120) }), ped('ep_agenda'), T).acao).toBe('enviar_agora');
  });

  it('a proativa não leva o total da hora acima de 40; o urgente vai até 60', () => {
    const e = est({ h1: { reativo_p1: 30, lembrete_p1: 10 }, ...comEntrada(1) });
    expect(adiar(decidir(e, ped('ep_agenda'), T)).motivo).toBe('teto_proativo_total');
    expect(decidir(e, ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    // O aviso urgente (lead novo) fica fora desta conta; o de evento comum vai para a caixa.
    expect(decidir(e, ped('ep_aviso_ficha', { destino: EQUIPE[0] }), T).acao).toBe('enviar_agora');
    expect(decidir(e, ped('webhook_aviso_equipe', { destino: EQUIPE[0] }), T)).toMatchObject({ acao: 'caixa_de_saida', motivo: 'teto_proativo_total' });
  });

  it('prioridade: a vaga de quem tem prioridade maior e está esperando fica guardada', () => {
    // 8 transacionais esperando: o frio não pega as 8 últimas vagas da hora (a reserva vira 8, não 4).
    expect(adiar(decidir(est({ h1: { transacional_agenda_p3: 16 }, esperando: { transacional_agenda_p3: 8 } }), ped('semente'), T)).motivo).toBe('reservado_prioridade_maior');
    expect(decidir(est({ h1: { transacional_agenda_p3: 15 }, esperando: { transacional_agenda_p3: 8 } }), ped('semente'), T).acao).toBe('enviar_agora');
    expect(adiar(decidir(est({ h1: { transacional_agenda_p3: 21 }, esperando: { aviso_interno_p2: 3 } }), ped('ep_agenda'), T)).motivo).toBe('reservado_prioridade_maior');
    expect(decidir(est({ h1: { transacional_agenda_p3: 21 }, esperando: { aviso_interno_p2: 3 } }), ped('sentinela_vacuo', { destino: EQUIPE[0] }), T).acao).toBe('enviar_agora');
    const frio = est({ h1: { frio_p5: 4 }, esperando: { frio_receita_p4: 2 }, ultimoEm: {} });
    expect(adiar(decidir(frio, ped('semente'), T)).motivo).toBe('reservado_prioridade_maior');
    expect(decidir(frio, ped('recuperacao_checkout'), T).acao).toBe('enviar_agora');
  });

  it('prazo não é passe livre: o lembrete com prazo mora na janela do transacional (7h–21h)', () => {
    const tresDaManha = brt('2026-10-04T03:00');
    const d = adiar(decidir(est(), ped('ep_agenda', { prazo: tresDaManha + 60 * MIN }), tresDaManha));
    expect(d).toMatchObject({ classe: 'lembrete_p1', motivo: 'fora_da_janela', escopo: 'linha' });
    expect(d.ate).toBeGreaterThanOrEqual(brt('2026-10-04T07:00'));
    expect(d.ate).toBeLessThanOrEqual(brt('2026-10-04T07:00') + 90_000);
    expect(adiar(decidir(est(), ped('ep_agenda', { prazo: brt('2026-10-05T21:30') }), brt('2026-10-05T21:05'))).motivo).toBe('fora_da_janela');
    // A resposta e o evento continuam sem janela.
    expect(decidir(est({ destino: { ultimaEntradaEm: tresDaManha - MIN } }), ped('giovanna_reativa'), tresDaManha).acao).toBe('enviar_agora');
    expect(decidir(est(), ped('solardoc_compra'), tresDaManha).acao).toBe('enviar_agora');
  });

  it('prazo não é passe livre: no máximo 6 lembretes com prazo em 10 min; a resposta passa', () => {
    const cheio = est({ m10: { lembrete_p1: 6 }, maisAntigoEm: { lembrete_10min: T - 7 * MIN }, ...comEntrada(1) });
    const d = adiar(decidir(cheio, ped('ep_agenda', { prazo: T + 5 * MIN }), T));
    expect(d).toMatchObject({ classe: 'lembrete_p1', motivo: 'rajada_lembrete' });
    expect(d.ate).toBeGreaterThanOrEqual(T + 3 * MIN);
    expect(d.ate).toBeLessThanOrEqual(T + 3 * MIN + 90_000);
    expect(decidir(est({ m10: { lembrete_p1: 5 } }), ped('ep_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
    expect(decidir(cheio, ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    // O alerta de 10 min ao time também vira lembrete pelo prazo e entra na mesma rajada.
    expect(adiar(decidir(cheio, ped('ep_alerta_10min', { destino: EQUIPE[0], prazo: T + 10 * MIN }), T)).motivo).toBe('rajada_lembrete');
    // Env só aperta.
    expect(adiar(decidir(est({ m10: { lembrete_p1: 3 } }), ped('ep_agenda', { prazo: T + 5 * MIN }), T,
      lerRegulamento({ CHEFE_RAJADA_LEMBRETE_10MIN: '3' }).reg)).motivo).toBe('rajada_lembrete');
  });

  it('prazo não é passe livre: o lembrete tem teto próprio de 28 na hora e 150 em 24h', () => {
    const p = ped('ep_agenda', { prazo: T + 30 * MIN });
    expect(adiar(decidir(est({ h1: { lembrete_p1: 28 } }), p, T))).toMatchObject({ classe: 'lembrete_p1', motivo: 'teto_lembrete_hora' });
    expect(decidir(est({ h1: { lembrete_p1: 27 } }), p, T).acao).toBe('enviar_agora');
    expect(adiar(decidir(est({ h24: { lembrete_p1: 150 } }), p, T)).motivo).toBe('teto_lembrete_dia');
    expect(decidir(est({ h24: { lembrete_p1: 149 } }), p, T).acao).toBe('enviar_agora');
    // Não divide o balde de 24/h das proativas nem o total de 40/h (desvio medido:
    // dividindo, a agenda cheia legítima perdia alerta e lembrete; ver o regulamento).
    expect(decidir(est({ h1: { transacional_agenda_p3: 24 } }), p, T).acao).toBe('enviar_agora');
    expect(decidir(est({ h1: { reativo_p1: 30, transacional_agenda_p3: 10 } }), p, T).acao).toBe('enviar_agora');
    // A resposta não entra no teto do lembrete; env só aperta.
    expect(decidir(est({ h1: { lembrete_p1: 28 }, ...comEntrada(1) }), ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    expect(adiar(decidir(est({ h1: { lembrete_p1: 10 } }), p, T, lerRegulamento({ CHEFE_LEMBRETE_HORA: '10' }).reg)).motivo).toBe('teto_lembrete_hora');
  });

  // [revisão] A rajada do lembrete e a das proativas eram contadas à parte: o
  // mesmo ep_agenda, com metade dos pedidos com prazo, passava 11 em 10 min.
  it('rajada por robô: o mesmo robô não passa de 6 em 10 min somando lembrete com prazo e proativa', () => {
    const cheio = est({ doRobo10min: 6, maisAntigoEm: { robo_10min: T - 4 * MIN } });
    const d = adiar(decidir(cheio, ped('ep_agenda', { prazo: T + 5 * MIN }), T));
    expect(d).toMatchObject({ classe: 'lembrete_p1', motivo: 'rajada_robo' });
    expect(d.ate).toBeGreaterThanOrEqual(T + 6 * MIN);
    expect(d.ate).toBeLessThanOrEqual(T + 6 * MIN + 90_000);
    expect(adiar(decidir(cheio, ped('ep_agenda'), T)).motivo).toBe('rajada_robo');
    expect(decidir(est({ doRobo10min: 5 }), ped('ep_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
    // Resposta e evento ficam fora da rajada por robô.
    expect(decidir({ ...cheio, ...comEntrada(1) }, ped('giovanna_reativa'), T).acao).toBe('enviar_agora');
    expect(decidir(cheio, ped('solardoc_compra'), T).acao).toBe('enviar_agora');
    expect(adiar(decidir(est({ doRobo10min: 3 }), ped('ep_agenda', { prazo: T + 5 * MIN }), T,
      lerRegulamento({ CHEFE_RAJADA_ROBO_10MIN: '3' }).reg)).motivo).toBe('rajada_robo');
  });

  it('a contagem por robô sai do livro só para o robô do pedido, somando lembrete e proativa dos últimos 10 min', () => {
    const envio = (min: number, robo: string, classe: Classe): EnvioLivro =>
      ({ em: T - min * MIN, robo, classe, destino: `55349800000${10 + min}`, bolhas: 1, ok: true });
    const livro: EnvioLivro[] = [
      envio(1, 'ep_agenda', 'lembrete_p1'), envio(2, 'ep_agenda', 'lembrete_p1'), envio(3, 'ep_agenda', 'lembrete_p1'),
      envio(4, 'ep_agenda', 'transacional_agenda_p3'), envio(5, 'ep_agenda', 'transacional_agenda_p3'), envio(6, 'ep_agenda', 'transacional_agenda_p3'),
      envio(7, 'ep_agenda', 'reativo_p1'), envio(11, 'ep_agenda', 'lembrete_p1'),
      envio(8, 'giovanna_agenda', 'lembrete_p1'),
    ];
    const doRobo = (robo: string) => montarEstado(livro, T, { robo, destino: LEAD, equipe: EQUIPE });
    expect(doRobo('ep_agenda').doRobo10min).toBe(6);
    expect(doRobo('ep_agenda').maisAntigoEm?.robo_10min).toBe(T - 6 * MIN);
    expect(doRobo('giovanna_agenda').doRobo10min).toBe(1);
    expect(adiar(decidir(doRobo('ep_agenda'), ped('ep_agenda', { prazo: T + 5 * MIN }), T)).motivo).toBe('rajada_robo');
    expect(decidir(doRobo('giovanna_agenda'), ped('giovanna_agenda', { prazo: T + 5 * MIN }), T).acao).toBe('enviar_agora');
  });

  it('prazo só promove robô de agenda, de 5 min depois até 90 min antes', () => {
    expect(decidir(est(), ped('semente', { prazo: T + 5 * MIN }), T).classe).toBe('frio_p5');
    expect(decidir(est(), ped('ep_agenda', { prazo: T - 3 * MIN }), T).classe).toBe('lembrete_p1');
    expect(decidir(est(), ped('ep_agenda', { prazo: T + 89 * MIN }), T).classe).toBe('lembrete_p1');
    expect(decidir(est(), ped('ep_agenda', { prazo: T + 2 * HORA }), T).classe).toBe('transacional_agenda_p3');
    expect(decidir(est(), ped('ep_agenda', { prazo: T - 10 * MIN }), T).classe).toBe('transacional_agenda_p3');
    expect(decidir(est(), ped('ep_alerta_10min', { destino: EQUIPE[0], prazo: T + 10 * MIN }), T).classe).toBe('lembrete_p1');
  });

  it('robô sem registro é frio', () => {
    const d = adiar(decidir(est(), ped('robo_novo_sem_registro'), DOMINGO_10H));
    expect(d).toMatchObject({ classe: 'frio_p5', motivo: 'fora_da_janela' });
  });

  it('regulamento apertado por env vale (LINHA_MAX_HORA=3)', () => {
    const e = est({ h1: { frio_p5: 3 } });
    expect(decidir(e, ped('semente'), T).acao).toBe('enviar_agora');
    expect(adiar(decidir(e, ped('semente'), T, lerRegulamento({ LINHA_MAX_HORA: '3' }).reg)).motivo).toBe('teto_frio_hora');
  });

  it('a janela de cada robô em CLASSE_POR_ROBO é a da classe dele (o decidir usa a da classe efetiva)', () => {
    for (const [nome, r] of Object.entries(CLASSE_POR_ROBO)) {
      const esperada = FRIAS.includes(r.classe) ? 'frio' : r.classe === 'transacional_agenda_p3' ? 'transacional' : 'livre';
      expect({ nome, janela: r.janela }).toEqual({ nome, janela: esperada });
    }
  });

  it('determinístico: mesma entrada, mesma saída; aceita Date ou número', () => {
    const e = est({ h1: { frio_p5: 6 }, ultimoEm: { proativa: T - 5000 } });
    const p = ped('semente', { chave: 'semente:x' });
    expect(decidir(e, p, T)).toEqual(decidir(e, p, T));
    expect(decidir(e, p, new Date(T))).toEqual(decidir(e, p, T));
  });
});

describe('classificarErroEnvio: só erro de linha freia', () => {
  it.each([
    ['[zapi:io] HTTP 400 — {"error":"Enqueue message is disabled for this instance when whatsapp is disconnected"}', 'linha'],
    ['[zapi:io] HTTP 400 — {"error":"Instance not found"}', 'linha'],
    ['Instance not found', 'linha'],
    ['[zapi:io] HTTP 500 — erro interno', 'linha'],
    ['[zapi:io] HTTP 502 — bad gateway', 'linha'],
    ['[zapi:io] HTTP 429 — Too Many Requests', 'linha'],
    ['fetch failed', 'linha'],
    ['connect ETIMEDOUT 1.2.3.4:443', 'linha'],
    ['The operation was aborted due to timeout', 'linha'],
    ['[zapi:io] HTTP 400 — {"error":"phone number invalid"}', 'destino'],
    ['[zapi:io] HTTP 404 — {"error":"Phone not exists"}', 'destino'],
    ['[zapi:io] em cooldown (instância indisponível há <60s) — pulando envio', 'outro'],
    ['[zapi:io] credenciais Z-API ausentes (verifique ZAPI_INSTANCE_ID_IO)', 'outro'],
    ['', 'outro'],
  ])('%s → %s', (msg, tipo) => {
    expect(classificarErroEnvio(msg)).toBe(tipo);
  });

  it('aceita Error e valor nulo', () => {
    expect(classificarErroEnvio(new Error('whatsapp is disconnected'))).toBe('linha');
    expect(classificarErroEnvio(null)).toBe('outro');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROPRIEDADE: ~2.000 estados sorteados por semente fixa.
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASSES_TODAS: Classe[] = ['evento_p0', 'reativo_p1', 'lembrete_p1', 'aviso_interno_p2', 'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5'];
const PROATIVAS: Classe[] = ['aviso_interno_p2', 'transacional_agenda_p3', 'frio_receita_p4', 'frio_p5'];
const FRIAS: Classe[] = ['frio_receita_p4', 'frio_p5'];
const RAMPA: Classe[] = ['transacional_agenda_p3', 'frio_receita_p4', 'frio_p5'];
const URGENTES: Classe[] = ['evento_p0', 'reativo_p1', 'lembrete_p1'];
const PRI: Record<Classe, number> = { evento_p0: 0, reativo_p1: 1, lembrete_p1: 1, aviso_interno_p2: 2, transacional_agenda_p3: 3, frio_receita_p4: 4, frio_p5: 5 };
/** Grupo da lista explícita, sorteado com o sufixo trocado do que o pedido usa. */
const GRUPO_DA_LISTA = '120363000000000000-group';

function sortearCaso(r: () => number, i: number): { estado: Estado; pedido: Pedido; agora: number } {
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const chance = (p: number) => r() < p;
  const agora = brt('2026-10-05T00:00') + int(0, 14 * 24 * 60) * MIN;

  const R1: Record<Classe, number> = { evento_p0: 3, reativo_p1: 30, lembrete_p1: 40, aviso_interno_p2: 14, transacional_agenda_p3: 24, frio_receita_p4: 4, frio_p5: 7 };
  const R24: Record<Classe, number> = { evento_p0: 20, reativo_p1: 220, lembrete_p1: 130, aviso_interno_p2: 60, transacional_agenda_p3: 190, frio_receita_p4: 8, frio_p5: 28 };
  const c: Contagens = { '10min': {}, '1h': {}, '3h': {}, '6h': {}, '24h': {} };
  for (const k of CLASSES_TODAS) {
    const h1 = chance(0.35) ? 0 : int(0, R1[k]);
    const m10 = int(0, Math.min(h1, 7));
    const h3 = h1 + int(0, 6);
    const h6 = h3 + int(0, 8);
    const h24 = h6 + int(0, R24[k]);
    c['10min']![k] = m10; c['1h']![k] = h1; c['3h']![k] = h3; c['6h']![k] = h6; c['24h']![k] = h24;
  }
  const somaR = (j: JanelaContagem) => RAMPA.reduce((s, k) => s + (c[j]![k] ?? 0), 0);
  const s3 = int(0, Math.min(somaR('3h'), 45));
  const s6 = s3 + int(0, Math.max(0, Math.min(somaR('6h'), 65) - s3));

  const talvez = (p: number, v: () => number): number | null => (chance(p) ? v() : null);
  const erros = chance(0.6) ? 0 : int(1, 3);
  const estado: Estado = {
    contagens: c,
    semConversa: { '3h': s3, '6h': s6 },
    doRobo10min: chance(0.5) ? 0 : int(0, 7),
    ultimoEm: {
      fisica: talvez(0.85, () => agora - int(0, 20 * 60) * 1000),
      proativa: talvez(0.8, () => agora - int(0, 30 * 60) * 1000),
      frio: talvez(0.6, () => agora - int(0, 40 * 60) * 1000),
      carimbado: talvez(0.7, () => agora - int(0, 40 * 60) * 1000),
    },
    maisAntigoEm: chance(0.5) ? { frio_1h: agora - int(1, 59) * MIN, linha_1h: agora - int(1, 59) * MIN, total_1h: agora - int(1, 59) * MIN } : undefined,
    errosLinhaSeguidos: erros,
    ultimoErroLinhaEm: erros ? agora - int(0, 30) * MIN : null,
    reconectadoEm: talvez(0.3, () => agora - int(0, 4 * 24 * 60) * MIN),
    rampaForcadaEm: talvez(0.1, () => agora - int(0, 4 * 24 * 60) * MIN),
    esperando: chance(0.5) ? {} : Object.fromEntries(CLASSES_TODAS.map(k => [k, int(0, 5)])) as ContagemPorClasse,
    equipe: EQUIPE,
    gruposInternos: chance(0.5) ? [GRUPO_DA_LISTA] : [],
    destino: {
      ultimaEntradaEm: [null, agora - int(0, 15) * MIN, agora - int(16, 24 * 60) * MIN, agora - int(2, 5) * DIA][int(0, 3)],
      pausa: chance(0.3) ? { ultimaFalaEm: agora - int(0, 48 * 60) * MIN } : null,
      chaveReservadaEm: talvez(0.2, () => agora - int(0, 30) * MIN),
    },
  };
  const robos = [...Object.keys(CLASSE_POR_ROBO), 'robo_inexistente'];
  // 1 em 5 vem de robô de agenda, para o lembrete com prazo aparecer o bastante na amostra.
  const deAgenda = Object.keys(CLASSE_POR_ROBO).filter(n => CLASSE_POR_ROBO[n]!.podeTerPrazo);
  const lista = chance(0.2) ? deAgenda : robos;
  const pedido: Pedido = {
    robo: lista[int(0, lista.length - 1)]!,
    destino: chance(0.8) ? LEAD : chance(0.5) ? EQUIPE[0]! : chance(0.5) ? '120363000000000000@g.us' : '120363999999999999-group',
    bolhas: chance(0.3) ? undefined : int(1, 4),
    temPix: chance(0.1),
    chave: chance(0.7) ? `k${i}` : undefined,
    prazo: chance(0.4) ? agora + int(-30, 180) * MIN : undefined,
    destinosNaChamada: chance(0.15) ? int(1, 40) : undefined,
  };
  return { estado, pedido, agora };
}

/**
 * ORÁCULO escrito à parte, com os números cravados (não lidos do regulamento).
 * Devolve, para cada motivo, 'sim' (trava com certeza), 'talvez' (depende do
 * sorteio do espaçamento) ou nada.
 */
function oraculo(e: Estado, p: Pedido, agora: number): { classe: Classe; custo: number; evento: boolean; travas: Map<string, 'sim' | 'talvez'> } {
  const meta0: MetaRobo = CLASSE_POR_ROBO[p.robo] ?? ROBO_DESCONHECIDO;
  // Robô de 1 destino por chamada com mais de um destino: é o robô de lote.
  const meta: MetaRobo = meta0.roboDeLote && (p.destinosNaChamada ?? 1) > 1 ? CLASSE_POR_ROBO[meta0.roboDeLote]! : meta0;
  const evento = meta.nasceDeEvento;
  const soma = (j: JanelaContagem, ks: Classe[]) => ks.reduce((s, k) => s + (e.contagens[j]?.[k] ?? 0), 0);
  const ent = e.destino?.ultimaEntradaEm;
  const idadeEnt = typeof ent === 'number' ? Math.max(0, agora - ent) : Infinity;

  // Classe, pela especificação, decidida primeiro pelo DESTINO:
  // - interno é telefone da equipe; grupo só quando está na lista explícita ou o
  //   robô é de grupo (grupo qualquer é de fora: lá entra lead);
  // - para destino interno, todo robô vira aviso ao time;
  // - para destino de fora, aviso ao time vira frio (ou a classe com lead que o
  //   robô declara), reativo sem mensagem nos últimos 15 min vira frio, e o resto
  //   fica com a classe do robô;
  // - por fim, robô de agenda com prazo entre 5 min depois e 90 min antes vira
  //   lembrete, se até aqui é transacional ou aviso.
  const telefone = (s: string): string | null => {
    const d = s.replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return null;
    const x = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return x.length < 10 ? null : x.slice(0, 2) + x.slice(-8);
  };
  const ehGrupoS = /-group$|@g\.us$/i.test(p.destino.trim());
  const idGrupo = (s: string) => s.trim().toLowerCase().replace(/(-group|@g\.us)$/, '').replace(/\D/g, '');
  const interno = ehGrupoS
    ? meta.roboDeGrupo || (e.gruposInternos ?? []).some(g => idGrupo(g) === idGrupo(p.destino))
    : telefone(p.destino) !== null && (e.equipe ?? []).some(t => telefone(t) === telefone(p.destino));
  let classe: Classe;
  if (interno) {
    classe = 'aviso_interno_p2';
  } else {
    switch (meta.classe) {
      case 'aviso_interno_p2': classe = meta.classeComLead ?? 'frio_p5'; break;
      case 'reativo_p1': classe = idadeEnt <= 15 * MIN ? 'reativo_p1' : 'frio_p5'; break;
      default: classe = meta.classe;
    }
  }
  if (meta.podeTerPrazo && typeof p.prazo === 'number' && (classe === 'transacional_agenda_p3' || classe === 'aviso_interno_p2')
    && p.prazo >= agora - 5 * MIN && p.prazo <= agora + 90 * MIN) classe = 'lembrete_p1';

  // Custo.
  const tetoB = classe === 'reativo_p1' ? 2 : 1;
  const tb = Math.min(meta.maxBolhas, tetoB);
  const pedidas = typeof p.bolhas === 'number' ? p.bolhas : tb;
  const custo = Math.max(1, Math.min(pedidas, tb)) + (p.temPix ? 1 : 0);

  const travas = new Map<string, 'sim' | 'talvez'>();
  const sim = (m: string) => travas.set(m, 'sim');
  const talvez = (m: string) => { if (!travas.has(m)) travas.set(m, 'talvez'); };
  const fria = FRIAS.includes(classe);

  if (p.chave && typeof e.destino?.chaveReservadaEm === 'number' && agora - e.destino.chaveReservadaEm < 15 * MIN) sim('chave_repetida');
  const pausa = e.destino?.pausa;
  if ((meta.respeitaPausa || fria) && classe !== 'aviso_interno_p2' && pausa && agora - pausa.ultimaFalaEm <= DIA) sim('pausa_humana');
  if (e.errosLinhaSeguidos >= 2 && typeof e.ultimoErroLinhaEm === 'number') {
    const sonda = classe === 'reativo_p1' || classe === 'lembrete_p1';
    if (agora < e.ultimoErroLinhaEm + (sonda ? 5 : 15) * MIN) sim('freio_de_erro');
  }
  const total1h = soma('1h', CLASSES_TODAS);
  if (total1h + custo > 60 || soma('24h', CLASSES_TODAS) + custo > 450) sim('teto_emergencia');

  // Janela (BRT): frio 9–20 sem domingo; P3 e lembrete com prazo 7–21.
  const b = new Date(agora - 3 * HORA);
  const h = b.getUTCHours();
  // O mesmo robô: no máximo 6 em 10 min, somando lembrete com prazo e proativa.
  if ((classe === 'lembrete_p1' || PROATIVAS.includes(classe)) && (e.doRobo10min ?? 0) + custo > 6) sim('rajada_robo');
  // Lembrete com prazo: janela do transacional, no máximo 6 em 10 min, 28 na hora e 150 em 24h.
  if (classe === 'lembrete_p1') {
    if (h < 7 || h >= 21) sim('fora_da_janela');
    if (soma('10min', ['lembrete_p1']) + custo > 6) sim('rajada_lembrete');
    if (soma('1h', ['lembrete_p1']) + custo > 28) sim('teto_lembrete_hora');
    if (soma('24h', ['lembrete_p1']) + custo > 150) sim('teto_lembrete_dia');
  }
  if (URGENTES.includes(classe)) return { classe, custo, evento, travas };

  if (fria && (b.getUTCDay() === 0 || h < 9 || h >= 20)) sim('fora_da_janela');
  if (classe === 'transacional_agenda_p3' && (h < 7 || h >= 21)) sim('fora_da_janela');

  if (soma('10min', PROATIVAS) + custo > 6) sim('rajada_10min');
  const up = e.ultimoEm?.proativa;
  if (typeof up === 'number') { if (agora < up + 25_000) sim('espaco_proativa'); else if (agora < up + 60_000) talvez('espaco_proativa'); }
  if (!(classe === 'aviso_interno_p2' && meta.urgente) && total1h + custo > 40) sim('teto_proativo_total');

  const l1 = soma('1h', PROATIVAS);
  const l24 = soma('24h', PROATIVAS);
  const acima = PROATIVAS.filter(k => PRI[k] < PRI[classe]).reduce((s, k) => s + (e.esperando?.[k] ?? 0), 0);
  if (l1 + custo > 24) sim('teto_linha_hora'); else if (l1 + custo > 24 - acima) sim('reservado_prioridade_maior');
  if (l24 + custo > 200) sim('teto_linha_dia'); else if (l24 + custo > 200 - acima) sim('reservado_prioridade_maior');

  if (RAMPA.includes(classe) && !(idadeEnt <= DIA)) {
    if ((e.semConversa?.['3h'] ?? 0) + custo > 40 || (e.semConversa?.['6h'] ?? 0) + custo > 60) sim('volume_sustentado');
  }

  const marcas = [e.reconectadoEm, e.rampaForcadaEm].filter((x): x is number => typeof x === 'number');
  const dias = marcas.length ? (agora - Math.max(...marcas)) / DIA : Infinity;
  const degrau = dias < 1 ? 0 : dias < 2 ? 1 : dias < 3 ? 2 : -1;
  const frioHora = [2, 3, 4][degrau] ?? 6;
  const frioDia = [1, 10, 20][degrau] ?? 30;
  if (degrau >= 0 && RAMPA.includes(classe)) {
    if (soma('1h', RAMPA) + custo > [10, 14, 19][degrau]!) sim('rampa_hora');
    if (soma('24h', RAMPA) + custo > [80, 120, 160][degrau]!) sim('rampa_dia');
  }

  if (fria) {
    if (l1 + custo > 24 - Math.max(4, acima)) sim('reserva_transacional');
    if (l24 + custo > 190) sim('reserva_transacional');
    const f1 = soma('1h', FRIAS);
    const f24 = soma('24h', FRIAS);
    const resP4 = classe === 'frio_p5' ? (e.esperando?.frio_receita_p4 ?? 0) : 0;
    if (f1 + custo > frioHora) sim('teto_frio_hora'); else if (f1 + custo > frioHora - resP4) sim('reservado_prioridade_maior');
    if (f24 + custo > frioDia) sim('teto_frio_dia'); else if (f24 + custo > frioDia - resP4) sim('reservado_prioridade_maior');
    const ms = [e.ultimoEm?.carimbado, e.ultimoEm?.frio].filter((x): x is number => typeof x === 'number');
    if (ms.length) { const u = Math.max(...ms); if (agora < u + 10 * MIN) sim('espaco_frio'); else if (agora < u + 15 * MIN) talvez('espaco_frio'); }
    if (typeof e.ultimoEm?.fisica === 'number' && agora < e.ultimoEm.fisica + 2 * MIN) sim('espaco_frio');
  }
  if (classe === 'aviso_interno_p2' && !meta.urgente && soma('1h', ['aviso_interno_p2']) + custo > 12) sim('sublimite_aviso');
  return { classe, custo, evento, travas };
}

describe('decidir: propriedade com 2.000 estados sorteados (semente fixa)', () => {
  const r = mulberry32(20261007);
  const casos = Array.from({ length: 2000 }, (_, i) => sortearCaso(r, i));
  const decisoes = casos.map(({ estado, pedido, agora }) => decidir(estado, pedido, agora));

  it('a amostra cobre as três respostas e as classes todas', () => {
    const acoes = new Set(decisoes.map(d => d.acao));
    expect(acoes).toEqual(new Set(['enviar_agora', 'adiar', 'caixa_de_saida']));
    const classes = new Set(decisoes.map(d => d.classe));
    for (const k of CLASSES_TODAS) expect(classes.has(k), k).toBe(true);
    // Controle positivo: frio enviado e frio fora da janela aparecem na amostra.
    expect(decisoes.some((d, i) => d.acao === 'enviar_agora' && FRIAS.includes(d.classe) && casos[i])).toBe(true);
    expect(decisoes.some(d => d.acao === 'adiar' && d.motivo === 'fora_da_janela')).toBe(true);
  });

  it('a resposta é sempre uma de três; adiar sempre para depois de agora; espera em processo de até 10 s', () => {
    decisoes.forEach((d, i) => {
      const { agora } = casos[i]!;
      expect(['enviar_agora', 'adiar', 'caixa_de_saida']).toContain(d.acao);
      if (d.acao === 'adiar') expect(d.ate).toBeGreaterThan(agora);
      if (d.acao === 'enviar_agora') {
        expect(d.maxBolhas).toBeGreaterThanOrEqual(1);
        expect(d.esperarMs).toBeGreaterThanOrEqual(0);
        expect(d.esperarMs).toBeLessThanOrEqual(10_000);
      }
    });
  });

  it('aviso ao time só para destino interno: telefone da equipe, grupo da lista ou grupo de robô de grupo', () => {
    let avisos = 0;
    let rebaixados = 0;
    decisoes.forEach((d, i) => {
      const { pedido: p, estado: e } = casos[i]!;
      const lista = (e.gruposInternos ?? []).length > 0;
      const interno = p.destino === EQUIPE[0] || (p.destino === '120363000000000000@g.us' && lista)
        || (/-group$|@g\.us$/.test(p.destino) && !!CLASSE_POR_ROBO[p.robo]?.roboDeGrupo);
      if (d.classe === 'aviso_interno_p2') { expect({ i, destino: p.destino, interno }).toEqual({ i, destino: p.destino, interno: true }); avisos++; }
      if (!interno && CLASSE_POR_ROBO[p.robo]?.classe === 'aviso_interno_p2') { expect(['frio_p5', 'frio_receita_p4']).toContain(d.classe); rebaixados++; }
    });
    // Os dois lados aparecem na amostra.
    expect(avisos).toBeGreaterThan(50);
    expect(rebaixados).toBeGreaterThan(50);
  });

  it('envio que nasce de evento nunca recebe adiar', () => {
    decisoes.forEach((d, i) => {
      const meta = CLASSE_POR_ROBO[casos[i]!.pedido.robo];
      if (meta?.nasceDeEvento) expect(d.acao, casos[i]!.pedido.robo).not.toBe('adiar');
    });
  });

  it('nunca envia frio fora da janela (9h–20h, sem domingo)', () => {
    decisoes.forEach((d, i) => {
      if (d.acao === 'enviar_agora' && FRIAS.includes(d.classe)) {
        expect(dentroDaJanela(REGULAMENTO_PADRAO.janelaFrio, casos[i]!.agora)).toBe(true);
      }
    });
  });

  it('nunca envia lembrete com prazo fora das 7h–21h, acima de 6 em 10 min, de 28 na hora nem de 150 em 24h (o prazo não é passe livre)', () => {
    let vistos = 0;
    decisoes.forEach((d, i) => {
      if (d.acao !== 'enviar_agora' || d.classe !== 'lembrete_p1') return;
      const { estado: e, agora } = casos[i]!;
      const h = new Date(agora - 3 * HORA).getUTCHours();
      expect({ i, h, dentro: h >= 7 && h < 21 }).toEqual({ i, h, dentro: true });
      expect((e.contagens['10min']?.lembrete_p1 ?? 0) + d.maxBolhas).toBeLessThanOrEqual(6);
      expect((e.contagens['1h']?.lembrete_p1 ?? 0) + d.maxBolhas).toBeLessThanOrEqual(28);
      expect((e.contagens['24h']?.lembrete_p1 ?? 0) + d.maxBolhas).toBeLessThanOrEqual(150);
      vistos++;
    });
    expect(vistos).toBeGreaterThan(5);
    // E o outro lado aparece: cada regra do lembrete prende algum lembrete da
    // amostra (o motivo informado é o da trava que libera mais tarde, então a
    // existência da trava sai do oráculo).
    for (const m of ['fora_da_janela', 'rajada_lembrete', 'teto_lembrete_hora', 'teto_lembrete_dia', 'rajada_robo']) {
      const preso = decisoes.some((d, i) => d.classe === 'lembrete_p1' && d.acao !== 'enviar_agora'
        && oraculo(casos[i]!.estado, casos[i]!.pedido, casos[i]!.agora).travas.get(m) === 'sim');
      expect({ m, preso }).toEqual({ m, preso: true });
    }
  });

  it('o mesmo robô nunca passa de 6 em 10 min somando lembrete com prazo e proativa', () => {
    let vistos = 0;
    decisoes.forEach((d, i) => {
      if (d.acao !== 'enviar_agora' || !(d.classe === 'lembrete_p1' || PROATIVAS.includes(d.classe))) return;
      expect((casos[i]!.estado.doRobo10min ?? 0) + d.maxBolhas).toBeLessThanOrEqual(6);
      vistos++;
    });
    expect(vistos).toBeGreaterThan(20);
    expect(decisoes.some(d => d.acao !== 'enviar_agora' && d.motivo === 'rajada_robo' && PROATIVAS.includes(d.classe))).toBe(true);
  });

  it('nunca passa do teto do frio (6/h e 30/24h), da linha (24/h), da rajada (6 em 10 min), do total proativo (40/h) nem da emergência (60/h)', () => {
    decisoes.forEach((d, i) => {
      if (d.acao !== 'enviar_agora') return;
      const { estado: e } = casos[i]!;
      const soma = (j: JanelaContagem, ks: Classe[]) => ks.reduce((s, k) => s + (e.contagens[j]?.[k] ?? 0), 0);
      expect(soma('1h', CLASSES_TODAS) + d.maxBolhas).toBeLessThanOrEqual(60);
      if (FRIAS.includes(d.classe)) {
        expect(soma('1h', FRIAS) + d.maxBolhas).toBeLessThanOrEqual(6);
        expect(soma('24h', FRIAS) + d.maxBolhas).toBeLessThanOrEqual(30);
      }
      if (PROATIVAS.includes(d.classe)) {
        expect(soma('1h', PROATIVAS) + d.maxBolhas).toBeLessThanOrEqual(24);
        expect(soma('10min', PROATIVAS) + d.maxBolhas).toBeLessThanOrEqual(6);
        // O aviso urgente ao time (lead novo) fica fora do teto do total proativo.
        const urgente = d.classe === 'aviso_interno_p2' && CLASSE_POR_ROBO[casos[i]!.pedido.robo]?.urgente;
        if (!urgente) expect(soma('1h', CLASSES_TODAS) + d.maxBolhas).toBeLessThanOrEqual(40);
      }
    });
  });

  it('P0 nunca é bloqueado por teto: só chave repetida, freio de erro ou emergência o tiram do enviar_agora', () => {
    let vistos = 0;
    decisoes.forEach((d, i) => {
      if (d.classe !== 'evento_p0') return;
      const o = oraculo(casos[i]!.estado, casos[i]!.pedido, casos[i]!.agora);
      const permitidas = ['chave_repetida', 'freio_de_erro', 'teto_emergencia'];
      expect([...o.travas.keys()].every(m => permitidas.includes(m))).toBe(true);
      if (o.travas.size === 0) { expect(d.acao).toBe('enviar_agora'); vistos++; }
    });
    expect(vistos).toBeGreaterThan(20);
  });

  it('oráculo: a classe e as bolhas batem', () => {
    decisoes.forEach((d, i) => {
      const o = oraculo(casos[i]!.estado, casos[i]!.pedido, casos[i]!.agora);
      expect({ i, classe: d.classe }).toEqual({ i, classe: o.classe });
      if (d.acao === 'enviar_agora') expect({ i, b: d.maxBolhas }).toEqual({ i, b: o.custo });
    });
  });

  it('oráculo: todo motivo de adiar ou de caixa é verdade no estado (sem mentira)', () => {
    decisoes.forEach((d, i) => {
      if (d.acao === 'enviar_agora') return;
      const o = oraculo(casos[i]!.estado, casos[i]!.pedido, casos[i]!.agora);
      expect({ i, motivo: d.motivo, trava: o.travas.has(d.motivo) }).toEqual({ i, motivo: d.motivo, trava: true });
    });
  });

  it('oráculo: sem regra no limite, sai agora; com regra certa no limite, não sai (no limite, não abaixo)', () => {
    let livres = 0;
    let presos = 0;
    decisoes.forEach((d, i) => {
      const o = oraculo(casos[i]!.estado, casos[i]!.pedido, casos[i]!.agora);
      const certas = [...o.travas.values()].filter(v => v === 'sim').length;
      if (o.travas.size === 0) { expect({ i, acao: d.acao }).toEqual({ i, acao: 'enviar_agora' }); livres++; }
      if (certas > 0) { expect({ i, acao: d.acao }).not.toEqual({ i, acao: 'enviar_agora' }); presos++; }
    });
    // Os dois lados aparecem de verdade na amostra.
    expect(livres).toBeGreaterThan(100);
    expect(presos).toBeGreaterThan(100);
  });
});
