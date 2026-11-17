// ─────────────────────────────────────────────────────────────────────────────
// CPF E E-MAIL QUE O LEAD MANDOU NA CONVERSA (17/11/2026). Funções puras, sem banco e sem rede.
//
// O Pix automático pede CPF e e-mail. A pessoa costuma mandar um numa mensagem e o outro na seguinte, então olhar só a rodada atual perdia o primeiro.
// Regras:
//   - só valem mensagens DO LEAD (`from_me` falso): CPF ou e-mail que apareçam numa fala NOSSA nunca contam;
//   - só valem as últimas 48 h (`JANELA_DADOS_DO_LEAD_MS`); mensagem sem `momment` (sessão da Giovanna) vale;
//   - o que a pessoa citou por último vence (CPF e e-mail).
// ─────────────────────────────────────────────────────────────────────────────

export const JANELA_DADOS_DO_LEAD_MS = 48 * 3_600_000;

/** O mínimo que a conversa precisa ter: de quem é, o texto e a hora (ISO). `momment` ausente = sem hora conhecida (vale). */
export interface MsgDaConversaPix { from_me?: boolean | null; texto?: string | null; momment?: string | null }

const soDigitos = (v: string): string => v.replace(/\D/g, '');

/** Dígitos verificadores do CPF (rejeita 11 dígitos iguais). */
export function cpfValido(bruto: string): boolean {
  const d = soDigitos(bruto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number): number => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** O primeiro CPF VÁLIDO no texto da pessoa (com ou sem pontos), só dígitos. CNPJ e número de telefone não passam. null = não achou. */
export function extrairCpf(texto: string | null | undefined): string | null {
  const t = String(texto ?? '');
  for (const m of t.matchAll(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g)) {
    if (cpfValido(m[0])) return soDigitos(m[0]);
  }
  return null;
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** O primeiro e-mail do texto, em minúsculas. */
export function extrairEmail(texto: string | null | undefined): string | null {
  const m = new RegExp(RE_EMAIL.source).exec(String(texto ?? ''));
  return m ? m[0].toLowerCase() : null;
}

/** Os textos escritos PELO LEAD nas últimas 48 h, na ordem em que a conversa vem (do mais antigo ao mais novo), mais o `atual` (a rodada em curso) no fim. Nunca devolve fala nossa. */
export function textosDoLeadRecentes(msgs: ReadonlyArray<MsgDaConversaPix> | null | undefined, agoraMs: number, atual?: string | null): string[] {
  const out = (msgs ?? [])
    .filter(m => !m.from_me && String(m.texto ?? '').trim())
    .filter(m => {
      if (m.momment === undefined || m.momment === null || m.momment === '') return true;
      const t = Date.parse(m.momment);
      return Number.isFinite(t) && agoraMs - t <= JANELA_DADOS_DO_LEAD_MS;
    })
    .map(m => String(m.texto));
  if (String(atual ?? '').trim()) out.push(String(atual));
  return out;
}

/** O CPF válido citado por último (a mensagem mais nova que traz um). */
export function ultimoCpfDoLead(textos: readonly string[]): string | null {
  for (let i = textos.length - 1; i >= 0; i--) {
    const c = extrairCpf(textos[i]);
    if (c) return c;
  }
  return null;
}

/** O e-mail citado por último (a mensagem mais nova que traz um; dentro dela, o último). */
export function ultimoEmailDoLead(textos: readonly string[]): string | null {
  for (let i = textos.length - 1; i >= 0; i--) {
    const todos = [...String(textos[i] ?? '').matchAll(RE_EMAIL)];
    if (todos.length) return todos[todos.length - 1]![0].toLowerCase();
  }
  return null;
}

/** Todos os e-mails distintos citados nas falas do lead (minúsculas). */
export function emailsDoLead(textos: readonly string[]): string[] {
  const set = new Set<string>();
  for (const t of textos) for (const m of String(t ?? '').matchAll(RE_EMAIL)) set.add(m[0].toLowerCase());
  return [...set];
}

/** CPF e e-mail mais recentes das falas do lead (janela de 48 h). */
export function dadosDoLead(msgs: ReadonlyArray<MsgDaConversaPix> | null | undefined, agoraMs: number, atual?: string | null): { cpf: string | null; email: string | null } {
  const textos = textosDoLeadRecentes(msgs, agoraMs, atual);
  return { cpf: ultimoCpfDoLead(textos), email: ultimoEmailDoLead(textos) };
}
