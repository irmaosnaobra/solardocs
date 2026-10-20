// ─────────────────────────────────────────────────────────────────────────────
// DE QUEM É CADA DOCUMENTO E CADA CAMPO (leitura por IA do eletroposto, 19/10/2026; venda solar pelo card, 20/10/2026).
//
// Módulo PURO. O cadastro tem papéis (comprador, cedente, avalista, imóvel, ponto) e a venda tem documentos de várias pessoas.
// A IA pode errar de quem é um papel, e o prejuízo é concreto: o endereço da conta de luz de uma pessoa virar o endereço de outra,
// ou a conta da instalação (que no arrendamento costuma estar no nome do cedente) virar dado de pessoa. O prompt já pede o
// cuidado, mas quem GARANTE é o servidor, aqui: cada arquivo tem um dono (pelo item onde está, ou pelo tipo que a IA deu ao
// conteúdo) e cada campo só pode vir de arquivo do dono dele.
//
// Arquivo SEM dono claro (contrato assinado, procuração, anuência, laudos e `outros` quando a IA deu o tipo "outro" ou não falou
// dele em `documentos`) NÃO alimenta campo nenhum, nem de pessoa nem do ponto: só alimenta quem tem dono claro, pelo item ou
// pelo tipo que a IA deu ao conteúdo. A pessoa resolve dando um nome ao arquivo ou movendo para o item da pessoa.
//
// Os donos mudam de uma LINHA para outra (a mesma chave `conta_luz` é a da instalação no eletroposto e a da unidade geradora na
// venda solar), então cada linha tem a sua tabela. Sem a linha, vale a do eletroposto (o que sempre valeu).
// ─────────────────────────────────────────────────────────────────────────────
import type { Campo } from './cadastroVenda';

/**
 * Quem é o dono de um arquivo: as três pessoas, a conta da instalação, as duas contas que só classificam, o documento de
 * outra pessoa (só classifica) e o documento do imóvel. Venda solar: o titular da conta de luz (`titular_uc`), a unidade geradora
 * (`unidade_geradora`, dá o ponto) e as unidades beneficiárias (`unidade_beneficiaria`, dão `benef_N_*`).
 */
export type DonoArquivo =
  | 'comprador' | 'cedente' | 'avalista' | 'instalacao' | 'geradora' | 'beneficiaria' | 'outra_pessoa' | 'imovel'
  | 'titular_uc' | 'unidade_geradora' | 'unidade_beneficiaria';
/** A que papel do cadastro um campo pertence. */
export type PapelCampo = 'comprador' | 'cedente' | 'avalista' | 'imovel' | 'ponto' | 'titular_uc' | 'beneficiaria';
/** As linhas que têm leitura por IA. */
export type LinhaLeitura = 'eletroposto' | 'vendasolar';

/** Itens (e tipos que a IA dá ao conteúdo) que têm dono, no eletroposto. O que não está aqui não tem dono. */
export const DONO_DO_ITEM: Readonly<Record<string, DonoArquivo>> = {
  documento_titular: 'comprador',
  comprovante_endereco_comprador: 'comprador',
  documento_cedente: 'cedente',
  comprovante_endereco_cedente: 'cedente',
  documento_avalista: 'avalista',
  comprovante_endereco_avalista: 'avalista',
  documento_outra_pessoa: 'outra_pessoa',
  documento_imovel: 'imovel',
  conta_luz: 'instalacao',
  conta_luz_geradora: 'geradora',
  conta_luz_beneficiaria: 'beneficiaria',
};

/**
 * Itens (e tipos) que têm dono, na venda solar pelo card. A conta de luz (`conta_luz`) é a da UNIDADE GERADORA, onde vão as
 * placas: dá o ponto. A beneficiária dá só `benef_*`. As fotos de homologação (fachada, padrão, disjuntor, medidor) não têm dono.
 */
export const DONO_DO_ITEM_SOLAR: Readonly<Record<string, DonoArquivo>> = {
  documento_titular: 'comprador',
  comprovante_endereco_comprador: 'comprador',
  documento_titular_uc: 'titular_uc',
  documento_avalista: 'avalista',
  comprovante_endereco_avalista: 'avalista',
  documento_outra_pessoa: 'outra_pessoa',
  documento_imovel: 'imovel',
  conta_luz: 'unidade_geradora',
  conta_luz_beneficiaria: 'unidade_beneficiaria',
};

const donosDa = (linha: LinhaLeitura): Readonly<Record<string, DonoArquivo>> => (linha === 'vendasolar' ? DONO_DO_ITEM_SOLAR : DONO_DO_ITEM);

const CAMPOS_DO_PONTO: readonly string[] = ['endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta'];
const CAMPOS_DA_UNIDADE_GERADORA: readonly string[] = [...CAMPOS_DO_PONTO, 'uc_classe', 'consumo_medio_kwh'];

export function papelDoCampo(campo: Campo): PapelCampo {
  if (campo.startsWith('ced_')) return 'cedente';
  if (campo.startsWith('aval_')) return 'avalista';
  if (campo.startsWith('imovel_')) return 'imovel';
  if (campo.startsWith('tuc_')) return 'titular_uc';
  if (campo.startsWith('benef_')) return 'beneficiaria';
  if (CAMPOS_DA_UNIDADE_GERADORA.includes(campo)) return 'ponto';
  return 'comprador';   // inclui o representante da empresa (`rep_*`)
}

/**
 * Que campos cada dono de arquivo pode alimentar. A pessoa dá os campos DELA (o comprovante de endereço dela é o endereço dela,
 * nunca o do ponto). A conta da instalação dá SÓ o ponto: no arrendamento ela costuma estar no nome do cedente, e isso não a faz
 * documento de pessoa. Geradora, beneficiária e documento de outra pessoa só classificam o arquivo. O imóvel dá `imovel_*`.
 * Venda solar: a unidade geradora dá o ponto (e a classe e o consumo), a beneficiária só `benef_*`, o titular da UC só `tuc_*`.
 */
const PODE_ALIMENTAR: Readonly<Record<DonoArquivo, readonly PapelCampo[]>> = {
  comprador: ['comprador'],
  cedente: ['cedente'],
  avalista: ['avalista'],
  instalacao: ['ponto'],
  geradora: [],
  beneficiaria: [],
  outra_pessoa: [],
  imovel: ['imovel'],
  titular_uc: ['titular_uc'],
  unidade_geradora: ['ponto'],
  unidade_beneficiaria: ['beneficiaria'],
};

/**
 * O dono de um arquivo, a partir do item em que ele está e do tipo que a IA deu ao conteúdo.
 *  - o item tem dono e a IA deu ao conteúdo um tipo com OUTRO dono (CNH de uma pessoa no item de outra, conta da geradora no item
 *    da instalação, comprovante de pessoa no item da conta de luz...): 'conflito', e nada dele alimenta o cadastro;
 *  - o item tem dono (e o tipo concorda, ou a IA não deu tipo que tenha dono): vale o item;
 *  - o item não tem dono (`outros`, contrato...): vale o tipo dado ao conteúdo; sem tipo com dono, o arquivo não tem dono.
 */
export function donoDoArquivo(slot: string | undefined, tipo: string | undefined, linha: LinhaLeitura = 'eletroposto'): DonoArquivo | 'conflito' | undefined {
  const donos = donosDa(linha);
  const doItem = slot ? donos[slot] : undefined;
  const doTipo = tipo ? donos[tipo] : undefined;
  if (doItem && doTipo && doItem !== doTipo) return 'conflito';
  return doItem ?? doTipo;
}

export const NOTA_SEM_DONO = 'Não identifiquei de quem é este documento; dê um nome ao arquivo ou mova para o item da pessoa.';

/**
 * Por que o campo NÃO pode vir desse arquivo (null = pode). `dono` undefined = arquivo sem dono claro (em `outros`, contrato,
 * procuração..., com tipo "outro" ou fora de `documentos`): não alimenta campo nenhum.
 */
export function motivoDeDescarte(campo: Campo, dono: DonoArquivo | 'conflito' | undefined): string | null {
  if (!dono) return NOTA_SEM_DONO;
  if (dono === 'conflito') return 'O item e o conteúdo do documento são de pessoas ou de finalidades diferentes. Confira de quem é o documento.';
  if (PODE_ALIMENTAR[dono].includes(papelDoCampo(campo))) return null;
  if (dono === 'geradora' || dono === 'beneficiaria') {
    return 'A conta da geradora ou da beneficiária só classifica o documento e não preenche o cadastro.';
  }
  if (dono === 'unidade_beneficiaria') return 'A conta de uma unidade beneficiária só preenche a vaga dela (UC, titular e endereço), nunca o comprador nem a unidade geradora.';
  if (dono === 'outra_pessoa') return 'O documento de outra pessoa só classifica o arquivo e não preenche o cadastro.';
  return 'Dado de outra pessoa ou de outro papel: este documento não é a fonte deste campo.';
}
