import { describe, it, expect } from 'vitest';

// Os textos da recuperação forte do Pix automático (redator, 05/11/2026): regras da casa e tamanho no PIOR caso já preenchido.
// Puro: nada aqui toca banco, Asaas ou relógio.

import {
  MODELOS_WHATSAPP, MAX_NOME, MAX_EMPRESA, LIMITE_TEXTO_CODIGO, LIMITE_TEXTO_CURTO, LIMITE_TEXTO_LP_SEM_LINK,
  DEP_VANDERLEI, DEP_ALESSANDRO, DEP_GSI,
  montarTextoCodigoVivo, montarTextoCodigoNovoHoje, montarTextoCodigoNovoDia2, montarTextoAbandonoLp, montarTextoRespostaCodigo, montarTextoPedidoCpf,
  montarEmailCodigo, EMAIL_CODIGO_ASSUNTO, EMAIL_CODIGO_CORPO, montarTextoPixJaPagou, montarTextoPixAguarde,
} from '../services/solardoc/recuperacaoTextos';
import { montarTextoPagamento, linkDoPagamento } from '../services/solardoc/recuperacaoCarlaRegras';
import { validadePorExtenso } from '../services/asaas/pixAutoValidade';

const EMOJI = /\p{Extended_Pictographic}/u;
const CODIGO = '00020126580014BR.GOV.BCB.PIX0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5925AIOROS GROUP LTDA6009UBERLANDIA62070503***6304ABCD';
const NOME_GRANDE = 'Maximiliano Alexandrino de Albuquerque';
const EMPRESA_GRANDE = 'Cooperativa de Energia Solar Fotovoltaica e Eficiência Energética do Triângulo Mineiro Ltda';
const VALIDADE_PIOR = 'até 08/11 às 23h';
const LINK = linkDoPagamento('conjunto-com-um-nome-muito-comprido-123456', 'whatsapp');

const casas = (t: string, nome = 'texto'): void => {
  expect(t, `${nome}: travessão`).not.toMatch(/[—–]/);
  expect(t, `${nome}: emoji`).not.toMatch(EMOJI);
  expect(t, `${nome}: colchete sem preencher`).not.toMatch(/\[[a-z_]+\]/);
  expect(t, `${nome}: chave sem preencher`).not.toMatch(/\{[a-z_]+\}/);
  expect(/^\p{Lu}/u.test(t), `${nome}: começa em maiúscula`).toBe(true);
  expect(t, `${nome}: parede de texto`).not.toMatch(/\n/);
};

describe('os modelos de WhatsApp', () => {
  it('sem travessão, sem emoji, começando em maiúscula, em uma linha', () => {
    for (const [nome, t] of Object.entries(MODELOS_WHATSAPP)) {
      expect(t, nome).not.toMatch(/[—–]/);
      expect(t, nome).not.toMatch(EMOJI);
      expect(/^(\p{Lu}|\[saudacao\]|\[nome\])/u.test(t), `${nome}: começa em maiúscula`).toBe(true);
      expect(t, nome).not.toMatch(/\n/);
    }
  });
  it('os depoimentos seguem literais e limpos', () => {
    for (const d of [DEP_VANDERLEI, DEP_ALESSANDRO, DEP_GSI]) expect(d).not.toMatch(/\[|\]|[–—]|https?:|www\./);
  });
});

describe('texto 1 (código vivo), 2a (novo no mesmo dia) e 2b (novo no 2º toque): até 600 no pior caso, 1 bolha', () => {
  const vivo = (nome: string | null, empresa: string | null, dep: string) => montarTextoCodigoVivo({ nome, empresa, validade: VALIDADE_PIOR, depoimento: dep });
  it('com nome e empresa enormes e o depoimento mais comprido', () => {
    const textos = [
      vivo(NOME_GRANDE, EMPRESA_GRANDE, DEP_VANDERLEI), vivo(NOME_GRANDE, EMPRESA_GRANDE, DEP_ALESSANDRO), vivo(NOME_GRANDE, EMPRESA_GRANDE, DEP_GSI),
      montarTextoCodigoNovoHoje({ nome: NOME_GRANDE, depoimento: DEP_VANDERLEI }),
      montarTextoCodigoNovoDia2({ nome: NOME_GRANDE, depoimento: DEP_VANDERLEI, saudacao: 'Bom dia' }),
    ];
    for (const t of textos) { casas(t); expect(t.length).toBeLessThanOrEqual(LIMITE_TEXTO_CODIGO); }
  });
  it('os cortes: nome até 20 e empresa até 40 caracteres', () => {
    const t = vivo(NOME_GRANDE, EMPRESA_GRANDE, DEP_ALESSANDRO);
    expect(t).not.toContain(NOME_GRANDE);
    expect(t).not.toContain(EMPRESA_GRANDE);
    expect(t.startsWith('Oi, Maximiliano')).toBe(true);
    expect(MAX_NOME).toBe(20);
    expect(MAX_EMPRESA).toBe(40);
  });
  it('o texto 1 diz até quando vale, termina em "O código vai logo abaixo." e [validade] vem sempre preenchido', () => {
    const t = vivo('Carlos', 'Solar Andrade', DEP_ALESSANDRO);
    expect(t).toBe(`Oi, Carlos, aqui é a Carla, da SolarDoc. Seu Pix da Solar Andrade continua valendo ${VALIDADE_PIOR}. ${DEP_ALESSANDRO} É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. É só copiar e colar no Pix copia e cola do seu banco. O código vai logo abaixo.`);
    expect(t.endsWith('O código vai logo abaixo.')).toBe(true);
    expect(t).not.toMatch(/\[validade\]|\{validade\}/);
  });
  it('sem nome: "Oi, aqui é a Carla"; sem empresa: "Seu Pix continua valendo"', () => {
    expect(vivo(null, 'Solar Andrade', DEP_ALESSANDRO).startsWith('Oi, aqui é a Carla, da SolarDoc. Seu Pix da Solar Andrade continua valendo')).toBe(true);
    expect(vivo('Carlos', null, DEP_ALESSANDRO)).toContain(`Seu Pix continua valendo ${VALIDADE_PIOR}.`);
    expect(vivo(null, null, DEP_ALESSANDRO).startsWith('Oi, aqui é a Carla, da SolarDoc. Seu Pix continua valendo')).toBe(true);
    expect(montarTextoCodigoNovoHoje({ nome: null, depoimento: DEP_ALESSANDRO }).startsWith('Oi, aqui é a Carla, da SolarDoc. O Pix que você gerou venceu')).toBe(true);
    expect(montarTextoCodigoNovoDia2({ nome: null, depoimento: DEP_VANDERLEI, saudacao: 'Bom dia' }).startsWith('Bom dia, aqui é a Carla, da SolarDoc. Voltei porque')).toBe(true);
  });
  it('2a e 2b terminam prometendo o código logo abaixo', () => {
    expect(montarTextoCodigoNovoHoje({ nome: 'Ana', depoimento: DEP_ALESSANDRO }).endsWith('O código novo vai logo abaixo.')).toBe(true);
    expect(montarTextoCodigoNovoDia2({ nome: 'Ana', depoimento: DEP_VANDERLEI, saudacao: 'Oi' }).endsWith('O código vai logo abaixo.')).toBe(true);
  });
  it('o montarTextoPagamento do robô: SEMPRE 1 bolha e o código sozinho (só o 000201...), com o outro depoimento no 2º toque', () => {
    const agoraMs = Date.parse('2026-11-04T15:00:00.000Z');
    const base = { codigo: CODIGO, validadeMs: Date.parse('2026-11-05T21:40:00-03:00'), agoraMs, nome: 'Carlos', empresa: 'Solar Andrade', horaBrt: 9 };
    const a = montarTextoPagamento({ ...base, origem: 'vivo', dia2: false });
    expect(a.tipo).toBe('vivo');
    expect(a.segundo).toBe(CODIGO);
    expect(a.texto).toContain('até amanhã às 21h');
    expect(a.texto).toContain(DEP_ALESSANDRO);
    expect(a.texto).not.toContain(CODIGO);
    expect(a.texto).not.toMatch(/https?:/);
    const dia2Pag = montarTextoPagamento({ ...base, origem: 'vivo', dia2: true, primeiroTipo: 'pagamento' });
    expect(dia2Pag.texto).toContain(DEP_VANDERLEI);
    const dia2Diag = montarTextoPagamento({ ...base, origem: 'vivo', dia2: true, primeiroTipo: 'diagnostico' });
    expect(dia2Diag.texto).toContain(DEP_ALESSANDRO);
    const novoHoje = montarTextoPagamento({ ...base, origem: 'novo', dia2: false });
    expect(novoHoje.tipo).toBe('novo_hoje');
    const novoDia2 = montarTextoPagamento({ ...base, origem: 'novo', dia2: true, primeiroTipo: 'pagamento' });
    expect(novoDia2.tipo).toBe('novo_dia2');
    expect(novoDia2.texto.startsWith('Bom dia, Carlos')).toBe(true);
    expect(montarTextoPagamento({ ...base, origem: 'novo', dia2: true, horaBrt: 15 }).texto.startsWith('Oi, Carlos')).toBe(true);
  });
  it('a validade sempre sai preenchida, em toda combinação', () => {
    const agoraMs = Date.parse('2026-11-04T15:00:00.000Z');
    for (const validadeMs of [agoraMs + 3 * 3_600_000, agoraMs + 20 * 3_600_000, agoraMs + 90 * 3_600_000]) {
      const v = validadePorExtenso(validadeMs, agoraMs);
      expect(v).toMatch(/^até (hoje|amanhã|\d{2}\/\d{2}) às \d{1,2}h$/);
      const t = montarTextoPagamento({ codigo: CODIGO, origem: 'vivo', dia2: false, validadeMs, agoraMs, nome: 'Ana', empresa: null, horaBrt: 10 });
      expect(t.texto).toContain(`continua valendo ${v}.`);
    }
  });
});

describe('texto 3 (abandono da LP): 1 bolha, até 400 sem o link, sem código', () => {
  it('cabe nos 900 do sendFrio e nos 400 sem o link, mesmo no pior caso', () => {
    const t = montarTextoAbandonoLp({ nome: NOME_GRANDE, saudacao: 'Bom dia', link: LINK });
    casas(t);
    expect(t.length).toBeLessThanOrEqual(900);
    expect(t.replace(LINK, '').length).toBeLessThanOrEqual(LIMITE_TEXTO_LP_SEM_LINK);
    expect(t).toContain(LINK);
    expect(t).toContain('https://');
    expect(t).not.toMatch(/000201/);
  });
  it('sem nome: "Oi, aqui é a Carla"', () => {
    expect(montarTextoAbandonoLp({ nome: null, saudacao: 'Oi', link: LINK }).startsWith('Oi, aqui é a Carla, da SolarDoc. Vi que você começou a assinar')).toBe(true);
  });
});

describe('textos 4 e 5 (resposta na conversa): até 160, que é o teto da bolha do vivoEnvio', () => {
  it('com e sem nome, no pior caso', () => {
    for (const t of [montarTextoRespostaCodigo(NOME_GRANDE), montarTextoRespostaCodigo(null), montarTextoPedidoCpf(NOME_GRANDE), montarTextoPedidoCpf(null)]) {
      casas(t);
      expect(t.length).toBeLessThanOrEqual(LIMITE_TEXTO_CURTO);
    }
    expect(LIMITE_TEXTO_CURTO).toBe(160);
  });
  it('sem nome o 4 começa em "Fechado." e o 5 em "O Pix automático pede o CPF"; ambos têm a frase certa', () => {
    expect(montarTextoRespostaCodigo(null)).toBe('Fechado. É o Pix automático de R$ 67 por mês, e você cancela quando quiser pelo app do banco. O código vai aqui embaixo.');
    expect(montarTextoRespostaCodigo('Ana')).toBe('Fechado, Ana. É o Pix automático de R$ 67 por mês, e você cancela quando quiser pelo app do banco. O código vai aqui embaixo.');
    expect(montarTextoPedidoCpf(null).startsWith('O Pix automático pede o CPF de quem paga')).toBe(true);
    expect(montarTextoPedidoCpf('Ana')).toBe('Ana, o Pix automático pede o CPF de quem paga, e eu ainda não tenho o seu. Me manda aqui, por favor? Assim eu gero o código.');
  });
  it('texto 7: já pagou e código vivo por pouco (placeholders [nome] e [hora]), até 160, com e sem nome', () => {
    for (const hora of ['15h40', '21h']) {
      for (const nome of [NOME_GRANDE, null]) {
        const t = montarTextoPixAguarde({ nome, hora });
        casas(t);
        expect(t.length).toBeLessThanOrEqual(LIMITE_TEXTO_CURTO);
        expect(t).toContain(`só até ${hora}.`);
        expect(t).not.toMatch(/já te mandei|chamo o time|\[hora\]|\[nome\]/);
      }
    }
    for (const nome of [NOME_GRANDE, null]) {
      const t = montarTextoPixJaPagou(nome);
      expect(t).not.toMatch(/[—–]|\[nome\]/);
      expect(t).not.toMatch(EMOJI);
      expect(t.length).toBeLessThanOrEqual(LIMITE_TEXTO_CURTO);
      expect(t).toContain('https://solardoc.app');
    }
    expect(montarTextoPixAguarde({ nome: null, hora: '9h' }).startsWith('Seu código ainda vale')).toBe(true);
    expect(montarTextoPixJaPagou(null).startsWith('Boa notícia: seu pagamento já entrou')).toBe(true);
  });
});

describe('texto 6 (e-mail da noite com o código)', () => {
  it('assunto e corpo preenchidos, com o código sozinho numa linha e o link', () => {
    const e = montarEmailCodigo({ nome: 'Carlos', validade: 'até amanhã às 21h', codigo: CODIGO, link: LINK });
    expect(e.assunto).toBe('Seu Pix da SolarDoc vale até amanhã às 21h');
    expect(e.corpo).toContain('Oi, Carlos, aqui é a Carla, da SolarDoc.');
    expect(e.corpo).toContain('Ele continua valendo até amanhã às 21h.');
    expect(e.corpo.split('\n')).toContain(CODIGO);
    expect(e.corpo).toContain(`gere o pagamento por lá: ${LINK}`);
    expect(e.corpo.endsWith('Carla\nSolarDoc')).toBe(true);
    for (const t of [e.assunto, e.corpo]) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(EMOJI);
      expect(t).not.toMatch(/\[[a-z_]+\]|\{[a-z_]+\}/);
    }
    expect(EMAIL_CODIGO_ASSUNTO).toContain('[validade]');
    expect(EMAIL_CODIGO_CORPO).toContain('[codigo]');
  });
  it('sem nome: "Oi, aqui é a Carla, da SolarDoc."', () => {
    expect(montarEmailCodigo({ nome: null, validade: 'até hoje às 23h', codigo: CODIGO, link: LINK }).corpo.startsWith('Oi, aqui é a Carla, da SolarDoc.')).toBe(true);
  });
});
