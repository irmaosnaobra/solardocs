// ─────────────────────────────────────────────────────────────────────────────
// O CÉREBRO DAS AGENTES — a parte do prompt que o dono pode reescrever sozinho.
//
// O prompt de cada agente tem duas metades bem diferentes:
//   1. A PERSONA — quem ela é, como fala, o que ela persegue. Muda com o negócio,
//      e hoje mudar isso exige mexer no código e deployar.
//   2. O CONTEXTO E AS TRAVAS — nome do cliente, valor, link, o que ela NÃO pode
//      inventar, formato de bolha. Isso é código de propósito: é o que impede a
//      IA de prometer preço errado ou mandar parede de texto.
//
// Aqui a gente abre SÓ a primeira metade pra edição. O texto salvo entra no lugar
// do parágrafo de persona; todo o resto do prompt continua vindo do código. Assim
// o dono ajusta o jeito da agente sem conseguir, sem querer, apagar a trava que
// protege a venda.
//
// Guardado em `system_state` (`cerebro:<id>`) — mesmo padrão do resto da casa, sem
// migration. Cache de 60s porque isto é lido em todo envio.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type CerebroId = 'bia' | 'giovanna' | 'curso19' | 'atendimento_limpapro';

interface CerebroDef {
  nome: string;
  agenteId: string;         // casa com o card da Central
  onde: string;             // arquivo que usa este texto
  descricao: string;
  padrao: string;
  contextoTeste: string;    // o "cliente" que ela imagina no chat de teste
}

/** Os textos abaixo são EXATAMENTE os que estão hoje no código de cada agente. */
export const CEREBROS: Record<CerebroId, CerebroDef> = {
  bia: {
    nome: 'Bia — recuperação LimpaPro',
    agenteId: 'bia',
    onde: 'biaInboundService.ts',
    descricao: 'Quem ela é quando responde alguém que abandonou o checkout do LimpaPro.',
    padrao: `Você é a "Bia", ESPECIALISTA em vendas do LimpaPro Solar pelo WhatsApp. A pessoa
entrou no checkout e NÃO finalizou. Seu trabalho é FECHAR essa venda: entender a trava,
resolver com ARGUMENTO DE VALOR de quem conhece o produto por dentro, e conduzir a pessoa
até concluir. Você é gente boa, humana e simpática — mas é VENDEDORA DE VERDADE: acredita no
produto, sabe que ele agrega demais, não larga a bola, conduz. Nunca robótica, nunca agressiva.`,
    contextoTeste: 'O cliente se chama Marcos, abandonou o checkout do LimpaPro Solar há 20 minutos e acabou de te responder.',
  },
  giovanna: {
    nome: 'Giovanna — follow-up B2B da plataforma',
    agenteId: 'giovanna',
    onde: 'carlaPlatformFollowupService.ts',
    descricao: 'Quem ela é nas duas cadências da plataforma (sem CNPJ e inativo).',
    padrao: `Você é a "Giovanna", consultora especialista da SolarDoc. Vendedora de verdade, mas humana e consultiva — entende o negócio do integrador solar e conduz com calor, sem ser robótica. (Esta é a MESMA Giovanna que responde quando o cliente retorna — uma pessoa só, do primeiro contato ao fechamento.)`,
    contextoTeste: 'O integrador se chama Rafael, criou conta há 6 dias, não preencheu o CNPJ e nunca gerou documento.',
  },
  atendimento_limpapro: {
    nome: 'Atendimento 1x1 do LimpaPro',
    agenteId: 'atendimento_limpapro',
    onde: 'limpaproAtendimentoService.ts',
    descricao: 'Quem ela é quando um ALUNO do LimpaPro (já comprou) escreve na linha.',
    padrao: `Você é a "Bia", do suporte do LimpaPro Solar no WhatsApp. Quem está falando com você
JÁ COMPROU — é aluno, não é lead. Seu trabalho é resolver o problema dele rápido e sem
enrolação, com jeito de gente que conhece o produto por dentro. Acolhedora, direta e
resolutiva: primeiro resolve, depois conversa.`,
    contextoTeste: 'O aluno se chama Durval, comprou o curso há 3 dias, nunca entrou no app e acabou de escrever que não consegue abrir os vídeos.',
  },
  curso19: {
    nome: 'Campanha do curso R$19',
    agenteId: 'curso19',
    onde: 'cursoEntradaBroadcast.ts',
    descricao: 'Quem ela é quando oferece o Kit de Fechamento por R$19 pra base parada.',
    padrao: `Você é a "Giovanna", consultora da SolarDoc. Vendedora de verdade, mas humana e consultiva.
(É a MESMA Giovanna que responde quando ele retorna — uma pessoa só.)`,
    contextoTeste: 'O integrador se chama Paulo, tem cadastro antigo, nunca assinou e está recebendo o 1º toque da campanha do curso de R$19.',
  },
};

const chave = (id: CerebroId) => `cerebro:${id}`;

// Cache curto: isto é lido em TODO envio; sem cache, cada mensagem vira uma
// consulta a mais no banco. 60s é o atraso máximo entre salvar e valer.
const cache = new Map<CerebroId, { texto: string; ate: number }>();
const CACHE_MS = 60_000;

export function ehCerebroValido(id: string): id is CerebroId {
  return Object.prototype.hasOwnProperty.call(CEREBROS, id);
}

/** Texto vigente: o editado, se existir; senão o do código. Nunca devolve vazio. */
export async function carregarCerebro(id: CerebroId): Promise<string> {
  const emCache = cache.get(id);
  if (emCache && emCache.ate > Date.now()) return emCache.texto;

  let texto = CEREBROS[id].padrao;
  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', chave(id)).maybeSingle();
    const salvo = ((data?.value ?? {}) as { texto?: string }).texto;
    if (salvo && salvo.trim()) texto = salvo.trim();
  } catch (err) {
    // Falha de leitura NÃO pode calar a agente: cai no texto do código.
    logger.error('cerebro-agentes', `leitura do cérebro ${id} falhou — usando o padrão`, err);
  }
  cache.set(id, { texto, ate: Date.now() + CACHE_MS });
  return texto;
}

export async function salvarCerebro(id: CerebroId, texto: string, quem = 'painel'): Promise<void> {
  const limpo = String(texto || '').trim();
  if (limpo.length < 40) throw new Error('texto curto demais — a persona precisa de pelo menos 40 caracteres');
  if (limpo.length > 6000) throw new Error('texto longo demais (máx. 6000 caracteres)');
  const { error } = await supabase.from('system_state').upsert(
    {
      key: chave(id),
      value: { texto: limpo, atualizado_em: new Date().toISOString(), atualizado_por: quem },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) throw new Error(`não consegui salvar: ${error.message}`);
  cache.delete(id);
}

/** Volta pro texto do código (apaga a edição). */
export async function restaurarCerebro(id: CerebroId): Promise<void> {
  await supabase.from('system_state').delete().eq('key', chave(id));
  cache.delete(id);
}

export interface CerebroView {
  id: CerebroId; nome: string; agente_id: string; onde: string; descricao: string;
  texto: string; padrao: string; editado: boolean; atualizado_em: string | null; atualizado_por: string | null;
}

export async function listarCerebros(): Promise<CerebroView[]> {
  const { data } = await supabase
    .from('system_state').select('key, value').like('key', 'cerebro:%').limit(50);
  const salvos = new Map<string, { texto?: string; atualizado_em?: string; atualizado_por?: string }>(
    (data ?? []).map(r => [String(r.key).slice('cerebro:'.length), (r.value ?? {}) as any]),
  );
  return (Object.keys(CEREBROS) as CerebroId[]).map(id => {
    const def = CEREBROS[id];
    const s = salvos.get(id);
    const editado = Boolean(s?.texto && s.texto.trim());
    return {
      id, nome: def.nome, agente_id: def.agenteId, onde: def.onde, descricao: def.descricao,
      texto: editado ? String(s!.texto).trim() : def.padrao,
      padrao: def.padrao,
      editado,
      atualizado_em: s?.atualizado_em ?? null,
      atualizado_por: s?.atualizado_por ?? null,
    };
  });
}

// ─── Conversa de teste ───────────────────────────────────────────────────────
// Falar COM a agente antes de soltar ela no cliente. Roda o cérebro vigente num
// contexto de teste declarado, com as MESMAS regras de formato que ela usa em
// produção (bolhas curtas, sem parede de texto). Nada daqui vai pro WhatsApp.

export interface MsgTeste { role: 'user' | 'assistant'; content: string }

export async function conversarComAgente(
  id: CerebroId,
  mensagens: MsgTeste[],
  cerebroPreview?: string,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const def = CEREBROS[id];
  const persona = (cerebroPreview && cerebroPreview.trim()) || (await carregarCerebro(id));

  const system = [
    persona,
    '',
    '━━ ESTE É UM TESTE INTERNO ━━',
    `Quem está do outro lado é o DONO do negócio testando você, não um cliente. ${def.contextoTeste}`,
    'Responda exatamente como responderia no WhatsApp de verdade.',
    'Frases curtas, uma ideia por mensagem, sem parede de texto. Nunca invente preço, prazo ou link que você não recebeu.',
  ].join('\n');

  const limpas = mensagens
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content.trim() }));
  if (!limpas.length) throw new Error('mande alguma coisa pra ela responder');

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system,
    messages: limpas,
  });
  const txt = resp.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim();
  return txt || '(a agente não respondeu nada)';
}
