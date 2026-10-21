/* Portal do Parceiro NEXUS · conta do eletroposto.
 *
 * Copia FIEL da conta do Simulador do /gerador (dashboard/public/gerador/index.html):
 *   computeEletro (15482), eletroCenariosSens (15731), pmtPriceCarencia (9114),
 *   ORC_ENTRADA_PARC e ORC_FIN_PARC (19381-19406), proximaSexta18/prazoExtenso (19642-19662).
 * Mesmos padroes, mesmas formulas. Funcoes PURAS: nada aqui le o DOM, para a mesma conta rodar
 * no navegador (window.NexusCalc) e no Node (module.exports), que e' como o teste a confere.
 *
 * Decisoes que diferem do /gerador, todas de proposito:
 *  - O investimento NAO e' digitado: e' o total da proposta (equipamento x quantidade + itens).
 *  - Carros por dia e' o TOTAL do posto, mesmo com 2 carregadores (igual ao Simulador).
 *  - "Bicos de carregamento" saiu: no Simulador ele e' so informativo, nao entra em formula e
 *    imprimiria uma especificacao que o catalogo nao tem.
 *  - Nada de preco de revenda aqui. Margem do parceiro nao e' conta de documento.
 */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.NexusCalc = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ===== Constantes (nome e valor iguais aos do /gerador quando existem la) =====
  var EL_TAXA_DESC = 14.25;            // taxa de desconto do VPL, em % a.a. (fixa no /gerador)
  var ORC_ENTRADA_PARC = 18;           // cartao: parcelas padrao (igual ao /gerador)
  var CARTAO_ACRESCIMO_PADRAO = 0;     // cartao: acrescimo TOTAL padrao, em %. No /gerador (ORC_ENTRADA_JUROS) e' 22,5; aqui
                                       // o padrao e' sem acrescimo (decisao do dono, 21/10), editavel
  var ORC_FIN_PARC = 96;               // financiamento: "ate 96x"
  var FIN_CARENCIA_DIAS = 120;         // financiamento: carencia, em dias (= 4 meses de 30 dias)
  var FIN_TAXA_PADRAO = 1.49;          // financiamento: taxa de referencia, % ao mes, editavel
  var CUSTO_KWH_SOLAR = 0.30;          // "Usina solar propria": custo do kWh, editavel
  var ENTREGA_PADRAO = 'Entrega na primeira quinzena de dezembro';
  var INSTALACAO_PADRAO = 'Instalação combinada com o cliente depois da entrega';
  var TZ = 'America/Sao_Paulo';

  // Premissas do Simulador, como o consultor as ve (percentual em "10", nao em 0,10).
  // Os valores sao os value="" dos campos el-* do /gerador (linhas 5379-5457).
  var PREMISSAS_PADRAO = Object.freeze({
    carros: 10, carga: 20, custoKwh: 0.70, precoKwh: 2.35, ativacao: 1.20,
    software: 10, arrend: 0, manutMes: 200, assinat: 200, imposto: 6, fixos: 0,
    ocup: 50, rampa: 6
  });

  // Recargas por dia: o padrao e' 10 POR CARREGADOR (10 x quantidade) enquanto o parceiro nao editar o campo.
  // O campo em si e' o total do posto (como o "carros por dia" do Simulador).
  var RECARGAS_POR_CARREGADOR = 10;
  function recargasPadrao(qtd) { return RECARGAS_POR_CARREGADOR * Math.min(50, Math.max(1, Math.round(Number(qtd)) || 1)); }

  // ===== Formatadores (padrao do /gerador: 15469-15477, 15597-15598, 19620-19621) =====
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  var nf0 = { maximumFractionDigits: 0 };
  var nf2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  function fmtMilhar(v) { return Math.round(num(v)).toLocaleString('pt-BR'); }
  function moeda(n) { return 'R$ ' + Math.round(num(n)).toLocaleString('pt-BR', nf0); }
  function moeda2(n) { return 'R$ ' + num(n).toLocaleString('pt-BR', nf2); }
  function moedaK(n) { n = num(n); return (n < 0 ? '-' : '') + 'R$ ' + Math.abs(Math.round(n)).toLocaleString('pt-BR'); }
  // Sem travessao: onde o /gerador devolvia o caractere de travessao, aqui sai texto.
  function pct1(v) { return v == null ? 'Indisponível' : (v * 100).toFixed(1).replace('.', ',') + '%'; }
  function anos1(v) { return v == null ? 'Não se paga em 10 anos' : v.toFixed(1).replace('.', ',') + ' anos'; }
  function pctRot(f) { return (Number(f) * 100).toFixed(1).replace('.', ',').replace(',0', '') + '%'; }

  // Campo de dinheiro digitado a mao. "145.000" NAO e' 145 (licao do /gerador): ponto de milhar
  // so e' tirado quando o texto tem a forma 1.234 ou 1.234.567; com virgula, o ponto e' milhar.
  function lerMoeda(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
    var s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  }
  // Numero comum (carros, kWh, %): aceita virgula decimal.
  function lerNumero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  // ===== A CONTA (copia de computeEletro, /gerador 15482-15570) =====
  // Recebe os parametros crus (percentuais ja em fracao 0-1) e devolve tudo derivado.
  function computeEletro(p) {
    var DIAS = 30, ANOS = 10;
    var kwhMes = p.carros * p.carga * DIAS;
    var sessoes = p.carros * DIAS;
    var fatMes = kwhMes * p.precoKwh + sessoes * p.ativacao;

    var custoEnergia = kwhMes * p.custoKwh;
    // `|| 0` e' compatibilidade: proposta salva sem a chave nao pode contaminar a soma com NaN.
    var taxasPct = p.arrend + p.imposto + (p.software || 0);
    var seguroMes = p.invest * 0.01 / 12;
    var fixosMes = p.assinat + seguroMes + (p.fixos || 0) + (p.manutMes || 0);
    var margemVarMes = fatMes - custoEnergia - fatMes * taxasPct;
    var lucroMes = margemVarMes - fixosMes;
    var custosMes = fatMes - lucroMes;
    var margem = fatMes > 0 ? lucroMes / fatMes : 0;

    var fatAno = fatMes * 12, custosAno = custosMes * 12, lucroAno = lucroMes * 12;
    var investTotal = p.invest;

    // Rampa: cresce linear de ocupIni ate 100% em mesesRampa meses. Fixos nao encolhem.
    var ocupIni = Math.min(1, Math.max(0, p.ocupIni == null ? 1 : p.ocupIni));
    var mRampa = Math.max(1, Math.round(p.mesesRampa == null ? 1 : p.mesesRampa));
    var occ = function (m) { return (mRampa <= 1 || m >= mRampa) ? 1 : ocupIni + (1 - ocupIni) * (m - 1) / (mRampa - 1); };

    var fluxoAnual = [];
    for (var a = 0; a < ANOS; a++) {
      var luc = 0;
      for (var m = 1; m <= 12; m++) luc += margemVarMes * occ(a * 12 + m) - fixosMes;
      fluxoAnual.push(luc);
    }
    var lucroAno1 = fluxoAnual[0];

    // Fluxo ACUMULADO + payback simples interpolado
    var fluxo = [];
    var acc = -investTotal, payback = null;
    fluxoAnual.forEach(function (f, i) {
      var antes = acc; acc += f; fluxo.push(acc);
      if (payback === null && acc >= 0 && f > 0) payback = i + (0 - antes) / f;
    });
    var acumulado10 = fluxo[ANOS - 1];
    var roi10 = investTotal > 0 ? acumulado10 / investTotal : 0;

    // VPL + payback descontado
    var tx = Math.max(0, p.taxaDesc || 0);
    var vpl = -investTotal, accD = -investTotal, paybackDesc = null;
    fluxoAnual.forEach(function (f, i) {
      var d = f / Math.pow(1 + tx, i + 1);
      var antes = accD; vpl += d; accD += d;
      if (paybackDesc === null && accD >= 0 && d > 0) paybackDesc = i + (0 - antes) / d;
    });

    // TIR por biseccao (so existe se o projeto se paga nominalmente no horizonte)
    var tir = null;
    if (investTotal > 0 && fluxoAnual.some(function (f) { return f > 0; })) {
      var npv = function (r) { return fluxoAnual.reduce(function (v, f, i) { return v + f / Math.pow(1 + r, i + 1); }, -investTotal); };
      if (npv(0) > 0) {
        var lo = 0, hi = 10;
        for (var i = 0; i < 80; i++) { var mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
        tir = (lo + hi) / 2;
      }
    }

    return Object.assign({}, p, {
      kwhMes: kwhMes, fatMes: fatMes, custosMes: custosMes, lucroMes: lucroMes, margem: margem,
      fatAno: fatAno, custosAno: custosAno, lucroAno: lucroAno, lucroAno1: lucroAno1,
      fluxoAnual: fluxoAnual, investTotal: investTotal, payback: payback, paybackDesc: paybackDesc,
      fluxo: fluxo, acumulado10: acumulado10, roi10: roi10, seguroMes: seguroMes, fixosMes: fixosMes,
      vpl: vpl, tir: tir, taxaDesc: tx, ocupIni: ocupIni, mesesRampa: mRampa
    });
  }

  // Cenarios de sensibilidade: Conservador (-40% demanda) / Base / Otimista (+40%) (/gerador 15731).
  function cenariosSens(base) {
    var b = Math.max(1, Math.round(base.carros));
    return [
      { rot: 'Conservador', nota: '-40% demanda', carros: Math.max(1, Math.round(b * 0.6)) },
      { rot: 'Base', nota: 'premissa do estudo', carros: b },
      { rot: 'Otimista', nota: '+40% demanda', carros: Math.round(b * 1.4) }
    ].map(function (c) { return Object.assign({}, c, { r: computeEletro(Object.assign({}, base, { carros: c.carros })) }); });
  }

  // Premissas como digitadas (%) -> parametros crus da conta (fracao). Espelho de eletroParams().
  function paramsDe(prem, invest) {
    var P = prem || {};
    return {
      carros: num(P.carros), carga: num(P.carga), custoKwh: num(P.custoKwh),
      precoKwh: num(P.precoKwh), ativacao: num(P.ativacao),
      invest: Math.max(0, num(invest)), assinat: num(P.assinat), fixos: num(P.fixos),
      arrend: num(P.arrend) / 100, manutMes: num(P.manutMes), imposto: num(P.imposto) / 100,
      software: num(P.software) / 100,
      ocupIni: num(P.ocup) / 100, mesesRampa: num(P.rampa),
      taxaDesc: EL_TAXA_DESC / 100
    };
  }

  // ===== Financiamento e cartao =====
  // Parcela Price com carencia: durante a carencia os juros capitalizam no saldo (/gerador 9115).
  // Unica diferenca: taxa 0 devolve pv/n (no /gerador daria divisao por zero; la a taxa nunca e' 0).
  function pmtPriceCarencia(pv, i, n, carenciaMeses) {
    if (!pv || pv <= 0) return 0;
    if (!(i > 0)) return pv / n;
    var saldo = pv * Math.pow(1 + i, carenciaMeses);
    return saldo * i / (1 - Math.pow(1 + i, -n));
  }
  // Cartao: o acrescimo e' TOTAL sobre o que sobrou depois da entrada, nao juro ao mes (/gerador 19388).
  function orcEntradaParcela(restante, parcelas, juros) {
    var n = Math.max(1, Math.round(num(parcelas) || ORC_ENTRADA_PARC));
    return Math.max(0, num(restante)) * (1 + Math.max(0, num(juros)) / 100) / n;
  }

  // ===== O total da proposta e a condicao de pagamento =====
  var ITENS_PADRAO = [
    { id: 'infra', nome: 'Infraestrutura elétrica' },
    { id: 'entrada', nome: 'Adequação de entrada de energia ou transformador' },
    { id: 'projeto', nome: 'Projeto elétrico e homologação na distribuidora' },
    { id: 'civil', nome: 'Obra civil (base, piso, sinalização da vaga)' },
    { id: 'instal', nome: 'Instalação e comissionamento' },
    { id: 'outros', nome: 'Outros', livre: true }
  ];

  // Servicos NEXUS na proposta (cartao opcional, desligado por padrao). Engenharia e consultoria entram com o valor
  // que o PARCEIRO digita (o preco dele ao cliente: preco de parceiro nunca aparece). A plataforma nao tem valor de
  // venda: e' so uma linha informativa, e o Software NEXUS (prem.software) ja' esta na conta. Chave desligada = nada conta,
  // mesmo com valor digitado; proposta antiga, sem a chave "servicos", segue igual a antes.
  var SERVICOS_PROPOSTA = [
    { id: 'svc-eng', chave: 'engenharia', nome: 'Engenharia NEXUS (projeto, ART e homologação)' },
    { id: 'svc-cons', chave: 'consultoria', nome: 'Consultoria de vendas NEXUS' }
  ];
  function servicosDe(form) {
    var s = form && form.servicos;
    if (!s || !s.ligado) return [];
    return SERVICOS_PROPOSTA.map(function (x) {
      return { id: x.id, nome: x.nome, valor: lerMoeda(s[x.chave]), livre: false, servico: true };
    }).filter(function (x) { return x.valor > 0; });
  }
  // Linha informativa da plataforma ('' quando nao vai na proposta). O percentual e' o do Software NEXUS da conta.
  function plataformaLinha(form) {
    var s = form && form.servicos;
    if (!s || !s.ligado || s.plataforma === false) return '';
    var prem = (form && form.prem) || {};
    var pct = prem.software === '' || prem.software == null ? PREMISSAS_PADRAO.software : num(prem.software);
    return 'Plataforma NEXUS de gestão' + (pct > 0 ? ' · ' + pctRot(pct / 100) + ' do faturamento em recarga' : '');
  }

  // Itens da proposta que entram no valor: os da infraestrutura e os servicos NEXUS com valor.
  function itensDe(form) {
    var itens = (form && form.itens) || [];
    return itens.map(function (i) {
      var valor = lerMoeda(i.valor);
      var nome = i.livre ? (String(i.descricao || '').trim() || 'Outros') : i.nome;
      return { id: i.id, nome: nome, valor: valor, livre: !!i.livre };
    }).concat(servicosDe(form));
  }

  // Total = equipamento x quantidade + itens (spec). Tudo em REAIS. "servicos" ja' esta dentro de "itens".
  function totalProposta(form) {
    var e = (form && form.equip) || {};
    var qtd = Math.max(0, Math.round(num(e.quantidade)));
    var equipamento = lerMoeda(e.preco) * qtd;
    var itens = itensDe(form).reduce(function (s, i) { return s + i.valor; }, 0);
    var servicos = servicosDe(form).reduce(function (s, i) { return s + i.valor; }, 0);
    return { equipamento: equipamento, itens: itens, servicos: servicos, total: equipamento + itens };
  }

  // Condicao de pagamento. Cada forma liga/desliga; a entrada e' opcional (0 = sem entrada).
  function pagamento(total, pg) {
    var P = pg || {};
    var out = { vista: null, cartao: null, fin: null };
    if (P.vista !== false) out.vista = { valor: total };
    if (P.cartao !== false) {
      var ent = Math.max(0, Math.min(lerMoeda(P.cartaoEntrada), total));
      var n = Math.max(1, Math.round(lerNumero(P.cartaoParcelas) || ORC_ENTRADA_PARC));
      var juros = Math.max(0, P.cartaoJuros == null || P.cartaoJuros === '' ? CARTAO_ACRESCIMO_PADRAO : lerNumero(P.cartaoJuros));
      var restante = Math.max(0, total - ent);
      out.cartao = { entrada: ent, parcelas: n, juros: juros, restante: restante, parcela: orcEntradaParcela(restante, n, juros) };
    }
    if (P.fin !== false) {
      var entF = Math.max(0, Math.min(lerMoeda(P.finEntrada), total));
      var nF = Math.max(1, Math.round(lerNumero(P.finParcelas) || ORC_FIN_PARC));
      var taxa = P.finTaxa == null || P.finTaxa === '' ? FIN_TAXA_PADRAO : Math.max(0, lerNumero(P.finTaxa));
      var carDias = P.finCarenciaDias == null || P.finCarenciaDias === '' ? FIN_CARENCIA_DIAS : Math.max(0, lerNumero(P.finCarenciaDias));
      var carencia = carDias / 30;          // meses; 120 dias = 4 meses
      var financiado = Math.max(0, total - entF);
      out.fin = { entrada: entF, parcelas: nF, taxa: taxa, carencia: carencia, carenciaDias: carDias, financiado: financiado,
                  parcela: pmtPriceCarencia(financiado, taxa / 100, nF, carencia) };
    }
    return out;
  }

  // Retorno em operacao plena, em meses: investimento / lucro mensal pleno. E' o numero da tela
  // ("Retorno em cerca de N meses"). NAO e' o payback do Simulador (r.payback), que aplica a rampa de
  // ocupacao e e' interpolado por ano. Null quando o lucro pleno nao e' positivo.
  function paybackPlenoMeses(r) {
    return r && r.lucroMes > 0 && r.investTotal > 0 ? r.investTotal / r.lucroMes : null;
  }

  // Caixa acumulado mes a mes (grafico da tela). Comeca em -investimento. Por padrao e' em OPERACAO PLENA
  // (lucro mensal constante, como o desenho aprovado); com comRampa=true usa a MESMA conta do fluxo anual
  // de computeEletro (margem variavel x ocupacao do mes menos os fixos).
  function fluxoMensal(r, meses, comRampa) {
    var n = Math.max(1, Math.round(meses || 60));
    var margemVarMes = r.fatMes - r.kwhMes * r.custoKwh - r.fatMes * (r.arrend + r.imposto + (r.software || 0));
    var ocupIni = r.ocupIni, mRampa = r.mesesRampa;
    var occ = function (m) { return (!comRampa || mRampa <= 1 || m >= mRampa) ? 1 : ocupIni + (1 - ocupIni) * (m - 1) / (mRampa - 1); };
    var acc = -r.investTotal, pontos = [acc], cruza = null;
    for (var m = 1; m <= n; m++) {
      var antes = acc;
      var lucro = margemVarMes * occ(m) - r.fixosMes;
      acc += lucro;
      pontos.push(acc);
      if (cruza === null && acc >= 0 && lucro > 0) cruza = (m - 1) + (0 - antes) / lucro;
    }
    return { pontos: pontos, cruza: cruza };
  }

  // Tudo que a tela e os tres documentos leem, de um unico lugar.
  function calcular(form) {
    var t = totalProposta(form);
    var prem = Object.assign({}, PREMISSAS_PADRAO, (form && form.prem) || {});
    var p = paramsDe(prem, t.total);
    var r = computeEletro(p);
    return { totais: t, prem: prem, p: p, r: r, cen: cenariosSens(p), pg: pagamento(t.total, form && form.pg),
             paybackPleno: paybackPlenoMeses(r) };
  }

  // ===== Validade (padrao do /gerador: proxima sexta 18h de Brasilia, ou N dias) =====
  var SP_OFFSET_MS = 3 * 3600 * 1000;  // Brasil sem horario de verao: 18h de Brasilia = 21h UTC
  function proximaSexta18(base) {
    var agora = (base instanceof Date && !isNaN(base)) ? base : new Date();
    var sp = new Date(agora.getTime() - SP_OFFSET_MS);
    var faltam = (5 - sp.getUTCDay() + 7) % 7;
    var alvo = Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + faltam, 21, 0, 0);
    if (alvo - agora.getTime() < 86400000) alvo += 7 * 86400000;
    return new Date(alvo);
  }
  function dataBR(d) { return (d instanceof Date ? d : new Date(d)).toLocaleDateString('pt-BR', { timeZone: TZ }); }
  function prazoExtenso(quando) {
    var dt = (quando instanceof Date) ? quando : new Date(quando);
    if (isNaN(dt.getTime())) return '';
    var tz = { timeZone: TZ };
    var semana = dt.toLocaleDateString('pt-BR', Object.assign({ weekday: 'long' }, tz)).replace('-feira', '');
    var hora = dt.toLocaleTimeString('pt-BR', Object.assign({ hour: '2-digit', minute: '2-digit' }, tz)).replace(':00', 'h');
    return semana + ', ' + dataBR(dt) + ', às ' + hora;
  }
  function validadeDias(dias, base) {
    dias = Math.max(1, Math.round(num(dias) || 2));
    var ate = new Date((base || new Date()).getTime() + dias * 86400000);
    return 'Válido por ' + dias + (dias === 1 ? ' dia' : ' dias') + ' · até ' + dataBR(ate);
  }
  // form.validade = {modo:'sexta'|'dias', dias}. Devolve o texto do selo.
  function validadeTexto(v, base) {
    base = base || new Date();
    if (v && v.modo === 'dias') return validadeDias(Math.min(365, Math.max(1, Math.round(num(v.dias) || 2))), base);
    return 'Válido até ' + prazoExtenso(proximaSexta18(base));
  }

  // Nome do arquivo (vira document.title na impressao): sem acento e sem espaco, com hifen.
  // Ex.: Proposta-Eletroposto-JoaoSilva-20260001, Orcamento-Basico-Eletroposto-..., Simulador-Eletroposto-...
  var PREFIXO_ARQ = { simulador: 'Simulador', basico: 'Orcamento-Basico', completo: 'Proposta' };
  function nomeArquivo(saida, cliente, numero) {
    var limpa = function (s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '');
    };
    return [PREFIXO_ARQ[saida] || 'Proposta', 'Eletroposto', limpa(cliente) || 'Cliente', limpa(numero)]
      .filter(Boolean).join('-');
  }

  return {
    EL_TAXA_DESC: EL_TAXA_DESC, ORC_ENTRADA_PARC: ORC_ENTRADA_PARC, CARTAO_ACRESCIMO_PADRAO: CARTAO_ACRESCIMO_PADRAO,
    ORC_FIN_PARC: ORC_FIN_PARC, FIN_CARENCIA_DIAS: FIN_CARENCIA_DIAS, FIN_TAXA_PADRAO: FIN_TAXA_PADRAO,
    CUSTO_KWH_SOLAR: CUSTO_KWH_SOLAR, ENTREGA_PADRAO: ENTREGA_PADRAO, INSTALACAO_PADRAO: INSTALACAO_PADRAO, TZ: TZ,
    PREMISSAS_PADRAO: PREMISSAS_PADRAO, ITENS_PADRAO: ITENS_PADRAO,
    RECARGAS_POR_CARREGADOR: RECARGAS_POR_CARREGADOR, recargasPadrao: recargasPadrao,
    num: num, fmtMilhar: fmtMilhar, moeda: moeda, moeda2: moeda2, moedaK: moedaK, pct1: pct1, anos1: anos1,
    pctRot: pctRot, lerMoeda: lerMoeda, lerNumero: lerNumero,
    computeEletro: computeEletro, cenariosSens: cenariosSens, paramsDe: paramsDe,
    pmtPriceCarencia: pmtPriceCarencia, orcEntradaParcela: orcEntradaParcela,
    itensDe: itensDe, servicosDe: servicosDe, plataformaLinha: plataformaLinha, SERVICOS_PROPOSTA: SERVICOS_PROPOSTA, totalProposta: totalProposta, pagamento: pagamento, calcular: calcular,
    paybackPlenoMeses: paybackPlenoMeses, fluxoMensal: fluxoMensal,
    proximaSexta18: proximaSexta18, prazoExtenso: prazoExtenso, dataBR: dataBR,
    validadeDias: validadeDias, validadeTexto: validadeTexto, nomeArquivo: nomeArquivo
  };
});
