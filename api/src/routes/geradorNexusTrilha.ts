// Trilha do Parceiro NEXUS, Onda 1: rotas do PARCEIRO. Montadas por mountNexusTrilha(router), chamado no fim do mountNexus.
//
//   GET  /nexus/trilha                       { ligada:false } com a trilha desligada; senão a visão completa (cria a linha na 1ª vez)
//   PUT  /nexus/trilha/raio-x                { respostas } parcial (autosave) -> { nota, faltas }
//   POST /nexus/trilha/raio-x/enviar         -> { nota, passou, faltas, trilha }; com 80+ fecha o patamar 1 e copia o perfil
//   POST /nexus/trilha/diagnostico           { preferencia } exige patamar 1 e plano pago ativo
//   POST /nexus/trilha/preparo               { formato } exige patamar 2
//   GET  /nexus/trilha/academia              aulas SEM gabarito + progresso
//   POST /nexus/trilha/academia/:aulaId      { resposta } -> { certa, trilha }; 12 certas fecham o patamar 3
//   POST /nexus/trilha/reuniao               exige patamar 3, Termo aceito e plano pago ativo
//
// Segurança: o usuário é SEMPRE req.userId (nenhuma rota lê user_id do corpo); cliente_id e proposta_id têm que ser do próprio
// usuário. A trilha desligada (tabela ausente ou NEXUS_TRILHA_OFF=1) deixa o portal exatamente como era. Nada aqui envia
// WhatsApp, e-mail ou Instagram.

import { Request, Response, Router } from 'express';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { ErroBanco, Linha, marcarPerfilCompleto, tabelaAusente, termoAceitoNaVersao } from '../services/nexus/repositorio';
import { ESPERA_APOS_ERRO_MS, TOTAL_AULAS, aulasFeitas, aulasParaFront, corrigirAula, idDeAulaValido, progressoParaFront, segundosDeEspera } from '../services/nexus/academia';
import { LinhaTrilha, concluidos, academiaCompleta } from '../services/nexus/trilha';
import { calcularNota, idsDeClientes, validarRespostas } from '../services/nexus/trilhaRaioX';
import { FORMATOS, validarPreferencia, validarReuniao } from '../services/nexus/trilhaEntradas';
import {
  type Decisao, type EventoDaTrilha, assinanteDe, atualizarTrilha, clientesDoUsuario, completarComClientes, garantirTrilha, marcarTrilhaAusente, propostaDoUsuario, trilhaLigada,
} from '../services/nexus/trilhaRepo';
import { montarVisao } from '../services/nexus/trilhaVisao';
import { diaBRT } from '../services/nexus/tempo';
import { exigePortalLigado, rota } from './geradorNexusBase';

export type Garantir = (userId: string) => Promise<{ parceiro: Linha; company: Linha | null } | { status: number; corpo: Record<string, unknown> }>;

type Recusa = Extract<Decisao, { tipo: 'recusar' }>;
interface Ctx { userId: string; parceiro: Linha; company: Linha | null; t: LinhaTrilha }

const CAPACIDADES: Record<string, string> = {
  eletrica_bt: 'cap_eletrica_bt', eletrica_mt: 'cap_eletrica_mt', engenharia_art: 'cap_engenharia_art', obra_civil: 'cap_obra_civil', homologacao: 'cap_homologacao',
};

const empresaDe = (p: Linha, c: Linha | null) => ({ cnpj: p.cnpj ?? null, cidade: p.cidade ?? null, uf: p.uf ?? null, tem_logo: !!c?.logo_base64 });
const dadosDe = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function mountNexusTrilha(router: Router, garantir: Garantir): void {
  const parceiro = [authMiddleware, exigePortalLigado];

  /** Rota que só existe com a trilha ligada: resolve parceiro, empresa e a linha da trilha antes de chamar a função. */
  const comTrilha = (nome: string, fn: (c: Ctx, req: Request, res: Response) => Promise<void>, desligada: 'erro' | 'vazio' = 'erro') =>
    rota(nome, async (req, res) => {
      try {
        if (!(await trilhaLigada())) {
          if (desligada === 'vazio') res.json({ ligada: false }); else res.status(503).json({ erro: 'trilha_desligada' });
          return;
        }
        const g = await garantir(req.userId);
        if ('status' in g) { res.status(g.status).json(g.corpo); return; }
        const t = await garantirTrilha(g.parceiro);
        await fn({ userId: req.userId, parceiro: g.parceiro, company: g.company, t }, req, res);
      } catch (e) {
        // Só a tabela da trilha sumindo desliga a trilha: outra tabela ausente segue o caminho normal (portal desligado).
        if (e instanceof ErroBanco && tabelaAusente(e.causa) && /nexus_trilha/.test(String(e.causa?.message ?? ''))) {
          marcarTrilhaAusente();
          res.status(503).json({ erro: 'trilha_desligada' });
          return;
        }
        throw e;
      }
    });

  const visao = async (c: Ctx, t: LinhaTrilha = c.t) =>
    montarVisao({ parceiro: c.parceiro, company: c.company, t, assinante: await assinanteDe(c.userId) });

  const bloqueada = (): Recusa => ({ tipo: 'recusar', status: 403, corpo: { erro: 'etapa_bloqueada' } });
  const recusa = (status: number, erro: string, extra: Record<string, unknown> = {}): Recusa => ({ tipo: 'recusar', status, corpo: { erro, ...extra } });

  /** Grava pelo caminho único (atualizarTrilha). Recusa já respondida = null. */
  const mutar = async <R,>(c: Ctx, res: Response, decidir: (t: LinhaTrilha) => Decisao<R>): Promise<{ t: LinhaTrilha; resultado?: R } | null> => {
    const { t, decisao } = await atualizarTrilha(c.parceiro, decidir);
    if (decisao.tipo === 'recusar') { res.status(decisao.status).json(decisao.corpo); return null; }
    return { t, resultado: decisao.resultado };
  };

  // ── Ver a trilha ───────────────────────────────────────────────────────────
  router.get('/nexus/trilha', ...parceiro, comTrilha('GET /nexus/trilha', async (c, _req, res) => { res.json(await visao(c)); }, 'vazio'));

  // ── Patamar 1: Raio-X ──────────────────────────────────────────────────────
  router.put('/nexus/trilha/raio-x', ...parceiro, comTrilha('PUT /nexus/trilha/raio-x', async (c, req, res) => {
    let bruto = (req.body as Record<string, unknown> | undefined)?.respostas;
    if (bruto && typeof bruto === 'object' && Array.isArray((bruto as Record<string, unknown>).clientes_em_vista)) {
      // cliente_id sem cidade ou UF: preenche com a linha de clients do próprio usuário antes de validar (id de outra conta = recusado).
      const f = await completarComClientes(c.userId, (bruto as Record<string, unknown[]>).clientes_em_vista, 'nome');
      if (f.invalido) { res.status(400).json({ erro: 'cliente_invalido' }); return; }
      bruto = { ...(bruto as Record<string, unknown>), clientes_em_vista: f.itens };
    }
    const v = validarRespostas(bruto);
    if (!v.ok) { res.status(400).json({ erro: v.erro, campo: v.campo }); return; }
    const ids = idsDeClientes(v.valor);
    const donos = await clientesDoUsuario(c.userId, ids);
    if (ids.some((id) => !donos.has(id))) { res.status(400).json({ erro: 'cliente_invalido' }); return; }
    const r = await mutar(c, res, (t): Decisao<{ nota: number; faltas: unknown }> => {
      const respostas = { ...dadosDe(t.raio_x), ...v.valor };
      const { nota, faltas } = calcularNota(respostas, empresaDe(c.parceiro, c.company));
      return { tipo: 'gravar', patch: { raio_x: respostas, raio_x_nota: nota }, resultado: { nota, faltas } };
    });
    if (r) res.json(r.resultado);
  }));

  router.post('/nexus/trilha/raio-x/enviar', ...parceiro, comTrilha('POST /nexus/trilha/raio-x/enviar', async (c, _req, res) => {
    const agora = new Date().toISOString();
    const r = await mutar(c, res, (t): Decisao<{ nota: number; passou: boolean; faltas: unknown }> => {
      const { nota, passou, faltas } = calcularNota(dadosDe(t.raio_x), empresaDe(c.parceiro, c.company));
      if (!passou) return { tipo: 'gravar', patch: { raio_x_nota: nota }, resultado: { nota, passou, faltas } };
      const eventos: EventoDaTrilha[] = [{ tipo: 'raio_x_enviado', dados: { nota }, autor: 'parceiro' }];
      const patch: Record<string, unknown> = { raio_x_nota: nota, raio_x_enviado_em: agora };
      if (!t.p1_em) { patch.p1_em = agora; eventos.push({ tipo: 'patamar_concluido', dados: { patamar: 1 }, autor: 'sistema' }); }
      return { tipo: 'gravar', patch, eventos, resultado: { nota, passou, faltas } };
    });
    if (!r?.resultado) return;
    let parceiroAtual = c.parceiro;
    if (r.resultado.passou) {
      // O perfil antigo não é perguntado de novo: o que o Raio-X respondeu vai para o cadastro do parceiro (a partir do que ficou gravado).
      const respostas = dadosDe(r.t.raio_x);
      const perfil: Record<string, unknown> = { updated_at: agora };
      if (respostas.raio_km !== undefined) perfil.raio_km = respostas.raio_km;
      if (respostas.papel !== undefined) { perfil.papel_revenda = respostas.papel !== 'montagem'; perfil.papel_montagem = respostas.papel !== 'revenda'; }
      if (Array.isArray(respostas.capacidades)) for (const [chave, coluna] of Object.entries(CAPACIDADES)) perfil[coluna] = (respostas.capacidades as string[]).includes(chave);
      const up = await supabase.from('nexus_parceiros').update(perfil).eq('id', c.parceiro.id).select('*').single();
      if (up.error) throw new ErroBanco(up.error, 'perfil vindo do Raio-X');
      parceiroAtual = up.data as Linha;
      await marcarPerfilCompleto(parceiroAtual, c.company);
    }
    res.json({ ...r.resultado, trilha: await visao({ ...c, parceiro: parceiroAtual }, r.t) });
  }));

  // ── Patamar 2: pedir o diagnóstico ─────────────────────────────────────────
  router.post('/nexus/trilha/diagnostico', ...parceiro, comTrilha('POST /nexus/trilha/diagnostico', async (c, req, res) => {
    const pref = validarPreferencia((req.body as Record<string, unknown> | undefined)?.preferencia, diaBRT());
    if (!pref.ok) { res.status(400).json({ erro: pref.erro, campo: pref.campo }); return; }
    const assinante = await assinanteDe(c.userId);
    const r = await mutar(c, res, (t): Decisao => {
      if (!t.p1_em) return bloqueada();
      if (t.p2_em) return recusa(409, 'ja_concluido');
      if (!assinante) return recusa(403, 'assinatura_necessaria');
      const refazendo = !!t.diag_feito_em && t.diag_resultado === 'ainda_nao';
      if (t.diag_pedido_em && !refazendo) return recusa(409, 'ja_pedido');
      return {
        tipo: 'gravar',
        patch: { diag_pedido_em: new Date().toISOString(), diag_preferencia: pref.valor, diag_agendado_para: null, diag_link: null, diag_feito_em: null, diag_resultado: null },
        eventos: [{ tipo: 'diagnostico_pedido', dados: { dias: pref.valor.dias, periodo: pref.valor.periodo, refeito: refazendo }, autor: 'parceiro' }],
      };
    });
    if (r) res.json(await visao(c, r.t));
  }));

  // ── Patamar 3: mentoria ou Academia ────────────────────────────────────────
  router.post('/nexus/trilha/preparo', ...parceiro, comTrilha('POST /nexus/trilha/preparo', async (c, req, res) => {
    const formato = String((req.body as Record<string, unknown> | undefined)?.formato ?? '');
    if (!(FORMATOS as readonly string[]).includes(formato)) { res.status(400).json({ erro: 'formato_invalido' }); return; }
    const assinante = await assinanteDe(c.userId);
    const r = await mutar(c, res, (t): Decisao => {
      if (!t.p1_em || !t.p2_em) return bloqueada();
      if (t.p3_em) return recusa(409, 'ja_concluido');
      if (!assinante) return recusa(403, 'assinatura_necessaria');
      if (t.preparo_formato === formato) return { tipo: 'sem_mudanca' };
      const comProgresso = (Number(t.mentoria_encontros) || 0) > 0 || !!t.mentoria_paga_em || Object.keys(dadosDe(t.academia)).length > 0;
      if (t.preparo_formato && comProgresso) return recusa(409, 'formato_ja_escolhido');
      return { tipo: 'gravar', patch: { preparo_formato: formato }, eventos: [{ tipo: 'preparo_escolhido', dados: { formato }, autor: 'parceiro' }] };
    });
    if (r) res.json(await visao(c, r.t));
  }));

  router.get('/nexus/trilha/academia', ...parceiro, comTrilha('GET /nexus/trilha/academia', async (c, _req, res) => {
    if (!c.t.p1_em || !c.t.p2_em) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    res.json({ aulas: aulasParaFront(), formato: c.t.preparo_formato ?? null, progresso: { feitas: aulasFeitas(c.t.academia), meta: TOTAL_AULAS, aulas: progressoParaFront(c.t.academia) } });
  }));

  router.post('/nexus/trilha/academia/:aulaId', ...parceiro, comTrilha('POST /nexus/trilha/academia/:aulaId', async (c, req, res) => {
    const aulaId = String(req.params.aulaId);
    if (!idDeAulaValido(aulaId)) { res.status(404).json({ erro: 'aula_inexistente' }); return; }
    const certa = corrigirAula(aulaId, (req.body as Record<string, unknown> | undefined)?.resposta);
    if (certa === null) { res.status(400).json({ erro: 'resposta_invalida' }); return; }
    const assinante = await assinanteDe(c.userId);
    const r = await mutar(c, res, (t): Decisao<{ certa: boolean; aguarde_s?: number }> => {
      if (!t.p1_em || !t.p2_em || t.preparo_formato !== 'academia') return bloqueada();
      if (t.p3_em) return recusa(409, 'ja_concluido');
      if (!assinante) return recusa(403, 'assinatura_necessaria');
      const feitas = dadosDe(t.academia);
      if ((feitas[aulaId] as Linha | undefined)?.certa === true) return { tipo: 'sem_mudanca', resultado: { certa: true } };
      const espera = segundosDeEspera(feitas[aulaId]); // errou há pouco: relê a aula e tenta de novo depois
      if (espera > 0) return recusa(409, 'aguarde', { segundos: espera });
      const agora = new Date().toISOString();
      const academia = { ...feitas, [aulaId]: { em: agora, certa } };
      const patch: Record<string, unknown> = { academia };
      const eventos: EventoDaTrilha[] = [{ tipo: 'academia_aula', dados: { aula: aulaId, certa }, autor: 'parceiro' }];
      if (academiaCompleta({ ...t, academia })) { patch.p3_em = agora; eventos.push({ tipo: 'patamar_concluido', dados: { patamar: 3 }, autor: 'sistema' }); }
      return { tipo: 'gravar', patch, eventos, resultado: certa ? { certa } : { certa, aguarde_s: ESPERA_APOS_ERRO_MS / 1000 } };
    });
    if (r) res.json({ ...(r.resultado ?? { certa: true }), trilha: await visao(c, r.t) });
  }));

  // ── Patamar 4: reunião com o cliente ───────────────────────────────────────
  router.post('/nexus/trilha/reuniao', ...parceiro, comTrilha('POST /nexus/trilha/reuniao', async (c, req, res) => {
    let corpo: unknown = req.body;
    if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
      const f = await completarComClientes(c.userId, [corpo], 'cliente_nome');
      if (f.invalido) { res.status(400).json({ erro: 'cliente_invalido' }); return; }
      corpo = f.itens[0];
    }
    const v = validarReuniao(corpo, diaBRT());
    if (!v.ok) { res.status(400).json({ erro: v.erro, campo: v.campo }); return; }
    const r = v.valor;
    if (r.cliente_id && !(await clientesDoUsuario(c.userId, [r.cliente_id])).has(r.cliente_id)) { res.status(400).json({ erro: 'cliente_invalido' }); return; }
    if (r.proposta_id && !(await propostaDoUsuario(c.userId, r.proposta_id))) { res.status(400).json({ erro: 'proposta_invalida' }); return; }
    const assinante = await assinanteDe(c.userId);
    const termo = termoAceitoNaVersao(c.parceiro);
    const g = await mutar(c, res, (t): Decisao => {
      if (!concluidos(t, 0)[2]) return bloqueada();
      if (!termo) return recusa(409, 'termo_pendente');
      if (!assinante) return recusa(403, 'assinatura_necessaria');
      if (t.reuniao_pedida_em) return recusa(409, 'ja_pedida');
      return {
        tipo: 'gravar',
        patch: { reuniao_pedida_em: new Date().toISOString(), reuniao_dados: r },
        eventos: [{ tipo: 'reuniao_pedida', dados: { cliente_nome: r.cliente_nome, cidade: r.cidade, uf: r.uf, tipo_local: r.tipo_local }, autor: 'parceiro' }],
      };
    });
    if (g) res.json(await visao(c, g.t));
  }));
}
