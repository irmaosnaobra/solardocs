import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
// Os eventos do funil vivem em pc_eventos, no projeto solardoc-pro.
import { supabase as supabasePc } from '../utils/supabase';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
// A dica de "quem está perto" no aviso: quem tem o ponto procura investidor e
// vice-versa. Falha aqui nunca segura o aviso — devolve bloco vazio.
import { blocoParesSeguro } from '../services/io/eletropostoPares';

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
//   2. Não manda mensagem nenhuma: desde 17/08 ele só GRAVA e avisa a equipe.
// Gravar nunca é bloqueado: perder o lead é o erro pior.
// ─────────────────────────────────────────────────────────────────────────────

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

  // ── NENHUMA MENSAGEM SAI DAQUI (17/08/2026) ──
  // Ordem do Thiago: em vez de grupo, o NOTA 1 se cadastra em
  // /io/eletroposto/parceria e a equipe trabalha a lista na aba
  // Eletroposto → Cadastros do /gerador (Arrendamento e Investidores).
  //
  // A bolha que saía daqui empurrava um destino que deixou de existir. Some
  // junto o teto por hora e a trava de 24h, que só existiam por causa dela.
  // A varredura de "convite garantido" foi desligada no mesmo ato — sem isso ela
  // viraria a ÚNICA remetente, porque procura exatamente ficha sem convite.
  //
  // O que continua saindo é o AVISO DA EQUIPE, e ele é incondicional: até 17/08
  // o handler dava `return` quando a oferta do material estava vendável e levava
  // esse aviso junto, calado.
  res.json({ ok: true, id, convite: false });

  // Background: a LP não espera nada disto pra levar o lead pra página das portas.
  (async () => {

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
//   GET  /parceria/placar → contagem de cada lado (a página mostra como prova)
//   POST /parceria        → grava o cadastro do lado escolhido
//
// NÃO HÁ MAIS GRUPO (17/08/2026): ordem do Thiago é cadastro, e a equipe
// trabalha a lista na aba Eletroposto → Cadastros do /gerador. Ninguém recebe
// mensagem por se cadastrar — o único WhatsApp que sai daqui é o aviso INTERNO
// de ponto novo, pra quem é da casa.
//
// Público, como o resto da LP. Se protege por formato + upsert por (lado,
// telefone): reenviar o mesmo formulário atualiza a linha, não cria fila.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Recado interno pros 2 números salvos. Um envio que falha não impede o outro. */
async function avisarEquipe(texto: string): Promise<void> {
  await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, texto, 'io')));
}

/**
 * MARK→SEND: carimba que este lado deste telefone já foi anunciado.
 * Devolve `true` quando JÁ estava carimbado — ou seja, "não mande de novo".
 *
 * Por que no banco e não num Set em memória, como o /alerta faz: função
 * serverless morre e renasce, e duas instâncias não compartilham memória. O
 * reenvio é real — a página desiste em 8s e reabilita o botão, então quem está
 * em rede ruim manda duas vezes.
 *
 * Falha de escrita libera o envio de propósito: perder um aviso é pior que
 * mandar dois, e o único jeito de errar aqui é o banco estar fora.
 */
async function marcarAviso(lado: string, telefone: string): Promise<boolean> {
  const key = `ep_parceria_aviso:${lado}:${telefone}`;
  try {
    const { data } = await supabasePc
      .from('system_state').select('key').eq('key', key).maybeSingle();
    if (data) return true;
    await supabasePc.from('system_state').insert({ key, value: new Date().toISOString() });
    return false;
  } catch (err) {
    logger.error('io-eletroposto-parceria', `marcador de aviso falhou (${key})`, err);
    return false;
  }
}

/**
 * Este lead já foi anunciado pelo POST /nota1 minutos atrás?
 *
 * Aconteceu de verdade: uma pessoa preencheu a LP às 23:40 (aviso de NOTA 1) e
 * se cadastrou como investidor às 23:41 — dois avisos quase idênticos sobre a
 * mesma pessoa, em 69 segundos.
 *
 * Duas travas porque uma só não basta: `origem` vem do cliente e some quando o
 * lead abre a página numa aba nova; a ficha no banco é a verdade durável.
 */
async function jaAnunciadoPeloNota1(telefone: string, origem: string): Promise<boolean> {
  if (origem === 'lp_nota1') return true;
  try {
    const desde = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await supabaseGerador
      .from('eletroposto_nota1').select('id')
      .eq('telefone', telefone).gte('created_at', desde).limit(1);
    return !!(data && data.length);
  } catch {
    return false;   // na dúvida avisa: silêncio é o erro caro
  }
}

/**
 * O padrão declarado provavelmente NÃO aguenta um eletroposto.
 *
 * Não é laudo — é triagem: monofásico ou disjuntor de até 40 A não sustentam
 * carregador de potência nenhuma sem aumento de carga, e aumento de carga na
 * concessionária custa dinheiro e meses. O consultor precisa saber disso ANTES
 * de marcar reunião pra um ponto que, no papel, já nasce com obra.
 *
 * "Não sei" NÃO entra aqui de propósito: desconhecimento não é diagnóstico, e
 * marcar como fraco quem só não olhou a conta descartaria ponto bom.
 */
function padraoFraco(p: { padrao_ligacao?: unknown; padrao_disjuntor?: unknown }): boolean {
  const lig = String(p.padrao_ligacao || '');
  const dis = String(p.padrao_disjuntor || '');
  return /Monof/i.test(lig) || /Até 40/i.test(dis);
}

/** Campo do registro, sempre string legível. */
const v = (r: Record<string, unknown>, k: string) => String(r[k] ?? '').trim() || '—';

/**
 * PONTO NOVO — o lado escasso. Este aviso é o que faz alguém largar o que está
 * fazendo, então ele carrega o endereço, o padrão e quem está perto.
 */
export function montarAvisoPonto(reg: Record<string, unknown>, dica: string[]): string {
  return [
    '📍 *PONTO NOVO — alguém quer arrendar o local*',
    '',
    `*Nome:* ${v(reg, 'nome')}`,
    `*WhatsApp:* wa.me/${String(reg.telefone || '')}`,
    `*Cidade:* ${v(reg, 'cidade')}`,
    `*Relação com o imóvel:* ${v(reg, 'ponto_relacao')}`,
    `*Tipo de local:* ${v(reg, 'ponto_tipo')}`,
    `*Endereço:* ${v(reg, 'ponto_endereco')}`,
    `*Vagas:* ${v(reg, 'ponto_vagas')}`,
    `*Movimento:* ${v(reg, 'ponto_fluxo')}`,
    '',
    // O padrão vem em bloco próprio: é por ele que o consultor decide se abre o
    // caso ou se pede a foto antes de gastar uma hora.
    '⚡ *PADRÃO DE ENTRADA*',
    `*Ligação:* ${v(reg, 'padrao_ligacao')}`,
    `*Disjuntor:* ${v(reg, 'padrao_disjuntor')}`,
    `*Consumo:* ${v(reg, 'padrao_consumo')}`,
    `*Manda foto?* ${v(reg, 'padrao_foto')}`,
    ...(padraoFraco(reg)
      ? ['', '⚠️ *O padrão declarado provavelmente não aguenta* — peça a foto do padrão e da conta antes de marcar qualquer coisa. Aumento de carga na concessionária custa dinheiro e meses.']
      : []),
    ...(reg.obs ? ['', `_${String(reg.obs)}_`] : []),
    ...dica,
    '',
    '_Lista completa: solardoc.app/gerador → Eletroposto → Cadastros._',
  ].join('\n');
}

/**
 * INVESTIDOR NOVO. Passou a existir em 18/08 — antes o lado capital não avisava
 * nada, e quem entrava por link direto (sem passar pela LP) não gerava aviso
 * nenhum em lugar nenhum.
 */
export function montarAvisoCapital(reg: Record<string, unknown>, dica: string[]): string {
  return [
    '💰 *INVESTIDOR NOVO — tem o capital, falta o ponto*',
    '',
    `*Nome:* ${v(reg, 'nome')}`,
    `*WhatsApp:* wa.me/${String(reg.telefone || '')}`,
    `*Cidade:* ${v(reg, 'cidade')}`,
    `*Quanto:* ${v(reg, 'capital_faixa')}`,
    `*Com quê:* ${v(reg, 'capital_origem')}`,
    `*Prazo:* ${v(reg, 'prazo')}`,
    ...(reg.obs ? ['', `_${String(reg.obs)}_`] : []),
    ...dica,
    '',
    '_Lista completa: solardoc.app/gerador → Eletroposto → Cadastros._',
  ].join('\n');
}
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
    // `ponto_energia` é derivado da ligação lá na página, e continua gravado
    // porque a aba Cadastros e o alerta já leem esta coluna.
    ponto_energia:  txt(b.ponto_energia, 40),
    // O PADRÃO DE ENTRADA — o que decide quantos carregadores cabem, se precisa
    // de obra na concessionária e quanto tempo até ligar. Era uma pergunta só,
    // respondida no chute; virou um bloco com o porquê antes das perguntas.
    padrao_ligacao:   txt(b.padrao_ligacao, 60),
    padrao_disjuntor: txt(b.padrao_disjuntor, 40),
    padrao_consumo:   txt(b.padrao_consumo, 60),
    padrao_foto:      txt(b.padrao_foto, 60),
    obs:            txt(b.obs, 600),
    origem:         b.origem === 'lp_nota1' ? 'lp_nota1' : 'link_direto',
    cadastrado_em: new Date().toISOString(),
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

  // Responde ANTES do banco: a tela de "recebemos" aparece no ato, e gravação
  // que demora não pode virar botão girando.
  res.json({ ok: true });

  (async () => {
    // ── GRAVA, e o aviso só sai se a gravação deu certo ──
    // `.select('*')` de propósito: a mensagem é montada do REGISTRO, não do
    // corpo do request. O corpo tem os nulos removidos antes do upsert (pra
    // envio parcial não apagar campo cheio), então num reenvio a linha do banco
    // está completa e o corpo não — montar do corpo mandaria "Endereço: —" pra
    // um ponto que tem endereço gravado. É a mesma razão do /alerta ler a ficha.
    let reg: Record<string, unknown> | null = null;
    try {
      const { data, error } = await supabaseGerador
        .from('eletroposto_parceria')
        .upsert(linha, { onConflict: 'lado,telefone' })
        .select('*').single();
      if (error) throw error;
      reg = data as Record<string, unknown>;
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

    // `teste: true` grava e não manda — é assim que se confere a rota em
    // produção sem tocar o WhatsApp do Thiago e do Diego. Fica ANTES da decisão
    // por lado pra o modo teste valer em qualquer lado, hoje e nos que vierem.
    if (b.teste === true) return;

    // Gravação que falhou não vira aviso de cadastro — viraria mensagem sobre
    // uma linha que não existe, e a equipe procuraria alguém que não está lá.
    // Mas TAMBÉM não pode virar silêncio: o lead existe e ninguém sabe dele.
    if (!reg) {
      await avisarEquipe([
        '⚠️ *CADASTRO PERDIDO — grave na mão*',
        '',
        `Alguém se cadastrou como *${lado === 'ponto' ? 'DONO DE PONTO' : 'INVESTIDOR'}* e a gravação falhou.`,
        '',
        `*Nome:* ${nome}`,
        `*WhatsApp:* wa.me/${telefone}`,
        `*Cidade:* ${bruto.cidade || '—'}`,
      ].join('\n'));
      return;
    }

    // ── UMA mensagem por pessoa por lado, e ponto ──
    // A página desiste em 8s e reabilita o botão: quem está em rede ruim manda
    // duas vezes, e o upsert absorve isso calado. O marcador é gravado ANTES do
    // envio (MARK→SEND): duplicar aviso é pior que perder um, porque aviso
    // repetido treina a equipe a ignorar todos.
    const jaAvisou = await marcarAviso(lado, telefone);
    if (jaAvisou) {
      logger.info('io-eletroposto-parceria', `aviso repetido barrado: ${lado} ${telefone}`);
      return;
    }

    // O lead que veio da LP recusada JÁ foi anunciado pelo POST /nota1 minutos
    // antes, com a ficha inteira. Anunciar de novo é a mesma pessoa em duas
    // mensagens quase iguais — o jeito mais rápido de a equipe parar de ler.
    // Duas travas porque `origem` vem do cliente e some numa aba nova; a ficha
    // no banco é a durável.
    if (lado === 'capital' && await jaAnunciadoPeloNota1(telefone, String(bruto.origem || ''))) {
      logger.info('io-eletroposto-parceria', `capital ${telefone} já anunciado pelo nota1`);
      return;
    }

    try {
      const cidadeReg = (reg.cidade as string) || null;
      // A dica olha o OUTRO lado: ponto novo procura investidor, e vice-versa.
      const dica = await blocoParesSeguro(cidadeReg, lado === 'ponto' ? 'capital' : 'ponto', telefone);
      const aviso = lado === 'ponto' ? montarAvisoPonto(reg, dica) : montarAvisoCapital(reg, dica);
      await avisarEquipe(aviso);
      logger.info('io-eletroposto-parceria', `${lado} novo #${reg.id} de ${nome} (${telefone})`);
    } catch (err) {
      logger.error('io-eletroposto-parceria', `aviso falhou pra ${telefone}`, err);
    }
  })();
});

export default router;
