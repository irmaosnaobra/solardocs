/* Papéis do solar usados pelas etapas da obra: relatório de vistoria (etapa 1), proposta de banco (etapa 2) e termo de entrega (etapa 7).
 * Movido sem mudar um byte do miolo, em 06/11/2026, da faixa da tela Fechamento do index.html (Fase 3, commit 4). Script clássico, sem IIFE:
 * as funções são globais. Quem chama: jornada-obra.js, Quem ligar e o resto do index.html. Carrega antes do script grande do index.html. */
const solEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SOL_LACUNA = '<span class="ep-rec-vazio"></span>';

const solV = v => (v == null || String(v).trim() === '') ? SOL_LACUNA : solEsc(String(v).trim());

const solFmt = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function solNumExt(v) {
  const raw = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(raw) || raw < 0) return String(v == null ? '' : v);
  return recExInt(Math.floor(raw));
}

// "5 (cinco)"; vazio vira lacuna
// "1 (um) ano" / "25 (vinte e cinco) anos"; vazio vira lacuna
const solUn = (v, sing, plu) => { const t = String(v == null ? '' : v).trim(); return t ? solNumComExt(t) + ' ' + (parseInt(t, 10) === 1 ? sing : plu) : SOL_LACUNA + ' ' + plu; };

const solNumComExt = v => { const t = String(v == null ? '' : v).trim(); return t ? solEsc(t) + ' (' + solEsc(solNumExt(t)) + ')' : SOL_LACUNA; };

function solHoje() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }

function solDataLonga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function solDataCurta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

// Logradouro, Bairro, Cidade/UF (vazio quando nada foi preenchido)
function solEnd(end, bairro, cidade, uf) {
  const cu = [cidade, uf].filter(Boolean).join('/');
  return [end, bairro, cu].map(p => String(p || '').trim()).filter(Boolean).join(', ');
}

const solLimpaArq = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '');

// ── A emitente (AIOROS GROUP LTDA, marca Irmãos na Obra) ──
function solEmp() {
  const e = epEmitGet('aioros');   // solar le SEMPRE o perfil aioros, qualquer que seja o controle de emitente do eletroposto
  const cnpj = String(e.cnpj || '').trim() || CNPJ_CERTO;
  const razao = String(e.razao || '').trim() || RAZAO_CERTA;
  return {
    razao, cnpj,
    end: [e.end, e.cidade].filter(Boolean).join(', '),
    tel: e.tel || '', socio: e.socio || '', socioCpf: e.socioCpf || '',
    pix: e.pix || '', conta: e.conta || '',
  };
}

// "AIOROS GROUP LTDA (Irmãos na Obra), inscrita no CNPJ sob o nº ..., com sede em ..."
function solQualifEmp(emp) {
  return `<b>${solEsc(emp.razao)}</b> (Irmãos na Obra), inscrita no CNPJ sob o nº ${solEsc(emp.cnpj)}${emp.end ? ', com sede em ' + solEsc(emp.end) : ''}`;
}

// ── Cabeçalhos e rodapé de papel solar (a marca da casa, nunca a NEXUS) ──
const SOL_LOGO = '<img class="sol-logo" src="/gerador/logo.png" alt="Irmãos na Obra">';

// A razão social sai sempre colada ao CNPJ, logo sob a marca (o timbre do SolarDoc)
const solMarca = () => { const emp = solEmp(); return `<div class="ep-brand sol-brand">${SOL_LOGO}<div class="sol-mk">Irmãos na Obra<small>${solEsc(emp.razao)} · CNPJ ${solEsc(emp.cnpj)}</small></div></div>`; };

function solTopoCtr(ident) {
  return `<div class="ep-ctr-topo">${solMarca()}<div class="ep-ctr-ident">${ident}</div></div>`;
}

const solRodape = (rot, cliente, n, tot, rubricas) =>
  `<div class="ep-pagefoot"><span class="ep-foot-esq">${IO_FOOT_LOGO}<span>${solEsc(rot)}${cliente ? ' · ' + solEsc(cliente) : ''}</span></span>${rubricas ? `<span class="ep-rubr">Rubricas ${'<i></i>'.repeat(rubricas)}</span>` : ''}<span>${(n && tot) ? 'Página ' + n + ' de ' + tot : 'Documento de uma via'}</span></div>`;

// solar de verdade: fora eletroposto e equipamento (mesma regra do histórico, tipo e dados.produto)
const fsEhSolar = r => { if (!r) return false; const pr = r.produto || (r.dados && r.dados.produto); return !(r.tipo === 'eletroposto' || pr === 'eletroposto' || pr === 'equipamento'); };

/** "brasileiro, casado, engenheiro, portador(a) do RG nº 12.345 SSP/MG". Texto cru: quem imprime escapa. Órgão sem RG não entra. */
function solQualifPf(q) {
  const partes = [q.nac, q.ec, q.prof].filter(Boolean);
  if (q.rg) partes.push('portador(a) do RG nº ' + q.rg + (q.orgao ? ' ' + q.orgao : ''));
  return partes.join(', ');
}

// qualificação do cliente nos três papéis
// semQualif: o termo de entrega não leva a qualificação (só o contrato e a procuração)
function solQualifCli(c, estilo, semQualif) {
  const e = solEsc;
  const doc = solV(c.doc);
  const rep = c.pj && c.rep ? `, neste ato representada por ${e(c.rep)}` : '';
  const q = !semQualif && !c.pj && c.qualif ? ', ' + e(c.qualif) : '';
  if (estilo === 'm1') return c.pj
    ? `${solV(c.nome)}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${doc}, com sede em ${solV(c.endFull)}${rep}`
    : `${solV(c.nome)}${q}, pessoa física, inscrita no CPF sob o nº ${doc}, residente e domiciliada em ${solV(c.endFull)}`;
  return c.pj
    ? `${solV(c.nome)}, CNPJ nº ${doc}, sediada em ${solV(c.endFull)}${rep}`
    : `${solV(c.nome)}${q}, CPF nº ${doc}, residente na ${solV(c.endFull)}`;
}

function solGarInst(d) {
  const n = parseInt(String(d.ginst).replace(/\D/g, ''), 10) || 0;
  const un = d.ginstun === 'meses' ? (n === 1 ? 'mês' : 'meses') : (n === 1 ? 'ano' : 'anos');
  return d.ginst ? `${solEsc(d.ginst)} (${solEsc(solNumExt(d.ginst))}) ${un}` : SOL_LACUNA;
}

const solTxt = s => solEsc(s).replace(/\n/g, '<br>');

// Teto de itens da proposta de banco em 2 folhas, MEDIDO em 10/10/2026 com page.pdf() (mídia print) e
// descrições realistas de uma a duas linhas: ver teste_fechamento_solar_fase2.js. NÃO é o 8/11/13 do SolarDoc
// (aquela folha é outra, de 180 x 258 mm). Acima disso a proposta sai com 3 folhas e a tela avisa.
const FS_PB_ITENS_MAX = 13;

const fsCentTxt = c => 'R$ ' + solFmt(c / 100);

// Os blocos do epPaginar. A linha de item é UM bloco (o cabeçalho viaja junto da primeira): linha de
// equipamento nunca é cortada no meio nem fica órfã de cabeçalho. modo = '' | ' compacta' | ' super'.
function fsBancoBlocos(d, modo) {
  const e = solEsc, emp = d.emp, cli = d.cli, c = d.contas;
  const dataTxt = solDataLonga(d.data);
  const kv = (k, v, s2) => `<div${s2 ? ' class="s2"' : ''}><span class="k">${e(k)}</span><span class="v${v ? '' : ' bl'}">${v ? e(v) : ''}</span></div>`;
  const P = h => `<p class="ep-ctr-p">${h}</p>`;
  const CL = (n, t) => `<div class="ep-ctr-cl">${n}. ${e(t)}</div>`;
  // empilhado: numa linha só, o timbre (razão social + CNPJ) e a identificação se encostavam
  const ident = ['Emissão ' + e(solDataCurta(d.data)), 'Validade ' + solUn(d.validade, 'dia', 'dias'), d.prazo ? 'Entrega: ' + e(d.prazo) : ''].filter(Boolean).join('<br>');
  // Proponente do financiamento: o titular do financiamento quando está preenchido (d.fin), senão o contratante (como sempre).
  // O rodapé, o nome do arquivo e o histórico seguem o contratante: o papel é da venda dele.
  const fin = d.fin || null;
  const nomeUp = cli.nome ? cli.nome.toUpperCase() : '';
  const pNomeUp = fin ? fin.nome.toUpperCase() : nomeUp;
  const pDoc = fin ? fin.doc : cli.doc;
  const assina = (folha2) => `<div class="ep-ctr-fim">
      <p class="ep-ctr-p" style="margin-top:${folha2 ? 6 : 12}px">${d.cidade ? e(d.cidade) + ', ' : ''}${e(dataTxt)}.</p>
      <div class="ep-ctr-assin" style="margin-top:${folha2 ? 11 : 16}mm">
        <div class="a"><b>${pNomeUp ? e(pNomeUp) : '&nbsp;'}</b>${pDoc ? `<span>CPF/CNPJ ${e(pDoc)}</span>` : ''}${!fin && cli.pj && cli.rep ? `<span>representada por ${e(cli.rep)}</span>` : ''}${fin ? 'Titular do financiamento' : 'Comprador(a)'}</div>
        <div class="a"><b>${e(emp.razao)}</b><span>CNPJ ${e(emp.cnpj)}</span>Empresa</div>
      </div>
    </div>`;
  const band = (d.kwp || d.ger)
    ? `<div class="sol-band">${d.kwp ? `<div><span>Potência do sistema</span><b>${e(d.kwp)} kWp</b></div>` : ''}${d.ger ? `<div class="r"><span>Geração estimada</span><b>${e(d.ger)} kWh/mês</b></div>` : ''}</div>`
    : d.desc ? `<div class="sol-band"><div><span>Sistema</span><b>${e(d.desc)}</b></div></div>` : '';
  const linha = it => `<div class="sol-pb-it${modo}"><div class="q">${e(/^\d+$/.test(it.qtd) && +it.qtd > 0 ? +it.qtd : 1)}</div><div class="d">${e(it.desc)}</div></div>`;
  const cab = '<div class="sol-pb-th"><span>Qtd.</span><span>Equipamentos e serviços</span></div>';
  const linhasBlocos = d.itens.map((it, i) => i === 0 ? `<div class="sol-pb-tab">${cab}${linha(it)}</div>` : linha(it));
  const boxPreco = `<div class="sol-pb-box"><div class="cap">Composição do preço</div><div class="rows">
      <div class="row big"><span class="l">Valor total</span><span class="r">${fsCentTxt(c.tot)}</span></div>
      <div class="row"><span class="l">Valor equipamento</span><span class="r">${fsCentTxt(c.eq)}</span></div>
      <div class="row"><span class="l">Valor mão de obra</span><span class="r">${fsCentTxt(c.mo)}</span></div></div></div>`;
  // a caixa de pagamento só existe quando há entrada: sem isso toda proposta à vista imprimia uma "Condição de pagamento" vazia
  const boxPgto = c.ent > 0
    ? `<div class="sol-pb-box"><div class="cap">Condição de pagamento</div><div class="rows">
      <div class="row big"><span class="l">Entrada</span><span class="r">${fsCentTxt(c.ent)}</span></div>
      <div class="row"><span class="l">Saldo a financiar</span><span class="r">${fsCentTxt(c.saldo)}</span></div>
      <div class="row nota"><span class="l">${e(d.nota)}</span></div></div></div>` : '';
  return [
    solTopoCtr(ident) + `<div class="ep-ctr-tit">Proposta de banco</div><div class="ep-ctr-sub">Formalização de operação de crédito para sistema fotovoltaico</div>`,
    `<div class="sol-card"><div class="cap">Dados da operação</div><div class="kv">${kv('Cliente', pNomeUp, true)}${kv('CPF / CNPJ', pDoc)}${kv('Banco', d.banco)}${kv('Agência', d.agencia)}${kv('Conta corrente', d.conta)}</div></div>`,
    CL(1, 'Objeto') + P('Encaminhamos a V.Sa. os documentos necessários para formalização da operação de crédito destinada à aquisição de sistema fotovoltaico, conforme características e preço público à vista discriminados na folha 2 desta proposta.'),
    CL(2, 'Dados para aprovação do faturamento') + P('Para aprovação do faturamento, orçamento com os seguintes dados:') +
      `<ul class="sol-ul"><li>Nome do comprador, CPF e endereço;</li><li>Descrição completa do equipamento (quantidade, marca, modelo, ano, etc.);</li><li>Prazo de entrega.</li></ul>`,
    CL(3, 'Declarações') + P('Autorizamos o acesso aos registros contábeis da mesma, assinada abaixo pelo seu representante legal.') +
      P('Declaramos, ainda, a esse Agente Financeiro, que temos plena ciência das regras emanadas pela Agência Especial de Financiamento Industrial, no tocante à formalização das vendas dos nossos produtos, através daquela modalidade, principalmente no que tange à elaboração e apresentação de orçamentos, notas fiscais, faturas, bem como aquelas relativas à efetiva entrega do(s) bem(ns).'),
    assina(false),
    EP_QUEBRA,
    solTopoCtr(ident) + `<div class="ep-ctr-tit" style="margin:10px 0 3px">Características e preço</div><div class="ep-ctr-sub" style="margin-bottom:8px">Preço público à vista do produto</div>`,
    `<div class="sol-pb2"><div class="sol-card"><div class="cap">${fin ? 'Identificação do titular do financiamento' : 'Identificação do comprador'}</div><div class="kv">${kv('Nome', pNomeUp, true)}${kv('CPF / CNPJ', pDoc)}${kv('CEP', fin ? fin.cep : cli.cep)}${kv('Endereço de correspondência', fin ? fin.end : cli.endFull, true)}${fin ? [fin.rg ? kv('RG', fin.rg) : '', fin.tel ? kv('Telefone', fin.tel) : '', fin.qualif ? kv('Qualificação', fin.qualif, true) : '', fin.email ? kv('E-mail', fin.email, true) : ''].join('') : ''}</div></div></div>`,
    `<div class="sol-pb2">${P('Prezado(s) Senhor(s), atendendo solicitação de V.Sa., fornecemos as características e o preço público à vista do produto abaixo.')}</div>`,
    band,
    ...linhasBlocos,
    d.origem ? `<p class="sol-pb-fis">${e(d.origem)}</p>` : '',
    `<div class="sol-pb-cols${boxPgto ? '' : ' um'}">${boxPreco}${boxPgto}</div>`,
    assina(true),
  ].filter(Boolean);
}

// Tenta a tabela solta, depois a compacta e por fim a "super": a primeira que fecha em 2 folhas fica.
// A medição é do próprio navegador (epPaginar), então não há limiar chutado aqui; o teto de itens
// (FS_PB_ITENS_MAX) só serve ao aviso da tela e foi conferido contra o PDF.
function fsBancoPaginado(d, pageFoot) {
  let html = '';
  for (const modo of ['', ' compacta', ' super']) {
    html = epPaginar(fsBancoBlocos(d, modo), pageFoot);
    if ((html.match(/class="ep-page"/g) || []).length <= 2) break;
  }
  return html;
}

// ═══ TERMO DE ENTREGA ═══
// MINUTA de 10/10/2026, alinhada à cláusula 10 do contrato completo do SolarDoc ("Entrega e vistoria
// técnica"). PENDENTE DE REVISÃO DE ADVOGADO, como as outras minutas deste bloco. Uma folha só: no pior
// caso (todas as linhas da tabela cheias e ressalva de 400 caracteres) cabe reduzindo espaçamento, nunca
// o texto das declarações, que sai exatamente como foi escrito.
const FS_TERMO_ITENS = [
  'Instalação concluída, com o local limpo e sem sobra de material.',
  'Sistema ligado e gerando energia na presença do cliente.',
  'Aplicativo de monitoramento instalado no celular do cliente, com o acesso entregue.',
  'Cliente orientado sobre o funcionamento, o desligamento de emergência e os cuidados de uso.',
  'Manuais e termos de garantia dos equipamentos entregues.',
  'Telhado conferido depois da obra, com reposição das telhas danificadas quando houve.',
];

function fsTermoHTML(d) {
  const e = solEsc, cli = d.cli, emp = d.emp;
  const dataTxt = solDataLonga(d.data);
  const un = n => (parseInt(n, 10) === 1 ? 'unidade' : 'unidades');
  const cel = (k, v, cls) => v ? `<div${cls ? ` class="${cls}"` : ''}><span class="k">${e(k)}</span><span class="v">${v}</span></div>` : '';
  // Sem número, a linha não sai: a data do contrato nasce preenchida com o dia de
  // hoje, e um termo emitido semanas depois imprimiria "contrato de hoje".
  const contrato = d.cnum ? 'nº ' + e(d.cnum) + (d.cdata ? ', de ' + e(solDataLonga(d.cdata)) : '') : '';
  const modulos = (d.nmod || d.mod) ? [d.nmod ? e(d.nmod) + ' ' + un(d.nmod) : '', d.mod ? (d.nmod ? 'de ' : '') + e(d.mod) : ''].filter(Boolean).join(' ') : '';
  const inversor = (d.ninv || d.minv) ? [d.ninv ? e(d.ninv) + ' ' + un(d.ninv) : '', [d.tinv, d.minv].filter(Boolean).map(e).join(' ')].filter(Boolean).join(' · ') : '';
  const sistema = cel('Contrato de referência', contrato, 's2') + cel('Potência instalada', d.kwp ? e(d.kwp) + ' kWp' : '') +
    cel('Módulos', modulos, 's2') + cel('Número de série do inversor', d.serie ? e(d.serie) : '') +
    cel('Inversor(es)', inversor, 's2') + cel('Bateria', d.bat ? e(d.bat) : '') +
    cel('Local de instalação', d.local ? e(d.local) : '', 's3') +
    cel('Unidade consumidora', d.uc ? e(d.uc) + (d.conc ? ' · ' + e(d.conc) : '') : (d.conc ? e(d.conc) : ''), 's2') +
    cel('Instalação concluída em', d.conclusao ? e(solDataCurta(d.conclusao)) : '') + cel('Sistema liberado em', d.liberacao ? e(solDataCurta(d.liberacao)) : '');
  const estado = { sim: ['Sim', ''], na: ['Não se aplica', ' na'], pend: ['Pendente', ' pend'] };
  const conferencia = FS_TERMO_ITENS.map((t, i) => { const s = estado[d.chk[i]] || estado.pend; return `<tr><td class="n">${i + 1}.</td><td>${e(t)}</td><td class="s${s[1]}">${s[0]}</td></tr>`; }).join('');
  const gar = `As garantias previstas no contrato passam a contar desta data: ${solUn(d.gmod, 'ano', 'anos')} para os módulos e ${solUn(d.ginv, 'ano', 'anos')} para o inversor, prestadas pelo fabricante, e ${solGarInst(d)} para os serviços de instalação, prestada pela EMPRESA.`;
  const decl = [
    'O CLIENTE declara que recebeu, nesta data, o sistema de geração de energia solar fotovoltaica descrito acima, instalado e em funcionamento, conforme o contrato firmado entre as partes.',
    'O CLIENTE declara que acompanhou a conferência descrita neste termo e que foi orientado sobre a operação do sistema e sobre o acompanhamento da geração pelo aplicativo do fabricante do inversor.',
    gar,
    'A geração de energia informada na proposta e no contrato é uma estimativa. A produção real varia conforme o clima, o sombreamento, a temperatura, a limpeza dos módulos e a disponibilidade da rede da concessionária.',
    'O CLIENTE fica ciente de que intervenções no sistema feitas por terceiros sem autorização da EMPRESA podem levar à perda das garantias.',
  ].map((t, i) => `<p class="ep-ctr-li">${i + 1}. ${i === 2 ? t : e(t)}</p>`).join('');
  const ress = d.ressalva ? `<div class="sol-sec">Ressalvas</div><div class="sol-te-res"><p class="ep-ctr-p">${solTxt(d.ressalva)}</p><p class="ep-ctr-p">As pendências anotadas acima serão resolvidas pela EMPRESA e não impedem o uso do sistema.</p></div>` : '';
  return `<div class="ep-doc"><div class="ep-page ep-proc sol-te">
      ${solTopoCtr(`${e(dataTxt)}${d.cidade ? ' · ' + e(d.cidade) : ''}`)}
      <div class="ep-ctr-tit">Termo de entrega e recebimento do sistema fotovoltaico</div>
      <div class="ep-ctr-sub">Instrumento particular · ${e(dataTxt)}</div>
      <div class="sol-partes">
        <div class="sol-parte"><div class="cap">Empresa</div>${solQualifEmp(emp)}.</div>
        <div class="sol-parte"><div class="cap">Cliente</div>${solQualifCli(cli, 'm2', true)}.</div>
      </div>
      <div class="sol-sec">Sistema entregue</div>
      <div class="sol-te-sis">${sistema}</div>
      <div class="sol-sec">Conferência na entrega</div>
      <table class="sol-te-chk"><tbody>${conferencia}</tbody></table>
      <div class="sol-sec">Declarações</div>
      ${decl}
      ${ress}
      <div class="ep-ctr-fim">
        <p class="ep-ctr-p" style="margin-top:8px">Por estarem de acordo, as partes assinam este termo em 2 (duas) vias de igual teor.</p>
        <p class="ep-ctr-p">${d.cidade ? e(d.cidade) + ', ' : ''}${e(dataTxt)}.</p>
        <div class="ep-ctr-assin">
          <div class="a"><b>${e(emp.razao)}</b><span>CNPJ ${e(emp.cnpj)}</span>Empresa</div>
          <div class="a"><b>${cli.nome ? e(cli.nome.toUpperCase()) : '&nbsp;'}</b>${cli.doc ? `<span>CPF/CNPJ ${e(cli.doc)}</span>` : ''}${cli.pj && cli.rep ? `<span>representada por ${e(cli.rep)}</span>` : ''}Cliente</div>
        </div>
      </div>
      ${solRodape('Termo de entrega do sistema fotovoltaico', cli.nome)}
    </div></div>`;
}

const fsVNum = v => v.replace(/\./g, ',');

// só as linhas preenchidas, duas por linha da tabela (rótulo, valor, rótulo, valor)
function fsVistoriaTabela(titulo, linhas) {
  const cheias = linhas.filter(l => l[1]);
  if (!cheias.length) return '';
  const par = l => `<td class="k">${solEsc(l[0])}</td><td class="v">${solEsc(l[1])}</td>`;
  const trs = [];
  for (let i = 0; i < cheias.length; i += 2) trs.push(`<tr>${par(cheias[i])}${cheias[i + 1] ? par(cheias[i + 1]) : '<td colspan="2"></td>'}</tr>`);
  return `<div class="sol-vi"><div class="sol-sec">${solEsc(titulo)}</div><table class="sol-vi-sis"><tbody>${trs.join('')}</tbody></table></div>`;
}

function fsVistoriaBlocos(d) {
  const e = solEsc, emp = d.emp, cli = d.cli;
  const dataTxt = solDataLonga(d.data);
  const cidade = solEnd('', '', cli.cidade, cli.uf);
  const kv = (k, v, s2) => `<div${s2 ? ' class="s2"' : ''}><span class="k">${e(k)}</span><span class="v${v ? '' : ' bl'}">${v ? e(v) : ''}</span></div>`;
  const concl = { ok: ['ok', 'Apto para instalação', 'O imóvel recebe o sistema nas condições em que está.'],
    adeq: ['adeq', 'Apto com adequações', 'O imóvel recebe o sistema depois das adequações listadas neste relatório.'],
    nao: ['nao', 'Não apto no momento', 'O imóvel não recebe o sistema agora. O que precisa mudar está nas adequações deste relatório.'] }[d.concl];
  const ucConc = [d.uc ? 'UC ' + d.uc : '', d.conc].filter(Boolean).join(' · ');
  const potMod = [d.kwp ? d.kwp + ' kWp' : '', d.nmod ? d.nmod + (parseInt(d.nmod, 10) === 1 ? ' módulo' : ' módulos') : ''].filter(Boolean).join(' · ');
  const foto = f => `<div class="sol-vi-foto"><div class="m"><img src="${e(f.src)}" alt=""></div><div class="l"><b>${e(f.leg)}</b>${f.txt ? ' · ' + e(f.txt) : ''}</div></div>`;
  const fotoLinhas = [];
  for (let i = 0; i < d.fotos.length; i += 2) fotoLinhas.push(`<div class="sol-vi-fotos">${d.fotos.slice(i, i + 2).map(foto).join('')}</div>`);
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const mesmo = !!d.acomp && norm(d.acomp) === norm(cli.nome);
  const assin = `<div class="sol-vi ep-ctr-fim">
      <p class="ep-ctr-p" style="margin-top:6px">${cidade ? e(cidade) + ', ' : ''}${e(dataTxt)}. Este relatório registra as condições do imóvel vistas e medidas nesta data.</p>
      <div class="ep-ctr-assin"${d.acomp ? '' : ' style="justify-content:center"'}>
        <div class="a"${d.acomp ? '' : ' style="flex:0 1 52%"'}><b>${d.quem ? e(d.quem) : '&nbsp;'}</b><span>${e(emp.razao)} · CNPJ ${e(emp.cnpj)}</span>Quem vistoriou</div>
        ${d.acomp ? (mesmo
          // quem acompanhou é o próprio cliente: o nome sai uma vez só
          ? `<div class="a"><b>${e(cli.nome)}</b>${cli.doc ? `<span>CPF/CNPJ ${e(cli.doc)}</span>` : ''}Cliente, acompanhou no local</div>`
          : `<div class="a"><b>${e(d.acomp)}</b>Acompanhou no local</div>`) : ''}
      </div>
    </div>`;
  return [
    solTopoCtr(`${e(solDataCurta(d.data))}${cidade ? ' · ' + e(cidade) : ''}`) + `<div class="ep-ctr-tit">Relatório de vistoria técnica</div><div class="ep-ctr-sub">${e(dataTxt)}${cidade ? ' · ' + e(cidade) : ''}</div>`,
    `<div class="sol-card sol-vi-card"><div class="cap">Cliente e local</div><div class="kv">${kv('Cliente', cli.nome, true)}${kv('CPF / CNPJ', cli.doc)}${kv('Telefone', d.tel)}${kv('Unidade consumidora', ucConc, true)}${potMod ? kv('Sistema previsto', potMod) : ''}${kv('Local da vistoria', d.local, true)}</div></div>`,
    fsVistoriaTabela('Telhado', d.telhado), fsVistoriaTabela('Entrada de energia', d.entrada), fsVistoriaTabela('Inversor e cabos', d.inversor),
    `<div class="sol-vi"><div class="sol-vi-concl ${concl[0]}"><div class="cap">Conclusão da vistoria</div><b>${e(concl[1])}</b><div class="t">${e(concl[2])}</div></div></div>`,
    d.adeq.length ? `<div class="sol-vi"><p class="ep-ctr-p"><b>Adequações necessárias</b></p>${d.adeq.map((t, i) => `<p class="ep-ctr-li">${String.fromCharCode(97 + i)}) ${e(t)}${i < d.adeq.length - 1 ? ';' : '.'}</p>`).join('')}</div>` : '',
    d.obs ? `<div class="sol-vi"><p class="ep-ctr-p"><b>Observações.</b> ${solTxt(d.obs)}</p></div>` : '',
    assin,
    // o registro fotográfico vai depois das assinaturas, como anexo: cada linha de duas fotos é um bloco inteiro
    ...fotoLinhas.map((l, i) => i === 0 ? `<div class="sol-vi"><div class="sol-sec" style="margin-top:16px">Registro fotográfico</div>${l}</div>` : `<div class="sol-vi">${l}</div>`),
  ].filter(Boolean);
}
