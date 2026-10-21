// Portal do Parceiro NEXUS: a rede. Oportunidades (obras e clientes que a equipe oferece ao parceiro Pro) e indicação
// de usinas. Montadas por mountNexusRede(router), chamado no fim do mountNexus.
//
//   GET  /nexus/oportunidades                  libera.oportunidades; só as oferecidas a ele; `contato` só nas aceitas
//   POST /nexus/oportunidades/:id/aceitar
//   POST /nexus/oportunidades/:id/recusar      body {motivo?}
//   POST /nexus/oportunidades/:id/etapa        body {status: contato|visita|orcamento|fechou|perdeu, obs?}
//   POST /nexus/usinas, GET /nexus/usinas      parceiro com perfil completo
//
// Oferecida com o prazo vencido vira `expirada` na leitura e em qualquer ação (sem cron). Cada resposta do parceiro
// avisa a equipe (aviso (e)); a usina indicada avisa (d).

import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { avisarComercial } from '../services/nexus/avisoComercial';
import { ErroBanco, Linha } from '../services/nexus/repositorio';
import { UFS } from '../services/nexus/procura';
import { distanciaKm, resolverCidade } from '../services/io/geoCidade';
import { UUID, contexto, exigePortalLigado, ok, rota, textoLivre } from './geradorNexusBase';

/** Status em que o parceiro já aceitou: é a partir daqui que ele vê o contato do cliente final. */
export const STATUS_APOS_ACEITE: readonly string[] = Object.freeze(['aceita', 'contato', 'visita', 'orcamento', 'fechou', 'perdeu']);
const ETAPAS_DO_PARCEIRO = ['contato', 'visita', 'orcamento', 'fechou', 'perdeu'] as const;
const PODE_MUDAR_ETAPA: readonly string[] = Object.freeze(['aceita', 'contato', 'visita', 'orcamento']);

/** O que o parceiro vê de uma oportunidade: nada de parceiro_user_id, origem_ref nem criado_por; contato só depois do aceite. */
export function visaoDaOportunidade(o: Linha): Linha {
  const base: Linha = {
    id: o.id, tipo: o.tipo, cidade: o.cidade, uf: o.uf, descricao: o.descricao, valor_servico: o.valor_servico,
    prazo_aceite: o.prazo_aceite, status: o.status, etapas: o.etapas ?? [], created_at: o.created_at, updated_at: o.updated_at,
  };
  if (STATUS_APOS_ACEITE.includes(String(o.status))) base.contato = o.contato ?? null;
  return base;
}

/**
 * Tempo, em ms, entre a ÚLTIMA oferta e a primeira resposta (aceita/recusada) DEPOIS dela. Numa reoferta a oportunidade
 * guarda as etapas do parceiro anterior: usar a primeira 'oferecida' faria o novo parceiro herdar o histórico do outro.
 */
export function tempoDeRespostaMs(etapasBrutas: unknown): number | null {
  const etapas = (Array.isArray(etapasBrutas) ? etapasBrutas : []) as Array<{ status: string; em: string }>;
  let iOferta = -1;
  etapas.forEach((e, i) => { if (e && e.status === 'oferecida') iOferta = i; });
  if (iOferta < 0) return null;
  const resposta = etapas.slice(iOferta + 1).find((e) => e && (e.status === 'aceita' || e.status === 'recusada'));
  if (!resposta) return null;
  const dt = Date.parse(resposta.em) - Date.parse(etapas[iOferta].em);
  return Number.isFinite(dt) && dt >= 0 ? dt : null;
}

/** Placar do parceiro nas oportunidades que recebeu: aceitas (do aceite em diante), recusadas, total e tempo médio de resposta em minutos. */
export function placarDoParceiro(linhas: Linha[]): { aceitas: number; recusadas: number; total: number; tempo_medio_min: number | null } {
  const minutos: number[] = [];
  for (const o of linhas) {
    const dt = tempoDeRespostaMs(o.etapas);
    if (dt !== null) minutos.push(dt / 60_000);
  }
  return {
    aceitas: linhas.filter((o) => STATUS_APOS_ACEITE.includes(String(o.status))).length,
    recusadas: linhas.filter((o) => o.status === 'recusada').length,
    total: linhas.length,
    tempo_medio_min: minutos.length ? Math.round(minutos.reduce((s, x) => s + x, 0) / minutos.length) : null,
  };
}

/** Distância em km entre a cidade do parceiro e a da oportunidade (centros do IBGE, tabela local). Null se faltar coordenada. */
export function distanciaEntreCidades(de: { cidade?: unknown; uf?: unknown }, para: { cidade?: unknown; uf?: unknown }): number | null {
  const pt = (x: { cidade?: unknown; uf?: unknown }) => {
    const cidade = String(x.cidade ?? '').trim();
    const uf = String(x.uf ?? '').trim();
    if (!cidade || !uf) return null;
    const r = resolverCidade(`${cidade}-${uf}`);
    return r.status === 'ok' && typeof r.lat === 'number' && typeof r.lng === 'number' ? { lat: r.lat, lng: r.lng } : null;
  };
  const a = pt(de);
  const b = pt(para);
  return a && b ? distanciaKm(a, b) : null;
}

function vencida(o: Linha, agora = Date.now()): boolean {
  return o.status === 'oferecida' && !!o.prazo_aceite && Date.parse(String(o.prazo_aceite)) < agora;
}

/** Marca como expirada a oportunidade oferecida com prazo vencido. Devolve a linha já atualizada. */
async function expirar(o: Linha): Promise<Linha> {
  const agora = new Date().toISOString();
  const etapas = [...(Array.isArray(o.etapas) ? o.etapas : []), { status: 'expirada', em: agora, obs: null }];
  const { error } = await supabase
    .from('nexus_oportunidades')
    .update({ status: 'expirada', etapas, updated_at: agora })
    .eq('id', o.id)
    .eq('status', 'oferecida');
  if (error) throw new ErroBanco(error, 'expiração da oportunidade');
  return { ...o, status: 'expirada', etapas, updated_at: agora };
}

// ── Usinas ───────────────────────────────────────────────────────────────────
const INTERESSES = ['vender_creditos', 'alugar', 'outro'] as const;

function numeroNaoNegativo(v: unknown, max: number): number | null | 'invalido' {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n >= 0 && n < max ? n : 'invalido';
}

export function mountNexusRede(router: Router): void {
  const parceiro = [authMiddleware, exigePortalLigado];

  // ── Oportunidades ──────────────────────────────────────────────────────────
  router.get('/nexus/oportunidades', ...parceiro, rota('GET /nexus/oportunidades', async (req, res) => {
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.oportunidades) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    const r = ok(
      await supabase
        .from('nexus_oportunidades')
        .select('id, tipo, cidade, uf, descricao, valor_servico, prazo_aceite, status, etapas, contato, created_at, updated_at')
        .eq('parceiro_user_id', req.userId)
        .neq('status', 'rascunho')
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de oportunidades',
    );
    const linhas = (r.data as Linha[] | null) ?? [];
    const atualizadas: Linha[] = [];
    for (const o of linhas) atualizadas.push(vencida(o) ? await expirar(o) : o);
    res.json({
      oportunidades: atualizadas.map((o) => {
        const km = distanciaEntreCidades(c.parceiro, o);
        return { ...visaoDaOportunidade(o), ...(km != null ? { distancia_km: km } : {}) };
      }),
      placar: placarDoParceiro(atualizadas),
    });
  }));

  /** Aceitar, recusar e mudar de etapa seguem o mesmo caminho: dono, nível, prazo, estado de partida e aviso (e). */
  async function mudar(
    req: Parameters<Parameters<typeof rota>[1]>[0],
    res: Parameters<Parameters<typeof rota>[1]>[1],
    partidas: readonly string[],
    para: string,
    obs: string | null,
  ): Promise<void> {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.oportunidades) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    const lida = ok(await supabase.from('nexus_oportunidades').select('*').eq('id', id).eq('parceiro_user_id', req.userId).limit(1), 'leitura da oportunidade');
    let o = ((lida.data as Linha[] | null) ?? [])[0];
    if (!o || o.status === 'rascunho') { res.status(404).json({ erro: 'nao_encontrada' }); return; }

    if (vencida(o)) {
      o = await expirar(o);
      res.status(409).json({ erro: 'expirada', oportunidade: visaoDaOportunidade(o) });
      return;
    }
    if (!partidas.includes(String(o.status))) {
      res.status(409).json({ erro: 'estado_invalido', status: o.status });
      return;
    }

    const agora = new Date().toISOString();
    const etapas = [...(Array.isArray(o.etapas) ? o.etapas : []), { status: para, em: agora, obs }];
    // Guarda de concorrência: só muda se ninguém mexeu no status desde a leitura.
    const up = ok(
      await supabase.from('nexus_oportunidades').update({ status: para, etapas, updated_at: agora }).eq('id', id).eq('status', o.status).select('*'),
      'mudança da oportunidade',
    );
    const nova = ((up.data as Linha[] | null) ?? [])[0];
    if (!nova) { res.status(409).json({ erro: 'estado_invalido' }); return; }

    await avisarComercial('oportunidade', {
      parceiro: c.parceiro as never,
      whatsapp: c.company?.whatsapp ?? null,
      oportunidade: { id, cidade: nova.cidade, uf: nova.uf, status: para },
      obs,
    });
    res.json({ oportunidade: visaoDaOportunidade(nova) });
  }

  router.post('/nexus/oportunidades/:id/aceitar', ...parceiro, rota('POST /nexus/oportunidades/:id/aceitar', async (req, res) => {
    await mudar(req, res, ['oferecida'], 'aceita', null);
  }));

  router.post('/nexus/oportunidades/:id/recusar', ...parceiro, rota('POST /nexus/oportunidades/:id/recusar', async (req, res) => {
    await mudar(req, res, ['oferecida'], 'recusada', textoLivre(req.body?.motivo, 300));
  }));

  router.post('/nexus/oportunidades/:id/etapa', ...parceiro, rota('POST /nexus/oportunidades/:id/etapa', async (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!(ETAPAS_DO_PARCEIRO as readonly string[]).includes(status)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    await mudar(req, res, PODE_MUDAR_ETAPA, status, textoLivre(req.body?.obs, 300));
  }));

  // ── Usinas ─────────────────────────────────────────────────────────────────
  router.post('/nexus/usinas', ...parceiro, rota('POST /nexus/usinas', async (req, res) => {
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.usinas) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dono = textoLivre(b.dono_nome, 120);
    if (!dono) { res.status(400).json({ erro: 'dono_obrigatorio' }); return; }
    const zap = String(b.whatsapp ?? '').replace(/\D/g, '');
    if (zap && (zap.length < 10 || zap.length > 13)) { res.status(400).json({ erro: 'whatsapp_invalido' }); return; }
    const uf = textoLivre(b.uf, 2)?.toUpperCase() ?? null;
    if (uf && !UFS.includes(uf)) { res.status(400).json({ erro: 'uf_invalida' }); return; }
    const interesse = b.interesse == null || b.interesse === '' ? null : String(b.interesse);
    if (interesse && !(INTERESSES as readonly string[]).includes(interesse)) { res.status(400).json({ erro: 'interesse_invalido' }); return; }
    const kwp = numeroNaoNegativo(b.potencia_kwp, 1_000_000);
    const geracao = numeroNaoNegativo(b.geracao_kwh_mes, 100_000_000);
    const disponivel = numeroNaoNegativo(b.disponivel_kwh_mes, 100_000_000);
    if (kwp === 'invalido' || geracao === 'invalido' || disponivel === 'invalido') { res.status(400).json({ erro: 'numero_invalido' }); return; }

    const agora = new Date().toISOString();
    const linha = {
      user_id: req.userId,
      dono_nome: dono,
      whatsapp: zap || null,
      cidade: textoLivre(b.cidade, 80),
      uf,
      distribuidora: textoLivre(b.distribuidora, 80),
      potencia_kwp: kwp,
      geracao_kwh_mes: geracao,
      disponivel_kwh_mes: disponivel,
      interesse,
      obs: textoLivre(b.obs, 1000),
      status: 'recebida',
      created_at: agora,
      updated_at: agora,
    };
    const ins = await supabase.from('nexus_usinas').insert(linha).select('id').single();
    if (ins.error) throw new ErroBanco(ins.error, 'gravação da usina');
    const id = String((ins.data as Linha).id);
    await avisarComercial('usina', {
      parceiro: c.parceiro as never,
      whatsapp: c.company?.whatsapp ?? null,
      usina: { id, dono_nome: dono, cidade: linha.cidade, uf, potencia_kwp: kwp as number | null, interesse },
    });
    res.status(201).json({ id });
  }));

  router.get('/nexus/usinas', ...parceiro, rota('GET /nexus/usinas', async (req, res) => {
    const r = ok(
      await supabase
        .from('nexus_usinas')
        .select('id, dono_nome, whatsapp, cidade, uf, distribuidora, potencia_kwp, geracao_kwh_mes, disponivel_kwh_mes, interesse, obs, status, created_at')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de usinas',
    );
    res.json({ usinas: (r.data as Linha[] | null) ?? [] });
  }));
}
