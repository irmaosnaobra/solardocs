// ─────────────────────────────────────────────────────────────────────────────
// CENTRAL DAS AGENTES — o que cada robô da casa faz, se está ligado, quanto
// mandou e o que virou dinheiro.
//
// Por que existe: hoje a resposta pra "quem está falando com meus leads agora?"
// mora em três lugares — variável de ambiente na Vercel, comentário no cron e
// marcador no `system_state`. Quando a linha caiu (01–03/ago) ninguém percebeu
// por dois dias. Esta é a tela única onde dá pra ver.
//
// REGRA DA TELA: número que a gente não sabe medir aparece como `null` e a tela
// escreve "—". Métrica inventada num painel vira decisão errada — pior que o
// buraco que ela tapa.
//
// PRIVACIDADE: o endpoint é público (o /gerador não tem token de verdade), então
// aqui só saem AGREGADOS e textos fixos das mensagens. Nada de telefone, nome de
// cliente ou conversa.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { tetosVigentesLinha } from '../agents/whatsapp/lineThrottle';
import { MAX_CARLA_POR_HORA } from '../agents/whatsapp/carlaThrottle';
import { solardocViaIo } from '../agents/zapiClient';
import { EP_ORIGENS, EP_AGENDA_INICIO, EP_AGENDA_PREFIX } from './eletropostoAgenda';
import { ORIGEM_IG } from './eletropostoIgConvite';
import { SOLAR_ORIGENS, SOLAR_BOASVINDAS_INICIO, SOLAR_ENTREGA_AMPLA_INICIO } from './solarBoasVindas';
import {
  consumoTipico, KWH_CORTE_TIME, TIME_CONTA_ALTA, TIME_CONTA_BAIXA,
} from '../agenda/leadSolarFicha';

type Estado = 'ativo' | 'desligado' | 'dark' | 'sem_agente';
type Canal = 'whatsapp' | 'instagram' | 'email' | 'painel';

export interface Toque {
  titulo: string;
  quando: string;
  copy: string;
}

export interface Metrica {
  label: string;
  valor: number | null;
  sub?: string;
}

export interface AgenteCard {
  id: string;
  nome: string;
  papel: string;
  canal: Canal;
  linha: 'io' | 'solardoc' | null;
  estado: Estado;
  motivo?: string;
  chave?: string;             // env var que liga/desliga
  ultima_atividade: string | null;
  metricas: Metrica[];
  toques: Toque[];
  fila?: number | null;
  alerta?: string;            // algo que o dono precisa saber AGORA
}

const H = 3600_000;
const D = 86400_000;

const envLigado = (nome: string, valores = ['true', '1']) =>
  valores.includes((process.env[nome] || '').trim().toLowerCase());

/** Status que significa VENDA na agenda. É a única fonte de conversão que existe
 *  hoje, e ela vale o que a disciplina de CRM valer — consultor que fecha e não
 *  muda o status derruba o número sem derrubar a venda. */
const STATUS_VENDA = 'fechou';
/** Meta do dono (14/08/2026): a conversão do solar tem que ficar acima disto. */
export const META_CONVERSAO = 3;

/**
 * Quando a regra dos 700 kWh passou a valer DE VERDADE em produção — as duas
 * metades (cron do Meta e DM do Instagram) já no ar.
 *
 * A auditoria de roteamento conta a partir daqui, não dos 30 dias cheios. Sem
 * este piso ela acusava 45 de 103 no primeiro minuto: ficha roteada pelo rodízio
 * dos três, ANTES de a regra existir, não é violação de regra nenhuma. O alerta
 * gritaria 45 por um mês e depois apagaria porque as fichas velhas saíram da
 * janela — não porque o roteamento melhorou. É o mesmo erro que a cobertura das
 * boas-vindas cometeu (ver SOLAR_ENTREGA_AMPLA_INICIO); aqui ele foi pego no ar,
 * conferindo o card contra o banco de produção em vez de confiar no teste.
 *
 * A CONVERSÃO não usa este piso: ela é métrica de negócio, e 30 dias de venda
 * continuam sendo 30 dias de venda.
 */
export const ROTEAMENTO_REGRA_INICIO = '2026-08-14T14:30:00.000Z';

/**
 * O consumo que o lead respondeu, lido da observação da ficha, na unidade certa.
 *
 * A mesma pergunta cai no mesmo campo em DUAS unidades: kWh no formulário do Meta
 * ("700 a 900") e reais na DM do Instagram ("R$ 800 a R$ 1.500"). Quem deduzisse
 * pelo nome do campo leria R$ 800 como 800 kWh — o erro que o roteamento evita
 * passando a unidade explícita. Aqui a pista é o "R$" no próprio valor.
 * Devolve null quando a ficha não tem resposta de consumo: sem resposta não dá
 * pra dizer que a atribuição está errada.
 */
function consumoDaObservacao(observacao: string | null): number | null {
  // A observação vem em DOIS formatos: um campo por linha ("Consumo: 700 a 900")
  // e tudo numa linha só separado por "·" ("Consumo: 700 a 900 · Telhado: Cimento
  // · Urgencia: 30 dias"). Cortar só na quebra de linha engolia o resto da linha
  // no segundo formato, e aí o "30" de "30 dias" entrava na conta: "700 a 900"
  // virava (700+30)/2 = 365 e a auditoria acusava de conta pequena um lead de
  // 800 kWh que estava com o consultor CERTO.
  const bruto = (/Consumo:\s*([^\n·]+)/i.exec(String(observacao || '')) ?? [])[1]?.trim();
  if (!bruto) return null;
  const valor = consumoTipico(bruto, /r\$/i.test(bruto) ? 'reais' : 'kwh');
  return valor > 0 ? valor : null;
}

/** Conta chaves de um prefixo dentro de uma janela + a mais recente. */
function resumo(chaves: Array<{ key: string; updated_at: string }>, prefixo: string) {
  const agora = Date.now();
  const minhas = chaves.filter(k => k.key.startsWith(prefixo));
  const desde = (ms: number) => minhas.filter(k => agora - new Date(k.updated_at).getTime() <= ms).length;
  const ultima = minhas.reduce<string | null>((acc, k) => (!acc || k.updated_at > acc ? k.updated_at : acc), null);
  return { total: minhas.length, h24: desde(D), d7: desde(7 * D), d30: desde(30 * D), ultima, chaves: minhas };
}

const PREFIXOS = [
  'limpapro_recovery:', 'limpapro_cupom_sent:', 'limpapro_fechamento_sent:', 'limpapro_grupo_sent:',
  'limpapro_recovery_pending:', 'limpapro_cupom_pending:', 'limpapro_fechamento_pending:', 'limpapro_grupo_pending:',
  'gerador_followup:', 'gerador_seq:', 'carla_sent:', 'curso19:', 'ig_sent',
  'ep_remarcar_sent:',       // remarcação automática do eletroposto (oferta + confirmação)
  'ep_reagenda_auto:',       // card vermelho vencido que o robô devolveu pro dia seguinte
  'ep_repescagem_sent:', 'ep_repescagem_pending:', 'ep_repescagem_resposta:',
  'ep_resposta:',
  'solar_resposta:',
  'limpapro_atendimento:',
  'zapi_io_health',
];

export interface CentralPayload {
  gerado_em: string;
  linhas: Array<{
    id: 'io' | 'solardoc';
    nome: string;
    numero: string | null;
    estado: 'ok' | 'caida' | 'desconhecida';
    detalhe: string;
    teto_hora: number;
    usados_na_hora: number | null;
  }>;
  agentes: AgenteCard[];
  resumo: { ativos: number; desligados: number; enviados_24h: number; enviados_7d: number };
}

export async function montarCentralAgentes(): Promise<CentralPayload> {
  const agora = Date.now();

  // ── 1. Marcadores (uma consulta só; agrega em JS) ──────────────────────────
  const orFiltro = PREFIXOS.map(p => `key.like.${p}%`).join(',');
  const { data: stRows, error: stErr } = await supabase
    .from('system_state').select('key, updated_at, value')
    .or(orFiltro)
    .limit(5000);
  if (stErr) logger.error('central-agentes', 'ler system_state falhou', stErr);
  const chaves = (stRows ?? []).map(r => ({ key: String(r.key), updated_at: String(r.updated_at) }));

  const bia1 = resumo(chaves, 'limpapro_recovery:');
  const bia2 = resumo(chaves, 'limpapro_cupom_sent:');
  const bia3 = resumo(chaves, 'limpapro_fechamento_sent:');
  const bia4 = resumo(chaves, 'limpapro_grupo_sent:');
  const biaFila = chaves.filter(k => k.key.includes('_pending:') && k.key.startsWith('limpapro_')).length;
  const followup = resumo(chaves, 'gerador_followup:');
  const seq = resumo(chaves, 'gerador_seq:');
  const carla = resumo(chaves, 'carla_sent:');
  const curso = resumo(chaves, 'curso19:');
  const ig = resumo(chaves, 'ig_sent');
  const epResp = resumo(chaves, 'ep_resposta:');
  // Remarcação automática: o que importa é quantas reuniões foram SALVAS, não
  // quantas ofertas saíram — por isso só o carimbo `:remarcado` conta. A oferta
  // entra separada, porque oferta ≫ remarcação significa lead ignorando a lista.
  const epRemarcado = resumo(chaves.filter(k => k.key.endsWith(':remarcado')), 'ep_remarcar_sent:');
  const epOfertas = resumo(chaves.filter(k => k.key.endsWith(':oferta')), 'ep_remarcar_sent:');
  // Reagendamento automático do vermelho: 1 chave por FICHA (o `n` de dentro diz
  // em que rodada ela está), não 1 por envio. "Fichas devolvidas pra agenda" é a
  // leitura certa — a mesma pessoa pode aparecer nas três rodadas.
  const epReagendado = resumo(chaves, 'ep_reagenda_auto:');
  const solarResp = resumo(chaves, 'solar_resposta:');
  const atendLimpa = resumo(chaves, 'limpapro_atendimento:');
  // Escalada é o número que importa nesta trilha: é quanto ela NÃO resolveu sozinha.
  const atendLimpaEscalados = (stRows ?? []).filter(r =>
    String(r.key).startsWith('limpapro_atendimento:') && (r.value as any)?.escalado === true).length;
  const repesc = resumo(chaves, 'ep_repescagem_sent:');
  const repescFila = resumo(chaves, 'ep_repescagem_pending:').total;
  const repescResp = resumo(chaves, 'ep_repescagem_resposta:').total;

  // Teto da linha IO na última hora — mesma conta do lineThrottle.
  const prefixosLinha = ['limpapro_recovery:', 'limpapro_cupom_sent:', 'limpapro_fechamento_sent:',
    'limpapro_grupo_sent:', 'gerador_followup:', 'gerador_seq:', 'ep_repescagem_sent:',
    ...(solardocViaIo() ? ['carla_sent:'] : [])];
  const usadosNaHora = chaves.filter(k =>
    prefixosLinha.some(p => k.key.startsWith(p)) && agora - new Date(k.updated_at).getTime() <= H).length;
  const usadosCarla = carla.chaves.filter(k => agora - new Date(k.updated_at).getTime() <= H).length;

  const saude = (stRows ?? []).find(r => r.key === 'zapi_io_health')?.value as
    { downStreak?: number; ultimaConexao?: string | null; alertadoEm?: string | null } | undefined;

  // ── 2. Conversões (cada uma com fonte declarada) ───────────────────────────
  const desde30 = new Date(agora - 30 * D).toISOString();
  // A cobertura das boas-vindas do solar conta a partir do piso de "daqui pra
  // frente", igual ao agente. Sem isso o card mediria 30 dias de HISTÓRICO que a
  // mudança nunca prometeu cobrir: o alerta acenderia por um mês inteiro mesmo
  // com 100% dos leads novos atendidos, e depois apagaria porque as fichas velhas
  // saíram da janela — não porque a entrega melhorou. Alerta errado por 30 dias é
  // alerta que ninguém lê no dia 31.
  const desdeSolar = desde30 > SOLAR_ENTREGA_AMPLA_INICIO ? desde30 : SOLAR_ENTREGA_AMPLA_INICIO;

  const emailsBia = new Set(bia1.chaves.map(k => k.key.slice('limpapro_recovery:'.length).toLowerCase()));
  const usersCurso = new Set(curso.chaves.map(k => k.key.slice('curso19:'.length)));

  const [vendasBia, vendasCurso] = await Promise.all([
    (async (): Promise<number | null> => {
      try {
        const { data } = await supabase
          .from('limpapro_events').select('buyer_email')
          .eq('event_type', 'purchase').eq('status', 'paid')
          .gte('created_at', desde30).limit(2000);
        return (data ?? []).filter(v => emailsBia.has(String(v.buyer_email || '').toLowerCase())).length;
      } catch (err) { logger.error('central-agentes', 'vendas da Bia falharam', err); return null; }
    })(),
    (async (): Promise<number | null> => {
      try {
        const { data } = await supabase
          .from('kit_pedidos').select('user_id, status, criado_em')
          .gte('criado_em', desde30).limit(2000);
        return (data ?? []).filter(p => p.user_id && usersCurso.has(String(p.user_id))
          && ['paid', 'aprovado', 'approved', 'pago'].includes(String(p.status || '').toLowerCase())).length;
      } catch (err) { logger.error('central-agentes', 'vendas do curso falharam', err); return null; }
    })(),
  ]);

  // `select('*')` e não `select('id')`: tabela sem coluna `id` (sdr_message_dedup,
  // ig_contacts) devolvia ERRO, e o erro virava 0 na tela — número inventado, que é
  // justamente o que esta central não pode ter. Erro agora vira `null` → a tela
  // escreve "—" e a gente sabe que não sabe.
  const contarEm = (cliente: typeof supabase) =>
    async (tabela: string, filtros: (q: any) => any): Promise<number | null> => {
      try {
        const { count, error } = await filtros(cliente.from(tabela).select('*', { count: 'exact', head: true }));
        if (error) { logger.error('central-agentes', `contagem de ${tabela} falhou`, error); return null; }
        return count ?? null;
      } catch (err) {
        logger.error('central-agentes', `contagem de ${tabela} explodiu`, err);
        return null;
      }
    };
  const contar = contarEm(supabase);
  const contarGerador = contarEm(supabaseGerador);

  // Tudo em paralelo: são ~12 contagens independentes e a tela recarrega sozinha
  // a cada 2 min. Em série isso custava 6s de espera pro dono olhar a tela.
  const agoraIso = new Date(agora).toISOString();
  // Janela de 30d do agente de agendamento, mas nunca antes de ele existir.
  const epDesde = desde30 > EP_AGENDA_INICIO ? desde30 : EP_AGENDA_INICIO;
  const [
    igEnviadas30, igRespostas30, igLinks30, inbound24, inbound7,
    fichasEletro30, nota1_30, nota1SemConvite, ig30, igSemConvite, indicacoes30, respostasBlast,
    prospTotal, prospToques, seqAtivas, disparosRodando, igAutomacoes,
    epReunioesFuturas, epFuturasConfirmadas, epPresencaConfirmada, epLembretes5min30d, epUltimoToque,
    solarCadastros30, solarBoasVindas30, solarUltimoToque, roteamento,
    alunosLimpapro,
  ] = await Promise.all([
    // Só a 1ª DM de cada comentário (private_reply). Contar todo 'sent'
    // triplicaria o número desde o porteiro (pede → segue → link) sem um lead a
    // mais — número inflado é o que esta central não pode ter.
    // 'incerto' entra junto: é a DM que a Meta devolveu 500 e entregou assim
    // mesmo (igFalha.ts). Deixar de fora subcontaria ~1 de cada 4 DMs.
    contar('ig_queue', (q: any) => q.in('status', ['sent', 'incerto']).eq('tipo', 'private_reply').gte('criado_em', desde30)),
    contar('ig_contacts', (q: any) => q.gte('last_reply_at', desde30)),
    contar('ig_contacts', (q: any) => q.gte('gate_liberado_em', desde30)),
    contar('sdr_message_dedup', (q: any) => q.gte('processed_at', new Date(agora - D).toISOString())),
    contar('sdr_message_dedup', (q: any) => q.gte('processed_at', new Date(agora - 7 * D).toISOString())),
    contarGerador('agendamentos', (q: any) => q.eq('created_by', 'lp_eletroposto').gte('created_at', desde30)),
    // Os dois contadores da LP são escopados por `origem`: desde 19/08 a mesma
    // tabela guarda o lead que veio da DM do Instagram, e ele tem convite PRÓPRIO
    // (a LP, não o grupo). Sem o escopo, "Nota 1 sem convite" — cujo sub diz
    // "zero é o esperado" — acenderia alerta vermelho no primeiro lead de
    // Instagram, cobrando dele um convite de grupo que não existe desde 17/08.
    contarGerador('eletroposto_nota1', (q: any) => q.eq('origem', 'lp_eletroposto').gte('created_at', desde30)),
    contarGerador('eletroposto_nota1', (q: any) => q.eq('origem', 'lp_eletroposto').is('convite_enviado_at', null)),
    contarGerador('eletroposto_nota1', (q: any) => q.eq('origem', ORIGEM_IG).gte('created_at', desde30)),
    contarGerador('eletroposto_nota1', (q: any) => q.eq('origem', ORIGEM_IG).is('convite_enviado_at', null)),
    contar('io_indicacoes', (q: any) => q.gte('created_at', desde30)),
    contar('io_blast_respostas', (q: any) => q.eq('atendido', false)),
    contarGerador('prospeccao_contatos', (q: any) => q),
    contarGerador('prospeccao_toques', (q: any) => q),
    contarGerador('sequencias', (q: any) => q.eq('ativo', true)),
    contarGerador('gerador_broadcasts', (q: any) => q.eq('status', 'rodando')),
    contarGerador('ig_automations', (q: any) => q.eq('ativo', true)),
    // Agente de agendamento do eletroposto: a régua dele mora nas 3 colunas de
    // flag da própria ficha, então a métrica é contagem direta — sem system_state.
    contarGerador('agendamentos', (q: any) => q.in('created_by', EP_ORIGENS).eq('status', 'agendado').gte('quando', agoraIso)),
    contarGerador('agendamentos', (q: any) => q.in('created_by', EP_ORIGENS).eq('status', 'agendado').gte('quando', agoraIso).not('confirmacao_at', 'is', null)),
    contarGerador('agendamentos', (q: any) => q.in('created_by', EP_ORIGENS).eq('status', 'agendado').gte('quando', agoraIso).not('presenca_confirmada_at', 'is', null)),
    // Piso em EP_AGENDA_INICIO: as mesmas colunas foram usadas pelo módulo solar
    // até 28/07. Sem o piso, a tela credita a este agente envio que não é dele.
    contarGerador('agendamentos', (q: any) => q.in('created_by', EP_ORIGENS)
      .gte('lembrete_5min_at', epDesde)),
    (async (): Promise<string | null> => {
      try {
        // O bom dia das 8h NÃO tem coluna de flag (ele se controla pelo carimbo do
        // system_state), então as três colunas sozinhas diriam "parado desde
        // ontem" num dia em que ele só mandou bom dia — e "última atividade"
        // velha é como esta tela grita que um agente morreu. O carimbo cobre os
        // QUATRO toques e não precisa do piso de EP_AGENDA_INICIO: ele só existe
        // desde que este agente existe (o módulo solar não carimbava nada).
        const [ficha, carimbo] = await Promise.all([
          supabaseGerador
            .from('agendamentos').select('confirmacao_at, lembrete_1h_at, lembrete_5min_at')
            .in('created_by', EP_ORIGENS).gte('quando', new Date(agora - 30 * D).toISOString()).limit(500),
          supabase
            .from('system_state').select('updated_at')
            .like('key', `${EP_AGENDA_PREFIX}%`).order('updated_at', { ascending: false }).limit(1),
        ]);
        const todos = (ficha.data ?? [])
          .flatMap(r => [r.confirmacao_at, r.lembrete_1h_at, r.lembrete_5min_at])
          .filter(v => !!v && String(v) >= EP_AGENDA_INICIO) as string[];
        const ultimoCarimbo = (carimbo.data ?? [])[0]?.updated_at;
        if (ultimoCarimbo) todos.push(String(ultimoCarimbo));
        return todos.sort().pop() ?? null;
      } catch (err) { logger.error('central-agentes', 'último toque da agenda EP falhou', err); return null; }
    })(),
    // Boas-vindas do solar: cadastros que entraram × cadastros que receberam o
    // recibo. A diferença entre os dois números É o alerta — cliente que se
    // cadastrou e ficou no escuro.
    contarGerador('agendamentos', (q: any) => q.in('created_by', SOLAR_ORIGENS).gte('created_at', desdeSolar)),
    contarGerador('agendamentos', (q: any) => q.in('created_by', SOLAR_ORIGENS)
      .gte('created_at', desdeSolar).not('boas_vindas_at', 'is', null)),
    (async (): Promise<string | null> => {
      try {
        const { data } = await supabaseGerador
          .from('agendamentos').select('boas_vindas_at')
          .in('created_by', SOLAR_ORIGENS).gte('created_at', desde30).limit(500);
        const todos = (data ?? []).map(r => r.boas_vindas_at)
          .filter(v => !!v && String(v) >= SOLAR_BOASVINDAS_INICIO) as string[];
        return todos.sort().pop() ?? null;
      } catch (err) { logger.error('central-agentes', 'último toque das boas-vindas do solar falhou', err); return null; }
    })(),
    // ── Roteamento por tamanho de conta + conversão ────────────────────────
    // Uma leitura só serve os dois números, porque os dois saem da MESMA ficha:
    // quem atendeu e o que aconteceu com ela.
    //
    // A auditoria de roteamento existe porque a regra dos 700 kWh foi escrita em
    // 12/08, ficou parada no disco e ninguém percebeu por dois dias — 6 leads
    // roteados errado, 4 manhãs de dono gastas com conta pequena. Regra que
    // ninguém confere é regra que volta a sumir no próximo deploy.
    (async () => {
      try {
        const { data, error } = await supabaseGerador
          .from('agendamentos').select('id, cliente_nome, vendedor_nome, status, observacao, created_at')
          .in('created_by', SOLAR_ORIGENS).gte('created_at', desde30).limit(500);
        if (error) throw error;
        const fichas = data ?? [];
        const foraDaRegra = fichas.filter(f => {
          // Ficha anterior à regra foi roteada pelo rodízio dos três e não violou
          // nada — ver ROTEAMENTO_REGRA_INICIO.
          if (String(f.created_at) < ROTEAMENTO_REGRA_INICIO) return false;
          const kwh = consumoDaObservacao(f.observacao as string | null);
          if (kwh === null) return false;                    // sem resposta não acusa ninguém
          const dono = String(f.vendedor_nome || '');
          if (!dono) return false;
          return kwh > KWH_CORTE_TIME
            ? !TIME_CONTA_ALTA.includes(dono)                // grande fora do time
            : !TIME_CONTA_BAIXA.includes(dono);              // pequeno gastando manhã de dono
        });
        const vendas = fichas.filter(f => String(f.status) === STATUS_VENDA).length;
        return {
          leads: fichas.length,
          vendas,
          conversao: fichas.length ? (100 * vendas) / fichas.length : null,
          foraDaRegra: foraDaRegra.length,
          exemplos: foraDaRegra.slice(0, 5).map(f => `#${f.id} ${f.cliente_nome} → ${f.vendedor_nome}`),
        };
      } catch (err) {
        logger.error('central-agentes', 'auditoria de roteamento/conversão falhou', err);
        return { leads: 0, vendas: 0, conversao: null, foraDaRegra: 0, exemplos: [] as string[] };
      }
    })(),
    // Universo da trilha 1x1 do LimpaPro: quem ela PODE atender (aluno ativo com conta).
    contar('limpapro_membros', (q: any) => q.eq('ativo', true)),
  ]);

  // ── 3. Estado das linhas físicas ───────────────────────────────────────────
  const linhaIoCaida = (saude?.downStreak ?? 0) >= 2 && !!saude?.alertadoEm;
  const linhas: CentralPayload['linhas'] = [
    {
      id: 'io', nome: 'Linha IO — B2C Irmãos na Obra', numero: '34 99816-5040',
      estado: linhaIoCaida ? 'caida' : (saude ? 'ok' : 'desconhecida'),
      detalhe: linhaIoCaida
        ? `Z-API reportou desconectada (${saude?.downStreak} checagens seguidas)`
        : saude?.ultimaConexao ? `última conexão confirmada ${saude.ultimaConexao}` : 'sem leitura do monitor ainda',
      // tetosVigentes, nao a constante: durante as 72h de aquecimento o teto real
      // e menor que o base, e e justamente quando o painel e mais olhado.
      teto_hora: (await tetosVigentesLinha()).hora, usados_na_hora: usadosNaHora,
    },
    {
      id: 'solardoc', nome: 'Linha SolarDoc — B2B (Giovanna)', numero: null,
      estado: 'desconhecida',
      detalhe: solardocViaIo()
        ? 'DESVIADA: os envios dela estão saindo pela linha IO (ZAPI_SOLARDOC_VIA_IO=1)'
        : 'monitor de queda só cobre a linha IO — aqui a prova é o envio passar',
      teto_hora: MAX_CARLA_POR_HORA, usados_na_hora: usadosCarla,
    },
  ];

  // ── 4. As agentes ──────────────────────────────────────────────────────────
  const biaLigada = envLigado('RECUP_ENABLED');
  const agentes: AgenteCard[] = [
    {
      id: 'bia',
      nome: 'Bia — recuperação LimpaPro',
      papel: 'Fala com quem entrou no checkout do LimpaPro e não comprou. Quatro toques, um por vez, e para no instante em que a pessoa responde.',
      canal: 'whatsapp', linha: 'io',
      estado: biaLigada ? 'ativo' : 'desligado',
      chave: 'RECUP_ENABLED',
      ultima_atividade: [bia1.ultima, bia2.ultima, bia3.ultima, bia4.ultima].filter(Boolean).sort().pop() ?? null,
      fila: biaFila,
      metricas: [
        { label: 'Abordagens (30d)', valor: bia1.d30, sub: `${bia1.total} desde o início` },
        { label: 'Reforço de valor (30d)', valor: bia2.d30 },
        { label: 'Fechamento (30d)', valor: bia3.d30 },
        { label: 'Convite do grupo (30d)', valor: bia4.d30, sub: envLigado('RECUP_GRUPO_ENABLED') ? undefined : 'toque DESLIGADO' },
        { label: 'Compras de quem ela tocou (30d)', valor: vendasBia, sub: 'limpapro_events pagos, casando o e-mail' },
      ],
      toques: [
        { titulo: '1º · abordagem', quando: '8 min depois de abandonar o checkout', copy: 'Escrita por IA na hora, com o nome, o produto e o estado do carrinho. Uma pergunta curta no fim.' },
        { titulo: '2º · reforço de valor', quando: '2h depois do 1º, se não respondeu', copy: 'Sem desconto — decisão do dono. Reforça o que o produto entrega e devolve o link do checkout normal.' },
        { titulo: '3º · fechamento', quando: '20h depois do 2º', copy: 'Última mensagem fria da sequência. Termina avisando que não vai insistir mais.' },
        { titulo: '4º · convite do grupo pago', quando: '2 dias depois do 3º', copy: 'Troca a oferta: convida pra Comunidade +Sol (R$57). DESLIGADO em 03/ago — foi o toque que bloqueou a linha.' },
      ],
      alerta: envLigado('RECUP_GRUPO_ENABLED') ? undefined
        : 'O 4º toque está desligado desde 03/ago. Enquanto estiver assim, quem recebe o 3º toque NÃO entra na fila do grupo — é pulado, não adiado.',
    },
    {
      id: 'atendimento_limpapro',
      nome: 'Atendimento 1x1 do LimpaPro',
      papel: 'Responde o ALUNO que já comprou e escreve na linha: destrava o acesso (reenvia o link pro e-mail dele), tira dúvida do curso, e só oferece mentoria se ele puxar. O que não é dela — reembolso, cobrança, energia solar — vira aviso e cala.',
      canal: 'whatsapp', linha: 'io',
      estado: envLigado('LIMPAPRO_ATENDIMENTO_ENABLED') ? 'ativo' : 'desligado',
      chave: 'LIMPAPRO_ATENDIMENTO_ENABLED',
      ultima_atividade: atendLimpa.ultima,
      metricas: [
        { label: 'Conversas atendidas (30d)', valor: atendLimpa.d30, sub: `${atendLimpa.total} desde o início` },
        { label: 'Nas últimas 24h', valor: atendLimpa.h24 },
        { label: 'Passadas pro humano', valor: atendLimpaEscalados, sub: 'reembolso, cobrança ou coisa que ela não resolveu' },
        { label: 'Alunos que ela cobre', valor: alunosLimpapro, sub: 'cadastro ativo com telefone em limpapro_membros' },
      ],
      toques: [
        { titulo: 'só responde — não puxa conversa', quando: 'quando o aluno escreve', copy: 'Transacional: fora do teto de 12/h e da janela 08h–21h de propósito. Responder às 22h quem perguntou é normal, e resposta de suporte não pode comer a cota de venda da Bia.' },
        { titulo: 'reenvio de acesso', quando: 'quando ele não consegue entrar', copy: 'Chama o /api/membro-login do app: o link de entrada vai pro E-MAIL dele (nunca pelo WhatsApp). 1 reenvio a cada 10 min. Se falhar, ela cala e chama o humano em vez de prometer um e-mail que não vem.' },
      ],
      motivo: envLigado('LIMPAPRO_ATENDIMENTO_ENABLED') ? undefined
        : 'Nasce desligada. Enquanto estiver assim, aluno que escreve na linha continua sem resposta automática.',
    },
    {
      id: 'cora',
      nome: 'Cora — atendimento da linha IO',
      papel: 'Ouve tudo que chega no WhatsApp 5040 e registra. Hoje ela NÃO responde: o atendimento dessa linha é humano por decisão do dono.',
      canal: 'whatsapp', linha: 'io',
      estado: 'sem_agente',
      motivo: 'handleSdrLead tem early-return pra linha IO — nada é respondido automaticamente',
      ultima_atividade: null,
      metricas: [
        { label: 'Mensagens recebidas (24h)', valor: inbound24 },
        { label: 'Mensagens recebidas (7d)', valor: inbound7 },
        { label: 'Respostas de disparo sem atender', valor: respostasBlast, sub: 'fila humana no /admin' },
      ],
      toques: [{ titulo: 'nenhum envio automático', quando: '—', copy: 'A linha só recebe. Quem responde é gente.' }],
    },
    {
      id: 'repescagem',
      nome: 'Repescagem do eletroposto',
      papel: 'Fala uma vez com quem chegou durante o apagão de 01–03/ago e ficou sem resposta. Uma pessoa a cada 20 min, das 07h às 20h.',
      canal: 'whatsapp', linha: 'io',
      estado: envLigado('EP_REPESCAGEM_OFF') ? 'desligado' : (repescFila > 0 || repesc.total > 0 ? 'ativo' : 'dark'),
      chave: 'EP_REPESCAGEM_OFF',
      ultima_atividade: repesc.ultima,
      fila: repescFila,
      metricas: [
        { label: 'Já falaram com', valor: repesc.total, sub: `${repescFila} ainda na fila` },
        { label: 'Responderam', valor: repescResp, sub: 'aviso vai pro Thiago e pro Diego' },
      ],
      toques: [
        { titulo: 'ficha nota 2 e 3', quando: 'na vez dela na fila', copy: 'Assume o atraso, diz quem é o consultor dono do caso e pede um horário.' },
        { titulo: 'nota 1 · convite do grupo', quando: 'na vez dela na fila', copy: 'Mesma oferta do grupo gratuito do eletroposto, em versão que reconhece a demora.' },
      ],
    },
    {
      id: 'followup_gerador',
      nome: 'Follow-up do Gerador (solar)',
      papel: 'Reaquece lead de energia solar que pediu simulação e parou de responder.',
      canal: 'whatsapp', linha: 'io',
      estado: followup.total > 0 ? 'ativo' : 'dark',
      ultima_atividade: followup.ultima,
      metricas: [
        { label: 'Toques (7d)', valor: followup.d7 },
        { label: 'Toques (30d)', valor: followup.d30 },
      ],
      toques: [{ titulo: 'toque de retomada', quando: 'depois do silêncio do lead', copy: 'Mensagem curta puxando a conversa de volta pro orçamento.' }],
    },
    {
      id: 'central_automacao',
      nome: 'Central de Automação (disparos e sequências)',
      papel: 'Disparo em massa e drip de sequências pra contatos do CRM do Gerador.',
      canal: 'whatsapp', linha: 'io',
      estado: (process.env.IO_BLAST_OFF || '').trim() === '1' ? 'desligado' : (envLigado('GERADOR_AUTOMACAO_ENABLED') ? 'ativo' : 'dark'),
      chave: 'IO_BLAST_OFF / GERADOR_AUTOMACAO_ENABLED',
      motivo: (process.env.IO_BLAST_OFF || '').trim() === '1' ? 'congelado em 03/ago pra proteger a linha recém-desbloqueada' : undefined,
      ultima_atividade: seq.ultima,
      metricas: [
        { label: 'Disparos rodando', valor: disparosRodando },
        { label: 'Sequências ativas', valor: seqAtivas },
        { label: 'Passos de sequência (30d)', valor: seq.d30 },
      ],
      toques: [{ titulo: 'mensagens do painel', quando: 'quando alguém inicia', copy: 'O texto é escrito no /gerador na hora de criar o disparo — não tem copy fixa aqui.' }],
    },
    {
      id: 'giovanna',
      nome: 'Giovanna — follow-up B2B da plataforma',
      papel: 'Duas cadências pra quem se cadastrou na plataforma: quem não preencheu CNPJ (3 toques em 30d) e quem sumiu (5 toques em 60d).',
      canal: 'whatsapp', linha: 'solardoc',
      estado: 'ativo',
      ultima_atividade: carla.ultima,
      metricas: [
        { label: 'Envios (24h)', valor: carla.h24, sub: `teto de ${MAX_CARLA_POR_HORA}/h` },
        { label: 'Envios (7d)', valor: carla.d7 },
        { label: 'Envios (30d)', valor: carla.d30 },
      ],
      toques: [
        { titulo: 'sem CNPJ', quando: '3 toques ao longo de 30 dias', copy: 'Puxa a conclusão do cadastro pra liberar o documento.' },
        { titulo: 'inativo', quando: '5 toques ao longo de 60 dias', copy: 'Reaquece quem criou conta e nunca gerou documento.' },
      ],
    },
    {
      id: 'curso19',
      nome: 'Campanha do curso R$19',
      papel: 'Oferece o Kit de Fechamento por R$19 (com 30 dias de plataforma) pra base cadastrada. Três toques, e para quando a pessoa responde.',
      canal: 'whatsapp', linha: 'solardoc',
      estado: envLigado('CAMPANHA_CURSO19_ON') ? 'ativo' : 'desligado',
      chave: 'CAMPANHA_CURSO19_ON',
      ultima_atividade: curso.ultima,
      metricas: [
        { label: 'Pessoas na campanha', valor: curso.total },
        { label: 'Tocadas (7d)', valor: curso.d7 },
        { label: 'Compras do kit (30d)', valor: vendasCurso, sub: 'kit_pedidos pagos de quem foi tocado' },
      ],
      toques: [
        { titulo: '1º toque', quando: 'na entrada da campanha', copy: '"montei um curso de fechamento aqui e lembrei de você" — 32 objeções, R$19 uma vez, 30 dias de plataforma junto.' },
        { titulo: '2º toque', quando: '3 dias depois', copy: 'Usa a aula "o cliente achou mais barato" como prova de valor.' },
        { titulo: '3º toque', quando: '4 dias depois do 2º', copy: 'Último toque da sequência.' },
      ],
    },
    {
      id: 'instagram',
      nome: 'Instagram — comentário vira DM',
      papel: 'Responde comentário no @irmaosnaobra__ com DM automática e entrega o link certo por produto.',
      canal: 'instagram', linha: null,
      estado: envLigado('IG_AUTOMACAO_ENABLED') ? 'ativo' : 'desligado',
      chave: 'IG_AUTOMACAO_ENABLED',
      ultima_atividade: ig.ultima,
      metricas: [
        { label: 'Automações ativas', valor: igAutomacoes },
        { label: 'DMs de comentário (30d)', valor: igEnviadas30 },
        { label: 'Quem respondeu (30d)', valor: igRespostas30 },
        { label: 'Links liberados (30d)', valor: igLinks30, sub: 'passou pelo porteiro' },
      ],
      toques: [
        { titulo: '1º toque — o link', quando: 'quando alguém comenta', copy: 'A copy da automação com o link vai de uma vez, limpo, sem pedir nada em troca; o "me segue" é cobrado no lembrete de 1h. O porteiro que segurava o link foi removido em 05/08: ele entregava pra 1 pessoa a cada 23 DMs, porque quem não responde nunca mais pode ser tocado.' },
        { titulo: 'bike', quando: 'no mesmo toque', copy: 'A bike entrega card com botão "Falar no WhatsApp" — negociação é na hora.' },
        { titulo: 'lembrete', quando: '1h depois da 1ª DM sair', copy: 'Quem parou no "me segue" recebe o nudge; quem já pegou o link recebe "conseguiu abrir?". Quem NUNCA respondeu não recebe — DM exige janela de 24h aberta, e é a resposta que abre. Um por pessoa, mesmo que ela comente três vezes. IG_LEMBRETE_1H_OFF desliga.' },
      ],
    },
    {
      id: 'eletroposto',
      nome: 'Eletroposto — ficha, convite e rodízio',
      papel: 'Classifica o lead da LP em nota 1 a 3: nota 1 vai pro grupo na hora, nota 2 e 3 viram ficha e aviso pros consultores.',
      canal: 'whatsapp', linha: 'io',
      estado: 'ativo',
      ultima_atividade: null,
      metricas: [
        { label: 'Fichas nota 2/3 (30d)', valor: fichasEletro30 },
        { label: 'Nota 1 capturados (30d)', valor: nota1_30 },
        { label: 'Nota 1 sem convite', valor: nota1SemConvite, sub: 'zero é o esperado' },
        { label: 'Do Instagram (30d)', valor: ig30, sub: 'não marcam agenda: vão pra LP' },
        { label: 'Instagram na fila do convite', valor: igSemConvite, sub: '1 a cada 10 min, 9h–19h' },
      ],
      toques: [
        { titulo: 'convite do grupo (nota 1)', quando: 'segundos depois da simulação', copy: '5 bolhas: explica que o passo é definir o local e entrega o link do grupo gratuito.' },
        { titulo: 'convite da LP (Instagram)', quando: 'na vez dele na fila, 9h–19h', copy: 'Uma bolha: quem veio da DM não marca agenda direta — recebe o link da LP pra simular e escolher o horário lá.' },
        { titulo: 'aviso da equipe', quando: 'assim que a ficha entra', copy: 'Card com selo da nota, pontuação e dados do ponto pro WhatsApp do Thiago e do Diego.' },
      ],
      // Fila de Instagram NÃO é alerta: ela é o estado normal de quem acabou de
      // chegar e ainda não chegou a vez dele. Só o convite da LP que nunca saiu
      // é notícia, e quem conta isso é o `convite_erro` da ficha.
      alerta: (nota1SemConvite ?? 0) > 0 ? `${nota1SemConvite} lead(s) nota 1 estão sem o convite do grupo.` : undefined,
    },
    {
      id: 'agenda_eletroposto',
      nome: 'Agendamento do eletroposto — confirmação e presença',
      papel: 'Agente de agendamento: assim que alguém marca na LP, ele confirma o horário no WhatsApp. Quem marcou com dias de antecedência recebe um "bom dia, hoje é o dia" às 8h. Depois avisa 1 hora antes que o link está vindo e chama de novo 5 minutos antes. Existe por causa de quem marca e some.',
      canal: 'whatsapp', linha: 'io',
      estado: envLigado('EP_LEMBRETES_OFF') ? 'desligado' : 'ativo',
      chave: 'EP_LEMBRETES_OFF',
      ultima_atividade: epUltimoToque,
      metricas: [
        { label: 'Reuniões futuras', valor: epReunioesFuturas, sub: 'status agendado, daqui pra frente' },
        // As três são coisas DIFERENTES e ficam separadas de propósito: a gente
        // avisou / a pessoa escreveu / a pessoa disse que vem.
        { label: 'Avisadas por ele', valor: epFuturasConfirmadas, sub: 'mensagem de confirmação entregue' },
        { label: 'Responderam', valor: epResp.total, sub: `${epResp.h24} nas últimas 24h · recado vai pro Thiago e pro Diego na hora` },
        {
          label: 'Remarcadas pelo robô', valor: epRemarcado.total,
          sub: `${epOfertas.total} oferta(s) de horário · o robô nunca cancela e nunca troca de consultor. Kill-switch EP_REMARCAR_OFF`,
        },
        {
          label: 'Voltaram do vermelho', valor: epReagendado.total,
          sub: `${epReagendado.h24} nas últimas 24h · lead QUENTE (nota 3) que não apareceu e o robô devolveu pro próximo dia útil sozinho, até 2×. Morno e frio ficam vermelhos. Kill-switch EP_REAGENDA_AUTO_OFF`,
        },
        {
          label: 'Confirmaram presença', valor: epPresencaConfirmada,
          sub: 'disse que vem, em mensagem. Pediu pra remarcar depois? Sai da conta.',
        },
        { label: 'Chamados de 5 min (30d)', valor: epLembretes5min30d },
      ],
      toques: [
        { titulo: '1º · ao marcar', quando: 'segundos depois de escolher o horário na LP', copy: 'Confirma dia e hora com o nome e o WhatsApp do consultor, explica que é por vídeo. Pede um "SIM", pede antecedência pra desmarcar e pede o material do ponto — foto, localização, conta de luz, o que já orçou.' },
        { titulo: '2º · bom dia, hoje é o dia', quando: 'entre 8h e 11h, SÓ pra quem marcou num dia anterior', copy: 'Quem marcou dias antes viu a confirmação sumir da conversa. Relembra a hora e o consultor, lembra do material se ainda não veio, e abre a porta do remarcar enquanto ainda dá pra encaixar outra pessoa. Quem marcou hoje pra hoje não recebe.' },
        { titulo: '3º · 1 hora antes', quando: '45 a 75 min antes da reunião', copy: 'Avisa que o link está vindo pelo WhatsApp do consultor, pede internet e sinal, e abre a porta do remarcar de novo.' },
        { titulo: '4º · 5 minutos antes', quando: 'nos 12 min que antecedem o horário', copy: '"É agora, o consultor já está te esperando" — o link cai no WhatsApp dele a qualquer momento.' },
        { titulo: '🚨 10 min antes — PRO CONSULTOR', quando: 'entre 13 e 8 min antes, SÓ de reunião confirmada', copy: 'Único toque desta régua que NÃO vai pro lead: cai no WhatsApp do consultor dono da reunião (não nos dois). Só dispara pra quem confirmou presença de verdade — foi assim que ele nasceu, em 03/09, sem repetir o ping de 1 hora que o Thiago mandou desligar em 25/07 por barulho. Uma vez por reunião; remarcou, alerta de novo. Kill-switch EP_ALERTA_10MIN_OFF.' },
        { titulo: '↩ resposta do lead', quando: 'até 5 min depois de ele escrever', copy: 'Não é mensagem pro lead: é o recado que vai pro Thiago e pro Diego com o que a pessoa escreveu, a hora da reunião e de quem ela é. Kill-switch EP_RESPOSTAS_OFF.' },
        { titulo: '🔄 remarca sozinho', quando: 'quando o lead diz que não vai dar', copy: 'Oferece os 3 próximos horários livres DO MESMO consultor, espera a pessoa escolher o número e troca na hora — liberando o horário antigo pra agenda. Nunca cancela, nunca muda de consultor e nunca move sem escolha explícita. Quem pede pra CANCELAR (e não remarcar) continua indo pro humano. Kill-switch EP_REMARCAR_OFF.' },
        { titulo: '♻️ card vermelho QUENTE volta pro dia seguinte', quando: '45 min depois do horário que ele perdeu', copy: 'Só lead QUENTE (nota 3: tem onde, tem com quê e decide sozinho) — morno e frio ficam vermelhos e viram trabalho de gente. Quem entra não recebe lista pra escolher: o robô MARCA. A ficha sai limpa, volta pro próximo dia útil no mesmo horário (ou no primeiro livre do dia) com o mesmo consultor, e a régua de avisos recomeça do zero — bom dia, 1 hora e 5 minutos. Duas vezes; na segunda a mensagem diz que é a última. Kill-switch EP_REAGENDA_AUTO_OFF.' },
      ],
      alerta: (epReunioesFuturas ?? 0) > 0 && (epFuturasConfirmadas ?? 0) < (epReunioesFuturas ?? 0)
        ? `${(epReunioesFuturas ?? 0) - (epFuturasConfirmadas ?? 0)} reunião(ões) futura(s) ainda sem a mensagem de confirmação — a fila de atraso sai 1 por rodada, das 08h às 20h.`
        : undefined,
    },
    {
      id: 'solar_boas_vindas',
      nome: 'Boas-vindas do solar — recibo do cadastro',
      papel: 'Assim que alguém se cadastra em energia solar (LP, /simular ou Lead Ads), fala com o cliente: diz quem é o consultor dele, passa o WhatsApp desse consultor, avisa que NÓS entramos em contato e faz UMA pergunta — o consumo atual. Não fala de horário — de propósito.',
      canal: 'whatsapp', linha: 'io',
      estado: envLigado('SOLAR_BOASVINDAS_OFF') ? 'desligado' : 'ativo',
      chave: 'SOLAR_BOASVINDAS_OFF',
      ultima_atividade: solarUltimoToque,
      metricas: [
        { label: 'Cadastros de solar', valor: solarCadastros30, sub: 'LP solar + /simular + Lead Ads · desde 13/08, quando a entrega foi corrigida' },
        { label: 'Receberam as boas-vindas', valor: solarBoasVindas30, sub: 'só conta ficha criada depois de o agente existir' },
        { label: 'Responderam', valor: solarResp.total, sub: `${solarResp.h24} nas últimas 24h · recado vai pro consultor dono da ficha` },
      ],
      toques: [
        { titulo: 'único · no cadastro', quando: 'até 24h depois de a ficha entrar', copy: 'Cinco bolhas: "este é o seu pré-atendimento", quem é o consultor (especialista) + o WhatsApp dele, "nós entramos em contato", o que o estudo entrega, e uma pergunta só — qual o consumo hoje (aceita foto da conta de luz). Não recebe quem cancelou, quem disse sem interesse e quem já viu proposta. Backlog anterior a 13/08 nunca é tocado.' },
        { titulo: '↩ resposta do cliente', quando: 'até 5 min depois de ele escrever', copy: 'Não é mensagem pro cliente: é o recado com o que a pessoa escreveu, indo pro consultor DONO da ficha (e cópia pro Thiago). A foto da conta de luz, o áudio e o vídeo são ENCAMINHADOS pro WhatsApp dele, não só contados. Kill-switch SOLAR_RESPOSTAS_OFF.' },
      ],
      // O alerta disparava só com ZERO — e por 30 dias o número foi 12 de 99, que
      // não é zero e não é entrega. "Alguns receberam" parecia funcionando; era
      // 87 pessoas no escuro. Agora ele mede COBERTURA.
      alerta: (() => {
        if (envLigado('SOLAR_BOASVINDAS_OFF')) return undefined;
        const total = solarCadastros30 ?? 0;
        const ok = solarBoasVindas30 ?? 0;
        if (total < 5 || ok / total >= 0.8) return undefined;
        return `Só ${ok} de ${total} cadastros de solar receberam as boas-vindas em 30 dias — ${total - ok} pessoa(s) no escuro. Confira o cron, o teto da linha IO e o filtro de status.`;
      })(),
    },
    {
      // Não é um robô que fala com ninguém: é a regra que decide QUEM fala. Está
      // aqui porque foi um roteamento errado em silêncio que custou 4 manhãs, e
      // esta é a tela onde se olha o que os automatismos estão fazendo.
      id: 'roteamento_solar',
      nome: 'Roteamento do solar — conta alta × conta baixa',
      papel: `Lead de solar acima de ${KWH_CORTE_TIME} kWh/mês alterna entre ${TIME_CONTA_ALTA.join(' e ')}; abaixo disso, e quando o lead não responde o consumo, vai pra fila da conta baixa — ${TIME_CONTA_BAIXA.join(' e ')}, em rodízio de 3 pra 1 (desde 18/08 a Giovanna pega 1 a cada 4, pra treinar). A agenda do Thiago e do Diego é disputada com o eletroposto (desde 14/08 a LP vende também 10h e 11h, em cima da manhã do solar), então cada horário que sai é caro — conta pequena não pode consumir um deles. Vale nas duas entradas: formulário do Meta (responde em kWh) e DM do Instagram (responde em reais).`,
      canal: 'painel', linha: null,
      estado: 'ativo',
      ultima_atividade: null,
      metricas: [
        { label: 'Leads de solar (30d)', valor: roteamento.leads },
        {
          label: 'Fora da regra', valor: roteamento.foraDaRegra,
          sub: roteamento.foraDaRegra > 0
            ? roteamento.exemplos.join(' · ')
            : 'toda ficha com consumo respondido está com quem devia (conta desde 14/08, quando a regra entrou no ar)',
        },
        {
          label: 'Conversão (30d)',
          valor: roteamento.conversao === null ? null : Math.round(roteamento.conversao * 100) / 100,
          sub: `${roteamento.vendas} fechada(s) em ${roteamento.leads} lead(s) · meta ${META_CONVERSAO}% · fonte: status "${STATUS_VENDA}" na agenda`,
        },
      ],
      toques: [
        { titulo: 'na entrada da ficha', quando: 'no momento em que o lead vira ficha', copy: `Lê o consumo respondido, converte pra kWh/mês (faixa vale pelo MEIO, não pelo teto) e escolhe o dono. Cliente que já tem consultor fica com ele, antes de qualquer regra de tamanho. Sem resposta de consumo cai na fila da conta baixa (${TIME_CONTA_BAIXA.join('/')}): a regra é exceção, quem não prova que é grande não gasta manhã de dono.` },
      ],
      alerta: (() => {
        const partes: string[] = [];
        if (roteamento.foraDaRegra > 0) {
          partes.push(`${roteamento.foraDaRegra} ficha(s) com o consultor errado pra regra dos ${KWH_CORTE_TIME} kWh: ${roteamento.exemplos.join(' · ')}.`);
        }
        // A conversão só vira alerta com amostra que sustenta o número: 1 venda a
        // menos em 10 leads derruba 10 pontos, e alerta que oscila assim ninguém lê.
        if (roteamento.conversao !== null && roteamento.leads >= 30 && roteamento.conversao < META_CONVERSAO) {
          partes.push(`Conversão em ${roteamento.conversao.toFixed(1)}%, abaixo da meta de ${META_CONVERSAO}% (${roteamento.vendas} venda(s) em ${roteamento.leads} leads). Confira também se o status "${STATUS_VENDA}" está sendo marcado no CRM — venda que ninguém marca some daqui.`);
        }
        return partes.length ? partes.join(' ') : undefined;
      })(),
    },
    {
      id: 'indicacao',
      nome: 'Indicação',
      papel: 'Quem indica alguém cai direto no WhatsApp do Thiago e o indicado vira card no CRM.',
      canal: 'whatsapp', linha: 'io',
      estado: 'ativo',
      ultima_atividade: null,
      metricas: [{ label: 'Indicações (30d)', valor: indicacoes30 }],
      toques: [{ titulo: 'aviso da indicação', quando: 'na hora do formulário', copy: 'Mensagem pro Thiago com quem indicou e quem foi indicado.' }],
    },
    {
      id: 'prospeccao',
      nome: 'Prospecção fria (lista do Maps)',
      papel: 'Monta lista fria por busca no Google Maps. O toque é MANUAL, um por vez — nada dispara sozinho.',
      canal: 'painel', linha: null,
      estado: envLigado('PROSPECCAO_APIFY_OFF') ? 'desligado' : 'ativo',
      chave: 'PROSPECCAO_APIFY_OFF',
      ultima_atividade: null,
      metricas: [
        { label: 'Contatos na carteira', valor: prospTotal },
        { label: 'Toques registrados', valor: prospToques },
      ],
      toques: [{ titulo: 'nenhum envio automático', quando: '—', copy: 'A fila é 1 a 1 e quem fala é o consultor.' }],
    },
    {
      id: 'email',
      nome: 'E-mails automáticos (SolarDoc)',
      papel: 'Recuperação de checkout, follow-up de CNPJ, cobrança (dunning D0–D4) e winback D+7/D+30.',
      canal: 'email', linha: null,
      estado: 'ativo',
      ultima_atividade: null,
      metricas: [{ label: 'medido por e-mail', valor: null, sub: 'sem log agregado ainda — cada rotina loga o próprio envio' }],
      toques: [
        { titulo: 'checkout abandonado', quando: '4h a 72h depois', copy: 'Um e-mail com o link de volta.' },
        { titulo: 'follow-up CNPJ', quando: '5 e-mails em 30 dias', copy: 'Foco no gerador de proposta.' },
        { titulo: 'dunning', quando: 'D0 a D4 do pagamento falho', copy: 'Lembrete diário; no D5 cancela e joga pro plano grátis.' },
        { titulo: 'winback', quando: 'D+7 e D+30 do cancelamento', copy: 'Tentativa de trazer de volta.' },
      ],
    },
  ];

  const enviados24 = bia1.h24 + bia2.h24 + bia3.h24 + bia4.h24 + followup.h24 + seq.h24 + carla.h24 + repesc.h24 + ig.h24;
  const enviados7 = bia1.d7 + bia2.d7 + bia3.d7 + bia4.d7 + followup.d7 + seq.d7 + carla.d7 + repesc.d7 + ig.d7;

  return {
    gerado_em: new Date().toISOString(),
    linhas,
    agentes,
    resumo: {
      ativos: agentes.filter(a => a.estado === 'ativo').length,
      desligados: agentes.filter(a => a.estado === 'desligado').length,
      enviados_24h: enviados24,
      enviados_7d: enviados7,
    },
  };
}
