import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A resposta do cliente de solar vira recado pro consultor DONO da ficha. O risco
// novo aqui (13/08/2026) é a mídia: o consultor recebia "📎 1 imagem" e o arquivo
// ficava no 5040 — pedir a foto da conta de luz e não entregar a foto da conta de
// luz é o mesmo erro de pedir resposta e não ler a resposta.

const state = new Map<string, any>();
let fichas: any[] = [];
let inbound: any[] = [];
let consultores: any[] = [];
const avisos: Array<{ phone: string; texto: string }> = [];
const midias: Array<{ tipo: string; phone: string; url: string; legenda: string }> = [];
let falharMidia = false;

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        _f: {} as Record<string, any>,
        select() { return q; },
        eq(c: string, v: any) { q._f[c] = v; return q; },
        gte(c: string, v: any) { q._f[`gte_${c}`] = v; return q; },
        lte(c: string, v: any) { q._f[`lte_${c}`] = v; return q; },
        like() { return q; }, order() { return q; },
        upsert(r: any) { state.set(String(r.key), r); return Promise.resolve({ error: null }); },
        limit() {
          if (tabela === 'system_state') return Promise.resolve({ data: [...state.values()], error: null });
          const de = q._f['gte_momment'], ate = q._f['lte_momment'];
          return Promise.resolve({
            data: inbound.filter(m => (!de || m.momment >= de) && (!ate || m.momment <= ate)), error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        select() { return q; }, in() { return q; }, eq() { return q; },
        not() { return q; }, gte() { return q; },
        limit() {
          return Promise.resolve({ data: tabela === 'consultores' ? consultores : fichas, error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../routes/ioSolar', () => ({ EQUIPE: { thiago: '5534991360223' } }));
const cair = () => { if (falharMidia) throw new Error('z-api fora'); };
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => { avisos.push({ phone, texto }); }),
  sendImage: vi.fn(async (phone: string, url: string, legenda: string) => { cair(); midias.push({ tipo: 'imagem', phone, url, legenda }); }),
  sendAudio: vi.fn(async (phone: string, url: string) => { cair(); midias.push({ tipo: 'audio', phone, url, legenda: '' }); }),
  sendVideo: vi.fn(async (phone: string, url: string, legenda: string) => { cair(); midias.push({ tipo: 'video', phone, url, legenda }); }),
  sendDocument: vi.fn(async (phone: string, url: string, _f: string, legenda: string) => { cair(); midias.push({ tipo: 'documento', phone, url, legenda }); }),
}));

const AGORA = new Date('2026-08-13T16:00:00.000Z');
const TOQUE = '2026-08-13T15:00:00.000Z';
const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

const ficha = (over: Partial<any> = {}) => ({
  id: 1, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5569984488158',
  vendedor_nome: 'Nilce', cidade: 'Uberlândia', boas_vindas_at: TOQUE, ...over,
});
// A Z-API entrega o inbound às vezes SEM o 9º dígito.
const msg = (over: Partial<any> = {}) => ({
  telefone: '556984488158', texto: 'meu consumo é 480 kWh', tipo: 'texto',
  media_url: null, momment: antes(5), ...over,
});

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); avisos.length = 0; midias.length = 0; falharMidia = false;
  fichas = [ficha()]; inbound = [msg()];
  consultores = [{ nome: 'Nilce', whatsapp: '5534991516846' }];
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/io/solarRespostas')).runSolarRespostasTick(opts);
}

describe('pra quem vai o recado', () => {
  it('vai pro consultor dono da ficha, com cópia pro dono', async () => {
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(avisos.map(a => a.phone)).toEqual(['5534991516846', '5534991360223']);
    expect(avisos[0]!.texto).toContain('Irineu de Almeida');
    expect(avisos[0]!.texto).toContain('480 kWh');
    expect(avisos[0]!.texto).toContain('Nilce');
  });

  it('avisa uma vez só', async () => {
    await tick();
    avisos.length = 0;
    expect((await tick()).motivo).toBe('ninguem_respondeu');
  });
});

describe('tudo que o cliente manda chega no consultor', () => {
  const foto = (over: Partial<any> = {}) => msg({
    tipo: 'imagem', texto: '', media_url: 'https://z.api/conta-de-luz.jpg', momment: antes(4), ...over,
  });

  it('a foto da conta de luz é ENCAMINHADA, não só contada', async () => {
    inbound = [foto()];
    const r = await tick();
    expect(r.encaminhadas).toBe(2);                       // consultor + dono
    expect(midias.map(m => m.phone)).toEqual(['5534991516846', '5534991360223']);
    expect(midias[0]).toMatchObject({ tipo: 'imagem', url: 'https://z.api/conta-de-luz.jpg' });
    // A legenda diz de quem é: o consultor recebe arquivo de vários clientes no
    // mesmo dia, e foto de conta sem nome não serve pra nada.
    expect(midias[0]!.legenda).toContain('Irineu de Almeida');
  });

  it('áudio, vídeo e documento vão cada um pelo seu canal', async () => {
    inbound = [
      foto({ tipo: 'audio', media_url: 'https://z.api/a.ogg', momment: antes(4) }),
      foto({ tipo: 'video', media_url: 'https://z.api/v.mp4', momment: antes(3) }),
      foto({ tipo: 'documento', media_url: 'https://z.api/c.pdf', momment: antes(2) }),
    ];
    await tick();
    expect(midias.filter(m => m.phone === '5534991516846').map(m => m.tipo))
      .toEqual(['audio', 'video', 'documento']);
  });

  // Rede embaixo do encaminhamento: se o reenvio falhar (ou passar do teto), o
  // consultor ainda alcança o arquivo pelo link que vai no texto.
  it('o link do arquivo vai no texto mesmo quando o reenvio falha', async () => {
    inbound = [foto()];
    falharMidia = true;
    const r = await tick();
    expect(r.avisados).toBe(1);                           // o recado não cai junto
    expect(r.encaminhadas).toBe(0);
    expect(avisos[0]!.texto).toContain('https://z.api/conta-de-luz.jpg');
  });

  // Cliente que manda 12 fotos do telhado não pode virar 24 mensagens na linha.
  it('teto de arquivos por rodada, com o resto alcançável pelo link', async () => {
    inbound = Array.from({ length: 9 }, (_, i) =>
      foto({ media_url: `https://z.api/foto-${i}.jpg`, momment: antes(9 - i) }));
    const r = await tick();
    expect(r.encaminhadas).toBe(12);                      // 6 arquivos × 2 destinatários
    expect(avisos[0]!.texto).toContain('https://z.api/foto-8.jpg');
  });

  it('mensagem só de texto não dispara encaminhamento nenhum', async () => {
    const r = await tick();
    expect(r.encaminhadas).toBe(0);
    expect(midias).toHaveLength(0);
  });

  // O arquivo chega DEPOIS do recado e só pra quem recebeu o recado: foto solta,
  // sem o texto dizendo de quem é, é pior que não chegar.
  it('não manda arquivo pra quem o recado não alcançou', async () => {
    inbound = [foto()];
    const { sendWhatsApp } = await import('../services/agents/zapiClient');
    (sendWhatsApp as any).mockImplementationOnce(async () => { throw new Error('fora'); });
    await tick();
    expect(midias.map(m => m.phone)).toEqual(['5534991360223']);
  });
});

describe('travas', () => {
  it('kill-switch desliga', async () => {
    process.env.SOLAR_RESPOSTAS_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
    expect(avisos).toHaveLength(0);
  });

  it('dry mostra o recado e não envia nada', async () => {
    inbound = [msg({ tipo: 'imagem', media_url: 'https://z.api/x.jpg' })];
    const r = await tick({ dry: true });
    expect(r.previa?.[0]?.recado).toContain('Irineu');
    expect(avisos).toHaveLength(0);
    expect(midias).toHaveLength(0);
  });
});
