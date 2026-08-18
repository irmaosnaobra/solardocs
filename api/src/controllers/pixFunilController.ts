// ─────────────────────────────────────────────────────────────────────────────
// FUNIL DO PIX — quantas pessoas chegam na tela e quantas saem pagando.
//
// Existe porque a resposta pra "quantos chegaram na página do Pix?" era
// "ninguém sabe": as telas não mediam nada, e o banco só enxerga quem foi até
// o fim (linha em asaas_pix_assinaturas). Quem abriu e desistiu não deixava
// rastro nenhum — que é justamente onde mora o dinheiro perdido.
//
// Duas fontes, de propósito:
//   • lp_events  → o comportamento (chegou, gerou, copiou, pagou na tela)
//   • asaas_pix_assinaturas → o fato (contrato criado, contrato pago)
//
// O fato manda. Se o rastreio cair, o contrato continua gravado; a checagem
// `contratos >= gerou` denuncia rastreio faltando em vez de fingir que ninguém
// passou por ali.
// ─────────────────────────────────────────────────────────────────────────────
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const TZ_OFFSET_H = 3; // America/Sao_Paulo (UTC-3)

function inicioDoDiaSP(diasAtras = 0): Date {
  const agora = new Date();
  const sp = new Date(agora.getTime() - TZ_OFFSET_H * 3600000);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() + TZ_OFFSET_H * 3600000 - diasAtras * 86400000);
}

function desdeQuando(period: string): Date {
  const agora = Date.now();
  switch (period) {
    case 'hoje':   return inicioDoDiaSP(0);
    case 'ontem':  return inicioDoDiaSP(1);
    case '3dias':  return new Date(agora - 3 * 86400000);
    case '7dias':  return new Date(agora - 7 * 86400000);
    case '30dias': return new Date(agora - 30 * 86400000);
    default:       return new Date(0);
  }
}

type Tela = 'automatico' | 'recorrente';

interface Evento {
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

// Conta PESSOAS (sessões distintas), não disparos. Uma pessoa que gera o Pix,
// erra e gera de novo é uma pessoa — contar eventos inflaria o funil no ponto
// exato em que ele está com problema.
function sessoes(evs: Evento[], tipo: string, tela?: Tela): number {
  return new Set(
    evs
      .filter(e => e.event_type === tipo)
      .filter(e => !tela || (e.event_data?.tela as string) === tela)
      .map(e => e.session_id)
  ).size;
}

export async function getPixFunil(req: Request, res: Response): Promise<void> {
  try {
    const period = (req.query.period as string) || '30dias';
    const since = desdeQuando(period);

    const [{ data: evRaw }, { data: contratosRaw }, { data: primeiro }] = await Promise.all([
      supabase
        .from('lp_events')
        .select('session_id, event_type, event_data, created_at')
        .in('event_type', ['pix_abriu', 'pix_gerou', 'pix_copiou', 'pix_pago', 'pix_falhou'])
        .gte('created_at', since.toISOString())
        .limit(20000),
      supabase
        .from('asaas_pix_assinaturas')
        .select('id, status, modo, user_id, created_at')
        .gte('created_at', since.toISOString())
        .limit(5000),
      // Quando o rastreio começou a existir. Sem isso, um período anterior ao
      // deploy mostraria zero e leria como "ninguém entrou" em vez de "ainda
      // não media".
      supabase
        .from('lp_events')
        .select('created_at')
        .eq('event_type', 'pix_abriu')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const evs = (evRaw ?? []) as Evento[];
    const contratos = contratosRaw ?? [];
    const medindoDesde = (primeiro as { created_at: string } | null)?.created_at ?? null;

    // Duas situações diferentes, e confundir as duas é o erro clássico deste
    // painel:
    //   semMedicao    → NUNCA houve evento. A tela mostra "—", nunca 0: zero
    //                   aqui leria como "ninguém chegou" quando a verdade é
    //                   "não estávamos vendo".
    //   periodoParcial → o rastreio existe, mas começou DEPOIS do início do
    //                   período pedido. O número está certo, só não cobre o
    //                   intervalo inteiro — a tela diz desde quando conta.
    const semMedicao = !medindoDesde;
    const periodoParcial = Boolean(medindoDesde)
      && new Date(medindoDesde as string).getTime() > since.getTime();

    const chegou = sessoes(evs, 'pix_abriu');
    const gerou  = sessoes(evs, 'pix_gerou');
    const copiou = sessoes(evs, 'pix_copiou');
    const pagou  = sessoes(evs, 'pix_pago');

    // Quem chegou vindo do cancel_url da Stripe — o público que essa tela
    // existe pra pegar. O resto é link direto (WhatsApp, e-mail de cobrança).
    const doCheckout = new Set(
      evs.filter(e => e.event_type === 'pix_abriu' && e.event_data?.doCheckout === true)
        .map(e => e.session_id)
    ).size;

    const porMotivo = new Map<string, number>();
    evs.filter(e => e.event_type === 'pix_falhou').forEach(e => {
      const m = (e.event_data?.motivo as string) || 'erro-desconhecido';
      porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
    });

    const contratosPagos = contratos.filter(c => c.status === 'ativo').length;

    res.json({
      period,
      since: since.toISOString(),
      medindoDesde,
      // A tela desenha "—" quando isto vem true, nunca 0.
      semMedicao,
      periodoParcial,
      passos: [
        { key: 'chegou', label: 'Chegaram na tela de Pix',  count: chegou, sub: `${doCheckout} vieram do checkout da Stripe` },
        { key: 'gerou',  label: 'Geraram o código',          count: gerou },
        { key: 'copiou', label: 'Copiaram o copia-e-cola',   count: copiou },
        { key: 'pagou',  label: 'Pagaram com a tela aberta', count: pagou },
      ],
      porTela: {
        automatico: { chegou: sessoes(evs, 'pix_abriu', 'automatico'), gerou: sessoes(evs, 'pix_gerou', 'automatico') },
        recorrente: { chegou: sessoes(evs, 'pix_abriu', 'recorrente'), gerou: sessoes(evs, 'pix_gerou', 'recorrente') },
      },
      falhas: [...porMotivo.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
      // Verdade do banco, independente do rastreio. `contratos` menor que
      // `gerou` é impossível: se aparecer, o rastreio está contando errado.
      banco: {
        contratos: contratos.length,
        pagos: contratosPagos,
        semConta: contratos.filter(c => !c.user_id).length,
      },
    });
  } catch (err) {
    console.error('getPixFunil error:', err);
    res.status(500).json({ error: 'Erro ao montar o funil do Pix' });
  }
}
