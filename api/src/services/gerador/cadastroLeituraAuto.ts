import crypto from 'crypto';
import { baixarObjeto, lerDocsComVersao } from './docsClienteBanco';
import { CAMPOS_DECISAO_PAPEIS, CAMPOS_ENGENHARIA, ehCampo, escreverCadastro, lerCadastro, validarCampo } from './cadastroVenda';
import { lerDocumentosDaVenda, type PessoasConhecidas, type ResultadoLeituraCadastro } from './cadastroVendaLeitura';
import { donoDoArquivo, papelDoCampo } from './cadastroVendaPapeis';
import { lerRotulos } from './docsRotulos';
import { normalizarNome } from './dossieVenda';
import { comTrava, gravarJsonBruto, lerJsonBruto } from './cadastroVendaBanco';
import { invalidarCachesHub } from './vendaSolarHub';

// ─────────────────────────────────────────────────────────────────────────────
// CABEÇALHO AUTOMÁTICO da etapa 1 da venda solar (18/11/2026): depois do envio (ou da troca) de um arquivo nos itens `documento_titular`,
// `documento_titular_uc` ou `conta_luz`, o servidor lê SÓ aquele arquivo com a mesma leitura por IA que o botão "Ler" do cadastro usa
// (`lerDocumentosDaVenda`) e grava no cadastro os campos que estão VAZIOS, com fonte 'ia'. Nunca toca em campo preenchido (à mão ou não).
//
// Roda em segundo plano (quem chama usa `waitUntil`); este módulo NUNCA lança e tem limite de tempo. Falha ou leitura vazia não gravam nada.
// Cota: o mesmo arquivo (pelo sha256) nunca é lido duas vezes, e no máximo `MAX_LEITURAS_POR_HORA` leituras por venda (o botão "Ler" tem
// 20 por hora por pessoa). O registro vive em `vendasolar/<card>.leitura.json` (bucket privado) e é reservado ANTES da chamada à IA, sob trava,
// para dois envios juntos do mesmo arquivo não gastarem duas chamadas. Leitura que falha devolve a reserva.
// ─────────────────────────────────────────────────────────────────────────────

export const SLOTS_LEITURA_AUTO: readonly string[] = ['documento_titular', 'documento_titular_uc', 'conta_luz'];
export const MAX_LEITURAS_POR_HORA = 20;
/** A IA já tem tempo de 90 s por chamada; este limite cobre o download e a gravação. `LEITURA_AUTO_TIMEOUT_MS` só para teste. */
export const LIMITE_LEITURA_AUTO_MS = 110_000;
export const caminhoLeituraAuto = (card: number): string => `vendasolar/${card}.leitura.json`;

interface RegistroLeitura { v: 1; lidos: Array<{ sha: string; em: string }> }
const UMA_HORA_MS = 60 * 60 * 1000;

const logErro = (que: string, err: unknown): void =>
  console.error(`[cadastro-leitura-auto] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

async function lerRegistro(card: number): Promise<RegistroLeitura> {
  const v = await lerJsonBruto(caminhoLeituraAuto(card));
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  const lidos = Array.isArray(o?.lidos) ? (o!.lidos as unknown[]).flatMap((x) => {
    const e = x && typeof x === 'object' ? x as Record<string, unknown> : null;
    return e && typeof e.sha === 'string' && /^[0-9a-f]{64}$/.test(e.sha) && typeof e.em === 'string' ? [{ sha: e.sha, em: e.em }] : [];
  }) : [];
  return { v: 1, lidos: lidos.slice(-100) };
}

/** Dois nomes de pessoa são a mesma? Compara normalizado: igual, ou o mais curto (2 palavras ou mais) cabe inteiro no mais longo. */
function mesmoNome(a: string, b: string): boolean {
  const x = normalizarNome(a); const y = normalizarNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [curto, longo] = x.length <= y.length ? [x.split(' '), new Set(y.split(' '))] : [y.split(' '), new Set(x.split(' '))];
  return curto.length >= 2 && curto.every((p) => longo.has(p));
}

/**
 * O arquivo lido (item do titular ou da conta) é de outra pessoa que não o contratante? Sim quando: o leitor deu ao conteúdo um dono diferente
 * do contratante (financiador, avalista...), ou trouxe campos de outra pessoa (fin_, aval_, ced_), ou o nome lido é o do financiador/avalista já
 * conhecido, ou há contratante conhecido e o nome lido é outro. Só vale para o item `documento_titular`: os demais itens não alimentam o contratante.
 */
function documentoDeOutraPessoa(
  arquivo: { id: string; slot: string }, r: Extract<ResultadoLeituraCadastro, { ok: true }>, contratante: string | undefined, outros: ReadonlyArray<string | undefined>,
): boolean {
  if (arquivo.slot !== 'documento_titular') return false;
  const doc = r.documentos.find((d) => d.id === arquivo.id);
  const dono = donoDoArquivo(arquivo.slot, doc?.tipo, 'vendasolar');
  if (dono && dono !== 'comprador') return true;
  if (Object.keys(r.sugestoes).some((c) => ['fin_', 'aval_', 'ced_', 'tuc_'].some((p) => c.startsWith(p)))) return true;
  const lido = r.sugestoes.nome?.valor ?? '';
  if (!lido) return false;
  if (outros.some((n) => !!n && mesmoNome(lido, n)) && !(contratante && mesmoNome(lido, contratante))) return true;
  return !!contratante?.trim() && !mesmoNome(lido, contratante);
}

export type ResultadoLeituraAuto = { acao: 'gravou'; campos: string[] } | { acao: 'nada' | 'repetido' | 'cota' | 'falhou' | 'sem_arquivo' };

/**
 * Lê o arquivo recém-enviado e completa o cadastro. `arquivoId` é o id do arquivo no registro dos documentos da venda. Nunca lança.
 */
export async function lerCadastroAutomatico(
  g: { card: { id: number; cliente_nome?: unknown }; nome: string; arquivoId: string },
): Promise<ResultadoLeituraAuto> {
  const ms = Number(process.env.LEITURA_AUTO_TIMEOUT_MS) || LIMITE_LEITURA_AUTO_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<'falhou'>((ok) => { timer = setTimeout(() => { logErro('estourou o tempo', { codigo: 'timeout' }); ok('falhou'); }, ms); });
  const feito = lerEGravar(g).catch((e): ResultadoLeituraAuto => { logErro('falhou', e); return { acao: 'falhou' }; });
  const r = await Promise.race([feito, estouro]).finally(() => { if (timer) clearTimeout(timer); });
  return r === 'falhou' ? { acao: 'falhou' } : r;
}

async function lerEGravar(g: { card: { id: number; cliente_nome?: unknown }; nome: string; arquivoId: string }): Promise<ResultadoLeituraAuto> {
  const id = g.card.id;
  const { reg } = await lerDocsComVersao('vendasolar', String(id));
  const arquivo = reg.arquivos.find((a) => a.id === g.arquivoId);
  if (!arquivo || !SLOTS_LEITURA_AUTO.includes(arquivo.slot)) return { acao: 'sem_arquivo' };
  const bytes = await baixarObjeto(arquivo.caminho);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  // Reserva (sob trava): o mesmo sha não lê duas vezes e a cota por hora vale para a venda toda.
  const reserva = await comTrava(`leitura-auto:${id}`, g.nome, async (): Promise<'ok' | 'repetido' | 'cota'> => {
    const r = await lerRegistro(id);
    if (r.lidos.some((x) => x.sha === sha)) return 'repetido';
    const agora = Date.now();
    if (r.lidos.filter((x) => agora - Date.parse(x.em) < UMA_HORA_MS).length >= MAX_LEITURAS_POR_HORA) return 'cota';
    await gravarJsonBruto(caminhoLeituraAuto(id), { v: 1, lidos: [...r.lidos, { sha, em: new Date(agora).toISOString() }] });
    return 'ok';
  }, 60_000, { tentativas: 10, esperaMs: 300 });
  if (reserva !== 'ok') return { acao: reserva };
  const devolverReserva = async (): Promise<void> => {
    try {
      await comTrava(`leitura-auto:${id}`, g.nome, async () => {
        const r = await lerRegistro(id);
        await gravarJsonBruto(caminhoLeituraAuto(id), { v: 1, lidos: r.lidos.filter((x) => x.sha !== sha) });
      }, 60_000, { tentativas: 10, esperaMs: 300 });
    } catch (e) { logErro('devolver a reserva', e); }
  };

  const cad = await lerCadastro(id, 'vendasolar');
  // As mesmas pessoas que o botão "Ler" passa (geradorCadastroVenda.ts): o negociador (nome do card), o contratante, o titular da homologação,
  // o do financiamento e o avalista. E o nome que a PESSOA deu ao arquivo (rótulo manual), que é pista de quem é o documento.
  const pessoas: PessoasConhecidas = {
    negociador: String(g.card.cliente_nome ?? ''), comprador: cad.campos.nome?.valor, titular_uc: cad.campos.tuc_nome?.valor,
    titular_financiamento: cad.campos.fin_nome?.valor, avalista: cad.campos.aval_nome?.valor,
  };
  const nomesDados = new Map<string, string>();
  const rotulados = new Set<string>();
  try {
    const rot = (await lerRotulos('vendasolar', String(id))).rotulos[arquivo.id];
    if (rot) { rotulados.add(arquivo.id); if (rot.fonte === 'manual') nomesDados.set(arquivo.id, rot.rotulo); }
  } catch (e) { logErro('rótulos indisponíveis', e); }
  const r = await lerDocumentosDaVenda([arquivo], { linha: 'vendasolar', pessoas, rotulados, nomesDados, baixar: async () => bytes });
  if (!r.ok) { await devolverReserva(); return { acao: 'falhou' }; }

  // Salvaguarda do contratante: o documento do slot do titular pode ser de OUTRA pessoa (financiador, avalista, cônjuge). Os campos do contratante
  // só entram quando o nome lido bate com o contratante já conhecido; sem contratante conhecido, só se o leitor não apontar outra pessoa.
  const outraPessoa = documentoDeOutraPessoa(arquivo, r, cad.campos.nome?.valor, [cad.campos.fin_nome?.valor, cad.campos.aval_nome?.valor]);

  // Só o que a leitura achou com confiança, que é campo desta venda, passa na validação de sempre e não é decisão nem dado de engenharia.
  const proibidos = new Set<string>([...CAMPOS_DECISAO_PAPEIS, ...CAMPOS_ENGENHARIA]);
  const limpos: Record<string, string> = {};
  for (const [campo, s] of Object.entries(r.sugestoes)) {
    if (!ehCampo(campo, 'vendasolar') || proibidos.has(campo) || s.confianca === 'baixa') continue;
    if (outraPessoa && papelDoCampo(campo) === 'comprador') continue;
    const v = validarCampo(campo, s.valor);
    if (v.ok && v.valor) limpos[campo] = v.valor;
  }
  if (!Object.keys(limpos).length) return { acao: 'nada' };

  const antes = cad.campos;
  const depois = (await escreverCadastro(id, limpos, g.nome, 'ia', new Date().toISOString(), 'vendasolar', { soVazios: true })).cad;
  const gravados = Object.keys(limpos).filter((k) => depois.campos[k as keyof typeof depois.campos]?.valor !== antes[k as keyof typeof antes]?.valor);
  if (gravados.length) invalidarCachesHub();   // a grade do /gerador deriva colunas do cadastro (cache de 60 s)
  return gravados.length ? { acao: 'gravou', campos: gravados } : { acao: 'nada' };
}
