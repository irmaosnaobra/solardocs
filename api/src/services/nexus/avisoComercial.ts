// Aviso ao comercial do Portal do Parceiro NEXUS. No molde de avisarVendaAoDono (services/vendaAviso.ts), com o aval
// do chefe-antiban de 20/10/2026. NÃO reaproveita o avisarEquipe do ioEletroposto.
//
//   Liga só com NEXUS_AVISO_LIGADO=1 (nasce desligado). Destino: NEXUS_AVISO_PHONE (número da equipe, nunca no repo).
//   Sem uma das duas envs não envia WhatsApp, não toma trava e não manda e-mail, EXCETO o (c) pedido, que sai
//   sempre por e-mail (sem trava).
//   Ordem: trava por insert com chave única em system_state (prefixo `nexus_aviso:`, que NÃO é prefixo de
//   BOT_SENT_PREFIXES do lineThrottle) e só depois `await sendWhatsApp(num, texto, 'io')`, 1 bolha pela linha 5040.
//   Se o WhatsApp falhar, sendOpsAlert com o mesmo texto.
//
//   (a) cadastro     nexus_aviso:cadastro:<parceiro_id>                          uma por parceiro
//   (b) solicitação  nexus_aviso:solicitacao:<parceiro_id>:<tipo>:<AAAA-MM-DD>   uma por tipo a cada dia de Brasília
//                    (tipo = conversa, engenharia, negociar_preco ou plataforma). A engenharia que usa o pacote (desconta
//                    saldo) também sai SEMPRE por e-mail; o WhatsApp segue a trava por parceiro, tipo e dia.
//   (c) pedido       equipamento: nexus_aviso:pedido:<pedido_id>                 um por pedido
//                    engenharia, consultoria (Apoio de venda na tela) e manutencao (Plano de manutenção, v5):
//                    nexus_aviso:pedido_<tipo>:<parceiro_id>:<AAAA-MM-DD>
//                    um WhatsApp por parceiro, tipo e dia de Brasília (aval do chefe-antiban, 21/10; a manutenção usa
//                    a MESMA trava, só com o tipo novo na chave).
//                    O e-mail de QUALQUER pedido sai SEMPRE, inclusive quando a trava devolve 23505 (duplicado).
//   (d) usina        nexus_aviso:usina:<usina_id>                                uma por usina indicada
//   (e) oportunidade nexus_aviso:oportunidade:<oportunidade_id>:<status>         uma por resposta do parceiro
//   (f) termo        nexus_aviso:termo:<parceiro_id>:<versao>                    um por parceiro e versão do Termo aceito
//
//   Teto: no máximo 12 avisos de WhatsApp por hora (conta as chaves `nexus_aviso:` da última hora). Acima disso o
//   (a), o (d) e o (f) saem só por e-mail; (b), (c) e (e) são urgentes e saem sempre pelo WhatsApp.
//   Gerar proposta NÃO avisa.
//   Webhook opcional: se N8N_ELETROPOSTO_WEBHOOK_URL existir, um POST JSON com timeout de 5 s. Sem a env, nada.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { sendOpsAlert } from '../../utils/mailer';
import { diaBRT } from './tempo';

export type TipoAviso = 'cadastro' | 'solicitacao' | 'pedido' | 'usina' | 'oportunidade' | 'termo';
export type ResultadoAviso = 'enviado' | 'email' | 'duplicado' | 'desligado';

export const PREFIXO_CHAVE = 'nexus_aviso:';
export const TETO_WHATSAPP_POR_HORA = 12;
const TIMEOUT_WEBHOOK_MS = 5000;

export interface DadosAviso {
  parceiro: {
    id: string;
    empresa?: string | null;
    cnpj?: string | null;
    cidade?: string | null;
    uf?: string | null;
    origem?: string | null;
    papel_revenda?: boolean;
    papel_montagem?: boolean;
  };
  whatsapp?: string | null;
  /** (b) tipo = conversa | engenharia | negociar_preco | plataforma; resumo = serviço e local, só para engenharia. */
  solicitacao?: { tipo: string; resumo?: string | null; usa_pacote?: boolean };
  /** (c) o pedido; numero e valor_total vêm da proposta ligada, quando há. `tipo` ausente = equipamento. */
  pedido?: {
    id: string; tipo?: 'equipamento' | 'engenharia' | 'consultoria' | 'manutencao'; pacote?: number | null;
    modelo?: string | null; quantidade?: number | null; numero?: string | null; valor_total?: number | null;
  };
  /** (f) a versão do Termo de Parceria aceito. */
  termo?: { versao: string };
  /** (d) a usina indicada. */
  usina?: { id: string; dono_nome?: string | null; cidade?: string | null; uf?: string | null; potencia_kwp?: number | null; interesse?: string | null };
  /** (e) a oportunidade e o status novo (aceita, recusada, contato, visita, orcamento, fechou, perdeu). */
  oportunidade?: { id: string; cidade?: string | null; uf?: string | null; status: string };
  obs?: string | null;
}

/** Texto de gente (nome da empresa, observação) entra em mensagem e e-mail: sem quebra de linha, sem formatação do WhatsApp. */
function limpo(v: unknown, max = 80): string {
  return String(v ?? '').replace(/[*_~`<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inteiro positivo para texto de aviso: nada de dado de parceiro entra sem passar por aqui. */
function inteiro(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const projetos = (n: number): string => `${n} ${n === 1 ? 'projeto' : 'projetos'}`;
const carregadores = (n: number): string => `${n} ${n === 1 ? 'carregador' : 'carregadores'}`;

function brl(v: unknown): string {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function papeis(p: DadosAviso['parceiro']): string {
  if (p.papel_revenda && p.papel_montagem) return 'Revenda e Montagem e Engenharia';
  if (p.papel_revenda) return 'Revenda';
  if (p.papel_montagem) return 'Montagem e Engenharia';
  return 'Ainda não escolhidos';
}

export function chaveDoAviso(tipo: TipoAviso, d: DadosAviso, quando: Date = new Date()): string {
  if (tipo === 'cadastro') return `${PREFIXO_CHAVE}cadastro:${d.parceiro.id}`;
  if (tipo === 'solicitacao') return `${PREFIXO_CHAVE}solicitacao:${d.parceiro.id}:${d.solicitacao?.tipo ?? 'conversa'}:${diaBRT(quando)}`;
  if (tipo === 'pedido') {
    const t = d.pedido?.tipo;
    // Engenharia, consultoria e manutenção: um WhatsApp por parceiro, tipo e dia (não por pedido). Equipamento: um por pedido.
    if (t === 'engenharia' || t === 'consultoria' || t === 'manutencao') return `${PREFIXO_CHAVE}pedido_${t}:${d.parceiro.id}:${diaBRT(quando)}`;
    return `${PREFIXO_CHAVE}pedido:${d.pedido?.id ?? d.parceiro.id}`;
  }
  if (tipo === 'usina') return `${PREFIXO_CHAVE}usina:${d.usina?.id ?? d.parceiro.id}`;
  if (tipo === 'termo') return `${PREFIXO_CHAVE}termo:${d.parceiro.id}:${d.termo?.versao ?? 'v1'}`;
  return `${PREFIXO_CHAVE}oportunidade:${d.oportunidade?.id ?? d.parceiro.id}:${d.oportunidade?.status ?? 'x'}`;
}

const ETAPA_TEXTO: Record<string, string> = {
  aceita: 'aceitou a oportunidade',
  recusada: 'recusou a oportunidade',
  contato: 'marcou a etapa Contato feito na oportunidade',
  visita: 'marcou a etapa Visita agendada na oportunidade',
  orcamento: 'marcou a etapa Orçamento enviado na oportunidade',
  fechou: 'fechou a oportunidade',
  perdeu: 'perdeu a oportunidade',
};

const INTERESSE_TEXTO: Record<string, string> = { vender_creditos: 'vender créditos', alugar: 'alugar', outro: 'outro' };

function onde(cidade: unknown, uf: unknown): string {
  const c = limpo(cidade);
  const u = limpo(uf, 2);
  return c ? `${c}${u ? '/' + u : ''}` : u;
}

export function textoDoAviso(tipo: TipoAviso, d: DadosAviso): string {
  const empresa = limpo(d.parceiro.empresa) || 'Empresa sem nome';
  const wpp = String(d.whatsapp ?? '').replace(/\D/g, '');
  const contato = `WhatsApp: ${wpp || 'não informado'}.`;
  const obs = limpo(d.obs, 200);
  const recado = obs ? ` Recado: ${obs}.` : '';
  if (tipo === 'cadastro') {
    const lugar = onde(d.parceiro.cidade, d.parceiro.uf);
    return (
      `Parceiro NEXUS novo: ${empresa}${lugar ? ` (${lugar})` : ''}. Papéis: ${papeis(d.parceiro)}. ` +
      `Origem: ${String(d.parceiro.origem ?? '').replace(/[^a-z_]/g, '').slice(0, 30) || 'portal'}. Painel: solardoc.app/gerador/parceiros`
    );
  }
  if (tipo === 'solicitacao') {
    const t = d.solicitacao?.tipo;
    if (t === 'engenharia') {
      const resumo = limpo(d.solicitacao?.resumo, 120);
      const pacote = d.solicitacao?.usa_pacote ? ' (usa 1 projeto do pacote)' : '';
      return `${empresa} pediu serviço de engenharia${resumo ? `: ${resumo}` : ''}${pacote}. ${contato}${recado}`;
    }
    if (t === 'plataforma') return `${empresa} quer revender a Plataforma NEXUS de gestão. ${contato}${recado}`;
    if (t === 'negociar_preco') return `${empresa} quer negociar o preço do equipamento com o comercial. ${contato}${recado}`;
    return `${empresa} pediu conversa com o comercial. ${contato}${recado}`;
  }
  if (tipo === 'termo') return `${empresa} aceitou o Termo de Parceria NEXUS (${limpo(d.termo?.versao, 10) || 'v1'}). ${contato}`;
  if (tipo === 'pedido' && d.pedido?.tipo === 'engenharia') {
    const n = inteiro(d.pedido.pacote);
    return `${empresa} fez pedido de ${n === 1 ? 'engenharia' : 'pacote de engenharia'} (${projetos(n)}). ${contato}${recado}`;
  }
  if (tipo === 'pedido' && d.pedido?.tipo === 'consultoria') {
    return `${empresa} fez pedido de apoio de venda NEXUS. ${contato}${recado}`;
  }
  if (tipo === 'pedido' && d.pedido?.tipo === 'manutencao') {
    return `${empresa} fez pedido de plano de manutenção NEXUS (${carregadores(inteiro(d.pedido.quantidade))}). ${contato}${recado}`;
  }
  if (tipo === 'pedido') {
    const p = d.pedido;
    const prop = limpo(p?.numero, 20) ? `, proposta ${limpo(p?.numero, 20)}` : '';
    const valor = p?.valor_total != null ? `, R$ ${brl(p.valor_total)}` : '';
    return `${empresa} pediu equipamento: ${Number(p?.quantidade) || 0}x ${limpo(p?.modelo) || 'modelo não informado'}${prop}${valor}.${recado}`;
  }
  if (tipo === 'usina') {
    const u = d.usina;
    const kwp = Number(u?.potencia_kwp);
    const lugar = onde(u?.cidade, u?.uf);
    return (
      `${empresa} indicou uma usina: ${limpo(u?.dono_nome) || 'dono não informado'}` +
      `${lugar ? ` em ${lugar}` : ''}` +
      `${Number.isFinite(kwp) && kwp > 0 ? `, ${brl(kwp)} kWp` : ''}` +
      `${INTERESSE_TEXTO[String(u?.interesse)] ? `, interesse: ${INTERESSE_TEXTO[String(u?.interesse)]}` : ''}. ${contato}`
    );
  }
  const o = d.oportunidade;
  const acao = ETAPA_TEXTO[o?.status ?? ''] ?? `atualizou a oportunidade para ${limpo(o?.status, 20)}`;
  const lugar = onde(o?.cidade, o?.uf);
  return `${empresa} ${acao}${lugar ? ` em ${lugar}` : ''}.${recado}`;
}

const ASSUNTO: Record<TipoAviso, string> = {
  cadastro: 'Portal NEXUS: parceiro novo',
  solicitacao: 'Portal NEXUS: solicitação de parceiro',
  pedido: 'Portal NEXUS: pedido de equipamento',
  usina: 'Portal NEXUS: usina indicada',
  oportunidade: 'Portal NEXUS: resposta a oportunidade',
  termo: 'Portal NEXUS: Termo de Parceria aceito',
};

/** Os que, acima do teto de 12 por hora, saem só por e-mail. O resto é urgente e sai sempre pelo WhatsApp. */
const SO_EMAIL_ACIMA_DO_TETO: ReadonlySet<TipoAviso> = new Set<TipoAviso>(['cadastro', 'usina', 'termo']);

/** Assunto por tipo. Entra cru no <h2> do sendOpsAlert: só texto fixo nosso (e o número do pacote, validado), nunca dado de parceiro. */
export function assuntoDoAviso(tipo: TipoAviso, d: DadosAviso): string {
  if (tipo === 'pedido') {
    if (d.pedido?.tipo === 'engenharia') {
      const n = inteiro(d.pedido.pacote);
      return `Portal NEXUS: pedido de ${n === 1 ? 'engenharia' : 'pacote de engenharia'} (${projetos(n)})`;
    }
    if (d.pedido?.tipo === 'consultoria') return 'Portal NEXUS: pedido de apoio de venda';
    if (d.pedido?.tipo === 'manutencao') return `Portal NEXUS: pedido de plano de manutenção (${carregadores(inteiro(d.pedido.quantidade))})`;
    return 'Portal NEXUS: pedido de equipamento';
  }
  if (tipo === 'solicitacao' && d.solicitacao?.tipo === 'engenharia' && d.solicitacao.usa_pacote) {
    return 'Portal NEXUS: solicitação de engenharia (usa 1 projeto do pacote)';
  }
  return ASSUNTO[tipo];
}

/** Avisos cujo e-mail sai SEMPRE, com ou sem WhatsApp, trava ou teto: todo pedido, e a engenharia que desconta saldo do pacote. */
export function emailSempre(tipo: TipoAviso, d: DadosAviso): boolean {
  return tipo === 'pedido' || (tipo === 'solicitacao' && d.solicitacao?.tipo === 'engenharia' && d.solicitacao.usa_pacote === true);
}

async function emailDoAviso(tipo: TipoAviso, d: DadosAviso, texto: string, motivo: string): Promise<void> {
  await sendOpsAlert(
    assuntoDoAviso(tipo, d),
    `<p>${escaparHtml(texto)}</p><p style="color:#64748b;font-size:13px;">${escaparHtml(motivo)}</p>`,
  ).catch((e) => logger.error('nexus-aviso', 'e-mail do aviso também falhou', e));
}

async function chamarWebhook(tipo: TipoAviso, d: DadosAviso): Promise<void> {
  const url = String(process.env.N8N_ELETROPOSTO_WEBHOOK_URL ?? '').trim();
  if (!url) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_WEBHOOK_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evento: `nexus_${tipo === 'solicitacao' ? (d.solicitacao?.tipo ?? tipo) : tipo === 'pedido' && d.pedido?.tipo && d.pedido.tipo !== 'equipamento' ? `pedido_${d.pedido.tipo}` : tipo}`,
        empresa: d.parceiro.empresa ?? null,
        cnpj: d.parceiro.cnpj ?? null,
        cidade: d.parceiro.cidade ?? null,
        uf: d.parceiro.uf ?? null,
        contato: d.whatsapp ?? null,
        modelo: d.pedido?.modelo ?? null,
        quantidade: d.pedido?.quantidade ?? null,
        valor_total: d.pedido?.valor_total ?? null,
        numero: d.pedido?.numero ?? null,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    logger.warn('nexus-aviso', 'webhook do n8n não respondeu', e);
  } finally {
    clearTimeout(timer);
  }
}

/** Quantos avisos de WhatsApp (chaves `nexus_aviso:`) a trava registrou na última hora. */
async function contarNaUltimaHora(): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('system_state')
    .select('key', { count: 'exact', head: true })
    .like('key', `${PREFIXO_CHAVE}%`)
    .gte('updated_at', desde);
  if (error) {
    // Sem a contagem não dá para provar que está abaixo do teto: assume o teto cheio (o (a) e o (d) vão só por e-mail).
    logger.warn('nexus-aviso', 'contagem da última hora falhou', error);
    return TETO_WHATSAPP_POR_HORA;
  }
  return count ?? 0;
}

/**
 * Avisa o comercial. Nunca lança: o cadastro, a solicitação, o pedido e a resposta de oportunidade do parceiro não
 * podem falhar por causa do aviso. A TRAVA é tomada ANTES do envio (avisar duas vezes ensina a equipe a ignorar o aviso).
 */
export async function avisarComercial(tipo: TipoAviso, d: DadosAviso): Promise<ResultadoAviso> {
  try {
    const ligado = String(process.env.NEXUS_AVISO_LIGADO ?? '').trim() === '1';
    const destino = String(process.env.NEXUS_AVISO_PHONE ?? '').replace(/\D/g, '');
    if (!ligado || !destino) {
      // O pedido de equipamento é dinheiro: o e-mail sai SEMPRE, mesmo com o aviso desligado. Sem trava (cada pedido tem
      // id próprio, não há aviso em dobro a evitar), sem WhatsApp e sem webhook: esses só com a env ligada.
      if (emailSempre(tipo, d)) {
        await emailDoAviso(tipo, d, textoDoAviso(tipo, d), 'Aviso por WhatsApp desligado (NEXUS_AVISO_LIGADO). Só este e-mail foi enviado.');
        return 'email';
      }
      return 'desligado';
    }

    // A contagem vem ANTES do insert da trava, senão a própria chave do aviso entraria na conta do teto.
    const naHora = await contarNaUltimaHora();

    const { error: travaErr } = await supabase.from('system_state').insert({
      key: chaveDoAviso(tipo, d),
      value: { tipo, em: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    if (travaErr) {
      // 23505 = já avisado. Qualquer outro erro também para aqui: sem trava confiável, repetir é pior que perder um aviso.
      const jaAvisado = (travaErr as { code?: string }).code === '23505';
      if (!jaAvisado) logger.error('nexus-aviso', 'trava do aviso falhou, não vou arriscar avisar em dobro', travaErr);
      // O WhatsApp não repete, mas o e-mail do pedido (e da engenharia que desconta saldo) sai SEMPRE.
      if (emailSempre(tipo, d)) {
        await emailDoAviso(tipo, d, textoDoAviso(tipo, d), jaAvisado
          ? 'O WhatsApp deste tipo já foi avisado hoje para este parceiro (trava por parceiro, tipo e dia). Só este e-mail foi enviado.'
          : 'Não consegui tomar a trava do WhatsApp. Só este e-mail foi enviado.');
      }
      return 'duplicado';
    }

    const texto = textoDoAviso(tipo, d);
    const acimaDoTeto = naHora >= TETO_WHATSAPP_POR_HORA;
    let resultado: ResultadoAviso;

    if (SO_EMAIL_ACIMA_DO_TETO.has(tipo) && acimaDoTeto) {
      await emailDoAviso(tipo, d, texto, 'O teto de 12 avisos por hora no WhatsApp foi atingido, então este foi só por e-mail.');
      resultado = 'email';
    } else {
      try {
        await sendWhatsApp(destino, texto, 'io');
        resultado = 'enviado';
        // O pedido é dinheiro (e a engenharia com pacote desconta saldo): vai SEMPRE também por e-mail.
        if (emailSempre(tipo, d)) await emailDoAviso(tipo, d, texto, 'Cópia do aviso enviado pelo WhatsApp.');
      } catch (err) {
        logger.error('nexus-aviso', 'WhatsApp do aviso não passou, caindo para o e-mail', err);
        await emailDoAviso(tipo, d, texto, 'O WhatsApp não passou (linha fora, cooldown ou token). Segue o conteúdo do aviso.');
        resultado = 'email';
      }
    }

    await chamarWebhook(tipo, d);
    return resultado;
  } catch (err) {
    logger.error('nexus-aviso', 'aviso ao comercial falhou', err);
    return 'duplicado';
  }
}
