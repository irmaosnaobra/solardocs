import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname, posix } from 'path';
import * as ts from 'typescript';
import { CLASSE_POR_ROBO, CLASSES, Classe } from '../services/chefe/classes';

// ─────────────────────────────────────────────────────────────────────────────
// CHEFE anti-ban — GUARDA ESTÁTICA: ninguém fala com a Z-API nem com o Graph da
// Meta por fora do transporte oficial.
//
// As 4 quedas da linha 5040 (01/08, 04/08, 30/08, 02/10) tiveram o mesmo
// formato: um remetente FORA da conta, ou contado com o carimbo errado, mandando
// em rajada. A de 30/08 foi literalmente uma rota crua (zapi-admin/io/send-text)
// fazendo fetch direto na Z-API, sem teto, sem janela e sem dedup. Esta guarda
// lê o disco e reprova o próximo robô que nascer assim.
//
// O QUE REPROVA (fora da lista de migração abaixo):
//   zapi      fetch ou montagem de URL da Z-API (host api.z-api.io, o molde
//             /instances/${id}/token/${tk}/, ou o cabeçalho Client-Token) fora
//             de api/src/services/agents/zapiClient.ts. Tipos:
//               envio          o caminho é send-* (manda mensagem);
//               caminho_livre  o caminho é variável e o método não é GET
//                              provado (helper genérico que manda o que pedirem);
//               consulta       leitura ou configuração (status, me, chats,
//                              contacts, webhooks). Não manda mensagem: só
//                              precisa estar em CONSULTA_ZAPI, sem contagem.
//             Num arquivo que fala com a Z-API, um caminho com send- no começo
//             ou depois de uma barra também conta como envio: pega o
//             tryReq('POST','send-text') e o `${base(c)}/send-text` com a base
//             vinda de função, propriedade ou let reatribuído.
//   graph     POST (ou método não provado GET) num edge de envio do Graph
//             (/messages, /replies, /comments, /private_replies) de
//             graph.facebook.com ou graph.instagram.com, fora dos clientes
//             oficiais (igClient, fbComentarios, fbMensagens). Num arquivo com
//             host do Graph, também: o edge exato passado como argumento de
//             chamada (gpost(pg, 'messages', corpo)) é envio, e o template que
//             termina em /${x}/${y} sem GET provado é caminho_livre.
//   zapipost  chamada crua a zapiPost/zapiDelete fora do zapiClient.ts: pula os
//             envios tipados (bolhas, sendFrio) por onde o CHEFE vai passar.
//   envio_cru chamada a uma função de envio cru exportada por um arquivo do
//             MIGRAR (ENVIO_CRU_EXPORTADO: enviarZapiIO, encaminharMidiaAoConsultor),
//             contada como o zapiPost cru: cada chamador está no MIGRAR com o
//             número exato, e chamada nova fora deles reprova.
//   script    em api/scripts e worker-prospeccao: importar o transporte da api,
//             chamar uma função de envio ou apontar para uma rota de envio. Disparo
//             passa a ser rota que passa pelo CHEFE, nunca script local.
//   robo      em api/src (fora do CHEFE): pedido com robo: '<nome>' literal de
//             um arquivo que não está na lista daquele robô (ROBOS_POR_ARQUIVO,
//             igual ao CLASSE_POR_ROBO[*].arquivos), ou com nome sem registro.
//             É a guarda arquivo → robôs permitidos contra a classe errada (o
//             reagenda pedindo como ep_agenda em 02/10, a rota da queda de 30/08
//             pedindo como agenda).
//
// COMO A CATRACA FUNCIONA. Os ofensores que existem hoje estão em MIGRAR, com a
// contagem exata por arquivo e tipo e o porquê. O teste passa hoje e falha:
//   - para arquivo novo fora do mapa;
//   - para número que SOBE (ofensor novo dentro de arquivo já listado);
//   - para número que DESCE (migrou e esqueceu de baixar o mapa: a catraca só
//     aperta, então baixe o número ou tire a entrada).
// Mapa vazio é pré-condição do CHEFE "valendo" completo.
//
// Para ver o inventário inteiro que a varredura achou:
//   CHEFE_GUARDA_INVENTARIO=1 npx vitest run src/__tests__/chefeGuarda.test.ts
//
// LIMITES CONHECIDOS (escritos para ninguém achar que a guarda vê mais do que vê):
//   - ESCOPO: só lê as pastas de RAIZES (api/src, api/scripts, worker-prospeccao
//     e cloudflare-worker). Ficam de fora dashboard/, widget/, plugcash/,
//     ebike-ecommerce/ (que tem rotas de API em src/app/api) e .github/workflows.
//     Hoje nenhuma delas fala com a Z-API nem manda pelo Graph (só texto de tela,
//     o nome do process-messages.yml e o pixel /events da loja), mas uma rota de
//     servidor nova ali, ou um curl num workflow para api.z-api.io, passaria sem
//     a guarda ver.
//   - Edge do Graph montado num arquivo SEM host do Graph e passado a um helper
//     de outro arquivo não aparece. Os helpers de hoje são privados.
//   - URL da Z-API inteira vinda de env ou de outro arquivo, num arquivo sem o
//     host, sem o molde /instances/.../token/ e sem o cabeçalho Client-Token, não
//     aparece (fetch(`${base}/send-text`) com a base num parâmetro vindo de fora,
//     fetch(process.env.X)). Com a base montada no próprio arquivo, aparece.
//   - Função de envio cru re-exportada por um arquivo intermediário (barrel) não
//     é seguida: o chamador do barrel não aparece. Hoje não há barrel desses.
//   - Endpoint de envio da Z-API que não começa com send- (se existir) cai como
//     consulta, e consulta num arquivo de CONSULTA_ZAPI passa sem contagem.
//   - Quem chama sendWhatsApp/sendHuman sem passar pelo CHEFE NÃO é assunto
//     desta guarda: isso é a catraca de passaporte, que entra com o CHEFE ligado.
//   - O mapa arquivo → robôs permitidos (regra robo) só vê o nome LITERAL do
//     robô no pedido; nome vindo de variável não aparece. E ele NÃO separa
//     classes dentro dos 9 arquivos que hospedam robôs de classes diferentes
//     (ARQUIVOS_MISTOS): o dunningService.ts pode pedir o lote do lembrete
//     (frio de receita) como dunning_d0 (evento) e passa. A defesa completa é o
//     passaporte por chamada, que prova o evento: DÍVIDA declarada, com os
//     números do evento cravados no chefeQuedas.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, '..', '..', '..');

/** O transporte oficial do WhatsApp. É o único lugar que monta URL da Z-API. */
const CLIENTE_ZAPI = 'api/src/services/agents/zapiClient.ts';

/** Os clientes oficiais do Graph que hoje mandam DM, resposta privada e comentário. */
const CLIENTES_GRAPH: readonly string[] = Object.freeze([
  'api/src/services/instagram/igClient.ts',
  'api/src/services/instagram/fbComentarios.ts',
  'api/src/services/instagram/fbMensagens.ts',
]);

/** Pastas varridas. Só a api/src é obrigatória; as outras podem não existir num checkout parcial. */
const RAIZES: readonly { pasta: string; obrigatoria: boolean }[] = Object.freeze([
  { pasta: 'api/src', obrigatoria: true },
  { pasta: 'api/scripts', obrigatoria: false },
  // WhatsApp de prospecção NUNCA pela 5040 [memória chefe-antiban-da-linha.md]:
  // o worker do PC usa outro chip e o navegador; Z-API ou rota de envio da api
  // ali dentro é ofensor.
  { pasta: 'worker-prospeccao', obrigatoria: false },
  { pasta: 'cloudflare-worker', obrigatoria: false },
]);

const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', '.vercel', '__tests__', 'coverage', '.next', '.git']);
const CAMINHOS_IGNORADOS = new Set(['api/scripts/out']);
const EXT_TEXTO = new Set(['.py', '.ps1', '.sh', '.cmd', '.bat', '.vbs']);

type Regra = 'zapi' | 'graph' | 'zapipost' | 'envio_cru' | 'script' | 'robo';
type Chave =
  | 'zapi:envio' | 'zapi:caminho_livre'
  | 'graph:envio' | 'graph:caminho_livre'
  | 'zapipost:chamada'
  | 'envio_cru:chamada'
  | 'script:import' | 'script:chamada' | 'script:rota'
  | 'robo:fora_do_arquivo' | 'robo:sem_registro';
type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'DESCONHECIDO';

interface Achado {
  /** Relativo à raiz do repo, sempre com barra normal. */
  arquivo: string;
  linha: number;
  regra: Regra;
  /** envio | caminho_livre | consulta (zapi); envio | caminho_livre (graph); chamada (zapipost, envio_cru); import | chamada | rota (script). */
  tipo: string;
  trecho: string;
}

interface Migracao {
  contagem: Partial<Record<Chave, number>>;
  /** Por que o ofensor existe e por que ainda não saiu. */
  porque: string;
  /** Para onde ele vai (a correção dos críticos vale sobre a especificação). */
  destino: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA EXPLÍCITA DE MIGRAÇÃO — os ofensores que existem hoje (base origin/main
// 2c67eaff, depois da limpeza, que apagou o POST /admin/io/send-text e os
// broadcasts do admin.ts). Referência por ROTA ou função, não por número de
// linha: as linhas já andaram desde a especificação.
// ─────────────────────────────────────────────────────────────────────────────

const MIGRAR: Readonly<Record<string, Migracao>> = Object.freeze({
  'api/src/services/io/ioSend.ts': {
    contagem: { 'zapi:caminho_livre': 1, 'zapi:envio': 4 },
    porque: 'enviarZapiIO faz fetch cru na Z-API da linha io (texto, imagem, vídeo e áudio por um caminho variável). ' +
      'Sem circuit-breaker, sem desvio e sem contagem. O chamador vivo é o avisosTickService.',
    destino: 'Usar sendWhatsApp/sendImage/sendVideo/sendAudio do zapiClient na linha io, com o mesmo retorno {ok, messageId, erro}.',
  },
  'api/src/routes/zapiAdmin.ts': {
    contagem: { 'zapi:envio': 3, 'zapi:caminho_livre': 4 },
    porque: 'Envio: GET /solardoc/test-send, POST /io/test-send e POST /io/send-text (a rota da queda de 30/08: 98 frios a 18/h). ' +
      'Caminho livre: os helpers zapiPut, tryPut e tryReq e o POST genérico do /io/setup aceitam qualquer caminho.',
    destino: '[crítica] APAGAR /solardoc/test-send e /io/test-send (migrar abriria a instância morta pela 5040). ' +
      '/io/send-text passa pelo CHEFE como frio com freio duro (6/h, 30 em 24h, 1 por chamada); a classe nunca é a que o operador declara. ' +
      'Os helpers ficam restritos a caminho fixo de leitura e configuração (nunca send-*).',
  },
  'api/src/routes/mcp.ts': {
    contagem: { 'zapi:envio': 1 },
    porque: 'A ferramenta enviar_mensagem_whatsapp faz fetch cru em send-text com a env da instância solardoc (parada desde 27/05).',
    destino: '[crítica] APAGAR a ferramenta, não migrar: com o desvio ligado ela abriria a 5040 para texto livre de fora, ' +
      'e o OAuth da rota entrega o token a quem pedir. Consertar o OAuth junto com o giro do MCP_TOKEN.',
  },
  'api/src/services/io/encaminharMidiaConsultor.ts': {
    contagem: { 'zapipost:chamada': 7 },
    porque: 'Encaminha mídia do lead ao consultor chamando zapiPost(\'send-*\') cru, sem os envios tipados.',
    destino: 'Trocar por sendImage/sendAudio (com waveform)/sendVideo/sendDocument/sendWhatsApp, como aviso ao time. ' +
      'O teto próprio de 12 por lead por hora continua.',
  },
  'api/scripts/broadcast-1mai-solardoc.mjs': {
    contagem: { 'zapi:envio': 1 },
    porque: 'Disparo único de 01/05 com fetch cru em send-text e credencial local.',
    destino: 'APAGAR o arquivo. Script local de envio deixa de existir: disparo é rota que passa pelo CHEFE.',
  },
  // ── Chamadores das funções de envio cru (ENVIO_CRU_EXPORTADO) ──
  'api/src/services/io/avisosTickService.ts': {
    contagem: { 'envio_cru:chamada': 1 },
    porque: 'O Menu de Avisos manda cada alvo da vez pelo enviarZapiIO, o fetch cru da linha io (sem circuit-breaker, sem desvio, sem contagem).',
    destino: 'Sai junto com o enviarZapiIO: mandar pelo zapiClient da linha io e pedir ao CHEFE como avisos_pauta (frio).',
  },
  'api/src/routes/webhook.ts': {
    contagem: { 'envio_cru:chamada': 2 },
    porque: 'Encaminha a mídia do lead ao consultor pelo encaminharMidiaAoConsultor, que chama zapiPost cru (entrada da linha io e da solardoc).',
    destino: 'Sai quando o encaminharMidiaConsultor.ts passar para os envios tipados; pede ao CHEFE como encaminha_midia (aviso ao time).',
  },
  'api/src/services/agents/whatsapp/whatsappAgentService.ts': {
    contagem: { 'envio_cru:chamada': 1 },
    porque: 'A Giovanna encaminha a mídia do lead ao consultor pelo encaminharMidiaAoConsultor, que chama zapiPost cru.',
    destino: 'Sai quando o encaminharMidiaConsultor.ts passar para os envios tipados; pede ao CHEFE como encaminha_midia (aviso ao time).',
  },
});

/**
 * Funções EXPORTADAS por arquivos do MIGRAR que mandam mensagem por fora dos
 * envios tipados. Quem as chama é contado como 'envio_cru:chamada'. O teste
 * "toda função de envio cru exportada" prova que a lista está completa: função
 * exportada de um arquivo do MIGRAR que leva a um ofensor (direto ou por um
 * helper do próprio arquivo) tem de estar aqui.
 */
const ENVIO_CRU_EXPORTADO: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'api/src/services/io/ioSend.ts': ['enviarZapiIO'],
  'api/src/services/io/encaminharMidiaConsultor.ts': ['encaminharMidiaAoConsultor'],
});

/**
 * Arquivos que podem LER ou CONFIGURAR a Z-API por fora do zapiClient (sem
 * mandar mensagem). Sem contagem: leitura nova num destes arquivos passa, num
 * arquivo novo reprova.
 */
const CONSULTA_ZAPI: Readonly<Record<string, string>> = Object.freeze({
  'api/src/routes/zapiAdmin.ts': 'Painel da linha: status, me, chats, chat-messages, restart e troca de webhooks.',
  'api/src/routes/mcp.ts': 'Ferramenta de contatos do MCP (só leitura). Sai junto se o MCP for desligado.',
  'api/src/services/agents/sdr/sdrIoPolling.ts': 'Lê os chats da linha io para o polling de entrada.',
  'api/src/services/io/zapiHealthMonitor.ts': 'Lê o status da instância para o monitor da linha.',
});

// ─────────────────────────────────────────────────────────────────────────────
// MAPA ARQUIVO → ROBÔS PERMITIDOS, com a classe máxima de cada arquivo (a mais
// urgente que um pedido dali pode ter; robô de agenda com prazo conta como
// lembrete_p1). Caminho relativo a api/src, como em CLASSE_POR_ROBO.
//
// Escrito aqui por extenso, e não lido do CLASSE_POR_ROBO, de propósito: o
// teste prova que os dois são iguais, então pôr um robô num arquivo novo (ou um
// evento ao lado de um frio) muda este mapa no mesmo diff e aparece na revisão.
// ─────────────────────────────────────────────────────────────────────────────

const ROBOS_POR_ARQUIVO: Readonly<Record<string, { robos: readonly string[]; classeMaxima: Classe }>> = Object.freeze({
  'controllers/authController.ts': { robos: ['solardoc_boas_vindas', 'solardoc_compra'], classeMaxima: 'evento_p0' },
  'controllers/paymentsController.ts': { robos: ['solardoc_compra'], classeMaxima: 'evento_p0' },
  'controllers/trackingGeradorController.ts': { robos: ['tracking_gerador_aviso'], classeMaxima: 'aviso_interno_p2' },
  'controllers/trafegoController.ts': { robos: ['trafego_confirmacao'], classeMaxima: 'evento_p0' },
  'routes/admin.ts': { robos: ['manual_crm'], classeMaxima: 'reativo_p1' },
  'routes/cron.ts': { robos: ['prospeccao_aviso', 'resumo_dia'], classeMaxima: 'aviso_interno_p2' },
  'routes/ioEletroposto.ts': { robos: ['ep_aviso_ficha'], classeMaxima: 'aviso_interno_p2' },
  'routes/ioIndicacoes.ts': { robos: ['indicacao_aviso_equipe', 'indicacao_confirmacao'], classeMaxima: 'evento_p0' },
  'routes/ioSolar.ts': { robos: ['solar_aviso_ficha'], classeMaxima: 'aviso_interno_p2' },
  'routes/webhook.ts': { robos: ['convite_grupo_pedido', 'webhook_audio_falhou', 'webhook_aviso_equipe'], classeMaxima: 'evento_p0' },
  'routes/zapiAdmin.ts': { robos: ['zapi_admin_lote'], classeMaxima: 'frio_p5' },
  'services/agenda/agendaProximaDigest.ts': { robos: ['agenda_proxima_digest'], classeMaxima: 'aviso_interno_p2' },
  'services/agenda/leadsMetaService.ts': { robos: ['leads_meta_alerta'], classeMaxima: 'aviso_interno_p2' },
  'services/agenda/manychatLeadService.ts': { robos: ['manychat_aviso'], classeMaxima: 'aviso_interno_p2' },
  'services/agenda/reagendarDigest.ts': { robos: ['reagendar_digest'], classeMaxima: 'aviso_interno_p2' },
  'services/agents/sdr/carlaRetomada.ts': { robos: ['carla_retomada'], classeMaxima: 'frio_p5' },
  'services/agents/sdr/sdrAgentService.ts': { robos: ['sdr_grupo_interno'], classeMaxima: 'aviso_interno_p2' },
  'services/agents/sdr/sdrB2bAgentService.ts': { robos: ['carla_b2b_reativa'], classeMaxima: 'reativo_p1' },
  'services/agents/sdr/sdrGroupAgent.ts': { robos: ['sdr_grupo_interno'], classeMaxima: 'aviso_interno_p2' },
  'services/agents/sdr/sdrIoPolling.ts': { robos: ['sdr_io_aviso'], classeMaxima: 'aviso_interno_p2' },
  'services/agents/whatsapp/biaInboundService.ts': { robos: ['bia_inbound'], classeMaxima: 'reativo_p1' },
  'services/agents/whatsapp/carlaCnpjKillerQuestion.ts': { robos: ['carla_cnpj_killer'], classeMaxima: 'frio_p5' },
  'services/agents/whatsapp/carlaPlatformFollowupService.ts': { robos: ['carla_inativo', 'carla_sem_cnpj'], classeMaxima: 'frio_p5' },
  'services/agents/whatsapp/cursoEntradaBroadcast.ts': { robos: ['curso19'], classeMaxima: 'frio_p5' },
  'services/agents/whatsapp/filaAlerta.ts': { robos: ['fila_alerta'], classeMaxima: 'aviso_interno_p2' },
  'services/agents/whatsapp/limpaproRecoveryService.ts': { robos: ['bia_recuperacao'], classeMaxima: 'frio_p5' },
  'services/agents/whatsapp/pixComprovanteService.ts': { robos: ['pix_comprovante_cliente', 'pix_comprovante_dono'], classeMaxima: 'evento_p0' },
  'services/agents/whatsapp/pixRecoveryAgentService.ts': { robos: ['recuperacao_checkout'], classeMaxima: 'frio_receita_p4' },
  'services/agents/whatsapp/pixVipReminderService.ts': { robos: ['pix_vip_lembrete'], classeMaxima: 'frio_receita_p4' },
  'services/agents/whatsapp/whatsappAgentService.ts': {
    robos: ['giovanna_aviso_dono', 'giovanna_reativa', 'solardoc_ativacao', 'solardoc_boas_vindas', 'solardoc_compra'], classeMaxima: 'evento_p0',
  },
  'services/agents/whatsapp/whatsappFollowupService.ts': { robos: ['whatsapp_followup'], classeMaxima: 'frio_p5' },
  'services/asaas/asaasWebhookService.ts': { robos: ['asaas_aviso'], classeMaxima: 'aviso_interno_p2' },
  'services/confiancaWhatsAppService.ts': { robos: ['confianca_whatsapp'], classeMaxima: 'frio_p5' },
  'services/dunningService.ts': { robos: ['dunning_d0', 'dunning_d5', 'dunning_lembrete', 'dunning_recuperado'], classeMaxima: 'evento_p0' },
  'services/followupService.ts': { robos: ['recuperacao_checkout'], classeMaxima: 'frio_receita_p4' },
  'services/instagram/fbMensagens.ts': { robos: ['fb_aviso_equipe'], classeMaxima: 'aviso_interno_p2' },
  'services/instagram/igEngine.ts': { robos: ['ig_aviso_equipe'], classeMaxima: 'aviso_interno_p2' },
  'services/io/avisosTickService.ts': { robos: ['avisos_pauta'], classeMaxima: 'frio_p5' },
  'services/io/eletropostoAgenda.ts': { robos: ['ep_agenda', 'ep_desmarcacao_aviso'], classeMaxima: 'lembrete_p1' },
  'services/io/eletropostoAlerta10min.ts': { robos: ['ep_alerta_10min'], classeMaxima: 'lembrete_p1' },
  'services/io/eletropostoCardPing.ts': { robos: ['ep_card_ping'], classeMaxima: 'aviso_interno_p2' },
  'services/io/eletropostoCobraSim.ts': { robos: ['ep_cobra_sim'], classeMaxima: 'lembrete_p1' },
  'services/io/eletropostoIgConvite.ts': { robos: ['ep_ig_convite'], classeMaxima: 'frio_p5' },
  'services/io/eletropostoNaoAtendidoFup.ts': { robos: ['ep_oferta_fria'], classeMaxima: 'frio_p5' },
  'services/io/eletropostoReagendaAuto.ts': { robos: ['ep_reagenda_auto'], classeMaxima: 'frio_p5' },
  'services/io/eletropostoRemarcar.ts': { robos: ['ep_oferta_fria', 'ep_remarcar_reativo'], classeMaxima: 'reativo_p1' },
  'services/io/eletropostoRespostas.ts': { robos: ['ep_oferta_fria', 'ep_remarcar_reativo', 'ep_respostas_aviso'], classeMaxima: 'reativo_p1' },
  'services/io/eletropostoRetorno.ts': { robos: ['ep_oferta_fria'], classeMaxima: 'frio_p5' },
  'services/io/encaminharMidiaConsultor.ts': { robos: ['encaminha_midia'], classeMaxima: 'aviso_interno_p2' },
  'services/io/entradaIoDigest.ts': { robos: ['entrada_io_digest'], classeMaxima: 'aviso_interno_p2' },
  'services/io/ioSend.ts': { robos: ['avisos_pauta'], classeMaxima: 'frio_p5' },
  'services/io/lembreteFollowupService.ts': { robos: ['lembrete_followup'], classeMaxima: 'aviso_interno_p2' },
  'services/io/placarGiovanna.ts': { robos: ['placar_giovanna'], classeMaxima: 'aviso_interno_p2' },
  'services/io/prospeccaoAviso.ts': { robos: ['prospeccao_aviso'], classeMaxima: 'aviso_interno_p2' },
  'services/io/recepcaoIo.ts': { robos: ['duda_ficha_consultor', 'duda_recepcao'], classeMaxima: 'reativo_p1' },
  'services/io/sementeSolarService.ts': { robos: ['semente'], classeMaxima: 'frio_p5' },
  'services/io/sentinelaVacuo.ts': { robos: ['sentinela_vacuo'], classeMaxima: 'aviso_interno_p2' },
  'services/io/solarAgendaGiovanna.ts': { robos: ['giovanna_agenda'], classeMaxima: 'lembrete_p1' },
  'services/io/solarBoasVindas.ts': { robos: ['solar_boas_vindas'], classeMaxima: 'lembrete_p1' },
  'services/io/solarRespostas.ts': { robos: ['solar_respostas_aviso'], classeMaxima: 'aviso_interno_p2' },
  'services/pesquisaSatisfacao.ts': { robos: ['pesquisa_satisfacao'], classeMaxima: 'frio_p5' },
  'services/vendaAviso.ts': { robos: ['venda_aviso'], classeMaxima: 'aviso_interno_p2' },
});

/**
 * Os 9 arquivos que hospedam robôs de classes diferentes. Aqui a regra robo não
 * separa a classe: um pedido com o nome de outro robô do MESMO arquivo passa.
 * A defesa completa é o passaporte por chamada (dívida declarada).
 */
const ARQUIVOS_MISTOS: Readonly<Record<string, readonly Classe[]>> = Object.freeze({
  'routes/ioIndicacoes.ts': ['evento_p0', 'aviso_interno_p2'],
  'routes/webhook.ts': ['evento_p0', 'reativo_p1', 'aviso_interno_p2'],
  'services/agents/whatsapp/pixComprovanteService.ts': ['evento_p0', 'aviso_interno_p2'],
  'services/agents/whatsapp/whatsappAgentService.ts': ['evento_p0', 'reativo_p1', 'aviso_interno_p2'],
  'services/dunningService.ts': ['evento_p0', 'frio_receita_p4'],
  'services/io/eletropostoAgenda.ts': ['aviso_interno_p2', 'transacional_agenda_p3'],
  'services/io/eletropostoRemarcar.ts': ['reativo_p1', 'frio_p5'],
  'services/io/eletropostoRespostas.ts': ['reativo_p1', 'aviso_interno_p2', 'frio_p5'],
  'services/io/recepcaoIo.ts': ['reativo_p1', 'aviso_interno_p2'],
});

/** O mapa como o CLASSE_POR_ROBO dá hoje (o teste confere com o literal acima). */
function mapaDerivado(): { mapa: Record<string, { robos: string[]; classeMaxima: Classe }>; classes: Record<string, Classe[]> } {
  const rank = (c: Classe) => CLASSES.indexOf(c);
  const mapa: Record<string, { robos: string[]; classeMaxima: Classe }> = {};
  const classes: Record<string, Classe[]> = {};
  for (const [nome, r] of Object.entries(CLASSE_POR_ROBO)) {
    const efetiva: Classe = r.podeTerPrazo && rank('lembrete_p1') < rank(r.classe) ? 'lembrete_p1' : r.classe;
    for (const a of r.arquivos) {
      const e = mapa[a] ?? (mapa[a] = { robos: [], classeMaxima: 'frio_p5' });
      e.robos.push(nome);
      if (rank(efetiva) < rank(e.classeMaxima)) e.classeMaxima = efetiva;
      const cs = classes[a] ?? (classes[a] = []);
      if (!cs.includes(r.classe)) cs.push(r.classe);
    }
  }
  for (const e of Object.values(mapa)) e.robos.sort();
  for (const cs of Object.values(classes)) cs.sort((x, y) => rank(x) - rank(y));
  return { mapa, classes };
}

const PASTA_CHEFE = 'api/src/services/chefe/';
/** Pedido com robo: '<nome>' literal (o passaporte do pedido ao CHEFE). */
const PEDIDO_COM_ROBO = /\brobo\s*:\s*['"`]/;

// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA — a mesma função roda no disco e nas fixtures do controle positivo.
// ─────────────────────────────────────────────────────────────────────────────

const CORINGA = '${*}';
const HOST_ZAPI = /api\.z-api\.io/i;
const URL_ZAPI_SEM_HOST = /\/instances\/\$\{[^}]*\}\/token\//;
// send- sem exigir letra depois: `send-${tipo}` e 'send-' + k também são envio.
const ZAPI_ENVIO = /(^|\/)send-/i;
const ZAPI_CAMINHO_VARIAVEL = /\/token\/\$\{[^}]*\}\/\$\{|api\.z-api\.io\/\$\{/i;
// No começo ou depois de uma barra: '${*}/send-text' é a base da instância vinda
// de função, propriedade ou let reatribuído, com o caminho montado depois.
const PATH_ENVIO_SOLTO = /(^|\/)send-/i;
const CABECALHO_ZAPI = /^client-token$/i;
const HOST_GRAPH = /graph\.(facebook|instagram)\.com/i;
const EDGE_ENVIO_GRAPH = /\/(messages|private_replies|replies|comments)(?=$|[/?#&])/i;
/** O edge sozinho, passado como argumento a um helper do próprio arquivo. */
const EDGE_SOLTO_GRAPH = /^(messages|private_replies|replies|comments)$/i;
/** Template do Graph que termina em dois segmentos variáveis: o helper que manda para o edge que pedirem. */
const GRAPH_CAMINHO_LIVRE = /\/\$\{\*\}\/\$\{\*\}(\?|$)/;
const ROTA_DE_ENVIO = /send-(text|message|image|document|audio|video|sticker|link|button)|zapi-admin|\/io\/broadcasts/i;
const MODULO_ZAPI = /(^|\/)zapiClient(\.[cm]?[jt]s)?$/;
const MODULO_TRANSPORTE = /(^|\/)(zapiClient|ioSend|igClient|fbComentarios|fbMensagens|encaminharMidiaConsultor)(\.[cm]?[jt]s)?$/;
const FUNCOES_DE_ENVIO = new Set([
  'sendWhatsApp', 'sendHuman', 'sendFrio', 'sendZAPI', 'sendImage', 'sendDocument', 'sendAudio', 'sendVideo',
  'sendSticker', 'sendToGroup', 'enviarZapiIO', 'sendDM', 'sendPrivateReply', 'replyToComment', 'zapiPost',
]);
const METODOS_DE_ROTA = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);
/** Receptor de definição de rota do Express: router, app, adminRouter... */
const RECEPTOR_DE_ROTA = /^(router|app|\w+Router)$/;

/** Só abre o AST de quem tem chance de ofender (a varredura fica em poucos segundos). */
const GATILHOS = [
  'z-api', 'client-token', '/instances/', 'graph.facebook', 'graph.instagram', 'zapipost', 'zapidelete',
  ...Object.values(ENVIO_CRU_EXPORTADO).flat().map(n => n.toLowerCase()),
];
const GATILHOS_SCRIPT = [
  'send', 'zapiclient', 'iosend', 'igclient', 'fbcomentarios', 'fbmensagens', 'encaminharmidia',
  'replytocomment', 'enviarzapiio', 'zapi-admin', 'broadcast',
];

const ehScript = (arquivo: string): boolean =>
  arquivo.startsWith('api/scripts/') || arquivo.startsWith('worker-prospeccao/');

function tipoDeScript(arquivo: string): ts.ScriptKind | null {
  switch (extname(arquivo).toLowerCase()) {
    case '.ts': return ts.ScriptKind.TS;
    case '.tsx': return ts.ScriptKind.TSX;
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    case '.jsx': return ts.ScriptKind.JSX;
    default: return null;
  }
}

/** O arquivo pede ao CHEFE com nome literal de robô (e não é o próprio CHEFE)? */
const pedeRobo = (texto: string, arquivo: string): boolean =>
  arquivo.startsWith('api/src/') && !arquivo.startsWith(PASTA_CHEFE) && PEDIDO_COM_ROBO.test(texto);

function varrerFonte(texto: string, arquivo: string): Achado[] {
  const baixo = texto.toLowerCase();
  const gatilhos = ehScript(arquivo) ? [...GATILHOS, ...GATILHOS_SCRIPT] : GATILHOS;
  if (!pedeRobo(texto, arquivo) && !gatilhos.some(g => baixo.includes(g))) return [];
  const kind = tipoDeScript(arquivo);
  if (kind !== null) return varrerAst(texto, arquivo, kind);
  if (EXT_TEXTO.has(extname(arquivo).toLowerCase())) return varrerTexto(texto, arquivo);
  return [];
}

/** Arquivo que não é JS/TS (python, powershell...): regra por linha, sem AST. */
function varrerTexto(texto: string, arquivo: string): Achado[] {
  const linhas = texto.split(/\r?\n/);
  const temHost = linhas.some(l => HOST_ZAPI.test(l));
  const achados: Achado[] = [];
  linhas.forEach((l, i) => {
    const base = { arquivo, linha: i + 1, trecho: l.trim().slice(0, 90) };
    if (HOST_ZAPI.test(l)) achados.push({ ...base, regra: 'zapi', tipo: ZAPI_ENVIO.test(l) ? 'envio' : 'consulta' });
    else if (!temHost && /client-token/i.test(l)) achados.push({ ...base, regra: 'zapi', tipo: 'caminho_livre' });
    else if (HOST_GRAPH.test(l) && EDGE_ENVIO_GRAPH.test(l)) achados.push({ ...base, regra: 'graph', tipo: 'envio' });
    else if (ehScript(arquivo) && ROTA_DE_ENVIO.test(l)) achados.push({ ...base, regra: 'script', tipo: 'rota' });
  });
  return achados;
}

// ── ajudantes de AST ────────────────────────────────────────────────────────

const ehSoma = (n: ts.Node): n is ts.BinaryExpression =>
  ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;

const ehLiteralDeTexto = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

function nomeDaPropriedade(nome: ts.PropertyName | undefined): string | null {
  if (!nome) return null;
  if (ts.isIdentifier(nome) || ts.isStringLiteral(nome) || ts.isNoSubstitutionTemplateLiteral(nome)) return nome.text;
  return null;
}

function nomeDoChamado(c: ts.CallExpression): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Literal que é caminho de módulo (import, export, require, import()) ou tipo literal: não é texto de runtime. */
function ehEspecificadorOuTipo(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
  if (ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === n) {
    if (p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(p.expression) && p.expression.text === 'require') return true;
  }
  return false;
}

function resolverTexto(e: ts.Node, consts: ReadonlyMap<string, string>, prof = 0): string | null {
  if (prof > 12) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const span of e.templateSpans) s += (resolverTexto(span.expression, consts, prof + 1) ?? CORINGA) + span.literal.text;
    return s;
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
    return resolverTexto(e.expression, consts, prof + 1);
  }
  if (ts.isIdentifier(e)) return consts.get(e.text) ?? null;
  if (ehSoma(e)) {
    const a = resolverTexto(e.left, consts, prof + 1);
    const b = resolverTexto(e.right, consts, prof + 1);
    if (a === null && b === null) return null;
    return (a ?? CORINGA) + (b ?? CORINGA);
  }
  return null;
}

/** const NOME = <texto resolvível>, em qualquer escopo (o primeiro que resolve vence). */
function coletarConstantes(sf: ts.SourceFile): Map<string, string> {
  const decls: { nome: string; init: ts.Expression }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0) {
      decls.push({ nome: n.name.text, init: n.initializer });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  const mapa = new Map<string, string>();
  for (let volta = 0; volta < 3; volta++) {
    for (const d of decls) {
      if (mapa.has(d.nome)) continue;
      const v = resolverTexto(d.init, mapa);
      if (v !== null) mapa.set(d.nome, v);
    }
  }
  return mapa;
}

function normalizarMetodo(s: string): Metodo {
  const m = s.trim().toUpperCase();
  return m === 'GET' || m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE' ? m : 'DESCONHECIDO';
}

/** Método de um objeto de opções ({ method: 'POST' }). Sem a chave: GET (padrão do fetch e do https.request). */
function metodoDoObjeto(o: ts.ObjectLiteralExpression): Metodo {
  for (const p of o.properties) {
    if (ts.isSpreadAssignment(p)) return 'DESCONHECIDO';
    if (nomeDaPropriedade(p.name) !== 'method') continue;
    if (ts.isPropertyAssignment(p)
      && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) {
      return normalizarMetodo(p.initializer.text);
    }
    return 'DESCONHECIDO';
  }
  return 'GET';
}

function metodoDaChamada(c: ts.CallExpression): Metodo {
  const nome = nomeDoChamado(c);
  if (!nome) return 'DESCONHECIDO';
  const verbo = nome.toLowerCase();
  if (verbo === 'get' || verbo === 'post' || verbo === 'put' || verbo === 'patch' || verbo === 'delete') {
    return normalizarMetodo(verbo);
  }
  if (nome !== 'fetch') return 'DESCONHECIDO'; // helper próprio (tryReq, zapiGet...): não dá para provar
  const opcoes = c.arguments[1];
  if (!opcoes) return 'GET';
  return ts.isObjectLiteralExpression(opcoes) ? metodoDoObjeto(opcoes) : 'DESCONHECIDO';
}

function subirEmbrulho(n: ts.Node): ts.Node {
  let a = n;
  while (a.parent && (ts.isParenthesizedExpression(a.parent) || ts.isAsExpression(a.parent) || ts.isNonNullExpression(a.parent))) {
    a = a.parent;
  }
  return a;
}

/** Como subirEmbrulho, e também passa pelo await (const { f } = await import('...')). */
function subirEmbrulhoEAwait(n: ts.Node): ts.Node {
  let a = subirEmbrulho(n);
  while (a.parent && ts.isAwaitExpression(a.parent)) a = subirEmbrulho(a.parent);
  return a;
}

/**
 * Funções de envio cru que o módulo importado exporta, ou null. O caminho é
 * resolvido a partir do arquivo que importa (não pelo nome do arquivo): só
 * caminho relativo, que é como a api importa entre si.
 */
function envioCruDoModulo(arquivo: string, modulo: string): readonly string[] | null {
  if (!modulo.startsWith('.')) return null;
  const semExt = (s: string) => s.replace(/\.[cm]?[jt]sx?$/, '');
  const alvo = semExt(posix.normalize(posix.join(posix.dirname(arquivo), modulo)));
  for (const [arq, nomes] of Object.entries(ENVIO_CRU_EXPORTADO)) if (semExt(arq) === alvo) return nomes;
  return null;
}

function escopoDe(n: ts.Node): ts.Node {
  let a: ts.Node | undefined = n.parent;
  while (a && !ts.isSourceFile(a) && !ts.isFunctionLike(a)) a = a.parent;
  return a ?? n.getSourceFile();
}

/**
 * Com que método este texto vira requisição? GET só quando PROVADO: primeiro
 * argumento de fetch sem opções (ou com method GET), const passada só a fetch
 * GET, ou objeto de opções do https.request sem method. O resto é DESCONHECIDO
 * e conta como envio possível (lado conservador).
 */
function metodoDoUso(no: ts.Node): Metodo {
  const a = subirEmbrulho(no);
  const p = a.parent;
  if (!p) return 'DESCONHECIDO';
  if (ts.isCallExpression(p) && p.arguments[0] === a) return metodoDaChamada(p);
  if (ts.isVariableDeclaration(p) && p.initializer === a && ts.isIdentifier(p.name)) {
    const nome = p.name.text;
    const metodos: Metodo[] = [];
    const procurar = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const arg = n.arguments[0];
        if (arg && ts.isIdentifier(arg) && arg.text === nome) metodos.push(metodoDaChamada(n));
      }
      ts.forEachChild(n, procurar);
    };
    procurar(escopoDe(p));
    if (metodos.length === 0) return 'DESCONHECIDO';
    return metodos.find(m => m !== 'GET') ?? 'GET';
  }
  if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) {
    const nome = nomeDaPropriedade(p.name);
    if (nome === 'path' || nome === 'url' || nome === 'uri') return metodoDoObjeto(p.parent);
  }
  return 'DESCONHECIDO';
}

/**
 * router.post('/io/send-text', ...) define rota da api: não é chamada para fora.
 * Só conta como rota quando o receptor é router/app ou o último argumento é uma
 * função (o handler). Uma instância axios com baseURL da Z-API fazendo
 * z.post('/send-text', body) NÃO é rota: é envio.
 */
function ehRotaExpress(no: ts.Node, texto: string, clientesHttp: ReadonlySet<string> = new Set()): boolean {
  if (!texto.startsWith('/')) return false;
  const a = subirEmbrulho(no);
  const p = a.parent;
  if (!p || !ts.isCallExpression(p) || p.arguments[0] !== a) return false;
  if (!ts.isPropertyAccessExpression(p.expression) || !METODOS_DE_ROTA.has(p.expression.name.text)) return false;
  const receptor = p.expression.expression;
  // Instância de cliente HTTP (const app = axios.create(...)): o nome não faz rota.
  if (ts.isIdentifier(receptor) && clientesHttp.has(receptor.text)) return false;
  if (ts.isIdentifier(receptor) && RECEPTOR_DE_ROTA.test(receptor.text)) return true;
  const ultimo = p.arguments[p.arguments.length - 1];
  return p.arguments.length > 1 && !!ultimo && (ts.isArrowFunction(ultimo) || ts.isFunctionExpression(ultimo));
}

function classificarZapi(texto: string, metodo: Metodo): 'envio' | 'caminho_livre' | 'consulta' {
  if (ZAPI_ENVIO.test(texto.replace(/^https?:\/\/[^/]+/i, ''))) return 'envio';
  if (ZAPI_CAMINHO_VARIAVEL.test(texto)) return metodo === 'GET' ? 'consulta' : 'caminho_livre';
  return 'consulta';
}

/** Import de um módulo cujas funções são vigiadas: o zapiPost cru, ou uma função de envio cru do MIGRAR. */
interface ImportVigiado {
  no: ts.Node;
  regra: 'zapipost' | 'envio_cru';
  nomes: readonly string[];
  locais: string[];
  namespaces: string[];
  reexporta: boolean;
}

const NOMES_ZAPIPOST: readonly string[] = Object.freeze(['zapiPost', 'zapiDelete']);

function varrerAst(texto: string, arquivo: string, kind: ts.ScriptKind): Achado[] {
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const linhaDe = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const consts = coletarConstantes(sf);
  const script = ehScript(arquivo);

  const nos: { no: ts.Node; texto: string }[] = [];
  const chamadas: ts.CallExpression[] = [];
  const vigiados: ImportVigiado[] = [];
  const importsTransporte: ts.Node[] = [];
  /** const app = axios.create(...): instância de cliente HTTP, nunca receptor de rota. */
  const clientesHttp = new Set<string>();
  const olhaRobo = pedeRobo(texto, arquivo);
  const pedidosDeRobo: { no: ts.Node; nome: string }[] = [];

  const registrarModulo = (no: ts.Node, modulo: string, montar: (imp: ImportVigiado) => void): void => {
    if (MODULO_TRANSPORTE.test(modulo)) importsTransporte.push(no);
    const alvos: Array<[ImportVigiado['regra'], readonly string[]]> = [];
    if (MODULO_ZAPI.test(modulo)) alvos.push(['zapipost', NOMES_ZAPIPOST]);
    const crus = envioCruDoModulo(arquivo, modulo);
    if (crus) alvos.push(['envio_cru', crus]);
    for (const [regra, nomes] of alvos) {
      const imp: ImportVigiado = { no, regra, nomes, locais: [], namespaces: [], reexporta: false };
      montar(imp);
      vigiados.push(imp);
    }
  };

  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      registrarModulo(n, n.moduleSpecifier.text, imp => {
        const clausula = n.importClause;
        if (clausula?.name) imp.namespaces.push(clausula.name.text);
        const nb = clausula?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) imp.namespaces.push(nb.name.text);
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const importado = (el.propertyName ?? el.name).text;
            if (imp.nomes.includes(importado)) imp.locais.push(el.name.text);
          }
        }
      });
      return;
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      registrarModulo(n, n.moduleSpecifier.text, imp => {
        const ec = n.exportClause;
        if (!ec || (ts.isNamedExports(ec) && ec.elements.some(el => imp.nomes.includes((el.propertyName ?? el.name).text)))) {
          imp.reexporta = true;
        }
      });
      return;
    }
    if (olhaRobo && ts.isPropertyAssignment(n) && nomeDaPropriedade(n.name) === 'robo'
      && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
      pedidosDeRobo.push({ no: n, nome: n.initializer.text });
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let ini: ts.Expression = n.initializer;
      while (ts.isParenthesizedExpression(ini) || ts.isAsExpression(ini) || ts.isNonNullExpression(ini) || ts.isAwaitExpression(ini)) ini = ini.expression;
      if (ts.isCallExpression(ini) && ts.isPropertyAccessExpression(ini.expression) && ini.expression.name.text === 'create') {
        clientesHttp.add(n.name.text);
      }
    }
    if (ts.isCallExpression(n)) {
      chamadas.push(n);
      const arg = n.arguments[0];
      const ehRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if ((ehRequire || n.expression.kind === ts.SyntaxKind.ImportKeyword) && arg && ts.isStringLiteral(arg)) {
        registrarModulo(n, arg.text, imp => {
          const pai = subirEmbrulhoEAwait(n).parent;
          if (pai && ts.isVariableDeclaration(pai)) {
            if (ts.isIdentifier(pai.name)) imp.namespaces.push(pai.name.text);
            else if (ts.isObjectBindingPattern(pai.name)) {
              for (const el of pai.name.elements) {
                const importado = nomeDaPropriedade(el.propertyName) ?? (ts.isIdentifier(el.name) ? el.name.text : null);
                if (importado && imp.nomes.includes(importado) && ts.isIdentifier(el.name)) imp.locais.push(el.name.text);
              }
            }
          }
        });
      }
    }
    const ehTexto = (ehLiteralDeTexto(n) && !(n.parent && ehSoma(n.parent)) && !ehEspecificadorOuTipo(n))
      || (ehSoma(n) && !(n.parent && ehSoma(n.parent)));
    if (ehTexto) {
      const t = resolverTexto(n, consts);
      if (t !== null) nos.push({ no: n, texto: t });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);

  const achados: Achado[] = [];
  const add = (no: ts.Node, regra: Regra, tipo: string, trecho: string): void => {
    achados.push({ arquivo, linha: linhaDe(no), regra, tipo, trecho: trecho.replace(/\s+/g, ' ').slice(0, 90) });
  };

  // ── Z-API, Graph e rota de envio (por nó de texto) ──
  const temUrlZapi = nos.some(x => HOST_ZAPI.test(x.texto) || URL_ZAPI_SEM_HOST.test(x.texto));
  const temCabecalho = nos.some(x => CABECALHO_ZAPI.test(x.texto));
  const falaComZapi = temUrlZapi || temCabecalho;
  const temHostGraph = nos.some(x => HOST_GRAPH.test(x.texto));
  for (const x of nos) {
    const rota = ehRotaExpress(x.no, x.texto, clientesHttp);
    if (HOST_ZAPI.test(x.texto) || URL_ZAPI_SEM_HOST.test(x.texto)) {
      add(x.no, 'zapi', classificarZapi(x.texto, metodoDoUso(x.no)), x.texto);
      continue;
    }
    if (CABECALHO_ZAPI.test(x.texto)) {
      // Cabeçalho da Z-API num arquivo sem URL da Z-API: a URL vem de env ou de fora.
      if (!temUrlZapi) add(x.no, 'zapi', 'caminho_livre', `cabeçalho ${x.texto} sem URL no arquivo`);
      continue;
    }
    if (falaComZapi && !rota && PATH_ENVIO_SOLTO.test(x.texto)) {
      add(x.no, 'zapi', 'envio', x.texto);
      continue;
    }
    if (EDGE_ENVIO_GRAPH.test(x.texto) && (HOST_GRAPH.test(x.texto) || temHostGraph) && !rota && metodoDoUso(x.no) !== 'GET') {
      add(x.no, 'graph', 'envio', x.texto);
      continue;
    }
    // Helper do Graph que manda para o edge que pedirem: `${G}/${id}/${edge}`.
    if ((HOST_GRAPH.test(x.texto) || (temHostGraph && x.texto.startsWith(CORINGA))) && GRAPH_CAMINHO_LIVRE.test(x.texto)
      && !rota && metodoDoUso(x.no) !== 'GET') {
      add(x.no, 'graph', 'caminho_livre', x.texto);
      continue;
    }
    if (script && !rota && ROTA_DE_ENVIO.test(x.texto)) add(x.no, 'script', 'rota', x.texto);
  }

  // ── Graph: o edge exato passado como argumento (gpost(pg, 'messages', corpo)) ──
  if (temHostGraph) {
    for (const c of chamadas) {
      for (const arg of c.arguments) {
        const t = ts.isIdentifier(arg) ? consts.get(arg.text) ?? null
          : (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
        if (t !== null && EDGE_SOLTO_GRAPH.test(t)) add(arg, 'graph', 'envio', `${nomeDoChamado(c) ?? '?'}(… '${t}' …)`);
      }
    }
  }

  // ── zapiPost / zapiDelete crus, e chamadores das funções de envio cru do MIGRAR ──
  for (const regra of ['zapipost', 'envio_cru'] as const) {
    const imps = vigiados.filter(i => i.regra === regra);
    if (imps.length === 0) continue;
    const nomes = new Set(imps.flatMap(i => i.nomes));
    const locais = new Set(imps.flatMap(i => i.locais));
    const namespaces = new Set(imps.flatMap(i => i.namespaces));
    let chamadasCruas = 0;
    for (const c of chamadas) {
      const e = c.expression;
      const crua = (ts.isIdentifier(e) && locais.has(e.text))
        || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && namespaces.has(e.expression.text) && nomes.has(e.name.text));
      if (crua) { add(c, regra, 'chamada', c.getText(sf)); chamadasCruas++; }
    }
    for (const imp of imps) {
      if (imp.reexporta || (imp.locais.length > 0 && chamadasCruas === 0)) add(imp.no, regra, 'chamada', imp.no.getText(sf));
    }
  }

  // ── robô pedido de um arquivo que não é o dele ──
  const rel = arquivo.slice('api/src/'.length);
  for (const { no, nome } of pedidosDeRobo) {
    if (!Object.prototype.hasOwnProperty.call(CLASSE_POR_ROBO, nome)) add(no, 'robo', 'sem_registro', `robo '${nome}' sem registro em CLASSE_POR_ROBO`);
    else if (!(ROBOS_POR_ARQUIVO[rel]?.robos ?? []).includes(nome)) add(no, 'robo', 'fora_do_arquivo', `robo '${nome}' pedido de ${rel}`);
  }

  // ── script de envio ──
  if (script) {
    for (const no of importsTransporte) add(no, 'script', 'import', no.getText(sf));
    for (const c of chamadas) {
      const nome = nomeDoChamado(c);
      if (nome && FUNCOES_DE_ENVIO.has(nome)) add(c, 'script', 'chamada', c.getText(sf));
    }
  }
  return achados;
}

// ── disco ────────────────────────────────────────────────────────────────────

function listar(pastaAbs: string, rel: string, saida: string[]): void {
  for (const e of readdirSync(pastaAbs, { withFileTypes: true })) {
    const relFilho = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!PASTAS_IGNORADAS.has(e.name) && !CAMINHOS_IGNORADOS.has(relFilho)) listar(join(pastaAbs, e.name), relFilho, saida);
      continue;
    }
    if (!e.isFile()) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
    if (tipoDeScript(e.name) !== null || EXT_TEXTO.has(extname(e.name).toLowerCase())) saida.push(relFilho);
  }
}

interface Inventario {
  lidosPorRaiz: Record<string, number>;
  achados: Achado[];
}

function varrerDisco(): Inventario {
  const lidosPorRaiz: Record<string, number> = {};
  const achados: Achado[] = [];
  for (const r of RAIZES) {
    const abs = join(RAIZ, ...r.pasta.split('/'));
    if (!existsSync(abs)) {
      if (r.obrigatoria) throw new Error(`pasta obrigatória da guarda não existe: ${r.pasta}`);
      continue;
    }
    const arquivos: string[] = [];
    listar(abs, r.pasta, arquivos);
    lidosPorRaiz[r.pasta] = arquivos.length;
    for (const arq of arquivos) achados.push(...varrerFonte(readFileSync(join(RAIZ, ...arq.split('/')), 'utf8'), arq));
  }
  return { lidosPorRaiz, achados };
}

// ── avaliação contra a lista de migração ────────────────────────────────────

function isento(a: Achado): boolean {
  if ((a.regra === 'zapi' || a.regra === 'zapipost') && a.arquivo === CLIENTE_ZAPI) return true;
  if (a.regra === 'graph' && CLIENTES_GRAPH.includes(a.arquivo)) return true;
  return false;
}

/** Devolve a lista de problemas (vazia = guarda verde). */
function avaliar(
  achados: readonly Achado[],
  mapa: Readonly<Record<string, Migracao>> = MIGRAR,
  consulta: Readonly<Record<string, string>> = CONSULTA_ZAPI,
): string[] {
  const problemas: string[] = [];
  const contagem = new Map<string, Map<string, Achado[]>>();
  for (const a of achados) {
    if (isento(a)) continue;
    if (a.regra === 'zapi' && a.tipo === 'consulta') {
      if (!(a.arquivo in consulta)) {
        problemas.push(`${a.arquivo}:${a.linha} lê ou configura a Z-API fora do zapiClient e fora de CONSULTA_ZAPI ` +
          `(${a.trecho}). Leia pelo zapiClient ou ponha o arquivo na lista com o porquê.`);
      }
      continue;
    }
    const porChave = contagem.get(a.arquivo) ?? new Map<string, Achado[]>();
    const lista = porChave.get(`${a.regra}:${a.tipo}`) ?? [];
    lista.push(a);
    porChave.set(`${a.regra}:${a.tipo}`, lista);
    contagem.set(a.arquivo, porChave);
  }
  for (const [arquivo, porChave] of contagem) {
    for (const [chave, lista] of porChave) {
      const permitido = (mapa[arquivo]?.contagem as Record<string, number | undefined> | undefined)?.[chave] ?? 0;
      const linhas = lista.map(a => a.linha).join(', ');
      if (lista.length > permitido) {
        problemas.push(`OFENSOR NOVO: ${arquivo} tem ${lista.length} × ${chave} (o mapa permite ${permitido}; linhas ${linhas}). ` +
          'Mande pelo transporte oficial (zapiClient / igClient) e passe a mudança pelo subagente chefe-antiban.');
      } else if (lista.length < permitido) {
        problemas.push(`A catraca só aperta: ${arquivo} caiu de ${permitido} para ${lista.length} × ${chave} (linhas ${linhas}). ` +
          'Baixe o número em MIGRAR.');
      }
    }
  }
  for (const [arquivo, m] of Object.entries(mapa)) {
    for (const [chave, n] of Object.entries(m.contagem)) {
      if (n && n > 0 && !contagem.get(arquivo)?.has(chave)) {
        problemas.push(`A catraca só aperta: ${arquivo} não tem mais ${chave} (o mapa diz ${n}). Tire a chave de MIGRAR.`);
      }
    }
  }
  return problemas;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

// Varre o disco uma vez, na coleta do arquivo (sem timeout de hook; o vitest 4
// não aceita beforeAll fora de describe).
const inventario: Inventario = varrerDisco();

describe('chefeGuarda: ninguém fala com a Z-API nem com o Graph por fora', () => {
  it('a varredura leu o repositório de verdade (regex que não casa nada não passa verde)', () => {
    // Hoje são 263 arquivos em api/src. O piso de 200 pega varredura que leu a
    // pasta errada ou quase nada. (A especificação falava em 400: contava antes
    // da limpeza.)
    expect(inventario.lidosPorRaiz['api/src']).toBeGreaterThan(200);
    if (existsSync(join(RAIZ, 'api', 'scripts'))) expect(inventario.lidosPorRaiz['api/scripts']).toBeGreaterThan(0);
    // O próprio cliente oficial tem de aparecer no inventário (antes da isenção).
    const doCliente = inventario.achados.filter(a => a.arquivo === CLIENTE_ZAPI && a.regra === 'zapi');
    expect(doCliente.some(a => a.tipo === 'envio')).toBe(true);
    expect(doCliente.some(a => a.tipo === 'caminho_livre')).toBe(true);
  });

  it('nenhum ofensor novo, e a lista de migração bate com o disco', () => {
    if (process.env.CHEFE_GUARDA_INVENTARIO) {
      const linhas = inventario.achados.map(a =>
        `${isento(a) ? 'isento ' : ''}${a.regra}:${a.tipo}  ${a.arquivo}:${a.linha}  ${a.trecho}`);
      console.log(`[chefeGuarda] lidos ${JSON.stringify(inventario.lidosPorRaiz)}\n${linhas.join('\n')}`);
    }
    expect(avaliar(inventario.achados)).toEqual([]);
  });

  it('toda entrada da lista diz por que existe e para onde vai', () => {
    for (const [arquivo, m] of Object.entries(MIGRAR)) {
      expect({ arquivo, porque: m.porque.length > 20, destino: m.destino.length > 20 })
        .toEqual({ arquivo, porque: true, destino: true });
      expect(Object.values(m.contagem).every(n => Number.isInteger(n) && (n ?? 0) > 0)).toBe(true);
    }
    for (const [arquivo, porque] of Object.entries(CONSULTA_ZAPI)) expect({ arquivo, ok: porque.length > 20 }).toEqual({ arquivo, ok: true });
  });

  it('os clientes oficiais existem (isenção não aponta para arquivo sumido)', () => {
    for (const f of [CLIENTE_ZAPI, ...CLIENTES_GRAPH]) expect({ f, existe: existsSync(join(RAIZ, ...f.split('/'))) }).toEqual({ f, existe: true });
  });

  it('toda função de envio cru exportada por um arquivo do MIGRAR está em ENVIO_CRU_EXPORTADO, e a lista não tem nome velho', () => {
    let vistas = 0;
    for (const arquivo of Object.keys(MIGRAR)) {
      if (!existsSync(join(RAIZ, ...arquivo.split('/'))) || tipoDeScript(arquivo) === null) continue;
      const { exportadas, comOfensor } = funcoesExportadasComOfensor(arquivo);
      vistas += exportadas.length;
      const listadas = [...(ENVIO_CRU_EXPORTADO[arquivo] ?? [])].sort();
      expect({ arquivo, envioCru: comOfensor.sort() }).toEqual({ arquivo, envioCru: listadas });
    }
    // Controle positivo: a varredura de exports leu de verdade (o ioSend.ts exporta 5 funções).
    expect(vistas).toBeGreaterThanOrEqual(5);
    for (const arquivo of Object.keys(ENVIO_CRU_EXPORTADO)) expect({ arquivo, noMigrar: arquivo in MIGRAR }).toEqual({ arquivo, noMigrar: true });
  });
});

/**
 * Funções de topo exportadas por um arquivo, e quais delas levam a um ofensor de
 * TRANSPORTE (Z-API, Graph ou zapiPost cru), direto ou por um helper do próprio
 * arquivo. O chamador de envio cru (envio_cru) não entra: ele é robô, não
 * transporte, e é contado à parte.
 */
function funcoesExportadasComOfensor(arquivo: string): { exportadas: string[]; comOfensor: string[] } {
  const texto = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, tipoDeScript(arquivo)!);
  const linha = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const ofensas = inventario.achados.filter(a => a.arquivo === arquivo && a.regra !== 'envio_cru' && a.regra !== 'script'
    && !(a.regra === 'zapi' && a.tipo === 'consulta'));
  const funcs = new Map<string, { no: ts.Node; exportada: boolean }>();
  for (const st of sf.statements) {
    const exportada = (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && st.name) funcs.set(st.name.text, { no: st, exportada });
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          funcs.set(d.name.text, { no: d, exportada });
        }
      }
    }
  }
  const leva = new Set<string>();
  const chama = new Map<string, Set<string>>();
  for (const [nome, f] of funcs) {
    const de = linha(f.no.getStart(sf));
    const ate = linha(f.no.getEnd());
    if (ofensas.some(a => a.linha >= de && a.linha <= ate)) leva.add(nome);
    const chamados = new Set<string>();
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) chamados.add(n.expression.text);
      ts.forEachChild(n, visitar);
    };
    visitar(f.no);
    chama.set(nome, chamados);
  }
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const [nome, chamados] of chama) {
      if (!leva.has(nome) && [...chamados].some(c => leva.has(c))) { leva.add(nome); mudou = true; }
    }
  }
  const exportadas = [...funcs].filter(([, f]) => f.exportada).map(([n]) => n);
  return { exportadas, comOfensor: exportadas.filter(n => leva.has(n)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLE POSITIVO: a MESMA função de varredura, em código sintético na
// memória, TEM de achar cada ofensor. Sem isto, uma regex quebrada passa verde.
// ─────────────────────────────────────────────────────────────────────────────

const src = (...linhas: string[]): string => linhas.join('\n');
const resumo = (achados: Achado[]): string[] => achados.map(a => `${a.regra}:${a.tipo}`);

describe('chefeGuarda: controle positivo (ofensor sintético é pego)', () => {
  it('o zapiClient.ts real, sem a isenção, tem envio e caminho livre', () => {
    const achados = varrerFonte(readFileSync(join(RAIZ, ...CLIENTE_ZAPI.split('/')), 'utf8'), 'api/src/services/io/copiaDoCliente.ts');
    expect(resumo(achados)).toContain('zapi:envio');
    expect(resumo(achados)).toContain('zapi:caminho_livre');
    expect(avaliar(achados, {}, {}).length).toBeGreaterThan(0);
  });

  it('fetch cru ao Z-API num robô novo', () => {
    const achados = varrerFonte(src(
      'export async function avisar(id: string, tk: string, phone: string) {',
      '  await fetch(`https://api.z-api.io/instances/${id}/token/${tk}/send-text`, { method: "POST", body: JSON.stringify({ phone }) });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:envio']);
  });

  it('host da Z-API numa constante e o caminho montado em outro lugar', () => {
    const achados = varrerFonte(src(
      'const BASE = "https://api.z-api.io";',
      'export async function f(id: string, tk: string) {',
      '  const url = `${BASE}/instances/${id}/token/${tk}/send-image`;',
      '  return fetch(url, { method: "POST" });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:consulta', 'zapi:envio']);
    expect(avaliar(achados, {}, {}).length).toBe(2); // consulta fora da lista + envio novo
  });

  it('helper genérico de caminho variável e o tryReq(\'POST\', \'send-text\') futuro', () => {
    const achados = varrerFonte(src(
      'async function tryReq(method: string, path: string, c: any) {',
      '  const url = `https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`;',
      '  const opts: any = { method };',
      '  return fetch(url, opts);',
      '}',
      'export const x = () => tryReq("POST", "send-text", {});',
    ), 'api/src/routes/painelNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:caminho_livre', 'zapi:envio']);
  });

  it('cabeçalho Client-Token com a URL vinda de env', () => {
    const achados = varrerFonte(src(
      'export async function f(path: string) {',
      '  return fetch(process.env.ZAPI_URL + path, { method: "POST", headers: { "Client-Token": process.env.ZAPI_CLIENT_TOKEN! } });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:caminho_livre']);
  });

  it('molde /instances/.../token/ sem o host (host vindo de env)', () => {
    const achados = varrerFonte(src(
      'export const f = (id: string, tk: string) => fetch(`${process.env.ZAPI_HOST}/instances/${id}/token/${tk}/send-text`, { method: "POST" });',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['zapi:envio']);
  });

  it('POST no Graph fora do cliente oficial (host numa constante)', () => {
    const achados = varrerFonte(src(
      'const GRAPH = "https://graph.facebook.com/v21.0";',
      'export async function responder(pagina: string, para: string, token: string) {',
      '  await fetch(`${GRAPH}/${pagina}/messages?access_token=${token}`, { method: "POST", body: JSON.stringify({ recipient: { id: para } }) });',
      '}',
    ), 'api/src/services/instagram/roboNovo.ts');
    expect(resumo(achados)).toEqual(['graph:envio']);
    // O mesmo código dentro de um cliente oficial é isento.
    expect(avaliar(achados.map(a => ({ ...a, arquivo: 'api/src/services/instagram/fbMensagens.ts' })), {}, {})).toEqual([]);
  });

  it('https.request no Graph com path /replies e POST (host noutro literal)', () => {
    const achados = varrerFonte(src(
      'import https from "https";',
      'export function comentar(id: string) {',
      '  return https.request({ hostname: "graph.instagram.com", path: `/v25.0/${id}/replies`, method: "POST" });',
      '}',
    ), 'api/src/services/io/roboNovo.ts');
    expect(resumo(achados)).toEqual(['graph:envio']);
  });

  it('script local: host da Z-API, transporte importado e rota de envio da api', () => {
    expect(resumo(varrerFonte(src(
      'const r = await fetch(`https://api.z-api.io/instances/${ID}/token/${TK}/send-text`, { method: "POST" });',
    ), 'api/scripts/disparo-novo.mjs'))).toEqual(['zapi:envio']);

    expect(resumo(varrerFonte(src(
      'import { sendWhatsApp } from "../src/services/agents/zapiClient";',
      'for (const p of lista) await sendWhatsApp(p, "oi", "io");',
    ), 'api/scripts/disparo-novo.ts'))).toEqual(['script:import', 'script:chamada']);

    expect(resumo(varrerFonte(src(
      'const { sendHuman } = require("../dist/services/agents/zapiClient");',
      'sendHuman(p, ["oi"], "io");',
    ), 'api/scripts/disparo-novo.cjs'))).toEqual(['script:import', 'script:chamada']);

    expect(resumo(varrerFonte(src(
      'await fetch("https://api.solardoc.app/admin/io/send-text", { method: "POST" });',
    ), 'api/scripts/disparo-novo.ts'))).toEqual(['script:rota']);

    expect(resumo(varrerFonte(src(
      'r = requests.post(f"https://api.z-api.io/instances/{i}/token/{t}/send-text", json=b)',
    ), 'api/scripts/disparo.py'))).toEqual(['zapi:envio']);
  });

  it('template string com a URL e send-${tipo}: envio, mesmo num arquivo de CONSULTA_ZAPI', () => {
    const achados = varrerFonte(src(
      'export async function mandar(c: any, phone: string, tipo: string) {',
      '  await fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/send-${tipo}`, { method: "POST", body: JSON.stringify({ phone }) });',
      '}',
    ), 'api/src/services/agents/sdr/sdrIoPolling.ts');
    expect(resumo(achados)).toEqual(['zapi:envio']);
    expect(avaliar(achados).join('\n')).toContain('OFENSOR NOVO: api/src/services/agents/sdr/sdrIoPolling.ts');
  });

  it('host em variável: instância axios com baseURL da Z-API e z.post(\'/send-text\') não é rota, é envio', () => {
    const achados = varrerFonte(src(
      'import axios from "axios";',
      'export async function mandar(c: any, phone: string) {',
      '  const z = axios.create({ baseURL: `https://api.z-api.io/instances/${c.id}/token/${c.token}` });',
      '  await z.post("/send-text", { phone, message: "oi" });',
      '}',
    ), 'api/src/services/agents/sdr/sdrIoPolling.ts');
    expect(resumo(achados)).toEqual(['zapi:consulta', 'zapi:envio']);
    expect(avaliar(achados).join('\n')).toContain('OFENSOR NOVO: api/src/services/agents/sdr/sdrIoPolling.ts');

    // O host num let montado em pedaços também é pego.
    expect(resumo(varrerFonte(src(
      'let host = "https://api.z-" + "api.io";',
      'export const f = (id: string, tk: string) => fetch(`${host}/instances/${id}/token/${tk}/send-text`, { method: "POST" });',
    ), 'api/src/services/io/roboNovo.ts'))).toContain('zapi:envio');
  });

  it('send- sem letra depois (\'send-\' + k) num helper do painel: envio', () => {
    const achados = varrerFonte(src(
      'async function tryReq(method: string, path: string, c: any) {',
      '  return fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`, { method });',
      '}',
      'export const x = (k: string) => tryReq("POST", "send-" + k, {});',
    ), 'api/src/routes/zapiAdmin.ts');
    expect(resumo(achados)).toContain('zapi:envio');
  });

  it('rota nova em laço dentro do zapiAdmin.ts real (o arquivo da queda de 30/08): o número sobe e a guarda reprova', () => {
    const arquivo = 'api/src/routes/zapiAdmin.ts';
    const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
    const conta = (achados: Achado[]) => achados.filter(a => a.regra === 'zapi' && a.tipo === 'envio').length;
    const antes = varrerFonte(real, arquivo);
    for (const rota of [
      'router.post("/io/lote", async (req: any, res: any) => { for (const phone of req.body.lista) await fetch(`https://api.z-api.io/instances/${req.body.id}/token/${req.body.tk}/send-${req.body.tipo}`, { method: "POST", body: JSON.stringify({ phone }) }); res.json({ ok: true }); });',
      'router.post("/io/lote2", async (req: any, res: any) => { for (const phone of req.body.lista) await fetch(`https://api.z-api.io/instances/${req.body.id}/token/${req.body.tk}/send-text`, { method: "POST", body: JSON.stringify({ phone }) }); res.json({ ok: true }); });',
    ]) {
      const depois = varrerFonte(`${real}\n${rota}\n`, arquivo);
      expect(conta(depois)).toBe(conta(antes) + 1);
      const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
      expect(avaliar([...resto, ...depois]).join('\n')).toContain(`OFENSOR NOVO: ${arquivo}`);
    }
  });

  // [revisão] A base da instância vinha de função, propriedade ou let reatribuído
  // e o caminho era montado depois: `${base(c)}/send-text` resolve como
  // '${*}/send-text', e o send- só era procurado no começo. Nos 4 arquivos de
  // CONSULTA_ZAPI passava verde, e num arquivo novo reprovava só como consulta.
  it('base da instância vinda de função, propriedade ou let reatribuído: envio, também nos arquivos de CONSULTA_ZAPI', () => {
    const formatos: Record<string, string> = {
      funcao: 'const baseZ = (c: any) => `https://api.z-api.io/instances/${c.id}/token/${c.token}`;\n' +
        'export async function p3c(c: any, lista: string[]) { for (const phone of lista) await fetch(`${baseZ(c)}/send-text`, { method: "POST", body: JSON.stringify({ phone }) }); }',
      propriedade: 'export async function p3e(id: string, tk: string) { const cfg = { base: `https://api.z-api.io/instances/${id}/token/${tk}` }; await fetch(`${cfg.base}/send-text`, { method: "POST" }); }',
      let_reatribuido: 'export async function p3f(id: string, tk: string) { let b = ""; b = `https://api.z-api.io/instances/${id}/token/${tk}`; await fetch(`${b}/send-text`, { method: "POST" }); }',
      axios_url: 'import axios from "axios";\nconst bz = (c: any) => `https://api.z-api.io/instances/${c.id}/token/${c.token}`;\n' +
        'export async function p4c(c: any) { await axios({ method: "post", url: `${bz(c)}/send-text`, data: {} }); }',
    };
    const envios = (achados: Achado[]) => achados.filter(a => a.regra === 'zapi' && a.tipo === 'envio').length;
    for (const [nome, codigo] of Object.entries(formatos)) {
      // Num arquivo novo: reprova como ENVIO, não só como consulta.
      const novo = 'api/src/services/io/roboNovo.ts';
      const ach = varrerFonte(codigo, novo);
      expect({ nome, envio: resumo(ach).includes('zapi:envio') }).toEqual({ nome, envio: true });
      expect(avaliar([...inventario.achados, ...ach]).join('\n')).toContain(`OFENSOR NOVO: ${novo} tem 1 × zapi:envio`);
      // Anexado aos arquivos que podem consultar: o envio sobe 1 e reprova.
      for (const arquivo of Object.keys(CONSULTA_ZAPI)) {
        const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
        const depois = varrerFonte(`${real}\n${codigo}\n`, arquivo);
        expect({ nome, arquivo, a_mais: envios(depois) - envios(varrerFonte(real, arquivo)) }).toEqual({ nome, arquivo, a_mais: 1 });
        const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
        expect(avaliar([...resto, ...depois]).join('\n')).toMatch(new RegExp(`OFENSOR NOVO: ${arquivo.replace(/[.]/g, '\\.')} tem \\d+ × zapi:envio`));
      }
    }
  });

  it('instância axios chamada app com baseURL da Z-API: app.post(\'/send-text\') é envio, não rota', () => {
    const achados = varrerFonte(src(
      'import axios from "axios";',
      'export async function p4d(c: any) {',
      '  const app = axios.create({ baseURL: `https://api.z-api.io/instances/${c.id}/token/${c.token}` });',
      '  await app.post("/send-text", { phone: "1" });',
      '}',
    ), 'api/src/services/agents/sdr/sdrIoPolling.ts');
    expect(resumo(achados)).toContain('zapi:envio');
  });

  // [revisão] POST no Graph por um helper do próprio arquivo com o edge como
  // parâmetro: o template do helper termina em ${*} e o 'messages' vai solto,
  // sem barra. É o formato do helper genérico do igClient.ts, o natural de copiar.
  it('POST no Graph por helper com o edge em parâmetro: o literal do edge e o caminho livre contam', () => {
    const helper = 'const G = "https://graph.facebook.com/v21.0";\n' +
      'async function gpost(id: string, edge: string, body: unknown) { return fetch(`${G}/${id}/${edge}?access_token=x`, { method: "POST", body: JSON.stringify(body) }); }';
    const novo = 'api/src/services/instagram/roboNovo.ts';
    // Só o helper: caminho livre (manda para o edge que pedirem).
    expect(resumo(varrerFonte(helper, novo))).toEqual(['graph:caminho_livre']);
    // O helper chamado em laço com 'messages': o literal do edge é envio.
    const lote = varrerFonte(`${helper}\nexport async function lote(pg: string, lista: string[]) { for (const para of lista) await gpost(pg, "messages", { recipient: { id: para } }); }`, novo);
    expect(resumo(lote)).toEqual(['graph:caminho_livre', 'graph:envio']);
    expect(avaliar([...inventario.achados, ...lote]).join('\n')).toContain(`OFENSOR NOVO: ${novo}`);
    // O edge numa const passada ao helper também conta.
    expect(resumo(varrerFonte(`${helper}\nconst EDGE = "private_replies";\nexport const f = (c: string) => gpost(c, EDGE, {});`, novo))).toContain('graph:envio');
    // Dentro de um cliente oficial, isento.
    expect(avaliar(lote.map(a => ({ ...a, arquivo: 'api/src/services/instagram/igClient.ts' })), {}, {})).toEqual([]);
  });

  // [revisão] O enviarZapiIO é o fetch cru da linha io (no MIGRAR). A guarda só
  // via a definição: um robô novo que o importava passava verde. Agora quem
  // chama uma função de envio cru exportada por um arquivo do MIGRAR é contado
  // como o zapiPost cru: chamada nova fora dos chamadores registrados reprova.
  it('chamada nova ao enviarZapiIO ou ao encaminharMidiaAoConsultor fora dos chamadores registrados reprova', () => {
    const novo = 'api/src/services/io/roboNovo.ts';
    for (const codigo of [
      'import { enviarZapiIO } from "./ioSend";\nexport async function lote(lista: string[]) { for (const p of lista) await enviarZapiIO(p, "oi"); }',
      'import { enviarZapiIO as mandar } from "./ioSend";\nexport const f = (p: string) => mandar(p, "oi");',
      'import * as io from "./ioSend";\nexport const f = (p: string) => io.enviarZapiIO(p, "oi");',
      'const { enviarZapiIO } = require("./ioSend");\nexport const f = (p: string) => enviarZapiIO(p, "oi");',
      'export async function f(p: string) { const { enviarZapiIO } = await import("./ioSend"); return enviarZapiIO(p, "oi"); }',
      'import { encaminharMidiaAoConsultor } from "./encaminharMidiaConsultor";\nexport const f = (m: any) => encaminharMidiaAoConsultor(m);',
    ]) {
      const ach = varrerFonte(codigo, novo);
      expect({ codigo, r: resumo(ach) }).toEqual({ codigo, r: ['envio_cru:chamada'] });
      expect(avaliar([...inventario.achados, ...ach]).join('\n')).toContain(`OFENSOR NOVO: ${novo}`);
    }
    // Anexado a um robô real e a rotas reais (o lote do P6b): o número sobe e reprova.
    const robo = 'import { enviarZapiIO } from "./ioSend";\nexport async function lote(lista: string[]) { for (const p of lista) await enviarZapiIO(p, "oi"); }';
    const rota = 'import { enviarZapiIO } from "../services/io/ioSend";\n' +
      'router.post("/io/lote10", async (req: any, res: any) => { for (const phone of req.body.lista) await enviarZapiIO(phone, req.body.msg); res.json({ ok: true }); });';
    for (const [arquivo, codigo] of [
      ['api/src/services/io/sementeSolarService.ts', robo],
      ['api/src/services/io/avisosTickService.ts', robo],
      ['api/src/routes/zapiAdmin.ts', rota],
      ['api/src/routes/admin.ts', rota],
    ] as const) {
      const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
      const depois = varrerFonte(`${real}\n${codigo}\n`, arquivo);
      const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
      expect({ arquivo, r: avaliar([...resto, ...depois]).join('\n') }).toMatchObject({ arquivo, r: expect.stringContaining(`OFENSOR NOVO: ${arquivo}`) });
    }
  });

  it('zapiPost cru importado fora do zapiClient (direto, com alias e por namespace)', () => {
    expect(resumo(varrerFonte(src(
      'import { zapiPost as zp } from "../agents/zapiClient";',
      'export const f = (p: string) => zp("send-text", { phone: p, message: "oi" }, 2, "io");',
    ), 'api/src/services/io/roboNovo.ts'))).toEqual(['zapipost:chamada']);

    expect(resumo(varrerFonte(src(
      'import * as z from "../agents/zapiClient";',
      'export const f = (p: string) => z.zapiPost("send-image", { phone: p }, 2, "io");',
    ), 'api/src/services/io/roboNovo.ts'))).toEqual(['zapipost:chamada']);
  });

  it('avaliar() reprova arquivo novo, número que sobe e número que desce', () => {
    const real = inventario.achados;
    // Arquivo novo fora do mapa.
    const novo: Achado = { arquivo: 'api/src/services/io/roboNovo.ts', linha: 1, regra: 'zapi', tipo: 'envio', trecho: 'x' };
    expect(avaliar([...real, novo]).join('\n')).toContain('OFENSOR NOVO: api/src/services/io/roboNovo.ts');
    // O alvo sai do próprio mapa, para o autoteste não fixar arquivo (fixar o
    // admin.ts quebrou quando a limpeza apagou o /admin/io/send-text).
    const [alvoArq, alvoM] = Object.entries(MIGRAR)[0]!;
    const alvoChave = Object.keys(alvoM.contagem)[0]!;
    const [regra, tipo] = alvoChave.split(':') as [Regra, string];
    // Um ofensor a mais num arquivo já listado.
    const mais: Achado = { arquivo: alvoArq, linha: 9999, regra, tipo, trecho: 'x' };
    expect(avaliar([...real, mais]).join('\n')).toContain(`OFENSOR NOVO: ${alvoArq}`);
    // Um ofensor a menos (migrou e não baixou o mapa): tira só 1 achado real daquela chave.
    let tirou = false;
    const semUm = real.filter(a => {
      if (!tirou && a.arquivo === alvoArq && `${a.regra}:${a.tipo}` === alvoChave) { tirou = true; return false; }
      return true;
    });
    expect(tirou).toBe(true);
    expect(avaliar(semUm).join('\n')).toContain(`A catraca só aperta: ${alvoArq}`);
    // Leitura num arquivo fora da lista de consulta.
    const leitura: Achado = { arquivo: 'api/src/services/io/roboNovo.ts', linha: 1, regra: 'zapi', tipo: 'consulta', trecho: 'x' };
    expect(avaliar([...real, leitura]).join('\n')).toContain('fora de CONSULTA_ZAPI');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARQUIVO → ROBÔS PERMITIDOS: a guarda contra a classe errada. As quedas de
// 30/08 e 02/10 foram um remetente pedindo com o nome (e a conta) de outro.
// ─────────────────────────────────────────────────────────────────────────────

describe('chefeGuarda: arquivo → robôs permitidos, com a classe máxima de cada arquivo', () => {
  const pedido = (robo: string) => `export const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: '${robo}', destino: p }, agora);`;

  it('o mapa escrito na guarda é igual ao CLASSE_POR_ROBO (robô em arquivo novo muda os dois no mesmo diff)', () => {
    const { mapa } = mapaDerivado();
    const literal = Object.fromEntries(Object.entries(ROBOS_POR_ARQUIVO).map(([a, e]) => [a, { robos: [...e.robos].sort(), classeMaxima: e.classeMaxima }]));
    expect(literal).toEqual(mapa);
  });

  it('os 9 arquivos com robôs de classes diferentes estão documentados pelo nome', () => {
    const { classes } = mapaDerivado();
    const mistos = Object.fromEntries(Object.entries(classes).filter(([, cs]) => cs.length > 1));
    expect(mistos).toEqual(ARQUIVOS_MISTOS);
    expect(Object.keys(ARQUIVOS_MISTOS).length).toBe(9);
    // O pior deles: evento ao lado de frio de receita.
    expect(ARQUIVOS_MISTOS['services/dunningService.ts']).toEqual(['evento_p0', 'frio_receita_p4']);
  });

  it('arquivo novo pedindo robô de outro arquivo reprova; o arquivo do robô passa; nome sem registro reprova', () => {
    const novo = 'api/src/services/io/roboNovo.ts';
    const fora = varrerFonte(pedido('dunning_d0'), novo);
    expect(resumo(fora)).toEqual(['robo:fora_do_arquivo']);
    expect(avaliar([...inventario.achados, ...fora]).join('\n')).toContain(`OFENSOR NOVO: ${novo} tem 1 × robo:fora_do_arquivo`);
    expect(varrerFonte(pedido('dunning_d0'), 'api/src/services/dunningService.ts')).toEqual([]);
    expect(resumo(varrerFonte(pedido('robo_que_nao_existe'), novo))).toEqual(['robo:sem_registro']);
    // O próprio CHEFE e os testes ficam fora da regra.
    expect(varrerFonte(pedido('dunning_d0'), 'api/src/services/chefe/simularNovo.ts')).toEqual([]);
  });

  it('as quedas de classe errada reprovam: o reagenda pedindo como ep_agenda (02/10) e a rota do admin pedindo como agenda (30/08)', () => {
    for (const [arquivo, robo] of [
      ['api/src/services/io/eletropostoReagendaAuto.ts', 'ep_agenda'],
      ['api/src/routes/zapiAdmin.ts', 'ep_agenda'],
      ['api/src/routes/zapiAdmin.ts', 'manual_crm'],
    ] as const) {
      const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
      const depois = varrerFonte(`${real}\n${pedido(robo)}\n`, arquivo);
      const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
      expect({ arquivo, robo, r: avaliar([...resto, ...depois]).join('\n') })
        .toMatchObject({ arquivo, robo, r: expect.stringContaining(`OFENSOR NOVO: ${arquivo} tem 1 × robo:fora_do_arquivo`) });
    }
    // O robô certo, do arquivo certo, passa.
    const reagenda = 'api/src/services/io/eletropostoReagendaAuto.ts';
    const real = readFileSync(join(RAIZ, ...reagenda.split('/')), 'utf8');
    expect(resumo(varrerFonte(`${real}\n${pedido('ep_reagenda_auto')}\n`, reagenda)).filter(k => k.startsWith('robo:'))).toEqual([]);
  });

  it('DÍVIDA DECLARADA: num arquivo misto a regra não separa a classe; o lote do lembrete pedindo como dunning_d0 passa', () => {
    // O dunningService.ts hospeda dunning_lembrete (frio de receita) e
    // dunning_d0/d5/recuperado (evento). Pedir o lote do lembrete como
    // dunning_d0 passa nesta guarda e sai como evento: 60 em 10 min, de
    // madrugada e no domingo (números cravados no chefeQuedas). A defesa completa
    // é o passaporte por chamada, que prova o evento. Se este teste quebrar
    // porque a guarda passou a pegar, ótimo: troque por um controle positivo.
    const arquivo = 'api/src/services/dunningService.ts';
    const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
    const lote = 'export async function loteDoLembrete(decidir: any, estado: any, lista: string[], agora: number) { for (const p of lista) decidir(estado, { robo: \'dunning_d0\', destino: p }, agora); }';
    const depois = varrerFonte(`${real}\n${lote}\n`, arquivo);
    const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
    expect(avaliar([...resto, ...depois])).toEqual([]);
    expect(ROBOS_POR_ARQUIVO['services/dunningService.ts']!.classeMaxima).toBe('evento_p0');
  });
});

describe('chefeGuarda: controle negativo (o que NÃO é ofensor)', () => {
  it('comentário que cita o host não conta', () => {
    expect(varrerFonte(src(
      '// antes isto batia direto em https://api.z-api.io/instances/X/token/Y/send-text',
      '/* graph.facebook.com/v21.0/123/messages */',
      'export const x = 1;',
    ), 'api/src/services/io/qualquer.ts')).toEqual([]);
  });

  it('definição de rota da api (router.post(\'/send-text\')) não conta', () => {
    expect(resumo(varrerFonte(src(
      'router.post("/send-text", async (req, res) => {',
      '  const r = await fetch(`https://api.z-api.io/instances/${a}/token/${b}/status`);',
      '  res.json(await r.json());',
      '});',
    ), 'api/src/routes/zapiAdmin.ts'))).toEqual(['zapi:consulta']);
  });

  it('edge solto sem host do Graph no arquivo, ou fora de argumento de chamada, não conta', () => {
    expect(varrerFonte(src(
      'export const ROTULO = "messages";',
      'export const f = (x: any) => x.from("messages").select("*");',
    ), 'api/src/services/io/qualquer.ts')).toEqual([]);
    expect(varrerFonte(src(
      'const GRAPH = "https://graph.facebook.com/v21.0";',
      'export const CAMPOS = { aba: "comments" };',
      'export async function ler(id: string) { return fetch(`${GRAPH}/${id}?fields=comments`); }',
    ), 'api/src/services/metaNovo.ts')).toEqual([]);
  });

  it('GET provado de /comments e leitura de anúncio no Graph não contam', () => {
    expect(varrerFonte(src(
      'const GRAPH = "https://graph.facebook.com/v21.0";',
      'export async function ler(post: string, token: string) {',
      '  const r = await fetch(`${GRAPH}/${post}/comments?fields=id,message&access_token=${token}`);',
      '  const s = await fetch(`${GRAPH}/act_1/insights?access_token=${token}`, { method: "GET" });',
      '  return [await r.json(), await s.json()];',
      '}',
    ), 'api/src/services/metaNovo.ts')).toEqual([]);
  });

  it('texto "send-text" em arquivo que não fala com a Z-API não conta (fora de script)', () => {
    expect(varrerFonte(src(
      'export const ROTULO = "send-text";',
      'logger.info("send-text falhou");',
    ), 'api/src/services/io/qualquer.ts')).toEqual([]);
  });

  it('tipo literal com caminho send-* não é runtime', () => {
    expect(resumo(varrerFonte(src(
      'type Caminho = "send-text" | "send-image";',
      'export const f = () => fetch(`https://api.z-api.io/instances/${a}/token/${b}/me`);',
    ), 'api/src/services/io/zapiHealthMonitor.ts'))).toEqual(['zapi:consulta']);
  });
});
