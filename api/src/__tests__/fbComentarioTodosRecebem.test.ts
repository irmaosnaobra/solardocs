import { describe, it, expect } from 'vitest';
import { decidirComentario } from '../services/instagram/igEngine';

// ── O que este teste protege ────────────────────────────────────────────────
// 17/09/2026. O dono mandou o print de um anúncio no Facebook com sete
// comentários e nenhuma resposta: "muitos anúncios não estão sendo respondidos
// e estamos perdendo lead".
//
// Duas causas, e a segunda é esta. A primeira era o transporte (private_replies
// morto, ver fbComentarios.ts). A segunda era a régua: em anúncio, o comentário
// precisava casar com uma lista de palavras pra virar atendimento, e o lead
// mais quente do print não casava com nenhuma delas.
//
// Os textos abaixo são REAIS, copiados do print e da API da Meta.

const REDE: any = { id: 'rede', nome: 'Interesse geral', fallback: true, gatilhos: { comment: true }, ativo: true };
const PRODUTO: any = {
  id: 'eletro', nome: 'Eletroposto', ativo: true, prioridade: 30,
  gatilhos: { comment: true }, palavras_chave: ['eletroposto', 'carregador'], match_tipo: 'contem',
};
const AUTOS = [PRODUTO, REDE];

const emAnuncio = (texto: string) => decidirComentario(AUTOS, { texto, ehAnuncio: true });
const emOrganico = (texto: string) => decidirComentario(AUTOS, { texto, ehAnuncio: false });

describe('anúncio: todo comentário recebe DM', () => {
  // Os sete do print, na ordem em que aparecem.
  const DO_PRINT = [
    'Outros dizem que ter fotovoltaico não influencia em nada para carregar',
    'Bom dia. Tenho interesse',
    'Aqui tem o ponto. Aluguel. E como faço para ter viabilidade?',
    'tenho um parceiro ai em Uberlândia vou ver se é isso mesmo',
    'Aqui em Natal Rn BRAZIL tenho o ponto comercial Galpao predio',
    'Tenho interesse',
    'Cara isso não acontece em Curitiba',
  ];

  it('os sete do print recebem alguma automação, nenhum fica órfão', () => {
    const orfaos = DO_PRINT.filter(t => emAnuncio(t) === null);
    expect(orfaos).toEqual([]);
  });

  it('"Aqui tem o ponto. Aluguel. E como faço para ter viabilidade?" era o mais quente e ficava sem nada', () => {
    expect(emAnuncio('Aqui tem o ponto. Aluguel. E como faço para ter viabilidade?')).toBe(REDE);
  });

  it('comentário sem nenhuma palavra de interesse também entra', () => {
    expect(emAnuncio('Cara isso não acontece em Curitiba')).toBe(REDE);
    expect(emAnuncio('kkkkkk')).toBe(REDE);
  });

  // Reais, colhidos da API da Meta em 17/09 nos posts de anúncio da Página.
  it('os que estavam esperando na API também entram', () => {
    for (const t of ['Qual o contato de vcs???', 'Ela tem modo de cobrança?', 'Interessante',
                     'Quanto custa ?', 'Tenho espaço em porto seguro Bahia pra placas solares']) {
      expect(emAnuncio(t), t).not.toBeNull();
    }
  });

  it('quando o texto diz o produto, quem responde é o produto, não a rede', () => {
    expect(emAnuncio('quero um carregador no meu posto')).toBe(PRODUTO);
  });
});

describe('orgânico continua na régua apertada', () => {
  it('piada e discussão de reel viral não recebem DM de venda', () => {
    expect(emOrganico('Acaba com a amazônia imediatamente kkkkkkkk')).toBeNull();
    expect(emOrganico('Cara isso não acontece em Curitiba')).toBeNull();
    expect(emOrganico('Outros dizem que ter fotovoltaico não influencia em nada')).toBeNull();
  });

  it('quem pede preço ou contato no orgânico continua entrando', () => {
    expect(emOrganico('Tenho interesse')).toBe(REDE);
    expect(emOrganico('quanto custa?')).toBe(REDE);
    expect(emOrganico('me chama no whats')).toBe(REDE);
  });

  it('telefone no comentário entra mesmo sem palavra de interesse', () => {
    expect(emOrganico('Bom dia 91992872104')).toBe(REDE);
  });

  it('a mesma frase muda de destino conforme seja anúncio ou orgânico', () => {
    const t = 'tenho um parceiro ai em Uberlândia vou ver se é isso mesmo';
    expect(emAnuncio(t)).toBe(REDE);
    expect(emOrganico(t)).toBeNull();
  });
});
