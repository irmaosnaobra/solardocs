/* Jornada da obra, fase 3 (06/11/2026): a etapa 9 (Pós-venda), o painel Mensagens em Ajustes, o Book em PDF e o link de indicação.
 * Script clássico, um IIFE. Pega os ajudantes de window.Jornada.h na hora da chamada e se registra em Jornada.etapas[9] e Jornada.extras.
 * Nenhuma mensagem sai daqui: as chaves em Ajustes só chamam a rota do servidor, que decide tudo (ordem, janela, anti-ban).
 * Cor só por var(--n-*) e var(--io-*), com a mesma reserva escura do jornada.js. Sem emoji, sem exclamação, sem travessão. */
(function () {
  'use strict';

  function H() { return window.Jornada.h; }
  function O() { return H().O(); }
  function el(t, c, x) { return H().el(t, c, x); }
  function add() { return H().add.apply(null, arguments); }
  function btn(t, c, f) { return H().btn(t, c, f); }
  function base() { return '/gerador/jornada-solar/obra/' + encodeURIComponent(O().card); }
  function ehAdm() { return typeof admOk === 'function' && admOk(); }

  var GRUPOS = [
    ['venda', 'Aviso de venda', 'Equipe'],
    ['etapa', 'É sua e Esperando', 'Dono da etapa e o Thiago'],
    ['fila', 'Fila das 08:00, escalada e placar', 'Equipe'],
    ['liberacao', 'Liberação com o Book', 'Cliente'],
    ['aniversario', 'Aniversários', 'Cliente'],
  ];
  var SITUACAO = {
    agendado: 'Agendado',
    sem_book: 'Sai quando o Book em PDF estiver pronto',
    sem_data: 'Sem data de nascimento na ficha',
    sem_telefone: 'Sem telefone no card',
    desligado: 'Desligado em Ajustes',
    nao_saiu: 'Não saiu',
    falhou: 'Não saiu: erro da linha',
  };
  var TIPO_AVISO = { sua: 'É sua', espera: 'Esperando', venda: 'Aviso de venda' };

  // ── Pequenos ajudantes ─────────────────────────────────────────────────────
  function msgSrv(r, padrao) {
    var j = r && r.json;
    if (j && typeof j.mensagem === 'string' && j.mensagem) return j.mensagem;
    if (r && r.status === 401) return 'Sua sessão terminou. Entre de novo no Gerador.';
    if (r && r.status === 0) return 'Sem conexão. Tente de novo.';
    if (j && typeof j.error === 'string' && /\s/.test(j.error)) return j.error;
    return padrao;
  }
  /** ISO em UTC para dd/mm e hh:mm de Brasília. */
  function quando(iso) {
    try {
      var f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      var o = {}; f.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
      if (!o.day) return { d: '', h: '' };
      return { d: o.day + '/' + o.month, h: o.hour + ':' + o.minute };
    } catch (e) { return { d: '', h: '' }; }
  }
  function dataBR(ymd) { var s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }
  function primeiro(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
  function bloco(titulo) { var b = el('div', 'jor-bloco'); b.appendChild(el('div', 'jor-bloco-t', titulo)); return b; }
  function f3Valido(f3) { return !!f3 && typeof f3 === 'object' && Array.isArray(f3.toques); }

  function injetarCss() {
    if (document.getElementById('jor-pos-css')) return;
    var css = [
      '.jor-pos-toque{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:4px 10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-toque:first-of-type{border-top:0}',
      '.jor-pos-n{font-weight:800;color:var(--n-tx2,#B4C0D2)}',
      '.jor-pos-rot{font-weight:700;overflow-wrap:anywhere}',
      '.jor-pos-sit{color:var(--n-tx2,#B4C0D2);font-size:13px;text-align:right}',
      '.jor-pos-sit.ok{color:var(--io-ok-tx,#4ADE80);font-weight:700}',
      '.jor-pos-sit.mau{color:var(--io-er-tx,#FCA5A5);font-weight:700}',
      '.jor-pos-ver{grid-column:2 / -1}',
      '.jor-pos-ver summary{cursor:pointer;color:var(--io-azul-tx,#93C5FD);font-size:13px}',
      '.jor-pos-ver pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;padding:8px 10px;border-radius:10px;border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);font:inherit;font-size:13px}',
      '.jor-pos-link{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;overflow-wrap:anywhere;word-break:break-all;padding:8px 10px;border-radius:10px;border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);margin:6px 0}',
      '.jor-pos-ind{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-ind:first-of-type{border-top:0}',
      '.jor-pos-grupo{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-pos-grupo:first-of-type{border-top:0}',
      '.jor-pos-grupo b{display:block}',
      '.jor-pos-grupo small{display:block;color:var(--n-tx2,#B4C0D2);font-size:12.5px}',
      '.jor-pos-grupo .jor-pos-sit{grid-column:1;text-align:left}',
      '.jor-pos-av{display:block;color:var(--n-tx2,#B4C0D2);font-size:13px;margin:2px 0}',
      '@media (max-width:760px){',
      '.jor-pos-toque{grid-template-columns:24px minmax(0,1fr)}',
      '.jor-pos-sit{grid-column:2;text-align:left}',
      '.jor-pos-grupo{grid-template-columns:minmax(0,1fr)}',
      '}',
    ].join('\n');
    var st = document.createElement('style'); st.id = 'jor-pos-css'; st.textContent = css; document.head.appendChild(st);
  }

  // ── Etapa 9 ────────────────────────────────────────────────────────────────
  function situacaoToque(t) {
    if (t.situacao === 'enviado') { var q = quando(t.enviado_em); return { txt: 'Enviado em ' + q.d + (q.h ? ' às ' + q.h : ''), cls: 'ok' }; }
    var cls = t.situacao === 'falhou' || t.situacao === 'nao_saiu' ? 'mau' : '';
    return { txt: SITUACAO[t.situacao] || 'Agendado', cls: cls };
  }
  function linhaToque(t, prim) {
    var rot = t.n === 1 ? 'Liberação' : t.n === 2 ? 'Aniversário de ' + prim : '1 ano da usina';
    var s = situacaoToque(t);
    var lin = el('div', 'jor-pos-toque');
    add(lin, el('span', 'jor-pos-n', t.n), el('span', 'jor-pos-rot', rot + (t.data ? ' · ' + dataBR(t.data) : '')), el('span', 'jor-pos-sit ' + s.cls, s.txt));
    if (t.texto) {
      var det = el('details', 'jor-pos-ver'); det.appendChild(el('summary', '', 'Ver a mensagem')); det.appendChild(el('pre', '', t.texto));
      lin.appendChild(det);
    }
    return lin;
  }

  function etapa9(esq, d, et, f3) {
    injetarCss(); var h = H();
    if (!f3Valido(f3)) {
      var pf = el('div', 'jor-bloco'); pf.appendChild(el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); pf.appendChild(btn('Tentar de novo', '', function () { h.recarregar(); }));
      esq.appendChild(pf); return;
    }
    var prim = primeiro(d.card && d.card.cliente);
    // 1. Régua do pós-venda
    var b1 = bloco('Régua do pós-venda');
    f3.toques.forEach(function (t) { b1.appendChild(linhaToque(t, prim)); });
    if (!f3.toques.length) b1.appendChild(el('p', 'jor-nota', 'Os toques aparecem quando a obra for finalizada.'));
    b1.appendChild(el('p', 'jor-nota', 'Os toques 2 e 3 se repetem todo ano. Saem das 9h às 20h, de segunda a sábado, e passam pelo anti-ban.'));
    esq.appendChild(b1);
    // 2. Book em PDF
    var b2 = bloco('Book em PDF'); var bk = f3.book;
    if (bk && bk.gerado_em) {
      var q = quando(bk.gerado_em);
      b2.appendChild(el('p', '', 'Gerado em ' + q.d + ' às ' + q.h + ' por ' + h.nomeBonito(bk.por) + '.'));
      b2.appendChild(btn('Baixar', 'jor-btn-pri', function () { baixarPdf(this); }));
    } else {
      b2.appendChild(el('p', '', 'Ainda não foi gerado.'));
      if (f3.pode && f3.pode.book) { var bg = btn('Gerar o Book em PDF', 'jor-btn-pri', function () { bookPdf(O().card, bg); }); b2.appendChild(bg); }
    }
    esq.appendChild(b2);
    // 3. Pedido de indicação
    if (f3.link) {
      var b3 = bloco('Pedido de indicação');
      b3.appendChild(el('p', '', 'Link de ' + prim + ':'));
      b3.appendChild(el('span', 'jor-pos-link', f3.link));
      b3.appendChild(btn('Copiar o link', '', function () { copiar(f3.link); }));
      b3.appendChild(el('p', 'jor-nota', 'Quem chega pelo link cai na Agenda da Nilce como Indicação de ' + prim + '.'));
      esq.appendChild(b3);
    }
    // 4. Indicações
    var b4 = bloco('Indicações de ' + prim); var inds = Array.isArray(f3.indicacoes) ? f3.indicacoes : [];
    inds.forEach(function (x) {
      var lin = el('div', 'jor-pos-ind'); var q2 = quando(x.em);
      lin.appendChild(el('span', '', q2.d + ' · ' + (x.cliente || 'Sem nome') + ' · '));
      if (x.situacao === 'vendida') {
        lin.appendChild(el('span', '', 'Virou venda'));
        lin.appendChild(el('span', 'jor-num', x.codigo || '*'));
        if (x.card) lin.appendChild(btn('Abrir', '', function () { if (window.Jornada && window.Jornada.abrirObra) window.Jornada.abrirObra(x.card); }));
      } else if (x.situacao === 'perdida') lin.appendChild(el('span', '', 'Não virou venda'));
      else lin.appendChild(el('span', '', 'Na agenda de ' + h.nomeBonito(x.vendedor || 'nilce')));
      b4.appendChild(lin);
    });
    if (!inds.length) b4.appendChild(el('p', 'jor-nota', 'Nenhuma indicação ainda.'));
    var pl = f3.placar || { indicacoes: 0, vendas: 0 }; var ge = f3.geral || {};
    b4.appendChild(el('p', 'jor-nota', prim + ': ' + h.plural(pl.indicacoes || 0, 'indicação', 'indicações') + ', ' + h.plural(pl.vendas || 0, 'venda', 'vendas') + ' por indicação.'));
    if (f3.geral) b4.appendChild(el('p', 'jor-nota', 'Geral: ' + h.plural(ge.na_regua || 0, 'cliente', 'clientes') + ' na régua, ' + h.plural(ge.indicacoes_mes || 0, 'indicação', 'indicações') + ' no mês, ' + ((ge.vendas_mes || 0) === 1 ? '1 virou venda' : (ge.vendas_mes || 0) + ' viraram venda') + '.'));
    esq.appendChild(b4);
    // 5. Prêmio
    var b5 = bloco('Prêmio de quem indica');
    b5.appendChild(el('p', 'jor-nota', 'O prêmio é digitado e entra como gasto, com comprovante, na obra nova, quando a indicação vira venda. Nunca entra nesta obra.'));
    esq.appendChild(b5);
    esq.appendChild(el('p', 'jor-nota', 'Saiu da lista ativa na liberação. Segue na aba Pós-venda de Clientes.'));
  }

  function copiar(link) {
    var h = H();
    function falhou() { h.toast('Não consegui copiar. Selecione o link e copie à mão.'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { h.toast('Link copiado.'); }, falhou);
      else falhou();
    } catch (e) { falhou(); }
  }
  function baixarPdf(botao) {
    var h = H(); if (botao) botao.disabled = true;
    h.api(base() + '/book/pdf', 'GET', undefined, 60000).then(function (r) {
      if (botao) botao.disabled = false;
      if (r.status === 200 && r.json && r.json.ok !== false && r.json.url) { abrirUrl(r.json.url); return; }
      h.toast(msgSrv(r, 'Não consegui abrir o Book agora. Tente de novo.'));
    });
  }
  function abrirUrl(url) {
    // Só abre endereço https: o que vier de outro jeito (javascript:, data:, http:) não passa.
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) { H().toast('Não deu para abrir o PDF.'); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (e) { H().toast('Não consegui abrir o PDF. Tente de novo.'); }
  }

  // ── O Book em PDF (feito no servidor) ──────────────────────────────────────
  function bookPdf(card, botao, opts) {
    var h = H(); opts = opts || {}; var silencioso = !!opts.silencioso;
    if (botao) botao.disabled = true;
    h.toast('Gerando o Book em PDF.');
    var rota = '/gerador/jornada-solar/obra/' + encodeURIComponent(card || O().card) + '/book/pdf';
    return h.api(rota, 'POST', {}, 120000).then(function (r) {
      if (botao) botao.disabled = false;
      var antiga = document.getElementById('jor-pos-trava'); if (antiga) antiga.remove();
      if (r.status === 200 && r.json && r.json.ok !== false) {
        h.toast('Book em PDF pronto.'); if (!silencioso && r.json.url) abrirUrl(r.json.url);
        h.recarregar();
        return;
      }
      if (r.status === 409 && r.json && Array.isArray(r.json.trava) && r.json.trava.length) {
        h.toast('O Book ainda não pode sair: ' + r.json.trava.join(' '));
        if (botao && botao.parentNode) {
          var ul = el('ul', 'jor-din-ul'); ul.id = 'jor-pos-trava'; r.json.trava.forEach(function (t) { ul.appendChild(el('li', '', t)); });
          botao.parentNode.insertBefore(ul, botao.nextSibling);
        }
        return;
      }
      h.toast(msgSrv(r, 'Não consegui gerar o Book agora. Tente de novo.'));
    });
  }

  // ── Etapa 2 da obra nova: veio por indicação ───────────────────────────────
  function indicacao(esq, d, f3) {
    if (!f3 || !f3.veio_de) return;
    injetarCss(); var h = H(); var v = f3.veio_de;
    var b = bloco('Veio por indicação');
    b.appendChild(el('p', '', 'Indicação de ' + (v.nome || 'cliente') + ' (' + (v.codigo || '*') + ').'));
    if (f3.premio && f3.premio.lancado) b.appendChild(el('p', 'jor-ok', 'Prêmio lançado, com comprovante.'));
    else if (f3.pode && f3.pode.premio) {
      b.appendChild(btn('Lançar o prêmio de quem indicou', 'jor-btn-pri', function () {
        if (window.Jornada.dinheiro && window.Jornada.dinheiro.lancar) window.Jornada.dinheiro.lancar({ tipo: 'saida', etapa: 2, categoria: 'premio_indicacao' });
      }));
    } else b.appendChild(el('p', 'jor-nota', 'Só a Giovanna e o Thiago lançam o prêmio.'));
    b.appendChild(el('p', 'jor-nota', 'Prêmio de quem indica: o valor é digitado na hora.'));
    esq.appendChild(b); void h;
  }

  // ── O cartão "Prazo e cobrança": avisos e o próximo ────────────────────────
  function avisos(pz, f3, n) {
    if (!f3Valido(f3) || !pz || n > 8) return;
    var lista = (Array.isArray(f3.avisos) ? f3.avisos : []).filter(function (a) { return a && (a.tipo === 'venda' ? n === 1 : a.etapa === n); }).slice(0, 5);
    lista.forEach(function (a) {
      var q = quando(a.em); var extra = a.situacao === 'falhou' ? ' · não saiu' : a.situacao === 'pendente' ? ' · pendente' : '';
      pz.appendChild(el('span', 'jor-pos-av', q.d + ' ' + q.h + ' · ' + (TIPO_AVISO[a.tipo] || a.tipo) + ' · ' + H().nomeBonito(a.para) + extra));
    });
    var gr = f3.grupos || {};
    var fim = f3.proximo || (gr.fila === false ? 'Mensagens desligadas em Ajustes.' : '');
    if (fim) pz.appendChild(el('p', 'jor-nota', fim));
  }

  // ── Etapa 8: a mensagem da liberação ───────────────────────────────────────
  function mensagemLiberacao(alvo, f3) {
    injetarCss();
    var t = f3Valido(f3) ? f3.toques.filter(function (x) { return x.n === 1; })[0] : null;
    if (!t) { alvo.appendChild(el('p', 'jor-nota', 'A mensagem sai quando a obra for finalizada e o Book em PDF estiver pronto, das 9h às 20h, de segunda a sábado.')); return; }
    alvo.appendChild(linhaToque(t, ''));
  }

  // ── Ajustes: o painel Mensagens (só o ADM) ─────────────────────────────────
  var MSG = { dados: null };
  function mensagens(alvo) {
    if (!ehAdm() || !alvo) return;
    injetarCss(); var h = H();
    var b = bloco('Mensagens'); alvo.appendChild(b);
    function pintar() {
      var corpo = b.querySelector('.jor-pos-corpo'); if (corpo) corpo.remove();
      corpo = el('div', 'jor-pos-corpo'); b.appendChild(corpo);
      var d = MSG.dados;
      if (!d || !d.grupos || typeof d.grupos !== 'object') { corpo.appendChild(el('p', 'jor-nota', 'Não consegui ler as mensagens agora.')); return; }
      GRUPOS.forEach(function (g) {
        var s = d.grupos[g[0]] || {}; var lin = el('div', 'jor-pos-grupo');
        var t = el('div'); t.appendChild(el('b', '', g[1])); t.appendChild(el('small', '', 'Quem recebe: ' + g[2])); lin.appendChild(t);
        var bt = btn(s.ligado ? 'Desligar' : 'Ligar', s.ligado ? '' : 'jor-btn-pri', function () { confirmar(g, !s.ligado, pintar); });
        bt.setAttribute('aria-label', (s.ligado ? 'Desligar ' : 'Ligar ') + g[1]); lin.appendChild(bt);
        var sit;
        if (s.ligado) { var q = quando(s.ligado_em); sit = 'Ligado desde ' + q.d + ' às ' + q.h + (s.por ? ' por ' + h.nomeBonito(s.por) : '') + '. ' + h.plural(s.enviadas_24h || 0, 'enviada', 'enviadas') + ' em 24 h.'; }
        else sit = 'Desligado.';
        lin.appendChild(el('span', 'jor-pos-sit ' + (s.ligado ? 'ok' : ''), sit));
        corpo.appendChild(lin);
      });
      corpo.appendChild(el('p', 'jor-nota', 'As do cliente ligam um dia depois das da equipe.'));
      if (d.desligado_na_vercel) corpo.appendChild(el('p', 'jor-aviso', 'Todas estão desligadas na Vercel (JORNADA_MSG_OFF).'));
      if (d.valida === false) corpo.appendChild(el('p', 'jor-aviso', 'As chaves estão sem assinatura válida. Todas valem como desligadas.'));
    }
    if (MSG.dados) pintar(); else b.appendChild(el('p', 'jor-nota jor-pos-corpo', 'Carregando…'));
    h.api('/gerador/jornada-solar/mensagens', 'GET').then(function (r) {
      if (r.status === 200 && r.json && r.json.grupos) MSG.dados = r.json; else if (!MSG.dados) MSG.dados = null;
      if (b.isConnected !== false) pintar();
    });
  }
  function confirmar(g, ligar, depois) {
    var h = H();
    h.dialogo((ligar ? 'Ligar ' : 'Desligar ') + g[1] + '?', function (c) {
      c.appendChild(el('p', '', ligar ? 'Só o que for gravado a partir de agora dispara.' : 'As mensagens deste grupo param na próxima rodada.'));
      var info = el('p', 'jor-erro'); info.setAttribute('role', 'status'); c.appendChild(info);
      return {};
    }, ligar ? 'Ligar' : 'Desligar', function (b, c) {
      var info = c.querySelector('.jor-erro'); b.disabled = true; info.textContent = '';
      h.api('/gerador/jornada-solar/mensagens', 'PUT', { grupo: g[0], ligado: ligar }).then(function (r) {
        if (r.status === 200 && r.json && r.json.ok !== false) {
          if (r.json.grupos) MSG.dados = r.json;
          h.fecharDlg(); h.toast(ligar ? 'Ligado.' : 'Desligado.'); depois(); return;
        }
        b.disabled = false; info.textContent = msgSrv(r, 'Não consegui agora. Tente de novo.');
      });
    });
  }

  window.Jornada.etapas[9] = etapa9;
  window.Jornada.extras.indicacao = indicacao;
  window.Jornada.extras.mensagens = mensagens;
  window.Jornada.extras.avisos = avisos;
  window.Jornada.extras.bookPdf = bookPdf;
  window.Jornada.extras.mensagemLiberacao = mensagemLiberacao;
})();
