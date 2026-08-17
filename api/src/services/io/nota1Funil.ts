// ─────────────────────────────────────────────────────────────────────────────
// A CONTA do funil do NOTA 1 — separada da rota de propósito, porque as duas
// regras que valem alguma coisa aqui não são passthrough de banco:
//   1. o piso de 07/08, que impede contar como "mandado pra página" quem foi
//      recusado quando o destino ainda era o grupo de WhatsApp;
//   2. o alerta de medição furada, que é o que impede o painel de mostrar queda
//      onde na verdade o beacon quebrou.
// O resto (ler as tabelas) mora na rota; aqui não entra nada de rede.
//
// DUAS UNIDADES, DOIS BANCOS. `mandados` são fichas do gerador-propostas;
// `chegaram` são sessões de navegador do solardoc-pro. Não existe chave em
// comum — isto é comparação de contagem, nunca join.
// ─────────────────────────────────────────────────────────────────────────────

/** Dia em que o nota 1 parou de cair no grupo de WhatsApp e passou a ser
 *  redirecionado pra página de material. Antes disso não havia pra onde ir. */
export const NOTA1_MATERIAL_DESDE = '2026-08-07';

/**
 * Dia em que o nota 1 DEIXOU de cair na página de material: desde 17/08/2026 o
 * destino é /io/eletroposto/parceria, a página das duas portas.
 *
 * Sem este teto o painel mente sozinho a partir de amanhã. `mandados` continua
 * subindo (o NOTA 1 não parou de existir) e `chegaram` cai pra zero (ninguém
 * mais abre a página com o carimbo da recusa), então a conversão despenca e o
 * card fica vermelho dizendo "procure defeito" — sobre um caminho que foi
 * desligado de propósito. Depois desta data o funil do material é HISTÓRICO:
 * quem mede as portas é a aba Conexão.
 */
export const NOTA1_MATERIAL_ATE = '2026-08-17';

export const NOTA1_TIPOS = ['material_view', 'material_scroll', 'checkout_start', 'material_voltar_form'];

export interface FichaNota1 {
  created_at: string; nome?: string | null; telefone?: string | null;
  cidade?: string | null; pts?: number | null; motivo_descarte?: string[] | null; origem?: string | null;
}
export interface EventoMaterial {
  tipo: string; session_id: string | null; payload: { motivo?: string } | null; created_at: string;
}
export interface CompraMaterial { created_at: string }

export interface LinhaFunil {
  dia: string;
  mandados: number; chegaram: number; chegaram_fora: number; rolaram: number;
  checkout: number; checkout_fora: number; voltaram: number; compras: number;
  medicao_furada: boolean;
}

/** Início da janela: o mais RECENTE entre "hoje − dias" e o piso do redirect. */
export function inicioDaJanela(dias: number, agora: number = Date.now()): string {
  const janela = new Date(agora - dias * 86400_000).toISOString();
  const piso = new Date(`${NOTA1_MATERIAL_DESDE}T00:00:00-03:00`).toISOString();
  return janela > piso ? janela : piso;
}

const fmtSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});
const diaSP = (iso: string): string => fmtSP.format(new Date(iso));

/** Veio da recusa da LP? O `motivo` é escrito pela LP no sessionStorage no
 *  instante em que ela recusa — `neutro` (ou vazio) é link direto, anúncio do
 *  curso ou aba nova. Sem esta divisão, o lançamento do curso entra no funil do
 *  nota 1 e a conversão vira ficção. */
export const doNota1 = (e: { payload?: { motivo?: string } | null }): boolean => {
  const m = (e.payload?.motivo || '').trim();
  return !!m && m !== 'neutro';
};

interface Balde {
  mandados: number; compras: number;
  chegaram: Set<string>; chegaram_fora: Set<string>; rolaram: Set<string>;
  checkout: Set<string>; checkout_fora: Set<string>; voltaram: Set<string>;
}
const novoBalde = (): Balde => ({
  mandados: 0, compras: 0,
  chegaram: new Set(), chegaram_fora: new Set(), rolaram: new Set(),
  checkout: new Set(), checkout_fora: new Set(), voltaram: new Set(),
});

/**
 * Uma linha por dia (fuso de Brasília), da mais recente pra mais antiga.
 *
 * A unidade de tudo que vem de evento é SESSÃO, não evento: recarregar a página
 * dispara `material_view` de novo, e contar evento diria que 5 pessoas viraram 14.
 */
export function linhasDoFunil(
  fichas: FichaNota1[], eventos: EventoMaterial[], compras: CompraMaterial[],
): LinhaFunil[] {
  const porDia = new Map<string, Balde>();
  const balde = (d: string): Balde => {
    const b = porDia.get(d) ?? novoBalde();
    porDia.set(d, b);
    return b;
  };

  for (const f of fichas) if (f.created_at) balde(diaSP(f.created_at)).mandados += 1;
  for (const c of compras) if (c.created_at) balde(diaSP(c.created_at)).compras += 1;
  for (const e of eventos) {
    if (!e.created_at) continue;
    const b = balde(diaSP(e.created_at));
    const s = e.session_id || `sem-sessao-${e.created_at}`;
    const meu = doNota1(e);
    if (e.tipo === 'material_view') (meu ? b.chegaram : b.chegaram_fora).add(s);
    else if (e.tipo === 'material_scroll') b.rolaram.add(s);
    else if (e.tipo === 'checkout_start') (meu ? b.checkout : b.checkout_fora).add(s);
    else if (e.tipo === 'material_voltar_form') b.voltaram.add(s);
  }

  return [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, b]) => ({
      dia,
      mandados: b.mandados,
      chegaram: b.chegaram.size,
      chegaram_fora: b.chegaram_fora.size,
      rolaram: b.rolaram.size,
      checkout: b.checkout.size,
      checkout_fora: b.checkout_fora.size,
      voltaram: b.voltaram.size,
      compras: b.compras,
      // ROLAGEM SEM VISITA É IMPOSSÍVEL: ninguém rola uma página que não abriu.
      // Quando aparece, o beacon da visita está quebrado e o dia está subcontado
      // — foi exatamente o que houve de 12 a 14/08/2026 (o `var API` ficava
      // abaixo do beacon, então o fetch saía pra "undefined/plugcash/evento" e
      // o .catch engolia). A régua NÃO pode ser "chegaram < mandados": lead que
      // preenche 23h58 e abre a página 00h01 cai em dias diferentes, e isso é
      // normal — 09/08 teve 6 fichas e 5 sessões sem nada de errado.
      medicao_furada: b.rolaram.size > 0 && b.chegaram.size + b.chegaram_fora.size === 0,
    }));
}

/** Soma de uma coluna das linhas — o TOTAL é o número pra olhar, porque ele não
 *  sofre com lead que atravessa a meia-noite entre a ficha e a visita. */
export function somaColuna(linhas: LinhaFunil[], k: keyof Omit<LinhaFunil, 'dia' | 'medicao_furada'>): number {
  return linhas.reduce((s, l) => s + l[k], 0);
}
