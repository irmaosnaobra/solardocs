// Curso 1 — Kit de Fechamento do Integrador.
// Declara só MÓDULOS e LIÇÕES: trilha, XP, níveis, conquistas e telas vêm da
// casca (cursos.config.ts). Ver COMO-ADICIONAR-CURSO.md para criar o próximo.

// Importa da CASCA (curso-tipos), nunca do registro — senão vira ciclo.
import { XP_POR_TIPO as XP, type Curso, type TipoLicao } from './curso-tipos';
import { OBJECOES } from './objecoes';
import { PROSPECCAO } from './prospeccao';
import { POS_VENDA } from './posvenda';

export const KIT_FECHAMENTO: Curso = {
  slug: 'kit-fechamento',
  nome: 'Kit de Fechamento do Integrador',
  descricao:
    'Da primeira mensagem para um lead frio até a indicação depois da obra pronta. Cada lição termina com uma fala pronta que você usa na próxima visita.',
  niveis: ['Aprendiz', 'Vendedor', 'Fechador', 'Mestre do Fechamento'],
  modulos: [
    {
      slug: 'objecoes',
      numero: 1,
      titulo: 'As objeções que travam a venda',
      subtitulo: 'A resposta pronta para as 26 frases que aparecem depois da proposta',
      icone: 'MessageSquareQuote',
      cor: '#f7a41c',
      bonusXp: 200,
      conquista: { nome: 'Escudo anti-objeção', icone: 'ShieldCheck' },
      licoes: OBJECOES.map((g) => ({
        id: `objecoes:${g.slug}`,
        titulo: g.titulo,
        resumo: `${g.itens.length} ${g.itens.length === 1 ? 'objeção' : 'objeções'} com fala pronta e versão de WhatsApp`,
        minutos: Math.max(4, Math.round(g.itens.length * 1.6)),
        xp: XP.leitura,
        tipo: 'leitura' as TipoLicao,
      })),
    },
    {
      slug: 'roteiro',
      numero: 2,
      titulo: 'Da primeira ligação à assinatura',
      subtitulo: 'O caminho inteiro da visita, etapa por etapa',
      icone: 'Map',
      cor: '#5cb8f7',
      bonusXp: 200,
      conquista: { nome: 'Visita sem improviso', icone: 'Map' },
      licoes: [
        {
          id: 'roteiro:etapas',
          titulo: 'As 6 etapas da visita',
          resumo: 'De qualificar por telefone ao pós-assinatura, com a armadilha de cada etapa',
          minutos: 9,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'roteiro:perguntas',
          titulo: 'As 5 perguntas para o cliente fazer',
          resumo: 'A lista que você entrega para ele comparar orçamentos — inclusive o seu',
          minutos: 4,
          xp: XP.ferramenta,
          tipo: 'ferramenta',
        },
      ],
    },
    {
      slug: 'preco',
      numero: 3,
      titulo: 'Preço e margem sem chute',
      subtitulo: 'Saber quanto sobra antes de dar desconto',
      icone: 'Calculator',
      cor: '#4ade80',
      bonusXp: 200,
      conquista: { nome: 'Margem protegida', icone: 'Coins' },
      licoes: [
        {
          id: 'preco:custo',
          titulo: 'Para onde vai cada real',
          resumo: 'As 8 linhas de custo do projeto e a faixa de referência de cada uma',
          minutos: 6,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'preco:regras',
          titulo: 'Quatro regras que protegem a margem',
          resumo: 'O que fazer quando o cliente pede desconto — sem sair do seu bolso',
          minutos: 5,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'preco:calculadora',
          titulo: 'Calcule o seu preço agora',
          resumo: 'Missão prática na calculadora da plataforma, com os números do seu último orçamento',
          minutos: 8,
          xp: XP.pratica,
          tipo: 'pratica',
        },
      ],
    },
    {
      slug: 'documentos',
      numero: 4,
      titulo: 'Contrato, procuração e vistoria',
      subtitulo: 'Os documentos que fecham o negócio, com a sua marca',
      icone: 'FileSignature',
      cor: '#c084fc',
      bonusXp: 250,
      conquista: { nome: 'Documento com a sua marca', icone: 'FileCheck2' },
      licoes: [
        {
          id: 'documentos:gerar',
          titulo: 'Gere seu primeiro contrato',
          resumo: 'Missão prática: cadastre a empresa e emita um documento com o seu CNPJ e a sua logo',
          minutos: 10,
          xp: XP.pratica,
          tipo: 'pratica',
        },
      ],
    },
    {
      slug: 'prospeccao',
      numero: 5,
      titulo: 'Prospecção e follow-up',
      subtitulo: 'Mensagem pronta para copiar, colar e mandar',
      icone: 'Send',
      cor: '#38bdf8',
      bonusXp: 200,
      conquista: { nome: 'Agenda cheia', icone: 'Send' },
      licoes: PROSPECCAO.map((b) => ({
        id: `prospeccao:${b.slug}`,
        titulo: b.titulo,
        resumo: `${b.mensagens.length} mensagens com o momento certo de usar`,
        minutos: Math.max(4, b.mensagens.length * 2),
        xp: XP.leitura,
        tipo: 'leitura' as TipoLicao,
      })),
    },
    {
      slug: 'posvenda',
      numero: 6,
      titulo: 'Pós-venda, garantia e recorrência',
      subtitulo: 'Transformar uma venda em três',
      icone: 'Repeat',
      cor: '#fb7185',
      bonusXp: 250,
      conquista: { nome: 'Cliente que volta', icone: 'Repeat' },
      licoes: [
        {
          id: 'posvenda:janelas',
          titulo: `As ${POS_VENDA.length} janelas depois do sim`,
          resumo: 'O que fazer nas 48h, na obra, na primeira conta, na manutenção e na ampliação',
          minutos: 8,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'posvenda:garantias',
          titulo: 'As três garantias, separadas',
          resumo: 'O que é do fabricante, o que é da assistência e o que é seu — no papel',
          minutos: 5,
          xp: XP.leitura,
          tipo: 'leitura',
        },
      ],
    },

    // ── BÔNUS ──────────────────────────────────────────────────────────────
    // Travado até o aluno terminar o curso E estar usando a plataforma de
    // verdade. É a recompensa que puxa para dentro do produto: o cara só
    // destrava depois de cadastrar empresa, cliente e gerar um documento.
    {
      slug: 'bonus-pj',
      numero: 7,
      titulo: 'Bônus: o projeto que vale por três',
      subtitulo: 'Vender para empresa — ticket maior, mesmo esforço de visita',
      icone: 'TrendingUp',
      cor: '#ffd166',
      bonusXp: 300,
      conquista: { nome: 'Caçador de PJ', icone: 'Crown' },
      bonus: true,
      requisitos: [
        {
          id: 'licoes',
          label: 'Concluir as 17 lições do curso',
          dica: 'Os 6 módulos, do primeiro ao último',
        },
        {
          id: 'empresa',
          label: 'Cadastrar sua empresa',
          dica: 'CNPJ e logo — é o que assina seus documentos',
          href: '/empresa',
        },
        {
          id: 'cliente',
          label: 'Cadastrar um cliente',
          dica: 'Pode ser o próximo orçamento que você for fazer',
          href: '/clientes',
        },
        {
          id: 'documento',
          label: 'Gerar um documento',
          dica: 'Uma proposta ou um contrato, com a sua marca',
          href: '/documentos?tipo=proposta',
        },
      ],
      licoes: [
        {
          id: 'bonus:prospeccao-pj',
          titulo: 'Quem decide e como chegar nele',
          resumo: 'Achar quem assina antes de gastar a visita — e ler a conta de empresa direito',
          minutos: 9,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'bonus:proposta-pj',
          titulo: 'A proposta para empresário',
          resumo: 'Retorno em vez de economia, e o fechamento com contrato PJ na hora',
          minutos: 8,
          xp: XP.leitura,
          tipo: 'leitura',
        },
        {
          id: 'bonus:checklist-pj',
          titulo: 'Checklist da visita PJ',
          resumo: 'Os 10 itens que separam a proposta que fecha da que fica "em análise"',
          minutos: 5,
          xp: XP.ferramenta,
          tipo: 'ferramenta',
        },
      ],
    },
  ],
};
