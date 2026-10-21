import { describe, it, expect } from 'vitest';
import { calcularNivel, EntradaNivel, ehPro } from '../services/nexus/niveis';

// Os níveis do Portal do Parceiro NEXUS (v2) são calculados na API. Estes testes travam cadastrado, partner, pro e
// master, o que cada um libera e o "o que falta" para o próximo.

const base = (extra: Partial<EntradaNivel> = {}): EntradaNivel => ({
  cnpj: '11222333000181',
  cnpj_situacao: 'ativa',
  cidade: null,
  uf: null,
  raio_km: null,
  papel_revenda: false,
  papel_montagem: false,
  primeira_proposta_em: null,
  conversa_feita_em: null,
  partner_em: null,
  montagem_aprovada_em: null,
  carregadores_comprados: 0,
  tem_logo: false,
  ...extra,
});

const perfil = { cidade: 'Uberlândia', uf: 'MG', raio_km: 200, papel_montagem: true, tem_logo: true };
const agora = '2026-10-21T15:00:00.000Z';

describe('níveis do parceiro NEXUS', () => {
  it('recém cadastrado (CNPJ ativo): nível cadastrado, só o Simulador liberado', () => {
    const r = calcularNivel(base());
    expect(r.nivel).toBe('cadastrado');
    expect(r.libera).toEqual({
      simulador: true, basico: false, completo: false, materiais: false, engenharia: false, negociar: false, usinas: false,
      conversa: false, pedido: false, selo: false, oportunidades: false,
    });
    expect(r.progresso.proximo).toBe('partner');
    expect(r.progresso.faltam).toEqual(['perfil', 'primeira_proposta', 'conversa', 'aprovacao_partner']);
  });

  it('CNPJ nao_verificado (Receita fora) também é cadastrado; sem CNPJ nada é liberado', () => {
    expect(calcularNivel(base({ cnpj_situacao: 'nao_verificado' })).libera.simulador).toBe(true);
    for (const e of [base({ cnpj: null }), base({ cnpj_situacao: null }), base({ cnpj: '  ' })]) {
      expect(calcularNivel(e).libera.simulador).toBe(false);
    }
  });

  it('perfil completo libera Básico, Completo, materiais, engenharia, negociar preço e usinas', () => {
    const r = calcularNivel(base(perfil));
    expect(r.libera).toMatchObject({
      simulador: true, basico: true, completo: true, materiais: true, engenharia: true, negociar: true, usinas: true,
      conversa: false, pedido: false, selo: false, oportunidades: false,
    });
    expect(r.progresso.faltam).toEqual(['primeira_proposta', 'conversa', 'aprovacao_partner']);
  });

  it('perfil: exige logo, cidade, UF, raio e ao menos um papel', () => {
    for (const falta of [
      { tem_logo: false }, { cidade: null }, { cidade: '  ' }, { uf: null }, { raio_km: null }, { raio_km: 0 },
      { papel_revenda: false, papel_montagem: false },
    ]) {
      const r = calcularNivel(base({ ...perfil, ...falta }));
      expect(r.libera.basico).toBe(false);
      expect(r.progresso.faltam[0]).toBe('perfil');
    }
    // só Revenda também vale
    expect(calcularNivel(base({ ...perfil, papel_montagem: false, papel_revenda: true })).libera.basico).toBe(true);
  });

  it('a conversa com o comercial só abre depois da primeira proposta', () => {
    expect(calcularNivel(base(perfil)).libera.conversa).toBe(false);
    expect(calcularNivel(base({ ...perfil, primeira_proposta_em: agora })).libera.conversa).toBe(true);
    // primeira proposta sem perfil completo (não deveria acontecer) também não abre
    expect(calcularNivel(base({ primeira_proposta_em: agora })).libera.conversa).toBe(false);
  });

  it('partner (a equipe marcou partner_em): libera pedido e selo; ainda NÃO libera oportunidades', () => {
    const r = calcularNivel(base({ ...perfil, primeira_proposta_em: agora, conversa_feita_em: agora, partner_em: agora }));
    expect(r.nivel).toBe('partner');
    expect(r.libera).toMatchObject({ pedido: true, selo: true, oportunidades: false });
    expect(r.progresso).toEqual({ proximo: 'pro', faltam: ['aprovacao_montagem', 'primeira_compra'] });
  });

  it('partner sem o papel de montagem: falta o papel para chegar a pro', () => {
    const r = calcularNivel(base({ ...perfil, papel_montagem: false, papel_revenda: true, partner_em: agora }));
    expect(r.progresso.faltam).toContain('papel_montagem');
  });

  it('pro exige 1 compra confirmada E montagem aprovada E o papel de montagem', () => {
    const pro = base({ ...perfil, partner_em: agora, montagem_aprovada_em: agora, carregadores_comprados: 1 });
    const r = calcularNivel(pro);
    expect(r.nivel).toBe('pro');
    expect(r.libera.oportunidades).toBe(true);
    expect(r.progresso).toEqual({ proximo: 'master', faltam: ['compras'], carregadores_faltam: 4 });

    expect(calcularNivel({ ...pro, carregadores_comprados: 0 }).nivel).toBe('partner');
    expect(calcularNivel({ ...pro, montagem_aprovada_em: null }).nivel).toBe('partner');
    expect(calcularNivel({ ...pro, papel_montagem: false }).nivel).toBe('partner');
    expect(ehPro({ ...pro, papel_montagem: false })).toBe(false);
  });

  it('master a partir de 5 carregadores comprados', () => {
    const base5 = base({ ...perfil, partner_em: agora, montagem_aprovada_em: agora, carregadores_comprados: 5 });
    const r = calcularNivel(base5);
    expect(r.nivel).toBe('master');
    expect(r.progresso).toEqual({ proximo: null, faltam: [] });
    expect(r.libera.oportunidades).toBe(true);
    expect(calcularNivel({ ...base5, carregadores_comprados: 4 }).nivel).toBe('pro');
  });

  it('master sem montagem aprovada é só rótulo: não recebe oportunidades', () => {
    const r = calcularNivel(base({ ...perfil, partner_em: agora, carregadores_comprados: 6 }));
    expect(r.nivel).toBe('master');
    expect(r.libera.oportunidades).toBe(false);
  });

  it('a equipe pode marcar Partner sem a conversa feita: o nível sobe e o pedido libera', () => {
    const r = calcularNivel(base({ partner_em: agora }));
    expect(r.nivel).toBe('partner');
    expect(r.libera.pedido).toBe(true);
    expect(r.libera.basico).toBe(false); // o perfil continua sendo dele
  });
});
