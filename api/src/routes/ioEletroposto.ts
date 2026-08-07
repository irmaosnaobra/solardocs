import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
// A copy do convite mora no serviço de repescagem (é a MESMA mensagem nos dois
// caminhos: LP em tempo real e fila de quem ficou sem resposta no apagão).
import { bolhasConvite } from '../services/io/eletropostoRepescagem';

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

export const EQUIPE: Record<string, string> = {
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

// ─────────────────────────────────────────────────────────────────────────────
// NOTA 1 — captura + convite automático do grupo.
//
// Até 01/08/2026 o lead NOTA 1 era descartado: a LP mostrava a tela do grupo e
// jogava fora nome, telefone e ficha. Quem não clicasse no botão do WhatsApp
// sumia sem deixar rastro, e quem clicasse esperava horas por um link que é
// constante (os dois primeiros esperaram 3h e 6h).
//
// Aqui a LP entrega a ficha no momento em que a nota sai. O lead é gravado SEMPRE
// (é isso que fecha o vazamento) e o convite sai sozinho no WhatsApp dele.
//
// Endpoint público, como o /alerta — a LP é HTML e não guarda segredo. O que ele
// não pode virar é uma máquina de mandar mensagem pra número de estranho:
//   1. Valida formato (telefone BR com DDD, nome de gente).
//   2. Mesmo telefone só recebe convite uma vez a cada 24h.
//   3. Teto global por hora — passou do teto, grava o lead e NÃO manda.
// Gravar nunca é bloqueado por esses limites: perder o lead é o erro pior.
// ─────────────────────────────────────────────────────────────────────────────

const CONVITE_TETO_HORA = 40;
let conviteJanela = { hora: -1, enviados: 0 };

function cabeNoTeto(): boolean {
  const hora = Math.floor(Date.now() / 3_600_000);
  if (conviteJanela.hora !== hora) conviteJanela = { hora, enviados: 0 };
  if (conviteJanela.enviados >= CONVITE_TETO_HORA) return false;
  conviteJanela.enviados++;
  return true;
}

// Capital de verdade declarado: é o investidor sem local — o outro lado do
// casamento com quem tem ponto e não tem dinheiro. Ganha selo no alerta.
const INVEST_COM_CAPITAL = new Set(['Recurso próprio', 'Recurso próprio + financiamento', 'Financiamento já aprovado']);

// UTM de primeiro toque que a LP guarda em sessionStorage. Chega como texto livre
// de querystring pública: corta tamanho e descarta vazio pra não gravar ''.
const UTM_CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
function utm(b: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of UTM_CAMPOS) out[k] = String(b[k] || '').trim().slice(0, 200) || null;
  return out;
}

router.post('/nota1', async (req: Request, res: Response): Promise<void> => {
  const b = req.body || {};
  const nome = String(b.nome || '').trim();
  const telefone = soDigitos(String(b.telefone || ''));
  if (nome.length < 3)   { res.status(400).json({ error: 'nome invalido' }); return; }
  if (telefone.length < 12 || telefone.length > 13 || !telefone.startsWith('55')) {
    res.status(400).json({ error: 'telefone invalido' }); return;
  }

  const lead = {
    nome,
    telefone,
    cidade:    String(b.cidade    || '').trim().slice(0, 120) || null,
    endereco:  String(b.endereco  || '').trim().slice(0, 300) || null,
    perfil:    String(b.perfil    || '').trim().slice(0, 80)  || null,
    ponto:     String(b.ponto     || '').trim().slice(0, 120) || null,
    invest:    String(b.invest    || '').trim().slice(0, 120) || null,
    decisor:   String(b.decisor   || '').trim().slice(0, 80)  || null,
    rota:      String(b.rota      || '').trim().slice(0, 120) || null,
    trifasica: String(b.trifasica || '').trim().slice(0, 40)  || null,
    pts:       Number.isFinite(Number(b.pts)) ? Number(b.pts) : null,
    ficha:     String(b.ficha     || '').trim().slice(0, 4000) || null,
    // Sem UTM não dá pra saber qual criativo trouxe o NOTA 1 — e é justamente o
    // NOTA 1 que vira comprador do PlugCash. As colunas slug (tem_ponto,
    // capital_faixa, motivo_descarte…) não vêm daqui: o trigger do banco as
    // deriva dos rótulos acima, então LP velha em cache continua entrando certa.
    ...utm(b),
  };

  let id: number | null = null;
  try {
    const { data, error } = await supabaseGerador
      .from('eletroposto_nota1').insert(lead).select('id').single();
    if (error) throw error;
    id = data?.id ?? null;
  } catch (err) {
    // Falhou a gravação: ainda assim seguimos pro convite. Um lead com o link na
    // mão vale mais que um lead numa tabela — e o log guarda a ficha.
    logger.error('io-eletroposto-nota1', `falha gravando ${telefone}`, err);
  }

  // Já convidado nas últimas 24h? Não repete. Vale pro caso de o lead preencher
  // o formulário duas vezes (acontece: ele volta pra corrigir o ponto).
  let convidar = true;
  try {
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: repetido } = await supabaseGerador
      .from('eletroposto_nota1')
      .select('id')
      .eq('telefone', telefone)
      .not('convite_enviado_at', 'is', null)
      .gte('convite_enviado_at', desde)
      .limit(1);
    if (repetido && repetido.length) convidar = false;
  } catch { /* na dúvida, convida — o teto por hora segura o estrago */ }

  // `teste: true` grava e não manda — é assim que se confere o endpoint em produção
  // sem disparar 5 bolhas pro WhatsApp de alguém.
  if (b.teste === true) convidar = false;

  if (convidar && !cabeNoTeto()) {
    convidar = false;
    logger.error('io-eletroposto-nota1', `teto de ${CONVITE_TETO_HORA}/h estourado — ${telefone} gravado sem convite`);
  }

  res.json({ ok: true, id, convite: convidar });

  if (!convidar) return;

  // Envio em background: a LP não espera o WhatsApp pra mostrar a tela do grupo.
  (async () => {
    const primeiroNome = nome.split(/\s+/)[0];
    try {
      for (const bolha of bolhasConvite(primeiroNome)) {
        await sendWhatsApp(telefone, bolha, 'io');
        await new Promise(r => setTimeout(r, 1500));
      }
      if (id) {
        await supabaseGerador.from('eletroposto_nota1')
          .update({ convite_enviado_at: new Date().toISOString() }).eq('id', id);
      }
      logger.info('io-eletroposto-nota1', `convite do grupo enviado pra ${nome} (${telefone})`);
    } catch (err) {
      logger.error('io-eletroposto-nota1', `convite falhou pra ${telefone}`, err);
      if (id) {
        await supabaseGerador.from('eletroposto_nota1')
          .update({ convite_erro: String(err).slice(0, 400) }).eq('id', id)
          .then(undefined, () => {});
      }
    }

    // TODO NOTA 1 é avisado no WhatsApp da equipe, mesmo sem agendar (pedido do
    // Thiago em 01/08). Ele não ocupa agenda, mas continua sendo lead: quem tem
    // capital e não tem local é o par de quem tem ponto e não tem dinheiro, e é a
    // equipe que faz esse casamento. Uma mensagem só, não as 5 do convite.
    // Fora do try do convite de propósito: convite que falha não pode esconder o
    // lead da equipe — é justamente aí que alguém precisa ir atrás na mão.
    try {
      const comCapital = !!(lead.invest && INVEST_COM_CAPITAL.has(lead.invest));
      const aviso = [
        comCapital ? '💰 *NOTA 1 COM CAPITAL — investidor sem local*' : '🔴 *NOTA 1 — foi pro grupo, não agendou*',
        '',
        `*Nome:* ${nome}`,
        `*WhatsApp:* wa.me/${telefone}`,
        `*Cidade:* ${lead.cidade || '—'}`,
        `*Perfil:* ${lead.perfil || '—'}`,
        `*Ponto:* ${lead.ponto || '—'}`,
        `*Como pretende investir:* ${lead.invest || '—'}`,
        `*Decisor:* ${lead.decisor || '—'}`,
        `*Pontuação:* ${lead.pts ?? '—'}/11`,
        '',
        comCapital
          ? '_Tem com quê e não tem onde: é o par de quem tem ponto e não tem dinheiro. Convite do grupo já enviado._'
          : '_Sem local definido não há o que orçar. Convite do grupo já enviado._',
      ].join('\n');
      await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, aviso, 'io')));
    } catch (err) {
      logger.error('io-eletroposto-nota1', `aviso da equipe falhou pra ${telefone}`, err);
    }
  })();
});

export default router;
