// ─────────────────────────────────────────────────────────────────────────────
// CANAL DE COMANDO DAS SONDAS DAS AGENTES 5040.
//
// O orquestrador não tem o CRON_SECRET nem as env da Vercel, e as sondas precisam rodar na produção.
// Ele grava, com a chave de serviço, no system_state do banco PRINCIPAL:
//
//   key   = 'ag5040_comando'
//   value = { acao: <uma de ACOES>, params: { ... }, pedido_em: '<ISO 8601>' }
//
// A rota do ensaio (a Vercel chama a cada 5 min) chama executarComandoPendente() ANTES de tudo, mesmo com o
// interruptor do ensaio desligado:
//   1. comando com pedido_em de até 30 min; mais velho (ou ilegível, ou ação fora da lista) é descartado SEM rodar;
//   2. reivindica por insert de 'ag5040_comando_vez:<pedido_em>' (23505 = outro já pegou: não roda);
//   3. apaga 'ag5040_comando' e executa a ação UMA vez;
//   4. grava 'ag5040_comando_resultado' = { acao, pedido_em, ok, resultado, terminou_em } (até ~4 KB).
//
// O resultado NUNCA leva dado pessoal: só contagens, ids de card, estados, nomes de campo, tamanhos, uso de
// tokens, modelo e motivos. Bolhas, previas e textos viram só o tamanho.
//
// Este arquivo é PURO em relação ao envio: as ações chegam por injeção (a ligação das que enviam, ficha_teste
// e sentinela, fica no cron.ts), e ele não importa zapiClient nem nada que o alcance.
// ─────────────────────────────────────────────────────────────────────────────

export const CHAVE_COMANDO = 'ag5040_comando';
export const CHAVE_RESULTADO = 'ag5040_comando_resultado';
export const PREFIXO_VEZ = 'ag5040_comando_vez:';
export const chaveVez = (pedidoEm: string): string => `${PREFIXO_VEZ}${pedidoEm}`;

export const IDADE_MAX_MS = 30 * 60_000;
/** Tolerância para relógio adiantado de quem gravou o comando. */
export const FUTURO_MAX_MS = 5 * 60_000;
export const LIMITE_BYTES = 4096;
/** Abaixo dos 300 s da função: o resultado ainda é gravado se a ação travar. */
export const PRAZO_ACAO_MS = 270_000;

export const ACOES = [
  'sonda_armazem', 'ensaio_dry', 'replay_dry', 'anuncios', 'ficha_dry', 'ficha_sonda',
  'ficha_teste', 'sentinela_seco', 'sentinela_sonda', 'pix_sonda',
] as const;
export type Acao = typeof ACOES[number];
export const ehAcao = (x: unknown): x is Acao => typeof x === 'string' && (ACOES as readonly string[]).includes(x);

export interface Comando { acao: string; params: Record<string, unknown>; pedido_em: string }

export type Params = Record<string, unknown>;
export type FuncaoAcao = (params: Params) => Promise<unknown>;
export type MapaAcoes = Partial<Record<Acao, FuncaoAcao>>;

export interface ResultadoGravado {
  acao: string;
  pedido_em: string;
  ok: boolean;
  resultado: unknown;
  terminou_em: string;
}

// ── leitura e validação ──────────────────────────────────────────────────────

const objeto = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/** Aceita o valor como objeto ou como string JSON. Sem pedido_em legível, não é comando. */
export function lerComando(valor: unknown): Comando | null {
  let v = valor;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  const o = objeto(v);
  if (!o) return null;
  const pedido = typeof o.pedido_em === 'string' ? o.pedido_em.trim() : '';
  if (!pedido || pedido.length > 40 || !Number.isFinite(Date.parse(pedido))) return null;
  return { acao: typeof o.acao === 'string' ? o.acao : '', params: objeto(o.params) ?? {}, pedido_em: pedido };
}

const inteiro = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

const data = (v: unknown, padrao: Date): Date | null => {
  if (v === undefined || v === null || v === '') return padrao;
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

export type ParamsValidados = { ok: true; params: Params } | { ok: false; motivo: string };

/** Fecha os parâmetros de cada ação. Só o que está aqui passa adiante; o resto é ignorado. */
export function validarParams(acao: Acao, params: Params, agora: Date): ParamsValidados {
  switch (acao) {
    case 'replay_dry': {
      const mc = params.maxConversas === undefined ? 1 : inteiro(params.maxConversas);
      const mt = params.maxTurnos === undefined ? 2 : inteiro(params.maxTurnos);
      if (mc === null || mc < 1 || mc > 1) return { ok: false, motivo: 'maxConversas precisa ser 1' };
      if (mt === null || mt < 1 || mt > 2) return { ok: false, motivo: 'maxTurnos precisa ser 1 ou 2' };
      const desde = data(params.desde, new Date(agora.getTime() - 30 * 86_400_000));
      const ate = data(params.ate, agora);
      if (!desde || !ate) return { ok: false, motivo: 'desde/ate precisam ser datas ISO' };
      if (desde.getTime() >= ate.getTime()) return { ok: false, motivo: 'desde precisa ser antes de ate' };
      return { ok: true, params: { maxConversas: mc, maxTurnos: mt, desde, ate } };
    }
    case 'anuncios': {
      const d = params.dias === undefined ? 30 : inteiro(params.dias);
      if (d === null || d < 1 || d > 30) return { ok: false, motivo: 'dias precisa estar entre 1 e 30' };
      return { ok: true, params: { dias: d } };
    }
    case 'ficha_sonda': {
      const c = inteiro(params.card);
      if (c === null || c <= 0) return { ok: false, motivo: 'card invalido' };
      return { ok: true, params: { card: c } };
    }
    default:
      return { ok: true, params: {} };
  }
}

// ── o que pode entrar no resultado ───────────────────────────────────────────

/** Texto curto, sem sequência que lembre telefone ou documento. */
export function limparTexto(s: unknown, max = 160): string {
  const t = String(s ?? '').replace(/\+?\d[\d\s().-]{6,}\d/g, '#').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const numero = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const textoOuNulo = (x: unknown, max = 200): string | null => (typeof x === 'string' && x ? limparTexto(x, max) : null);

const USO = ['entrada', 'cache_criado', 'cache_lido', 'saida'] as const;
function usoSeguro(u: unknown): Record<string, number> {
  const o = objeto(u) ?? {};
  const r: Record<string, number> = {};
  for (const k of USO) r[k] = numero(o[k]) ?? 0;
  return r;
}

function contagens(x: unknown): Record<string, number> {
  const o = objeto(x) ?? {};
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) { const n = numero(v); if (n !== null) r[limparTexto(k, 60)] = n; }
  return r;
}

const CHAVES_PROIBIDAS = new Set([
  'texto', 'bolhas', 'previa', 'telefone', 'phone', 'nome', 'cliente_nome', 'cliente_telefone', 'mensagem',
  'mensagens_texto', 'body', 'text', 'conversa', 'observacao', 'email',
]);

/** Cópia defensiva: cai chave de texto/pessoa, trunca string e limita fundura e tamanho de lista. */
export function limpar(valor: unknown, fundo = 0): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return limparTexto(valor);
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'boolean') return valor;
  if (fundo >= 5) return null;
  if (Array.isArray(valor)) return valor.slice(0, 60).map(v => limpar(v, fundo + 1));
  const o = objeto(valor);
  if (!o) return null;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (CHAVES_PROIBIDAS.has(k.toLowerCase())) { if (typeof v === 'string') r[`${k}_tamanho`] = v.length; continue; }
    r[limparTexto(k, 60)] = limpar(v, fundo + 1);
  }
  return r;
}

function turnoEnsaio(t: unknown, replay: boolean): Record<string, unknown> {
  const o = objeto(t) ?? {};
  return {
    ...(replay ? { kind: textoOuNulo(o.kind, 20) } : { dona: textoOuNulo(o.dona, 20) }),
    passo: typeof o.passo === 'number' ? o.passo : textoOuNulo(o.passo, 20),
    persona: textoOuNulo(o.persona, 20),
    falou: o.falou === true,
    acao: textoOuNulo(o.acao, 40),
    motivo_silencio: textoOuNulo(o.motivo),
    modelo: textoOuNulo(o.modelo, 60),
    uso: usoSeguro(o.uso),
  };
}

/** ensaio_dry e replay_dry: sem bolhas, sem hmac, sem wa_id. */
function resumoEnsaio(b: unknown, replay: boolean): Record<string, unknown> {
  const o = objeto(b) ?? {};
  const turnos = (Array.isArray(o.turnos) ? o.turnos : []).slice(0, 20).map(t => turnoEnsaio(t, replay));
  const r: Record<string, unknown> = {
    ok: o.ok !== false, ligado: o.ligado === true, dry: o.dry === true, motivo: textoOuNulo(o.motivo),
    parou: textoOuNulo(o.parou, 20), chamadasIA: numero(o.chamadasIA) ?? 0, puladas: contagens(o.puladas),
  };
  if (replay) {
    r.conversasVistas = numero(o.conversasVistas) ?? 0;
    r.conversasProcessadas = numero(o.conversasProcessadas) ?? 0;
  } else {
    r.candidatas = numero(o.candidatas) ?? 0;
    r.decididas = numero(o.decididas) ?? 0;
    r.comModelo = numero(o.comModelo) ?? 0;
    r.ocupada = o.ocupada === true;
  }
  r.turnos_total = Array.isArray(o.turnos) ? o.turnos.length : 0;
  r.turnos = turnos;
  return r;
}

/** Transforma o retorno BRUTO da ação no que pode ser gravado. */
export function resumir(acao: Acao, bruto: unknown): unknown {
  const o = objeto(bruto) ?? {};
  switch (acao) {
    case 'ensaio_dry': return resumoEnsaio(bruto, false);
    case 'replay_dry': return resumoEnsaio(bruto, true);
    case 'ficha_dry': {
      const itens = (Array.isArray(o.itens) ? o.itens : []).slice(0, 40).map(i => {
        const it = objeto(i) ?? {};
        return {
          id: numero(it.id), resultado: textoOuNulo(it.resultado, 40), origem_da_ficha: textoOuNulo(it.origem_da_ficha, 40),
          card_gravado: it.card_gravado === true, previa_tamanho: typeof it.previa === 'string' ? it.previa.length : 0,
        };
      });
      return {
        rodou: o.rodou === true, ligada: o.ligada === true, dry: o.dry === true, motivo: textoOuNulo(o.motivo, 40),
        candidatos: numero(o.candidatos) ?? 0, itens_total: Array.isArray(o.itens) ? o.itens.length : 0, itens,
      };
    }
    case 'ficha_teste':
      return { enviado: o.enviado === true, texto_tamanho: typeof o.texto === 'string' ? o.texto.length : 0 };
    case 'sentinela_seco':
      return {
        ok: o.ok !== false, estado: textoOuNulo(o.estado, 30), alertas: numero(o.alertas) ?? 0, giovanna: o.giovanna === true,
        texto_tamanho: typeof o.texto === 'string' ? o.texto.length : 0, calada: o.texto === null || o.texto === undefined,
      };
    case 'anuncios': {
      // O id do anúncio é número longo de propósito (não é telefone): passa inteiro se for só dígitos.
      const nomes = (l: unknown): string[] => (Array.isArray(l) ? l : []).slice(0, 30).map(x => limparTexto(x, 40));
      const ids = (Array.isArray(o.ids) ? o.ids : []).slice(0, 40).map(i => {
        const it = objeto(i) ?? {};
        const id = String(it.id ?? '');
        return {
          id: /^\d{1,25}$/.test(id) ? id : '#', mensagens: numero(it.mensagens) ?? 0, campanha: textoOuNulo(it.campanha, 80),
          produto: textoOuNulo(it.produto, 30), motivo: textoOuNulo(it.motivo, 80),
        };
      });
      return {
        ok: o.ok !== false, dias: numero(o.dias), mensagens_recebidas: numero(o.mensagens_recebidas) ?? 0, truncado: o.truncado === true,
        com_bloco: numero(o.com_bloco) ?? 0, com_ad_id: numero(o.com_ad_id) ?? 0, por_produto: contagens(o.por_produto),
        ids_total: Array.isArray(o.ids) ? o.ids.length : 0, ids, campos_adContext: nomes(o.campos_adContext),
        campos_externalAdReply: nomes(o.campos_externalAdReply), erro: textoOuNulo(o.erro),
      };
    }
    default:
      return limpar(bruto);
  }
}

// ── limite de tamanho ────────────────────────────────────────────────────────

const bytes = (x: unknown): number => Buffer.byteLength(JSON.stringify(x), 'utf8');

function maiorLista(v: unknown, fundo = 0): { pai: Record<string, unknown>; chave: string; n: number } | null {
  if (fundo > 6) return null;
  const nivel = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : objeto(v) ? Object.entries(v as object) : [];
  let melhor: { pai: Record<string, unknown>; chave: string; n: number } | null = null;
  for (const [k, x] of nivel) {
    if (Array.isArray(x) && x.length > 1 && (!melhor || x.length > melhor.n)) melhor = { pai: v as Record<string, unknown>, chave: k, n: x.length };
    const f = maiorLista(x, fundo + 1);
    if (f && (!melhor || f.n > melhor.n)) melhor = f;
  }
  return melhor;
}

/** Encolhe o registro até caber em `max` bytes: corta a maior lista pela metade, sem nunca estourar. */
export function limitar(registro: ResultadoGravado, max = LIMITE_BYTES): ResultadoGravado {
  if (bytes(registro) <= max) return registro;
  const r: ResultadoGravado = JSON.parse(JSON.stringify(registro));
  for (let i = 0; i < 40 && bytes(r) > max; i++) {
    const m = maiorLista(r.resultado);
    if (!m) break;
    const lista = m.pai[m.chave] as unknown[];
    m.pai[m.chave] = lista.slice(0, Math.floor(lista.length / 2));
    const raiz = objeto(r.resultado);
    if (raiz) raiz.truncado = true;
  }
  if (bytes(r) <= max) return r;
  const raiz = objeto(r.resultado) ?? {};
  return { ...r, resultado: { truncado: true, ok: raiz.ok ?? null, chaves: Object.keys(raiz).slice(0, 20) } };
}

// ── a execução ───────────────────────────────────────────────────────────────

export type EstadoComando = 'nenhum' | 'descartado' | 'recusado' | 'ja_pego' | 'executado' | 'erro';
export interface RelatorioComando { estado: EstadoComando; acao?: string; ok?: boolean; motivo?: string }

export interface DepsComando {
  agora: () => Date;
  /** Valor bruto de ag5040_comando (null se ausente). Lança em erro. */
  ler: () => Promise<unknown>;
  /** Insert de ag5040_comando_vez:<pedido_em>. 'ja' = 23505. */
  reivindicar: (chave: string) => Promise<'ok' | 'ja' | 'erro'>;
  apagar: () => Promise<void>;
  gravar: (registro: ResultadoGravado) => Promise<void>;
  acoes: MapaAcoes;
  prazoMs?: number;
  registrar?: (nivel: 'info' | 'erro', mensagem: string, dado?: unknown) => void;
}

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`a ação passou de ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

/**
 * Nunca lança: roda antes do ensaio e não pode derrubá-lo. Devolve o que aconteceu, sem dado do comando além da ação.
 * Descarta sem rodar: comando ilegível, mais velho que 30 min, pedido do futuro, ação fora da lista, parâmetro inválido.
 */
export async function executarComandoPendente(deps: DepsComando): Promise<RelatorioComando> {
  const log = deps.registrar ?? (() => {});
  try {
    const bruto = await deps.ler();
    if (bruto === null || bruto === undefined) return { estado: 'nenhum' };
    const agora = deps.agora();
    const cmd = lerComando(bruto);
    const registro = (acao: string, pedido: string, ok: boolean, resultado: unknown): ResultadoGravado =>
      limitar({ acao: limparTexto(acao, 40), pedido_em: pedido, ok, resultado, terminou_em: deps.agora().toISOString() });

    if (!cmd) {
      await deps.apagar();
      await deps.gravar(registro('?', 'ilegivel', false, { motivo: 'comando_ilegivel' }));
      return { estado: 'descartado', motivo: 'comando_ilegivel' };
    }
    const idade = agora.getTime() - Date.parse(cmd.pedido_em);
    if (idade > IDADE_MAX_MS || idade < -FUTURO_MAX_MS) {
      const motivo = idade > 0 ? 'comando_velho' : 'pedido_no_futuro';
      await deps.apagar();
      await deps.gravar(registro(cmd.acao, cmd.pedido_em, false, { motivo }));
      return { estado: 'descartado', acao: limparTexto(cmd.acao, 40), motivo };
    }
    if (!ehAcao(cmd.acao)) {
      await deps.apagar();
      await deps.gravar(registro(cmd.acao, cmd.pedido_em, false, { motivo: 'acao_desconhecida', permitidas: [...ACOES] }));
      return { estado: 'recusado', acao: limparTexto(cmd.acao, 40), motivo: 'acao_desconhecida' };
    }
    const acao: Acao = cmd.acao;
    const v = validarParams(acao, cmd.params, agora);
    if (!v.ok) {
      await deps.apagar();
      await deps.gravar(registro(acao, cmd.pedido_em, false, { motivo: 'parametro_invalido', detalhe: v.motivo }));
      return { estado: 'recusado', acao, motivo: 'parametro_invalido' };
    }
    const fn = deps.acoes[acao];
    if (!fn) {
      await deps.apagar();
      await deps.gravar(registro(acao, cmd.pedido_em, false, { motivo: 'acao_nao_ligada' }));
      return { estado: 'recusado', acao, motivo: 'acao_nao_ligada' };
    }

    const vez = await deps.reivindicar(chaveVez(cmd.pedido_em));
    if (vez === 'ja') return { estado: 'ja_pego', acao };
    if (vez === 'erro') { log('erro', 'comando: não consegui reivindicar', { acao }); return { estado: 'erro', acao, motivo: 'erro_reivindicar' }; }
    await deps.apagar();

    let ok = true;
    let resultado: unknown;
    try {
      const retorno = await comPrazo(fn(v.params), deps.prazoMs ?? PRAZO_ACAO_MS);
      ok = objeto(retorno)?.ok !== false;
      resultado = resumir(acao, retorno);
    } catch (err) {
      ok = false;
      resultado = { erro: limparTexto((err as Error)?.message ?? err) };
      log('erro', `comando ${acao} falhou`, { erro: limparTexto((err as Error)?.message ?? err) });
    }
    await deps.gravar(registro(acao, cmd.pedido_em, ok, resultado));
    log('info', `comando ${acao} executado`, { ok });
    return { estado: 'executado', acao, ok };
  } catch (err) {
    log('erro', 'comando: falha geral', { erro: limparTexto((err as Error)?.message ?? err) });
    return { estado: 'erro', motivo: 'falha_geral' };
  }
}

// ── o banco real ─────────────────────────────────────────────────────────────

/** system_state do banco principal. Quem chama passa o `supabase` de utils/supabase.ts. */
export function depsDoBanco(db: { from: (t: string) => any }): Pick<DepsComando, 'agora' | 'ler' | 'reivindicar' | 'apagar' | 'gravar'> {
  return {
    agora: () => new Date(),
    ler: async () => {
      const { data, error } = await db.from('system_state').select('value').eq('key', CHAVE_COMANDO).maybeSingle();
      if (error) throw new Error(String(error.message ?? error.code ?? 'erro de leitura'));
      return data?.value ?? null;
    },
    reivindicar: async chave => {
      const { error } = await db.from('system_state').insert({ key: chave, value: { estado: 'reivindicado' }, updated_at: new Date().toISOString() });
      if (!error) return 'ok';
      return (error as { code?: string }).code === '23505' ? 'ja' : 'erro';
    },
    apagar: async () => {
      const { error } = await db.from('system_state').delete().eq('key', CHAVE_COMANDO);
      if (error) throw new Error(String(error.message ?? error.code ?? 'erro ao apagar'));
    },
    gravar: async registro => {
      const { error } = await db.from('system_state')
        .upsert({ key: CHAVE_RESULTADO, value: registro, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(String(error.message ?? error.code ?? 'erro ao gravar'));
    },
  };
}
