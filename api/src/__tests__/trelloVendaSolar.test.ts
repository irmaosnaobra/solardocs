import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Cartão do Trello da venda solar: a parte pura (título, casamento do cartão, etiquetas, checklists, descrição), a sonda do quadro
// público e a ligação assinada com o campo novo. Dados inventados. Nada de rede (fetch simulado), banco ou Anthropic.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  cidadeUfDoEndereco, localDoCartao, tituloDoCartao, mesmaPessoa, titularDaVenda, numeroDoTitulo, acharCartao, etiquetasAutomaticas, validarEtiquetasExtra,
  planoDeEtiquetas, planoDeChecklists, passosDeChecklist, descricaoDoCartao, equipamentoDaProposta, nomearAnexos, lerRegistroBruto,
  ITENS_BACKOFFICE, ITENS_ENGENHARIA, type CartaoDoQuadro,
} from '../services/gerador/trelloVendaSolar';
import { trelloQuadroPublico, limparCacheQuadroPublico } from '../services/gerador/dossieVenda';
import { normalizarCadastro, validarCampo, ehCampo, type Cadastro } from '../services/gerador/cadastroVenda';
import { papelDoCampo, donoDoArquivo, motivoDeDescarte } from '../services/gerador/cadastroVendaPapeis';
import { assinarLigacao, assinaturaConfere, ligacaoAssinada, lerLigacaoBruta, ligacaoSoDoTrello, type Ligacao } from '../services/gerador/vendaSolarHub';

const ID_A = 'a'.repeat(24);
const cartao = (id: string, name: string, labels: string[] = []): CartaoDoQuadro =>
  ({ id, name, idList: 'l1', labels: labels.map((n) => ({ id: `lab-${n}`, name: n })) });

const cadastro = (campos: Record<string, string>): Cadastro =>
  normalizarCadastro({ campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'x', em: 'y', fonte: 'manual' }])) }, 'vendasolar');

describe('título do cartão', () => {
  it('com a venda ligada leva #NNNN; sem ela não leva', () => {
    expect(tituloDoCartao({ codigoVenda: '#0061', nome: 'Ana Souza', local: 'Uberlândia MG' })).toBe('#0061 - Ana Souza - Uberlândia MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: 'Ana Souza', local: 'Uberlândia MG' })).toBe('Ana Souza - Uberlândia MG');
    expect(tituloDoCartao({ codigoVenda: '#0061', nome: '  Ana   Souza ', local: '' })).toBe('#0061 - Ana Souza');
  });
  it('sem titular: igual ao de sempre (nome do card, com ou sem #NNNN e local)', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: null, local: 'Uberaba MG' })).toBe('#0062 - Odécio - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: '  ', local: 'Uberaba MG' })).toBe('#0062 - Odécio - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: '', local: '' })).toBe('Cliente');
  });
  it('titular que é a mesma pessoa do card: sai o nome do titular, sem parênteses', () => {
    expect(tituloDoCartao({ codigoVenda: '#0063', nome: 'Eloisa', titular: 'Eloisa Elena Souza', local: 'Uberaba MG' })).toBe('#0063 - Eloisa Elena Souza - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0063', nome: 'Maria da Silva', titular: 'MARIA APARECIDA SILVA', local: 'Uberaba MG' })).toBe('#0063 - MARIA APARECIDA SILVA - Uberaba MG');
    expect(mesmaPessoa('José Antônio', 'Jose Antonio Pereira')).toBe(true);
    expect(mesmaPessoa('Odécio Ferreira', 'Eloisa Elena')).toBe(false);
  });
  it('titular que é outra pessoa: (PrimeiroNome do card) Titular, com e sem #NNNN e sem local', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - (Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: 'Odécio Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('(Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: 'Eloisa Elena', local: '' })).toBe('#0062 - (Odécio) Eloisa Elena');
  });
  it('titularDaVenda: igual a nomeDaHomologacao (outra_pessoa ou vazio com tuc_nome = tuc_nome); contratante ou sem tuc_nome = contratante', () => {
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Eloisa Elena' }))).toBe('Eloisa Elena');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'outra_pessoa' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'contratante', tuc_nome: 'Eloisa Elena' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', tuc_nome: 'Eloisa Elena' }))).toBe('Eloisa Elena');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({}))).toBe('');
  });
  it('primeiro nome do card sem parênteses; só parênteses = sai só o titular', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: '(Odécio) Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - (Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: '() Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - Eloisa Elena - Uberaba MG');
  });
  it('a cidade vem do fim do endereço da instalação, depois do contratante, depois do card', () => {
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Uberlândia - MG')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Catalão/GO 75700-000')).toEqual({ cidade: 'Catalão', uf: 'GO' });
    expect(cidadeUfDoEndereco('Rua A 10 Centro')).toBeNull();
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Cidade - XX')).toBeNull();
    expect(localDoCartao(cadastro({ endereco_ponto: 'Rua A, 10, Centro, Araguari - MG', cidade: 'Uberlândia', uf: 'MG' }), 'Outra')).toBe('Araguari MG');
    expect(localDoCartao(cadastro({ endereco_ponto: 'Rua A 10', cidade: 'Uberlândia', uf: 'mg' }), 'Outra')).toBe('Uberlândia MG');
    expect(localDoCartao(cadastro({}), 'Patos de Minas')).toBe('Patos de Minas');
  });
  it('numeroDoTitulo lê só o #NNNN do começo', () => {
    expect(numeroDoTitulo('#0064 - (Igor) Laurentino Neto- Catalão GO')).toBe('0064');
    expect(numeroDoTitulo('ELETROPOSTO #0001 - Bruno')).toBeNull();
    expect(numeroDoTitulo('Ana #0061')).toBeNull();
  });
});

describe('achar o cartão que já existe', () => {
  const quadro = [
    cartao('c1', '#0061 - Ana Souza Oliveira - Uberlândia MG'),
    cartao('c2', '#00610 - Outro Cliente - Catalão GO'),
    cartao('c3', '#0062 - Bruno Lima - Araguari MG'),
  ];
  const base = { cartoes: quadro, codigoVenda: '#0061', nome: 'Ana Souza' };
  it('acha por #NNNN exato: #0061 não casa com #00610', () => {
    const r = acharCartao(base);
    expect(r).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 'c1' } });
  });
  it('o guardado na ligação vem antes do número, e só vale se o cartão está aberto no quadro', () => {
    expect(acharCartao({ ...base, guardado: 'c3' })).toMatchObject({ tipo: 'achou', por: 'guardado', cartao: { id: 'c3' } });
    expect(acharCartao({ ...base, guardado: 'arquivado' })).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 'c1' } });
  });
  it('card_id escolhido vale só entre os cartões abertos; fora do quadro é ignorado aqui (a rota recusa antes)', () => {
    expect(acharCartao({ ...base, escolhido: 'c3' })).toMatchObject({ tipo: 'achou', por: 'escolhido', cartao: { id: 'c3' } });
    expect(acharCartao({ ...base, escolhido: 'de-outro-quadro' })).toMatchObject({ por: 'numero' });
  });
  it('dois cartões com o mesmo número = empate, nunca escolhe', () => {
    const r = acharCartao({ ...base, cartoes: [...quadro, cartao('c9', '#0061 - Ana Souza - Uberlândia MG')] });
    expect(r.tipo).toBe('empate');
    expect(r.tipo === 'empate' && r.candidatos.map((c) => c.id).sort()).toEqual(['c1', 'c9']);
  });
  it('sem número, acha pelo nome (duas palavras em comum); nome com empate devolve os candidatos', () => {
    expect(acharCartao({ cartoes: quadro, codigoVenda: null, nome: 'Bruno Lima' })).toMatchObject({ tipo: 'achou', por: 'nome', cartao: { id: 'c3' } });
    const empate = acharCartao({ cartoes: [cartao('x1', 'Maria Souza Lima - Uberlândia MG'), cartao('x2', 'Maria Souza Lima - Araguari MG')], codigoVenda: null, nome: 'Maria Souza Lima' });
    expect(empate.tipo).toBe('empate');
    expect(empate.tipo === 'empate' && empate.candidatos).toHaveLength(2);
    expect(acharCartao({ cartoes: quadro, codigoVenda: null, nome: 'Zeca Pagodinho' })).toEqual({ tipo: 'nenhum' });
  });
  it('cartão achado SÓ pelo titular nunca é `achou`: vira empate com o motivo para o consultor confirmar', () => {
    const q = [cartao('t1', '#0062 - (Odécio) Eloisa Elena - Uberaba MG'), cartao('t2', '#0064 - (Igor) Laurentino Neto - Catalão GO')];
    expect(acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio Ferreira' })).toEqual({ tipo: 'nenhum' });
    const r = acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio Ferreira', titular: 'Eloisa Elena' });
    expect(r).toEqual({ tipo: 'empate', candidatos: [q[0]], motivo: 'Achei um cartão pelo nome do titular. Confirme se é deste cliente.' });
    // com o #NNNN da venda igual, quem decide é o número, como sempre
    expect(acharCartao({ cartoes: q, codigoVenda: '#0062', nome: 'Odécio Ferreira', titular: 'Eloisa Elena' })).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 't1' } });
    // o cartão que só o titular achou tem OUTRO número: o motivo diz que é de outra venda
    const outra = acharCartao({ cartoes: q, codigoVenda: '#0099', nome: 'Odécio Ferreira', titular: 'Eloisa Elena' });
    expect(outra.tipo).toBe('empate');
    expect(outra.tipo === 'empate' && outra.motivo).toContain('outra venda');
  });
  it('negativo: card "Odécio" com contratante "Odécio Ferreira" não acha sozinho o cartão de OUTRO cliente', () => {
    const q = [cartao('o1', '#0050 - Odécio Ferreira Neto - Araguari MG')];
    const r = acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio', titular: 'Odécio Ferreira' });
    expect(r.tipo).toBe('empate');
    expect(r.tipo === 'empate' && r.candidatos.map((c) => c.id)).toEqual(['o1']);
  });
  it('negativo: o titular casa por palavra inteira ("Ana Lima" não casa com "Mariana Lima Souza") e exige 2 palavras', () => {
    const q = [cartao('m1', '#0051 - Mariana Lima Souza - Uberaba MG')];
    expect(acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio', titular: 'Ana Lima' })).toEqual({ tipo: 'nenhum' });
    expect(acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio', titular: 'Lima' })).toEqual({ tipo: 'nenhum' });
    expect(acharCartao({ cartoes: q, codigoVenda: null, nome: 'Odécio', titular: 'De Lima' })).toEqual({ tipo: 'nenhum' });
  });
  it('dois cartões do titular = empate com os dois; o caminho do nome do card segue como era (achou)', () => {
    const dois = acharCartao({ cartoes: [cartao('u1', 'Eloisa Elena - Uberaba MG'), cartao('u2', '(Igor) Eloisa Elena - Araguari MG')], codigoVenda: null, nome: 'Odécio', titular: 'Eloisa Elena' });
    expect(dois.tipo === 'empate' && dois.candidatos.map((c) => c.id).sort()).toEqual(['u1', 'u2']);
    expect(acharCartao({ cartoes: [cartao('b1', '#0062 - Bruno Lima - Araguari MG')], codigoVenda: null, nome: 'Bruno Lima', titular: 'Eloisa Elena' }))
      .toMatchObject({ tipo: 'achou', por: 'nome', cartao: { id: 'b1' } });
  });
  it('cartão achado só pelo nome e que já tem OUTRO número vira empate (é de outra venda)', () => {
    const r = acharCartao({ cartoes: [cartao('c5', '#0050 - Ana Souza Oliveira - Uberlândia MG')], codigoVenda: '#0061', nome: 'Ana Souza Oliveira' });
    expect(r.tipo).toBe('empate');
  });
});

describe('etiquetas', () => {
  it('automáticas: ligação do cadastro, Urbana/Rural, concessionária e EXDEDENTES', () => {
    expect(etiquetasAutomaticas(cadastro({ uc_fornecimento: 'trifasico', uc_classe: 'rural', concessionaria: 'CEMIG Distribuição S.A.', benef_1_uc: '123' })))
      .toEqual(['Trifásico', 'Rural', 'Cemig', 'EXDEDENTES']);
    expect(etiquetasAutomaticas(cadastro({ uc_fornecimento: 'monofasico', uc_classe: 'residencial', concessionaria: 'Equatorial Goiás' })))
      .toEqual(['Monofásico 220V', 'Urbana', 'Equatorial']);
    // sem ligação no cadastro, nada de ligação; classe vazia é Urbana; concessionária desconhecida não vira etiqueta
    expect(etiquetasAutomaticas(cadastro({ concessionaria: 'Energisa' }))).toEqual(['Urbana']);
  });
  it('extras: só equipes e FASTRACK; o resto é inválido', () => {
    expect(validarEtiquetasExtra(['equipe pablo', 'FASTRACK', 'Equipe Pablo'])).toEqual({ validas: ['Equipe Pablo', 'FASTRACK'], invalidas: [] });
    expect(validarEtiquetasExtra(['Cemig', 'Urbana', 'Equipe Branco'])).toEqual({ validas: ['Equipe Branco'], invalidas: ['Cemig', 'Urbana'] });
    expect(validarEtiquetasExtra(undefined)).toEqual({ validas: [], invalidas: [] });
  });
  const doQuadro = ['Monofásico 220V', 'Bifásico', 'Trifásico', 'Urbana', 'Rural', 'Cemig', 'Equatorial', 'EXDEDENTES', 'Equipe Pablo']
    .map((name) => ({ id: `lab-${name}`, name }));
  it('plano: só aplica o que existe no quadro e o cartão ainda não tem; nunca cria', () => {
    const p = planoDeEtiquetas(['Trifásico', 'Rural', 'Cemig', 'EXDEDENTES', 'Equipe Branco'], doQuadro, ['Rural']);
    expect(p.aplicar.map((e) => e.name)).toEqual(['Trifásico', 'Cemig', 'EXDEDENTES']);
    expect(p.ja_tem).toEqual(['Rural']);
    expect(p.ausentes).toEqual(['Equipe Branco']);
    expect(p.conflitos).toEqual([]);
  });
  it('plano: grupo exclusivo já ocupado não ganha a segunda etiqueta (conflito)', () => {
    const p = planoDeEtiquetas(['Trifásico', 'Urbana'], doQuadro, ['Bifásico', 'Rural']);
    expect(p.aplicar).toEqual([]);
    expect(p.conflitos).toEqual([{ desejada: 'Trifásico', existente: 'Bifásico' }, { desejada: 'Urbana', existente: 'Rural' }]);
  });
});

describe('checklists', () => {
  const slots = new Set(['disjuntor', 'medidor', 'padrao', 'fachada', 'documento_titular_uc', 'conta_luz', 'procuracao']);
  it('BACKOFFICE marca pelos documentos, telefone e e-mail; ENGENHARIA vem toda desmarcada', () => {
    const p = planoDeChecklists(slots, true, true);
    expect(p.BACKOFFICE.map((i) => i.nome)).toEqual([...ITENS_BACKOFFICE]);
    expect(p.ENGENHARIA.map((i) => i.nome)).toEqual([...ITENS_ENGENHARIA]);
    const marcados = p.BACKOFFICE.filter((i) => i.marcado).map((i) => i.nome);
    expect(marcados).toEqual(['Foto Disjuntor', 'Foto n° do Medidor', 'Foto Padrão', 'Doc - CNH ou Identidade (Se for CNPJ - contrato social)',
      'Conta de Energia', 'Procuração assinada', 'Telefone', 'Email', 'Foto Fachada']);
    expect(p.ENGENHARIA.some((i) => i.marcado)).toBe(false);
    const vazio = planoDeChecklists(new Set(), false, false);
    expect(vazio.BACKOFFICE.some((i) => i.marcado)).toBe(false);
    // CNH do contratante também marca o item do documento
    expect(planoDeChecklists(new Set(['documento_titular']), false, false).BACKOFFICE.find((i) => i.nome.startsWith('Doc'))?.marcado).toBe(true);
  });
  it('card existente: não recria a checklist que já tem e só marca o que ficou completo (nunca desmarca)', () => {
    const plano = planoDeChecklists(slots, true, false);
    const existentes = [
      { id: 'k1', name: 'Backoffice', checkItems: [
        { id: 'i1', name: 'Foto Disjuntor', state: 'incomplete' },
        { id: 'i2', name: 'Foto N° do Medidor', state: 'complete' },
        { id: 'i3', name: 'Foto Padrão', state: 'incomplete' },
        { id: 'i4', name: 'Telefone', state: 'complete' },
        { id: 'i5', name: 'Email', state: 'complete' },       // o plano diz desmarcado: fica como está
      ] },
    ];
    const passos = passosDeChecklist(plano, existentes);
    const back = passos.find((p) => p.nome === 'BACKOFFICE')!;
    expect(back.criar).toBeNull();
    expect(back.marcar.map((m) => m.idItem)).toEqual(['i1', 'i3']);
    // ENGENHARIA não existia: cria inteira
    expect(passos.find((p) => p.nome === 'ENGENHARIA')!.criar).toHaveLength(ITENS_ENGENHARIA.length);
  });
});

describe('descrição e comentário', () => {
  const equip = equipamentoDaProposta({
    qtd_placas: 18, inversor: 'Growatt 10K', qtd_inversor: 1,
    dados: { tab: { mod: 'Canadian CS7N', pot: 600, inv: 'x' }, qtdInv: 2 },
  });
  it('padrão do quadro: telefone, e-mail, ligação e as linhas em negrito', () => {
    const d = descricaoDoCartao({ telefone: '34988880001', email: 'ana@exemplo.com', ligacao: 'trifasico', equip });
    expect(d).toBe(['(34) 98888-0001', 'ana@exemplo.com', 'Trifásico', '**18 - Canadian CS7N 600W**', '**1 - Growatt 10K**'].join('\n\n'));
  });
  it('não repete a potência quando o modelo já a traz, e linha sem dado não sai', () => {
    const e = equipamentoDaProposta({ qtd_placas: 10, inversor: null, qtd_inversor: null, dados: { tab: { mod: 'Jinko 550W', pot: 550 } } });
    expect(descricaoDoCartao({ telefone: '', email: '', ligacao: '', equip: e })).toBe('**10 - Jinko 550W**');
    expect(descricaoDoCartao({ telefone: '', email: '', ligacao: 'xyz', equip: null })).toBe('');
  });
});

describe('anexos e registro', () => {
  it('nome do anexo = rótulo do item; do segundo em diante leva número', () => {
    const r = nomearAnexos([{ slot: 'fachada' }, { slot: 'conta_luz' }, { slot: 'fachada' }], (s) => (s === 'fachada' ? 'Foto da fachada' : 'Conta de luz'));
    expect(r.map((x) => x.nome)).toEqual(['Foto da fachada', 'Conta de luz', 'Foto da fachada 2']);
  });
  it('registro torto vira registro vazio; só ids de 24 hex entram', () => {
    expect(lerRegistroBruto('lixo')).toEqual({ card_id: null, comentario_id: null, anexados: {} });
    expect(lerRegistroBruto({ card_id: ID_A, comentario_id: 'x', anexados: { k: ID_A, j: 'curto' } }))
      .toEqual({ card_id: ID_A, comentario_id: null, anexados: { k: ID_A } });
  });
});

describe('uc_fornecimento no cadastro da venda solar', () => {
  it('é campo da venda solar (não do eletroposto) e valida monofásico, bifásico e trifásico', () => {
    expect(ehCampo('uc_fornecimento', 'vendasolar')).toBe(true);
    expect(ehCampo('uc_fornecimento', 'eletroposto')).toBe(false);
    expect(validarCampo('uc_fornecimento', 'Monofásico')).toEqual({ ok: true, valor: 'monofasico' });
    expect(validarCampo('uc_fornecimento', 'BIFÁSICO')).toEqual({ ok: true, valor: 'bifasico' });
    expect(validarCampo('uc_fornecimento', 'trifásico 380V')).toEqual({ ok: true, valor: 'trifasico' });
    expect(validarCampo('uc_fornecimento', '')).toEqual({ ok: true, valor: '' });
    expect(validarCampo('uc_fornecimento', 'hexafásico').ok).toBe(false);
  });
  it('a conta de luz da geradora pode preencher o campo (a guarda de papéis não o descarta)', () => {
    expect(papelDoCampo('uc_fornecimento')).toBe('ponto');
    const dono = donoDoArquivo('conta_luz', undefined, 'vendasolar');
    expect(motivoDeDescarte('uc_fornecimento', dono)).toBeNull();
    // a conta de uma beneficiária, não
    expect(motivoDeDescarte('uc_fornecimento', donoDoArquivo('conta_luz_beneficiaria', undefined, 'vendasolar'))).not.toBeNull();
  });
});

describe('ligação assinada com o campo novo', () => {
  beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = 'segredo-so-do-teste'; });
  afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

  const assinaturaDeAntes = (card: number, l: { proposta: string | null; venda: string | null; por: string; em: string }): string =>
    crypto.createHmac('sha256', Buffer.from('segredo-so-do-teste', 'utf8')).update(`${card}|${l.proposta ?? ''}|${l.venda ?? ''}|${l.por}|${l.em}`).digest('hex');

  it('ligação gravada ANTES do campo (sem trello_card) segue válida com a fórmula antiga', () => {
    const l = { proposta: 'P1', venda: '#0061', por: 'nilce', em: '2026-10-20T10:00:00.000Z' };
    const sig = assinaturaDeAntes(201, l);
    expect(assinarLigacao(201, l)).toBe(sig);
    expect(assinaturaConfere(201, l, sig)).toBe(true);
    expect(ligacaoAssinada(201, { ...l, sig })).toEqual(l);
  });
  it('com trello_card a assinatura muda, e adulterar o cartão invalida a ligação', () => {
    const l: Ligacao = { proposta: 'P1', venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', trello_card: ID_A };
    const sig = assinarLigacao(201, l)!;
    expect(sig).not.toBe(assinaturaDeAntes(201, l));
    expect(ligacaoAssinada(201, { ...l, sig })).toEqual(l);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ligacaoAssinada(201, { ...l, trello_card: 'b'.repeat(24), sig })).toBeNull();
    // tirar o cartão de uma ligação assinada com ele também a invalida
    expect(ligacaoAssinada(201, { proposta: 'P1', venda: null, por: 'nilce', em: l.em, sig })).toBeNull();
    vi.restoreAllMocks();
  });
  it('trello_card só entra com o formato de um id do Trello (24 hex)', () => {
    expect(lerLigacaoBruta({ trello_card: ID_A }).trello_card).toBe(ID_A);
    for (const ruim of ['curto', 'G'.repeat(24), `${ID_A}x`, 123, null, ['a']]) expect(lerLigacaoBruta({ trello_card: ruim })).not.toHaveProperty('trello_card');
  });
  it('ligação só do Trello: nada ligado e por = trello', () => {
    expect(ligacaoSoDoTrello({ proposta: null, venda: null, por: 'trello', em: 'x', trello_card: ID_A })).toBe(true);
    expect(ligacaoSoDoTrello({ proposta: 'P1', venda: null, por: 'trello', em: 'x' })).toBe(false);
    expect(ligacaoSoDoTrello({ proposta: null, venda: null, por: 'nilce', em: 'x' })).toBe(false);
  });
});

describe('sonda do quadro público', () => {
  beforeEach(() => { limparCacheQuadroPublico(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const stub = (resposta: () => Promise<Response>) => { const f = vi.fn(async (_url: string) => resposta()); vi.stubGlobal('fetch', f); return f; };

  it('200 com dados é público e a pergunta vai SEM key nem token; resposta definitiva é guardada', async () => {
    process.env.TRELLO_KEY = 'k'; process.env.TRELLO_TOKEN = 't';
    const f = stub(async () => new Response(JSON.stringify({ id: 'q1', name: 'Quadro' }), { status: 200 }));
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(String(f.mock.calls[0][0])).not.toMatch(/key=|token=/);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    delete process.env.TRELLO_KEY; delete process.env.TRELLO_TOKEN;
  });
  it('401, 403 e 404 são privado, e "privado" NUNCA fica em cache: cada pergunta confere na hora', async () => {
    for (const status of [401, 403, 404]) {
      limparCacheQuadroPublico();
      const f = stub(async () => new Response('unauthorized', { status }));
      expect(await trelloQuadroPublico('Q')).toBe(false);
      expect(await trelloQuadroPublico('Q')).toBe(false);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });
  it('privado e logo depois público: a segunda pergunta já vê o quadro aberto; "público" fica em cache só por 60 s', async () => {
    let status = 401;
    const f = stub(async () => (status === 200 ? new Response(JSON.stringify({ id: 'q' }), { status: 200 }) : new Response('x', { status })));
    expect(await trelloQuadroPublico('Q')).toBe(false);
    status = 200;
    expect(await trelloQuadroPublico('Q')).toBe(true);
    status = 401;
    expect(await trelloQuadroPublico('Q')).toBe(true);   // ainda no cache curto
    expect(f).toHaveBeenCalledTimes(2);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    expect(await trelloQuadroPublico('Q')).toBe(false);
    vi.useRealTimers();
  });
  it('rede caída, 5xx, 429 e corpo estranho contam como PÚBLICO e não entram no cache', async () => {
    let f = stub(async () => { throw new Error('rede caiu'); });
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    for (const status of [500, 502, 429]) {
      limparCacheQuadroPublico();
      f = stub(async () => new Response('x', { status }));
      expect(await trelloQuadroPublico('Q')).toBe(true);
    }
    limparCacheQuadroPublico();
    f = stub(async () => new Response('não é json', { status: 200 }));
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    // quando o quadro fecha, a próxima pergunta enxerga (resposta de erro não ficou guardada)
    limparCacheQuadroPublico();
    f = stub(async () => new Response('x', { status: 401 }));
    expect(await trelloQuadroPublico('Q')).toBe(false);
  });
});
