// Textos, chaves e regras puras da RECEPÇÃO DE USUÁRIOS NOVOS da SolarDoc (ver recepcaoNovoUsuario.ts). Só um import de valor
// (a abertura da Giovanna, que também não importa nada): o pós-venda usa as chaves daqui sem carregar a linha do WhatsApp.
// Os textos são os aprovados (textos.md, seções A e B). Não mude as palavras sem passar de novo pelo dono.

import { abertura, nomeParaSaudar } from './ativacaoPosVendaTextos';
import type { PassoPrincipal, ResultadoPassos } from './primeirosPassos';

// ── chaves (system_state) ────────────────────────────────────────────────────
// Sempre EXATAS (`.in('key', lista)`), nunca com like: o `_` do like é curinga e `recep_sent:` casaria com `recepcao_io:...`.

export const PREFIXO_RECEP_SENT = 'recep_sent:';
export const PREFIXO_RECEP_PULO = 'recep_pulo:';
export const PREFIXO_RECEP_EMAIL = 'recep_email:';
export const PREFIXO_RECEP_EMAIL_PULO = 'recep_email_pulo:';
/** Marca da sonda automática: o WhatsApp da recepção só envia depois dela. */
export const CHAVE_RECEP_SONDA_OK = 'recep_sonda_ok';
export const CHAVE_RECEP_SONDA_FALHOU = 'recep_sonda_falhou';

export type ToqueRecep = 1 | 2 | 3;
export const TOQUES: readonly ToqueRecep[] = [1, 2, 3];

/** Enviado: `recep_sent:<userId>:r1|r2|r3` (claim por insert, também é o carimbo do frio da linha). */
export const chaveRecepSent = (userId: string, toque: ToqueRecep): string => `${PREFIXO_RECEP_SENT}${userId}:r${toque}`;
/** Pulado: `recep_pulo:<userId>:r1|r2|r3` (não é envio: fora do teto e do espaçamento da linha). */
export const chaveRecepPulo = (userId: string, toque: ToqueRecep): string => `${PREFIXO_RECEP_PULO}${userId}:r${toque}`;
export const chaveRecepEmail = (userId: string, toque: ToqueRecep): string => `${PREFIXO_RECEP_EMAIL}${userId}:e${toque}`;
export const chaveRecepEmailPulo = (userId: string, toque: ToqueRecep): string => `${PREFIXO_RECEP_EMAIL_PULO}${userId}:e${toque}`;
/** As três chaves de enviado de uma conta (a 2b da pós-venda e a Carla da retomada conferem estas). */
export const chavesRecepSentDe = (userId: string): string[] => TOQUES.map(t => chaveRecepSent(userId, t));

// ── tempo ────────────────────────────────────────────────────────────────────

const HORA_MS = 3_600_000;
/** Quem tem conta de até 15 dias entra na recepção. */
export const JANELA_RECEPCAO_MS = 15 * 24 * HORA_MS;
/** Idade mínima da conta para cada toque (WhatsApp e e-mail usam as mesmas): 20 h, 68 h e 164 h. */
export const ESPERA_TOQUE_MS: Readonly<Record<ToqueRecep, number>> = { 1: 20 * HORA_MS, 2: 68 * HORA_MS, 3: 164 * HORA_MS };

// ── a escolha do toque (pura) ────────────────────────────────────────────────

export interface EscolhaDoToque {
  /** O toque que sai agora, ou null. */
  enviar: ToqueRecep | null;
  /** Toques que viram "pulado" (os menores ainda abertos e, com tudo pronto, o próprio toque). */
  pular: ToqueRecep[];
}

/**
 * Vale só o toque MAIS ALTO que já venceu (idade) e que não está fechado (enviado ou pulado). Os menores abertos viram pulados.
 * R1 e R2 só saem se `proximo` não for nulo: com tudo pronto o toque vira pulado. O R3 sai para todos.
 * `fechados` = toques com chave de enviado ou de pulado. Toque aberto ABAIXO de um toque já fechado nunca mais sai (o R1 não volta depois do R2,
 * por exemplo, se a gravação do pulado falhou): entra em `pular` para ser fechado.
 */
export function escolherToque(idadeMs: number, proximo: PassoPrincipal | null, fechados: ReadonlySet<ToqueRecep>): EscolhaDoToque {
  const piso = Math.max(0, ...fechados);
  const orfaos = TOQUES.filter(t => t < piso && !fechados.has(t));
  const abertos = TOQUES.filter(t => t > piso && idadeMs >= ESPERA_TOQUE_MS[t]);
  if (!abertos.length) return { enviar: null, pular: orfaos };
  const alto = abertos[abertos.length - 1]!;
  if (alto !== 3 && proximo === null) return { enviar: null, pular: [...orfaos, ...abertos] };
  return { enviar: alto, pular: [...orfaos, ...abertos.filter(t => t !== alto)] };
}

// ── textos do WhatsApp (corpo; a abertura da Giovanna vai antes) ─────────────

const R1: Readonly<Record<PassoPrincipal, string>> = {
  empresa: 'Vi que você criou sua conta na SolarDoc. O próximo passo é cadastrar os dados da empresa. Só razão social e CNPJ são obrigatórios. Você faz isso uma vez e depois eles entram sozinhos em toda proposta. Fica no menu Empresa. Se travar em algum campo, me responde aqui.',
  logo: 'Seus dados da empresa já estão salvos. O próximo passo é a logo. Fica no menu Empresa, e escolher a cor é opcional. Você sobe uma vez e ela entra sozinha em toda proposta. Se travar, me responde aqui que eu te explico o passo a passo.',
  fotos: 'Sua empresa e sua logo já estão salvas. O próximo passo são as fotos dos seus trabalhos. Escolha 6, 9 ou 12 fotos de obras no menu Empresa. Elas ficam salvas e entram sozinhas nas suas propostas. Se travar, me responde aqui.',
  proposta: 'Seu cadastro está pronto. O próximo passo é a primeira proposta. Clique em Nova proposta, no topo do menu, escolha o modelo e preencha o cliente e a conta de luz. A logo, a cor e os dados da empresa entram sozinhos. Se travar, me responde aqui.',
};

const R2: Readonly<Record<PassoPrincipal, string>> = {
  empresa: 'Passando para saber se posso te ajudar. Ainda faltam os dados da empresa, e só razão social e CNPJ são obrigatórios. Se tiver dúvida sobre algum campo, me responde aqui que eu te explico. Depois disso, todo documento já sai com esses dados.',
  logo: 'Posso te ajudar com a logo? É o passo que falta. No menu Empresa, clique na área da logo e escolha o arquivo. Se não tiver o arquivo à mão agora, sem problema, volte quando tiver. Se algo travar, me responde aqui.',
  fotos: 'Posso te ajudar com as fotos? São 6, 9 ou 12 fotos de obras suas. Dica: escolha as mais bonitas, de obras concluídas. Depois é só clicar em Salvar alterações. Elas ficam guardadas no menu Empresa e entram sozinhas nas propostas. Se algo travar, me responde aqui.',
  proposta: 'Posso te ajudar com a primeira proposta? Sua empresa já está pronta. Clique em Nova proposta, no topo do menu, escolha o modelo e preencha o cliente e a conta de luz. Se quiser, me conta onde ficou a dúvida e eu te guio por aqui.',
};

const R3_SEM_PROPOSTA = 'Faz uma semana que você entrou e a primeira proposta ainda não saiu. Posso te ajudar? Clique em Nova proposta, no topo do menu, e escolha o modelo. O Completa + Banco já sai com fotos das obras, logos dos bancos e folha de assinatura.';
const R3_COM_PROPOSTA = 'Como está sendo usar a SolarDoc? Tem alguma dúvida? Uma dica: o link da proposta avisa quando o cliente abre e quando baixa o PDF. Assim você sabe o melhor momento de chamar o cliente.';
const R3_LINHA_FOTOS = 'Ah, e faltam as fotos das obras: com 6, 9 ou 12 salvas no menu Empresa, elas entram sozinhas nas propostas.';
const R3_FECHO = 'Se precisar de algo, me responde aqui.';

export interface ContextoTextoRecep {
  proximo: PassoPrincipal | null;
  temProposta: boolean;
  fotosFeito: boolean;
}

/** A mensagem inteira (1 bolha). null = R1 ou R2 sem próximo passo (não há o que dizer). */
export function textoRecepcao(toque: ToqueRecep, nome: string | null | undefined, ctx: ContextoTextoRecep): string | null {
  let corpo: string;
  if (toque === 3) {
    corpo = ctx.temProposta
      ? `${R3_COM_PROPOSTA}${ctx.fotosFeito ? '' : ` ${R3_LINHA_FOTOS}`} ${R3_FECHO}`
      : `${R3_SEM_PROPOSTA} ${R3_FECHO}`;
  } else {
    if (ctx.proximo === null) return null;
    corpo = (toque === 1 ? R1 : R2)[ctx.proximo];
  }
  return `${abertura(nome, 'do suporte da SolarDoc')} ${corpo}`;
}

// ── e-mail (conteúdo; o desenho em HTML mora no mailer) ──────────────────────

export const URL_SOLARDOC = 'https://solardoc.app';
/** O mesmo link do botão de suporte do dashboard (dashboard/src/utils/suporte.ts). O número já é público no repositório. */
export const WA_SUPORTE = 'https://wa.me/5534998165040?text=' + encodeURIComponent('Olá! Preciso de ajuda com o SolarDoc.');

const DESTINO_PASSO: Readonly<Record<PassoPrincipal, string>> = {
  empresa: `${URL_SOLARDOC}/empresa`,
  logo: `${URL_SOLARDOC}/empresa#empresa-logo`,
  fotos: `${URL_SOLARDOC}/empresa#empresa-fotos`,
  // A rota do botão "Nova proposta" do menu (dashboard/src/components/Sidebar/itensMenu.ts).
  proposta: `${URL_SOLARDOC}/documentos?tipo=proposta`,
};

export interface ItemDaLista { rotulo: 'Feito' | 'Pendente'; titulo: string; descricao: string }

export type BlocoEmail =
  | { tipo: 'p'; texto: string }
  | { tipo: 'lista'; itens: ItemDaLista[] }
  | { tipo: 'passos'; titulo: string; itens: string[] };

export interface ConteudoEmail {
  assunto: string;
  preheader: string;
  saudacao: string;
  blocos: BlocoEmail[];
  botao: { texto: string; url: string };
}

const BOTAO_E1: Readonly<Record<PassoPrincipal, string>> = {
  empresa: 'Cadastrar minha empresa', logo: 'Subir minha logo', fotos: 'Escolher minhas fotos', proposta: 'Criar minha primeira proposta',
};

const LISTA_E1: ReadonlyArray<{ id: PassoPrincipal; titulo: string; descricao: string }> = [
  { id: 'empresa', titulo: 'Dados da empresa', descricao: 'Razão social e CNPJ, só esses dois são obrigatórios.' },
  { id: 'logo', titulo: 'Logo da empresa', descricao: 'Sua marca em toda proposta. A cor é opcional.' },
  { id: 'fotos', titulo: 'Fotos dos seus trabalhos', descricao: '6, 9 ou 12 fotos de obras, salvas no menu Empresa.' },
  { id: 'proposta', titulo: 'Primeira proposta', descricao: 'Escolha o modelo, preencha o cliente e a conta de luz.' },
];

const AJUDA_EMAIL = 'Se travar, a Giovanna, do suporte, te ajuda pelo WhatsApp.';

const E2: Readonly<Record<PassoPrincipal, {
  assunto: string; preheader: string; foco: string; como: string[]; depois: string[];
}>> = {
  empresa: {
    assunto: 'Cadastre sua empresa em 3 passos',
    preheader: 'Só razão social e CNPJ são obrigatórios. O resto da proposta entra sozinho.',
    foco: 'Hoje o foco é um passo só: os dados da empresa.',
    como: ['Abra o menu Empresa.', 'Preencha razão social e CNPJ. Só esses dois são obrigatórios.', 'Clique em Cadastrar empresa.'],
    depois: ['Depois disso, todo documento já sai com os dados da sua empresa.'],
  },
  logo: {
    assunto: 'Coloque sua logo em 3 passos',
    preheader: 'Você sobe uma vez e ela aparece em todas as suas propostas.',
    foco: 'Hoje o foco é um passo só: a logo da sua empresa.',
    como: ['Abra o menu Empresa.', 'Clique na área da logo e escolha o arquivo. A cor é opcional.', 'Clique em Salvar alterações.'],
    depois: ['Se não tiver o arquivo à mão agora, sem problema, volte quando tiver.'],
  },
  fotos: {
    assunto: 'Escolha as fotos dos seus trabalhos em 3 passos',
    preheader: 'Elas ficam salvas e entram sozinhas nas suas propostas.',
    foco: 'Hoje o foco é um passo só: as fotos dos seus trabalhos.',
    como: [
      'Abra o menu Empresa e vá até Fotos dos seus trabalhos.',
      'Escolha 6, 9 ou 12 fotos de obras suas. Dica: as mais bonitas, de obras concluídas.',
      'Clique em Salvar alterações.',
    ],
    depois: ['O modelo Completa + Banco já sai com essas fotos.'],
  },
  proposta: {
    assunto: 'Faça sua primeira proposta em 3 passos',
    preheader: 'A logo, a cor e os dados da empresa entram sozinhos.',
    foco: 'Hoje o foco é um passo só: a sua primeira proposta.',
    como: ['Clique em Nova proposta, no topo do menu.', 'Escolha o modelo. O Completa + Banco é o padrão.', 'Preencha o cliente e a conta de luz.'],
    depois: ['A logo, a cor, o contato e os dados da empresa entram sozinhos.'],
  },
};

/**
 * O e-mail de cada toque. null = E1 ou E2 sem próximo passo.
 * E1 lista os 4 passos com Feito/Pendente; E2 escolhe o texto pelo próximo passo; E3 leva o parágrafo extra só sem proposta.
 */
export function conteudoEmailRecepcao(toque: ToqueRecep, nome: string | null | undefined, passos: ResultadoPassos): ConteudoEmail | null {
  const primeiro = nomeParaSaudar(nome);
  const saudacao = primeiro ? `Oi, ${primeiro}.` : 'Oi,';
  const proximo = passos.proximo;

  if (toque === 1) {
    if (proximo === null) return null;
    const faltam = passos.total - passos.feitos;
    const feitoDe = (id: PassoPrincipal): boolean => passos.passos.some(p => p.id === id && p.feito);
    return {
      assunto: faltam === 1 ? 'Falta 1 passo para sua primeira proposta' : `Faltam ${faltam} passos para sua primeira proposta`,
      preheader: 'É simples: você cadastra uma vez e o resto entra sozinho.',
      saudacao,
      blocos: [
        { tipo: 'p', texto: faltam === 1 ? 'Sua conta na SolarDoc está criada. Falta 1 passo para começar.' : `Sua conta na SolarDoc está criada. Faltam ${faltam} passos para começar.` },
        { tipo: 'lista', itens: LISTA_E1.map(i => ({ rotulo: feitoDe(i.id) ? 'Feito' as const : 'Pendente' as const, titulo: i.titulo, descricao: i.descricao })) },
        { tipo: 'p', texto: 'Você faz uma vez. Depois disso, logo, cor, contato, fotos e dados da empresa entram sozinhos em toda proposta.' },
        { tipo: 'p', texto: 'Travou em algum passo? A Giovanna, do suporte, te ajuda pelo WhatsApp.' },
      ],
      botao: { texto: BOTAO_E1[proximo], url: DESTINO_PASSO[proximo] },
    };
  }

  if (toque === 2) {
    if (proximo === null) return null;
    const e = E2[proximo];
    return {
      assunto: e.assunto,
      preheader: e.preheader,
      saudacao,
      blocos: [
        { tipo: 'p', texto: e.foco },
        { tipo: 'passos', titulo: 'Como faço:', itens: e.como },
        ...e.depois.map((texto): BlocoEmail => ({ tipo: 'p', texto })),
        { tipo: 'p', texto: AJUDA_EMAIL },
      ],
      botao: { texto: BOTAO_E1[proximo], url: DESTINO_PASSO[proximo] },
    };
  }

  const semProposta = !passos.passos.some(p => p.id === 'proposta' && p.feito);
  return {
    assunto: 'Como está sendo usar a SolarDoc?',
    preheader: 'Uma semana de SolarDoc. Posso te ajudar com alguma coisa?',
    saudacao,
    blocos: [
      { tipo: 'p', texto: 'Faz uma semana que você entrou na SolarDoc. Como está sendo?' },
      { tipo: 'p', texto: 'Se tiver qualquer dúvida, a Giovanna, do suporte, responde pelo WhatsApp.' },
      { tipo: 'p', texto: 'Uma dica: o link da proposta avisa quando o cliente abre e quando baixa o PDF. Assim você sabe o melhor momento de chamar o cliente.' },
      { tipo: 'p', texto: 'Todo documento que você faz fica salvo na nuvem, por cliente.' },
      ...(semProposta ? [{ tipo: 'p', texto: 'Se ainda não fez a primeira, ela está a um clique: Nova proposta, no topo do menu.' } as BlocoEmail] : []),
    ],
    botao: { texto: 'Falar com o suporte no WhatsApp', url: WA_SUPORTE },
  };
}
