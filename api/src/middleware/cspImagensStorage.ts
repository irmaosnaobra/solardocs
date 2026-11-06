import { RequestHandler } from 'express';
import helmet from 'helmet';
import { hostDoSupabase } from '../utils/redePdf';

/**
 * CSP das páginas PÚBLICAS que mostram imagem do Storage (proposta /p, vistoria /v, manutenção /m). É a CSP padrão
 * do helmet (a do app), trocando SÓ o `img-src`: sem isso o navegador bloqueia toda imagem que vem por URL
 * assinada em https://{projeto}.supabase.co (fotos, assinaturas, logos). O host é o exato do SUPABASE_URL, nunca
 * `https:` genérico; sem a variável, a CSP do app segue como está. As outras rotas não mudam.
 */
export function cspImagensStorage(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const host = hostDoSupabase(env);
  if (!host) return (_req, _res, next) => next();
  return helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: { 'img-src': ["'self'", 'data:', `https://${host}`] },
  });
}
