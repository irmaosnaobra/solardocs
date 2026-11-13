/**
 * OS TEXTOS DAS PÁGINAS DE VENDA INTERNAS (`/produtos/<slug>`), aprovados pelo redator em 10/11/2026.
 *
 * Só o que a página diz e mostra. Preço, nome e botões do cartão vêm de `catalogo.ts`; o preço aqui só aparece dentro
 * das frases aprovadas e é conferido contra o catálogo pelo script de conferência (nunca divergem sem aviso).
 *
 * Regras de texto: português, frase com maiúscula, sem travessão, sem emoji, nunca "vitalício".
 */

import {
  Boxes, Clock, FileText, Truck, BarChart3, Bell, ListChecks, FileDown,
  MessageSquare, Route, Users, ShieldQuestion, Gauge, MessageCircle, CheckCircle2,
  Sparkles, Home, Calculator, Repeat, ShieldCheck, ArrowUpFromLine,
  type LucideIcon,
} from 'lucide-react';
import type { IdProdutoLoja } from './catalogo';

export interface ItemComIcone { icone: LucideIcon; titulo: string; texto: string }
export interface Passo { titulo: string; texto: string }
export interface Pergunta { p: string; r: string }
export interface Imagem { src: string; alt: string; largura: number; altura: number }

export interface PaginaDeVenda {
  selo: string;
  iconeSelo: LucideIcon;
  titulo: string;
  subtitulo: string;
  botao: string;
  linhaPagamento: string;
  paraQuem: ItemComIcone[];
  como: Passo[];
  resolve: ItemComIcone[];
  quadro: string[];
  rodapeQuadro: string;
  perguntas: Pergunta[];
  fechamento: string;
  /** A imagem (ou as imagens) do herói. */
  hero: Imagem[];
  /** A imagem ao lado de "Como funciona". */
  comoImagem: Imagem;
}

export const PAGINAS_DE_VENDA: Partial<Record<IdProdutoLoja, PaginaDeVenda>> = {
  inventario: {
    selo: 'Estoque em Dia',
    iconeSelo: Boxes,
    titulo: 'Saiba o que você tem, onde está e quando repor',
    subtitulo: 'Cadastre ferramentas, EPI e material por local, com valor e estoque mínimo. O total do estoque soma sozinho e a tela avisa quando é hora de repor.',
    botao: 'Liberar o Estoque em Dia por R$ 67',
    linhaPagamento: 'Um pagamento de R$ 67, sem mensalidade. Acesso liberado na hora, enquanto sua conta existir. 7 dias de garantia. Já vem no plano anual.',
    paraQuem: [
      { icone: Boxes, titulo: 'Empresa com ferramenta espalhada', texto: 'Tem ferramenta, EPI e material entre escritório, montagem e depósito.' },
      { icone: Clock, titulo: 'Equipe que repõe na pressa', texto: 'Descobre que o material acabou quando a equipe já está na obra.' },
      { icone: FileText, titulo: 'Quem precisa mostrar o que tem', texto: 'Precisa passar ao contador ou ao seguro a relação do que a empresa possui.' },
      { icone: Truck, titulo: 'Quem tem veículos', texto: 'Quer ter a frota no mesmo controle das ferramentas.' },
    ],
    como: [
      { titulo: 'Escolha o local e o material', texto: 'A lista já vem com o que costuma ter em escritório, montagem, depósito e frota. Se o item não estiver nela, você digita.' },
      { titulo: 'Preencha marca, quantidade, valor e mínimo', texto: 'O valor de cada item entra no total do estoque. O mínimo é o que dispara o aviso de repor.' },
      { titulo: 'Registre entradas e saídas', texto: 'Chegou material, lance a entrada. Saiu para a obra, lance a saída, com uma observação se quiser.' },
    ],
    resolve: [
      { icone: BarChart3, titulo: 'Estoque sem número', texto: 'O total do estoque e o total de cada local aparecem na tela.' },
      { icone: Bell, titulo: 'Material que acaba', texto: 'Quando a quantidade chega no mínimo, a linha avisa que é hora de repor.' },
      { icone: ListChecks, titulo: 'Começar do zero', texto: 'Um toque monta um inventário de exemplo com 14 itens. Você só ajusta os valores.' },
      { icone: FileDown, titulo: 'Papel para o contador', texto: 'Um botão gera o PDF separado por local, com os totais, a logo e os dados da sua empresa.' },
    ],
    quadro: [
      'Cadastro por local, com marca, unidade, quantidade e valor.',
      'Catálogo pronto com 46 materiais em 4 locais, e inventário de exemplo com 14 itens.',
      'Total do estoque e total de cada local.',
      'Estoque mínimo e aviso de repor.',
      'Entrada e saída com observação.',
      'PDF com a logo e os dados da empresa.',
    ],
    rodapeQuadro: 'Já vem no plano anual. 7 dias de garantia.',
    perguntas: [
      { p: 'Preciso cadastrar tudo de uma vez?', r: 'Não. Você pode cadastrar só o que importa agora, ou montar o inventário de exemplo e ir ajustando.' },
      { p: 'Posso criar os meus próprios locais?', r: 'Pode. Além de escritório, montagem, depósito e frota, você cria o local que quiser e controla o material lá dentro do mesmo jeito.' },
      { p: 'O que sai no PDF?', r: 'O estoque separado por local, com quantidade, valor de cada item e os totais. A logo e o CNPJ saem quando a empresa está cadastrada.' },
      { p: 'Tenho o plano anual. Preciso pagar de novo?', r: 'Não. O Estoque em Dia já vem no plano anual e fica seu enquanto a sua conta existir.' },
    ],
    fechamento: 'Tenha o estoque da sua empresa num lugar só, com o total sempre à vista.',
    hero: [
      { src: '/produtos/estoque-tela.webp', alt: 'Tela do Estoque em Dia: total em equipamento e lista de itens com local e valor', largura: 1120, altura: 1024 },
      { src: '/produtos/estoque-celular.webp', alt: 'A mesma tela do Estoque em Dia no celular', largura: 804, altura: 998 },
    ],
    comoImagem: { src: '/produtos/estoque-celular.webp', alt: 'Tela do Estoque em Dia no celular: total em equipamento e a lista de itens com o valor de cada um', largura: 804, altura: 998 },
  },

  'curso-fechamento': {
    selo: 'Fecha Vendas',
    iconeSelo: MessageSquare,
    titulo: 'Resposta pronta para cada objeção do cliente',
    subtitulo: 'Curso em texto, dentro da plataforma, sem vídeo. Respostas de objeção, roteiro de visita, mensagens de WhatsApp e contrato com a sua marca.',
    botao: 'Liberar o Fecha Vendas por R$ 27',
    linhaPagamento: 'Um pagamento de R$ 27, sem mensalidade. Acesso liberado na hora, enquanto sua conta existir. 7 dias de garantia. Já vem em qualquer assinatura paga.',
    paraQuem: [
      { icone: MessageSquare, titulo: 'Quem ouve "tá caro" e "vou pensar"', texto: 'Quer ter a resposta pronta na hora em que o cliente fala.' },
      { icone: Route, titulo: 'Quem está começando', texto: 'Precisa do caminho da primeira ligação até a assinatura.' },
      { icone: Clock, titulo: 'Quem tem orçamento parado', texto: 'Quer mensagens prontas para retomar quem sumiu.' },
      { icone: Users, titulo: 'Quem tem equipe', texto: 'Quer que todo mundo responda a objeção a partir da mesma base.' },
    ],
    como: [
      { titulo: 'Abra a trilha', texto: 'São 6 módulos em texto, dentro da plataforma, com o seu progresso salvo.' },
      { titulo: 'Copie a fala', texto: 'Cada objeção traz o que o cliente quer dizer, o erro comum, a fala pronta para a visita e a versão curta para o WhatsApp.' },
      { titulo: 'Ponha em prática', texto: 'Use o roteiro da visita, calcule o seu preço na calculadora da plataforma e emita um contrato com a sua marca.' },
    ],
    resolve: [
      { icone: ShieldQuestion, titulo: 'Objeção sem resposta', texto: '32 respostas em 6 grupos: preço e concorrência, enrolação e sumiço, medo e confiança, mercado, técnica do imóvel e hora de assinar.' },
      { icone: Gauge, titulo: 'Visita sem roteiro', texto: 'As 6 etapas da visita e as 5 perguntas para o cliente comparar orçamentos.' },
      { icone: MessageCircle, titulo: 'Lead parado', texto: '15 mensagens prontas de primeiro contato, follow-up, reativação e pedido de indicação.' },
      { icone: CheckCircle2, titulo: 'Venda que termina na assinatura', texto: 'O que fazer depois do sim, e as três garantias explicadas separadas.' },
    ],
    quadro: [
      '6 módulos com 18 lições e o seu progresso salvo.',
      '32 respostas de objeção, com fala pronta e versão de WhatsApp.',
      '15 mensagens de prospecção e follow-up, com o momento certo de usar cada uma.',
      'Roteiro da visita, módulo de preço e margem e módulo de pós-venda.',
      'Missão prática: emitir um contrato com o seu CNPJ e a sua logo.',
      'Bônus de 3 lições sobre vender para empresa, que abre quando você usa a plataforma.',
    ],
    rodapeQuadro: 'Já vem em qualquer assinatura paga. 7 dias de garantia.',
    perguntas: [
      { p: 'É vídeo?', r: 'Não. É um curso em texto, dentro da plataforma, com o seu progresso salvo.' },
      { p: 'Serve para quem está começando?', r: 'Serve. O módulo 2 vai da primeira ligação até a assinatura. Quem já vende pode ir direto no grupo de objeção que apareceu na última visita.' },
      { p: 'Já sou assinante. Preciso comprar?', r: 'Não. O Fecha Vendas já vem em qualquer assinatura paga, enquanto ela estiver ativa. A compra avulsa é para quem não assina.' },
      { p: 'Como abre o bônus?', r: 'Ao concluir as lições, cadastrar a sua empresa e um cliente e gerar um documento na plataforma.' },
    ],
    fechamento: 'A próxima objeção já pode ter resposta pronta.',
    hero: [
      { src: '/produtos/fv-licao.webp', alt: 'Lição do Fecha Vendas: a objeção do cliente, o que ele quer dizer, o erro comum, a fala pronta e a versão de WhatsApp', largura: 1200, altura: 907 },
    ],
    comoImagem: { src: '/produtos/fv-mensagens.webp', alt: 'Lição de mensagens do Fecha Vendas: primeiro contato, o momento certo de usar e a mensagem pronta', largura: 1200, altura: 907 },
  },

  'curso-limpapro': {
    selo: 'LimpaPro',
    iconeSelo: Sparkles,
    titulo: 'Monte um serviço de limpeza de placas solares',
    subtitulo: 'Curso em 5 módulos: a técnica sem riscar o vidro, segurança em altura, quanto cobrar por telhado e como fazer o cliente voltar. Abre aqui mesmo, na SolarDoc.',
    botao: 'Liberar o LimpaPro por R$ 47',
    linhaPagamento: 'Um pagamento de R$ 47, sem mensalidade. Compra com garantia. Plano com o curso, sem bônus.',
    paraQuem: [
      { icone: Sparkles, titulo: 'Quem quer um serviço novo', texto: 'O curso começa do zero, sem exigir experiência com solar.' },
      { icone: Home, titulo: 'Integrador com base instalada', texto: 'Quer oferecer a limpeza para os clientes que já atende.' },
      { icone: Calculator, titulo: 'Quem não sabe quanto cobrar', texto: 'Precisa formar o preço pelo telhado, não no chute.' },
      { icone: Repeat, titulo: 'Quem quer cliente que volta', texto: 'Prefere contrato de manutenção a serviço de uma vez só.' },
    ],
    como: [
      { titulo: 'Compre sem sair do app', texto: 'Pague com Pix aqui mesmo, sem sair do app.' },
      { titulo: 'Abra o curso aqui no app', texto: 'Ele aparece no menu do app, sem outro login.' },
      { titulo: 'Siga os 5 módulos', texto: 'Da técnica de limpeza ao contrato de manutenção, na ordem que o curso propõe.' },
    ],
    resolve: [
      { icone: ShieldCheck, titulo: 'Medo de riscar o vidro', texto: 'Você aprende a limpeza segura, sem riscar o vidro nem quebrar a garantia do painel.' },
      { icone: ArrowUpFromLine, titulo: 'Trabalho em altura', texto: 'Um módulo inteiro de segurança antes de subir no telhado.' },
      { icone: Calculator, titulo: 'Preço no chute', texto: 'O valor sai do tamanho do telhado, da altura e do deslocamento.' },
      { icone: Repeat, titulo: 'Cliente de uma vez só', texto: 'O contrato de manutenção faz o mesmo cliente chamar você de novo.' },
    ],
    quadro: [
      'Módulo 1: técnica de limpeza segura.',
      'Módulo 2: segurança e trabalho em altura.',
      'Módulo 3: precificação, quanto cobrar e por quê.',
      'Módulo 4: captação e fechamento de clientes.',
      'Módulo 5: renda recorrente, com o contrato que faz o cliente voltar.',
      'Curso dentro da SolarDoc, sem outro login, com o seu progresso salvo.',
    ],
    rodapeQuadro: 'Este plano é o curso, sem bônus. Compra com garantia.',
    perguntas: [
      { p: 'Preciso ter experiência com solar?', r: 'Não. O curso começa do zero: técnica, segurança em altura, preço e conversa de venda.' },
      { p: 'Onde eu assisto?', r: 'Aqui mesmo, na SolarDoc. Depois do Pix, o curso aparece no menu do app, sem outro login.' },
      { p: 'Vem com bônus?', r: 'Este plano é o curso, sem bônus.' },
      { p: 'E se não for para mim?', r: 'A compra tem garantia. Se o curso não servir, você pede o reembolso.' },
    ],
    fechamento: 'Comece pelo primeiro módulo e saia do curso sabendo quanto cobrar.',
    hero: [
      { src: '/produtos/limpapro-curso.webp', alt: 'Curso LimpaPro: caixa, tela do curso no notebook e no celular e os 5 módulos', largura: 840, altura: 643 },
    ],
    comoImagem: { src: '/produtos/limpapro-curso.webp', alt: 'Os 5 módulos do curso LimpaPro, da técnica de limpeza à renda recorrente', largura: 840, altura: 643 },
  },
};
