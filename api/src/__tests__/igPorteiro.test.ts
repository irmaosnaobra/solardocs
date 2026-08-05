import { describe, it, expect, beforeEach } from 'vitest';

// igGate é puro (nada de supabase) — dá pra testar a máquina de estados direto.
import {
  gateAtivo, gateAberto, acaoNaAbertura, acaoNaResposta, etapaDepois,
  payloadSeguir, nudgeGate, lembrete1h, repetiriaOToque, conviteSeguir, GATE_VALIDADE_MS, L1H_ATRASO_MS,
} from '../services/instagram/igGate';

const comLink = { id: 'eletro', link_url: 'https://solardoc.app/io/eletroposto?src=ig' };
const semLink = { id: 'menu', link_url: null };           // Menu / rede de segurança
const AGORA = new Date('2026-08-04T12:00:00Z').getTime();
const haMinutos = (m: number) => new Date(AGORA - m * 60000).toISOString();

beforeEach(() => { delete process.env.IG_GATE_OFF; delete process.env.IG_LEMBRETE_1H_OFF; });

describe('porteiro do link — quem passa pelo fluxo', () => {
  it('automação com link entra no porteiro; sem link, não', () => {
    expect(gateAtivo(comLink)).toBe(true);
    // O Menu manda a pessoa responder "SOLAR"/"ELETROPOSTO" — se o porteiro
    // pegasse essa resposta, o menu nunca rotearia pra automação certa.
    expect(gateAtivo(semLink)).toBe(false);
    expect(gateAtivo({ ...comLink, gate_off: true })).toBe(false);
  });

  it('IG_GATE_OFF desliga em todas de uma vez', () => {
    process.env.IG_GATE_OFF = 'true';
    expect(gateAtivo(comLink)).toBe(false);
    expect(acaoNaAbertura(comLink, null)).toBe('entregar');
  });
});

describe('porteiro do link — os dois toques', () => {
  it('comentário novo pede pra seguir em vez de mandar o link', () => {
    expect(acaoNaAbertura(comLink, null)).toBe('seguir');
    expect(payloadSeguir(comLink).quick_replies?.[0].title).toBe('Seguindo');
  });

  it('a resposta ao "me segue" entrega o link', () => {
    const seguir = { gate_etapa: 'seguir', gate_automation_id: 'eletro', gate_em: haMinutos(1) };
    expect(acaoNaResposta(seguir, AGORA)).toBe('entregar');
  });

  it('quem ficou no fluxo antigo de dois toques cai no "me segue" e segue o jogo', () => {
    // Ninguém entra mais em 'pedido', mas quem estava parado nele quando o
    // toque a mais saiu (05/08) não pode ficar preso.
    const pedido = { gate_etapa: 'pedido', gate_automation_id: 'eletro', gate_em: haMinutos(1) };
    expect(acaoNaResposta(pedido, AGORA)).toBe('seguir');
    expect(repetiriaOToque(comLink, pedido, AGORA)).toBe(false);
  });

  it('depois de entregue o porteiro sai do caminho (roteamento normal volta)', () => {
    const entregue = { gate_etapa: 'entregue', gate_em: haMinutos(1), gate_liberado_em: haMinutos(1) };
    expect(gateAberto(entregue, AGORA)).toBe(false);
    expect(acaoNaResposta(entregue, AGORA)).toBeNull();
  });

  it('quem já seguiu uma vez recebe o link direto no próximo comentário', () => {
    const veterano = { gate_etapa: 'entregue', gate_liberado_em: haMinutos(60 * 24 * 30) };
    expect(acaoNaAbertura(comLink, veterano, AGORA)).toBe('entregar');
    // …inclusive numa automação DIFERENTE: seguir a conta é uma coisa só.
    expect(acaoNaAbertura({ id: 'solar', link_url: 'https://solardoc.app/simular' }, veterano, AGORA)).toBe('entregar');
  });

  it('comentário repetido fica em silêncio, não manda o "me segue" de novo', () => {
    // 05/08: um comentário rendeu duas DMs iguais. Comentário repetido renderia
    // uma por comentário — mesma bizarrice, outro caminho.
    const noSeguir = { gate_etapa: 'seguir', gate_automation_id: 'eletro', gate_em: haMinutos(5) };
    expect(repetiriaOToque(comLink, noSeguir, AGORA)).toBe(true);
    // Quem mudou de produto entra no fluxo da automação nova: não é repetição.
    expect(repetiriaOToque({ id: 'solar', link_url: 'https://solardoc.app/simular' }, noSeguir, AGORA)).toBe(false);
    // Primeiro comentário da vida: fala normalmente.
    expect(repetiriaOToque(comLink, null, AGORA)).toBe(false);
    // Toque velho (72h) já expirou — pode pedir de novo.
    const velho = { ...noSeguir, gate_em: new Date(AGORA - GATE_VALIDADE_MS - 1000).toISOString() };
    expect(repetiriaOToque(comLink, velho, AGORA)).toBe(false);
    // Veterano recebe o LINK a cada comentário; link repetido não é bizarrice.
    expect(repetiriaOToque(comLink, { ...noSeguir, gate_liberado_em: haMinutos(60) }, AGORA)).toBe(false);
    // Automação sem porteiro (Menu) entrega o texto sempre.
    expect(repetiriaOToque(semLink, noSeguir, AGORA)).toBe(false);
  });

  it('porteiro esquecido expira — quem volta dias depois não fica preso no fluxo', () => {
    const velho = { gate_etapa: 'pedido', gate_em: new Date(AGORA - GATE_VALIDADE_MS - 1000).toISOString() };
    expect(gateAberto(velho, AGORA)).toBe(false);
    expect(acaoNaResposta(velho, AGORA)).toBeNull();
  });

  it('sem estado nenhum, a DM avulsa não vira toque de porteiro', () => {
    expect(acaoNaResposta(null, AGORA)).toBeNull();
    expect(acaoNaResposta({ gate_etapa: null }, AGORA)).toBeNull();
  });

  it('etapa gravada depois de cada ação (é ela que trava o clique duplo)', () => {
    expect(etapaDepois('seguir')).toBe('seguir');
    expect(etapaDepois('entregar')).toBe('entregue');
  });
});

describe('porteiro do link — o link não escapa', () => {
  it('nenhum dos toques do porteiro carrega a URL', () => {
    const textos = [payloadSeguir(comLink).text, nudgeGate(comLink)];
    for (const t of textos) expect(t).not.toContain('http');
  });

  it('a copy sempre ensina a responder digitando (a Meta pode engolir o botão)', () => {
    expect(payloadSeguir(comLink).text.toUpperCase()).toContain('SEGUINDO');
  });

  it('rótulo do botão respeita o limite de 20 caracteres da Meta', () => {
    const longo = { ...comLink, gate_seguir_botao: 'Ja segui voce agora mesmo' };
    expect(payloadSeguir(longo).quick_replies?.[0].title.length).toBe(20);
  });

  it('o lembrete de 1h leva o link só pra quem já passou pelo porteiro', () => {
    const l = lembrete1h(comLink, '178001')!;
    expect(l.to).toBe('178001');
    // texto de quem passou: pode levar o link
    expect(l.text).toContain(comLink.link_url);
    // e o alternativo pra quem parou no meio NÃO leva
    expect(l.gate_nudge).toBeTruthy();
    expect(l.gate_nudge).not.toContain('http');
    expect(L1H_ATRASO_MS).toBe(3600_000);
  });

  it('o "me segue" é cobrado no lembrete de 1h, não na entrega', () => {
    // 05/08: entrega vem limpa ("não estamos dando nada em troca"); o pedido
    // aparece depois que a pessoa já recebeu o que veio buscar.
    const convite = conviteSeguir();
    expect(convite.toLowerCase()).toContain('segue');
    expect(convite).not.toContain('http');
    expect(lembrete1h(comLink, '1')!.text).toContain(convite);
  });

  it('copy de lembrete escrita no painel manda — não recebe enxerto', () => {
    const l = lembrete1h({ ...comLink, lembrete_1h_texto: 'Conseguiu abrir?' }, '1')!;
    expect(l.text).toBe('Conseguiu abrir?');
  });

  it('automação sem porteiro não carrega alternativa de nudge', () => {
    const l = lembrete1h(semLink, '178001')!;
    expect(l.gate_nudge).toBeUndefined();
    expect(l.text).not.toContain('http');
  });

  it('lembrete de 1h desliga por automação e por ambiente', () => {
    expect(lembrete1h({ ...comLink, lembrete_1h_off: true }, '1')).toBeNull();
    process.env.IG_LEMBRETE_1H_OFF = 'true';
    expect(lembrete1h(comLink, '1')).toBeNull();
  });

  it('copy do lembrete de 1h pode ser trocada no painel', () => {
    const l = lembrete1h({ ...comLink, lembrete_1h_texto: 'Ó o link aí 👇' }, '1')!;
    expect(l.text).toBe('Ó o link aí 👇');
  });

  it('copy da automação sobrescreve o padrão', () => {
    const custom = { ...comLink, gate_seguir_texto: 'Me segue ⚡', gate_seguir_botao: 'Já segui' };
    expect(payloadSeguir(custom).text).toBe('Me segue ⚡');
    expect(payloadSeguir(custom).quick_replies?.[0].title).toBe('Já segui');
  });
});
