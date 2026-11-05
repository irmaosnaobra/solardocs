import { Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { ehAdm } from '../services/gerador/solarObras';

// ─────────────────────────────────────────────────────────────────────────────
// ADM do /gerador (fase 0, 04/11/2026). Ordem do Thiago: "as coisas mais de
// edição aparecem só pra mim". Quem é ADM: ehAdm (SOLAR_ADM, padrão 'thiago').
//
// exigeAdm vem SEMPRE depois do exigeConsultor, que preenche req.consultor.
// Sem consultor (rota montada errada) também é 403: a falha fecha.
// Só nas telas de ADM e nas escritas de configuração. NUNCA nas leituras que
// a proposta, a agenda, o CRM e os robôs usam.
// ─────────────────────────────────────────────────────────────────────────────

export const MSG_SO_ADM = 'Esta parte do Gerador é só do administrador.';

export function exigeAdm(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!nome || !ehAdm(nome)) {
    res.status(403).json({ ok: false, error: MSG_SO_ADM, precisa: 'adm' });
    return;
  }
  next();
}

/** Login de consultor e depois ADM, nesta ordem. */
export const soAdmLogado = [exigeConsultor, exigeAdm] as const;
