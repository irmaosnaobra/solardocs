// ─────────────────────────────────────────────────────────────────────────────
// GRUPO PRA QUEM ESFRIOU NO ELETROPOSTO.
//
// Pedido do dono: todo lead de eletroposto que ficou como "não atendeu" ou "sem
// interesse" recebe convite pro grupo. A lógica é a mesma do NOTA 1 — quem não
// está pronto pra comprar ainda pode acompanhar. No grupo ele vê faturamento
// real de ponto instalado, e quem acompanha volta sozinho quando o momento vira.
//
// Diferença pro convite do nota 1: essa gente JÁ falou (ou a gente tentou falar)
// com um consultor. A mensagem reconhece isso — fingir primeiro contato com quem
// recusou semana passada é o jeito mais rápido de virar bloqueio.
//
// ── Travas ──
//   • UM convite por pessoa, pra sempre. Não é cadência, é convite.
//   • Janela 09h–19h, 1 pessoa a cada 10 min, dentro do teto da linha.
//   • Pula quem tem reunião marcada no futuro (ainda está em jogo), quem está na
//     supressão (pediu pra parar) e quem já recebeu o convite como NOTA 1 —
//     receber o mesmo grupo duas vezes é a definição de spam.
//   • Toda mensagem sai com "responde PARAR que eu paro", e o PARAR funciona
//     (blastRespostas cobre este marcador).
//
// Kill-switch: EP_GRUPO_FRIOS_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { carregarSupressao } from './ioSend';

export const EP_GRUPO_FRIO_PREFIX = 'ep_grupo_frio:';
const ULTIMO_KEY = 'ep_grupo_frio_ultimo';

const INTERVALO_MS = 10 * 60 * 1000;
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;
/** A ficha precisa ter esfriado de verdade — nada de convidar quem foi marcado hoje. */
const IDADE_MINIMA_MS = 2 * 24 * 60 * 60 * 1000;
const ALVO = ['nao_atendeu', 'sem_interesse'];

const GRUPO_LINK = process.env.IO_GRUPO_ELETROPOSTO_LINK?.trim()
  || 'https://chat.whatsapp.com/BUhE93ZvMp2DZlZDsL2g7M';

const desligado = () => (process.env.EP_GRUPO_FRIOS_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 ? p : 'tudo bem';
}

/** Duas aberturas: uma pra quem não atendeu, outra pra quem disse que não é agora.
 *  O resto é igual — o convite é o mesmo, o que muda é reconhecer o que houve. */
export function bolhasGrupoFrio(status: string, nome: string | null | undefined): string[] {
  const p = primeiroNome(nome);
  const abertura = status === 'sem_interesse'
    ? [
      `Oi ${p}! Aqui é da Irmãos na Obra — a gente conversou sobre o eletroposto e você me disse que agora não era o momento.`,
      'Tudo certo, sem insistir. Só não quero que você perca o assunto de vista enquanto o momento não chega.',
    ]
    : [
      `Oi ${p}! Aqui é da Irmãos na Obra — tentei falar com você sobre o eletroposto e não consegui.`,
      'Sem problema. Em vez de ficar te ligando, prefiro te deixar perto do assunto do jeito mais leve.',
    ];

  return [
    ...abertura,
    `Te levo pro nosso grupo do eletroposto, entrada gratuita:\n${GRUPO_LINK}`,
    'Lá sai o faturamento real de cada ponto que a gente instala, como avaliar um local antes de fechar e o caminho do financiamento com 90 dias de carência. Ninguém vende nada lá dentro.',
    'Se preferir que eu não te procure mais, é só responder PARAR que eu paro na hora.',
  ];
}

export interface CandidatoGrupoFrio {
  telefone: string; chave: string; nome: string | null; status: string; ficha_em: string;
}

export async function publicoGrupoFrio(): Promise<CandidatoGrupoFrio[]> {
  const agora = Date.now();

  const { data: fichas, error } = await supabaseGerador
    .from('agendamentos')
    .select('cliente_nome, cliente_telefone, status, quando, created_at, created_by')
    .eq('created_by', 'lp_eletroposto')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`grupo-frio: ler agendamentos falhou — ${error.message}`);

  const maisRecente = new Map<string, any>();
  const temFuturo = new Set<string>();
  for (const f of fichas ?? []) {
    const k = telKey(f.cliente_telefone);
    if (!k) continue;
    if (!maisRecente.has(k)) maisRecente.set(k, f);
    if (f.quando && new Date(f.quando).getTime() > agora) temFuturo.add(k);
  }

  // Quem já recebeu o convite como NOTA 1 não recebe de novo.
  const { data: nota1 } = await supabaseGerador
    .from('eletroposto_nota1').select('telefone, convite_enviado_at').limit(2000);
  const jaConvidado = new Set(
    (nota1 ?? []).filter(n => n.convite_enviado_at).map(n => telKey(n.telefone)).filter(Boolean) as string[],
  );

  const { data: marcadores } = await supabase
    .from('system_state').select('key').like('key', `${EP_GRUPO_FRIO_PREFIX}%`).limit(2000);
  const jaFalado = new Set((marcadores ?? []).map(m => String(m.key).slice(EP_GRUPO_FRIO_PREFIX.length)));

  const estaBloqueado = await carregarSupressao();

  const out: CandidatoGrupoFrio[] = [];
  for (const [chave, f] of maisRecente) {
    const status = String(f.status || '');
    if (!ALVO.includes(status)) continue;
    if (temFuturo.has(chave)) continue;
    if (jaConvidado.has(chave) || jaFalado.has(chave)) continue;
    if (agora - new Date(f.created_at).getTime() < IDADE_MINIMA_MS) continue;

    const tel = String(f.cliente_telefone || '').replace(/\D/g, '');
    if (!tel || estaBloqueado(tel)) continue;

    out.push({ telefone: tel, chave, nome: f.cliente_nome ?? null, status, ficha_em: f.created_at });
  }
  return out.sort((a, b) => new Date(a.ficha_em).getTime() - new Date(b.ficha_em).getTime());
}

type Resultado = { enviados: number; motivo?: string; publico?: number; previa?: string[] };

export async function runGrupoFriosTick(opts: { dry?: boolean } = {}): Promise<Resultado> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };
  // PARADO EM 30/08/2026, por duas razões que se somam:
  //
  // 1. O DESTINO NÃO EXISTE MAIS. O grupo de WhatsApp foi descartado pelo Thiago em
  //    17/08: quem não qualifica passou a ir para o cadastro de /io/eletroposto/parceria.
  //    Este tick continuou convidando gente para um lugar que saiu do funil.
  // 2. Ordem do Thiago hoje, sobre a pesquisa do treinamento de ponto: "não pode entrar
  //    NENHUMA automação neles". Medido antes de desligar: 45 das 184 pessoas da pesquisa
  //    estavam no público deste tick. Elas receberiam, no mesmo dia, a pergunta do dono e
  //    um convite de grupo — dois assuntos, duas vozes, na mesma linha.
  //
  // Religar exige decidir para ONDE ele convida. Enquanto isso não for respondido, a
  // função devolve zero sem tocar no banco. Voltar é apagar este bloco.
  if (!opts.dry) return { enviados: 0, motivo: 'parado-30-08: grupo descontinuado e pesquisa em campo' };

  const publico = await publicoGrupoFrio();
  if (opts.dry) {
    return {
      enviados: 0, motivo: 'dry', publico: publico.length,
      previa: publico[0] ? bolhasGrupoFrio(publico[0].status, publico[0].nome) : [],
    };
  }
  if (!publico.length) return { enviados: 0, motivo: 'ninguem_pendente' };
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela', publico: publico.length };

  const agora = Date.now();
  const { data: ult } = await supabase
    .from('system_state').select('value').eq('key', ULTIMO_KEY).maybeSingle();
  const ultimoMs = new Date(((ult?.value ?? {}) as { at?: string }).at ?? 0).getTime();
  if (agora - ultimoMs < INTERVALO_MS) return { enviados: 0, motivo: 'intervalo', publico: publico.length };

  if (!(await dentroDoTetoHorarioLinha())) return { enviados: 0, motivo: 'teto_linha', publico: publico.length };

  const alvo = publico[0];
  const nowIso = new Date().toISOString();

  // Marca antes de enviar: convite repetido é pior que convite perdido.
  await supabase.from('system_state').upsert(
    { key: `${EP_GRUPO_FRIO_PREFIX}${alvo.chave}`,
      value: { convidado_em: nowIso, status: alvo.status, nome: alvo.nome },
      updated_at: nowIso },
    { onConflict: 'key' },
  );
  await supabase.from('system_state').upsert(
    { key: ULTIMO_KEY, value: { at: nowIso, chave: alvo.chave }, updated_at: nowIso },
    { onConflict: 'key' },
  );

  try {
    await sendFrio(alvo.telefone, bolhasGrupoFrio(alvo.status, alvo.nome), 'io');
    logger.info('ep-grupo-frio', `convite enviado (${alvo.status}, ficha de ${alvo.ficha_em.slice(0, 10)})`);
    return { enviados: 1, publico: publico.length - 1 };
  } catch (err) {
    logger.error('ep-grupo-frio', `convite falhou pra ficha de ${alvo.ficha_em.slice(0, 10)}`, err);
    return { enviados: 0, motivo: 'erro_envio', publico: publico.length };
  }
}
