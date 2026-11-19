import crypto from 'crypto';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import { lerCadastro, type Cadastro } from './cadastroVenda';
import { SLOTS_LIDOS_SOLAR, dicasDeBeneficiarias, lerDocumentosDaVenda, type PessoasConhecidas } from './cadastroVendaLeitura';
import type { ArquivoDoc } from './docsCliente';
import { lerRotulos } from './docsRotulos';
import { invalidarCachesHub } from './vendaSolarHub';
import { aplicarLeitura, obraAbertaParaIa } from './leituraGravacao';
import { cotaDaPessoa, cotaDaVenda, devolver, marcarLidos, reservar } from './leituraRegistro';

export { MAX_LEITURAS_POR_HORA, MAX_LEITURAS_POR_PESSOA_HORA, caminhoLeituraAuto } from './leituraRegistro';

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA AUTOMÁTICA DOS DOCUMENTOS DA VENDA SOLAR (18/11/2026; ampliada em 19/11/2026): depois do envio (ou da troca) de um arquivo em QUALQUER item
// legível (`SLOTS_LIDOS_SOLAR`: documentos e comprovantes de cada pessoa, contas de luz, imóvel, contrato, procuração, orçamento e `outros`; ficam
// de fora as fotos, datasheets, KMZ e os papéis das etapas 4 em diante), o servidor lê SÓ aquele arquivo com a mesma leitura por IA que o botão "Ler"
// do cadastro usa (`lerDocumentosDaVenda`, com as mesmas pessoas) e grava no cadastro os campos que estão VAZIOS, com fonte 'ia' e o item do documento
// de origem. Cada item tem o seu dono (financiamento só fin_*, avalista só aval_*, beneficiária só benef_*, imóvel só imovel_*...) e nada é gravado
// com dado de outra pessoa (`leituraGravacao.ts`). Do contrato e do orçamento também sai o valor, o pagamento, o prazo e o kit. Nunca toca em dado
// preenchido (à mão ou não) e nada conta como confirmado.
//
// Roda em segundo plano (quem chama usa `waitUntil`); este módulo NUNCA lança e tem limite de tempo. Falha ou leitura vazia não gravam nada.
// Cota: o mesmo arquivo (pelo sha256) nunca é lido duas vezes, e no máximo `MAX_LEITURAS_POR_HORA` leituras por venda (o botão "Ler" tem 20 por hora
// por pessoa). O registro (`leituraRegistro.ts`) é reservado ANTES da chamada à IA, sob trava, para dois envios juntos do mesmo arquivo não gastarem
// duas chamadas, e guarda o id de cada arquivo lido (o que não está lá é "pendente": `leituraPendente.ts` lê esses quando a obra é aberta). Leitura
// que falha devolve a reserva.
//
// `lerTudoDaVenda` (rota "Ler tudo" da obra) lê todos os arquivos do card numa chamada só, sem o dedupe por sha. Cada pedido conta UMA leitura em DUAS
// cotas, as duas por hora e sob trava: a da venda (20, a mesma da leitura automática) e a da pessoa que pediu (30, em `leitura-pessoa/<nome>.json`,
// somando todas as vendas dela). Estourou qualquer uma: nada é lido. A leitura automática só conta na cota da venda.
// Passou do limite de tempo, o que ainda estava rodando não grava mais nada e devolve as reservas.
// ─────────────────────────────────────────────────────────────────────────────

/** Todo item legível da venda solar dispara a leitura (a lista das fotos e dos papéis que a IA não lê mora em `SLOTS_NAO_LIDOS_SOLAR`). */
export const SLOTS_LEITURA_AUTO: readonly string[] = SLOTS_LIDOS_SOLAR;
/** A IA já tem tempo de 90 s por chamada; este limite cobre o download e a gravação. `LEITURA_AUTO_TIMEOUT_MS` só para teste. */
export const LIMITE_LEITURA_AUTO_MS = 110_000;

export const logErro = (que: string, err: unknown): void =>
  console.error(`[cadastro-leitura-auto] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

/** Sinal de cancelamento: o limite de tempo estourou, e o que ainda roda não pode gravar nada. */
export interface Sinal { abortado: boolean }

/** Roda `fn` com o limite de tempo (nunca lança). Estourou ou falhou: `falha`; no estouro o `sinal` é marcado. */
export async function comLimite<T, F>(fn: (sinal: Sinal) => Promise<T>, falha: F): Promise<T | F> {
  const ms = Number(process.env.LEITURA_AUTO_TIMEOUT_MS) || LIMITE_LEITURA_AUTO_MS;
  const sinal: Sinal = { abortado: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<F>((ok) => { timer = setTimeout(() => { sinal.abortado = true; logErro('estourou o tempo', { codigo: 'timeout' }); ok(falha); }, ms); });
  const feito = fn(sinal).catch((e): F => { logErro('falhou', e); return falha; });
  return Promise.race([feito, estouro]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * As pessoas que o botão "Ler" também passa (geradorCadastroVenda.ts): o negociador (nome do card), o contratante, o titular da homologação, o do
 * financiamento e o avalista; e os rótulos: o nome que a PESSOA deu ao arquivo (rótulo manual) é pista de quem é o documento. `todos` são os arquivos
 * da venda (o número de cada conta de beneficiária sai da posição dela entre as contas da venda).
 */
export async function contextoDaLeitura(id: number, card: { cliente_nome?: unknown }, cad: Cadastro, todos: readonly ArquivoDoc[]) {
  const pessoas: PessoasConhecidas = {
    negociador: String(card.cliente_nome ?? ''), comprador: cad.campos.nome?.valor, titular_uc: cad.campos.tuc_nome?.valor,
    titular_financiamento: cad.campos.fin_nome?.valor, avalista: cad.campos.aval_nome?.valor,
  };
  const nomesDados = new Map<string, string>();
  const rotulados = new Set<string>();
  try {
    const rot = (await lerRotulos('vendasolar', String(id))).rotulos;
    for (const a of todos) { if (rot[a.id]) { rotulados.add(a.id); if (rot[a.id].fonte === 'manual') nomesDados.set(a.id, rot[a.id].rotulo); } }
  } catch (e) { logErro('rótulos indisponíveis', e); }
  return { pessoas, nomesDados, rotulados, dicas: dicasDeBeneficiarias(todos) };
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
  if (!(await obraAbertaParaIa(id))) return { acao: 'nada' };   // finalizada, cancelada ou conta fechada: nem gasta a IA
  const bytes = await baixarObjeto(arquivo.caminho);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  const venda = cotaDaVenda(id);
  const reserva = await reservar(venda, g.nome, sha, true, arquivo.id);
  if (reserva !== 'ok') return { acao: reserva };

  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos);
  const r = await lerDocumentosDaVenda([arquivo], { linha: 'vendasolar', ...ctx, baixar: async () => bytes });
  if (!r.ok || sinal.abortado) { await devolver(venda, g.nome, sha, [arquivo.id]); return { acao: 'falhou' }; }

  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: [arquivo], r, cad, cancelado: () => sinal.abortado });
  if (sinal.abortado) { await devolver(venda, g.nome, sha, [arquivo.id]); return { acao: 'falhou' }; }   // estourou o tempo no meio: nada foi gravado
  await marcarLidos(venda, g.nome, [], true).catch((e) => logErro('hora da leitura', e));
  const gravados = [...x.campos, ...x.comercial];
  if (gravados.length) invalidarCachesHub();   // a grade do /gerador deriva colunas do cadastro (cache de 60 s)
  return gravados.length ? { acao: 'gravou', campos: gravados } : { acao: 'nada' };
}

// ── "Ler tudo": todos os arquivos legíveis do card, de uma vez ───────────────

export type ResultadoLerTudo = { acao: 'ok'; preenchidos: string[]; ignorados: number } | { acao: 'cota' | 'falhou' | 'sem_arquivo' | 'obra_fechada' };

/**
 * Lê de uma vez todos os arquivos legíveis do card (até 20 arquivos e 22 MB; o que passar espera a próxima leitura, e a ordem prioriza documento,
 * conta de luz, comprovantes, contrato, procuração e orçamento) e grava pelas mesmas regras da leitura automática. Ignora o dedupe por sha, mas
 * conta UMA leitura na cota de 20 por hora da venda (e uma na da pessoa). Os arquivos lidos passam a contar como lidos. Nunca lança; limite de 110 s.
 */
export async function lerTudoDaVenda(g: { card: { id: number; cliente_nome?: unknown }; nome: string }): Promise<ResultadoLerTudo> {
  return comLimite((sinal) => lerTudo(g, sinal), { acao: 'falhou' } as ResultadoLerTudo);
}

async function lerTudo(g: { card: { id: number; cliente_nome?: unknown }; nome: string }, sinal: Sinal): Promise<ResultadoLerTudo> {
  const id = g.card.id;
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  if (!reg.arquivos.some((a) => SLOTS_LIDOS_SOLAR.includes(a.slot))) return { acao: 'sem_arquivo' };
  if (!(await obraAbertaParaIa(id))) return { acao: 'obra_fechada' };   // finalizada, cancelada ou com a conta fechada: a rota responde 409
  const sha = crypto.createHash('sha256').update(`ler-tudo:${id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  const venda = cotaDaVenda(id);
  const pessoa = cotaDaPessoa(g.nome);
  if ((await reservar(venda, g.nome, sha, false)) !== 'ok') return { acao: 'cota' };
  if ((await reservar(pessoa, g.nome, sha, false)) !== 'ok') { await devolver(venda, g.nome, sha); return { acao: 'cota' }; }
  const devolverTudo = async (): Promise<void> => { await devolver(venda, g.nome, sha); await devolver(pessoa, g.nome, sha); };

  const cad = await lerCadastro(id, 'vendasolar');
  const ctx = await contextoDaLeitura(id, g.card, cad, reg.arquivos);
  const r = await lerDocumentosDaVenda(reg.arquivos, { linha: 'vendasolar', ...ctx });
  if (!r.ok || sinal.abortado) { await devolverTudo(); return { acao: !r.ok && r.motivo === 'sem_documentos' ? 'sem_arquivo' : 'falhou' }; }

  const x = await aplicarLeitura({ id, nome: g.nome, arquivos: reg.arquivos, r, cad, cancelado: () => sinal.abortado });
  if (sinal.abortado) { await devolverTudo(); return { acao: 'falhou' }; }
  await marcarLidos(venda, g.nome, r.aceitos.map((aid) => ({ id: aid })), true).catch((e) => logErro('arquivos lidos', e));
  const preenchidos = [...x.campos, ...x.comercial];
  if (preenchidos.length) invalidarCachesHub();
  return { acao: 'ok', preenchidos, ignorados: r.ignorados.length + x.deOutraPessoa };
}
