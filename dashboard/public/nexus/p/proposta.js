/* Portal do Parceiro NEXUS · pagina publica da proposta (/nexus/p/?t=<token>).
 *
 * O cliente final recebe o link do parceiro e ve o Orcamento Completo em modo tela, folha por folha.
 * Le ?t=, chama GET /_api/gerador/nexus/p/<token> e monta o MESMO documento do portal (calc.js,
 * docs-comum.js e docs-completo.js, por caminho absoluto), a partir do formulario salvo em dados.form.
 *
 * Sem dado interno: a rota publica so devolve a proposta, o parceiro (empresa, cidade, WhatsApp, logo) e o
 * catalogo. Sem pixel, sem cookie, sem login. Tudo que vem da API entra na tela por textContent ou por D.esc.
 */
(function () {
  'use strict';

  var API = '/_api/gerador/nexus/p/';
  var C = window.NexusCalc, D = window.NexusDocs;
  var $ = function (id) { return document.getElementById(id); };
  var estado = $('pp-estado'), deck = $('pp-deck'), barra = $('pp-barra'), rodape = $('pp-rodape');
  var folhas = [];        // {folha, esc, w, h}: cada folha A4 e o tamanho natural dela
  var documento = null;   // {html, nomeArq, opts}: o que a impressao usa

  // ===== Estados (tudo montado por DOM, sem innerHTML com dado de fora) =====
  function cartao(titulo, texto, opcoes) {
    opcoes = opcoes || {};
    estado.textContent = '';
    var c = document.createElement('div'); c.className = 'pp-cartao';
    if (opcoes.carregando) {
      var g = document.createElement('div'); g.className = 'pp-giro'; g.setAttribute('role', 'presentation'); c.appendChild(g);
    } else {
      var im = document.createElement('img'); im.src = '/gerador/nexus-logo-papel.png'; im.alt = 'NEXUS Eletropostos'; c.appendChild(im);
    }
    var h = document.createElement('h1'); h.textContent = titulo; c.appendChild(h);
    var p = document.createElement('p'); p.textContent = texto; c.appendChild(p);
    if (opcoes.tentar) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pp-btn prim'; b.textContent = 'Tentar de novo';
      b.addEventListener('click', carregar); c.appendChild(b);
    }
    estado.appendChild(c);
    estado.hidden = false; deck.hidden = true; barra.hidden = true; rodape.hidden = true;
    document.title = 'Proposta de eletroposto';
  }
  var carregando = function () { cartao('Carregando a proposta', 'Isso leva só um instante.', { carregando: true }); };
  var invalido = function () { cartao('Link inválido', 'Não encontramos esta proposta. Confira o link com quem enviou ou peça um link novo.'); };
  var indisponivel = function () { cartao('Proposta indisponível no momento', 'O serviço está fora do ar por um instante. Tente de novo em alguns minutos.', { tentar: true }); };
  var erro = function () { cartao('Não foi possível abrir a proposta', 'Verifique a conexão e tente de novo. Se continuar assim, peça um link novo a quem enviou.', { tentar: true }); };

  // ===== Dados da API -> o pacote que os documentos leem =====
  var texto = function (v) { return v == null ? '' : String(v); };
  var digitos = function (v) { return texto(v).replace(/\D/g, ''); };

  function montarForm(pr) {
    var dados = pr.dados && typeof pr.dados === 'object' ? pr.dados : {};
    var f = dados.form && typeof dados.form === 'object' ? dados.form : null;
    if (!f || !f.equip) return null;
    var form = Object.assign({ cliente: {}, equip: {}, itens: [], prem: {}, pg: {}, validade: { modo: 'sexta', dias: 2 } }, f);
    form.cliente = Object.assign({}, form.cliente);
    // O que a linha da proposta guarda cobre o formulario salvo sem esses campos.
    if (!texto(form.cliente.nome).trim()) form.cliente.nome = texto(pr.cliente_nome);
    if (!form.cliente.cidade) form.cliente.cidade = texto(pr.cliente_cidade);
    if (!form.cliente.uf) form.cliente.uf = texto(pr.cliente_uf);
    if (!form.cliente.tipo_local) form.cliente.tipo_local = texto(pr.tipo_local);
    if (!Array.isArray(form.itens)) form.itens = [];
    return form;
  }

  function montarDocumento(resp) {
    var pr = resp.proposta || {}, pa = resp.parceiro || {};
    var form = montarForm(pr);
    if (!form) throw new Error('proposta sem formulario');
    var ctx = {
      demo: false,
      empresa: { nome: texto(pa.empresa), cidade: [pa.cidade, pa.uf].filter(Boolean).join('/'), whatsapp: texto(pa.whatsapp), logo_base64: pa.logo_base64 || '' },
      parceiro: { empresa: texto(pa.empresa), cidade: texto(pa.cidade), uf: texto(pa.uf) },
      catalogo: resp.catalogo || {},
      entrega: resp.entrega || '',
      financiamento: resp.financiamento || {},
      libera: {}
    };
    // A data-base e' a da emissao (dados.emitida_em, gravada a cada geracao; created_at nas propostas antigas):
    // o cliente que abre o link depois nao ve "hoje" nem uma validade nova.
    var P = D.preparar(ctx, form, texto(pr.numero), { agora: (pr.dados && pr.dados.emitida_em) || pr.created_at });
    return { doc: D.completo(P), P: P, numero: texto(pr.numero), empresa: P.empresa.nome, whatsapp: digitos(pa.whatsapp) };
  }

  // ===== Folhas na tela: cada uma reduzida para caber na largura da janela =====
  function ajustar() {
    if (!folhas.length) return;
    var cs = getComputedStyle(deck);
    var disp = deck.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var f0 = folhas[0];
    var s = Math.min(1, disp / f0.w);
    if (!(s > 0)) s = 1;
    folhas.forEach(function (x) {
      x.folha.style.width = Math.floor(x.w * s) + 'px';
      x.folha.style.height = Math.floor(x.h * s) + 'px';
      x.esc.style.transform = 'scale(' + s.toFixed(5) + ')';
    });
  }
  var agendado = null;
  window.addEventListener('resize', function () { clearTimeout(agendado); agendado = setTimeout(ajustar, 60); });
  window.addEventListener('orientationchange', function () { setTimeout(ajustar, 200); });

  function mostrar(m) {
    documento = m.doc;
    deck.textContent = '';
    folhas = [];
    // O HTML do documento vem de D.completo, que escapa cada campo (D.esc). Aqui so se desmonta em folhas.
    var molde = document.createElement('div');
    molde.innerHTML = m.doc.html;
    var raiz = molde.querySelector('.nx-deck');
    var slides = raiz ? Array.prototype.slice.call(raiz.querySelectorAll(':scope > .nx-slide')) : [];
    if (!slides.length) throw new Error('documento vazio');
    slides.forEach(function (sl) {
      var folha = document.createElement('div'); folha.className = 'pp-folha';
      var esc = document.createElement('div'); esc.className = 'pp-esc';
      var deckHost = document.createElement('div'); deckHost.className = 'nx-deck';
      deckHost.appendChild(sl); esc.appendChild(deckHost); folha.appendChild(esc);
      deck.appendChild(folha);
    });
    estado.hidden = true; barra.hidden = false; deck.hidden = false; rodape.hidden = false;
    // Mede no tamanho natural (antes de reduzir) e so entao ajusta.
    Array.prototype.forEach.call(deck.querySelectorAll('.pp-folha'), function (folha) {
      var esc = folha.firstChild, sl = esc.querySelector('.nx-slide');
      folhas.push({ folha: folha, esc: esc, w: sl.offsetWidth || 794, h: sl.offsetHeight || 1123 });
    });
    ajustar();

    $('pp-num').textContent = m.numero ? 'Proposta nº ' + m.numero : 'Proposta de eletroposto';
    document.title = 'Proposta de eletroposto' + (m.empresa ? ' · ' + m.empresa : '');
    var zap = $('pp-zap');
    if (m.whatsapp.length >= 10) {
      var fone = m.whatsapp.length <= 11 ? '55' + m.whatsapp : m.whatsapp;
      var msg = 'Oi, tudo bem?\nVi a proposta de eletroposto' + (m.numero ? ' nº ' + m.numero : '') + ' e quero conversar.';
      zap.href = 'https://wa.me/' + fone + '?text=' + encodeURIComponent(msg);
      $('pp-zap-nome').textContent = 'Falar com ' + m.empresa;
      zap.title = 'Falar com ' + m.empresa;
      zap.hidden = false;
    } else {
      zap.hidden = true;
    }
  }

  // "Salvar em PDF": abre a impressao com o MESMO documento do portal (folhas A4 em pe, fundo escuro).
  var imprimindo = false;
  $('pp-pdf').addEventListener('click', function () {
    if (!documento || imprimindo) return;
    imprimindo = true;
    D.imprimir(documento.html, documento.nomeArq, documento.opts).catch(function () { /* sem impressao, a tela segue */ })
      .then(function () { imprimindo = false; });
  });

  // Ctrl+P ou "Imprimir" do menu do navegador/celular: sem passar pelo botao, imprimiria a tela reduzida. Aqui o
  // documento A4 e' montado antes da impressao e desmontado depois, igual ao botao.
  window.addEventListener('beforeprint', function () {
    if (!documento || imprimindo || document.body.classList.contains('nx-print-doc')) return;
    D.montar(documento.html, documento.nomeArq, documento.opts);
  });
  window.addEventListener('afterprint', function () { if (!imprimindo) D.restaurar(); });

  // ===== Carregar =====
  var token = (new URLSearchParams(location.search).get('t') || '').trim();
  var tokenOk = /^[A-Za-z0-9_-]{1,64}$/.test(token);

  function carregar() {
    if (!tokenOk) { invalido(); return; }
    carregando();
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var prazo = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    fetch(API + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        clearTimeout(prazo);
        if (r.status === 404) { invalido(); return null; }
        if (r.status === 503) { indisponivel(); return null; }
        if (!r.ok) { erro(); return null; }
        return r.json();
      })
      .then(function (resp) {
        if (!resp) return;
        if (!resp.proposta) { erro(); return; }
        mostrar(montarDocumento(resp));
      })
      .catch(function (e) {
        clearTimeout(prazo);
        if (window.console) console.warn('Proposta NEXUS', e && e.message);
        erro();
      });
  }

  if (!C || !D || !D.completo) { erro(); return; }
  D.garantirRecursos();
  carregar();
})();
