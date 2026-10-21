// ─────────────────────────────────────────────────────────────────────────────
// LEITURAS DA SENTINELA. Cada função pergunta a UMA ferramenta como ela está e
// devolve uma Leitura. Só lê: nada aqui envia mensagem.
//
// Regras:
//   - Toda chamada de rede tem prazo (8 s). Prazo estourado, 429 e 5xx viram
//     'nao_conferido', nunca 'falha': a sentinela não grita por blip de rede.
//   - 'falha' é só o que a própria ferramenta declara: chave recusada, conta
//     do Meta fora do ar, saldo da IA zerado, linha da Z-API caída.
//   - O token do Meta vai no cabeçalho Authorization, nunca na URL, e nenhum
//     texto devolvido (detalhe) carrega URL ou chave.
//   - A Z-API NÃO é consultada aqui: o monitor (zapiHealthMonitor.ts) já grava
//     o estado em system_state.zapi_io_health e a gente só lê essa chave.
// ─────────────────────────────────────────────────────────────────────────────

import type { Leitura } from './sentinela';

export const CONTAS_META = ['act_545732112868250', 'act_1411786166570474'] as const;
export const MODELO_SONDA = 'claude-haiku-5-5';
export const PRAZO_MS = 8_000;
const GRAPH = 'https://graph.facebook.com/v23.0';
const CAMPOS_META = 'account_status,disable_reason,balance,amount_spent,spend_cap,funding_source_details';
const MINIMO_PADRAO_REAIS = 100;
const ZAPI_VELHA_MS = 2 * 3600_000;

type Env = Record<string, string | undefined>;

export interface DepsLeituras {
  fetch: typeof fetch;
  env: Env;
  agora: Date;
  /** Lê uma chave de system_state (banco principal). */
  lerEstado: (chave: string) => Promise<{ value: any; updated_at?: string } | null>;
  /** Chaves com o prefixo atualizadas desde `desdeIso`. */
  listarEstado: (prefixo: string, desdeIso: string) => Promise<Array<{ key: string; updated_at: string }>>;
  /** Cliente Anthropic (mesma rota dos robôs). */
  anthropic: () => { messages: { create: (args: any, opts?: any) => Promise<unknown> } };
}

const nc = (ferramenta: string, detalhe: string): Leitura => ({ ferramenta, estado: 'nao_conferido', detalhe });
const ok = (ferramenta: string, detalhe: string): Leitura => ({ ferramenta, estado: 'ok', detalhe });

/** Valor mínimo (em centavos) abaixo do qual saldo/folga do Meta avisa. Env em reais, padrão R$ 100. */
export function minimoMetaCentavos(env: Env): number {
  const n = Number(String(env.SENTINELA_META_MINIMO ?? '').replace(',', '.'));
  const reais = Number.isFinite(n) && n > 0 ? n : MINIMO_PADRAO_REAIS;
  return Math.round(reais * 100);
}

const reais = (centavos: number): string =>
  `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function comPrazo<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PRAZO_MS);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

/** "Saldo disponível (R$ 20,00 BRL)" -> 2000. Sem valor em reais reconhecível: null. */
export function saldoDoTexto(texto: unknown): number | null {
  const m = /R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(String(texto ?? ''));
  if (!m) return null;
  return Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]);
}

// ── Meta ─────────────────────────────────────────────────────────────────────

export async function lerMeta(deps: DepsLeituras): Promise<Leitura[]> {
  const token = (deps.env.META_SYSTEM_USER_TOKEN || '').trim();
  if (!token) return CONTAS_META.map(c => nc(`Meta ${c}`, 'sem token configurado, não conferido'));
  const minimo = minimoMetaCentavos(deps.env);
  const saida: Leitura[] = [];
  for (const conta of CONTAS_META) {
    const nome = `Meta ${conta}`;
    try {
      const r = await comPrazo(signal => deps.fetch(`${GRAPH}/${conta}?fields=${CAMPOS_META}`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
      }));
      const j: any = await r.json().catch(() => null);
      if (!r.ok || j?.error) {
        const cod = Number(j?.error?.code);
        if (cod === 190 || cod === 102 || r.status === 401) saida.push({ ferramenta: nome, estado: 'falha', detalhe: 'o token do Meta foi recusado' });
        else saida.push(nc(nome, `Meta respondeu ${r.status}, não conferido`));
        continue;
      }
      const status = Number(j?.account_status);
      if (status !== 1) {
        saida.push({ ferramenta: nome, estado: 'falha', detalhe: `conta de anúncios fora do ar (status ${Number.isFinite(status) ? status : '?'}, motivo ${j?.disable_reason ?? '?'})` });
        continue;
      }
      const cap = Number(j?.spend_cap);
      const gasto = Number(j?.amount_spent);
      if (Number.isFinite(cap) && cap > 0 && Number.isFinite(gasto)) {
        const folga = cap - gasto;
        if (folga < minimo) {
          saida.push({ ferramenta: nome, estado: 'baixo', detalhe: `falta ${reais(Math.max(folga, 0))} para o limite de gasto da conta` });
          continue;
        }
      }
      // Conta pré-paga: o saldo vem escrito em reais no texto da forma de pagamento (type 20).
      const fonte = j?.funding_source_details;
      if (Number(fonte?.type) === 20) {
        const saldo = saldoDoTexto(fonte?.display_string);
        if (saldo === null) { saida.push(nc(nome, 'conta pré-paga sem saldo legível, não conferido')); continue; }
        if (saldo < minimo) { saida.push({ ferramenta: nome, estado: 'baixo', detalhe: `saldo pré-pago de ${reais(saldo)}` }); continue; }
      }
      saida.push(ok(nome, 'conta ativa'));
    } catch {
      saida.push(nc(nome, 'sem resposta do Meta, não conferido'));
    }
  }
  return saida;
}

// ── Z-API (só lê o que o monitor gravou) ─────────────────────────────────────

export async function lerZapi(deps: DepsLeituras): Promise<Leitura> {
  try {
    const linha = await deps.lerEstado('zapi_io_health');
    if (!linha) return nc('Z-API linha IO', 'o monitor ainda não gravou nada, não conferido');
    // O monitor grava a cada rodada: leitura com mais de 2 h é monitor parado, não linha saudável.
    const idade = linha.updated_at ? deps.agora.getTime() - Date.parse(linha.updated_at) : Infinity;
    if (!(idade <= ZAPI_VELHA_MS)) return nc('Z-API linha IO', 'a leitura do monitor está velha, não conferido');
    const v = linha.value ?? {};
    const streak = Number(v.downStreak) || 0;
    const caiu = typeof v.alertadoEm === 'string' ? Date.parse(v.alertadoEm) : NaN;
    const voltou = typeof v.reconectadoEm === 'string' ? Date.parse(v.reconectadoEm) : NaN;
    const aindaCaida = Number.isFinite(caiu) && !(Number.isFinite(voltou) && voltou >= caiu);
    if (streak >= 2 || aindaCaida) return { ferramenta: 'Z-API linha IO', estado: 'falha', detalhe: 'a linha da 5040 está caída segundo o monitor' };
    return ok('Z-API linha IO', 'linha conectada');
  } catch {
    return nc('Z-API linha IO', 'não deu para ler o monitor, não conferido');
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export async function lerAnthropic(deps: DepsLeituras): Promise<Leitura[]> {
  const saida: Leitura[] = [];
  try {
    // Uma chamada só: sem retentativa do SDK (que gastaria 3x o prazo) e com o mesmo prazo de 8 s.
    await comPrazo(async signal => {
      await deps.anthropic().messages.create(
        { model: MODELO_SONDA, max_tokens: 1, messages: [{ role: 'user', content: 'oi' }] },
        { signal, maxRetries: 0, timeout: PRAZO_MS },
      );
    });
    saida.push(ok('Anthropic', 'chave e saldo respondendo'));
  } catch (err: any) {
    const status = Number(err?.status);
    const msg = String(err?.message ?? err?.error?.error?.message ?? '').toLowerCase();
    if (status === 401 || status === 403) saida.push({ ferramenta: 'Anthropic', estado: 'falha', detalhe: 'a chave da Anthropic foi recusada' });
    else if (status === 402 || /credit balance|billing|insufficient/.test(msg)) saida.push({ ferramenta: 'Anthropic', estado: 'falha', detalhe: 'sem saldo na Anthropic' });
    else if (status === 404 || /not_found|model/.test(msg)) saida.push(nc('Anthropic', 'modelo da sonda não encontrado, não conferido'));
    else saida.push(nc('Anthropic', 'sem resposta da Anthropic, não conferido'));
  }

  try {
    const desde = new Date(deps.agora.getTime() - 24 * 3600_000).toISOString();
    const avisos = await deps.listarEstado('ia_falha_aviso:', desde);
    if (avisos.length) {
      const causas = [...new Set(avisos.map(a => a.key.slice('ia_falha_aviso:'.length)).filter(Boolean))].slice(0, 4);
      saida.push({ ferramenta: 'IA dos robôs', estado: 'falha', detalhe: `os robôs avisaram falha de IA nas últimas 24h (${causas.join(', ') || 'sem causa'})` });
    } else {
      saida.push(ok('IA dos robôs', 'nenhum aviso de falha em 24h'));
    }
  } catch {
    saida.push(nc('IA dos robôs', 'não deu para ler os avisos, não conferido'));
  }
  return saida;
}

// ── OpenAI (só prova que a chave vale) ───────────────────────────────────────

export async function lerOpenAI(deps: DepsLeituras): Promise<Leitura> {
  const chave = (deps.env.OPENAI_API_KEY || '').trim();
  if (!chave) return nc('OpenAI', 'sem chave configurada, não conferido');
  try {
    const r = await comPrazo(signal => deps.fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${chave}` }, signal,
    }));
    if (r.status === 401 || r.status === 403) return { ferramenta: 'OpenAI', estado: 'falha', detalhe: 'a chave da OpenAI foi recusada' };
    if (r.ok) return ok('OpenAI', 'chave válida (saldo não é conferido)');
    return nc('OpenAI', `OpenAI respondeu ${r.status}, não conferido`);
  } catch {
    return nc('OpenAI', 'sem resposta da OpenAI, não conferido');
  }
}

// ── tudo ─────────────────────────────────────────────────────────────────────

export async function lerTudo(deps: DepsLeituras): Promise<Leitura[]> {
  const [meta, zapi, ant, oai] = await Promise.all([lerMeta(deps), lerZapi(deps), lerAnthropic(deps), lerOpenAI(deps)]);
  return [...meta, zapi, ...ant, oai, nc('Cloudinary', 'não conferido')];
}

/** Dependências reais: banco principal, fetch global e o cliente Anthropic dos robôs. */
export function depsReais(
  supabase: { from: (t: string) => any },
  novoAnthropic: () => { messages: { create: (a: any, o?: any) => Promise<unknown> } },
  agora: Date = new Date(),
): DepsLeituras {
  return {
    fetch: (...a) => fetch(...a),
    env: process.env,
    agora,
    lerEstado: async chave => {
      const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    listarEstado: async (prefixo, desdeIso) => {
      const { data, error } = await supabase.from('system_state').select('key, updated_at')
        .like('key', `${prefixo}%`).gte('updated_at', desdeIso).order('key', { ascending: true }).range(0, 199);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ key: string; updated_at: string }>;
    },
    anthropic: novoAnthropic,
  };
}
