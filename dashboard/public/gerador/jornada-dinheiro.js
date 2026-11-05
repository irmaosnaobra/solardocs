/* Jornada da obra, fase 2 (06/11/2026): o dinheiro da obra solar. A faixa, o livro, o lançar gasto, as comissões e os Ajustes.
 * 05/11/2026 (regra do dono): gasto, comissão e retirada podem ser lançados SEM comprovante (a linha fica "Sem comprovante" e pendente) e o
 * comprovante se anexa depois; a IA lê de todo jeito e nunca barra; recebimento continua exigindo comprovante.
 * Script clássico, um IIFE. Pega os ajudantes de window.Jornada.h na hora da chamada e registra window.Jornada.dinheiro.
 * Todo número em reais vem pronto do servidor (livro, fechamento). Aqui só se desenha: nada de sobra, margem ou saldo calculado no navegador.
 * Cor só por var(--n-*) e var(--io-*), com a mesma reserva escura do jornada.js. Sem emoji, sem exclamação, sem travessão. */
(function () {
  'use strict';

  var S = { filtro: 'todas' };
  function H() { return window.Jornada && window.Jornada.h; }
  function O() { return H().O(); }

  var FORMAS = [['pix', 'Pix'], ['transferencia', 'TED'], ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'], ['financiamento', 'Financiamento'], ['outro', 'Outro']];
  var CATS = [
    ['entrada', 'entrada', 'Entrada'], ['entrada', 'parcela', 'Parcela'], ['entrada', 'financiamento', 'Financiamento liberado'], ['entrada', 'a_vista', 'Pagamento à vista'], ['entrada', 'outros', 'Outra entrada'],
    ['saida', 'art', 'ART'], ['saida', 'projeto_eletrico', 'Projeto elétrico (engenheiro)'], ['saida', 'taxa_distribuidora', 'Taxa da distribuidora'], ['saida', 'equipamento', 'Equipamento (kit)'],
    ['saida', 'material', 'Material'], ['saida', 'material_extra', 'Material extra'], ['saida', 'frete', 'Frete'], ['saida', 'mao_de_obra', 'Mão de obra'], ['saida', 'combustivel', 'Combustível'],
    ['saida', 'alimentacao', 'Alimentação da equipe'], ['saida', 'cartorio', 'Cartório'], ['saida', 'imposto', 'Imposto'], ['saida', 'outros', 'Outros'],
  ];
  var GRUPOS = [['comissao_venda', 'Comissão de venda'], ['homologacao', 'Homologação (ART e projeto)'], ['material', 'Material'], ['frete', 'Frete'], ['mao_de_obra', 'Mão de obra'], ['outros', 'Outros']];
  var REGRAS = [
    'Gasto, comissão e retirada podem ser lançados sem comprovante. A linha fica "Sem comprovante" e pendente até anexar. Recebimento só entra com comprovante.',
    'A IA lê o comprovante (tipo, valor, data, quem pagou, quem recebeu, ID do Pix) e nunca barra o lançamento. Valor lido diferente do digitado: você escolhe qual vale e a linha fica "Divergente" para o Thiago conferir.',
    'Comprovante repetido é recusado, mesmo em outra obra. Nota fiscal também: a chave de 44 dígitos impede a mesma nota duas vezes.',
    'Lançamento não se apaga. Errou, faz estorno com motivo. Os dois ficam no histórico.',
    'A receber e a pagar são cobrados até zerar. A obra só fecha com os dois em zero e sem linha sem comprovante.',
    'O Thiago pode fechar uma linha sem comprovante, com motivo registrado. Sem isso, o fechamento espera o anexo.',
    'Fechada, a conta trava. Só o Thiago reabre, com motivo registrado.',
    'A faixa e o livro do dinheiro da obra são abertos a todos que veem a obra. Só o Thiago vê a sobra, a margem, a comissão dos sócios e o que fica na empresa.',
    'A IA lê PDF, foto e print da nota, do comprovante ou do pedido, e só sugere. Quem lança confere.',
  ];

  // ── Pequenos ajudantes ─────────────────────────────────────────────────────
  function pct(n) { return String(n).replace('.', ',') + '%'; }
  function msgSrv(r, padrao) {
    var j = r && r.json;
    if (j && typeof j.mensagem === 'string' && j.mensagem) return j.mensagem;
    if (r && r.status === 401) return 'Sua sessão terminou. Entre de novo no Gerador.';
    if (r && r.status === 0) return 'Sem conexão. Tente de novo.';
    if (j && typeof j.error === 'string' && /\s/.test(j.error)) return j.error;
    return padrao;
  }
  function codSrv(r) { return (r && r.json && typeof r.json.error === 'string') ? r.json.error : ''; }
  function txtCents(c) { return (Math.round(Number(c) || 0) / 100).toFixed(2).replace('.', ','); }
  function novoId() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (e) { /* cai no manual */ }
    var h = '0123456789abcdef'; var s = '';
    for (var i = 0; i < 36; i++) { s += (i === 8 || i === 13 || i === 18 || i === 23) ? '-' : (i === 14 ? '4' : h.charAt(Math.floor(Math.random() * 16))); }
    return s;
  }
  function ondeTxt(onde) {
    var o = String(onde || '');
    if (/^#/.test(o)) return 'na obra ' + o;
    if (o === 'esta obra') return 'nesta obra';
    if (o === 'um card do eletroposto') return 'num card do eletroposto';
    return o ? 'em ' + o : 'em outra obra';
  }
  function porEtapa(livro, n) {
    var pe = livro && livro.por_etapa; if (!pe) return 0;
    if (Array.isArray(pe)) return Number(pe.length >= 10 ? pe[n] : pe[n - 1]) || 0;
    return Number(pe[n]) || 0;
  }
  function eAdm() { return typeof admOk === 'function' && admOk(); }
  function nomeEtapa(n) {
    var d = O().dados; var e = d && d.etapas && d.etapas[n - 1];
    return e ? e.nome : '';
  }

  var TIPOS_LIDOS = { pix: 'Pix', ted: 'TED', boleto: 'Boleto', cartao: 'Cartão', dinheiro: 'Dinheiro', recibo: 'Recibo', nota_fiscal: 'Nota fiscal', cupom: 'Cupom' };
  var FORMA_DO_TIPO = { pix: 'pix', ted: 'transferencia', boleto: 'boleto', cartao: 'cartao', dinheiro: 'dinheiro' };
  var MSG_HEIC = 'Tire um print ou mande a foto em JPG.';
  /** O texto de um erro de arquivo (as rejeições de `prepararArquivo`). */
  function msgArquivo(e) {
    var m = e && e.message;
    if (m === 'grande') return 'O arquivo passa de 10 MB.';
    if (m === 'heic') return MSG_HEIC;
    return 'Não consegui ler o arquivo. Tente de novo.';
  }
  /** O que a IA entendeu do comprovante, numa linha só para a pessoa conferir. */
  function resumoDaIa(s) {
    var h = H(); if (!s) return '';
    var p = [];
    var tipo = TIPOS_LIDOS[s.tipo] || '';
    if (tipo || s.valor_centavos) p.push('A IA leu' + (tipo ? ' ' + tipo : '') + (s.valor_centavos ? ' de ' + h.reais(s.valor_centavos) : '') + (s.data ? ' em ' + h.ddmm(s.data) : '') + '.');
    if (s.pagador) p.push('Pagou: ' + s.pagador + (s.pagador_documento ? ' (' + s.pagador_documento + ')' : '') + '.');
    if (s.recebedor) p.push('Recebeu: ' + s.recebedor + (s.recebedor_documento ? ' (' + s.recebedor_documento + ')' : '') + '.');
    return p.join(' ');
  }

  function injetarCss() {
    if (document.getElementById('jor-din-css')) return;
    var css = [
      // As 4 fichas do desenho: o número de 20 px em cima (Inter, tabular-nums), o rótulo embaixo; saldo negativo em vermelho pelo token.
      '.jor-din-faixa{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;border:1px solid var(--n-bd,#334155);background:var(--n-sf,#1E293B);border-radius:12px;box-shadow:var(--sombra,none);padding:16px 24px;margin:0 0 16px}',
      '.jor-din-c{display:flex;flex-direction:column-reverse;justify-content:center;gap:2px;min-width:0;box-sizing:border-box;border:1px solid var(--n-bd,#334155);border-radius:12px;padding:10px 12px;text-align:center}',
      '.jor-din-c small{color:var(--n-tx2,#B4C0D1);font-size:12px;font-weight:500}',
      '.jor-din-c b{font-size:20px;font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums;color:var(--io-titulo,#F1F5F9);overflow-wrap:anywhere}',
      '.jor-din-c.neg{border-color:var(--io-er-bd,rgba(248,113,113,.4))}',
      '.jor-din-c.neg b{color:var(--io-er-tx,#FCA5A5)}',
      '.jor-din-ret{grid-column:1/-1;color:var(--n-tx2,#B4C0D1);font-size:13px;margin:0}',
      '.jor-din-oculto{border:1px solid var(--n-bd,#334155);background:var(--n-sf2,#182338);color:var(--n-tx2,#B4C0D2);border-radius:12px;padding:10px 14px;margin:0 0 12px}',
      '.jor-din-lin{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px 0;border-top:1px solid var(--n-bd,#334155)}',
      '.jor-din-lin:first-of-type{border-top:0}',
      '.jor-din-lin b{font-weight:700;overflow-wrap:anywhere}',
      '.jor-din-lin .jor-din-v{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}',
      '.jor-din-lin .jor-din-m{grid-column:1/-1;color:var(--n-tx2,#B4C0D2);font-size:12.5px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}',
      '.jor-din-lin.jor-din-risc b,.jor-din-lin.jor-din-risc .jor-din-v{text-decoration:line-through;color:var(--n-tx3,#94A3B8)}',
      '.jor-din-chip{display:inline-block;text-decoration:none;border-radius:999px;padding:1px 9px;font-size:11.5px;font-weight:800;background:var(--n-sf2,#182338);color:var(--n-tx2,#B4C0D2);border:1px solid var(--n-bd,#334155)}',
      '.jor-din-chip.ok{background:var(--io-ok-sf,rgba(74,222,128,.14));color:var(--io-ok-tx,#4ADE80);border-color:var(--io-ok-tx,#4ADE80)}',
      '.jor-din-chip.av{background:var(--io-av-sf,rgba(251,191,36,.1));color:var(--io-av-tx,#FCD34D);border-color:var(--io-av-tx,#FCD34D)}',
      '.jor-din-chip.er{background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-tx,#FCA5A5);border-color:var(--io-er-tx,#FCA5A5)}',
      '.jor-din-sub{font-weight:800;color:var(--n-tx2,#B4C0D2);margin:10px 0 2px;font-size:12.5px}',
      '.jor-din-tot{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--n-bd,#334155);padding:10px 12px;margin-top:4px;font-weight:600;background:var(--n-sf2,#182338);border-radius:0 0 10px 10px;font-variant-numeric:tabular-nums}',
      '.jor-din-acoes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.jor-din-tab td.v,.jor-din-tab th.v{text-align:right;font-variant-numeric:tabular-nums}',
      '.jor-din-tab tr.risc td{text-decoration:line-through;color:var(--n-tx3,#94A3B8)}',
      '.jor-din-ok{color:var(--io-ok-tx,#4ADE80);font-weight:700}',
      '.jor-din-er{color:var(--io-er-tx,#FCA5A5);font-weight:700}',
      '.jor-din-pc{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}',
      '.jor-din-pc label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-din-ul{margin:6px 0 0;padding-left:18px;color:var(--n-tx2,#B4C0D2)}',
      '.jor-din-dlg{width:min(520px,100%)!important}',
      '.jor-din-anx{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.jor-din-anx .jor-btn{display:inline-flex;align-items:center}',
      '@media (max-width:760px){',
      '.jor-din-faixa{grid-template-columns:repeat(2,minmax(0,1fr))}',
      '.jor-dlg:has(>div.jor-din-dlg){padding:0}',
      '.jor-dlg>div.jor-din-dlg{width:100%!important;height:100%;max-height:100%;border-radius:0}',
      '.jor-din-tab thead{display:none}',
      '.jor-din-tab,.jor-din-tab tbody,.jor-din-tab tr,.jor-din-tab td{display:block;width:100%}',
      '.jor-din-tab tr{border-bottom:1px solid var(--n-bd,#334155);padding:8px 0}',
      '.jor-din-tab td{border:0;padding:2px 0;white-space:normal;text-align:left!important}',
      '.jor-din-tab td[data-r]::before{content:attr(data-r) ": ";color:var(--n-tx3,#94A3B8);font-size:12px}',
      '}',
    ].join('\n');
    var st = document.createElement('style'); st.id = 'jor-din-css'; st.textContent = (H().comReserva ? H().comReserva(css) : css); document.head.appendChild(st);
  }

  // ── A faixa ────────────────────────────────────────────────────────────────
  function erroParte(raiz) {
    var h = H();
    var b = h.el('div', 'jor-bloco'); b.appendChild(h.el('p', 'jor-erro', 'Não consegui ler esta parte agora.'));
    b.appendChild(h.btn('Tentar de novo', '', function () { h.recarregar(); }));
    raiz.appendChild(b);
  }
  function celula(rot, valor, neg) {
    var h = H(); var c = h.el('div', 'jor-din-c' + (neg ? ' neg' : ''));
    c.appendChild(h.el('small', '', rot)); c.appendChild(document.createTextNode(' ')); c.appendChild(h.el('b', '', valor));
    return c;
  }
  function faixa(raiz, din) {
    injetarCss(); var h = H();
    if (!din) { if (O().dinErro) erroParte(raiz); return; }
    if (din.visivel === false) { raiz.appendChild(h.el('p', 'jor-din-oculto', 'O dinheiro desta obra fica com o Thiago e a Giovanna.')); return; }
    var l = din.livro; if (!l) return;
    var f = h.el('div', 'jor-din-faixa'); f.setAttribute('aria-label', 'Dinheiro da obra');
    f.appendChild(celula('Recebido', h.rs(l.recebido)));
    f.appendChild(celula('A receber', l.a_receber === null || l.a_receber === undefined ? 'Sem valor de venda' : h.rs(l.a_receber)));
    f.appendChild(celula('Gasto', h.rs(l.gasto)));
    f.appendChild(celula('Saldo', h.rs(l.saldo), l.saldo < 0));
    if (h.atual() >= 2 && l.retirada !== undefined && l.retirada !== null && Number(l.retirada) > 0) f.appendChild(h.el('p', 'jor-din-ret', 'Já tirada a comissão dos sócios: ' + h.rs(l.retirada)));
    raiz.appendChild(f);
  }
  /** O gasto embaixo de cada passo da régua: feita, o da etapa; da vez, o de agora; futura, "A vir". */
  function gastoDaRegua(din, n, atual) {
    if (!din || din.visivel === false || !din.livro || n > 9) return '';
    if (n > atual) return 'A vir';
    if (n === 9) return '';
    return H().rs(porEtapa(din.livro, n));
  }

  // ── Gastos da etapa ────────────────────────────────────────────────────────
  function linhaDe(l, din, depois) {
    var h = H();
    var r = h.el('div', 'jor-din-lin' + (l.estornada ? ' jor-din-risc' : ''));
    var neg = !!l.estorno_de;
    r.appendChild(h.el('b', '', (l.descricao || l.rotulo || l.categoria || 'Lançamento') + (l.contraparte && l.descricao && l.descricao.indexOf(l.contraparte) < 0 ? ' · ' + l.contraparte : '')));
    r.appendChild(h.el('span', 'jor-din-v', (neg ? '-' : '') + h.reais(l.valor_centavos)));
    var m = h.el('div', 'jor-din-m');
    m.appendChild(h.el('span', '', [h.ddmm(l.data), h.nomeBonito(l.criado_por), formaTxt(l.forma)].filter(Boolean).join(' · ')));
    if (l.comprovante && l.comprovante.url) {
      var a = h.el('a', 'jor-din-chip ok', 'Comprovante'); a.href = l.comprovante.url; a.target = '_blank'; a.rel = 'noopener'; a.insertBefore(h.icone('ok'), a.firstChild); m.appendChild(a);
    } else if (l.comprovante) { var c0 = h.el('span', 'jor-din-chip ok', 'Comprovante'); c0.insertBefore(h.icone('ok'), c0.firstChild); m.appendChild(c0); }
    chipsConferencia(m, l, din);
    if (neg) m.appendChild(h.el('span', 'jor-din-chip', 'Estorno'));
    if (l.estornada) m.appendChild(h.el('span', 'jor-din-er', 'Estornado em ' + h.ddmm(String(l.estornada.em).slice(0, 10)) + ' por ' + h.nomeBonito(l.estornada.por) + ': ' + l.estornada.motivo));
    var ids = (din && din.pode && din.pode.estornar_ids) || [];
    if (!l.estornada && !neg && ids.indexOf(l.id) >= 0) {
      m.appendChild(h.btn('Estornar', 'jor-btn-link', function () { estornarDialogo(l, depois); }));
    }
    r.appendChild(m);
    return r;
  }
  /**
   * A etiqueta da linha: Conferido, Sem comprovante, Não conferido ou Divergente. Mais os botões: Conferi (só o ADM), Anexar comprovante
   * (quem pode anexar) e Fechar sem comprovante (só o ADM). Cor só pelas classes ok, av e er, que usam os tokens dos dois visuais.
   */
  function chipsConferencia(m, l, din) {
    var h = H();
    var c = l.conferencia;
    var pode = (din && din.pode) || {};
    var morta = !!(l.estornada || l.estorno_de);
    if (c === 'bateu') m.appendChild(h.el('span', 'jor-din-chip ok', 'Conferido'));
    if (c === 'conferido_adm') m.appendChild(h.el('span', 'jor-din-chip ok', 'Conferido pelo Thiago'));
    if (c === 'divergente_adm') m.appendChild(h.el('span', 'jor-din-chip av', 'Valor liberado pelo Thiago'));
    if (c === 'sem_leitura' || c === 'baixa_confianca' || c === 'divergente') {
      m.appendChild(h.el('span', 'jor-din-chip ' + (c === 'divergente' ? 'er' : 'av'), c === 'divergente' ? 'Divergente' : 'Não conferido'));
      if (c === 'divergente' && l.divergencia) m.appendChild(h.el('span', '', 'A IA leu ' + h.reais(l.divergencia.lido_centavos) + '. Você digitou ' + h.reais(l.divergencia.digitado_centavos) + '.'));
      if (l.nota_ia) m.appendChild(h.el('span', '', l.nota_ia + '.'));
      if (!morta) {
        if (eAdm() && !pode.fechada) {
          m.appendChild(h.btn('Conferi', 'jor-btn-link', function () {
            h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/conferir', 'POST', { id: l.id }, 30000).then(function (r) {
              if (r.status === 200 && r.json.ok !== false) { h.toast('Lançamento conferido.'); h.recarregar(); } else h.toast(msgSrv(r, 'Não consegui marcar agora.'));
            });
          }));
        } else m.appendChild(h.el('span', 'jor-din-chip er', 'Falta conferir'));
      }
    }
    if (c === 'estorno' && l.divergencia) m.appendChild(h.el('span', '', 'A IA leu ' + h.reais(l.divergencia.lido_centavos) + ' no comprovante da devolução.'));
    if (c === 'sem_comprovante') {
      m.appendChild(h.el('span', 'jor-din-chip ' + (l.dispensa ? 'ok' : 'av'), 'Sem comprovante'));
      if (l.dispensa) m.appendChild(h.el('span', '', 'Liberado pelo ' + h.nomeBonito(l.dispensa.por) + '. Motivo: ' + l.dispensa.motivo));
    }
    if (!l.comprovante && !morta && (pode.anexar_ids || []).indexOf(l.id) >= 0) {
      m.appendChild(h.btn('Anexar comprovante', 'jor-btn-link', function () { anexarDialogo(l); }));
    }
    if (l.sem_comprovante && (pode.dispensar_ids || []).indexOf(l.id) >= 0) {
      m.appendChild(h.btn('Fechar sem comprovante', 'jor-btn-link', function () { dispensarDialogo(l); }));
    }
  }
  function formaTxt(f) { var x = FORMAS.filter(function (y) { return y[0] === f; })[0]; return x ? x[1] : (f ? String(f) : ''); }

  /** "Fechar sem comprovante": só o ADM, com motivo de 3 a 300 caracteres. A linha deixa de travar o fechamento e a mudança fica assinada. */
  function dispensarDialogo(l) {
    var h = H();
    h.dialogoMotivo('Fechar sem comprovante', 'Fechar sem comprovante', function (motivo) {
      return h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/dispensar', 'POST', { id: l.id, motivo: motivo }, 30000).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { h.toast('A linha foi liberada sem comprovante.'); h.recarregar(); return { ok: true }; }
        return { ok: false, erro: msgSrv(r, 'Não consegui liberar agora.') };
      });
    });
  }

  /** "Anexar comprovante" numa saída que ficou sem ele: sobe, a IA lê, e o servidor prende o arquivo à linha (sem estorno). */
  function anexarDialogo(l) {
    injetarCss(); var h = H();
    var est = { arq: null, sug: null, ler: '', enviando: false, salvando: false, travado: false, erro: '', aviso: '', dup: null, confirmarDup: false };
    var refs = {}; var ctl = {};
    function refresh() {
      if (!ctl.salvar) return;
      ctl.salvar.disabled = !est.arq || est.enviando || est.salvando || est.travado;
      refs.estado.textContent = est.enviando ? 'Lendo o comprovante…' : (est.arq ? 'Anexado: ' + est.arq.nome : 'Escolha o comprovante.');
      refs.estado.className = 'jor-est' + (est.arq && !est.enviando ? ' ok' : '');
      refs.leu.textContent = est.sug ? resumoDaIa(est.sug) : '';
      refs.erro.textContent = est.erro || '';
      refs.aviso.textContent = est.aviso || '';
      refs.extra.replaceChildren();
      if (est.dup) {
        var ul = h.el('ul', 'jor-din-ul');
        (est.dup.lista || []).forEach(function (d) { ul.appendChild(h.el('li', '', d.valor_centavos ? h.reais(d.valor_centavos) + ' · ' + h.ddmm(d.data) + (d.onde ? ' · ' + d.onde : '') : String(d.onde || 'outra obra'))); });
        refs.extra.appendChild(ul);
        refs.extra.appendChild(h.btn('Anexar assim mesmo', '', function () { est.confirmarDup = true; enviar(); }));
      }
    }
    function aoAnexar(file) {
      est.erro = ''; est.aviso = ''; est.travado = false; est.dup = null; est.enviando = true; est.arq = null; est.sug = null; est.ler = ''; refresh();
      prepararArquivo(file).then(function (a) {
        return h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/comprovante', 'POST', { base64: a.base64, media_type: a.media_type, nome: a.nome, ler: true, doc: 'comprovante', tipo: 'saida' }, 90000);
      }).then(function (r) {
        est.enviando = false;
        if (r.status === 200 && r.json.ok !== false && r.json.arquivo) {
          est.arq = r.json.arquivo; est.ler = r.json.leitura || ''; est.sug = r.json.sugestao || null;
          if (r.json.repetido) { est.travado = true; est.erro = 'Este comprovante já foi lançado ' + ondeTxt(r.json.repetido.onde) + '.'; }
          else if (est.ler === 'nao_e_comprovante') est.aviso = 'A IA não reconheceu como comprovante. Você pode anexar, e o Thiago confere.';
          else if (est.sug && est.sug.valor_centavos && (est.sug.confianca === 'alta' || est.sug.confianca === 'media') && est.sug.valor_centavos !== l.valor_centavos) {
            est.aviso = 'A IA leu ' + h.reais(est.sug.valor_centavos) + '. O lançamento tem ' + h.reais(l.valor_centavos) + '. A linha fica para o Thiago conferir.';
          } else if (est.ler && est.ler !== 'ok') est.aviso = 'A leitura não funcionou. A linha fica para o Thiago conferir.';
        } else { est.erro = msgSrv(r, 'Não consegui enviar o comprovante. Tente de novo.'); }
        refresh();
      }, function (e) { est.enviando = false; est.erro = msgArquivo(e); refresh(); });
    }
    function enviar() {
      if (!est.arq || est.salvando || est.enviando || est.travado) return;
      est.salvando = true; est.erro = ''; refresh();
      var corpo = { id: l.id, arquivo_path: est.arq.path };
      if (est.confirmarDup) corpo.confirmar_duplicado = true;
      h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/anexar', 'POST', corpo, 60000).then(function (r) {
        est.salvando = false; est.confirmarDup = false;
        if (r.status === 200 && r.json.ok !== false) { h.fecharDlg(); h.toast('Comprovante anexado.'); h.recarregar(); return; }
        var cod = codSrv(r);
        if (cod === 'comprovante_repetido') { est.travado = true; est.erro = msgSrv(r, 'Este comprovante já foi lançado em outra obra.'); }
        else if (cod === 'possivel_duplicado') { est.dup = { lista: r.json.duplicados || [] }; est.aviso = 'Parece que este comprovante já foi usado.'; }
        else est.erro = msgSrv(r, 'Não consegui anexar agora. Tente de novo.');
        refresh();
      });
    }
    var api2 = h.dialogo('Anexar comprovante', function (c) {
      c.classList.add('jor-din-dlg'); ctl.caixa = c;
      c.appendChild(h.el('p', '', (l.descricao || l.rotulo || 'Lançamento') + ' · ' + h.reais(l.valor_centavos) + ' · ' + h.ddmm(l.data)));
      var bl = h.el('div'); bl.appendChild(h.el('b', '', 'Comprovante'));
      bl.appendChild(botoesAnexo('comprovante', aoAnexar));
      refs.estado = h.el('p', 'jor-est'); refs.estado.setAttribute('role', 'status'); bl.appendChild(refs.estado);
      c.appendChild(bl);
      refs.leu = h.el('p', 'jor-nota'); refs.erro = h.el('p', 'jor-erro'); refs.erro.setAttribute('role', 'alert'); refs.aviso = h.el('p', 'jor-aviso'); refs.aviso.setAttribute('role', 'status'); refs.extra = h.el('div', 'jor-din-acoes');
      h.add(c, refs.leu, refs.erro, refs.aviso, refs.extra, h.el('p', 'jor-nota', 'Comprovante repetido é recusado.'));
      return { foco: null };
    }, 'Anexar', function (b) { void b; enviar(); });
    ctl.salvar = api2.salvar; refresh();
  }

  function estornarDialogo(l, depois) {
    var h = H();
    h.dialogoMotivo('Estornar o lançamento', 'Estornar', function (motivo) {
      return h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/estorno', 'POST', { id_original: l.id, motivo: motivo }, 30000).then(function (r) {
        if (r.status === 200 && r.json.ok !== false) { h.toast('Estorno feito. As duas linhas ficam no livro.'); h.recarregar(); if (depois) depois(); return { ok: true }; }
        return { ok: false, erro: msgSrv(r, 'Não consegui estornar agora.') };
      });
    });
  }

  function gastosDaEtapa(alvo, n, din) {
    injetarCss(); var h = H();
    var b = h.el('div', 'jor-bloco'); var tit = h.el('div', 'jor-bloco-t', 'Gastos desta etapa'); b.appendChild(tit);
    if (!din || din.visivel === false || !din.livro) { return; }
    var linhas = (din.livro.linhas || []).filter(function (l) { return Number(l.etapa) === n; });
    var custo = linhas.filter(function (l) { return l.grupo === 'custo'; });
    var ret = linhas.filter(function (l) { return l.grupo === 'retirada'; });
    var ent = linhas.filter(function (l) { return l.grupo === 'entrada'; });
    if (!custo.length) b.appendChild(h.el('p', 'jor-nota', 'Nenhum gasto nesta etapa.'));
    custo.forEach(function (l) { b.appendChild(linhaDe(l, din)); });
    var tot = h.el('div', 'jor-din-tot'); tot.appendChild(h.el('span', '', 'Total da etapa')); tot.appendChild(h.el('span', 'jor-din-v', h.rs(porEtapa(din.livro, n)))); b.appendChild(tot);
    if (n === 2 && ent.length) { b.appendChild(h.el('div', 'jor-din-sub', 'Recebimentos')); ent.forEach(function (l) { b.appendChild(linhaDe(l, din)); }); }
    var veRet = din.livro.retirada !== undefined && din.livro.retirada !== null;   // a retirada só vem para o ADM e para a Giovanna
    if (n === 2 && ret.length && veRet) { b.appendChild(h.el('div', 'jor-din-sub', 'Retirada dos sócios, fora do custo')); ret.forEach(function (l) { b.appendChild(linhaDe(l, din)); }); }
    var p = din.pode || {};
    var ac = h.el('div', 'jor-din-acoes');
    if (p.lancar_saida) tit.appendChild(h.btn('Lançar gasto', 'jor-btn-pri', function () { lancar({ tipo: 'saida', etapa: n }); }));
    if (n === 2 && p.lancar_entrada) ac.appendChild(h.btn('Lançar recebimento', 'jor-btn-pri', function () { lancar({ tipo: 'entrada', etapa: n }); }));
    if (ac.childNodes.length) b.appendChild(ac);
    alvo.appendChild(b);
  }

  // ── Lançar (gasto, recebimento ou pagamento de comissão) ───────────────────
  function categoriasDe(din, tipo) {
    var srv = (din && Array.isArray(din.categorias)) ? din.categorias : [];
    var lista = srv.filter(function (c) { return c.quem !== 'rota' && c.grupo !== 'retirada'; }).map(function (c) { return [c.tipo === 'entrada' ? 'entrada' : 'saida', c.slug || c.id || c.chave, c.rotulo || c.nome || c.rot || c.slug]; }).filter(function (c) { return c[1]; });
    if (!lista.length) lista = CATS;
    return lista.filter(function (c) { return c[0] === tipo && c[1] !== 'comissao_venda' && c[1] !== 'retirada_socio'; });
  }
  function lerArquivo(file) {
    return new Promise(function (ok, falha) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); ok(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { falha(new Error('leitura')); };
      fr.readAsDataURL(file);
    });
  }
  var LADO_MAX = 2000;
  function ehHeic(file) { return /hei[cf]/i.test(String(file.type || '')) || /\.(heic|heif)$/i.test(String(file.name || '')); }
  function abrirImagem(file) {
    return new Promise(function (ok, falha) {
      var url = URL.createObjectURL(file); var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); falha(new Error('abrir')); };
      im.src = url;
    });
  }
  /**
   * Foto e print: no máximo 2000 px no lado maior, em JPEG. HEIC e HEIF (foto do iPhone) e GIF viram JPEG por canvas quando o navegador
   * consegue abrir; HEIC que o navegador não abre pede "Tire um print ou mande a foto em JPG". JPEG, PNG e WEBP que já são leves e
   * pequenos seguem como vieram (recomprimir só tira nitidez). O `dossieReduzirImagem` do index.html corta em 1600 px e deixa o HEIC passar, por isso não serve aqui.
   */
  function reduzirImagem(file) {
    var tipo = String(file.type || '').toLowerCase();
    var heic = ehHeic(file);
    var gif = tipo === 'image/gif' || /\.gif$/i.test(String(file.name || ''));
    return abrirImagem(file).then(function (im) {
      var w = im.naturalWidth || im.width; var hh = im.naturalHeight || im.height;
      if (!w || !hh) throw new Error(heic ? 'heic' : 'abrir');
      var escala = Math.min(1, LADO_MAX / Math.max(w, hh));
      if (!heic && !gif && escala === 1 && file.size <= 1500000 && /^image\/(jpeg|png|webp)$/.test(tipo)) return file;
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * escala)); cv.height = Math.max(1, Math.round(hh * escala));
      var cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
      return new Promise(function (ok, falha) {
        cv.toBlob(function (b) {
          if (!b) { falha(new Error(heic ? 'heic' : 'abrir')); return; }
          ok(new File([b], (String(file.name || 'foto').replace(/\.\w+$/, '') || 'foto') + '.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.86);
      });
    }, function () {
      if (heic) throw new Error('heic');
      return file;   // o navegador não abriu: sobe como veio e o servidor diz se aceita
    });
  }
  function prepararArquivo(file) {
    var tipo = String(file.type || '').toLowerCase();
    var nomeArq = String(file.name || '');
    var img = /^image\//.test(tipo) || ehHeic(file) || (!tipo && /\.(jpe?g|png|webp|gif)$/i.test(nomeArq));
    var xml = /\.xml$/i.test(nomeArq) || /(^|[\/+])xml$/.test(tipo);
    var pronto = img ? reduzirImagem(file) : Promise.resolve(file);
    return pronto.then(function (f) {
      if (!f || !f.size) return Promise.reject(new Error('vazio'));
      if (f.size > 10 * 1024 * 1024) return Promise.reject(new Error('grande'));
      return lerArquivo(f).then(function (b64) { return { base64: b64, media_type: xml ? 'application/xml' : String(f.type || tipo || 'application/octet-stream'), nome: String(f.name || nomeArq || (img ? 'comprovante.jpg' : (xml ? 'nota.xml' : 'comprovante.pdf'))).slice(0, 120) }; });
    });
  }

  /** Os três botões do Anexo (Foto, Arquivo, Print). Cada um entrega o arquivo a `aoEscolher`. */
  function botoesAnexo(rotulo, aoEscolher, multiplo, opcoes) {
    var h = H(); var caixa = h.el('div', 'jor-din-anx');
    function entrada(rot, aceita, camera) {
      var lab = h.el('label', 'jor-btn', rot);
      var inp = h.el('input'); inp.type = 'file'; inp.accept = aceita; inp.style.display = 'none'; if (camera) inp.setAttribute('capture', 'environment'); if (multiplo && !camera) inp.multiple = true;
      inp.setAttribute('aria-label', rot + ': ' + rotulo);
      inp.addEventListener('change', function () { var fs = Array.prototype.slice.call(inp.files || []); inp.value = ''; if (fs.length) aoEscolher(multiplo ? fs : fs[0]); });
      lab.appendChild(inp); lab.tabIndex = 0;
      return lab;
    }
    h.add(caixa, entrada('Foto', 'image/*', true), entrada('Arquivo', 'image/*,application/pdf' + (opcoes && opcoes.xml ? ',.xml,text/xml,application/xml' : ''), false), entrada('Print', 'image/*', false));
    return caixa;
  }

  /** o = { tipo, etapa, categoria?, compra_id?, carga_id?, valor_sugerido?, descricao?, contraparte?, depois?, comissao?: { nome, papel, pb, valor_centavos, rotulo } } */
  function lancar(o) {
    injetarCss(); o = o || {};
    var h = H(); var din = O().dinheiro; if (!din || !din.livro) return;
    var com = o.comissao || null;
    var tipo = o.tipo === 'entrada' ? 'entrada' : 'saida';
    var etapa = com ? 2 : (Number(o.etapa) || h.atual() || 1);
    var cats = categoriasDe(din, tipo);
    var est = { arq: null, sug: null, ler: '', enviando: false, salvando: false, travado: false, erro: '', aviso: '', id: novoId(), tocado: {}, auto: {}, escolha: null, dup: null, confirmarDup: false, salvou: false };
    var ctl = {}; var refs = {};
    var adm = eAdm();

    function campo(rot, ctrl, chave) {
      var l = h.el('label', '', rot);
      var tag = h.el('span', 'jor-auto', 'Automático'); tag.hidden = true; tag.setAttribute('data-auto', chave || '');
      l.appendChild(tag); l.appendChild(ctrl); refs[chave] = tag;
      return l;
    }
    function marcarAuto(chave, ativa) { if (refs[chave]) refs[chave].hidden = !ativa; }
    function valorCent() { var v = h.cents(refs.valor_in.value); return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0; }

    /** Só o recebimento exige o arquivo. Gasto, comissão e retirada salvam sem ele e ficam pendentes ("Sem comprovante"). */
    function podeSalvar() {
      if (est.enviando || est.salvando || est.travado) return false;
      if (tipo === 'entrada' && !est.arq) return false;
      if (!valorCent() || !refs.data_in.value) return false;
      if (!com && refs.cat_in.value === 'outros' && !refs.desc_in.value.trim()) return false;
      return true;
    }
    function refresh() {
      if (!ctl.salvar) return;
      ctl.salvar.disabled = !podeSalvar();
      var frase = est.arq || est.enviando ? '' : (tipo === 'saida' ? 'Sem comprovante. Fica pendente até anexar.' : 'Sem comprovante, o recebimento não entra.');
      refs.frase.textContent = frase;
      refs.frase.className = tipo === 'saida' ? 'jor-aviso' : 'jor-erro';
      refs.erro.textContent = est.erro || '';
      refs.aviso.textContent = est.aviso || '';
      refs.leu.textContent = est.sug ? resumoDaIa(est.sug) : '';
      refs.estado.textContent = est.enviando ? 'Lendo o comprovante…' : (est.arq ? 'Anexado: ' + est.arq.nome : (tipo === 'saida' ? 'Sem comprovante.' : 'Falta o comprovante.'));
      refs.estado.className = 'jor-est' + (est.arq && !est.enviando ? ' ok' : '');
      refs.extra.replaceChildren();
      if (est.escolha) {
        // A IA leu um valor e a pessoa digitou outro: ela escolhe qual vale antes de salvar. Nos dois casos a linha fica para o ADM conferir.
        var e1 = est.escolha;
        refs.extra.appendChild(h.el('p', 'jor-aviso', 'A IA leu ' + h.reais(e1.lido) + '. Você digitou ' + h.reais(e1.digitado) + '. Qual vale?'));
        refs.extra.appendChild(h.btn('Vale ' + h.reais(e1.lido) + ' (lido)', '', function () { enviar({ valor: e1.lido, digitado: e1.digitado }); }));
        refs.extra.appendChild(h.btn('Vale ' + h.reais(e1.digitado) + ' (digitado)', '', function () { enviar({ valor: e1.digitado, digitado: e1.digitado }); }));
        refs.extra.appendChild(h.el('p', 'jor-nota', adm ? 'A sua escolha já vale como conferência.' : 'Nos dois casos, a linha fica para o Thiago conferir.'));
      }
      if (est.dup) {
        var ul = h.el('ul', 'jor-din-ul');
        (est.dup.lista || []).forEach(function (d) { ul.appendChild(h.el('li', '', d.valor_centavos ? h.reais(d.valor_centavos) + ' · ' + h.ddmm(d.data) + (d.onde ? ' · ' + d.onde : '') : String(d.onde || 'outra obra'))); });
        refs.extra.appendChild(ul);
        refs.extra.appendChild(h.btn('Salvar assim mesmo', '', function () { est.confirmarDup = true; enviar(); }));
      }
    }

    function aoAnexar(file) {
      est.erro = ''; est.aviso = ''; est.travado = false; est.escolha = null; est.dup = null; est.enviando = true; est.arq = null; est.sug = null; est.ler = ''; refresh();
      prepararArquivo(file).then(function (a) {
        return h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/comprovante', 'POST', { base64: a.base64, media_type: a.media_type, nome: a.nome, ler: true, doc: 'comprovante', tipo: tipo }, 90000);
      }).then(function (r) {
        est.enviando = false;
        if (r.status === 200 && r.json.ok !== false && r.json.arquivo) {
          est.arq = r.json.arquivo; est.ler = r.json.leitura || ''; est.sug = r.json.sugestao || null;
          if (r.json.repetido) { est.travado = true; est.erro = 'Este comprovante já foi lançado ' + ondeTxt(r.json.repetido.onde) + '.'; }
          else if (est.ler === 'nao_e_comprovante') { est.aviso = 'A IA não reconheceu como comprovante. Você pode salvar assim, e o Thiago confere.'; }
          else if (est.sug) { preencher(est.sug); }
          else if (est.ler && est.ler !== 'ok') { est.aviso = 'A leitura não funcionou. Confira os campos à mão, e o Thiago confere.'; }
        } else { est.erro = codSrv(r) === 'heic_nao_suportado' ? MSG_HEIC : msgSrv(r, 'Não consegui enviar o comprovante. Tente de novo.'); }
        refresh();
      }, function (e) {
        est.enviando = false; est.erro = msgArquivo(e); refresh();
      });
    }
    function preencher(s) {
      if (s.valor_centavos && !com && !est.tocado.valor) { refs.valor_in.value = txtCents(s.valor_centavos); marcarAuto('valor', true); }
      if (s.data && !est.tocado.data) { refs.data_in.value = s.data; marcarAuto('data', true); }
      var forma = s.forma || FORMA_DO_TIPO[s.tipo] || '';
      if (forma && !est.tocado.forma && FORMAS.some(function (f) { return f[0] === forma; })) { refs.forma_in.value = forma; marcarAuto('forma', true); }
      if (s.recebedor && !est.tocado.contraparte && !com) { refs.contra_in.value = String(s.recebedor).slice(0, 80); marcarAuto('contraparte', true); }
      if (s.descricao && !est.tocado.descricao && !com && !refs.desc_in.value.trim()) { refs.desc_in.value = String(s.descricao).slice(0, 160); marcarAuto('descricao', true); }
      if (s.categoria_sugerida && !est.tocado.categoria && !com && !o.categoria && cats.some(function (ct) { return ct[1] === s.categoria_sugerida; })) { refs.cat_in.value = s.categoria_sugerida; marcarAuto('categoria', true); }
    }

    /** `esc` = { valor, digitado }: a escolha da pessoa quando a IA leu um valor diferente do digitado. */
    function enviar(esc) {
      if (!podeSalvar()) return;
      var sug = est.sug;
      if (!esc && !com && est.arq && est.ler === 'ok' && sug && sug.valor_centavos && (sug.confianca === 'alta' || sug.confianca === 'media') && sug.valor_centavos !== valorCent()) {
        est.escolha = { lido: sug.valor_centavos, digitado: valorCent() }; refresh(); return;
      }
      est.salvando = true; est.erro = ''; refresh();
      var base = '/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/';
      var corpo, rota;
      if (com) {
        rota = 'comissao';
        corpo = { id: est.id, nome: com.nome, papel: com.papel, data: refs.data_in.value, forma: refs.forma_in.value };
        if (est.arq) corpo.arquivo_path = est.arq.path;
      } else {
        rota = 'lancamento';
        corpo = { id: est.id, tipo: tipo, categoria: refs.cat_in.value, etapa: etapa, valor_centavos: esc ? esc.valor : valorCent(), data: refs.data_in.value, forma: refs.forma_in.value,
          descricao: refs.desc_in.value.trim(), contraparte: refs.contra_in.value.trim() };
        if (est.arq) corpo.arquivo_path = est.arq.path;
        if (esc) { corpo.valor_digitado_centavos = esc.digitado; if (adm) corpo.confirmar_valor = true; }
        if (o.compra_id) corpo.compra_id = o.compra_id;
        if (o.carga_id) corpo.carga_id = o.carga_id;
      }
      if (est.confirmarDup) corpo.confirmar_duplicado = true;
      h.api(base + rota, 'POST', corpo, 60000).then(function (r) {
        est.salvando = false;
        if (r.status === 200 && r.json.ok !== false) {
          if (r.json.livro) din.livro = r.json.livro;
          est.salvou = true; est.id = novoId(); est.escolha = null;
          concluido(r.json.lancamento || null);
          return;
        }
        var cod = codSrv(r);
        est.confirmarDup = false; est.escolha = null;
        if (cod === 'comprovante_repetido') { est.travado = true; est.erro = msgSrv(r, 'Este comprovante já foi lançado em outra obra.'); }
        else if (cod === 'possivel_duplicado') { est.dup = { lista: r.json.duplicados || [] }; est.aviso = 'Parece que já existe um lançamento igual.'; }
        else if (cod === 'comprovante_obrigatorio') { est.erro = msgSrv(r, 'O recebimento só entra com comprovante.'); }
        else if (r.status === 409 && r.json && r.json.mudou) { est.erro = msgSrv(r, 'Outra pessoa mexeu agora. Feche e abra de novo.'); }
        else { est.erro = msgSrv(r, 'Não consegui salvar agora. Tente de novo.'); }
        refresh();
      });
    }

    function concluido(lan) {
      var c = ctl.caixa; c.replaceChildren();
      c.appendChild(h.el('h3', '', com ? 'Pagamento lançado.' : (tipo === 'entrada' ? 'Recebimento lançado.' : 'Gasto lançado.')));
      var conf = lan && lan.conferencia;
      if (conf === 'sem_comprovante') c.appendChild(h.el('p', 'jor-aviso', 'Sem comprovante. Fica pendente até anexar. Use Anexar comprovante na linha.'));
      else c.appendChild(h.el('p', 'jor-ok', 'O comprovante e o livro já estão atualizados.'));
      if (conf === 'divergente') c.appendChild(h.el('p', 'jor-aviso', 'O valor ficou diferente do comprovante. O Thiago confere.'));
      else if (conf === 'sem_leitura' || conf === 'baixa_confianca') c.appendChild(h.el('p', 'jor-nota', 'A IA não conseguiu conferir o valor. O Thiago confere.'));
      var bt = h.el('div', 'jor-dlg-bt');
      if (!com) h.add(bt, h.btn(tipo === 'entrada' ? 'Lançar outro' : 'Lançar outro', '', function () { h.fecharDlg(); lancar({ tipo: tipo, etapa: etapa, categoria: o.categoria, compra_id: o.compra_id, carga_id: o.carga_id }); }));
      h.add(bt, h.btn('Voltar à etapa', 'jor-btn-pri', function () { h.fecharDlg(); h.recarregar(); if (o.depois) o.depois(); }));
      c.appendChild(bt);
    }

    var api2 = h.dialogo(com ? 'Pagar comissão' : (tipo === 'entrada' ? 'Lançar recebimento' : 'Lançar gasto'), function (c) {
      c.classList.add('jor-din-dlg'); ctl.caixa = c;
      var et = h.el('p', 'jor-nota'); et.appendChild(document.createTextNode('Etapa ' + etapa + ' · ' + nomeEtapa(etapa) + ' '));
      et.appendChild(h.el('span', 'jor-din-chip', 'Já marcada')); c.appendChild(et);
      if (com) c.appendChild(h.el('p', '', (com.rotulo || (h.nomeBonito(com.nome) + ' · ' + (com.papel === 'venda' ? 'venda' : 'sócio'))) + ' · ' + h.rs(com.valor_centavos)));
      // 1. Anexo
      var bl = h.el('div'); bl.appendChild(h.el('b', '', 'Comprovante'));
      bl.appendChild(botoesAnexo('comprovante', aoAnexar));
      refs.estado = h.el('p', 'jor-est'); refs.estado.setAttribute('role', 'status'); bl.appendChild(refs.estado);
      refs.leu = h.el('p', 'jor-nota'); bl.appendChild(refs.leu);
      c.appendChild(bl);
      // 2. Campos
      var g = h.el('div', 'jor-din-pc');
      refs.valor_in = h.el('input', 'jor-in'); refs.valor_in.type = 'text'; refs.valor_in.inputMode = 'decimal'; refs.valor_in.setAttribute('aria-label', 'Valor');
      if (com) { refs.valor_in.value = txtCents(com.valor_centavos); refs.valor_in.readOnly = true; } else if (o.valor_sugerido) refs.valor_in.value = txtCents(o.valor_sugerido);
      refs.data_in = h.el('input', 'jor-in'); refs.data_in.type = 'date'; refs.data_in.setAttribute('aria-label', 'Data'); refs.data_in.value = (O().dados && O().dados.hoje) || '';
      refs.contra_in = h.el('input', 'jor-in'); refs.contra_in.type = 'text'; refs.contra_in.maxLength = 80; refs.contra_in.setAttribute('aria-label', 'Fornecedor'); refs.contra_in.value = com ? h.nomeBonito(com.nome) : (o.contraparte || '');
      refs.forma_in = h.el('select', 'jor-sel'); refs.forma_in.setAttribute('aria-label', 'Forma');
      FORMAS.forEach(function (f) { var op = h.el('option', '', f[1]); op.value = f[0]; refs.forma_in.appendChild(op); });
      refs.cat_in = h.el('select', 'jor-sel'); refs.cat_in.setAttribute('aria-label', 'Categoria');
      cats.forEach(function (ct) { var op = h.el('option', '', ct[2]); op.value = ct[1]; refs.cat_in.appendChild(op); });
      if (o.categoria) refs.cat_in.value = o.categoria;
      refs.desc_in = h.el('input', 'jor-in'); refs.desc_in.type = 'text'; refs.desc_in.maxLength = 160; refs.desc_in.setAttribute('aria-label', 'Descrição'); refs.desc_in.value = o.descricao || '';
      h.add(g, campo('Valor', refs.valor_in, 'valor'), campo('Data', refs.data_in, 'data'));
      if (!com) h.add(g, campo('Fornecedor', refs.contra_in, 'contraparte'));
      g.appendChild(campo('Forma', refs.forma_in, 'forma'));
      if (!com) h.add(g, campo('Categoria', refs.cat_in, 'categoria'), campo('Descrição', refs.desc_in, 'descricao'));
      c.appendChild(g);
      [['valor', refs.valor_in], ['data', refs.data_in], ['forma', refs.forma_in], ['contraparte', refs.contra_in]].forEach(function (p) {
        p[1].addEventListener('input', function () { est.tocado[p[0]] = true; marcarAuto(p[0], false); if (p[0] === 'valor' && est.escolha) { est.escolha = null; est.erro = ''; } refresh(); });
        p[1].addEventListener('change', function () { est.tocado[p[0]] = true; marcarAuto(p[0], false); refresh(); });
      });
      [['categoria', refs.cat_in], ['descricao', refs.desc_in]].forEach(function (p) {
        p[1].addEventListener('input', function () { est.tocado[p[0]] = true; marcarAuto(p[0], false); refresh(); });
        p[1].addEventListener('change', function () { est.tocado[p[0]] = true; marcarAuto(p[0], false); refresh(); });
      });
      // 3. Mensagens
      refs.frase = h.el('p', 'jor-aviso'); refs.erro = h.el('p', 'jor-erro'); refs.erro.setAttribute('role', 'alert'); refs.aviso = h.el('p', 'jor-aviso'); refs.extra = h.el('div', 'jor-din-acoes');
      refs.aviso.setAttribute('role', 'status');
      h.add(c, refs.frase, refs.erro, refs.aviso, refs.extra, h.el('p', 'jor-nota', 'Comprovante repetido é recusado.'));
      return { foco: null };
    }, 'Salvar', function (b) { void b; enviar(); });
    ctl.salvar = api2.salvar; refresh();
  }

  // ── Comissões da etapa 2 ───────────────────────────────────────────────────
  /** livro.comissoes é { vendedor, aviso, congelada, liberadas, linhas }. */
  function comissoesDe(livro) {
    var c = livro && livro.comissoes;
    if (Array.isArray(c)) return { linhas: c, liberadas: !!livro.liberadas, aviso: null };
    return c && Array.isArray(c.linhas) ? c : { linhas: [], liberadas: false, aviso: null };
  }
  function blocoComissoes(alvo, d, din) {
    injetarCss(); var h = H();
    var b = h.el('div', 'jor-bloco'); b.appendChild(h.el('div', 'jor-bloco-t', 'Comissões'));
    var livro = din && din.visivel !== false ? din.livro : null;
    var cm = comissoesDe(livro);
    var regra = livro && cm.linhas.length ? cm.linhas : (d.comissoes || []);
    if (regra.length) {
      b.appendChild(h.el('p', '', 'Vendeu: ' + h.nomeBonito(d.card.vendedor)));
      var algumaSem = false;
      regra.forEach(function (x) {
        var lin = h.el('div', 'jor-din-lin');
        lin.appendChild(h.el('b', '', h.nomeBonito(x.nome) + ' · ' + (x.papel === 'venda' ? 'venda' : 'sócio') + ' ' + pct(x.pb / 100) + ' · ' + h.rs(x.valor_centavos) + ' · ' + (x.onde === 'custo' ? 'custo da obra' : 'retirada')));
        var m = h.el('div', 'jor-din-m');
        var jaPaga = Number(x.pago_centavos) > 0;
        var dif = Number(x.diferenca_centavos) || 0;
        if (x.pago) {
          m.appendChild(h.el('span', 'jor-din-chip ok', 'Paga em ' + h.ddmm(x.pago.data)));
          var ln = livro && (livro.linhas || []).filter(function (l) { return l.id === x.pago.id; })[0];
          if (ln && ln.comprovante && ln.comprovante.url) { var a = h.el('a', 'jor-din-chip ok', 'Comprovante'); a.href = ln.comprovante.url; a.target = '_blank'; a.rel = 'noopener'; m.appendChild(a); }
        }
        if (jaPaga && dif < 0) m.appendChild(h.el('span', 'jor-din-chip er', 'A devolver ' + h.rs(-dif)));
        if (jaPaga && dif > 0) m.appendChild(h.el('span', 'jor-din-chip av', 'Faltam ' + h.rs(dif)));
        if ((!jaPaga || dif > 0) && livro && din.pode && din.pode.comissao && cm.liberadas) {
          m.appendChild(h.btn('Pagar', '', function () { lancar({ tipo: 'saida', comissao: { nome: x.nome, papel: x.papel, pb: x.pb, valor_centavos: jaPaga ? dif : x.valor_centavos } }); }));
        } else if (!jaPaga && livro) { algumaSem = true; }
        if (m.childNodes.length) lin.appendChild(m);
        b.appendChild(lin);
      });
      if (livro && !cm.liberadas && algumaSem) b.appendChild(h.el('p', 'jor-nota', 'Libera depois que a entrada entrar.'));
      if (cm.aviso || d.comissoes_aviso) b.appendChild(h.el('p', 'jor-aviso', cm.aviso || d.comissoes_aviso));
      var rg = h.el('div', 'jor-din-sub', 'A regra das comissões'); b.appendChild(rg);
      var tb = h.el('table', 'jor-tbl');
      regra.forEach(function (x) { var tr = h.el('tr'); [h.nomeBonito(x.nome), x.papel === 'venda' ? 'Venda' : 'Sócio', pct(x.pb / 100)].forEach(function (t) { tr.appendChild(h.el('td', '', t)); }); tb.appendChild(tr); });
      b.appendChild(tb);
    }
    if (!livro && O().dinErro) { b.appendChild(h.el('p', 'jor-erro', 'Não consegui ler esta parte agora.')); b.appendChild(h.btn('Tentar de novo', '', function () { h.recarregar(); })); }
    b.appendChild(h.el('p', 'jor-nota', 'A parte de quem vendeu entra no custo da obra. Os 2% de cada sócio ficam à parte.'));
    b.appendChild(h.el('p', 'jor-nota', 'Comissão não paga não trava a obra: fica em A pagar.'));
    alvo.appendChild(b);
  }

  // ── Fechamento (usado no livro e na etapa 8) ───────────────────────────────
  function fechamento(alvo, din) {
    injetarCss(); var h = H();
    var l = din && din.livro; var f = l && l.fechamento; if (!f) return;
    var b = h.el('div', 'jor-bloco'); b.appendChild(h.el('div', 'jor-bloco-t', 'Fechamento da obra'));
    function lin(rot, val, cls) { var r = h.el('div', 'jor-din-tot'); r.appendChild(h.el('span', '', rot)); r.appendChild(h.el('span', 'jor-din-v' + (cls ? ' ' + cls : ''), val)); b.appendChild(r); }
    lin('A receber', f.a_receber === null || f.a_receber === undefined ? 'Sem valor de venda' : h.rs(f.a_receber));
    lin('A pagar', h.rs(f.a_pagar_total) + (f.pendencias ? ' · ' + h.plural(f.pendencias, 'pendência', 'pendências') : ''));
    if (Array.isArray(l.a_pagar) && l.a_pagar.length) { var ul = h.el('ul', 'jor-din-ul'); l.a_pagar.forEach(function (p) { ul.appendChild(h.el('li', '', (p.devolver ? 'A devolver: ' : '') + p.texto)); }); b.appendChild(ul); }
    if (f.comprovantes) lin('Comprovantes', f.comprovantes.com + ' de ' + f.comprovantes.total);
    lin('Custo', h.rs(f.custo));
    if (f.previsto !== null && f.previsto !== undefined) {
      var dif = Number(f.diferenca) || 0;
      lin('Previsto', h.rs(f.previsto) + ' · ' + (dif >= 0 ? 'ficou ' + h.rs(dif) + ' abaixo' : 'passou ' + h.rs(-dif)));
    } else lin('Previsto', 'Sem previsto');
    if (Array.isArray(f.faltam) && f.faltam.length) {
      b.appendChild(h.el('div', 'jor-din-sub', 'Falta para fechar'));
      var u2 = h.el('ul', 'jor-din-ul'); f.faltam.forEach(function (t) { u2.appendChild(h.el('li', '', t)); }); b.appendChild(u2);
    } else if (f.pode_fechar) b.appendChild(h.el('p', 'jor-din-ok', 'A conta está zerada e pode fechar.'));
    if (f.adm) {
      var sb = h.el('div', 'jor-bloco'); sb.appendChild(h.el('div', 'jor-bloco-t', 'Só o Thiago vê'));
      var a2 = f.adm;
      var semV = a2.sobra === null || a2.sobra === undefined;
      var r1 = h.el('div', 'jor-din-tot'); r1.appendChild(h.el('span', '', 'Sobra da obra')); r1.appendChild(h.el('span', 'jor-din-v', semV ? 'Sem valor de venda' : h.rs(a2.sobra) + ' (' + pct(a2.sobra_pct) + ')')); sb.appendChild(r1);
      var r2 = h.el('div', 'jor-din-tot'); r2.appendChild(h.el('span', '', 'Comissão dos sócios')); r2.appendChild(h.el('span', 'jor-din-v', h.rs(a2.retirada))); sb.appendChild(r2);
      var r3 = h.el('div', 'jor-din-tot'); r3.appendChild(h.el('span', '', 'Fica na empresa')); r3.appendChild(h.el('span', 'jor-din-v', semV || a2.fica === null ? 'Sem valor de venda' : h.rs(a2.fica) + ' (' + pct(a2.fica_pct) + ')')); sb.appendChild(r3);
      b.appendChild(sb);
    }
    alvo.appendChild(b);
  }

  // ── O livro ────────────────────────────────────────────────────────────────
  function gruposDoPrevisto(p) {
    if (!p) return [];
    var src = p.grupos || p;
    return GRUPOS.map(function (g) {
      var x = Array.isArray(src) ? src.filter(function (y) { return (y.grupo || y.id || y.slug) === g[0]; })[0] : src[g[0]];
      return x ? { id: g[0], rot: g[1], previsto: x.previsto, real: x.real, diferenca: x.diferenca } : null;
    }).filter(Boolean);
  }
  function abrirLivro() {
    injetarCss(); var h = H(); var ob = O(); var din = ob.dinheiro; var n = ob.obraNo;
    if (!n || !din || din.visivel === false || !din.livro) return;
    var l = din.livro; var d = ob.dados;
    var raiz = h.el('div');
    var topo = h.el('div', 'jor-topo'); topo.appendChild(h.el('h2', '', 'Dinheiro da obra ' + (d.codigo || '*')));
    topo.appendChild(h.btn('Voltar à obra', '', function () { h.desenhar(); }));
    raiz.appendChild(topo);
    raiz.appendChild(h.el('p', 'jor-nota', d.card.cliente));
    faixa(raiz, din);
    var fil = h.el('div', 'jor-filtros'); fil.setAttribute('aria-label', 'Filtrar por etapa');
    [['todas', 'Todas']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (x) { return [String(x), String(x)]; })).forEach(function (f) {
      var b = h.el('button', 'jor-chip' + (S.filtro === f[0] ? ' on' : ''), f[1]); b.type = 'button';
      b.addEventListener('click', function () { S.filtro = f[0]; abrirLivro(); });
      fil.appendChild(b);
    });
    raiz.appendChild(fil);
    var linhas = (l.linhas || []).filter(function (x) { return S.filtro === 'todas' || String(x.etapa) === S.filtro; });
    function grupo(titulo, g) {
      var ls = linhas.filter(function (x) { return x.grupo === g; });
      var bl = h.el('div', 'jor-bloco'); bl.appendChild(h.el('div', 'jor-bloco-t', titulo));
      if (!ls.length) { bl.appendChild(h.el('p', 'jor-nota', 'Nenhuma linha.')); raiz.appendChild(bl); return; }
      var tb = h.el('table', 'jor-tbl jor-din-tab'); var th = h.el('tr');
      ['Data', 'Etapa', 'Descrição', 'Lançou', 'Forma', 'Valor', 'Prova'].forEach(function (t) { th.appendChild(h.el('th', t === 'Valor' ? 'v' : '', t)); });
      tb.appendChild(h.add(h.el('thead'), th));
      var body = h.el('tbody'); var soma = 0;
      ls.forEach(function (x) {
        var neg = !!x.estorno_de; var v = Number(x.valor_centavos) || 0; if (!x.estornada) soma += neg ? -v : v; else soma += neg ? -v : v;
        var tr = h.el('tr', x.estornada ? 'risc' : '');
        function td(rot, t, cls) { var c = h.el('td', cls || '', t); c.setAttribute('data-r', rot); tr.appendChild(c); return c; }
        td('Data', h.ddmm(x.data)); td('Etapa', String(x.etapa)); td('Descrição', (x.descricao || x.rotulo || '') + (x.estornada ? ' (estornado: ' + x.estornada.motivo + ')' : '') + (neg ? ' (estorno)' : ''));
        td('Lançou', h.nomeBonito(x.criado_por)); td('Forma', formaTxt(x.forma)); td('Valor', (neg ? '-' : '') + h.reais(v), 'v');
        var pv = td('Prova', '');
        if (x.comprovante && x.comprovante.url) { var a = h.el('a', 'jor-din-chip ok', 'Comprovante'); a.href = x.comprovante.url; a.target = '_blank'; a.rel = 'noopener'; pv.appendChild(a); }
        else if (x.comprovante) pv.appendChild(h.el('span', 'jor-din-chip ok', 'Comprovante'));
        chipsConferencia(pv, x, din);
        body.appendChild(tr);
      });
      tb.appendChild(body); var wrap = h.el('div', 'dc-wrap'); wrap.appendChild(tb); bl.appendChild(wrap);
      var tot = h.el('div', 'jor-din-tot'); tot.appendChild(h.el('span', '', 'Total')); tot.appendChild(h.el('span', 'jor-din-v', h.rs(soma))); bl.appendChild(tot);
      raiz.appendChild(bl);
    }
    grupo('Entradas', 'entrada'); grupo('Custo da obra', 'custo');
    if (l.retirada !== undefined && l.retirada !== null) grupo('Retirada dos sócios', 'retirada');
    // Previsto e real
    var pv = h.el('div', 'jor-bloco'); pv.appendChild(h.el('div', 'jor-bloco-t', 'Previsto e real'));
    var gs = gruposDoPrevisto(l.previsto);
    if (gs.length) {
      var t2 = h.el('table', 'jor-tbl jor-din-tab'); var h2 = h.el('tr');
      ['Grupo', 'Previsto', 'Real', 'Diferença'].forEach(function (t) { h2.appendChild(h.el('th', t === 'Grupo' ? '' : 'v', t)); });
      t2.appendChild(h.add(h.el('thead'), h2));
      var b2 = h.el('tbody');
      gs.forEach(function (g) {
        var tr = h.el('tr'); function td(rot, t, cls) { var c = h.el('td', cls || '', t); c.setAttribute('data-r', rot); tr.appendChild(c); }
        td('Grupo', g.rot); td('Previsto', h.rs(g.previsto), 'v'); td('Real', h.rs(g.real), 'v'); td('Diferença', h.rs(g.diferenca), 'v'); b2.appendChild(tr);
      });
      t2.appendChild(b2); pv.appendChild(t2);
    } else pv.appendChild(h.el('p', 'jor-nota', 'Sem previsto gravado.'));
    if (din.pode && din.pode.previsto) formPrevisto(pv, l);
    raiz.appendChild(pv);
    fechamento(raiz, din);
    var rg = h.el('div', 'jor-bloco'); rg.appendChild(h.el('div', 'jor-bloco-t', 'As regras do dinheiro'));
    var ol = h.el('ol', 'jor-din-ul'); REGRAS.forEach(function (t) { ol.appendChild(h.el('li', '', t)); }); rg.appendChild(ol);
    raiz.appendChild(rg);
    raiz.appendChild(h.btn('Voltar à obra', '', function () { h.desenhar(); }));
    n.replaceChildren(raiz);
  }
  function formPrevisto(pai, l) {
    var h = H(); var box = h.el('details'); box.appendChild(h.el('summary', 'jor-vdc-sum', 'Previsto da obra'));
    var g = h.el('div', 'jor-din-pc'); var ins = {};
    var dig = (O().dinheiro && O().dinheiro.previsto) || {};
    [['homologacao', 'Homologação'], ['material', 'Material'], ['frete', 'Frete'], ['mao_de_obra', 'Mão de obra'], ['outros', 'Outros']].forEach(function (c) {
      var lab = h.el('label', '', c[1]); var i = h.el('input', 'jor-in'); i.type = 'text'; i.inputMode = 'decimal'; i.setAttribute('aria-label', 'Previsto: ' + c[1]);
      if (Number(dig[c[0]]) > 0) i.value = txtCents(dig[c[0]]);
      lab.appendChild(i); g.appendChild(lab); ins[c[0]] = i;
    });
    box.appendChild(g);
    var info = h.el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var sv = h.btn('Salvar o previsto', 'jor-btn-pri', function () {
      var corpo = { versao: Number((O().dinheiro && O().dinheiro.previsto_versao) || 0) };
      var ruim = false;
      Object.keys(ins).forEach(function (k) { var v = h.cents(ins[k].value); if (v === null || v === undefined) v = 0; if (typeof v !== 'number' || !isFinite(v) || v < 0) ruim = true; corpo[k] = v; });
      if (ruim) { info.textContent = 'Use só valores em reais, como 1.250,00.'; return; }
      sv.disabled = true; info.textContent = '';
      h.api('/gerador/jornada-solar/obra/' + encodeURIComponent(O().card) + '/dinheiro/previsto', 'PUT', corpo).then(function (r) {
        sv.disabled = false;
        if (r.status === 200 && r.json.ok !== false) { h.toast('Previsto salvo.'); h.recarregar().then(function () { abrirLivro(); }); } else info.textContent = msgSrv(r, 'Não consegui salvar agora.');
      });
    });
    h.add(box, info, sv, h.el('p', 'jor-nota', 'A comissão de venda prevista sai da regra. Não se digita.'));
    pai.appendChild(box);
  }

  // ── Ajustes do Solar (só o ADM) ────────────────────────────────────────────
  var AJ = { dados: null, linhas: {}, aberto: true };
  function abrirAjustes() {
    injetarCss(); var h = H(); var c = h.corpo(); if (!c) return;
    var raiz = h.el('div'); var topo = h.el('div', 'jor-topo'); topo.appendChild(h.el('h2', '', 'Ajustes do Solar'));
    topo.appendChild(h.btn('Voltar para Clientes', '', function () { h.abrirLista(); }));
    raiz.appendChild(topo);
    if (!eAdm()) { raiz.appendChild(h.el('p', 'jor-erro', 'Só o administrador mexe nos Ajustes.')); c.replaceChildren(raiz); return; }
    c.replaceChildren(raiz); raiz.appendChild(h.el('p', 'jor-nota', 'Carregando…'));
    h.api('/gerador/jornada-solar/ajustes', 'GET').then(function (r) {
      if (!(r.status === 200 && r.json && r.json.ajustes)) { raiz.appendChild(h.el('p', 'jor-erro', msgSrv(r, 'Não consegui abrir os Ajustes agora.'))); return; }
      AJ.dados = r.json; AJ.aberto = r.json.ajustes.dinheiro_aberto !== false;
      var com = r.json.ajustes.comissoes || {};
      AJ.linhas = {};
      Object.keys(com).forEach(function (k) { AJ.linhas[k] = (com[k] || []).map(function (x) { return { nome: x.nome, papel: x.papel, pb: x.pb }; }); });
      desenharAjustes(raiz, topo, r.json);
    });
  }
  function desenharAjustes(raiz, topo, srv) {
    var h = H(); raiz.replaceChildren(topo);
    if (srv.valido === false) raiz.appendChild(h.el('p', 'jor-aviso', 'Ajustes sem assinatura: valendo o padrão.'));
    var b1 = h.el('div', 'jor-bloco'); b1.appendChild(h.el('div', 'jor-bloco-t', 'A regra das comissões'));
    var NOMES = { nilce: 'Nilce', diego: 'Diego', thiago: 'Thiago', giovanna: 'Giovanna', padrao: 'Padrão' };
    var ordem = ['nilce', 'diego', 'thiago', 'giovanna', 'padrao'].concat(Object.keys(AJ.linhas).filter(function (k) { return !NOMES[k]; }));
    var socios = srv.socios || ['thiago', 'diego'];
    ordem.forEach(function (k) {
      if (!AJ.linhas[k]) return;
      var cx = h.el('div'); cx.appendChild(h.el('div', 'jor-din-sub', 'Quando vende: ' + (NOMES[k] || h.nomeBonito(k))));
      AJ.linhas[k].forEach(function (ln, i) {
        var row = h.el('div', 'jor-pg');
        var nm = h.el('input', 'jor-in'); nm.type = 'text'; nm.value = ln.nome === '*' ? 'Quem vendeu' : h.nomeBonito(ln.nome); nm.setAttribute('aria-label', 'Nome'); nm.disabled = ln.papel === 'venda';
        if (ln.papel === 'socio') { nm.disabled = false; nm.addEventListener('input', function () { ln.nome = nm.value.trim().toLowerCase(); }); nm.setAttribute('list', 'jor-aj-socios'); }
        var pp = h.el('select', 'jor-sel'); pp.setAttribute('aria-label', 'Papel'); pp.disabled = true;
        [['venda', 'Venda'], ['socio', 'Sócio']].forEach(function (o) { var op = h.el('option', '', o[1]); op.value = o[0]; pp.appendChild(op); }); pp.value = ln.papel;
        var pc = h.el('input', 'jor-in'); pc.type = 'text'; pc.inputMode = 'decimal'; pc.setAttribute('aria-label', 'Percentual'); pc.value = String(ln.pb / 100).replace('.', ',');
        pc.addEventListener('input', function () { var v = Number(String(pc.value).replace(',', '.')); ln.pb = isFinite(v) ? Math.round(v * 100) : NaN; });
        h.add(row, nm, pp, pc);
        if (ln.papel === 'socio') row.appendChild(h.btn('Tirar', 'jor-btn-link', function () { AJ.linhas[k].splice(i, 1); desenharAjustes(raiz, topo, srv); }));
        cx.appendChild(row);
      });
      if (AJ.linhas[k].length < 4) cx.appendChild(h.btn('Mais um sócio', 'jor-btn-link', function () { AJ.linhas[k].push({ nome: socios[0] || 'thiago', papel: 'socio', pb: 200 }); desenharAjustes(raiz, topo, srv); }));
      b1.appendChild(cx);
    });
    var dl = h.el('datalist'); dl.id = 'jor-aj-socios'; socios.forEach(function (s) { var op = h.el('option'); op.value = h.nomeBonito(s); dl.appendChild(op); }); b1.appendChild(dl);
    b1.appendChild(h.el('p', 'jor-nota', 'Vale para as obras que ainda não pagaram comissão.'));
    raiz.appendChild(b1);
    var b2 = h.el('div', 'jor-bloco'); b2.appendChild(h.el('div', 'jor-bloco-t', 'Quem vê o dinheiro'));
    var fil = h.el('div', 'jor-filtros');
    [[true, 'Todos que veem a obra'], [false, 'Só o Thiago e a Giovanna']].forEach(function (o) {
      var b = h.el('button', 'jor-chip' + (AJ.aberto === o[0] ? ' on' : ''), o[1]); b.type = 'button';
      b.addEventListener('click', function () { AJ.aberto = o[0]; desenharAjustes(raiz, topo, srv); });
      fil.appendChild(b);
    });
    b2.appendChild(fil); raiz.appendChild(b2);
    var info = h.el('p', 'jor-erro'); info.setAttribute('role', 'status');
    var sv = h.btn('Salvar', 'jor-btn-pri', function () {
      var ruim = false; var corpo = { comissoes: {}, dinheiro_aberto: AJ.aberto };
      Object.keys(AJ.linhas).forEach(function (k) {
        corpo.comissoes[k] = AJ.linhas[k].map(function (x) { if (!isFinite(x.pb) || x.pb < 0 || x.pb > 2000) ruim = true; return { nome: x.nome, papel: x.papel, pb: x.pb }; });
      });
      if (ruim) { info.textContent = 'Use percentuais entre 0 e 20.'; return; }
      sv.disabled = true; info.textContent = '';
      h.api('/gerador/jornada-solar/ajustes', 'PUT', corpo).then(function (r) {
        sv.disabled = false;
        if (r.status === 200 && r.json.ok !== false) { h.toast('Ajustes salvos.'); } else info.textContent = msgSrv(r, 'Não consegui salvar agora.');
      });
    });
    h.add(raiz, info, sv);
    // Fase 3: o painel das mensagens (a função confere que é o ADM e mexe só no próprio bloco).
    if (window.Jornada.extras && window.Jornada.extras.mensagens) window.Jornada.extras.mensagens(raiz);
  }

  window.Jornada.dinheiro = {
    faixa: faixa, gastoDaRegua: gastoDaRegua, gastosDaEtapa: gastosDaEtapa, blocoComissoes: blocoComissoes, abrirLivro: abrirLivro,
    abrirAjustes: abrirAjustes, lancar: lancar, fechamento: fechamento, botoesAnexo: botoesAnexo, prepararArquivo: prepararArquivo, msgArquivo: msgArquivo,
    grupoPrevisto: function (livro, slug) { return gruposDoPrevisto(livro && livro.previsto).filter(function (g) { return g.id === slug; })[0] || null; },
  };
})();
