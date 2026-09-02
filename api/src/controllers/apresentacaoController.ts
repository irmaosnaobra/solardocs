import { Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

// ══════════════════════════════════════════════════════════════════════════
// APRESENTAÇÃO DE PROJETO — MONTAGEM AUTOMÁTICA
// ──────────────────────────────────────────────────────────────────────────
// Recebe o que o vendedor já tem na mão (parâmetros do Simulador + orçamentos
// em PDF + fotos com legenda escrita por ele) e devolve o deck de 21 páginas
// no padrão, em PDF, pronto para apresentar.
//
// A DIVISÃO DE TRABALHO É A REGRA MAIS IMPORTANTE DESTE ARQUIVO:
//
//   • O CÁLCULO é determinístico. Todo número financeiro sai do computeEletro()
//     abaixo — cópia fiel do motor do Simulador (/gerador/index.html). A IA
//     NUNCA emite um valor em reais. Se ela emitisse, dois clientes com os
//     mesmos dados receberiam propostas diferentes, e é exatamente isso que
//     uma proposta comercial não pode fazer.
//   • A IA faz o que só ela faz: lê os orçamentos anexados para extrair
//     PARÂMETROS, decide em qual espaço do deck cada foto entra, escreve a
//     legenda de cada uma e as poucas linhas que são de verdade deste cliente
//     (a leitura do terreno, os três cartões do "por que este endereço").
//   • O TEMPLATE carrega a qualidade. Estrutura, ordem dos argumentos e número
//     de páginas são fixos. É isso que faz sair 10/10 toda vez, em vez de
//     10/10 uma vez.
//
// Saída: PDF em base64 + o relatório de onde cada foto foi parar (inclusive as
// que sobraram). Sem esse relatório o vendedor não sabe se a foto dele entrou,
// e uma ferramenta em que não se confia não é usada.
// ══════════════════════════════════════════════════════════════════════════

const MODELO = 'claude-sonnet-4-6';
const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';
const DECK_URL =
  (process.env.GERADOR_BASE_URL || 'https://solardoc.app/gerador') + '/apresentacao-deck.html';

// ── motor de cálculo: cópia fiel do computeEletro() do Simulador ───────────
// Não "melhorar" nada aqui. Se divergir do /gerador, o deck e o orçamento que o
// cliente tem na mão passam a contar histórias diferentes — e aí a apresentação
// inteira perde a validade.
export interface ParamsEletro {
  carros: number; carga: number; custoKwh: number; precoKwh: number; ativacao: number;
  invest: number; gateway: number; arrend: number; manut: number; imposto: number;
  assinat: number; fixos: number; ocupIni: number; mesesRampa: number; taxaDesc: number;
}

export function computeEletro(p: ParamsEletro) {
  const DIAS = 30, ANOS = 10;
  const kwhMes = p.carros * p.carga * DIAS;
  const sessoes = p.carros * DIAS;
  const fatMes = kwhMes * p.precoKwh + sessoes * p.ativacao;

  const custoEnergia = kwhMes * p.custoKwh;
  const taxasPct = p.gateway + p.arrend + p.manut + p.imposto;
  const seguroMes = p.invest * 0.01 / 12;
  const fixosMes = p.assinat + seguroMes + (p.fixos || 0);
  const margemVarMes = fatMes - custoEnergia - fatMes * taxasPct;
  const lucroMes = margemVarMes - fixosMes;
  const custosMes = fatMes - lucroMes;
  const margem = fatMes > 0 ? lucroMes / fatMes : 0;

  const ocupIni = Math.min(1, Math.max(0, p.ocupIni == null ? 1 : p.ocupIni));
  const mRampa = Math.max(1, Math.round(p.mesesRampa == null ? 1 : p.mesesRampa));
  const occ = (m: number) => (mRampa <= 1 || m >= mRampa) ? 1 : ocupIni + (1 - ocupIni) * (m - 1) / (mRampa - 1);

  const fluxoAnual: number[] = [];
  for (let a = 0; a < ANOS; a++) {
    let luc = 0;
    for (let m = 1; m <= 12; m++) luc += margemVarMes * occ(a * 12 + m) - fixosMes;
    fluxoAnual.push(luc);
  }
  const lucroAno1 = fluxoAnual[0];

  const fluxo: number[] = [];
  let acc = -p.invest, payback: number | null = null;
  fluxoAnual.forEach((f, i) => {
    const antes = acc; acc += f; fluxo.push(acc);
    if (payback === null && acc >= 0 && f > 0) payback = i + (0 - antes) / f;
  });
  const acumulado10 = fluxo[ANOS - 1];

  const tx = Math.max(0, p.taxaDesc || 0);
  let vpl = -p.invest;
  fluxoAnual.forEach((f, i) => { vpl += f / Math.pow(1 + tx, i + 1); });

  let tir: number | null = null;
  if (p.invest > 0 && fluxoAnual.some(f => f > 0)) {
    const npv = (r: number) => fluxoAnual.reduce((v, f, i) => v + f / Math.pow(1 + r, i + 1), -p.invest);
    if (npv(0) > 0) {
      let lo = 0, hi = 10;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
      tir = (lo + hi) / 2;
    }
  }
  return {
    kwhMes, sessoes, fatMes, custosMes, lucroMes, margem,
    fatAno: fatMes * 12, lucroAno: lucroMes * 12, lucroAno1,
    fluxo, acumulado10, payback, vpl, tir, seguroMes, fixosMes,
    ativacaoMes: sessoes * p.ativacao, custoEnergiaMes: custoEnergia,
    gatewayMes: fatMes * p.gateway, impostoMes: fatMes * p.imposto, manutMes: fatMes * p.manut,
  };
}

// ── entrada ───────────────────────────────────────────────────────────────
const fotoSchema = z.object({
  nome: z.string().default(''),
  descricao: z.string().default(''),          // o que o vendedor escreveu sobre a foto
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(10),
});
const arquivoSchema = z.object({
  nome: z.string().default(''),
  media_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(10),
});

const bodySchema = z.object({
  cliente: z.string().min(1),
  cidade: z.string().default(''),
  vendedor: z.string().default('Thiago'),
  contato: z.string().default('(34) 99136-0223'),
  validade: z.string().default(''),
  eletro: z.object({
    carros: z.number(), carga: z.number(), custoKwh: z.number(), precoKwh: z.number(),
    ativacao: z.number(), invest: z.number(), gateway: z.number(), arrend: z.number(),
    manut: z.number(), imposto: z.number(), assinat: z.number(), fixos: z.number(),
    ocupIni: z.number(), mesesRampa: z.number(), taxaDesc: z.number(),
    carregadores: z.number().default(1), bicos: z.number().default(2),
    potenciaTxt: z.string().default('DC 80 kW'),
    padraoEntrada: z.string().default(''),
  }),
  solar: z.object({
    modulos: z.number(), wpModulo: z.number().default(625), kwp: z.number(),
    geracao: z.number(), invest: z.number(), tarifa: z.number().default(1.2),
    consumoGalpao: z.number().default(0), contaMinima: z.number().default(95),
    inversores: z.string().default(''), aguas: z.array(z.object({
      placas: z.number(), onde: z.string(),
    })).default([]),
  }),
  cronograma: z.array(z.object({
    titulo: z.string(), dur: z.number(), un: z.string(), dias: z.number(),
  })).default([]),
  fotos: z.array(fotoSchema).max(20).default([]),
  arquivos: z.array(arquivoSchema).max(6).default([]),
});

// ── espaços de foto que o deck tem ────────────────────────────────────────
// A IA escolhe entre ESTES. Fora daqui não existe lugar, e é por isso que ela
// precisa poder dizer "não usei" — o deck tem 8 espaços e o vendedor manda 15.
const ESPACOS = [
  { id: 'capa',        o: 'Fundo da capa. Aérea do terreno ou fachada, de longe.' },
  { id: 'terreno',     o: 'Página "o seu telhado hoje". A aérea limpa do local, sem marcação.' },
  { id: 'layout',      o: 'Página do layout das placas. A aérea COM as águas/placas marcadas.' },
  { id: 'produto',     o: 'Página do equipamento, fundo claro. Foto do carregador, de perto.' },
  { id: 'estacao',     o: 'Fundo da ficha da estação. Carregador em uso ou instalado.' },
  { id: 'engenharia',  o: 'Fundo da página de engenharia. Quadro elétrico, padrão de entrada, string box.' },
  { id: 'obra1',       o: 'Tira de obra, etapa 1. Marcação, perfuração, início.' },
  { id: 'obra2',       o: 'Tira de obra, etapa 2. Forma, ferragem, estrutura.' },
  { id: 'obra3',       o: 'Tira de obra, etapa 3. Concretagem, base pronta, eletrodutos.' },
  { id: 'obra4',       o: 'Tira de obra, etapa 4. Quadro montado, acabamento, entrega.' },
];

// ── a IA ──────────────────────────────────────────────────────────────────
async function pensar(body: z.infer<typeof bodySchema>, calc: ReturnType<typeof computeEletro>) {
  const cli = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const conteudo: Anthropic.MessageParam['content'] = [];
  body.arquivos.forEach((a, i) => {
    conteudo.push({ type: 'text', text: `ARQUIVO ${i + 1}: ${a.nome}` } as any);
    conteudo.push(a.media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } } as any
      : { type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.base64 } } as any);
  });
  body.fotos.forEach((f, i) => {
    conteudo.push({ type: 'text', text: `FOTO ${i + 1} — o vendedor descreveu assim: "${f.descricao || '(sem descrição)'}"` } as any);
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.base64 } } as any);
  });
  conteudo.push({ type: 'text', text: `
Monte o conteúdo de texto de uma apresentação comercial da Irmãos na Obra para o cliente
${body.cliente}, em ${body.cidade}. O projeto é uma usina solar de ${body.solar.kwp} kWp
(${body.solar.modulos} módulos) mais um eletroposto ${body.eletro.potenciaTxt} com
${body.eletro.bicos} bicos, dimensionado para ${body.eletro.carros} recargas por dia.

REGRAS, todas obrigatórias:
• NÃO escreva NENHUM valor em reais, percentual financeiro, payback, TIR ou VPL. Esses
  números já foram calculados e serão inseridos pelo sistema. Se você escrever um, ele
  estará errado.
• Nada de ressalva, alerta, aviso de risco ou linguagem negativa. É uma proposta de venda,
  e tudo já passou por crivo técnico. Onde faltar informação, escreva de forma afirmativa
  o que existe, sem apontar o que falta.
• Não cite nome de fornecedor nem marca de equipamento.
• Foto que não seja do terreno deste cliente precisa de legenda dizendo que é de obra
  anterior da equipe.
• Português do Brasil, tom direto, frases curtas. Use **negrito** no que importa.
• Para cada foto, escolha UM espaço da lista, ou deixe de fora. Não repita espaço. É
  melhor deixar de fora do que colocar uma foto num espaço que não combina.

ESPAÇOS DE FOTO DISPONÍVEIS:
${ESPACOS.map(e => `  ${e.id} — ${e.o}`).join('\n')}
` } as any);

  const r = await cli.messages.create({
    model: MODELO,
    max_tokens: 4000,
    tools: [{
      name: 'montar_apresentacao',
      description: 'Devolve os textos e a distribuição de fotos da apresentação.',
      input_schema: {
        type: 'object',
        properties: {
          terrenoHoje: { type: 'string', description: 'Leitura do local em 2-3 frases, terminando na frase que abre a ferida: o terreno já está lá e não produz nada.' },
          pontoCards: { type: 'array', items: { type: 'string' }, description: 'Exatamente 3 itens curtos: por que ESTE endereço serve para um eletroposto. Cada um começa com **rótulo.**' },
          pontoFecho: { type: 'string', description: 'Uma frase de fechamento sobre o movimento do local.' },
          equipamento: { type: 'array', items: { type: 'string' }, description: '5 bullets sobre o carregador, sem marca.' },
          escopo: { type: 'array', items: { type: 'string' }, description: '6 bullets do que está incluído no chave na mão.' },
          fotos: {
            type: 'array',
            description: 'Uma entrada por foto recebida, na ordem em que chegaram.',
            items: {
              type: 'object',
              properties: {
                indice: { type: 'integer', description: 'Índice da foto, começando em 1.' },
                espaco: { type: 'string', description: 'Id do espaço escolhido, ou "nenhum".' },
                legenda: { type: 'string', description: 'Legenda curta e honesta.' },
                motivo: { type: 'string', description: 'Se ficou de fora, por quê — em uma linha.' },
              },
              required: ['indice', 'espaco', 'legenda'],
            },
          },
        },
        required: ['terrenoHoje', 'pontoCards', 'pontoFecho', 'equipamento', 'escopo', 'fotos'],
      },
    }],
    tool_choice: { type: 'tool', name: 'montar_apresentacao' },
    messages: [{ role: 'user', content: conteudo }],
  });

  const uso = r.content.find(c => c.type === 'tool_use');
  if (!uso || uso.type !== 'tool_use') throw new Error('IA não devolveu a estrutura esperada');
  return uso.input as any;
}

// ── render ────────────────────────────────────────────────────────────────
async function renderizar(deck: any) {
  const execPath = await chromium.executablePath(CHROMIUM_URL);
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--allow-file-access-from-files'],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1.5 },
    executablePath: execPath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(`window.__DECK = ${JSON.stringify(deck)};`);
    await page.goto(DECK_URL, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 1200));

    // Guarda de estouro: o deck foi desenhado com textos de um cliente. Com o texto
    // de outro, uma página pode passar da folha — e ninguém veria. Aqui a gente vê.
    // Roda no NAVEGADOR, então vai como string: o tsconfig da API é de Node e não
    // conhece document/HTMLElement.
    const estouro = (await page.evaluate(`
      Array.from(document.querySelectorAll('.slide')).map(function (s, i) {
        var w = s.querySelector('.wrap');
        if (!w) return null;
        var cs = getComputedStyle(w);
        var util = s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        var alto = 0;
        Array.from(w.children).forEach(function (c) {
          var m = getComputedStyle(c);
          alto += c.getBoundingClientRect().height + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
        });
        return alto > util ? i + 1 : null;
      }).filter(function (x) { return x !== null; })
    `)) as number[];

    const els = await page.$$('.slide');
    const doc = await PDFDocument.create();
    for (const el of els) {
      const buf = (await el.screenshot({ type: 'jpeg', quality: 88 })) as Buffer;
      const img = await doc.embedJpg(buf);
      doc.addPage([1920, 1080]).drawImage(img, { x: 0, y: 0, width: 1920, height: 1080 });
      await el.dispose();
    }
    return { pdf: Buffer.from(await doc.save()), paginas: els.length, estouro };
  } finally {
    await browser.close();
  }
}

// ── handler ───────────────────────────────────────────────────────────────
export async function montarApresentacao(req: Request, res: Response): Promise<void> {
  let etapa = 'validar';
  try {
    const body = bodySchema.parse(req.body);
    const S = body.solar, E = body.eletro;

    etapa = 'calcular';
    const calc = computeEletro(E);

    // O consolidado NÃO é a soma dos dois orçamentos: o posto revende parte da energia
    // que a usina gera, e esse kWh não pode ao mesmo tempo abater a conta e ser vendido.
    // Cada kWh entra uma vez, no destino onde rende mais.
    const consumo = S.consumoGalpao || S.geracao;
    const naoCoberto = Math.max(0, consumo - S.geracao);
    const contaHoje = consumo * S.tarifa;
    const contaDepois = naoCoberto * S.tarifa + S.contaMinima;
    const economiaSolo = contaHoje - contaDepois;
    const sobraKwh = Math.max(0, S.geracao - calc.kwhMes);
    const ecoLiquida = Math.max(0, sobraKwh * S.tarifa - S.contaMinima);
    const investTotal = S.invest + E.invest;
    const ganhoMes = ecoLiquida + calc.lucroMes;

    // payback do conjunto, mês a mês, com a rampa do posto no ano 1
    let acc = 0, meses = 0;
    const postoMes1 = calc.lucroAno1 / 12;
    while (acc < investTotal && meses < 360) { meses++; acc += ecoLiquida + (meses <= 12 ? postoMes1 : calc.lucroMes); }
    const anos = Math.floor(meses / 12), resto = meses % 12;
    const paybackConj = anos > 0
      ? `${anos} ano${anos > 1 ? 's' : ''}${resto ? ` e ${resto} ${resto > 1 ? 'meses' : 'mês'}` : ''}`
      : `${meses} meses`;

    etapa = 'ia';
    const ia = body.fotos.length || body.arquivos.length
      ? await pensar(body, calc)
      : { terrenoHoje: '', pontoCards: [], pontoFecho: '', equipamento: [], escopo: [], fotos: [] };

    etapa = 'montar-deck';
    const dataUri = (f: { media_type: string; base64: string }) => `data:${f.media_type};base64,${f.base64}`;
    const porEspaco: Record<string, { src: string; legenda: string }> = {};
    const relatorio: any[] = [];
    (ia.fotos || []).forEach((d: any) => {
      const f = body.fotos[(d.indice || 0) - 1];
      if (!f) return;
      const dentro = d.espaco && d.espaco !== 'nenhum' && !porEspaco[d.espaco];
      if (dentro) porEspaco[d.espaco] = { src: dataUri(f), legenda: d.legenda || '' };
      relatorio.push({ foto: f.nome || `foto ${d.indice}`, espaco: dentro ? d.espaco : null, legenda: d.legenda, motivo: dentro ? '' : (d.motivo || 'sem espaço compatível') });
    });

    const semSol = computeEletro({ ...E, custoKwh: S.tarifa });
    const acumDias = (() => { let t = 0; return body.cronograma.map(c => ({ ...c, dia: (t += c.dias) })); })();

    const deck = {
      cliente: body.cliente, cidade: body.cidade, cidadeCurta: body.cidade.split(/[·,-]/)[0].trim(),
      data: new Date().toLocaleDateString('pt-BR'), validade: body.validade,
      vendedor: body.vendedor, contato: body.contato,
      logos: { solar: '/gerador/logo.png', eletroposto: '/gerador/logo-eletroposto.png' },
      solar: {
        modulos: S.modulos, wpModulo: S.wpModulo, kwp: S.kwp, geracao: S.geracao,
        invest: S.invest, areaM2: Math.round(S.modulos * 2.5), tarifa: S.tarifa,
        autonomiaPct: Math.round(Math.min(1, S.geracao / Math.max(1, consumo)) * 100),
        inversores: S.inversores, contaHoje, contaDepois, economia: economiaSolo,
        paybackTxt: mesesTxt(S.invest / Math.max(1, economiaSolo)),
        aguas: S.aguas,
        incluido: ['Estrutura de fixação e materiais', 'Projeto de engenharia e conexão', 'Serviço de instalação', 'Garantias — 25 anos nos painéis'],
      },
      posto: {
        carregadores: E.carregadores, bicos: E.bicos, potenciaTxt: E.potenciaTxt,
        potenciaNum: (E.potenciaTxt.match(/[\d.,]+\s*kW/i) || ['80 kW'])[0],
        potenciaPrefixo: 'DC de', carros: E.carros, carga: E.carga, sessoes: calc.sessoes,
        kwhMes: calc.kwhMes, preco: E.precoKwh, ativacao: E.ativacao, ativacaoMes: calc.ativacaoMes,
        custoKwh: E.custoKwh, invest: E.invest, fatMes: calc.fatMes, custosMes: calc.custosMes,
        lucroMes: calc.lucroMes, margemPct: Math.round(calc.margem * 100),
        fatAno: calc.fatAno, lucroAno: calc.lucroAno, lucroAno1: calc.lucroAno1,
        paybackTxt: anosTxt(calc.payback), paybackNum: (calc.payback || 0).toFixed(1).replace('.', ','),
        paybackMes: Math.round((calc.payback || 0) * 12),
        tirPct: (calc.tir || 0) * 100, vpl: calc.vpl, taxaDescPct: E.taxaDesc * 100,
        acumulado10: calc.acumulado10, fluxo: calc.fluxo,
        padraoEntrada: E.padraoEntrada,
        custoDetalhe: `Energia R$ ${Math.round(calc.custoEnergiaMes)} · gateway **${Math.round(E.gateway * 100)}%** R$ ${Math.round(calc.gatewayMes)} · imposto **${Math.round(E.imposto * 100)}%** do Simples R$ ${Math.round(calc.impostoMes)} · assinatura R$ ${Math.round(E.assinat)} · seguro R$ ${Math.round(calc.seguroMes)}.`,
        multiplicador: semSol.lucroMes > 0 ? calc.lucroMes / semSol.lucroMes : 1,
        paybackSemSol: anosTxt(semSol.payback),
      },
      conjunto: {
        investTotal, ecoLiquida, lucroPosto: calc.lucroMes, ganhoMes,
        paybackTxt: paybackConj, sobraKwh,
      },
      cenarios: cenarios(E, calc),
      cronograma: {
        totalDias: acumDias.length ? acumDias[acumDias.length - 1].dia : 0,
        etapas: acumDias.map(c => ({ dia: c.dia, titulo: c.titulo, dur: c.dur, un: c.un, forte: c.dur >= 30 })),
        nota: 'A **logística roda em paralelo** com a análise: o pedido sai no fechamento e o material chega antes da aprovação. Nós protocolamos e acompanhamos os dois pedidos na distribuidora, a geração e a carga.',
      },
      garantias: [
        { item: 'Módulos fotovoltaicos', prazo: '25 anos', cor: 'c-sol' },
        { item: 'Inversores', prazo: '10 anos', cor: 'c-sol' },
        { item: 'Serviços de instalação e montagem', prazo: '5 anos' },
        { item: 'Carregador — garantia de fábrica', prazo: '24 meses', cor: 'c-ele' },
        { item: 'ART de projeto e de execução', prazo: 'ASSINADA', cor: 'inc' },
        { item: 'Nota fiscal de equipamento e serviço', prazo: 'EMITIDA', cor: 'inc' },
      ],
      fotos: {
        ...Object.fromEntries(Object.entries(porEspaco).map(([k, v]) => [k, v.src])),
        layoutLegenda: porEspaco.layout?.legenda || '',
        obra: ['obra1', 'obra2', 'obra3', 'obra4']
          .map((k, i) => porEspaco[k] && { src: porEspaco[k].src, etapa: `ETAPA ${i + 1}`, txt: porEspaco[k].legenda })
          .filter(Boolean),
        obraLegenda: 'Fotos de obras anteriores executadas pela equipe de montagem que atende este projeto.',
      },
      textos: {
        terrenoHoje: ia.terrenoHoje,
        pontoCards: ia.pontoCards, pontoFecho: ia.pontoFecho,
        equipamento: ia.equipamento, escopo: ia.escopo,
        engenharia: [
          '**Levantamento feito em campo** — vão, inclinação e estado de cada água',
          '**Verificação estrutural** da cobertura para o peso e a carga de vento, com memorial de cálculo',
          '**Dimensionamento elétrico** — proteções, aterramento e o ponto de conexão com o padrão de entrada',
          '**Parecer de acesso** protocolado e acompanhado por nós até a liberação',
          '**ART de projeto e de execução** assinada por engenheiro do nosso quadro',
        ],
        vantagens: [
          { n: 'R$ 0', t: 'de estrutura de solo', p: 'Os módulos são fixados por trilhos sobre as terças que já existem. Sem fundação, sem perfil metálico.' },
          { n: '0 m²', t: 'de chão ocupado', p: 'O pátio continua inteiro para a operação e para o carregador.' },
          { n: 'Obra seca', t: 'na usina', p: 'Trilho, fixação, cabo e inversor. A única obra civil é a base do carregador.' },
        ],
        mercadoStats: [
          { n: '181 mil', t: 'veículos plug-in vendidos no Brasil em 2025 — alta de **26%** em um ano.' },
          { n: '21 mil', t: 'pontos de recarga no país inteiro, somando todos os tipos.' },
          { n: '1 para 8,6', t: 'carros elétricos vendidos em 2025 para cada ponto de recarga que existe.' },
        ],
        mercadoFonte: 'Fonte: ABVE — abve.org.br',
        credenciais: [
          '**9+ anos** de energia solar — experiência real de campo, não de catálogo',
          'Equipe própria de **projeto, obra e comissionamento**',
          '**ART assinada** por engenheiro do nosso quadro, não terceirizada',
          'Atendimento nacional, com base no Triângulo Mineiro',
        ],
        pagamento: 'Condições combinadas diretamente com o vendedor. Financiamento bancário com garantia do próprio equipamento é possível.',
        notaValidade: 'Valores válidos durante o prazo desta proposta. Garantia de 24 meses do carregador a partir da emissão da nota fiscal.',
        fechamento: '**O sistema já está fechado.** O relógio começa a correr no seu aceite.',
      },
    };

    etapa = 'render';
    const { pdf, paginas, estouro } = await renderizar(deck);

    res.json({
      ok: true,
      paginas,
      pdf_base64: pdf.toString('base64'),
      nome: `Apresentacao-${body.cliente.replace(/[^\w]+/g, '')}.pdf`,
      fotos: relatorio,
      paginas_estourando: estouro,
    });
  } catch (e: any) {
    console.error('[apresentacao] falhou em', etapa, e?.message);
    res.status(500).json({ error: `Falhou em ${etapa}: ${e?.message || 'erro'}` });
  }
}

// ── auxiliares de texto ───────────────────────────────────────────────────
function anosTxt(p: number | null) {
  if (p == null) return '—';
  return p.toFixed(1).replace('.', ',') + (p < 2 ? ' ano' : ' anos');
}
function mesesTxt(m: number) {
  const t = Math.round(m), a = Math.floor(t / 12), r = t % 12;
  if (a <= 0) return `${t} meses`;
  return `${a} ano${a > 1 ? 's' : ''}${r ? ` e ${r} ${r > 1 ? 'meses' : 'mês'}` : ''}`;
}
function cenarios(E: any, base: ReturnType<typeof computeEletro>) {
  const brl = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const piso = computeEletro({ ...E, carros: Math.max(1, Math.round(E.carros * 0.67)) });
  const teto = computeEletro({ ...E, carros: Math.round(E.carros * 1.33) });
  const L = (nome: string, f: (r: any) => string) => ({ nome, piso: f(piso), base: f(base), teto: f(teto) });
  return {
    piso: `${Math.max(1, Math.round(E.carros * 0.67))} CARROS/DIA`,
    base: `${E.carros} CARROS/DIA`,
    teto: `${Math.round(E.carros * 1.33)} CARROS/DIA`,
    linhas: [
      L('Faturamento/mês — regime pleno', r => brl(r.fatMes)),
      L('Lucro/mês — regime pleno', r => brl(r.lucroMes)),
      L('Lucro do ano 1 — com rampa', r => brl(r.lucroAno1)),
      L('Payback', r => anosTxt(r.payback)),
      L('TIR', r => ((r.tir || 0) * 100).toFixed(1).replace('.', ',') + '% a.a.'),
      L('Patrimônio em 10 anos', r => brl(r.acumulado10)),
    ],
    nota: '**O projeto tem piso alto.** Mesmo no cenário conservador o posto se paga e rende bem acima de qualquer aplicação de renda fixa hoje.',
  };
}
