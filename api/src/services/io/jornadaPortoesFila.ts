// ─────────────────────────────────────────────────────────────────────────────
// OS PORTÕES DA OBRA SOLAR NO CRON DA FILA DAS 08:00 (19/11/2026). Compra, Logística, Obra e Entrega abrem a etapa seguinte pelo dado, mas só uma gravação (ou o
// anexo de um arquivo) registra isso. A obra que cumpriu o portão e ninguém salvou depois ficaria, para a fila e para a escalada, na etapa velha: o aviso iria
// para o dono errado. Antes de montar a fila, este passo registra o que já vale, SEMPRE com o autor `leitura`: o estado é gravado, mas o robô "É sua" ignora
// esse autor (nunca avisa por ele). Só grava quando muda algo e nunca usa nome de gente. Não envia nada. Falha de uma obra só tira ela da sincronia (só o código no log).
// ─────────────────────────────────────────────────────────────────────────────
import { etapaAtualCompleta } from '../gerador/jornadaObra';
import { lerObraPrivada, mudarObra, obraVazia } from '../gerador/jornadaObraBanco';
import { lerDocsComVersao } from '../gerador/docsClienteBanco';
import { aplicarPortoes } from '../gerador/obraPortoes';
import { ehRecusa, lerJornadaComVersao, type Recusa } from '../gerador/jornadaSolarBanco';
import { elegivelParaHomolog } from '../gerador/trelloHomologPuro';
import { diaBRT } from '../agentes5040/relogio';
import { chaveFila, type ObraFila } from './jornadaMensagensPuro';
import { jaTravadas } from './jornadaMensagensBase';

const AUTOR_SILENCIOSO = 'leitura';

/**
 * A fila do dia do Thiago ou a do Diego já saiu? Decide o autor da conclusão automática da etapa 3 pelo Trello (veja `autorDaConclusaoAutomatica`): com a fila
 * ainda por sair, a obra concluída já entra nela (autor `leitura`, sem "É sua"); com a fila de um deles já fora, o aviso sai (autor `trello`). Leitura que
 * falha vale "não saiu" (o lado silencioso).
 */
async function filaDosDonosJaSaiu(agora: Date): Promise<boolean> {
  const dia = diaBRT(agora);
  const chaves = ['thiago', 'diego'].map((p) => chaveFila(dia, p));
  const ja = await jaTravadas(chaves);
  return !!ja && chaves.some((c) => ja.has(c));
}

/**
 * Homologação lida do Trello (20/11/2026): a obra com a etapa 3 aberta e cartão é sincronizada com o cartão ANTES da fila (e conclui sozinha se o
 * parecer fechou). Devolve a obra com o estado já relido quando isso pode ter mudado. `import()` por causa do ciclo de módulos. Nunca lança.
 */
type Homologar = typeof import('../../routes/geradorJornadaHomolog').homologarDaFila;
/** O tempo TOTAL que a homologação pode gastar antes da fila das 08:00. Estourou: para de esperar e o resto fica para o GET ou o dia seguinte. A fila nunca deixa de sair por causa dela. */
export const ORCAMENTO_HOMOLOG_MS = 60_000;

/** Espera `p` por no máximo `ms`; passou disso, devolve sem ela (que termina sozinha em segundo plano: o que ela grava é por anexo e com trava). */
async function comTeto(p: Promise<unknown>, ms: number): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([p, new Promise<void>((ok) => { t = setTimeout(ok, ms); })]); } finally { clearTimeout(t); }
}

async function homologarAntes(o: ObraFila, filaSaiu: boolean, homologar: Homologar | null, fim: number): Promise<ObraFila> {
  const restante = fim - Date.now();
  if (!homologar || restante <= 0 || !elegivelParaHomolog(o.js, o.jo)) return o;
  try {
    const feito = homologar(o.card, o.js, o.jo, filaSaiu);
    feito.catch(() => undefined);
    await comTeto(feito, restante);
    const { estado } = await lerJornadaComVersao(o.card);
    return estado ? { ...o, js: estado } : o;
  } catch (err) {
    console.error('[jornada-msg] homologacao', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
    return o;
  }
}

/** Registra os portões de UMA obra. Devolve o estado novo, ou o mesmo quando nada mudou. */
async function sincronizarUma(o0: ObraFila, agora: string, filaSaiu: boolean, homologar: Homologar | null, fim: number): Promise<ObraFila> {
  const o = await homologarAntes(o0, filaSaiu, homologar, fim);
  if (!o.jo || o.jo.fechada || o.cancelada) return o;
  const n = etapaAtualCompleta(o.js, o.jo, null);
  if (n === null || n < 4 || n > 7) return o;
  const [privada, { reg }] = await Promise.all([lerObraPrivada(o.card), lerDocsComVersao('vendasolar', String(o.card))]);
  if (!privada) return o;
  const slots = new Map<string, string[]>();
  for (const a of reg.arquivos) slots.set(a.slot, [...(slots.get(a.slot) ?? []), a.id]);
  const docsIds = new Set(reg.arquivos.map((a) => a.id));
  const r = await mudarObra(o.card, () => obraVazia(o.card), (e) => {
    const novo = aplicarPortoes(e, { privada, docsIds, slots }, agora, AUTOR_SILENCIOSO);
    return novo === e ? ({ recusa: 'nada', http: 200 } as Recusa) : novo;
  });
  return ehRecusa(r) ? o : { ...o, jo: r };
}

/**
 * Sincroniza os portões das obras abertas e devolve a lista com o estado já avançado (a fila e a escalada leem esta). Nunca lança: a obra que falha segue com
 * o estado que tinha. Em lotes de 4 (as leituras são do Storage e do banco).
 */
export async function sincronizarPortoesDaFila(obras: readonly ObraFila[], agora: Date, orcamentoHomologMs: number = ORCAMENTO_HOMOLOG_MS): Promise<ObraFila[]> {
  const iso = agora.toISOString();
  const temEtapa3 = obras.some((o) => elegivelParaHomolog(o.js, o.jo));
  const filaSaiu = temEtapa3 ? await filaDosDonosJaSaiu(agora) : false;
  // `import()` por causa do ciclo de módulos, UMA vez por rodada. Falha ao carregar: sem homologação, a fila segue.
  const homologar: Homologar | null = temEtapa3 ? await import('../../routes/geradorJornadaHomolog').then((m) => m.homologarDaFila, () => null) : null;
  const fim = Date.now() + orcamentoHomologMs;
  const saida: ObraFila[] = [];
  for (let i = 0; i < obras.length; i += 4) {
    const lote = await Promise.all(obras.slice(i, i + 4).map((o) => sincronizarUma(o, iso, filaSaiu, homologar, fim).catch((err): ObraFila => {
      console.error('[jornada-msg] portoes', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
      return o;
    })));
    saida.push(...lote);
  }
  return saida;
}
