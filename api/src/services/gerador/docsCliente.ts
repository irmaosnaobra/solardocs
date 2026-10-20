// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTOS e RELATÓRIO DE ENGENHARIA da ficha de clientes do /gerador (14/10/2026).
//
// Módulo PURO (sem rede, sem banco): catálogo de itens por linha, chave e caminho,
// normalização dos metadados e montagem do relatório.
//
// O que mora onde:
//   - arquivos ........ bucket PRIVADO `fichas-docs` do banco principal; caminho
//                       `<linha>/<codigo>/<uuid>.<ext>`, sempre escolhido pelo servidor
//   - metadados ....... `system_state`, chave `docs_cliente:<linha>:<codigo>`
//
// O `system_state` é legível com a chave publishable do banco principal (achado de
// 14/10). Por isso o metadado guarda SÓ: slot, caminho, mime, bytes, em e por. NUNCA
// o nome original do arquivo, que costuma trazer nome de cliente. A trilha também não
// guarda nome nem caminho.
//
// O relatório NUNCA leva dinheiro, nem para sócio: ele sai do mesmo cliente, para o
// papel de consultor, e ainda passa por um filtro de coluna financeira.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { codigoCanonico } from './solarObras';
import {
  GRUPOS, GRUPO_OUTROS, celulaDe, preenchida, isoParaBR,
  type Coluna, type ColunaInterna, type Valor, type RegistroGestao,
} from './gestaoClientes';
import {
  colunasFichaPara, celulaFicha, GRUPOS_FICHA, type CardVendido, type ObraEp,
} from './fichaEletroposto';

// `vendasolar` (20/10/2026): a venda SOLAR tendo o CARD VENDIDO como centro (código = id do card, como no eletroposto).
// `solar` segue sendo a venda da planilha mãe (`#NNNN`). As duas convivem: o card e a venda ficam ligados pelo hub
// (`venda_solar:<card>` no `system_state`, veja `vendaSolarHub.ts`).
export type Linha = 'solar' | 'eletroposto' | 'vendasolar';
export const LINHAS: readonly Linha[] = ['solar', 'eletroposto', 'vendasolar'];
export const ehLinha = (x: unknown): x is Linha => x === 'solar' || x === 'eletroposto' || x === 'vendasolar';

export const LIMITE_BYTES = 10 * 1024 * 1024;
export const BUCKET_DOCS = 'fichas-docs';
export const MIMES_ACEITOS: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};
const MAX_ARQUIVOS = 100;         // por venda
const MAX_POR_ITEM_VARIOS = 40;   // fotos de um item que aceita vários (o `outros` vai até o teto da venda)
const MAX_TRILHA = 50;
export const LIMITES = { total: MAX_ARQUIVOS, porItem: MAX_POR_ITEM_VARIOS, outros: MAX_ARQUIVOS, trilha: MAX_TRILHA } as const;

// ── Catálogo ─────────────────────────────────────────────────────────────────

export type Aceita = 'imagem' | 'pdf' | 'ambos';
export interface ItemDoc { chave: string; rotulo: string; aceita: Aceita; obrigatorio: boolean; varios: boolean }

const it = (chave: string, rotulo: string, aceita: Aceita, obrigatorio: boolean, varios = false): ItemDoc =>
  ({ chave, rotulo, aceita, obrigatorio, varios });

// Os 4 itens de foto que já existem no dossiê (fachada, padrão, disjuntor, medidor) seguem só imagem, como lá.
// Obrigatório = os documentos e as fotos principais; "outros" nunca é. No eletroposto, procuração e anuência só
// valem quando o caso pede (cedente que não é dono sozinho, inquilino), então não travam o relatório.
export const CATALOGO: Record<Linha, readonly ItemDoc[]> = {
  solar: [
    it('documento', 'CNH ou identidade', 'ambos', true),
    it('conta_luz', 'Conta de luz', 'ambos', true),
    it('fachada', 'Foto da fachada', 'imagem', true),
    it('padrao', 'Foto do padrão de entrada', 'imagem', true),
    it('disjuntor', 'Foto do disjuntor', 'imagem', true),
    it('medidor', 'Foto do relógio medidor', 'imagem', true),
    it('contrato_assinado', 'Contrato assinado', 'ambos', true),
    it('art', 'ART', 'ambos', true),
    it('projeto', 'Projeto', 'ambos', true),
    it('parecer_acesso', 'Parecer de acesso', 'ambos', true),
    it('obra_pronta', 'Fotos da obra pronta', 'imagem', true, true),
    it('outros', 'Outros documentos', 'ambos', false, true),
  ],
  // Eletroposto: os documentos são por PESSOA e por FINALIDADE (19/10/2026). A CNH de uma pessoa nunca divide item com o
  // comprovante de endereço dela nem com a de outra, e a conta de luz tem três itens (instalação, geradora, beneficiária).
  // As chaves antigas (`documento_titular`, `conta_luz`) ficam: arquivo já enviado continua no lugar. Só mudou o rótulo.
  eletroposto: [
    it('documento_titular', 'CNH ou documento pessoal do comprador', 'ambos', true),
    it('comprovante_endereco_comprador', 'Comprovante de endereço do comprador', 'ambos', false),
    it('documento_cedente', 'CNH ou documento pessoal do cedente (dono do ponto)', 'ambos', false),
    it('comprovante_endereco_cedente', 'Comprovante de endereço do cedente', 'ambos', false),
    it('documento_avalista', 'CNH ou documento pessoal do avalista', 'ambos', false),
    it('comprovante_endereco_avalista', 'Comprovante de endereço do avalista', 'ambos', false),
    it('documento_outra_pessoa', 'Documento de outra pessoa (cônjuge, sócio, representante)', 'ambos', false, true),
    it('documento_imovel', 'Documento do imóvel: matrícula, escritura ou IPTU', 'ambos', false, true),
    it('conta_luz', 'Conta de luz da instalação (ponto do carregador)', 'ambos', true),
    it('conta_luz_geradora', 'Conta de luz da geradora (usina)', 'ambos', false),
    it('conta_luz_beneficiaria', 'Conta de luz que recebe o excedente', 'ambos', false),
    it('foto_local', 'Foto do local', 'imagem', true),
    it('padrao', 'Foto do padrão de entrada', 'imagem', true),
    it('quadro_eletrico', 'Foto do quadro elétrico', 'imagem', true),
    it('contrato_assinado', 'Contrato assinado', 'ambos', true),
    it('procuracao', 'Procuração', 'ambos', false),
    it('anuencia', 'Anuência', 'ambos', false),
    it('vistoria', 'Vistoria', 'ambos', true),
    it('art', 'ART', 'ambos', true),
    it('projeto', 'Projeto', 'ambos', true),
    it('parecer_acesso', 'Parecer de acesso', 'ambos', true),
    it('instalacao', 'Fotos da instalação', 'imagem', true, true),
    it('outros', 'Outros documentos', 'ambos', false, true),
  ],
  // Venda SOLAR pelo card (20/10/2026). Também por PESSOA e por FINALIDADE. As chaves `documento_titular`, `conta_luz`, `fachada`,
  // `padrao`, `disjuntor` e `medidor` são as mesmas do dossiê da proposta (`documento` do dossiê = `documento_titular` aqui).
  // A conta de luz (`conta_luz`) é a da UNIDADE GERADORA, onde vão as placas; as contas das unidades que recebem o excedente
  // ficam em `conta_luz_beneficiaria` (várias).
  vendasolar: [
    it('documento_titular', 'CNH ou documento pessoal do comprador', 'ambos', true),
    it('comprovante_endereco_comprador', 'Comprovante de endereço do comprador', 'ambos', false),
    it('documento_titular_uc', 'CNH ou documento do titular da conta de luz (quando não é o comprador)', 'ambos', false),
    it('documento_outra_pessoa', 'Documento de outra pessoa (cônjuge, sócio, representante)', 'ambos', false, true),
    it('documento_avalista', 'CNH ou documento pessoal do avalista', 'ambos', false),
    it('comprovante_endereco_avalista', 'Comprovante de endereço do avalista', 'ambos', false),
    it('conta_luz', 'Conta de luz da unidade geradora (onde vão as placas)', 'ambos', true),
    it('conta_luz_beneficiaria', 'Conta de luz da unidade que recebe o excedente', 'ambos', false, true),
    it('documento_imovel', 'Documento do imóvel: matrícula, escritura ou IPTU', 'ambos', false, true),
    it('fachada', 'Foto da fachada', 'imagem', true),
    it('padrao', 'Foto do padrão de entrada', 'imagem', true),
    it('disjuntor', 'Foto do disjuntor', 'imagem', true),
    it('medidor', 'Foto do relógio medidor', 'imagem', true),
    it('contrato_assinado', 'Contrato assinado', 'ambos', true),
    it('procuracao', 'Procuração', 'ambos', false),
    it('outros', 'Outros documentos', 'ambos', false, true),
  ],
};

/**
 * Slot do dossiê da proposta -> item do catálogo `vendasolar`. Só leitura: o dossiê não migra. O `documento` do dossiê é o
 * "documento com foto do TITULAR DA CONTA" de luz (veja `ARQUIVOS_SOLAR`), que nem sempre é o comprador: vira
 * `documento_titular_uc`, e na leitura por IA só alimenta `tuc_*`.
 */
export const SLOT_DO_DOSSIE_NA_VENDASOLAR: Readonly<Record<string, string>> = {
  documento: 'documento_titular_uc', conta_luz: 'conta_luz', fachada: 'fachada', padrao: 'padrao', disjuntor: 'disjuntor', medidor: 'medidor',
};

/**
 * Itens que NÃO entram no relatório de engenharia (sai para terceiros): documento pessoal do avalista e de outras pessoas e
 * os comprovantes de endereço não servem à engenharia e são dado pessoal de terceiro. Seguem no catálogo e na leitura por IA.
 */
export const SLOTS_FORA_DO_RELATORIO: ReadonlySet<string> = new Set([
  'documento_avalista', 'documento_outra_pessoa',
  'comprovante_endereco_comprador', 'comprovante_endereco_cedente', 'comprovante_endereco_avalista',
]);

export const itemDoCatalogo = (linha: Linha, chave: unknown): ItemDoc | null =>
  typeof chave === 'string' ? (CATALOGO[linha].find((x) => x.chave === chave) ?? null) : null;

/** O mime serve para o item? (a lista geral é a do bucket; o item restringe a imagem ou a PDF) */
export function mimeServeAoItem(item: ItemDoc, mime: string): boolean {
  if (!MIMES_ACEITOS.includes(mime)) return false;
  if (item.aceita === 'ambos') return true;
  return item.aceita === 'pdf' ? mime === 'application/pdf' : mime !== 'application/pdf';
}

export const normalizarMime = (m: unknown): string => String(m ?? '').split(';')[0].trim().toLowerCase();

// ── Código, chave e caminho ──────────────────────────────────────────────────

/**
 * Código na forma em que a chave e o caminho o guardam: SÓ DÍGITOS. Solar: `#57`, `57` e `0057` são a mesma venda
 * (`0057`). Eletroposto: o id do card, sem zero à esquerda. null = formato inválido.
 */
export function codigoDeRota(linha: Linha, bruto: unknown): string | null {
  const t = String(bruto ?? '').trim();
  if (linha === 'solar') {
    if (!/^#?\d{1,6}$/.test(t)) return null;
    const n = Number(t.replace('#', ''));
    return n > 0 ? codigoCanonico(t).replace(/\D/g, '') : null;
  }
  // Eletroposto e vendasolar: o id do card, sem zero à esquerda.
  if (!/^\d{1,12}$/.test(t) || Number(t) <= 0) return null;
  return String(Number(t));
}

export const PREFIXO_DOCS = 'docs_cliente:';
export const chaveDocs = (linha: Linha, codigo: string): string => `${PREFIXO_DOCS}${linha}:${codigo}`;

export function novoCaminho(linha: Linha, codigo: string, mime: string): string {
  return `${linha}/${codigo}/${crypto.randomUUID()}.${EXT_POR_MIME[mime] ?? 'bin'}`;
}

const RE_CAMINHO = /^(solar|eletroposto|vendasolar)\/(\d{1,12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp|pdf)$/;

/** O caminho INTEIRO tem que casar o formato que o servidor gera. Qualquer outra coisa (`..`, barra extra, outra extensão) é null. */
export function lerCaminho(caminho: unknown): { linha: Linha; codigo: string; uuid: string; ext: string; mime: string } | null {
  if (typeof caminho !== 'string' || caminho.length > 120) return null;
  const m = RE_CAMINHO.exec(caminho);
  if (!m) return null;
  const mime = Object.entries(EXT_POR_MIME).find(([, e]) => e === m[4])?.[0] ?? '';
  return { linha: m[1] as Linha, codigo: m[2], uuid: m[3], ext: m[4], mime };
}

// ── Metadados ────────────────────────────────────────────────────────────────

export interface ArquivoDoc { id: string; slot: string; caminho: string; mime: string; bytes: number; em: string; por: string }
export interface VinculoDoc { proposta: string; por: string; em: string }
export interface TrilhaDoc { em: string; por: string; acao: 'anexou' | 'removeu' | 'vinculou' | 'moveu'; slot?: string; proposta?: string }
/** `apagados`: caminhos já removidos. O token de envio vale 2 h, então o mesmo caminho poderia ser reenviado e registrado depois do DELETE. */
export interface RegistroDocs { arquivos: ArquivoDoc[]; vinculo?: VinculoDoc; alteracoes: TrilhaDoc[]; apagados: string[] }

const MAX_APAGADOS = 200;
export const registroDocsVazio = (): RegistroDocs => ({ arquivos: [], alteracoes: [], apagados: [] });

const txt = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Normaliza o `value` do banco (pode vir torto). Só entram as chaves conhecidas: nome de arquivo que alguém gravou por fora não passa. */
export function lerRegistroDocs(value: unknown): RegistroDocs {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const r = registroDocsVazio();
  if (Array.isArray(v.arquivos)) {
    for (const a of v.arquivos) {
      if (!a || typeof a !== 'object') continue;
      const x = a as Record<string, unknown>;
      if (!lerCaminho(x.caminho) || typeof x.id !== 'string' || !x.id || typeof x.slot !== 'string') continue;
      const bytes = typeof x.bytes === 'number' && Number.isFinite(x.bytes) ? x.bytes : 0;
      r.arquivos.push({ id: x.id, slot: x.slot, caminho: x.caminho as string, mime: txt(x.mime), bytes, em: txt(x.em), por: txt(x.por) });
    }
  }
  if (Array.isArray(v.apagados)) {
    for (const c of v.apagados) if (typeof c === 'string' && lerCaminho(c)) r.apagados.push(c);
    r.apagados = r.apagados.slice(-MAX_APAGADOS);
  }
  if (v.vinculo && typeof v.vinculo === 'object') {
    const x = v.vinculo as Record<string, unknown>;
    if (typeof x.proposta === 'string' && x.proposta) r.vinculo = { proposta: x.proposta, por: txt(x.por), em: txt(x.em) };
  }
  if (Array.isArray(v.alteracoes)) {
    for (const a of v.alteracoes) {
      if (!a || typeof a !== 'object') continue;
      const x = a as Record<string, unknown>;
      if (x.acao !== 'anexou' && x.acao !== 'removeu' && x.acao !== 'vinculou' && x.acao !== 'moveu') continue;
      const t: TrilhaDoc = { em: txt(x.em), por: txt(x.por), acao: x.acao };
      if (typeof x.slot === 'string') t.slot = x.slot;
      if (typeof x.proposta === 'string') t.proposta = x.proposta;
      r.alteracoes.push(t);
    }
  }
  return r;
}

const cortaTrilha = (t: TrilhaDoc[]): TrilhaDoc[] => t.slice(-MAX_TRILHA);

export function comArquivo(reg: RegistroDocs, a: ArquivoDoc): RegistroDocs {
  return {
    ...reg,
    arquivos: [...reg.arquivos, a],
    alteracoes: cortaTrilha([...reg.alteracoes, { em: a.em, por: a.por, acao: 'anexou', slot: a.slot }]),
  };
}
export function semArquivo(reg: RegistroDocs, id: string, por: string, em: string): RegistroDocs {
  const a = reg.arquivos.find((x) => x.id === id);
  return {
    ...reg,
    arquivos: reg.arquivos.filter((x) => x.id !== id),
    apagados: a ? [...reg.apagados.filter((c) => c !== a.caminho), a.caminho].slice(-MAX_APAGADOS) : reg.apagados,
    alteracoes: cortaTrilha([...reg.alteracoes, { em, por, acao: 'removeu', ...(a ? { slot: a.slot } : {}) }]),
  };
}
/** Muda o arquivo de item. Só metadado: o caminho no bucket não tem o item. A trilha guarda o item NOVO, nunca rótulo nem nome. */
export function comArquivoMovido(reg: RegistroDocs, id: string, slot: string, por: string, em: string): RegistroDocs {
  return {
    ...reg,
    arquivos: reg.arquivos.map((x) => (x.id === id ? { ...x, slot } : x)),
    alteracoes: cortaTrilha([...reg.alteracoes, { em, por, acao: 'moveu', slot }]),
  };
}
/** Por que `a` NÃO cabe no item `item` (null = cabe). O próprio arquivo não conta nos tetos: mover não aumenta o total. */
export function motivoSemEspacoParaMover(reg: RegistroDocs, id: string, item: ItemDoc): ReturnType<typeof motivoSemEspaco> {
  return motivoSemEspaco({ ...reg, arquivos: reg.arquivos.filter((x) => x.id !== id) }, item);
}
export function comVinculo(reg: RegistroDocs, proposta: string, por: string, em: string): RegistroDocs {
  return {
    ...reg,
    vinculo: { proposta, por, em },
    alteracoes: cortaTrilha([...reg.alteracoes, { em, por, acao: 'vinculou', proposta }]),
  };
}

/** Quantos arquivos o item comporta: 1 nos de um arquivo só, 40 nos que aceitam vários, e o `outros` até o teto da venda. */
export function limiteDoItem(item: ItemDoc): number {
  if (!item.varios) return 1;
  return item.chave === 'outros' ? LIMITES.outros : LIMITES.porItem;
}

/** Por que um arquivo novo NÃO cabe (null = cabe). Item de um só arquivo ocupado, teto por item e teto por venda. */
export function motivoSemEspaco(reg: RegistroDocs, item: ItemDoc): 'slot_ocupado' | 'muitos_no_item' | 'muitos_na_venda' | null {
  const doItem = reg.arquivos.filter((a) => a.slot === item.chave).length;
  if (!item.varios && doItem >= 1) return 'slot_ocupado';
  // O `outros` tem o mesmo teto da venda: quando enche, o motivo que vale é o da venda.
  if (item.varios && limiteDoItem(item) < MAX_ARQUIVOS && doItem >= limiteDoItem(item)) return 'muitos_no_item';
  if (reg.arquivos.length >= MAX_ARQUIVOS) return 'muitos_na_venda';
  return null;
}

// ── Nome parecido (sugestão de proposta) ─────────────────────────────────────

// Palavra de até 3 letras (de, da, do, dos, das, e, "ana") não identifica ninguém: fica fora do casamento.
const tokens = (nome: string): string[] => nome.split(' ').filter((t) => t.length >= 4);

/**
 * `a` e `b` já normalizados (sem acento, minúsculos). Iguais; um nome de 2 palavras ou mais dentro do outro; ou ao menos
 * 2 palavras significativas em comum. Nome de uma palavra só ("silva") nunca casa com um nome maior.
 * Isto é só SUGESTÃO: o nome do cliente é editável pelo consultor, então não vale como permissão (veja a rota).
 */
export function nomesParecidos(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  if (curto.split(' ').length >= 2 && curto.length >= 5 && ` ${longo} `.includes(` ${curto} `)) return true;
  const tb = tokens(b);
  return tokens(a).filter((t) => tb.includes(t)).length >= 2;
}

/** A assinatura (primeiros bytes) do arquivo bate com o tipo? JPEG FF D8 FF, PNG 89 50 4E 47, WebP RIFF....WEBP, PDF %PDF. */
export function assinaturaBate(mime: string, b: Uint8Array): boolean {
  const ascii = (de: number, n: number): string => Buffer.from(b.subarray(de, de + n)).toString('latin1');
  switch (mime) {
    case 'image/jpeg': return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/webp': return b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'application/pdf': return b.length >= 4 && ascii(0, 4) === '%PDF';
    default: return false;
  }
}

// ── Relatório de engenharia ──────────────────────────────────────────────────

export interface CampoRel { rotulo: string; valor: string }
export interface SecaoRel { titulo: string; campos: CampoRel[] }

function formatoTelefone(d: string): string {
  const s = d.replace(/\D/g, '');
  const n = s.startsWith('55') && s.length > 11 ? s.slice(2) : s;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return s;
}

/** Valor da célula como texto de relatório. Vazio devolve ''. */
export function textoDoValor(col: Coluna, v: Valor | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (col.tipo === 'data' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return isoParaBR(v);
  if (col.tipo === 'telefone') return formatoTelefone(String(v));
  return typeof v === 'number' ? String(v).replace('.', ',') : String(v);
}

// Colunas do solar que NUNCA entram: tudo que é dinheiro por tipo, e tudo que é financeiro ou custo pelo grupo ORIGINAL
// (a visão do consultor move `recebimento` do Financeiro para a Venda, então filtrar pelo grupo depois dela não pega).
const GRUPOS_FORA_SOLAR: ReadonlySet<string> = new Set(['Financeiro', 'Custos da obra', GRUPO_OUTROS]);
// Texto livre (obs, contrato de cooperativa) também fica de fora: alguém escreve valor ali, e o relatório pode ir para terceiros.
const FORA_SOLAR: ReadonlySet<string> = new Set(['codigo', 'depoimento', 'obs', 'contrato_coop']);

export function colunasRelatorioSolar(cols: ColunaInterna[]): ColunaInterna[] {
  return cols.filter((c) =>
    c.quem_ve === 'todos' && c.tipo !== 'dinheiro' && !GRUPOS_FORA_SOLAR.has(c.grupo) && !FORA_SOLAR.has(c.chave));
}

export interface CorpoRelatorio { secoes: SecaoRel[]; camposPendentes: string[] }

export function corpoRelatorioSolar(cols: ColunaInterna[], celulasBrutas: string[], reg: RegistroGestao): CorpoRelatorio & { liberado: boolean } {
  const colunas = colunasRelatorioSolar(cols);
  const porGrupo = new Map<string, CampoRel[]>();
  const pendentes: string[] = [];
  let liberado = false;
  for (const c of colunas) {
    const cel = celulaDe(c, celulasBrutas[c.indice] ?? '', reg);
    if (c.chave === 'sistema_liberado') liberado = cel.valor === 'Liberado';
    const t = textoDoValor(c, cel.valor);
    if (!preenchida(cel) || !t) {
      if (c.obrigatoria) pendentes.push(c.rotulo);
      continue;
    }
    const l = porGrupo.get(c.grupo) ?? [];
    l.push({ rotulo: c.rotulo, valor: t });
    porGrupo.set(c.grupo, l);
  }
  const secoes = GRUPOS.filter((g) => porGrupo.has(g)).map((g) => ({ titulo: g as string, campos: porGrupo.get(g) as CampoRel[] }));
  return { secoes, camposPendentes: pendentes, liberado };
}

export function corpoRelatorioEletroposto(card: CardVendido, reg: RegistroGestao, pvBruto: Parameters<typeof celulaFicha>[3]): CorpoRelatorio {
  // Visão do consultor para os dois papéis: as colunas de sócio (valor, forma de pagamento, entrada, banco) nem entram.
  const colunas = colunasFichaPara(false).filter((c) => c.quem_ve === 'todos' && c.tipo !== 'dinheiro' && c.chave !== 'obs');
  const porGrupo = new Map<string, CampoRel[]>();
  const pendentes: string[] = [];
  for (const c of colunas) {
    const cel = celulaFicha(c.chave, card, reg, pvBruto);
    const t = cel ? textoDoValor(c, cel.valor) : '';
    if (!t) {
      if (c.obrigatoria) pendentes.push(c.rotulo);
      continue;
    }
    const l = porGrupo.get(c.grupo) ?? [];
    l.push({ rotulo: c.rotulo, valor: t });
    porGrupo.set(c.grupo, l);
  }
  const secoes = GRUPOS_FICHA.filter((g) => porGrupo.has(g)).map((g) => ({ titulo: g as string, campos: porGrupo.get(g) as CampoRel[] }));
  return { secoes, camposPendentes: pendentes };
}

export interface ObraRel {
  modelo_rotulo: string;
  etapas: Array<{ rotulo: string; feita: boolean; atual: boolean }>;
  feitas: number;
  total: number;
  previsto: string | null;
}

/** A obra do eletroposto para o relatório: sem valor e sem obs (o responsável da obra aparece nas seções: é pessoa, não dinheiro). Feita = antes da etapa atual. */
export function obraParaRelatorio(o: ObraEp): ObraRel {
  return {
    modelo_rotulo: o.modelo_rotulo,
    etapas: o.etapas.map((e, i) => ({
      rotulo: e.rotulo,
      feita: i < o.feitas || (o.concluido && e.chave === 'concluido'),
      atual: !o.falta_informar && !o.concluido && e.chave === o.etapa,
    })),
    feitas: o.feitas,
    total: o.total,
    previsto: o.previsto,
  };
}

export interface DocRel { slot: string; rotulo: string; mime: string; url: string }

export function montarRelatorio(a: {
  linha: Linha; codigo: string; cliente: string; emitidoEm: string; emitidoPor: string;
  corpo: CorpoRelatorio; obra: ObraRel | null; obraConcluida: boolean;
  documentos: DocRel[]; slotsPresentes: ReadonlySet<string>;
}) {
  const docsPend = CATALOGO[a.linha].filter((x) => x.obrigatorio && !a.slotsPresentes.has(x.chave)).map((x) => x.rotulo);
  const pendencias = { campos: a.corpo.camposPendentes, documentos: docsPend, obra_concluida: a.obraConcluida };
  return {
    cabecalho: { linha: a.linha, codigo: a.codigo, cliente: a.cliente, emitido_em: a.emitidoEm, emitido_por: a.emitidoPor },
    secoes: a.corpo.secoes,
    obra: a.obra,
    documentos: a.documentos,
    pendencias,
    preliminar: pendencias.campos.length > 0 || pendencias.documentos.length > 0 || !pendencias.obra_concluida,
  };
}
