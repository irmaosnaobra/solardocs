import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { perfilIpLimiter, perfilPessoaLimiter, perfilGravarLimiter } from '../middleware/rateLimiter';
import { ehSocio } from '../services/gerador/solarObras';
import {
  ErroPerfil, MSG_WHATSAPP, lerConsultores, acharConsultor, normalizarWhatsapp, mesmoWhatsapp,
  validarFoto, subirFoto, gravarConsultor, registrarAlteracoes,
  type Alteracao, type Consultor,
} from '../services/gerador/perfilEquipe';

// ─────────────────────────────────────────────────────────────────────────────
// MEU PERFIL do /gerador. Montada dentro de /gerador. Duas rotas:
//   GET  /perfil   o meu perfil (e, para sócio, a lista da equipe)
//   POST /perfil   grava WhatsApp e/ou foto (o meu, ou o de outro se eu for sócio)
//
// Cada pessoa edita o PRÓPRIO perfil; sócio (SOLAR_SOCIOS) edita o de qualquer
// consultor. O NOME nunca se edita (é chave de junção em vários lugares): o corpo
// pode até trazer `nome`, ele é ignorado. O porquê do caminho de gravação, do
// formato do telefone e da foto está em services/gerador/perfilEquipe.ts.
//
// Ordem do POST: login, papel (403), validação de TUDO (400/413), só então
// upload, UMA gravação em `consultores`, e por último a trilha. Nada grava antes
// de tudo estar validado.
//
// Telefone, base64 e caminho nunca vão para log: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function quem(req: Request): { nome: string; email: string; socio: boolean } {
  const c = (req as any).consultor as { nome?: string; email?: string } | undefined;
  const nome = String(c?.nome || '');
  return { nome, email: String(c?.email || ''), socio: ehSocio(nome) };
}

const publico = (c: Consultor) => ({ nome: c.nome, whatsapp: c.whatsapp, foto_url: c.foto_url });

const MSG_LEITURA = 'Não consegui ler o perfil agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui salvar o perfil agora. Tente de novo; se repetir, avise a equipe de sistemas.';

export function mountPerfil(router: Router): void {
  // Limite por IP antes do login, por pessoa depois dele (ver middleware/rateLimiter.ts).
  const base = [semCache, perfilIpLimiter, exigeConsultor, perfilPessoaLimiter] as const;

  router.get('/perfil', ...base, async (req: Request, res: Response) => {
    const { nome, email, socio } = quem(req);
    let lista: Consultor[];
    try { lista = await lerConsultores(); } catch (err) {
      console.error('[perfil] leitura falhou', err instanceof ErroPerfil ? err.codigo : 'interno');
      res.status(502).json({ ok: false, error: MSG_LEITURA });
      return;
    }
    const meu = acharConsultor(lista, nome);
    res.json({
      ok: true,
      eu: { nome: meu?.nome ?? nome, email, socio, whatsapp: meu?.whatsapp ?? null, foto_url: meu?.foto_url ?? null },
      // Só sócio vê a lista; consultor recebe vazia (nunca o telefone dos outros).
      equipe: socio ? lista.map(publico) : [],
    });
  });

  router.post('/perfil', ...base, perfilGravarLimiter, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { alvo?: unknown; whatsapp?: unknown; foto?: unknown };   // `nome` no corpo é ignorado de propósito

    // 1) A forma do pedido.
    if (b.alvo !== undefined && b.alvo !== null && typeof b.alvo !== 'string') {
      res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      return;
    }
    const alvoPedido = typeof b.alvo === 'string' ? b.alvo.trim() : '';
    const querWhats = b.whatsapp !== undefined && b.whatsapp !== null;
    const querFoto = b.foto !== undefined && b.foto !== null;
    if (!querWhats && !querFoto) {
      res.status(400).json({ ok: false, error: 'Nada para alterar. Envie o WhatsApp ou a foto.' });
      return;
    }

    // 2) O papel. Consultor mandando `alvo` que não é ele recebe 403, exista ou não o nome (não revela a equipe).
    const outro = !!alvoPedido && alvoPedido.toLowerCase() !== nome.trim().toLowerCase();
    if (outro && !socio) {
      res.status(403).json({ ok: false, error: 'Você só pode editar o seu próprio perfil.' });
      return;
    }

    // 3) Tudo validado ANTES de gravar qualquer coisa.
    let whats: string | null = null;
    if (querWhats) {
      whats = normalizarWhatsapp(b.whatsapp);
      if (!whats) { res.status(400).json({ ok: false, error: MSG_WHATSAPP }); return; }
    }
    let foto: ReturnType<typeof validarFoto> | null = null;
    if (querFoto) {
      foto = validarFoto(b.foto);
      if (!foto.ok) {
        if (foto.erro === 'foto_grande') res.status(413).json({ ok: false, error: 'A foto passa de 1,5 MB. Escolha uma menor.' });
        else if (foto.erro === 'tipo_nao_aceito') res.status(400).json({ ok: false, error: 'Tipo de imagem não aceito. Use JPEG, PNG ou WebP.' });
        else res.status(400).json({ ok: false, error: 'A foto está inválida ou corrompida. Escolha outra.' });
        return;
      }
    }

    // 4) A linha do alvo, achada em JS pelo nome sem caixa.
    let lista: Consultor[];
    try { lista = await lerConsultores(); } catch (err) {
      console.error('[perfil] leitura falhou', err instanceof ErroPerfil ? err.codigo : 'interno');
      res.status(502).json({ ok: false, error: MSG_GRAVAR });
      return;
    }
    const linha = acharConsultor(lista, outro ? alvoPedido : nome);
    if (!linha) {
      res.status(404).json({ ok: false, error: outro ? 'Consultor não encontrado.' : 'Seu cadastro de consultor não foi encontrado. Avise a equipe de sistemas.' });
      return;
    }

    // 5) Grava. O que não mudou não é gravado nem entra na trilha.
    const patch: { whatsapp?: string; foto_url?: string } = {};
    const trilha: Alteracao[] = [];
    const em = new Date().toISOString();
    const por = nome;
    if (whats !== null && !mesmoWhatsapp(whats, linha.whatsapp)) {
      patch.whatsapp = whats;
      trilha.push({ em, por, alvo: linha.nome, campo: 'whatsapp', antes: linha.whatsapp, depois: whats });
    }
    if (foto && foto.ok) {
      const up = await subirFoto(linha.nome, foto.foto);
      if (!up.ok) { res.status(502).json({ ok: false, error: 'Não consegui guardar a foto agora. Tente de novo em instantes.' }); return; }
      patch.foto_url = up.url;
      trilha.push({ em, por, alvo: linha.nome, campo: 'foto', antes: linha.foto_url, depois: up.url });
    }

    if (!trilha.length) {
      res.json({ ok: true, alterado: { whatsapp: false, foto: false }, perfil: publico(linha), trilha: true });
      return;
    }
    try { await gravarConsultor(linha.nome, patch); } catch (err) {
      console.error('[perfil] gravar falhou', err instanceof ErroPerfil ? err.codigo : 'interno');
      res.status(502).json({ ok: false, error: MSG_GRAVAR });
      return;
    }
    const trilhaOk = await registrarAlteracoes(trilha);
    res.json({
      ok: true,
      alterado: { whatsapp: patch.whatsapp !== undefined, foto: patch.foto_url !== undefined },
      perfil: { nome: linha.nome, whatsapp: patch.whatsapp ?? linha.whatsapp, foto_url: patch.foto_url ?? linha.foto_url },
      trilha: trilhaOk,
    });
  });
}
