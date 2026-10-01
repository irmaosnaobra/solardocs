import { supabaseGerador, geradorComServiceKey } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// DOSSIÊ DA VENDA — os documentos que o cliente vendido precisa entregar.
//
// Quem fecha uma venda no /gerador vira, no dia seguinte, um cartão no quadro de
// homologação do Trello. Hoje o consultor junta CNH, conta de luz e as fotos do
// padrão no WhatsApp e reanexa tudo na mão — é onde some documento e onde a
// homologação atrasa. Aqui os arquivos sobem UMA vez, ficam na nuvem, e a API
// empurra os bytes pro cartão do cliente.
//
// TRÊS DECISÕES QUE O RESTO DO ARQUIVO SEGUE:
//
// 1. Bucket PRIVADO, e o upload passa pela API. CNH e conta de luz não podem
//    morar em bucket público — este repositório é público e a chave publishable
//    do /gerador está no fonte da página. Medido em 30/09/2026: com a chave
//    publishable dá pra gravar em `automacao-media` (bucket público, mídia de
//    marketing) mas NÃO dá pra criar bucket nem listar. Então o navegador não
//    tem como falar com um bucket privado — o caminho é browser → API →
//    service key.
//
// 2. Trello recebe os BYTES, não a URL. `POST /cards/{id}/attachments` aceita
//    `url=`, e seria mais barato, mas anexo por URL é um LINK: a signed url de
//    bucket privado vence e o cartão apodrece. Mandando multipart, o Trello
//    guarda a cópia dele e o anexo continua lá pra sempre.
//
// 3. O dossiê mora em `propostas.dados.dossie` (jsonb que já existe), não em
//    coluna nova. Não há acesso a migration daqui, e uma coluna que não existe
//    em produção derruba a tela inteira. O preço é o clobber do `dados`: a
//    gravação é sempre ler-mesclar-gravar NO SERVIDOR, e o front nunca manda
//    `dossie` dentro do `d` do formulário.
// ─────────────────────────────────────────────────────────────────────────────

export const BUCKET_DOSSIE = 'dossie-vendas';

/** Um espaço de arquivo no dossiê. `key` é estável — entra no caminho do
 *  Storage e nas requisições; mudar quebra o que já subiu. */
export interface SlotArquivo {
  key: string;
  label: string;
  dica: string;
  /** Aceita PDF além de imagem. Conta de luz chega em PDF o tempo todo; foto de
   *  fachada, não. */
  aceitaPdf: boolean;
}

/** Um campo de TEXTO do dossiê. Não tem anexo pra representar: vai pro Trello
 *  como comentário, junto dos arquivos, na mesma chamada. */
export interface SlotCampo {
  key: string;
  label: string;
  /** Coluna de `propostas` que pré-preenche o campo. O que foi orçado é o
   *  palpite inicial; o que foi INSTALADO é o que vale, e por isso é editável. */
  prefill?: 'qtd_placas' | 'inversor' | 'qtd_inversor';
  numerico?: boolean;
}

// A ordem é a que o Thiago pediu, e é a ordem em que a tela pergunta.
export const ARQUIVOS_SOLAR: SlotArquivo[] = [
  { key: 'documento',  label: 'CNH ou identidade',   dica: 'Documento com foto do titular da conta',  aceitaPdf: true },
  { key: 'conta_luz',  label: 'Conta de luz',        dica: 'A página com o consumo e a titularidade', aceitaPdf: true },
  { key: 'fachada',    label: 'Foto da fachada',     dica: 'A frente do imóvel, com o número',        aceitaPdf: false },
  { key: 'padrao',     label: 'Foto do padrão',      dica: 'A caixa do padrão de entrada',            aceitaPdf: false },
  { key: 'disjuntor',  label: 'Foto do disjuntor',   dica: 'O disjuntor geral, dentro do padrão',     aceitaPdf: false },
  { key: 'medidor',    label: 'Foto do relógio medidor', dica: 'O medidor da concessionária, com o número legível', aceitaPdf: false },
];

export const CAMPOS_SOLAR: SlotCampo[] = [
  { key: 'email',          label: 'E-mail do cliente' },
  { key: 'qtd_placa',      label: 'Quantidade de placas',    prefill: 'qtd_placas',   numerico: true },
  { key: 'marca_placa',    label: 'Marca da placa' },
  { key: 'qtd_inversor',   label: 'Quantidade de inversores', prefill: 'qtd_inversor', numerico: true },
  { key: 'marca_inversor', label: 'Marca do inversor',       prefill: 'inversor' },
];

export type TrelloStatus = 'pendente' | 'enviado' | 'falhou';

export interface ArquivoDossie {
  /** Caminho no Storage — NUNCA a signed url, que vence. */
  path: string;
  nome: string;
  tipo: string;
  bytes: number;
  em: string;
  trello_status: TrelloStatus;
  /** Id do anexo NO CARTÃO. É o que torna o reenvio idempotente: com id, o
   *  arquivo já está lá e não sobe de novo. */
  trello_anexo_id?: string | null;
  trello_motivo?: string | null;
}

export interface Dossie {
  versao: 1;
  atualizado_em: string;
  campos: Record<string, string>;
  arquivos: Record<string, ArquivoDossie[]>;
  trello: {
    card_id: string | null;
    card_nome: string | null;
    status: TrelloStatus;
    motivo: string | null;
    em: string | null;
    /** Id do comentário com a ficha técnica. Reenviar EDITA este comentário em
     *  vez de empilhar um novo a cada clique. */
    comentario_id?: string | null;
    /** `true` quando o cartão nasceu aqui. Muda duas coisas: a ficha técnica
     *  mora na DESCRIÇÃO (cartão novo, descrição vazia, ninguém a perde) em vez
     *  de comentário, e a tela diz "criei o cartão" em vez de "achei". */
    card_criado?: boolean;
    card_url?: string | null;
  };
}

/**
 * A INVARIANTE: um dossiê SEMPRE tem todos os slots, cada um uma lista. Nunca
 * `{}` vazio. Sem isso, a proposta antiga (sem `dossie`) volta com
 * `arquivos.documento === undefined` e o `.map` da tela quebra o histórico
 * inteiro — e quebra só pra quem já vendeu, que é quem mais usa.
 */
export function dossieVazio(): Dossie {
  const arquivos: Record<string, ArquivoDossie[]> = {};
  for (const slot of ARQUIVOS_SOLAR) arquivos[slot.key] = [];
  return {
    versao: 1,
    atualizado_em: new Date().toISOString(),
    campos: {},
    arquivos,
    trello: { card_id: null, card_nome: null, status: 'pendente', motivo: null, em: null, comentario_id: null },
  };
}

/** Normaliza o que veio do banco. Proposta antiga não tem `dossie`, e proposta
 *  gravada por versão anterior pode ter chave faltando — ler com `?? []` em 6
 *  lugares é como nasce o `undefined.map`. */
export function normalizarDossie(bruto: unknown): Dossie {
  const base = dossieVazio();
  if (!bruto || typeof bruto !== 'object') return base;
  const d = bruto as Partial<Dossie>;
  const arquivos: Record<string, ArquivoDossie[]> = {};
  for (const slot of ARQUIVOS_SOLAR) {
    const lista = (d.arquivos as Record<string, unknown>)?.[slot.key];
    arquivos[slot.key] = Array.isArray(lista) ? (lista as ArquivoDossie[]).filter((a) => a && typeof a.path === 'string') : [];
  }
  return {
    versao: 1,
    atualizado_em: typeof d.atualizado_em === 'string' ? d.atualizado_em : base.atualizado_em,
    campos: d.campos && typeof d.campos === 'object' ? { ...(d.campos as Record<string, string>) } : {},
    arquivos,
    trello: { ...base.trello, ...(d.trello && typeof d.trello === 'object' ? d.trello : {}) },
  };
}

/** Quantos arquivos o dossiê tem, e quantos slots estão vazios. É o número do
 *  badge da tela e o que decide se dá pra mandar pro Trello. */
export function resumoDossie(d: Dossie): { arquivos: number; slots_vazios: string[]; campos_vazios: string[] } {
  const slots_vazios = ARQUIVOS_SOLAR.filter((s) => (d.arquivos[s.key] || []).length === 0).map((s) => s.key);
  const campos_vazios = CAMPOS_SOLAR.filter((c) => !String(d.campos[c.key] || '').trim()).map((c) => c.key);
  const arquivos = ARQUIVOS_SOLAR.reduce((n, s) => n + (d.arquivos[s.key] || []).length, 0);
  return { arquivos, slots_vazios, campos_vazios };
}

// ── Leitura e gravação da proposta ───────────────────────────────────────────

export interface PropostaDossie {
  codigo: string;
  cliente_nome: string | null;
  cliente_cidade: string | null;
  cliente_uf: string | null;
  vendido: boolean;
  dados: Record<string, unknown>;
  dossie: Dossie;
  qtd_placas: number | null;
  inversor: string | null;
  qtd_inversor: number | null;
}

export async function lerProposta(codigo: string): Promise<PropostaDossie | null> {
  const { data, error } = await supabaseGerador
    .from('propostas')
    .select('codigo, cliente_nome, cliente_cidade, cliente_uf, vendido, dados, qtd_placas, inversor, qtd_inversor')
    .eq('codigo', codigo)
    .maybeSingle();
  if (error) {
    logger.error('dossie', 'falha lendo proposta', error);
    throw new Error('não consegui ler a proposta');
  }
  if (!data) return null;
  const dados = (data.dados && typeof data.dados === 'object' ? data.dados : {}) as Record<string, unknown>;
  return {
    codigo: data.codigo,
    cliente_nome: data.cliente_nome ?? null,
    cliente_cidade: data.cliente_cidade ?? null,
    cliente_uf: data.cliente_uf ?? null,
    vendido: !!data.vendido,
    dados,
    dossie: normalizarDossie(dados.dossie),
    qtd_placas: data.qtd_placas ?? null,
    inversor: data.inversor ?? null,
    qtd_inversor: data.qtd_inversor ?? null,
  };
}

/**
 * Ler-mesclar-gravar. A mescla acontece AQUI e só aqui: `dados` é um jsonb
 * inteiro e o PATCH do PostgREST substitui a coluna toda, então gravar
 * `{dados:{dossie}}` apagaria a proposta. Relê antes de escrever pra não
 * sobrescrever um upload que entrou no meio do caminho.
 */
export async function gravarDossie(codigo: string, mutar: (d: Dossie) => void): Promise<Dossie> {
  const p = await lerProposta(codigo);
  if (!p) throw new Error('proposta não encontrada');
  const dossie = p.dossie;
  mutar(dossie);
  dossie.atualizado_em = new Date().toISOString();
  const { data, error } = await supabaseGerador
    .from('propostas')
    .update({ dados: { ...p.dados, dossie } })
    .eq('codigo', codigo)
    .select('codigo');
  if (error) {
    logger.error('dossie', 'falha gravando dossiê', error);
    throw new Error('não consegui salvar');
  }
  if (!data || data.length === 0) throw new Error('proposta não encontrada');
  return dossie;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Garante o bucket privado. Idempotente: "já existe" é sucesso.
 *
 * Só funciona com a service key. Com a chave publishable o Supabase responde
 * 403 (medido), e aí o bucket precisa ser criado uma vez no painel — a mensagem
 * devolvida diz exatamente isso, em vez de "falhou".
 */
export async function garantirBucket(): Promise<{ ok: boolean; motivo?: string }> {
  const { error } = await supabaseGerador.storage.createBucket(BUCKET_DOSSIE, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
  });
  if (!error) return { ok: true };
  const msg = String((error as { message?: string }).message || error);
  if (/already exists|duplicate/i.test(msg)) return { ok: true };
  if (/row-level security|Unauthorized|Access denied|403/i.test(msg)) {
    return {
      ok: false,
      motivo: `sem permissão pra criar bucket. Crie "${BUCKET_DOSSIE}" (privado) no painel do Supabase, ou configure SUPABASE_GERADOR_SERVICE_KEY na Vercel.`,
    };
  }
  return { ok: false, motivo: msg };
}

export type SondaBucket = 'existe' | 'nao_existe' | 'indeterminado';

/**
 * O bucket existe?
 *
 * A PRIMEIRA VERSÃO DISTO MENTIA. Usava `list('')` e dizia "existe" quando o
 * erro era nulo — só que, medido em 30/09/2026, `list` devolve
 * `{error:null,data:[]}` tanto pro bucket vazio quanto pro bucket que NÃO
 * EXISTE. A tela de saúde mostrava verde num sistema que não subia arquivo
 * nenhum, que é pior do que não ter tela de saúde.
 *
 * `getBucket` responde certo — mas só com a service key. Com a chave
 * publishable ele responde "Bucket not found" até pro `automacao-media`, que
 * comprovadamente existe (dá pra gravar nele). Ou seja: sem service key não há
 * como saber, e o honesto é dizer que não se sabe.
 */
export async function sondarBucket(): Promise<SondaBucket> {
  if (!geradorComServiceKey) return 'indeterminado';
  const { error } = await supabaseGerador.storage.getBucket(BUCKET_DOSSIE);
  if (!error) return 'existe';
  const msg = String((error as { message?: string }).message || error);
  return /not found|NoSuchBucket/i.test(msg) ? 'nao_existe' : 'indeterminado';
}

const EXT_POR_TIPO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/heic': 'heic',
};

export function extensaoDe(mediaType: string, nome: string): string {
  const porTipo = EXT_POR_TIPO[mediaType.toLowerCase()];
  if (porTipo) return porTipo;
  const m = String(nome || '').match(/\.([a-zA-Z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : 'bin';
}

/** Caminho do arquivo no bucket. Começa com o código da proposta porque é assim
 *  que se confere, e se apaga, tudo de um cliente de uma vez. */
export function caminhoArquivo(codigo: string, slot: string, ext: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${codigo}/${slot}-${Date.now()}-${aleatorio}.${ext}`;
}

export async function assinar(path: string, segundos = 3600): Promise<string | null> {
  const { data } = await supabaseGerador.storage.from(BUCKET_DOSSIE).createSignedUrl(path, segundos);
  return data?.signedUrl ?? null;
}

// ── Trello ───────────────────────────────────────────────────────────────────

export interface CredenciaisTrello { key: string; token: string; }

export function credenciaisTrello(): CredenciaisTrello | null {
  const key = String(process.env.TRELLO_KEY || '').trim();
  const token = String(process.env.TRELLO_TOKEN || '').trim();
  return key && token ? { key, token } : null;
}

/** Ficha técnica que vai no comentário do cartão. Os 5 campos de texto do
 *  dossiê não têm anexo pra representar — sem este comentário eles simplesmente
 *  nunca chegariam no Trello. */
export function textoFichaTecnica(p: PropostaDossie, d: Dossie): string {
  const v = (k: string) => String(d.campos[k] || '').trim() || '—';
  const local = [p.cliente_cidade, p.cliente_uf].filter(Boolean).join(' / ') || '—';
  return [
    `**Dossiê da venda — ${p.cliente_nome || p.codigo}**`,
    '',
    `- Proposta: ${p.codigo}`,
    `- Cidade: ${local}`,
    `- E-mail: ${v('email')}`,
    `- Placas: ${v('qtd_placa')} x ${v('marca_placa')}`,
    `- Inversores: ${v('qtd_inversor')} x ${v('marca_inversor')}`,
    '',
    `_Enviado pelo Gerador em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}._`,
  ].join('\n');
}

async function trelloFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Sobe UM arquivo pro cartão, em multipart. O Trello passa a hospedar a cópia
 * dele — é isso que faz o anexo sobreviver ao vencimento da signed url.
 */
export async function anexarNoTrello(
  cred: CredenciaisTrello,
  cardId: string,
  nome: string,
  bytes: Buffer,
  mediaType: string,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const form = new FormData();
  form.append('name', nome);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mediaType || 'application/octet-stream' }), nome);
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/attachments?key=${cred.key}&token=${cred.token}`;
  try {
    const r = await trelloFetch(url, { method: 'POST', body: form });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, motivo: `Trello respondeu ${r.status}${r.status === 401 ? ' — key/token sem permissão de escrita' : ''}: ${txt.slice(0, 180)}` };
    }
    const j = JSON.parse(txt) as { id?: string };
    return j.id ? { ok: true, id: j.id } : { ok: false, motivo: 'Trello aceitou mas não devolveu id' };
  } catch (err: unknown) {
    return { ok: false, motivo: String((err as Error)?.message || err) };
  }
}

/** Cria ou EDITA o comentário da ficha técnica. Editar é o que impede o cartão
 *  de virar uma pilha de fichas iguais quando o consultor reenvia. */
export async function comentarNoTrello(
  cred: CredenciaisTrello,
  cardId: string,
  texto: string,
  comentarioId?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const qs = `key=${cred.key}&token=${cred.token}&text=${encodeURIComponent(texto)}`;
  const url = comentarioId
    ? `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(comentarioId)}/comments?${qs}`
    : `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions/comments?${qs}`;
  try {
    const r = await trelloFetch(url, { method: comentarioId ? 'PUT' : 'POST' });
    const txt = await r.text();
    if (!r.ok) {
      // Comentário editado some quando alguém apaga na mão. Nesse caso cria um
      // novo em vez de devolver erro — o objetivo é a ficha estar no cartão.
      if (comentarioId && (r.status === 404 || r.status === 400)) return comentarNoTrello(cred, cardId, texto, null);
      return { ok: false, motivo: `Trello respondeu ${r.status}: ${txt.slice(0, 180)}` };
    }
    const j = JSON.parse(txt) as { id?: string };
    return j.id ? { ok: true, id: j.id } : { ok: false, motivo: 'comentário sem id' };
  } catch (err: unknown) {
    return { ok: false, motivo: String((err as Error)?.message || err) };
  }
}

/**
 * O que falta pro dossiê funcionar de ponta a ponta, em campos separados.
 *
 * `pronto` só é `true` quando dá pra AFIRMAR que está tudo de pé. Bucket
 * indeterminado não vira `true` por otimismo: quem lê esta resposta decide se
 * manda o consultor usar, e um "pronto" errado manda ele subir documento num
 * lugar que não existe.
 */
export function saudeDossie(bucket: SondaBucket): {
  bucket: SondaBucket; service_key: boolean; trello: boolean; pronto: boolean; falta: string[];
} {
  const trello = !!credenciaisTrello();
  const falta: string[] = [];
  if (!geradorComServiceKey) falta.push('SUPABASE_GERADOR_SERVICE_KEY na Vercel — SEM ELA NÃO SOBE ARQUIVO NENHUM. Bucket privado novo não tem policy de escrita pra chave publishable, então o upload dá 403 mesmo com o bucket criado à mão.');
  if (bucket === 'nao_existe') falta.push(`o bucket privado "${BUCKET_DOSSIE}" no Supabase do Gerador`);
  if (bucket === 'indeterminado') falta.push(`conferir à mão se o bucket privado "${BUCKET_DOSSIE}" existe`);
  if (!trello) falta.push('TRELLO_KEY e TRELLO_TOKEN na Vercel (sem elas o arquivo sobe mas não vira anexo)');
  return { bucket, service_key: geradorComServiceKey, trello, pronto: bucket === 'existe' && trello, falta };
}

// ── Achar o cartão do cliente no quadro ──────────────────────────────────────
// Esta busca mora aqui, e não na rota, porque DUAS telas dependem dela: a aba
// "situação do cliente" e o envio do dossiê. Se cada uma casasse o cartão do seu
// jeito, o consultor veria "está em VISTORIA LIBERADA" numa e o anexo cairia em
// outro cartão — o pior tipo de erro, porque nada na tela denuncia.

export function normalizarNome(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface TrelloCard {
  id: string; name: string; idList: string;
  due?: string | null; shortUrl?: string; url?: string;
  labels?: Array<{ name?: string }>;
}

export interface CartaoAchado {
  quadro: string | null;
  cartao: {
    id: string;
    nome: string;
    lista: string | null;
    etiquetas: string[];
    prazo: string | null;
    url: string | null;
  } | null;
  motivo?: string;
}

/**
 * Casa por PALAVRA, não por igualdade: no quadro o cartão é "ELETROPOSTO #0001 -
 * Bruno Martins Lages - Itaobim MG" e a pasta diz "#0001 - Bruno Lages - Itaobim
 * MG". O número da pasta vale um ponto extra porque é o identificador que as
 * duas pontas já compartilham.
 *
 * Exigir 2 pontos é o que impede um sobrenome comum de escolher o cartão errado
 * sozinho — e um empate vira "não sei", nunca um chute.
 */
export function casarCartao(cartoes: TrelloCard[], cliente: string, num: string): { c: TrelloCard | null; motivo?: string } {
  const alvo = normalizarNome(cliente);
  const palavras = alvo.split(' ').filter((p) => p.length >= 3);
  let melhor: { c: TrelloCard; pontos: number } | null = null;
  let empatado = false;
  for (const c of cartoes) {
    const nome = normalizarNome(c.name);
    let pontos = palavras.filter((p) => nome.includes(p)).length;
    if (!pontos) continue;
    if (num && c.name.replace(/\D/g, '').includes(num)) pontos += 2;
    if (!melhor || pontos > melhor.pontos) { melhor = { c, pontos }; empatado = false; }
    else if (pontos === melhor.pontos) empatado = true;
  }
  // Ordem importa na explicação: um sobrenome comum casa 1 ponto em vários
  // cartões, e responder "mais de um parecido" pra quem nem está no quadro
  // manda o consultor procurar o que não existe.
  if (!melhor || melhor.pontos < 2) return { c: null, motivo: 'nenhum cartão casou' };
  if (empatado) return { c: null, motivo: 'mais de um cartão parecido' };
  return { c: melhor.c };
}

/**
 * Lê o quadro e devolve o cartão do cliente. Sem credencial nenhuma: o quadro é
 * PÚBLICO e já era lido assim pelo insightsService. Se um dia fechar, TRELLO_KEY
 * e TRELLO_TOKEN assinam a chamada sozinhos — e são as mesmas duas variáveis que
 * o anexo precisa, então configurar uma vez resolve as duas pontas.
 */
export async function buscarCartao(boardId: string, cliente: string, num: string): Promise<CartaoAchado> {
  const cred = credenciaisTrello();
  const auth = cred ? `&key=${cred.key}&token=${cred.token}` : '';
  const url = `https://trello.com/1/boards/${boardId}?lists=open&cards=open&fields=name` +
    `&list_fields=name&card_fields=name,idList,due,shortUrl,labels${auth}`;

  const r = await trelloFetch(url);
  if (!r.ok) throw new Error(`Trello respondeu ${r.status}${r.status === 401 ? ' — o quadro deixou de ser público' : ''}`);
  const quadro = await r.json() as { name?: string; lists?: Array<{ id: string; name: string }>; cards?: TrelloCard[] };
  const listas = quadro.lists || [];
  const { c, motivo } = casarCartao(quadro.cards || [], cliente, num);
  if (!c) return { quadro: quadro.name || null, cartao: null, motivo };
  return {
    quadro: quadro.name || null,
    cartao: {
      id: c.id,
      nome: c.name,
      lista: listas.find((l) => l.id === c.idList)?.name || null,
      etiquetas: (c.labels || []).map((e) => e.name).filter(Boolean) as string[],
      prazo: c.due ? new Date(c.due).toLocaleDateString('pt-BR') : null,
      url: c.shortUrl || c.url || null,
    },
  };
}

/**
 * Lista os cartões abertos do quadro, os mais parecidos primeiro.
 *
 * POR QUE ISTO EXISTE, e por que o casamento automático NÃO foi afrouxado:
 * medido no quadro real em 30/09/2026, o cartão do Wesler é "#0061 - Wesler
 * Vieira Andrade - Uberlândia MG" e a proposta diz só "Wesler" — uma palavra,
 * um ponto, abaixo do piso de dois. Baixar o piso pra um resolveria o Wesler e
 * criaria coisa pior: existe "#0060 - (Igor) Laurentino Neto- Catalão GO", onde
 * "(Igor)" é o indicador, não o cliente. Uma proposta de "Igor Cesar" casaria
 * com o cartão do Laurentino, a tela diria "enviado", e a CNH de um cliente
 * ficaria no cartão de outro sem ninguém ver.
 *
 * Então o automático continua recusando na dúvida, e quem escolhe é o
 * consultor — lendo o nome inteiro do cartão antes de clicar.
 */
export async function listarCartoes(boardId: string, cliente: string): Promise<{
  quadro: string | null;
  cartoes: Array<{ id: string; nome: string; lista: string | null; pontos: number }>;
}> {
  const cred = credenciaisTrello();
  const auth = cred ? `&key=${cred.key}&token=${cred.token}` : '';
  const url = `https://trello.com/1/boards/${boardId}?lists=open&cards=open&fields=name` +
    `&list_fields=name&card_fields=name,idList${auth}`;
  const r = await trelloFetch(url);
  if (!r.ok) throw new Error(`Trello respondeu ${r.status}`);
  const quadro = await r.json() as { name?: string; lists?: Array<{ id: string; name: string }>; cards?: TrelloCard[] };
  const listas = quadro.lists || [];
  const palavras = normalizarNome(cliente).split(' ').filter((p) => p.length >= 3);
  const cartoes = (quadro.cards || []).map((c) => {
    const nome = normalizarNome(c.name);
    return {
      id: c.id,
      nome: c.name,
      lista: listas.find((l) => l.id === c.idList)?.name || null,
      pontos: palavras.filter((p) => nome.includes(p)).length,
    };
  });
  // Parecido primeiro, e o resto em ordem alfabética: com 68 cartões, uma lista
  // fora de ordem é a mesma coisa que lista nenhuma.
  cartoes.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { quadro: quadro.name || null, cartoes };
}


// ── Criar o cartão da homologação ────────────────────────────────────────────
// Venda nova NÃO TEM cartão no quadro. Era o furo do desenho anterior: ele
// procurava um cartão que ainda não existe e, não achando, pedia pro consultor
// colar um link. Medido no quadro em 30/09/2026, "BASE DE CLIENTES" e "DAR
// ENTRADA" estão as duas com zero cartão — o cliente que acabou de fechar entra
// no quadro AGORA, e é o lançamento dos documentos que o coloca lá.

/** Lista onde o cartão nasce. "BASE DE CLIENTES" é a primeira do quadro e, pelo
 *  plano da Jornada do Cliente, é o único marco que não manda mensagem pro
 *  cliente — cartão nascendo não pode disparar "sua documentação entrou na
 *  concessionária" antes de ela ter entrado. */
export const LISTA_CARTAO_NOVO = 'BASE DE CLIENTES';

/**
 * Nome do cartão novo, no padrão do quadro MENOS o número.
 *
 * O quadro nomeia `#0064 - Cristiano Alves da Silva - Uberlândia MG`, e o
 * `#NNNN` é a ponte com a coluna CODIGO da Planilha Mestre. Quem cadastra na
 * planilha é que dá esse número, então a API NÃO o inventa: calcular "maior + 1"
 * acertaria o padrão e erraria a ponte no dia em que a planilha já tivesse dado
 * o 0065 pra outro projeto, ou em que duas vendas fechassem juntas. Cartão sem
 * número é visivelmente incompleto, e é assim que se pede o número; cartão com
 * número errado parece certo.
 */
export function nomeCartaoNovo(p: PropostaDossie): string {
  const local = [p.cliente_cidade, p.cliente_uf].filter(Boolean).join(' ');
  const nome = (p.cliente_nome || '').trim() || `Proposta ${p.codigo}`;
  return local ? `${nome} - ${local}` : nome;
}

/** Id da lista pelo NOME. Resolver por nome e não por id fixo porque lista
 *  recriada troca de id e o cartão passaria a nascer no limbo; `TRELLO_LISTA_ID`
 *  existe pra fixar à mão se um dia o nome mudar. */
export async function acharLista(boardId: string, nomeLista: string): Promise<{ id: string } | { motivo: string }> {
  const fixo = String(process.env.TRELLO_LISTA_ID || '').trim();
  if (fixo) return { id: fixo };
  const cred = credenciaisTrello();
  const auth = cred ? `&key=${cred.key}&token=${cred.token}` : '';
  const r = await trelloFetch(`https://trello.com/1/boards/${boardId}/lists?fields=name${auth}`);
  if (!r.ok) return { motivo: `Trello respondeu ${r.status} ao ler as listas` };
  const listas = await r.json() as Array<{ id: string; name: string }>;
  const alvo = normalizarNome(nomeLista);
  const achou = listas.find((l) => normalizarNome(l.name) === alvo);
  if (achou) return { id: achou.id };
  return { motivo: `não achei a lista "${nomeLista}" no quadro. Confira o nome, ou fixe TRELLO_LISTA_ID.` };
}

/** Cria o cartão. A ficha técnica vai na DESCRIÇÃO: cartão recém-nascido tem
 *  descrição vazia, e ali a informação fica visível sem ninguém abrir a aba de
 *  comentários. */
export async function criarCartao(
  cred: CredenciaisTrello,
  idList: string,
  nome: string,
  desc: string,
): Promise<{ ok: true; id: string; url: string | null } | { ok: false; motivo: string }> {
  const qs = new URLSearchParams({ idList, name: nome, desc, pos: 'top', key: cred.key, token: cred.token });
  try {
    const r = await trelloFetch(`https://api.trello.com/1/cards?${qs.toString()}`, { method: 'POST' });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, motivo: `Trello respondeu ${r.status}${r.status === 401 ? ' — key/token sem permissão de escrita' : ''}: ${txt.slice(0, 180)}` };
    }
    const j = JSON.parse(txt) as { id?: string; shortUrl?: string; url?: string };
    return j.id ? { ok: true, id: j.id, url: j.shortUrl || j.url || null } : { ok: false, motivo: 'Trello criou mas não devolveu id' };
  } catch (err: unknown) {
    return { ok: false, motivo: String((err as Error)?.message || err) };
  }
}
