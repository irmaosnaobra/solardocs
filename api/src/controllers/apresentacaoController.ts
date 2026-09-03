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

const listaTxt = z.array(z.string()).default([]);

// Quase tudo é opcional de propósito: campo em branco no formulário significa
// "não tenho esse dado", e o deck OMITE o que não recebeu em vez de imprimir
// linha vazia. É o que deixa a proposta do tamanho do que se sabe do cliente.
const bodySchema = z.object({
  cliente: z.string().min(1),
  cidade: z.string().default(''),
  vendedor: z.string().default(''),
  contato: z.string().default(''),
  validade: z.string().default(''),
  eletro: z.object({
    carros: z.number().default(0), carga: z.number().default(0),
    custoKwh: z.number().default(0), precoKwh: z.number().default(0),
    ativacao: z.number().default(0), invest: z.number().default(0),
    gateway: z.number().default(0), arrend: z.number().default(0),
    manut: z.number().default(0), imposto: z.number().default(0),
    assinat: z.number().default(0), fixos: z.number().default(0),
    ocupIni: z.number().default(1), mesesRampa: z.number().default(1),
    taxaDesc: z.number().default(0.1425),
    carregadores: z.number().default(1), bicos: z.number().default(2),
    potenciaTxt: z.string().default(''), padraoEntrada: z.string().default(''),
    transformador: z.string().default(''), tempoRecarga: z.string().default(''),
  }).default({} as any),
  solar: z.object({
    modulos: z.number().default(0), wpModulo: z.number().default(0),
    kwp: z.number().default(0), geracao: z.number().default(0),
    invest: z.number().default(0), tarifa: z.number().default(0),
    consumoGalpao: z.number().default(0), contaMinima: z.number().default(0),
    // Economia informada direto. É a saída para o Grupo A, onde economia NÃO é
    // consumo × tarifa: preenchida, ela ganha da conta calculada.
    economiaMes: z.number().default(0),
    areaM2: z.number().default(0), inversores: z.string().default(''),
    aguas: z.array(z.object({ placas: z.number(), onde: z.string() })).default([]),
    incluido: listaTxt,
  }).default({} as any),
  cronograma: z.array(z.object({
    titulo: z.string(), dur: z.number(), un: z.string(), dias: z.number(),
  })).default([]),
  garantias: z.array(z.object({ item: z.string(), prazo: z.string() })).default([]),
  escopo: listaTxt, credenciais: listaTxt, equipamento: listaTxt, pontoCards: listaTxt,
  mercado: z.array(z.object({ n: z.string(), t: z.string() })).default([]),
  // A entrada de energia é a TERCEIRA linha do investimento quando a obra do padrão
  // é grande. Ela não é do posto: atende o imóvel inteiro, e o que sobra é
  // capacidade do cliente. Escondê-la dentro do preço do posto é o que faz o
  // cliente descobrir na obra.
  entrada: z.object({
    invest: z.number().default(0), kva: z.number().default(0),
    correnteHoje: z.string().default(''), correnteNova: z.string().default(''),
    cargaCarregador: z.string().default(''), cargaUsina: z.string().default(''),
    sobra: z.string().default(''), descricao: z.string().default(''),
  }).default({} as any),
  // O que a conta de luz do cliente disse. É a única fonte da tarifa que ele paga
  // de verdade — com bandeira, PIS/COFINS e ICMS já embutidos, no mês certo.
  conta: z.object({
    concessionaria: z.string().default(''), grupo: z.string().default(''),
    subgrupo: z.string().default(''), demandaKw: z.number().default(0),
    totalReais: z.number().default(0), kwh: z.number().default(0), mes: z.string().default(''),
  }).default({} as any),
  textos: z.object({
    terrenoHoje: z.string().default(''), pontoFecho: z.string().default(''),
    pagamento: z.string().default(''), notaValidade: z.string().default(''),
    fechamento: z.string().default(''),
  }).default({} as any),
  fotos: z.array(fotoSchema).max(20).default([]),
  arquivos: z.array(arquivoSchema).max(8).default([]),
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
    // A descrição do vendedor é OPCIONAL e entra como correção, não como
    // requisito: o modelo está vendo a foto: pedir que alguém digite o que ela
    // mostra é pedir que a pessoa faça o trabalho do modelo. Quando ela existe,
    // manda — é o conserto para a foto que o modelo lê errado.
    conteudo.push({ type: 'text', text: f.descricao
      ? `FOTO ${i + 1} — olhe a imagem e, se ela discordar, siga o que o vendedor escreveu: "${f.descricao}"`
      : `FOTO ${i + 1} — olhe a imagem e diga você mesmo o que ela mostra.` } as any);
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.base64 } } as any);
  });
  const jaTem = [
    body.textos.terrenoHoje && 'terrenoHoje',
    body.pontoCards.length && 'pontoCards',
    body.textos.pontoFecho && 'pontoFecho',
    body.equipamento.length && 'equipamento',
    body.escopo.length && 'escopo',
  ].filter(Boolean) as string[];
  conteudo.push({ type: 'text', text: `
${jaTem.length ? `O consultor JÁ ESCREVEU estes campos e você NÃO deve reescrevê-los — devolva-os vazios: ${jaTem.join(', ')}.\n` : ''}
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
• Para cada foto, OLHE A IMAGEM, entenda o que ela é e escolha UM espaço da lista — ou
  deixe de fora. Não repita espaço, e não dependa de o vendedor ter escrito alguma coisa:
  a maioria das fotos chega sem descrição nenhuma, e é seu trabalho reconhecê-las. Aérea
  do terreno, quadro elétrico, padrão de entrada, fundação, carregador, obra em andamento
  — cada uma tem um lugar. É melhor deixar de fora do que pôr num espaço que não combina.
• A legenda que você escrever é a que vai impressa no slide. Ela descreve o quadro e para:
  sem inventar cidade, cliente, prazo ou etapa que a imagem não mostra.

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
    // Metade do projeto é um projeto válido: dá para propor só a usina ou só o
    // posto, e o deck se encolhe em vez de imprimir uma metade vazia.
    const temSolar = S.modulos > 0 && S.geracao > 0 && S.invest > 0;
    const temPosto = E.invest > 0 && E.carros > 0 && E.carga > 0;
    if (!temSolar && !temPosto) {
      res.status(400).json({ error: 'Preencha ao menos uma das metades: a usina (módulos, geração e investimento) ou o posto (investimento, carros por dia e carga).' });
      return;
    }
    const calc = computeEletro(E);

    // O consolidado NÃO é a soma dos dois orçamentos: o posto revende parte da energia
    // que a usina gera, e esse kWh não pode ao mesmo tempo abater a conta e ser vendido.
    // Cada kWh entra uma vez, no destino onde rende mais.
    // ── A ECONOMIA SOLAR, E A TRAVA DO GRUPO A ────────────────────────────
    // consumo × tarifa só descreve a conta de um consumidor do GRUPO B. No Grupo A
    // o cliente paga demanda contratada todo mês, a geração não abate essa demanda,
    // e a energia é cobrada separada do uso do fio, em ponta e fora de ponta. Rodar
    // a conta de Grupo B numa conta de Grupo A produz uma economia inflada que
    // ninguém percebe — e foi o que quase saiu numa proposta real.
    const grupoA = /^a/i.test(String(body.conta.grupo || '').trim());
    const consumo = S.consumoGalpao;
    if (grupoA && !S.economiaMes) {
      res.status(400).json({
        error: 'A conta de luz é do Grupo A (tem demanda contratada). Em Grupo A a geração ' +
               'solar não abate a demanda, então a economia não é consumo × tarifa e eu não ' +
               'vou calcular. Preencha "Economia mensal da usina (R$)" com o valor calculado ' +
               'para Grupo A — ou apague o consumo, e o deck sai sem a página da conta de luz.',
        grupo_a: true,
      });
      return;
    }
    // Economia informada manda sobre a calculada: ela vale para A e para B.
    const economiaSolo = S.economiaMes > 0 ? S.economiaMes
                       : (consumo > 0 && S.tarifa > 0 ? consumo * S.tarifa - (Math.max(0, consumo - S.geracao) * S.tarifa + S.contaMinima) : 0);
    const temConta = economiaSolo > 0 && consumo > 0 && S.tarifa > 0 && !grupoA;
    const naoCoberto = Math.max(0, consumo - S.geracao);
    const contaHoje = temConta ? consumo * S.tarifa : 0;
    const contaDepois = temConta ? naoCoberto * S.tarifa + S.contaMinima : 0;
    const sobraKwh = Math.max(0, S.geracao - calc.kwhMes);
    // No Grupo A a sobra também não vira reais por tarifa cheia; sem economia
    // informada, ela não entra no consolidado em vez de entrar errada.
    const ecoLiquida = grupoA ? Math.max(0, S.economiaMes - 0)
                              : Math.max(0, sobraKwh * S.tarifa - S.contaMinima);
    const EN = body.entrada;
    const investTotal = S.invest + E.invest + EN.invest;
    // Seguro da entrada: 1% ao ano, o mesmo critério que o computeEletro usa no posto.
    // Ficar de fora seria custo declarado e não descontado — a única coisa que uma
    // proposta assim não pode ter, porque contradiz a página que a defende.
    const seguroEntrada = EN.invest * 0.01 / 12;
    // Energia de rede que a usina não cobre: só o DELTA, porque os R$/kWh do custo do
    // posto já estão cobrados dentro do lucro dele. Cobrar a tarifa cheia aqui contaria
    // esse pedaço duas vezes.
    const faltaKwh = Math.max(0, (consumo + calc.kwhMes) - S.geracao);
    const ajusteRede = (temConta || S.economiaMes > 0) ? faltaKwh * Math.max(0, S.tarifa - E.custoKwh) : 0;
    const ganhoMes = ecoLiquida + calc.lucroMes - ajusteRede - seguroEntrada;

    // ── RETORNO DO CONJUNTO ────────────────────────────────────────────────
    // O cliente não compra o posto: compra o projeto. O fluxo que interessa é o dos
    // três investimentos juntos, com a rampa do posto pesando só no ano 1.
    const fixoAnual = (ecoLiquida - ajusteRede - seguroEntrada) * 12;
    const fluxoConjAnual: number[] = [];
    for (let a = 1; a <= 10; a++) fluxoConjAnual.push(fixoAnual + (a === 1 ? calc.lucroAno1 : calc.lucroAno));
    const fluxoConj: number[] = [];
    let accC = -investTotal;
    fluxoConjAnual.forEach(f => { accC += f; fluxoConj.push(accC); });
    let mesesConj = 0, accM = 0;
    while (mesesConj < 360 && accM < investTotal) {
      mesesConj++;
      accM += ecoLiquida - ajusteRede - seguroEntrada + (mesesConj <= 12 ? calc.lucroAno1 / 12 : calc.lucroMes);
    }
    const vplConj = fluxoConjAnual.reduce((v, f, i) => v + f / Math.pow(1 + E.taxaDesc, i + 1), -investTotal);
    let tirConj: number | null = null;
    if (investTotal > 0 && fluxoConjAnual.some(f => f > 0)) {
      const npvC = (r: number) => fluxoConjAnual.reduce((v, f, i) => v + f / Math.pow(1 + r, i + 1), -investTotal);
      if (npvC(0) > 0) { let lo = 0, hi = 10; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (npvC(m) > 0) lo = m; else hi = m; } tirConj = (lo + hi) / 2; }
    }

    const paybackConj = `${mesesConj} meses`;

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

    const semSol = computeEletro({ ...E, custoKwh: S.tarifa || E.custoKwh });
    const acumDias = (() => { let t = 0; return body.cronograma.map(c => ({ ...c, dia: (t += c.dias) })); })();
    // um texto escrito no formulário sempre ganha do que a IA propôs
    const txt = (meu: string, dela: string) => (meu && meu.trim()) ? meu.trim() : (dela || '');
    const lista = (minha: any[], dela: any[]) => (minha && minha.length) ? minha : (dela || []);

    const obra = ['obra1', 'obra2', 'obra3', 'obra4']
      .map((k, i) => porEspaco[k] && { src: porEspaco[k].src, etapa: `ETAPA ${i + 1}`, txt: porEspaco[k].legenda })
      .filter(Boolean);

    const deck = {
      cliente: body.cliente, cidade: body.cidade,
      cidadeCurta: (body.cidade || '').split(/[·,-]/)[0].trim(),
      data: new Date().toLocaleDateString('pt-BR'), validade: body.validade,
      vendedor: body.vendedor, contato: body.contato,
      logos: { solar: '/gerador/logo.png', eletroposto: '/gerador/logo-eletroposto.png' },
      temSolar, temPosto,
      solar: {
        modulos: S.modulos, wpModulo: S.wpModulo, kwp: S.kwp || +(S.modulos * S.wpModulo / 1000).toFixed(2),
        geracao: S.geracao, invest: S.invest,
        areaM2: S.areaM2 || (S.modulos ? Math.round(S.modulos * 2.5) : 0),
        tarifa: S.tarifa, autonomiaPct: consumo ? Math.round(Math.min(1, S.geracao / consumo) * 100) : 0,
        inversores: S.inversores, contaHoje, contaDepois, economia: economiaSolo,
        paybackTxt: economiaSolo > 0 ? mesesTxt(S.invest / economiaSolo) : '',
        aguas: S.aguas, incluido: S.incluido,
      },
      posto: {
        carregadores: E.carregadores, bicos: E.bicos, potenciaTxt: E.potenciaTxt,
        potenciaNum: (E.potenciaTxt.match(/[\d.,]+\s*kW/i) || [''])[0],
        potenciaPrefixo: 'DC de', carros: E.carros, carga: E.carga, sessoes: calc.sessoes,
        kwhMes: calc.kwhMes, preco: E.precoKwh, ativacao: E.ativacao, ativacaoMes: calc.ativacaoMes,
        custoKwh: E.custoKwh, invest: E.invest, fatMes: calc.fatMes, custosMes: calc.custosMes,
        lucroMes: calc.lucroMes, margemPct: Math.round(calc.margem * 100),
        fatAno: calc.fatAno, lucroAno: calc.lucroAno, lucroAno1: calc.lucroAno1,
        paybackTxt: anosTxt(calc.payback), paybackNum: (calc.payback || 0).toFixed(1).replace('.', ','),
        paybackMes: Math.round((calc.payback || 0) * 12),
        tirPct: (calc.tir || 0) * 100, vpl: calc.vpl, taxaDescPct: E.taxaDesc * 100,
        acumulado10: calc.acumulado10, fluxo: calc.fluxo,
        padraoEntrada: E.padraoEntrada, transformador: E.transformador,
        tempoRecarga: E.tempoRecarga,
        padraoArgumento: E.padraoEntrada
          ? `A entrada é um **padrão ${E.padraoEntrada}**: atende o carregador e a operação do imóvel ao mesmo tempo, **sem precisar entrar em média tensão**.` : '',
        custoDetalhe: calc.fatMes > 0
          ? `Energia R$ ${Math.round(calc.custoEnergiaMes)} · gateway R$ ${Math.round(calc.gatewayMes)} · imposto R$ ${Math.round(calc.impostoMes)} · assinatura R$ ${Math.round(E.assinat)} · seguro R$ ${Math.round(calc.seguroMes)}.` : '',
        multiplicador: semSol.lucroMes > 0 ? calc.lucroMes / semSol.lucroMes : 0,
        paybackSemSol: anosTxt(semSol.payback),
      },
      conjunto: {
        investTotal, ecoLiquida, lucroPosto: calc.lucroMes, ganhoMes,
        paybackTxt: paybackConj, paybackMeses: mesesConj, sobraKwh,
        ajusteRede, faltaKwh, seguroEntrada,
        ganhoAno: ganhoMes * 12,
        // o retorno que o cliente compra é o do projeto inteiro, não o do posto
        fluxo: fluxoConj, tirPct: (tirConj || 0) * 100, vpl: vplConj,
        acumulado10: fluxoConj[fluxoConj.length - 1],
      },

      // ── O BALANÇO DE ENERGIA ────────────────────────────────────────────
      // A página que MOSTRA que não somamos duas vezes, em vez de afirmar. Só
      // existe com consumo: sem ele não há o que balancear, e um consumo chutado
      // aqui contaminaria a página mais importante do deck.
      balanco: consumo > 0 ? {
        consumo, posto: calc.kwhMes, demanda: consumo + calc.kwhMes, geracao: S.geracao,
        coberturaPct: Math.round(Math.min(1, S.geracao / Math.max(1, consumo + calc.kwhMes)) * 100),
        faltaKwh, ajusteRede,
        carrosTxt: `${E.carros} carros/dia × ${E.carga} kWh`,
        origem: body.conta.kwh > 0
          ? `Consumo lido da sua conta de luz${body.conta.mes ? ` de ${body.conta.mes}` : ''}.`
          : 'Consumo estimado a partir do orçamento solar. **Traga uma conta de luz e a gente confirma na hora.**',
      } : null,

      // ── A ENTRADA DE ENERGIA ────────────────────────────────────────────
      entrada: EN.invest > 0 || EN.kva > 0 ? {
        invest: EN.invest, kva: EN.kva,
        correnteHoje: EN.correnteHoje, correnteNova: EN.correnteNova,
        cargaCarregador: EN.cargaCarregador, cargaUsina: EN.cargaUsina,
        sobra: EN.sobra, descricao: EN.descricao,
      } : null,
      cenarios: temPosto && E.carros > 0 ? cenarios(E, calc) : null,
      cronograma: acumDias.length ? {
        totalDias: acumDias[acumDias.length - 1].dia,
        etapas: acumDias.map(c => ({ dia: c.dia, titulo: c.titulo, dur: c.dur, un: c.un, forte: c.dur >= 30 })),
        nota: 'A **logística roda em paralelo** com a análise: o pedido sai no fechamento e o material chega antes da aprovação. Nós protocolamos e acompanhamos os dois pedidos na distribuidora, a geração e a carga.',
      } : null,
      garantias: body.garantias.map(g => ({
        item: g.item, prazo: g.prazo,
        cor: /módulo|painel|inversor/i.test(g.item) ? 'c-sol'
           : /carregador|posto/i.test(g.item) ? 'c-ele'
           : /assinad|emitid|inclu/i.test(g.prazo) ? 'inc' : '',
      })),
      fotos: {
        ...Object.fromEntries(Object.entries(porEspaco).map(([k, v]) => [k, v.src])),
        layoutLegenda: porEspaco.layout?.legenda || '',
        obra,
        obraLegenda: obra.length ? 'Fotos de obras anteriores executadas pela equipe de montagem que atende este projeto.' : '',
      },
      textos: {
        terrenoHoje: txt(body.textos.terrenoHoje, ia.terrenoHoje),
        pontoCards: lista(body.pontoCards, ia.pontoCards),
        pontoFecho: txt(body.textos.pontoFecho, ia.pontoFecho),
        equipamento: lista(body.equipamento, ia.equipamento),
        escopo: lista(body.escopo, ia.escopo),
        credenciais: body.credenciais,
        mercadoStats: body.mercado,
        mercadoFonte: body.mercado.length ? 'Fonte: ABVE — abve.org.br' : '',
        engenharia: temSolar ? [
          '**Levantamento feito em campo** — vão, inclinação e estado de cada água',
          '**Verificação estrutural** da cobertura para o peso e a carga de vento, com memorial de cálculo',
          '**Dimensionamento elétrico** — proteções, aterramento e o ponto de conexão com o padrão de entrada',
          '**Parecer de acesso** protocolado e acompanhado por nós até a liberação',
          '**ART de projeto e de execução** assinada por engenheiro do nosso quadro',
        ] : [],
        vantagens: temSolar ? [
          { n: 'R$ 0', t: 'de estrutura de solo', p: 'Os módulos são fixados por trilhos sobre as terças que já existem. Sem fundação, sem perfil metálico.' },
          { n: '0 m²', t: 'de chão ocupado', p: 'O pátio continua inteiro para a operação e para o carregador.' },
          { n: 'Obra seca', t: 'na usina', p: 'Trilho, fixação, cabo e inversor. A única obra civil é a base do carregador.' },
        ] : [],
        // ── AS PREMISSAS, EM DUAS COLUNAS ────────────────────────────────
        // A da esquerda é montada a partir dos parâmetros que realmente rodaram, e
        // não de uma lista escrita à mão — assim ela nunca diverge da conta.
        premissasEntraram: [
          E.carros && `**${E.carros} carros por dia**, ${E.carga} kWh por sessão`,
          E.precoKwh && `**${brlTxt(E.precoKwh)} o kWh** ao motorista${E.ativacao ? ` e ${brlTxt(E.ativacao)} de ativação por sessão` : ''}`,
          E.custoKwh && `**${brlTxt(E.custoKwh)} o kWh** de custo, porque a energia é sua`,
          E.ocupIni < 1 && `Ocupação de **${Math.round(E.ocupIni * 100)}%** subindo ao pleno em ${E.mesesRampa} meses`,
          (E.gateway || E.imposto) && `**${Math.round(E.gateway * 100)}% de gateway**${E.imposto ? `, ${Math.round(E.imposto * 100)}% de imposto` : ''}${E.assinat ? `, ${brlTxt(E.assinat)} de assinatura` : ''}`,
          S.tarifa && `Tarifa de **${brlTxt(S.tarifa)} o kWh** na conta de luz de hoje`,
          E.taxaDesc && `Taxa de referência de **${(E.taxaDesc * 100).toFixed(2).replace('.', ',')}% a.a.** para o VPL`,
        ].filter(Boolean) as string[],
        // A da direita é o que ficou FORA — e cada linha é um ganho que o cliente
        // leva sem estar no número. É a página que compra credibilidade.
        premissasNaoEntraram: [
          '**Reajuste de tarifa.** Tudo está em valores de hoje. Energia subindo, o projeto melhora.',
          E.arrend === 0 && '**Aluguel do ponto.** O terreno é seu — se um dia arrendar, a conta muda.',
          temPosto && '**Movimento extra no seu negócio.** Quem carrega fica parado ali. Isso não virou receita aqui.',
          temSolar && temPosto && '**Crédito de energia injetada.** A geração acima do seu consumo só foi contada como combustível do posto, nunca como economia.',
          EN.invest > 0 && EN.sobra && `**${EN.sobra} que sobram** na entrada nova. É capacidade sua para crescer, e nenhuma linha desta conta remunera isso.`,
          '**Prazo de obra.** Quem manda no cronograma é o parecer de acesso da distribuidora.',
        ].filter(Boolean) as string[],
        pagamento: body.textos.pagamento,
        notaValidade: body.textos.notaValidade,
        fechamento: body.textos.fechamento,
      },
    };

    etapa = 'render';
    const { pdf, paginas, estouro } = await renderizar(deck);

    const omitidas = [
      !temSolar && 'a usina',
      !temPosto && 'o eletroposto',
      temSolar && consumo <= 0 && 'o balanço de energia (falta o consumo do imóvel)',
      !EN.invest && !EN.kva && 'a página da entrada de energia',
      temSolar && !S.aguas.length && !porEspaco.layout && 'o layout das placas',
      !porEspaco.produto && 'a página do equipamento (falta a foto)',
      !body.garantias.length && !body.escopo.length && 'escopo e garantias',
      !acumDias.length && 'o cronograma',
      !body.mercado.length && !deck.textos.pontoCards.length && 'a página de mercado',
      !body.credenciais.length && !obra.length && 'quem executa',
    ].filter(Boolean) as string[];

    res.json({
      ok: true,
      paginas,
      pdf_base64: pdf.toString('base64'),
      nome: `Apresentacao-${body.cliente.replace(/[^\w]+/g, '')}.pdf`,
      fotos: relatorio,
      conta: body.conta.grupo ? {
        grupo: body.conta.grupo, subgrupo: body.conta.subgrupo,
        concessionaria: body.conta.concessionaria, demandaKw: body.conta.demandaKw,
        tarifaEfetiva: body.conta.totalReais && body.conta.kwh
          ? +(body.conta.totalReais / body.conta.kwh).toFixed(4) : null,
        mes: body.conta.mes,
      } : null,
      omitidas,
      paginas_estourando: estouro,
    });
  } catch (e: any) {
    // Corpo malformado é erro de quem chamou, não da API: 400. Sem essa distinção
    // todo campo esquecido no formulário vira um 500 no monitoramento.
    if (e instanceof z.ZodError) {
      const onde = e.issues.map(i => i.path.join('.')).filter(Boolean).join(', ');
      console.warn('[apresentacao] corpo invalido:', onde);
      res.status(400).json({ error: `Faltou preencher: ${onde || 'campos obrigatórios'}` });
      return;
    }
    console.error('[apresentacao] falhou em', etapa, e?.message);
    res.status(500).json({ error: `Falhou em ${etapa}: ${e?.message || 'erro'}` });
  }
}

// ── auxiliares de texto ───────────────────────────────────────────────────
/** R$ com centavos só quando existem: "R$ 2,35" mas "R$ 300". */
function brlTxt(v: number) {
  return 'R$ ' + (Number.isInteger(v) ? v.toLocaleString('pt-BR')
    : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
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
