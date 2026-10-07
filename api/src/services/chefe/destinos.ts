// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — DESTINOS: o envio vai para a equipe ou para fora?
//
// Destino da equipe vira aviso_interno, seja qual for o robô que pediu. É o que
// impede um "frio" declarado para o celular do consultor de gastar o orçamento
// do frio, e um aviso ao time de passar como se fosse lead.
//
// PURO: a lista da equipe entra por parâmetro. Os mapas EQUIPE continuam onde
// estão (ioEletroposto.ts, ioSolar.ts, encaminharMidiaConsultor.ts) nesta fase.
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
 * O destino é da equipe? Grupo conta como interno: a linha só manda para grupo
 * os cartões do time (sendToGroup). Um LID ('...@lid') não resolve para
 * telefone aqui, então NÃO é tratado como interno: quem precisa disso resolve o
 * LID antes (pausaHumana.ts explica a armadilha).
 */
export function ehDestinoInterno(destino: string | null | undefined, equipe: readonly string[] = []): boolean {
  if (ehGrupo(destino)) return true;
  const k = chaveDoContato(destino);
  if (!k) return false;
  for (const tel of equipe) {
    if (chaveDoContato(tel) === k) return true;
  }
  return false;
}
