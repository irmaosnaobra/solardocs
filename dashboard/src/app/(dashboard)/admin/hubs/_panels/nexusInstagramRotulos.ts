// NEXUS INSTAGRAM v2 (19/11/2026): rótulos legíveis das respostas da lista.
// Os mesmos da página solardoc.app/nexus/interesse: slug muda só junto com o backend.
// Porta eletroposto: cada caminho tem 3 perguntas, gravadas em eletroposto_respostas
// como { <caminho>: { <chave>: <valor>, empresa? } }. Porta mobilidade: objetivo,
// investimento e recurso.
import type { Row } from './nexusInstagramDados';

export const CAMINHO: Record<string, string> = {
  cotista: 'Cotista', investidor: 'Investidor', arrendamento: 'Arrendamento',
  chave_na_mao: 'Chave na mão', parceiro: 'Parceiro instalador', so_carregador: 'Só o carregador',
};
export const MOB: Record<string, string> = {
  carro_compacto: 'Carro compacto', carro_suv: 'SUV', carro_sedan: 'Sedã', picape: 'Picape',
  van: 'Van e utilitário', caminhao: 'Caminhão leve', moto: 'Moto', scooter: 'Scooter',
  bike: 'Bike elétrica', patinete: 'Patinete', triciclo: 'Triciclo e cargo', quadriciclo: 'Quadriciclo e UTV',
  golfe: 'Carrinho de golfe', wallbox: 'Carregador para casa', carregador_rapido: 'Carregador rápido',
  bateria: 'Baterias', solar: 'Energia solar',
};
export const OBJ: Record<string, string> = {
  proprio: 'Para uso próprio', frota: 'Empresa ou frota', revenda: 'Revenda', investir: 'Investir',
};
// ate_10 e 10_50 saíram da página em 19/11; ficam aqui só para ler cadastro antigo.
export const INV: Record<string, string> = {
  '50_100': 'R$ 50 a 100 mil', '100_250': 'R$ 100 a 250 mil', '250_500': 'R$ 250 a 500 mil',
  '500_mais': 'Acima de R$ 500 mil', naosei: 'Não sabe', ate_10: 'Até R$ 10 mil', '10_50': 'R$ 10 a 50 mil',
};
export const INV_ATUAIS = ['50_100', '100_250', '250_500', '500_mais', 'naosei'];
export const REC: Record<string, string> = {
  proprio: 'Recurso próprio', financiamento: 'Financiamento', os_dois: 'Os dois', naosei: 'Não sabe',
};

// c = rótulo curto (tabela, detalhe e CSV); o = valor -> texto
interface Pergunta { k: string; c: string; o: Record<string, string> }
const RECURSO_EP: Pergunta = { k: 'recurso', c: 'Como investir', o: {
  proprio: 'Recurso próprio', proprio_credito: 'Próprio mais financiamento', financiamento: 'Financiamento', naosei: 'Ainda não sei',
} };
const LOCAL: Pergunta = { k: 'local', c: 'Local', o: {
  meu: 'Tenho um local meu ou que eu administro', em_vista: 'Tenho um lugar em vista', nao: 'Não tenho local',
} };
const CAPITAL: Pergunta = { k: 'capital', c: 'Quanto investir', o: {
  50: 'R$ 50 mil', 70: 'R$ 70 mil', 100: 'R$ 100 mil', 140: 'R$ 140 mil', 280: 'R$ 280 mil',
  500: 'R$ 500 mil', '500_mais': 'Mais de R$ 500 mil', naosei: 'Ainda não sei',
} };

export const PERGUNTAS: Record<string, Pergunta[]> = {
  cotista: [LOCAL, CAPITAL, RECURSO_EP],
  investidor: [LOCAL, CAPITAL, RECURSO_EP],
  arrendamento: [
    { k: 'ponto_tipo', c: 'Tipo de local', o: {
      posto: 'Posto de combustível', mercado: 'Mercado ou atacarejo', restaurante: 'Restaurante', academia: 'Academia',
      farmacia: 'Farmácia', hotel: 'Hotel ou pousada', estacionamento: 'Estacionamento', condominio: 'Condomínio', outro: 'Outro',
    } },
    { k: 'relacao', c: 'O local é seu?', o: {
      proprietario: 'Sou o dono', administro: 'Eu administro', represento: 'Represento o dono', inquilino: 'Sou inquilino',
    } },
    { k: 'vagas', c: 'Vagas', o: { '1_2': '1 ou 2', '3_5': '3 a 5', '6_10': '6 a 10', '10_mais': 'Mais de 10' } },
  ],
  chave_na_mao: [
    { k: 'ponto', c: 'Local', o: {
      definido: 'Sim, já está definido', negociando: 'Estou negociando', em_vista: 'Tenho um em vista', sem_ideia: 'Ainda não',
    } },
    { k: 'valor', c: 'Quanto investir', o: {
      70: 'R$ 70 mil', 140: 'R$ 140 mil', 280: 'R$ 280 mil', 500: 'R$ 500 mil', '500_mais': 'Mais de R$ 500 mil', naosei: 'Ainda não sei',
    } },
    RECURSO_EP,
  ],
  parceiro: [
    { k: 'atuacao', c: 'O que faz', o: {
      integrador_solar: 'Integrador solar', eletricista: 'Eletricista ou instalador', engenheiro: 'Engenheiro eletricista',
      empresa_instalacao: 'Empresa de instalação ou construtora', vendedor: 'Vendedor ou representante técnico', nao_atuo: 'Ainda não atuo na área',
    } },
    { k: 'experiencia', c: 'Já instalou?', o: {
      nunca: 'Nunca instalei', '1_3': '1 a 3', mais_3: 'Mais de 3', certificado: 'Sou certificado por fabricante',
    } },
    { k: 'interesse', c: 'Como quer trabalhar', o: {
      vender: 'Vendo e a NEXUS executa', executar: 'Executo a obra na minha região', vender_executar: 'Vendo e executo',
      comprar_equipamento: 'Compro o equipamento e faço por conta', naosei: 'Ainda não sei',
    } },
  ],
  so_carregador: [
    { k: 'potencia', c: 'Potência', o: { 80: '80 kW', 120: '120 kW', outra: 'Outra ou não sei' } },
    { k: 'qtd', c: 'Unidades', o: { 1: '1', '2_5': '2 a 5', '6_10': '6 a 10', mais_10: 'Mais de 10' } },
    { k: 'instala', c: 'Quem instala', o: {
      voces_montam: 'A NEXUS instala', obra_minha_projeto_voces: 'Faço a obra, a NEXUS faz o projeto',
      obra_e_projeto_meus: 'Obra e projeto por minha conta', eu_monto: 'Eu mesmo monto', nao_sei: 'Ainda não sei',
    } },
  ],
};

/** "Vagas: 3 a 5", mas "O local é seu? Sou inquilino" (sem dois-pontos depois de pergunta). */
export const par = (c: string, v: string) => (c.endsWith('?') ? `${c} ${v}` : `${c}: ${v}`);

export interface RespostasCaminho { caminho: string; itens: [string, string][] }

/** As respostas do eletroposto em texto, uma entrada por caminho respondido. */
export function respostasDe(r: Row): RespostasCaminho[] {
  const todas = r.eletroposto_respostas && typeof r.eletroposto_respostas === 'object' ? r.eletroposto_respostas : {};
  return Object.keys(todas).flatMap((caminho) => {
    const resp = todas[caminho];
    if (!resp || typeof resp !== 'object') return [];
    const itens: [string, string][] = (PERGUNTAS[caminho] ?? [])
      .filter((p) => resp[p.k])
      .map((p) => [p.c, p.o[resp[p.k]] ?? resp[p.k]]);
    if (resp.empresa) itens.push(['Empresa', resp.empresa]);
    return itens.length ? [{ caminho, itens }] : [];
  });
}

/** "Tipo de local: Mercado; O local é seu?: Sou inquilino; Vagas: 3 a 5" (CSV). */
export function textoRespostas(r: Row): string {
  const lista = respostasDe(r);
  const um = (x: RespostasCaminho) => x.itens.map(([c, v]) => `${c}: ${v}`).join('; ');
  if (lista.length <= 1) return lista.map(um).join('');
  return lista.map((x) => `${CAMINHO[x.caminho] ?? x.caminho} (${um(x)})`).join(' | ');
}

// "Acima de R$ 100 mil" soma as duas portas.
const INV_ACIMA = new Set(['100_250', '250_500', '500_mais']);
const CAPITAL_ACIMA = new Set(['100', '140', '280', '500', '500_mais']);
const VALOR_ACIMA = new Set(['140', '280', '500', '500_mais']);
export function acima100(r: Row): boolean {
  if (r.investimento && INV_ACIMA.has(r.investimento)) return true;
  const resp = r.eletroposto_respostas ?? {};
  if (CAPITAL_ACIMA.has(resp.investidor?.capital ?? '') || CAPITAL_ACIMA.has(resp.cotista?.capital ?? '')) return true;
  return VALOR_ACIMA.has(resp.chave_na_mao?.valor ?? '');
}

// WhatsApp verificado no servidor: true confirmado, false sem WhatsApp, null não verificado.
export type Whats = 'ok' | 'sem' | 'nv';
export const WHATS: Record<Whats, string> = { ok: 'Confirmado', sem: 'Sem WhatsApp', nv: 'Não verificado' };
export function whatsDe(r: Row): Whats {
  return r.whatsapp_ok === true ? 'ok' : r.whatsapp_ok === false ? 'sem' : 'nv';
}
