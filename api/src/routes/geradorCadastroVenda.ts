import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { contexto, lerDocs, semCache, dossieDaVendaSolar, type Ctx } from './geradorClientesDocs';
import { cadastroLeituraLimiter } from '../middleware/rateLimiter';
import { ErroDocs, garantirBucketDocs, baixarObjeto } from '../services/gerador/docsClienteBanco';
import { ErroCadastro, type LinhaCadastro } from '../services/gerador/cadastroVendaBanco';
import {
  ehCampo, validarCampo, lerCadastroVisto, escreverCadastro, vistaDe, type Fonte,
} from '../services/gerador/cadastroVenda';
import { lerDocumentosDaVenda, SLOTS_LIDOS_SOLAR, type PessoasConhecidas } from '../services/gerador/cadastroVendaLeitura';
import { lerRotulos } from '../services/gerador/docsRotulos';
import { organizarDocs } from '../services/gerador/docsOrganizar';
import { MIMES_ACEITOS, type ArquivoDoc } from '../services/gerador/docsCliente';
import { baixarArquivo } from '../services/gerador/dossieVenda';

// ─────────────────────────────────────────────────────────────────────────────
// CADASTRO DA VENDA (um por card vendido) e leitura dos documentos por IA. Montadas dentro de /gerador, para as duas linhas
// que têm cadastro: `eletroposto` e `vendasolar` (a venda solar pelo card, 20/10/2026). O formato é o mesmo.
//
//   GET  /gerador/clientes/:linha/:codigo/cadastro        campos, o que falta e o tipo (PF ou PJ)
//   PUT  /gerador/clientes/:linha/:codigo/cadastro        { campos: { campo: texto }, fonte?: 'ia'|'manual' }
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
        res.json({ ok: true, cadastro: vistaDe(await lerCadastroVisto(Number(ctx.codigo), linha), linha) });
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
      if (!campos || Object.keys(campos).length === 0 || (fonte !== 'manual' && fonte !== 'ia')) {
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
        const r = await escreverCadastro(Number(ctx.codigo), limpos, ctx.nome, fonte as Fonte, new Date().toISOString(), linha);
        res.json({
          ok: true, cadastro: vistaDe(r.cad, linha),
          ...(r.limpou ? {} : { aviso: 'Salvo. A limpeza do registro antigo da ficha fica para a próxima gravação.' }),
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
        const pessoas: PessoasConhecidas = { comprador: ctx.cliente };
        try {
          const cad = await lerCadastroVisto(Number(ctx.codigo), linha);
          pessoas.comprador = cad.campos.nome?.valor || ctx.cliente;
          if (linha === 'vendasolar') pessoas.titular_uc = cad.campos.tuc_nome?.valor;
          else pessoas.cedente = cad.campos.ced_nome?.valor;
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
