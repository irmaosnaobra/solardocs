// Aviso `apto_reuniao` do Portal do Parceiro NEXUS: o parceiro concluiu o Nível 1 (Raio-X 80+) e deixou um contato para a
// reunião de diagnóstico. Textos aprovados em 17/11/2026. Mora aqui para o avisoComercial.ts não passar de 350 linhas;
// o avisarComercial('apto_reuniao') só delega para avisarApto.
//
// Todo dado de parceiro passa por limpo() (sem quebra de linha nem formatação do WhatsApp); no e-mail o corpo inteiro
// ainda é escapado em HTML. O assunto é texto fixo: entra cru no <h2> do sendOpsAlert.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendOpsAlert } from '../../utils/mailer';
import { waitUntil } from '../../utils/waitUntil';
import { sendWhatsApp } from '../agents/zapiClient';
import { carregarTelefonesConsultores, linhaIoEmCooldown, telefoneDoConsultor, tetoDaLinhaPermiteFicha } from '../agentes5040/fichaEnvio';
import { cidadeUf } from './repositorio';

/** true = o aviso sai só por e-mail (sendOpsAlert), sem WhatsApp. O chefe anti-ban liberou o WhatsApp em 17/11 (Thiago e Diego, linha 5040). */
export const APTO_SO_EMAIL = false;
/** Rajada (cadastro, usina, termo): com 6 ou mais avisos `nexus_aviso:` nos últimos 10 minutos vão só por e-mail. */
export const RAJADA_MINUTOS = 10;
export const RAJADA_MAX = 6;
/** Teto do apto_reuniao, decidido por evento ANTES de enviar: 11 ou mais bolhas na última hora, ou 5 ou mais nos últimos 10 minutos, vira só e-mail. */
export const APTO_TETO_HORA = 11;
export const APTO_TETO_RAJADA = 5;
/** A 2ª bolha sai de 25 a 60 s depois da 1ª. */
export const APTO_ESPERA_MIN_S = 25;
export const APTO_ESPERA_MAX_S = 60;
export const ASSUNTO_APTO = 'Novo Raio-X concluído, parceiro pede diagnóstico';

export interface DadosApto {
  /** O id de usuário do parceiro (users.id): é o que a ficha da equipe usa. */
  user_id: string;
  nota: number;
  demanda_12m: number;
  clientes_em_vista: number;
  contato: { nome: string; whatsapp: string; periodo?: string | null };
  /** `diag_pedido_em` do pedido: entra nas travas, para um pedido refeito depois de "ainda não" avisar de novo (o mesmo pedido, uma vez só). */
  pedido_em?: string | null;
}

interface Empresa { empresa?: string | null; cidade?: string | null; uf?: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limpo(v: unknown, max = 80): string {
  return String(v ?? '').replace(/[*_~`<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const numero = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Link da ficha na equipe (a aba Trilha abre pelo hash `#trilha`). O id só entra no link se for UUID. */
export function linkDaFicha(userId: string): string {
  return UUID.test(userId) ? `https://solardoc.app/nexus/adm/#trilha/${userId.toLowerCase()}` : 'https://solardoc.app/nexus/adm/#trilha';
}

const PERIODO_TEXTO: Record<string, string> = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

function campos(p: Empresa, a: DadosApto) {
  return {
    empresa: limpo(p.empresa) || 'Empresa sem nome',
    lugar: limpo(cidadeUf(limpo(p.cidade), limpo(p.uf, 2))) || 'não informada',
    nota: numero(a.nota),
    demanda: numero(a.demanda_12m),
    clientes: numero(a.clientes_em_vista),
    nome: limpo(a.contato?.nome) || 'não informado',
    wpp: String(a.contato?.whatsapp ?? '').replace(/\D/g, '') || 'não informado',
    periodo: PERIODO_TEXTO[String(a.contato?.periodo)] ?? 'não informado',
    ficha: linkDaFicha(a.user_id),
  };
}

/** Versão do WhatsApp interno. */
export function textoApto(p: Empresa, a: DadosApto): string {
  const c = campos(p, a);
  return [
    'Novo Raio-X concluído, diagnóstico pedido',
    `Empresa ${c.empresa}, ${c.lugar}. Nota do Raio-X: ${c.nota}.`,
    `Demanda em 12 meses: ${c.demanda}. Clientes em vista: ${c.clientes}.`,
    `Contato: ${c.nome}, ${c.wpp}.`,
    `Melhor período: ${c.periodo}`,
    `Ficha: ${c.ficha}`,
  ].join('\n');
}

/** Corpo do e-mail (texto puro com quebras de linha; o envio escapa e troca a quebra por <br>). */
export function corpoEmailApto(p: Empresa, a: DadosApto): string {
  const c = campos(p, a);
  return [
    'Um parceiro concluiu o Raio-X e pediu a reunião de diagnóstico.',
    `Empresa: ${c.empresa}`,
    `Cidade/UF: ${c.lugar}`,
    `Nota do Raio-X: ${c.nota}`,
    `Demanda em 12 meses: ${c.demanda}`,
    `Clientes em vista: ${c.clientes}`,
    `Contato: ${c.nome}`,
    `WhatsApp: ${c.wpp}`,
    `Melhor período: ${c.periodo}`,
    `Ficha completa: ${c.ficha}`,
    'Chame o contato para combinar o horário.',
  ].join('\n');
}

// ── Envio ────────────────────────────────────────────────────────────────────
// Travas (system_state, insert com chave única):
//   nexus_aviso_evento:apto_reuniao:<parceiro_id>:<pedido>        uma por pedido (diag_pedido_em em ms): o evento acontece uma vez só
//                                                                 (fora da contagem do teto); pedido refeito = chave nova
//   nexus_aviso:apto_reuniao:<parceiro_id>:<pedido>:thiago        uma por destino, gravada ANTES de cada bolha (o teto conta bolhas)
//   nexus_aviso:apto_reuniao:<parceiro_id>:<pedido>:diego
// Telefones: tabela `consultores` (como o avisoVendaDiego); o Thiago, se não estiver lá, recebe no NEXUS_AVISO_PHONE (se existir).
// Liga por padrão; NEXUS_APTO_AVISO_OFF=1 desliga. O e-mail sai sempre, uma vez por evento.

export type ResultadoApto = 'enviado' | 'email' | 'duplicado' | 'desligado';

const PREFIXO = 'nexus_aviso:';
const escapar = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function emailApto(corpo: string, motivo: string): Promise<void> {
  await sendOpsAlert(ASSUNTO_APTO, `<p>${escapar(corpo).replace(/\n/g, '<br>')}</p><p style="color:#64748b;font-size:13px;">${escapar(motivo)}</p>`)
    .catch((e) => logger.error('nexus-aviso', 'e-mail do apto_reuniao falhou', e));
}

async function contar(minutos: number): Promise<number> {
  const desde = new Date(Date.now() - minutos * 60 * 1000).toISOString();
  const { count, error } = await supabase.from('system_state').select('key', { count: 'exact', head: true }).like('key', `${PREFIXO}%`).gte('updated_at', desde);
  if (error) { logger.warn('nexus-aviso', 'contagem do apto_reuniao falhou', error); return Number.MAX_SAFE_INTEGER; } // sem prova de que cabe, vai só por e-mail
  return count ?? 0;
}

/** Toma a trava: true = é nossa; false = já existia (ou o banco falhou: sem trava confiável, não repete). */
async function travar(key: string): Promise<boolean> {
  const { error } = await supabase.from('system_state').insert({ key, value: { tipo: 'apto_reuniao', em: new Date().toISOString() }, updated_at: new Date().toISOString() });
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') logger.error('nexus-aviso', 'trava do apto_reuniao falhou, não vou arriscar avisar em dobro', error);
  return false;
}

type Destino = { quem: 'thiago' | 'diego'; tel: string };

async function destinos(destinoAtual: string): Promise<Destino[]> {
  const t = await carregarTelefonesConsultores();
  if (!t.ok) logger.warn('nexus-aviso', `apto_reuniao: não consegui ler os consultores (${t.codigo}); só o destino do aviso (Thiago)`);
  const mapa = t.ok ? t.mapa : new Map<string, string>();
  const lista: Destino[] = [];
  const thiago = mapa.get('thiago') || destinoAtual;
  if (thiago) lista.push({ quem: 'thiago', tel: thiago });
  const diego = t.ok ? telefoneDoConsultor(mapa, 'diego') : null;
  if (diego && diego !== thiago) lista.push({ quem: 'diego', tel: diego });
  else if (!diego) logger.warn('nexus-aviso', 'apto_reuniao: o Diego não tem telefone na tabela de consultores; o aviso ficou só com o Thiago');
  return lista;
}

/** A 2ª bolha: isolada. Falhar aqui não repete a 1ª, não manda e-mail e nunca lança. */
async function segundaBolha(chaveBase: string, d: Destino, texto: string): Promise<void> {
  try {
    if (!(await travar(`${chaveBase}:${d.quem}`))) return;
    await sendWhatsApp(d.tel, texto, 'io');
  } catch (e) {
    logger.error('nexus-aviso', `apto_reuniao: a bolha do ${d.quem} falhou (a primeira já saiu)`, e);
  }
}

/**
 * Avisa a equipe de que o parceiro está apto para a reunião. Nunca lança. Liga por padrão (não depende de NEXUS_AVISO_LIGADO nem de
 * NEXUS_AVISO_PHONE); desliga só com NEXUS_APTO_AVISO_OFF=1. O e-mail sai SEMPRE, uma vez por evento, com o mesmo conteúdo. As bolhas de
 * WhatsApp (Thiago e Diego, tabela `consultores`; o Thiago cai no NEXUS_AVISO_PHONE se existir) respeitam as travas e o teto: a 1ª sai já,
 * a 2ª de 25 a 60 s depois, fora da resposta (waitUntil).
 */
export async function avisarApto(parceiro: Empresa & { id: string }, apto: DadosApto | undefined): Promise<ResultadoApto> {
  let travado = false;
  let emailFeito = false;
  const email = async (corpo: string, motivo: string) => { emailFeito = true; await emailApto(corpo, motivo); };
  try {
    if (!apto || String(process.env.NEXUS_APTO_AVISO_OFF ?? '').trim() === '1') return 'desligado';
    // O evento acontece uma vez só por parceiro.
    const pedido = Date.parse(String(apto.pedido_em ?? '')) || 0;
    if (!(await travar(`nexus_aviso_evento:apto_reuniao:${parceiro.id}:${pedido}`))) return 'duplicado';
    travado = true;
    const corpo = corpoEmailApto(parceiro, apto);
    if (APTO_SO_EMAIL) { await email(corpo, ''); return 'email'; }
    // As contagens vêm ANTES das travas de bolha (as próprias chaves não entram na conta).
    const [naHora, naRajada] = await Promise.all([contar(60), contar(RAJADA_MINUTOS)]);
    if (naHora >= APTO_TETO_HORA || naRajada >= APTO_TETO_RAJADA) {
      await email(corpo, 'O teto de avisos no WhatsApp foi atingido (11 na hora ou 5 em 10 minutos), então este foi só por e-mail.');
      return 'email';
    }
    // Estado da linha inteira, como o fichaEnvio: em cooldown, no teto (hora ou dia) ou sem como contar = só e-mail.
    if (linhaIoEmCooldown() || (await tetoDaLinhaPermiteFicha(new Date())) !== 'ok') {
      await email(corpo, 'A linha do WhatsApp está em cooldown ou no teto, então este foi só por e-mail.');
      return 'email';
    }
    await email(corpo, 'Aviso interno também enviado pelo WhatsApp ao Thiago e ao Diego, quando há telefone deles.');
    const texto = textoApto(parceiro, apto);
    const [primeira, segunda] = await destinos(String(process.env.NEXUS_AVISO_PHONE ?? '').replace(/\D/g, ''));
    if (!primeira) return 'email';
    const chaveBase = `${PREFIXO}apto_reuniao:${parceiro.id}:${pedido}`;
    if (!(await travar(`${chaveBase}:${primeira.quem}`))) return 'duplicado';
    try {
      await sendWhatsApp(primeira.tel, texto, 'io');
    } catch (err) {
      logger.error('nexus-aviso', 'apto_reuniao: o WhatsApp não passou (o e-mail já saiu; a 2ª bolha não sai)', err);
      return 'email';
    }
    if (segunda) {
      const espera = (APTO_ESPERA_MIN_S + Math.random() * (APTO_ESPERA_MAX_S - APTO_ESPERA_MIN_S)) * 1000;
      waitUntil(new Promise<void>((ok) => setTimeout(ok, espera)).then(() => segundaBolha(chaveBase, segunda, texto)));
    }
    return 'enviado';
  } catch (err) {
    logger.error('nexus-aviso', 'aviso apto_reuniao falhou', err);
    if (travado && !emailFeito && apto) await emailApto(corpoEmailApto(parceiro, apto), 'O envio pelo WhatsApp falhou. Segue o conteúdo.');
    return 'duplicado';
  }
}
