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
 * Quem declarou COMO paga, na ficha de NOTA 1.
 *
 * Os cinco slugs concordam com `CAD_CAPITAL_FICHA` da aba Cadastros do /gerador
 * — é a lista que o consultor tem na tela. `fin_banco` ("financiamento, ainda
 * não consultei o banco") entra: é intenção fraca de capital, mas é intenção de
 * capital, e sem ele cinco pessoas somem da tela inteira.
 *
 * ATENÇÃO: o placar público (`/parceria/placar`) e o `/admin/eletroposto-parceria`
 * ainda usam quatro slugs. Alinhar os três mexe no número que a página mostra
 * como prova social — é decisão do dono, não refactor.
 */
export const CAPITAL_DECLARADO = ['proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj', 'fin_banco'];
/** Ficha sem capital mas COM local: é o arrendador que a régua encontrou. */
const PONTO_NA_FICHA = ['definido', 'em_vista'];

/** Acima disso não é par, é outro mercado. */
export const TETO_KM = 400;
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
  tab: 'parceria' | 'nota1';
  id: number;
}

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Carrega um lado inteiro, das duas origens, já com coordenada quando dá. */
export async function pool(lado: Lado): Promise<Candidato[]> {
  const [cadastros, fichas] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade').eq('lado', lado).limit(500),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, capital_faixa, tem_ponto').limit(500),
  ]);

  const linhas: Candidato[] = [];
  const vistos = new Set<string>();

  for (const c of (cadastros.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(c.telefone);
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    linhas.push({ nome: String(c.nome || '—'), telefone: tel, cidade: (c.cidade as string) || null,
                  daFicha: false, tab: 'parceria', id: Number(c.id) });
  }

  // A ficha de NOTA 1 não se declarou de lado nenhum — quem a separa é o
  // cruzamento das duas respostas, a mesma régua da aba Cadastros. Cadastro
  // ganha da ficha: quem já se cadastrou não aparece duas vezes.
  for (const f of (fichas.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(f.telefone);
    if (!tel || vistos.has(tel)) continue;
    const cap = String(f.capital_faixa || '');
    const pto = String(f.tem_ponto || '');
    const serve = lado === 'capital'
      ? CAPITAL_DECLARADO.includes(cap)
      : cap === 'naosei' && PONTO_NA_FICHA.includes(pto);
    if (!serve) continue;
    vistos.add(tel);
    linhas.push({ nome: String(f.nome || '—'), telefone: tel, cidade: (f.cidade as string) || null,
                  daFicha: true, tab: 'nota1', id: Number(f.id) });
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
  const titulo = alvo === 'capital' ? '🤝 *INVESTIDORES MAIS PERTO*' : '📍 *PONTOS MAIS PERTO*';
  const nada = alvo === 'capital' ? 'investidor' : 'ponto';

  if (s.status === 'ok') {
    return ['', titulo, ...s.perto.map(c =>
      `• ${c.nome} — ${ondeEstá(c)} — wa.me/${c.telefone}${c.daFicha ? ' _(da ficha, nunca falamos)_' : ''}`)];
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
