// ─────────────────────────────────────────────────────────────────────────────
// A CARLA NA RODADA VIVA (B3b): decide a PEÇA da resposta (link, Pix ou imagem) e os efeitos de depois do envio.
// NADA aqui envia mensagem nem grava a posse: quem envia é o vivoEnvio (peça única na chave :2) e quem grava a posse
// é o vivo.ts, que é o ÚNICO que pode importar este arquivo (ele chama registrarPromessa, que
// escrevem em system_state; personas/carla.ts e posseLeitura.ts estão no grafo do ensaio e não podem alcançá-lo).
//
// A peça sai do `peca.id` que o modelo declarou, NUNCA do texto da 2ª bolha:
//   assinatura          -> link https://solardoc.app/assinar
//   avulso:<id>         -> link da rota do avulso (LINKS_CARLA)
//   pix_automatico      -> link https://solardoc.app/?pagar=pix, o Pix AUTOMÁTICO do Asaas (cobra na conta da pessoa; regra do dono
//                          de 03/11/2026). Nunca Pix avulso, nunca código copia e cola, nunca e-mail na URL.
//   depoimento:<slug>   -> imagem do card (até 3 por conversa, cada card 1 vez, nunca no 1º toque, o lead falou
//                          entre duas imagens; o registro vai para a posse ANTES do envio)
// Uma forma de pagamento por resposta (o contrato do vivoEnvio tem uma peça só). O mesmo link 1 vez por conversa,
// salvo se o lead pediu de novo (heurística de palavras na fala dele).
//
// Recusa do portão = { ok:false, aviso }: o vivo chama o modelo UMA vez de novo com o aviso e, na segunda, passa ao
// humano. A bolha que anuncia uma peça nunca sai sozinha por decisão daqui. Já a peça que cai DENTRO do vivoEnvio
// (teto, validação) deixa a bolha sair sozinha: isso vira `peca_pendente` na posse e um aviso no turno seguinte.
// ─────────────────────────────────────────────────────────────────────────────

import { registrarPromessa } from './planilhaBonus';
import { CARDS_CARLA, LINKS_CARLA } from './personas/carla';
import { MAX_DEPOIMENTOS_POR_CONVERSA } from './conhecimento/depoimentos';
import { estadoDaConversa, semAcento } from './trava';
import { ehPosseDaRetomada, type DadosPosse } from './posse';
import type { MsgConversa, SaidaAgente } from './tipos';
import type { PecaEnvio, ResultadoEnvio } from './vivoEnvio';

/** Um número só para o limite de imagens: o mesmo que a trava e a persona usam (conhecimento/depoimentos.ts). */
export const MAX_IMAGENS_POR_CONVERSA = MAX_DEPOIMENTOS_POR_CONVERSA;
const BASE_DEPOIMENTOS = 'https://solardoc.app/depoimentos/';
/** Pendência de peça que caiu: vale por 6 h. */
export const VALIDADE_PENDENCIA_MS = 6 * 3_600_000;

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

const idDoModelo = (ref: string): string => (ref === 'pix' ? 'pix_automatico' : ref);

/** Avisos do sistema que entram nos fatos da Carla em TODO turno (a persona imprime ctx.avisosDoSistema). */
export function avisosDaCarla(posse: DadosPosse, agora: Date = new Date()): string[] {
  const out: string[] = [];
  // O Pix é sempre o automático do Asaas (03/11/2026): um aviso só, sem modo. Na retomada, o e-mail (com o meio coberto) vem nos fatos da conta.
  if (ehPosseDaRetomada(posse)) out.push('AVISO DO SISTEMA, Pix: ao pedir a peça pix_automatico o sistema manda o link do Pix automático (https://solardoc.app/?pagar=pix), que cobra na conta dele. Esta pessoa já tem conta: na bolha 1 diga para usar na página o mesmo e-mail da conta (os fatos trazem o e-mail com o meio coberto) e que o acesso volta sozinho na conta dela quando o banco confirmar. Nunca diga que liberou.');
  else out.push('AVISO DO SISTEMA, Pix: ao pedir a peça pix_automatico o sistema manda o link do Pix automático (https://solardoc.app/?pagar=pix), que cobra na conta da pessoa todo mês e pede e-mail e CPF ou CNPJ. Na bolha 1 diga que o acesso abre sozinho quando o banco confirmar. Nunca diga que liberou.');
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
  // A RETOMADA dos usuários (03/11/2026): quem já tem conta. Cartão só por dentro do app (peça entrar_no_app); Pix pelo link do Pix automático (pix_automatico).
  // Nenhum aviso de recusa leva a palavra que a trava barra em toda bolha (D33).
  const daRet = ehPosseDaRetomada(posse);

  // Promessa da planilha: é fala comum com a promessa dentro; registra depois que a bolha saiu.
  if (saida.acao === 'prometer_planilha') {
    // A promessa da planilha é a única alavanca de "hoje", e a retomada não tem urgência (quem já tem conta, sem prazo).
    if (daRet) return recusa('planilha_na_retomada', 'a promessa da planilha não vale nesta conversa (quem já tem conta, sem urgência).');
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

  if (id === 'assinatura' && peca.tipo === 'link') {
    // O link de assinatura abre o checkout público, que cria outra conta e outra cobrança para quem já tem conta.
    if (daRet) return recusa('assinatura_com_conta', 'esta pessoa já tem conta: o link de assinatura cria outra conta e outra cobrança. No cartão, use a peça entrar_no_app e diga para entrar no app e tocar em Fazer Upgrade. No Pix, siga o aviso do Pix desta conversa.');
    return linkDe(LINKS_CARLA.assinatura!, 'assinatura');
  }
  // Entrar no app: o login da conta que já existe. Só na retomada.
  if (id === 'entrar_no_app' && peca.tipo === 'link') {
    if (!daRet) return recusa('entrar_sem_conta', 'o link de entrar no app é só para quem já tem conta.');
    // Ex-assinante: o Customer antigo da Stripe tem a assinatura cancelada, o Fazer Upgrade abre um checkout novo e a Stripe cria outro
    // Customer para quem já tem conta. Até o create-checkout reusar o Customer, esse grupo só tem o Pix automático.
    if ((posse.retomada as { segmento?: unknown } | null | undefined)?.segmento === 'ex_assinante') {
      return recusa('entrar_ex_assinante', 'nesta conta o cartão pelo app abre outra cobrança. Ofereça só o Pix automático (peça pix_automatico) e siga o aviso do Pix desta conversa.');
    }
    return linkDe(LINKS_CARLA.entrar_no_app!, 'entrar_no_app');
  }
  if (id.startsWith('avulso:') && peca.tipo === 'link') {
    const url = LINKS_CARLA[id];
    return url ? linkDe(url, id) : recusa('avulso_desconhecido', `o produto avulso "${id.slice(0, 40)}" não existe.`);
  }

  // ── Pix ─────────────────────────────────────────────────────────────────────
  if (id === 'pix_automatico' && peca.tipo === 'link') return linkDe(LINKS_CARLA.pix_automatico!, 'pix_automatico');

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
