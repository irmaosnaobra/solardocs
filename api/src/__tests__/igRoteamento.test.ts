import { describe, it, expect, vi } from 'vitest';

// decidirComentario é pura, mas o módulo importa supabase/CRM no topo.
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: vi.fn() } }));
vi.mock('../services/agenda/manychatLeadService', () => ({ ingestManychatLead: vi.fn() }));

import { decidirComentario } from '../services/instagram/igEngine';

// Espelho das automações reais (projeto GERADOR, tabela ig_automations).
const gat = { comment: true, story: true, dm: true };
const soComentario = { comment: true, story: false, dm: false };
const base = { ativo: true, match_tipo: 'contem', post_id: null, midias: [], fallback: false,
  respostas_publicas: [], dm_boas_vindas: null, botao_rotulo: null, link_url: null,
  lembrete_texto: null, lembrete_horas: 24 };

// IDs reais dos criativos que já rodaram (legendas conferidas na Graph API).
const AD_ELETRO_A = '18237694144312091';   // "Sua vaga parada não paga conta nenhuma"
const AD_ELETRO_B = '18018599066908998';   // mesmo criativo, outro anúncio
const AD_KIT      = '17892818568595320';   // "Especialista Solar, dificuldade nas vendas?"
const AD_SOLAR    = '18089094848647783';   // "10 placas 620W + inversor por R$ 12.998"
const REEL_BIKE   = '18110430728286770';   // "BIKE KONNAN – PRONTA ENTREGA"

const AUTOS: any[] = [
  // ── fixadas em mídia (prioridade 5) — só gatilho comentário, porque
  // handleMessage chama escolher() sem mídia e descartaria estas linhas.
  { ...base, id: 'ad-eletro', nome: 'Anúncio Eletroposto', prioridade: 5, produto: 'eletroposto',
    gatilhos: soComentario, palavras_chave: [], match_tipo: 'qualquer',
    midias: [AD_ELETRO_A, AD_ELETRO_B] },
  { ...base, id: 'ad-kit', nome: 'Anúncio Kit', prioridade: 5, produto: 'kit',
    gatilhos: soComentario, palavras_chave: [], match_tipo: 'qualquer', midias: [AD_KIT] },
  { ...base, id: 'ad-solar', nome: 'Anúncio Solar', prioridade: 5, produto: 'solar',
    gatilhos: soComentario, palavras_chave: [], match_tipo: 'qualquer', midias: [AD_SOLAR] },
  { ...base, id: 'reel-bike', nome: 'Reel Bike', prioridade: 5, produto: 'bike',
    gatilhos: soComentario, midias: [REEL_BIKE],
    palavras_chave: ['quero', 'eu quero', 'tenho interesse', 'interesse', 'quanto custa',
      'preco', 'valor', 'bike', 'bicicleta', 'konnan'] },

  // ── por palavra (valem em qualquer post, e no DM/story)
  { ...base, id: 'kit', nome: 'Kit de Fechamento', prioridade: 10, produto: 'kit', gatilhos: gat,
    palavras_chave: ['fechamento'] },
  { ...base, id: 'indic', nome: 'Indicação', prioridade: 20, produto: 'solar', gatilhos: gat,
    palavras_chave: ['indicar', 'indicacao', 'indicação', 'indico', 'indiquei', 'quero indicar', 'renda extra'] },
  { ...base, id: 'eletro', nome: 'Eletroposto', prioridade: 30, produto: 'eletroposto', gatilhos: gat,
    palavras_chave: ['eletroposto', 'carregador', 'recarga', 'carro eletrico', 'ponto de recarga', 'investir', 'investimento', 'aporte', 'retorno'] },
  { ...base, id: 'solar', nome: 'Solar', prioridade: 40, produto: 'solar', gatilhos: gat,
    palavras_chave: ['solar', 'energia solar', 'simulacao', 'economia', 'economizar', 'conta de luz', 'energia', 'placa', 'placas', 'painel'] },
  { ...base, id: 'bike', nome: 'Bike Konnan', prioridade: 50, produto: 'bike', gatilhos: gat,
    palavras_chave: ['bike', 'bicicleta', 'konnan', 'magrinha'] },
  { ...base, id: 'menu', nome: 'Menu — interesse sem produto', prioridade: 800, produto: 'solar',
    gatilhos: gat,
    palavras_chave: ['quero', 'eu quero', 'tenho interesse', 'quanto custa', 'orcamento',
      'preco', 'valor', 'informacoes', 'como funciona', 'quero saber', 'saber mais', 'me chama'] },
  { ...base, id: 'fallback', nome: 'Interesse geral', prioridade: 900, produto: 'solar', fallback: true,
    gatilhos: soComentario, palavras_chave: [], match_tipo: 'qualquer' },
];

const emAnuncio = (texto: string) => decidirComentario(AUTOS, { texto, mediaId: 'm1', adId: 'a1', ehAnuncio: true });
const organico = (texto: string) => decidirComentario(AUTOS, { texto, mediaId: 'm2', ehAnuncio: false });
const noPost = (texto: string, mediaId: string, ehAnuncio = true) =>
  decidirComentario(AUTOS, { texto, mediaId, ehAnuncio });

describe('roteamento de comentário do Instagram', () => {
  it('palavra-chave direta cai na automação certa', () => {
    // caso real: @clelianunes_ comentou "Solar" e a DM tinha que ser a de solar
    expect(emAnuncio('Solar')?.id).toBe('solar');
    expect(emAnuncio('quero saber do eletroposto')?.id).toBe('eletro');
  });

  it('prioridade desempata quando duas automações casam', () => {
    // "quero" agora é do Menu (800) — perde pra qualquer produto
    expect(emAnuncio('quero o fechamento')?.id).toBe('kit');
    expect(emAnuncio('quero investir')?.id).toBe('eletro');
    expect(emAnuncio('quero energia solar')?.id).toBe('solar');
  });

  it('Bike não rouba mais quem pergunta preço em anúncio de solar', () => {
    // 'valor' e 'quanto' eram palavras-chave da Bike
    expect(emAnuncio('quanto custa pra instalar?')?.id).toBe('menu');
    expect(emAnuncio('qual o valor?')?.id).toBe('menu');
    // mas quem fala de bike continua indo pra bike
    expect(emAnuncio('quanto custa a bike?')?.id).toBe('bike');
  });

  it('ignora acento e caixa alta', () => {
    expect(emAnuncio('ORÇAMENTO')?.id).toBe('menu');
    expect(emAnuncio('quero um orcamento')?.id).toBe('menu');
    expect(emAnuncio('ENERGIA SOLAR')?.id).toBe('solar');
  });

  it('comentário de anúncio com interesse sem palavra-chave cai na rede de segurança', () => {
    // casos reais que ficaram sem resposta nenhuma
    expect(emAnuncio('Tenho interesse')?.id).toBe('menu');
    expect(emAnuncio('Pagando à vista tem desconto?')?.id).toBe('fallback');
    expect(emAnuncio('Interessante')?.id).toBe('fallback');
  });

  it('telefone no comentário sempre aciona atendimento, até fora de anúncio', () => {
    expect(emAnuncio('Tenho interesse 99977-0149 José Alves')?.id).toBe('menu');
    expect(organico('me chama 34 99977-0149')?.id).toBe('menu');
    expect(organico('34 99977-0149')?.id).toBe('fallback');
  });

  it('piada e post orgânico não recebem DM', () => {
    expect(emAnuncio('Eu escolho Neymar  3 vezes')).toBeNull();
    expect(organico('😂')).toBeNull();
    expect(organico('Padrinho mentiroso não dá, xau Marçal.')).toBeNull();
    // sem sinal de interesse, anúncio também não vira DM
    expect(emAnuncio('kkkkk')).toBeNull();
  });

  it('post orgânico com pedido claro entra na rede de segurança', () => {
    // 05/08: as regras da Meta (que respondiam comentário no orgânico também)
    // foram desligadas — quem pede preço ou contato num reel não pode ficar
    // órfão só porque o post não é anúncio.
    expect(organico('Quanto custa?')?.id).toBe('menu');        // casa palavra-chave: melhor ainda
    expect(organico('Me passa o zap')?.id).toBe('fallback');
    expect(organico('Vocês instalam aqui?')?.id).toBe('fallback');
  });

  it('no orgânico a régua é mais dura que no anúncio', () => {
    // "quanto tempo demorou" não é orçamento; em anúncio 'quanto' basta, aqui não.
    expect(organico('Quanto tempo demorou pra ficar pronto?')).toBeNull();
    expect(emAnuncio('Quanto tempo demorou pra ficar pronto?')?.id).toBe('fallback');
    expect(organico('Manda mais vídeo assim')).toBeNull();
    expect(organico('Que trabalho lindo, parabéns!')).toBeNull();
  });

  it('automação fixada numa mídia ganha de todas', () => {
    const fixada = { ...base, id: 'campanha', nome: 'Campanha X', prioridade: 500, produto: 'solar',
      gatilhos: soComentario, palavras_chave: [], match_tipo: 'qualquer', midias: ['m9'] };
    const autos = [...AUTOS, fixada];
    expect(decidirComentario(autos, { texto: 'Solar', mediaId: 'm9', ehAnuncio: true })?.id).toBe('campanha');
    // e não vaza pra outros posts
    expect(decidirComentario(autos, { texto: 'Solar', mediaId: 'm1', ehAnuncio: true })?.id).toBe('solar');
  });

  // ── o motivo desta migração ────────────────────────────────────────────────
  it('"Quero" recebe o produto DO POST, não o produto da palavra', () => {
    // Casos reais de 01/08/2026: @paulacccampos e @zenaldogas comentaram "Quero"
    // no anúncio de eletroposto e receberam a DM de SIMULAÇÃO SOLAR.
    expect(noPost('Quero', AD_ELETRO_A)?.produto).toBe('eletroposto');
    expect(noPost('Quero', AD_ELETRO_B)?.produto).toBe('eletroposto');
    // @thiagomachado.mg comentou "Eu quero" no reel da bike — idem.
    expect(noPost('Eu quero', REEL_BIKE, false)?.produto).toBe('bike');
    // e nos outros criativos
    expect(noPost('Quero', AD_KIT)?.produto).toBe('kit');
    expect(noPost('Quero', AD_SOLAR)?.produto).toBe('solar');
  });

  it('em post fixado, o post ganha até de palavra-chave de outro produto', () => {
    // legenda do anúncio pede "Digita Eletroposto", mas mesmo quem escreve
    // "solar" ali dentro está falando do eletroposto
    expect(noPost('vale mais que solar?', AD_ELETRO_A)?.produto).toBe('eletroposto');
    expect(noPost('Payback é muito longo', AD_ELETRO_A)?.produto).toBe('eletroposto');
  });

  it('post fixado orgânico ainda filtra piada', () => {
    // o reel da bike usa match "contem": sem sinal de interesse, não vira DM
    expect(noPost('😂😂', REEL_BIKE, false)).toBeNull();
    expect(noPost('bonita demais', REEL_BIKE, false)).toBeNull();
    expect(noPost('quanto custa', REEL_BIKE, false)?.produto).toBe('bike');
  });

  it('"Quero" fora de post fixado vira menu, nunca solar por acidente', () => {
    expect(emAnuncio('Quero')?.id).toBe('menu');
    expect(organico('Quero')?.id).toBe('menu');
    expect(organico('Eu quero!')?.id).toBe('menu');
  });
});
