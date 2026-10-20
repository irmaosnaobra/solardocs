import { describe, it, expect, vi } from 'vitest';

// Documentos e cadastro por PESSOA e por FINALIDADE no eletroposto (19/10/2026): catálogo novo, cadastro com papéis (cedente,
// avalista, imóvel), prompt com o nome dado pelo usuário e as pessoas conhecidas, e a conferência de quem é cada dado. Módulos puros;
// os bancos e a Anthropic são simulados só para o import (nada sai para a rede). As rotas, com o bucket e a IA simulados, ficam em
// docsRotulos.route.test.ts ("leitura por papel").

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({}) }));
vi.mock('../utils/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));

import {
  CATALOGO, LIMITES, limiteDoItem, motivoSemEspaco, mimeServeAoItem, itemDoCatalogo, registroDocsVazio, type ArquivoDoc,
} from '../services/gerador/docsCliente';
import {
  CAMPOS, CAMPOS_CEDENTE, CAMPOS_AVALISTA, CAMPOS_IMOVEL, validarCampo, faltando, faltandoPorPapel, vistaDe, normalizarCadastro, type Campo,
} from '../services/gerador/cadastroVenda';
import {
  SISTEMA_CADASTRO, DESCRICAO_DOS_ITENS, SLOTS_LIDOS, FORMATO_CADASTRO, EsquemaCadastro, linhaDoArquivo, textoDasPessoas,
  prepararArquivos, ordemDeLeitura, limparSugestoes, limparDocumentos, rotuloSemNome, notaDaIa,
} from '../services/gerador/cadastroVendaLeitura';
import { donoDoArquivo, motivoDeDescarte, papelDoCampo, NOTA_SEM_DONO } from '../services/gerador/cadastroVendaPapeis';

const CPF = '529.982.247-25';
const CPF2 = '111.444.777-35';
const CNPJ = '11.222.333/0001-81';
const chaves = (linha: 'eletroposto' | 'solar') => CATALOGO[linha].map((x) => x.chave);
const cad = (campos: Partial<Record<Campo, string>>) => normalizarCadastro({
  campos: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, { valor: v, por: 'x', em: 'x', fonte: 'manual' }])),
});

describe('catálogo do eletroposto por pessoa e por finalidade', () => {
  it('as chaves antigas continuam (arquivo já enviado não se perde) e as novas existem', () => {
    for (const antiga of ['documento_titular', 'conta_luz', 'foto_local', 'padrao', 'quadro_eletrico', 'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso', 'instalacao', 'outros']) {
      expect(chaves('eletroposto'), antiga).toContain(antiga);
    }
    for (const nova of ['comprovante_endereco_comprador', 'documento_cedente', 'comprovante_endereco_cedente', 'documento_avalista', 'comprovante_endereco_avalista', 'documento_outra_pessoa', 'documento_imovel', 'conta_luz_geradora', 'conta_luz_beneficiaria']) {
      expect(chaves('eletroposto'), nova).toContain(nova);
    }
    expect(new Set(chaves('eletroposto')).size).toBe(chaves('eletroposto').length);   // nenhuma chave repetida
    expect(chaves('solar')).toEqual(['documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor', 'contrato_assinado', 'art', 'projeto', 'parecer_acesso', 'obra_pronta', 'outros']);   // o solar não mudou
  });
  it('rótulos novos, exatamente como o dono pediu', () => {
    const rot = (c: string) => itemDoCatalogo('eletroposto', c)?.rotulo;
    expect(rot('documento_titular')).toBe('CNH ou documento pessoal do comprador');
    expect(rot('documento_cedente')).toBe('CNH ou documento pessoal do cedente (dono do ponto)');
    expect(rot('documento_outra_pessoa')).toBe('Documento de outra pessoa (cônjuge, sócio, representante)');
    expect(rot('documento_imovel')).toBe('Documento do imóvel: matrícula, escritura ou IPTU');
    expect(rot('conta_luz')).toBe('Conta de luz da instalação (ponto do carregador)');
    expect(rot('conta_luz_geradora')).toBe('Conta de luz da geradora (usina)');
    expect(rot('conta_luz_beneficiaria')).toBe('Conta de luz que recebe o excedente');
  });
  it('todos aceitam imagem e pdf; os novos são opcionais; só os de "outras pessoas" e "imóvel" aceitam vários', () => {
    const novos = CATALOGO.eletroposto.filter((i) => !['documento_titular', 'conta_luz', 'foto_local', 'padrao', 'quadro_eletrico', 'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso', 'instalacao', 'outros'].includes(i.chave));
    expect(novos).toHaveLength(9);
    for (const i of novos) {
      expect(i.aceita, i.chave).toBe('ambos');
      expect(i.obrigatorio, i.chave).toBe(false);
      expect(mimeServeAoItem(i, 'image/jpeg'), i.chave).toBe(true);
      expect(mimeServeAoItem(i, 'application/pdf'), i.chave).toBe(true);
    }
    expect(novos.filter((i) => i.varios).map((i) => i.chave).sort()).toEqual(['documento_imovel', 'documento_outra_pessoa']);
  });
  it('limites: 1 por item de pessoa e de conta, 40 nos que aceitam vários, 100 por venda', () => {
    expect(LIMITES).toMatchObject({ total: 100, porItem: 40, outros: 100 });
    for (const c of ['documento_titular', 'comprovante_endereco_comprador', 'documento_cedente', 'comprovante_endereco_cedente', 'documento_avalista', 'comprovante_endereco_avalista', 'conta_luz', 'conta_luz_geradora', 'conta_luz_beneficiaria']) {
      expect(limiteDoItem(itemDoCatalogo('eletroposto', c)!), c).toBe(1);
    }
    expect(limiteDoItem(itemDoCatalogo('eletroposto', 'documento_outra_pessoa')!)).toBe(40);
    expect(limiteDoItem(itemDoCatalogo('eletroposto', 'documento_imovel')!)).toBe(40);
    expect(limiteDoItem(itemDoCatalogo('eletroposto', 'outros')!)).toBe(100);
    const arq = (i: number, slot: string): ArquivoDoc => ({ id: `id${i}`, slot, caminho: `eletroposto/1/${i}`, mime: 'application/pdf', bytes: 1, em: '', por: '' });
    const reg = (n: number, slot: string) => ({ ...registroDocsVazio(), arquivos: Array.from({ length: n }, (_, i) => arq(i, slot)) });
    expect(motivoSemEspaco(reg(1, 'documento_cedente'), itemDoCatalogo('eletroposto', 'documento_cedente')!)).toBe('slot_ocupado');
    expect(motivoSemEspaco(reg(40, 'documento_imovel'), itemDoCatalogo('eletroposto', 'documento_imovel')!)).toBe('muitos_no_item');
    expect(motivoSemEspaco(reg(39, 'documento_imovel'), itemDoCatalogo('eletroposto', 'documento_imovel')!)).toBeNull();
    expect(motivoSemEspaco(reg(100, 'outros'), itemDoCatalogo('eletroposto', 'documento_cedente')!)).toBe('muitos_na_venda');
  });
  it('a leitura enxerga todos os itens novos e cada um tem descrição no prompt', () => {
    for (const c of ['comprovante_endereco_comprador', 'documento_cedente', 'comprovante_endereco_cedente', 'documento_avalista', 'comprovante_endereco_avalista', 'documento_outra_pessoa', 'documento_imovel', 'conta_luz_geradora', 'conta_luz_beneficiaria']) {
      expect(SLOTS_LIDOS, c).toContain(c);
      expect(DESCRICAO_DOS_ITENS[c], c).toBeTruthy();
      expect(SISTEMA_CADASTRO, c).toContain(`"${c}":`);
    }
  });
});

describe('cadastro com papéis: cedente, avalista e imóvel', () => {
  it('os campos novos existem, com os prefixos pedidos, e os do comprador continuam', () => {
    expect([...CAMPOS_CEDENTE]).toEqual(['ced_nome', 'ced_cpf_cnpj', 'ced_rg_ie', 'ced_orgao_emissor', 'ced_nacionalidade', 'ced_estado_civil', 'ced_profissao', 'ced_endereco', 'ced_bairro', 'ced_cidade', 'ced_uf', 'ced_cep', 'ced_email', 'ced_telefone', 'ced_qualidade']);
    expect([...CAMPOS_AVALISTA]).toEqual(['aval_nome', 'aval_cpf_cnpj', 'aval_rg_ie', 'aval_orgao_emissor', 'aval_nascimento', 'aval_nacionalidade', 'aval_estado_civil', 'aval_profissao', 'aval_endereco', 'aval_bairro', 'aval_cidade', 'aval_uf', 'aval_cep', 'aval_email', 'aval_telefone']);
    expect([...CAMPOS_IMOVEL]).toEqual(['imovel_matricula', 'imovel_cartorio', 'imovel_iptu']);
    for (const antigo of ['tipo', 'nome', 'cpf_cnpj', 'rg_ie', 'cep', 'uf', 'rep_nome', 'rep_cpf', 'endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta']) expect(CAMPOS).toContain(antigo);
    expect(new Set(CAMPOS).size).toBe(CAMPOS.length);
    expect(CAMPOS).toHaveLength(25 + 15 + 15 + 3);
  });

  it('validação: cada campo do cedente e do avalista segue a regra do campo igual do comprador', () => {
    expect(validarCampo('ced_cpf_cnpj', '52998224725')).toEqual({ ok: true, valor: CPF });
    expect(validarCampo('ced_cpf_cnpj', '11222333000181')).toEqual({ ok: true, valor: CNPJ });
    expect(validarCampo('ced_cpf_cnpj', '111.111.111-11')).toEqual({ ok: false, erro: 'Dígito do CPF não confere.' });
    expect(validarCampo('aval_cpf_cnpj', '123')).toMatchObject({ ok: false });
    expect(validarCampo('aval_cpf_cnpj', CPF2)).toEqual({ ok: true, valor: CPF2 });
    expect(validarCampo('ced_cep', '38400100')).toEqual({ ok: true, valor: '38400-100' });
    expect(validarCampo('aval_cep', '384')).toEqual({ ok: false, erro: 'CEP com 8 dígitos.' });
    expect(validarCampo('ced_uf', 'mg')).toEqual({ ok: true, valor: 'MG' });
    expect(validarCampo('aval_uf', 'XX')).toEqual({ ok: false, erro: 'UF inválida.' });
    expect(validarCampo('ced_email', 'A@B.COM')).toEqual({ ok: true, valor: 'a@b.com' });
    expect(validarCampo('aval_email', 'sem-arroba')).toEqual({ ok: false, erro: 'E-mail inválido.' });
    expect(validarCampo('ced_telefone', '(34) 99999-0000')).toEqual({ ok: true, valor: '34999990000' });
    expect(validarCampo('aval_telefone', '123')).toMatchObject({ ok: false });
    expect(validarCampo('aval_nascimento', '31/02/1980')).toMatchObject({ ok: false });
    expect(validarCampo('aval_nascimento', '15/03/1980')).toEqual({ ok: true, valor: '15/03/1980' });
    expect(validarCampo('ced_nome', '  Antonio   Pereira ')).toEqual({ ok: true, valor: 'Antonio Pereira' });
    expect(validarCampo('ced_nome', '')).toEqual({ ok: true, valor: '' });   // vazio limpa
    expect(validarCampo('imovel_matricula', 'Matrícula 12.345 do 1º Ofício')).toEqual({ ok: true, valor: 'Matrícula 12.345 do 1º Ofício' });
    expect(validarCampo('imovel_iptu', 'x'.repeat(201))).toMatchObject({ ok: false });
    // o representante da empresa do comprador continua só com CPF
    expect(validarCampo('rep_cpf', '11222333000181')).toMatchObject({ ok: false });
  });
  it('ced_qualidade: as cinco opções, sem acento e em minúscula; o resto é recusado', () => {
    for (const [entrada, saida] of [['proprietario', 'proprietario'], ['Proprietário', 'proprietario'], ['POSSUIDOR', 'possuidor'], ['inquilino', 'inquilino'], ['Representante', 'representante'], ['Condomínio', 'condominio']]) {
      expect(validarCampo('ced_qualidade', entrada), entrada).toEqual({ ok: true, valor: saida });
    }
    expect(validarCampo('ced_qualidade', 'dono')).toMatchObject({ ok: false });
    expect(validarCampo('ced_qualidade', 'locatário')).toMatchObject({ ok: false });
  });

  it('faltando: sem nenhum campo de cedente, avalista ou imóvel a conta é a de antes (só comprador e ponto)', () => {
    const f = faltando(cad({ nome: 'Carlos', cpf_cnpj: CPF }));
    expect(f.some((k) => k.startsWith('ced_') || k.startsWith('aval_') || k.startsWith('imovel_'))).toBe(false);
    expect(f).toContain('rg_ie');
    expect(faltandoPorPapel(cad({ nome: 'Carlos' }))).toEqual({ cedente: [], avalista: [], imovel: [] });
  });
  it('faltando: cedente com algum campo preenchido lista o que falta DELE (pessoa física)', () => {
    const c = cad({ ced_nome: 'Antonio Pereira' });
    expect(faltandoPorPapel(c).cedente).toEqual(['ced_cpf_cnpj', 'ced_endereco', 'ced_bairro', 'ced_cidade', 'ced_uf', 'ced_cep', 'ced_qualidade', 'ced_rg_ie', 'ced_nacionalidade', 'ced_estado_civil', 'ced_profissao']);
    expect(faltandoPorPapel(c).avalista).toEqual([]);
    // entram no `faltando` geral, depois dos do comprador
    const f = faltando(c);
    expect(f.slice(-11)).toEqual(faltandoPorPapel(c).cedente);
    expect(f).toContain('nome');   // o comprador continua pedindo o dele
  });
  it('faltando: cedente empresa ou condomínio (CNPJ) não pede RG, nacionalidade, estado civil nem profissão', () => {
    const c = cad({ ced_nome: 'Condomínio X', ced_cpf_cnpj: CNPJ });
    expect(faltandoPorPapel(c).cedente).toEqual(['ced_endereco', 'ced_bairro', 'ced_cidade', 'ced_uf', 'ced_cep', 'ced_qualidade']);
  });
  it('faltando: avalista e imóvel só entram quando começados, e saem quando completos', () => {
    expect(faltandoPorPapel(cad({ aval_nome: 'Bruno Lima' })).avalista).toEqual(['aval_cpf_cnpj', 'aval_endereco', 'aval_bairro', 'aval_cidade', 'aval_uf', 'aval_cep', 'aval_rg_ie', 'aval_estado_civil', 'aval_profissao']);
    expect(faltandoPorPapel(cad({ imovel_iptu: '123' })).imovel).toEqual(['imovel_matricula']);
    expect(faltandoPorPapel(cad({ imovel_matricula: '12345' })).imovel).toEqual([]);
    const completo = cad({
      ced_nome: 'A', ced_cpf_cnpj: CPF, ced_rg_ie: '1', ced_nacionalidade: 'brasileira', ced_estado_civil: 'solteiro', ced_profissao: 'x', ced_endereco: 'r',
      ced_bairro: 'b', ced_cidade: 'c', ced_uf: 'MG', ced_cep: '38400-100', ced_qualidade: 'proprietario',
    });
    expect(faltandoPorPapel(completo).cedente).toEqual([]);
  });
  it('a vista (GET e PUT) leva os campos novos em `valores`, sem mudar de formato', () => {
    const v = vistaDe(cad({ nome: 'Carlos', ced_nome: 'Antonio', aval_nome: 'Bruno', imovel_matricula: '9' }));
    expect(Object.keys(v).sort()).toEqual(['campos', 'faltando', 'tipo', 'valores']);
    expect(v.valores).toEqual({ nome: 'Carlos', ced_nome: 'Antonio', aval_nome: 'Bruno', imovel_matricula: '9' });
    expect(v.tipo).toBe('PF');
  });
  it('o JSON do bucket com campo novo é lido; campo desconhecido continua sendo ignorado', () => {
    const c = normalizarCadastro({ campos: { ced_nome: { valor: 'A', por: 'x', em: 'y', fonte: 'ia' }, senha: { valor: 'x' } }, alteracoes: [{ campo: 'aval_nome', por: 'x', em: 'y', fonte: 'manual' }, { campo: 'senha' }] });
    expect(Object.keys(c.campos)).toEqual(['ced_nome']);
    expect(c.alteracoes).toHaveLength(1);
  });
});

describe('o que vai ao modelo: nome dado pelo usuário e pessoas conhecidas', () => {
  it('a linha de cada arquivo traz o item e, se houver, o nome que a pessoa deu', () => {
    expect(linhaDoArquivo(1, 'documento_cedente')).toBe('Arquivo 1, slot "documento_cedente" (CNH ou documento pessoal do cedente (dono do ponto)).');
    expect(linhaDoArquivo(3, 'outros', 'CNH Antonio cedente')).toBe('Arquivo 3, slot "outros" (Outros documentos). Nome dado pelo usuário: "CNH Antonio cedente".');
    expect(linhaDoArquivo(2, 'outros', '   ')).toBe('Arquivo 2, slot "outros" (Outros documentos).');
    expect(linhaDoArquivo(4, 'outros', 'a\nb"c')).toBe('Arquivo 4, slot "outros" (Outros documentos). Nome dado pelo usuário: "a b\\"c".');
  });
  it('as pessoas conhecidas: só as que existem; sem nenhuma, nada', () => {
    expect(textoDasPessoas({})).toBe('');
    expect(textoDasPessoas()).toBe('');
    const t = textoDasPessoas({ comprador: 'Carlos Alves', cedente: ' ', avalista: 'Bruno Lima' });
    expect(t).toContain('comprador: "Carlos Alves"');
    expect(t).toContain('avalista: "Bruno Lima"');
    expect(t).not.toContain('cedente:');
    expect(t.startsWith('Arquivo')).toBe(false);   // não confunde com a linha de um arquivo
  });
  it('prepararArquivos: o nome dado entra no bloco do arquivo certo; o texto do bloco continua começando por "Arquivo N"', async () => {
    const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
    const f = (id: string, slot: string): ArquivoDoc => ({ id, slot, caminho: `eletroposto/1/${id}.jpg`, mime: 'image/jpeg', bytes: JPG.length, em: '2026-10-19T10:00:00.000Z', por: 'x' });
    const r = await prepararArquivos([f('a', 'outros'), f('b', 'documento_titular')], async () => JPG, new Set(['a']), new Map([['a', 'conta da geradora']]));
    const textos = r.blocos.filter((b: any) => b.type === 'text').map((b: any) => b.text);
    expect(textos).toEqual([
      'Arquivo 1, slot "documento_titular" (CNH ou documento pessoal do comprador).',
      'Arquivo 2, slot "outros" (Outros documentos). Nome dado pelo usuário: "conta da geradora".',
    ]);
  });
  it('ordem de leitura: comprador (documento e comprovante), conta da instalação e cedente vêm antes do resto', () => {
    const f = (i: number, slot: string) => ({ id: `id${i}`, slot, caminho: `eletroposto/1/${i}.jpg`, mime: 'image/jpeg', bytes: 10, em: `2026-10-19T10:0${i}:00.000Z`, por: 'x' });
    const ordem = ordemDeLeitura([
      f(1, 'documento_avalista'), f(2, 'conta_luz_geradora'), f(3, 'comprovante_endereco_cedente'), f(4, 'documento_cedente'),
      f(5, 'conta_luz'), f(6, 'comprovante_endereco_comprador'), f(7, 'documento_titular'), f(8, 'contrato_assinado'),
    ]).map((a) => a.slot);
    expect(ordem).toEqual([
      'documento_titular', 'comprovante_endereco_comprador', 'conta_luz', 'documento_cedente', 'comprovante_endereco_cedente',
      'contrato_assinado', 'conta_luz_geradora', 'documento_avalista',   // o resto, do mais recente para o mais antigo
    ]);
  });
  it('reserva: 12 fotos de 3 MB em outros não tiram a CNH do cedente nem o comprovante do comprador do orçamento de 22 MB', async () => {
    const MB = 1024 * 1024;
    const corpo = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 7)]);
    const tam: Record<string, number> = { outros: 3 * MB, documento_cedente: 2.5 * MB, comprovante_endereco_comprador: 1 * MB };
    const f = (id: string, slot: string, i: number): ArquivoDoc => ({ id, slot, caminho: id, mime: 'image/jpeg', bytes: tam[slot], em: `2026-10-19T10:${String(i).padStart(2, '0')}:00.000Z`, por: 'x' });
    const arquivos = [...Array.from({ length: 12 }, (_, i) => f(`o${i}`, 'outros', i)), f('ced', 'documento_cedente', 20), f('comp', 'comprovante_endereco_comprador', 21)];
    const r = await prepararArquivos(arquivos, async (c) => corpo(tam[arquivos.find((a) => a.caminho === c)!.slot]));
    expect(r.lidos).toEqual(expect.arrayContaining([{ slot: 'documento_cedente', n: 1 }, { slot: 'comprovante_endereco_comprador', n: 1 }, { slot: 'outros', n: 6 }]));
    expect(r.aceitosDocs.reduce((s, a) => s + a.bytes, 0)).toBeLessThanOrEqual(22 * MB);
    expect(r.ignorados).toHaveLength(6);
  });
  it('o esquema é SIMPLES (a API recusou o de um objeto por campo): duas listas de objetos planos, e o campo é um enum', () => {
    expect(Object.keys(EsquemaCadastro.shape).sort()).toEqual(['campos', 'documentos']);
    expect(Object.keys(EsquemaCadastro.shape.campos.element.shape).sort()).toEqual(['campo', 'confianca', 'indice', 'nota', 'valor']);
    expect(Object.keys(EsquemaCadastro.shape.documentos.element.shape).sort()).toEqual(['indice', 'nota', 'rotulo', 'tipo']);
    const schema = FORMATO_CADASTRO.schema as any;
    const item = schema.properties.campos.items;
    // O ajudante do SDK tira o `enum` do JSON Schema (a API só aceita um pedaço dele) e o põe na descrição do campo: o modelo
    // lê os nomes, e o servidor confere de novo (`listaDeCampos` ignora campo desconhecido, `confiancaDe` normaliza).
    const nomes = (d: string): string[] => JSON.parse(/\{enum: (\[.*\])\}/.exec(d)![1]);
    expect(nomes(item.properties.campo.description)).toEqual(CAMPOS.filter((k) => k !== 'tipo'));   // PF ou PJ sai do tamanho do CPF/CNPJ
    expect(nomes(item.properties.campo.description)).toEqual(expect.arrayContaining(['nome', 'ced_nome', 'ced_qualidade', 'aval_nascimento', 'imovel_iptu', 'titular_conta']));
    expect(nomes(item.properties.confianca.description)).toEqual(['alta', 'media', 'baixa']);
    // nada de objeto aninhado por campo nem de `$ref`: 2 listas, 5 + 4 propriedades
    expect(JSON.stringify(schema)).not.toContain('$ref');
    expect(Object.keys(schema.properties)).toHaveLength(2);
    expect(item.required).toHaveLength(5);
    expect(schema.properties.documentos.items.required).toHaveLength(4);
    expect(SISTEMA_CADASTRO).toContain('NOME QUE O USUÁRIO DEU');
    expect(SISTEMA_CADASTRO).toContain('vale o nome escrito no documento');
    expect(SISTEMA_CADASTRO).toContain('NUNCA use dado de um documento de uma pessoa para outra');
    expect(SISTEMA_CADASTRO).toContain('NUNCA o endereço do ponto de instalação');
    expect(SISTEMA_CADASTRO).toContain('NÃO preenchem campo nenhum');
    expect(SISTEMA_CADASTRO).toContain('ced_qualidade');
    expect(SISTEMA_CADASTRO).toContain('imovel_matricula');
    expect(SISTEMA_CADASTRO).not.toMatch(/[—–]/);
    expect(SISTEMA_CADASTRO).not.toContain('(matrícula do imóvel, cartão CNPJ');   // matrícula e comprovante agora têm item próprio
  });
});

describe('de quem é cada documento e cada campo (conferência do servidor)', () => {
  it('papel de cada campo', () => {
    expect(papelDoCampo('nome')).toBe('comprador');
    expect(papelDoCampo('rep_cpf')).toBe('comprador');
    expect(papelDoCampo('ced_endereco')).toBe('cedente');
    expect(papelDoCampo('aval_cep')).toBe('avalista');
    expect(papelDoCampo('imovel_iptu')).toBe('imovel');
    for (const p of ['endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta'] as const) expect(papelDoCampo(p)).toBe('ponto');
  });
  it('dono do arquivo: o item manda; sem dono no item, o tipo do conteúdo; item e tipo com donos diferentes é conflito', () => {
    expect(donoDoArquivo('documento_cedente', undefined)).toBe('cedente');
    expect(donoDoArquivo('documento_cedente', 'documento_cedente')).toBe('cedente');
    expect(donoDoArquivo('documento_cedente', 'outro')).toBe('cedente');   // a IA não soube dizer o tipo: vale o item
    expect(donoDoArquivo('documento_outra_pessoa', undefined)).toBe('outra_pessoa');
    expect(donoDoArquivo('documento_imovel', undefined)).toBe('imovel');
    expect(donoDoArquivo('outros', 'documento_avalista')).toBe('avalista');
    expect(donoDoArquivo('outros', 'comprovante_endereco_cedente')).toBe('cedente');
    expect(donoDoArquivo('outros', 'documento_imovel')).toBe('imovel');
    expect(donoDoArquivo('outros', 'conta_luz')).toBe('instalacao');
    expect(donoDoArquivo('outros', 'outro')).toBeUndefined();
    expect(donoDoArquivo('contrato_assinado', undefined)).toBeUndefined();
    // conflito: o conteúdo é de outra pessoa ou de outra finalidade que o item
    expect(donoDoArquivo('documento_titular', 'documento_cedente')).toBe('conflito');
    expect(donoDoArquivo('comprovante_endereco_avalista', 'comprovante_endereco_comprador')).toBe('conflito');
    expect(donoDoArquivo('conta_luz', 'conta_luz_geradora')).toBe('conflito');
    expect(donoDoArquivo('conta_luz', 'conta_luz_beneficiaria')).toBe('conflito');
    expect(donoDoArquivo('conta_luz', 'documento_cedente')).toBe('conflito');
    expect(donoDoArquivo('conta_luz', 'comprovante_endereco_comprador')).toBe('conflito');
    expect(donoDoArquivo('comprovante_endereco_comprador', 'conta_luz')).toBe('conflito');
    expect(donoDoArquivo('documento_titular', 'documento_outra_pessoa')).toBe('conflito');
    expect(donoDoArquivo('documento_imovel', 'documento_titular')).toBe('conflito');
  });
  it('matriz: pessoa só alimenta os campos dela; instalação SÓ o ponto; geradora, beneficiária e outra pessoa nada; imóvel só imovel_*; sem dono claro nada', () => {
    expect(motivoDeDescarte('nome', 'comprador')).toBeNull();
    expect(motivoDeDescarte('rep_nome', 'comprador')).toBeNull();
    expect(motivoDeDescarte('ced_nome', 'comprador')).toMatch(/outra pessoa/);
    expect(motivoDeDescarte('endereco_ponto', 'comprador')).toMatch(/outra pessoa/);   // comprovante da pessoa nunca é o ponto
    expect(motivoDeDescarte('ced_endereco', 'cedente')).toBeNull();
    expect(motivoDeDescarte('endereco', 'cedente')).not.toBeNull();
    expect(motivoDeDescarte('endereco_ponto', 'cedente')).not.toBeNull();
    expect(motivoDeDescarte('aval_cep', 'cedente')).not.toBeNull();
    expect(motivoDeDescarte('aval_cep', 'avalista')).toBeNull();
    for (const ponto of ['unidade_consumidora', 'concessionaria', 'titular_conta', 'endereco_ponto'] as const) expect(motivoDeDescarte(ponto, 'instalacao'), ponto).toBeNull();
    // a conta da instalação NUNCA alimenta campo de pessoa, mesmo estando no nome do cedente
    for (const c of CAMPOS.filter((k) => !['unidade_consumidora', 'concessionaria', 'titular_conta', 'endereco_ponto'].includes(k))) {
      expect(motivoDeDescarte(c, 'instalacao'), c).not.toBeNull();
    }
    for (const c of CAMPOS) {
      expect(motivoDeDescarte(c, 'geradora'), c).toMatch(/geradora ou da beneficiária/);
      expect(motivoDeDescarte(c, 'beneficiaria'), c).not.toBeNull();
      expect(motivoDeDescarte(c, 'outra_pessoa'), c).toMatch(/outra pessoa/);
      expect(motivoDeDescarte(c, undefined), c).toBe(NOTA_SEM_DONO);   // sem dono claro não alimenta nada
      expect(motivoDeDescarte(c, 'conflito'), c).toMatch(/diferentes/);
      expect(motivoDeDescarte(c, 'imovel') === null, c).toBe(c.startsWith('imovel_'));
    }
  });

  const arq = (i: number, slot: string): ArquivoDoc => ({ id: `id${i}`, slot, caminho: `c${i}`, mime: 'application/pdf', bytes: 1, em: '', por: '' });
  /** Um item da lista `campos` da saída da IA. */
  const c = (campo: string, valor: string, indice: number, confianca = 'alta', nota = '') => ({ campo, valor, indice, confianca, nota });
  const lista = (...campos: unknown[]) => ({ campos });
  const doc = (i: number, slot: string, tipo: string, nota = '') => ({ id: `id${i}`, slot, tipo, rotulo: '', nota });

  it('limparSugestoes: usa o arquivo do `indice`, descarta o de outra pessoa e guarda o motivo sem o valor', () => {
    const arquivos = [arq(1, 'documento_titular'), arq(2, 'outros'), arq(3, 'comprovante_endereco_cedente')];
    const documentos = [doc(1, 'documento_titular', 'documento_titular'), doc(2, 'outros', 'documento_cedente'), doc(3, 'comprovante_endereco_cedente', 'comprovante_endereco_cedente')];
    const { sugestoes, descartadas } = limparSugestoes(lista(
      c('nome', 'Carlos', 1),
      c('ced_nome', 'Antonio Pereira', 1),         // do arquivo do comprador: sai
      c('ced_cpf_cnpj', CPF, 2),                   // de outros, que o conteúdo diz ser a CNH do cedente: fica
      c('campo_inexistente', 'x', 2),              // ignorado
      c('endereco', 'Rua A 1', 3),                 // do comprovante do cedente: sai
      c('ced_endereco', 'Rua A 1', 3),             // fica
      c('ced_cep', '38400100', 3),                 // fica, formatado
    ), { arquivos, documentos });
    expect(Object.keys(sugestoes).sort()).toEqual(['ced_cep', 'ced_cpf_cnpj', 'ced_endereco', 'nome']);
    expect(sugestoes.ced_cpf_cnpj).toEqual({ valor: CPF, slot: 'outros', confianca: 'alta' });   // o `slot` é o do arquivo
    expect(sugestoes.ced_cep.valor).toBe('38400-100');
    expect(descartadas.map((d) => [d.campo, d.slot])).toEqual([['ced_nome', 'documento_titular'], ['endereco', 'comprovante_endereco_cedente']]);   // na ordem da lista
    expect(JSON.stringify(descartadas)).not.toMatch(/Antonio|Rua A/);
  });
  it('limparSugestoes: arquivo sem dono claro (tipo "outro", fora de `documentos`, contrato) não alimenta nada; CNH do cedente tipo "outro" não preenche o comprador', () => {
    const arquivos = [arq(1, 'outros'), arq(2, 'outros'), arq(3, 'contrato_assinado'), arq(4, 'outros')];
    const documentos = [doc(1, 'outros', 'outro'), doc(3, 'contrato_assinado', 'outro'), doc(4, 'outros', 'documento_cedente')];   // o arquivo 2 nem aparece em `documentos`
    const { sugestoes, descartadas } = limparSugestoes(lista(
      c('nome', 'Antonio Pereira', 1), c('cpf_cnpj', CPF, 1),     // CNH do cedente, tipo "outro" em outros: não vai para o comprador
      c('email', 'a@b.com', 2), c('concessionaria', 'Cemig', 2),   // fora de `documentos`: nada
      c('telefone', '34999990000', 3), c('imovel_matricula', '1', 3),   // contrato sem dono: nada, nem imóvel
      c('ced_nome', 'Antonio Pereira', 4),                          // tipo da IA é do cedente: fica
    ), { arquivos, documentos });
    expect(Object.keys(sugestoes)).toEqual(['ced_nome']);
    expect(descartadas.map((d) => d.campo)).toEqual(['nome', 'cpf_cnpj', 'email', 'concessionaria', 'telefone', 'imovel_matricula']);
    expect(descartadas.every((d) => d.nota === 'Não identifiquei de quem é este documento; dê um nome ao arquivo ou mova para o item da pessoa.')).toBe(true);
    expect(JSON.stringify(descartadas)).not.toMatch(/Antonio|529/);
  });
  it('limparSugestoes: valor inválido de campo permitido segue como baixa com nota; a nota do campo e a do documento acompanham', () => {
    const arquivos = [arq(1, 'documento_cedente')];
    const documentos = [doc(1, 'documento_cedente', 'documento_cedente', 'Documento ilegível na parte de baixo.')];
    const { sugestoes } = limparSugestoes(lista(
      c('ced_cpf_cnpj', '111.111.111-11', 1), c('ced_nome', 'Antonio', 1), c('ced_profissao', 'pedreiro', 1, 'media', 'Escrito à mão.'),
    ), { arquivos, documentos });
    expect(sugestoes.ced_cpf_cnpj).toEqual({ valor: '111.111.111-11', slot: 'documento_cedente', confianca: 'baixa', nota: 'Dígito do CPF não confere.' });
    expect(sugestoes.ced_nome).toEqual({ valor: 'Antonio', slot: 'documento_cedente', confianca: 'alta', nota: 'Documento ilegível na parte de baixo.' });
    expect(sugestoes.ced_profissao.nota).toBe('Escrito à mão.');   // a nota do campo vem antes da do documento
  });
  it('limparSugestoes: campo sem `indice` válido é DESCARTADO, qualquer que seja o campo; sem contexto, tudo é descartado', () => {
    const arquivos = [arq(1, 'documento_titular')];
    const a = limparSugestoes(lista(c('ced_nome', 'A', 7), c('nome', 'B', 0), c('email', 'a@b.com', 1.5), c('cidade', 'X', -1), c('uf', 'MG', 1)), { arquivos, documentos: [] });
    expect(Object.keys(a.sugestoes)).toEqual(['uf']);
    expect(a.descartadas.map((d) => d.campo)).toEqual(['ced_nome', 'nome', 'email', 'cidade']);
    expect(a.descartadas.every((d) => d.slot === '' && d.nota === 'Não deu para saber de qual documento veio este dado.')).toBe(true);
    expect(limparSugestoes(lista(c('nome', 'B', 1))).sugestoes).toEqual({});
  });
  it('limparSugestoes: o mesmo campo duas vezes fica com o de maior confiança (empate, o primeiro) e leva nota; o descartado não disputa', () => {
    const arquivos = [arq(1, 'documento_titular'), arq(2, 'documento_cedente')];
    const { sugestoes } = limparSugestoes(lista(
      c('email', 'a@b.com', 1, 'baixa'), c('email', 'b@b.com', 1, 'alta'),          // alta vence
      c('telefone', '34999990000', 1, 'media'), c('telefone', '34988880000', 1, 'media'),   // empate: o primeiro
      c('nome', 'Carlos', 1, 'baixa'), c('nome', 'Antonio', 2, 'alta'),             // o de alta confiança é da CNH do cedente e sai: fica o do comprador
      c('rg_ie', '12345', 1, 'media'),
    ), { arquivos, documentos: [] });
    expect(sugestoes.email).toMatchObject({ valor: 'b@b.com', confianca: 'alta' });
    expect(sugestoes.email.nota).toContain('mais de uma vez');
    expect(sugestoes.telefone.valor).toBe('34999990000');
    expect(sugestoes.nome).toMatchObject({ valor: 'Carlos', confianca: 'baixa' });
    expect(sugestoes.rg_ie.nota).toBeUndefined();   // sem repetição, sem nota
  });
  it('limparSugestoes: conflito entre o item e o conteúdo descarta tudo do arquivo; conta da geradora e da instalação respeitam os papéis', () => {
    const arquivos = [arq(1, 'documento_titular'), arq(2, 'conta_luz'), arq(3, 'conta_luz_geradora'), arq(4, 'conta_luz')];
    const documentos = [
      doc(1, 'documento_titular', 'documento_cedente'), doc(2, 'conta_luz', 'conta_luz'), doc(3, 'conta_luz_geradora', 'conta_luz_geradora'),
      doc(4, 'conta_luz', 'conta_luz_geradora'),   // a pessoa pôs a conta da usina no item da instalação
    ];
    const { sugestoes, descartadas } = limparSugestoes(lista(
      c('nome', 'Antonio', 1), c('ced_nome', 'Antonio', 1),
      c('concessionaria', 'Cemig', 2), c('titular_conta', 'Antonio Pereira', 2),
      c('cep', '38400100', 2), c('ced_endereco', 'Rua A 1', 2),                       // da conta da instalação: campo de pessoa sai
      c('unidade_consumidora', '0012345678', 3), c('endereco_ponto', 'Fazenda, Araguari MG', 3),
      c('unidade_consumidora', '0099999999', 4),                                      // conflito (item da instalação, conteúdo da geradora)
    ), { arquivos, documentos });
    expect(Object.keys(sugestoes).sort()).toEqual(['concessionaria', 'titular_conta']);
    expect(descartadas.map((d) => d.campo)).toEqual(['nome', 'ced_nome', 'cep', 'ced_endereco', 'unidade_consumidora', 'endereco_ponto', 'unidade_consumidora']);
    expect(descartadas[0].nota).toContain('diferentes');
    expect(descartadas[6].nota).toContain('diferentes');
  });

  it('limparDocumentos: as chaves novas do catálogo valem como tipo; nota limpa; o resto vira "outro"', () => {
    const lidos = [arq(1, 'outros'), arq(2, 'outros'), arq(3, 'outros')];
    const d = limparDocumentos({ documentos: [
      { indice: 1, tipo: 'documento_cedente', rotulo: 'CNH do cedente', nota: '  O nome não é o do comprador.  ' },
      { indice: 2, tipo: 'conta_luz_beneficiaria', rotulo: 'Conta que recebe o excedente', nota: 'CPF 52998224724 do titular' },
      { indice: 3, tipo: 'tipo_inventado', rotulo: 'Qualquer', nota: 12 },
    ] }, lidos);
    expect(d.map((x) => x.tipo)).toEqual(['documento_cedente', 'conta_luz_beneficiaria', 'outro']);
    expect(d.map((x) => x.nota)).toEqual(['O nome não é o do comprador.', '', '']);
  });
  it('rótulo da IA com nome de pessoa conhecida é descartado; palavra comum de empresa não conta', () => {
    expect(rotuloSemNome('CNH Antonio Pereira', ['Antonio Pereira'])).toBe('');
    expect(rotuloSemNome('Comprovante de Bruno', ['Carlos Alves', 'Bruno Lima'])).toBe('');
    expect(rotuloSemNome('CNH do cedente', ['Antonio Pereira'])).toBe('CNH do cedente');
    expect(rotuloSemNome('Conta de luz da geradora', ['Energia Solar Ltda'])).toBe('Conta de luz da geradora');
    expect(rotuloSemNome('Matrícula do imóvel', [])).toBe('Matrícula do imóvel');
    expect(rotuloSemNome('', ['Antonio'])).toBe('');
  });
  it('notaDaIa: texto curto, sem travessão, sem controle, sem número de documento', () => {
    expect(notaDaIa('  parece a conta da usina — não a do ponto ')).toBe('Parece a conta da usina - não a do ponto');
    expect(notaDaIa('a'.repeat(400)).length).toBeLessThanOrEqual(150);
    expect(notaDaIa('CPF 529.982.247-24')).toBe('');
    expect(notaDaIa(undefined)).toBe('');
    expect(notaDaIa('linha 1\nlinha 2')).toBe('Linha 1 linha 2');
  });
});
