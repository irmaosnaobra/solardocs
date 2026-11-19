import type { Request, Response } from 'express';
import { rotaTrelloDaVenda, type DonoDoCard } from './geradorVendaSolarTrello';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import { lerDocsComVersao } from '../services/gerador/docsClienteBanco';
import { lerJornadaComVersao, lerPrivadoJornada, mudarJornada } from '../services/gerador/jornadaSolarBanco';
import { baseDaJornada } from './geradorJornadaNumero';
import { lerCadastroVisto } from '../services/gerador/cadastroVenda';
import { comTrava } from '../services/gerador/cadastroVendaBanco';
import { obraFinalizada } from '../services/gerador/jornadaCorte';
import { estadoTrelloAuto } from '../services/gerador/jornadaSolar';
import type { CardVendido } from '../services/gerador/fichaEletroposto';
import { waitUntil } from '../utils/waitUntil';
import { gerarRelatorioFinal } from './geradorJornadaRelatorioFinal';
import { credenciaisTrello, trelloQuadroPublico, anexarNoTrello } from '../services/gerador/dossieVenda';
import { gravarRegistroTrello, idsDosAnexos, lerRegistroTrello, registroTrelloVazio } from '../services/gerador/trelloVendaSolar';
import { CHAVE_ANEXO_RELATORIO } from '../services/gerador/relatorioFinal';
import { TRELLO_BOARD_ID } from '../services/insightsService';

// ─────────────────────────────────────────────────────────────────────────────
// TRELLO AUTOMÁTICO DA JORNADA (18/11/2026). O cartão do Trello da venda solar nasce sozinho quando as etapas 1 e 2 fecharam, todo o
// bloco `equipamento` da etapa 3 está feito (kit confirmado, datasheet da placa, datasheet do inversor, KMZ), a obra já tem número e
// não foi cancelada. Roda o MESMO fluxo do botão (`rotaTrelloDaVenda`), com um `res` que só guarda a resposta; o registro do cartão
// (`etapas[3].trello`) é feito por ele.
//
// ANTES de criar, roda a prévia do botão: se o quadro tem cartões parecidos ou candidatos (o botão pediria a escolha), DESISTE (log e uma
// marca no histórico, que o GET mostra em `trello_auto.falta`) e deixa a decisão para a pessoa. Nunca cria cartão duplicado.
//
// CARTÃO QUE JÁ EXISTE (criado antes pelo botão): com as 3 fases fechadas o mesmo fluxo do botão COMPLETA o cartão: anexa os arquivos que
// ainda não estão nele (sem repetir e nunca o contrato assinado), marca na BACKOFFICE o que agora está cumprido (KMZ inclusive) e atualiza a
// ficha no comentário. Só acrescenta, nunca remove. Feito com sucesso, grava `etapas[3].trello.completado_em` e não repete.
//
// Idempotente: sem condição, ou com o cartão já criado, não faz nada. Uma trava própria (`trello-auto:<card>`, sem espera) impede dois
// cartões em chamadas simultâneas, e o fluxo do botão ainda tem a trava dele (`trello:<card>`). Falha só vira log: o botão manual
// continua sendo a reserva. Quem chama: concluir a etapa 2, o PUT que confirma o kit e o envio de datasheet/KMZ.
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoTrelloAuto =
  | { acao: 'criou' | 'completou' | 'ja_tem' | 'ocupado' }
  | { acao: 'nao_pronto'; falta: string[] }
  | { acao: 'parecidos' }
  | { acao: 'falhou'; status?: number };

/** Mais que o envio mais longo do botão (330 s): a trava nunca vence com o dono vivo; se o processo morrer, expira sozinha. */
const TTL_TRAVA_AUTO_MS = 340_000;

const logErro = (que: string, err: unknown): void =>
  console.error(`[trello-auto] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

/** Chama o fluxo do botão com um `res` que só guarda a resposta. */
async function rodarFluxo(dono: DonoDoCard, corpo: Record<string, unknown>): Promise<{ status: number; corpo: unknown }> {
  const captura: { status: number; corpo: unknown } = { status: 200, corpo: null };
  const res = {
    status(c: number) { captura.status = c; return this; },
    json(b: unknown) { captura.corpo = b; return this; },
  } as unknown as Response;
  await rotaTrelloDaVenda({ body: corpo } as unknown as Request, res, async () => dono);
  return captura;
}

/** Grava (uma vez) que o automático parou por causa de cartões parecidos. Falha aqui só vira log. */
async function marcarParada(
  card: CardVendido, slots: ReadonlySet<string>, lig: { venda: string | null }, por: string, acao: 'trello_auto_parou' | 'trello_auto_arquivado' = 'trello_auto_parou',
): Promise<void> {
  try {
    await mudarJornada(card.id, baseDaJornada(card, slots, lig), (e) => {
      if (e.historico.some((x) => x.acao === acao)) return e;
      return { ...e, historico: [...e.historico, { em: new Date().toISOString(), por, acao, etapa: 3 }].slice(-50) };
    });
  } catch (err) { logErro('marcar parada', err); }
}

type Cred = NonNullable<ReturnType<typeof credenciaisTrello>>;

/** O relatório já está no cartão? (registro do envio + anexos do cartão). Não deu para conferir = sim: na dúvida, não repete. */
async function relatorioJaNoCartao(cred: Cred, cardId: number, cartaoId: string): Promise<boolean> {
  const lido = await lerRegistroTrello(cardId);
  const jaId = lido.card_id === cartaoId ? lido.anexados[CHAVE_ANEXO_RELATORIO] : undefined;
  if (!jaId) return false;
  const tem = await idsDosAnexos(cred, cartaoId);
  return !tem.ok || tem.dados.has(jaId);
}

/** O limite da geração do PDF (o Chromium roda dentro do `waitUntil`): estourou, loga e segue sem relatório. `RELATORIO_FINAL_TIMEOUT_MS` só para teste. */
export const LIMITE_RELATORIO_MS = 60_000;

export type ResultadoAnexoRelatorio = 'anexado' | 'anexado_datado' | 'ja_anexado' | 'sem_cartao' | 'quadro_publico' | 'sem_credencial' | 'falhou';

/** `DD-MM-AAAA` de hoje em Brasília, para o nome do relatório novo. */
const dataNoNome = (): string => {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const p = (t: string): string => f.find((x) => x.type === t)?.value ?? '00';
  return `${p('day')}-${p('month')}-${p('year')}`;
};

/**
 * Anexa o PDF (já gerado) ao cartão, DENTRO da trava do cartão (`trello:<card>`, a mesma do botão), com o registro relido lá dentro: nunca
 * perde um anexo que outro gravou nem duplica. Chave própria no registro (`relatorio_final`). `manual` (o botão "Gerar de novo"): se já há um
 * relatório no cartão, anexa o novo com nome DATADO e registra com chave própria, sem apagar o antigo; no automático, já anexado = não repete.
 * Quadro público: nada sobe. Nunca lança.
 */
async function anexarPdf(card: CardVendido, quem: { nome: string }, cartaoId: string, pdf: Buffer, manual: boolean): Promise<ResultadoAnexoRelatorio> {
  try {
    const cred = credenciaisTrello();
    if (!cred) return 'sem_credencial';
    if (await trelloQuadroPublico(String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID)) return 'quadro_publico';
    let resultado: ResultadoAnexoRelatorio = 'falhou';
    await comTrava(`trello:${card.id}`, quem.nome, async () => {
      const ja = await relatorioJaNoCartao(cred, card.id, cartaoId);   // relido DENTRO da trava
      if (ja && !manual) { resultado = 'ja_anexado'; return; }
      const lido = await lerRegistroTrello(card.id);
      const reg = lido.card_id === cartaoId ? lido : { ...registroTrelloVazio(), card_id: cartaoId };
      const datado = ja && manual;
      const nome = datado ? `Relatório final ${dataNoNome()}.pdf` : 'Relatório final.pdf';
      const chave = datado ? `${CHAVE_ANEXO_RELATORIO}_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}` : CHAVE_ANEXO_RELATORIO;
      const r = await anexarNoTrello(cred, cartaoId, nome, pdf, 'application/pdf');
      if (!r.ok) { logErro('relatório final não anexou', { codigo: 'anexo' }); return; }
      await gravarRegistroTrello(card.id, { ...reg, anexados: { ...reg.anexados, [chave]: r.id } });
      resultado = datado ? 'anexado_datado' : 'anexado';
    }, TTL_TRAVA_AUTO_MS, { tentativas: 20, esperaMs: 500 });
    return resultado;
  } catch (err) { logErro('relatório final', err); return 'falhou'; }
}

/**
 * O botão "Gerar de novo" (POST .../relatorio-final): o PDF recém-gerado também vai para o cartão do Trello, se ele existir (ligação ou registro
 * do envio) e o quadro não for público. Falha aqui só vira log: o PDF gerado continua valendo.
 */
export async function anexarRelatorioManual(card: CardVendido, quem: { nome: string }, pdf: Buffer): Promise<ResultadoAnexoRelatorio> {
  try {
    const { lig } = await lerLigacao(card.id);
    const cartaoId = lig.trello_card || (await lerRegistroTrello(card.id)).card_id;
    if (!cartaoId) return 'sem_cartao';
    return await anexarPdf(card, quem, cartaoId, pdf, true);
  } catch (err) { logErro('relatório final (manual)', err); return 'falhou'; }
}

/**
 * O relatório final em PDF vai para o cartão (criado ou completado) no automático. A geração tem limite de tempo e roda FORA da trava;
 * falha ou estouro só vira log e NÃO impede o cartão nem a marca de completado.
 */
async function anexarRelatorio(card: CardVendido, quem: { nome: string; socio: boolean }, cartaoId: string): Promise<void> {
  try {
    const cred = credenciaisTrello();
    if (!cred) return;
    if (await trelloQuadroPublico(String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID)) return;
    if (await relatorioJaNoCartao(cred, card.id, cartaoId)) return;
    const ms = Number(process.env.RELATORIO_FINAL_TIMEOUT_MS) || LIMITE_RELATORIO_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const estouro = new Promise<'estourou'>((ok) => { timer = setTimeout(() => ok('estourou'), ms); });
    const gerar = gerarRelatorioFinal({ nome: quem.nome, socio: quem.socio, card }).catch((e) => { logErro('relatório final (pdf)', e); return 'erro' as const; });
    const feito = await Promise.race([gerar, estouro]).finally(() => { if (timer) clearTimeout(timer); });
    if (feito === 'estourou') { logErro('relatório final demorou demais', { codigo: 'timeout' }); return; }
    if (feito === 'erro') return;
    if (!feito) { logErro('relatório final grande demais', { codigo: 'teto' }); return; }
    await anexarPdf(card, quem, cartaoId, feito.pdf, false);
  } catch (err) { logErro('relatório final', err); }
}

/** Grava (uma vez) que o cartão já existente foi completado. Falha aqui só vira log (a próxima chamada completa de novo, sem duplicar). */
async function marcarCompletado(card: CardVendido, slots: ReadonlySet<string>, lig: { venda: string | null }): Promise<void> {
  try {
    await mudarJornada(card.id, baseDaJornada(card, slots, lig), (e) => {
      const t = e.etapas[3].trello;
      if (!t || t.completado_em) return e;
      return { ...e, etapas: { ...e.etapas, 3: { ...e.etapas[3], trello: { ...t, completado_em: new Date().toISOString() } } } };
    });
  } catch (err) { logErro('marcar completado', err); }
}

const dorme = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
/** Trava ocupada: espera isto e tenta de novo UMA vez (o que chegou depois pode ter fechado o que faltava). */
export const ESPERA_REPETIR_MS = 4_000;

export async function tentarTrelloAutomatico(
  card: CardVendido, quem: { nome: string; socio: boolean }, opcoes: { esperaMs?: number } = {},
): Promise<ResultadoTrelloAuto> {
  const r = await umaTentativa(card, quem);
  if (r.acao !== 'ocupado') return r;
  await dorme(opcoes.esperaMs ?? ESPERA_REPETIR_MS);
  return umaTentativa(card, quem);
}

async function umaTentativa(card: CardVendido, quem: { nome: string; socio: boolean }): Promise<ResultadoTrelloAuto> {
  try {
    return await comTrava(`trello-auto:${card.id}`, 'trello-auto', async (): Promise<ResultadoTrelloAuto> => {
      // Tudo é lido DEPOIS de pegar a trava: quem chegou segundo já vê o cartão do primeiro.
      const [{ lig }, { estado }, privado, { reg }, cad] = await Promise.all([
        lerLigacao(card.id), lerJornadaComVersao(card.id), lerPrivadoJornada(card.id), lerDocsComVersao('vendasolar', String(card.id)),
        lerCadastroVisto(card.id, 'vendasolar'),
      ]);
      const existe = !!estado?.etapas[3].trello || !!lig.trello_card;
      if (existe && estado?.etapas[3].trello?.completado_em) return { acao: 'ja_tem' };
      const slots = new Set(reg.arquivos.map((a) => a.slot));
      const st = estadoTrelloAuto({ lig, slots, cad, privado, estado }, !!lig.venda, { ignorarParada: true });
      if (!st.pronto) return { acao: 'nao_pronto', falta: st.falta };
      if (await obraFinalizada(card.id)) return { acao: 'nao_pronto', falta: ['Venda finalizada'] };

      const dono: DonoDoCard = { nome: quem.nome, socio: quem.socio, card, id: card.id };
      // Prévia primeiro (só lê o Trello): cartões parecidos ou candidatos = a pessoa decide pelo botão.
      const previa = await rodarFluxo(dono, { previa: true });
      const pc = previa.corpo as { parecidos?: unknown[]; candidatos?: unknown[] } | null;
      if (previa.status === 200 && (pc?.parecidos?.length || pc?.candidatos?.length)) {
        logErro('cartões parecidos', { codigo: 'parecidos' });
        await marcarParada(card, slots, lig, quem.nome);
        return { acao: 'parecidos' };
      }
      if (previa.status !== 200) { logErro('prévia recusada', { codigo: `http_${previa.status}` }); return { acao: 'falhou', status: previa.status }; }
      // Há cartão guardado (registro da obra ou ligação) mas a prévia não o acha aberto no quadro (arquivado ou apagado): NÃO cria outro.
      if (existe && !(previa.corpo as { cartao?: unknown } | null)?.cartao) {
        logErro('cartão guardado fora do quadro', { codigo: 'arquivado' });
        await marcarParada(card, slots, lig, quem.nome, 'trello_auto_arquivado');
        return { acao: 'parecidos' };
      }
      const captura = await rodarFluxo(dono, {});
      const cartaoDoFluxo = (captura.corpo as { cartao?: { id?: unknown } } | null)?.cartao?.id;
      const cartaoVivo = (captura.status === 200 || captura.status === 207) && typeof cartaoDoFluxo === 'string' && cartaoDoFluxo ? cartaoDoFluxo : null;
      // O relatório é o ÚLTIMO passo (a marca de completado já está gravada): sua demora ou falha não segura o cartão.
      if (existe && captura.status === 200 && (captura.corpo as { ok?: boolean } | null)?.ok === true) {
        await marcarCompletado(card, slots, lig);   // só com tudo certo (sem erro nem anexo pendente): senão a próxima chamada completa o resto
        if (cartaoVivo) await anexarRelatorio(card, quem, cartaoVivo);
        return { acao: 'completou' };
      }
      const cartaoId = (captura.corpo as { cartao?: { id?: unknown } } | null)?.cartao?.id;
      // 200 = tudo certo; 207 = o cartão existe, mas algum anexo ou checklist falhou (o botão refaz o que faltou).
      if ((captura.status === 200 || captura.status === 207) && typeof cartaoId === 'string' && cartaoId) {
        // Cartão recém-criado com tudo certo já nasce completo (anexos, checklist e ficha): grava a marca para não completar de novo.
        if (captura.status === 200 && (captura.corpo as { ok?: boolean } | null)?.ok === true) await marcarCompletado(card, slots, lig);
        await anexarRelatorio(card, quem, cartaoId);
        return { acao: 'criou' };
      }
      logErro('envio recusado', { codigo: `http_${captura.status}` });
      return { acao: 'falhou', status: captura.status };
    }, TTL_TRAVA_AUTO_MS, { tentativas: 1 });
  } catch (err) {
    if ((err as { codigo?: unknown } | null)?.codigo === 'ocupado') return { acao: 'ocupado' };
    logErro('falhou', err);
    return { acao: 'falhou' };
  }
}

/** Dispara em segundo plano (a Vercel mantém a função viva até acabar). Nunca lança, nunca espera. */
export function dispararTrelloAutomatico(card: CardVendido, quem: { nome: string; socio: boolean }): void {
  waitUntil(tentarTrelloAutomatico(card, quem).then(() => undefined, (err) => logErro('disparo', err)));
}
