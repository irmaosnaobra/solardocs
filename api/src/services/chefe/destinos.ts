// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — DESTINOS: o envio vai para a equipe ou para fora?
//
// Destino da equipe vira aviso_interno, seja qual for o robô que pediu. É o que
// impede um "frio" declarado para o celular do consultor de gastar o orçamento
// do frio. E o contrário vale também: aviso ao time para quem NÃO é da equipe
// vira frio (decidir.ts) [revisão].
//
// GRUPO NÃO É INTERNO POR PADRÃO [revisão]. A linha é membro do grupo do
// eletroposto, onde entra lead pelo convite (webhook.ts, IO_GRUPO_ELETROPOSTO_ID).
// Grupo só é interno quando está na lista explícita (parâmetro, como a equipe:
// o ZAPI_IO_GROUP_ID do cartão de agendamento e o grupo para onde o
// encaminharMidiaConsultor.ts cai sem consultor) ou quando o robô é de grupo
// (roboDeGrupo em CLASSE_POR_ROBO).
//
// PURO: a lista da equipe e a dos grupos entram por parâmetro. Os mapas EQUIPE
// continuam onde estão (ioEletroposto.ts, ioSolar.ts, encaminharMidiaConsultor.ts)
// nesta fase. Quando o CHEFE for ligado, a lista da equipe tem de trazer o dono e
// todo consultor que recebe aviso (encaminha_midia, duda_ficha_consultor,
// giovanna_aviso_dono, venda, asaas, o cadastro de consultores do CRM): telefone
// que faltar aparece na sombra como aviso rebaixado a frio.
//
// A comparação é pela chave do contato (DDD + 8 últimos dígitos), a mesma do
// silenciar.ts: estável com e sem o nono dígito e com e sem o 55. A função é
// reescrita aqui, e não importada, porque o silenciar.ts puxa o supabase no
// import e este núcleo não pode depender de banco. O teste chefeDestinos prova
// que as duas dão a mesma chave.
// ─────────────────────────────────────────────────────────────────────────────

/** Mesma regra de silenciar.ts:39-45. null = não é telefone de pessoa. */
export function chaveDoContato(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;   // > 13 é grupo ou LID, não telefone
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (semDdi.length < 10) return null;
  return semDdi.slice(0, 2) + semDdi.slice(-8);
}

/** Id de grupo da Z-API ('120363...-group') ou do WhatsApp ('...@g.us'). */
export function ehGrupo(destino: string | null | undefined): boolean {
  const s = String(destino ?? '').trim().toLowerCase();
  return s.endsWith('-group') || s.endsWith('@g.us');
}

/**
 * Chave do grupo: só os dígitos do id, sem o sufixo. A Z-API alterna entre
 * '120363xxx-group' e '120363xxx@g.us' (webhook.ts compara só os dígitos).
 * null = não é grupo.
 */
export function chaveDoGrupo(destino: string | null | undefined): string | null {
  if (!ehGrupo(destino)) return null;
  const d = String(destino).trim().toLowerCase().replace(/(-group|@g\.us)$/, '').replace(/\D/g, '');
  return d || null;
}

export interface OpcoesInterno {
  /** Grupos do time (lista explícita). Grupo fora dela é de fora. */
  grupos?: readonly string[];
  /** O robô é de grupo (o cartão de agendamento): para ele, grupo é interno. */
  roboDeGrupo?: boolean;
}

/**
 * O destino é da equipe? Telefone da equipe, sim. Grupo só se está na lista
 * explícita ou se o robô é de grupo. Um LID ('...@lid') não resolve para
 * telefone aqui, então NÃO é tratado como interno: quem precisa disso resolve o
 * LID antes (pausaHumana.ts explica a armadilha).
 */
export function ehDestinoInterno(destino: string | null | undefined, equipe: readonly string[] = [], opts: OpcoesInterno = {}): boolean {
  if (ehGrupo(destino)) {
    if (opts.roboDeGrupo) return true;
    const g = chaveDoGrupo(destino);
    return !!g && (opts.grupos ?? []).some(x => chaveDoGrupo(x) === g);
  }
  const k = chaveDoContato(destino);
  if (!k) return false;
  for (const tel of equipe) {
    if (chaveDoContato(tel) === k) return true;
  }
  return false;
}
