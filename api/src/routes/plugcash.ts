import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import { logger } from '../utils/logger';
import { criarSessaoPlugcash } from '../services/plugcashCheckout';

// ─────────────────────────────────────────────────────────────────────────────
// PLUGCASH — API do app de conteúdo do mercado de eletroposto.
//
// O funil: lead nota 1 (0–4 pts na régua da /io/eletroposto) não vê agenda, cai
// na página de venda do produto de entrada, compra, e entra aqui. Dentro do app
// os outros cursos aparecem TRAVADOS; o cadeado abre a página de venda daquele
// curso, comprável a qualquer momento.
//
// Três regras moldam este arquivo:
//
//  1. NADA de preço ou link de checkout no código. Os dois moram em `pc_cursos`
//     e `pc_servicos`, editáveis pelo /admin. Se você está tentado a escrever um
//     número aqui, está no arquivo errado.
//  2. Curso em rascunho não existe pro mundo. Todo endpoint público filtra
//     `status='publicado'` — curso sem aula gravada não pode ser vendido.
//  3. `video_url` NUNCA sai numa resposta pública. A grade de aulas é aberta de
//     propósito (saber o que está perdendo converte melhor que borrão), mas a URL
//     do vídeo só sai em /aula/:id, depois de conferir o acesso.
//
// Auth é o JWT do próprio solardoc.app (authMiddleware), não Supabase Auth —
// quem já tem conta no SolarDoc entra sem cadastro novo. Ser membro do PlugCash
// é ter linha em `pc_membros`; poder abrir um curso é ter linha em `pc_acessos`
// OU ter o nível que o curso exige.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Campos que podem sair numa resposta pública. Lista explícita, não `select('*')`:
// coluna nova entra no banco sem vazar pro mundo por descuido.
const CURSO_PUBLICO =
  'id,slug,titulo,subtitulo,descricao,thumb_url,preco_centavos,preco_de_centavos,parcelas,nivel_exigido,resolve_motivo,ordem,copy';
const AULA_PUBLICA = 'id,curso_id,ordem,titulo,descricao,duracao_seg,gratuita';

// Hierarquia dos níveis: quem é Investidor abre o que o Integrador abre.
const NIVEIS = ['base', 'integrador', 'investidor', 'projeto'] as const;
type Nivel = (typeof NIVEIS)[number];
const alcanca = (tem: string | null | undefined, exige: string | null | undefined): boolean => {
  if (!exige) return true;                       // curso sem nível é de todos (compra avulsa)
  return NIVEIS.indexOf((tem || 'base') as Nivel) >= NIVEIS.indexOf(exige as Nivel);
};

// A resposta do onboarding é um empurrão, não a decisão: quem manda é o
// `motivo_descarte` que veio da régua. Por isso vale metade do peso lá embaixo.
const OBJETIVO_CURSO: Record<string, string> = {
  entender:  'fundamentos',
  executar:  'integrador',
  investir:  'ponto-zero',
  monetizar: 'operacao',
};

// ── Pré-visualização ────────────────────────────────────────────────────────
// Curso em rascunho não existe pro mundo — essa é a regra que impede um curso
// sem aula gravada de ser vendido. Mas alguém precisa VER como a página ficou
// antes de publicar, senão a única forma de revisar é publicando, que é
// exatamente o que a regra proíbe.
//
// Então: `?preview=1` mostra rascunho, e SÓ para quem é admin de verdade. O
// token é conferido no servidor e o `is_admin` é lido do banco a cada chamada —
// nada de confiar num parâmetro de querystring, que qualquer um digita.
async function ehAdminComPreview(req: Request): Promise<boolean> {
  if (req.query.preview !== '1') return false;
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const { verifyToken } = await import('../utils/jwt');
    const { userId } = verifyToken(auth.split(' ')[1]);
    const { data } = await supabase
      .from('users').select('is_admin').eq('id', userId).maybeSingle();
    return !!(data as any)?.is_admin;
  } catch {
    return false;
  }
}

// Em pré-visualização o filtro de status some; fora dela, ele é o guardrail.
const statusVisiveis = (preview: boolean) => preview ? ['rascunho', 'publicado'] : ['publicado'];

// ─────────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ─────────────────────────────────────────────────────────────────────────────

// Catálogo: tudo que está publicado, travado ou não. É o mesmo payload que
// alimenta o card travado no app e a vitrine pública.
router.get('/catalogo', async (req: Request, res: Response): Promise<void> => {
  try {
    const preview = await ehAdminComPreview(req);
    const status = statusVisiveis(preview);

    const { data: cursos, error } = await supabase
      .from('pc_cursos')
      .select(CURSO_PUBLICO)
      .in('status', status)
      .order('ordem');
    if (error) throw error;

    const ids = (cursos || []).map((c: any) => c.id);
    const { data: aulas } = ids.length
      ? await supabase.from('pc_aulas').select(AULA_PUBLICA)
          .in('curso_id', ids).in('status', status).order('ordem')
      : { data: [] as any[] };

    res.json({
      preview,
      cursos: (cursos || []).map((c: any) => ({
        ...c,
        aulas: (aulas || []).filter((a: any) => a.curso_id === c.id),
      })),
    });
  } catch (err) {
    logger.error('plugcash', 'falha no catalogo', err);
    res.status(500).json({ error: 'falha ao carregar catalogo' });
  }
});

// Página de venda de um curso — a tela que o cadeado abre.
router.get('/curso/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const preview = await ehAdminComPreview(req);
    const status = statusVisiveis(preview);

    const { data: curso, error } = await supabase
      .from('pc_cursos')
      // checkout_url entra aqui de propósito: é o destino do botão de compra.
      // Continua fora do código — quem o define é o /admin.
      .select(`${CURSO_PUBLICO},checkout_url,indexavel,status`)
      .eq('slug', String(req.params.slug))
      .in('status', status)
      .maybeSingle();
    if (error) throw error;
    if (!curso) { res.status(404).json({ error: 'curso nao encontrado' }); return; }

    const { data: aulas } = await supabase
      .from('pc_aulas').select(AULA_PUBLICA)
      .eq('curso_id', (curso as any).id).in('status', status).order('ordem');

    // O serviço que resolve a MESMA dor que o curso ensina a resolver sozinho.
    // O documento do projeto é explícito: a oferta tem que aparecer no fim do
    // conteúdo que cria a dor, porque "ninguém abre menu de serviços". O preço
    // vem daqui, não da copy — preço duplicado é o jeito mais rápido de a página
    // anunciar um valor que o checkout não cobra mais.
    const servicoSlug = (curso as any).copy?.servico_slug;
    let servico = null;
    if (servicoSlug) {
      const { data } = await supabase
        .from('pc_servicos')
        .select('slug,titulo,descricao,preco_centavos,checkout_url,entrega,prazo_dias')
        .eq('slug', servicoSlug).in('status', status).maybeSingle();
      servico = data || null;
    }

    // GRADE ≠ AULAS. `aulas` é o que o aluno pode ABRIR (só publicadas); `grade`
    // é o que a página de venda MOSTRA — a trilha inteira, com um sinal de
    // disponibilidade em cada linha.
    //
    // A página promete em voz alta "sem borrão e sem 'e muito mais'", e com o
    // curso ainda em produção ela entregava uma lista vazia: o pior estado
    // possível justo no bloco que mais decide a compra. Título e duração já são
    // públicos (é o que vende o curso); o CORPO da aula continua fora daqui.
    //
    // `disponivel` sai do status real, então a lista se corrige sozinha à medida
    // que as aulas sobem — não existe copy pra alguém esquecer de atualizar, e
    // não existe como a página dizer que uma aula está pronta antes de estar.
    const { data: gradeRaw } = await supabase
      .from('pc_aulas').select('ordem,titulo,duracao_seg,status')
      .eq('curso_id', (curso as any).id).order('ordem');
    const grade = (gradeRaw || []).map((a: any) => ({
      ordem: a.ordem,
      titulo: a.titulo,
      duracao_seg: a.duracao_seg,
      disponivel: a.status === 'publicado',
    }));

    res.json({ preview, curso: { ...curso, aulas: aulas || [], grade }, servico });
  } catch (err) {
    logger.error('plugcash', `falha no curso ${req.params.slug}`, err);
    res.status(500).json({ error: 'falha ao carregar curso' });
  }
});

// Abre o checkout. Público de propósito: o comprador ainda NÃO tem conta — ela
// nasce do webhook, depois do pagamento. Exigir login aqui inverteria a ordem e
// mataria a venda na porta.
//
// Se o curso tiver `checkout_url` cadastrado, é ele que volta. Só quando não
// tem é que uma sessão do Stripe é criada. Assim o dia em que a Kiwify existir
// não precisa de deploy.
router.post('/checkout', async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.body?.slug || '').trim();
  if (!slug) { res.status(400).json({ error: 'slug obrigatorio' }); return; }

  // Degrau da escada de preço (cheia → desconto → última). Sem ele, preço cheio.
  const oferta = String(req.body?.oferta || '').trim().slice(0, 40) || null;

  const r = await criarSessaoPlugcash({
    slug,
    bump: req.body?.bump === true,
    email: String(req.body?.email || '').trim().toLowerCase() || null,
    origem: String(req.body?.origem || '').slice(0, 80) || null,
    utm: req.body?.utm || {},
    oferta,
  });

  if (!r.ok) { res.status(400).json({ error: r.erro }); return; }

  await supabase.from('pc_eventos').insert({
    tipo: 'checkout_aberto',
    session_id: String(req.body?.session_id || '').slice(0, 80) || null,
    payload: { slug, bump: req.body?.bump === true, origem: req.body?.origem || null, oferta },
  }).then(() => {}, () => {});

  res.json({ url: r.url });
});

// Funil do nota 1: desqualificacao_view → material_view → checkout_start →
// purchase → app_first_open. Público porque a página de venda ainda é anônima.
router.post('/evento', async (req: Request, res: Response): Promise<void> => {
  const tipo = String(req.body?.tipo || '').trim().slice(0, 60);
  if (!tipo) { res.status(400).json({ error: 'tipo obrigatorio' }); return; }
  try {
    await supabase.from('pc_eventos').insert({
      tipo,
      session_id: String(req.body?.session_id || '').slice(0, 80) || null,
      payload: req.body?.payload ?? null,
    });
  } catch (err) {
    // Evento é telemetria: nunca pode derrubar a navegação de quem está comprando.
    logger.error('plugcash', `falha gravando evento ${tipo}`, err);
  }
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGADO
// ─────────────────────────────────────────────────────────────────────────────

// Telefone na forma canônica: DDD (2) + os 8 últimos dígitos.
// Espelha public.ep_tel_norm() no banco do gerador — é a MESMA regra dos dois
// lados da ponte. `users.whatsapp` chega com 10, 11 ou 13 dígitos (com ou sem o
// 55, às vezes mascarado); a ficha do eletroposto chega sempre com 13. Casar
// pelos últimos 10 dígitos comeria o primeiro dígito do DDD e faria 32999126804
// bater com 82999126804 — daí o corte ser DDD + 8, não "os últimos 10".
function telNorm(t?: string | null): string | null {
  const d = String(t || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    const local = d.slice(2);
    return local.slice(0, 2) + local.slice(-8);
  }
  if (d.length === 10 || d.length === 11) return d.slice(0, 2) + d.slice(-8);
  return null;
}

// Copia a qualificação do eletroposto pro membro. É a ÚNICA travessia entre os
// dois bancos (gerador-propostas ↔ solardoc-pro), e ela acontece uma vez: sem FK
// entre projetos Supabase, consultar em runtime seria uma chamada externa em
// toda abertura do app.
//
// Sem esse snapshot o bloco "seu próximo passo" nunca sai do texto genérico —
// ele decide pelo `motivo_descarte`, e é aqui que o campo chega.
// A ficha de NOTA 1 vem primeiro: é o público do PlugCash. Quem agendou (nota 2
// ou 3) só cai no `agendamentos` como plano B.
async function qualificacaoDoTelefone(telefone: string | null) {
  const norm = telNorm(telefone);
  if (!norm) return null;

  const campos = 'nota,motivo_descarte,tem_ponto,capital_faixa,e_decisor,perfil_slug,cidade,utm_source,utm_medium,utm_campaign,utm_content,utm_term';

  try {
    // Em `eletroposto_nota1` a pontuação mora em `pts` — coluna que já existia
    // antes da migration. O alias do PostgREST devolve os dois lados com o mesmo
    // nome, e `pc_membros` recebe um formato só.
    const { data: n1 } = await supabaseGerador
      .from('eletroposto_nota1').select(`id,pontuacao_total:pts,${campos}`)
      .eq('telefone_norm', norm).order('id', { ascending: false }).limit(1).maybeSingle();
    if (n1) return { ...(n1 as any), origem_tabela: 'eletroposto_nota1', origem_id: (n1 as any).id };

    const { data: ag } = await supabaseGerador
      .from('agendamentos').select(`id,pontuacao_total,${campos}`)
      .eq('telefone_norm', norm).order('id', { ascending: false }).limit(1).maybeSingle();
    if (ag) return { ...(ag as any), origem_tabela: 'agendamentos', origem_id: (ag as any).id };
  } catch (err) {
    // Banco do gerador fora do ar não pode impedir o aluno de abrir o app que
    // ele pagou. Sem snapshot, a recomendação cai no padrão — e só.
    logger.error('plugcash', `falha buscando qualificacao de ${norm}`, err);
  }
  return null;
}

// Garante a linha de membro. Usuário que veio do SolarDoc (assinante que clicou
// no PlugCash) e nunca passou pela LP entra como 'base' sem qualificação — e o
// app usa a recomendação padrão, sem fingir que sabe o que ele precisa.
async function garantirMembro(userId: string) {
  const { data } = await supabase.from('pc_membros').select('*').eq('user_id', userId).maybeSingle();
  if (data) return data as any;

  const { data: u } = await supabase.from('users').select('whatsapp').eq('id', userId).maybeSingle();
  const telefone = (u as any)?.whatsapp || null;
  const qualificacao = await qualificacaoDoTelefone(telefone);
  const { id: _ignora, ...snapshot } = (qualificacao || {}) as Record<string, unknown>;

  // upsert e não insert: duas chamadas simultâneas de /me (o app abre e o player
  // carrega junto) colidiriam na PK e devolveriam 500 pro aluno.
  const { data: novo } = await supabase
    .from('pc_membros')
    .upsert({ user_id: userId, telefone, ...snapshot }, { onConflict: 'user_id', ignoreDuplicates: false })
    .select('*')
    .single();
  return novo as any;
}

// O bloco "seu próximo passo": UMA recomendação, não uma lista.
// Peso 100 pro curso que resolve a falta que desqualificou o cara na régua —
// esse dado é resposta dele, não palpite. Peso 50 pro que casa com o objetivo do
// onboarding. Empate desempata pela ordem do catálogo.
function proximoPasso(membro: any, cursos: any[], liberados: Set<string>) {
  const motivos: string[] = membro?.motivo_descarte || [];
  const alvoObjetivo = OBJETIVO_CURSO[membro?.objetivo] || null;

  const ranked = cursos
    .filter((c) => !liberados.has(c.id))
    .map((c) => {
      let score = 0;
      if ((c.resolve_motivo || []).some((m: string) => motivos.includes(m))) score += 100;
      if (alvoObjetivo && c.slug === alvoObjetivo) score += 50;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || a.c.ordem - b.c.ordem);

  if (!ranked.length) return null;
  const escolhido = ranked[0];
  return {
    curso: escolhido.c,
    // Por que este e não outro. A tela mostra isso — recomendação sem motivo
    // parece anúncio; com motivo parece que alguém leu a resposta dele.
    porque: escolhido.score >= 100 ? 'motivo_descarte'
          : escolhido.score >= 50  ? 'objetivo'
          : 'ordem',
  };
}

router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const membro = await garantirMembro(req.userId);
    const preview = await ehAdminComPreview(req);
    const status = statusVisiveis(preview);

    const { data: u } = await supabase
      .from('users').select('is_admin').eq('id', req.userId).maybeSingle();

    const [{ data: cursos }, { data: acessos }, { data: progresso }] = await Promise.all([
      supabase.from('pc_cursos').select(CURSO_PUBLICO).in('status', status).order('ordem'),
      supabase.from('pc_acessos').select('curso_id,expira_em').eq('user_id', req.userId),
      supabase.from('pc_progresso').select('aula_id,pct,concluida').eq('user_id', req.userId),
    ]);

    const agora = Date.now();
    const porCompra = new Set(
      (acessos || [])
        .filter((a: any) => !a.expira_em || new Date(a.expira_em).getTime() > agora)
        .map((a: any) => a.curso_id)
    );
    // Acesso por nível não vira linha em pc_acessos: é resolvido aqui. Subir
    // alguém de nível libera o catálogo inteiro sem gravar linha nenhuma.
    const liberados = new Set<string>(porCompra);
    for (const c of cursos || []) {
      if ((c as any).nivel_exigido && alcanca(membro?.nivel, (c as any).nivel_exigido)) {
        liberados.add((c as any).id);
      }
    }

    const ids = (cursos || []).map((c: any) => c.id);
    const { data: aulas } = ids.length
      ? await supabase.from('pc_aulas').select(AULA_PUBLICA)
          .in('curso_id', ids).in('status', status).order('ordem')
      : { data: [] as any[] };

    const feitas = new Map((progresso || []).map((p: any) => [p.aula_id, p]));

    const catalogo = (cursos || []).map((c: any) => {
      const doCurso = (aulas || []).filter((a: any) => a.curso_id === c.id);
      const concluidas = doCurso.filter((a: any) => feitas.get(a.id)?.concluida).length;
      return {
        ...c,
        aulas: doCurso.map((a: any) => ({ ...a, progresso: feitas.get(a.id) || null })),
        liberado: liberados.has(c.id),
        // Curso de nível que ele não tem mostra o selo do nível no lugar do preço.
        trava: liberados.has(c.id) ? null : (c.nivel_exigido ? 'nivel' : 'preco'),
        progresso_pct: doCurso.length ? Math.round((concluidas / doCurso.length) * 100) : 0,
      };
    });

    res.json({
      preview,
      // Só pra decidir se o menu mostra a seção interna. O acesso de verdade é
      // conferido no servidor a cada rota de /admin — esconder item de menu
      // nunca foi controle de acesso.
      admin: !!(u as any)?.is_admin,
      membro: {
        nivel: membro?.nivel || 'base',
        objetivo: membro?.objetivo || null,
        nota: membro?.nota ?? null,
        motivo_descarte: membro?.motivo_descarte || [],
        onboarding_pendente: !membro?.objetivo,
      },
      catalogo,
      proximo_passo: proximoPasso(membro, cursos || [], liberados),
    });
  } catch (err) {
    logger.error('plugcash', 'falha no /me', err);
    res.status(500).json({ error: 'falha ao carregar app' });
  }
});

router.post('/onboarding', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const objetivo = String(req.body?.objetivo || '');
  if (!Object.keys(OBJETIVO_CURSO).includes(objetivo)) {
    res.status(400).json({ error: 'objetivo invalido' }); return;
  }
  try {
    await garantirMembro(req.userId);
    await supabase.from('pc_membros').update({ objetivo }).eq('user_id', req.userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('plugcash', 'falha no onboarding', err);
    res.status(500).json({ error: 'falha ao salvar' });
  }
});

// A única porta por onde `video_url` sai. Confere acesso ANTES de ler a aula.
router.get('/aula/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Admin com ?preview=1 abre aula em rascunho — é a única forma de conferir
    // o conteúdo antes de publicar, que é exatamente o que a regra do rascunho
    // impede de outro jeito.
    const preview = await ehAdminComPreview(req);

    const { data: aula } = await supabase
      .from('pc_aulas')
      .select('id,curso_id,ordem,titulo,descricao,duracao_seg,video_url,material_url,gratuita,paginas,oferta_servico_slug,oferta_curso_slug')
      .eq('id', String(req.params.id))
      .in('status', statusVisiveis(preview))
      .maybeSingle();
    if (!aula) { res.status(404).json({ error: 'aula nao encontrada' }); return; }

    if (!(aula as any).gratuita && !preview) {
      const membro = await garantirMembro(req.userId);
      const { data: curso } = await supabase
        .from('pc_cursos').select('nivel_exigido').eq('id', (aula as any).curso_id).single();
      const { data: acesso } = await supabase
        .from('pc_acessos').select('expira_em')
        .eq('user_id', req.userId).eq('curso_id', (aula as any).curso_id).maybeSingle();

      const valeAgora = acesso && (!(acesso as any).expira_em
        || new Date((acesso as any).expira_em).getTime() > Date.now());
      const porNivel = alcanca(membro?.nivel, (curso as any)?.nivel_exigido);

      if (!valeAgora && !porNivel) { res.status(403).json({ error: 'sem acesso' }); return; }
    }

    // ── A oferta que esta aula acabou de justificar ──
    // O documento é explícito: a oferta aparece no fim da aula que cria a dor,
    // porque "ninguém abre menu de serviços". Fora desse minuto, a mesma oferta
    // é ruído — e ruído no meio de um curso técnico queima a confiança que o
    // curso acabou de construir.
    //
    // Uma só, nunca duas. E nada é oferecido para quem já tem: quem comprou o
    // Ponto Zero não pode ver "compre o Ponto Zero" no fim da aula 3.
    let oferta: Record<string, unknown> | null = null;
    const a = aula as any;

    if (a.oferta_servico_slug) {
      const { data } = await supabase
        .from('pc_servicos')
        .select('slug,titulo,descricao,preco_centavos,checkout_url,entrega,prazo_dias')
        .eq('slug', a.oferta_servico_slug).in('status', statusVisiveis(preview)).maybeSingle();
      if (data) oferta = { tipo: 'servico', ...(data as any) };
    }

    if (!oferta && a.oferta_curso_slug) {
      const { data: cursoOfertado } = await supabase
        .from('pc_cursos')
        .select('id,slug,titulo,subtitulo,preco_centavos,checkout_url,nivel_exigido')
        .eq('slug', a.oferta_curso_slug).in('status', statusVisiveis(preview)).maybeSingle();

      if (cursoOfertado) {
        const { data: jaTem } = await supabase
          .from('pc_acessos').select('id')
          .eq('user_id', req.userId).eq('curso_id', (cursoOfertado as any).id).maybeSingle();
        const membro = await garantirMembro(req.userId);
        const porNivel = alcanca(membro?.nivel, (cursoOfertado as any).nivel_exigido);
        if (!jaTem && !porNivel) oferta = { tipo: 'curso', ...(cursoOfertado as any) };
      }
    }

    res.json({ aula, oferta });
  } catch (err) {
    logger.error('plugcash', `falha na aula ${req.params.id}`, err);
    res.status(500).json({ error: 'falha ao carregar aula' });
  }
});

router.post('/progresso', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const aulaId = String(req.body?.aula_id || '');
  const pct = Math.max(0, Math.min(100, Number(req.body?.pct) || 0));
  if (!aulaId) { res.status(400).json({ error: 'aula_id obrigatorio' }); return; }
  try {
    await supabase.from('pc_progresso').upsert({
      user_id: req.userId, aula_id: aulaId, pct,
      concluida: pct >= 95, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,aula_id' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('plugcash', 'falha no progresso', err);
    res.status(500).json({ error: 'falha ao salvar progresso' });
  }
});

// O ciclo que fecha o modelo: ele entrou porque faltava algo (ponto, capital,
// sócio). Quando declara que resolveu, vira candidato a VOLTAR pra agenda —
// agora como nota 3. O /admin lista quem ficou elegível.
const MOTIVOS_VALIDOS = ['sem_ponto', 'sem_capital', 'nao_decisor', 'fluxo_baixo'];
router.post('/resolvi', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const quais = (Array.isArray(req.body?.motivos) ? req.body.motivos : [])
    .map((m: unknown) => String(m))
    .filter((m: string) => MOTIVOS_VALIDOS.includes(m));
  if (!quais.length) { res.status(400).json({ error: 'motivos invalidos' }); return; }
  try {
    await garantirMembro(req.userId);
    await supabase.from('pc_membros')
      .update({ resolveu_em: new Date().toISOString(), resolveu_o_que: quais })
      .eq('user_id', req.userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('plugcash', 'falha marcando resolvido', err);
    res.status(500).json({ error: 'falha ao salvar' });
  }
});

// ── Esteira de serviços ─────────────────────────────────────────────────────
// O que o aluno compra além dos cursos — e é onde o negócio ganha margem.
// Cada item tem CAPACIDADE MENSAL: atingido o teto, vira lista de espera. Isso
// não é escassez de marketing, é o número de entregas que a engenharia aguenta
// sem estourar prazo. Estourar prazo aqui queima a marca que vende eletroposto
// de R$ 160 mil, então o teto é proteção, não gatilho.
router.get('/servicos', async (req: Request, res: Response): Promise<void> => {
  try {
    const preview = await ehAdminComPreview(req);
    const [{ data: servicos }, { data: capacidade }] = await Promise.all([
      supabase.from('pc_servicos')
        .select('id,slug,titulo,descricao,preco_centavos,checkout_url,capacidade_mensal,resolve_motivo,nivel_exigido,ordem,copy,entrega,prazo_dias')
        .in('status', statusVisiveis(preview)).order('ordem'),
      supabase.from('pc_servicos_capacidade').select('*'),
    ]);

    const usados = new Map((capacidade || []).map((c: any) => [c.servico_id, c.usados_no_mes]));

    // Sem token a lista sai igual, só sem a ordenação por motivo. A esteira é
    // pública de propósito: ela também é argumento de venda do produto de entrada.
    let motivos: string[] = [];
    let nivel = 'base';
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const { verifyToken } = await import('../utils/jwt');
        const { userId } = verifyToken(auth.split(' ')[1]);
        const { data: m } = await supabase
          .from('pc_membros').select('motivo_descarte,nivel').eq('user_id', userId).maybeSingle();
        motivos = (m as any)?.motivo_descarte || [];
        nivel = (m as any)?.nivel || 'base';
      } catch { /* token inválido: segue como visitante */ }
    }

    const lista = (servicos || []).map((s: any) => {
      const usado = Number(usados.get(s.id) || 0);
      const teto = s.capacidade_mensal;
      return {
        ...s,
        capacidade_usada: usado,
        // null = sem teto configurado. Nunca devolver "disponível" por omissão
        // seria pior: um serviço sem teto é decisão do admin, não descuido.
        disponivel: teto == null ? true : usado < teto,
        vagas_restantes: teto == null ? null : Math.max(0, teto - usado),
        liberado_pelo_nivel: alcanca(nivel, s.nivel_exigido),
        prioritario: (s.resolve_motivo || []).some((m: string) => motivos.includes(m)),
      };
    });

    // Serviço que resolve a falta DELE vem primeiro. Ordem do admin desempata.
    lista.sort((a: any, b: any) => Number(b.prioritario) - Number(a.prioritario) || a.ordem - b.ordem);
    res.json({ preview, servicos: lista });
  } catch (err) {
    logger.error('plugcash', 'falha na esteira', err);
    res.status(500).json({ error: 'falha ao carregar servicos' });
  }
});

// ── Conta ───────────────────────────────────────────────────────────────────
router.get('/conta', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const membro = await garantirMembro(req.userId);
    const [{ data: compras }, { data: creditos }, { data: user }] = await Promise.all([
      supabase.from('pc_compras')
        .select('id,item_tipo,item_slug,valor_centavos,status,created_at')
        .eq('user_id', req.userId).order('created_at', { ascending: false }),
      supabase.from('pc_creditos')
        .select('id,valor_centavos,validade,usado_em').eq('user_id', req.userId),
      supabase.from('users').select('email,nome,whatsapp').eq('id', req.userId).maybeSingle(),
    ]);

    const agora = Date.now();
    const validos = (creditos || []).filter((c: any) =>
      !c.usado_em && (!c.validade || new Date(c.validade).getTime() > agora));

    res.json({
      usuario: user || null,
      membro: {
        nivel: membro?.nivel || 'base',
        objetivo: membro?.objetivo || null,
        motivo_descarte: membro?.motivo_descarte || [],
        resolveu_em: membro?.resolveu_em || null,
        resolveu_o_que: membro?.resolveu_o_que || [],
      },
      compras: compras || [],
      // O que ele pagou em curso abate no upgrade pra Integrador ou Mentoria.
      credito_centavos: validos.reduce((s: number, c: any) => s + (c.valor_centavos || 0), 0),
      creditos: validos,
    });
  } catch (err) {
    logger.error('plugcash', 'falha na conta', err);
    res.status(500).json({ error: 'falha ao carregar conta' });
  }
});

// Pós-compra: a tela de obrigado precisa saber o que foi liberado e como entrar,
// sem exigir que a pessoa já esteja logada (ela acabou de sair do gateway).
router.get('/obrigado/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: curso } = await supabase
      .from('pc_cursos').select('titulo,subtitulo,slug').eq('slug', String(req.params.slug)).maybeSingle();
    res.json({ curso: curso || null });
  } catch {
    res.json({ curso: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — é aqui que preço, link de checkout e publicação são definidos.
// Sem esta parte no ar, popular o catálogo exigiria um deploy por curso.
// ─────────────────────────────────────────────────────────────────────────────

const admin = [authMiddleware, adminMiddleware];

router.get('/admin/cursos', ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data: cursos } = await supabase.from('pc_cursos').select('*').order('ordem');
    const { data: aulas } = await supabase.from('pc_aulas').select('*').order('ordem');
    res.json({
      cursos: (cursos || []).map((c: any) => ({
        ...c, aulas: (aulas || []).filter((a: any) => a.curso_id === c.id),
      })),
    });
  } catch (err) {
    logger.error('plugcash', 'falha listando cursos no admin', err);
    res.status(500).json({ error: 'falha ao listar' });
  }
});

const CAMPOS_CURSO = ['slug', 'titulo', 'subtitulo', 'descricao', 'thumb_url', 'preco_centavos',
  'preco_de_centavos', 'parcelas', 'checkout_url', 'nivel_exigido', 'resolve_motivo', 'ordem',
  'status', 'indexavel', 'copy'];

router.post('/admin/cursos', ...admin, async (req: Request, res: Response): Promise<void> => {
  const body = req.body || {};
  const patch: Record<string, unknown> = {};
  for (const k of CAMPOS_CURSO) if (k in body) patch[k] = body[k];

  // Publicar exige aula publicada. É o guardrail do projeto virado em código:
  // curso no ar sem aula gravada gera reembolso, e a base é a mesma do SolarDoc.
  if (patch.status === 'publicado' && body.id) {
    const { count } = await supabase.from('pc_aulas')
      .select('id', { count: 'exact', head: true })
      .eq('curso_id', body.id).eq('status', 'publicado');
    if (!count) {
      res.status(400).json({ error: 'curso sem aula publicada nao pode ir ao ar' }); return;
    }
  }

  try {
    const q = body.id
      ? supabase.from('pc_cursos').update(patch).eq('id', String(body.id)).select('*').single()
      : supabase.from('pc_cursos').insert(patch).select('*').single();
    const { data, error } = await q;
    if (error) throw error;
    res.json({ curso: data });
  } catch (err) {
    logger.error('plugcash', 'falha salvando curso', err);
    res.status(500).json({ error: 'falha ao salvar curso' });
  }
});

const CAMPOS_AULA = ['curso_id', 'ordem', 'titulo', 'descricao', 'duracao_seg', 'video_url',
  'material_url', 'gratuita', 'status', 'paginas'];

// O diagrama de cada página é SVG inline, escrito pelo admin e renderizado como
// HTML no player. Admin é confiável, mas SVG carrega script — e uma conta de
// admin comprometida não pode virar execução de código na sessão de todo aluno.
// A validação é na GRAVAÇÃO, não na leitura: barra na porta em vez de confiar
// que toda tela lembre de limpar.
const SVG_PROIBIDO = /<\s*script|<\s*foreignObject|\son\w+\s*=|javascript:/i;

function paginasSeguras(paginas: unknown): { ok: true } | { ok: false; erro: string } {
  if (!Array.isArray(paginas)) return { ok: false, erro: 'paginas precisa ser uma lista' };
  for (const [i, p] of paginas.entries()) {
    const svg = (p as any)?.svg;
    if (typeof svg === 'string' && SVG_PROIBIDO.test(svg)) {
      return { ok: false, erro: `o diagrama da pagina ${i + 1} tem script ou evento — recusado` };
    }
  }
  return { ok: true };
}

router.post('/admin/aulas', ...admin, async (req: Request, res: Response): Promise<void> => {
  const body = req.body || {};
  const patch: Record<string, unknown> = {};
  for (const k of CAMPOS_AULA) if (k in body) patch[k] = body[k];

  if ('paginas' in patch) {
    const v = paginasSeguras(patch.paginas);
    if (!v.ok) { res.status(400).json({ error: v.erro }); return; }
  }

  try {
    const q = body.id
      ? supabase.from('pc_aulas').update(patch).eq('id', String(body.id)).select('*').single()
      : supabase.from('pc_aulas').insert(patch).select('*').single();
    const { data, error } = await q;
    if (error) throw error;
    res.json({ aula: data });
  } catch (err) {
    logger.error('plugcash', 'falha salvando aula', err);
    res.status(500).json({ error: 'falha ao salvar aula' });
  }
});

router.delete('/admin/aulas/:id', ...admin, async (req: Request, res: Response): Promise<void> => {
  try {
    await supabase.from('pc_aulas').delete().eq('id', String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error('plugcash', 'falha removendo aula', err);
    res.status(500).json({ error: 'falha ao remover' });
  }
});

// ── Serviços da esteira ─────────────────────────────────────────────────────
const CAMPOS_SERVICO = ['slug', 'titulo', 'descricao', 'preco_centavos', 'checkout_url',
  'capacidade_mensal', 'resolve_motivo', 'nivel_exigido', 'ordem', 'status', 'copy',
  'entrega', 'prazo_dias'];

router.get('/admin/servicos', ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [{ data: servicos }, { data: capacidade }] = await Promise.all([
      supabase.from('pc_servicos').select('*').order('ordem'),
      supabase.from('pc_servicos_capacidade').select('*'),
    ]);
    const usados = new Map((capacidade || []).map((c: any) => [c.servico_id, c.usados_no_mes]));
    res.json({
      servicos: (servicos || []).map((s: any) => ({ ...s, capacidade_usada: Number(usados.get(s.id) || 0) })),
    });
  } catch (err) {
    logger.error('plugcash', 'falha listando servicos', err);
    res.status(500).json({ error: 'falha ao listar servicos' });
  }
});

router.post('/admin/servicos', ...admin, async (req: Request, res: Response): Promise<void> => {
  const body = req.body || {};
  const patch: Record<string, unknown> = {};
  for (const k of CAMPOS_SERVICO) if (k in body) patch[k] = body[k];
  try {
    const q = body.id
      ? supabase.from('pc_servicos').update(patch).eq('id', String(body.id)).select('*').single()
      : supabase.from('pc_servicos').insert(patch).select('*').single();
    const { data, error } = await q;
    if (error) throw error;
    res.json({ servico: data });
  } catch (err) {
    logger.error('plugcash', 'falha salvando servico', err);
    res.status(500).json({ error: 'falha ao salvar servico' });
  }
});

// ── Mapeamento produto do gateway → item do PlugCash ────────────────────────
// Sem isto cadastrado, a venda entra na Kiwify e o comprador não recebe nada:
// o webhook não sabe a que curso o produto corresponde.
router.get('/admin/gateway', ...admin, async (_req: Request, res: Response): Promise<void> => {
  const { data } = await supabase.from('pc_gateway_produtos').select('*').order('item_slug');
  res.json({ produtos: data || [] });
});

router.post('/admin/gateway', ...admin, async (req: Request, res: Response): Promise<void> => {
  const b = req.body || {};
  const patch: Record<string, unknown> = {};
  for (const k of ['gateway', 'produto_id', 'produto_nome', 'item_tipo', 'item_slug',
                   'concede_nivel', 'gera_credito', 'ativo']) if (k in b) patch[k] = b[k];
  try {
    const q = b.id
      ? supabase.from('pc_gateway_produtos').update(patch).eq('id', String(b.id)).select('*').single()
      : supabase.from('pc_gateway_produtos').insert(patch).select('*').single();
    const { data, error } = await q;
    if (error) throw error;
    res.json({ produto: data });
  } catch (err) {
    logger.error('plugcash', 'falha salvando mapeamento de gateway', err);
    res.status(500).json({ error: 'falha ao salvar' });
  }
});

router.delete('/admin/gateway/:id', ...admin, async (req: Request, res: Response): Promise<void> => {
  await supabase.from('pc_gateway_produtos').delete().eq('id', String(req.params.id));
  res.json({ ok: true });
});

// Quem declarou que resolveu a falta e pode voltar pra agenda como nota 3.
// É o ciclo que fecha o modelo: lead fraco vira cliente de R$ 160 mil.
router.get('/admin/reagendar', ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data } = await supabase
      .from('pc_membros')
      .select('user_id,telefone,nivel,nota,motivo_descarte,resolveu_o_que,resolveu_em,cidade')
      .not('resolveu_em', 'is', null)
      .order('resolveu_em', { ascending: false });

    const ids = (data || []).map((m: any) => m.user_id);
    const { data: users } = ids.length
      ? await supabase.from('users').select('id,email,nome,whatsapp').in('id', ids)
      : { data: [] as any[] };
    const porId = new Map((users || []).map((u: any) => [u.id, u]));

    res.json({
      elegiveis: (data || []).map((m: any) => ({ ...m, usuario: porId.get(m.user_id) || null })),
    });
  } catch (err) {
    logger.error('plugcash', 'falha listando elegiveis', err);
    res.status(500).json({ error: 'falha ao listar' });
  }
});

router.get('/admin/metricas', ...admin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [{ data: compras }, { data: membros }, { data: cursos }] = await Promise.all([
      supabase.from('pc_compras').select('item_slug,valor_centavos,status,created_at').eq('status', 'aprovada'),
      supabase.from('pc_membros').select('nivel,motivo_descarte,resolveu_em,resolveu_o_que'),
      supabase.from('pc_cursos').select('slug,titulo,status'),
    ]);

    const porCurso: Record<string, { vendas: number; receita: number }> = {};
    for (const c of compras || []) {
      const k = (c as any).item_slug;
      porCurso[k] = porCurso[k] || { vendas: 0, receita: 0 };
      porCurso[k].vendas++;
      porCurso[k].receita += (c as any).valor_centavos || 0;
    }

    const porNivel: Record<string, number> = {};
    const porMotivo: Record<string, number> = {};
    for (const m of membros || []) {
      porNivel[(m as any).nivel] = (porNivel[(m as any).nivel] || 0) + 1;
      for (const mo of (m as any).motivo_descarte || []) porMotivo[mo] = (porMotivo[mo] || 0) + 1;
    }

    res.json({
      membros: (membros || []).length,
      por_nivel: porNivel,
      por_motivo: porMotivo,
      por_curso: porCurso,
      // Quem declarou que resolveu a falta e pode voltar pra agenda como nota 3.
      elegiveis_reagendar: (membros || []).filter((m: any) => m.resolveu_em).length,
      cursos: cursos || [],
    });
  } catch (err) {
    logger.error('plugcash', 'falha nas metricas', err);
    res.status(500).json({ error: 'falha ao carregar metricas' });
  }
});

export default router;
