import { describe, it, expect } from 'vitest';
import {
  limparRespostas, montarVitrine, decidirEMontar, cabe, montarObservacao, camposDoLead, blocoDaFicha, msDe,
  avisoDaEquipe, emojiDaNota, palavraDaNota,
  type Ocupacao,
} from '../services/io/solarQuiz';
import { confereRegraDoAviso, TITULO_DE_SECAO } from './_regraAvisoNilce';
import { decidirCaminho, caminhoDaFicha, ocupacaoDaFichaSolar, vaiParaTreino } from '../services/agenda/solarRota';

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
    expect(dias[0].horas).toHaveLength(18);   // 08:00 a 16:30 em :00 e :30 (09/10)
  });
  it('lead novo de 2.000 kWh em Catalão: vitrine da Nilce, nada de visita do Diego (24/10/2026)', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    expect(dec).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' });
    expect(montarVitrine(dec, [], AGORA)[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
  });
  it('visita em Catalão (cliente que já é do Diego): uma chegada por manhã, com o Diego saindo de Uberlândia', () => {
    const dec = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE }, 'Diego');
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
  it('sem horário de visita, o Thiago atende; sem o Thiago, a Nilce liga (cliente que já é do Diego)', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    const diegoCheio: Ocupacao[] = [{ dono: 'Diego', ini: AGORA, fim: AGORA + 20 * 86_400_000 }];
    const a = decidirEMontar(r, 'Diego', diegoCheio, AGORA);
    expect(a).toMatchObject({ semHorario: true, dec: { caminho: 'video', candidatos: ['Thiago'], qualifica: 'vistoria' } });
    const sociosCheios: Ocupacao[] = ['Thiago', 'Diego'].map(dono => ({ dono, ini: AGORA, fim: AGORA + 20 * 86_400_000 }));
    const b = decidirEMontar(r, 'Diego', sociosCheios, AGORA);
    expect(b.dec).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' });
    expect(b.dias[0].horas[0].dono).toBe('Nilce');
    expect(montarObservacao(r, b.dec, null, true)).toContain('SEM HORÁRIO DE VISITA DO DIEGO: marcar no atendimento');
  });
  it('lead novo: nunca desce a escada de reservas, a Nilce é a primeira e a única', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    const sociosCheios: Ocupacao[] = ['Thiago', 'Diego'].map(dono => ({ dono, ini: AGORA, fim: AGORA + 20 * 86_400_000 }));
    const a = decidirEMontar(r, null, sociosCheios, AGORA);
    expect(a).toMatchObject({ semHorario: false, dec: { caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' } });
    // A visita que ele faria vai escrita na ficha, só como informação para a Nilce.
    expect(montarObservacao(r, a.dec, null)).toContain('QUALIFICA PARA VISITA DO DIEGO');
  });
  it('curioso não ganha vitrine', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Uberlândia', urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado' });
    expect(decidirEMontar(r, null, [], AGORA)).toMatchObject({ dec: { caminho: 'curioso' }, dias: [] });
  });
});

describe('a ficha', () => {
  it('a primeira linha diz o caminho, leva a pontuação, e a agenda lê de volta o bloco certo (cliente do Diego)', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Catalão-GO', ...QUENTE, decisor: 'junto' });
    const dec = decidirCaminho(r, 'Diego');
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
  it('fora do raio fica escrito e o atendimento é do Thiago (cliente do Thiago)', () => {
    const r = resp({ conta: '2000_5000', cidade: 'Patos de Minas', ...QUENTE });
    const obs = montarObservacao(r, decidirCaminho(r, 'Thiago'), null);
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

describe('o aviso no celular de quem atende', () => {
  const Q = '2026-10-13T09:30:00-03:00';
  const ficha = (r: ReturnType<typeof resp>, extra: Record<string, unknown> = {}, dono: string | null = null) => {
    const dec = decidirCaminho(r, dono);
    const obs = montarObservacao(r, dec, { cep: '75701-000', rua: 'Rua A', numero: '55', bairro: 'Centro' });
    return { observacao: obs, quando: Q, vendedor_nome: dec.candidatos[0], cliente_nome: 'Roberto Lima', cliente_telefone: '5534999990000', ...extra };
  };

  it('a faixa da nota no emoji: 90 a 100 fogo duplo, 80 a 89 fogo, 70 a 79 verde, 60 a 69 amarelo, abaixo de 60 vermelho', () => {
    expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(emojiDaNota)).toEqual(['🔥🔥', '🔥🔥', '🔥', '🔥', '🟢', '🟢', '🟡', '🟡', '🔴', '🔴']);
    expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(palavraDaNota)).toEqual([
      'MUITO QUENTE', 'MUITO QUENTE', 'QUENTE', 'QUENTE', 'BOM', 'BOM', 'MORNO', 'MORNO', 'FRIO', 'FRIO',
    ]);
  });

  it('visita (cliente do Diego): nota e palavra no título, blocos com emoji, mapa, origem do anúncio e a nota explicada no fim, do menor peso ao maior', () => {
    const t = avisoDaEquipe(ficha(resp({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE, decisor: 'junto' }), { utm_source: 'ig', utm_campaign: 'Solar - Quiz - Agenda' }, 'Diego'));
    const l = t.split('\n');
    expect(l[0]).toBe('🔥🔥 *NOTA 94 · MUITO QUENTE · NOVA VISITA*');
    expect(l[1]).toBe('Veio do quiz da /io/solar.');
    expect(l.slice(3, 5)).toEqual(['*Roberto Lima*', 'WhatsApp: https://wa.me/5534999990000']);
    expect(l.filter(x => TITULO_DE_SECAO.test(x))).toEqual(['📅 *O ATENDIMENTO*', '🎯 *PERFIL*', '⚡ *CONTA DE LUZ*', '📣 *ORIGEM*', '🧮 *COMO CHEGOU NA NOTA*']);
    expect(t).toContain('Onde: Comércio ou empresa');
    expect(t).toContain('Cidade: Catalão-GO · 108 km de Uberlândia pela estrada');
    expect(t).toMatch(/Mapa: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rua%20A%2C%2055/);
    expect(t).toContain('Com: Diego');
    expect(l[l.indexOf('📣 *ORIGEM*') + 1]).toBe('Instagram, campanha Solar - Quiz - Agenda');
    expect(t).toContain('Por que este caminho:');
    expect(t).toContain('*Nota 94 de 100*');
    const bloco = l.slice(l.indexOf('🧮 *COMO CHEGOU NA NOTA*') + 1, l.indexOf('*Soma: 94 de 100*'));
    expect(bloco.map(x => x.split(':')[0])).toEqual(['Já tem orçamento', 'Imóvel', 'Pagamento', 'Quem decide', 'Prazo']);
    expect(bloco[4]).toBe('Prazo: O quanto antes, este mês (35 de 35)');
    expect(bloco[3]).toMatch(/\(14 de 20\)$/);
    expect(l.slice(-2)).toEqual([
      '_Logo em seguida a Duda manda a mensagem para o cliente com o seu nome e o horário, e responde o básico no 5040. O que for com você, ela te passa aqui._',
      '_Veja no CRM: solardoc.app/gerador_',
    ]);
    // Regras da escrita: emoji só na 1ª linha e nos títulos de bloco, nada de travessão, toda linha com maiúscula.
    confereRegraDoAviso(t);
  });

  it('ligação no meio da tabela: amarelo, sem mapa; sem UTM diz que veio sem anúncio', () => {
    const t = avisoDaEquipe(ficha(resp({ conta: '300_600', cidade: 'Uberaba', ...MORNO })));
    expect(t.split('\n')[0]).toBe('🟡 *NOTA 68 · MORNO · NOVA LIGAÇÃO*');
    expect(t).not.toContain('Mapa:');
    expect(t).toContain('📣 *ORIGEM*\nSem anúncio (link direto)');
    expect(t).toContain('*Soma: 68 de 100*');
    confereRegraDoAviso(t);
  });

  it('abaixo de 60 é vermelho', () => {
    const r = resp({ conta: '300_600', cidade: 'Uberaba', urgencia: '3meses', decisor: 'junto', pagamento: 'naosei', imovel: 'construcao', concorrente: 'nao' });
    expect(avisoDaEquipe(ficha(r)).split('\n')[0]).toMatch(/^🔴 \*NOTA \d+ · FRIO · NOVA LIGAÇÃO\*$/);
  });

  it('a marca QUALIFICA PARA abre o bloco do atendimento; uma linha sem valor some, e o bloco vazio some com o título', () => {
    const t = avisoDaEquipe({
      observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nPontuação: 80/100 (prazo 35/35)\nQUALIFICA PARA VISITA TÉCNICA', quando: Q, vendedor_nome: 'Nilce', cliente_nome: 'Ana', cliente_telefone: '5534999990000',
    });
    const l = t.split('\n');
    expect(l[l.indexOf('📅 *O ATENDIMENTO*') + 1]).toBe('*QUALIFICA PARA VISITA TÉCNICA*');
    expect(t).not.toContain('Endereço:');
    expect(t).not.toContain('Mapa:');
    expect(t).not.toContain('CONTA DE LUZ');
    expect(t).not.toContain('O QUE ELE QUER');
    confereRegraDoAviso(t);
  });

  it('ficha antiga, sem a linha da pontuação, ainda sai, sem inventar nota', () => {
    const t = avisoDaEquipe({ observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: Até R$ 300', quando: Q, vendedor_nome: 'Giovanna', cliente_nome: 'Ana', cliente_telefone: '5534999990000' });
    expect(t.split('\n')[0]).toBe('☀️ *NOVA LIGAÇÃO, ENERGIA SOLAR*');
    expect(t).not.toContain('PERFIL');
    expect(t).not.toContain('COMO CHEGOU NA NOTA');
    confereRegraDoAviso(t);
  });
});

describe('o treino da Giovanna (09/10) ACABOU em 24/10/2026: só a Nilce atende solar', () => {
  const chaves = Array.from({ length: 4000 }, (_, i) => `34${String(90000000 + i * 7919).slice(-8)}`);
  const treino = chaves.find(k => vaiParaTreino(k))!;
  const normal = chaves.find(k => !vaiParaTreino(k))!;
  const media = resp({ conta: '300_600', cidade: 'Uberaba', ...MORNO });

  it('o sorteio é fixo pelo telefone e fica perto de 25%', () => {
    expect(vaiParaTreino(treino)).toBe(true);
    expect(vaiParaTreino(treino)).toBe(true);
    const parte = chaves.filter(k => vaiParaTreino(k)).length / chaves.length;
    expect(parte).toBeGreaterThan(0.22);
    expect(parte).toBeLessThan(0.28);
    expect(vaiParaTreino(null)).toBe(false);
  });

  it('a vez que era de treino também vai para a Nilce: o sorteio não manda mais ninguém', () => {
    const t = decidirCaminho(media, null, treino);
    expect(t).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
    expect(t.treino).toBeFalsy();
    expect(t.motivo).not.toContain('treino');
    expect(decidirCaminho(media, null, normal).candidatos).toEqual(['Nilce']);
    expect(decidirCaminho(media).candidatos).toEqual(['Nilce']);
  });

  it('cliente que já é da Nilce fica com ela, mesmo na vez de treino', () => {
    const d = decidirCaminho(media, 'Nilce', treino);
    expect(d.candidatos).toEqual(['Nilce']);
    expect(d.treino).toBeFalsy();
    expect(d.motivo).not.toContain('treino');
  });

  it('até 300 kWh e acima de 1.000 também são da Nilce, com ou sem a vez de treino', () => {
    const pequena = resp({ conta: 'ate300', cidade: 'Uberaba', ...MORNO });
    expect(decidirCaminho(pequena, null, normal).candidatos).toEqual(['Nilce']);
    expect(decidirCaminho(pequena, null, treino).candidatos).toEqual(['Nilce']);
    expect(decidirCaminho(resp({ conta: '2000_5000', cidade: 'Uberaba', ...MORNO }), null, treino).candidatos).toEqual(['Nilce']);
  });

  it('com horário logo, a vitrine é da Nilce', () => {
    const r = decidirEMontar(media, null, [], AGORA, treino);
    expect(r.dec.candidatos).toEqual(['Nilce']);
    expect(r.dias[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
    expect(r.semHorario).toBe(false);
  });

  it('a agenda da Giovanna, cheia ou não, não muda nada para o lead novo', () => {
    const giovannaCheia: Ocupacao[] = [{ dono: 'Giovanna', ini: AGORA, fim: AGORA + 10 * 86_400_000 }];
    const r = decidirEMontar(media, null, giovannaCheia, AGORA, treino);
    expect(r.dec.candidatos).toEqual(['Nilce']);
    expect(r.dias[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
    expect(r.semHorario).toBe(false);
  });
});
