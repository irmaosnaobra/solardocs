// ─────────────────────────────────────────────────────────────────────────────
// A RODADA DA SENTINELA: junta leituras, calendário e Giovanna, decide se há o
// que dizer e entrega UM texto a quem envia. Este arquivo NÃO envia: quem manda
// é `enviar`, que vem de fora (services/io/sentinelaEnvio.ts, o único que fala
// com WhatsApp e e-mail).
//
// Ordem (importa): reserva do dia, foto da Giovanna, leituras, avaliação, envio.
//   - A reserva é um INSERT em sentinela_ferr:<dia>. Quem perde o insert não
//     manda nada: no máximo um aviso por dia, mesmo com o cron disparado duas
//     vezes ou à mão. Se o envio falhar depois da reserva, NÃO há reenvio no dia.
//   - ?seco=1 devolve o texto e não grava nada: sem reserva, sem foto, sem
//     congelamento e sem envio.
//   - Leitura que quebra vira "não conferido" (nunca alerta); o calendário
//     ilegível vira uma lista vazia mais uma linha no registro.
// ─────────────────────────────────────────────────────────────────────────────

import { diaBRT } from './relogio';
import {
  avaliar, montarMensagem, sanearCalendario,
  type Leitura, type ResumoGiovanna, type Vencimento,
} from './sentinela';
import { depsReais, lerTudo } from './sentinelaLeituras';
import { ligado } from './interruptores';
import { depsGiovannaReais, rodarGiovanna } from './sentinelaGiovanna';

export const CHAVE_CALENDARIO = 'sentinela_vencimentos';
export const PREFIXO_RESERVA = 'sentinela_ferr:';

export type EstadoRodada = 'desligado' | 'ja_rodou' | 'calada' | 'enviado' | 'seco' | 'falha_envio' | 'sem_reserva';

export interface ResultadoRodada {
  ok: boolean;
  estado: EstadoRodada;
  dia: string;
  alertas: number;
  giovanna: boolean;
  /** Só no modo seco: o texto que sairia (ou null se ficaria calada). */
  texto?: string | null;
  canal?: string;
}

export interface DepsRodada {
  agora: Date;
  reservar: (chave: string) => Promise<'reservado' | 'ja' | 'erro'>;
  marcar: (chave: string, valor: unknown) => Promise<void>;
  lerCalendario: () => Promise<unknown>;
  leituras: () => Promise<Leitura[]>;
  giovanna: (seco: boolean) => Promise<ResumoGiovanna | null>;
  /** `direto_email`: a linha da Z-API está caída, então o aviso nem tenta o WhatsApp. */
  enviar: (texto: string, opts?: { direto_email?: boolean }) => Promise<{ canal: string }>;
  /** Interruptor `sentinela` (env AGENTES5040_SENTINELA ou ag5040_interruptores). */
  ligada: () => Promise<boolean>;
  registrar?: (nivel: 'info' | 'erro', mensagem: string, dado?: unknown) => void;
}

export async function rodarSentinelaFerramentas(deps: DepsRodada, opts: { seco?: boolean } = {}): Promise<ResultadoRodada> {
  const seco = !!opts.seco;
  const dia = diaBRT(deps.agora);
  const log = deps.registrar ?? (() => {});
  const base = { dia, alertas: 0, giovanna: false };

  // Desligada, a rodada de verdade não faz nada; o ?seco continua mostrando o texto.
  if (!seco && !(await deps.ligada().catch(() => false))) return { ok: true, estado: 'desligado', ...base };

  const chave = `${PREFIXO_RESERVA}${dia}`;
  if (!seco) {
    const r = await deps.reservar(chave);
    if (r === 'ja') return { ok: true, estado: 'ja_rodou', ...base };
    if (r === 'erro') return { ok: false, estado: 'sem_reserva', ...base };
  }

  let calendario: Vencimento[] = [];
  try {
    const san = sanearCalendario(await deps.lerCalendario() ?? []);
    if (san.ok) calendario = san.lista;
    else log('erro', 'calendário da sentinela ilegível', { erro: san.erro });
  } catch (err: any) { log('erro', 'não leu o calendário', { erro: String(err?.message || err) }); }

  let giovanna: ResumoGiovanna | null = null;
  try { giovanna = await deps.giovanna(seco); }
  catch (err: any) { log('erro', 'resumo da Giovanna falhou', { erro: String(err?.message || err) }); }

  let leituras: Leitura[] = [];
  try { leituras = await deps.leituras(); }
  catch (err: any) { log('erro', 'leituras falharam', { erro: String(err?.message || err) }); }

  const alertas = avaliar(leituras, calendario, deps.agora);
  const texto = montarMensagem({ alertas, giovanna, agora: deps.agora });
  const resumo = { ...base, alertas: alertas.length, giovanna: !!texto && texto.includes('Giovanna, resumo do dia') };

  if (seco) return { ok: true, estado: 'seco', ...resumo, texto };
  if (!texto) {
    await deps.marcar(chave, { estado: 'calada', em: deps.agora.toISOString() }).catch(() => {});
    return { ok: true, estado: 'calada', ...resumo };
  }
  try {
    const zapiCaiu = leituras.some(l => l.ferramenta.startsWith('Z-API') && l.estado === 'falha');
    const { canal } = await deps.enviar(texto, zapiCaiu ? { direto_email: true } : undefined);
    await deps.marcar(chave, { estado: 'enviado', canal, alertas: alertas.length, em: deps.agora.toISOString() }).catch(() => {});
    return { ok: true, estado: 'enviado', ...resumo, canal };
  } catch (err: any) {
    log('erro', 'envio da sentinela falhou', { erro: String(err?.message || err) });
    await deps.marcar(chave, { estado: 'falha_envio', alertas: alertas.length, em: deps.agora.toISOString() }).catch(() => {});
    return { ok: false, estado: 'falha_envio', ...resumo };
  }
}

/** A reserva: INSERT que só um vence. 23505 (chave repetida) = já reservada. */
export async function reservarNoBanco(
  principal: { from: (t: string) => any }, chave: string, agora: Date,
): Promise<'reservado' | 'ja' | 'erro'> {
  const { error } = await principal.from('system_state')
    .insert({ key: chave, value: { estado: 'reservado' }, updated_at: agora.toISOString() });
  if (!error) return 'reservado';
  return (error as any).code === '23505' ? 'ja' : 'erro';
}

/** Monta as dependências reais. `enviar` vem de quem chama (a rota passa o sentinelaEnvio). */
export function depsRodadaReais(args: {
  principal: { from: (t: string) => any };
  gerador: { from: (t: string) => any };
  novoAnthropic: () => { messages: { create: (a: any, o?: any) => Promise<unknown> } };
  enviar: DepsRodada['enviar'];
  agora?: Date;
  registrar?: DepsRodada['registrar'];
}): DepsRodada {
  const agora = args.agora ?? new Date();
  return {
    agora,
    reservar: chave => reservarNoBanco(args.principal, chave, agora),
    marcar: async (chave, valor) => {
      await args.principal.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave);
    },
    lerCalendario: async () => {
      const { data, error } = await args.principal.from('system_state').select('value').eq('key', CHAVE_CALENDARIO).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value ?? [];
    },
    leituras: () => lerTudo(depsReais(args.principal, args.novoAnthropic, agora)),
    giovanna: seco => rodarGiovanna(depsGiovannaReais(args.gerador, args.principal, agora), { seco }),
    enviar: args.enviar,
    ligada: () => ligado('sentinela'),
    registrar: args.registrar,
  };
}
