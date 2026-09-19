// ─────────────────────────────────────────────────────────────────────────────
// PLACAR DO 5040 — de 2 em 2 horas, quantas conversas estão esperando resposta.
//
// Pedido do Thiago (18/09/2026): a Giovanna precisa saber, durante o dia, quanta
// gente escreveu pra linha 34998165040 e continua sem retorno. Não é lista de
// nome, não é cobrança: é o PLACAR. Um número, cinco vezes por dia, de segunda a
// sexta.
//
// ── Por que isto não é a sentinela do vácuo de novo ─────────────────────────
//
// A `sentinelaVacuo` manda pra Giovanna a LISTA nominal do que é dela (produto
// solar), com link da conversa e três níveis de cobrança. Ela responde "quem
// está esperando". Este serviço responde outra pergunta: "quanto tem na fila da
// LINHA INTEIRA, e está subindo ou descendo?".
//
// Repetir a lista aqui seria o erro que o próprio comentário da sentinela nomeia
// — o robô que repete é o robô que a equipe silencia. Por isso aqui não sai nome
// nenhum: números, e o delta contra o tick anterior. É o delta que faz um número
// repetido 5 vezes por dia continuar sendo lido: "97 → 100" é informação, "100"
// cinco vezes seguidas é ruído.
//
// ── "Sem ler" não existe no banco, e é melhor assim ─────────────────────────
//
// `wa_mensagens` é o espelho do que entrou e saiu da linha; não existe coluna de
// lida. Medir "não lida" de verdade exigiria bater na Z-API a cada tick, e o que
// ela devolve mente pro que o Thiago quer saber: abrir o WhatsApp Web marca tudo
// como lido sem ninguém ter respondido nada.
//
// O que este placar conta é o que sobra depois disso: A ÚLTIMA PALAVRA É DELES.
// Ninguém respondeu, lido ou não. O texto da mensagem diz isso com todas as
// letras, pra ninguém confundir o número com o balãozinho verde do celular.
//
// ── A bolha da Duda não conta como resposta ─────────────────────────────────
//
// Mesma armadilha que a sentinela levou em 17/09: quando a recepção tria e passa
// pro humano, ela manda "Já já alguém responde!". Isso é `from_me`, e a regra
// crua ("nossa mais nova que a dela") lê a conversa como ATENDIDA no exato
// segundo em que a espera começa.
//
// Medido no banco em 18/09/2026, na janela de 7 dias: regra crua acusa 78
// conversas esperando; com a bolha de entrega descontada são 100. Ou seja, 22%
// da fila — e justamente a parte que mais importa, porque é a que a recepção já
// entregou e o humano não veio buscar. Sem esta regra o placar nasceria mentindo
// pra menos.
//
// ── O que segura o volume ───────────────────────────────────────────────────
//
// Marcador `placar_5040:<dia>:<hora>` no `system_state`, carimbado ANTES do
// envio. O GitHub Actions atrasa e repete, e o cron mestre roda de hora em hora:
// sem o carimbo, o mesmo placar sairia duas vezes no mesmo slot. É o bug
// `bd6f994` (dois chamadores lendo a mesma fila no minuto :00) em outra roupa.
//
// O envio NÃO passa pelo teto anti-ban da linha, pela mesma medida já escrita na
// sentinela: o destinatário é o celular da própria equipe, conversa aberta há
// meses, 5 mensagens por dia. Teto existe pra proteger a linha de toque frio em
// desconhecido. Gastar orçamento de lead com recado interno é o bug ao contrário
// — o que calou todos os follow-ups quando a agenda comeu o orçamento.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { ehFeriadoBR } from '../../utils/feriadosBR';

/** Instância da linha IO (34998165040) em `wa_mensagens`. A env manda; o valor é
 *  o mesmo fallback medido da sentinela, pro placar não morrer calado num deploy
 *  sem env. */
const INSTANCIA_IO = (): string =>
  (process.env.ZAPI_INSTANCE_ID_IO || '').trim() || '3F26F6ECE67D72BB7FCA6244BF24326C';

/** Celular da Giovanna. Mesmo número que a sentinela já usa em produção. */
const DESTINO = (): string => (process.env.PLACAR_DESTINO || '').trim() || '34993396255';

/**
 * As horas (BRT) em que o placar sai. De 2 em 2 horas dentro da janela 08–17,
 * que dá 08, 10, 12, 14 e 16 — as 17h fecham a janela, não ganham disparo
 * próprio (17 quebraria o "de 2 em 2" logo no último passo).
 *
 * Em env porque mudar cadência de recado interno não merece deploy.
 */
export const horasDoPlacar = (): number[] =>
  (process.env.PLACAR_HORAS || '8,10,12,14,16')
    .split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 23);

/** Kill-switch. PLACAR_OFF=1 cala o placar sem deploy. */
export const desligado = (): boolean => (process.env.PLACAR_OFF || '').trim() === '1';

/** Quantos dias de conversa entram na conta. A fila que interessa é a da semana;
 *  quem escreveu há 10 dias e não voltou não está esperando, desistiu.
 *
 *  Nome com `JANELA` no meio de propósito: `PLACAR_DIAS` do lado de `PLACAR_HORAS`
 *  convidava a escrever dia da semana aqui, que é outra coisa. */
const DIAS_JANELA = Number(process.env.PLACAR_JANELA_DIAS || 7);

/** Agora em horário de Brasília, como Date lido pelos getters locais. */
export function agoraBrt(base: Date = new Date()): Date {
  return new Date(base.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

const ymd = (b: Date): string =>
  `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`;

/**
 * A que disparo este tick pertence — e o ponto é a FOLGA DE UMA HORA.
 *
 * O GitHub Actions promete :00 e entrega quando dá. Não é teoria: o comentário
 * do `process-messages.yml` deste mesmo repo mede o agendamento de 5 em 5 minutos
 * rodando de 2 a 5 horas em 5. Com hora exata, um disparo pras 11h UTC que começa
 * às 12h05 cai em `fora_da_hora` e o placar das 08h simplesmente não chega —
 * HTTP 200, nenhum erro, nada no celular dela.
 *
 * A folga é de graça porque quem impede o envio dobrado é o carimbo do slot, não
 * o relógio: tick atrasado entrega o placar das 08h, carimbado como 08h.
 */
export function slotDe(agora: Date = new Date()): number | null {
  const h = agoraBrt(agora).getHours();
  const horas = horasDoPlacar();
  if (horas.includes(h)) return h;
  if (horas.includes(h - 1)) return h - 1;                  // tick atrasado, mesmo slot
  return null;
}

/**
 * Dá pra mandar o placar AGORA?
 *
 * Segunda a sexta, dentro de um slot (com a folga acima), fora de feriado. O
 * feriado é acréscimo meu e não estava no pedido: em dia que ninguém trabalha o
 * número não muda, e um placar parado chegando no feriado é o tipo de recado que
 * ensina a ignorar o robô. Mesma decisão que a passagem das 19h da Nilce já toma.
 *
 * Pura e exportada de propósito: é a regra que decide se o celular dela toca, e
 * regra assim é o que o teste prende.
 */
export function noHorario(agora: Date = new Date()): { ok: boolean; motivo?: string; slot: number | null } {
  const b = agoraBrt(agora);
  const dia = b.getDay();                                   // 0 = domingo, 6 = sábado
  if (dia === 0 || dia === 6) return { ok: false, motivo: 'fim_de_semana', slot: null };
  if (ehFeriadoBR(ymd(b))) return { ok: false, motivo: 'feriado', slot: null };
  const slot = slotDe(agora);
  if (slot === null) return { ok: false, motivo: 'fora_da_hora', slot: null };
  return { ok: true, slot };
}

export interface Placar {
  conversas: number;        // pessoas com a bola do nosso lado
  mensagens: number;        // mensagens delas ainda sem retorno
  hoje: number;             // dessas conversas, quantas falaram hoje
  mais24h: number;          // quantas esperam há mais de 24 horas
  maisAntigaH: number;      // horas de espera da mais antiga
  hora: number;             // hora BRT deste placar
  anterior: number | null;  // quantas conversas no tick anterior (null no 1º do dia)
  horaAnterior: number | null;
}

/** Espera legível: 3h vira "3h", 50h vira "2 dias". */
function espera(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 48) return `${Math.floor(horas)}h`;
  return `${Math.floor(horas / 24)} dias`;
}

/**
 * O texto. Pura, pra dar pra ler o recado num teste sem tocar no banco nem na
 * Z-API — que é a única forma de conferir tom e número antes de acordar alguém.
 */
export function montarPlacar(p: Placar): string {
  const linhas: string[] = [];
  const hh = `${String(p.hora).padStart(2, '0')}h`;

  if (p.conversas === 0) {
    linhas.push(`✅ *Caixa do 5040 zerada — ${hh}*`, '', 'Ninguém esperando resposta. Fila limpa.');
    return linhas.join('\n');
  }

  linhas.push(
    `📥 *Caixa do 5040 — ${hh}*`,
    '',
    `*${p.conversas}* ${p.conversas === 1 ? 'pessoa esperando' : 'pessoas esperando'} resposta`,
    `*${p.mensagens}* ${p.mensagens === 1 ? 'mensagem' : 'mensagens'} sem retorno`,
  );

  const detalhe: string[] = [];
  if (p.hoje > 0) detalhe.push(`${p.hoje} ${p.hoje === 1 ? 'escreveu' : 'escreveram'} hoje`);
  if (p.mais24h > 0) detalhe.push(`${p.mais24h} esperando há mais de 24h`);
  if (p.maisAntigaH >= 1) detalhe.push(`a mais antiga há ${espera(p.maisAntigaH)}`);
  if (detalhe.length) linhas.push('', detalhe.map(d => `• ${d}`).join('\n'));

  // O delta. É o que transforma um número repetido em informação.
  if (p.anterior !== null && p.horaAnterior !== null) {
    const d = p.conversas - p.anterior;
    const ha = `${String(p.horaAnterior).padStart(2, '0')}h`;
    linhas.push('', d === 0
      ? `_Igual às ${ha} (${p.anterior}). A fila não andou._`
      : d > 0
        ? `_Às ${ha} eram ${p.anterior}. Subiu ${d}._`
        : `_Às ${ha} eram ${p.anterior}. Caiu ${Math.abs(d)}._`);
  }

  linhas.push('', '_Conta quem falou por último e não teve resposta — lido ou não._');
  return linhas.join('\n');
}

export interface ResultadoPlacar {
  enviado: boolean;
  motivo?: string;
  placar?: Placar;
  texto?: string;
}

const chaveSlot = (b: Date, hora: number): string => `placar_5040:${ymd(b)}:${hora}`;
const CHAVE_ULTIMO = 'placar_5040_ultimo';

/**
 * Lê a linha e monta o placar. Separada do envio porque conferir o número é uma
 * pergunta, não um disparo — é o que o `?seco=1` da rota usa.
 */
export async function medirPlacar(hora: number): Promise<Placar | null> {
  const agora = new Date();
  const desde = new Date(Date.now() - DIAS_JANELA * 86400_000).toISOString();

  // LÊ PAGINADO, e é a correção do defeito que quase entrou aqui inteiro.
  //
  // A tentação é um `.limit(20000)` só. Não funciona: o PostgREST tem teto
  // próprio de linhas por resposta e devolve a fatia calada, sem erro. Pedir
  // 20 mil e receber mil parece leitura completa — e o guarda `length >= limite`
  // nunca dispara, porque o corte não é o que a gente pediu.
  //
  // A conta de 19/09/2026: a linha faz ~5.500 mensagens por semana. Com teto de
  // mil e ordem decrescente, o placar enxergaria pouco mais de UM dia e contaria
  // ~22 conversas onde existem 100 — e 78 das 100 esperam há mais de 24h, ou
  // seja, some justo o que mais importa. Número baixo, nenhum erro, e o placar
  // dizendo que está tudo bem.
  //
  // É o mesmo buraco que escondeu gente da sentinela até 18/09, só que lá a
  // ordem crescente fazia perder o RECENTE. Paginando, não se perde nenhum.
  const PAGINA = Number(process.env.PLACAR_PAGINA || 1000);
  const TETO_PAGINAS = Number(process.env.PLACAR_MAX_PAGINAS || 40);   // 40 mil msgs: 7x a semana cheia
  const msgs: Array<Record<string, unknown>> = [];
  for (let pagina = 0; pagina < TETO_PAGINAS; pagina++) {
    const de = pagina * PAGINA;
    const { data, error } = await supabase
      .from('wa_mensagens')
      .select('telefone, from_me, momment')
      .eq('instancia', INSTANCIA_IO())
      .eq('is_group', false)
      .gte('momment', desde)
      .order('momment', { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) {
      logger.error('placar-5040', 'falha lendo as conversas', error);
      return null;
    }
    const lote = (data || []) as Array<Record<string, unknown>>;
    msgs.push(...lote);
    if (lote.length < PAGINA) break;                        // última página
    if (pagina === TETO_PAGINAS - 1) {
      // Chegar aqui é ou a linha ter explodido de volume, ou a janela ter sido
      // aumentada sem pensar. Nos dois casos o número sai baixo, então tem que
      // aparecer no log em vez de virar um placar otimista.
      logger.warn('placar-5040', `teto de ${TETO_PAGINAS} páginas atingido: a semana pode ter ficado incompleta`);
    }
  }

  // Quem entregou, e quando — pra não contar a bolha da recepção como resposta.
  const { data: sessoes } = await supabase
    .from('whatsapp_sessions').select('phone, lead_data').eq('tipo', 'recepcao_io').limit(2000);
  const entregues = new Map<string, number>();
  for (const s of (sessoes || []) as Array<Record<string, any>>) {
    const k = chaveContato(String(s.phone || ''));
    const em = String(s.lead_data?.entregue_em || '');
    if (k && String(s.lead_data?.estado || '') === 'entregue' && em) {
      const t = Date.parse(em);
      if (Number.isFinite(t)) entregues.set(k, t);
    }
  }
  const FOLGA_ENTREGA_MS = 120_000;

  interface Estado { pendentes: number; ultimaDeles: number | null; respondido: boolean }
  const porTel = new Map<string, Estado>();
  for (const m of (msgs || []) as Array<Record<string, unknown>>) {
    const k = chaveContato(String(m.telefone || ''));
    if (!k) continue;
    const t = Date.parse(String(m.momment || ''));
    if (!Number.isFinite(t)) continue;
    const e = porTel.get(k) || { pendentes: 0, ultimaDeles: null, respondido: false };
    if (e.respondido) continue;                   // já achei nossa resposta mais nova: o resto é passado
    if (m.from_me) {
      // A despedida da recepção não é gente chegando. Se a nossa mensagem caiu
      // na janela da entrega, ela não fecha a conversa — segue contando.
      const entregueEm = entregues.get(k);
      const ehBolhaDeEntrega = entregueEm !== undefined && Math.abs(t - entregueEm) <= FOLGA_ENTREGA_MS;
      if (!ehBolhaDeEntrega) e.respondido = true;
    } else {
      e.pendentes += 1;
      if (e.ultimaDeles === null) e.ultimaDeles = t;
    }
    porTel.set(k, e);
  }

  // Os celulares da casa não são lead esperando.
  const DA_CASA = new Set(
    ['34991360223', '34991360172', '34991516846', '34993396255']
      .map(p => chaveContato(p)).filter(Boolean) as string[],
  );

  const b = agoraBrt(agora);
  const inicioDoDia = agora.getTime() - (b.getHours() * 3600_000 + b.getMinutes() * 60_000 + b.getSeconds() * 1000);
  let conversas = 0, mensagens = 0, hoje = 0, mais24h = 0, maisAntiga = 0;
  for (const [k, e] of porTel) {
    if (DA_CASA.has(k)) continue;
    if (e.respondido || e.pendentes === 0 || e.ultimaDeles === null) continue;
    conversas += 1;
    mensagens += e.pendentes;
    const horas = (agora.getTime() - e.ultimaDeles) / 3_600_000;
    if (e.ultimaDeles >= inicioDoDia) hoje += 1;
    if (horas >= 24) mais24h += 1;
    if (horas > maisAntiga) maisAntiga = horas;
  }

  // O placar anterior, pro delta. Só vale se for do MESMO dia: comparar as 8h de
  // hoje com as 16h de ontem diria "caiu 40" sem nada ter sido respondido.
  let anterior: number | null = null;
  let horaAnterior: number | null = null;
  const { data: ult } = await supabase
    .from('system_state').select('value').eq('key', CHAVE_ULTIMO).maybeSingle();
  const v = ult?.value as { dia?: string; hora?: number; conversas?: number } | undefined;
  if (v && v.dia === ymd(b) && typeof v.conversas === 'number' && typeof v.hora === 'number' && v.hora !== hora) {
    anterior = v.conversas;
    horaAnterior = v.hora;
  }

  return {
    conversas, mensagens, hoje, mais24h,
    // Limitado pela janela de leitura: quem espera há três semanas aparece como
    // "há 7 dias", porque é só até ali que a consulta olha. Tudo bem pro que o
    // placar faz (dar tamanho da fila) e mentiria se virasse régua de prazo.
    maisAntigaH: Math.round(maisAntiga * 10) / 10,
    hora, anterior, horaAnterior,
  };
}

/**
 * Um tick. `seco` mede e devolve o texto sem mandar nada; `forcar` ignora a
 * janela de horário (mas continua carimbando, pra não virar repetidor manual).
 */
export async function runPlacarGiovanna(
  opts: { seco?: boolean; forcar?: boolean } = {},
): Promise<ResultadoPlacar> {
  const seco = !!opts.seco;
  if (desligado()) return { enviado: false, motivo: 'desligado' };

  const janela = noHorario();
  if (!seco && !opts.forcar && !janela.ok) return { enviado: false, motivo: janela.motivo };

  const b = agoraBrt();
  // Forçado fora de hora não tem slot: carimba a hora corrente, pra dois
  // disparos manuais seguidos não virarem duas mensagens no celular dela.
  const hora = janela.slot ?? b.getHours();
  const chave = chaveSlot(b, hora);

  // CARIMBA ANTES DE MEDIR, E O `forcar` NÃO PULA ISTO. O Actions repete e
  // atrasa, e o disparo manual é um botão que dá pra apertar duas vezes: dois
  // chamadores no mesmo slot mandariam o mesmo placar duas vezes. Carimbar
  // depois do envio deixaria a janela aberta justamente enquanto a leitura dos 7
  // dias roda, que é a parte demorada.
  //
  // Só o `seco` passa por cima, e passa porque não manda nada — conferir o
  // número é uma pergunta, e pergunta não pode gastar o disparo do dia.
  if (!seco) {
    const { data: ja } = await supabase
      .from('system_state').select('key').eq('key', chave).maybeSingle();
    if (ja) return { enviado: false, motivo: 'ja_enviado_neste_slot' };
    const agoraIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: chave, value: { em: agoraIso }, updated_at: agoraIso }, { onConflict: 'key' },
    );
  }

  const placar = await medirPlacar(hora);
  if (!placar) return { enviado: false, motivo: 'erro_leitura' };
  const texto = montarPlacar(placar);
  if (seco) return { enviado: false, motivo: 'seco', placar, texto };

  try {
    await sendWhatsApp(DESTINO(), texto, 'io');
  } catch (err) {
    logger.error('placar-5040', 'falha mandando o placar', err);
    return { enviado: false, motivo: 'erro_envio', placar, texto };
  }

  // O número deste tick vira a base do delta do próximo. Só depois do envio:
  // placar que não chegou não pode servir de "às 12h eram 97".
  const agoraIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: CHAVE_ULTIMO, value: { dia: ymd(b), hora, conversas: placar.conversas, em: agoraIso }, updated_at: agoraIso },
    { onConflict: 'key' },
  );

  logger.info('placar-5040', `placar das ${hora}h: ${placar.conversas} conversa(s), ${placar.mensagens} mensagem(ns)`);
  return { enviado: true, placar, texto };
}
