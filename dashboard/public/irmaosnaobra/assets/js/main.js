/* ==========================================================================
   Comportamento geral do site
   ========================================================================== */
(function () {
  'use strict';

  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zap = (msg) => 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(msg);

  // Pixel da Meta. Se o fbq não carregou (bloqueador, rede), a página segue
  // funcionando: o clique no WhatsApp não pode depender de tracking.
  function pixel(nome, dados) {
    try { if (window.fbq) window.fbq('track', nome, dados || {}); } catch (_) {}
  }

  /* ------------------------------------------------------ o único WhatsApp */
  // SÓ EXISTE UMA PORTA PRO WHATSAPP NESTA PÁGINA: o botão do simulador.
  // Foi decisão do Thiago em 04/09/2026 e é o que faz o resto funcionar — lead
  // que chega por atalho vem sem consumo, sem cidade e sem ligacão, então cai
  // na linha central sem roteamento e alguém tem que perguntar tudo de novo.
  // Passando pelo simulador, ele chega com a ficha pronta E no consultor certo.
  // Quem for acrescentar botão de WhatsApp aqui: não acrescente.
  const flutuante = document.getElementById('zap-flutuante');

  const btnSim = document.getElementById('btn-zap-simulador');
  if (btnSim) { btnSim.setAttribute('target', '_blank'); btnSim.setAttribute('rel', 'noopener'); }

  document.addEventListener('click', function (e) {
    const link = e.target.closest && e.target.closest('a[href*="wa.me/"]');
    if (!link) return;
    pixel('Contact', { origem: 'simulador' });
  });

  // O card de serviço leva pro simulador já marcando o tipo de imóvel: a pessoa
  // clicou em "rural", não faz sentido o formulário abrir em "casa".
  document.querySelectorAll('[data-tipo]').forEach(function (a) {
    a.addEventListener('click', function () {
      const alvo = document.querySelector('input[name="tipo"][value="' + a.dataset.tipo + '"]');
      if (alvo) { alvo.checked = true; alvo.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });

  /* --------------------------------------------------------------- obras */
  document.getElementById('obras-cidades').innerHTML =
    CIDADES_DAS_OBRAS.map(function (c) { return '<li>' + c + '</li>'; }).join('');

  const listaObras = document.getElementById('obras-lista');
  listaObras.innerHTML = OBRAS.map(function (o) {
    return '<article class="obra revelar">' +
      '<div class="obra__foto">' +
        '<img src="' + o.img + '" alt="' + o.alt + '" loading="lazy" width="760" height="570">' +
        '<span class="obra__badge">' + o.badge + '</span>' +
      '</div>' +
      '<div class="obra__corpo">' +
        '<h3 class="obra__bairro">' + o.bairro + '</h3>' +
        '<p class="obra__cidade">' + o.cidade + '</p>' +
        '<p class="obra__ficha">' + o.ficha.join('<br>') + '</p>' +
      '</div>' +
    '</article>';
  }).join('');

  /* ---------------------------------------------------------- depoimentos */
  // NÃO tem estrela em lugar nenhum desta seção, e é de propósito. Ninguém aqui
  // deu nota: as pessoas responderam "indicaria?" e escreveram um texto. Pintar
  // cinco estrelas em cima de "Indicaria sim" seria eu inventando a nota delas.
  // O número é a contagem de DEPOIMENTOS, não de pessoas — quatro clientes
  // aparecem nas duas fontes (Márcio, Cléber, Andrigo e Huberth mandaram
  // mensagem e também comentaram no post), então a contagem de gente é menor.
  document.getElementById('nota-valor').textContent = AVALIACAO.nota;
  document.getElementById('nota-texto').textContent = AVALIACAO.total;

  document.getElementById('depo-lista').innerHTML = DEPOIMENTOS.map(function (d) {
    // O print entra como botão porque ele ABRE alguma coisa. Se fosse só <img>
    // o leitor de tela anunciaria uma foto sem dizer que dá pra ampliar.
    const prova = d.print
      ? '<button class="depoimento__print" type="button" data-print="' + d.print + '" ' +
        'data-legenda="' + d.alt + '" aria-label="Ver o print da conversa com ' + d.nome + '">' +
          '<img src="' + d.print + '" alt="' + d.alt + '" loading="lazy">' +
          '<span class="depoimento__lupa">Ver a conversa</span>' +
        '</button>'
      : '';

    return '<article class="depoimento revelar' + (d.destaque ? ' depoimento--destaque' : '') + '">' +
      prova +
      '<div class="depoimento__corpo">' +
        '<p class="depoimento__fonte">' + d.marca + '</p>' +
        '<p class="depoimento__texto">"' + d.texto + '"</p>' +
        '<p class="depoimento__nome">' + d.nome + '</p>' +
      '</div>' +
    '</article>';
  }).join('');

  /* -------------------------------------------- comentários do Instagram */
  // Um card por cliente: o print do comentário dele sozinho, e o @ em destaque
  // logo abaixo, no tipo do site. O @ NÃO é escrito por cima da imagem — print
  // com marcação em cima deixa de servir como prova.
  document.getElementById('mural-lista').innerHTML = COMENTARIOS.map(function (c) {
    const legenda = 'Comentário de @' + c.arroba + ' no Instagram da Irmãos na Obra';
    return '<li class="comentario revelar">' +
      '<button class="comentario__print" type="button" data-print="' + c.print + '" ' +
        'data-legenda="' + legenda + '" aria-label="Ampliar o comentário de @' + c.arroba + '">' +
        '<img src="' + c.print + '" alt="' + legenda + ': ' + c.texto.replace(/"/g, '&quot;') + '" loading="lazy">' +
      '</button>' +
      '<a class="comentario__arroba" href="' + POST_INSTAGRAM + '" target="_blank" rel="noopener">@' +
        c.arroba + '</a>' +
    '</li>';
  }).join('');

  document.getElementById('mural-fonte').setAttribute('href', POST_INSTAGRAM);

  /* ------------------------------------------------------ lupa do print */
  const lupa = document.getElementById('lupa');
  const lupaImg = document.getElementById('lupa-img');
  const btnFechar = lupa.querySelector('.lupa__fechar');
  let quemAbriu = null;      // pra devolver o foco pro botão que abriu
  let overflowAntes = '';    // pra devolver a rolagem como estava, não vazia

  function abrirLupa(botao) {
    quemAbriu = botao;
    lupaImg.setAttribute('src', botao.dataset.print);
    lupaImg.setAttribute('alt', botao.dataset.legenda);
    lupa.classList.add('aberta');
    lupa.removeAttribute('hidden');
    overflowAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    btnFechar.focus();
  }
  function fecharLupa() {
    lupa.classList.remove('aberta');
    lupa.setAttribute('hidden', '');
    document.body.style.overflow = overflowAntes;
    // sem isto o foco cai no <body> e quem usa teclado ou leitor de tela perde
    // o lugar onde estava na página
    if (quemAbriu) { quemAbriu.focus(); quemAbriu = null; }
  }

  document.addEventListener('click', function (e) {
    const botao = e.target.closest && e.target.closest('[data-print]');
    if (botao) { abrirLupa(botao); return; }
    if (e.target.closest && e.target.closest('.lupa__fechar')) { fecharLupa(); return; }
    if (e.target === lupa) fecharLupa();
  });
  document.addEventListener('keydown', function (e) {
    if (!lupa.classList.contains('aberta')) return;
    if (e.key === 'Escape') { fecharLupa(); return; }
    // o diálogo diz aria-modal, então o Tab não pode escapar pra página atrás.
    // Como só existe um elemento focável aqui dentro, prender é segurar nele.
    if (e.key === 'Tab') { e.preventDefault(); btnFechar.focus(); }
  });

  /* ------------------------------------------------------- contato e redes */
  const icones = {
    zap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Z"/><path d="M8.6 8.5c0-.3.2-.5.4-.5h.6l.9 2-.5.7c.5 1 1.4 1.9 2.4 2.4l.7-.6 2 .9v.6c0 .3-.3.5-.6.5-3.3 0-5.9-2.6-5.9-6Z"/></svg>',
    fone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>',
    local: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    raio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6Z"/></svg>',
    insta: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3.6"/><path d="M17.5 6.5v.01"/></svg>',
    face: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8Z"/></svg>',
    tube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/></svg>'
  };

  document.getElementById('rodape-contato').insertAdjacentHTML('beforeend',
    '<ul>' +
      // sem linha de WhatsApp aqui: a única porta é o simulador
      '<li>' + icones.fone + '<a href="tel:+' + CONFIG.whatsapp + '">' + CONFIG.whatsappVisivel + '<br><small>Ligar agora</small></a></li>' +
      '<li>' + icones.raio + '<a href="#simulador">Simular a minha economia<br><small>e falar com um consultor</small></a></li>' +
      '<li>' + icones.email + '<a href="mailto:' + CONFIG.email + '">' + CONFIG.email + '</a></li>' +
      '<li>' + icones.local + '<span>' + CONFIG.endereco + '</span></li>' +
      '<li>' + icones.relogio + '<span>' + CONFIG.horario + '</span></li>' +
    '</ul>'
  );

  // Rede social com href '#' não vai pro rodapé: link que não leva a lugar
  // nenhum é pior do que ícone que não existe.
  const redes = [
    { url: CONFIG.instagram, icone: icones.insta, nome: 'Instagram' },
    { url: CONFIG.facebook, icone: icones.face, nome: 'Facebook' },
    { url: CONFIG.youtube, icone: icones.tube, nome: 'YouTube' }
  ].filter(function (r) { return r.url && r.url !== '#'; });

  document.getElementById('rodape-sociais').innerHTML =
    redes.map(function (r) {
      return '<a href="' + r.url + '" target="_blank" rel="noopener" aria-label="' + r.nome + '">' + r.icone + '</a>';
    }).join('');

  document.getElementById('ano').textContent = new Date().getFullYear();

  /* ---------------------------------------------------------- menu mobile */
  const botaoMenu = document.getElementById('hamburguer');
  const menu = document.getElementById('menu');

  botaoMenu.addEventListener('click', function () {
    const aberto = menu.classList.toggle('aberto');
    botaoMenu.setAttribute('aria-expanded', String(aberto));
    botaoMenu.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
  });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      menu.classList.remove('aberto');
      botaoMenu.setAttribute('aria-expanded', 'false');
    });
  });

  /* ------------------------------------------- cabeçalho e botão flutuante */
  const cabecalho = document.getElementById('cabecalho');
  function aoRolar() {
    const y = window.scrollY;
    cabecalho.classList.toggle('cabecalho--preso', y > 40);
    flutuante.classList.toggle('aparece', y > 600);
  }
  window.addEventListener('scroll', aoRolar, { passive: true });
  aoRolar();

  /* -------------------------------------------------- revelação ao rolar */
  const alvos = document.querySelectorAll('.revelar');
  if (semMovimento || !('IntersectionObserver' in window)) {
    alvos.forEach(function (a) { a.classList.add('visivel'); });
  } else {
    const observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        const irmaos = Array.prototype.slice.call(e.target.parentElement.children);
        const posicao = irmaos.indexOf(e.target);
        e.target.style.transitionDelay = Math.min(posicao, 6) * 70 + 'ms';
        e.target.classList.add('visivel');
        observador.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    alvos.forEach(function (a) { observador.observe(a); });
  }

  /* ------------------------------------------------ link ativo do menu */
  const secoes = ['inicio', 'simulador', 'servicos', 'obras', 'sobre', 'contato']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  if ('IntersectionObserver' in window) {
    const vigia = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        menu.querySelectorAll('a').forEach(function (a) {
          a.classList.toggle('ativo', a.getAttribute('href') === '#' + e.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secoes.forEach(function (s) { vigia.observe(s); });
  }
})();
