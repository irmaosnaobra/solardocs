// OS TEXTOS DA LISTA DE INTERESSE DO INSTAGRAM (solardoc.app/io/interesse, 19/11/2026). PURO: sem banco, sem rede.
//   · a observação do card solar MUDO (1ª linha `${MARCA_SAIU} · MUDO · LIGAÇÃO`, 2ª `Onde: <tipo>`, condição 1 do chefe anti-ban);
//   · a observação do card de eletroposto (origem lista_ig_eletroposto);
//   · o aviso à Nilce, o aviso a Thiago e Diego e o resumo de quem ficou sem aviso.
// Regras de escrita da casa: frase com maiúscula, sem travessão, sem emoji. Campo vindo da internet passa por `limpo`
// (sem quebra de linha, sem formatação do WhatsApp, sem link, cortado). Nenhum aviso diz que o cliente foi avisado: ninguém o avisou.

import { MARCA_SAIU } from '../agenda/solarRota';

export const SOLAR_ROTULOS: Record<string, Record<string, string>> = {
  tipo: { casa: 'Casa', empresa: 'Empresa', rural: 'Rural' },
  conta: {
    ate300: 'Até R$ 300', '300_600': 'R$ 300 a 600', '600_1050': 'R$ 600 a 1.050',
    '1050_2000': 'R$ 1.050 a 2.000', '2000_5000': 'R$ 2.000 a 5.000', '5000_mais': 'Mais de R$ 5.000',
  },
  pagamento: { vista: 'À vista', financiamento: 'Financiamento', cartao: 'Cartão em até 21x', naosei: 'Ainda não sabe' },
};

export const CAMINHO_ROTULO: Record<string, string> = {
  cotista: 'Cotista', investidor: 'Investidor', arrendamento: 'Arrendamento',
  chave_na_mao: 'Chave na mão', parceiro: 'Parceiro instalador', so_carregador: 'Só o carregador',
};

const RECURSO_EP = { proprio: 'Recurso próprio', proprio_credito: 'Próprio mais financiamento', financiamento: 'Financiamento', naosei: 'Ainda não sabe' };
const CAPITAL = {
  50: 'R$ 50 mil', 70: 'R$ 70 mil', 100: 'R$ 100 mil', 140: 'R$ 140 mil', 280: 'R$ 280 mil', 500: 'R$ 500 mil',
  '500_mais': 'Mais de R$ 500 mil', naosei: 'Ainda não sabe',
} as Record<string, string>;
const COTA: Array<[string, string, Record<string, string>]> = [
  ['local', 'Local', { meu: 'Tem um local dele ou que administra', em_vista: 'Tem um lugar em vista', nao: 'Não tem local' }],
  ['capital', 'Quanto pretende investir', CAPITAL],
  ['recurso', 'Como pretende investir', RECURSO_EP],
];
/** Por caminho: [chave, rótulo, valores]. Os mesmos slugs da página e da lista NEXUS. */
export const PERGUNTAS_EP_ROTULO: Record<string, Array<[string, string, Record<string, string>]>> = {
  cotista: COTA,
  investidor: COTA,
  arrendamento: [
    ['ponto_tipo', 'Tipo de local', {
      posto: 'Posto de combustível', mercado: 'Mercado ou atacarejo', restaurante: 'Restaurante', academia: 'Academia',
      farmacia: 'Farmácia', hotel: 'Hotel ou pousada', estacionamento: 'Estacionamento', condominio: 'Condomínio', outro: 'Outro',
    }],
    ['relacao', 'Relação com o local', { proprietario: 'É o dono', administro: 'Administra', represento: 'Representa o dono', inquilino: 'É inquilino' }],
    ['vagas', 'Vagas', { '1_2': '1 ou 2', '3_5': '3 a 5', '6_10': '6 a 10', '10_mais': 'Mais de 10' }],
  ],
  chave_na_mao: [
    ['ponto', 'Local', { definido: 'Já está definido', negociando: 'Negociando', em_vista: 'Tem um em vista', sem_ideia: 'Ainda não tem' }],
    ['valor', 'Quanto pretende investir', CAPITAL],
    ['recurso', 'Como pretende investir', RECURSO_EP],
  ],
  parceiro: [
    ['atuacao', 'O que faz', {
      integrador_solar: 'Integrador solar', eletricista: 'Eletricista ou instalador', engenheiro: 'Engenheiro eletricista',
      empresa_instalacao: 'Empresa de instalação ou construtora', vendedor: 'Vendedor ou representante técnico', nao_atuo: 'Ainda não atua na área',
    }],
    ['experiencia', 'Já instalou carregador', { nunca: 'Nunca', '1_3': '1 a 3', mais_3: 'Mais de 3', certificado: 'Certificado por fabricante' }],
    ['interesse', 'Como quer trabalhar', {
      vender: 'Vende e a gente executa', executar: 'Executa a obra na região', vender_executar: 'Vende e executa',
      comprar_equipamento: 'Compra o equipamento e faz por conta', naosei: 'Ainda não sabe',
    }],
  ],
  so_carregador: [
    ['potencia', 'Potência', { 80: '80 kW', 120: '120 kW', outra: 'Outra ou não sabe' }],
    ['qtd', 'Unidades', { 1: '1', '2_5': '2 a 5', '6_10': '6 a 10', mais_10: 'Mais de 10' }],
    ['instala', 'Quem instala', {
      voces_montam: 'A gente instala', obra_minha_projeto_voces: 'Ele faz a obra, a gente o projeto',
      obra_e_projeto_meus: 'Obra e projeto por conta dele', eu_monto: 'Ele mesmo monta', nao_sei: 'Ainda não sabe',
    }],
  ],
};

/** Campo de gente: sem quebra de linha, sem formatação do WhatsApp, sem link, sem travessão, cortado. */
export function limpo(v: unknown, max = 80): string {
  const t = String(v ?? '')
    .replace(/https?:\/\/\S*/gi, ' ')
    .replace(/[\r\n\t*_~`]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(t).slice(0, max).join('').trim();
}

export const LINHA_ORIGEM = 'Veio da lista de interesse do Instagram';
export const linkDoCard = (id: number): string => `https://solardoc.app/gerador/agenda?ag=${id}&ver=1`;

export interface PessoaDaLista { nome: string; telefone: string; email: string; cidade: string; uf: string }
const cidadeUf = (p: PessoaDaLista): string => [limpo(p.cidade, 60), limpo(p.uf, 2)].filter(Boolean).join('-');

/** As respostas do eletroposto em linhas `Rótulo: valor` (resposta fora da lista some). */
export function linhasDoEletroposto(caminho: string, respostas: Record<string, string>): string[] {
  const out = (PERGUNTAS_EP_ROTULO[caminho] ?? [])
    .map(([k, rot, vals]) => (vals[respostas[k]] ? `${rot}: ${vals[respostas[k]]}` : ''))
    .filter(Boolean);
  if (caminho === 'parceiro' && limpo(respostas.empresa)) out.push(`Empresa: ${limpo(respostas.empresa)}`);
  return out;
}

/** O card solar MUDO pela marca: a 1ª linha cala a régua (bom dia, "oi" de 5 min e a Giovanna no NÃO ATENDEU). */
export function observacaoSolar(p: PessoaDaLista, r: Record<string, string>): string {
  return [
    `${MARCA_SAIU} · MUDO · LIGAÇÃO`,
    `Onde: ${SOLAR_ROTULOS.tipo[r.tipo] ?? 'Imóvel'}`,
    `Conta de luz: ${SOLAR_ROTULOS.conta[r.conta] ?? 'Não informada'}`,
    `Pagamento: ${SOLAR_ROTULOS.pagamento[r.pagamento] ?? 'Não informado'}`,
    `Cidade: ${cidadeUf(p)}`,
    `E-mail: ${limpo(p.email, 120)}`,
    LINHA_ORIGEM,
    'Ninguém mandou mensagem ao cliente: quem chama é a equipe.',
  ].join('\n');
}

export function observacaoEletroposto(p: PessoaDaLista, caminho: string, respostas: Record<string, string>): string {
  return [
    `LISTA INSTAGRAM · ELETROPOSTO · ${(CAMINHO_ROTULO[caminho] ?? 'Eletroposto').toUpperCase()}`,
    ...linhasDoEletroposto(caminho, respostas),
    `Cidade: ${cidadeUf(p)}`,
    `E-mail: ${limpo(p.email, 120)}`,
    LINHA_ORIGEM,
    'Ninguém mandou mensagem ao cliente: quem chama é a equipe.',
  ].join('\n');
}

const quandoBonito = (iso: string): string => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function avisoNilce(p: PessoaDaLista, r: Record<string, string>, card: { id: number; quando: string }): string {
  return [
    '*LISTA DO INSTAGRAM · ENERGIA SOLAR*',
    '',
    `*Cliente:* ${limpo(p.nome) || 'Sem nome'}`,
    `*WhatsApp:* wa.me/${String(p.telefone).replace(/\D/g, '').slice(0, 13)}`,
    `*Cidade:* ${cidadeUf(p)}`,
    `*Onde:* ${SOLAR_ROTULOS.tipo[r.tipo] ?? 'Imóvel'}`,
    `*Conta de luz:* ${SOLAR_ROTULOS.conta[r.conta] ?? 'Não informada'}`,
    `*Pagamento:* ${SOLAR_ROTULOS.pagamento[r.pagamento] ?? 'Não informado'}`,
    `*Ligação na agenda:* ${quandoBonito(card.quando)}`,
    '',
    'Ninguém mandou mensagem a ele. Quem chama é você.',
    `Card: ${linkDoCard(card.id)}`,
  ].join('\n');
}

export function avisoEletroposto(
  p: PessoaDaLista, caminho: string, respostas: Record<string, string>, card: { id: number; quando: string; dono: string },
): string {
  return [
    `*LISTA DO INSTAGRAM · ELETROPOSTO · ${(CAMINHO_ROTULO[caminho] ?? 'Eletroposto').toUpperCase()}*`,
    '',
    `*Cliente:* ${limpo(p.nome) || 'Sem nome'}`,
    `*WhatsApp:* wa.me/${String(p.telefone).replace(/\D/g, '').slice(0, 13)}`,
    `*Cidade:* ${cidadeUf(p)}`,
    ...linhasDoEletroposto(caminho, respostas).map(l => `*${l.replace(': ', ':* ')}`),
    `*Card com:* ${limpo(card.dono, 20)}, ${quandoBonito(card.quando)}`,
    '',
    'Ninguém mandou mensagem a ele. O dono do card chama.',
    `Card: ${linkDoCard(card.id)}`,
  ].join('\n');
}

export interface ItemDoResumo { nome: string; cidade: string; porta: 'solar' | 'eletroposto' }
export const MAX_NO_RESUMO = 15;

/** Uma mensagem por pessoa com quem entrou na agenda dela sem aviso (teto ou fora da janela). */
export function textoDoResumo(itens: ItemDoResumo[]): string {
  const vis = itens.slice(0, MAX_NO_RESUMO);
  const resto = itens.length - vis.length;
  return [
    '*LISTA DO INSTAGRAM · QUEM FICOU SEM AVISO*',
    '',
    `${itens.length === 1 ? 'Esta pessoa entrou' : `Estas ${itens.length} pessoas entraram`} na agenda pela lista do Instagram e ninguém mandou mensagem a ela${itens.length === 1 ? '' : 's'}:`,
    ...vis.map((i, n) => `${n + 1}. ${limpo(i.nome, 60) || 'Sem nome'}, ${limpo(i.cidade, 60) || 'cidade não informada'} (${i.porta === 'solar' ? 'Energia solar' : 'Eletroposto'})`),
    ...(resto > 0 ? [`E mais ${resto}.`] : []),
    '',
    'Os cards estão no CRM: solardoc.app/gerador',
  ].join('\n');
}

/** A pessoa já tinha card parado e voltou pela lista: não nasceu card novo, o aviso aponta para o que existe. */
export function avisoVoltou(p: PessoaDaLista, porta: 'solar' | 'eletroposto', linhas: string[], card: { id: number; dono: string }): string {
  return [
    `*LISTA DO INSTAGRAM · VOLTOU · ${porta === 'solar' ? 'ENERGIA SOLAR' : 'ELETROPOSTO'}*`,
    '',
    `${limpo(p.nome) || 'Sem nome'} voltou pela lista do Instagram e já tem card${limpo(card.dono, 20) ? ` com ${limpo(card.dono, 20)}` : ''}.`,
    `*WhatsApp:* wa.me/${String(p.telefone).replace(/\D/g, '').slice(0, 13)}`,
    `*Cidade:* ${cidadeUf(p)}`,
    ...linhas.map(l => `*${l.replace(': ', ':* ')}`),
    '',
    'Ninguém mandou mensagem a ele. Card novo não nasceu.',
    `Card: ${linkDoCard(card.id)}`,
  ].join('\n');
}

export const linhasDoSolar = (r: Record<string, string>): string[] => [
  `Onde: ${SOLAR_ROTULOS.tipo[r.tipo] ?? 'Imóvel'}`,
  `Conta de luz: ${SOLAR_ROTULOS.conta[r.conta] ?? 'Não informada'}`,
  `Pagamento: ${SOLAR_ROTULOS.pagamento[r.pagamento] ?? 'Não informado'}`,
];
