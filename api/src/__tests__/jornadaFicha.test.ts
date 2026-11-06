import { describe, it, expect } from 'vitest';
import {
  montarFicha, formaDaVendaPorTexto, formaDoEspelho, FORMA_VENDA_PARA_LIVRO, proximoRecebimento, trelloDaFicha, type EntradaFicha,
} from '../services/gerador/jornadaFicha';
import { cadastroVazio, type Cadastro } from '../services/gerador/cadastroVenda';
import { obraPrivadaVazia } from '../services/gerador/jornadaObraBanco';
import type { ObraPrivada } from '../services/gerador/jornadaObra';
import type { PrivadoJornada, EstadoJornada } from '../services/gerador/jornadaSolar';

// A ficha consolidada da venda solar (06/11/2026): função pura. A prioridade das fontes, quem vê, o negociador que nunca vira contratante,
// o "nunca sobrescreve", a discordância como nota, a forma de pagamento, o próximo recebimento, a vistoria pelas fotos e o Trello. Dados inventados.

const cadCom = (campos: Record<string, { valor: string; fonte?: string }>): Cadastro => ({
  ...cadastroVazio(),
  campos: Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, { valor: c.valor, por: 'nilce', em: '2026-11-01T10:00:00.000Z', fonte: c.fonte ?? 'manual' }])) as Cadastro['campos'],
});
const base = (o: Partial<EntradaFicha> = {}): EntradaFicha => ({
  quem: { nome: 'nilce', socio: false, adm: false, veDinheiro: true },
  card: { cliente: '', telefone: '', cidade: '', vendedor: 'Nilce' },
  lig: { proposta: null, venda: null },
  estado: null, privado: null, obra: null, cad: cadastroVazio(), fotos: [], proposta: null, propostaVenda: null, planilha: null, entradas: null, docsPlanilha: [],
  ...o,
});
const privadoCom = (venda: Partial<NonNullable<PrivadoJornada['venda']>> | null): PrivadoJornada => ({
  v: 1, cancelamento: null, descancelamentos: [], trazidas: [],
  venda: venda === null ? null : {
    valor_centavos: 3_890_000, pagamento: [{ forma: 'pix', valor_centavos: 3_890_000, obs: '' }], desconto_centavos: null, prazo_prometido: '', nota: '',
    kit_confirmado: true, combinado_por: 'nilce', combinado_em: '2026-11-05T15:00:00.000Z', editado: [], ...venda,
  },
});
const propostaCom = (dados: Record<string, unknown> = {}, o: Partial<NonNullable<EntradaFicha['proposta']>> = {}): NonNullable<EntradaFicha['proposta']> => ({
  dados, qtd_placas: null, inversor: null, qtd_inversor: null, cliente_uf: null, dossie: { campos: {}, trello: { card_id: null } }, ...o,
});
const obraCom = (mut: (p: ObraPrivada) => void): ObraPrivada => { const p = obraPrivadaVazia(); mut(p); return p; };
const vistoriaVazia = (): NonNullable<ObraPrivada['vistoria']> => ({
  data: '', quem: '', acomp: '', concl: '', adeq: [], obs: '',
  telhado: { tipo: '', estado: '', orient: '', incl: '', area: '', sombra: '', estr: '', acesso: '' },
  entrada: { padrao: '', tensao: '', disj: '', apto: '', aterr: '', quadro: '' },
  inversor: { local: '', dist: '', abrig: '', wifi: '' }, fotos: [],
});
const bancoVazio = (): NonNullable<ObraPrivada['banco']> => ({
  banco: '', agencia: '', conta: '', validade: '', prazo: '', origem: '', nota: '', desc: '', ger: '', eq_centavos: null, mo_centavos: null, fin: null,
});
const planilhaCom = (campos: Array<{ chave: string; valor: string }>, valorVendaCentavos: number | null = null): EntradaFicha['planilha'] => ({ campos, valorVendaCentavos });

describe('1. a prioridade do valor vendido', () => {
  it('a obra vence a proposta e a planilha; a proposta aparece como nota', () => {
    const f = montarFicha(base({
      privado: privadoCom({}), propostaVenda: { vendido: true, valor_vendido: 38_000, forma_pagamento: null, obs_venda: null },
      planilha: planilhaCom([], 3_700_000),
    }));
    expect(f.campos['venda.valor_centavos']).toMatchObject({ valor: 3_890_000, fonte: 'obra', rotulo: 'obra', alt: { valor: 3_800_000, fonte: 'proposta', rotulo: 'proposta' } });
  });
  it('sem a obra vence a proposta (em centavos); sem as duas, a planilha', () => {
    const semObra = montarFicha(base({ propostaVenda: { vendido: true, valor_vendido: 38_000, forma_pagamento: null, obs_venda: null }, planilha: planilhaCom([], 3_700_000) }));
    expect(semObra.campos['venda.valor_centavos']).toMatchObject({ valor: 3_800_000, fonte: 'proposta', alt: { valor: 3_700_000, fonte: 'planilha' } });
    const soPlanilha = montarFicha(base({ planilha: planilhaCom([], 3_700_000) }));
    expect(soPlanilha.campos['venda.valor_centavos']).toMatchObject({ valor: 3_700_000, fonte: 'planilha' });
    expect(soPlanilha.campos['venda.valor_centavos'].alt).toBeUndefined();
  });
  it('proposta que não está vendida não conta', () => {
    const f = montarFicha(base({ propostaVenda: { vendido: false, valor_vendido: 38_000, forma_pagamento: null, obs_venda: null } }));
    expect(f.campos['venda.valor_centavos']).toBeUndefined();
  });
  it('valores iguais nas duas fontes não geram nota', () => {
    const f = montarFicha(base({ privado: privadoCom({}), propostaVenda: { vendido: true, valor_vendido: 38_900, forma_pagamento: null, obs_venda: null } }));
    expect(f.campos['venda.valor_centavos'].alt).toBeUndefined();
  });
});

describe('2. cadastro por gente, depois IA, depois proposta', () => {
  it('manual vence; só IA vence a proposta; só a proposta dá monofásico', () => {
    const prop = propostaCom({ fase: 'Monofásica' });
    const manual = montarFicha(base({ cad: cadCom({ uc_fornecimento: { valor: 'trifasico' } }), proposta: prop }));
    expect(manual.campos['sistema.ligacao']).toMatchObject({ valor: 'trifasico', fonte: 'cadastro', alt: { valor: 'monofasico', fonte: 'proposta' } });
    const ia = montarFicha(base({ cad: cadCom({ uc_fornecimento: { valor: 'bifasico', fonte: 'ia' } }), proposta: prop }));
    expect(ia.campos['sistema.ligacao']).toMatchObject({ valor: 'bifasico', fonte: 'ia', rotulo: 'leitura da IA' });
    const soProposta = montarFicha(base({ proposta: prop }));
    expect(soProposta.campos['sistema.ligacao']).toMatchObject({ valor: 'monofasico', fonte: 'proposta' });
  });
});

describe('3. o nome e o telefone do card são do negociador', () => {
  it('nunca viram contratante, titular do financiamento nem da homologação', () => {
    const f = montarFicha(base({
      card: { cliente: 'Marcos', telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor: 'Nilce' },
      cad: cadCom({ financiamento_mesmo: { valor: 'outra_pessoa' }, homologacao_mesmo: { valor: 'outra_pessoa' } }),
    }));
    const chaves = Object.keys(f.campos);
    expect(chaves).not.toContain('contratante.nome');
    expect(chaves).not.toContain('contratante.telefone');
    expect(chaves.filter((k) => k.startsWith('financiamento.'))).toEqual([]);
    expect(chaves).not.toContain('homologacao.nome');
    for (const k of ['nome', 'telefone', 'fin_nome', 'tuc_nome']) expect(f.sugestoes.cadastro[k]).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain('99999-0001');
  });
});

describe('4. quem vê', () => {
  it('planilha nula: nenhum campo da planilha', () => {
    const f = montarFicha(base({ cad: cadCom({ uc_fornecimento: { valor: 'trifasico' } }), planilha: null }));
    expect(JSON.stringify(f)).not.toContain('"fonte":"planilha"');
  });
  it('planilha visível sem dinheiro (não sócio): o valor da venda não existe', () => {
    const f = montarFicha(base({ planilha: planilhaCom([{ chave: 'concessionaria', valor: 'Cemig' }], null) }));
    expect(f.campos['venda.valor_centavos']).toBeUndefined();
    expect(f.campos['uc.concessionaria']).toMatchObject({ valor: 'Cemig', fonte: 'planilha' });
  });
  it('sem permissão para o dinheiro, o recebimento é vazio', () => {
    const e = base({ privado: privadoCom({}), entradas: null, quem: { nome: 'nilce', socio: false, adm: false, veDinheiro: false } });
    expect(montarFicha(e).sugestoes.recebimento).toEqual({});
    const e2 = base({ privado: privadoCom({}), entradas: [], quem: { nome: 'nilce', socio: false, adm: false, veDinheiro: false } });
    expect(montarFicha(e2).sugestoes.recebimento).toEqual({});
    const e3 = base({ privado: privadoCom({}), entradas: [], quem: { nome: 'nilce', socio: false, adm: false, veDinheiro: true } });
    expect(montarFicha(e3).sugestoes.recebimento.valor_centavos).toMatchObject({ valor: 3_890_000, fonte: 'combinado' });
  });
  it('as cinco listas de sugestões sempre existem', () => {
    const s = montarFicha(base()).sugestoes;
    expect(Object.keys(s).sort()).toEqual(['banco', 'cadastro', 'recebimento', 'venda', 'vistoria']);
    for (const v of Object.values(s)) expect(v).toEqual({});
  });
});

describe('5. nunca sobrescreve', () => {
  it('banco, vistoria, cadastro e venda já gravados não recebem sugestão', () => {
    const prop = propostaCom({ fase: 'Monofásica', mediaMensalGerada: 800, prazoInstalacao: 30, telhado: 'Cerâmico' }, { qtd_placas: 10, inversor: 'Growatt 5kW', qtd_inversor: 1 });
    const comTudo = montarFicha(base({ proposta: prop, obra: obraCom((p) => { p.banco = bancoVazio(); p.vistoria = vistoriaVazia(); }) }));
    expect(comTudo.sugestoes.banco.desc).toBeDefined();
    expect(comTudo.sugestoes.banco.ger).toMatchObject({ valor: '800', fonte: 'proposta' });
    expect(comTudo.sugestoes.vistoria['telhado.tipo']).toMatchObject({ valor: 'Cerâmico' });
    expect(comTudo.sugestoes.cadastro.uc_fornecimento).toMatchObject({ valor: 'monofasico' });
    const gravado = montarFicha(base({
      proposta: prop,
      cad: cadCom({ uc_fornecimento: { valor: 'trifasico' } }),
      obra: obraCom((p) => {
        p.banco = { ...bancoVazio(), desc: 'X', fin: { nome: 'Y', doc: '', rg: '', qualif: '', end: '', cep: '', tel: '', email: '' } };
        p.vistoria = { ...vistoriaVazia(), data: '2026-10-01' };
      }),
    }));
    expect(gravado.sugestoes.banco.desc).toBeUndefined();
    expect(gravado.sugestoes.banco['fin.nome']).toBeUndefined();
    expect(gravado.sugestoes.vistoria.data).toBeUndefined();
    expect(gravado.sugestoes.cadastro.uc_fornecimento).toBeUndefined();
    const porIa = montarFicha(base({ proposta: prop, cad: cadCom({ uc_fornecimento: { valor: 'bifasico', fonte: 'ia' } }) }));
    expect(porIa.sugestoes.cadastro.uc_fornecimento).toBeUndefined();
    const comVenda = montarFicha(base({ privado: privadoCom({}), propostaVenda: { vendido: true, valor_vendido: 1, forma_pagamento: 'cartao', obs_venda: 'x' } }));
    expect(comVenda.sugestoes.venda).toEqual({});
  });
  it('sem venda gravada a proposta preenche valor, forma, nota e prazo', () => {
    const f = montarFicha(base({
      propostaVenda: { vendido: true, valor_vendido: 38_000, forma_pagamento: 'Financiamento', obs_venda: 'Entrada em 10 dias' },
      proposta: propostaCom({ prazoInstalacao: 45 }),
    }));
    expect(f.sugestoes.venda.valor_centavos).toMatchObject({ valor: 3_800_000, fonte: 'proposta' });
    expect(f.sugestoes.venda.forma).toMatchObject({ valor: 'financiamento' });
    expect(f.sugestoes.venda.nota).toMatchObject({ valor: 'Entrada em 10 dias' });
    expect(f.sugestoes.venda.prazo_prometido).toMatchObject({ valor: 'Instalação em até 45 dias' });
  });
  it('a nota da negociação e o prazo da obra vencem a proposta, que vira nota na ficha', () => {
    const f = montarFicha(base({
      privado: privadoCom({ nota: 'Da obra', prazo_prometido: '20 dias' }), propostaVenda: { vendido: true, valor_vendido: 1, forma_pagamento: null, obs_venda: 'Da proposta' },
    }));
    expect(f.campos['venda.nota']).toMatchObject({ valor: 'Da obra', fonte: 'obra', alt: { valor: 'Da proposta', fonte: 'proposta' } });
  });
});

describe('6. as formas de pagamento', () => {
  it('vista, misto e outros não traduzem; financiamento, cartão e boleto sim', () => {
    for (const t of ['vista', 'misto', 'outros', '', null]) expect(formaDaVendaPorTexto(t)).toBeNull();
    expect(formaDaVendaPorTexto('Financiamento')).toBe('financiamento');
    expect(formaDaVendaPorTexto('Cartão de crédito')).toBe('cartao');
    expect(formaDaVendaPorTexto('boleto')).toBe('boleto');
  });
  it('TED vira transferência no livro', () => {
    expect(FORMA_VENDA_PARA_LIVRO.ted).toBe('transferencia');
    expect(FORMA_VENDA_PARA_LIVRO.pix).toBe('pix');
  });
  it('formaDoEspelho dá o mesmo de antes', () => {
    expect(formaDoEspelho(['pix', 'financiamento'])).toBe('financiamento');
    expect(formaDoEspelho(['pix'])).toBe('vista');
    expect(formaDoEspelho(['ted', 'dinheiro'])).toBe('vista');
    expect(formaDoEspelho(['pix', 'cartao'])).toBe('misto');
    expect(formaDoEspelho(['cartao'])).toBe('cartao');
    expect(formaDoEspelho(['boleto', 'boleto'])).toBe('boleto');
  });
  it('à vista na planilha ou na proposta não vira Pix', () => {
    const f = montarFicha(base({
      propostaVenda: { vendido: true, valor_vendido: 38_000, forma_pagamento: 'vista', obs_venda: null },
      planilha: planilhaCom([{ chave: 'forma_pagamento', valor: 'À vista' }], null),
    }));
    expect(f.campos['venda.forma']).toBeUndefined();
    expect(f.sugestoes.venda.forma).toBeUndefined();
  });
});

describe('7. o próximo recebimento', () => {
  const pg = [{ forma: 'pix' as const, valor_centavos: 1_000_000 }, { forma: 'financiamento' as const, valor_centavos: 4_000_000 }];
  it('sem entradas: o Pix, como entrada', () => {
    expect(proximoRecebimento(pg, [])).toEqual({ forma: 'pix', valor_centavos: 1_000_000, categoria: 'entrada' });
  });
  it('com a entrada paga: o financiamento', () => {
    expect(proximoRecebimento(pg, [{ forma: 'pix', valor_centavos: 1_000_000 }])).toEqual({ forma: 'financiamento', valor_centavos: 4_000_000, categoria: 'financiamento' });
  });
  it('entrada parcial: o que falta, como parcela', () => {
    expect(proximoRecebimento(pg, [{ forma: 'pix', valor_centavos: 400_000 }])).toEqual({ forma: 'pix', valor_centavos: 600_000, categoria: 'parcela' });
  });
  it('tudo recebido: nada', () => {
    expect(proximoRecebimento(pg, [{ forma: 'pix', valor_centavos: 1_000_000 }, { forma: 'financiamento', valor_centavos: 4_000_000 }])).toBeNull();
    const e = base({ privado: privadoCom({ pagamento: pg.map((p) => ({ ...p, obs: '' })) }), entradas: [{ forma: 'pix', valor_centavos: 1_000_000 }, { forma: 'financiamento', valor_centavos: 4_000_000 }] });
    expect(montarFicha(e).sugestoes.recebimento).toEqual({});
  });
  it('TED sai como transferência', () => {
    expect(proximoRecebimento([{ forma: 'ted', valor_centavos: 500_000 }], [])?.forma).toBe('transferencia');
    expect(proximoRecebimento([{ forma: 'ted', valor_centavos: 500_000 }], [{ forma: 'transferencia', valor_centavos: 500_000 }])).toBeNull();
  });
});

describe('8. a vistoria pelas fotos', () => {
  it('a primeira foto dá o dia de Brasília e quem anexou', () => {
    const f = montarFicha(base({
      fotos: [
        { slot: 'fachada', em: '2026-10-02T13:00:00.000Z', por: 'nilce' },
        { slot: 'padrao', em: '2026-10-01T23:30:00.000Z', por: 'diego' },
        { slot: 'conta_luz', em: '2026-09-01T10:00:00.000Z', por: 'carla' },
      ],
    }));
    expect(f.sugestoes.vistoria.data).toMatchObject({ valor: '2026-10-01', fonte: 'fotos' });
    expect(f.sugestoes.vistoria.quem).toMatchObject({ valor: 'Diego', fonte: 'fotos' });
  });
  it('foto anexada pela leitura não dá quem', () => {
    const f = montarFicha(base({ fotos: [{ slot: 'fachada', em: '2026-10-02T13:00:00.000Z', por: 'leitura' }] }));
    expect(f.sugestoes.vistoria.quem).toBeUndefined();
    expect(f.sugestoes.vistoria.data).toBeDefined();
  });
  it('quem acompanhou vem do card; gravado, não sugere', () => {
    const e = base({ card: { cliente: 'Marcos', telefone: '', cidade: '', vendedor: '' }, obra: obraCom((p) => { p.vistoria = vistoriaVazia(); }) });
    expect(montarFicha(e).sugestoes.vistoria.acomp).toMatchObject({ valor: 'Marcos', fonte: 'card', rotulo: 'card' });
    const gravado = base({ card: e.card, obra: obraCom((p) => { p.vistoria = { ...vistoriaVazia(), acomp: 'Maria' }; }) });
    expect(montarFicha(gravado).sugestoes.vistoria.acomp).toBeUndefined();
  });
});

describe('9. o titular do financiamento', () => {
  it('contratante: os campos do financiamento são os do contratante, com a mesma fonte', () => {
    const f = montarFicha(base({ cad: cadCom({ financiamento_mesmo: { valor: 'contratante' }, nome: { valor: 'Maria da Silva' } }) }));
    expect(f.campos['financiamento.nome']).toEqual(f.campos['contratante.nome']);
    expect(f.campos['financiamento.nome'].fonte).toBe('cadastro');
  });
  it('sem decisão: nenhum campo de financiamento', () => {
    const f = montarFicha(base({ cad: cadCom({ nome: { valor: 'Maria da Silva' } }) }));
    expect(Object.keys(f.campos).filter((k) => k.startsWith('financiamento.'))).toEqual([]);
  });
  it('outra pessoa, nome só na proposta de banco: o cadastro recebe a sugestão do banco', () => {
    const f = montarFicha(base({
      cad: cadCom({ financiamento_mesmo: { valor: 'outra_pessoa' } }),
      obra: obraCom((p) => { p.banco = { ...bancoVazio(), fin: { nome: 'Ana Souza', doc: '', rg: '', qualif: '', end: '', cep: '', tel: '', email: '' } }; }),
    }));
    expect(f.sugestoes.cadastro.fin_nome).toMatchObject({ valor: 'Ana Souza', fonte: 'banco' });
  });
});

describe('10. o Trello', () => {
  const estadoComUrl = { etapas: { 3: { trello: { url: 'https://trello.com/c/obra', criado_em: 'x', por: 'y' } } } } as unknown as EstadoJornada;
  it('a URL da obra vence', () => {
    expect(trelloDaFicha(estadoComUrl, { card_url: 'https://trello.com/c/dossie' }, null)).toMatchObject({ url: 'https://trello.com/c/obra', fonte: 'obra', tem_cartao: false });
  });
  it('o dossiê só com link do Trello', () => {
    expect(trelloDaFicha(null, { card_url: 'https://trello.com/c/abc' }, null)).toMatchObject({ url: 'https://trello.com/c/abc', fonte: 'dossie' });
    expect(trelloDaFicha(null, { card_url: 'javascript:x' }, null).url).toBeNull();
  });
  it('só o id da ligação: sem URL, mas com cartão', () => {
    expect(trelloDaFicha(null, null, 'abc123')).toMatchObject({ url: null, fonte: null, tem_cartao: true });
  });
});

describe('11. a UF só entra se o cadastro a aceitar', () => {
  it('cidade do card com UF inexistente não sugere; com UF válida sugere', () => {
    expect(montarFicha(base({ card: { cliente: '', telefone: '', cidade: 'Uberlândia - XX', vendedor: '' } })).sugestoes.cadastro.uf_ponto).toBeUndefined();
    expect(montarFicha(base({ card: { cliente: '', telefone: '', cidade: 'Uberlândia - MG', vendedor: '' } })).sugestoes.cadastro.uf_ponto).toMatchObject({ valor: 'MG', fonte: 'card' });
  });
});
