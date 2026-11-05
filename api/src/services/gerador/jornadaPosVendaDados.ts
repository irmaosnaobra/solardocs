// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): as DATAS do pós-venda de uma obra (aniversário do cliente e liberação da usina).
//
// O nascimento vem do cadastro privado (`lerCadastroVisto(card, 'vendasolar')`, campo `nascimento` dd/mm/aaaa, só pessoa física) e a
// liberação, do `obra.json` (`liberacao.passos.liberada.data`). NADA disto vai ao `system_state` nem a log: o cache é em memória, por instância
// e por dia de Brasília, e guarda só o MM-DD do nascimento (nunca o ano) e a data da liberação.
// ─────────────────────────────────────────────────────────────────────────────
import { lerCadastroVisto, tipoDoCadastro } from './cadastroVenda';
import { lerObraPrivada } from './jornadaObraBanco';
import { diaDeBrasilia } from '../agenda/viradaDoDia';

export interface DatasPosVenda { aniv: string | null; liberada: string | null }

let cacheDia = '';
const cache = new Map<number, DatasPosVenda>();
/** Para os testes. */
export function limparCachePosVenda(): void { cache.clear(); cacheDia = ''; }

/** "12/03/1985" vira "03-12"; data impossível ou fora de 1900 até hoje vira null. */
export function mmddDoNascimento(txt: unknown, hojeYmd: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(txt ?? '').trim());
  if (!m) return null;
  const [d, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ano < 1900 || ano > Number(hojeYmd.slice(0, 4)) || mes < 1 || mes > 12 || d < 1) return null;
  const real = new Date(Date.UTC(ano, mes - 1, d));
  if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== d) return null;
  return `${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** As datas da obra, do cache do dia. Erro de leitura sobe (quem chama decide; nada fica no cache). */
export async function lerDatasDoPosVenda(card: number, agora: Date = new Date()): Promise<DatasPosVenda> {
  const hoje = diaDeBrasilia(agora);
  if (hoje !== cacheDia) { cache.clear(); cacheDia = hoje; }
  const achada = cache.get(card);
  if (achada) return achada;
  const [cad, priv] = await Promise.all([lerCadastroVisto(card, 'vendasolar'), lerObraPrivada(card)]);
  const nasc = tipoDoCadastro(cad) === 'PJ' ? null : mmddDoNascimento(cad.campos.nascimento?.valor, hoje);
  const lib = priv?.liberacao?.passos?.liberada?.data ?? '';
  const dados: DatasPosVenda = { aniv: nasc, liberada: /^\d{4}-\d{2}-\d{2}$/.test(lib) ? lib : null };
  cache.set(card, dados);
  return dados;
}

/** A primeira palavra do nome do contratante do cadastro; sem cadastro, a do card. */
export async function primeiroNomeDaObra(card: number, nomeDoCard: string): Promise<string> {
  let nome = '';
  try { nome = String((await lerCadastroVisto(card, 'vendasolar')).campos.nome?.valor ?? '').trim(); } catch { /* usa o do card */ }
  const limpo = (nome || nomeDoCard).replace(/[*_~]/g, '').trim();
  return limpo.split(/\s+/)[0] ?? '';
}
