// ─────────────────────────────────────────────────────────────────────────────
// OS PORTÕES NOVOS DA OBRA SOLAR (19/11/2026). PURO: sem banco, sem rota e sem relógio. Só tipos de `jornadaObra` (sem ciclo).
//
// Compra (etapa 4), Logística (5) e Obra (6) NÃO têm mais botão "Concluir": a etapa seguinte abre quando o dado existe.
//   Compra     -> libera a Logística quando todo módulo e todo inversor estão comprados. A estrutura não segura (o fechamento a cobra); item só orçado não conta.
//   Logística  -> libera a Obra quando a carga do kit está completa: onde buscou, data, placa válida, quem buscou com CPF válido, quem recebeu e 1 foto.
//   Obra       -> libera o Comissionamento (etapas 7 e 8) quando o checklist está completo e há pelo menos 1 dia no diário com foto.
//   Entrega (7)-> conclui sozinha quando o portão dela vale (8 fotos, testes, monitoramento online com cofre, termo assinado) e abre a 8 (liberação, dono
//                 Thiago): durante a espera da concessionária a obra é etapa 8 para a fila das 08:00, a escalada e o aviso "É sua". O botão final conclui a 8.
// O resto (comprovantes, pagamento, prazo de 2 dias úteis, nota na carga, conferência item a item, frete, diário de todos os dias, equipe paga)
// não segura mais nada aqui: o fechamento final (etapa 8) cobra, pelo livro. Item `opcional` nunca trava; `obrigatorio` trava.
// `aplicarPortoes` só anda para a FRENTE: etapa já concluída continua concluída e nenhuma obra volta de etapa.
// ─────────────────────────────────────────────────────────────────────────────
import type { CargaObra, EstadoObra, FonteItens, ItemObra, NivelItem, ObraPrivada } from './jornadaObra';
import { normalizarCpf, placaValida, CHAVES_CHECKLIST, SLOTS_FOTO_ENTREGA } from './obraDocs';
import { listaE, serieDoInversor, statusDoKit, statusDoMaterial, textoDoKit } from './compraKit';

const item = (chave: string, texto: string, feito: boolean, nivel: NivelItem, grupo: 'portao' | 'fechamento' = 'portao'): ItemObra =>
  ({ chave, bloco: 'portao', texto, feito, nivel, grupo });

// ── Compra ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const portaoCompra = (p: ObraPrivada): boolean => statusDoKit(p.compra.itens, p.compra.documentos).completo;

export function itensDaCompra(p: ObraPrivada): ItemObra[] {
  const kit = statusDoKit(p.compra.itens, p.compra.documentos);
  const mat = statusDoMaterial(p.compra.itens, p.compra.documentos);
  return [
    item('kit', textoDoKit(kit), kit.completo, 'obrigatorio'),
    item('eletrico', mat.total ? `Material elétrico comprado (${mat.comprados} de ${mat.total})` : 'Material elétrico: nenhum item na lista', mat.completo, 'opcional'),
  ];
}

// ── Logística ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que falta numa carga para ela contar como completa (lista vazia = completa). */
export function faltaDaCarga(c: CargaObra, existe: (id: string) => boolean): string[] {
  const falta: string[] = [];
  if (!c.saida.lugar.trim()) falta.push('onde buscou');
  if (!c.saida.em && !c.chegada.em) falta.push('a data');
  if (!placaValida(c.transporte.placa)) falta.push('a placa');
  if (!c.transporte.motorista.trim()) falta.push('o nome de quem buscou');
  if (!normalizarCpf(c.transporte.cpf)) falta.push('o CPF de quem buscou');
  if (!c.recebido_por.nome.trim()) falta.push('quem recebeu');
  if (!(c.fotos.some(existe) || existe(c.conferencia.foto_id))) falta.push('1 foto');
  return falta;
}

export interface StatusDaLogistica {
  /** Todo módulo e inversor que contam estão em alguma carga (e há kit). A estrutura não segura a Logística: ela nem precisa estar comprada. */
  kitNasCargas: boolean;
  /** As cargas que levam módulo ou inversor. */
  cargasDoKit: CargaObra[];
  /** Todas as cargas do kit completas. */
  completa: boolean;
}

export function statusDaLogistica(p: ObraPrivada, existe: (id: string) => boolean): StatusDaLogistica {
  const kit = statusDoKit(p.compra.itens, p.compra.documentos);
  const idsKit = new Set(kit.portao.map((i) => i.id));
  const cargasDoKit = p.logistica.cargas.filter((c) => c.itens.some((id) => idsKit.has(id)));
  const kitNasCargas = kit.portao.length > 0 && kit.portao.every((i) => cargasDoKit.some((c) => c.itens.includes(i.id)));
  return { kitNasCargas, cargasDoKit, completa: kitNasCargas && cargasDoKit.every((c) => faltaDaCarga(c, existe).length === 0) };
}

export const portaoLogistica = (p: ObraPrivada, existe: (id: string) => boolean): boolean => statusDaLogistica(p, existe).completa;

export function itensDaLogistica(p: ObraPrivada, existe: (id: string) => boolean): ItemObra[] {
  const s = statusDaLogistica(p, existe);
  const idsDoKit = new Set(s.cargasDoKit.map((c) => c.id));
  const out: ItemObra[] = [
    item('kit_nas_cargas', s.kitNasCargas ? 'Todo o kit está em uma carga' : 'Falta pôr o kit em uma carga: onde buscou, data, placa, quem buscou (CPF), quem recebeu e 1 foto', s.kitNasCargas, 'obrigatorio'),
  ];
  p.logistica.cargas.forEach((c, i) => {
    const falta = faltaDaCarga(c, existe);
    out.push(item(`retirada_${c.id}`, falta.length ? `Carga ${i + 1}: falta ${listaE(falta)}` : `Carga ${i + 1} completa`, falta.length === 0, idsDoKit.has(c.id) ? 'obrigatorio' : 'opcional'));
  });
  return out;
}

// ── Obra ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const checklistCompleto = (p: ObraPrivada): boolean => CHAVES_CHECKLIST.every((k) => p.obra.checklist[k] === true);
const diaComFoto = (p: ObraPrivada, existe: (id: string) => boolean): boolean => p.obra.diario.some((d) => d.fotos.some(existe));

export const portaoObra = (p: ObraPrivada, existe: (id: string) => boolean): boolean => checklistCompleto(p) && diaComFoto(p, existe);

export function itensDaObra(p: ObraPrivada, existe: (id: string) => boolean): ItemObra[] {
  const dias = p.obra.plano;
  const completoDoDia = (data: string): boolean => p.obra.diario.some((x) => x.data === data && !!x.chegada && !!x.saida && x.fotos.some(existe));
  const out: ItemObra[] = [
    item('checklist', 'Checklist da instalação completo', checklistCompleto(p), 'obrigatorio'),
    item('diario', 'Pelo menos 1 dia no diário com foto', diaComFoto(p, existe), 'obrigatorio'),
  ];
  if (dias.length) out.push(item('diario_dias', `Diário dos ${dias.length} dias do plano, com chegada, saída e foto`, dias.every((d) => completoDoDia(d.data)), 'opcional'));
  out.push(item('equipe', 'Equipe e valor combinado', (p.obra.equipe.combinado_centavos ?? 0) > 0, 'opcional'));
  return out;
}

// ── Entrega (etapa 7) ───────────────────────────────────────────────────────────────────────────────────────────────

export type SlotsDaObra = ReadonlyMap<string, readonly string[]>;

/** Os itens da Entrega (todos obrigatórios): 8 fotos, testes, monitoramento online com a senha no cofre e o termo assinado. */
export function itensDaEntrega(p: ObraPrivada, slots: SlotsDaObra, existe: (id: string) => boolean): ItemObra[] {
  const fotos = SLOTS_FOTO_ENTREGA.filter((s) => (slots.get(s) ?? []).length > 0).length;
  const t = p.entrega.testes;
  const m = p.entrega.monitoramento;
  const tm = p.entrega.termo;
  return [
    item('fotos', `Fotos de tudo pronto (${fotos} de 8)`, fotos === 8, 'obrigatorio'),
    item('testes', 'Testes ok', !!t.string1_voc && !!t.string2_voc && t.isolamento_ok && !!t.gerando_kw && t.wifi_ok && t.disjuntores_ok, 'obrigatorio'),
    item('monitoramento', 'Monitoramento online', !!m.app && !!m.conta && !!(m.serie || serieDoInversor(p.compra.itens, p.compra.documentos)) && m.online && !!p.entrega.cofre, 'obrigatorio'),
    item('termo', 'Termo de entrega assinado', !!tm && !!tm.assinado_em && existe(tm.arquivo_id) && (!tm.chk.includes('pend') || !!tm.ressalva), 'obrigatorio'),
  ];
}
export const portaoEntrega = (p: ObraPrivada, slots: SlotsDaObra, existe: (id: string) => boolean): boolean => itensDaEntrega(p, slots, existe).every((i) => i.feito);

// ── A abertura sozinha ────────────────────────────────────────────────────────────────────────────────────────────────

export interface FonteDosPortoes { privada: ObraPrivada; docsIds: ReadonlySet<string>; /** slot -> ids dos arquivos (as fotos da entrega) */ slots: SlotsDaObra }

/**
 * Anda para a frente: conclui a Compra, a Logística e a Obra cujo portão já vale e abre a etapa seguinte, gravando `concluida_em` UMA vez e o histórico
 * (`concluir` e `abrir`, como o botão fazia: é o que os robôs leem). Etapa já concluída não é tocada; a conta fechada não muda. Devolve o MESMO objeto
 * quando nada mudou (quem grava pode pular a escrita).
 */
export function aplicarPortoes(jo: EstadoObra, f: FonteDosPortoes, agora: string, por: string): EstadoObra {
  if (jo.fechada) return jo;
  const existe = (id: string): boolean => !!id && f.docsIds.has(id);
  const etapas = { ...jo.etapas };
  const hist: EstadoObra['historico'] = [];
  let esperando = jo.esperando;
  const passos: Array<[4 | 5 | 6 | 7, boolean]> = [[4, portaoCompra(f.privada)], [5, portaoLogistica(f.privada, existe)], [6, portaoObra(f.privada, existe)], [7, portaoEntrega(f.privada, f.slots, existe)]];
  for (const [n, ok] of passos) {
    if (etapas[n].concluida_em) continue;
    if (!etapas[n].aberta_em || !ok) break;
    etapas[n] = { ...etapas[n], concluida_em: agora, concluida_por: por };
    const prox = (n + 1) as 5 | 6 | 7 | 8;
    etapas[prox] = { ...etapas[prox], aberta_em: etapas[prox].aberta_em ?? agora };
    hist.push({ em: agora, por, acao: 'concluir', etapa: n }, { em: agora, por, acao: 'abrir', etapa: prox });
    if (esperando && esperando.etapa === n) esperando = null;
  }
  return hist.length ? { ...jo, etapas, esperando, historico: [...jo.historico, ...hist].slice(-50) } : jo;
}

/**
 * O último carimbo gravado no estado (abertura ou conclusão de qualquer etapa): a âncora ESTÁVEL da visão. O GET aplica os portões só na visão, sem gravar;
 * com "agora" o prazo da etapa seguinte andaria a cada leitura. Sem carimbo nenhum devolve null.
 */
export function ultimoCarimbo(jo: EstadoObra): string | null {
  const todos = ([4, 5, 6, 7, 8] as const).flatMap((n) => [jo.etapas[n].aberta_em, jo.etapas[n].concluida_em]).filter((x): x is string => !!x);
  return todos.length ? todos.reduce((a, b) => (a > b ? a : b)) : null;
}

/**
 * A abertura FORÇADA pelo ADM (a obra no meio do caminho que ficou sem saída: item antigo de tipo `outro`, kit numa linha só da nota). Conclui a etapa `n`
 * (4 a 7), abre a seguinte e grava no histórico `forcar` + `concluir` + `abrir`, todos com o nome do ADM. Só anda para a frente: a etapa tem que ser a da
 * vez (a primeira sem `concluida_em`) e a conta não pode estar fechada. Devolve null quando não dá.
 */
export function forcarEtapa(jo: EstadoObra, n: 4 | 5 | 6 | 7, agora: string, por: string): EstadoObra | null {
  if (jo.fechada || jo.etapas[n].concluida_em || ([4, 5, 6, 7, 8] as const).some((x) => x < n && !jo.etapas[x].concluida_em)) return null;
  const prox = (n + 1) as 5 | 6 | 7 | 8;
  const etapas = { ...jo.etapas };
  etapas[n] = { aberta_em: jo.etapas[n].aberta_em ?? agora, concluida_em: agora, concluida_por: por };
  etapas[prox] = { ...jo.etapas[prox], aberta_em: jo.etapas[prox].aberta_em ?? agora };
  const hist: EstadoObra['historico'] = [{ em: agora, por, acao: 'forcar', etapa: n }, { em: agora, por, acao: 'concluir', etapa: n }, { em: agora, por, acao: 'abrir', etapa: prox }];
  return { ...jo, etapas, esperando: jo.esperando && jo.esperando.etapa === n ? null : jo.esperando, historico: [...jo.historico, ...hist].slice(-50) };
}

/** Os itens de uma etapa de 4 a 7 como `itensDaEtapaObra` os devolve. */
export function itensDaEtapaNova(n: 4 | 5 | 6 | 7, f: FonteItens): ItemObra[] {
  const existe = (id: string): boolean => !!id && f.docsIds.has(id);
  if (n === 4) return itensDaCompra(f.privada);
  if (n === 5) return itensDaLogistica(f.privada, existe);
  if (n === 7) return itensDaEntrega(f.privada, f.slots, existe);
  return itensDaObra(f.privada, existe);
}
