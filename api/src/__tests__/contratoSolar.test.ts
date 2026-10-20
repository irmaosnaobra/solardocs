import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Contrato solar no agente (solar_m1 e solar_m2): tipos aceitos e recusados, lista branca sem identidade, campos sensíveis,
// valor por texto descartado, conflitos próprios do solar e "geração garantida". A Anthropic, o login e o log são
// simulados; nenhuma chamada sai para a rede. Os textos das cláusulas copiam os do Fechamento solar do /gerador.

const h = vi.hoisted(() => ({
  fila: [] as Array<{ erro?: unknown; saida?: unknown; parada?: string }>,
  chamadas: [] as Array<{ corpo: any }>,
}));

vi.mock('../utils/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      stream: (corpo: unknown) => {
        h.chamadas.push({ corpo });
        const e = h.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            return { stop_reason: e.parada ?? 'end_turn', parsed_output: e.saida, usage: { input_tokens: 10, output_tokens: 5 } };
          },
        };
      },
    },
  }),
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => token === 'tk-nilce'
        ? { data: { user: { email: 'nilce@irmaosnaobra.app', email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
        : { data: { user: null }, error: { message: 'jwt' } }),
    },
  },
}));
vi.mock('../utils/supabase', () => ({ supabase: {} }));

import { juntarConflitos, validarCombinacao } from '../services/gerador/contratoHibrido';
import { PedidoAgente, SISTEMA_AGENTE, checarConflitos, pedirAgente } from '../services/gerador/contratoAgente';
import { CAMPOS_AGENTE, CAMPO_POR_ID, camposDoItem, validarValorCampo } from '../services/gerador/contratoAgenteCampos';
import { ITENS_TRAVADOS_SOLAR, geracaoComoGarantia } from '../services/gerador/contratoSolar';
import { PedidoContratoIa, TIPOS_CONTRATO } from '../services/gerador/contratoIa';
import { mountContratoAgente } from '../routes/geradorContratoAgente';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const it_ = (key: string, html: string, extra: { travado?: boolean; campo?: string } = {}) =>
  ({ key, html, travado: !!extra.travado, ...(extra.campo ? { campo: extra.campo } : {}) });
const cl = (key: string, titulo: string, itens: ReturnType<typeof it_>[]) => ({ key, titulo, itens });

const DISCLAIMER = 'A geração informada é uma ESTIMATIVA baseada na irradiação solar histórica da região e na potência instalada. A produção real varia conforme clima, sombreamento, temperatura, sujidade dos módulos e disponibilidade da rede, não constituindo garantia de geração mínima.';

// Contrato Padrão (14 cláusulas), com as chaves propostas ao front.
const m2 = () => [
  cl('partes', 'Das partes', [
    it_('partes.contratada', '[travado: partes]', { travado: true }), it_('partes.cliente', '[travado: partes]', { travado: true }),
    it_('partes.resumo', '[travado: resumo]', { travado: true }),
  ]),
  cl('objeto', 'Objeto', [
    it_('objeto.sistema', '[travado: kwp]', { travado: true, campo: 'fs-c-kwp, fs-c-geracao' }),
    it_('objeto.geracao_nota', DISCLAIMER),
    it_('objeto.componentes', '[travado: componentes]', { travado: true, campo: 'fs-c-nmod, fs-c-mod, fs-c-ninv, fs-c-minv' }),
    it_('objeto.local', '[travado: local]', { travado: true, campo: 'fs-c-endinst' }),
    it_('objeto.cliente_area', 'Fica no escopo do CLIENTE deixar a área em condições para implantação da usina, como por exemplo limpeza e terraplanagem quando se fizer necessário.'),
  ]),
  cl('prazos', 'Prazos e execução', [
    it_('prazos.abertura', 'A CONTRATADA deverá:'),
    it_('prazos.projeto', 'Submeter o projeto técnico em até 5 (cinco) dias após o cumprimento das obrigações pelo CLIENTE.', { campo: 'fs-c-pproj' }),
    it_('prazos.aprovacao', 'Aguardar aprovação de órgãos reguladores, o que deverá ocorrer em até 40 (quarenta) dias, salvo pendências atribuídas ao CLIENTE ou terceiros.', { campo: 'fs-c-paprov' }),
    it_('prazos.obra', 'Realizar a instalação completa em até 10 (dez) dias úteis após a aprovação, podendo haver extensão de prazo devido a fatores externos, como condições climáticas adversas ou exigências das concessionárias locais de energia.', { campo: 'fs-c-pinst' }),
    it_('prazos.suspensao', 'Nota: Os prazos serão suspensos em caso de atrasos por responsabilidade do CLIENTE, dos fabricantes ou de órgãos reguladores.'),
  ]),
  cl('preco', 'Valor e condições de pagamento', [it_('preco.valor', '[travado: valor]', { travado: true }), it_('preco.forma', '[travado: pagamento]', { travado: true })]),
  cl('garantias', 'Garantias e manutenção', [
    it_('garantias.equipamentos', 'Equipamentos: As garantias dos equipamentos são exclusivamente do fabricante, cobrindo 25 (vinte e cinco) anos para módulos fotovoltaicos, 10 (dez) anos para o inversor, 5 (cinco) anos para a bateria, e prazos específicos para demais componentes conforme manual do fabricante.', { campo: 'fs-c-gmod, fs-c-ginv, fs-c-bat-gar' }),
    it_('garantias.instalacao', 'Instalação: A garantia de instalação é de 1 (um) ano, válida somente para defeitos de instalação devidamente constatados por laudo técnico.', { campo: 'fs-c-ginst' }),
    it_('garantias.exclusoes', 'Exclusões de Garantia: A garantia não se aplica em casos de mau uso, intervenções de terceiros sem autorização da CONTRATADA, ou danos causados por eventos de força maior, como tempestades e sobrecargas da rede de energia.'),
  ]),
  cl('rescisao', 'Rescisão contratual', [it_('rescisao.geral', 'Este contrato poderá ser rescindido a qualquer momento, desde que uma das partes comunique a outra com antecedência mínima de 30 dias. Em caso de rescisão por descumprimento, será cobrada multa de 10% sobre o valor total do contrato.')]),
  cl('desempenho', 'Desempenho e geração de energia', [
    it_('desempenho.estimativa', 'O desempenho estimado da usina é baseado em condições climáticas e operacionais normais.'),
    it_('desempenho.variacao', 'A geração de energia pode variar até 10% devido a condições climáticas e características do local.'),
    it_('desempenho.responsabilidade', 'A CONTRATADA não se responsabiliza por perdas de geração de energia decorrentes de fatores externos ou mudanças estruturais no local de instalação, tais como sombras adicionais.'),
  ]),
  cl('manutencao', 'Manutenção preventiva e corretiva', [it_('manutencao.preventiva', 'Após o período de garantia, a CONTRATADA poderá oferecer um serviço de manutenção preventiva e corretiva, mediante a contratação específica entre as partes.')]),
  cl('interrupcao', 'Multa por interrupção não autorizada', [it_('interrupcao.multa', 'Caso o CLIENTE ou terceiros não autorizados interfiram no sistema sem a aprovação da CONTRATADA, estará sujeito a multa de 5% do valor total do contrato, além da perda das garantias aplicáveis.')]),
  cl('foro', 'Foro', [it_('foro.comarca', 'As partes elegem o Foro da Comarca de Uberlândia para dirimir eventuais controvérsias decorrentes deste contrato, renunciando a qualquer outro foro.', { campo: 'fs-c-foro' })]),
  cl('assinaturas', 'Assinaturas', [it_('assinaturas.fecho', '[travado: assinaturas]', { travado: true, campo: 'fs-c-data' })]),
];

// Contrato Completo (15 cláusulas): garantias e prazos em itens separados.
const m1 = () => [
  cl('partes', 'Das partes', [it_('partes.contratada', '[travado: partes]', { travado: true }), it_('partes.contratante', '[travado: partes]', { travado: true })]),
  cl('objeto', 'OBJETO DO CONTRATO', [
    it_('objeto.escopo_resumo', 'A CONTRATADA compromete-se a fornecer os equipamentos especificados, elaborar o projeto técnico, realizar a instalação completa e providenciar a homologação junto à concessionária de energia elétrica local.'),
    it_('objeto.sistema', '[travado: especificações]', { travado: true, campo: 'fs-c-kwp, fs-c-nmod, fs-c-mod, fs-c-ninv, fs-c-minv, fs-c-geracao' }),
    it_('objeto.geracao_nota', DISCLAIMER),
  ]),
  cl('etapas', 'OBJETO DETALHADO: ETAPAS DOS SERVIÇOS', [
    it_('etapas.instalacao', 'Instalação: execução da montagem física do sistema, instalação elétrica, fixação dos módulos na estrutura do telhado ou solo, instalação do inversor e realização de todas as conexões necessárias;'),
  ]),
  cl('prazos', 'PRAZOS', [
    it_('prazos.projeto', 'Projeto técnico: até 5 (cinco) dias úteis após o envio da documentação pelo CONTRATANTE;', { campo: 'fs-c-pproj' }),
    it_('prazos.aprovacao', 'Aprovação da concessionária: prazo médio de até 40 (quarenta) dias, podendo variar conforme a análise e cronograma interno da distribuidora de energia;', { campo: 'fs-c-paprov' }),
    it_('prazos.obra', 'Instalação: até 10 (dez) dias úteis após a aprovação do projeto pela concessionária.', { campo: 'fs-c-pinst' }),
  ]),
  cl('preco', 'VALOR E CONDIÇÕES DE PAGAMENTO', [it_('preco.valor', '[travado: valor]', { travado: true }), it_('preco.forma', '[travado: pagamento]', { travado: true })]),
  cl('garantias', 'GARANTIAS', [
    it_('garantias.modulos', 'Módulos fotovoltaicos: 25 (vinte e cinco) anos de garantia, fornecida diretamente pelo fabricante, cobrindo defeitos de fabricação e degradação fora dos parâmetros técnicos informados em manual;', { campo: 'fs-c-gmod' }),
    it_('garantias.inversor', 'Inversor: 10 (dez) anos de garantia do fabricante, incluindo cobertura contra defeitos de funcionamento e falhas de componentes eletrônicos;', { campo: 'fs-c-ginv' }),
    it_('garantias.instalacao', 'Serviços de instalação: 1 (um) ano de garantia sobre a execução dos serviços realizados pela CONTRATADA, cobrindo exclusivamente defeitos provenientes da instalação, como infiltrações causadas pela fixação, falhas em conexões elétricas ou problemas estruturais gerados durante a obra.', { campo: 'fs-c-ginst' }),
    it_('garantias.fabricante', 'Vale destacar que as garantias dos equipamentos são administradas diretamente pelos respectivos fabricantes.'),
  ]),
  cl('homologacao', 'HOMOLOGAÇÃO JUNTO À CONCESSIONÁRIA', [it_('homologacao.prazos', 'Os prazos de análise e aprovação são definidos exclusivamente pela concessionária, estando fora do controle direto da CONTRATADA.')]),
  cl('desempenho', 'DESEMPENHO DO SISTEMA', [
    it_('desempenho.estimativa', 'O sistema fornecido foi dimensionado com base no perfil de consumo informado pelo CONTRATANTE. A estimativa de geração apresentada na proposta comercial constitui uma projeção técnica fundamentada, mas não representa uma garantia de produção exata.'),
    it_('desempenho.variacao', 'A geração real de energia poderá apresentar variação de até 10% (dez por cento) em relação à estimativa, em razão de fatores naturais e externos.'),
  ]),
  cl('manutencao', 'MANUTENÇÃO', [it_('manutencao.garantia', 'Durante o período de garantia da instalação, a CONTRATADA prestará assistência técnica sem custo adicional nos casos de defeitos cobertos pela garantia prevista na {{c:garantias}}.')]),
  cl('rescisao', 'RESCISÃO', [
    it_('rescisao.iniciativa', 'Por iniciativa de qualquer das partes, mediante comunicação prévia de 30 (trinta) dias, sem necessidade de justificativa;'),
    it_('rescisao.retencao', 'Na hipótese de rescisão antes do início da execução dos serviços, por iniciativa do CONTRATANTE sem justa causa, será retido um percentual de 10% (dez por cento) sobre o valor total do contrato.'),
  ]),
  cl('foro', 'FORO', [it_('foro.comarca', 'As partes elegem, de comum acordo, o Foro da Comarca de Uberlândia para dirimir eventuais dúvidas, divergências ou litígios decorrentes deste contrato.', { campo: 'fs-c-foro' })]),
  cl('assinaturas', 'ASSINATURAS', [it_('assinaturas.fecho', '[travado: assinaturas]', { travado: true, campo: 'fs-c-data' })]),
];
const FIXTURE = { solar_m1: m1, solar_m2: m2 } as const;

const corpo = (tipo: 'solar_m1' | 'solar_m2' = 'solar_m2', extra: Record<string, unknown> = {}) => ({
  tipo, hibrido: null, clausulas: FIXTURE[tipo](), campos: [], emitente: 'aioros',
  cadastro: { tem: true, faltando: [] }, historico: [], mensagem: 'faça a mudança', ...extra,
});
const NULO = { id: null, valor: null, modelo: null, op: null, tipos: null, pedido: null, emitente: null };
const campo = (id: string, valor: string) => ({ tipo: 'campo' as const, ...NULO, id, valor });
const opBase = { tipo: 'substituir_item', alvo: null, depois_de: null, id_novo: null, titulo: null, texto: null, itens: null };
const operacao = (op: Record<string, unknown>) => ({ tipo: 'operacao' as const, ...NULO, modelo: null, op: { ...opBase, ...op } });
const hib = (tipos: string[]) => ({ tipo: 'hibrido' as const, ...NULO, tipos });
const emit = (e: string) => ({ tipo: 'emitente' as const, ...NULO, emitente: e });
const ia = (p: Record<string, unknown> = {}) => ({ resposta: 'Feito.', acoes: [], achados: [], pergunta: null, avisos: [], conflitos: [], continuar: false, ...p });
const fila = (saida: unknown) => { h.fila.push({ saida }); };
const ok = async (tipo: 'solar_m1' | 'solar_m2', extra: Record<string, unknown> = {}) => {
  const r = await pedirAgente(PedidoAgente.parse(corpo(tipo, extra)));
  if (!r.ok) throw new Error('esperava ok: ' + JSON.stringify(r));
  return r;
};
/** Conflitos do servidor sobre o contrato de fábrica mais um item/cláusula inserido. */
const conflitosCom = (tipo: 'solar_m1' | 'solar_m2', extraClausula: ReturnType<typeof cl>) => {
  const r = checarConflitos({ tipo, hibrido: null, clausulas: [...FIXTURE[tipo](), extraClausula] });
  if (!r.ok) throw new Error('esperava ok');
  return r;
};

beforeEach(() => { h.fila.length = 0; h.chamadas.length = 0; });
afterEach(() => { h.fila.length = 0; });

// ── Tipos ────────────────────────────────────────────────────────────────────
describe('tipos solares', () => {
  it('solar_m1 e solar_m2 estão nos tipos do assistente, e um tipo solar desconhecido é recusado', () => {
    expect(TIPOS_CONTRATO).toContain('solar_m1');
    expect(TIPOS_CONTRATO).toContain('solar_m2');
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      expect(checarConflitos({ tipo: t, hibrido: null, clausulas: FIXTURE[t]() })).toMatchObject({ ok: true });
    }
    expect(checarConflitos({ tipo: 'solar_m3', hibrido: null, clausulas: m2() })).toMatchObject({ ok: false, status: 400 });
  });

  it('solar fica fora do híbrido, com motivo, em todo caminho', async () => {
    expect(validarCombinacao(['solar_m1', 'completo'])).toEqual({ ok: false, motivo: 'Os contratos solares não entram em contrato híbrido.' });
    expect(validarCombinacao(['arrend', 'solar_m2'])).toMatchObject({ ok: false });
    expect(checarConflitos({ tipo: null, hibrido: { tipos: ['solar_m1', 'completo'] }, clausulas: m1() })).toMatchObject({ ok: false, status: 400 });
    // O agente: a ação "hibrido" com um solar cai com aviso e não vira ação.
    fila(ia({ acoes: [hib(['solar_m1', 'completo'])] }));
    const r = await ok('solar_m1');
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/solares não entram em contrato híbrido/);
  });

  it('o /contrato/redesenhar antigo não aceita solar (continua só com os sete do eletroposto)', () => {
    expect(PedidoContratoIa.safeParse({ pedido: 'mude algo', clausulas: [cl('a', 'A', [])].map(c => ({ ...c, numero: '1', travada: false })), contrato: { tipo: 'solar_m1' } }).success).toBe(false);
    expect(PedidoContratoIa.safeParse({ pedido: 'mude algo', clausulas: [{ key: 'a', numero: '1', titulo: 'A', travada: false, itens: [] }], contrato: { tipo: 'completo' } }).success).toBe(true);
  });

  it('o agente aceita trocar para o modelo solar', async () => {
    fila(ia({ acoes: [{ tipo: 'modelo', ...NULO, modelo: 'solar_m1' }] }));
    const r = await ok('solar_m2');
    expect(r.acoes).toEqual([{ tipo: 'modelo', modelo: 'solar_m1' }]);
  });
});

// ── Lista branca ─────────────────────────────────────────────────────────────
describe('lista branca do solar', () => {
  const solares = CAMPOS_AGENTE.filter(c => c.modelos.some(m => m.startsWith('solar_')));
  it('todo campo solar é fs-c-*, vale nos dois modelos e só neles; nenhum ctr-* vale no solar', () => {
    expect(solares.length).toBeGreaterThan(20);
    for (const c of solares) {
      expect(c.id, c.id).toMatch(/^fs-c-/);
      expect(c.modelos, c.id).toEqual(['solar_m1', 'solar_m2']);
    }
    for (const c of CAMPOS_AGENTE.filter(x => x.id.startsWith('ctr-'))) {
      expect(c.modelos.filter(m => m.startsWith('solar_')), c.id).toEqual([]);
    }
  });

  it('nenhum campo de identidade, endereço, UC, número do contrato, modelo ou dado da empresa', () => {
    const ids = solares.map(c => c.id);
    expect(ids.filter(i => /(^fs-(doc|cep|end|bairro|rep|tipo|nome|cli)|endinst|-num$|-modelo$|-uc$|-conc$|titular|razao|cnpj|cpf|rg$|emp)/.test(i))).toEqual([]);
    for (const proibido of ['fs-c-endinst', 'fs-c-num', 'fs-c-modelo', 'fs-doc', 'fs-end', 'fs-rep', 'fs-p-uc']) expect(CAMPO_POR_ID.has(proibido), proibido).toBe(false);
  });

  it('valor, pagamento, kWp, geração, equipamento, quantidade e garantia de fabricante são sensíveis; prazo, foro, data e garantia da instalação não', () => {
    const sens = (id: string) => !!CAMPO_POR_ID.get(id)?.sensivel;
    for (const id of ['fs-c-valor', 'fs-c-pagto', 'fs-c-kwp', 'fs-c-geracao', 'fs-c-nmod', 'fs-c-mod', 'fs-c-ninv', 'fs-c-tinv', 'fs-c-minv',
      'fs-c-bat-marca', 'fs-c-bat-qtd', 'fs-c-bat-cap', 'fs-c-bat-gar', 'fs-c-gmod', 'fs-c-ginv']) expect(sens(id), id).toBe(true);
    for (const id of ['fs-c-pproj', 'fs-c-paprov', 'fs-c-pinst', 'fs-c-foro', 'fs-c-data', 'fs-c-ginst', 'fs-c-ginstun']) expect(sens(id), id).toBe(false);
  });

  it('o catálogo do prompt traz os campos solares, a AIOROS e a regra de nunca escrever NEXUS no solar', () => {
    for (const c of solares) expect(SISTEMA_AGENTE).toContain(`"id":"${c.id}"`);
    for (const t of ['Os nove modelos', 'Contratos solares (solar_m1 e solar_m2)', 'AIOROS GROUP LTDA', 'Irmãos na Obra', 'NUNCA escreva NEXUS', 'CLIENTE no solar_m2',
      'CONTRATANTE no solar_m1', 'ESTIMATIVA', 'UM prazo só']) expect(SISTEMA_AGENTE, t).toContain(t);
  });

  it('os itens travados e as chaves de campo propostas ao front existem na lista de origem dos itens', () => {
    for (const m of ['solar_m1', 'solar_m2'] as const) {
      for (const k of ['prazos.projeto', 'prazos.aprovacao', 'prazos.obra', 'garantias.instalacao', 'foro.comarca', 'preco.valor', 'preco.forma']) {
        expect(camposDoItem(m, k).length, `${m} ${k}`).toBeGreaterThan(0);
      }
      for (const k of ITENS_TRAVADOS_SOLAR[m]) expect(k).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
    expect(camposDoItem('solar_m1', 'garantias.modulos')).toEqual(['fs-c-gmod']);
    expect(camposDoItem('solar_m2', 'garantias.equipamentos').sort()).toEqual(['fs-c-bat-gar', 'fs-c-ginv', 'fs-c-gmod']);
  });

  it('validação: dinheiro BR, decimal com vírgula, inteiro e opção sem acento', () => {
    const v = (id: string, x: unknown) => validarValorCampo(CAMPO_POR_ID.get(id)!, x);
    expect(v('fs-c-valor', '27.400')).toEqual({ ok: true, valor: '27.400,00' });
    expect(v('fs-c-valor', '0')).toMatchObject({ ok: false });
    expect(v('fs-c-kwp', '5,4')).toEqual({ ok: true, valor: '5,4' });
    expect(v('fs-c-tinv', 'Híbrido')).toEqual({ ok: true, valor: 'hibrido' });
    expect(v('fs-c-tinv', 'hibrido')).toEqual({ ok: true, valor: 'hibrido' });
    expect(v('fs-c-ginstun', 'meses')).toEqual({ ok: true, valor: 'meses' });
    expect(v('fs-c-gmod', '1.000')).toMatchObject({ ok: false });
    expect(CAMPO_POR_ID.get('fs-c-tinv')?.valoresHtml).toEqual({ hibrido: 'híbrido' });
  });
});

// ── Ações do agente no solar ─────────────────────────────────────────────────
describe('agente no contrato solar', () => {
  it('campo sensível volta com confirmar:true; prazo não; campo ctr-* não vale no solar', async () => {
    fila(ia({ acoes: [campo('fs-c-valor', '27.400'), campo('fs-c-pinst', '15'), campo('ctr-foro', 'Goiânia'), campo('fs-c-endinst', 'Rua X, 10')] }));
    const r = await ok('solar_m2');
    expect(r.acoes).toEqual([
      expect.objectContaining({ tipo: 'campo', id: 'fs-c-valor', valor: '27.400,00', confirmar: true }),
      expect.objectContaining({ tipo: 'campo', id: 'fs-c-pinst', valor: '15', confirmar: false }),
    ]);
    expect(r.avisos.join(' ')).toMatch(/não existe neste contrato/);
    expect(r.avisos.join(' ')).toMatch(/não está na lista/);
  });

  it('valor e percentual escritos por texto são descartados no solar; o que já existe no contrato passa', async () => {
    fila(ia({ acoes: [
      operacao({ alvo: 'garantias.exclusoes', texto: 'A garantia vale mediante pagamento adicional de R$ 3.000,00.' }),
      operacao({ alvo: 'rescisao.geral', texto: 'Em caso de rescisão por descumprimento, será cobrada multa de 25% sobre o valor total do contrato.' }),
      operacao({ alvo: 'rescisao.geral', texto: 'Em caso de rescisão por descumprimento, será cobrada multa de 10% sobre o valor total do contrato, notificada por escrito.' }),
    ] }));
    const r = await ok('solar_m2');
    expect(r.avisos.filter(a => a === 'Valor e percentual só mudam pelo campo.')).toHaveLength(1);
    const ops = r.acoes.filter(a => a.tipo === 'operacao');
    expect(ops).toHaveLength(1);
    expect(JSON.stringify(ops[0])).toContain('notificada por escrito');
  });

  it('item travado do solar não muda por operação (preço, forma de pagamento, sistema, partes)', async () => {
    fila(ia({ acoes: ['preco.valor', 'preco.forma', 'objeto.sistema', 'partes.contratada'].map(alvo => operacao({ alvo, texto: 'Novo texto sem número.' })) }));
    const r = await ok('solar_m2');
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/campo próprio na tela/);
  });

  it('campo e operação sobre o mesmo item no mesmo turno: a operação cai (garantia da instalação)', async () => {
    fila(ia({ acoes: [campo('fs-c-ginst', '2'), operacao({ alvo: 'garantias.instalacao', texto: 'Instalação: a garantia de instalação cobre defeitos constatados por laudo técnico.' })] }));
    const r = await ok('solar_m2');
    expect(r.acoes.map(a => a.tipo)).toEqual(['campo']);
    expect(r.avisos.join(' ')).toMatch(/Mudei pelo campo/);
  });

  it('o emitente do solar é sempre a AIOROS: "nexus" cai com aviso, "aioros" passa', async () => {
    fila(ia({ acoes: [emit('nexus')] }));
    const a = await ok('solar_m1', { emitente: 'aioros' });
    expect(a.acoes).toEqual([]);
    expect(a.avisos.join(' ')).toMatch(/sempre da AIOROS/);
    fila(ia({ acoes: [emit('aioros')] }));
    const b = await ok('solar_m1', { emitente: 'nexus' });
    expect(b.acoes).toEqual([{ tipo: 'emitente', emitente: 'aioros' }]);
    // No eletroposto a troca para a NEXUS continua valendo.
    fila(ia({ acoes: [emit('nexus')] }));
    const c = await pedirAgente(PedidoAgente.parse({ ...corpo('solar_m2'), tipo: 'completo', clausulas: [cl('objeto', 'Do objeto', [it_('objeto.1', 'Texto.')])], emitente: 'aioros' }));
    expect(c).toMatchObject({ ok: true, acoes: [{ tipo: 'emitente', emitente: 'nexus' }] });
  });
});

// ── Geração garantida ────────────────────────────────────────────────────────
describe('estimativa de geração tratada como garantia', () => {
  it('frases que prometem geração são pegas; a estimativa, a negação e a garantia do fabricante passam', () => {
    for (const t of [
      'A CONTRATADA garante geração mínima de 700 kWh por mês.', 'Fica garantida a produção de 5.000 kWh/mês.', 'A CONTRATADA assegura o desempenho do sistema em 90% da estimativa.',
      'Garantimos a geração de energia informada na proposta.',
    ]) expect(geracaoComoGarantia(t), t).toBe(true);
    for (const t of [
      DISCLAIMER, 'A estimativa de geração apresentada na proposta comercial constitui uma projeção técnica fundamentada, mas não representa uma garantia de produção exata.',
      'A geração real de energia poderá apresentar variação de até 10% (dez por cento) em relação à estimativa.', 'A CONTRATADA não garante geração mínima.',
      'Módulos fotovoltaicos: 25 anos de garantia do fabricante, cobrindo defeitos e degradação de desempenho fora dos parâmetros.', 'A CONTRATADA garante a instalação por 1 ano.',
    ]) expect(geracaoComoGarantia(t), t).toBe(false);
  });

  it('o texto de fábrica dos dois contratos tem zero conflito e não bloqueia (multa de rescisão e de interrupção, estimativas, garantias)', () => {
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      const r = checarConflitos({ tipo: t, hibrido: null, clausulas: FIXTURE[t]() });
      expect(r, t).toEqual({ ok: true, conflitos: [], bloqueado: false });
    }
  });

  it('"garante geração mínima" num item bloqueia a geração do contrato (conflito não resolvido)', () => {
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      const r = conflitosCom(t, cl('extra', 'Do desempenho garantido', [it_('extra.1', 'A CONTRATADA garante geração mínima de 700 kWh por mês durante a vigência.')]));
      expect(r.bloqueado, t).toBe(true);
      expect(r.conflitos).toEqual([expect.objectContaining({ resolvido: false, origem: 'servidor', descricao: expect.stringMatching(/promete ou garante geração/) })]);
    }
  });

  it('a operação da IA que garante geração é descartada com aviso; a que repete a estimativa passa', async () => {
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'desempenho.variacao', texto: 'A CONTRATADA garante geração mínima de 600 kWh por mês.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'desempenho.variacao', texto: 'O monitoramento da geração pode ser acompanhado pelo aplicativo do fabricante do inversor.' }),
    ] }));
    const r = await ok('solar_m2');
    expect(r.avisos.join(' ')).toMatch(/prometia ou garantia geração/);
    const ops = r.acoes.filter(a => a.tipo === 'operacao');
    expect(ops).toHaveLength(1);
    expect(JSON.stringify(ops[0])).toContain('aplicativo do fabricante');
  });

  it('o campo de texto do pagamento também não pode prometer geração', async () => {
    fila(ia({ acoes: [campo('fs-c-pagto', 'Entrada de 30% e saldo em 12x, com geração garantida de 700 kWh por mês.'), campo('fs-c-pagto', 'Entrada de 30% e saldo em 12x no cartão.')] }));
    const r = await ok('solar_m2');
    expect(r.avisos.join(' ')).toMatch(/prometia ou garantia geração/);
    expect(r.acoes).toEqual([expect.objectContaining({ id: 'fs-c-pagto', valor: 'Entrada de 30% e saldo em 12x no cartão.', confirmar: true })]);
  });
});

// ── Conflitos do solar ───────────────────────────────────────────────────────
describe('conflitos próprios do solar', () => {
  const descricoes = (r: { conflitos: Array<{ descricao: string }> }) => r.conflitos.map(c => c.descricao).join(' | ');

  it('foro duplicado', () => {
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      const r = conflitosCom(t, cl('foro2', 'Do foro de eleição', [it_('foro2.1', 'Fica eleito o foro da comarca de Goiânia para qualquer litígio.')]));
      expect(r.bloqueado, t).toBe(true);
      expect(descricoes(r), t).toMatch(/2 foros eleitos/);
    }
  });

  it('garantia do mesmo equipamento com dois prazos (item novo contra o de fábrica, e contra o texto)', () => {
    // Completo: os módulos têm 25 anos; um item novo diz 30.
    let r = conflitosCom('solar_m1', cl('extra', 'Da garantia estendida', [it_('extra.1', 'A garantia dos módulos fotovoltaicos é de 30 (trinta) anos.')]));
    expect(r.bloqueado).toBe(true);
    expect(descricoes(r)).toMatch(/garantia dos módulos aparece com prazos diferentes \(25 anos e 30 anos\)/);
    // Padrão: a bateria tem 5 anos no parágrafo dos equipamentos; um item novo diz 8 anos.
    r = conflitosCom('solar_m2', cl('extra', 'Da bateria', [it_('extra.1', 'A bateria tem garantia de 8 (oito) anos.')]));
    expect(descricoes(r)).toMatch(/da bateria aparece com prazos diferentes/);
    // Instalação: 1 ano de fábrica; um item novo diz 18 meses.
    r = conflitosCom('solar_m2', cl('extra', 'Da instalação', [it_('extra.1', 'A garantia da instalação é de 18 (dezoito) meses.')]));
    expect(descricoes(r)).toMatch(/da instalação aparece com prazos diferentes \(1 ano e 18 meses\)/);
  });

  it('o mesmo prazo repetido, ou outro equipamento, não é conflito', () => {
    let r = conflitosCom('solar_m1', cl('extra', 'Da garantia', [it_('extra.1', 'A garantia dos módulos fotovoltaicos é de 25 (vinte e cinco) anos.')]));
    expect(r.conflitos).toEqual([]);
    r = conflitosCom('solar_m1', cl('extra', 'Da garantia', [it_('extra.1', 'A garantia da bateria é de 5 (cinco) anos.')]));
    expect(r.conflitos).toEqual([]);
  });

  it('item de garantia travado (só a chave) contra um prazo escrito em texto: conflito; o item com texto contra o próprio campo não', () => {
    const travada = [cl('garantias', 'Garantias', [it_('garantias.modulos', '[travado: fs-c-gmod]', { travado: true, campo: 'fs-c-gmod' })])];
    const extra = cl('extra', 'Extra', [it_('extra.1', 'Os módulos têm garantia de 30 anos.')]);
    const r = checarConflitos({ tipo: 'solar_m1', hibrido: null, clausulas: [...travada, extra] });
    expect(r).toMatchObject({ ok: true, bloqueado: true });
    const so = checarConflitos({ tipo: 'solar_m1', hibrido: null, clausulas: travada });
    expect(so).toMatchObject({ ok: true, bloqueado: false });
  });

  it('prazo de obra duplicado com valores diferentes', () => {
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      const r = conflitosCom(t, cl('extra', 'Do prazo da obra', [it_('extra.1', 'A obra será concluída em até 45 (quarenta e cinco) dias.')]));
      expect(r.bloqueado, t).toBe(true);
      expect(descricoes(r), t).toMatch(/prazo de instalação \(obra\)/);
    }
    // Prazo de projeto ou de aprovação não é prazo de obra.
    const ok_ = conflitosCom('solar_m2', cl('extra', 'Da aprovação', [it_('extra.1', 'A aprovação do projeto na concessionária ocorre em até 60 dias.')]));
    expect(ok_.conflitos).toEqual([]);
  });

  it('as duas multas do solar não são conflito, mas duas multas no eletroposto continuam sendo', () => {
    const duas = [
      cl('multa', 'Da multa', [it_('multa.1', 'Multa de 10% por descumprimento.')]),
      cl('penalidade', 'Da multa por atraso', [it_('penalidade.1', 'Multa de 2% por atraso.')]),
    ];
    expect(checarConflitos({ tipo: 'completo', hibrido: null, clausulas: duas })).toMatchObject({ ok: true, bloqueado: true });
    expect(checarConflitos({ tipo: 'solar_m2', hibrido: null, clausulas: duas })).toMatchObject({ ok: true, bloqueado: false });
  });

  it('o agente devolve o conflito do solar já sobre o resultado das operações válidas', async () => {
    fila(ia({ acoes: [operacao({ tipo: 'inserir_item', depois_de: 'garantias.exclusoes', texto: 'A garantia dos módulos é de 30 (trinta) anos.' })] }));
    const r = await ok('solar_m2');
    expect(r.bloqueado).toBe(true);
    expect(r.conflitos.map(c => c.descricao).join(' ')).toMatch(/garantia dos módulos aparece com prazos diferentes/);
  });
});

// ── Revisão: geração, travados pela chave, prazo de obra, NEXUS e junção ─────
describe('geração garantida: o que bloqueia e o que passa', () => {
  it('bloqueia a promessa mesmo com "não", "sem" ou "fabricante" em outro assunto da frase', () => {
    for (const t of [
      'A CONTRATADA garante geração mínima de 700 kWh/mês, não se responsabilizando por sombreamento.',
      'A CONTRATADA garante geração de 700 kWh sem interrupção.',
      'A CONTRATADA garante geração de 700 kWh com módulos do fabricante Jinko.',
      'O sistema vai gerar no mínimo 700 kWh por mês.',
      'A CONTRATADA se responsabiliza pela geração mínima informada.',
      'A CONTRATADA garante a economia de 90% na conta de luz.',
      'A estimativa não é garantia, mas a CONTRATADA garante geração mínima de 600 kWh/mês.',
    ]) expect(geracaoComoGarantia(t), t).toBe(true);
  });

  it('passa: negação da própria garantia, desempenho do módulo pelo fabricante e frases que não falam de geração', () => {
    for (const t of [
      'Estimativa, não garantia.', 'Sem garantia de geração mínima.', 'A CONTRATADA não se responsabiliza pela geração de energia.',
      'Os módulos têm garantia de desempenho linear de 25 anos, dada pelo fabricante, com degradação máxima informada em manual.',
      'Bateria de 5 kWh com garantia de 10 anos.', 'A CONTRATADA garante o bom desempenho da instalação.', 'A CONTRATADA garante a instalação por 1 ano.',
      'Inversor de 5 kWh com garantia de 10 (dez) anos do fabricante.',
      'Garantia de 1 ano sobre a execução, cobrindo problemas estruturais gerados durante a obra.',
    ]) expect(geracaoComoGarantia(t), t).toBe(false);
  });

  it('o aviso vira bloqueio no checador só para a promessa, não para o falso positivo', () => {
    const bloqueia = conflitosCom('solar_m1', cl('extra', 'Extra', [it_('extra.1', 'A CONTRATADA garante geração de 700 kWh sem interrupção.')]));
    expect(bloqueia.bloqueado).toBe(true);
    const passa = conflitosCom('solar_m1', cl('extra', 'Extra', [it_('extra.1', 'A bateria de 5 kWh tem garantia do fabricante por 10 anos, e a CONTRATADA garante o bom desempenho da instalação.')]));
    expect(passa.conflitos).toEqual([]);
  });
});

describe('itens travados pela chave', () => {
  it('operação em item de ITENS_TRAVADOS_SOLAR cai mesmo sem `travado:true` do front; inserir depois dele continua valendo', async () => {
    const semTravado = m2().map(c => ({ ...c, itens: c.itens.map(i => ({ ...i, travado: false, html: 'Texto qualquer do item.' })) }));
    fila(ia({ acoes: [
      operacao({ alvo: 'preco.valor', texto: 'Novo texto.' }), operacao({ tipo: 'remover_item', alvo: 'preco.forma' }),
      operacao({ alvo: 'partes.contratada', texto: 'Novo texto.' }), operacao({ alvo: 'objeto.sistema', texto: 'Novo texto.' }),
      operacao({ alvo: 'assinaturas.fecho', texto: 'Novo texto.' }),
      operacao({ tipo: 'remover_clausula', alvo: 'preco' }), operacao({ tipo: 'renomear_clausula', alvo: 'partes', titulo: 'Das pessoas' }),
      operacao({ tipo: 'inserir_item', depois_de: 'preco.forma', texto: 'O início dos serviços depende da confirmação do pagamento da primeira parcela.' }),
    ] }));
    const r = await ok('solar_m2', { clausulas: semTravado });
    expect(r.avisos.filter(a => /campo próprio na tela/.test(a))).toHaveLength(1);        // o mesmo aviso não se repete
    const ops = r.acoes.filter(a => a.tipo === 'operacao');
    expect(ops).toHaveLength(1);
    expect(JSON.stringify(ops[0])).toContain('inserir_item');
  });
});

describe('prazo de obra: só conclusão, execução ou entrega', () => {
  it('monitoramento e treinamento com prazo não contam como prazo de obra', () => {
    for (const texto of [
      'O acesso ao monitoramento será liberado em até 2 dias após a instalação.', 'O treinamento do uso do sistema ocorre em 1 dia.',
      'Após a instalação, o suporte responde em até 3 dias.',
    ]) {
      const r = conflitosCom('solar_m2', cl('extra', 'Do acompanhamento', [it_('extra.1', texto)]));
      expect(r.conflitos, texto).toEqual([]);
    }
  });
  it('conclusão, entrega e execução da obra com outro prazo continuam conflitando', () => {
    for (const texto of ['A instalação será concluída em até 20 dias úteis.', 'A obra será entregue em até 60 dias.', 'A execução da obra leva até 30 dias.']) {
      const r = conflitosCom('solar_m2', cl('extra', 'Do prazo', [it_('extra.1', texto)]));
      expect(r.bloqueado, texto).toBe(true);
    }
  });
});

describe('NEXUS no contrato solar', () => {
  it('operação ou campo de texto que escreve NEXUS num contrato solar cai com aviso; no eletroposto não muda nada', async () => {
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'desempenho.variacao', texto: 'A NEXUS Eletropostos acompanhará o monitoramento.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'desempenho.variacao', texto: 'O monitoramento é acompanhado pelo aplicativo do fabricante.' }),
      campo('fs-c-pagto', 'Entrada de 30% e saldo no Pix para a conta da Nexus.'),
    ] }));
    const r = await ok('solar_m2');
    expect(r.avisos.filter(a => /não pode citar a NEXUS/.test(a))).toHaveLength(1);
    expect(r.acoes.filter(a => a.tipo === 'campo')).toEqual([]);
    expect(r.acoes.filter(a => a.tipo === 'operacao')).toHaveLength(1);
    fila(ia({ acoes: [operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'A NEXUS acompanha a obra.' })] }));
    const e = await pedirAgente(PedidoAgente.parse({ ...corpo('solar_m2'), tipo: 'completo', clausulas: [cl('gerais', 'Das disposições gerais', [it_('gerais.1', 'Alterações só por escrito.')])], emitente: 'nexus' }));
    expect(e).toMatchObject({ ok: true, acoes: [{ tipo: 'operacao' }] });
  });
});

describe('junção de conflitos: ordem das categorias', () => {
  const t: [any, any] = ['solar_m2', '__vazio__'];
  const servidor = (categoria: string, descricao: string) => ({ descricao, resolvido: false, como: null, origem: 'servidor' as const, categoria: categoria as any, parte: 'solar_m2' as any });
  it('descrição da IA com "garantia de geração" junta com o conflito de geração, e "prazo" solto não vira prazo de obra', () => {
    const ia1 = [{ descricao: 'Há garantia de geração prometida no texto.', resolvido: false, como: null, origem: 'ia' as const }];
    const j = juntarConflitos(ia1, [servidor('geracao', 'promete geração')], t);
    expect(j).toHaveLength(1);
    expect(j[0].origem).toBe('ia+servidor');
    const ia2 = [{ descricao: 'O prazo de pagamento diverge entre as cláusulas.', resolvido: false, como: null, origem: 'ia' as const }];
    expect(juntarConflitos(ia2, [servidor('prazo_obra', 'obra duplicada')], t)).toHaveLength(2);
  });
  it('no eletroposto a junção continua igual (foro, multa) e uma descrição de garantia não gruda em multa', () => {
    const tt: [any, any] = ['completo', 'arrend'];
    const s = (categoria: string) => ({ descricao: 'x', resolvido: false, como: null, origem: 'servidor' as const, categoria: categoria as any, parte: null });
    const iaForo = [{ descricao: 'Há dois foros diferentes.', resolvido: false, como: null, origem: 'ia' as const }];
    expect(juntarConflitos(iaForo, [s('foro')], tt)[0].origem).toBe('ia+servidor');
    const iaGar = [{ descricao: 'Prazos de garantia divergem.', resolvido: false, como: null, origem: 'ia' as const }];
    expect(juntarConflitos(iaGar, [s('multa')], tt)).toHaveLength(2);
  });
});

// ── Rota ─────────────────────────────────────────────────────────────────────
describe('rota de conflitos com o solar', () => {
  const r = Router();
  mountContratoAgente(r);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/gerador', r);
  const post = (corpoReq: unknown) => request(app).post('/gerador/contrato/conflitos').set('Authorization', 'Bearer tk-nilce').send(corpoReq as object);

  it('POST /contrato/conflitos aceita solar_m1 e solar_m2, e recusa o híbrido com solar', async () => {
    for (const t of ['solar_m1', 'solar_m2'] as const) {
      const res = await post({ tipo: t, clausulas: FIXTURE[t]() });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, conflitos: [], bloqueado: false });
    }
    const hibrido = await post({ hibrido: { tipos: ['solar_m1', 'arrend'] }, clausulas: m1() });
    expect(hibrido.status).toBe(400);
    expect(hibrido.body.error).toMatch(/solares não entram/);
    expect(h.chamadas).toHaveLength(0);
  });
});
