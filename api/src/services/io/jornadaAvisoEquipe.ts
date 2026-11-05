// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): os avisos À EQUIPE pela 5040 (instância `io`). Veredito do chefe-antiban de 05/11/2026.
//
//   7.1 aviso de venda · 7.2 "É sua" · 7.5 "Esperando" · 7.3 fila das 08:00 (com a escalada, o "Falta", o dinheiro pendente e o placar).
//
// Regras: 1 bolha por mensagem; sem janela (equipe); até 12 envios por hora por pessoa (carimbos `jornada_env:`); só telefone que está no
// `TEL_AVISO` e passa no `ehDestinoInterno`; 1 ENVIO POR RODADA (a vez é um INSERT `jornada_vez:`); a trava é um INSERT com chave única ANTES do
// envio e é também o carimbo (nunca upsert); o envio PARA no primeiro erro. Só dispara o gravado por gente depois do "ligado em".
// Nenhum log leva nome, telefone, texto ou valor: só o código e o id do card.
// ─────────────────────────────────────────────────────────────────────────────
import { sendWhatsApp } from '../agents/zapiClient';
import { equipamentoDaProposta } from '../gerador/trelloVendaSolar';
import { prazoDaEtapa } from '../gerador/jornadaSolar';
import { prazoDaEtapaObra } from '../gerador/jornadaObra';
import { diaBRT, diaDaSemanaBRT } from '../agentes5040/relogio';
import { contarErroDaLinha, zerarErrosDaLinha } from '../agentes5040/guardaDaLinha';
import {
  LIMITE_POR_PESSOA_HORA, PESSOAS_FILA, chaveFila, eventosDoCard, filaDaPessoa, linhasDeDinheiro, linhasSemComprovante, naJanelaDaFila, paradosComAEquipe, placarDaSemana,
  textoEspera, textoFila, textoSua, textoVenda, type EventoMsg, type ObraFila,
} from './jornadaMensagensPuro';
import {
  TEL_EQUIPE, cabeNaLinha, dinheiroDasObras, enviosDaPessoaNaHora, faltaDaObra, jaTravadas, linhaLivre, marcarTrava, nada, parou, propostaDoCard, telefoneDaEquipe, travar,
  type CtxMsg, type Leitura, type ResultadoMsg,
} from './jornadaMensagensBase';

const ROBOS_EQUIPE = { venda: 'jornada_venda_aviso', sua: 'jornada_etapa_aviso', espera: 'jornada_etapa_aviso', fila: 'jornada_fila_manha' } as const;
const logAviso = (que: string, id?: number | string): void => console.error(`[jornada-msg] ${que}`, id ?? '');

/** As pessoas da fila do dia que já se sabe sem nada a receber (evita reler o dinheiro nas 6 rodadas da janela). Memória da instância. */
const vaziosDoDia = new Map<string, Set<string>>();
/** Para os testes. */
export function limparMemoriaDaFila(): void { vaziosDoDia.clear(); }

interface Envio { chave: string; pessoa: string; valor: Record<string, unknown>; texto: string; tipoLog: string }

/**
 * Um envio, na ordem das regras da linha: telefone, 12 por hora, linha livre, a vez, a TRAVA (INSERT), o envio, o carimbo.
 * `pular` = esta pessoa/chave não sai agora, siga para a próxima; `ResultadoMsg` = a rodada acaba aqui.
 */
async function enviarUm(c: CtxMsg, e: Envio): Promise<ResultadoMsg | 'pular'> {
  const tel = telefoneDaEquipe(e.pessoa);
  if (!tel) return 'pular';
  const n = await enviosDaPessoaNaHora(e.pessoa, c.agora);
  if (n === null) return parou('leitura_falhou');
  // Acima de 12 por hora da pessoa o aviso NÃO é descartado: sem trava, ele volta a cada rodada até vencer (24 h) ou caber.
  if (n >= LIMITE_POR_PESSOA_HORA) return 'pular';
  if (!(await linhaLivre(c.agora))) return parou('linha_ocupada');
  if (!(await cabeNaLinha(c.agora))) return parou('linha_cheia');
  if (!(await c.vez.tomar())) return parou('vez_ocupada');
  const t = await travar(e.chave, e.valor, c.agora);
  if (t === 'ja') return 'pular';
  if (t === 'erro') return parou('trava_falhou');
  try {
    await sendWhatsApp(tel, e.texto, 'io');
  } catch (err) {
    // O freio de erro da linha: 2 erros seguidos armam a pausa de 15 min (erro do destino não conta).
    await contarErroDaLinha(c.agora, err);
    await marcarTrava(e.chave, { falhou: true }, c.agora);
    logAviso(`envio_falhou ${e.tipoLog}`);
    return { enviado: false, parar: true, motivo: 'envio_falhou', chave: e.chave };
  }
  await marcarTrava(e.chave, { enviado: true }, c.agora);
  await zerarErrosDaLinha(c.agora);
  return { enviado: true, parar: true, motivo: 'enviado', chave: e.chave };
}

// ── 7.3 · a fila das 08:00 ───────────────────────────────────────────────────────────────────────────────────────────

export async function rodarFila(c: CtxMsg, leitura: Leitura): Promise<ResultadoMsg> {
  if (c.sonda || !c.ligados.fila || !naJanelaDaFila(c.agora)) return nada('fora');
  const dia = diaBRT(c.agora);
  const vazios = vaziosDoDia.get(dia) ?? new Set<string>();
  if (vaziosDoDia.size > 3) vaziosDoDia.clear();
  vaziosDoDia.set(dia, vazios);
  const ja = await jaTravadas(PESSOAS_FILA.map((p) => chaveFila(dia, p)));
  if (!ja) return parou('leitura_falhou');
  const pessoas = PESSOAS_FILA.filter((p) => !ja.has(chaveFila(dia, p)) && !vazios.has(p));
  if (!pessoas.length) return nada('feita');

  // O que custa leitura (dinheiro, "Falta") só se monta aqui, dentro da janela, para quem ainda não recebeu.
  // O dinheiro é lido para quem ainda não recebeu, seja qual for a pessoa: o bloco "Falta comprovante" é de quem LANÇOU a saída.
  const doDinheiro = await dinheiroDasObras(leitura.obras);
  let escalada = pessoas.includes('thiago') ? paradosComAEquipe(leitura.obras, dia).slice(0, 25) : [];
  if (escalada.length) {
    const porCard = new Map<number, ObraFila>(leitura.obras.map((o) => [o.card, o]));
    escalada = await Promise.all(escalada.map(async (x) => ({ ...x, falta: await faltaDaObra(porCard.get(x.card) as ObraFila, leitura.ligs) })));
  }
  const placar = diaDaSemanaBRT(c.agora) === 1 ? placarDaSemana(leitura.obras, dia, dia) : [];

  for (const pessoa of pessoas) {
    const texto = textoFila({
      pessoa, hoje: dia, itens: filaDaPessoa(pessoa, leitura.obras, dia).itens,
      escalada: pessoa === 'thiago' ? escalada : [], placar: pessoa === 'thiago' ? placar : [], dinheiro: linhasDeDinheiro(pessoa, doDinheiro),
      semComprovante: linhasSemComprovante(pessoa, doDinheiro),
    });
    if (!texto) { vazios.add(pessoa); continue; }
    const r = await enviarUm(c, { chave: chaveFila(dia, pessoa), pessoa, valor: { robo: ROBOS_EQUIPE.fila }, texto, tipoLog: 'fila' });
    if (r !== 'pular') return r;
  }
  return nada('sem_envio');
}

// ── 7.1, 7.2 e 7.5 · os eventos gravados por gente ───────────────────────────────────────────────────────────────────────

async function textoDoEvento(ev: EventoMsg, o: ObraFila, leitura: Leitura): Promise<string | null> {
  const cardInfo = leitura.cards.get(o.card);
  if (ev.tipo === 'venda') {
    const p = await propostaDoCard(leitura.ligs.get(o.card)?.proposta ?? null);
    const eq = equipamentoDaProposta(p);
    const kwp = eq && eq.qtdPlacas && eq.potPlaca ? (eq.qtdPlacas * eq.potPlaca) / 1000 : null;
    return textoVenda({ nome: o.cliente, cidade: String(cardInfo?.cidade ?? o.cidade), kwp, placas: eq?.qtdPlacas ?? null, vendedor: o.vendedor });
  }
  if (ev.tipo === 'sua') {
    const vence = ev.etapa <= 3 ? prazoDaEtapa(ev.etapa, o.js).vence : prazoDaEtapaObra(ev.etapa, o.js, o.jo).vence;
    return textoSua({ n: ev.etapa, codigo: o.codigo, nome: o.cliente, cidade: o.cidade, vence });
  }
  const esp = ev.etapa <= 3 ? o.js?.esperando : o.jo?.esperando;
  if (!esp) return null;
  return textoEspera({ codigo: o.codigo, nome: o.cliente, n: ev.etapa, ate: esp.ate, marcou: ev.por, motivo: esp.motivo });
}

export async function rodarEventos(c: CtxMsg, leitura: Leitura): Promise<ResultadoMsg> {
  if (!c.ligados.venda && !c.ligados.etapa) return nada('desligado');
  const equipeVenda = Object.keys(TEL_EQUIPE());
  const eventos: Array<{ ev: EventoMsg; o: ObraFila }> = [];
  for (const o of leitura.obras) {
    for (const ev of eventosDoCard({ card: o.card, js: o.js, jo: o.jo, vendedor: o.vendedor }, c.agora, c.ligados, { aceitarSonda: c.sonda, equipeVenda })) eventos.push({ ev, o });
  }
  if (!eventos.length) return nada('sem_evento');
  eventos.sort((a, b) => (a.ev.em < b.ev.em ? -1 : a.ev.em > b.ev.em ? 1 : 0));
  const ja = await jaTravadas(eventos.flatMap((x) => x.ev.chaves));
  if (!ja) return parou('leitura_falhou');

  if (c.sonda) {
    // A sonda: trava TODAS as pendentes do card numa chamada, com o transporte FALSO (nada é enviado) e `sonda: true`.
    const travadas: string[] = [];
    const existentes = eventos.flatMap((x) => x.ev.chaves).filter((k) => ja.has(k)).length;
    for (const { ev } of eventos) {
      for (const chave of ev.chaves) {
        if (ja.has(chave)) continue;
        if ((await travar(chave, { robo: ROBOS_EQUIPE[ev.tipo], evento_em: ev.em, sonda: true }, c.agora)) === 'ok') {
          await marcarTrava(chave, { enviado: false, sonda: true }, c.agora);
          travadas.push(chave);
        }
      }
    }
    return { enviado: false, parar: false, motivo: 'sonda', travadas, jaTravadas: existentes };
  }

  for (const { ev, o } of eventos) {
    for (const chave of ev.chaves) {
      if (ja.has(chave)) continue;
      const pessoa = chave.slice(chave.lastIndexOf(':') + 1);
      const texto = await textoDoEvento(ev, o, leitura);
      if (!texto) continue;
      const r = await enviarUm(c, { chave, pessoa, valor: { robo: ROBOS_EQUIPE[ev.tipo], evento_em: ev.em }, texto, tipoLog: 'evento' });
      if (r !== 'pular') return r;
    }
  }
  return nada('sem_envio');
}
