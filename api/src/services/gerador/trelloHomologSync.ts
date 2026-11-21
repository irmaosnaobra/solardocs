// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026), a sincronia de UMA obra. Lê o cartão (só GET), espelha a checklist ENGENHARIA, e cada anexo NOVO (que nunca
// foi importado nem ignorado) é baixado UMA vez, classificado em `art`, `protocolo` ou `parecer_acesso` (primeiro pelo nome, na dúvida pela IA) e guardado
// no item da venda, só se o item estiver vazio e pelo mesmo registro do upload. Do protocolo saem número e data (IA; sem data, a do anexo no Trello).
//
// Tudo que toca rede, banco e IA entra por `DepsHomolog`: a regra é testável sem nada disso. Quem chama garante a trava da obra, o intervalo de 10 min,
// que a obra está elegível (etapa 3 aberta, não cancelada, não finalizada nem fechada) e a conclusão automática (`routes/geradorJornadaHomolog.ts`).
// Falha do Trello ou da IA nunca lança: grava o erro curto no registro e segue. Nenhum log leva URL, token, nome de arquivo ou texto de documento.
// ─────────────────────────────────────────────────────────────────────────────
import type { CredenciaisTrello } from './dossieVenda';
import type { Res } from './trelloVendaSolar';
import type { ResBaixa } from './trelloHomologTrello';
import type { ResRegistro } from './docsRegistrar';
import type { LeituraAnexo } from './trelloHomologIa';
import {
  MAX_ANEXOS_POR_RODADA, MAX_TENTATIVAS_ANEXO, anexoResolvido, classificarPorNome, parecerAprovadoNoCartao, urlDoTrello,
  type AnexoRegistrado, type AnexoTrello, type CartaoHomolog, type RegistroHomolog, type SlotHomolog,
} from './trelloHomologPuro';

/** Textos curtos do `erro` que a tela mostra em uma linha. Sem URL, sem token e sem corpo de resposta. */
export const ERRO_SEM_LEITURA = 'Não consegui ler o cartão do Trello agora.';
export const ERRO_BANCO = 'Não consegui guardar os documentos do Trello agora.';

export interface DepsHomolog {
  agora(): Date;
  credenciais(): CredenciaisTrello | null;
  lerCartao(cred: CredenciaisTrello, cardId: string): Promise<Res<CartaoHomolog>>;
  baixar(cred: CredenciaisTrello, a: AnexoTrello): Promise<ResBaixa>;
  /** `null` = a IA não respondeu. */
  lerPorIa(a: { bytes: Buffer; mime: string }): Promise<LeituraAnexo | null>;
  /** Os itens que já têm arquivo no card. */
  slotsComArquivo(): Promise<Set<string>>;
  /** Os ids dos anexos do Trello que NÓS mandamos (registro do envio ao cartão, `anexados`): nunca são baixados nem lidos de volta. */
  anexosEnviados(): Promise<Set<string>>;
  /** Guarda no item (só se vazio). `antes(id)` marca o arquivo no registro do Trello para o cartão não receber de volta o que ele mesmo mandou. */
  registrar(e: { slot: SlotHomolog; mime: string; bytes: Buffer; antes: (id: string) => Promise<boolean> }): Promise<ResRegistro>;
  marcarNoTrello(cartaoId: string, docId: string, anexoId: string): Promise<boolean>;
  /** Só preenche o vazio. */
  preencherProtocolo(p: { numero: string; em: string }): Promise<'preencheu' | 'ja_tinha'>;
  lerRegistro(): Promise<RegistroHomolog>;
  gravarRegistro(r: RegistroHomolog): Promise<void>;
}

/** `completo_antes`: o obrigatório (parecer aprovado + arquivo do parecer) na leitura ANTERIOR (null = primeira); `completo_agora`: nesta. */
export interface ResultadoSync {
  acao: 'sincronizou' | 'sem_credencial' | 'falhou'; importados: number; ignorados: number; parecer_aprovado: boolean;
  completo_antes: boolean | null; completo_agora: boolean;
}

const diaBR = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

interface Contagem { importados: number; ignorados: number }

/** O anexo gasta download (e talvez IA)? Link, URL de fora, nome que o descarta e item que já tem arquivo não gastam. */
function precisaBaixar(a: AnexoTrello, slots: ReadonlySet<string>): boolean {
  if (!a.upload || !urlDoTrello(a.url)) return false;
  const p = classificarPorNome(a.nome, a.arquivo);
  return p !== 'outro' && !(p && slots.has(p));
}
/** O que pode ser o parecer (nome do parecer ou sem pista) vem primeiro, depois o protocolo, depois a ART; dentro de cada grupo, o mais antigo. */
function porPrioridade(x: AnexoTrello, y: AnexoTrello): number {
  const peso = (a: AnexoTrello): number => { const p = classificarPorNome(a.nome, a.arquivo); return p === 'parecer_acesso' ? 0 : p === null ? 1 : p === 'protocolo' ? 2 : p === 'art' ? 3 : 4; };
  return peso(x) - peso(y) || (x.em < y.em ? -1 : x.em > y.em ? 1 : 0);
}

/** Um anexo: devolve o que o registro passa a guardar dele. Nunca lança. */
async function tratarAnexo(a: AnexoTrello, reg: RegistroHomolog, cartaoId: string, cred: CredenciaisTrello, slots: Set<string>, d: DepsHomolog, agora: string): Promise<AnexoRegistrado> {
  const tentativas = (reg.anexos[a.id]?.tentativas ?? 0) + 1;
  const ignorado = (): AnexoRegistrado => ({ resultado: 'ignorado', slot: null, em: agora, tentativas });
  const falhando = (): AnexoRegistrado => ({ resultado: tentativas >= MAX_TENTATIVAS_ANEXO ? 'ignorado' : 'falhando', slot: null, em: agora, tentativas });
  try {
    if (!a.upload || !urlDoTrello(a.url)) return ignorado();
    const pelaPista = classificarPorNome(a.nome, a.arquivo);
    if (pelaPista === 'outro') return ignorado();
    // O item que o nome aponta já tem arquivo: nada a baixar nem a ler (e nada a sobrescrever).
    if (pelaPista && slots.has(pelaPista)) return ignorado();
    const b = await d.baixar(cred, a);
    if (!b.ok) return b.definitivo ? ignorado() : falhando();

    let slot: SlotHomolog | null = pelaPista;
    let lido: LeituraAnexo | null = null;
    if (pelaPista === null || pelaPista === 'protocolo') {
      lido = await d.lerPorIa({ bytes: b.bytes, mime: b.mime });
      if (!lido && tentativas < MAX_TENTATIVAS_ANEXO) return falhando();   // IA fora: tenta na próxima rodada, sem perder o anexo
      if (pelaPista === null) slot = lido && lido.tipo !== 'outro' ? lido.tipo : null;
    }
    if (!slot || slots.has(slot)) return ignorado();

    const r = await d.registrar({ slot, mime: b.mime, bytes: b.bytes, antes: (docId) => d.marcarNoTrello(cartaoId, docId, a.id) });
    if (!r.ok) return r.motivo === 'ocupado' ? falhando() : ignorado();
    slots.add(slot);
    if (slot === 'protocolo') await preencher(a, lido, d, agora);
    return { resultado: 'importado', slot, em: agora, tentativas };
  } catch {
    return falhando();
  }
}

/** Número e data do protocolo: número da IA (sem número não há o que gravar); data da IA, senão a do anexo no Trello; nunca no futuro. */
async function preencher(a: AnexoTrello, lido: LeituraAnexo | null, d: DepsHomolog, agora: string): Promise<void> {
  if (!lido?.numero) return;
  const hoje = diaBR(agora);
  const doAnexo = a.em ? diaBR(a.em) : hoje;
  const em = lido.data && lido.data <= hoje ? lido.data : (doAnexo <= hoje ? doAnexo : hoje);
  await d.preencherProtocolo({ numero: lido.numero, em });
}

/**
 * Sincroniza UMA obra. Grava o registro no fim (com `tentado_em`, que conta o intervalo de 10 min). `parecer_aprovado` volta lido do cartão agora:
 * quem chama decide a conclusão automática com ele.
 */
export async function sincronizarHomologacao(cardId: string, d: DepsHomolog): Promise<ResultadoSync> {
  const cred = d.credenciais();
  if (!cred) return { acao: 'sem_credencial', importados: 0, ignorados: 0, parecer_aprovado: false, completo_antes: null, completo_agora: false };
  const agoraIso = d.agora().toISOString();
  const reg = await d.lerRegistro();
  const novo: RegistroHomolog = { ...reg, card_id: cardId, tentado_em: agoraIso, anexos: { ...reg.anexos } };
  const c = await d.lerCartao(cred, cardId);
  if (!c.ok) {
    await d.gravarRegistro({ ...novo, erro: ERRO_SEM_LEITURA });
    return { acao: 'falhou', importados: 0, ignorados: 0, parecer_aprovado: reg.parecer_aprovado, completo_antes: reg.completo, completo_agora: false };
  }
  novo.checklist = c.dados.checklist;
  novo.parecer_aprovado = parecerAprovadoNoCartao(c.dados.checklist);
  novo.cartao_url = c.dados.url ?? reg.cartao_url;
  novo.sincronizado_em = agoraIso;
  novo.erro = null;

  const cont: Contagem = { importados: 0, ignorados: 0 };
  let slots: Set<string> | null = null;
  let enviados = new Set<string>();
  try { [slots, enviados] = await Promise.all([d.slotsComArquivo(), d.anexosEnviados()]); } catch { slots = null; novo.erro = ERRO_BANCO; }
  let completoAgora = false;
  if (slots) {
    // Do que NÓS mandamos ao cartão (dossiê e relatório) nada se baixa nem se lê de volta. O que falta decidir vai na ordem do que importa: o que
    // pode ser o parecer, depois o protocolo, depois a ART. O que não custa download (link, nome que descarta, item já cheio) passa sem gastar o teto.
    const fila = c.dados.anexos.filter((a) => !enviados.has(a.id) && !anexoResolvido(novo, a.id)).sort(porPrioridade);
    let baixados = 0;
    for (const a of fila) {
      const custa = precisaBaixar(a, slots);
      if (custa && baixados >= MAX_ANEXOS_POR_RODADA) continue;
      if (custa) baixados++;
      const r = await tratarAnexo(a, novo, cardId, cred, slots, d, agoraIso);
      novo.anexos[a.id] = r;
      if (r.resultado === 'importado') cont.importados++; else if (r.resultado === 'ignorado') cont.ignorados++;
      await d.gravarRegistro(novo);   // rodada interrompida não repete o que já foi feito
    }
    completoAgora = novo.parecer_aprovado && slots.has('parecer_acesso');
    // Enquanto houver anexo elegível ainda não resolvido, o "completo" é DESCONHECIDO (null): quem conclui nunca avisa com base nisso. Só uma leitura
    // definitiva (sem pendente) vira `false` ou `true`, e é dela que se vê a mudança.
    const pendente = c.dados.anexos.some((a) => !enviados.has(a.id) && !anexoResolvido(novo, a.id));
    novo.completo = pendente ? null : completoAgora;
  }
  await d.gravarRegistro(novo);
  return { acao: 'sincronizou', ...cont, parecer_aprovado: novo.parecer_aprovado, completo_antes: reg.completo, completo_agora: completoAgora };
}
