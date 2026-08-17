import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
// Quem decide entre o grupo de WhatsApp e a página de venda é o estado do
// catálogo do PlugCash. A pergunta mora numa função só — este endpoint e o tick
// do convite garantido precisam responder igual, senão a página cobra e o tick
// entrega de graça dez minutos depois.
import { ofertaDeEntradaVendavel } from '../services/plugcashService';
// Os eventos do funil vivem em pc_eventos, no projeto solardoc-pro.
import { supabase as supabasePc } from '../utils/supabase';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
// A copy do convite mora no serviço de repescagem (é a MESMA mensagem nos dois
// caminhos: LP em tempo real e fila de quem ficou sem resposta no apagão).
import { bolhaConviteDaPagina } from '../services/io/eletropostoRepescagem';

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
    // "DEFINIR PONTO" saiu em 14/08: com o corte de quem não tem local, 3 em cada 4
    // NOTA 2 passaram a ser leads COM o ponto definido a quem falta capital ou o aval
    // de quem decide. O selo é o que o consultor lê pra priorizar — não pode mentir.
    2: '🟡 *NOTA 2 — FALTA UMA PERNA*',
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
    // "Endereço:" só existe na ficha de quem respondeu ter o ponto definido (a LP
    // voltou a pedir o endereço em 14/08, atrás dessa resposta). Por isso a linha é
    // condicional: fixa, ela viraria "Endereço: —" em toda reunião de quem ainda está
    // negociando o local — ruído no lugar de informação.
    ...(tem('Endereço:') ? [`*Endereço:* ${linha('Endereço:')}`] : []),
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

// ─────────────────────────────────────────────────────────────────────────────
// Funil do NOTA 1, agregado — alimenta /gerador/eletroposto/metricas.
//
// Público, e de propósito: devolve SÓ contagem, nenhum nome, telefone ou e-mail.
// O painel do CRM já lê `agendamentos` inteiro com a chave publicável (é assim
// que o /gerador sempre funcionou), então uma contagem agregada aqui expõe
// estritamente menos do que já está exposto — e sem ela o painel mostraria "—"
// justamente na etapa que decide se a página de venda funciona.
//
// Os eventos moram em `pc_eventos`, no OUTRO projeto Supabase (solardoc-pro),
// que tem RLS fechado. Por isso a leitura passa pela API em vez de ir direto do
// navegador, como o resto do painel faz.
// ─────────────────────────────────────────────────────────────────────────────
const FUNIL_TIPOS = ['material_view', 'checkout_start', 'purchase'] as const;

router.get('/funil', async (req: Request, res: Response): Promise<void> => {
  const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
  const desde = new Date(Date.now() - dias * 86400_000).toISOString();
  try {
    const { data, error } = await supabasePc
      .from('pc_eventos')
      .select('tipo,payload,created_at')
      .in('tipo', FUNIL_TIPOS as unknown as string[])
      .gte('created_at', desde)
      .limit(20000);
    if (error) throw error;

    const total: Record<string, number> = {};
    const porMotivo: Record<string, Record<string, number>> = {};
    for (const e of (data || []) as any[]) {
      total[e.tipo] = (total[e.tipo] || 0) + 1;
      const motivo = e.payload?.motivo;
      if (motivo) {
        porMotivo[motivo] = porMotivo[motivo] || {};
        porMotivo[motivo][e.tipo] = (porMotivo[motivo][e.tipo] || 0) + 1;
      }
    }
    res.json({ dias, total, por_motivo: porMotivo });
  } catch (err) {
    logger.error('io-eletroposto-funil', 'falha lendo pc_eventos', err);
    // Contagem indisponível vira null, nunca zero: zero é uma afirmação ("nada
    // aconteceu") e aqui a verdade é "não consegui contar".
    res.json({ dias, total: null, por_motivo: null });
  }
});

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

  // ── Grupo × oferta: quem decide é a oferta estar VENDÁVEL ──
  // Desde 17/08/2026 o NOTA 1 cai em /io/eletroposto/parceria, a página das duas
  // portas (tem o capital × tem o ponto), e o link do grupo está NA TELA. Por
  // isso o convite por WhatsApp virou reforço, não caminho único: ele só sai
  // quando não existe oferta paga concorrendo com ele no mesmo minuto.
  //
  // Publicou o curso e colou o link no /admin? A bolha para sozinha. Despublicou?
  // Ela volta sozinha. A página, o cadastro e o aviso da equipe acontecem nos
  // três casos.
  //
  // A ESTRUTURA MUDOU EM 17/08: até aqui, "oferta vendável" fazia o handler dar
  // `return` — e levava junto o aviso da equipe lá embaixo, que é justamente o
  // que faz alguém casar investidor com dono de ponto. O corte agora desliga só
  // a bolha; gravação e aviso são incondicionais.
  let convidar = !(await ofertaDeEntradaVendavel());

  // Já convidado nas últimas 24h? Não repete. Vale pro caso de o lead preencher
  // o formulário duas vezes (acontece: ele volta pra corrigir o ponto).
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

  // Background: a LP não espera o WhatsApp pra levar o lead pra página das portas.
  (async () => {
    if (convidar) {
      const primeiroNome = nome.split(/\s+/)[0];
      try {
        // UMA bolha, não cinco: a página das portas já mostrou o link, e repetir
        // o passo anterior em cinco mensagens gasta a linha IO — que foi
        // bloqueada uma vez justamente por volume.
        for (const bolha of bolhaConviteDaPagina(primeiroNome)) {
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
    }

    // O NOTA 1 é avisado no WhatsApp da equipe, mesmo sem agendar (pedido do
    // Thiago em 01/08). Ele não ocupa agenda, mas continua sendo lead: quem tem
    // capital e não tem local é o par de quem tem ponto e não tem dinheiro, e é a
    // equipe que faz esse casamento. Uma mensagem só, não as 5 do convite.
    // Fora do `if` do convite de propósito: convite desligado (ou que falha) não
    // pode esconder o lead da equipe — é justamente aí que alguém vai na mão.
    try {
      const comCapital = !!(lead.invest && INVEST_COM_CAPITAL.has(lead.invest));
      const aviso = [
        comCapital ? '💰 *NOTA 1 COM CAPITAL — investidor sem local*' : '🔴 *NOTA 1 — não agendou*',
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
          ? '_Tem com quê e não tem onde: é o par de quem tem ponto e não tem dinheiro. Foi pra página das duas portas._'
          : '_Sem local definido não há o que orçar. Foi pra página das duas portas._',
      ].join('\n');
      await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, aviso, 'io')));
    } catch (err) {
      logger.error('io-eletroposto-nota1', `aviso da equipe falhou pra ${telefone}`, err);
    }
  })();
});

// ─────────────────────────────────────────────────────────────────────────────
// CONEXÃO ELETROPOSTO — as duas portas de /io/eletroposto/parceria.
//
// A régua diz que NOTA 1 é quem não tem local. Em 55 fichas, 42 declararam
// capital e 1 tinha ponto definido: a base inteira é UM lado do negócio. O outro
// lado — quem tem o estacionamento, o pátio, o terreno na rota e não vai
// investir — nunca preencheu a LP, porque a LP pergunta por investidor.
//
// Estas rotas existem pra capturar os dois e deixar o casamento possível:
//   GET  /grupos    → os links dos grupos (a página é HTML estático, não lê env)
//   POST /parceria  → grava o lado escolhido e devolve o link do grupo certo
//
// Público, como o resto da LP. Se protege por formato + upsert por (lado,
// telefone): reenviar o mesmo formulário atualiza a linha, não cria fila.
// ─────────────────────────────────────────────────────────────────────────────

/** O grupo que já existe hoje é o dos investidores — quem está lá é NOTA 1 com capital. */
const GRUPO_CAPITAL = () => (process.env.IO_GRUPO_EP_CAPITAL_LINK || process.env.IO_GRUPO_ELETROPOSTO_LINK || '').trim()
  || 'https://chat.whatsapp.com/BUhE93ZvMp2DZlZDsL2g7M';
/**
 * O grupo dos donos de ponto ainda não existe — precisa ser criado no WhatsApp e
 * o link colado em IO_GRUPO_EP_PONTO_LINK. Enquanto não vier, cai no mesmo grupo
 * do capital: misturar os dois lados é pior que separar, mas é MUITO melhor que
 * mandar quem tem o ponto (o ativo escasso) pra um botão que não abre nada.
 */
const GRUPO_PONTO = () => (process.env.IO_GRUPO_EP_PONTO_LINK || '').trim() || GRUPO_CAPITAL();

router.get('/grupos', (_req: Request, res: Response): void => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    capital: GRUPO_CAPITAL(),
    ponto: GRUPO_PONTO(),
    // A página avisa a equipe (não o lead) quando os dois são o mesmo link.
    separados: GRUPO_PONTO() !== GRUPO_CAPITAL(),
  });
});

// ── Placar da página: quantos já estão de cada lado ──
// A página mostra isto como prova social, então tem que ser CONTAGEM DE VERDADE,
// que sobe sozinha. O lado capital soma os dois caminhos: quem se cadastrou na
// página e o NOTA 1 que declarou recurso e nunca clicou em nada — ele existe na
// base e é exatamente quem um dono de ponto quer encontrar.
// Contagem que falha vira null, nunca 0: zero afirmaria "não tem ninguém".
router.get('/parceria/placar', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [cadCapital, cadPonto, nota1Capital] = await Promise.all([
      supabaseGerador.from('eletroposto_parceria').select('id', { count: 'exact', head: true }).eq('lado', 'capital'),
      supabaseGerador.from('eletroposto_parceria').select('id', { count: 'exact', head: true }).eq('lado', 'ponto'),
      supabaseGerador.from('eletroposto_nota1').select('id', { count: 'exact', head: true })
        .in('capital_faixa', ['proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj'])
        .is('lado', null),
    ]);
    res.set('Cache-Control', 'public, max-age=300');
    // Contagem que DEU CERTO devolve o número, zero inclusive — a página é que
    // decide o que fazer com um zero (o lado do ponto começa vazio por
    // definição, e "0 pontos com 38 investidores esperando" é justamente o
    // argumento de quem tem o local). Null aqui significa só uma coisa: não
    // consegui contar.
    res.json({
      capital: (cadCapital.count || 0) + (nota1Capital.count || 0),
      ponto: cadPonto.count || 0,
    });
  } catch (err) {
    logger.error('io-eletroposto-parceria', 'falha contando o placar', err);
    res.json({ capital: null, ponto: null });
  }
});

const LADOS = new Set(['capital', 'ponto']);
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;

router.post('/parceria', async (req: Request, res: Response): Promise<void> => {
  const b = req.body || {};
  const lado = String(b.lado || '').trim();
  const nome = String(b.nome || '').trim().slice(0, 120);
  const telefone = soDigitos(String(b.telefone || ''));

  if (!LADOS.has(lado)) { res.status(400).json({ error: 'lado invalido' }); return; }
  if (nome.length < 3)  { res.status(400).json({ error: 'nome invalido' }); return; }
  if (telefone.length < 12 || telefone.length > 13 || !telefone.startsWith('55')) {
    res.status(400).json({ error: 'telefone invalido' }); return;
  }

  const link = lado === 'ponto' ? GRUPO_PONTO() : GRUPO_CAPITAL();
  const bruto = {
    lado, nome, telefone,
    cidade:         txt(b.cidade, 120),
    // QUANTO (faixa em reais) e COM QUÊ (recurso próprio, financiamento…) são
    // perguntas diferentes e moram em colunas diferentes: quem vem da LP com um
    // toque só respondeu a segunda, e misturar as duas numa coluna só deixaria
    // "Recurso próprio" na mesma lista de "R$ 50 mil a R$ 100 mil".
    capital_faixa:  txt(b.capital_faixa, 120),
    capital_origem: txt(b.capital_origem, 120),
    prazo:          txt(b.prazo, 80),
    ponto_relacao:  txt(b.ponto_relacao, 80),
    ponto_tipo:     txt(b.ponto_tipo, 120),
    ponto_endereco: txt(b.ponto_endereco, 300),
    ponto_vagas:    txt(b.ponto_vagas, 40),
    ponto_fluxo:    txt(b.ponto_fluxo, 120),
    ponto_energia:  txt(b.ponto_energia, 40),
    obs:            txt(b.obs, 600),
    origem:         b.origem === 'lp_nota1' ? 'lp_nota1' : 'link_direto',
    grupo_click_at: new Date().toISOString(),
    ...utm(b),
  };

  // CAMPO VAZIO NÃO APAGA CAMPO CHEIO.
  // O upsert é por (lado, telefone) e o PostgREST só sobrescreve as colunas que
  // vêm no corpo — então mandar `null` num campo que este envio não perguntou
  // apaga o que o envio anterior gravou. Pego em produção: a pessoa preenche o
  // formulário inteiro, volta pela LP e entra pelo atalho de um toque (que só
  // manda nome, telefone e cidade), e a faixa de capital some. Do lado do PONTO
  // seria pior: sumiria o ENDEREÇO, que é o motivo do cadastro existir.
  // Chave sem valor sai do objeto; o que está no banco fica onde está.
  const linha: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bruto)) if (v !== null && v !== undefined) linha[k] = v;

  // Responde ANTES do banco: o próximo passo do lead é abrir o WhatsApp, e ele
  // não pode ficar olhando um botão girando enquanto a gente grava.
  res.json({ ok: true, link });

  (async () => {
    let id: number | null = null;
    try {
      const { data, error } = await supabaseGerador
        .from('eletroposto_parceria')
        .upsert(linha, { onConflict: 'lado,telefone' })
        .select('id').single();
      if (error) throw error;
      id = data?.id ?? null;
    } catch (err) {
      logger.error('io-eletroposto-parceria', `falha gravando ${lado} ${telefone}`, err);
    }

    // Carimba a porta na ficha do funil também: "quantos dos recusados escolheram
    // alguma porta" é pergunta do funil, e o painel do /admin lê a ficha.
    try {
      await supabaseGerador.from('eletroposto_nota1')
        .update({ lado, lado_em: new Date().toISOString() })
        .eq('telefone', telefone).is('lado', null);
    } catch { /* a ficha pode nem existir: quem entra por link direto não é NOTA 1 */ }

    // ── Aviso da equipe ──
    // Só o lado PONTO dispara: investidor sem local a equipe já recebe pelo aviso
    // do NOTA 1, e repetir o mesmo lead em duas mensagens treina todo mundo a
    // ignorar as duas. Ponto é o que não existe na base — esse acorda alguém.
    //
    // `teste: true` grava e não manda, igual ao /nota1 — é assim que se confere a
    // rota em produção sem tocar o WhatsApp do Thiago e do Diego.
    if (lado !== 'ponto' || b.teste === true) return;
    try {
      const aviso = [
        '📍 *PONTO NOVO — alguém quer arrendar o local*',
        '',
        `*Nome:* ${nome}`,
        `*WhatsApp:* wa.me/${telefone}`,
        `*Cidade:* ${bruto.cidade || '—'}`,
        `*Relação com o imóvel:* ${bruto.ponto_relacao || '—'}`,
        `*Tipo de local:* ${bruto.ponto_tipo || '—'}`,
        `*Endereço:* ${bruto.ponto_endereco || '—'}`,
        `*Vagas:* ${bruto.ponto_vagas || '—'}`,
        `*Movimento:* ${bruto.ponto_fluxo || '—'}`,
        `*Entrada trifásica:* ${bruto.ponto_energia || '—'}`,
        ...(bruto.obs ? ['', `_${bruto.obs}_`] : []),
        '',
        '_Este é o lado que falta na base. Tem investidor com capital esperando ponto no /admin → Nota 1._',
      ].join('\n');
      await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, aviso, 'io')));
      logger.info('io-eletroposto-parceria', `ponto novo #${id ?? '?'} de ${nome} (${telefone})`);
    } catch (err) {
      logger.error('io-eletroposto-parceria', `aviso do ponto falhou pra ${telefone}`, err);
    }
  })();
});

export default router;
