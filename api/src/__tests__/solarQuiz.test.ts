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

describe('a vitrine', () => {
  it('pula o feriado e mostra dois dias úteis', () => {
    const dec = decidirCaminho({ conta: '300_600', cidade: 'Uberaba' });
    const dias = montarVitrine(dec, [], AGORA);
    expect(dias.map(d => d.ymd)).toEqual(['2026-10-13', '2026-10-14']);
    expect(dias[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
    expect(dias[0].horas).toHaveLength(14);
  });
  it('visita em Catalão: uma chegada por manhã, com o Thiago', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão' });
    const dias = montarVitrine(dec, [], AGORA);
    expect(dias[0]).toEqual({ ymd: '2026-10-13', horas: [{ h: '09:00', dono: 'Thiago' }, { h: '09:30', dono: 'Diego' }] });
  });
  it('a manhã do Thiago ocupada passa a vez para o Diego', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão' });
    const ocup: Ocupacao[] = [{ dono: 'Thiago', ini: msDe('2026-10-13', '09:30'), fim: msDe('2026-10-13', '10:00') }];
    const dias = montarVitrine(dec, ocup, AGORA);
    expect(dias[0].horas).toEqual([{ h: '09:30', dono: 'Diego' }]);
  });
  it('a visita longa não cabe se a volta bate numa reunião do eletroposto', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Patrocínio' });
    // Patrocínio: o Diego chega mais rápido (121 min). Sai 07:30, chega 10:00, volta 13:01.
    const ep: Ocupacao = { dono: 'Diego', ini: msDe('2026-10-13', '12:00'), fim: msDe('2026-10-13', '12:30') };
    expect(cabe('vistoria', '2026-10-13', '10:00', 'Diego', dec, [], AGORA)).toBe(true);
    expect(cabe('vistoria', '2026-10-13', '10:00', 'Diego', dec, [ep], AGORA)).toBe(false);
  });
  it('não vende o que já passou nem visita sem antecedência', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Uberlândia' });
    const agora = msDe('2026-10-13', '08:10');
    expect(cabe('vistoria', '2026-10-13', '10:30', 'Diego', dec, [], agora)).toBe(false);   // menos de 3h
    expect(cabe('vistoria', '2026-10-13', '13:30', 'Diego', dec, [], agora)).toBe(true);
  });
  it('sem horário de visita, cai para a ligação e a ficha diz o que era', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão' });
    // Os dois sócios cheios por duas semanas.
    const cheio: Ocupacao[] = ['Thiago', 'Diego'].map(dono => ({ dono, ini: AGORA, fim: AGORA + 20 * 86_400_000 }));
    const { dec, dias, semHorario } = decidirEMontar(r, null, 'Thiago', cheio, AGORA);
    expect(semHorario).toBe(true);
    expect(dec.caminho).toBe('ligacao');
    expect(dec.qualifica).toBe('vistoria');
    expect(dias[0].horas[0].dono).toBe('Nilce');
    expect(montarObservacao(r, dec, null, true)).toContain('SEM HORÁRIO DE VISTORIA: marcar na ligação');
  });
});

describe('a ficha', () => {
  it('a primeira linha diz o caminho e a agenda lê de volta o bloco certo', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão-GO', decisor: 'junto' });
    const dec = decidirCaminho({ conta: r.conta, cidade: r.cidade });
    const obs = montarObservacao(r, dec, { cep: '75701-000', rua: 'Rua A', numero: '55', bairro: 'Centro' });
    expect(obs.split('\n')[0]).toBe('LP SOLAR QUIZ · Comércio ou empresa · VISTORIA PRESENCIAL');
    expect(obs).toContain('Cidade: Catalão-GO · 78 km de Araguari pela estrada');
    expect(obs).toContain('Decisor: Decide com mais alguém (pedimos os dois na visita)');
    expect(obs).toContain('Endereço: Rua A, 55 · Centro · Catalão · CEP 75701-000');
    expect(obs).not.toMatch(/[—–]/);   // nada de travessão em texto que gente lê
    expect(caminhoDaFicha(obs)).toBe('vistoria');
    const q = '2026-10-13T09:00:00-03:00';
    const b = ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Thiago', created_by: 'lp_solar', cidade: 'Catalão-GO', observacao: obs })!;
    expect((b.fim - b.ini) / 60000).toBe(58 + 60 + 58);
    expect(blocoDaFicha({ quando: q, vendedor_nome: 'Thiago', created_by: 'lp_solar', cidade: 'Catalão-GO', observacao: obs })).toEqual(b);
  });
  it('fora do raio fica escrito', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Patos de Minas' });
    const obs = montarObservacao(r, decidirCaminho({ conta: r.conta, cidade: r.cidade }), null);
    expect(obs.split('\n')[0]).toContain('VIDEOCHAMADA');
    expect(obs).toContain('Cidade: Patos de Minas · FORA DO RAIO DE 150 KM');
  });
  it('os campos do lead têm os nomes que a tela Leads do Gerador procura', () => {
    const r = resp({ conta: '300_600', cidade: 'Uberlândia', pagamento: 'cartao', decisor: 'eu' });
    const nomes = camposDoLead(r, decidirCaminho({ conta: r.conta, cidade: r.cidade })).map(f => f.name.toLowerCase());
    expect(nomes.some(n => n.includes('consum'))).toBe(true);
    expect(nomes.some(n => n.includes('urg'))).toBe(true);
    expect(nomes.some(n => n.includes('pagamento'))).toBe(true);
    expect(nomes.some(n => n.includes('decide'))).toBe(true);
    expect(nomes).toContain('caminho');
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
