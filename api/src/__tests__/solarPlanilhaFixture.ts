// Fixture da Planilha Mestre para os testes do solar: 62 colunas, na ordem e com
// os nomes REPETIDOS da planilha de verdade (STATUS x3, previsão/início/fim x2) e
// a célula A1 quebrada ("J49" no lugar de "CODIGO"). As colunas proibidas levam
// valores-sentinela únicos: se um deles aparecer numa resposta, vazou coluna.

export const CABECALHO: string[] = [
  'J49', 'NOME CLIENTE', 'NOME HOMOLOGAÇÃO', 'CONSULTOR', 'ORIGEM DO LEAD', 'VALOR DA VENDA',
  'FORMA DE PAGTO', 'RECEBIDO REAL', 'RECEBIMENTO', 'SISTEMA LIBERADO PELA CONCESSIONARIA',
  'DEPOIMENTO INSTAGRAM', 'CONTATO', 'ENDEREÇO', 'CIDADE', 'UF',
  'ENTREGA DO MATERIAL', 'PREVISÃO DE MONTAGEM', 'DATA INICIO INSTALAÇÃO', 'DATA FINAL INSTALAÇÃO',
  'QTD PLACA', 'MODELO PLACA', 'POT PLACA', 'STATUS',
  'QTD INV', 'MODELO E VOLTAGEM DO INVERSOR', 'MODELO INVERSOR', 'STATUS',
  'TIPO ESTRUTURA', 'STATUS',
  'VALOR KIT', 'FATOR X', 'AC - CC', 'NF',
  'CADASTRO TRELLO', 'PAGTO ART', 'COMISSÃO VENDA',
  'DATA EMISSÃO ULTIMO PARECER DE ACESSO', 'DATA PEDIDO DE VISTORIA', 'LIBERAÇÃO VISTORIA',
  'ENGENHEIRO', 'EXCEDENTES', 'CONCESSIONARIA',
  'PRÉ VENDA', 'TOTAL CUSTO', 'TOTAL LUCRO', '% DE LUCRO', 'VALOR PAGO DO PROJETO', 'TAXAS/DESCONTOS',
  'EQUIPE',
  'PREVISÃO DE MONTAGEM', 'DATA INICIO INSTALAÇÃO', 'DATA FINAL INSTALAÇÃO',
  'M.O / PEÇAS/ ALIM / HOSP/PED', 'VALOR ART', 'KM IDA', 'KM VOLTA', 'KM TOTAL', 'KM RODADO', 'KM EXTRA', 'KM OBRA',
];

/** Índices por nome lógico (os da especificação). */
export const I = {
  codigo: 0, cliente: 1, homologacao: 2, consultor: 3, origem: 4, valor: 5, recebido: 7, recebimento: 8,
  liberado: 9, depoimento: 10, contato: 11, endereco: 12, cidade: 13, uf: 14,
  entrega: 15, previsao: 16, inicio: 17, fim: 18, qtdPlaca: 19, modeloPlaca: 20,
  statusPlaca: 22, qtdInv: 23, modeloInversor: 25, statusInversor: 26, estrutura: 27, statusEstrutura: 28,
  cadastro: 33, parecer: 36, pedidoVistoria: 37, liberacaoVistoria: 38, engenheiro: 39,
  concessionaria: 41, equipe: 48, previsaoReserva: 49, inicioReserva: 50, fimReserva: 51,
} as const;

/** Colunas que NUNCA podem sair, com o valor-sentinela de cada uma. */
export const PROIBIDAS: Record<number, string> = {
  29: 'ZZKIT4471', 30: 'ZZFATOR5582', 31: 'ZZACCC6693', 32: 'ZZNF7704', 35: 'ZZCOMIS8815',
  42: 'ZZPREV9926', 43: 'ZZCUSTO1037', 44: 'ZZLUCRO2148', 45: 'ZZPCT3259', 46: 'ZZPAGO4360',
  47: 'ZZTAXA5471', 52: 'ZZMO6582', 53: 'ZZART7693', 54: 'ZZKM8704', 55: 'ZZKM9815', 56: 'ZZKM1926',
  57: 'ZZKM2037', 58: 'ZZKM3148', 59: 'ZZKM4259',
};
export const NOMES_PROIBIDOS = [
  'VALOR KIT', 'FATOR X', 'AC - CC', 'COMISSÃO VENDA', 'PRÉ VENDA', 'TOTAL CUSTO', 'TOTAL LUCRO',
  '% DE LUCRO', 'VALOR PAGO DO PROJETO', 'TAXAS/DESCONTOS', 'M.O / PEÇAS', 'VALOR ART', 'KM IDA',
  'valorKit', 'fatorX', 'comissao', 'totalLucro', 'totalCusto',
];

export function linha(campos: Partial<Record<keyof typeof I, string>>): string[] {
  const l = new Array(CABECALHO.length).fill('');
  for (const [k, v] of Object.entries(campos)) l[I[k as keyof typeof I]] = v as string;
  for (const [i, v] of Object.entries(PROIBIDAS)) l[Number(i)] = v;
  return l;
}

export function paraCsv(linhas: string[][]): string {
  const cel = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return linhas.map((l) => l.map(cel).join(',')).join('\n') + '\n';
}

/** Vendas da fixture. Datas todas anteriores a 10/10/2026. */
export const VENDAS = {
  // Concluída, indicada pelo #0013, depoimento já pedido, quitada.
  ana: linha({
    codigo: '#0057', cliente: 'Ana Souza', consultor: 'Nilce', origem: '#0013 Cleber',
    valor: 'R$ 6.990,00', recebido: 'R$ 6.990,00', recebimento: 'Quitado', liberado: 'Liberado',
    depoimento: 'Pedido', contato: '(34) 99999-0000', endereco: 'Rua X, 10', cidade: 'Uberlândia', uf: 'MG',
    entrega: '10/08/2026', fim: '20/08/2026', qtdPlaca: '10', modeloPlaca: 'Tsun 585W',
    statusPlaca: 'Instalado', qtdInv: '1', modeloInversor: 'Saj 3K', statusInversor: 'Instalado',
    estrutura: 'Fibromadeira', statusEstrutura: 'Instalado', cadastro: '03/08/2026',
    parecer: '05/08/2026', liberacaoVistoria: '25/08/2026', engenheiro: 'Guilherme',
    concessionaria: 'Cemig', equipe: 'Propria',
  }),
  // Do Diego, no material: falta inversor e estrutura; não quitada.
  bruno: linha({
    codigo: '#0058', cliente: 'Bruno Lima', consultor: 'Diego', origem: 'Indicação Adriel',
    valor: 'R$ 10.000,00', recebido: 'R$ 4.000,00', recebimento: 'Não Quitado', liberado: 'Não liberado',
    contato: '34988887777', cidade: 'Uberlandia', uf: 'MG', qtdPlaca: '8', modeloPlaca: 'Tsun 550W',
    statusPlaca: 'No Cliente', statusInversor: 'Comprar', statusEstrutura: 'Comprar',
    cadastro: '01/09/2026', parecer: '8/09/2026', concessionaria: 'Cemig',
  }),
  // Da Nilce, instalação iniciada e sem fim.
  carla: linha({
    codigo: '#0059', cliente: 'Carla Dias', consultor: 'Nilce', origem: 'Tráfego',
    valor: 'R$ 8.500,00', recebido: 'R$ 8.500,00', recebimento: 'Quitado', liberado: 'Não liberado',
    cidade: 'Araguari', uf: 'MG', statusPlaca: 'No Cliente', statusInversor: 'No Cliente', statusEstrutura: 'Instalado',
    cadastro: '20/08/2026', parecer: '25/08/2026', inicio: '02/10/2026', concessionaria: 'Cemig',
  }),
  // Da Giovanna, vistoria só pedida; cidade que não existe; recorrente.
  eva: linha({
    codigo: '#0060', cliente: 'Eva Reis', consultor: 'Giovanna', origem: 'Recorrente #0008',
    valor: 'R$ 12.000,00', recebido: 'R$ 12.000,00', recebimento: 'Quitado', liberado: 'Não liberado',
    cidade: 'Cidade Inventada', uf: 'XX', entrega: '01/08/2026', fim: '15/08/2026',
    cadastro: '10/07/2026', parecer: '15/07/2026', pedidoVistoria: '05/10/2026',
  }),
  // Da Nilce, "buraco": liberada mas sem parecer nem material na planilha.
  fabio: linha({
    codigo: '#0061', cliente: 'Fabio Reis', consultor: 'Nilce', origem: 'Procurou',
    valor: 'R$ 5.000,00', recebido: '', recebimento: '', liberado: 'Liberado', depoimento: 'Insatisfeito',
    cidade: 'Uberlândia', uf: 'MG', fim: '12//06/2026', cadastro: '1/06/2026',
  }),
};

export function planilhaPadrao(): string {
  const total = new Array(CABECALHO.length).fill('');
  total[0] = 'TOTAL'; total[5] = 'R$ 999.999,00'; total[1] = 'Linha de total';
  return paraCsv([
    CABECALHO,
    VENDAS.ana, VENDAS.bruno, VENDAS.carla, VENDAS.eva, VENDAS.fabio,
    total,
  ]);
}
