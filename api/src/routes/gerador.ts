import { Router, Request, Response } from 'express';
import { generateGeradorPdf } from '../controllers/pdfGeradorController';
import { trackEvent } from '../controllers/trackingGeradorController';
import { gerarIdeiasSociais, roteirizarTema, roteirizarUpload } from '../services/agenda/socialIdeiasService';
import { varrerAdLibrary, gerarVideoAvatar } from '../services/agenda/socialStudioStubs';
import { gerarProdutosVirais, redispararVideoProduto } from '../services/agenda/produtosViraisService';
import { processarWebhook, reconciliarStatusProduto, animarProduto } from '../services/agenda/higgsfieldService';
import { ingestManychatLead } from '../services/agenda/manychatLeadService';
import { runGeradorBroadcastTick } from '../services/io/geradorAutomacaoService';
import { runProspeccaoApifyTick } from '../services/io/prospeccaoApifyService';
import { montarBusca } from '../services/io/prospeccaoBriefService';
import { montarCentralAgentes } from '../services/io/centralAgentes';
import { listarCerebros, salvarCerebro, restaurarCerebro, conversarComAgente, ehCerebroValido } from '../services/io/cerebroAgentes';
import {
  calcularPrevia, criarCobranca, listarCobrancas, simularAntecipacao, pedirAntecipacao,
} from '../services/asaas/asaasCobrancas';
import { montarPlanoCobranca, sanearPlano } from '../services/asaas/cobrancaBrief';
import { buscarTaxas, ambienteAsaas } from '../services/asaas/asaasTaxas';
import { logger } from '../utils/logger';

const router = Router();

// PDF público de proposta do Gerador IO. Rate-limit global já cobre — chamada
// é pesada (Puppeteer), mas controller verifica existência da proposta antes
// de levantar o browser.
router.get('/pdf/:codigo', generateGeradorPdf);

// Tracking server-side de acessos e cliques (lê IP + UA da request, resolve geo).
router.post('/track', trackEvent);

// Webhook do ManyChat (Instagram DM): recebe o lead QUENTE já qualificado da
// boas-vindas e deposita no CRM/agenda do Gerador — rodízio de consultor + aviso
// no WhatsApp, igual ao Meta Lead Ads. Só solar e eletroposto caem aqui (SolarDoc
// e LimpaPro vão pro WhatsApp 34998165040 via link wa.me, sem backend).
//
// AUTH: confia no CORPO (não há card pré-escrito pra reler), então exige secret.
// Fail-closed: sem MANYCHAT_LEAD_SECRET configurado, responde 503 — deployar
// antes do secret existir é seguro (ninguém injeta lead/spam no WhatsApp).
router.post('/manychat-lead', async (req: Request, res: Response) => {
  const secret = (process.env.MANYCHAT_LEAD_SECRET || '').trim();
  if (!secret) { res.status(503).json({ error: 'endpoint não configurado' }); return; }

  const auth = String(req.headers['authorization'] || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const provided = bearer || String(req.headers['x-manychat-secret'] || '').trim();
  if (provided !== secret) { res.status(401).json({ error: 'não autorizado' }); return; }

  try {
    const r = await ingestManychatLead(req.body || {});
    res.status(r.ok ? 200 : 400).json(r);
  } catch (err: any) {
    logger.error('gerador', 'manychat-lead falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// Central de Automação (Disparos): "kick" opcional pra disparar um tick na hora,
// pro 1º envio não esperar até 60s pelo cron. É idempotente e passa por TODAS as
// travas do motor (kill-switch, allow-list de CRM, supressão, caps, lock de linha).
// Como o enqueue já é aberto (chave publishable pública), este endpoint não precisa
// de auth pesada — no pior caso só faz o que o cron faria. O globalLimiter cobre.
router.post('/automacao/kick', async (_req: Request, res: Response) => {
  try {
    const result = await runGeradorBroadcastTick();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error('gerador', 'automacao/kick falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// Formulário público de simulação solar (link mandado na DM do Instagram).
// Ao enviar, cria o lead no CRM via ingestManychatLead → rodízio de consultor +
// aviso no WhatsApp, exatamente como o lead do ManyChat/Meta. Honeypot anti-bot.
router.post('/form-solar', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, string>;
  if (b.website) { res.json({ ok: true, ignored: true }); return; } // bot preencheu o campo escondido
  try {
    const r = await ingestManychatLead({
      produto: 'solar',
      nome: b.nome, whatsapp: b.whatsapp, cidade: b.cidade,
      valor_conta: b.valor_conta, tipo_telhado: b.tipo_telhado, faixa_horario: b.faixa_horario,
      contact_id: 'form_' + String(b.whatsapp || '').replace(/\D/g, ''),
    });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (err: any) {
    logger.error('gerador', 'form-solar falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// IA: ideias de Reels/vídeos de energia solar, ancoradas nos posts reais que
// mais performaram (aba "Redes" do gerador). Chamado via rewrite /_api/* do dashboard.
router.post('/social/ideias', async (req: Request, res: Response) => {
  try {
    const rede = (req.body?.rede === 'tiktok') ? 'tiktok' : 'instagram';
    const ideias = await gerarIdeiasSociais(rede);
    res.json({ ok: true, ideias });
  } catch (err: any) {
    logger.error('gerador', 'social/ideias falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
  }
});

// Estúdio: roteiriza UM tema-isca no DNA viral (pega tema + link opcional).
router.post('/social/roteirizar', async (req: Request, res: Response) => {
  try {
    const tema = String(req.body?.tema || '').trim();
    if (!tema) return res.status(400).json({ error: 'tema obrigatório' });
    const r = await roteirizarTema(tema, req.body?.fonte_url, req.body?.apresentador);
    // degradação honesta: link sem transcrição → sinaliza pro front pedir descrição
    if (r && (r as any).erro) {
      return res.json({ ok: true, roteiro: null, motivo: (r as any).erro, ehYoutube: (r as any).ehYoutube });
    }
    res.json({ ok: true, roteiro: r });
  } catch (err: any) {
    logger.error('gerador', 'social/roteirizar falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
  }
});

// Estúdio: roteiriza a partir de um vídeo enviado (URL no Storage) — transcreve via Whisper.
router.post('/social/roteirizar-upload', async (req: Request, res: Response) => {
  try {
    const videoUrl = String(req.body?.video_url || '').trim();
    if (!videoUrl) return res.status(400).json({ error: 'video_url obrigatório' });
    const r = await roteirizarUpload(videoUrl, req.body?.apresentador);
    if (r && (r as any).erro) return res.json({ ok: true, roteiro: null, motivo: (r as any).erro });
    res.json({ ok: true, roteiro: r });
  } catch (err: any) {
    logger.error('gerador', 'social/roteirizar-upload falhou', err);
    res.status(500).json({ error: 'IA failed', detail: String(err?.message || err) });
  }
});

// Estúdio: varredura de virais (Ad Library) — STUB até a Meta liberar.
router.post('/social/varrer', async (_req: Request, res: Response) => {
  res.json(await varrerAdLibrary());
});

// Estúdio: gerar vídeo com avatar (HeyGen) — STUB até configurar HeyGen.
router.post('/social/gerar-video', async (req: Request, res: Response) => {
  res.json(await gerarVideoAvatar(String(req.body?.roteiro || '')));
});

// Máquina 2: TOP 1 produto viral do dia → roteiro → dispara vídeo automático no
// Higgsfield (sem aprovação). Disparável manual (botão) e pelo cron (8h30 BRT).
router.post('/social/produtos-virais', async (_req: Request, res: Response) => {
  try {
    const r = await gerarProdutosVirais();
    res.json({ ok: true, ...r });
  } catch (err: any) {
    logger.error('gerador', 'produtos-virais falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

// Webhook do Higgsfield: chamado por eles quando o vídeo fica pronto. Responde
// 200 rápido. A função casa pelo request_id e só toca linha existente (defesa
// contra POST externo). Não tem auth pesada de propósito (Higgsfield não assina).
router.post('/social/higgsfield-webhook', async (req: Request, res: Response) => {
  try {
    const r = await processarWebhook(req.body || {});
    res.json({ ok: r.ok });
  } catch (err: any) {
    logger.error('gerador', 'higgsfield-webhook falhou', err);
    res.status(200).json({ ok: false }); // 200 mesmo no erro: não queremos retry agressivo
  }
});

// Reconcilia o status do vídeo de um produto consultando o Higgsfield (GET status,
// grátis). Caminho principal — o webhook do Higgsfield não dispara sozinho. O front
// chama isso a cada 20s enquanto a linha está 'gerando'.
router.post('/social/produto-status', async (req: Request, res: Response) => {
  try {
    const id = Number(req.body?.id);
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const r = await reconciliarStatusProduto(id);
    res.json(r);
  } catch (err: any) {
    logger.error('gerador', 'produto-status falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

// Anima o criativo (imagem→vídeo Kling) de uma linha de produto — botão "Animar".
// Sob demanda: gasta crédito só quando o Thiago clica. Duração = tempo da narração.
router.post('/social/produto-animar', async (req: Request, res: Response) => {
  try {
    const id = Number(req.body?.id);
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const r = await animarProduto(id);
    res.json(r);
  } catch (err: any) {
    logger.error('gerador', 'produto-animar falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

// Re-dispara o vídeo de uma linha de produto (botão "Tentar de novo" no front).
router.post('/social/produto-regerar', async (req: Request, res: Response) => {
  try {
    const id = Number(req.body?.id);
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const r = await redispararVideoProduto(id);
    res.json({ ...r });
  } catch (err: any) {
    logger.error('gerador', 'produto-regerar falhou', err);
    res.status(500).json({ error: 'falhou', detail: String(err?.message || err) });
  }
});

// Prospecção: o consultor descreve a lista em português e a IA monta a busca.
// NÃO dispara nada e NÃO gasta na Apify: devolve um plano que a tela preenche no
// formulário pro humano conferir. O gasto continua atrás do motor e dos tetos.
router.post('/prospeccao/montar', async (req: Request, res: Response) => {
  try {
    const plano = await montarBusca(String(req.body?.brief || ''));
    res.json({ ok: true, plano });
  } catch (err: any) {
    const msg = String(err?.message || err);
    logger.warn('gerador', 'prospeccao/montar falhou', msg);
    res.status(400).json({ error: msg });
  }
});

// Prospecção: "kick" da busca de lead, pra tela não esperar até 5 min pelo cron.
// Não decide nada nem recebe parâmetro: só roda o MESMO tick que o cron rodaria,
// e o tick lê o pedido que já está no Supabase. Todas as travas de gasto
// (kill-switch, cap por busca, cap por dia, fail-closed sem APIFY_TOKEN) vivem
// dentro do motor — este endpoint não consegue passar por cima de nenhuma.
router.post('/prospeccao/kick', async (_req: Request, res: Response) => {
  try {
    const result = await runProspeccaoApifyTick();
    res.json(result);
  } catch (err: any) {
    logger.error('gerador', 'prospeccao/kick falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// Central das Agentes: estado, volume e conversão de cada robô da casa, numa
// resposta só. Público como o resto do /gerador — por isso o serviço devolve
// AGREGADO, nunca telefone, nome de cliente ou texto de conversa.
router.get('/agentes', async (_req: Request, res: Response) => {
  try {
    res.json(await montarCentralAgentes());
  } catch (err: any) {
    logger.error('gerador', 'central de agentes falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// ── Cérebro das agentes ─────────────────────────────────────────────────────
// LER é público como o resto do /gerador. ESCREVER e CONVERSAR exigem token: um
// muda o que a agente vai falar com cliente de verdade, o outro gasta crédito de
// IA. Sem CENTRAL_AGENTES_TOKEN configurado, os dois ficam FECHADOS — o painel
// mostra o motivo em vez de abrir a porta.
function tokenDaCentral(req: Request, res: Response): boolean {
  const esperado = (process.env.CENTRAL_AGENTES_TOKEN || '').trim();
  if (!esperado) {
    res.status(503).json({ error: 'CENTRAL_AGENTES_TOKEN não configurado na Vercel — edição desligada' });
    return false;
  }
  const veio = String(req.headers['x-central-token'] || '').trim();
  if (veio !== esperado) { res.status(401).json({ error: 'token da central inválido' }); return false; }
  return true;
}

router.get('/agentes/cerebros', async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, cerebros: await listarCerebros() });
  } catch (err: any) {
    logger.error('gerador', 'listar cérebros falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

router.put('/agentes/cerebro/:id', async (req: Request, res: Response) => {
  if (!tokenDaCentral(req, res)) return;
  const id = String(req.params.id);
  if (!ehCerebroValido(id)) { res.status(404).json({ error: 'agente sem cérebro editável' }); return; }
  try {
    await salvarCerebro(id, String(req.body?.texto || ''), 'central');
    res.json({ ok: true, cerebros: await listarCerebros() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.delete('/agentes/cerebro/:id', async (req: Request, res: Response) => {
  if (!tokenDaCentral(req, res)) return;
  const id = String(req.params.id);
  if (!ehCerebroValido(id)) { res.status(404).json({ error: 'agente sem cérebro editável' }); return; }
  try {
    await restaurarCerebro(id);
    res.json({ ok: true, cerebros: await listarCerebros() });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Conversa de TESTE: roda o cérebro vigente (ou o rascunho que está na tela) e
// devolve a resposta. Nada daqui sai no WhatsApp de ninguém.
router.post('/agentes/conversar/:id', async (req: Request, res: Response) => {
  if (!tokenDaCentral(req, res)) return;
  const id = String(req.params.id);
  if (!ehCerebroValido(id)) { res.status(404).json({ error: 'agente sem conversa de teste' }); return; }
  try {
    const mensagens = Array.isArray(req.body?.mensagens) ? req.body.mensagens : [];
    const resposta = await conversarComAgente(id, mensagens, req.body?.rascunho);
    res.json({ ok: true, resposta });
  } catch (err: any) {
    logger.error('gerador', `conversa de teste com ${id} falhou`, err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// ── COBRANÇAS (Asaas) ────────────────────────────────────────────────────────
// Estes endpoints CRIAM COBRANÇA DE VERDADE e devolvem nome, documento e valor
// de cliente. O resto do /gerador é aberto de propósito (a Central devolve só
// agregado, a Prospecção não gasta nada), mas aqui o mesmo desenho seria um
// criador de cobranças na internet pública e uma lista de CPF aberta.
//
// Token PRÓPRIO, separado do da Central: quem edita o texto de um robô não é
// necessariamente quem pode movimentar a conta. Fail-closed — sem a variável na
// Vercel o app inteiro responde 503, que é o estado seguro de nascer.
function tokenDeCobranca(req: Request, res: Response): boolean {
  const esperado = (process.env.COBRANCA_TOKEN || '').trim();
  if (!esperado) {
    res.status(503).json({ error: 'COBRANCA_TOKEN não configurado na Vercel — o app de cobranças está desligado' });
    return false;
  }
  const veio = String(req.headers['x-cobranca-token'] || '').trim();
  if (veio !== esperado) { res.status(401).json({ error: 'senha do app de cobranças inválida' }); return false; }
  return true;
}

// Taxas vigentes + ambiente. A tela pinta o cabeçalho de vermelho quando é
// sandbox, e o ambiente viaja em TODA resposta — nunca só nesta — pra uma tela
// em cache não conseguir dizer "produção" enquanto o servidor está em teste.
router.get('/cobranca/taxas', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const taxas = await buscarTaxas(String(req.query.forcar || '') === '1');
    res.json({ ok: true, ambiente: taxas.ambiente, taxas });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Texto livre → plano preenchido + prévia do dinheiro. NÃO cria nada.
router.post('/cobranca/montar', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const plano = await montarPlanoCobranca(String(req.body?.texto || ''));
    const previa = await calcularPrevia(plano);
    res.json({ ok: true, ambiente: ambienteAsaas(), plano, previa });
  } catch (err: any) {
    logger.warn('gerador', 'cobranca/montar falhou', String(err?.message || err));
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// Recalcula a prévia quando o humano mexe num campo na tela. Também não cria nada.
router.post('/cobranca/simular', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const plano = sanearPlano(req.body?.plano);
    const previa = await calcularPrevia(plano);
    res.json({ ok: true, ambiente: ambienteAsaas(), plano, previa });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// O único endpoint que gasta: cria a cobrança no Asaas. Recebe o plano JÁ
// conferido na tela e passa pelo mesmo saneamento — a tela é conveniência, não
// autoridade.
router.post('/cobranca/criar', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const plano = sanearPlano(req.body?.plano);
    const criada = await criarCobranca(plano);
    res.json({ ok: true, ambiente: criada.ambiente, cobranca: criada });
  } catch (err: any) {
    logger.error('gerador', 'cobranca/criar falhou', err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.get('/cobranca/lista', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    res.json({ ok: true, ambiente: ambienteAsaas(), cobrancas: await listarCobrancas(40) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Simulação da antecipação: o número EXATO, dado pelo Asaas, da cobrança que já
// existe. É o que a tela mostra antes de perguntar "confirma?".
router.post('/cobranca/antecipar/simular', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const s = await simularAntecipacao(String(req.body?.id || ''), String(req.body?.tipo || 'avulsa'));
    res.json({ ok: true, ambiente: ambienteAsaas(), simulacao: s });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

router.post('/cobranca/antecipar', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  try {
    const r = await pedirAntecipacao(String(req.body?.id || ''), String(req.body?.tipo || 'avulsa'));
    res.json({ ok: true, ambiente: ambienteAsaas(), antecipacao: r });
  } catch (err: any) {
    logger.error('gerador', 'cobranca/antecipar falhou', err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

export default router;
