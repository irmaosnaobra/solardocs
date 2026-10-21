// ─────────────────────────────────────────────────────────────────────────────
// A CARLA NA RODADA VIVA (B3b): decide a PEÇA da resposta (link, Pix ou imagem) e os efeitos de depois do envio.
// NADA aqui envia mensagem nem grava a posse: quem envia é o vivoEnvio (peça única na chave :2) e quem grava a posse
// é o vivo.ts, que é o ÚNICO que pode importar este arquivo (ele chama registrarPixEnviado e registrarPromessa, que
// escrevem em system_state; personas/carla.ts e posseLeitura.ts estão no grafo do ensaio e não podem alcançá-lo).
//
// A peça sai do `peca.id` que o modelo declarou, NUNCA do texto da 2ª bolha:
//   assinatura          -> link https://solardoc.app/assinar
//   avulso:<id>         -> link da rota do avulso (LINKS_CARLA)
//   pix_kiwify          -> link https://solardoc.app/pix, se a env do checkout Pix da Kiwify é uma URL https; senão
//                          a peça 'pix' (gerarPixCopiaECola de R$ 67, txid SOLARDOCVIP, o mesmo da Carla antiga);
//                          código que o vivoEnvio recusaria = Pix indisponível (nunca bolha sem peça)
//   depoimento:<slug>   -> imagem do card (até 3 por conversa, cada card 1 vez, nunca no 1º toque, o lead falou
//                          entre duas imagens; o registro vai para a posse ANTES do envio)
// Uma forma de pagamento por resposta (o contrato do vivoEnvio tem uma peça só). O mesmo link 1 vez por conversa,
// salvo se o lead pediu de novo (heurística de palavras na fala dele).
//
// Recusa do portão = { ok:false, aviso }: o vivo chama o modelo UMA vez de novo com o aviso e, na segunda, passa ao
// humano. A bolha que anuncia uma peça nunca sai sozinha por decisão daqui. Já a peça que cai DENTRO do vivoEnvio
// (teto, validação) deixa a bolha sair sozinha: isso vira `peca_pendente` na posse e um aviso no turno seguinte.
// ─────────────────────────────────────────────────────────────────────────────

import { gerarPixCopiaECola, crc16 } from '../../utils/pixBrCode';
import { pixCheckoutUrl } from '../../utils/pixInfo';
import { registrarPixEnviado } from '../agents/whatsapp/pixSolicitado';
import { registrarPromessa } from './planilhaBonus';
import { CARDS_CARLA, LINKS_CARLA } from './personas/carla';
import { MAX_DEPOIMENTOS_POR_CONVERSA } from './conhecimento/depoimentos';
import { estadoDaConversa, semAcento } from './trava';
import type { DadosPosse } from './posse';
import type { MsgConversa, SaidaAgente } from './tipos';
import type { PecaEnvio, ResultadoEnvio } from './vivoEnvio';

/** Um número só para o limite de imagens: o mesmo que a trava e a persona usam (conhecimento/depoimentos.ts). */
export const MAX_IMAGENS_POR_CONVERSA = MAX_DEPOIMENTOS_POR_CONVERSA;
export const VALOR_PIX = 67;
export const TXID_PIX = 'SOLARDOCVIP';
const BASE_DEPOIMENTOS = 'https://solardoc.app/depoimentos/';
/** Pendência de peça que caiu: vale por 6 h. */
export const VALIDADE_PENDENCIA_MS = 6 * 3_600_000;

export type ModoPix = 'link' | 'codigo' | 'indisponivel';

/** A mesma regra do vivoEnvio para a peça pix (BR Code inteiro, ASCII imprimível, CRC certo). Mantenha as duas iguais. */
const RE_PIX = /^000201[ -~]+6304[0-9A-F]{4}$/;
export const pixValido = (c: string): boolean => RE_PIX.test(c) && crc16(c.slice(0, -4)) === c.slice(-4);

const gerarCodigo = (): string => gerarPixCopiaECola({ valor: VALOR_PIX, txid: TXID_PIX });

/** Qual Pix sai agora: o link da Kiwify (env https), o copia e cola válido, ou nenhum. */
export function modoPix(): ModoPix {
  if (/^https:\/\/[^\s]+$/i.test(pixCheckoutUrl())) return 'link';
  try { return pixValido(gerarCodigo()) ? 'codigo' : 'indisponivel'; } catch { return 'indisponivel'; }
}

// Só pedido EXPLÍCITO de reenvio: ordem no imperativo ("manda o link", "reenvia", "manda de novo"), "não chegou/recebi",
// "cadê o link/pix". "Vou mandar pro meu sócio" (infinitivo, sem o objeto) não casa. É heurística de palavras.
const PEDIU_DE_NOVO_REGRAS: readonly RegExp[] = [
  /\b(?:manda|mande|envia|envie|reenvia|reenvie)\b[^.!?]{0,25}\b(?:de novo|novamente|outra vez|(?:o |um |esse |este )?link|(?:o )?pix|(?:o )?codigo)\b/,
  /\b(?:reenvia|reenvie|reenviar)\b/,
  /\b(?:link|pix|codigo)\b[^.!?]{0,20}\b(?:de novo|novamente|outra vez)\b/,
  /\bnao (?:me )?(?:chegou|recebi|apareceu)\b/,
  /\bcade (?:o |a )?(?:link|pix|codigo)\b/,
];
export const pediuDeNovo = (textos: readonly string[]): boolean => textos.some(t => {
  const x = semAcento(t);
  return PEDIU_DE_NOVO_REGRAS.some(re => re.test(x));
});

export interface PendenciaDePeca { tipo: string; ref: string; em: string }

const lerPendencia = (posse: DadosPosse): PendenciaDePeca | null => {
  const p = posse.peca_pendente as Partial<PendenciaDePeca> | null | undefined;
  return p && typeof p === 'object' && typeof p.ref === 'string' && typeof p.em === 'string' ? { tipo: String(p.tipo ?? ''), ref: p.ref, em: p.em } : null;
};

const idDoModelo = (ref: string): string => (ref === 'pix' ? 'pix_kiwify' : ref);

/** Avisos do sistema que entram nos fatos da Carla em TODO turno (a persona imprime ctx.avisosDoSistema). */
export function avisosDaCarla(posse: DadosPosse, agora: Date = new Date()): string[] {
  const out: string[] = [];
  const modo = modoPix();
  if (modo === 'link') out.push('AVISO DO SISTEMA, Pix: ao pedir a peça pix_kiwify o sistema manda o link do Pix pela Kiwify. Na bolha 1 diga que o acesso abre sozinho quando o banco confirmar.');
  else if (modo === 'codigo') out.push('AVISO DO SISTEMA, Pix: ao pedir a peça pix_kiwify o sistema manda o código Pix copia e cola na mensagem de baixo. Na bolha 1 diga que o código vem abaixo e que, depois de pagar, ele manda aqui a foto do comprovante e o e-mail que usa no SolarDoc. Nunca diga que liberou.');
  else out.push('AVISO DO SISTEMA, Pix: o Pix NÃO está disponível agora. Não ofereça Pix nem use pix_kiwify; ofereça o cartão pelo link da assinatura.');
  if (posse.links.length) out.push(`AVISO DO SISTEMA: links que já saíram nesta conversa: ${posse.links.join(', ')}. Não mande o mesmo de novo, a não ser que ele peça.`);
  if (posse.planilha_prometida === true) out.push('AVISO DO SISTEMA: a promessa da planilha de eletroposto já foi feita nesta conversa. Não repita e não use prometer_planilha.');
  const pend = lerPendencia(posse);
  if (pend) {
    const idade = agora.getTime() - Date.parse(pend.em);
    if (Number.isFinite(idade) && idade >= 0 && idade <= VALIDADE_PENDENCIA_MS) {
      out.push(`AVISO DO SISTEMA: a peça ${idDoModelo(pend.ref)} da sua resposta anterior NÃO saiu (só a sua bolha chegou). Ela pode ser mandada agora: se faz sentido, peça-a de novo (peca ${idDoModelo(pend.ref)}).`);
    }
  }
  return out;
}

export interface PlanoCarla {
  ok: true;
  peca?: PecaEnvio;
  /** Vai para a posse ANTES do envio (o registro da imagem). */
  antes?: Partial<DadosPosse>;
  /** Depois do envio (com o resultado, ok ou recusa): efeitos de pagamento/promessa e o patch final da posse. Nunca lança. */
  depois: (res: ResultadoEnvio, a: { tel: string; nome: string | null; agora: Date }) => Promise<Partial<DadosPosse>>;
}
export interface RecusaCarla { ok: false; motivo: string; aviso: string }

const recusa = (motivo: string, aviso: string): RecusaCarla => ({ ok: false, motivo, aviso: `AVISO DO SISTEMA: ${aviso} Reescreva a resposta sem essa peça (peca nula, uma bolha só) e siga a conversa; use a ação continuar.` });

export interface PedidoPlano {
  saida: SaidaAgente;
  posse: DadosPosse;
  msgs: readonly MsgConversa[];
  /** A fala do lead que está sendo respondida. */
  fala: { id: number };
  /** Os textos do bloco de falas do lead. */
  textosDoLead: readonly string[];
}

const semEfeito: PlanoCarla['depois'] = async () => ({});

export function planejarCarla(p: PedidoPlano): PlanoCarla | RecusaCarla {
  const { saida, posse } = p;
  const bolha = String(saida.bolhas[0] ?? '');

  // Promessa da planilha: é fala comum com a promessa dentro; registra depois que a bolha saiu.
  if (saida.acao === 'prometer_planilha') {
    if (saida.peca) return recusa('promessa_com_peca', 'a promessa da planilha não leva peça junto.');
    if (!/\bplanilha\b/.test(semAcento(bolha))) return recusa('promessa_sem_planilha', 'a bolha de prometer_planilha precisa dizer a promessa da planilha de eletroposto.');
    if (posse.planilha_prometida === true) return recusa('promessa_repetida', 'a promessa da planilha já foi feita nesta conversa.');
    return {
      ok: true,
      depois: async (res, a) => {
        if (!res.ok) return {};
        try { await registrarPromessa(a.tel, a.agora); } catch { /* registrarPromessa nunca lança; o envio já saiu */ }
        return { planilha_prometida: true };
      },
    };
  }

  const peca = saida.peca;
  if (!peca) return { ok: true, depois: semEfeito };
  const id = String(peca.id ?? '');

  const comLinks = (key: string): Partial<DadosPosse> => ({ links: [...new Set([...posse.links, key])] });
  const pend = lerPendencia(posse);

  // ── link (assinatura e avulsos) ─────────────────────────────────────────────
  const linkDe = (url: string, ref: string): PlanoCarla | RecusaCarla => {
    if (posse.links.includes(url) && !pediuDeNovo(p.textosDoLead)) {
      return recusa('link_repetido', `o link ${url} já foi enviado nesta conversa e ele não pediu de novo.`);
    }
    return {
      ok: true,
      peca: { tipo: 'link', texto: url },
      depois: async (res, a) => {
        if (!res.ok) return {};
        if (res.pecaCaiu) return { peca_pendente: { tipo: 'link', ref, em: a.agora.toISOString() } };
        if (res.enviadas === 2) return { ...comLinks(url), ...(pend?.ref === ref ? { peca_pendente: null } : {}) };
        return {};
      },
    };
  };

  if (id === 'assinatura' && peca.tipo === 'link') return linkDe(LINKS_CARLA.assinatura!, 'assinatura');
  if (id.startsWith('avulso:') && peca.tipo === 'link') {
    const url = LINKS_CARLA[id];
    return url ? linkDe(url, id) : recusa('avulso_desconhecido', `o produto avulso "${id.slice(0, 40)}" não existe.`);
  }

  // ── Pix ─────────────────────────────────────────────────────────────────────
  if (id === 'pix_kiwify' && (peca.tipo === 'link' || peca.tipo === 'pix')) {
    const modo = modoPix();
    if (modo === 'link') return linkDe(LINKS_CARLA.pix_kiwify!, 'pix');
    if (modo === 'indisponivel') return recusa('pix_indisponivel', 'o Pix não está disponível agora.');
    if (posse.links.includes(`pix:${VALOR_PIX}`) && !pediuDeNovo(p.textosDoLead)) {
      return recusa('pix_repetido', 'o código Pix já foi enviado nesta conversa e ele não pediu de novo.');
    }
    const codigo = gerarCodigo();
    return {
      ok: true,
      peca: { tipo: 'pix', texto: codigo },
      depois: async (res, a) => {
        if (!res.ok) return {};
        if (res.pecaCaiu) return { peca_pendente: { tipo: 'pix', ref: 'pix', em: a.agora.toISOString() } };
        if (res.enviadas !== 2) return {};
        // Só com as duas mensagens enviadas: o registro é o que faz a foto do comprovante liberar o acesso.
        try { await registrarPixEnviado(a.tel, VALOR_PIX, a.nome); } catch { /* o erro é logado lá; o envio já saiu */ }
        return { ...comLinks(`pix:${VALOR_PIX}`), ...(pend?.ref === 'pix' ? { peca_pendente: null } : {}) };
      },
    };
  }

  // ── depoimento (imagem) ─────────────────────────────────────────────────────
  if (id.startsWith('depoimento:') && peca.tipo === 'imagem') {
    const slug = id.slice('depoimento:'.length);
    const card = CARDS_CARLA.find(d => d.slug === slug);
    if (!card?.cardArquivo) return recusa('card_desconhecido', `o depoimento "${slug.slice(0, 60)}" não existe.`);
    const est = estadoDaConversa([...p.msgs]);
    if (posse.respostas === 0 || est.falasNossas === 0) return recusa('imagem_no_primeiro_toque', 'imagem nunca vai na primeira resposta.');
    if (posse.imagens.length >= MAX_IMAGENS_POR_CONVERSA) return recusa('imagens_demais', `já foram ${MAX_IMAGENS_POR_CONVERSA} depoimentos nesta conversa.`);
    if (posse.imagens.includes(slug)) return recusa('card_repetido', 'esse depoimento já foi enviado a esta pessoa.');
    const ultima = Number(posse.imagem_wa_id);
    if ((Number.isFinite(ultima) && ultima >= p.fala.id) || !est.leadFalouDepoisDaImagem) {
      return recusa('lead_nao_falou_entre_imagens', 'ele ainda não falou desde a última imagem.');
    }
    if (est.jaMandamosLink) return recusa('imagem_depois_do_link', 'imagem não pode vir depois que o link saiu.');
    const anterior = { imagens: [...posse.imagens], imagem_wa_id: Number.isFinite(ultima) ? ultima : 0 };
    return {
      ok: true,
      peca: { tipo: 'imagem', url: `${BASE_DEPOIMENTOS}${card.cardArquivo}`, slug },
      antes: { imagens: [...posse.imagens, slug], imagem_wa_id: p.fala.id },
      depois: async (res, a) => {
        // Nada saiu (a peça caiu, ou a resposta foi recusada antes do envio): o card volta a estar livre. erro_linha é
        // incerto (pode ter saído) e o registro fica.
        const nadaSaiu = res.ok ? !!res.pecaCaiu : res.motivo !== 'erro_linha';
        if (!nadaSaiu) return pend?.ref === id && res.ok && res.enviadas === 2 ? { peca_pendente: null } : {};
        return { ...anterior, ...(res.ok ? { peca_pendente: { tipo: 'imagem', ref: id, em: a.agora.toISOString() } } : {}) };
      },
    };
  }

  return recusa('peca_desconhecida', `a peça "${id.slice(0, 60)}" (${String(peca.tipo)}) não existe ou não combina com o tipo.`);
}
