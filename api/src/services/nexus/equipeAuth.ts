// exigeEquipeNexus: o porteiro das rotas /gerador/nexus/equipe/* e /gerador/nexus/adm/*.
// Aceita DOIS logins, e a escolha entre eles é feita pela ASSINATURA, nunca pelo que o token diz de si mesmo:
//
//   1. JWT do SolarDoc (o mesmo do authMiddleware): jwt.verify com o JWT_SECRET e algorithms ['HS256'] fixo (rejeita
//      alg:none, outro segredo e expirado). Passou na assinatura = caminho do SolarDoc, e daí NÃO cai mais no do Gerador.
//      Entra se users.is_admin === true OU o e-mail está ATIVO em nexus_equipe com user_id igual ao do JWT. Qualquer outra conta: 403 `sem_acesso_adm`.
//   2. Token do Gerador (Supabase Auth do Gerador): a regra do `exigeConsultor` (routes/geradorDossie.ts), chamada como
//      está, sem cópia: e-mail @irmaosnaobra.app CONFIRMADO. Só chega aqui quando a assinatura do SolarDoc falhou.
//
// Preenche req.equipe = {email, nome, socio, gerirEquipe, via} e mantém req.consultor = {email, nome} (o código existente
// lê criado_por dali). `socio` e `gerirEquipe` NUNCA saem do nome do e-mail no caminho do SolarDoc: lá só valem
// is_admin ou o papel 'socio'. O papel 'admin' de nexus_equipe entra no ADM, mas não é sócio e não gere a equipe.
// Falha do banco nunca libera: vira 500.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { JWT_SECRET } from '../../utils/jwt';
import { ehSocio } from '../gerador/solarObras';
import { exigeConsultor } from '../../routes/geradorDossie';
import { normalizarEmail, papelAtivo } from './equipe';

export interface EquipeNexus {
  email: string;
  nome: string;
  socio: boolean;
  gerirEquipe: boolean;
  via: 'gerador' | 'solardoc';
}

declare global {
  namespace Express {
    interface Request {
      equipe?: EquipeNexus;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** userId do JWT do SolarDoc se a ASSINATURA confere; 'invalido' se confere mas não é token de login; null se não confere. */
function lerJwtDoSolarDoc(token: string): string | 'invalido' | null {
  try {
    const d = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId?: unknown };
    return typeof d?.userId === 'string' && UUID_RE.test(d.userId) ? d.userId : 'invalido';
  } catch {
    return null;
  }
}

const precisaLogin = (res: Response, frase: string): void => {
  res.status(401).json({ erro: 'login_necessario', error: frase, precisa: 'login' });
};

export async function exigeEquipeNexus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.startsWith('sb_publishable_')) {
    precisaLogin(res, 'Entre com a sua conta.');
    return;
  }

  const doSolarDoc = lerJwtDoSolarDoc(token);

  // ── Caminho 1: JWT do SolarDoc ──────────────────────────────────────────────
  if (doSolarDoc !== null) {
    if (doSolarDoc === 'invalido') { precisaLogin(res, 'Sessão inválida. Entre de novo.'); return; }
    try {
      const { data, error } = await supabase.from('users').select('id, email, nome, is_admin').eq('id', doSolarDoc).limit(1);
      if (error) throw new Error(error.message);
      const u = ((data as Array<{ email?: string; nome?: string; is_admin?: boolean }> | null) ?? [])[0];
      if (!u) { precisaLogin(res, 'Conta não encontrada. Entre de novo.'); return; }

      const email = normalizarEmail(u.email);
      const admin = u.is_admin === true;
      const papel = admin || !email ? null : await papelAtivo(email, doSolarDoc);
      if (!admin && !papel) {
        res.status(403).json({ erro: 'sem_acesso_adm' });
        return;
      }
      const nome = String(u.nome ?? '').trim() || email.split('@')[0] || email;
      const socio = admin || papel === 'socio';
      req.equipe = { email, nome, socio, gerirEquipe: socio, via: 'solardoc' };
      (req as unknown as { consultor?: { email: string; nome: string } }).consultor = { email, nome };
    } catch (e) {
      logger.error('nexus-equipe', 'não consegui conferir o acesso ao ADM', e);
      res.status(500).json({ erro: 'erro_interno' });
      return;
    }
    next();
    return;
  }

  // ── Caminho 2: token do Gerador (regra do exigeConsultor, que responde 401/403 sozinho) ──
  let passou = false;
  await exigeConsultor(req, res, () => { passou = true; });
  if (!passou) return;
  const c = (req as unknown as { consultor?: { email?: string; nome?: string } }).consultor;
  const email = normalizarEmail(c?.email);
  const nome = String(c?.nome ?? '');
  const socio = ehSocio(nome);
  req.equipe = { email, nome, socio, gerirEquipe: socio, via: 'gerador' };
  next();
}
