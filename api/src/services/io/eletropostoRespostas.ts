// ─────────────────────────────────────────────────────────────────────────────
// QUANDO O LEAD RESPONDE A AUTOMAÇÃO DA AGENDA — o recado vai pro Thiago e pro Diego.
//
// O agente de agendamento (eletropostoAgenda.ts) pede "responde SIM" e pede o
// material do ponto. Até aqui essa resposta caía no 5040 e ficava lá: ninguém
// responde por robô nessa linha, e o recibo de entrada só sai 12h e 18h. Ou seja,
// o lead confirmava presença e a equipe descobria no dia seguinte — ou não
// descobria. Pedir resposta e não ler a resposta é pior que não pedir.
//
// Aqui é o outro lado da conversa: toda vez que alguém com reunião marcada
// escreve DEPOIS de a automação falar com ele, o Thiago e o Diego recebem o
// recado no WhatsApp, com o que a pessoa escreveu, quando é a reunião e de quem
// ela é.
//
// ── O que ele lê ──
// `wa_mensagens` (Supabase solardoc-pro): a fila normalizada do webhook da linha,
// com trigger ao vivo. É a MESMA fonte do conversa_wa() — não é o poller do SDR,
// que só guarda telefone e hora, sem texto.
//
// ── Casamento de telefone ──
// A Z-API entrega o inbound às vezes SEM o 9º dígito ("556984488158") e a ficha
// tem ele ("5569984488158"). Por isso a chave é DDD + últimos 8, a mesma do
// blastRespostas e do CRM. Casar telefone cru aqui faria o agente nunca disparar,
// em silêncio — foi conferido contra as 16 reuniões vivas antes de subir.
//
// ── Travas ──
//   • Só ficha que a automação TOCOU (tem alguma das 3 flags) e só mensagem
//     posterior ao toque: conversa que o humano já estava tendo não vira alerta.
//   • Marcador por ficha guarda até onde já foi avisado → nem repete, nem pula
//     mensagem nova. Lead falante gera 2 ou 3 avisos, e tudo bem: o pedido do
//     dono foi "sempre nos mantém informado".
//   • Espera curta antes de avisar, só pra não cortar um "Sim" seguido de
//     "obrigado" em dois recados.
//   • Teto de avisos por rodada.
//
// Kill-switch: EP_RESPOSTAS_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import {
  quandoPorExtenso, carregarConsultores, EP_NAO_ATENDEU_PREFIX, EP_RESPOSTA_PREFIX,
} from './eletropostoAgenda';
import { passoDeRemarcacao, linhaDoAviso } from './eletropostoRemarcar';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();

// A definição mora no eletropostoAgenda (este módulo já importa de lá; a volta
// faria ciclo) e é re-exportada aqui porque este é o agente que a ESCREVE.
export { EP_RESPOSTA_PREFIX };

/** Espera curta: junta o "Sim" com o "obrigado" que vem logo atrás, sem segurar
 *  o aviso. Conversa longa se espalha por horas mesmo — não adianta esperar. */
const ESPERA_MS = 30 * 1000;
/** Teto de leitura: não acorda conversa velha ao subir o módulo pela primeira vez. */
const LOOKBACK_MAX_MS = 3 * 24 * 3600_000;
const MAX_AVISOS_POR_TICK = 5;
/** Reunião que já passou há mais de 2 dias não gera mais aviso de agenda. */
const PASSADO_MAX_MS = 2 * 24 * 3600_000;

const desligado = () => (process.env.EP_RESPOSTAS_OFF || '').trim() === '1';

/** Mesma chave do CRM e do blastRespostas: DDD + últimos 8 (ignora 9º dígito e DDI). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

const RE_REMARCAR = /\b(remarcar|remarca|adiar|cancelar|cancela|desmarcar|n[ãa]o vou|n[ãa]o consigo|n[ãa]o poderei|n[ãa]o vai dar|outro dia|outro hor[áa]rio|nesse hor[áa]rio n[ãa]o)\b/i;

// ── O que conta como CONFIRMAR MESMO ────────────────────────────────────────
// Regra do dono (04/08): "confirmaram quando confirmar mesmo". Então o campo
// presenca_confirmada_at é apertado de propósito, em dois caminhos:
//
//   1. A mensagem INTEIRA é uma afirmativa. "Sim", "ok", "👍" respondendo ao
//      pedido de confirmação é confirmação. O `$` no fim é o que separa isso de
//      "ok, mas quanto vou gastar?" — que é pergunta, não presença.
//   2. Verbo explícito de confirmar em qualquer lugar da frase.
//
// Nada de "beleza" solto no meio de um parágrafo: contar isso como presença
// enche o painel de gente que não vai aparecer, que é exatamente o problema que
// o agente existe pra resolver.
const RE_AFIRMATIVA_INTEIRA = /^(sim+|isso|ok|okay|okey|blz|beleza|certo|combinado|confirmo|confirmado|confirmada|positivo|claro|perfeito|show|t[áa]|t[áa] bom|ta bom|vou sim|estarei|estou|t[ôo] dentro|com certeza)[\s!.,👍✅🙏😊🤝👌]*$/i;
const RE_CONFIRMA_EXPLICITA = /\b(confirmo|confirmado|confirmada|confirmando|estarei presente|estarei sim|estarei l[áa]|vou estar|pode contar comigo|pode deixar que eu estarei)\b/i;
/** Emoji sozinho também é resposta — e "👍" pra "responde SIM" é sim. */
const RE_SO_EMOJI_POSITIVO = /^[\s👍✅🙏😊🤝👌❤️😀]+$/;

/** Confirmou de verdade? Pedido de remarcar sempre ganha: "ok, mas preciso
 *  remarcar" é o contrário de presença, por mais que comece com "ok". */
export function confirmouMesmo(textos: string[]): boolean {
  const limpos = textos.map(t => t.trim()).filter(Boolean);
  if (!limpos.length) return false;
  if (limpos.some(t => RE_REMARCAR.test(t))) return false;
  return limpos.some(t =>
    RE_AFIRMATIVA_INTEIRA.test(t) || RE_SO_EMOJI_POSITIVO.test(t) || RE_CONFIRMA_EXPLICITA.test(t));
}

export function pediuRemarcar(textos: string[]): boolean {
  return textos.some(t => RE_REMARCAR.test(t));
}

/** O selo é uma LEITURA pro humano — o texto da pessoa vai inteiro logo abaixo.
 *  O que ele NÃO faz é inventar presença: só sobe pra ✅ quem confirmou mesmo.
 *
 *  `jaResolvido` é o robô de remarcação avisando que já trocou o horário: sem
 *  isso o recado abre com um alerta sobre um problema que ele mesmo fechou. */
export function selo(textos: string[], jaResolvido = false): { icone: string; titulo: string } {
  if (jaResolvido) return { icone: '🔄', titulo: 'REMARCADO PELO ROBÔ' };
  if (pediuRemarcar(textos)) return { icone: '⚠️', titulo: 'PODE QUERER REMARCAR' };
  if (confirmouMesmo(textos)) return { icone: '✅', titulo: 'CONFIRMOU PRESENÇA' };
  return { icone: '💬', titulo: 'RESPONDEU' };
}

interface Msg { texto: string; tipo: string; momment: string }

/** O aviso que cai no WhatsApp do Thiago e do Diego. */
export function montarAviso(
  ficha: { cliente_nome: string | null; cliente_telefone: string | null; quando: string | null; vendedor_nome: string | null },
  msgs: Msg[],
  jaResolvido = false,
): string {
  const textos = msgs.map(m => m.texto).filter(Boolean);
  const s = selo(textos, jaResolvido);
  const tel = String(ficha.cliente_telefone || '').replace(/\D/g, '');

  // Mídia conta separado: áudio sobre o ponto é o recado mais rico que chega, e
  // quem só lê texto passa direto por ele.
  const midias = new Map<string, number>();
  for (const m of msgs) {
    if (m.tipo && m.tipo !== 'texto') midias.set(m.tipo, (midias.get(m.tipo) ?? 0) + 1);
  }
  // Plural escrito à mão: "imagem"+s vira "imagems". Recado interno pode ser
  // seco, não pode ser mal escrito — é o cartão de visita do robô com o dono.
  const rotuloMidia: Record<string, [string, string]> = {
    imagem: ['imagem', 'imagens'],
    audio: ['áudio', 'áudios'],
    video: ['vídeo', 'vídeos'],
    documento: ['documento', 'documentos'],
    localizacao: ['localização', 'localizações'],
  };
  const linhaMidia = [...midias.entries()]
    .map(([tipo, n]) => `${n} ${(rotuloMidia[tipo] ?? [tipo, tipo])[n > 1 ? 1 : 0]}`).join(' · ');

  return [
    `${s.icone} *${s.titulo}* — eletroposto`,
    '',
    `*${ficha.cliente_nome || 'Sem nome'}*`,
    ficha.quando ? `Reunião: *${quandoPorExtenso(ficha.quando)}*` : 'Sem horário na ficha',
    `Com: *${ficha.vendedor_nome || '—'}*`,
    `WhatsApp: wa.me/${tel}`,
    '',
    '_Escreveu:_',
    ...(textos.length ? textos.slice(0, 8).map(t => `• ${t.slice(0, 400)}`) : ['• (só mídia, sem texto)']),
    ...(linhaMidia ? ['', `📎 ${linhaMidia}`] : []),
    '',
    '_Respondeu à automação da agenda. Nessa linha ninguém responde por robô — a bola está com você._',
  ].join('\n');
}

interface Ficha {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  quando: string | null;
  vendedor_nome: string | null;
  created_by: string | null;
  status: string | null;
  confirmacao_at: string | null;
  lembrete_1h_at: string | null;
  lembrete_5min_at: string | null;
}

export type ResultadoRespostas = {
  avisados: number;
  /** Reuniões que o robô moveu sozinho nesta rodada (ver eletropostoRemarcar). */
  remarcadas: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; mensagens: number; aviso: string }>;
};

const zero = (motivo?: string): ResultadoRespostas =>
  ({ avisados: 0, remarcadas: 0, erros: 0, ...(motivo ? { motivo } : {}) });

export async function runEletropostoRespostasTick(opts: { dry?: boolean } = {}): Promise<ResultadoRespostas> {
  if (desligado()) return zero('desligado');

  const agora = Date.now();

  // 1) Fichas que a automação TOCOU. Sem toque não há resposta "à automação" —
  //    e conversa que o humano já estava tendo não é assunto deste agente.
  const { data: fichas, error: eFichas } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by, status, confirmacao_at, lembrete_1h_at, lembrete_5min_at')
    // `nao_atendeu` entra junto de propósito (14/08/2026). Desde que o robô da
    // agenda passou a marcar ausente sozinho 15 min depois do lembrete de 1h,
    // ficar só em `agendado` abriria o pior buraco possível: a pessoa escreve
    // "confirmo, estou indo" 20 minutos antes e NINGUÉM vê — nem o recado pro
    // Thiago sai, nem a presença sobe, nem o robô de remarcação roda.
    .in('status', ['agendado', 'nao_atendeu'])
    .gte('quando', new Date(agora - PASSADO_MAX_MS).toISOString())
    .or('confirmacao_at.not.is.null,lembrete_1h_at.not.is.null,lembrete_5min_at.not.is.null')
    .limit(300);
  if (eFichas) { logger.error('ep-respostas', 'ler fichas falhou', eFichas); return { ...zero('erro_fichas'), erros: 1 }; }
  if (!fichas?.length) return zero('ninguem_tocado');

  // Sem toque não entra, e o filtro é REFEITO aqui de propósito: se o `.or()` da
  // consulta mudar (ou o cliente devolver a mais), uma ficha sem toque cairia no
  // piso de 3 dias e viraria alerta em cima de conversa que o humano já tinha.
  const porChave = new Map<string, Ficha>();
  for (const f of fichas as Ficha[]) {
    // Produto por FAMÍLIA, não por lista fixa — tem que cobrir exatamente quem o
    // agente de agenda toca (eletropostoAgenda usa o mesmo teste). Se os dois
    // discordarem, o lead recebe a confirmação, responde "SIM" e ninguém é avisado.
    if (!ehOrigemEletroposto(f.created_by)) continue;
    if (!f.confirmacao_at && !f.lembrete_1h_at && !f.lembrete_5min_at) continue;
    const k = telKey(f.cliente_telefone);
    if (k) porChave.set(k, f);
  }
  if (porChave.size === 0) return zero('ninguem_tocado');

  // 2) Marcadores: até onde cada ficha já foi avisada.
  const { data: marcadores } = await supabase
    .from('system_state').select('key, value')
    .like('key', `${EP_RESPOSTA_PREFIX}%`)
    .limit(1000);
  const jaAvisadoAte = new Map<number, string>();
  for (const m of marcadores ?? []) {
    const id = Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length));
    const ate = ((m.value ?? {}) as { ate?: string }).ate;
    if (Number.isInteger(id) && ate) jaAvisadoAte.set(id, ate);
  }

  // Corte por ficha: o mais recente entre o 1º toque da automação e o último
  // aviso já dado. Mensagem anterior a isso não é resposta à automação.
  const pisoGlobal = new Date(agora - LOOKBACK_MAX_MS).toISOString();
  const corteDaFicha = new Map<number, string>();
  for (const f of porChave.values()) {
    const toques = [f.confirmacao_at, f.lembrete_1h_at, f.lembrete_5min_at].filter(Boolean) as string[];
    const primeiroToque = toques.sort()[0];
    const corte = [primeiroToque, jaAvisadoAte.get(f.id) ?? '', pisoGlobal].filter(Boolean).sort().pop()!;
    corteDaFicha.set(f.id, corte);
  }
  const menorCorte = [...corteDaFicha.values()].sort()[0] ?? pisoGlobal;

  // 3) Inbound da linha desde o menor corte. Uma consulta só; o recorte fino é
  //    por ficha, em JS.
  const teto = new Date(agora - ESPERA_MS).toISOString();
  const { data: msgs, error: eMsgs } = await supabase
    .from('wa_mensagens')
    .select('telefone, texto, tipo, momment')
    .eq('from_me', false)
    .eq('is_group', false)
    .eq('instancia', INSTANCE_ID_IO)
    .gte('momment', menorCorte)
    .lte('momment', teto)
    .order('momment', { ascending: true })
    .limit(1000);
  if (eMsgs) { logger.error('ep-respostas', 'ler wa_mensagens falhou', eMsgs); return { ...zero('erro_inbound'), erros: 1 }; }
  if (!msgs?.length) return zero('sem_inbound');

  const porFicha = new Map<number, Msg[]>();
  for (const m of msgs) {
    const k = telKey(m.telefone);
    if (!k) continue;
    const f = porChave.get(k);
    if (!f) continue;
    const momment = String(m.momment);
    if (momment <= (corteDaFicha.get(f.id) ?? pisoGlobal)) continue;
    const lista = porFicha.get(f.id) ?? [];
    lista.push({ texto: String(m.texto || '').trim(), tipo: String(m.tipo || 'texto'), momment });
    porFicha.set(f.id, lista);
  }
  if (porFicha.size === 0) return zero('ninguem_respondeu');

  // 4) Avisa.
  let avisados = 0, erros = 0, remarcadas = 0;
  const previa: NonNullable<ResultadoRespostas['previa']> = [];
  // WhatsApp do consultor, pra confirmação de remarcação lembrar de onde vem o link.
  const telPorConsultor = await carregarConsultores();

  for (const [id, lista] of porFicha) {
    if (avisados >= MAX_AVISOS_POR_TICK) break;
    const ficha = [...porChave.values()].find(f => f.id === id)!;

    if (opts.dry) {
      // `dry` também simula a remarcação: ele decide igual e não envia nem grava,
      // então o ?dry=1 mostra a conversa que o robô teria — que é o que se quer
      // conferir antes de deixar um robô mexer na agenda.
      const seco = await passoDeRemarcacao(
        ficha, lista.map(m => m.texto).filter(Boolean),
        telPorConsultor.get(String(ficha.vendedor_nome || '')) ?? null, { dry: true },
      ).catch(() => ({ acao: 'nada' as const }));
      const aviso = montarAviso(
        seco.acao === 'remarcou' ? { ...ficha, quando: seco.para } : ficha,
        lista, seco.acao === 'remarcou');
      const extra = linhaDoAviso(seco);
      previa.push({
        id, cliente: String(ficha.cliente_nome || '—'), mensagens: lista.length,
        aviso: extra ? `${aviso}\n\n${extra}` : aviso,
      });
      avisados++;
      continue;
    }

    // Marca ANTES de enviar: falha de envio não pode virar aviso repetido a cada
    // 5 min pro mesmo recado. Perder um aviso é melhor que virar spam interno.
    const ate = lista.map(m => m.momment).sort().pop()!;
    const nowIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: `${EP_RESPOSTA_PREFIX}${id}`, value: { ate, avisado_em: nowIso }, updated_at: nowIso },
      { onConflict: 'key' },
    );

    // Presença na ficha: só sobe quem confirmou mesmo, e CAI quem depois pediu
    // pra remarcar. Sem essa segunda metade o painel guardaria pra sempre um
    // "confirmou" de quem já avisou que não vem.
    const textosDaVez = lista.map(m => m.texto).filter(Boolean);
    const marcarPresenca = confirmouMesmo(textosDaVez);
    const desmarcarPresenca = pediuRemarcar(textosDaVez);
    if (marcarPresenca || desmarcarPresenca) {
      await supabaseGerador.from('agendamentos')
        .update({ presenca_confirmada_at: marcarPresenca ? nowIso : null })
        .eq('id', id)
        .then(undefined, (e: unknown) => logger.error('ep-respostas', 'gravar presença falhou', { id, erro: String(e) }));
    }

    // A VOLTA DO NÃO ATENDIDO AUTOMÁTICO. O robô da agenda marca ausente por
    // silêncio; quem confirma depois disso desfaz a marca — a previsão dele
    // estava errada e quem tem a palavra final é a pessoa.
    //
    // Só desfaz o que o ROBÔ marcou (o carimbo `ep_nao_atendeu_auto:<id>` é a
    // prova). "Não atendeu" escrito por gente é registro de quem estava lá e
    // ficou esperando — nenhum robô apaga isso por causa de um "ok".
    if (marcarPresenca && ficha.status === 'nao_atendeu') {
      const { data: carimbo } = await supabase
        .from('system_state').select('key').eq('key', `${EP_NAO_ATENDEU_PREFIX}${id}`).maybeSingle();
      if (carimbo) {
        await supabaseGerador.from('agendamentos')
          .update({ status: 'agendado' }).eq('id', id).eq('status', 'nao_atendeu')
          .then(undefined, (e: unknown) => logger.error('ep-respostas', 'desfazer não atendido falhou', { id, erro: String(e) }));
        // O carimbo sai junto: ele existe pra dizer "esta marca é do robô", e a
        // marca deixou de existir. Deixá-lo travaria a remarcação de amanhã.
        await supabase.from('system_state').delete().eq('key', `${EP_NAO_ATENDEU_PREFIX}${id}`)
          .then(undefined, () => {});
        logger.info('ep-respostas', `ficha ${id} voltou pra agendado: confirmou depois do não atendido automático`);
      }
    }

    // Remarcação automática. Roda ANTES do aviso pra que o Thiago e o Diego já
    // recebam o recado com o desfecho ("remarcado pro dia X") em vez de um alerta
    // sobre um problema que o robô resolveu no mesmo minuto. Ele nunca cancela e
    // nunca troca de consultor — o pior caso é não fazer nada e o alerta sair
    // igual ao de antes. Falha aqui não pode engolir o aviso: por isso o try.
    let posRemarcacao: string | null = null;
    let novoQuando: string | null = null;
    try {
      const r = await passoDeRemarcacao(
        ficha, textosDaVez, telPorConsultor.get(String(ficha.vendedor_nome || '')) ?? null);
      posRemarcacao = linhaDoAviso(r);
      if (r.acao === 'remarcou') { remarcadas++; novoQuando = r.para; }
    } catch (e) {
      logger.error('ep-respostas', 'passo de remarcação falhou', { id, erro: String(e) });
    }
    // O aviso é montado DEPOIS do robô agir, por dois motivos: o selo é a
    // primeira linha que o Thiago lê (um "⚠️ PODE QUERER REMARCAR" no topo de um
    // recado que termina em "já remarquei" o faz abrir o CRM à toa), e o horário
    // do cabeçalho tem que ser o NOVO — a ficha em memória ainda tem o velho.
    const aviso = montarAviso(
      novoQuando ? { ...ficha, quando: novoQuando } : ficha, lista, !!novoQuando);
    const avisoFinal = posRemarcacao ? `${aviso}\n\n${posRemarcacao}` : aviso;

    try {
      const envios = await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, avisoFinal, 'io')));
      const ok = envios.filter(e => e.status === 'fulfilled').length;
      if (ok === 0) throw new Error('nenhum destinatário recebeu');
      avisados++;
      logger.info('ep-respostas', `resposta da ficha #${id} avisada a ${ok}/${envios.length}`);
    } catch (e) {
      logger.error('ep-respostas', 'falha ao avisar', { id, erro: String(e) });
      erros++;
    }
  }

  return { avisados, remarcadas, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
