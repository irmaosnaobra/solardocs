import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { logger } from '../utils/logger';
import { cidadeParaGravar } from '../services/io/cidadeCanonica';
import { enviarQuizMeta, navegadorDe, eventIdDe } from '../utils/capiQuiz';
import { cookieMeta } from '../utils/metaCapi';
import { hmacDe } from '../services/agentes5040/hmac';
import {
  UFS, IDS_PERGUNTAS_SD, limparRespostas, calcular, normalizarTelefoneSd, leadIdDoQuiz, codigoDoQuiz,
  type RespostasSd, type ResultadoQuiz,
} from '../services/solardoc/quizSolardoc';

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ DO SOLARDOC (/diagnostico, 24/10/2026).
//
// POST /solardoc/quiz (a página chama /_api/solardoc/quiz, e o rewrite do
// dashboard leva para cá). A página manda só IDS de resposta; o índice e o perfil
// são recalculados AQUI. Com ?dry=1 a rota calcula e responde igual, sem gravar e
// sem mandar nada ao Meta (sonda pós-deploy).
//
// O lead mora em `leads_meta` (o mesmo banco do quiz solar), mas com
// form_id 'quiz_solardoc' e lead_id 'sdquiz_<DDD+8 últimos>'. O prefixo NÃO é
// `quiz_`: esse é do quiz solar e entra no painel, na agente e no público de
// clientes quentes dele. Não cria card de agenda.
//
// Política de CORS e de limite de chamadas: as globais do app.ts, as mesmas da
// /io/solar. Falha de gravação ou do Meta nunca trava a pessoa: a rota responde
// 200 com a conta feita.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

const FORM_ID = 'quiz_solardoc';
const URL_DA_PAGINA = 'https://solardoc.app/diagnostico';
const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/** Texto curto vindo do navegador: sem caractere de controle, espaços juntos, com teto. */
const limpo = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const utmDe = (b: Record<string, unknown>): Record<string, string> => {
  const fonte = (b.utm && typeof b.utm === 'object' && !Array.isArray(b.utm) ? b.utm : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of UTMS) { const v = limpo(fonte[k] ?? b[k], 200); if (v) out[k] = v; }
  return out;
};

type Campo = { name: string; values: string[] };

/**
 * O que fica no `field_data` do lead. Os nomes de propósito NÃO casam com o que
 * os leitores do `leads_meta` procuram nos outros quizzes: "Consumo" (público de
 * clientes quentes do solar), "Pontos" e "Caminho". As respostas entram pelo
 * próprio id da pergunta, com os ids das opções (nunca o texto).
 */
export function camposDoLeadSd(a: {
  codigo: string; resultado: ResultadoQuiz; resp: RespostasSd; empresa: string; uf: string;
  utm: Record<string, string>; fbp: string | null; fbc: string | null; lpSession: string;
}): Campo[] {
  const f: Campo[] = [];
  const add = (name: string, v: string | null | undefined) => { if (v) f.push({ name, values: [v] }); };
  add('Origem', 'Quiz SolarDoc');
  add('Código', a.codigo);
  add('Índice', String(a.resultado.indice));
  add('Perfil', a.resultado.perfil);
  add('Perfil nome', a.resultado.perfil_nome);
  add('Pilar mais fraco', a.resultado.pilar_fraco);
  for (const [nome, pts] of Object.entries(a.resultado.pilares)) add(`Pilar ${nome}`, String(pts));
  if (a.resultado.faltam.length) f.push({ name: 'Faltam', values: a.resultado.faltam });
  add('Empresa', a.empresa);
  add('UF', a.uf);
  for (const id of IDS_PERGUNTAS_SD) {
    const v = a.resp[id];
    if (v === undefined) continue;
    f.push({ name: id, values: Array.isArray(v) ? v : [v] });
  }
  for (const [k, v] of Object.entries(a.utm)) add(k, v);
  add('fbp', a.fbp);
  add('fbc', a.fbc);
  add('lp_session', a.lpSession);
  return f;
}

/** Rascunho do lead em `leads_meta`: atualiza se o telefone voltou. Falha aqui não segura o quiz. */
async function gravarLead(leadId: string, campos: Record<string, unknown>): Promise<boolean> {
  try {
    const atualizar = () => supabaseGerador.from('leads_meta').update(campos).eq('lead_id', leadId);
    const { data } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
    let { error } = data?.length
      ? await atualizar()
      : await supabaseGerador.from('leads_meta').insert({ lead_id: leadId, created_time: new Date().toISOString(), ...campos });
    // Dois envios juntos do mesmo telefone: o segundo insert bate no que o primeiro criou.
    if (error && !data?.length) ({ error } = await atualizar());
    if (error) throw error;
    return true;
  } catch (err) {
    // O log nunca leva o telefone nem o lead_id (`sdquiz_<DDD+8>` é o telefone): só um hash curto e a mensagem do erro.
    const ref = (hmacDe(leadId) ?? 'sem-segredo').slice(0, 10);
    logger.error('solardoc-quiz', `rascunho do lead ${ref} falhou`, { erro: (err as { message?: string } | null)?.message ?? 'erro desconhecido' });
    return false;
  }
}

router.post('/quiz', async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const nome = limpo(b.nome, 120);
  if (nome.length < 2) { res.status(400).json({ error: 'nome invalido' }); return; }
  const tel = normalizarTelefoneSd(b.whatsapp);
  if (!tel) { res.status(400).json({ error: 'telefone invalido' }); return; }
  if (b.respostas !== undefined && (!b.respostas || typeof b.respostas !== 'object' || Array.isArray(b.respostas))) {
    res.status(400).json({ error: 'respostas invalidas' }); return;
  }

  const resp = limparRespostas(b.respostas);
  const resultado = calcular(resp);
  const codigo = codigoDoQuiz(tel);
  const leadId = leadIdDoQuiz(tel);
  const empresa = limpo(b.empresa, 120);
  const ufTxt = limpo(b.uf, 2).toUpperCase();
  const uf = (UFS as readonly string[]).includes(ufTxt) ? ufTxt : '';
  const cidadeBruta = limpo(b.cidade, 120);
  // A página manda "Município-UF"; sem o sufixo, a UF do corpo desempata para a canônica.
  const cidade = cidadeBruta
    ? cidadeParaGravar(uf && !/([-/,]\s*[A-Za-z]{2}|\s[A-Z]{2})$/.test(cidadeBruta) ? `${cidadeBruta}-${uf}` : cidadeBruta, tel)
    : null;
  const nav = navegadorDe(req, b);
  const lpSession = /^[\w.:-]{1,100}$/.test(String(b.lp_session ?? '')) ? String(b.lp_session) : '';

  res.set('Cache-Control', 'no-store');
  const dry = String(req.query.dry || '') === '1';
  let gravou = false;
  if (!dry) {
    gravou = await gravarLead(leadId, {
      form_id: FORM_ID, form_name: 'Quiz SolarDoc', nome, whatsapp: tel, cidade, fora_area: false,
      field_data: camposDoLeadSd({
        codigo, resultado, resp, empresa, uf, utm: utmDe(b),
        fbp: cookieMeta(b.fbp), fbc: cookieMeta(b.fbc), lpSession,
      }),
    });
    // Lead pela API de Conversões, o gêmeo do que a página dispara no navegador. SÓ com o
    // event_id que a página mandou (sem ele o Meta contaria em dobro) e só depois de o
    // banco gravar. Com await: a Vercel corta o que roda depois da resposta.
    const eventId = eventIdDe(b.event_id);
    if (gravou && eventId) {
      await enviarQuizMeta({
        produto: 'solardoc', nome: 'Lead', origem: 'website', eventId,
        pessoa: { telefone: tel, nome, cidade, uf: uf || undefined },
        navegador: nav, urlDaPagina: URL_DA_PAGINA,
        dados: { indice: resultado.indice, perfil: resultado.perfil },
      }, 'solardoc-quiz');
    }
  }

  res.json({ ok: true, codigo, indice: resultado.indice, perfil: resultado.perfil, perfil_nome: resultado.perfil_nome });
});

export default router;
