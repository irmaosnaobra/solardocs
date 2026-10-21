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
// O relatório (pacote de homologação da engenharia parceira) NUNCA leva dinheiro, nem para sócio: cada seção sai de uma
// lista escrita de campos, sem herdar grupo de coluna.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { codigoCanonico } from './solarObras';
import {
  celulaDe, isoParaBR,
  type Coluna, type ColunaInterna, type Valor, type RegistroGestao,
} from './gestaoClientes';
import { colunasFichaPara, celulaFicha, type CardVendido } from './fichaEletroposto';
import { lerCoordenadas } from './coordenadas';
import { semDinheiro, semDinheiroEstreito } from './semDinheiro';

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
    // Os papéis (21/10/2026): o contratante (as chaves `documento_titular` e `comprovante_endereco_comprador` ficam, só mudou o
    // rótulo), o titular da homologação (`documento_titular_uc`, a conta de luz e a usina no nome dele) e o titular do financiamento.
    it('documento_titular', 'CNH ou documento do contratante', 'ambos', true),
    it('comprovante_endereco_comprador', 'Comprovante de endereço do contratante', 'ambos', false),
    it('documento_titular_uc', 'CNH ou documento do titular da homologação', 'ambos', false),
    it('documento_financiamento', 'CNH ou documento do titular do financiamento', 'ambos', false),
    it('comprovante_endereco_financiamento', 'Comprovante de endereço do titular do financiamento', 'ambos', false),
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
 * "documento com foto do TITULAR DA CONTA" de luz (veja `ARQUIVOS_SOLAR`), que nem sempre é o contratante: vira
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
  'documento_financiamento', 'comprovante_endereco_financiamento',
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
/**
 * Troca dois arquivos de item NUM só registro (atômico: quem grava, grava os dois). `idA` vai para o item de `idB` e `idB` para o
 * de `idA`. A trilha guarda só os itens novos, nunca rótulo nem nome.
 */
export function comArquivosTrocados(reg: RegistroDocs, idA: string, idB: string, por: string, em: string): RegistroDocs {
  const a = reg.arquivos.find((x) => x.id === idA);
  const b = reg.arquivos.find((x) => x.id === idB);
  if (!a || !b) return reg;
  return {
    ...reg,
    arquivos: reg.arquivos.map((x) => (x.id === idA ? { ...x, slot: b.slot } : x.id === idB ? { ...x, slot: a.slot } : x)),
    alteracoes: cortaTrilha([...reg.alteracoes, { em, por, acao: 'moveu', slot: b.slot }, { em, por, acao: 'moveu', slot: a.slot }]),
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

// ── Relatório de homologação ─────────────────────────────────────────────────
//
// O relatório é o pacote que a empresa manda à engenharia parceira para HOMOLOGAR o projeto (21/10/2026). Segue o formulário
// "Novo projeto" da engenharia, na mesma ordem e com os mesmos nomes:
//   1. Informações da concessionária   2. Informações do cliente   3. Informações da instalação
//   4. Especificações do projeto       5. Documentos complementares
// NUNCA leva valor, preço, sinal, forma de pagamento, banco, consultor, modelo da venda, datas de venda ou de contrato, etapa
// ou trilha da obra. Cada seção sai de uma lista ESCRITA de campos (nada herdado de grupo de coluna), então coluna nova da
// ficha não vaza para a engenharia.

export interface CampoRel { rotulo: string; valor: string }
export interface SecaoRel { numero: number; titulo: string; campos: CampoRel[] }

export const TITULOS_SECAO: Readonly<Record<number, string>> = {
  1: 'Informações da concessionária',
  2: 'Informações do cliente',
  3: 'Informações da instalação (unidade consumidora/geradora)',
  4: 'Especificações do projeto',
  5: 'Documentos complementares',
};

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

const ROTULO_MODALIDADE: Readonly<Record<string, string>> = {
  autoconsumo_local: 'Autoconsumo local', autoconsumo_remoto: 'Autoconsumo remoto',
  geracao_compartilhada: 'Geração compartilhada', multiplas_ucs: 'Várias unidades do mesmo titular',
};
const ROTULO_FORNECIMENTO: Readonly<Record<string, string>> = { monofasico: 'Monofásico', bifasico: 'Bifásico', trifasico: 'Trifásico' };

export interface BeneficiariaRel { n: number; uc: string; titular: string; documento: string; endereco: string; pct: string }
export interface RateioRel { modalidade: string; geradoraPct: string; beneficiarias: BeneficiariaRel[] }

/** Tudo que o relatório diz do projeto, já em texto. Cada linha (eletroposto, venda solar, solar da planilha) monta o seu. */
export interface DadosHomologacao {
  uf: string;
  concessionaria: string;
  tipo: 'PF' | 'PJ' | '';
  documento: string;
  nome: string;
  enderecoPonto: string;
  unidade: string;
  titularConta: string;
  /** null = não dá para saber (sem titular da conta e sem decisão no cadastro). */
  trocarTitularidade: boolean | null;
  disjuntorTipo: string;
  disjuntorA: string;
  /** O que o cadastro guardou ("latitude, longitude"); o relatório separa e valida. */
  coordenadas: string;
  trifasico: string;
  rateio: RateioRel | null;
  potencia: CampoRel;
  especificacoes: CampoRel[];
  materiais: string;
  /** Venda solar: a homologação fica com OUTRA pessoa (o cliente da seção 2 é ela, e o documento com foto é o dela). */
  homologacaoOutra?: boolean;
}

/** Texto livre que sai para a engenharia sem nada que pareça dinheiro (números e quantidades não passam por aqui). */
function limparTextos(d: DadosHomologacao): DadosHomologacao {
  return {
    ...d,
    // Nome, endereço e titular só perdem o que é claramente dinheiro; a regra larga é para o texto livre (materiais e especificações).
    nome: semDinheiroEstreito(d.nome), enderecoPonto: semDinheiroEstreito(d.enderecoPonto), titularConta: semDinheiroEstreito(d.titularConta), materiais: semDinheiro(d.materiais),
    especificacoes: d.especificacoes.map((e) => ({ ...e, valor: semDinheiro(e.valor) })),
  };
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Nome comparável: sem acento, minúsculo, só letras e dígitos separados por 1 espaço. */
export const nomeComparavel = (s: string): string =>
  semAcento(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * "Trocar titularidade?": a conta de luz está no nome de outra pessoa. A decisão do cadastro da venda solar (`outra_pessoa` no
 * titular da homologação) vale primeiro; sem ela, compara o titular da conta com o cliente (nomes normalizados). Sem titular
 * da conta e sem decisão, não há como saber (null).
 */
export function trocarTitularidade(nome: string, titularConta: string, decisaoSolar = ''): boolean | null {
  if (decisaoSolar === 'outra_pessoa') return true;
  if (!nomeComparavel(titularConta)) return decisaoSolar === 'contratante' ? false : null;
  if (!nomeComparavel(nome)) return null;
  return nomeComparavel(titularConta) !== nomeComparavel(nome);
}

export const rotuloFornecimento = (k: string): string => ROTULO_FORNECIMENTO[k] ?? '';
export const simNao = (v: boolean | null): string => (v === null ? '' : v ? 'Sim' : 'Não');

/** Percentual guardado ("33.33") como o relatório mostra ("33,33%"). */
const textoPct = (p: string): string => (p ? `${p.replace('.', ',')}%` : '');

export interface CorpoRelatorio { secoes: SecaoRel[]; camposPendentes: string[] }

export function corpoHomologacao(d: DadosHomologacao): CorpoRelatorio {
  const pendentes: string[] = [];
  const coord = d.coordenadas ? lerCoordenadas(d.coordenadas) : null;
  if (!coord) pendentes.push('Coordenadas (latitude e longitude)');
  else if (!coord.ok) pendentes.push('Coordenadas inválidas (latitude de -90 a 90, longitude de -180 a 180)');
  if (!d.disjuntorTipo) pendentes.push('Tipo de disjuntor');
  if (!d.disjuntorA) pendentes.push('Valor do disjuntor (A)');
  if (d.rateio && d.rateio.beneficiarias.length) {
    if (!d.rateio.modalidade) pendentes.push('Modalidade do rateio');
    for (const b of d.rateio.beneficiarias) {
      if (!b.uc) pendentes.push(`Unidade consumidora da beneficiária ${b.n}`);
      if (!b.titular) pendentes.push(`Titular da beneficiária ${b.n}`);
      if (!b.pct) pendentes.push(`Percentual da beneficiária ${b.n}`);
    }
  }

  const s3: CampoRel[] = [
    { rotulo: 'Endereço do ponto', valor: d.enderecoPonto },
    { rotulo: 'Unidade consumidora', valor: d.unidade },
    { rotulo: 'Titular da conta', valor: d.titularConta },
    { rotulo: 'Trocar titularidade?', valor: simNao(d.trocarTitularidade) },
    { rotulo: 'Tipo de disjuntor', valor: d.disjuntorTipo },
    { rotulo: 'Valor do disjuntor (A)', valor: d.disjuntorA },
    { rotulo: 'Latitude do projeto', valor: coord && coord.ok ? String(coord.lat) : '' },
    { rotulo: 'Longitude do projeto', valor: coord && coord.ok ? String(coord.lon) : '' },
    { rotulo: 'Rede trifásica', valor: d.trifasico },
  ];
  if (d.rateio && d.rateio.beneficiarias.length) {
    s3.push({ rotulo: 'Documento de rateio: modalidade', valor: ROTULO_MODALIDADE[d.rateio.modalidade] ?? '' });
    s3.push({ rotulo: 'Documento de rateio: percentual da geradora', valor: textoPct(d.rateio.geradoraPct) });
    for (const b of d.rateio.beneficiarias) {
      s3.push({ rotulo: `Beneficiária ${b.n}: unidade consumidora`, valor: b.uc });
      s3.push({ rotulo: `Beneficiária ${b.n}: titular`, valor: b.titular });
      if (b.documento) s3.push({ rotulo: `Beneficiária ${b.n}: CPF ou CNPJ`, valor: b.documento });
      if (b.endereco) s3.push({ rotulo: `Beneficiária ${b.n}: endereço`, valor: b.endereco });
      s3.push({ rotulo: `Beneficiária ${b.n}: percentual`, valor: textoPct(b.pct) });
    }
  }

  const secoes: SecaoRel[] = [
    { numero: 1, titulo: TITULOS_SECAO[1], campos: [
      { rotulo: 'Estado', valor: d.uf },
      { rotulo: 'Nome da concessionária', valor: d.concessionaria },
    ] },
    { numero: 2, titulo: TITULOS_SECAO[2], campos: [
      { rotulo: 'Pessoa física ou jurídica', valor: d.tipo === 'PF' ? 'Pessoa física' : d.tipo === 'PJ' ? 'Pessoa jurídica' : '' },
      { rotulo: d.tipo === 'PJ' ? 'CNPJ' : d.tipo === 'PF' ? 'CPF' : 'CPF ou CNPJ', valor: d.documento },
      { rotulo: 'Nome completo', valor: d.nome },
    ] },
    { numero: 3, titulo: TITULOS_SECAO[3], campos: s3 },
    { numero: 4, titulo: TITULOS_SECAO[4], campos: [d.potencia, ...d.especificacoes, { rotulo: 'Materiais', valor: d.materiais }] },
    { numero: 5, titulo: TITULOS_SECAO[5], campos: [] },
  ];
  return { secoes, camposPendentes: pendentes };
}

// ── Dados de cada linha ──────────────────────────────────────────────────────

const txtCad = (v: Valor | undefined): string => (v === null || v === undefined ? '' : String(v).trim());

/** O Estado do ponto: o `uf_ponto`; sem ele, a UF do endereço do cliente; sem ela, a da Cemig (MG). */
export function ufDoPonto(ufPonto: string, ufCliente: string, concessionaria: string): string {
  const a = ufPonto.trim().toUpperCase();
  if (a) return a;
  const b = ufCliente.trim().toUpperCase();
  if (b) return b;
  return nomeComparavel(concessionaria) === 'cemig' ? 'MG' : '';
}

/** PF/PJ pelo `tipo` do cadastro; sem ele, pelo tamanho do CPF/CNPJ. */
export function tipoDaPessoa(tipo: string, documento: string): 'PF' | 'PJ' | '' {
  if (tipo === 'PF' || tipo === 'PJ') return tipo;
  const n = documento.replace(/\D/g, '').length;
  return n === 14 ? 'PJ' : n === 11 ? 'PF' : '';
}

/** Eletroposto: a ficha (já com o cadastro por cima) e o `tipo` guardado no cadastro (para o PF/PJ). */
export function dadosEletroposto(card: CardVendido, reg: RegistroGestao, tipoCadastro: string): DadosHomologacao {
  const colunas = colunasFichaPara(true);
  const v = (k: string): string => {
    const c = celulaFicha(k, card, reg, null);
    const col = colunas.find((x) => x.chave === k);
    return c && col ? textoDoValor(col, c.valor) : '';
  };
  const documento = v('cpf_cnpj');
  const nome = v('cliente');
  const titular = v('titular_conta');
  const conc = v('concessionaria');
  return limparTextos({
    uf: ufDoPonto(v('uf_ponto'), v('uf'), conc),
    concessionaria: conc,
    tipo: tipoDaPessoa(tipoCadastro, documento),
    documento,
    nome,
    enderecoPonto: v('endereco_ponto'),
    unidade: v('unidade_consumidora'),
    titularConta: titular,
    trocarTitularidade: trocarTitularidade(nome, titular),
    disjuntorTipo: v('disjuntor_tipo'),
    disjuntorA: v('disjuntor_a'),
    coordenadas: v('coordenadas'),
    trifasico: v('trifasico'),
    rateio: null,
    potencia: { rotulo: 'Potência total (kW)', valor: v('potencia_kw') },
    especificacoes: [
      { rotulo: 'Equipamento', valor: v('equipamento') },
      { rotulo: 'Quantidade de carregadores', valor: v('qtd_carregadores') },
      { rotulo: 'Quantidade de plugs', valor: v('qtd_plugs') },
    ],
    materiais: v('materiais'),
  });
}

/** O que a venda da planilha (ligada ao card, ou a própria venda solar) diz do equipamento. */
export interface EquipamentoSolar {
  cliente: string; homologacao: string; uf: string; concessionaria: string;
  qtdPlaca: number | null; modeloPlaca: string; potPlaca: number | null;
  qtdInversor: number | null; modeloInversor: string; estrutura: string;
}

export function equipamentoDaPlanilha(cols: ColunaInterna[], celulasBrutas: string[], reg: RegistroGestao): EquipamentoSolar {
  const v = (k: string): Valor => {
    const c = cols.find((x) => x.chave === k);
    return c ? celulaDe(c, celulasBrutas[c.indice] ?? '', reg).valor : null;
  };
  const num = (k: string): number | null => { const x = v(k); return typeof x === 'number' && Number.isFinite(x) ? x : null; };
  return {
    cliente: txtCad(v('cliente')), homologacao: txtCad(v('homologacao')), uf: txtCad(v('uf')), concessionaria: txtCad(v('concessionaria')),
    qtdPlaca: num('qtd_placa'), modeloPlaca: txtCad(v('modelo_placa')), potPlaca: num('pot_placa'),
    qtdInversor: num('qtd_inversor'), modeloInversor: txtCad(v('modelo_inversor')), estrutura: txtCad(v('tipo_estrutura')),
  };
}

const num2 = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

function especificacoesSolar(e: EquipamentoSolar | null): Pick<DadosHomologacao, 'potencia' | 'especificacoes'> {
  const kwp = e && e.qtdPlaca && e.potPlaca ? (e.qtdPlaca * e.potPlaca) / 1000 : null;
  const qtdDe = (n: number | null, modelo: string, unidade: string): string =>
    (n && modelo ? `${n} × ${modelo}` : n ? `${n} ${unidade}` : modelo);
  const modeloPlaca = e ? [e.modeloPlaca, e.potPlaca && !/\d\s*w/i.test(e.modeloPlaca) ? `${num2(e.potPlaca)} W` : ''].filter(Boolean).join(' ') : '';
  const placas = e ? qtdDe(e.qtdPlaca, modeloPlaca, 'módulos') : '';
  const inversor = e ? qtdDe(e.qtdInversor, e.modeloInversor, 'inversores') : '';
  return {
    potencia: { rotulo: 'Potência total (kWp)', valor: kwp === null ? '' : num2(kwp) },
    especificacoes: [
      { rotulo: 'Módulos (placas)', valor: placas },
      { rotulo: 'Inversor', valor: inversor },
      { rotulo: 'Estrutura', valor: e ? e.estrutura : '' },
    ],
  };
}

/** O que o relatório lê do cadastro da venda (só `campos`, sem trilha). */
export interface CadastroLeitura { campos: Partial<Record<string, { valor: string } | undefined>> }

/** Venda solar pelo card: o cadastro do card manda; a venda da planilha ligada só completa (equipamento e, na falta, a concessionária). */
export function dadosVendaSolar(cad: CadastroLeitura | null, planilha: EquipamentoSolar | null, nomeCard: string): DadosHomologacao {
  const c = (k: string): string => cad?.campos[k]?.valor?.trim() ?? '';
  const conc = c('concessionaria') || (planilha ? planilha.concessionaria : '');
  const decisao = c('homologacao_mesmo');
  // O "cliente" do relatório é quem fica com a homologação: o titular da homologação (tuc_*) quando é outra pessoa; senão o contratante.
  const outra = decisao === 'outra_pessoa';
  const documento = outra ? c('tuc_cpf_cnpj') : c('cpf_cnpj');
  const nome = outra ? c('tuc_nome') : (c('nome') || nomeCard);
  const titular = c('titular_conta');
  const forn = c('uc_fornecimento');
  const beneficiarias: BeneficiariaRel[] = [];
  for (let n = 1; n <= 5; n++) {
    const b = { n, uc: c(`benef_${n}_uc`), titular: c(`benef_${n}_titular`), documento: c(`benef_${n}_doc`), endereco: c(`benef_${n}_endereco`), pct: c(`benef_${n}_pct`) };
    if (b.uc || b.titular || b.documento || b.endereco || b.pct) beneficiarias.push(b);
  }
  return limparTextos({
    uf: ufDoPonto(c('uf_ponto'), c('uf'), conc),
    concessionaria: conc,
    tipo: tipoDaPessoa(outra ? '' : c('tipo'), documento),
    documento,
    nome,
    enderecoPonto: c('endereco_ponto'),
    unidade: c('unidade_consumidora'),
    titularConta: titular,
    // Troca quando o titular ATUAL da conta de luz não é quem fica com a homologação.
    trocarTitularidade: trocarTitularidade(nome, titular),
    homologacaoOutra: outra,
    disjuntorTipo: rotuloFornecimento(forn),
    disjuntorA: c('disjuntor_a'),
    coordenadas: c('coordenadas'),
    trifasico: forn ? (forn === 'trifasico' ? 'Sim' : 'Não') : '',
    rateio: beneficiarias.length ? { modalidade: c('rateio_modalidade'), geradoraPct: c('geradora_pct'), beneficiarias } : null,
    ...especificacoesSolar(planilha),
    materiais: c('materiais'),
  });
}

/** Venda solar da planilha mãe (`solar`): não há cadastro nem campos de disjuntor ou coordenadas; o nome é o da homologação. */
export function dadosSolarPlanilha(e: EquipamentoSolar): DadosHomologacao {
  return {
    uf: ufDoPonto('', e.uf, e.concessionaria), concessionaria: e.concessionaria, tipo: '', documento: '', nome: e.homologacao || e.cliente,
    enderecoPonto: '', unidade: '', titularConta: '', trocarTitularidade: null, disjuntorTipo: '', disjuntorA: '', coordenadas: '',
    trifasico: '', rateio: null, ...especificacoesSolar(e), materiais: '',
  };
}

// ── Documentos por seção ─────────────────────────────────────────────────────

export interface DocBruto { slot: string; rotulo: string; mime: string; url: string }
/** `secao` (2, 3 ou 5) e `tipo` (slug do nome do arquivo no ZIP) vêm do servidor: a tela não tem mapa próprio. */
export interface DocRel extends DocBruto { secao: number; tipo: string; arquivo: string }

interface Destino { secao: number; tipo: string }
const COMPLEMENTOS: Record<string, Destino> = {
  documento_imovel: { secao: 5, tipo: 'documento-do-imovel' },
  padrao: { secao: 5, tipo: 'padrao-de-entrada' },
  outros: { secao: 5, tipo: 'outros' },
};
/** Só entra o que serve à engenharia. Contrato, procuração, anuência, ART, projeto, parecer, vistoria e documento de terceiro ficam de fora. */
const DESTINO_DOC: Record<Linha, Record<string, Destino>> = {
  solar: {
    documento: { secao: 2, tipo: 'documento-com-foto' },
    conta_luz: { secao: 3, tipo: 'conta-de-energia' },
    fachada: { secao: 5, tipo: 'fachada' },
    padrao: { secao: 5, tipo: 'padrao-de-entrada' },
    disjuntor: { secao: 5, tipo: 'disjuntor' },
    medidor: { secao: 5, tipo: 'medidor' },
    outros: { secao: 5, tipo: 'outros' },
  },
  eletroposto: {
    documento_titular: { secao: 2, tipo: 'documento-com-foto' },
    conta_luz: { secao: 3, tipo: 'conta-de-energia' },
    conta_luz_geradora: { secao: 5, tipo: 'conta-de-energia-geradora' },
    conta_luz_beneficiaria: { secao: 5, tipo: 'conta-de-energia-beneficiaria' },
    foto_local: { secao: 5, tipo: 'foto-do-local' },
    quadro_eletrico: { secao: 5, tipo: 'quadro-eletrico' },
    instalacao: { secao: 5, tipo: 'instalacao' },
    ...COMPLEMENTOS,
  },
  vendasolar: {
    documento_titular: { secao: 2, tipo: 'documento-com-foto' },
    documento_titular_uc: { secao: 2, tipo: 'documento-com-foto' },
    conta_luz: { secao: 3, tipo: 'conta-de-energia' },
    conta_luz_beneficiaria: { secao: 3, tipo: 'documento-de-rateio' },
    fachada: { secao: 5, tipo: 'fachada' },
    disjuntor: { secao: 5, tipo: 'disjuntor' },
    medidor: { secao: 5, tipo: 'medidor' },
    ...COMPLEMENTOS,
  },
};
/** O documento de quem é o titular ATUAL da conta: só entra quando há troca de titularidade. */
const SLOT_TITULAR_ATUAL: Partial<Record<Linha, string>> = { eletroposto: 'documento_cedente' };

/** O que a IA classificou como documento que NÃO serve à engenharia (mesmo guardado em `outros` ou em outro item). */
export const TIPOS_FORA_DA_HOMOLOGACAO: ReadonlySet<string> = new Set([
  ...SLOTS_FORA_DO_RELATORIO, 'contrato_assinado', 'procuracao', 'anuencia', 'vistoria', 'art', 'projeto', 'parecer_acesso',
]);

const ORDEM_TIPOS = ['documento-com-foto', 'conta-de-energia', 'documento-de-rateio', 'documento-do-titular-atual'];

/** Classifica os documentos por seção do formulário e dá o nome do arquivo no ZIP (`2-documento-com-foto`, `5-padrao-de-entrada-1`). */
export function classificarDocumentos(linha: Linha, docsTodos: DocBruto[], trocaTitularidade: boolean | null, homologacaoOutra = false): DocRel[] {
  const mapa = DESTINO_DOC[linha];
  // Venda solar: o documento com foto é o de quem fica com a homologação. Outra pessoa: o dela; o contratante: o dele, ou o do titular da homologação se só esse veio.
  const temContratante = docsTodos.some((d) => d.slot === 'documento_titular');
  const docs = linha !== 'vendasolar' ? docsTodos : docsTodos.filter((d) => (homologacaoOutra
    ? d.slot !== 'documento_titular' : d.slot !== 'documento_titular_uc' || !temContratante));
  const atual = SLOT_TITULAR_ATUAL[linha];
  const classificados: Array<DocBruto & Destino> = [];
  for (const d of docs) {
    const dest: Destino | null = d.slot === atual
      ? (trocaTitularidade === true ? { secao: 5, tipo: 'documento-do-titular-atual' } : null)
      : (mapa[d.slot] ?? null);
    if (dest) classificados.push({ ...d, ...dest });
  }
  const ordem = (t: string): number => { const i = ORDEM_TIPOS.indexOf(t); return i < 0 ? ORDEM_TIPOS.length : i; };
  classificados.sort((a, b) => a.secao - b.secao || ordem(a.tipo) - ordem(b.tipo));
  const contagem = new Map<string, number>();
  const total = new Map<string, number>();
  for (const d of classificados) total.set(d.tipo, (total.get(d.tipo) ?? 0) + 1);
  return classificados.map((d) => {
    const n = (contagem.get(d.tipo) ?? 0) + 1;
    contagem.set(d.tipo, n);
    // Seção 5 e o rateio levam sempre o número; a conta de energia e o documento com foto, só quando há mais de um.
    const numerado = d.secao === 5 || d.tipo === 'documento-de-rateio' || (total.get(d.tipo) ?? 0) > 1;
    return { slot: d.slot, rotulo: d.rotulo, mime: d.mime, url: d.url, secao: d.secao, tipo: d.tipo, arquivo: `${d.secao}-${d.tipo}${numerado ? `-${n}` : ''}` };
  });
}

export function montarRelatorio(a: {
  linha: Linha; codigo: string; cliente: string; emitidoEm: string;
  dados: DadosHomologacao; documentos: DocBruto[];
}) {
  const corpo = corpoHomologacao(a.dados);
  const documentos = classificarDocumentos(a.linha, a.documentos, a.dados.trocarTitularidade, !!a.dados.homologacaoOutra);
  const tem = (...tipos: string[]): boolean => documentos.some((d) => tipos.includes(d.tipo));
  const docsPend: string[] = [];
  if (!tem('documento-com-foto')) docsPend.push('Documento com foto do cliente');
  if (!tem('conta-de-energia')) docsPend.push('Conta de energia');
  if (!tem('padrao-de-entrada')) docsPend.push('Foto do padrão de entrada');
  if (!tem('disjuntor', 'quadro-eletrico')) docsPend.push(a.linha === 'eletroposto' ? 'Foto do disjuntor ou do quadro elétrico' : 'Foto do disjuntor');
  const benef = a.dados.rateio ? a.dados.rateio.beneficiarias.length : 0;
  if (benef > 0 && documentos.filter((d) => d.tipo === 'documento-de-rateio').length < benef) docsPend.push('Conta de energia das unidades beneficiárias');
  const pendencias = { campos: corpo.camposPendentes, documentos: docsPend };
  return {
    cabecalho: { linha: a.linha, codigo: a.codigo, cliente: a.cliente, emitido_em: a.emitidoEm },
    secoes: corpo.secoes,
    documentos,
    pendencias,
    preliminar: pendencias.campos.length > 0 || pendencias.documentos.length > 0,
  };
}
