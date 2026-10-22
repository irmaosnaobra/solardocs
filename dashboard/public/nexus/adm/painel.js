/* Painel NEXUS da equipe (Parceiros, Pedidos, Oportunidades, Solicitações, Propostas, Convite) e, no ADM, Funil e Equipe.
   Uma só cópia do código para duas páginas:
     /gerador/parceiros  window.PAINEL_NEXUS = { auth: 'gerador' }   sessão do Gerador (localStorage), visual do /gerador.
     /nexus/adm          window.PAINEL_NEXUS = { auth: 'solardoc', manual: true, eu: {...}, aoPerderSessao: fn }
                         sessão do SolarDoc (cookie solardoc_token), visual NEXUS; a página chama PainelNexus.iniciar(eu)
                         depois que GET /gerador/nexus/adm/eu responde 200.
   A página precisa de <div id="painel-raiz" class="pn"></div>; este arquivo monta o resto. */
(function () {
'use strict';

var CFG = window.PAINEL_NEXUS || { auth: 'gerador' };
var MODO = CFG.auth === 'solardoc' ? 'solardoc' : 'gerador';
var ADM = MODO === 'solardoc';
var EU = CFG.eu || null;   // { email, nome, socio, gerirEquipe, via } (só no ADM)

/* ── Sessão e chamadas (no /gerador: a mesma sessão do Gerador, igual à planilha de clientes; no ADM: o JWT do SolarDoc no cookie) ── */
var SESSAO_KEY = 'irmaos-na-obra-sessao-v1';
var SUPABASE_URL = 'https://ancecdfqfwlaujknizof.supabase.co';
// Chave publishable do Supabase do Gerador: a mesma que já está escrita no index.html do /gerador e na planilha de clientes.
var SUPABASE_KEY = 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6'; // gitleaks:allow (chave publica de navegador, a mesma do index.html; o .gitleaks.toml libera em dashboard/public)
var API = '/_api/gerador/nexus/equipe';

var D = null;            // última resposta de /equipe/parceiros
var ST = {};             // listas das outras abas, por nome (null = ainda não carregada)
var PROPS_DESDE = null;  // período em que ST.propostas foi carregada
var PROPS_ALL = null;    // todas as propostas, só para a ficha do parceiro
var aba = 'parceiros';
var MOSTRAR_USINAS = false; // true religa a aba Usinas e o total "Usinas novas"
var fichaId = null;
var foco = null;
var carregando = false;
var renovando = null;
var SUG = {};            // sugestões por oportunidade

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function erro(tipo) { var e = new Error(tipo); e.tipo = tipo; return e; }
function irParaLogin() {
  if (ADM) { if (typeof CFG.aoPerderSessao === 'function') CFG.aoPerderSessao(); else location.reload(); return; }
  location.replace('/gerador');
}
// Cookie do SolarDoc (o mesmo que o portal grava: solardoc_token).
function lerCookie(nome) {
  var partes = document.cookie ? document.cookie.split('; ') : [];
  for (var i = 0; i < partes.length; i++) {
    var k = partes[i].indexOf('=');
    if (k < 0) continue;
    if (partes[i].slice(0, k) === nome) {
      try { return decodeURIComponent(partes[i].slice(k + 1)); } catch (e) { return partes[i].slice(k + 1); }
    }
  }
  return '';
}
function lerSessao() { try { return JSON.parse(localStorage.getItem(SESSAO_KEY) || 'null'); } catch (e) { return null; } }
function sessaoViva(s) { return !!(s && s.access_token && Number(s.expira_em || 0) > Date.now()); }

function renovarAgora(tokenUsado) {
  var s = lerSessao();
  if (!s || !s.refresh_token) { irParaLogin(); return Promise.reject(erro('login')); }
  if (sessaoViva(s) && s.access_token !== tokenUsado) return Promise.resolve(s.access_token);
  var meu = s.refresh_token;
  return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: meu })
  }).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) { return { r: r, j: j }; });
  }, function () { throw erro('rede'); }).then(function (x) {
    if (x.r.ok && x.j && x.j.access_token) {
      try {
        localStorage.setItem(SESSAO_KEY, JSON.stringify({
          access_token: x.j.access_token,
          refresh_token: x.j.refresh_token || meu,
          expira_em: Date.now() + (Number(x.j.expires_in || 3600) - 300) * 1000
        }));
      } catch (e) {}
      return x.j.access_token;
    }
    if (x.r.status >= 500 || x.r.status === 429) throw erro('rede');
    var atual = lerSessao();
    if (atual && atual.refresh_token !== meu && sessaoViva(atual)) return atual.access_token;
    try { localStorage.removeItem(SESSAO_KEY); } catch (e) {}
    irParaLogin();
    throw erro('login');
  });
}
function renovar(tokenUsado) {
  if (renovando) return renovando;
  var rodar = function () { return renovarAgora(tokenUsado); };
  var p = (navigator.locks && navigator.locks.request) ? navigator.locks.request('gerador-sessao-renovar', rodar) : rodar();
  renovando = Promise.resolve(p).then(function (v) { renovando = null; return v; }, function (e) { renovando = null; throw e; });
  return renovando;
}
function obterToken() {
  if (ADM) {
    var tk = lerCookie('solardoc_token');
    if (!tk) { irParaLogin(); return Promise.reject(erro('login')); }
    return Promise.resolve(tk);
  }
  var s = lerSessao();
  if (!s || !s.access_token) { irParaLogin(); return Promise.reject(erro('login')); }
  return sessaoViva(s) ? Promise.resolve(s.access_token) : renovar(null);
}
function pedir(metodo, caminho, corpo, tk, tmo) {
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var tt = ctrl ? setTimeout(function () { ctrl.abort(); }, tmo || 20000) : null;
  var h = { 'Authorization': 'Bearer ' + tk };
  if (corpo) h['Content-Type'] = 'application/json';
  return fetch(API + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) {
      if (tt) clearTimeout(tt);
      return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, json: j }; });
    }, function () { if (tt) clearTimeout(tt); throw erro('rede'); });
}
// Devolve { status, json } para qualquer resposta do servidor. 401: renova uma vez; se continuar, volta ao login.
function api(metodo, caminho, corpo, tmo) {
  return obterToken().then(function (tk) {
    return pedir(metodo, caminho, corpo, tk, tmo).then(function (x) {
      if (x.status !== 401) return x;
      // O JWT do SolarDoc não renova: 401 é sessão perdida, e a página mostra o login.
      if (ADM) { irParaLogin(); throw erro('login'); }
      return renovar(tk).then(function (tk2) {
        return pedir(metodo, caminho, corpo, tk2, tmo).then(function (y) {
          if (y.status === 401) { irParaLogin(); throw erro('login'); }
          return y;
        });
      });
    });
  });
}
function okHttp(x) { return x.status >= 200 && x.status < 300 && x.json; }
function desligado(x) { return x.status === 503 && x.json && x.json.erro === 'portal_desligado'; }
// A API devolve a lista sob uma chave com o nome da aba; aceita também um array puro.
function arr(json, chave) {
  if (Array.isArray(json)) return json;
  return (json && (json[chave] || json.itens || json.items)) || [];
}

/* ── Formatação ── */
var TZ = 'America/Sao_Paulo';
function fmtData(iso, comHora) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var o = { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' };
  if (comHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return d.toLocaleString('pt-BR', o);
}
function fmtReal(v) {
  var n = Number(v);
  if (!isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtNum(v) { var n = Number(v); return isFinite(n) ? n.toLocaleString('pt-BR') : '0'; }
function fmtCnpj(c) {
  var d = String(c || '').replace(/\D/g, '');
  if (d.length !== 14) return d || 'Sem CNPJ';
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function semAcento(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function numeroWpp(t) {
  var d = String(t || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 ? d : '';
}
function linkWpp(num, msg, rotulo) {
  var n = numeroWpp(num);
  if (!n) return '';
  return '<a class="btn ghost sm" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener noreferrer" href="https://wa.me/' +
    n + '?text=' + encodeURIComponent(msg) + '">' + esc(rotulo) + '</a>';
}
function opcoes(mapa, atual) {
  return Object.keys(mapa).map(function (k) {
    return '<option value="' + esc(k) + '"' + (atual === k ? ' selected' : '') + '>' + esc(mapa[k]) + '</option>';
  }).join('');
}

var STATUS = { novo: 'Novo', em_contato: 'Em contato', parceiro_ativo: 'Parceiro ativo', descartado: 'Descartado' };
var STATUS_COR = { novo: 'az', em_contato: 'av', parceiro_ativo: 'ok', descartado: '' };
var NIVEIS = { cadastrado: 'Cadastrado', partner: 'Partner', pro: 'Pro', master: 'Master' };
var PEDIDO_ST = { solicitado: 'Solicitado', negociando: 'Negociando', confirmado: 'Confirmado', cancelado: 'Cancelado' };
var PEDIDO_COR = { solicitado: 'az', negociando: 'av', confirmado: 'ok', cancelado: '' };
var PEDIDO_TIPO = { equipamento: 'Equipamento', engenharia: 'Engenharia', consultoria: 'Apoio de venda', manutencao: 'Plano de manutenção' };
var OPORT_ST = { rascunho: 'Rascunho', oferecida: 'Oferecida', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada', contato: 'Em contato', visita: 'Visita', orcamento: 'Orçamento', fechou: 'Fechou', perdeu: 'Perdeu' };
var OPORT_COR = { rascunho: '', oferecida: 'az', aceita: 'ok', recusada: 'er', expirada: '', contato: 'av', visita: 'av', orcamento: 'av', fechou: 'ok', perdeu: 'er' };
var OPORT_TIPO = { cliente: 'Cliente final', obra: 'Obra terceirizada' };
var USINA_ST = { recebida: 'Recebida', em_analise: 'Em análise', contrato: 'Contrato', descartada: 'Descartada' };
var USINA_COR = { recebida: 'az', em_analise: 'av', contrato: 'ok', descartada: '' };
var USINA_INT = { vender_creditos: 'Vender créditos', alugar: 'Alugar', outro: 'Outro' };
var SOL_ST = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
var SOL_COR = { aberta: 'az', em_andamento: 'av', concluida: 'ok', cancelada: '' };
var SOL_TIPO = { conversa: 'Conversa com o comercial', engenharia: 'Engenharia', negociar_preco: 'Negociar preço', plataforma: 'Plataforma NEXUS' };
var ORIGENS = { portal: 'Portal', solardoc: 'Menu do SolarDoc', solardoc_banner: 'Banner do SolarDoc', link_cadastro: 'Link de cadastro', partner_lp: 'Página /nexus/partner', convite_email: 'Convite por e-mail', convite_wpp: 'Convite por WhatsApp', anuncio: 'Anúncio' };
var CAPS = [
  ['cap_eletrica_bt', 'Elétrica de baixa tensão'], ['cap_eletrica_mt', 'Elétrica de média tensão'],
  ['cap_engenharia_art', 'Engenharia com ART'], ['cap_obra_civil', 'Obra civil'],
  ['cap_homologacao', 'Homologação na distribuidora'], ['cap_ja_instala', 'Já instala carregador']
];
// Chaves de progresso.faltam como a API devolve (api/src/services/nexus/niveis.ts). Chave desconhecida nunca aparece crua.
var FALTA = {
  perfil: 'Perfil completo', primeira_proposta: 'Primeira proposta', conversa: 'Conversa com o comercial',
  aprovacao_partner: 'Marcação de Partner pela equipe', primeira_compra: 'Primeiro carregador comprado',
  compras: 'Carregadores comprados'
};
function faltaRotulo(k, pr) {
  if (k === 'compras' && pr && Number(pr.carregadores_faltam) > 0) {
    var n = Number(pr.carregadores_faltam);
    return n + (n === 1 ? ' carregador a comprar' : ' carregadores a comprar');
  }
  return FALTA[k] || 'Outro requisito do nível';
}
var MODELOS = { 'nexus-dc-80': 'NEXUS DC 80 kW', 'nexus-dc-120': 'NEXUS DC 120 kW' };
/* Copia de cidadeUf() de app/js/app.js (esta pagina nao carrega o app). */
function cidadeUf(cidade, uf) {
  var c = String(cidade == null ? '' : cidade).trim(), u = String(uf == null ? '' : uf).trim().toUpperCase();
  var m = c.match(/^(.*\S)\s*(?:[\/,\u2013\u2014-]\s*|\s)([A-Za-z]{2})$/);
  if (m) {
    var sig = m[2].toUpperCase();
    if (u ? sig === u : UFS.indexOf(sig) >= 0) { c = m[1].replace(/[\s,\/\u2013\u2014-]+$/, ''); if (!u) u = sig; }
  }
  return c && u ? c + '/' + u : (c || u);
}
var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
// Funil e Equipe só no ADM (/nexus/adm); o /gerador/parceiros segue com as abas de sempre.
var ABAS = [
  ['parceiros', 'Parceiros', null], ['funil', 'Funil', null], ['pedidos', 'Pedidos', 'pedidos_abertos'], ['oportunidades', 'Oportunidades', 'oportunidades_abertas'],
  ['usinas', 'Usinas', 'usinas_novas'], ['solicitacoes', 'Solicitações', 'solicitacoes_abertas'], ['propostas', 'Propostas', null], ['equipe', 'Equipe', null]
].filter(function (a) {
  if (a[0] === 'funil' || a[0] === 'equipe') return ADM;
  return MOSTRAR_USINAS || a[0] !== 'usinas';
});

function papeis(p) {
  var l = [];
  if (p.papel_revenda) l.push('Revenda');
  if (p.papel_montagem) l.push('Montagem e Engenharia');
  return l;
}
// O nível vem calculado da API; se a lista não trouxer, deduz das datas e da contagem (mesma regra da especificação).
function nivelDe(p) {
  if (p.nivel && NIVEIS[p.nivel]) return p.nivel;
  var c = Number(p.carregadores_comprados) || 0;
  if (c >= 5) return 'master';
  if (c >= 1) return 'pro';
  if (p.partner_em) return 'partner';
  return 'cadastrado';
}
function empresaDe(userId, fallback) {
  if (fallback) return fallback;
  if (D) for (var i = 0; i < D.parceiros.length; i++) if (String(D.parceiros[i].user_id) === String(userId)) return D.parceiros[i].empresa || '';
  return '';
}

function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('on'); }, 2800);
}

/* ── Estados da tela ── */
function mostrarEstado(html, classe) {
  var e = $('estado');
  e.className = 'card estado' + (classe ? ' ' + classe : '');
  e.innerHTML = html;
  e.classList.remove('oculto');
  $('painel').classList.add('oculto');
  $('convite-off').classList.add('oculto');
}
function mostrarPainel() {
  $('estado').classList.add('oculto');
  $('convite-off').classList.add('oculto');
  $('painel').classList.remove('oculto');
}
function estadoCarregando() { mostrarEstado('<span class="spin"></span>Carregando os parceiros'); }
function estadoDesligado() {
  mostrarEstado('<h2>O portal ainda está desligado</h2>' +
    '<p>As tabelas do Portal do Parceiro NEXUS ainda não existem no banco. Para ligar, rode o arquivo ' +
    '<code>MIGRATION_nexus_portal.sql</code> (fica na raiz do repositório) no banco principal do SolarDoc e recarregue esta página.</p>' +
    '<button type="button" class="btn" onclick="carregar()">Tentar de novo</button>', 'desligado');
  // O convite aparece, mas desligado: só liga quando o portal estiver ligado.
  $('convite-off').innerHTML = conviteHtml('desligada');
  $('convite-off').classList.remove('oculto');
}
function estadoErro(msg) {
  mostrarEstado('<h2>Não consegui carregar os parceiros</h2><p>' + esc(msg || 'Confira a internet e tente de novo.') + '</p>' +
    '<button type="button" class="btn" onclick="carregar()">Tentar de novo</button>', 'erro');
}
function estadoSemPermissao() {
  mostrarEstado('<h2>Esta página é só da equipe</h2><p>Sua conta não tem permissão para ver os parceiros. Se isso for engano, fale com um sócio.</p>', 'erro');
}

/* ── Convite por e-mail (só sócio dispara) ── */
var LOTE = 40;
var CV = { fase: 'carregando', previa: null, confirmando: false, enviando: false, incerto: false, semPermissao: false, retorno: null };
var ICONE_CADEADO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
function numOuSem(v) { return v == null || !isFinite(Number(v)) ? 'Sem dado' : fmtNum(v); }
function conviteHtml(fase) {
  var pv = CV.previa;
  var h = '<h2>Convite por e-mail</h2><p class="sub">Convida por e-mail as contas do SolarDoc que têm CNPJ e ainda não são parceiras. Cada envio manda até ' + LOTE +
    ' convites, e ninguém recebe o mesmo convite duas vezes.</p>';
  var mostraNumeros = pv && (fase === 'pronta' || fase === 'travada');
  if (mostraNumeros) {
    h += '<div class="totais">' + [
      [numOuSem(pv.total), 'No público do convite'], [numOuSem(pv.ja_enviados), 'Já enviados'],
      [numOuSem(pv.excluidos_optout), 'Fora por descadastro'], [numOuSem(pv.ja_parceiros), 'Já são parceiros']
    ].map(function (i) { return '<div class="tot"><div class="n">' + esc(i[0]) + '</div><div class="r">' + esc(i[1]) + '</div></div>'; }).join('') + '</div>';
    var am = Array.isArray(pv.amostra) ? pv.amostra.slice(0, 5) : [];
    if (am.length) h += '<p class="peq">Exemplos de quem recebe: ' + am.map(function (e) { return esc(e); }).join(', ') + '.</p>';
  }
  var rotuloBtn = 'Enviar próximo lote (' + LOTE + ')';
  if (fase === 'carregando') return h + '<p class="peq"><span class="spin"></span>Carregando a prévia do convite</p>';
  if (fase === 'desligada') {
    return h + '<div class="acao-conv"><span class="trava">' + ICONE_CADEADO + 'Desligado</span><button type="button" class="btn" disabled>' + esc(rotuloBtn) + '</button></div>' +
      '<p class="peq" style="margin:10px 0 0">O convite só liga junto com o portal. Rode o <code>MIGRATION_nexus_portal.sql</code> inteiro e recarregue a página.</p>';
  }
  if (fase === 'travada') {
    return h + '<div class="acao-conv"><span class="trava">' + ICONE_CADEADO + 'Só sócio dispara</span><button type="button" class="btn" disabled>' + esc(rotuloBtn) + '</button></div>' +
      '<p class="peq" style="margin:10px 0 0">Você pode olhar este bloco, mas só um sócio consegue enviar os convites.</p>';
  }
  if (fase === 'erro') {
    return h + '<div class="retorno er">Não consegui carregar a prévia do convite. <button type="button" class="btn sm" data-cv="recarregar">Tentar de novo</button></div>';
  }
  // fase 'pronta'
  var semMais = (pv && pv.total != null && Number(pv.total) === 0) || (CV.retorno && CV.retorno.tipo === 'ok' && CV.retorno.restantes != null && Number(CV.retorno.restantes) === 0);
  if (CV.confirmando) {
    h += '<p class="pergunta">Enviar ' + LOTE + ' convites agora?</p><p class="peq" style="margin:0 0 10px">Cada convite sai por e-mail para o dono da conta e não dá para desfazer.</p>' +
      '<div class="acao-conv"><button type="button" class="btn" data-cv="confirmar">Sim, enviar agora</button><button type="button" class="btn ghost" data-cv="cancelar">Cancelar</button></div>';
  } else {
    h += '<div class="acao-conv"><button type="button" class="btn" data-cv="pedir"' + (CV.enviando || CV.incerto || semMais ? ' disabled' : '') + '>' +
      esc(CV.enviando ? 'Enviando…' : rotuloBtn) + '</button></div>';
    if (semMais && !CV.enviando) h += '<p class="peq" style="margin:10px 0 0">Não há convites restantes para enviar.</p>';
  }
  if (CV.enviando) h += '<p class="peq" style="margin:10px 0 0"><span class="spin"></span>Enviando os convites. Não feche a página.</p>';
  if (CV.retorno) {
    var r = CV.retorno;
    h += '<div class="retorno ' + (r.tipo === 'ok' ? '' : r.tipo) + '" role="status">' + (r.tipo === 'ok'
      ? 'Enviados: ' + esc(numOuSem(r.enviados)) + '. Restantes: ' + esc(numOuSem(r.restantes)) + '.'
      : esc(r.texto)) + '</div>';
  }
  return h;
}
function desenharConvite() {
  var box = $('convite-box');
  box.innerHTML = conviteHtml(CV.semPermissao && CV.fase === 'pronta' ? 'travada' : CV.fase);
  if (CV.confirmando) { var c = box.querySelector('[data-cv="cancelar"]'); if (c) c.focus(); }
}
function carregarConvite(manterRetorno) {
  if (!manterRetorno) { CV.fase = 'carregando'; CV.retorno = null; CV.confirmando = false; CV.incerto = false; desenharConvite(); }
  return api('GET', '/convites/email/previa').then(function (x) {
    if (desligado(x)) { CV.fase = 'desligada'; CV.previa = null; }
    else if (x.status === 403) { CV.fase = 'travada'; CV.previa = null; CV.semPermissao = true; }
    else if (okHttp(x)) { CV.fase = 'pronta'; CV.previa = x.json; CV.incerto = false; }
    else CV.fase = 'erro';
    desenharConvite();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    CV.fase = 'erro'; desenharConvite();
  });
}
function enviarLote() {
  if (CV.enviando || CV.incerto) return;
  CV.enviando = true; CV.confirmando = false; CV.retorno = null;
  desenharConvite();
  // Mandar 40 e-mails leva mais que os 20 s das outras chamadas.
  api('POST', '/convites/email/enviar', { confirmar: true }, 280000).then(function (x) {
    CV.enviando = false;
    if (x.status === 403) { CV.semPermissao = true; CV.fase = 'travada'; desenharConvite(); return; }
    if (desligado(x)) { CV.fase = 'desligada'; desenharConvite(); return; }
    if (okHttp(x)) {
      CV.retorno = { tipo: Number(x.json.enviados) > 0 ? 'ok' : 'av', enviados: x.json.enviados, restantes: x.json.restantes };
      if (Number(x.json.falhas) > 0 || x.json.parou_por_erro) {
        // O lote parou no meio: não é sucesso. Mostra o aviso de erro com o número de envios que saíram.
        CV.retorno = { tipo: 'er', texto: 'O lote parou por erro depois de ' + numOuSem(x.json.enviados) + ' envios. Confira e tente o próximo lote.' };
      } else if (CV.retorno.tipo === 'av') CV.retorno.texto = 'Nenhum convite foi enviado. Restantes: ' + numOuSem(x.json.restantes) + '.';
      desenharConvite();
      return carregarConvite(true);
    }
    // Resposta de erro do servidor: pode ter enviado parte. Trava o botão até a prévia ser relida.
    if (x.status < 500) {
      // 4xx: o servidor recusou antes de enviar. Nada saiu.
      CV.retorno = { tipo: 'er', texto: 'O servidor recusou o envio (' + x.status + '). Nenhum convite saiu.' };
      desenharConvite();
      return;
    }
    CV.incerto = true;
    CV.retorno = { tipo: 'er', texto: 'O envio não terminou (' + x.status + '). Alguns convites podem ter saído. Confira a prévia antes de enviar de novo.' };
    desenharConvite();
    return carregarConvite(true);
  }).catch(function (e) {
    CV.enviando = false;
    if (e && e.tipo === 'login') return;
    CV.incerto = true;
    CV.retorno = { tipo: 'av', texto: 'Sem resposta do servidor. Os convites podem ter saído. Confira a prévia antes de enviar de novo.' };
    desenharConvite();
    return carregarConvite(true);
  });
}

/* ── Carga principal (parceiros e totais) ── */
function carregar(silencioso) {
  if (carregando) return Promise.resolve();
  carregando = true;
  if (!silencioso) estadoCarregando();
  return api('GET', '/parceiros').then(function (x) {
    if (desligado(x)) { D = null; estadoDesligado(); return; }
    if (x.status === 403) { estadoSemPermissao(); return; }
    if (!okHttp(x)) {
      if (silencioso) { toast('Não consegui atualizar. Tente de novo.'); return; }
      estadoErro('O servidor respondeu com erro (' + x.status + ').');
      return;
    }
    D = { parceiros: x.json.parceiros || [], totais: x.json.totais || {} };
    ST = {}; PROPS_DESDE = null; PROPS_ALL = null; SUG = {};
    mostrarPainel();
    desenharTotais();
    desenharGrafico();
    desenharAbas();
    montarUFs();
    desenharLista();
    if (!silencioso) carregarConvite(false);
    if (aba !== 'parceiros') abrirAba(aba, true);
    if (fichaId) desenharFicha();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    if (silencioso) { toast('Sem conexão. Tente de novo.'); return; }
    estadoErro('Sem conexão com o servidor. Confira a internet e tente de novo.');
  }).then(function () { carregando = false; });
}

function desenharTotais() {
  var t = D.totais || {};
  var itens = [
    [fmtNum(t.parceiros), 'Parceiros'],
    [fmtNum(t.novos_30d), 'Novos em 30 dias'],
    [fmtNum(t.credenciados != null ? t.credenciados : t.partners), t.credenciados != null ? 'Credenciados' : 'Partners'],
    [fmtNum(t.propostas_mes), 'Propostas no mês'],
    [fmtNum(t.carregadores_mes), 'Carregadores em proposta no mês'],
    [fmtReal(t.valor_mes), 'Valor em proposta no mês']
  ];
  [['pedidos_abertos', 'Pedidos abertos'], ['carregadores_confirmados_mes', 'Carregadores confirmados no mês'],
   ['oportunidades_abertas', 'Oportunidades abertas'], ['usinas_novas', 'Usinas novas'], ['solicitacoes_abertas', 'Solicitações abertas']
  ].filter(function (c) { return MOSTRAR_USINAS || c[0] !== 'usinas_novas'; }).forEach(function (c) { if (t[c[0]] != null) itens.push([fmtNum(t[c[0]]), c[1]]); });
  $('totais').innerHTML = itens.map(function (i) {
    return '<div class="tot"><div class="n">' + esc(i[0]) + '</div><div class="r">' + esc(i[1]) + '</div></div>';
  }).join('');
}

function desenharGrafico() {
  var cont = { cadastrado: 0, partner: 0, pro: 0, master: 0 };
  D.parceiros.forEach(function (p) { cont[nivelDe(p)]++; });
  var ks = Object.keys(NIVEIS);
  var max = Math.max(1, Math.max.apply(null, ks.map(function (k) { return cont[k]; })));
  $('grafico').innerHTML = ks.map(function (k) {
    var q = cont[k], pct = Math.round((q / max) * 1000) / 10;
    return '<div class="eg-lin"><span class="t">' + esc(NIVEIS[k]) + '</span><span class="q">' + q + '</span>' +
      '<svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="' + esc(NIVEIS[k] + ': ' + q) + '">' +
      '<rect class="fundo" x="0" y="0" width="100" height="10" rx="2"></rect>' +
      '<rect class="barra" x="0" y="0" width="' + pct + '" height="10" rx="2"></rect></svg></div>';
  }).join('');
}

function desenharAbas() {
  var t = D.totais || {};
  $('abas').innerHTML = ABAS.map(function (a) {
    var n = a[2] ? Number(t[a[2]]) || 0 : 0;
    return '<button type="button" role="tab" data-aba="' + a[0] + '" aria-selected="' + (aba === a[0]) + '">' + esc(a[1]) +
      (n ? '<span class="ct">' + n + '</span>' : '') + '</button>';
  }).join('');
}

function montarUFs() {
  var sel = $('f-uf'), atual = sel.value;
  var ufs = {};
  D.parceiros.forEach(function (p) { if (p.uf) ufs[String(p.uf).toUpperCase()] = 1; });
  sel.innerHTML = '<option value="">Todas</option>' + Object.keys(ufs).sort().map(function (u) {
    return '<option value="' + esc(u) + '">' + esc(u) + '</option>';
  }).join('');
  sel.value = ufs[atual] ? atual : '';
}

/* ── Aba Parceiros ── */
function filtrados() {
  var q = semAcento($('f-busca').value.trim());
  var qd = q.replace(/\D/g, '');
  var uf = $('f-uf').value, st = $('f-status').value, pa = $('f-papel').value, nv = $('f-nivel').value;
  return D.parceiros.filter(function (p) {
    if (uf && String(p.uf || '').toUpperCase() !== uf) return false;
    if (st && p.status !== st) return false;
    if (pa === 'revenda' && !p.papel_revenda) return false;
    if (pa === 'montagem' && !p.papel_montagem) return false;
    if (nv && nivelDe(p) !== nv) return false;
    if (q) {
      var alvo = semAcento((p.empresa || '') + ' ' + (p.cidade || '') + ' ' + (p.uf || ''));
      var okTxt = alvo.indexOf(q) !== -1;
      var okDoc = qd.length >= 3 && String(p.cnpj || '').replace(/\D/g, '').indexOf(qd) !== -1;
      if (!okTxt && !okDoc) return false;
    }
    return true;
  }).sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
}

function pill(mapa, cores, k) {
  return '<span class="pill ' + (cores[k] || '') + '">' + esc(mapa[k] || k || '') + '</span>';
}

function desenharLista() {
  if (!D) return;
  var l = filtrados();
  $('contagem').textContent = l.length === D.parceiros.length
    ? (l.length === 1 ? '1 parceiro' : l.length + ' parceiros')
    : l.length + ' de ' + D.parceiros.length + ' parceiros';
  csvBotao('parceiros', l.length);
  if (!D.parceiros.length) {
    $('lista').innerHTML = '<div class="vazio">Nenhuma empresa criou conta no portal ainda. Quando alguém se cadastrar, aparece aqui.</div>';
    return;
  }
  if (!l.length) {
    $('lista').innerHTML = '<div class="vazio">Nenhum parceiro com esses filtros. Limpe a busca ou troque os filtros.</div>';
    return;
  }
  $('lista').innerHTML = l.map(function (p) {
    var pp = papeis(p);
    var local = cidadeUf(p.cidade, p.uf) || 'Sem cidade';
    return '<button type="button" class="lin" data-id="' + esc(p.id) + '">' +
      '<div class="col"><div class="emp">' + esc(p.empresa || 'Empresa sem nome') + '</div>' +
        '<div class="peq">' + esc(fmtCnpj(p.cnpj)) + ' · ' + esc(local) + '</div></div>' +
      '<div class="col"><span class="rot">Papel</span>' + (pp.length ? esc(pp.join(' e ')) : '<span class="peq">Não escolheu</span>') + '</div>' +
      '<div class="col"><span class="rot">Nível</span>' + esc(NIVEIS[nivelDe(p)]) +
        (Number(p.carregadores_comprados) ? '<div class="peq">' + fmtNum(p.carregadores_comprados) + ' carregadores comprados</div>' : '') + '</div>' +
      '<div class="col"><span class="rot">Status</span>' + pill(STATUS, STATUS_COR, p.status || 'novo') + '</div>' +
      '<div class="col"><span class="rot">Propostas</span>' + fmtNum(p.propostas_total) +
        (p.ultima_proposta_em ? '<div class="peq">Última em ' + esc(fmtData(p.ultima_proposta_em)) + '</div>' : '') + '</div>' +
      '</button>';
  }).join('');
}

/* ── Abas: troca e carga preguiçosa ── */
function abrirAba(qual, forcar) {
  aba = qual;
  ABAS.forEach(function (a) { $('sec-' + a[0]).classList.toggle('oculto', a[0] !== qual); });
  Array.prototype.forEach.call($('abas').querySelectorAll('button'), function (b) {
    b.setAttribute('aria-selected', b.getAttribute('data-aba') === qual ? 'true' : 'false');
  });
  if (qual === 'parceiros') return;
  var fn = { pedidos: carregarPedidos, oportunidades: carregarOportunidades, usinas: carregarUsinas, solicitacoes: carregarSolicitacoes, propostas: carregarPropostas, funil: carregarFunil, equipe: carregarEquipe }[qual];
  if (fn) fn(!!forcar);
}

// Carrega uma lista da equipe e a guarda em ST[nome]. Em 503 mostra o estado desligado; em outro erro, mensagem com nova tentativa.
function buscarLista(nome, caminho, chave, destino, desenhar, forcar) {
  if (!forcar && ST[nome]) { desenhar(); return Promise.resolve(); }
  $(destino).innerHTML = '<div class="vazio"><span class="spin"></span>Carregando</div>';
  return api('GET', caminho).then(function (x) {
    if (desligado(x)) { estadoDesligado(); return; }
    if (!okHttp(x)) {
      $(destino).innerHTML = '<div class="vazio">Não consegui carregar (' + x.status + '). <button type="button" class="btn sm" data-recarregar="' + nome + '">Tentar de novo</button></div>';
      return;
    }
    ST[nome] = arr(x.json, chave);
    desenhar();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    $(destino).innerHTML = '<div class="vazio">Sem conexão. <button type="button" class="btn sm" data-recarregar="' + nome + '">Tentar de novo</button></div>';
  });
}

function contar(idCont, n, singular, plural) { $(idCont).textContent = n === 1 ? '1 ' + singular : n + ' ' + plural; }
function vazioOuLista(destino, l, vazioMsg, filtroMsg, total) {
  if (!total) { $(destino).innerHTML = '<div class="vazio">' + esc(vazioMsg) + '</div>'; return true; }
  if (!l.length) { $(destino).innerHTML = '<div class="vazio">' + esc(filtroMsg) + '</div>'; return true; }
  return false;
}

/* ── Pedidos ── */
function carregarPedidos(f) { return buscarLista('pedidos', '/pedidos', 'pedidos', 'pd-lista', desenharPedidos, f); }
// Pedido antigo, sem a coluna tipo, é de equipamento.
function tipoDe(p) { return PEDIDO_TIPO[p.tipo] ? p.tipo : 'equipamento'; }
function projetosTxt(n) { n = Number(n); return n === 1 ? '1 projeto' : fmtNum(n) + ' projetos'; }
function carregadoresTxt(n) { n = Number(n); return n === 1 ? '1 carregador' : fmtNum(n) + ' carregadores'; }
function tipoPedidoTxt(p) {
  var t = tipoDe(p);
  if (t === 'engenharia') return Number(p.pacote) > 0 ? 'Engenharia · ' + projetosTxt(p.pacote) : 'Engenharia';
  if (t === 'manutencao') return Number(p.quantidade) > 0 ? 'Plano de manutenção · ' + carregadoresTxt(p.quantidade) : 'Plano de manutenção';
  return PEDIDO_TIPO[t];
}
function itemPedidoTxt(p) {
  var t = tipoDe(p);
  if (t === 'engenharia') return Number(p.pacote) === 1 ? 'Projeto avulso (1 projeto)' : Number(p.pacote) > 0 ? 'Pacote de ' + projetosTxt(p.pacote) : 'Pacote de engenharia';
  if (t === 'manutencao') return 'Plano de manutenção NEXUS' + (Number(p.quantidade) > 0 ? ' · ' + carregadoresTxt(p.quantidade) : '');
  if (t === 'consultoria') return 'Apoio de venda';
  return fmtNum(p.quantidade) + 'x ' + modeloTxt(p.modelo);
}
function pedidosFiltrados() {
  var st = $('pd-status').value, tp = $('pd-tipo').value, q = semAcento($('pd-busca').value.trim());
  return (ST.pedidos || []).filter(function (p) {
    if (st && p.status !== st) return false;
    if (tp && tipoDe(p) !== tp) return false;
    if (q && semAcento(empresaDe(p.user_id, p.empresa) + ' ' + tipoPedidoTxt(p) + ' ' + itemPedidoTxt(p)).indexOf(q) === -1) return false;
    return true;
  });
}
function desenharPedidos() {
  var todos = ST.pedidos; if (!todos) return;
  var l = pedidosFiltrados();
  contar('pd-contagem', l.length, 'pedido', 'pedidos');
  csvBotao('pedidos', l.length);
  if (vazioOuLista('pd-lista', l, 'Nenhum parceiro fez pedido ainda.', 'Nenhum pedido com esses filtros.', todos.length)) return;
  $('pd-lista').innerHTML = l.map(function (p) {
    return '<div class="reg" data-kind="pedido" data-id="' + esc(p.id) + '">' +
      '<div class="reg-topo"><div><div class="tit">' + esc(empresaDe(p.user_id, p.empresa) || 'Parceiro') + '</div>' +
        '<div class="peq">Pedido em ' + esc(fmtData(p.created_at, true)) +
        (p.proposta_numero ? ' · proposta ' + esc(p.proposta_numero) : '') + '</div></div>' + pill(PEDIDO_ST, PEDIDO_COR, p.status) + '</div>' +
      '<div class="kv">' + par('Tipo', esc(tipoPedidoTxt(p))) + par('Item', esc(itemPedidoTxt(p))) + '</div>' +
      (p.obs ? '<div class="peq"><b>Observação do parceiro:</b> ' + esc(p.obs) + '</div>' : '') +
      (p.confirmado_em ? '<div class="peq">Confirmado em ' + esc(fmtData(p.confirmado_em, true)) + '</div>' : '') +
      '<div class="reg-edit">' +
        '<div><label>Status</label><select data-f="status">' + opcoes(PEDIDO_ST, p.status) + '</select></div>' +
        '<div><label>Valor negociado (R$)</label><input data-f="valor" inputmode="decimal" placeholder="Ex.: 0,00" value="' + (p.valor_negociado != null ? esc(String(p.valor_negociado).replace('.', ',')) : '') + '"></div>' +
        '<div class="larga"><label>Observação da equipe</label><textarea data-f="obs_equipe" maxlength="2000">' + esc(p.obs_equipe || '') + '</textarea></div>' +
      '</div>' +
      '<div><button type="button" class="btn" data-do="salvar-pedido">Salvar pedido</button></div>' +
      '</div>';
  }).join('');
}
function numeroBR(s) {
  var t = String(s || '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!t) return null;
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isFinite(n) && n >= 0 ? n : NaN;
}

/* ── Oportunidades ── */
function carregarOportunidades(f) { return buscarLista('oportunidades', '/oportunidades', 'oportunidades', 'op-lista', desenharOportunidades, f); }
function desenharOportunidades() {
  var todos = ST.oportunidades; if (!todos) return;
  var st = $('op-status').value, q = semAcento($('op-busca').value.trim());
  var l = todos.filter(function (o) {
    if (st && o.status !== st) return false;
    if (q && semAcento([o.cidade, o.uf, empresaDe(o.parceiro_user_id, o.parceiro_empresa), o.descricao].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  contar('op-contagem', l.length, 'oportunidade', 'oportunidades');
  if (vazioOuLista('op-lista', l, 'Nenhuma oportunidade criada ainda. Use o botão Nova oportunidade.', 'Nenhuma oportunidade com esses filtros.', todos.length)) return;
  $('op-lista').innerHTML = l.map(function (o) {
    var emp = empresaDe(o.parceiro_user_id, o.parceiro_empresa);
    var ct = o.contato || {};
    var hist = Array.isArray(o.etapas) ? o.etapas : [];
    var sugAberta = SUG[o.id];
    var podeOferecer = o.status === 'rascunho' || o.status === 'recusada' || o.status === 'expirada';
    return '<div class="reg" data-kind="oportunidade" data-id="' + esc(o.id) + '">' +
      '<div class="reg-topo"><div><div class="tit">' + esc(OPORT_TIPO[o.tipo] || o.tipo) + ' em ' + esc(cidadeUf(o.cidade, o.uf)) + '</div>' +
        '<div class="peq">' + esc(o.descricao || '') + '</div></div>' + pill(OPORT_ST, OPORT_COR, o.status) + '</div>' +
      '<div class="kv">' +
        par('Parceiro', emp ? esc(emp) : 'Ainda não oferecida') +
        par('Prazo para aceitar', o.prazo_aceite ? esc(fmtData(o.prazo_aceite, true)) : 'Sem prazo') +
        par('Valor do serviço', esc(o.valor_servico || 'A combinar com o comercial')) +
        par('Contato do cliente final', (ct.nome || ct.telefone) ? esc([ct.nome, ct.telefone].filter(Boolean).join(' · ')) + '<div class="peq">O parceiro só vê depois de aceitar.</div>' : 'Não informado') +
      '</div>' +
      (hist.length ? '<ul class="etapas-hist">' + hist.map(function (h) {
        return '<li>' + esc(fmtData(h.em, true)) + ' · ' + esc(OPORT_ST[h.status] || h.status) + (h.obs ? ' · ' + esc(h.obs) : '') + '</li>';
      }).join('') + '</ul>' : '') +
      '<div class="reg-edit">' +
        '<div><label>Valor do serviço</label><input data-f="valor_servico" maxlength="200" placeholder="A combinar com o comercial" value="' + esc(o.valor_servico || '') + '"></div>' +
        '<div><label>Status</label><select data-f="status">' + opcoes(OPORT_ST, o.status) + '</select></div>' +
        (podeOferecer ? '<div><label>Prazo para o parceiro aceitar (horário de Brasília)</label><input data-f="prazo" type="datetime-local" value="' + esc(prazoDoCampo(o.prazo_aceite)) + '" data-orig="' + esc(prazoDoCampo(o.prazo_aceite)) + '"></div>' : '') +
      '</div>' +
      '<div class="pills"><button type="button" class="btn" data-do="salvar-oportunidade">Salvar</button>' +
        (podeOferecer ? '<button type="button" class="btn ghost" data-do="sugestoes">' + (sugAberta ? 'Esconder sugestões' : 'Ver sugestões de parceiros') + '</button>' : '') + '</div>' +
      (sugAberta ? '<div class="sug" id="sug-' + esc(o.id) + '">' + desenharSugestoes(o, sugAberta) + '</div>' : '') +
      '</div>';
  }).join('');
}
// Valor do campo datetime-local (horário de Brasília) para o prazo da oportunidade: o que já existe e ainda vale, ou daqui a 48 h.
function prazoDoCampo(iso) {
  var t = iso ? Date.parse(iso) : NaN;
  var d = isNaN(t) || t <= Date.now() ? new Date(Date.now() + 48 * 3600e3) : new Date(t);
  return d.toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
}
// Lê o campo de prazo do cartão. Devolve {iso, mudou} ou {erro}; sem campo no cartão devolve {iso: null}.
function prazoDoCartao(card) {
  var e = card.querySelector('[data-f="prazo"]');
  if (!e) return { iso: null, mudou: false };
  var d = e.value ? new Date(e.value + ':00-03:00') : null; // o campo é horário de Brasília
  if (!d || isNaN(d.getTime())) return { erro: 'Informe o prazo para o parceiro aceitar (data e hora).' };
  if (d.getTime() <= Date.now()) return { erro: 'O prazo para aceitar precisa ser no futuro.' };
  return { iso: d.toISOString(), mudou: e.value !== e.getAttribute('data-orig') };
}
// Selo de montagem do parceiro sugerido: o que a API manda ou, na falta, o que a lista de parceiros já carregada diz.
function temMontagem(x) {
  if (x.montagem_aprovada === true || x.montagem_aprovada_em) return true;
  if (x.montagem_aprovada === false) return false;
  var p = D && D.parceiros.filter(function (q) { return String(q.user_id) === String(x.user_id); })[0];
  return !!(p && p.montagem_aprovada_em);
}
function desenharSugestoes(o, s) {
  if (s === 'carregando') return '<div class="peq"><span class="spin"></span>Buscando parceiros da região</div>';
  if (s === 'erro') return '<div class="peq">Não consegui buscar as sugestões. Tente de novo.</div>';
  // Obra terceirizada só vai para quem tem a montagem aprovada: a API já filtra, e aqui se confere de novo.
  var obra = o.tipo === 'obra';
  if (obra) s = s.filter(temMontagem);
  if (!s.length) {
    return obra
      ? '<div class="peq">Nenhum parceiro Pro ou Master com montagem aprovada em ' + esc(o.uf || 'esta UF') + ' ainda. Obra terceirizada só vai para quem tem o selo de montagem aprovada. Aprove a montagem na ficha do parceiro.</div>'
      : '<div class="peq">Nenhum parceiro Pro ou Master em ' + esc(o.uf || 'esta UF') + ' ainda. Quando houver, aparece aqui.</div>';
  }
  return s.map(function (x) {
    var pl = x.placar || {};
    var tempo = pl.tempo_medio_resposta_h != null ? ' · responde em ' + fmtNum(Math.round(Number(pl.tempo_medio_resposta_h) * 10) / 10) + ' h' : '';
    return '<div class="sug-item"><div><b>' + esc(x.empresa || 'Parceiro') + '</b> · ' + esc(NIVEIS[x.nivel] || x.nivel || '') +
      (temMontagem(x) ? ' <span class="pill ok">Montagem aprovada</span>' : '') +
      '<div class="peq">' + esc(cidadeUf(x.cidade, x.uf)) + (x.raio_km ? ' · raio de ' + fmtNum(x.raio_km) + ' km' : '') +
      '<br>Aceitou ' + fmtNum(pl.aceitas || 0) + ', recusou ' + fmtNum(pl.recusadas || 0) + tempo + '</div></div>' +
      '<button type="button" class="btn sm" data-do="oferecer" data-user="' + esc(x.user_id) + '" data-nome="' + esc(x.empresa || 'parceiro') + '">Oferecer</button></div>';
  }).join('');
}

function abrirNovaOportunidade() {
  var box = $('op-nova');
  if (!box.classList.contains('oculto')) { box.classList.add('oculto'); return; }
  var prazo = new Date(Date.now() + 48 * 3600e3).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
  box.innerHTML = '<h2>Nova oportunidade</h2><p class="sub">Fica como rascunho até você oferecer a um parceiro Pro ou Master. Obra terceirizada só vai para parceiro com montagem aprovada. O contato do cliente final só aparece para o parceiro depois que ele aceitar.</p>' +
    '<div class="novo-form"><div class="grade2">' +
      '<div><label for="n-tipo">Tipo</label><select id="n-tipo"><option value="cliente">Cliente final</option><option value="obra">Obra terceirizada</option></select></div>' +
      '<div><label for="n-cidade">Cidade</label><input id="n-cidade" maxlength="80"></div>' +
      '<div><label for="n-uf">UF</label><select id="n-uf"><option value="">Escolha</option>' + UFS.map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="n-prazo">Prazo para o parceiro aceitar (horário de Brasília)</label><input id="n-prazo" type="datetime-local" value="' + prazo + '"></div>' +
      '<div class="larga"><label for="n-desc">Descrição</label><textarea id="n-desc" maxlength="1500" placeholder="O que o cliente quer, local, potência, prazo"></textarea></div>' +
      '<div><label for="n-valor">Valor do serviço</label><input id="n-valor" maxlength="200" placeholder="A combinar com o comercial"></div>' +
      '<div><label for="n-ref">Código do card da agenda (opcional)</label><input id="n-ref" maxlength="80"></div>' +
      '<div><label for="n-cnome">Nome do cliente final</label><input id="n-cnome" maxlength="120"></div>' +
      '<div><label for="n-ctel">Telefone do cliente final</label><input id="n-ctel" maxlength="30" inputmode="tel"></div>' +
    '</div><div class="pills"><button type="button" class="btn" data-do="criar-oportunidade">Criar como rascunho</button>' +
    '<button type="button" class="btn ghost" onclick="abrirNovaOportunidade()">Cancelar</button></div></div>';
  box.classList.remove('oculto');
  $('n-cidade').focus();
}
function criarOportunidade(btn) {
  var corpo = {
    tipo: $('n-tipo').value, cidade: $('n-cidade').value.trim(), uf: $('n-uf').value,
    descricao: $('n-desc').value.trim()
  };
  if (!corpo.cidade || !corpo.uf) { toast('Informe a cidade e a UF.'); return; }
  if (!corpo.descricao) { toast('Escreva a descrição da oportunidade.'); return; }
  var pz = $('n-prazo').value;
  var prazo = pz ? new Date(pz + ':00-03:00') : null; // o campo é horário de Brasília
  if (!prazo || isNaN(prazo.getTime())) { toast('Informe o prazo para o parceiro aceitar.'); return; }
  if (prazo.getTime() <= Date.now()) { toast('O prazo precisa ser no futuro.'); return; }
  corpo.prazo_aceite = prazo.toISOString();
  var v = $('n-valor').value.trim(); if (v) corpo.valor_servico = v;
  var ref = $('n-ref').value.trim(); if (ref) corpo.origem_ref = ref;
  var cn = $('n-cnome').value.trim(), ct = $('n-ctel').value.trim();
  if (cn || ct) corpo.contato = { nome: cn, telefone: ct };
  salvar(btn, 'POST', '/oportunidades', corpo, 'Oportunidade criada como rascunho.', function () { $('op-nova').classList.add('oculto'); });
}
function buscarSugestoes(id) {
  if (SUG[id] && SUG[id] !== 'erro') { delete SUG[id]; desenharOportunidades(); return; }
  SUG[id] = 'carregando';
  desenharOportunidades();
  api('GET', '/oportunidades/' + encodeURIComponent(id) + '/sugestoes').then(function (x) {
    if (desligado(x)) { estadoDesligado(); return; }
    SUG[id] = okHttp(x) ? arr(x.json, 'sugestoes') : 'erro';
    desenharOportunidades();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    SUG[id] = 'erro'; desenharOportunidades();
  });
}

/* ── Usinas ── */
function carregarUsinas(f) { return buscarLista('usinas', '/usinas', 'usinas', 'us-lista', desenharUsinas, f); }
function desenharUsinas() {
  var todos = ST.usinas; if (!todos) return;
  var st = $('us-status').value, q = semAcento($('us-busca').value.trim());
  var l = todos.filter(function (u) {
    if (st && u.status !== st) return false;
    if (q && semAcento([empresaDe(u.user_id, u.empresa), u.dono_nome, u.cidade, u.uf, u.distribuidora].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  contar('us-contagem', l.length, 'usina', 'usinas');
  if (vazioOuLista('us-lista', l, 'Nenhum parceiro indicou usina ainda.', 'Nenhuma usina com esses filtros.', todos.length)) return;
  $('us-lista').innerHTML = l.map(function (u) {
    var msg = 'Oi, tudo bem?\nAqui é da NEXUS Eletropostos.\nRecebemos a indicação da sua usina' + (u.cidade ? ' em ' + u.cidade : '') + ' pelo Portal do Parceiro.\nPodemos conversar?';
    return '<div class="reg" data-kind="usina" data-id="' + esc(u.id) + '">' +
      '<div class="reg-topo"><div><div class="tit">' + esc(u.dono_nome || 'Dono sem nome') + ' · ' + esc(cidadeUf(u.cidade, u.uf)) + '</div>' +
        '<div class="peq">Indicada por ' + esc(empresaDe(u.user_id, u.empresa) || 'parceiro') + ' em ' + esc(fmtData(u.created_at)) + '</div></div>' +
        pill(USINA_ST, USINA_COR, u.status) + '</div>' +
      '<div class="kv">' +
        par('Distribuidora', esc(u.distribuidora || 'Não informada')) +
        par('Interesse', esc(USINA_INT[u.interesse] || u.interesse || 'Não informado')) +
        par('Potência', u.potencia_kwp != null ? esc(fmtNum(u.potencia_kwp)) + ' kWp' : 'Não informada') +
        par('Geração por mês', u.geracao_kwh_mes != null ? esc(fmtNum(u.geracao_kwh_mes)) + ' kWh' : 'Não informada') +
        par('Disponível por mês', u.disponivel_kwh_mes != null ? esc(fmtNum(u.disponivel_kwh_mes)) + ' kWh' : 'Não informado') +
        par('WhatsApp do dono', esc(u.whatsapp || 'Não informado')) +
      '</div>' + (u.obs ? '<div class="peq"><b>Observação do parceiro:</b> ' + esc(u.obs) + '</div>' : '') +
      '<div class="reg-edit">' +
        '<div><label>Status</label><select data-f="status">' + opcoes(USINA_ST, u.status) + '</select></div>' +
        '<div class="larga"><label>Observação da equipe</label><textarea data-f="obs_equipe" maxlength="2000">' + esc(u.obs_equipe || '') + '</textarea></div>' +
      '</div>' +
      '<div class="pills"><button type="button" class="btn" data-do="salvar-usina">Salvar usina</button>' + linkWpp(u.whatsapp, msg, 'Abrir WhatsApp do dono') + '</div>' +
      '</div>';
  }).join('');
}

/* ── Solicitações ── */
function carregarSolicitacoes(f) { return buscarLista('solicitacoes', '/solicitacoes', 'solicitacoes', 'so-lista', desenharSolicitacoes, f); }
var DADOS_ROT = { usa_pacote: 'Usa o pacote de engenharia', servico: 'Serviço', tipo_servico: 'Serviço', cidade: 'Cidade', uf: 'UF', potencia: 'Potência', potencia_kw: 'Potência (kW)', descricao: 'Descrição', obs: 'Observação', modelo: 'Modelo', quantidade: 'Quantidade', mensagem: 'Mensagem' };
function dadosHtml(d) {
  if (!d || typeof d !== 'object') return '';
  var ks = Object.keys(d).filter(function (k) { return d[k] != null && d[k] !== ''; }).slice(0, 12);
  if (!ks.length) return '';
  return '<div class="kv">' + ks.map(function (k) {
    var v = typeof d[k] === 'boolean' ? (d[k] ? 'Sim' : 'Não') : typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]);
    return par(DADOS_ROT[k] || k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }), esc(v.slice(0, 500)));
  }).join('') + '</div>';
}
function desenharSolicitacoes() {
  var todos = ST.solicitacoes; if (!todos) return;
  var st = $('so-status').value, tp = $('so-tipo').value;
  var l = todos.filter(function (s) { return (!st || s.status === st) && (!tp || s.tipo === tp); });
  contar('so-contagem', l.length, 'solicitação', 'solicitações');
  if (vazioOuLista('so-lista', l, 'Nenhuma solicitação ainda.', 'Nenhuma solicitação com esses filtros.', todos.length)) return;
  $('so-lista').innerHTML = l.map(function (s) {
    var emp = empresaDe(s.user_id, s.empresa);
    var par0 = D && D.parceiros.filter(function (p) { return String(p.user_id) === String(s.user_id); })[0];
    var msg = 'Oi, tudo bem?\nAqui é da NEXUS Eletropostos.\nRecebemos o seu pedido no Portal do Parceiro e vamos te ajudar.';
    return '<div class="reg" data-kind="solicitacao" data-id="' + esc(s.id) + '">' +
      '<div class="reg-topo"><div><div class="tit">' + esc(SOL_TIPO[s.tipo] || s.tipo) + ' · ' + esc(emp || 'Parceiro') + '</div>' +
        '<div class="peq">Pedido em ' + esc(fmtData(s.created_at, true)) + '</div></div>' + pill(SOL_ST, SOL_COR, s.status) + '</div>' +
      dadosHtml(s.dados) +
      '<div class="reg-edit">' +
        '<div><label>Status</label><select data-f="status">' + opcoes(SOL_ST, s.status) + '</select></div>' +
        '<div class="larga"><label>Observação da equipe</label><textarea data-f="obs_equipe" maxlength="2000">' + esc(s.obs_equipe || '') + '</textarea></div>' +
      '</div>' +
      '<div class="pills"><button type="button" class="btn" data-do="salvar-solicitacao">Salvar solicitação</button>' +
        (par0 ? linkWpp(par0.whatsapp, msg, 'Abrir WhatsApp do parceiro') : '') + '</div>' +
      '</div>';
  }).join('');
}

/* ── Propostas de todos os parceiros ── */
function desdeISO(dias) {
  if (!dias) return '';
  var d = new Date(Date.now() - dias * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // AAAA-MM-DD em Brasília
}
function carregarPropostas(forcar) {
  var d = Number($('p-desde').value);
  if (!forcar && ST.propostas && PROPS_DESDE === d) { desenharPropostas(); return Promise.resolve(); }
  $('p-lista').innerHTML = '<div class="vazio"><span class="spin"></span>Carregando as propostas</div>';
  var desde = desdeISO(d);
  return api('GET', '/propostas' + (desde ? '?desde=' + encodeURIComponent(desde) : '')).then(function (x) {
    if (desligado(x)) { estadoDesligado(); return; }
    if (!okHttp(x)) {
      $('p-lista').innerHTML = '<div class="vazio">Não consegui carregar as propostas (' + x.status + '). <button type="button" class="btn sm" data-recarregar="propostas">Tentar de novo</button></div>';
      return;
    }
    ST.propostas = arr(x.json, 'propostas');
    PROPS_DESDE = d;
    desenharPropostas();
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    $('p-lista').innerHTML = '<div class="vazio">Sem conexão. <button type="button" class="btn sm" data-recarregar="propostas">Tentar de novo</button></div>';
  });
}
function modeloTxt(m) { return MODELOS[m] || m || 'Sem modelo'; }
var SAIDAS = { simulador: 'Simulador', basico: 'Orçamento Básico', completo: 'Orçamento Completo' };
// Aberturas do link da proposta. Campo que a API não mandou vira "Sem dado", nunca zero inventado.
function linkPlano(x) {
  if (x.aberturas == null || !isFinite(Number(x.aberturas))) return 'Sem dado';
  var n = Number(x.aberturas);
  if (n <= 0) return 'Ainda não aberta';
  return 'Aberta ' + (n === 1 ? '1 vez' : fmtNum(n) + ' vezes') + (x.ultima_abertura_em ? ' · última em ' + fmtData(x.ultima_abertura_em, true) : '');
}
function linkTxt(x) {
  var n = Number(x.aberturas);
  if (x.aberturas == null || !isFinite(n)) return '<span class="peq">Sem dado</span>';
  if (n <= 0) return 'Ainda não aberta';
  return 'Aberta ' + (n === 1 ? '1 vez' : fmtNum(n) + ' vezes') +
    (x.ultima_abertura_em ? '<div class="peq">Última em ' + esc(fmtData(x.ultima_abertura_em, true)) + '</div>' : '');
}
function propostasFiltradas() {
  var q = semAcento($('p-busca').value.trim());
  return (ST.propostas || []).filter(function (p) {
    if (!q) return true;
    return semAcento([p.empresa, p.cliente_nome, p.cliente_cidade, p.cliente_uf, p.numero].join(' ')).indexOf(q) !== -1;
  });
}
function desenharPropostas() {
  var todos = ST.propostas; if (!todos) return;
  var l = propostasFiltradas();
  contar('p-contagem', l.length, 'proposta', 'propostas');
  csvBotao('propostas', l.length);
  if (!todos.length) { $('p-lista').innerHTML = '<div class="vazio">Nenhuma proposta neste período.</div>'; return; }
  if (!l.length) { $('p-lista').innerHTML = '<div class="vazio">Nenhuma proposta com esses filtros.</div>'; return; }
  $('p-lista').innerHTML = '<div class="prop-cab"><div>Data</div><div>Empresa</div><div>Cliente</div><div>Modelo</div><div>Valor</div><div>Saída</div><div>Link</div></div>' +
    '<div class="lista">' + l.map(function (p) {
      var local = cidadeUf(p.cliente_cidade, p.cliente_uf);
      return '<div class="prop-lin">' +
        '<div><span class="rot">Data</span>' + esc(fmtData(p.created_at)) + '<div class="peq">N° ' + esc(p.numero) + '</div></div>' +
        '<div><span class="rot">Empresa</span><b>' + esc(p.empresa || 'Sem nome') + '</b><div class="peq">' + esc(cidadeUf(p.cidade_parceiro, p.uf_parceiro)) + '</div></div>' +
        '<div><span class="rot">Cliente</span>' + esc(p.cliente_nome || 'Sem nome') + '<div class="peq">' + esc(local) + '</div></div>' +
        '<div><span class="rot">Modelo</span>' + esc(fmtNum(p.quantidade) + 'x ' + modeloTxt(p.modelo)) + '</div>' +
        '<div><span class="rot">Valor</span>' + esc(fmtReal(p.valor_total)) + '</div>' +
        '<div><span class="rot">Saída</span>' + esc(SAIDAS[p.saida_ultima] || 'Sem saída') + '</div>' +
        '<div class="larga"><span class="rot">Link</span>' + linkTxt(p) + '</div>' +
        '</div>';
    }).join('') + '</div>';
}

/* ── Funil (só no ADM): cadastros até Master, por período, origem e UF ── */
var FUNIL_DESDE = null;  // período (em dias) em que ST.funil foi carregado
var FUNIL_REQ = 0;       // descarta resposta atrasada quando o período muda no meio da carga
function fmtPct(r) {
  var n = Math.round(r * 1000) / 10;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
}
function carregarFunil(forcar) {
  var campo = $('fn-desde');
  if (!campo) return Promise.resolve();
  var d = Number(campo.value);
  if (!forcar && ST.funil && FUNIL_DESDE === d) { desenharFunil(); return Promise.resolve(); }
  var req = ++FUNIL_REQ;
  $('fn-corpo').innerHTML = '<div class="vazio"><span class="spin"></span>Carregando o funil</div>';
  var desde = desdeISO(d);
  return api('GET', '/funil' + (desde ? '?desde=' + encodeURIComponent(desde) : '')).then(function (x) {
    if (req !== FUNIL_REQ) return;
    if (desligado(x)) { estadoDesligado(); return; }
    if (!okHttp(x)) {
      $('fn-corpo').innerHTML = '<div class="vazio">Não consegui carregar o funil (' + esc(x.status) + '). <button type="button" class="btn sm" data-recarregar="funil">Tentar de novo</button></div>';
      return;
    }
    ST.funil = x.json;
    FUNIL_DESDE = d;
    desenharFunil();
  }).catch(function (e) {
    if (req !== FUNIL_REQ || (e && e.tipo === 'login')) return;
    $('fn-corpo').innerHTML = '<div class="vazio">Sem conexão. <button type="button" class="btn sm" data-recarregar="funil">Tentar de novo</button></div>';
  });
}
// Funil em SVG: uma barra por etapa, centralizada e proporcional à primeira etapa; embaixo, a taxa sobre a etapa anterior.
function funilSvg(etapas) {
  var base = Number(etapas[0] && etapas[0].total) || 0;
  var anterior = 0;
  return '<div class="funil">' + etapas.map(function (e, i) {
    var t = Number(e.total) || 0;
    var rotulo = e.rotulo || e.chave || 'Etapa';
    var taxa = i === 0 ? 'Base do funil' : (anterior > 0 ? fmtPct(t / anterior) + ' da etapa anterior' : 'Sem base');
    var w = base > 0 ? Math.min(100, Math.max(t > 0 ? 1.5 : 0, (t / base) * 100)) : 0;
    anterior = t;
    var x = Math.round(((100 - w) / 2) * 100) / 100;
    w = Math.round(w * 100) / 100;
    return '<div class="fn-lin"><span class="t">' + esc(rotulo) + '</span><span class="q">' + esc(fmtNum(t)) + '</span>' +
      '<svg viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="' + esc(rotulo + ': ' + fmtNum(t) + '. ' + taxa) + '">' +
      '<rect class="fundo" x="0" y="0" width="100" height="12"></rect>' +
      '<rect class="barra" x="' + x + '" y="0" width="' + w + '" height="12"></rect></svg>' +
      '<span class="tx">' + esc(taxa) + '</span></div>';
  }).join('') + '</div>';
}
function tabelaFunil(titulo, sub, colRot, linhas, rotuloDe) {
  var tot = { cadastros: 0, propostas: 0, compras: 0 };
  linhas.forEach(function (l) { tot.cadastros += Number(l.cadastros) || 0; tot.propostas += Number(l.propostas) || 0; tot.compras += Number(l.compras) || 0; });
  var h = '<div class="card"><h2>' + esc(titulo) + '</h2><p class="sub">' + esc(sub) + '</p>';
  if (!linhas.length) return h + '<div class="vazio">Sem dados neste período.</div></div>';
  h += '<div class="tab-rola"><table class="tab"><thead><tr><th scope="col">' + esc(colRot) + '</th><th scope="col" class="n">Cadastros</th><th scope="col" class="n">Propostas</th><th scope="col" class="n">Compras</th></tr></thead><tbody>' +
    linhas.map(function (l) {
      return '<tr><th scope="row">' + esc(rotuloDe(l)) + '</th><td class="n">' + esc(fmtNum(l.cadastros)) + '</td><td class="n">' + esc(fmtNum(l.propostas)) + '</td><td class="n">' + esc(fmtNum(l.compras)) + '</td></tr>';
    }).join('') +
    '</tbody><tfoot><tr><th scope="row">Total</th><td class="n">' + esc(fmtNum(tot.cadastros)) + '</td><td class="n">' + esc(fmtNum(tot.propostas)) + '</td><td class="n">' + esc(fmtNum(tot.compras)) + '</td></tr></tfoot></table></div></div>';
  return h;
}
function desenharFunil() {
  var f = ST.funil; if (!f) return;
  var etapas = Array.isArray(f.etapas) ? f.etapas : [];
  var porOrigem = (Array.isArray(f.por_origem) ? f.por_origem : []).slice().sort(function (a, b) { return (Number(b.cadastros) || 0) - (Number(a.cadastros) || 0); });
  var porUf = (Array.isArray(f.por_uf) ? f.por_uf : []).slice().sort(function (a, b) { return (Number(b.cadastros) || 0) - (Number(a.cadastros) || 0); });
  var h = '<div class="card"><h2>Do cadastro ao Master</h2><p class="sub">Cada barra é o total de parceiros na etapa, em proporção aos cadastros. Embaixo, a taxa sobre a etapa anterior.</p>' +
    (etapas.length ? funilSvg(etapas) : '<div class="vazio">Sem dados neste período.</div>') + '</div>';
  h += tabelaFunil('Por origem do cadastro', 'De onde vieram os parceiros do período.', 'Origem', porOrigem, function (l) { return ORIGENS[l.origem] || l.origem || 'Sem origem'; });
  h += tabelaFunil('Por UF', 'Estado informado no perfil. Quem ainda não completou o perfil aparece sem UF.', 'UF', porUf, function (l) { return l.uf ? String(l.uf).toUpperCase() : 'Sem UF'; });
  $('fn-corpo').innerHTML = h;
}

/* ── Equipe (só no ADM): quem tem acesso ao painel ── */
var PAPEL_EQUIPE = { admin: 'Administrador', socio: 'Sócio' };
function souEu(email) { return !!(EU && EU.email && String(email || '').toLowerCase() === String(EU.email).toLowerCase()); }
function carregarEquipe(f) { return buscarLista('equipe', '/membros', 'membros', 'eq-lista', desenharEquipe, f); }
function desenharEquipe() {
  var todos = ST.equipe; if (!todos) return;
  var gere = !!(EU && EU.gerirEquipe);
  var form = $('eq-form');
  if (form && !form.firstChild) {
    form.innerHTML = gere
      ? '<div class="card"><h2>Dar acesso ao painel</h2><p class="sub">A pessoa entra com o e-mail e a senha do SolarDoc. O acesso vale assim que você adiciona.</p>' +
        '<div class="grade2"><div><label for="eq-email">E-mail da pessoa</label><input id="eq-email" type="email" autocomplete="off" inputmode="email" maxlength="160" placeholder="nome@empresa.com.br"></div>' +
        '<div><label for="eq-papel">Papel</label><select id="eq-papel"><option value="admin">Administrador</option><option value="socio">Sócio</option></select></div></div>' +
        '<p class="peq" style="margin:10px 0 12px">Sócio também dispara o convite por e-mail e gerencia a equipe. Administrador vê e opera o painel.</p>' +
        '<button type="button" class="btn" data-eq="adicionar">Adicionar acesso</button></div>'
      : '<div class="card"><h2>Equipe com acesso</h2><span class="trava">' + ICONE_CADEADO + 'Só sócio ou administrador do SolarDoc gerencia a equipe</span></div>';
  }
  contar('eq-contagem', todos.length, 'pessoa com acesso', 'pessoas com acesso');
  if (!todos.length) { $('eq-lista').innerHTML = '<div class="vazio">Nenhum e-mail cadastrado na equipe ainda. Contas de administrador do SolarDoc entram sem estar nesta lista.</div>'; return; }
  $('eq-lista').innerHTML = todos.map(function (m) {
    var eu = souEu(m.email);
    var quem = m.criado_por ? ' por ' + m.criado_por : '';
    var acao = '';
    if (gere) {
      if (eu) acao = '<p class="peq">Este é o seu acesso. Ninguém desativa o próprio acesso.</p>';
      else if (m.ativo) acao = '<div><button type="button" class="btn ghost sm" data-eq="desativar" data-id="' + esc(m.id) + '" data-email="' + esc(m.email) + '">Desativar</button></div>';
      else acao = '<div><button type="button" class="btn ghost sm" data-eq="reativar" data-id="' + esc(m.id) + '" data-email="' + esc(m.email) + '">Reativar</button></div>';
    }
    return '<div class="reg" data-eq-id="' + esc(m.id) + '"><div class="reg-topo"><div><div class="tit">' + esc(m.email) + (eu ? ' (você)' : '') + '</div>' +
      '<div class="peq">Adicionado em ' + esc(fmtData(m.created_at)) + esc(quem) + '</div></div>' +
      '<div class="pills"><span class="pill az">' + esc(PAPEL_EQUIPE[m.papel] || m.papel || 'Sem papel') + '</span>' +
      '<span class="pill ' + (m.ativo ? 'ok' : '') + '">' + (m.ativo ? 'Ativo' : 'Desativado') + '</span></div></div>' + acao + '</div>';
  }).join('');
}
function acaoEquipe(botao) {
  var a = botao.getAttribute('data-eq');
  if (a === 'adicionar') {
    var email = String($('eq-email').value || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Informe um e-mail válido.'); $('eq-email').focus(); return; }
    salvar(botao, 'POST', '/membros', { email: email, papel: $('eq-papel').value }, 'Acesso adicionado.', function () { $('eq-email').value = ''; });
    return;
  }
  var id = botao.getAttribute('data-id'), email2 = botao.getAttribute('data-email') || 'esta pessoa';
  if (a === 'desativar') {
    if (!window.confirm('Desativar o acesso de ' + email2 + ' ao painel?')) return;
    salvar(botao, 'PATCH', '/membros/' + encodeURIComponent(id), { ativo: false }, 'Acesso desativado.');
  } else if (a === 'reativar') {
    salvar(botao, 'PATCH', '/membros/' + encodeURIComponent(id), { ativo: true }, 'Acesso reativado.');
  }
}

/* ── Exportar CSV: ponto e vírgula, UTF-8 com BOM (abre certo no Excel), datas em Brasília ── */
function csvCelula(v) {
  if (v == null) return '';
  var t = typeof v === 'number' ? (isFinite(v) ? String(v).replace('.', ',') : '') : String(v);
  // Texto que começa com = + - @ vira fórmula na planilha: o apóstrofo segura (nome de empresa vem do cadastro de terceiros).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  if (/[";\r\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
  return t;
}
function baixarCsv(prefixo, cabecalho, linhas) {
  var txt = '﻿' + [cabecalho].concat(linhas).map(function (l) { return l.map(csvCelula).join(';'); }).join('\r\n') + '\r\n';
  var hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  var url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  var a = document.createElement('a');
  a.href = url; a.download = 'nexus-' + prefixo + '-' + hoje + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  toast('CSV exportado: ' + linhas.length + (linhas.length === 1 ? ' linha.' : ' linhas.'));
}
function csvBotao(qual, n) { var b = $('csv-' + qual); if (b) b.disabled = !n; }
function numCsv(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? '' : n; }
function exportarCsv(qual) {
  if (qual === 'parceiros' && D) {
    baixarCsv('parceiros', ['Cadastro', 'Empresa', 'CNPJ', 'Cidade', 'UF', 'WhatsApp', 'Papéis', 'Nível', 'Status', 'Origem', 'Carregadores comprados', 'Propostas', 'Propostas em 30 dias', 'Pedidos', 'Última proposta', 'Perfil completo', 'Partner desde', 'Montagem aprovada em'],
      filtrados().map(function (p) {
        return [fmtData(p.created_at, true), p.empresa || '', fmtCnpj(p.cnpj), p.cidade || '', p.uf || '', p.whatsapp || '', papeis(p).join(' e '), NIVEIS[nivelDe(p)], STATUS[p.status || 'novo'] || p.status || '',
          ORIGENS[p.origem] || p.origem || '', numCsv(p.carregadores_comprados), numCsv(p.propostas_total), numCsv(p.propostas_30d), numCsv(p.pedidos_total),
          fmtData(p.ultima_proposta_em, true), fmtData(p.perfil_completo_em, true), fmtData(p.partner_em, true), fmtData(p.montagem_aprovada_em, true)];
      }));
  } else if (qual === 'pedidos' && ST.pedidos) {
    baixarCsv('pedidos', ['Data', 'Empresa', 'Tipo', 'Item', 'Status', 'Valor negociado', 'Confirmado em', 'Proposta', 'Observação do parceiro', 'Observação da equipe'],
      pedidosFiltrados().map(function (p) {
        return [fmtData(p.created_at, true), empresaDe(p.user_id, p.empresa), tipoPedidoTxt(p), itemPedidoTxt(p), PEDIDO_ST[p.status] || p.status || '', numCsv(p.valor_negociado),
          fmtData(p.confirmado_em, true), p.proposta_numero || '', p.obs || '', p.obs_equipe || ''];
      }));
  } else if (qual === 'propostas' && ST.propostas) {
    baixarCsv('propostas', ['Data', 'Número', 'Empresa', 'Cidade do parceiro', 'UF do parceiro', 'Cliente', 'Cidade do cliente', 'UF do cliente', 'Modelo', 'Quantidade', 'Valor total', 'Saída', 'Aberturas do link', 'Última abertura'],
      propostasFiltradas().map(function (p) {
        return [fmtData(p.created_at, true), p.numero || '', p.empresa || '', p.cidade_parceiro || '', p.uf_parceiro || '', p.cliente_nome || '', p.cliente_cidade || '', p.cliente_uf || '',
          modeloTxt(p.modelo), numCsv(p.quantidade), numCsv(p.valor_total), SAIDAS[p.saida_ultima] || '', numCsv(p.aberturas), fmtData(p.ultima_abertura_em, true)];
      }));
  }
}

/* ── Salvar com feedback ── */
// A API responde {erro: 'codigo'}; aqui cada código vira texto em português. Código novo cai no texto genérico.
var ERROS = {
  prazo_invalido: 'O prazo para aceitar precisa ser uma data e hora válidas, no futuro.',
  status_invalido: 'Esse status não vale para este registro.',
  oportunidade_em_andamento: 'Esta oportunidade está em andamento com um parceiro. Só dá para trocar o parceiro quando ela estiver em rascunho, recusada ou expirada.',
  parceiro_obrigatorio: 'Escolha o parceiro antes de oferecer.',
  parceiro_invalido: 'Parceiro não encontrado.',
  parceiro_sem_nivel: 'Esse parceiro ainda não é Pro: só quem já fez a primeira compra de carregador recebe oportunidades.',
  sem_termo_aceito: 'Este parceiro ainda não aceitou o Termo de Parceria.',
  sem_saldo: 'O parceiro não tem projeto disponível no pacote.',
  servico_em_ativacao: 'Este serviço está sendo ativado. Tente de novo em instantes ou fale com o comercial.',
  sem_montagem_aprovada: 'Este parceiro não tem a montagem aprovada, e obra terceirizada só vai para quem tem. Aprove a montagem na ficha do parceiro ou escolha outro.',
  descricao_obrigatoria: 'Escreva a descrição da oportunidade.',
  contato_invalido: 'O contato do cliente final está inválido. Confira o nome e o telefone.',
  cidade_obrigatoria: 'Informe a cidade.',
  uf_invalida: 'UF inválida.',
  tipo_invalido: 'Tipo inválido.',
  valor_invalido: 'Valor inválido. Use só números, por exemplo 0,00.',
  nada_para_mudar: 'Nada para salvar: nenhum campo mudou.',
  nao_encontrada: 'Registro não encontrado. Recarregue a lista.',
  nao_encontrado: 'Registro não encontrado. Recarregue a lista.',
  portal_desligado: 'O portal está desligado.',
  erro_interno: 'Erro no servidor. Tente de novo em instantes.',
  // Equipe (api/src/routes/geradorNexusEquipe.ts)
  sem_permissao: 'Só sócio ou administrador do SolarDoc gerencia a equipe.',
  nao_pode_desativar_a_si_mesmo: 'Você não pode tirar o seu próprio acesso.',
  nao_pode_mudar_o_proprio_papel: 'Você não pode mudar o seu próprio papel.',
  equipe_sem_tabela: 'A lista da equipe ainda não existe no banco: falta rodar o MIGRATION_nexus_portal.sql.',
  sem_conta: 'Este e-mail ainda não tem conta. Peça para a pessoa criar a conta em solardoc.app/nexus/cadastro e libere depois.',
  email_invalido: 'Confira o e-mail digitado.',
  sem_acesso_adm: 'Sem acesso ao ADM.'
};
function textoDoErro(x) {
  var cod = x.json && x.json.erro;
  if (cod && ERROS[cod]) return ERROS[cod];
  // Qualquer 400 de validação ao adicionar membro da equipe vira o aviso do e-mail.
  if (x.status === 400 && x.caminho === '/membros') return ERROS.email_invalido;
  if (x.status === 503) return 'O portal está desligado.';
  if (x.status === 403) return 'Sem permissão para esta ação.';
  return 'Não consegui salvar (' + x.status + '). Confira os campos e tente de novo.';
}
function salvar(botao, metodo, caminho, corpo, ok, depois) {
  var rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  api(metodo, caminho, corpo).then(function (x) {
    if (x.status >= 200 && x.status < 300) {
      toast(ok);
      if (depois) depois(x);
      // Totais, nível e trilha são calculados no servidor: recarrega tudo, inclusive a aba aberta.
      return carregar(true);
    }
    x.caminho = caminho;
    toast(textoDoErro(x));
    botao.disabled = false; botao.textContent = rotulo;
  }).catch(function (e) {
    if (e && e.tipo === 'login') return;
    toast('Sem conexão. Nada foi salvo.');
    botao.disabled = false; botao.textContent = rotulo;
  });
}
function campo(card, nome) { var e = card.querySelector('[data-f="' + nome + '"]'); return e ? e.value : ''; }

function acaoRegistro(botao) {
  var card = botao.closest('[data-kind]');
  if (!card) return;
  var id = card.getAttribute('data-id');
  var enc = encodeURIComponent(id);
  var fazer = botao.getAttribute('data-do');
  if (fazer === 'salvar-pedido') {
    var v = numeroBR(campo(card, 'valor'));
    if (v !== null && isNaN(v)) { toast('Valor negociado inválido. Use só números, por exemplo 0,00.'); return; }
    var corpo = { status: campo(card, 'status'), obs_equipe: campo(card, 'obs_equipe') };
    if (v !== null) corpo.valor_negociado = v;
    var ped = (ST.pedidos || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var tipoPed = ped ? tipoDe(ped) : 'equipamento';
    var okPed = 'Pedido salvo.';
    if (corpo.status === 'confirmado' && tipoPed === 'equipamento') okPed = 'Pedido salvo. Carregadores comprados recalculados.';
    else if (corpo.status === 'confirmado' && tipoPed === 'engenharia') okPed = 'Pedido salvo. Saldo de engenharia do parceiro atualizado.';
    salvar(botao, 'PATCH', '/pedidos/' + enc, corpo, okPed);
  } else if (fazer === 'salvar-oportunidade') {
    var corpoOp = { status: campo(card, 'status'), valor_servico: campo(card, 'valor_servico') };
    var pzOp = prazoDoCartao(card);
    if (pzOp.erro) {
      // Prazo inválido só atrapalha quando vai ser usado: ao oferecer.
      if (corpoOp.status === 'oferecida') { toast(pzOp.erro); return; }
    } else if (pzOp.iso && (pzOp.mudou || corpoOp.status === 'oferecida')) {
      corpoOp.prazo_aceite = pzOp.iso;
    }
    salvar(botao, 'PATCH', '/oportunidades/' + enc, corpoOp, 'Oportunidade salva.');
  } else if (fazer === 'sugestoes') {
    buscarSugestoes(id);
  } else if (fazer === 'oferecer') {
    var nome = botao.getAttribute('data-nome');
    if (!window.confirm('Oferecer esta oportunidade para ' + nome + '? Ele passa a ver no portal e tem até o prazo do cartão para aceitar.')) return;
    var pzOf = prazoDoCartao(card);
    if (pzOf.erro) { toast(pzOf.erro); return; }
    var corpoOf = { parceiro_user_id: botao.getAttribute('data-user'), status: 'oferecida' };
    if (pzOf.iso) corpoOf.prazo_aceite = pzOf.iso;
    salvar(botao, 'PATCH', '/oportunidades/' + enc, corpoOf, 'Oportunidade oferecida a ' + nome + '.');
  } else if (fazer === 'salvar-usina') {
    salvar(botao, 'PATCH', '/usinas/' + enc, { status: campo(card, 'status'), obs_equipe: campo(card, 'obs_equipe') }, 'Usina salva.');
  } else if (fazer === 'salvar-solicitacao') {
    salvar(botao, 'PATCH', '/solicitacoes/' + enc, { status: campo(card, 'status'), obs_equipe: campo(card, 'obs_equipe') }, 'Solicitação salva.');
  }
}

/* ── Ficha do parceiro ── */
function achar(id) {
  if (!D) return null;
  for (var i = 0; i < D.parceiros.length; i++) if (String(D.parceiros[i].id) === String(id)) return D.parceiros[i];
  return null;
}
function abrirFicha(id) {
  fichaId = id;
  foco = document.activeElement;
  $('fundo-ficha').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  desenharFicha();
  $('ficha').scrollTop = 0;
  var fx = $('ficha').querySelector('.fx');
  if (fx) fx.focus();
  // As propostas do parceiro vêm da lista geral, de todo o período, carregada uma vez por carga da página.
  if (PROPS_ALL) desenharFichaPropostas();
  else carregarPropostasDaFicha();
}
function carregarPropostasDaFicha() {
  return api('GET', '/propostas?desde=2020-01-01').then(function (x) {
    var box = $('fa-props');
    if (okHttp(x)) {
      PROPS_ALL = arr(x.json, 'propostas');
      desenharFichaPropostas();
    } else if (box) {
      box.innerHTML = '<div class="item">Não consegui carregar as propostas (' + x.status + ').</div>';
    }
  }).catch(function (e) {
    var box = $('fa-props');
    if (box && !(e && e.tipo === 'login')) box.innerHTML = '<div class="item">Sem conexão para carregar as propostas.</div>';
  });
}
function fecharFicha() {
  fichaId = null;
  $('fundo-ficha').classList.add('oculto');
  document.body.style.overflow = '';
  if (foco && foco.focus) { try { foco.focus(); } catch (e) {} }
}
function propostasDe(p) {
  if (!PROPS_ALL) return null;
  return PROPS_ALL.filter(function (x) {
    if (x.user_id && p.user_id) return String(x.user_id) === String(p.user_id);
    if (x.parceiro_id) return String(x.parceiro_id) === String(p.id);
    return (x.empresa || '') === (p.empresa || '');
  });
}
function par(k, v) { return '<div><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
function sim(v) { return v ? 'Sim' : 'Não'; }
function faltaTxt(p) {
  var pr = p.progresso;
  if (!pr || !Array.isArray(pr.faltam)) return '';
  var prox = pr.proximo ? (NIVEIS[pr.proximo] || pr.proximo) : '';
  if (!pr.faltam.length) return prox ? 'Pronto para ' + prox + '.' : 'Nada falta.';
  return (prox ? 'Para chegar a ' + prox + ' falta: ' : 'Falta: ') + pr.faltam.map(function (k) { return faltaRotulo(k, pr); }).join(', ') + '.';
}

// Saldo de engenharia: comprados, usados e disponíveis vêm calculados da API.
function saldoHtml(p) {
  var s = p.saldo_engenharia;
  if (!s || typeof s !== 'object') return par('Saldo de engenharia', 'Sem dado');
  return par('Projetos comprados', s.comprados == null ? 'Sem dado' : esc(fmtNum(s.comprados))) +
    par('Projetos usados', s.usados == null ? 'Sem dado' : esc(fmtNum(s.usados))) +
    par('Projetos disponíveis', s.disponiveis == null ? 'Sem dado' : '<b>' + esc(fmtNum(s.disponiveis)) + '</b>');
}
// Termo: aceito (com a data), pendente (disponível desde a primeira compra) ou travado.
function termoHtml(p) {
  if (p.termo_aceito_em) return '<span class="pill ok">Aceito em ' + esc(fmtData(p.termo_aceito_em)) + '</span>' + (p.termo_versao ? '<div class="peq">Versão ' + esc(p.termo_versao) + '</div>' : '');
  var n = nivelDe(p);
  if (n === 'pro' || n === 'master') return '<span class="pill av">Pendente</span><div class="peq">Disponível, o parceiro ainda não aceitou.</div>';
  return '<span class="trava">' + ICONE_CADEADO + 'Travado</span><div class="peq">Libera com a primeira compra de carregador.</div>';
}
function seloHtml(p) {
  if (p.montagem_aprovada_em) return '<span class="pill ok">Montagem aprovada</span><div class="peq">Desde ' + esc(fmtData(p.montagem_aprovada_em)) + '. Recebe obras.</div>';
  if (p.papel_montagem) return '<span class="pill av">Aguardando aprovação</span><div class="peq">Escolheu o papel, a equipe ainda não aprovou.</div>';
  return '<span class="pill">Sem selo</span><div class="peq">Não escolheu o papel Montagem e Engenharia.</div>';
}
function desenharFicha() {
  var p = achar(fichaId);
  var f = $('ficha');
  if (!p) { f.innerHTML = '<div class="vazio">Parceiro não encontrado. Feche e recarregue a lista.</div>'; return; }
  var local = cidadeUf(p.cidade, p.uf) || 'Sem cidade';
  var pp = papeis(p);
  var msg = 'Oi, tudo bem?\nAqui é da NEXUS Eletropostos.\nVi o cadastro da ' + (p.empresa || 'sua empresa') + ' no Portal do Parceiro e quero te ajudar com os próximos passos.';
  var origem = ORIGENS[p.origem] || p.origem || 'Não informada';
  var nivel = nivelDe(p);
  var falta = faltaTxt(p);
  var ev = [
    ['Cadastro', p.created_at], ['Perfil completo', p.perfil_completo_em], ['Primeira proposta', p.primeira_proposta_em],
    ['Conversa pedida', p.conversa_pedida_em], ['Conversa feita', p.conversa_feita_em],
    ['Marcada como Partner', p.partner_em], ['Montagem aprovada', p.montagem_aprovada_em]
  ].filter(function (e) { return e[1]; });
  var semMontagem = !p.papel_montagem;

  f.innerHTML =
    '<div class="ficha-topo"><div><h2 id="ficha-titulo">' + esc(p.empresa || 'Empresa sem nome') + '</h2>' +
      '<p class="sub">' + esc(fmtCnpj(p.cnpj)) + ' · ' + esc(local) + '</p></div>' +
      '<button type="button" class="fx" onclick="fecharFicha()" aria-label="Fechar a ficha">×</button></div>' +

    '<div class="bloco"><h3>Nível</h3><div class="kv">' +
      par('Nível agora', esc(NIVEIS[nivel])) +
      par('Carregadores comprados', esc(fmtNum(p.carregadores_comprados))) +
    '</div>' + (falta ? '<p class="peq" style="margin:10px 0 0">' + esc(falta) + '</p>' : '') + '</div>' +

    '<div class="bloco"><h3>Engenharia, termo e selo</h3><div class="kv">' +
      saldoHtml(p) +
      par('Termo de Parceria', termoHtml(p)) +
      par('Selo de montagem', seloHtml(p)) +
    '</div></div>' +

    '<div class="bloco"><h3>Empresa</h3><div class="kv">' +
      par('Papéis', pp.length ? esc(pp.join(' e ')) : 'Ainda não escolheu') +
      par('Status', pill(STATUS, STATUS_COR, p.status || 'novo')) +
      par('Situação do CNPJ', p.cnpj_situacao === 'ativa' ? 'Ativa na Receita' : 'Não verificado') +
      par('Raio de atendimento', p.raio_km ? esc(fmtNum(p.raio_km)) + ' km' : 'Não informado') +
      par('Equipe', p.equipe_tamanho ? esc(fmtNum(p.equipe_tamanho)) + ' pessoas' : 'Não informada') +
      par('Logo enviado', sim(p.tem_logo)) +
      par('WhatsApp', p.whatsapp ? esc(p.whatsapp) : 'Não informado') +
      par('Origem', esc(origem)) +
    '</div></div>' +

    '<div class="bloco"><h3>Capacidades</h3><div class="pills">' + CAPS.map(function (c) {
      return '<span class="pill ' + (p[c[0]] ? 'ok' : '') + '">' + esc(c[1]) + ': ' + sim(p[c[0]]) + '</span>';
    }).join('') + '</div></div>' +

    '<div class="bloco"><h3>Movimento</h3><div class="kv">' +
      par('Propostas', esc(fmtNum(p.propostas_total))) + par('Propostas em 30 dias', esc(fmtNum(p.propostas_30d))) +
      par('Última proposta', p.ultima_proposta_em ? esc(fmtData(p.ultima_proposta_em)) : 'Nenhuma') +
      par('Pedidos (todos os tipos)', esc(fmtNum(p.pedidos_total))) +
    '</div>' + (ev.length ? '<div class="kv" style="margin-top:12px">' + ev.map(function (e) { return par(e[0], esc(fmtData(e[1], true))); }).join('') + '</div>' : '') + '</div>' +

    '<div class="bloco"><h3>Ações da equipe</h3><div class="acoes">' +
      '<div class="linha"><div><label for="fa-status">Status</label><select id="fa-status">' + opcoes(STATUS, p.status || 'novo') +
      '</select></div><button type="button" class="btn" data-acao="status">Salvar status</button></div>' +
      '<div class="linha">' +
        '<button type="button" class="btn ' + (p.conversa_feita_em ? 'ghost' : 'ok') + '" data-acao="conversa" data-val="' + (p.conversa_feita_em ? '0' : '1') + '">' + (p.conversa_feita_em ? 'Desmarcar conversa feita' : 'Marcar conversa feita') + '</button>' +
        '<button type="button" class="btn ' + (p.partner_em ? 'ghost' : '') + '" data-acao="partner" data-val="' + (p.partner_em ? '0' : '1') + '">' + (p.partner_em ? 'Tirar de Partner' : 'Marcar como Partner') + '</button>' +
        '<button type="button" class="btn ' + (p.montagem_aprovada_em ? 'ghost' : '') + '" data-acao="montagem" data-val="' + (p.montagem_aprovada_em ? '0' : '1') + '"' + (semMontagem && !p.montagem_aprovada_em ? ' disabled title="O parceiro não escolheu o papel Montagem e Engenharia"' : '') + '>' + (p.montagem_aprovada_em ? 'Tirar aprovação de montagem' : 'Aprovar montagem') + '</button>' +
      '</div>' +
      (semMontagem && !p.montagem_aprovada_em ? '<p class="peq" style="margin:0">Aprovar montagem só vale para quem escolheu o papel Montagem e Engenharia no perfil. O selo libera as oportunidades do tipo obra.</p>' : '') +
      '<div><label for="fa-notas">Notas da equipe</label><textarea id="fa-notas" maxlength="4000" placeholder="Só a equipe vê estas notas">' + esc(p.notas_equipe || '') + '</textarea></div>' +
      '<div class="linha"><button type="button" class="btn" data-acao="notas">Salvar notas</button>' + linkWpp(p.whatsapp, msg, 'Abrir WhatsApp do parceiro') + '</div>' +
    '</div></div>' +

    '<div class="bloco"><h3>Propostas deste parceiro</h3><div class="sec-prop" id="fa-props"><span class="peq"><span class="spin"></span>Carregando</span></div></div>';

  desenharFichaPropostas();
}

function desenharFichaPropostas() {
  var box = $('fa-props');
  var p = achar(fichaId);
  if (!box || !p) return;
  var l = propostasDe(p);
  if (!l) return;
  if (!l.length) { box.innerHTML = '<div class="item">Este parceiro ainda não gerou propostas.</div>'; return; }
  box.innerHTML = l.slice(0, 50).map(function (x) {
    var local = cidadeUf(x.cliente_cidade, x.cliente_uf);
    return '<div class="item"><b>N° ' + esc(x.numero) + '</b> · ' + esc(fmtData(x.created_at)) + '<br>' +
      esc(x.cliente_nome || 'Cliente sem nome') + (local ? ' · ' + esc(local) : '') + '<br>' +
      esc(fmtNum(x.quantidade) + 'x ' + modeloTxt(x.modelo)) + ' · ' + esc(fmtReal(x.valor_total)) + '<br>' +
      '<span class="peq">Link: ' + esc(linkPlano(x)) + '</span></div>';
  }).join('') + (l.length > 50 ? '<div class="peq">Mostrando as 50 mais recentes de ' + l.length + '.</div>' : '');
}

function agir(botao) {
  var p = achar(fichaId);
  if (!p) return;
  var acao = botao.getAttribute('data-acao');
  var val = botao.getAttribute('data-val') === '1';
  var corpo = null, ok = 'Salvo.';
  if (acao === 'status') { corpo = { status: $('fa-status').value }; ok = 'Status salvo.'; }
  else if (acao === 'conversa') { corpo = { conversa_feita: val }; ok = val ? 'Conversa marcada como feita.' : 'Marca de conversa removida.'; }
  else if (acao === 'partner') { corpo = { partner: val }; ok = val ? 'Marcada como Partner.' : 'Partner removido.'; }
  else if (acao === 'montagem') { corpo = { montagem_aprovada: val }; ok = val ? 'Montagem aprovada.' : 'Aprovação de montagem removida.'; }
  else if (acao === 'notas') { corpo = { notas_equipe: $('fa-notas').value }; ok = 'Notas salvas.'; }
  if (!corpo) return;
  salvar(botao, 'PATCH', '/parceiros/' + encodeURIComponent(p.id), corpo, ok);
}

/* ── Estrutura da página (montada em #painel-raiz) ── */
var ESTRUTURA = [
  "<div id=\"estado\" class=\"card estado\" role=\"status\" aria-live=\"polite\"></div>",
  "  <div id=\"convite-off\" class=\"card conv oculto\"></div>",
  "",
  "  <div id=\"painel\" class=\"oculto\">",
  "",
  "    <div class=\"totais\" id=\"totais\"></div>",
  "",
  "    <div class=\"card\">",
  "      <h2>Parceiros por nível</h2>",
  "      <p class=\"sub\">Cadastrado: CNPJ ativo. Partner: conversa feita e marcada pela equipe. Pro: primeira compra de carregador. Master: 5 carregadores comprados. A montagem aprovada é um selo à parte: só quem tem recebe oportunidade de obra.</p>",
  "      <div class=\"etapas-graf\" id=\"grafico\"></div>",
  "    </div>",
  "",
  "    <div class=\"card conv\" id=\"convite-box\" aria-live=\"polite\"></div>",
  "",
  "    <div class=\"abas\" role=\"tablist\" aria-label=\"Seções\" id=\"abas\"></div>",
  "",
  "    <section id=\"sec-parceiros\" role=\"tabpanel\">",
  "      <div class=\"filtros\">",
  "        <div class=\"busca\"><label for=\"f-busca\">Buscar</label><input id=\"f-busca\" type=\"search\" placeholder=\"Nome, CNPJ ou cidade\" oninput=\"desenharLista()\"></div>",
  "        <div><label for=\"f-uf\">UF</label><select id=\"f-uf\" onchange=\"desenharLista()\"><option value=\"\">Todas</option></select></div>",
  "        <div><label for=\"f-status\">Status</label><select id=\"f-status\" onchange=\"desenharLista()\">",
  "          <option value=\"\">Todos</option><option value=\"novo\">Novo</option><option value=\"em_contato\">Em contato</option>",
  "          <option value=\"parceiro_ativo\">Parceiro ativo</option><option value=\"descartado\">Descartado</option></select></div>",
  "        <div><label for=\"f-papel\">Papel</label><select id=\"f-papel\" onchange=\"desenharLista()\">",
  "          <option value=\"\">Todos</option><option value=\"revenda\">Revenda</option><option value=\"montagem\">Montagem e Engenharia</option></select></div>",
  "        <div><label for=\"f-nivel\">Nível</label><select id=\"f-nivel\" onchange=\"desenharLista()\">",
  "          <option value=\"\">Todos</option><option value=\"cadastrado\">Cadastrado</option><option value=\"partner\">Partner</option>",
  "          <option value=\"pro\">Pro</option><option value=\"master\">Master</option></select></div>",
  "      </div>",
  "      <div class=\"barra-topo\"><p class=\"contagem\" id=\"contagem\"></p><button type=\"button\" class=\"btn ghost sm\" id=\"csv-parceiros\" data-csv=\"parceiros\" disabled>Exportar CSV</button></div>",
  "      <div class=\"lista\" id=\"lista\"></div>",
  "    </section>",
  "",
  "    <section id=\"sec-pedidos\" class=\"oculto\" role=\"tabpanel\">",
  "      <div class=\"filtros simples\">",
  "        <div><label for=\"pd-status\">Status</label><select id=\"pd-status\" onchange=\"desenharPedidos()\">",
  "          <option value=\"\">Todos</option><option value=\"solicitado\">Solicitado</option><option value=\"negociando\">Negociando</option>",
  "          <option value=\"confirmado\">Confirmado</option><option value=\"cancelado\">Cancelado</option></select></div>",
  "        <div><label for=\"pd-tipo\">Tipo</label><select id=\"pd-tipo\" onchange=\"desenharPedidos()\">",
  "          <option value=\"\">Todos</option><option value=\"equipamento\">Equipamento</option><option value=\"engenharia\">Engenharia</option>",
  "          <option value=\"consultoria\">Apoio de venda</option><option value=\"manutencao\">Plano de manutenção</option></select></div>",
  "        <div><label for=\"pd-busca\">Buscar</label><input id=\"pd-busca\" type=\"search\" placeholder=\"Empresa, tipo ou modelo\" oninput=\"desenharPedidos()\"></div>",
  "      </div>",
  "      <div class=\"barra-topo\"><p class=\"contagem\" id=\"pd-contagem\"></p><button type=\"button\" class=\"btn ghost sm\" id=\"csv-pedidos\" data-csv=\"pedidos\" disabled>Exportar CSV</button></div>",
  "      <div class=\"lista\" id=\"pd-lista\"></div>",
  "    </section>",
  "",
  "    <section id=\"sec-oportunidades\" class=\"oculto\" role=\"tabpanel\">",
  "      <div class=\"barra-topo\">",
  "        <div class=\"filtros simples\" style=\"margin:0;flex:1 1 360px\">",
  "          <div><label for=\"op-status\">Status</label><select id=\"op-status\" onchange=\"desenharOportunidades()\">",
  "            <option value=\"\">Todos</option><option value=\"rascunho\">Rascunho</option><option value=\"oferecida\">Oferecida</option>",
  "            <option value=\"aceita\">Aceita</option><option value=\"recusada\">Recusada</option><option value=\"expirada\">Expirada</option>",
  "            <option value=\"contato\">Em contato</option><option value=\"visita\">Visita</option><option value=\"orcamento\">Orçamento</option>",
  "            <option value=\"fechou\">Fechou</option><option value=\"perdeu\">Perdeu</option></select></div>",
  "          <div><label for=\"op-busca\">Buscar</label><input id=\"op-busca\" type=\"search\" placeholder=\"Cidade, UF ou parceiro\" oninput=\"desenharOportunidades()\"></div>",
  "        </div>",
  "        <button type=\"button\" class=\"btn\" id=\"op-nova-btn\" onclick=\"abrirNovaOportunidade()\">Nova oportunidade</button>",
  "      </div>",
  "      <div class=\"card oculto\" id=\"op-nova\"></div>",
  "      <p class=\"contagem\" id=\"op-contagem\"></p>",
  "      <div class=\"lista\" id=\"op-lista\"></div>",
  "    </section>",
  "",
  "    <section id=\"sec-usinas\" class=\"oculto\" role=\"tabpanel\">",
  "      <div class=\"filtros simples\">",
  "        <div><label for=\"us-status\">Status</label><select id=\"us-status\" onchange=\"desenharUsinas()\">",
  "          <option value=\"\">Todos</option><option value=\"recebida\">Recebida</option><option value=\"em_analise\">Em análise</option>",
  "          <option value=\"contrato\">Contrato</option><option value=\"descartada\">Descartada</option></select></div>",
  "        <div><label for=\"us-busca\">Buscar</label><input id=\"us-busca\" type=\"search\" placeholder=\"Parceiro, dono, cidade ou distribuidora\" oninput=\"desenharUsinas()\"></div>",
  "      </div>",
  "      <p class=\"contagem\" id=\"us-contagem\"></p>",
  "      <div class=\"lista\" id=\"us-lista\"></div>",
  "    </section>",
  "",
  "    <section id=\"sec-solicitacoes\" class=\"oculto\" role=\"tabpanel\">",
  "      <div class=\"filtros simples\">",
  "        <div><label for=\"so-status\">Status</label><select id=\"so-status\" onchange=\"desenharSolicitacoes()\">",
  "          <option value=\"\">Todos</option><option value=\"aberta\">Aberta</option><option value=\"em_andamento\">Em andamento</option>",
  "          <option value=\"concluida\">Concluída</option><option value=\"cancelada\">Cancelada</option></select></div>",
  "        <div><label for=\"so-tipo\">Tipo</label><select id=\"so-tipo\" onchange=\"desenharSolicitacoes()\">",
  "          <option value=\"\">Todos</option><option value=\"conversa\">Conversa com o comercial</option>",
  "          <option value=\"engenharia\">Engenharia</option><option value=\"negociar_preco\">Negociar preço</option>",
  "          <option value=\"plataforma\">Plataforma NEXUS</option></select></div>",
  "      </div>",
  "      <p class=\"contagem\" id=\"so-contagem\"></p>",
  "      <div class=\"lista\" id=\"so-lista\"></div>",
  "    </section>",
  "",
  "    <section id=\"sec-propostas\" class=\"oculto\" role=\"tabpanel\">",
  "      <div class=\"filtros prop\">",
  "        <div><label for=\"p-desde\">Período</label><select id=\"p-desde\" onchange=\"abrirAba('propostas', true)\">",
  "          <option value=\"30\">Últimos 30 dias</option><option value=\"90\" selected>Últimos 90 dias</option>",
  "          <option value=\"365\">Últimos 12 meses</option><option value=\"0\">Tudo</option></select></div>",
  "        <div><label for=\"p-busca\">Buscar</label><input id=\"p-busca\" type=\"search\" placeholder=\"Empresa, cliente, cidade ou número\" oninput=\"desenharPropostas()\"></div>",
  "      </div>",
  "      <div class=\"barra-topo\"><p class=\"contagem\" id=\"p-contagem\"></p><button type=\"button\" class=\"btn ghost sm\" id=\"csv-propostas\" data-csv=\"propostas\" disabled>Exportar CSV</button></div>",
  "      <div id=\"p-lista\"></div>",
  "    </section>",
  "  </div>",
  "",
  "<div id=\"fundo-ficha\" class=\"fundo-ficha oculto\" onclick=\"if(event.target===this)fecharFicha()\">",
  "  <div class=\"ficha\" id=\"ficha\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"ficha-titulo\" tabindex=\"-1\"></div>",
  "</div>",
  "<div id=\"toast\" role=\"status\" aria-live=\"polite\"></div>"
].join('\n');
var SEC_FUNIL = '<section id="sec-funil" class="oculto" role="tabpanel">' +
  '<div class="filtros simples" style="max-width:320px"><div><label for="fn-desde">Período dos cadastros</label><select id="fn-desde" onchange="abrirAba(\'funil\', true)">' +
  '<option value="30">Últimos 30 dias</option><option value="90" selected>Últimos 90 dias</option><option value="0">Tudo</option></select></div></div>' +
  '<div id="fn-corpo"></div></section>';
var SEC_EQUIPE = '<section id="sec-equipe" class="oculto" role="tabpanel">' +
  '<div id="eq-form"></div><p class="contagem" id="eq-contagem"></p><div class="lista" id="eq-lista"></div></section>';

/* ── Eventos ── */
var tecladoLigado = false;
function ligarEventos() {
  $('lista').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.lin') : null;
    if (b) abrirFicha(b.getAttribute('data-id'));
  });
  $('convite-box').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-cv]') : null;
    if (!b || b.disabled) return;
    var a = b.getAttribute('data-cv');
    if (a === 'pedir' && !CV.enviando && !CV.incerto) { CV.confirmando = true; desenharConvite(); }
    else if (a === 'cancelar') { CV.confirmando = false; desenharConvite(); var p0 = $('convite-box').querySelector('[data-cv="pedir"]'); if (p0) p0.focus(); }
    else if (a === 'confirmar') enviarLote();
    else if (a === 'recarregar') carregarConvite(false);
  });
  $('abas').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button[data-aba]') : null;
    if (b) abrirAba(b.getAttribute('data-aba'), false);
  });
  $('painel').addEventListener('click', function (ev) {
    var r = ev.target.closest ? ev.target.closest('[data-recarregar]') : null;
    if (r) { abrirAba(r.getAttribute('data-recarregar'), true); return; }
    var c = ev.target.closest ? ev.target.closest('[data-csv]') : null;
    if (c) { if (!c.disabled) exportarCsv(c.getAttribute('data-csv')); return; }
    var q = ev.target.closest ? ev.target.closest('[data-eq]') : null;
    if (q) { if (!q.disabled) acaoEquipe(q); return; }
    var b = ev.target.closest ? ev.target.closest('[data-do]') : null;
    if (!b || b.disabled) return;
    if (b.getAttribute('data-do') === 'criar-oportunidade') criarOportunidade(b);
    else acaoRegistro(b);
  });
  $('ficha').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-acao]') : null;
    if (b && !b.disabled) agir(b);
  });
  if (tecladoLigado) return;
  tecladoLigado = true;
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && fichaId) fecharFicha();
    // Mantém o foco dentro da ficha enquanto ela está aberta.
    if (ev.key === 'Tab' && fichaId) {
      var el = $('ficha').querySelectorAll('button:not([disabled]),a[href],input,select,textarea');
      if (!el.length) return;
      var a = el[0], z = el[el.length - 1];
      if (ev.shiftKey && (document.activeElement === a || document.activeElement === $('ficha'))) { ev.preventDefault(); z.focus(); }
      else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
  });
}

window.carregar = function () { return carregar(false); };
window.abrirAba = abrirAba;
window.desenharLista = desenharLista;
window.desenharPedidos = desenharPedidos;
window.desenharOportunidades = desenharOportunidades;
window.desenharUsinas = desenharUsinas;
window.desenharSolicitacoes = desenharSolicitacoes;
window.desenharPropostas = desenharPropostas;
window.abrirNovaOportunidade = abrirNovaOportunidade;
window.fecharFicha = fecharFicha;

// Monta a estrutura em #painel-raiz e carrega. Chamado de novo (ADM, depois de um novo login), refaz tudo do zero.
function iniciar(eu) {
  var raiz = $('painel-raiz');
  if (!raiz) return;
  if (eu) EU = eu;
  D = null; ST = {}; PROPS_DESDE = null; PROPS_ALL = null; SUG = {}; FUNIL_DESDE = null; FUNIL_REQ++;
  fichaId = null; carregando = false; aba = 'parceiros';
  CV = { fase: 'carregando', previa: null, confirmando: false, enviando: false, incerto: false, semPermissao: false, retorno: null };
  document.body.style.overflow = '';
  raiz.innerHTML = ESTRUTURA;
  if (!ADM) {
    // O /gerador/parceiros fica como sempre foi: sem o botão Exportar CSV (que é do ADM).
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-csv]'), function (b) {
      var barra = b.parentNode;
      barra.parentNode.replaceChild(barra.querySelector('.contagem'), barra);
    });
  }
  if (ADM) {
    $('sec-propostas').insertAdjacentHTML('afterend', SEC_EQUIPE);
    $('sec-parceiros').insertAdjacentHTML('afterend', SEC_FUNIL);
  }
  ligarEventos();
  carregar(false);
}

window.PainelNexus = { iniciar: iniciar, recarregar: function () { return carregar(false); } };
if (!CFG.manual) iniciar();
})();
