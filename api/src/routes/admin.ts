import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { getUsers, triggerMonthlyReset, getVisits, getAnalytics, getMetaFunnel, getFunnel, getRevenue, getBilling } from '../controllers/adminController';
import { getLimpaproFunnel, getLimpaproLeads, getLimpaproConversas, getLimpaproMembros } from '../controllers/limpaproController';
import { getPixFunil } from '../controllers/pixFunilController';
import { getVslRetencao } from '../controllers/vslController';
import { jornadaLimpapro } from '../controllers/limpaproJornadaController';
import { getMetaAds } from '../controllers/metaAdsController';
import { listarOrdens, marcarFeita, setModo, sincronizarOrdens } from '../services/metaOrdensService';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { temChaveDeBootstrap } from '../utils/bootstrapKey';
import { etiquetaDeLead, ETIQUETAS_ORDEM } from '../services/agenda/origemEtiqueta';
import {
  NOTA1_MATERIAL_DESDE, NOTA1_MATERIAL_ATE, NOTA1_TIPOS, inicioDaJanela, linhasDoFunil, somaColuna,
} from '../services/io/nota1Funil';
import * as pc from '../services/io/pontoCertoFunil';
import { runIoBroadcastTick } from '../services/io/broadcastTickService';
import {
  ATENDENTE_PROMPT_KEY, PROMPT_PADRAO, PLACEHOLDERS, numerosVivos, resolverPlaceholders,
} from '../services/agents/whatsapp/atendenteAnuncioPrompt';

const router = Router();

// Endpoint /admin/users/delete-bootstrap: manutenção via curl, fora do auth de
// admin. A key vem do env BOOTSTRAP_KEY (SEM fallback hardcoded) — se não estiver
// setada, o endpoint fica fechado (fail-closed). DEFINIDO ANTES dos middlewares.
router.post('/users/delete-bootstrap', async (req: Request, res: Response): Promise<void> => {
  const BOOTSTRAP_KEY = (process.env.BOOTSTRAP_KEY || '').trim();
  if (!BOOTSTRAP_KEY || req.query.key !== BOOTSTRAP_KEY) { res.status(403).json({ error: 'forbidden' }); return; }
  try {
    const { email, cnpj } = req.body as { email?: string; cnpj?: string };
    if (!email && !cnpj) { res.status(400).json({ error: 'Informe email ou cnpj' }); return; }

    let userId: string | null = null;
    let userEmail: string | null = null;

    if (cnpj) {
      // Sanitiza pra SÓ [0-9./-] — remove vírgula/parênteses que causariam
      // filter-injection no .or() do PostgREST. CNPJ (com ou sem máscara) só usa
      // esses caracteres, então cobre os dois formatos guardados no banco.
      const safe = String(cnpj).replace(/[^0-9./-]/g, '');
      const onlyDigits = safe.replace(/\D/g, '');
      if (!onlyDigits) { res.status(400).json({ error: 'CNPJ inválido' }); return; }
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .or(`cnpj.eq.${safe},cnpj.eq.${onlyDigits}`)
        .maybeSingle();
      if (!comp) { res.status(404).json({ error: 'Empresa com esse CNPJ não encontrada' }); return; }
      userId = comp.user_id;
    } else if (email) {
      const { data: u } = await supabase.from('users').select('id, email').eq('email', email).maybeSingle();
      if (!u) { res.status(404).json({ error: 'User com esse email não encontrado' }); return; }
      userId = u.id;
      userEmail = u.email;
    }
    if (!userId) { res.status(404).json({ error: 'User não encontrado' }); return; }

    if (!userEmail) {
      const { data: u } = await supabase.from('users').select('email').eq('id', userId).single();
      userEmail = u?.email ?? null;
    }

    const deleted: Record<string, number> = {};
    for (const t of ['documents', 'clients', 'terceiros', 'company']) {
      const { count } = await supabase.from(t).delete({ count: 'exact' }).eq('user_id', userId);
      deleted[t] = count || 0;
    }
    const { count: usersCount } = await supabase.from('users').delete({ count: 'exact' }).eq('id', userId);
    deleted.users = usersCount || 0;

    res.json({ ok: true, user_id: userId, email: userEmail, deleted });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar user', message: String(err) });
  }
});

// ── Pulso do Ponto Certo — SÓ CONTAGEM, fora do auth de admin ──────────────
// Existe por um motivo estreito: a aba Ponto Certo mede uma landing que acabou
// de ganhar beacon, e conferir se a medição está viva exige a mesma sessão de
// admin que só existe no navegador do dono. Ficar sem resposta a "já entrou
// alguém?" é ficar sem saber se o beacon quebrou.
//
// O QUE ELA NÃO DEVOLVE, de propósito: nome, telefone, e-mail, id de sessão.
// Só quantidades. A rota de verdade — com a lista de quem sumiu no caminho e as
// vendas — continua sendo /admin/ponto-certo-funil, atrás do login.
router.get('/ponto-certo-pulso', async (req: Request, res: Response): Promise<void> => {
  if (!temChaveDeBootstrap(req)) { res.status(403).json({ error: 'forbidden' }); return; }
  try {
    const agora = Date.now();
    const desde7 = new Date(agora - 7 * 86400_000).toISOString();
    const hoje = pc.diaSP(new Date(agora).toISOString());
    const inicioDeHoje = new Date(`${hoje}T00:00:00-03:00`).toISOString();

    const [eventosQ, vendasQ, cadQ] = await Promise.all([
      supabase.from('pc_eventos').select('tipo, session_id, created_at')
        .in('tipo', pc.PONTO_CERTO_TIPOS).gte('created_at', desde7),
      supabase.from('pc_compras').select('created_at, status, valor_centavos')
        .eq('item_slug', 'ponto-certo'),
      supabaseGerador.from('eletroposto_parceria').select('created_at, lado').eq('lado', 'capital'),
    ]);

    const eventos = (eventosQ.data ?? []) as Array<{ tipo: string; session_id: string | null; created_at: string }>;
    const sessoes = (tipo: string, desde?: string) => new Set(
      eventos.filter((e) => e.tipo === tipo && (!desde || e.created_at >= desde))
        .map((e) => e.session_id || e.created_at),
    ).size;

    const vendas = (vendasQ.data ?? []) as Array<{ created_at: string; status: string | null; valor_centavos: number | null }>;
    const cadastros = (cadQ.data ?? []) as Array<{ created_at: string }>;
    const aprovadas = vendas.filter((v) => v.status === 'aprovada');

    res.json({
      agora: new Date(agora).toISOString(),
      hoje,
      // Sessões de navegador, não pessoas: a página é anônima.
      lp: {
        abriram_hoje: sessoes('pc_lp_view', inicioDeHoje),
        abriram_7d: sessoes('pc_lp_view'),
        rolaram_7d: sessoes('pc_lp_rolou'),
        // A pergunta que 'rolou metade' não respondia: o botão de compra chegou
        // a aparecer na tela? Numa página de 15 mil pixels, metade é longe demais
        // pra servir de sinal.
        viram_a_oferta_7d: sessoes('pc_lp_oferta'),
        checkout_7d: sessoes('pc_lp_checkout'),
        primeiro_evento: eventos.length
          ? eventos.map((e) => e.created_at).sort()[0] : null,
        ultimo_evento: eventos.length
          ? eventos.map((e) => e.created_at).sort().slice(-1)[0] : null,
      },
      cadastros_capital: {
        hoje: cadastros.filter((c) => c.created_at >= inicioDeHoje).length,
        total: cadastros.length,
        depois_do_redirect: cadastros.filter((c) => pc.diaSP(c.created_at) >= pc.REDIRECT_DESDE).length,
      },
      vendas: {
        aprovadas: aprovadas.length,
        todas: vendas.length,
        receita_centavos: aprovadas.reduce((t, v) => t + (v.valor_centavos || 0), 0),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users',          getUsers);
router.post('/reset-monthly', triggerMonthlyReset);
router.get('/visits',         getVisits);
router.get('/analytics',      getAnalytics);
router.get('/vsl',            getVslRetencao);
router.get('/meta-funnel',    getMetaFunnel);
router.get('/meta-ads',       getMetaAds);

// ── Followup / Conversas por produto (Hubs /admin/hubs) — READ-ONLY ──────────────
// Rastreia a atividade dos agentes (Giovanna/Bia/Luma) em whatsapp_sessions, filtrada
// pelo(s) tipo(s) de sessão de cada produto. Alimenta a aba Followup (summary + fila)
// E a aba Conversas (threads). Só exibe — não dispara nem altera nada.
const HUB_FOLLOWUP_TIPOS: Record<string, string[]> = {
  limpapro:    ['recuperacao'],          // Bia (recuperação de checkout do curso)
  solardoc:    ['recovery', 'platform'], // Giovanna (abandono Pix + plataforma)
  solar:       ['gerador_followup'],     // follow-up de leads solar (Luma/gerador)
  eletroposto: [],                       // sem agente ainda
};
// Bloco de conversão da aba Followup: abordados → responderam → converteram.
// Cada produto tem um elo diferente pro "converteu" (e o SolarDoc tem DOIS tipos de
// sessão que significam coisas diferentes — por isso é uma LISTA de blocos, nunca uma
// taxa única misturando denominadores). Nada medível vira null (a tela mostra "—").
interface ConversaoBloco {
  rotulo: string;
  abordados: number;
  responderam: number;
  converteram: number | null;
  taxa_pct: number | null;
  receita: number | null;  // R$ que entrou por essas conversões (null = não dá pra somar)
  medida: string;          // o que exatamente conta como "converteu" aqui
  rotulo_conv: string;     // como chamar o convertido (nem todo bloco é "cliente")
}
// telKey: mesma chave do CRM/gerador (tira 55, DDD + últimos 8, ignora 9º dígito).
function hubTelKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
const last8 = (raw: string | null | undefined) => String(raw || '').replace(/\D/g, '').slice(-8);

router.get('/hub-followup', async (req: Request, res: Response): Promise<void> => {
  try {
    const produto = String(req.query.produto || '').toLowerCase();
    const tipos = HUB_FOLLOWUP_TIPOS[produto];
    if (!tipos) { res.status(400).json({ error: 'produto inválido' }); return; }
    const emptySummary = { total: 0, em_conversa: 0, handoff: 0, opt_out: 0, ultimas24h: 0, ultimos7d: 0 };
    if (tipos.length === 0) { res.json({ produto, tipos, summary: emptySummary, conversao: null, sessions: [] }); return; }

    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('phone, nome, tipo, user_id, messages, lead_data, updated_at')
      .in('tipo', tipos)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const now = Date.now();
    const D1 = 24 * 3600e3, D7 = 7 * D1;
    let em_conversa = 0, handoff = 0, opt_out = 0, ultimas24h = 0, ultimos7d = 0;

    const sessions = (data ?? []).map((s: {
      phone: string; nome: string | null; tipo: string; user_id: string | null;
      messages: unknown; lead_data: Record<string, unknown> | null; updated_at: string | null;
    }) => {
      const ld = (s.lead_data ?? {}) as Record<string, unknown>;
      const msgs = (Array.isArray(s.messages) ? s.messages : []) as { role?: string; content?: string }[];
      const temUser = msgs.some((m) => m?.role === 'user');
      const temAssist = msgs.some((m) => m?.role === 'assistant');
      const handed = Boolean(ld.handed_off) || Boolean(ld.human_takeover);
      const status = String(ld.status ?? '');
      const optout = status === 'perdido' || status === 'opted_out' || Boolean(ld.opted_out);
      const upMs = s.updated_at ? new Date(s.updated_at).getTime() : 0;

      if (temUser && temAssist) em_conversa++;
      if (handed) handoff++;
      if (optout) opt_out++;
      if (upMs && now - upMs < D1) ultimas24h++;
      if (upMs && now - upMs < D7) ultimos7d++;

      const last = msgs[msgs.length - 1];
      return {
        phone: s.phone, nome: s.nome ?? null, tipo: s.tipo, updated_at: s.updated_at,
        handed_off: handed, opt_out: optout, status: status || null,
        msgs_count: msgs.length,
        // preenchidos abaixo pelo bloco de conversão (null = não dá pra medir)
        respondeu: temUser,
        converteu: null as boolean | null,
        _uid: s.user_id ?? null,
        _email: String(ld.email ?? '').toLowerCase().trim(),
        _telkey: String(ld.tel_key ?? '') || hubTelKey(s.phone),
        _teste: s.phone === '5534991360223' || /(^|\W)teste\b/i.test(s.nome ?? ''),
        last_role: last?.role ?? null,
        last_msg: last?.content ? String(last.content).slice(0, 160) : null,
        messages: msgs.slice(-24).map((m) => ({ role: m?.role ?? '?', content: String(m?.content ?? '').slice(0, 800) })),
      };
    });

    // ── CONVERSÃO ────────────────────────────────────────────────────────────
    // Só conta convertido quem ESTÁ nas sessões carregadas acima (o mesmo recorte do
    // denominador), senão a taxa passa de 100%. Uma query em lote por bloco, sem N+1.
    const bloco = (rotulo: string, medida: string, alvo: typeof sessions, converteram: number | null, receita: number | null = null, rotulo_conv = 'Clientes que vieram'): ConversaoBloco => ({
      rotulo, medida, rotulo_conv,
      abordados: alvo.length,
      responderam: alvo.filter((x) => x.respondeu).length,
      converteram,
      taxa_pct: converteram === null || alvo.length === 0 ? null : Math.round((converteram / alvo.length) * 1000) / 10,
      receita: receita === null ? null : Math.round(receita * 100) / 100,
    });
    let conversao: ConversaoBloco[] | null = null;
    try {
      if (produto === 'limpapro') {
        // Espelha getLimpaproConversas (aba Funil): mesmo elo lead_data.email →
        // limpapro_events pago, mesma exclusão de teste. Os dois números têm que bater.
        const alvo = sessions.filter((x) => !x._teste);
        const emails = Array.from(new Set(alvo.map((x) => x._email).filter(Boolean)));
        const compradores = new Set<string>();
        const porEmail = new Map<string, { t: number; reais: number }>();   // e-mail → 1ª compra
        if (emails.length) {
          // O client do PostgREST NÃO lança em falha: devolve { data:null, error }. Sem o
          // throw, a query quebrada viraria "0 conversões" — mentira pior que "—".
          const { data: pagos, error: e } = await supabase
            .from('limpapro_events').select('buyer_email, created_at, amount_cents')
            .eq('event_type', 'purchase').eq('status', 'paid').in('buyer_email', emails);
          if (e) throw e;
          for (const p of (pagos ?? []) as { buyer_email: string | null; created_at: string | null; amount_cents: number | null }[]) {
            if (!p.buyer_email) continue;
            const k = p.buyer_email.toLowerCase().trim();
            compradores.add(k);
            // amount_cents é CENTAVOS e pode vir null (abandono puro não traz valor).
            // Guarda só a PRIMEIRA compra do e-mail: somar tudo colaria a escada de
            // mentoria (297/497/997) na conta da Bia. Aqui não há data de toque na
            // sessão, então é "a compra dessa pessoa", não "recuperado no mês".
            const t = p.created_at ? new Date(p.created_at).getTime() : Number.MAX_SAFE_INTEGER;
            const atual = porEmail.get(k);
            if (!atual || t < atual.t) porEmail.set(k, { t, reais: (Number(p.amount_cents) || 0) / 100 });
          }
        }
        for (const x of alvo) x.converteu = Boolean(x._email && compradores.has(x._email));
        const receita = alvo.filter((x) => x.converteu).reduce((s, x) => s + (porEmail.get(x._email)?.reais ?? 0), 0);
        conversao = [bloco('Recuperação (Bia)',
          'comprou o curso depois do toque (compra paga no mesmo e-mail). O R$ é a 1ª compra de cada cliente — a sessão não guarda a data do toque, então aqui não dá pra separar o que veio antes',
          alvo, alvo.filter((x) => x.converteu).length, receita)];
      } else if (produto === 'solardoc') {
        // DOIS blocos: abandono de checkout e plataforma medem coisas diferentes,
        // com denominadores diferentes. Misturar num % só dá um número inútil.
        const recovery = sessions.filter((x) => x.tipo === 'recovery');
        const platform = sessions.filter((x) => x.tipo === 'platform');
        const out: ConversaoBloco[] = [];

        // recovery: sessão não guarda e-mail; o elo é o telefone (últimos 8), igual ao
        // findAbandonoByPhone. Puxa uma janela recente e casa em memória.
        let recRecuperados: number | null = null;
        let recReceita: number | null = null;
        if (recovery.length) {
          // Filtra recovered no BANCO: a janela de 1000 é de recuperações, não de
          // abandonos (senão as recuperações antigas caem fora e a conta fica baixa).
          const { data: abandonos, error: e } = await supabase
            .from('abandoned_checkouts').select('phone, email, created_at')
            .eq('status', 'recovered')
            .order('created_at', { ascending: false }).limit(1000);
          if (e) throw e;
          const recuperados = new Map<string, { email: string; em: number }>();  // últimos 8 → e-mail + abandono
          for (const a of (abandonos ?? []) as { phone: string | null; email: string | null; created_at: string | null }[]) {
            const k = last8(a.phone);
            if (k.length !== 8) continue;
            recuperados.set(k, { email: (a.email ?? '').toLowerCase().trim(), em: a.created_at ? new Date(a.created_at).getTime() : 0 });
          }
          for (const x of recovery) x.converteu = recuperados.has(last8(x.phone));
          recRecuperados = recovery.filter((x) => x.converteu).length;

          // abandoned_checkouts não guarda valor: o R$ vem da venda de fato (sales.valor,
          // REAIS), casada pelo e-mail. UMA recuperação = UMA venda — pega a primeira
          // depois do abandono, nunca a soma: o checkout cria Customer novo a cada clique
          // e o mesmo e-mail tem 2-3 linhas em sales (o caso das assinaturas duplicadas).
          const alvos = recovery.filter((x) => x.converteu).map((x) => recuperados.get(last8(x.phone))!);
          const mails = Array.from(new Set(alvos.map((a) => a.email).filter(Boolean)));
          recReceita = 0;
          if (mails.length) {
            const { data: vendas, error: e2 } = await supabase
              .from('sales').select('email, valor, card_passed_at').in('email', mails).not('card_passed_at', 'is', null);
            if (e2) throw e2;
            const porMail = new Map<string, { t: number; v: number }[]>();
            for (const v of (vendas ?? []) as { email: string | null; valor: number | null; card_passed_at: string | null }[]) {
              const k = (v.email ?? '').toLowerCase().trim();
              const t = v.card_passed_at ? new Date(v.card_passed_at).getTime() : NaN;
              if (!k || !Number.isFinite(t)) continue;
              if (!porMail.has(k)) porMail.set(k, []);
              porMail.get(k)!.push({ t, v: Number(v.valor) || 0 });
            }
            for (const a of alvos) {
              const cand = (porMail.get(a.email) ?? []).filter((s) => s.t >= a.em).sort((p, q) => p.t - q.t)[0];
              recReceita += cand?.v ?? 0;
            }
          }
        }
        out.push(bloco('Abandono de checkout (Giovanna)', 'checkout marcado como recuperado (pagou depois do toque)', recovery, recRecuperados, recReceita));

        // platform: aqui o elo limpo é user_id (o phone do Z-API diverge de users.whatsapp).
        let platAtivos: number | null = null;
        const uids = Array.from(new Set(platform.map((x) => x._uid).filter(Boolean))) as string[];
        if (uids.length) {
          const { data: us, error: e } = await supabase
            .from('users').select('id, plano, billing_status, plano_expira_em').in('id', uids);
          if (e) throw e;
          const pagantes = new Set<string>();
          for (const u of (us ?? []) as { id: string; plano: string | null; billing_status: string | null; plano_expira_em: string | null }[]) {
            const pixVivo = Boolean(u.plano_expira_em && new Date(u.plano_expira_em).getTime() > now);
            if ((u.plano && u.plano !== 'free' && u.billing_status === 'active') || pixVivo) pagantes.add(u.id);
          }
          for (const x of platform) x.converteu = Boolean(x._uid && pagantes.has(x._uid));
          platAtivos = platform.filter((x) => x.converteu).length;
        }
        out.push(bloco('Plataforma (Giovanna)', 'conta voltou/segue pagante (plano ativo ou Pix na validade)', platform, platAtivos, null, 'Contas ativas'));
        conversao = out;
      } else if (produto === 'solar') {
        // Banco separado (supabaseGerador) — casa por tel_key. "Sucesso" = o mesmo que o
        // bot já considera resgate: proposta vendida, ou o lead esquentou/reagendou.
        const alvo = sessions;
        let convertidos: number | null = null;
        let receitaSolar: number | null = null;
        const chaves = new Set(alvo.map((x) => x._telkey).filter(Boolean) as string[]);
        if (chaves.size) {
          // Teto explícito (o PostgREST corta em 1000 calado — aqui um corte silencioso
          // viraria conversão errada exibida como fato).
          const [{ data: props, error: e1 }, { data: ags, error: e2 }] = await Promise.all([
            supabaseGerador.from('propostas').select('vendido, dados, valor_vendido').eq('vendido', true).limit(5000),
            supabaseGerador.from('agendamentos').select('cliente_telefone, status, temperatura, quando')
              .order('quando', { ascending: false }).limit(5000),
          ]);
          if (e1) throw e1;
          if (e2) throw e2;
          const ok = new Set<string>();
          const vendaPorTel = new Map<string, number>();   // telKey → R$ vendido
          for (const p of (props ?? []) as { vendido: boolean | null; dados: Record<string, unknown> | null; valor_vendido: number | null }[]) {
            if (!p.vendido) continue;
            const d = (p.dados ?? {}) as Record<string, unknown>;
            const k = hubTelKey(String(d.telefoneDigitos ?? d.telefone ?? ''));
            if (!k || !chaves.has(k)) continue;
            ok.add(k);
            // Padrão do /gerador: valor_vendido manda; sem ele, cai no preço à vista.
            const v = Number(p.valor_vendido != null ? p.valor_vendido : (d.precoVista ?? 0)) || 0;
            vendaPorTel.set(k, (vendaPorTel.get(k) ?? 0) + v);
          }
          for (const a of (ags ?? []) as { cliente_telefone: string | null; status: string | null; temperatura: string | null; quando: string | null }[]) {
            const k = hubTelKey(a.cliente_telefone);
            if (!k || !chaves.has(k)) continue;
            const futuro = a.quando ? new Date(a.quando).getTime() >= now : false;
            if (a.temperatura || a.status === 'falando_whatsapp' || futuro) ok.add(k);
          }
          for (const x of alvo) x.converteu = Boolean(x._telkey && ok.has(x._telkey));
          convertidos = alvo.filter((x) => x.converteu).length;
          // Só a VENDA tem valor: quem só esquentou/reagendou conta como conversão mas
          // ainda não é dinheiro — por isso o R$ costuma vir de menos gente que o contador.
          receitaSolar = alvo.filter((x) => x.converteu).reduce((s, x) => s + (vendaPorTel.get(x._telkey ?? '') ?? 0), 0);
        }
        conversao = [bloco('Reengajamento de leads (Luma)',
          'venda fechada, ou o lead esquentou/reagendou depois do toque — só a VENDA tem valor, então a grana vem de menos gente que o contador',
          alvo, convertidos, receitaSolar, 'Leads resgatados')];
      }
    } catch (e) {
      conversao = null;   // não dá pra medir agora → a tela mostra "—", nunca 0
      console.error('hub-followup conversao:', (e as Error)?.message || e);
    }

    res.json({
      produto, tipos,
      summary: { total: sessions.length, em_conversa, handoff, opt_out, ultimas24h, ultimos7d },
      conversao,
      sessions: sessions.slice(0, 60).map(({ _uid, _email, _telkey, _teste, ...s }) => {
        void _uid; void _email; void _telkey; void _teste;
        return s;
      }),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Followup: conversão HISTÓRICA por mês (Hubs) — READ-ONLY ──────────────────
// Endpoint separado de propósito: /hub-followup também alimenta Conversas e Visão
// Geral, e essa varredura de marcadores/cross-db é cara demais pra pendurar nelas.
//
// Por que NÃO sai de whatsapp_sessions: a sessão não tem created_at e o updated_at é
// sobrescrito a cada toque — não guarda quando a pessoa foi abordada. O denominador
// datado vem de onde o bot carimbou a abordagem:
//   LimpaPro → system_state 'limpapro_recovery:<email>' .contacted_at
//   SolarDoc → abandoned_checkouts.created_at (+ recovery_attempts > 0)
//   Solar    → system_state 'gerador_followup:<telKey>' .contacted_at
// RESSALVA que vai escrita na tela: os marcadores são estado de cooldown (upsert por
// chave), então guardam a ÚLTIMA abordagem, não a primeira. Só o bloco do SolarDoc tem
// coorte imutável (a data do abandono não muda).
interface MesConversao { mes: string; abordados: number; converteram: number; taxa_pct: number | null; receita: number; }
interface HistoricoBloco {
  rotulo: string;
  base: string;      // de onde sai o denominador (pra explicar divergência com o funil de cima)
  medida: string;    // o que conta como converteu
  meses: MesConversao[];
  total: MesConversao | null;
  nao_medivel: string | null;   // motivo, quando não dá pra montar série
}
// Mês no fuso de São Paulo (mesmo padrão do gráfico de leads por origem).
// Pede a data COMPLETA e corta: só o padrão y-m-d do en-CA é garantido. Pedir ano+mês
// sozinhos deixa o ICU escolher o formato (pode vir '08/2026' em outro runtime).
const fmtMesSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function mesSP(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return fmtMesSP.format(new Date(t)).slice(0, 7);   // 'YYYY-MM'
}
function montarMeses(linhas: { mes: string; converteu: boolean; valor?: number }[]): { meses: MesConversao[]; total: MesConversao | null } {
  const por = new Map<string, { a: number; c: number; r: number }>();
  for (const l of linhas) {
    const cur = por.get(l.mes) ?? { a: 0, c: 0, r: 0 };
    cur.a++; if (l.converteu) { cur.c++; cur.r += l.valor ?? 0; }
    por.set(l.mes, cur);
  }
  const taxa = (c: number, a: number) => (a === 0 ? null : Math.round((c / a) * 1000) / 10);
  const cent = (v: number) => Math.round(v * 100) / 100;
  const meses = Array.from(por.entries())
    .sort((x, y) => (x[0] < y[0] ? 1 : -1))          // mais recente primeiro
    .map(([mes, v]) => ({ mes, abordados: v.a, converteram: v.c, taxa_pct: taxa(v.c, v.a), receita: cent(v.r) }));
  const a = linhas.length;
  const conv = linhas.filter((l) => l.converteu);
  const r = conv.reduce((s, l) => s + (l.valor ?? 0), 0);
  return { meses, total: a ? { mes: 'total', abordados: a, converteram: conv.length, taxa_pct: taxa(conv.length, a), receita: cent(r) } : null };
}
const LIMITE_HIST = 5000;   // teto explícito: o corte mudo de 1000 do PostgREST apagaria os meses antigos

router.get('/hub-followup-historico', async (req: Request, res: Response): Promise<void> => {
  try {
    const produto = String(req.query.produto || '').toLowerCase();
    if (!HUB_FOLLOWUP_TIPOS[produto]) { res.status(400).json({ error: 'produto inválido' }); return; }
    const blocos: HistoricoBloco[] = [];

    if (produto === 'limpapro') {
      const { data: marks, error: e1 } = await supabase
        .from('system_state').select('key, value')
        .like('key', 'limpapro_recovery:%').limit(LIMITE_HIST);
      if (e1) throw e1;
      // Filtro do JSON em JS de propósito: operador-seta em .filter() é sintaxe não
      // exercitada no repo e falha calada (mesma razão do consumidor da Bia).
      const brutas = ((marks ?? []) as { key: string; value: Record<string, unknown> | null }[])
        .map((r) => ({
          email: r.key.slice('limpapro_recovery:'.length).toLowerCase().trim(),
          em: String(r.value?.contacted_at ?? ''),
        }))
        .filter((x) => x.email && x.em);

      // O fluxo ANTIGO de recuperação (jun→08/jul) vive noutra tabela e nunca teve
      // marcador. Sem ele o balão esconde junho inteiro. Entra pelo mesmo funil.
      const { data: velhos, error: eV } = await supabase
        .from('limpapro_abandonos').select('email, abandonado_em, created_at, msgs_enviadas')
        .gt('msgs_enviadas', 0).limit(LIMITE_HIST);
      if (eV) throw eV;
      for (const v of (velhos ?? []) as { email: string | null; abandonado_em: string | null; created_at: string | null }[]) {
        const email = (v.email ?? '').toLowerCase().trim();
        const em = v.abandonado_em ?? v.created_at ?? '';
        if (email && em) brutas.push({ email, em });
      }

      // Uma pessoa tocada nas duas eras é UMA pessoa: fica o toque mais antigo.
      const porPessoa = new Map<string, string>();
      for (const x of brutas) {
        const atual = porPessoa.get(x.email);
        if (!atual || new Date(x.em).getTime() < new Date(atual).getTime()) porPessoa.set(x.email, x.em);
      }
      const abordagens = Array.from(porPessoa, ([email, em]) => ({ email, em }));

      const compras = new Map<string, { t: number; reais: number }[]>();   // email → compras pagas
      const emails = Array.from(new Set(abordagens.map((x) => x.email)));
      for (let i = 0; i < emails.length; i += 300) {          // lotes: in-list gigante estoura a URL
        const { data: pagos, error } = await supabase
          .from('limpapro_events').select('buyer_email, created_at, amount_cents')
          .eq('event_type', 'purchase').eq('status', 'paid')
          .in('buyer_email', emails.slice(i, i + 300));
        if (error) throw error;
        for (const p of (pagos ?? []) as { buyer_email: string | null; created_at: string | null; amount_cents: number | null }[]) {
          const k = (p.buyer_email ?? '').toLowerCase().trim();
          const t = p.created_at ? new Date(p.created_at).getTime() : NaN;
          if (!k || !Number.isFinite(t)) continue;
          if (!compras.has(k)) compras.set(k, []);
          compras.get(k)!.push({ t, reais: (Number(p.amount_cents) || 0) / 100 });
        }
      }
      const linhas = abordagens.flatMap((x) => {
        const mes = mesSP(x.em); if (!mes) return [];
        // Compra ANTERIOR ao toque não é conversão do followup — é venda que já existia.
        // Só a PRIMEIRA compra depois do toque é a recuperação: mentoria (297/497/997) e
        // grupo comprados depois são outra história, não crédito da Bia.
        const depois = (compras.get(x.email) ?? []).filter((c) => c.t >= new Date(x.em).getTime()).sort((p, q) => p.t - q.t);
        return [{ mes, converteu: depois.length > 0, valor: depois[0]?.reais ?? 0 }];
      });
      blocos.push({
        rotulo: 'Recuperação (Bia)',
        base: 'todo mundo que a recuperação tocou — Bia (marcador) + fluxo antigo de jun/jul, uma linha por pessoa',
        medida: 'comprou o curso DEPOIS do toque (mesmo e-mail)',
        nao_medivel: null, ...montarMeses(linhas),
      });
    } else if (produto === 'solardoc') {
      // Coorte imutável: o mês é o do ABANDONO, que nunca muda (ao contrário de
      // recovery_sent_at, reescrito a cada toque). Uma tabela, uma query.
      const { data: ab, error } = await supabase
        .from('abandoned_checkouts').select('created_at, status, email')
        .gt('recovery_attempts', 0)
        .order('created_at', { ascending: false }).limit(LIMITE_HIST);
      if (error) throw error;
      const linhasAb = (ab ?? []) as { created_at: string | null; status: string | null; email: string | null }[];

      // O R$ não está em abandoned_checkouts: vem da venda de fato (sales.valor, REAIS),
      // casada pelo e-mail, só com cartão aprovado.
      // UMA recuperação = UMA venda: pega a 1ª venda depois do abandono, nunca a soma
      // (o mesmo e-mail tem várias linhas em sales — assinaturas duplicadas por clique).
      const vendaPorEmail = new Map<string, { t: number; v: number }[]>();
      const mails = Array.from(new Set(linhasAb.filter((r) => r.status === 'recovered')
        .map((r) => (r.email ?? '').toLowerCase().trim()).filter(Boolean)));
      for (let i = 0; i < mails.length; i += 300) {
        const { data: vendas, error: e2 } = await supabase
          .from('sales').select('email, valor, card_passed_at').in('email', mails.slice(i, i + 300)).not('card_passed_at', 'is', null);
        if (e2) throw e2;
        for (const v of (vendas ?? []) as { email: string | null; valor: number | null; card_passed_at: string | null }[]) {
          const k = (v.email ?? '').toLowerCase().trim();
          const t = v.card_passed_at ? new Date(v.card_passed_at).getTime() : NaN;
          if (!k || !Number.isFinite(t)) continue;
          if (!vendaPorEmail.has(k)) vendaPorEmail.set(k, []);
          vendaPorEmail.get(k)!.push({ t, v: Number(v.valor) || 0 });
        }
      }
      const linhas = linhasAb.flatMap((r) => {
        const mes = mesSP(r.created_at); if (!mes) return [];
        if (r.status !== 'recovered') return [{ mes, converteu: false, valor: 0 }];
        const em = r.created_at ? new Date(r.created_at).getTime() : 0;
        const k = (r.email ?? '').toLowerCase().trim();
        const cand = (vendaPorEmail.get(k) ?? []).filter((s) => s.t >= em).sort((p, q) => p.t - q.t)[0];
        return [{ mes, converteu: true, valor: cand?.v ?? 0 }];
      });
      blocos.push({
        rotulo: 'Abandono de checkout (Giovanna)',
        base: 'checkouts abandonados que receberam pelo menos um toque (mês do abandono; inclui a cadência de e-mail, não só a Giovanna)',
        medida: 'checkout marcado como recuperado — R$ da venda de fato (sales)',
        nao_medivel: null, ...montarMeses(linhas),
      });
      blocos.push({
        rotulo: 'Plataforma (Giovanna)',
        base: '—', medida: 'conta voltou/segue pagante',
        meses: [], total: null,
        nao_medivel: 'A conversa da plataforma não carimba data de abordagem em lugar nenhum — só dá pra ver o agora, no funil acima.',
      });
    } else if (produto === 'solar') {
      const { data: marks, error: e1 } = await supabase
        .from('system_state').select('key, value')
        .like('key', 'gerador_followup:%').limit(LIMITE_HIST);
      if (e1) throw e1;
      const abordagens = ((marks ?? []) as { key: string; value: Record<string, unknown> | null }[])
        .map((r) => ({ tk: r.key.slice('gerador_followup:'.length), em: String(r.value?.contacted_at ?? '') }))
        .filter((x) => x.tk && x.em && !x.tk.startsWith('pending:'));

      // Só VENDA entra no histórico: temperatura e 'falando_whatsapp' não têm data, então
      // não dá pra saber se vieram depois do toque. O funil de cima conta mais que isto.
      const { data: props, error: e2 } = await supabaseGerador
        .from('propostas').select('dados, created_at, valor_vendido').eq('vendido', true).limit(LIMITE_HIST);
      if (e2) throw e2;
      const vendas = new Map<string, { t: number; reais: number }[]>();
      for (const p of (props ?? []) as { dados: Record<string, unknown> | null; created_at: string | null; valor_vendido: number | null }[]) {
        const d = (p.dados ?? {}) as Record<string, unknown>;
        const k = hubTelKey(String(d.telefoneDigitos ?? d.telefone ?? ''));
        const t = p.created_at ? new Date(p.created_at).getTime() : NaN;
        if (!k || !Number.isFinite(t)) continue;
        if (!vendas.has(k)) vendas.set(k, []);
        vendas.get(k)!.push({ t, reais: Number(p.valor_vendido != null ? p.valor_vendido : (d.precoVista ?? 0)) || 0 });
      }
      const linhas = abordagens.flatMap((x) => {
        const mes = mesSP(x.em); if (!mes) return [];
        const depois = (vendas.get(x.tk) ?? []).filter((v) => v.t >= new Date(x.em).getTime()).sort((p, q) => p.t - q.t);
        return [{ mes, converteu: depois.length > 0, valor: depois[0]?.reais ?? 0 }];
      });
      blocos.push({
        rotulo: 'Reengajamento de leads (Luma)',
        base: 'marcador de abordagem do bot (guarda a ÚLTIMA abordagem de cada telefone)',
        medida: 'proposta vendida DEPOIS do toque (só a venda tem data — o funil acima conta mais)',
        nao_medivel: null, ...montarMeses(linhas),
      });
    }

    res.json({ produto, blocos: blocos.length ? blocos : null });
  } catch (err) {
    console.error('hub-followup-historico:', (err as Error)?.message || err);
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Config & Alertas por produto (Hubs) — READ-ONLY ────────────────────────────
// Mostra o ESTADO dos kill-switches (liga/desliga por env) + saúde básica. NÃO
// escreve flag nenhuma (togglar pagamento ao vivo é mudança manual de env, de
// propósito fora da tela). Só expõe o nome do flag + on/off, nunca segredos.
function featAtivo(name: string, opts: { defaultOn: boolean; inverted?: boolean }): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  const set = v === 'true' || v === '1' ? true : (v === 'false' || v === '0' ? false : null);
  const base = set === null ? opts.defaultOn : set;
  return opts.inverted ? !base : base; // flag "..._OFF"=true → feature desligada
}
interface HubFlag { label: string; ativo: boolean; detalhe: string; }
interface HubSaude { item: string; ok: boolean; detalhe: string; }
const HUB_CONFIG: Record<string, () => { flags: HubFlag[]; saude: HubSaude[] }> = {
  solardoc: () => ({
    flags: [
      { label: 'Auto-liberar Pix por comprovante', ativo: featAtivo('PIX_AUTO_LIBERAR', { defaultOn: true }), detalhe: 'PIX_AUTO_LIBERAR (padrão ligado)' },
      { label: 'Cobrança mensal por Pix', ativo: featAtivo('PIX_MENSAL_OFF', { defaultOn: true, inverted: true }), detalhe: 'PIX_MENSAL_OFF' },
      { label: 'Enviar vendas p/ UTMify', ativo: featAtivo('UTMIFY_ORDERS_OFF', { defaultOn: true, inverted: true }) && Boolean(process.env.UTMIFY_API_TOKEN), detalhe: 'UTMIFY_ORDERS_OFF + token' },
    ],
    saude: [{ item: 'Stripe configurado', ok: Boolean(process.env.STRIPE_SECRET_KEY), detalhe: 'STRIPE_SECRET_KEY' }],
  }),
  limpapro: () => ({
    flags: [],
    saude: [{ item: 'Linha IO (WhatsApp) configurada', ok: Boolean(process.env.ZAPI_INSTANCE_ID_IO), detalhe: 'ZAPI_INSTANCE_ID_IO' }],
  }),
  solar: () => ({
    flags: [
      { label: 'Follow-up de leads solar', ativo: featAtivo('GERADOR_FOLLOWUP_ENABLED', { defaultOn: false }), detalhe: 'GERADOR_FOLLOWUP_ENABLED (padrão desligado)' },
      { label: 'Alerta lead quente sem proposta', ativo: featAtivo('ALERTA_LEAD_QUENTE_ENABLED', { defaultOn: false }), detalhe: 'ALERTA_LEAD_QUENTE_ENABLED' },
    ],
    saude: [{ item: 'Linha IO (WhatsApp) configurada', ok: Boolean(process.env.ZAPI_INSTANCE_ID_IO), detalhe: 'ZAPI_INSTANCE_ID_IO' }],
  }),
  eletroposto: () => ({
    flags: [],
    saude: [{ item: 'Linha IO (WhatsApp) configurada', ok: Boolean(process.env.ZAPI_INSTANCE_ID_IO), detalhe: 'ZAPI_INSTANCE_ID_IO' }],
  }),
};
router.get('/hub-config', (req: Request, res: Response): void => {
  const produto = String(req.query.produto || '').toLowerCase();
  const fn = HUB_CONFIG[produto];
  if (!fn) { res.status(400).json({ error: 'produto inválido' }); return; }
  res.json({ produto, readonly: true, ...fn() });
});

// ── Funil + Leads por produto do Gerador (Solar / Eletroposto) — READ-ONLY ───────
// Lê agendamentos (supabaseGerador) filtrando por created_by e devolve funil por
// status + lista de leads recentes. Alimenta as abas Funil e Membros/Leads.
// created_by que compõem cada PRODUTO (mesmo agrupamento do "Leads por Origem"):
// Solar = Meta Lead Ads + LP solar + organic; Eletroposto = LP EP + tráfego + organic.
const HUB_GERADOR_CB: Record<string, string[]> = {
  solar:       ['lead-meta', 'leads-meta', 'lp_solar', 'manychat', 'prosp_solar'],
  eletroposto: ['lp_eletroposto', 'ep-trafego', 'manychat_eletroposto', 'prosp_eletroposto'],
};
router.get('/hub-gerador', async (req: Request, res: Response): Promise<void> => {
  try {
    const produto = String(req.query.produto || '').toLowerCase();
    const cbs = HUB_GERADOR_CB[produto];
    if (!cbs) { res.status(400).json({ error: 'produto inválido' }); return; }
    const { data, error } = await supabaseGerador
      .from('agendamentos')
      .select('cliente_nome, cliente_telefone, cidade, status, temperatura, quando, vendedor_nome, created_at')
      .in('created_by', cbs)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      cliente_nome: string | null; cliente_telefone: string | null; cidade: string | null;
      status: string | null; temperatura: string | null; quando: string | null;
      vendedor_nome: string | null; created_at: string | null;
    }>;
    const porStatus: Record<string, number> = {};
    let comTemp = 0;
    for (const r of rows) {
      const st = String(r.status ?? '—');
      porStatus[st] = (porStatus[st] || 0) + 1;
      if (r.temperatura) comTemp++;
    }
    const leads = rows.slice(0, 60).map((r) => ({
      nome: r.cliente_nome, telefone: r.cliente_telefone, cidade: r.cidade,
      status: r.status, temperatura: r.temperatura, quando: r.quando,
      consultor: r.vendedor_nome, created_at: r.created_at,
    }));
    res.json({ produto, total: rows.length, por_status: porStatus, com_temperatura: comTemp, leads });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Funil do Kit de Fechamento (isca R$27 → plataforma) — READ-ONLY ─────────────
// Mede a régua que decide a operação: quantos cliques viram compra, quantos
// compradores criam conta e quantos viram assinante pagante. Visitas vêm de
// page_visits (beacon da LP /kit), vendas de kit_pedidos.
router.get('/kit-funil', async (_req: Request, res: Response): Promise<void> => {
  try {
    const desde = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [visitasQ, pedidosQ] = await Promise.all([
      supabase
        .from('page_visits')
        .select('session_id, utm_source, utm_campaign, created_at')
        .gte('created_at', desde)
        .like('landing_url', '%/kit%'),
      supabase
        .from('kit_pedidos')
        .select('email, nome, produto, itens, bump_vip, bump_aplicado, segmento, checkout_link, valor, status, user_id, conta_criada, trial_vip_ate, utm_campaign, criado_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false }),
    ]);

    const visitas = (visitasQ.data ?? []) as Array<{ session_id: string | null }>;
    const pedidos = (pedidosQ.data ?? []) as Array<{
      email: string; nome: string | null; produto: string; itens: string[];
      bump_vip: boolean; bump_aplicado: boolean | null; segmento: string | null;
      checkout_link: string | null;
      valor: number; status: string; user_id: string | null;
      conta_criada: boolean; trial_vip_ate: string | null; utm_campaign: string | null; criado_em: string;
    }>;

    // segmento 'assinatura' NÃO é venda: é a concessão do curso a quem entrou
    // pela oferta vip_curso (concederCursoPorAssinatura). Elas moram em
    // kit_pedidos porque o acesso ao curso é lido de lá, mas contá-las aqui
    // inflaria os compradores da isca e derrubaria a conversão da LP /kit —
    // dinheiro que na verdade entrou como assinatura recorrente na Stripe.
    const pagos = pedidos.filter((p) => p.status === 'paid' && p.segmento !== 'assinatura');
    const compradores = new Set(pagos.filter((p) => (p.itens || []).includes('kit')).map((p) => p.email.toLowerCase()));
    // O bump só conta quando o MESMO comprador está na janela. Sem isso a taxa
    // passa de 100%: um bump pago dentro dos 30 dias cujo pedido principal ficou
    // fora entrava no numerador sem entrar no denominador.
    const comBump = new Set(
      pagos.filter((p) => p.bump_vip)
        .map((p) => p.email.toLowerCase())
        .filter((e) => compradores.has(e)),
    );
    // Bump cobrado de quem já era assinante: pagou e não recebeu nada. Vira fila
    // de reembolso, não métrica de sucesso.
    const bumpSemEntrega = pagos
      .filter((p) => p.bump_vip && p.bump_aplicado === false)
      .map((p) => p.email.toLowerCase());
    const pendentes = pedidos.filter((p) => p.status === 'waiting_payment');

    // Segmentos, sempre em PESSOAS (e-mails distintos) — a mesma unidade do
    // resto do funil. Pedido antigo (anterior ao carimbo) cai em 'direto'.
    const porSegmento = { lp: new Set<string>(), membro: new Set<string>(), direto: new Set<string>() };
    for (const p of pagos) {
      const chave = (p.segmento === 'membro' ? 'membro' : p.segmento === 'lp' ? 'lp' : 'direto') as keyof typeof porSegmento;
      porSegmento[chave].add(p.email.toLowerCase());
    }

    // Quantos compradores já viram assinante pagante de verdade. Concessão não é
    // receita — e ela chega por DUAS colunas diferentes no user:
    //   - bump legado (bump_vip)      → pack_trial_until
    //   - entrada de 30 dias (R$19)   → plano_expira_em
    // A segunda é indistinguível de um assinante Pix olhando só a tabela users.
    // Quem separa é o PEDIDO: kit_pedidos.trial_vip_ate no futuro = acesso que veio
    // da compra do bump, não de assinatura. Sem isto, todo comprador da entrada
    // entraria como assinante e inflaria a conversão do funil da isca.
    const comConcessaoAtiva = new Set(
      pedidos
        .filter((p) => p.status === 'paid' && p.trial_vip_ate && new Date(p.trial_vip_ate) > new Date())
        .map((p) => p.email.toLowerCase()),
    );
    let assinantes = 0;
    if (compradores.size) {
      const { data: users } = await supabase
        .from('users')
        .select('email, plano, pack_trial_until, billing_status')
        .in('email', Array.from(compradores));
      assinantes = (users ?? []).filter((u: { email: string; plano: string; pack_trial_until: string | null }) => {
        const trialAtivo = !!u.pack_trial_until && new Date(u.pack_trial_until) > new Date();
        const concessaoAtiva = comConcessaoAtiva.has(u.email.toLowerCase());
        return (u.plano === 'pro' || u.plano === 'ilimitado') && !trialAtivo && !concessaoAtiva;
      }).length;
    }

    const receita = pagos.reduce((s, p) => s + Number(p.valor || 0), 0);
    const sessoes = new Set(visitas.map((v) => v.session_id).filter(Boolean)).size;

    res.json({
      periodo: '30d',
      visitas: visitas.length,
      sessoes,
      compradores: compradores.size,
      bump_vip: comBump.size,
      bump_sem_entrega: bumpSemEntrega.length,
      bump_sem_entrega_emails: bumpSemEntrega.slice(0, 20),
      // PESSOAS com conta criada pela compra — antes contava PEDIDOS pagos, o que
      // misturava unidades com 'compradores' e inflava o funil de quem levou bump
      // (bump vem em pedido separado, então a mesma pessoa contava duas vezes).
      contas_criadas: new Set(pagos.filter((p) => p.conta_criada).map((p) => p.email.toLowerCase())).size,
      segmentos: {
        lp: porSegmento.lp.size,
        membro: porSegmento.membro.size,
        direto: porSegmento.direto.size,
      },
      assinantes,
      pix_pendente: pendentes.length,
      receita,
      // As duas taxas que decidem se a isca escala.
      conv_visita_compra: sessoes ? +((compradores.size / sessoes) * 100).toFixed(2) : null,
      conv_comprador_assinante: compradores.size ? +((assinantes / compradores.size) * 100).toFixed(1) : null,
      take_rate_bump: compradores.size ? +((comBump.size / compradores.size) * 100).toFixed(1) : null,
      pedidos: pedidos.slice(0, 60),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Funil do NOTA 1 (recusado na LP → página de material) — READ-ONLY ────────
// A pergunta que este endpoint responde é uma só: de quem a LP do eletroposto
// recusa, quantos chegam na oferta de entrada?
//
// São DOIS BANCOS que não se conversam. Quem foi MANDADO mora em
// `eletroposto_nota1` (gerador-propostas); quem CHEGOU mora em `pc_eventos`
// (solardoc-pro). Não existe chave em comum — o evento carrega session_id do
// navegador, a ficha carrega telefone. Então isto é COMPARAÇÃO DE CONTAGEM, não
// join: serve pra ver buraco no caminho, nunca pra dizer que o fulano X chegou.
//
// O `motivo` do payload é o que separa o nota 1 de quem entrou por fora: ele é
// escrito pela LP no sessionStorage no instante da recusa, então `neutro` = veio
// por link direto, anúncio do curso ou aba nova. Sem essa divisão o painel
// somaria as 21 visitas do lançamento do curso (08/08) como se fossem recusados.
//
// A CONTA em si mora em services/io/nota1Funil.ts, com teste — aqui só se lê
// banco e se devolve JSON.
router.get('/nota1-funil', async (req: Request, res: Response): Promise<void> => {
  try {
    const dias = Math.min(180, Math.max(7, Number(req.query.dias) || 30));
    const desde = inicioDaJanela(dias);

    const [fichasQ, eventosQ, comprasQ] = await Promise.all([
      supabaseGerador
        .from('eletroposto_nota1')
        .select('created_at, nome, telefone, cidade, pts, motivo_descarte, origem')
        // Só quem foi recusado PELA LP. Desde 19/08 a tabela guarda também o lead
        // que veio da DM do Instagram (origem `instagram_dm`) e nunca abriu a
        // página — contá-lo como "mandado" faria a conversão desta tela despencar
        // por gente que nunca esteve no funil que ela mede.
        .eq('origem', 'lp_eletroposto')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }),
      supabase
        .from('pc_eventos')
        .select('tipo, session_id, payload, created_at')
        .in('tipo', NOTA1_TIPOS)
        .gte('created_at', desde),
      supabase
        .from('pc_compras')
        .select('created_at, nome, email, item_slug, valor_centavos, status')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }),
    ]);

    const fichas = (fichasQ.data ?? []) as Array<{
      created_at: string; nome: string | null; telefone: string | null;
      cidade: string | null; pts: number | null; motivo_descarte: string[] | null; origem: string | null;
    }>;
    const eventos = (eventosQ.data ?? []) as Array<{
      tipo: string; session_id: string | null; payload: { motivo?: string } | null; created_at: string;
    }>;
    const compras = (comprasQ.data ?? []) as Array<{
      created_at: string; nome: string | null; email: string | null;
      item_slug: string | null; valor_centavos: number | null; status: string | null;
    }>;

    const linhas = linhasDoFunil(fichas, eventos, compras);
    const soma = (k: Parameters<typeof somaColuna>[1]): number => somaColuna(linhas, k);

    const mandados = soma('mandados');
    const chegaram = soma('chegaram');
    const furados = linhas.filter((l) => l.medicao_furada).map((l) => l.dia);

    res.json({
      desde,
      dias,
      piso: NOTA1_MATERIAL_DESDE,
      // O painel usa isto pra saber que está olhando um funil ENCERRADO: desde
      // 17/08 o nota 1 vai pras duas portas, não pra página de material. Sem
      // este teto a conversão cairia pra zero sozinha e o card acusaria defeito
      // num caminho que foi desligado de propósito.
      teto: NOTA1_MATERIAL_ATE,
      encerrado: new Date().toISOString().slice(0, 10) > NOTA1_MATERIAL_ATE,
      mandados,
      chegaram,
      chegaram_fora: soma('chegaram_fora'),
      rolaram: soma('rolaram'),
      checkout: soma('checkout'),
      checkout_fora: soma('checkout_fora'),
      voltaram: soma('voltaram'),
      compras: soma('compras'),
      // O total é o número pra olhar; a linha do dia serve pra achar buraco.
      conv_mandado_chegou: mandados ? +((chegaram / mandados) * 100).toFixed(1) : null,
      conv_chegou_checkout: chegaram ? +((soma('checkout') / chegaram) * 100).toFixed(1) : null,
      dias_sem_medicao: furados,
      linhas,
      fichas: fichas.slice(0, 60).map((f) => ({
        quando: f.created_at, nome: f.nome, telefone: f.telefone, cidade: f.cidade,
        pts: f.pts, motivos: f.motivo_descarte ?? [], origem: f.origem,
      })),
      // Compra não carrega o carimbo do nota 1 (o gateway não sabe de onde a
      // pessoa veio), então esta lista é da PÁGINA inteira. Não é o fundo do
      // funil do nota 1 — é o fundo do funil da oferta.
      vendas: compras.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Conexão Eletroposto: os dois lados, lado a lado — READ-ONLY ─────────────
// Quem tem o ponto e quem tem o capital, na mesma tela, pra alguém fazer o
// casamento na mão. NÃO existe algoritmo aqui de propósito: o que aproxima os
// dois é a cidade, e cidade igual não quer dizer ponto compatível — quem decide
// isso é o especialista olhando o endereço.
//
// O lado CAPITAL vem de duas origens que a tela precisa distinguir:
//   · `eletroposto_parceria` — se cadastrou na página das portas
//   · `eletroposto_nota1`    — declarou recurso no formulário e nunca clicou
// O segundo grupo é maior e mais frio: ninguém falou com ele desde a recusa.
router.get('/eletroposto-parceria', async (_req: Request, res: Response): Promise<void> => {
  try {
    const CAPITAL_DECLARADO = ['proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj'];
    const [parceriaQ, nota1Q] = await Promise.all([
      supabaseGerador
        .from('eletroposto_parceria')
        .select('id, created_at, lado, nome, telefone, cidade, capital_faixa, capital_origem, prazo, ponto_relacao, ponto_tipo, ponto_endereco, ponto_vagas, ponto_fluxo, ponto_energia, obs, origem, status, par_id, par_em')
        // Esta tela é o CASAMENTO — só os dois lados que se casam. O integrador
        // (21/08) mora na mesma tabela e não tem contraparte: sem este filtro
        // ele não apareceria em lugar nenhum aqui e ainda comeria o teto de 400,
        // empurrando investidor de verdade pra fora da tela em silêncio.
        .in('lado', ['capital', 'ponto'])
        .order('created_at', { ascending: false })
        .limit(400),
      supabaseGerador
        .from('eletroposto_nota1')
        .select('id, created_at, nome, telefone, cidade, invest, capital_faixa, pts, lado')
        .in('capital_faixa', CAPITAL_DECLARADO)
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    const linhas = (parceriaQ.data ?? []) as Array<Record<string, unknown>>;
    const pontos = linhas.filter((l) => l.lado === 'ponto');
    const capitalCadastrado = linhas.filter((l) => l.lado === 'capital');
    const jaCadastrados = new Set(capitalCadastrado.map((l) => String(l.telefone)));

    // Ficha de NOTA 1 que já virou cadastro na página não aparece duas vezes.
    const capitalDaFicha = ((nota1Q.data ?? []) as Array<Record<string, unknown>>)
      .filter((f) => !jaCadastrados.has(String(f.telefone)));

    // Cidade normalizada (sem acento, sem UF) só pra agrupar quem está perto.
    const chaveCidade = (c: unknown): string =>
      String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().split(/[,/-]/)[0].trim();

    const porCidade: Record<string, { pontos: number; capital: number }> = {};
    const conta = (lista: Array<Record<string, unknown>>, campo: 'pontos' | 'capital') => {
      for (const l of lista) {
        const k = chaveCidade(l.cidade);
        if (!k) continue;
        porCidade[k] = porCidade[k] || { pontos: 0, capital: 0 };
        porCidade[k][campo]++;
      }
    };
    conta(pontos, 'pontos');
    conta([...capitalCadastrado, ...capitalDaFicha], 'capital');

    res.json({
      pontos,
      capital_cadastrado: capitalCadastrado,
      capital_da_ficha: capitalDaFicha,
      // Cidade com os DOIS lados presentes: é onde uma apresentação pode sair hoje.
      cidades_com_par: Object.entries(porCidade)
        .filter(([, v]) => v.pontos > 0 && v.capital > 0)
        .map(([cidade, v]) => ({ cidade, ...v }))
        .sort((a, b) => b.pontos + b.capital - (a.pontos + a.capital)),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Funil do Ponto Certo: quem tem o dinheiro e não tem o lugar ────────────
// Desde 01/09/2026 o investidor recusado pela régua não para mais na tela de
// "cadastro recebido": ele é levado pra landing do material que ensina a achar
// o ponto. Esta rota mede esse caminho inteiro.
//
// Lê os DOIS projetos: as fichas e os cadastros moram no gerador, as sessões e
// as vendas moram no SolarDoc. Não existe chave entre eles — por isso cada
// etapa vem como total próprio, e a conversão entre elas está marcada como
// estimativa na tela.
router.get('/ponto-certo-funil', async (req: Request, res: Response): Promise<void> => {
  try {
    const dias = Math.min(180, Math.max(7, Number(req.query.dias) || 30));
    const desde = pc.inicioDaJanela(dias);

    const [fichasQ, cadastrosQ, filaQ, eventosQ, vendasQ, todasFichasQ, agendaQ] = await Promise.all([
      supabaseGerador
        .from('eletroposto_nota1')
        .select('created_at, nome, telefone, cidade, origem, capital_faixa, tem_ponto, lado, lado_em, motivo_descarte')
        // Só quem passou pela LP. O lead que veio da DM do Instagram entra nesta
        // mesma tabela sem `capital_faixa` (o serviço do ManyChat grava a faixa
        // só como texto na ficha), então ele nunca conta como investidor aqui —
        // e contá-lo como "mandado" afundaria a conversão com gente que nunca
        // viu o formulário.
        .eq('origem', 'lp_eletroposto')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }),
      supabaseGerador
        .from('eletroposto_parceria')
        .select('created_at, lado, nome, telefone, cidade, capital_faixa, status')
        .eq('lado', 'capital')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }),
      // A fila é a base INTEIRA, sem janela: a desproporção entre capital e
      // ponto é acúmulo, e recortá-la em trinta dias esconde o que ela mostra.
      supabaseGerador
        .from('eletroposto_parceria')
        .select('created_at, lado, nome, telefone, cidade, capital_faixa, status'),
      supabase
        .from('pc_eventos')
        .select('tipo, session_id, created_at')
        .in('tipo', pc.PONTO_CERTO_TIPOS)
        .gte('created_at', desde),
      supabase
        .from('pc_compras')
        .select('created_at, nome, email, valor_centavos, status')
        .eq('item_slug', 'ponto-certo')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }),
      // A lista de oferta olha a base INTEIRA, não a janela: um investidor de
      // 40 dias atrás continua sem local, e recortá-lo fora esconde justamente
      // quem está esperando há mais tempo.
      supabaseGerador
        .from('eletroposto_nota1')
        .select('created_at, nome, telefone, cidade, capital_faixa, tem_ponto, status'),
      // A pesquisa de 30/08 foi mandada pra quem TEVE REUNIÃO e não fechou —
      // gente que mora aqui, não em eletroposto_nota1. É o público mais quente
      // que existe: já falou com a gente e mesmo assim continua sem o ponto.
      supabaseGerador
        .from('agendamentos')
        .select('created_at, cliente_nome, cliente_telefone, cidade, capital_faixa, tem_ponto, status, created_by'),
    ]);

    const fichas = (fichasQ.data ?? []) as pc.FichaNota1[];
    const cadastros = (cadastrosQ.data ?? []) as pc.Cadastro[];
    const eventos = (eventosQ.data ?? []) as pc.EventoLp[];
    const vendasTodas = (vendasQ.data ?? []) as pc.Venda[];
    // Pendente e reembolsada continuam na lista de baixo (é dinheiro que passou
    // por aqui), mas o número do card é só o que virou acesso.
    const vendas = vendasTodas.filter((v) => v.status === 'aprovada');

    const linhas = pc.linhasDoFunil(fichas, eventos, vendas);
    const mandados = pc.somaColuna(linhas, 'mandados');
    const cadastraram = pc.somaColuna(linhas, 'cadastraram');
    const visitas = pc.somaColuna(linhas, 'visitas');
    const checkout = pc.somaColuna(linhas, 'checkout');
    const compras = pc.somaColuna(linhas, 'vendas');

    // ── Quem compraria ──────────────────────────────────────────────────────
    const ultimos8 = (t: string | null) => String(t || '').replace(/D/g, '').slice(-8);
    const noCapital = new Set(
      ((filaQ.data ?? []) as pc.Cadastro[])
        .filter((c) => c.lado === 'capital')
        .map((c) => ultimos8(c.telefone)),
    );
    const cruas = [
      ...((todasFichasQ.data ?? []) as any[]).map((f) => ({
        nome: f.nome, telefone: f.telefone, cidade: f.cidade,
        capital_faixa: f.capital_faixa, tem_ponto: f.tem_ponto,
        created_at: f.created_at, status: f.status, fonte: 'ficha' as const,
      })),
      ...((agendaQ.data ?? []) as any[])
        .filter((a) => /eletroposto/i.test(a.created_by || ''))
        .map((a) => ({
          nome: a.cliente_nome, telefone: a.cliente_telefone, cidade: a.cidade,
          capital_faixa: a.capital_faixa, tem_ponto: a.tem_ponto,
          created_at: a.created_at, status: a.status, fonte: 'reunião' as const,
        })),
    ];
    const compradores = pc.ranquearCompradores(cruas, noCapital);

    res.json({
      desde,
      dias,
      redirect_desde: pc.REDIRECT_DESDE,
      compradores: compradores.slice(0, 80),
      compradores_total: compradores.length,
      // A landing só passou a avisar que foi aberta quando ganhou o beacon. Sem
      // isto o painel não sabe distinguir "ninguém abriu" de "ninguém contou".
      lp_medida: visitas !== null,
      mandados,
      cadastraram,
      visitas,
      checkout,
      compras,
      perdidos_no_caminho: mandados != null && cadastraram != null ? mandados - cadastraram : null,
      // A conversão que manda agora é esta: desde 01/09 o lado do capital vai
      // da recusa DIRETO pra landing, sem o formulário no meio. Mistura ficha
      // com sessão de navegador, e a tela diz isso.
      conv_mandado_visita: pc.conversao(mandados, visitas),
      nao_chegaram: mandados != null && visitas != null ? mandados - visitas : null,
      conv_mandado_cadastro: pc.conversao(mandados, cadastraram),
      conv_cadastro_visita: pc.conversao(cadastraram, visitas),
      conv_visita_checkout: pc.conversao(visitas, checkout),
      conv_checkout_compra: pc.conversao(checkout, compras),
      fila: pc.filaDosCadastros((filaQ.data ?? []) as pc.Cadastro[]),
      receita_centavos: vendas.reduce((s, v) => s + (v.valor_centavos || 0), 0),
      linhas,
      // Quem tem o dinheiro, foi mandado pras portas e NÃO se cadastrou. É a
      // lista de trabalho da tela: cada linha aqui é um investidor que a equipe
      // pode chamar na mão com o link do material.
      sumidos: fichas
        .filter((f) => pc.CAPITAL_DECLARADO.includes(f.capital_faixa || '') && f.lado !== 'capital')
        .slice(0, 60)
        .map((f) => ({
          quando: f.created_at, nome: f.nome, telefone: f.telefone,
          cidade: f.cidade, capital: f.capital_faixa, ponto: f.tem_ponto,
        })),
      cadastrados: cadastros.slice(0, 40),
      vendas: vendasTodas.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Banco de comentários do curso (moderação) ──────────────────────────────
// Lista TUDO que os alunos avaliaram; o Thiago escolhe o que vira depoimento na
// página de venda. Só entra na LP o que for aprovado AQUI e tiver autorização
// do aluno.
router.get('/kit-avaliacoes', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('curso_avaliacoes')
      .select('id, user_id, curso_slug, modulo_slug, estrelas, comentario, nome_exibicao, empresa, cidade, autoriza_publicar, aprovado, criado_em')
      .order('criado_em', { ascending: false })
      .limit(200);
    if (error) throw error;

    const linhas = (data ?? []) as Array<{
      id: string; user_id: string; curso_slug: string; modulo_slug: string;
      estrelas: number; comentario: string | null; nome_exibicao: string | null;
      empresa: string | null; cidade: string | null;
      autoriza_publicar: boolean; aprovado: boolean; criado_em: string;
    }>;

    // Nome/email de quem avaliou (a tela precisa saber de quem é o comentário).
    const ids = Array.from(new Set(linhas.map((l) => l.user_id)));
    const donos: Record<string, { email: string; nome: string | null }> = {};
    if (ids.length) {
      const { data: users } = await supabase.from('users').select('id, email, nome').in('id', ids);
      for (const u of (users ?? []) as Array<{ id: string; email: string; nome: string | null }>) {
        donos[u.id] = { email: u.email, nome: u.nome };
      }
    }

    const comNota = linhas.filter((l) => l.estrelas > 0);
    const media = comNota.length
      ? +(comNota.reduce((s, l) => s + l.estrelas, 0) / comNota.length).toFixed(2)
      : null;

    res.json({
      total: linhas.length,
      media,
      com_comentario: linhas.filter((l) => (l.comentario ?? '').trim()).length,
      autorizados: linhas.filter((l) => l.autoriza_publicar).length,
      aprovados: linhas.filter((l) => l.aprovado).length,
      avaliacoes: linhas.map((l) => ({ ...l, autor: donos[l.user_id] ?? null })),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// PATCH /admin/kit-avaliacoes/:id — aprova ou tira da vitrine.
// Única escrita destes painéis: o efeito é publicar (ou despublicar) um
// depoimento na página de venda, então fica explícita e reversível.
router.patch('/kit-avaliacoes/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const aprovado = req.body?.aprovado === true;
    const { error } = await supabase
      .from('curso_avaliacoes')
      .update({ aprovado, aprovado_em: aprovado ? new Date().toISOString() : null })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, aprovado });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// ── Disciplina das ordens (marcar feito, expira, manual/auto) ──
// GET lista pendentes + histórico + modo. Sincroniza on-demand pra a lista vir
// fresca mesmo entre ticks do cron.
router.get('/ordens', async (_req: Request, res: Response): Promise<void> => {
  try {
    await sincronizarOrdens().catch(() => {}); // best-effort: abre novas antes de listar
    const data = await listarOrdens();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});
// POST marca uma ordem como feita (+ confirmação por readback no Meta).
router.post('/ordens/:id/feita', async (req: Request, res: Response): Promise<void> => {
  try {
    const quem = (req as any).userEmail || (req as any).userId || 'admin';
    const r = await marcarFeita(String(req.params.id), String(quem));
    if (!r) { res.status(404).json({ error: 'ordem_nao_encontrada_ou_ja_resolvida' }); return; }
    res.json({ ok: true, ordem: r });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});
// POST troca o modo manual|automatico.
router.post('/ordens/modo', async (req: Request, res: Response): Promise<void> => {
  const modo = req.body?.modo;
  if (modo !== 'manual' && modo !== 'automatico') { res.status(400).json({ error: 'modo_invalido' }); return; }
  try {
    await setModo(modo);
    res.json({ ok: true, modo });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});
router.get('/funnel',         getFunnel);
router.get('/funnel-limpapro', getLimpaproFunnel);
router.get('/pix-funil',      getPixFunil); // quantos chegam na tela de Pix e quantos saem pagando
// Jornada do lead na LP do LimpaPro. Aqui atras do auth de admin (o mesmo controller
// tambem responde em /_t/limpapro/jornada?k=, pro painel avulso na pasta da landing).
router.get('/jornada-limpapro', jornadaLimpapro);
router.get('/leads-limpapro',  getLimpaproLeads);
router.get('/conversas-limpapro', getLimpaproConversas);
router.get('/membros-limpapro', getLimpaproMembros);
router.get('/revenue',        getRevenue);
router.get('/billing',        getBilling);

// ── Leads por Origem (etiqueta) ──────────────────────────────────────────────
// Fonte única: os agendamentos do GERADOR (é onde TODO lead cai — Meta, LP,
// automação do IG, indicação, cadastro manual). Deriva a etiqueta de cada lead
// (produto × canal) de forma DINÂMICA e devolve a série diária + os totais.
// O bucket do dia é feito no fuso de São Paulo (created_at é UTC), senão o lead
// da noite cai no dia errado — que é justo o "leads de hoje" que o dono lê de manhã.
// Etiquetas NÃO são lista fixa: público novo → etiqueta nova, sem tocar no código.
router.get('/leads-origem', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [{ data: ags, error: e1 }, { data: cons }] = await Promise.all([
      supabaseGerador
        .from('agendamentos')
        .select('created_at, created_by, src')
        .order('created_at', { ascending: true })
        .limit(50000),
      supabaseGerador.from('consultores').select('nome'),
    ]);
    if (e1) throw e1;

    const consultores = new Set<string>(
      (cons ?? []).map((c: { nome?: string | null }) => (c.nome ?? '').toString().trim().toLowerCase()).filter(Boolean),
    );

    // created_at (UTC) → data no fuso de São Paulo, formato YYYY-MM-DD (en-CA).
    const fmtSP = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const diaSP = (iso: string): string => fmtSP.format(new Date(iso));

    const porDia = new Map<string, Map<string, number>>();
    const totais = new Map<string, number>();
    const presentes = new Set<string>();

    for (const a of (ags ?? []) as Array<{ created_at: string; created_by: string | null; src: string | null }>) {
      if (!a.created_at) continue;
      const dia = diaSP(a.created_at);
      const et = etiquetaDeLead(a.created_by, a.src, consultores);
      presentes.add(et);
      totais.set(et, (totais.get(et) ?? 0) + 1);
      if (!porDia.has(dia)) porDia.set(dia, new Map());
      const m = porDia.get(dia)!;
      m.set(et, (m.get(et) ?? 0) + 1);
    }

    // Ordem estável (base primeiro), etiquetas novas/desconhecidas depois (alfabética).
    const extras = [...presentes].filter((e) => !ETIQUETAS_ORDEM.includes(e)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const etiquetas = [...ETIQUETAS_ORDEM.filter((e) => presentes.has(e)), ...extras];

    const dias = [...porDia.keys()].sort().map((dia) => {
      const m = porDia.get(dia)!;
      const row: Record<string, string | number> = { dia };
      let total = 0;
      for (const et of etiquetas) {
        const n = m.get(et) ?? 0;
        row[et] = n;
        total += n;
      }
      row.total = total;
      return row;
    });

    const totaisObj: Record<string, number> = {};
    for (const et of etiquetas) totaisObj[et] = totais.get(et) ?? 0;

    res.json({
      ok: true,
      etiquetas,
      dias,
      totais: totaisObj,
      totalGeral: (ags ?? []).length,
      hoje: diaSP(new Date().toISOString()),
    });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Liberação manual por PIX: quando o cliente paga por Pix e manda o comprovante,
// o atendimento libera N meses de acesso ilimitado. Renova SOMANDO ao que resta
// (não zera se pagar adiantado). O guard no stripeSyncService protege contra
// rebaixamento enquanto plano_expira_em estiver no futuro; o lembrete mensal avisa.
router.post('/pix-liberar', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, meses } = req.body as { email?: string; meses?: number };
    if (!email) { res.status(400).json({ error: 'email obrigatório' }); return; }
    const n = Math.max(1, Math.min(12, Number(meses) || 1));
    const { data: u } = await supabase.from('users').select('id, email, plano_expira_em, billing_status').ilike('email', String(email).trim()).maybeSingle();
    if (!u) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
    const agora = Date.now();
    const base = (u.plano_expira_em && new Date(u.plano_expira_em).getTime() > agora)
      ? new Date(u.plano_expira_em) : new Date(agora);
    base.setMonth(base.getMonth() + n);
    const expira = base.toISOString();
    await supabase.from('users').update({
      plano: 'ilimitado', limite_documentos: 999999, billing_status: 'active', plano_expira_em: expira,
      past_due_since: null, dunning_last_day_sent: null,
    }).eq('id', u.id);
    // Estava em dunning? cancela a sub de cartão falhando no Stripe (anti-cobrança-dupla —
    // senão o Smart Retries cobra o cartão além do Pix). O guard do webhook subscription.deleted
    // não re-suspende porque plano_expira_em acabou de ir pro futuro.
    let subsCanceladas = 0;
    if (u.billing_status === 'past_due' || u.billing_status === 'suspended') {
      const { cancelStripeSubsForEmail } = await import('../services/dunningService');
      subsCanceladas = await cancelStripeSubsForEmail(u.email);
    }
    res.json({ ok: true, email: u.email, plano_expira_em: expira, meses: n, subs_canceladas: subsCanceladas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao liberar Pix', message: String(err) });
  }
});

// Deletar user (cascade manual). Aceita { email } OU { cnpj } no body.
// Apaga: documents, clients, terceiros, company, e o user.
router.post('/users/delete', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, cnpj } = req.body as { email?: string; cnpj?: string };
    if (!email && !cnpj) {
      res.status(400).json({ error: 'Informe email ou cnpj' });
      return;
    }

    let userId: string | null = null;
    let userEmail: string | null = null;

    if (cnpj) {
      const cleanCnpj = cnpj.replace(/\D/g, '');
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .or(`cnpj.eq.${cnpj},cnpj.eq.${cleanCnpj}`)
        .maybeSingle();
      if (!comp) { res.status(404).json({ error: 'Empresa com esse CNPJ não encontrada' }); return; }
      userId = comp.user_id;
    } else if (email) {
      const { data: u } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();
      if (!u) { res.status(404).json({ error: 'User com esse email não encontrado' }); return; }
      userId = u.id;
      userEmail = u.email;
    }

    if (!userId) { res.status(404).json({ error: 'User não encontrado' }); return; }

    if (!userEmail) {
      const { data: u } = await supabase.from('users').select('email').eq('id', userId).single();
      userEmail = u?.email ?? null;
    }

    // Delete em ordem (FK constraints)
    const deleted: Record<string, number> = {};
    const tabelas = ['documents', 'clients', 'terceiros', 'company'];
    for (const t of tabelas) {
      const { count } = await supabase.from(t).delete({ count: 'exact' }).eq('user_id', userId);
      deleted[t] = count || 0;
    }
    const { count: usersCount } = await supabase.from('users').delete({ count: 'exact' }).eq('id', userId);
    deleted.users = usersCount || 0;

    res.json({ ok: true, user_id: userId, email: userEmail, deleted });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar user', message: String(err) });
  }
});

// ── CRM SDR Leads (Solar B2C) ─────────────────────────────────────
const SDR_ESTAGIOS = ['reativacao','novo','frio','morno','quente','perdido','fechamento'];

router.get('/sdr-leads', async (req: Request, res: Response) => {
  try {
    // Supabase REST tem default de 1000 rows. Subimos pra 5000 pra evitar
    // que leads quentes/em-atendimento sumam quando ha muitos em reativacao.
    const { data, error } = await supabase
      .from('sdr_leads').select('*')
      .order('updated_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    res.json({ leads: data ?? [] });
  } catch { res.status(500).json({ error: 'Erro ao buscar leads SDR' }); }
});

router.patch('/sdr-leads/:phone/estagio', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { estagio } = req.body;
    if (!SDR_ESTAGIOS.includes(estagio)) { res.status(400).json({ error: 'Estágio inválido' }); return; }

    // Se for fechamento, dispara Purchase no Meta
    if (estagio === 'fechamento') {
      const { data: lead } = await supabase.from('sdr_leads').select('ctwa_clid').eq('phone', phone).single();
      if (lead?.ctwa_clid) {
        const { sendMetaEvent } = await import('../utils/metaPixel');
        await sendMetaEvent('Purchase', {
          customData: { ctwa_clid: lead.ctwa_clid, value: 0, currency: 'BRL' } // O valor pode ser ajustado depois
        }).catch(console.error);
      }
    }

    await supabase.from('sdr_leads').update({ estagio, updated_at: new Date().toISOString() }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

// Toggle human_takeover de um lead. Use pra "devolver pra Luma" (false) ou
// "assumir manualmente sem precisar mandar mensagem" (true).
router.patch('/sdr-leads/:phone/takeover', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { takeover } = req.body;
    const update: any = {
      human_takeover: !!takeover,
      updated_at: new Date().toISOString(),
    };
    if (takeover) update.human_takeover_at = new Date().toISOString();
    else update.human_takeover_at = null;
    await supabase.from('sdr_leads').update(update).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atualizar takeover' }); }
});

// Importa lista em massa de leads pra reativação. Aceita lista de objetos
// { nome, phone, cidade? }. Cria com estagio='reativacao', lead_origem='reativacao'.
// Cron horário processa em horário comercial respeitando meta de 50/dia.
router.post('/sdr-leads/import', async (req: Request, res: Response) => {
  try {
    const { leads } = (req.body as any) ?? {};
    if (!Array.isArray(leads) || leads.length === 0) {
      res.status(400).json({ error: 'leads deve ser array não-vazio' }); return;
    }
    const rows: any[] = [];
    const ignored: any[] = [];
    for (const l of leads) {
      const phone = String(l.phone || '').replace(/\D/g, '');
      const nome = String(l.nome || '').trim() || null;
      const cidade = l.cidade ? String(l.cidade).trim() : null;
      if (phone.length < 10 || phone.length > 13) {
        ignored.push({ phone: l.phone, nome, motivo: 'phone inválido' });
        continue;
      }
      // Normaliza pra formato BR com 55 prefixo
      const normalized = phone.startsWith('55') ? phone : `55${phone}`;
      rows.push({
        phone: normalized,
        nome,
        cidade,
        estagio: 'reativacao',
        lead_origem: 'reativacao',
        instance: 'io',
        aguardando_resposta: false,
        total_mensagens: 0,
        contatos: 0,
        reativacao_tentativas: 0,
      });
    }

    // upsert — se phone já existe, NÃO sobrescreve estágio (preserva leads ativos)
    const { data: existentes } = await supabase
      .from('sdr_leads')
      .select('phone, estagio')
      .in('phone', rows.map(r => r.phone));
    const existeSet = new Set((existentes || []).map((r: any) => r.phone));
    const novos = rows.filter(r => !existeSet.has(r.phone));
    const dups = rows.length - novos.length;

    if (novos.length > 0) {
      const { error } = await supabase.from('sdr_leads').insert(novos);
      if (error) { res.status(500).json({ error: error.message }); return; }
    }

    res.json({
      ok: true,
      total_recebidos: leads.length,
      inseridos: novos.length,
      duplicados: dups,
      invalidos: ignored.length,
      ignored,
    });
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

// Atualiza valor da venda (pra fechados ou quando agendar)
router.patch('/sdr-leads/:phone/valor-venda', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const valorRaw = (req.body as any)?.valor;
    const valor = valorRaw === null || valorRaw === '' ? null : Number(valorRaw);
    if (valor !== null && (isNaN(valor) || valor < 0)) {
      res.status(400).json({ error: 'valor inválido' }); return;
    }
    await supabase.from('sdr_leads').update({
      valor_venda: valor,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar valor' }); }
});

// Atribui consultor responsável pelo lead
const CONSULTORES = ['diego', 'giovanna', 'nilce', 'thiago'];
router.patch('/sdr-leads/:phone/consultor', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const { consultor } = (req.body as any) ?? {};
    if (consultor !== null && consultor !== '' && !CONSULTORES.includes(consultor)) {
      res.status(400).json({ error: 'Consultor inválido' }); return;
    }
    await supabase.from('sdr_leads').update({
      consultor: consultor || null,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao atribuir consultor' }); }
});

// Métricas do CRM — KPIs do topo da página
router.get('/sdr-metrics', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    // Calcula início de dia/mês/ano em horário de Brasília (UTC-3)
    // 00:00 BRT = 03:00 UTC. Servidor Vercel roda em UTC.
    const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const startOfDay = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), 3, 0, 0));
    const startOfMonth = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), 1, 3, 0, 0));
    const startOfYear = new Date(Date.UTC(brtNow.getUTCFullYear(), 0, 1, 3, 0, 0));
    const next24h = new Date(now.getTime() + 24*60*60*1000);

    // CRM Solar foca apenas na linha 'io' (Irmãos na Obra)
    const [
      totalRes, hojeRes, mesRes,
      quenteRes, fechamentoRes, fechamentoMesRes, frioRes, perdidoRes,
      agendadosRes, takeoverRes,
      vendidoMesRes, vendidoAnoRes,
    ] = await Promise.all([
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').gte('created_at', startOfDay.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').gte('created_at', startOfMonth.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'quente'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'fechamento'),
      // Fechamentos no mês corrente (updated_at = quando foi marcado fechamento)
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'fechamento').gte('updated_at', startOfMonth.toISOString()),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'frio'),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('estagio', 'perdido'),
      supabase.from('sdr_leads').select('phone, nome, horario_iso, canal_atendimento, horario_atendimento, cidade')
        .eq('instance', 'io')
        .gte('horario_iso', now.toISOString()).lte('horario_iso', next24h.toISOString())
        .order('horario_iso', { ascending: true }),
      supabase.from('sdr_leads').select('phone', { count: 'exact', head: true }).eq('instance', 'io').eq('human_takeover', true),
      // Valor vendido acumulado MÊS (linha IO, fechados no mês corrente)
      supabase.from('sdr_leads').select('valor_venda').eq('instance', 'io').eq('estagio', 'fechamento').not('valor_venda', 'is', null).gte('updated_at', startOfMonth.toISOString()),
      // Valor vendido acumulado ANO (linha IO, fechados no ano corrente)
      supabase.from('sdr_leads').select('valor_venda').eq('instance', 'io').eq('estagio', 'fechamento').not('valor_venda', 'is', null).gte('updated_at', startOfYear.toISOString()),
    ]);

    const total = totalRes.count ?? 0;
    const fechadosMes = fechamentoMesRes.count ?? 0;
    // Conversão mensal: fechamentos do mês / total do pipeline
    const conversao = total > 0 ? (fechadosMes / total) * 100 : 0;

    // Soma valor vendido acumulado
    const somaVendidoMes = (vendidoMesRes.data ?? []).reduce((acc: number, r: any) => acc + (Number(r.valor_venda) || 0), 0);
    const somaVendidoAno = (vendidoAnoRes.data ?? []).reduce((acc: number, r: any) => acc + (Number(r.valor_venda) || 0), 0);

    res.json({
      total,
      hoje: hojeRes.count ?? 0,
      mes: mesRes.count ?? 0,
      por_estagio: {
        quente: quenteRes.count ?? 0,
        fechamento: fechamentoRes.count ?? 0,
        frio: frioRes.count ?? 0,
        perdido: perdidoRes.count ?? 0,
      },
      conversao_pct: Number(conversao.toFixed(1)),
      agendados_24h: agendadosRes.data ?? [],
      em_takeover: takeoverRes.count ?? 0,
      valor_vendido_mes: somaVendidoMes,
      valor_vendido_ano: somaVendidoAno,
      meta_mes: 220000,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar métricas', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Exclui lead SDR + sessão de conversa (whatsapp_sessions)
router.delete('/sdr-leads/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    if (!phone) { res.status(400).json({ error: 'phone obrigatório' }); return; }
    await supabase.from('whatsapp_sessions').delete().eq('phone', phone).eq('tipo', 'sdr');
    const { error } = await supabase.from('sdr_leads').delete().eq('phone', phone);
    if (error) { res.status(500).json({ error: 'Erro ao excluir' }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao excluir' }); }
});

// Histórico completo da conversa do lead
router.get('/sdr-leads/:phone/history', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { data, error } = await supabase
      .from('whatsapp_sessions').select('messages, nome, updated_at')
      .eq('phone', phone).eq('tipo', 'sdr').single();
    if (error) { res.json({ messages: [], nome: null }); return; }
    res.json({ messages: data?.messages || [], nome: data?.nome });
  } catch { res.status(500).json({ error: 'Erro ao buscar histórico' }); }
});

// Notas internas
router.patch('/sdr-leads/:phone/notas', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { notas } = req.body;
    await supabase.from('sdr_leads').update({
      notas_internas: notas || null,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar nota' }); }
});

// Tags
router.patch('/sdr-leads/:phone/tags', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { tags } = req.body;
    if (!Array.isArray(tags)) { res.status(400).json({ error: 'tags deve ser array' }); return; }
    await supabase.from('sdr_leads').update({
      tags: tags.map(String).filter(Boolean).slice(0, 20),
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao salvar tags' }); }
});

// Mandar mensagem manual pelo CRM (marca takeover automaticamente)
router.post('/sdr-leads/:phone/send-message', async (req: Request, res: Response) => {
  try {
    const phone = String(req.params.phone || '');
    const messageRaw = (req.body as any)?.message;
    if (!messageRaw || typeof messageRaw !== 'string' || messageRaw.trim().length === 0) {
      res.status(400).json({ error: 'message obrigatório' }); return;
    }
    const message: string = messageRaw;
    const { data: lead } = await supabase.from('sdr_leads').select('instance').eq('phone', phone).single();
    const instance = (lead?.instance === 'io' ? 'io' : 'solardoc') as 'io' | 'solardoc';
    const { sendWhatsApp } = await import('../services/agents/zapiClient');
    await sendWhatsApp(phone, message.trim(), instance);

    // Marca takeover (humano enviou mensagem, Luma pausa)
    await supabase.from('sdr_leads').update({
      human_takeover: true,
      human_takeover_at: new Date().toISOString(),
      ultima_mensagem: message.slice(0, 300),
      ultimo_contato: new Date().toISOString(),
      aguardando_resposta: false,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);

    // Anexa no histórico
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('messages').eq('phone', phone).eq('tipo', 'sdr').single();
    const oldMessages = (session?.messages as any[]) || [];
    await supabase.from('whatsapp_sessions').upsert({
      phone, tipo: 'sdr',
      messages: [...oldMessages, { role: 'assistant', content: `[humano] ${message}` }].slice(-80),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone,tipo' });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro ao enviar', detail: err instanceof Error ? err.message : String(err) }); }
});

// Cancela agendamento (mantém lead vivo)
router.post('/sdr-leads/:phone/cancel-schedule', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    await supabase.from('sdr_leads').update({
      canal_atendimento: null,
      horario_atendimento: null,
      horario_iso: null,
      agendado_at: null,
      lembrete_enviado_at: null,
      endereco_vistoria: null,
      estagio: 'morno',
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao cancelar' }); }
});

// Força próximo follow-up agora (independente da cadência)
router.post('/sdr-leads/:phone/force-followup', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    // Reseta ultimo_contato pra muito atrás → cron vai disparar próximo toque
    const old = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    await supabase.from('sdr_leads').update({
      ultimo_contato: old,
      aguardando_resposta: true,
      human_takeover: false,
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);
    res.json({ ok: true, message: 'Próximo follow-up sairá no próximo cron (~1 min)' });
  } catch { res.status(500).json({ error: 'Erro' }); }
});

// IA gera análise resumida + próxima ação sugerida
router.get('/sdr-leads/:phone/insights', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const { data: lead } = await supabase.from('sdr_leads').select('*').eq('phone', phone).single();
    const { data: session } = await supabase.from('whatsapp_sessions')
      .select('messages').eq('phone', phone).eq('tipo', 'sdr').single();
    if (!lead) { res.status(404).json({ error: 'lead não encontrado' }); return; }

    const messages = (session?.messages as any[]) || [];
    const historico = messages.slice(-30).map((m: any) =>
      `${m.role === 'user' ? 'Lead' : 'Luma'}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`
    ).join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Você é analista comercial sênior. Recebe contexto de um lead de energia solar e gera 3 coisas em JSON:
{
  "resumo": "1 frase descrevendo o lead em até 25 palavras",
  "score": número de 0-100 (probabilidade de fechar),
  "proxima_acao": "ação concreta sugerida em 1 frase imperativa"
}
Apenas JSON, sem markdown.`,
      messages: [{ role: 'user', content: `Lead: ${lead.nome || 'Sem nome'} | Cidade: ${lead.cidade || '—'} | Estágio: ${lead.estagio} | Agendamento: ${lead.canal_atendimento || 'nenhum'}\n\nConversa:\n${historico}` }],
    });
    const txt = (r.content[0] as { text: string }).text.trim();
    const cleaned = txt.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    let parsed: any;
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { resumo: txt.slice(0, 200), score: null, proxima_acao: null }; }
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: 'Erro IA', detail: err instanceof Error ? err.message : String(err) }); }
});

// Contagem leve pro badge do sidebar — leads com empresa + whatsapp,
// quebrados por plano (total, pro, vip, adm). Admin não conta como cliente.
router.get('/platform-crm/counts', async (_req: Request, res: Response) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, plano, whatsapp, is_admin');
    const { data: companies } = await supabase.from('company').select('user_id');
    const companySet = new Set((companies ?? []).map((c: any) => c.user_id));

    let total = 0, pro = 0, vip = 0, adm = 0;
    for (const u of users ?? []) {
      const hasWpp = !!(u.whatsapp && String(u.whatsapp).trim());
      const hasCompany = companySet.has(u.id);
      if (!hasWpp || !hasCompany) continue;
      if (u.is_admin) { adm++; continue; } // admin sai do funil de clientes
      total++;
      if (u.plano === 'pro') pro++;
      else if (u.plano === 'ilimitado') vip++;
    }
    res.json({ total, pro, vip, adm });
  } catch (err) {
    console.error('platform-crm/counts error:', err);
    res.status(500).json({ error: 'Erro ao contar' });
  }
});

// ── CRM Plataforma — status dinâmico + override manual ────────────
router.get('/platform-crm', async (req: Request, res: Response) => {
  try {
    const cutoff2d = new Date(Date.now() - 2 * 86400000).toISOString();

    const { data: users } = await supabase
      .from('users')
      .select('id, email, whatsapp, plano, documentos_usados, created_at, crm_estagio')
      .order('created_at', { ascending: false });

    if (!users?.length) { res.json({ columns: {} }); return; }

    const { data: companies } = await supabase.from('company').select('user_id, nome, cnpj');
    const companySet = new Set((companies ?? []).map((c: any) => c.user_id));
    const companyMap = Object.fromEntries((companies ?? []).map((c: any) => [c.user_id, c]));

    const { data: recentDocs } = await supabase.from('documents').select('user_id').gte('created_at', cutoff2d);
    const recentSet = new Set((recentDocs ?? []).map((d: any) => d.user_id));

    const columns: Record<string, any[]> = { sem_cnpj: [], desativado: [], ativo: [], pro: [], vip: [] };

    for (const u of users) {
      const company = companyMap[u.id];
      const hasCompany = companySet.has(u.id);
      const recentActive = recentSet.has(u.id);

      const card = {
        id: u.id, email: u.email, whatsapp: u.whatsapp, plano: u.plano,
        empresa: company?.nome ?? null, cnpj: company?.cnpj ?? null,
        documentos_usados: u.documentos_usados, created_at: u.created_at,
        ativo_recente: recentActive, crm_estagio: u.crm_estagio,
      };

      // Override manual tem prioridade sobre classificação automática
      const estagio = u.crm_estagio ?? (
        u.plano === 'ilimitado' ? 'vip' :
        u.plano === 'pro'       ? 'pro' :
        !hasCompany             ? 'sem_cnpj' :
        recentActive            ? 'ativo' : 'desativado'
      );

      (columns[estagio] ??= []).push(card);
    }

    res.json({ columns });
  } catch (err) {
    console.error('platform-crm error:', err);
    res.status(500).json({ error: 'Erro ao buscar plataforma CRM' });
  }
});

// Move usuário da plataforma para coluna manual
router.patch('/platform-crm/:id/estagio', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estagio } = req.body;
    const valid = ['sem_cnpj','desativado','ativo','pro','vip'];
    if (!valid.includes(estagio)) { res.status(400).json({ error: 'Estágio inválido' }); return; }
    await supabase.from('users').update({ crm_estagio: estagio }).eq('id', id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao mover lead' }); }
});

// Reseta override (volta para classificação automática)
router.delete('/platform-crm/:id/estagio', async (req: Request, res: Response) => {
  try {
    await supabase.from('users').update({ crm_estagio: null }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao resetar' }); }
});

// Move lead da plataforma para o SDR Solar
router.post('/platform-crm/:id/para-sdr', async (req: Request, res: Response) => {
  try {
    const { data: user } = await supabase.from('users').select('id, email, whatsapp').eq('id', req.params.id).single();
    if (!user?.whatsapp) { res.status(400).json({ error: 'Usuário sem WhatsApp' }); return; }
    await supabase.from('sdr_leads').upsert({
      phone: user.whatsapp.replace(/\D/g,''),
      nome: null,
      estagio: 'novo',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erro ao mover para SDR' }); }
});

// ── Disparos IO (broadcast WhatsApp via linha Irmãos na Obra) ──────────
// /admin/io/humanize — IA reformula mensagem-base para soar humano
// /admin/io/send-text — envia texto via Z-API IO (autenticado, sem bootstrap key)
router.post('/io/humanize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { base, context } = req.body as { base?: string; context?: string };
    if (!base || typeof base !== 'string') { res.status(400).json({ error: 'base obrigatorio' }); return; }
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurado' }); return; }

    const anthropic = new Anthropic({ apiKey: key });
    const ctx = (context || '').trim();
    const systemPrompt = [
      'Voce reformula uma mensagem-base do WhatsApp para soar como um humano brasileiro real escrevendo, nao como robo.',
      'Regras absolutas:',
      '- Mantenha o significado e a intencao da mensagem-base.',
      '- Frases curtas, naturais, coloquiais.',
      '- NUNCA use travessao (—) nem em-dash. Use virgula, ponto, ou simplesmente quebre a frase.',
      '- Sem emoji.',
      '- Variar sutilmente entre reformulacoes: ora "tudo bem?", ora vai direto; ora "Boa tarde", ora "Oi".',
      '- Nao adicione informacao nova que nao esteja na base.',
      '- Saida: APENAS a mensagem reformulada, sem aspas, sem prefixo, sem explicacao.',
      '',
      'Exemplo de reformulacao no tom certo:',
      'Base: Boa tarde, aqui e a Giovanna',
      'Saida: Boa tarde, e a Giovanna falando',
      ctx ? `\nContexto adicional do disparo: ${ctx}` : '',
    ].filter(Boolean).join('\n');

    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0.9,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Mensagem-base: ${base}\n\nReformule.` }],
    });
    const c = r.content[0];
    const text = c?.type === 'text' ? c.text.trim().replace(/^["']|["']$/g, '') : base;
    res.json({ message: text || base });
  } catch (err) {
    res.status(500).json({ error: 'Erro na humanizacao', message: String(err) });
  }
});

router.post('/io/send-text', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, message } = req.body as { phone?: string; message?: string };
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone) { res.status(400).json({ error: 'phone obrigatorio' }); return; }
    if (!message || typeof message !== 'string') { res.status(400).json({ error: 'message obrigatorio' }); return; }

    const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
    const token = process.env.ZAPI_TOKEN_IO?.trim();
    const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
    if (!id || !token || !client) {
      res.status(500).json({ error: 'creds Z-API IO ausentes' });
      return;
    }

    const r = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': client },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    const txt = await r.text();
    let body: unknown;
    try { body = JSON.parse(txt); } catch { body = txt; }
    res.status(r.ok ? 200 : 502).json({ zapi_status: r.status, body });
  } catch (err) {
    res.status(500).json({ error: 'Erro no envio', message: String(err) });
  }
});

// Cria registro de auditoria de um disparo. Retorna id pra cliente referenciar.

// ── Respostas ao disparo (fila de atendimento humano) ──────────────────────
// Quem responde a um blast hoje cai no vazio: o agente de SDR ignora a linha IO
// e o próprio disparo cala os bots. Esta é a fila que torna a resposta visível.
// Quem pediu pra parar já foi pra supressão sozinho — aparece aqui só como
// informação (diz se a copy está irritando as pessoas).
router.get('/io/blast-respostas', async (req: Request, res: Response): Promise<void> => {
  try {
    const soPendentes = req.query.pendentes === '1';
    let q = supabase
      .from('io_blast_respostas')
      .select('id, phone, texto, classificacao, atendido, respondido_em, broadcast_id')
      .order('respondido_em', { ascending: false })
      .limit(200);
    if (soPendentes) q = q.eq('atendido', false).eq('classificacao', 'atender');
    const { data, error } = await q;
    if (error) throw error;
    const linhas = data ?? [];
    res.json({
      respostas: linhas,
      pendentes: linhas.filter((r: { atendido: boolean; classificacao: string }) => !r.atendido && r.classificacao === 'atender').length,
      negativas: linhas.filter((r: { classificacao: string }) => r.classificacao === 'negativa').length,
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// Marca como atendido (some da fila). Só isso — a conversa acontece no WhatsApp.
router.patch('/io/blast-respostas/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase
      .from('io_blast_respostas')
      .update({ atendido: req.body?.atendido !== false, atendido_em: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

router.post('/io/broadcasts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { mensagens, contatos, contexto_ai, usou_ia, cadencia_min, cadencia_max, total } = req.body as {
      mensagens?: { slot: number; base: string; media_url?: string | null; media_type?: 'image' | 'video' | 'audio' | null }[];
      contatos?: string[];
      contexto_ai?: string;
      usou_ia?: boolean;
      cadencia_min?: number;
      cadencia_max?: number;
      total?: number;
    };
    if (!Array.isArray(mensagens) || mensagens.length === 0) { res.status(400).json({ error: 'mensagens obrigatorio' }); return; }

    const mensagensClean = mensagens.map(m => {
      const mt = m.media_type === 'image' || m.media_type === 'video' || m.media_type === 'audio' ? m.media_type : null;
      const mu = mt && typeof m.media_url === 'string' && m.media_url.trim() ? m.media_url.trim() : null;
      return { slot: m.slot, base: m.base, media_url: mu, media_type: mt };
    });

    const { data, error } = await supabase.from('io_broadcasts').insert({
      criado_por: req.userId,
      mensagens: mensagensClean,
      contatos: Array.isArray(contatos) ? contatos : null,
      contexto_ai: contexto_ai ?? null,
      usou_ia: usou_ia ?? true,
      cadencia_min: cadencia_min ?? 4,
      cadencia_max: cadencia_max ?? 8,
      total: total ?? 0,
      status: 'rodando',
    }).select('id').single();
    if (error || !data) { res.status(500).json({ error: 'Erro criando broadcast', detail: error?.message }); return; }
    res.json({ id: data.id });
  } catch (err) {
    res.status(500).json({ error: 'Erro criando broadcast', message: String(err) });
  }
});

// Anexa/substitui a lista de contatos de um broadcast (pra retomar disparos
// antigos cuja lista nao foi persistida).
router.put('/io/broadcasts/:id/contatos', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contatos } = req.body as { contatos?: string[] };
    if (!Array.isArray(contatos)) { res.status(400).json({ error: 'contatos[] obrigatorio' }); return; }
    const { error } = await supabase.from('io_broadcasts').update({ contatos }).eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro atualizando contatos', detail: error.message }); return; }
    res.json({ ok: true, n: contatos.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro put contatos', message: String(err) });
  }
});

// Append de um envio individual à auditoria.
router.post('/io/broadcasts/:id/envios', async (req: Request, res: Response): Promise<void> => {
  try {
    const broadcastId = req.params.id;
    const { phone, slot, mensagem_final, status, zaap_id, message_id, erro } = req.body as {
      phone?: string;
      slot?: number;
      mensagem_final?: string;
      status?: string;
      zaap_id?: string | null;
      message_id?: string | null;
      erro?: string | null;
    };
    if (!phone || !slot || !mensagem_final || !status) {
      res.status(400).json({ error: 'phone, slot, mensagem_final, status obrigatorios' });
      return;
    }
    const { error } = await supabase.from('io_broadcast_envios').insert({
      broadcast_id: broadcastId,
      phone,
      slot,
      mensagem_final,
      status,
      zaap_id: zaap_id ?? null,
      message_id: message_id ?? null,
      erro: erro ?? null,
    });
    if (error) { res.status(500).json({ error: 'Erro inserindo envio', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro append envio', message: String(err) });
  }
});

// Atualiza contadores e status final do broadcast.
router.patch('/io/broadcasts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const broadcastId = req.params.id;
    const { sucesso, falha, status } = req.body as { sucesso?: number; falha?: number; status?: string };
    const patch: Record<string, unknown> = {};
    if (typeof sucesso === 'number') patch.sucesso = sucesso;
    if (typeof falha === 'number') patch.falha = falha;
    if (status) {
      patch.status = status;
      if (status === 'concluido' || status === 'parado' || status === 'erro') {
        patch.finalizado_em = new Date().toISOString();
      }
    }
    const { error } = await supabase.from('io_broadcasts').update(patch).eq('id', broadcastId);
    if (error) { res.status(500).json({ error: 'Erro atualizando broadcast', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro patch broadcast', message: String(err) });
  }
});

// Lista os últimos N broadcasts (default 20).
router.get('/io/broadcasts', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { data, error } = await supabase
      .from('io_broadcasts')
      .select('id, criado_em, mensagens, total, sucesso, falha, status, finalizado_em, usou_ia, cadencia_min, cadencia_max')
      .order('criado_em', { ascending: false })
      .limit(limit);
    if (error) { res.status(500).json({ error: 'Erro listando broadcasts', detail: error.message }); return; }
    res.json({ broadcasts: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro list broadcasts', message: String(err) });
  }
});

// Detalhe de um broadcast (com contatos).
router.get('/io/broadcasts/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('io_broadcasts')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro buscando broadcast', detail: error.message }); return; }
    if (!data) { res.status(404).json({ error: 'nao encontrado' }); return; }
    res.json({ broadcast: data });
  } catch (err) {
    res.status(500).json({ error: 'Erro get broadcast', message: String(err) });
  }
});

// Lista envios de um broadcast (opcional ?since=ISO + ?limit=N).
router.get('/io/broadcasts/:id/envios', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    let q = supabase
      .from('io_broadcast_envios')
      .select('*')
      .eq('broadcast_id', req.params.id)
      .order('enviado_em', { ascending: false })
      .limit(limit);
    if (typeof req.query.since === 'string' && req.query.since) {
      q = q.gt('enviado_em', req.query.since);
    }
    const { data, error } = await q;
    if (error) { res.status(500).json({ error: 'Erro buscando envios', detail: error.message }); return; }
    res.json({ envios: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro get envios', message: String(err) });
  }
});

// Kick-off manual: chama o tick imediatamente sem esperar o cron. Retorna
// resultado do tick (até MAX_ENVIOS_POR_TICK envios processados).
router.post('/io/broadcasts/:id/tick', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    // Garante que esse broadcast existe e está rodando — se 'pendente' inicial, marca rodando
    const { data: b } = await supabase.from('io_broadcasts').select('status').eq('id', id).maybeSingle();
    if (!b) { res.status(404).json({ error: 'nao encontrado' }); return; }
    if (b.status !== 'rodando' && b.status !== 'pendente') {
      res.json({ ok: true, skipped: true, status: b.status });
      return;
    }
    if (b.status === 'pendente') {
      await supabase.from('io_broadcasts').update({ status: 'rodando' }).eq('id', id);
    }
    const result = await runIoBroadcastTick();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Erro no tick manual', message: String(err) });
  }
});

// Upload de mídia (imagem/vídeo) pros disparos IO. Aceita base64 e devolve URL
// pública (bucket io-broadcasts-media, auto-criado público). Z-API precisa de
// URL pública pra send-image/send-video.
router.post('/io/broadcasts/upload-media', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, mime, kind } = req.body as { data?: string; mime?: string; kind?: 'image' | 'video' | 'audio' };
    if (!data || typeof data !== 'string') { res.status(400).json({ error: 'data (base64) obrigatorio' }); return; }
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') { res.status(400).json({ error: 'kind precisa ser image, video ou audio' }); return; }

    const base64 = data.includes(',') ? data.split(',', 2)[1] : data;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) { res.status(400).json({ error: 'data vazio ou invalido' }); return; }

    const bucket = 'io-broadcasts-media';
    // Garante bucket publico (idempotente — ignora "already exists").
    const { error: createErr } = await supabase.storage.createBucket(bucket, { public: true });
    if (createErr && !/already exists/i.test(createErr.message)) {
      res.status(500).json({ error: 'Erro criando bucket', detail: createErr.message });
      return;
    }

    const defaultExt = kind === 'image' ? 'jpg' : kind === 'audio' ? 'mp3' : 'mp4';
    const defaultMime = kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const ext = (mime?.split('/')[1] || defaultExt).replace(/[^a-z0-9]/gi, '').slice(0, 8) || defaultExt;
    const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: mime || defaultMime,
      upsert: false,
    });
    if (upErr) { res.status(500).json({ error: 'Erro upload', detail: upErr.message }); return; }

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    res.json({ url: pub.publicUrl, path });
  } catch (err) {
    res.status(500).json({ error: 'Erro upload media', message: String(err) });
  }
});

// ── Lead Extractor (Google Places Text Search New API) ────────────
// /admin/leads/google/search                POST   { query, max_pages? } → busca rápida (1 termo, até 60) + persiste
// /admin/leads/google/scan/start            POST   { uf, categoria } → inicia varredura estadual (job), retorna search_id
// /admin/leads/google/scan/:id/tick         POST   processa UMA fatia de municípios (dirigido pela aba)
// /admin/leads/google/scan/:id/cancel       POST   seta flag de cancelamento
// /admin/leads/google/searches              GET    lista buscas anteriores
// /admin/leads/google/searches/:id          GET    retorna leads da busca
// /admin/leads/google/searches/:id/progress GET    retorna o estado do job (p/ barra + retomar)
// /admin/leads/google/searches/:id          DELETE remove busca + leads
interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
}

// Campos pedidos à Google (compartilhado entre busca rápida e varredura).
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.types', 'places.location',
  'nextPageToken',
].join(',');

// UFs válidas (IBGE) — valida o input da varredura.
const UFS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Mapeia um GooglePlace pra linha de google_leads (mesmo mapeamento da busca rápida).
function placeToRow(searchId: string, p: GooglePlace) {
  return {
    search_id: searchId,
    place_id: p.id,
    nome: p.displayName?.text ?? null,
    telefone: p.nationalPhoneNumber ?? null,
    telefone_internacional: p.internationalPhoneNumber ?? null,
    endereco: p.formattedAddress ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviews_count: p.userRatingCount ?? null,
    types: p.types ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
  };
}

// Erro tipado pra distinguir rate-limit/transitório (429/5xx/RESOURCE_EXHAUSTED).
class GooglePlacesError extends Error {
  httpStatus: number;
  transient: boolean;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
    this.transient = httpStatus === 429 || httpStatus >= 500;
  }
}

// Pagina um único termo até `maxPages` (máx ~60). O delay de 2s é SÓ entre
// páginas do MESMO termo (exigência do nextPageToken da Google), nunca entre
// termos diferentes. Retorna os places + quantos requests gastou.
async function buscarPlacesPaginado(
  query: string,
  apiKey: string,
  maxPages = 3,
): Promise<{ places: GooglePlace[]; requests: number }> {
  const out: GooglePlace[] = [];
  let nextPageToken: string | undefined;
  let requests = 0;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: 20,
    };
    if (nextPageToken) body.pageToken = nextPageToken;

    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    requests++;
    if (!r.ok) {
      const txt = await r.text();
      throw new GooglePlacesError(`Google Places ${r.status}: ${txt.slice(0, 300)}`, r.status);
    }
    const data = await r.json() as { places?: GooglePlace[]; nextPageToken?: string };
    out.push(...(data.places ?? []));
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
    // Google exige um pequeno delay antes de reusar o nextPageToken.
    await sleep(2000);
  }
  return { places: out, requests };
}

interface Municipio { id: number; nome: string }

// Lista de municípios de uma UF via IBGE, ORDENADA por id (cursor determinístico:
// a fatia [processados : processados+BATCH] tem que ser estável entre ticks).
async function fetchMunicipiosIBGE(uf: string): Promise<Municipio[]> {
  const r = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
  );
  if (!r.ok) throw new Error(`IBGE ${r.status}`);
  const data = await r.json() as Array<{ id: number; nome: string }>;
  return data
    .map(m => ({ id: m.id, nome: m.nome }))
    .sort((a, b) => a.id - b.id);
}

router.post('/leads/google/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, max_pages } = req.body as { query?: string; max_pages?: number };
    const q = (query || '').trim();
    if (!q) { res.status(400).json({ error: 'query obrigatoria' }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    const pages = Math.max(1, Math.min(Number(max_pages) || 3, 3));

    let allPlaces: GooglePlace[];
    try {
      const r = await buscarPlacesPaginado(q, apiKey, pages);
      allPlaces = r.places;
    } catch (err) {
      const status = err instanceof GooglePlacesError ? err.httpStatus : 0;
      res.status(502).json({ error: 'Erro Google Places', http_status: status, body: String(err) });
      return;
    }

    // Cria registro da busca (tipo 'single' = busca rápida)
    const comTelefone = allPlaces.filter(p => p.nationalPhoneNumber || p.internationalPhoneNumber).length;
    const { data: searchRow, error: sErr } = await supabase.from('google_lead_searches').insert({
      criado_por: req.userId,
      tipo: 'single',
      query: q,
      total_resultados: allPlaces.length,
      com_telefone: comTelefone,
      status: 'concluido',
    }).select('id').single();
    if (sErr || !searchRow) { res.status(500).json({ error: 'Erro criando busca', detail: sErr?.message }); return; }

    // Insere leads (deduplica por place_id via índice único (search_id, place_id))
    if (allPlaces.length > 0) {
      const seen = new Set<string>();
      const rows = allPlaces
        .filter(p => p.id && !seen.has(p.id) && seen.add(p.id))
        .map(p => placeToRow(searchRow.id, p));
      if (rows.length > 0) {
        const { error: lErr } = await supabase.from('google_leads')
          .upsert(rows, { onConflict: 'search_id,place_id', ignoreDuplicates: true });
        if (lErr) { res.status(500).json({ error: 'Erro inserindo leads', detail: lErr.message }); return; }
      }
    }

    // Retorna leads recém-inseridos
    const { data: leads } = await supabase.from('google_leads')
      .select('*').eq('search_id', searchRow.id).order('rating', { ascending: false, nullsFirst: false });

    res.json({
      search_id: searchRow.id,
      query: q,
      total: allPlaces.length,
      com_telefone: comTelefone,
      leads: leads ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro buscando Google Places', message: String(err) });
  }
});

// ── Varredura estadual: INICIA o job ────────────────────────────────────────
// Cria a busca como 'rodando', guarda uf/categoria, conta municípios via IBGE
// e retorna search_id na hora. A aba então chama /tick em loop.
router.post('/leads/google/scan/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uf: rawUf, categoria: rawCat } = req.body as { uf?: string; categoria?: string };
    const uf = (rawUf || '').trim().toUpperCase();
    const categoria = (rawCat || '').trim();
    if (!UFS_BR.includes(uf)) { res.status(400).json({ error: 'UF inválida' }); return; }
    if (!categoria) { res.status(400).json({ error: 'categoria obrigatoria' }); return; }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    let municipiosTotal: number;
    try {
      municipiosTotal = (await fetchMunicipiosIBGE(uf)).length;
    } catch {
      res.status(502).json({ error: 'Erro consultando IBGE — tente de novo' });
      return;
    }

    const { data: searchRow, error: sErr } = await supabase.from('google_lead_searches').insert({
      criado_por: req.userId,
      tipo: 'varredura',
      uf,
      categoria,
      query: `${categoria} — ${uf} (varredura)`,
      status: 'rodando',
      municipios_total: municipiosTotal,
      municipios_processados: 0,
      requests_feitos: 0,
      total_resultados: 0,
      com_telefone: 0,
      cancelar: false,
    }).select('id').single();
    if (sErr || !searchRow) { res.status(500).json({ error: 'Erro criando varredura', detail: sErr?.message }); return; }

    res.json({
      search_id: searchRow.id,
      municipios_total: municipiosTotal,
      projecao_requests: municipiosTotal * 3,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro iniciando varredura', message: String(err) });
  }
});

// ── Varredura estadual: processa UMA fatia (dirigido pela aba) ───────────────
const SCAN_BATCH = 24;          // municípios por fatia (limitado pelo time-box)
const SCAN_CONCURRENCY = 8;     // queries simultâneas dentro da fatia
// Time-box CURTO de propósito: o tick fala com a aba via proxy edge /_api, que
// tem um teto de resposta menor que o maxDuration de 300s da função. Mantendo o
// budget bem abaixo desse teto, um tick nunca é morto no meio (o que viraria
// loop que gasta na Google sem avançar o cursor). Mais ticks, cada um seguro.
const SCAN_TICK_BUDGET_MS = 22000;  // para de pegar novos municípios após ~22s
const SCAN_LEASE_MS = 60000;        // lease > budget + margem (cobre crash)

router.post('/leads/google/scan/:id/tick', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) { res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY nao configurado' }); return; }

    const nowIso = new Date().toISOString();
    const lockUntil = new Date(Date.now() + SCAN_LEASE_MS).toISOString();

    // 1) Claim atômico do lease: só pega se status='rodando', não cancelado e
    //    lock livre/expirado. Duas abas (ou um cron) não dirigem o mesmo job.
    const { data: claimed } = await supabase
      .from('google_lead_searches')
      .update({ locked_until: lockUntil })
      .eq('id', id)
      .eq('status', 'rodando')
      .eq('cancelar', false)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select('id, uf, categoria, municipios_processados, requests_feitos, falhas, falhas_consecutivas')
      .maybeSingle();

    if (!claimed) {
      // Pode ser: cancelado, já concluído, ou outra aba segurando o lock.
      const { data: cur } = await supabase
        .from('google_lead_searches')
        .select('status, cancelar, municipios_processados, municipios_total, total_resultados, com_telefone, requests_feitos')
        .eq('id', id).maybeSingle();
      if (cur?.cancelar && cur.status === 'rodando') {
        // Cancelamento pedido: finaliza como 'parado'.
        await supabase.from('google_lead_searches')
          .update({ status: 'parado', locked_until: null }).eq('id', id);
        res.json({ claimed: false, done: true, ...cur, status: 'parado' });
        return;
      }
      res.json({ claimed: false, ...(cur ?? {}), done: cur?.status !== 'rodando', status: cur?.status ?? 'desconhecido' });
      return;
    }

    const uf = claimed.uf as string;
    const categoria = claimed.categoria as string;
    const base = claimed.municipios_processados as number;
    const falhasAtuais = Array.isArray(claimed.falhas) ? claimed.falhas : [];

    // 2) Re-busca a lista IBGE (fonte da verdade de total/cursor). Blip → retry
    //    sem avançar; 3 consecutivos → 'erro'. Nunca matar o job por um blip.
    let municipios: Municipio[];
    try {
      municipios = await fetchMunicipiosIBGE(uf);
    } catch {
      const nConsec = (claimed.falhas_consecutivas as number) + 1;
      if (nConsec >= 3) {
        await supabase.from('google_lead_searches')
          .update({ status: 'erro', falhas_consecutivas: nConsec, locked_until: null }).eq('id', id);
        res.json({ claimed: true, done: true, status: 'erro', error: 'IBGE indisponível' });
        return;
      }
      await supabase.from('google_lead_searches')
        .update({ falhas_consecutivas: nConsec, locked_until: null }).eq('id', id);
      res.json({ claimed: true, retry: true, status: 'rodando' });
      return;
    }

    const total = municipios.length;
    if (base >= total) {
      await supabase.from('google_lead_searches')
        .update({ status: 'concluido', municipios_processados: total, locked_until: null }).eq('id', id);
      res.json({ claimed: true, done: true, status: 'concluido', municipios_processados: total, municipios_total: total });
      return;
    }

    // 3) Fatia [base : base+BATCH], processada em chunks concorrentes com time-box.
    const fatia = municipios.slice(base, base + SCAN_BATCH);
    const inicio = Date.now();
    let processedThisTick = 0;
    let requestsThisTick = 0;
    const placesColetados: GooglePlace[] = [];
    const novasFalhas: Array<{ id: number; nome: string }> = [];

    for (let i = 0; i < fatia.length; i += SCAN_CONCURRENCY) {
      if (Date.now() - inicio > SCAN_TICK_BUDGET_MS) break; // time-box: termina o tick
      const grupo = fatia.slice(i, i + SCAN_CONCURRENCY);
      const results = await Promise.allSettled(grupo.map(async (m) => {
        const query = `${categoria} ${m.nome} ${uf}`;
        try {
          return await buscarPlacesPaginado(query, apiKey);
        } catch (err) {
          // 1 retry inline (blip/rate-limit transitório)
          if (err instanceof GooglePlacesError && err.transient) {
            await sleep(1500);
            return await buscarPlacesPaginado(query, apiKey);
          }
          throw err;
        }
      }));
      results.forEach((r, idx) => {
        const m = grupo[idx];
        if (r.status === 'fulfilled') {
          placesColetados.push(...r.value.places);
          requestsThisTick += r.value.requests;
        } else {
          // Falha persistente: registra e segue (não bloqueia o cursor).
          novasFalhas.push({ id: m.id, nome: m.nome });
        }
        processedThisTick++; // concluído = sucesso OU falha registrada
      });
    }

    // 4) Upsert dedup dos places coletados (índice único (search_id, place_id)).
    if (placesColetados.length > 0) {
      const seen = new Set<string>();
      const rows = placesColetados
        .filter(p => p.id && !seen.has(p.id) && seen.add(p.id))
        .map(p => placeToRow(id, p));
      if (rows.length > 0) {
        await supabase.from('google_leads')
          .upsert(rows, { onConflict: 'search_id,place_id', ignoreDuplicates: true });
      }
    }

    // 5) Recomputa contadores (idempotente) e avança o cursor pelo nº REAL.
    const { count: totalResultados } = await supabase.from('google_leads')
      .select('id', { count: 'exact', head: true }).eq('search_id', id);
    const { count: comTelefone } = await supabase.from('google_leads')
      .select('id', { count: 'exact', head: true }).eq('search_id', id).not('telefone', 'is', null);

    const novoProcessados = base + processedThisTick;
    const done = novoProcessados >= total;

    await supabase.from('google_lead_searches').update({
      municipios_processados: novoProcessados,
      requests_feitos: (claimed.requests_feitos as number) + requestsThisTick,
      total_resultados: totalResultados ?? 0,
      com_telefone: comTelefone ?? 0,
      falhas: [...falhasAtuais, ...novasFalhas],
      falhas_consecutivas: 0,
      status: done ? 'concluido' : 'rodando',
      locked_until: null,
    }).eq('id', id);

    res.json({
      claimed: true,
      done,
      status: done ? 'concluido' : 'rodando',
      municipios_processados: novoProcessados,
      municipios_total: total,
      total_resultados: totalResultados ?? 0,
      com_telefone: comTelefone ?? 0,
      requests_feitos: (claimed.requests_feitos as number) + requestsThisTick,
    });
  } catch (err) {
    // Libera o lock pra próxima tentativa não ficar travada no lease.
    await supabase.from('google_lead_searches').update({ locked_until: null }).eq('id', id);
    res.status(500).json({ error: 'Erro no tick da varredura', message: String(err) });
  }
});

// ── Varredura estadual: pede cancelamento (cobre tab-close) ──────────────────
router.post('/leads/google/scan/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase.from('google_lead_searches')
      .update({ cancelar: true }).eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro cancelando', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro cancelando varredura', message: String(err) });
  }
});

// ── Varredura estadual: re-arma um job 'parado'/'erro' pra continuar do cursor ─
// Não ressuscita 'concluido'. Limpa cancelar/lock/falhas e volta pra 'rodando';
// o tick continua de municipios_processados (upsert torna re-tentativa segura).
router.post('/leads/google/scan/:id/resume', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('google_lead_searches')
      .update({ status: 'rodando', cancelar: false, falhas_consecutivas: 0, locked_until: null })
      .eq('id', req.params.id)
      .eq('tipo', 'varredura')
      .in('status', ['parado', 'erro', 'rodando'])
      .select('id, municipios_total, municipios_processados, total_resultados, com_telefone, requests_feitos')
      .maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro retomando', detail: error.message }); return; }
    if (!data) { res.status(409).json({ error: 'Varredura não pode ser retomada (já concluída?)' }); return; }
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Erro retomando varredura', message: String(err) });
  }
});

// ── Estado do job (p/ barra de progresso + retomar ao recarregar) ────────────
router.get('/leads/google/searches/:id/progress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('google_lead_searches')
      .select('id, tipo, uf, categoria, query, status, cancelar, municipios_total, municipios_processados, requests_feitos, total_resultados, com_telefone, falhas')
      .eq('id', req.params.id).maybeSingle();
    if (error) { res.status(500).json({ error: 'Erro progress', detail: error.message }); return; }
    if (!data) { res.status(404).json({ error: 'Busca não encontrada' }); return; }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro progress', message: String(err) });
  }
});

router.get('/leads/google/searches', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { data, error } = await supabase
      .from('google_lead_searches')
      .select('id, criado_em, query, total_resultados, com_telefone, status, tipo, uf, categoria, municipios_total, municipios_processados, requests_feitos')
      .order('criado_em', { ascending: false })
      .limit(limit);
    if (error) { res.status(500).json({ error: 'Erro listando buscas', detail: error.message }); return; }
    res.json({ searches: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro list searches', message: String(err) });
  }
});

router.get('/leads/google/searches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // Pagina em blocos de 1000 (teto do PostgREST) até esgotar — uma varredura
    // estadual pode ter milhares de leads, e um select simples cortaria em 1000.
    const PAGE = 1000;
    const todos: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('google_leads')
        .select('*')
        .eq('search_id', req.params.id)
        .order('rating', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true }) // desempate estável entre páginas
        .range(from, from + PAGE - 1);
      if (error) { res.status(500).json({ error: 'Erro buscando leads', detail: error.message }); return; }
      const lote = data ?? [];
      todos.push(...lote);
      if (lote.length < PAGE) break;
    }
    res.json({ leads: todos });
  } catch (err) {
    res.status(500).json({ error: 'Erro get leads', message: String(err) });
  }
});

router.delete('/leads/google/searches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase.from('google_lead_searches').delete().eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Erro deletando busca', detail: error.message }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro delete search', message: String(err) });
  }
});


// ── ATENDENTE DE ANÚNCIO (SolarDoc) — aba /admin/hubs → SolarDoc → Atendente ──
// O texto do system prompt vive em `system_state` pra ser editável sem deploy; o
// padrão de fábrica mora no código. GET devolve os dois + os números vivos que
// resolvem os placeholders, porque é isso que impede o prompt de envelhecer
// (152 empresas viraram 154 em duas semanas — número digitado mente sozinho).
router.get('/atendente-prompt', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data } = await supabase
      .from('system_state').select('value, updated_at').eq('key', ATENDENTE_PROMPT_KEY).maybeSingle();
    const salvo = (data?.value ?? null) as { texto?: string; por?: string } | null;
    const texto = typeof salvo?.texto === 'string' && salvo.texto.trim() ? salvo.texto : PROMPT_PADRAO;
    const numeros = await numerosVivos().catch(() => ({}));
    res.json({
      texto,
      padrao: PROMPT_PADRAO,
      editado: texto !== PROMPT_PADRAO,
      atualizado_em: data?.updated_at ?? null,
      atualizado_por: salvo?.por ?? null,
      placeholders: PLACEHOLDERS,
      numeros,
      resolvido: resolverPlaceholders(texto, numeros),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// PUT grava a versão vigente. Texto vazio seria um agente sem cabeça — recusa.
router.put('/atendente-prompt', async (req: Request, res: Response): Promise<void> => {
  try {
    const texto = String((req.body as { texto?: string })?.texto ?? '');
    if (!texto.trim()) { res.status(400).json({ error: 'texto_vazio' }); return; }
    // O auth so' poe userId no request (uuid). Guardar uuid aqui deixaria a tela
    // dizendo 'atualizado por 7f3a-...', que nao identifica ninguem — entao troca
    // pelo e-mail; se a busca falhar, guarda 'admin' em vez de um id cru.
    const uid = (req as any).userId as string | undefined;
    let por = 'admin';
    if (uid) {
      const { data: quem } = await supabase.from('users').select('email').eq('id', uid).maybeSingle();
      por = quem?.email || 'admin';
    }
    const { error } = await supabase.from('system_state').upsert(
      { key: ATENDENTE_PROMPT_KEY, value: { texto, por }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true, editado: texto !== PROMPT_PADRAO });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

// DELETE volta pro padrão de fábrica (apaga a versão editada). Reversível: o
// padrão está no código, então nada se perde de verdade.
router.delete('/atendente-prompt', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { error } = await supabase.from('system_state').delete().eq('key', ATENDENTE_PROMPT_KEY);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || err) });
  }
});

export default router;
