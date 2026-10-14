/* Meu perfil do /gerador: a janela que o menu do usuario (casca.js) abre. Vale nos dois visuais.
   - Foto (reduzida no navegador para ate 512 px) e WhatsApp: POST /gerador/perfil. O NOME nunca se edita aqui.
   - Trocar senha: Auth do Supabase do Gerador (PUT /auth/v1/user), so a do proprio usuario.
   - Socio: "Perfis da equipe" abre a mesma janela com o seletor do consultor (campo `alvo` da API).
   - Entradas globais: abrirMeuPerfil(), abrirPerfisEquipe() (a casca chama pelo nome, ver MODELO.ir).
   - Depois de salvar: atualiza os mapas consultoresFotos e consultoresWhats do app e avisa a casca (evento
     'io2-perfil') para o avatar da barra mudar na hora.
   Cor: tokens de io2.css (--n-*, --io-*) com a paleta escura do visual antigo como reserva, porque la o io2.css nao vale.
   Fora do link do cliente (?p=) e do PDF (pdf=1) nada disto roda. Sem commit, sem segredo: so o que a pessoa digita e o token dela. */
(function () {
  'use strict';
  var q = location.search || '';
  if (/[?&]p=/.test(q) || /[?&]pdf=1(&|$)/.test(q)) return;
  var h = document.documentElement;

  var API = (location.hostname === 'localhost' ? 'http://localhost:3001' : '/_api') + '/gerador/perfil';
  var FOTO_MAX_LADO = 512;                 /* maior lado da foto enviada */
  var FOTO_MAX_BASE64 = 1.5 * 1024 * 1024; /* tamanho do texto base64 (a API aceita 1,5 MB de bytes: sobra folga) */
  var SENHA_MIN = 6;                       /* piso do Supabase; o projeto pode pedir mais e a resposta explica */

  /* ---------------------------------------------------------------- utilidades */
  function noop() {}
  function mesma(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function erro(msg, status, codigo) { var e = new Error(msg); e.status = status || 0; e.codigo = codigo || ''; return e; }
  function criar(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function tokenAtual() {
    try { if (typeof sessaoAtual !== 'undefined' && sessaoAtual && sessaoAtual.access_token) return String(sessaoAtual.access_token); } catch (e) {}
    try { var s = JSON.parse(localStorage.getItem('irmaos-na-obra-sessao-v1') || 'null'); return (s && s.access_token) ? String(s.access_token) : ''; } catch (e2) {}
    return '';
  }
  function renovar() {
    try { if (typeof authRenovarSePreciso === 'function') return Promise.resolve(authRenovarSePreciso()).catch(noop); } catch (e) {}
    return Promise.resolve();
  }
  function lerTexto(r) {
    return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return j; });
  }
  function semConexao() { return erro('Sem conexão. Confira a internet e tente de novo.', 0, 'rede'); }

  /* WhatsApp: mostra (34) 98765-4321, manda so os digitos. Tira o 55 do pais quando vem com 13 digitos. */
  function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }
  function semPais(d) { return d.length === 13 && d.indexOf('55') === 0 ? d.slice(2) : d; }
  function formatarWhats(v) {
    var d = semPais(soDigitos(v)).slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  /* ---------------------------------------------------------------- API do perfil */
  function chamar(metodo, corpo) {
    return renovar().then(function () {
      var tok = tokenAtual();
      if (!tok) throw erro('Entre com a sua conta para ver o perfil.', 401);
      var opc = { method: metodo, headers: { Authorization: 'Bearer ' + tok } };
      if (corpo) { opc.headers['Content-Type'] = 'application/json'; opc.body = JSON.stringify(corpo); }
      return fetch(API, opc).catch(function () { throw semConexao(); });
    }).then(function (r) {
      return lerTexto(r).then(function (j) {
        if (!r.ok || !j || j.ok === false) {
          var msg = j && j.error;
          if (!msg) msg = r.status === 401 ? 'Sua sessão venceu. Entre de novo.'
            : r.status === 413 ? 'A foto é grande demais. Escolha outra.'
            : 'Não consegui falar com o servidor agora. Tente de novo.';
          throw erro(msg, r.status);
        }
        return j;
      });
    });
  }

  /* ---------------------------------------------------------------- foto: reduz no navegador */
  function abrirImagem(arquivo) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(arquivo, { imageOrientation: 'from-image' }).catch(function () { return viaTag(arquivo); });
    }
    return viaTag(arquivo);
  }
  function viaTag(arquivo) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(arquivo), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); no(erro('Não consegui abrir essa imagem. Use uma foto JPEG, PNG ou WebP.')); };
      im.src = url;
    });
  }
  function paraBase64(blob) {
    return new Promise(function (ok, no) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); ok(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { no(erro('Não consegui ler a foto. Tente outra.')); };
      fr.readAsDataURL(blob);
    });
  }
  /* Devolve { tipo, base64, largura, altura }. Maior lado ate 512 px, JPEG a 0,85; se passar do limite, baixa a qualidade e depois o tamanho. */
  function reduzirFoto(arquivo) {
    return abrirImagem(arquivo).then(function (img) {
      var w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) throw erro('Não consegui abrir essa imagem. Use uma foto JPEG, PNG ou WebP.');
      var escala = Math.min(1, FOTO_MAX_LADO / Math.max(w0, h0));
      var tentativa = function (esc, qual) {
        var w = Math.max(1, Math.round(w0 * esc)), hh = Math.max(1, Math.round(h0 * esc));
        var c = document.createElement('canvas');
        c.width = w; c.height = hh;
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, hh);   /* PNG com fundo transparente nao vira preto no JPEG */
        g.drawImage(img, 0, 0, w, hh);
        return new Promise(function (ok, no) {
          c.toBlob(function (b) { if (b) ok(b); else no(erro('Não consegui preparar a foto. Tente outra.')); }, 'image/jpeg', qual);
        }).then(paraBase64).then(function (b64) {
          if (b64.length <= FOTO_MAX_BASE64) return { tipo: 'image/jpeg', base64: b64, largura: w, altura: hh };
          if (qual > 0.45) return tentativa(esc, qual - 0.15);
          if (esc > 0.2) return tentativa(esc * 0.8, 0.8);
          throw erro('Não consegui deixar a foto leve o bastante. Escolha outra.');
        });
      };
      return tentativa(escala, 0.85);
    }).then(function (r) { return r; }, function (e) {
      throw (e && e.message) ? e : erro('Não consegui abrir essa imagem. Use uma foto JPEG, PNG ou WebP.');
    });
  }

  /* ---------------------------------------------------------------- senha (Auth do Supabase do Gerador) */
  function mensagemSenha(status, j) {
    var cod = String((j && (j.error_code || j.code)) || '').toLowerCase();
    var txt = String((j && (j.msg || j.message || j.error_description || j.error)) || '');
    if (cod === 'weak_password' || /weak.?password|password (is )?(too )?(short|weak)|at least \d+ characters|should contain/i.test(txt)) {
      var razoes = (j && j.weak_password && j.weak_password.reasons) || [];
      var partes = [];
      if (razoes.indexOf('length') >= 0) partes.push('use mais caracteres');
      if (razoes.indexOf('characters') >= 0) partes.push('misture letras maiúsculas, minúsculas, números e símbolos');
      if (razoes.indexOf('pwned') >= 0) partes.push('essa senha apareceu em vazamentos, escolha outra');
      return { tipo: 'fraca', texto: 'Senha fraca' + (partes.length ? ': ' + partes.join('; ') : '. Use mais caracteres, misturando letras e números') + '.' };
    }
    if (cod === 'reauthentication_needed' || cod === 'reauthentication_not_valid' || /reauthenticat|re-authenticat|recently (logged|signed)|nonce/i.test(txt)) {
      return { tipo: 'reautenticar', texto: 'Por segurança, entre de novo para trocar a senha. Saia, entre outra vez e tente logo em seguida.' };
    }
    if (cod === 'same_password' || /different from the old|same.?password|should be different/i.test(txt)) {
      return { tipo: 'igual', texto: 'A nova senha precisa ser diferente da atual.' };
    }
    if (status === 401 || cod === 'bad_jwt' || cod === 'no_authorization' || /jwt|not authenticated|session.*(missing|not found)/i.test(txt)) {
      return { tipo: 'sessao', texto: 'Sua sessão venceu. Entre de novo e tente outra vez.' };
    }
    if (status === 429 || cod === 'over_request_rate_limit') {
      return { tipo: 'limite', texto: 'Muitas tentativas. Espere um pouco e tente de novo.' };
    }
    return { tipo: 'outro', texto: 'Não consegui trocar a senha agora. Tente de novo.' };
  }
  function trocarSenha(nova) {
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_KEY === 'undefined') {
      return Promise.reject({ tipo: 'outro', texto: 'Não consegui trocar a senha agora. Recarregue o app e tente de novo.' });
    }
    return renovar().then(function () {
      var tok = tokenAtual();
      if (!tok) throw { tipo: 'sessao', texto: 'Sua sessão venceu. Entre de novo e tente outra vez.' };
      return fetch(SUPABASE_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nova })
      }).catch(function () { throw { tipo: 'rede', texto: 'Sem conexão. Confira a internet e tente de novo.' }; });
    }).then(function (r) {
      return lerTexto(r).then(function (j) {
        if (!r.ok) throw mensagemSenha(r.status, j);
        return true;
      });
    });
  }

  /* ---------------------------------------------------------------- estado e mapas do app */
  var S = { aberto: false, equipe: false, eu: null, lista: [], alvo: '', fase: 'fechado', erro: '', ocupado: false, id: 0, opener: null, msgFoto: null, msgWhats: null, msgSenha: null, fotoPrevia: '' };
  var raiz = null, janela = null, corpo = null, titulo = null;

  function alvoAtual() {
    if (!S.eu) return null;
    if (!S.equipe) return S.eu;
    for (var i = 0; i < S.lista.length; i++) if (mesma(S.lista[i].nome, S.alvo)) return S.lista[i];
    return S.eu;
  }
  function ehEu(p) { return !!(S.eu && p && mesma(p.nome, S.eu.nome)); }
  /* Foto vinda do servidor so vale se for https de verdade (a previa local, data:, nao passa por aqui). */
  function urlFotoOk(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : ''; }
  function atualizarMapas(p) {
    try { if (typeof consultoresFotos === 'object' && consultoresFotos && urlFotoOk(p.foto_url)) consultoresFotos[p.nome] = p.foto_url; } catch (e) {}
    try { if (typeof consultoresWhats === 'object' && consultoresWhats && p.whatsapp) consultoresWhats[p.nome] = String(p.whatsapp); } catch (e2) {}
  }
  function avisarCasca(p) {
    var eu = { nome: p.nome, email: (S.eu && S.eu.email) || '', socio: !!(S.eu && S.eu.socio), whatsapp: p.whatsapp || null, foto_url: p.foto_url || null };
    try { window.dispatchEvent(new CustomEvent('io2-perfil', { detail: { eu: eu, proprio: ehEu(p) } })); } catch (e) {}
  }
  function aplicarRetorno(p) {
    /* p = { nome, whatsapp, foto_url } devolvido pela API */
    var alvo = null, i;
    if (S.eu && mesma(S.eu.nome, p.nome)) { S.eu.whatsapp = p.whatsapp; S.eu.foto_url = p.foto_url; alvo = S.eu; }
    for (i = 0; i < S.lista.length; i++) if (mesma(S.lista[i].nome, p.nome)) { S.lista[i].whatsapp = p.whatsapp; S.lista[i].foto_url = p.foto_url; }
    atualizarMapas(p);
    avisarCasca(p);
    return alvo;
  }

  /* ---------------------------------------------------------------- estilo (injetado uma vez; vale nos dois visuais) */
  var CSS = [
    '@media screen{',
    'html.pf-aberto{overflow:hidden}',
    '.pf-fundo{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(6,26,56,.55);font-family:var(--io-fonte,Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}',
    '.pf-janela{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:520px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);background:var(--n-sf,#1E293B);color:var(--n-tx,#E5E7EB);border:1px solid var(--n-bd,#334155);border-radius:16px;box-shadow:0 16px 48px rgba(6,26,56,.35);outline:0}',
    '.pf-cab{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 16px 12px 20px;border-bottom:1px solid var(--n-bd,#334155)}',
    '.pf-tit{margin:0;font-size:18px;font-weight:700;line-height:24px;color:var(--io-titulo,#F1F5F9)}',
    '.pf-x{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin:-6px 0;padding:0;border:0;border-radius:10px;background:transparent;color:var(--n-tx2,#B4C0D1);cursor:pointer}',
    '.pf-x:hover{background:var(--n-sf3,#2A384F)}',
    '.pf-x svg{width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}',
    '.pf-corpo{overflow-y:auto;overscroll-behavior:contain;padding:8px 20px 20px}',
    '.pf-sec{padding:16px 0;border-bottom:1px solid var(--n-bd,#334155)}',
    '.pf-sec:last-child{border-bottom:0;padding-bottom:0}',
    '.pf-sec-tit{margin:0 0 12px;font-size:14px;font-weight:700;color:var(--io-titulo,#F1F5F9)}',
    '.pf-campo{display:flex;flex-direction:column;gap:6px}',
    '.pf-campo+.pf-campo{margin-top:12px}',
    '.pf-rot{font-size:13px;font-weight:600;color:var(--n-tx,#E5E7EB)}',
    '.pf-in{appearance:none;box-sizing:border-box;width:100%;min-height:44px;margin:0;padding:10px 12px;border:1px solid var(--io-borda-campo,#7384A0);border-radius:10px;background:var(--n-sf2,#182338);color:var(--n-tx,#E5E7EB);font-family:inherit;font-size:16px;line-height:22px}',
    '.pf-in[readonly]{background:var(--n-sf3,#2A384F);border-color:var(--n-bd,#334155);color:var(--n-tx2,#B4C0D1)}',
    '.pf-in:focus-visible,.pf-btn:focus-visible,.pf-x:focus-visible,.pf-link:focus-visible{outline:2px solid var(--io-azul-tx,#93C5FD);outline-offset:2px}',
    '.pf-dica{margin:0;font-size:12px;line-height:16px;color:var(--n-tx2,#B4C0D1)}',
    '.pf-linha{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}',
    '.pf-linha .pf-in{flex:1 1 200px;width:auto}',
    '.pf-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;margin:0;padding:10px 16px;border:1px solid transparent;border-radius:10px;background:var(--io-azul,#2E6CEA);color:#fff;font-family:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer;white-space:nowrap}',
    '.pf-btn:hover{background:var(--io-azul-h,#1D4ED8)}',
    '.pf-btn[disabled]{opacity:.6;cursor:default}',
    '.pf-btn-2{background:transparent;border-color:var(--io-borda-campo,#7384A0);color:var(--n-tx,#E5E7EB)}',
    '.pf-btn-2:hover{background:var(--n-sf3,#2A384F)}',
    '.pf-foto-linha{display:flex;gap:16px;align-items:center}',
    '.pf-foto{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;width:88px;height:88px;border-radius:999px;background:var(--io-azul-sf,rgba(96,165,250,.16));color:var(--io-titulo,#F1F5F9);font-size:32px;font-weight:700}',
    '.pf-foto img{display:block;width:100%;height:100%;object-fit:cover}',
    '.pf-foto-txt{display:flex;flex-direction:column;gap:8px;align-items:flex-start;min-width:0}',
    '.pf-msg{margin:8px 0 0;padding:8px 12px;border:1px solid var(--io-ok-bd,rgba(74,222,128,.4));border-radius:10px;background:var(--io-ok-sf,rgba(74,222,128,.14));color:var(--io-ok-fg,#4ADE80);font-size:13px;line-height:18px}',
    '.pf-msg[hidden]{display:none}',
    '.pf-msg-er{border-color:var(--io-er-bd,rgba(248,113,113,.4));background:var(--io-er-sf,rgba(248,113,113,.14));color:var(--io-er-fg,#FCA5A5)}',
    '.pf-info{margin:24px 0;text-align:center;font-size:14px;color:var(--n-tx2,#B4C0D1)}',
    '.pf-link{appearance:none;margin:8px 0 0;padding:0;border:0;background:transparent;color:var(--io-azul-tx,#93C5FD);font-family:inherit;font-size:13px;font-weight:600;text-decoration:underline;cursor:pointer}',
    '}',
    '@media screen and (max-width:600px){',
    '.pf-fundo{align-items:flex-end;padding:0}',
    '.pf-janela{max-width:none;max-height:92vh;max-height:92dvh;border-radius:16px 16px 0 0;border-bottom:0}',
    '.pf-corpo{padding:8px 16px calc(20px + env(safe-area-inset-bottom,0px))}',
    '.pf-foto-linha{align-items:flex-start}',
    '}',
    '@media print{.pf-fundo{display:none!important}}',
    '@media (prefers-reduced-motion:reduce){.pf-fundo,.pf-janela{animation:none!important}}'
  ].join('\n');
  function injetarCss() {
    if (document.getElementById('pf-css')) return;
    var st = document.createElement('style');
    st.id = 'pf-css';
    st.textContent = CSS;
    (document.head || h).appendChild(st);
  }

  /* ---------------------------------------------------------------- janela */
  var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  function montarCasca() {
    raiz = criar('div', 'pf-fundo');
    raiz.id = 'pf-raiz';
    raiz.addEventListener('mousedown', function (ev) { if (ev.target === raiz) fechar(); });
    janela = criar('div', 'pf-janela');
    janela.setAttribute('role', 'dialog');
    janela.setAttribute('aria-modal', 'true');
    janela.setAttribute('aria-labelledby', 'pf-tit');
    janela.tabIndex = -1;
    var cab = criar('div', 'pf-cab');
    titulo = criar('h2', 'pf-tit');
    titulo.id = 'pf-tit';
    var x = criar('button', 'pf-x');
    x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
    x.innerHTML = X_SVG;
    x.addEventListener('click', function () { fechar(); });
    cab.appendChild(titulo); cab.appendChild(x);
    corpo = criar('div', 'pf-corpo');
    janela.appendChild(cab); janela.appendChild(corpo);
    raiz.appendChild(janela);
    janela.addEventListener('keydown', teclado);
  }
  function focaveis() {
    var l = janela.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([hidden]), select:not([disabled]), a[href]');
    var r = [];
    for (var i = 0; i < l.length; i++) if (l[i].getClientRects().length) r.push(l[i]);
    return r;
  }
  function teclado(ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); fechar(); return; }
    if (ev.key !== 'Tab') return;
    var f = focaveis();
    if (!f.length) { ev.preventDefault(); janela.focus(); return; }
    var a = f[0], z = f[f.length - 1];
    if (ev.shiftKey && (document.activeElement === a || document.activeElement === janela)) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
  }
  function msg(tipo, texto) { return texto ? { tipo: tipo, texto: texto } : null; }
  function caixaMsg(m, id) {
    var p = criar('p', 'pf-msg' + (m && m.tipo === 'erro' ? ' pf-msg-er' : ''));
    p.id = id;
    p.setAttribute('role', m && m.tipo === 'erro' ? 'alert' : 'status');
    if (m) p.textContent = m.texto; else p.hidden = true;
    return p;
  }
  function campoTexto(id, rotulo, tipo, valor, extra) {
    var c = criar('div', 'pf-campo');
    var l = criar('label', 'pf-rot', rotulo); l.setAttribute('for', id);
    var i = criar('input', 'pf-in');
    i.id = id; i.type = tipo; i.value = valor || '';
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) i.setAttribute(k, extra[k]);
    c.appendChild(l); c.appendChild(i);
    return { caixa: c, input: i };
  }
  function pintarFotoNo(no, foto, nome) {
    no.textContent = '';
    if (foto) {
      var im = document.createElement('img');
      im.alt = '';
      im.onerror = function () { no.textContent = String(nome || '').charAt(0).toUpperCase(); };
      im.src = foto;
      no.appendChild(im);
    } else {
      no.textContent = String(nome || '').charAt(0).toUpperCase();
    }
  }

  function desenhar(focoId) {
    if (!raiz) return;
    titulo.textContent = S.equipe ? 'Perfis da equipe' : 'Meu perfil';
    corpo.textContent = '';
    if (S.fase === 'carregando') { corpo.appendChild(criar('p', 'pf-info', 'Carregando o perfil…')); return; }
    if (S.fase === 'erro') {
      var e = criar('div', 'pf-sec');
      var pe = criar('p', 'pf-msg pf-msg-er', S.erro); pe.setAttribute('role', 'alert');
      var tt = criar('button', 'pf-btn'); tt.type = 'button'; tt.textContent = 'Tentar de novo'; tt.style.marginTop = '12px';
      tt.addEventListener('click', carregar);
      e.appendChild(pe); e.appendChild(tt);
      corpo.appendChild(e);
      return;
    }
    var p = alvoAtual();
    var eu = ehEu(p);

    /* Seletor do consultor (so "Perfis da equipe") */
    if (S.equipe) {
      var sc = criar('div', 'pf-sec');
      var cc = criar('div', 'pf-campo');
      var ll = criar('label', 'pf-rot', 'Consultor'); ll.setAttribute('for', 'pf-alvo');
      var sel = criar('select', 'pf-in'); sel.id = 'pf-alvo'; sel.disabled = S.ocupado;
      S.lista.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.nome; o.textContent = c.nome + (ehEu(c) ? ' (você)' : '');
        if (mesma(c.nome, p.nome)) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { S.alvo = sel.value; S.msgFoto = S.msgWhats = S.msgSenha = null; desenhar('pf-alvo'); });
      cc.appendChild(ll); cc.appendChild(sel);
      sc.appendChild(cc);
      corpo.appendChild(sc);
    }

    /* Foto */
    var sf = criar('div', 'pf-sec');
    sf.setAttribute('role', 'group'); sf.setAttribute('aria-label', 'Foto');
    var lf = criar('div', 'pf-foto-linha');
    var fo = criar('span', 'pf-foto'); fo.id = 'pf-foto'; fo.setAttribute('aria-hidden', 'true');
    pintarFotoNo(fo, S.fotoPrevia || urlFotoOk(p.foto_url), p.nome);
    var ft = criar('div', 'pf-foto-txt');
    var bt = criar('button', 'pf-btn pf-btn-2'); bt.type = 'button'; bt.id = 'pf-trocar'; bt.textContent = 'Trocar foto'; bt.disabled = S.ocupado;
    var arq = criar('input'); arq.type = 'file'; arq.id = 'pf-arq'; arq.accept = 'image/*'; arq.hidden = true; arq.setAttribute('aria-hidden', 'true'); arq.tabIndex = -1;
    bt.addEventListener('click', function () { arq.click(); });
    arq.addEventListener('change', function () { if (arq.files && arq.files[0]) enviarFoto(arq.files[0], p); arq.value = ''; });
    ft.appendChild(bt);
    ft.appendChild(criar('p', 'pf-dica', 'JPEG, PNG ou WebP. A foto é reduzida para até 512 px.'));
    lf.appendChild(fo); lf.appendChild(ft);
    sf.appendChild(lf); sf.appendChild(arq);
    sf.appendChild(caixaMsg(S.msgFoto, 'pf-foto-msg'));
    corpo.appendChild(sf);

    /* Nome (so leitura) */
    var sn = criar('div', 'pf-sec');
    var cn = campoTexto('pf-nome', 'Nome', 'text', p.nome, { readonly: 'readonly', 'aria-describedby': 'pf-nome-d' });
    cn.caixa.appendChild(criar('p', 'pf-dica', S.eu && S.eu.socio && !eu ? 'O nome liga propostas, agenda e robôs. Ele não se troca aqui.' : 'Para trocar o nome, fale com um sócio.')).id = 'pf-nome-d';
    sn.appendChild(cn.caixa);
    corpo.appendChild(sn);

    /* WhatsApp */
    var sw = criar('div', 'pf-sec');
    var cw = campoTexto('pf-whats', 'WhatsApp', 'tel', formatarWhats(p.whatsapp), { inputmode: 'numeric', autocomplete: 'tel', placeholder: '(34) 9XXXX-XXXX', 'aria-describedby': 'pf-whats-d', maxlength: '20' });
    var dw = criar('p', 'pf-dica', 'Celular com DDD. É o número que sai nas propostas deste consultor.'); dw.id = 'pf-whats-d';
    cw.caixa.appendChild(dw);
    var lw = criar('div', 'pf-linha');
    lw.style.marginTop = '12px';
    var sv = criar('button', 'pf-btn'); sv.type = 'button'; sv.id = 'pf-whats-salvar'; sv.textContent = 'Salvar'; sv.disabled = S.ocupado;
    lw.appendChild(sv);
    cw.input.addEventListener('input', function () {
      var pos = cw.input.selectionStart, antes = cw.input.value.length;
      cw.input.value = formatarWhats(cw.input.value);
      try { var dep = cw.input.value.length; if (pos != null && pos < antes) cw.input.setSelectionRange(pos + (dep - antes), pos + (dep - antes)); } catch (e1) {}
    });
    cw.input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); salvarWhats(p, cw.input); } });
    sv.addEventListener('click', function () { salvarWhats(p, cw.input); });
    sw.appendChild(cw.caixa); sw.appendChild(lw);
    sw.appendChild(caixaMsg(S.msgWhats, 'pf-whats-msg'));
    corpo.appendChild(sw);

    /* Senha: so a propria, e nunca no seletor da equipe */
    if (!S.equipe) {
      var ss = criar('div', 'pf-sec');
      ss.setAttribute('role', 'group'); ss.setAttribute('aria-labelledby', 'pf-senha-t');
      var ts = criar('h3', 'pf-sec-tit', 'Trocar senha'); ts.id = 'pf-senha-t';
      var c1 = campoTexto('pf-senha1', 'Nova senha', 'password', '', { autocomplete: 'new-password' });
      var c2 = campoTexto('pf-senha2', 'Repita a nova senha', 'password', '', { autocomplete: 'new-password' });
      var lsn = criar('div', 'pf-linha'); lsn.style.marginTop = '12px';
      var bs = criar('button', 'pf-btn'); bs.type = 'button'; bs.id = 'pf-senha-salvar'; bs.textContent = 'Trocar senha'; bs.disabled = S.ocupado;
      lsn.appendChild(bs);
      var enviar = function () { enviarSenha(c1.input, c2.input); };
      bs.addEventListener('click', enviar);
      c2.input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); enviar(); } });
      ss.appendChild(ts); ss.appendChild(c1.caixa); ss.appendChild(c2.caixa); ss.appendChild(lsn);
      ss.appendChild(caixaMsg(S.msgSenha, 'pf-senha-msg'));
      if (S.msgSenha && S.msgSenha.tipo === 'erro' && S.msgSenha.reautenticar) {
        var rl = criar('button', 'pf-link', 'Sair e entrar de novo'); rl.type = 'button'; rl.id = 'pf-sair';
        rl.addEventListener('click', function () { fechar(); try { if (typeof sairGeradorJa === 'function') sairGeradorJa(); } catch (e2) {} });
        ss.appendChild(rl);
      }
      corpo.appendChild(ss);
    }

    if (focoId) { var f = document.getElementById(focoId); if (f) f.focus(); }
  }

  /* ---------------------------------------------------------------- ações */
  function ocupar(sim) { S.ocupado = sim; var bs = janela ? janela.querySelectorAll('.pf-btn, #pf-alvo') : []; for (var i = 0; i < bs.length; i++) bs[i].disabled = sim; }
  function vivo(id) { return S.aberto && S.id === id; }

  function carregar() {
    var id = S.id;
    S.fase = 'carregando'; desenhar();
    return chamar('GET').then(function (j) {
      if (!vivo(id)) return;
      var eu = j.eu || {};
      if (!eu.nome) throw erro('Não consegui ler o perfil agora. Tente de novo em instantes.');
      S.eu = { nome: eu.nome, email: eu.email || '', socio: eu.socio === true, whatsapp: eu.whatsapp || null, foto_url: eu.foto_url || null };
      S.lista = (S.eu.socio && j.equipe && j.equipe.length) ? j.equipe.map(function (c) { return { nome: c.nome, whatsapp: c.whatsapp || null, foto_url: c.foto_url || null }; }) : [];
      /* Pediu a equipe mas nao e socio (ou a lista veio vazia): abre o proprio perfil. */
      if (S.equipe && !(S.eu.socio && S.lista.length)) S.equipe = false;
      if (S.equipe) {
        var primeiro = null;
        for (var i = 0; i < S.lista.length; i++) if (!ehEu(S.lista[i])) { primeiro = S.lista[i]; break; }
        S.alvo = (primeiro || S.lista[0]).nome;
      }
      S.fase = 'pronto';
      avisarCasca(S.eu);
      desenhar(S.equipe ? 'pf-alvo' : 'pf-trocar');
    }).catch(function (e) {
      if (!vivo(id)) return;
      S.fase = 'erro'; S.erro = (e && e.message) || 'Não consegui ler o perfil agora. Tente de novo em instantes.';
      desenhar();
      var t = corpo.querySelector('.pf-btn'); if (t) t.focus();
    });
  }

  function corpoAlvo(p) {
    /* `alvo` so vai quando e outra pessoa: o servidor trata o proprio nome como "eu". */
    return ehEu(p) ? {} : { alvo: p.nome };
  }

  function enviarFoto(arquivo, p) {
    var id = S.id;
    S.msgFoto = msg('ok', 'Preparando a foto…'); redesenharMsg('pf-foto-msg', S.msgFoto);
    ocupar(true);
    reduzirFoto(arquivo).then(function (f) {
      if (!vivo(id)) return;
      S.fotoPrevia = 'data:' + f.tipo + ';base64,' + f.base64;
      var no = document.getElementById('pf-foto'); if (no) pintarFotoNo(no, S.fotoPrevia, p.nome);
      S.msgFoto = msg('ok', 'Enviando a foto…'); redesenharMsg('pf-foto-msg', S.msgFoto);
      var c = corpoAlvo(p); c.foto = { tipo: f.tipo, base64: f.base64 };
      return chamar('POST', c).then(function (j) {
        if (!vivo(id)) { if (j && j.perfil) aplicarRetorno(j.perfil); return; }
        S.fotoPrevia = '';
        if (j.perfil) aplicarRetorno(j.perfil);
        S.msgFoto = msg('ok', j.alterado && j.alterado.foto === false ? 'A foto já era essa.' : 'Foto salva.');
        S.ocupado = false; desenhar('pf-trocar');
      });
    }).catch(function (e) {
      if (!vivo(id)) return;
      S.fotoPrevia = '';
      S.msgFoto = msg('erro', (e && e.message) || 'Não consegui enviar a foto. Tente de novo.');
      S.ocupado = false; desenhar('pf-trocar');
    });
  }

  function redesenharMsg(id, m) {
    var n = document.getElementById(id);
    if (!n) return;
    n.className = 'pf-msg' + (m && m.tipo === 'erro' ? ' pf-msg-er' : '');
    n.setAttribute('role', m && m.tipo === 'erro' ? 'alert' : 'status');
    n.textContent = m ? m.texto : '';
    n.hidden = !m;
  }

  function salvarWhats(p, input) {
    if (S.ocupado) return;
    var id = S.id;
    var d = soDigitos(input.value);
    if (!d) { S.msgWhats = msg('erro', 'Digite o número do WhatsApp com DDD.'); redesenharMsg('pf-whats-msg', S.msgWhats); input.focus(); return; }
    S.msgWhats = msg('ok', 'Salvando…'); redesenharMsg('pf-whats-msg', S.msgWhats);
    ocupar(true);
    var c = corpoAlvo(p); c.whatsapp = d;
    chamar('POST', c).then(function (j) {
      if (!vivo(id)) { if (j && j.perfil) aplicarRetorno(j.perfil); return; }
      if (j.perfil) aplicarRetorno(j.perfil);
      S.msgWhats = msg('ok', j.alterado && j.alterado.whatsapp === false ? 'Esse já era o número salvo.' : 'WhatsApp salvo.');
      S.ocupado = false; desenhar('pf-whats');
    }).catch(function (e) {
      if (!vivo(id)) return;
      S.msgWhats = msg('erro', (e && e.message) || 'Não consegui salvar agora. Tente de novo.');
      S.ocupado = false; desenhar('pf-whats');
    });
  }

  function enviarSenha(i1, i2) {
    if (S.ocupado) return;
    var id = S.id, a = i1.value, b = i2.value;
    var falha = function (t, foco) { S.msgSenha = msg('erro', t); redesenharMsg('pf-senha-msg', S.msgSenha); if (foco) foco.focus(); };
    if (!a) return falha('Digite a nova senha.', i1);
    if (a.length < SENHA_MIN) return falha('Use pelo menos ' + SENHA_MIN + ' caracteres.', i1);
    if (a !== b) return falha('As duas senhas não são iguais.', i2);
    S.msgSenha = msg('ok', 'Trocando a senha…'); redesenharMsg('pf-senha-msg', S.msgSenha);
    ocupar(true);
    trocarSenha(a).then(function () {
      if (!vivo(id)) return;
      S.msgSenha = msg('ok', 'Senha trocada. Use a nova senha no próximo login.');
      S.ocupado = false; desenhar('pf-senha1');
    }).catch(function (e) {
      if (!vivo(id)) return;
      var m = (e && e.texto) ? e : { tipo: 'outro', texto: 'Não consegui trocar a senha agora. Tente de novo.' };
      S.msgSenha = msg('erro', m.texto);
      if (m.tipo === 'reautenticar' || m.tipo === 'sessao') S.msgSenha.reautenticar = true;
      S.ocupado = false; desenhar('pf-senha1');
    });
  }

  /* ---------------------------------------------------------------- abrir e fechar */
  function abrir(equipe) {
    if (h.getAttribute('data-mode') !== 'app') return;   /* sem login nao ha perfil */
    if (S.aberto) fechar(true);
    injetarCss();
    if (!raiz) montarCasca();
    S.id++;
    S.aberto = true; S.equipe = !!equipe; S.eu = null; S.lista = []; S.alvo = ''; S.fase = 'carregando'; S.erro = '';
    S.ocupado = false; S.msgFoto = S.msgWhats = S.msgSenha = null; S.fotoPrevia = '';
    S.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.appendChild(raiz);
    h.classList.add('pf-aberto');
    desenhar();
    janela.focus();
    carregar();
  }
  function fechar(semFoco) {
    if (!S.aberto) return;
    S.aberto = false;
    h.classList.remove('pf-aberto');
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    var o = S.opener; S.opener = null;
    if (!semFoco) { try { if (o && o.isConnected && o.focus) o.focus(); } catch (e) {} }
  }

  window.abrirMeuPerfil = function () { abrir(false); };
  /* A conta saiu (authLimpar): a janela nao pode ficar por cima do login. */
  window.fecharMeuPerfil = function () { fechar(true); };
  window.abrirPerfisEquipe = function () { abrir(true); };

  /* ---------------------------------------------------------------- visual antigo: entrada no pe do menu lateral */
  function entradaAntiga() {
    try {
      var foot = document.querySelector('#app-sidebar .sb-foot');
      if (!foot || document.getElementById('sb-perfil')) return;
      var b = criar('button', 'sb-item');
      b.type = 'button'; b.id = 'sb-perfil';
      b.innerHTML = '<span class="sb-ic"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span> Meu perfil';
      b.addEventListener('click', function () {
        try { if (typeof fecharSidebarMobile === 'function') fecharSidebarMobile(); } catch (e1) {}   /* celular: o menu antigo e uma gaveta */
        abrir(false);
      });
      foot.appendChild(b);
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', entradaAntiga);
  else entradaAntiga();
})();
