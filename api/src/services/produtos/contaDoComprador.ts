/**
 * A CONTA CERTA DE QUEM COMPROU.
 *
 * O webhook da Kiwify achava a conta do comprador SÓ pelo e-mail digitado no checkout. Digitou outro, e o
 * webhook criava uma conta nova e pendente: o acesso ia para ela e a conta em que a pessoa estava logada
 * seguia trancada, sem aviso. Digitou o e-mail de OUTRA conta que já existia, e o acesso ia para essa outra
 * pessoa. Agora a busca tem ordem e uma regra de segurança:
 *
 *   1. E-MAIL   : como sempre foi. Casou, é essa conta e acabou.
 *   2. DOCUMENTO: o CPF ou CNPJ do comprador contra o que a SolarDoc guarda: `company.cnpj` (o CNPJ da
 *                  empresa da conta, único no banco, gravado com e sem máscara) e `asaas_pix_assinaturas.
 *                  cpf_cnpj` (quem assina por Pix recorrente). A tabela `users` não guarda CPF nem CNPJ.
 *                  Nunca `clients.cpf_cnpj`, `terceiros` nem os CPFs do engenheiro/técnico da empresa: são
 *                  documentos de OUTRAS pessoas e entregariam a compra ao integrador errado.
 *   3. TELEFONE : o celular do comprador contra `users.whatsapp`, pelas variantes de chave que o projeto
 *                  já usa (com e sem 55, com e sem o nono dígito, com "+").
 *
 * A conta só é escolhida quando cada chave que achou alguém achou UMA conta só, e é a mesma. Documento e
 * telefone apontando para contas diferentes, ou qualquer chave apontando para duas contas ou mais (telefone
 * de equipe, CNPJ de empresa com vários logins), não escolhe nenhuma: quem chama cria a conta pendente, como sempre, e
 * registra o conflito para o suporte. Na dúvida, não entrega a compra a quem pode não ser o comprador.
 *
 * Só conta COM SENHA entra como candidata por documento ou telefone: a pendente de uma compra anterior (que
 * grava o telefone do comprador) não prende a compra seguinte, que cria a pendente do e-mail digitado.
 * Telefone de mentira (11999999999, sequência) nem é pesquisado: ver `telefoneServeDeChave`.
 *
 * Leitura só. Erro de leitura de uma chave vira "essa chave não achou ninguém", nunca uma exceção: a compra
 * não pode deixar de ser processada porque uma tabela auxiliar piscou.
 */

import { supabase } from '../../utils/supabase';
import { documentoSoDigitos, formasDoDocumento } from '../../utils/documento';
import { variantesDoTelefone } from './chaveTelefone';

export type ChaveDaConta = 'email' | 'documento' | 'telefone' | 'documento+telefone';

export interface ContaAchada {
  userId: string;
  /** O e-mail da CONTA, que pode ser diferente do digitado na compra. */
  email: string;
  /** false = conta pendente (criada por uma compra anterior, sem senha). */
  temSenha: boolean;
  chave: ChaveDaConta;
}

export interface ConflitoDeConta {
  motivo:
    | 'documento_e_telefone_divergem'
    | 'documento_e_telefone_ambiguos'
    | 'documento_ambiguo'
    | 'telefone_ambiguo';
  /** Ids das contas que cada chave achou (para o suporte conferir). */
  porDocumento: string[];
  porTelefone: string[];
}

export type BuscaDeConta =
  | { tipo: 'achou'; conta: ContaAchada }
  | { tipo: 'conflito'; conflito: ConflitoDeConta }
  | { tipo: 'nenhuma' }
  /** A leitura por e-mail falhou: sem saber se a conta do e-mail existe, não se tenta documento nem telefone. */
  | { tipo: 'erro' };

type LinhaConta = { id: string; email: string | null; password_hash: string | null };

/** Chaves do objeto do comprador (Customer, na Kiwify) em que o documento aparece. A Kiwify manda `CPF` e `cnpj`. */
const CHAVES_DE_DOCUMENTO = ['cnpj', 'cpf', 'cpf_cnpj', 'cpfcnpj', 'documento', 'document'];

/**
 * Todos os CPFs e CNPJs válidos do comprador no payload da Kiwify, só dígitos e sem repetir. Confere o dígito
 * verificador: documento digitado errado ou sequência repetida não serve para casar conta. Quando vêm CPF e
 * CNPJ, os dois entram, e a busca procura os dois. Lista vazia = não veio nenhum documento válido.
 */
export function documentosDoComprador(comprador: unknown): string[] {
  if (!comprador || typeof comprador !== 'object') return [];
  const campos = comprador as Record<string, unknown>;
  const achados: string[] = [];
  for (const chave of Object.keys(campos)) {
    if (!CHAVES_DE_DOCUMENTO.includes(chave.toLowerCase())) continue;
    const d = documentoSoDigitos(campos[chave]);
    if (d && !achados.includes(d)) achados.push(d);
  }
  return achados;
}

/** O primeiro documento válido do comprador (ver `documentosDoComprador`). null = nenhum. */
export function documentoDoComprador(comprador: unknown): string | null {
  return documentosDoComprador(comprador)[0] ?? null;
}

/**
 * Teto de linhas lidas por documento. Um mesmo user_id pode ter várias linhas em asaas_pix_assinaturas, então o
 * teto é folgado; se for batido, a leitura é incompleta e a chave vira conflito em vez de chute.
 */
const TETO_POR_DOCUMENTO = 200;

async function usuariosDoDocumento(
  documento: string | null | undefined,
): Promise<{ contas: Map<string, LinhaConta>; truncado: boolean }> {
  const d = documentoSoDigitos(documento);
  const ids = new Set<string>();
  const contas = new Map<string, LinhaConta>();
  let truncado = false;
  if (!d) return { contas, truncado };
  const formas = formasDoDocumento(d);

  // company.cnpj só tem CNPJ; asaas_pix_assinaturas.cpf_cnpj tem os dois.
  const fontes: Array<[string, string]> = [];
  if (d.length === 14) fontes.push(['company', 'cnpj']);
  fontes.push(['asaas_pix_assinaturas', 'cpf_cnpj']);

  await Promise.all(fontes.map(async ([tabela, coluna]) => {
    try {
      let consulta = supabase.from(tabela).select('user_id').in(coluna, formas);
      // Só prova o documento a assinatura em que um pagamento foi creditado: `ultimo_pagamento_id` só é
      // preenchido assim (NOT NULL DEFAULT ''). O status não serve: 'cancelado' também cobre checkout nunca pago.
      if (tabela === 'asaas_pix_assinaturas') consulta = consulta.neq('ultimo_pagamento_id', '');
      const { data, error } = await consulta.limit(TETO_POR_DOCUMENTO);
      if (error) {
        console.warn(`[kit] busca de conta por documento em ${tabela}.${coluna} falhou (segue sem essa chave):`, error.message);
        return;
      }
      const linhas = (data ?? []) as Array<{ user_id?: string | null }>;
      if (linhas.length >= TETO_POR_DOCUMENTO) truncado = true;
      for (const r of linhas) {
        if (r.user_id) ids.add(String(r.user_id));
      }
    } catch (err) {
      console.warn(`[kit] busca de conta por documento em ${tabela}.${coluna} lançou (segue sem essa chave):`, err);
    }
  }));
  if (!ids.size) return { contas, truncado };

  // Conta pendente (sem senha, criada por uma compra anterior) nunca é candidata: ninguém entra nela.
  try {
    const { data, error } = await supabase.from('users').select('id, email, password_hash').in('id', [...ids]);
    if (error) {
      console.warn('[kit] leitura das contas do documento falhou (segue sem essa chave):', error.message);
      return { contas, truncado };
    }
    for (const r of (data ?? []) as LinhaConta[]) {
      if (r.password_hash !== null && r.password_hash !== undefined) contas.set(String(r.id), r);
    }
  } catch (err) {
    console.warn('[kit] leitura das contas do documento lançou (segue sem essa chave):', err);
  }
  return { contas, truncado };
}

async function contasDoTelefone(telefone: string | null | undefined): Promise<LinhaConta[]> {
  const variantes = variantesDoTelefone(telefone);
  if (!variantes.length) return [];
  try {
    const { data, error } = await supabase
      .from('users').select('id, email, password_hash').in('whatsapp', variantes)
      // A pendente (sem senha) não é candidata: filtrar na consulta evita que ela ocupe o teto e esconda a conta real.
      .not('password_hash', 'is', null).limit(20);
    if (error) {
      console.warn('[kit] busca de conta por telefone falhou (segue sem essa chave):', error.message);
      return [];
    }
    // Conta pendente (sem senha) não é candidata: o telefone dela veio de uma compra, não de um cadastro.
    return ((data ?? []) as LinhaConta[]).filter((c) => c.password_hash !== null && c.password_hash !== undefined);
  } catch (err) {
    console.warn('[kit] busca de conta por telefone lançou (segue sem essa chave):', err);
    return [];
  }
}

/**
 * Acha a conta de quem comprou. `email` já vem em minúsculas. `telefone` é o que a Kiwify mandou (com ou
 * sem "+55", com máscara ou sem); `documento` é o CPF/CNPJ, ou a lista deles (use `documentosDoComprador`).
 */
export async function acharContaDoComprador(opts: {
  email: string;
  telefone?: string | null;
  documento?: string | string[] | null;
}): Promise<BuscaDeConta> {
  // 1) E-mail: a regra de sempre.
  const { data: existente, error: erroEmail } = await supabase
    .from('users').select('id, email, password_hash').eq('email', opts.email).maybeSingle();
  if (erroEmail) {
    // Sem saber se a conta do e-mail digitado existe, documento e telefone podem apontar para OUTRA conta e
    // entregar a ela uma compra que é da primeira. Quem chama segue o caminho antigo (insert, 23505, releitura).
    console.warn('[kit] leitura da conta por e-mail falhou (não tenta documento nem telefone):', erroEmail.message);
    return { tipo: 'erro' };
  }
  if (existente?.id) {
    return {
      tipo: 'achou',
      conta: {
        userId: existente.id,
        email: existente.email || opts.email,
        temSenha: existente.password_hash !== null,
        chave: 'email',
      },
    };
  }

  // 2) Documento e 3) telefone. Cada documento válido é procurado, e as contas de todos entram no mesmo
  // conjunto: CPF e CNPJ apontando para contas diferentes dão duas contas, ou seja, conflito.
  const documentos = [...new Set(
    (Array.isArray(opts.documento) ? opts.documento : [opts.documento])
      .map((x) => documentoSoDigitos(x))
      .filter((x): x is string => !!x),
  )];
  const [porCadaDocumento, contasTel] = await Promise.all([
    Promise.all(documentos.map((x) => usuariosDoDocumento(x))),
    contasDoTelefone(opts.telefone),
  ]);
  const porDocumento = new Map<string, LinhaConta>();
  let truncado = false;
  for (const r of porCadaDocumento) {
    for (const [id, linha] of r.contas) porDocumento.set(id, linha);
    if (r.truncado) truncado = true;
  }
  const porTelefone = new Set(contasTel.map((c) => c.id));
  const linhas = new Map<string, LinhaConta>([...contasTel.map((c): [string, LinhaConta] => [c.id, c]), ...porDocumento]);
  const idsDoc = new Set(porDocumento.keys());

  const conjuntos = [idsDoc, porTelefone].filter((s) => s.size > 0);
  if (!conjuntos.length) return { tipo: 'nenhuma' };

  // Uma chave que acha MAIS DE UMA conta (CNPJ de empresa com vários logins, WhatsApp de equipe) é conflito,
  // mesmo que a outra chave aponte para uma delas: nunca se pega "a primeira linha".
  const ambiguo = truncado || conjuntos.some((s) => s.size > 1);
  const comuns = ambiguo ? [] : [...conjuntos[0]].filter((id) => conjuntos.every((s) => s.has(id)));
  if (comuns.length === 1) {
    const id = comuns[0];
    const linha = linhas.get(id);
    if (!linha) return { tipo: 'nenhuma' };
    return {
      tipo: 'achou',
      conta: {
        userId: linha.id,
        email: linha.email || opts.email,
        temSenha: linha.password_hash !== null,
        chave: idsDoc.size > 0 && porTelefone.size > 0 ? 'documento+telefone'
          : idsDoc.size > 0 ? 'documento' : 'telefone',
      },
    };
  }

  const motivo: ConflitoDeConta['motivo'] =
    idsDoc.size > 1 && porTelefone.size > 1 ? 'documento_e_telefone_ambiguos'
      : (idsDoc.size > 1 || truncado) ? 'documento_ambiguo'
      : porTelefone.size > 1 ? 'telefone_ambiguo'
      : 'documento_e_telefone_divergem';
  return {
    tipo: 'conflito',
    conflito: { motivo, porDocumento: [...idsDoc], porTelefone: [...porTelefone] },
  };
}
