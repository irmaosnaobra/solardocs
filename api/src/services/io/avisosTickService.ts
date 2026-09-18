// ─────────────────────────────────────────────────────────────────────────────
// MENU DE AVISOS — a pauta da base de parceria do eletroposto, 1 a 1, sem rajada.
//
// Quem recebe são as três listas da aba Cadastros, que é a MESMA tabela
// (`eletroposto_parceria`) separada pelo campo `lado`:
//   ponto      → ARRENDAMENTO (quem tem o local)
//   capital    → INVESTIDORES (quem tem o dinheiro)
//   integrador → PARCEIROS    (quem instala)
//
// ── A decisão que desenha este arquivo ──────────────────────────────────────
// A TELA NÃO ESCOLHE DESTINATÁRIO. Ela grava só o texto e quais grupos recebem.
// Quem monta a lista de telefones é ESTE tick, no servidor, com a service key, no
// instante do envio. Três consequências, todas de propósito:
//   1. A chave publishable está no fonte da página (a página é estática). Se a
//      lista viesse do navegador, qualquer um que lesse o fonte teria um canhão
//      apontado pra nossa base. Escolhendo só o texto, o estrago possível é
//      texto errado — ruim, mas não é vazar nem spammar lista de terceiro.
//   2. "Sempre atualizado" sai de graça: quem se cadastrou DEPOIS de o aviso
//      começar entra no mesmo aviso, porque a lista é relida a cada tick.
//   3. Quem a equipe marcou `sem_interesse` na aba Cadastros some da fila sem
//      precisar de uma segunda lista de descadastro pra manter.
//
// ── O que impede de travar a linha 34998165040 ──────────────────────────────
// A linha é UMA e é compartilhada (Bia, followup do gerador, Giovanna, blasts).
// Ela já caiu/bloqueou 3× em 7 dias em agosto, sempre pelo mesmo desenho: leva de
// mensagens no mesmo minuto. Então aqui:
//   • UM envio por tick (o tick roda de 5 em 5 min) — não existe laço de rajada;
//   • espaçamento da LINHA (10–15 min desde o último envio de QUALQUER robô);
//   • janela diurna 9h–20h, sem domingo, a mesma de todo mundo;
//   • teto próprio por hora e por dia (o compartilhado não serve aqui: veja a
//     medição no comentário lá embaixo, ele vive estourado e travaria tudo);
//   • marcador `aviso_sent:` em system_state — está registrado em
//     BOT_SENT_PREFIXES, então o aviso ENTRA na conta dos outros robôs e eles
//     recuam. Sem isso um "bom dia" da Giovanna sairia 10s depois de um aviso.
//   • lock de linha compartilhado com os outros dois motores de blast.
//
// Preço disso: 81 cadastros levam ~4 dias pra receber uma pauta. A tela diz isso
// na cara antes do envio, e o botão do WhatsApp em cada linha da lista existe
// justamente pra quando alguém precisa falar com UM agora.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { MediaType, enviarZapiIO, adquirirLockBlast, liberarLockBlast } from './ioSend';
import { carregarSilenciados, chaveContato } from '../agents/whatsapp/silenciar';
import { dentroDaJanelaDiurna, respeitaEspacamentoLinha } from '../agents/whatsapp/lineThrottle';

/** Os três lados que a tela chama de Arrendamento, Investidores e Parceiros. */
export const LADOS_AVISO = ['ponto', 'capital', 'integrador'] as const;
export type LadoAviso = (typeof LADOS_AVISO)[number];

const LOCK_DURATION_MS = 5 * 60 * 1000;

// Lidos a cada chamada, nunca no arranque do módulo: instância quente na Vercel
// não recarrega módulo, e apertar o teto no meio de um dia ruim não pode
// depender de deploy. Mesma razão dos tetos em lineThrottle.
const num = (nome: string, padrao: number): number => {
  const cru = (process.env[nome] || '').trim();
  if (cru === '') return padrao;
  const v = Number(cru);
  return Number.isFinite(v) && v >= 0 ? v : padrao;
};

/** Teto do aviso por hora. Menor que o da linha de propósito: o resto do
 *  orçamento fica pros robôs que atendem quem levantou a mão. */
export const tetoHora = (): number => num('AVISOS_TETO_HORA', 6);
/** Teto do aviso por dia (dia de Brasília, igual à janela de horário). */
export const tetoDia = (): number => num('AVISOS_TETO_DIA', 20);
/** Piso de dias entre avisos DIFERENTES pra mesma pessoa. Não é o dedup de 45
 *  dias do blast frio (que mataria um canal recorrente): é só o freio que impede
 *  duas pautas na mesma semana virarem duas mensagens no mesmo dia. */
export const diasEntreAvisos = (): number => num('AVISOS_DIAS_ENTRE', 2);
/** Tentativas por pessoa em um mesmo aviso. Erro de Z-API é quase sempre
 *  transitório; sem retry, a pessoa simplesmente nunca recebe a pauta. */
const MAX_TENTATIVAS = 2;

/** Kill-switch. AVISOS_OFF=1 congela tudo sem deploy. */
const desligado = (): boolean => (process.env.AVISOS_OFF || '').trim() === '1';

export interface AvisoRow {
  id: string;
  titulo: string | null;
  corpo: string;
  publicos: string[] | null;
  midia_url: string | null;
  midia_tipo: string | null;
  status: string;
  alvo: number;
  sucesso: number;
  falha: number;
  iniciado_em: string | null;
}

export interface ContatoParceria {
  telefone: string;
  nome: string | null;
  cidade: string | null;
  lado: string;
  status?: string | null;
}

/**
 * O texto que sai no WhatsApp.
 *
 * Sem travessão e sem emoji de enfeite: a mensagem tem que parecer escrita por
 * gente. O título vira negrito porque é o que se lê na notificação; `{nome}` e
 * `{cidade}` são substituídos pelo que a pessoa preencheu no cadastro, e somem
 * quando o campo está vazio (melhor uma frase mais curta que um "Oi ," torto).
 *
 * O rodapé NÃO promete palavra mágica. Não existe hoje um robô que leia "SAIR"
 * vindo de um contato de parceria, e prometer um descadastro que ninguém
 * processa é exatamente o que vira denúncia. O que existe é gente lendo a caixa
 * da linha e a marcação `sem_interesse` na aba Cadastros, que este tick respeita.
 */
export function montarTextoAviso(aviso: Pick<AvisoRow, 'titulo' | 'corpo'>, contato: Partial<ContatoParceria>): string {
  const primeiroNome = String(contato.nome || '').trim().split(/\s+/)[0] || '';
  const cidade = String(contato.cidade || '').trim();
  const corpo = String(aviso.corpo || '')
    .replace(/\{nome\}/gi, primeiroNome)
    .replace(/\{cidade\}/gi, cidade)
    // Token vazio deixa lixo de pontuação pra trás ("Oi ," / "em ."). Limpa.
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const titulo = String(aviso.titulo || '').trim();
  return [
    titulo ? `*${titulo}*` : '',
    titulo ? '' : '',
    corpo,
    '',
    '_Você recebe isso porque se cadastrou como parceiro do eletroposto na Irmãos na Obra. Se não quiser mais, é só responder aqui que a gente tira da lista._',
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

/** Quantos dias uma pauta leva pra chegar em todo mundo, no teto vigente. */
export function previsaoDias(alvo: number, porDia: number = tetoDia()): number {
  if (alvo <= 0 || porDia <= 0) return 0;
  return Math.ceil(alvo / porDia);
}

/** Telefone que a Z-API aceita: BR, com DDI, 12 ou 13 dígitos. */
export function telefoneValido(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 12 || d.length > 13 || !d.startsWith('55')) return null;
  return d;
}

const tipoMidia = (t: unknown): MediaType | null =>
  t === 'image' || t === 'video' || t === 'audio' ? t : null;

/** Começo do dia de BRASÍLIA em ISO. Cortar em 00:00 UTC (21h daqui) zeraria o
 *  teto no meio da noite anterior e liberaria uma segunda leva. */
function inicioDoDiaBr(): string {
  const agoraBr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return new Date(Date.now() - (
    agoraBr.getHours() * 3600_000 + agoraBr.getMinutes() * 60_000 + agoraBr.getSeconds() * 1000
  )).toISOString();
}

/** Envios (tentativas) do canal de avisos numa janela. Conta tentativa e não só
 *  sucesso: erro de Z-API às vezes entrega mesmo assim, e contar por baixo é o
 *  jeito de estourar teto sem perceber. */
async function contarEnvios(desdeIso: string): Promise<number> {
  const { count, error } = await supabaseGerador
    .from('aviso_envios')
    .select('id', { count: 'exact', head: true })
    .gte('enviado_em', desdeIso);
  if (error) {
    // Fail-CLOSED: sem saber quanto já saiu, não sai mais nada neste tick.
    logger.error('avisos', 'não consegui contar envios da janela', error);
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

/**
 * Os OUTROS dois motores de blast desta mesma linha (o de /admin/disparos e o da
 * Central de Automação) não carimbam `system_state`: eles registram só nas
 * tabelas de envio deles. Ou seja, o espaçamento da linha — que lê marcador — é
 * CEGO pra eles. E eles mandam até 10 mensagens por tick.
 *
 * O lock de linha impede dois ticks ao mesmo tempo, mas é solto no fim de cada
 * tick: sem esta checagem, um aviso poderia sair 1 segundo depois da décima
 * mensagem de um disparo, que é exatamente a forma da rajada que derruba número.
 *
 * Hoje as duas tabelas estão zeradas (nenhuma campanha rodou ainda). Isto aqui é
 * o que faz continuar valendo no dia em que voltarem a ser usadas.
 *
 * Fail-open, igual ao espaçamento da casa: erro de leitura não pode calar o
 * canal pra sempre — quem segura o volume é o teto próprio, que é lido antes.
 */
async function blastMandouAgoraPouco(): Promise<boolean> {
  const desde = new Date(Date.now() - ESPACO_BLAST_MS).toISOString();
  const [ger, io] = await Promise.all([
    supabaseGerador.from('gerador_broadcast_envios').select('id').gte('enviado_em', desde).limit(1),
    supabase.from('io_broadcast_envios').select('id').gte('enviado_em', desde).limit(1),
  ]);
  if (ger.error) logger.error('avisos', 'não consegui olhar os envios do disparo do Gerador', ger.error);
  if (io.error) logger.error('avisos', 'não consegui olhar os envios do disparo do admin', io.error);
  return (ger.data?.length ?? 0) > 0 || (io.data?.length ?? 0) > 0;
}

/** Mesma base do espaçamento da linha (10 min), sem o jitter: aqui é só "alguém
 *  acabou de blastar?", não a régua irregular que disfarça padrão de robô. */
const ESPACO_BLAST_MS = 10 * 60 * 1000;

export type AvisoTickResult = {
  enviados: number;
  aviso_id?: string;
  status?: string;
  motivo: string;
  restantes?: number;
  proximo?: string;
  dry?: boolean;
};

/**
 * Um tick = no máximo UM envio. É chamado pelo cron de 5 em 5 min e pelo kick da
 * tela (pro primeiro envio não esperar o cron).
 *
 * `dry` passa por TUDO (janela, tetos, espaçamento, fila) e para na hora de
 * enviar, sem escrever nada. É como se confere um canal que fala com cliente
 * sem gastar uma mensagem com ele: `/cron/avisos-tick?dry=1`.
 */
export async function runAvisosTick(opts: { dry?: boolean } = {}): Promise<AvisoTickResult> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };
  if (!dentroDaJanelaDiurna()) return { enviados: 0, motivo: 'fora_da_janela' };

  // Lock compartilhado com os outros dois motores de blast da MESMA linha.
  if (!(await adquirirLockBlast('avisos', LOCK_DURATION_MS))) {
    return { enviados: 0, motivo: 'linha_ocupada_outro_motor' };
  }
  try {
    return await tickInterno(!!opts.dry);
  } finally {
    await liberarLockBlast('avisos');
  }
}

async function tickInterno(dry: boolean): Promise<AvisoTickResult> {
  const agora = new Date();
  const nowIso = agora.toISOString();

  // ── Tetos, do mais barato de conferir pro mais caro ──────────────────────
  const naHora = await contarEnvios(new Date(Date.now() - 3600_000).toISOString());
  if (naHora >= tetoHora()) return { enviados: 0, motivo: 'teto_hora_avisos' };
  const noDia = await contarEnvios(inicioDoDiaBr());
  if (noDia >= tetoDia()) return { enviados: 0, motivo: 'teto_dia_avisos' };

  // ── POR QUE O TETO COMPARTILHADO DA LINHA NÃO É CONSULTADO AQUI ──────────
  // Medido em 17/09/2026, antes de escrever esta linha: a linha produziu 120
  // marcadores em 24h (68 do agendamento do eletroposto, 50 dos toques do dia da
  // Giovanna, o resto pingado). O teto frio compartilhado é 30/dia. Ou seja: ele
  // vive estourado pelos agentes que têm piso próprio, e qualquer chamador novo
  // que o consultasse ficaria bloqueado PARA SEMPRE — o aviso nunca sairia, e o
  // jeito de descobrir isso seria alguém perguntar por que a pauta não chegou.
  //
  // Então o aviso segue o regime dos outros dois motores de blast desta mesma
  // linha (admin e Central de Automação): operador-iniciado, com teto PRÓPRIO,
  // menor, conferido logo acima. O que o mantém preso à realidade da linha é o
  // espaçamento abaixo, que é o freio que de fato evita ban — e o marcador
  // `aviso_sent:` em BOT_SENT_PREFIXES, que faz os OUTROS robôs recuarem depois
  // de um aviso.
  //
  // Espaçamento: nada sai a menos de 10–15 min do último envio de QUALQUER robô.
  // É o que impede o aviso de colar num toque da Giovanna.
  if (!(await respeitaEspacamentoLinha())) return { enviados: 0, motivo: 'espacamento_linha' };
  // E o espaçamento contra os dois motores de blast, que não aparecem no
  // marcador (o porquê está na função).
  if (await blastMandouAgoraPouco()) return { enviados: 0, motivo: 'blast_em_andamento' };

  // ── O aviso da vez ───────────────────────────────────────────────────────
  const { data: candidatos, error: errBusca } = await supabaseGerador
    .from('avisos')
    .select('*')
    .eq('status', 'rodando')
    .or(`tick_lock_until.is.null,tick_lock_until.lt.${nowIso}`)
    .order('criado_em', { ascending: true })
    .limit(1);
  if (errBusca) {
    logger.error('avisos', 'erro buscando aviso rodando', errBusca);
    return { enviados: 0, motivo: 'erro_busca' };
  }
  const aviso = (candidatos || [])[0] as AvisoRow | undefined;
  if (!aviso) return { enviados: 0, motivo: 'nada_rodando' };

  const publicos = (aviso.publicos || []).filter(l => (LADOS_AVISO as readonly string[]).includes(l));
  if (publicos.length === 0) {
    if (!dry) {
      await supabaseGerador.from('avisos').update({
        status: 'concluido', finalizado_em: nowIso, tick_lock_until: null,
      }).eq('id', aviso.id);
    }
    return { enviados: 0, aviso_id: aviso.id, status: 'concluido', motivo: 'sem_publico', dry: dry || undefined };
  }

  if (!dry) {
    const lockAte = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    await supabaseGerador.from('avisos').update({ tick_lock_until: lockAte }).eq('id', aviso.id);
  }

  try {
    // ── A audiência, lida AGORA (é isso que mantém a lista sempre atualizada) ──
    const { data: brutos, error: errLista } = await supabaseGerador
      .from('eletroposto_parceria')
      .select('telefone, nome, cidade, lado, status')
      .in('lado', publicos)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (errLista) {
      logger.error('avisos', 'erro lendo a base de parceria', errLista);
      return { enviados: 0, aviso_id: aviso.id, motivo: 'erro_lista' };
    }

    // Dedupe por DDD + 8 últimos dígitos (a mesma chave do resto da casa: a
    // Z-API alterna o nono dígito e sem isso a mesma pessoa recebe duas vezes).
    const porChave = new Map<string, ContatoParceria>();
    for (const r of (brutos || []) as ContatoParceria[]) {
      if (String(r.status || '') === 'sem_interesse') continue;   // a equipe já marcou que não quer
      const tel = telefoneValido(r.telefone);
      if (!tel) continue;
      const k = chaveContato(tel);
      if (!k || porChave.has(k)) continue;
      porChave.set(k, { ...r, telefone: tel });
    }
    const contatos = [...porChave.values()];

    // ── Quem já foi, quem pediu pra parar, quem levou aviso faz pouco tempo ──
    const { data: jaRows, error: errJa } = await supabaseGerador
      .from('aviso_envios').select('phone, status').eq('aviso_id', aviso.id);
    if (errJa) {
      // Sem essa leitura, todo mundo parece novo e o aviso inteiro sai de novo.
      logger.error('avisos', 'erro lendo envios do aviso — pulando o tick', errJa);
      return { enviados: 0, aviso_id: aviso.id, motivo: 'erro_envios' };
    }
    const tentativas = new Map<string, number>();
    const entregues = new Set<string>();
    for (const r of (jaRows || []) as Array<{ phone: string; status: string }>) {
      const k = chaveContato(r.phone) || r.phone;
      tentativas.set(k, (tentativas.get(k) || 0) + 1);
      if (r.status === 'ok') entregues.add(k);
    }

    const silenciado = await carregarSilenciados();

    const corteIso = new Date(Date.now() - diasEntreAvisos() * 86400_000).toISOString();
    const recentes = new Set<string>();
    if (diasEntreAvisos() > 0) {
      const { data: outros, error: errOutros } = await supabaseGerador
        .from('aviso_envios').select('phone, aviso_id, status')
        .gte('enviado_em', corteIso).eq('status', 'ok').limit(5000);
      if (errOutros) {
        logger.error('avisos', 'piso entre avisos indisponível — pulando o tick', errOutros);
        return { enviados: 0, aviso_id: aviso.id, motivo: 'piso_indisponivel' };
      }
      for (const r of (outros || []) as Array<{ phone: string; aviso_id: string }>) {
        if (r.aviso_id !== aviso.id) recentes.add(chaveContato(r.phone) || r.phone);
      }
    }

    const fila = contatos.filter(c => {
      const k = chaveContato(c.telefone) || c.telefone;
      if (entregues.has(k)) return false;
      if ((tentativas.get(k) || 0) >= MAX_TENTATIVAS) return false;
      if (silenciado(c.telefone)) return false;
      if (recentes.has(k)) return false;
      return true;
    });

    // `alvo` é o tamanho da audiência viva, recalculado a cada tick: cadastro
    // novo no meio do aviso aumenta o alvo em vez de "concluir" a pauta cedo.
    const alvo = contatos.filter(c => !silenciado(c.telefone)).length;

    if (fila.length === 0) {
      // Fila vazia por piso de dias não é aviso concluído: é aviso esperando a
      // vez. Só conclui quando não sobrou ninguém pendente de verdade.
      const soEsperando = contatos.some(c => {
        const k = chaveContato(c.telefone) || c.telefone;
        return !entregues.has(k) && (tentativas.get(k) || 0) < MAX_TENTATIVAS
          && !silenciado(c.telefone) && recentes.has(k);
      });
      if (soEsperando) {
        if (!dry) await supabaseGerador.from('avisos').update({ alvo, tick_lock_until: null }).eq('id', aviso.id);
        return { enviados: 0, aviso_id: aviso.id, status: 'rodando', motivo: 'aguardando_piso_de_dias', dry: dry || undefined };
      }
      if (!dry) {
        await supabaseGerador.from('avisos').update({
          status: 'concluido', finalizado_em: nowIso, alvo, tick_lock_until: null,
        }).eq('id', aviso.id);
      }
      return { enviados: 0, aviso_id: aviso.id, status: 'concluido', motivo: 'todos_receberam', dry: dry || undefined };
    }

    // ── UM envio. Não existe laço aqui, e é de propósito ────────────────────
    const alvoDaVez = fila[0];
    if (dry) {
      return {
        enviados: 0, aviso_id: aviso.id, status: 'rodando', motivo: 'passaria_agora',
        restantes: fila.length, proximo: alvoDaVez.telefone, dry: true,
      };
    }
    const midiaTipo = tipoMidia(aviso.midia_tipo);
    const texto = montarTextoAviso(aviso, alvoDaVez);
    // Áudio vai sozinho (a Z-API não aceita caption em send-audio).
    const mensagem = midiaTipo === 'audio' ? '' : texto;

    let ok = false;
    let zaapId: string | null = null;
    let messageId: string | null = null;
    let erro: string | null = null;
    try {
      const r = await enviarZapiIO(alvoDaVez.telefone, mensagem, aviso.midia_url, midiaTipo);
      ok = r.ok;
      zaapId = r.zaapId ?? null;
      messageId = r.messageId ?? null;
      if (!r.ok) erro = r.erro ?? 'erro desconhecido';
    } catch (err) {
      erro = err instanceof Error ? err.message : String(err);
    }

    await supabaseGerador.from('aviso_envios').insert({
      aviso_id: aviso.id,
      phone: alvoDaVez.telefone,
      lado: alvoDaVez.lado,
      status: ok ? 'ok' : 'erro',
      erro,
      zaap_id: zaapId,
      message_id: messageId,
    });

    if (ok) {
      // Marcador no teto da linha. O prefixo está registrado em
      // BOT_SENT_PREFIXES (lineThrottle): sem ele o aviso furaria o teto dos
      // outros robôs e alguém sairia 10 segundos depois desta mensagem.
      await supabase.from('system_state').upsert(
        { key: `aviso_sent:${alvoDaVez.telefone}:${aviso.id}`, value: '1', updated_at: nowIso },
        { onConflict: 'key' },
      ).then(({ error }) => {
        if (error) logger.error('avisos', `marcador da linha falhou (${alvoDaVez.telefone})`, error);
      });
    }

    const patch: Record<string, unknown> = {
      alvo,
      sucesso: aviso.sucesso + (ok ? 1 : 0),
      falha: aviso.falha + (ok ? 0 : 1),
      tick_lock_until: null,
    };
    if (!aviso.iniciado_em) patch.iniciado_em = nowIso;
    if (fila.length === 1 && ok) {
      patch.status = 'concluido';
      patch.finalizado_em = nowIso;
    }
    await supabaseGerador.from('avisos').update(patch).eq('id', aviso.id);

    logger.info('avisos', `${ok ? 'enviado' : 'FALHOU'} ${alvoDaVez.telefone} (${alvoDaVez.lado}) · aviso ${aviso.id} · restam ${fila.length - 1}`);
    return {
      enviados: ok ? 1 : 0,
      aviso_id: aviso.id,
      status: patch.status ? String(patch.status) : 'rodando',
      motivo: ok ? 'enviado' : 'falha_envio',
      restantes: fila.length - 1,
    };
  } catch (err) {
    logger.error('avisos', `erro fatal no aviso ${aviso.id}`, err);
    await supabaseGerador.from('avisos').update({ tick_lock_until: null }).eq('id', aviso.id);
    return { enviados: 0, aviso_id: aviso.id, motivo: 'erro_fatal' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEM RESPONDEU A PAUTA
//
// A tela mostrava entregues, faltam e previsão. Nenhum dos três é o número que
// importa numa pauta de oportunidade: o que importa é QUEM MORDEU. Medido em
// 18/09/2026, com a pauta "OPORTUNIDADE" em 13 de 73 entregues, exatamente 1
// pessoa tinha respondido — e esse 1 não aparecia em lugar nenhum. Ele só foi
// descoberto porque alguém perguntou.
//
// Vale como resposta só o que chegou DEPOIS do envio pra aquela pessoa. Mensagem
// anterior é conversa velha, e contar conversa velha como resposta inflaria o
// número justamente no caso em que a pauta foi pra alguém que já falava com a
// gente — que é o erro mais fácil de cometer aqui e o mais caro de acreditar.
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvioDaPauta { phone: string; enviado_em: string }
export interface FalaRecebida { telefone: string; momment: string; texto: string | null; chat_name?: string | null }
export interface RespostaDaPauta { phone: string; nome: string | null; quando: string; texto: string | null }

/**
 * Casa envios com as falas que chegaram depois. Pura de propósito: é a regra
 * que decide um número que a equipe vai ler, então tem que dar pra testar sem
 * banco.
 */
export function casarRespostas(envios: EnvioDaPauta[], falas: FalaRecebida[]): RespostaDaPauta[] {
  const enviadoEm = new Map<string, string>();
  for (const e of envios) {
    const k = chaveContato(e.phone) || e.phone;
    const atual = enviadoEm.get(k);
    // Se a mesma pessoa recebeu mais de uma vez, vale o envio MAIS ANTIGO: a
    // resposta dela responde à primeira vez que falamos, não à última.
    if (!atual || e.enviado_em < atual) enviadoEm.set(k, e.enviado_em);
  }
  // QUANDO ela reagiu e O QUE ela disse são duas perguntas diferentes, e juntar
  // as duas numa mensagem só dá resposta errada nas duas.
  //
  // Provado com o primeiro caso real: o Wellington respondeu "Bom dia" às 15:17 e
  // "Fale sobre essa oportunidade" às 15:17 também. Guardar a primeira mostrava
  // "Bom dia", que não diz nada; guardar a última mostraria "ok", que diz menos
  // ainda. Então o horário é o da PRIMEIRA (foi quando ele reagiu) e o texto é o
  // MAIOR da rajada em que ele reagiu (foi o que ele veio dizer).
  const RAJADA_MS = 2 * 60 * 60 * 1000;
  const porPessoa = new Map<string, RespostaDaPauta & { _t0: number }>();
  for (const f of falas) {
    const k = chaveContato(f.telefone) || f.telefone;
    const envio = enviadoEm.get(k);
    if (!envio || f.momment <= envio) continue;
    const t = Date.parse(f.momment);
    const ja = porPessoa.get(k);
    if (!ja) {
      porPessoa.set(k, { phone: f.telefone, nome: f.chat_name || null, quando: f.momment, texto: f.texto ?? null, _t0: t });
      continue;
    }
    if (f.momment < ja.quando) { ja.quando = f.momment; ja._t0 = t; }
    ja.nome = ja.nome || f.chat_name || null;
    const dentroDaRajada = Math.abs(t - ja._t0) <= RAJADA_MS;
    if (dentroDaRajada && (f.texto || '').length > (ja.texto || '').length) ja.texto = f.texto ?? null;
  }
  return [...porPessoa.values()]
    .map(({ _t0, ...r }) => r)
    .sort((a, b) => (a.quando < b.quando ? 1 : -1));
}

/** Quem respondeu a uma pauta, lendo os dois bancos (envios no gerador, conversa na linha). */
export async function respostasDaPauta(avisoId: string): Promise<{ entregues: number; respostas: RespostaDaPauta[] }> {
  const { data: envios, error: errEnvios } = await supabaseGerador
    .from('aviso_envios').select('phone, enviado_em').eq('aviso_id', avisoId).eq('status', 'ok').limit(5000);
  if (errEnvios) throw new Error(`ler envios da pauta falhou: ${errEnvios.message}`);
  const lista = (envios || []) as EnvioDaPauta[];
  if (lista.length === 0) return { entregues: 0, respostas: [] };

  const maisAntigo = lista.reduce((min, e) => (e.enviado_em < min ? e.enviado_em : min), lista[0].enviado_em);
  const fones = [...new Set(lista.map(e => e.phone))];
  const { data: falas, error: errFalas } = await supabase
    .from('wa_mensagens')
    .select('telefone, momment, texto, chat_name')
    .eq('from_me', false)
    .in('telefone', fones)
    .gte('momment', maisAntigo)
    .order('momment', { ascending: false })
    .limit(5000);
  if (errFalas) throw new Error(`ler respostas falhou: ${errFalas.message}`);

  return { entregues: lista.length, respostas: casarRespostas(lista, (falas || []) as FalaRecebida[]) };
}
