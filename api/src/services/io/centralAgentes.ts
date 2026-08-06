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
import { MAX_POR_HORA } from '../agents/whatsapp/lineThrottle';
import { MAX_CARLA_POR_HORA } from '../agents/whatsapp/carlaThrottle';
import { solardocViaIo } from '../agents/zapiClient';
import { EP_ORIGENS, EP_AGENDA_INICIO } from './eletropostoAgenda';
import { SOLAR_ORIGENS, SOLAR_BOASVINDAS_INICIO } from './solarBoasVindas';

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
    fichasEletro30, nota1_30, nota1SemConvite, indicacoes30, respostasBlast,
    prospTotal, prospToques, seqAtivas, disparosRodando, igAutomacoes,
    epReunioesFuturas, epFuturasConfirmadas, epPresencaConfirmada, epLembretes5min30d, epUltimoToque,
    solarCadastros30, solarBoasVindas30, solarUltimoToque,
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
    contarGerador('eletroposto_nota1', (q: any) => q.gte('created_at', desde30)),
    contarGerador('eletroposto_nota1', (q: any) => q.is('convite_enviado_at', null)),
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
        const { data } = await supabaseGerador
          .from('agendamentos').select('confirmacao_at, lembrete_1h_at, lembrete_5min_at')
          .in('created_by', EP_ORIGENS).gte('quando', new Date(agora - 30 * D).toISOString()).limit(500);
        const todos = (data ?? [])
          .flatMap(r => [r.confirmacao_at, r.lembrete_1h_at, r.lembrete_5min_at])
          .filter(v => !!v && String(v) >= EP_AGENDA_INICIO) as string[];
        return todos.sort().pop() ?? null;
      } catch (err) { logger.error('central-agentes', 'último toque da agenda EP falhou', err); return null; }
    })(),
    // Boas-vindas do solar: cadastros que entraram × cadastros que receberam o
    // recibo. A diferença entre os dois números É o alerta — cliente que se
    // cadastrou e ficou no escuro.
    contarGerador('agendamentos', (q: any) => q.in('created_by', SOLAR_ORIGENS).gte('created_at', desde30)),
    contarGerador('agendamentos', (q: any) => q.in('created_by', SOLAR_ORIGENS)
      .gte('created_at', desde30).not('boas_vindas_at', 'is', null)),
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
      teto_hora: MAX_POR_HORA, usados_na_hora: usadosNaHora,
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
      ],
      toques: [
        { titulo: 'convite do grupo (nota 1)', quando: 'segundos depois da simulação', copy: '5 bolhas: explica que o passo é definir o local e entrega o link do grupo gratuito.' },
        { titulo: 'aviso da equipe', quando: 'assim que a ficha entra', copy: 'Card com selo da nota, pontuação e dados do ponto pro WhatsApp do Thiago e do Diego.' },
      ],
      alerta: (nota1SemConvite ?? 0) > 0 ? `${nota1SemConvite} lead(s) nota 1 estão sem o convite do grupo.` : undefined,
    },
    {
      id: 'agenda_eletroposto',
      nome: 'Agendamento do eletroposto — confirmação e presença',
      papel: 'Agente de agendamento: assim que alguém marca na LP, ele confirma o horário no WhatsApp, avisa 1 hora antes que o link está vindo e chama de novo 5 minutos antes. Existe por causa de quem marca e some.',
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
          label: 'Confirmaram presença', valor: epPresencaConfirmada,
          sub: 'disse que vem, em mensagem. Pediu pra remarcar depois? Sai da conta.',
        },
        { label: 'Chamados de 5 min (30d)', valor: epLembretes5min30d },
      ],
      toques: [
        { titulo: '1º · ao marcar', quando: 'segundos depois de escolher o horário na LP', copy: 'Confirma dia e hora com o nome e o WhatsApp do consultor, explica que é por vídeo. Pede um "SIM" e pede o material do ponto — foto, localização, conta de luz, o que já orçou.' },
        { titulo: '2º · 1 hora antes', quando: '45 a 75 min antes da reunião', copy: 'Avisa que o link está vindo, pede internet e sinal, e abre a porta do remarcar de novo.' },
        { titulo: '3º · 5 minutos antes', quando: 'nos 12 min que antecedem o horário', copy: '"É agora, o consultor já está te esperando" — manda ficar de olho no chat porque o link cai a qualquer momento.' },
        { titulo: '↩ resposta do lead', quando: 'até 5 min depois de ele escrever', copy: 'Não é mensagem pro lead: é o recado que vai pro Thiago e pro Diego com o que a pessoa escreveu, a hora da reunião e de quem ela é. Kill-switch EP_RESPOSTAS_OFF.' },
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
        { label: 'Cadastros de solar (30d)', valor: solarCadastros30, sub: 'LP solar + /simular + Lead Ads' },
        { label: 'Receberam as boas-vindas', valor: solarBoasVindas30, sub: 'só conta ficha criada depois de o agente existir' },
        { label: 'Responderam', valor: solarResp.total, sub: `${solarResp.h24} nas últimas 24h · recado vai pro consultor dono da ficha` },
      ],
      toques: [
        { titulo: 'único · no cadastro', quando: 'até 5 min depois de a ficha entrar', copy: 'Seis bolhas: quem é o consultor + o WhatsApp dele, "nós entramos em contato", "pode escrever agora que estamos aguardando", e uma pergunta só — qual o consumo atual (aceita foto da conta de luz). Só ficha com até 1 hora de vida — o backlog nunca é tocado.' },
        { titulo: '↩ resposta do cliente', quando: 'até 5 min depois de ele escrever', copy: 'Não é mensagem pro cliente: é o recado com o que a pessoa escreveu, indo pro consultor DONO da ficha (e cópia pro Thiago). Kill-switch SOLAR_RESPOSTAS_OFF.' },
      ],
      alerta: !envLigado('SOLAR_BOASVINDAS_OFF')
        && (solarCadastros30 ?? 0) > 0 && (solarBoasVindas30 ?? 0) === 0
        ? 'Nenhum cadastro de solar recebeu boas-vindas nos últimos 30 dias, com o agente ligado — confira o cron e a linha IO.'
        : undefined,
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
