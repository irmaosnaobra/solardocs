// Consulta de CNPJ na Receita para o Portal do Parceiro. Primeira fonte: BrasilAPI (mesmo fetch do
// giovannaFerramentas.ts, copiado de propósito para não mexer no arquivo da Giovanna). Segunda fonte,
// se a primeira recusar (o IP da Vercel pode tomar 403/429) ou cair: cnpj.ws pública.

const TIMEOUT_MS = 5000;
const USER_AGENT = 'solardoc-nexus/1.0';

export type ResultadoReceita =
  | { ok: true; ativa: boolean; razao_social: string; nome_fantasia: string }
  | { ok: false; motivo: 'invalido' | 'indisponivel' };

function limpar(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** null = esta fonte não respondeu (status inesperado, rede ou timeout): tentar a próxima. */
async function brasilApi(digitos: string): Promise<ResultadoReceita | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (res.status === 404 || res.status === 400) return { ok: false, motivo: 'invalido' };
    if (!res.ok) {
      console.warn('[nexus/receita] brasilapi', res.status);
      return null;
    }
    const j = (await res.json()) as Record<string, unknown>;
    const descricao = String(j.descricao_situacao_cadastral ?? '').trim().toUpperCase();
    const ativa = descricao ? descricao === 'ATIVA' : Number(j.situacao_cadastral) === 2;
    return { ok: true, ativa, razao_social: limpar(j.razao_social), nome_fantasia: limpar(j.nome_fantasia) };
  } catch (e) {
    console.warn('[nexus/receita] brasilapi', e instanceof Error ? e.name : 'erro');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function cnpjWs(digitos: string): Promise<ResultadoReceita> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${digitos}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (res.status === 404 || res.status === 400) return { ok: false, motivo: 'invalido' };
    if (!res.ok) {
      console.warn('[nexus/receita] cnpjws', res.status);
      return { ok: false, motivo: 'indisponivel' };
    }
    const j = (await res.json()) as Record<string, unknown>;
    const est = (j.estabelecimento ?? {}) as Record<string, unknown>;
    const ativa = String(est.situacao_cadastral ?? '').trim().toLowerCase() === 'ativa';
    return { ok: true, ativa, razao_social: limpar(j.razao_social), nome_fantasia: limpar(est.nome_fantasia) };
  } catch (e) {
    console.warn('[nexus/receita] cnpjws', e instanceof Error ? e.name : 'erro');
    return { ok: false, motivo: 'indisponivel' };
  } finally {
    clearTimeout(timer);
  }
}

/** `digitos`: 14 dígitos já validados por quem chama (cnpjValido). */
export async function consultarCnpj(digitos: string): Promise<ResultadoReceita> {
  if (!/^\d{14}$/.test(digitos)) return { ok: false, motivo: 'invalido' };
  const primeira = await brasilApi(digitos);
  if (primeira) return primeira;
  return cnpjWs(digitos);
}
