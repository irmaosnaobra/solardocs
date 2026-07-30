import { describe, it, expect, vi } from 'vitest';

// decidirComentario é pura, mas o módulo importa supabase/CRM no topo.
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../services/agenda/manychatLeadService', () => ({ ingestManychatLead: vi.fn() }));

import { decidirComentario } from '../services/instagram/igEngine';

// Espelho das automações reais (projeto GERADOR, tabela ig_automations).
const gat = { comment: true, story: true, dm: true };
const base = { ativo: true, match_tipo: 'contem', post_id: null, midias: [], fallback: false,
  respostas_publicas: [], dm_boas_vindas: null, botao_rotulo: null, link_url: null,
  lembrete_texto: null, lembrete_horas: 24 };

const AUTOS: any[] = [
  { ...base, id: 'kit', nome: 'Kit de Fechamento', prioridade: 10, produto: 'kit', gatilhos: gat,
    palavras_chave: ['fechamento'] },
  { ...base, id: 'indic', nome: 'Indicação', prioridade: 20, produto: 'solar', gatilhos: gat,
    palavras_chave: ['indicar', 'indicacao', 'indicação', 'indico', 'indiquei', 'quero indicar', 'renda extra'] },
  { ...base, id: 'eletro', nome: 'Eletroposto', prioridade: 30, produto: 'eletroposto', gatilhos: gat,
    palavras_chave: ['eletroposto', 'carregador', 'recarga', 'carro eletrico', 'ponto de recarga', 'investir', 'investimento', 'aporte', 'retorno', 'posto'] },
  { ...base, id: 'solar', nome: 'Solar', prioridade: 40, produto: 'solar', gatilhos: gat,
    palavras_chave: ['solar', 'energia solar', 'simulacao', 'economia', 'economizar', 'conta de luz', 'energia', 'placa', 'placas', 'painel', 'quero', 'orcamento', 'preco'] },
  { ...base, id: 'bike', nome: 'Bike Konnan', prioridade: 50, produto: 'bike', gatilhos: gat,
    palavras_chave: ['bike', 'bicicleta', 'konnan', 'magrinha'] },
  { ...base, id: 'fallback', nome: 'Interesse geral', prioridade: 900, produto: 'solar', fallback: true,
    gatilhos: { comment: true, story: false, dm: false }, palavras_chave: [], match_tipo: 'qualquer' },
];

const emAnuncio = (texto: string) => decidirComentario(AUTOS, { texto, mediaId: 'm1', adId: 'a1', ehAnuncio: true });
const organico = (texto: string) => decidirComentario(AUTOS, { texto, mediaId: 'm2', ehAnuncio: false });

describe('roteamento de comentário do Instagram', () => {
  it('palavra-chave direta cai na automação certa', () => {
    // caso real: @clelianunes_ comentou "Solar" e a DM tinha que ser a de solar
    expect(emAnuncio('Solar')?.id).toBe('solar');
    expect(emAnuncio('quero saber do eletroposto')?.id).toBe('eletro');
  });

  it('prioridade desempata quando duas automações casam', () => {
    // "quero" é do Solar (40) e "fechamento" é do Kit (10) — antes vencia quem
    // viesse primeiro no banco, sem critério
    expect(emAnuncio('quero o fechamento')?.id).toBe('kit');
    // "quero" (Solar 40) x "investir" (Eletroposto 30)
    expect(emAnuncio('quero investir')?.id).toBe('eletro');
  });

  it('Bike não rouba mais quem pergunta preço em anúncio de solar', () => {
    // 'valor' e 'quanto' eram palavras-chave da Bike
    expect(emAnuncio('quanto custa pra instalar?')?.id).toBe('fallback');
    expect(emAnuncio('qual o valor?')?.id).toBe('fallback');
    // mas quem fala de bike continua indo pra bike
    expect(emAnuncio('quanto custa a bike?')?.id).toBe('bike');
  });

  it('ignora acento e caixa alta', () => {
    expect(emAnuncio('ORÇAMENTO')?.id).toBe('solar');
    expect(emAnuncio('quero um orcamento')?.id).toBe('solar');
  });

  it('comentário de anúncio com interesse sem palavra-chave cai na rede de segurança', () => {
    // casos reais que ficaram sem resposta nenhuma
    expect(emAnuncio('Tenho interesse')?.id).toBe('fallback');
    expect(emAnuncio('Pagando à vista tem desconto?')?.id).toBe('fallback');
    expect(emAnuncio('Interessante')?.id).toBe('fallback');
  });

  it('telefone no comentário sempre aciona atendimento, até fora de anúncio', () => {
    expect(emAnuncio('Tenho interesse 99977-0149 José Alves')?.id).toBe('fallback');
    expect(organico('me chama 34 99977-0149')?.id).toBe('fallback');
  });

  it('piada e post orgânico não recebem DM', () => {
    expect(emAnuncio('Eu escolho Neymar  3 vezes')).toBeNull();
    expect(organico('😂')).toBeNull();
    expect(organico('Padrinho mentiroso não dá, xau Marçal.')).toBeNull();
    // sem sinal de interesse, anúncio também não vira DM
    expect(emAnuncio('kkkkk')).toBeNull();
  });

  it('automação fixada numa mídia ganha de todas', () => {
    const fixada = { ...base, id: 'campanha', nome: 'Campanha X', prioridade: 500, produto: 'solar',
      gatilhos: gat, palavras_chave: [], match_tipo: 'qualquer', midias: ['m9'] };
    const autos = [...AUTOS, fixada];
    expect(decidirComentario(autos, { texto: 'Solar', mediaId: 'm9', ehAnuncio: true })?.id).toBe('campanha');
    // e não vaza pra outros posts
    expect(decidirComentario(autos, { texto: 'Solar', mediaId: 'm1', ehAnuncio: true })?.id).toBe('solar');
  });
});
