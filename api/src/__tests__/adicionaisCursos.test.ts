import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O adicional mensal PAGO abre o curso. A posse do adicional vive só em `entitlements` (com data, vence), mas o conteúdo do Fecha Vendas é
// liberado por kit_pedidos/assinatura/vitalício e o do LimpaPro por limpapro_*: os dois portões também aceitam a posse VÁLIDA. Nada é copiado
// para kit_pedidos nem limpapro_* (essas fontes são para sempre e não vencem).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', async () => {
  const { supabaseFalso } = await import('./helpers/dbFalso');
  return { supabase: supabaseFalso };
});
vi.mock('../utils/mailer', () => ({
  sendKitAcessoEmail: vi.fn(async () => {}),
  sendMesPixAcessoEmail: vi.fn(async () => {}),
  sendFerramentaAcessoEmail: vi.fn(async () => {}),
  sendOpsAlert: vi.fn(async () => {}),
}));
vi.mock('../services/agentes5040/planilhaBonus', () => ({ tentarBonusPosPagamento: vi.fn(async () => true) }));

import { db, limpar, semear } from './helpers/dbFalso';
import { meuAcesso, marcarProgresso } from '../controllers/kitController';
import { ProgressoCheio, contextoDoCurso, gravarChave, podeAbrir, progressoDasAulas, type AulaLinha } from '../services/limpapro/curso';
import { acessos } from '../services/produtos/acessos';

const DIA = 86_400_000;
const EMAIL = 'aluno@empresa.com.br';
const iso = (ms: number) => new Date(ms).toISOString();

function usuario(over: Record<string, any> = {}) {
  return semear('users', {
    email: EMAIL, password_hash: 'hash', plano: 'free', is_admin: false, plano_expira_em: null, billing_status: 'active',
    whatsapp: null, curso_vitalicio: false, pack_trial_until: null, nome: 'Aluno', ...over,
  });
}
const posse = (userId: string, produto: string, expira: string | null, desde = iso(Date.now() - 2 * DIA)) =>
  semear('entitlements', { user_id: userId, produto, origem: 'compra', expira_em: expira, desde, obs: `adicional:cartao:${produto}` });

async function curso(userId: string) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; }, end() { return res; }, sendStatus(c: number) { out.status = c; return res; } };
  await meuAcesso({ userId } as any, res);
  return out;
}

beforeEach(() => {
  limpar('users', 'kit_pedidos', 'entitlements', 'kit_progresso', 'limpapro_entitlements', 'limpapro_membros', 'limpapro_aulas', 'system_state');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Fecha Vendas: adicional mensal abre o curso', () => {
  it('posse válida (data no futuro) abre o curso e o menu, e NÃO grava kit_pedidos', async () => {
    const u = usuario();
    posse(u.id, 'curso-fechamento', iso(Date.now() + 20 * DIA));
    const r = await curso(u.id);
    expect(r.body.liberado).toBe(true);
    expect(r.body.motivoAcesso).toBe('compra');
    expect((await acessos(u.id)).produtos.has('curso-fechamento')).toBe(true);
    expect(db.kit_pedidos).toHaveLength(0);
  });

  it('posse vencida não abre, nem no curso nem no menu', async () => {
    const u = usuario();
    posse(u.id, 'curso-fechamento', iso(Date.now() - DIA));
    const r = await curso(u.id);
    expect(r.body.liberado).toBe(false);
    expect((await acessos(u.id)).produtos.has('curso-fechamento')).toBe(false);
  });

  it('o vitalício continua abrindo, com ou sem posse vencida', async () => {
    const u = usuario({ curso_vitalicio: true });
    posse(u.id, 'curso-fechamento', iso(Date.now() - DIA));
    const r = await curso(u.id);
    expect(r.body.liberado).toBe(true);
    expect(r.body.motivoAcesso).toBe('vitalicio');
  });

  it('posse de OUTRA ferramenta não abre o curso', async () => {
    const u = usuario();
    posse(u.id, 'offgrid', iso(Date.now() + 20 * DIA));
    expect((await curso(u.id)).body.liberado).toBe(false);
  });

  it('posse de OUTRA conta não abre o curso desta', async () => {
    const u = usuario();
    const outro = semear('users', { email: 'outro@x.com', plano: 'free', is_admin: false, billing_status: 'active', plano_expira_em: null });
    posse(outro.id as string, 'curso-fechamento', iso(Date.now() + 20 * DIA));
    expect((await curso(u.id)).body.liberado).toBe(false);
  });

  it('o progresso do curso grava com o adicional válido e é recusado (403) com ele vencido', async () => {
    const u = usuario();
    const p = posse(u.id, 'curso-fechamento', iso(Date.now() + 20 * DIA));
    const chama = async () => {
      const out = { status: 0 };
      const res: any = { status(c: number) { out.status = c; return res; }, json() { return res; }, end() { return res; }, send() { return res; } };
      await marcarProgresso({ userId: u.id, body: { modulo: 'objecoes:preco' } } as any, res);
      return out.status;
    };
    expect(await chama()).toBe(204);
    p.expira_em = iso(Date.now() - 1000);
    expect(await chama()).toBe(403);
  });
});

describe('LimpaPro: adicional mensal abre o curso', () => {
  const aula = (over: Partial<AulaLinha> = {}): AulaLinha => ({
    slug: 'm01', grupo: 'modulo', modulo: 1, ordem: 1, titulo: 'T', resumo: '', minutos: 5, bonus: false, requer: 'curso-principal', libera_apos_dias: 0, ...over,
  } as AulaLinha);

  it('posse válida: acesso true, sem premium, e NENHUMA linha em limpapro_membros nem limpapro_entitlements', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() + 20 * DIA));
    const ctx = await contextoDoCurso(u.id);
    expect(ctx?.acesso).toBe(true);
    expect(ctx?.premium).toBe(false);
    expect(ctx?.somentePorAdicional).toBe(true);
    expect(podeAbrir(aula(), ctx!)).toEqual({ ok: true });
    expect(db.limpapro_membros).toHaveLength(0);
    expect(db.limpapro_entitlements).toHaveLength(0);
  });

  it('a aula de liberação atrasada conta os dias da posse (não fica trancada para sempre) e não abre cedo', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() + 20 * DIA), iso(Date.now() - 2 * DIA));
    const ctx = (await contextoDoCurso(u.id))!;
    expect(podeAbrir(aula({ libera_apos_dias: 7 }), ctx).ok).toBe(false);
    expect(podeAbrir(aula({ libera_apos_dias: 1 }), ctx)).toEqual({ ok: true });
  });

  it('o progresso do adicional é salvo em system_state e lido de lá na próxima abertura, sem linha em limpapro_membros', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() + 20 * DIA));
    const ctx = (await contextoDoCurso(u.id))!;
    expect(await gravarChave(ctx, 'm01#0', true)).toEqual({ salvo: true, progresso: { 'm01#0': true } });
    expect(await gravarChave(ctx, 'chk:plano-7-dias:2', true)).toMatchObject({ salvo: true });
    expect(db.system_state.find((x) => x.key === `limpapro_prog:${u.id}`)?.value.progresso).toEqual({ 'm01#0': true, 'chk:plano-7-dias:2': true });
    expect(db.limpapro_membros).toHaveLength(0);

    const outraAbertura = (await contextoDoCurso(u.id))!;
    expect(progressoDasAulas(outraAbertura.membro)).toEqual({ 'm01#0': true });
    expect(await gravarChave(outraAbertura, 'm01#0', false)).toMatchObject({ salvo: true });
    expect(progressoDasAulas((await contextoDoCurso(u.id))!.membro)).toEqual({});
  });

  it('o progresso é por usuário: o de uma conta não aparece na outra', async () => {
    const a = usuario();
    const b = semear('users', { email: 'b@x.com', plano: 'free', is_admin: false, billing_status: 'active', plano_expira_em: null, nome: 'B' });
    posse(a.id, 'curso-limpapro', iso(Date.now() + 20 * DIA));
    posse(b.id as string, 'curso-limpapro', iso(Date.now() + 20 * DIA));
    await gravarChave((await contextoDoCurso(a.id))!, 'm01#0', true);
    expect(progressoDasAulas((await contextoDoCurso(b.id as string))!.membro)).toEqual({});
  });

  it('o teto de 200 chaves vale ao marcar e desmarcar nunca falha', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() + 20 * DIA));
    const cheio: Record<string, boolean> = {};
    for (let i = 0; i < 200; i++) cheio[`chk:x:${i}`] = true;
    semear('system_state', { key: `limpapro_prog:${u.id}`, value: { progresso: cheio } });
    const ctx = (await contextoDoCurso(u.id))!;
    await expect(gravarChave(ctx, 'm09#0', true)).rejects.toBeInstanceOf(ProgressoCheio);
    expect(await gravarChave(ctx, 'chk:x:0', false)).toMatchObject({ salvo: true });
  });

  it('com a posse vencida o progresso guardado não abre nada (o acesso manda)', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() - DIA));
    semear('system_state', { key: `limpapro_prog:${u.id}`, value: { progresso: { 'm01#0': true } } });
    const ctx = (await contextoDoCurso(u.id))!;
    expect(ctx.acesso).toBe(false);
    expect(progressoDasAulas(ctx.membro)).toEqual({});
  });

  it('membro antigo não muda: grava na linha dele em limpapro_membros e não escreve em system_state', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'curso-principal', ativo: true });
    semear('limpapro_membros', { email: EMAIL, nome: 'Aluno', telefone: null, ativo: true, progresso: { 'm01#0': true }, criado_em: iso(Date.now() - 30 * DIA) });
    posse(u.id, 'curso-limpapro', iso(Date.now() + 20 * DIA));   // até com posse mensal junto: a fonte antiga manda
    const ctx = (await contextoDoCurso(u.id))!;
    expect(ctx.somentePorAdicional).toBeUndefined();
    expect(progressoDasAulas(ctx.membro)).toEqual({ 'm01#0': true });
    expect(await gravarChave(ctx, 'm02#0', true)).toMatchObject({ salvo: true });
    expect(db.limpapro_membros[0].progresso).toEqual({ 'm01#0': true, 'm02#0': true });
    expect(db.system_state).toHaveLength(0);
  });

  it('posse vencida não abre', async () => {
    const u = usuario();
    posse(u.id, 'curso-limpapro', iso(Date.now() - DIA));
    const ctx = await contextoDoCurso(u.id);
    expect(ctx?.acesso).toBe(false);
    expect(ctx?.somentePorAdicional).toBeUndefined();
    expect(podeAbrir(aula(), ctx!)).toEqual({ ok: false, motivo: 'sem_acesso' });
  });

  it('a compra de sempre (limpapro_entitlements) segue abrindo, com premium, sem passar pelo adicional', async () => {
    const u = usuario();
    semear('limpapro_entitlements', { email: EMAIL, item: 'premium', ativo: true });
    semear('limpapro_membros', { email: EMAIL, nome: 'Aluno', telefone: null, ativo: true, progresso: {}, criado_em: iso(Date.now() - 30 * DIA) });
    const ctx = await contextoDoCurso(u.id);
    expect(ctx?.acesso).toBe(true);
    expect(ctx?.premium).toBe(true);
    expect(ctx?.somentePorAdicional).toBeUndefined();
  });
});
