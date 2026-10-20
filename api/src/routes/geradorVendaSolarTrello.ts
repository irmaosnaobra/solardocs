import { Router, Request, Response, RequestHandler } from 'express';
import { lerDocs, dossieDaVendaSolar, type Ctx } from './geradorClientesDocs';
import { ErroDocs, baixarObjeto } from '../services/gerador/docsClienteBanco';
import { ErroCadastro, comTrava } from '../services/gerador/cadastroVendaBanco';
import { lerCadastroVisto, type Cadastro } from '../services/gerador/cadastroVenda';
import { CATALOGO, SLOTS_FORA_DO_RELATORIO, itemDoCatalogo } from '../services/gerador/docsCliente';
import type { CardVendido } from '../services/gerador/fichaEletroposto';
import { TRELLO_BOARD_ID } from '../services/insightsService';
import {
  credenciaisTrello, trelloQuadroPublico, anexarNoTrello, baixarArquivo, normalizarNome, lerProposta,
  LISTA_CARTAO_NOVO, MSG_QUADRO_PUBLICO,
} from '../services/gerador/dossieVenda';
import {
  ErroHub, TRAVA_VINCULOS, POR_TRELLO, lerLigacao, gravarLigacao, type Ligacao,
} from '../services/gerador/vendaSolarHub';
import {
  acharCartao, localDoCartao, tituloDoCartao, etiquetasAutomaticas, validarEtiquetasExtra, planoDeEtiquetas, planoDeChecklists,
  passosDeChecklist, descricaoDoCartao, comentarioDaFicha, equipamentoDaProposta, nomearAnexos, extDoMime,
  lerQuadro, criarCartaoCompleto, adicionarEtiqueta, listarChecklists, criarChecklist, marcarItem, idsDosAnexos,
  lerRegistroTrello, gravarRegistroTrello, registroTrelloVazio, comentarNoTrello,
  type CartaoDoQuadro, type Quadro, type AnexoPlano, type RegistroTrello,
} from '../services/gerador/trelloVendaSolar';

// ─────────────────────────────────────────────────────────────────────────────
// CARTÃO DO TRELLO DA VENDA SOLAR (21/10/2026). Montada dentro de /gerador, de dentro de `mountVendaSolar` (a guarda é a dele).
//
//   POST /gerador/vendas-solares/:card/trello   { previa?: boolean, etiquetas_extra?: string[], card_id?: string }
//
// Monta o cartão no padrão do quadro (título `#NNNN - Nome - Cidade UF`, etiquetas do quadro, checklists BACKOFFICE e ENGENHARIA,
// descrição) ou atualiza o que já existe. O cartão achado ou criado fica guardado na ligação assinada do card (`trello_card`).
//
// Resposta de `previa: true` (não escreve em lugar nenhum; só lê o Trello):
//   { ok, previa: true, quadro_publico, anexos_bloqueados,
//     cartao: { existente, id, nome, url, lista, achado_por } | null,   // null = vai criar (ou há empate)
//     candidatos?: [{ id, nome, lista, url }], motivo_empate?,           // empate: nada é escolhido sozinho
//     titulo, lista,
//     etiquetas: { aplicar: [nome], ja_tem: [nome], ausentes: [nome], conflitos: [{ desejada, existente }] },
//     checklists: { BACKOFFICE: [{ nome, marcado }], ENGENHARIA: [...], criar: [nome], marcar: [nome do item] },
//     descricao: string | null,   // só cartão novo
//     comentario: string | null,  // só cartão que já existe
//     anexos: [{ nome, slot, de: 'card' | 'dossie', ja_enviado }] }
// Resposta de verdade:
//   { ok, previa: false, criou_cartao, cartao: { id, nome, url, lista }, titulo,
//     etiquetas: { aplicadas, ja_tem, ausentes, conflitos }, checklists: { criadas, marcados }, ficha: 'descricao' | 'comentario',
//     anexos: { enviados, ja_enviados, falhas, pendentes, bloqueados }, anexos_bloqueados?: true, erros: [texto], avisos: [texto] }
//   200 quando tudo deu certo; 207 com `ok: false` quando algo falhou ou os anexos foram recusados (quadro público).
// Empate (mais de um cartão possível): 409 { ok: false, precisa: 'escolher_cartao', candidatos }. A pessoa manda `card_id`, que
// só vale se for um dos cartões abertos do quadro.
//
// QUADRO PÚBLICO: nenhum anexo vai. O cartão é criado ou atualizado sem eles e a resposta traz `anexos_bloqueados: true`.
// Nada de valor pessoal em log: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_QUADRO = 'Não consegui ler o quadro do Trello agora. Tente de novo em instantes.';
const MSG_CREDENCIAL = 'Trello sem credencial de escrita. Gere key e token em trello.com/power-ups/admin e configure TRELLO_KEY e TRELLO_TOKEN na Vercel.';
const PRAZO_ANEXOS_MS = 200_000;
/** A trava do card vale mais que o envio mais longo (o prazo dos anexos mais as outras chamadas); se o processo morrer, ela expira sozinha. */
const TTL_TRAVA_TRELLO_MS = 280_000;
const RE_ID = /^[0-9a-f]{24}$/;

const logErro = (que: string, err: unknown): void =>
  console.error(`[venda-solar-trello] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

const corpoDe = (req: Request): Record<string, unknown> => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export interface DonoDoCard { nome: string; socio: boolean; card: CardVendido; id: number }
export type GuardaDoCard = (req: Request, res: Response) => Promise<DonoDoCard | null>;

const slugValor = (cad: Cadastro, k: string): string =>
  String((cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();

/** Os slots do catálogo da venda solar, na ordem em que a tela os mostra (para os anexos saírem sempre na mesma ordem). */
const ORDEM_SLOTS = CATALOGO.vendasolar.map((i) => i.chave);

/** O item não sobe ao Trello: fora do relatório de engenharia, sem item no catálogo, ou `outros` (conteúdo desconhecido). */
const naoVaiAoTrello = (slot: string): boolean =>
  slot === 'outros' || SLOTS_FORA_DO_RELATORIO.has(slot) || !itemDoCatalogo('vendasolar', slot);

interface Preparo {
  titulo: string;
  codigoVenda: string | null;
  lig: Ligacao;
  cad: Cadastro;
  descricao: string;
  comentario: string;
  ligacao: string;
  temTelefone: boolean;
  slots: Set<string>;
  anexos: AnexoPlano[];
  /** O dossiê antigo da proposta: id do anexo por caminho, e o cartão para onde ele foi. */
  dossieAntigo: { cartao: string | null; anexos: Map<string, string> };
  desejadas: string[];
}

/** O arquivo já está no cartão: o registro guarda o anexo, ou o dossiê antigo o pôs NESTE mesmo cartão. */
const jaEnviado = (a: AnexoPlano, reg: RegistroTrello, dossieAntigo: Preparo['dossieAntigo'], cardId: string | null): boolean =>
  !!reg.anexados[a.chave] || !!(a.anexoAntigo && cardId && dossieAntigo.cartao === cardId);

function listaDosNovos(q: Quadro): { id: string; nome: string } | null {
  const fixo = String(process.env.TRELLO_LISTA_ID || '').trim();
  if (fixo) return { id: fixo, nome: q.listas.find((l) => l.id === fixo)?.name ?? LISTA_CARTAO_NOVO };
  const alvo = normalizarNome(LISTA_CARTAO_NOVO);
  const l = q.listas.find((x) => normalizarNome(x.name) === alvo);
  return l ? { id: l.id, nome: l.name } : null;
}

const nomeDaLista = (q: Quadro, id: string): string | null => q.listas.find((l) => l.id === id)?.name ?? null;
const resumoCartao = (q: Quadro, c: CartaoDoQuadro) => ({ id: c.id, nome: c.name, lista: nomeDaLista(q, c.idList), url: c.shortUrl || c.url || null });

async function preparar(g: DonoDoCard, publico: boolean): Promise<Preparo> {
  const ctx: Ctx = { linha: 'vendasolar', codigo: String(g.id), nome: g.nome, socio: g.socio, cliente: String(g.card.cliente_nome ?? ''), card: g.card };
  const [{ lig }, cad, docs, dv] = await Promise.all([
    lerLigacao(g.id), lerCadastroVisto(g.id, 'vendasolar'), lerDocs(ctx), dossieDaVendaSolar(ctx, 0, false),
  ]);
  const proposta = dv ? await lerProposta(dv.proposta) : null;

  const nome = String(g.card.cliente_nome ?? '');
  const titulo = tituloDoCartao({ codigoVenda: lig.venda, nome, local: localDoCartao(cad, g.card.cidade) });
  const telefoneCard = String(g.card.cliente_telefone ?? '');
  const temTelefone = telefoneCard.replace(/\D/g, '').length >= 8;
  const ligacao = slugValor(cad, 'uc_fornecimento');
  const descricao = descricaoDoCartao({
    telefone: temTelefone ? telefoneCard : slugValor(cad, 'telefone'),
    email: slugValor(cad, 'email'), ligacao, publico,
    equip: equipamentoDaProposta(proposta ? { qtd_placas: proposta.qtd_placas, inversor: proposta.inversor, qtd_inversor: proposta.qtd_inversor, dados: proposta.dados } : null),
  });

  // Arquivos: os do card e os do dossiê da proposta ligada (já nos itens da venda solar). Só entra o que o relatório de engenharia
  // também levaria: documento de avalista, de outras pessoas, comprovantes de endereço e o titular do financiamento ficam de fora.
  const slots = new Set<string>();
  const brutos: Array<Omit<AnexoPlano, 'nome'>> = [];
  for (const a of docs.reg.arquivos) {
    slots.add(a.slot);
    if (naoVaiAoTrello(a.slot)) continue;
    brutos.push({ chave: a.id, slot: a.slot, de: 'card', caminho: a.caminho, mime: a.mime });
  }
  const antigos = new Map<string, string>();
  for (const lista of Object.values(proposta?.dossie.arquivos ?? {})) {
    for (const a of lista) if (a.trello_anexo_id) antigos.set(a.path, a.trello_anexo_id);
  }
  for (const a of dv?.arquivos ?? []) {
    slots.add(a.slot);
    if (naoVaiAoTrello(a.slot)) continue;
    brutos.push({ chave: `dossie:${a.path}`, slot: a.slot, de: 'dossie', caminho: a.path, mime: a.mime, anexoAntigo: antigos.get(a.path) ?? null });
  }
  brutos.sort((x, y) => ORDEM_SLOTS.indexOf(x.slot) - ORDEM_SLOTS.indexOf(y.slot));
  const rotulo = (slot: string): string => itemDoCatalogo('vendasolar', slot)?.rotulo ?? slot;

  return {
    titulo, codigoVenda: lig.venda, lig, cad, descricao, comentario: comentarioDaFicha({ titulo, descricao }), ligacao, temTelefone,
    slots, anexos: nomearAnexos(brutos, rotulo),
    dossieAntigo: { cartao: proposta?.dossie.trello.card_id ?? null, anexos: antigos },
    desejadas: etiquetasAutomaticas(cad),
  };
}

/** Grava o cartão na ligação assinada, DENTRO da trava dos vínculos e relendo a ligação. Ligação que não existia nasce com `por: 'trello'`. */
async function guardarCartaoNaLigacao(id: number, quem: string, trelloId: string): Promise<void> {
  await comTrava(TRAVA_VINCULOS, quem, async () => {
    const { lig, existe } = await lerLigacao(id);
    if (existe && lig.trello_card === trelloId) return;
    const novo: Ligacao = existe
      ? { ...lig, trello_card: trelloId }
      : { proposta: null, venda: null, por: POR_TRELLO, em: new Date().toISOString(), trello_card: trelloId };
    await gravarLigacao(id, novo);
  });
}

export function mountVendaSolarTrello(router: Router, base: RequestHandler[], guarda: GuardaDoCard): void {
  router.post('/vendas-solares/:card/trello', ...base, async (req: Request, res: Response) => {
    const g = await guarda(req, res);
    if (!g) return;
    const cred = credenciaisTrello();
    if (!cred) { res.status(503).json({ ok: false, error: MSG_CREDENCIAL, precisa: 'credencial' }); return; }

    // ── Pedido ──
    const b = corpoDe(req);
    const previa = b.previa === true;
    if ((b.previa !== undefined && typeof b.previa !== 'boolean')
      || (b.etiquetas_extra !== undefined && (!Array.isArray(b.etiquetas_extra) || b.etiquetas_extra.length > 10 || b.etiquetas_extra.some((x) => typeof x !== 'string')))
      || (b.card_id !== undefined && b.card_id !== null && (typeof b.card_id !== 'string' || !RE_ID.test(b.card_id)))) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO });
      return;
    }
    const extra = validarEtiquetasExtra(b.etiquetas_extra);
    if (extra.invalidas.length) {
      res.status(400).json({ ok: false, error: 'Só equipes e FASTRACK podem ser pedidas como etiqueta extra.', invalidas: extra.invalidas });
      return;
    }
    const escolhido = typeof b.card_id === 'string' ? b.card_id : null;
    const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;

    // Tudo o que decide e escreve acontece aqui dentro. Prévia só lê e roda sem trava; o envio roda DENTRO da trava do card
    // (criação, etiquetas, ficha, checklists, anexos e registro), com o estado lido depois de pegá-la: dois pedidos juntos
    // (clique duplo) nunca criam dois cartões, duas checklists nem o mesmo anexo duas vezes.
    const rodar = async (): Promise<void> => {
      const publico = await trelloQuadroPublico(board);
      const [p, qr] = await Promise.all([preparar(g, publico), lerQuadro(cred, board)]);
      if (!qr.ok) { logErro('quadro', { codigo: 'quadro' }); res.status(502).json({ ok: false, error: MSG_QUADRO }); return; }
      const quadro = qr.dados;
      if (escolhido && !quadro.cartoes.some((c) => c.id === escolhido)) {
        res.status(400).json({ ok: false, error: 'O cartão escolhido não está entre os cartões abertos do quadro.' });
        return;
      }
      const achado = acharCartao({ cartoes: quadro.cartoes, escolhido, guardado: p.lig.trello_card ?? null, codigoVenda: p.codigoVenda, nome: String(g.card.cliente_nome ?? '') });
      const desejadas = [...p.desejadas, ...extra.validas.filter((e) => !p.desejadas.includes(e))];
      const plano = planoDeChecklists(p.slots, p.temTelefone, !!slugValor(p.cad, 'email'));

      if (achado.tipo === 'empate') {
        const candidatos = achado.candidatos.map((c) => resumoCartao(quadro, c));
        if (previa) {
          res.json({ ok: true, previa: true, quadro_publico: publico, anexos_bloqueados: publico && p.anexos.length > 0, cartao: null, candidatos, motivo_empate: achado.motivo, titulo: p.titulo, lista: null });
          return;
        }
        res.status(409).json({ ok: false, precisa: 'escolher_cartao', error: 'Mais de um cartão pode ser deste cliente. Escolha o cartão.', motivo: achado.motivo, candidatos });
        return;
      }

      const existente = achado.tipo === 'achou' ? achado.cartao : null;
      const nomesDoCartao = (existente?.labels ?? []).map((l) => String(l.name ?? '')).filter(Boolean);
      const etiquetas = planoDeEtiquetas(desejadas, quadro.etiquetas, nomesDoCartao);
      const lista = existente ? nomeDaLista(quadro, existente.idList) : listaDosNovos(quadro)?.nome ?? null;

      // Registro do que já foi enviado (zera se era de outro cartão).
      let reg: RegistroTrello = registroTrelloVazio();
      if (existente) {
        const lido = await lerRegistroTrello(g.id);
        reg = lido.card_id === existente.id ? lido : registroTrelloVazio();
      }

      // ── Prévia: o que faria, sem escrever em lugar nenhum ──
      // Anexo só conta como pendente se ainda precisa subir: quadro público com tudo já enviado não bloqueia nada.
      const faltamAnexos = p.anexos.filter((a) => !jaEnviado(a, reg, p.dossieAntigo, existente?.id ?? null));

      if (previa) {
        let passos: ReturnType<typeof passosDeChecklist> = passosDeChecklist(plano, []);
        if (existente) {
          const cl = await listarChecklists(cred, existente.id);
          if (cl.ok) passos = passosDeChecklist(plano, cl.dados);
        }
        res.json({
          ok: true, previa: true, quadro_publico: publico, anexos_bloqueados: publico && faltamAnexos.length > 0,
          cartao: existente ? { existente: true, ...resumoCartao(quadro, existente), achado_por: achado.tipo === 'achou' ? achado.por : null } : null,
          titulo: p.titulo, lista,
          etiquetas: { aplicar: etiquetas.aplicar.map((e) => e.name), ja_tem: etiquetas.ja_tem, ausentes: etiquetas.ausentes, conflitos: etiquetas.conflitos },
          checklists: {
            BACKOFFICE: plano.BACKOFFICE, ENGENHARIA: plano.ENGENHARIA,
            criar: passos.filter((x) => x.criar).map((x) => x.nome),
            marcar: passos.flatMap((x) => x.marcar.map((m) => m.nome)),
          },
          descricao: existente ? null : p.descricao,
          comentario: existente ? p.comentario : null,
          anexos: p.anexos.map((a) => ({
            nome: a.nome, slot: a.slot, de: a.de,
            ja_enviado: jaEnviado(a, reg, p.dossieAntigo, existente?.id ?? null),
          })),
        });
        return;
      }

      // ── Escrever ──
      const erros: string[] = [];
      const avisos: string[] = [];
      let cardId = existente?.id ?? '';
      let cardUrl: string | null = existente ? (existente.shortUrl || existente.url || null) : null;
      let cardNome = existente?.name ?? p.titulo;
      let criou = false;
      let aplicadas = etiquetas.aplicar.map((e) => e.name);

      if (!existente) {
        const dest = listaDosNovos(quadro);
        if (!dest) { res.status(502).json({ ok: false, error: `Não achei a lista "${LISTA_CARTAO_NOVO}" no quadro.`, precisa: 'lista' }); return; }
        // Tudo isto roda DENTRO da trava do card (veja o fim do arquivo), com a leitura feita depois de pegá-la.
        const novo = await criarCartaoCompleto(cred, { idList: dest.id, nome: p.titulo, desc: p.descricao, idLabels: etiquetas.aplicar.map((e) => e.id) });
        if (!novo.ok) { res.status(502).json({ ok: false, error: `Não consegui criar o cartão: ${novo.motivo}` }); return; }
        try { await guardarCartaoNaLigacao(g.id, g.nome, novo.dados.id); } catch (err) {
          logErro('ligação do cartão', err);
          avisos.push('O cartão foi criado, mas não consegui guardar a ligação com o card. Na próxima vez ele será achado pelo número ou pelo nome.');
        }
        cardId = novo.dados.id; cardUrl = novo.dados.url; criou = true;
        reg = { ...registroTrelloVazio(), card_id: cardId };
      } else {
        if (p.lig.trello_card !== existente.id) {
          try { await guardarCartaoNaLigacao(g.id, g.nome, existente.id); } catch (err) {
            logErro('ligação do cartão', err);
            avisos.push('Não consegui guardar a ligação do cartão com o card agora.');
          }
        }
        // Só acrescenta etiqueta; nunca tira.
        const postas: string[] = [];
        for (const e of etiquetas.aplicar) {
          const r = await adicionarEtiqueta(cred, cardId, e.id);
          if (r.ok) postas.push(e.name); else erros.push(`etiqueta ${e.name}: ${r.motivo}`);
        }
        aplicadas = postas;
        // A ficha de um cartão que já existia vai num comentário único (editado a cada envio); a descrição ninguém sobrescreve.
        const c = await comentarNoTrello(cred, cardId, p.comentario, reg.comentario_id);
        if (c.ok) reg.comentario_id = c.id; else erros.push(`ficha: ${c.motivo}`);
        reg.card_id = cardId;
      }
      if (etiquetas.ausentes.length) avisos.push(`Etiqueta que não existe no quadro (não criei): ${etiquetas.ausentes.join(', ')}.`);
      if (etiquetas.conflitos.length) avisos.push(`O cartão já tem outra etiqueta do mesmo grupo: ${etiquetas.conflitos.map((c) => `${c.existente} no lugar de ${c.desejada}`).join('; ')}. Não mudei.`);

      // ── Checklists ──
      const criadas: string[] = [];
      const marcados: string[] = [];
      const cl = await listarChecklists(cred, cardId);
      if (!cl.ok) erros.push(`checklists: ${cl.motivo}`);
      else {
        for (const passo of passosDeChecklist(plano, cl.dados)) {
          if (passo.criar) {
            const r = await criarChecklist(cred, cardId, passo.nome, passo.criar);
            if (r.ok) { criadas.push(passo.nome); if (r.dados.falhas) erros.push(`checklist ${passo.nome}: ${r.dados.falhas} item(ns) não entraram`); }
            else erros.push(`checklist ${passo.nome}: ${r.motivo}`);
          }
          for (const m of passo.marcar) {
            const r = await marcarItem(cred, cardId, m.idItem);
            if (r.ok) marcados.push(m.nome); else erros.push(`item ${m.nome}: ${r.motivo}`);
          }
        }
      }

      // ── Anexos ──
      // Quadro público: nada sobe, nunca. Só conta como bloqueado o que ainda precisaria subir.
      const faltam = p.anexos.filter((a) => !jaEnviado(a, reg, p.dossieAntigo, cardId));
      const bloqueados = publico && faltam.length > 0;
      const anexos = { enviados: 0, ja_enviados: 0, falhas: 0, pendentes: 0, bloqueados };
      if (publico) {
        anexos.pendentes = faltam.length;
        anexos.ja_enviados = p.anexos.length - faltam.length;
      } else if (p.anexos.length) {
        const noCartao = await idsDosAnexos(cred, cardId);
        const naoSeiOQueTem = !noCartao.ok;
        if (naoSeiOQueTem) avisos.push('Não consegui conferir os anexos que o cartão já tem; enviei só o que o registro não conhece.');
        const tem = noCartao.ok ? noCartao.dados : new Set<string>();
        const limite = Date.now() + PRAZO_ANEXOS_MS;
        for (const a of p.anexos) {
          const jaId = reg.anexados[a.chave];
          const antigo = a.anexoAntigo && p.dossieAntigo.cartao === cardId ? a.anexoAntigo : null;
          if ((jaId && (naoSeiOQueTem || tem.has(jaId))) || (antigo && (naoSeiOQueTem || tem.has(antigo)))) {
            if (!jaId && antigo) reg.anexados[a.chave] = antigo;
            anexos.ja_enviados++;
            continue;
          }
          if (Date.now() > limite) { anexos.pendentes++; continue; }
          let bytes: Buffer | null = null;
          try { bytes = a.de === 'card' ? await baixarObjeto(a.caminho) : await baixarArquivo(a.caminho); } catch { bytes = null; }
          if (!bytes) { anexos.falhas++; erros.push(`${a.nome}: não consegui ler o arquivo`); continue; }
          const r = await anexarNoTrello(cred, cardId, `${a.nome}.${extDoMime(a.mime)}`, bytes, a.mime);
          if (r.ok) { reg.anexados[a.chave] = r.id; anexos.enviados++; } else { anexos.falhas++; erros.push(`${a.nome}: ${r.motivo}`); }
        }
        if (anexos.pendentes) avisos.push(`${anexos.pendentes} arquivo(s) ficaram para o próximo envio.`);
      }

      try { await gravarRegistroTrello(g.id, reg); } catch (err) {
        logErro('registro do Trello', err);
        avisos.push('Não consegui guardar o que já foi enviado; um novo envio pode repetir anexos.');
      }

      const ok = erros.length === 0 && !bloqueados;
      res.status(ok ? 200 : 207).json({
        ok, previa: false, criou_cartao: criou,
        cartao: { id: cardId, nome: cardNome, url: cardUrl, lista },
        titulo: p.titulo,
        etiquetas: { aplicadas, ja_tem: etiquetas.ja_tem, ausentes: etiquetas.ausentes, conflitos: etiquetas.conflitos },
        checklists: { criadas, marcados },
        ficha: criou ? 'descricao' : 'comentario',
        anexos,
        ...(bloqueados ? { anexos_bloqueados: true, error: MSG_QUADRO_PUBLICO } : {}),
        erros, avisos,
      });
    };

    try {
      if (previa) await rodar();
      else await comTrava(`trello:${g.id}`, g.nome, rodar, TTL_TRAVA_TRELLO_MS);
    } catch (err) {
      logErro('envio falhou', err);
      if (err instanceof ErroCadastro && err.codigo === 'ocupado') {
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' });
        return;
      }
      if (err instanceof ErroDocs) { res.status(err.http).json({ ok: false, error: err.mensagem }); return; }
      if (err instanceof ErroCadastro || err instanceof ErroHub) { res.status(503).json({ ok: false, error: MSG_LER }); return; }
      res.status(500).json({ ok: false, error: MSG_LER });
    }
  });
}
