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
    solar_tarifa:    { type: 'number',  description: 'Tarifa de energia da concessionária em R$/kWh.' },
    solar_consumo:   { type: 'integer', description: 'Consumo mensal do imóvel em kWh, se o documento disser.' },
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
• Se dois anexos discordarem, use o do orçamento mais recente.
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
