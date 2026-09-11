import { describe, it, expect, vi, beforeEach } from 'vitest';

// Recepção da linha IO. O que este arquivo protege não é "a IA classificou
// certo" — isso é do modelo. É a mecânica em volta, que é onde esta casa já se
// machucou:
//
//   POSSE      → a pergunta e a resposta do lead são DOIS webhooks. Sem dono
//                gravado antes da primeira fala sair, a 2ª mensagem cai na
//                cascata e outro robô responde no meio da triagem (25/08).
//   ENTREGA    → conversa entregue ao humano é do humano. A recepção cala.
//   NÃO TRAVAR → no último turno tem que entregar mesmo sem classificação, e
//                triagem abandonada tem que virar aviso. Senão o buraco que o
//                serviço veio tapar (117 pessoas sem resposta em 30 dias) só
//                muda de lugar.
//   TAKEOVER   → o lead nasce com human_takeover, senão os crons de disparo
//                escrevem por cima da conversa do consultor.

const enviadasAoLead: { phone: string; partes: string[] }[] = [];
const avisosInternos: { phone: string; texto: string }[] = [];
let sessoes: Record<string, any> = {};
let leads: any[] = [];
let respostaIA = '';
let chamadasIA = 0;

const chaveSessao = (phone: string, tipo: string) => `${String(phone).replace(/\D/g, '')}|${tipo}`;

function acharSessao(variantes: string[], tipo: string) {
  for (const v of variantes) {
    const s = sessoes[chaveSessao(v, tipo)];
    if (s) return s;
  }
  return null;
}

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const f: any = {};
      let patch: any = null;

      const buscarUm = () => {
        if (tabela === 'whatsapp_sessions') {
          return f.variantes ? acharSessao(f.variantes, f.tipo) : null;
        }
        return leads.find(l => l.phone === f.phone) ?? null;
      };

      const q: any = {
        select: () => q,
        limit: () => q,
        order: () => q,
        in: (_c: string, v: any[]) => { f.variantes = v; return q; },
        eq: (c: string, v: any) => { f[c] = v; return q; },
        lt: (_c: string, v: any) => { f.antesDe = v; return q; },
        filter: (c: string, _op: string, v: any) => { f[c] = v; return q; },
        maybeSingle: () => {
          if (patch) {                       // update().eq(...) sem select
            const alvo = leads.find(l => l.phone === f.phone);
            if (alvo) Object.assign(alvo, patch);
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ data: buscarUm(), error: null });
        },
        upsert: (row: any) => {
          sessoes[chaveSessao(row.phone, row.tipo)] = { ...row };
          return Promise.resolve({ error: null });
        },
        insert: (row: any) => { leads.push({ ...row }); return Promise.resolve({ error: null }); },
        update: (p: any) => { patch = p; return q; },
        then: (ok: any, no?: any) => {
          if (patch) {
            const alvo = leads.find(l => l.phone === f.phone);
            if (alvo) Object.assign(alvo, patch);
            return Promise.resolve({ error: null }).then(ok, no);
          }
          const todas = Object.values(sessoes).filter((s: any) =>
            s.tipo === f.tipo
            && (!f.antesDe || String(s.updated_at) < f.antesDe)
            // o serviço filtra o estado no banco: `.filter('lead_data->>estado', 'eq', ...)`
            && (!f['lead_data->>estado'] || s.lead_data?.estado === f['lead_data->>estado']));
          return Promise.resolve({ data: todas, error: null }).then(ok, no);
        },
      };
      return q;
    },
  },
}));

vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: (phone: string, partes: string[]) => {
    enviadasAoLead.push({ phone, partes });
    return Promise.resolve();
  },
  sendWhatsApp: (phone: string, texto: string) => {
    avisosInternos.push({ phone, texto });
    return Promise.resolve();
  },
}));

vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      create: () => {
        chamadasIA++;
        return Promise.resolve({ content: [{ type: 'text', text: respostaIA }] });
      },
    },
  }),
}));

// variantesBR é a chave de telefone da casa (o 9º dígito vai e volta). Mockado
// pra não arrastar o whatsappAgentService inteiro pro teste.
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  variantesBR: (phone: string) => {
    const d = String(phone).replace(/\D/g, '');
    const c55 = d.startsWith('55') ? d : `55${d}`;
    return Array.from(new Set([d, c55, c55.replace(/^55/, '')]));
  },
}));

let vereditoRobo: any = { nivel: 'nenhum' };
let temRobo = false;
vi.mock('../services/agents/whatsapp/roboDoOutroLado', () => ({
  pareceRoboDeles: () => vereditoRobo,
  temRoboAtendendo: () => Promise.resolve(temRobo),
  marcarRoboDoOutroLado: () => Promise.resolve(),
}));

let silenciados: string[] = [];
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  carregarSilenciados: () => Promise.resolve(
    (phone: string) => silenciados.includes(String(phone).replace(/\D/g, '')),
  ),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: () => {}, error: () => {}, warn: () => {} },
}));

const LEAD = '5534987654321';

function jsonIA(resposta: string, produto: string | null = null, motivo: string | null = null, nome: string | null = null) {
  return JSON.stringify({ resposta, produto, motivo, nome });
}

async function carregar(ativa = true) {
  vi.resetModules();
  process.env.RECEPCAO_IO_ATIVA = ativa ? '1' : '';
  return import('../services/io/recepcaoIo');
}

beforeEach(() => {
  enviadasAoLead.length = 0;
  avisosInternos.length = 0;
  sessoes = {};
  leads = [];
  respostaIA = '';
  chamadasIA = 0;
  vereditoRobo = { nivel: 'nenhum' };
  temRobo = false;
  silenciados = [];
});

describe('recepção da linha IO', () => {
  it('sai desligada: sem RECEPCAO_IO_ATIVA=1 não fala com ninguém', async () => {
    const { handleRecepcaoIo } = await carregar(false);
    respostaIA = jsonIA('Oi! Como posso ajudar?');
    await handleRecepcaoIo(LEAD, 'Bom dia');
    expect(enviadasAoLead).toHaveLength(0);
    expect(chamadasIA).toBe(0);
  });

  it('cumprimento puro: responde, pergunta o motivo e SEGURA a conversa', async () => {
    const { handleRecepcaoIo, recepcaoJaAtende } = await carregar();
    respostaIA = jsonIA('Bom dia! Aqui é a Duda, da Irmãos na Obra.||O que você precisa hoje?');

    await handleRecepcaoIo(LEAD, 'Bom dia');

    expect(enviadasAoLead).toHaveLength(1);
    expect(enviadasAoLead[0].partes).toHaveLength(2);
    // Ninguém é incomodado antes de saber do que se trata.
    expect(avisosInternos).toHaveLength(0);
    expect(leads).toHaveLength(0);
    // E a conversa tem dono: a 2ª mensagem não pode cair em outro robô.
    expect(await recepcaoJaAtende(LEAD)).toBe(true);
  });

  it('grava a posse ANTES de responder — o webhook seguinte já encontra dono', async () => {
    const { handleRecepcaoIo } = await carregar();
    let donoQuandoFalou: boolean | null = null;
    respostaIA = jsonIA('Oi! O que você precisa?');

    // Espia o momento do envio: nesse instante a sessão já tem que existir.
    const mod = await import('../services/agents/zapiClient');
    const original = mod.sendHuman;
    (mod as any).sendHuman = async (p: string, partes: string[]) => {
      donoQuandoFalou = !!sessoes[chaveSessao(LEAD, 'recepcao_io')];
      return original(p, partes, 'io');
    };

    await handleRecepcaoIo(LEAD, 'Oi');
    (mod as any).sendHuman = original;

    expect(donoQuandoFalou).toBe(true);
  });

  it('classificou solar: avisa a Giovanna, registra o lead e solta a conversa', async () => {
    const { handleRecepcaoIo, recepcaoJaAtende } = await carregar();

    respostaIA = jsonIA('Bom dia! Aqui é a Duda.||O que você precisa?');
    await handleRecepcaoIo(LEAD, 'Bom dia');

    respostaIA = jsonIA(
      'Boa! Já vou chamar quem cuida disso.||Em instantes alguém te responde por aqui.',
      'solar', 'Quer energia solar em casa, viu anúncio', 'Marcos',
    );
    await handleRecepcaoIo(LEAD, 'Vi uma propaganda de placa solar');

    expect(avisosInternos).toHaveLength(1);
    expect(avisosInternos[0].phone).toBe('34993396255');           // Giovanna
    expect(avisosInternos[0].texto).toContain('Energia solar');
    expect(avisosInternos[0].texto).toContain('Marcos');

    expect(leads).toHaveLength(1);
    expect(leads[0].tags).toEqual(['recepcao', 'solar']);
    expect(leads[0].lead_origem).toBe('recepcao_io');
    expect(leads[0].instance).toBe('io');
    // Sem isto, reativação/nudge/revisão escrevem por cima do consultor.
    expect(leads[0].human_takeover).toBe(true);

    // Entregue: a recepção não fala mais nesta conversa.
    expect(await recepcaoJaAtende(LEAD)).toBe(false);
  });

  it('lead que JÁ TEM ficha não é rebaixado a "novo"', async () => {
    const { handleRecepcaoIo } = await carregar();
    // Dos 436 números que escreveram na linha em 30 dias, 44 já tinham ficha e
    // 25 estavam em estágio avançado. Um upsert cego jogaria os 25 pra trás.
    leads.push({
      phone: LEAD, nome: 'Marcos Silva', estagio: 'quente',
      lead_origem: 'lead-meta', tags: ['anuncio'], human_takeover: false,
    });

    respostaIA = jsonIA('Já vou chamar alguém.', 'solar', 'Voltou perguntando de placa', 'Marcão');
    await handleRecepcaoIo(LEAD, 'Voltei, quero fechar a placa solar');

    expect(leads).toHaveLength(1);
    expect(leads[0].estagio).toBe('quente');          // estágio preservado
    expect(leads[0].lead_origem).toBe('lead-meta');   // origem preservada
    expect(leads[0].nome).toBe('Marcos Silva');       // nome confirmado por gente manda
    expect(leads[0].tags).toEqual(['anuncio', 'recepcao', 'solar']);
    expect(leads[0].human_takeover).toBe(true);       // isso sim a recepção marca
  });

  it('eletroposto vai pro Thiago E pro Diego', async () => {
    const { handleRecepcaoIo } = await carregar();
    respostaIA = jsonIA('Vou chamar quem cuida disso.', 'eletroposto', 'Quer investir num ponto de recarga');
    await handleRecepcaoIo(LEAD, 'Quero saber sobre o eletroposto');

    expect(avisosInternos.map(a => a.phone).sort()).toEqual(['34991360172', '34991360223']);
  });

  it('depois de entregue, a recepção fica calada mesmo se o lead escrever de novo', async () => {
    const { handleRecepcaoIo } = await carregar();
    respostaIA = jsonIA('Já vou chamar alguém.', 'solar', 'Quer orçamento');
    await handleRecepcaoIo(LEAD, 'Quero orçamento de placa solar');

    const antes = enviadasAoLead.length;
    const avisosAntes = avisosInternos.length;
    respostaIA = jsonIA('Oi de novo!', 'solar', 'Insistiu');
    await handleRecepcaoIo(LEAD, 'E aí, alguém aí?');

    expect(enviadasAoLead).toHaveLength(antes);
    expect(avisosInternos).toHaveLength(avisosAntes);
  });

  it('no último turno entrega como "outro" mesmo se a IA não classificar', async () => {
    const { handleRecepcaoIo } = await carregar();
    respostaIA = jsonIA('Certo!');                                  // produto sempre null

    for (let i = 0; i < 4; i++) await handleRecepcaoIo(LEAD, `mensagem ${i}`);

    expect(avisosInternos).toHaveLength(1);
    expect(avisosInternos[0].texto).toContain('Não identificado');
    expect(leads[0].tags).toEqual(['recepcao', 'outro']);
  });

  it('robô do outro lado: silêncio total, sem gastar IA', async () => {
    const { handleRecepcaoIo } = await carregar();
    vereditoRobo = { nivel: 'certeza', sinal: 'sou o assistente virtual' };
    await handleRecepcaoIo(LEAD, 'Olá, sou o assistente virtual da Solar X');

    expect(enviadasAoLead).toHaveLength(0);
    expect(chamadasIA).toBe(0);
  });

  it('quem pediu pra parar continua parado', async () => {
    const { handleRecepcaoIo } = await carregar();
    silenciados = [LEAD];
    respostaIA = jsonIA('Oi!');
    await handleRecepcaoIo(LEAD, 'Bom dia');

    expect(enviadasAoLead).toHaveLength(0);
  });

  it('resposta sem JSON ainda vira fala — a classificação fica pra próxima', async () => {
    const { handleRecepcaoIo, recepcaoJaAtende } = await carregar();
    respostaIA = 'Bom dia! O que você precisa?';                    // modelo ignorou o formato

    await handleRecepcaoIo(LEAD, 'Oi');

    expect(enviadasAoLead).toHaveLength(1);
    expect(enviadasAoLead[0].partes[0]).toContain('Bom dia');
    expect(await recepcaoJaAtende(LEAD)).toBe(true);
  });
});

describe('triagem abandonada', () => {
  it('parada há mais de 2h vai pro humano, e só uma vez', async () => {
    const { handleRecepcaoIo, entregarTriagensParadas } = await carregar();

    respostaIA = jsonIA('Bom dia! O que você precisa?');
    await handleRecepcaoIo(LEAD, 'Boa tarde');
    expect(avisosInternos).toHaveLength(0);

    // Envelhece a sessão na marra.
    const k = chaveSessao(LEAD, 'recepcao_io');
    sessoes[k].updated_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const r1 = await entregarTriagensParadas();
    expect(r1.entregues).toBe(1);
    expect(avisosInternos).toHaveLength(1);
    expect(avisosInternos[0].texto).toContain('parou de responder');

    // Segunda varredura não pode repetir a ficha pro consultor.
    sessoes[k].updated_at = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const r2 = await entregarTriagensParadas();
    expect(r2.entregues).toBe(0);
    expect(avisosInternos).toHaveLength(1);
  });

  it('não mexe em conversa que ainda está fresca', async () => {
    const { handleRecepcaoIo, entregarTriagensParadas } = await carregar();
    respostaIA = jsonIA('Bom dia! O que você precisa?');
    await handleRecepcaoIo(LEAD, 'Boa tarde');

    const r = await entregarTriagensParadas();
    expect(r.entregues).toBe(0);
    expect(avisosInternos).toHaveLength(0);
  });
});
