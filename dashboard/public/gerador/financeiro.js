/* Financeiro por cliente do eletroposto (11/10/2026).
 *
 * Cada venda tem as suas ENTRADAS e SAÍDAS de dinheiro, cada uma com o
 * comprovante. Aqui ficam as contas e as chamadas de rede; o desenho do bloco
 * fica em /gerador/index.html (funções `fin*`). Expõe `window.Financeiro`.
 *
 * TODO dinheiro aqui é CENTAVO INTEIRO. Somar reais com ponto flutuante erra
 * (0,10 + 0,20 não dá 0,30), e uma tela que mostra as parcelas e o total tem de
 * fechar a conta. A conversão acontece uma vez só, em `centavosDeTexto`.
 *
 * Script clássico, sem depender de globais do index: só de `window.PosVenda`
 * (o leitor do campo de dinheiro), buscado na hora da chamada.
 */
(function () {
  'use strict';

  var LOTE = 400;                         // ids por chamada do resumo
  var LIMITE_BYTES = 3 * 1024 * 1024;     // o servidor recusa arquivo cru acima disto
  var TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  var EXT_TIPO = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

  var Financeiro = { LIMITE_BYTES: LIMITE_BYTES, TIPOS: TIPOS };

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function inteiro(x) { return typeof x === 'number' && isFinite(x) ? Math.round(x) : 0; }
  function tem(x) { return x !== null && x !== undefined; }

  // ── dinheiro ─────────────────────────────────────────────────────────────
  /** null = vazio; NaN = não entendi; senão centavos inteiros. */
  Financeiro.centavosDeTexto = function (texto) {
    var P = window.PosVenda;
    if (!P || typeof P.parseValor !== 'function') return NaN;
    var reais = P.parseValor(texto);
    if (reais === null) return null;
    if (typeof reais !== 'number' || isNaN(reais)) return NaN;
    return Math.round(reais * 100);
  };

  /** "1.234,56" a partir de centavos, só com conta de inteiro. */
  function numCentavos(c) {
    if (!tem(c) || typeof c !== 'number' || !isFinite(c)) return '';
    var n = Math.round(c);
    var neg = n < 0;
    if (neg) n = -n;
    var reais = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + reais + ',' + p2(n % 100);
  }
  Financeiro.numCentavos = numCentavos;

  /** "R$ 1.234,56"; negativo sai "-R$ 1.234,56"; null vira "". */
  Financeiro.fmtCentavos = function (c) {
    var t = numCentavos(c);
    if (t === '') return '';
    return t.charAt(0) === '-' ? '-R$ ' + t.slice(1) : 'R$ ' + t;
  };

  /** 'YYYY-MM-DD' vira 'DD/MM/AAAA'. Em finança o ano importa. */
  Financeiro.dataBr = function (ymd) {
    var s = String(ymd || '');
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  };

  // ── a conta do cliente (a MESMA do servidor) ─────────────────────────────
  Financeiro.totais = function (lancamentos, valorVendaCentavos) {
    var lista = lancamentos || [];
    var venda = (typeof valorVendaCentavos === 'number' && isFinite(valorVendaCentavos) && valorVendaCentavos >= 0) ? Math.round(valorVendaCentavos) : null;
    var recebido = 0, gasto = 0, qe = 0, qs = 0;
    var cat = { entrada: {}, saida: {} };
    for (var i = 0; i < lista.length; i++) {
      var l = lista[i];
      if (!l || l.apagado) continue;
      var v = l.valor_centavos;
      // Igual ao servidor: linha estragada (fração, zero, negativo) não entra na soma.
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v <= 0) continue;
      var slug = String(l.categoria || 'outros');
      if (l.tipo === 'entrada') {
        recebido += v; qe++;
        cat.entrada[slug] = (cat.entrada[slug] || 0) + v;
      } else if (l.tipo === 'saida') {
        gasto += v; qs++;
        cat.saida[slug] = (cat.saida[slug] || 0) + v;
      }
    }
    var previsto = venda === null ? null : venda - gasto;
    return {
      recebido: recebido,
      gasto: gasto,
      resultado_caixa: recebido - gasto,
      a_receber: venda === null ? null : Math.max(0, venda - recebido),
      recebido_a_mais: venda === null ? 0 : Math.max(0, recebido - venda),
      resultado_previsto: previsto,
      margem_prevista: (venda === null || venda <= 0) ? null : Math.round((previsto / venda) * 1000) / 10,
      por_categoria: cat,
      qtd_entradas: qe,
      qtd_saidas: qs
    };
  };

  function somaMapa(m) {
    var s = 0;
    for (var k in (m || {})) if (Object.prototype.hasOwnProperty.call(m, k)) s += inteiro(m[k]);
    return s;
  }
  Financeiro.somaMapa = somaMapa;

  function mapaDifere(a, b) {
    var chaves = {}, k;
    for (k in (a || {})) if (Object.prototype.hasOwnProperty.call(a, k)) chaves[k] = 1;
    for (k in (b || {})) if (Object.prototype.hasOwnProperty.call(b, k)) chaves[k] = 1;
    for (k in chaves) if (inteiro((a || {})[k]) !== inteiro((b || {})[k])) return true;   // slug ausente vale 0
    return false;
  }

  /** Os campos em que o total do servidor NÃO bate com a lista mostrada. Campo que
   *  veio null (quem não é sócio não recebe gasto) não entra na comparação. */
  Financeiro.diferencas = function (totaisDoServidor, lancamentosMostrados, valorVenda) {
    var s = totaisDoServidor;
    if (!s) return ['totais'];
    var c = Financeiro.totais(lancamentosMostrados, valorVenda);
    var semSaida = !tem(s.gasto);      // visão de quem não é sócio: a lista só tem entradas
    var fora = [];
    var campos = ['recebido', 'a_receber', 'recebido_a_mais', 'qtd_entradas'];
    if (!semSaida) campos = campos.concat(['gasto', 'resultado_caixa', 'resultado_previsto', 'qtd_saidas']);
    for (var i = 0; i < campos.length; i++) {
      var k = campos[i];
      if (!tem(s[k])) continue;
      if (!tem(c[k]) || Math.round(Number(s[k])) !== c[k]) fora.push(k);
    }
    if (!semSaida && tem(s.margem_prevista)) {
      if (!tem(c.margem_prevista) || Math.abs(Number(s.margem_prevista) - c.margem_prevista) > 0.1001) fora.push('margem_prevista');
    }
    var pc = s.por_categoria;
    if (pc) {
      if (tem(pc.entrada) && mapaDifere(pc.entrada, c.por_categoria.entrada)) fora.push('por_categoria.entrada');
      if (!semSaida && tem(pc.saida) && mapaDifere(pc.saida, c.por_categoria.saida)) fora.push('por_categoria.saida');
    }
    return fora;
  };
  Financeiro.confere = function (totaisDoServidor, lancamentosMostrados, valorVenda) {
    return Financeiro.diferencas(totaisDoServidor, lancamentosMostrados, valorVenda).length === 0;
  };

  // ── rótulos ──────────────────────────────────────────────────────────────
  function acha(lista, slug) {
    for (var i = 0; i < (lista || []).length; i++) if (lista[i] && lista[i].slug === slug) return lista[i];
    return null;
  }
  Financeiro.rotulo = function (catalogo, tipo, slug) {
    var it = acha(catalogo && catalogo[tipo], slug);
    return it ? String(it.rotulo) : String(slug || '');
  };
  Financeiro.rotuloForma = function (catalogo, slug) {
    var it = acha(catalogo && catalogo.formas, slug);
    return it ? String(it.rotulo) : String(slug || '');
  };

  var MOTIVO_DUP = {
    mesmo_arquivo: 'mesmo arquivo',
    mesma_transacao: 'mesmo código de transação',
    mesmo_valor_e_data: 'mesmo valor e mesma data'
  };
  /** "Entrada de R$ 1.234,56 em 10/10/2026 (mesmo valor e mesma data)". */
  Financeiro.textoDuplicado = function (d) {
    if (!d) return '';
    var t = (d.tipo === 'saida' ? 'Saída' : 'Entrada') + ' de ' + Financeiro.fmtCentavos(inteiro(d.valor_centavos));
    var dia = Financeiro.dataBr(d.data);
    if (dia) t += ' em ' + dia;
    if (MOTIVO_DUP[d.motivo]) t += ' (' + MOTIVO_DUP[d.motivo] + ')';
    return t;
  };

  // ── erros ────────────────────────────────────────────────────────────────
  var MENSAGENS = {
    valor_invalido: 'Esse valor não foi aceito. Confira o número.',
    data_invalida: 'Essa data não foi aceita. Escolha outra.',
    descricao_obrigatoria: 'Em Outros, escreva do que se trata.',
    categoria_invalida: 'Escolha a categoria.',
    so_socio: 'Só sócio lança ou vê saída.',
    so_autor: 'Só quem lançou ou um sócio mexe neste lançamento.',
    apagado: 'Esse lançamento já foi apagado. Recarregue a lista.',
    mudou: 'Esse lançamento mudou em outra tela. Recarregue e tente de novo.',
    nao_encontrado: 'Esse lançamento não existe mais. Recarregue a lista.',
    bucket_indisponivel: 'Não deu para guardar o arquivo agora. Tente de novo em instantes.',
    armazenamento_falhou: 'Não deu para guardar o arquivo agora. Tente de novo em instantes.',
    arquivo_grande: 'Esse arquivo passa de 3 MB. Envie um print ou um PDF menor.',
    heic_nao_suportado: 'Esse formato de foto do iPhone não é aceito. Envie como JPG, PNG ou PDF.',
    tipo_nao_aceito: 'Só imagem ou PDF.',
    arquivo_invalido: 'Não consegui abrir esse arquivo. Tente outro.',
    motivo_obrigatorio: 'Escreva o motivo para apagar.'
  };
  Financeiro.mensagemErro = function (e) {
    var c = e && e.codigo;
    if (c && Object.prototype.hasOwnProperty.call(MENSAGENS, c)) return MENSAGENS[c];
    var s = e && e.status;
    if (s === 401) return 'Sua sessão venceu. Entre de novo para usar o financeiro.';
    if (s === 403) return 'Esta conta não tem acesso ao financeiro.';
    if (s === 429) return 'Muitas leituras seguidas. Espere um minuto.';
    return 'Não deu para falar com o financeiro. Tente de novo.';
  };

  function erro(status, codigo, extra) {
    var e = new Error(codigo || ('financeiro HTTP ' + status));
    e.status = status;
    e.codigo = String(codigo || '');
    if (extra && extra.duplicados) e.duplicados = extra.duplicados;
    return e;
  }
  Financeiro.erro = erro;

  // ── arquivo ──────────────────────────────────────────────────────────────
  /** O tipo que vai no envio. O navegador às vezes entrega `type` vazio (HEIC,
   *  arquivo vindo de outro app): aí vale a extensão. */
  Financeiro.tipoDoArquivo = function (arq) {
    var t = String((arq && arq.type) || '').toLowerCase();
    if (t === 'image/jpg') t = 'image/jpeg';
    if (t) return t;
    var m = /\.([a-z0-9]+)$/i.exec(String((arq && arq.name) || ''));
    var ext = m ? m[1].toLowerCase() : '';
    if (ext === 'heic' || ext === 'heif') return 'image/heic';
    return EXT_TIPO[ext] || '';
  };
  /** null quando o arquivo pode ir; senão o código do erro (os mesmos do servidor).
   *  `semTamanho` confere só o tipo: a foto ainda vai ser reduzida antes de medir. */
  Financeiro.checarArquivo = function (arq, semTamanho) {
    var t = Financeiro.tipoDoArquivo(arq);
    var nome = String((arq && arq.name) || '');
    if (t === 'image/heic' || t === 'image/heif' || /\.hei[cf]$/i.test(nome)) return 'heic_nao_suportado';
    if (TIPOS.indexOf(t) === -1) return 'tipo_nao_aceito';
    if (!semTamanho && Number((arq && arq.size) || 0) > LIMITE_BYTES) return 'arquivo_grande';
    return null;
  };

  /** Chave de idempotência do lançamento: gerada UMA vez por formulário aberto. */
  Financeiro.uuid = function () {
    var c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = [], i;
    if (c && typeof c.getRandomValues === 'function') {
      var u = new Uint8Array(16);
      c.getRandomValues(u);
      for (i = 0; i < 16; i++) b.push(u[i]);
    } else {
      for (i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = '';
    for (i = 0; i < 16; i++) {
      h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      if (i === 3 || i === 5 || i === 7 || i === 9) h += '-';
    }
    return h;
  };

  // ── rede ─────────────────────────────────────────────────────────────────
  // Toda rota exige o token da sessão. Falha vira Error com .status, .codigo e,
  // no 409, .duplicados. Rede fora do ar vira status 0.
  async function chamar(metodo, url, token, corpo) {
    var opcoes = { method: metodo, headers: { 'Authorization': 'Bearer ' + String(token || '') } };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    var r;
    try { r = await fetch(url, opcoes); }
    catch (e) { throw erro(0, ''); }
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok || !j || j.ok === false) throw erro(r.status, j && (j.error || j.erro), j);
    return j;
  }

  function raiz(base, cardId) {
    return String(base || '') + '/gerador/financeiro/' + encodeURIComponent(String(cardId));
  }

  Financeiro.ler = function (base, token, cardId) {
    return chamar('GET', raiz(base, cardId), token);
  };

  /** Mais novo primeiro, como o servidor manda: data decrescente, depois criado_em. */
  Financeiro.ordenar = function (lancamentos) {
    return (lancamentos || []).slice().sort(function (a, b) {
      var da = String(a.data || ''), db = String(b.data || '');
      if (da !== db) return da < db ? 1 : -1;
      var ca = String(a.criado_em || ''), cb = String(b.criado_em || '');
      return ca < cb ? 1 : (ca > cb ? -1 : 0);
    });
  };

  /** { socio, resumo: { [cardId]: { recebido, gasto, qtd } } }, em lotes. */
  Financeiro.resumo = async function (base, token, ids) {
    var lista = (ids || []).filter(function (x) { return tem(x) && x !== ''; });
    var fim = { ok: true, socio: false, resumo: {} };
    for (var i = 0; i < lista.length; i += LOTE) {
      var j = await chamar('GET', String(base || '') + '/gerador/financeiro/resumo?ids=' + lista.slice(i, i + LOTE).join(','), token);
      fim.socio = j.socio === true;
      var r = j.resumo || {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) fim.resumo[k] = r[k];
    }
    return fim;
  };

  Financeiro.subir = function (base, token, cardId, arquivo) {
    var a = arquivo || {};
    return chamar('POST', raiz(base, cardId) + '/arquivo', token,
      { base64: a.base64, media_type: a.media_type, nome: a.nome, ler: a.ler === true });
  };

  Financeiro.gravar = function (base, token, cardId, lancamento) {
    return chamar('POST', raiz(base, cardId) + '/lancamento', token, lancamento);
  };

  Financeiro.apagar = function (base, token, cardId, id, motivo) {
    return chamar('POST', raiz(base, cardId) + '/lancamento/' + encodeURIComponent(String(id)) + '/apagar', token, { motivo: motivo });
  };

  window.Financeiro = Financeiro;
})();
