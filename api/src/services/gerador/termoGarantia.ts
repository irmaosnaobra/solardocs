// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): O TERMO DE GARANTIA e a TRAVA DO BOOK. Regras puras: sem banco, sem rota e sem relógio.
//
// O texto é o do `TERMO-GARANTIA.md` (Parte A) ajustado à cláusula 4 versão 2 do `contratoSolarM2` (já no ar), em quatro pontos:
//   1. a lista da seção 2 ganha "Sujeira acumulada por falta de limpeza dos módulos.";
//   2. "Sobretensão da rede." vira "Sobretensão ou sobrecarga da rede elétrica.";
//   3. no fim da seção 2 entra "A garantia continua valendo para o resto da usina.";
//   4. a frase da lei só vale para pessoa física, e o 5º item da seção 3 muda para empresa.
// As garantias vêm do contrato (`obra.json`, `contrato`) e da Compra; o prazo da instalação sai do MESMO texto que o contrato imprimiu.
// Todo texto vai ESCAPADO no HTML. Nada daqui sai de graça: a rota passa o resultado pelo `limparHtmlPapel`.
// ─────────────────────────────────────────────────────────────────────────────
import { garantiaInstalacaoExtenso, numExtenso } from '../templateService';
import type { ContratoObra, ItemCompra } from './jornadaObra';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const comparavel = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dataBR = (ymd: string): string => (/^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);
const numPt = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');
const anosTxt = (v: number | null | undefined): string => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return `${n} (${numExtenso(n)}) ${n === 1 ? 'ano' : 'anos'}`;
};
const soDigitos = (s: string): string => s.replace(/\D/g, '');

export interface InversorTermo { qtd: number | null; marca: string; modelo: string; potencia_kw: number | null; anos: number | null; serie: string }
export interface CamposTermo {
  obra_codigo: string;
  cliente_nome: string;
  cliente_doc_tipo: 'CPF' | 'CNPJ';
  cliente_doc: string;
  pj: boolean;
  obra_endereco: string;
  obra_cidade_uf: string;
  empresa_razao_social: string;
  empresa_cnpj: string;
  empresa_whatsapp: string;
  contrato_ref: string;
  contrato_data: string;
  /** dd/mm/aaaa */
  data_entrega: string;
  responsavel_entrega: string;
  modulo: { qtd: number | null; marca: string; modelo: string; potencia_w: number | null; fabricacao_anos: number | null; desempenho_anos: number | null };
  inversores: InversorTermo[];
  sistema_kwp: string;
  instalacao_garantia: string;
  instalacao_garantia_fim: string;
  prazo_resposta: string;
}

/** Soma `n` anos ou meses a uma data `YYYY-MM-DD` (sem passar do último dia do mês de chegada). */
function somaPrazo(ymd: string, n: number, meses: boolean): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const total = (a * 12 + (m - 1)) + (meses ? n : n * 12);
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export interface EntradaTermo {
  codigo: string;
  privadaContrato: ContratoObra | null;
  itensCompra: readonly ItemCompra[];
  monitoramento: { serie: string };
  termoEntrega: { assinado_em: string; arquivo_id?: string } | null;
  /** `YYYY-MM-DD` da data do anexo `contrato_assinado`, quando houver. */
  contratoData?: string | null;
  /** `YYYY-MM-DD` da entrega (o `assinado_em` na hora de Brasília). */
  entregaYmd?: string | null;
  responsavel?: string;
  empresaTelefone?: string;
}

/** Monta os campos da Parte A do Termo (tabela A.1). Campo que falta sai vazio: a `travaDoBook` diz o que falta. */
export function camposDoTermo(e: EntradaTermo): CamposTermo {
  const c = e.privadaContrato;
  const mods = e.itensCompra.filter((i) => i.tipo === 'modulo');
  const invs = e.itensCompra.filter((i) => i.tipo === 'inversor');
  const qtdMod = mods.reduce((s, i) => s + (i.quantidade ?? 0), 0);
  const m0 = mods[0];
  const kwp = mods.reduce((s, i) => s + (i.quantidade ?? 0) * (i.potencia_w ?? 0), 0) / 1000;
  const doc = soDigitos(c?.cliente_doc ?? '');
  const pj = /pj|jur[ií]dica|empresa|cnpj/i.test(c?.cliente_tipo ?? '') || doc.length === 14;
  const meses = String(c?.garantia_instalacao_unidade ?? 'anos').toLowerCase() === 'meses';
  const prazoN = parseInt(String(c?.garantia_instalacao_anos ?? '').replace(/\D/g, ''), 10) || 0;
  const instal = c && prazoN > 0 ? garantiaInstalacaoExtenso({ garantia_instalacao_anos: c.garantia_instalacao_anos, garantia_instalacao_unidade: c.garantia_instalacao_unidade }) : '';
  const resp = parseInt(String(c?.garantia_resposta_dias ?? '').replace(/\D/g, ''), 10) || 2;
  const entrega = e.entregaYmd ?? '';
  return {
    obra_codigo: e.codigo,
    cliente_nome: c?.cliente_nome ?? '',
    cliente_doc_tipo: pj ? 'CNPJ' : 'CPF',
    cliente_doc: c?.cliente_doc ?? '',
    pj,
    obra_endereco: c?.endereco_instalacao ?? '',
    obra_cidade_uf: [c?.cidade, c?.uf].filter(Boolean).join('-'),
    empresa_razao_social: c?.empresa_nome ?? '',
    empresa_cnpj: c?.empresa_cnpj ?? '',
    empresa_whatsapp: c?.empresa_telefone || e.empresaTelefone || '',
    contrato_ref: `contrato solar da obra ${e.codigo}`,
    contrato_data: e.contratoData ? dataBR(e.contratoData) : '',
    data_entrega: entrega ? dataBR(entrega) : '',
    responsavel_entrega: e.responsavel ?? '',
    modulo: {
      qtd: qtdMod || null, marca: m0?.marca ?? '', modelo: m0?.modelo ?? '', potencia_w: m0?.potencia_w ?? null,
      fabricacao_anos: m0?.garantia_fabricacao_anos ?? null, desempenho_anos: m0?.garantia_desempenho_anos ?? null,
    },
    inversores: invs.map((i) => ({
      qtd: i.quantidade, marca: i.marca, modelo: i.modelo, potencia_kw: i.potencia_kw, anos: i.garantia_anos,
      serie: e.monitoramento.serie,
    })),
    sistema_kwp: kwp > 0 ? numPt(kwp) : '',
    instalacao_garantia: instal,
    instalacao_garantia_fim: instal && entrega ? dataBR(somaPrazo(entrega, prazoN, meses)) : '',
    prazo_resposta: `${resp} (${numExtenso(resp)}) ${resp === 1 ? 'dia útil' : 'dias úteis'}`,
  };
}

/** O HTML do Termo, com TODO texto escapado. */
export function termoGarantiaHtml(k: CamposTermo): string {
  const doc = `${k.cliente_doc_tipo} ${esc(k.cliente_doc)}`;
  const m = k.modulo;
  const linhaInv = (i: InversorTermo): string =>
    `<li>${esc(i.qtd ?? '')} ${(i.qtd ?? 1) === 1 ? 'inversor' : 'inversores'} ${esc(i.marca)} ${esc(i.modelo)}, de ${esc(i.potencia_kw === null ? '' : numPt(i.potencia_kw))} kW, número de série ${esc(i.serie)}.</li>`;
  const cobreInv = (i: InversorTermo): string =>
    `<li><b>Inversor (${esc(i.marca)}):</b> garantia do fabricante de ${esc(anosTxt(i.anos))} contra defeito de funcionamento e falha de componentes eletrônicos.</li>`;
  const item5 = k.pj
    ? 'A garantia dos equipamentos é dos fabricantes. A Irmãos na Obra ajuda você a abrir o pedido no fabricante e acompanha até o conserto ou a troca.'
    : 'A Irmãos na Obra fala com o fabricante por você, abre o pedido e acompanha até o conserto ou a troca.';
  return `<div class="termo-garantia">
<h1>TERMO DE GARANTIA DA SUA USINA SOLAR</h1>
<p>Obra ${esc(k.obra_codigo)}<br>Cliente: ${esc(k.cliente_nome)}, ${doc}.<br>Endereço da usina: ${esc(k.obra_endereco)}, ${esc(k.obra_cidade_uf)}.<br>Empresa: ${esc(k.empresa_razao_social)}, CNPJ ${esc(k.empresa_cnpj)}, marca Irmãos na Obra.<br>Contrato: ${esc(k.contrato_ref)}${k.contrato_data ? `, assinado em ${esc(k.contrato_data)}` : ''}.<br>Data de entrega: ${esc(k.data_entrega)}.</p>
<h2>Sua usina</h2>
<ul>
<li>${esc(m.qtd ?? '')} placas ${esc(m.marca)} ${esc(m.modelo)}, de ${esc(m.potencia_w ?? '')} W cada, num total de ${esc(k.sistema_kwp)} kWp.</li>
${k.inversores.map(linhaInv).join('\n')}
</ul>
<h2>1. O que está coberto e por quanto tempo</h2>
<ul>
<li><b>Placas (${esc(m.marca)}):</b> garantia do fabricante de ${esc(anosTxt(m.fabricacao_anos))} contra defeito de fabricação e de ${esc(anosTxt(m.desempenho_anos))} de desempenho. Desempenho é a potência mínima que o fabricante promete no certificado.</li>
${k.inversores.map(cobreInv).join('\n')}
<li><b>Instalação:</b> garantia da Irmãos na Obra de ${esc(k.instalacao_garantia)}, até ${esc(k.instalacao_garantia_fim)}. Ela vale para o defeito que vier da obra e for confirmado na visita técnica, como fixação, vedação nos pontos de fixação, cabos, conexões, quadro de proteção e aterramento. Nesse prazo, a Irmãos na Obra corrige o defeito sem custo.</li>
</ul>
<p>O certificado de cada fabricante vem neste Book, e as condições de cada equipamento são as do certificado dele.</p>
${k.pj ? '' : '<p>Essas garantias se somam à garantia que a lei dá.</p>\n'}<p>A geração mostrada na proposta é uma estimativa. Ela muda com o sol de cada mês e com sombra que apareça depois da obra.</p>
<h2>2. Quando o conserto da instalação é por orçamento</h2>
<p>A garantia da instalação vale para o uso normal da usina. O dano causado por um destes casos é consertado por orçamento, que você recebe antes e aprova:</p>
<ul>
<li>Mau uso, como limpar as placas com produto ou ferramenta que o manual do fabricante proíbe.</li>
<li>Conserto, alteração ou mudança na usina feita por quem a Irmãos na Obra não autorizou.</li>
<li>Raio, granizo, enchente, vendaval ou outra força maior.</li>
<li>Sobretensão ou sobrecarga da rede elétrica.</li>
<li>Obra no imóvel que atinja a usina, como reforma do telhado ou da parte elétrica.</li>
<li>Sujeira acumulada por falta de limpeza dos módulos.</li>
</ul>
<p>A garantia continua valendo para o resto da usina.</p>
<p>Para as placas e o inversor, o que a garantia cobre está no certificado de cada fabricante.</p>
<h2>3. Como pedir a garantia</h2>
<ul>
<li>Chame a Irmãos na Obra no WhatsApp ${esc(k.empresa_whatsapp)}.</li>
<li>Mande o código da obra (${esc(k.obra_codigo)}), o que aconteceu, uma foto do visor do inversor e uma foto do problema.</li>
<li>Se puder, mande também um print do app de monitoramento.</li>
<li>A Irmãos na Obra responde em até ${esc(k.prazo_resposta)}. Quando precisar de visita, ela é marcada nessa resposta.</li>
<li>${esc(item5)}</li>
<li>Quando o caso for de orçamento, você recebe o valor antes e decide se faz.</li>
<li>Se sentir cheiro de queimado ou vir fumaça ou faísca, desligue o disjuntor da usina, como mostrado na entrega, e chame a Irmãos na Obra.</li>
</ul>
<h2>4. Seus cuidados com a usina</h2>
<p>Estes cuidados mantêm a usina e a garantia em dia.</p>
<ul>
<li>Limpe as placas ao menos 1 (uma) vez por ano, e antes se a sujeira aparecer. Use só água e pano ou escova macia, de manhã cedo ou no fim da tarde.</li>
<li>Não suba no telhado sem equipamento de segurança. Se preferir, a Irmãos na Obra faz a limpeza e a revisão das conexões por orçamento.</li>
<li>Não abra o inversor nem o quadro de proteção. Ligar e desligar o disjuntor da usina, como mostrado na entrega, você pode.</li>
<li>Fale com a Irmãos na Obra antes de deixar outra pessoa mexer na usina e antes de reformar o telhado ou a parte elétrica.</li>
<li>Deixe o inversor ligado ao Wi-Fi e o app do fabricante instalado. Se trocar o roteador ou a senha do Wi-Fi, avise para a Irmãos na Obra religar o inversor.</li>
<li>Olhe o app de vez em quando. Avise se aparecer alerta ou se a geração cair sem motivo.</li>
</ul>
<h2>5. Assinaturas</h2>
<p>Este termo resume as garantias do ${esc(k.contrato_ref)} e vale junto com ele.<br>Recebi este termo, os certificados de garantia dos fabricantes e os manuais dos equipamentos.<br>As garantias começam na data de entrega da usina: ${esc(k.data_entrega)}.</p>
<p>${esc(k.obra_cidade_uf)}, ${esc(k.data_entrega)}.</p>
<p>Cliente: ________________________________<br>${esc(k.cliente_nome)}, ${doc}</p>
<p>Irmãos na Obra: ________________________________<br>${esc(k.responsavel_entrega)}, por ${esc(k.empresa_razao_social)}</p>
<p>Vale a assinatura na tela ou por plataforma de assinatura eletrônica.</p>
</div>`;
}

/**
 * O que falta para o Book sair (lista vazia = sai), na ordem da SPEC J07: marca, potência e quantidade contra o contrato; garantia do inversor
 * contra a do contrato; garantia de desempenho das placas contra a do contrato; instalação do contrato. Depois, as faltas de dado.
 */
export function travaDoBook(k: CamposTermo, contrato: ContratoObra | null, itens: readonly ItemCompra[], termoAssinado = true): string[] {
  const f: string[] = [];
  if (!contrato) return ['O contrato desta obra não tem os dados de garantia. Gere o contrato na etapa 2.'];
  const mods = itens.filter((i) => i.tipo === 'modulo');
  const invs = itens.filter((i) => i.tipo === 'inversor');
  // 1. marca, potência e quantidade
  if (!mods.length) f.push('Falta cadastrar as placas na Compra.');
  else {
    const marca = mods[0].marca;
    if (marca && contrato.marca_modulos && comparavel(marca) !== comparavel(contrato.marca_modulos)) {
      f.push(`A marca das placas da Compra (${marca}) é diferente da do contrato (${contrato.marca_modulos}).`);
    }
    const qtd = mods.reduce((s, i) => s + (i.quantidade ?? 0), 0);
    const qtdC = parseInt(contrato.quantidade_modulos.replace(/\D/g, ''), 10);
    if (qtdC && qtd && qtd !== qtdC) f.push(`A quantidade de placas da Compra (${qtd}) é diferente da do contrato (${qtdC}).`);
    const kwpC = parseFloat(contrato.kwp.replace(',', '.'));
    const kwp = mods.reduce((s, i) => s + (i.quantidade ?? 0) * (i.potencia_w ?? 0), 0) / 1000;
    if (Number.isFinite(kwpC) && kwpC > 0 && kwp > 0 && Math.abs(kwp - kwpC) > 0.01) {
      f.push(`A potência das placas da Compra (${numPt(kwp)} kWp) é diferente da do contrato (${numPt(kwpC)} kWp).`);
    }
  }
  if (!invs.length) f.push('Falta cadastrar o inversor na Compra.');
  else if (invs[0].marca && contrato.marca_inversor && comparavel(invs[0].marca) !== comparavel(contrato.marca_inversor)) {
    f.push(`A marca do inversor da Compra (${invs[0].marca}) é diferente da do contrato (${contrato.marca_inversor}).`);
  }
  // 2. garantia do inversor
  const gInvC = parseInt(contrato.garantia_inversor_anos.replace(/\D/g, ''), 10);
  for (const i of invs) {
    if (i.garantia_anos !== null && gInvC && i.garantia_anos !== gInvC) {
      f.push(`A garantia do inversor da Compra (${i.garantia_anos} anos) é diferente da do contrato (${gInvC} anos).`);
      break;
    }
  }
  // 3. garantia de desempenho das placas
  const gModC = parseInt(contrato.garantia_modulos_anos.replace(/\D/g, ''), 10);
  if (mods.length && mods[0].garantia_desempenho_anos !== null && gModC && mods[0].garantia_desempenho_anos !== gModC) {
    f.push(`A garantia de desempenho das placas da Compra (${mods[0].garantia_desempenho_anos} anos) é diferente da do contrato (${gModC} anos).`);
  }
  // 4. instalação
  if (!parseInt(contrato.garantia_instalacao_anos.replace(/\D/g, ''), 10)) f.push('O contrato não tem a garantia da instalação.');
  // Faltas de dado.
  for (const i of mods) if (i.garantia_fabricacao_anos === null || i.garantia_desempenho_anos === null) { f.push('Falta a garantia de fabricação e de desempenho das placas na Compra.'); break; }
  for (const i of invs) if (i.garantia_anos === null) { f.push('Falta a garantia do inversor na Compra.'); break; }
  if (!k.inversores.length || k.inversores.some((i) => !i.serie)) f.push('Falta o número de série do inversor na Entrega.');
  if (!termoAssinado || !k.data_entrega) f.push('Falta o termo de entrega assinado.');
  if (!contrato.cliente_nome || !contrato.cliente_doc) f.push('O contrato não tem o nome ou o documento do cliente.');
  return f;
}
