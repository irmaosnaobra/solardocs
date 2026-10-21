/* Portal do Parceiro NEXUS · Orcamento Basico (uma folha A4).
 *
 * Desenho: DocBasico.dc.html do canvas aprovado (cabecalho com co-branding e "Orcamento no · data", cliente,
 * cartao do equipamento, tabela Item / Qtd. / Valor, barra escura de total, condicoes de pagamento,
 * entrega e validade, duas linhas de assinatura e rodape).
 * Dados: os mesmos do Orcamento Basico do /gerador (orc1HTML, 19750), que alimenta a tabela: equipamento
 * do catalogo, itens da proposta, condicao de pagamento (orc1PagChips, 21038), validade (lerValidade/
 * validadeTexto, 19668/19710) e observacoes.
 *
 * Adaptado: emitente = o parceiro; sem consultor, Pix, notas internas nem "chave na mao"; o que nao esta
 * no valor sai numa linha "Fora do valor"; especificacao sem dado no catalogo sai "Consulte ficha tecnica".
 * Sem projecao financeira: o canvas trata o Basico como "itens, total e pagamento" (a conta fica no Simulador).
 */
(function () {
  'use strict';
  var C = window.NexusCalc, D = window.NexusDocs, esc = D.esc;

  D.basico = function (P) {
    var tot = P.calc.totais.total, qtd = P.quantidade;
    var precoUn = C.lerMoeda(P.form.equip.preco);

    // Chips do equipamento: so o que o catalogo sabe. Sem dado, "Consulte ficha tecnica", nunca um numero inventado.
    var chips = [];
    if (P.potenciaKw) chips.push(P.potenciaKw + ' kW');
    var sp = P.specs || {};
    var faltou = false;
    ['conectores', 'atendimento', 'comunicacao', 'refrigeracao', 'tela', 'monitoramento', 'corrente'].forEach(function (k) {
      if (sp[k]) chips.push(String(sp[k])); else faltou = true;
    });
    if (faltou) chips.push(D.SEM_DADO);
    var chipsHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');

    // Tabela: o equipamento (valor da linha = unitario x quantidade) e cada item com valor acima de zero.
    var linhas = ['<tr class="eq"><td>' + esc('Carregador ' + P.modelo)
      + (qtd > 1 ? '<small>' + qtd + ' unidades de ' + esc(C.moeda2(precoUn)) + '</small>' : '') + '</td>'
      + '<td class="q">' + qtd + '</td><td class="v">' + esc(C.moeda2(P.calc.totais.equipamento)) + '</td></tr>'];
    C.itensDe(P.form).filter(function (i) { return i.valor > 0; }).forEach(function (i) {
      linhas.push('<tr><td>' + esc(i.nome) + '</td><td class="q">1</td><td class="v">' + esc(C.moeda2(i.valor)) + '</td></tr>');
    });
    var fora = D.escopo(P).fora;

    var local = [P.cliente.local, P.cliente.tipo_local].filter(Boolean).join(' · ');
    var contatoCli = [P.cliente.doc, P.cliente.telefone, P.cliente.email].filter(Boolean).join(' · ');
    var obs = P.obsLivre;

    var html = '<div class="nb-doc"><div class="nb">'
      + '<header class="nb-topo"><div class="nb-marca">' + D.cobrand(P, 'papel') + '</div>'
      + '<p class="nb-num">Orçamento' + (P.numero ? ' nº ' + esc(P.numero) : '') + '<br>' + esc(P.data) + '</p></header>'

      + '<section class="nb-cli"><span class="rot">Cliente</span><p class="nome">' + esc(P.cliente.nome || 'Cliente') + '</p>'
      + (local ? '<p class="sub">' + esc(local) + '</p>' : '') + (contatoCli ? '<p class="sub">' + esc(contatoCli) + '</p>' : '') + '</section>'

      + '<section class="nb-eq"><div class="foto"><img src="' + D.IMG + 'dc-frente-limpo.webp" alt="' + esc(P.modelo) + '"></div>'
      + '<div class="info"><p class="nome">' + esc(P.modelo) + '</p><div class="chips">' + chipsHTML + '</div></div></section>'

      + '<section class="nb-itens"><table><thead><tr><th scope="col" class="e">Item</th><th scope="col" class="c">Qtd.</th><th scope="col" class="d">Valor</th></tr></thead>'
      + '<tbody>' + linhas.join('') + '</tbody></table>'
      + '<div class="nb-total"><span class="t">Total</span><span class="v">' + esc(C.moeda2(tot)) + '</span></div>'
      + (fora.length ? '<p class="nb-fora"><b>Fora do valor:</b> ' + esc(fora.join('; ')) + '. Combinado e orçado à parte.</p>' : '')
      + '</section>'

      + '<section class="nb-pag"><h2>Condições de pagamento</h2>' + D.pagChips(P) + '</section>'

      + '<section class="nb-ent"><p>' + esc(D.fraseEntrega(P)) + '</p><p class="val">' + esc(P.validade) + '</p>'
      + (obs ? '<p class="obs">' + esc(obs) + '</p>' : '')
      + '<p class="obs">Equipamento com garantia conforme a ficha técnica do fabricante. A venda é feita com nota fiscal.</p></section>'

      + '<section class="nb-ass"><div>Cliente</div><div>' + esc(P.empresa.nome) + '</div></section>'

      + '<footer class="nb-rodape"><p>' + esc(D.rodapeMarca(P)) + ' · ' + esc(P.distribuidor) + '</p></footer>'
      + '</div></div>';

    return { html: html, nomeArq: C.nomeArquivo('basico', P.cliente.nome, P.numero), opts: { umaPagina: true, alvo: '.nb', piso: 0.7 } };
  };
})();
