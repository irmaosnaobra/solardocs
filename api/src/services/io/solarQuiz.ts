// ─────────────────────────────────────────────────────────────────────────────
// O QUIZ SOLAR NO SERVIDOR (07/10/2026)
//
// A página /io/solar pergunta; quem decide o caminho e monta a vitrine é este
// arquivo. No eletroposto a vitrine é calculada no navegador e o servidor
// revalida no clique, e isso já deu três desencontros caros (a faixa dos 15
// minutos, o dono que não é sócio, a bandeira `ep` jogada fora no map). Aqui a
// página só desenha o que o servidor devolve: não existe vitrine vendendo o que
// a gravação recusa, porque as duas são a mesma conta.
//
// Funções puras (recebem a ocupação já lida). A rota lê o banco e chama.
// ─────────────────────────────────────────────────────────────────────────────

import {
  decidirCaminho, reservaDe, horariosDoCaminho, blocoDoCompromisso, ocupacaoDaFichaSolar,
  rotuloDaFaixa, MARCA_QUIZ, RAIO_VISITA_KM, BASE_DO_SOCIO, socioMaisPerto, caminhoDaFicha,
  type Caminho, type Decisao, type FichaAgenda,
} from '../agenda/solarRota';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { agendaFechadaEm, ehSocio } from '../agenda/agendaFechada';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Dois dias na vitrine, como no eletroposto desde 30/09: horário longe dá mais
 *  tempo pro lead esfriar, e reunião marcada que não acontece custa mais que a
 *  não marcada, porque ainda queima o horário de quem atende. */
export const DIAS_NA_VITRINE = 2;
/** Quantos dias para frente a vitrine procura os dois com vaga. */
export const DIAS_VARRIDOS = 14;
/** Antecedência mínima. A visita pede mais: o sócio precisa sair da base. */
export const ANTECEDENCIA_MIN: Record<Caminho, number> = { vistoria: 180, video: 60, ligacao: 30, curioso: 0 };

export const ROTULO_CAMINHO: Record<Caminho, string> = {
  vistoria: 'VISTORIA PRESENCIAL', video: 'ATENDIMENTO ONLINE', ligacao: 'LIGAÇÃO', curioso: 'CURIOSO',
};

// ── As respostas ────────────────────────────────────────────────────────────
export const OPCOES = {
  tipo: { casa: 'Casa', empresa: 'Comércio ou empresa', rural: 'Rural' },
  imovel: { proprio: 'Próprio', alugado: 'Alugado', construcao: 'Em construção' },
  urgencia: { ja: 'O quanto antes, este mês', '3meses': 'Nos próximos 3 meses', pesquisando: 'Ainda pesquisando preços' },
  concorrente: { sim: 'Sim, quer comparar', nao: 'Não, é o primeiro' },
  pagamento: { vista: 'À vista', financiamento: 'Financiamento', cartao: 'Cartão em até 21x', naosei: 'Ainda não sabe' },
  decisor: { eu: 'Decide sozinho', junto: 'Decide com mais alguém', outro: 'Outra pessoa decide' },
  grupoa: { sim: 'Sim', nao: 'Não', naosei: 'Não sabe' },
} as const;
type Campo = keyof typeof OPCOES;

export interface Respostas {
  conta: string | null;
  cidade: string;
  tipo: string | null; imovel: string | null; urgencia: string | null; concorrente: string | null;
  pagamento: string | null; decisor: string | null; grupoa: string | null;
}

/** Só passa o que a página pode mandar. Texto livre só na cidade, cortado. */
export function limparRespostas(raw: unknown): Respostas {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pega = (campo: Campo): string | null => {
    const v = String(r[campo] ?? '');
    return Object.prototype.hasOwnProperty.call(OPCOES[campo], v) ? v : null;
  };
  return {
    conta: rotuloDaFaixa(r.conta) ? String(r.conta) : null,
    cidade: String(r.cidade ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    tipo: pega('tipo'), imovel: pega('imovel'), urgencia: pega('urgencia'), concorrente: pega('concorrente'),
    pagamento: pega('pagamento'), decisor: pega('decisor'), grupoa: pega('grupoa'),
  };
}

const rot = (campo: Campo, v: string | null): string | null =>
  v ? (OPCOES[campo] as Record<string, string>)[v] ?? null : null;

// ── A ocupação ──────────────────────────────────────────────────────────────
export interface Ocupacao { dono: string; ini: number; fim: number }

const MIN = 60_000;
/** O bloco de uma ficha que já está na agenda, de qualquer origem. As do solar
 *  vêm da régua única; reunião de eletroposto vale 30 min (15 na faixa de
 *  remarcação :15/:45); o resto é ligação ou card de 15 min. */
export function blocoDaFicha(a: FichaAgenda): { ini: number; fim: number } | null {
  if (!a.quando) return null;
  const solar = ocupacaoDaFichaSolar(a);
  if (solar) return solar;
  const t = new Date(String(a.quando)).getTime();
  if (Number.isNaN(t)) return null;
  if (ehOrigemEletroposto(a.created_by)) {
    const m = new Date(t).getUTCMinutes();
    return { ini: t, fim: t + ((m === 15 || m === 45) ? 15 : 30) * MIN };
  }
  return { ini: t, fim: t + 15 * MIN };
}

// ── Dias e horários ─────────────────────────────────────────────────────────
const BRT = 'America/Sao_Paulo';
export const ymdBRT = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const msDe = (ymd: string, hhmm: string): number => new Date(`${ymd}T${hhmm}:00-03:00`).getTime();
const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
const somaDias = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() + n); return ymdBRT(d.getTime());
};
export const diaUtil = (ymd: string): boolean => {
  const w = diaDaSemana(ymd);
  return w !== 0 && w !== 6 && !ehFeriadoBR(ymd);
};

/** O horário cabe para esta pessoa, neste caminho? Mesma pergunta na vitrine e
 *  na gravação. */
export function cabe(caminho: Caminho, ymd: string, hhmm: string, pessoa: string, dec: Decisao,
  ocupacoes: readonly Ocupacao[], agoraMs: number): boolean {
  if (!diaUtil(ymd)) return false;
  if (ehSocio(pessoa) && agendaFechadaEm(ymd)) return false;
  if (!horariosDoCaminho(caminho, ymd, pessoa, dec.cidade).includes(hhmm)) return false;
  const t = msDe(ymd, hhmm);
  const bloco = blocoDoCompromisso(caminho, t, pessoa, dec.cidade);
  // A antecedência conta do horário marcado; e a saída da base não pode ter passado.
  if (t < agoraMs + ANTECEDENCIA_MIN[caminho] * MIN) return false;
  if (bloco.ini < agoraMs) return false;
  return !ocupacoes.some(o => o.dono === pessoa && o.ini < bloco.fim && bloco.ini < o.fim);
}

export interface DiaVitrine { ymd: string; horas: Array<{ h: string; dono: string }> }

/** Os dois próximos dias com vaga. Cada horário fica com o primeiro candidato
 *  que cabe nele, na ordem da decisão (sócio mais perto, depois o outro). */
export function montarVitrine(dec: Decisao, ocupacoes: readonly Ocupacao[], agoraMs: number): DiaVitrine[] {
  const out: DiaVitrine[] = [];
  let ymd = ymdBRT(agoraMs);
  for (let i = 0; i < DIAS_VARRIDOS && out.length < DIAS_NA_VITRINE; i++, ymd = somaDias(ymd, 1)) {
    if (!diaUtil(ymd)) continue;
    const porHora = new Map<string, string>();
    for (const pessoa of dec.candidatos) {
      for (const h of horariosDoCaminho(dec.caminho, ymd, pessoa, dec.cidade)) {
        if (porHora.has(h)) continue;
        if (cabe(dec.caminho, ymd, h, pessoa, dec, ocupacoes, agoraMs)) porHora.set(h, pessoa);
      }
    }
    if (porHora.size) {
      out.push({ ymd, horas: [...porHora.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([h, dono]) => ({ h, dono })) });
    }
  }
  return out;
}

/** Decide e monta a vitrine. Sem horário no caminho, desce a escada de
 *  reservas (reservaDe em solarRota.ts): visita, atendimento do Thiago,
 *  ligação da Nilce. Curioso não tem vitrine. */
export function decidirEMontar(resp: Respostas, dono: string | null, ocupacoes: readonly Ocupacao[], agoraMs: number):
  { dec: Decisao; dias: DiaVitrine[]; semHorario: boolean } {
  const dec = decidirCaminho(resp, dono);
  if (dec.caminho === 'curioso') return { dec, dias: [], semHorario: false };
  let atual: Decisao | null = dec;
  let primeira = true;
  while (atual) {
    const dias = montarVitrine(atual, ocupacoes, agoraMs);
    if (dias.length) return { dec: atual, dias, semHorario: !primeira };
    atual = reservaDe(atual);
    primeira = false;
  }
  return { dec, dias: [], semHorario: true };
}

const NOME_PESO: Record<string, string> = { urgencia: 'prazo', decisor: 'decisor', pagamento: 'pagamento', imovel: 'imóvel', concorrente: 'orçamento' };

// ── O que fica escrito ──────────────────────────────────────────────────────
export interface Endereco { cep?: string; rua?: string; numero?: string; bairro?: string }

export function limparEndereco(raw: unknown): Endereco | null {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = { cep: s(e.cep, 9), rua: s(e.rua, 120), numero: s(e.numero, 20), bairro: s(e.bairro, 80) };
  return out.cep || out.rua || out.numero ? out : null;
}

/** A ficha do card. Primeira linha é a marca + o caminho: é por ela que as três
 *  agendas sabem quanto a visita ocupa (caminhoDaFicha). */
export function montarObservacao(resp: Respostas, dec: Decisao, end: Endereco | null, semHorario = false): string {
  const L: string[] = [];
  L.push(`${MARCA_QUIZ} · ${rot('tipo', resp.tipo) ?? 'Imóvel'} · ${ROTULO_CAMINHO[dec.caminho]}`);
  const faixa = rotuloDaFaixa(resp.conta);
  if (faixa) L.push(`Conta de luz: ${faixa}${dec.kwh ? ` (~${dec.kwh.toLocaleString('pt-BR')} kWh/mês)` : ''}`);
  L.push(`Pontuação: ${dec.pontos}/100 (${dec.pontuacao.partes.map(p => `${NOME_PESO[p.campo]} ${p.pts}/${p.max}`).join(', ')})`);
  if (dec.cidade) {
    const c = dec.cidade;
    // Distância de Uberlândia: é de lá que o Diego sai para todas as visitas.
    const km = c.kmUdi;
    L.push(`Cidade: ${c.nome}-${c.uf}${km ? ` · ${km} km de Uberlândia pela estrada` : ''}`);
  } else if (resp.cidade) {
    L.push(`Cidade: ${resp.cidade} · FORA DO RAIO DE ${RAIO_VISITA_KM} KM`);
  }
  const linha = (rotulo: string, campo: Campo, v: string | null) => { const t = rot(campo, v); if (t) L.push(`${rotulo}: ${t}`); };
  linha('Imóvel', 'imovel', resp.imovel);
  linha('Quando quer', 'urgencia', resp.urgencia);
  linha('Já tem orçamento', 'concorrente', resp.concorrente);
  linha('Pagamento', 'pagamento', resp.pagamento);
  const dec2 = rot('decisor', resp.decisor);
  if (dec2) L.push(`Decisor: ${dec2}${resp.decisor === 'junto' && dec.caminho === 'vistoria' ? ' (pedimos os dois na visita)' : ''}`);
  const ga = rot('grupoa', resp.grupoa);
  if (ga) L.push(`Demanda contratada: ${ga}${resp.grupoa === 'sim' ? ' · GRUPO A' : ''}`);
  if (dec.qualifica) {
    const oque = dec.qualifica === 'vistoria' ? 'VISITA DO DIEGO' : 'ATENDIMENTO DO THIAGO';
    L.push(semHorario ? `SEM HORÁRIO DE ${oque}: marcar no atendimento` : `QUALIFICA PARA ${oque}: chamar quem faz no atendimento`);
  }
  if (end && dec.caminho === 'vistoria') {
    const partes = [[end.rua, end.numero].filter(Boolean).join(', '), end.bairro, dec.cidade?.nome, end.cep ? `CEP ${end.cep}` : '']
      .filter(Boolean);
    if (partes.length) L.push(`Endereço: ${partes.join(' · ')}`);
  }
  L.push(`Por que este caminho: ${dec.motivo}`);
  return L.join('\n');
}

/** As respostas no formato do `leads_meta.field_data`, o mesmo do formulário do
 *  Meta. A tela Leads do Gerador acha as colunas pelo nome (consum, urg,
 *  pagamento, decide), então os nomes aqui seguem essas palavras. */
export function camposDoLead(resp: Respostas, dec: Decisao, extra: { semHorario?: boolean } = {}): Array<{ name: string; values: string[] }> {
  const f: Array<{ name: string; values: string[] }> = [];
  const add = (name: string, v: string | null | undefined) => { if (v) f.push({ name, values: [v] }); };
  add('Origem', 'Quiz Solar');
  add('Caminho', dec.caminho);
  add('Pontos', String(dec.pontos));
  add('Consumo', rotuloDaFaixa(resp.conta) ? `${rotuloDaFaixa(resp.conta)}${dec.kwh ? ` (~${dec.kwh} kWh)` : ''}` : null);
  add('Onde', rot('tipo', resp.tipo));
  add('Imóvel', rot('imovel', resp.imovel));
  add('Urgência', rot('urgencia', resp.urgencia));
  add('Já tem orçamento', rot('concorrente', resp.concorrente));
  add('Pagamento', rot('pagamento', resp.pagamento));
  add('Quem decide', rot('decisor', resp.decisor));
  add('Demanda contratada', rot('grupoa', resp.grupoa));
  // De Uberlândia, como na ficha: é de lá que o Diego sai para toda visita (08/10).
  add('Raio', dec.cidade ? `${dec.cidade.kmUdi} km` : (resp.cidade ? 'fora do raio' : null));
  if (dec.qualifica) add('Qualifica', dec.qualifica);
  if (extra.semHorario) add('Sem horário', 'sim');
  // O que fez a nota ser a nota (08/10): quanto cada resposta valeu, no fim, para
  // a planilha do Leads Solar mostrar ao lado das respostas. Ficam por último de
  // propósito: quem procura "Pagamento" acha a resposta antes dos pontos dela.
  for (const p of dec.pontuacao.partes) add(`Pontos do ${NOME_PESO[p.campo]}`, `${p.pts}/${p.max}`);
  return f;
}

// ── O aviso no celular de quem atende (08/10/2026) ──────────────────────────
// Sai pelo 5040 para o dono do card, na hora em que o cliente marca. Lê a mesma
// ficha que a agenda mostra (montarObservacao), então o que chega no celular é o
// que está no card. Pedido do Thiago: "mais completo, com emoji principal pela
// nota". Faixas: 🟢 de 90 a 100, 🟡 de 60 a 89, 🔴 abaixo de 60 (ele passou
// "100 a 90, 80 a 60, 50 a 0"; o que ficou entre as faixas cai na de baixo).
// Emoji só na primeira linha (regra de 24/09) e nada de travessão. A nota vem no
// fim, do critério de menor peso ao de maior, como na planilha do Leads Solar.
export const emojiDaNota = (n: number): string => (n >= 90 ? '🟢' : n >= 60 ? '🟡' : '🔴');

const FONTE_DO_ANUNCIO: Record<string, string> = { ig: 'Instagram', fb: 'Facebook', an: 'Audience Network', th: 'Threads', msg: 'Messenger' };
/** [nome na linha "Pontuação", rótulo no aviso, linha da ficha], do menor peso ao maior. */
const CRITERIOS_DA_NOTA: ReadonlyArray<[string, string, string]> = [
  ['orçamento', 'Já tem orçamento', 'Já tem orçamento:'],
  ['imóvel', 'Imóvel', 'Imóvel:'],
  ['pagamento', 'Pagamento', 'Pagamento:'],
  ['decisor', 'Quem decide', 'Decisor:'],
  ['prazo', 'Prazo', 'Quando quer:'],
];

export interface FichaDoAviso {
  observacao?: unknown; quando?: unknown; vendedor_nome?: unknown; cliente_nome?: unknown; cliente_telefone?: unknown;
  utm_source?: unknown; utm_campaign?: unknown;
}

export function avisoDaEquipe(a: FichaDoAviso): string {
  const linhas = String(a.observacao || '').split('\n');
  const val = (rot: string) => linhas.find(l => l.startsWith(rot))?.slice(rot.length).trim() || '';
  const caminho = caminhoDaFicha(a.observacao) || 'ligacao';
  const tipo = (linhas[0] || '').split(' · ')[1] || '';
  // "94/100 (prazo 35/35, decisor 14/20, pagamento 20/20, imóvel 15/15, orçamento 10/10)"
  const pontuacao = val('Pontuação:');
  const m = pontuacao.match(/^(\d+)\/100/);
  const nota = m ? Number(m[1]) : null;
  const partes = new Map<string, string>();
  for (const p of pontuacao.matchAll(/(\p{L}+) (\d+)\/(\d+)/gu)) partes.set(p[1].toLowerCase(), `${p[2]} de ${p[3]}`);

  const quando = new Date(String(a.quando)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const titulo = { vistoria: 'NOVA VISITA', video: 'NOVO ATENDIMENTO ONLINE', ligacao: 'NOVA LIGAÇÃO', curioso: 'NOVO CURIOSO' }[caminho];
  const out = [
    nota === null ? `☀️ *${titulo}, ENERGIA SOLAR*` : `${emojiDaNota(nota)} *NOTA ${nota} · ${titulo}, ENERGIA SOLAR*`,
    'Veio do quiz da /io/solar.',
    '',
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || ''}`,
    `*Cliente:* ${a.cliente_nome || ''}`,
    `*WhatsApp:* wa.me/${String(a.cliente_telefone || '').replace(/\D/g, '')}`,
    '',
  ];
  const campo = (rot: string, v: string) => { if (v) out.push(`*${rot}:* ${v}`); };
  campo('Onde', tipo);
  const cidade = val('Cidade:');
  campo('Cidade', cidade);
  const endereco = val('Endereço:');
  campo('Endereço', endereco);
  if (endereco) {
    const busca = `${endereco.replace(/ · CEP /, ', ').replace(/ · /g, ', ')}, ${cidade.split(' · ')[0]}`;
    campo('Mapa', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  }
  campo('Conta', val('Conta de luz:'));
  campo('Demanda contratada', val('Demanda contratada:'));
  const fonte = String(a.utm_source || '').trim();
  const campanha = String(a.utm_campaign || '').trim();
  campo('Origem', fonte || campanha
    ? [FONTE_DO_ANUNCIO[fonte.toLowerCase()] || fonte, campanha ? `campanha ${campanha}` : ''].filter(Boolean).join(', ')
    : 'sem anúncio (link direto)');
  campo('Por que este caminho', val('Por que este caminho:'));

  if (nota !== null) {
    out.push('', '*A NOTA, DO MENOR PESO AO MAIOR*');
    for (const [nome, rotulo, linhaDaFicha] of CRITERIOS_DA_NOTA) {
      out.push(`${rotulo}: ${val(linhaDaFicha) || 'não respondeu'} (${partes.get(nome) || 'sem ponto'})`);
    }
    out.push(`*Nota: ${nota} de 100*`);
  }
  const marca = linhas.find(l => /^(QUALIFICA PARA|SEM HORÁRIO DE)/.test(l));
  if (marca) out.push('', `*${marca}*`);
  out.push('', '_Logo em seguida a Duda manda a mensagem para o cliente com o seu nome e o horário, e responde o básico no 5040. O que for com você, ela te passa aqui._');
  out.push('_Veja no CRM: solardoc.app/gerador_');
  return out.join('\n');
}
