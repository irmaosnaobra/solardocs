import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  CLASSE_POR_ROBO, CLASSES, PRIORIDADE, ROBO_DESCONHECIDO, PREFIXOS_LEGADOS_FRIOS, ROBOS_META,
  metaDoRobo, prioridadeFina, prefixosDaLinhaDerivados, prefixosAgendaDerivados, prefixosFriosDerivados,
  divergenciasDeCarimbo, baldeDaClasse,
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
  it('só o reagenda (frio carimbando como agenda) e a remarcação reativa (conta como agenda)', () => {
    const d = divergenciasDeCarimbo().map(x => `${x.robo}:${x.prefixo}`).sort();
    expect(d).toEqual(['ep_reagenda_auto:ep_agenda_sent:', 'ep_remarcar_reativo:ep_remarcar_sent:']);
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

  it('as lotes manuais e a rota da queda de 30/08 são frio, sem classe declarada pelo operador', () => {
    expect(CLASSE_POR_ROBO.manual_lote_admin!.classe).toBe('frio_p5');
    expect(CLASSE_POR_ROBO.zapi_admin_lote!.classe).toBe('frio_p5');
    expect(CLASSE_POR_ROBO.ep_reagenda_auto!.classe).toBe('frio_p5');
    expect(CLASSE_POR_ROBO.ep_ig_convite!.classe).toBe('frio_p5');
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
