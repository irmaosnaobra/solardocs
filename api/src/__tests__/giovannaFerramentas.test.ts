import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { banco } from './_bancoFalso';
import {
  executarFerramentaGiovanna, GIOVANNA_TOOLS, montarAvisoDono, GiovannaCtx,
} from '../services/agents/whatsapp/giovannaFerramentas';
import { cnpjValido, formatarCnpj } from '../utils/cnpj';

// ═══════════════════════════════════════════════════════════════════════════
// Ferramentas da Giovanna. Supabase em memória, BrasilAPI por fetch falso:
// nenhum teste toca banco real nem rede.
// ═══════════════════════════════════════════════════════════════════════════

const CNPJ_VELHO = '11.222.333/0001-81';
const CNPJ_NOVO = '54129446000140';
const CNPJ_NOVO_FMT = '54.129.446/0001-40';
const OUTRO_CNPJ = '11444777000161';
const OUTRO_CNPJ_FMT = '11.444.777/0001-61';

const UID = 'user-1';

function ctx(over: Partial<GiovannaCtx> = {}): GiovannaCtx {
  return {
    userIds: [UID], userId: UID, phone: '5534998364589', chaveContato: '3498364589', filaId: 'fila-1',
    nome: 'Joao', email: 'joao@x.com', avisosPendentes: [],
    escalar: vi.fn(async () => ({ aberto: true, jaTinha: false })),
    ...over,
  };
}

const rodar = async (nome: string, input: unknown, c: GiovannaCtx) =>
  JSON.parse(await executarFerramentaGiovanna(nome, input, c));

/** A prévia sai numa mensagem anterior (outro id de fila) à da confirmação: o sim vem depois. */
const ctxDaPrevia = (c: GiovannaCtx): GiovannaCtx => ({ ...c, filaId: c.filaId ? `previa-de-${c.filaId}` : null });

/** O caminho de verdade: prévia (que amarra o pedido) e depois a confirmação. Recusa na prévia encerra. */
const confirma = async (campos: Record<string, unknown>, c: GiovannaCtx) => {
  const previa = await rodar('alterar_dados_empresa', { campos, confirmado: false }, ctxDaPrevia(c));
  if (!previa.previa) return previa;
  return rodar('alterar_dados_empresa', { campos, confirmado: true }, c);
};

/** O hash do pedido, lido da chave da prévia que a própria ferramenta grava. */
const hashDoPedido = async (campos: Record<string, unknown>) => {
  const antes = new Set(banco.linhas('system_state').map(x => x.key));
  await rodar('alterar_dados_empresa', { campos, confirmado: false }, ctx({ filaId: 'sonda-hash' }));
  const nova = banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_previa:') && !antes.has(x.key));
  const hash = String(nova ? nova.key : banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_previa:'))!.key).split(':').pop()!;
  banco.tabelas['system_state'] = banco.linhas('system_state').filter(x => !String(x.key).startsWith('giovanna_previa:'));
  banco.escritas.length = 0;
  return hash;
};

const receitaOk = (extra: Record<string, unknown> = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    razao_social: 'SOL NOVO ENERGIA LTDA', nome_fantasia: 'Sol Novo',
    descricao_situacao_cadastral: 'ATIVA', situacao_cadastral: 2, ...extra,
  }),
});

let fetchFalso: ReturnType<typeof vi.fn>;

function semear() {
  banco.reset();
  banco.poe('users', { id: UID, nome: 'Joao Silva', email: 'joao@x.com', plano: 'ilimitado', whatsapp: '5534998364589', created_at: '2026-03-01T12:00:00Z' });
  banco.poe('company', {
    user_id: UID, nome: 'ACME LTDA', nome_fantasia: 'Acme Solar', cnpj: CNPJ_VELHO,
    endereco: 'Rua A, 10', cidade: 'Uberlândia', whatsapp: '34998364589', logo_base64: 'data:image/png;base64,AAA',
  });
  fetchFalso = vi.fn(async () => receitaOk());
  vi.stubGlobal('fetch', fetchFalso);
}

const empresa = () => banco.linhas('company').find(r => r.user_id === UID)!;
const escritasEmCompany = () => banco.escritas.filter(e => e.tabela === 'company');

beforeEach(semear);
afterEach(() => vi.unstubAllGlobals());

describe('cnpj (utilitário)', () => {
  it('valida o dígito verificador e formata', () => {
    expect(cnpjValido(CNPJ_NOVO)).toBe(true);
    expect(cnpjValido(CNPJ_NOVO_FMT)).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(formatarCnpj(CNPJ_NOVO)).toBe(CNPJ_NOVO_FMT);
  });
});

describe('definição das ferramentas', () => {
  it('são quatro, e alterar_dados_empresa só aceita os cinco campos da lista', () => {
    expect(GIOVANNA_TOOLS.map(t => t.name)).toEqual(['ver_minha_conta', 'ver_erros_recentes', 'alterar_dados_empresa', 'abrir_chamado']);
    const alterar: any = GIOVANNA_TOOLS.find(t => t.name === 'alterar_dados_empresa');
    expect(Object.keys(alterar.input_schema.properties.campos.properties).sort())
      .toEqual(['cidade', 'cnpj', 'endereco', 'nome_fantasia', 'razao_social']);
  });
});

describe('ver_minha_conta', () => {
  it('traz usuário, empresa, logo como true/false e os documentos de 30 dias, sem vazar o base64', async () => {
    const agora = Date.now();
    banco.poe('documents',
      { id: 1, user_id: UID, created_at: new Date(agora - 2 * 86_400_000).toISOString() },
      { id: 2, user_id: UID, created_at: new Date(agora - 40 * 86_400_000).toISOString() },
      { id: 3, user_id: 'outro', created_at: new Date(agora - 1 * 86_400_000).toISOString() });
    const r = await rodar('ver_minha_conta', {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.usuario).toMatchObject({ nome: 'Joao Silva', email: 'joao@x.com', plano: 'assinante (documentos ilimitados)' });
    expect(r.empresa).toMatchObject({ razao_social: 'ACME LTDA', cnpj: CNPJ_VELHO, tem_logo: true });
    expect(r.documentos_ultimos_30_dias).toBe(1);
    expect(r.ultimo_documento_em).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('empresa sem logo devolve tem_logo=false', async () => {
    empresa().logo_base64 = null;
    const r = await rodar('ver_minha_conta', {}, ctx());
    expect(r.empresa.tem_logo).toBe(false);
  });
});

describe('ver_erros_recentes', () => {
  it('lista só os erros deste usuário nas últimas 48 h, mais recentes primeiro, até 10', async () => {
    const agora = Date.now();
    for (let i = 0; i < 12; i++) {
      banco.poe('error_logs', { id: i, level: 'error', context: 'conta-scan', message: 'falha ' + i, detail: { user_id: UID }, created_at: new Date(agora - i * 60_000).toISOString() });
    }
    banco.poe('error_logs',
      { id: 100, context: 'conta-scan', message: 'de outro', detail: { user_id: 'outro' }, created_at: new Date(agora).toISOString() },
      { id: 101, context: 'conta-scan', message: 'velho', detail: { user_id: UID }, created_at: new Date(agora - 72 * 3_600_000).toISOString() });
    const r = await rodar('ver_erros_recentes', {}, ctx());
    expect(r.erros_48h).toHaveLength(10);
    expect(r.erros_48h[0].mensagem).toBe('falha 0');
    expect(JSON.stringify(r.erros_48h)).not.toContain('de outro');
    expect(JSON.stringify(r.erros_48h)).not.toContain('velho');
  });

  it('ia_fora é false sem marcador e true com erro de crédito na última hora', async () => {
    expect((await rodar('ver_erros_recentes', {}, ctx())).ia_fora).toBe(false);
    banco.poe('error_logs', { id: 1, context: 'conta-scan', message: 'x', detail: { user_id: 'qualquer', causa: 'ia_sem_credito' }, created_at: new Date().toISOString() });
    expect((await rodar('ver_erros_recentes', {}, ctx())).ia_fora).toBe(true);
  });

  it('ia_fora também pelo carimbo do aviso agregado (ia_falha_aviso) e ignora erro velho', async () => {
    banco.poe('error_logs', { id: 1, context: 'conta-scan', message: 'x', detail: { causa: 'ia_chave' }, created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() });
    expect((await rodar('ver_erros_recentes', {}, ctx())).ia_fora).toBe(false);
    banco.poe('system_state', { key: 'ia_falha_aviso:ia_chave', value: {}, updated_at: new Date().toISOString() });
    expect((await rodar('ver_erros_recentes', {}, ctx())).ia_fora).toBe(true);
  });

  it('traz os chamados abertos do telefone e não os de outro', async () => {
    banco.poe('tech_issues',
      { id: 'abcdef12-0000', phone: '5534998364589', area: 'conta', descricao: 'travou', status: 'aberto', created_at: new Date().toISOString() },
      { id: 'zzz', phone: '5511999999999', area: 'conta', descricao: 'outro', status: 'aberto', created_at: new Date().toISOString() },
      { id: 'fechado', phone: '5534998364589', area: 'conta', descricao: 'ok', status: 'resolvido', created_at: new Date().toISOString() });
    const r = await rodar('ver_erros_recentes', {}, ctx());
    expect(r.chamados_abertos).toHaveLength(1);
    expect(r.chamados_abertos[0]).toMatchObject({ protocolo: 'abcdef12', area: 'conta' });
  });
});

describe('falha de leitura não vira resposta vazia', () => {
  it('ver_erros_recentes com error_logs quebrado devolve falha_ao_ler, não "sem erros"', async () => {
    banco.falhas['error_logs.select'] = { erro: { code: '42703', message: 'column detail->>user_id does not exist' } };
    const r = await rodar('ver_erros_recentes', {}, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'falha_ao_ler', proximo_passo: 'abrir_chamado' });
    expect(r.erros_48h).toBeUndefined();
  });

  it('ia_fora vira null (desconhecido) quando só a leitura do estado da IA falha', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'timeout' } };
    const r = await rodar('ver_erros_recentes', {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.ia_fora).toBeNull();
    expect(r.ia_fora_desconhecido).toBe(true);
  });

  it('ver_minha_conta com a empresa ilegível não diz que não há empresa', async () => {
    banco.falhas['company.select'] = { erro: { message: 'timeout' } };
    const r = await rodar('ver_minha_conta', {}, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'falha_ao_ler' });
    expect(r.empresa).toBeUndefined();
  });

  it('alterar com a empresa ilegível não vira "empresa_nao_cadastrada" e não escreve', async () => {
    banco.falhas['company.select'] = { erro: { message: 'timeout' } };
    const r = await confirma({ cidade: 'Araguari' }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'falha_ao_ler' });
    expect(banco.escritas).toHaveLength(0);
  });

  it('sem conseguir ler o limite de 90 dias, a troca de CNPJ não passa', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'timeout' } };
    // a reserva da fila também é lida de system_state: a falha dela já barra antes; as duas leituras barram
    const r = await rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: false }, ctx());
    expect(r.ok).toBe(false);
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
    expect(banco.escritas).toHaveLength(0);
  });
});

describe('alterar_dados_empresa: identidade', () => {
  it('telefone com 0 usuários recusa, tanto a prévia quanto a escrita', async () => {
    for (const confirmado of [false, true]) {
      const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado }, ctx({ userIds: [] }));
      expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'conta_nao_identificada', proximo_passo: 'abrir_chamado' });
    }
    expect(escritasEmCompany()).toHaveLength(0);
  });

  it('telefone com 2 usuários recusa e manda abrir chamado', async () => {
    const r = await confirma({ cidade: 'Araguari' }, ctx({ userIds: [UID, 'user-2'] }));
    expect(r).toMatchObject({ ok: false, motivo: 'telefone_em_mais_de_uma_conta', proximo_passo: 'abrir_chamado' });
    expect(empresa().cidade).toBe('Uberlândia');
    expect(banco.escritas).toHaveLength(0);
  });

  it('o usuário nunca vem da entrada do modelo: user_id no input é ignorado', async () => {
    banco.poe('company', { user_id: 'vitima', nome: 'VITIMA', cidade: 'Rio' });
    const c = ctx();
    const entrada = { user_id: 'vitima', campos: { cidade: 'Araguari', user_id: 'vitima' } };
    await rodar('alterar_dados_empresa', { ...entrada, confirmado: false }, ctxDaPrevia(c));
    const r = await rodar('alterar_dados_empresa', { ...entrada, confirmado: true }, c);
    expect(r.aplicado).toBe(true);
    expect(banco.linhas('company').find(x => x.user_id === 'vitima')!.cidade).toBe('Rio');
    expect(empresa().cidade).toBe('Araguari');
  });

  it('sem id da mensagem (chamada fora da fila) a escrita recusa, mas a prévia funciona', async () => {
    const c = ctx({ filaId: null });
    const previa = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, c);
    expect(previa.previa).toBe(true);
    const r = await confirma({ cidade: 'Araguari' }, c);
    expect(r).toMatchObject({ ok: false, motivo: 'sem_id_da_mensagem' });
    expect(empresa().cidade).toBe('Uberlândia');
  });
});

describe('alterar_dados_empresa: campos e prévia', () => {
  it('campo fora da lista é ignorado e não chega ao banco', async () => {
    const c = ctx();
    const campos = { cidade: 'Araguari', email: 'novo@x.com', plano: 'ilimitado', whatsapp: '1199', logo_base64: 'x', socio_adm: 'x' };
    await rodar('alterar_dados_empresa', { campos, confirmado: false }, ctxDaPrevia(c));
    const r = await rodar('alterar_dados_empresa', { campos, confirmado: true }, c);
    expect(r.aplicado).toBe(true);
    expect(r.ignorados).toEqual(expect.arrayContaining(['email', 'plano', 'whatsapp', 'logo_base64', 'socio_adm']));
    const escrita = escritasEmCompany().find(e => e.op === 'update')!;
    expect(Object.keys(escrita.payload)).toEqual(['cidade']);
    expect(banco.escritas.filter(e => e.tabela === 'users')).toHaveLength(0);
    expect(empresa().whatsapp).toBe('34998364589');
  });

  it('só campos fora da lista: recusa sem escrever', async () => {
    const r = await confirma({ email: 'a@b.com' }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'nenhum_campo_valido' });
    expect(banco.escritas).toHaveLength(0);
  });

  it('confirmado=false devolve antes e depois e não escreve nada', async () => {
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari', endereco: 'Rua B, 20' }, confirmado: false }, ctx());
    expect(r.previa).toBe(true);
    expect(r.aplicado).toBe(false);
    expect(r.mudancas).toEqual([
      { campo: 'endereço', hoje: 'Rua A, 10', vai_ficar: 'Rua B, 20' },
      { campo: 'cidade', hoje: 'Uberlândia', vai_ficar: 'Araguari' },
    ]);
    // A única escrita é a prévia amarrada ao pedido (system_state); empresa, usuário e chamado ficam como estavam.
    expect(banco.escritas.map(e => e.tabela)).toEqual(['system_state']);
    expect(String(banco.escritas[0]!.payload.key)).toMatch(/^giovanna_previa:3498364589:/);
    expect(empresa().cidade).toBe('Uberlândia');
  });

  it('valor igual ao atual não vira mudança', async () => {
    const r = await confirma({ cidade: 'Uberlândia' }, ctx());
    expect(r).toMatchObject({ ok: true, aplicado: false, sem_mudanca: true });
    expect(banco.escritas).toHaveLength(0);
  });

  it('texto de linha só com espaços e quebras é limpo, e valor longo demais recusa', async () => {
    const limpo = await rodar('alterar_dados_empresa', { campos: { endereco: '  Rua   C,\n 30 ' }, confirmado: false }, ctx());
    expect(limpo.mudancas[0].vai_ficar).toBe('Rua C, 30');
    const longo = await confirma({ cidade: 'x'.repeat(200) }, ctx());
    expect(longo).toMatchObject({ ok: false, motivo: 'valor_longo_demais' });
  });
});

describe('alterar_dados_empresa: escrita', () => {
  it('confirmado=true escreve, relê, registra em tech_issues (resolvido_agente) e deixa o aviso pendente', async () => {
    const c = ctx();
    const r = await confirma({ cidade: 'Araguari', razao_social: 'ACME ENERGIA LTDA' }, c);
    expect(r).toMatchObject({ ok: true, aplicado: true, conferido: true });
    expect(empresa()).toMatchObject({ cidade: 'Araguari', nome: 'ACME ENERGIA LTDA', nome_fantasia: 'Acme Solar', cnpj: CNPJ_VELHO });

    const chamado = banco.linhas('tech_issues').find(t => t.area === 'alteracao_cadastro')!;
    expect(chamado.status).toBe('resolvido_agente');
    const desc = JSON.parse(chamado.descricao);
    expect(desc).toMatchObject({ user_id: UID, fila_id: 'fila-1', hash: expect.any(String) });
    expect(desc.antes).toEqual({ nome: 'ACME LTDA', cidade: 'Uberlândia' });
    expect(desc.depois).toEqual({ nome: 'ACME ENERGIA LTDA', cidade: 'Araguari' });

    expect(c.avisosPendentes.map(a => a.campo).sort()).toEqual(['cidade', 'razão social']);
  });

  it('idempotente pelo filaId: o retry da fila devolve o resultado e não escreve, não registra e não avisa de novo', async () => {
    const c1 = ctx();
    await confirma({ cidade: 'Araguari' }, c1);
    const escritasAntes = banco.escritas.length;
    const chamadosAntes = banco.linhas('tech_issues').length;

    const c2 = ctx(); // mesma fila, outra execução
    const r2 = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c2);
    expect(r2).toMatchObject({ ok: true, aplicado: true, ja_feito_antes: true });
    expect(banco.escritas.length).toBe(escritasAntes);
    expect(banco.linhas('tech_issues')).toHaveLength(chamadosAntes);
    expect(c2.avisosPendentes).toHaveLength(0);
  });

  it('retry depois de queda entre reservar e terminar: refaz o mesmo patch uma vez, sem duplicar o registro', async () => {
    const c = ctx();
    const hash = await hashDoPedido({ cidade: 'Araguari' });
    // A rodada anterior reservou e caiu antes de gravar na empresa.
    banco.poe('system_state', {
      key: `giovanna_alteracao:fila-1:${hash}`,
      value: {
        estado: 'reservado', user_id: UID, fila_id: 'fila-1', hash, em: new Date().toISOString(),
        mudancas: [{ chave: 'cidade', coluna: 'cidade', campo: 'cidade', antes: 'Uberlândia', depois: 'Araguari' }],
        patch: { cidade: 'Araguari' }, antes: { cidade: 'Uberlândia' },
      },
      updated_at: new Date().toISOString(),
    });
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c);
    expect(r.aplicado).toBe(true);
    expect(empresa().cidade).toBe('Araguari');
    expect(banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro')).toHaveLength(1);
    expect(c.avisosPendentes).toHaveLength(1);
  });

  it('a reserva de outra conta com o mesmo filaId não é reaproveitada', async () => {
    const hash = await hashDoPedido({ cidade: 'Araguari' });
    banco.poe('system_state', {
      key: `giovanna_alteracao:fila-1:${hash}`, value: { estado: 'feito', user_id: 'outro-user', fila_id: 'fila-1', hash, mudancas: [], patch: {}, antes: {}, resultado: { ok: true } },
      updated_at: new Date().toISOString(),
    });
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, ctx());
    expect(r.ok).toBe(false);
    expect(empresa().cidade).toBe('Uberlândia');
  });

  it('falha ao gravar na empresa devolve recusa, marca a reserva e não avisa o dono', async () => {
    banco.falhas['company.update'] = { erro: { code: '500', message: 'boom' } };
    const c = ctx();
    const r = await confirma({ cidade: 'Araguari' }, c);
    expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'falha_ao_gravar' });
    expect(c.avisosPendentes).toHaveLength(0);
    expect(banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro')).toHaveLength(0);
  });
});

describe('alterar_dados_empresa: CNPJ', () => {
  it('dígito verificador inválido recusa antes de qualquer consulta', async () => {
    const r = await confirma({ cnpj: '11.222.333/0001-82' }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_invalido' });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('CNPJ já usado por outra conta recusa: banco formatado, entrada só com dígitos', async () => {
    banco.poe('company', { user_id: 'outro', nome: 'OUTRA', cnpj: CNPJ_NOVO_FMT });
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_em_outra_conta' });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('CNPJ já usado por outra conta recusa: banco só com dígitos, entrada formatada', async () => {
    banco.poe('company', { user_id: 'outro', nome: 'OUTRA', cnpj: CNPJ_NOVO });
    const r = await confirma({ cnpj: CNPJ_NOVO_FMT }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_em_outra_conta' });
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('Receita com situação diferente de ATIVA recusa', async () => {
    fetchFalso.mockResolvedValueOnce(receitaOk({ descricao_situacao_cadastral: 'BAIXADA', situacao_cadastral: 8 }));
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_nao_ativo', situacao_na_receita: 'BAIXADA' });
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
    expect(banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_cnpj:'))).toBeUndefined();
  });

  it('CNPJ que a Receita não conhece (404) recusa', async () => {
    fetchFalso.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_nao_encontrado_na_receita' });
  });

  it('BrasilAPI fora (erro 500, rede ou timeout) não altera e orienta abrir chamado', async () => {
    fetchFalso.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await confirma({ cnpj: CNPJ_NOVO }, ctx()))
      .toMatchObject({ ok: false, motivo: 'receita_indisponivel', proximo_passo: 'abrir_chamado' });
    fetchFalso.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await confirma({ cnpj: CNPJ_NOVO }, ctx({ filaId: 'fila-2' })))
      .toMatchObject({ ok: false, motivo: 'receita_indisponivel' });
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('consulta a BrasilAPI com timeout de 5 s (signal)', async () => {
    await rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: false }, ctx());
    const [url, opts] = fetchFalso.mock.calls[0]!;
    expect(url).toBe(`https://brasilapi.com.br/api/cnpj/v1/${CNPJ_NOVO}`);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('troca válida: grava formatado, razão e fantasia vêm da Receita, trava 90 dias e avisa', async () => {
    const c = ctx();
    const previa = await rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: false }, c);
    expect(previa.mudancas.map((m: any) => m.campo)).toEqual(['CNPJ', 'razão social', 'nome fantasia']);
    expect(escritasEmCompany()).toHaveLength(0);

    const r = await confirma({ cnpj: CNPJ_NOVO }, c);
    expect(r).toMatchObject({ ok: true, aplicado: true });
    expect(empresa()).toMatchObject({ cnpj: CNPJ_NOVO_FMT, nome: 'SOL NOVO ENERGIA LTDA', nome_fantasia: 'Sol Novo' });
    expect(banco.linhas('system_state').find(x => x.key === `giovanna_cnpj:${UID}`)).toBeDefined();
    expect(c.avisosPendentes.map(a => a.campo)).toEqual(['CNPJ', 'razão social', 'nome fantasia']);
  });

  it('fantasia pedida pelo usuário vence a da Receita', async () => {
    const r = await confirma({ cnpj: CNPJ_NOVO, nome_fantasia: 'Minha Marca' }, ctx());
    expect(r.aplicado).toBe(true);
    expect(empresa()).toMatchObject({ cnpj: CNPJ_NOVO_FMT, nome: 'SOL NOVO ENERGIA LTDA', nome_fantasia: 'Minha Marca' });
  });

  it('razão social digitada junto com a troca de CNPJ é desconsiderada (vale a da Receita)', async () => {
    const r = await confirma({ cnpj: CNPJ_NOVO, razao_social: 'INVENTADA SA' }, ctx());
    expect(r.aplicado).toBe(true);
    expect(empresa().nome).toBe('SOL NOVO ENERGIA LTDA');
  });

  it('limite de 1 troca a cada 90 dias por usuário', async () => {
    const ha80 = new Date(Date.now() - 80 * 86_400_000).toISOString();
    banco.poe('system_state', { key: `giovanna_cnpj:${UID}`, value: {}, updated_at: ha80 });
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_trocado_recentemente' });
    expect(r.pode_trocar_de_novo_em).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
    expect(fetchFalso).not.toHaveBeenCalled();

    // Passados os 90 dias, libera.
    banco.linhas('system_state').find(x => x.key === `giovanna_cnpj:${UID}`)!.updated_at = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const depois = await confirma({ cnpj: OUTRO_CNPJ }, ctx({ filaId: 'fila-9' }));
    expect(depois.aplicado).toBe(true);
    expect(empresa().cnpj).toBe(OUTRO_CNPJ_FMT);
  });

  it('o mesmo CNPJ que a conta já tem (formatado ou não) não é troca', async () => {
    const r = await confirma({ cnpj: '11222333000181' }, ctx());
    expect(r).toMatchObject({ ok: true, sem_mudanca: true });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_cnpj:'))).toBeUndefined();
  });
});

describe('aviso ao dono', () => {
  it('o texto segue o modelo, com uma linha "Mudou" por campo', () => {
    const t = montarAvisoDono({
      email: 'joao@x.com', telefone: '5534998364589',
      mudancas: [{ campo: 'cidade', antes: 'Uberlândia', depois: 'Araguari' }, { campo: 'endereço', antes: '', depois: 'Rua B' }],
    });
    expect(t).toBe([
      'Cadastro alterado pelo agente',
      'Cliente: joao@x.com',
      'Telefone: 5534998364589',
      'Mudou cidade: de Uberlândia para Araguari',
      'Mudou endereço: de (em branco) para Rua B',
      'Já foi feito, não precisa aprovar.',
      'O valor antigo ficou guardado no chamado para desfazer.',
    ].join('\n'));
  });

  it('só há aviso pendente quando o valor muda: prévia, recusa e igual ao atual não deixam nada', async () => {
    const c = ctx();
    await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, c);
    await confirma({ cidade: 'Uberlândia' }, c);
    await confirma({ cnpj: '11.222.333/0001-82' }, c);
    expect(c.avisosPendentes).toHaveLength(0);
    await confirma({ cidade: 'Araguari' }, c);
    expect(c.avisosPendentes).toEqual([{ campo: 'cidade', antes: 'Uberlândia', depois: 'Araguari', chamado: true }]);
  });
});

describe('duas alterações diferentes na mesma mensagem (item 1)', () => {
  it('endereço e cidade, cada um com a sua prévia e o seu sim, gravam os dois; repetir um deles não grava de novo', async () => {
    const c = ctx(); // mesma fila para as duas
    const r1 = await confirma({ endereco: 'Rua B, 20' }, c);
    const r2 = await confirma({ cidade: 'Araguari' }, c);
    expect(r1).toMatchObject({ ok: true, aplicado: true });
    expect(r2).toMatchObject({ ok: true, aplicado: true });
    expect(r2.ja_feito_antes).toBeUndefined();
    expect(empresa()).toMatchObject({ endereco: 'Rua B, 20', cidade: 'Araguari' });
    expect(c.avisosPendentes.map(a => a.campo)).toEqual(['endereço', 'cidade']);
    expect(banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro')).toHaveLength(2);

    const antes = escritasEmCompany().length;
    const rep = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c);
    expect(rep).toMatchObject({ aplicado: true, ja_feito_antes: true });
    expect(escritasEmCompany().length).toBe(antes);
    expect(c.avisosPendentes).toHaveLength(2);
  });

  it('cada pedido tem a sua reserva (hash diferente na chave) e guarda o valor de antes', async () => {
    const c = ctx();
    await confirma({ endereco: 'Rua B, 20' }, c);
    await confirma({ cidade: 'Araguari' }, c);
    const reservas = banco.linhas('system_state').filter(x => String(x.key).startsWith('giovanna_alteracao:fila-1:'));
    expect(reservas).toHaveLength(2);
    expect(reservas.map(x => x.value.estado)).toEqual(['feito', 'feito']);
    expect(reservas.map(x => x.value.antes)).toEqual([{ endereco: 'Rua A, 10' }, { cidade: 'Uberlândia' }]);
  });

  it('o mesmo pedido com os campos em outra ordem ou o CNPJ com outra máscara cai na mesma reserva', async () => {
    const c = ctx();
    await confirma({ endereco: 'Rua B, 20', cidade: 'Araguari' }, c);
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari', endereco: 'Rua B, 20' }, confirmado: true }, c);
    expect(r.ja_feito_antes).toBe(true);
  });
});

describe('registro e aviso quando o chamado não grava (item 3)', () => {
  it('a busca do registro é pelo JSON exato: a fila-12 (ou dígitos de CNPJ) não esconde o registro da fila-1', async () => {
    banco.poe('tech_issues', {
      id: 'x', phone: '5534998364589', area: 'alteracao_cadastro', status: 'resolvido_agente', created_at: new Date().toISOString(),
      descricao: JSON.stringify({ user_id: UID, fila_id: 'fila-12', hash: 'abc', antes: { cnpj: '11.222.333/0001-81 fila-1' }, depois: {} }),
    });
    const c = ctx();
    await confirma({ cidade: 'Araguari' }, c);
    const meus = banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro');
    expect(meus).toHaveLength(2);
    expect(meus[1]!.descricao).toMatch(/"fila_id":"fila-1","hash":"[0-9a-f]{16}"/);
    expect(c.avisosPendentes[0]!.chamado).toBe(true);
  });

  it('chamado que não grava: o aviso diz "no sistema", e o valor antigo está na reserva de verdade', async () => {
    banco.falhas['tech_issues.insert'] = { erro: { code: '23514', message: 'check constraint' } };
    const c = ctx();
    const r = await confirma({ cidade: 'Araguari' }, c);
    expect(r.aplicado).toBe(true);
    expect(c.avisosPendentes[0]!.chamado).toBe(false);
    const texto = montarAvisoDono({ email: 'joao@x.com', telefone: '5534998364589', mudancas: c.avisosPendentes });
    expect(texto).toContain('O valor antigo ficou guardado no sistema para desfazer.');
    expect(texto).not.toContain('no chamado');
    const reserva = banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_alteracao:fila-1:'))!;
    expect(reserva.value).toMatchObject({ estado: 'feito', registrado: false, antes: { cidade: 'Uberlândia' } });
  });

  it('com o chamado gravado, o aviso diz "no chamado"', () => {
    const t = montarAvisoDono({ email: 'a@b.com', telefone: '1', mudancas: [{ campo: 'cidade', antes: 'a', depois: 'b', chamado: true }] });
    expect(t).toContain('O valor antigo ficou guardado no chamado para desfazer.');
  });
});

describe('releitura que falha depois de gravar (item 4)', () => {
  it('a alteração conta como feita: registra, deixa o aviso pendente e fecha a reserva, sem falha_interna', async () => {
    // company.select: 1 = prévia, 2 = confirmação, 3 = releitura (esta falha).
    banco.falhas['company.select'] = { erro: { message: 'timeout' }, uma: true, pular: 2 };
    const c = ctx();
    const r = await confirma({ cidade: 'Araguari' }, c);
    expect(r).toMatchObject({ ok: true, aplicado: true, conferido: false });
    expect(r.motivo).toBeUndefined();
    expect(empresa().cidade).toBe('Araguari');
    expect(banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro')).toHaveLength(1);
    expect(c.avisosPendentes).toHaveLength(1);
    const reserva = banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_alteracao:fila-1:'))!;
    expect(reserva.value.estado).toBe('feito');
  });
});

describe('a confirmação só vale com a prévia do mesmo pedido (item 5)', () => {
  it('sem prévia, recusa e não grava', async () => {
    const c = ctx();
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c);
    expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'previa_necessaria' });
    expect(banco.escritas).toHaveLength(0);
    expect(empresa().cidade).toBe('Uberlândia');
  });

  it('prévia e confirmação na MESMA mensagem não valem: o sim tem que vir de outra mensagem da fila', async () => {
    const c = ctx();
    const previa = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, c);
    expect(previa.previa).toBe(true);
    const escritasAntes = banco.escritas.length;
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c);
    expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'previa_necessaria' });
    expect(r.aviso).toBe('Mostre a prévia e espere a resposta do usuário numa próxima mensagem');
    expect(banco.escritas.length).toBe(escritasAntes); // nada gravado depois da prévia
    expect(empresa().cidade).toBe('Uberlândia');
    expect(c.avisosPendentes).toHaveLength(0);
    expect(banco.linhas('tech_issues')).toHaveLength(0);

    // Na mensagem seguinte (outro id de fila), com o sim, passa; e o retry dessa mensagem também.
    const sim = ctx({ filaId: 'fila-2' });
    expect(await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, sim)).toMatchObject({ aplicado: true });
    expect(await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, ctx({ filaId: 'fila-2' })))
      .toMatchObject({ aplicado: true, ja_feito_antes: true });
  });

  it('prévia de um valor não autoriza outro valor', async () => {
    const c = ctx();
    await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, ctxDaPrevia(c));
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Ituiutaba' }, confirmado: true }, c);
    expect(r).toMatchObject({ ok: false, motivo: 'previa_necessaria' });
    expect(empresa().cidade).toBe('Uberlândia');
  });

  it('prévia de outro campo não autoriza trocar o CNPJ', async () => {
    const c = ctx();
    await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, ctxDaPrevia(c));
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari', cnpj: CNPJ_NOVO }, confirmado: true }, c);
    expect(r).toMatchObject({ ok: false, motivo: 'previa_necessaria' });
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('prévia com mais de 30 min não vale; com 29 min vale', async () => {
    const c = ctx();
    await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, ctxDaPrevia(c));
    const previa = banco.linhas('system_state').find(x => String(x.key).startsWith('giovanna_previa:'))!;
    previa.value = { ...previa.value, em: new Date(Date.now() - 31 * 60_000).toISOString() };
    expect(await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c)).toMatchObject({ motivo: 'previa_necessaria' });
    previa.value = { ...previa.value, em: new Date(Date.now() - 29 * 60_000).toISOString() };
    expect(await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, c)).toMatchObject({ aplicado: true });
  });

  it('a prévia é por contato: a de outro telefone não vale', async () => {
    await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, ctx({ chaveContato: '1199999999', phone: '5511999999999' }));
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: true }, ctx());
    expect(r).toMatchObject({ motivo: 'previa_necessaria' });
  });

  it('se a prévia não pôde ser guardada, não há prévia a confirmar', async () => {
    banco.falhas['system_state.upsert'] = { erro: { message: 'timeout' } };
    const r = await rodar('alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'falha_ao_guardar_previa' });
  });
});

describe('unicidade do CNPJ só por dígitos (item 6)', () => {
  it.each([
    ['54.129.446/0001-40'], ['54129446000140'], ['54 129 446 0001 40'], ['54-129-446/0001.40'], ['  54.129.446/0001-40 '],
  ])('CNPJ guardado como "%s" em outra conta barra a troca', async (guardado) => {
    banco.poe('company', { user_id: 'outro', nome: 'OUTRA', cnpj: guardado });
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, motivo: 'cnpj_em_outra_conta' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('o ilike usa curinga entre os grupos de dígitos', async () => {
    // Observável pelo efeito: formatos que só um curinga entre grupos acharia.
    banco.poe('company', { user_id: 'outro', nome: 'OUTRA', cnpj: 'CNPJ: 54.129.446/0001-40 (matriz)' });
    expect(await confirma({ cnpj: CNPJ_NOVO }, ctx())).toMatchObject({ motivo: 'cnpj_em_outra_conta' });
  });

  it('candidato que casa o curinga mas tem dígitos diferentes NÃO barra', async () => {
    banco.poe('company', { user_id: 'outro', nome: 'OUTRA', cnpj: '54.129.446/0001-401' }); // 15 dígitos
    banco.poe('company', { user_id: 'outro2', nome: 'OUTRA2', cnpj: '154.129.446/0001-40' }); // 15 dígitos
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: true, aplicado: true });
  });

  it('o CNPJ da própria conta, em qualquer máscara, não conta como "outra conta"', async () => {
    empresa().cnpj = '11 222 333 0001 81';
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r.aplicado).toBe(true);
  });
});

describe('a trava de 90 dias é atômica (item 7)', () => {
  it('duas trocas de CNPJ ao mesmo tempo (mensagens diferentes): só uma passa', async () => {
    const a = ctx({ filaId: 'fila-A' });
    const b = ctx({ filaId: 'fila-B' });
    await rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: false }, ctxDaPrevia(a));
    await rodar('alterar_dados_empresa', { campos: { cnpj: OUTRO_CNPJ }, confirmado: false }, ctxDaPrevia(b));
    const [ra, rb] = await Promise.all([
      rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: true }, a),
      rodar('alterar_dados_empresa', { campos: { cnpj: OUTRO_CNPJ }, confirmado: true }, b),
    ]);
    const aplicados = [ra, rb].filter(r => r.aplicado === true);
    const recusados = [ra, rb].filter(r => r.aplicado === false);
    expect(aplicados).toHaveLength(1);
    expect(recusados).toHaveLength(1);
    expect(recusados[0]).toMatchObject({ motivo: 'cnpj_trocado_recentemente' });
    expect(escritasEmCompany().filter(e => e.op === 'update')).toHaveLength(1);
    expect(['54.129.446/0001-40', '11.444.777/0001-61']).toContain(empresa().cnpj);
  });

  it('a trava é tomada ANTES de escrever na empresa', async () => {
    const c = ctx();
    await confirma({ cnpj: CNPJ_NOVO }, c);
    const ordem = banco.escritas.map(e => `${e.tabela}.${e.op}`);
    expect(ordem.indexOf('system_state.insert')).toBeGreaterThan(-1);
    const iTrava = banco.escritas.findIndex(e => e.tabela === 'system_state' && String(e.payload?.key).startsWith('giovanna_cnpj:'));
    const iEmpresa = banco.escritas.findIndex(e => e.tabela === 'company' && e.op === 'update');
    expect(iTrava).toBeGreaterThan(-1);
    expect(iTrava).toBeLessThan(iEmpresa);
  });

  it('trava com mais de 90 dias é renovada por update condicional (e a empresa muda)', async () => {
    banco.poe('system_state', { key: `giovanna_cnpj:${UID}`, value: {}, updated_at: new Date(Date.now() - 100 * 86_400_000).toISOString() });
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r.aplicado).toBe(true);
    const trava = banco.linhas('system_state').find(x => x.key === `giovanna_cnpj:${UID}`)!;
    expect(trava.value).toMatchObject({ fila_id: 'fila-1' });
    expect(Date.now() - Date.parse(trava.updated_at)).toBeLessThan(60_000);
  });

  it('se a trava não pôde ser gravada, a empresa não é tocada', async () => {
    // system_state.insert: 1 = reserva da alteração (passa), 2 = trava (falha)
    banco.falhas['system_state.insert'] = { erro: { code: '500', message: 'boom' }, uma: true, pular: 1 };
    const r = await confirma({ cnpj: CNPJ_NOVO }, ctx());
    expect(r).toMatchObject({ ok: false, aplicado: false, motivo: 'falha_ao_travar_limite' });
    expect(escritasEmCompany()).toHaveLength(0);
    expect(empresa().cnpj).toBe(CNPJ_VELHO);
  });

  it('o retry da mesma alteração reconhece a própria trava e conclui', async () => {
    const c = ctx();
    const hash = await hashDoPedido({ cnpj: CNPJ_NOVO });
    // Caiu depois de reservar e de travar, antes de gravar na empresa.
    const valor = {
      estado: 'reservado', user_id: UID, fila_id: 'fila-1', hash, em: new Date().toISOString(),
      mudancas: [{ chave: 'cnpj', coluna: 'cnpj', campo: 'CNPJ', antes: CNPJ_VELHO, depois: CNPJ_NOVO_FMT }],
      patch: { cnpj: CNPJ_NOVO_FMT }, antes: { cnpj: CNPJ_VELHO },
    };
    banco.poe('system_state',
      { key: `giovanna_alteracao:fila-1:${hash}`, value: valor, updated_at: new Date().toISOString() },
      { key: `giovanna_cnpj:${UID}`, value: { fila_id: 'fila-1', hash }, updated_at: new Date().toISOString() });
    const r = await rodar('alterar_dados_empresa', { campos: { cnpj: CNPJ_NOVO }, confirmado: true }, c);
    expect(r.aplicado).toBe(true);
    expect(empresa().cnpj).toBe(CNPJ_NOVO_FMT);
  });
});

describe('abrir_chamado', () => {
  it('passa área, descrição e diagnóstico à escalada que já existe', async () => {
    const c = ctx();
    const r = await rodar('abrir_chamado', { area: 'Leitura Conta', descricao: 'não lê a conta', diagnostico: 'ia_fora=true' }, c);
    expect(r).toMatchObject({ ok: true, aberto: true });
    expect(c.escalar).toHaveBeenCalledWith({ area: 'leitura_conta', descricao: 'não lê a conta', diagnostico: 'ia_fora=true' });
  });

  it('área inválida cai no padrão, e chamado repetido é dito ao modelo', async () => {
    const c = ctx({ escalar: vi.fn(async () => ({ aberto: false, jaTinha: true })) });
    const r = await rodar('abrir_chamado', { area: '??', descricao: 'x', diagnostico: 'y' }, c);
    expect((c.escalar as any).mock.calls[0][0].area).toBe('atendimento_giovanna');
    expect(r).toMatchObject({ ok: true, aberto: false, ja_tinha_chamado_aberto: true });
  });

  it('sem descrição não abre', async () => {
    const c = ctx();
    expect(await rodar('abrir_chamado', { diagnostico: 'y' }, c)).toMatchObject({ ok: false });
    expect(c.escalar).not.toHaveBeenCalled();
  });
});

describe('despacho', () => {
  it('ferramenta desconhecida e erro interno viram JSON, nunca exceção', async () => {
    expect(await rodar('apagar_tudo', {}, ctx())).toMatchObject({ ok: false });
    const c = ctx({ escalar: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await rodar('abrir_chamado', { descricao: 'x', diagnostico: 'y' }, c)).toMatchObject({ ok: false, motivo: 'falha_interna' });
  });
});
