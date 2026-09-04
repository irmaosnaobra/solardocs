/* ==========================================================================
   Simulador de dimensionamento solar
   Roda inteiro no navegador. Não envia nem guarda dado nenhum.

   DIMENSIONAMENTO
   consumo (kWh/mês) = (conta - iluminação pública) / tarifa
   excedente         = consumo - custo de disponibilidade da ligação
   nº de painéis     = arredonda pra cima (excedente / 75)
   geração           = nº painéis x 75
   área no telhado   = nº painéis x área do painel x folga

   O 75 é a regra da casa: cada placa gera 75 kWh por mês. Antes o número de
   placas vinha de (excedente / 30) / (HSP x performance) e dava o mesmo —
   600 W x 5,2 x 0,80 x 30 = 74,9 kWh. A conta de três fatores foi trocada pelo
   número direto porque é ele que o time fala e consegue conferir de cabeça.

   O QUE CONTINUA NA CONTA DEPOIS DO SISTEMA INSTALADO
   custo de disponibilidade = kWh mínimos da ligação x tarifa
   iluminação pública       = taxa fixa do município
   Fio B (Lei 14.300)       = energia injetada x Fio B x percentual do ano

   conta nova = disponibilidade + iluminação pública + Fio B
   economia   = conta atual - conta nova

   Sem os dois últimos itens o cálculo promete economia de 95%, que não
   acontece na prática. Com eles, cai para a faixa real de 78% a 85%.
   ========================================================================== */
(function () {
  'use strict';

  const form = document.getElementById('sim-form');
  if (!form) return;

  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    cidade: document.getElementById('cidade'),
    conta: document.getElementById('conta'),
    faixaValor: document.getElementById('faixa-valor'),
    passos: document.querySelectorAll('#passos .passo'),
    btnResultado: document.getElementById('btn-resultado'),
    btnZap: document.getElementById('btn-zap-simulador'),
    resultado: document.getElementById('sim-resultado'),
    atendimento: document.querySelectorAll('input[name="atendimento"]'),
    paineis: document.getElementById('r-paineis'),
    potenciaPainel: document.getElementById('r-potencia-painel'),
    kwp: document.getElementById('r-kwp'),
    area: document.getElementById('r-area'),
    geracao: document.getElementById('r-geracao'),
    economia: document.getElementById('r-economia'),
    contaAtual: document.getElementById('r-conta-atual'),
    contaNova: document.getElementById('r-conta-nova'),
    percentual: document.getElementById('r-percentual'),
    disponibilidade: document.getElementById('r-disponibilidade'),
    cosip: document.getElementById('r-cosip'),
    fiob: document.getElementById('r-fiob')
  };

  const reais = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  const umaCasa = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /* ---------------------------------------------------------- monta a lista */
  CIDADES.forEach(function (c) {
    const op = document.createElement('option');
    op.value = c.nome;
    op.textContent = c.nome;
    el.cidade.appendChild(op);
  });
  el.potenciaPainel.textContent = PARAMS.potenciaPainel;

  /* ------------------------------------------------------------- a conta */
  function calcular() {
    const conta = Number(el.conta.value);
    const tipo = form.querySelector('input[name="tipo"]:checked').value;
    const ligacao = form.querySelector('input[name="ligacao"]:checked').value;
    const cidadeNome = el.cidade.value;
    const escolhido = document.querySelector('input[name="atendimento"]:checked');
    const cidade = CIDADES.find(function (c) { return c.nome === cidadeNome; });
    const hsp = cidade ? cidade.hsp : CIDADES[0].hsp;

    // energia de fato consumida, tirando a taxa de iluminação pública
    const consumo = Math.max(0, (conta - PARAMS.cosip)) / PARAMS.tarifa;
    const minimoKwh = PARAMS.taxaMinima[ligacao];
    const excedente = Math.max(0, consumo - minimoKwh);

    // O dimensionamento sai da regra da casa: cada placa gera 75 kWh por mês.
    // Cidade com HSP diferente do de referência gera proporcionalmente mais ou
    // menos — hoje todas estão em 5,2, então o fator é 1.
    const geracaoPainel = PARAMS.geracaoPorPainel * (hsp / PARAMS.hspBase);
    const paineis = Math.max(2, Math.ceil(excedente / geracaoPainel));
    const kwpReal = (paineis * PARAMS.potenciaPainel) / 1000;
    const geracaoMes = paineis * geracaoPainel;
    const area = paineis * PARAMS.areaPainel * PARAMS.folgaArea;

    // o que sobra na fatura todo mês, mesmo com o sistema gerando
    const custoDisponibilidade = minimoKwh * PARAMS.tarifa;
    const energiaInjetada = geracaoMes * PARAMS.fracaoInjetada;
    const custoFioB = energiaInjetada * PARAMS.fioB * PARAMS.percentualFioB;

    const contaNova = Math.min(conta, custoDisponibilidade + PARAMS.cosip + custoFioB);
    const economiaMes = Math.max(0, conta - contaNova);
    const percentual = conta > 0 ? (economiaMes / conta) * 100 : 0;

    return {
      conta: conta, tipo: tipo, ligacao: ligacao,
      consumo: consumo,
      // nasce vazio de proposito: nenhuma opcao vem marcada, entao "" quer
      // dizer que a pessoa nao escolheu — e nao que ela escolheu WhatsApp
      atendimento: escolhido ? escolhido.value : '',
      cidade: cidadeNome || '', hsp: hsp,
      paineis: paineis, kwpReal: kwpReal, geracaoMes: geracaoMes, area: area,
      geracaoPainel: geracaoPainel,
      economiaMes: economiaMes, economiaAno: economiaMes * 12,
      contaNova: contaNova, percentual: percentual,
      custoDisponibilidade: custoDisponibilidade,
      cosip: PARAMS.cosip,
      custoFioB: custoFioB
    };
  }

  /* ---------------------------------------------- anima o número da economia */
  let economiaAtual = 0;
  function pintarEconomia(valor) {
    if (semMovimento) { el.economia.textContent = reais(valor); economiaAtual = valor; return; }
    const de = economiaAtual, ate = valor, inicio = performance.now(), dur = 420;
    el.economia.classList.remove('pulsando');
    void el.economia.offsetWidth;
    el.economia.classList.add('pulsando');
    function passo(agora) {
      const t = Math.min(1, (agora - inicio) / dur);
      const suave = 1 - Math.pow(1 - t, 3);
      el.economia.textContent = reais(de + (ate - de) * suave);
      if (t < 1) requestAnimationFrame(passo);
      else economiaAtual = ate;
    }
    requestAnimationFrame(passo);
  }

  /* --------------------------------------------------------- pinta na tela */
  function atualizar(animarValor) {
    const r = calcular();

    el.paineis.textContent = r.paineis;
    el.kwp.textContent = umaCasa(r.kwpReal);
    el.area.textContent = Math.round(r.area);
    el.geracao.textContent = Math.round(r.geracaoMes).toLocaleString('pt-BR');
    el.contaAtual.textContent = reais(r.conta);
    el.contaNova.textContent = reais(r.contaNova);
    el.percentual.textContent = Math.round(r.percentual) + '% mais barata';
    el.disponibilidade.textContent = reais(r.custoDisponibilidade);
    el.cosip.textContent = reais(r.cosip);
    el.fiob.textContent = reais(r.custoFioB);

    if (animarValor) pintarEconomia(r.economiaMes);
    else { el.economia.textContent = reais(r.economiaMes); economiaAtual = r.economiaMes; }

    el.btnZap.setAttribute('href', linkWhatsapp(r));
    posicionarPino();
  }

  /* --------------------------------------------------- pra quem vai o lead */
  // Sorteia UMA vez por time e guarda. Sem isso, cada mexida no valor da conta
  // re-sortearia o dono e o lead trocaria de consultor no meio da simulacao.
  // Atravessar o corte de kWh TROCA de time, e isso e' certo: e' a regra.
  const sorteado = { alta: null, baixa: null };

  function consultorDoLead(consumoKwh) {
    const alta = consumoKwh > KWH_CORTE;
    const chave = alta ? 'alta' : 'baixa';
    if (sorteado[chave]) return sorteado[chave];

    const time = alta ? TIME_CONTA_ALTA : TIME_CONTA_BAIXA;
    const total = time.reduce(function (s, c) { return s + c.peso; }, 0);
    let n = Math.random() * total;
    let escolhido = time[time.length - 1];
    for (let i = 0; i < time.length; i++) {
      n -= time[i].peso;
      if (n <= 0) { escolhido = time[i]; break; }
    }
    sorteado[chave] = escolhido;
    return escolhido;
  }

  function linkWhatsapp(r) {
    const ligacoes = { mono: 'monofásica', bi: 'bifásica', tri: 'trifásica' };
    const onde = r.cidade ? r.cidade : 'Uberlândia e região';
    const texto =
      'Olá! Fiz a simulação no site.\n' +
      'Imóvel: ' + r.tipo + ' em ' + onde + '\n' +
      'Ligação: ' + ligacoes[r.ligacao] + '\n' +
      'Conta de luz: ' + reais(r.conta) + ' por mês\n' +
      'Resultado: ' + r.paineis + ' painéis de ' + PARAMS.potenciaPainel + 'W, ' +
      umaCasa(r.kwpReal) + ' kWp\n' +
      'Geração estimada: ' + Math.round(r.geracaoMes).toLocaleString('pt-BR') + ' kWh por mês\n' +
      'Economia estimada: ' + reais(r.economiaMes) + ' por mês (a conta cairia para ' +
      reais(r.contaNova) + ')\n' +
      // só entra a linha se a pessoa marcou. Mandar "Atendimento: WhatsApp"
      // por padrão faria o consultor ler escolha onde não houve nenhuma
      (r.atendimento ? 'Prefiro atendimento: ' + r.atendimento + '\n' : '') +
      'Quero um orçamento.';
    // aqui e' o celular do consultor, nao a linha central: quem preencheu a
    // simulacao ja' chega falando com quem vai atender
    const dono = consultorDoLead(r.consumo);
    return 'https://wa.me/' + dono.whatsapp + '?text=' + encodeURIComponent(texto);
  }

  /* ------------------------------------------------- pino do slider e trilho */
  function posicionarPino() {
    const min = Number(el.conta.min), max = Number(el.conta.max);
    const proporcao = (Number(el.conta.value) - min) / (max - min);
    el.conta.style.setProperty('--preenchido', (proporcao * 100).toFixed(2) + '%');
    el.faixaValor.textContent = reais(Number(el.conta.value));

    const trilho = el.conta.getBoundingClientRect();
    const caixa = el.faixaValor.offsetParent
      ? el.faixaValor.offsetParent.getBoundingClientRect()
      : trilho;
    const polegar = 19;
    const x = (trilho.left - caixa.left) + polegar / 2 + proporcao * (trilho.width - polegar);
    el.faixaValor.style.left = x + 'px';
  }

  /* ----------------------------------------------------- indicador de passos */
  let passoMax = 1;
  function acenderPassos(ate) {
    passoMax = Math.max(passoMax, ate);
    el.passos.forEach(function (p, i) {
      p.classList.toggle('passo--ativo', i < passoMax);
    });
  }

  /* ------------------------------------------------------------- eventos */
  form.querySelectorAll('input[name="tipo"]').forEach(function (i) {
    i.addEventListener('change', function () { acenderPassos(1); atualizar(true); });
  });
  el.cidade.addEventListener('change', function () { acenderPassos(2); atualizar(true); });
  form.querySelectorAll('input[name="ligacao"]').forEach(function (i) {
    i.addEventListener('change', function () { acenderPassos(3); atualizar(true); });
  });
  el.conta.addEventListener('input', function () { acenderPassos(4); atualizar(false); });
  el.conta.addEventListener('change', function () { atualizar(true); });
  // nao mexe no calculo, so' no texto que vai pro WhatsApp
  el.atendimento.forEach(function (i) {
    i.addEventListener('change', function () { atualizar(false); });
  });

  el.btnResultado.addEventListener('click', function () {
    if (!el.cidade.value) {
      el.cidade.focus();
      if (!semMovimento) {
        el.cidade.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
           { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: 320, easing: 'ease-out' }
        );
      }
      return;
    }
    acenderPassos(4);
    atualizar(true);
    if (window.matchMedia('(max-width: 900px)').matches) {
      el.resultado.scrollIntoView({ behavior: semMovimento ? 'auto' : 'smooth', block: 'start' });
    }
  });

  window.addEventListener('resize', posicionarPino);
  window.addEventListener('load', posicionarPino);

  atualizar(false);
})();
