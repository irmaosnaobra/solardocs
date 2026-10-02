import express, { Router, Request, Response } from 'express';
import { generateGeradorPdf } from '../controllers/pdfGeradorController';
import { montarApresentacao } from '../controllers/apresentacaoController';
import { extrairApresentacao } from '../controllers/apresentacaoExtrair';
import { trackEvent } from '../controllers/trackingGeradorController';
import { gerarIdeiasSociais, roteirizarTema, roteirizarUpload } from '../services/agenda/socialIdeiasService';
import { varrerAdLibrary, gerarVideoAvatar } from '../services/agenda/socialStudioStubs';
import { gerarProdutosVirais, redispararVideoProduto } from '../services/agenda/produtosViraisService';
import { processarWebhook, reconciliarStatusProduto, animarProduto } from '../services/agenda/higgsfieldService';
import { ingestManychatLead } from '../services/agenda/manychatLeadService';
import { runGeradorBroadcastTick } from '../services/io/geradorAutomacaoService';
import { runAvisosTick, respostasDaPauta, audienciaDoAviso, LADOS_AVISO } from '../services/io/avisosTickService';
import { runProspeccaoApifyTick } from '../services/io/prospeccaoApifyService';
import { montarBusca } from '../services/io/prospeccaoBriefService';
import { montarCentralAgentes } from '../services/io/centralAgentes';
import { decidirResposta, bolhasParaEnvio } from '../services/io/prospeccaoResposta';
import { montarFunil } from '../services/io/prospeccaoFunil';
import { listarCerebros, salvarCerebro, restaurarCerebro, conversarComAgente, ehCerebroValido } from '../services/io/cerebroAgentes';
import {
  calcularPrevia, criarCobranca, listarCobrancas, simularAntecipacao, pedirAntecipacao,
} from '../services/asaas/asaasCobrancas';
import { montarPlanoCobranca, sanearPlano } from '../services/asaas/cobrancaBrief';
import { buscarTaxas, ambienteAsaas } from '../services/asaas/asaasTaxas';
import { TRELLO_BOARD_ID } from '../services/insightsService';
import { buscarCartao } from '../services/gerador/dossieVenda';
import { mountDossie } from './geradorDossie';
import { logger } from '../utils/logger';
import { supabase } from '../utils/supabase';
// A sala de espera do card mora no `system_state`, e o prefixo sai do módulo
// que LÊ ele: quem escreve e quem lê têm que concordar na chave.
import { APALAVRADO_PREFIX } from '../services/io/lembreteFollowupService';
// A etiqueta preservada e a lista do que vale guardar moram no modulo NEUTRO da
// sala de espera, junto da leitura do prazo: e tudo marca do mesmo card.
import {
  ETIQUETA_PREFIX, ETIQUETAS_DE_NEGOCIO, MOTIVO_PREFIX, MOTIVOS_DO_NAO,
} from '../services/agenda/salaDeEspera';
import { EP_MUDO_PREFIX } from '../services/io/eletropostoReagendaAuto';
// O bloqueio mora no MESMO lugar do opt-out (`whatsapp_suppression`), e nao numa
// lista nova: tres listas de 'nao fale com essa pessoa' foi exatamente o defeito
// que o silenciar.ts foi escrito pra acabar, em 31/08/2026.
import {
  silenciarContato, desbloquearContato, listarBloqueados, chaveContato,
  MOTIVO_FORA_DO_PADRAO,
} from '../services/agents/whatsapp/silenciar';
// DOIS BANCOS, e eles nao tem as mesmas tabelas. `system_state` mora no Supabase
// PRINCIPAL (o `supabase` acima); `agendamentos` mora no do GERADOR. Trocar um
// pelo outro compila liso e devolve 500 em producao: "Could not find the table
// 'public.agendamentos' in the schema cache". Foi o que aconteceu com o placar
// em 02/10/2026, e so apareceu porque a sonda ESCREVEU uma marca antes de ler —
// com zero marcas o laco nao roda e a rota devolve 200 feliz.
import { supabaseGerador } from '../utils/supabaseGerador';

const router = Router();

// PDF público de proposta do Gerador IO. Rate-limit global já cobre — chamada
// é pesada (Puppeteer), mas controller verifica existência da proposta antes
// de levantar o browser.
router.get('/pdf/:codigo', generateGeradorPdf);

// Monta a apresentação de projeto (21 páginas, padrão da casa) a partir dos
// parâmetros do Simulador + orçamentos + fotos com legenda. O corpo carrega
// imagens em base64, então tem limite próprio, maior que o 10mb global.
router.post('/apresentacao', express.json({ limit: '40mb' }), montarApresentacao);

// Le os anexos e devolve os campos para o formulario. Separado da montagem de
// proposito: leitura errada nao pode custar um render inteiro para aparecer.
router.post('/apresentacao/extrair', express.json({ limit: '40mb' }), extrairApresentacao);

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

// Menu de Avisos: mesmo "kick" opcional, pro primeiro contato da pauta sair na
// hora em vez de esperar o cron de 5 min. Um tick = UM envio, e ele passa por
// todas as travas do motor (janela diurna, espaçamento e teto da linha,
// supressão, piso de dias, kill-switch AVISOS_OFF). No pior caso faz o que o
// cron faria daqui a pouco, então não precisa de auth própria.
router.post('/avisos/kick', async (req: Request, res: Response) => {
  try {
    // ?dry=1 é o que a tela usa pra dizer POR QUE a fila não anda (fora da
    // janela, outro robô acabou de mandar, teto do dia). Anda o caminho inteiro
    // e para antes de enviar, então serve de status sem gastar mensagem.
    res.json({ ok: true, ...(await runAvisosTick({ dry: req.query.dry === '1' })) });
  } catch (err: any) {
    logger.error('gerador', 'avisos/kick falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// QUANTOS RECEBERIAM, pela conta do SERVIDOR. A tela conta com a regra gêmea
// dela; este número é o que o motor de fato vai usar (telefone válido, sem
// sem_interesse, cada pessoa uma vez), e é como se confere que as duas batem sem
// criar pauta nenhuma. Devolve só números: nenhum nome, nenhum telefone.
router.get('/avisos/audiencia', async (req: Request, res: Response) => {
  const pedidos = String(req.query.publicos || '').split(',').map(p => p.trim())
    .filter(p => (LADOS_AVISO as readonly string[]).includes(p));
  if (!pedidos.length) { res.status(400).json({ error: 'publicos invalido' }); return; }
  try {
    const por_publico: Record<string, number> = {};
    for (const p of pedidos) por_publico[p] = (await audienciaDoAviso([p])).length;
    res.json({ ok: true, total: (await audienciaDoAviso(pedidos)).length, por_publico });
  } catch (err: any) {
    logger.error('gerador', 'avisos/audiencia falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// QUEM RESPONDEU A PAUTA. A tela não consegue responder isso sozinha: os envios
// ficam no banco do gerador e a conversa fica no banco da linha, e o navegador
// só alcança o primeiro. Então a junção é aqui.
//
// É o número que faltava. Entregues, faltam e previsão dizem se a fila anda;
// nenhum deles diz se a oportunidade encontrou alguém.
router.get('/avisos/respostas', async (req: Request, res: Response) => {
  const avisoId = String(req.query.aviso_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(avisoId)) { res.status(400).json({ error: 'aviso_id invalido' }); return; }
  try {
    res.json({ ok: true, ...(await respostasDaPauta(avisoId)) });
  } catch (err: any) {
    logger.error('gerador', 'avisos/respostas falhou', err);
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

// ── A SALA DE ESPERA DO CARD (`apalavrado`, 30/09/2026) ─────────────────────
//
// Ordem do Thiago: "quando a pessoa vai arrendar, a gente tem que concluir com
// ela... entre o perdido e o vendido vai ter aquela margem da pessoa que está em
// stand-by, que a gente está negociando alguma forma de fechamento. Ela é uma
// pessoa que não fica recebendo mais mensagem."
//
// O STATUS mora no banco do gerador (o CRM grava direto, por `supaPatch`). O que
// mora AQUI é a espera: o que estamos aguardando e a data de voltar. Vai pro
// `system_state` do Supabase principal, e não numa coluna nova de
// `agendamentos`, por um motivo prático: coluna nova exige migration, migration
// neste projeto bate em produção sem staging, e um `supaPatch` numa coluna que
// não existe derruba o próprio botão. O `system_state` já é onde a máquina de
// lembrete guarda o resto do estado dela, e ela é quem lê isto.
//
// Sem token, como os outros POSTs de `/gerador` que a tela chama pelo rewrite
// `/_api/*`. O que protege é o formato, não a senha: só a chave
// `apalavrado:<id numérico>` pode ser escrita, e a data é limitada a 1 ano. O pior
// caso de abuso é calar um card por um ano, que qualquer consultor desfaz
// apertando outro status.
const APALAVRADO_MIN_TEXTO = 20;

// ── "VOLTA CALADA E O CONSULTOR TENTA UM CONTATO" ──────────────────────────
//
// Regra do Thiago (01/10/2026): "quando a pessoa confirma e não é atendida,
// pode piorar a situação; nesses casos volta calada e o consultor tenta um
// contato".
//
// Marcar uma ficha como MUDA é dizer que ela voltou pra agenda sem ninguém ter
// avisado o cliente. Duas coisas leem essa marca: a régua do SIM
// (`eletropostoCobraSim`) não cobra nem libera o horário dela, e a confirmação
// padrão da agenda já está calada pelo `confirmacao_at`.
//
// Sem esta rota a marca só nascia dentro do robô. Ela existe porque as 14
// fichas que o robô moveu em 01/10 foram canceladas antes da correção, e
// devolvê-las exige marcar o que já está no banco. Fica como ferramenta: toda
// vez que um card voltar pra agenda sem o cliente saber, é aqui que se diz isso.
//
// Sem token, como os outros POSTs de `/gerador`. O que protege é o formato: só
// `ep_mudo:<id numérico>`, e o pior caso de abuso é uma ficha deixar de ser
// cobrada — nunca uma mensagem a mais pra cliente.
router.post('/mudo', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }

  // O horário é obrigatório e a marca vale SÓ pra ele: se a ficha for remarcada
  // depois por outro caminho, a marca deixa de casar e a régua do SIM volta a
  // valer, porque aí houve confirmação de verdade.
  const quandoCru = String(b.quando || '').trim();
  const quando = new Date(quandoCru);
  if (!quandoCru || !Number.isFinite(quando.getTime())) {
    res.status(400).json({ error: 'quando (ISO do horário da reunião) é obrigatório' });
    return;
  }

  const agoraIso = new Date().toISOString();
  try {
    const { error } = await supabase.from('system_state').upsert(
      {
        key: `${EP_MUDO_PREFIX}${id}`,
        value: { quando: quando.toISOString(), em: agoraIso, por: String(b.por || '').trim().slice(0, 60) },
        updated_at: agoraIso,
      },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true, id, quando: quando.toISOString() });
  } catch (err: any) {
    logger.error('gerador', 'marcar ficha muda falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

router.post('/apalavrado', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }

  // ── O TEXTO É OBRIGATÓRIO, 20 CARACTERES (ordem do Thiago, 30/09/2026) ────
  // "a partir do momento que a pessoa clicar apalavrado, ele tem que colocar um
  // texto de pelo menos 20 caracteres informando sobre o que que é".
  //
  // A trava vive AQUI e não só na tela. Validação de tela é conveniência: ela
  // cai com PWA em cache velho, com aba aberta desde ontem, e com qualquer um
  // que chame a rota direto. A regra que só existe no navegador não é regra.
  const aguardando = String(b.aguardando || '').trim().slice(0, 400);
  if (aguardando.length < APALAVRADO_MIN_TEXTO) {
    res.status(400).json({
      error: `escreva pelo menos ${APALAVRADO_MIN_TEXTO} caracteres dizendo o que está esperando`,
      minimo: APALAVRADO_MIN_TEXTO, recebido: aguardando.length,
    });
    return;
  }

  // ── A DATA TAMBÉM É OBRIGATÓRIA, e quem digita é o consultor ──────────────
  // Mesma ordem: "um botão também de reagendamento, pra pessoa marcar ali, ele
  // mesmo digitar, pra essa pessoa no apalavrado não sumir da vida".
  //
  // Aceita `retomar_em` (a data digitada, que é o caminho da tela) ou `dias`
  // (atalho). Sem nenhum dos dois, recusa: espera sem data é a gaveta que este
  // status existe pra não ser.
  const agora = new Date();
  const TETO_MS = 365 * 86400_000;
  let retomar: Date | null = null;

  const cru = String(b.retomar_em || '').trim();
  if (cru) {
    // Data pura ("2026-11-20") vira meio-dia de Brasília: 00:00 num fuso a
    // oeste cai no dia anterior, e a espera venceria um dia antes do combinado.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(cru) ? `${cru}T12:00:00-03:00` : cru;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) { res.status(400).json({ error: 'data inválida' }); return; }
    retomar = d;
  } else {
    const diasCru = Number(b.dias);
    if (!Number.isFinite(diasCru) || diasCru < 1) {
      res.status(400).json({ error: 'diga até quando esperar (retomar_em ou dias)' });
      return;
    }
    retomar = new Date(agora.getTime() + Math.round(diasCru) * 86400_000);
  }

  if (retomar.getTime() <= agora.getTime()) {
    res.status(400).json({ error: 'a data de retomar tem que ser no futuro' });
    return;
  }
  if (retomar.getTime() > agora.getTime() + TETO_MS) {
    res.status(400).json({ error: 'no máximo 1 ano de espera' });
    return;
  }

  const dias = Math.round((retomar.getTime() - agora.getTime()) / 86400_000);
  const por = String(b.por || '').trim().slice(0, 60);

  try {
    const { error } = await supabase.from('system_state').upsert(
      {
        key: `${APALAVRADO_PREFIX}${id}`,
        value: { aguardando, retomar_em: retomar.toISOString(), por, em: agora.toISOString() },
        updated_at: agora.toISOString(),
      },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true, id, dias, retomar_em: retomar.toISOString(), aguardando });
  } catch (err: any) {
    logger.error('gerador', 'apalavrado falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// ── SOLTAR = SAIR DA ESPERA **E** ZERAR A ESCADA (01/10/2026) ───────────────
//
// A tela chama esta rota em TODA troca de status, e é por isso que ela é o lugar
// certo pra zerar a escada da negociação.
//
// A regra do dono é "se manter uma dessas etiquetas, 72hrs": manter é que faz
// subir, então mudar tem que voltar pro degrau 1. Só que o robô enxerga a
// etiqueta apenas nos movimentos DELE, e nos primeiros 48h depois do horário a
// ficha nem é candidata — então `arrendamento` → `chave_na_mao` → `arrendamento`
// dentro dessa janela era invisível pra ele, e o degrau subia como se a etiqueta
// nunca tivesse mudado. Com apalavrado no meio, pior: o card saía da consulta,
// voltava com o degrau congelado e ganhava 144h de silêncio em vez de 48h.
//
// Quem SEMPRE vê a troca é quem a faz. Então o carimbo do ciclo morre aqui,
// junto com o da espera: na próxima varredura a ficha é degrau 1, 48h, que é o
// que a ordem dá a quem acabou de receber sua etiqueta.
//
// Os dois prefixos de ciclo são apagados sem olhar o produto: uma ficha é de
// eletroposto OU de solar, a outra chave simplesmente não existe, e `delete` em
// chave inexistente não é erro. Perguntar a origem antes seria uma consulta a
// mais pra decidir nada.
router.post('/apalavrado/soltar', async (req: Request, res: Response) => {
  const id = Number((req.body || {}).id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }
  try {
    // A MARCA DA ESPERA MORRE INTEIRA. Ela é só sala de espera.
    const { error } = await supabase.from('system_state')
      .delete().eq('key', `${APALAVRADO_PREFIX}${id}`);
    if (error) throw error;

    // ── O CARIMBO DO CICLO NÃO: ELE GUARDA TRÊS COISAS ──────────────────
    //
    // Esta rota apagava `ep_reagenda_auto:<id>` e `solar_reagenda:<id>` INTEIROS
    // pra zerar a escada. Só que o mesmo valor guarda:
    //   `degrau`  a escada (é o que a gente quer zerar)
    //   `status`  a etiqueta da última volta (idem)
    //   `n`       quantas voltas o VERMELHO já deu  <-- NÃO
    //   `relogio` qual das duas rampas ele gastou   <-- NÃO
    //
    // `n` é o ÚNICO teto do caminho que manda mensagem (3 voltas). Apagar o
    // carimbo zerava esse teto, e as duas telas chamam esta rota em TODA troca
    // de status — inclusive apertar NÃO ATENDEU de novo, que é o movimento
    // normal de quem acabou de ligar e não foi atendido. Resultado: um card que
    // já tomou as três mensagens "você não conseguiu entrar na apresentação"
    // ganhava mais três a cada toque, numa linha que caiu 3 vezes em 7 dias.
    //
    // O próprio código já tinha chamado esse desfecho de defeito hoje de manhã,
    // num comentário sobre outra causa: "o teto de 3 voltas do vermelho também —
    // liberando mais um 'você não conseguiu entrar na apresentação' pra quem já
    // tinha recebido três". Era o mesmo estrago, por outra porta.
    //
    // Agora só a ESCADA é zerada: lê o carimbo e reescreve sem `status` e sem
    // `degrau`. Carimbo que não existe não é criado — card que nunca voltou não
    // tem escada pra zerar.
    const chaves = [`ep_reagenda_auto:${id}`, `solar_reagenda:${id}`];
    const { data: carimbos, error: erroLer } = await supabase
      .from('system_state').select('key, value').in('key', chaves);
    if (erroLer) throw erroLer;
    let escadaZerada = 0;
    for (const c of carimbos ?? []) {
      const v = { ...((c.value ?? {}) as Record<string, unknown>) };
      if (v.status === undefined && v.degrau === undefined) continue;
      delete v.status;
      delete v.degrau;
      const { error: erroGravar } = await supabase.from('system_state').upsert(
        { key: String(c.key), value: v, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
      if (erroGravar) throw erroGravar;
      escadaZerada++;
    }
    res.json({ ok: true, id, soltou: true, escadaZerada });
  } catch (err: any) {
    logger.error('gerador', 'apalavrado/soltar falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// A tela precisa MOSTRAR a espera no card ("esperando o investidor · volta
// 30/10"), senão a sala de espera é invisível e vira o cemitério que ela existe
// pra não ser. Leitura em lote: o CRM desenha 300 cards de uma vez.
router.get('/apalavrado', async (req: Request, res: Response) => {
  // ── CORTE SILENCIOSO, DE NOVO ────────────────────────────────────────────
  //
  // Eram 500, e o quadro do CRM pede marca pra 831 fichas: 331 cards ficavam
  // sem o selo da espera E sem a etiqueta guardada, e — pior — um card
  // apalavrado além do 500 caía na COLUNA ERRADA, porque a coluna sai da marca.
  // Nada no retorno dizia que tinha sido cortado.
  //
  // Agora o teto é 1000 (o PostgREST corta aí de qualquer jeito) e o corte, se
  // acontecer, VEM NA RESPOSTA. A tela também passou a pedir em lotes.
  const pedidos = String(req.query.ids || '').split(',')
    .map(n => Number(n.trim())).filter(n => Number.isInteger(n) && n > 0);
  const TETO_IDS = 1000;
  const ids = pedidos.slice(0, TETO_IDS);
  const cortou = pedidos.length - ids.length;
  if (cortou) {
    logger.warn('gerador', `leitura de marcas cortada: pediram ${pedidos.length} ids, o teto é ${TETO_IDS}`);
  }
  if (!ids.length) { res.json({ ok: true, esperas: {}, etiquetas: {}, motivos: {} }); return; }
  try {
    // AS DUAS MARCAS NA MESMA CHAMADA. Separar em duas rotas dobraria a ida e
    // volta num quadro que desenha 300 cards, e as duas são lidas sempre juntas:
    // o card precisa saber se está em espera E qual era a etiqueta dele.
    // ── FATIADO POR DENTRO, porque a URL estoura antes do teto ─────────────
    //
    // Cada id vira DUAS chaves no `.in()`, e o PostgREST recebe tudo isso na
    // URL. Medido em producao: 600 ids passam, 700 devolvem Bad Request. Subir
    // o teto pra 1000 sem fatiar foi trocar um corte silencioso por um erro
    // 500 — pior, porque o quadro inteiro fica sem marca nenhuma.
    //
    // Fatiar aqui e nao na tela e de proposito: quem chama nao tem como saber
    // que o limite e de CARACTERES e nao de ids, e a proxima tela a usar esta
    // rota ia descobrir do mesmo jeito que eu descobri.
    // 150 e nao 200 desde 02/10/2026: cada id virou TRES chaves quando o motivo
    // do nao entrou, e 200 ids passariam a ser 600 chaves numa URL. 700 ids (1400
    // chaves) foi o que devolveu Bad Request na medicao; 450 segue com folga, e
    // mais uma ida e volta num quadro de 300 cards custa menos que o quadro
    // inteiro ficar sem marca.
    const POR_CONSULTA = 150;   // 450 chaves
    const linhas: Array<{ key: string; value: unknown }> = [];
    for (let i = 0; i < ids.length; i += POR_CONSULTA) {
      const lote = ids.slice(i, i + POR_CONSULTA);
      const { data: parte, error } = await supabase.from('system_state')
        .select('key, value')
        .in('key', [
          ...lote.map(x => `${APALAVRADO_PREFIX}${x}`),
          ...lote.map(x => `${ETIQUETA_PREFIX}${x}`),
          ...lote.map(x => `${MOTIVO_PREFIX}${x}`),
        ]);
      if (error) throw error;
      linhas.push(...((parte ?? []) as Array<{ key: string; value: unknown }>));
    }
    const data = linhas;
    const esperas: Record<string, unknown> = {};
    const etiquetas: Record<string, string> = {};
    const motivos: Record<string, string> = {};
    // A ORDEM AQUI É O QUE IMPEDE A MARCA ERRADA. O ramo da espera era um `else`
    // pega-tudo, e com uma terceira chave ele passaria a engolir o motivo: o card
    // apareceria em sala de espera por ter dito não. Então cada prefixo é testado
    // explícito e a espera é a última, não o resto.
    for (const l of data ?? []) {
      const k = String(l.key);
      if (k.startsWith(ETIQUETA_PREFIX)) {
        const et = String((l.value as { etiqueta?: string } | null)?.etiqueta ?? '').trim();
        if (et) etiquetas[k.slice(ETIQUETA_PREFIX.length)] = et;
      } else if (k.startsWith(MOTIVO_PREFIX)) {
        const mo = String((l.value as { motivo?: string } | null)?.motivo ?? '').trim();
        if (mo) motivos[k.slice(MOTIVO_PREFIX.length)] = mo;
      } else if (k.startsWith(APALAVRADO_PREFIX)) {
        esperas[k.slice(APALAVRADO_PREFIX.length)] = l.value;
      }
    }
    res.json({ ok: true, esperas, etiquetas, motivos, ...(cortou ? { cortou } : {}) });
  } catch (err: any) {
    logger.error('gerador', 'apalavrado (leitura) falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// ── GUARDA A ETIQUETA QUE O STATUS TERMINAL VAI APAGAR ──────────────────────
//
// A tela chama isto ANTES de gravar `sem_interesse` / `fechou` / `cancelado` /
// `perdido` / `fechou_concorrente`, mandando a etiqueta que está saindo. Depois
// o card mostra as duas: "ARRENDAMENTO · SEM INTERESSE".
//
// `etiqueta` vazia APAGA a marca, e é o caminho de volta: card que sai do
// terminal pra uma etiqueta de negociação volta a carregar ela no próprio
// status, e aí a marca seria uma segunda pílula dizendo a mesma coisa.
//
// A allowlist mora no módulo da sala de espera e é checada AQUI, no servidor: a
// rota é pública (chega pelo rewrite `/_api/*`), então sem ela isto seria um
// campo de texto livre dentro do `system_state`.
router.post('/etiqueta', async (req: Request, res: Response) => {
  const b = (req.body || {}) as { id?: unknown; etiqueta?: unknown; por?: unknown };
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }
  const etiqueta = String(b.etiqueta ?? '').trim();
  if (etiqueta && !ETIQUETAS_DE_NEGOCIO.has(etiqueta)) {
    res.status(400).json({ error: 'etiqueta desconhecida', etiqueta });
    return;
  }
  try {
    const chave = `${ETIQUETA_PREFIX}${id}`;
    if (!etiqueta) {
      const { error } = await supabase.from('system_state').delete().eq('key', chave);
      if (error) throw error;
      res.json({ ok: true, id, apagou: true });
      return;
    }
    const agora = new Date().toISOString();
    const { error } = await supabase.from('system_state').upsert(
      {
        key: chave,
        value: { etiqueta, em: agora, por: String(b.por ?? '').slice(0, 60) },
        updated_at: agora,
      },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true, id, etiqueta });
  } catch (err: any) {
    logger.error('gerador', 'etiqueta falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// ── O MOTIVO DO NÃO (02/10/2026) ──────────────────────────────────────────
//
// Gêmea da `/etiqueta`, e de propósito: mesmo formato de marca, mesma allowlist
// fechada, mesmo degrade. A diferença é o que ela responde — 498 cards de solar
// param em SEM INTERESSE e nenhum diz por quê.
//
// Degrada, não quebra: se isto falhar, o status terminal já foi gravado pela tela
// e o card fica sem o motivo. O contrário (recusar o status porque o motivo não
// gravou) deixaria o robô falando com quem já disse não.
router.post('/motivo', async (req: Request, res: Response) => {
  const b = (req.body || {}) as { id?: unknown; motivo?: unknown; por?: unknown };
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }
  const motivo = String(b.motivo ?? '').trim();
  if (motivo && !MOTIVOS_DO_NAO.has(motivo)) {
    res.status(400).json({ error: 'motivo desconhecido', motivo });
    return;
  }
  try {
    const chave = `${MOTIVO_PREFIX}${id}`;
    if (!motivo) {
      const { error } = await supabase.from('system_state').delete().eq('key', chave);
      if (error) throw error;
      res.json({ ok: true, id, apagou: true });
      return;
    }
    const agora = new Date().toISOString();
    const { error } = await supabase.from('system_state').upsert(
      {
        key: chave,
        value: { motivo, em: agora, por: String(b.por ?? '').slice(0, 60) },
        updated_at: agora,
      },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true, id, motivo });
  } catch (err: any) {
    logger.error('gerador', 'motivo falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// O PLACAR DO NÃO. Sem este endpoint a opção B não paga nada: gravar o motivo e
// não ter onde ver a conta é guardar dado pra ninguém. Cruza a marca com a ficha
// pra separar solar de eletroposto, porque o mesmo motivo pesa diferente nos dois.
router.get('/motivos/placar', async (_req: Request, res: Response) => {
  try {
    // As marcas primeiro. São poucas por natureza (uma por card que disse não),
    // mas pagino por range de propósito: o PostgREST corta em 1000 e ignora o
    // `.limit()`, e um placar truncado mente pra baixo sem avisar.
    const marcas: Array<{ key: string; value: unknown }> = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from('system_state')
        .select('key, value')
        .like('key', `${MOTIVO_PREFIX}%`)
        .range(de, de + 999);
      if (error) throw error;
      const parte = (data ?? []) as Array<{ key: string; value: unknown }>;
      marcas.push(...parte);
      if (parte.length < 1000) break;
    }
    const porId = new Map<number, string>();
    for (const m of marcas) {
      const id = Number(String(m.key).slice(MOTIVO_PREFIX.length));
      const mo = String((m.value as { motivo?: string } | null)?.motivo ?? '').trim();
      if (Number.isInteger(id) && mo) porId.set(id, mo);
    }
    const ids = [...porId.keys()];
    // O produto sai do `created_by` da ficha: eletroposto é a família NOMEADA, o
    // resto é solar — e o resto INCLUI `created_by` nulo, que é cadastro à mão.
    const fichas = new Map<number, string>();
    for (let i = 0; i < ids.length; i += 200) {
      // `supabaseGerador`, NAO `supabase`: ver o comentario do import.
      const { data, error } = await supabaseGerador.from('agendamentos')
        .select('id, created_by').in('id', ids.slice(i, i + 200));
      if (error) throw error;
      for (const f of (data ?? []) as Array<{ id: number; created_by: string | null }>) {
        fichas.set(f.id, String(f.created_by ?? '').toLowerCase().includes('eletroposto')
          ? 'eletroposto' : 'solar');
      }
    }
    const placar: Record<string, Record<string, number>> = { solar: {}, eletroposto: {} };
    let semFicha = 0;
    for (const [id, mo] of porId) {
      const prod = fichas.get(id);
      if (!prod) { semFicha++; continue; }
      placar[prod][mo] = (placar[prod][mo] || 0) + 1;
    }
    res.json({
      ok: true,
      total: porId.size,
      placar,
      // Ficha apagada depois de a marca ser escrita. Vem na resposta porque
      // placar que não conta o que perdeu é placar que mente.
      ...(semFicha ? { semFicha } : {}),
    });
  } catch (err: any) {
    logger.error('gerador', 'placar de motivos falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// ── FORA DO PADRÃO (02/10/2026) ───────────────────────────────────────────
//
// Ordem do dono: "coloque alguma forma que esse cliente fique bloqueado, sem
// condições nenhuma de nenhuma opção, não tem perigo dele aparecer de novo em
// outras formas". E: "de um jeito que fique sem nenhuma etiqueta, apenas FORA DO
// PADRÃO".
//
// O BLOQUEIO É POR TELEFONE, não por card, e isso é o ponto inteiro: bloquear o
// card não impediria uma ficha NOVA do mesmo número de nascer amanhã pela LP.
//
// A chave é a `chaveContato`: DDD + os 8 últimos dígitos. Medido nas 1.230 fichas
// de hoje: 1 telefone não normaliza (14 dígitos), 44 chaves têm mais de uma ficha
// — e dessas, as de nome diferente são o mesmo nome escrito de dois jeitos ("José
// Camargo" e "Jose Camargo", "Léo Borges" e "Leo Borges"). Ou seja: a chave junta
// duplicata, não junta gente diferente.
//
// O QUE ELA NÃO RESOLVE, e é honesto dizer: 81 nomes aparecem com mais de um
// telefone. Bloquear um NÚMERO não bloqueia a PESSOA. Se ele voltar de outro
// número, é um lead novo de verdade — e aí a decisão é de gente outra vez.
router.post('/bloquear', async (req: Request, res: Response) => {
  const b = (req.body || {}) as { telefone?: unknown; id?: unknown; por?: unknown };
  const telefone = String(b.telefone ?? '').trim();
  const chave = chaveContato(telefone);
  if (!chave) {
    // Recusa FALANDO. Telefone que não normaliza é o caso da ficha da Laura (14
    // dígitos): bloquear "mais ou menos" seria pior que não bloquear, porque a
    // tela diria bloqueado e o robô continuaria falando.
    res.status(400).json({ error: 'telefone não normaliza: não dá pra bloquear com segurança', telefone });
    return;
  }
  try {
    await silenciarContato(telefone, MOTIVO_FORA_DO_PADRAO, String(b.por ?? 'gerador').slice(0, 60));
    res.json({ ok: true, chave });
  } catch (err: any) {
    logger.error('gerador', 'bloquear falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// Desfaz. Clique errado precisa de volta pela TELA: sem isto, marcar por engano
// vira "me chama pra arrumar no banco".
router.post('/desbloquear', async (req: Request, res: Response) => {
  const telefone = String(((req.body || {}) as { telefone?: unknown }).telefone ?? '').trim();
  if (!chaveContato(telefone)) { res.status(400).json({ error: 'telefone inválido' }); return; }
  try {
    await desbloquearContato(telefone);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('gerador', 'desbloquear falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// A LISTA, pra tela conferir sem um select por card. Ela é por CHAVE justamente
// pra uma ficha nova do mesmo número já nascer marcada na tela.
router.get('/bloqueados', async (_req: Request, res: Response) => {
  try {
    const chaves = await listarBloqueados();
    res.json({ ok: true, chaves });
  } catch (err: any) {
    logger.error('gerador', 'listar bloqueados falhou', err);
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
// Prospecção: a CABEÇA. Recebe a conversa e devolve o que responder.
// Não envia nada — quem digita é o worker, no Chrome do consultor. Essa
// separação é o que faz o `--dry` do worker ser honesto: dá pra ver a resposta
// que sairia sem que ninguém receba mensagem.
router.post('/prospeccao/responder', async (req: Request, res: Response) => {
  try {
    const { empresa, cidade, produto_id, historico, contato_id, canal } = req.body || {};
    if (!empresa || !Array.isArray(historico) || !historico.length) {
      res.status(400).json({ error: 'empresa e historico sao obrigatorios' });
      return;
    }
    const v = await decidirResposta({ empresa, cidade, produto_id, historico, contato_id, canal });
    if (!v) { res.status(503).json({ error: 'ia indisponivel' }); return; }
    res.json({ ...v, envio: bolhasParaEnvio(v, contato_id, canal) });
  } catch (err: any) {
    logger.error('gerador', 'prospeccao/responder falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

// Prospecção: o funil ponta a ponta, atravessando os dois bancos.
// Devolve só CONTAGEM — nenhum nome, e-mail ou telefone atravessa a fronteira.
// A tela é pública; `sales` não pode ser.
router.get('/prospeccao/funil', async (req: Request, res: Response) => {
  try {
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 90));
    res.json(await montarFunil(dias));
  } catch (err: any) {
    logger.error('gerador', 'prospeccao/funil falhou', err);
    res.status(500).json({ error: 'falha', detail: String(err?.message || err) });
  }
});

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
//
// COBRANCA_OFF é o kill-switch do trilho, no mesmo formato do PIX_RECORRENTE_OFF:
// trava a CRIAÇÃO e a antecipação sem derrubar a tela nem esconder o histórico.
// Tirar o token faria o app inteiro sumir junto com a lista do que já foi
// cobrado — e num aperto é justamente a lista que se precisa olhar.
function cobrancaDesligada(res: Response): boolean {
  if ((process.env.COBRANCA_OFF || '').toLowerCase() !== 'true') return false;
  res.status(503).json({ error: 'COBRANCA_OFF=true na Vercel — criação de cobrança desligada' });
  return true;
}

router.post('/cobranca/criar', async (req: Request, res: Response) => {
  if (!tokenDeCobranca(req, res)) return;
  if (cobrancaDesligada(res)) return;
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
  if (cobrancaDesligada(res)) return;
  try {
    const r = await pedirAntecipacao(String(req.body?.id || ''), String(req.body?.tipo || 'avulsa'));
    res.json({ ok: true, ambiente: ambienteAsaas(), antecipacao: r });
  } catch (err: any) {
    logger.error('gerador', 'cobranca/antecipar falhou', err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// ── TRELLO (situação do cliente) ─────────────────────────────────────
// A aba Recibo/Contrato mostra em que lista do quadro de homologação o cliente
// está — "DAR ENTRADA", "PROJETO EM ANALISE", "VISTORIA LIBERADA".
//
// A busca do cartão mudou de casa em 30/09/2026: foi pro dossieVenda, porque
// agora o envio de documentos precisa achar EXATAMENTE o mesmo cartão que esta
// aba mostra. Duas cópias da regra de casamento seria a mesma tela dizendo
// "VISTORIA LIBERADA" enquanto o anexo cai em outro cliente.
router.get('/trello', async (req: Request, res: Response) => {
  const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;
  const cliente = String(req.query.cliente || '').trim();
  const num = String(req.query.num || '').replace(/\D/g, '');
  if (!cliente) { res.status(400).json({ error: 'informe o cliente' }); return; }
  try {
    res.json({ ok: true, ...(await buscarCartao(board, cliente, num)) });
  } catch (err: any) {
    logger.warn('gerador', 'trello falhou', String(err?.message || err));
    res.status(502).json({ error: String(err?.message || err) });
  }
});

// ── DOSSIÊ DA VENDA ──────────────────────────────────────────────
// Documentos do cliente VENDIDO: sobem uma vez, ficam em bucket privado, e vão
// pro cartão do Trello como anexo de verdade. O porquê de cada escolha está no
// cabeçalho de services/gerador/dossieVenda.ts.
//
// As rotas de documento exigem a SESSÃO do consultor (o mesmo token que a página
// já manda pro PostgREST). É a única parte do /gerador que exige, e o motivo é o
// conteúdo: elas devolvem signed url de CNH e de conta de luz, e o código da
// proposta é sequencial.
mountDossie(router);

export default router;
