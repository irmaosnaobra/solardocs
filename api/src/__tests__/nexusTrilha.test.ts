import { describe, it, expect, vi } from 'vitest';

// Regras PURAS da Trilha do Parceiro NEXUS: nota e faltas do Raio-X, validação das chaves, ordem dos patamares (não pula),
// liberação com a trilha ligada e desligada, o plano de cada ação da equipe e a Academia (gabarito só no servidor).

vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: () => ({}) } }));

import { calcularNivel, EntradaNivel } from '../services/nexus/niveis';
import { LinhaTrilha, concluidos, nivelDaTrilha, patamarEmCurso, pendenciaDaEquipe, proximoPasso } from '../services/nexus/trilha';
import { calcularNota, idsDeClientes, validarRespostas, type Respostas } from '../services/nexus/trilhaRaioX';
import { validarAcaoEquipe, validarPreferencia, validarReuniao } from '../services/nexus/trilhaEntradas';
import { planejarAcao } from '../services/nexus/trilhaAcoes';
import { AULAS, aulasParaFront, corrigirAula } from '../services/nexus/academia';

const AGORA = '2026-11-17T15:00:00.000Z';
const EMPRESA = { cnpj: '11222333000181', cidade: 'Uberlândia', uf: 'MG', tem_logo: true };
const U = '00000000-0000-4000-8000-000000000001';
const cliente = (n: number) => ({ nome: `Posto ${n}`, cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', fase: 'conversando' });

const tudoMenosClientes = (): Respostas => ({
  anos_solar: '3-5', usinas: '20-100', equipe: '3-5', raio_km: 150, capacidades: ['eletrica_bt'], ja_montou_eletroposto: 'nunca',
  conhece_mercado: 'pouco', papel: 'ambos', quando: 'agora', dificuldades: ['cliente'], demanda_12m: 6,
  simulacao: { tipo_local: 'posto', modelo: 'nexus-dc-80', kwh_mes: 6300, preco_kwh: 2.1, resultado: {} },
});

describe('nota do Raio-X', () => {
  it('sem nenhum cliente em vista o máximo é 80 (e já passa)', () => {
    const r = calcularNota(tudoMenosClientes(), EMPRESA);
    expect(r.nota).toBe(80);
    expect(r.passou).toBe(true);
    expect(r.faltas).toEqual([{ item: 'carteira', pontos: 20, texto: 'Adicionar ao menos um cliente em vista' }]);
  });

  it('com 1 cliente 95; com 2 clientes e tudo, 100, sem faltas', () => {
    expect(calcularNota({ ...tudoMenosClientes(), clientes_em_vista: [cliente(1)] }, EMPRESA).nota).toBe(95);
    const cheio = calcularNota({ ...tudoMenosClientes(), clientes_em_vista: [cliente(1), cliente(2)] }, EMPRESA);
    expect(cheio).toMatchObject({ nota: 100, passou: true, faltas: [] });
  });

  it('empresa incompleta no SolarDoc tira 10 pontos e diz o que falta', () => {
    const r = calcularNota({ ...tudoMenosClientes(), clientes_em_vista: [cliente(1), cliente(2)] }, { ...EMPRESA, tem_logo: false });
    expect(r.nota).toBe(90);
    expect(r.faltas).toEqual([{ item: 'empresa', pontos: 10, texto: 'Completar no cadastro: logo' }]);
  });

  it('abaixo de 80 não passa e lista cada item com os pontos', () => {
    const r = calcularNota({ anos_solar: '0-1' }, EMPRESA);
    expect(r.nota).toBe(10);
    expect(r.passou).toBe(false);
    expect(r.faltas.map((f) => f.item).sort()).toEqual(['capacidades', 'carteira', 'demanda', 'dificuldades', 'experiencia', 'mercado', 'simulacao']);
    expect(r.faltas.reduce((s, f) => s + f.pontos, 0) + r.nota).toBe(100);
  });

  it('simulação sem consumo e demanda zero não pontuam', () => {
    const r = calcularNota({ ...tudoMenosClientes(), demanda_12m: 0, simulacao: { tipo_local: 'posto', modelo: 'x', kwh_mes: 0, preco_kwh: 1 } }, EMPRESA);
    expect(r.faltas.map((f) => f.item)).toEqual(expect.arrayContaining(['demanda', 'simulacao']));
  });
});

describe('validação das chaves do Raio-X', () => {
  it('rejeita chave fora da lista e valor fora do permitido', () => {
    expect(validarRespostas({ user_id: U })).toMatchObject({ ok: false, erro: 'chave_desconhecida', campo: 'user_id' });
    expect(validarRespostas({ anos_solar: '10+' })).toMatchObject({ ok: false, erro: 'valor_invalido', campo: 'anos_solar' });
    expect(validarRespostas({ raio_km: 9 })).toMatchObject({ ok: false, campo: 'raio_km' });
    expect(validarRespostas({ raio_km: 501 })).toMatchObject({ ok: false, campo: 'raio_km' });
    expect(validarRespostas({ demanda_12m: 201 })).toMatchObject({ ok: false, campo: 'demanda_12m' });
    expect(validarRespostas({ dificuldades: ['cliente', 'preco', 'tempo', 'tecnica'] })).toMatchObject({ ok: false, campo: 'dificuldades' });
    expect(validarRespostas({ capacidades: ['voar'] })).toMatchObject({ ok: false, campo: 'capacidades' });
    expect(validarRespostas({ clientes_em_vista: Array.from({ length: 11 }, (_, i) => cliente(i)) })).toMatchObject({ ok: false, campo: 'clientes_em_vista' });
    expect(validarRespostas({ clientes_em_vista: [{ ...cliente(1), tipo_local: 'castelo' }] })).toMatchObject({ ok: false, campo: 'clientes_em_vista' });
    expect(validarRespostas({ clientes_em_vista: [{ ...cliente(1), cliente_id: 'nao-e-uuid' }] })).toMatchObject({ ok: false, campo: 'clientes_em_vista' });
    expect(validarRespostas({ simulacao: { tipo_local: 'posto', modelo: 'x', kwh_mes: 10, extra: 1 } })).toMatchObject({ ok: false, campo: 'simulacao' });
    expect(validarRespostas('x')).toMatchObject({ ok: false });
  });

  it('aceita parcial, normaliza e devolve os cliente_id citados', () => {
    const id = 'AAAAAAAA-0000-4000-8000-000000000001';
    const v = validarRespostas({ raio_km: 150, capacidades: ['eletrica_bt', 'eletrica_bt'], clientes_em_vista: [{ ...cliente(1), uf: 'mg', cliente_id: id }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.valor.capacidades).toEqual(['eletrica_bt']);
    expect(idsDeClientes(v.valor)).toEqual([id.toLowerCase()]);
  });
});

describe('ordem dos patamares', () => {
  const t = (extra: LinhaTrilha = {}): LinhaTrilha => ({ raio_x: {}, ...extra });
  const D = AGORA;

  it('começa no 1 e só anda um de cada vez', () => {
    expect(patamarEmCurso(t(), 0)).toBe(1);
    expect(patamarEmCurso(t({ p1_em: D }), 0)).toBe(2);
    expect(patamarEmCurso(t({ p1_em: D, p2_em: D }), 0)).toBe(3);
    expect(patamarEmCurso(t({ p1_em: D, p2_em: D, p3_em: D }), 0)).toBe(4);
    expect(patamarEmCurso(t({ p1_em: D, p2_em: D, p3_em: D, p4_em: D }), 0)).toBe(5);
    expect(patamarEmCurso(t({ p1_em: D, p2_em: D, p3_em: D, p4_em: D }), 1)).toBe(6);
    expect(patamarEmCurso(t({ p1_em: D, p2_em: D, p3_em: D, p4_em: D, regional_em: D }), 1)).toBe(7);
  });

  it('marca posterior sem a anterior NÃO pula (a linha inconsistente não abre nada)', () => {
    expect(patamarEmCurso(t({ p3_em: D, p4_em: D }), 3)).toBe(1);
    expect(concluidos(t({ p1_em: D, p3_em: D }), 0)).toEqual([true, false, false, false, false, false]);
    expect(nivelDaTrilha(t({ p1_em: D, p3_em: D }), 0)).toEqual({ p1: true, p3: false, p4: false, regional: false });
    expect(patamarEmCurso(t({ regional_em: D }), 5)).toBe(1);
  });

  it('o próximo passo muda com o patamar e do 2 ao 4 pede plano pago', () => {
    const ctx = (tt: LinhaTrilha, patamar: number, assinante = true, termo = false) => proximoPasso({ t: tt, patamar, assinante, termo_aceito: termo });
    expect(ctx(t(), 1).codigo).toBe('raio_x');
    expect(ctx(t({ p1_em: D }), 2, false).codigo).toBe('assinar');
    expect(ctx(t({ p1_em: D }), 2).codigo).toBe('pedir_diagnostico');
    expect(ctx(t({ p1_em: D, p2_em: D }), 3).codigo).toBe('escolher_preparo');
    expect(ctx(t({ p3_em: D }), 4).codigo).toBe('aceitar_termo');
    expect(ctx(t(), 4, true, true).codigo).toBe('pedir_reuniao');
    expect(ctx(t(), 5, false).codigo).toBe('primeiro_pedido');
    expect(ctx(t(), 7).codigo).toBe('concluida');
  });

  it('a pendência da equipe segue o estado', () => {
    expect(pendenciaDaEquipe(t({ diag_pedido_em: D }))).toBe('agendar_diagnostico');
    expect(pendenciaDaEquipe(t({ diag_pedido_em: D, diag_agendado_para: '2026-11-17T18:00:00.000Z' }), new Date(AGORA))).toBe('diagnostico_hoje');
    expect(pendenciaDaEquipe(t({ diag_pedido_em: D, diag_agendado_para: '2026-11-25T18:00:00.000Z' }), new Date(AGORA))).toBeNull();
    expect(pendenciaDaEquipe(t({ preparo_formato: 'mentoria', mentoria_paga_em: D, mentoria_encontros: 2 }))).toBe('registrar_encontro');
    expect(pendenciaDaEquipe(t({ reuniao_pedida_em: D }))).toBe('agendar_reuniao');
    expect(pendenciaDaEquipe(t())).toBeNull();
  });
});

describe('liberação: trilha ligada x desligada', () => {
  const base = (extra: Partial<EntradaNivel> = {}): EntradaNivel => ({
    cnpj: '11222333000181', cnpj_situacao: 'ativa', cidade: 'Uberlândia', uf: 'MG', raio_km: 200, papel_revenda: true, papel_montagem: false,
    primeira_proposta_em: null, conversa_feita_em: null, partner_em: null, montagem_aprovada_em: null, carregadores_comprados: 0, tem_logo: true,
    termo_aceito: false, ...extra,
  });
  const tr = (p: Partial<{ p1: boolean; p3: boolean; p4: boolean; regional: boolean }> = {}) => ({ p1: false, p3: false, p4: false, regional: false, ...p });

  it('trilha desligada (sem o campo ou null): resultado idêntico ao de sempre', () => {
    for (const e of [base(), base({ partner_em: AGORA }), base({ carregadores_comprados: 2, termo_aceito: true })]) {
      expect(calcularNivel({ ...e, trilha: null })).toEqual(calcularNivel(e));
      expect(calcularNivel({ ...e, trilha: undefined })).toEqual(calcularNivel(e));
    }
    expect(calcularNivel(base()).libera.basico).toBe(true); // perfil completo já libera, sem trilha
  });

  it('trilha ligada: o perfil completo SOZINHO não libera mais nada além do simulador, das usinas e (patamar 1) da conversa', () => {
    const { libera, bloqueios } = calcularNivel(base({ trilha: tr() }));
    expect(libera).toMatchObject({ simulador: true, usinas: true, basico: false, completo: false, materiais: false, negociar: false, engenharia: false, selo: false, termo: false, conversa: false, pedido: false });
    expect(bloqueios.basico).toMatch(/Preparado/);
    expect(bloqueios.pedido).toMatch(/Em campo/);
    expect(calcularNivel(base({ trilha: tr({ p1: true }) })).libera.conversa).toBe(true);
  });

  it('patamar 3 libera proposta, materiais, negociar, engenharia, selo e termo; pedido só no 4', () => {
    const p3 = calcularNivel(base({ trilha: tr({ p1: true, p3: true }) })).libera;
    expect(p3).toMatchObject({ basico: true, completo: true, materiais: true, negociar: true, engenharia: true, selo: true, termo: true, pedido: false, pacotes_engenharia: false, consultoria: false });
    const p4 = calcularNivel(base({ trilha: tr({ p1: true, p3: true, p4: true }) })).libera;
    expect(p4).toMatchObject({ pedido: true, pacotes_engenharia: true, consultoria: true, plataforma: false, manutencao: false });
  });

  it('plataforma e manutenção vêm da primeira compra; oportunidades só do regional com o termo aceito', () => {
    const cliente = base({ carregadores_comprados: 1, trilha: tr({ p1: true, p3: true, p4: true }) });
    expect(calcularNivel(cliente).libera).toMatchObject({ plataforma: true, manutencao: true, oportunidades: false });
    expect(calcularNivel({ ...cliente, trilha: tr({ p1: true, p3: true, p4: true, regional: true }) }).libera.oportunidades).toBe(false);
    expect(calcularNivel({ ...cliente, termo_aceito: true, trilha: tr({ p1: true, p3: true, p4: true, regional: true }) }).libera.oportunidades).toBe(true);
  });

  it('sem CNPJ ativo a trilha não libera nem o simulador', () => {
    const { libera } = calcularNivel(base({ cnpj: null, trilha: tr({ p1: true, p3: true, p4: true }) }));
    expect(Object.values(libera).every((v) => v === false)).toBe(true);
  });
});

describe('ações da equipe (plano puro)', () => {
  const ctx = (t: LinhaTrilha, extra: Partial<{ comprados: number; termo_aceito: boolean }> = {}) => ({ t, comprados: 0, termo_aceito: false, agora: AGORA, autor: 'equipe@exemplo.com', ...extra });
  const D = AGORA;

  it('avançar sem motivo é recusado na validação; com motivo fecha o patamar em curso e grava o motivo no evento', () => {
    expect(validarAcaoEquipe({ acao: 'avancar' })).toMatchObject({ ok: false, erro: 'motivo_obrigatorio' });
    expect(validarAcaoEquipe({ acao: 'avancar', motivo: '  ' })).toMatchObject({ ok: false, erro: 'motivo_obrigatorio' });
    expect(validarAcaoEquipe({ acao: 'avancar', motivo: 'ok' })).toMatchObject({ ok: false, erro: 'motivo_obrigatorio' });
    const v = validarAcaoEquipe({ acao: 'avancar', motivo: 'Conhece o negócio, pulou o Raio-X' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const p = planejarAcao(v.valor, ctx({ raio_x: {} }));
    expect(p).toMatchObject({ ok: true, patch: { p1_em: AGORA }, eventos: [{ tipo: 'avancar', autor: 'equipe@exemplo.com', dados: { patamar: 1, motivo: 'Conhece o negócio, pulou o Raio-X' } }] });
  });

  it('avançar não pula: no patamar 2 fecha só o 2; o 5 é automático e o 7 já acabou', () => {
    const a = { acao: 'avancar', motivo: 'Teste de regra' } as const;
    expect(planejarAcao(a, ctx({ p1_em: D }))).toMatchObject({ ok: true, patch: { p2_em: AGORA } });
    expect(planejarAcao(a, ctx({ p1_em: D, p2_em: D, p3_em: D, p4_em: D }))).toEqual({ ok: false, erro: 'patamar_automatico' });
    expect(planejarAcao(a, ctx({ p1_em: D, p2_em: D, p3_em: D, p4_em: D, regional_em: D }, { comprados: 1 }))).toEqual({ ok: false, erro: 'ja_concluido' });
  });

  it('diagnóstico aprovado fecha o 2; "ainda não" não fecha; sem pedido recusa', () => {
    const base = { raio_x: {}, p1_em: D, diag_pedido_em: D };
    expect(planejarAcao({ acao: 'diagnostico_feito', resultado: 'aprovado', plano: 'Plano X' }, ctx(base))).toMatchObject({ ok: true, patch: { p2_em: AGORA, diag_resultado: 'aprovado', diag_plano: 'Plano X' } });
    const nao = planejarAcao({ acao: 'diagnostico_feito', resultado: 'ainda_nao', plano: null }, ctx(base));
    expect(nao.ok && 'p2_em' in nao.patch).toBe(false);
    expect(planejarAcao({ acao: 'diagnostico_feito', resultado: 'aprovado', plano: null }, ctx({ p1_em: D }))).toEqual({ ok: false, erro: 'sem_pedido' });
  });

  it('o 4º encontro da mentoria fecha o patamar 3 (e não passa de 4)', () => {
    const base = { p1_em: D, p2_em: D, preparo_formato: 'mentoria', mentoria_paga_em: D };
    const tres = planejarAcao({ acao: 'mentoria_encontro' }, ctx({ ...base, mentoria_encontros: 2 }));
    expect(tres).toMatchObject({ ok: true, patch: { mentoria_encontros: 3 } });
    expect(tres.ok && 'p3_em' in tres.patch).toBe(false);
    expect(planejarAcao({ acao: 'mentoria_encontro' }, ctx({ ...base, mentoria_encontros: 3 }))).toMatchObject({ ok: true, patch: { mentoria_encontros: 4, p3_em: AGORA } });
    expect(planejarAcao({ acao: 'mentoria_encontro' }, ctx({ ...base, mentoria_encontros: 4, p3_em: D }))).toEqual({ ok: false, erro: 'encontros_completos' });
    expect(planejarAcao({ acao: 'mentoria_encontro' }, ctx({ p1_em: D, p2_em: D, preparo_formato: 'academia' }))).toEqual({ ok: false, erro: 'formato_invalido' });
  });

  it('reunião feita só fecha o 4 com o termo aceito; promover regional só depois do primeiro pedido', () => {
    const base = { p1_em: D, p2_em: D, p3_em: D, reuniao_pedida_em: D };
    expect(planejarAcao({ acao: 'reuniao_feita', obs: null }, ctx(base))).toEqual({ ok: false, erro: 'termo_pendente' });
    expect(planejarAcao({ acao: 'reuniao_feita', obs: 'Foi bem' }, ctx(base, { termo_aceito: true }))).toMatchObject({ ok: true, patch: { reuniao_feita_em: AGORA, p4_em: AGORA } });
    const feito = { ...base, p4_em: D, reuniao_feita_em: D };
    expect(planejarAcao({ acao: 'promover_regional' }, ctx(feito))).toEqual({ ok: false, erro: 'etapa_anterior' });
    expect(planejarAcao({ acao: 'promover_regional' }, ctx(feito, { comprados: 1 }))).toMatchObject({ ok: true, patch: { regional_em: AGORA } });
  });

  it('valida quando, link, resultado, e-mail e ação desconhecida', () => {
    expect(validarAcaoEquipe({ acao: 'agendar_diagnostico', quando: 'amanha' })).toMatchObject({ ok: false, campo: 'quando' });
    expect(validarAcaoEquipe({ acao: 'agendar_diagnostico', quando: '2026-11-20T14:00:00Z', link: 'http://x' })).toMatchObject({ ok: false, campo: 'link' });
    expect(validarAcaoEquipe({ acao: 'agendar_diagnostico', quando: '2026-11-20T14:00:00Z', link: 'https://meet.exemplo.com/abc' }).ok).toBe(true);
    expect(validarAcaoEquipe({ acao: 'diagnostico_feito', resultado: 'talvez' })).toMatchObject({ ok: false, campo: 'resultado' });
    expect(validarAcaoEquipe({ acao: 'responsavel', email: 'sem-arroba' })).toMatchObject({ ok: false, campo: 'email' });
    expect(validarAcaoEquipe({ acao: 'apagar_tudo' })).toMatchObject({ ok: false, campo: 'acao' });
  });

  it('preferência e pedido de reunião: dias futuros, período, UF e formato dos ids', () => {
    const pref = { dias: ['2026-11-18', '2026-11-19'], periodo: 'manha' };
    expect(validarPreferencia(pref, '2026-11-17')).toMatchObject({ ok: true });
    expect(validarPreferencia({ ...pref, dias: ['2026-11-10'] }, '2026-11-17')).toMatchObject({ ok: false, campo: 'dias' });
    expect(validarPreferencia({ ...pref, dias: ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'] }, '2026-11-17')).toMatchObject({ ok: false });
    expect(validarPreferencia({ ...pref, periodo: 'noite' }, '2026-11-17')).toMatchObject({ ok: false, campo: 'periodo' });
    const base = { cliente_nome: 'Posto Exemplo', cidade: 'Araguari', uf: 'MG', tipo_local: 'posto', preferencia: pref };
    expect(validarReuniao(base, '2026-11-17')).toMatchObject({ ok: true });
    expect(validarReuniao({ ...base, uf: 'XX' }, '2026-11-17')).toMatchObject({ ok: false, campo: 'uf' });
    expect(validarReuniao({ ...base, cliente_id: 'lixo' }, '2026-11-17')).toMatchObject({ ok: false, campo: 'cliente_id' });
  });
});

describe('Academia', () => {
  it('são 12 aulas e o gabarito nunca vai para o front', () => {
    expect(AULAS).toHaveLength(12);
    expect(AULAS.map((a) => a.id)).toEqual(Array.from({ length: 12 }, (_, i) => `a${String(i + 1).padStart(2, '0')}`));
    for (const a of aulasParaFront()) expect(Object.keys(a)).not.toContain('certa');
    expect(JSON.stringify(aulasParaFront())).not.toMatch(/"certa"/);
  });

  it('corrige pelo índice e recusa índice ou aula inválidos', () => {
    const a01 = AULAS[0]!;
    expect(corrigirAula('a01', a01.certa)).toBe(true);
    expect(corrigirAula('a01', (a01.certa + 1) % a01.opcoes.length)).toBe(false);
    expect(corrigirAula('a01', 9)).toBeNull();
    expect(corrigirAula('a01', '1')).toBeNull();
    expect(corrigirAula('a99', 0)).toBeNull();
  });
});
