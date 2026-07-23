import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';

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

const EQUIPE: Record<string, string> = {
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

export default router;
