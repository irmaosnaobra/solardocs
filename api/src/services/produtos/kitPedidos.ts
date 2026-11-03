/**
 * KIT FECHA VENDAS: "esta conta tem pedido pago?", respondido aqui para o menu (`acessos()`).
 *
 * Eram duas regras. O menu (`acessos()`) lia kit_pedidos só por user_id; o curso (`/kit/meu-acesso`) lia por
 * user_id OU e-mail da conta, com QUALQUER item pago. Quem comprou com o e-mail da conta e sem user_id gravado
 * (Off-Grid, Precificação) via o curso aberto e o menu com cadeado.
 *
 * Agora o menu usa a regra do curso: pedido PAGO achado pelo user_id OU pelo e-mail da conta, de qualquer item.
 * A regra só SOMA: quem já via o curso no menu continua vendo (todo pedido achado pelo user_id continua
 * achado). Não há filtro pelo item `kit` de propósito: apertar a regra é onde alguém perderia acesso.
 *
 * `acessoDoUsuario` (kitIntegradorService, /kit/meu-acesso) guarda a sua própria cópia da mesma regra (user_id ou
 * e-mail, status paid, qualquer item). Mexeu numa, confira a outra.
 *
 * Existem DUAS cópias da mesma regra: esta, que só `acessos` importa, e a de `acessoDoUsuario`, dentro do
 * `kitIntegradorService`, que não importa daqui. Este arquivo não importa `acessos` nem `kitIntegradorService`
 * de propósito: um ciclo entre eles deixaria o `require` do dist pela metade.
 */

import { supabase } from '../../utils/supabase';

export type PedidoKit = {
  order_id: string;
  itens: string[];
  criado_em: string;
  trial_vip_ate: string | null;
  email: string;
};

/**
 * Pedidos PAGOS desta conta, do mais antigo ao mais novo, sem repetir a linha que as duas buscas trazem.
 * Duas consultas em vez de `.or()`: endereço com '+' (gmail+tag) quebra dentro do filtro do PostgREST (o
 * '+' vira espaço) e o comprador some da própria compra. Erro de leitura vira lista vazia: na dúvida, o
 * curso não abre (errar para o lado de trancar é recuperável).
 */
export async function pedidosPagosDaConta(userId: string, email: string | null | undefined): Promise<PedidoKit[]> {
  const colunas = 'order_id, itens, status, criado_em, trial_vip_ate, user_id, email';
  const emailLc = String(email ?? '').toLowerCase().trim();
  const buscas = [supabase.from('kit_pedidos').select(colunas).eq('user_id', userId).eq('status', 'paid')];
  if (emailLc) buscas.push(supabase.from('kit_pedidos').select(colunas).eq('email', emailLc).eq('status', 'paid'));
  const respostas = await Promise.all(buscas);

  const vistos = new Set<string>();
  return respostas
    .flatMap((r) => ((r.data ?? []) as unknown as PedidoKit[]))
    .filter((l) => {
      if (vistos.has(l.order_id)) return false;   // a mesma linha vem nas duas consultas
      vistos.add(l.order_id);
      return true;
    })
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}
