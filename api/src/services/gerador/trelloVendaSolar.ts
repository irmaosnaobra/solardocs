// ─────────────────────────────────────────────────────────────────────────────
// CARTÃO DA VENDA SOLAR NO TRELLO (21/10/2026): o card vendido monta (ou atualiza) o cartão do quadro de homologação no padrão
// dos cartões que já existem lá. Este módulo tem as regras PURAS (título, etiquetas, checklists, descrição, casamento do cartão)
// e as chamadas ao Trello. A rota (`geradorVendaSolarTrello.ts`) junta as peças.
//
// Padrão medido no quadro: título `#NNNN - <Nome> - <Cidade> <UF>`; etiquetas do QUADRO (por nome, nunca criadas aqui); checklists
// BACKOFFICE e ENGENHARIA; descrição com telefone, e-mail, ligação e as linhas em negrito dos módulos e do inversor.
//
// Nada daqui põe valor pessoal em log. O motivo de um erro do Trello é só o status e um trecho curto da resposta (a URL, que leva
// key e token, nunca entra em mensagem).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import {
  normalizarNome, casarCartao, trelloFetch, comentarNoTrello,
  type CredenciaisTrello, type TrelloCard,
} from './dossieVenda';
import { camposDaBeneficiaria, MAX_BENEFICIARIAS, type Cadastro } from './cadastroVenda';

// ── Constantes do quadro ─────────────────────────────────────────────────────

/** Etiquetas de ligação, na grafia do quadro. */
export const ETIQUETA_LIGACAO: Readonly<Record<string, string>> = {
  monofasico: 'Monofásico 220V', bifasico: 'Bifásico', trifasico: 'Trifásico',
};
/** Rótulo da ligação como aparece na descrição do cartão. */
export const ROTULO_LIGACAO: Readonly<Record<string, string>> = {
  monofasico: 'Monofásico', bifasico: 'Bifásico', trifasico: 'Trifásico',
};
export const ETIQUETA_EXCEDENTES = 'EXDEDENTES';   // grafia do quadro
/** Equipes e FASTRACK: as únicas etiquetas que a pessoa pode pedir. As outras saem do cadastro. */
export const ETIQUETAS_EXTRA_PERMITIDAS: readonly string[] = [
  'Equipe Própria', 'Equipe Thiago Ari', 'Equipe Branco', 'Equipe Pablo', 'FASTRACK',
];
/** Grupos em que o cartão só pode ter UMA etiqueta. */
const GRUPOS_EXCLUSIVOS: ReadonlyArray<readonly string[]> = [
  Object.values(ETIQUETA_LIGACAO),
  ['Urbana', 'Rural'],
  ['Cemig', 'Equatorial'],
];

export const NOME_BACKOFFICE = 'BACKOFFICE';
export const NOME_ENGENHARIA = 'ENGENHARIA';
export const ITENS_BACKOFFICE: readonly string[] = [
  'Foto Disjuntor', 'Foto n° do Medidor', 'Foto Padrão', 'Doc - CNH ou Identidade (Se for CNPJ - contrato social)',
  'Conta de Energia', 'Procuração assinada', 'DataSheet Inversor', 'Telefone', 'Email', 'KMZ', 'Datasheet Modulo', 'Foto Fachada',
];
export const ITENS_ENGENHARIA: readonly string[] = [
  'Art Gerada', 'Art Paga', 'Projeto Feito', 'Parecer Aprovado', 'Montagem Iniciada', 'Montagem Finalizada', 'Vistoria Liberada',
];

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const limpa = (t: unknown, max = 200): string => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ── Título ───────────────────────────────────────────────────────────────────

/** Cidade e UF do fim de um endereço em uma linha ("Rua A, 10, Centro, Uberlândia - MG", "... Uberlândia/MG 38400-000"). */
export function cidadeUfDoEndereco(endereco: unknown): { cidade: string; uf: string } | null {
  const s = limpa(endereco, 300).replace(/[,\s-]*\d{5}-?\d{3}\s*$/, '').replace(/[.,;\s]+$/, '');
  const m = /([^,/\-–]+?)\s*[/,\-–]\s*([A-Za-z]{2})$/.exec(s);
  if (!m) return null;
  const uf = m[2].toUpperCase();
  const cidade = m[1].trim();
  return UFS.includes(uf) && cidade.length >= 2 && !/\d/.test(cidade) ? { cidade, uf } : null;
}

/** "Cidade UF" do cartão: a instalação (fim do endereço do ponto), senão o contratante (cidade e uf do cadastro), senão a cidade do card. */
export function localDoCartao(cad: Cadastro, cidadeDoCard: unknown): string {
  const v = (k: string): string => limpa((cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor, 80);
  const inst = cidadeUfDoEndereco(v('endereco_ponto'));
  if (inst) return `${inst.cidade} ${inst.uf}`;
  const cidade = v('cidade');
  const uf = v('uf').toUpperCase();
  if (cidade) return uf ? `${cidade} ${uf}` : cidade;
  return limpa(cidadeDoCard, 80);
}

/** `#NNNN - Nome - Cidade UF` com a venda ligada; `Nome - Cidade UF` sem ela. O nome é o do CARD (o negociador). */
export function tituloDoCartao(a: { codigoVenda: string | null; nome: string; local: string }): string {
  const nome = limpa(a.nome, 120) || 'Cliente';
  const corpo = a.local ? `${nome} - ${a.local}` : nome;
  return a.codigoVenda ? `${a.codigoVenda} - ${corpo}` : corpo;
}

/** Os dígitos do `#NNNN` que abre o título de um cartão (`#0061 - ...`, `#0064 - (Igor) ...`), ou null. */
export function numeroDoTitulo(titulo: string): string | null {
  const m = /^\s*#(\d+)(?!\d)/.exec(titulo);
  return m ? m[1] : null;
}

// ── Casamento do cartão ──────────────────────────────────────────────────────

export interface CartaoDoQuadro {
  id: string; name: string; idList: string; shortUrl?: string; url?: string;
  labels?: Array<{ id?: string; name?: string }>;
}
export interface CandidatoCartao { id: string; nome: string; lista: string | null }

export type Achado =
  | { tipo: 'achou'; cartao: CartaoDoQuadro; por: 'escolhido' | 'guardado' | 'numero' | 'nome' }
  | { tipo: 'empate'; candidatos: CartaoDoQuadro[]; motivo: string }
  | { tipo: 'nenhum' };

/**
 * Acha o cartão que já existe, nesta ordem: o que a pessoa escolheu (`card_id`, só vale se está entre os cartões abertos do
 * quadro), o guardado na ligação, o que abre com o MESMO `#NNNN` e, por último, o parecido pelo nome. Dois cartões possíveis em
 * qualquer passo = EMPATE (devolve os candidatos; nunca escolhe nem cria). Cartão achado só pelo nome e que já carrega OUTRO
 * `#NNNN` também vira empate: é de outra venda do mesmo nome.
 */
export function acharCartao(a: {
  cartoes: CartaoDoQuadro[]; escolhido?: string | null; guardado?: string | null; codigoVenda: string | null; nome: string;
}): Achado {
  const aberto = (id: string | null | undefined): CartaoDoQuadro | null => (id ? a.cartoes.find((c) => c.id === id) ?? null : null);
  const esc = aberto(a.escolhido);
  if (esc) return { tipo: 'achou', cartao: esc, por: 'escolhido' };
  const gua = aberto(a.guardado);
  if (gua) return { tipo: 'achou', cartao: gua, por: 'guardado' };

  const numero = a.codigoVenda ? numeroDoTitulo(a.codigoVenda) : null;
  if (numero) {
    const iguais = a.cartoes.filter((c) => {
      const n = numeroDoTitulo(c.name);
      return n !== null && Number(n) === Number(numero);
    });
    if (iguais.length === 1) return { tipo: 'achou', cartao: iguais[0], por: 'numero' };
    if (iguais.length > 1) return { tipo: 'empate', candidatos: iguais, motivo: 'mais de um cartão com o mesmo número' };
  }

  const { c, motivo } = casarCartao(a.cartoes as TrelloCard[], a.nome, '');
  if (c) {
    const dele = numeroDoTitulo(c.name);
    if (numero && dele !== null && Number(dele) !== Number(numero)) {
      return { tipo: 'empate', candidatos: [c as CartaoDoQuadro], motivo: 'o cartão parecido é de outra venda' };
    }
    return { tipo: 'achou', cartao: c as CartaoDoQuadro, por: 'nome' };
  }
  if (motivo === 'mais de um cartão parecido') {
    const palavras = normalizarNome(a.nome).split(' ').filter((p) => p.length >= 3);
    const pontos = a.cartoes.map((x) => ({ x, p: palavras.filter((w) => normalizarNome(x.name).includes(w)).length }));
    const topo = Math.max(0, ...pontos.map((y) => y.p));
    return { tipo: 'empate', candidatos: pontos.filter((y) => y.p === topo && topo >= 2).map((y) => y.x), motivo };
  }
  return { tipo: 'nenhum' };
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

const valorDe = (cad: Cadastro, k: string): string => limpa((cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor, 200);

/** O cadastro tem alguma unidade beneficiária (qualquer campo de qualquer vaga)? */
export function temBeneficiaria(cad: Cadastro): boolean {
  for (let n = 1; n <= MAX_BENEFICIARIAS; n++) if (camposDaBeneficiaria(n).some((k) => !!valorDe(cad, k))) return true;
  return false;
}

/** As etiquetas que o cadastro decide, pelo NOME do quadro. Ligação só quando `uc_fornecimento` está preenchido. */
export function etiquetasAutomaticas(cad: Cadastro): string[] {
  const nomes: string[] = [];
  const lig = ETIQUETA_LIGACAO[valorDe(cad, 'uc_fornecimento')];
  if (lig) nomes.push(lig);
  nomes.push(valorDe(cad, 'uc_classe') === 'rural' ? 'Rural' : 'Urbana');
  const conc = normalizarNome(valorDe(cad, 'concessionaria'));
  if (/\bcemig\b/.test(conc)) nomes.push('Cemig');
  else if (/\bequatorial\b/.test(conc)) nomes.push('Equatorial');
  if (temBeneficiaria(cad)) nomes.push(ETIQUETA_EXCEDENTES);
  return nomes;
}

/** As etiquetas extras que a pessoa pediu, conferidas contra a lista permitida. `invalidas`: o que não é equipe nem FASTRACK. */
export function validarEtiquetasExtra(pedidas: unknown): { validas: string[]; invalidas: string[] } {
  const validas: string[] = [];
  const invalidas: string[] = [];
  for (const p of Array.isArray(pedidas) ? pedidas : []) {
    const alvo = normalizarNome(String(p ?? ''));
    const nome = ETIQUETAS_EXTRA_PERMITIDAS.find((e) => normalizarNome(e) === alvo);
    if (nome) { if (!validas.includes(nome)) validas.push(nome); } else invalidas.push(limpa(p, 40));
  }
  return { validas, invalidas };
}

export interface EtiquetaDoQuadro { id: string; name: string }
export interface PlanoEtiquetas {
  /** Para pôr no cartão: existem no quadro e o cartão ainda não tem. */
  aplicar: EtiquetaDoQuadro[];
  /** O cartão já tem. */
  ja_tem: string[];
  /** Não existem no quadro (nunca se cria etiqueta). */
  ausentes: string[];
  /** O cartão já tem outra etiqueta do mesmo grupo: não se põe a segunda, a pessoa decide. */
  conflitos: Array<{ desejada: string; existente: string }>;
}

/** Compara o que se quer com o quadro e com o cartão (cartão novo = lista vazia). Só acrescenta; nunca tira etiqueta. */
export function planoDeEtiquetas(desejadas: readonly string[], doQuadro: readonly EtiquetaDoQuadro[], doCartao: readonly string[]): PlanoEtiquetas {
  const plano: PlanoEtiquetas = { aplicar: [], ja_tem: [], ausentes: [], conflitos: [] };
  const temNorm = doCartao.map(normalizarNome);
  for (const nome of desejadas) {
    const n = normalizarNome(nome);
    if (temNorm.includes(n)) { plano.ja_tem.push(nome); continue; }
    const grupo = GRUPOS_EXCLUSIVOS.find((g) => g.some((x) => normalizarNome(x) === n));
    const existente = grupo ? doCartao.find((e) => grupo.some((x) => normalizarNome(x) === normalizarNome(e))) : undefined;
    if (existente) { plano.conflitos.push({ desejada: nome, existente }); continue; }
    const q = doQuadro.find((e) => normalizarNome(e.name) === n);
    if (!q) { plano.ausentes.push(nome); continue; }
    if (!plano.aplicar.some((e) => e.id === q.id)) plano.aplicar.push(q);
  }
  return plano;
}

// ── Checklists ───────────────────────────────────────────────────────────────

export interface ItemPlano { nome: string; marcado: boolean }
export interface PlanoChecklists { BACKOFFICE: ItemPlano[]; ENGENHARIA: ItemPlano[] }

/**
 * O que cada item de BACKOFFICE exige para ficar marcado. Foto = o item do catálogo da venda solar com arquivo (do card ou do
 * dossiê da proposta ligada). Telefone e e-mail = o card e o cadastro têm. O resto fica desmarcado, e ENGENHARIA inteira também.
 */
export function planoDeChecklists(slots: ReadonlySet<string>, temTelefone: boolean, temEmail: boolean): PlanoChecklists {
  const tem = (...s: string[]): boolean => s.some((x) => slots.has(x));
  const marcado: Record<string, boolean> = {
    'Foto Disjuntor': tem('disjuntor'),
    'Foto n° do Medidor': tem('medidor'),
    'Foto Padrão': tem('padrao'),
    'Foto Fachada': tem('fachada'),
    'Doc - CNH ou Identidade (Se for CNPJ - contrato social)': tem('documento_titular', 'documento_titular_uc'),
    'Conta de Energia': tem('conta_luz'),
    'Procuração assinada': tem('procuracao'),
    Telefone: temTelefone,
    Email: temEmail,
  };
  return {
    BACKOFFICE: ITENS_BACKOFFICE.map((nome) => ({ nome, marcado: !!marcado[nome] })),
    ENGENHARIA: ITENS_ENGENHARIA.map((nome) => ({ nome, marcado: false })),
  };
}

export interface ChecklistDoCartao { id: string; name: string; checkItems?: Array<{ id: string; name: string; state?: string }> }

export interface PassoChecklist {
  nome: string;
  /** Checklist que o cartão ainda não tem: cria inteira, com os itens e as marcas. */
  criar: ItemPlano[] | null;
  /** Itens da checklist que já existe e que ficaram completos agora (id do item no Trello). Nunca se desmarca. */
  marcar: Array<{ idItem: string; nome: string }>;
}

/** Compara o plano com as checklists que o cartão já tem. Nome da checklist e dos itens por `normalizarNome` ("n°" vira "n"). */
export function passosDeChecklist(plano: PlanoChecklists, existentes: readonly ChecklistDoCartao[]): PassoChecklist[] {
  return ([[NOME_BACKOFFICE, plano.BACKOFFICE], [NOME_ENGENHARIA, plano.ENGENHARIA]] as const).map(([nome, itens]) => {
    const ja = existentes.find((c) => normalizarNome(c.name) === normalizarNome(nome));
    if (!ja) return { nome, criar: [...itens], marcar: [] };
    const marcar: Array<{ idItem: string; nome: string }> = [];
    for (const it of itens) {
      if (!it.marcado) continue;
      const no = (ja.checkItems ?? []).find((x) => normalizarNome(x.name) === normalizarNome(it.nome));
      if (no && no.state !== 'complete') marcar.push({ idItem: no.id, nome: it.nome });
    }
    return { nome, criar: null, marcar };
  });
}

// ── Descrição ────────────────────────────────────────────────────────────────

export function telefoneBonito(t: unknown): string {
  const s = String(t ?? '').replace(/\D/g, '');
  const n = s.startsWith('55') && s.length > 11 ? s.slice(2) : s;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return limpa(t, 30);
}

export interface EquipamentoProposta { qtdPlacas: number | null; modeloPlaca: string; potPlaca: number | null; qtdInversor: number | null; inversor: string }

/** Módulos e inversor da proposta ligada: as colunas (`qtd_placas`, `inversor`, `qtd_inversor`) e, no `dados`, `tab.mod`, `tab.pot` e `qtdInv`. */
export function equipamentoDaProposta(p: {
  qtd_placas: number | null; inversor: string | null; qtd_inversor: number | null; dados: Record<string, unknown>;
} | null): EquipamentoProposta | null {
  if (!p) return null;
  const tab = (p.dados.tab && typeof p.dados.tab === 'object' ? p.dados.tab : {}) as Record<string, unknown>;
  const item = (p.dados.item && typeof p.dados.item === 'object' ? p.dados.item : {}) as Record<string, unknown>;
  const inteiro = (x: unknown): number | null => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  const pot = Number(tab.pot);
  return {
    qtdPlacas: inteiro(p.qtd_placas) ?? inteiro(item.n),
    modeloPlaca: limpa(tab.mod, 80),
    potPlaca: Number.isFinite(pot) && pot > 0 ? Math.round(pot) : null,
    qtdInversor: inteiro(p.qtd_inversor) ?? inteiro(p.dados.qtdInv),
    inversor: limpa(p.inversor ?? tab.inv, 80),
  };
}

/**
 * A descrição no padrão do quadro: telefone, e-mail, ligação e as linhas em negrito `N - <módulo> <potência>` e `N - <inversor>`.
 * Linha sem dado não sai. Vai SÓ em cartão novo.
 */
export const AVISO_QUADRO_PUBLICO = 'Telefone e e-mail no gerador (quadro público).';

export function descricaoDoCartao(a: { telefone: string; email: string; ligacao: string; equip: EquipamentoProposta | null; publico?: boolean }): string {
  const linhas: string[] = [];
  // Quadro público: telefone e e-mail do cliente NÃO vão (qualquer um lê). Ficam só a ligação e os equipamentos.
  if (!a.publico) {
    if (a.telefone) linhas.push(telefoneBonito(a.telefone));
    if (a.email) linhas.push(a.email);
  }
  const lig = ROTULO_LIGACAO[a.ligacao];
  if (lig) linhas.push(lig);
  const e = a.equip;
  if (e && e.qtdPlacas && e.modeloPlaca) {
    const pot = e.potPlaca && !/\d\s*w\b/i.test(e.modeloPlaca) ? ` ${e.potPlaca}W` : '';
    linhas.push(`**${e.qtdPlacas} - ${e.modeloPlaca}${pot}**`);
  }
  if (e && e.qtdInversor && e.inversor) linhas.push(`**${e.qtdInversor} - ${e.inversor}**`);
  if (a.publico) linhas.push(AVISO_QUADRO_PUBLICO);
  return linhas.join('\n\n');
}

/** Cartão que já existia: a mesma ficha vai num comentário único (editado a cada envio), nunca na descrição. */
export function comentarioDaFicha(a: { titulo: string; descricao: string }): string {
  return [`**Ficha da venda solar: ${a.titulo}**`, '', a.descricao || '_Sem dados para a ficha._',
    '', `_Enviado pelo Gerador em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}._`].join('\n');
}

// ── Anexos ───────────────────────────────────────────────────────────────────

export interface AnexoPlano {
  /** Chave estável do arquivo (id do documento do card, ou `dossie:<caminho>`): é o que o registro guarda. */
  chave: string;
  slot: string;
  de: 'card' | 'dossie';
  caminho: string;
  mime: string;
  /** Nome no cartão: o rótulo do item, com número quando o item tem mais de um arquivo. Sem extensão. */
  nome: string;
  /** Já tem anexo no Trello deste cartão pelo dossiê antigo (`trello_anexo_id` com o mesmo cartão). */
  anexoAntigo?: string | null;
}

const EXT_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'image/heic': 'heic' };
export const extDoMime = (mime: string): string => EXT_MIME[mime.toLowerCase()] ?? 'bin';

/** Dá o nome de cada anexo: o rótulo do item; do segundo arquivo do mesmo item em diante, "rótulo 2", "rótulo 3". */
export function nomearAnexos<T extends { slot: string }>(itens: T[], rotulo: (slot: string) => string): Array<T & { nome: string }> {
  const contagem = new Map<string, number>();
  return itens.map((x) => {
    const n = (contagem.get(x.slot) ?? 0) + 1;
    contagem.set(x.slot, n);
    const base = limpa(rotulo(x.slot), 120);
    return { ...x, nome: n === 1 ? base : `${base} ${n}` };
  });
}

// ── Registro do que já foi enviado ───────────────────────────────────────────
// `system_state`, chave `trello_venda_solar:<card>`. SEM dado pessoal: só ids do Trello e chaves de arquivo. A chave pública do
// banco principal alcança esta tabela, então nada aqui dá acesso a nada: o pior que um registro adulterado faz é pular um anexo.

export const chaveRegistroTrello = (card: number): string => `trello_venda_solar:${card}`;
export interface RegistroTrello { card_id: string | null; comentario_id: string | null; anexados: Record<string, string> }
export const registroTrelloVazio = (): RegistroTrello => ({ card_id: null, comentario_id: null, anexados: {} });

export function lerRegistroBruto(value: unknown): RegistroTrello {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const r = registroTrelloVazio();
  if (typeof v.card_id === 'string' && /^[0-9a-f]{24}$/.test(v.card_id)) r.card_id = v.card_id;
  if (typeof v.comentario_id === 'string' && /^[0-9a-f]{24}$/.test(v.comentario_id)) r.comentario_id = v.comentario_id;
  if (v.anexados && typeof v.anexados === 'object' && !Array.isArray(v.anexados)) {
    for (const [k, id] of Object.entries(v.anexados as Record<string, unknown>)) {
      if (typeof id === 'string' && /^[0-9a-f]{24}$/.test(id) && k.length <= 200) r.anexados[k] = id;
    }
  }
  return r;
}

export async function lerRegistroTrello(card: number): Promise<RegistroTrello> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', chaveRegistroTrello(card)).maybeSingle();
  if (error) throw new Error('registro_trello_leitura');
  return lerRegistroBruto((data as { value?: unknown } | null)?.value);
}

export async function gravarRegistroTrello(card: number, reg: RegistroTrello): Promise<void> {
  const { error } = await supabase.from('system_state').upsert(
    { key: chaveRegistroTrello(card), value: reg, updated_at: new Date().toISOString() }, { onConflict: 'key' },
  );
  if (error) throw new Error('registro_trello_gravacao');
}

// ── Chamadas ao Trello ───────────────────────────────────────────────────────

export type Res<T> = { ok: true; dados: T } | { ok: false; motivo: string };
const API = 'https://api.trello.com/1';

async function chamar<T>(
  cred: CredenciaisTrello, metodo: 'GET' | 'POST' | 'PUT', caminho: string, params: Record<string, string> = {}, base = API,
): Promise<Res<T>> {
  const qs = new URLSearchParams({ ...params, key: cred.key, token: cred.token });
  try {
    const r = await trelloFetch(`${base}${caminho}?${qs.toString()}`, { method: metodo });
    const txt = await r.text();
    if (!r.ok) return { ok: false, motivo: `Trello respondeu ${r.status}${r.status === 401 ? ' (key ou token sem permissão)' : ''}: ${txt.slice(0, 120)}` };
    try { return { ok: true, dados: JSON.parse(txt) as T }; } catch { return { ok: true, dados: {} as T }; }
  } catch (err: unknown) {
    return { ok: false, motivo: String((err as Error)?.message || err).slice(0, 120) };
  }
}

export interface Quadro {
  nome: string | null;
  listas: Array<{ id: string; name: string }>;
  cartoes: CartaoDoQuadro[];
  etiquetas: EtiquetaDoQuadro[];
}

/** Lista, cartões abertos e etiquetas do quadro, numa chamada só. */
export async function lerQuadro(cred: CredenciaisTrello, boardId: string): Promise<Res<Quadro>> {
  const r = await chamar<{ name?: string; lists?: Array<{ id: string; name: string }>; cards?: CartaoDoQuadro[]; labels?: Array<{ id: string; name?: string }> }>(
    cred, 'GET', `/boards/${encodeURIComponent(boardId)}`,
    {
      lists: 'open', cards: 'open', labels: 'all', label_fields: 'name', label_limit: '1000', fields: 'name',
      list_fields: 'name', card_fields: 'name,idList,shortUrl,labels',
    },
    'https://trello.com/1',
  );
  if (!r.ok) return r;
  const q = r.dados;
  if (!Array.isArray(q.lists) || !Array.isArray(q.cards)) return { ok: false, motivo: 'o Trello não devolveu as listas e os cartões do quadro' };
  // Etiquetas: se a leitura do quadro não trouxe a lista, lê pela rota própria. Sem a lista o cartão nasceria sem etiqueta e a
  // resposta diria 200: aqui ou vêm as etiquetas, ou é erro.
  let labels = q.labels;
  if (!Array.isArray(labels)) {
    const l = await chamar<Array<{ id: string; name?: string }>>(cred, 'GET', `/boards/${encodeURIComponent(boardId)}/labels`, { fields: 'name', limit: '1000' });
    if (!l.ok) return l;
    if (!Array.isArray(l.dados)) return { ok: false, motivo: 'o Trello não devolveu as etiquetas do quadro' };
    labels = l.dados;
  }
  return {
    ok: true,
    dados: {
      nome: q.name ?? null,
      listas: q.lists,
      cartoes: q.cards,
      etiquetas: labels.filter((e) => e.name).map((e) => ({ id: e.id, name: String(e.name) })),
    },
  };
}

export async function criarCartaoCompleto(
  cred: CredenciaisTrello, a: { idList: string; nome: string; desc: string; idLabels: string[] },
): Promise<Res<{ id: string; url: string | null }>> {
  const r = await chamar<{ id?: string; shortUrl?: string; url?: string }>(cred, 'POST', '/cards', {
    idList: a.idList, name: a.nome, desc: a.desc, pos: 'top', ...(a.idLabels.length ? { idLabels: a.idLabels.join(',') } : {}),
  });
  if (!r.ok) return r;
  return r.dados.id ? { ok: true, dados: { id: r.dados.id, url: r.dados.shortUrl || r.dados.url || null } } : { ok: false, motivo: 'Trello criou mas não devolveu id' };
}

export async function adicionarEtiqueta(cred: CredenciaisTrello, cardId: string, idLabel: string): Promise<Res<unknown>> {
  return chamar(cred, 'POST', `/cards/${encodeURIComponent(cardId)}/idLabels`, { value: idLabel });
}

export async function listarChecklists(cred: CredenciaisTrello, cardId: string): Promise<Res<ChecklistDoCartao[]>> {
  return chamar<ChecklistDoCartao[]>(cred, 'GET', `/cards/${encodeURIComponent(cardId)}/checklists`, { checkItems: 'all', checkItem_fields: 'name,state' });
}

export async function criarChecklist(cred: CredenciaisTrello, cardId: string, nome: string, itens: readonly ItemPlano[]): Promise<Res<{ id: string; falhas: number }>> {
  const c = await chamar<{ id?: string }>(cred, 'POST', '/checklists', { idCard: cardId, name: nome });
  if (!c.ok) return c;
  const id = c.dados.id;
  if (!id) return { ok: false, motivo: 'Trello criou a checklist mas não devolveu id' };
  let falhas = 0;
  for (const it of itens) {
    const r = await chamar(cred, 'POST', `/checklists/${encodeURIComponent(id)}/checkItems`, { name: it.nome, checked: it.marcado ? 'true' : 'false', pos: 'bottom' });
    if (!r.ok) falhas++;
  }
  return { ok: true, dados: { id, falhas } };
}

export async function marcarItem(cred: CredenciaisTrello, cardId: string, idItem: string): Promise<Res<unknown>> {
  return chamar(cred, 'PUT', `/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(idItem)}`, { state: 'complete' });
}

export async function idsDosAnexos(cred: CredenciaisTrello, cardId: string): Promise<Res<Set<string>>> {
  const r = await chamar<Array<{ id?: string }>>(cred, 'GET', `/cards/${encodeURIComponent(cardId)}/attachments`, { fields: 'id' });
  return r.ok ? { ok: true, dados: new Set((r.dados ?? []).map((a) => String(a.id))) } : r;
}

export { comentarNoTrello };
