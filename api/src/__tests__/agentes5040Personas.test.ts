import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARLA, EXEMPLOS_CARLA, LINKS_CARLA } from '../services/agentes5040/personas/carla';
import { ACOES_DUDA_SEM_FALA, DUDA, EXEMPLOS_DUDA } from '../services/agentes5040/personas/duda';
import { HELENA, EXEMPLOS_HELENA } from '../services/agentes5040/personas/helena';
import { ACOES_SEM_FALA, observacaoSemDiagnostico, semTelefone, type ExemploPersona } from '../services/agentes5040/personas/comum';
import { validarFala } from '../services/agentes5040/trava';
import { lerSaida, schemaSaidaAgente, type ContextoLead, type MsgConversa, type PersonaDef } from '../services/agentes5040/tipos';
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
