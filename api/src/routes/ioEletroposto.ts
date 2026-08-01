import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Alerta de lead novo da LP do Eletroposto (/io/eletroposto) no WhatsApp da equipe.
//
// A LP é HTML público: não pode guardar segredo nenhum. Então este endpoint é
// público e se protege sozinho:
//   1. NÃO confia no corpo do request — recebe só um id e LÊ a ficha do banco.
//      Ninguém consegue forjar o conteúdo da mensagem.
//   2. Só alerta ficha com created_by='lp_eletroposto' (não vaza o CRM inteiro).
//   3. Só alerta ficha criada nos últimos 10 min — mata replay de lead antigo.
//   4. Idempotente por id em memória — reenviar o mesmo id não redispara.
// Sem (3)+(4), um curl em loop viraria spam no WhatsApp do Thiago e a linha
// tomaria ban (a linha é a MESMA do atendimento humano).
//
// Não passa pelo lineThrottle de propósito: aquele teto existe pra outbound a
// ESTRANHOS (risco de denúncia). Aqui é recado interno pra 2 contatos salvos —
// gastar a cota da Bia com isto faria ela deixar de recuperar venda.
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

  // A observação já vem estruturada da LP: perfil, nota, ponto, forma de investir,
  // decisor, entrada trifásica e a simulação. Cada rótulo aqui é o mesmo string que a
  // LP escreve em `obs` (dashboard/public/io/eletroposto/index.html) — renomear um lado
  // sem o outro faz a linha virar "—" em silêncio.
  const obs: string[] = String(a.observacao || '').split('\n').filter(Boolean);
  const perfil = (obs[0] || '').replace('LP ELETROPOSTO — ', '') || '—';
  const linha = (rot: string) => obs.find(l => l.startsWith(rot))?.replace(rot, '').trim() || '—';
  const tem = (rot: string) => obs.some(l => l.startsWith(rot));

  // A nota (1-3) substitui os ♻️: ela carrega o que o consultor precisa decidir antes
  // de abrir a agenda — prioridade, o que falta e quanto o lead pontuou.
  // Vem da própria ficha (`NOTA 3 · 10/11 pts`); a temperatura é só o plano B, caso
  // a linha não venha (ficha antiga ou formato mudado).
  const m = String(a.observacao || '').match(/^NOTA ([123])\s*·\s*(\d+\/\d+ pts.*)$/m);
  const temp = String(a.temperatura || '').toLowerCase();
  const nota = m ? Number(m[1]) : (temp === 'quente' ? 3 : temp === 'morno' ? 2 : 1);
  const SELO: Record<number, string> = {
    3: '🟢 *NOTA 3 — PRIORIDADE*',
    2: '🟡 *NOTA 2 — DEFINIR PONTO*',
    1: '🔴 *NOTA 1 — NUTRIÇÃO*',
  };
  const selo = `${SELO[nota] || SELO[1]}${m ? `  (${m[2]})` : ''}`;
  // Tem onde instalar e não tem como pagar: o par que fecha com quem tem o contrário.
  const paraInvestidor = tem('PONTO DISPONIVEL PARA INVESTIDOR');

  return [
    `*NOVA REUNIÃO — ELETROPOSTO*`,
    `${selo}`,
    ...(paraInvestidor ? [`📍 *PONTO DISPONÍVEL PARA INVESTIDOR*`] : []),
    ``,
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || '—'}`,
    ``,
    `*Cliente:* ${a.cliente_nome || '—'}`,
    `*WhatsApp:* wa.me/${soDigitos(a.cliente_telefone)}`,
    `*Cidade:* ${a.cidade || '—'}`,
    `*Endereço:* ${linha('Endereço:')}`,
    `*Perfil:* ${perfil}`,
    ...(tem('Rota de passagem:') ? [`*Rota de passagem:* ${linha('Rota de passagem:')}`] : []),
    ``,
    `*Ponto:* ${linha('Ponto:')}`,
    `*Como pretende investir:* ${linha('Como pretende investir:')}`,
    `*Decisor:* ${linha('Decisor:')}`,
    `*Entrada trifásica:* ${linha('Entrada trifásica:')}`,
    ``,
    `*Simulou:* ${linha('Simulou')}`,
    `*Investimento estimado:* ${linha('Investimento estimado:')}`,
    `*Resultado:* ${(obs.find(l => l.startsWith('→')) || '—').replace('→', '').trim()}`,
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
      .eq('created_by', 'lp_eletroposto')   // só ficha da LP
      .single();

    if (error || !data) { res.status(404).json({ error: 'nao encontrado' }); return; }

    const idade = Date.now() - new Date(data.created_at).getTime();
    if (idade > JANELA_MS) { res.status(410).json({ error: 'fora da janela' }); return; }

    jaAvisado.add(id);   // marca ANTES de enviar: falha de envio não vira loop de retry
    const msg = montarMensagem(data);

    // Manda pra equipe toda. Um envio que falha não pode impedir o outro.
    const envios = await Promise.allSettled(
      Object.values(EQUIPE).map(num => sendWhatsApp(num, msg, 'io')),
    );
    const ok = envios.filter(e => e.status === 'fulfilled').length;
    envios.forEach((e, i) => {
      if (e.status === 'rejected') {
        logger.error('io-eletroposto-alerta', `falhou pra ${Object.keys(EQUIPE)[i]}`, e.reason);
      }
    });

    logger.info('io-eletroposto-alerta', `lead #${id} (${data.temperatura}) avisado a ${ok}/${envios.length}`);
    res.json({ ok: true, enviados: ok });
  } catch (err) {
    logger.error('io-eletroposto-alerta', `erro no lead #${id}`, err);
    res.status(500).json({ error: 'falha' });
  }
});

export default router;
