// Consulta de CNPJ na Receita (BrasilAPI) para o Portal do Parceiro. Mesmo fetch do giovannaFerramentas.ts
// (consultarReceita), copiado de propósito para não mexer no arquivo da Giovanna.

const TIMEOUT_MS = 5000;

export type ResultadoReceita =
  | { ok: true; ativa: boolean; razao_social: string; nome_fantasia: string }
  | { ok: false; motivo: 'invalido' | 'indisponivel' };

function limpar(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** `digitos`: 14 dígitos já validados por quem chama (cnpjValido). */
export async function consultarCnpj(digitos: string): Promise<ResultadoReceita> {
  if (!/^\d{14}$/.test(digitos)) return { ok: false, motivo: 'invalido' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, { signal: ctrl.signal });
    if (res.status === 404 || res.status === 400) return { ok: false, motivo: 'invalido' };
    if (!res.ok) return { ok: false, motivo: 'indisponivel' };
    const j = (await res.json()) as Record<string, unknown>;
    const descricao = String(j.descricao_situacao_cadastral ?? '').trim().toUpperCase();
    const ativa = descricao ? descricao === 'ATIVA' : Number(j.situacao_cadastral) === 2;
    return { ok: true, ativa, razao_social: limpar(j.razao_social), nome_fantasia: limpar(j.nome_fantasia) };
  } catch {
    return { ok: false, motivo: 'indisponivel' };
  } finally {
    clearTimeout(timer);
  }
}
