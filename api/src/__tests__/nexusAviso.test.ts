import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { banco } from './_bancoFalso';

// Aviso ao comercial do Portal do Parceiro NEXUS (v2). O que se prova: nasce desligado (sem env não toma trava, não
// envia e não manda e-mail); a trava por chave evita aviso em dobro (cadastro por parceiro, solicitação por tipo e dia
// de Brasília, pedido por pedido, usina por usina, oportunidade por status); o teto de 12 por hora manda cadastro e
// usina só por e-mail e deixa solicitação, pedido e oportunidade saírem; o pedido vai SEMPRE também por e-mail;
// WhatsApp falhando cai no e-mail; e o texto não leva travessão nem formatação.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const enviados: Array<{ phone: string; texto: string; linha: string }> = [];
let whatsFalha = false;
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => {
    if (whatsFalha) throw new Error('[zapi:io] em cooldown');
    enviados.push({ phone, texto, linha });
  }),
}));

const emails: Array<{ assunto: string; html: string }> = [];
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: vi.fn(async (assunto: string, html: string) => { emails.push({ assunto, html }); }),
}));

import { avisarComercial, chaveDoAviso, textoDoAviso, DadosAviso, TETO_WHATSAPP_POR_HORA } from '../services/nexus/avisoComercial';

const PHONE = '5511900000000'; // número inventado só do teste
const parceiro = {
  id: 'p-1', empresa: 'Solar Exemplo', cnpj: '11222333000181', cidade: 'Uberlândia', uf: 'MG',
  origem: 'partner_lp', papel_revenda: true, papel_montagem: false,
};
const dados: DadosAviso = { parceiro, whatsapp: '(34) 99999-0000' };
const conversa: DadosAviso = { ...dados, solicitacao: { tipo: 'conversa' } };
const pedido: DadosAviso = {
  parceiro, whatsapp: '34999990000',
  pedido: { id: 'pd-1', modelo: 'NEXUS DC 80 kW', quantidade: 2, numero: '20260001', valor_total: 139980 },
};
const usina: DadosAviso = {
  parceiro, whatsapp: '34999990000',
  usina: { id: 'us-1', dono_nome: 'Fazenda Boa Vista', cidade: 'Araguari', uf: 'MG', potencia_kwp: 1000, interesse: 'vender_creditos' },
};
const oportunidade = (status: string): DadosAviso => ({
  parceiro, whatsapp: '34999990000', oportunidade: { id: 'op-1', cidade: 'Araguari', uf: 'MG', status },
});

function ligar() {
  process.env.NEXUS_AVISO_LIGADO = '1';
  process.env.NEXUS_AVISO_PHONE = PHONE;
}

const chaves = () => banco.linhas('system_state').map((r) => r.key);

beforeEach(() => {
  banco.reset();
  enviados.length = 0;
  emails.length = 0;
  whatsFalha = false;
  delete process.env.NEXUS_AVISO_LIGADO;
  delete process.env.NEXUS_AVISO_PHONE;
  delete process.env.N8N_ELETROPOSTO_WEBHOOK_URL;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('aviso ao comercial: desligado por padrão', () => {
  it('sem NEXUS_AVISO_LIGADO não toma trava, não envia e não manda e-mail', async () => {
    process.env.NEXUS_AVISO_PHONE = PHONE;
    expect(await avisarComercial('cadastro', dados)).toBe('desligado');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(0);
    expect(chaves()).toHaveLength(0);
  });

  it('(c) pedido com a env desligada: o e-mail sai, o WhatsApp não, e não toma trava', async () => {
    process.env.N8N_ELETROPOSTO_WEBHOOK_URL = 'https://exemplo.invalid/hook';
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    expect(await avisarComercial('pedido', pedido)).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0].assunto).toBe('Portal NEXUS: pedido de equipamento');
    expect(emails[0].html).toContain('Solar Exemplo pediu equipamento: 2x NEXUS DC 80 kW');
    expect(chaves()).toHaveLength(0);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('(c) pedido com NEXUS_AVISO_LIGADO=1 mas sem NEXUS_AVISO_PHONE também manda o e-mail e nenhum WhatsApp', async () => {
    process.env.NEXUS_AVISO_LIGADO = '1';
    expect(await avisarComercial('pedido', pedido)).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('ligado mas sem NEXUS_AVISO_PHONE: também não faz nada', async () => {
    process.env.NEXUS_AVISO_LIGADO = '1';
    expect(await avisarComercial('solicitacao', conversa)).toBe('desligado');
    expect(enviados).toHaveLength(0);
    expect(chaves()).toHaveLength(0);
  });

  it('NEXUS_AVISO_LIGADO diferente de 1 conta como desligado', async () => {
    process.env.NEXUS_AVISO_LIGADO = 'true';
    process.env.NEXUS_AVISO_PHONE = PHONE;
    expect(await avisarComercial('cadastro', dados)).toBe('desligado');
  });
});

describe('aviso ao comercial: envio e trava', () => {
  it('(a) cadastro: 1 bolha pela linha io, para o número da env, e a trava fica gravada', async () => {
    ligar();
    expect(await avisarComercial('cadastro', dados)).toBe('enviado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ phone: PHONE, linha: 'io' });
    expect(enviados[0].texto).toBe(
      'Parceiro NEXUS novo: Solar Exemplo (Uberlândia/MG). Papéis: Revenda. Origem: partner_lp. Painel: solardoc.app/gerador/parceiros',
    );
    expect(chaves()).toEqual(['nexus_aviso:cadastro:p-1']);
    expect(emails).toHaveLength(0);
  });

  it('a mesma chave não avisa duas vezes (cadastro por parceiro)', async () => {
    ligar();
    await avisarComercial('cadastro', dados);
    expect(await avisarComercial('cadastro', dados)).toBe('duplicado');
    expect(enviados).toHaveLength(1);
  });

  it('(b) solicitação: uma por tipo por dia de Brasília, e volta a avisar no dia seguinte', async () => {
    ligar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    expect(await avisarComercial('solicitacao', conversa)).toBe('enviado');
    expect(await avisarComercial('solicitacao', conversa)).toBe('duplicado');
    expect(enviados[0].texto).toContain('pediu conversa com o comercial. WhatsApp: 34999990000.');
    // outro tipo no mesmo dia tem chave própria
    expect(await avisarComercial('solicitacao', { ...dados, solicitacao: { tipo: 'negociar_preco' } })).toBe('enviado');
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    expect(await avisarComercial('solicitacao', conversa)).toBe('enviado');
    expect(chaves()).toEqual([
      'nexus_aviso:solicitacao:p-1:conversa:2026-10-20',
      'nexus_aviso:solicitacao:p-1:negociar_preco:2026-10-20',
      'nexus_aviso:solicitacao:p-1:conversa:2026-10-21',
    ]);
  });

  it('a chave da solicitação vira o dia em Brasília, não em UTC (02:00 UTC ainda é o dia anterior)', () => {
    expect(chaveDoAviso('solicitacao', conversa, new Date('2026-10-21T02:00:00Z'))).toBe('nexus_aviso:solicitacao:p-1:conversa:2026-10-20');
    expect(chaveDoAviso('solicitacao', conversa, new Date('2026-10-21T03:30:00Z'))).toBe('nexus_aviso:solicitacao:p-1:conversa:2026-10-21');
  });

  it('(c) pedido: WhatsApp E e-mail, sempre; e não repete para o mesmo pedido', async () => {
    ligar();
    expect(await avisarComercial('pedido', pedido)).toBe('enviado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toBe('Solar Exemplo pediu equipamento: 2x NEXUS DC 80 kW, proposta 20260001, R$ 139.980,00.');
    expect(emails).toHaveLength(1);
    expect(chaves()).toEqual(['nexus_aviso:pedido:pd-1']);
    expect(await avisarComercial('pedido', pedido)).toBe('duplicado');
    expect(enviados).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it('(c) pedido sem proposta ligada não escreve proposta nem valor', () => {
    const t = textoDoAviso('pedido', { parceiro, pedido: { id: 'pd-2', modelo: 'NEXUS DC 120 kW', quantidade: 1 } });
    expect(t).toBe('Solar Exemplo pediu equipamento: 1x NEXUS DC 120 kW.');
  });

  it('(d) usina: uma por usina, com dono, lugar, potência e interesse', async () => {
    ligar();
    expect(await avisarComercial('usina', usina)).toBe('enviado');
    expect(enviados[0].texto).toBe(
      'Solar Exemplo indicou uma usina: Fazenda Boa Vista em Araguari/MG, 1.000,00 kWp, interesse: vender créditos. WhatsApp: 34999990000.',
    );
    expect(await avisarComercial('usina', usina)).toBe('duplicado');
    expect(chaves()).toEqual(['nexus_aviso:usina:us-1']);
  });

  it('(e) oportunidade: uma por oportunidade e status, com o que o parceiro fez', async () => {
    ligar();
    expect(await avisarComercial('oportunidade', oportunidade('aceita'))).toBe('enviado');
    expect(enviados[0].texto).toBe('Solar Exemplo aceitou a oportunidade em Araguari/MG.');
    expect(await avisarComercial('oportunidade', oportunidade('aceita'))).toBe('duplicado');
    expect(await avisarComercial('oportunidade', oportunidade('fechou'))).toBe('enviado');
    expect(enviados[1].texto).toBe('Solar Exemplo fechou a oportunidade em Araguari/MG.');
    expect(chaves()).toEqual(['nexus_aviso:oportunidade:op-1:aceita', 'nexus_aviso:oportunidade:op-1:fechou']);
  });

  it('(b) engenharia e negociar preço têm texto próprio', () => {
    const eng = textoDoAviso('solicitacao', { ...dados, solicitacao: { tipo: 'engenharia', resumo: 'Projeto elétrico em Araguari/MG' } });
    expect(eng).toBe('Solar Exemplo pediu serviço de engenharia: Projeto elétrico em Araguari/MG. WhatsApp: 34999990000.');
    const neg = textoDoAviso('solicitacao', { ...dados, solicitacao: { tipo: 'negociar_preco' } });
    expect(neg).toBe('Solar Exemplo quer negociar o preço do equipamento com o comercial. WhatsApp: 34999990000.');
  });

  it('o prefixo da trava não é de nenhum robô contado pelo lineThrottle', () => {
    // BOT_SENT_PREFIXES não é exportado; o que importa é que a chave não comece com nenhum prefixo "x_sent:" nem de robô.
    for (const c of [chaveDoAviso('cadastro', dados), chaveDoAviso('usina', usina), chaveDoAviso('pedido', pedido)]) {
      expect(c.startsWith('nexus_aviso:')).toBe(true);
      expect(/_sent:|^recovery:|^semente:|^carla_/.test(c)).toBe(false);
    }
  });
});

describe('aviso ao comercial: teto de 12 por hora', () => {
  const encher = (n: number, minutosAtras = 5) => {
    for (let i = 0; i < n; i++) {
      banco.poe('system_state', { key: `nexus_aviso:cadastro:antigo-${i}`, value: {}, updated_at: new Date(Date.now() - minutosAtras * 60_000).toISOString() });
    }
  };

  it('com 12 avisos na última hora, o cadastro sai SÓ por e-mail', async () => {
    ligar();
    encher(TETO_WHATSAPP_POR_HORA);
    expect(await avisarComercial('cadastro', dados)).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain('Solar Exemplo');
  });

  it('a usina também sai só por e-mail acima do teto', async () => {
    ligar();
    encher(TETO_WHATSAPP_POR_HORA);
    expect(await avisarComercial('usina', usina)).toBe('email');
    expect(enviados).toHaveLength(0);
  });

  it('com 11 ainda cabe: o 12º vai pelo WhatsApp', async () => {
    ligar();
    encher(TETO_WHATSAPP_POR_HORA - 1);
    expect(await avisarComercial('cadastro', dados)).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });

  it('avisos de mais de 1 hora atrás não contam', async () => {
    ligar();
    encher(30, 90);
    expect(await avisarComercial('cadastro', dados)).toBe('enviado');
  });

  it('acima do teto a solicitação, o pedido e a resposta de oportunidade são urgentes e saem sempre pelo WhatsApp', async () => {
    ligar();
    encher(20);
    expect(await avisarComercial('solicitacao', conversa)).toBe('enviado');
    expect(await avisarComercial('pedido', pedido)).toBe('enviado');
    expect(await avisarComercial('oportunidade', oportunidade('recusada'))).toBe('enviado');
    expect(enviados).toHaveLength(3);
    expect(emails).toHaveLength(1); // o pedido, que também vai por e-mail
  });
});

describe('aviso ao comercial: falhas e webhook', () => {
  it('WhatsApp falhando cai no e-mail com o mesmo texto', async () => {
    ligar();
    whatsFalha = true;
    expect(await avisarComercial('solicitacao', conversa)).toBe('email');
    expect(enviados).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain('pediu conversa com o comercial');
  });

  it('pedido com o WhatsApp fora manda um e-mail só (não duplica)', async () => {
    ligar();
    whatsFalha = true;
    expect(await avisarComercial('pedido', pedido)).toBe('email');
    expect(emails).toHaveLength(1);
  });

  it('o assunto do e-mail é texto fixo e o corpo escapa o que o parceiro digitou', async () => {
    ligar();
    whatsFalha = true;
    await avisarComercial('cadastro', { ...dados, parceiro: { ...parceiro, id: 'p-2', empresa: '<img src=x onerror=alert(1)> Solar' } });
    expect(emails[0].assunto).toBe('Portal NEXUS: parceiro novo');
    expect(emails[0].html).not.toContain('<img');
  });

  it('sem a env do n8n não chama o webhook; com a env chama uma vez, com o corpo do contrato', async () => {
    ligar();
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', f);
    await avisarComercial('cadastro', dados);
    expect(f).not.toHaveBeenCalled();

    process.env.N8N_ELETROPOSTO_WEBHOOK_URL = 'https://n8n.exemplo.invalid/hook';
    await avisarComercial('pedido', pedido);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('https://n8n.exemplo.invalid/hook');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      evento: 'nexus_pedido', empresa: 'Solar Exemplo', cnpj: '11222333000181', cidade: 'Uberlândia', uf: 'MG',
      contato: '34999990000', modelo: 'NEXUS DC 80 kW', quantidade: 2, valor_total: 139980, numero: '20260001',
    });
  });

  it('webhook fora do ar não derruba o aviso', async () => {
    ligar();
    process.env.N8N_ELETROPOSTO_WEBHOOK_URL = 'https://n8n.exemplo.invalid/hook';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede'); }));
    expect(await avisarComercial('cadastro', dados)).toBe('enviado');
  });
});

describe('texto do aviso', () => {
  it('sem formatação do WhatsApp e tudo em uma linha, mesmo com lixo no nome da empresa', () => {
    const sujo: DadosAviso = { ...dados, parceiro: { ...parceiro, origem: 'portal', empresa: '*Solar*\n_Exemplo_ Ltda' }, solicitacao: { tipo: 'conversa' } };
    for (const tipo of ['cadastro', 'solicitacao'] as const) {
      expect(textoDoAviso(tipo, sujo)).not.toMatch(/[*_~`\n]/);
    }
  });

  it('os textos fixos nossos não têm travessão e começam com maiúscula', () => {
    const todos = [
      textoDoAviso('cadastro', dados), textoDoAviso('solicitacao', conversa), textoDoAviso('pedido', pedido),
      textoDoAviso('usina', usina), textoDoAviso('oportunidade', oportunidade('visita')),
      textoDoAviso('solicitacao', { ...dados, solicitacao: { tipo: 'engenharia' } }),
      textoDoAviso('solicitacao', { ...dados, solicitacao: { tipo: 'negociar_preco' } }),
    ];
    for (const t of todos) {
      expect(t).not.toMatch(/[—–]/);
      expect(t[0]).toBe(t[0].toUpperCase());
    }
    expect(textoDoAviso('oportunidade', oportunidade('visita'))).toBe('Solar Exemplo marcou a etapa Visita agendada na oportunidade em Araguari/MG.');
  });

  it('papéis: os dois, só Montagem e nenhum', () => {
    expect(textoDoAviso('cadastro', { parceiro: { ...parceiro, papel_montagem: true } })).toContain('Papéis: Revenda e Montagem e Engenharia.');
    expect(textoDoAviso('cadastro', { parceiro: { ...parceiro, papel_revenda: false, papel_montagem: true } })).toContain('Papéis: Montagem e Engenharia.');
    expect(textoDoAviso('cadastro', { parceiro: { ...parceiro, papel_revenda: false } })).toContain('Papéis: Ainda não escolhidos.');
  });
});
