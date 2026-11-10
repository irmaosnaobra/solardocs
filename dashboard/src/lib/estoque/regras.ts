/**
 * ESTOQUE EM DIA: regras puras (sem React, sem `@/`), provadas por script com tsx.
 */

export interface ItemRegra {
  id: string;
  local: string;
  nome: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  estoque_minimo: number;
}

const n = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

/** No mínimo ou abaixo, e só quando a pessoa definiu um mínimo. */
export const faltaRepor = (i: ItemRegra) => n(i.estoque_minimo) > 0 && n(i.quantidade) <= n(i.estoque_minimo);

/** Quanto falta até o mínimo (0 quando está exatamente no mínimo). */
export const faltaAteMinimo = (i: ItemRegra) => Math.max(n(i.estoque_minimo) - n(i.quantidade), 0);

export const valorDoItem = (i: ItemRegra) => n(i.quantidade) * n(i.valor_unitario);

/** Tira acento e caixa, para "capacete" achar "Capacete (EPI)" e "deposito" achar "Depósito". */
export const normaliza = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const qtdTxt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Texto da lista de compra, pronto para copiar ou mandar no WhatsApp. Sem travessão. */
export function textoListaCompra(
  itens: ItemRegra[],
  empresa?: string | null,
  data = new Date(),
  maximo?: number,
): string {
  const todos = itens.length;
  if (maximo && todos > maximo) itens = itens.slice(0, maximo);
  const dia = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const linhas = [`Lista de compra${empresa ? ' da ' + empresa : ''}`, `Estoque em ${dia}`, ''];
  for (const i of itens) {
    const falta = faltaAteMinimo(i);
    const tem = `tem ${qtdTxt(n(i.quantidade))}, mínimo ${qtdTxt(n(i.estoque_minimo))}`;
    linhas.push(
      falta > 0
        ? `- ${i.nome} (${i.local}): comprar ${qtdTxt(falta)} ${i.unidade} (${tem})`
        : `- ${i.nome} (${i.local}): repor, está no mínimo (${tem})`,
    );
  }
  if (maximo && todos > maximo) linhas.push('', `E mais ${todos - maximo} itens. Veja o resto no Estoque em Dia.`);
  return linhas.join('\n');
}

/** O link do WhatsApp leva no máximo este tanto de itens: URL muito longa é cortada ou recusada. */
export const LIMITE_WHATSAPP = 25;

/** Link do WhatsApp sem número: a pessoa escolhe para quem manda. */
export const linkWhatsapp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
