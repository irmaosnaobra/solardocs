// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO — o funil, ponta a ponta, atravessando os dois bancos.
//
// Toque e resposta vivem no GERADOR. Visita, checkout e venda vivem no
// SOLARDOC-PRO. Este arquivo é o único lugar que costura os dois.
//
// Por que aqui e não na tela: a chave pública do solardoc-pro enxerga `sales`
// inteiro — nome, e-mail e telefone de cliente. Uma tela pública lendo aquilo
// direto seria vazamento. Daqui sai só CONTAGEM: nenhum nome, nenhum e-mail,
// nenhum telefone atravessa a fronteira.
//
// A CHAVE QUE LIGA OS DOIS LADOS é `utm_content`: o link que a agente manda
// carrega os 8 primeiros caracteres do id do contato. Sem isso dá pra saber
// que "alguém da prospecção visitou", nunca QUEM.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

const LOG = 'prospeccao-funil';
export const UTM_SOURCE = 'prospeccao';

/** O pedaço do id do contato que viaja na URL. 8 hex em ~1.300 contatos: a
 *  chance de dois colidirem é desprezível, e cabe numa UTM sem virar poluição. */
export const tokenDoContato = (id: string) => String(id).replace(/-/g, '').slice(0, 8);

export interface Etapa {
  nome: string;
  valor: number | null;   // null = não dá pra medir ainda (nunca 0 disfarçado)
  sub?: string;
  de?: string;            // de onde sai o número, pra tela não precisar adivinhar
}
export interface Funil { produto: string; titulo: string; etapas: Etapa[]; obs?: string }

async function contar(
  cliente: typeof supabase, tabela: string, f: (q: any) => any,
): Promise<number | null> {
  try {
    const { count, error } = await f(cliente.from(tabela).select('*', { count: 'exact', head: true }));
    if (error) { logger.error(LOG, `contar ${tabela}`, error); return null; }
    return count ?? null;
  } catch (err) { logger.error(LOG, `contar ${tabela} explodiu`, err); return null; }
}

/** Contatos DISTINTOS com um desfecho — não toques. Três follow-ups no mesmo
 *  contato são um lead no funil, não três. */
async function contatosCom(resultados: string[], produtoId?: string): Promise<number | null> {
  try {
    let q = supabaseGerador.from('prospeccao_toques').select('contato_id').in('resultado', resultados);
    if (produtoId) q = q.eq('produto_id', produtoId);
    const { data, error } = await q.limit(20000);
    if (error) { logger.error(LOG, 'contatosCom', error); return null; }
    return new Set((data ?? []).map(r => r.contato_id)).size;
  } catch (err) { logger.error(LOG, 'contatosCom explodiu', err); return null; }
}

/** Sessões que chegaram na LP vindas da prospecção, e o que fizeram lá. */
async function ladoDaLp(desde: string) {
  try {
    const { data: visitas, error } = await supabase
      .from('page_visits').select('session_id, utm_content')
      .eq('utm_source', UTM_SOURCE).gte('created_at', desde).limit(20000);
    if (error) throw error;

    const sessoes = new Set((visitas ?? []).map(v => v.session_id).filter(Boolean));
    // utm_content é o token do contato: dá pra dizer QUANTAS EMPRESAS distintas
    // clicaram, e não só quantas abas abriram.
    const empresas = new Set((visitas ?? []).map(v => v.utm_content).filter(Boolean));
    if (!sessoes.size) return { sessoes: 0, empresas: 0, leram: 0, checkout: 0 };

    const ids = [...sessoes];
    const { data: ev } = await supabase
      .from('lp_events').select('session_id, event_type')
      .in('session_id', ids.slice(0, 1000)).limit(20000);

    const porTipo = (t: string) =>
      new Set((ev ?? []).filter(e => e.event_type === t).map(e => e.session_id)).size;

    return {
      sessoes: sessoes.size,
      empresas: empresas.size,
      // "visitou de verdade" = rolou a página. Abrir e fechar não é visita.
      leram: porTipo('scroll') || porTipo('section') || porTipo('time_on_page'),
      checkout: porTipo('cta_click'),
    };
  } catch (err) { logger.error(LOG, 'lado da LP', err); return null; }
}

export async function montarFunil(dias = 90): Promise<{ gerado_em: string; funis: Funil[] }> {
  const desde = new Date(Date.now() - dias * 86400_000).toISOString();

  const [
    baseAlvo, semSite, recebeu, responderam, interessados, lp, vendasProsp,
    siteInteresse, siteVendeu,
  ] = await Promise.all([
    contar(supabaseGerador as any, 'prospeccao_contatos', (q: any) => q.in('classe', ['integradora', 'misto'])),
    contar(supabaseGerador as any, 'prospeccao_contatos',
      (q: any) => q.in('classe', ['integradora', 'misto']).or('site.is.null,site.eq.')),
    contatosCom(['enviei', 'respondeu', 'interessado', 'vendeu', 'sem_interesse', 'nao_perturbar']),
    contatosCom(['respondeu', 'interessado', 'vendeu']),
    contatosCom(['interessado', 'vendeu']),
    ladoDaLp(desde),
    contar(supabase as any, 'sales', (q: any) => q.eq('utm_source', UTM_SOURCE).gte('created_at', desde)),
    contatosCom(['interessado', 'vendeu'], 'site'),
    contatosCom(['vendeu'], 'site'),
  ]);

  const solardoc: Funil = {
    produto: 'solardoc',
    titulo: 'SolarDoc · venda 100% online pela agente',
    etapas: [
      { nome: 'Leads na base',        valor: baseAlvo,            de: 'integradoras e mistas classificadas' },
      { nome: 'Recebeu mensagem',     valor: recebeu,             de: 'contatos com toque registrado' },
      { nome: 'Respondeu',            valor: responderam,         de: 'respondeu, interessado ou comprou' },
      { nome: 'Demonstrou interesse', valor: interessados,        de: 'pediu preço ou pediu pra ver' },
      { nome: 'Clicou no link',       valor: lp ? lp.empresas : null,
        sub: lp ? `${lp.sessoes} aberturas` : undefined, de: 'empresas distintas em page_visits' },
      { nome: 'Leu a página',         valor: lp ? lp.leram : null, de: 'rolou a LP — abrir e fechar não conta' },
      { nome: 'Foi pro checkout',     valor: lp ? lp.checkout : null, de: 'clicou no botão de compra' },
      { nome: 'Comprou',              valor: vendasProsp,         de: 'venda com utm_source=prospeccao' },
    ],
    obs: 'A agente vende sozinha: da primeira mensagem ao checkout, sem consultor no meio.',
  };

  const site: Funil = {
    produto: 'site',
    titulo: 'Site do integrador · R$ 1.890 · encaminha pra atendimento',
    etapas: [
      { nome: 'Não tem site',          valor: semSite,       de: 'sem site no cadastro do Maps' },
      { nome: 'Tem interesse',         valor: siteInteresse, de: 'toque de site com interesse' },
      { nome: 'Recebeu o material',    valor: null,          sub: 'não é medido ainda — falta marcar o envio', de: '—' },
      { nome: 'Contratou',             valor: siteVendeu,    de: 'toque de site com venda' },
      { nome: 'Recebeu o site pronto', valor: null,          sub: 'não é medido ainda — falta marcar a entrega', de: '—' },
    ],
    obs: 'Ticket alto não fecha por DM: a agente qualifica e encaminha pro seu atendimento.',
  };

  return { gerado_em: new Date().toISOString(), funis: [solardoc, site] };
}
