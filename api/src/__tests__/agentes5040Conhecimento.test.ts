import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const mp = vi.hoisted(() => ({
  transcribeAudio: vi.fn(),
  downloadImageAsAnthropicSource: vi.fn(),
  downloadPdfAsAnthropicSource: vi.fn(),
}));
vi.mock('../utils/mediaProcessor', () => mp);

import { PRODUTOS } from '../services/produtos/catalogo';
import { AVULSOS, PLANO_MENSAL, VALORES_PERMITIDOS_CARLA, textoConhecimentoSolarDoc } from '../services/agentes5040/conhecimento/solardoc';
import { FRASES_PUBLICAS_SOLAR, textoConhecimentoSolar } from '../services/agentes5040/conhecimento/solar';
import {
  MODELOS_ELETROPOSTO, PAGAMENTO_ELETROPOSTO, VALORES_PUBLICOS_ELETROPOSTO, textoConhecimentoEletroposto,
} from '../services/agentes5040/conhecimento/eletroposto';
import { DEPOIMENTOS, cardsParaLead, regiaoDaUF } from '../services/agentes5040/conhecimento/depoimentos';
import { chaveHmac, hmacDe } from '../services/agentes5040/hmac';
import { diaBRT, horaBRT, horarioComercial, carimboBR } from '../services/agentes5040/relogio';
import { prepararMidia, MAX_MIDIAS_POR_TURNO, type CacheMidia } from '../services/agentes5040/midia';
import { msg } from './_agentes5040Util';

const DASHBOARD = join(__dirname, '..', '..', '..', 'dashboard');
const ler = (...p: string[]) => readFileSync(join(DASHBOARD, ...p), 'utf8');

describe('conhecimento: SolarDoc bate com o catálogo', () => {
  it('os avulsos têm os preços do catálogo: 27, 97, 67, 67', () => {
    const precos = Object.fromEntries(AVULSOS.map(a => [a.id, a.preco]));
    expect(precos).toEqual({ 'curso-fechamento': 27, offgrid: 97, precificacao: 67, inventario: 67 });
    for (const a of AVULSOS) expect(PRODUTOS.find(p => p.id === a.id)?.preco).toBe(a.preco);
  });

  it('o plano é de R$ 67 com 7 dias de garantia; os valores permitidos são 67, 27 e 97', () => {
    expect(PLANO_MENSAL).toMatchObject({ valor: 67, garantiaDias: 7 });
    expect([...VALORES_PERMITIDOS_CARLA].sort((a, b) => a - b)).toEqual([27, 67, 97]);
  });

  it('o texto não menciona cupom como oferta nem o LimpaPro', () => {
    const t = textoConhecimentoSolarDoc();
    expect(t).toContain('R$ 67 por mês');
    expect(t).not.toMatch(/LimpaPro/i);
    expect(t).toMatch(/Não existe cupom/);
  });
});

describe('conhecimento: Solar só diz o que a página pública diz', () => {
  const html = ler('public', 'irmaosnaobra', 'index.html');
  it('cada fato aparece na página', () => {
    for (const pedaco of ['25 anos de', 'garantia de geração', '600W', 'SAJ', 'Deye', 'Sungrow', 'Monitoramento', 'visita grátis', 'Homologação', 'Equipe', 'Catalão', 'Triângulo Mineiro']) {
      expect(html, pedaco).toContain(pedaco);
    }
    expect(FRASES_PUBLICAS_SOLAR.length).toBeGreaterThanOrEqual(8);
  });

  it('o texto proíbe preço, parcela, economia e prazo', () => {
    expect(textoConhecimentoSolar()).toMatch(/NUNCA diga preço, parcela, economia em reais nem prazo/);
  });
});

describe('conhecimento: Eletroposto bate com a landing', () => {
  const html = ler('public', 'io', 'eletroposto', 'index.html');

  it('os valores públicos estão no simulador da landing', () => {
    for (const [kw, valor] of Object.entries(VALORES_PUBLICOS_ELETROPOSTO)) {
      expect(html, `${kw} kW`).toMatch(new RegExp(`${kw}:\\s*\\{\\s*invest:${valor}\\b`));
    }
    expect(VALORES_PUBLICOS_ELETROPOSTO).toEqual({ 60: 135000, 80: 145000, 120: 195000 });
  });

  it('18x, 72x e a carência de 90 dias estão na landing', () => {
    expect(html).toMatch(/Cartão em até 18x, financiamento em até 72x e carência de 90 dias/);
    expect(PAGAMENTO_ELETROPOSTO).toEqual({ cartaoAteX: 18, financiamentoAteX: 72, carenciaDias: 90 });
  });

  it('os cinco modelos existem na landing com o mesmo nome', () => {
    expect(MODELOS_ELETROPOSTO).toHaveLength(5);
    for (const m of MODELOS_ELETROPOSTO) {
      expect(html, m.nome).toContain(`<h3>${m.nome}</h3>`);
      expect(html).toContain(`Modelo 0${m.numero}`);
    }
    expect(html).toContain('garantia de 2 anos');
    expect(html).toMatch(/Isso é franquia\?/);
  });

  it('o texto da Helena guarda rendimento para a reunião', () => {
    expect(textoConhecimentoEletroposto()).toMatch(/só na reunião/);
  });
});

describe('conhecimento: depoimentos', () => {
  const landing = ler('src', 'components', 'Landing', 'Landing.tsx');

  it('são os 11 liberados da landing, sem a fala', () => {
    expect(DEPOIMENTOS).toHaveLength(11);
    for (const d of DEPOIMENTOS) {
      expect(landing, d.nome).toContain(`nome: '${d.nome}'`);
      expect(Object.keys(d)).not.toContain('texto');
      expect(Object.keys(d)).not.toContain('fala');
    }
  });

  it('os 11 cards (JPG) que existem em public/depoimentos têm arquivo', () => {
    const noDisco = readdirSync(join(DASHBOARD, 'public', 'depoimentos')).filter(f => f.endsWith('.jpg')).sort();
    const nosDados = DEPOIMENTOS.map(d => d.cardArquivo).filter((x): x is string => !!x).sort();
    expect(noDisco).toHaveLength(11);
    expect(nosDados).toEqual(noDisco);
  });

  it('escolhe pelo perfil: mesma cidade, estado, região, resto; sem repetir', () => {
    expect(cardsParaLead({ cidade: 'Londrina', uf: 'PR' })[0]!.slug).toBe('lucas-rsc-solar');
    expect(cardsParaLead({ cidade: 'Porto Alegre', uf: 'RS' })[0]!.slug).toBe('alessandro-forca-solar');
    expect(cardsParaLead({ cidade: 'Salvador', uf: 'BA' })[0]!.slug).toBe('antonio-exxel-solar');
    expect(cardsParaLead({ uf: 'PA' })).toHaveLength(11);
    expect(cardsParaLead({ cidade: 'Londrina', uf: 'PR' }, ['lucas-rsc-solar']).map(d => d.slug)).not.toContain('lucas-rsc-solar');
    expect(regiaoDaUF('ba')).toBe('nordeste');
    expect(regiaoDaUF('xx')).toBeNull();
  });
});

describe('núcleo: hmac', () => {
  const guardado = { h: process.env.AGENTES5040_HMAC, s: process.env.SUPABASE_SERVICE_KEY };
  afterEach(() => {
    if (guardado.h === undefined) delete process.env.AGENTES5040_HMAC; else process.env.AGENTES5040_HMAC = guardado.h;
    if (guardado.s === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = guardado.s;
  });

  it('com AGENTES5040_HMAC usa essa env', () => {
    process.env.AGENTES5040_HMAC = 'segredo-a';
    process.env.SUPABASE_SERVICE_KEY = 'servico';
    const a = hmacDe('0000000001');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveHmac()!.toString('utf8')).toBe('segredo-a');
    process.env.AGENTES5040_HMAC = 'segredo-b';
    expect(hmacDe('0000000001')).not.toBe(a);
  });

  it('sem a env, deriva de sha256("agentes5040-hmac|" + SUPABASE_SERVICE_KEY)', async () => {
    delete process.env.AGENTES5040_HMAC;
    process.env.SUPABASE_SERVICE_KEY = 'servico-1';
    const { createHash } = await import('crypto');
    expect(chaveHmac()!.equals(createHash('sha256').update('agentes5040-hmac|servico-1').digest())).toBe(true);
    const a = hmacDe('x');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    process.env.SUPABASE_SERVICE_KEY = 'servico-2';
    expect(hmacDe('x')).not.toBe(a);
  });

  it('sem nenhuma das duas: null, e a peça não roda', () => {
    delete process.env.AGENTES5040_HMAC;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(chaveHmac()).toBeNull();
    expect(hmacDe('0000000001')).toBeNull();
  });

  it('é estável e não devolve o telefone; texto vazio é null', () => {
    process.env.AGENTES5040_HMAC = 's';
    expect(hmacDe('0000000001')).toBe(hmacDe('0000000001'));
    expect(hmacDe('0000000001')).not.toContain('0000000001');
    expect(hmacDe('')).toBeNull();
    expect(hmacDe(null)).toBeNull();
  });
});

describe('núcleo: relógio de Brasília', () => {
  it('dia e hora em BRT, não em UTC', () => {
    expect(diaBRT('2026-10-20T01:30:00Z')).toBe('2026-10-19');   // 22h30 do dia 19 em Brasília
    expect(horaBRT('2026-10-20T01:30:00Z')).toBe(22);
    expect(diaBRT('lixo')).toBe('');
  });

  it('horário comercial: 8h às 18h, segunda a sexta, fora de feriado', () => {
    expect(horarioComercial('2026-10-20T11:00:00Z')).toBe(true);    // terça 08:00 BRT
    expect(horarioComercial('2026-10-20T10:59:00Z')).toBe(false);   // 07:59 BRT
    expect(horarioComercial('2026-10-20T20:59:00Z')).toBe(true);    // 17:59 BRT
    expect(horarioComercial('2026-10-20T21:00:00Z')).toBe(false);   // 18:00 BRT
    expect(horarioComercial('2026-10-24T15:00:00Z')).toBe(false);   // sábado
    expect(horarioComercial('2026-10-25T15:00:00Z')).toBe(false);   // domingo
    expect(horarioComercial('2026-11-02T15:00:00Z')).toBe(false);   // Finados (segunda)
    expect(horarioComercial('2026-11-03T15:00:00Z')).toBe(true);
  });

  it('o limite do UTC não engana: 22h de sexta em BRT já é sábado em UTC e continua fora do horário', () => {
    expect(horarioComercial('2026-10-24T01:00:00Z')).toBe(false);
  });

  it('carimbo na frente da linha', () => {
    expect(carimboBR('2026-09-18T17:32:00Z')).toBe('[18/09 14:32] ');
    expect(carimboBR('18/09')).toBe('');
  });
});

describe('núcleo: mídia', () => {
  const audio = (id: number) => msg('lead', null, { id, tipo: 'audio', media_url: `https://x/${id}.ogg` });

  it('lê no máximo 2 por turno (as mais novas); o resto vira marcador', async () => {
    mp.transcribeAudio.mockReset().mockResolvedValue('quero saber de solar');
    const r = await prepararMidia([audio(1), audio(2), audio(3)]);
    expect(mp.transcribeAudio).toHaveBeenCalledTimes(MAX_MIDIAS_POR_TURNO);
    expect(r.map(b => b.tipo === 'texto' && b.texto)).toEqual(['[audio]', '(áudio transcrito) quero saber de solar', '(áudio transcrito) quero saber de solar']);
  });

  it('URL morta vira marcador e não lança', async () => {
    mp.transcribeAudio.mockReset().mockResolvedValue(null);
    mp.downloadImageAsAnthropicSource.mockReset().mockRejectedValue(new Error('x'));
    const r = await prepararMidia([audio(1), msg('lead', null, { id: 2, tipo: 'image', media_url: 'https://x/a.jpg' })]);
    expect(r.map(b => b.tipo === 'texto' && b.texto)).toEqual(['[audio]', '[imagem]']);
  });

  it('usa o cache e guarda o que leu', async () => {
    mp.transcribeAudio.mockReset().mockResolvedValue('olá');
    const cache: CacheMidia = new Map([[1, { msgId: 1, tipo: 'texto', texto: 'do cache' }]]);
    const r = await prepararMidia([audio(1), audio(2)], cache);
    expect(mp.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(r[0]).toMatchObject({ texto: 'do cache' });
    expect(cache.has(2)).toBe(true);
  });

  it('mensagem sem arquivo não vira mídia', async () => {
    const r = await prepararMidia([msg('lead', 'oi'), msg('lead', null, { tipo: 'audio', media_url: null })]);
    expect(r).toEqual([]);
  });
});
