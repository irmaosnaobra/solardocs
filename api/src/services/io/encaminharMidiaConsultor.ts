// ─────────────────────────────────────────────────────────────────────────────
// MÍDIA DO LEAD → WHATSAPP DO CONSULTOR DONO DELE.
//
// Até aqui, mídia que chegava nas linhas da empresa só existia pra máquina: áudio
// virava transcrição pra Luma, foto virava base64 pro vision, vídeo e documento
// viravam um "só analiso texto, áudio e imagem". O consultor humano nunca via a
// conta de luz fotografada, nem ouvia o áudio de quem estava comprando dele.
//
// Agora toda mídia é reenviada NA HORA pro WhatsApp de quem é dono do lead
// (`donoDoTelefone` = vendedor do agendamento ativo mais recente). TODO lead é
// coberto, tenha dono ou não: sem dono identificado a mídia vai pro destino
// padrão da linha (grupo interno na IO, Thiago na B2B) — mídia de lead não pode
// sumir em lugar nenhum.
//
// Vale nas DUAS linhas e o reenvio sai sempre pela MESMA linha em que a mídia
// chegou, pra o consultor responder no número certo.
//
// TETO ANTI-BAN: este envio NÃO entra em `BOT_SENT_PREFIXES` nem passa pela
// janela diurna de propósito. Aqueles dois protegem contato FRIO com lead; aqui
// é mensagem interna pra número conhecido, reagindo a algo que o cliente acabou
// de mandar — mesma isenção que os avisos de equipe já existentes (ioSolar,
// ioEletroposto, chamar_consultor). A proteção daqui é o teto por lead/hora
// abaixo, que é o que impede alguém despejar 40 fotos no celular do consultor.
//
// Kill-switch: MIDIA_FWD_OFF=1 (desliga sem deploy).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { zapiPost, fmtPhone, ZapiInstance } from '../agents/zapiClient';
import { donoDoTelefone } from '../agenda/leadsMetaService';
import { downloadImageAsAnthropicSource } from '../../utils/mediaProcessor';

export type TipoMidia = 'audio' | 'image' | 'video' | 'document';

export interface MidiaLead {
  url: string;
  type: TipoMidia;
  mime: string;
  /** Legenda que o lead digitou junto da foto/vídeo/documento (Z-API põe em body.<tipo>.caption). */
  caption?: string | null;
  /** Nome original do arquivo — é dele que sai a extensão do send-document. */
  fileName?: string | null;
}

// Mesmos números do `chamar_consultor` da Luma (sdrAgentService) e do EQUIPE de
// ioSolar. Aqui é um mapa próprio porque nenhum dos dois cobre os 4 nomes: o de
// ioEletroposto não tem Nilce, o da Luma vive dentro do loop de tools.
const EQUIPE_IO: Record<string, string> = {
  thiago: '34991360223',
  diego: '34991360172',
  nilce: '34991516846',
  giovanna: '34993396255',
};

const MAX_POR_LEAD_HORA = () => Number(process.env.MIDIA_FWD_MAX_HORA || 12);

const soDigitos = (s: string): string => (s || '').replace(/\D/g, '');

/**
 * Nem tudo que chega com mídia é lead falando com a gente. Em 14 dias a fila
 * teve 40 STORIES (`status@broadcast`) contra 54 mídias de lead — encaminhar
 * story faria o consultor receber o dia inteiro dos contatos dele e desligar a
 * coisa no primeiro dia. Fora: grupo, newsletter e a própria equipe.
 */
function ehRemetenteValido(phoneRaw: string): boolean {
  const bruto = String(phoneRaw || '').toLowerCase();
  if (!bruto) return false;
  if (bruto.includes('status@broadcast') || bruto.includes('broadcast')) return false;
  if (bruto.includes('-group') || bruto.includes('@g.us') || bruto.includes('newsletter')) return false;
  const chave = telkey(bruto);
  if (!chave || chave.length < 10) return false;
  // Mídia mandada por quem é da casa não vira recado pra ele mesmo.
  return !Object.values(EQUIPE_IO).some(n => telkey(n) === chave);
}

/** Chave estável do lead: DDD + últimos 8 (tolera o 9º dígito e o 55), igual ao CRM. */
function telkey(raw: string): string {
  const dd = soDigitos(raw).replace(/^55/, '');
  return dd.length < 10 ? dd : dd.slice(0, 2) + dd.slice(-8);
}

/** "Thiago Silva" / "THIAGO" / "Thiágo" → "thiago". Free text no banco, não é chave. */
function primeiroNomeNormalizado(raw: string): string {
  return (raw || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().split(/\s+/)[0] || '';
}

function grupoInterno(): string {
  return process.env.ZAPI_IO_GROUP_ID?.trim() || '120363424419098566-group';
}

interface Destino {
  /** Alvo pronto pro Z-API: telefone com DDI, ou o ID do grupo cru. */
  alvo: string;
  rotulo: string;
  ehGrupo: boolean;
}

/**
 * Rede pra quem não tem dono — ninguém fica de fora.
 * • Linha IO (leads de solar/eletroposto): grupo interno, onde a equipe já olha.
 * • Linha B2B (cliente da plataforma): Thiago, que é quem atende o SolarDoc —
 *   o mesmo destino que o comprovante de Pix já usa. Mandar cliente de SaaS pro
 *   grupo dos consultores de energia só viraria ruído no lugar errado.
 */
function destinoPadrao(linha: ZapiInstance): Destino {
  if (linha === 'solardoc') {
    const numero = process.env.MIDIA_FWD_DEST_SOLARDOC?.trim() || EQUIPE_IO.thiago!;
    return { alvo: fmtPhone(numero), rotulo: 'thiago (B2B)', ehGrupo: false };
  }
  return { alvo: grupoInterno(), rotulo: 'grupo interno', ehGrupo: true };
}

/**
 * Pra quem vai. Dono conhecido e mapeado → DM dele. Qualquer outro caso (lead
 * sem agendamento, vendedor com nome fora do mapa, erro de leitura) → destino
 * padrão da linha.
 */
async function destinoDoLead(phone: string, linha: ZapiInstance): Promise<Destino> {
  let dono: string | null = null;
  try {
    dono = await donoDoTelefone(phone);
  } catch (err) {
    logger.error('midia-fwd', 'donoDoTelefone falhou', err);
  }
  const chave = primeiroNomeNormalizado(dono || '');
  const numero = chave ? EQUIPE_IO[chave] : undefined;
  if (numero) {
    return { alvo: fmtPhone(numero), rotulo: dono || chave, ehGrupo: false };
  }
  return destinoPadrao(linha);
}

/**
 * Nome de quem mandou. Na linha IO o cadastro é o CRM de energia (`sdr_leads`);
 * na B2B é o cliente da plataforma (`users.whatsapp`) — procurar um no lugar do
 * outro daria "sem nome" em 100% dos casos daquela linha.
 * Telefone é texto livre nas duas tabelas e convivem as formas com e sem o 55,
 * então casa pela cauda de 8 e confere o DDD — mesma régua do `donoDoTelefone`.
 */
async function nomeDoLead(telLimpo: string, linha: ZapiInstance, fallback?: string | null): Promise<string> {
  const alvo = telkey(telLimpo);
  const tabela = linha === 'solardoc'
    ? { nome: 'users', coluna: 'whatsapp' }
    : { nome: 'sdr_leads', coluna: 'phone' };
  try {
    const { data } = await supabase
      .from(tabela.nome).select(`nome, ${tabela.coluna}`)
      .ilike(tabela.coluna, `%${alvo.slice(-8)}`).limit(5);
    for (const l of (data ?? []) as Array<Record<string, any>>) {
      if (l.nome && telkey(String(l[tabela.coluna] || '')) === alvo) return String(l.nome);
    }
  } catch { /* fail-open: o nome é enfeite, o link do WhatsApp é o que importa */ }
  return (fallback || '').trim() || 'sem nome no cadastro';
}

// ── Teto por lead: 12 mídias/hora ────────────────────────────────────────────
// Cada encaminhamento carimba `midia_fwd:<telkey>:<messageId>` em system_state.
// Estourou? Para de reenviar e manda UM aviso por hora, pra o consultor saber
// que tem mais coisa esperando na conversa em vez de achar que acabou.
/** Essa mensagem já foi encaminhada? A fila devolve a mensagem em caso de erro
 *  (`processed: false`) e o Z-API redispara webhook — sem isto, o consultor
 *  recebe a mesma foto duas e três vezes. */
async function jaEncaminhada(key: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('key').eq('key', key).limit(1);
  return (data?.length ?? 0) > 0;
}

async function contarNaHora(prefixo: string): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('system_state').select('key')
    .like('key', `${prefixo}%`)
    .gte('updated_at', desde)
    .limit(MAX_POR_LEAD_HORA() + 1);
  return data?.length ?? 0;
}

async function marcar(key: string): Promise<void> {
  // `system_state.value` é jsonb — grava objeto, igual ao resto do repo.
  await supabase.from('system_state').upsert(
    { key, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

const TIPO_LABEL: Record<TipoMidia, string> = {
  audio: 'ÁUDIO', image: 'FOTO', video: 'VÍDEO', document: 'DOCUMENTO',
};

/** Extensão pro `send-document/{ext}` — sai do nome do arquivo, com o mime de reserva. */
function extensaoDoc(m: MidiaLead): string {
  const doNome = (m.fileName || '').split('.').pop() || '';
  if (/^[a-z0-9]{2,5}$/i.test(doNome)) return doNome.toLowerCase();
  const doMime = (m.mime || '').split('/').pop()?.split(';')[0] || '';
  return /^[a-z0-9]{2,5}$/i.test(doMime) ? doMime.toLowerCase() : 'pdf';
}

/**
 * Manda a mídia em si. Foto vai como base64 (caminho já provado no comprovante
 * de Pix); áudio/vídeo/documento vão pela URL da Z-API. Devolve false quando
 * não conseguiu — aí o chamador manda o link em texto, que é a rede pra nada
 * se perder caso a Z-API não aceite a própria URL de recebimento no envio.
 */
async function enviarMidia(alvo: string, m: MidiaLead, legenda: string, linha: ZapiInstance): Promise<boolean> {
  try {
    if (m.type === 'image') {
      const img = await downloadImageAsAnthropicSource(m.url, m.mime);
      if (!img) return false;
      await zapiPost('send-image', {
        phone: alvo, image: `data:${img.media_type};base64,${img.data}`, caption: legenda,
      }, 2, linha);
      return true;
    }
    if (m.type === 'audio') {
      // send-audio não aceita caption — por isso o cartão de identificação vai
      // sempre ANTES, em texto separado.
      await zapiPost('send-audio', { phone: alvo, audio: m.url, waveform: true }, 2, linha);
      return true;
    }
    if (m.type === 'video') {
      await zapiPost('send-video', { phone: alvo, video: m.url, caption: legenda }, 2, linha);
      return true;
    }
    await zapiPost(`send-document/${extensaoDoc(m)}`, {
      phone: alvo, document: m.url, fileName: m.fileName || `documento.${extensaoDoc(m)}`, caption: legenda,
    }, 2, linha);
    return true;
  } catch (err) {
    logger.error('midia-fwd', `envio de ${m.type} falhou`, err);
    return false;
  }
}

/**
 * Encaminha uma mídia recebida do lead pro consultor dono (ou pro grupo).
 * Nunca lança: é chamado em fire-and-forget no meio do webhook e não pode
 * derrubar o atendimento da Luma.
 */
export async function encaminharMidiaAoConsultor(p: {
  phone: string;
  nome?: string | null;
  media: MidiaLead;
  messageId?: string | null;
  /** Linha em que a mídia chegou — é por ela que o reenvio sai. Default: IO. */
  linha?: ZapiInstance;
}): Promise<void> {
  try {
    if (process.env.MIDIA_FWD_OFF === '1') return;

    const linha: ZapiInstance = p.linha || 'io';
    // Story, grupo, newsletter e gente da casa não são lead mandando recado.
    if (!ehRemetenteValido(p.phone)) return;
    const tel = soDigitos(p.phone);
    const chave = `${linha}:${telkey(tel)}`;

    // Mesma mensagem duas vezes (retry da fila, redelivery do Z-API) → sai uma só.
    const marcaMsg = p.messageId ? `midia_fwd:${chave}:${p.messageId}` : null;
    if (marcaMsg && await jaEncaminhada(marcaMsg)) return;

    // Teto por lead. Estourado → um aviso por hora e para por aqui.
    if (await contarNaHora(`midia_fwd:${chave}:`) >= MAX_POR_LEAD_HORA()) {
      if (await contarNaHora(`midia_fwd_cap:${chave}`) === 0) {
        const destinoCap = await destinoDoLead(p.phone, linha);
        const nomeCap = await nomeDoLead(tel, linha, p.nome);
        await zapiPost('send-text', {
          phone: destinoCap.alvo,
          message: `*${nomeCap}* mandou mais mídias (acima de ${MAX_POR_LEAD_HORA()} na última hora). Parei de encaminhar pra não lotar seu WhatsApp — abra a conversa: https://wa.me/${fmtPhone(tel)}`,
        }, 2, linha).catch(() => {});
        await marcar(`midia_fwd_cap:${chave}`).catch(() => {});
      }
      return;
    }

    const destino = await destinoDoLead(p.phone, linha);
    const nome = await nomeDoLead(tel, linha, p.nome);
    const legendaLead = (p.media.caption || '').trim();

    const cartao = [
      `*${TIPO_LABEL[p.media.type]} DO LEAD*`,
      '',
      `*Nome:* ${nome}`,
      `*WhatsApp:* https://wa.me/${fmtPhone(tel)}`,
      ...(legendaLead ? ['', `*Ele escreveu:* ${legendaLead}`] : []),
    ].join('\n');

    await zapiPost('send-text', { phone: destino.alvo, message: cartao }, 2, linha);
    await marcar(marcaMsg || `midia_fwd:${chave}:${Date.now()}`).catch(() => {});

    const ok = await enviarMidia(destino.alvo, p.media, legendaLead, linha);
    if (!ok) {
      // Nada se perde: vai o link direto do arquivo pra ele abrir no navegador.
      await zapiPost('send-text', {
        phone: destino.alvo,
        message: `Não consegui reenviar o arquivo aqui. Link direto (expira em algumas horas):\n${p.media.url}`,
      }, 2, linha).catch(() => {});
    }

    logger.info('midia-fwd', `[${linha}] ${p.media.type} de ${tel} → ${destino.rotulo}${ok ? '' : ' (só link)'}`);
  } catch (err) {
    logger.error('midia-fwd', 'encaminhamento falhou', err);
  }
}
