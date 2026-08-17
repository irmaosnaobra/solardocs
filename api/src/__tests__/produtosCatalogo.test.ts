import { describe, it, expect } from 'vitest';
import {
  PRODUTOS, produtoPorId, produtosDaAssinatura, classificarProduto,
} from '../services/produtos/catalogo';
import { FERRAMENTAS_DO_ANUAL } from '../services/precoAnual';

// O catálogo é uma lista de constantes — o tipo de arquivo que ninguém acha que
// precisa de teste até alguém "arrumar" um campo e devolver, de graça, produto
// que passou a ser pago. Estes testes travam as REGRAS DE DINHEIRO que moram
// nele, não a lista.

describe('catálogo: o que a assinatura libera', () => {
  it('Precificação e Inventário NÃO vêm na assinatura mensal', () => {
    // Regra de 17/08/2026: as duas são exclusivas do plano anual. Voltar o flag
    // pra true entrega R$ 134 em ferramentas pra toda a base mensal em silêncio
    // — e a LP inteira (5 lugares) passa a mentir na direção contrária.
    const derivados = produtosDaAssinatura();
    expect(derivados).not.toContain('precificacao');
    expect(derivados).not.toContain('inventario');
  });

  it('as duas se anunciam como produto do plano anual', () => {
    // `noPlanoAnual` é o que a loja, o cadeado e a página de venda leem pra
    // dizer POR ONDE se consegue a ferramenta. Sem ele, a pessoa vê um cadeado
    // que não explica o caminho.
    for (const id of ['precificacao', 'inventario']) {
      expect(produtoPorId(id)?.noPlanoAnual).toBe(true);
    }
  });

  it('a lista que o webhook do anual concede é a mesma do catálogo', () => {
    // Duas listas pro mesmo fato é como o cliente paga R$ 564 e não recebe o que
    // a página prometeu. Se uma ferramenta nova entrar no anual, tem que entrar
    // nas duas pontas.
    const marcados = PRODUTOS.filter((p) => p.noPlanoAnual).map((p) => p.id).sort();
    expect(marcados).toEqual([...FERRAMENTAS_DO_ANUAL].sort());
  });

  it('quem paga avulso continua tendo por onde comprar', () => {
    // Ferramenta fora da assinatura e sem preço é um cadeado sem saída.
    for (const id of ['precificacao', 'inventario']) {
      expect(produtoPorId(id)!.preco).toBeGreaterThan(0);
    }
  });
});

describe('catálogo: classificação da compra na Kiwify', () => {
  it('casa pelos DOIS nomes — o de venda e o de dentro da plataforma', () => {
    // "Calculadora Solar" e "Inventário Empresarial" são os nomes do painel da
    // Kiwify. Nome que não casa = comprador pago e sem acesso (já aconteceu com
    // o bump renomeado em 01/ago).
    expect(classificarProduto('Calculadora Solar', null)?.id).toBe('precificacao');
    expect(classificarProduto('Precificação Profissional', null)?.id).toBe('precificacao');
    expect(classificarProduto('Inventário Empresarial', null)?.id).toBe('inventario');
    expect(classificarProduto('Inventário da Empresa', null)?.id).toBe('inventario');
  });

  it('produto de fora do catálogo não vira acesso', () => {
    expect(classificarProduto('Curso de Marketing', null)).toBeNull();
    expect(classificarProduto(null, null)).toBeNull();
  });
});
