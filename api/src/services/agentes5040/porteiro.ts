// ─────────────────────────────────────────────────────────────────────────────
// PORTEIRO DA LINHA 5040. PURO: recebe fatos já lidos e decide quem responde.
// No ensaio ele só decide e registra; não muda quem responde hoje.
//
// Ordem (spec seção 3):
//   1. humano na conversa, não incomodar, bloqueado ou mudo: ninguém;
//   2. a conversa já tem dona (posse viva): ela;
//      sem dona e com outro robô antigo na conversa: ninguém (o antigo termina);
//   3. já é cliente do SolarDoc: Giovanna robô do suporte (fora das três);
//   4. anúncio de clique para WhatsApp (ID do anúncio > campanha > produto);
//   5. texto pronto de botão das nossas páginas;
//   6. cadastro ou card recente com o telefone (created_by / form_id);
//   7. nada disso: UMA pergunta só.
// Na dúvida ninguém chuta. Falha de leitura = ninguém responde. Nunca lança.
// ─────────────────────────────────────────────────────────────────────────────

import { chaveDaLinha, type LinhaWa, type MapaLid } from '../gerador/caixaWhatsapp';
import { PERSONA_DO_PRODUTO, type Dona, type FatosPorteiro, type LeadMetaResumo, type Produto } from './tipos';
import { ehGatilhoSolarDoc } from '../agents/whatsapp/gatilhoSolarDoc';

export const PERGUNTA_DO_PORTEIRO = 'Você quer saber de energia solar, de eletroposto ou do SolarDoc?';

export type PassoPorteiro = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface DecisaoPorteiro {
  dona: Dona | null;
  passo: PassoPorteiro | 'falha';
  motivo: string;
  /** Só no passo 7: a pergunta que a recepção faz. */
  pergunta?: string;
}

const semAcento = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Minúsculo, sem acento, sem pontuação das pontas e com espaço único: casa o texto do botão decodificado. */
function normalizarBotao(texto: string | null | undefined): string {
  return semAcento(texto).replace(/\s+/g, ' ').replace(/^[\s!.,;:?-]+|[\s!.,;:?-]+$/g, '').trim();
}

// Textos prontos das nossas páginas (wa.me/5534998165040?text=...). Prefixos normalizados.
// Texto fora desta lista devolve null: o botão "Comprei o Kit... preciso do acesso" é de quem já
// comprou (suporte) e "minha proposta expirou" serve aos dois lados do gerador, então ficam de fora.
const BOTOES_BRUTOS: ReadonlyArray<{ prefixo: string; produto: Produto }> = [
  { prefixo: 'ola! quero simular meu projeto de energia solar', produto: 'solar' },
  { prefixo: 'oi! acabei de preencher a simulacao de energia solar', produto: 'solar' },
  { prefixo: 'quero entrar no grupo do eletroposto', produto: 'eletroposto' },
  { prefixo: 'ja tenho carregador instalado e quero conectar a plataforma da nexus', produto: 'eletroposto' },
  { prefixo: 'quero o kit de fechamento do integrador', produto: 'solardoc' },
];
const BOTOES = BOTOES_BRUTOS.map(b => ({ ...b, prefixo: normalizarBotao(b.prefixo) }));

const BOTOES_POR_TRECHO: ReadonlyArray<{ trecho: string; produto: Produto }> = [
  // A página da NEXUS monta "Olá, <consultor>. Sou <nome>, de <cidade>. Vim pelo site da NEXUS ELETROPOSTOS ...".
  { trecho: 'vim pelo site da nexus eletropostos', produto: 'eletroposto' },
  { trecho: 'quero entrar no grupo do eletroposto', produto: 'eletroposto' },
];

/** Produto que o texto pronto de um botão das nossas páginas indica, ou null. */
export function produtoDoBotao(texto: string | null | undefined): Produto | null {
  const t = normalizarBotao(texto);
  if (!t) return null;
  // Texto pronto do anúncio Solar da Meta e as variações dele (com ou sem saudação, acento ou pontuação).
  if (/^((oi|ola)[\s!.,;:]*)?tenho interesse em energia solar\b/.test(t)) return 'solar';
  for (const b of BOTOES) if (t.startsWith(b.prefixo)) return b.produto;
  for (const b of BOTOES_POR_TRECHO) if (t.includes(b.trecho)) return b.produto;
  // O pedido de informação sobre o SolarDoc (a frase do anúncio, "Quero saber sobre a SolarDoc", e as variações) é
  // o MESMO gatilho da Carla antiga: assim a porta decide igual nos três caminhos (webhook, fila e poll) e a Carla
  // nova assume antes da antiga abrir a sessão pela fila, onde o anúncio não chega.
  if (ehGatilhoSolarDoc(String(texto ?? ''))) return 'solardoc';
  return null;
}

/**
 * Origem de um lead de `leads_meta`, na linguagem do porteiro. O quiz do SolarDoc (form_id 'quiz_solardoc', lead_id
 * 'sdquiz_...') é SolarDoc: vai para a Carla, não para a Duda (solar). O 'quiz_' do quiz solar segue 'quiz'.
 */
export function origemDoLeadMeta(lead: Pick<LeadMetaResumo, 'lead_id' | 'form_id'>): string {
  if (lead.form_id === 'quiz_solardoc' || String(lead.lead_id ?? '').startsWith('sdquiz_')) return 'quiz_solardoc';
  return String(lead.lead_id ?? '').startsWith('quiz_') ? 'quiz' : 'lead-meta';
}

/** Produto de um created_by de card ou form_id de cadastro. Desconhecido = null (ninguém chuta). */
export function produtoDaOrigem(origem: string | null | undefined): Produto | null {
  const o = semAcento(origem).trim();
  if (!o) return null;
  if (['lp_eletroposto', 'cadastro_eletroposto', 'manychat_eletroposto', 'agente_eletroposto'].includes(o)) return 'eletroposto';
  if (['lead-meta', 'lp_solar', 'quiz'].includes(o)) return 'solar';
  // Quiz do SolarDoc (/diagnostico, 24/10/2026): quem deixou o WhatsApp lá e escreve na 5040 é da Carla.
  if (o === 'quiz_solardoc') return 'solardoc';
  return null;
}

/**
 * Decide quem responde. Nunca lança: qualquer exceção vira { dona: null, passo: 'falha' }.
 */
export function decidirDona(f: FatosPorteiro): DecisaoPorteiro {
  try {
    if (!f || f.leituraOk !== true) return { dona: null, passo: 'falha', motivo: 'leitura falhou ou incompleta: ninguém responde' };

    // 1. ninguém
    if (f.humanoNaConversa) return { dona: null, passo: 1, motivo: 'humano na conversa' };
    if (f.naoIncomodar) return { dona: null, passo: 1, motivo: 'pediu para não ser incomodado' };
    if (f.bloqueado) return { dona: null, passo: 1, motivo: 'contato bloqueado' };
    if (f.mudo) return { dona: null, passo: 1, motivo: 'contato mudo' };

    // 2. já tem dona (posse viva). Vem ANTES do robô antigo: se a nova já é dona e aparece sessão
    // antiga, o antigo cede à posse; calar a nova aqui deixaria ninguém respondendo.
    if (f.donaAtual) return { dona: f.donaAtual, passo: 2, motivo: `a conversa já é da ${f.donaAtual}` };

    // Virada: conversa que um robô antigo já abriu termina com ele. Só decide quando ainda não há dona.
    if (f.outroRoboAtivo) return { dona: null, passo: 1, motivo: 'outro robô na conversa' };

    // Reunião ou card de eletroposto ativo: a Duda cede (a agenda do eletroposto já fala com o lead). Vale para os passos 4 a 6, que
    // são os que escolhem a Duda; a Helena e a Carla seguem como antes, e uma posse que já é da Duda ficou no passo 2.
    const cede = (d: DecisaoPorteiro): DecisaoPorteiro =>
      d.dona === 'duda' && f.reuniaoEletroposto === true
        ? { dona: null, passo: 1, motivo: 'reunião ou card de eletroposto ativo: a Duda cede' }
        : d;

    // 3. cliente do SolarDoc
    if (f.ehClienteSolarDoc) return { dona: 'giovanna_suporte', passo: 3, motivo: 'cliente do SolarDoc: suporte' };

    // 4. anúncio
    const doAnuncio = f.anuncio?.produto ?? null;
    if (doAnuncio) return cede({ dona: PERSONA_DO_PRODUTO[doAnuncio], passo: 4, motivo: `anúncio de ${doAnuncio}` });

    // 5. botão
    const doBotao = produtoDoBotao(f.primeiroTextoDoLead);
    if (doBotao) return cede({ dona: PERSONA_DO_PRODUTO[doBotao], passo: 5, motivo: `texto de botão de ${doBotao}` });

    // 6. cadastro / card
    const daOrigem = produtoDaOrigem(f.origemCadastro);
    if (daOrigem) return cede({ dona: PERSONA_DO_PRODUTO[daOrigem], passo: 6, motivo: `cadastro de ${daOrigem}` });

    // 7. a pergunta
    return { dona: null, passo: 7, motivo: 'sem sinal do assunto: pergunta única', pergunta: PERGUNTA_DO_PORTEIRO };
  } catch {
    return { dona: null, passo: 'falha', motivo: 'o porteiro falhou: ninguém responde' };
  }
}

/**
 * Chave do contato para uma linha de wa_mensagens, com o LID resolvido pelo mapa (wa_lid_telefone)
 * ANTES de comparar. LID sem mapa vira `lid:<dígitos>` (conversa própria, nunca casa com telefone).
 */
export function chaveResolvida(
  linha: Pick<LinhaWa, 'telefone' | 'is_group'>,
  mapa: MapaLid,
): string | null {
  return chaveDaLinha(linha, mapa);
}
