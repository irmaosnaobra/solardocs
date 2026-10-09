import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname, posix } from 'path';
import * as ts from 'typescript';
import { CLASSE_POR_ROBO, CLASSES, Classe } from '../services/chefe/classes';
import { DIVERGENCIAS } from '../services/chefe/regulamento';

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
// O QUE REPROVA (fora da lista de migração abaixo). É exatamente isto, nada além
// (a guarda lê o código parado; o que não está escrito aqui passa):
//   zapi      fora de api/src/services/agents/zapiClient.ts, todo texto com o
//             host api.z-api.io, o molde /instances/${id}/token/${tk}/ ou o
//             cabeçalho Client-Token. O endpoint é o 1º segmento depois do
//             token. Tipos:
//               consulta       endpoint de CONSULTAS_ZAPI_PERMITIDAS (leitura e
//                              configuração: status, me, chats, contacts,
//                              qr-code, phone-exists, webhooks...) ou a base
//                              sozinha. Só precisa estar em CONSULTA_ZAPI;
//               envio          endpoint fixo fora da lista (send-*,
//                              forward-message, pin-message...);
//               caminho_livre  o caminho é variável e o método não é GET
//                              provado (helper genérico que manda o que pedirem).
//             Num arquivo que fala com a Z-API (tem o host, o molde ou o
//             Client-Token), conta também como envio (menos a definição de
//             rota da própria api, router.post('/x', handler)):
//               - send- no começo de um texto, depois de uma barra ou colado numa
//                 substituição (tryReq('POST','send-text'), 'send-' + k,
//                 `${base(c)}send-text`);
//               - forward-message em QUALQUER posição de qualquer texto (colado na
//                 base sem barra, 1º argumento de new URL, pedaço de um join);
//               - o caminho fora da lista depois de uma base que o arquivo não
//                 resolve, com ou sem a barra (`${base(c)}/x`, `${base(c)}x`,
//                 z.post('/x'), z.post('x') de uma instância com baseURL), quando
//                 o texto é ALVO de requisição (1º argumento de chamada ou de new,
//                 url/path/baseURL, const que vai a uma dessas) e o método não é
//                 GET provado; caminho variável ali é caminho_livre;
//               - o caminho passado a um helper do próprio arquivo que monta a
//                 URL (zapiGet(c, 'x'), tryReq('POST', 'x')) e o path: '...' de
//                 uma lista de tentativas.
//   graph     fora dos clientes oficiais (igClient, fbComentarios, fbMensagens),
//             toda ESCRITA (POST, PUT, PATCH, DELETE: tudo que não é GET provado)
//             num caminho do Graph, venha o método literal, de spread
//             ({ ...options, method: 'POST' }) ou de atribuição depois
//             (options.method = 'POST'). GET provado é: fetch sem opções ou com
//             opções sem method (literal ou numa const que só vai direto à
//             chamada), ou um helper do arquivo que só faz isso. O CAMINHO do
//             Graph é lido nestes casos, só num arquivo com o host do Graph
//             (graph.facebook.com ou graph.instagram.com) num literal:
//               - o host no próprio texto: edge fixo é envio, último segmento
//                 variável é caminho_livre;
//               - o texto começa com /vNN e é alvo de requisição (o path do
//                 https.request com o host noutro literal): idem;
//               - o texto vem depois de uma base não resolvida (`${*}/...`), ou
//                 começa com / e é alvo de requisição (o path sem versão do
//                 https.request, o 1º argumento de new URL com o host no 2º, o
//                 post de uma instância com baseURL do Graph): aí só conta o edge
//                 de MENSAGEM (messages, private_replies, replies, comments) ou o
//                 segmento variável com escrita provada.
//             Lista do permitido: só o /events da API de Conversões. E o edge
//             exato passado como argumento de chamada (gpost(pg, 'messages',
//             corpo)) é envio.
//   zapipost  REFERÊNCIA crua a zapiPost/zapiDelete fora do zapiClient.ts:
//             chamada, alias, .call, map, z.zapiPost, z['zapiPost'],
//             desestruturação do namespace e import z = require(...). Pula os
//             envios tipados (bolhas, sendFrio) por onde o CHEFE vai passar.
//   envio_cru REFERÊNCIA a uma função de envio cru exportada por um arquivo do
//             MIGRAR (ENVIO_CRU_EXPORTADO: enviarZapiIO, encaminharMidiaAoConsultor),
//             com as mesmas formas do zapipost. Cada chamador está no MIGRAR com
//             o número exato, e referência nova fora deles reprova.
//   script    em api/scripts e worker-prospeccao: importar o transporte da api,
//             chamar uma função de envio ou apontar para uma rota de envio. Disparo
//             passa a ser rota que passa pelo CHEFE, nunca script local.
//   robo      em api/src (fora do CHEFE): pedido com robo de um arquivo que não
//             está na lista daquele robô (ROBOS_POR_ARQUIVO, igual ao
//             CLASSE_POR_ROBO[*].arquivos), ou com nome sem registro. O nome é
//             lido quando o próprio arquivo o resolve: literal, 'x' as const,
//             'x' satisfies Y, <T>'x', const do arquivo, o atalho { robo }, os
//             dois ramos de um ternário, os dois lados de ?? e ||, let/var (o
//             inicializador e toda atribuição no arquivo, por nome, sem escopo),
//             padrão de parâmetro ou de desestruturação, propriedade de um objeto
//             do arquivo (ROBOS.agenda, ROBOS['agenda']) e a atribuição depois
//             (pedido.robo = 'x', pedido['robo'] = 'x').
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
//   CHEFE_GUARDA_INVENTARIO=1 npx vitest run src/__tests__/chefeGuarda.test.ts --silent=false --reporter=verbose
//
// LIMITES CONHECIDOS (escritos para ninguém achar que a guarda vê mais do que vê).
// Os de formato têm um teste que crava zero achado ("rodada 4, os formatos do
// verificador da rodada 3 e os limites que ficam"): no dia em que a guarda passar
// a pegar, o teste quebra e este texto muda junto.
//   - A GUARDA É REDE, NÃO PROVA. Ela lê o código parado e pega os formatos
//     escritos acima; formato que ninguém pensou passa até ser acrescentado. A
//     defesa completa é a CATRACA FÍSICA no zapiPost (próxima fase, com o livro
//     no banco): todo envio pela linha passa por ela com o passaporte do robô, ou
//     não sai. Até lá, guarda verde não prova que nada sai por fora.
//   - ESCOPO: só lê as pastas de RAIZES (api/src, api/api, api/scripts,
//     worker-prospeccao e cloudflare-worker). Ficam de fora dashboard/, widget/, plugcash/,
//     ebike-ecommerce/ (que tem rotas de API em src/app/api) e .github/workflows.
//     Hoje nenhuma delas fala com a Z-API nem manda pelo Graph (só texto de tela,
//     o nome do process-messages.yml e o pixel /events da loja), mas uma rota de
//     servidor nova ali, ou um curl num workflow para api.z-api.io, passaria sem
//     a guarda ver.
//   - Z-API: endpoint fora da lista que não é send-* nem forward-message, num
//     texto que NÃO é alvo direto de requisição (o pedaço de um join, uma
//     propriedade lida depois), num arquivo de CONSULTA_ZAPI, passa. Num arquivo
//     novo a base sozinha já reprova, como consulta fora da lista.
//   - Z-API: URL inteira vinda de env ou de outro arquivo, num arquivo sem o
//     host, sem o molde /instances/.../token/ e sem o cabeçalho Client-Token,
//     não aparece (fetch(`${base}/send-text`) com a base num parâmetro vindo de
//     fora, fetch(process.env.X)). Inclusive a base e o Client-Token EXPORTADOS
//     por um arquivo de CONSULTA_ZAPI e importados por um robô novo. Com a base
//     montada no próprio arquivo, aparece.
//   - Z-API: caminho depois de uma base não resolvida com GET provado não conta
//     (GET não manda nada na Z-API, e a base pode ser a da própria api).
//   - Graph: o host só na env (sem literal do host no arquivo) não aparece, e o
//     edge montado num arquivo sem host e passado a um helper de outro arquivo
//     também não (os helpers de hoje são privados).
//   - Graph: escrita com o caminho sem host e sem versão num edge que NÃO é de
//     mensagem (POST em /{pagina}/feed pelo https.request com o hostname noutro
//     literal) passa: sem host nem versão, só o edge de mensagem conta, para o
//     caminho da própria api não virar falso positivo.
//   - Graph: num arquivo com host do Graph, qualquer chamada com o literal
//     exato 'messages' ou 'comments' como argumento conta como envio (um
//     supabase.from('messages') ali daria falso positivo). Hoje não há nenhum.
//   - robo: nome vindo de parâmetro sem padrão, de import de outro arquivo, de
//     retorno de função ou de texto com variável (`ep_${tipo}`) não aparece. A
//     leitura de let/var é por nome no arquivo inteiro, sem escopo.
//   - robo: NÃO separa robôs do mesmo arquivo. São 8 arquivos com robô de evento
//     (5 mistos: whatsappAgentService, dunningService, webhook,
//     pixComprovanteService e ioIndicacoes; e 3 só de evento, fora de
//     ARQUIVOS_MISTOS: authController, paymentsController e trafegoController)
//     e 7 com robô de agenda (ARQUIVOS_COM_ROBO_DE_AGENDA). Ali um lote novo, com
//     o nome do robô de evento ou de agenda do próprio arquivo, passa: sai a 60
//     em 10 min como evento, ou fora dos freios de volume e da rajada por robô
//     como agenda. Em eletropostoRemarcar e eletropostoRespostas a oferta fria
//     mora junto da remarcação pedida (ep_remarcar_reativo, agenda): o lote de
//     oferta fria pedindo com esse nome sai como agenda, no domingo, a 30/h. A
//     defesa completa é o passaporte por chamada, que prova a classe: DÍVIDA
//     declarada, com os números cravados no chefeQuedas.
//   - envio cru: membro calculado (io['enviar' + 'ZapiIO'], io[k]) e função
//     re-exportada por um arquivo intermediário (barrel) não são seguidos: o
//     chamador não aparece. Hoje não há barrel desses.
//   - Isenção por ARQUIVO INTEIRO: um lote novo escrito dentro do zapiClient.ts,
//     do igClient.ts, do fbComentarios.ts ou do fbMensagens.ts passa (são os
//     transportes oficiais); a pasta services/chefe/ fica fora da regra robo.
//   - Quem chama sendWhatsApp/sendHuman sem passar pelo CHEFE NÃO é assunto
//     desta guarda: isso é a catraca de passaporte, que entra com o CHEFE ligado.
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
  // A função da Vercel (api/vercel.json declara api/index.ts): arquivo novo ali vira deploy.
  { pasta: 'api/api', obrigatoria: false },
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
  'services/io/eletropostoReagendaAuto.ts': { robos: ['ep_reagenda_auto'], classeMaxima: 'transacional_agenda_p3' },
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
  'services/io/solarAgenteQuiz.ts': { robos: ['solar_agente_quiz', 'solar_agente_recado'], classeMaxima: 'reativo_p1' },
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
  'services/io/solarAgenteQuiz.ts': ['reativo_p1', 'aviso_interno_p2'],
});

/**
 * Os 7 arquivos que hospedam um robô de AGENDA (CLASSE_POR_ROBO[*].agenda), com
 * os robôs frios que moram no mesmo arquivo. A regra robo não separa robôs do
 * mesmo arquivo: um lote novo escrito num deles, pedindo com o nome do robô de
 * agenda dali, passa e sai como agenda (fora dos freios de volume e da rajada por
 * robô). Nos dois que hospedam também a oferta fria, ela pode se passar pela
 * resposta a quem pediu para remarcar (ep_remarcar_reativo), que é agenda e não
 * foi rebaixada (regra do dono). DÍVIDA declarada: fecha com o passaporte por
 * chamada, na fase da catraca (números cravados no chefeQuedas).
 */
const ARQUIVOS_COM_ROBO_DE_AGENDA: Readonly<Record<string, { agenda: readonly string[]; frio: readonly string[] }>> = Object.freeze({
  'services/io/eletropostoAgenda.ts': { agenda: ['ep_agenda'], frio: [] },
  'services/io/eletropostoAlerta10min.ts': { agenda: ['ep_alerta_10min'], frio: [] },
  'services/io/eletropostoCobraSim.ts': { agenda: ['ep_cobra_sim'], frio: [] },
  'services/io/eletropostoReagendaAuto.ts': { agenda: ['ep_reagenda_auto'], frio: [] },
  'services/io/eletropostoRemarcar.ts': { agenda: ['ep_remarcar_reativo'], frio: ['ep_oferta_fria'] },
  'services/io/eletropostoRespostas.ts': { agenda: ['ep_remarcar_reativo'], frio: ['ep_oferta_fria'] },
  'services/io/solarAgendaGiovanna.ts': { agenda: ['giovanna_agenda'], frio: [] },
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
/**
 * Portão da regra robo: o arquivo cita `robo` como palavra. O AST lê o pedido
 * com o nome literal, 'x' as const, 'x' satisfies Y, const do arquivo e o atalho
 * { robo } com const local.
 */
const PEDIDO_COM_ROBO = /\brobo\b/;

/**
 * LISTA DO PERMITIDO da Z-API: as CONSULTAS (leitura e configuração da
 * instância), pelo primeiro segmento do caminho depois de /token/<tk>/. Nome a
 * nome, sem prefixo: quando a guarda acha o caminho (os casos de O QUE REPROVA),
 * endpoint fora daqui é ENVIO (send-*, forward-message, um que a Z-API lançar
 * amanhã). O caminho que ela não acha passa (LIMITES CONHECIDOS). Levantado com git grep no
 * repo (zapiAdmin, mcp, sdrIoPolling, zapiHealthMonitor) mais os de leitura da
 * documentação (qr-code, phone-exists, device).
 */
const CONSULTAS_ZAPI_PERMITIDAS: ReadonlySet<string> = new Set([
  // leitura
  'status', 'me', 'device', 'qr-code', 'phone-exists', 'contacts',
  'chats', 'chat-messages', 'messages', 'messages-by-phone', 'messages-multi-device', 'queue',
  // configuração (zapiAdmin.ts /io/setup e /io/restart)
  'restart', 'webhooks', 'update-webhook', 'update-webhook-received', 'update-webhook-received-delivery',
  'update-every-webhooks', 'update-every-webhook', 'update-receive-message-call-back', 'update-on-message-received',
  'update-receive-callback-sent-by-me', 'update-auto-read-message', 'update-webhook-message-status',
]);

/**
 * LISTA DO PERMITIDO do Graph: os edges em que se ESCREVE fora dos clientes
 * oficiais. Nenhum deles é mensagem a alguém:
 *  - events: API de Conversões (metaPixel.ts, pixelController.ts, metaCapi.ts),
 *    evento de anúncio à Meta;
 *  - customaudiences e usersreplace: público de anúncio da conta (criar o público
 *    e trocar a lista com hash), em services/meta/clientesQuentes.ts (09/10/2026).
 */
const GRAPH_ESCRITA_PERMITIDA: ReadonlySet<string> = new Set(['events', 'customaudiences', 'usersreplace']);
/** Os edges de mensagem do Graph (DM, resposta, comentário, resposta privada). */
const EDGES_MENSAGEM_GRAPH: ReadonlySet<string> = new Set(['messages', 'private_replies', 'replies', 'comments']);

// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA — a mesma função roda no disco e nas fixtures do controle positivo.
// ─────────────────────────────────────────────────────────────────────────────

const CORINGA = '${*}';
const HOST_ZAPI = /api\.z-api\.io/i;
const URL_ZAPI_SEM_HOST = /\/instances\/\$\{[^}]*\}\/token\//;
// send- sem exigir letra depois: `send-${tipo}` e 'send-' + k também são envio.
const ZAPI_ENVIO = /(^|\/)send-/i;
// No começo, depois de uma barra ou colado numa substituição: '${*}/send-text' e
// '${*}send-text' são a base da instância vinda de função, propriedade ou let
// reatribuído, com o caminho montado depois (com ou sem a barra).
const PATH_ENVIO_SOLTO = /(^|[/}])send-/i;
/**
 * O forward-message (encaminhar mensagem: manda para quem a lista disser) em
 * QUALQUER posição de qualquer texto, num arquivo que fala com a Z-API: colado na
 * base sem barra (`${base(c)}forward-message`), 1º argumento de new URL, pedaço de
 * um join. Nenhum arquivo do disco cita o nome, então não há falso positivo.
 */
const ZAPI_FORWARD = /forward-message/i;
/** Caminho depois de uma base que o arquivo não resolve: com barra ('${*}/x', '/x') ou colado nela ('${*}x'). */
const CAMINHO_DEPOIS_DA_BASE = /^(?:(?:\$\{\*\})?\/[^/]|\$\{\*\}[a-z])/i;
const CABECALHO_ZAPI = /^client-token$/i;
const HOST_GRAPH = /graph\.(facebook|instagram)\.com/i;
/** Host (e versão) do Graph no começo de uma URL: o que sobra é o caminho. */
const PREFIXO_GRAPH = /^.*?graph\.(?:facebook|instagram)\.com(?:\/v\d+(?:\.\d+)?)?/i;
/** Caminho com a versão na frente (o path do https.request, com o host noutro literal). */
const VERSAO_GRAPH = /^\/v\d+(?:\.\d+)?(?=\/|$)/;
/** O edge sozinho, passado como argumento a um helper do próprio arquivo. */
const EDGE_SOLTO_GRAPH = /^(messages|private_replies|replies|comments)$/i;
/** Parece caminho de API (sem espaço, começa com letra): 'update-webhook', 'chats/${*}?x=1'. */
const PARECE_CAMINHO = /^[a-z][a-z0-9_-]*(?:[/?#&].*)?$/i;
const VERBOS_HTTP = /^(get|post|put|patch|delete)$/i;
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
    else if (HOST_GRAPH.test(l) && /\/(messages|private_replies|replies|comments)(?=$|[/?#&])/i.test(l)) achados.push({ ...base, regra: 'graph', tipo: 'envio' });
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
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
    || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
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

/**
 * Os nomes de robô que uma expressão pode ter, resolvidos no próprio arquivo:
 * texto (com as const, satisfies, <T> e parênteses), const, os dois ramos do
 * ternário, os dois lados de ?? e ||, let/var (o inicializador e toda atribuição
 * NOME = ... no arquivo), o padrão de parâmetro ou de desestruturação, e a
 * propriedade de um objeto do arquivo (ROBOS.agenda, ROBOS['agenda']). É por
 * NOME no arquivo inteiro, sem escopo. O que não resolve (parâmetro sem padrão,
 * import de outro arquivo, retorno de função, texto com variável) fica de fora:
 * é limite declarado.
 */
function nomesDoRobo(e: ts.Node, consts: ReadonlyMap<string, string>, sf: ts.SourceFile, prof = 0, vistos: Set<string> = new Set()): string[] {
  if (prof > 8) return [];
  let x: ts.Node = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)
    || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  const sub = (y: ts.Node) => nomesDoRobo(y, consts, sf, prof + 1, vistos);
  if (ts.isConditionalExpression(x)) return [...sub(x.whenTrue), ...sub(x.whenFalse)];
  if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...sub(x.left), ...sub(x.right)];
  }
  if (ts.isIdentifier(x)) {
    const c = consts.get(x.text);
    if (c !== undefined) return c.includes(CORINGA) ? [] : [c];
    if (vistos.has(x.text)) return [];
    vistos.add(x.text);
    return valoresDaVariavel(x.text, sf).flatMap(sub);
  }
  const acesso = ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) ? { obj: x.expression.text, chave: x.name.text }
    : ts.isElementAccessExpression(x) && ts.isIdentifier(x.expression) && ts.isStringLiteral(x.argumentExpression)
      ? { obj: x.expression.text, chave: x.argumentExpression.text } : null;
  if (acesso) {
    const d = declaracaoDeObjeto(sf, acesso.obj);
    const p = d?.obj.properties.find(pp => ts.isPropertyAssignment(pp) && nomeDaPropriedade(pp.name) === acesso.chave);
    return p && ts.isPropertyAssignment(p) ? sub(p.initializer) : [];
  }
  const t = resolverTexto(x, consts);
  return t !== null && !t.includes(CORINGA) ? [t] : [];
}

/** O que uma variável NOME pode valer no arquivo: let/var com inicializador, toda atribuição NOME = ..., padrão de parâmetro e de desestruturação. */
function valoresDaVariavel(nome: string, sf: ts.SourceFile): ts.Expression[] {
  const out: ts.Expression[] = [];
  const visitar = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === nome && n.initializer) {
      out.push(n.initializer);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === nome) out.push(n.right);
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
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

/**
 * Método de um objeto de opções ({ method: 'POST' }). Sem a chave e sem spread:
 * GET (padrão do fetch e do https.request). A chave depois de um spread vale
 * ({ ...options, method: 'POST' } é POST); spread depois dela, ou sem ela, é
 * DESCONHECIDO (o spread pode trazer qualquer método).
 */
function metodoDoObjeto(o: ts.ObjectLiteralExpression): Metodo {
  let atual: Metodo = 'GET';
  for (const p of o.properties) {
    if (ts.isSpreadAssignment(p)) { atual = 'DESCONHECIDO'; continue; }
    if (nomeDaPropriedade(p.name) !== 'method') continue;
    atual = ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))
      ? normalizarMetodo(p.initializer.text) : 'DESCONHECIDO';
  }
  return atual;
}

/** const NOME = { ... } no arquivo (o primeiro que achar). */
function declaracaoDeObjeto(sf: ts.SourceFile, nome: string): { decl: ts.VariableDeclaration; obj: ts.ObjectLiteralExpression } | null {
  let achou: { decl: ts.VariableDeclaration; obj: ts.ObjectLiteralExpression } | null = null;
  const visitar = (n: ts.Node): void => {
    if (achou) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nome && n.initializer) {
      let ini: ts.Expression = n.initializer;
      while (ts.isParenthesizedExpression(ini) || ts.isAsExpression(ini) || ts.isSatisfiesExpression(ini)) ini = ini.expression;
      if (ts.isObjectLiteralExpression(ini)) { achou = { decl: n, obj: ini }; return; }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return achou;
}

/**
 * Método de um objeto de opções guardado numa variável: o método dele, mais toda
 * atribuição posterior (options.method = 'POST') e todo spread com chave
 * ({ ...options, method: 'POST' }). GET só quando provado: nenhum método em lugar
 * nenhum e a variável só passada direto a uma chamada.
 */
function metodoDaVariavelObjeto(decl: ts.VariableDeclaration, obj: ts.ObjectLiteralExpression): Metodo {
  const nome = (decl.name as ts.Identifier).text;
  const metodos: Metodo[] = [metodoDoObjeto(obj)];
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === nome && n !== decl.name) {
      const pai = n.parent;
      if (ts.isPropertyAccessExpression(pai) && pai.expression === n) {
        const atrib = pai.parent;
        if (pai.name.text === 'method' && ts.isBinaryExpression(atrib) && atrib.left === pai
          && atrib.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          metodos.push(ts.isStringLiteral(atrib.right) || ts.isNoSubstitutionTemplateLiteral(atrib.right) ? normalizarMetodo(atrib.right.text) : 'DESCONHECIDO');
        }
      } else if (ts.isSpreadAssignment(pai) && ts.isObjectLiteralExpression(pai.parent)) {
        // A chave depois do spread decide; sem ela, vale o método do próprio objeto.
        const depois = pai.parent.properties.slice(pai.parent.properties.indexOf(pai) + 1);
        const chave = depois.filter(x => !ts.isSpreadAssignment(x) && nomeDaPropriedade(x.name) === 'method').pop();
        if (chave) {
          metodos.push(ts.isPropertyAssignment(chave) && (ts.isStringLiteral(chave.initializer) || ts.isNoSubstitutionTemplateLiteral(chave.initializer))
            ? normalizarMetodo(chave.initializer.text) : 'DESCONHECIDO');
        } else if (depois.some(ts.isSpreadAssignment)) metodos.push('DESCONHECIDO');
      } else if (!((ts.isCallExpression(pai) || ts.isNewExpression(pai)) && (pai.arguments ?? []).some(x => x === n))) {
        metodos.push('DESCONHECIDO'); // passada adiante, devolvida, guardada: não dá para provar
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(escopoDe(decl));
  const naoGet = metodos.find(m => m !== 'GET' && m !== 'DESCONHECIDO');
  if (naoGet) return naoGet;
  return metodos.includes('DESCONHECIDO') ? 'DESCONHECIDO' : 'GET';
}

/** Funções declaradas no arquivo, pelo nome (function f, const f = () => ..., e as aninhadas). */
function funcoesLocais(sf: ts.SourceFile): Map<string, ts.SignatureDeclaration & { body?: ts.Node }> {
  const mapa = new Map<string, ts.SignatureDeclaration & { body?: ts.Node }>();
  const visitar = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && !mapa.has(n.name.text)) mapa.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && !mapa.has(n.name.text)) {
      mapa.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return mapa;
}

function metodoDaChamada(c: ts.CallExpression, prof = 0): Metodo {
  const nome = nomeDoChamado(c);
  if (!nome) return 'DESCONHECIDO';
  const verbo = nome.toLowerCase();
  if (verbo === 'get' || verbo === 'post' || verbo === 'put' || verbo === 'patch' || verbo === 'delete') {
    return normalizarMetodo(verbo);
  }
  if (nome !== 'fetch') return prof < 2 && ts.isIdentifier(c.expression) ? metodoDoHelperLocal(c, prof) : 'DESCONHECIDO';
  const opcoes = c.arguments[1];
  if (!opcoes) return 'GET';
  if (ts.isObjectLiteralExpression(opcoes)) return metodoDoObjeto(opcoes);
  if (ts.isIdentifier(opcoes)) {
    const d = declaracaoDeObjeto(c.getSourceFile(), opcoes.text);
    return d ? metodoDaVariavelObjeto(d.decl, d.obj) : 'DESCONHECIDO';
  }
  return 'DESCONHECIDO';
}

/**
 * Helper do próprio arquivo que recebe a URL no 1º parâmetro (o lerJson do
 * metaConjuntos.ts): GET provado só quando, lá dentro, todo uso do parâmetro é
 * o 1º argumento de uma chamada com GET provado. O resto é DESCONHECIDO.
 */
function metodoDoHelperLocal(c: ts.CallExpression, prof: number): Metodo {
  const nome = (c.expression as ts.Identifier).text;
  const f = funcoesLocais(c.getSourceFile()).get(nome);
  const param = f?.parameters[0];
  if (!f || !f.body || !param || !ts.isIdentifier(param.name)) return 'DESCONHECIDO';
  const p = param.name.text;
  const metodos: Metodo[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === p && n !== param.name) {
      const a = subirEmbrulho(n);
      metodos.push(a.parent && ts.isCallExpression(a.parent) && a.parent.arguments[0] === a ? metodoDaChamada(a.parent, prof + 1) : 'DESCONHECIDO');
    }
    ts.forEachChild(n, visitar);
  };
  visitar(f.body);
  if (metodos.length === 0) return 'DESCONHECIDO';
  return metodos.find(m => m !== 'GET') ?? 'GET';
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
    if (nome === 'path' || nome === 'url' || nome === 'uri') {
      // GET só quando o objeto vai literal para a chamada; guardado numa
      // variável, vale o método que ela recebe depois (spread, atribuição).
      const obj = p.parent;
      const fora = subirEmbrulho(obj);
      if (fora.parent && (ts.isCallExpression(fora.parent) || ts.isNewExpression(fora.parent)) && (fora.parent.arguments ?? []).some(x => x === fora)) {
        return metodoDoObjeto(obj);
      }
      if (fora.parent && ts.isVariableDeclaration(fora.parent) && fora.parent.initializer === fora && ts.isIdentifier(fora.parent.name)) {
        return metodoDaVariavelObjeto(fora.parent, obj);
      }
    }
  }
  return 'DESCONHECIDO';
}

/**
 * O texto é ALVO de requisição: 1º argumento de chamada ou de new (fetch(x),
 * z.post(x), new URL(x)), propriedade url/path/baseURL, ou const que vai a uma
 * chamada dessas.
 */
function ehAlvoDeRequisicao(no: ts.Node): boolean {
  const a = subirEmbrulho(no);
  const p = a.parent;
  if (!p) return false;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.[0] === a) return true;
  if (ts.isPropertyAssignment(p) && ['url', 'uri', 'path', 'baseURL', 'baseUrl'].includes(nomeDaPropriedade(p.name) ?? '')) return true;
  if (ts.isVariableDeclaration(p) && p.initializer === a && ts.isIdentifier(p.name)) {
    const nome = p.name.text;
    let usado = false;
    const procurar = (n: ts.Node): void => {
      if (usado) return;
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments?.[0] && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === nome) usado = true;
      ts.forEachChild(n, procurar);
    };
    procurar(escopoDe(p));
    return usado;
  }
  return false;
}

/** Segmento de um caminho: base (nada), variável (tem ${*}) ou um nome fixo. */
type Segmento = { tipo: 'base' } | { tipo: 'variavel' } | { tipo: 'fixo'; nome: string };

/** O 1º segmento do caminho (o endpoint da Z-API). */
function primeiroSegmento(caminho: string): Segmento {
  const r = caminho.replace(/^\/+/, '');
  const nome = r.split(/[/?#&]/)[0] ?? '';
  if (!nome) return { tipo: 'base' };
  if (nome.includes(CORINGA)) return { tipo: 'variavel' };
  return { tipo: 'fixo', nome: nome.toLowerCase() };
}

/** O último segmento do caminho, sem a query (o edge do Graph). */
function ultimoSegmento(caminho: string): Segmento {
  const segs = (caminho.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  const nome = segs[segs.length - 1];
  if (!nome) return { tipo: 'base' };
  if (nome.includes(CORINGA)) return { tipo: 'variavel' };
  return { tipo: 'fixo', nome: nome.toLowerCase() };
}

/** Caminho da Z-API depois de /token/<tk>/ (ou do host, sem o molde). */
function caminhoZapi(texto: string): string {
  const molde = /\/token\/[^/]*\/?(.*)$/.exec(texto);
  if (molde) return molde[1]!;
  const host = /api\.z-api\.io(.*)$/i.exec(texto);
  return host ? host[1]!.replace(/^\/instances(?:\/[^/]*)?/, '') : texto;
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

/**
 * Pela LISTA DO PERMITIDO, num texto com a URL da Z-API: endpoint fora de
 * CONSULTAS_ZAPI_PERMITIDAS é envio (forward-message, send-*, um novo); caminho variável sem GET provado
 * é caminho livre; a base sozinha (sem caminho) é consulta.
 */
function classificarZapi(texto: string, metodo: Metodo): 'envio' | 'caminho_livre' | 'consulta' {
  if (ZAPI_ENVIO.test(texto.replace(/^https?:\/\/[^/]+/i, ''))) return 'envio';
  const seg = primeiroSegmento(caminhoZapi(texto));
  if (seg.tipo === 'base') return 'consulta';
  if (seg.tipo === 'variavel') return metodo === 'GET' ? 'consulta' : 'caminho_livre';
  return CONSULTAS_ZAPI_PERMITIDAS.has(seg.nome) ? 'consulta' : 'envio';
}

/**
 * Graph fora dos clientes: todo POST, PUT, PATCH ou DELETE (tudo que não é GET
 * provado) é escrita. Edge de escrita permitido (/events) passa; edge fixo é
 * envio; último segmento variável é caminho livre. Com a base NÃO resolvida
 * (`${*}/...`), só conta edge de mensagem, ou segmento variável com escrita provada.
 */
function classificarGraph(caminho: string, metodo: Metodo, baseSolta: boolean): 'envio' | 'caminho_livre' | null {
  if (metodo === 'GET') return null;
  const seg = ultimoSegmento(caminho);
  if (seg.tipo === 'base') return null;
  if (seg.tipo === 'fixo') {
    if (GRAPH_ESCRITA_PERMITIDA.has(seg.nome)) return null;
    return !baseSolta || EDGES_MENSAGEM_GRAPH.has(seg.nome) ? 'envio' : null;
  }
  return !baseSolta || (metodo !== 'DESCONHECIDO') ? 'caminho_livre' : null;
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
    // import io = require('./ioSend'): o nome vira namespace vigiado.
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
      && ts.isStringLiteral(n.moduleReference.expression)) {
      registrarModulo(n, n.moduleReference.expression.text, imp => { imp.namespaces.push(n.name.text); });
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
    if (olhaRobo && (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && nomeDaPropriedade(n.name) === 'robo') {
      // 'x', 'x' as const, 'x' satisfies Y, <T>'x', (x), const do arquivo, o atalho
      // { robo }, o ternário (os dois ramos), let/var com textos, o padrão do
      // parâmetro, o objeto de constantes (ROBOS.agenda) e a ?? ou ||.
      const alvo = ts.isShorthandPropertyAssignment(n) ? n.name : n.initializer;
      for (const nome of nomesDoRobo(alvo, consts, sf)) pedidosDeRobo.push({ no: n, nome });
    }
    // Atribuição depois: pedido.robo = 'ep_agenda' (ou pedido['robo'] = ...).
    if (olhaRobo && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ((ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'robo')
        || (ts.isElementAccessExpression(n.left) && ts.isStringLiteral(n.left.argumentExpression) && n.left.argumentExpression.text === 'robo'))) {
      for (const nome of nomesDoRobo(n.right, consts, sf)) pedidosDeRobo.push({ no: n, nome });
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
    if (falaComZapi && !rota && (PATH_ENVIO_SOLTO.test(x.texto) || ZAPI_FORWARD.test(x.texto))) {
      add(x.no, 'zapi', 'envio', x.texto);
      continue;
    }
    // Caminho montado depois de uma base que o arquivo não resolve, com ou sem a
    // barra (`${base(c)}/x`, `${base(c)}x`, z.post('/x')), ALVO de requisição:
    // endpoint fora da lista do permitido, sem GET provado, é envio (GET não manda
    // nada na Z-API, e a base pode ser a da própria api: o mcp.ts lê
    // `${BASE}/cron/...` por GET).
    if (falaComZapi && !rota && CAMINHO_DEPOIS_DA_BASE.test(x.texto) && ehAlvoDeRequisicao(x.no) && metodoDoUso(x.no) !== 'GET') {
      const seg = primeiroSegmento(x.texto.replace(/^\$\{\*\}/, ''));
      if (seg.tipo === 'fixo' && !CONSULTAS_ZAPI_PERMITIDAS.has(seg.nome)) { add(x.no, 'zapi', 'envio', x.texto); continue; }
      if (seg.tipo === 'variavel') { add(x.no, 'zapi', 'caminho_livre', x.texto); continue; }
    }
    // Graph fora dos clientes: escrita (o que não é GET provado) num caminho que
    // a guarda lê (os casos de O QUE REPROVA).
    if (temHostGraph && !rota) {
      let caminho: string | null = null;
      let baseSolta = false;
      if (HOST_GRAPH.test(x.texto)) caminho = x.texto.replace(PREFIXO_GRAPH, '');
      else if (VERSAO_GRAPH.test(x.texto) && ehAlvoDeRequisicao(x.no)) caminho = x.texto.replace(VERSAO_GRAPH, '');
      else if (x.texto.startsWith(`${CORINGA}/`)) { caminho = x.texto.slice(CORINGA.length); baseSolta = true; }
      // Caminho sem host e sem versão, alvo de requisição (o path do
      // https.request com o hostname noutro literal, o 1º argumento de new URL
      // com o host no 2º, o post de uma instância com baseURL do Graph): conta
      // como a base solta, ou seja, só o edge de MENSAGEM ou o segmento variável
      // com escrita provada.
      else if (x.texto.startsWith('/') && ehAlvoDeRequisicao(x.no)) { caminho = x.texto; baseSolta = true; }
      const tipo = caminho === null ? null : classificarGraph(caminho, metodoDoUso(x.no), baseSolta);
      if (tipo) { add(x.no, 'graph', tipo, x.texto); continue; }
    }
    if (script && !rota && ROTA_DE_ENVIO.test(x.texto)) add(x.no, 'script', 'rota', x.texto);
  }

  // ── Z-API: o caminho passado a um helper do próprio arquivo que monta a URL
  // (tryReq('POST', 'forward-message'), zapiGet(c, 'status')) e o path: '...' de
  // uma lista de tentativas. Fora da lista do permitido, é envio.
  if (falaComZapi) {
    const helpers = new Set<string>();
    for (const x of nos) {
      if (!HOST_ZAPI.test(x.texto) && !URL_ZAPI_SEM_HOST.test(x.texto)) continue;
      for (let a: ts.Node | undefined = x.no.parent; a && !ts.isSourceFile(a); a = a.parent) {
        if (ts.isFunctionDeclaration(a) && a.name) { helpers.add(a.name.text); break; }
        if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && ts.isVariableDeclaration(a.parent) && ts.isIdentifier(a.parent.name)) { helpers.add(a.parent.name.text); break; }
      }
    }
    const jaContado = new Set(achados.map(a => a.linha + '|' + a.trecho));
    const checar = (arg: ts.Node, t: string, onde: string): void => {
      if (VERBOS_HTTP.test(t) || !PARECE_CAMINHO.test(t) || PATH_ENVIO_SOLTO.test(t)) return;
      const seg = primeiroSegmento(t);
      if (seg.tipo !== 'fixo' || CONSULTAS_ZAPI_PERMITIDAS.has(seg.nome)) return;
      const trecho = `${onde}(… '${t}' …)`;
      if (!jaContado.has(linhaDe(arg) + '|' + trecho)) add(arg, 'zapi', 'envio', trecho);
    };
    for (const c of chamadas) {
      if (!ts.isIdentifier(c.expression) || !helpers.has(c.expression.text)) continue;
      for (const arg of c.arguments) {
        const t = ehLiteralDeTexto(arg) ? resolverTexto(arg, consts) : null;
        if (t !== null) checar(arg, t, c.expression.text);
      }
    }
    const visitarPath = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && nomeDaPropriedade(n.name) === 'path' && ehLiteralDeTexto(n.initializer)) {
        const t = resolverTexto(n.initializer, consts);
        if (t !== null) checar(n.initializer, t, 'path');
      }
      ts.forEachChild(n, visitarPath);
    };
    visitarPath(sf);
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
    // Desestruturação do namespace: const { enviarZapiIO: mandar } = io.
    const visitarDesestruturacao = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
        let ini: ts.Expression = n.initializer;
        while (ts.isParenthesizedExpression(ini) || ts.isAsExpression(ini) || ts.isNonNullExpression(ini) || ts.isAwaitExpression(ini)) ini = ini.expression;
        if (ts.isIdentifier(ini)) {
          for (const imp of imps) {
            if (!imp.namespaces.includes(ini.text)) continue;
            for (const el of n.name.elements) {
              const importado = nomeDaPropriedade(el.propertyName) ?? (ts.isIdentifier(el.name) ? el.name.text : null);
              if (importado && imp.nomes.includes(importado) && ts.isIdentifier(el.name)) imp.locais.push(el.name.text);
            }
          }
        }
      }
      ts.forEachChild(n, visitarDesestruturacao);
    };
    visitarDesestruturacao(sf);
    const nomes = new Set(imps.flatMap(i => i.nomes));
    const locais = new Set(imps.flatMap(i => i.locais));
    const namespaces = new Set(imps.flatMap(i => i.namespaces));
    // Toda REFERÊNCIA conta, não só a chamada: const mandar = enviarZapiIO,
    // enviarZapiIO.call(...), lista.map(enviarZapiIO), io.enviarZapiIO.
    let chamadasCruas = 0;
    const declaracoes = new Set<ts.Node>(imps.map(i => i.no));
    const ehDeclaracao = (id: ts.Identifier): boolean => {
      const pai = id.parent;
      if (ts.isImportSpecifier(pai) || ts.isImportClause(pai) || ts.isNamespaceImport(pai) || ts.isExportSpecifier(pai)) return true;
      if ((ts.isBindingElement(pai) || ts.isVariableDeclaration(pai) || ts.isParameter(pai)) && pai.name === id) return true;
      if (ts.isBindingElement(pai) && pai.propertyName === id) return true;
      for (let a: ts.Node | undefined = pai; a; a = a.parent) if (declaracoes.has(a)) return true;
      return false;
    };
    const visitarRef = (n: ts.Node): void => {
      const membro = ts.isPropertyAccessExpression(n) ? n.name.text
        : ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) ? n.argumentExpression.text : null;
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && ts.isIdentifier(n.expression)
        && namespaces.has(n.expression.text) && membro !== null && nomes.has(membro)) {
        // io.enviarZapiIO e io['enviarZapiIO'].
        const alvo = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent : n;
        add(alvo, regra, 'chamada', alvo.getText(sf));
        chamadasCruas++;
        return;
      }
      if (ts.isIdentifier(n) && locais.has(n.text) && !ehDeclaracao(n)
        && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
        const alvo = ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent : n.parent;
        add(alvo, regra, 'chamada', alvo.getText(sf));
        chamadasCruas++;
      }
      ts.forEachChild(n, visitarRef);
    };
    visitarRef(sf);
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
    expect(Object.keys(ARQUIVOS_MISTOS).length).toBe(10);
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

  it('os 7 arquivos com robô de agenda estão escritos pelo nome, com o frio que mora junto (eletropostoRemarcar e eletropostoRespostas)', () => {
    const derivado: Record<string, { agenda: string[]; frio: string[] }> = {};
    for (const [nome, r] of Object.entries(CLASSE_POR_ROBO)) {
      if (!r.agenda) continue;
      for (const a of r.arquivos) derivado[a] = { agenda: [...(derivado[a]?.agenda ?? []), nome].sort(), frio: [] };
    }
    for (const [nome, r] of Object.entries(CLASSE_POR_ROBO)) {
      if (r.classe !== 'frio_p5' && r.classe !== 'frio_receita_p4') continue;
      for (const a of r.arquivos) if (derivado[a]) derivado[a]!.frio = [...derivado[a]!.frio, nome].sort();
    }
    expect(derivado).toEqual(ARQUIVOS_COM_ROBO_DE_AGENDA);
    expect(Object.entries(ARQUIVOS_COM_ROBO_DE_AGENDA).filter(([, e]) => e.frio.length > 0).map(([a]) => a))
      .toEqual(['services/io/eletropostoRemarcar.ts', 'services/io/eletropostoRespostas.ts']);
  });

  it('a dívida está escrita onde se lê: o regulamento (DIVERGENCIAS) e o checklist do subagente nomeiam os arquivos com robô de agenda', () => {
    const base = (a: string) => a.split('/').pop()!.replace(/\.ts$/, '');
    const guarda = DIVERGENCIAS.find(d => d.startsWith('Guarda arquivo'))!;
    for (const a of Object.keys(ARQUIVOS_COM_ROBO_DE_AGENDA)) expect({ a, no: guarda.includes(base(a)) }).toEqual({ a, no: true });
    const subagente = readFileSync(join(RAIZ, '.claude', 'agents', 'chefe-antiban.md'), 'utf8');
    for (const a of ['eletropostoRemarcar', 'eletropostoRespostas']) expect({ a, no: subagente.includes(a) }).toEqual({ a, no: true });
  });

  it('REMARCAÇÃO PEDIDA: arquivo novo, ou um dos arquivos só da oferta fria, pedindo ep_remarcar_reativo reprova; nos dois que hospedam a remarcação passa (dívida)', () => {
    for (const arquivo of ['api/src/services/io/roboNovo.ts', 'api/src/services/io/eletropostoRetorno.ts', 'api/src/services/io/eletropostoNaoAtendidoFup.ts']) {
      const r = reprovaEm(pedido('ep_remarcar_reativo'), arquivo);
      expect({ arquivo, novos: r.novos, reprova: r.problemas.length > 0 }).toEqual({ arquivo, novos: ['robo:fora_do_arquivo'], reprova: true });
    }
    // DÍVIDA: o lote de oferta fria escrito no arquivo da remarcação, pedindo com o nome dela, passa.
    const lote = 'export async function loteNovo(decidir: any, estado: any, lista: string[], agora: number) { for (const p of lista) decidir(estado, { robo: \'ep_remarcar_reativo\', destino: p }, agora); }';
    for (const arquivo of ['api/src/services/io/eletropostoRemarcar.ts', 'api/src/services/io/eletropostoRespostas.ts']) {
      expect({ arquivo, problemas: reprovaEm(lote, arquivo).problemas }).toEqual({ arquivo, problemas: [] });
    }
  });

  it('DÍVIDA DECLARADA: num arquivo que hospeda robô de evento (8) ou de agenda (7) a regra não separa a classe', () => {
    // O que expõe não é ser misto, é ter robô de evento (ou de agenda) entre os
    // permitidos. Um lote novo pedindo com o nome do robô de evento do próprio
    // arquivo passa nesta guarda e sai como evento: 60 em 10 min, de madrugada e
    // no domingo; com o nome do robô de agenda, sai fora dos freios de volume e
    // da rajada por robô (números cravados no chefeQuedas). A defesa completa é o
    // passaporte por chamada, que prova a classe. Se este teste quebrar porque a
    // guarda passou a pegar, ótimo: troque por um controle positivo.
    const deClasse = (c: Classe) => Object.entries(ROBOS_POR_ARQUIVO).filter(([, e]) => e.classeMaxima === c).map(([a]) => a).sort();
    expect(deClasse('evento_p0')).toEqual([
      'controllers/authController.ts', 'controllers/paymentsController.ts', 'controllers/trafegoController.ts',
      'routes/ioIndicacoes.ts', 'routes/webhook.ts', 'services/agents/whatsapp/pixComprovanteService.ts',
      'services/agents/whatsapp/whatsappAgentService.ts', 'services/dunningService.ts',
    ]);
    // Três deles não estão em ARQUIVOS_MISTOS: só têm robô de evento.
    expect(deClasse('evento_p0').filter(a => !(a in ARQUIVOS_MISTOS))).toEqual(['controllers/authController.ts', 'controllers/paymentsController.ts', 'controllers/trafegoController.ts']);
    expect(deClasse('lembrete_p1')).toEqual([
      'services/io/eletropostoAgenda.ts', 'services/io/eletropostoAlerta10min.ts', 'services/io/eletropostoCobraSim.ts',
      'services/io/solarAgendaGiovanna.ts', 'services/io/solarBoasVindas.ts',
    ]);
    for (const [arquivo, robo] of [
      ['api/src/services/dunningService.ts', 'dunning_d0'],         // o lote do lembrete (frio de receita) pedindo como evento
      ['api/src/controllers/trafegoController.ts', 'trafego_confirmacao'], // arquivo só de evento, fora de ARQUIVOS_MISTOS
      ['api/src/services/io/eletropostoAgenda.ts', 'ep_agenda'],    // lote novo no arquivo da agenda, fora dos freios de volume
    ] as const) {
      const real = readFileSync(join(RAIZ, ...arquivo.split('/')), 'utf8');
      const lote = `export async function loteNovo(decidir: any, estado: any, lista: string[], agora: number) { for (const p of lista) decidir(estado, { robo: '${robo}', destino: p }, agora); }`;
      const depois = varrerFonte(`${real}\n${lote}\n`, arquivo);
      const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
      expect({ arquivo, problemas: avaliar([...resto, ...depois]) }).toEqual({ arquivo, problemas: [] });
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DO PERMITIDO: cada formato que o verificador da rodada anterior achou
// passando verde (N1 a N5) entra aqui como controle positivo, em arquivo novo e
// anexado aos arquivos reais em que ele passava.
// ─────────────────────────────────────────────────────────────────────────────

/** O código num arquivo novo, ou anexado ao arquivo real: o que subiu e os problemas do avaliar(). */
function reprovaEm(codigo: string, arquivo: string): { novos: string[]; problemas: string[] } {
  const caminho = join(RAIZ, ...arquivo.split('/'));
  const resto = inventario.achados.filter(a => a.arquivo !== arquivo);
  if (!existsSync(caminho)) {
    const ach = varrerFonte(codigo, arquivo);
    return { novos: resumo(ach), problemas: avaliar([...resto, ...ach]) };
  }
  const real = readFileSync(caminho, 'utf8');
  const depois = varrerFonte(`${real}\n${codigo}\n`, arquivo);
  const conta = new Map<string, number>();
  for (const k of resumo(depois)) conta.set(k, (conta.get(k) ?? 0) + 1);
  for (const k of resumo(varrerFonte(real, arquivo))) conta.set(k, (conta.get(k) ?? 0) - 1);
  return { novos: [...conta].filter(([, n]) => n > 0).map(([k]) => k), problemas: avaliar([...resto, ...depois]) };
}

describe('chefeGuarda: lista do permitido (os formatos do verificador anterior, um por um)', () => {
  const NOVO = 'api/src/services/io/roboNovo.ts';
  const NOVO_IG = 'api/src/services/instagram/roboNovo.ts';
  const ARQUIVOS_DE_CONSULTA = Object.keys(CONSULTA_ZAPI);
  const reprova = (nome: string, codigo: string, arquivos: readonly string[], chave: string) => {
    for (const arquivo of arquivos) {
      const r = reprovaEm(codigo, arquivo);
      expect({ nome, arquivo, reprova: r.problemas.length > 0, sobe: r.novos.includes(chave) })
        .toEqual({ nome, arquivo, reprova: true, sobe: true });
    }
  };
  const passa = (nome: string, codigo: string, arquivo: string) => {
    const r = reprovaEm(codigo, arquivo);
    expect({ nome, arquivo, novos: r.novos, problemas: r.problemas }).toEqual({ nome, arquivo, novos: [], problemas: [] });
  };

  it('Z-API: endpoint fora da lista do permitido é envio (N3, o forward-message em laço), em arquivo novo e nos 4 de consulta', () => {
    const n3 = 'router.post("/io/encaminhar", async (req: any, res: any) => { for (const phone of req.body.lista) await fetch(`https://api.z-api.io/instances/${req.body.id}/token/${req.body.tk}/forward-message`, { method: "POST", headers: { "Client-Token": req.body.ct }, body: JSON.stringify({ phone, messageId: req.body.messageId, messagePhone: req.body.de }) }); res.json({ ok: true }); });';
    reprova('N3', n3, ['api/src/routes/roboNovoRota.ts', ...ARQUIVOS_DE_CONSULTA, 'api/src/services/io/ioSend.ts'], 'zapi:envio');
    // Endpoint novo qualquer da Z-API, fora da lista: envio, mesmo sem send-.
    reprova('endpoint novo', 'export const f = (id: string, tk: string) => fetch(`https://api.z-api.io/instances/${id}/token/${tk}/pin-message`, { method: "POST" });',
      [NOVO, ...ARQUIVOS_DE_CONSULTA], 'zapi:envio');
    // A base da instância vinda de função, a instância axios e o new URL: o caminho depois da base passa pela lista.
    const formatos: Record<string, string> = {
      base_funcao: 'const baseZ = (c: any) => `https://api.z-api.io/instances/${c.id}/token/${c.token}`;\nexport async function fw(c: any, lista: string[]) { for (const phone of lista) await fetch(`${baseZ(c)}/forward-message`, { method: "POST", body: JSON.stringify({ phone }) }); }',
      axios_create: 'import axios from "axios";\nexport async function fw2(c: any) { const z = axios.create({ baseURL: `https://api.z-api.io/instances/${c.id}/token/${c.token}` }); await z.post("/forward-message", { phone: "1" }); }',
      join: 'const baseZ2 = (c: any) => `https://api.z-api.io/instances/${c.id}/token/${c.token}`;\nexport async function fw3(c: any, tipo: string) { await fetch(`${baseZ2(c)}/${["send", tipo].join("-")}`, { method: "POST" }); }',
    };
    for (const [nome, codigo] of Object.entries(formatos)) {
      const chave = nome === 'join' ? 'zapi:caminho_livre' : 'zapi:envio';
      reprova(nome, codigo, [NOVO, ...ARQUIVOS_DE_CONSULTA], chave);
    }
  });

  it('Z-API: o caminho passado ao helper do próprio arquivo e o path: de uma lista de tentativas também passam pela lista', () => {
    const helper = 'async function tryReq2(method: string, path: string, c: any) { return fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/${path}`, { method }); }\n';
    reprova('helper', `${helper}export const x = (c: any) => tryReq2("POST", "forward-message", c);`, ['api/src/routes/zapiAdmin.ts'], 'zapi:envio');
    reprova('tentativas', 'export const tentativas = [{ path: "update-webhook-received", method: "PUT" }, { path: "forward-message", method: "POST" }];',
      ['api/src/routes/zapiAdmin.ts'], 'zapi:envio');
    // A leitura e a configuração da lista passam pelo mesmo helper.
    passa('helper com consulta', 'export const y = (c: any) => [zapiGet(c, "chats"), zapiGet(c, "update-webhook-received"), zapiGet(c, `chat-messages/${c.p}?amount=10`)];', 'api/src/routes/zapiAdmin.ts');
    reprova('helper do painel', 'export const z = (c: any) => zapiGet(c, "forward-message");', ['api/src/routes/zapiAdmin.ts'], 'zapi:envio');
  });

  it('Graph: escrita por helper copiado do repo (N1a, N1c a N1h), com o edge por ternário, let/if, switch ou objeto', () => {
    const helper1 = 'const GRAPH = "https://graph.facebook.com/v21.0";\n' +
      'async function graphPost(path: string, body: unknown, token: string) { const sep = path.includes("?") ? "&" : "?"; const r = await fetch(`${GRAPH}/${path}${sep}access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json(); }\n';
    const gpost2 = 'const GRAPH = "https://graph.facebook.com/v21.0";\n' +
      'async function gpost(id: string, edge: string, body: unknown, token: string) { const sep = edge.includes("?") ? "&" : "?"; return fetch(`${GRAPH}/${id}/${edge}${sep}access_token=${token}`, { method: "POST", body: JSON.stringify(body) }); }\n';
    const casos: Record<string, string> = {
      N1a: `${helper1}export async function todos(pg: string, itens: Array<{ id: string; c: boolean }>, tk: string) { for (const it of itens) { const edge = it.c ? "comments" : "messages"; await graphPost(\`\${it.c ? it.id : pg}/\${edge}\`, { recipient: { id: it.id } }, tk); } }`,
      N1c: `${gpost2.replace('edge.includes("?") ? "&" : "?"', '"?"')}export async function lote(pg: string, lista: string[], tk: string, p: boolean) { const edge = p ? "comments" : "messages"; for (const para of lista) await gpost(pg, edge, { recipient: { id: para } }, tk); }`,
      N1d: `${helper1}const EDGES = { dm: "messages", resposta: "replies" } as const;\nexport async function lote(pg: string, lista: string[], tk: string) { for (const para of lista) await graphPost(\`\${pg}/\${EDGES.dm}\`, { recipient: { id: para } }, tk); }`,
      N1e: `${helper1}export async function responder(c: { id: string; publico: boolean }, pg: string, tk: string) { let alvo = \`\${pg}/\`; let edge = "messages"; if (c.publico) { alvo = \`\${c.id}/\`; edge = "comments"; } await graphPost(alvo + edge, { message: { text: "oi" } }, tk); }`,
      N1f: `${helper1}function edgeDe(t: "dm" | "resposta"): string { switch (t) { case "dm": return "messages"; default: return "replies"; } }\nexport async function lote(pg: string, lista: string[], tk: string) { for (const para of lista) await graphPost(\`\${pg}/\${edgeDe("dm")}\`, { recipient: { id: para } }, tk); }`,
      N1g: helper1,
      N1h: `${gpost2}export async function lote(pg: string, lista: string[], tk: string, p: boolean) { const edge = p ? "comments" : "messages"; for (const para of lista) await gpost(pg, edge, { recipient: { id: para } }, tk); }`,
    };
    for (const [nome, codigo] of Object.entries(casos)) {
      reprova(nome, codigo, [NOVO_IG], 'graph:caminho_livre');
    }
    // Anexados aos arquivos do Graph em que passavam verdes.
    for (const arquivo of ['api/src/services/metaOrdensService.ts', 'api/src/services/io/prospeccaoConversaIg.ts']) {
      reprova('N1a anexado', casos.N1a!.replace('const GRAPH = ', 'const GRAPH_N = ').replace('${GRAPH}', '${GRAPH_N}'), [arquivo], 'graph:caminho_livre');
    }
  });

  it('Graph: https.request com { ...options, method: "POST" } (N2a) ou options.method = "POST" depois (N2c)', () => {
    reprova('N2a', 'import https from "https";\nexport function dm(pg: string, para: string, tk: string) { const options = { hostname: "graph.facebook.com", port: 443, path: `/v21.0/${pg}/messages?access_token=${tk}`, headers: { "Content-Type": "application/json" } }; const req = https.request({ ...options, method: "POST" }); req.write(JSON.stringify({ recipient: { id: para } })); req.end(); }',
      [NOVO_IG], 'graph:envio');
    reprova('N2c', 'import https from "https";\nexport function dm(pg: string, para: string, tk: string) { const options: https.RequestOptions = { hostname: "graph.facebook.com", port: 443, path: `/v21.0/${pg}/messages?access_token=${tk}` }; options.method = "POST"; const req = https.request(options); req.end(); }',
      [NOVO_IG], 'graph:envio');
    reprova('N2b (method dentro)', 'import https from "https";\nexport function dm(pg: string, tk: string) { const options = { hostname: "graph.facebook.com", path: `/v21.0/${pg}/messages?access_token=${tk}`, method: "POST" }; https.request(options).end(); }',
      [NOVO_IG], 'graph:envio');
    // Escrita em edge que não é de mensagem, fora da lista do permitido, também conta.
    reprova('escrita qualquer', 'export const f = (id: string, tk: string) => fetch(`https://graph.facebook.com/v21.0/${id}/feed?access_token=${tk}`, { method: "POST" });', [NOVO_IG], 'graph:envio');
  });

  it('robo: as const, satisfies, atalho com const local e const de topo reprovam como o literal (N4a a N4d)', () => {
    const casos: Record<string, string> = {
      N4a: 'export const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: \'ep_agenda\' as const, destino: p }, agora);',
      N4b: 'export const pedir = (decidir: any, estado: any, p: string, agora: number) => { const robo = \'ep_agenda\'; return decidir(estado, { robo, destino: p }, agora); };',
      N4c: 'type NomeRobo = string;\nexport const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: \'ep_agenda\' satisfies NomeRobo, destino: p }, agora);',
      N4d: 'const ROBO = \'ep_agenda\';\nexport const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: ROBO, destino: p }, agora);',
    };
    for (const [nome, codigo] of Object.entries(casos)) {
      reprova(nome, codigo, ['api/src/services/io/eletropostoReagendaAuto.ts', 'api/src/routes/zapiAdmin.ts', NOVO], 'robo:fora_do_arquivo');
    }
    // O robô certo no arquivo certo continua passando, escrito do mesmo jeito.
    passa('ep_reagenda_auto as const', 'export const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: \'ep_reagenda_auto\' as const, destino: p }, agora);',
      'api/src/services/io/eletropostoReagendaAuto.ts');
  });

  it('envio cru passado como valor conta como referência (N5a a N5d): alias, .call e map', () => {
    reprova('N5a', 'const mandarCru = enviarZapiIO;\nexport async function loteNovo(lista: string[]) { for (const p of lista) await mandarCru(p, "oi"); }',
      ['api/src/services/io/avisosTickService.ts'], 'envio_cru:chamada');
    reprova('N5b', 'export async function loteNovo2(lista: string[]) { await Promise.all(lista.map(p => [p, "oi"] as const).map(([p, m]) => enviarZapiIO.call(null, p, m))); }',
      ['api/src/services/io/avisosTickService.ts'], 'envio_cru:chamada');
    reprova('N5c', 'const encaminhar = encaminharMidiaAoConsultor;\nexport async function encaminharLote(ms: any[]) { for (const m of ms) await encaminhar(m); }',
      ['api/src/routes/webhook.ts', 'api/src/services/agents/whatsapp/whatsappAgentService.ts'], 'envio_cru:chamada');
    reprova('N5d', 'const postCru = zapiPost;\nexport async function loteMidia(lista: string[]) { for (const p of lista) await postCru("send-text", { phone: p, message: "oi" }, 2, "io"); }',
      ['api/src/services/io/encaminharMidiaConsultor.ts'], 'zapipost:chamada');
    reprova('map por referência', 'import { enviarZapiIO } from "./ioSend";\nexport const f = (lista: string[]) => lista.map(enviarZapiIO as any);', [NOVO], 'envio_cru:chamada');
  });

  it('controle negativo: GET na própria api, leitura do Graph por helper, a API de Conversões (/events) e a leitura da Z-API passam', () => {
    passa('GET da própria api num arquivo de consulta', 'const BASE2 = process.env.API_URL;\nexport async function fila() { const r = await fetch(`${BASE2}/cron/process-messages`, { headers: { Authorization: "x" } }); return r.json(); }',
      'api/src/services/io/zapiHealthMonitor.ts');
    passa('leitura do Graph por helper local (formato do metaConjuntos)', 'const GRAPH = "https://graph.facebook.com/v21.0";\nasync function lerJson(url: string) { const r = await fetch(url, { signal: undefined }); return r.json(); }\nexport const ins = (id: string) => lerJson(`${GRAPH}/${id}/insights?fields=spend`);',
      'api/src/services/metaNovo.ts');
    passa('API de Conversões', 'export const evento = (id: string, tk: string) => fetch(`https://graph.facebook.com/v21.0/${id}/events?access_token=${tk}`, { method: "POST", body: "{}" });',
      'api/src/services/metaNovo.ts');
    passa('leitura com as opções numa const sem method', 'const GRAPH = "https://graph.facebook.com/v21.0";\nconst BASE_OPC = { headers: {} };\nexport const ler = (id: string) => fetch(`${GRAPH}/${id}?fields=name`, BASE_OPC);',
      'api/src/services/metaNovo.ts');
    expect(resumo(varrerFonte('export const s = (id: string, tk: string) => fetch(`https://api.z-api.io/instances/${id}/token/${tk}/qr-code`);', 'api/src/services/io/zapiHealthMonitor.ts')))
      .toEqual(['zapi:consulta']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RODADA 4 — os formatos que o verificador da rodada 3 achou passando verdes
// (G3, G10, G5, G12), agora pegos, e os LIMITES que ficam, escritos como teste:
// cada formato que a guarda NÃO pega tem um teste que crava zero achado, para
// que, no dia em que ela passar a pegar, o teste quebre e o texto dos LIMITES
// CONHECIDOS seja atualizado junto. A defesa completa é a catraca física no
// zapiPost, com o livro no banco (próxima fase).
// ─────────────────────────────────────────────────────────────────────────────

describe('chefeGuarda: rodada 4, os formatos do verificador da rodada 3 e os limites que ficam', () => {
  const NOVO = 'api/src/services/io/roboNovo.ts';
  const NOVO_IG = 'api/src/services/instagram/roboNovo.ts';
  const ARQUIVOS_DE_CONSULTA = Object.keys(CONSULTA_ZAPI);
  const reprova = (nome: string, codigo: string, arquivos: readonly string[], chave: string) => {
    for (const arquivo of arquivos) {
      const r = reprovaEm(codigo, arquivo);
      expect({ nome, arquivo, reprova: r.problemas.length > 0, sobe: r.novos.includes(chave) })
        .toEqual({ nome, arquivo, reprova: true, sobe: true });
    }
  };
  /** O formato passa sem achado nenhum da regra: é LIMITE declarado. */
  const limite = (nome: string, codigo: string, arquivo: string, regra: Regra) => {
    const achados = varrerFonte(codigo, arquivo).filter(a => a.regra === regra);
    expect({ nome, arquivo, achados: resumo(achados) }).toEqual({ nome, arquivo, achados: [] });
  };
  const BASE_Z = 'const baseZ = (c: any) => `https://api.z-api.io/instances/${c.id}/token/${c.token}/`;\n';

  it('Z-API: o forward-message em qualquer posição (G3c colado na base sem barra, G3b new URL, G3 join, G1 axios sem barra), em arquivo novo e nos 4 de consulta', () => {
    const casos: Record<string, string> = {
      G3c: `${BASE_Z}export async function fw(c: any, lista: string[]) { for (const phone of lista) await fetch(\`\${baseZ(c)}forward-message\`, { method: "POST", body: JSON.stringify({ phone }) }); }`,
      G3b: `${BASE_Z}export async function fw(c: any, lista: string[]) { for (const phone of lista) await fetch(new URL("forward-message", baseZ(c)), { method: "POST", body: JSON.stringify({ phone }) }); }`,
      G3: `${BASE_Z}export async function fw(c: any, lista: string[]) { for (const phone of lista) await fetch([baseZ(c), "forward-message"].join("/"), { method: "POST", body: JSON.stringify({ phone }) }); }`,
      G1: 'import axios from "axios";\nexport async function fw(c: any) { const z = axios.create({ baseURL: `https://api.z-api.io/instances/${c.id}/token/${c.token}/` }); await z.post("forward-message", { phone: "1" }); }',
    };
    for (const [nome, codigo] of Object.entries(casos)) reprova(nome, codigo, [NOVO, ...ARQUIVOS_DE_CONSULTA], 'zapi:envio');
  });

  it('Z-API: endpoint colado na base sem barra, alvo de requisição sem GET provado, passa pela lista do permitido (send-* e endpoint novo)', () => {
    reprova('send colado', `${BASE_Z}export const f = (c: any, p: string) => fetch(\`\${baseZ(c)}send-text\`, { method: "POST", body: JSON.stringify({ phone: p }) });`,
      [NOVO, ...ARQUIVOS_DE_CONSULTA], 'zapi:envio');
    reprova('endpoint novo colado', `${BASE_Z}export const f = (c: any, p: string) => fetch(\`\${baseZ(c)}reply-message\`, { method: "POST", body: JSON.stringify({ phone: p }) });`,
      [NOVO, ...ARQUIVOS_DE_CONSULTA], 'zapi:envio');
    // A consulta colada na base, por GET, continua consulta.
    expect(resumo(varrerFonte(`${BASE_Z}export const s = (c: any) => fetch(\`\${baseZ(c)}status\`);`, 'api/src/services/io/zapiHealthMonitor.ts')))
      .toEqual(['zapi:consulta']);
  });

  it('Graph: caminho sem host e sem versão para um edge de mensagem (G10d https.request, G10e new URL, G10 e G10b axios com baseURL)', () => {
    const casos: Record<string, string> = {
      G10d: 'import https from "https";\nexport function lote(pg: string, lista: string[], tk: string) { for (const para of lista) { const req = https.request({ hostname: "graph.facebook.com", port: 443, path: `/${pg}/messages?access_token=${tk}`, method: "POST" }); req.write(JSON.stringify({ recipient: { id: para } })); req.end(); } }',
      G10e: 'export async function lote(lista: string[], tk: string) { for (const para of lista) await fetch(new URL(`/me/messages?access_token=${tk}`, "https://graph.facebook.com"), { method: "POST", body: JSON.stringify({ recipient: { id: para } }) }); }',
      G10: 'import axios from "axios";\nexport async function lote(pg: string, lista: string[]) { const g = axios.create({ baseURL: "https://graph.facebook.com/v21.0" }); for (const para of lista) await g.post(`/${pg}/messages`, { recipient: { id: para } }); }',
      G10b: 'import axios from "axios";\nexport async function lote(lista: string[]) { const g = axios.create({ baseURL: "https://graph.facebook.com/v21.0" }); for (const para of lista) await g.post("/me/messages", { recipient: { id: para } }); }',
    };
    for (const [nome, codigo] of Object.entries(casos)) {
      reprova(nome, codigo, [NOVO_IG, 'api/src/services/metaOrdensService.ts', 'api/src/services/io/prospeccaoConversaIg.ts'], 'graph:envio');
    }
    // Controle negativo: a leitura (sem method) e o /events da API de Conversões continuam passando.
    expect(varrerFonte('import https from "https";\nexport function ler(pg: string, tk: string) { https.request({ hostname: "graph.facebook.com", path: `/${pg}/comments?access_token=${tk}` }).end(); }', NOVO_IG)).toEqual([]);
    expect(varrerFonte('import https from "https";\nexport function ev(px: string, tk: string) { https.request({ hostname: "graph.facebook.com", path: `/${px}/events?access_token=${tk}`, method: "POST" }).end(); }', NOVO_IG)).toEqual([]);
  });

  it('robo: ternário, let/var, padrão de parâmetro, objeto de constantes, ?? e atribuição depois (G5a a G5e) reprovam como o literal', () => {
    const casos: Record<string, string> = {
      G5a: 'export const pedir = (decidir: any, estado: any, p: string, urgente: boolean, agora: number) => decidir(estado, { robo: urgente ? \'ep_agenda\' : \'ep_reagenda_auto\', destino: p }, agora);',
      G5b: 'export const pedir = (decidir: any, estado: any, p: string, urgente: boolean, agora: number) => { let r = \'ep_reagenda_auto\'; if (urgente) r = \'ep_agenda\'; return decidir(estado, { robo: r, destino: p }, agora); };',
      G5c: 'export function pedir(decidir: any, estado: any, p: string, agora: number, robo = \'ep_agenda\') { return decidir(estado, { robo, destino: p }, agora); }',
      G5d: 'const ROBOS = { agenda: \'ep_agenda\', reagenda: \'ep_reagenda_auto\' } as const;\nexport const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: ROBOS.agenda, destino: p }, agora);',
      G5e: 'export const pedir = (decidir: any, estado: any, p: string, agora: number) => { const pedido: any = { destino: p }; pedido.robo = \'ep_agenda\'; return decidir(estado, pedido, agora); };',
      nulo: 'export const pedir = (decidir: any, estado: any, p: string, agora: number, r?: string) => decidir(estado, { robo: r ?? \'ep_agenda\', destino: p }, agora);',
    };
    for (const [nome, codigo] of Object.entries(casos)) {
      reprova(nome, codigo, ['api/src/services/io/eletropostoReagendaAuto.ts', 'api/src/services/io/sementeSolarService.ts', NOVO], 'robo:fora_do_arquivo');
    }
    // O robô certo no arquivo certo, por ternário entre dois nomes dele, passa.
    expect(varrerFonte('const ROBO_A = \'ep_reagenda_auto\';\nexport const pedir = (decidir: any, estado: any, p: string, x: boolean, agora: number) => decidir(estado, { robo: x ? ROBO_A : \'ep_reagenda_auto\', destino: p }, agora);',
      'api/src/services/io/eletropostoReagendaAuto.ts').filter(a => a.regra === 'robo')).toEqual([]);
  });

  it('envio cru: desestruturação do namespace, import = require e acesso por colchete (G12a a G12c) contam como referência', () => {
    reprova('G12a', 'import * as io from "./ioSend";\nconst { enviarZapiIO: mandar } = io;\nexport async function lote(lista: string[]) { for (const p of lista) await mandar(p, "oi"); }',
      [NOVO, 'api/src/services/io/sementeSolarService.ts', 'api/src/services/io/avisosTickService.ts'], 'envio_cru:chamada');
    reprova('G12b', 'import io = require("./ioSend");\nexport async function lote(lista: string[]) { for (const p of lista) await io.enviarZapiIO(p, "oi"); }',
      [NOVO, 'api/src/services/io/sementeSolarService.ts'], 'envio_cru:chamada');
    reprova('G12c', 'import z = require("../agents/zapiClient");\nexport async function lote(lista: string[]) { for (const p of lista) await z.zapiPost("send-text", { phone: p, message: "oi" }, 2, "io"); }',
      [NOVO, 'api/src/services/io/sementeSolarService.ts'], 'zapipost:chamada');
    reprova('colchete', 'import * as io from "./ioSend";\nexport async function lote(lista: string[]) { for (const p of lista) await io["enviarZapiIO"](p, "oi"); }',
      [NOVO], 'envio_cru:chamada');
  });

  it('LIMITES que ficam (zero achado, de propósito): cada um está escrito nos LIMITES CONHECIDOS', () => {
    // Z-API: endpoint fora da lista, que não é send-* nem forward-message, num
    // texto que não é alvo direto de requisição (o pedaço de um join), dentro de
    // um arquivo de CONSULTA_ZAPI. Num arquivo novo a base sozinha já reprova
    // (como consulta fora da lista de consulta).
    for (const arquivo of ARQUIVOS_DE_CONSULTA) {
      const r = reprovaEm(`${BASE_Z}export const fj = (c: any, p: string) => fetch([baseZ(c), "reply-message"].join(""), { method: "POST", body: p });`, arquivo);
      expect({ arquivo, problemas: r.problemas, envio: r.novos.filter(k => k !== 'zapi:consulta') }).toEqual({ arquivo, problemas: [], envio: [] });
    }
    expect(reprovaEm(`${BASE_Z}export const fj = (c: any, p: string) => fetch([baseZ(c), "reply-message"].join(""), { method: "POST", body: p });`, NOVO).problemas.join(' | '))
      .toContain('fora de CONSULTA_ZAPI');
    // Z-API: a URL inteira vinda de env, sem host, molde nem Client-Token no arquivo.
    limite('URL da env', 'export const f = (p: string) => fetch(process.env.ZAPI_URL_ENVIO!, { method: "POST", body: p });', NOVO, 'zapi');
    // Graph: o host só na env (sem literal no arquivo).
    limite('Graph com host da env', 'export const f = (pg: string, para: string) => fetch(`${process.env.META_GRAPH_URL!}/${pg}/messages`, { method: "POST", body: para });', NOVO_IG, 'graph');
    // Graph: caminho sem host e sem versão para um edge que NÃO é de mensagem (o /feed de uma página).
    limite('Graph sem versão, edge que não é de mensagem', 'import https from "https";\nexport function post(pg: string, tk: string) { https.request({ hostname: "graph.facebook.com", path: `/${pg}/feed?access_token=${tk}`, method: "POST" }).end(); }', NOVO_IG, 'graph');
    // robo: nome vindo de parâmetro sem padrão, de import, ou de texto com variável.
    limite('robo de parâmetro', 'export const pedir = (decidir: any, estado: any, p: string, robo: string, agora: number) => decidir(estado, { robo, destino: p }, agora);', NOVO, 'robo');
    limite('robo de import', 'import { NOME_ROBO } from "./outro";\nexport const pedir = (decidir: any, estado: any, p: string, agora: number) => decidir(estado, { robo: NOME_ROBO, destino: p }, agora);', NOVO, 'robo');
    limite('robo com variável', 'export const pedir = (decidir: any, estado: any, p: string, t: string, agora: number) => decidir(estado, { robo: `ep_${t}`, destino: p }, agora);', NOVO, 'robo');
    // envio cru: membro calculado (io["enviar" + "ZapiIO"]) e o barrel que re-exporta.
    limite('membro calculado', 'import * as io from "./ioSend";\nconst k = "enviar" + "ZapiIO";\nexport async function lote(lista: string[]) { for (const p of lista) await (io as any)[k](p, "oi"); }', NOVO, 'envio_cru');
  });
});
