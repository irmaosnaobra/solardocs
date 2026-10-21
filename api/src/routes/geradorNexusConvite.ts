// Portal do Parceiro NEXUS: convite por e-mail às contas do SolarDoc com CNPJ. Só a equipe e só SÓCIO (exigeConsultor +
// consultor na env SOLAR_SOCIOS, a mesma regra de services/gerador/solarObras.ts). Montado por mountNexusConvite(router).
//
//   GET  /nexus/equipe/convites/email/previa
//        -> {total, ja_enviados, a_enviar, excluidos_optout, ja_parceiros, sem_email, lote, amostra:[empresa,...até 5]}
//   POST /nexus/equipe/convites/email/enviar   body {confirmar:true}
//        -> {enviados, restantes, falhas, parou_por_erro}   (até 40 por chamada)
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
import { exigeConsultor } from './geradorDossie';
import { ehSocio } from '../services/gerador/solarObras';
import { Linha } from '../services/nexus/repositorio';
import { PREFIXO_TRAVA_CONVITE, enviarConvite, tomarTrava } from '../services/nexus/email';
import { exigePortalLigado, lerTudo, lotes, ok, rota } from './geradorNexusBase';

export const LOTE_CONVITE = 40;

/** Só sócio dispara e vê. Roda DEPOIS do exigeConsultor, que preenche req.consultor. */
export function exigeSocio(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as unknown as { consultor?: { nome?: string } }).consultor?.nome ?? '');
  if (!ehSocio(nome)) {
    res.status(403).json({ erro: 'so_socio' });
    return;
  }
  next();
}

interface Conta {
  user_id: string;
  email: string;
  empresa: string;
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
    const r = ok(await supabase.from('users').select('id, email, email_opt_out').in('id', lote), 'leitura dos usuários do convite');
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
    out.pendentes.push({ user_id: id, email: String(u.email).trim(), empresa: String(c.nome_fantasia || c.nome || 'Empresa').slice(0, 80) });
  }
  return out;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function mountNexusConvite(router: Router): void {
  const equipe = [exigeConsultor, exigeSocio, exigePortalLigado];

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
        await enviarConvite(conta.user_id, conta.email);
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
}
