import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { exigeConsultor } from './geradorDossie';
import { ehSocio } from '../services/gerador/solarObras';
import { sanearCalendario } from '../services/agentes5040/sentinela';
import { CHAVE_CALENDARIO } from '../services/agentes5040/sentinelaRodada';

// ─────────────────────────────────────────────────────────────────────────────
// CALENDÁRIO DE VENCIMENTOS DA SENTINELA. Montado dentro de /gerador.
//
//   GET /gerador/sentinela/vencimentos   lê a lista
//   PUT /gerador/sentinela/vencimentos   troca a lista inteira
//
// SÓ SÓCIO (checado aqui a cada requisição, pelo token). A lista mora em
// system_state.sentinela_vencimentos e não leva dado pessoal: ferramenta, data,
// final do cartão (4 dígitos) e uma observação curta. A validação é estrita:
// chave desconhecida cai, campo grande é cortado, cartão que não é de 4 dígitos
// é recusado. A tela vem depois, no painel do ensaio.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'gerador-sentinela';

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function soSocio(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!ehSocio(nome)) { res.status(403).json({ error: 'Só sócio mexe no calendário de vencimentos.' }); return; }
  next();
}

export function mountSentinela(router: Router): void {
  router.get('/sentinela/vencimentos', semCache, exigeConsultor, soSocio, async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', CHAVE_CALENDARIO).maybeSingle();
      if (error) throw error;
      const san = sanearCalendario(data?.value ?? []);
      res.json({ ok: true, vencimentos: san.ok ? san.lista : [], atualizado_em: data?.updated_at ?? null });
    } catch (err: any) {
      logger.error(LOG, 'leitura falhou', { erro: String(err?.message || err) });
      res.status(500).json({ ok: false, error: 'Não consegui ler o calendário agora.' });
    }
  });

  router.put('/sentinela/vencimentos', semCache, exigeConsultor, soSocio, async (req: Request, res: Response) => {
    const bruto = (req.body && typeof req.body === 'object' ? (req.body as any).vencimentos : undefined);
    const san = sanearCalendario(bruto);
    if (!san.ok) { res.status(400).json({ ok: false, error: san.erro }); return; }
    try {
      const { error } = await supabase.from('system_state')
        .upsert({ key: CHAVE_CALENDARIO, value: san.lista, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      res.json({ ok: true, vencimentos: san.lista });
    } catch (err: any) {
      logger.error(LOG, 'gravação falhou', { erro: String(err?.message || err) });
      res.status(500).json({ ok: false, error: 'Não consegui salvar o calendário agora.' });
    }
  });
}
