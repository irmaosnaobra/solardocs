import { describe, it, expect } from 'vitest';
import {
  limparRespostas, montarVitrine, decidirEMontar, cabe, montarObservacao, camposDoLead, blocoDaFicha, msDe,
  type Ocupacao,
} from '../services/io/solarQuiz';
import { decidirCaminho, caminhoDaFicha, ocupacaoDaFichaSolar } from '../services/agenda/solarRota';

// Segunda-feira, 12/10/2026, 07:00 de Brasília. (12/10 é feriado nacional:
// Nossa Senhora Aparecida, então o primeiro dia útil é a terça 13/10.)
const AGORA = msDe('2026-10-12', '07:00');

const resp = (o: Record<string, unknown>) => limparRespostas({ tipo: 'empresa', urgencia: 'ja', ...o });

describe('limpar o que a página manda', () => {
  it('descarta valor que não está na lista e corta a cidade', () => {
    const r = limparRespostas({ conta: 'x', tipo: 'castelo', cidade: '  Catalão   GO  ', urgencia: 'ja' });
    expect(r.conta).toBeNull();
    expect(r.tipo).toBeNull();
    expect(r.cidade).toBe('Catalão GO');
    expect(r.urgencia).toBe('ja');
  });
});

// Respostas de quem está fechando (100 pontos) e de quem está no meio (68).
const QUENTE = { urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'sim' };
const MORNO = { urgencia: '3meses', decisor: 'junto', pagamento: 'financiamento', imovel: 'proprio', concorrente: 'nao' };

describe('a vitrine', () => {
  it('pula o feriado e mostra dois dias úteis', () => {
    const dec = decidirCaminho({ conta: '300_600', cidade: 'Uberaba', ...MORNO });
    const dias = montarVitrine(dec, [], AGORA);
    expect(dias.map(d => d.ymd)).toEqual(['2026-10-13', '2026-10-14']);
    expect(dias[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
    expect(dias[0].horas).toHaveLength(14);
  });
  it('visita em Catalão: uma chegada por manhã, com o Diego saindo de Uberlândia', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    const dias = montarVitrine(dec, [], AGORA);
    expect(dias[0]).toEqual({ ymd: '2026-10-13', horas: [{ h: '09:30', dono: 'Diego' }] });   // sai 08:00, 80 min
  });
  it('a visita longa não cabe se a volta bate numa reunião do eletroposto', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Patrocínio', ...QUENTE });
    // Patrocínio: 121 min de Uberlândia. Sai 07:30, chega 10:00, volta 13:01.
    const ep: Ocupacao = { dono: 'Diego', ini: msDe('2026-10-13', '12:00'), fim: msDe('2026-10-13', '12:30') };
    expect(cabe('vistoria', '2026-10-13', '10:00', 'Diego', dec, [], AGORA)).toBe(true);
    expect(cabe('vistoria', '2026-10-13', '10:00', 'Diego', dec, [ep], AGORA)).toBe(false);
  });
  it('não vende o que já passou nem visita sem antecedência', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Uberlândia', ...QUENTE });
    const agora = msDe('2026-10-13', '08:10');
    expect(cabe('vistoria', '2026-10-13', '10:30', 'Diego', dec, [], agora)).toBe(false);   // menos de 3h
    expect(cabe('vistoria', '2026-10-13', '13:30', 'Diego', dec, [], agora)).toBe(true);
  });
  it('sem horário de visita, o Thiago atende; sem o Thiago, a Nilce liga', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    const diegoCheio: Ocupacao[] = [{ dono: 'Diego', ini: AGORA, fim: AGORA + 20 * 86_400_000 }];
    const a = decidirEMontar(r, null, diegoCheio, AGORA);
    expect(a).toMatchObject({ semHorario: true, dec: { caminho: 'video', candidatos: ['Thiago'], qualifica: 'vistoria' } });
    const sociosCheios: Ocupacao[] = ['Thiago', 'Diego'].map(dono => ({ dono, ini: AGORA, fim: AGORA + 20 * 86_400_000 }));
    const b = decidirEMontar(r, null, sociosCheios, AGORA);
    expect(b.dec).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' });
    expect(b.dias[0].horas[0].dono).toBe('Nilce');
    expect(montarObservacao(r, b.dec, null, true)).toContain('SEM HORÁRIO DE VISITA DO DIEGO: marcar no atendimento');
  });
  it('curioso não ganha vitrine', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Uberlândia', urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado' });
    expect(decidirEMontar(r, null, [], AGORA)).toMatchObject({ dec: { caminho: 'curioso' }, dias: [] });
  });
});

describe('a ficha', () => {
  it('a primeira linha diz o caminho, leva a pontuação, e a agenda lê de volta o bloco certo', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão-GO', ...QUENTE, decisor: 'junto' });
    const dec = decidirCaminho(r);
    const obs = montarObservacao(r, dec, { cep: '75701-000', rua: 'Rua A', numero: '55', bairro: 'Centro' });
    expect(obs.split('\n')[0]).toBe('LP SOLAR QUIZ · Comércio ou empresa · VISTORIA PRESENCIAL');
    expect(obs).toContain('Pontuação: 94/100 (prazo 35/35, decisor 14/20, pagamento 20/20, imóvel 15/15, orçamento 10/10)');
    expect(obs).toContain('Cidade: Catalão-GO · 108 km de Uberlândia pela estrada');
    expect(obs).toContain('Decisor: Decide com mais alguém (pedimos os dois na visita)');
    expect(obs).toContain('Endereço: Rua A, 55 · Centro · Catalão · CEP 75701-000');
    expect(obs).not.toMatch(/[—–]/);   // nada de travessão em texto que gente lê
    expect(caminhoDaFicha(obs)).toBe('vistoria');
    const q = '2026-10-13T09:30:00-03:00';
    const b = ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Diego', created_by: 'lp_solar', cidade: 'Catalão-GO', observacao: obs })!;
    expect((b.fim - b.ini) / 60000).toBe(80 + 60 + 80);
    expect(blocoDaFicha({ quando: q, vendedor_nome: 'Diego', created_by: 'lp_solar', cidade: 'Catalão-GO', observacao: obs })).toEqual(b);
  });
  it('fora do raio fica escrito e o atendimento é do Thiago', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Patos de Minas', ...QUENTE });
    const obs = montarObservacao(r, decidirCaminho(r), null);
    expect(obs.split('\n')[0]).toContain('ATENDIMENTO ONLINE');
    expect(obs).toContain('Cidade: Patos de Minas · FORA DO RAIO DE 150 KM');
  });
  it('os campos do lead têm os nomes que a tela Leads do Gerador procura, e os pontos', () => {
    const r = resp({ conta: '300_600', cidade: 'Uberlândia', ...MORNO });
    const campos = camposDoLead(r, decidirCaminho(r));
    const nomes = campos.map(f => f.name.toLowerCase());
    expect(nomes.some(n => n.includes('consum'))).toBe(true);
    expect(nomes.some(n => n.includes('urg'))).toBe(true);
    expect(nomes.some(n => n.includes('pagamento'))).toBe(true);
    expect(nomes.some(n => n.includes('decide'))).toBe(true);
    expect(nomes).toContain('caminho');
    expect(campos.find(f => f.name === 'Pontos')?.values[0]).toBe('68');
    // A composição da nota vai junto, no fim, e soma a nota.
    const partes = campos.filter(f => f.name.startsWith('Pontos do '));
    expect(partes.map(f => f.name)).toEqual(['Pontos do prazo', 'Pontos do decisor', 'Pontos do pagamento', 'Pontos do imóvel', 'Pontos do orçamento']);
    expect(partes.find(f => f.name === 'Pontos do prazo')?.values[0]).toBe('18/35');
    expect(partes.reduce((s, f) => s + Number(f.values[0].split('/')[0]), 0)).toBe(68);
    expect(campos.slice(-5)).toEqual(partes);
  });
  it('a distância do lead é de Uberlândia, a mesma da ficha (Catalão 108 km, não os 78 de Araguari)', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    expect(camposDoLead(r, decidirCaminho(r)).find(f => f.name === 'Raio')?.values[0]).toBe('108 km');
  });
});

describe('outras fichas na agenda', () => {
  it('eletroposto vale 30 min, 15 na faixa de remarcação; o resto 15', () => {
    const t = (h: string) => `2026-10-13T${h}:00-03:00`;
    const dur = (a: Record<string, unknown>) => { const b = blocoDaFicha(a as never)!; return (b.fim - b.ini) / 60000; };
    expect(dur({ quando: t('14:00'), created_by: 'lp_eletroposto' })).toBe(30);
    expect(dur({ quando: t('14:15'), created_by: 'lp_eletroposto' })).toBe(15);
    expect(dur({ quando: t('14:15'), created_by: 'lead-meta' })).toBe(15);
  });
});
