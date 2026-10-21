import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quem paga deixa de ser lead da Carla (B3b): o gancho dos pagamentos (tentarBonusPosPagamento) fecha a posse da Carla
// que está VIVA. Posse de outra dona, ou da Carla em outro estado, nunca é tocada; erro nunca lança.
const h = vi.hoisted(() => ({ principal: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { novoBanco, type BancoFalso } from './_agentes5040Fake';
import { tentarBonusPosPagamento, fecharPosseDaCarla } from '../services/agentes5040/planilhaBonus';

const CHAVE = '3491100000';
let banco: BancoFalso;

const semear = (dona: string, estado: string) => {
  banco.tabelas.whatsapp_sessions = [{
    phone: CHAVE, tipo: 'ag5040',
    lead_data: { dona, estado, desde: '2026-10-20T12:00:00.000Z', ate_wa_id: 9, respostas: 1, imagens: [], links: [] },
  }];
  banco.tabelas.users = [{ id: 'u1', email: 'a@b.com', whatsapp: '34991100000' }];
};
const estadoDaPosse = (): string => banco.tabelas.whatsapp_sessions![0]!.lead_data.estado;

beforeEach(() => { banco = novoBanco(); h.principal = banco; });

describe('pagamento fecha a posse da Carla', () => {
  it('Carla viva: encerrada (telefone do usuário sem 55 casa pela chave)', async () => {
    semear('carla', 'viva');
    await tentarBonusPosPagamento({ userId: 'u1', origem: 'stripe' });
    expect(estadoDaPosse()).toBe('encerrada');
  });

  it('o telefone do próprio pagamento (com 55 e 9º dígito) também fecha, mesmo sem usuário achado', async () => {
    semear('carla', 'viva');
    banco.tabelas.users = [];
    await tentarBonusPosPagamento({ email: 'x@y.com', telefone: '5534991100000', origem: 'kiwify_pix' });
    expect(estadoDaPosse()).toBe('encerrada');
  });

  it.each([['duda', 'viva'], ['helena', 'viva'], ['humano', 'viva'], ['carla', 'passou_humano'], ['carla', 'nao_incomodar']])(
    'posse %s/%s nunca é tocada', async (dona, estado) => {
      semear(dona, estado);
      await tentarBonusPosPagamento({ userId: 'u1', origem: 'stripe' });
      expect(estadoDaPosse()).toBe(estado);
      expect(banco.escritas.filter(e => e.tabela === 'whatsapp_sessions')).toEqual([]);
    });

  it('erro de banco não lança e não muda nada', async () => {
    semear('carla', 'viva');
    banco.falhar.whatsapp_sessions = { code: '57014' };
    await expect(tentarBonusPosPagamento({ userId: 'u1', origem: 'stripe' })).resolves.toBe(false);
    await expect(fecharPosseDaCarla(['34991100000'])).resolves.toBe(false);
    banco.falhar.whatsapp_sessions = undefined;
    expect(estadoDaPosse()).toBe('viva');
  });

  it('sem posse, sem telefone útil: nada acontece', async () => {
    banco.tabelas.users = [{ id: 'u1', whatsapp: null }];
    await expect(fecharPosseDaCarla([null, undefined, '123'])).resolves.toBe(false);
    await expect(tentarBonusPosPagamento({ userId: 'u1', origem: 'stripe' })).resolves.toBe(false);
  });
});
