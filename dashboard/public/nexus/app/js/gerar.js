/* Portal do Parceiro NEXUS · tela "Propostas": gerador + "Minhas propostas".
 *
 * window.NexusGerar.montar(container, ctx) monta, no desenho do canvas aprovado (Propostas.dc.html):
 *  - a esquerda, o formulario empilhado (cliente final, equipamento do catalogo, infraestrutura e servicos,
 *    premissas do Simulador, pagamento e prazos);
 *  - a direita, o resumo ao vivo (retorno, totais, pagamento, caixa acumulado em 60 meses) e as tres saidas;
 *  - embaixo, "Minhas propostas".
 *
 * ctx (v2). Tudo que nao for obrigatorio tem reserva, para a casca poder entregar por partes:
 *   {parceiro, empresa, nivel, libera, catalogo, entrega, financiamento, demo, propostaInicial|null,
 *    salvarProposta(payload, opcoes) -> Promise<{id, numero}>, onGerou(saida, proposta), evento(tipo, dados),
 *    listarPropostas() -> Promise<[...] | {propostas:[...]}>, pedirEquipamento(proposta), api(metodo, caminho, corpo)}
 *  `opcoes` (2o argumento de salvarProposta) = {id, numero} da proposta que o formulario esta editando,
 *  ou {id:null} quando e' proposta nova. A casca deve usar isso para decidir entre POST e PUT.
 *
 * Fluxo de uma saida: valida -> ctx.salvarProposta -> monta o HTML -> imprime -> ctx.onGerou.
 * Nada de preco de parceiro aqui nem no payload. O logo do parceiro nunca entra em `dados` (limite de 200 KB).
 * A conta mora em calc.js; os documentos em docs-*.js.
 */
(function () {
  'use strict';

  var SCRIPTS = ['calc.js', 'docs-comum.js', 'docs-simulador.js', 'docs-basico.js', 'docs-completo.js'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // As dependencias costumam vir por <script> no index.html. Se a ordem falhar, carrega o que faltar.
  function garantirScripts() {
    var falta = SCRIPTS.filter(function (s) {
      return (s === 'calc.js' && !window.NexusCalc) ||
        (s === 'docs-comum.js' && !(window.NexusDocs && window.NexusDocs.preparar)) ||
        (s === 'docs-simulador.js' && !(window.NexusDocs && window.NexusDocs.simulador)) ||
        (s === 'docs-basico.js' && !(window.NexusDocs && window.NexusDocs.basico)) ||
        (s === 'docs-completo.js' && !(window.NexusDocs && window.NexusDocs.completo));
    });
    return falta.reduce(function (p, s) {
      return p.then(function () {
        return new Promise(function (res, rej) {
          var el = document.createElement('script');
          el.src = '/nexus/app/js/' + s;
          el.onload = res; el.onerror = function () { rej(new Error('Não foi possível carregar ' + s)); };
          document.head.appendChild(el);
        });
      });
    }, Promise.resolve());
  }

  // ===== Campos e dicas do Simulador (padroes e textos dos campos el-* do /gerador, 5379-5457) =====
  var GRUPOS = [
    { titulo: 'Dados da operação', itens: [
      { k: 'carros', rot: 'Recargas por dia (total do posto)', tip: 'Quantas recargas acontecem no posto por dia, somando todos os carregadores. O padrão é 10 por carregador, e muda sozinho com a quantidade até você editar este campo. É o motor de toda a conta: mais recargas, mais faturamento.' },
      { k: 'carga', rot: 'Média de carga por carro', suf: 'kWh', tip: 'Quanta energia cada carro leva por parada, em kWh. Referência: 20 kWh dão cerca de 100 a 140 km de autonomia. É a recarga típica de rua, não o tanque cheio.' },
      { k: 'custoKwh', rot: 'Custo do kWh', pre: 'R$', usina: true, tip: 'Quanto se paga por kWh na conta da concessionária. É o custo da mercadoria que o posto revende.' },
      { k: 'precoKwh', rot: 'Preço do kWh ao motorista', pre: 'R$', tip: 'Quanto o motorista paga por kWh no carregador. A diferença entre este preço e o custo da concessionária é o ganho por kWh.' },
      { k: 'ativacao', rot: 'Taxa de ativação', pre: 'R$', tip: 'Valor fixo cobrado a cada recarga, independente da energia levada. Entra no faturamento junto com a venda de energia.' }
    ] },
    { titulo: 'Custos e taxas', itens: [
      { k: 'software', rot: 'Software NEXUS', suf: '%', tip: 'Percentual do faturamento pela plataforma NEXUS: app de usuários, meio de pagamento, gestão do ponto, relatórios e suporte. Como é percentual, só pesa quando o posto fatura.' },
      { k: 'arrend', rot: 'Arrendamento do ponto', suf: '%', tip: 'Percentual do faturamento pago ao dono do local (posto, mercado, shopping) pela cessão do espaço. Como é percentual, ele só ganha quando o posto fatura.' },
      { k: 'manutMes', rot: 'Manutenção', pre: 'R$', tip: 'Valor fixo por mês para manter o equipamento funcionando: limpeza, reparos e assistência técnica. É custo fixo: o contrato de manutenção se paga com o posto parado.' },
      { k: 'assinat', rot: 'Internet local', pre: 'R$', tip: 'O link de internet do ponto, que mantém o carregador online para autorizar a recarga e receber o pagamento. É custo fixo: existe mesmo num mês parado.' },
      { k: 'seguro', rot: 'Seguro | Ano', pre: 'R$', somenteLeitura: true, tip: 'Seguro do equipamento, calculado sozinho como 1% ao ano do investimento e diluído nos meses. Este campo é só demonstrativo: mexer no investimento já atualiza o valor.' },
      { k: 'imposto', rot: 'Imposto: Simples Nacional', suf: '%', tip: 'Alíquota de imposto sobre o faturamento, no regime do Simples Nacional. Confirme a faixa com o contador do cliente, porque ela varia conforme o faturamento da empresa.' },
      { k: 'fixos', rot: 'Outros custos fixos/mês', pre: 'R$', tip: 'Contas que chegam todo mês independentemente do movimento: software de gestão, internet 4G do carregador e demanda contratada de energia.' }
    ] },
    { titulo: 'Modelagem financeira', itens: [
      { k: 'ocup', rot: 'Ocupação inicial', suf: '%', tip: 'Quanto do movimento o posto já tem no primeiro mês. Um posto novo não abre cheio: 50% significa que ele começa com metade dos carros previstos e vai crescendo.' },
      { k: 'rampa', rot: 'Meses até ocupação plena', tip: 'Em quantos meses o posto sai da ocupação inicial e chega ao movimento normal. É o que torna a projeção honesta: as contas fixas correm desde o dia 1, mesmo com o posto ainda enchendo.' }
    ] }
  ];
  var TIP_USINA = 'Ligada, o custo do kWh cai para R$ 0,30. Você pode ajustar o valor. Serve para o ponto que gera a própria energia em uma usina solar.';
  var TIPOS_LOCAL = ['Posto de combustível', 'Hotel ou pousada', 'Restaurante', 'Shopping ou comércio', 'Supermercado', 'Estacionamento', 'Condomínio', 'Rodovia', 'Frota própria', 'Empresa ou indústria', 'Outro'];
  var UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  var SAIDAS = {
    simulador: { rot: 'Simulador em PDF', sub: 'Resumo do investimento para o cliente', motivo: 'Cadastre a empresa para liberar o Simulador em PDF.' },
    basico: { rot: 'Orçamento Básico', sub: 'Uma folha com itens, total e pagamento', motivo: 'Complete o perfil para liberar' },
    completo: { rot: 'Orçamento Completo', sub: 'Apresentação com a NEXUS e a sua marca', motivo: 'Complete o perfil para liberar' }
  };
  var SAIDA_NOME = { simulador: 'Simulador', basico: 'Básico', completo: 'Completo' };

  var svg = function (d, w) { return '<svg class="nxg-ico" viewBox="0 0 24 24" width="' + (w || 20) + '" height="' + (w || 20) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"></path></svg>'; };
  var ICONE_CADEADO = svg('M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', 22);
  var ICONE_DOC = svg('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6', 22);
  var ICONE_PDF = svg('M12 3v12M7 10l5 5 5-5M5 21h14', 22);
  var ICONE_APRES = svg('M4 4h16v12H4zM8 20h8M12 16v4', 22);
  var ICONE_AJUDA = svg('M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01', 18);
  var ICONE_MAIS = svg('M12 5v14M5 12h14', 16);
  var ICONE_RESTAURAR = svg('M3 12a9 9 0 1 0 3-6.7M3 4v5h5', 16);
  var ICONES_SAIDA = { simulador: ICONE_PDF, basico: ICONE_DOC, completo: ICONE_APRES };

  // ===== O formulario padrao =====
  function formPadrao(C, ctx) {
    var prods = (ctx.catalogo && ctx.catalogo.produtos) || [];
    var p0 = prods[0] || { id: '', precoSugerido: 0 };
    var fin = ctx.financiamento || {};
    return {
      cliente: { nome: '', doc: '', cidade: '', uf: '', telefone: '', email: '', tipo_local: '' },
      equip: { modelo: p0.id, quantidade: 1, preco: p0.precoSugerido, precoEditado: false },
      itens: C.ITENS_PADRAO.map(function (i) { return { id: i.id, nome: i.nome, livre: !!i.livre, descricao: '', valor: '' }; }),
      prem: Object.assign({}, C.PREMISSAS_PADRAO),
      carrosEditado: false,
      usina: false, custoRede: C.PREMISSAS_PADRAO.custoKwh,
      pg: { vista: true, cartao: true, cartaoEntrada: '', cartaoParcelas: C.ORC_ENTRADA_PARC, cartaoJuros: C.CARTAO_ACRESCIMO_PADRAO,
            fin: true, finEntrada: '', finParcelas: fin.parcelas || C.ORC_FIN_PARC,
            finTaxa: fin.taxaRefMensal != null ? fin.taxaRefMensal : C.FIN_TAXA_PADRAO,
            finCarenciaDias: fin.carenciaDias != null ? fin.carenciaDias : C.FIN_CARENCIA_DIAS },
      validade: { modo: 'sexta', dias: 2 },
      entrega: String(ctx.entrega || '').trim() || C.ENTREGA_PADRAO,
      instalacao: C.INSTALACAO_PADRAO,
      obs: ''
    };
  }

  // Reabrir uma proposta: carrega o formulario salvo em `dados.form` sobre o padrao (chave nova nunca quebra).
  function formDaProposta(C, ctx, ini) {
    var f = formPadrao(C, ctx);
    if (!ini) return f;
    var d = ini.dados || {};
    var s = d.form || null;
    if (s) {
      ['cliente', 'equip', 'prem', 'pg', 'validade'].forEach(function (k) { if (s[k]) f[k] = Object.assign({}, f[k], s[k]); });
      if (Array.isArray(s.itens)) {
        var vistos = {};
        f.itens = f.itens.map(function (i) {
          var x = s.itens.filter(function (y) { return y.id === i.id; })[0];
          if (x) vistos[x.id] = 1;
          return x ? Object.assign({}, i, { descricao: x.descricao || '', valor: x.valor == null ? '' : x.valor }) : i;
        });
        s.itens.forEach(function (x) {   // itens acrescentados pelo parceiro
          if (!vistos[x.id]) f.itens.push({ id: x.id, nome: x.nome || 'Outros', livre: true, descricao: x.descricao || '', valor: x.valor == null ? '' : x.valor });
        });
      }
      ['usina', 'custoRede', 'entrega', 'instalacao', 'obs'].forEach(function (k) { if (s[k] != null) f[k] = s[k]; });
      // Proposta salva antes desta regra: se as recargas nao batem com 10 x quantidade, o parceiro as tinha editado.
      f.carrosEditado = s.carrosEditado != null ? !!s.carrosEditado : (C.num(f.prem.carros) !== C.recargasPadrao(f.equip.quantidade));
      if (s.prazo != null && s.entrega == null) f.entrega = s.prazo;   // propostas da primeira rodada
    } else {
      // Proposta sem formulario salvo: aproveita o que a linha da tabela guarda.
      f.cliente.nome = ini.cliente_nome || ''; f.cliente.cidade = ini.cliente_cidade || ''; f.cliente.uf = ini.cliente_uf || '';
      f.cliente.doc = ini.cliente_doc || ''; f.cliente.telefone = ini.cliente_telefone || ''; f.cliente.email = ini.cliente_email || '';
      f.cliente.tipo_local = ini.tipo_local || '';
      if (ini.quantidade) f.equip.quantidade = ini.quantidade;
      if (ini.preco_unitario) { f.equip.preco = ini.preco_unitario; f.equip.precoEditado = true; }
    }
    return f;
  }

  function montar(container, ctx) {
    return garantirScripts().then(function () { return montarPronto(container, ctx || {}); });
  }

  function montarPronto(container, ctx) {
    var C = window.NexusCalc, D = window.NexusDocs;
    D.garantirRecursos();
    var libera = ctx.libera || {};
    var prods = (ctx.catalogo && ctx.catalogo.produtos) || [];
    var form = formDaProposta(C, ctx, ctx.propostaInicial);
    if (!form.carrosEditado) form.prem.carros = C.recargasPadrao(form.equip.quantidade);
    var ocupado = false;
    // Proposta que o formulario esta editando (a casca decide POST ou PUT com isto).
    var atual = ctx.propostaInicial && ctx.propostaInicial.id ? { id: ctx.propostaInicial.id, numero: ctx.propostaInicial.numero } : null;
    var sessao = [];          // propostas geradas nesta tela (so na demonstracao)
    var lista = null;         // Minhas propostas: null = carregando, [] = vazio, false = erro

    container.innerHTML = '<div class="nxg"></div>';
    var raiz = container.querySelector('.nxg');
    var $ = function (s) { return raiz.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(raiz.querySelectorAll(s)); };

    // ---------- leitura e escrita de valores do formulario ----------
    var get = function (path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, form); };
    var set = function (path, v) {
      var ks = path.split('.'), o = form;
      for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
      o[ks[ks.length - 1]] = v;
    };
    var mostrarNum = function (v) { return v === '' || v == null ? '' : String(v).replace('.', ','); };
    var mostrarMoeda = function (v) {
      if (v === '' || v == null) return '';
      var n = C.lerMoeda(v);
      return typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v)) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    };
    var produto = function () { return prods.filter(function (p) { return p.id === form.equip.modelo; })[0] || null; };

    // ---------- pecas de HTML ----------
    var dica = function (txt) { return '<button type="button" class="nxg-tip" data-acao="dica" aria-label="Ajuda" aria-expanded="false" data-tip="' + esc(txt) + '">' + ICONE_AJUDA + '</button>'; };
    var campo = function (rot, inner, opts) {
      opts = opts || {};
      return '<div class="nxg-campo' + (opts.larga ? ' larga' : '') + '"><label>' + esc(rot) + (opts.tip ? dica(opts.tip) : '') + '</label>' + inner
        + (opts.tip ? '<p class="nxg-dica-txt" hidden>' + esc(opts.tip) + '</p>' : '') + '</div>';
    };
    var txt = function (path, o) {
      o = o || {};
      return '<input type="' + (o.tipo || 'text') + '" data-p="' + path + '" data-t="' + (o.t || 'txt') + '" value="' + esc(o.t === 'moeda' ? mostrarMoeda(get(path)) : (o.t === 'num' ? mostrarNum(get(path)) : (get(path) == null ? '' : get(path)))) + '"'
        + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.im ? ' inputmode="' + o.im + '"' : '') + (o.auto ? ' autocomplete="' + o.auto + '"' : ' autocomplete="off"')
        + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.ro ? ' readonly tabindex="-1"' : '') + (o.rot ? ' aria-label="' + esc(o.rot) + '"' : '') + '>';
    };
    var comAfixo = function (inner, pre, suf) {
      return '<div class="nxg-inp' + (pre ? ' tem-pre' : '') + (suf ? ' tem-suf' : '') + '">' + (pre ? '<span class="pre">' + pre + '</span>' : '') + inner + (suf ? '<span class="suf">' + suf + '</span>' : '') + '</div>';
    };
    var selectHTML = function (path, opcoes, vazio) {
      return '<select data-p="' + path + '" data-t="txt">' + (vazio ? '<option value="">' + esc(vazio) + '</option>' : '')
        + opcoes.map(function (o) { var v = typeof o === 'string' ? o : o.v, r = typeof o === 'string' ? o : o.r; return '<option value="' + esc(v) + '"' + (String(get(path)) === String(v) ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>';
    };
    var chave = function (path, rot, tip) {
      return '<label class="nxg-chave"><input type="checkbox" role="switch" data-p="' + path + '" data-t="bool"' + (get(path) !== false && get(path) ? ' checked' : '') + '><span class="trilho" aria-hidden="true"></span><span class="rot">' + esc(rot) + '</span></label>'
        + (tip ? dica(tip) : '');
    };

    // ---------- cartoes do formulario ----------
    function cartaoCliente() {
      return '<section class="nxg-cartao"><h2>Cliente</h2>'
        + '<p class="nxg-sub">Quem recebe a proposta. O nome é obrigatório.</p><div class="nxg-grade">'
        + campo('Nome ou razão social', txt('cliente.nome', { max: 120, auto: 'off' }), { larga: true })
        + campo('CPF ou CNPJ (opcional)', txt('cliente.doc', { im: 'numeric', max: 18 }))
        + campo('Telefone', txt('cliente.telefone', { tipo: 'tel', im: 'tel', max: 20 }))
        + campo('E-mail', txt('cliente.email', { tipo: 'email', im: 'email', max: 120 }), { larga: true })
        + campo('Cidade', txt('cliente.cidade', { max: 80 }))
        + campo('UF', selectHTML('cliente.uf', UFS, 'Selecione'))
        + campo('Tipo de local', selectHTML('cliente.tipo_local', TIPOS_LOCAL, 'Selecione'), { larga: true })
        + '</div></section>';
    }
    function cartaoEquip() {
      var pills = prods.map(function (p) {
        var sel = p.id === form.equip.modelo;
        return '<button type="button" class="nxg-pill' + (sel ? ' sel' : '') + '" data-modelo="' + esc(p.id) + '" aria-pressed="' + sel + '">' + esc(p.nome) + '</button>';
      }).join('');
      return '<section class="nxg-cartao"><h2>Equipamento</h2>'
        + '<div class="nxg-pills" role="group" aria-label="Modelo do carregador">' + pills + '</div>'
        + '<div class="nxg-equip"><div class="nxg-campo"><span class="rotulo" id="nxg-rq">Quantidade</span>'
        + '<div class="nxg-step" role="group" aria-labelledby="nxg-rq"><button type="button" data-acao="qtd-" aria-label="Diminuir quantidade">-</button>'
        + '<span class="n" data-fn="qtd" aria-live="polite">' + esc(form.equip.quantidade) + '</span><button type="button" data-acao="qtd+" aria-label="Aumentar quantidade">+</button></div></div>'
        + '<div class="nxg-campo nxg-preco"><label for="nxg-preco">Preço unitário</label>'
        + comAfixo('<input id="nxg-preco" type="text" data-p="equip.preco" data-t="moeda" inputmode="decimal" autocomplete="off" value="' + esc(mostrarMoeda(form.equip.preco)) + '">', 'R$')
        + '<p class="nxg-nota" data-fn="sugerido"></p></div></div></section>';
    }
    function cartaoItens() {
      var linhas = form.itens.map(function (it, i) {
        var val = comAfixo(txt('itens.' + i + '.valor', { t: 'moeda', im: 'decimal', ph: '0,00', rot: 'Valor de ' + (it.livre ? 'outro item' : it.nome) }), 'R$');
        if (it.livre) {
          return '<div class="nxg-item livre"><div class="nxg-campo"><label>' + (it.nome === 'Outros' ? 'Outros (descrição)' : 'Item (descrição)') + '</label>' + txt('itens.' + i + '.descricao', { max: 80, ph: 'Descreva o item' }) + '</div>'
            + '<div class="nxg-campo"><label>Valor</label>' + val + '</div></div>';
        }
        return '<div class="nxg-item"><div class="nxg-campo"><label>' + esc(it.nome) + '</label>' + val + '</div></div>';
      }).join('');
      return '<section class="nxg-cartao"><h2>Infraestrutura e serviços</h2>'
        + '<p class="nxg-sub">Itens que entram no valor da proposta. Com R$ 0,00 o item não entra no valor e aparece como fora do valor.</p>'
        + '<div class="nxg-itens">' + linhas + '</div>'
        + '<div class="nxg-subtotal"><button type="button" class="nxg-sec" data-acao="item+">' + ICONE_MAIS + 'Adicionar item</button>'
        + '<div class="nxg-st"><span>Subtotal de infraestrutura e serviços</span><b data-prev="subtotal">R$ 0,00</b></div></div>'
        + '<div class="nxg-total"><span>Total da proposta</span><b data-prev="invest">R$ 0,00</b></div></section>';
    }
    function cartaoPremissas() {
      var corpo = GRUPOS.map(function (g) {
        return '<div class="nxg-grupo"><h3>' + esc(g.titulo) + '</h3><div class="nxg-grade">' + g.itens.map(function (c) {
          var ent = c.somenteLeitura
            ? '<input type="text" data-fn="seguro" value="" readonly tabindex="-1" aria-label="' + esc(c.rot) + '">'
            : txt('prem.' + c.k, { t: 'num', im: 'decimal' });
          var html = campo(c.rot, comAfixo(ent, c.pre, c.suf), { tip: c.tip });
          if (c.usina) html += '<div class="nxg-campo larga nxg-usina">' + chave('usina', 'Usina solar própria', TIP_USINA) + '<p class="nxg-dica-txt" hidden>' + esc(TIP_USINA) + '</p></div>';
          return html;
        }).join('') + '</div></div>';
      }).join('');
      return '<section class="nxg-cartao"><div class="nxg-cab"><h2>Premissas do Simulador</h2>'
        + '<button type="button" class="nxg-sec" data-acao="restaurar">' + ICONE_RESTAURAR + 'Restaurar padrão</button></div>'
        + '<p class="nxg-sub">Os mesmos padrões do Simulador. Mude só o que o seu caso pede.</p>' + corpo + '</section>';
    }
    function cartaoPagamento() {
      return '<section class="nxg-cartao"><h2>Pagamento e prazos</h2>'
        + '<p class="nxg-sub">Marque as condições que aparecem na proposta. A entrada é opcional.</p>'
        + '<div class="nxg-forma">' + chave('pg.vista', 'À vista') + '<p class="nxg-nota" data-fn="pg-vista"></p></div>'
        + '<div class="nxg-forma">' + chave('pg.cartao', 'Cartão em 18x') + '<div class="nxg-grade tres" data-gr="cartao">'
        + campo('Entrada', comAfixo(txt('pg.cartaoEntrada', { t: 'moeda', im: 'decimal', ph: '0,00' }), 'R$'))
        + campo('Parcelas', txt('pg.cartaoParcelas', { t: 'int', im: 'numeric', max: 2 }))
        + campo('Acréscimo total', comAfixo(txt('pg.cartaoJuros', { t: 'num', im: 'decimal' }), '', '%'), { tip: 'Acréscimo total sobre o valor parcelado, e não juro ao mês. O padrão é zero: o cartão sai em 18x sem acréscimo, como no site da NEXUS. Preencha só se quiser repassar a taxa.' })
        + '</div><p class="nxg-nota" data-fn="pg-cartao"></p></div>'
        + '<div class="nxg-forma">' + chave('pg.fin', 'Financiamento em até 96x com 120 dias de carência') + '<div class="nxg-grade" data-gr="fin">'
        + campo('Entrada', comAfixo(txt('pg.finEntrada', { t: 'moeda', im: 'decimal', ph: '0,00' }), 'R$'))
        + campo('Parcelas', txt('pg.finParcelas', { t: 'int', im: 'numeric', max: 3 }), { tip: 'Em até 96 parcelas. A parcela é calculada pela tabela Price, com os juros da carência somados ao saldo.' })
        + campo('Taxa de referência ao mês', comAfixo(txt('pg.finTaxa', { t: 'num', im: 'decimal' }), '', '%'), { tip: 'Taxa de referência de 1,49% ao mês. A taxa real depende da análise de crédito do banco.' })
        + campo('Carência', comAfixo(txt('pg.finCarenciaDias', { t: 'int', im: 'numeric', max: 3 }), '', 'dias'), { tip: 'Tempo até a primeira parcela. O padrão é 120 dias, e os juros desse período entram no saldo.' })
        + '</div><p class="nxg-nota" data-fn="pg-fin"></p></div>'
        + '<div class="nxg-grade nxg-prazos">'
        + campo('Validade da proposta', selectHTML('validade.modo', [{ v: 'sexta', r: 'Até a próxima sexta, às 18h' }, { v: 'dias', r: 'Por um número de dias' }]))
        + '<div class="nxg-campo" data-gr="dias"><label>Número de dias</label>' + txt('validade.dias', { t: 'int', im: 'numeric', max: 3 }) + '</div>'
        + '<p class="nxg-nota larga" data-fn="validade"></p>'
        + campo('Entrega', txt('entrega', { max: 90 }))
        + campo('Instalação', txt('instalacao', { max: 90 }))
        + campo('Observações', '<textarea data-p="obs" data-t="txt" rows="3" maxlength="600">' + esc(form.obs) + '</textarea>', { larga: true })
        + '</div></section>';
    }

    // ---------- resumo (lado direito) ----------
    function resumo() {
      var linha = function (rot, k, forte) { return '<div class="nxg-lin' + (forte ? ' forte' : '') + '"><span>' + rot + '</span><b data-prev="' + k + '">0</b></div>'; };
      var botoes = ['simulador', 'basico', 'completo'].map(function (saida) {
        var ok = saida === 'simulador' ? libera.simulador !== false : !!libera[saida];
        var S = SAIDAS[saida];
        return '<button type="button" class="nxg-btn' + (ok ? '' : ' trava') + '" data-saida="' + saida + '" aria-disabled="' + (ok ? 'false' : 'true') + '"'
          + (ok ? '' : ' data-motivo="' + esc(S.motivo) + '"') + '><span class="ic">' + (ok ? ICONES_SAIDA[saida] : ICONE_CADEADO) + '</span>'
          + '<span class="t"><b>' + S.rot + '</b><i>' + esc(ok ? S.sub : S.motivo) + '</i></span></button>';
      }).join('');
      return '<section class="nxg-hero" aria-live="polite"><span class="nxg-etq" data-fn="etq">1x NEXUS</span><span class="nxg-etq2">Em operação plena</span>'
        + '<p class="nxg-ret" data-fn="retorno">Retorno em cerca de <b>0</b> meses</p></section>'
        + '<section class="nxg-cartao nxg-resumo">' + linha('Investimento total', 'invest2', true) + linha('Faturamento estimado', 'fat') + linha('Custos de operação', 'custos') + linha('Lucro estimado', 'lucro', true)
        + '<p class="nxg-alerta" data-fn="alerta" hidden></p></section>'
        + '<section class="nxg-cartao nxg-resumo">' + linha('À vista', 'p-vista') + linha('No cartão', 'p-cartao')
        + '<div class="nxg-lin dupla"><span>Financiamento</span><b data-prev="p-fin">0</b><small data-fn="carencia"></small></div></section>'
        + '<section class="nxg-cartao"><h2>Caixa acumulado em 60 meses</h2><div class="nxg-grafico" data-fn="grafico"></div>'
        + '<p class="nxg-nota">Em operação plena, sem a rampa de ocupação. O Simulador em PDF considera a rampa. ' + esc(D.TEXTOS.avisoSimulador) + '</p></section>'
        + '<section class="nxg-cartao nxg-acoes"><h2>Gerar documento</h2><div class="nxg-btns">' + botoes + '</div>'
        + '<p class="nxg-msg" data-fn="msg" role="alert" hidden></p>'
        + '<p class="nxg-nota">O PDF abre na janela de impressão. Escolha “Salvar como PDF”.</p></section>';
    }

    // Grafico de linha do caixa acumulado (desenho do canvas: viewBox 480 x 262, area 56..456 x 21..220).
    function grafico(c) {
      var m = C.fluxoMensal(c.r, 60), pts = m.pontos;
      var maxV = Math.max.apply(null, pts.concat([0])), minV = Math.min.apply(null, pts.concat([0]));
      var amp = (maxV - minV) || 1;
      var passos = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000, 5000000];
      var passo = passos[passos.length - 1];
      for (var i = 0; i < passos.length; i++) { if (amp / passos[i] <= 5) { passo = passos[i]; break; } }
      var yMin = Math.floor(minV / passo) * passo, yMax = maxV;
      var X0 = 56, X1 = 456, Y0 = 220, Y1 = 21;
      var xs = function (mes) { return X0 + (X1 - X0) * mes / 60; };
      var ys = function (v) { return Y0 - (Y0 - Y1) * (v - yMin) / ((yMax - yMin) || 1); };
      var rotY = function (v) {
        var a = Math.abs(v);
        var t = v === 0 ? '0' : (a >= 1000000 ? (a / 1000000).toLocaleString('pt-BR') + ' mi' : (a / 1000).toLocaleString('pt-BR') + ' mil');
        return (v < 0 ? '-' : '') + t;
      };
      var out = '<text x="0" y="12" font-size="11" fill="#4A5568">R$</text>';
      for (var v = yMin; v <= yMax + 1; v += passo) {
        var y = ys(v).toFixed(1);
        out += '<line x1="' + X0 + '" y1="' + y + '" x2="' + X1 + '" y2="' + y + '" stroke="' + (v === 0 ? '#0B1A2B' : '#E3E8EF') + '" stroke-width="' + (v === 0 ? 1.4 : 1) + '"></line>'
          + '<text x="50" y="' + (Number(y) + 3.5).toFixed(1) + '" font-size="10" ' + (v === 0 ? 'font-weight="700" fill="#0B1A2B"' : 'fill="#4A5568"') + ' text-anchor="end">' + rotY(v) + '</text>';
      }
      [0, 12, 24, 36, 48, 60].forEach(function (mes) {
        out += '<line x1="' + xs(mes) + '" y1="' + Y0 + '" x2="' + xs(mes) + '" y2="' + (Y0 + 4) + '" stroke="#8A97A8" stroke-width="1"></line>'
          + '<text x="' + xs(mes) + '" y="240" font-size="10" fill="#4A5568" text-anchor="middle">' + mes + '</text>';
      });
      out += '<text x="256" y="257" font-size="10" fill="#4A5568" text-anchor="middle">Meses</text>';
      out += '<polyline fill="none" stroke="#0060C7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="'
        + pts.map(function (p, k) { return xs(k).toFixed(1) + ',' + ys(p).toFixed(1); }).join(' ') + '"></polyline>';
      var resumoTxt = 'Gráfico de linha do caixa acumulado em 60 meses: começa em ' + C.moedaK(pts[0]) + ' e chega a ' + C.moedaK(pts[60]) + ' no mês 60';
      if (m.cruza != null && m.cruza <= 60) {
        var cx = xs(m.cruza).toFixed(1), cy = ys(0).toFixed(1);
        out += '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + Y0 + '" stroke="#0B1A2B" stroke-width="1" stroke-dasharray="3 3"></line>'
          + '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="#0B1A2B" stroke="#FFFFFF" stroke-width="2"></circle>'
          + '<text x="' + (Number(cx) + 9) + '" y="' + (Number(cy) + 22) + '" font-size="11" font-weight="800" fill="#0B1A2B">Retorno · mês ' + Math.ceil(m.cruza) + '</text>';
        resumoTxt += ', cruzando o zero perto do mês ' + Math.ceil(m.cruza);
      }
      out += '<text x="62" y="212" font-size="10" font-weight="700" fill="#0B1A2B">' + esc(C.moedaK(pts[0])) + '</text>'
        + '<text x="450" y="' + Math.max(12, Number(ys(pts[60])) - 8).toFixed(1) + '" font-size="11" font-weight="800" fill="#0B1A2B" text-anchor="end">' + esc(pts[60] >= 0 ? 'Cerca de ' : '') + esc(C.moedaK(Math.round(pts[60] / 100) * 100)) + '</text>';
      return '<svg viewBox="0 0 480 262" role="img" aria-label="' + esc(resumoTxt) + '" class="nxg-svg">' + out + '</svg>';
    }

    // ---------- Minhas propostas ----------
    function secaoPropostas() {
      if (ctx.semLista === true) return '';
      var temFonte = !!(ctx.listarPropostas || ctx.demo);
      if (!temFonte) return '';
      var corpo;
      if (lista === null) corpo = '<p class="nxg-vazio">Carregando as propostas.</p>';
      else if (lista === false) corpo = '<div class="nxg-vazio"><p>Não foi possível carregar as propostas.</p><button type="button" class="nxg-sec" data-acao="recarregar">Tentar de novo</button></div>';
      else if (!lista.length) corpo = '<div class="nxg-vazio"><p><b>Você ainda não gerou propostas.</b></p><p>Gere o Simulador, o Orçamento Básico ou o Orçamento Completo, e a proposta aparece aqui.</p></div>';
      else corpo = '<div class="nxg-tab"><table><thead><tr><th scope="col">Número</th><th scope="col">Cliente</th><th scope="col">Cidade</th><th scope="col">Equipamento</th><th scope="col" class="d">Valor</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>'
        + lista.map(function (p, i) {
          var cidade = [p.cliente_cidade, p.cliente_uf].filter(Boolean).join('/');
          /* pedido_em e pedido_status saíram da proposta na v2: o pedido mora em /pedidos e liga por proposta_id. */
          var pedido = !!(p.id && pedidosPorProposta[p.id]);
          var abrir = '<button type="button" class="nxg-sec peq" data-acao="abrir" data-i="' + i + '">Abrir</button>'
            + '<button type="button" class="nxg-sec peq" data-acao="duplicar" data-i="' + i + '">Duplicar</button>';
          var pedir = libera.pedido
            ? (pedido ? '' : '<button type="button" class="nxg-prim peq" data-acao="pedir" data-i="' + i + '">Pedir equipamento</button>')
            : '<button type="button" class="nxg-sec peq trava" disabled>Disponível para Partner</button>';
          return '<tr><td class="n">' + esc(p.numero) + '</td><td class="c">' + esc(p.cliente_nome || 'Cliente sem nome') + '</td><td>' + esc(cidade) + '</td>'
            + '<td>' + esc((p.quantidade || 1) + 'x ' + String(p.modelo || '').replace(/^NEXUS\s+/, '')) + '</td>'
            + '<td class="d">' + esc(C.moeda2(p.valor_total)) + '</td>'
            + '<td><span class="nxg-chip' + (pedido ? ' forte' : '') + '">' + esc(pedido ? 'Equipamento pedido' : (SAIDA_NOME[p.saida_ultima] ? 'Gerada · ' + SAIDA_NOME[p.saida_ultima] : 'Gerada')) + '</span></td>'
            + '<td><div class="nxg-acs">' + abrir + pedir + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
      return '<section class="nxg-props"><h2>Minhas propostas</h2>' + corpo + '</section>';
    }
    function pintarPropostas() {
      var el = $('.nxg-props-host');
      if (el) el.innerHTML = secaoPropostas();
    }
    var pedidosPorProposta = {};
    function carregarPedidos() {
      if (ctx.demo || typeof ctx.api !== 'function') return;
      var chamada;
      try { chamada = Promise.resolve(ctx.api('GET', '/gerador/nexus/pedidos')); } catch (e) { return; }
      chamada.then(function (r) {
        var arr = r && Array.isArray(r.pedidos) ? r.pedidos : (r && r.data && Array.isArray(r.data.pedidos) ? r.data.pedidos : []);
        pedidosPorProposta = {};
        arr.forEach(function (x) { if (x && x.proposta_id && x.status !== 'cancelado') pedidosPorProposta[x.proposta_id] = x; });
        pintarPropostas();
      }).catch(function () { /* sem a lista de pedidos, a de propostas aparece do mesmo jeito */ });
    }
    function carregarLista() {
      if (ctx.semLista === true) return;
      carregarPedidos();
      if (ctx.demo && !ctx.listarPropostas) { lista = sessao.slice(); pintarPropostas(); return; }
      if (!ctx.listarPropostas) return;
      lista = null; pintarPropostas();
      var chamada;
      try { chamada = Promise.resolve(ctx.listarPropostas()); } catch (e) { chamada = Promise.reject(e); }
      chamada.then(function (r) {
        var arr = Array.isArray(r) ? r : (r && Array.isArray(r.propostas) ? r.propostas : null);
        lista = arr || false;
        pintarPropostas();
      }).catch(function () { lista = false; pintarPropostas(); });
    }

    // ---------- desenho ----------
    function desenhar() {
      raiz.innerHTML = '<div class="nxg-grid"><div class="nxg-form">' + cartaoCliente() + cartaoEquip() + cartaoItens() + cartaoPremissas() + cartaoPagamento() + '</div>'
        + '<aside class="nxg-lado">' + resumo() + '</aside></div><div class="nxg-props-host">' + secaoPropostas() + '</div>';
      atualizar();
    }

    // ---------- previa e estados ----------
    var pendente = false;
    function atualizar() {
      var c = C.calcular(form), r = c.r;
      var q = function (k, v) { $$('[data-prev="' + k + '"]').forEach(function (e) { e.textContent = v; }); };
      var itensSoma = c.totais.itens;
      q('subtotal', C.moeda2(itensSoma));
      q('invest', C.moeda2(c.totais.total)); q('invest2', C.moeda2(c.totais.total));
      q('fat', C.moeda(r.fatMes) + ' por mês');
      q('custos', C.moeda(r.custosMes) + ' por mês');
      q('lucro', C.moeda(r.lucroMes) + ' por mês');
      q('p-vista', c.pg.vista ? C.moeda2(c.pg.vista.valor) : 'Desligado');
      q('p-cartao', c.pg.cartao ? c.pg.cartao.parcelas + 'x de ' + C.moeda2(c.pg.cartao.parcela) : 'Desligado');
      q('p-fin', c.pg.fin ? c.pg.fin.parcelas + 'x de ' + C.moeda2(c.pg.fin.parcela) : 'Desligado');
      var etq = $('[data-fn="etq"]'); if (etq) etq.textContent = (Math.max(1, Math.round(C.num(form.equip.quantidade)) || 1)) + 'x ' + ((produto() || {}).nome || 'carregador NEXUS');
      var car = $('[data-fn="carencia"]'); if (car) car.textContent = c.pg.fin ? 'Com ' + c.pg.fin.carenciaDias + ' dias de carência' : '';
      var ret = $('[data-fn="retorno"]');
      if (ret) {
        ret.innerHTML = c.paybackPleno != null && c.paybackPleno <= 600
          ? 'Retorno em cerca de <b>' + Math.ceil(c.paybackPleno) + '</b> meses'
          : 'Com estas premissas o dinheiro <b class="sem">não volta</b> em 50 anos';
      }
      var seg = $('[data-fn="seguro"]'); if (seg) seg.value = (r.seguroMes * 12).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var al = $('[data-fn="alerta"]');
      var aviso = '';
      if (!(c.totais.total > 0)) aviso = 'Informe o preço do equipamento para ver os números.';
      else if (r.payback == null) aviso = 'Com estas premissas o investimento não se paga em 10 anos. O Simulador e o Orçamento Básico saem com este aviso, e o Orçamento Completo fica bloqueado até a conta fechar.';
      if (al) { al.hidden = !aviso; al.textContent = aviso; }
      var gr = $('[data-fn="grafico"]'); if (gr) gr.innerHTML = grafico(c);
      var prod = produto();
      var sug = $('[data-fn="sugerido"]');
      if (sug) {
        var acima = prod && C.lerMoeda(form.equip.preco) > prod.precoSugerido;
        sug.textContent = prod ? 'Preço de tabela de ' + prod.nome + ': ' + C.moeda2(prod.precoSugerido) + ', teto para o cliente final.' + (acima ? ' O valor digitado está acima da tabela.' : '') + ' Total do equipamento: ' + C.moeda2(c.totais.equipamento) + '.' : '';
      }
      var qt = $('[data-fn="qtd"]'); if (qt) qt.textContent = String(Math.max(1, Math.round(C.num(form.equip.quantidade)) || 1));
      var nv = $('[data-fn="pg-vista"]'); if (nv) nv.textContent = c.pg.vista ? 'Valor à vista: ' + C.moeda2(c.pg.vista.valor) : '';
      var nc = $('[data-fn="pg-cartao"]'); if (nc) nc.textContent = c.pg.cartao ? 'Parcela: ' + c.pg.cartao.parcelas + 'x de ' + C.moeda2(c.pg.cartao.parcela) + (c.pg.cartao.juros > 0 ? ' com ' + String(c.pg.cartao.juros).replace('.', ',') + '% de acréscimo.' : ', sem acréscimo.') : '';
      var nf = $('[data-fn="pg-fin"]'); if (nf) nf.textContent = c.pg.fin ? 'Parcela: ' + c.pg.fin.parcelas + 'x de ' + C.moeda2(c.pg.fin.parcela) + ', com ' + c.pg.fin.carenciaDias + ' dias de carência. Sujeito à análise de crédito.' : '';
      var nval = $('[data-fn="validade"]'); if (nval) nval.textContent = C.validadeTexto(form.validade, new Date()) + '.';
      var gd = $('[data-gr="dias"]'); if (gd) gd.hidden = form.validade.modo !== 'dias';
      ['cartao', 'fin'].forEach(function (k) { var g = $('[data-gr="' + k + '"]'); if (g) g.classList.toggle('desligada', form.pg[k] === false); });
      $$('.nxg-pill').forEach(function (b) { var s = b.getAttribute('data-modelo') === form.equip.modelo; b.classList.toggle('sel', s); b.setAttribute('aria-pressed', String(s)); });
    }
    function agendar() { if (pendente) return; pendente = true; requestAnimationFrame(function () { pendente = false; atualizar(); }); }

    // ---------- eventos (delegados na raiz, que e' nova a cada montar) ----------
    function lerCampo(el) {
      var t = el.getAttribute('data-t');
      if (t === 'bool') return el.checked;
      var v = el.value;
      if (t === 'num') return v.trim() === '' ? '' : C.lerNumero(v);
      if (t === 'int') return v.trim() === '' ? '' : Math.round(C.lerNumero(v));
      return v;
    }
    raiz.addEventListener('input', function (ev) {
      var el = ev.target;
      if (!el.getAttribute || !el.getAttribute('data-p')) return;
      var path = el.getAttribute('data-p');
      if (path === 'equip.preco') form.equip.precoEditado = true;
      if (path === 'prem.carros') form.carrosEditado = true;
      set(path, el.getAttribute('data-t') === 'moeda' ? el.value : lerCampo(el));
      if (path === 'prem.custoKwh' && form.usina === false) form.custoRede = form.prem.custoKwh;
      agendar();
    });
    raiz.addEventListener('change', function (ev) {
      var el = ev.target;
      var path = el.getAttribute && el.getAttribute('data-p');
      if (!path) return;
      if (path === 'usina') {
        var c = $('[data-p="prem.custoKwh"]');
        if (el.checked) { form.custoRede = form.prem.custoKwh === '' ? C.PREMISSAS_PADRAO.custoKwh : form.prem.custoKwh; form.prem.custoKwh = C.CUSTO_KWH_SOLAR; }
        else { form.prem.custoKwh = form.custoRede; }
        if (c) c.value = mostrarNum(form.prem.custoKwh);
      }
      if (path === 'validade.modo' || path === 'usina' || /^pg\./.test(path)) { set(path, lerCampo(el)); }
      agendar();
    });
    // Campo de dinheiro: ao sair, escreve "69.990,00". Ao entrar, seleciona tudo.
    raiz.addEventListener('focusout', function (ev) {
      var el = ev.target;
      if (el.getAttribute && el.getAttribute('data-t') === 'moeda') { el.value = mostrarMoeda(C.lerMoeda(el.value) || ''); }
    });
    raiz.addEventListener('focusin', function (ev) { var el = ev.target; if (el.getAttribute && el.getAttribute('data-t') === 'moeda') setTimeout(function () { try { el.select(); } catch (e) {} }, 0); });

    function trocarModelo(id) {
      var prod = prods.filter(function (p) { return p.id === id; })[0];
      if (!prod) return;
      form.equip.modelo = id;
      if (!form.equip.precoEditado) {
        form.equip.preco = prod.precoSugerido;
        var ip = $('[data-p="equip.preco"]'); if (ip) ip.value = mostrarMoeda(form.equip.preco);
      }
      atualizar();
    }
    function mudarQtd(d) {
      var n = Math.min(50, Math.max(1, (Math.round(C.num(form.equip.quantidade)) || 1) + d));
      form.equip.quantidade = n;
      if (!form.carrosEditado) { form.prem.carros = C.recargasPadrao(n); var ic = $('[data-p="prem.carros"]'); if (ic) ic.value = mostrarNum(form.prem.carros); }
      atualizar();
    }
    raiz.addEventListener('click', function (ev) {
      var alvo = ev.target.closest && ev.target.closest('[data-acao],[data-saida],[data-modelo]');
      if (!alvo || !raiz.contains(alvo)) return;
      var modelo = alvo.getAttribute('data-modelo');
      if (modelo) { trocarModelo(modelo); return; }
      var saida = alvo.getAttribute('data-saida');
      if (saida) { gerar(saida, alvo); return; }
      var acao = alvo.getAttribute('data-acao');
      var i = Number(alvo.getAttribute('data-i'));
      if (acao === 'dica') {
        var cx = alvo.closest('.nxg-campo');
        var p = cx && cx.querySelector('.nxg-dica-txt');
        if (p) { p.hidden = !p.hidden; alvo.setAttribute('aria-expanded', String(!p.hidden)); }
      } else if (acao === 'qtd-') mudarQtd(-1);
      else if (acao === 'qtd+') mudarQtd(1);
      else if (acao === 'item+') {
        form.itens.push({ id: 'extra' + Date.now(), nome: 'Item', livre: true, descricao: '', valor: '' });
        desenhar();
      } else if (acao === 'restaurar') {
        form.prem = Object.assign({}, C.PREMISSAS_PADRAO); form.carrosEditado = false; form.prem.carros = C.recargasPadrao(form.equip.quantidade); form.usina = false; form.custoRede = C.PREMISSAS_PADRAO.custoKwh;
        GRUPOS.forEach(function (g) { g.itens.forEach(function (c) { var inp = $('[data-p="prem.' + c.k + '"]'); if (inp) inp.value = mostrarNum(form.prem[c.k]); }); });
        var u = $('[data-p="usina"]'); if (u) u.checked = false;
        mensagem('Premissas restauradas para o padrão do Simulador.', false);
        atualizar();
      } else if (acao === 'recarregar') carregarLista();
      else if (acao === 'abrir') abrirProposta(lista && lista[i], false);
      else if (acao === 'duplicar') abrirProposta(lista && lista[i], true);
      else if (acao === 'pedir') { if (ctx.pedirEquipamento && lista && lista[i]) ctx.pedirEquipamento(lista[i]); }
    });

    // Abrir carrega `dados.form` no formulario (e passa a editar a MESMA proposta). Duplicar carrega e vira proposta nova.
    function abrirProposta(p, duplicar) {
      if (!p) return;
      var carregar = function (completa) {
        if (!completa || (!completa.dados && !completa.cliente_nome)) { mensagem('Não foi possível abrir esta proposta.', true); return; }
        form = formDaProposta(C, ctx, completa);
        if (duplicar) { atual = null; form.obs = form.obs || ''; }
        else atual = { id: completa.id || p.id, numero: completa.numero || p.numero };
        desenhar();
        mensagem(duplicar ? 'Proposta ' + (p.numero || '') + ' copiada como nova. Ajuste e gere de novo.' : 'Proposta ' + (p.numero || '') + ' aberta. Ao gerar, ela é atualizada.', false);
        if (raiz.scrollIntoView) raiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
      if (p.dados) { carregar(p); return; }
      if (!ctx.api) { mensagem('Não foi possível abrir esta proposta.', true); return; }
      Promise.resolve(ctx.api('GET', '/gerador/nexus/propostas/' + encodeURIComponent(p.id))).then(function (r) {
        var d = r && r.proposta ? r.proposta : (r && r.data && r.data.proposta ? r.data.proposta : r);
        carregar(d);
      }).catch(function () { mensagem('Não foi possível abrir esta proposta.', true); });
    }

    // ---------- validacao e geracao ----------
    function mensagem(txtMsg, erro) {
      var m = $('[data-fn="msg"]');
      if (!m) return;
      m.hidden = !txtMsg; m.textContent = txtMsg || ''; m.classList.toggle('erro', !!erro);
      if (txtMsg && erro && m.scrollIntoView) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function validar(saida, c) {
      var ok = saida === 'simulador' ? libera.simulador !== false : !!libera[saida];
      if (!ok) return SAIDAS[saida].motivo + '.';
      if (!String(form.cliente.nome || '').trim()) return 'Informe o nome do cliente.';
      var q = Math.round(C.num(form.equip.quantidade));
      if (!(q >= 1 && q <= 50)) return 'A quantidade de carregadores vai de 1 a 50.';
      if (!(C.lerMoeda(form.equip.preco) > 0)) return 'Informe o preço unitário do equipamento.';
      if (!produto()) return 'Escolha o modelo do equipamento.';
      if (!(c.totais.total > 0)) return 'O total da proposta precisa ser maior que zero.';
      if (c.totais.total >= 100000000) return 'O total da proposta passa do limite de R$ 100 milhões.';
      // Mesma regra do /gerador (epCompletoGerar): sem payback em 10 anos, o Completo nao sai.
      if (saida === 'completo' && c.r.payback == null) return 'Com estas premissas o investimento não se paga em 10 anos, e o Orçamento Completo não pode ser gerado. Ajuste os carros por dia, o preço do kWh ou os valores da proposta.';
      return '';
    }
    function montarPayload(saida, c) {
      var prod = produto() || {};
      var r = c.r;
      var resumoCalc = {
        investimento: c.totais.total, faturamento_mes: r.fatMes, lucro_mes: r.lucroMes, payback_anos: r.payback, payback_pleno_meses: c.paybackPleno,
        tir: r.tir, vpl: r.vpl, acumulado_10_anos: r.acumulado10,
        parcela_cartao: c.pg.cartao ? c.pg.cartao.parcela : null, parcelas_cartao: c.pg.cartao ? c.pg.cartao.parcelas : null,
        parcela_financiamento: c.pg.fin ? c.pg.fin.parcela : null, parcelas_financiamento: c.pg.fin ? c.pg.fin.parcelas : null
      };
      var f = JSON.parse(JSON.stringify(form));   // copia: o formulario segue vivo na tela
      return {
        saida: saida,
        cliente: { nome: String(form.cliente.nome).trim(), doc: form.cliente.doc, cidade: form.cliente.cidade, uf: form.cliente.uf,
                   telefone: form.cliente.telefone, email: form.cliente.email, tipo_local: form.cliente.tipo_local },
        equipamento: { modelo: prod.nome || form.equip.modelo, quantidade: Math.round(C.num(form.equip.quantidade)), preco_unitario: C.lerMoeda(form.equip.preco) },
        valor_total: Math.round(c.totais.total * 100) / 100,
        dados: { versao: 2, form: f, resumo: resumoCalc }
      };
    }
    function textoBotao(b, saida, t) { var i = b && b.querySelector('i'); if (i) i.textContent = t != null ? t : SAIDAS[saida].sub; }
    function gerar(saida, botao) {
      if (ocupado) return Promise.resolve();
      var c = C.calcular(form);
      var erro = validar(saida, c);
      if (erro) { mensagem(erro, true); return Promise.resolve(); }
      mensagem('', false);
      ocupado = true;
      $$('.nxg-btn').forEach(function (b) { b.classList.add('ocupado'); });
      textoBotao(botao, saida, 'Gerando...');
      var payload = montarPayload(saida, c);
      var salvar;
      try {
        salvar = ctx.salvarProposta ? Promise.resolve(ctx.salvarProposta(payload, atual ? { id: atual.id, numero: atual.numero } : { id: null })) : Promise.resolve({ id: 'demo', numero: '20260000' });
      } catch (e) { salvar = Promise.reject(e); }
      return salvar.then(function (res) {
        atual = { id: res && res.id, numero: res && res.numero };
        var P = D.preparar(ctx, form, res && res.numero);
        var doc = D.render(saida, P);
        return D.imprimir(doc.html, doc.nomeArq, doc.opts).then(function () {
          if (ctx.demo && !ctx.listarPropostas) {
            sessao.unshift({ id: res && res.id, numero: res && res.numero, cliente_nome: payload.cliente.nome, cliente_cidade: payload.cliente.cidade, cliente_uf: payload.cliente.uf,
                             modelo: payload.equipamento.modelo, quantidade: payload.equipamento.quantidade, valor_total: payload.valor_total, saida_ultima: saida, dados: payload.dados });
          }
          if (ctx.onGerou) ctx.onGerou(saida, { id: res && res.id, numero: res && res.numero });
          carregarLista();
        });
      }).catch(function (e) {
        mensagem((e && e.message) || 'Não foi possível gerar o documento. Tente de novo.', true);
        if (window.console) console.error('NexusGerar', e);
      }).then(function () {
        ocupado = false;
        $$('.nxg-btn').forEach(function (b) { b.classList.remove('ocupado'); });
        textoBotao(botao, saida);
      });
    }

    desenhar();
    carregarLista();
    return {
      getForm: function () { return JSON.parse(JSON.stringify(form)); },
      calcular: function () { return C.calcular(form); },
      gerar: function (saida) { var b = $('[data-saida="' + saida + '"]'); return gerar(saida, b); },
      destruir: function () { container.innerHTML = ''; }
    };
  }

  window.NexusGerar = { montar: montar, versao: 2 };
})();
