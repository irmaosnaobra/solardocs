import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { banco } from './_bancoFalso';

// Aviso `apto_reuniao` (Nível 1 concluído, contato deixado): vai ao Thiago e ao Diego pela linha 5040, a 2ª bolha de 25 a 60 s
// depois; trava do evento e trava por destino; teto decidido por evento (11 na hora ou 5 em 10 min = só e-mail, uma vez);
// falha da 2ª não repete a 1ª nem manda e-mail; o nome digitado passa pelo limpo() e o e-mail é escapado.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const TEL_THIAGO = '5511900000001'; // números inventados só do teste
const TEL_DIEGO = '5511900000002';
const DESTINO_ENV = '5511900000009';
const h = vi.hoisted(() => ({ falhaEm: null as string | null, tabela: 'ok' as 'ok' | 'sem_thiago' | 'sem_diego' | 'falha', cooldown: false, tetoLinha: 'ok' as 'ok' | 'teto' | 'erro' }));
const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => {
    if (h.falhaEm === phone) throw new Error('[zapi:io] em cooldown');
    enviados.push({ phone, texto, linha });
  }),
}));
const emails: Array<{ assunto: string; html: string }> = [];
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async (assunto: string, html: string) => { emails.push({ assunto, html }); }) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: vi.fn(async () => {
    if (h.tabela === 'falha') return { ok: false, codigo: 'PGRST000' };
    const m = new Map<string, string>();
    if (h.tabela !== 'sem_thiago') m.set('thiago', '5511900000001');
    if (h.tabela !== 'sem_diego') m.set('diego', '5511900000002');
    return { ok: true, mapa: m };
  }),
  telefoneDoConsultor: (mapa: Map<string, string>, nome: string) => mapa.get(nome.toLowerCase()) ?? null,
  linhaIoEmCooldown: () => h.cooldown,
  tetoDaLinhaPermiteFicha: vi.fn(async () => h.tetoLinha),
}));

import { avisarComercial, type DadosAviso } from '../services/nexus/avisoComercial';
import { ASSUNTO_APTO, corpoEmailApto, textoApto, type DadosApto } from '../services/nexus/avisoApto';

const UID = '11111111-2222-4333-8444-555555555555';
const PEDIDO = '2026-11-17T12:00:00.000Z';
const PEDIDO_MS = Date.parse(PEDIDO);
const apto: DadosApto = { user_id: UID, pedido_em: PEDIDO, nota: 92, demanda_12m: 8, clientes_em_vista: 3, contato: { nome: 'Maria Souza', whatsapp: '5534991360000', periodo: 'tarde' } };
const parceiro = { id: 'p-1', empresa: 'Solar Exemplo', cidade: 'Uberlândia', uf: 'MG' };
const dados = (extra: Partial<DadosAviso['parceiro']> = {}, a: DadosApto = apto): DadosAviso => ({ parceiro: { ...parceiro, ...extra }, apto: a });
const chaves = () => banco.linhas('system_state').map((r) => String(r.key));

function encher(n: number, minutosAtras: number) {
  for (let i = 0; i < n; i++) banco.poe('system_state', { key: `nexus_aviso:cadastro:antigo-${minutosAtras}-${i}`, value: {}, updated_at: new Date(Date.now() - minutosAtras * 60_000).toISOString() });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // espera de 42,5 s
  banco.reset();
  enviados.length = 0;
  emails.length = 0;
  h.falhaEm = null;
  h.cooldown = false;
  h.tetoLinha = 'ok';
  h.tabela = 'ok';
  delete process.env.NEXUS_AVISO_LIGADO; // o apto_reuniao liga por padrão: sem env nenhuma
  delete process.env.NEXUS_AVISO_PHONE;
  delete process.env.NEXUS_APTO_AVISO_OFF;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  delete process.env.NEXUS_APTO_AVISO_OFF;
});

describe('apto_reuniao: dois destinos', () => {
  it('a 1ª bolha (Thiago) sai já; a 2ª (Diego) só de 25 a 60 s depois, as duas pela linha io e com a trava de cada destino', async () => {
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
    expect(enviados.map((e) => e.phone)).toEqual([TEL_THIAGO]);
    expect(enviados[0]!.linha).toBe('io');
    expect(chaves()).toEqual([`nexus_aviso_evento:apto_reuniao:p-1:${PEDIDO_MS}`, `nexus_aviso:apto_reuniao:p-1:${PEDIDO_MS}:thiago`]);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(enviados).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000); // 44 s no total, dentro da janela de 25 a 60 s
    expect(enviados.map((e) => e.phone)).toEqual([TEL_THIAGO, TEL_DIEGO]);
    expect(chaves()).toContain(`nexus_aviso:apto_reuniao:p-1:${PEDIDO_MS}:diego`);
    expect(enviados[1]!.texto).toBe(enviados[0]!.texto);
    expect(emails).toHaveLength(1); // o e-mail sai sempre, uma vez, com o mesmo conteúdo
    expect(emails[0]!.assunto).toBe(ASSUNTO_APTO);
    expect(emails[0]!.html).toContain('Maria Souza');
  });

  it('o texto tem os dados, o contato e o link da ficha (#trilha/<user_id>)', async () => {
    await avisarComercial('apto_reuniao', dados());
    expect(enviados[0]!.texto).toBe([
      'Novo Raio-X concluído, diagnóstico pedido',
      'Empresa Solar Exemplo, Uberlândia/MG. Nota do Raio-X: 92.',
      'Demanda em 12 meses: 8. Clientes em vista: 3.',
      'Contato: Maria Souza, 5534991360000.',
      'Melhor período: Tarde',
      `Ficha: https://solardoc.app/nexus/adm/#trilha/${UID}`,
    ].join('\n'));
  });

  it('o mesmo parceiro duas vezes: a segunda dá duplicado, sem nenhuma bolha nova', async () => {
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(2);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('duplicado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(2);
    expect(emails).toHaveLength(1);
  });

  it('pedido refeito depois de "ainda não" (diag_pedido_em novo) avisa de novo; o mesmo pedido, uma vez só', async () => {
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(2);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('duplicado');
    const refeito = { ...apto, pedido_em: '2026-11-20T09:00:00.000Z' };
    expect(await avisarComercial('apto_reuniao', dados({}, refeito))).toBe('enviado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(4);
    expect(emails).toHaveLength(2);
    expect(await avisarComercial('apto_reuniao', dados({}, refeito))).toBe('duplicado');
    expect(enviados).toHaveLength(4);
  });

  it('falha da 2ª bolha: não repete a 1ª, não manda e-mail em dobro e não lança', async () => {
    h.falhaEm = TEL_DIEGO;
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados.map((e) => e.phone)).toEqual([TEL_THIAGO]);
    expect(emails).toHaveLength(1);
  });

  it('falha da 1ª bolha: um e-mail só, e a 2ª não sai', async () => {
    h.falhaEm = TEL_THIAGO;
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.assunto).toBe(ASSUNTO_APTO);
  });

  it('Thiago fora da tabela e sem NEXUS_AVISO_PHONE: sem WhatsApp para ele, só o Diego; o e-mail sai', async () => {
    h.tabela = 'sem_thiago';
    await avisarComercial('apto_reuniao', dados());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados.map((e) => e.phone)).toEqual([TEL_DIEGO]);
    expect(emails).toHaveLength(1);
  });

  it('Thiago fora da tabela de consultores: recebe no NEXUS_AVISO_PHONE; Diego fora: só o Thiago', async () => {
    process.env.NEXUS_AVISO_PHONE = DESTINO_ENV;
    h.tabela = 'sem_thiago';
    await avisarComercial('apto_reuniao', dados());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados.map((e) => e.phone)).toEqual([DESTINO_ENV, TEL_DIEGO]);
    banco.reset(); enviados.length = 0;
    h.tabela = 'sem_diego';
    await avisarComercial('apto_reuniao', dados());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados.map((e) => e.phone)).toEqual([TEL_THIAGO]);
    banco.reset(); enviados.length = 0;
    h.tabela = 'falha';
    await avisarComercial('apto_reuniao', dados());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados.map((e) => e.phone)).toEqual([DESTINO_ENV]);
  });

  it('tabela de consultores ilegível e sem NEXUS_AVISO_PHONE: nenhum WhatsApp, mas o e-mail sai uma vez', async () => {
    h.tabela = 'falha';
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('NEXUS_APTO_AVISO_OFF=1: desligado, não toma trava, não envia WhatsApp nem e-mail', async () => {
    process.env.NEXUS_APTO_AVISO_OFF = '1';
    expect(await avisarComercial('apto_reuniao', dados())).toBe('desligado');
    expect(chaves()).toEqual([]);
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });
});

describe('apto_reuniao: estado da linha inteira', () => {
  it('linha em cooldown: o evento vai só por e-mail, uma vez, sem bolha nem trava de destino', async () => {
    h.cooldown = true;
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(chaves().filter((c) => c.startsWith('nexus_aviso:apto_reuniao'))).toEqual([]);
  });

  it('linha no teto (ou sem como contar): só e-mail; com "ok" sai o WhatsApp', async () => {
    h.tetoLinha = 'teto';
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    h.tetoLinha = 'erro';
    expect(await avisarComercial('apto_reuniao', dados({ id: 'p-2' }))).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(2);
    h.tetoLinha = 'ok';
    expect(await avisarComercial('apto_reuniao', dados({ id: 'p-3' }))).toBe('enviado');
  });
});

describe('apto_reuniao: teto por evento', () => {
  it('com 11 chaves na última hora o evento inteiro vai só por e-mail, uma vez, sem bolha nem trava de destino', async () => {
    encher(11, 40);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.assunto).toBe('Novo Raio-X concluído, parceiro pede diagnóstico');
    expect(chaves().filter((c) => c.startsWith('nexus_aviso:apto_reuniao'))).toEqual([]);
    // o mesmo parceiro de novo não reenvia o e-mail
    expect(await avisarComercial('apto_reuniao', dados())).toBe('duplicado');
    expect(emails).toHaveLength(1);
  });

  it('com 5 chaves nos últimos 10 minutos também vai só por e-mail; com 4 ainda sai pelo WhatsApp', async () => {
    encher(4, 5);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(enviados).toHaveLength(2); // as 2 bolhas do evento não entram na decisão deste mesmo evento
    banco.reset(); enviados.length = 0; emails.length = 0;
    encher(5, 5);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('com 10 na hora e nada na rajada ainda cabe (limite é 11)', async () => {
    encher(10, 40);
    expect(await avisarComercial('apto_reuniao', dados())).toBe('enviado');
  });

  it('o evento seguinte conta as bolhas do anterior (2 por evento): 3 eventos em 10 min cheios vão só por e-mail', async () => {
    for (const id of ['p-1', 'p-2']) { await avisarComercial('apto_reuniao', dados({ id })); await vi.advanceTimersByTimeAsync(61_000); }
    expect(enviados).toHaveLength(4);
    expect(await avisarComercial('apto_reuniao', dados({ id: 'p-3' }))).toBe('enviado'); // 4 bolhas, ainda abaixo de 5
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await avisarComercial('apto_reuniao', dados({ id: 'p-4' }))).toBe('email'); // 6 bolhas
  });
});

describe('apto_reuniao: texto de gente', () => {
  it('o nome digitado entra pelo limpo(): sem formatação do WhatsApp, sem tag e sem quebra de linha', async () => {
    const a: DadosApto = { ...apto, contato: { nome: '*Maria*\n_Souza_ <b>x</b>', whatsapp: '5534991360000', periodo: 'noite' } };
    const t = textoApto(parceiro, a);
    expect(t).toContain('Contato: Maria Souza b x /b, 5534991360000.');
    expect(t.split('\n')).toHaveLength(6);
    expect(t).toContain('Melhor período: Noite');
    expect(t).not.toMatch(/[*_~`<>]/);
  });

  it('o e-mail usa o texto aprovado, escapa o HTML e converte a quebra em <br>; o assunto é texto fixo', async () => {
    const corpo = corpoEmailApto({ ...parceiro, empresa: 'Solar & <script>x</script> Ltda' }, apto);
    expect(corpo.split('\n')[0]).toBe('Um parceiro concluiu o Raio-X e pediu a reunião de diagnóstico.');
    expect(corpo).toContain('Ficha completa: https://solardoc.app/nexus/adm/#trilha/' + UID);
    expect(corpo).toContain('WhatsApp: 5534991360000\nMelhor período: Tarde\nFicha completa');
    expect(corpo.endsWith('Chame o contato para combinar o horário.')).toBe(true);
    h.falhaEm = TEL_THIAGO;
    await avisarComercial('apto_reuniao', dados({ empresa: 'Solar & <script>x</script> Ltda' }));
    const html = emails[0]!.html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('<br>');
    expect(html).toContain('Empresa: Solar');
    expect(emails[0]!.assunto).toBe(ASSUNTO_APTO);
  });

  it('id que não é UUID não vai para o link da ficha', () => {
    expect(textoApto(parceiro, { ...apto, user_id: 'x"><script>' })).toContain('Ficha: https://solardoc.app/nexus/adm/#trilha');
    expect(textoApto(parceiro, { ...apto, user_id: 'x"><script>' })).not.toContain('script');
  });
});
