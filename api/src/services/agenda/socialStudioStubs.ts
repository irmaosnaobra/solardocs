// Conexões do estúdio que ainda estão BLOQUEADAS por habilitação externa.
// São stubs com a assinatura final — quando a API real liberar, preenche-se
// só o corpo destas funções (e a tabela social_studio já tem as colunas).
// NÃO estão ligadas ao /cron/master (evita erro diário em prod).

import { logger } from '../../utils/logger';

export interface NaoConfigurado { ok: false; motivo: string; }

// ── Ad Library (Meta) — varredura de anúncios virais de energia solar ───────
// Bloqueado: verificação de identidade da Meta em análise (erro 2332002).
// Quando liberar: chamar graph.facebook.com/.../ads_archive, rankear top5
// por dia/semana/mês, inserir em social_studio (fonte='ad_library').
export async function varrerAdLibrary(): Promise<NaoConfigurado> {
  logger.info('studio-stub', 'varrerAdLibrary chamado — Ad Library ainda não habilitada');
  return { ok: false, motivo: 'Ad Library pendente: confirmação de identidade na Meta em análise.' };
}

// ── HeyGen — gerar vídeo com avatar (Thiago + Diego) a partir do roteiro ────
// Bloqueado: falta plano HeyGen com API + avatares criados + API key.
// Quando liberar: POST na API do HeyGen com o roteiro, salvar video_url em
// social_studio e marcar video_status='pronto'.
export async function gerarVideoAvatar(_roteiro: string): Promise<NaoConfigurado> {
  logger.info('studio-stub', 'gerarVideoAvatar chamado — HeyGen ainda não configurado');
  return { ok: false, motivo: 'HeyGen pendente: falta plano com API, avatares e API key.' };
}
