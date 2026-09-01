'use client';

import { useCampanha } from '../lib/sessao.ts';

/**
 * Leva a campanha junto no clique do WhatsApp.
 *
 * A UTM chega na PRIMEIRA página e some quando a pessoa navega para o modelo.
 * Sem carregá-la até aqui, todo lead de anúncio chegaria como tráfego sem
 * origem — e saber de qual anúncio veio a venda é metade do motivo de anunciar.
 *
 * Campo escondido, e não parâmetro na URL: o formulário é GET, então o campo já
 * vira query string sozinho, sem sujar o endereço que a pessoa vê.
 */
export function CampanhaOculta() {
  const campanha = useCampanha();

  if (!campanha) return null;
  return <input type="hidden" name="campanha" value={campanha} />;
}
