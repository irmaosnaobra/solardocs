// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO SOLAR NO AGENTE (20/10/2026)
//
// Os dois contratos do Fechamento solar do /gerador entram no assistente de contrato:
//   solar_m1  Completo (15 cláusulas, partes CONTRATADA e CONTRATANTE)
//   solar_m2  Padrão (14 cláusulas, partes CONTRATADA e CLIENTE)
// Emitente sempre a AIOROS GROUP LTDA, marca Irmãos na Obra. A NEXUS nunca aparece no contrato solar.
//
// Este arquivo guarda o que é só do solar: a ficha de cada modelo para o prompt, a lista dos itens travados (o contrato
// de chaves com o front) e a checagem de conflito. Os solares NÃO entram em híbrido nem no /contrato/redesenhar.
//
// A checagem de conflito do solar NÃO usa `conflitosDoPlano`: o contrato solar tem de propósito uma multa de rescisão e uma
// multa por interrupção, e a checagem de multa do eletroposto trataria isso como duplicata e bloquearia o contrato de fábrica.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ehForoClausula, ehForoItem, semAcento,
  type ClausulaMod, type ConflitoDetectado, type ItemMod, type TipoHibrido,
} from './contratoHibrido';

export const EMPRESA_SOLAR = 'AIOROS GROUP LTDA (marca Irmãos na Obra)';

export const FICHA_SOLAR = {
  solar_m1: 'solar_m1: contrato COMPLETO de fornecimento e instalação de sistema de energia solar fotovoltaica (15 cláusulas). Partes: CONTRATADA (a AIOROS GROUP LTDA, marca Irmãos na Obra) e CONTRATANTE (o cliente). Cobre: objeto e especificações, qualificação das partes, etapas dos serviços (visita técnica, projeto, aquisição, instalação, comissionamento, homologação), prazos (projeto, aprovação da concessionária, instalação), valor e pagamento, garantias (módulos e inversor do fabricante, instalação, bateria se houver), obrigações do contratante, homologação junto à concessionária, desempenho (a geração é ESTIMATIVA, nunca garantia), entrega e vistoria técnica, manutenção, rescisão, disposições gerais e foro. Travado: partes e qualificação, tabela de especificações do sistema, valor, forma de pagamento, assinaturas.',
  solar_m2: 'solar_m2: contrato PADRÃO de serviços de instalação de usina fotovoltaica (14 cláusulas). Partes: CONTRATADA (a AIOROS GROUP LTDA, marca Irmãos na Obra) e CLIENTE (o cliente; neste modelo ele se chama CLIENTE, não CONTRATANTE). Cobre: objeto e componentes, prazos (projeto, aprovação, instalação), valor e pagamento, garantias e manutenção, obrigações do cliente, rescisão, disposições gerais, desempenho e geração (ESTIMATIVA, nunca garantia), manutenção preventiva e corretiva, vistoria técnica, transferência, responsabilidades ambientais, multa por interrupção não autorizada e foro. Travado: partes e quadro-resumo, valor, forma de pagamento, componentes do sistema, local da instalação, assinaturas.',
} as const;

/**
 * Chaves que o modelo de cláusulas do Fechamento TEM de usar: o servidor protege o que é travado e descarta a operação de
 * texto sobre o item que nasce de um campo mudado no mesmo turno (`itens` em contratoAgenteCampos.ts). Chave de cláusula
 * = prefixo antes do ponto. Itens com campo (não travados): prazos.projeto, prazos.aprovacao, prazos.obra, garantias.*, foro.comarca.
 */
export const ITENS_TRAVADOS_SOLAR: Record<'solar_m1' | 'solar_m2', string[]> = {
  solar_m1: ['partes.contratada', 'partes.contratante', 'qualificacao.contratada', 'qualificacao.contratante', 'objeto.sistema', 'preco.valor', 'preco.forma', 'assinaturas.fecho'],
  solar_m2: ['partes.contratada', 'partes.cliente', 'partes.resumo', 'partes.qualificacao', 'objeto.sistema', 'objeto.componentes', 'objeto.local', 'preco.valor', 'preco.forma', 'assinaturas.fecho'],
};

/**
 * Defesa em profundidade: o servidor protege estes itens pela CHAVE, mesmo que o front não mande `travado: true`.
 * `clausula` é o prefixo antes do ponto; remover ou renomear uma cláusula que tem item travado também não vale.
 */
export function itemTravadoSolar(tipo: string, key: string | null | undefined): boolean {
  const lista = ITENS_TRAVADOS_SOLAR[tipo as 'solar_m1' | 'solar_m2'];
  return !!key && !!lista && lista.includes(key);
}
export function clausulaComTravadoSolar(tipo: string, chaveClausula: string | null | undefined): boolean {
  const lista = ITENS_TRAVADOS_SOLAR[tipo as 'solar_m1' | 'solar_m2'];
  return !!chaveClausula && !!lista && lista.some(k => k.startsWith(chaveClausula + '.'));
}

/** O contrato solar é da AIOROS (Irmãos na Obra): a NEXUS não pode aparecer no texto. */
export const mencionaNexus = (...textos: Array<string | null | undefined>): boolean =>
  textos.some(t => /\bnexus\b/.test(semAcento(t)));

// ── Geração tratada como garantia ────────────────────────────────────────────
// A geração do contrato solar é ESTIMATIVA. A frase que a promete ("garante geração mínima de 700 kWh") contradiz a cláusula
// de desempenho. Roda sobre texto sem acento. Frase com negação ("não constitui garantia de geração") passa, e a garantia
// de desempenho do FABRICANTE dos módulos (degradação linear) também.
// "Geração" aqui é produzir energia: gerar, geração, produção, energia gerada, kWh por mês ou por ano, economia, ou desempenho
// medido contra a estimativa, o kWh ou um percentual. NÃO é capacidade de bateria ("5 kWh") nem desempenho genérico.
const GERA_NO_TEXTO = new RegExp([
  '\\bger(?:ar|a|ara|arao)\\b', 'geracao', 'producao', '\\bproduz\\w*', 'energia gerada', 'economia',
  '\\d[\\d.,]*\\s*kwh\\s*(?:/|por|ao|a cada|mensais|anuais)\\s*(?:mes|ano)?', '\\d[\\d.,]*\\s*kwh\\s*(?:mensais|anuais)', 'kwh\\s*/\\s*(?:mes|ano)',
  'desempenho\\b[^.]{0,40}(?:estimativ|\\d+\\s*%|kwh)',
].join('|'));
// Promete: garante, assegura, promete, se responsabiliza pela, ou afirma o futuro com número ("vai gerar no mínimo 700 kWh").
// Todas começam em limite de palavra: "promet" sozinho casaria dentro de "compromete-se" (texto de fábrica do Completo).
const GARANTE_NO_TEXTO = /(\bgarant\w*|\bassegur\w*|\bpromet\w*|\bresponsabiliz\w*\s+pel[ao]s?\b|\bcompromete-se a (?:gerar|produzir)|\bse obriga a (?:gerar|produzir)|\bobriga-se a (?:gerar|produzir))/;
const FUTURO_GERA = /\b(?:vai|ira|vao|irao|devera|deverao)\s+(?:gerar|produzir)\b|\b(?:gerara|gerarao|produzira|produzirao)\b/;
// Só a NEGAÇÃO da própria garantia sai da frase: "não constitui garantia", "estimativa, não garantia", "sem garantia de geração",
// "não garante", "não se responsabiliza pela geração". "Não se responsabilizando por sombreamento" NÃO é negação da garantia.
const NEGA_A_GARANTIA = new RegExp([
  '\\bnao\\s+(?:\\w+\\s+){0,3}?(?:garant\\w*|assegur\\w*|promet\\w*|responsabiliz\\w*\\s+pel[ao]s?\\b)',
  '\\bsem\\s+(?:\\w+\\s+){0,1}?(?:garant\\w*|promessa)', '\\bnem\\s+(?:garant\\w*|assegur\\w*|promet\\w*)', '\\bnenhuma\\s+garantia', '\\bnao ha\\s+(?:qualquer\\s+)?promessa',
].join('|'), 'g');
// Garantia de DESEMPENHO do módulo pelo fabricante (degradação, linear, potência nominal) não é promessa de geração.
const DESEMPENHO_DO_FABRICANTE = /(degradacao|desempenho linear|potencia nominal)/;
const DE_MODULO = /(modulo|painel|paineis|placa|fabricante)/;
const COM_NUMERO = /(\d|minimo|minima)/;

const limpoTxt = (s: unknown): string =>
  semAcento(String(s ?? '').replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const frasesDe = (t: string): string[] => t.split(/[.;]\s+|\n|[.;]$/).map(f => f.trim()).filter(Boolean);

/** O texto promete geração (garante, assegura) sem negar? Estimativa que vira garantia. */
export function geracaoComoGarantia(...textos: Array<string | null | undefined>): boolean {
  for (const t of textos) {
    for (const f0 of frasesDe(limpoTxt(t))) {
      if (DESEMPENHO_DO_FABRICANTE.test(f0) && DE_MODULO.test(f0)) continue;
      const f = f0.replace(NEGA_A_GARANTIA, ' ');
      if (!GERA_NO_TEXTO.test(f)) continue;
      if (GARANTE_NO_TEXTO.test(f) || (FUTURO_GERA.test(f) && COM_NUMERO.test(f))) return true;
    }
  }
  return false;
}

// ── Menções de prazo (garantia e obra) ───────────────────────────────────────
type Mencao = { item: string; valor: number | null };
// "25 (vinte e cinco) anos" vira "25 anos": o extenso entre parênteses não entra na conta. Divide só em vírgula e ponto e
// vírgula: dividir em " e " quebraria "é de 30 anos" (sem acento, "e de 30 anos").
const semParenteses = (s: string): string => s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ');
const trechos = (frase: string): string[] => semParenteses(frase).split(/[,;]/).map(x => x.trim()).filter(Boolean);
const textoDoItem = (i: ItemMod): string => (i.travado ? '' : limpoTxt(i.html));
const ehTravadoOuMarcador = (i: ItemMod): boolean => i.travado;

// `chave` casa o fim da key (`garantias.modulos`) e `campo` o campo da tela de onde vem o prazo.
const CATEGORIAS_GARANTIA: Array<{ id: 'modulos' | 'inversor' | 'instalacao' | 'bateria'; nome: string; re: RegExp; chave: RegExp; campo: RegExp }> = [
  { id: 'modulos', nome: 'os módulos', re: /\b(?:modulos?|paineis|painel|placas?)\b/, chave: /^(?:modulos?|equipamentos)$/, campo: /fs-c-gmod/ },
  { id: 'inversor', nome: 'o inversor', re: /\binversor(?:es)?\b/, chave: /^(?:inversor|equipamentos)$/, campo: /fs-c-ginv\b/ },
  { id: 'instalacao', nome: 'a instalação', re: /\b(?:instalacao|instalacoes)\b/, chave: /^instalacao$/, campo: /fs-c-ginst/ },
  { id: 'bateria', nome: 'a bateria', re: /\bbaterias?\b/, chave: /^(?:bateria|equipamentos)$/, campo: /fs-c-bat-gar/ },
];
const DURACAO_GARANTIA = /(\d+)\s*(anos?|mes(?:es)?)\b/g;
/** Em "25 anos para módulos e 10 anos para o inversor", cada equipamento fica com a duração mais perto dele no trecho. */
function duracaoMaisPerto(seg: string, pos: number): number | null {
  let melhor: { meses: number; dist: number } | null = null;
  for (const d of seg.matchAll(DURACAO_GARANTIA)) {
    const ini = d.index ?? 0;
    const dist = Math.min(Math.abs(pos - ini), Math.abs(pos - (ini + d[0].length)));
    if (!melhor || dist < melhor.dist) melhor = { meses: d[2].startsWith('ano') ? Number(d[1]) * 12 : Number(d[1]), dist };
  }
  return melhor ? melhor.meses : null;
}

function mencoesDeGarantia(clausulas: ClausulaMod[]): Map<string, Mencao[]> {
  const out = new Map<string, Mencao[]>();
  const add = (cat: string, m: Mencao) => out.set(cat, [...(out.get(cat) || []), m]);
  for (const c of clausulas) {
    for (const i of c.itens) {
      if (ehTravadoOuMarcador(i)) {
        // O texto não chega (é marcador): o item vale pela chave `garantias.*` e pelo campo. Prazo desconhecido.
        if (/^garantias?\./.test(i.key)) {
          const fim = i.key.replace(/^garantias?\./, '');
          const campo = semAcento(i.campo);
          for (const g of CATEGORIAS_GARANTIA) if (g.chave.test(fim) || g.campo.test(campo)) add(g.id, { item: i.key, valor: null });
        }
        continue;
      }
      for (const f of frasesDe(textoDoItem(i))) {
        if (!/garanti/.test(f)) continue;
        for (const seg of trechos(f)) {
          for (const g of CATEGORIAS_GARANTIA) {
            const achou = g.re.exec(seg);
            if (!achou) continue;
            const meses = duracaoMaisPerto(seg, achou.index);
            if (meses != null) add(g.id, { item: i.key, valor: meses });
          }
        }
      }
    }
  }
  return out;
}

const DURACAO_OBRA = /(\d+)\s*(dias?|mes(?:es)?)\b/;
// Prazo de obra = prazo de CONCLUSÃO, EXECUÇÃO ou ENTREGA da obra ou da instalação. "Acesso ao monitoramento em até 2 dias
// após a instalação" e "treinamento em 1 dia" falam de outra coisa e não contam.
const OBRA_NO_PREFIXO = /(instalacao:|instalacao completa|realizar a instalacao|prazo (?:da|de) (?:instalacao|obra)|instalacao (?:sera|ficara|deve|devera)\b[^.]{0,30}(?:conclu|entreg|execut)|(?:conclu|entreg|execu)\w*[^.]{0,40}(?:instalacao|\bobra\b|servicos)|(?:instalacao|\bobra\b)[^.]{0,30}(?:conclu|entreg|execut))/;
const NAO_E_OBRA = /(aprovacao|homolog|projeto|garanti|manutenc|vistoria|documentac|pagamento|rescis|notific|comunic|monitor|acesso|treinament|aplicativo|orienta|suporte|atendiment|assistencia|visita|resposta)/;

function mencoesDeObra(clausulas: ClausulaMod[]): Mencao[] {
  const out: Mencao[] = [];
  for (const c of clausulas) {
    for (const i of c.itens) {
      if (ehTravadoOuMarcador(i)) {
        if (/^prazos?\.(?:obra|instalacao|execucao)/.test(i.key) || /fs-c-pinst/.test(semAcento(i.campo))) out.push({ item: i.key, valor: null });
        continue;
      }
      for (const f of frasesDe(textoDoItem(i))) {
        for (const seg of trechos(f)) {
          const d = DURACAO_OBRA.exec(seg);
          if (!d) continue;
          const prefixo = seg.slice(0, d.index);
          if (!OBRA_NO_PREFIXO.test(prefixo) || NAO_E_OBRA.test(prefixo)) continue;
          out.push({ item: i.key, valor: d[2].startsWith('mes') ? Number(d[1]) * 30 : Number(d[1]) });
        }
      }
    }
  }
  return out;
}

/** Mais de um prazo para o mesmo objeto: dois valores diferentes, ou um valor escrito em texto e outro vindo de campo. */
function prazosDiferentes(m: Mencao[]): number[] | null {
  const conhecidos = m.filter(x => x.valor != null) as Array<Mencao & { valor: number }>;
  const valores = [...new Set(conhecidos.map(x => x.valor))];
  if (valores.length >= 2) return valores;
  const desconhecidos = m.filter(x => x.valor == null);
  if (valores.length === 1 && desconhecidos.some(u => conhecidos.some(k => k.item !== u.item))) return valores;
  return null;
}
const mesesTxt = (n: number): string => (n % 12 === 0 ? `${n / 12} ${n / 12 === 1 ? 'ano' : 'anos'}` : `${n} meses`);

// ── A checagem ───────────────────────────────────────────────────────────────
/**
 * Conflitos do contrato solar (uma Parte só). Todos entram como NÃO resolvidos, ou seja, bloqueiam a geração até o consultor
 * decidir: foro duplicado, garantia do mesmo equipamento em dois prazos, prazo de obra duplicado e geração prometida como garantia.
 */
export function conflitosSolar(clausulas: ClausulaMod[], tipo: TipoHibrido): ConflitoDetectado[] {
  const out: ConflitoDetectado[] = [];
  const novo = (categoria: ConflitoDetectado['categoria'], descricao: string) =>
    out.push({ descricao, resolvido: false, como: null, origem: 'servidor', categoria, parte: tipo });

  // 1. foro: um ponto por cláusula (vale pelo que os itens dizem).
  const foros = clausulas.filter(c => (c.itens.length ? c.itens.some(ehForoItem) : ehForoClausula(c))).length;
  if (foros > 1) novo('foro', `O contrato tem ${foros} foros eleitos. Deve haver um só, escolha qual vale.`);

  // 2. garantia do mesmo equipamento com dois prazos.
  const garantias = mencoesDeGarantia(clausulas);
  for (const g of CATEGORIAS_GARANTIA) {
    const dif = prazosDiferentes(garantias.get(g.id) || []);
    if (dif) novo('garantia', `A garantia d${g.nome} aparece com prazos diferentes (${dif.map(mesesTxt).join(' e ')}). Deixe um só prazo.`);
  }

  // 3. prazo de obra duplicado.
  const obra = prazosDiferentes(mencoesDeObra(clausulas));
  if (obra) novo('prazo_obra', `O prazo de instalação (obra) aparece mais de uma vez com valores diferentes (${obra.map(d => `${d} dias`).join(' e ')}). Deixe um só.`);

  // 4. estimativa de geração tratada como garantia.
  const prometida = clausulas.some(c => geracaoComoGarantia(c.titulo, ...c.itens.filter(i => !i.travado).map(i => i.html)));
  if (prometida) {
    novo('geracao', 'O texto promete ou garante geração de energia, mas a geração é só uma estimativa e o contrato diz que não é garantia. Troque por estimativa ou tire a promessa.');
  }
  return out;
}
