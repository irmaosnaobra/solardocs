import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RECUPERAÇÃO DE CHECKOUT ABANDONADO — o WhatsApp atrás do portão anti-ban (chefe-antiban, linha 5040).
// Banco em memória e relógio fixo (só o Date, para o sleep não travar). Janela, claim, cadência e opener são os REAIS;
// o envio (sendFrio), o e-mail, a IA, o teto/espaçamento da linha, a pausa humana e a lista de mudos são falsos e controlados.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  frio: [] as Array<{ tel: string; partes: string[]; instancia: string }>,
  frioRetorno: true as boolean,
  frioErro: false as boolean,
  emails: [] as unknown[],
  resposta: 'Oi! Aqui é a Giovanna, do SolarDoc || Vi que o pagamento não completou, foi o cartão?',
  teto: true,
  espacamento: true,
  podeFalar: true,
  mudos: new Set<string>(),
  suprimidos: new Set<string>(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({ messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: h.resposta }] })) } }),
}));
vi.mock('../utils/ofertaCupom', async () => ({
  ...(await vi.importActual<typeof import('../utils/ofertaCupom')>('../utils/ofertaCupom')),
  ofertaCupomAtiva: async () => null,
}));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, linhaEmCooldown: () => false, solardocViaIo: () => false,
  sleep: async () => undefined,
  sendHuman: vi.fn(async () => { throw new Error('o opener frio não pode usar sendHuman'); }),
  sendFrio: vi.fn(async (tel: string, partes: string[], instancia: string) => {
    h.frio.push({ tel, partes, instancia });
    if (h.frioErro) throw new Error('Z-API 400: numero invalido');
    return h.frioRetorno;
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async () => ({
  ...(await vi.importActual<typeof import('../services/agents/whatsapp/lineThrottle')>('../services/agents/whatsapp/lineThrottle')),
  dentroDoTetoHorarioLinha: vi.fn(async () => h.teto),
  respeitaEspacamentoLinha: vi.fn(async () => h.espacamento),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => (h.podeFalar ? { pode: true, motivo: 'sem-pausa' } : { pode: false, motivo: 'humano-ativo', desde: '', quem: null })),
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  TOQUES_ATE_DESISTIR: 3,
  motivosDaSupressao: vi.fn(async (tel: string) => (h.suprimidos.has(tel) ? ['opt_out'] : [])),
  carregarMudos: vi.fn(async () => (tel: string) => h.mudos.has(tel)),
}));
vi.mock('../services/agentes5040/posse', () => ({ cedeAAgente: async () => false, lerPosse: async () => null }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ registrarMsgProativa: vi.fn(async () => undefined) }));
vi.mock('../utils/mailer', () => ({
  sendAbandonedCartEmail: vi.fn(async (o: unknown) => { h.emails.push(o); }),
  sendOpsAlert: vi.fn(async () => undefined),
  sendFollowupEmail: vi.fn(), sendNoContractsReminderEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(),
  sendCheckoutRecoveryEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(), sendUpgradeNudgeEmail: vi.fn(),
}));

import { banco } from './_bancoFalso';
import { recoverAbandonedCheckouts } from '../services/followupService';
import { emBolhas } from '../services/agents/bolhas';

const TEL = '5534991110001';
const TEL2 = '5534992220002';
// Quarta-feira, 04/11/2026: dia útil, sem feriado.
const DEZ_BRT = '2026-11-04T13:00:00.000Z';
const VINTE_E_UMA_BRT = '2026-11-05T00:00:00.000Z';
const MIN = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();

function abandono(over: Record<string, unknown> = {}): void {
  const n = banco.linhas('abandoned_checkouts').length + 1;
  banco.poe('abandoned_checkouts', {
    id: `ab-${n}`, session_id: `cs_${n}`, email: `lead${n}@teste.com`, phone: TEL, nome: 'Lead', plano: null,
    status: 'abandoned', recovery_attempts: 0, recovery_sent_at: null, created_at: MIN(180), ...over,
  });
}
const linhaDe = (id: string) => banco.linhas('abandoned_checkouts').find(r => r.id === id)!;
const carimbos = () => banco.linhas('system_state').filter(r => String(r.key).startsWith('rec_checkout_sent:'));

beforeEach(() => {
  banco.reset();
  h.frio.length = 0; h.emails.length = 0;
  h.frioRetorno = true; h.frioErro = false; h.teto = true; h.espacamento = true; h.podeFalar = true;
  h.mudos.clear(); h.suprimidos.clear();
  h.resposta = 'Oi! Aqui é a Giovanna, do SolarDoc || Vi que o pagamento não completou, foi o cartão?';
  process.env.SOLARDOC_PIX_CHECKOUT_URL = 'https://pay.kiwify.com.br/TESTE';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(DEZ_BRT));
});
afterEach(() => { vi.useRealTimers(); });

describe('recuperação de checkout — portão do WhatsApp', () => {
  it('às 10h de um dia útil: 1 carimbo, 1 chamada de sendFrio, 1 bolha, pela linha solardoc; o toque avança', async () => {
    abandono();
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(1);
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.instancia).toBe('solardoc');
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(emBolhas(h.frio[0]!.partes[0], { maxBolhas: 1, max: 900 })).toHaveLength(1);
    expect(carimbos().map(c => c.key)).toEqual(['rec_checkout_sent:ab-1:1']);
    expect(h.emails).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('o toque com caminho (link e cupom) continua numa bolha só', async () => {
    h.resposta = 'Voltei rapidinho, te mando o caminho? || Leva 2 minutos. [[ENVIAR_LINK]]';
    abandono({ recovery_attempts: 1, recovery_sent_at: MIN(25 * 60) });
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).toContain('solardoc');
    expect(emBolhas(h.frio[0]!.partes[0], { maxBolhas: 1, max: 900 })).toHaveLength(1);
    expect(carimbos().map(c => c.key)).toEqual(['rec_checkout_sent:ab-1:2']);
    expect(linhaDe('ab-1').recovery_attempts).toBe(2);
  });

  it('o Pix, quando o toque o pede, vai sozinho no fim: texto numa chamada, Pix noutra', async () => {
    h.resposta = 'Claro, segue aqui [[ENVIAR_PIX]]';
    abandono();
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(2);
    expect(h.frio[0]!.partes).toEqual(['Claro, segue aqui']);
    expect(h.frio[1]!.partes).toHaveLength(1);
    expect(h.frio[1]!.partes[0]).toContain('https://pay.kiwify.com.br/TESTE');
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('duas rodadas simultâneas (dois relógios do /cron/master) mandam o toque 1 uma vez só', async () => {
    abandono();
    await Promise.all([recoverAbandonedCheckouts(), recoverAbandonedCheckouts()]);
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(carimbos()).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('o claim barra mesmo se a gravação do toque falhou: a rodada seguinte não repete o WhatsApp', async () => {
    abandono();
    banco.poe('system_state', { key: 'rec_checkout_sent:ab-1:1', value: {}, updated_at: new Date().toISOString() });
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
  });

  it('às 21h de Brasília: sai o e-mail, o WhatsApp não, o toque não avança e não fica carimbo; a rodada seguinte não repete o e-mail', async () => {
    vi.setSystemTime(new Date(VINTE_E_UMA_BRT));
    abandono({ created_at: MIN(180) });
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(0);
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(carimbos()).toHaveLength(0);

    await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(1);          // o e-mail daquele toque não repete

    // De manhã o WhatsApp sai e o toque avança, sem e-mail de novo.
    vi.setSystemTime(new Date('2026-11-05T13:00:00.000Z'));
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('domingo, mesmo às 10h, é fora da janela', async () => {
    vi.setSystemTime(new Date('2026-11-08T13:00:00.000Z'));
    abandono();
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
  });

  it('teto cheio: o e-mail sai uma vez e o WhatsApp fica para o próximo tick', async () => {
    h.teto = false;
    abandono();
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(0);
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(carimbos()).toHaveLength(0);

    await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(1);
    h.teto = true;
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('espaçamento segurando: o e-mail sai uma vez e o WhatsApp fica para o próximo tick', async () => {
    h.espacamento = false;
    abandono();
    await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    h.espacamento = true;
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
  });

  it('humano na conversa (pausa humana): segura como o teto, sem WhatsApp e sem avançar', async () => {
    h.podeFalar = false;
    abandono();
    await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
  });

  it('mudo ou suprimido: corte da pessoa, não da hora. Sem WhatsApp, o e-mail sai e o toque avança', async () => {
    h.mudos.add(TEL);
    abandono();
    abandono({ phone: TEL2 });
    h.suprimidos.add(TEL2);
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(2);
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(2);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
    expect(linhaDe('ab-2').recovery_attempts).toBe(1);
  });

  it('sendFrio devolvendo false: o toque não avança, o carimbo é desfeito e a perna do WhatsApp para pelo resto da rodada', async () => {
    h.frioRetorno = false;
    abandono();
    abandono({ phone: TEL2 });
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(0);
    expect(h.frio).toHaveLength(1);            // o segundo checkout nem tentou
    expect(carimbos()).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(linhaDe('ab-2').recovery_attempts).toBe(0);
    expect(h.emails).toHaveLength(2);          // cada e-mail uma vez

    // Próximo tick, o sendFrio volta: o primeiro sai (um por rodada) e o e-mail não repete.
    h.frioRetorno = true;
    const r2 = await recoverAbandonedCheckouts();
    expect(r2.sent).toBe(1);
    expect(h.emails).toHaveLength(2);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
    expect(linhaDe('ab-2').recovery_attempts).toBe(0);
  });

  it('um WhatsApp por rodada: o segundo checkout espera o próximo tick', async () => {
    abandono();
    abandono({ phone: TEL2 });
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(1);
    expect(h.frio).toHaveLength(1);
    expect(linhaDe('ab-2').recovery_attempts).toBe(0);
  });

  it('4º toque: só e-mail, sem WhatsApp, e o toque avança', async () => {
    abandono({ recovery_attempts: 3, recovery_sent_at: MIN(100 * 60) });
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(1);
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(carimbos()).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(4);
  });

  it('origem quiz (marca abandono_quiz:): só e-mail, como hoje', async () => {
    abandono();
    banco.poe('system_state', { key: 'abandono_quiz:cs_1', value: {}, updated_at: new Date().toISOString() });
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(1);
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(0);
    expect(carimbos()).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('o 1º toque sai com 15 min (e não antes)', async () => {
    abandono({ created_at: MIN(14) });
    expect((await recoverAbandonedCheckouts()).sent).toBe(0);
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(0);

    banco.reset();
    abandono({ created_at: MIN(16) });
    expect((await recoverAbandonedCheckouts()).sent).toBe(1);
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
  });

  it('linha pausada (ag5040_linha_pausa): segura como o teto, e-mail uma vez, toque não avança', async () => {
    banco.poe('system_state', { key: 'ag5040_linha_pausa', value: { ate: new Date(Date.now() + 30 * 60_000).toISOString() }, updated_at: new Date().toISOString() });
    abandono();
    await recoverAbandonedCheckouts();
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(carimbos()).toHaveLength(0);
    // Pausa vencida: a linha volta e o toque sai.
    banco.linhas('system_state').find(r => r.key === 'ag5040_linha_pausa')!.value = { ate: new Date(Date.now() - 60_000).toISOString() };
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('claim NOVO (menos de 60 min) não é retomado', async () => {
    abandono();
    banco.poe('system_state', { key: 'rec_checkout_sent:ab-1:1', value: { em: MIN(10) }, updated_at: MIN(10) });
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(banco.linhas('system_state').filter(r => r.key === 'rec_checkout_sent:ab-1:1')).toHaveLength(1);
  });

  it('claim VELHO (mais de 60 min, sem marca de enviado) é retomado UMA vez, mesmo com duas rodadas simultâneas', async () => {
    abandono();
    banco.poe('system_state', { key: 'rec_checkout_sent:ab-1:1', value: { em: MIN(90) }, updated_at: MIN(90) });
    await Promise.all([recoverAbandonedCheckouts(), recoverAbandonedCheckouts()]);
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
    const claims = banco.linhas('system_state').filter(r => r.key === 'rec_checkout_sent:ab-1:1');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.value.enviado).toBe(true);
  });

  it('claim velho COM marca de enviado nunca é reenviado: o toque só avança', async () => {
    abandono();
    banco.poe('system_state', { key: 'rec_checkout_sent:ab-1:1', value: { enviado: true, em: MIN(90) }, updated_at: MIN(90) });
    const r = await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
    expect(r.sent).toBe(0);                     // nada saiu agora: só o avanço foi gravado
  });

  it('sendFrio LANÇA erro (número inválido, 5xx): o claim fica marcado falhou, o toque avança só com e-mail, conta 1 falha e a rodada para', async () => {
    h.frioErro = true;
    abandono();
    abandono({ phone: TEL2 });
    const r = await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(1);                       // o 2º checkout nem tentou
    expect(h.emails).toHaveLength(2);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);   // avança
    expect(linhaDe('ab-2').recovery_attempts).toBe(0);   // segurado: a perna do WhatsApp parou
    expect(r.sent).toBe(1);
    const claim = banco.linhas('system_state').find(c => c.key === 'rec_checkout_sent:ab-1:1')!;
    expect(claim.value.falhou).toBe(true);
    expect(banco.linhas('system_state').find(c => c.key === 'rec_checkout_falha:ab-1')!.value.n).toBe(1);
  });

  it('claim com falhou nunca é retomado, nem velho: o toque só avança, sem WhatsApp', async () => {
    abandono();
    banco.poe('system_state', { key: 'rec_checkout_sent:ab-1:1', value: { falhou: true, em: MIN(300) }, updated_at: MIN(300) });
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('2 falhas: os toques seguintes dessa pessoa vão só por e-mail, sem tentar o WhatsApp', async () => {
    h.frioErro = true;
    abandono();
    await recoverAbandonedCheckouts();                                           // toque 1: lança (1 falha)
    banco.linhas('abandoned_checkouts')[0]!.recovery_sent_at = MIN(25 * 60);
    await recoverAbandonedCheckouts();                                           // toque 2: lança (2 falhas)
    expect(h.frio).toHaveLength(2);
    expect(linhaDe('ab-1').recovery_attempts).toBe(2);
    expect(banco.linhas('system_state').find(c => c.key === 'rec_checkout_falha:ab-1')!.value.n).toBe(2);
    banco.linhas('abandoned_checkouts')[0]!.recovery_sent_at = MIN(49 * 60);
    h.frioErro = false;
    await recoverAbandonedCheckouts();                                           // toque 3: só e-mail
    expect(h.frio).toHaveLength(2);
    expect(h.emails).toHaveLength(3);
    expect(linhaDe('ab-1').recovery_attempts).toBe(3);
  });

  it('Pix manual: o código sai SOZINHO no 2º sendFrio; o 1º leva o texto com valor e comprovante, sem o código', async () => {
    delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
    h.resposta = 'Claro, segue o Pix [[ENVIAR_PIX]]';
    abandono();
    await recoverAbandonedCheckouts();
    expect(h.frio).toHaveLength(2);
    const codigo = h.frio[1]!.partes;
    expect(codigo).toHaveLength(1);
    // Exatamente o código: começa no 000201, termina no CRC (6304 + 4 hex) e não tem
    // quebra de linha. Espaço pode haver dentro dele (nome do recebedor, "AIOROS GROUP").
    expect(codigo[0]).toMatch(/^000201[^\r\n]+6304[0-9A-F]{4}$/);
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).not.toContain('000201');
    expect(h.frio[0]!.partes[0]).toContain('Claro, segue o Pix');
    expect(h.frio[0]!.partes[0]).toContain('R$ 67');
    expect(h.frio[0]!.partes[0]).toContain('comprovante');
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('insert da marca do e-mail com chave repetida (23505): o e-mail não sai, o WhatsApp segue e o toque avança', async () => {
    abandono();
    banco.falhas['system_state.insert'] = { erro: { code: '23505', message: 'duplicate key' }, uma: true, pular: 1 };   // o 1º insert é o claim
    const r = await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(0);
    expect(h.frio).toHaveLength(1);
    expect(r.sent).toBe(1);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });

  it('insert da marca do e-mail falhando por outro motivo: e-mail não sai, o toque NÃO avança e o claim é desfeito', async () => {
    abandono();
    banco.falhas['system_state.insert'] = { erro: { code: '57014', message: 'timeout' }, uma: true, pular: 1 };
    const r = await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(0);
    expect(h.frio).toHaveLength(0);
    expect(r.sent).toBe(0);
    expect(linhaDe('ab-1').recovery_attempts).toBe(0);
    expect(carimbos()).toHaveLength(0);
    await recoverAbandonedCheckouts();
    expect(h.emails).toHaveLength(1);
    expect(h.frio).toHaveLength(1);
  });

  it('o 1º sendFrio que dá certo grava enviado no claim ANTES do Pix', async () => {
    delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
    h.resposta = 'Segue [[ENVIAR_PIX]]';
    abandono();
    // O 2º sendFrio (código) lança: o claim já tem `enviado`.
    let n = 0;
    const { sendFrio } = await import('../services/agents/zapiClient');
    (sendFrio as any).mockImplementation(async (tel: string, partes: string[], instancia: string) => {
      h.frio.push({ tel, partes, instancia });
      if (++n === 2) throw new Error('5xx');
      return true;
    });
    await recoverAbandonedCheckouts();
    const claim = banco.linhas('system_state').find(c => c.key === 'rec_checkout_sent:ab-1:1')!;
    expect(claim.value.enviado).toBe(true);
    expect(linhaDe('ab-1').recovery_attempts).toBe(1);
  });
});
