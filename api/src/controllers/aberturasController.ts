import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// Aberturas do link rastreado da proposta: eventos feature 'proposta_link' em feature_events.

export interface LinhaAbertura {
  event_type: string;
  created_at: string;
  event_data: {
    document_id?: string; cidade?: string | null; uf?: string | null; pais?: string | null; dispositivo?: string | null;
  } | null;
}

export interface UltimaAbertura { em: string; cidade: string | null; uf: string | null; dispositivo: string | null; vencida: boolean }

/**
 * Agrega as linhas (da MAIS NOVA para a mais antiga) por documento: total e a última abertura.
 * Limite de leitura: o PostgREST corta a resposta em 1000 linhas, então quem tem mais de 1000
 * aberturas no total vê contagem parcial dos documentos mais antigos. É o teto aceito do painel.
 */
export function agregarAberturas(linhas: LinhaAbertura[]): Record<string, { total: number; ultima: UltimaAbertura }> {
  const out: Record<string, { total: number; ultima: UltimaAbertura }> = {};
  for (const l of linhas) {
    const id = l.event_data?.document_id;
    if (!id) continue;
    const atual = out[id];
    if (atual) { atual.total++; continue; }
    out[id] = {
      total: 1,
      ultima: {
        em: l.created_at,
        cidade: l.event_data?.cidade ?? null,
        uf: l.event_data?.uf ?? null,
        dispositivo: l.event_data?.dispositivo ?? null,
        vencida: l.event_type === 'aberta_vencida',
      },
    };
  }
  return out;
}

// GET /documents/aberturas — resumo por documento, para a lista do histórico.
export async function aberturasResumo(req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('feature_events')
      .select('event_type, created_at, event_data')
      .eq('user_id', req.userId)
      .eq('feature', 'proposta_link')
      .order('created_at', { ascending: false })
      .limit(1000); // teto do PostgREST: pedir mais não adianta
    if (error) throw error;
    res.json(agregarAberturas((data ?? []) as LinhaAbertura[]));
  } catch (err) {
    console.error('[aberturas] resumo falhou', (err as Error).message);
    res.status(500).json({ error: 'Erro ao carregar as aberturas' });
  }
}

// GET /documents/:id/aberturas — últimas 50 aberturas de um documento (só o dono).
export async function aberturasDoDocumento(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const { data: doc } = await supabase
      .from('documents').select('id').eq('id', id).eq('user_id', req.userId).maybeSingle();
    if (!doc) {
      res.status(404).json({ error: 'Documento não encontrado' });
      return;
    }
    const { data, error } = await supabase
      .from('feature_events')
      .select('event_type, created_at, event_data')
      .eq('user_id', req.userId)
      .eq('feature', 'proposta_link')
      .eq('event_data->>document_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(((data ?? []) as LinhaAbertura[]).map((l) => ({
      em: l.created_at,
      cidade: l.event_data?.cidade ?? null,
      uf: l.event_data?.uf ?? null,
      pais: l.event_data?.pais ?? null,
      dispositivo: l.event_data?.dispositivo ?? null,
      vencida: l.event_type === 'aberta_vencida',
    })));
  } catch (err) {
    console.error('[aberturas] lista falhou', (err as Error).message);
    res.status(500).json({ error: 'Erro ao carregar as aberturas' });
  }
}
