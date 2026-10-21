// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DO NÚCLEO DAS AGENTES DA LINHA 5040 (Carla, Duda, Helena).
// Só tipos e o schema da saída: nenhum acesso a banco, rede ou IA.
// ─────────────────────────────────────────────────────────────────────────────

export type Produto = 'solardoc' | 'solar' | 'eletroposto';
export type Persona = 'carla' | 'duda' | 'helena';
/** Quem responde: uma das três, a Giovanna robô do suporte (cliente do SolarDoc) ou ninguém. */
export type Dona = Persona | 'giovanna_suporte';

export const PERSONA_DO_PRODUTO: Record<Produto, Persona> = {
  solardoc: 'carla',
  solar: 'duda',
  eletroposto: 'helena',
};

export type AutorMsg = 'lead' | 'robo' | 'equipe';

/** Uma linha de `wa_mensagens`, já com o autor resolvido (lead, robô ou gente da equipe no celular). */
export interface MsgConversa {
  id: number;
  from_me: boolean;
  from_api: boolean | null;
  autor: AutorMsg;
  texto: string | null;
  tipo: string;
  media_url: string | null;
  momment: string;
  /** Transcrição de áudio, quando houver. Campo à parte de `texto`. */
  transcricao?: string | null;
}

export type TipoPeca = 'link' | 'pix' | 'imagem';
export interface PecaSaida { tipo: TipoPeca; id: string }

/** O que a agente devolve. `dados` já vem como mapa (o modelo manda lista chave/valor, ver lerSaida). */
export interface SaidaAgente {
  bolhas: string[];
  acao: string;
  peca: PecaSaida | null;
  dados: Record<string, string>;
  resumo: string;
  sabe_contexto: boolean;
}

/** Ficha do card da agenda (banco do gerador), só o que as agentes leem. */
export interface CardResumo {
  id: number;
  status: string | null;
  quando: string | null;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cidade: string | null;
  observacao: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface LeadMetaResumo {
  lead_id: string | null;
  form_id: string | null;
  nome: string | null;
  cidade: string | null;
  created_time: string | null;
}

export interface CadastroEletroposto {
  origem: 'nota1' | 'parceria';
  id: number;
  nome: string | null;
  cidade: string | null;
  created_at: string | null;
  lado?: string | null;
  status?: string | null;
}

/** Anúncio de origem (A6), quando houver. Nunca guarda ctwaClid nem telefone. */
export interface AnuncioOrigem {
  adId: string | null;
  produto: Produto | null;
}

/** Tudo o que a persona vê do lead. Montado por contexto.ts (só leitura). */
export interface ContextoLead {
  chave: string;
  nome: string | null;
  msgs: MsgConversa[];
  /** false = a leitura foi cortada ou falhou: a agente não fala. */
  completa: boolean;
  card: CardResumo | null;
  /**
   * O card mais novo do SOLAR deste telefone (o `card` acima é o mais novo de qualquer produto e pode ser de eletroposto).
   * A agenda da Duda (marcar, remarcar, ligar agora) só olha este. Ausente = quem montou o contexto não o preencheu.
   */
  cardSolar?: CardResumo | null;
  leadsMeta: LeadMetaResumo | null;
  cadastros: CadastroEletroposto[];
  ehClienteSolarDoc: boolean;
  anuncio: AnuncioOrigem | null;
  /** Helena: a qualificação (imóvel, padrão, vagas) já foi respondida? Desconhecido = false. */
  qualificado: boolean;
  /** Instante de referência da conversa (ISO). No replay é o da época, não o de agora. */
  agora: string;
  /**
   * Horários livres do consultor dono do card, já por extenso ("amanhã, quarta, 21/10, às 9h30"), até 4.
   * Ausente ou vazio = o sistema não trouxe nenhum (a persona usa pedir_horarios). Nunca preenchido no replay.
   */
  horariosLivres?: string[];
  /**
   * Avisos do sistema para a Duda na 2ª chamada de um mesmo turno (B1d-2c): "o horário foi tomado", "ligar agora não
   * está disponível". Entram nos fatos como estão. Ausente ou vazio = nenhum aviso (o caso de todo turno comum).
   */
  avisosDoSistema?: string[];
}

/** O que o porteiro precisa saber. `leituraOk=false` = ninguém responde. */
export interface FatosPorteiro {
  leituraOk: boolean;
  humanoNaConversa: boolean;
  naoIncomodar: boolean;
  bloqueado: boolean;
  mudo: boolean;
  /** Dona já gravada para esta conversa (não há fonte persistida na Fase A: quem chama informa). */
  donaAtual: Persona | null;
  ehClienteSolarDoc: boolean;
  anuncio: AnuncioOrigem | null;
  /** Primeira mensagem escrita pelo lead (texto pronto de botão das nossas páginas). */
  primeiroTextoDoLead: string | null;
  /** created_by do card ou form_id do cadastro mais recente deste telefone. */
  origemCadastro: string | null;
  /**
   * Outro robô antigo já está na conversa (sessão sdr_b2b, solar_quiz, recepcao_io em triando,
   * recuperacao, ou inv_agente que segura os outros robôs): as agentes novas só assumem conversa
   * NOVA, então o porteiro devolve ninguém (passo 1).
   */
  outroRoboAtivo: boolean;
}

/** Retrato da conversa que a trava usa. */
export interface EstadoConversa {
  falasDoLead: number;
  falasNossas: number;
  /** A última mensagem da conversa foi do lead? */
  ultimaFoiDoLead: boolean;
  imagensNossas: number;
  /** O lead falou depois da última imagem nossa? (true se nunca mandamos imagem) */
  leadFalouDepoisDaImagem: boolean;
  /** Já saiu algum link nosso na conversa. */
  jaMandamosLink: boolean;
  /** Quantos cards de depoimento (imagens de /depoimentos/) já mandamos. */
  depoimentosNossos: number;
}

/** Contrato que cada arquivo de personas/ cumpre. ia.ts recebe isto por parâmetro. */
export interface PersonaDef {
  persona: Persona;
  /** Bloco em cache (1 h). NUNCA leva dado do lead. */
  sistemaFixo: string;
  /** Vai na mensagem do usuário, nunca no bloco em cache. */
  fatos(ctx: ContextoLead): string;
  /** Ações que a persona pode devolver (vira enum no schema). */
  acoes: readonly string[];
}

// ── schema da saída (json_schema estrito) ────────────────────────────────────

/**
 * Schema da saída para a chamada. Montado por persona: `acao` vira enum das ações dela.
 *
 * `dados` é uma LISTA de {chave, valor}: o json_schema estrito não aceita objeto aberto
 * (additionalProperties tem que ser false), e a lista é convertida em mapa por `lerSaida`.
 * `peca` é anyOf [objeto, null] (nulo de verdade, sem string vazia).
 */
export function schemaSaidaAgente(acoes: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      bolhas: { type: 'array', items: { type: 'string' } },
      acao: acoes.length ? { type: 'string', enum: [...acoes] } : { type: 'string' },
      peca: {
        anyOf: [
          {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['link', 'pix', 'imagem'] },
              id: { type: 'string' },
            },
            required: ['tipo', 'id'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
      dados: {
        type: 'array',
        items: {
          type: 'object',
          properties: { chave: { type: 'string' }, valor: { type: 'string' } },
          required: ['chave', 'valor'],
          additionalProperties: false,
        },
      },
      resumo: { type: 'string' },
      sabe_contexto: { type: 'boolean' },
    },
    required: ['bolhas', 'acao', 'peca', 'dados', 'resumo', 'sabe_contexto'],
    additionalProperties: false,
  };
}

/** Schema genérico (acao livre), para quem não tem a lista de ações à mão. */
export const SCHEMA_SAIDA_AGENTE = schemaSaidaAgente([]);

export type LeituraSaida = { ok: true; saida: SaidaAgente } | { ok: false; motivo: string };

/**
 * Lê o texto devolvido pelo modelo. Formato inválido = { ok:false }: nunca corrige.
 * `acoes` vazio = não confere a ação; preenchido = a ação tem que estar na lista.
 */
export function lerSaida(texto: string, acoes: readonly string[] = []): LeituraSaida {
  let j: unknown;
  try { j = JSON.parse(String(texto ?? '').trim()); } catch { return { ok: false, motivo: 'json inválido' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, motivo: 'saída não é objeto' };
  const o = j as Record<string, unknown>;
  if (!Array.isArray(o.bolhas) || !o.bolhas.every(b => typeof b === 'string')) return { ok: false, motivo: 'bolhas inválidas' };
  if (typeof o.acao !== 'string' || !o.acao) return { ok: false, motivo: 'acao ausente' };
  if (acoes.length && !acoes.includes(o.acao)) return { ok: false, motivo: `acao fora da lista (${o.acao.slice(0, 40)})` };
  if (typeof o.sabe_contexto !== 'boolean') return { ok: false, motivo: 'sabe_contexto ausente' };
  if (typeof o.resumo !== 'string') return { ok: false, motivo: 'resumo ausente' };

  let peca: PecaSaida | null = null;
  if (o.peca !== null && o.peca !== undefined) {
    const p = o.peca as Record<string, unknown>;
    if (typeof p !== 'object' || !['link', 'pix', 'imagem'].includes(String(p.tipo)) || typeof p.id !== 'string') {
      return { ok: false, motivo: 'peca inválida' };
    }
    peca = { tipo: p.tipo as TipoPeca, id: p.id };
  }

  const dados: Record<string, string> = {};
  if (Array.isArray(o.dados)) {
    for (const d of o.dados as Array<Record<string, unknown>>) {
      if (d && typeof d.chave === 'string' && typeof d.valor === 'string' && d.chave) dados[d.chave] = d.valor;
    }
  } else if (o.dados && typeof o.dados === 'object') {
    for (const [k, v] of Object.entries(o.dados as Record<string, unknown>)) if (typeof v === 'string') dados[k] = v;
  }

  return {
    ok: true,
    saida: { bolhas: o.bolhas as string[], acao: o.acao, peca, dados, resumo: o.resumo, sabe_contexto: o.sabe_contexto },
  };
}
