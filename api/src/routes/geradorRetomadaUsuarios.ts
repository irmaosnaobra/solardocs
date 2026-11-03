import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { caixaIpLimiter, caixaPessoaLimiter } from '../middleware/rateLimiter';
import { eu, exigeEquipe, falhou, semCache, soSocioCom } from './geradorEnsaio5040';
import { vagasDoFrioLinha } from '../services/agents/whatsapp/lineThrottle';
import { lerPainelRetomada } from '../services/solardoc/retomadaUsuariosPainel';
import { pausarRetomada, retomarRetomada } from '../services/solardoc/retomadaUsuariosEstado';
import { sondarRetomadaUsuarios } from '../services/solardoc/retomadaUsuarios';

// ─────────────────────────────────────────────────────────────────────────────
// PAINEL DA RETOMADA DOS USUÁRIOS PELA CARLA (03/11/2026). Montado dentro de /gerador, logo depois do ensaio das agentes. SÓ SÓCIO.
//
//   GET /gerador/ensaio/retomada-usuarios                 estado, números, pausa, vagas do frio, a linha na hora, o início e o motivo de parada
//   PUT /gerador/ensaio/retomada-usuarios {pausar: bool}  pausa (true) ou retoma (false) a campanha: grava ou apaga a chave usu_rec_pausa
//   GET /gerador/ensaio/retomada-usuarios/fila?n=20       o MODO SECO: os próximos N da fila (1 a 40), na ordem, com o motivo de cada
//                                                         exclusão e a mensagem exata. É só leitura: não envia, não toma a vez, não marca.
//
// POR QUE NÃO MORA EM geradorEnsaio5040.ts (D34): aquele arquivo é raiz do teste de isolamento (agentes5040Isolamento), que reprova se o
// percurso de imports dele alcançar o lineThrottle, o zapiClient ou o whatsappAgentService. Estas rotas precisam do lineThrottle (vagas e
// carimbos da linha) e do robô (o seco importa o envio). É o mesmo motivo de a sonda do robô do quiz morar em routes/admin.ts.
//
// As guardas são as do ensaio (importadas de lá): sem cache, limite por IP, consultor logado, limite por pessoa, equipe autorizada, e
// depois só sócio. Telefone e e-mail nunca saem nestas respostas: só o hmac de 8 caracteres e o primeiro nome.
// ─────────────────────────────────────────────────────────────────────────────

const um = (v: unknown): string => String(Array.isArray(v) ? v[0] : v ?? '').trim();

export function mountRetomadaUsuarios(router: Router): void {
  const base = [semCache, caixaIpLimiter, exigeConsultor, caixaPessoaLimiter, exigeEquipe] as const;
  const soSocioControles = soSocioCom('Só sócio usa os controles.');

  /** O painel inteiro mais as vagas do frio da linha (null quando a leitura falha: a tela escreve o sinal de "sem número"). */
  const montar = async (): Promise<Record<string, unknown>> => {
    const [painel, vagas] = await Promise.all([lerPainelRetomada(new Date()), vagasDoFrioLinha().catch(() => null)]);
    return { ok: true, vagas_do_frio: vagas, ...painel };
  };

  router.get('/ensaio/retomada-usuarios', ...base, soSocioControles, async (_req: Request, res: Response) => {
    try { res.json(await montar()); } catch (err) { falhou(res, err); }
  });

  router.put('/ensaio/retomada-usuarios', ...base, soSocioControles, async (req: Request, res: Response) => {
    const pausar = (req.body as { pausar?: unknown } | undefined)?.pausar;
    if (typeof pausar !== 'boolean') { res.status(400).json({ ok: false, error: 'Diga se é para pausar ou retomar (pausar: true ou false).' }); return; }
    try {
      if (pausar) await pausarRetomada({ motivo: 'painel', por: eu(req) }, new Date());
      else await retomarRetomada();
      res.json(await montar());
    } catch (err) { falhou(res, err); }
  });

  router.get('/ensaio/retomada-usuarios/fila', ...base, soSocioControles, async (req: Request, res: Response) => {
    const n = Math.min(40, Math.max(1, Math.floor(Number(um(req.query.n))) || 20));
    try { res.json({ ok: true, ...(await sondarRetomadaUsuarios({ n })) }); } catch (err) { falhou(res, err); }
  });
}
