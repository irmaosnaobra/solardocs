// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DO CONTRATO: LISTA BRANCA DE CAMPOS (19/10/2026)
//
// O agente de contrato mexe no contrato de dois jeitos: pelos CAMPOS do formulário
// (garantia, prazos, multa, percentual, foro...) e pelo TEXTO (operações sobre as
// cláusulas). Mudar pelo campo é o caminho preferido: o contrato continua gerado a
// partir dos números e nada fica congelado em texto. Esta lista é a fonte única
// do que o agente pode mudar, para o servidor (que valida cada valor) e para o
// front (que aplica e mostra), pela rota GET /gerador/contrato/agente/campos.
//
// O QUE NUNCA ENTRA, de propósito: identidade e endereço (nome, CPF/CNPJ, RG, IE,
// endereço, CEP, telefone e e-mail do cliente, do anuente e do representante),
// dados da empresa, dados bancários (Pix, conta), cidade, local do ponto, número
// do contrato, matrícula, cartório, IPTU, UC, distribuidora, PEP e renda, e a
// qualidade do cedente (`ctr-arr-relacao`, "O cedente é": define a parte). O
// agente não define partes.
//
// Os ids são os ids reais do formulário (`ctr-*`) em dashboard/public/gerador/
// index.html. `itens` diz de quais itens do contrato o campo é a origem
// (modelo -> chaves de item): é por ele que o servidor descarta uma operação de
// texto sobre um item que o mesmo turno já mudou pelo campo.
// ─────────────────────────────────────────────────────────────────────────────

import { TIPOS_CONTRATO, TIPOS_ELETROPOSTO } from './contratoIa';

export type TipoContratoAg = typeof TIPOS_CONTRATO[number];
export type TipoCampo = 'texto' | 'dinheiro' | 'percentual' | 'inteiro' | 'numero' | 'data' | 'opcao';

export type CampoAgente = {
  id: string;
  rotulo: string;
  tipo: TipoCampo;
  /** Opções que o agente escreve em `valor` (tipo 'opcao'). */
  opcoes?: string[];
  /** Quando o valor do <select> no formulário não é o texto da opção (ex.: 'com' vale "2"). */
  valoresHtml?: Record<string, string>;
  min?: number;
  max?: number;
  /** Sufixo mostrado no formulário: 'dias', 'meses', '%', 'R$'... */
  unidade?: string;
  /** Separador decimal que o campo do formulário espera: ',' nos campos de texto, '.' nos <input type=number>. */
  decimal?: ',' | '.';
  /** Tamanho máximo do texto (tipo 'texto'). */
  maxLen?: number;
  /** Texto com várias linhas (tipo 'texto'). */
  multilinha?: boolean;
  /** Em quais contratos o campo vale. */
  modelos: TipoContratoAg[];
  /** Preço, sinal, aporte, depósito: exige confirmação do consultor antes de aplicar. */
  sensivel?: boolean;
  /** Campo espelhado (CTR_ESPELHOS): o front tem de marcá-lo como tocado, senão o espelho desfaz a mudança. */
  espelho?: boolean;
  /** Dinheiro: 'sim' aceita zero ("0,00"), 'limpa' transforma zero em campo vazio. Sem isto, zero não vale. */
  zero?: 'sim' | 'limpa';
  /** modelo -> chaves dos itens do contrato que nascem deste campo. */
  itens?: Partial<Record<TipoContratoAg, string[]>>;
};

// `TODOS` são os sete do eletroposto: os campos `ctr-*` não existem no formulário do Fechamento solar (`fs-c-*`).
const TODOS: TipoContratoAg[] = [...TIPOS_ELETROPOSTO];
const SOL: TipoContratoAg[] = ['solar_m1', 'solar_m2'];
const OB: TipoContratoAg[] = ['completo'];
const SOC: TipoContratoAg[] = ['socio50', 'cotas'];
const SOC_TI: TipoContratoAg[] = ['socio50', 'cotas', 'termo_inv'];
const COT_TI: TipoContratoAg[] = ['cotas', 'termo_inv'];
const ARR: TipoContratoAg[] = ['arrend'];
const ARR_TA: TipoContratoAg[] = ['arrend', 'termo_arr'];
const TA: TipoContratoAg[] = ['termo_arr'];
const TI: TipoContratoAg[] = ['termo_inv'];
const PAGA: TipoContratoAg[] = ['completo', 'socio50', 'cotas', 'equip'];
const FORO_ITEM: Partial<Record<TipoContratoAg, string[]>> = {
  completo: ['foro.comarca'], socio50: ['foro.comarca'], cotas: ['foro.comarca'], arrend: ['foro.comarca'],
  termo_arr: ['foro.comarca'], termo_inv: ['foro.comarca'],
};

const dias = (id: string, rotulo: string, modelos: TipoContratoAg[], max: number, itens?: CampoAgente['itens'], min = 1): CampoAgente =>
  ({ id, rotulo, tipo: 'inteiro', min, max, unidade: 'dias', modelos, ...(itens ? { itens } : {}) });
const meses = (id: string, rotulo: string, modelos: TipoContratoAg[], max: number, itens?: CampoAgente['itens'], min = 1): CampoAgente =>
  ({ id, rotulo, tipo: 'inteiro', min, max, unidade: 'meses', modelos, ...(itens ? { itens } : {}) });

export const CAMPOS_AGENTE: CampoAgente[] = [
  // ── Em todos os contratos ──────────────────────────────────────────────────
  { id: 'ctr-data', rotulo: 'Data do contrato', tipo: 'data', modelos: TODOS },
  { id: 'ctr-foro', rotulo: 'Foro (comarca)', tipo: 'texto', maxLen: 80, modelos: TODOS, espelho: true, itens: FORO_ITEM },
  { id: 'ctr-testemunhas', rotulo: 'Testemunhas na assinatura', tipo: 'opcao', opcoes: ['com', 'sem'], valoresHtml: { com: '2', sem: '' }, modelos: TODOS },
  { id: 'ctr-extras', rotulo: 'Cláusulas extras (uma por linha, cada linha vira um item numerado)', tipo: 'texto', maxLen: 1500, multilinha: true, modelos: TODOS },

  // ── Dinheiro do contrato de obra, equipamento e sociedade ──────────────────
  { id: 'ctr-total', rotulo: 'Valor total do projeto', tipo: 'dinheiro', min: 0.01, max: 100_000_000, unidade: 'R$', modelos: OB, sensivel: true, espelho: true, itens: { completo: ['preco.total'] } },
  { id: 'ctr-sinal', rotulo: 'Sinal já pago', tipo: 'dinheiro', min: 0, max: 100_000_000, unidade: 'R$', modelos: PAGA, sensivel: true, espelho: true, zero: 'sim', itens: { completo: ['preco.sinal', 'preco.forma', 'preco.financiamento', 'rescisao.desistencia', 'rescisao.execucao', 'opc.distribuidora'], equip: ['preco.sinal', 'desistencia.sinal'], socio50: ['aporte.valor', 'aporte.forma', 'aporte.inadimplencia'], cotas: ['aporte.valor', 'aporte.forma', 'aporte.inadimplencia'] } },
  { id: 'ctr-sinal-destino', rotulo: 'Destino do sinal', tipo: 'texto', maxLen: 80, modelos: OB },
  { id: 'ctr-pag-obs', rotulo: 'Observação das formas de pagamento (sem forma na lista, vira a cláusula de pagamento inteira)', tipo: 'texto', maxLen: 800, multilinha: true, modelos: PAGA, sensivel: true, itens: { completo: ['preco.forma'], socio50: ['aporte.forma'], cotas: ['aporte.forma'] } },
  { id: 'ctr-multa', rotulo: 'Multa por atraso no pagamento', tipo: 'percentual', min: 0, max: 10, unidade: '%', decimal: '.', modelos: PAGA, itens: { completo: ['preco.mora', 'prazo.atraso'], equip: ['preco.mora', 'entrega.mora'], socio50: ['aporte.mora'], cotas: ['aporte.mora'] } },
  { id: 'ctr-juros', rotulo: 'Juros de mora por mês', tipo: 'percentual', min: 0, max: 5, unidade: '% ao mês', decimal: '.', modelos: PAGA, itens: { completo: ['preco.mora', 'prazo.atraso'], equip: ['preco.mora', 'entrega.mora'], socio50: ['aporte.mora'], cotas: ['aporte.mora'] } },

  // ── Completo (fornecimento e instalação) ───────────────────────────────────
  { id: 'ctr-prazo-unid', rotulo: 'Prazos contados em', tipo: 'opcao', opcoes: ['uteis', 'corridos'], modelos: OB },
  { id: 'ctr-prazo-marco', rotulo: 'Prazos contados a partir de', tipo: 'opcao', opcoes: ['aprovacao', 'assinatura', 'entrada', 'docs'], modelos: OB },
  dias('ctr-prazo-projeto', 'Projeto elétrico e protocolo', OB, 365, { completo: ['prazo.projeto'] }),
  dias('ctr-prazo-equip', 'Chegada do equipamento ao local', ['completo'], 365, { completo: ['prazo.equipamento'] }),
  dias('ctr-prazo-obra', 'Entrega da obra', OB, 730, { completo: ['prazo.obra'] }),
  dias('ctr-prazo-docs', 'Cliente entrega os documentos em', OB, 90, { completo: ['contratante.docs'] }),
  meses('ctr-garantia', 'Garantia da instalação', OB, 120, { completo: ['garantia.instalacao'] }),
  dias('ctr-prazo-credito', 'Banco aprova o financiamento em', OB, 365, { completo: ['preco.financiamento'] }),
  dias('ctr-prazo-corrigir', 'Prazo para corrigir antes de rescindir', OB, 90, { completo: ['rescisao.descumprimento'] }),
  dias('ctr-prazo-aviso', 'Aviso prévio para sair da plataforma', OB, 365, { completo: ['plataforma.continuado'] }),
  { id: 'ctr-pct', rotulo: 'Percentual da plataforma (Software) sobre o faturamento', tipo: 'percentual', min: 0.1, max: 50, unidade: '%', decimal: ',', sensivel: true, modelos: OB, espelho: true, itens: { completo: ['plataforma.remuneracao'] } },
  { id: 'ctr-mostra-pct', rotulo: 'Mostrar o percentual da plataforma no contrato', tipo: 'opcao', opcoes: ['mostrar', 'omitir'], valoresHtml: { mostrar: '1', omitir: '' }, modelos: OB },

  // ── Compra e venda de equipamento ──────────────────────────────────────────
  dias('ctr-eq-atraso', 'Atraso (de entrega ou de pagamento) que deixa a outra parte encerrar', ['equip'], 180, { equip: ['entrega.atraso', 'preco.mora'] }),
  meses('ctr-eq-garantia', 'Garantia da instalação (quando a instalação está no pedido)', ['equip'], 120, { equip: ['instalacao.garantia'] }),

  // ── Sociedade (50/50 e cotas) e termo do investidor ────────────────────────
  { id: 'ctr-soc-invest', rotulo: 'Investimento total (capital)', tipo: 'dinheiro', min: 0.01, max: 1_000_000_000, unidade: 'R$', modelos: SOC_TI, sensivel: true, espelho: true, itens: { socio50: ['capital.total', 'capital.quadro'], cotas: ['capital.total', 'capital.quadro'], termo_inv: ['condicoes.quadro'] } },
  { id: 'ctr-soc-n', rotulo: 'Cotas de sócios investidores', tipo: 'inteiro', min: 1, max: 100, sensivel: true, modelos: COT_TI, espelho: true, itens: { cotas: ['capital.quadro'], termo_inv: ['condicoes.quadro', 'cotas.subscricao'] } },
  { id: 'ctr-soc-cota', rotulo: 'Cota deste sócio', tipo: 'percentual', min: 0.1, max: 100, unidade: '%', decimal: ',', modelos: COT_TI, sensivel: true, espelho: true, itens: { cotas: ['capital.quadro'], termo_inv: ['condicoes.quadro', 'cotas.subscricao'] } },
  { id: 'ctr-soc-aporte', rotulo: 'Aporte do sócio', tipo: 'dinheiro', min: 0.01, max: 1_000_000_000, unidade: 'R$', modelos: SOC_TI, sensivel: true, espelho: true, itens: { socio50: ['aporte.valor', 'capital.quadro'], cotas: ['aporte.valor', 'capital.quadro'], termo_inv: ['condicoes.quadro', 'cotas.subscricao'] } },
  { id: 'ctr-soc-qtd', rotulo: 'Cotas deste sócio (quantidade)', tipo: 'inteiro', min: 1, max: 100, sensivel: true, modelos: COT_TI, itens: { cotas: ['aporte.valor'], termo_inv: ['cotas.subscricao'] } },
  { id: 'ctr-soc-cota-nexus', rotulo: 'Cota da NEXUS', tipo: 'percentual', min: 0, max: 100, unidade: '%', decimal: ',', modelos: SOC, sensivel: true, espelho: true, itens: { socio50: ['aporte.ostensiva', 'capital.quadro', 'capital.adicional'], cotas: ['aporte.ostensiva', 'capital.quadro', 'capital.adicional'] } },
  { id: 'ctr-soc-aporte-nexus', rotulo: 'Aporte da NEXUS', tipo: 'dinheiro', min: 0, max: 1_000_000_000, unidade: 'R$', modelos: SOC, sensivel: true, espelho: true, zero: 'sim', itens: { socio50: ['aporte.ostensiva', 'capital.adicional'], cotas: ['aporte.ostensiva', 'capital.adicional'] } },
  { id: 'ctr-soc-software', rotulo: 'Software NEXUS, percentual do faturamento', tipo: 'percentual', min: 0.1, max: 30, unidade: '%', decimal: ',', sensivel: true, modelos: SOC_TI, espelho: true, itens: { socio50: ['operacao.plataforma'], cotas: ['operacao.plataforma'], termo_inv: ['condicoes.quadro'] } },
  { id: 'ctr-soc-arrend', rotulo: 'Arrendamento ao dono do local, percentual do faturamento', tipo: 'percentual', min: 0, max: 30, unidade: '%', decimal: ',', sensivel: true, modelos: SOC, espelho: true, itens: { socio50: ['local.cessao', 'resultado.custos', 'operacao.painel', 'operacao.despesas', 'local.energia', 'aporte.mora'], cotas: ['local.cessao'] } },
  { id: 'ctr-soc-dia', rotulo: 'Dia de pagar o resultado (mês seguinte)', tipo: 'inteiro', min: 1, max: 28, modelos: SOC, itens: { socio50: ['resultado.divisao', 'implantacao.atraso', 'local.cessao'], cotas: ['resultado.divisao', 'implantacao.atraso'] } },
  dias('ctr-soc-captacao', 'Prazo para fechar o capital', SOC, 365, { socio50: ['captacao.prazo'], cotas: ['captacao.prazo'] }),
  dias('ctr-soc-implant', 'Ponto em operação em até', SOC, 730, { socio50: ['implantacao.prazo'], cotas: ['implantacao.prazo'] }),
  meses('ctr-soc-prazo', 'Prazo da sociedade', SOC, 600, { socio50: ['prazo.vigencia'], cotas: ['prazo.vigencia'] }, 0),
  meses('ctr-soc-permanencia', 'Ninguém sai antes de', SOC, 240, { socio50: ['prazo.retirada'], cotas: ['prazo.retirada'] }, 0),
  dias('ctr-soc-aviso', 'Aviso prévio para sair', SOC, 365, { socio50: ['prazo.retirada'], cotas: ['prazo.retirada'] }),
  { id: 'ctr-soc-haveres', rotulo: 'Haveres de quem sai pagos em (parcelas)', tipo: 'inteiro', min: 1, max: 60, unidade: 'x', modelos: SOC, itens: { socio50: ['prazo.retirada'], cotas: ['prazo.retirada'] } },
  dias('ctr-soc-corrigir', 'Prazo para corrigir antes de rescindir', SOC, 90, { socio50: ['rescisao.descumprimento'], cotas: ['rescisao.descumprimento'] }),

  // ── Arrendamento (e o termo do arrendador, que usa a mesma remuneração) ────
  { id: 'ctr-arr-modo', rotulo: 'Forma da remuneração do dono do local', tipo: 'opcao', opcoes: ['pct', 'fixo'], modelos: ARR_TA, sensivel: true, itens: { arrend: ['remuneracao.pct', 'remuneracao.fixo'], termo_arr: ['condicoes.remuneracao'] } },
  { id: 'ctr-arr-pct', rotulo: 'Percentual do faturamento bruto pago ao dono', tipo: 'percentual', min: 0.1, max: 50, unidade: '%', decimal: ',', modelos: ARR_TA, sensivel: true, espelho: true, itens: { arrend: ['remuneracao.pct'], termo_arr: ['condicoes.remuneracao'] } },
  { id: 'ctr-arr-piso', rotulo: 'Piso mensal da remuneração', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: ARR_TA, sensivel: true, zero: 'limpa', itens: { arrend: ['remuneracao.piso'], termo_arr: ['condicoes.remuneracao'] } },
  { id: 'ctr-arr-carencia', rotulo: 'O piso vale a partir do mês de operação', tipo: 'inteiro', min: 1, max: 60, unidade: 'º', modelos: ARR, itens: { arrend: ['remuneracao.piso'] } },
  { id: 'ctr-arr-fixo', rotulo: 'Valor mensal fixo pago ao dono', tipo: 'dinheiro', min: 0.01, max: 10_000_000, unidade: 'R$', modelos: ARR_TA, sensivel: true, itens: { arrend: ['remuneracao.fixo'], termo_arr: ['condicoes.remuneracao'] } },
  meses('ctr-arr-fixo-meses', 'Valor fixo nos primeiros (meses)', ARR, 120, { arrend: ['remuneracao.fixo'] }),
  { id: 'ctr-arr-reajuste', rotulo: 'Reajuste depois, a cada 12 meses', tipo: 'percentual', min: 0, max: 30, unidade: '%', decimal: '.', sensivel: true, modelos: ARR_TA, itens: { arrend: ['remuneracao.reajuste'], termo_arr: ['condicoes.remuneracao'] } },
  { id: 'ctr-arr-premio', rotulo: 'Valor já pago ao dono pela reserva', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: ARR, sensivel: true, espelho: true, zero: 'limpa' },
  { id: 'ctr-arr-dia', rotulo: 'Dia de pagar o dono do local (mês seguinte)', tipo: 'inteiro', min: 1, max: 28, modelos: ARR_TA, itens: { arrend: ['remuneracao.vencimento'], termo_arr: ['condicoes.remuneracao'] } },
  meses('ctr-arr-vigencia', 'Prazo mínimo do arrendamento', ARR_TA, 600, { arrend: ['prazo.vigencia'], termo_arr: ['condicoes.prazo'] }),
  meses('ctr-arr-renovacao', 'Renova sozinho por mais (meses)', ARR_TA, 600, { arrend: ['prazo.renovacao'], termo_arr: ['condicoes.prazo'] }),
  dias('ctr-arr-aviso', 'Aviso da NEXUS para não renovar', ARR_TA, 730, { arrend: ['prazo.renovacao'], termo_arr: ['condicoes.prazo'] }),
  dias('ctr-arr-implant', 'Fase de obra: ligar o ponto em até', ARR_TA, 730, { arrend: ['prazo.implantacao'], termo_arr: ['condicoes.prazo'] }),
  { id: 'ctr-arr-energia', rotulo: 'Energia do ponto', tipo: 'opcao', opcoes: ['uc', 'sub', 'refatura'], modelos: ARR_TA, itens: { arrend: ['energia.config', 'devolucao.retirada', 'ligacao.*'], termo_arr: ['condicoes.area'] } },
  { id: 'ctr-arr-horario', rotulo: 'Horário do ponto', tipo: 'opcao', opcoes: ['24h', 'estab', 'outro'], modelos: ARR_TA, itens: { arrend: ['operacao.horario'], termo_arr: ['condicoes.area'] } },
  { id: 'ctr-arr-horario-txt', rotulo: 'Horário do ponto, quando "outro"', tipo: 'texto', maxLen: 80, modelos: ARR_TA, itens: { arrend: ['operacao.horario'], termo_arr: ['condicoes.area'] } },
  { id: 'ctr-arr-multa-saida', rotulo: 'Multa por saída antecipada, em meses de remuneração', tipo: 'inteiro', min: 0, max: 36, unidade: 'meses', modelos: ARR, itens: { arrend: ['rescisao.multa'] } },
  { id: 'ctr-arr-multa-min', rotulo: 'Multa mínima por saída antecipada', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: ARR, zero: 'limpa', itens: { arrend: ['rescisao.multa'] } },
  dias('ctr-arr-retirada', 'Retirada do equipamento em', ARR, 365, { arrend: ['devolucao.retirada'] }),
  { id: 'ctr-arr-base', rotulo: 'Base de concreto no fim', tipo: 'opcao', opcoes: ['fica', 'sai'], modelos: ARR, itens: { arrend: ['devolucao.base'] } },
  { id: 'ctr-arr-mora-multa', rotulo: 'Multa por atraso do pagamento ao dono', tipo: 'percentual', min: 0, max: 10, unidade: '%', decimal: '.', modelos: ARR, itens: { arrend: ['remuneracao.mora'] } },
  { id: 'ctr-arr-mora-juros', rotulo: 'Juros de mora do pagamento ao dono, por mês', tipo: 'percentual', min: 0, max: 5, unidade: '% a.m.', decimal: '.', modelos: ARR, itens: { arrend: ['remuneracao.mora'] } },
  dias('ctr-arr-corrigir', 'Prazo para corrigir antes de rescindir', ARR, 90, { arrend: ['rescisao.descumprimento'] }),

  // ── Termo do arrendador ────────────────────────────────────────────────────
  dias('ctr-ta-prazo', 'Prazo para a NEXUS estudar o ponto', TA, 730, { termo_arr: ['estudo.prazo'] }),
  dias('ctr-ta-protocolo', 'NEXUS pede o acesso à distribuidora em até', TA, 365, { termo_arr: ['estudo.protocolo'] }),
  dias('ctr-ta-assinar', 'Assinar o contrato depois da confirmação em até', TA, 90, { termo_arr: ['exercicio.aviso'] }),
  dias('ctr-ta-docs', 'Dono entrega os documentos em até', TA, 90, { termo_arr: ['cedente.docs'] }),
  { id: 'ctr-ta-premio', rotulo: 'Valor pago ao dono pela reserva', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: TA, sensivel: true, zero: 'limpa', itens: { termo_arr: ['reserva.valor'] } },
  { id: 'ctr-ta-premio-quando', rotulo: 'Quando a reserva é paga', tipo: 'texto', maxLen: 80, modelos: TA, itens: { termo_arr: ['reserva.valor'] } },
  { id: 'ctr-ta-multa', rotulo: 'Multa se o dono recusar assinar', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: TA, sensivel: true, zero: 'limpa', itens: { termo_arr: ['exercicio.recusa', 'exercicio.nexus'] } },

  // ── Termo do investidor ────────────────────────────────────────────────────
  dias('ctr-ti-validade', 'A reserva vale por', TI, 365, { termo_inv: ['condicao.eventos'] }),
  dias('ctr-ti-assinar', 'Assinar o contrato depois que o capital fechar em até', TI, 90, { termo_inv: ['condicao.eventos'] }),
  dias('ctr-ti-desist', 'Desistência livre em até', TI, 90, { termo_inv: ['desistencia.livre', 'cotas.desistencia'] }, 7),
  dias('ctr-ti-devolucao', 'Devolução do depósito em até', TI, 90, { termo_inv: ['deposito.devolucao', 'cotas.desistencia'] }),
  { id: 'ctr-ti-deposito', rotulo: 'Depósito de reserva', tipo: 'dinheiro', min: 0, max: 10_000_000, unidade: 'R$', modelos: TI, sensivel: true, zero: 'limpa', itens: { termo_inv: ['deposito.valor', 'opc.ti_arras'] } },
  { id: 'ctr-ti-deposito-quando', rotulo: 'Quando o depósito é feito', tipo: 'texto', maxLen: 80, modelos: TI, itens: { termo_inv: ['deposito.valor'] } },
  { id: 'ctr-ti-raio', rotulo: 'Distância do ponto, em km', tipo: 'inteiro', min: 0, max: 1000, unidade: 'km', modelos: TI, itens: { termo_inv: ['objeto.reserva'] } },

  // ── Contrato solar do Fechamento (21/10/2026): um contrato só. `solar_m1` é o contrato; `solar_m2` é o mesmo, para papel antigo ──
  // Ids reais do formulário `fs-c-*`. Sensível = muda preço, equipamento ou o que a empresa promete ao cliente. NUNCA entram:
  // nome, CPF/CNPJ, RG, endereço e representante do cliente (`fs-*`), titular e número da UC, endereço da instalação
  // (`fs-c-endinst`), número do contrato (`fs-c-num`), dados da empresa e as formas de pagamento montadas (`fs-c-pagjson`, que só a tela escreve, pelo Montar e Aplicar).
  // As chaves de item abaixo são o CONTRATO com o front: o modelo de cláusulas do Fechamento tem de usá-las.
  { id: 'fs-c-data', rotulo: 'Data do contrato', tipo: 'data', modelos: SOL, itens: { solar_m1: ['assinaturas.fecho'], solar_m2: ['assinaturas.fecho'] } },
  { id: 'fs-c-foro', rotulo: 'Cidade e foro (comarca; a cidade também sai na linha da assinatura)', tipo: 'texto', maxLen: 80, modelos: SOL, itens: { solar_m1: ['foro.comarca'], solar_m2: ['foro.comarca'] } },
  { id: 'fs-c-valor', rotulo: 'Valor total do contrato solar', tipo: 'dinheiro', min: 0.01, max: 100_000_000, unidade: 'R$', modelos: SOL, sensivel: true, itens: { solar_m1: ['preco.valor'], solar_m2: ['preco.valor'] } },
  { id: 'fs-c-sinal', rotulo: 'Sinal do contrato solar (arras penitenciais; fica fora da tabela de pagamento, que soma o saldo)', tipo: 'dinheiro', min: 0, max: 100_000_000, unidade: 'R$', modelos: SOL, sensivel: true, itens: { solar_m1: ['preco.sinal', 'preco.forma', 'rescisao.antes'], solar_m2: ['preco.sinal', 'preco.forma', 'rescisao.antes'] } },
  { id: 'fs-c-pagto', rotulo: 'Como o cliente vai pagar (texto livre; só vira a tabela do contrato quando o consultor clica em Montar e Aplicar)', tipo: 'texto', maxLen: 800, multilinha: true, modelos: SOL, sensivel: true, itens: { solar_m1: ['preco.forma'], solar_m2: ['preco.forma'] } },
  { id: 'fs-c-kwp', rotulo: 'Potência instalada', tipo: 'numero', min: 0.1, max: 100_000, unidade: 'kWp', decimal: ',', modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-geracao', rotulo: 'Geração média estimada (estimativa, nunca garantia)', tipo: 'numero', min: 1, max: 10_000_000, unidade: 'kWh/mês', decimal: ',', modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-nmod', rotulo: 'Número de módulos', tipo: 'inteiro', min: 1, max: 10_000, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-mod', rotulo: 'Marca e potência do módulo', tipo: 'texto', maxLen: 80, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-ninv', rotulo: 'Número de inversores', tipo: 'inteiro', min: 1, max: 500, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-tinv', rotulo: 'Tipo do inversor', tipo: 'opcao', opcoes: ['on-grid', 'hibrido', 'off-grid', 'microinversor'], valoresHtml: { hibrido: 'híbrido' }, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-minv', rotulo: 'Marca e modelo do inversor', tipo: 'texto', maxLen: 80, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-bat-marca', rotulo: 'Bateria: marca e modelo (vazio = sem bateria)', tipo: 'texto', maxLen: 80, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-bat-qtd', rotulo: 'Bateria: quantidade', tipo: 'inteiro', min: 1, max: 200, modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-bat-cap', rotulo: 'Bateria: capacidade de cada uma', tipo: 'numero', min: 0.1, max: 10_000, unidade: 'kWh', decimal: ',', modelos: SOL, sensivel: true, itens: { solar_m1: ['objeto.sistema'], solar_m2: ['objeto.sistema'] } },
  { id: 'fs-c-bat-gar', rotulo: 'Garantia da bateria (do fabricante)', tipo: 'inteiro', min: 1, max: 30, unidade: 'anos', modelos: SOL, sensivel: true, itens: { solar_m1: ['garantias.bateria'], solar_m2: ['garantias.bateria'] } },
  { id: 'fs-c-pproj', rotulo: 'Prazo do projeto técnico, em dias úteis', tipo: 'inteiro', min: 1, max: 365, unidade: 'dias úteis', modelos: SOL, itens: { solar_m1: ['prazos.projeto'], solar_m2: ['prazos.projeto'] } },
  { id: 'fs-c-paprov', rotulo: 'Prazo de aprovação na concessionária', tipo: 'inteiro', min: 1, max: 365, unidade: 'dias', modelos: SOL, itens: { solar_m1: ['prazos.aprovacao'], solar_m2: ['prazos.aprovacao'] } },
  { id: 'fs-c-pinst', rotulo: 'Prazo da instalação (obra), em dias úteis', tipo: 'inteiro', min: 1, max: 365, unidade: 'dias úteis', modelos: SOL, itens: { solar_m1: ['prazos.obra'], solar_m2: ['prazos.obra'] } },
  { id: 'fs-c-gmod', rotulo: 'Garantia dos módulos (do fabricante)', tipo: 'inteiro', min: 1, max: 40, unidade: 'anos', modelos: SOL, sensivel: true, itens: { solar_m1: ['garantias.modulos'], solar_m2: ['garantias.modulos'] } },
  { id: 'fs-c-ginv', rotulo: 'Garantia do inversor (do fabricante)', tipo: 'inteiro', min: 1, max: 30, unidade: 'anos', modelos: SOL, sensivel: true, itens: { solar_m1: ['garantias.inversor'], solar_m2: ['garantias.inversor'] } },
  { id: 'fs-c-ginst', rotulo: 'Garantia da instalação (a unidade está em "Unidade da garantia da instalação")', tipo: 'inteiro', min: 1, max: 120, modelos: SOL, itens: { solar_m1: ['garantias.instalacao'], solar_m2: ['garantias.instalacao'] } },
  { id: 'fs-c-ginstun', rotulo: 'Unidade da garantia da instalação', tipo: 'opcao', opcoes: ['anos', 'meses'], modelos: SOL, itens: { solar_m1: ['garantias.instalacao'], solar_m2: ['garantias.instalacao'] } },
];

export const CAMPO_POR_ID: Map<string, CampoAgente> = new Map(CAMPOS_AGENTE.map(c => [c.id, c]));

/** Ids dos campos que são a origem do item (modelo + chave) do contrato. */
export function camposDoItem(modelo: string, itemKey: string): string[] {
  // Entrada terminada em ".*" vale para toda chave com esse prefixo (a cláusula "ligacao" inteira, por exemplo).
  const casa = (e: string) => e === itemKey || (e.endsWith('.*') && itemKey.startsWith(e.slice(0, -1)));
  return CAMPOS_AGENTE.filter(c => (c.itens?.[modelo as TipoContratoAg] || []).some(casa)).map(c => c.id);
}

/** Campos que valem em ao menos um dos modelos dados. */
export function camposDosModelos(modelos: readonly string[]): CampoAgente[] {
  return CAMPOS_AGENTE.filter(c => c.modelos.some(m => modelos.includes(m)));
}

// ── Validação de valor ───────────────────────────────────────────────────────
export type ValorValidado = { ok: true; valor: string } | { ok: false; motivo: string };

const erro = (motivo: string): ValorValidado => ({ ok: false, motivo });

/** Dado pessoal no meio de um texto: CPF e CNPJ formatados, e-mail e sequência longa de dígitos. */
export const PII_NO_TEXTO = /(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})|([\w.+-]+@[\w-]+\.[\w.-]+)|(\d{11,})|(\(?\d{2}\)?\s?9?\d{4}[-\s]\d{4})/;

/**
 * Dinheiro no formato BR ("145.000,00"). Entradas aceitas: "145000", "145.000" (milhar), "145000,5", "145.000,50",
 * "145000.50" (decimal com 1 ou 2 casas), "R$ 145.000,00". NUNCA lê "145.000" como 145. O que for ambíguo
 * ("145,000", "1,234.56", dois separadores decimais) é recusado: perguntar custa menos que errar o preço.
 */
export function dinheiroBR(bruto: string): { ok: true; centavos: number } | { ok: false; motivo: string } {
  const s = String(bruto ?? '').replace(/R\$|\s/g, '');
  if (!s) return { ok: false, motivo: 'valor vazio' };
  if (!/^\d[\d.,]*$/.test(s)) return { ok: false, motivo: 'valor com caractere inválido' };
  let t: string;
  const virgulas = (s.match(/,/g) || []).length;
  if (virgulas > 1) return { ok: false, motivo: 'valor ambíguo' };
  if (virgulas === 1) {
    const [int, dec] = s.split(',');
    if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(int)) return { ok: false, motivo: 'valor ambíguo' };
    if (!/^\d{1,2}$/.test(dec)) return { ok: false, motivo: 'valor ambíguo' };
    t = int.replace(/\./g, '') + '.' + dec;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    t = s.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    t = s;
  } else if (/^\d+$/.test(s)) {
    t = s;
  } else {
    return { ok: false, motivo: 'valor ambíguo' };
  }
  const n = Number(t);
  if (!isFinite(n)) return { ok: false, motivo: 'valor inválido' };
  return { ok: true, centavos: Math.round(n * 100) };
}

export function formatarBR(centavos: number): string {
  const reais = Math.floor(centavos / 100);
  const cent = String(centavos % 100).padStart(2, '0');
  return String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + cent;
}

function decimalSimples(bruto: string): number | null {
  // "1.500" e "1,500" são ambíguos (milhar ou decimal): recusa, como no dinheiro.
  if (/[.,]\d{3}/.test(String(bruto ?? ''))) return null;
  const s = String(bruto ?? '').replace(/[%\s]|ao mês|a\.m\./gi, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Valida e normaliza `bruto` para o formato que o campo do formulário espera. */
export function validarValorCampo(c: CampoAgente, bruto: unknown): ValorValidado {
  const v = String(bruto ?? '').trim();
  switch (c.tipo) {
    case 'dinheiro': {
      if (v === '' && c.zero === 'limpa') return { ok: true, valor: '' };
      const d = dinheiroBR(v);
      if (!d.ok) return erro(d.motivo === 'valor ambíguo' ? 'o valor em dinheiro veio ambíguo' : 'o valor em dinheiro é inválido');
      const n = d.centavos / 100;
      if (n === 0) {
        if (c.zero === 'limpa') return { ok: true, valor: '' };
        if (c.zero === 'sim') return { ok: true, valor: '0,00' };
        return erro('zero não vale neste campo');
      }
      if (n < (c.min ?? 0) || n > (c.max ?? 1e12)) return erro('o valor está fora da faixa permitida');
      return { ok: true, valor: formatarBR(d.centavos) };
    }
    case 'percentual':
    case 'numero': {
      const n = decimalSimples(v);
      if (n == null) return erro('o número é inválido');
      if (n < (c.min ?? 0) || n > (c.max ?? 1e9)) return erro('o número está fora da faixa permitida');
      const txt = String(n);
      return { ok: true, valor: c.decimal === ',' ? txt.replace('.', ',') : txt };
    }
    case 'inteiro': {
      // "1.000" é mil, não 1: qualquer separador seguido de três dígitos é ambíguo e recusado.
      if (/[.,]\d{3}/.test(v) || !/^\d+([.,]0{1,2})?$/.test(v)) return erro('o número inteiro é inválido');
      const n = Math.round(Number(v.replace(',', '.')));
      if (n < (c.min ?? 0) || n > (c.max ?? 1e9)) return erro('o número está fora da faixa permitida');
      return { ok: true, valor: String(n) };
    }
    case 'data': {
      let iso = v;
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
      if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if (!m) return erro('a data é inválida');
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return erro('a data não existe');
      if (+m[1] < 2020 || +m[1] > 2100) return erro('o ano da data está fora do esperado');
      return { ok: true, valor: iso };
    }
    case 'opcao': {
      // Sem acento e sem caixa: a IA escreve "hibrido" ou "híbrido" e as duas valem (o formulário recebe `valoresHtml`).
      const base = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const achada = (c.opcoes || []).find(o => base(o) === base(v));
      return achada ? { ok: true, valor: achada } : erro('a opção não existe neste campo');
    }
    case 'texto': {
      // Tag inteira sai, e qualquer "<" ou ">" que sobrar também (tag aberta e não fechada vira HTML na prévia).
      const semTag = v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
      const limpo = (c.multilinha ? semTag.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
        : semTag.replace(/\s+/g, ' ').trim());
      if (!limpo) return erro('o texto veio vazio');
      if (limpo.length > (c.maxLen ?? 200)) return erro('o texto é longo demais para este campo');
      if (PII_NO_TEXTO.test(limpo)) return erro('o texto tinha dado pessoal (documento, e-mail ou telefone)');
      return { ok: true, valor: limpo };
    }
  }
}

/** O que o front recebe na rota GET /campos. `itens` fica de fora do contrato mínimo mas ajuda o front a mostrar a origem. */
export function listaParaFront(): CampoAgente[] {
  return CAMPOS_AGENTE.map(c => ({ ...c }));
}
