// ── Painel da jornada do lead na landing do LimpaPro ─────────────────────────────
// GET /_t/limpapro/jornada?k=<chave>&dias=7
//
// Mora aqui, e não numa função do projeto da landing, porque lá o plano Hobby só permite
// 12 funções e as 12 já estavam usadas. Nesta API é só mais uma rota do Express.
//
// A conta é feita no servidor de propósito: a página do painel não baixa milhares de
// linhas nem precisa saber SQL.
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// Nomes de gente para os ids das seções. Bloco novo na landing? Acrescente aqui.
const NOMES_SECAO: Record<string, string> = {
  'secao-0': 'Barra de anúncio',
  'secao-1': 'Hero',
  'secao-2': 'Esteira de materiais',
  'secao-3': 'O que tem em cada módulo',
  'secao-mercado': 'O mercado (foto aérea)',
  'secao-4': 'Dor + contador',
  'secao-5': 'Para quem é',
  'secao-6': 'Tudo o que recebe',
  'secao-7': 'Bônus',
  'secao-8': 'Depoimentos',
  'secao-conta': 'A conta do bairro',
  'secao-quem': 'Quem te ensina',
  'secao-9': 'Planos e preço',
  'secao-10': 'Garantia',
  'secao-11': 'Como é o acesso',
  'secao-12': 'Perguntas',
  'secao-13': 'Rodapé',
};

// A medição começou em 07/08/2026. Antes disso o servidor achatava todo evento em
// 'pageview' — aquela base não separa clique de visita e NÃO pode ser somada a esta.
const INICIO_DA_MEDICAO = '2026-08-07T00:00:00Z';

interface Perfil {
  profundidade?: number;
  ultima_secao?: string;
  segundos?: number;
  secoes?: Record<string, number>;
  faq?: string[];
  ctas?: { id: string; s: number }[];
  popup?: string;
  aparelho?: string;
}

export async function jornadaLimpapro(req: Request, res: Response): Promise<void> {
  const esperada = process.env.JORNADA_KEY;
  if (!esperada || String(req.query.k || '') !== esperada) {
    res.status(401).json({ error: 'sem_acesso' });
    return;
  }

  const dias = Math.min(90, Math.max(1, parseInt(String(req.query.dias || '7'), 10) || 7));
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const inicio = desde > INICIO_DA_MEDICAO ? desde : INICIO_DA_MEDICAO;

  const { data, error } = await supabase
    .from('limpapro_events')
    .select('event_type,session_id,raw')
    .gte('created_at', inicio)
    .limit(50000);

  if (error) {
    console.error('jornadaLimpapro:', error.message);
    res.status(500).json({ error: 'falha_consulta' });
    return;
  }

  const pct = (a: number, b: number): number => (b ? Math.round((a * 1000) / b) / 10 : 0);
  const nome = (id: string): string => NOMES_SECAO[id] || id;

  // Uma visita pode ter várias linhas (visita, clique, perfil). Agrupa por sessão.
  const sessoes = new Map<string, { perfil: Perfil | null; clicou: boolean }>();
  for (const l of data || []) {
    if (!l.session_id) continue;
    const s = sessoes.get(l.session_id) || { perfil: null, clicou: false };
    if (l.event_type === 'sessao' && l.raw) s.perfil = l.raw as Perfil;
    if (String(l.event_type).startsWith('checkout_click')) s.clicou = true;
    sessoes.set(l.session_id, s);
  }
  const todas = Array.from(sessoes.values());
  const perfis = todas.filter((s) => s.perfil) as { perfil: Perfil; clicou: boolean }[];

  const viuPreco = perfis.filter((s) => ((s.perfil.secoes || {})['secao-9'] || 0) > 0);
  const clicaram = todas.filter((s) => s.clicou);

  const parada: Record<string, { id: string; nome: string; sessoes: number; pct: number }> = {};
  const blocos: Record<string, { id: string; nome: string; sessoes: number; total: number; media: number; alcance: number }> = {};
  const duvidas: Record<string, { duvida: string; sessoes: number; pct: number }> = {};
  const ctas: Record<string, { cta: string; sessoes: number; soma: number; segundo_medio: number }> = {};
  const popup: Record<string, { estado: string; sessoes: number; pct: number }> = {};
  const aparelhos: Record<string, { aparelho: string; sessoes: number; clicou: number; pct_clicou: number }> = {};
  const conta = [
    { faixa: 'Nem viu a conta', sessoes: 0, clicou: 0, pct_clicou: 0 },
    { faixa: 'Passou batido (1 a 4s)', sessoes: 0, clicou: 0, pct_clicou: 0 },
    { faixa: 'Parou pra ler (5s+)', sessoes: 0, clicou: 0, pct_clicou: 0 },
  ];

  for (const s of perfis) {
    const p = s.perfil;

    const fim = p.ultima_secao || '(nao rolou)';
    if (!parada[fim]) parada[fim] = { id: fim, nome: nome(fim), sessoes: 0, pct: 0 };
    parada[fim].sessoes += 1;

    for (const id of Object.keys(p.secoes || {})) {
      if (!blocos[id]) blocos[id] = { id, nome: nome(id), sessoes: 0, total: 0, media: 0, alcance: 0 };
      blocos[id].sessoes += 1;
      blocos[id].total += Number((p.secoes || {})[id]) || 0;
    }

    for (const q of p.faq || []) {
      if (!duvidas[q]) duvidas[q] = { duvida: q, sessoes: 0, pct: 0 };
      duvidas[q].sessoes += 1;
    }

    for (const c of p.ctas || []) {
      if (!ctas[c.id]) ctas[c.id] = { cta: c.id, sessoes: 0, soma: 0, segundo_medio: 0 };
      ctas[c.id].sessoes += 1;
      ctas[c.id].soma += Number(c.s) || 0;
    }

    const est = p.popup || '(nao abriu)';
    if (!popup[est]) popup[est] = { estado: est, sessoes: 0, pct: 0 };
    popup[est].sessoes += 1;

    const ap = p.aparelho || '?';
    if (!aparelhos[ap]) aparelhos[ap] = { aparelho: ap, sessoes: 0, clicou: 0, pct_clicou: 0 };
    aparelhos[ap].sessoes += 1;
    if (s.clicou) aparelhos[ap].clicou += 1;

    const segConta = (p.secoes || {})['secao-conta'] || 0;
    const faixa = segConta === 0 ? conta[0] : segConta < 5 ? conta[1] : conta[2];
    faixa.sessoes += 1;
    if (s.clicou) faixa.clicou += 1;
  }

  Object.values(parada).forEach((x) => { x.pct = pct(x.sessoes, perfis.length); });
  Object.values(blocos).forEach((b) => {
    b.media = Math.round((b.total / b.sessoes) * 10) / 10;
    b.alcance = pct(b.sessoes, perfis.length);
  });
  Object.values(duvidas).forEach((d) => { d.pct = pct(d.sessoes, perfis.length); });
  Object.values(ctas).forEach((c) => { c.segundo_medio = Math.round(c.soma / c.sessoes); });
  Object.values(popup).forEach((p) => { p.pct = pct(p.sessoes, perfis.length); });
  Object.values(aparelhos).forEach((a) => { a.pct_clicou = pct(a.clicou, a.sessoes); });
  conta.forEach((c) => { c.pct_clicou = pct(c.clicou, c.sessoes); });

  const porSessoes = <T extends { sessoes: number }>(o: Record<string, T>): T[] =>
    Object.values(o).sort((a, b) => b.sessoes - a.sessoes);

  res.setHeader('Cache-Control', 'private, max-age=120');
  res.json({
    dias,
    gerado_em: new Date().toISOString(),
    funil: {
      sessoes: todas.length,
      com_perfil: perfis.length,
      chegou_no_preco: viuPreco.length,
      clicou: clicaram.length,
      pct_chegou: pct(viuPreco.length, perfis.length),
      pct_clicou: pct(clicaram.length, todas.length),
      pct_clicou_de_quem_viu: pct(viuPreco.filter((s) => s.clicou).length, viuPreco.length),
      profundidade_media: perfis.length
        ? Math.round((perfis.reduce((a, s) => a + (s.perfil.profundidade || 0), 0) / perfis.length) * 100)
        : 0,
      segundos_medios: perfis.length
        ? Math.round(perfis.reduce((a, s) => a + (s.perfil.segundos || 0), 0) / perfis.length)
        : 0,
    },
    parada: porSessoes(parada),
    blocos: Object.values(blocos).sort((a, b) => b.media - a.media),
    duvidas: porSessoes(duvidas),
    ctas: porSessoes(ctas),
    popup: porSessoes(popup),
    conta,
    aparelhos: porSessoes(aparelhos),
  });
}
