// Portal do Parceiro NEXUS: convite por e-mail às contas do SolarDoc com CNPJ. Só a equipe e só SÓCIO (exigeEquipeNexus + req.equipe.socio:
// no Gerador, o consultor na env SOLAR_SOCIOS; no SolarDoc, users.is_admin ou papel 'socio' em nexus_equipe). Montado por mountNexusConvite(router).
//
//   GET  /nexus/equipe/convites/email/previa
//        -> {total, ja_enviados, a_enviar, excluidos_optout, ja_parceiros, sem_email, lote, amostra:[empresa,...até 5]}
//   POST /nexus/equipe/convites/email/enviar   body {confirmar:true}
//        -> {enviados, restantes, falhas, parou_por_erro}   (até 40 por chamada)
//   POST /nexus/equipe/convites/email/teste    (corpo ignorado)
//        -> {enviado_para}   UM e-mail de convite, o mesmo texto do lote, SÓ para o e-mail de quem está logado (lido de
//           req.equipe, no servidor; corpo, query e cabeçalhos não escolhem o destino). Não toma trava, não marca ninguém
//           como convidado, não entra na contagem nem no lote. 1 por minuto por usuário (429 {erro:'aguarde'}).
//           SÓ com o login do SolarDoc (/nexus/adm): o login do Gerador é <nome>@irmaosnaobra.app, domínio sem caixa de e-mail
//           (sem registro no DNS), e o teste sumiria calado. Esse login leva 409 {erro:'teste_so_no_adm'}, sem gastar a vaga.
//
// Público: contas do SolarDoc com company.cnpj preenchido (14 dígitos), SEM linha em nexus_parceiros, com e-mail válido.
//   total             = contas desse público que NÃO pediram descadastro (email_opt_out)
//   ja_enviados       = das `total`, quantas já têm a trava `nexus_convite_email:<user_id>`
//   a_enviar          = total - ja_enviados  (é o que `restantes` vai contando para zero)
//   excluidos_optout  = contas do público com email_opt_out = true (nunca recebem)
//   ja_parceiros      = contas com CNPJ que já têm linha em nexus_parceiros (nunca recebem)
//   sem_email         = contas com CNPJ sem e-mail válido (nunca recebem)
// A trava vem ANTES de cada envio. Lote em sequência (a Resend limita requisições por segundo) e PARA no primeiro erro de
// envio, mantendo a trava daquela conta (não reenvia sozinho).

import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { soDigitos } from '../utils/cnpj';
import { exigeEquipeNexus } from '../services/nexus/equipeAuth';
import { Linha } from '../services/nexus/repositorio';
import { PREFIXO_TRAVA_CONVITE, enviarConvite, enviarConviteTeste, tomarTrava } from '../services/nexus/email';
import { exigePortalLigado, lerTudo, lotes, ok, rota } from './geradorNexusBase';

export const LOTE_CONVITE = 40;

/** Só sócio dispara e vê. Roda DEPOIS do exigeEquipeNexus, que preenche req.equipe.socio (Gerador: SOLAR_SOCIOS; SolarDoc:
 *  is_admin ou papel 'socio'). Nunca decide pelo nome do e-mail: conta do SolarDoc com nome de sócio não vira sócio. */
export function exigeSocio(req: Request, res: Response, next: NextFunction): void {
  if (req.equipe?.socio !== true) {
    res.status(403).json({ erro: 'so_socio' });
    return;
  }
  next();
}

interface Conta {
  user_id: string;
  email: string;
  empresa: string;
  /** users.nome, só para a saudação "Olá, {primeiro nome}." do e-mail. Não entra em nenhuma regra do público. */
  nome: string;
}

interface Publico {
  total: number;
  ja_enviados: number;
  excluidos_optout: number;
  ja_parceiros: number;
  sem_email: number;
  /** Quem ainda não recebeu, em ordem estável (user_id). */
  pendentes: Conta[];
}

const emailValido = (e: unknown): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+$/.test(e.trim());

async function lerPublico(): Promise<Publico> {
  // 1. Empresas com CNPJ (uma por conta). Pagina: o PostgREST corta em 1000.
  const empresas = await lerTudo('empresas com CNPJ', (de, ate) =>
    supabase.from('company').select('user_id, nome, nome_fantasia, cnpj').not('cnpj', 'is', null).order('user_id', { ascending: true }).range(de, ate));
  const porConta = new Map<string, Linha>();
  for (const c of empresas) {
    if (!c.user_id || soDigitos(c.cnpj).length !== 14) continue;
    if (!porConta.has(String(c.user_id))) porConta.set(String(c.user_id), c);
  }

  // 2. Quem já é parceiro e quem já recebeu convite.
  const parceiros = await lerTudo('parceiros NEXUS', (de, ate) =>
    supabase.from('nexus_parceiros').select('user_id').order('user_id', { ascending: true }).range(de, ate));
  const ehParceiro = new Set(parceiros.map((p) => String(p.user_id)));
  const travas = await lerTudo('convites já enviados', (de, ate) =>
    supabase.from('system_state').select('key').like('key', `${PREFIXO_TRAVA_CONVITE}%`).order('key', { ascending: true }).range(de, ate));
  const jaConvidado = new Set(travas.map((t) => String(t.key).slice(PREFIXO_TRAVA_CONVITE.length)));

  // 3. E-mail e opt-out das contas que ainda não são parceiras.
  const candidatas = [...porConta.keys()].filter((id) => !ehParceiro.has(id)).sort();
  const usuarios = new Map<string, Linha>();
  for (const lote of lotes(candidatas, 150)) {
    const r = ok(await supabase.from('users').select('id, email, nome, email_opt_out').in('id', lote), 'leitura dos usuários do convite');
    for (const u of (r.data as Linha[] | null) ?? []) usuarios.set(String(u.id), u);
  }

  const out: Publico = { total: 0, ja_enviados: 0, excluidos_optout: 0, ja_parceiros: [...porConta.keys()].filter((id) => ehParceiro.has(id)).length, sem_email: 0, pendentes: [] };
  for (const id of candidatas) {
    const u = usuarios.get(id);
    if (!u || !emailValido(u.email)) { out.sem_email++; continue; }
    if (u.email_opt_out === true) { out.excluidos_optout++; continue; }
    out.total++;
    if (jaConvidado.has(id)) { out.ja_enviados++; continue; }
    const c = porConta.get(id)!;
    out.pendentes.push({ user_id: id, email: String(u.email).trim(), empresa: String(c.nome_fantasia || c.nome || 'Empresa').slice(0, 80), nome: String(u.nome ?? '').trim() });
  }
  return out;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Teste do convite para o sócio ────────────────────────────────────────────

/** Um teste por minuto por usuário. Em memória basta: é o sócio conferindo o texto, não uma defesa. A chave é o e-mail do
 *  login. O Map fica no módulo (não dentro de mountNexusConvite, que roda de novo a cada montagem do router). */
const JANELA_TESTE_CONVITE_MS = 60_000;
const ultimoTeste = new Map<string, number>();
export function resetLimiteTesteConvite(): void { ultimoTeste.clear(); }

/** Pede a vaga do teste: 0 = tomou; maior que 0 = quantos ms faltam. SÍNCRONO, sem await entre conferir e marcar: dois
 *  cliques seguidos não mandam dois e-mails. */
function pedirVagaDeTeste(chave: string): number {
  const agora = Date.now();
  for (const [k, t] of ultimoTeste) if (agora - t >= JANELA_TESTE_CONVITE_MS) ultimoTeste.delete(k);
  const ultimo = ultimoTeste.get(chave);
  if (ultimo !== undefined) return Math.max(1, JANELA_TESTE_CONVITE_MS - (agora - ultimo));
  ultimoTeste.set(chave, agora);
  return 0;
}

/** thiago@dominio.com vira t***o@dominio.com: o meio do nome da caixa fica escondido, o domínio aparece. */
export function mascararEmail(email: string): string {
  const i = email.lastIndexOf('@');
  if (i < 1) return '***';
  const caixa = email.slice(0, i);
  const dominio = email.slice(i);
  return caixa.length <= 2 ? `${caixa.charAt(0)}***${dominio}` : `${caixa.charAt(0)}***${caixa.charAt(caixa.length - 1)}${dominio}`;
}

export function mountNexusConvite(router: Router): void {
  const equipe = [exigeEquipeNexus, exigeSocio, exigePortalLigado];

  router.get('/nexus/equipe/convites/email/previa', ...equipe, rota('GET /nexus/equipe/convites/email/previa', async (_req, res) => {
    const p = await lerPublico();
    res.json({
      total: p.total,
      ja_enviados: p.ja_enviados,
      a_enviar: p.pendentes.length,
      excluidos_optout: p.excluidos_optout,
      ja_parceiros: p.ja_parceiros,
      sem_email: p.sem_email,
      lote: LOTE_CONVITE,
      amostra: p.pendentes.slice(0, 5).map((c) => c.empresa),
    });
  }));

  router.post('/nexus/equipe/convites/email/enviar', ...equipe, rota('POST /nexus/equipe/convites/email/enviar', async (req, res) => {
    if (req.body?.confirmar !== true) { res.status(400).json({ erro: 'confirmar_obrigatorio' }); return; }
    const publico = await lerPublico();
    const lote = publico.pendentes.slice(0, LOTE_CONVITE);
    const quem = (req as unknown as { consultor?: { email?: string } }).consultor?.email ?? null;
    const intervalo = Math.max(0, Number(process.env.NEXUS_CONVITE_INTERVALO_MS ?? 600) || 0);

    let enviados = 0;
    let falhas = 0;
    let pulados = 0;
    let pararPorErro = false;
    for (const conta of lote) {
      // A TRAVA vem antes do envio. Duplicada = outro disparo já pegou esta conta; erro = sem trava confiável, para tudo.
      const trava = await tomarTrava(`${PREFIXO_TRAVA_CONVITE}${conta.user_id}`, { tipo: 'convite_email', por: quem });
      if (trava === 'duplicada') { pulados++; continue; }
      if (trava === 'erro') { pararPorErro = true; break; }
      try {
        await enviarConvite(conta.user_id, conta.email, conta.nome);
        enviados++;
      } catch (e) {
        // A trava fica: não reenvia sozinho. Para o lote no primeiro erro (limite da Resend, domínio, chave).
        logger.error('nexus-convite', 'envio do convite falhou, parando o lote', e);
        falhas++;
        pararPorErro = true;
        break;
      }
      if (intervalo > 0) await esperar(intervalo);
    }
    res.json({ enviados, restantes: Math.max(0, publico.pendentes.length - enviados - falhas - pulados), falhas, parou_por_erro: pararPorErro });
  }));

  // Teste: UM e-mail, só para quem está logado. Nada de trava, de marca de convidado, de leitura do público nem de lote.
  router.post('/nexus/equipe/convites/email/teste', ...equipe, rota('POST /nexus/equipe/convites/email/teste', async (req, res) => {
    // Só o login do SolarDoc tem caixa de e-mail de verdade. O do Gerador é <nome>@irmaosnaobra.app (sem DNS): recusa ANTES de
    // pedir a vaga, para o 409 não gastar o minuto. `!== 'solardoc'` (e não `=== 'gerador'`) também recusa um `via` ausente.
    if (req.equipe?.via !== 'solardoc') { res.status(409).json({ erro: 'teste_so_no_adm' }); return; }

    // O destino vem do usuário autenticado (req.equipe, preenchido pelo exigeEquipeNexus). Corpo, query e cabeçalhos são ignorados.
    const email = String(req.equipe.email ?? '').trim();
    if (!emailValido(email)) { res.status(409).json({ erro: 'sem_email' }); return; }

    const faltaMs = pedirVagaDeTeste(email);
    if (faltaMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(faltaMs / 1000)));
      res.status(429).json({ erro: 'aguarde' });
      return;
    }
    try {
      // users.nome cru, igual ao que o lote lê: a saudação do teste é a mesma que a base recebe (sem o "nome" que cai no e-mail).
      await enviarConviteTeste(email, req.equipe.nomeCadastro);
    } catch (e) {
      // Nada saiu: devolve a vaga para o sócio poder tentar de novo logo.
      ultimoTeste.delete(email);
      logger.error('nexus-convite', 'envio do teste do convite falhou', e);
      res.status(502).json({ erro: 'envio_falhou' });
      return;
    }
    res.json({ enviado_para: mascararEmail(email) });
  }));
}
