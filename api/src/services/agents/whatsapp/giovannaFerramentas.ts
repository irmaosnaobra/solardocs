import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { cnpjValido, formatarCnpj, soDigitos } from '../../../utils/cnpj';

// ─────────────────────────────────────────────────────────────────────────────
// FERRAMENTAS DA GIOVANNA (atendente do SolarDoc para quem já tem conta).
//
// Ela passa a resolver na hora: consultar a conta, ver os erros recentes do
// usuário, alterar os dados da empresa (com travas) e abrir chamado com
// diagnóstico. Ela NÃO corrige código.
//
// Regras que seguram este arquivo:
//  • O usuário vem SEMPRE do telefone (ctx.userIds, resolvido pelo serviço).
//    Nenhuma entrada do modelo escolhe de quem é a conta.
//  • Escrita só com exatamente 1 conta casando o telefone. Com 0 ou 2+, recusa
//    e manda abrir chamado.
//  • A escrita tem lista FIXA de campos (razão social, fantasia, endereço,
//    cidade e CNPJ da tabela company). E-mail, WhatsApp e plano nunca passam
//    por aqui.
//  • A escrita é idempotente pelo id da fila: a fila refaz a mensagem inteira
//    quando o Claude cai no meio, e o cadastro não pode mudar nem avisar duas
//    vezes.
//  • Este módulo NÃO envia mensagem. Quem fala com o dono é o serviço, uma vez
//    por turno (ctx.avisosPendentes), e quem abre o chamado é o serviço
//    (ctx.escalar): um caminho de aviso só, sem ciclo de import.
// ─────────────────────────────────────────────────────────────────────────────

export interface AlteracaoAviso {
  campo: string;
  antes: string;
  depois: string;
  /** O registro em tech_issues existe? Se não, o valor antigo só está na reserva em system_state. */
  chamado?: boolean;
}

export interface GiovannaCtx {
  /** Usuários cujo WhatsApp casou com o telefone (todas as variantes do 9º dígito). */
  userIds: string[];
  /** A conta que o serviço roteou (a que ela atende). Leitura usa esta. */
  userId: string | null;
  /** Telefone só com dígitos, como a conversa chegou. */
  phone: string;
  chaveContato: string | null;
  /** Id da linha da message_queue. Sem ele, a escrita se recusa (sem idempotência não há retry seguro). */
  filaId: string | null;
  nome?: string | null;
  email?: string | null;
  /** Abre o chamado pela escalada que já existe (tech_issues + aviso ao Thiago), com a guarda de repetição. */
  escalar: (a: { area: string; descricao: string; diagnostico: string }) => Promise<{ aberto: boolean; jaTinha: boolean }>;
  /** O que mudou neste turno; o serviço manda UM aviso ao dono depois do laço. */
  avisosPendentes: AlteracaoAviso[];
}

// Uma reserva por PEDIDO dentro da mensagem: duas alterações diferentes no mesmo turno têm hashes
// diferentes e, portanto, chaves diferentes. O mesmo pedido repetido (retry) cai na mesma chave.
const CHAVE_ALTERACAO = (filaId: string, hash: string) => `giovanna_alteracao:${filaId}:${hash}`;
// A confirmação só vale com uma prévia do MESMO pedido, mostrada há no máximo 30 min.
const CHAVE_PREVIA = (quem: string, hash: string) => `giovanna_previa:${quem}:${hash}`;
const PREVIA_VALE_MS = 30 * 60_000;
const CHAVE_CNPJ = (userId: string) => `giovanna_cnpj:${userId}`;
const DIAS_ENTRE_TROCAS_DE_CNPJ = 90;
const TIMEOUT_RECEITA_MS = 5000;
export const AREA_ALTERACAO_CADASTRO = 'alteracao_cadastro';

// ─── definição das ferramentas (o que o modelo enxerga) ──────────────────────

export const GIOVANNA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'ver_minha_conta',
    description:
      'Consulta a conta de quem está falando: nome, e-mail, plano, data de cadastro, dados da empresa ' +
      '(razão social, nome fantasia, CNPJ, endereço, cidade, WhatsApp e se tem logo) e quantos documentos gerou nos últimos 30 dias. ' +
      'Use antes de afirmar qualquer coisa sobre o cadastro dele.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ver_erros_recentes',
    description:
      'Lista os erros registrados para esta conta nas últimas 48 horas (até 10), diz se a leitura automática por IA está fora do ar agora ' +
      '(ia_fora) e traz os chamados abertos deste telefone. Use quando ele reclamar que algo não funciona, deu erro ou travou.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'alterar_dados_empresa',
    description:
      'Altera dados do cadastro da EMPRESA dele. Campos aceitos: razao_social, nome_fantasia, endereco, cidade, cnpj. ' +
      'Nada além disso (e-mail, WhatsApp e plano NÃO se alteram por aqui). ' +
      'Chame SEMPRE primeiro com confirmado=false para obter a prévia (antes e depois) e mostre ao usuário. ' +
      'Só chame com confirmado=true depois de um sim claro dele a essa prévia. ' +
      'Na troca de CNPJ, a razão social e o nome fantasia passam a ser os da Receita.',
    input_schema: {
      type: 'object',
      properties: {
        campos: {
          type: 'object',
          description: 'Só os campos que vão mudar, com o valor novo.',
          properties: {
            razao_social: { type: 'string' },
            nome_fantasia: { type: 'string' },
            endereco: { type: 'string' },
            cidade: { type: 'string' },
            cnpj: { type: 'string' },
          },
        },
        confirmado: {
          type: 'boolean',
          description: 'false = só mostra a prévia, nada é gravado. true = grava (só depois do sim claro do usuário).',
        },
      },
      required: ['campos', 'confirmado'],
    },
  },
  {
    name: 'abrir_chamado',
    description:
      'Abre um chamado para o time (o Thiago é avisado). Use quando não der para resolver: pedido de mudar e-mail, WhatsApp ou plano, ' +
      'erro que persiste, telefone ligado a mais de uma conta. Em diagnostico, escreva o que você viu nos erros e na conta.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Área do problema, em minúsculas e sem espaço. Ex.: conta, cadastro, leitura_conta, pagamento.' },
        descricao: { type: 'string', description: 'O que o usuário pediu ou relatou, em poucas palavras.' },
        diagnostico: { type: 'string', description: 'O que você verificou: erros recentes, estado da conta, o que já tentou.' },
      },
      required: ['descricao', 'diagnostico'],
    },
  },
];

// ─── utilidades ──────────────────────────────────────────────────────────────

type Resultado = Record<string, unknown>;

const FUSO = 'America/Sao_Paulo';

function dataBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO });
}

function dataHoraBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function limparTexto(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const emBranco = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : '(em branco)');

const PLANO_LEGIVEL: Record<string, string> = {
  free: 'gratuito',
  pro: 'assinante (contrato antigo, teto de 90 documentos por mês)',
  ilimitado: 'assinante (documentos ilimitados)',
};

// Falha de leitura é falha, não resultado vazio: "sem erros", "IA no ar" e "sem empresa"
// seriam respostas falsas ditas com toda a confiança.
function falhaDeLeitura(onde: string, erro: unknown, uid: string | null): Resultado {
  logger.error('giovanna-ferramentas', `leitura falhou em ${onde}`, {
    user_id: uid, erro: String((erro as { message?: string } | null)?.message ?? erro).slice(0, 200),
  });
  return { ok: false, motivo: 'falha_ao_ler', aviso: 'Não consegui consultar agora. Não afirme nada sobre a conta e abra um chamado.', ...ORIENTA_CHAMADO };
}

// ─── 1. ver_minha_conta ──────────────────────────────────────────────────────

async function verMinhaConta(ctx: GiovannaCtx): Promise<Resultado> {
  const uid = ctx.userId;
  if (!uid) return { ok: false, motivo: 'conta_nao_identificada' };

  const { data: u, error: eU } = await supabase
    .from('users').select('nome, email, plano, created_at').eq('id', uid).maybeSingle();
  const { data: c, error: eC } = await supabase
    .from('company').select('nome, nome_fantasia, cnpj, endereco, cidade, whatsapp').eq('user_id', uid).maybeSingle();

  // Só true ou false: o base64 da logo é pesado e não interessa à conversa.
  const { count: comLogo, error: eL } = await supabase
    .from('company').select('user_id', { count: 'exact', head: true })
    .eq('user_id', uid).not('logo_base64', 'is', null).neq('logo_base64', '');

  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { count: docs30, error: eD } = await supabase
    .from('documents').select('id', { count: 'exact', head: true })
    .eq('user_id', uid).gte('created_at', desde);
  const { data: ultimo, error: eUlt } = await supabase
    .from('documents').select('created_at').eq('user_id', uid)
    .order('created_at', { ascending: false }).limit(1);

  // Leitura que falha NÃO pode virar "empresa não cadastrada" nem "0 documentos".
  const erroLeitura = eU || eC || eL || eD || eUlt;
  if (erroLeitura) return falhaDeLeitura('ver_minha_conta', erroLeitura, uid);

  return {
    ok: true,
    usuario: {
      nome: (u as { nome?: string } | null)?.nome ?? null,
      email: (u as { email?: string } | null)?.email ?? null,
      plano: PLANO_LEGIVEL[(u as { plano?: string } | null)?.plano ?? ''] ?? (u as { plano?: string } | null)?.plano ?? null,
      cadastrado_em: dataBR((u as { created_at?: string } | null)?.created_at),
    },
    empresa: c
      ? {
          razao_social: (c as Record<string, string | null>).nome ?? null,
          nome_fantasia: (c as Record<string, string | null>).nome_fantasia ?? null,
          cnpj: (c as Record<string, string | null>).cnpj ?? null,
          endereco: (c as Record<string, string | null>).endereco ?? null,
          cidade: (c as Record<string, string | null>).cidade ?? null,
          whatsapp: (c as Record<string, string | null>).whatsapp ?? null,
          tem_logo: (comLogo ?? 0) > 0,
        }
      : null,
    documentos_ultimos_30_dias: docs30 ?? 0,
    ultimo_documento_em: dataBR((ultimo as Array<{ created_at: string }> | null)?.[0]?.created_at),
  };
}

// ─── 2. ver_erros_recentes ───────────────────────────────────────────────────

/** true/false, ou null quando não deu para ler (nunca false por falha de leitura). */
async function iaForaAgora(): Promise<boolean | null> {
  const desdeHora = new Date(Date.now() - 3_600_000).toISOString();
  try {
    // O marcador de abandono e o carimbo do aviso agregado (filaAlerta).
    const { data: marcas, error: eMarcas } = await supabase
      .from('system_state').select('key')
      .or('key.like.ia_falha:ia_sem_credito:%,key.like.ia_falha:ia_chave:%,key.eq.ia_falha_aviso:ia_sem_credito,key.eq.ia_falha_aviso:ia_chave')
      .gte('updated_at', desdeHora)
      .limit(1);
    if (eMarcas) throw eMarcas;
    if ((marcas ?? []).length > 0) return true;

    // E o erro gravado na hora, sem esperar os 45 minutos da fila: o scan de
    // conta e a própria Giovanna gravam a `causa` em error_logs.detail.
    const { data: logs, error: eLogs } = await supabase
      .from('error_logs').select('id')
      .in('context', ['conta-scan', 'giovanna-ia-fora'])
      .in('detail->>causa', ['ia_sem_credito', 'ia_chave'])
      .gte('created_at', desdeHora)
      .limit(1);
    if (eLogs) throw eLogs;
    return (logs ?? []).length > 0;
  } catch (err) {
    logger.error('giovanna-ferramentas', 'não consegui ler o estado da IA', { erro: String((err as { message?: string } | null)?.message ?? err).slice(0, 200) });
    return null;
  }
}

async function verErrosRecentes(ctx: GiovannaCtx): Promise<Resultado> {
  const uid = ctx.userId;
  if (!uid) return { ok: false, motivo: 'conta_nao_identificada' };

  const desde = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data: erros, error: eErros } = await supabase
    .from('error_logs').select('created_at, context, message')
    .eq('detail->>user_id', uid)
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: chamados, error: eChamados } = await supabase
    .from('tech_issues').select('id, area, descricao, created_at')
    .eq('phone', ctx.phone).eq('status', 'aberto')
    .order('created_at', { ascending: false })
    .limit(5);

  if (eErros || eChamados) return falhaDeLeitura('ver_erros_recentes', eErros || eChamados, uid);

  const iaFora = await iaForaAgora();
  return {
    ok: true,
    ia_fora: iaFora,
    ...(iaFora === null ? { ia_fora_desconhecido: true, aviso: 'Não consegui ver se a IA está fora. Não afirme que está tudo no ar.' } : {}),
    erros_48h: ((erros ?? []) as Array<{ created_at: string; context: string; message: string }>).map(e => ({
      hora: dataHoraBR(e.created_at),
      contexto: e.context,
      mensagem: String(e.message ?? '').slice(0, 140),
    })),
    chamados_abertos: ((chamados ?? []) as Array<{ id: string; area: string; descricao: string; created_at: string }>).map(t => ({
      protocolo: String(t.id ?? '').slice(0, 8),
      area: t.area,
      aberto_em: dataHoraBR(t.created_at),
      resumo: String(t.descricao ?? '').slice(0, 120),
    })),
  };
}

// ─── 3. alterar_dados_empresa ────────────────────────────────────────────────

type ChaveCampo = 'razao_social' | 'nome_fantasia' | 'endereco' | 'cidade' | 'cnpj';
type ColunaCompany = 'nome' | 'nome_fantasia' | 'endereco' | 'cidade' | 'cnpj';

/** A lista FIXA. Qualquer outro campo que o modelo mande é ignorado. */
const CAMPOS: Readonly<Record<ChaveCampo, { coluna: ColunaCompany; rotulo: string; max: number }>> = Object.freeze({
  razao_social:  { coluna: 'nome',          rotulo: 'razão social',  max: 150 },
  nome_fantasia: { coluna: 'nome_fantasia', rotulo: 'nome fantasia', max: 150 },
  endereco:      { coluna: 'endereco',      rotulo: 'endereço',      max: 200 },
  cidade:        { coluna: 'cidade',        rotulo: 'cidade',        max: 80 },
  cnpj:          { coluna: 'cnpj',          rotulo: 'CNPJ',          max: 18 },
});

interface Mudanca { chave: ChaveCampo; coluna: ColunaCompany; campo: string; antes: string; depois: string }

interface ValorReserva {
  estado: 'reservado' | 'feito' | 'falhou';
  user_id: string;
  fila_id: string;
  em: string;
  hash: string;
  mudancas: Mudanca[];
  patch: Partial<Record<ColunaCompany, string>>;
  /** Os valores de ANTES, por coluna: é daqui que se desfaz se o chamado não foi gravado. */
  antes: Record<string, string>;
  registrado?: boolean;
  resultado?: Resultado;
}

function recusa(motivo: string, extra: Resultado = {}): Resultado {
  return { ok: false, aplicado: false, motivo, ...extra };
}

const ORIENTA_CHAMADO = { proximo_passo: 'abrir_chamado' };

interface Receita { razao_social: string; nome_fantasia: string }

async function consultarReceita(digitos: string): Promise<{ ok: true; receita: Receita } | { ok: false; resultado: Resultado }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_RECEITA_MS);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, { signal: ctrl.signal });
    if (res.status === 404) return { ok: false, resultado: recusa('cnpj_nao_encontrado_na_receita') };
    if (!res.ok) return { ok: false, resultado: recusa('receita_indisponivel', ORIENTA_CHAMADO) };
    const j = (await res.json()) as Record<string, unknown>;
    const descricao = String(j.descricao_situacao_cadastral ?? '').trim().toUpperCase();
    const ativa = descricao ? descricao === 'ATIVA' : Number(j.situacao_cadastral) === 2;
    if (!ativa) {
      return { ok: false, resultado: recusa('cnpj_nao_ativo', { situacao_na_receita: descricao || String(j.situacao_cadastral ?? 'desconhecida') }) };
    }
    return { ok: true, receita: { razao_social: limparTexto(j.razao_social), nome_fantasia: limparTexto(j.nome_fantasia) } };
  } catch {
    return { ok: false, resultado: recusa('receita_indisponivel', ORIENTA_CHAMADO) };
  } finally {
    clearTimeout(timer);
  }
}

type Linha = Record<string, string | null>;

/** Lança em erro de leitura: erro não pode virar "empresa não cadastrada". */
async function lerEmpresa(uid: string): Promise<Linha | null> {
  const { data, error } = await supabase
    .from('company').select('nome, nome_fantasia, endereco, cidade, cnpj').eq('user_id', uid).maybeSingle();
  if (error) throw new Error('leitura da empresa falhou: ' + error.message);
  return (data as Linha | null) ?? null;
}

const igual = (coluna: ColunaCompany, a: string | null | undefined, b: string | null | undefined) =>
  coluna === 'cnpj' ? soDigitos(a) === soDigitos(b) : String(a ?? '').trim() === String(b ?? '').trim();

/** Pedido normalizado (campos em ordem fixa, CNPJ só com dígitos). Dois pedidos iguais dão o mesmo hash. */
function hashDoPedido(pedidos: Array<{ chave: ChaveCampo; valor: string }>): string {
  const itens = pedidos
    .map(p => [p.chave, p.chave === 'cnpj' ? soDigitos(p.valor) : p.valor] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return createHash('sha1').update(JSON.stringify(itens)).digest('hex').slice(0, 16);
}

async function lerReserva(filaId: string, hash: string): Promise<{ value: ValorReserva } | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_ALTERACAO(filaId, hash)).maybeSingle();
  if (error) throw new Error('leitura da reserva falhou: ' + error.message);
  return data ? { value: (data as { value: ValorReserva }).value } : null;
}

async function gravarReserva(v: ValorReserva): Promise<boolean> {
  const { error } = await supabase.from('system_state')
    .update({ value: v, updated_at: new Date().toISOString() }).eq('key', CHAVE_ALTERACAO(v.fila_id, v.hash));
  if (error) logger.error('giovanna-ferramentas', 'não consegui atualizar a reserva da alteração', { fila_id: v.fila_id, erro: error.message });
  return !error;
}

type TravaCnpj = { estado: 'ok' } | { estado: 'erro' } | { estado: 'ocupado'; liberaEm: string | null };

/**
 * Trava de 1 troca de CNPJ a cada 90 dias, ATÔMICA e ANTES de escrever na empresa:
 * insert da chave, ou update condicional (só se a trava anterior tem mais de 90 dias).
 * Zero linhas = outra troca ocupa a janela, e a escrita não acontece. A trava que já é
 * desta mesma alteração (retry) conta como nossa.
 */
async function travarCnpj(uid: string, v: ValorReserva): Promise<TravaCnpj> {
  const chave = CHAVE_CNPJ(uid);
  const agora = new Date().toISOString();
  const valor = { fila_id: v.fila_id, hash: v.hash, em: agora, de: v.antes.cnpj ?? null, para: v.patch.cnpj ?? null };
  const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: agora });
  if (!error) return { estado: 'ok' };
  if ((error as { code?: string }).code !== '23505') {
    logger.error('giovanna-ferramentas', 'não consegui travar a troca de CNPJ', { user_id: uid, erro: error.message });
    return { estado: 'erro' };
  }
  const limite = new Date(Date.now() - DIAS_ENTRE_TROCAS_DE_CNPJ * 86_400_000).toISOString();
  const { data, error: eUp } = await supabase.from('system_state')
    .update({ value: valor, updated_at: agora }).eq('key', chave).lt('updated_at', limite).select('key');
  if (eUp) {
    logger.error('giovanna-ferramentas', 'não consegui renovar a trava de CNPJ', { user_id: uid, erro: eUp.message });
    return { estado: 'erro' };
  }
  if ((data ?? []).length > 0) return { estado: 'ok' };

  const { data: atual, error: eLe } = await supabase.from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
  if (eLe || !atual) return { estado: 'erro' };
  const a = atual as { value?: { fila_id?: string; hash?: string }; updated_at?: string };
  if (a.value?.fila_id === v.fila_id && a.value?.hash === v.hash) return { estado: 'ok' }; // retry da mesma alteração
  const libera = a.updated_at ? new Date(Date.parse(a.updated_at) + DIAS_ENTRE_TROCAS_DE_CNPJ * 86_400_000).toISOString() : null;
  return { estado: 'ocupado', liberaEm: dataBR(libera) };
}

async function soltarTravaCnpj(uid: string): Promise<void> {
  const { error } = await supabase.from('system_state').delete().eq('key', CHAVE_CNPJ(uid));
  if (error) logger.error('giovanna-ferramentas', 'não consegui soltar a trava de CNPJ', { user_id: uid, erro: error.message });
}

/** Trava, grava o patch, relê e confere. Idempotente: pode rodar de novo com o mesmo patch. */
async function aplicarEConferir(
  uid: string, v: ValorReserva, ctx: GiovannaCtx,
): Promise<Resultado> {
  if (v.patch.cnpj) {
    const t = await travarCnpj(uid, v);
    if (t.estado !== 'ok') {
      v.estado = 'falhou';
      v.resultado = t.estado === 'ocupado'
        ? recusa('cnpj_trocado_recentemente', { pode_trocar_de_novo_em: t.liberaEm, ...ORIENTA_CHAMADO })
        : recusa('falha_ao_travar_limite', ORIENTA_CHAMADO);
      await gravarReserva(v);
      return v.resultado;
    }
  }

  const { error } = await supabase.from('company').update(v.patch).eq('user_id', uid);
  if (error) {
    const violouUnico = (error as { code?: string }).code === '23505';
    v.estado = 'falhou';
    v.resultado = recusa(violouUnico ? 'cnpj_em_outra_conta' : 'falha_ao_gravar', violouUnico ? {} : ORIENTA_CHAMADO);
    await gravarReserva(v);
    if (v.patch.cnpj) await soltarTravaCnpj(uid);
    if (!violouUnico) logger.error('giovanna-ferramentas', 'alteração de cadastro falhou ao gravar', { user_id: uid, fila_id: v.fila_id, erro: error.message });
    return v.resultado;
  }

  // A escrita aconteceu. Se a releitura falhar, a alteração conta como feita (registra, avisa, fecha).
  let depois: Linha | null = null;
  let releu = true;
  try {
    depois = await lerEmpresa(uid);
  } catch (err) {
    releu = false;
    logger.error('giovanna-ferramentas', 'releitura da empresa falhou depois de gravar (a alteração vale)', {
      user_id: uid, fila_id: v.fila_id, erro: err instanceof Error ? err.message : String(err),
    });
  }
  if (releu && !(depois && v.mudancas.every(m => igual(m.coluna, depois![m.coluna], m.depois)))) {
    v.estado = 'falhou';
    v.resultado = recusa('conferencia_falhou', ORIENTA_CHAMADO);
    await gravarReserva(v);
    logger.error('giovanna-ferramentas', 'alteração de cadastro não conferiu na releitura', { user_id: uid, fila_id: v.fila_id });
    return v.resultado;
  }

  // Registro do que foi feito. O valor antigo fica aqui (e na reserva em system_state) para desfazer.
  // A busca é pelo JSON exato que este código escreve: "fila_id":"<id>","hash":"<hash>".
  const marca = `%"fila_id":"${v.fila_id}","hash":"${v.hash}"%`;
  const { data: jaTem, error: eBusca } = await supabase.from('tech_issues').select('id')
    .eq('area', AREA_ALTERACAO_CADASTRO).eq('phone', ctx.phone).like('descricao', marca).limit(1).maybeSingle();
  let registrado = !eBusca && !!jaTem;
  if (!eBusca && !jaTem) {
    const { error: eChamado } = await supabase.from('tech_issues').insert({
      phone: ctx.phone,
      nome: ctx.nome ?? null,
      area: AREA_ALTERACAO_CADASTRO,
      descricao: JSON.stringify({
        user_id: uid,
        fila_id: v.fila_id,
        hash: v.hash,
        antes: Object.fromEntries(v.mudancas.map(m => [m.coluna, m.antes])),
        depois: Object.fromEntries(v.mudancas.map(m => [m.coluna, m.depois])),
      }),
      diagnostico_automatico: 'cadastro alterado pela Giovanna após confirmação do usuário',
      status: 'resolvido_agente',
    });
    if (eChamado) logger.error('giovanna-ferramentas', 'não consegui registrar a alteração em tech_issues', { user_id: uid, fila_id: v.fila_id, erro: eChamado.message });
    else registrado = true;
  } else if (eBusca) {
    logger.error('giovanna-ferramentas', 'não consegui conferir o registro da alteração em tech_issues', { user_id: uid, fila_id: v.fila_id, erro: eBusca.message });
  }

  v.estado = 'feito';
  v.registrado = registrado;
  v.resultado = {
    ok: true,
    aplicado: true,
    mudancas: v.mudancas.map(m => ({ campo: m.campo, antes: emBranco(m.antes), depois: emBranco(m.depois) })),
    conferido: releu,
    ...(releu ? {} : { aviso: 'A alteração foi gravada, mas não consegui reler para conferir.' }),
  };
  await gravarReserva(v);

  for (const m of v.mudancas) {
    if (!igual(m.coluna, m.antes, m.depois)) ctx.avisosPendentes.push({ campo: m.campo, antes: m.antes, depois: m.depois, chamado: registrado });
  }
  return v.resultado;
}

async function alterarDadosEmpresa(input: Record<string, unknown>, ctx: GiovannaCtx): Promise<Resultado> {
  // Identidade: o telefone tem que casar com UMA conta.
  if (ctx.userIds.length === 0) return recusa('conta_nao_identificada', ORIENTA_CHAMADO);
  if (ctx.userIds.length > 1) return recusa('telefone_em_mais_de_uma_conta', ORIENTA_CHAMADO);
  const uid = ctx.userIds[0]!;
  const confirmado = input.confirmado === true;

  // Só os campos da lista. O resto é ignorado e dito de volta ao modelo.
  const bruto = (input.campos && typeof input.campos === 'object' ? input.campos : {}) as Record<string, unknown>;
  const ignorados = Object.keys(bruto).filter(k => !(k in CAMPOS));
  const pedidos: Array<{ chave: ChaveCampo; valor: string }> = [];
  for (const chave of Object.keys(CAMPOS) as ChaveCampo[]) {
    if (!(chave in bruto)) continue;
    const valor = limparTexto(bruto[chave]);
    if (!valor) { ignorados.push(`${chave} (vazio)`); continue; }
    if (valor.length > CAMPOS[chave].max) return recusa('valor_longo_demais', { campo: CAMPOS[chave].rotulo, maximo: CAMPOS[chave].max });
    pedidos.push({ chave, valor });
  }
  if (pedidos.length === 0) {
    return recusa('nenhum_campo_valido', { campos_aceitos: Object.keys(CAMPOS), ignorados });
  }

  if (confirmado && !ctx.filaId) return recusa('sem_id_da_mensagem', ORIENTA_CHAMADO);

  const hash = hashDoPedido(pedidos);
  const quem = ctx.chaveContato || soDigitos(ctx.phone);

  if (confirmado) {
    // Retry da fila (ou o modelo repetindo o mesmo pedido): se ESTE pedido já foi feito, devolve o que foi.
    // Pedido DIFERENTE na mesma mensagem tem outro hash e, portanto, outra reserva: é uma alteração nova.
    const r = await lerReserva(ctx.filaId!, hash);
    if (r) {
      if (r.value.user_id !== uid) return recusa('conta_nao_identificada', ORIENTA_CHAMADO);
      if (r.value.estado === 'reservado') {
        // A rodada anterior caiu entre reservar e terminar. O patch guardado é idempotente: refaz e confere.
        return aplicarEConferir(uid, r.value, ctx);
      }
      return { ...(r.value.resultado ?? recusa('alteracao_ja_processada')), ja_feito_antes: true };
    }

    // A confirmação tem que casar com uma prévia (mesmo pedido) mostrada nos últimos 30 min.
    const { data: previa, error: ePrevia } = await supabase.from('system_state').select('value').eq('key', CHAVE_PREVIA(quem, hash)).maybeSingle();
    if (ePrevia) return falhaDeLeitura('alterar_dados_empresa', ePrevia, uid);
    const pv = (previa as { value?: { hash?: string; em?: string; fila_id?: string | null } } | null)?.value;
    const idade = pv?.em ? Date.now() - Date.parse(pv.em) : Infinity;
    if (!pv || pv.hash !== hash || !(idade >= 0 && idade <= PREVIA_VALE_MS)) {
      return recusa('previa_necessaria', { aviso: 'Chame primeiro com confirmado=false, mostre a prévia ao usuário e espere o sim claro.' });
    }
    // O sim tem que vir numa mensagem POSTERIOR à da prévia. Prévia e confirmação na mesma mensagem
    // (mesmo id da fila) significa que o modelo respondeu "sim" por ele. O retry da mensagem que
    // confirma continua valendo: o id dela é diferente do da prévia.
    if (pv.fila_id && pv.fila_id === ctx.filaId) {
      return recusa('previa_necessaria', { aviso: 'Mostre a prévia e espere a resposta do usuário numa próxima mensagem' });
    }
  }

  let atual: Linha | null;
  try {
    atual = await lerEmpresa(uid);
  } catch (err) {
    return falhaDeLeitura('alterar_dados_empresa', err, uid);
  }
  if (!atual) return recusa('empresa_nao_cadastrada', { orientacao: 'cadastrar a empresa em Empresa, no app' });

  // Monta o plano de mudança.
  const mudancas: Mudanca[] = [];
  const patch: Partial<Record<ColunaCompany, string>> = {};
  const semMudanca: string[] = [];
  const observacoes: string[] = [];

  const pedidoCnpj = pedidos.find(p => p.chave === 'cnpj');
  const pedidoFantasia = pedidos.find(p => p.chave === 'nome_fantasia');
  let cnpjMudou = false;

  if (pedidoCnpj) {
    const digitos = soDigitos(pedidoCnpj.valor);
    if (igual('cnpj', atual.cnpj, digitos)) {
      semMudanca.push('CNPJ');
    } else {
      if (!cnpjValido(digitos)) return recusa('cnpj_invalido');

      // Unicidade só por DÍGITOS: o banco pode guardar o CNPJ com qualquer máscara. O ilike traz os
      // candidatos (curinga entre os grupos de dígitos) e a igualdade exata dos dígitos decide em código.
      const curinga = '*' + (digitos.match(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/) ?? []).slice(1).join('*') + '*';
      const { data: candidatas, error: eOutra } = await supabase
        .from('company').select('user_id, cnpj')
        .ilike('cnpj', curinga)
        .neq('user_id', uid)
        .limit(50);
      if (eOutra) return recusa('falha_ao_verificar_cnpj', ORIENTA_CHAMADO);
      const donaDoCnpj = ((candidatas ?? []) as Array<{ user_id: string; cnpj: string | null }>)
        .some(c => c.user_id !== uid && soDigitos(c.cnpj) === digitos);
      if (donaDoCnpj) return recusa('cnpj_em_outra_conta', ORIENTA_CHAMADO);

      // Uma troca a cada 90 dias por usuário (aqui a recusa cedo; a trava de verdade é atômica, em aplicarEConferir).
      const { data: troca, error: eTroca } = await supabase.from('system_state').select('updated_at').eq('key', CHAVE_CNPJ(uid)).maybeSingle();
      if (eTroca) return recusa('falha_ao_verificar_limite', ORIENTA_CHAMADO); // sem ler o limite, não troca
      const ultima = (troca as { updated_at?: string } | null)?.updated_at;
      if (ultima) {
        const liberaEm = new Date(new Date(ultima).getTime() + DIAS_ENTRE_TROCAS_DE_CNPJ * 86_400_000);
        if (liberaEm.getTime() > Date.now()) {
          return recusa('cnpj_trocado_recentemente', { pode_trocar_de_novo_em: dataBR(liberaEm.toISOString()), ...ORIENTA_CHAMADO });
        }
      }

      const rec = await consultarReceita(digitos);
      if (!rec.ok) return rec.resultado;

      cnpjMudou = true;
      const novoCnpj = formatarCnpj(digitos);
      mudancas.push({ chave: 'cnpj', coluna: 'cnpj', campo: CAMPOS.cnpj.rotulo, antes: String(atual.cnpj ?? ''), depois: novoCnpj });
      patch.cnpj = novoCnpj;

      // Na troca de CNPJ, o nome vem da Receita; a fantasia também, salvo se o usuário pediu outra.
      const razao = rec.receita.razao_social;
      if (razao && !igual('nome', atual.nome, razao)) {
        mudancas.push({ chave: 'razao_social', coluna: 'nome', campo: CAMPOS.razao_social.rotulo, antes: String(atual.nome ?? ''), depois: razao });
      }
      if (razao) patch.nome = razao;
      const fantasia = pedidoFantasia ? pedidoFantasia.valor : rec.receita.nome_fantasia;
      if (!igual('nome_fantasia', atual.nome_fantasia, fantasia)) {
        mudancas.push({ chave: 'nome_fantasia', coluna: 'nome_fantasia', campo: CAMPOS.nome_fantasia.rotulo, antes: String(atual.nome_fantasia ?? ''), depois: fantasia });
      }
      patch.nome_fantasia = fantasia;
      if (pedidos.some(p => p.chave === 'razao_social')) {
        observacoes.push('Na troca de CNPJ a razão social é a da Receita; a que o usuário digitou foi desconsiderada.');
      }
    }
  }

  for (const p of pedidos) {
    if (p.chave === 'cnpj') continue;
    if (cnpjMudou && (p.chave === 'razao_social' || p.chave === 'nome_fantasia')) continue; // já tratados acima
    const { coluna, rotulo } = CAMPOS[p.chave];
    if (igual(coluna, atual[coluna], p.valor)) { semMudanca.push(rotulo); continue; }
    mudancas.push({ chave: p.chave, coluna, campo: rotulo, antes: String(atual[coluna] ?? ''), depois: p.valor });
    patch[coluna] = p.valor;
  }

  if (mudancas.length === 0) {
    return { ok: true, aplicado: false, sem_mudanca: true, campos_iguais_ao_atual: semMudanca, ignorados };
  }

  const legivel = mudancas.map(m => ({ campo: m.campo, hoje: emBranco(m.antes), vai_ficar: emBranco(m.depois) }));

  if (!confirmado) {
    // Amarra a prévia à confirmação: o hash do pedido e a hora, por contato.
    const agora = new Date().toISOString();
    const { error: ePrev } = await supabase.from('system_state').upsert(
      { key: CHAVE_PREVIA(quem, hash), value: { hash, em: agora, fila_id: ctx.filaId }, updated_at: agora },
      { onConflict: 'key' },
    );
    if (ePrev) {
      logger.error('giovanna-ferramentas', 'não consegui guardar a prévia da alteração', { user_id: uid, erro: ePrev.message });
      return recusa('falha_ao_guardar_previa', ORIENTA_CHAMADO);
    }
    return {
      ok: true, previa: true, aplicado: false, mudancas: legivel, ignorados, observacoes,
      aviso: 'Nada foi gravado. Mostre a prévia ao usuário e só chame de novo com confirmado=true depois de um sim claro.',
    };
  }

  // Reserva ANTES de escrever (uma por pedido). 23505 = outra rodada deste mesmo pedido chegou antes.
  const valor: ValorReserva = {
    estado: 'reservado', user_id: uid, fila_id: ctx.filaId!, hash, em: new Date().toISOString(), mudancas, patch,
    antes: Object.fromEntries(mudancas.map(m => [m.coluna, m.antes])),
  };
  const { error: eReserva } = await supabase.from('system_state')
    .insert({ key: CHAVE_ALTERACAO(ctx.filaId!, hash), value: valor, updated_at: valor.em });
  if (eReserva) {
    if ((eReserva as { code?: string }).code === '23505') {
      const r = await lerReserva(ctx.filaId!, hash);
      if (r && r.value.estado !== 'reservado') return { ...(r.value.resultado ?? recusa('alteracao_ja_processada')), ja_feito_antes: true };
      if (r && r.value.user_id === uid) return aplicarEConferir(uid, r.value, ctx);
    }
    logger.error('giovanna-ferramentas', 'não consegui reservar a alteração de cadastro', { user_id: uid, fila_id: ctx.filaId, erro: eReserva.message });
    return recusa('falha_ao_reservar', ORIENTA_CHAMADO);
  }

  const r = await aplicarEConferir(uid, valor, ctx);
  return ignorados.length ? { ...r, ignorados } : r;
}

/** Texto do aviso ao dono. Uma bolha, uma linha "Mudou..." por campo. */
export function montarAvisoDono(a: { email: string; telefone: string; mudancas: AlteracaoAviso[] }): string {
  return [
    'Cadastro alterado pelo agente',
    `Cliente: ${a.email}`,
    `Telefone: ${a.telefone}`,
    ...a.mudancas.map(m => `Mudou ${m.campo}: de ${emBranco(m.antes)} para ${emBranco(m.depois)}`),
    'Já foi feito, não precisa aprovar.',
    a.mudancas.every(m => m.chamado !== false)
      ? 'O valor antigo ficou guardado no chamado para desfazer.'
      : 'O valor antigo ficou guardado no sistema para desfazer.',
  ].join('\n');
}

// ─── 4. abrir_chamado ────────────────────────────────────────────────────────

async function abrirChamado(input: Record<string, unknown>, ctx: GiovannaCtx): Promise<Resultado> {
  const areaBruta = limparTexto(input.area).toLowerCase().replace(/\s+/g, '_');
  const area = /^[a-z0-9_]{3,40}$/.test(areaBruta) ? areaBruta : 'atendimento_giovanna';
  const descricao = limparTexto(input.descricao).slice(0, 500);
  const diagnostico = limparTexto(input.diagnostico).slice(0, 500);
  if (!descricao) return { ok: false, motivo: 'descricao_vazia' };
  const r = await ctx.escalar({ area, descricao, diagnostico });
  return r.jaTinha
    ? { ok: true, aberto: false, ja_tinha_chamado_aberto: true, aviso: 'Já existe um chamado aberto para este telefone. O time já foi avisado.' }
    : { ok: true, aberto: r.aberto, aviso: r.aberto ? 'Chamado aberto e o Thiago foi avisado.' : 'Não consegui abrir o chamado agora.' };
}

// ─── despacho ────────────────────────────────────────────────────────────────

/** Executa uma ferramenta. Devolve SEMPRE um JSON em texto (é o conteúdo do tool_result). Nunca lança. */
export async function executarFerramentaGiovanna(
  nome: string,
  input: unknown,
  ctx: GiovannaCtx,
): Promise<string> {
  const entrada = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  try {
    let r: Resultado;
    switch (nome) {
      case 'ver_minha_conta':        r = await verMinhaConta(ctx); break;
      case 'ver_erros_recentes':     r = await verErrosRecentes(ctx); break;
      case 'alterar_dados_empresa':  r = await alterarDadosEmpresa(entrada, ctx); break;
      case 'abrir_chamado':          r = await abrirChamado(entrada, ctx); break;
      default:                       r = { ok: false, motivo: `ferramenta_desconhecida: ${nome}` };
    }
    return JSON.stringify(r);
  } catch (err) {
    logger.error('giovanna-ferramentas', `erro executando ${nome}`, {
      user_id: ctx.userId, fila_id: ctx.filaId, erro: err instanceof Error ? err.message : String(err),
    });
    return JSON.stringify({ ok: false, motivo: 'falha_interna', ...ORIENTA_CHAMADO });
  }
}
