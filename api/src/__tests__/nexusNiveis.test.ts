import { describe, it, expect } from 'vitest';
import { calcularNivel, EntradaNivel, ehPro, TEXTO_BLOQUEIO } from '../services/nexus/niveis';
import { calcularSaldoEngenharia } from '../services/nexus/repositorio';
import { PACOTES_ENGENHARIA, SERVICOS, TERMO_VERSAO } from '../services/nexus/catalogo';

// Os níveis do Portal do Parceiro NEXUS (v3) são calculados na API. Estes testes travam cadastrado, partner, pro e
// master, o que cada um libera, o texto de cada bloqueio e o "o que falta" para o próximo. Pro = primeira compra; a
// montagem aprovada é um selo à parte; oportunidades exigem também o Termo aceito.

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
  termo_aceito: false,
  ...extra,
});

const perfil = { cidade: 'Uberlândia', uf: 'MG', raio_km: 200, papel_revenda: true, tem_logo: true };
const agora = '2026-10-21T15:00:00.000Z';

const TODAS_AS_CHAVES = [
  'simulador', 'basico', 'completo', 'materiais', 'engenharia', 'negociar', 'usinas', 'conversa', 'pedido', 'selo',
  'oportunidades', 'pacotes_engenharia', 'consultoria', 'plataforma', 'termo',
].sort();

describe('níveis do parceiro NEXUS', () => {
  it('recém cadastrado (CNPJ ativo): nível cadastrado, só o Simulador liberado', () => {
    const r = calcularNivel(base());
    expect(r.nivel).toBe('cadastrado');
    expect(r.libera).toEqual({
      simulador: true, basico: false, completo: false, materiais: false, engenharia: false, negociar: false, usinas: false,
      conversa: false, pedido: false, selo: false, oportunidades: false,
      pacotes_engenharia: false, consultoria: false, plataforma: false, termo: false,
    });
    expect(r.progresso.proximo).toBe('partner');
    expect(r.progresso.faltam).toEqual(['perfil', 'primeira_proposta', 'conversa', 'aprovacao_partner']);
  });

  it('CNPJ nao_verificado (Receita fora) também é cadastrado; sem CNPJ nada é liberado', () => {
    expect(calcularNivel(base({ cnpj_situacao: 'nao_verificado' })).libera.simulador).toBe(true);
    for (const e of [base({ cnpj: null }), base({ cnpj_situacao: null }), base({ cnpj: '  ' })]) {
      const r = calcularNivel(e);
      expect(r.libera.simulador).toBe(false);
      expect(Object.values(r.libera).every((v) => v === false)).toBe(true);
      expect(r.bloqueios.simulador).toBe(TEXTO_BLOQUEIO.cadastro);
      expect(r.bloqueios.termo).toBe(TEXTO_BLOQUEIO.cadastro);
    }
  });

  it('perfil completo libera Básico, Completo, materiais, engenharia avulsa, negociar preço e usinas, mas não os produtos do Partner', () => {
    const r = calcularNivel(base(perfil));
    expect(r.libera).toMatchObject({
      simulador: true, basico: true, completo: true, materiais: true, engenharia: true, negociar: true, usinas: true,
      conversa: false, pedido: false, selo: false, oportunidades: false, pacotes_engenharia: false, consultoria: false,
      plataforma: false, termo: false,
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
      expect(r.bloqueios.basico).toBe(TEXTO_BLOQUEIO.perfil);
    }
    // só Revenda ou só Montagem também valem
    expect(calcularNivel(base({ ...perfil, papel_montagem: false, papel_revenda: true })).libera.basico).toBe(true);
    expect(calcularNivel(base({ ...perfil, papel_montagem: true, papel_revenda: false })).libera.basico).toBe(true);
  });

  it('a conversa com o comercial só abre depois da primeira proposta', () => {
    expect(calcularNivel(base(perfil)).libera.conversa).toBe(false);
    expect(calcularNivel(base({ ...perfil, primeira_proposta_em: agora })).libera.conversa).toBe(true);
    // primeira proposta sem perfil completo (não deveria acontecer) também não abre
    expect(calcularNivel(base({ primeira_proposta_em: agora })).libera.conversa).toBe(false);
  });

  it('partner (a equipe marcou partner_em): libera pedido, selo, pacotes de engenharia e consultoria; ainda NÃO libera oportunidades, plataforma nem termo', () => {
    const r = calcularNivel(base({ ...perfil, primeira_proposta_em: agora, conversa_feita_em: agora, partner_em: agora }));
    expect(r.nivel).toBe('partner');
    expect(r.libera).toMatchObject({ pedido: true, selo: true, pacotes_engenharia: true, consultoria: true, oportunidades: false, plataforma: false, termo: false });
    expect(r.progresso).toEqual({ proximo: 'pro', faltam: ['primeira_compra'] });
  });

  it('a falta de papel de montagem ou de aprovação da montagem NÃO segura mais o Pro', () => {
    const r = calcularNivel(base({ ...perfil, papel_montagem: false, papel_revenda: true, partner_em: agora }));
    expect(r.progresso).toEqual({ proximo: 'pro', faltam: ['primeira_compra'] });
  });

  it('pro = a primeira compra confirmada, e só isso: sem partner_em, sem papel de montagem, sem montagem aprovada', () => {
    const so1 = base({ ...perfil, papel_montagem: false, carregadores_comprados: 1 });
    const r = calcularNivel(so1);
    expect(r.nivel).toBe('pro');
    expect(ehPro(so1)).toBe(true);
    expect(r.libera).toMatchObject({ plataforma: true, termo: true });
    expect(r.progresso).toEqual({ proximo: 'master', faltam: ['compras'], carregadores_faltam: 4 });
    expect(calcularNivel({ ...so1, carregadores_comprados: 0 }).nivel).toBe('cadastrado');
    expect(ehPro({ ...so1, carregadores_comprados: 0 })).toBe(false);
  });

  it('escada cumulativa: quem já comprou mantém os produtos do Partner mesmo com partner_em desmarcado', () => {
    const r = calcularNivel(base({ ...perfil, partner_em: null, carregadores_comprados: 2 }));
    expect(r.nivel).toBe('pro');
    expect(r.libera).toMatchObject({ pedido: true, selo: true, pacotes_engenharia: true, consultoria: true });
  });

  it('oportunidades: Pro com o Termo aceito. Pro sem Termo vê o bloqueio "Aceite o Termo..."; o selo de montagem não muda isso', () => {
    const pro = base({ ...perfil, partner_em: agora, carregadores_comprados: 1 });
    const semTermo = calcularNivel(pro);
    expect(semTermo.libera.oportunidades).toBe(false);
    expect(semTermo.bloqueios.oportunidades).toBe('Aceite o Termo de Parceria para receber oportunidades');
    expect(semTermo.libera.termo).toBe(true);
    expect(semTermo.bloqueios.termo).toBeUndefined();

    const comTermo = calcularNivel({ ...pro, termo_aceito: true });
    expect(comTermo.libera.oportunidades).toBe(true);
    expect(comTermo.bloqueios.oportunidades).toBeUndefined();
    // montagem aprovada à parte: nem libera nem segura a oportunidade (ela só decide o tipo 'obra' na oferta)
    expect(calcularNivel({ ...pro, termo_aceito: true, montagem_aprovada_em: agora }).libera.oportunidades).toBe(true);
    expect(calcularNivel({ ...pro, montagem_aprovada_em: agora }).libera.oportunidades).toBe(false);
  });

  it('antes da primeira compra, o bloqueio das oportunidades é o da primeira compra', () => {
    const r = calcularNivel(base({ ...perfil, partner_em: agora, termo_aceito: true }));
    expect(r.libera.oportunidades).toBe(false);
    expect(r.bloqueios.oportunidades).toBe('Libera com a primeira compra de carregador');
    expect(r.bloqueios.plataforma).toBe('Libera com a primeira compra de carregador');
    expect(r.bloqueios.termo).toBe('Libera com a primeira compra de carregador');
  });

  it('bloqueios: só as chaves travadas, cada uma com o texto de quando libera', () => {
    const r = calcularNivel(base());
    const travadas = Object.entries(r.libera).filter(([, v]) => !v).map(([k]) => k).sort();
    expect(Object.keys(r.bloqueios).sort()).toEqual(travadas);
    expect(r.bloqueios.simulador).toBeUndefined();
    expect(r.bloqueios.basico).toBe(TEXTO_BLOQUEIO.perfil);
    expect(r.bloqueios.pedido).toBe(TEXTO_BLOQUEIO.partner);
    expect(r.bloqueios.pacotes_engenharia).toBe(TEXTO_BLOQUEIO.partner);
    expect(r.bloqueios.consultoria).toBe(TEXTO_BLOQUEIO.partner);
    expect(r.bloqueios.conversa).toBe(TEXTO_BLOQUEIO.perfil); // sem perfil, o primeiro passo é o perfil
    expect(calcularNivel(base(perfil)).bloqueios.conversa).toBe(TEXTO_BLOQUEIO.proposta);
    // tudo liberado = nenhum bloqueio
    const tudo = calcularNivel(base({ ...perfil, primeira_proposta_em: agora, partner_em: agora, carregadores_comprados: 1, termo_aceito: true }));
    expect(tudo.bloqueios).toEqual({});
    expect(Object.keys(tudo.libera).sort()).toEqual(TODAS_AS_CHAVES);
  });

  it('os textos de bloqueio seguem as regras da casa: maiúscula no começo, sem travessão, sem emoji', () => {
    for (const t of Object.values(TEXTO_BLOQUEIO)) {
      expect(t[0]).toBe(t[0].toUpperCase());
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('master a partir de 5 carregadores comprados; recebe oportunidades se aceitou o Termo', () => {
    const base5 = base({ ...perfil, partner_em: agora, carregadores_comprados: 5, termo_aceito: true });
    const r = calcularNivel(base5);
    expect(r.nivel).toBe('master');
    expect(r.progresso).toEqual({ proximo: null, faltam: [] });
    expect(r.libera.oportunidades).toBe(true);
    expect(calcularNivel({ ...base5, carregadores_comprados: 4 }).nivel).toBe('pro');
    expect(calcularNivel({ ...base5, termo_aceito: false }).libera.oportunidades).toBe(false);
  });

  it('a equipe pode marcar Partner sem a conversa feita: o nível sobe e o pedido libera', () => {
    const r = calcularNivel(base({ partner_em: agora }));
    expect(r.nivel).toBe('partner');
    expect(r.libera.pedido).toBe(true);
    expect(r.libera.basico).toBe(false); // o perfil continua sendo dele
  });
});

describe('catálogo de serviços NEXUS', () => {
  it('tem os pacotes de 3, 5 e 10, a consultoria e a plataforma, todos com preço "Negociado com o comercial" e nenhum número', () => {
    expect(SERVICOS.map((s) => s.id)).toEqual(['eng-3', 'eng-5', 'eng-10', 'consultoria', 'plataforma']);
    expect(PACOTES_ENGENHARIA).toEqual([3, 5, 10]);
    for (const s of SERVICOS) {
      expect(s.preco).toBe('Negociado com o comercial');
      expect(JSON.stringify(s)).not.toMatch(/R\$\s*\d|\d+[.,]\d{3}/);
      expect(JSON.stringify(s)).not.toMatch(/[—–]/);
    }
    expect(SERVICOS.find((s) => s.id === 'eng-5')).toMatchObject({ nome: 'Pacote de engenharia · 5 projetos', libera: 'partner', chave_libera: 'pacotes_engenharia', pacote: 5 });
    expect(SERVICOS.find((s) => s.id === 'consultoria')).toMatchObject({ unidade: 'por atendimento', libera: 'partner' });
    expect(SERVICOS.find((s) => s.id === 'plataforma')).toMatchObject({
      libera: 'pro', sua_parte: 'Negociada com o comercial',
      para_o_parceiro: 'Você revende a plataforma e recebe parte dos 10% todo mês, enquanto o ponto operar.',
    });
    expect(TERMO_VERSAO).toBe('v1');
  });
});

describe('saldo de engenharia (função pura)', () => {
  const ped = (pacote: number, status = 'confirmado', tipo = 'engenharia') => ({ tipo, pacote, status });
  const sol = (usa: unknown, status = 'aberta', tipo = 'engenharia') => ({ tipo, status, dados: { usa_pacote: usa } });

  it('comprados = pacotes confirmados; usados = solicitações com usa_pacote true e não canceladas', () => {
    expect(calcularSaldoEngenharia([ped(3), ped(5)], [sol(true), sol(true, 'concluida')])).toEqual({ comprados: 8, usados: 2, disponiveis: 6 });
  });
  it('pedido não confirmado, de outro tipo ou solicitação sem usa_pacote true não contam', () => {
    expect(calcularSaldoEngenharia([ped(10, 'solicitado'), ped(5, 'cancelado'), ped(3, 'confirmado', 'consultoria')], [sol(true)])).toEqual({ comprados: 0, usados: 1, disponiveis: 0 });
    expect(calcularSaldoEngenharia([ped(3)], [sol(false), sol('true'), sol(undefined), sol(true, 'aberta', 'plataforma')])).toEqual({ comprados: 3, usados: 0, disponiveis: 3 });
  });
  it('cancelada devolve o projeto', () => {
    expect(calcularSaldoEngenharia([ped(3)], [sol(true), sol(true, 'cancelada')])).toEqual({ comprados: 3, usados: 1, disponiveis: 2 });
  });
  it('nunca fica negativo', () => {
    expect(calcularSaldoEngenharia([ped(3)], [sol(true), sol(true), sol(true), sol(true)]).disponiveis).toBe(0);
  });
});
