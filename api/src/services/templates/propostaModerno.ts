// Moderno (propostaSolar, modelos 2 e 3), refeito em 18/11/2026: folhas A4 em pé no lugar do documento corrido.
// Modelo 3 = capa + as mesmas folhas do modelo 2. Ordem: resumo, sistema, economia, investimento, como trabalhamos,
// garantias e aceite. Folha sem dado não sai; linha sem valor não sai. Números: todos chegam prontos (DadosModerno).
import { pBRL, pNum, pKwp, pEsc, pTel, pCnpj, qrSvg } from '../propostaSolarBase';
import { cssModerno } from './propostaModernoCss';
import { svgComoFunciona, svgArranjoCapa } from './propostaModernoGraficos';
import { palcoLogo, topoLogo } from './propostaModernoLogo';
import { folhaSistema, folhaEconomia, folhaInvestimento, folhaComoTrabalhamos } from './propostaModernoFolhas';
import type { DadosModerno, Folha } from './propostaModernoTipos';
import type { InversorProposta } from '../inversoresProposta';
import { empacotar, linhasTexto, ALTURA_TITULO, ALTURA_UTIL, type Bloco, type Pagina } from './propostaModernoPaginas';

export type { DadosModerno } from './propostaModernoTipos';

const anosTxt = (n: number, unidade = 'anos') => `${n} <small>${n === 1 && unidade === 'anos' ? 'ano' : unidade}</small>`;

function marca(d: DadosModerno, alt = 'mk'): string {
  const nome = d.contato.displayNome || 'Sua empresa';
  if (d.contato.logo && d.logoInfo) return topoLogo(d.contato.logo, nome, d.logoInfo);
  return d.contato.logo
    ? `<img src="${pEsc(d.contato.logo)}" alt="${pEsc(nome)}" width="220" height="52"/>`
    : `<span class="${alt}" translate="no">${pEsc(nome)}</span>`;
}

function waLink(d: DadosModerno): string {
  const fone = d.contato.vendWhats.replace(/^55(?=\d{10,11}$)/, '');
  const msg = `Olá${d.contato.vendedor ? ` ${d.contato.vendedor}` : ''}! Quero fechar a proposta de energia solar, ${d.cliente.nome}.`;
  return `https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`;
}

function qr(d: DadosModerno, legenda: string): string {
  if (!d.contato.vendWhats) return '';
  const fone = d.contato.vendWhats.startsWith('55') ? d.contato.vendWhats : `55${d.contato.vendWhats}`;
  const svg = qrSvg(`https://wa.me/${fone}`);
  return svg ? `<div class="qr"><div class="qb">${svg}</div><span>${legenda}</span></div>` : '';
}

function capa(d: DadosModerno): string {
  const f = d.fin, e = d.energia, s = d.sistema;
  const local = [d.cliente.cidade, d.cliente.uf].filter(Boolean).join(', ');
  const fig = [
    s.kwp > 0 ? `<div><div class="k">Sistema</div><div class="v num">${pKwp(s.kwp)} kWp</div></div>` : '',
    e.mediaMensal > 0 ? `<div><div class="k">Geração média</div><div class="v num">${pNum(e.mediaMensal)} kWh/mês</div></div>` : '',
    f.economia25 > 0 ? `<div><div class="k">Economia em 25 anos</div><div class="v num">${pBRL(f.economia25)}</div></div>` : '',
    f.paybackMeses > 0 && d.pag.investimento > 0 ? `<div><div class="k">Retorno</div><div class="v num">${pEsc(f.paybackTexto)}</div></div>` : '',
  ].filter(Boolean).join('');
  const destaque = f.economiaMensal > 0 && e.consumoKwh > 0
    ? `<div class="eco"><div class="k">Economia estimada na conta de luz</div><div class="g num">${pBRL(f.economiaMensal)} <small>por mês</small></div></div>`
    : '';
  const meta = [
    d.codigo ? `Proposta <b class="num">${pEsc(d.codigo)}</b>` : '',
    `Emitida em <b>${pEsc(d.hoje)}</b>`,
    d.validadeAte ? `Válida até <b>${pEsc(d.validadeAte)}</b>` : '',
  ].filter(Boolean).join('<br/>');
  // A logo do integrador é o destaque da capa (pedido do dono em 18/11/2026): ocupa o palco branco do topo,
  // uns 40% da folha, sem passar do tamanho natural da imagem (logo pequena não estica e não pixela).
  // Sem logo, o nome da empresa em letra grande ocupa o mesmo lugar.
  const nomeEmp = d.contato.displayNome || 'Sua empresa';
  // Logo vetorial (SVG) estica até encher o palco sem pixelar; imagem comum para no tamanho natural,
  // porque qualquer ampliação de bitmap sai serrilhada no PDF.
  const vetor = /^data:image\/svg\+xml/i.test(d.contato.logo) || /\.svg(\?|#|$)/i.test(d.contato.logo);
  const longo = d.cliente.nome.length > 30;
  const muitoLongo = d.cliente.nome.length > 50;
  const palco = d.contato.logo
    ? `<img${vetor ? ' class="vet"' : ''} src="${pEsc(d.contato.logo)}" alt="${pEsc(nomeEmp)}"/>`
    : `<div class="nm${nomeEmp.length > 40 ? ' longo' : ''}" translate="no">${pEsc(nomeEmp)}</div>`;
  // Logo ajustada pelo servidor (logoAjuste.ts): tamanho, placa e altura do palco decididos em propostaModernoLogo.
  const palcoHtml = d.contato.logo && d.logoInfo ? palcoLogo(d.contato.logo, nomeEmp, d.logoInfo) : `<div class="palco">${palco}</div>`;
  return `<div class="page capa">
  ${palcoHtml}
  <div class="cor">
    ${svgArranjoCapa()}
    <div class="tt"><p>Proposta de energia solar para</p><h1${muitoLongo ? ' class="longo muito"' : longo ? ' class="longo"' : ''}>${pEsc(d.cliente.nome)}</h1>${d.cliente.endereco || local ? `<div class="loc">${pEsc(d.cliente.endereco || local)}</div>` : ''}</div>
    ${destaque}
    ${fig ? `<div class="fig">${fig}</div>` : ''}
    <div class="meta"><div>${meta}</div>${qr(d, `Aponte a câmera<br/>e fale no WhatsApp`)}</div>
  </div>
</div>`;
}

function notaBateria(d: DadosModerno): string {
  const b = d.sistema.bateria;
  if (!b.tem) return '';
  const total = b.capacidade > 0 ? b.capacidade * Math.max(1, b.qtd) : 0;
  const totalTxt = total > 0 ? ` Capacidade total: ${total.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kWh.` : '';
  return `<div class="bat"><b>Seu sistema tem bateria.</b> Ela guarda parte da energia gerada para usar quando o sistema não produz, como à noite, e pode manter os circuitos escolhidos ligados quando falta luz da rede, conforme a configuração do projeto.${totalTxt}</div>`;
}

function folhaResumo(d: DadosModerno, indice: string): string {
  const f = d.fin, e = d.energia, s = d.sistema;
  const local = [d.cliente.cidade, d.cliente.uf].filter(Boolean).join(', ');
  const ids = [
    d.codigo ? `<div>Proposta<b class="num">${pEsc(d.codigo)}</b></div>` : '',
    `<div>Emitida em<b>${pEsc(d.hoje)}</b></div>`,
    d.validadeAte ? `<div>Válida até<b>${pEsc(d.validadeAte)}</b></div>` : '',
  ].join('');
  const topo = d.comCapa
    ? `<h2>Resumo da proposta</h2><p class="lead">O essencial em uma folha. Os detalhes vêm nas folhas seguintes.</p>`
    : `<div class="ola"><h1>${pEsc(d.cliente.nome)}</h1><div class="loc">Proposta de energia solar${local ? ` para ${pEsc(local)}` : ''}</div><div class="ids">${ids}</div></div>`;
  const comEconomia = f.economiaMensal > 0 && e.consumoKwh > 0;
  const dados = [
    f.economia25 > 0 ? `<div><div class="k">Em 25 anos</div><div class="v num">${pBRL(f.economia25)}</div></div>` : '',
    f.paybackMeses > 0 && d.pag.investimento > 0 ? `<div><div class="k">Retorno do investimento</div><div class="v num">${pEsc(f.paybackTexto)}</div></div>` : '',
    s.kwp > 0 ? `<div><div class="k">Sistema${s.qtdModulos > 0 ? ` de ${pNum(s.qtdModulos)} módulos` : ''}</div><div class="v num">${pKwp(s.kwp)} kWp</div></div>` : '',
  ].filter(Boolean).join('');
  // Índice das folhas: sai só quando a folha ficaria apertada (bateria explicada e nome longo no modelo 2).
  const cabeIndice = !s.bateria.tem || d.comCapa || d.cliente.nome.length <= 24;
  const comCip = d.cip > 0 ? ' e a iluminação pública' : '';
  const frase = comEconomia
    ? `<div class="frase">
      <div class="q">Economia estimada na conta de luz</div>
      <div class="g num">${pBRL(f.economiaMensal)} <small>por mês</small></div>
      <p class="s">Hoje a sua conta fica em torno de ${pBRL(d.contaHojeExib)}. Com o sistema, ela passa para cerca de ${pBRL(d.contaComSolarExib)}: a taxa mínima da distribuidora${comCip}.</p>
      ${dados ? `<div class="d">${dados}</div>` : ''}
    </div>`
    : s.kwp <= 0 ? '' : `<div class="frase">
      <div class="q">Seu sistema de energia solar</div>
      <div class="g num">${pKwp(s.kwp)} kWp</div>
      ${e.mediaMensal > 0 ? `<p class="s">Gera cerca de ${pNum(e.mediaMensal)} kWh por mês, ${pNum(e.geracaoAnual)} kWh no ano.</p>` : ''}
    </div>`;
  return `${topo}
  ${frase}
  <div class="bl cf"><h3>Como funciona</h3>
    ${svgComoFunciona(d.palette.c1)}
    <div class="cap">
      <div><b>Módulos</b><span>Transformam a luz do sol em energia elétrica.</span></div>
      <div><b>Inversor</b><span>Converte essa energia para o padrão da sua casa.</span></div>
      <div><b>Sua casa</b><span>Usa primeiro a energia gerada pelo sistema.</span></div>
      <div><b>Rede e créditos</b><span>A sobra vai para a rede e vira crédito nas próximas contas.</span></div>
    </div>
  </div>
  ${notaBateria(d)}
  ${indice && cabeIndice ? `<div class="bl"><h3>Nesta proposta</h3><div class="idx">${indice}</div></div>` : ''}`;
}

function folhaAceite(d: DadosModerno): Pagina[] {
  const g = d.gar, s = d.sistema;
  const cel = (num: string, k: string) => `<div><div class="g num">${num}</div><div class="k">${pEsc(k)}</div></div>`;
  // Garantia de inversor só quando a proposta diz qual inversor é (sem marca nem potência, a linha dele também não sai).
  const invInformado = s.inversores.some((i) => i.marca || i.potenciaKw > 0);
  // Prazos diferentes: uma célula por inversor, com marca e potência ("Inversor Growatt 5 kW"). Se dois ficarem com
  // o mesmo rótulo, o segundo ganha o número da linha: o mesmo rótulo nunca aparece com dois prazos.
  const vistos = new Map<string, number>();
  const rotuloInv = (i: InversorProposta, n: number): string => {
    const base = ['Inversor', i.marca || (i.potenciaKw > 0 ? '' : String(n + 1)), i.potenciaKw > 0 ? `${i.potenciaKw.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kW` : ''].filter(Boolean).join(' ');
    const vezes = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, vezes);
    return vezes > 1 ? `${base} (${vezes})` : base;
  };
  const inv = !invInformado ? [] : g.inversoresDiferentes
    ? s.inversores.map((i, n) => cel(anosTxt(i.garantiaAnos), rotuloInv(i, n)))
    : [cel(anosTxt(g.inversorUnico), s.inversores.length > 1 ? 'Inversores' : 'Inversor')];
  const celulas = [
    cel(anosTxt(g.paineis), 'Módulos, desempenho'), ...inv, cel(anosTxt(g.estrutura), 'Estrutura'),
    cel(`${g.instalacao} <small>${pEsc(g.instalacaoUnidade)}</small>`, 'Instalação'),
    ...(s.bateria.tem && g.bateria > 0 ? [cel(anosTxt(g.bateria), 'Bateria')] : []),
    ...g.extras.map((x) => cel(anosTxt(x.anos), x.nome)),
  ];
  const rotulosLongos = [...s.inversores.map((i) => `Inversor ${i.marca} 00 kW`), ...g.extras.map((x) => x.nome)].some((t) => t.length > 30);
  const linhasGar = Math.ceil(celulas.length / 4);
  const lr = (k: string, v: string) => (v ? `<tr><td>${pEsc(k)}</td><td>${v}</td></tr>` : '');
  const descSis = s.kwp > 0 ? `${pKwp(s.kwp)} kWp${s.qtdModulos > 0 ? ` com ${pNum(s.qtdModulos)} módulos` : ''}${s.bateria.tem ? ' e bateria' : ''}` : '';
  const valor = d.pag.investimento > 0
    ? `${pBRL(d.pag.investimento)}${d.pag.vista && d.pag.precoAvista > 0 ? `, ou ${pBRL(d.pag.precoAvista)} à vista` : ''}` : '';
  const resumo = [
    lr('Cliente', pEsc(d.assinaturas.cliente.nome)),
    lr(d.assinaturas.cliente.doc.startsWith('CNPJ') ? 'CNPJ' : 'CPF', pEsc(d.assinaturas.cliente.doc.replace(/^(CPF|CNPJ) /, ''))),
    lr('Telefone', d.cliente.telefone ? `<span class="num">${pEsc(pTel(d.cliente.telefone))}</span>` : ''),
    lr('E-mail', pEsc(d.cliente.email)),
    lr('Sistema', pEsc(descSis)),
    lr('Valor do projeto', valor ? `<span class="num">${valor}</span>` : ''),
    lr('Validade', d.validadeAte ? `Até ${pEsc(d.validadeAte)}` : ''),
  ].join('');
  const sig = (a: { nome: string; doc: string; detalhe: string }, papel: string) =>
    `<div class="ln"><b>${pEsc(a.nome)}</b>${a.doc ? `<span class="num">${pEsc(a.doc)}</span>` : ''}${a.detalhe ? `<span>${pEsc(a.detalhe)}</span>` : ''}<span>${papel}</span></div>`;
  const c = d.contato;
  const contato = c.vendWhats || c.vendEmail
    ? `<div class="bl contato"><div>
        <div class="k">${c.vendedor ? `Fale com ${pEsc(c.vendedor)}` : 'Fale com a gente'}</div>
        ${c.vendWhats ? `<div class="v num">${pEsc(pTel(c.vendWhats))}</div>` : ''}
        ${c.vendEmail ? `<div class="k" style="margin-top:2px">${pEsc(c.vendEmail)}</div>` : ''}
        ${c.vendWhats ? `<a href="${waLink(d)}" target="_blank" rel="noopener noreferrer">Quero fechar pelo WhatsApp</a>` : ''}
      </div>${qr(d, 'Aponte a câmera<br/>e fale no WhatsApp')}</div>`
    : '';
  const linhasResumo = (resumo.match(/<tr>/g) || []).length;
  const longoNome = Math.max(linhasTexto(d.assinaturas.empresa.nome, 44), linhasTexto(d.assinaturas.cliente.nome, 44));
  const temDetalhe = d.assinaturas.empresa.detalhe || d.assinaturas.cliente.detalhe;
  const extraTabela = linhasTexto(d.assinaturas.cliente.nome, 70) - 1 + linhasTexto(d.cliente.email, 70) - 1;
  const blocos: Bloco[] = [
    { h: 30 + linhasGar * (rotulosLongos ? 82 : 67), html: `<div class="bl gar">${celulas.join('')}</div>` },
    {
      h: 30 + 30 + linhasResumo * 33 + extraTabela * 19 + 34 + (d.assinaturas.local ? 28 : 0) + 46 + longoNome * 19 + 16 * 2 + (temDetalhe ? 16 : 0) + 8,
      html: `<div class="bl"><h3>O que está sendo aceito</h3><table class="aceite"><tbody>${resumo}</tbody></table>
    <p class="decl">Ao assinar, cliente e empresa confirmam os equipamentos, os valores e as condições desta proposta.</p>
    ${d.assinaturas.local ? `<p class="nota">${pEsc(d.assinaturas.local)}.</p>` : ''}
    <div class="sigs">${sig(d.assinaturas.empresa, 'Pela empresa')}${sig(d.assinaturas.cliente, 'Pelo cliente')}</div>
  </div>`,
    },
  ];
  // Contato: cartão com QR quando cabe na folha do aceite; senão, uma linha só com telefone e e-mail logo abaixo das
  // assinaturas (um cartão sozinho numa folha nova parece documento quebrado).
  const hCartao = contato ? 30 + 128 + (linhasTexto(c.vendedor, 50) - 1) * 16 : 0;
  const ocupado = ALTURA_TITULO + blocos.reduce((t, b) => t + b.h, 0);
  if (contato && ocupado + hCartao <= ALTURA_UTIL) blocos.push({ h: hCartao, html: contato });
  else if (contato) {
    const partes = [c.vendWhats ? `<a href="${waLink(d)}" target="_blank" rel="noopener noreferrer" class="num">${pEsc(pTel(c.vendWhats))}</a>` : '', c.vendEmail ? pEsc(c.vendEmail) : ''].filter(Boolean).join(' · ');
    blocos.push({ h: 52, html: `<p class="bl contato-linha">${c.vendedor ? `Fale com ${pEsc(c.vendedor)}: ` : 'Fale com a gente: '}${partes}</p>` });
  }
  return empacotar('Garantias e aceite', 'Os prazos de garantia de cada parte do sistema e o espaço para o aceite.', blocos);
}

export function propostaModernoHtml(d: DadosModerno): string {
  const sis = folhaSistema(d);
  const uma = (corpo: string): Pagina[] => (corpo ? [{ corpo, h: 0 }] : []);
  const folhas: Folha[] = [
    { titulo: 'Seu sistema', paginas: uma(sis.sistema) },
    { titulo: 'Equipamentos', paginas: uma(sis.equipamentos) },
    { titulo: 'Sua economia', paginas: uma(folhaEconomia(d)) },
    { titulo: 'Investimento', paginas: folhaInvestimento(d) },
    { titulo: 'Como trabalhamos', paginas: uma(folhaComoTrabalhamos(d)) },
    { titulo: 'Garantias e aceite', paginas: folhaAceite(d) },
  ].filter((x) => x.paginas.length);
  const desloc = (d.comCapa ? 1 : 0) + 1;
  // Número da primeira folha de cada seção (seção que estoura ocupa mais de uma folha).
  const inicio: number[] = [];
  let n0 = desloc + 1;
  for (const x of folhas) { inicio.push(n0); n0 += x.paginas.length; }
  const total = n0 - 1;
  const indice = folhas.map((x, i) => `<div><span>${x.titulo}</span><span class="num">Folha ${inicio[i]}</span></div>`).join('');
  const corpos = [{ corpo: folhaResumo(d, indice), h: 0 }, ...folhas.flatMap((x) => x.paginas)];
  const empresaLinha = [d.contato.displayNome, d.contato.cnpjDoc ? `CNPJ ${pCnpj(d.contato.cnpjDoc)}` : ''].filter(Boolean).join(' · ');
  const ref = `${d.codigo ? `Proposta <b class="num">${pEsc(d.codigo)}</b><br/>` : ''}${pEsc(d.cliente.nome)}`;
  const paginas = corpos.map(({ corpo: c, h }, i) => {
    const n = desloc + i;
    const fim = n === total ? '<span>Proposta gerada por SolarDoc Pro · solardoc.app</span>' : '';
    return `<div class="page"${h ? ` data-est="${h}"` : ''}>
  <div class="hd">${marca(d)}<div class="ref">${ref}</div></div>
  <div class="mn">${c}</div>
  <div class="ft"><span>${pEsc(empresaLinha)}</span>${fim}<span class="pg num">${n} de ${total}</span></div>
</div>`;
  });
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794, user-scalable=yes"/>
<title>Proposta de energia solar · ${pEsc(d.cliente.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${cssModerno(d.palette)}</style>
</head>
<body>
${d.comCapa ? capa(d) : ''}
${paginas.join('\n')}
</body>
</html>`;
}
