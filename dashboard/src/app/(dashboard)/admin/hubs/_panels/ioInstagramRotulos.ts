// IRMÃOS NA OBRA INSTAGRAM (19/11/2026): rótulos legíveis das respostas da lista
// solardoc.app/io/interesse. Os mesmos da página: slug muda só junto com o backend.
// Quatro portas: solar {tipo, conta, pagamento}, eletroposto (um caminho e três
// perguntas, em eletroposto_respostas = { <caminho>: { <chave>: <valor>, empresa? } }),
// integrador {atuacao, equipe, propostas} e mobilidade (itens, objetivo, investimento, recurso).
import type { Row } from './ioInstagramDados';

export type Porta = 'solar' | 'eletroposto' | 'integrador' | 'mobilidade';
export const PORTAS: Porta[] = ['solar', 'eletroposto', 'integrador', 'mobilidade'];
export const PORTA: Record<Porta, string> = {
  solar: 'Energia solar', eletroposto: 'Eletroposto', integrador: 'Integrador', mobilidade: 'Mobilidade elétrica',
};

// c = rótulo curto (tabela, detalhe e CSV); o = valor -> texto
export interface Pergunta { k: string; c: string; o: Record<string, string> }

export const PERG_SOLAR: Pergunta[] = [
  { k: 'tipo', c: 'Onde', o: { casa: 'Casa', empresa: 'Empresa', rural: 'Rural' } },
  { k: 'conta', c: 'Conta de luz', o: {
    ate300: 'Até R$ 300', '300_600': 'R$ 300 a 600', '600_1050': 'R$ 600 a 1.050',
    '1050_2000': 'R$ 1.050 a 2.000', '2000_5000': 'R$ 2.000 a 5.000', '5000_mais': 'Mais de R$ 5.000',
  } },
  { k: 'pagamento', c: 'Pagamento', o: {
    vista: 'À vista', financiamento: 'Financiamento', cartao: 'Cartão em até 21x', naosei: 'Ainda não sabe',
  } },
];
export const CONTA = PERG_SOLAR[1].o;

export const PERG_INT: Pergunta[] = [
  { k: 'atuacao', c: 'Atuação', o: {
    integrador: 'Integrador solar', vendedor: 'Vendedor ou representante', engenharia: 'Projeto e engenharia', outro: 'Outro',
  } },
  { k: 'equipe', c: 'Equipe', o: { sozinho: 'Só ele', '2_5': '2 a 5', '6_mais': '6 ou mais' } },
  { k: 'propostas', c: 'Propostas por mês', o: { ate10: 'Até 10', '10_30': '10 a 30', '30_mais': 'Mais de 30' } },
];

export const CAMINHO: Record<string, string> = {
  cotista: 'Cotista', investidor: 'Investidor', arrendamento: 'Arrendamento',
  chave_na_mao: 'Chave na mão', parceiro: 'Parceiro instalador', so_carregador: 'Só o carregador',
};
const RECURSO_EP: Pergunta = { k: 'recurso', c: 'Como investir', o: {
  proprio: 'Recurso próprio', proprio_credito: 'Próprio mais financiamento', financiamento: 'Financiamento', naosei: 'Ainda não sabe',
} };
const LOCAL: Pergunta = { k: 'local', c: 'Local', o: {
  meu: 'Tem um local dele ou que administra', em_vista: 'Tem um lugar em vista', nao: 'Não tem local',
} };
const CAPITAL: Pergunta = { k: 'capital', c: 'Quanto investir', o: {
  50: 'R$ 50 mil', 70: 'R$ 70 mil', 100: 'R$ 100 mil', 140: 'R$ 140 mil', 280: 'R$ 280 mil',
  500: 'R$ 500 mil', '500_mais': 'Mais de R$ 500 mil', naosei: 'Ainda não sabe',
} };
export const PERG_EP: Record<string, Pergunta[]> = {
  cotista: [LOCAL, CAPITAL, RECURSO_EP],
  investidor: [LOCAL, CAPITAL, RECURSO_EP],
  arrendamento: [
    { k: 'ponto_tipo', c: 'Tipo de local', o: {
      posto: 'Posto de combustível', mercado: 'Mercado ou atacarejo', restaurante: 'Restaurante', academia: 'Academia',
      farmacia: 'Farmácia', hotel: 'Hotel ou pousada', estacionamento: 'Estacionamento', condominio: 'Condomínio', outro: 'Outro',
    } },
    { k: 'relacao', c: 'O local é dele?', o: {
      proprietario: 'É o dono', administro: 'Administra', represento: 'Representa o dono', inquilino: 'É inquilino',
    } },
    { k: 'vagas', c: 'Vagas', o: { '1_2': '1 ou 2', '3_5': '3 a 5', '6_10': '6 a 10', '10_mais': 'Mais de 10' } },
  ],
  chave_na_mao: [
    { k: 'ponto', c: 'Local', o: {
      definido: 'Já está definido', negociando: 'Negociando', em_vista: 'Tem um em vista', sem_ideia: 'Ainda não',
    } },
    { k: 'valor', c: 'Quanto investir', o: {
      70: 'R$ 70 mil', 140: 'R$ 140 mil', 280: 'R$ 280 mil', 500: 'R$ 500 mil', '500_mais': 'Mais de R$ 500 mil', naosei: 'Ainda não sabe',
    } },
    RECURSO_EP,
  ],
  parceiro: [
    { k: 'atuacao', c: 'O que faz', o: {
      integrador_solar: 'Integrador solar', eletricista: 'Eletricista ou instalador', engenheiro: 'Engenheiro eletricista',
      empresa_instalacao: 'Empresa de instalação ou construtora', vendedor: 'Vendedor ou representante técnico', nao_atuo: 'Ainda não atua na área',
    } },
    { k: 'experiencia', c: 'Já instalou?', o: {
      nunca: 'Nunca instalou', '1_3': '1 a 3', mais_3: 'Mais de 3', certificado: 'Certificado por fabricante',
    } },
    { k: 'interesse', c: 'Como quer trabalhar', o: {
      vender: 'Vende e a gente executa', executar: 'Executa a obra na região', vender_executar: 'Vende e executa',
      comprar_equipamento: 'Compra o equipamento e faz por conta', naosei: 'Ainda não sabe',
    } },
  ],
  so_carregador: [
    { k: 'potencia', c: 'Potência', o: { 80: '80 kW', 120: '120 kW', outra: 'Outra ou não sabe' } },
    { k: 'qtd', c: 'Unidades', o: { 1: '1', '2_5': '2 a 5', '6_10': '6 a 10', mais_10: 'Mais de 10' } },
    { k: 'instala', c: 'Quem instala', o: {
      voces_montam: 'A gente instala', obra_minha_projeto_voces: 'Ele faz a obra, a gente o projeto',
      obra_e_projeto_meus: 'Obra e projeto por conta dele', eu_monto: 'Ele mesmo monta', nao_sei: 'Ainda não sabe',
    } },
  ],
};

export const MOB: Record<string, string> = {
  carro_compacto: 'Carro compacto', carro_suv: 'SUV', carro_sedan: 'Sedã', picape: 'Picape', van: 'Van e utilitário',
  triciclo: 'Triciclo e cargo', quadriciclo: 'Quadriciclo e UTV', bike: 'Bike elétrica', scooter: 'Scooter', moto: 'Moto',
};
export const OBJ: Record<string, string> = { proprio: 'Uso próprio', frota: 'Empresa ou frota', revenda: 'Revenda', investir: 'Investir' };
export const INV: Record<string, string> = {
  '50_100': 'R$ 50 a 100 mil', '100_250': 'R$ 100 a 250 mil', '250_500': 'R$ 250 a 500 mil', '500_mais': 'Acima de R$ 500 mil', naosei: 'Não sabe',
};
export const REC: Record<string, string> = { proprio: 'Recurso próprio', financiamento: 'Financiamento', os_dois: 'Os dois', naosei: 'Não sabe' };

/** "Vagas: 3 a 5", mas "O local é dele? É inquilino" (sem dois-pontos depois de pergunta). */
export const par = (c: string, v: string) => (c.endsWith('?') ? `${c} ${v}` : `${c}: ${v}`);
const obj = (v: unknown): Record<string, string> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});
const arr = (v: unknown): string[] => (Array.isArray(v) ? v : []);

/** As portas da linha: o que o banco guardou em portas[] mais o que os dados mostram. */
export function portasDe(r: Row): Porta[] {
  const tem = new Set(arr(r.portas).filter((p): p is Porta => (PORTAS as string[]).includes(p)));
  if (Object.keys(obj(r.solar)).length) tem.add('solar');
  if (arr(r.eletroposto).length || Object.keys(obj(r.eletroposto_respostas)).length) tem.add('eletroposto');
  if (Object.keys(obj(r.integrador)).length) tem.add('integrador');
  if (arr(r.mobilidade).length || (r.outro ?? '').trim() || r.objetivo) tem.add('mobilidade');
  return PORTAS.filter((p) => tem.has(p));
}

export interface Bloco { porta: Porta; titulo: string; itens: [string, string][] }

function itensDe(perg: Pergunta[], resp: Record<string, string>): [string, string][] {
  return perg.filter((p) => resp[p.k]).map((p) => [p.c, p.o[resp[p.k]] ?? resp[p.k]]);
}

/** As respostas em texto, um bloco por porta (e um por caminho do eletroposto). */
export function blocosDe(r: Row): Bloco[] {
  const out: Bloco[] = [];
  for (const p of portasDe(r)) {
    if (p === 'solar') out.push({ porta: p, titulo: PORTA.solar, itens: itensDe(PERG_SOLAR, obj(r.solar)) });
    if (p === 'integrador') out.push({ porta: p, titulo: PORTA.integrador, itens: itensDe(PERG_INT, obj(r.integrador)) });
    if (p === 'eletroposto') {
      const todas = obj(r.eletroposto_respostas) as unknown as Record<string, Record<string, string>>;
      const caminhos = Array.from(new Set([...arr(r.eletroposto), ...Object.keys(todas)]));
      for (const c of caminhos) {
        const resp = obj(todas[c]);
        const itens = itensDe(PERG_EP[c] ?? [], resp);
        if (resp.empresa) itens.push(['Empresa', resp.empresa]);
        out.push({ porta: p, titulo: `Eletroposto · ${CAMINHO[c] ?? c}`, itens });
      }
    }
    if (p === 'mobilidade') {
      const itens: [string, string][] = [];
      const lista = arr(r.mobilidade).map((k) => MOB[k] ?? k).join(', ');
      if (lista) itens.push(['Itens', lista]);
      if (r.objetivo) itens.push(['Para quê', OBJ[r.objetivo] ?? r.objetivo]);
      if (r.investimento) itens.push(['Quanto', INV[r.investimento] ?? r.investimento]);
      if (r.recurso) itens.push(['Como pagar', REC[r.recurso] ?? r.recurso]);
      out.push({ porta: p, titulo: PORTA.mobilidade, itens });
    }
  }
  return out;
}

/** "Energia solar (Onde: Casa; Conta de luz: R$ 300 a 600) | Integrador (...)" para o CSV. */
export function textoBlocos(r: Row): string {
  return blocosDe(r).map((b) => `${b.titulo} (${b.itens.map(([c, v]) => `${c}: ${v}`).join('; ')})`).join(' | ');
}

// WhatsApp verificado no servidor: true confirmado, false sem WhatsApp, null não verificado.
export type Whats = 'ok' | 'sem' | 'nv';
export const WHATS: Record<Whats, string> = { ok: 'Confirmado', sem: 'Sem WhatsApp', nv: 'Não verificado' };
export function whatsDe(r: Row): Whats {
  return r.whatsapp_ok === true ? 'ok' : r.whatsapp_ok === false ? 'sem' : 'nv';
}

/** Card na agenda: só solar e eletroposto criam. */
export function cardsDe(r: Row): { porta: Porta; id: string }[] {
  const out: { porta: Porta; id: string }[] = [];
  if (r.card_solar_id) out.push({ porta: 'solar', id: String(r.card_solar_id) });
  if (r.card_eletroposto_id) out.push({ porta: 'eletroposto', id: String(r.card_eletroposto_id) });
  return out;
}
/** Porta que cria card (solar ou eletroposto) e ficou sem card: teste, bloqueado ou já tinha card vivo. */
export function semCardEsperado(r: Row): boolean {
  const ps = portasDe(r);
  return (ps.includes('solar') && !r.card_solar_id) || (ps.includes('eletroposto') && !r.card_eletroposto_id);
}
