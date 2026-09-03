import { Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

// ══════════════════════════════════════════════════════════════════════════
// APRESENTAÇÃO — LEITURA DOS ANEXOS
// ──────────────────────────────────────────────────────────────────────────
// Endpoint SEPARADO do que monta o deck, e isso é de propósito: extrair dentro
// da montagem faria uma leitura errada custar um render inteiro (60 s) para ser
// descoberta. Aqui o consultor solta os PDFs, vê o formulário se preencher,
// corrige o que estiver torto e só então manda montar.
//
// A resposta diz DE ONDE veio cada campo. Sem isso, uma extração errada
// contamina o formulário inteiro e não há como achar qual foi — e aí a pessoa
// reconfere os 60 campos toda vez, que é pior do que digitar.
//
// O que o modelo NÃO faz aqui: inventar. Campo que não estiver no anexo volta
// vazio, e vazio no formulário significa "some da proposta". Preencher com um
// palpite plausível é o único jeito de essa ferramenta gerar uma proposta
// errada sem ninguém perceber.
// ══════════════════════════════════════════════════════════════════════════

const MODELO = 'claude-sonnet-4-6';

const anexoSchema = z.object({
  nome: z.string().default(''),
  media_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(10),
});
const bodySchema = z.object({
  arquivos: z.array(anexoSchema).min(1).max(8),
});

// O formato que o formulário espera de volta. Tudo opcional: o que o anexo não
// disser fica de fora e o campo continua em branco na tela.
const CAMPOS = {
  type: 'object',
  properties: {
    cliente:  { type: 'string', description: 'Nome do cliente a quem a proposta é dirigida.' },
    cidade:   { type: 'string', description: 'Cidade e UF, como "São Paulo · SP".' },

    solar_modulos:   { type: 'integer', description: 'Quantidade de módulos fotovoltaicos.' },
    solar_wp:        { type: 'integer', description: 'Potência de CADA módulo, em watts.' },
    solar_kwp:       { type: 'number',  description: 'Potência total instalada em kWp.' },
    solar_geracao:   { type: 'integer', description: 'Geração média mensal em kWh.' },
    solar_invest:    { type: 'number',  description: 'Investimento da usina solar, em reais, só o número.' },
    solar_inversores:{ type: 'string',  description: 'Inversores como "2 un · 25 kW". Sem marca.' },
    solar_tarifa:    { type: 'number',  description: 'Tarifa de energia em R$/kWh. Se houver uma CONTA DE LUZ entre os anexos, use a tarifa efetiva dela (total da fatura ÷ kWh consumidos), não a tarifa de tabela.' },
    solar_consumo:   { type: 'integer', description: 'Consumo mensal do imóvel em kWh. Da conta de luz, se houver; senão do que o documento disser.' },

    // ── da CONTA DE LUZ, quando ela estiver entre os anexos ──
    // A conta é a única fonte que traz a tarifa que o cliente REALMENTE paga, com
    // bandeira, PIS/COFINS e ICMS já embutidos, no mês certo e na classe certa.
    // Nenhuma tabela de tarifa por cidade chega perto disso.
    conta_concessionaria: { type: 'string',  description: 'Nome da distribuidora impresso na conta.' },
    conta_grupo:          { type: 'string',  description: 'Grupo tarifário: "A" se a conta tiver linhas de Demanda Contratada ou Demanda Faturada (média/alta tensão); "B" se não tiver.' },
    conta_subgrupo:       { type: 'string',  description: 'Subgrupo/modalidade, como "B3", "A4 Verde", "A4 Azul".' },
    conta_demanda_kw:     { type: 'number',  description: 'Demanda contratada em kW, só se a conta tiver.' },
    conta_total_reais:    { type: 'number',  description: 'Valor total da fatura em reais.' },
    conta_kwh:            { type: 'integer', description: 'Consumo faturado em kWh no período da conta.' },
    conta_mes:            { type: 'string',  description: 'Mês de referência da conta, como "07/2026".' },
    solar_contaMin:  { type: 'number',  description: 'Conta após a instalação / taxa mínima, em reais.' },
    solar_area:      { type: 'integer', description: 'Área necessária ou ocupada, em m².' },
    solar_aguas: {
      type: 'array',
      description: 'Distribuição das placas por água do telhado, se o documento ou a imagem mostrar.',
      items: { type: 'object', properties: {
        placas: { type: 'integer' }, onde: { type: 'string', description: 'ex.: "na água da frente, voltada para a rua"' },
      }, required: ['placas', 'onde'] },
    },

    posto_carregadores: { type: 'integer', description: 'Quantidade de carregadores.' },
    posto_bicos:        { type: 'integer', description: 'Bicos / saídas de carregamento.' },
    posto_potencia:     { type: 'string',  description: 'Potência do carregador, como "DC 80 kW".' },
    posto_carros:       { type: 'integer', description: 'Carros por dia considerados.' },
    posto_carga:        { type: 'number',  description: 'Carga média por sessão em kWh.' },
    posto_preco:        { type: 'number',  description: 'Preço ao motorista em R$/kWh.' },
    posto_ativacao:     { type: 'number',  description: 'Taxa de ativação por sessão, em reais.' },
    posto_custoKwh:     { type: 'number',  description: 'Custo do kWh para o operador, em reais.' },
    posto_invest:       { type: 'number',  description: 'Investimento do eletroposto, em reais.' },
    posto_padrao:       { type: 'string',  description: 'Padrão de entrada, como "T5 · disjuntor 200 A".' },
    posto_trafo:        { type: 'string',  description: 'Transformador, como "220 V / 380 V".' },

    custo_gateway:  { type: 'number', description: 'Gateway de pagamento, em % (só o número).' },
    custo_arrend:   { type: 'number', description: 'Arrendamento do ponto, em %.' },
    custo_manut:    { type: 'number', description: 'Manutenção, em %.' },
    custo_imposto:  { type: 'number', description: 'Imposto (Simples Nacional), em %.' },
    custo_assinat:  { type: 'number', description: 'Assinatura mensal do software, em reais.' },
    custo_fixos:    { type: 'number', description: 'Outros custos fixos mensais, em reais.' },
    custo_ocupIni:  { type: 'number', description: 'Ocupação inicial, em %.' },
    custo_rampa:    { type: 'integer', description: 'Meses até a ocupação plena.' },

    garantias: {
      type: 'array', description: 'Garantias listadas no documento.',
      items: { type: 'object', properties: {
        item: { type: 'string' }, prazo: { type: 'string', description: 'ex.: "25 anos", "24 meses", "ASSINADA"' },
      }, required: ['item', 'prazo'] },
    },
    escopo: { type: 'array', items: { type: 'string' }, description: 'Itens marcados como INCLUÍDO / escopo chave na mão.' },
    incluido_usina: { type: 'array', items: { type: 'string' }, description: 'Itens inclusos especificamente da usina solar.' },
  },
  required: [] as string[],
};

export async function extrairApresentacao(req: Request, res: Response): Promise<void> {
  try {
    const { arquivos } = bodySchema.parse(req.body);
    const cli = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const conteudo: any[] = [];
    arquivos.forEach((a, i) => {
      conteudo.push({ type: 'text', text: `ANEXO ${i + 1}: ${a.nome}` });
      conteudo.push(a.media_type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
        : { type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.base64 } });
    });
    conteudo.push({ type: 'text', text: `
Leia os anexos acima — são orçamentos, estudos de viabilidade e imagens de um projeto de
energia solar com eletroposto — e devolva os campos que você CONSEGUIR LER neles.

REGRAS:
• Só preencha um campo se o valor estiver no anexo. Campo que você não achou, DEIXE FORA
  da resposta. Não estime, não arredonde para um valor "típico", não complete pelo que
  costuma ser. Um palpite plausível aqui vira uma proposta errada que ninguém percebe.
• Percentuais vão como número puro: 10 para 10%, 6 para 6%.
• Dinheiro vai como número puro, sem "R$" e sem separador de milhar: 167877.
• Não copie nome de fornecedor, marca ou modelo de equipamento para nenhum campo.
• Se dois anexos discordarem, use o do orçamento mais recente. **Exceção: para tarifa e
  consumo, a CONTA DE LUZ ganha de qualquer orçamento** — o orçamento estima, a conta é
  o que o cliente paga.
• Se houver conta de luz, olhe se ela tem "Demanda Contratada" ou "Demanda Faturada".
  Se tiver, conta_grupo é "A". Se não tiver, é "B". Não chute: se você não conseguir ler
  a conta inteira, deixe conta_grupo de fora.
• A tarifa efetiva é o total da fatura dividido pelo consumo em kWh. É ela que interessa,
  porque já traz bandeira, PIS/COFINS e ICMS embutidos.
` });

    const r = await cli.messages.create({
      model: MODELO,
      max_tokens: 3000,
      tools: [{
        name: 'campos_lidos',
        description: 'Devolve apenas os campos encontrados nos anexos.',
        input_schema: CAMPOS as any,
      }],
      tool_choice: { type: 'tool', name: 'campos_lidos' },
      messages: [{ role: 'user', content: conteudo }],
    });

    const uso = r.content.find(c => c.type === 'tool_use');
    if (!uso || uso.type !== 'tool_use') throw new Error('leitura não retornou campos');

    // Limpa vazios: string em branco, array vazio e nulo não contam como "achei".
    const cru = uso.input as Record<string, unknown>;
    const campos: Record<string, unknown> = {};
    Object.entries(cru).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string' && !v.trim()) return;
      if (Array.isArray(v) && !v.length) return;
      campos[k] = v;
    });

    res.json({ ok: true, campos, achados: Object.keys(campos), lidos: arquivos.length });
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: 'Mande ao menos um arquivo.' });
      return;
    }
    console.error('[apresentacao/extrair]', e?.message);
    res.status(500).json({ error: e?.message || 'não consegui ler os anexos' });
  }
}
