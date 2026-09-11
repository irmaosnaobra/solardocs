// ─────────────────────────────────────────────────────────────────────────────
// RECEPÇÃO DA LINHA IO — quem chega sozinho no WhatsApp e hoje não recebe nada.
//
// O BURACO, medido em 11/09/2026 sobre `webhook_debug` dos últimos 30 dias na
// linha 553498165040:
//
//   437 números escreveram pra linha
//   171 começaram a conversa (ninguém tinha falado com eles antes)
//   117 desses NÃO receberam uma única resposta em 24h  → 68%
//
// Por que 117 pessoas ficam no vácuo: toda mensagem que sobra no fim de
// `routes/webhook.ts` ia pra `handleSdrLead`, e a primeira linha de lá é
// `if (instance === 'io') return`. A Luma foi desligada desta linha quando o
// funil do simulador saiu, e o comentário do webhook ("vai DIRETO pra Luma")
// ficou desatualizado. Na prática o atendimento espontâneo virou "alguém olha o
// celular quando puder".
//
// O que as 117 pessoas escreveram, na amostra real: a maioria esmagadora é
// cumprimento puro ("Bom dia", "Boa tarde", "Olá boa noite") sem assunto nenhum.
// O resto se divide em solar ("vi uma propaganda de placa solar"), SolarDoc
// ("estou usando o SolarDoc Pro e preciso de ajuda"), bike elétrica, off-grid e
// cliente antigo falando de obra em andamento.
//
// O BOTÃO DO INSTAGRAM PIORA ISSO DE PROPÓSITO. O botão de WhatsApp do perfil
// abre conversa EM BRANCO: não manda texto, não carrega `ctwa_clid` (isso só
// existe em anúncio Click-to-WhatsApp). Ou seja, ele despeja exatamente o caso
// que hoje fica sem resposta, e em volume maior. Ligar o botão sem recepção é
// contratar mais silêncio.
//
// O QUE ESTA RECEPÇÃO FAZ, e o que ela NÃO faz:
//   FAZ   → responde na hora, descobre o motivo do contato e qual produto,
//           registra a origem e chama o humano certo com a ficha pronta.
//   NÃO   → não dá preço, não agenda, não promete prazo e não tenta vender.
//           Ela é porta de entrada, não vendedora. Passar direto pros agentes
//           de cada produto (Carla, funil do eletroposto, trilha do LimpaPro) é
//           o passo seguinte, de propósito fora daqui: cada um desses tem fluxo
//           próprio e merece ser ligado um de cada vez.
//
// POSSE, que é o detalhe que já quebrou aqui antes. A pergunta "o que você
// precisa?" e a resposta do lead são DOIS webhooks diferentes. Sem um dono
// gravado, a 2ª mensagem cai de novo na cascata e outro robô responde no meio
// da triagem — foi o que aconteceu em 25/08 (dois robôs se contradizendo na
// frente do lead, registrado no comentário do `/io`). Por isso a sessão
// `recepcao_io` é criada ANTES da primeira resposta sair, e `recepcaoJaAtende`
// segura a conversa inteira até a entrega ao humano.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendHuman, sendWhatsApp } from '../agents/zapiClient';
import { novoAnthropic } from '../../utils/anthropicClient';
import { variantesBR } from '../agents/whatsapp/whatsappAgentService';
import { pareceRoboDeles, temRoboAtendendo, marcarRoboDoOutroLado } from '../agents/whatsapp/roboDoOutroLado';
import { carregarSilenciados } from '../agents/whatsapp/silenciar';

const anthropic = novoAnthropic();

/** Tipo da sessão que marca posse da conversa. Casa com `whatsapp_sessions.tipo`. */
export const TIPO_SESSAO = 'recepcao_io';

/** Onde mora a chave. `system_state` é o padrão da casa e dispensa migration. */
const CHAVE_ATIVA = 'recepcao_io:ativa';

// Cache curto porque isto é lido em toda mensagem que entra na linha. 60s é o
// mesmo número do cérebro das agentes: virar a chave vale em um minuto, e não
// custa uma consulta por mensagem.
const CACHE_MS = 60 * 1000;
let cacheAtiva: { valor: boolean; ate: number } | null = null;

/**
 * Liga/desliga sem deploy E sem mexer na Vercel.
 *
 * A chave vive no banco, não em variável de ambiente, por um motivo prático: env
 * nova na Vercel só passa a valer depois de um redeploy, e quem precisa calar um
 * robô que está falando errado com cliente não pode depender de build. Uma linha
 * em `system_state` vale no minuto seguinte.
 *
 * `RECEPCAO_IO_OFF=1` continua existindo como freio de mão: desliga na marra,
 * sem consultar nada, pra quando o banco é justamente o problema.
 *
 * Falha de leitura NÃO liga por engano: sem cache válido, o padrão é desligada.
 */
async function ligada(): Promise<boolean> {
  if ((process.env.RECEPCAO_IO_OFF || '').trim() === '1') return false;
  if (cacheAtiva && cacheAtiva.ate > Date.now()) return cacheAtiva.valor;

  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', CHAVE_ATIVA).maybeSingle();
    const valor = ((data?.value ?? {}) as { ativa?: boolean }).ativa === true;
    cacheAtiva = { valor, ate: Date.now() + CACHE_MS };
    return valor;
  } catch (err) {
    logger.error('recepcao-io', 'leitura da chave de ativação falhou — fica desligada', err);
    return cacheAtiva?.valor ?? false;
  }
}

/** Teto de trocas antes de entregar pro humano na marra. Triagem não é conversa. */
const MAX_TURNOS = 4;

/** Depois de entregue ao humano, a recepção não fala mais nesta conversa. */
type Estado = 'triando' | 'entregue';

export type Produto =
  | 'solar'        // energia solar (o carro-chefe)
  | 'eletroposto'  // ponto de recarga / investimento NEXUS
  | 'solardoc'     // o software de propostas (integrador)
  | 'bike'         // loja de bikes elétricas
  | 'curso'        // LimpaPro, Ponto Certo, PlugCash
  | 'cliente'      // já é cliente: obra, homologação, garantia, pós-venda
  | 'outro';

interface LeadData {
  estado: Estado;
  produto?: Produto | null;
  motivo?: string | null;
  turnos: number;
  entregue_em?: string | null;
}

// Quem recebe o aviso de cada produto. Os números são os mesmos que a Luma já
// usa pra escalação interna (prompt do sdrAgentService) — um lugar só teria sido
// melhor, mas duplicar aqui é menos arriscado que mexer no prompt dela agora.
const CONSULTOR: Record<string, { nome: string; phone: string }> = {
  thiago:   { nome: 'Thiago',   phone: '34991360223' },
  diego:    { nome: 'Diego',    phone: '34991360172' },
  nilce:    { nome: 'Nilce',    phone: '34991516846' },
  giovanna: { nome: 'Giovanna', phone: '34993396255' },
};

// Pra quem vai cada produto. Solar cai na Giovanna porque pré-atendimento é a
// função dela; o resto vai pro Thiago, que é o default de backoffice. Eletroposto
// vai pros dois donos do produto.
const DESTINO: Record<Produto, string[]> = {
  solar:       ['giovanna'],
  eletroposto: ['thiago', 'diego'],
  solardoc:    ['thiago'],
  bike:        ['thiago'],
  curso:       ['thiago'],
  cliente:     ['thiago'],
  outro:       ['thiago'],
};

const ROTULO: Record<Produto, string> = {
  solar:       'Energia solar',
  eletroposto: 'Eletroposto',
  solardoc:    'SolarDoc',
  bike:        'Bike elétrica',
  curso:       'Curso',
  cliente:     'Cliente nosso (pós-venda)',
  outro:       'Não identificado',
};

const PRODUTOS_VALIDOS = new Set<string>(Object.keys(DESTINO));

const soDigitos = (s: string): string => String(s || '').replace('@c.us', '').replace(/\D/g, '');

// ─── posse ───────────────────────────────────────────────────────────────────

/**
 * Esta conversa é da recepção? Vale enquanto a triagem não terminou.
 *
 * Depois de `entregue` devolve false de propósito: quem manda a partir dali é o
 * humano avisado, e a recepção não pode voltar a falar por cima dele.
 */
export async function recepcaoJaAtende(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('lead_data')
    .in('phone', variantesBR(phone))
    .eq('tipo', TIPO_SESSAO)
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return ((data.lead_data ?? {}) as LeadData).estado === 'triando';
}

async function lerSessao(phone: string): Promise<{ messages: any[]; nome: string | null; lead: LeadData } | null> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome, lead_data')
    .in('phone', variantesBR(phone))
    .eq('tipo', TIPO_SESSAO)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    messages: (data.messages as any[]) || [],
    nome: data.nome || null,
    lead: { estado: 'triando', turnos: 0, ...((data.lead_data ?? {}) as Partial<LeadData>) } as LeadData,
  };
}

async function gravarSessao(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome: string | null,
  lead: LeadData,
): Promise<void> {
  const { error } = await supabase.from('whatsapp_sessions').upsert(
    {
      phone,
      tipo: TIPO_SESSAO,
      messages,
      nome,
      lead_data: lead as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone,tipo' },
  );
  if (error) throw new Error(`gravar sessão de recepção falhou: ${error.message}`);
}

// ─── o cérebro ───────────────────────────────────────────────────────────────

const PERSONA = `Você é a Duda, recepcionista da Irmãos na Obra (Uberlândia/MG, 8 anos de mercado, +1400 sistemas de energia solar instalados).

Sua ÚNICA função é descobrir duas coisas e passar pra pessoa certa:
1. Por que a pessoa está falando com a gente
2. Qual dos nossos produtos ela precisa

Você NÃO vende, NÃO dá preço, NÃO promete prazo, NÃO agenda visita e NÃO dá detalhe técnico. Se perguntarem qualquer uma dessas coisas, você diz que quem responde isso é o consultor e que vai chamar agora.`;

const PRODUTOS_TEXTO = `O QUE A CASA FAZ (pra você classificar, não pra recitar pro cliente):
- solar: energia solar em casa, sítio, empresa. Conta de luz alta, placa, painel, usina, off-grid, bateria. É o carro-chefe.
- eletroposto: ponto de recarga de carro elétrico, carregador, investir num eletroposto, marca NEXUS.
- solardoc: nosso software de propostas pra quem é integrador/vende solar. Quem fala "SolarDoc", "sistema", "proposta", "assinatura", "login".
- bike: loja de bikes elétricas.
- curso: cursos (LimpaPro, Ponto Certo, PlugCash).
- cliente: JÁ É CLIENTE nosso. Fala de obra em andamento, instalação marcada, homologação na Cemig, garantia, defeito, "o pessoal esteve aqui". Também quem responde pesquisa de satisfação.
- outro: não encaixa em nada acima (vaga de emprego, fornecedor, engano).`;

const REGRAS = `COMO FALAR:
- Frase por frase, curta, como gente escreve no WhatsApp. Nada de parede de texto.
- Máximo 2 bolhas por resposta, separadas por ||
- Sem emoji. Sem travessão. Primeira letra sempre maiúscula.
- Trate por você. Simpática e direta, sem ser bajuladora.

A PRIMEIRA MENSAGEM, quando a pessoa só cumprimentou ("bom dia", "oi"):
Cumprimenta de volta, se apresenta em meia linha e pergunta o que ela precisa. UMA pergunta só.

QUANDO VOCÊ JÁ SABE o produto e o motivo, encerre: diga que vai chamar a pessoa certa e que já já respondem. Não pergunte mais nada.

NUNCA pergunte de novo o que a pessoa já respondeu. Releia o histórico antes de escrever.

RESPONDA SEMPRE NESTE JSON, sem nenhum texto fora dele:
{"resposta":"primeira bolha||segunda bolha","produto":null,"motivo":null,"nome":null}

- "produto": preencha SÓ quando tiver certeza. Um dos: solar, eletroposto, solardoc, bike, curso, cliente, outro. Enquanto não souber, null.
- "motivo": uma frase curta, em português, do que a pessoa quer. Serve pro consultor ler antes de responder.
- "nome": o primeiro nome dela, se ela tiver dito. Senão null.`;

interface Decisao {
  resposta: string;
  produto: Produto | null;
  motivo: string | null;
  nome: string | null;
}

/**
 * Uma chamada só devolve a fala E a classificação. Duas chamadas (uma pra
 * conversar, outra pra classificar) dobrariam custo e latência numa linha que
 * responde na frente do cliente.
 */
async function pensar(
  historico: { role: 'user' | 'assistant'; content: string }[],
  ultimoTurno: boolean,
): Promise<Decisao | null> {
  const fecharAgora = ultimoTurno
    ? '\n\nATENÇÃO: esta é a última mensagem da triagem. Encerre agora, dizendo que vai chamar alguém, e preencha "produto" com o melhor palpite (use "outro" se realmente não deu pra saber).'
    : '';

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `${PERSONA}\n\n${PRODUTOS_TEXTO}\n\n${REGRAS}${fecharAgora}`,
    messages: historico.length ? historico : [{ role: 'user', content: 'oi' }],
  });

  const bruto = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => String(b.text ?? ''))
    .join('')
    .trim();

  // O modelo às vezes embrulha o JSON em cerca de código ou escreve uma linha
  // antes. Pegar do primeiro { ao último } é o que aguenta os dois casos.
  const ini = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) {
    // Sem JSON: a fala ainda serve, a classificação fica pra próxima volta.
    return bruto ? { resposta: bruto, produto: null, motivo: null, nome: null } : null;
  }

  try {
    const obj = JSON.parse(bruto.slice(ini, fim + 1));
    const p = String(obj.produto ?? '').trim().toLowerCase();
    return {
      resposta: String(obj.resposta ?? '').trim(),
      produto: PRODUTOS_VALIDOS.has(p) ? (p as Produto) : null,
      motivo: obj.motivo ? String(obj.motivo).trim().slice(0, 300) : null,
      nome: obj.nome ? String(obj.nome).trim().slice(0, 60) : null,
    };
  } catch {
    return { resposta: bruto, produto: null, motivo: null, nome: null };
  }
}

// ─── entrega pro humano ──────────────────────────────────────────────────────

async function avisarConsultor(
  phone: string,
  nome: string | null,
  produto: Produto,
  motivo: string | null,
  primeiraFala: string,
): Promise<void> {
  const ficha = [
    `*CHEGOU NA LINHA* — ${ROTULO[produto]}`,
    '',
    `*Nome:* ${nome || '_não disse_'}`,
    `*WhatsApp:* wa.me/55${phone.replace(/^55/, '')}`,
    `*Quer:* ${motivo || '_não deu pra apurar_'}`,
    '',
    `_Primeira mensagem dele:_ "${primeiraFala.slice(0, 160)}"`,
    '',
    '_A Duda já respondeu que alguém vai falar. A conversa é sua a partir de agora._',
  ].join('\n');

  const alvos = DESTINO[produto] ?? ['thiago'];
  const envios = await Promise.allSettled(
    alvos.map(k => sendWhatsApp(CONSULTOR[k].phone, ficha, 'io')),
  );
  envios.forEach((e, i) => {
    if (e.status === 'rejected') {
      logger.error('recepcao-io', `aviso pra ${alvos[i]} falhou`, e.reason);
    }
  });
}

/**
 * Registra o lead no CRM já com `human_takeover`.
 *
 * O takeover não é firula: TODO cron de saída desta casa (reativação, nudge de
 * 10min, nudge das 18h, revisão da Luma) filtra por ele. Sem isso, um lead que a
 * recepção acabou de entregar a um humano entraria na fila de disparo automático
 * e levaria mensagem de robô por cima da conversa do consultor.
 */
async function registrarLead(
  phone: string,
  nome: string | null,
  produto: Produto,
  motivo: string | null,
  ultimaMensagem: string,
): Promise<void> {
  const agora = new Date().toISOString();

  // Quem já tem ficha NÃO pode ser rebaixado. Sonda de 11/09/2026: dos 436
  // números que escreveram na linha em 30 dias, 44 já estavam em `sdr_leads` e
  // 25 com estágio diferente de "novo". Um upsert cego sobre `phone` jogaria
  // esses 25 de volta pra "novo" e apagaria `lead_origem` e `tags` — história
  // que outros fluxos leem. Em quem já existe a recepção só encosta no que é
  // dela: o contato de agora, a tag do produto e o takeover.
  const { data: existente } = await supabase
    .from('sdr_leads')
    .select('phone, nome, tags')
    .eq('phone', phone)
    .maybeSingle();

  if (existente) {
    const tags = Array.from(new Set([...(existente.tags ?? []), 'recepcao', produto]));
    const { error } = await supabase.from('sdr_leads').update({
      nome: existente.nome || nome,          // nome velho manda: foi confirmado por gente
      tags,
      ultima_mensagem: ultimaMensagem.slice(0, 300),
      ultimo_contato: agora,
      human_takeover: true,
      human_takeover_at: agora,
      updated_at: agora,
    }).eq('phone', phone);
    if (error) logger.error('recepcao-io', `atualizar lead ${phone} falhou`, error);
    return;
  }

  const { error } = await supabase.from('sdr_leads').insert({
    phone,
    nome,
    instance: 'io',
    estagio: 'novo',
    lead_origem: 'recepcao_io',
    tags: ['recepcao', produto],
    resumo: motivo,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    ultimo_contato: agora,
    aguardando_resposta: false,
    human_takeover: true,
    human_takeover_at: agora,
    updated_at: agora,
  });
  if (error) logger.error('recepcao-io', `registrar lead ${phone} falhou`, error);
}

// ─── porta de entrada ────────────────────────────────────────────────────────

/**
 * Chamada pelo webhook da linha IO no lugar do antigo `handleSdrLead`, que era
 * no-op pra esta instância. Nunca joga: quem chama está no fim do webhook e uma
 * exceção aqui não pode derrubar o resto do processamento.
 */
export async function handleRecepcaoIo(
  phoneBruto: string,
  texto: string,
  senderName?: string | null,
): Promise<void> {
  if (!(await ligada())) return;

  const phone = soDigitos(phoneBruto);
  const msg = String(texto || '').trim();
  if (!phone || !msg) return;

  try {
    // Robô do outro lado: não entra em pinga-pinga com atendente de IA alheio.
    // Já custou 12 mensagens em 13 minutos numa linha que foi bloqueada 3 vezes.
    if (await temRoboAtendendo(phone)) return;
    const veredito = pareceRoboDeles(msg);
    if (veredito.nivel === 'certeza') {
      await marcarRoboDoOutroLado(phone, veredito.sinal);
      return;
    }
    if (veredito.nivel === 'suspeita') return;

    // Quem pediu pra parar, parou. Vale pra toda saída da casa.
    const silenciado = await carregarSilenciados();
    if (silenciado(phone)) return;

    const sessao = await lerSessao(phone);
    const lead: LeadData = sessao?.lead ?? { estado: 'triando', turnos: 0 };

    // Já entregamos essa conversa pro humano: a recepção não fala por cima dele.
    if (lead.estado === 'entregue') return;

    const historico = [
      ...(sessao?.messages ?? []),
      { role: 'user' as const, content: msg },
    ].slice(-12);

    const turnos = (lead.turnos ?? 0) + 1;
    const ultimoTurno = turnos >= MAX_TURNOS;

    // POSSE ANTES DA FALA. Se a gente responder primeiro e gravar depois, a
    // resposta do lead chega num webhook que ainda não vê dono e cai na cascata.
    await gravarSessao(phone, historico, sessao?.nome ?? senderName ?? null, {
      ...lead, estado: 'triando', turnos,
    });

    const decisao = await pensar(historico, ultimoTurno);
    if (!decisao?.resposta) return;

    const nome = decisao.nome || sessao?.nome || senderName || null;
    const partes = decisao.resposta.split('||').map(s => s.trim()).filter(Boolean);
    await sendHuman(phone, partes.length ? partes : [decisao.resposta], 'io', { maxBolhas: 2 });

    const novoHistorico = [...historico, { role: 'assistant' as const, content: decisao.resposta }];

    // No último turno a entrega é obrigatória, com ou sem classificação. O prompt
    // pede o palpite, mas prompt não é garantia: sem esta rede, um modelo que
    // devolvesse `produto: null` na 4ª volta deixaria a conversa presa em
    // "triando" pra sempre — ninguém avisado, que é o bug que este serviço veio
    // consertar.
    const produtoFinal: Produto | null = decisao.produto ?? (ultimoTurno ? 'outro' : null);
    const fechou = !!produtoFinal;

    await gravarSessao(phone, novoHistorico, nome, {
      estado: fechou ? 'entregue' : 'triando',
      produto: produtoFinal ?? lead.produto ?? null,
      motivo: decisao.motivo ?? lead.motivo ?? null,
      turnos,
      entregue_em: fechou ? new Date().toISOString() : (lead.entregue_em ?? null),
    });

    if (fechou && produtoFinal) {
      const primeira = (sessao?.messages ?? []).find(m => m.role === 'user')?.content || msg;
      await registrarLead(phone, nome, produtoFinal, decisao.motivo, msg);
      await avisarConsultor(phone, nome, produtoFinal, decisao.motivo, String(primeira));
      logger.info('recepcao-io', `${phone} classificado como ${produtoFinal} em ${turnos} turno(s)`);
    }
  } catch (err) {
    logger.error('recepcao-io', `falhou pra ${phone}`, err);
  }
}

/**
 * A pessoa escreveu "bom dia", a Duda perguntou o que ela precisa, e ela sumiu.
 *
 * Sem isto a conversa fica em `triando` pra sempre e ninguém é avisado — ou seja,
 * o mesmo silêncio de antes, só que com uma pergunta no meio. Depois de 2h
 * paradas a triagem é entregue do jeito que está: o consultor recebe a ficha com
 * o que deu pra apurar e decide se vale a pena puxar a conversa.
 *
 * Roda no cron de minuto em minuto. Idempotente: marca `entregue` antes de
 * avisar, então a execução seguinte não repete o aviso.
 */
export async function entregarTriagensParadas(minutos = 120): Promise<{ entregues: number }> {
  if (!(await ligada())) return { entregues: 0 };

  const corte = new Date(Date.now() - minutos * 60 * 1000).toISOString();
  // O filtro de estado vai no BANCO, não em JS depois do `.limit(20)`. Sessão
  // entregue nunca é apagada: com o tempo a página de 20 encheria só de
  // `entregue` e as triagens paradas nunca mais seriam alcançadas. A forma
  // `.filter('coluna->>chave', ...)` é a que o repo já usa pra jsonb
  // (`sdrIoPolling.processIoTakeoverEvents`), e o guarda em JS lá embaixo
  // continua de pé: se o filtro do banco falhar, a entrega erra pra menos, nunca
  // pro lado de avisar o consultor de uma conversa que ainda está viva.
  const { data: paradas, error } = await supabase
    .from('whatsapp_sessions')
    .select('phone, nome, messages, lead_data')
    .eq('tipo', TIPO_SESSAO)
    .filter('lead_data->>estado', 'eq', 'triando')
    .lt('updated_at', corte)
    .limit(20);

  if (error) {
    logger.error('recepcao-io', 'varredura de triagens paradas falhou', error);
    return { entregues: 0 };
  }

  let entregues = 0;
  for (const s of paradas ?? []) {
    const lead = (s.lead_data ?? {}) as LeadData;
    if (lead.estado !== 'triando') continue;

    const phone = soDigitos(s.phone);
    const msgs = (s.messages as any[]) || [];
    const primeira = msgs.find(m => m.role === 'user')?.content || '';
    const produto = (lead.produto ?? 'outro') as Produto;
    const motivo = lead.motivo || 'Escreveu e parou de responder no meio da triagem';

    try {
      // Fecha ANTES de avisar: se o envio falhar, a conversa não volta pra fila e
      // o consultor não recebe a mesma ficha de minuto em minuto.
      await gravarSessao(phone, msgs, s.nome || null, {
        ...lead, estado: 'entregue', produto, motivo, entregue_em: new Date().toISOString(),
      });
      await registrarLead(phone, s.nome || null, produto, motivo, String(primeira));
      await avisarConsultor(phone, s.nome || null, produto, motivo, String(primeira));
      entregues++;
    } catch (err) {
      logger.error('recepcao-io', `entrega da triagem parada de ${phone} falhou`, err);
    }
  }

  if (entregues) logger.info('recepcao-io', `${entregues} triagem(ns) parada(s) entregue(s) ao humano`);
  return { entregues };
}
