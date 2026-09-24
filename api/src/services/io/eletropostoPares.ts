// ─────────────────────────────────────────────────────────────────────────────
// QUEM ESTÁ PERTO DE QUEM — a dica de par no aviso da equipe.
//
// Entrou um ponto? o aviso já diz quais investidores estão perto dele.
// Entrou um investidor? diz quais pontos. É o que transforma "chegou cadastro"
// em "liga pra esses dois".
//
// POR QUE OS N MAIS PRÓXIMOS, E NÃO "MESMA UF":
// mesma UF é proximidade de mentira num país deste tamanho. O balde BA junta
// Lauro de Freitas com Vitória da Conquista (500 km); o MG entregaria Miradouro
// a 662 km como "perto". E raio fixo tem o problema inverso: 300 km devolve
// sete nomes em São Paulo e um em Manaus — mede densidade, não responde "quem eu
// ligo". Então: os mais próximos, EM ORDEM, com a distância escrita do lado, e
// um teto de 400 km só pra não chamar de par quem está em outro estado longe.
//
// A DICA É ENFEITE; O CADASTRO É O FATO. Se a cidade não resolve, se o pool está
// vazio, se qualquer coisa aqui falha — o aviso sai igual, só sem o bloco.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { resolverCidade, distanciaKm } from './geoCidade';

/**
 * Acima disso não é par, é outro mercado.
 *
 * 200 km é o número do Thiago (18/08). É UM número só, e ele vale nos três
 * lugares — o aviso no WhatsApp, a coluna "quem está perto" e a lista de match.
 * Dois tetos diferentes fariam a mensagem citar alguém que a tela não considera
 * par, e ninguém entenderia por quê.
 *
 * O que ele custa, com a base de hoje: 22 pares a 400 km viram 10 a 200 km. Os
 * que caem não somem da tela — aparecem como "o mais perto está a X km, longe
 * demais pra chamar de par", que é informação, não silêncio.
 */
export const TETO_KM = 200;
/** Três nomes cabem numa mensagem de WhatsApp sem virar lista. */
export const MAX_PARES = 3;

export type Lado = 'capital' | 'ponto';

export interface Candidato {
  nome: string;
  telefone: string;
  cidade: string | null;
  /** Onde a pessoa está, resolvido — não o que ela digitou. */
  municipio?: string;
  uf?: string;
  km?: number;
  lat?: number;
  lng?: number;
  /** De onde a linha veio, pra equipe saber se a pessoa se cadastrou ou não. */
  daFicha: boolean;
  /** 'agenda' = o consultor marcou ARRENDAMENTO no card. O mesmo nome curto que a
   *  aba Cadastros do /gerador usa (CAD_ORIGEM), porque os pares chegam por ele. */
  tab: 'parceria' | 'nota1' | 'agenda';
  id: number;
}

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// PRA ONDE CADA PESSOA VAI (regra do dono, 21/09/2026)
//
// Duas respostas decidem, e so elas:
//   1. O local e seu?      -> pode ceder (dono, inquilino, representante) ou nao
//   2. Quanto investe?     -> R$ 50 mil ou mais / abaixo / nao disse
// e o resultado:
//   PODE CEDER                         -> ARRENDAMENTO (ponto)
//   nao pode, declarou >= R$ 50 mil    -> INVESTIDORES (capital)
//   nao pode, abaixo ou NAO DISSE      -> CURIOSO (a equipe liga e pergunta; quem
//                                         responde um valor volta pra Investidores)
//
// "Pode ceder" e o contrato de arrendamento (Cl. 16.1): proprietario, inquilino
// com anuencia do dono, administrador ou representante com poderes. Quem
// "negocia com o proprietario" ou "ainda nao e dono" nao assina.
//
// O PISO E R$ 50 MIL ("de 50 mil pra cima", o dono, 21/09/2026). Comecou em 70,
// o menor ingresso da LP, e desceu quando a conta mostrou 26 cadastros com "Ate
// R$ 50 mil" parados no Curioso. Numa faixa vale o TETO, entao "Ate R$ 50 mil"
// alcanca o piso e "R$ 50 a 100 mil" tambem. O numero e UM so: PISO_INVESTIDOR_MIL
// aqui e CAD_PISO_MIL no /gerador, e o teste gemeo prova que os dois concordam.
//
// ESTA REGRA TEM GEMEA em cadDestino() no /gerador (aba Cadastros). Mudar uma sem
// a outra faz a aba listar alguem que o Match nao oferece, ou o contrario.
// ─────────────────────────────────────────────────────────────────────────────
export type Destino = 'ponto' | 'capital' | 'curioso';

/** Tem poder de ceder o local? A ordem importa: "negociando com o PROPRIETARIO"
 *  e "ainda nao e meu" contem palavras de dono sem ser dono. */
export function podeCeder(relacao: unknown): boolean {
  const t = String(relacao ?? '').toLowerCase();
  if (!t || /ainda n[aã]o [eé] meu|negoci|em vista|n[aã]o conversei/.test(t)) return false;
  return /propriet|inquilin|represent|administr/.test(t);
}

/**
 * O valor declarado, em MIL reais, ou null quando a pessoa nao disse. Le os tres
 * jeitos que o valor chega: opcao da LP ("R$ 140 mil"), faixa do cadastro
 * ("R$ 50 mil a R$ 100 mil", "Ate R$ 50 mil") e resposta livre no WhatsApp
 * ("uns 100k", "R$ 70.000", "1,5 milhao"). Numa faixa vale o TETO: quem diz
 * "ate 100 mil" topa o piso. "Menos de" fica logo abaixo do numero.
 */
export function valorEmMil(texto: unknown): number | null {
  const t = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || /depende/.test(t)) return null;
  const nums = numerosEmMil(t);
  if (!nums.length) return null;
  const teto = Math.max(...nums);
  return /menos de|abaixo de/.test(t) ? teto - 0.01 : teto;
}

/** Todos os numeros do texto, em MIL reais ("70.000" = 70, "1,5 milhao" = 1500). */
export function numerosEmMil(texto: unknown): number[] {
  const t = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nums: number[] = [];
  const re = /(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(milh[aãoõ]es|milh[aã]o|mi\b|mil|k\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const bruto = m[1];
    const unid = m[2] || '';
    let n: number;
    if (/[.\s]\d{3}$/.test(bruto) && !/,/.test(bruto)) n = Number(bruto.replace(/[.\s]/g, ''));
    else n = Number(bruto.replace(',', '.'));
    if (!isFinite(n)) continue;
    if (/milh|^mi$/.test(unid)) n = n * 1000;          // milhao -> mil
    else if (unid === 'mil' || unid === 'k') { /* ja esta em mil */ }
    else if (n >= 1000) n = n / 1000;                   // "70000" -> 70
    nums.push(n);
  }
  return nums;
}

/** O piso de Investidores, em mil reais. Gemeo de CAD_PISO_MIL no /gerador. */
export const PISO_INVESTIDOR_MIL = 50;

/** Declarou o piso ou mais? true / false (declarou abaixo) / null (nao disse).
 *  "Menos de X" e um TETO: com X acima do piso ele nao prova nada ("Menos de R$ 70
 *  mil", a opcao antiga do Registrar valor, pode ser 10 mil), entao e "nao disse". */
export function valorOk(texto: unknown): boolean | null {
  const v = valorEmMil(texto);
  if (v === null) return null;
  if (/menos de|abaixo de/.test(String(texto).toLowerCase()) && v >= PISO_INVESTIDOR_MIL) return null;
  return v >= PISO_INVESTIDOR_MIL;
}

/** O "Local e seu:" e o "Quanto pretende investir:" moram no TEXTO da ficha. */
const campoDaFicha = (ficha: unknown, rotulo: RegExp): string | null => {
  const m = String(ficha ?? '').match(rotulo);
  return m ? m[1].trim() : null;
};

/** Pra onde a linha vai, nas quatro origens. */
export function destinoDe(origem: 'parceria' | 'nota1' | 'agenda', r: Record<string, unknown>): Destino {
  // O consultor marcou ARRENDAMENTO no card e disse de quem e o local.
  if (origem === 'agenda') return 'ponto';
  if (origem === 'parceria') {
    if (r.lado === 'ponto' && podeCeder(r.ponto_relacao)) return 'ponto';
    return valorOk(r.capital_faixa) ? 'capital' : 'curioso';
  }
  // ficha da LP: o valor registrado pelo consultor ganha do texto da ficha
  if (podeCeder(campoDaFicha(r.ficha, /Local (?:é|e) seu:\s*([^\n]+)/i))) return 'ponto';
  const valor = r.valor_investir || campoDaFicha(r.ficha, /Quanto pretende investir:\s*([^\n]+)/i);
  return valorOk(valor) ? 'capital' : 'curioso';
}

/** Uma linha de qualquer das tres origens, com os campos crus da tabela. */
export interface LinhaOrigem { origem: 'parceria' | 'nota1' | 'agenda'; r: Record<string, unknown> }

/**
 * Cada TELEFONE no seu melhor destino: Arrendamento > Investidores > Curioso.
 * Dentro do destino ganha a primeira linha da lista, que chega na ordem da aba:
 * cadastro > ficha > agenda, a mais nova primeiro. Linha sem telefone fica no
 * proprio destino, sem dedupe.
 *
 * GEMEO do agrupamento em cadCarregar() no /gerador: o teste eletropostoDestino
 * roda os dois lado a lado. E ele que garante que a aba Curioso e a lista que
 * recebe a pergunta do valor sao as mesmas pessoas.
 */
export function agruparPorDestino(linhas: LinhaOrigem[]): Record<Destino, LinhaOrigem[]> {
  const PESO: Record<Destino, number> = { ponto: 0, capital: 1, curioso: 2 };
  const tel = (l: LinhaOrigem) => soDigitos(l.origem === 'agenda' ? l.r.cliente_telefone : l.r.telefone);
  const comDestino = linhas.map(l => ({ l, d: destinoDe(l.origem, l.r) }));
  const melhor = new Map<string, Destino>();
  for (const { l, d } of comDestino) {
    const t = tel(l);
    if (t && (!melhor.has(t) || PESO[d] < PESO[melhor.get(t)!])) melhor.set(t, d);
  }
  const saida: Record<Destino, LinhaOrigem[]> = { ponto: [], capital: [], curioso: [] };
  const vistos = new Set<string>();
  for (const { l, d } of comDestino) {
    const t = tel(l);
    if (t) {
      if (vistos.has(t) || melhor.get(t) !== d) continue;
      vistos.add(t);
    }
    saida[d].push(l);
  }
  return saida;
}

export interface ContatoCurioso {
  telefone: string;
  nome: string | null;
  cidade: string | null;
  status: string | null;
  /** 'nota1:123' ou 'parceria:45': a linha onde a resposta do valor vai ser gravada. */
  ref: string;
}

/**
 * Quem esta no CURIOSO agora: a mesma leitura e o mesmo agrupamento da aba.
 *
 * Erro de leitura SOBE, nunca vira lista vazia. Lista vazia faria o motor de
 * Avisos concluir a pauta como "todos receberam" sem ter mandado nada, que e a
 * pior falha possivel ali: parece sucesso.
 */
export async function curiosos(): Promise<ContatoCurioso[]> {
  // 1000 e o teto de linhas da API do Supabase; a aba le com o mesmo numero.
  const [cad, fic, ag] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade, lado, ponto_relacao, capital_faixa, status, created_at')
      .in('lado', ['ponto', 'capital']).order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, ficha, valor_investir, status, created_at')
      .order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('agendamentos')
      .select('id, cliente_telefone, created_at').eq('status', 'arrendamento')
      .order('created_at', { ascending: false }).limit(1000),
  ]);
  if (cad.error) throw new Error(`curiosos: leitura dos cadastros falhou: ${cad.error.message}`);
  if (fic.error) throw new Error(`curiosos: leitura das fichas falhou: ${fic.error.message}`);
  if (ag.error) throw new Error(`curiosos: leitura da agenda falhou: ${ag.error.message}`);
  const linhas: LinhaOrigem[] = [
    ...((cad.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'parceria' as const, r })),
    ...((fic.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'nota1' as const, r })),
    ...((ag.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'agenda' as const, r })),
  ];
  return agruparPorDestino(linhas).curioso.map(({ origem, r }) => ({
    telefone: soDigitos(r.telefone),
    nome: (r.nome as string) || null,
    cidade: (r.cidade as string) || null,
    status: (r.status as string) || null,
    ref: `${origem}:${r.id}`,
  }));
}

/**
 * Carrega um lado inteiro, das três origens, já com coordenada quando dá.
 *
 * `jaNoOutroLado` existe por um motivo específico: uma pessoa PODE estar nos dois
 * lados (tem o terreno E o dinheiro — o cadastro permite, a chave é lado+telefone).
 * Sem cruzar os telefones entre as duas chamadas, ela viraria par DELA MESMA,
 * a 0 km, no topo da fila do Match — que é onde o erro é mais visível e mais
 * constrangedor. O lado do PONTO ganha a disputa: é o ativo escasso.
 */
export async function pool(lado: Lado, jaNoOutroLado?: Set<string>): Promise<Candidato[]> {
  // As tres origens inteiras: quem decide o lado e destinoDe(), nao o filtro do
  // banco. Um cadastro de "ponto" que ainda negocia o local, e declarou dinheiro,
  // e INVESTIDOR — so a regra enxerga isso. A ORDEM (mais novo primeiro) e a da aba
  // Cadastros: quando o mesmo telefone tem duas linhas no mesmo destino, as duas
  // telas escolhem a mesma, e a coluna "perto" acha a linha que a tela mostra.
  const [cadastros, fichas, agenda] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade, lado, ponto_relacao, capital_faixa')
      .in('lado', ['ponto', 'capital']).order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, ficha, valor_investir')
      .order('created_at', { ascending: false }).limit(1000),
    // ARRENDAMENTO MARCADO NA AGENDA (21/09): sempre ponto — o consultor ja
    // perguntou de quem e o local ao marcar.
    lado === 'ponto'
      ? supabaseGerador.from('agendamentos')
          .select('id, cliente_nome, cliente_telefone, cidade').eq('status', 'arrendamento')
          .order('created_at', { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const linhas: Candidato[] = [];
  // Nasce com quem já está do outro lado: ninguém aparece nos dois pools.
  const vistos = new Set<string>(jaNoOutroLado || []);

  for (const c of (cadastros.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(c.telefone);
    if (!tel || vistos.has(tel)) continue;
    if (destinoDe('parceria', c) !== lado) continue;
    vistos.add(tel);
    linhas.push({ nome: String(c.nome || '—'), telefone: tel, cidade: (c.cidade as string) || null,
                  daFicha: false, tab: 'parceria', id: Number(c.id) });
  }

  // A ficha de NOTA 1 nao se declarou de lado nenhum: quem a separa e
  // destinoDe(), a mesma regra da aba Cadastros. Cadastro ganha da ficha.
  for (const f of (fichas.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(f.telefone);
    if (!tel || vistos.has(tel)) continue;
    if (destinoDe('nota1', f) !== lado) continue;
    vistos.add(tel);
    linhas.push({ nome: String(f.nome || '—'), telefone: tel, cidade: (f.cidade as string) || null,
                  daFicha: true, tab: 'nota1', id: Number(f.id) });
  }

  // A agenda vem por ULTIMO no mesmo `vistos`: cadastro > ficha > agenda. Quem ja
  // esta no pool por outro caminho nao entra de novo (e a linha rica ganha).
  for (const a of (agenda.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(a.cliente_telefone);
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    linhas.push({ nome: String(a.cliente_nome || '—'), telefone: tel, cidade: (a.cidade as string) || null,
                  daFicha: false, tab: 'agenda', id: Number(a.id) });
  }

  for (const l of linhas) {
    const g = resolverCidade(l.cidade);
    if (g.status === 'ok') { l.lat = g.lat; l.lng = g.lng; l.municipio = g.municipio; l.uf = g.uf; }
  }
  return linhas;
}

export interface Sugestao {
  /** 'ok' tem pares; os outros explicam POR QUE não tem, e isso vai pra mensagem. */
  status: 'ok' | 'longe' | 'sem_mapa' | 'pool_vazio';
  perto: Candidato[];
  /** O mais próximo mesmo estando fora do teto — vira a frase do caso 'longe'. */
  maisProximo?: Candidato;
  motivo?: string;
}

/**
 * Quem do lado `alvo` está perto de `cidadeTexto`.
 * `excluirTelefone` tira a própria pessoa quando ela existe nos dois lados.
 */
export async function sugerirPares(
  cidadeTexto: string | null | undefined,
  alvo: Lado,
  excluirTelefone?: string,
): Promise<Sugestao> {
  const eu = resolverCidade(cidadeTexto);
  const candidatos = (await pool(alvo))
    .filter(c => c.telefone !== soDigitos(excluirTelefone));

  if (!candidatos.length) return { status: 'pool_vazio', perto: [] };

  if (eu.status !== 'ok') {
    // Não sei onde ESTE lead está. O aviso diz isso em vez de calar — é a
    // diferença entre "não tem ninguém perto" e "não consegui medir".
    return { status: 'sem_mapa', perto: [], motivo: eu.motivo };
  }

  const comMapa = candidatos.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number');
  // Tem gente do outro lado, mas de NINGUÉM eu sei a cidade. Não é pool vazio
  // (a frase "ninguém cadastrado ainda" seria mentira com 45 pessoas na base) e
  // não é "longe" (não medi distância nenhuma) — é o mesmo caso de não saber
  // medir, só que do outro lado.
  if (!comMapa.length) {
    return { status: 'sem_mapa', perto: [],
             motivo: `nenhum dos ${candidatos.length} do outro lado tem cidade que eu consiga localizar` };
  }
  for (const c of comMapa) {
    c.km = distanciaKm({ lat: eu.lat!, lng: eu.lng! }, { lat: c.lat!, lng: c.lng! });
  }
  comMapa.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));

  const perto = comMapa.filter(c => (c.km ?? 1e9) <= TETO_KM).slice(0, MAX_PARES);
  if (perto.length) return { status: 'ok', perto };
  return { status: 'longe', perto: [], maisProximo: comMapa[0] };
}

/** "Uberlândia-MG (mesma cidade)" · "Araguari-MG (44 km)" */
function ondeEstá(c: Candidato): string {
  const lugar = c.municipio && c.uf ? `${c.municipio}-${c.uf}` : (c.cidade || '—');
  if (c.km === 0) return `${lugar} (mesma cidade)`;
  return `${lugar} (${c.km} km)`;
}

/**
 * As linhas da dica dentro do aviso. Bloco CONDICIONAL na mesma mensagem —
 * nunca um segundo `sendWhatsApp`: dobrar o toque na linha pra entregar isto
 * seria gastar o dobro pra dizer menos.
 */
export function blocoPares(s: Sugestao, alvo: Lado): string[] {
  // Sem emoji: este bloco entra DENTRO do aviso, e lá o emoji é só da primeira
  // linha (a regra está em montarAvisoPonto). Um símbolo aqui viraria o segundo
  // da mensagem e roubaria o cabeçalho, que é o que separa ponto de investidor.
  const titulo = alvo === 'capital' ? '*INVESTIDORES MAIS PERTO*' : '*PONTOS MAIS PERTO*';
  const nada = alvo === 'capital' ? 'investidor' : 'ponto';

  if (s.status === 'ok') {
    return ['', titulo, ...s.perto.map(c =>
      `• ${c.nome} — ${ondeEstá(c)} — wa.me/${c.telefone}${c.daFicha ? ' _(da ficha, nunca falamos)_'
        : c.tab === 'agenda' ? ' _(marcado ARRENDAMENTO na agenda)_' : ''}`)];
  }
  if (s.status === 'longe' && s.maisProximo) {
    return ['', `_O ${nada} mais perto é ${s.maisProximo.nome}, em ${ondeEstá(s.maisProximo)}. `
              + `Longe demais pra chamar de par._`];
  }
  if (s.status === 'sem_mapa') {
    return ['', `_Não consegui localizar a cidade no mapa (${s.motivo || 'sem motivo'}) — sem sugestão de par._`];
  }
  return ['', `_Nenhum ${nada} cadastrado ainda — este lead entra na fila._`];
}

/** Nunca deixa a dica derrubar o aviso: erro aqui vira bloco vazio. */
export async function blocoParesSeguro(
  cidadeTexto: string | null | undefined,
  alvo: Lado,
  excluirTelefone?: string,
): Promise<string[]> {
  try {
    return blocoPares(await sugerirPares(cidadeTexto, alvo, excluirTelefone), alvo);
  } catch (err) {
    logger.error('eletroposto-pares', 'falha montando a dica de pares', err);
    return [];
  }
}
