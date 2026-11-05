import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARLA, EXEMPLOS_CARLA, LINKS_CARLA, SISTEMA_FIXO_CARLA, fatosDaRetomada } from '../services/agentes5040/personas/carla';
import { NOVIDADES_SOLARDOC, PARA_LIBERAR, PLANO_MENSAL, VALORES_PERMITIDOS_CARLA, textoRetomadaSolarDoc } from '../services/agentes5040/conhecimento/solardoc';
import { ACOES_DUDA_SEM_FALA, DUDA, EXEMPLOS_DUDA } from '../services/agentes5040/personas/duda';
import { HELENA, EXEMPLOS_HELENA } from '../services/agentes5040/personas/helena';
import { ACOES_SEM_FALA, observacaoSemDiagnostico, semTelefone, type ExemploPersona } from '../services/agentes5040/personas/comum';
import { validarFala } from '../services/agentes5040/trava';
import { lerSaida, schemaSaidaAgente, type ContaRetomada, type ContextoLead, type MsgConversa, type PersonaDef } from '../services/agentes5040/tipos';
import { msg } from './_agentes5040Util';

const PASTA = join(__dirname, '..', 'services', 'agentes5040', 'personas');
const fonte = (arq: string) => readFileSync(join(PASTA, arq), 'utf8');

const CASOS: Array<{ def: PersonaDef; exemplos: readonly ExemploPersona[]; arquivo: string; proibicoes: RegExp[] }> = [
  {
    def: CARLA, exemplos: EXEMPLOS_CARLA, arquivo: 'carla.ts',
    proibicoes: [/cupom/i, /ACESSO19/, /plano anual/i, /devolveu/i, /urgência falsa/i, /Giovanna/],
  },
  {
    def: DUDA, exemplos: EXEMPLOS_DUDA, arquivo: 'duda.ts',
    proibicoes: [/nunca escreve valor em reais/i, /parcela/i, /prazo de instalação/i, /ligar_agora/, /Horário comercial agora: sim/],
  },
  {
    def: HELENA, exemplos: EXEMPLOS_HELENA, arquivo: 'helena.ts',
    proibicoes: [/payback/i, /rendimento/i, /retorno/i, /inquilino/i, /SIM/, /Qualificação completa: sim/],
  },
];

const COMUNS = [/assistente virtual/i, /Nunca negue ser IA/i, /traço longo/i, /emoji/i, /sabe_contexto false/, /suporte_giovanna/, /nao_incomodar/];
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;
const TELEFONE = '3499876543';

function contexto(extra: Partial<ContextoLead> = {}): ContextoLead {
  return {
    chave: TELEFONE,
    nome: 'Marcos Pereira',
    msgs: [msg('lead', 'Oi, quero saber mais')],
    completa: true,
    card: {
      id: 1, status: 'AGENDADO', quando: '2026-10-21T12:30:00.000Z', vendedor_nome: 'Nilce',
      cliente_nome: 'Marcos', cidade: 'Uberaba',
      observacao: 'Ligar no 34 99876-5432 ou (34) 3212-4567. Consumo 700 kWh.', created_by: 'lp_solar',
      created_at: '2026-10-20T12:00:00.000Z',
    },
    leadsMeta: { lead_id: 'L1', form_id: 'F1', nome: 'Marcos', cidade: 'Uberaba', created_time: '2026-10-20T12:00:00.000Z' },
    cadastros: [{ origem: 'parceria', id: 9, nome: 'Marcos', cidade: 'Araguari', created_at: '2026-10-19T12:00:00.000Z', lado: 'tenho_local', status: null }],
    ehClienteSolarDoc: false,
    anuncio: { adId: '120000000000', produto: 'solar' },
    qualificado: false,
    agora: '2026-10-20T13:20:00.000Z',
    ...extra,
  };
}

/** Roda cada fala de agente do exemplo na trava, com a conversa que veio antes dela. */
function motivosDoExemplo(def: PersonaDef, ex: ExemploPersona): string[] {
  const conv: MsgConversa[] = [];
  const erros: string[] = [];
  ex.turnos.forEach((t, i) => {
    if (t.quem === 'cliente') {
      const tipo = t.midia === 'foto' ? 'image' : t.midia === 'audio' ? 'audio' : t.midia === 'pdf' ? 'document' : 'texto';
      conv.push(msg('lead', t.midia === 'audio' ? null : t.texto, { tipo, ...(t.midia === 'audio' ? { transcricao: t.texto } : {}) }));
      return;
    }
    const motivos = validarFala(t.saida, conv, {
      persona: def.persona, completa: true, qualificado: !!t.qualificado,
      acoesSemFala: [...ACOES_SEM_FALA, ...ACOES_DUDA_SEM_FALA], agora: ex.agora ?? '2026-10-20T17:00:00.000Z',
    });
    if (motivos.length) erros.push(`${ex.titulo} #${i}: ${motivos.join('; ')} :: ${t.saida.bolhas.join(' / ')}`);
    if (!def.acoes.includes(t.saida.acao)) erros.push(`${ex.titulo} #${i}: ação fora da lista (${t.saida.acao})`);
    if (t.saida.peca?.tipo === 'imagem') conv.push(msg('robo', null, { tipo: 'image', media_url: t.saida.peca.id }));
    t.saida.bolhas.forEach(b => conv.push(msg('robo', b)));
  });
  return erros;
}

describe.each(CASOS)('persona $def.persona', ({ def, exemplos, arquivo, proibicoes }) => {
  it('sistemaFixo existe e é longo o bastante para o cache', () => {
    expect(typeof def.sistemaFixo).toBe('string');
    expect(def.sistemaFixo.length).toBeGreaterThan(2000);
  });

  it('contém as proibições centrais (comuns e da persona)', () => {
    for (const r of [...COMUNS, ...proibicoes]) expect(def.sistemaFixo, String(r)).toMatch(r);
  });

  it('sem travessão nem emoji no sistemaFixo', () => {
    expect(def.sistemaFixo).not.toMatch(/[—–]/);
    expect(def.sistemaFixo).not.toMatch(EMOJI);
  });

  it('o fonte não escreve preço à mão (vem do conhecimento)', () => {
    const src = fonte(arquivo);
    expect(src).not.toMatch(/R\$\s*\d/);
    expect(src).not.toMatch(/\b(?:19|27|67|97|135|145|195)\b/);
    expect(src).not.toMatch(/\b(?:18|72)x\b/);
    expect(src).not.toMatch(/\b(?:135|145|195)\.?000\b/);
  });

  it('as ações cabem no schema e incluem as comuns', () => {
    const schema = schemaSaidaAgente(def.acoes) as { properties: { acao: { enum: string[] } } };
    expect(schema.properties.acao.enum).toEqual([...def.acoes]);
    for (const a of ['continuar', 'suporte_giovanna', 'nao_incomodar', 'calar']) expect(def.acoes).toContain(a);
    expect(def.acoes).not.toContain(`passar_${def.persona}`);
    const ok = lerSaida(JSON.stringify({ bolhas: ['Oi.'], acao: def.acoes[0], peca: null, dados: [], resumo: '', sabe_contexto: true }), def.acoes);
    expect(ok.ok).toBe(true);
  });

  it('fatos() com contexto de exemplo não quebra e não leva telefone', () => {
    const f = def.fatos(contexto());
    expect(f.length).toBeGreaterThan(50);
    expect(f).not.toContain(TELEFONE);
    expect(f.replace(/\D/g, '')).not.toContain('998765432');
    expect(f.replace(/\D/g, '')).not.toContain('32124567');
    expect(f).not.toMatch(/[—–]/);
  });

  it('fatos() aguenta contexto vazio, incompleto e instante inválido', () => {
    const vazio = contexto({ nome: null, msgs: [], card: null, leadsMeta: null, cadastros: [], anuncio: null, completa: false, agora: 'xx' });
    const f = def.fatos(vazio);
    expect(f).toMatch(/INCOMPLETA/);
    expect(f).toMatch(/Horário comercial agora: desconhecido/);
    expect(f).not.toContain(TELEFONE);
  });

  it('todas as falas de agente dos exemplos passam na trava', () => {
    expect(exemplos.length).toBeGreaterThanOrEqual(4);
    expect(exemplos.length).toBeLessThanOrEqual(def.persona === 'duda' ? 11 : 9);
    const erros = exemplos.flatMap(ex => motivosDoExemplo(def, ex));
    expect(erros).toEqual([]);
  });

  it('os exemplos estão dentro do sistemaFixo', () => {
    for (const ex of exemplos) expect(def.sistemaFixo).toContain(ex.titulo);
  });
});

describe('fatos: horário, horários livres e qualificação', () => {
  it('Duda: horário comercial sim/não vem do instante', () => {
    expect(DUDA.fatos(contexto())).toMatch(/Horário comercial agora[^:]*: sim/);
    expect(DUDA.fatos(contexto({ agora: '2026-10-20T23:40:00.000Z' }))).toMatch(/Horário comercial agora[^:]*: não/);
  });

  it('sem horários no contexto, manda não oferecer horário; com horários, lista só eles', () => {
    expect(DUDA.fatos(contexto())).toMatch(/não trouxe nenhum/);
    const com = { ...contexto(), horariosLivres: ['amanhã, quarta, às 9h', 'amanhã, quarta, às 14h30'] } as ContextoLead;
    expect(DUDA.fatos(com)).toMatch(/amanhã, quarta, às 9h; amanhã, quarta, às 14h30/);
    expect(HELENA.fatos(com)).toMatch(/Horários livres \(ofereça dois/);
  });

  it('Helena: qualificação do contexto aparece explícita', () => {
    expect(HELENA.fatos(contexto())).toMatch(/Qualificação completa[^:]*: não/);
    expect(HELENA.fatos(contexto({ qualificado: true }))).toMatch(/Qualificação completa[^:]*: sim/);
  });

  it('reunião marcada sai por extenso em Brasília', () => {
    expect(DUDA.fatos(contexto())).toMatch(/amanhã, quarta, 21\/10, às 9h30/);
  });

  it('Carla: conta no SolarDoc e depoimento pela cidade', () => {
    const f = CARLA.fatos(contexto({ card: { ...contexto().card!, cidade: 'Londrina' } }));
    expect(f).toMatch(/Conta no SolarDoc com este WhatsApp: não/);
    expect(f).toMatch(/depoimento:lucas-rsc-solar/);
  });

  it('Carla: links só em https://solardoc.app/', () => {
    for (const url of Object.values(LINKS_CARLA)) expect(url).toMatch(/^https:\/\/solardoc\.app\/\S+$/);
  });

  it('semTelefone tira número de 8+ dígitos e deixa data e kWh', () => {
    expect(semTelefone('tel (34) 99876-5432, 700 kWh, dia 20/10/2026')).toBe('tel [número omitido], 700 kWh, dia 20/10/2026');
  });
});

// A nota real do card do quiz solar (sem telefone), no formato de montarObservacao: uma linha por campo.
const NOTA_QUIZ = [
  'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO',
  'Conta de luz: Até R$ 300 (~143 kWh/mês)',
  'Pontuação: 90/100 (prazo 35/35, decisor 14/20, pagamento 16/20, imóvel 15/15, orçamento 10/10)',
  'Cidade: Capinópolis-MG · FORA DO RAIO DE 150 KM',
  'Imóvel: Próprio',
  'Quando quer: O quanto antes, este mês',
  'Já tem orçamento: Sim, quer comparar',
  'Pagamento: Financiamento',
  'Decisor: Decide com mais alguém',
  'Telhado: Metálico',
  'Sombra: Sol o dia todo',
  'Vai aumentar: Não',
  'Dor: A conta sobe todo ano',
  'Pensa em solar: Há mais de 1 ano',
  'Travou: Achou caro',
  'Desejo: Guardar ou investir',
  'Mais importante: Garantia e segurança',
  'Diagnóstico: 4 placas, 2,44 kWp, economia de cerca de R$ 51 por mês',
  'Por que este caminho: Ligação da Nilce: ela atende todo o solar.',
].join('\n');

function comNota(observacao: string, created_by: string | null = 'lp_solar'): ContextoLead {
  return contexto({ card: { ...contexto().card!, observacao, created_by } });
}

describe('card do quiz solar: o que a Duda lê', () => {
  it('a nota tem mais de 500 caracteres (o caso real)', () => {
    expect(NOTA_QUIZ.length).toBeGreaterThan(600);
  });

  it('Duda vê Travou, Desejo e Mais importante, e não vê o Diagnóstico nem a economia', () => {
    const f = DUDA.fatos(comNota(NOTA_QUIZ));
    for (const t of ['Travou: Achou caro', 'Desejo: Guardar ou investir', 'Mais importante: Garantia e segurança', 'Por que este caminho']) expect(f).toContain(t);
    expect(f).not.toMatch(/Diagn[óo]stico/i);
    expect(f).not.toMatch(/econom/i);
    expect(f).not.toMatch(/placas|kWp/);
  });

  it('o corte do Diagnóstico vale também quando a nota já veio numa linha só e com a marca no começo', () => {
    const umaLinha = NOTA_QUIZ.replace(/\n/g, ' ');
    const cortada = observacaoSemDiagnostico(umaLinha);
    expect(cortada).not.toMatch(/Diagn|econom|placas/);
    expect(cortada).toContain('Mais importante: Garantia e segurança');
    expect(cortada).toContain('Por que este caminho: Ligação da Nilce');
    const f = DUDA.fatos(comNota(umaLinha, null));   // sem created_by: vale a marca na primeira linha
    expect(f).toContain('Travou: Achou caro');
    expect(f).not.toMatch(/econom/i);
  });

  it('o rótulo novo do raio chega à Duda e não diz que está fora da área', () => {
    const nova = NOTA_QUIZ.replace('FORA DO RAIO DE 150 KM', 'sem visita presencial (fora do raio de 150 km), atende por ligação');
    const f = DUDA.fatos(comNota(nova));
    expect(f).toContain('sem visita presencial (fora do raio de 150 km), atende por ligação');
    expect(f).toContain('Travou: Achou caro');
  });

  it('o fixture real passa pelo limite sem ser cortado', () => {
    expect(DUDA.fatos(comNota(NOTA_QUIZ))).not.toContain('...');
  });

  it('Carla e Helena seguem cortando a nota em 500, mesmo em card do quiz', () => {
    for (const def of [CARLA, HELENA]) {
      const f = def.fatos(comNota(NOTA_QUIZ));
      expect(f).not.toContain('Mais importante');
      expect(f).toContain('...');
    }
    const longa = 'Cliente pediu retorno. ' + 'texto de nota comum. '.repeat(40);
    for (const def of [CARLA, HELENA, DUDA]) {
      const f = def.fatos(comNota(longa, 'admin'));
      const linha = f.split('\n').find(l => l.startsWith('Observação do card'))!;
      const nota = linha.slice(linha.indexOf('): ') + 3);
      expect(nota.length).toBe(500 + 3);
      expect(nota.endsWith('...')).toBe(true);
    }
  });
});

// ── a retomada dos usuários (03/11/2026): os fatos de quem tem conta e recebeu a mensagem da campanha ──

const conta = (over: Partial<ContaRetomada> = {}): ContaRetomada => ({
  user_id: 'u1', plano: 'free', segmento: 'gratis', grupo: 'nunca_pagou', criada_em: '2026-06-10T12:00:00.000Z', saiu_em: null, forma_antiga: null,
  ultimo_documento_em: '2026-10-20T15:00:00.000Z', tem_cnpj: true, email_mascarado: 'an***@exemplo.com', primeiro_nome: 'Ana', texto_enviado: 'Oi, Ana. Aqui é a Carla, da SolarDoc. Quer ver o que tem de novo?',
  enviado_em: '2026-11-04T12:30:00.000Z', ...over,
});
const fatosRet = (c: ContaRetomada): string => fatosDaRetomada(c, '2026-11-05T17:00:00.000Z').join('\n');
const pagou = (over: Partial<ContaRetomada> = {}) => conta({ segmento: 'ex_assinante', grupo: 'pagou', saiu_em: '2026-09-02T12:00:00.000Z', forma_antiga: 'cartao', ...over });
const incerto = (over: Partial<ContaRetomada> = {}) => conta({ segmento: 'ex_assinante', grupo: 'incerto', saiu_em: '2026-08-01T12:00:00.000Z', forma_antiga: 'pix', ...over });

describe('Carla na retomada: fatosDaRetomada', () => {
  it('imprime a mensagem enviada, a situação da conta, o último documento, o CNPJ, o pagamento e o bloco do Para liberar', () => {
    const f = fatosRet(conta());
    expect(f).toContain('Esta pessoa já tem conta no SolarDoc e a conversa começou pela nossa mensagem de retomada (04/11/2026): "Oi, Ana. Aqui é a Carla, da SolarDoc. Quer ver o que tem de novo?".');
    expect(f).toContain('Situação da conta: grátis desde 10/06/2026, nunca assinou. Plano ativo agora: não.');
    expect(f).toContain('Último documento gerado: 20/10/2026.');
    expect(f).toContain('Empresa com CNPJ cadastrado: sim.');
    expect(f).toContain('Nunca diga que liberou: o acesso volta sozinho na conta dele depois que o pagamento é conferido.');
    expect(f).toContain('Pagamento: nunca a peça assinatura. Cartão: peça entrar_no_app e diga para entrar no app e tocar em Fazer Upgrade.');
    expect(f).toContain('Sem prazo, sem urgência, sem desconto e sem a promessa da planilha nesta conversa. Reembolso, cobrança, reclamação ou acesso: suporte_giovanna.');
    expect(f).toContain(`Não vêm no plano de R$ ${PLANO_MENSAL.valor} e ficam em Para liberar, vendidos à parte: ${PARA_LIBERAR.join(', ')}. Assinar não libera nenhum deles.`);
    for (const nome of ['Kit Off-Grid', 'Inventário', 'Precificação', 'Kit Fecha Vendas', 'LimpaPro']) expect(f).toContain(nome);
  });

  it('sem documento: "nenhum"; sem CNPJ: "não"; datas em DD/MM/AAAA de Brasília (a virada do dia vale a de lá)', () => {
    const f = fatosRet(conta({ ultimo_documento_em: null, tem_cnpj: false, criada_em: '2026-06-10T01:00:00.000Z' }));
    expect(f).toContain('Último documento gerado: nenhum.');
    expect(f).toContain('Empresa com CNPJ cadastrado: não.');
    expect(f).toContain('grátis desde 09/06/2026');
  });

  it('não leva telefone nem e-mail, mesmo que o texto enviado traga um número', () => {
    const f = fatosRet(conta({ texto_enviado: 'Oi, Ana. Chama no 34 99876-5432 ou no ana@exemplo.com?' }));
    expect(f.replace(/\D/g, '')).not.toContain('998765432');
    expect(f).toContain('[número omitido]');
  });

  it('NÃO escreve "Conta no SolarDoc: sim" (essa frase libera "liberou" na regra do prompt)', () => {
    for (const c of [conta(), pagou(), incerto()]) {
      const f = fatosRet(c);
      expect(f).not.toMatch(/Conta no SolarDoc/);
      expect(f).not.toMatch(/\bsim\b.*liberou/);
    }
  });

  it('pelo grupo (D29): "já foi assinante" só sai com `pagou`; o `incerto` diz "sem pagamento confirmado" e manda não dizer que assinou; o grátis diz que nunca assinou', () => {
    expect(fatosRet(pagou())).toContain('Situação da conta: já foi assinante (no cartão) e saiu em 02/09/2026. Plano ativo agora: não.');
    expect(fatosRet(pagou({ forma_antiga: 'pix' }))).toContain('já foi assinante (no Pix) e saiu em 02/09/2026.');
    expect(fatosRet(pagou({ forma_antiga: null, saiu_em: null }))).toContain('Situação da conta: já foi assinante. Plano ativo agora: não.');
    const i = fatosRet(incerto());
    expect(i).toContain('Situação da conta: já teve plano, que acabou em 01/08/2026, sem pagamento confirmado no nosso registro');
    expect(i).toContain('Não diga que ele assinou nem que pagou. Plano ativo agora: não.');
    expect(i).not.toContain('já foi assinante');
    expect(fatosRet(incerto({ saiu_em: null }))).toContain('já teve plano, sem pagamento confirmado');
    for (const c of [conta(), conta({ segmento: 'gratis_ativo' }), conta({ segmento: 'gratis_cnpj' })]) {
      expect(fatosRet(c)).not.toContain('já foi assinante');
      expect(fatosRet(c)).toContain('nunca assinou');
    }
  });

  it('o Pix é sempre o automático (03/11): peça pix_automatico, e-mail com o meio coberto, nada de código, Kiwify nem Pix avulso; a frase de renovar só com `pagou`; o cartão sai por entrar_no_app', () => {
    const gratis = fatosRet(conta());
    expect(gratis).toContain('Pix: peça pix_automatico (o Pix automático, que cobra na conta dele todo mês e mostra o código para copiar; o sistema manda o código da pessoa ou pede o CPF). Nunca Pix avulso nem escreva o código.');
    expect(gratis).toContain('exatamente assim: an***@exemplo.com.');
    expect(gratis).toContain('Peça para usar o mesmo e-mail da conta na página.');
    expect(gratis).not.toContain('ana@exemplo.com');
    expect(gratis).not.toContain('pix_kiwify');
    expect(gratis).not.toContain('foto do comprovante');
    expect(gratis).not.toContain('Ele já pagou antes');
    expect(fatosRet(pagou())).toContain('Ele já pagou antes e pode renovar pelo Pix.');
    expect(fatosRet(incerto())).not.toContain('Ele já pagou antes');
    expect(gratis).toContain('Cartão: peça entrar_no_app');
    // sem e-mail válido na conta, a Carla não escreve e-mail nenhum
    const sem = fatosRet(conta({ email_mascarado: null }));
    expect(sem).toContain('sem escrever o e-mail');
    expect(sem).not.toContain('***@');
  });

  it('a persona manda o Pix só pelo automático: a seção PIX cita pix_automatico e /?pagar=pix, e não cita pix_kiwify, Kiwify nem código copia e cola', () => {
    expect(LINKS_CARLA.pix_automatico).toBe('https://solardoc.app/?pagar=pix');
    expect(LINKS_CARLA.pix_kiwify).toBeUndefined();
    const i = SISTEMA_FIXO_CARLA.indexOf('\nPIX\n');
    expect(i).toBeGreaterThan(0);
    const secao = SISTEMA_FIXO_CARLA.slice(i, SISTEMA_FIXO_CARLA.indexOf('QUEM JÁ TEM CONTA'));
    expect(secao).toContain('pix_automatico');
    expect(secao).toContain('https://solardoc.app/?pagar=pix');
    expect(secao).not.toMatch(/pix_kiwify|Kiwify|copia e cola|foto do comprovante e o e-mail/i);
    expect(SISTEMA_FIXO_CARLA).not.toContain('pix_kiwify');
    // O prompt fixo inteiro (inclui o conhecimento do SolarDoc): nada de Pix pela Kiwify, na chave ou por link de assinatura do site.
    expect(SISTEMA_FIXO_CARLA).not.toMatch(/Kiwify[^.]*Pix|Pix[^.]*Kiwify|na chave|link de assinatura do site/i);
  });

  it('ex-assinante (pagou e incerto) não recebe entrar_no_app nos fatos: só o Pix automático; o grátis segue com o cartão pelo app', () => {
    for (const c of [pagou(), incerto()]) {
      const f = fatosRet(c);
      expect(f).not.toMatch(/peça entrar_no_app/);
      expect(f).toContain('Cartão pelo app não vale para esta conta: ofereça só o Pix automático (pix_automatico).');
      expect(f).not.toMatch(/já assinou antes/);
    }
    expect(fatosRet(conta())).toContain('Cartão: peça entrar_no_app');
  });

  it('nenhuma linha dos fatos e nenhuma da seção "QUEM JÁ TEM CONTA" leva a palavra "menu" (a trava barra em toda bolha)', () => {
    for (const c of [conta(), pagou(), incerto()]) {
      expect(fatosRet(c)).not.toMatch(/\bmenu\b/i);
    }
    const secao = SISTEMA_FIXO_CARLA.slice(SISTEMA_FIXO_CARLA.indexOf('QUEM JÁ TEM CONTA'), SISTEMA_FIXO_CARLA.indexOf('DEPOIMENTOS (cards em imagem'));
    expect(secao.length).toBeGreaterThan(300);
    expect(secao).not.toMatch(/\bmenu\b/i);
  });

  it('sem novidade marcada no ar a Carla não é mandada mostrar novidade: fala só do que sabe; com novidades, o bloco entra e cada linha começa em maiúscula e não leva preço, menu, Pix nem NEXUS', () => {
    const f = fatosRet(conta());
    if (NOVIDADES_SOLARDOC.length === 0) {
      expect(f).toContain('Se perguntar o que mudou, fale só do que está no seu conhecimento e não invente novidade.');
      expect(f).not.toContain('NOVIDADES DA PLATAFORMA');
      expect(f).not.toContain('Mostre uma novidade por vez');
    } else {
      expect(f).toContain('NOVIDADES DA PLATAFORMA (só estas, uma por vez, sem inventar outra):');
      expect(f).toContain('Mostre uma novidade por vez');
    }
    expect(textoRetomadaSolarDoc().some(l => l.startsWith('Não vêm no plano'))).toBe(true);
    for (const n of NOVIDADES_SOLARDOC) {
      expect(n[0], n).toBe(n[0]!.toUpperCase());
      expect(n).not.toMatch(/\bmenu\b|\bpix\b|nexus|[—–]|plataforma inteira|lista de compras/i);
      expect(n).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(n.replace(/R\$\s*(\d+)/g, (_m, v) => (VALORES_PERMITIDOS_CARLA.includes(Number(v)) ? '' : 'FORA')), n).not.toContain('FORA');
    }
  });

  it('o fatosCarla sem contaRetomada sai igual ao de hoje: a mesma frase da conta, com ou sem o campo', () => {
    const base = contexto({ ehClienteSolarDoc: true });
    const hoje = CARLA.fatos(base);
    expect(hoje).toContain('Conta no SolarDoc com este WhatsApp: sim (o cadastro nasce depois do pagamento).');
    expect(CARLA.fatos({ ...base, contaRetomada: null })).toBe(hoje);
    expect(CARLA.fatos({ ...base, contaRetomada: undefined })).toBe(hoje);
    const naoCliente = contexto({ ehClienteSolarDoc: false });
    expect(CARLA.fatos(naoCliente)).toContain('Conta no SolarDoc com este WhatsApp: não (não diga que liberou).');
  });

  it('com contaRetomada, os fatos da Carla trocam a frase da conta pela situação e levam o Pix automático', () => {
    const f = CARLA.fatos(contexto({ ehClienteSolarDoc: true, contaRetomada: pagou() }));
    expect(f).not.toContain('Conta no SolarDoc com este WhatsApp');
    expect(f).toContain('Situação da conta: já foi assinante (no cartão)');
    expect(f).toContain('Pix: peça pix_automatico');
  });

  it('o SISTEMA_FIXO_CARLA tem a seção da conta, manda não usar a peça assinatura e lista entrar_no_app como peça só para quem já tem conta', () => {
    expect(SISTEMA_FIXO_CARLA).toContain('QUEM JÁ TEM CONTA (os fatos trazem "Situação da conta")');
    expect(SISTEMA_FIXO_CARLA).toContain('Nunca use a peça assinatura: ela cria outra conta e outra cobrança.');
    expect(SISTEMA_FIXO_CARLA).toContain('peça entrar_no_app e diga para entrar no app e tocar em Fazer Upgrade');
    expect(SISTEMA_FIXO_CARLA).toContain(`nunca diga que R$ ${PLANO_MENSAL.valor} dá a plataforma inteira: o que fica em Para liberar é vendido à parte.`);
    expect(SISTEMA_FIXO_CARLA).toContain('- entrar_no_app: https://solardoc.app/auth (só para quem já tem conta; os fatos dizem)');
    expect(LINKS_CARLA.entrar_no_app).toBe('https://solardoc.app/auth');
  });

  it('os exemplos seguem dentro do limite e passando na trava (o exemplo da retomada só entra com o texto novo do redator, D30)', () => {
    expect(EXEMPLOS_CARLA.length).toBeLessThanOrEqual(9);
    expect(EXEMPLOS_CARLA.map(e => e.titulo).join(' ')).not.toMatch(/retomada/i);
  });
});
