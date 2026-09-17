// ─────────────────────────────────────────────────────────────────────────────
// TOP 20 PONTOS DO DIA, no WhatsApp do Thiago e do Diego, ao meio-dia.
//
// Ordem do Thiago (16/09/2026): "cria uma automação dos top 20 melhores pontos,
// todos os dias ao meio dia nós recebemos o top do WhatsApp". Entra todo mundo que
// tem ENDEREÇO, venha de onde vier, e sai ranqueado pela nota.
//
// ── As três fontes ──
//   · agendamentos (LP do eletroposto, com a linha "Endereço:"): a ficha inteira,
//     então a pré-nota sai completa. 161 hoje.
//   · eletroposto_nota1: quem não passou na régua mas deixou endereço. A ficha vem
//     em colunas (perfil_slug, tem_ponto, capital_faixa). 19 hoje.
//   · eletroposto_parceria (lado ponto): quem OFERECEU um ponto. Tem relação com o
//     local, tipo, vagas, fluxo e energia. 4 hoje, e são os mais quentes por metro
//     quadrado: a pessoa procurou a gente para ceder o espaço.
//
// ── A régua ──
// nota = 70% da pré-nota do local (ponto e controle, perfil, capital) + 30% do
// índice de mercado do município (adoção e tamanho da frota plug-in). O índice sai
// do arquivo do SENATRAN, então esta automação NÃO chama Google, NÃO chama IBGE e
// não custa nada além da mensagem. Quando o ponto já tem estudo pronto, o índice
// usado é o do estudo, que é mais fino (entorno e carregadores entram nele).
//
// ── O que ela não faz ──
// Não manda nada para o lead. Não muda status, nota nem agenda. Não repete: o
// carimbo do dia mora no system_state, então rodar duas vezes não manda duas.
//
// Kill-switch: EP_TOP_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { supabase } from '../../utils/supabase';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import { resolverCidade } from './geoCidade';
import { frotaDoMunicipio } from './eletropostoEstudoFontes';
import { listar, bancoConfigurado } from './eletropostoEstudoBanco';
import {
  dataCurtaBRT, extrairEndereco, extrairFicha, normalizarEndereco, notaDoLocal, preNota,
  primeiroNome, semAcentoMin, urlDoEstudo,
  type Ficha, type Perfil,
} from './eletropostoEstudoPuro';

export const EP_TOP_PREFIX = 'ep_top_pontos:';
export const QUANTOS = 20;
/** Link de estudo só nos primeiros: 20 links estouram o tamanho da mensagem. */
const COM_LINK = 10;

const desligado = (): boolean => (process.env.EP_TOP_OFF || '').trim() === '1';

/** Telefone como o `wa.me/` quer: só dígitos, com o país na frente. */
const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

export type FontePonto = 'reuniao' | 'parceria' | 'nota1';

export interface PontoRanqueado {
  fonte: FontePonto;
  id: number;
  nome: string;
  cidade: string;
  perfil: string;
  endereco: string;
  pre_nota: number;
  indice: number | null;
  nota: number;
  /** Tem local de verdade (definido, negociando ou em vista). Sem isso, o endereço
   *  é o da pessoa, não o do ponto, e ela vai para o fim da lista. */
  tem_ponto: boolean;
  detalhe: string;
  /** Só dígitos. Vira `wa.me/` na mensagem: ler o top e ter que caçar o telefone
   *  em outra tela é o que fazia a lista virar leitura em vez de ação. */
  telefone: string;
  /** O consultor com o card na mão. Só existe na fonte `reuniao` — ponto que veio
   *  de parceria ou de NOTA 1 não tem dono, e a mensagem diz isso com todas as
   *  letras: é justamente o ponto que ninguém está trabalhando. */
  dono?: string | null;
  estudo_url?: string;
  quando?: string | null;
  chave: string;
}

const PONTO_DE_VERDADE = new Set(['definido', 'negociando', 'em_vista']);
const temPontoDeVerdade = (f: Pick<Ficha, 'ponto'>): boolean => !!f.ponto && PONTO_DE_VERDADE.has(f.ponto);

// ── de cada fonte para a mesma ficha ───────────────────────────────────────

const PERFIL_ROTULO: Record<string, string> = {
  posto: 'Dono de posto', mercado: 'Mercado', restaurante: 'Restaurante', academia: 'Academia',
  farmacia: 'Farmácia', hotel: 'Hotel', estacionamento: 'Estacionamento', condominio: 'Condomínio',
  investidor: 'Investidor', outro: 'Outro',
};

const PERFIS: Perfil[] = ['posto', 'mercado', 'restaurante', 'academia', 'farmacia', 'hotel', 'estacionamento', 'condominio', 'investidor', 'outro'];

const perfilDoSlug = (s: string | null | undefined): Perfil | null =>
  (PERFIS.includes(String(s || '') as Perfil) ? (String(s) as Perfil) : null);

/** "Sou o proprietário" e afins, como a /parceria grava. */
function relacaoDoTexto(t: string | null | undefined): Ficha['relacao'] {
  const s = semAcentoMin(t);
  if (!s) return null;
  if (s.includes('propriet') && !s.includes('negoci') && !s.includes('represent')) return 'proprietario';
  if (s.includes('administr')) return 'administro';
  if (s.includes('represent')) return 'represento';
  if (s.includes('inquilino')) return 'inquilino';
  if (s.includes('alugar') || s.includes('comprar')) return 'nao_e_meu';
  return null;
}

/** O tipo do ponto que a /parceria grava ("Estacionamento", "Terreno em rota"). */
function perfilDoTipo(t: string | null | undefined): Perfil {
  const s = semAcentoMin(t);
  if (s.includes('posto')) return 'posto';
  if (s.includes('mercado') || s.includes('supermercado')) return 'mercado';
  if (s.includes('restaurante') || s.includes('lanchonete')) return 'restaurante';
  if (s.includes('academia')) return 'academia';
  if (s.includes('farmacia')) return 'farmacia';
  if (s.includes('hotel') || s.includes('pousada')) return 'hotel';
  if (s.includes('estacionamento')) return 'estacionamento';
  if (s.includes('condominio')) return 'condominio';
  return 'outro';   // terreno, galpão, qualquer coisa que a pessoa tenha escrito
}

const fichaVazia = (o: Partial<Ficha>): Ficha => ({
  perfil: null, perfil_texto: '', nota: null, pts: null, ponto: null, relacao: null, vagas: null,
  modelo: null, rota: null, invest: null, valor: null, decisor: null, trifasica: null, kw: null,
  carros: null, para_investidor: false, respostas: [], ...o,
});

// ── mercado do município, de graça ─────────────────────────────────────────

/** Índice só com o que o arquivo do SENATRAN responde: adoção e tamanho da frota. */
function indiceDaCidade(cidade: string): number | null {
  const c = resolverCidade(cidade);
  if (c.status !== 'ok' || !c.ibge || !c.uf) return null;
  const f = frotaDoMunicipio(c.ibge, c.uf);
  if (!f) return null;
  return notaDoLocal({
    plugin_mun: f.plugin, frota_mun: f.frota, plugin_br: f.plugin_br, frota_br: f.frota_br,
  }).valor;
}

const notaFinal = (pre: number, indice: number | null): number =>
  Math.round(indice == null ? pre * 0.7 : pre * 0.7 + indice * 10 * 0.3);

// ── leitura das três fontes ────────────────────────────────────────────────

type Linha = Record<string, unknown>;

async function lerReunioes(): Promise<Linha[]> {
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, cidade, observacao, quando, status, created_at, created_by, vendedor_nome')
    .eq('created_by', 'lp_eletroposto')
    .ilike('observacao', '%Endereço:%')
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) throw new Error(`agendamentos: ${error.message}`);
  return (data || []) as Linha[];
}

async function lerNota1(): Promise<Linha[]> {
  const { data, error } = await supabaseGerador.from('eletroposto_nota1')
    .select('id, nome, telefone, cidade, endereco, perfil_slug, tem_ponto, capital_faixa, created_at')
    .not('endereco', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(`nota1: ${error.message}`);
  return (data || []).filter(r => String((r as Linha).endereco || '').trim()) as Linha[];
}

async function lerParceria(): Promise<Linha[]> {
  const { data, error } = await supabaseGerador.from('eletroposto_parceria')
    .select('id, nome, telefone, cidade, ponto_endereco, ponto_relacao, ponto_tipo, ponto_vagas, ponto_fluxo, ponto_energia, created_at, lado')
    .eq('lado', 'ponto')
    .not('ponto_endereco', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(`parceria: ${error.message}`);
  return (data || []).filter(r => String((r as Linha).ponto_endereco || '').trim()) as Linha[];
}

const ultimos8 = (t: unknown) => String(t || '').replace(/\D/g, '').slice(-8);

/** Chave de duplicado: o endereço normalizado, e o telefone quando o endereço é curto demais. */
function chaveDoPonto(endereco: string, cidade: string, telefone: unknown): string {
  const e = extrairEndereco(`Endereço: ${endereco}`);
  const base = e ? normalizarEndereco(e) : semAcentoMin(endereco).replace(/[^a-z0-9]+/g, ' ').trim();
  const cid = semAcentoMin(cidade).replace(/[^a-z0-9]+/g, '');
  return base.replace(/\|$/, '').length > 4 ? `${base}@${cid}` : `tel:${ultimos8(telefone)}`;
}

// ── o ranking ──────────────────────────────────────────────────────────────

export async function montarTopPontos(quantos = QUANTOS): Promise<{ lista: PontoRanqueado[]; total: number; porFonte: Record<FontePonto, number> }> {
  const [reunioes, nota1, parceria] = await Promise.all([lerReunioes(), lerNota1(), lerParceria()]);

  // Estudo pronto dá um índice melhor (entorno e carregadores entram nele).
  const estudos = new Map<number, { indice: number | null; token: string }>();
  if (bancoConfigurado()) {
    try {
      const ids = reunioes.map(r => Number(r.id));
      for (const e of await listar('por_agendamentos', { ids, limite: 200 })) {
        estudos.set(Number(e.agendamento_id), { indice: e.indice == null ? null : Number(e.indice), token: e.token });
      }
    } catch (e) {
      logger.warn('ep-top', 'não leu os estudos, segue sem eles', String((e as Error)?.message || e).slice(0, 160));
    }
  }

  const porChave = new Map<string, PontoRanqueado>();
  const peso: Record<FontePonto, number> = { reuniao: 3, parceria: 2, nota1: 1 };
  const guardar = (p: PontoRanqueado) => {
    const antigo = porChave.get(p.chave);
    if (!antigo || p.nota > antigo.nota || (p.nota === antigo.nota && peso[p.fonte] > peso[antigo.fonte])) {
      porChave.set(p.chave, p);
    }
  };

  for (const r of reunioes) {
    const obs = String(r.observacao || '');
    const ficha = extrairFicha(obs);
    const end = extrairEndereco(obs);
    if (!end) continue;
    const cidade = String(r.cidade || end.cidade || '');
    const est = estudos.get(Number(r.id));
    const indice = est?.indice ?? indiceDaCidade(cidade);
    const pre = preNota(ficha).valor;
    const agendada = String(r.status || '') === 'agendado' && String(r.quando || '') > new Date().toISOString();
    guardar({
      fonte: 'reuniao', id: Number(r.id), nome: primeiroNome(String(r.cliente_nome || '')),
      cidade, perfil: ficha.perfil ? PERFIL_ROTULO[ficha.perfil] : (ficha.perfil_texto || 'Sem perfil'),
      endereco: `${end.rua}, ${end.numero} · ${end.bairro}`.replace(/,\s·/, ' ·'),
      pre_nota: pre, indice, nota: notaFinal(pre, indice), tem_ponto: temPontoDeVerdade(ficha),
      detalhe: agendada
        ? `Reunião ${dataCurtaBRT(String(r.quando))}`
        : `Ficha de reunião de ${dataCurtaBRT(String(r.created_at))}`,
      ...(est?.token ? { estudo_url: urlDoEstudo(est.token) } : {}),
      telefone: soDigitos(r.cliente_telefone),
      dono: String(r.vendedor_nome || '').trim() || null,
      quando: (r.quando as string) || null,
      chave: chaveDoPonto(`${end.rua}, ${end.numero} · ${end.bairro}`, cidade, r.cliente_telefone),
    });
  }

  for (const n of nota1) {
    const cidade = String(n.cidade || '');
    const ficha = fichaVazia({
      perfil: perfilDoSlug(n.perfil_slug as string),
      ponto: (['definido', 'negociando', 'em_vista', 'sem_ideia'].includes(String(n.tem_ponto)) ? String(n.tem_ponto) : null) as Ficha['ponto'],
      invest: (['proprio', 'proprio_credito', 'fin_aprovado', 'fin_cnpj', 'fin_banco', 'naosei'].includes(String(n.capital_faixa)) ? String(n.capital_faixa) : null) as Ficha['invest'],
    });
    const indice = indiceDaCidade(cidade);
    const pre = preNota(ficha).valor;
    guardar({
      fonte: 'nota1', id: Number(n.id), nome: primeiroNome(String(n.nome || '')), cidade,
      perfil: ficha.perfil ? PERFIL_ROTULO[ficha.perfil] : 'Sem perfil',
      endereco: String(n.endereco || '').slice(0, 80),
      pre_nota: pre, indice, nota: notaFinal(pre, indice), tem_ponto: temPontoDeVerdade(ficha),
      detalhe: `NOTA 1 de ${dataCurtaBRT(String(n.created_at))}${temPontoDeVerdade(ficha) ? '' : ' · sem ponto definido, o endereço é o do cliente'}`,
      telefone: soDigitos(n.telefone),
      chave: chaveDoPonto(String(n.endereco || ''), cidade, n.telefone),
    });
  }

  for (const p of parceria) {
    const cidade = String(p.cidade || '');
    const relacao = relacaoDoTexto(p.ponto_relacao as string);
    const negociando = semAcentoMin(p.ponto_relacao as string).includes('negoci');
    const ficha = fichaVazia({
      perfil: perfilDoTipo(p.ponto_tipo as string),
      ponto: relacao ? 'definido' : (negociando ? 'negociando' : null),
      relacao,
    });
    const indice = indiceDaCidade(cidade);
    const pre = preNota(ficha).valor;
    const extras = [p.ponto_vagas, p.ponto_fluxo].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
    guardar({
      fonte: 'parceria', id: Number(p.id), nome: primeiroNome(String(p.nome || '')), cidade,
      perfil: PERFIL_ROTULO[perfilDoTipo(p.ponto_tipo as string)],
      endereco: String(p.ponto_endereco || '').slice(0, 80),
      pre_nota: pre, indice, nota: notaFinal(pre, indice), tem_ponto: temPontoDeVerdade(ficha),
      detalhe: `Ponto oferecido em ${dataCurtaBRT(String(p.created_at))}${extras ? ` · ${extras}` : ''}`,
      telefone: soDigitos(p.telefone),
      chave: chaveDoPonto(String(p.ponto_endereco || ''), cidade, p.telefone),
    });
  }

  // Quem tem local de verdade vem primeiro, sempre. Endereço de quem ainda não sabe
  // onde instalar é a casa da pessoa, e casa não é ponto, por mais alta que seja a nota.
  const todos = [...porChave.values()].sort((a, b) =>
    (b.tem_ponto ? 1 : 0) - (a.tem_ponto ? 1 : 0)
    || b.nota - a.nota
    || (b.estudo_url ? 1 : 0) - (a.estudo_url ? 1 : 0)
    || peso[b.fonte] - peso[a.fonte]
    || b.pre_nota - a.pre_nota);

  const porFonte: Record<FontePonto, number> = { reuniao: 0, parceria: 0, nota1: 0 };
  for (const p of todos) porFonte[p.fonte]++;
  return { lista: todos.slice(0, quantos), total: todos.length, porFonte };
}

// ── a mensagem ─────────────────────────────────────────────────────────────

export function textoTopPontos(
  o: { lista: PontoRanqueado[]; total: number; porFonte: Record<FontePonto, number> },
  agoraMs: number,
): string {
  const linhas = [
    `*TOP ${o.lista.length} PONTOS · ${dataCurtaBRT(new Date(agoraMs).toISOString())}*`,
    `${o.total} pontos com endereço na base: ${o.porFonte.reuniao} de reunião, ${o.porFonte.parceria} de parceria, ${o.porFonte.nota1} de NOTA 1.`,
    'Nota = local (70%) e mercado da cidade (30%).',
    '',
  ];

  o.lista.forEach((p, i) => {
    const cabeca = `*${i + 1}. ${p.nota}* · ${p.perfil} · ${p.cidade || 'sem cidade'}`;
    // O detalhe já conta de onde vem: "Reunião 16/09", "Ponto oferecido em 12/09",
    // "NOTA 1 de 10/09". Repetir a fonte só encheria a linha.
    //
    // DE QUEM É (17/09/2026, ordem do Thiago). A lista mistura as três fontes, e
    // sem isto quem lê o top não sabe se pode agir: pode ser card do Diego, e dois
    // consultores ligando pra mesma pessoa é pior do que ninguém ligar. "Sem dono"
    // não é falta de dado, é a informação mais acionável da linha — é ponto que
    // ninguém está trabalhando.
    const deQuem = p.fonte === 'reuniao' ? (p.dono ? `com ${p.dono}` : 'sem consultor') : 'sem dono';
    const corpo = [p.nome, p.detalhe, deQuem].filter(Boolean).join(' · ');
    linhas.push(cabeca);
    linhas.push(`   ${corpo}`);
    // O WhatsApp em linha própria porque o `wa.me` vira botão clicável no app, e
    // grudado no texto ele deixa de ser link em parte dos aparelhos.
    if (p.telefone) linhas.push(`   wa.me/${p.telefone}`);
    if (p.estudo_url && i < COM_LINK) linhas.push(`   ${p.estudo_url}`);
  });

  linhas.push('');
  linhas.push('_Régua do estudo do local. Nada foi enviado ao cliente._');
  return linhas.join('\n');
}

// ── o tick diário ──────────────────────────────────────────────────────────

export interface ResultadoTop {
  enviados: number;
  erros: number;
  total: number;
  motivo?: string;
  previa?: Array<{ pos: number; nota: number; fonte: FontePonto; cidade: string; perfil: string }>;
  texto?: string;
}

/**
 * A resposta que pode sair da rota, sem dado de gente.
 *
 * O texto do top passou a levar nome e `wa.me/` do cliente em 17/09/2026, e a
 * rota `/cron/eletroposto-top-pontos` é chamada por um workflow cujo log é
 * PÚBLICO neste repositório. Então o texto nunca vai na resposta HTTP: ele existe
 * para virar mensagem no WhatsApp da equipe, e só.
 *
 * Virou função em vez de um `delete` solto na rota porque um `delete` não tem
 * teste. Esta tem.
 */
export function respostaPublicaDoTop(r: ResultadoTop): ResultadoTop {
  const { texto: _texto, ...resto } = r;
  return resto;
}

const diaBRT = (agoraMs: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(agoraMs));

export async function runEletropostoTopPontosTick(opts: { dry?: boolean; agora?: number } = {}): Promise<ResultadoTop> {
  if (desligado()) return { enviados: 0, erros: 0, total: 0, motivo: 'desligado' };

  const agora = opts.agora ?? Date.now();
  const chave = `${EP_TOP_PREFIX}${diaBRT(agora)}`;

  if (!opts.dry) {
    const { data: ja } = await supabase.from('system_state').select('key').eq('key', chave).maybeSingle();
    if (ja) return { enviados: 0, erros: 0, total: 0, motivo: 'ja_enviado_hoje' };
  }

  const top = await montarTopPontos();
  if (!top.lista.length) return { enviados: 0, erros: 0, total: 0, motivo: 'sem_ponto_com_endereco' };

  const texto = textoTopPontos(top, agora);
  if (opts.dry) {
    return {
      enviados: 0, erros: 0, total: top.total, motivo: 'dry', texto,
      previa: top.lista.map((p, i) => ({ pos: i + 1, nota: p.nota, fonte: p.fonte, cidade: p.cidade, perfil: p.perfil })),
    };
  }

  let enviados = 0;
  let erros = 0;
  for (const [nome, numero] of Object.entries(EQUIPE)) {
    try {
      await sendWhatsApp(String(numero).replace(/\D/g, ''), texto, 'io');
      enviados++;
    } catch (e) {
      erros++;
      logger.error('ep-top', 'top do dia não saiu', { para: nome, erro: String((e as Error)?.message || e).slice(0, 160) });
    }
  }

  // Carimba só se alguém recebeu: falha geral tem que poder tentar de novo.
  if (enviados) {
    const nowIso = new Date(agora).toISOString();
    await supabase.from('system_state').upsert(
      { key: chave, value: { enviado_em: nowIso, total: top.total, top: top.lista.length }, updated_at: nowIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) => logger.error('ep-top', 'carimbo do dia falhou', String(e)));
  }
  return { enviados, erros, total: top.total };
}
