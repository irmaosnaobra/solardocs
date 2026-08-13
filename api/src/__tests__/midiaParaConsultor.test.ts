import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mídia que o lead manda na linha da empresa tem que chegar no WhatsApp do
// consultor dele. O que estes testes trancam é o que faz esse caminho falhar em
// silêncio: dono escrito de qualquer jeito no banco, lead sem dono nenhum, ID de
// grupo passando pelo formatador de telefone, Z-API recusando a própria URL de
// mídia, e um lead sozinho lotando o celular do consultor.

const state = new Map<string, { key: string; value?: any; updated_at?: string }>();
// Como o CRM guarda o telefone deste lead: no banco real convivem "5534..." e
// "34...", e o nome tem que aparecer nos dois casos.
let leadPhone = '5534988887777';
let leadNome: string | null = 'Fulano da Silva';
// Cadastro da linha B2B: cliente da plataforma mora em `users`, não no CRM solar.
let userNome: string | null = null;
let dono: string | null = null;
let imagemBaixa = true;
let falharMidia = false;

const enviados: Array<{ path: string; body: any; linha?: string }> = [];

function fakeMain() {
  return {
    from: (tabela: string) => {
      const q: any = {
        _like: null as string | null, _ilike: null as string | null,
        select() { return q; },
        like(_c: string, p: string) { q._like = p.replace(/%$/, ''); return q; },
        ilike(_c: string, p: string) { q._ilike = p.replace(/^%/, ''); return q; },
        gte() { return q; },
        eq(_c: string, v: string) { q._eq = v; return q; },
        limit() {
          if (tabela === 'sdr_leads' || tabela === 'users') {
            const casa = q._ilike && leadPhone.endsWith(q._ilike);
            const nome = tabela === 'users' ? userNome : leadNome;
            if (!casa || !nome) return Promise.resolve({ data: [], error: null });
            return Promise.resolve({
              data: [tabela === 'users' ? { nome, whatsapp: leadPhone } : { nome, phone: leadPhone }],
              error: null,
            });
          }
          const linhas = [...state.values()].filter(r => q._eq
            ? r.key === q._eq
            : (!q._like || r.key.startsWith(q._like)));
          return Promise.resolve({ data: linhas, error: null });
        },
        upsert(p: any) {
          for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
}

vi.mock('../utils/supabase', () => ({ supabase: fakeMain() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agenda/leadsMetaService', () => ({
  donoDoTelefone: async () => dono,
}));
vi.mock('../utils/mediaProcessor', () => ({
  downloadImageAsAnthropicSource: async () =>
    (imagemBaixa ? { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } : null),
}));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (raw: string) => {
    const d = String(raw).replace(/\D/g, '');
    return d.startsWith('55') ? d : `55${d}`;
  },
  zapiPost: async (path: string, body: any, _retries?: number, linha?: string) => {
    if (falharMidia && path !== 'send-text') throw new Error('Z-API recusou a URL');
    enviados.push({ path, body, linha });
    return { messageId: 'x' };
  },
}));

import { encaminharMidiaAoConsultor } from '../services/io/encaminharMidiaConsultor';

const LEAD = '5534988887777';
const foto = { url: 'https://zapi/img.jpg', type: 'image' as const, mime: 'image/jpeg' };

beforeEach(() => {
  state.clear();
  enviados.length = 0;
  leadNome = 'Fulano da Silva';
  userNome = null;
  leadPhone = '5534988887777';
  dono = null;
  imagemBaixa = true;
  falharMidia = false;
  delete process.env.MIDIA_FWD_OFF;
  process.env.ZAPI_IO_GROUP_ID = '120363424419098566-group';
});

afterEach(() => { delete process.env.MIDIA_FWD_OFF; });

describe('mídia do lead → consultor dono', () => {
  it('manda cartão + foto pro WhatsApp do dono, com o nome do banco escrito de qualquer jeito', async () => {
    dono = 'Thiago Silva';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: { ...foto, caption: 'minha conta de luz' } });

    expect(enviados.map(e => e.path)).toEqual(['send-text', 'send-image']);
    // Todos pro número do Thiago — nunca pro grupo, nunca pro lead.
    expect(enviados.every(e => e.body.phone === '5534991360223')).toBe(true);
    expect(enviados[0].body.message).toContain('Fulano da Silva');
    expect(enviados[0].body.message).toContain('wa.me/5534988887777');
    // A legenda que o lead digitou não pode sumir: é ela que diz o que é a foto.
    expect(enviados[0].body.message).toContain('minha conta de luz');
    // Foto vai em base64 (mesmo caminho já provado no comprovante de Pix).
    expect(enviados[1].body.image).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('acentua e sobrenome não quebram o roteamento', async () => {
    dono = 'NILCE';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados[0].body.phone).toBe('5534991516846');
  });

  it('lead sem dono cai no grupo interno, com o ID cru (sem virar telefone)', async () => {
    dono = null;
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados.length).toBe(2);
    expect(enviados[0].body.phone).toBe('120363424419098566-group');
    expect(enviados[0].body.phone).not.toMatch(/^55/);
  });

  it('vendedor fora da equipe também cai no grupo em vez de sumir', async () => {
    dono = 'Parceiro Externo';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados[0].body.phone).toBe('120363424419098566-group');
  });

  it('áudio vai como nota de voz, com o cartão de identificação ANTES', async () => {
    dono = 'diego';
    await encaminharMidiaAoConsultor({
      phone: LEAD, media: { url: 'https://zapi/a.ogg', type: 'audio', mime: 'audio/ogg' },
    });
    expect(enviados.map(e => e.path)).toEqual(['send-text', 'send-audio']);
    expect(enviados[0].body.message).toContain('ÁUDIO DO LEAD');
    expect(enviados[1].body.audio).toBe('https://zapi/a.ogg');
  });

  it('documento vai pelo endpoint com a extensão do arquivo', async () => {
    dono = 'thiago';
    await encaminharMidiaAoConsultor({
      phone: LEAD,
      media: {
        url: 'https://zapi/d.pdf', type: 'document', mime: 'application/pdf',
        fileName: 'conta-cemig.PDF',
      },
    });
    expect(enviados[1].path).toBe('send-document/pdf');
    expect(enviados[1].body.fileName).toBe('conta-cemig.PDF');
  });

  it('Z-API recusando a mídia vira link em texto — nada se perde', async () => {
    dono = 'thiago';
    falharMidia = true;
    await encaminharMidiaAoConsultor({
      phone: LEAD, media: { url: 'https://zapi/v.mp4', type: 'video', mime: 'video/mp4' },
    });
    expect(enviados.map(e => e.path)).toEqual(['send-text', 'send-text']);
    expect(enviados[1].body.message).toContain('https://zapi/v.mp4');
  });

  it('imagem que não baixa também cai no link, sem derrubar o webhook', async () => {
    dono = 'thiago';
    imagemBaixa = false;
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados[1].path).toBe('send-text');
    expect(enviados[1].body.message).toContain('https://zapi/img.jpg');
  });

  it('teto por lead: passou de 12 numa hora, para de reenviar e avisa UMA vez', async () => {
    dono = 'thiago';
    for (let i = 0; i < 13; i++) {
      await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, messageId: `m${i}` });
    }
    // 12 encaminhamentos (2 envios cada) + 1 aviso de teto.
    expect(enviados.length).toBe(12 * 2 + 1);
    expect(enviados[enviados.length - 1].body.message).toContain('Parei de encaminhar');

    // Mais mídia depois do teto não gera aviso novo — um por hora.
    const antes = enviados.length;
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, messageId: 'm99' });
    expect(enviados.length).toBe(antes);
  });

  it('nenhum lead fica de fora: na linha B2B, sem dono, a mídia vai pro Thiago', async () => {
    dono = null;
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, linha: 'solardoc' });
    expect(enviados.length).toBe(2);
    expect(enviados[0].body.phone).toBe('5534991360223');
    // Sai pela MESMA linha em que chegou — senão o consultor responde do número errado.
    expect(enviados.every(e => e.linha === 'solardoc')).toBe(true);
  });

  it('na linha B2B o nome vem de `users`, não do CRM de energia', async () => {
    dono = null;
    leadNome = 'Homônimo do CRM solar';
    userNome = 'Cliente da Plataforma';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, linha: 'solardoc' });
    expect(enviados[0].body.message).toContain('Cliente da Plataforma');
    expect(enviados[0].body.message).not.toContain('Homônimo do CRM solar');
  });

  // Em 14 dias a fila teve 40 stories contra 54 mídias de lead. Encaminhar story
  // entrega o dia inteiro dos contatos no celular do consultor.
  it.each([
    ['status@broadcast', 'story do WhatsApp'],
    ['120363424419098566-group', 'grupo'],
    ['5534991360223', 'número da própria equipe'],
  ])('não encaminha %s (%s)', async (remetente) => {
    dono = 'thiago';
    await encaminharMidiaAoConsultor({ phone: remetente, media: foto });
    expect(enviados.length).toBe(0);
  });

  it('mesma mensagem duas vezes (retry da fila) encaminha uma só', async () => {
    dono = 'thiago';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, messageId: 'fila-123' });
    expect(enviados.length).toBe(2);
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, messageId: 'fila-123' });
    expect(enviados.length).toBe(2);
  });

  it('mídia da linha IO sai pela linha IO', async () => {
    dono = 'diego';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados.every(e => e.linha === 'io')).toBe(true);
  });

  it('kill-switch MIDIA_FWD_OFF desliga tudo', async () => {
    dono = 'thiago';
    process.env.MIDIA_FWD_OFF = '1';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados.length).toBe(0);
  });

  it('acha o nome no CRM mesmo com o telefone gravado sem o 55', async () => {
    dono = 'thiago';
    leadPhone = '34988887777';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto });
    expect(enviados[0].body.message).toContain('Fulano da Silva');
  });

  it('não pega o nome de outro cliente que só termina igual (DDD diferente)', async () => {
    dono = 'thiago';
    leadPhone = '5511988887777';
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, nome: 'Pushname' });
    expect(enviados[0].body.message).toContain('Pushname');
    expect(enviados[0].body.message).not.toContain('Fulano da Silva');
  });

  it('lead sem nome no CRM ainda chega identificado pelo pushname', async () => {
    dono = 'thiago';
    leadNome = null;
    await encaminharMidiaAoConsultor({ phone: LEAD, media: foto, nome: 'Zé do WhatsApp' });
    expect(enviados[0].body.message).toContain('Zé do WhatsApp');
  });
});
