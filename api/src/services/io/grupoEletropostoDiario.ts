import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendToGroup, zapiPost, sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import { logger } from '../../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Publicação diária no grupo do Eletroposto (novidade de mercado + vídeo nosso).
//
// O grupo é o destino de todo lead NOTA 1 — quem ainda não tem local. Grupo que
// não publica esvazia e vira lista morta, e aí o convite que a gente manda deixa
// de valer alguma coisa. Este serviço tira UM item da fila `io_grupo_pauta` por
// dia e publica, na ordem.
//
// A fila é abastecida por gente, não por robô: notícia de mercado inventada por
// IA num grupo de investidor destrói a confiança que o grupo existe pra criar.
// Fila vazia NÃO é silêncio — a equipe é avisada, senão o grupo morre sem que
// ninguém perceba.
//
// [PAUTA-GRUPO-OFF 08/08/2026] DESLIGADO por ordem do Thiago: nem publicação no
// grupo, nem o aviso de fila vazia pra equipe (era ele e todo mundo, 1×/dia).
// O no-op fica AQUI e não só no cron porque o aviso era o incômodo — chamada
// manual não pode ressuscitar o disparo. A fila `io_grupo_pauta` continua no
// banco intacta (nada é consumido), então religar é só tirar este return e
// descomentar a task no cron. Não religar sem ele pedir.
// ─────────────────────────────────────────────────────────────────────────────

const DESLIGADO = true;   // [PAUTA-GRUPO-OFF 08/08/2026]

const GRUPO_ID = process.env.IO_GRUPO_ELETROPOSTO_ID?.trim() || '120363410228854732-group';

interface ItemPauta {
  id: number;
  tipo: string | null;
  texto: string;
  midia_url: string | null;
  midia_tipo: string | null;
}

export async function runGrupoEletropostoDiario(): Promise<{ publicado: number; fila: number }> {
  if (DESLIGADO) return { publicado: 0, fila: 0 };

  const { data: pendentes, error } = await supabaseGerador
    .from('io_grupo_pauta')
    .select('id, tipo, texto, midia_url, midia_tipo')
    .is('enviado_at', null)
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2);                                  // 2: publica o 1º e sabe se sobra fila

  if (error) {
    logger.error('grupo-eletroposto', 'falha lendo a pauta', error);
    return { publicado: 0, fila: 0 };
  }

  const item = (pendentes || [])[0] as ItemPauta | undefined;
  if (!item) {
    // Fila seca: avisa a equipe UMA vez por dia (o cron roda 1×/dia).
    const aviso = [
      '📭 *Grupo do Eletroposto sem pauta pra hoje*',
      '',
      'A fila de publicação está vazia, então hoje o grupo não recebe nada.',
      'Manda a novidade de mercado ou o vídeo do trabalho que eu coloco na fila.',
    ].join('\n');
    await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, aviso, 'io')))
      .catch(() => {});
    logger.info('grupo-eletroposto', 'pauta vazia — equipe avisada');
    return { publicado: 0, fila: 0 };
  }

  try {
    if (item.midia_url && item.midia_tipo === 'video') {
      await zapiPost('send-video', { phone: GRUPO_ID, video: item.midia_url, caption: item.texto }, 2, 'io');
    } else if (item.midia_url) {
      await zapiPost('send-image', { phone: GRUPO_ID, image: item.midia_url, caption: item.texto }, 2, 'io');
    } else {
      await sendToGroup(GRUPO_ID, item.texto, 'io');
    }

    await supabaseGerador.from('io_grupo_pauta')
      .update({ enviado_at: new Date().toISOString(), erro: null })
      .eq('id', item.id);

    logger.info('grupo-eletroposto', `publicado item #${item.id} (${item.tipo || 'sem tipo'})`);
    return { publicado: 1, fila: Math.max((pendentes?.length || 1) - 1, 0) };
  } catch (err) {
    // Erro NÃO consome o item: ele volta na fila do dia seguinte, mas fica com o
    // motivo gravado — item que falha calado sumiria da pauta sem nunca publicar.
    await supabaseGerador.from('io_grupo_pauta')
      .update({ erro: String(err).slice(0, 400) })
      .eq('id', item.id)
      .then(undefined, () => {});
    logger.error('grupo-eletroposto', `falha publicando item #${item.id}`, err);
    return { publicado: 0, fila: pendentes?.length || 0 };
  }
}
