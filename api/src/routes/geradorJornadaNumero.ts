import { Response } from 'express';
import { leituraAtualDaPlanilha, leituraDaPlanilhaDoCache } from './geradorClientes';
import { credenciaisTrello } from '../services/gerador/dossieVenda';
import { TRELLO_BOARD_ID } from '../services/insightsService';
import { alocarCodigoSolar, type DepsAlocador, type MesmoTelefone, type MotivoErroAlocador } from '../services/gerador/vendaSolarCodigo';
import { lerLigacao, type Ligacao } from '../services/gerador/vendaSolarHub';
import { lerDocsComVersao } from '../services/gerador/docsClienteBanco';
import { lerJornadaComVersao, mudarJornada, ehRecusa } from '../services/gerador/jornadaSolarBanco';
import { deduzirEtapa, estadoMaterializado, type AcaoHistorico, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { ehAdm, nomeSimples } from '../services/gerador/solarObras';
import { MSG_FINALIZADA, obraFinalizada } from '../services/gerador/jornadaCorte';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// O NÚMERO DA OBRA NA ASSINATURA (Jornada, fase 1, 05/11/2026, SPEC 13). O `#NNNN` nasce no servidor quando o card tem o contrato
// assinado E a procuração assinada anexados (etapa 2). Quem chama: o registro do arquivo (`POST /clientes/vendasolar/:card/docs`),
// o "Concluir etapa 2", o botão "Tentar o número de novo" e o `POST /vendas-solares/:card/cliente`.
//
// IMPORTANTE (ciclo de boot em CommonJS): este arquivo NÃO importa `geradorClientesDocs`, `geradorVendaSolarCliente` nem
// `geradorVendaSolarTrello` (os três importam este). As dependências do alocador são montadas aqui, iguais às de lá.
// Nenhuma mensagem sai daqui: só estado e número. Nada de valor pessoal em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────

export const MSG_ASSINATURA = 'O número da obra nasce com o contrato e a procuração assinados. Anexe os dois na etapa 2 da obra, em Solar, Clientes.';
export const MSG_CANCELADA = 'Venda cancelada não ganha número.';
export const MSG_CONFIRMAR_NUMERO = 'Esta venda pode já estar na planilha. O administrador decide: ligar a venda antiga ou criar o número novo.';

const logErro = (que: string, codigo: string): void => console.error(`[jornada-numero] ${que}`, codigo);

/** As mesmas dependências do `dependenciasDoAlocador()` (sem cache) de `geradorVendaSolarCliente.ts`. */
function depsDoAlocador(): DepsAlocador {
  return {
    credenciais: credenciaisTrello(),
    board: String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID,
    lerPlanilhaAtual: leituraAtualDaPlanilha,
    lerPlanilhaCopia: leituraDaPlanilhaDoCache,
  };
}

export type ResultadoNumero =
  | { ok: true; codigo: string; acao: 'ja_ligada' | 'criou' | 'adotou_trello'; aviso?: string; mesmoTelefone?: MesmoTelefone; planilhaFora?: true }
  | { ok: false; motivo: 'assinatura' | 'cancelada' | 'confirmar' | 'finalizada'; candidatos?: unknown[]; ocultas?: number; semPlanilha?: true }
  | { ok: false; motivo: MotivoErroAlocador };

/**
 * O `base()` do `mudarJornada` (SPEC 3.6): o estado de uma obra que ainda não tinha, deduzido do que existe hoje. Sem trilho cai na
 * etapa 2 (ela já tem número). A rota de leitura nunca materializa; a primeira ESCRITA que precisa de estado, sim.
 */
export function baseDaJornada(
  card: CardVendido, slots: ReadonlySet<string>, lig: Pick<Ligacao, 'venda'>, planilhaEtapa?: string, planilhaFora?: boolean,
): () => EstadoJornada {
  return () => {
    const d = deduzirEtapa({ temNumero: !!lig.venda, slots, planilha: planilhaEtapa, planilhaFora });
    return estadoMaterializado(card.id, nomeSimples(card.vendedor_nome), d.etapa ?? 2, new Date().toISOString());
  };
}

const comHistorico = (e: EstadoJornada, por: string, acao: AcaoHistorico, etapa: number | null, agora: string): EstadoJornada =>
  ({ ...e, historico: [...e.historico, { em: agora, por: nomeSimples(por), acao, etapa }].slice(-50) });

/** Grava o resultado da tentativa no estado. Falha aqui nunca derruba a resposta. */
async function registrar(card: CardVendido, slots: ReadonlySet<string>, por: string, r: { ok: true } | { ok: false; falha: string }): Promise<void> {
  const agora = new Date().toISOString();
  await mudarJornada(card.id, baseDaJornada(card, slots, { venda: null }), (e) => {
    if (r.ok) {
      return comHistorico({ ...e, numero: { tentado_em: agora, falha: null, nasceu_em: agora } }, por, 'numero', 2, agora);
    }
    return comHistorico({ ...e, numero: { tentado_em: agora, falha: r.falha as EstadoJornada['numero']['falha'], nasceu_em: e.numero.nasceu_em } }, por, 'numero_falhou', 2, agora);
  });
}

export async function tentarNumeroDaJornada(
  card: CardVendido, quem: { nome: string; socio: boolean }, inicio: number, op: { novo?: boolean },
): Promise<ResultadoNumero> {
  // 1. Já tem número: nada a fazer.
  const { lig } = await lerLigacao(card.id);
  if (lig.venda) return { ok: true, codigo: lig.venda, acao: 'ja_ligada' };
  // 1b. Venda finalizada não aloca número (continua com "*"): antes de qualquer leitura do Trello e de qualquer escrita de estado.
  if (await obraFinalizada(card.id)) return { ok: false, motivo: 'finalizada' };
  // 2. Venda cancelada nunca gasta número: conferida ANTES de tudo.
  const { estado } = await lerJornadaComVersao(card.id);
  if (estado?.cancelada) return { ok: false, motivo: 'cancelada' };
  // 3. O par de papéis assinados.
  const { reg } = await lerDocsComVersao('vendasolar', String(card.id));
  const slots = new Set(reg.arquivos.map((a) => a.slot));
  if (!(slots.has('contrato_assinado') && slots.has('procuracao'))) return { ok: false, motivo: 'assinatura' };
  // 4. Venda nascida no servidor numera como nova; venda antiga passa pelo portão de telefone. `novo` de quem não é ADM vira false.
  const novo = estado?.origem === 'vendido' || (op.novo === true && ehAdm(quem.nome));
  // 5. O alocador de sempre.
  const r = await alocarCodigoSolar({ card, quem, novo, inicio }, depsDoAlocador());
  // 6. O resultado no estado, sem deixar a falha disso derrubar a resposta.
  try {
    await registrar(card, slots, quem.nome, r.ok ? { ok: true } : { ok: false, falha: r.motivo });
  } catch (e) { logErro('registrar', String((e as { codigo?: unknown } | null)?.codigo ?? 'interno')); }
  // 7. Cancelada no meio da alocação: o número fica com ela (SPEC 14, caso raro). Só registra no log.
  if (r.ok) {
    try {
      if ((await lerJornadaComVersao(card.id)).estado?.cancelada) logErro('alocacao', 'cancelada_no_meio');
    } catch { /* sem a releitura, nada a registrar */ }
  }
  // 8. Traduz.
  if (r.ok) return { ok: true, codigo: r.codigo, acao: r.acao, ...(r.aviso ? { aviso: r.aviso } : {}), ...(r.mesmoTelefone ? { mesmoTelefone: r.mesmoTelefone } : {}), ...(r.planilhaFora ? { planilhaFora: true as const } : {}) };
  if (r.motivo === 'confirmar') return { ok: false, motivo: 'confirmar', candidatos: r.candidatos, ocultas: r.ocultas, ...(r.semPlanilha ? { semPlanilha: true as const } : {}) };
  return { ok: false, motivo: r.motivo };
}

/** O link do cartão do Trello fica na etapa 3 da obra (o primeiro `criado_em` fica). Só aceita a URL do formato do quadro. */
export async function guardarTrelloNaJornada(cardId: number, url: string, nome: string, card: CardVendido): Promise<void> {
  const m = /^https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}(?:\/.*)?$/.exec(url.trim());
  if (!m) return;
  if (await obraFinalizada(cardId)) return;   // venda finalizada: nenhum estado novo, nem do Trello
  const limpa = url.trim().replace(/^(https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}).*$/, '$1');
  const { reg } = await lerDocsComVersao('vendasolar', String(cardId));
  const slots = new Set(reg.arquivos.map((a) => a.slot));
  const { lig } = await lerLigacao(cardId);
  const agora = new Date().toISOString();
  const r = await mudarJornada(cardId, baseDaJornada(card, slots, lig), (e) => {
    const t = e.etapas[3].trello;
    if (t && t.url === limpa) return e;
    return comHistorico({ ...e, etapas: { ...e.etapas, 3: { ...e.etapas[3], trello: { url: limpa, criado_em: t?.criado_em ?? agora, por: nomeSimples(t?.por || nome) } } } }, nome, 'trello', 3, agora);
  });
  if (ehRecusa(r)) logErro('trello', r.recusa);
}

/** O 409 de cada motivo, igual em todas as rotas que chamam. `adm` decide se os candidatos saem. */
export function responderNumero409(res: Response, r: Extract<ResultadoNumero, { ok: false }>, adm: boolean): boolean {
  if (r.motivo === 'assinatura') { res.status(409).json({ ok: false, precisa: 'assinatura', error: MSG_ASSINATURA }); return true; }
  if (r.motivo === 'cancelada') { res.status(409).json({ ok: false, precisa: 'cancelada', error: MSG_CANCELADA }); return true; }
  if (r.motivo === 'finalizada') { res.status(409).json({ ok: false, precisa: 'finalizada', error: MSG_FINALIZADA }); return true; }
  if (r.motivo === 'confirmar') {
    res.status(409).json({
      ok: false, precisa: 'confirmar', error: MSG_CONFIRMAR_NUMERO,
      ...(adm ? { candidatos: r.candidatos ?? [] } : {}), ocultas: r.ocultas ?? 0, ...(r.semPlanilha ? { semPlanilha: true } : {}),
    });
    return true;
  }
  return false;
}
