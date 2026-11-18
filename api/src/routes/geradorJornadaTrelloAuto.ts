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
      if (existe && captura.status === 200 && (captura.corpo as { ok?: boolean } | null)?.ok === true) {
        await marcarCompletado(card, slots, lig);   // só com tudo certo (sem erro nem anexo pendente): senão a próxima chamada completa o resto
        return { acao: 'completou' };
      }
      const cartaoId = (captura.corpo as { cartao?: { id?: unknown } } | null)?.cartao?.id;
      // 200 = tudo certo; 207 = o cartão existe, mas algum anexo ou checklist falhou (o botão refaz o que faltou).
      if ((captura.status === 200 || captura.status === 207) && typeof cartaoId === 'string' && cartaoId) {
        // Cartão recém-criado com tudo certo já nasce completo (anexos, checklist e ficha): grava a marca para não completar de novo.
        if (captura.status === 200 && (captura.corpo as { ok?: boolean } | null)?.ok === true) await marcarCompletado(card, slots, lig);
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
