import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A SONDA QUE DESCOBRE O ASSINANTE APANHANDO.
//
// Ela existe porque o caso de 17/09/2026 não apareceu em lugar nenhum: três
// contratos iguais em 25 minutos, edição de HTML cru na mão, e a gente só soube
// porque o cliente mandou mensagem.
//
// O teste que mais importa aqui é o da CEGUEIRA. A primeira versão fazia
// `const { data } = await supabase...` e, quando a consulta falhava, devolvia
// "nada encontrado" — silêncio idêntico ao de um dia tranquilo. Sonda calada
// todo mundo lê como "está tudo bem", e era esse o defeito que ela nasceu pra
// combater. Pego rodando contra a produção com a chave local morta.
// ═══════════════════════════════════════════════════════════════════════════

type Resposta = { data?: unknown; error?: { message: string } | null };
const respostas: Record<string, Resposta> = {};
const upserts: Array<Record<string, unknown>> = [];
const alertas: Array<{ assunto: string; corpo: string }> = [];

function elo(tabela: string) {
  const resultado = () => respostas[tabela] ?? { data: [], error: null };
  const obj: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(resultado()).then(ok, falha),
  };
  for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'update']) {
    obj[m] = () => obj;
  }
  obj.upsert = (linha: Record<string, unknown>) => { upserts.push(linha); return obj; };
  return obj;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => elo(t) } }));
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: async (assunto: string, corpo: string) => { alertas.push({ assunto, corpo }); },
}));

import { runSondaDocumentos } from '../services/documentos/sondaDocumentos';

const agora = Date.now();
const min = (m: number) => new Date(agora - m * 60000).toISOString();

const doc = (tipo: string, cliente: string, minutosAtras: number, user = 'u1') =>
  ({ user_id: user, tipo, cliente_nome: cliente, created_at: min(minutosAtras) });

beforeEach(() => {
  for (const k of Object.keys(respostas)) delete respostas[k];
  upserts.length = 0;
  alertas.length = 0;
  respostas.users = { data: [{ id: 'u1', email: 'assinante@exemplo.com' }], error: null };
  respostas.system_state = { data: null, error: null };
  respostas.feature_events = { data: [], error: null };
});

describe('insistência: o mesmo documento de novo e de novo', () => {
  it('acusa 3 contratos pro mesmo cliente em menos de 30 min', async () => {
    respostas.documents = {
      data: [doc('contratoSolar', 'VERA', 120), doc('contratoSolar', 'VERA', 105), doc('contratoSolar', 'VERA', 95)],
      error: null,
    };
    const r = await runSondaDocumentos();

    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].motivo).toBe('insistencia');
    expect(r.achados[0].email).toBe('assinante@exemplo.com');
    expect(r.alertou).toBe(true);
    expect(alertas[0].assunto).toContain('apanhando');
  });

  it('não acusa quem gerou 3 vezes ao longo do dia', async () => {
    respostas.documents = {
      data: [doc('contratoSolar', 'VERA', 600), doc('contratoSolar', 'VERA', 300), doc('contratoSolar', 'VERA', 30)],
      error: null,
    };
    const r = await runSondaDocumentos();
    expect(r.achados).toHaveLength(0);
    expect(alertas).toHaveLength(0);
  });

  it('não junta clientes diferentes do mesmo assinante', async () => {
    respostas.documents = {
      data: [doc('contratoSolar', 'VERA', 20), doc('contratoSolar', 'JOÃO', 15), doc('contratoSolar', 'MARIA', 10)],
      error: null,
    };
    const r = await runSondaDocumentos();
    expect(r.achados).toHaveLength(0);
  });
});

describe('modo seco e dedup', () => {
  it('seco encontra mas não manda e-mail', async () => {
    respostas.documents = {
      data: [doc('contratoSolar', 'VERA', 40), doc('contratoSolar', 'VERA', 30), doc('contratoSolar', 'VERA', 20)],
      error: null,
    };
    const r = await runSondaDocumentos({ seco: true });
    expect(r.achados).toHaveLength(1);
    expect(r.alertou).toBe(false);
    expect(alertas).toHaveLength(0);
    expect(upserts).toHaveLength(0);   // nem grava estado
  });

  it('o mesmo aviso não sai duas vezes em 12h', async () => {
    respostas.documents = {
      data: [doc('contratoSolar', 'VERA', 40), doc('contratoSolar', 'VERA', 30), doc('contratoSolar', 'VERA', 20)],
      error: null,
    };
    respostas.system_state = {
      data: { value: { alertadoEm: new Date(agora - 60 * 60000).toISOString(), assinatura: 'u1:insistencia' } },
      error: null,
    };
    const r = await runSondaDocumentos();
    expect(r.alertou).toBe(false);
    expect(r.motivoDoSilencio).toContain('12h');
    expect(alertas).toHaveLength(0);
  });
});

describe('cegueira: consulta que falha não pode virar "nada encontrado"', () => {
  it('avisa que não está enxergando e deixa a tarefa falhar', async () => {
    respostas.documents = { data: null, error: { message: 'Legacy API keys are disabled' } };

    await expect(runSondaDocumentos()).rejects.toThrow(/Legacy API keys/);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].assunto).toContain('cega');
    expect(alertas[0].corpo).toContain('Legacy API keys are disabled');
  });

  it('não repete o aviso de cegueira dentro de 6h', async () => {
    respostas.documents = { data: null, error: { message: 'banco fora do ar' } };
    respostas.system_state = { data: { value: { alertadoEm: new Date(agora - 60 * 60000).toISOString() } }, error: null };

    await expect(runSondaDocumentos()).rejects.toThrow(/banco fora do ar/);
    expect(alertas).toHaveLength(0);   // dedup segurou o e-mail…
  });
});
