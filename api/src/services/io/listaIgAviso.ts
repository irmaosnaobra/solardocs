// OS AVISOS DA LISTA DE INTERESSE DO INSTAGRAM À EQUIPE (19/11/2026). Robô `io_lista_aviso` (chefe/classes.ts, aviso_interno_p2).
// Só equipe: nenhuma mensagem vai ao lead. Condições do chefe anti-ban:
//   6. uma mensagem por pessoa, sem o rodapé "o lead foi avisado";
//   7. eletroposto: o dono do card primeiro, o outro 25 s + sorteio de 0 a 35 s depois; antes de cada envio, cooldown da linha e
//      pausa por erros (vivoEnvio.linhaPausada); se o 1º falhar, o 2º não sai. Quem chama roda isto em waitUntil;
//   8. carimbo por mensagem, INSERT antes do envio: `io_lista_env:<pessoa>:<card>` (Thiago, Diego e o resumo) e, para a Nilce,
//      `solar_quiz_env:nilce:agendado:<lead>` (a mesma chave que o avisarAgendado regrava depois). A chave só é apagada quando o
//      erro prova que nada saiu (cooldown, credencial ausente, ou o avisarAgendado devolveu cooldown/sem destino);
//   9. teto da rota (listaIgVaga.reservarVaga): lead de eletroposto = 2 vagas, sem as 2 nenhuma;
//  10. janela: Nilce no horário do quiz, Thiago e Diego das 7h às 21h. Fora: o card já nasceu, o aviso espera;
//  11. sem vaga, fora da janela ou linha parada: pendente, e o RESUMO por pessoa sai na primeira vaga dentro da janela
//      (runListaIgResumoTick, 1 mensagem por rodada, gastando 1 vaga). aviso_antigo:<card> é gravado sempre.
// IO_LISTA_AVISOS_OFF=1 desliga os avisos e o resumo (centralAgentesCatalogo): o card nasce e o aviso fica pendente.
// O mesmo tick refaz a marca ep_mudo e o repassar_em nulo dos cards que não conferiram (io_lista_repasse:<id>).
// "Voltou": a pessoa já tinha card parado; não nasce outro e a equipe recebe o aviso com o card que existe (mesmo teto e janela).
// Log sem dado pessoal: só id de card e motivo.

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { marcarAvisoAntigo } from '../agentes5040/chaves';
import { erroProvaQueNaoSaiu } from '../agentes5040/fichaEnvio';
import { contarErroDaLinha, zerarErrosDaLinha } from '../agentes5040/guardaDaLinha';
import { avisarAgendado } from './solarQuizAviso';
import { consertarRepasses } from './listaIgCards';
import { TEL_AVISO } from './solarEquipe';
import { textoDoResumo, type ItemDoResumo } from './listaIgTextos';
import {
  PREFIXO_ENV, apagar, baldeDe5, deixarPendente, dentroDaJanela, inserir, lerPendentes, linhaPronta, reservarVaga, type PessoaLista,
} from './listaIgVaga';

const LOG = 'io-lista-ig';
const ROBO = 'io_lista_aviso';
export const ESPERA_MIN_MS = 25_000;
export const ESPERA_SORTEIO_MS = 35_000;
const iso = (ms: number): string => new Date(ms).toISOString();
export const esperar = (ms: number): Promise<void> => new Promise(ok => setTimeout(ok, ms));
export const avisosDesligados = (): boolean => (process.env.IO_LISTA_AVISOS_OFF || '').trim() === '1';
/** Só card nestes status entra no resumo: negociação, venda ou morto já não é "ficou sem aviso". */
const STATUS_DO_RESUMO = ['agendado', 'nao_atendeu'];

type Envio = 'enviado' | 'ja' | 'falhou' | 'nada_saiu';

/** Thiago, Diego e o resumo: carimbo por INSERT, envio, e a chave só sai se o erro provar que nada saiu. */
async function enviarEquipe(pessoa: PessoaLista, texto: string, chave: string, agora: number): Promise<Envio> {
  const tel = TEL_AVISO[pessoa];
  if (!tel) return 'nada_saiu';
  const t = await inserir(chave, { em: iso(agora), robo: ROBO }, agora);
  if (t === 'ja') return 'ja';
  if (t === 'erro') return 'nada_saiu';
  try {
    await sendWhatsApp(tel, texto, 'io');
  } catch (err) {
    await contarErroDaLinha(new Date(agora), err);
    if (erroProvaQueNaoSaiu(err)) { await apagar(chave); return 'nada_saiu'; }
    return 'falhou';
  }
  await zerarErrosDaLinha(new Date(agora));
  return 'enviado';
}

/** A consultora do solar (Nilce ou Giovanna) pelo avisarAgendado (cooldown da linha, aviso_antigo, carimbo solar_quiz_env: e os 12 por hora dela). */
async function enviarConsultora(pessoa: 'nilce' | 'giovanna', cardId: number, lead: string, texto: string, agora: number): Promise<Envio> {
  const chave = `solar_quiz_env:${pessoa}:agendado:${lead}`;
  const t = await inserir(chave, { em: iso(agora) }, agora);
  if (t === 'ja') return 'ja';
  if (t === 'erro') return 'nada_saiu';
  const r = await avisarAgendado(pessoa, cardId, lead, texto);
  if (r.enviado) return 'enviado';
  if (r.motivo === 'cooldown' || r.motivo === 'sem_destino') {
    await apagar(chave);
    await marcarAvisoAntigo(cardId);   // o avisarAgendado devolve a marca quando nada sai; aqui ela fica (condição 11)
    return 'nada_saiu';
  }
  await contarErroDaLinha(new Date(agora));   // o freio de erro da linha conta a falha da Nilce como a dos outros
  return 'falhou';
}

export interface PedidoAviso {
  porta: 'solar' | 'eletroposto';
  cardId: number;
  listaId: string | number;
  /** Solar: o dono do card (23/11/2026: nilce, giovanna, thiago ou diego, pela divisão por conta). Eletroposto: o dono do card (thiago ou diego). */
  dono: PessoaLista;
  texto: string;
  /** A pessoa já tinha card parado (não nasceu outro): sem aviso_antigo e a Nilce também pelo robô da lista. */
  voltou?: boolean;
}
export interface ResultadoAvisoLista { motivo: 'enviado' | 'desligado' | 'fora_da_janela' | 'linha' | 'teto' | 'erro' | 'falhou' | 'parcial'; enviados: PessoaLista[] }

export async function avisarLeadDaLista(p: PedidoAviso, agora = Date.now()): Promise<ResultadoAvisoLista> {
  const pessoas: PessoaLista[] = p.porta === 'solar' ? [p.dono] : [p.dono, p.dono === 'thiago' ? 'diego' : 'thiago'];
  if (!p.voltou) await marcarAvisoAntigo(p.cardId);
  const pendura = async (quem: PessoaLista[]): Promise<void> => deixarPendente(quem, p.cardId, p.porta, Date.now());
  if (avisosDesligados()) { await pendura(pessoas); return { motivo: 'desligado', enviados: [] }; }
  if (!pessoas.every(x => dentroDaJanela(x, agora))) { await pendura(pessoas); return { motivo: 'fora_da_janela', enviados: [] }; }
  if (!(await linhaPronta(agora))) { await pendura(pessoas); return { motivo: 'linha', enviados: [] }; }
  const vaga = await reservarVaga(pessoas.length, agora);
  if (vaga !== 'ok') { await pendura(pessoas); return { motivo: vaga, enviados: [] }; }

  const enviados: PessoaLista[] = [];
  for (let i = 0; i < pessoas.length; i++) {
    const pessoa = pessoas[i]!;
    if (i > 0) {
      await esperar(ESPERA_MIN_MS + Math.floor(Math.random() * ESPERA_SORTEIO_MS));
      if (!(await linhaPronta(Date.now()))) { await pendura([pessoa]); return { motivo: 'parcial', enviados }; }
    }
    const r = (pessoa === 'nilce' || pessoa === 'giovanna') && p.porta === 'solar' && !p.voltou
      ? await enviarConsultora(pessoa, p.cardId, `ig_${p.listaId}`, p.texto, Date.now())
      : await enviarEquipe(pessoa, p.texto, `${PREFIXO_ENV}${pessoa}:${p.voltou ? `volta:${p.listaId}:` : ''}${p.cardId}`, Date.now());
    if (r === 'enviado' || r === 'ja') { enviados.push(pessoa); continue; }
    logger.warn(LOG, `aviso do card ${p.cardId} parou (${r})`);
    // Nada saiu (prova): quem faltava espera o resumo. Falha sem prova: para aqui, ninguém mais recebe (condição 7).
    if (r === 'nada_saiu') await pendura(pessoas.slice(i));
    return { motivo: 'falhou', enviados };
  }
  return { motivo: 'enviado', enviados };
}

export interface ResultadoResumo { enviado: boolean; motivo: string; pessoa?: PessoaLista; n?: number; repasse?: { consertados: number; pendentes: number } }

/** O resumo de quem ficou sem aviso: no máximo UMA mensagem por rodada, na primeira pessoa com pendente e vaga. */
export async function runListaIgResumoTick(opts: { agora?: number } = {}): Promise<ResultadoResumo> {
  const agora = opts.agora ?? Date.now();
  const repasse = await consertarRepasses();
  const r0 = await resumir(agora);
  return { ...r0, repasse };
}

async function resumir(agora: number): Promise<ResultadoResumo> {
  if (avisosDesligados()) return { enviado: false, motivo: 'desligado' };
  for (const pessoa of ['nilce', 'giovanna', 'thiago', 'diego'] as PessoaLista[]) {
    if (!dentroDaJanela(pessoa, agora)) continue;
    const pend = await lerPendentes(pessoa);
    if (!pend || !pend.length) continue;
    if (!(await linhaPronta(agora))) return { enviado: false, motivo: 'linha' };
    const { data, error } = await supabaseGerador.from('agendamentos').select('id, cliente_nome, cidade, status')
      .in('id', pend.map(x => x.card));
    if (error) return { enviado: false, motivo: 'leitura' };
    const cards = new Map(((data ?? []) as Array<Record<string, unknown>>).map(c => [Number(c.id), c]));
    const itens: ItemDoResumo[] = [];
    for (const x of pend) {
      const c = cards.get(x.card);
      if (!c || !STATUS_DO_RESUMO.includes(String(c.status ?? '').trim().toLowerCase())) { await apagar(x.key); continue; }
      itens.push({ nome: String(c.cliente_nome ?? ''), cidade: String(c.cidade ?? ''), porta: x.porta });
    }
    if (!itens.length) continue;
    const vaga = await reservarVaga(1, agora);
    if (vaga !== 'ok') return { enviado: false, motivo: vaga };
    const r = await enviarEquipe(pessoa, textoDoResumo(itens), `${PREFIXO_ENV}${pessoa}:resumo:${baldeDe5(agora)}`, agora);
    if (r !== 'nada_saiu') for (const x of pend) await apagar(x.key);
    if (r !== 'enviado') logger.warn(LOG, `resumo parou (${r})`);
    return { enviado: r === 'enviado', motivo: r, pessoa, n: itens.length };
  }
  return { enviado: false, motivo: 'nada' };
}
