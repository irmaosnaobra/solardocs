import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { exigeConsultor } from './geradorDossie';
import { exigeEquipe, instanciaIO } from './geradorCaixa';
import { lerAcompanhamento, lerPessoa } from '../services/io/helenaAcompanhamento';
import { chaveValida, variantesDaChave, autorDe, type LinhaWa } from '../services/gerador/caixaWhatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// ACOMPANHAMENTO DA HELENA (aba "Helena" da Central das Agentes). SÓ LEITURA.
//
//   GET /gerador/helena/acompanhamento   consultor logado (a lista não leva telefone); 60 s em memória.
//   GET /gerador/helena/pessoa?chave=    consultor logado E da equipe (leva a conversa de cliente, como a Caixa).
//
// O formato de resposta é o do comentário no topo do bloco JS da aba (agentes/index.html).
// Erro de banco vira 502 com mensagem genérica; nada de telefone ou texto de mensagem em log.
// ─────────────────────────────────────────────────────────────────────────────

const MENSAGENS_MAX = 100;
const TEXTO_MAX = 2000;

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

/** O autor da Caixa (lead, agente, equipe) nos nomes da tela. */
const deDaTela = (autor: string): 'helena' | 'pessoa' | 'equipe' => (autor === 'lead' ? 'pessoa' : autor === 'equipe' ? 'equipe' : 'helena');

/** Até 100 mensagens da conversa (telefone e LIDs da chave), em ordem, no formato da tela: { de, texto, em }. */
async function lerMensagens(chave: string, instancia: string): Promise<Array<{ de: 'helena' | 'pessoa' | 'equipe'; texto: string; em: string }>> {
  const { data: lidsData, error: eLid } = await supabase.from('wa_lid_telefone').select('lid').eq('chave', chave).limit(50);
  if (eLid) throw new Error(`lid:${String(eLid.code ?? 'desconhecido')}`);
  const lids = ((lidsData ?? []) as Array<{ lid: string }>).map(r => String(r.lid ?? '').replace(/\D/g, '')).filter(Boolean);
  const { data, error } = await supabase.from('wa_mensagens')
    .select('id, telefone, is_group, from_me, from_api, chat_name, sender_name, tipo, texto, media_url, momment')
    .eq('instancia', instancia).eq('is_group', false).in('telefone', [...variantesDaChave(chave), ...lids])
    .order('momment', { ascending: false }).order('id', { ascending: false }).limit(MENSAGENS_MAX);
  if (error) throw new Error(`wa:${String(error.code ?? 'desconhecido')}`);
  return ((data ?? []) as LinhaWa[])
    .filter(l => l.tipo !== 'reacao' && l.tipo !== 'notificacao')
    .sort((a, b) => Date.parse(a.momment) - Date.parse(b.momment) || a.id - b.id)
    .map(l => ({
      de: deDaTela(autorDe(l)),
      // Áudio e imagem sem legenda não têm texto: a tela mostra o tipo entre colchetes.
      texto: l.texto ? String(l.texto).slice(0, TEXTO_MAX) : `[${l.tipo || 'mensagem'}]`,
      em: new Date(l.momment).toISOString(),
    }));
}

export function mountHelena(router: Router): void {
  router.get('/helena/acompanhamento', semCache, exigeConsultor, async (_req: Request, res: Response) => {
    try {
      res.json(await lerAcompanhamento());
    } catch (err) {
      console.error('[helena] acompanhamento falhou', String((err as Error)?.message || err).slice(0, 200));
      res.status(502).json({ ok: false, error: 'Não consegui ler a lista da Helena agora. Tente de novo em instantes.' });
    }
  });

  router.get('/helena/pessoa', semCache, exigeConsultor, exigeEquipe, async (req: Request, res: Response) => {
    const chave = String(Array.isArray(req.query.chave) ? req.query.chave[0] : req.query.chave ?? '').trim();
    // Só a chave de telefone (10 dígitos): a Helena não guarda sessão por LID.
    if (!chaveValida(chave) || chave.startsWith('lid:')) { res.status(400).json({ ok: false, error: 'Pessoa inválida.' }); return; }
    const instancia = instanciaIO();
    if (!instancia) { res.status(502).json({ ok: false, error: 'Não consegui ler a conversa agora. Tente de novo em instantes.' }); return; }
    try {
      // O item da lista (cache de 60 s) completa nome e tipo de quem ainda está na fila, sem sessão.
      const item = (await lerAcompanhamento().catch(() => null))?.itens.find(i => i.chave === chave) ?? null;
      const [pessoa, mensagens] = await Promise.all([lerPessoa(chave, item), lerMensagens(chave, instancia)]);
      res.json({ ...pessoa, mensagens });
    } catch (err) {
      console.error('[helena] pessoa falhou', String((err as Error)?.message || err).slice(0, 80));
      res.status(502).json({ ok: false, error: 'Não consegui ler a conversa agora. Tente de novo em instantes.' });
    }
  });
}
