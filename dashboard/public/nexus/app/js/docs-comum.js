/* Portal do Parceiro NEXUS · base dos tres documentos (Simulador, Basico, Completo).
 *
 * Aqui mora o que os tres dividem: textos fixos (bloco E), co-branding (logo NEXUS, "Em parceria com",
 * logo ou nome do parceiro), rodape com a linha do distribuidor, formatadores, o chip de pagamento,
 * o encaixe em uma folha e a impressao.
 *
 * Copiado e adaptado de dashboard/public/gerador/index.html:
 *   epPrint (21149), epNomeArq (21140), epPageFootHTML (20213), epTopoHTML (20194),
 *   orc1Encaixa (19854), orc1PagChips (21038).
 * Tirado de proposito: consultor da casa, Pix/banco da Aioros, notas internas, Sociedade, tabela
 * "chave na mao", QR do vendedor e todo vocabulario interno.
 *
 * Renderizar e imprimir sao coisas separadas: NexusDocs.simulador/basico/completo(P) devolvem HTML
 * (string); NexusDocs.imprimir(html, nomeArq, opts) monta no contenedor de impressao e chama o print.
 */
(function () {
  'use strict';
  function cidUf(c, u) { return window.NxCidadeUf ? window.NxCidadeUf(c, u) : [c, u].filter(Boolean).join('/'); }
  var C = window.NexusCalc;
  var D = window.NexusDocs = window.NexusDocs || {};

  // ===== Constantes de marca (catalogo da API manda; estas sao a reserva) =====
  // O distribuidor mora aqui, numa constante, para trocar em uma linha. ctx.catalogo.marca.distribuidor ganha.
  D.distribuidor = 'Equipamento NEXUS Eletropostos · AIOROS GROUP LTDA · CNPJ 63.636.043/0001-88';
  D.slogan = 'Energia que move o amanhã';
  D.IMG = '/nexus/img/';
  D.LOGO_PAPEL = '/gerador/nexus-logo-papel.png';
  D.LOGO_TELA = '/gerador/nexus-logo-tela.png';
  D.LOGO_X = '/gerador/nexus-x.png';
  D.PILARES = ['Recarga rápida e segura', 'Energia limpa e sustentável', 'Tecnologia de ponta', 'Mobilidade para todos'];
  D.SEM_DADO = 'Consulte ficha técnica';
  // Campos de especificacao do catalogo, na ordem do papel. Valor null = "Consulte ficha tecnica".
  D.SPECS_CAMPOS = [['conectores', 'Conectores'], ['atendimento', 'Atendimento'], ['comunicacao', 'Comunicação'], ['refrigeracao', 'Refrigeração'],
    ['tela', 'Tela'], ['monitoramento', 'Monitoramento'], ['corrente', 'Corrente'], ['tensaoEntrada', 'Tensão de entrada'],
    ['eficiencia', 'Eficiência'], ['protecao', 'Proteção'], ['certificacao', 'Certificação'], ['garantia', 'Garantia']];
  // Na demonstracao (sem API) os campos vazios do catalogo ganham estes valores de exemplo. Nada alem do que o
  // catalogo da API tambem vai mandar: o que nao tem valor conhecido segue vazio e sai "Consulte ficha tecnica".
  D.SPECS_DEMO = { conectores: 'CCS2, 2 plugues', atendimento: 'Dois carros ao mesmo tempo', comunicacao: 'OCPP 1.6J', refrigeracao: 'Ativa', corrente: 'Corrente contínua (DC)' };

  // ===== Textos fixos (bloco E da especificacao, usados como estao) =====
  D.TEXTOS = {
    sobre: 'A NEXUS Eletropostos oferece carregadores rápidos em corrente contínua para veículos elétricos, nas versões de 80 kW e 120 kW. Nossa proposta é simples: recarga rápida e segura, energia limpa e sustentável, tecnologia de ponta e mobilidade para todos. Energia que move o amanhã.',
    porque: 'A frota de veículos elétricos cresce e quem roda com eles precisa de onde recarregar com rapidez. O carregador rápido atrai o motorista para o local e cria uma nova fonte de receita para o ponto. Para quem tem espaço, energia disponível e movimento, o eletroposto transforma área parada em negócio. Quanto antes o ponto entra no mapa, mais cedo ele faz parte da rotina dos motoristas da região.',
    operacao: 'A operação é feita pelo software NEXUS. Ele cuida da cobrança de cada recarga, do monitoramento do carregador e dos relatórios de uso e de receita. Quando há repasse ao dono do ponto, ele é calculado e acompanhado no próprio sistema, com transparência para as duas partes. Você acompanha tudo em um só lugar.',
    garantias: 'O equipamento tem garantia conforme a ficha técnica do fabricante. A venda é feita com nota fiscal. Certificação: consulte a ficha técnica. Depois da instalação, a NEXUS oferece suporte ao equipamento.',
    avisoSimulador: 'Simulação estimativa, feita com os dados informados e premissas de mercado, que não garante resultado e pode variar conforme o local, a tarifa de energia e o uso do carregador.'
  };

  // ===== Utilitarios =====
  D.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = D.esc;
  var dig = function (s) { return String(s || '').replace(/\D/g, ''); };
  D.cnpjBonito = function (v) {
    var d = dig(v);
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(v || '');
  };
  D.telBonito = function (v) {
    var d = dig(v);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return String(v || '');
  };
  // Logo do parceiro: data URL -> blob URL, UMA vez por documento. O Completo repete a marca em toda
  // folha, e 10 copias de um logo em base64 (ate ~600 KB) engordariam o HTML sem necessidade.
  var blobAtual = null;
  function logoSrc(dataUrl) {
    if (!dataUrl) return '';
    try {
      var m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
      if (!m) return dataUrl;
      var bin = atob(m[2]), buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      if (blobAtual) URL.revokeObjectURL(blobAtual);
      blobAtual = URL.createObjectURL(new Blob([buf], { type: m[1] }));
      return blobAtual;
    } catch (e) { return dataUrl; }
  }

  // ===== O pacote que os tres documentos leem =====
  // ctx: o que a casca entrega. form: o formulario. numero: o numero da proposta (vem do salvarProposta).
  // opcoes.agora: data-base do documento (a pagina publica usa a data em que a proposta foi gerada, para o
  // cliente nao ver "hoje" e uma validade nova a cada abertura). Sem ela, vale o momento atual.
  // NADA aqui leva logo_base64 para dentro de `dados` (limite de 200 KB), nem precoRevenda.
  D.preparar = function (ctx, form, numero, opcoes) {
    ctx = ctx || {};
    var calc = C.calcular(form);
    var base = opcoes && opcoes.agora ? new Date(opcoes.agora) : null;
    var agora = base && !isNaN(base.getTime()) ? base : new Date();
    var emp = ctx.empresa || {};
    var par = ctx.parceiro || {};
    var marca = (ctx.catalogo && ctx.catalogo.marca) || {};
    var produtos = (ctx.catalogo && ctx.catalogo.produtos) || [];
    var produto = null;
    for (var i = 0; i < produtos.length; i++) if (produtos[i].id === form.equip.modelo) produto = produtos[i];
    var cli = form.cliente || {};
    var cidadeEmp = par.cidade ? cidUf(par.cidade, par.uf) : (emp.cidade || '');
    var localCli = cidUf(cli.cidade, cli.uf);
    return {
      ctx: ctx, form: form, calc: calc, numero: numero || '',
      agora: agora, data: C.dataBR(agora),
      validade: C.validadeTexto(form.validade, agora),
      empresa: {
        nome: String(emp.nome_fantasia || emp.nome || par.empresa || 'Empresa parceira').trim(),
        cnpj: D.cnpjBonito(emp.cnpj || par.cnpj || ''),
        cidade: cidadeEmp,
        whatsapp: emp.whatsapp ? D.telBonito(emp.whatsapp) : '',
        whatsappDig: dig(emp.whatsapp || ''),
        logo: logoSrc(emp.logo_base64 || '')
      },
      cliente: { nome: String(cli.nome || '').trim(), doc: cli.doc || '', cidade: cli.cidade || '', uf: cli.uf || '',
                 telefone: cli.telefone || '', email: cli.email || '', tipo_local: cli.tipo_local || '', local: localCli },
      produto: produto, modelo: produto ? produto.nome : 'Carregador NEXUS',
      potenciaKw: produto ? produto.potenciaKw : null,
      specs: (function () {
        var sp = Object.assign({}, (produto && produto.specs) || {});
        if (ctx.demo) Object.keys(D.SPECS_DEMO).forEach(function (k) { if (sp[k] == null || sp[k] === '') sp[k] = D.SPECS_DEMO[k]; });
        return sp;
      })(),
      quantidade: Math.max(1, Math.round(C.num(form.equip.quantidade)) || 1),
      // Entrega: o que o parceiro editou, senao o texto do catalogo (ctx.entrega), senao o padrao do calc.
      entrega: String(form.entrega || form.prazo || '').trim() || String(ctx.entrega || '').trim() || C.ENTREGA_PADRAO,
      instalacao: String(form.instalacao == null ? C.INSTALACAO_PADRAO : form.instalacao).trim(),
      obsLivre: String(form.obs || '').trim(),
      // Servicos NEXUS na proposta: o total dos que entram no valor e as linhas informativas da plataforma e da manutencao ('' = nao vai).
      servicosTotal: calc.totais.servicos || 0,
      plataforma: C.plataformaLinha(form),
      manutencao: C.manutencaoLinha(form),
      selo: !!(ctx.libera && ctx.libera.selo),
      distribuidor: marca.distribuidor || D.distribuidor,
      pilares: (marca.pilares && marca.pilares.length) ? marca.pilares : D.PILARES
    };
  };

  // Itens que entram no valor (valor > 0) e os que ficam de fora (R$ 0). Sem preco por item no papel.
  // Data por extenso em Brasilia: 21 de outubro de 2026.
  D.dataLonga = function (d) {
    return (d instanceof Date ? d : new Date(d)).toLocaleDateString('pt-BR', { timeZone: C.TZ, day: 'numeric', month: 'long', year: 'numeric' });
  };
  // Frase da entrega: "Entrega na primeira quinzena de dezembro. Instalação combinada com o cliente depois da entrega."
  D.fraseEntrega = function (P) {
    var fim = function (t) { return /[.!?]$/.test(t) ? t : t + '.'; };
    return [P.entrega, P.instalacao].filter(Boolean).map(fim).join(' ');
  };

  D.escopo = function (P) {
    var itens = C.itensDe(P.form);
    return {
      dentro: itens.filter(function (i) { return i.valor > 0; }).map(function (i) { return i.nome; }),
      fora: itens.filter(function (i) { return i.valor <= 0; }).map(function (i) { return i.livre ? null : i.nome; }).filter(Boolean)
    };
  };

  // ===== Co-branding =====
  // tema: 'papel' (folha clara: logo escuro), 'escuro' (slide escuro: logo branco + logo do parceiro
  // numa pilula branca, senao um logo escuro some), 'claro' (slide claro: logo escuro, sem pilula).
  D.marcaParceiro = function (P, tema) {
    var logo = P.empresa.logo;
    if (logo) return '<span class="nx-pl' + (tema === 'escuro' ? ' pilula' : '') + '"><img src="' + esc(logo) + '" alt="' + esc(P.empresa.nome) + '"></span>';
    return '<span class="nx-pn' + (tema === 'escuro' ? ' sobre-escuro' : '') + '">' + esc(P.empresa.nome) + '</span>';
  };
  D.cobrand = function (P, tema) {
    var nx = (tema === 'escuro') ? D.LOGO_TELA : D.LOGO_PAPEL;
    return '<div class="nx-cb nx-cb-' + tema + '"><img class="nx-cb-nx" src="' + nx + '" alt="NEXUS Eletropostos">'
      + '<span class="nx-cb-com">Em parceria com</span>' + D.marcaParceiro(P, tema) + '</div>';
  };
  // Rodape: "NEXUS em parceria com {empresa}" (credenciado: "Parceiro Credenciado NEXUS | Energia que move o amanha").
  D.rodapeMarca = function (P) {
    return P.selo ? 'Parceiro Credenciado NEXUS | ' + D.slogan : 'NEXUS em parceria com ' + P.empresa.nome;
  };

  // Rodape de pagina das folhas A4 (Simulador e Basico).
  D.pageFoot = function (P, doc) {
    var dir = 'Documento de uma via';
    return '<div class="ep-pagefoot nx-pf"><div class="l1"><span class="ep-foot-esq"><img class="ep-foot-logo" src="' + D.LOGO_X + '" alt="">'
      + '<span>' + esc(D.rodapeMarca(P)) + ' · ' + esc(doc) + (P.cliente.nome ? ' · ' + esc(P.cliente.nome) : '') + '</span></span><span>' + dir + '</span></div>'
      + '<div class="nx-dist">' + esc(P.distribuidor) + '</div></div>';
  };

  // Topo das folhas A4: co-branding a esquerda, caixa escura com os dados a direita.
  D.topoHTML = function (P, titulo, rows, rodapeVal) {
    var rowsHTML = (rows || []).filter(function (r) { return r && r[1]; })
      .map(function (r) { return '<div class="rowf"><span>' + r[0] + '</span><span class="v">' + r[1] + '</span></div>'; }).join('');
    return '<div class="ep-topo"><div class="ep-brand">' + D.cobrand(P, 'papel') + '</div>'
      + '<div class="ep-propbox"><div class="t">' + titulo + '</div>'
      + '<div class="rowf"><span>Data</span><span class="v">' + P.data + '</span></div>' + rowsHTML
      + (rodapeVal ? '<div class="ep-valid">' + rodapeVal + '</div>' : '') + '</div></div>';
  };

  // Bloco escuro de contato (Empresa | Contato). So o que o parceiro tem; nada da casa NEXUS alem do rodape.
  D.contatoBloco = function (P) {
    var row = function (k, v) { return v ? '<div class="ep-fb-row"><span class="k">' + k + '</span><span class="v">' + esc(v) + '</span></div>' : ''; };
    var fone = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z"/></svg>';
    return '<div class="ep-forma-label">Contato</div><div class="ep-footer-block ep-avoid-break">'
      + '<div class="ep-fb-col"><div class="t">Empresa</div>' + row('Nome', P.empresa.nome) + row('CNPJ', P.empresa.cnpj) + row('Cidade', P.empresa.cidade) + '</div>'
      + '<div class="ep-fb-col vend"><div class="ep-fb-ic">' + fone + '</div><div class="t">Contato</div>'
      + row('WhatsApp', P.empresa.whatsapp) + row('Proposta', P.numero ? 'Nº ' + P.numero : '') + '</div></div>';
  };

  // ===== Condicao de pagamento (copia de orc1PagChips, 21038) =====
  D.pagItens = function (P) {
    var pg = P.calc.pg, total = P.calc.totais.total, out = [];
    if (pg.vista) out.push({ k: 'À vista', v: C.moeda2(pg.vista.valor), s: '' });
    var c = pg.cartao;
    if (c && c.restante > 0) {
      out.push({ k: c.entrada > 0 ? 'Entrada + cartão' : 'Cartão',
                 v: (c.entrada > 0 ? C.moeda2(c.entrada) + ' + ' : '') + c.parcelas + 'x de ' + C.moeda2(c.parcela), s: '' });
    }
    var f = pg.fin;
    if (f && f.financiado > 0) {
      out.push({ k: f.entrada > 0 ? 'Entrada + financiamento' : 'Financiamento',
                 v: (f.entrada > 0 ? C.moeda2(f.entrada) + ' + ' : '') + f.parcelas + 'x de ' + C.moeda2(f.parcela),
                 s: 'Com ' + f.carenciaDias + ' dias de carência, sujeito à análise de crédito' });
    }
    if (!out.length) out.push({ k: 'À vista', v: C.moeda2(total), s: '' });
    return out;
  };
  D.pagChips = function (P) {
    return '<div class="pags">' + D.pagItens(P).map(function (x) {
      return '<div class="pag"><b>' + esc(x.k) + '</b><span>' + esc(x.v) + '</span>' + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  };

  // Observacoes padrao do papel. Texto proprio: o da casa (ORC_OBS_PADRAO) fala de obra chave na mao.
  D.obsPadrao = function (P) {
    return 'Equipamento com garantia conforme a ficha técnica do fabricante. A venda é feita com nota fiscal. '
      + 'Os itens listados fazem parte do valor desta proposta. Valores válidos durante o prazo desta proposta. '
      + D.fraseEntrega(P);
  };

  // ===== Encaixe em UMA folha (copia de orc1Encaixa, 19854) =====
  // zoom (e nao transform) porque so o zoom muda o layout que a paginacao le.
  D.encaixa = function (host, alvoSel, piso) {
    var el = host.querySelector(alvoSel);
    if (!el) return null;
    var antes = host.getAttribute('style');
    host.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;width:210mm';
    var regua = document.createElement('div');
    regua.style.cssText = 'position:absolute;visibility:hidden;height:291mm';
    document.body.appendChild(regua);
    var limite = regua.offsetHeight;
    regua.remove();
    var alt = el.scrollHeight;
    piso = piso || 0.74;
    var fator = limite > 0 && alt > 0 ? limite / alt : 1;
    var r = { fator: fator, piso: piso, estoura: fator < piso, encolhe: fator < 1 && fator >= piso };
    if (r.encolhe) el.style.zoom = String(fator.toFixed(4));
    if (antes == null) host.removeAttribute('style'); else host.setAttribute('style', antes);
    return r;
  };

  // ===== Recursos (css e fonte), carregados uma vez =====
  D.garantirRecursos = function () {
    var head = document.head;
    if (!document.querySelector('link[href*="/nexus/app/css/docs.css"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = '/nexus/app/css/docs.css';
      head.appendChild(l);
    }
    if (!document.querySelector('link[href*="family=Montserrat"]')) {
      var f = document.createElement('link');
      f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap';
      head.appendChild(f);
    }
  };

  // ===== Contenedor de impressao =====
  // Filho DIRETO do body: a regra de impressao esconde todo o resto do body, e um host dentro de
  // outro elemento sumiria junto. Nunca depende de markup da casca.
  D.host = function () {
    var h = document.getElementById('nx-print');
    if (!h) {
      h = document.createElement('div');
      h.id = 'nx-print';
      h.setAttribute('aria-hidden', 'true');
      document.body.appendChild(h);
    }
    return h;
  };
  D.limparImpressao = function () {
    var h = document.getElementById('nx-print');
    if (h) h.innerHTML = '';
    document.body.classList.remove('nx-print-doc', 'nx-print-escuro');
  };
  // Monta o documento no host SEM imprimir. Serve a impressao e a bancada de teste.
  // opts: {umaPagina, alvo, piso, escuro}
  D.montar = function (html, nomeArq, opts) {
    opts = opts || {};
    D.garantirRecursos();
    var host = D.host();
    host.innerHTML = html;
    var medida = (opts.umaPagina && opts.alvo) ? D.encaixa(host, opts.alvo, opts.piso) : null;
    document.body.classList.add('nx-print-doc');
    document.body.classList.toggle('nx-print-escuro', !!opts.escuro);
    D.tituloAntes = D.tituloAntes != null ? D.tituloAntes : document.title;
    document.title = nomeArq;
    return { host: host, medida: medida };
  };
  D.aguardarRecursos = function (host) {
    var imgs = Array.prototype.filter.call(host.querySelectorAll('img'), function (im) { return !im.complete; });
    var espera = imgs.length ? Promise.race([
      Promise.all(imgs.map(function (im) { return new Promise(function (res) { im.onload = im.onerror = res; }); })),
      new Promise(function (res) { setTimeout(res, 2500); })
    ]) : Promise.resolve();
    var fontes = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise(function (res) { setTimeout(res, 2500); })]) : Promise.resolve();
    return Promise.all([espera, fontes]);
  };
  D.restaurar = function () {
    if (D.tituloAntes != null) { document.title = D.tituloAntes; D.tituloAntes = null; }
    D.limparImpressao();
  };
  D.imprimir = function (html, nomeArq, opts) {
    var m = D.montar(html, nomeArq, opts);
    return D.aguardarRecursos(m.host).then(function () {
      window.addEventListener('afterprint', D.restaurar, { once: true });
      var t0 = Date.now();
      window.print();
      // Chrome de mesa trava no print() ate fechar a caixa: restaura na hora. Celular nao trava:
      // fica o afterprint, com um prazo de seguranca para nunca deixar o documento preso na tela.
      if (Date.now() - t0 > 400) D.restaurar(); else setTimeout(D.restaurar, 30000);
      return m;
    });
  };

  // Fluxo de cada saida: devolve {html, nomeArq, opts} para o gerar.js imprimir.
  D.render = function (saida, P) {
    var fn = { simulador: D.simulador, basico: D.basico, completo: D.completo }[saida];
    if (!fn) throw new Error('saida desconhecida: ' + saida);
    return fn(P);
  };
})();
