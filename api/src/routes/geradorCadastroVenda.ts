import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { contexto, lerDocs, semCache, dossieDaVendaSolar, propostaLigadaAoCard, type Ctx } from './geradorClientesDocs';
import { cadastroLeituraLimiter } from '../middleware/rateLimiter';
import { ErroDocs, garantirBucketDocs, baixarObjeto, lerGeracaoDaProposta } from '../services/gerador/docsClienteBanco';
import { analisarSolar, type GeracaoDaProposta, type AnaliseSolar } from '../services/gerador/solarAnalise';
import { ErroCadastro, type LinhaCadastro } from '../services/gerador/cadastroVendaBanco';
import {
  ehCampo, validarCampo, lerCadastroVisto, escreverCadastro, vistaDe, nomeDaHomologacao, type Cadastro, type Fonte, type VistaCadastro,
} from '../services/gerador/cadastroVenda';
import { sincronizarNomeHomologacao } from './geradorClientes';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import { codigoDoAlocadorDoCard } from '../services/gerador/vendaSolarRegistro';
import { lerDocumentosDaVenda, SLOTS_LIDOS_SOLAR, type PessoasConhecidas } from '../services/gerador/cadastroVendaLeitura';
import { lerRotulos } from '../services/gerador/docsRotulos';
import { organizarDocs } from '../services/gerador/docsOrganizar';
import { MIMES_ACEITOS, type ArquivoDoc } from '../services/gerador/docsCliente';
import { baixarArquivo, lerProposta } from '../services/gerador/dossieVenda';

// ─────────────────────────────────────────────────────────────────────────────
// CADASTRO DA VENDA (um por card vendido) e leitura dos documentos por IA. Montadas dentro de /gerador, para as duas linhas
// que têm cadastro: `eletroposto` e `vendasolar` (a venda solar pelo card, 20/10/2026). O formato é o mesmo.
//
//   GET  /gerador/clientes/:linha/:codigo/cadastro        campos, o que falta e o tipo (PF ou PJ)
//   PUT  /gerador/clientes/:linha/:codigo/cadastro        { campos: { campo: texto }, fonte?: 'ia'|'manual'|'contrato' }
//        (eletroposto: a primeira escrita migra o legado da ficha para o cadastro; veja `escreverCadastro`)
//   POST /gerador/clientes/:linha/:codigo/cadastro/ler    a IA lê os documentos já anexados e SUGERE os campos (não
//        grava o cadastro). Também ORGANIZA os anexos: tira de "outros" o que tem item próprio e dá nome a cada documento
//        (resposta: `organizados`, e `aviso` se isso falhar; as sugestões vêm de qualquer jeito). A IA lê por PAPEL:
//        `descartadas` traz o que ela sugeriu e o servidor recusou por ser dado de outra pessoa, e `notas` traz as dúvidas dela
//        sobre de quem é cada documento (os dois só quando houver).
//        vendasolar: lê também os arquivos do dossiê da proposta ligada (só leitura, sem copiar nada) como se estivessem nos
//        itens `documento_titular` e `conta_luz`.
//
// :linha é `eletroposto` ou `vendasolar` (`solar` não tem cadastro: 404). Caminhos literais, um laço por linha.
//
// A guarda é a MESMA dos documentos (`contexto`): consultor só vê venda dele, sócio vê todas, só card vendido; venda
// inexistente e alheia respondem IGUAL (404). O cadastro mora só no bucket privado `cadastros-venda` (nunca em
// `system_state`); falha dele derruba só estas rotas (503), nunca os documentos.
//
// Nunca se loga valor de campo: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const LINHAS_COM_CADASTRO: readonly LinhaCadastro[] = ['eletroposto', 'vendasolar'];

const logErro = (que: string, err: unknown): void =>
  console.error(`[cadastro-venda] ${que}`, err instanceof ErroCadastro ? err.codigo : (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};

/** Só o cadastro cai (503); documentos e ficha seguem. Trava ocupada leva `ocupado: true`: vale tentar de novo já. */
const indisponivel = (res: Response, err?: unknown): void => {
  const ocupado = err instanceof ErroCadastro && err.codigo === 'ocupado';
  res.status(503).json({ ok: false, motivo: 'cadastro_indisponivel', ...(ocupado ? { ocupado: true } : {}) });
};

const PREFIXO_DOSSIE = 'dossie:';

/**
 * Os arquivos do dossiê da proposta ligada, como arquivos a ler (venda solar). O id e o caminho levam o prefixo `dossie:` (o
 * caminho é do bucket `dossie-vendas`, não do `fichas-docs`). Só o que a leitura enxerga: documento e conta de luz, em jpeg, png,
 * webp ou pdf (HEIC fica de fora). Falha ao ler o dossiê NÃO derruba a leitura: ela segue só com os anexos da venda.
 */
async function arquivosDoDossie(ctx: Ctx): Promise<ArquivoDoc[]> {
  try {
    const d = await dossieDaVendaSolar(ctx, 60, false);
    if (!d) return [];
    return d.arquivos
      .filter((a) => SLOTS_LIDOS_SOLAR.includes(a.slot) && MIMES_ACEITOS.includes(a.mime))
      .map((a, i) => ({ id: `${PREFIXO_DOSSIE}${i}`, slot: a.slot, caminho: `${PREFIXO_DOSSIE}${a.path}`, mime: a.mime, bytes: a.bytes, em: a.em, por: 'dossie' }));
  } catch (e) {
    logErro('dossiê indisponível para a leitura', e);
    return [];
  }
}

/**
 * `analise` da venda solar (rateio e consumo contra a geração da proposta LIGADA). Só a `vendasolar` tem; o eletroposto responde
 * sem ela. Proposta não ligada, fora do papel ou ilegível NÃO derruba o cadastro: a análise sai sem a comparação de consumo.
 */
async function analiseDaVenda(ctx: Ctx, linha: LinhaCadastro, vista: VistaCadastro): Promise<{ analise: AnaliseSolar } | Record<string, never>> {
  if (linha !== 'vendasolar') return {};
  let geracao: GeracaoDaProposta | null = null;
  try {
    const proposta = await propostaLigadaAoCard(ctx);
    if (proposta) geracao = await lerGeracaoDaProposta(proposta);
  } catch (e) {
    logErro('geração da proposta indisponível para a análise', e);
  }
  return { analise: analisarSolar(vista.valores, geracao) };
}

/**
 * Só a venda solar: `negociador` é o nome do card (`agendamentos.cliente_nome`), com quem a equipe conversou. Só leitura: o
 * cadastro nunca o altera, e ele não é um dos papéis (contratante, titular da homologação, titular do financiamento).
 */
const extrasSolar = (ctx: Ctx, linha: LinhaCadastro): { negociador: string } | Record<string, never> =>
  (linha === 'vendasolar' ? { negociador: ctx.cliente } : {});

/**
 * Planilha mãe (venda solar): o nome da homologação do cadastro vai para a coluna "Nome na homologação" da venda ligada ao card.
 * Só quando o pedido mexeu em `tuc_nome`, `nome` ou `homologacao_mesmo`, o card tem venda ligada (assinada) e há nome. Só o NOME.
 * Devolve o texto do `aviso` quando falha (a gravação do cadastro já valeu e não cai por causa disto); undefined = tudo certo
 * ou nada a fazer.
 */
const AVISO_SEM_CONFERIR = 'Salvo. Não consegui conferir a planilha agora; o nome da homologação não foi copiado.';
async function sincronizarHomologacao(ctx: Ctx, mexeu: string[], depois: Cadastro, antes: Cadastro | null): Promise<string | undefined> {
  if (!mexeu.some((k) => k === 'tuc_nome' || k === 'nome' || k === 'homologacao_mesmo')) return undefined;
  const nome = nomeDaHomologacao(depois);
  if (!nome) return undefined;
  try {
    const { lig } = await lerLigacao(Number(ctx.codigo));
    if (!lig.venda) return undefined;
    // Código dado pelo alocador a ESTE card: silêncio total, esteja o código na planilha ou não. A grade deriva o nome na leitura;
    // escrever aqui poria dado pessoal em `system_state` e, num conflito, o nome de um cliente na linha de outro. Se esta leitura
    // falhar, cai no `catch` (não sincroniza, avisa): nunca "na dúvida, grava".
    // Registro presente com assinatura inválida também cala (na dúvida, não escreve nome em `system_state`).
    if (await codigoDoAlocadorDoCard(lig.venda, Number(ctx.codigo))) return undefined;
    const r = await sincronizarNomeHomologacao(lig.venda, nome, antes ? nomeDaHomologacao(antes) : '', ctx.nome, ctx.socio);
    if (r === 'sem_coluna') return 'Salvo. Não achei a venda ligada, ou a coluna "Nome na homologação", na planilha.';
    if (r === 'sem_acesso') return 'Salvo. Você não tem acesso à venda ligada na planilha; o nome da homologação não foi copiado.';
    if (r === 'ocupado') return 'Salvo. Não consegui escrever o nome na homologação da planilha agora: outra pessoa estava gravando.';
    if (r === 'sem_conferir') return AVISO_SEM_CONFERIR;
    return undefined;
  } catch (e) {
    logErro('nome da homologação não foi para a planilha', e);
    return AVISO_SEM_CONFERIR;
  }
}

/**
 * Só a venda solar, e só quando o cadastro NÃO tem e-mail: o e-mail da proposta ligada (válida e do papel de quem pede) como
 * SUGESTÃO. Primeiro o do dossiê (`dossie.campos.email`), depois `dados.email`, cada um passando por `validarCampo`. Nunca grava:
 * quem salva é a pessoa, pelo PUT. Falha ou e-mail inválido = sem sugestão (o cadastro sai do mesmo jeito).
 */
async function sugestoesDaVenda(ctx: Ctx, linha: LinhaCadastro, vista: VistaCadastro): Promise<{ sugestoes: { email: string } } | Record<string, never>> {
  if (linha !== 'vendasolar') return {};
  if (String((vista.valores as Record<string, unknown>).email ?? '').trim()) return {};
  try {
    const codigo = await propostaLigadaAoCard(ctx);
    if (!codigo) return {};
    const p = await lerProposta(codigo);
    if (!p) return {};
    for (const bruto of [p.dossie.campos.email, p.dados.email]) {
      if (typeof bruto !== 'string' || !bruto.trim()) continue;
      const r = validarCampo('email', bruto);
      if (r.ok && r.valor) return { sugestoes: { email: r.valor } };
    }
  } catch (e) {
    logErro('e-mail da proposta indisponível para a sugestão', e);
  }
  return {};
}

/** Baixa do bucket certo: o do dossiê (que devolve null em vez de lançar) ou o dos documentos da venda. */
async function baixarDaLeitura(caminho: string): Promise<Buffer> {
  if (!caminho.startsWith(PREFIXO_DOSSIE)) return baixarObjeto(caminho);
  const b = await baixarArquivo(caminho.slice(PREFIXO_DOSSIE.length));
  if (!b) throw new ErroDocs('baixar_objeto');
  return b;
}

export function mountCadastroVenda(router: Router): void {
  const base = [exigeConsultor, semCache];

  for (const linha of LINHAS_COM_CADASTRO) {
    // ── Ler ──────────────────────────────────────────────────────────────────
    router.get(`/clientes/${linha}/:codigo/cadastro`, ...base, async (req: Request, res: Response) => {
      const ctx = await contexto(req, res, linha);
      if (!ctx) return;
      try {
        // Eletroposto: enquanto a primeira escrita não migrou, o legado da ficha aparece aqui (fonte 'ficha'): ficha e contrato
        // não discordam. Venda solar: só o bucket.
        const vista = vistaDe(await lerCadastroVisto(Number(ctx.codigo), linha), linha);
        res.json({
          ok: true, cadastro: vista, ...extrasSolar(ctx, linha), ...(await analiseDaVenda(ctx, linha, vista)),
          ...(await sugestoesDaVenda(ctx, linha, vista)),
        });
      } catch (err) {
        logErro('leitura falhou', err);
        indisponivel(res);
      }
    });

    // ── Gravar (quem grava é a pessoa; `fonte: 'ia'` diz que ela aceitou uma sugestão) ──
    router.put(`/clientes/${linha}/:codigo/cadastro`, ...base, async (req: Request, res: Response) => {
      const ctx = await contexto(req, res, linha);
      if (!ctx) return;
      const b = corpoDe(req);
      const campos = b && b.campos && typeof b.campos === 'object' && !Array.isArray(b.campos) ? (b.campos as Record<string, unknown>) : null;
      const fonte = b?.fonte === undefined ? 'manual' : b.fonte;
      if (!campos || Object.keys(campos).length === 0 || (fonte !== 'manual' && fonte !== 'ia' && fonte !== 'contrato')) {
        res.status(400).json({ ok: false, error: MSG_PEDIDO });
        return;
      }
      // Valida TUDO antes de gravar qualquer coisa: com um erro, nada é gravado. O campo tem que ser desta LINHA
      // (`tuc_*` e `benef_*` não existem no eletroposto, `ced_*` não existe na venda solar).
      const erros: Record<string, string> = {};
      const limpos: Record<string, string> = {};
      for (const [k, v] of Object.entries(campos)) {
        if (!ehCampo(k, linha)) { erros[k.slice(0, 40)] = 'Campo desconhecido.'; continue; }
        const r = validarCampo(k, v);
        if (r.ok) limpos[k] = r.valor; else erros[k] = r.erro;
      }
      if (Object.keys(erros).length) { res.status(400).json({ ok: false, erros }); return; }
      try {
        // Controle de versão opcional (`base_em`: o instante mais novo que a tela viu no cadastro): campo gravado por outra pessoa DEPOIS disso,
        // com valor diferente do que vai ser gravado, é conflito (409) e nada é gravado. Uma aba velha não sobrescreve gravação mais nova.
        const baseEm = typeof b?.base_em === 'string' ? Date.parse(b.base_em) : NaN;
        if (Number.isFinite(baseEm)) {
          const atual = await lerCadastroVisto(Number(ctx.codigo), linha);
          const conflitos = Object.entries(limpos).filter(([k, v]) => {
            const g = (atual.campos as Record<string, { valor?: string; em?: string } | undefined>)[k];
            return !!g && Date.parse(String(g.em ?? '')) > baseEm && g.valor !== v;
          }).map(([k]) => k);
          if (conflitos.length) {
            res.status(409).json({ ok: false, motivo: 'conflito', conflitos, error: 'Outra pessoa alterou este cadastro agora. Atualize os dados do cliente e confira.' });
            return;
          }
        }
        const r = await escreverCadastro(Number(ctx.codigo), limpos, ctx.nome, fonte as Fonte, new Date().toISOString(), linha);
        const vista = vistaDe(r.cad, linha);
        const avisos: string[] = [];
        if (!r.limpou) avisos.push('Salvo. A limpeza do registro antigo da ficha fica para a próxima gravação.');
        if (linha === 'vendasolar') {
          const a = await sincronizarHomologacao(ctx, Object.keys(limpos), r.cad, r.antes ?? null);
          if (a) avisos.push(a);
        }
        res.json({
          ok: true, cadastro: vista, ...extrasSolar(ctx, linha), ...(await analiseDaVenda(ctx, linha, vista)),
          ...(avisos.length ? { aviso: avisos.join(' ') } : {}),
        });
      } catch (err) {
        logErro('gravar falhou', err);
        indisponivel(res, err);
      }
    });

    // ── Ler os documentos com IA (só sugere) ─────────────────────────────────
    // O limitador vem DEPOIS do login (a chave é o e-mail do consultor) e ANTES da guarda: quem chega aqui já está logado.
    router.post(`/clientes/${linha}/:codigo/cadastro/ler`, exigeConsultor, cadastroLeituraLimiter, semCache, async (req: Request, res: Response) => {
      const ctx = await contexto(req, res, linha);
      if (!ctx) return;
      try {
        await garantirBucketDocs();
        const { reg } = await lerDocs(ctx);
        // Quem já tem rótulo lê depois dos que ainda não têm. Bucket dos rótulos fora do ar: lê sem essa prioridade.
        // O nome que a PESSOA deu (rótulo manual) vai ao modelo como pista de quem é o documento; o da IA não (seria a IA lendo a si mesma).
        const rotulados = new Set<string>();
        const nomesDados = new Map<string, string>();
        try {
          for (const [id, rot] of Object.entries((await lerRotulos(linha, ctx.codigo)).rotulos)) {
            rotulados.add(id);
            if (rot.fonte === 'manual') nomesDados.set(id, rot.rotulo);
          }
        } catch (e) { logErro('rótulos indisponíveis', e); }
        // Os nomes já conhecidos (para a IA casar o nome escrito no documento com a pessoa): o cadastro e, sem ele, o nome do card.
        // Cadastro fora do ar NÃO derruba a leitura: ela segue só com o nome do card.
        // Venda solar: o nome do card é o NEGOCIADOR (com quem a equipe falou), que pode ser o contratante, o titular da homologação
        // ou o do financiamento. Ele vai como pessoa própria e não é tomado por contratante enquanto o cadastro não diz.
        const pessoas: PessoasConhecidas = linha === 'vendasolar' ? { negociador: ctx.cliente } : { comprador: ctx.cliente };
        try {
          const cad = await lerCadastroVisto(Number(ctx.codigo), linha);
          if (linha === 'vendasolar') {
            pessoas.comprador = cad.campos.nome?.valor;
            pessoas.titular_uc = cad.campos.tuc_nome?.valor;
            pessoas.titular_financiamento = cad.campos.fin_nome?.valor;
          } else {
            pessoas.comprador = cad.campos.nome?.valor || ctx.cliente;
            pessoas.cedente = cad.campos.ced_nome?.valor;
          }
          pessoas.avalista = cad.campos.aval_nome?.valor;
        } catch (e) { logErro('cadastro indisponível para os nomes da leitura', e); }
        const doDossie = linha === 'vendasolar' ? await arquivosDoDossie(ctx) : [];
        const r = await lerDocumentosDaVenda([...reg.arquivos, ...doDossie], {
          rotulados, nomesDados, pessoas, linha, ...(doDossie.length ? { baixar: baixarDaLeitura } : {}),
        });
        if (r.ok) {
          // A leitura também organiza: mover de "outros" para o item certo e gravar o nome. Falha NÃO derruba as sugestões.
          // Arquivo do dossiê não é anexo da venda: não se move nem se rotula.
          const proprios = r.documentos.filter((d) => !d.id.startsWith(PREFIXO_DOSSIE));
          const org = await organizarDocs({ linha, codigo: ctx.codigo, nome: ctx.nome }, proprios, () => lerDocs(ctx));
          res.json({
            ok: true, sugestoes: r.sugestoes, lidos: r.lidos, ignorados: r.ignorados,
            organizados: org.organizados, ...(org.aviso ? { aviso: org.aviso } : {}),
            ...(r.descartadas.length ? { descartadas: r.descartadas } : {}),
            ...(r.notas.length ? { notas: r.notas.filter((n) => !n.id.startsWith(PREFIXO_DOSSIE)) } : {}),
          });
        } else if (r.motivo === 'sem_documentos') {
          res.status(409).json({ ok: false, motivo: 'sem_documentos', ignorados: r.ignorados });
        } else if (r.motivo === 'armazenamento') {
          indisponivel(res);
        } else {
          res.status(502).json({ ok: false, motivo: 'ia_indisponivel' });
        }
      } catch (err) {
        logErro('leitura por IA falhou', err);
        // Metadado ou bucket fora do ar: não dá nem para saber quais documentos existem.
        res.status(503).json({ ok: false, motivo: 'cadastro_indisponivel' });
      }
    });
  }
}
