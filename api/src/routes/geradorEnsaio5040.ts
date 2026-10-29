import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { caixaIpLimiter, caixaPessoaLimiter } from '../middleware/rateLimiter';
import { equipeAutorizada } from '../services/gerador/caixaWhatsapp';
import { ehSocio } from '../services/gerador/solarObras';
import {
  ErroArmazem, lerMelhoria, lerQualidadesDoDia, lerResumoQualidade, listarConversas, listarSemanasMelhoria, lerTurnos, lerTurnosNosDias,
  type MsgGravada, type TurnoGravado,
} from '../services/agentes5040/armazem';
import { ehSegunda, paraTela } from '../services/agentes5040/melhoria';
import {
  ErroPerguntas, STATUS_PERGUNTA, idValido, ignorarPergunta, listarPerguntas, reabrirPergunta, responderPergunta, validarResposta,
  type StatusPergunta,
} from '../services/agentes5040/perguntas';
import { janelaDoDiaBRT, ontemBRT } from '../services/agentes5040/relogio';
import { runReplay } from '../services/agentes5040/replay';
import { supabase } from '../utils/supabase';
import {
  CHAVE_INTERRUPTORES, CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, DONAS_VIVAS, MAX_ALVOS, NOMES_INTERRUPTORES, alvoDoValor, padraoDe, zerarCacheInterruptores,
  type DonaViva, type ModoVivo, type NomeInterruptor,
} from '../services/agentes5040/interruptores';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import {
  ACOES, CHAVE_COMANDO, CHAVE_RESULTADO, IDADE_MAX_MS, ehAcao, lerComando, validarParams, type Params,
} from '../services/agentes5040/comandos';
import {
  ErroNotas, META_AVALIACOES, PRODUTO_DA_PERSONA, TAMANHO_MAX_COMENTARIO, apagarNota, autorSeguro, emParalelo, gravarNota,
  indiceDeNotas, lerIdDeNota, lerNotasDoTurno, lerTurnoExato, montarPlacar, resumoDeNotas, turnosComNota,
  type ChavePersona, type NotaGravada,
} from '../services/agentes5040/notas';

// ─────────────────────────────────────────────────────────────────────────────
// PAINEL DO ENSAIO DAS AGENTES (A3). Montado dentro de /gerador. A tela mostra conversa de cliente,
// então a pilha é a mesma da caixa: sem cache, limite por IP, consultor logado (`exigeConsultor`),
// limite por pessoa, e a lista fechada da equipe (CAIXA_EQUIPE).
//
//   GET    /gerador/ensaio/conversas?dias&produto&persona&origem   lista (hmac, nunca telefone)
//   GET    /gerador/ensaio/conversa?id=<hmac>[&de=&ate=]           os turnos da conversa, com as notas
//   POST   /gerador/ensaio/nota    {conversa, turno, dia?, certo, nota 0-10, comentario <=500}
//   DELETE /gerador/ensaio/nota?turno=<wa_id>&nota=<autor>-<ts>    só o autor
//   GET    /gerador/ensaio/placar                                  por agente; devolve `socio`
//   POST   /gerador/ensaio/replay  {dias?, conversas?}             SÓ SÓCIO
//   GET    /gerador/ensaio/qualidade?dia=AAAA-MM-DD                 a nota de cada conversa do dia + o resumo (hmac, nunca telefone)
//   GET    /gerador/ensaio/melhoria?semana=AAAA-MM-DD               o relatório semanal de melhoria (a segunda-feira) ou o mais recente + as semanas que existem (hmac, nunca telefone)
//   GET    /gerador/ensaio/perguntas?status=aberta|respondida|ignorada   a fila do que a agente não soube responder
//   POST   /gerador/ensaio/perguntas/:id/responder {resposta}      SÓ SÓCIO: a resposta entra no conhecimento da agente do produto
//   POST   /gerador/ensaio/perguntas/:id/ignorar                   SÓ SÓCIO
//   POST   /gerador/ensaio/perguntas/:id/reabrir                   SÓ SÓCIO: tira a resposta do conhecimento
//   GET/PUT /gerador/ensaio/interruptores                          SÓ SÓCIO: liga e desliga as peças (4 da Fase A + duda_vivo, helena_vivo, carla_vivo + qualidade, respostas_dono)
//   GET/PUT /gerador/ensaio/vivo-alvo                              SÓ SÓCIO: quem a rodada viva atende (até 3 números de teste, só o HMAC)
//   GET/POST /gerador/ensaio/comando                               SÓ SÓCIO: pede uma sonda (só GRAVA o pedido;
//                                                                  quem executa é o cron do ensaio, em até 5 min)
//
// Este arquivo NÃO importa nada de envio (o teste agentes5040Isolamento anda pelo grafo a partir daqui).
// O `exigeConsultor` é o de geradorDossie; `semCache` e `exigeEquipe` são cópias do geradorCaixa de propósito:
// importar o geradorCaixa traria a caixa inteira para o grafo.
//
// "O que foi respondido de verdade" vem do campo `real` do turno. O HMAC é de mão única: não há como voltar ao
// telefone para reler a wa_mensagens, e esta rota não tenta.
//
// Erro vira mensagem genérica; o log leva só o código. Telefone e texto de mensagem nunca vão para log.
// ─────────────────────────────────────────────────────────────────────────────

const DIAS_PADRAO = 30;
const DIAS_MAX = 90;
const MAX_CONVERSAS = 200;
const REPLAY_DIAS_PADRAO = 7;
const REPLAY_DIAS_MAX = 30;
const REPLAY_CONVERSAS_PADRAO = 3;
const REPLAY_CONVERSAS_MAX = 5;
const REPLAY_TURNOS = 8;

const HMAC = /^[0-9a-f]{64}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const PERSONAS: readonly ChavePersona[] = ['carla', 'duda', 'helena', 'ninguem'];
const PRODUTOS: Record<string, ChavePersona> = { solardoc: 'carla', solar: 'duda', eletroposto: 'helena' };

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function exigeEquipe(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!equipeAutorizada(nome, process.env.CAIXA_EQUIPE)) {
    res.status(403).json({ ok: false, error: 'Esta tela é só para a equipe.', precisa: 'equipe' });
    return;
  }
  next();
}

const soSocioCom = (frase: string) => (req: Request, res: Response, next: NextFunction): void => {
  const nome = String((req as any).consultor?.nome || '');
  if (!ehSocio(nome)) { res.status(403).json({ ok: false, error: frase, precisa: 'socio' }); return; }
  next();
};
const soSocio = soSocioCom('Só sócio roda o replay.');
const soSocioControles = soSocioCom('Só sócio usa os controles.');
const soSocioPerguntas = soSocioCom('Só sócio responde as perguntas.');

function falhou(res: Response, err: unknown): void {
  // Só o código. A mensagem do driver pode trazer caminho, telefone ou texto.
  const codigo = err instanceof ErroArmazem || err instanceof ErroNotas || err instanceof ErroPerguntas ? err.codigo : 'interno';
  console.error('[ensaio5040] falhou', codigo);
  res.status(502).json({ ok: false, error: 'Não consegui ler o ensaio agora. Tente de novo em instantes.' });
}

const um = (v: unknown): string => String(Array.isArray(v) ? v[0] : v ?? '').trim();

function lerDias(v: unknown): number {
  const n = Number(um(v));
  if (!Number.isFinite(n) || n < 1) return DIAS_PADRAO;
  return Math.min(DIAS_MAX, Math.floor(n));
}

const eu = (req: Request): string | null => autorSeguro((req as any).consultor?.nome);

const produtoDe = (persona: string | null, dona: string | null): string | null => {
  const p = persona ?? dona;
  return p === 'carla' || p === 'duda' || p === 'helena' ? PRODUTO_DA_PERSONA[p] : null;
};

const msgParaTela = (m: MsgGravada) => ({ autor: m.autor, tipo: m.tipo, texto: m.texto, momento: m.momento });

const notaParaTela = (n: NotaGravada, quem: string | null) => ({
  id: n.id, autor: n.autor, certo: n.certo, nota: n.nota, comentario: n.comentario, em: n.em, minha: quem !== null && n.autor === quem,
});

/** Dias (YYYY-MM-DD) de `de` a `ate`, no máximo DIAS_MAX. */
function diasEntre(de: string, ate: string): string[] {
  const a = Date.parse(`${de}T00:00:00Z`); const b = Date.parse(`${ate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b && out.length < DIAS_MAX; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function turnoParaTela(t: TurnoGravado, notas: NotaGravada[], quem: string | null) {
  return {
    turno: t.wa_id, dia: t.dia, momento: t.momento, kind: t.kind, origem: t.origem,
    dona: t.dona, passo: t.passo, motivo_porteiro: t.motivo_porteiro, persona: t.persona,
    falou: t.falou, bolhas: t.bolhas, acao: t.acao, peca: t.peca,
    motivo_silencio: t.motivo_silencio, pergunta_porteiro: t.pergunta_porteiro, modelo: t.modelo,
    entrada: (t.entrada ?? []).map(msgParaTela),
    real: t.real ? t.real.map(msgParaTela) : null,
    notas: notas.map(n => notaParaTela(n, quem)),
  };
}

let replayRodando = false;

export function mountEnsaio5040(router: Router): void {
  // Limite por IP antes do login, por pessoa depois dele (ver middleware/rateLimiter.ts).
  const base = [semCache, caixaIpLimiter, exigeConsultor, caixaPessoaLimiter, exigeEquipe] as const;

  // 1) Lista de conversas ensaiadas, com a nota de cada uma.
  router.get('/ensaio/conversas', ...base, async (req: Request, res: Response) => {
    const dias = lerDias(req.query.dias);
    const produto = um(req.query.produto).toLowerCase();
    const persona = um(req.query.persona).toLowerCase();
    const origem = um(req.query.origem).toLowerCase();
    if (produto && !PRODUTOS[produto]) { res.status(400).json({ ok: false, error: 'Produto inválido.' }); return; }
    if (persona && !PERSONAS.includes(persona as ChavePersona)) { res.status(400).json({ ok: false, error: 'Agente inválida.' }); return; }
    if (origem && origem !== 'vivo' && origem !== 'replay') { res.status(400).json({ ok: false, error: 'Origem inválida.' }); return; }
    try {
      const [lista, indice] = await Promise.all([
        listarConversas({ dias, origem: origem ? (origem as 'vivo' | 'replay') : undefined, max: MAX_CONVERSAS }),
        indiceDeNotas(),
      ]);
      const alvoPersona = persona || (produto ? PRODUTOS[produto]! : '');
      const conversas = lista
        .map(c => {
          // A agente da conversa, não a do último turno: o turno barrado pelo porteiro (humano entrou) não tira a conversa dela.
          const p = c.persona_conversa ?? c.ultimo.persona;
          const chave: ChavePersona = p ?? (c.ultimo.dona === 'carla' || c.ultimo.dona === 'duda' || c.ultimo.dona === 'helena' ? c.ultimo.dona : 'ninguem');
          const r = resumoDeNotas(indice.porTurno, c.wa_ids);
          return {
            id: c.hmac, persona: chave, produto: produtoDe(p, c.ultimo.dona), origem: c.ultimo.origem, dona: c.ultimo.dona,
            primeira_data: c.primeiro_dia, ultima_data: c.ultimo.momento, turnos: c.turnos, com_nota: r.com_nota, media_nota: r.media,
          };
        })
        .filter(c => !alvoPersona || c.persona === alvoPersona);
      res.json({ ok: true, dias, notas_parciais: indice.truncado, conversas });
    } catch (err) { falhou(res, err); }
  });

  // 2) Os turnos de UMA conversa, com as notas de cada um.
  router.get('/ensaio/conversa', ...base, async (req: Request, res: Response) => {
    const id = um(req.query.id);
    if (!HMAC.test(id)) { res.status(400).json({ ok: false, error: 'Conversa inválida.' }); return; }
    const de = um(req.query.de); const ate = um(req.query.ate);
    if ((de && !DIA.test(de)) || (ate && !DIA.test(ate))) { res.status(400).json({ ok: false, error: 'Data inválida.' }); return; }
    try {
      const turnos = de && ate ? await lerTurnosNosDias(id, diasEntre(de, ate)) : await lerTurnos(id, DIAS_MAX);
      const quem = eu(req);
      // Só lê a pasta de notas dos turnos que têm nota (uma lista da pasta `notas/` diz quais), e vários ao mesmo tempo.
      const comNota = await turnosComNota();
      const saida = await emParalelo(turnos, async t => turnoParaTela(t, comNota.has(t.wa_id) ? await lerNotasDoTurno(t.wa_id) : [], quem));
      res.json({ ok: true, id, turnos: saida });
    } catch (err) { falhou(res, err); }
  });

  // 3) Dar nota. Só acrescenta: cada nota é um arquivo novo.
  router.post('/ensaio/nota', ...base, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const quem = eu(req);
    const comentario = b.comentario === undefined || b.comentario === null ? '' : b.comentario;
    const erro = (m: string) => res.status(400).json({ ok: false, error: m });
    if (!quem) return void erro('Conta sem nome.');
    if (typeof b.conversa !== 'string' || !HMAC.test(b.conversa)) return void erro('Conversa inválida.');
    if (typeof b.turno !== 'number' || !Number.isSafeInteger(b.turno) || b.turno <= 0) return void erro('Turno inválido.');
    if (typeof b.certo !== 'boolean') return void erro('Diga se está certo ou errado.');
    if (typeof b.nota !== 'number' || !Number.isInteger(b.nota) || b.nota < 0 || b.nota > 10) return void erro('A nota é um número inteiro de 0 a 10.');
    if (typeof comentario !== 'string' || comentario.length > TAMANHO_MAX_COMENTARIO) return void erro(`O comentário tem no máximo ${TAMANHO_MAX_COMENTARIO} caracteres.`);
    if (b.dia !== undefined && (typeof b.dia !== 'string' || !DIA.test(b.dia))) return void erro('Data inválida.');
    try {
      // O turno tem que existir; persona e origem vêm do turno gravado, nunca do cliente.
      const turno = typeof b.dia === 'string'
        ? await lerTurnoExato(b.dia, b.conversa, b.turno)
        : (await lerTurnos(b.conversa, DIAS_MAX)).find(t => t.wa_id === b.turno) ?? null;
      if (!turno) { res.status(404).json({ ok: false, error: 'Esse turno não existe.' }); return; }
      const { id } = await gravarNota({
        turno: turno.wa_id, hmac: turno.hmac, persona: turno.persona, origem: turno.origem,
        autor: quem, certo: b.certo, nota: b.nota, comentario: comentario.trim(),
      });
      res.status(201).json({ ok: true, id });
    } catch (err) { falhou(res, err); }
  });

  // 4) Apagar a própria nota.
  router.delete('/ensaio/nota', ...base, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const turno = Number(um(req.query.turno) || b.turno);
    const nota = um(req.query.nota) || um(b.nota);
    const quem = eu(req);
    if (!quem || !Number.isSafeInteger(turno) || turno <= 0 || !lerIdDeNota(nota)) {
      res.status(400).json({ ok: false, error: 'Nota inválida.' }); return;
    }
    try {
      const r = await apagarNota(turno, nota, quem);
      if (r === 'nao_e_sua') { res.status(403).json({ ok: false, error: 'Só quem deu a nota pode apagar.' }); return; }
      if (r === 'nao_existe') { res.status(404).json({ ok: false, error: 'Essa nota não existe.' }); return; }
      res.json({ ok: true });
    } catch (err) { falhou(res, err); }
  });

  // 5) Placar por agente. `socio` diz à tela se mostra o replay e os vencimentos (o servidor confere de novo).
  router.get('/ensaio/placar', ...base, async (req: Request, res: Response) => {
    try {
      const indice = await indiceDeNotas();
      res.json({
        ok: true, socio: ehSocio(String((req as any).consultor?.nome || '')), meta: META_AVALIACOES,
        notas_parciais: indice.truncado, placar: montarPlacar(indice.porTurno),
      });
    } catch (err) { falhou(res, err); }
  });

  // 6) Replay de conversas passadas. SÓ SÓCIO. Nunca repassa `dry` (ele ignora o interruptor e gasta modelo);
  // a janela e o número de conversas têm teto fixo aqui, e o replay tem teto diário e interruptor próprios.
  router.post('/ensaio/replay', ...base, soSocio, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const inteiro = (v: unknown, padrao: number, max: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : padrao;
    };
    if (replayRodando) { res.status(409).json({ ok: false, error: 'Já tem um replay rodando. Espere ele terminar.' }); return; }
    replayRodando = true;
    try {
      const dias = inteiro(b.dias, REPLAY_DIAS_PADRAO, REPLAY_DIAS_MAX);
      const maxConversas = inteiro(b.conversas, REPLAY_CONVERSAS_PADRAO, REPLAY_CONVERSAS_MAX);
      const ate = new Date();
      const r = await runReplay({ desde: new Date(ate.getTime() - dias * 86_400_000), ate, maxConversas, maxTurnos: REPLAY_TURNOS });
      // Só números: nada de hmac, de texto ou de telefone na resposta.
      res.status(r.ok ? 200 : 502).json({
        ok: r.ok, ligado: r.ligado, motivo: r.motivo ?? null, dias, conversas_vistas: r.conversasVistas,
        conversas_processadas: r.conversasProcessadas, turnos_gravados: r.turnosGravados, turnos_ja_existiam: r.turnosJaExistiam,
        chamadas_ia: r.chamadasIA, parou: r.parou, janela_truncada: r.janelaTruncada, puladas: r.puladas,
      });
    } catch (err) { falhou(res, err); } finally { replayRodando = false; }
  });
  // ── Controles do sócio ──────────────────────────────────────────────────────

  const bancoPrincipal = (): { from: (t: string) => any } => supabase as unknown as { from: (t: string) => any };

  /** Último `req_id` aceito em POST /ensaio/comando: um reenvio do MESMO pedido (renovação de sessão, rede) não grava de novo. */
  const CHAVE_REQ = 'ag5040_comando_req';

  async function lerChave(chave: string): Promise<{ value: unknown; updated_at: string | null }> {
    const { data, error } = await bancoPrincipal().from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
    if (error) throw new ErroNotas('estado_leitura');
    return { value: data?.value ?? null, updated_at: data?.updated_at ?? null };
  }


  // ── QUALIDADE: a nota de cada conversa do dia (gravada pelo relógio, services/agentes5040/qualidade.ts) ──
  const ORDEM_QUALIDADE: Record<string, number> = { critica: 0, com_problema: 1, boa: 2 };

  router.get('/ensaio/qualidade', ...base, async (req: Request, res: Response) => {
    const pedido = um(req.query.dia);
    const dia = pedido || ontemBRT(new Date());
    if (!DIA.test(dia) || !janelaDoDiaBRT(dia)) { res.status(400).json({ ok: false, error: 'Data inválida.' }); return; }
    try {
      const [resumo, lidas] = await Promise.all([lerResumoQualidade<unknown>(dia), lerQualidadesDoDia<Record<string, unknown>>(dia)]);
      const notas: Array<Record<string, unknown>> = lidas
        .map((x): Record<string, unknown> => ({ ...x.nota, hmac: x.hmac }))
        .sort((a, b) => (ORDEM_QUALIDADE[String(a.qualidade)] ?? 3) - (ORDEM_QUALIDADE[String(b.qualidade)] ?? 3) || String(a.hmac).localeCompare(String(b.hmac)));
      res.json({ ok: true, dia, resumo, notas });
    } catch (err) { falhou(res, err); }
  });

  // ── MELHORIA: o relatório da semana (gravado pelo relógio de segunda, services/agentes5040/melhoria.ts). Só leitura ──
  router.get('/ensaio/melhoria', ...base, async (req: Request, res: Response) => {
    const pedida = um(req.query.semana);
    if (pedida && (!DIA.test(pedida) || !ehSegunda(pedida))) { res.status(400).json({ ok: false, error: 'Semana inválida.' }); return; }
    try {
      const semanas = await listarSemanasMelhoria();
      const semana = pedida || semanas[0] || '';
      const relatorio = semana ? paraTela(await lerMelhoria<unknown>(semana)) : null;
      res.json({ ok: true, semana: semana || null, semanas, relatorio });
    } catch (err) { falhou(res, err); }
  });

  // ── PERGUNTAS EM ABERTO: o que a agente não soube responder. O sócio responde; a resposta entra no conhecimento ──
  router.get('/ensaio/perguntas', ...base, async (req: Request, res: Response) => {
    const status = um(req.query.status).toLowerCase();
    if (status && !(STATUS_PERGUNTA as readonly string[]).includes(status)) { res.status(400).json({ ok: false, error: 'Status inválido.' }); return; }
    try {
      const perguntas = await listarPerguntas(status ? (status as StatusPergunta) : undefined);
      res.json({ ok: true, socio: ehSocio(String((req as any).consultor?.nome || '')), perguntas });
    } catch (err) { falhou(res, err); }
  });

  const idDaRota = (req: Request, res: Response): string | null => {
    const id = um(req.params.id);
    if (!idValido(id)) { res.status(400).json({ ok: false, error: 'Pergunta inválida.' }); return null; }
    return id;
  };

  const resultadoDaAcao = (res: Response, r: 'ok' | 'nao_achou' | 'estado_errado', frase409: string): void => {
    if (r === 'nao_achou') { res.status(404).json({ ok: false, error: 'Não achei essa pergunta.' }); return; }
    if (r === 'estado_errado') { res.status(409).json({ ok: false, error: frase409 }); return; }
    res.json({ ok: true });
  };

  router.post('/ensaio/perguntas/:id/responder', ...base, soSocioPerguntas, async (req: Request, res: Response) => {
    const id = idDaRota(req, res); if (!id) return;
    const quem = eu(req);
    if (!quem) { res.status(400).json({ ok: false, error: 'Conta sem nome.' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const recusa = validarResposta(b.resposta);
    if (recusa) { res.status(400).json({ ok: false, error: recusa }); return; }
    try { resultadoDaAcao(res, await responderPergunta(id, String(b.resposta), quem, new Date()), 'Não deu para responder agora.'); } catch (err) { falhou(res, err); }
  });

  router.post('/ensaio/perguntas/:id/ignorar', ...base, soSocioPerguntas, async (req: Request, res: Response) => {
    const id = idDaRota(req, res); if (!id) return;
    const quem = eu(req);
    if (!quem) { res.status(400).json({ ok: false, error: 'Conta sem nome.' }); return; }
    try { resultadoDaAcao(res, await ignorarPergunta(id, quem, new Date()), 'Só dá para ignorar pergunta aberta. Reabra antes.'); } catch (err) { falhou(res, err); }
  });

  router.post('/ensaio/perguntas/:id/reabrir', ...base, soSocioPerguntas, async (req: Request, res: Response) => {
    const id = idDaRota(req, res); if (!id) return;
    try { resultadoDaAcao(res, await reabrirPergunta(id, new Date()), 'Essa pergunta já está aberta.'); } catch (err) { falhou(res, err); }
  });

  const NOMES: readonly NomeInterruptor[] = NOMES_INTERRUPTORES;

  function mapaDoBanco(v: unknown): Partial<Record<NomeInterruptor, boolean>> {
    let x = v;
    if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return {}; } }
    if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
    const out: Partial<Record<NomeInterruptor, boolean>> = {};
    for (const n of NOMES) if (typeof (x as Record<string, unknown>)[n] === 'boolean') out[n] = (x as Record<string, boolean>)[n];
    return out;
  }

  /** O JSON gravado como objeto simples (cópia), com todas as chaves. Ilegível ou ausente = vazio. */
  function objetoBruto(v: unknown): Record<string, unknown> {
    let x = v;
    if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return {}; } }
    return x && typeof x === 'object' && !Array.isArray(x) ? { ...(x as Record<string, unknown>) } : {};
  }

  /** '1', '0' ou null. Nunca devolve outro valor da env. */
  const forcaDaEnv = (n: NomeInterruptor): '1' | '0' | null => {
    const v = (process.env[`AGENTES5040_${n.toUpperCase()}`] ?? '').trim();
    return v === '1' || v === '0' ? v : null;
  };

  async function estadoInterruptores() {
    const banco = mapaDoBanco((await lerChave(CHAVE_INTERRUPTORES)).value);
    const out: Record<string, { banco: boolean | null; env: '1' | '0' | null; ligado: boolean }> = {};
    for (const n of NOMES) {
      const env = forcaDaEnv(n);
      out[n] = { banco: banco[n] ?? null, env, ligado: env === '1' ? true : env === '0' ? false : (banco[n] ?? padraoDe(n)) };
    }
    return out;
  }

  router.get('/ensaio/interruptores', ...base, soSocioControles, async (_req: Request, res: Response) => {
    try {
      const interruptores = await estadoInterruptores();
      // Rastro da rodada ao vivo (cron/agentes-5040/vivo). Chave ausente ou ilegível = null.
      let vivo_ultima: unknown = null;
      try { vivo_ultima = objetoBruto((await lerChave('ag5040_vivo_ultima')).value); if (!Object.keys(vivo_ultima as object).length) vivo_ultima = null; } catch { vivo_ultima = null; }
      res.json({ ok: true, interruptores, vivo_ultima });
    } catch (err) { falhou(res, err); }
  });

  // Só os 4 nomes, só booleano. O que não vem no corpo fica como está.
  router.put('/ensaio/interruptores', ...base, soSocioControles, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    const chaves = Object.keys(b);
    if (!chaves.length) { res.status(400).json({ ok: false, error: 'Diga qual interruptor mudar.' }); return; }
    for (const k of chaves) {
      if (!(NOMES as readonly string[]).includes(k)) { res.status(400).json({ ok: false, error: 'Interruptor desconhecido.' }); return; }
      if (typeof b[k] !== 'boolean') { res.status(400).json({ ok: false, error: 'Cada interruptor é ligado (true) ou desligado (false).' }); return; }
    }
    try {
      // Lê o objeto inteiro e muda só os campos enviados: qualquer outra chave que já esteja no JSON fica como está.
      // Ler e gravar não é atômico: dois PUTs simultâneos podem se sobrescrever (aceito; só sócio mexe, um por vez).
      const novo = objetoBruto((await lerChave(CHAVE_INTERRUPTORES)).value);
      for (const k of chaves) novo[k] = b[k] as boolean;
      const { error } = await bancoPrincipal().from('system_state')
        .upsert({ key: CHAVE_INTERRUPTORES, value: novo, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new ErroNotas('estado_gravacao');
      zerarCacheInterruptores();
      res.json({ ok: true, interruptores: await estadoInterruptores() });
    } catch (err) { falhou(res, err); }
  });

  // ── O ALVO DA RODADA VIVA (adendo B/E) ─────────────────────────────────────
  // system_state.ag5040_vivo_alvo = { kid, hmacs (até 3), modos, atualizado_em }. Telefone cru NUNCA é gravado
  // nem devolvido: entra, vira chaveContato, vira HMAC e é descartado. Chave ausente = modo teste com lista
  // vazia = a agente não atende ninguém. Liberar para todos é só o modo 'todos', passo explícito.
  async function estadoAlvo() {
    const alvo = alvoDoValor((await lerChave(CHAVE_VIVO_ALVO)).value);
    const kid = idChaveHmac();
    const modos: Record<string, ModoVivo> = {};
    for (const d of DONAS_VIVAS) modos[d] = alvo.modos[d] ?? 'teste';
    // Só conta o que o leitor vai conseguir casar: hmac de outra chave (kid trocado) não casa com ninguém.
    const quantos = kid && alvo.kid === kid ? alvo.hmacs.length : 0;
    return { quantos, modos, atualizado_em: alvo.atualizado_em };
  }

  router.get('/ensaio/vivo-alvo', ...base, soSocioControles, async (_req: Request, res: Response) => {
    try { res.json({ ok: true, alvo: await estadoAlvo() }); } catch (err) { falhou(res, err); }
  });

  router.put('/ensaio/vivo-alvo', ...base, soSocioControles, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    const querTelefone = b.telefone !== undefined && b.telefone !== null && b.telefone !== '';
    const querLimpar = b.limpar === true;
    const querModos = b.modos !== undefined && b.modos !== null;
    if (!querTelefone && !querLimpar && !querModos) { res.status(400).json({ ok: false, error: 'Diga o que mudar.' }); return; }
    if (b.limpar !== undefined && typeof b.limpar !== 'boolean') { res.status(400).json({ ok: false, error: 'O campo limpar é true ou false.' }); return; }

    let novoHmac: string | null = null;
    if (querTelefone) {
      const digitos = typeof b.telefone === 'string' ? b.telefone.replace(/\D/g, '') : '';
      const chave = digitos.length >= 10 && digitos.length <= 13 ? chaveContato(digitos) : null;
      if (!chave) { res.status(400).json({ ok: false, error: 'Telefone inválido.' }); return; }
      novoHmac = hmacDe(chave);
      if (!novoHmac || !idChaveHmac()) { res.status(503).json({ ok: false, error: 'Sem a chave de segurança para guardar o número.' }); return; }
    }
    const novosModos: Partial<Record<string, ModoVivo>> = {};
    if (querModos) {
      const m = b.modos;
      if (!m || typeof m !== 'object' || Array.isArray(m)) { res.status(400).json({ ok: false, error: 'Modos inválidos.' }); return; }
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        if (!(DONAS_VIVAS as readonly string[]).includes(k)) { res.status(400).json({ ok: false, error: 'Agente desconhecida.' }); return; }
        if (v !== 'teste' && v !== 'todos') { res.status(400).json({ ok: false, error: 'O modo é teste ou todos.' }); return; }
        if (v === 'todos' && !DONAS_LIBERADAS_PARA_TODOS.includes(k as DonaViva)) {
          res.status(400).json({ ok: false, error: 'Ainda não dá para liberar essa agente para todos os leads.' }); return;
        }
        novosModos[k] = v;
      }
    }

    try {
      // Ler e gravar não é atômico: dois PUTs simultâneos podem se sobrescrever (aceito; só sócio mexe, um por vez).
      const atual = alvoDoValor((await lerChave(CHAVE_VIVO_ALVO)).value);
      const kid = idChaveHmac();
      // Lista gravada com outra chave de HMAC não casa com ninguém: recomeça vazia, com o kid em uso.
      let hmacs = kid && atual.kid === kid ? [...atual.hmacs] : [];
      if (querLimpar) hmacs = [];
      if (novoHmac && !hmacs.includes(novoHmac)) {
        if (hmacs.length >= MAX_ALVOS) { res.status(400).json({ ok: false, error: `No máximo ${MAX_ALVOS} números de teste.` }); return; }
        hmacs.push(novoHmac);
      }
      const modos = { ...atual.modos, ...novosModos };
      const agora = new Date().toISOString();
      const { error } = await bancoPrincipal().from('system_state')
        .upsert({ key: CHAVE_VIVO_ALVO, value: { kid, hmacs, modos, atualizado_em: agora }, updated_at: agora }, { onConflict: 'key' });
      if (error) throw new ErroNotas('estado_gravacao');
      zerarCacheInterruptores();
      res.json({ ok: true, alvo: await estadoAlvo() });
    } catch (err) { falhou(res, err); }
  });

  // O pedido de sonda. Mesma lista fechada e mesmos limites de parâmetro do comandos.ts (a validação é a de lá).
  // Aqui só GRAVA ag5040_comando; o cron do ensaio executa em até 5 min e grava ag5040_comando_resultado.
  router.post('/ensaio/comando', ...base, soSocioControles, async (req: Request, res: Response) => {
    const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    if (!ehAcao(b.acao)) { res.status(400).json({ ok: false, error: 'Ação fora da lista.', permitidas: [...ACOES] }); return; }
    const params = (b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {}) as Params;
    if (b.acao === 'ficha_teste' && b.confirmar !== true) {
      res.status(400).json({ ok: false, error: 'A ficha de teste envia uma mensagem de verdade. Confirme.', precisa: 'confirmar' }); return;
    }
    const reqId = b.req_id === undefined ? null : b.req_id;
    if (reqId !== null && (typeof reqId !== 'string' || !/^[0-9a-f]{8,64}$/.test(reqId))) {
      res.status(400).json({ ok: false, error: 'Identificador do pedido inválido.' }); return;
    }
    const agora = new Date();
    const v = validarParams(b.acao, params, agora);
    if (!v.ok) { res.status(400).json({ ok: false, error: `Parâmetro inválido: ${v.motivo}.` }); return; }
    try {
      if (reqId) {
        // O mesmo req_id de novo é reenvio do mesmo clique: responde com o pedido que já foi gravado, sem gravar outro.
        const ult = (await lerChave(CHAVE_REQ)).value as { id?: unknown; acao?: unknown; pedido_em?: unknown } | null;
        if (ult && ult.id === reqId && ult.acao === b.acao && typeof ult.pedido_em === 'string') {
          res.status(202).json({ ok: true, acao: b.acao, pedido_em: ult.pedido_em, duplicado: true }); return;
        }
      }
      const atual = lerComando((await lerChave(CHAVE_COMANDO)).value);
      if (atual && agora.getTime() - Date.parse(atual.pedido_em) <= IDADE_MAX_MS) {
        res.status(409).json({ ok: false, error: 'Já tem um pedido aguardando o próximo ciclo. Espere ele rodar.', pedido_em: atual.pedido_em }); return;
      }
      const pedidoEm = agora.toISOString();
      const { error } = await bancoPrincipal().from('system_state')
        .upsert({ key: CHAVE_COMANDO, value: { acao: b.acao, params: JSON.parse(JSON.stringify(v.params)), pedido_em: pedidoEm }, updated_at: pedidoEm }, { onConflict: 'key' });
      if (error) throw new ErroNotas('estado_gravacao');
      if (reqId) {
        // Se esta anotação falhar, o pedido já está gravado: o reenvio só perde a proteção, não o pedido.
        await bancoPrincipal().from('system_state')
          .upsert({ key: CHAVE_REQ, value: { id: reqId, acao: b.acao, pedido_em: pedidoEm }, updated_at: pedidoEm }, { onConflict: 'key' });
      }
      res.status(202).json({ ok: true, acao: b.acao, pedido_em: pedidoEm });
    } catch (err) { falhou(res, err); }
  });

  router.get('/ensaio/comando', ...base, soSocioControles, async (_req: Request, res: Response) => {
    try {
      const [c, r] = await Promise.all([lerChave(CHAVE_COMANDO), lerChave(CHAVE_RESULTADO)]);
      const cmd = lerComando(c.value);
      const pendente = !!cmd && Date.now() - Date.parse(cmd.pedido_em) <= IDADE_MAX_MS;
      let resultado = r.value;
      if (typeof resultado === 'string') { try { resultado = JSON.parse(resultado); } catch { resultado = null; } }
      res.json({
        ok: true, pendente,
        comando: cmd ? { acao: cmd.acao, params: cmd.params, pedido_em: cmd.pedido_em } : null,
        resultado: resultado && typeof resultado === 'object' ? resultado : null,
      });
    } catch (err) { falhou(res, err); }
  });
}
