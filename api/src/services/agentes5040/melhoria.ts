// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO SEMANAL DE MELHORIA DAS AGENTES. Toda segunda-feira (07:45 de Brasília, depois das duas rodadas da nota
// diária) um relógio lê as notas dos 7 dias anteriores (qualidade/<dia>/<hmac>.json), conta os problemas por agente e por
// tipo e pede à IA, UMA chamada por agente com problema, o texto novo da regra que trataria o que mais se repetiu. O
// relatório vai em `melhoria/<segunda>.json` (bucket privado do ensaio) e aparece na aba Ensaio do /gerador.
//
// É SÓ RELATÓRIO. Nada aqui muda a agente, o conhecimento dela, uma posse, uma ficha ou uma mensagem: a sugestão passa
// depois pelos testes, pela rodada com a IA e pelo chefe anti-ban. O arquivo não importa cliente de envio nem e-mail; o
// aviso por e-mail é ligado em routes/cron.ts.
//
// A SEMANA é a segunda-feira (AAAA-MM-DD, Brasília) em que o relatório sai; ele cobre os 7 dias antes dela (segunda a
// domingo). A nota da própria segunda e a da segunda anterior ficam de fora.
//
// DADOS. Telefone nunca aparece: a conversa é o HMAC. Todo texto livre (trecho de lead, explicação, regra proposta)
// passa por semTelefone ao ser gravado, e a tela só recebe os campos conhecidos (paraTela).
//
// FALHAS. Sem nenhuma chamada boa (teto, disjuntor, erro) NADA é gravado, para a próxima tentativa não ser barrada por
// "já existe". Com parte boa, o relatório vai com `falhou: [agentes]` e uma nova rodada (sem `forcar`) refaz só elas.
// Sem frase com crase nos textos: a crase fecha a string do template e o tsc passa.
// ─────────────────────────────────────────────────────────────────────────────

import { novoAnthropic } from '../../utils/anthropicClient';
import { gravarMelhoria, lerMelhoria, lerQualidadesDoDia } from './armazem';
import { clienteComCota, type EstadoCota } from './cota';
import { MODELO_PRINCIPAL, type ClienteIA } from './ia';
import { ligado } from './interruptores';
import { regrasDaCasa, semTelefone } from './personas/comum';
import { SISTEMA_FIXO_CARLA } from './personas/carla';
import { SISTEMA_FIXO_DUDA } from './personas/duda';
import { SISTEMA_FIXO_HELENA } from './personas/helena';
import { PRAZO_TOTAL_MS, TIPOS_PROBLEMA, type NotaGravadaQualidade, type TipoProblema } from './qualidade';
import { diaBRT, janelaDoDiaBRT } from './relogio';
import type { Persona } from './tipos';

// ── constantes ───────────────────────────────────────────────────────────────

export const AGENTES: readonly Persona[] = ['duda', 'carla', 'helena'];
/** Menos notas com problema do que isto na semana: relatório "poucos dados", sem chamar a IA. */
export const MINIMO_NOTAS_COM_PROBLEMA = 5;
export const MAX_EXEMPLOS_ENTRADA = 60;
export const MAX_ITENS = 3;
export const MAX_EXEMPLOS_POR_ITEM = 3;
const MAX_TOKENS_MELHORIA = 16_000;
const TIMEOUT_CHAMADA_MS = 120_000;
const MAX_REGRA = 600;
const MIN_REGRA = 20;

export const ROTULO_PROBLEMA: Readonly<Record<string, string>> = Object.freeze({
  passagem_incompleta: 'Passagem incompleta', fora_do_assunto: 'Fora do assunto', repetiu_pergunta: 'Repetiu pergunta',
  loop_nao_entendeu: 'Não entendeu e girou', alucinacao: 'Informação inventada', quebrou_regra: 'Quebrou regra',
  ficou_calada: 'Ficou calada', ignorou_pergunta: 'Ignorou pergunta', tom_errado: 'Tom errado', outro: 'Outro',
});

const NOME_DA_AGENTE: Record<Persona, string> = { duda: 'Duda', carla: 'Carla', helena: 'Helena' };
const PRODUTO_EM_TEXTO: Record<Persona, string> = {
  duda: 'energia solar (pré-venda; a consultora fecha)',
  carla: 'o SolarDoc, o sistema de propostas solares (vende o plano pelo WhatsApp)',
  helena: 'eletroposto, o carregador de carro elétrico (qualifica e leva o lead à reunião)',
};

// ── tipos ────────────────────────────────────────────────────────────────────

export interface ContagemAgente {
  /** Notas lidas da agente na semana. */
  notas: number;
  /** Notas com pelo menos um problema. */
  com_problema: number;
  /** Notas de qualidade crítica. */
  criticas: number;
  /** Conversas (notas) com cada tipo de problema. */
  por_tipo: Record<string, number>;
}

export interface ExemploItem { dia: string; hmac: string; trecho: string }

export interface ItemMelhoria {
  problema_tipo: TipoProblema;
  vezes: number;
  exemplos: ExemploItem[];
  regra_atual: string;
  /** false = a IA citou um trecho que não está no texto atual (a tela avisa). */
  regra_atual_confere: boolean;
  regra_proposta: string;
  onde: string;
  por_que: string;
}

export interface RelatorioMelhoria {
  semana: string;
  periodo: { de: string; ate: string };
  gerado_em: string;
  modelo: string | null;
  notas_lidas: number;
  notas_com_problema: number;
  por_agente: Record<string, ContagemAgente>;
  itens_por_agente: Record<string, ItemMelhoria[]>;
  poucos_dados?: true;
  /** Agentes cuja chamada falhou; uma nova rodada sem `forcar` refaz só elas. */
  falhou?: Persona[];
}

interface ProblemaLido {
  agente: Persona;
  tipo: TipoProblema;
  trecho: string;
  explicacao: string;
  dia: string;
  hmac: string;
  critica: boolean;
}

// ── a semana ─────────────────────────────────────────────────────────────────

const meioDia = (dia: string): number => Date.parse(`${dia}T12:00:00.000Z`);
/** Soma `n` dias a um AAAA-MM-DD (conta ao meio-dia UTC: nunca cai no dia errado). */
export const somarDias = (dia: string, n: number): string => new Date(meioDia(dia) + n * 86_400_000).toISOString().slice(0, 10);
const diaDaSemana = (dia: string): number => new Date(meioDia(dia)).getUTCDay();

/** A segunda-feira da semana de `dia` (a própria, se `dia` for segunda). */
export const segundaDe = (dia: string): string => somarDias(dia, -((diaDaSemana(dia) + 6) % 7));
export const ehSegunda = (dia: string): boolean => !!janelaDoDiaBRT(dia) && diaDaSemana(dia) === 1;
/** Os 7 dias que o relatório da segunda `semana` cobre: da segunda anterior ao domingo. */
export const diasDaSemana = (semana: string): string[] => Array.from({ length: 7 }, (_, i) => somarDias(semana, i - 7));

// ── agregação ────────────────────────────────────────────────────────────────

const ehAgente = (a: unknown): a is Persona => a === 'duda' || a === 'carla' || a === 'helena';
const tipoValido = (t: unknown): TipoProblema => ((TIPOS_PROBLEMA as readonly string[]).includes(String(t)) ? (t as TipoProblema) : 'outro');
const corta = (v: unknown, max: number): string => semTelefone(String(v ?? '').replace(/\s+/g, ' ').trim()).slice(0, max);

export interface Agregado {
  notasLidas: number;
  notasComProblema: number;
  porAgente: Record<string, ContagemAgente>;
  problemas: ProblemaLido[];
}

const contagemVazia = (): ContagemAgente => ({ notas: 0, com_problema: 0, criticas: 0, por_tipo: {} });

/** Conta as notas da semana: por agente e por tipo (cada tipo conta UMA vez por conversa). */
export function agregarNotas(porDia: ReadonlyArray<{ dia: string; notas: ReadonlyArray<{ hmac: string; nota: Partial<NotaGravadaQualidade> }> }>): Agregado {
  const porAgente: Record<string, ContagemAgente> = {};
  for (const a of AGENTES) porAgente[a] = contagemVazia();
  const problemas: ProblemaLido[] = [];
  let notasLidas = 0;
  let notasComProblema = 0;
  for (const { dia, notas } of porDia) {
    for (const { hmac, nota } of notas) {
      if (!nota || !ehAgente(nota.agente)) continue;
      notasLidas++;
      const c = porAgente[nota.agente]!;
      c.notas++;
      const critica = nota.qualidade === 'critica';
      if (critica) c.criticas++;
      const lista = Array.isArray(nota.problemas) ? nota.problemas : [];
      if (!lista.length) continue;
      c.com_problema++; notasComProblema++;
      const vistos = new Set<string>();
      for (const p of lista) {
        const tipo = tipoValido(p?.tipo);
        if (vistos.has(tipo)) continue;
        vistos.add(tipo);
        c.por_tipo[tipo] = (c.por_tipo[tipo] ?? 0) + 1;
        problemas.push({ agente: nota.agente, tipo, trecho: corta(p?.trecho, 200), explicacao: corta(p?.explicacao, 200), dia, hmac, critica });
      }
    }
  }
  return { notasLidas, notasComProblema, porAgente, problemas };
}

/**
 * Até MAX_EXEMPLOS_ENTRADA problemas como exemplos. Dentro de cada agente: tipo mais frequente primeiro, nota crítica
 * antes, dia mais novo antes. Entre agentes a escolha é alternada (um de cada por vez), para quem tem problema nunca
 * ficar sem exemplo por causa de outra.
 */
export function escolherExemplos(agregado: Agregado, max = MAX_EXEMPLOS_ENTRADA): Record<string, ProblemaLido[]> {
  const filas = AGENTES.map(a => {
    const freq = agregado.porAgente[a]?.por_tipo ?? {};
    const lista = agregado.problemas.filter(p => p.agente === a).sort((x, y) =>
      (freq[y.tipo] ?? 0) - (freq[x.tipo] ?? 0) || Number(y.critica) - Number(x.critica)
      || (x.dia < y.dia ? 1 : x.dia > y.dia ? -1 : 0) || (x.hmac < y.hmac ? -1 : 1));
    return { agente: a, lista };
  });
  const saida: Record<string, ProblemaLido[]> = { duda: [], carla: [], helena: [] };
  let total = 0;
  for (let rodada = 0; total < max; rodada++) {
    let algum = false;
    for (const f of filas) {
      const p = f.lista[rodada];
      if (!p || total >= max) continue;
      saida[f.agente]!.push(p); total++; algum = true;
    }
    if (!algum) break;
  }
  return saida;
}

/** Os 3 tipos com mais conversas, somando as agentes. */
export function topTipos(porAgente: Record<string, ContagemAgente>, n = 3): Array<{ tipo: string; vezes: number }> {
  const soma: Record<string, number> = {};
  for (const c of Object.values(porAgente)) for (const [t, v] of Object.entries(c.por_tipo)) soma[t] = (soma[t] ?? 0) + v;
  return Object.entries(soma).map(([tipo, vezes]) => ({ tipo, vezes })).sort((a, b) => b.vezes - a.vezes || (a.tipo < b.tipo ? -1 : 1)).slice(0, n);
}

// ── o texto atual das regras ─────────────────────────────────────────────────

const SISTEMA_FIXO: Record<Persona, string> = { duda: SISTEMA_FIXO_DUDA, carla: SISTEMA_FIXO_CARLA, helena: SISTEMA_FIXO_HELENA };
/** Os mesmos argumentos com que cada persona monta o bloco das regras comuns (personas/*.ts). */
const ARGS_COMUM: Record<Persona, [string, string, boolean]> = {
  duda: ['da Irmãos na Obra', 'Sou a IA da Irmãos na Obra, sim.', true],
  carla: ['do SolarDoc', 'Sou a IA do SolarDoc, sim.', false],
  helena: ['da Irmãos na Obra', 'Sou a IA da Irmãos na Obra, sim.', true],
};

export const arquivoDaPersona = (a: Persona): string => `personas/${a}.ts`;
export const ARQUIVO_COMUM = 'personas/comum.ts';
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** O texto da persona (sem o bloco comum, que já vem dentro dele) e o das regras comuns. Só leitura, só texto. */
export function textosDasRegras(agente: Persona): { persona: string; comum: string } {
  const comum = regrasDaCasa(...ARGS_COMUM[agente]);
  const inteiro = SISTEMA_FIXO[agente];
  const persona = inteiro.includes(comum) ? inteiro.replace(comum, '(as regras comuns estão no bloco do arquivo personas/comum.ts, abaixo)') : inteiro;
  return { persona, comum };
}

// ── o prompt ─────────────────────────────────────────────────────────────────

export const SISTEMA_MELHORIA = [
  'Você é o revisor semanal das regras das agentes de IA de WhatsApp da Irmãos na Obra. Você NÃO fala com cliente e NÃO muda nada sozinho: você só escreve sugestões de texto de regra, que uma pessoa vai testar antes de aceitar.',
  '',
  'O QUE VOCÊ RECEBE',
  '- A agente (nome e produto), a contagem de conversas da semana por tipo de problema e exemplos reais: dia, código da conversa (hmac), tipo, nota crítica ou não, trecho literal e a explicação do auditor.',
  '- O texto atual das regras, em dois blocos: o arquivo da persona e o arquivo das regras comuns (personas/comum.ts).',
  '',
  'O QUE VOCÊ FAZ',
  '- Escolha até 3 tipos de problema, os que mais se repetiram e mais custaram (conversa crítica pesa mais). Um item por tipo. Só tipos que aparecem na contagem.',
  '- problema_tipo: o nome exato do tipo. vezes: quantas conversas tiveram esse tipo, como na contagem.',
  '- exemplos: até 3 dos exemplos recebidos, copiando dia e hmac exatamente como vieram e o trecho curto.',
  '- regra_atual: copie LITERALMENTE, sem mudar uma palavra, o trecho do texto atual que trata disso (uma frase ou um item de lista). Se nenhuma regra trata disso, deixe vazio.',
  '- regra_proposta: o texto novo da regra, pronto para colar no lugar do trecho atual (ou ao lado dele, se não havia regra). Específico: diga o que a agente faz, não só o que evita.',
  '- onde: o arquivo onde a regra mora. Se o trecho atual está no bloco das regras comuns, personas/comum.ts; senão o arquivo da persona.',
  '- por_que: UMA frase ligando a regra ao problema visto.',
  '- Se os exemplos são erro isolado, ou a regra atual já cobre e a agente só falhou em obedecer, devolva menos itens, ou a lista vazia. Não invente problema.',
  '',
  'ESTILO DA regra_proposta (igual ao das regras atuais)',
  '- Frase curta, como nas regras atuais, começando com letra maiúscula.',
  '- Sem travessão, nem o longo nem o médio: use vírgula, ponto ou dois-pontos.',
  '- Sem emoji. Sem preço, valor em reais, percentual ou prazo novo.',
  '- Sem o caractere de crase e sem cifrão seguido de chave: o texto vai dentro de uma string de código e isso quebraria o arquivo.',
  '- Sem nome, telefone ou dado de cliente. Fale de "o cliente", nunca de uma pessoa.',
  '',
  'LIMITES QUE NUNCA MUDAM',
  '- Nunca proponha que a agente negue ser IA ou diga que é pessoa.',
  '- Nunca afrouxe a regra de pedido para parar (opt-out), a de pausa quando uma pessoa do time entra na conversa, nem a de passagem para uma pessoa.',
  '- Nunca proponha que a agente abra conversa, cobre resposta ou faça mais de uma pergunta por vez.',
  '',
  'Responda só o JSON pedido.',
].join('\n');

const texto = { type: 'string' };

/** json_schema estrito: sem maxItems nem maxLength (a saída estrita não garante), os cortes são feitos em lerItensIA. */
export function schemaDaAgente(agente: Persona): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            problema_tipo: { type: 'string', enum: [...TIPOS_PROBLEMA] },
            vezes: { type: 'integer' },
            exemplos: {
              type: 'array',
              items: { type: 'object', properties: { dia: texto, hmac: texto, trecho: texto }, required: ['dia', 'hmac', 'trecho'], additionalProperties: false },
            },
            regra_atual: texto,
            regra_proposta: texto,
            onde: { type: 'string', enum: [arquivoDaPersona(agente), ARQUIVO_COMUM] },
            por_que: texto,
          },
          required: ['problema_tipo', 'vezes', 'exemplos', 'regra_atual', 'regra_proposta', 'onde', 'por_que'],
          additionalProperties: false,
        },
      },
    },
    required: ['itens'],
    additionalProperties: false,
  };
}

export function pedidoDeMelhoria(agente: Persona, semana: string, contagem: ContagemAgente, exemplos: readonly ProblemaLido[]): string {
  const { persona, comum } = textosDasRegras(agente);
  const tipos = Object.entries(contagem.por_tipo).sort((a, b) => b[1] - a[1]).map(([t, v]) => `- ${t}: ${v} conversa${v === 1 ? '' : 's'}`);
  const linhas = exemplos.map(e => `- dia ${e.dia} | hmac ${e.hmac} | ${e.tipo} | ${e.critica ? 'nota crítica' : 'nota com problema'} | trecho: "${e.trecho}" | explicação: ${e.explicacao}`);
  return [
    `Semana que termina antes da segunda ${semana}. Agente: ${NOME_DA_AGENTE[agente]}, de ${PRODUTO_EM_TEXTO[agente]}.`,
    `Conversas avaliadas da agente na semana: ${contagem.notas}. Com problema: ${contagem.com_problema}. Críticas: ${contagem.criticas}.`,
    '',
    'CONTAGEM POR TIPO DE PROBLEMA (conversas)',
    ...tipos,
    '',
    'EXEMPLOS (os mais frequentes e os críticos primeiro)',
    ...linhas,
    '',
    `TEXTO ATUAL DAS REGRAS, ARQUIVO ${arquivoDaPersona(agente)}`,
    '<<<',
    persona,
    '>>>',
    '',
    `TEXTO ATUAL DAS REGRAS COMUNS, ARQUIVO ${ARQUIVO_COMUM}`,
    '<<<',
    comum,
    '>>>',
    '',
    'Devolva as sugestões no formato pedido.',
  ].join('\n');
}

// ── ler e conferir o que a IA devolveu ───────────────────────────────────────

const RE_TRAVESSAO = /\s*[—–]\s*/g;
const RE_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}⃣️]/u;
/** Valor em dinheiro, percentual (o número inteiro) e prazo (em N dias, N horas...): só passa o que já está no texto atual. */
const RE_VALOR = /r\s*\$\s*[\d.,]+|\$\s*[\d.,]+|\d[\d.,]*\s*reais\b|\d[\d.,]*\s*%|\bem\s+\d[\d.,]*\s*(?:dias?|horas?|minutos?|semanas?|mes(?:es)?)\b|\b\d[\d.,]*\s*horas?\b/gi;
/** Menor trecho de regra_atual que vale como citação literal: abaixo disso qualquer palavra comum "confere". */
export const MIN_REGRA_ATUAL = 15;
/** Proposta que manda negar ser IA: nunca passa, qualquer que seja o jeito de escrever. */
const RE_NEGA_IA = /\b(?:negue|negar|negando|neg[ae]r?)\b[^.]{0,40}\b(?:ia|rob[oô]|intelig[eê]ncia artificial)\b|diga que (?:é|e|você é|voce e)\s+(?:uma\s+)?(?:pessoa|humano|humana|gente)|n[aã]o (?:diga|admita|assuma|confirme)[^.]{0,30}\b(?:ia|rob[oô])\b/i;

/** Limpa a regra para colar no código: sem travessão, sem crase, sem cifrão-chave, sem telefone, com maiúscula. */
export function limparRegra(bruta: unknown): string {
  let t = String(bruta ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(RE_TRAVESSAO, ', ').replace(/`/g, "'").replace(/\$\{/g, '{');
  t = semTelefone(t).replace(/,\s*,/g, ',').trim();
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : '';
}

interface ContextoDaLeitura {
  agente: Persona;
  contagem: ContagemAgente;
  /** O que foi mostrado à IA como exemplo. */
  exemplos: readonly ProblemaLido[];
  /** Todo problema da semana da agente, para completar um item sem exemplo válido. */
  todos: readonly ProblemaLido[];
}

function exemploConferido(e: { dia?: unknown; hmac?: unknown }, mostrados: readonly ProblemaLido[], tipo: TipoProblema): ProblemaLido | null {
  const dia = String(e?.dia ?? '').trim();
  const h = String(e?.hmac ?? '').trim().toLowerCase();
  if (!dia || h.length < 8) return null;
  const casam = mostrados.filter(m => m.dia === dia && m.hmac.startsWith(h));
  return casam.find(m => m.tipo === tipo) ?? casam[0] ?? null;
}

/** O valor, percentual ou prazo já aparece no texto atual (sem espaços, com o número inteiro: 50% não casa com 150% nem com 10%)? */
export function valorJaExiste(v: string, atuais: string): boolean {
  const k = v.toLowerCase().replace(/\s/g, '').replace(/[.,]+$/, '').replace(/^em(?=\d)/, '');
  const literal = k.replace(/[.*+?^$(){}|[\]\\]/g, c => '\\' + c);
  return new RegExp('(?<![0-9.,])' + literal).test(atuais);
}

/** Lê o JSON da IA. Item fora das regras sai; o resto é cortado e limpo. [] = a IA não achou o que propor (ou veio torto). null = formato inválido. */
export function lerItensIA(bruto: string, c: ContextoDaLeitura): ItemMelhoria[] | null {
  let j: unknown;
  try { j = JSON.parse(String(bruto ?? '').trim()); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray((j as { itens?: unknown }).itens)) return null;
  const { persona, comum } = textosDasRegras(c.agente);
  const nPersona = norm(persona); const nComum = norm(comum);
  const atuais = `${nPersona} ${nComum}`.toLowerCase().replace(/\s/g, '');
  const itens: ItemMelhoria[] = [];
  const tiposVistos = new Set<TipoProblema>();
  for (const bruto2 of (j as { itens: unknown[] }).itens) {
    if (itens.length >= MAX_ITENS) break;
    const o = (bruto2 && typeof bruto2 === 'object' ? bruto2 : {}) as Record<string, unknown>;
    const tipo = (TIPOS_PROBLEMA as readonly string[]).includes(String(o.problema_tipo)) ? (o.problema_tipo as TipoProblema) : null;
    const vezes = tipo ? (c.contagem.por_tipo[tipo] ?? 0) : 0;
    if (!tipo || vezes < 1 || tiposVistos.has(tipo)) continue;
    // a regra proposta
    const proposta = limparRegra(o.regra_proposta).slice(0, MAX_REGRA);
    if (proposta.length < MIN_REGRA || RE_EMOJI.test(proposta) || RE_NEGA_IA.test(proposta)) continue;
    // valor em dinheiro, só se já existe no texto atual (o preço de hoje); preço novo nunca
    const valores = proposta.match(RE_VALOR) ?? [];
    if (valores.some(v => !valorJaExiste(v, atuais))) continue;
    // a regra atual: tem que estar de verdade no texto atual
    const atualBruta = limparRegraAtual(o.regra_atual);
    const literal = atualBruta.length >= MIN_REGRA_ATUAL;
    const naComum = literal && nComum.includes(atualBruta);
    const naPersona = literal && nPersona.includes(atualBruta);
    const confere = atualBruta === '' || naComum || naPersona;
    const ondeIA = String(o.onde ?? '');
    const onde = naComum ? ARQUIVO_COMUM : naPersona ? arquivoDaPersona(c.agente)
      : ondeIA === ARQUIVO_COMUM ? ARQUIVO_COMUM : arquivoDaPersona(c.agente);
    // os exemplos: só os que a IA recebeu; o trecho vem do nosso dado, não do que ela copiou
    const exemplos: ExemploItem[] = [];
    const usados = new Set<string>();
    const poe = (p: ProblemaLido | null): void => {
      if (!p || exemplos.length >= MAX_EXEMPLOS_POR_ITEM) return;
      const k = `${p.dia}|${p.hmac}`;
      if (usados.has(k)) return;
      usados.add(k); exemplos.push({ dia: p.dia, hmac: p.hmac, trecho: p.trecho });
    };
    for (const e of Array.isArray(o.exemplos) ? o.exemplos : []) poe(exemploConferido((e ?? {}) as Record<string, unknown>, c.exemplos, tipo));
    if (!exemplos.length) for (const p of c.todos.filter(x => x.tipo === tipo)) poe(p);
    tiposVistos.add(tipo);
    itens.push({
      problema_tipo: tipo, vezes, exemplos,
      regra_atual: confere ? corta(o.regra_atual, MAX_REGRA) : '',
      regra_atual_confere: confere,
      regra_proposta: proposta, onde, por_que: corta(o.por_que, 240),
    });
  }
  return itens.sort((a, b) => b.vezes - a.vezes);
}

/** A regra atual como o texto que a IA recebeu a vê: espaços normalizados. */
const limparRegraAtual = (v: unknown): string => norm(String(v ?? ''));

// ── a rodada ─────────────────────────────────────────────────────────────────

export interface OpcoesMelhoria {
  /** Só conta (lê as notas): não chama a IA, não grava, passa por cima do interruptor. */
  dry?: boolean;
  agora?: Date;
  /** A segunda-feira (AAAA-MM-DD, Brasília). Padrão: a segunda da semana de `agora`. */
  semana?: string;
  /** Refaz o relatório que já existe. */
  forcar?: boolean;
  /** Cliente da IA (testes passam um falso). Padrão: o SDK de verdade. */
  cliente?: ClienteIA;
}

export interface ResultadoMelhoria {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  semana: string;
  motivo?: string;
  /** Já havia relatório desta semana. */
  existe: boolean;
  /** Pulou porque o relatório existe (e não veio forcar). */
  pulou: boolean;
  poucosDados: boolean;
  notasLidas: number;
  notasComProblema: number;
  /** Agentes que teriam (dry) ou receberam (rodada) uma chamada. */
  agentesComProblema: Persona[];
  chamadasIA: number;
  /** Gravou um relatório novo nesta rodada. */
  gravou: boolean;
  /** A semana NÃO tinha relatório antes desta rodada e agora tem (completar um com `falhou` ou refazer com `forcar` não conta). */
  novo: boolean;
  /** Itens de melhoria no relatório gravado. */
  itens: number;
  falhou: Persona[];
  top3: Array<{ tipo: string; vezes: number }>;
  parou: EstadoCota['parou'] | null;
}

const vazio = (dry: boolean, semana: string, extra: Partial<ResultadoMelhoria> = {}): ResultadoMelhoria => ({
  ok: true, ligado: true, dry, semana, existe: false, pulou: false, poucosDados: false, notasLidas: 0, notasComProblema: 0,
  agentesComProblema: [], chamadasIA: 0, gravou: false, novo: false, itens: 0, falhou: [], top3: [], parou: null, ...extra,
});

const codigoDe = (e: unknown): string => String((e as { code?: string; codigo?: string } | null)?.codigo ?? (e as { code?: string } | null)?.code ?? 'interno').slice(0, 20);

/** Lê as notas dos 7 dias, um dia por vez. */
async function lerSemana(semana: string): Promise<Agregado> {
  const porDia: Array<{ dia: string; notas: Array<{ hmac: string; nota: Partial<NotaGravadaQualidade> }> }> = [];
  for (const dia of diasDaSemana(semana)) porDia.push({ dia, notas: await lerQualidadesDoDia<Partial<NotaGravadaQualidade>>(dia) });
  return agregarNotas(porDia);
}

/**
 * Uma rodada semanal. Nunca lança: erro vira { ok:false, motivo }. Idempotente: com relatório da semana pronto (e sem
 * `forcar`) pula; relatório que ficou com agentes `falhou` é completado só para elas.
 */
export async function runMelhoriaTick(opts: OpcoesMelhoria = {}): Promise<ResultadoMelhoria> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const forcar = opts.forcar === true;
  const inicio = Date.now();
  const semana = opts.semana ?? segundaDe(diaBRT(agora));
  try {
    if (!ehSegunda(semana)) return vazio(dry, semana, { ok: false, motivo: 'semana inválida: precisa ser uma segunda-feira (AAAA-MM-DD)' });
    // Desligado: nenhuma leitura. O dry é só leitura e passa por cima do interruptor (como o da nota diária).
    if (!dry && !(await ligado('qualidade'))) return vazio(dry, semana, { ligado: false, motivo: 'interruptor qualidade desligado' });

    const existente = await lerMelhoria<RelatorioMelhoria>(semana);
    const existe = !!existente;
    const pendentes: Persona[] | null = existente && !forcar ? (Array.isArray(existente.falhou) ? existente.falhou.filter(ehAgente) : []) : null;
    if (!dry && existente && !forcar && !pendentes!.length) return vazio(dry, semana, { existe, pulou: true, motivo: 'o relatório da semana já existe' });

    const agregado = await lerSemana(semana);
    const comProblema = AGENTES.filter(a => (agregado.porAgente[a]?.com_problema ?? 0) > 0);
    const base = vazio(dry, semana, {
      existe, notasLidas: agregado.notasLidas, notasComProblema: agregado.notasComProblema, agentesComProblema: comProblema,
      top3: topTipos(agregado.porAgente),
    });
    const poucos = agregado.notasComProblema < MINIMO_NOTAS_COM_PROBLEMA;
    if (dry) return { ...base, poucosDados: poucos };

    const periodo = { de: diasDaSemana(semana)[0]!, ate: diasDaSemana(semana)[6]! };
    const semItens = (): Record<string, ItemMelhoria[]> => ({ duda: [], carla: [], helena: [] });

    // 1. poucos dados: relatório sem IA
    if (poucos) {
      const rel: RelatorioMelhoria = {
        semana, periodo, gerado_em: new Date().toISOString(), modelo: null, notas_lidas: agregado.notasLidas,
        notas_com_problema: agregado.notasComProblema, por_agente: agregado.porAgente, itens_por_agente: semItens(), poucos_dados: true,
      };
      const r = await gravarMelhoria(semana, rel, forcar || existe);
      return { ...base, poucosDados: true, gravou: r === 'gravado', novo: r === 'gravado' && !existe };
    }

    // 2. uma chamada por agente com problema (ou só pelas pendentes de uma rodada anterior)
    const alvos = pendentes && pendentes.length ? comProblema.filter(a => pendentes.includes(a)) : comProblema;
    const exemplos = escolherExemplos(agregado);
    const clienteBase: ClienteIA = opts.cliente ?? (novoAnthropic() as unknown as ClienteIA);
    const { cliente, estado } = clienteComCota('melhoria', () => agora, clienteBase, inicio + PRAZO_TOTAL_MS);
    const resultados = await Promise.all(alvos.map(async (agente): Promise<{ agente: Persona; itens: ItemMelhoria[] | null }> => {
      const mostrados = exemplos[agente] ?? [];
      try {
        const resposta: any = await cliente.messages.create({
          model: MODELO_PRINCIPAL,
          max_tokens: MAX_TOKENS_MELHORIA,
          system: [{ type: 'text', text: SISTEMA_MELHORIA }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaDaAgente(agente) } },
          messages: [{ role: 'user', content: [{ type: 'text', text: pedidoDeMelhoria(agente, semana, agregado.porAgente[agente]!, mostrados) }] }],
        }, { timeout: TIMEOUT_CHAMADA_MS, maxRetries: 0 });
        const parada = String(resposta?.stop_reason ?? '');
        if (parada === 'refusal' || parada === 'max_tokens') return { agente, itens: null };
        const textoIA = (Array.isArray(resposta?.content) ? resposta.content : []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('');
        const itens = lerItensIA(textoIA, {
          agente, contagem: agregado.porAgente[agente]!, exemplos: mostrados, todos: agregado.problemas.filter(p => p.agente === agente),
        });
        return { agente, itens };
      } catch (e) {
        if (!estado.parou) console.warn('[agentes5040] melhoria: chamada à IA falhou', String((e as { message?: string })?.message ?? e).slice(0, 80));
        return { agente, itens: null };
      }
    }));
    const chamadasIA = estado.chamadas;
    const boas = resultados.filter(r => r.itens !== null);
    const falhou = resultados.filter(r => r.itens === null).map(r => r.agente);
    const comEstado = { ...base, chamadasIA, parou: estado.parou, agentesComProblema: alvos };
    // Nenhuma chamada boa: nada é gravado, a próxima tentativa não é barrada por "já existe".
    if (alvos.length && !boas.length) {
      return { ...comEstado, ok: !!estado.parou, falhou, motivo: estado.parou ? `a IA não rodou: ${estado.parou}` : 'a IA não devolveu sugestões' };
    }

    // 3. monta e grava
    const itensPorAgente = semItens();
    if (pendentes && pendentes.length && existente) for (const a of AGENTES) itensPorAgente[a] = existente.itens_por_agente?.[a] ?? [];
    for (const r of boas) itensPorAgente[r.agente] = r.itens!;
    const rel: RelatorioMelhoria = {
      semana, periodo, gerado_em: new Date().toISOString(), modelo: MODELO_PRINCIPAL, notas_lidas: agregado.notasLidas,
      notas_com_problema: agregado.notasComProblema, por_agente: agregado.porAgente, itens_por_agente: itensPorAgente,
      ...(falhou.length ? { falhou } : {}),
    };
    const g = await gravarMelhoria(semana, rel, forcar || existe);
    const itens = boas.reduce((n, r) => n + r.itens!.length, 0);
    return { ...comEstado, gravou: g === 'gravado', novo: g === 'gravado' && !existe, itens: g === 'gravado' ? itens : 0, falhou };
  } catch (e) {
    console.error('[agentes5040] melhoria falhou', codigoDe(e));
    return vazio(dry, semana, { ok: false, motivo: 'a rodada falhou' });
  }
}

// ── o e-mail (montado aqui, enviado só em routes/cron.ts) ────────────────────

export const ASSUNTO_EMAIL = 'Agentes 5040: melhorias da semana';
const dm = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** Corpo curto do e-mail: quantas notas, os 3 problemas mais frequentes e onde ver. Só números e rótulos: nada de trecho nem de conversa. */
export function corpoDoEmail(semana: string, notasLidas: number, top3: ReadonlyArray<{ tipo: string; vezes: number }>): string {
  const ds = diasDaSemana(semana);
  const lista = top3.map(t => `<li>${ROTULO_PROBLEMA[t.tipo] ?? 'Outro'}: ${t.vezes} ${t.vezes === 1 ? 'conversa' : 'conversas'}</li>`).join('');
  return [
    `<p>Notas lidas de ${dm(ds[0]!)} a ${dm(ds[6]!)}: ${notasLidas}.</p>`,
    '<p>Os problemas que mais se repetiram:</p>',
    `<ul>${lista}</ul>`,
    '<p>Veja na aba Ensaio do /gerador.</p>',
  ].join('');
}

// ── o que a tela recebe ──────────────────────────────────────────────────────

const HMAC64 = /^[0-9a-f]{64}$/;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const numero = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

/** Só os campos conhecidos, com os textos limpos de telefone. Telefone não existe no relatório; aqui é a segunda trava. */
export function paraTela(bruto: unknown): Record<string, unknown> | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const r = bruto as Partial<RelatorioMelhoria>;
  if (!DIA_ISO.test(String(r.semana ?? ''))) return null;
  const por_agente: Record<string, unknown> = {};
  const itens_por_agente: Record<string, unknown[]> = {};
  for (const a of AGENTES) {
    const c = r.por_agente?.[a];
    por_agente[a] = {
      notas: numero(c?.notas), com_problema: numero(c?.com_problema), criticas: numero(c?.criticas),
      por_tipo: Object.fromEntries(Object.entries(c?.por_tipo ?? {}).map(([k, v]) => [String(k).slice(0, 40), numero(v)])),
    };
    itens_por_agente[a] = (Array.isArray(r.itens_por_agente?.[a]) ? r.itens_por_agente![a]! : []).slice(0, MAX_ITENS).map(i => ({
      problema_tipo: String(i?.problema_tipo ?? 'outro').slice(0, 40),
      vezes: numero(i?.vezes),
      exemplos: (Array.isArray(i?.exemplos) ? i.exemplos : []).slice(0, MAX_EXEMPLOS_POR_ITEM)
        .filter(e => HMAC64.test(String(e?.hmac ?? '')) && DIA_ISO.test(String(e?.dia ?? '')))
        .map(e => ({ dia: String(e.dia), hmac: String(e.hmac), trecho: corta(e.trecho, 200) })),
      regra_atual: corta(i?.regra_atual, MAX_REGRA),
      regra_atual_confere: i?.regra_atual_confere !== false,
      regra_proposta: corta(i?.regra_proposta, MAX_REGRA),
      onde: String(i?.onde ?? '').slice(0, 40),
      por_que: corta(i?.por_que, 240),
    }));
  }
  return {
    semana: r.semana, periodo: r.periodo && DIA_ISO.test(String(r.periodo.de)) && DIA_ISO.test(String(r.periodo.ate)) ? { de: r.periodo.de, ate: r.periodo.ate } : null,
    gerado_em: String(r.gerado_em ?? '').slice(0, 40), modelo: r.modelo ? String(r.modelo).slice(0, 60) : null,
    notas_lidas: numero(r.notas_lidas), notas_com_problema: numero(r.notas_com_problema), por_agente, itens_por_agente,
    poucos_dados: r.poucos_dados === true, falhou: (Array.isArray(r.falhou) ? r.falhou : []).filter(ehAgente),
  };
}
