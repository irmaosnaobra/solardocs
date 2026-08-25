// ─────────────────────────────────────────────────────────────────────────────
// DEPOIMENTOS DE CLIENTE — cópia server-side, só texto.
//
// FONTE DA VERDADE é `dashboard/src/components/Landing/Landing.tsx` (array
// DEPOIMENTOS). Este arquivo é um ESPELHO das falas que já estão `liberado: true`
// lá — ou seja, que já estão PUBLICADAS na página de vendas.
//
// A regra que faz isso ser seguro: nada entra aqui que não esteja no ar na LP.
// A autorização de cada uma dessas frases está documentada no cabeçalho do
// Landing.tsx (quem disse sim por escrito, quem o Thiago confirmou fora da
// linha). Reaproveitar a MESMA lista significa que a base de autorização é uma
// só e que revogar na LP revoga aqui — não existe um segundo lugar pra alguém
// esquecer de apagar.
//
// SÓ TEXTO, de propósito. Print de conversa e logo são licenças diferentes da
// frase (o cabeçalho da LP diz isso sobre a logo), e imagem em toque proativo é
// o que queima instância na Z-API. E-mail com a fala em texto faz o mesmo
// trabalho sem nenhum dos dois problemas.
//
// `trecho` existe porque a fala do Juliano na LP junta preço e argumento
// técnico. Numa cadência que fala com quem JÁ paga, citar a parte do preço seria
// devolver ao cliente uma objeção de preço que ele não fez. O recorte é literal,
// sem nada acrescentado — mesma regra da LP.
// ─────────────────────────────────────────────────────────────────────────────

export interface Depoimento {
  /** Nome como aparece na LP. Empresa vazia quando a pessoa não se apresentou. */
  nome: string;
  empresa: string;
  cidade: string;
  /** Fala publicada. Literal. */
  texto: string;
  /** Perfil de lead pra quem esta fala funciona. Usado pra ESCOLHER a citacao
      no follow-up — uma por mensagem, nunca uma lista. Opcional: o mailer nao
      usa, e as cinco falas originais seguem intactas pra nao mexer nos e-mails
      da confianca, que citam por chave. */
  perfil?: 'planilha' | 'papel' | 'plataforma-paga' | 'celular' | 'detalhe';
}

export const DEPOIMENTOS: Record<string, Depoimento> = {
  // "com quatro, cinco cliques eu consigo montar uma proposta" — o ganho do dia 1.
  alessandro: {
    perfil: 'planilha',
    nome: 'Alessandro Goulart', empresa: 'Força Solar', cidade: 'Feliz/RS',
    texto: 'Criava os meus orçamentos tudo através de planilha. Aqui, com quatro, cinco cliques eu consigo montar uma proposta. Recomendo.',
  },
  // O único que veio do piso do mercado: nem planilha, nem concorrente.
  ronailson: {
    perfil: 'papel',
    nome: 'Ronailson Klesley', empresa: 'Alves Cardoso Solar', cidade: 'Abreulândia/TO',
    texto: 'Praticidade e agilidade. Antes eu não fazia — era só venda formal, sem nenhum documento apresentando dados reais.',
  },
  // RECORTE da fala publicada: só a metade técnica (número em cima vs gráfico).
  // A metade do preço fica fora — ver cabeçalho.
  juliano: {
    perfil: 'plataforma-paga',
    nome: 'Juliano Grilo', empresa: 'Grilo Energia Solar', cidade: 'Artur Nogueira/SP',
    texto: 'A média do ano vem com o número escrito em cima. Na outra plataforma é gráfico — e gráfico dificulta a mente do cliente, você tem que bater uma régua pra enxergar.',
  },
  lucas: {
    perfil: 'celular',
    nome: 'Lucas Paulino', empresa: 'RSC Solar', cidade: 'Londrina/PR',
    texto: 'Rapidez. Eu coloquei ele no meu celular, então eu consigo responder de qualquer lugar que eu estiver. Rápido demais.',
  },
  // NOVAS (24-25/08/2026) — todas ja' publicadas na LP, mesma autorizacao.
  // A do Antonio Henrique e' a mais vendedora que a base produziu: e' um cliente
  // dizendo, sem ser perguntado, que trocou um CRM pago por causa de custo.
  antonio: {
    perfil: 'plataforma-paga',
    nome: 'Antônio Henrique', empresa: 'Exxel Solar', cidade: 'Xique-Xique/BA',
    texto: 'Praticidade na confecção das propostas. Eu tinha outro CRM — o custo benefício dessa proposta me fez optar.',
  },
  vanderlei: {
    perfil: 'plataforma-paga',
    nome: 'Vanderlei', empresa: 'American Energy Solar', cidade: 'Rondonópolis/MT',
    texto: 'Usei três anos outra plataforma, passei um ano no e-mail. Entre todas que já usei e outras que apenas testei, essa é a que conseguimos gerar propostas mais rapidamente.',
  },
  carlosVinicius: {
    perfil: 'papel',
    nome: 'Carlos Vinícius', empresa: 'VS Solar Energia Solar', cidade: 'Piripiri/PI',
    texto: 'A SolarDoc me ajuda a ser ágil e preciso no orçamento que passo pro meu cliente. Antes eu fazia por escrito, nada profissional.',
  },
  gedalih: {
    perfil: 'planilha',
    nome: 'Gedalih Energia Solar', empresa: '', cidade: 'Varginha/MG',
    texto: 'Eu usava planilha, tinha que ficar salvando no computador. Facilitou muito: salvar a foto, deixar tudo bonitinho, tudo certinho, conseguir ter acesso.',
  },
  gsi: {
    perfil: 'detalhe',
    nome: 'GSI Energia Solar', empresa: '', cidade: 'Unaí/MG',
    texto: 'Tenho me surpreendido positivamente com o nível de detalhes das propostas.',
  },
  vicente: {
    perfil: 'detalhe',
    nome: 'Vicente', empresa: 'VFF Energia Solar', cidade: 'Campinas/SP',
    texto: 'A praticidade do sistema: fazendo o download da fatura, ele calcula o consumo médio. E a agilidade de editar contrato, recibo, procuração.',
  },
};

/** Bloco HTML da fala, no tom escuro dos outros e-mails. Sem logo, sem foto. */
export function blocoDepoimentoHtml(d: Depoimento): string {
  const quem = d.empresa ? `${d.nome} · ${d.empresa}` : d.nome;
  return `
    <div style="margin:26px 0 6px;background:#111f38;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:18px 22px;">
      <p style="margin:0 0 10px;color:#e2e8f0;font-size:15px;line-height:1.75;font-style:italic;">“${d.texto}”</p>
      <p style="margin:0;color:#94a3b8;font-size:13px;">${quem} — ${d.cidade}</p>
    </div>`;
}
