import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  CLASSE_POR_ROBO, CLASSES, PRIORIDADE, ROBO_DESCONHECIDO, PREFIXOS_LEGADOS_FRIOS, ROBOS_META,
  metaDoRobo, prioridadeFina, prefixosDaLinhaDerivados, prefixosAgendaDerivados, prefixosFriosDerivados,
  divergenciasDeCarimbo, baldeDaClasse, robosDeAgenda, ehAgendaDoPedido,
} from '../services/chefe/classes';

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE_POR_ROBO vai ser a fonte única da conta. Antes de qualquer troca, ela
// tem de dar EXATAMENTE os mesmos prefixos que o lineThrottle.ts conta hoje,
// senão a troca muda a conta sem ninguém ver (a forma das 4 quedas).
//
// Os prefixos do lineThrottle não são exportados, e não mexemos nele. Então o
// teste pergunta ao próprio lineThrottle: um supabase falso grava o `.or()` de
// cada consulta. Teto transacional = a linha inteira; teto sem transacional = o
// frio; espaçamento = a linha inteira. Agenda = linha menos frio.
// ─────────────────────────────────────────────────────────────────────────────

const capturados: string[] = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select() { return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        or(expr: string) { capturados.push(expr); return q; },
        gte() { return q; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return q;
    },
  },
}));

const prefixosDe = (expr: string): string[] =>
  expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));

const envOriginal = { ...process.env };
beforeEach(() => { capturados.length = 0; vi.resetModules(); });
afterEach(() => { process.env = { ...envOriginal }; });

async function contaDoHead(desvio: boolean): Promise<{ linha: string[]; frio: string[]; espaco: string[] }> {
  if (desvio) process.env.ZAPI_SOLARDOC_VIA_IO = '1'; else delete process.env.ZAPI_SOLARDOC_VIA_IO;
  delete process.env.LINHA_RECONECTADA_EM;
  const lt = await import('../services/agents/whatsapp/lineThrottle');
  capturados.length = 0;
  await lt.dentroDoTetoHorarioLinha({ transacional: true });
  const linha = prefixosDe(capturados[0]!);
  capturados.length = 0;
  await lt.dentroDoTetoHorarioLinha();
  const frio = prefixosDe(capturados[0]!);
  capturados.length = 0;
  await lt.respeitaEspacamentoLinha();
  const espaco = prefixosDe(capturados[0]!);
  return { linha, frio, espaco };
}

const ordenado = (xs: string[]) => [...new Set(xs)].sort();

describe('prefixos derivados = conta do lineThrottle.ts de hoje', () => {
  for (const desvio of [false, true]) {
    it(`desvio ${desvio ? 'LIGADO' : 'desligado'}: linha, frio e agenda batem como conjunto`, async () => {
      const head = await contaDoHead(desvio);
      // Controle positivo: a sonda leu de verdade (se o regex não casasse nada, tudo daria []).
      expect(head.linha.length).toBeGreaterThan(15);
      expect(head.frio.length).toBeGreaterThan(8);

      expect(ordenado(prefixosDaLinhaDerivados({ solardocViaIo: desvio }))).toEqual(ordenado(head.linha));
      expect(ordenado(prefixosFriosDerivados({ solardocViaIo: desvio }))).toEqual(ordenado(head.frio));
      expect(ordenado(head.espaco)).toEqual(ordenado(head.linha));

      const agendaHead = head.linha.filter(p => !head.frio.includes(p));
      expect(ordenado(prefixosAgendaDerivados())).toEqual(ordenado(agendaHead));
      expect(head.linha.includes('carla_sent:')).toBe(desvio);
    });
  }

  it('nenhum prefixo cai nos dois baldes', () => {
    const agenda = new Set(prefixosAgendaDerivados());
    for (const p of prefixosFriosDerivados({ solardocViaIo: true })) expect(agenda.has(p)).toBe(false);
  });

  it('os legados são só frio e nenhum robô vivo carimba com eles', () => {
    const vivos = new Set(Object.values(CLASSE_POR_ROBO).flatMap(r => r.carimbos.map(c => c.prefixo)));
    for (const p of PREFIXOS_LEGADOS_FRIOS) expect(vivos.has(p)).toBe(false);
  });
});

describe('divergências de carimbo (dívidas da migração, fixadas pelo nome)', () => {
  it('só a remarcação reativa (conta como agenda); o reagenda saiu da lista quando virou agenda (07/10)', () => {
    // O reagenda carimba ep_agenda_sent:<id>:reagendado, que o HEAD conta como
    // agenda. Era divergência enquanto ele era frio; desde a regra do dono de
    // 07/10 (agenda nunca bloqueia) ele é transacional de agenda e o carimbo bate.
    const d = divergenciasDeCarimbo().map(x => `${x.robo}:${x.prefixo}`).sort();
    expect(d).toEqual(['ep_remarcar_reativo:ep_remarcar_sent:']);
  });

  it('o balde da classe segue a regra de 17/09 e 23/09', () => {
    expect(baldeDaClasse('frio_p5')).toBe('frio');
    expect(baldeDaClasse('frio_receita_p4')).toBe('frio');
    expect(baldeDaClasse('transacional_agenda_p3')).toBe('agenda');
    expect(baldeDaClasse('reativo_p1')).toBeNull();
  });
});

describe('CLASSE_POR_ROBO: forma de cada robô', () => {
  const robos = Object.entries(CLASSE_POR_ROBO);

  it('todo arquivo citado existe no HEAD', () => {
    const raiz = join(__dirname, '..');
    for (const [nome, r] of [...robos, ...Object.entries(ROBOS_META)]) {
      expect(r.arquivos.length, nome).toBeGreaterThan(0);
      for (const a of r.arquivos) expect(existsSync(join(raiz, a)), `${nome} → ${a}`).toBe(true);
    }
  });

  it('frio respeita a pausa, mora na janela do frio, sai em 1 bolha de até 900 e nunca vira P1 pelo prazo', () => {
    for (const [nome, r] of robos) {
      if (r.classe !== 'frio_p5' && r.classe !== 'frio_receita_p4') continue;
      expect({ nome, pausa: r.respeitaPausa, janela: r.janela, bolhas: r.maxBolhas, chars: r.maxCaracteres, prazo: r.podeTerPrazo })
        .toEqual({ nome, pausa: true, janela: 'frio', bolhas: 1, chars: 900, prazo: false });
    }
  });

  it('fora do frio, a pausa humana segue o HEAD robô a robô: só a Duda, a cobrança do SIM, a Giovanna e as boas-vindas', () => {
    // recepcaoIo.ts (Duda), sendFrio (cobrança do SIM, zapiClient.ts:280-291),
    // solarAgendaGiovanna.ts:320 e solarBoasVindas.ts:506. Mexer nesta lista é
    // mudar quem fala com humano dentro da conversa: passa pela DIVERGENCIAS.
    const naoFrios = robos.filter(([, r]) => r.classe !== 'frio_p5' && r.classe !== 'frio_receita_p4');
    expect(naoFrios.filter(([, r]) => r.respeitaPausa).map(([n]) => n).sort())
      .toEqual(['duda_recepcao', 'ep_cobra_sim', 'giovanna_agenda', 'solar_agente_quiz', 'solar_boas_vindas']);
  });

  it('evento nasce de evento e sai em 1 bolha; só reativo tem 2 bolhas', () => {
    for (const [nome, r] of robos) {
      if (r.classe === 'evento_p0') expect({ nome, ev: r.nasceDeEvento, b: r.maxBolhas }).toEqual({ nome, ev: true, b: 1 });
      expect(r.maxBolhas, nome).toBe(r.classe === 'reativo_p1' ? 2 : 1);
    }
  });

  it('nenhum robô nasce como lembrete_p1: P1 de agenda é sempre pelo prazo', () => {
    for (const [, r] of robos) expect(r.classe).not.toBe('lembrete_p1');
    const comPrazo = robos.filter(([, r]) => r.podeTerPrazo).map(([n]) => n).sort();
    expect(comPrazo).toEqual(['ep_agenda', 'ep_alerta_10min', 'ep_cobra_sim', 'giovanna_agenda', 'solar_boas_vindas']);
  });

  it('os robôs da limpeza não entram', () => {
    for (const [nome] of robos) {
      expect(nome).not.toMatch(/gerador_seq|broadcast|luma|repescagem|convite_inv|grupo_frio|estudo|top_pontos|mcp|test_send/);
    }
  });

  it('o lote manual e a rota da queda de 30/08 são frio, sem classe declarada pelo operador', () => {
    expect(CLASSE_POR_ROBO.zapi_admin_lote!.classe).toBe('frio_p5');
    expect(CLASSE_POR_ROBO.ep_ig_convite!.classe).toBe('frio_p5');
    // O lote do admin.ts (/admin/io/send-text e broadcasts) saiu na limpeza, e o robô dele também.
    expect(metaDoRobo('manual_lote_admin')).toBeNull();
  });

  // [regra do dono, 07/10] AGENDA NUNCA BLOQUEIA. A lista é fixada pelo nome:
  // pôr ou tirar um robô dela muda o que nenhum freio de volume segura.
  it('os robôs de agenda são os da regra do dono; as boas-vindas do solar não são agenda', () => {
    expect(robosDeAgenda()).toEqual(['ep_agenda', 'ep_alerta_10min', 'ep_cobra_sim', 'ep_reagenda_auto', 'ep_remarcar_reativo', 'giovanna_agenda']);
    expect(CLASSE_POR_ROBO.solar_boas_vindas!.agenda).toBe(false);
    expect(ROBO_DESCONHECIDO.agenda).toBe(false);
    // Nenhum frio, evento ou robô de lote é agenda.
    for (const [nome, r] of robos) {
      if (r.classe === 'frio_p5' || r.classe === 'frio_receita_p4' || r.classe === 'evento_p0' || r.roboDeLote) {
        expect({ nome, agenda: r.agenda }).toEqual({ nome, agenda: false });
      }
    }
    // O pedido de robô de agenda que caiu para frio deixa de ser agenda.
    expect(ehAgendaDoPedido(CLASSE_POR_ROBO.ep_alerta_10min!, 'lembrete_p1')).toBe(true);
    expect(ehAgendaDoPedido(CLASSE_POR_ROBO.ep_alerta_10min!, 'frio_p5')).toBe(false);
    expect(ehAgendaDoPedido(CLASSE_POR_ROBO.solar_boas_vindas!, 'lembrete_p1')).toBe(false);
  });

  it('a remarcação do NÃO ATENDEU é agenda do dia: transacional, cadência própria de 15 min, sem prazo, abaixo da agenda do dia', () => {
    const r = CLASSE_POR_ROBO.ep_reagenda_auto!;
    expect({ classe: r.classe, agenda: r.agenda, cadencia: r.cadenciaPropria, prazo: r.podeTerPrazo, pausa: r.respeitaPausa, bolhas: r.maxBolhas })
      .toEqual({ classe: 'transacional_agenda_p3', agenda: true, cadencia: true, prazo: false, pausa: false, bolhas: 1 });
    expect(r.subprioridade).toBeGreaterThan(CLASSE_POR_ROBO.ep_agenda!.subprioridade);
    expect(robos.filter(([, x]) => x.cadenciaPropria).map(([n]) => n)).toEqual(['ep_reagenda_auto']);
  });

  it('robô de 1 destino por chamada aponta para um robô de lote que existe e é frio', () => {
    const comLote = robos.filter(([, r]) => r.roboDeLote !== null);
    expect(comLote.map(([n]) => n)).toEqual(['manual_crm']);
    for (const [nome, r] of comLote) {
      const lote = metaDoRobo(r.roboDeLote!);
      expect({ nome, existe: lote !== null, classe: lote?.classe, encadeia: lote?.roboDeLote ?? null })
        .toEqual({ nome, existe: true, classe: 'frio_p5', encadeia: null });
    }
  });

  it('só o cartão de agendamento é robô de grupo; nenhum robô declara classe para lead hoje', () => {
    // Robô de grupo: para ele, grupo é destino interno. Os outros só com o grupo
    // na lista explícita (o grupo do eletroposto tem lead dentro).
    expect(robos.filter(([, r]) => r.roboDeGrupo).map(([n]) => n)).toEqual(['sdr_grupo_interno']);
    // Todo aviso de hoje vai para equipe, dono ou consultor (o alerta de 10 min
    // "não fala com o lead", eletropostoAlerta10min.ts:39). Quando um robô
    // precisar, a classe com lead é transacional ou frio, nunca urgente nem aviso.
    for (const [nome, r] of robos) {
      expect({ nome, c: r.classeComLead }).toEqual({ nome, c: null });
    }
    expect(ROBO_DESCONHECIDO.roboDeGrupo).toBe(false);
  });

  it('robô sem registro é frio; nome de protótipo não vira robô', () => {
    expect(ROBO_DESCONHECIDO.classe).toBe('frio_p5');
    expect(metaDoRobo('robo_que_nao_existe')).toBeNull();
    expect(metaDoRobo('toString')).toBeNull();
    expect(metaDoRobo('ep_agenda')!.classe).toBe('transacional_agenda_p3');
  });

  it('prioridade: evento antes de tudo, frio de receita antes do frio, subprioridade desempata', () => {
    expect(CLASSES.map(c => PRIORIDADE[c])).toEqual([0, 1, 1, 2, 3, 4, 5]);
    expect(prioridadeFina('frio_receita_p4', 3)).toBeLessThan(prioridadeFina('frio_p5', 1));
    expect(prioridadeFina('frio_p5', 2)).toBeLessThan(prioridadeFina('frio_p5', 6));
  });
});
