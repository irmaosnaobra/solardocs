// Academia NEXUS: 12 aulas curtas, cada uma com uma pergunta de checagem. O GABARITO (`certa`) mora só aqui no servidor:
// `aulasParaFront()` nunca o devolve. O texto abaixo é o aprovado (academia-v1); para trocar, mantenha os ids a01..a12
// (o progresso do parceiro grava por id). Nenhuma aula tem vídeo por enquanto (video_url null).

export const TOTAL_AULAS = 12;

export interface Aula {
  id: string;
  titulo: string;
  resumo: string;
  pontos: string[];
  video_url: string | null;
  pergunta: string;
  opcoes: string[];
  /** Índice da opção certa. Nunca vai para o front. */
  certa: number;
}

export const AULAS: readonly Aula[] = Object.freeze([
  {
    "id": "a01",
    "titulo": "Por que eletroposto agora",
    "resumo": "A procura por eletroposto cresceu de julho a outubro de 2026, e boa parte vem de fora de MG, GO e DF.",
    "pontos": [
      "Julho: 77 reuniões de eletroposto",
      "Outubro, até o dia 20: 344 reuniões",
      "Mais da metade vem de fora de MG, GO e DF"
    ],
    "video_url": null,
    "pergunta": "De onde vem a maior parte da procura?",
    "opcoes": [
      "Só de Uberlândia",
      "De fora de MG, GO e DF",
      "Só das capitais"
    ],
    "certa": 1
  },
  {
    "id": "a02",
    "titulo": "Como a NEXUS trabalha",
    "resumo": "A NEXUS importa e distribui os carregadores. O parceiro vende, instala ou faz as duas coisas, em nome próprio.",
    "pontos": [
      "A NEXUS importa e distribui os carregadores",
      "Cliente com proposta do portal é do parceiro",
      "Empresas independentes, sem exclusividade"
    ],
    "video_url": null,
    "pergunta": "De quem é o cliente com proposta feita no portal?",
    "opcoes": [
      "Do parceiro que atendeu",
      "Da NEXUS",
      "De quem ligar primeiro"
    ],
    "certa": 0
  },
  {
    "id": "a03",
    "titulo": "Os modelos de carregador",
    "resumo": "A NEXUS tem dois carregadores rápidos em corrente contínua, o DC 80 kW e o DC 120 kW. Os dois têm conector CCS2, com 2 plugues.",
    "pontos": [
      "DC 80 kW: atende dois carros ao mesmo tempo",
      "DC 120 kW: divide a potência entre as vagas",
      "Conector CCS2, OCPP 1.6J, tela sensível ao toque"
    ],
    "video_url": null,
    "pergunta": "Qual conector os dois modelos usam?",
    "opcoes": [
      "Só tomada de parede",
      "CCS2, com 2 plugues",
      "Plugue de corrente alternada"
    ],
    "certa": 1
  },
  {
    "id": "a04",
    "titulo": "Escolher o local do ponto",
    "resumo": "Olhe o movimento, a energia disponível e a vaga. Se o local é alugado, o arrendamento do ponto entra na conta.",
    "pontos": [
      "Movimento: carros por dia no local",
      "Energia: entrada ou transformador adequados",
      "Vaga: base, piso e sinalização"
    ],
    "video_url": null,
    "pergunta": "Se o local é alugado, o que entra na conta?",
    "opcoes": [
      "Nada, o local é grátis",
      "Só a internet",
      "O arrendamento do ponto"
    ],
    "certa": 2
  },
  {
    "id": "a05",
    "titulo": "A conta do ponto",
    "resumo": "A conta do mês: o que entra vendendo energia, menos energia comprada, plataforma, imposto e manutenção. O que resta é a sobra.",
    "pontos": [
      "Entra: kWh vendido vezes o preço ao motorista",
      "Sai: energia, plataforma 10%, imposto, manutenção",
      "Sobra: o que resta depois de todos os custos"
    ],
    "video_url": null,
    "pergunta": "Exemplo: 6 recargas por dia, 35 kWh cada. Quanto dá em 30 dias?",
    "opcoes": [
      "Total de 210 kWh",
      "Total de 6.300 kWh",
      "Total de 1.050 kWh"
    ],
    "certa": 1
  },
  {
    "id": "a06",
    "titulo": "Como ler a simulação",
    "resumo": "A simulação mostra quatro números e três cenários. Apresente como projeção, que não é promessa de resultado.",
    "pontos": [
      "Investimento, lucro por mês, retorno e rentabilidade",
      "Conservador tira 40% da demanda, otimista soma 40%",
      "É projeção, nunca promessa de resultado"
    ],
    "video_url": null,
    "pergunta": "Como o parceiro apresenta a simulação ao cliente?",
    "opcoes": [
      "Como projeção, sem prometer retorno",
      "Como retorno garantido",
      "Só com o cenário otimista"
    ],
    "certa": 0
  },
  {
    "id": "a07",
    "titulo": "Proposta Básico e Completo",
    "resumo": "A proposta soma carregadores e itens da obra. O financiamento de referência é até 96x, com 120 dias de carência, sujeito à análise de crédito.",
    "pontos": [
      "Simulador, Básico e Completo, com a sua marca",
      "Total: carregadores mais os itens da obra",
      "Pagar: à vista, cartão ou financiamento"
    ],
    "video_url": null,
    "pergunta": "Como é o financiamento de referência?",
    "opcoes": [
      "Só à vista, sem parcelas",
      "Parcelado, sem carência",
      "Até 96x, com 120 dias de carência"
    ],
    "certa": 2
  },
  {
    "id": "a08",
    "titulo": "Engenharia, ART e homologação",
    "resumo": "A Engenharia NEXUS faz o projeto elétrico e a ART do projeto, pede o acesso e acompanha a homologação. A obra é do parceiro.",
    "pontos": [
      "Engenharia NEXUS: projeto, ART e pedido de acesso",
      "Obra: equipe com NR-10 e ART própria da obra",
      "O prazo da distribuidora não se promete"
    ],
    "video_url": null,
    "pergunta": "O que o parceiro não deve prometer ao cliente?",
    "opcoes": [
      "O prazo da distribuidora",
      "A garantia de fábrica",
      "Que a obra segue as normas"
    ],
    "certa": 0
  },
  {
    "id": "a09",
    "titulo": "A reunião com o cliente",
    "resumo": "Leve a simulação com os números do local e mostre os três cenários. Diga que é projeção e deixe a Plataforma NEXUS por escrito.",
    "pontos": [
      "Use os números do local, não os do exemplo",
      "Mostre os três cenários, não só o otimista",
      "Plataforma NEXUS por 24 meses vai por escrito"
    ],
    "video_url": null,
    "pergunta": "O que vai por escrito na proposta ao cliente?",
    "opcoes": [
      "Plataforma NEXUS por 24 meses",
      "Retorno garantido do investimento",
      "Prazo fixo da distribuidora"
    ],
    "certa": 0
  },
  {
    "id": "a10",
    "titulo": "Do pedido à montagem",
    "resumo": "O pedido fecha modelo, quantidade, preço, pagamento e entrega, confirmados pelo comercial. Na instalação, o carregador é ativado na plataforma.",
    "pontos": [
      "Pedido vale quando o comercial confirma por escrito",
      "Pagamento do pedido: K EMA EASY (NEXUS Eletroposto)",
      "Ative o carregador na plataforma na instalação"
    ],
    "video_url": null,
    "pergunta": "Quem recebe o pagamento do pedido?",
    "opcoes": [
      "Qualquer conta passada por mensagem",
      "A conta pessoal do vendedor",
      "K EMA EASY (NEXUS Eletroposto)"
    ],
    "certa": 2
  },
  {
    "id": "a11",
    "titulo": "O Termo de Parceria",
    "resumo": "O Termo v1 vale desde o aceite no portal, por prazo indeterminado. O aceite fica registrado com data, hora e versão.",
    "pontos": [
      "Parceria gratuita: sem entrada, mensalidade ou comissão",
      "Equipamento ao cliente: teto de tabela ou menos",
      "Empresas independentes, sem exclusividade"
    ],
    "video_url": null,
    "pergunta": "Por quanto o parceiro vende o equipamento?",
    "opcoes": [
      "Sem limite de preço",
      "Pelo teto de tabela ou menos",
      "Só acima do teto de tabela"
    ],
    "certa": 1
  },
  {
    "id": "a12",
    "titulo": "Subir até Parceiro regional",
    "resumo": "São 6 patamares, do Mapeado ao Parceiro regional. Obra da região só vai para o Parceiro regional, encaminhada e sem garantia.",
    "pontos": [
      "Cada patamar abre com o anterior concluído",
      "Parceiro regional: 5 ou mais carregadores comprados",
      "Só o regional recebe obra, encaminhada e sem garantia"
    ],
    "video_url": null,
    "pergunta": "Como a obra da região chega ao parceiro?",
    "opcoes": [
      "Garantida todo mês",
      "Com exclusividade na cidade",
      "Encaminhada, sem garantia"
    ],
    "certa": 2
  },
]);

/** As aulas SEM o gabarito. */
export function aulasParaFront(): Array<Omit<Aula, 'certa'>> {
  return AULAS.map(({ certa: _certa, ...resto }) => resto);
}

export const idDeAulaValido = (id: string): boolean => AULAS.some((a) => a.id === id);

/** Confere a resposta. Índice inválido ou aula inexistente = null (a rota responde 400). */
export function corrigirAula(id: string, resposta: unknown): boolean | null {
  const aula = AULAS.find((a) => a.id === id);
  if (!aula || typeof resposta !== 'number' || !Number.isInteger(resposta) || resposta < 0 || resposta >= aula.opcoes.length) return null;
  return resposta === aula.certa;
}

export interface ProgressoAula { em: string; certa: boolean }

/** Quantas aulas já foram acertadas (só conta id que existe). */
export function aulasFeitas(academia: unknown): number {
  const m = academia && typeof academia === 'object' ? (academia as Record<string, ProgressoAula>) : {};
  return AULAS.filter((a) => m[a.id]?.certa === true).length;
}

/** Quem erra uma aula espera este tempo para tentar a MESMA aula de novo (as outras seguem livres). O erro não diz qual é a certa. */
export const ESPERA_APOS_ERRO_MS = 120_000;

/** Segundos que faltam para liberar a aula (0 = livre). Vale só se a última tentativa foi errada; `em` é a hora dessa tentativa. */
export function segundosDeEspera(entrada: unknown, agora: number = Date.now()): number {
  const e = entrada as Partial<ProgressoAula> | undefined;
  if (!e || e.certa === true) return 0;
  const fim = Date.parse(String(e.em ?? '')) + ESPERA_APOS_ERRO_MS;
  return Number.isFinite(fim) && fim > agora ? Math.ceil((fim - agora) / 1000) : 0;
}

/** O progresso como a tela recebe: { em, certa } e, nas erradas, `libera_em` (quando pode tentar de novo). */
export function progressoParaFront(academia: unknown): Record<string, { em: string; certa: boolean; libera_em?: string }> {
  const m = academia && typeof academia === 'object' ? (academia as Record<string, ProgressoAula>) : {};
  return Object.fromEntries(AULAS.filter((a) => m[a.id]).map((a) => {
    const e = m[a.id]!;
    const certa = e.certa === true;
    return [a.id, certa ? { em: e.em, certa } : { em: e.em, certa, libera_em: new Date(Date.parse(e.em) + ESPERA_APOS_ERRO_MS).toISOString() }];
  }));
}
