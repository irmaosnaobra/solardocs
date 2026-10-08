import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  REGULAMENTO_PADRAO, REGULAMENTO_BASE, lerRegulamento, degrauDaRampa, rampaForcadaDaEnv,
  dentroDaJanela, proximaAbertura, DIVERGENCIAS,
} from '../services/chefe/regulamento';

// ─────────────────────────────────────────────────────────────────────────────
// O regulamento do CHEFE é a régua. Este teste tranca três coisas:
//   1. os números padrão (os do lineThrottle.ts do HEAD onde ele tem número);
//   2. a env SÓ APERTA, nos dois sentidos (teto desce, espaçamento sobe);
//   3. o núcleo é puro: nada de banco, logger, env, relógio ou sorteio dentro de
//      services/chefe. Sem isso o mesmo estado poderia dar duas decisões.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60_000;
const HORA = 60 * MIN;
const brt = (s: string): number => Date.parse(`${s}:00-03:00`);

describe('regulamento: números padrão', () => {
  it('frio 6/h e 30/24h (40 menos a reserva de 10), como o HEAD', () => {
    expect(REGULAMENTO_PADRAO.frioPorHora).toBe(6);
    expect(REGULAMENTO_PADRAO.linhaDiaBase).toBe(40);
    expect(REGULAMENTO_PADRAO.reservaTransacionalDia).toBe(10);
    expect(REGULAMENTO_PADRAO.frioPorDia).toBe(30);
  });

  it('janela do frio 9h–20h sem domingo; transacional 7h–21h todo dia', () => {
    expect(REGULAMENTO_PADRAO.janelaFrio).toEqual({ inicioH: 9, fimH: 20, domingo: false });
    expect(REGULAMENTO_PADRAO.janelaTransacional).toEqual({ inicioH: 7, fimH: 21, domingo: true });
  });

  it('linha de P2 a P5 em 24/h e 200/24h; emergência 60/h e 450/24h; proativo para em 40 no total', () => {
    expect(REGULAMENTO_PADRAO.linhaHora).toBe(24);
    expect(REGULAMENTO_PADRAO.linhaDia).toBe(200);
    expect(REGULAMENTO_PADRAO.emergenciaHora).toBe(60);
    expect(REGULAMENTO_PADRAO.emergenciaDia).toBe(450);
    expect(REGULAMENTO_PADRAO.totalProativoHora).toBe(40);
  });

  it('espaçamento do frio 10 min + até 5 min; rajada 6 em 10 min (proativa e, à parte, lembrete com prazo); sustentado 40/3h e 60/6h', () => {
    expect(REGULAMENTO_PADRAO.espacoFrioMs).toBe(10 * MIN);
    expect(REGULAMENTO_PADRAO.jitterFrioMs).toBe(5 * MIN);
    expect(REGULAMENTO_PADRAO.rajadaMaxProativas).toBe(6);
    expect(REGULAMENTO_PADRAO.rajadaMaxLembrete).toBe(6);
    expect(REGULAMENTO_PADRAO.rajadaJanelaMs).toBe(10 * MIN);
    expect(REGULAMENTO_PADRAO.sustentado3h).toBe(40);
    expect(REGULAMENTO_PADRAO.sustentado6h).toBe(60);
  });

  it('rajada por robô de 6 em 10 min e teto próprio do lembrete de 28/h e 150/24h, os dois só para o que não é agenda', () => {
    expect(REGULAMENTO_PADRAO.rajadaMaxPorRobo).toBe(6);
    expect(REGULAMENTO_PADRAO.lembreteHora).toBe(28);
    expect(REGULAMENTO_PADRAO.lembreteDia).toBe(150);
    // A regra do dono (07/10) tirou o teto próprio da agenda, e a rodada 4 tirou
    // a rajada por robô: está escrito.
    expect(DIVERGENCIAS.some(d => /lembrete com prazo/.test(d) && /não é agenda/.test(d))).toBe(true);
    expect(DIVERGENCIAS.some(d => /AGENDA NUNCA BLOQUEIA/.test(d) && /rajada por robô NÃO para mais a agenda/.test(d))).toBe(true);
  });

  it('agenda nunca bloqueia: margem de 3 min antes do fim útil, cadência de 15 min da remarcação, reserva de 10 na emergência, resposta segurada por até 2h', () => {
    const r = REGULAMENTO_PADRAO;
    expect(r.agendaMargemUtilMs).toBe(3 * 60_000);
    expect(r.cadenciaPropriaMs).toBe(15 * 60_000);
    expect(r.reservaEmergenciaHora).toBe(10);
    expect(r.reativoEsperaMaxMs).toBe(2 * 60 * 60_000);
    expect(DIVERGENCIAS.some(d => /AGENDA NUNCA BLOQUEIA/.test(d))).toBe(true);
    expect(DIVERGENCIAS.some(d => /Pausa humana na agenda/.test(d) && /dono decidir/.test(d))).toBe(true);
    // Env só aperta: a reserva e a cadência só sobem.
    expect(lerRegulamento({ CHEFE_RESERVA_EMERGENCIA_HORA: '3', CHEFE_CADENCIA_PROPRIA_MIN: '5' }).reg).toMatchObject({ reservaEmergenciaHora: 10, cadenciaPropriaMs: 15 * 60_000 });
  });

  it('1 toque = 1 mensagem: frio, transacional, aviso e evento em 1; resposta em 2; Pix em bolha própria', () => {
    const r = REGULAMENTO_PADRAO;
    expect([r.bolhasFrio, r.bolhasTransacional, r.bolhasAviso, r.bolhasEvento]).toEqual([1, 1, 1, 1]);
    expect(r.bolhasReativo).toBe(2);
    expect(r.bolhaExtraPix).toBe(1);
    expect(r.caracteresFrio).toBe(900);
    expect(r.caracteresTransacional).toBe(1200);
    expect(r.toquesMudo).toBe(3);
  });

  it('rampa do HEAD no frio (2, 3, 4 por hora) e 40/60/80% da linha para P3–P5', () => {
    expect(REGULAMENTO_PADRAO.rampa.map(d => d.frioHora)).toEqual([2, 3, 4]);
    expect(REGULAMENTO_PADRAO.rampa.map(d => d.dia)).toEqual([10, 20, 30]);
    expect(REGULAMENTO_PADRAO.rampa.map(d => d.linhaHora)).toEqual([10, 14, 19]);
    expect(REGULAMENTO_PADRAO.rampa.map(d => d.linhaDia)).toEqual([80, 120, 160]);
  });

  it('as divergências com a memória e com a especificação estão escritas', () => {
    expect(DIVERGENCIAS.length).toBeGreaterThanOrEqual(10);
    expect(DIVERGENCIAS.some(d => /09h–20h/.test(d))).toBe(true);
    // A pausa humana segue o HEAD robô a robô: as duas mudanças contra a memória e contra o HEAD estão escritas.
    expect(DIVERGENCIAS.some(d => /lembrete da Giovanna/.test(d) && /Vale o HEAD/.test(d))).toBe(true);
    expect(DIVERGENCIAS.some(d => /frio da linha solardoc/.test(d) && /Aperto novo/.test(d))).toBe(true);
  });
});

describe('regulamento: env só aperta', () => {
  it('teto por hora do frio: menor vale, maior é ignorado e registrado', () => {
    expect(lerRegulamento({ LINHA_MAX_HORA: '4' }).reg.frioPorHora).toBe(4);
    const solto = lerRegulamento({ LINHA_MAX_HORA: '12' });
    expect(solto.reg.frioPorHora).toBe(6);
    expect(solto.ignorados.join()).toMatch(/LINHA_MAX_HORA=12/);
  });

  it('teto zero, negativo ou texto é ignorado (não vira "sem teto")', () => {
    for (const v of ['0', '-3', 'abc']) {
      const l = lerRegulamento({ LINHA_MAX_HORA: v });
      expect(l.reg.frioPorHora).toBe(6);
      expect(l.ignorados.length).toBe(1);
    }
  });

  it('LINHA_MAX_DIA deixa de ser botão de acelerar: só desce', () => {
    expect(lerRegulamento({ LINHA_MAX_DIA: '30' }).reg.frioPorDia).toBe(20);
    expect(lerRegulamento({ LINHA_MAX_DIA: '100' }).reg.frioPorDia).toBe(30);
  });

  it('reserva só cresce (aperta o frio)', () => {
    expect(lerRegulamento({ LINHA_RESERVA_TRANSACIONAL: '15' }).reg.frioPorDia).toBe(25);
    const l = lerRegulamento({ LINHA_RESERVA_TRANSACIONAL: '5' });
    expect(l.reg.frioPorDia).toBe(30);
    expect(l.ignorados.length).toBe(1);
  });

  it('espaçamento e sorteio só crescem', () => {
    expect(lerRegulamento({ ESPACAMENTO_MIN_MS: String(20 * MIN) }).reg.espacoFrioMs).toBe(20 * MIN);
    expect(lerRegulamento({ ESPACAMENTO_MIN_MS: String(6 * MIN) }).reg.espacoFrioMs).toBe(10 * MIN);
    expect(lerRegulamento({ ESPACAMENTO_JITTER_MS: String(MIN) }).reg.jitterFrioMs).toBe(5 * MIN);
  });

  it('janela só fecha: início mais tarde e fim mais cedo valem; o contrário não', () => {
    expect(lerRegulamento({ JANELA_INICIO_H: '10', JANELA_FIM_H: '19' }).reg.janelaFrio).toEqual({ inicioH: 10, fimH: 19, domingo: false });
    expect(lerRegulamento({ JANELA_INICIO_H: '8', JANELA_FIM_H: '21' }).reg.janelaFrio).toEqual({ inicioH: 9, fimH: 20, domingo: false });
  });

  it('janela que fecharia antes de abrir é ignorada', () => {
    const l = lerRegulamento({ JANELA_INICIO_H: '15', JANELA_FIM_H: '12' });
    expect(l.reg.janelaFrio.fimH).toBeGreaterThan(l.reg.janelaFrio.inicioH);
    expect(l.ignorados.join()).toMatch(/JANELA_FIM_H/);
  });

  it('pausa humana só fica mais longa', () => {
    expect(lerRegulamento({ PAUSA_HUMANA_JANELA_H: '48' }).reg.pausaSilencioMs).toBe(48 * HORA);
    expect(lerRegulamento({ PAUSA_HUMANA_JANELA_H: '12' }).reg.pausaSilencioMs).toBe(24 * HORA);
  });

  it('tetos novos do CHEFE só descem', () => {
    const l = lerRegulamento({ CHEFE_LINHA_HORA: '30', CHEFE_LINHA_DIA: '150', CHEFE_EMERGENCIA_HORA: '90', CHEFE_RAJADA_10MIN: '4' });
    expect(l.reg.linhaHora).toBe(24);
    expect(l.reg.linhaDia).toBe(150);
    expect(l.reg.emergenciaHora).toBe(60);
    expect(l.reg.rajadaMaxProativas).toBe(4);
    expect(l.ignorados.length).toBe(2);
    expect(lerRegulamento({ CHEFE_RAJADA_LEMBRETE_10MIN: '4' }).reg.rajadaMaxLembrete).toBe(4);
    const novos = lerRegulamento({ CHEFE_RAJADA_ROBO_10MIN: '4', CHEFE_LEMBRETE_HORA: '20', CHEFE_LEMBRETE_DIA: '300' });
    expect([novos.reg.rajadaMaxPorRobo, novos.reg.lembreteHora, novos.reg.lembreteDia]).toEqual([4, 20, 150]);
    expect(novos.ignorados.join()).toMatch(/CHEFE_LEMBRETE_DIA=300/);
    const solta = lerRegulamento({ CHEFE_RAJADA_LEMBRETE_10MIN: '20' });
    expect(solta.reg.rajadaMaxLembrete).toBe(6);
    expect(solta.ignorados.join()).toMatch(/CHEFE_RAJADA_LEMBRETE_10MIN=20/);
  });

  it('os interruptores do HEAD que afrouxam são ignorados e registrados', () => {
    const l = lerRegulamento({ JANELA_DIURNA_OFF: '1', JANELA_DOMINGO_ON: '1', ESPACAMENTO_OFF: '1' });
    expect(l.reg.janelaFrio.domingo).toBe(false);
    expect(l.reg.espacoFrioMs).toBe(10 * MIN);
    expect(l.ignorados.length).toBe(3);
  });

  it('sem env nenhuma: regulamento igual ao base e nada ignorado', () => {
    const l = lerRegulamento({});
    expect(l.ignorados).toEqual([]);
    expect(l.reg.frioPorHora).toBe(REGULAMENTO_BASE.frioPorHora);
  });
});

describe('regulamento: rampa e janela', () => {
  const t0 = brt('2026-10-03T14:47');

  it('degrau por dia corrido desde a volta; some depois de 3 dias', () => {
    expect(degrauDaRampa(REGULAMENTO_PADRAO, null, t0)).toBeNull();
    expect(degrauDaRampa(REGULAMENTO_PADRAO, t0, t0 + 12 * HORA)!.frioHora).toBe(2);
    expect(degrauDaRampa(REGULAMENTO_PADRAO, t0, t0 + 36 * HORA)!.frioHora).toBe(3);
    expect(degrauDaRampa(REGULAMENTO_PADRAO, t0, t0 + 60 * HORA)!.frioHora).toBe(4);
    expect(degrauDaRampa(REGULAMENTO_PADRAO, t0, t0 + 73 * HORA)).toBeNull();
    expect(degrauDaRampa(REGULAMENTO_PADRAO, t0 + HORA, t0)!.frioHora).toBe(2); // marca no futuro = dia 0
  });

  it('LINHA_RECONECTADA_EM com data curta vira meia-noite de Brasília, como no HEAD', () => {
    expect(rampaForcadaDaEnv({ LINHA_RECONECTADA_EM: '2026-10-03' })).toBe(Date.parse('2026-10-03T00:00:00-03:00'));
    expect(rampaForcadaDaEnv({ LINHA_RECONECTADA_EM: ' ' })).toBeNull();
    expect(rampaForcadaDaEnv({ LINHA_RECONECTADA_EM: 'lixo' })).toBeNull();
    expect(rampaForcadaDaEnv({})).toBeNull();
  });

  it('frio: sábado 20h01 e domingo 10h fecham; a próxima abertura é segunda 9h', () => {
    const j = REGULAMENTO_PADRAO.janelaFrio;
    expect(dentroDaJanela(j, brt('2026-10-03T20:01'))).toBe(false);
    expect(dentroDaJanela(j, brt('2026-10-04T10:00'))).toBe(false);
    expect(proximaAbertura(j, brt('2026-10-03T20:01'))).toBe(brt('2026-10-05T09:00'));
    expect(proximaAbertura(j, brt('2026-10-04T10:00'))).toBe(brt('2026-10-05T09:00'));
  });

  it('frio: 8h59 de sexta abre às 9h do mesmo dia; 9h em ponto já está aberta', () => {
    const j = REGULAMENTO_PADRAO.janelaFrio;
    expect(proximaAbertura(j, brt('2026-10-02T08:59'))).toBe(brt('2026-10-02T09:00'));
    expect(dentroDaJanela(j, brt('2026-10-02T09:00'))).toBe(true);
    expect(dentroDaJanela(j, brt('2026-10-02T19:59'))).toBe(true);
    expect(dentroDaJanela(j, brt('2026-10-02T20:00'))).toBe(false);
  });

  it('transacional abre no domingo às 7h e fecha às 21h', () => {
    const j = REGULAMENTO_PADRAO.janelaTransacional;
    expect(dentroDaJanela(j, brt('2026-10-04T10:00'))).toBe(true);
    expect(proximaAbertura(j, brt('2026-10-04T21:30'))).toBe(brt('2026-10-05T07:00'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pureza: services/chefe não importa nada de fora da pasta e não toca em env,
// relógio, sorteio, rede nem log. A mesma varredura roda sobre um texto sujo e
// TEM de achar tudo, senão um regex que não casa nada passaria verde.
// ─────────────────────────────────────────────────────────────────────────────

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function impurezas(src: string): string[] {
  const code = semComentarios(src);
  const achados: string[] = [];
  for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (!m[1]!.startsWith('./')) achados.push(`import de fora: ${m[1]}`);
  }
  for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) achados.push(`require: ${m[1]}`);
  const proibidos: Array<[RegExp, string]> = [
    [/process\.env/, 'process.env'],
    [/Date\.now\s*\(/, 'Date.now()'],
    [/new Date\(\s*\)/, 'new Date() sem argumento'],
    [/Math\.random\s*\(/, 'Math.random()'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bconsole\./, 'console'],
    [/\bsupabase\b/, 'supabase'],
    [/\blogger\b/, 'logger'],
    [/\bawait\b/, 'await'],
  ];
  for (const [re, nome] of proibidos) if (re.test(code)) achados.push(nome);
  return achados;
}

describe('núcleo puro', () => {
  const pasta = join(__dirname, '..', 'services', 'chefe');
  const arquivos = readdirSync(pasta).filter(f => f.endsWith('.ts'));

  it('nenhum arquivo de services/chefe importa de fora da pasta nem toca em env, relógio, sorteio, rede ou log', () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(3);
    for (const f of arquivos) {
      expect({ arquivo: f, impurezas: impurezas(readFileSync(join(pasta, f), 'utf8')) }).toEqual({ arquivo: f, impurezas: [] });
    }
  });

  it('controle positivo: a varredura acha cada impureza num texto sujo', () => {
    const sujo = [
      "import { supabase } from '../../utils/supabase';",
      "import { logger } from '../../utils/logger';",
      'const x = process.env.LINHA_MAX_HORA;',
      'const t = Date.now();',
      'const d = new Date();',
      'const s = Math.random();',
      "await fetch('https://exemplo.invalid');",
      "console.log('oi');",
    ].join('\n');
    const achados = impurezas(sujo);
    for (const esperado of ['import de fora: ../../utils/supabase', 'process.env', 'Date.now()', 'new Date() sem argumento', 'Math.random()', 'fetch', 'console', 'supabase', 'logger', 'await']) {
      expect(achados).toContain(esperado);
    }
  });

  it('comentário falando de process.env não conta (o regulamento explica que não lê a env)', () => {
    expect(impurezas('// lerRegulamento(process.env)\n/* Date.now() */\nexport const a = 1;')).toEqual([]);
  });
});
