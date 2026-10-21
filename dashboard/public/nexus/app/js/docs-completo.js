/* Portal do Parceiro NEXUS · Orcamento Completo (apresentacao em folhas A4 EM PE, visual NEXUS).
 *
 * Copia de nxCompletoDeck (/gerador/index.html 16566-16984), com os dados que epCompletoPayload
 * (17234-17372) montava: ent/res/cen/custos. Aqui o payload e' derivado direto de P.calc, sem
 * passar pelo DOM.
 *
 * Capa nova, do canvas aprovado (DocCapa.dc.html). Mantido do /gerador: partes, conta aberta com barras de custo, retorno + rampa, cenarios +
 * fluxo acumulado, equipamento (folha clara), o ponto e o escopo, fecho com a condicao de pagamento.
 * Acrescentado (bloco E): "Sobre a NEXUS", "Por que um eletroposto agora", "Modelo de operacao" e
 * "Garantias e pos-venda". Co-branding e rodape do distribuidor em TODA folha.
 * Tirado: consultor da casa, Sociedade/cotas, a folha de riscos e cronograma (era a oferta de obra chave
 * na mao da NEXUS), "chave na mao", "25 dias" e "24 meses" (promessas que nao sao do parceiro),
 * "Bicos de carregamento" (nao ha dado no catalogo), tabela EP_KIT.
 */
(function () {
  'use strict';
  var C = window.NexusCalc, D = window.NexusDocs, esc = D.esc;

  D.completo = function (P) {
    var r = P.calc.r, p = P.calc.p, prem = P.calc.prem, CEN = P.calc.cen, form = P.form;
    var tot = P.calc.totais.total, IMG = D.IMG;
    var brl = function (v) { return C.moeda(Number(v) || 0); };
    var pct = function (v) { return (Number(v) || 0).toFixed(1).replace('.', ',').replace(',0', '') + '%'; };
    var dec = function (v) { return (Number(v) || 0).toFixed(1).replace('.', ',') + ''; };
    var num = function (v) { return Math.round(Number(v) || 0); };
    var tem = function (v) { return v != null && v !== '' && !(typeof v === 'number' && isNaN(v)); };
    var din2 = function (v) { return C.moeda2(v); };
    var cap = function (s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

    var S = [];
    var marca = function (tema) { return '<div class="nx-marca">' + D.cobrand(P, tema) + '</div>'; };
    // O rodape so sabe a contagem no fim: a pagina entra com marcador e a numeracao e' costurada depois.
    var pe = function (tag) {
      return '<div class="nx-pe"><div class="l1"><span class="mk">' + esc(D.rodapeMarca(P)) + '</span>'
        + '<span class="dir"><span class="tag">' + esc(tag) + '</span><span class="num">__N__ / __T__</span></span></div>'
        + '<div class="l2">' + esc(P.distribuidor) + '</div></div>';
    };
    var slide = function (cls, tema, inner, tag) {
      return '<section class="nx-slide ' + cls + '"><div class="nx-faixa"></div>' + marca(tema) + inner + pe(tag) + '</section>';
    };
    var corpo = function (inner, extra) { return '<div class="nx-corpo' + (extra ? ' ' + extra : '') + '">' + inner + '</div>'; };

    var local = P.cliente.local || P.cliente.cidade;

    // ── 1 · A CAPA (desenho do canvas: DocCapa.dc.html) ────────────────────
    // Escura, com o logo NEXUS e o parceiro no topo, o carregador numa vitrine clara e, embaixo, numero,
    // data por extenso, validade, "Apresentada por" e a linha do distribuidor. Sem numero de lucro na capa.
    var subCapa = [P.cliente.nome, local].filter(Boolean).join(' · ');
    var validaCapa = String(P.validade).replace(/^Válido/, 'Válida');
    var porEmp = 'Apresentada por ' + P.empresa.nome + (P.empresa.cidade ? ' · ' + P.empresa.cidade : '');
    S.push('<section class="nx-slide nx-capa2">'
      + '<header class="cp-topo">' + D.cobrand(P, 'escuro') + '</header>'
      + '<div class="cp-titulo"><span class="cp-barra"></span><h1>Proposta de eletroposto</h1>'
      + (subCapa ? '<p class="cp-sub">' + esc(subCapa) + '</p>' : '') + '</div>'
      + '<div class="cp-foto"><img src="' + IMG + 'dc-frente-limpo.webp" alt="Carregador ' + esc(P.modelo) + '"></div>'
      + '<div class="cp-rodape"><div class="cp-meta">'
      + '<p>Proposta nº <span class="n">' + esc(P.numero || 'Sem número') + '</span></p>'
      + '<p>' + esc(D.dataLonga(P.agora)) + '</p><p>' + esc(validaCapa) + '</p></div>'
      + '<p class="cp-por">' + esc(porEmp) + '</p>'
      + '<div class="cp-dist"><p>' + esc(P.distribuidor) + '</p><p class="s">' + esc(D.slogan) + '</p></div></div>'
      + '</section>');

    // ── 2 · SOBRE A NEXUS E POR QUE UM ELETROPOSTO AGORA (bloco E) ─────────
    S.push(slide('', 'escuro', corpo(
      '<div class="nx-banda"><img src="' + IMG + 'fabrica-linha.webp" alt=""><div class="veu"></div>'
      + '<div class="txt"><div class="t">Sobre a<span class="g"> NEXUS Eletropostos</span></div>'
      + '<div class="d">' + esc(D.slogan) + '</div></div></div>'
      + '<div class="nx-kick" style="margin-top:12px">Quem fornece o equipamento</div>'
      + '<p class="nx-texto">' + esc(D.TEXTOS.sobre) + '</p>'
      + '<div class="nx-pilares">' + P.pilares.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>'
      + '<div class="nx-kick" style="margin-top:16px">Por que um eletroposto agora</div>'
      + '<p class="nx-texto">' + esc(D.TEXTOS.porque) + '</p>', 'com-banda'), 'A NEXUS'));

    // ── 3 · OS NUMEROS E AS PARTES ─────────────────────────────────────────
    var linha = function (k, v) {
      var t = String(v == null ? '' : v).trim();
      return t ? '<div class="l"><span class="k">' + esc(k) + '</span><span class="v">' + esc(t) + '</span></div>' : '';
    };
    var caixa = function (t, rows) {
      var c = rows.map(function (x) { return linha(x[0], x[1]); }).join('');
      return c ? '<div class="nx-parte"><div class="t">' + esc(t) + '</div>' + c + '</div>' : '';
    };
    S.push(slide('', 'escuro', corpo(
      '<div class="nx-kick">A proposta em quatro números</div>'
      + '<div class="nx-tit">Isto é o que o ponto<span class="g"> devolve</span></div>'
      + '<div class="nx-kpis">'
      + '<div class="nx-kpi"><div class="r">Investimento</div><div class="v">' + brl(tot) + '</div><div class="n">Valor total desta proposta</div></div>'
      + '<div class="nx-kpi"><div class="r">Retorno</div><div class="v verde">' + (tem(r.payback) ? dec(r.payback) + ' anos' : 'Acima de 10 anos') + '</div><div class="n">Para o capital voltar</div></div>'
      + '<div class="nx-kpi"><div class="r">Faturamento / mês</div><div class="v">' + brl(r.fatMes) + '</div><div class="n">' + brl(r.fatAno) + ' por ano</div></div>'
      + '<div class="nx-kpi"><div class="r">Patrimônio em 10 anos</div><div class="v verde">' + brl(r.acumulado10) + '</div><div class="n">Além do que foi investido</div></div>'
      + '</div>'
      + '<div class="nx-kick" style="margin-top:15px">As partes</div>'
      + '<div class="nx-partes">'
      + caixa('Fornecedor', [['Nome', P.empresa.nome], ['CNPJ', P.empresa.cnpj], ['Cidade', P.empresa.cidade], ['WhatsApp', P.empresa.whatsapp]])
      + caixa('Cliente', [['Nome', P.cliente.nome], ['CNPJ / CPF', P.cliente.doc], ['Tipo de local', P.cliente.tipo_local], ['Cidade', P.cliente.local],
                          ['Telefone', P.cliente.telefone], ['E-mail', P.cliente.email]])
      + '</div>'
      + '<div class="nx-parte nx-fim nx-prop"><div class="t">A proposta</div>'
      + linha('Número', P.numero ? 'Nº ' + P.numero : '') + linha('Emitida em', P.data) + linha('Validade', cap(P.validade.replace(/^Válido (até|por) /, ''))) + linha('Entrega', P.entrega) + linha('Instalação', P.instalacao)
      + '</div>'), 'A proposta'));

    // ── 4 · DE ONDE SAI O NUMERO (a conta + todo custo na mesa) ────────────
    // Faturamento = (carros/dia x 30) x (carga x preco do kWh + ativacao): a linha mostra a conta como ela e'.
    var contaItens = [
      [String(num(r.carros)), 'Carros por dia'], ['×', ''], ['30', 'Dias'], ['×', ''], ['(', ''],
      [String(num(r.carga)), 'kWh por carga'], ['×', ''], [din2(r.precoKwh), 'Preço do kWh'], ['+', ''],
      [din2(r.ativacao), 'Ativação por sessão'], [')', '']
    ].map(function (c) {
      return c[1] ? '<div class="c"><span class="v">' + c[0] + '</span><span class="r">' + c[1] + '</span></div>'
                  : '<div class="op">' + c[0] + '</div>';
    }).join('');

    var custos = [
      { rot: P.form.usina ? 'Energia da usina solar própria' : 'Energia comprada', val: r.kwhMes * r.custoKwh },
      { rot: 'Imposto', val: r.fatMes * r.imposto, nota: C.pctRot(r.imposto) + ' do faturamento' },
      { rot: 'Arrendamento do ponto', val: r.fatMes * r.arrend, nota: C.pctRot(r.arrend) + ' do faturamento do ponto' },
      { rot: 'Software NEXUS', val: r.fatMes * (r.software || 0), nota: C.pctRot(r.software || 0) + ' do faturamento' },
      { rot: 'Manutenção', val: r.manutMes || 0, nota: 'Valor fixo por mês' },
      { rot: 'Internet local', val: r.assinat },
      { rot: 'Seguro', val: r.seguroMes, nota: 'Calculado em 1% do investimento ao ano' },
      { rot: 'Custos fixos', val: r.fixos }
    ].filter(function (c) { return (Number(c.val) || 0) > 0; }).sort(function (a, b) { return b.val - a.val; });
    var maior = Math.max.apply(null, custos.map(function (c) { return Number(c.val) || 0; }).concat([1]));
    var custosHTML = custos.map(function (c) {
      return '<div class="nx-custo"><div class="l"><span>' + esc(c.rot) + '</span><span class="v">' + brl(c.val) + '</span></div>'
        + '<div class="trilho"><i style="width:' + (100 * (Number(c.val) || 0) / maior).toFixed(1) + '%"></i></div>'
        + (c.nota ? '<div class="n">' + esc(c.nota) + '</div>' : '') + '</div>';
    }).join('');
    var temSoftware = Number(r.software) > 0;

    S.push(slide('', 'escuro', corpo(
      '<div class="nx-kick">A conta aberta</div>'
      + '<div class="nx-tit">De onde sai<span class="g"> esse número</span></div>'
      + '<div class="nx-conta">' + contaItens + '</div>'
      + '<div class="nx-fat"><span class="r">Faturamento</span><span class="v">' + brl(r.fatMes) + '</span><span class="n">' + brl(r.fatAno) + ' por ano</span></div>'
      + '<div class="nx-kick" style="margin-top:15px">O que já foi descontado antes de você ver o lucro</div>'
      + '<div class="nx-custo-col"><div class="nx-custos">' + custosHTML + '</div>'
      + (temSoftware ? '<div class="nx-app"><img src="' + IMG + 'plataforma-app.webp" alt="App NEXUS com a recarga em andamento">'
        + '<div class="leg">Os ' + pct(r.software * 100) + ' de Software NEXUS são isto: o motorista acompanha a recarga, o kWh e o valor ao vivo.</div></div>' : '')
      + '</div>'
      + '<div class="nx-tarja nx-fim">Sobram ' + brl(r.lucroMes) + ' por mês · margem de ' + pct(r.margem * 100) + '</div>'), 'A conta aberta'));

    // ── 5 · O DINHEIRO VOLTA (o retorno + o primeiro ano) ──────────────────
    var fin = [
      tem(r.tir) ? ['TIR', pct(r.tir * 100) + ' a.a.', 'É o juro que o projeto paga ao dono'] : null,
      tem(r.vpl) ? ['VPL', brl(r.vpl), 'O que ele vale hoje, já descontado o dinheiro parado a ' + pct(r.taxaDesc * 100) + ' a.a.'] : null
    ].filter(Boolean).map(function (x) { return '<div class="s"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="d">' + x[2] + '</div></div>'; }).join('');
    var pos = Math.min(100, Math.max(0, 100 * (Number(r.payback) || 0) / 10));
    var rampa = Math.max(1, num(r.mesesRampa) || 1);
    var nCol = Math.max(12, rampa);
    var oc0 = Math.min(1, Math.max(0, Number(r.ocupIni)));
    var barras = Array.apply(null, { length: nCol }).map(function (_, i) {
      var m = i + 1;
      var a = rampa <= 1 || m >= rampa ? 1 : oc0 + (1 - oc0) * (m - 1) / (rampa - 1);
      var rot = (m === 1 || m === rampa || m === nCol) ? '<span>' + m + '</span>' : '';
      return '<div class="m' + (m === rampa ? ' marco' : '') + '" style="height:' + (a * 100).toFixed(1) + '%">' + rot + '</div>';
    }).join('');

    S.push(slide('', 'escuro', corpo(
      '<div class="nx-kick" style="text-align:center">Você coloca ' + brl(tot) + ' uma vez</div>'
      + '<div class="nx-mega">' + (tem(r.payback) ? dec(r.payback) : 'Acima de 10') + '<span class="un">anos</span></div>'
      + '<div class="nx-tit" style="text-align:center">e o dinheiro<span class="g"> volta</span></div>'
      + '<div class="nx-anos"><i style="width:' + pos.toFixed(1) + '%"></i><div class="pino" style="left:' + pos.toFixed(1) + '%"></div></div>'
      + '<div class="nx-anos-rot"><span>Ano 0</span><span>Ano 10</span></div>'
      + '<div class="nx-fin">' + fin + '</div>'
      + '<div class="nx-kick" style="margin-top:16px">E isso já conta que o primeiro ano entra mais devagar</div>'
      + '<p class="nx-lead" style="margin-top:4px">Ninguém abre um posto lotado, e esta conta não finge que sim. A ocupação sai de ' + pct(r.ocupIni * 100) + ' e chega cheia no mês ' + rampa + '. Os custos fixos correm desde o mês 1.</p>'
      + '<div class="nx-rampa">' + barras + '</div>'
      + '<div class="nx-kpis nx-fim" style="grid-template-columns:1fr 1fr">'
      + '<div class="nx-kpi"><div class="r">Lucro do ano 1</div><div class="v">' + brl(r.lucroAno1) + '</div><div class="n">Já com a rampa de ocupação</div></div>'
      + '<div class="nx-kpi"><div class="r">A partir do ano cheio</div><div class="v verde">' + brl(r.lucroAno) + '</div><div class="n">Por ano, em regime</div></div></div>'), 'O retorno'));

    // ── 6 · OS CENARIOS (e o fluxo acumulado, com a linha do zero) ─────────
    var vistos = {}, cen = [];
    CEN.forEach(function (c) { if (!vistos[c.carros]) { vistos[c.carros] = 1; cen.push(c); } });
    var cards = cen.map(function (c) {
      var base = c.rot === 'Base';
      return '<div class="c' + (base ? ' este' : '') + '"><div class="id"><div class="n">' + esc(base ? 'Este projeto' : c.rot) + '</div>'
        + '<div class="q">' + num(c.carros) + ' carros por dia</div>' + (base ? '<div class="selo">A proposta está aqui</div>' : '') + '</div>'
        + '<div class="vals">'
        + '<div><span class="r">Faturamento/mês</span><span class="v">' + brl(c.r.fatMes) + '</span></div>'
        + '<div><span class="r">Lucro/mês</span><span class="v forte">' + brl(c.r.lucroMes) + '</span></div>'
        + '<div><span class="r">Payback</span><span class="v">' + (tem(c.r.payback) ? dec(c.r.payback) + ' anos' : 'Não paga') + '</span></div>'
        + '<div><span class="r">TIR</span><span class="v">' + (tem(c.r.tir) ? pct(c.r.tir * 100) : 'Indisponível') + '</span></div>'
        + '<div><span class="r">Patrimônio 10 anos</span><span class="v forte">' + brl(c.r.acumulado10) + '</span></div></div></div>';
    }).join('');

    // r.fluxo JA' E' O ACUMULADO (acc += f; fluxo.push(acc)): nao somar por cima de novo.
    var acum = (r.fluxo || []).map(function (v) { return Number(v) || 0; });
    var maiorPos = Math.max.apply(null, [0].concat(acum));
    var maiorNeg = Math.max.apply(null, [0].concat(acum.map(function (v) { return -v; })));
    var faixa = (maiorPos + maiorNeg) || 1;
    var pctCima = maiorPos / faixa * 100;
    var alt = function (v, teto) { return teto > 0 ? Math.max(1.2, Math.abs(v) / teto * 100).toFixed(1) : '0'; };
    var grafico = acum.length ? '<div class="nx-kick" style="margin-top:15px">E o que sobra, ano a ano</div>'
      + '<div class="nx-fluxo" style="--nx-zero:' + pctCima.toFixed(1) + '%"><div class="zero"></div>'
      + acum.map(function (v, i) {
        return '<div class="col"><div class="cima">' + (v > 0 ? '<div class="bar" style="height:' + alt(v, maiorPos) + '%"></div>' : '') + '</div>'
          + '<div class="baixo">' + (v < 0 ? '<div class="bar neg" style="height:' + alt(v, maiorNeg) + '%"></div>' : '') + '</div>'
          + '<span class="a">' + (i + 1) + '</span></div>';
      }).join('') + '</div>'
      + '<div class="nx-fluxo-rot"><span>Ano 1 · ' + brl(acum[0]) + '</span><span>Ano ' + acum.length + ' · ' + brl(acum[acum.length - 1]) + '</span></div>' : '';

    S.push(slide('', 'escuro', corpo(
      '<div class="nx-kick">O piso primeiro</div>'
      + '<div class="nx-tit">E se vierem<span class="g"> ' + num(cen[0] && cen[0].carros) + ' carros por dia?</span></div>'
      + '<div class="nx-lead">A proposta foi feita no cenário do meio. Estes são os outros dois, com a mesma conta. O de baixo é o que importa, porque é ele que diz se o projeto se paga no pior caso.</div>'
      + '<div class="nx-cen">' + cards + '</div>' + grafico), 'Os cenários'));

    // ── 7 · O EQUIPAMENTO (folha clara: a foto do produto pede fundo branco) ─
    // Especificacao que o catalogo nao tem sai "Consulte ficha técnica". Nada de numero inventado.
    var sp = P.specs || {};
    var fx = function (k, v) { return '<div class="f"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'; };
    var fxp = function (k, v) { return '<div class="f peq"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v || D.SEM_DADO) + '</span></div>'; };
    S.push(slide('claro', 'claro',
      corpo('<div class="nx-kick">Equipamento de linha</div>'
        + '<div class="nx-tit">' + esc(P.modelo) + '</div>'
        + '<div class="nx-eq"><div class="nx-eq-foto"><img src="' + IMG + 'dc-frente-larga.webp" alt="' + esc(P.modelo) + '"></div>'
        + '<div class="nx-ficha">'
        + (P.potenciaKw ? fx('Potência', P.potenciaKw + ' kW') : '')
        + fx('Quantidade', String(P.quantidade)) + fx('Entrega', P.entrega)
        + '</div></div>'
        + '<div class="nx-ficha-peq">' + D.SPECS_CAMPOS.map(function (c) { return fxp(c[1], sp[c[0]]); }).join('') + '</div>'
        + '<div class="nx-angulos">'
        + '<figure><img src="' + IMG + 'dc-perspectiva.webp" alt="Carregador em perspectiva"><figcaption>Perspectiva</figcaption></figure>'
        + '<figure><img src="' + IMG + 'dc-lateral.webp" alt="Carregador de lado"><figcaption>Lateral</figcaption></figure>'
        + '<figure><img src="' + IMG + 'dc-traseira.webp" alt="Carregador por trás"><figcaption>Traseira</figcaption></figure></div>')
      + '<div class="nx-tira"><div class="bg"><img src="' + IMG + 'fabrica-nexus-a4.webp" alt="Carregadores NEXUS na linha de produção"></div><div class="veu"></div>'
      + '<div class="cont"><div class="leg">Linha de produção NEXUS.</div></div></div>', 'O equipamento'));

    // ── 8 · O SEU PONTO E O ESCOPO ─────────────────────────────────────────
    // O que esta no valor e' o que o parceiro colocou (itens com valor); o resto fica "fora do valor".
    var esc0 = D.escopo(P);
    var DENTRO = [P.modelo + (P.quantidade > 1 ? ' · ' + P.quantidade + ' unidades' : '')].concat(esc0.dentro);
    var FORA = esc0.fora;
    S.push(slide('', 'escuro', corpo(
      '<div class="nx-banda"><img src="' + IMG + 'posto-noite.webp" alt=""><div class="veu"></div>'
      + '<div class="ilu">Imagem ilustrativa do projeto</div>'
      + '<div class="txt"><div class="t">Assim pode ficar<span class="g"> o seu ponto</span></div>'
      + '<div class="d">O que entra no valor está listado abaixo. O que não está listado não faz parte desta proposta.</div></div></div>'
      + '<div class="nx-kick" style="margin-top:14px">O que está dentro do valor, e o que não está</div>'
      + '<div class="nx-duas"><div class="nx-col dentro"><div class="h">Dentro do valor</div><ul class="nx-lista">'
      + DENTRO.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>'
      + '<div class="nx-col fora"><div class="h">Fora do valor</div><ul class="nx-lista">'
      + (FORA.length ? FORA.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') : '<li>Nenhum item listado</li>') + '</ul>'
      + '<div class="nx-aviso">Item que não aparece em &quot;Dentro do valor&quot; é combinado e orçado à parte.</div></div></div>'
      + (P.manutencao || P.plataforma ? '<div class="nx-plat">' + [P.manutencao, P.plataforma].filter(Boolean).map(function (t) { return '<b>' + esc(t) + '.</b>'; }).join('') + 'Não somam ao valor total desta proposta.</div>' : '')
      + '<div class="nx-tarja nx-fim">' + brl(tot) + ' · valor total desta proposta</div>', 'com-banda'), 'O seu ponto'));

    // ── 9 · MODELO DE OPERACAO E GARANTIAS (bloco E) ───────────────────────
    var cartao3 = function (itens) {
      return '<div class="nx-itens3">' + itens.map(function (t) { return '<div class="i">' + esc(t) + '</div>'; }).join('') + '</div>';
    };
    S.push(slide('', 'escuro', corpo(
      '<div class="nx-kick">Como a operação funciona</div>'
      + '<div class="nx-tit">Modelo de<span class="g"> operação</span></div>'
      + '<p class="nx-texto">' + esc(D.TEXTOS.operacao) + '</p>'
      + cartao3(['Cobrança de cada recarga', 'Monitoramento do carregador', 'Relatórios de uso e de receita'])
      + '<div class="nx-kick" style="margin-top:22px">Depois da compra</div>'
      + '<div class="nx-tit">Garantias e<span class="g"> pós-venda</span></div>'
      + '<p class="nx-texto">' + esc(D.TEXTOS.garantias) + '</p>'
      + cartao3(['Garantia conforme a ficha técnica do fabricante', 'Venda com nota fiscal', 'Suporte da NEXUS ao equipamento'])), 'Operação e garantias'));

    // ── 10 · O FECHO ───────────────────────────────────────────────────────
    // Nenhum numero novo: os tres sao repetidos das folhas anteriores.
    S.push(slide('', 'escuro', corpo(
      '<div class="nx-fecho-marcas">' + D.cobrand(P, 'escuro') + '</div>'
      + '<div class="nx-tagline" style="text-align:center;margin:10px 0 18px">Energia que <b>move</b> o amanhã</div>'
      + '<div class="nx-tit" style="text-align:center">O que falta<span class="g"> é a sua assinatura</span></div>'
      + '<div class="nx-tres">'
      + '<div><span class="v">' + brl(r.lucroMes) + '</span><span class="r">Por mês</span></div>'
      + '<div><span class="v">' + (tem(r.payback) ? dec(r.payback) + ' anos' : 'Acima de 10 anos') + '</span><span class="r">Para o dinheiro voltar</span></div>'
      + '<div><span class="v">' + brl(tot) + '</span><span class="r">O valor do projeto</span></div></div>'
      + '<div class="nx-kick" style="margin-top:18px">Condição de pagamento</div>'
      + '<div class="nx-pags">' + D.pagChips(P) + '</div>'
      + '<div class="nx-contato">'
      + '<div class="b"><div class="r">Empresa</div><div class="v">' + esc(P.empresa.nome) + '</div></div>'
      + '<div class="b"><div class="r">WhatsApp</div><div class="v">' + esc(P.empresa.whatsapp || 'Sem dado') + '</div></div>'
      + '<div class="b"><div class="r">Proposta</div><div class="v">Nº ' + esc(P.numero || 'Sem número') + '</div></div></div>'
      + '<div class="nx-valid">' + esc(P.validade) + '</div>'
      + '<div class="nx-obs">' + esc(D.obsPadrao(P) + (P.obsLivre ? ' ' + P.obsLivre : '')) + '</div>', 'centro'), 'O fecho'));

    // A numeracao e' costurada no fim, com o total ja conhecido.
    var total = S.length;
    var html = S.map(function (x, i) { return x.replace('__N__', String(i + 1)).replace('__T__', String(total)); }).join('\n');
    return { html: '<div class="nx-deck">' + html + '</div>', nomeArq: C.nomeArquivo('completo', P.cliente.nome, P.numero), opts: { escuro: true } };
  };
})();
