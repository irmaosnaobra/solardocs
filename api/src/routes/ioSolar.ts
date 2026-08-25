import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
import { agendaFechadaNoIso, ehSocio, MOTIVO_FECHADA } from '../services/agenda/agendaFechada';

// ─────────────────────────────────────────────────────────────────────────────
// Alerta de lead novo da LP de Energia Solar (/io/solar) no WhatsApp da equipe.
//
// Mesma blindagem da LP do eletroposto (ver ioEletroposto.ts): a página é HTML
// público, então este endpoint NÃO confia no corpo — recebe só o id e LÊ a ficha
// do banco. Só ficha created_by='lp_solar', criada nos últimos 10 min, e
// idempotente por id. Sem isso, um curl em loop viraria spam na linha da equipe.
//
// Diferença pro eletroposto: a vistoria é PRESENCIAL, então o endereço vai em
// destaque — é pra lá que o técnico se desloca.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Exportada porque o solarRespostas.ts precisa do número do dono (thiago) como
// rede: quando a ficha não tem consultor com WhatsApp cadastrado, a resposta do
// cliente ainda tem que cair na mão de alguém.
export const EQUIPE: Record<string, string> = {
  nilce: '34991516846',
  thiago: '34991360223',
  diego: '34991360172',
};

const JANELA_MS = 10 * 60 * 1000;
const jaAvisado = new Set<number>();

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

function montarMensagem(a: any): string {
  const quando = a.quando
    ? new Date(a.quando).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit',
        month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : 'sem horário';

  // A observação já vem estruturada da LP: tipo, conta, imóvel, telhado, etc.
  const obs: string[] = String(a.observacao || '').split('\n').filter(Boolean);
  const tipo = (obs[0] || '').replace('LP SOLAR — ', '') || '—';
  const linha = (rot: string) => obs.find(l => l.startsWith(rot))?.replace(rot, '').trim() || '—';

  // Sol = energia solar (o eletroposto usa ♻️): dá pra saber a linha e a
  // temperatura batendo o olho na notificação, sem abrir a mensagem.
  const temp = String(a.temperatura || '').toLowerCase();
  const SOL: Record<string, string> = { quente: '☀️☀️☀️', morno: '☀️☀️', frio: '☀️' };
  const NOME: Record<string, string> = { quente: '*LEAD QUENTE*', morno: '*Lead morno*', frio: '*Lead frio*' };
  const selo = `${SOL[temp] || '☀️'} ${NOME[temp] || '*Lead*'}`;

  return [
    `*NOVA VISTORIA — ENERGIA SOLAR*`,
    `${selo}`,
    ``,
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || '—'}`,
    ``,
    `*Cliente:* ${a.cliente_nome || '—'}`,
    `*WhatsApp:* wa.me/${soDigitos(a.cliente_telefone)}`,
    `*Endereço:* ${linha('Endereço:')}`,
    `*Cidade:* ${a.cidade || '—'}`,
    ``,
    `*Tipo:* ${tipo}`,
    `*Conta de luz:* ${linha('Conta de luz:')}`,
    `*Imóvel:* ${linha('Imóvel:')}`,
    `*Telhado:* ${linha('Telhado:')}`,
    `*Padrão:* ${linha('Padrão:')}`,
    `*Urgência:* ${linha('Urgência:')}`,
    `*Pagamento:* ${linha('Pagamento:')}`,
    `*Decisor:* ${linha('Decisor:')}`,
    `*Simulou:* ${linha('Simulou:')}`,
    ``,
    `_Veja no CRM: solardoc.app/gerador_`,
  ].join('\n');
}

router.post('/alerta', async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id invalido' }); return; }
  if (jaAvisado.has(id)) { res.json({ ok: true, ja_avisado: true }); return; }

  try {
    const { data, error } = await supabaseGerador
      .from('agendamentos')
      .select('id,vendedor_nome,quando,cliente_nome,cliente_telefone,cidade,temperatura,observacao,created_at,created_by')
      .eq('id', id)
      .eq('created_by', 'lp_solar')   // só ficha da LP solar
      .single();

    if (error || !data) { res.status(404).json({ error: 'nao encontrado' }); return; }

    const idade = Date.now() - new Date(data.created_at).getTime();
    if (idade > JANELA_MS) { res.status(410).json({ error: 'fora da janela' }); return; }

    jaAvisado.add(id);   // marca ANTES de enviar: falha de envio não vira loop de retry
    const msg = montarMensagem(data);

    const envios = await Promise.allSettled(
      Object.values(EQUIPE).map(num => sendWhatsApp(num, msg, 'io')),
    );
    const ok = envios.filter(e => e.status === 'fulfilled').length;
    envios.forEach((e, i) => {
      if (e.status === 'rejected') {
        logger.error('io-solar-alerta', `falhou pra ${Object.keys(EQUIPE)[i]}`, e.reason);
      }
    });

    logger.info('io-solar-alerta', `lead #${id} (${data.temperatura}) avisado a ${ok}/${envios.length}`);
    res.json({ ok: true, enviados: ok });
  } catch (err) {
    logger.error('io-solar-alerta', `erro no lead #${id}`, err);
    res.status(500).json({ error: 'falha' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// A AGENDA DA LP DO SOLAR, SEM CHAVE DE BANCO NO NAVEGADOR
//
// Mesma correção feita na LP do eletroposto em 18/08/2026, pelo mesmo motivo: a
// chave publishable ficava no código-fonte de uma página pública, e as tabelas
// estão com RLS desligada. Conferido com curl de fora: a chave lia as fichas
// inteiras de `eletroposto_nota1` e era aceita num DELETE.
//
// Três rotas, e cada uma devolve só o que a página precisa:
//   GET  /agenda    horários ocupados (timestamp + de quem), sem nome de cliente
//   GET  /cliente   de quem é este telefone
//   POST /agendar   grava a vistoria
//
// A que mais vazava: a página baixava `cliente_telefone` e `quando` de TODO
// mundo cujos 8 últimos dígitos batessem com o número digitado.
// ═══════════════════════════════════════════════════════════════════════════

/** Quem aparece na agenda desta LP. Nilce e Giovanna atendem conta baixa; os
 *  sócios, conta alta. Giovanna entrou no rodízio em 18/08 e ainda não tem
 *  grade própria — por isso ela não entra na leitura de ocupação. */
const DONOS_SOLAR = ['Nilce', 'Thiago', 'Diego'];
/** Conta alta: quem recebe o lead acima de 700 kWh, alternado. */
const DONOS_ALTA = ['Thiago', 'Diego'];
/** Conta baixa: 3 Nilce : 1 Giovanna, a proporção que o Thiago pediu. */
const TIME_BAIXA = ['Nilce', 'Giovanna'];
const FILA_BAIXA = ['Nilce', 'Nilce', 'Nilce', 'Giovanna'];
/** Piso de data do rodízio da conta baixa: é ele que faz o "começa amanhã"
 *  valer sozinho. Sem o piso, o resto da divisão sairia do histórico inteiro. */
const BAIXA_INICIO = '2026-08-18T00:00:00-03:00';

const soDigitosSolar = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** DDD + 8 últimos. A MESMA chave do CRM — tolera o 9 e o 55. */
function telKeySolar(raw: unknown): string | null {
  const d = soDigitosSolar(raw).replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

router.get('/agenda', async (req: Request, res: Response): Promise<void> => {
  const de = String(req.query.de || '').slice(0, 30);
  const ate = String(req.query.ate || '').slice(0, 30);
  if (!de || !ate) { res.status(400).json({ error: 'de/ate obrigatorios' }); return; }
  try {
    const [ocupadosQ, altaQ, baixaQ] = await Promise.all([
      supabaseGerador.from('agendamentos')
        .select('quando, vendedor_nome, created_by')
        .gte('quando', de).lte('quando', ate)
        .in('vendedor_nome', DONOS_SOLAR)
        .not('status', 'in', '(cancelado,sem_interesse)')
        .limit(500),
      supabaseGerador.from('agendamentos')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', 'lp_solar').in('vendedor_nome', DONOS_ALTA),
      // Conta TODAS as fichas das duas, não só as da LP: o lead entra por três
      // portas (LP, formulário do Meta e DM), e três contadores separados dariam
      // três rodízios independentes.
      supabaseGerador.from('agendamentos')
        .select('id', { count: 'exact', head: true })
        .in('vendedor_nome', TIME_BAIXA).gte('created_at', BAIXA_INICIO),
    ]);

    const ocupados = ((ocupadosQ.data || []) as Array<Record<string, unknown>>)
      .filter(a => a.quando)
      .map(a => ({
        ts: new Date(String(a.quando)).getTime(),
        dono: String(a.vendedor_nome),
        // A duração depende de QUEM atende: a página sabe a regra (durSolarDe),
        // o servidor só diz se aquele compromisso é desta LP ou de outra origem.
        solar: a.created_by === 'lp_solar',
      }));

    res.set('Cache-Control', 'no-store');
    res.json({
      ocupados,
      proximoAlta: DONOS_ALTA[(altaQ.count || 0) % DONOS_ALTA.length],
      proximoBaixa: FILA_BAIXA[(baixaQ.count || 0) % FILA_BAIXA.length],
    });
  } catch (err) {
    logger.error('io-solar-agenda', 'falha lendo a agenda', err);
    // `null` diz "não consegui ler" — diferente de "não tem nada marcado".
    res.json({ ocupados: null, proximoAlta: DONOS_ALTA[0], proximoBaixa: FILA_BAIXA[0] });
  }
});

router.get('/cliente', async (req: Request, res: Response): Promise<void> => {
  const alvo = telKeySolar(req.query.tel);
  if (!alvo) { res.json({ dono: null }); return; }
  try {
    const { data } = await supabaseGerador.from('agendamentos')
      .select('vendedor_nome, cliente_telefone, quando')
      .neq('status', 'cancelado')
      .ilike('cliente_telefone', `%${alvo.slice(-8)}`)
      .order('quando', { ascending: false }).limit(20);

    // O ilike casa pelos 8 últimos; o telKey confere o DDD junto, senão dois
    // números de estados diferentes viram o mesmo cliente.
    const dono = ((data || []) as Array<Record<string, unknown>>)
      .filter(a => telKeySolar(a.cliente_telefone) === alvo)
      .map(a => String(a.vendedor_nome || '')).find(Boolean) || null;

    res.set('Cache-Control', 'no-store');
    res.json({ dono });
  } catch (err) {
    logger.error('io-solar-cliente', 'falha lendo o historico', err);
    res.json({ dono: null });
  }
});

router.post('/agendar', async (req: Request, res: Response): Promise<void> => {
  const b = req.body || {};
  const nome = String(b.cliente_nome || '').trim().slice(0, 120);
  const tel = soDigitosSolar(b.cliente_telefone);
  const quando = String(b.quando || '');
  const dono = String(b.vendedor_nome || '');
  const PERMITIDOS = [...DONOS_SOLAR, ...TIME_BAIXA];

  if (nome.length < 3) { res.status(400).json({ error: 'nome invalido' }); return; }
  if (tel.length < 12 || tel.length > 13 || !tel.startsWith('55')) {
    res.status(400).json({ error: 'telefone invalido' }); return;
  }
  if (!PERMITIDOS.includes(dono)) { res.status(400).json({ error: 'consultor invalido' }); return; }
  if (!quando || Number.isNaN(new Date(quando).getTime())) {
    res.status(400).json({ error: 'horario invalido' }); return;
  }
  // AGENDA FECHADA (25–27/08/2026, Intersolar) — só pros SÓCIOS, que são quem
  // está na feira. A Nilce e a Giovanna continuam recebendo ligação normalmente
  // nesses três dias, e por isso o corte é por nome e não pela data sozinha.
  if (ehSocio(dono) && agendaFechadaNoIso(quando)) {
    res.status(409).json({ error: 'dia fechado', motivo: MOTIVO_FECHADA }); return;
  }

  try {
    const { data, error } = await supabaseGerador.from('agendamentos').insert({
      vendedor_nome: dono,
      quando,
      cliente_nome: nome,
      cliente_telefone: tel,
      cidade: String(b.cidade || '').trim().slice(0, 200) || null,
      status: 'agendado',
      temperatura: b.temperatura === 'quente' ? 'quente' : 'morno',
      observacao: String(b.observacao || '').slice(0, 4000),
      created_by: 'lp_solar',
    }).select('id').single();
    if (error) throw error;
    res.json({ ok: true, id: data?.id ?? null });
  } catch (err) {
    logger.error('io-solar-agendar', `falha gravando ${tel}`, err);
    res.status(500).json({ ok: false, error: 'nao consegui gravar' });
  }
});

export default router;
