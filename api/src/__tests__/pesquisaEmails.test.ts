import { describe, it, expect, vi, beforeEach } from 'vitest';
import { novoBanco } from './_agentes5040Fake';

// Os e-mails das pesquisas (04/11/2026): o texto, a regra de quem recebe, 1 vez por pessoa e no máximo 10 por dia. Banco em memória; o envio é espião.

const h = vi.hoisted(() => ({ banco: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.banco.cliente.from(t) } }));

import {
  ASSUNTO_DEPOIMENTO, ASSUNTO_SAIDA, RODAPE_SAIR, emailDepoimento, emailSaida, linkPesquisa,
} from '../utils/mailerPesquisa';
import { depsReaisEmail, rodarEmailsPesquisa, type DepsEmail } from '../services/pesquisa/emailTick';
import {
  TETO_EMAIL_DIA, dentroDaJanelaDeEmail, ehExAssinante, ehGrandeUsuario, podeReceberEmail, recebeuSatisfacaoRecente, textoDepoimentoWhatsApp, type UsuarioPesq,
} from '../services/pesquisa/regras';
import { chaveToken, tokenPesquisa } from '../services/pesquisa/token';
import { emBolhas } from '../services/agents/bolhas';

// Quinta-feira, 05/11/2026, 12:00 em Brasília.
const AGORA = new Date('2026-11-05T15:00:00.000Z');
const DIA = 24 * 3_600_000;
const ISO = (ms: number): string => new Date(ms).toISOString();

let seq = 0;
const usuario = (over: Partial<UsuarioPesq> = {}): UsuarioPesq => {
  seq++;
  return {
    id: `u${seq}`, email: `pessoa${seq}@exemplo.com`, nome: 'Ana Paula', plano: 'free', billing_status: null, plano_expira_em: ISO(AGORA.getTime() - 10 * DIA),
    last_canceled_at: null, is_admin: false, email_opt_out: false, pesquisa_sent_at: null, ...over,
  };
};

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  h.banco = novoBanco();
  seq = 0;
});

describe('os textos', () => {
  it('saída: assunto, as 3 perguntas, o botão com o link do token, o rodapé SAIR e nada de border-left', () => {
    const e = emailSaida('Ana Paula', 'a'.repeat(32));
    expect(e.subject).toBe('Posso te fazer 3 perguntas sobre a SolarDoc?');
    expect(e.subject).toBe(ASSUNTO_SAIDA);
    for (const t of ['Oi, Ana,', 'Obrigado pelo tempo em que você usou a SolarDoc.', 'Queria entender 3 coisas, com toda a sinceridade:', '1. Por que você saiu?',
      '2. Qual é a sua crítica sincera?', '3. O que faria você voltar?', 'Leva 1 minuto, e a sua resposta vai direto para o dono.', 'Responder em 1 minuto', 'Equipe SolarDoc']) {
      expect(e.html, t).toContain(t);
    }
    expect(e.html).toContain(`href="https://solardoc.app/pesquisa/saida?t=${'a'.repeat(32)}"`);
    expect(e.html).toContain('Não quer mais receber? Responda este e-mail com SAIR.');
    expect(RODAPE_SAIR).toBe('Não quer mais receber? Responda este e-mail com SAIR.');
    expect(e.html).not.toMatch(/border-left/i);
  });

  it('depoimento: assunto, corpo, botão com o link do token e o rodapé SAIR', () => {
    const e = emailDepoimento('Bia', 'b'.repeat(32));
    expect(e.subject).toBe('Seu depoimento sobre a SolarDoc, em 2 frases');
    expect(e.subject).toBe(ASSUNTO_DEPOIMENTO);
    for (const t of ['Oi, Bia,', 'Você é uma das pessoas que mais usa a SolarDoc, e isso significa muito para nós.',
      'Você topa contar em 2 frases o que ela mudou no seu trabalho? A ideia é mostrar para outros integradores.', 'Só publicamos com a sua autorização.',
      'Escrever meu depoimento', 'Equipe SolarDoc']) {
      expect(e.html, t).toContain(t);
    }
    expect(e.html).toContain(`href="${linkPesquisa('depoimento', 'b'.repeat(32))}"`);
    expect(e.html).toContain(RODAPE_SAIR);
    expect(e.html).not.toMatch(/border-left/i);
  });

  it('sem nome de gente a saudação é "Oi," e o nome vai escapado', () => {
    expect(emailSaida(null, 'c'.repeat(32)).html).toContain('>Oi,<');
    expect(emailSaida('<b>x</b>', 'c'.repeat(32)).html).not.toContain('<b>x</b>');
  });
});

describe('quem recebe', () => {
  it('ex-assinante: já pagou (venda ou plano vencido), hoje free, e saiu há pelo menos 2 dias', () => {
    const agoraMs = AGORA.getTime();
    expect(ehExAssinante(usuario(), false, agoraMs)).toBe(true);                                         // plano vencido
    expect(ehExAssinante(usuario({ plano_expira_em: null }), true, agoraMs)).toBe(true);                 // venda paga, sem data
    expect(ehExAssinante(usuario({ plano_expira_em: null }), false, agoraMs)).toBe(false);               // nunca pagou
    expect(ehExAssinante(usuario({ plano: 'pro', billing_status: 'active' }), true, agoraMs)).toBe(false); // paga hoje
    expect(ehExAssinante(usuario({ plano_expira_em: ISO(agoraMs + DIA) }), true, agoraMs)).toBe(false);  // ainda não venceu
    expect(ehExAssinante(usuario({ plano_expira_em: ISO(agoraMs - 3_600_000) }), false, agoraMs)).toBe(false); // venceu agora há pouco
  });

  it('opt-out, e-mail inválido, torto, conta de teste e admin ficam fora', () => {
    expect(podeReceberEmail(usuario())).toBe(true);
    expect(podeReceberEmail(usuario({ email_opt_out: true }))).toBe(false);
    expect(podeReceberEmail(usuario({ email: 'sem-arroba' }))).toBe(false);
    expect(podeReceberEmail(usuario({ email: 'ana@gmail.coms' }))).toBe(false);
    expect(podeReceberEmail(usuario({ email: 'teste@exemplo.com' }))).toBe(false);
    expect(podeReceberEmail(usuario({ is_admin: true }))).toBe(false);
  });

  it('depoimento: pagante com 20 ou mais propostas; 19 não; free não; satisfação nos últimos 30 dias tira', () => {
    const pro = usuario({ plano: 'pro', billing_status: 'active' });
    expect(ehGrandeUsuario(pro, 20)).toBe(true);
    expect(ehGrandeUsuario(pro, 19)).toBe(false);
    expect(ehGrandeUsuario(usuario(), 40)).toBe(false);
    const agoraMs = AGORA.getTime();
    expect(recebeuSatisfacaoRecente({ pesquisa_sent_at: ISO(agoraMs - 10 * DIA) }, agoraMs)).toBe(true);
    expect(recebeuSatisfacaoRecente({ pesquisa_sent_at: ISO(agoraMs - 31 * DIA) }, agoraMs)).toBe(false);
    expect(recebeuSatisfacaoRecente({ pesquisa_sent_at: null }, agoraMs)).toBe(false);
  });

  it('a janela dos e-mails é das 9h às 19h de Brasília', () => {
    expect(dentroDaJanelaDeEmail(new Date('2026-11-05T11:59:00.000Z'))).toBe(false);  // 8h59
    expect(dentroDaJanelaDeEmail(new Date('2026-11-05T12:00:00.000Z'))).toBe(true);   // 9h
    expect(dentroDaJanelaDeEmail(new Date('2026-11-05T21:59:00.000Z'))).toBe(true);   // 18h59
    expect(dentroDaJanelaDeEmail(new Date('2026-11-05T22:00:00.000Z'))).toBe(false);  // 19h
  });
});

describe('o envio: 1 vez por pessoa e no máximo 10 por dia', () => {
  const enviados: Array<{ tipo: string; id: string; token: string }> = [];
  const deps = (lista: UsuarioPesq[], over: Partial<DepsEmail> = {}): DepsEmail => ({
    ...depsReaisEmail(),
    candidatos: async () => lista,
    enviar: async (tipo, u, token) => { enviados.push({ tipo, id: u.id, token }); },
    ...over,
  });
  beforeEach(() => { enviados.length = 0; });

  it('saída: 15 candidatos, o 1º tick manda 10; o 2º no mesmo dia não manda nenhum; no dia seguinte mandam os 5 que sobraram', async () => {
    const lista = Array.from({ length: 15 }, () => usuario());
    const d = deps(lista, { candidatos: async (tipo) => (tipo === 'saida' ? lista : []) });
    const r1 = await rodarEmailsPesquisa({ agora: AGORA }, d);
    expect(r1.saida?.enviados).toBe(TETO_EMAIL_DIA);
    expect(enviados.filter(e => e.tipo === 'saida')).toHaveLength(10);

    const r2 = await rodarEmailsPesquisa({ agora: new Date(AGORA.getTime() + 3_600_000) }, d);
    expect(r2.saida?.enviados).toBe(0);
    expect(r2.saida?.motivo).toBe('teto_do_dia');
    expect(enviados).toHaveLength(10);

    const r3 = await rodarEmailsPesquisa({ agora: new Date(AGORA.getTime() + DIA) }, d);
    expect(r3.saida?.enviados).toBe(5);
    expect(new Set(enviados.map(e => e.id)).size).toBe(15);   // ninguém recebeu duas vezes
    const r4 = await rodarEmailsPesquisa({ agora: new Date(AGORA.getTime() + 2 * DIA) }, d);
    expect(r4.saida?.enviados).toBe(0);
    expect(enviados).toHaveLength(15);
  });

  it('o claim é por INSERT antes do envio: duas rodadas ao mesmo tempo mandam 1 só e-mail para a mesma pessoa', async () => {
    const lista = [usuario()];
    const d = deps(lista, { candidatos: async (tipo) => (tipo === 'saida' ? lista : []) });
    await Promise.all([rodarEmailsPesquisa({ agora: AGORA }, d), rodarEmailsPesquisa({ agora: AGORA }, d)]);
    expect(enviados).toHaveLength(1);
    expect(h.banco.tabelas.system_state.filter((l: any) => l.key === `pesquisa_saida_email:${lista[0]!.id}`)).toHaveLength(1);
  });

  it('o link do e-mail abre: a chave do token é gravada com o token que vai no e-mail', async () => {
    const lista = [usuario()];
    await rodarEmailsPesquisa({ agora: AGORA }, deps(lista, { candidatos: async (tipo) => (tipo === 'saida' ? lista : []) }));
    const token = enviados[0]!.token;
    expect(token).toBe(tokenPesquisa(lista[0]!.id, 'saida'));
    expect(h.banco.tabelas.system_state.some((l: any) => l.key === chaveToken('saida', token))).toBe(true);
  });

  it('depoimento: os dois tipos têm o seu teto e o seu claim (pesquisa_depo_email)', async () => {
    const grandes = Array.from({ length: 12 }, () => usuario({ plano: 'pro', billing_status: 'active', plano_expira_em: null }));
    const d = deps([], { candidatos: async (tipo) => (tipo === 'depoimento' ? grandes : []) });
    const r = await rodarEmailsPesquisa({ agora: AGORA }, d);
    expect(r.depoimento?.enviados).toBe(10);
    expect(enviados.every(e => e.tipo === 'depoimento')).toBe(true);
    expect(h.banco.tabelas.system_state.filter((l: any) => String(l.key).startsWith('pesquisa_depo_email:'))).toHaveLength(10);
  });

  it('quem já respondeu o formulário não recebe; fora da janela e com a chave PESQUISA_EMAIL_OFF não sai nada', async () => {
    const [a, b] = [usuario(), usuario()];
    h.banco.tabelas.system_state = [{ key: `pesquisa_saida:${a.id}`, value: { porque: 'x' }, updated_at: ISO(AGORA.getTime()) }];
    const d = deps([a, b], { candidatos: async (tipo) => (tipo === 'saida' ? [a, b] : []) });
    expect((await rodarEmailsPesquisa({ agora: new Date('2026-11-05T23:00:00.000Z') }, d)).motivo).toBe('fora_da_janela');
    expect(enviados).toHaveLength(0);
    process.env.PESQUISA_EMAIL_OFF = '1';
    expect((await rodarEmailsPesquisa({ agora: AGORA }, depsReaisEmail())).motivo).toBe('desligado');
    delete process.env.PESQUISA_EMAIL_OFF;
    await rodarEmailsPesquisa({ agora: AGORA }, d);
    expect(enviados.map(e => e.id)).toEqual([b.id]);
  });

  it('o envio que falha marca o claim como falhou, não tenta de novo e não passa do primeiro erro', async () => {
    const lista = [usuario(), usuario()];
    const d = deps(lista, { candidatos: async (tipo) => (tipo === 'saida' ? lista : []), enviar: async () => { throw new Error('resend caiu'); } });
    const r = await rodarEmailsPesquisa({ agora: AGORA }, d);
    expect(r.saida).toMatchObject({ enviados: 0, motivo: 'envio_falhou' });
    const claims = h.banco.tabelas.system_state.filter((l: any) => String(l.key).startsWith('pesquisa_saida_email:'));
    expect(claims).toHaveLength(1);
    expect(claims[0].value.estado).toBe('falhou');
    // a próxima hora pula quem falhou e vai para o seguinte
    const r2 = await rodarEmailsPesquisa({ agora: new Date(AGORA.getTime() + 3_600_000) }, deps(lista, { candidatos: async (tipo) => (tipo === 'saida' ? lista : []) }));
    expect(r2.saida?.enviados).toBe(1);
    expect(enviados.map(e => e.id)).toEqual([lista[1]!.id]);
  });
});

describe('o teto do dia é atômico e a retomada do mesmo dia', () => {
  const enviados: string[] = [];
  const deps = (lista: UsuarioPesq[]): DepsEmail => ({
    ...depsReaisEmail(),
    candidatos: async (tipo) => (tipo === 'saida' ? lista : []),
    enviar: async (_t, u) => { enviados.push(u.id); },
  });
  beforeEach(() => { enviados.length = 0; });

  it('dois ticks ao mesmo tempo com 30 candidatos mandam 10 no total, cada pessoa 1 vez', async () => {
    const lista = Array.from({ length: 30 }, () => usuario());
    await Promise.all([rodarEmailsPesquisa({ agora: AGORA }, deps(lista)), rodarEmailsPesquisa({ agora: AGORA }, deps(lista))]);
    expect(enviados).toHaveLength(TETO_EMAIL_DIA);
    expect(new Set(enviados).size).toBe(TETO_EMAIL_DIA);
    const vagas = h.banco.tabelas.system_state.filter((l: any) => String(l.key).startsWith('pesquisa_saida_vaga:2026-11-05:'));
    expect(vagas.map((l: any) => l.key).sort()).toHaveLength(10);
    // quem perdeu a corrida da vaga não fica com claim preso: só os 10 enviados têm claim
    expect(h.banco.tabelas.system_state.filter((l: any) => String(l.key).startsWith('pesquisa_saida_email:'))).toHaveLength(10);
  });

  it('o e-mail de saída pula quem recebeu o WhatsApp da retomada (usu_rec_sent:) no mesmo dia; ontem não conta; o depoimento não é afetado', async () => {
    const [a, b, c] = [usuario(), usuario(), usuario()];
    h.banco.tabelas.system_state = [
      { key: 'usu_rec_sent:hmac-a', value: { user_id: a.id, estado: 'enviado', em: AGORA.toISOString() }, updated_at: AGORA.toISOString() },
      { key: 'usu_rec_sent:hmac-b', value: { user_id: b.id, estado: 'enviado', em: ISO(AGORA.getTime() - DIA) }, updated_at: ISO(AGORA.getTime() - DIA) },
    ];
    await rodarEmailsPesquisa({ agora: AGORA }, deps([a, b, c]));
    expect(enviados.sort()).toEqual([b.id, c.id].sort());
    enviados.length = 0;
    const dep = { ...depsReaisEmail(), candidatos: async (tipo: string) => (tipo === 'depoimento' ? [a] : []), enviar: async (_t: string, u: UsuarioPesq) => { enviados.push(u.id); } } as DepsEmail;
    await rodarEmailsPesquisa({ agora: AGORA }, dep);
    expect(enviados).toEqual([a.id]);
  });

  it('se a leitura da retomada falha, o e-mail de saída não sai (na dúvida, espera)', async () => {
    const lista = [usuario()];
    const d = { ...deps(lista), retomadaHoje: async () => { throw new Error('banco'); } } as DepsEmail;
    const r = await rodarEmailsPesquisa({ agora: AGORA }, d);
    expect(r.saida?.motivo).toBe('leitura_do_publico_falhou');
    expect(enviados).toHaveLength(0);
  });
});

describe('a bolha do WhatsApp do depoimento', () => {
  it('é 1 bolha, sem link, com 1 pergunta, com e sem nome', () => {
    for (const nome of ['Ana', '', null, undefined]) {
      const t = textoDepoimentoWhatsApp(nome);
      expect(emBolhas(t, { maxBolhas: 1, max: 900 }), String(nome)).toHaveLength(1);
      expect(t).not.toMatch(/https?:|www\./i);
      expect(t.match(/\?/g)).toHaveLength(1);
    }
    expect(textoDepoimentoWhatsApp('Ana')).toBe('Oi, Ana, aqui é a Carla, da SolarDoc. Obrigada por usar tanto a SolarDoc. Você topa contar em 2 frases o que ela mudou no seu trabalho, para eu mostrar a outros integradores?');
    expect(textoDepoimentoWhatsApp('')).toMatch(/^Oi, aqui é a Carla, da SolarDoc\./);
  });
});
