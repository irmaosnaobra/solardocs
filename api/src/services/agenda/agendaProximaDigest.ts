import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

/**
 * Digest "Próxima agenda" — 3× por dia (09h, 16h e 20h BRT) manda pro Thiago e
 * pro Diego a lista GERAL (time inteiro) dos clientes marcados no PRÓXIMO dia
 * que tem agenda.
 *
 * "Próximo dia com agenda" = a primeira data (fuso de São Paulo) DEPOIS de hoje
 * que tem pelo menos 1 agendamento com status='agendado'. Hoje nunca entra —
 * numa sexta, sábado e domingo vazios fazem os três dias caírem na segunda,
 * que é exatamente o pedido ("hoje, amanhã e domingo eu recebo a de segunda").
 *
 * Sem dedup de propósito: as 3 mensagens do dia são a feature. Um
 * workflow_dispatch manual gerando uma 4ª é inofensivo; uma trava de dedup
 * poderia engolir um horário legítimo.
 */

const ZAPI_INSTANCE = 'io' as const;
const BRT_TZ = 'America/Sao_Paulo';

// Só o Thiago e o Diego — mesma dupla dos alertas da LP do eletroposto
// (routes/ioEletroposto.ts) e do repasse.
const DESTINATARIOS: Array<{ nome: string; whatsapp: string }> = [
  { nome: 'Thiago', whatsapp: '34991360223' },
  { nome: 'Diego',  whatsapp: '34991360172' },
];

const MAX_LINHAS = 40;
const JANELA_DIAS = 45;

type Agendamento = {
  id: number;
  vendedor_nome: string | null;
  quando: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
};

export type LinhaAgenda = {
  cliente: string;
  cidade: string;   // já com UF quando dá pra resolver ("Uberlândia MG")
  hora: string;     // "09:00"
  consultor: string;
};

// ── Data/hora sempre no fuso de São Paulo ───────────────────────────────────
// A data "de hoje" NUNCA sai do relógio UTC: o disparo das 20h BRT é 23h UTC e
// o GitHub Actions atrasa 10-30min de vez em quando — se virasse a meia-noite
// UTC, "hoje" pularia um dia e a agenda saía errada.
function dataBRT(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function horaBRT(iso: string): string {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRT_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const hh = p.find(x => x.type === 'hour')?.value ?? '00';
  const mm = p.find(x => x.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

function diaPorExtenso(iso: string): string {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRT_TZ, weekday: 'long', day: '2-digit', month: '2-digit',
  }).formatToParts(new Date(iso));
  const wd  = p.find(x => x.type === 'weekday')?.value ?? '';
  const dia = p.find(x => x.type === 'day')?.value ?? '';
  const mes = p.find(x => x.type === 'month')?.value ?? '';
  return `${wd}, ${dia}/${mes}`;
}

// ── Cidade + UF ─────────────────────────────────────────────────────────────
// A tabela não tem coluna de estado e o campo `cidade` é texto livre digitado
// pelo lead ("Petrolina-PE", "Uberlândia/mg", "UberlÂndia", null). Resolve em
// cascata: sufixo escrito → cidade conhecida → DDD do telefone → sem UF.

const UFS = new Set([
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB',
  'PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]);

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const chaveCidade = (s: string) => semAcento(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

// Cidades que aparecem de verdade na agenda + capitais. Vem ANTES do DDD porque
// o DDD é o telefone do lead, não o endereço dele: um número de São Paulo com
// obra em Cariacica renderizaria "Cariacica SP".
const CIDADE_UF: Record<string, string> = {};
for (const [uf, cidades] of Object.entries({
  MG: ['uberlandia','uberaba','araguari','patos de minas','patrocinio','monte carmelo','ituiutaba','araxa','frutal','iturama','tupaciguara','coromandel','indianopolis','rio paranaiba','conceicao das alagoas','belo horizonte','uberlandia zona rural','campina verde','prata','canapolis','capinopolis','santa vitoria','sacramento','conquista','delta','verissimo','nova ponte','perdizes','campo florido','comendador gomes','pirajuba','planura','fronteira','itapagipe','uniao de minas','limeira do oeste','carneirinho','gurinhata','ipiacu','cachoeira dourada','centralina','arapora','monte alegre de minas','estrela do sul','romaria','nova ponte','douradoquara','grupiara','cascalho rico','abadia dos dourados','cruzeiro da fortaleza','serra do salitre','guimarania','sao gotardo','tiros','carmo do paranaiba','lagoa formosa','vazante','joao pinheiro','paracatu','unai','montes claros','divinopolis','ipatinga','governador valadares','juiz de fora','pouso alegre','varginha','pocos de caldas','betim','contagem','sete lagoas'],
  GO: ['goiania','catalao','itumbiara','caldas novas','pires do rio','anapolis','rio verde','jatai','quirinopolis','ipameri','morrinhos','goiatuba','buriti alegre','cachoeira alta','paranaiba','aparecida de goiania','luziania','formosa','valparaiso de goias'],
  SP: ['sao paulo','guarulhos','franca','bauru','campinas','ribeirao preto','sao jose do rio preto','santos','sorocaba','osasco','santo andre','sao bernardo do campo','barretos','araraquara','jundiai','piracicaba','limeira','americana','itaporanga'],
  RJ: ['rio de janeiro','campos dos goytacazes','niteroi','duque de caxias','nova iguacu','sao goncalo','petropolis','volta redonda','macae'],
  ES: ['vitoria','cariacica','vila velha','serra','cachoeiro de itapemirim','linhares','colatina'],
  PE: ['recife','petrolina','jaboatao dos guararapes','olinda','caruaru','paulista'],
  SE: ['aracaju','nossa senhora do socorro','lagarto'],
  AL: ['maceio','palmeira dos indios','arapiraca'],
  CE: ['fortaleza','maranguape','caucaia','juazeiro do norte','sobral'],
  BA: ['salvador','feira de santana','vitoria da conquista','camacari','juazeiro','barreiras','lauro de freitas','ilheus','itabuna'],
  DF: ['brasilia'],
  PR: ['curitiba','londrina','maringa','ponta grossa','cascavel','foz do iguacu','sao jose dos pinhais'],
  SC: ['florianopolis','joinville','blumenau','chapeco','criciuma','itajai','balneario camboriu'],
  RS: ['porto alegre','caxias do sul','pelotas','canoas','santa maria','gravatai','novo hamburgo'],
  MT: ['cuiaba','varzea grande','rondonopolis','sinop','sorriso','primavera do leste'],
  MS: ['campo grande','dourados','tres lagoas','corumba'],
  TO: ['palmas','araguaina','gurupi'],
  PA: ['belem','ananindeua','santarem','maraba','castanhal','paragominas'],
  AM: ['manaus','parintins','itacoatiara'],
  AP: ['macapa','santana'],
  RR: ['boa vista'],
  AC: ['rio branco','cruzeiro do sul'],
  RO: ['porto velho','ji parana','ariquemes','vilhena'],
  MA: ['sao luis','imperatriz','timon','caxias'],
  PI: ['teresina','parnaiba','picos'],
  RN: ['natal','mossoro','parnamirim'],
  PB: ['joao pessoa','campina grande','patos'],
} as Record<string, string[]>)) {
  for (const c of cidades) CIDADE_UF[c] = uf;
}

// DDD → UF (fallback). Aproximação: é o número do lead, não o endereço.
const DDD_UF: Record<string, string> = {};
for (const [uf, ddds] of Object.entries({
  SP: [11,12,13,14,15,16,17,18,19], RJ: [21,22,24], ES: [27,28],
  MG: [31,32,33,34,35,37,38], PR: [41,42,43,44,45,46], SC: [47,48,49],
  RS: [51,53,54,55], DF: [61], GO: [62,64], TO: [63], MT: [65,66], MS: [67],
  AC: [68], RO: [69], BA: [71,73,74,75,77], SE: [79], PE: [81,87], AL: [82],
  PB: [83], RN: [84], CE: [85,88], PI: [86,89], PA: [91,93,94], AM: [92,97],
  RR: [95], AP: [96], MA: [98,99],
} as Record<string, number[]>)) {
  for (const d of ddds) DDD_UF[String(d)] = uf;
}

function ufPorTelefone(tel: string | null): string {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return DDD_UF[d.slice(0, 2)] || '';
}

const CONECTIVOS = new Set(['de','da','das','do','dos','e','em']);

function tituloCidade(s: string): string {
  return s.split(' ').map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && CONECTIVOS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}

/** "Petrolina-PE" → "Petrolina PE"; "Uberlândia" + tel 34… → "Uberlândia MG"; null → "". */
export function formatarCidadeUf(cidadeRaw: string | null, telefone: string | null): string {
  let cidade = String(cidadeRaw || '').trim().replace(/\s+/g, ' ');
  if (!cidade) return '';

  let uf = '';

  // 1) UF já escrita no fim ("-PE", " MG", "/mg"). Precisa SAIR do nome da
  //    cidade, senão sai "Petrolina-PE PE".
  const m = cidade.match(/[\s\-\/,.]+([A-Za-z]{2})$/);
  if (m && UFS.has(m[1].toUpperCase())) {
    uf = m[1].toUpperCase();
    cidade = cidade.slice(0, m.index).replace(/[\s\-\/,.]+$/, '').trim();
  }

  // 2) cidade conhecida  3) DDD do telefone
  if (!uf) uf = CIDADE_UF[chaveCidade(cidade)] || '';
  if (!uf) uf = ufPorTelefone(telefone);

  const nome = tituloCidade(cidade);
  return uf ? `${nome} ${uf}` : nome;
}

// ── Núcleo ──────────────────────────────────────────────────────────────────

export type ProximaAgenda = {
  data: string | null;        // "2026-08-03" (BRT)
  rotulo: string | null;      // "segunda-feira, 03/08"
  linhas: LinhaAgenda[];
};

/** Primeira data DEPOIS de hoje (BRT) com pelo menos 1 cliente marcado. */
export async function carregarProximaAgenda(): Promise<ProximaAgenda> {
  const agora = new Date();
  const limite = new Date(agora.getTime() + JANELA_DIAS * 24 * 60 * 60 * 1000);

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade')
    .eq('status', 'agendado')
    .gte('quando', agora.toISOString())
    .lte('quando', limite.toISOString())
    .order('quando', { ascending: true });

  if (error) {
    logger.error('agenda-proxima', 'falha ao listar agendamentos', error);
    return { data: null, rotulo: null, linhas: [] };
  }

  const hoje = dataBRT(agora);
  const porDia = new Map<string, Agendamento[]>();
  for (const ag of (data || []) as Agendamento[]) {
    const dia = dataBRT(new Date(ag.quando));
    if (dia <= hoje) continue;            // hoje nunca entra: é a agenda SEGUINTE
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(ag);
  }
  if (!porDia.size) return { data: null, rotulo: null, linhas: [] };

  const proximo = [...porDia.keys()].sort()[0];
  const rows = porDia.get(proximo)!;

  const linhas: LinhaAgenda[] = rows.map(ag => ({
    cliente: (ag.cliente_nome || '').trim() || 'Cliente',
    cidade: formatarCidadeUf(ag.cidade, ag.cliente_telefone),
    hora: horaBRT(ag.quando),
    consultor: (ag.vendedor_nome || '').trim() || '—',
  }));

  return { data: proximo, rotulo: diaPorExtenso(rows[0].quando), linhas };
}

export function montarMensagem(a: ProximaAgenda): string {
  if (!a.data || !a.linhas.length) {
    return `📅 *Próxima agenda*\n\nNenhum cliente marcado nos próximos ${JANELA_DIAS} dias.`;
  }

  const mostradas = a.linhas.slice(0, MAX_LINHAS);
  const corpo = mostradas.map(l => {
    // Cidade em branco (lead sem cidade) some da linha em vez de virar "Fulano -  - 09:00".
    const partes = [l.cliente, l.cidade, l.hora, l.consultor].filter(Boolean);
    return partes.join(' - ');
  }).join('\n');
  const extra = a.linhas.length > MAX_LINHAS ? `\n…e mais ${a.linhas.length - MAX_LINHAS}.` : '';

  return (
    `📅 *Agenda de ${a.rotulo}*\n` +
    `${a.linhas.length} cliente${a.linhas.length > 1 ? 's' : ''} marcado${a.linhas.length > 1 ? 's' : ''}\n\n` +
    corpo + extra
  );
}

/**
 * Roda 3×/dia (09h, 16h e 20h BRT) via GitHub Actions → GET /cron/agenda-proxima.
 * dry=true: não envia nada, só devolve a mensagem que sairia.
 */
export async function enviarAgendaProxima(opts?: { dry?: boolean }): Promise<{
  data: string | null;
  total: number;
  enviados: number;
  erros: number;
  mensagem?: string;
  linhas?: LinhaAgenda[];
}> {
  const dry = !!opts?.dry;
  const agenda = await carregarProximaAgenda();
  const msg = montarMensagem(agenda);

  if (dry) {
    return { data: agenda.data, total: agenda.linhas.length, enviados: 0, erros: 0, mensagem: msg, linhas: agenda.linhas };
  }

  let enviados = 0, erros = 0;
  for (const alvo of DESTINATARIOS) {
    try {
      await sendWhatsApp(alvo.whatsapp, msg, ZAPI_INSTANCE);
      enviados++;
    } catch (e) {
      // Best-effort: a Z-API falhar pro Thiago não pode impedir o envio pro Diego.
      logger.error('agenda-proxima', 'falha ao enviar digest', { alvo: alvo.nome, erro: String(e) });
      erros++;
    }
  }

  return { data: agenda.data, total: agenda.linhas.length, enviados, erros };
}
