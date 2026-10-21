/* Portal do Parceiro NEXUS · Simulador em PDF ("Resumo do Investimento", uma folha A4).
 *
 * Copia de eletroTelaA4 (/gerador/index.html 21232-21418) e plFluxoSVG (21204-21230), com a MESMA ordem:
 * primeiro o que o cliente decide, depois o resultado, por ultimo a memoria de calculo.
 * O calculo nao e' mexido: tudo sai de NexusCalc.computeEletro (P.calc.r).
 *
 * Adaptado: topo com co-branding; "Elaborado por" saiu (nao ha consultor da casa); bloco de contato do
 * parceiro; "Bicos de carregamento" saiu (informativo no /gerador, e o catalogo nao tem esse dado);
 * rotulos em maiuscula inicial; nenhum travessao; aviso do simulador (bloco E).
 */
(function () {
  'use strict';
  var C = window.NexusCalc, D = window.NexusDocs, esc = D.esc;

  // Fluxo de caixa com rotulo de valor em cada barra (plFluxoSVG). Escala pela AMPLITUDE (maior positivo
  // + maior negativo), nao pelo maior absoluto, para os anos de payback nao saírem cortados.
  function fluxoSVG(fluxo) {
    var W = 720, H = 168, padX = 18, padTop = 16, axis = 30;
    var n = fluxo.length, gap = (W - padX * 2) / n, bw = gap * 0.54;
    var maxPos = Math.max.apply(null, [0].concat(fluxo));
    var maxNeg = Math.max.apply(null, [0].concat(fluxo.map(function (v) { return -v; })));
    var amp = Math.max(1, maxPos + maxNeg);
    var scale = (H - padTop - axis) / amp;
    var zeroY = padTop + maxPos * scale;
    var out = '';
    fluxo.forEach(function (v, i) {
      var x = padX + gap * i + (gap - bw) / 2, h = Math.abs(v) * scale, neg = v < 0;
      var y = neg ? zeroY : zeroY - h;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (neg ? '#B91C1C' : '#0B1A2B') + '" rx="2"></rect>';
      var ly = neg ? y + h + 9.5 : y - 4.5;
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="9.5" font-weight="700" fill="' + (neg ? '#B91C1C' : '#0B1A2B') + '" text-anchor="middle">' + C.moedaK(v) + '</text>';
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" font-size="9" fill="#6B7684" text-anchor="middle">Ano ' + (i + 1) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:100%;display:block" role="img" aria-label="Fluxo de caixa acumulado em 10 anos">'
      + '<line x1="' + padX + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - padX) + '" y2="' + zeroY.toFixed(1) + '" stroke="#C7D0DC" stroke-width="1"></line>' + out + '</svg>';
  }
  D.fluxoSVG = fluxoSVG;

  D.simulador = function (P) {
    var r = P.calc.r, prem = P.calc.prem, money = C.moeda;
    var txPct = (r.taxaDesc * 100).toFixed(2).replace('.', ',') + '% a.a.';
    var pb = C.anos1(r.payback);
    var cru = P.form.prem || {};
    // Campo vazio nao vira linha vazia no papel; zero digitado fica (e' informacao, nao lacuna).
    var seTem = function (k, valor) { return (cru[k] === '' || cru[k] == null) ? '' : valor; };
    var kv = function (rows) {
      return rows.filter(function (x) { return x && x[1] !== '' && x[1] != null; })
        .map(function (x) { return '<tr' + (x[2] ? ' class="hl"' : '') + '><td>' + x[0] + '</td><td class="num">' + x[1] + '</td></tr>'; }).join('');
    };

    // A frase, gerada dos numeros (mesmas ramificacoes do /gerador). Frase fixa vira mentira no dia em que
    // alguem digita um investimento ruim.
    var verdito = r.tir == null
      ? '<b>Atenção:</b> nestas premissas o investimento <b>não se paga dentro dos 10 anos</b> projetados. Vale revisar a demanda de carros por dia, o preço do kWh ao motorista ou o valor do projeto antes de seguir.'
      : (r.vpl > 0
        ? 'Em português: são <b>' + money(r.investTotal) + '</b> de investimento e o posto devolve <b>' + money(r.lucroMes) + ' por mês</b> quando estiver em regime. O capital volta em <b>' + pb + '</b>, e daí em diante o que entra é retorno: <b>' + C.pct1(r.tir) + ' ao ano</b>, acima da taxa de referência de ' + txPct + ' usada como comparação. Ao fim de 10 anos o projeto acumula <b>' + money(r.acumulado10) + '</b> além do que foi investido.'
        : 'Em português: são <b>' + money(r.investTotal) + '</b> de investimento e o posto devolve <b>' + money(r.lucroMes) + ' por mês</b> em regime, com o capital de volta em <b>' + pb + '</b> (<b>' + C.pct1(r.tir) + ' ao ano</b>). Nestas premissas o resultado fica <b>abaixo</b> da taxa de referência de ' + txPct + ': o projeto se paga, mas rende menos que o custo de oportunidade adotado.');

    // Hero: os QUATRO numeros que decidem a compra.
    var hero = [
      ['Investimento total', money(r.investTotal), 'O que sai do bolso'],
      ['Lucro por mês', money(r.lucroMes), 'Em regime pleno'],
      ['Retorno do capital', pb, 'Payback simples'],
      ['Rentabilidade', r.tir == null ? 'Indisponível' : C.pct1(r.tir), r.tir == null ? 'Não alcançada em 10 anos' : 'Ao ano (TIR)']
    ].map(function (h) { return '<div class="pl-hero"><div class="k">' + h[0] + '</div><div class="v">' + h[1] + '</div><div class="s">' + h[2] + '</div></div>'; }).join('');

    var tira = [
      ['VPL a ' + txPct, money(r.vpl), r.vpl > 0 ? 'pos' : 'neg'],
      ['ROI em 10 anos', Math.round(r.roi10 * 100) + '%', ''],
      ['Payback descontado', C.anos1(r.paybackDesc), '']
    ].map(function (c) { return '<span class="pl-ti"><i>' + c[0] + '</i><b class="' + c[2] + '">' + c[1] + '</b></span>'; }).join('');

    var pctTxt = function (f) { return (f * 100).toLocaleString('pt-BR') + '%'; };
    var html = '<div class="ep-doc pl-rx"><div class="ep-page">'
      + D.topoHTML(P, 'Resumo do Investimento', [
          ['Cliente', P.cliente.nome ? esc(P.cliente.nome) : ''],
          ['Local', P.cliente.local ? esc(P.cliente.local) : ''],
          ['Equipamento', esc(P.modelo) + (P.quantidade > 1 ? ' · ' + P.quantidade + ' unidades' : '')],
          ['Proposta', P.numero ? 'Nº ' + esc(P.numero) : '']
        ], 'Cenário-base · projeção de 10 anos')
      + '<div class="ep-section">O que este projeto entrega</div>'
      + '<div class="pl-heros">' + hero + '</div><div class="ep-exec">' + verdito + '</div>'
      + '<div class="ep-section">Resultado da operação</div>'
      + '<div class="ep-cols"><div class="ep-box"><h3>Por mês · regime pleno</h3><table class="ep-kv">' + kv([
          ['Faturamento', money(r.fatMes)], ['Custos + imposto', money(r.custosMes)], ['Lucro', money(r.lucroMes), true],
          ['Margem', (r.margem * 100).toFixed(2).replace('.', ',') + '%'],
          ['Energia entregue', Math.round(r.kwhMes).toLocaleString('pt-BR') + ' kWh']
        ]) + '</table></div>'
      + '<div class="ep-box"><h3>Por ano</h3><table class="ep-kv">' + kv([
          ['Faturamento (pleno)', money(r.fatAno)], ['Custos + impostos (pleno)', money(r.custosAno)], ['Lucro (pleno)', money(r.lucroAno), true],
          ['Lucro do ano 1 (com rampa)', money(r.lucroAno1)], ['Patrimônio em 10 anos', money(r.acumulado10)]
        ]) + '</table></div></div>'
      + '<div class="pl-tira">' + tira + '</div>'
      + '<div class="pl-chart"><div class="cap">Fluxo de caixa acumulado<span>Começa no valor investido e vira para cima no payback</span></div>' + fluxoSVG(r.fluxo) + '</div>'
      + '<div class="ep-section">Memória de cálculo · premissas informadas</div>'
      + '<div class="ep-cols"><div class="ep-box"><h3>Operação e investimento</h3><table class="ep-kv">' + kv([
          ['Carros por dia (regime pleno)', Math.round(r.carros)],
          ['Média de carga por carro', r.carga + ' kWh'],
          [prem.custoKwh === C.CUSTO_KWH_SOLAR && P.form.usina ? 'Custo do kWh (usina solar própria)' : 'Custo do kWh', C.moeda2(r.custoKwh)],
          ['Preço do kWh ao motorista', C.moeda2(r.precoKwh)],
          ['Taxa de ativação por sessão', seTem('ativacao', C.moeda2(r.ativacao))],
          ['Quantidade de carregadores', P.quantidade],
          ['Serviços NEXUS incluídos', P.servicosTotal > 0 ? money(P.servicosTotal) : ''],
          ['Plano de manutenção NEXUS', P.manutencao ? 'Já na conta (manutenção)' : ''],
          ['Plataforma NEXUS', P.plataforma ? 'Já na conta (Software NEXUS)' : ''],
          ['Ocupação inicial até a plena', Math.round(r.ocupIni * 100) + '% até 100% em ' + r.mesesRampa + ' meses'],
          ['Investimento total', money(r.investTotal), true]
        ]) + '</table></div>'
      + '<div class="ep-box"><h3>Custos, taxas e modelagem</h3><table class="ep-kv">' + kv([
          ['Software NEXUS', seTem('software', pctTxt(r.software))],
          ['Arrendamento do ponto', seTem('arrend', pctTxt(r.arrend))],
          ['Manutenção', seTem('manutMes', money(r.manutMes || 0) + ' / mês')],
          ['Imposto (Simples Nacional)', seTem('imposto', pctTxt(r.imposto))],
          ['Internet local', seTem('assinat', money(r.assinat) + ' / mês')],
          ['Seguro (1% a.a. do investimento)', money(r.seguroMes * 12) + ' / ano'],
          ['Outros custos fixos', seTem('fixos', money(r.fixos) + ' / mês')],
          ['Taxa de desconto (VPL)', txPct]
        ]) + '</table></div></div>'
      + D.contatoBloco(P)
      + '<div class="pl-nota">Faturamento = (carros/dia × 30) × [ carga × preço do kWh ao motorista + taxa de ativação ]. Seguro/mês = investimento × 0,01 ÷ 12. O ano 1 aplica a rampa de ocupação; os custos fixos correm desde o mês 1. VPL e TIR sobre o fluxo anual de 10 anos, à taxa de desconto informada. ' + esc(D.TEXTOS.avisoSimulador) + '</div>'
      + D.pageFoot(P, 'Resumo do Investimento')
      + '</div></div>';

    return { html: html, nomeArq: C.nomeArquivo('simulador', P.cliente.nome, P.numero), opts: { umaPagina: true, alvo: '.pl-rx .ep-page', piso: 0.74 } };
  };
})();
