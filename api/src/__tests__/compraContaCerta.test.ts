import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A COMPRA CAI NA CONTA CERTA (Kiwify → processarEventoKit → garantirConta).
//
// Antes a conta do comprador era achada SÓ pelo e-mail digitado no checkout. Quem digitava outro criava uma
// conta pendente nova, o acesso ia para ela e a conta logada seguia trancada, sem aviso. Estes testes travam a
// busca em ordem (e-mail, CPF/CNPJ, telefone), a regra de segurança (só escolhe quando UMA conta é sustentada
// por todas as chaves que acharam alguém) e o que fica registrado para o suporte.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});

const emailsKit: any[] = [];
const emailsFerramenta: any[] = [];
const alertas: Array<{ assunto: string; corpo: string }> = [];
vi.mock('../utils/mailer', () => ({
  sendKitAcessoEmail: vi.fn(async (o: any) => { emailsKit.push(o); }),
  sendMesPixAcessoEmail: vi.fn(async () => {}),
  sendFerramentaAcessoEmail: vi.fn(async (o: any) => { emailsFerramenta.push(o); }),
  sendOpsAlert: vi.fn(async (assunto: string, corpo: string) => { alertas.push({ assunto, corpo }); }),
}));
const cancelarStripe = vi.hoisted(() => ({ fn: vi.fn(async (_e: string) => 1) }));
vi.mock('../services/dunningService', () => ({ cancelStripeSubsForEmail: cancelarStripe.fn }));
const bonusMock = vi.hoisted(() => ({ tentar: vi.fn(async (_a: any) => true) }));
vi.mock('../services/agentes5040/planilhaBonus', () => ({ tentarBonusPosPagamento: bonusMock.tentar }));

import { db, limpar, semear, falhas } from './helpers/dbFalso';
import { processarEventoKit, acessoDoUsuario, type EventoKit } from '../services/kitIntegradorService';
import { documentoDoComprador } from '../services/produtos/contaDoComprador';
import { cpfValido } from '../utils/documento';
import { cnpjValido } from '../utils/cnpj';

// Documentos de verdade (dígito verificador batendo): os exemplos clássicos de validadores.
const CPF = '52998224725';
const CPF_MASCARA = '529.982.247-25';
const CNPJ = '11222333000181';
const CNPJ_MASCARA = '11.222.333/0001-81';

const EMAIL_DIGITADO = 'digitado.na.compra@gmail.com';
const EMAIL_DA_CONTA = 'conta.logada@empresa.com.br';

function evento(over: Partial<EventoKit> = {}): EventoKit {
  return {
    orderId: 'ORDER-1',
    email: EMAIL_DIGITADO,
    nome: 'Comprador Teste',
    telefone: '+5534991472583',
    documento: null,
    produto: 'Calculadora Solar',
    item: 'precificacao',
    status: 'paid',
    valorCentavos: 6700,
    utm: { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null },
    payload: {},
    ...over,
  };
}

function conta(over: Record<string, any> = {}) {
  return semear('users', {
    email: EMAIL_DA_CONTA, password_hash: 'hash', plano: 'free', whatsapp: null, ...over,
  });
}

let logInfo: ReturnType<typeof vi.spyOn>;
let logWarn: ReturnType<typeof vi.spyOn>;
const logs = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n');

beforeEach(() => {
  limpar('users', 'kit_pedidos', 'entitlements', 'company', 'asaas_pix_assinaturas', 'clients', 'terceiros');
  emailsKit.length = 0;
  emailsFerramenta.length = 0;
  alertas.length = 0;
  logInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
  logWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('os documentos de teste são válidos (senão nada abaixo prova coisa nenhuma)', () => {
  it('CPF e CNPJ de exemplo passam no dígito verificador', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cnpjValido(CNPJ)).toBe(true);
  });
});

describe('documentoDoComprador: o CPF/CNPJ no payload da Kiwify', () => {
  it('lê Customer.CPF (11 dígitos) como a Kiwify manda', () => {
    expect(documentoDoComprador({ full_name: 'X', CPF: CPF, mobile: '+5534991472583' })).toBe(CPF);
    expect(documentoDoComprador({ CPF: CPF_MASCARA })).toBe(CPF);
  });

  it('lê Customer.cnpj quando o comprador é empresa e CPF vem vazio', () => {
    expect(documentoDoComprador({ CPF: '', cnpj: CNPJ })).toBe(CNPJ);
    expect(documentoDoComprador({ CPF: '', cnpj: CNPJ_MASCARA })).toBe(CNPJ);
  });

  it('ignora documento inválido, repetido, curto ou ausente', () => {
    expect(documentoDoComprador({ CPF: '12345678900' })).toBeNull();     // dígito verificador errado
    expect(documentoDoComprador({ CPF: '11111111111' })).toBeNull();     // sequência repetida
    expect(documentoDoComprador({ CPF: '123' })).toBeNull();
    expect(documentoDoComprador({ CPF: '' })).toBeNull();
    expect(documentoDoComprador({ full_name: 'Sem documento' })).toBeNull();
    expect(documentoDoComprador(null)).toBeNull();
    expect(documentoDoComprador('texto')).toBeNull();
  });

  it('o nome do campo vale em qualquer caixa', () => {
    expect(documentoDoComprador({ Cpf: CPF })).toBe(CPF);
    expect(documentoDoComprador({ CNPJ: CNPJ })).toBe(CNPJ);
  });
});

describe('1) o e-mail continua sendo a primeira chave', () => {
  it('e-mail da conta: é essa conta, sem mexer em nada e sem alerta', async () => {
    const c = conta({ email: EMAIL_DIGITADO, whatsapp: '34991472583' });
    const r = await processarEventoKit(evento());

    expect(r.userId).toBe(c.id);
    expect(r.contaCriada).toBe(false);
    expect(db.users).toHaveLength(1);
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0].user_id).toBe(c.id);
    expect(alertas).toHaveLength(0);
    expect(logs(logInfo)).toContain('achada por email');
  });

  it('o e-mail ganha de um telefone que é de OUTRA conta', async () => {
    const dona = conta({ email: EMAIL_DIGITADO });
    conta({ email: 'outra@x.com', whatsapp: '34991472583' });
    const r = await processarEventoKit(evento());

    expect(r.userId).toBe(dona.id);
    expect(alertas).toHaveLength(0);
  });
});

describe('2) CPF/CNPJ do comprador contra o que a conta guarda', () => {
  it('CNPJ: casa com company.cnpj gravado COM máscara, e o acesso vai para a conta logada', async () => {
    const c = conta();
    semear('company', { user_id: c.id, cnpj: CNPJ_MASCARA });

    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null }));

    expect(r.userId).toBe(c.id);
    expect(r.contaCriada).toBe(false);
    expect(db.users).toHaveLength(1);                         // nenhuma conta pendente nasceu
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0]).toMatchObject({ user_id: c.id, produto: 'precificacao', origem: 'compra' });
    expect(logs(logInfo)).toContain('achada por documento');
  });

  it('CNPJ: casa com company.cnpj gravado SÓ com dígitos (41 das 161 empresas estão assim)', async () => {
    const c = conta();
    semear('company', { user_id: c.id, cnpj: CNPJ });

    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null }));
    expect(r.userId).toBe(c.id);
    expect(db.users).toHaveLength(1);
  });

  it('CPF: casa com quem assina por Pix recorrente (asaas_pix_assinaturas.cpf_cnpj)', async () => {
    const c = conta();
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: c.id, email: EMAIL_DA_CONTA, cpf_cnpj: CPF_MASCARA });

    const r = await processarEventoKit(evento({ documento: CPF, telefone: null }));
    expect(r.userId).toBe(c.id);
    expect(db.users).toHaveLength(1);
    expect(logs(logInfo)).toContain('achada por documento');
  });

  it('NÃO casa com documento de OUTRA pessoa: clients, terceiros e CPF do engenheiro/técnico não valem', async () => {
    const c = conta();
    // O CPF do comprador existe no banco, mas como cliente do integrador, terceiro e técnico dele.
    semear('clients', { user_id: c.id, nome: 'Cliente do integrador', cpf_cnpj: CPF });
    semear('terceiros', { user_id: c.id, nome: 'Terceiro', cpf_cnpj: CPF });
    semear('company', { user_id: c.id, cnpj: CNPJ_MASCARA, engenheiro_cpf: CPF, tecnico_cpf: CPF });

    const r = await processarEventoKit(evento({ documento: CPF, telefone: null }));

    expect(r.contaCriada).toBe(true);                         // nada casou: conta pendente, como sempre
    expect(r.userId).not.toBe(c.id);
    expect(db.entitlements[0].user_id).not.toBe(c.id);
  });

  it('documento inválido (dígito errado) é ignorado, mesmo que exista no banco', async () => {
    const c = conta();
    semear('company', { user_id: c.id, cnpj: '11.222.333/0001-80' });   // CNPJ de teste com DV errado

    const r = await processarEventoKit(evento({ documento: '11222333000180', telefone: null }));
    expect(r.contaCriada).toBe(true);
  });
});

describe('3) telefone do comprador contra users.whatsapp, pelas variantes de chave', () => {
  it('+55 (13 dígitos) do comprador casa com o 11 dígitos da conta', async () => {
    const c = conta({ whatsapp: '34991472583' });
    const r = await processarEventoKit(evento({ telefone: '+5534991472583' }));

    expect(r.userId).toBe(c.id);
    expect(r.contaCriada).toBe(false);
    expect(db.users).toHaveLength(1);
    expect(db.entitlements[0].user_id).toBe(c.id);
    expect(logs(logInfo)).toContain('achada por telefone');
  });

  it('casa mesmo quando um lado perdeu o nono dígito', async () => {
    const c = conta({ whatsapp: '553491472583' });             // 55 + DDD + 8 dígitos
    const r = await processarEventoKit(evento({ telefone: '(34) 99147-2583' }));
    expect(r.userId).toBe(c.id);
  });

  it('casa quando a conta guarda o número com "+"', async () => {
    const c = conta({ whatsapp: '+5534991472583' });
    const r = await processarEventoKit(evento({ telefone: '34 99147 2583' }));
    expect(r.userId).toBe(c.id);
  });

  it('telefone de outra pessoa (DDD ou final diferentes) não casa', async () => {
    conta({ whatsapp: '34988880000' });
    conta({ email: 'outra@x.com', whatsapp: '11991472583' });
    const r = await processarEventoKit(evento({ telefone: '+5534991472583' }));
    expect(r.contaCriada).toBe(true);
  });

  it('telefone curto ou lixo não procura nada', async () => {
    conta({ whatsapp: '34991472583' });
    for (const telefone of ['12345', '', null, 'sem telefone']) {
      limpar('users', 'kit_pedidos', 'entitlements');
      conta({ whatsapp: '34991472583' });
      const r = await processarEventoKit(evento({ telefone: telefone as any }));
      expect(r.contaCriada).toBe(true);
    }
  });

  it('DUAS contas no mesmo telefone: não escolhe nenhuma, cria a pendente e avisa o suporte', async () => {
    const a = conta({ email: 'a@x.com', whatsapp: '34991472583' });
    const b = conta({ email: 'b@x.com', whatsapp: '5534991472583' });

    const r = await processarEventoKit(evento({ orderId: 'ORDER-DUAS' }));

    expect(r.contaCriada).toBe(true);
    expect(r.userId).not.toBe(a.id);
    expect(r.userId).not.toBe(b.id);
    expect(db.entitlements.filter((e) => e.user_id === a.id || e.user_id === b.id)).toHaveLength(0);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].corpo).toContain('ORDER-DUAS');
    expect(alertas[0].corpo).toContain('a@x.com');
    expect(alertas[0].corpo).toContain('b@x.com');
    expect(logs(logWarn)).toContain('CONFLITO DE CONTA');
  });
});

describe('documento e telefone juntos', () => {
  it('apontam para a MESMA conta: casa, e o log diz que foram as duas chaves', async () => {
    const c = conta({ whatsapp: '34991472583' });
    semear('company', { user_id: c.id, cnpj: CNPJ_MASCARA });

    const r = await processarEventoKit(evento({ documento: CNPJ }));
    expect(r.userId).toBe(c.id);
    expect(logs(logInfo)).toContain('achada por documento+telefone');
    expect(alertas).toHaveLength(0);
  });

  it('apontam para contas DIFERENTES: não escolhe nenhuma, cria a pendente e registra o conflito', async () => {
    const pelaEmpresa = conta({ email: 'dona.da.empresa@x.com' });
    semear('company', { user_id: pelaEmpresa.id, cnpj: CNPJ_MASCARA });
    const pelaLinha = conta({ email: 'dono.do.celular@x.com', whatsapp: '34991472583' });

    const r = await processarEventoKit(evento({ orderId: 'ORDER-CONFLITO', documento: CNPJ }));

    expect(r.contaCriada).toBe(true);                         // a pendente nasce, como hoje
    expect(r.userId).not.toBe(pelaEmpresa.id);
    expect(r.userId).not.toBe(pelaLinha.id);
    expect(db.users).toHaveLength(3);
    // O acesso foi para a pendente: as duas contas existentes ficaram como estavam.
    expect(db.entitlements).toHaveLength(1);
    expect(db.entitlements[0].user_id).toBe(r.userId);

    expect(alertas).toHaveLength(1);
    expect(alertas[0].assunto).toContain('contas diferentes');
    expect(alertas[0].corpo).toContain('ORDER-CONFLITO');
    expect(alertas[0].corpo).toContain('dona.da.empresa@x.com');
    expect(alertas[0].corpo).toContain('dono.do.celular@x.com');
    expect(logs(logWarn)).toContain('documento_e_telefone_divergem');
  });

  it('o documento inteiro e o telefone inteiro nunca vão para o log nem para o alerta', async () => {
    const pelaEmpresa = conta({ email: 'dona.da.empresa@x.com' });
    semear('company', { user_id: pelaEmpresa.id, cnpj: CNPJ_MASCARA });
    conta({ email: 'dono.do.celular@x.com', whatsapp: '34991472583' });

    await processarEventoKit(evento({ documento: CNPJ, telefone: '+5534991472583' }));

    const tudo = logs(logWarn) + logs(logInfo) + alertas.map((a) => a.assunto + a.corpo).join('\n');
    expect(tudo).not.toContain(CNPJ);
    expect(tudo).not.toContain(CNPJ_MASCARA);
    expect(tudo).not.toContain('5534991472583');
    expect(tudo).not.toContain('34991472583');
    expect(tudo).toContain('0181');                           // só o final do documento
  });

  it('o documento acha uma conta e o telefone acha essa e outra: o telefone é ambíguo, então conflito, não chute', async () => {
    const c = conta({ email: 'a@x.com', whatsapp: '34991472583' });
    conta({ email: 'b@x.com', whatsapp: '34991472583' });
    semear('company', { user_id: c.id, cnpj: CNPJ_MASCARA });

    const r = await processarEventoKit(evento({ documento: CNPJ }));
    expect(r.userId).not.toBe(c.id);
    expect(r.contaCriada).toBe(true);
    expect(db.users).toHaveLength(3);
    expect(alertas).toHaveLength(1);
    expect(logs(logWarn)).toContain('telefone_ambiguo');
  });

  it('um CNPJ que aparece em duas contas é conflito mesmo que o telefone aponte para uma delas', async () => {
    const a = conta({ email: 'a@x.com', whatsapp: '34991472583' });
    const b = conta({ email: 'b@x.com', whatsapp: '11911112222' });
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: a.id, cpf_cnpj: CNPJ });
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: b.id, cpf_cnpj: CNPJ_MASCARA });

    const r = await processarEventoKit(evento({ documento: CNPJ }));
    expect(r.userId).not.toBe(a.id);
    expect(r.userId).not.toBe(b.id);
    expect(r.contaCriada).toBe(true);
    expect(logs(logWarn)).toContain('documento_ambiguo');
  });

  it('o mesmo CNPJ em duas contas, sem telefone que desempate: conflito, não chute', async () => {
    const a = conta({ email: 'a@x.com' });
    const b = conta({ email: 'b@x.com' });
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: a.id, cpf_cnpj: CNPJ });
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: b.id, cpf_cnpj: CNPJ });

    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null }));
    expect(r.contaCriada).toBe(true);
    expect(alertas).toHaveLength(1);
    expect(logs(logWarn)).toContain('documento_ambiguo');
  });
});

describe('nada casa', () => {
  it('cria a conta pendente como sempre, sem alerta, e diz no log que nada casou', async () => {
    conta({ whatsapp: '11911112222' });
    const r = await processarEventoKit(evento());

    expect(r.contaCriada).toBe(true);
    expect(db.users).toHaveLength(2);
    const nova = db.users.find((u) => u.email === EMAIL_DIGITADO)!;
    expect(nova.password_hash).toBeNull();
    expect(nova.whatsapp).toBe('5534991472583');
    expect(db.entitlements[0].user_id).toBe(nova.id);
    expect(alertas).toHaveLength(0);
    expect(logs(logInfo)).toContain('nenhuma conta casou');
  });

  it('uma tabela de documento que quebra não derruba a compra: segue pelas outras chaves', async () => {
    falhas.tabelaQuebrada.add('asaas_pix_assinaturas');
    falhas.tabelaQuebrada.add('company');
    const c = conta({ whatsapp: '34991472583' });

    const r = await processarEventoKit(evento({ documento: CNPJ }));
    expect(r.userId).toBe(c.id);                              // o telefone resolveu
    expect(logs(logWarn)).toContain('segue sem essa chave');
  });
});

describe('o que a conta achada recebe', () => {
  it('reentrega do mesmo pedido: a mesma conta, sem segunda concessão nem conta nova', async () => {
    const c = conta({ whatsapp: '34991472583' });
    await processarEventoKit(evento());
    const r2 = await processarEventoKit(evento());

    expect(r2.userId).toBe(c.id);
    expect(db.users).toHaveLength(1);
    expect(db.entitlements).toHaveLength(1);
  });

  it('o item `kit`: o pedido é amarrado à conta achada e o curso aparece para ela, mesmo com e-mail diferente', async () => {
    const c = conta({ whatsapp: '34991472583' });
    await processarEventoKit(evento({ item: 'kit', produto: 'Kit Fechamento - SolarDoc', valorCentavos: 2700 }));

    const pedido = db.kit_pedidos[0];
    expect(pedido.email).toBe(EMAIL_DIGITADO);                // o pedido guarda o que foi digitado
    expect(pedido.user_id).toBe(c.id);                        // e a conta onde o acesso foi parar
    const acesso = await acessoDoUsuario(c.id, EMAIL_DA_CONTA);
    expect(acesso.temKit).toBe(true);                         // achado pelo user_id, apesar do e-mail diferente
  });

  it('o e-mail de acesso sai para o endereço digitado na compra, e a conta existente não vira "nova"', async () => {
    conta({ whatsapp: '34991472583' });
    await processarEventoKit(evento());

    expect(emailsFerramenta).toHaveLength(1);
    expect(emailsFerramenta[0].to).toBe(EMAIL_DIGITADO);
    expect(emailsFerramenta[0].contaNova).toBe(false);
  });

  it('compra que NÃO está paga não procura conta nem libera nada', async () => {
    conta({ whatsapp: '34991472583' });
    const r = await processarEventoKit(evento({ status: 'waiting_payment' }));

    expect(r.acao).toBe('registrado');
    expect(db.entitlements).toHaveLength(0);
    expect(db.users).toHaveLength(1);
  });

  it('assinante que compra com outro e-mail recebe a ferramenta na conta dele, sem mexer no plano', async () => {
    const c = conta({ whatsapp: '34991472583', plano: 'ilimitado' });
    const r = await processarEventoKit(evento());

    expect(r.userId).toBe(c.id);
    expect(db.users.find((u) => u.id === c.id)!.plano).toBe('ilimitado');
    expect(db.entitlements[0].user_id).toBe(c.id);
  });

  it('o mês avulso do Pix comprado com outro e-mail estende o plano da conta achada', async () => {
    const c = conta({ whatsapp: '34991472583', plano: 'free' });
    const r = await processarEventoKit(evento({
      item: 'mes_pix', produto: 'SolarDoc - 1 mês', valorCentavos: 6700, orderId: 'ORDER-MES',
    }));

    expect(r.userId).toBe(c.id);
    const depois = db.users.find((u) => u.id === c.id)!;
    expect(depois.plano).toBe('ilimitado');
    expect(depois.plano_expira_em).toBeTruthy();
    expect(db.users).toHaveLength(1);
  });
});

describe('conta pendente nunca é candidata (compra errada do e-mail na 1a vez)', () => {
  it('1a compra com e-mail errado cria a pendente com o telefone; a 2a, com o e-mail certo, cria outra pendente com link', async () => {
    const r1 = await processarEventoKit(evento({ orderId: 'P-1', email: 'errado@gmail.com' }));
    expect(r1.contaCriada).toBe(true);

    const r2 = await processarEventoKit(evento({ orderId: 'P-2', email: 'certo@gmail.com' }));
    expect(r2.contaCriada).toBe(true);
    expect(r2.userId).not.toBe(r1.userId);
    const segunda = db.users.find((u) => u.email === 'certo@gmail.com')!;
    expect(segunda.password_hash).toBeNull();
    expect(segunda.reset_token).toBeTruthy();
    expect(alertas).toHaveLength(0);
  });

  it('pendente com o CNPJ em asaas_pix_assinaturas também não prende a compra', async () => {
    const p = semear('users', { email: 'pendente@x.com', password_hash: null, plano: 'free', whatsapp: null });
    semear('asaas_pix_assinaturas', { ultimo_pagamento_id: 'pay_1', status: 'ativo', user_id: p.id, cpf_cnpj: CNPJ });
    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null as any }));
    expect(r.contaCriada).toBe(true);
    expect(r.userId).not.toBe(p.id);
  });

  it('assinatura Pix nunca paga (pendente, recusado, expirado, cancelado sem pagamento) não prova o documento', async () => {
    for (const status of ['pendente', 'recusado', 'expirado', 'cancelado']) {
      limpar('users', 'kit_pedidos', 'entitlements', 'company', 'asaas_pix_assinaturas');
      const c = conta({ whatsapp: null });
      semear('asaas_pix_assinaturas', { status, ultimo_pagamento_id: '', user_id: c.id, cpf_cnpj: CNPJ });
      const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null as any }));
      expect(r.userId).not.toBe(c.id);
    }
  });
});

describe('assinatura Pix cancelada DEPOIS de paga continua provando o documento', () => {
  it('cancelado com pagamento creditado casa', async () => {
    const c = conta({ whatsapp: null });
    semear('asaas_pix_assinaturas', { status: 'cancelado', ultimo_pagamento_id: 'pay_9', user_id: c.id, cpf_cnpj: CNPJ });
    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null as any }));
    expect(r.userId).toBe(c.id);
    expect(db.users).toHaveLength(1);
  });
});

describe('leitura que falha nunca entrega a compra a outra conta', () => {
  it('a leitura por e-mail piscou: nem documento nem telefone decidem, e a compra não vai para a conta do telefone', async () => {
    const dona = conta({ email: EMAIL_DIGITADO, password_hash: 'hash', whatsapp: null });
    const outra = conta({ email: 'outra.pessoa@x.com', whatsapp: '34991472583' });
    falhas.leituraPorEmailQuebrada.add('users');

    const r = await processarEventoKit(evento());

    expect(r.userId).not.toBe(outra.id);
    expect(db.entitlements.find((e) => e.user_id === outra.id)).toBeUndefined();
    expect(db.entitlements.find((e) => e.user_id === dona.id)).toBeUndefined();
    expect(logs(logWarn)).toContain('leitura da conta por e-mail falhou');
  });
});

describe('limites de leitura não escondem a segunda conta', () => {
  it('contas pendentes com o mesmo telefone não ocupam o teto: as duas reais aparecem e dá conflito', async () => {
    for (let i = 0; i < 25; i++) semear('users', { email: `pend${i}@x.com`, password_hash: null, whatsapp: '34991472583' });
    const a = conta({ email: 'real.a@x.com', whatsapp: '34991472583' });
    const b = conta({ email: 'real.b@x.com', whatsapp: '5534991472583' });
    const r = await processarEventoKit(evento({ orderId: 'ORDER-PEND' }));
    expect(r.contaCriada).toBe(true);
    expect(r.userId).not.toBe(a.id);
    expect(r.userId).not.toBe(b.id);
    expect(alertas).toHaveLength(1);
  });

  it('um usuário com muitas linhas de assinatura não esconde o segundo dono do mesmo CNPJ', async () => {
    const a = conta({ email: 'a@x.com', whatsapp: null });
    const b = conta({ email: 'b@x.com', whatsapp: null });
    for (let i = 0; i < 30; i++) semear('asaas_pix_assinaturas', { status: 'ativo', ultimo_pagamento_id: `p${i}`, user_id: a.id, cpf_cnpj: CNPJ });
    semear('asaas_pix_assinaturas', { status: 'ativo', ultimo_pagamento_id: 'pb', user_id: b.id, cpf_cnpj: CNPJ });
    const r = await processarEventoKit(evento({ documento: CNPJ, telefone: null as any, orderId: 'ORDER-MUITAS' }));
    expect(r.contaCriada).toBe(true);
    expect(alertas).toHaveLength(1);
  });
});

describe('fixo não casa com o celular de outra pessoa', () => {
  it('comprador com fixo de 10 dígitos não cai na conta cujo celular é o mesmo número com 9 na frente', async () => {
    conta({ whatsapp: '34934567012' });
    const r = await processarEventoKit(evento({ telefone: '(34) 3456-7012' }));
    expect(r.contaCriada).toBe(true);
  });

  it('variantesDoTelefone: fixo perde as variantes com 9; celular de 8 dígitos começando por 9 mantém as quatro', async () => {
    const { variantesDoTelefone } = await import('../services/produtos/chaveTelefone');
    const fixo = variantesDoTelefone('(34) 3456-7012');
    expect(fixo).toContain('3434567012');
    expect(fixo).not.toContain('34934567012');
    expect(fixo).not.toContain('5534934567012');
    const cel = variantesDoTelefone('(34) 9147-2583');
    expect(cel).toContain('34991472583');
    expect(cel).toContain('3491472583');
  });
});

describe('conta achada por documento ou telefone: nada irreversível sozinho', () => {
  it('Pix em dunning numa conta achada pelo telefone NÃO cancela o cartão; só alerta a operação', async () => {
    cancelarStripe.fn.mockClear();
    conta({ whatsapp: '34991472583', billing_status: 'past_due' });
    const r = await processarEventoKit(evento({
      item: 'mes_pix', produto: 'SolarDoc - 1 mês', valorCentavos: 6700, orderId: 'ORDER-DUN',
    }));
    expect(r.contaCriada).toBe(false);
    expect(cancelarStripe.fn).not.toHaveBeenCalled();
    expect(alertas.some((a) => a.assunto.includes('cartão não foi cancelado'))).toBe(true);
  });

  it('Pix em dunning numa conta achada pelo E-MAIL segue cancelando o cartão como sempre', async () => {
    cancelarStripe.fn.mockClear();
    conta({ email: EMAIL_DIGITADO, billing_status: 'past_due' });
    await processarEventoKit(evento({
      item: 'mes_pix', produto: 'SolarDoc - 1 mês', valorCentavos: 6700, orderId: 'ORDER-DUN-2',
    }));
    expect(cancelarStripe.fn).toHaveBeenCalledTimes(1);
  });

  it('conta achada só pelo telefone gera um alerta de operação, uma vez por pedido', async () => {
    conta({ whatsapp: '34991472583' });
    await processarEventoKit(evento({ orderId: 'ORDER-SO-TEL' }));
    await processarEventoKit(evento({ orderId: 'ORDER-SO-TEL' }));
    expect(alertas.filter((a) => a.assunto.includes('achada só pelo telefone'))).toHaveLength(1);
  });
});

describe('telefone de mentira ou estrangeiro não serve de chave', () => {
  it('11999999999, 3412345678 e 34988888888 na conta de alguém não entregam a compra de quem digita o mesmo', async () => {
    for (const numero of ['11999999999', '34999999999', '3412345678', '34988888888', '34987654321']) {
      limpar('users', 'kit_pedidos', 'entitlements', 'company', 'asaas_pix_assinaturas');
      const c = conta({ whatsapp: numero });
      const r = await processarEventoKit(evento({ telefone: numero }));
      expect(r.contaCriada).toBe(true);
      expect(r.userId).not.toBe(c.id);
    }
  });

  it('+351 91234-5678 e +1 555 123 4567 não viram chave brasileira', async () => {
    for (const [naConta, naCompra] of [['3512345678', '+351912345678'], ['1551234567', '+15551234567']]) {
      limpar('users', 'kit_pedidos', 'entitlements', 'company', 'asaas_pix_assinaturas');
      const c = conta({ whatsapp: naConta });
      const r = await processarEventoKit(evento({ telefone: naCompra }));
      expect(r.userId).not.toBe(c.id);
    }
  });

  it('telefoneServeDeChave: aceita número real e recusa DDD inválido e sequência', async () => {
    const { telefoneServeDeChave } = await import('../services/produtos/chaveTelefone');
    expect(telefoneServeDeChave('+5534991472583')).toBe(true);
    expect(telefoneServeDeChave('(11) 98877-6655')).toBe(true);
    expect(telefoneServeDeChave('0991472583')).toBe(false);
    expect(telefoneServeDeChave('1091472583')).toBe(false);
    expect(telefoneServeDeChave('34912345678')).toBe(false);
    expect(telefoneServeDeChave('34987654321')).toBe(false);
  });
});
