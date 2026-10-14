import { Router, Request, Response, NextFunction } from 'express';
import { PLANILHA_CSV_URL } from '../services/insightsService';
import { exigeConsultor } from './geradorDossie';
import { comLimite, limitesSolar } from './geradorSolar';
import { ehSocio, podeVer, codigoCanonico } from '../services/gerador/solarObras';
import {
  lerGrade, montarCatalogo, montarLinhas, colunasPara, colunaPublica, totais, validarValor, celulaDe,
  progressoDe, houveConflito, aplicarGravacao, consultorEfetivo, GRUPOS, GRUPO_OUTROS,
  type Grade, type ColunaInterna, type RegistroGestao, type Celula,
} from '../services/gerador/gestaoClientes';
import { lerRegistros, lerRegistroComVersao, gravarRegistro, ErroGestao } from '../services/gerador/gestaoClientesBanco';

// ─────────────────────────────────────────────────────────────────────────────
// GESTÃO DE CLIENTES (solar) no /gerador: a Planilha Mestre como grade editável.
// Montada dentro de /gerador. Duas rotas:
//   GET  /clientes/solar         catálogo + linhas (já cortados pelo PAPEL)
//   POST /clientes/solar/campo   grava UMA célula (com conferência de conflito)
//
// A planilha continua sendo a base e é SÓ LEITURA; o que se preenche aqui mora
// em `system_state` (`gestao_cliente:<NNNN>`) e vale por cima, campo a campo.
//
// CACHE GUARDA DADO, NUNCA RESPOSTA. A grade em cache traz TODAS as colunas (com
// custo e lucro); cada requisição monta a resposta para o seu papel. Consultor
// nunca recebe coluna `socio`: nem no catálogo, nem nas células, nem em erro.
//
// Nenhum valor de célula vai para log: só o código do erro do banco.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 5 * 60_000;
const VALIDADE_COPIA_VELHA_MS = 6 * 3_600_000;   // cópia velha demais engana mais do que ajuda
const TENTATIVAS_GRAVAR = 4;

interface CacheGrade { grade: Grade; cols: ColunaInterna[]; ts: number }
let cache: CacheGrade | null = null;
let voando: Promise<CacheGrade> | null = null;

/** Para os testes: o cache em módulo faria a ordem dos testes importar. */
export function limparCacheClientes(): void { cache = null; voando = null; }

function baixar(): Promise<CacheGrade> {
  return comLimite(async (sinal) => {
    const r = await fetch(PLANILHA_CSV_URL, { signal: sinal });
    if (!r.ok) throw new Error(`planilha respondeu ${r.status}`);
    const grade = lerGrade(await r.text());
    if (!grade.vendas.length) throw new Error('planilha sem nenhuma venda');
    return { grade, cols: montarCatalogo(grade.cabecalho, grade.vendas), ts: Date.now() };
  }, limitesSolar.planilhaMs, 'planilha');
}

async function grade(fresco: boolean): Promise<{ dados: CacheGrade; atual: boolean }> {
  if (!fresco && cache && Date.now() - cache.ts < TTL_MS) return { dados: cache, atual: true };
  try {
    if (!voando || fresco) {
      const p = baixar();
      voando = p;
      p.then(() => { if (voando === p) voando = null; }, () => { if (voando === p) voando = null; });
    }
    const dados = await (voando as Promise<CacheGrade>);
    cache = dados;
    return { dados, atual: true };
  } catch (err) {
    console.error('[clientes] planilha falhou', String((err as Error)?.message || 'erro').slice(0, 80));
    if (cache && Date.now() - cache.ts < VALIDADE_COPIA_VELHA_MS) return { dados: cache, atual: false };
    throw err;
  }
}

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

const MSG_PLANILHA = 'Não consegui ler a planilha agora. Tente de novo em instantes.';
const MSG_BANCO = 'Não consegui ler os dados agora. Tente de novo em instantes.';

function celulaPublica(c: Celula): Celula {
  return c.origem === 'sistema' ? { valor: c.valor, origem: c.origem, por: c.por, em: c.em } : { valor: c.valor, origem: c.origem };
}

function textoValor(v: unknown): string {
  return v === null || v === undefined ? 'vazio' : String(v);
}

export function mountClientes(router: Router): void {
  // ── Grade ──────────────────────────────────────────────────────────────────
  router.get('/clientes/solar', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    let pl: { dados: CacheGrade; atual: boolean };
    try { pl = await grade(socio && String(req.query.fresco || '') === '1'); } catch {
      res.status(502).json({ ok: false, error: MSG_PLANILHA });
      return;
    }
    // O instante vem ANTES da leitura: uma edição que caia entre as duas fica depois do `base_em` e gera 409, nunca sobrescrita calada.
    const agora = new Date().toISOString();
    let registros: Map<string, RegistroGestao>;
    try { registros = await lerRegistros(pl.dados.grade.vendas.map((v) => v.codigo)); } catch (err) {
      console.error('[clientes] leitura dos registros falhou', err instanceof ErroGestao ? err.codigo : 'interno');
      res.status(502).json({ ok: false, error: MSG_BANCO });
      return;
    }
    const { colunas, linhas } = montarLinhas(pl.dados.grade, pl.dados.cols, registros, nome, socio);
    const presentes = new Set(colunas.map((c) => c.grupo));
    res.json({
      ok: true,
      papel: socio ? 'socio' : 'consultor',
      consultor: nome,
      em: agora,
      atualizadoEm: new Date(pl.dados.ts).toISOString(),
      fonte: { planilha: pl.atual },
      catalogo: {
        grupos: [...GRUPOS, GRUPO_OUTROS].filter((g) => presentes.has(g)),
        colunas: colunas.map(colunaPublica),
      },
      linhas: linhas.map((l) => ({
        codigo: l.codigo, cliente: l.cliente, consultor: l.consultor, progresso: l.progresso,
        celulas: Object.fromEntries(Object.entries(l.celulas).map(([k, c]) => [k, celulaPublica(c)])),
      })),
      totais: totais(linhas),
    });
  });

  // ── Gravar uma célula ──────────────────────────────────────────────────────
  router.post('/clientes/solar/campo', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { codigo?: unknown; coluna?: unknown; valor?: unknown; base_em?: unknown };
    const codigoRaw = String(b.codigo ?? '').trim();
    const colunaRaw = typeof b.coluna === 'string' ? b.coluna.trim() : '';
    const baseEm = typeof b.base_em === 'string' ? b.base_em : '';
    if (!/^#?\d{1,6}$/.test(codigoRaw) || !colunaRaw || colunaRaw.length > 60) {
      res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      return;
    }
    if (!baseEm || !Number.isFinite(Date.parse(baseEm)) || new Date(baseEm).toISOString() !== baseEm) {
      res.status(400).json({ ok: false, error: 'Pedido inválido: falta o instante da leitura (base_em).' });
      return;
    }
    if (typeof b.valor === 'string' && b.valor.length > 2000) {
      res.status(400).json({ ok: false, error: 'Valor longo demais.' });
      return;
    }
    const codigo = codigoCanonico(codigoRaw);

    let pl: { dados: CacheGrade; atual: boolean };
    try { pl = await grade(false); } catch {
      res.status(502).json({ ok: false, error: MSG_PLANILHA });
      return;
    }
    // 1º a POSSE da venda, antes de qualquer outra conferência: venda inexistente e venda de outro
    // consultor respondem IGUAL (404, mesma mensagem), senão a ordem das recusas revelaria que o código existe.
    const venda = pl.dados.grade.vendas.find((v) => v.codigo === codigo);
    let dono = false;
    if (venda) {
      try {
        const { reg } = await lerRegistroComVersao(codigo);
        dono = socio || podeVer(nome, consultorEfetivo(pl.dados.cols, venda.celulas, reg));
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
        return;
      }
    }
    if (!venda || !dono) { res.status(404).json({ ok: false, error: 'Venda não encontrada.' }); return; }
    // Coluna de sócio para consultor dá a MESMA resposta de coluna que não existe.
    const col = pl.dados.cols.find((c) => c.chave === colunaRaw);
    if (!col || (!socio && col.quem_ve === 'socio')) {
      res.status(400).json({ ok: false, error: 'Coluna não encontrada.' });
      return;
    }
    if (col.chave === 'codigo' || col.calculada) {
      res.status(400).json({ ok: false, error: 'Esta coluna não pode ser editada.' });
      return;
    }
    // O consultor confere contra as opções que ELE recebe (escritas + as das vendas dele), nunca contra o catálogo inteiro:
    // senão "Marcos" digitado viraria a grafia de um engenheiro de venda alheia.
    let colValida: ColunaInterna = col;
    if (!socio && col.tipo === 'lista' && col.livre && col.chave !== 'consultor') {
      try {
        const regs = await lerRegistros(pl.dados.grade.vendas.map((x) => x.codigo));
        const dele = montarLinhas(pl.dados.grade, pl.dados.cols, regs, nome, false).colunas.find((c) => c.chave === col.chave);
        if (dele) colValida = dele;
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
        return;
      }
    }
    const v = validarValor(colValida, b.valor);
    if (!v.ok) { res.status(400).json({ ok: false, error: v.erro }); return; }

    try {
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { reg, versao } = await lerRegistroComVersao(codigo);
        if (!(socio || podeVer(nome, consultorEfetivo(pl.dados.cols, venda.celulas, reg)))) {
          res.status(404).json({ ok: false, error: 'Venda não encontrada.' });
          return;
        }
        if (col.chave === 'consultor' && !socio) {
          res.status(403).json({ ok: false, error: 'Só sócio troca o consultor da venda.' });
          return;
        }
        const antesCel = celulaDe(col, venda.celulas[col.indice] ?? '', reg);
        const outro = houveConflito(reg, col.chave, baseEm, nome);
        if (outro) {
          res.status(409).json({
            ok: false, conflito: true,
            error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
            por: outro.por, em: outro.em, celula: celulaPublica(antesCel),
          });
          return;
        }
        const colunas = colunasPara(pl.dados.cols, socio);
        const celulasDepois = (reg2: RegistroGestao): Record<string, Celula> => {
          const m: Record<string, Celula> = {};
          for (const c of colunas) if (c.chave !== 'codigo') m[c.chave] = celulaDe(c, venda.celulas[c.indice] ?? '', reg2);
          return m;
        };
        const mesmo = v.valor === null ? !reg.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === v.valor);
        const agora = new Date().toISOString();
        let novo = reg;
        if (!mesmo) {
          novo = aplicarGravacao(reg, col, v.valor, antesCel.valor, nome, agora);
          if (!(await gravarRegistro(codigo, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
        }
        const celulas = celulasDepois(novo);
        res.json({
          ok: true,
          celula: celulaPublica(celulas[col.chave]),
          em: agora,
          progresso: progressoDe(colunas, celulas),
        });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
    } catch (err) {
      console.error('[clientes] gravar falhou', err instanceof ErroGestao ? err.codigo : 'interno');
      res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
    }
  });
}
