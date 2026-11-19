// ─────────────────────────────────────────────────────────────────────────────
// GRAVAÇÃO DO QUE A IA LEU DOS DOCUMENTOS DA VENDA SOLAR (19/11/2026). Usada pela leitura automática (um arquivo recém-enviado) e pela rota
// "Ler tudo" (todos os arquivos do card). As regras são as mesmas nas duas:
//   - CADASTRO: só campo VAZIO, fonte 'ia', com o item do documento de origem (`doc`). Nunca toca em campo preenchido.
//   - DE QUEM É O DOCUMENTO: contrato, procuração e orçamento de outro contratante não gravam NADA; CNH de outra pessoa não preenche o contratante.
//   - VALOR, PAGAMENTO e PRAZO: em `privado.venda`, só se o destino estiver vazio, com a marca `ia` (slot de origem). Nunca sobrescreve valor que
//     já existe, nem o da proposta ligada. Não vale com a obra cancelada, finalizada ou com a conta fechada.
//   - KIT: em `etapas[1].kit_texto`, só a parte que a proposta ligada não traz e que ainda está sem texto. Não vale com a etapa 3 concluída.
//   - NADA DISTO CONTA COMO CONFIRMADO: as confirmações (POST confirmar) continuam exigidas. A IA nunca dispara o aviso à equipe (`venda_completa`) nem o
//     espelho na proposta ligada: valor, pagamento e prazo gravados por ela levam a marca `venda.ia`, e `blocoVendaCompleto` não os conta como completos
//     até uma pessoa aceitar (PUT /venda ou confirmar valor ou pagamento, que apagam a marca e aí sim disparam o aviso e o espelho).
//   - OBRA FECHADA: obra finalizada, cancelada ou com a conta fechada não recebe nada da leitura (nem cadastro, nem valor, nem kit): `obraAbertaParaIa`.
//   - TEMPO: se o limite de tempo estourou (`cancelado`), o que ainda estava rodando não grava mais nada.
// Nunca se loga valor, nome nem texto do documento.
// ─────────────────────────────────────────────────────────────────────────────
import type { ArquivoDoc } from './docsCliente';
import { CAMPOS_DECISAO_PAPEIS, CAMPOS_ENGENHARIA, ehCampo, escreverCadastro, validarCampo, type Cadastro } from './cadastroVenda';
import type { DocumentoLido, ResultadoLeituraCadastro } from './cadastroVendaLeitura';
import { papelDoCampo } from './cadastroVendaPapeis';
import {
  SLOTS_DO_CONTRATANTE, documentoDeOutraPessoa, documentoDeOutroContratante, kitDoComercial, slotEfetivo, vendaDoComercial,
  type ComercialLido,
} from './leituraComercial';
import { kitCompleto, type PrivadoJornada } from './jornadaSolar';
import { lerJornadaComVersao, lerPrivadoJornada, mudarJornada, mudarPrivadoJornada } from './jornadaSolarBanco';
import { lerObraComVersao } from './jornadaObraBanco';
import { obraFinalizada } from './jornadaCorte';
import { lerLigacao } from './vendaSolarHub';
import { lerProposta } from './dossieVenda';
import { equipamentoDaProposta } from './trelloVendaSolar';
import { supabaseGerador } from '../../utils/supabaseGerador';

type Ok = Extract<ResultadoLeituraCadastro, { ok: true }>;

const logErro = (que: string, err: unknown): void =>
  console.error(`[leitura-gravacao] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

/** O valor vendido na proposta ligada, em centavos: 0 = não tem (ou não há proposta), null = não deu para saber (quem chama não grava valor). */
async function valorDaPropostaLigada(card: number): Promise<number | null> {
  try {
    const { lig } = await lerLigacao(card);
    if (!lig.proposta) return 0;
    const { data, error } = await supabaseGerador.from('propostas').select('valor_vendido').eq('codigo', lig.proposta).maybeSingle();
    if (error) return null;
    const n = Number((data as { valor_vendido?: unknown } | null)?.valor_vendido);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  } catch (e) { logErro('valor da proposta', e); return null; }
}

/** `venda` nova, vazia de pessoa: quem combinou e quando ficam em branco (o primeiro PUT de uma pessoa preenche). */
const vendaNova = (valor: number): NonNullable<PrivadoJornada['venda']> => ({
  valor_centavos: valor, pagamento: [], desconto_centavos: null, prazo_prometido: '', nota: '', kit_confirmado: false, combinado_por: '', combinado_em: '', editado: [],
});

/**
 * A obra aceita gravação da leitura por IA? Não, se está finalizada, cancelada ou com a conta fechada (a mesma regra de `gravarComercial`). Lê o estado
 * da jornada e da obra: falha de leitura lança (quem chama trata como "não leu").
 */
export async function obraAbertaParaIa(card: number): Promise<boolean> {
  const [{ estado }, { estado: obraEstado }, finalizada] = await Promise.all([lerJornadaComVersao(card), lerObraComVersao(card), obraFinalizada(card)]);
  return !(finalizada || estado?.cancelada || obraEstado?.fechada);
}

/**
 * Grava valor, pagamento, prazo e kit lidos de contrato e orçamento. Devolve o que gravou: 'valor', 'pagamento', 'prazo', 'placas', 'inversor'.
 * Nunca sobrescreve; nunca confirma. Falha de leitura de qualquer dependência = não grava aquela parte.
 */
export async function gravarComercial(card: number, c: ComercialLido): Promise<string[]> {
  const venda = vendaDoComercial(c);
  const kit = kitDoComercial(c);
  if (!Object.keys(venda).length && !Object.keys(kit).length) return [];
  const [{ estado }, { estado: obraEstado }, finalizada] = await Promise.all([lerJornadaComVersao(card), lerObraComVersao(card), obraFinalizada(card)]);
  if (finalizada || estado?.cancelada || obraEstado?.fechada) return [];
  const escritos: string[] = [];

  if (venda.valor_centavos || venda.forma || venda.prazo) {
    const daProposta = venda.valor_centavos ? await valorDaPropostaLigada(card) : null;
    // Sem valor na venda e sem poder gravar o lido, não há o que fazer (e o arquivo privado nem é criado).
    const atual = await lerPrivadoJornada(card).catch((): null => null);
    const podeGravar = (atual?.venda?.valor_centavos ?? 0) > 0 || (!!venda.valor_centavos && daProposta === 0);
    if (podeGravar) await mudarPrivadoJornada(card, 'leitura', (p) => {
      escritos.length = 0;
      const v = p.venda;
      const marcas = { ...(v?.ia ?? {}) };
      let valor = v?.valor_centavos ?? 0;
      if (valor <= 0 && venda.valor_centavos && daProposta === 0) { valor = venda.valor_centavos; marcas.valor = c.valor_total!.slot; escritos.push('valor'); }
      if (valor <= 0) return p;   // pagamento e prazo só entram numa venda que já tem valor
      const novo = { ...(v ?? vendaNova(valor)), valor_centavos: valor };
      if (venda.forma && !novo.pagamento.length) {
        novo.pagamento = [{ forma: venda.forma, valor_centavos: valor, obs: venda.obs ?? '' }];
        marcas.pagamento = c.pagamento_forma!.slot; escritos.push('pagamento');
      }
      if (venda.prazo && !novo.prazo_prometido.trim()) { novo.prazo_prometido = venda.prazo; marcas.prazo = c.prazo_instalacao!.slot; escritos.push('prazo'); }
      if (!escritos.length) return p;
      // Fica na trilha de edições (quem: 'leitura'), como qualquer mudança nesses dados.
      const editado = [...novo.editado, { em: new Date().toISOString(), por: 'leitura', campos: [...escritos] }].slice(-30);
      return { ...p, venda: { ...novo, editado, ...(Object.keys(marcas).length ? { ia: marcas } : {}) } };
    });
  }

  if ((kit.placas || kit.inversor) && estado && !estado.etapas[3].concluida_em) {
    // O que a proposta ligada já traz completo vale mais que o texto: só entra a parte que ela não traz. Sem poder ler a proposta, não grava.
    let equip: ReturnType<typeof equipamentoDaProposta> = null;
    let sabe = true;
    try {
      const { lig } = await lerLigacao(card);
      const p = lig.proposta ? await lerProposta(lig.proposta) : null;
      equip = p ? equipamentoDaProposta({ qtd_placas: p.qtd_placas, inversor: p.inversor, qtd_inversor: p.qtd_inversor, dados: p.dados }) : null;
    } catch (e) { logErro('proposta do kit', e); sabe = false; }
    if (sabe) {
      const feito: string[] = [];
      await mudarJornada(card, () => estado, (e) => {
        feito.length = 0;
        if (e.cancelada || e.etapas[3].concluida_em) return { recusa: 'fechado', http: 409 };
        const atual = e.etapas[1].kit_texto ?? {};
        const novo = { ...atual };
        for (const k of ['placas', 'inversor'] as const) {
          if (kit[k] && !(atual[k] ?? '').trim() && !kitCompleto(k, equip)) { novo[k] = kit[k]; feito.push(k); }
        }
        if (!feito.length) return { recusa: 'nada', http: 200 };
        return { ...e, etapas: { ...e.etapas, 1: { ...e.etapas[1], kit_texto: novo } } };
      });
      escritos.push(...feito);
    }
  }
  return escritos;
}

/** Quem pode pedir "Ler tudo" da obra: venda não cancelada, e o vendedor, a Giovanna ou o ADM. `vendedor` já vem em forma simples (minúscula, sem acento). */
export const podeLerTudo = (g: { nome: string; adm: boolean }, vendedor: string, cancelada: boolean): boolean =>
  !cancelada && (g.adm || g.nome === 'giovanna' || (!!vendedor && g.nome === vendedor));

// ── A leitura inteira: cadastro e dados comerciais ───────────────────────────

/** O item do documento de onde o dado veio: o do próprio arquivo, ou, em `outros`, o tipo que a IA deu ao conteúdo. */
const slotDoDoc = (a: ArquivoDoc, d: DocumentoLido | undefined): string => (a.slot === 'outros' && d?.tipo && d.tipo !== 'outro' ? d.tipo : a.slot);

export interface ResultadoAplicar { campos: string[]; comercial: string[]; /** Arquivos cujo conteúdo era de outra pessoa e não gravou nada. */ deOutraPessoa: number }

/**
 * Aplica o resultado de `lerDocumentosDaVenda` à venda. `arquivos` são os arquivos da venda (o resultado aponta para eles por id) e `cad` o
 * cadastro lido ANTES da leitura (a conferência de quem é o contratante usa o nome que já estava gravado).
 */
export async function aplicarLeitura(a: { id: number; nome: string; arquivos: readonly ArquivoDoc[]; r: Ok; cad: Cadastro; /** true = o limite de tempo estourou: não grava nada */ cancelado?: () => boolean }): Promise<ResultadoAplicar> {
  if (a.cancelado?.() || !(await obraAbertaParaIa(a.id))) return { campos: [], comercial: [], deOutraPessoa: 0 };
  const { id, r, cad } = a;
  const arq = (aid: string | undefined): ArquivoDoc | undefined => (aid ? a.arquivos.find((x) => x.id === aid) : undefined);
  const doc = (aid: string): DocumentoLido | undefined => r.documentos.find((d) => d.id === aid);
  const outros = [cad.campos.fin_nome?.valor, cad.campos.aval_nome?.valor, cad.campos.tuc_nome?.valor];
  const doArquivo = (aid: string): Ok['sugestoes'] => Object.fromEntries(Object.entries(r.sugestoes).filter(([c]) => r.origens[c] === aid));

  // Quem é o contratante: o nome já gravado; sem ele, o nome lido do documento dele nesta mesma leitura.
  let contratante = cad.campos.nome?.valor?.trim() ?? '';
  if (!contratante && r.sugestoes.nome && r.sugestoes.nome.confianca !== 'baixa') {
    const o = arq(r.origens.nome);
    if (o && o.slot === 'documento_titular' && !documentoDeOutraPessoa(o, { documentos: r.documentos, sugestoes: doArquivo(o.id) }, undefined, [])) contratante = r.sugestoes.nome.valor;
  }

  // 'tudo': contrato, procuração ou orçamento de outro contratante (nada grava). 'comprador': CNH do slot do titular que é de outra pessoa.
  const vetos = new Map<string, 'tudo' | 'comprador'>();
  const fontes = new Set<string>([...Object.values(r.origens), ...Object.values(r.comercial).map((i) => i?.arquivoId ?? '')]);
  for (const aid of fontes) {
    const o = arq(aid);
    if (!o) continue;
    const d = doc(o.id);
    if (slotEfetivo(o, d, SLOTS_DO_CONTRATANTE)) {
      const semBase = slotEfetivo(o, d, ['procuracao']) && !contratante;   // sem contratante conhecido, a procuração (do titular da conta) não preenche nada
      if (semBase || documentoDeOutroContratante(d?.pessoa, contratante, outros)) vetos.set(o.id, 'tudo');
    } else if (documentoDeOutraPessoa(o, { documentos: r.documentos, sugestoes: doArquivo(o.id) }, cad.campos.nome?.valor, [cad.campos.fin_nome?.valor, cad.campos.aval_nome?.valor])) {
      vetos.set(o.id, 'comprador');
    }
  }

  // Só o que a leitura achou com confiança, que é campo desta venda, passa na validação de sempre e não é decisão nem dado de engenharia.
  const proibidos = new Set<string>([...CAMPOS_DECISAO_PAPEIS, ...CAMPOS_ENGENHARIA]);
  const limpos: Record<string, string> = {};
  const docs: Record<string, string> = {};
  for (const [campo, s] of Object.entries(r.sugestoes)) {
    if (!ehCampo(campo, 'vendasolar') || proibidos.has(campo) || s.confianca === 'baixa') continue;
    const o = arq(r.origens[campo]);
    const veto = o ? vetos.get(o.id) : undefined;
    if (veto === 'tudo' || (veto === 'comprador' && papelDoCampo(campo) === 'comprador')) continue;
    const v = validarCampo(campo, s.valor);
    if (v.ok && v.valor) { limpos[campo] = v.valor; if (o) docs[campo] = slotDoDoc(o, doc(o.id)); }
  }
  let campos: string[] = [];
  if (Object.keys(limpos).length && !a.cancelado?.()) {
    const antes = cad.campos;
    const depois = (await escreverCadastro(id, limpos, a.nome, 'ia', new Date().toISOString(), 'vendasolar', { soVazios: true, docs })).cad;
    campos = Object.keys(limpos).filter((k) => depois.campos[k as keyof typeof depois.campos]?.valor !== antes[k as keyof typeof antes]?.valor);
  }

  const liberado: ComercialLido = Object.fromEntries(Object.entries(r.comercial).filter(([, i]) => i && vetos.get(i.arquivoId) !== 'tudo'));
  const comercial = a.cancelado?.() ? [] : await gravarComercial(id, liberado).catch((e): string[] => { logErro('dados comerciais', e); return []; });
  return { campos, comercial, deOutraPessoa: [...vetos.values()].filter((v) => v === 'tudo').length };
}
