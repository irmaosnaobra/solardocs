import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 24/10/2026, ordem do dono: SÓ A NILCE ATENDE SOLAR, e todo lead NOVO de solar
// vai para ela, por ligação, seja qual for o tamanho da conta. Este arquivo trava
// a regra de ponta a ponta e, do outro lado, trava que o ELETROPOSTO não andou.

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => ({}) } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn().mockResolvedValue(false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { limparRespostas, decidirEMontar, msDe } from '../services/io/solarQuiz';
import {
  decidirCaminho, caminhoPelasRespostas, donoDaFaixa, DONAS_LIGACAO, PONTOS_VISITA, RAIO_VISITA_KM, reservaDe,
} from '../services/agenda/solarRota';
import { FILA_CONTA_ALTA } from '../services/agenda/leadSolarFicha';
import { donoDaVolta } from '../services/agenda/reagendaSolarNaoAtendido';
import { TEL_AVISO, EQUIPE as EQUIPE_SOLAR } from '../routes/ioSolar';

const AGORA = msDe('2026-10-26', '07:00');   // segunda-feira
// Nota 95: prazo 35, decisor 20, pagamento 20, imóvel 15, orçamento 5 (já tem outro orçamento = 'nao').
const NOTA_95 = { urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'nao', tipo: 'casa' };

describe('lead novo de solar: todos para a Nilce, por ligação', () => {
  // As faixas do quiz que representam ~250 kWh (a menor), ~800 kWh e ~2.000 kWh ou mais.
  const casos = [
    { rotulo: 'até 300 kWh (a faixa de ~250)', conta: 'ate300' },
    { rotulo: '~800 kWh', conta: '600_1050' },
    { rotulo: '2.000 kWh ou mais', conta: '2000_5000' },
  ];

  for (const c of casos) {
    it(`${c.rotulo}, nota 95, em Uberlândia (dentro dos ${RAIO_VISITA_KM} km): ligação da Nilce`, () => {
      const r = limparRespostas({ conta: c.conta, cidade: 'Uberlândia', ...NOTA_95 });
      const dec = decidirCaminho(r);
      expect(dec.pontos).toBe(95);
      expect(dec.pontos).toBeGreaterThan(PONTOS_VISITA);
      expect(dec).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
      expect(dec.treino).toBeFalsy();
      // Nem o sorteio por telefone nem a reserva mandam ninguém para outra pessoa.
      expect(decidirCaminho(r, null, '34999990001').candidatos).toEqual(['Nilce']);
      expect(caminhoPelasRespostas(r, '34999990002').candidatos).toEqual(['Nilce']);
      expect(reservaDe(dec)).toBeNull();
      expect(donoDaFaixa(dec.kwh)).toBe('Nilce');
    });

    it(`${c.rotulo}: a vitrine só tem horário da Nilce, mesmo com Thiago e Diego livres`, () => {
      const r = limparRespostas({ conta: c.conta, cidade: 'Uberlândia', ...NOTA_95 });
      const v = decidirEMontar(r, null, [], AGORA);
      expect(v.semHorario).toBe(false);
      expect(v.dias.length).toBeGreaterThan(0);
      for (const d of v.dias) for (const h of d.horas) expect(h.dono).toBe('Nilce');
    });
  }

  it('a conta grande dentro do raio guarda a visita só como informação, sem campo novo', () => {
    const grande = decidirCaminho(limparRespostas({ conta: '2000_5000', cidade: 'Uberlândia', ...NOTA_95 }));
    expect(grande.qualifica).toBe('vistoria');
    expect(grande.grande).toBe(true);
    expect(decidirCaminho(limparRespostas({ conta: 'ate300', cidade: 'Uberlândia', ...NOTA_95 })).qualifica).toBeNull();
  });

  it('curioso continua curioso, sem agenda', () => {
    const r = limparRespostas({ conta: '2000_5000', cidade: 'Uberlândia', urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado', tipo: 'casa' });
    expect(decidirCaminho(r)).toMatchObject({ caminho: 'curioso', candidatos: [] });
  });

  it('o cliente que é da Giovanna entra como cliente novo: cai na Nilce', () => {
    const r = limparRespostas({ conta: 'ate300', cidade: 'Uberlândia', ...NOTA_95 });
    expect(decidirCaminho(r, 'Giovanna')).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
  });

  it('a fila da conta alta (formulário do Meta, ManyChat, página da agenda) só tem a Nilce', () => {
    expect(FILA_CONTA_ALTA).toEqual(['Nilce']);
  });
});

describe('quem faz parte da agenda do quiz (DONAS_LIGACAO)', () => {
  it('no solar, só a Nilce: a Giovanna saiu', () => {
    expect([...DONAS_LIGACAO]).toEqual(['Nilce']);
  });
});

describe('o aviso da ficha do quiz chega na Nilce (TEL_AVISO)', () => {
  it('a Nilce tem telefone no mapa, o que já existe no código', () => {
    expect(TEL_AVISO.nilce).toBe('34991516846');
    expect(EQUIPE_SOLAR.nilce).toBe('34991516846');
  });
  it('o aviso a uma pessoa escolhida pelo nome não vem vazio para a Nilce, e o filter(Boolean) não a descarta', () => {
    const alvos = [TEL_AVISO['Nilce'.toLowerCase()]].filter(Boolean);
    expect(alvos).toEqual(['34991516846']);
  });
});

describe('o NÃO ATENDEU da Nilce não volta mais para a Giovanna', () => {
  it('sem nenhuma env, a Nilce fica com a Nilce e a Giovanna passa para a Nilce', () => {
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON;
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_OFF;
    expect(donoDaVolta('Nilce', 'nao_atendeu')).toBe('Nilce');
    expect(donoDaVolta('Giovanna', 'nao_atendeu')).toBe('Nilce');
    expect(donoDaVolta('Thiago', 'nao_atendeu')).toBe('Thiago');
    expect(donoDaVolta('Diego', 'nao_atendeu')).toBe('Diego');
  });
});

describe('o eletroposto continua com o roteamento de antes', () => {
  const SRC = join(__dirname, '..');
  const lerImports = (arq: string) => readFileSync(arq, 'utf8').split(/\r?\n/).filter(l => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /require\(/.test(l));
  const arquivosEletroposto = (): string[] => ['services/io', 'services/agenda', 'routes'].flatMap(pasta =>
    readdirSync(join(SRC, pasta)).filter(f => /^eletroposto.*\.ts$/i.test(f) || /^ioEletroposto.*\.ts$/.test(f) || /^geradorEletroposto.*\.ts$/.test(f))
      .map(f => join(SRC, pasta, f)));

  it('nenhum arquivo de eletroposto lê o roteamento do solar que mudou', () => {
    const arquivos = arquivosEletroposto();
    expect(arquivos.length).toBeGreaterThan(10);
    const proibido = /['"][^'"]*\/(solarRota|leadSolarFicha|reagendaSolarNaoAtendido)['"]/;
    for (const arq of arquivos) {
      for (const linha of lerImports(arq)) expect(linha, arq).not.toMatch(proibido);
    }
  });

  it('o EQUIPE do eletroposto segue sendo só Thiago e Diego', async () => {
    const { EQUIPE } = await import('../routes/ioEletroposto');
    expect(Object.keys(EQUIPE).sort()).toEqual(['diego', 'thiago']);
  });

  it('o card de eletroposto continua valendo 30 min (15 na faixa de remarcação), como antes', async () => {
    const { blocoDaFicha } = await import('../services/io/solarQuiz');
    const dur = (a: Record<string, unknown>) => { const b = blocoDaFicha(a as never)!; return (b.fim - b.ini) / 60000; };
    expect(dur({ quando: '2026-10-26T14:00:00-03:00', created_by: 'lp_eletroposto', vendedor_nome: 'Diego' })).toBe(30);
    expect(dur({ quando: '2026-10-26T14:15:00-03:00', created_by: 'lp_eletroposto', vendedor_nome: 'Diego' })).toBe(15);
  });

  it('a tabela de destino do eletroposto na recepção e na sentinela segue Thiago e Diego', () => {
    for (const arq of ['recepcaoIo.ts', 'sentinelaVacuo.ts']) {
      const src = readFileSync(join(SRC, 'services', 'io', arq), 'utf8');
      expect(src).toMatch(/eletroposto:\s*\['thiago', 'diego'\]/);
      expect(src).toMatch(/solar:\s*\['nilce'\]/);
      expect(src).toMatch(/solardoc:\s*\['thiago'\]/);
    }
  });
});
