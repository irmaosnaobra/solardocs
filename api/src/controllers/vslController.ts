// ─────────────────────────────────────────────────────────────────────────────
// RETENÇÃO DA VSL — a curva "quantos ainda estão assistindo no segundo X".
//
// Por que endpoint próprio e não /admin/analytics: aquele teto de 500 visitas
// corta o denominador e o mapper de lá só conhece scroll/section/cta_click —
// evento de vídeo cairia no chão. Aqui as duas pontas são explícitas:
//   numerador  → lp_events  (event_type 'vsl', filtrado por event_data->>lp)
//   denominador→ page_visits (landing_url da LP)
// lp_events é compartilhado com LimpaPro/solar/SolarDoc: sem o filtro por `lp`
// a curva sairia misturando página que nem vídeo tem.
//
// COMO O DADO CHEGA: a LP manda "fotografias" do que já foi assistido — um
// array com quantas vezes cada balde de `bs` segundos rodou. Manda mais de uma
// vez na mesma sessão (a cada 15s, no pause, no fim e no unload), porque
// beacon de saída se perde. Juntar por "a última ganha" quebraria: sendBeacon
// corre com o POST periódico e chega fora de ordem. Assistir é acumulativo,
// então a junção certa é o MÁXIMO elemento a elemento — imune a reordenação e
// imune a beacon perdido.
// ─────────────────────────────────────────────────────────────────────────────
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// Caminho da LP de cada vídeo. O `lp` que a página manda no evento é a chave.
const CAMINHO_LP: Record<string, string> = {
  eletroposto: '/io/eletroposto',
};

function inicioDoPeriodo(period: string): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const agora = Date.now();
  if (period === 'hoje')  return new Date(`${ymd}T00:00:00-03:00`);
  if (period === '7dias') return new Date(agora - 7 * 86400000);
  if (period === 'mes')   return new Date(`${ymd.slice(0, 7)}-01T00:00:00-03:00`);
  return new Date(0);
}

type EventoVsl = {
  session_id: string;
  event_type: string;
  event_data: { lp?: string; dur?: number; bs?: number; b?: number[]; som?: boolean; viu5?: boolean; fim?: boolean; s?: number } | null;
};

export async function getVslRetencao(req: Request, res: Response): Promise<void> {
  try {
    const lp = String(req.query.lp || 'eletroposto');
    const caminho = CAMINHO_LP[lp];
    if (!caminho) { res.status(400).json({ error: 'LP sem vídeo mapeado' }); return; }

    const period = String(req.query.period || '7dias');
    const desde = inicioDoPeriodo(period).toISOString();

    const [{ data: evRows, error: evErr }, { data: vsRows }] = await Promise.all([
      supabase
        .from('lp_events')
        .select('session_id, event_type, event_data')
        .gte('created_at', desde)
        .in('event_type', ['vsl', 'vsl_cta', 'vsl_pular'])
        .eq('event_data->>lp', lp)
        .limit(20000),
      supabase
        .from('page_visits')
        .select('session_id, landing_url')
        .gte('created_at', desde)
        .ilike('landing_url', `%${caminho}%`)
        .limit(20000),
    ]);
    if (evErr) throw evErr;

    // Denominador: visitas da LP em si. `/io/eletroposto/parceria` é outra
    // página (a das duas portas) e casaria no ilike — fora dela o "% que deu
    // play" nasceria menor do que é.
    const visitasSessoes = new Set(
      (vsRows ?? [])
        .filter((v) => {
          const u = (v.landing_url || '').split('?')[0].split('#')[0].replace(/\/$/, '');
          return u.endsWith(caminho);
        })
        .map((v) => v.session_id)
        .filter(Boolean) as string[],
    );

    const eventos = (evRows ?? []) as EventoVsl[];

    // Junta as fotografias de cada sessão pelo máximo elemento a elemento.
    type Sessao = { b: number[]; dur: number; bs: number; som: boolean; viu5: boolean; fim: boolean };
    const porSessao = new Map<string, Sessao>();
    let comCta = 0, pulou = 0;
    const sessoesCta = new Set<string>(), sessoesPulou = new Set<string>();
    // Em que segundo do vídeo a pessoa apertou o botão. Desde 19/08 o botão só
    // abre a LP (não pula pro agendamento), então isso responde a pergunta que
    // sobrou: quanto de vídeo bastou pra ela querer ver a página.
    const segundoPorSessao = new Map<string, number>();

    for (const e of eventos) {
      const d = e.event_data || {};
      if (e.event_type === 'vsl_cta') {
        sessoesCta.add(e.session_id);
        const seg = Number((d as { s?: number }).s);
        if (Number.isFinite(seg)) segundoPorSessao.set(e.session_id, seg);
        continue;
      }
      if (e.event_type === 'vsl_pular') { sessoesPulou.add(e.session_id); continue; }
      if (!Array.isArray(d.b) || !d.b.length) continue;

      const atual = porSessao.get(e.session_id);
      if (!atual) {
        porSessao.set(e.session_id, {
          b: d.b.map((n) => Number(n) || 0),
          dur: Number(d.dur) || 0,
          bs: Number(d.bs) || 5,
          som: !!d.som,
          viu5: !!d.viu5,
          fim: !!d.fim,
        });
      } else {
        for (let i = 0; i < d.b.length; i++) {
          const n = Number(d.b[i]) || 0;
          if (n > (atual.b[i] ?? 0)) atual.b[i] = n;
        }
        atual.som = atual.som || !!d.som;
        atual.viu5 = atual.viu5 || !!d.viu5;
        atual.fim = atual.fim || !!d.fim;
        if (Number(d.dur) > atual.dur) atual.dur = Number(d.dur);
      }
    }
    pulou = sessoesPulou.size;

    // O clique e o play vêm de tabelas de contagem diferentes, então SEPARAR
    // importa: quem tem autoplay recusado vê o botão em t=0 e pode apertar sem
    // nunca rodar um quadro. Somando tudo num número só, "abriram a página"
    // passaria de 100% de quem deu play — etapa depois maior que a de antes.
    const comPlay = new Set(
      [...porSessao.entries()].filter(([, v]) => v.b.some((n) => n > 0)).map(([k]) => k),
    );
    const sessoes = [...porSessao.values()].filter((s) => s.b.some((n) => n > 0));
    const plays = sessoes.length;

    comCta = [...sessoesCta].filter((id) => comPlay.has(id)).length;
    const cliqueSemPlay = sessoesCta.size - comCta;
    // A mediana só olha quem assistiu: clique sem play entra sempre com s=0 e
    // puxaria pra baixo justamente a resposta de "quanto de vídeo bastou".
    const segundosDoClique = [...segundoPorSessao.entries()]
      .filter(([id]) => comPlay.has(id))
      .map(([, seg]) => seg)
      .sort((a, b) => a - b);

    if (plays === 0) {
      res.json({
        lp, period, visitas: visitasSessoes.size, plays: 0,
        comSom: 0, viramCta: 0, cliqueCta: comCta, cliqueSemPlay, pularam: pulou, cliqueSegundo: null,
        assistidoMedio: null, assistidoMediano: null, completaram: 0,
        duracao: null, bucket: null, curva: [],
      });
      return;
    }

    // Grade da curva: o balde mais usado manda no passo, a maior duração manda
    // no fim. Se o vídeo for trocado por um mais longo, a curva cresce sozinha —
    // nada aqui assume 5s nem 311s.
    const contaBs = new Map<number, number>();
    let duracao = 0;
    for (const s of sessoes) {
      contaBs.set(s.bs, (contaBs.get(s.bs) ?? 0) + 1);
      if (s.dur > duracao) duracao = s.dur;
    }
    const bs = [...contaBs.entries()].sort((a, b) => b[1] - a[1])[0][0] || 5;
    const slots = Math.max(1, Math.ceil(duracao / bs));

    const vistos = new Array(slots).fill(0);   // sessões que assistiram o slot
    const repeticoes = new Array(slots).fill(0); // vezes tocadas somadas

    for (const s of sessoes) {
      for (let g = 0; g < slots; g++) {
        const ini = g * bs, fim = ini + bs;
        // Reprojeta os baldes da sessão na grade comum (pelo segundo, não pelo
        // índice) — sessão gravada com outro `bs` continua somando certo.
        let n = 0;
        const iIni = Math.floor(ini / s.bs), iFim = Math.ceil(fim / s.bs);
        for (let i = iIni; i < iFim && i < s.b.length; i++) n = Math.max(n, s.b[i] ?? 0);
        if (n > 0) { vistos[g] += 1; repeticoes[g] += n; }
      }
    }

    // Tempo assistido por sessão (baldes tocados × tamanho do balde).
    const tempos = sessoes
      .map((s) => s.b.reduce((acc, n) => acc + (n > 0 ? s.bs : 0), 0))
      .sort((a, b) => a - b);
    const assistidoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
    const assistidoMediano = tempos[Math.floor(tempos.length / 2)];

    // "Passaram dos 5s": quanto da audiência sobrevive ao começo do vídeo.
    // Era "viu o botão" enquanto o botão nascia aos 5s; desde 19/08 ele nasce
    // aceso e a LP parou de mandar `viu5`, então sessão nova sempre cai no
    // caminho por baldes. O `s.viu5` fica pelas fotos gravadas antes disso —
    // apagá-lo reescreveria o número do histórico.
    const viramCta = sessoes.filter((s) => (
      s.viu5 || s.b.reduce((a, n) => a + (n > 0 ? s.bs : 0), 0) >= 5
    )).length;

    const curva = vistos.map((v, g) => ({
      s: g * bs,
      views: v,
      pct: Math.round((v / plays) * 1000) / 10,
      // Média de vezes que quem viu esse trecho tocou ele. >1 é rebobinada —
      // é o pico que o Panda desenha acima da linha.
      rep: v > 0 ? Math.round((repeticoes[g] / v) * 100) / 100 : 0,
    }));

    res.json({
      lp, period,
      visitas: visitasSessoes.size,
      plays,
      comSom: sessoes.filter((s) => s.som).length,
      viramCta,
      cliqueCta: comCta,
      cliqueSemPlay,
      pularam: pulou,
      cliqueSegundo: segundosDoClique.length
        ? segundosDoClique[Math.floor(segundosDoClique.length / 2)]
        : null,
      completaram: sessoes.filter((s) => s.fim).length,
      assistidoMedio,
      assistidoMediano,
      duracao: Math.round(duracao),
      bucket: bs,
      curva,
    });
  } catch (err) {
    console.error('getVslRetencao error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}
