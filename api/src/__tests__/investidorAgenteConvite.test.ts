import { describe, it, expect } from 'vitest';
import {
  CONVITE_APOS_MS, SILENCIO_APOS_MS, TEXTO_DO_SILENCIO, MOTIVO_SILENCIO, MOTIVO_EQUIPE_ASSUMIU,
  avaliarConvite, contaComoConversa, ehFalaDela, equipeAssumiu, sessaoEntraNoConvite, silencioDepoisDoConvite, silencioVencido, textoDoConvite, textoEquipeAssumiu,
  type MsgDaLinha, type SessaoDoConvite,
} from '../services/io/investidorAgenteConvite';

// A regra pura da retomada do convite, da passagem por silêncio e da equipe que assumiu (13/11/2026). Sem banco nem rede.
// Nomes, telefones e ids inventados.

const H = 3_600_000;
const AGORA = Date.parse('2026-11-13T13:00:00Z');
const iso = (msAtras: number): string => new Date(AGORA - msAtras).toISOString();

const sessao = (over: Partial<SessaoDoConvite> = {}): SessaoDoConvite => ({
  estagio: 'conversando', telefone: '5534999990001', aberto_em: iso(5 * 24 * H), atualizado_em: iso(30 * H),
  respostas: 2, convidou_em: iso(30 * H), ofertas_feitas: 0, ...over,
});
/** A última fala dela, em ISO, `h` horas atrás. */
const dela = (h: number, over: Partial<MsgDaLinha> = {}): MsgDaLinha => ({ from_me: true, from_api: true, momment: iso(h * H), ...over });
const doCliente = (h: number): MsgDaLinha => ({ from_me: false, from_api: null, momment: iso(h * H) });

describe('quem entra na retomada do convite', () => {
  it('conversando com resposta da Helena e convite registrado entra', () => {
    expect(sessaoEntraNoConvite(sessao())).toBe(true);
  });

  it('ofertou entra, mesmo sem convite registrado', () => {
    expect(sessaoEntraNoConvite(sessao({ estagio: 'ofertou', convidou_em: undefined, ofertas_feitas: 1 }))).toBe(true);
  });

  it('conversando SEM convite registrado, ou sem resposta da Helena, não entra', () => {
    expect(sessaoEntraNoConvite(sessao({ convidou_em: undefined }))).toBe(false);
    expect(sessaoEntraNoConvite(sessao({ respostas: 0 }))).toBe(false);
  });

  it('os outros estágios não entram', () => {
    for (const estagio of ['chamado', 'adiado', 'agendado', 'sem_interesse', 'humano']) {
      expect(sessaoEntraNoConvite(sessao({ estagio }))).toBe(false);
    }
  });

  it('fila principal só: grupo, sem_retomada, erro, ciclo encerrado e sem telefone ficam de fora', () => {
    expect(sessaoEntraNoConvite(sessao({ grupo: 'resgate' }))).toBe(false);
    expect(sessaoEntraNoConvite(sessao({ sem_retomada: true }))).toBe(false);
    expect(sessaoEntraNoConvite(sessao({ erro: 'falhou' }))).toBe(false);
    expect(sessaoEntraNoConvite(sessao({ ciclo_encerrado: 'outra_conversa' }))).toBe(false);
    expect(sessaoEntraNoConvite(sessao({ telefone: '' }))).toBe(false);
  });

  it('menos de 3 listas: com 2 entra, com 3 não', () => {
    expect(sessaoEntraNoConvite(sessao({ ofertas_feitas: 2 }))).toBe(true);
    expect(sessaoEntraNoConvite(sessao({ ofertas_feitas: 3 }))).toBe(false);
  });

  it('uma só vez por pessoa: quem já recebeu a retomada não entra de novo', () => {
    expect(sessaoEntraNoConvite(sessao({ estagio: 'ofertou', convite_retomado_em: iso(2 * H) }))).toBe(false);
  });
});

describe('avaliarConvite: 24 h da última fala dela e nada depois', () => {
  it('a última mensagem é dela e tem 24 h ou mais: elegível', () => {
    const r = avaliarConvite(sessao(), [doCliente(40), dela(30)], AGORA);
    expect(r).toEqual({ ok: true, ultimaDelaEm: iso(30 * H) });
  });

  it('fronteira de 24 h: 23h59 não, 24h00 sim', () => {
    const s = (h: number) => sessao({ atualizado_em: iso(h * H), convidou_em: iso(h * H) });
    expect(avaliarConvite(s(23.99), [dela(23.99)], AGORA)).toEqual({ ok: false, motivo: 'menos_de_24h' });
    expect(avaliarConvite(s(24), [dela(24)], AGORA)).toMatchObject({ ok: true });
    expect(CONVITE_APOS_MS).toBe(24 * H);
  });

  it('mensagem do CLIENTE depois da dela: segura', () => {
    expect(avaliarConvite(sessao(), [dela(30), doCliente(26)], AGORA)).toEqual({ ok: false, motivo: 'cliente_depois' });
  });

  it('mensagem da EQUIPE (from_me sem from_api, ou com from_api nulo) depois da dela: segura', () => {
    expect(avaliarConvite(sessao(), [dela(30), dela(26, { from_api: false })], AGORA)).toEqual({ ok: false, motivo: 'equipe_depois' });
    expect(avaliarConvite(sessao(), [dela(30), dela(26, { from_api: null })], AGORA)).toEqual({ ok: false, motivo: 'equipe_depois' });
  });

  it('mensagem de OUTRO ROBÔ depois da dela: segura (a última fala não é dela)', () => {
    expect(avaliarConvite(sessao(), [dela(30), dela(26)], AGORA)).toEqual({ ok: false, motivo: 'outra_fala_depois' });
  });

  it('a fala dela colada no atualizado_em (até 15 min) vale; mais longe que isso não é dela', () => {
    const s = sessao({ atualizado_em: iso(30 * H), convidou_em: undefined });
    expect(avaliarConvite(s, [dela(30 - 10 / 60)], AGORA)).toMatchObject({ ok: true });
    expect(avaliarConvite(s, [dela(30 - 20 / 60)], AGORA)).toEqual({ ok: false, motivo: 'outra_fala_depois' });
  });

  it('conversa vazia, ou sem data que dê para ler: não elegível', () => {
    expect(avaliarConvite(sessao(), [], AGORA)).toEqual({ ok: false, motivo: 'sem_conversa' });
    expect(avaliarConvite(sessao(), [{ from_me: true, from_api: true, momment: 'não é data' }], AGORA)).toEqual({ ok: false, motivo: 'sem_conversa' });
  });

  it('sem nenhum marcador na sessão, não dá para provar que a fala é dela: não elegível', () => {
    expect(avaliarConvite({}, [dela(30)], AGORA)).toEqual({ ok: false, motivo: 'outra_fala_depois' });
  });
});

describe('equipeAssumiu: from_me com from_api diferente de true depois da abertura', () => {
  const aberto = iso(5 * 24 * H);

  it('from_api false ou nulo depois da abertura dispara', () => {
    expect(equipeAssumiu([dela(30, { from_api: false })], aberto)).toBe(true);
    expect(equipeAssumiu([dela(30, { from_api: null })], aberto)).toBe(true);
    expect(equipeAssumiu([dela(30, { from_api: undefined })], aberto)).toBe(true);
  });

  it('from_api true (a própria Helena ou outro robô) não dispara', () => {
    expect(equipeAssumiu([dela(30), dela(10)], aberto)).toBe(false);
  });

  it('mensagem do cliente não dispara', () => {
    expect(equipeAssumiu([doCliente(30)], aberto)).toBe(false);
  });

  it('gente digitando ANTES da abertura não conta', () => {
    expect(equipeAssumiu([{ from_me: true, from_api: false, momment: iso(6 * 24 * H) }], aberto)).toBe(false);
  });

  it('abertura sem data legível: não dispara', () => {
    expect(equipeAssumiu([dela(30, { from_api: false })], 'sem data')).toBe(false);
  });

  it('os motivos gravados na sessão', () => {
    expect(MOTIVO_EQUIPE_ASSUMIU).toBe('equipe_assumiu');
    expect(MOTIVO_SILENCIO).toBe('silencio_depois_do_convite');
  });
});

describe('ehFalaDela: o carimbo prova que a fala é da Helena', () => {
  const base = { atualizado_em: iso(2 * H), convidou_em: undefined };
  const ms = (h: number): number => AGORA - h * H;

  it('com carimbo: a automação a até 2 min dele é dela, mesmo com o atualizado_em reescrito depois', () => {
    expect(ehFalaDela(dela(30), base, [ms(30) + 90_000])).toBe(true);
    expect(ehFalaDela(dela(30), base, [ms(30) - 90_000])).toBe(true);
  });

  it('a fala longe de todos os carimbos E longe do atualizado_em e do convidou_em é de outro robô', () => {
    expect(ehFalaDela(dela(30), base, [ms(40), ms(20)])).toBe(false);
    expect(ehFalaDela(dela(30), base, [ms(30) + 3 * 60_000])).toBe(false);
  });

  it('um critério não exclui o outro: o carimbo OU o atualizado_em / convidou_em (a até 15 min) provam a fala', () => {
    // Longe dos carimbos (que existem), mas colada no atualizado_em: vale. É a sessão antiga, que tem o t1 da abertura e não tem inv_agente_env.
    expect(ehFalaDela(dela(30), { atualizado_em: iso(30 * H) }, [ms(40), ms(20)])).toBe(true);
    expect(ehFalaDela(dela(30), { atualizado_em: iso(2 * H), convidou_em: iso(30 * H) }, [ms(40)])).toBe(true);
    expect(ehFalaDela(dela(30), { atualizado_em: iso(30 * H) }, [])).toBe(true);
    expect(ehFalaDela(dela(30), { atualizado_em: iso(30 * H - 14 * 60_000) }, [])).toBe(true);
    expect(ehFalaDela(dela(30), { atualizado_em: iso(30 * H - 16 * 60_000) }, [])).toBe(false);
    expect(ehFalaDela(dela(30), base, [])).toBe(false);
  });

  it('caso real (dados de mentira): sessão `ofertou` antiga, com o t1 da abertura, sem inv_agente_env, última fala colada no atualizado_em: elegível', () => {
    const agora = Date.parse('2026-11-13T13:00:00Z');
    const t1 = Date.parse('2026-10-12T19:00:00Z');                      // carimbo da abertura, semanas antes
    const s = { atualizado_em: '2026-10-12T19:15:12.000Z', convidou_em: undefined };
    const ultimaFala: MsgDaLinha = { from_me: true, from_api: true, tipo: 'texto', momment: '2026-10-12T19:15:17.000Z' };
    const conversa: MsgDaLinha[] = [{ from_me: true, from_api: true, momment: '2026-10-12T19:00:03.000Z' }, { from_me: false, momment: '2026-10-12T19:10:00.000Z' }, ultimaFala];
    expect(avaliarConvite(s, conversa, agora, [t1])).toMatchObject({ ok: true });
  });

  it('fala do cliente ou de gente nunca é dela', () => {
    expect(ehFalaDela(doCliente(30), base, [ms(30)])).toBe(false);
    expect(ehFalaDela(dela(30, { from_api: false }), base, [ms(30)])).toBe(false);
  });

  it('a sessão reescrita depois da última fala (sem fala nova) não trava a retomada quando há carimbo', () => {
    const s = { atualizado_em: iso(1 * H), convidou_em: iso(30 * H) };
    expect(avaliarConvite(s, [dela(30)], AGORA, [ms(30) + 5_000])).toMatchObject({ ok: true });
    expect(avaliarConvite({ atualizado_em: iso(1 * H) }, [dela(30)], AGORA, [])).toEqual({ ok: false, motivo: 'outra_fala_depois' });
  });
});

describe('reação e aviso do sistema não são conversa', () => {
  it('a Caixa e esta regra concordam', () => {
    for (const tipo of ['reacao', 'notificacao', 'texto', 'audio', 'imagem', null, undefined]) {
      expect(contaComoConversa(tipo)).toBe(tipo !== 'reacao' && tipo !== 'notificacao');
    }
  });

  it('não seguram a retomada nem tiram a Helena da conversa', () => {
    const s = sessao();
    const reacao: MsgDaLinha = { from_me: false, from_api: null, tipo: 'reacao', momment: iso(26 * H) };
    const aviso: MsgDaLinha = { from_me: true, from_api: false, tipo: 'notificacao', momment: iso(25 * H) };
    expect(avaliarConvite(s, [dela(30), reacao, aviso], AGORA)).toMatchObject({ ok: true });
    expect(equipeAssumiu([aviso], iso(5 * 24 * H))).toBe(false);
    // O mesmo texto como mensagem de verdade segura.
    expect(equipeAssumiu([{ ...aviso, tipo: 'texto' }], iso(5 * 24 * H))).toBe(true);
    expect(avaliarConvite(s, [dela(30), { ...reacao, tipo: 'texto' }], AGORA)).toEqual({ ok: false, motivo: 'cliente_depois' });
  });
});

describe('silencioDepoisDoConvite: 48 h da última fala dela depois da retomada, com envio real', () => {
  const ms = (h: number): number => AGORA - h * H;
  const s = (h: number, over: Partial<SessaoDoConvite> = {}) => sessao({ estagio: 'ofertou', convite_retomado_em: iso(h * H), atualizado_em: iso(h * H), convidou_em: undefined, ...over });
  const propria = (h: number): MsgDaLinha => dela(h - 0.01);   // a própria retomada, segundos depois do carimbo
  const c1 = (h: number): number[] => [ms(h)];

  it('fronteira de 48 h: 47h59 espera, 48h00 passa', () => {
    expect(silencioDepoisDoConvite(s(47.99), [propria(47.99)], AGORA, c1(47.99))).toBe('cedo');
    expect(silencioDepoisDoConvite(s(48.1), [propria(48.1)], AGORA, c1(48.1))).toBe('passar');   // a fala dela, segundos depois do carimbo, já tem 48 h
    expect(SILENCIO_APOS_MS).toBe(48 * H);
  });

  it('pré-filtro: a retomada com menos de 48 h, ou a sessão fora da Helena, não vence', () => {
    expect(silencioVencido(s(47), AGORA)).toBe(false);
    expect(silencioVencido(s(48), AGORA)).toBe(true);
    expect(silencioVencido(s(60, { estagio: 'humano' }), AGORA)).toBe(false);
    expect(silencioVencido(sessao({ estagio: 'ofertou' }), AGORA)).toBe(false);
  });

  it('só a própria retomada na conversa: passa', () => {
    expect(silencioDepoisDoConvite(s(60), [dela(70), propria(60)], AGORA, c1(60))).toBe('passar');
  });

  it('cliente, outro robô ou equipe falando por último: não passa', () => {
    expect(silencioDepoisDoConvite(s(60), [propria(60), doCliente(50)], AGORA, c1(60))).toBe('conversa_nova');
    expect(silencioDepoisDoConvite(s(60), [propria(60), dela(50)], AGORA, c1(60))).toBe('conversa_nova');
    expect(silencioDepoisDoConvite(s(60), [propria(60), dela(50, { from_api: false })], AGORA, c1(60))).toBe('conversa_nova');
  });

  it('o cliente respondeu à retomada e a Helena respondeu de volta: as 48 h contam da fala dela', () => {
    const carimbos = [...c1(80), ms(40)];
    const conversa = [propria(80), doCliente(70), dela(40)];
    expect(silencioDepoisDoConvite(s(80), conversa, AGORA, carimbos)).toBe('cedo');           // 40 h da última fala: ainda não
    const mais = [...c1(80), ms(50)];
    expect(silencioDepoisDoConvite(s(80), [propria(80), doCliente(70), dela(50)], AGORA, mais)).toBe('passar');   // 50 h: passa
  });

  it('sem envio real: sem o carimbo c1, ou com a última fala ANTES da retomada, não passa', () => {
    expect(silencioDepoisDoConvite(s(60), [propria(60)], AGORA, c1(60), false)).toBe('sem_envio_real');
    // Queda entre gravar `ofertou` e enviar: a última fala é a antiga, feita antes da retomada.
    expect(silencioDepoisDoConvite(s(60), [dela(90)], AGORA, [ms(90), ms(60)])).toBe('sem_envio_real');
  });

  it('o estágio precisa seguir ativo: humano, agendado e sem_interesse ficam como estão', () => {
    for (const estagio of ['humano', 'agendado', 'sem_interesse', 'adiado']) {
      expect(silencioDepoisDoConvite(s(60, { estagio }), [propria(60)], AGORA, c1(60))).toBe('fora_da_helena');
    }
    for (const estagio of ['chamado', 'conversando', 'ofertou']) {
      expect(silencioDepoisDoConvite(s(60, { estagio }), [propria(60)], AGORA, c1(60))).toBe('passar');
    }
  });

  it('sem retomada registrada, ou sem conversa, não há silêncio a medir', () => {
    expect(silencioDepoisDoConvite(sessao({ estagio: 'ofertou' }), [], AGORA)).toBe('sem_retomada');
    expect(silencioDepoisDoConvite(s(60), [], AGORA, c1(60))).toBe('sem_conversa');
  });
});

describe('os textos fixos', () => {
  const H1 = '2026-11-16T12:00:00Z';   // segunda 09:00 em Brasília
  const H2 = '2026-11-16T17:30:00Z';   // segunda 14:30 em Brasília
  const todos = ['0000000001', '0000000002', '0000000003', '0000000004', '0000000005', '0000000006', '0000000007', '0000000008']
    .map(k => textoDoConvite(k, 'Thiago Exemplo', H1, H2));

  it('a escolha da variante é estável pela chave, e as três variantes aparecem', () => {
    expect(textoDoConvite('0000000001', 'Thiago', H1, H2)).toEqual(textoDoConvite('0000000001', 'Thiago', H1, H2));
    expect(new Set(todos.map(t => t.variante))).toEqual(new Set(['A', 'B', 'C']));
  });

  it('traz o primeiro nome do consultor e os dois horários, sem placeholder sobrando', () => {
    for (const t of todos) {
      expect(t.texto).toContain('Thiago');
      expect(t.texto).not.toContain('Exemplo');
      expect(t.texto).toContain('segunda 16/11 às 09:00');
      expect(t.texto).toContain('segunda 16/11 às 14:30');
      expect(t.texto).not.toMatch(/[{}]/);
    }
  });

  it('sem travessão, sem emoji e sem artigo antes do consultor', () => {
    for (const t of todos) {
      expect(t.texto).not.toMatch(/[—–]/);
      expect(t.texto).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(t.texto).not.toMatch(/\b(o|a|os|as|do|da|dos|das|ao|à)\s+Thiago/i);
      expect(t.texto).toMatch(/com Thiago/);
    }
  });

  it('é uma bolha só, sem quebra de linha, e cabe numa mensagem curta', () => {
    for (const t of todos) {
      expect(t.texto).not.toContain('\n');
      expect(t.texto.length).toBeLessThan(260);
    }
  });

  it('sem pronome com gênero para consultor ou cliente', () => {
    for (const t of todos) expect(t.texto).not.toMatch(/\b(ele|ela|dele|dela|o senhor|a senhora|obrigad[oa])\b/i);
  });

  it('consultor sem nome: "nossa equipe", sem artigo sobrando', () => {
    expect(textoDoConvite('0000000001', '', H1, H2).texto).toMatch(/com nossa equipe|nossa equipe/);
  });

  it('a linha do silêncio e o aviso de equipe assumiu: sem travessão, nome vazio vira "a pessoa"', () => {
    expect(TEXTO_DO_SILENCIO).toBe('Sem resposta ao convite nem à retomada da Helena. Vale uma ligação.');
    const t = textoEquipeAssumiu({ consultor: 'Diego Exemplo', nome: '', tipo: 'investidor' });
    expect(t).toBe('*HELENA SAIU DA CONVERSA*\nDiego, alguém da equipe escreveu para a pessoa (Investidor) pela linha e a Helena parou de responder. A conversa está na Caixa da 5040.');
    expect(t).not.toMatch(/[—–]/);
    expect(textoEquipeAssumiu({ consultor: 'Giovanna', nome: 'Cliente Exemplo', tipo: 'arrendamento' })).toContain('para Cliente Exemplo (Arrendamento)');
    expect(textoEquipeAssumiu({ consultor: 'Giovanna', nome: 'Cliente Exemplo', tipo: 'arrendamento' })).not.toMatch(/\b(a|o) Giovanna/);
  });
});
