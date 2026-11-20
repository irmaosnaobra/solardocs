// ─────────────────────────────────────────────────────────────────────────────
// A PLANILHA ANTIGA "CONTRATOS FECHADOS", aba "Clientes Geral" (19/11/2026): o mapa PURO {coluna: valor} de uma venda solar.
// Fonte das colunas e das regras: a skill `contratos-fechados` (linha = código + 1). SÓ entra coluna com dado certo; vazio fica vazio.
// NUNCA entram as colunas internas (consultor, origem do lead, recebido, depoimento, datas de material e montagem, status, custos, kit, comissão,
// lucro) nem dado que a obra não tem (parecer, ART, cadastro do Trello, modelo e voltagem do inversor). O equipamento vem do equipamento final
// (a Compra; se não há compra, a proposta). Valor e forma de pagamento são dinheiro: `sensivel` (só vão à tela de quem vê o livro).
// Os valores fixos da planilha (contrato de cooperativa "nc", engenheiro "Guilherme") são regra da própria planilha, escritos em `FIXAS`.
// ─────────────────────────────────────────────────────────────────────────────
import type { EquipamentoFinal, EquipLinha } from './equipamentoFinal';

/** As colunas que NENHUMA venda escreve (o Apps Script também as recusa). */
export const COLUNAS_INTERNAS: readonly string[] = ['D', 'E', 'H', 'I', 'K', 'P', 'Q', 'R', 'S', 'W', 'AA', 'AC', 'AD', 'AG'];
export const ehColunaInterna = (c: string): boolean => COLUNAS_INTERNAS.includes(c) || (colunaNumero(c) >= colunaNumero('AQ'));

/** A..Z = 1..26, AA = 27... */
export function colunaNumero(c: string): number {
  return [...c.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

export interface ColunaPlanilha {
  coluna: string; rotulo: string; valor: string | number; tipo: 'texto' | 'numero' | 'data';
  /** O texto para colar à mão (data em dd/mm/aaaa, valor em reais). */
  texto: string;
  /** Dinheiro (valor da venda e forma de pagamento): só vai à tela de quem vê o valor da venda. */
  sensivel: boolean;
}

export interface EntradaPlanilha {
  codigo: string | null;
  titularConta: string;
  telefone: string;
  endereco: string;
  cidade: string;
  uf: string;
  concessionaria: string;
  valorCentavos: number | null;
  formasDePagamento: string[];
  equip: EquipamentoFinal;
  excedente: boolean;
  /** YYYY-MM-DD da liberação pela concessionária, quando houver. */
  liberadaEm: string | null;
}

const ROTULO_FORMA: Record<string, string> = { pix: 'Pix', ted: 'TED', boleto: 'Boleto', cartao: 'Cartão', financiamento: 'Financiamento', dinheiro: 'Dinheiro' };
const FIXAS: ReadonlyArray<{ coluna: string; rotulo: string; texto: string }> = [
  { coluna: 'AE', rotulo: 'CONTRATO COOPERATIVA', texto: 'nc' },
  { coluna: 'AF', rotulo: 'TEMPO DE CONTRATO COOP', texto: 'nc' },
  { coluna: 'AN', rotulo: 'ENGENHEIRO', texto: 'Guilherme' },
];
const dataBr = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const limpo = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const reais = (c: number): string => `R$ ${(c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** "SAJ 6K": marca e modelo sem repetir a marca; sem marca, o modelo; sem modelo, a descrição. */
const nomeDoEquip = (l: EquipLinha): string => {
  const modelo = limpo(l.modelo) || limpo(l.descricao);
  const marca = limpo(l.marca);
  return marca && !modelo.toLowerCase().includes(marca.toLowerCase()) ? `${marca} ${modelo}` : modelo;
};
const concessionaria = (c: string, uf: string): string => {
  const t = c.toLowerCase();
  if (t.includes('cemig')) return 'Cemig';
  if (t.includes('equatorial')) return 'Equatorial';
  return uf.toUpperCase() === 'MG' ? 'Cemig' : uf.toUpperCase() === 'GO' ? 'Equatorial' : '';
};

/** Só as colunas com dado certo, na ordem da planilha. A coluna A (o código) vai primeiro: é a chave da linha e nunca é escrita. */
export function colunasDaPlanilha(e: EntradaPlanilha): ColunaPlanilha[] {
  const out: ColunaPlanilha[] = [];
  const txt = (coluna: string, rotulo: string, v: string, sensivel = false): void => { if (v) out.push({ coluna, rotulo, valor: v, tipo: 'texto', texto: v, sensivel }); };
  const num = (coluna: string, rotulo: string, v: number | null, texto?: string, sensivel = false): void => {
    if (v !== null && Number.isFinite(v) && v > 0) out.push({ coluna, rotulo, valor: v, tipo: 'numero', texto: texto ?? String(v), sensivel });
  };
  txt('A', 'CÓDIGO', limpo(e.codigo));
  txt('C', 'NOME HOMOLOGAÇÃO', limpo(e.titularConta));
  num('F', 'VALOR DA VENDA', e.valorCentavos === null ? null : e.valorCentavos / 100, e.valorCentavos === null ? undefined : reais(e.valorCentavos), true);
  txt('G', 'FORMA DE PAGTO', [...new Set(e.formasDePagamento.map((f) => ROTULO_FORMA[f] ?? ''))].filter(Boolean).join(' + '), true);
  txt('J', 'SISTEMA LIBERADO PELA CONCESSIONÁRIA', e.liberadaEm ? 'Liberado' : '');
  txt('L', 'CONTATO', limpo(e.telefone));
  txt('M', 'ENDEREÇO', limpo(e.endereco));
  txt('N', 'CIDADE', limpo(e.cidade));
  txt('O', 'UF', limpo(e.uf).toUpperCase().slice(0, 2));
  const mods = e.equip.modulos;
  const mesmoModulo = new Set(mods.map((m) => nomeDoEquip(m).toLowerCase())).size <= 1;
  num('T', 'QTD PLACA', e.equip.qtd_modulos);
  if (mods.length && mesmoModulo) {
    const m = mods[0];
    txt('U', 'MODELO PLACA', m.marca && m.potencia_w ? `${m.marca} ${m.potencia_w}W` : nomeDoEquip(m));
    num('V', 'POT PLACA', m.potencia_w);
  }
  const invs = e.equip.inversores;
  num('X', 'QTD INV', e.equip.qtd_inversores);
  if (invs.length && new Set(invs.map((i) => nomeDoEquip(i).toLowerCase())).size === 1) txt('Z', 'MODELO INVERSOR', nomeDoEquip(invs[0]));
  const est = e.equip.estruturas[0];
  if (est) txt('AB', 'TIPO ESTRUTURA', nomeDoEquip(est));
  for (const f of FIXAS) txt(f.coluna, f.rotulo, f.texto);
  if (e.liberadaEm && /^\d{4}-\d{2}-\d{2}$/.test(e.liberadaEm)) out.push({ coluna: 'AM', rotulo: 'LIBERAÇÃO VISTORIA', valor: e.liberadaEm, tipo: 'data', texto: dataBr(e.liberadaEm), sensivel: false });
  txt('AO', 'EXCEDENTES', e.excedente ? 'Tem Excedente' : '');
  txt('AP', 'CONCESSIONÁRIA', concessionaria(e.concessionaria, e.uf));
  return out.filter((c) => c.coluna === 'A' || !ehColunaInterna(c.coluna)).sort((a, b) => colunaNumero(a.coluna) - colunaNumero(b.coluna));
}

/** A lista "Coluna: valor" para a tela e o "Copiar". Quem não vê o valor da venda (`podeVerValorDaObra`) não recebe valor nem forma de pagamento. */
export function listaParaCopiar(colunas: readonly ColunaPlanilha[], veValor: boolean): Array<{ coluna: string; rotulo: string; texto: string }> {
  return colunas.filter((c) => veValor || !c.sensivel).map((c) => ({ coluna: c.coluna, rotulo: c.rotulo, texto: c.texto }));
}
