import { Router, Request, Response, RequestHandler } from 'express';
import { lerDocs, dossieDaVendaSolar, type Ctx } from './geradorClientesDocs';
import { dependenciasDoAlocador } from './geradorVendaSolarCliente';
import { alocarCodigoSolar, previaDoCodigoSolar, cartaoConfiavel, MSG_SEM_PLANILHA, type MotivoErroAlocador } from '../services/gerador/vendaSolarCodigo';
import { codigoDoAlocadorDoCard } from '../services/gerador/vendaSolarRegistro';
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
  acharCartao, acharCartaoCriado, cartoesParecidos, codigoDoTitulo, localDoCartao, tituloDoCartao, titularDaVenda, etiquetasAutomaticas, validarEtiquetasExtra, planoDeEtiquetas, planoDeChecklists,
  passosDeChecklist, descricaoDoCartao, comentarioDaFicha, equipamentoDaProposta, nomearAnexos, extDoMime,
  lerQuadro, criarCartaoCompleto, adicionarEtiqueta, listarChecklists, criarChecklist, marcarItem, idsDosAnexos,
  lerRegistroTrello, gravarRegistroTrello, registroTrelloVazio, comentarNoTrello,
  type CartaoDoQuadro, type Quadro, type AnexoPlano, type RegistroTrello,
} from '../services/gerador/trelloVendaSolar';

// ─────────────────────────────────────────────────────────────────────────────
// CARTÃO DO TRELLO DA VENDA SOLAR (21/10/2026). Montada dentro de /gerador, de dentro de `mountVendaSolar` (a guarda é a dele).
//
//   POST /gerador/vendas-solares/:card/trello   { previa?: boolean, etiquetas_extra?: string[], card_id?: string, novo?: boolean }
//
// Monta o cartão no padrão do quadro (título `#NNNN - (Negociador) Titular - Cidade UF`, etiquetas do quadro, checklists BACKOFFICE e ENGENHARIA,
// descrição) ou atualiza o que já existe. O cartão achado ou criado fica guardado na ligação assinada do card (`trello_card`).
//
// Resposta de `previa: true` (não escreve em lugar nenhum; só lê o Trello):
//   { ok, previa: true, quadro_publico, anexos_bloqueados,
//     cartao: { existente, id, nome, url, lista, achado_por } | null,   // null = vai criar (ou há empate)
//     candidatos?: [{ id, nome, lista, url }], motivo_empate?,           // empate (só número repetido): nada é escolhido sozinho
//     titulo, numero_provisorio, lista,   // cartão novo sem venda ligada: o título leva o PRÓXIMO número da sequência (provisório)
//     parecidos?: [{ id, titulo, url }],  // cartões com nome parecido: só AVISO, nunca escolhidos nem editados
//     avisos?: [texto],                   // ex.: o card guardado foi arquivado e um novo será criado
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
// Venda vendida é SEMPRE cartão novo (22/10/2026), salvo `card_id`, o cartão guardado na ligação ou o #NNNN da venda ligada. Nome parecido
// (do card ou do titular) nunca escolhe cartão: só aparece em `parecidos` na prévia.
// NÚMERO (fase 2, 22/10/2026): esta rota não calcula número próprio. Sem venda ligada, o envio chama o alocador único do servidor
// (`vendaSolarCodigo.ts`) ANTES de achar o cartão e de qualquer escrita no Trello; a prévia só pergunta a ele (`previaDoCodigoSolar`).
// O `novo` do corpo daqui quer dizer "cartão novo" e NUNCA vira o `novo` do alocador: o portão de telefone se resolve no bloco
// Ligações (`POST .../cliente`), e aqui vira 409 `precisa: 'cliente'`. Cartão guardado ANTES do número automático e com `#NNNN` no
// título pode ser de outro parente: vira `empate` de um candidato (a pessoa escolhe com `card_id` ou manda `novo`).
// Empate (mais de um cartão com o mesmo #NNNN): 409 { ok: false, precisa: 'escolher_cartao', candidatos }. A pessoa manda `card_id`, que
// só vale se for um dos cartões abertos do quadro. Se nenhum dos candidatos é deste cliente, a pessoa manda `novo: true`: a rota não procura
// cartão nenhum (nem o guardado na ligação, nem pelo #NNNN) e segue como cartão novo (na prévia: `cartao: null`, sem candidatos).
// `card_id` tem prioridade sobre `novo`.
//
// QUADRO PÚBLICO: nenhum anexo vai. O cartão é criado ou atualizado sem eles e a resposta traz `anexos_bloqueados: true`.
// Nada de valor pessoal em log: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_QUADRO = 'Não consegui ler o quadro do Trello agora. Tente de novo em instantes.';
const MSG_CREDENCIAL = 'Trello sem credencial de escrita. Gere key e token em trello.com/power-ups/admin e configure TRELLO_KEY e TRELLO_TOKEN na Vercel.';
const PRAZO_ANEXOS_MS = 200_000;
/**
 * A trava do card vale mais que o envio mais longo e mais que a vida da função: `maxDuration` é 300 s (api/vercel.json), então 330 s
 * nunca vence com o dono vivo. Se o processo morrer, ela expira sozinha.
 */
const TTL_TRAVA_TRELLO_MS = 330_000;
const RE_ID = /^[0-9a-f]{24}$/;
const MSG_NUMERO = 'Não consegui conferir a numeração do quadro. Tente de novo em instantes.';
const MSG_NUMERO_GRANDE = 'O quadro tem cards demais para conferir a numeração com segurança. Avise o suporte.';
/** Começa por "Atualize a página.": a API vai ao ar antes da tela nova, e a tela velha mostra este texto sem o botão novo. */
const MSG_CLIENTE = 'Atualize a página. Esta venda pode já estar na planilha. No bloco Ligações, ligue a venda certa ou use Criar cliente na planilha, e envie de novo.';
/** Lento DEPOIS de o alocador já ter gravado o número: ele fica reservado (nunca "Nada foi criado"). */
const msgLentoReservado = (codigo: string): string =>
  `O Trello está lento agora. O número ${codigo} ficou reservado para esta venda, mas o card não foi criado. Tente de novo em instantes.`;
const MOTIVO_GUARDADO_ANTIGO = 'este card guardou um cartão numerado antes do número automático, e ele pode ser de outra pessoa da família';
const MOTIVO_GUARDADO_SEM_ASSINATURA = 'este card guardou um cartão numerado só no registro do envio, e ele precisa ser confirmado';
const MOTIVO_NUMERO_DO_GERADOR = 'o número deste cliente foi dado pelo Gerador e este cartão ainda não está ligado a ele';
const MOTIVO_GUARDADO_OUTRO_NUMERO = 'o cartão guardado neste card tem outro número, e o número deste cliente foi dado pelo Gerador';
/** Status e corpo de cada erro do alocador (antes de qualquer escrita no Trello). */
function erroDoAlocador(motivo: MotivoErroAlocador): { status: number; corpo: Record<string, unknown> } {
  switch (motivo) {
    case 'ocupado': return { status: 409, corpo: { ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' } };
    case 'trello': return { status: 502, corpo: { ok: false, error: MSG_NUMERO } };
    case 'trello_grande': return { status: 502, corpo: { ok: false, error: MSG_NUMERO_GRANDE } };
    case 'lento': return { status: 502, corpo: { ok: false, error: MSG_LENTO } };
    case 'sequencia': return { status: 500, corpo: { ok: false, error: 'A numeração passou de #9999. Avise o suporte.' } };
    case 'sem_credencial': return { status: 503, corpo: { ok: false, error: MSG_CREDENCIAL, precisa: 'credencial' } };
    default: return { status: 503, corpo: { ok: false, error: MSG_LER } };   // sem_segredo e banco
  }
}
/** Já passou disto desde o COMEÇO do pedido (a função morre aos 300 s): o Trello está lento, desiste ANTES do POST (nada criado) e solta a trava. */
const PRAZO_ANTES_DE_CRIAR_MS = 150_000;
/** A releitura de recuperação (depois de um POST que falhou) só roda abaixo disto, contado do começo do pedido: sobra tempo para gravar o registro antes dos 300 s. */
const PRAZO_RECUPERACAO_MS = 240_000;
/** O Trello às vezes só mostra o cartão recém-criado segundos depois: uma 2ª releitura depois desta espera. */
const ESPERA_2A_RELEITURA_MS = 2_500;
const MSG_LENTO = 'O Trello está lento agora. Nada foi criado. Tente de novo em instantes.';
const dorme = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

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
  /** Nome do card e local do cartão: com eles o título é refeito quando nasce o número da sequência. */
  nome: string;
  local: string;
  /** Em nome de quem a usina é homologada ('' = sem dado). Entra no título e no casamento do cartão pelo nome. */
  titular: string;
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
  // Titular: o nome da homologação (`tuc_nome` se `homologacao_mesmo` é outra_pessoa ou vazio; contratante se `contratante`); senão o contratante (`nome`).
  const titular = titularDaVenda(cad);
  const local = localDoCartao(cad, g.card.cidade);
  const titulo = tituloDoCartao({ codigoVenda: lig.venda, nome, titular, local });
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
    titulo, nome, local, titular, codigoVenda: lig.venda, lig, cad, descricao, comentario: comentarioDaFicha({ titulo, descricao }), ligacao, temTelefone,
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
    const inicioDoPedido = Date.now();   // os prazos de desistir e de recuperar contam daqui, não de quando uma trava foi pega
    const g = await guarda(req, res);
    if (!g) return;
    const cred = credenciaisTrello();
    if (!cred) { res.status(503).json({ ok: false, error: MSG_CREDENCIAL, precisa: 'credencial' }); return; }

    // ── Pedido ──
    const b = corpoDe(req);
    const previa = b.previa === true;
    if ((b.previa !== undefined && typeof b.previa !== 'boolean')
      || (b.etiquetas_extra !== undefined && (!Array.isArray(b.etiquetas_extra) || b.etiquetas_extra.length > 10 || b.etiquetas_extra.some((x) => typeof x !== 'string')))
      || (b.novo !== undefined && typeof b.novo !== 'boolean')
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
    const novo = b.novo === true;
    const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;

    // Tudo o que decide e escreve acontece aqui dentro. Prévia só lê e roda sem trava; o envio roda DENTRO da trava do card
    // (criação, etiquetas, ficha, checklists, anexos e registro), com o estado lido depois de pegá-la: dois pedidos juntos
    // (clique duplo) nunca criam dois cartões, duas checklists nem o mesmo anexo duas vezes.
    const rodar = async (): Promise<void> => {
      const publico = await trelloQuadroPublico(board);
      const [p, qr] = await Promise.all([preparar(g, publico), lerQuadro(cred, board)]);
      if (!qr.ok) { logErro('quadro', { codigo: 'quadro' }); res.status(502).json({ ok: false, error: MSG_QUADRO }); return; }
      const quadro = qr.dados;
      // O registro do que já foi enviado é lido SEMPRE: ele guarda o cartão criado mesmo quando a ligação assinada não pôde gravar.
      // Na prévia, falha nessa leitura vale registro vazio (só mostra o que faria); na criação o erro sobe: sem o registro não dá para
      // garantir que não duplica.
      let lido: RegistroTrello = registroTrelloVazio();
      try { lido = await lerRegistroTrello(g.id); } catch (err) { if (!previa) throw err; logErro('registro (prévia)', err); }
      const abertoNoQuadro = (id: string | null | undefined): string | null => (id && quadro.cartoes.some((c) => c.id === id) ? id : null);
      const guardado = abertoNoQuadro(p.lig.trello_card) ?? abertoNoQuadro(lido.card_id);
      if (escolhido && !quadro.cartoes.some((c) => c.id === escolhido)) {
        res.status(400).json({ ok: false, error: 'O cartão escolhido não está entre os cartões abertos do quadro.' });
        return;
      }
      const tituloCom = (codigo: string | null): string => tituloDoCartao({ codigoVenda: codigo, nome: p.nome, titular: p.titular, local: p.local });
      const comCodigo = (codigo: string): void => {
        p.codigoVenda = codigo;
        p.lig = { ...p.lig, venda: codigo };
        p.titulo = tituloCom(codigo);
        p.comentario = comentarioDaFicha({ titulo: p.titulo, descricao: p.descricao });
      };
      const avisosPrevia: string[] = [];
      const avisosDoNumero: string[] = [];
      let numeroProvisorio = false;
      // A planilha do Excel só confere o número: fora do ar, o número sai do registro e do quadro, e a resposta diz isso.
      let planilhaFora = false;
      const semVenda = !p.codigoVenda;

      // Cartão guardado ANTES do número automático e com `#NNNN` no título: até a fase 1 a rota achava cartão por nome, e ele pode
      // ser de outro parente. Vira empate de um candidato só; nada é alocado. Sem número no título, não pergunta.
      // O mesmo vale para o cartão que só está no registro do envio (`card_id` sem assinatura): ele nunca dá o número sozinho.
      const cartaoGuardado = guardado ? quadro.cartoes.find((c) => c.id === guardado) ?? null : null;
      const guardadoSoNoRegistro = !!cartaoGuardado && cartaoGuardado.id !== p.lig.trello_card;
      let achado: ReturnType<typeof acharCartao> | null = null;
      if (semVenda && !escolhido && !novo && cartaoGuardado && codigoDoTitulo(cartaoGuardado.name)
        && (guardadoSoNoRegistro || !cartaoConfiavel(cartaoGuardado.id))) {
        achado = { tipo: 'empate', candidatos: [cartaoGuardado], motivo: guardadoSoNoRegistro ? MOTIVO_GUARDADO_SEM_ASSINATURA : MOTIVO_GUARDADO_ANTIGO };
      }

      // O cartão que vai ao alocador: o escolhido; senão o da LIGAÇÃO assinada (mesmo arquivado: o número não depende do caminho);
      // senão o guardado no registro do envio, marcado como sem assinatura (nunca confiável).
      const doRegistro = !escolhido && !p.lig.trello_card && !!guardado;
      const cartaoParaOAlocador = novo && !escolhido
        ? { cartaoTrello: null }
        : { cartaoTrello: escolhido ?? p.lig.trello_card ?? guardado ?? null, cartaoEscolhido: !!escolhido, ...(doRegistro ? { cartaoSemAssinatura: true } : {}) };
      let alocouAgora = false;
      let reservouAgora = false;

      if (!achado && semVenda && !previa) {
        // Envio sem venda ligada: o número vem do alocador ANTES de achar o cartão e de qualquer escrita no Trello. O `novo` do corpo
        // NUNCA vai como `novo` do alocador (pularia o portão de telefone).
        const r = await alocarCodigoSolar({
          card: g.card, quem: { nome: g.nome, socio: g.socio }, novo: false, inicio: inicioDoPedido, ...cartaoParaOAlocador,
        }, dependenciasDoAlocador());
        if (!r.ok) {
          if (r.motivo === 'confirmar') {
            res.status(409).json({
              ok: false, precisa: 'cliente', error: r.semPlanilha ? `Atualize a página. ${MSG_SEM_PLANILHA}` : MSG_CLIENTE,
              candidatos: r.candidatos, ocultas: r.ocultas, ...(r.semPlanilha ? { semPlanilha: true } : {}),
            });
            return;
          }
          const e = erroDoAlocador(r.motivo);
          logErro('numeração', { codigo: r.motivo });
          res.status(e.status).json(e.corpo);
          return;
        }
        comCodigo(r.codigo);
        if (r.aviso) avisosDoNumero.push(r.aviso);
        if (r.planilhaFora) planilhaFora = true;
        alocouAgora = r.acao === 'criou' || r.acao === 'adotou_trello';
        reservouAgora = true;
      }

      // `novo` (sem `card_id`): a pessoa já viu os candidatos e disse que nenhum é deste cliente; não procura cartão nenhum.
      if (!achado) {
        achado = novo && !escolhido
          ? { tipo: 'nenhum' }
          : acharCartao({ cartoes: quadro.cartoes, escolhido, guardado, codigoVenda: p.codigoVenda });
      }
      // Achado só pelo NÚMERO (ou guardado com OUTRO número) quando o código é do alocador deste card: a pessoa confirma. Sem isto,
      // alguém numerando à mão "#N - Outro cliente" no Trello receberia os documentos deste cliente.
      if (achado.tipo === 'achou' && p.codigoVenda && (achado.por === 'numero' || achado.por === 'guardado')) {
        const nDoGuardado = achado.por === 'guardado' ? codigoDoTitulo(achado.cartao.name) : null;
        if (achado.por === 'numero' || (nDoGuardado && nDoGuardado !== p.codigoVenda)) {
          // O alocador acabou de dar o número neste pedido: vale o resultado dele, sem reler. Senão, registro válido deste card OU
          // presente com assinatura inválida conta como do alocador (na dúvida, a pessoa confirma).
          if (alocouAgora || await codigoDoAlocadorDoCard(p.codigoVenda, g.id)) {
            achado = { tipo: 'empate', candidatos: [achado.cartao], motivo: achado.por === 'numero' ? MOTIVO_NUMERO_DO_GERADOR : MOTIVO_GUARDADO_OUTRO_NUMERO };
          }
        }
      }
      const desejadas = [...p.desejadas, ...extra.validas.filter((e) => !p.desejadas.includes(e))];
      const plano = planoDeChecklists(p.slots, p.temTelefone, !!slugValor(p.cad, 'email'));

      if (achado.tipo === 'empate') {
        const candidatos = achado.candidatos.map((c) => resumoCartao(quadro, c));
        if (previa) {
          res.json({ ok: true, previa: true, quadro_publico: publico, anexos_bloqueados: publico && p.anexos.length > 0, cartao: null, candidatos, motivo_empate: achado.motivo, titulo: p.titulo, numero_provisorio: false, lista: null });
          return;
        }
        // O alocador pode já ter gravado o número neste pedido: o aviso dele vai junto.
        res.status(409).json({
          ok: false, precisa: 'escolher_cartao', error: 'Mais de um cartão pode ser deste cliente. Escolha o cartão.', motivo: achado.motivo, candidatos,
          ...(avisosDoNumero.length ? { avisos: avisosDoNumero } : {}),
        });
        return;
      }

      const existente = achado.tipo === 'achou' ? achado.cartao : null;
      const parecidos = existente ? [] : cartoesParecidos({ cartoes: quadro.cartoes, nome: p.nome, titular: p.titular })
        .map((c) => ({ id: c.id, titulo: c.name, url: c.shortUrl || c.url || null }));
      // O cartão guardado (na ligação ou no registro) não está mais aberto no quadro (foi arquivado): um card novo será criado.
      if (!existente && !guardado && (p.lig.trello_card || lido.card_id)) avisosPrevia.push('O card guardado foi arquivado no Trello. Um card novo será criado.');
      if (semVenda && previa) {
        // Prévia sem venda ligada: só PERGUNTA ao alocador (sem trava, sem escrever). Planilha fora segue só com o quadro (provisório).
        const r = await previaDoCodigoSolar({
          card: g.card, quem: { nome: g.nome, socio: g.socio }, novo: false, inicio: inicioDoPedido, ...cartaoParaOAlocador,
        }, dependenciasDoAlocador(true));
        if (!r.ok) {
          const e = erroDoAlocador(r.motivo);
          logErro('numeração', { codigo: r.motivo });
          res.status(e.status).json(e.corpo);
          return;
        }
        if (r.acao === 'confirmar') avisosPrevia.push(r.semPlanilha ? MSG_SEM_PLANILHA : 'Esta venda pode já estar na planilha. Resolva no bloco Ligações antes de enviar.');
        else {
          comCodigo(r.codigo);
          numeroProvisorio = r.provisorio;
          if (r.planilhaFora) planilhaFora = true;
          if (r.aviso) avisosPrevia.push(r.aviso);
          // A mesma conferência do envio: cartão guardado com OUTRO número que o da prévia vira empate (a prévia não pode dizer
          // "atualiza o cartão" onde o envio pergunta).
          const nDoGuardado = existente && achado.tipo === 'achou' && achado.por === 'guardado' ? codigoDoTitulo(existente.name) : null;
          if (existente && nDoGuardado && nDoGuardado !== r.codigo) {
            res.json({
              ok: true, previa: true, quadro_publico: publico, anexos_bloqueados: publico && p.anexos.length > 0, cartao: null,
              candidatos: [resumoCartao(quadro, existente)], motivo_empate: MOTIVO_GUARDADO_OUTRO_NUMERO, titulo: p.titulo,
              numero_provisorio: numeroProvisorio, lista: null, ...(planilhaFora ? { planilhaFora: true } : {}),
              ...(avisosPrevia.length ? { avisos: avisosPrevia } : {}),
            });
            return;
          }
        }
      }
      // `novo` com outro cartão do mesmo número no quadro: o cartão novo vai repetir o número. Só avisa.
      if (novo && !escolhido && p.codigoVenda && quadro.cartoes.some((c) => codigoDoTitulo(c.name) === p.codigoVenda)) {
        avisosDoNumero.push(`Já existe outro cartão com o número ${p.codigoVenda} no Trello. Ajuste um dos títulos.`);
      }
      if (previa) avisosPrevia.push(...avisosDoNumero);
      let titulo = p.titulo;
      const nomesDoCartao = (existente?.labels ?? []).map((l) => String(l.name ?? '')).filter(Boolean);
      const etiquetas = planoDeEtiquetas(desejadas, quadro.etiquetas, nomesDoCartao);
      const lista = existente ? nomeDaLista(quadro, existente.idList) : listaDosNovos(quadro)?.nome ?? null;

      // Registro do que já foi enviado (zera se era de outro cartão).
      let reg: RegistroTrello = registroTrelloVazio();
      if (existente) reg = lido.card_id === existente.id ? lido : registroTrelloVazio();

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
          titulo, numero_provisorio: numeroProvisorio, ...(planilhaFora ? { planilhaFora: true } : {}), ...(parecidos.length ? { parecidos } : {}), ...(avisosPrevia.length ? { avisos: avisosPrevia } : {}), lista,
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
      const avisos: string[] = [...avisosDoNumero];
      let cardId = existente?.id ?? '';
      let cardUrl: string | null = existente ? (existente.shortUrl || existente.url || null) : null;
      let cardNome = existente?.name ?? titulo;
      let criou = false;
      let aplicadas = etiquetas.aplicar.map((e) => e.name);

      if (!existente) {
        const dest = listaDosNovos(quadro);
        if (!dest) { res.status(502).json({ ok: false, error: `Não achei a lista "${LISTA_CARTAO_NOVO}" no quadro.`, precisa: 'lista' }); return; }
        // Tudo isto roda DENTRO da trava do card (veja o fim do arquivo), com a leitura feita depois de pegá-la. O número já foi
        // reservado pelo alocador (registro e ligação): aqui só se cria o cartão com ele.
        type Feito = { erroNumero: string } | { erroNumero: null; r: Awaited<ReturnType<typeof criarCartaoCompleto>> };
        const criar = async (): Promise<Feito> => {
          const inicio = inicioDoPedido;
          const codigo: string | null = p.codigoVenda;
          // Prazo interno: leituras lentas comeram o tempo. Desiste ANTES do POST, sem criar nada.
          if (Date.now() - inicio > PRAZO_ANTES_DE_CRIAR_MS) {
            logErro('prazo', { codigo: 'lento' });
            return { erroNumero: reservouAgora && codigo ? msgLentoReservado(codigo) : MSG_LENTO };
          }
          let r = await criarCartaoCompleto(cred, { idList: dest.id, nome: titulo, desc: p.descricao, idLabels: etiquetas.aplicar.map((e) => e.id) });
          if (!r.ok && codigo) {
            // Falhou ou estourou o tempo, mas o Trello pode ter criado o cartão: se há UM cartão aberto, NOVO (que não estava na lista
            // lida antes do POST), com este #NNNN, é o nosso. Adota. Relê uma 2ª vez depois de uns segundos, se ainda sobra tempo.
            const jaExistiam = new Set(quadro.cartoes.map((c) => c.id));
            for (let tentativa = 0; tentativa < 2; tentativa++) {
              if (tentativa === 1) await dorme(ESPERA_2A_RELEITURA_MS);
              if (Date.now() - inicio > PRAZO_RECUPERACAO_MS) break;
              const nasceu = await acharCartaoCriado(cred, board, codigo, jaExistiam);
              if (nasceu) { r = { ok: true, dados: { id: nasceu.id, url: nasceu.shortUrl || nasceu.url || null } }; break; }
            }
          }
          return { erroNumero: null, r };
        };
        const feito = await criar();
        if (feito.erroNumero !== null) { res.status(502).json({ ok: false, error: feito.erroNumero }); return; }
        const novoCartao = feito.r;
        if (!novoCartao.ok) { res.status(502).json({ ok: false, error: `Não consegui criar o cartão: ${novoCartao.motivo}` }); return; }
        cardNome = titulo;
        // O id do cartão vai PRIMEIRO para o registro do envio (só ids, nenhum dado pessoal) e depois para a ligação assinada. Se a
        // ligação falhar (a trava dos vínculos é global e pode estar ocupada), o registro ainda faz o próximo envio achar este cartão.
        reg = { ...registroTrelloVazio(), card_id: novoCartao.dados.id };
        let registroGravou = true;
        try { await gravarRegistroTrello(g.id, reg); } catch (err) { registroGravou = false; logErro('registro do cartão novo', err); }
        try { await guardarCartaoNaLigacao(g.id, g.nome, novoCartao.dados.id); } catch (err) {
          logErro('ligação do cartão', err);
          avisos.push(registroGravou
            ? 'O cartão foi criado, mas não consegui guardar a ligação com o card agora. O próximo envio o acha pelo registro do envio.'
            : 'O cartão foi criado, mas não consegui guardar o vínculo dele com o card. Confira o quadro antes de enviar de novo, para não duplicar.');
        }
        cardId = novoCartao.dados.id; cardUrl = novoCartao.dados.url; criou = true;
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
        ok, previa: false, criou_cartao: criou, ...(planilhaFora ? { planilhaFora: true } : {}),
        cartao: { id: cardId, nome: cardNome, url: cardUrl, lista },
        titulo,
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
