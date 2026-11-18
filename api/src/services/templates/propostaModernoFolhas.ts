// Folhas do meio do Moderno: sistema, economia, investimento e como trabalhamos. Cada função devolve o miolo de
// uma folha A4 (sem cabeçalho nem rodapé) ou '' quando não há dado para mostrar. Linha sem valor não sai.
import { pBRL, pNum, pKwp, pEsc } from '../propostaSolarBase';
import { MESES_ABREV } from '../propostaSolarData';
import { totalKwInversores } from '../inversoresProposta';
import { svgGeracaoConsumo, svgCurvas, barraSaldo } from './propostaModernoGraficos';
import type { DadosModerno } from './propostaModernoTipos';
import { empacotar, linhasTexto, type Bloco, type Pagina } from './propostaModernoPaginas';

const kw = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dec = (n: number, casas = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const celula = (k: string, v: string, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><div class="k">${pEsc(k)}</div><div class="v">${v}</div></div>`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Seu sistema. Com foto, endereço longo e muitas linhas de equipamento a folha passaria de 1122 px: aí a tabela
 * de equipamentos vai para uma folha própria (`equipamentos`). Peso medido no navegador: cada linha da tabela
 * custa 36 px, a foto vale 3 linhas e o endereço longo 1; a partir de 7 a folha estoura.
 */
export function folhaSistema(d: DadosModerno): { sistema: string; equipamentos: string } {
  const s = d.sistema, e = d.energia;
  const local = [d.cliente.cidade, d.cliente.uf].filter(Boolean).join(' / ');
  const cels = [
    s.kwp > 0 ? celula('Potência instalada', `<span class="num">${pKwp(s.kwp)} kWp</span>`) : '',
    e.mediaMensal > 0 ? celula('Geração média', `<span class="num">${pNum(e.mediaMensal)} kWh/mês</span>`) : '',
    e.geracaoAnual > 0 ? celula('Geração no ano', `<span class="num">${pNum(e.geracaoAnual)} kWh</span>`) : '',
    e.consumoKwh > 0 ? celula('Seu consumo médio', `<span class="num">${pNum(e.consumoKwh)} kWh/mês</span>`) : '',
    s.areaM2 > 0 ? celula('Área ocupada', `<span class="num">${dec(s.areaM2)} m²</span>`) : '',
    s.tipoTelhado ? celula('Telhado', pEsc(s.tipoTelhado)) : '',
    local && !d.cliente.endereco ? celula(d.cliente.cidade ? 'Local' : 'Estado', pEsc(local)) : '',
    d.cliente.endereco ? celula('Endereço da instalação', pEsc(d.cliente.endereco), 'larga') : '',
  ].filter(Boolean).join('');
  const ficha = `<div class="ficha">${cels}</div>`;
  const topo = s.fotoTelhado
    ? `<div class="sis"><figure class="foto"><img src="${pEsc(s.fotoTelhado)}" alt="Local da instalação" width="268" height="200"/><figcaption>${d.contato.vendedor ? `Vistoria feita por ${pEsc(d.contato.vendedor)}` : 'Local da instalação'}</figcaption></figure>${ficha}</div>`
    : ficha;

  const consumo = e.consumoKwh;
  const grafico = e.mensal.some((v) => v > 0) ? `<div class="bl graf">
    <h3>Geração estimada por mês</h3>
    <div class="leg"><span><i></i>Geração estimada (kWh)</span>${consumo > 0 ? '<span><i class="tr"></i>Seu consumo médio</span>' : ''}</div>
    ${svgGeracaoConsumo(e.mensal, MESES_ABREV, consumo, d.palette.c1)}
    <p class="nota">Média de sol usada no cálculo: ${dec(e.hsp)} horas por dia${d.cliente.cidade ? ` em ${pEsc(d.cliente.cidade)}` : ''}. A energia que sobra em um mês vira crédito na conta e abate o consumo dos meses seguintes.</p>
  </div>` : '';

  const linhas: string[] = [];
  const espMod = [s.marcaModulo.trim(), s.potenciaModulo > 0 ? `${s.potenciaModulo} W` : ''].filter(Boolean).join(', ');
  if (espMod || s.qtdModulos > 0) linhas.push(`<tr><td>Módulos fotovoltaicos</td><td>${pEsc(espMod || 'Módulos do projeto')}</td><td class="q">${s.qtdModulos > 0 ? pNum(s.qtdModulos) : ''}</td></tr>`);
  for (const i of s.inversores) {
    const esp = [i.marca, i.potenciaKw > 0 ? `${kw(i.potenciaKw)} kW` : ''].filter(Boolean).join(', ');
    if (esp) linhas.push(`<tr><td>Inversor</td><td>${pEsc(esp)}</td><td class="q">${i.qtd}</td></tr>`);
  }
  const totInv = totalKwInversores(s.inversores);
  if (s.inversores.length > 1 && totInv > 0) linhas.push(`<tr><td>Inversores no total</td><td>${kw(totInv)} kW de potência somada</td><td class="q"></td></tr>`);
  const b = s.bateria;
  if (b.tem) linhas.push(`<tr><td>Bateria</td><td>${pEsc(b.marca)}${b.specParts.length ? `<span class="sub">${pEsc(b.specParts.join(', '))}</span>` : ''}</td><td class="q">${b.qtd > 0 ? b.qtd : 1}</td></tr>`);
  const peso = linhas.length + (s.fotoTelhado ? 3 : 0) + (d.cliente.endereco.length > 70 ? 1 : 0);
  const separar = peso >= 7;
  const equip = linhas.length ? `<div class="bl"><h3>${separar ? 'Lista de equipamentos' : 'Equipamentos'}</h3>
    <table class="eq"><thead><tr><th>Item</th><th>Especificação</th><th class="r">Qtd.</th></tr></thead><tbody>${linhas.join('')}</tbody></table>
    <p class="inc">Também fazem parte do projeto: estrutura de fixação, cabos e proteções elétricas, projeto elétrico, pedido de acesso à distribuidora e instalação.</p>
  </div>` : '';

  const sistema = `<h2>Seu sistema</h2>
  <p class="lead">${consumo > 0 ? `Dimensionado para o seu consumo médio de ${pNum(consumo)} kWh por mês.` : 'Os equipamentos e a geração estimada do seu sistema.'}</p>
  <div class="bl">${topo}</div>
  ${grafico}
  ${separar ? '' : equip}`;
  const equipamentos = separar && equip
    ? `<h2>Equipamentos</h2>
  <p class="lead">Tudo o que vai ser instalado, com marca, potência e quantidade.</p>
  ${equip}`
    : '';
  return { sistema, equipamentos };
}

export function folhaEconomia(d: DadosModerno): string {
  const f = d.fin;
  if (d.energia.consumoKwh <= 0 || f.economia25 <= 0) return '';
  const inv = d.pag.investimento;
  const anos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25];
  const ecoAno = (a: number) => (f.semSolarAcum[a - 1] - (a > 1 ? f.semSolarAcum[a - 2] : 0)) - (f.comSolarAcum[a - 1] - (a > 1 ? f.comSolarAcum[a - 2] : 0));
  const acum = (a: number) => f.semSolarAcum[a - 1] - f.comSolarAcum[a - 1];
  const saldos = anos.map((a) => acum(a) - inv);
  const anoVira = inv > 0 && f.paybackMeses > 0 ? Math.ceil(f.paybackMeses / 12) : 0;
  const linhaVira = anoVira ? anos.find((a) => a >= anoVira) : undefined;
  const linhas = anos.map((a, i) => {
    const porMes = a === 1 ? f.economiaMensal : ecoAno(a) / 12;
    const ult = inv > 0
      ? `<td class="r sd"><span>${pBRL(saldos[i])}</span>${barraSaldo(saldos[i], -inv, saldos[saldos.length - 1], d.palette.c1)}</td>`
      : `<td class="r">${pBRL(acum(a))}</td>`;
    return `<tr${a === linhaVira ? ' class="vira"' : ''}><td>Ano ${a}</td><td class="r">${pBRL(porMes)}</td><td class="r">${pBRL(ecoAno(a))}</td>${ult}</tr>`;
  }).join('');
  const pct = (n: number) => `${dec(n)}%`;
  const premissas = `Premissas: tarifa de ${d.energia.tarifa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })} por kWh com reajuste de ${pct(d.inflacaoPct)} ao ano e taxa mínima de ${pBRL(d.taxaMinima)} por mês com reajuste de ${pct(d.inflacaoTaxaMinPct)} ao ano. O cálculo considera que o sistema cobre o consumo médio informado.${d.cip > 0 ? ' A iluminação pública fica fora da comparação porque é cobrada com ou sem o sistema.' : ''} Valores estimados.`;
  return `<h2>Sua economia</h2>
  <p class="lead">Quanto você pagaria de luz com e sem o sistema, somando ano após ano. Em 25 anos, a diferença chega a ${pBRL(f.economia25)}.</p>
  <div class="bl graf">
    <div class="leg"><span><i class="cz"></i>Conta sem o sistema</span><span><i class="c1"></i>Conta com o sistema</span><span>Área clara: o que fica no seu bolso</span></div>
    ${svgCurvas(f.semSolarAcum, f.comSolarAcum, d.palette.c1)}
  </div>
  <div class="bl"><h3>Ano a ano</h3>
    <table class="anos"><thead><tr><th>Ano</th><th class="r">Economia por mês</th><th class="r">Economia no ano</th><th class="r">${inv > 0 ? 'Saldo do investimento' : 'Economia acumulada'}</th></tr></thead><tbody>${linhas}</tbody></table>
    ${linhaVira ? `<p class="nota"><b style="color:var(--ink)">O saldo fica positivo em ${pEsc(f.paybackTexto)}.</b> Até ali, a economia paga o sistema. Depois, ela é toda sua.</p>` : ''}
    <p class="nota">${premissas}</p>
  </div>`;
}

// O que o valor inclui e o que não inclui. Vai na folha do investimento quando ela tem espaço (poucas formas de
// pagamento); senão fica em Como trabalhamos. Nunca nas duas.
const BLOCO_INCLUSO = `<div class="bl dois">
    <div><h3>O valor inclui</h3><ul class="lst">
      <li>Equipamentos listados nesta proposta</li><li>Estrutura de fixação, cabos e proteções</li>
      <li>Projeto elétrico e pedido de acesso</li><li>Instalação e testes do sistema</li></ul></div>
    <div><h3>Não inclui, salvo se combinado por escrito</h3><ul class="lst nao">
      <li>Obras civis e reforma ou reforço do telhado</li><li>Troca do padrão de entrada ou do transformador</li>
      <li>Adequação da instalação elétrica existente</li></ul></div>
  </div>`;

/** Colunas da grade de parcelas: até 5 numa linha só; 6 a 8 em 4; até 12 em 6; mais que isso em 7. */
function colunasParcelas(n: number): number {
  if (n <= 5) return Math.max(3, n);
  if (n <= 8) return 4;
  return n <= 12 ? 6 : 7;
}

/** Linhas que as formas de pagamento ocupam na folha do investimento (cada uma com uns 60 px). */
function linhasPagamento(d: DadosModerno): number {
  const p = d.pag;
  const grade = (n: number) => (n ? Math.ceil(n / colunasParcelas(n)) : 0);
  return grade(p.cartao.length) + grade(p.fin.length) + (p.entrada ? 1 : 0) + (p.custom ? 1 : 0);
}

export function inclusoNoInvestimento(d: DadosModerno): boolean {
  return d.pag.investimento > 0 && linhasPagamento(d) <= 2;
}

export function folhaInvestimento(d: DadosModerno): Pagina[] {
  const p = d.pag, f = d.fin;
  if (p.investimento <= 0 && !p.custom) return [];
  const desconto = p.vista && p.precoAvista > 0;
  const blocos: Bloco[] = [];
  if (p.investimento > 0) {
    blocos.push({ h: 152, html: `<div class="bl preco"${desconto ? '' : ' style="grid-template-columns:1fr"'}>
    <div><div class="k">Valor do projeto</div><div class="g num">${pBRL(p.investimento)}</div>${!desconto && p.vista ? '<div class="s">Pagamento à vista neste valor.</div>' : ''}</div>
    ${desconto ? `<div><div class="k">À vista</div><div class="g c num">${pBRL(p.precoAvista)}</div><div class="s">Desconto de ${pBRL(p.investimento - p.precoAvista)} no pagamento à vista.</div></div>` : ''}
  </div>` });
  }
  const grade = (l: { n: number; valor: number }[]) => `<div class="parc${l.length > 8 ? ' mini' : ''}" style="grid-template-columns:repeat(${colunasParcelas(l.length)},1fr)">${l.map((x) => `<div><div class="n">${x.n === 1 ? '1 parcela de' : `${x.n} parcelas de`}</div><div class="p">${pBRL(x.valor)}</div></div>`).join('')}</div>`;
  const altGrade = (n: number) => Math.ceil(n / colunasParcelas(n)) * (n > 8 ? 53 : 63);
  if (p.entrada) {
    blocos.push({ h: 96, html: `<div class="bl pg-grupo"><h3>Entrada e saldo</h3>
      <div class="linha-pg"><span>Entrada de <b class="num">${pBRL(p.entrada.valor)}</b> e saldo de <b class="num">${pBRL(p.entrada.restante)}</b> ${pEsc(p.entrada.prazo)}</span></div></div>` });
  }
  if (p.cartao.length) blocos.push({ h: 58 + altGrade(p.cartao.length), html: `<div class="bl pg-grupo"><h3>Cartão de crédito <span>Valores com as taxas da operadora</span></h3>${grade(p.cartao)}</div>` });
  if (p.fin.length) blocos.push({ h: 88 + altGrade(p.fin.length), html: `<div class="bl pg-grupo"><h3>Financiamento bancário <span>120 dias de carência</span></h3>${grade(p.fin)}<p class="nota">Simulação sujeita a análise de crédito do banco.</p></div>` });
  if (p.custom) blocos.push({ h: 60 + 20 * linhasTexto(p.custom, 92), html: `<div class="bl pg-grupo"><h3>Condição especial</h3><p class="esp">${pEsc(p.custom)}</p></div>` });

  const ret: string[] = [];
  if (p.investimento > 0 && f.paybackMeses > 0) ret.push(`<div><div class="k">Tempo de retorno</div><div class="v num">${pEsc(f.paybackTexto)}</div><div class="s">Quando a economia soma o valor do projeto.</div></div>`);
  if (f.economia25 > 0) ret.push(`<div><div class="k">Economia em 25 anos</div><div class="v num">${pBRL(f.economia25)}</div><div class="s">Já descontada a taxa mínima.</div></div>`);
  if (p.investimento > 0 && f.economiaMensal > 0) {
    const pct = (f.economiaMensal / p.investimento) * 100;
    ret.push(`<div><div class="k">Retorno por mês</div><div class="v num">${pct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div><div class="s">Economia do primeiro mês dividida pelo valor do projeto.</div></div>`);
  }
  if (ret.length) blocos.push({ h: 152, html: `<div class="bl"><h3>Retorno do investimento</h3><div class="ret" style="grid-template-columns:repeat(${ret.length},1fr)">${ret.join('')}</div></div>` });
  if (inclusoNoInvestimento(d)) blocos.push({ h: 204, html: BLOCO_INCLUSO });
  return empacotar('Investimento', 'Projeto completo: equipamentos, instalação, projeto elétrico e homologação na distribuidora.', blocos);
}

export function folhaComoTrabalhamos(d: DadosModerno): string {
  const etapas: [string, string][] = [
    ['Visita técnica', 'Conferimos o telhado, o padrão de entrada e o melhor lugar para os módulos.'],
    ['Projeto', 'Fazemos o projeto elétrico e a documentação técnica do sistema.'],
    ['Homologação', 'Pedimos a aprovação da distribuidora de energia. O prazo de resposta é dela.'],
    ['Instalação', 'Montamos a estrutura, os módulos e o inversor, e testamos o sistema.'],
    ['Vistoria e troca do medidor', 'A distribuidora vistoria a instalação e troca o medidor. A partir daí, a sobra de energia vira crédito.'],
  ];
  const temParcela = d.pag.cartao.length > 0 || d.pag.fin.length > 0;
  const cond = [
    d.validadeAte ? `Esta proposta vale até ${pEsc(d.validadeAte)}.` : `Esta proposta vale por ${plural(d.validadeDias, 'dia', 'dias')}.`,
    'A geração é uma estimativa feita com a média de sol da região. Ela varia com o clima, a sombra e a limpeza dos módulos.',
    'A economia usa a tarifa e os reajustes descritos na folha de economia. A tarifa real é definida pela distribuidora.',
    temParcela ? 'Parcelamento e financiamento dependem da aprovação da operadora do cartão ou do banco.' : '',
  ].filter(Boolean);
  return `<h2>Como trabalhamos</h2>
  <p class="lead">Cuidamos de cada etapa, da visita técnica até a troca do medidor.</p>
  <div class="bl prazo"><span class="g num">${d.prazoDias}</span><span>dias úteis da assinatura do contrato até o sistema ligado. O prazo pode variar conforme a aprovação da distribuidora.</span></div>
  <div class="bl etapas">${etapas.map(([t, s], i) => `<div><div class="n">${i + 1}</div><div><b>${t}</b><span>${s}</span></div></div>`).join('')}</div>
  ${inclusoNoInvestimento(d) ? '' : BLOCO_INCLUSO}
  <div class="bl"><h3>Condições</h3><ul class="cond">${cond.map((c) => `<li>${c}</li>`).join('')}</ul></div>`;
}
