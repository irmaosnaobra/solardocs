import crypto from 'crypto';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import { lerCadastro, type Cadastro } from './cadastroVenda';
import { SLOTS_LIDOS_SOLAR, lerDocumentosDaVenda, type PessoasConhecidas } from './cadastroVendaLeitura';
import { lerRotulos } from './docsRotulos';
import { comTrava, gravarJsonBruto, lerJsonBruto } from './cadastroVendaBanco';
import { invalidarCachesHub } from './vendaSolarHub';
import { aplicarLeitura } from './leituraGravacao';

// ─────────────────────────────────────────────────────────────────────────────
// CABEÇALHO AUTOMÁTICO da etapa 1 da venda solar (18/11/2026; ampliado em 19/11/2026): depois do envio (ou da troca) de um arquivo nos itens
// `documento_titular`, `documento_titular_uc`, `conta_luz`, `comprovante_endereco_comprador`, `contrato_assinado`, `procuracao` ou `orcamento`,
// o servidor lê SÓ aquele arquivo com a mesma leitura por IA que o botão "Ler" do cadastro usa (`lerDocumentosDaVenda`) e grava no cadastro os
// campos que estão VAZIOS, com fonte 'ia' e o item do documento de origem. Do contrato e do orçamento também sai o valor, o pagamento, o prazo e o
// kit (`leituraGravacao.ts`). Nunca toca em dado preenchido (à mão ou não) e nada conta como confirmado.
//
// Roda em segundo plano (quem chama usa `waitUntil`); este módulo NUNCA lança e tem limite de tempo. Falha ou leitura vazia não gravam nada.
// Cota: o mesmo arquivo (pelo sha256) nunca é lido duas vezes, e no máximo `MAX_LEITURAS_POR_HORA` leituras por venda (o botão "Ler" tem
// 20 por hora por pessoa). O registro vive em `vendasolar/<card>.leitura.json` (bucket privado) e é reservado ANTES da chamada à IA, sob trava,
// para dois envios juntos do mesmo arquivo não gastarem duas chamadas. Leitura que falha devolve a reserva.
//
// `lerTudoDaVenda` (rota "Ler tudo" da obra) lê todos os arquivos do card numa chamada só, sem o dedupe por sha. Cada pedido conta UMA leitura em DUAS
// cotas, as duas por hora e sob trava: a da venda (20, a mesma da leitura automática) e a da pessoa que pediu (30, em `leitura-pessoa/<nome>.json`,
// somando todas as vendas dela). Estourou qualquer uma: nada é lido. A leitura automática só conta na cota da venda.
// Passou do limite de tempo, o que ainda estava rodando não grava mais nada e devolve as reservas.
// ─────────────────────────────────────────────────────────────────────────────

export const SLOTS_LEITURA_AUTO: readonly string[] = [
  'documento_titular', 'documento_titular_uc', 'conta_luz', 'comprovante_endereco_comprador', 'contrato_assinado', 'procuracao', 'orcamento',
];
export const MAX_LEITURAS_POR_HORA = 20;
/** "Ler tudo": o teto de pedidos por hora de uma mesma pessoa, em todas as vendas. */
export const MAX_LEITURAS_POR_PESSOA_HORA = 30;
/** A IA já tem tempo de 90 s por chamada; este limite cobre o download e a gravação. `LEITURA_AUTO_TIMEOUT_MS` só para teste. */
export const LIMITE_LEITURA_AUTO_MS = 110_000;
export const caminhoLeituraAuto = (card: number): string => `vendasolar/${card}.leitura.json`;

interface RegistroLeitura { v: 1; lidos: Array<{ sha: string; em: string }> }
const UMA_HORA_MS = 60 * 60 * 1000;
const TRAVA = { tentativas: 10, esperaMs: 300 };

const logErro = (que: string, err: unknown): void =>
  console.error(`[cadastro-leitura-auto] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

/** Uma cota por hora: onde ficam as leituras (bucket privado), a trava que protege o registro e o teto. */
interface Cota { caminho: string; trava: string; limite: number }
const cotaDaVenda = (card: number): Cota => ({ caminho: caminhoLeituraAuto(card), trava: `leitura-auto:${card}`, limite: MAX_LEITURAS_POR_HORA });
const cotaDaPessoa = (nome: string): Cota => {
  const slug = nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'sem_nome';
  return { caminho: `leitura-pessoa/${slug}.json`, trava: `leitura-pessoa:${slug}`, limite: MAX_LEITURAS_POR_PESSOA_HORA };
};

async function lerRegistro(caminho: string): Promise<RegistroLeitura> {
  const v = await lerJsonBruto(caminho);
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  const lidos = Array.isArray(o?.lidos) ? (o!.lidos as unknown[]).flatMap((x) => {
    const e = x && typeof x === 'object' ? x as Record<string, unknown> : null;
    return e && typeof e.sha === 'string' && /^[0-9a-f]{64}$/.test(e.sha) && typeof e.em === 'string' ? [{ sha: e.sha, em: e.em }] : [];
  }) : [];
  return { v: 1, lidos: lidos.slice(-100) };
}

/** Reserva (sob trava) uma leitura: o mesmo sha não lê duas vezes (`dedupe`) e a cota por hora vale para o dono do registro. */
async function reservar(c: Cota, nome: string, sha: string, dedupe: boolean): Promise<'ok' | 'repetido' | 'cota'> {
  return comTrava(c.trava, nome, async (): Promise<'ok' | 'repetido' | 'cota'> => {
    const r = await lerRegistro(c.caminho);
    if (dedupe && r.lidos.some((x) => x.sha === sha)) return 'repetido';
    const agora = Date.now();
    if (r.lidos.filter((x) => agora - Date.parse(x.em) < UMA_HORA_MS).length >= c.limite) return 'cota';
    await gravarJsonBruto(c.caminho, { v: 1, lidos: [...r.lidos, { sha, em: new Date(agora).toISOString() }] });
    return 'ok';
  }, 60_000, TRAVA);
}

/** Leitura que falha (ou que estourou o tempo) devolve a reserva. */
async function devolver(c: Cota, nome: string, sha: string): Promise<void> {
  try {
    await comTrava(c.trava, nome, async () => {
      const r = await lerRegistro(c.caminho);
      await gravarJsonBruto(c.caminho, { v: 1, lidos: r.lidos.filter((x) => x.sha !== sha) });
    }, 60_000, TRAVA);
  } catch (e) { logErro('devolver a reserva', e); }
}

/** Sinal de cancelamento: o limite de tempo estourou, e o que ainda roda não pode gravar nada. */
interface Sinal { abortado: boolean }

/** Roda `fn` com o limite de tempo (nunca lança). Estourou ou falhou: `falha`; no estouro o `sinal` é marcado. */
async function comLimite<T, F>(fn: (sinal: Sinal) => Promise<T>, falha: F): Promise<T | F> {
  const ms = Number(process.env.LEITURA_AUTO_TIMEOUT_MS) || LIMITE_LEITURA_AUTO_MS;
  const sinal: Sinal = { abortado: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<F>((ok) => { timer = setTimeout(() => { sinal.abortado = true; logErro('estourou o tempo', { codigo: 'timeout' }); ok(falha); }, ms); });
  const feito = fn(sinal).catch((e): F => { logErro('falhou', e); return falha; });
  return Promise.race([feito, estouro]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * As pessoas que o botão "Ler" também passa (geradorCadastroVenda.ts): o negociador (nome do card), o contratante, o titular da homologação, o do
 * financiamento e o avalista; e os rótulos: o nome que a PESSOA deu ao arquivo (rótulo manual) é pista de quem é o documento.
 */
async function contextoDaLeitura(id: number, card: { cliente_nome?: unknown }, cad: Cadastro, ids: readonly string[]) {
  const pessoas: PessoasConhecidas = {
    negociador: String(card.cliente_nome ?? ''), comprador: cad.campos.nome?.valor, titular_uc: cad.campos.tuc_nome?.valor,
    titular_financiamento: cad.campos.fin_nome?.valor, avalista: cad.campos.aval_nome?.valor,
  };
  const nomesDados = new Map<string, string>();
  const rotulados = new Set<string>();
  try {
    const rot = (await lerRotulos('vendasolar', String(id))).rotulos;
    for (const aid of ids) { if (rot[aid]) { rotulados.add(aid); if (rot[aid].fonte === 'manual') nomesDados.set(aid, rot[aid].rotulo); } }
  } catch (e) { logErro('rótulos indisponíveis', e); }
  return { pessoas, nomesDados, rotulados };
}

export type ResultadoLeituraAuto = { acao: 'gravou'; campos: string[] } | { acao: 'nada' | 'repetido' | 'cota' | 'falhou' | 'sem_arquivo' };

/**
 * Lê o arquivo recém-enviado e completa o cadastro e os dados da venda. `arquivoId` é o id do arquivo no registro dos documentos da venda. Nunca lança.
 */
export async function lerCadastroAutomatico(
  g: { card: { id: number; cliente_nome?: unknown }; nome: string; arquivoId: string },
): Promise<ResultadoLeituraAuto> {
  return comLimite((sinal) => lerEGravar(g, sinal), { acao: 'falhou' } as ResultadoLeituraAuto);
}

async function lerEGravar(g: { card: { id: number; cliente_nome?: unknown }; nome: string; arquivoId: string }, sinal: Sinal): Promise<ResultadoLeituraAuto> {
  const id = g.card.id;
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  const arquivo = reg.arquivos.find((a) => a.id === g.arquivoId);
  if (!arquivo || !SLOTS_LEITURA_AUTO.includes(arquivo.slot)) return { acao: 'sem_arquivo' };
  const bytes = await baixarObjeto(arquivo.caminho);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  const venda = cotaDaVenda(id);
  const reserva = await reservar(venda, g.nome, sha, true);
  if (reserva !== 'ok') return { acao: reserva };

  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, [arquivo.id]);
  const r = await lerDocumentosDaVenda([arquivo], { linha: 'vendasolar', ...ctx, baixar: async () => bytes });
  if (!r.ok || sinal.abortado) { await devolver(venda, g.nome, sha); return { acao: 'falhou' }; }

  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: [arquivo], r, cad, cancelado: () => sinal.abortado });
  const gravados = [...x.campos, ...x.comercial];
  if (gravados.length) invalidarCachesHub();   // a grade do /gerador deriva colunas do cadastro (cache de 60 s)
  return gravados.length ? { acao: 'gravou', campos: gravados } : { acao: 'nada' };
}

// ── "Ler tudo": todos os arquivos legíveis do card, de uma vez ───────────────

export type ResultadoLerTudo = { acao: 'ok'; preenchidos: string[]; ignorados: number } | { acao: 'cota' | 'falhou' | 'sem_arquivo' };

/**
 * Lê de uma vez todos os arquivos legíveis do card (até 20 arquivos e 22 MB; o que passar espera a próxima leitura, e a ordem prioriza documento,
 * conta de luz, comprovantes, contrato, procuração e orçamento) e grava pelas mesmas regras da leitura automática. Ignora o dedupe por sha, mas
 * conta UMA leitura na cota de 20 por hora da venda. Nunca lança; limite de 110 s.
 */
export async function lerTudoDaVenda(g: { card: { id: number; cliente_nome?: unknown }; nome: string }): Promise<ResultadoLerTudo> {
  return comLimite((sinal) => lerTudo(g, sinal), { acao: 'falhou' } as ResultadoLerTudo);
}

async function lerTudo(g: { card: { id: number; cliente_nome?: unknown }; nome: string }, sinal: Sinal): Promise<ResultadoLerTudo> {
  const id = g.card.id;
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  if (!reg.arquivos.some((a) => SLOTS_LIDOS_SOLAR.includes(a.slot))) return { acao: 'sem_arquivo' };
  const sha = crypto.createHash('sha256').update(`ler-tudo:${id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  const venda = cotaDaVenda(id);
  const pessoa = cotaDaPessoa(g.nome);
  if ((await reservar(venda, g.nome, sha, false)) !== 'ok') return { acao: 'cota' };
  if ((await reservar(pessoa, g.nome, sha, false)) !== 'ok') { await devolver(venda, g.nome, sha); return { acao: 'cota' }; }
  const devolverTudo = async (): Promise<void> => { await devolver(venda, g.nome, sha); await devolver(pessoa, g.nome, sha); };

  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos.map((a) => a.id));
  const r = await lerDocumentosDaVenda(reg.arquivos, { linha: 'vendasolar', ...ctx });
  if (!r.ok || sinal.abortado) { await devolverTudo(); return { acao: !r.ok && r.motivo === 'sem_documentos' ? 'sem_arquivo' : 'falhou' }; }

  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: reg.arquivos, r, cad, cancelado: () => sinal.abortado });
  const preenchidos = [...x.campos, ...x.comercial];
  if (preenchidos.length) invalidarCachesHub();
  return { acao: 'ok', preenchidos, ignorados: r.ignorados.length + x.deOutraPessoa };
}
