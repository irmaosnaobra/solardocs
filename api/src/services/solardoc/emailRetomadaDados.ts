// ─────────────────────────────────────────────────────────────────────────────
// RETOMADA DA BASE POR E-MAIL (18/11/2026): as leituras e o envio de VERDADE (o desenho e as regras estão em emailRetomada.ts).
// Separado de propósito: o módulo das regras fica puro e testável sem banco. Erro de leitura LANÇA (a rodada não envia: lista cortada também é "não saber").
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chavesExistentes, liberarChave, reservarChave } from '../agentes5040/cota';
import { sendEmailRetomadaBase } from '../../utils/mailer';
import type { VendaRet } from './retomadaUsuariosRegras';
import { CHAVE_EMAIL_RETOMADA_ESGOTADA, PREFIXO_CLAIM_EMAIL_RETOMADA, type DepsEmailRetomada, type ExtrasEmail, type UsuarioEmail } from './emailRetomada';

const PAGINA = 1000;
/** Defesa: nenhuma leitura paginada passa de tantas páginas (o PostgREST corta em 1000 linhas por chamada). */
const MAX_PAGINAS = 100;

const COLUNAS = 'id, email, nome, plano, billing_status, plano_expira_em, created_at, is_admin, last_canceled_at, documentos_usados, origem_aquisicao, email_opt_out';

async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await pagina(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error('leitura paginada falhou');
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
  throw new Error('leitura paginada passou do limite');
}

const emLotes = <T>(lista: readonly T[], tamanho: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
};

export function depsReaisEmail(): DepsEmailRetomada {
  return {
    // `plano = free`: quem tem plano pago nunca entra (pagaHoje). O descadastro e o e-mail inválido saem em JS (o `neq(..., true)` do PostgREST derruba NULL).
    async lerPagina(de, ate) {
      const { data, error } = await supabase.from('users').select(COLUNAS).eq('plano', 'free').order('id', { ascending: true }).range(de, ate);
      if (error) throw new Error('ler os usuários falhou');
      return (data ?? []) as UsuarioEmail[];
    },

    async lerEsgotada() {
      try {
        const { data, error } = await supabase.from('system_state').select('updated_at').eq('key', CHAVE_EMAIL_RETOMADA_ESGOTADA).maybeSingle();
        if (error) return null;
        const t = Date.parse(String((data as { updated_at?: string } | null)?.updated_at ?? ''));
        return Number.isFinite(t) ? t : null;
      } catch { return null; }
    },

    async gravarEsgotada(agora) {
      const em = agora.toISOString();
      const { error } = await supabase.from('system_state').upsert({ key: CHAVE_EMAIL_RETOMADA_ESGOTADA, value: { em }, updated_at: em }, { onConflict: 'key' });
      if (error) throw new Error('gravar a base esgotada falhou');
    },

    async jaReceberam(ids) {
      const achadas = await chavesExistentes(ids.map(id => `${PREFIXO_CLAIM_EMAIL_RETOMADA}${id}`));
      return new Set(ids.filter(id => achadas.has(`${PREFIXO_CLAIM_EMAIL_RETOMADA}${id}`)));
    },

    async lerExtras(usuarios) {
      const mapa = new Map<string, ExtrasEmail>();
      const emails = [...new Set(usuarios.map(u => String(u.email ?? '').trim().toLowerCase()).filter(Boolean))];
      const vendas = new Map<string, VendaRet[]>();
      for (const lote of emLotes(emails, 50)) {
        const { data, error } = await supabase.from('sales').select('email, valor, status, subscription_id').in('email', lote);
        if (error) throw new Error('ler as vendas falhou');
        for (const v of (data ?? []) as VendaRet[]) {
          const k = String(v.email ?? '').toLowerCase();
          vendas.set(k, [...(vendas.get(k) ?? []), v]);
        }
      }
      // "Gerou documento": o contador `documentos_usados` zera no reset e na ativação, a tabela `documents` não. Só lê de quem o contador não prova.
      const comDocumento = new Set<string>();
      const semContador = usuarios.filter(u => !(Number(u.documentos_usados) > 0)).map(u => u.id);
      for (const lote of emLotes(semContador, 100)) {
        const linhas = await lerTudo<{ user_id: string }>((de, ate) =>
          supabase.from('documents').select('user_id').in('user_id', lote).order('user_id', { ascending: true }).range(de, ate));
        for (const l of linhas) comDocumento.add(l.user_id);
      }
      for (const u of usuarios) {
        mapa.set(u.id, { vendas: vendas.get(String(u.email ?? '').trim().toLowerCase()) ?? [], temDocumento: comDocumento.has(u.id) });
      }
      return mapa;
    },

    reservar: (chave, valor, agora) => reservarChave(chave, valor, agora),
    liberar: (chave) => liberarChave(chave),
    enviar: (a) => sendEmailRetomadaBase(a),
  };
}
