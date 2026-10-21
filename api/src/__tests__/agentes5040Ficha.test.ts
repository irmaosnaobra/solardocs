import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A4, a ficha ao consultor. Banco, WhatsApp e IA simulados na memória. Prova: o bloco da ficha não casa nenhum
// padrão do gatilho do banco, a primeira linha do card fica, a troca é idempotente, a escrita é otimista, a
// reserva por insert segura o segundo chamador, o card é gravado ANTES do envio, nada sai em paralelo, a
// chave desligada não envia, e a IA fora deixa a ficha só com os campos.

type Linha = Record<string, any>;

const h = vi.hoisted(() => ({
  estado: new Map<string, { value: any; updated_at: string }>(),
  agend: [] as Array<Record<string, any>>,
  consultores: [] as Array<{ nome: string | null; whatsapp: string | null }>,
  eventos: [] as string[],
  enviados: [] as Array<{ tel: string; texto: string; inst: string }>,
  emVoo: 0,
  maxEmVoo: 0,
  falhaEnvio: false,
  erroEnvio: 'z-api fora',
  leituras: 0,
  aoLer: null as null | ((n: number) => void),
  cooldown: false,
  eqObs: [] as string[],
  escondeReservas: false,
  antesDoUpdate: null as null | (() => void),
  ia: { modo: 'fora' as 'fora' | 'ok' | 'torto', texto: '', chamadas: 0, ultimoPedido: '' },
  conversa: { msgs: [] as any[], completa: true },
  gatilho: 'nenhum' as 'nenhum' | 'real' | 'malvado',
}));

function builderEstado() {
  let op = 'select'; let payload: any = null; let retorna = false; let unico = false;
  const filtros: Array<(k: string, r: { value: any; updated_at: string }) => boolean> = [];
  const q: any = {
    select: () => { retorna = true; return q; },
    insert: (row: any) => { op = 'insert'; payload = row; return q; },
    update: (patch: any) => { op = 'update'; payload = patch; return q; },
    upsert: (row: any) => { op = 'upsert'; payload = row; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (c: string, v: any) => { filtros.push((k, r) => (c === 'key' ? k === v : (r as any)[c] === v)); return q; },
    in: (_c: string, lista: string[]) => { filtros.push((k) => !h.escondeReservas && lista.includes(k)); return q; },
    lt: (c: string, v: any) => { filtros.push((_k, r) => String((r as any)[c]) < String(v)); return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (ok: (v: any) => any, ko?: (e: any) => any) => {
      const casa = [...h.estado.entries()].filter(([k, r]) => filtros.every(f => f(k, r)));
      let res: any;
      if (op === 'insert') {
        if (h.estado.has(payload.key)) res = { data: null, error: { code: '23505' } };
        else {
          h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at });
          h.eventos.push(`insert:${String(payload.key).split(':')[0]}`);
          res = { data: null, error: null };
        }
      } else if (op === 'upsert') {
        h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at });
        res = { data: null, error: null };
      } else if (op === 'update') {
        for (const [k] of casa) {
          const cur = h.estado.get(k)!;
          h.estado.set(k, { value: payload.value ?? cur.value, updated_at: payload.updated_at ?? cur.updated_at });
        }
        res = { data: retorna ? casa.map(([k]) => ({ key: k })) : null, error: null };
      } else if (op === 'delete') {
        for (const [k] of casa) h.estado.delete(k);
        res = { data: null, error: null };
      } else {
        const rows = casa.map(([k, r]) => ({ key: k, value: r.value, updated_at: r.updated_at }));
        res = { data: unico ? (rows[0] ?? null) : rows, error: null };
      }
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return q;
}

function builderGerador(tabela: string) {
  let op = 'select'; let patch: any = null; let unico = false; let max = 1000;
  const filtros: Array<(r: Linha) => boolean> = [];
  const q: any = {
    select: () => q,
    update: (p: any) => { op = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { if (c === 'observacao') h.eqObs.push(String(v)); filtros.push(r => r[c] === v); return q; },
    is: (c: string, v: any) => { filtros.push(r => (r[c] ?? null) === v); return q; },
    like: (c: string, p: string) => { filtros.push(r => String(r[c] ?? '').endsWith(p.replace(/^%/, ''))); return q; },
    in: (c: string, lista: any[]) => { filtros.push(r => lista.includes(r[c])); return q; },
    gte: (c: string, v: any) => { filtros.push(r => String(r[c]) >= String(v)); return q; },
    lt: (c: string, v: any) => { filtros.push(r => String(r[c]) < String(v)); return q; },
    order: () => q,
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (ok: (v: any) => any, ko?: (e: any) => any) => {
      let res: any;
      if (tabela === 'consultores') res = { data: h.consultores, error: null };
      else if (op === 'update') {
        const hook = h.antesDoUpdate; h.antesDoUpdate = null; if (hook) hook();
        const casa = h.agend.filter(r => filtros.every(f => f(r)));
        for (const r of casa) {
          Object.assign(r, patch);
          // Emula o gatilho: coalesce(coluna, o que o texto diz). O 'malvado' lê qualquer ficha como NOTA 3.
          if (h.gatilho !== 'nenhum' && String(r.created_by).includes('eletroposto')) {
            const obs = String(r.observacao ?? '');
            const m = h.gatilho === 'real' ? /NOTA ([123])\s*·/.exec(obs) : /Ficha de teste/.exec(obs) && ['', '3'];
            r.nota = r.nota ?? (m ? Number(m[1]) : null);
          }
        }
        if (casa.length && 'observacao' in patch) h.eventos.push('grava_card');
        res = { data: casa.map(r => ({ id: r.id })), error: null };
      } else {
        const rows = h.agend.filter(r => filtros.every(f => f(r))).slice(0, max).map(r => ({ ...r }));
        h.leituras++; const hook = h.aoLer; if (hook) hook(h.leituras);
        res = { data: unico ? (rows[0] ?? null) : rows, error: null };
      }
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: () => builderEstado() } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => builderGerador(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  linhaEmCooldown: () => h.cooldown,
  sendWhatsApp: vi.fn(async (tel: string, texto: string, inst: string) => {
    h.emVoo++; h.maxEmVoo = Math.max(h.maxEmVoo, h.emVoo);
    h.eventos.push('envio');
    await new Promise(r => setTimeout(r, 2));
    h.emVoo--;
    if (h.falhaEnvio) throw new Error(h.erroEnvio);
    h.enviados.push({ tel, texto, inst });
  }),
}));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      create: async (corpo: any) => {
        h.ia.chamadas++;
        h.ia.ultimoPedido = JSON.stringify(corpo);
        if (h.ia.modo === 'fora') throw new Error('credit balance is too low');
        return { content: [{ type: 'text', text: h.ia.modo === 'torto' ? 'isto não é json' : h.ia.texto }] };
      },
    },
  }),
}));
vi.mock('../services/agentes5040/contexto', () => ({
  lerConversa: vi.fn(async () => ({ msgs: h.conversa.msgs, completa: h.conversa.completa })),
  montarContexto: vi.fn(async (chave: string, conv: { msgs: any[]; completa: boolean }) => ({
    chave, nome: null, msgs: conv.msgs, completa: conv.completa, card: null, leadsMeta: null, cadastros: [],
    ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: new Date().toISOString(),
  })),
}));

import {
  LIMITE_OBSERVACAO_NA_URL, aplicarBloco, blocoSeguro, camposDoCard, escreverFichaNoCard, fichaDeCampos, linkDaConversa, lerRespostaFicha,
  montarFicha, semBloco, textoDaMensagem, LINK_BASE,
} from '../services/agentes5040/ficha';
import { TELEFONES_DE_RESERVA } from '../services/agentes5040/fichaEnvio';
import { runFichaConsultorTick, sondaFichaNoCard, enviarFichaDeTeste, LINHAS_DA_SONDA } from '../services/agentes5040/fichaTick';
import { CHAVE_VIVO_ALVO, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { leadEhDeTeste } from '../services/agentes5040/fichaEnvio';
import { fichaConsultorLigada, fichaCobre, fichaSubstituiAviso, ORIGENS_COM_FICHA } from '../services/agentes5040/chaves';

const AGORA = new Date('2026-10-20T15:00:00.000Z');
const ATRAS = (min: number): string => new Date(AGORA.getTime() - min * 60_000).toISOString();
const DIR = join(__dirname, '..', 'services', 'agentes5040');
const fonte = (arq: string): string => readFileSync(join(DIR, arq), 'utf8');

function novoCard(id: number, extra: Linha = {}): Linha {
  return {
    id, vendedor_nome: 'Diego', quando: '2026-10-21T17:30:00.000Z', cliente_nome: 'Camila Souza',
    cliente_telefone: '5534991113333', cidade: 'Uberlândia', created_by: 'lp_eletroposto', created_at: ATRAS(5),
    status: 'agendado', temperatura: null,
    observacao: 'LP ELETROPOSTO · Posto de combustível\nPonto: Tenho o local\nDecisor: Eu decido\nNOTA 3 · 9/11 pts',
    ...extra,
  };
}

const rodar = (opts: Record<string, unknown> = {}) => runFichaConsultorTick({ agora: AGORA, ...opts });
const reservadoComoTratado = (id: number): boolean => h.estado.has(`ficha_card:${id}`);

beforeEach(() => {
  h.estado.clear(); h.agend.length = 0; h.eventos.length = 0; h.enviados.length = 0;
  h.emVoo = 0; h.maxEmVoo = 0; h.falhaEnvio = false; h.erroEnvio = 'z-api fora'; h.cooldown = false; h.eqObs.length = 0; h.leituras = 0; h.aoLer = null; h.escondeReservas = false; h.antesDoUpdate = null;
  h.ia.modo = 'fora'; h.ia.texto = ''; h.ia.chamadas = 0; h.ia.ultimoPedido = ''; h.gatilho = 'nenhum';
  h.conversa.msgs = []; h.conversa.completa = true;
  h.consultores = [
    { nome: 'Diego', whatsapp: '(34) 99117-2222' }, { nome: 'Thiago', whatsapp: '34991360223' },
    { nome: 'Nilce', whatsapp: null },
  ];
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  process.env.AGENTES5040_FICHA = '1';
  delete process.env.FICHA_5040_IA_OFF;
  zerarCacheInterruptores();
});
afterEach(() => { delete process.env.AGENTES5040_FICHA; delete process.env.AGENTES5040_HMAC; });

// ── os padrões do gatilho trg_eletroposto_estruturar ─────────────────────────

/** Os mesmos padrões do gatilho (flag 'n' do Postgres = ^ e $ em cada LINHA) e o `like` da porta do carregador. */
const GATILHO: Array<[string, RegExp]> = [
  ['perfil', /^LP ELETROPOSTO [—·] (.+)$/m],
  ['ponto', /^Ponto:\s*(.+)$/m],
  ['invest', /^Como pretende investir:\s*(.+)$/m],
  ['decisor', /^Decisor:\s*(.+)$/m],
  ['rota', /^Rota de passagem:\s*(.+)$/m],
  ['trifasica', /^Entrada trif.sica:\s*(.+)$/m],
  ['relacao', /^Local . seu:\s*(.+)$/m],
  ['simulou', /^Simulou (\d+) kW/m],
  ['nota', /NOTA ([123])\s*·/],
  ['pontos', /NOTA [123]\s*·\s*(\d+)\/11/],
  ['fluxo', /com (\d+) carros\/dia/],
  ['carregador', /COMPRA DE CARREGADOR/],
];

describe('blocoSeguro: nenhum padrão do gatilho do banco casa', () => {
  const hostil = [...LINHAS_DA_SONDA, 'NOTA 2 · 7/11 pts', 'com 4 carros/dia', 'LP ELETROPOSTO · Posto',
    'Decisor: terceiros', 'Entrada trifasica: Não', 'Local e seu: não'];

  it('controle positivo: cada padrão casa o texto hostil CRU (o teste não é vazio)', () => {
    const cru = hostil.join('\n');
    for (const [nome, re] of GATILHO) expect(re.test(cru), `${nome} deveria casar o texto cru`).toBe(true);
  });

  it('o bloco gravado no fim da observação não casa nenhum deles', () => {
    const seguras = blocoSeguro([...hostil, `Conversa completa: ${linkDaConversa(7)}`]);
    const obs = aplicarBloco('LP ELETROPOSTO · Posto\nPonto: Tenho o local', seguras);
    const soBloco = obs.slice(obs.indexOf('FICHA 5040'));
    for (const [nome, re] of GATILHO) expect(re.test(soBloco), `${nome} casou o bloco`).toBe(false);
  });

  it('coalesce do gatilho: o bloco não acrescenta match a uma observação que já tinha os seus', () => {
    const original = novoCard(1).observacao as string;
    const antes = GATILHO.map(([, re]) => re.exec(original)?.[0] ?? null);
    const depois = GATILHO.map(([, re]) => re.exec(aplicarBloco(original, blocoSeguro(hostil)))?.[0] ?? null);
    expect(depois).toEqual(antes);
  });

  it('toda linha começa com "· ", sem emoji, sem travessão e sem link que não seja o da conversa', () => {
    const linhas = blocoSeguro([
      'Marcos 😀 quer solar — urgente', 'Veja http://golpe.example/x e wa.me/5511999990000', '  - com espaço e marcador',
      'Conversa completa: ' + linkDaConversa(9),
    ]);
    for (const l of linhas) {
      expect(l.startsWith('· ')).toBe(true);
      expect(/[—–]/.test(l)).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(l)).toBe(false);
    }
    expect(linhas.join('\n')).not.toMatch(/golpe|wa\.me|5511999990000/);
    expect(linhas.join('\n')).toContain(linkDaConversa(9));
  });

  it('os rótulos que os leitores do código procuram saem da linha ("Conta de luz:" vira "Conta de luz -")', () => {
    const [l] = blocoSeguro(['Conta de luz: R$ 600']);
    expect(l).toBe('· Conta de luz - R$ 600');
  });

  it('as marcas do bloco não podem ser forjadas pelo texto do cliente', () => {
    const linhas = blocoSeguro(['FIM DA FICHA', 'FICHA 5040 de mentira']);
    expect(linhas.join('\n')).not.toMatch(/FIM DA FICHA|FICHA 5040/);
  });

  it('o link da conversa sobrevive mesmo com o teto de linhas', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => `Linha ${i}`);
    const seguras = blocoSeguro([...muitas.slice(0, 11), `Conversa completa: ${linkDaConversa(3)}`]);
    expect(seguras[seguras.length - 1]).toContain(LINK_BASE);
  });
});

describe('aplicarBloco / semBloco: o fim da observação', () => {
  const obs = 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: R$ 600\nImóvel: Próprio';
  const L1 = ['· Ficha Solar · Ana', '· Conversa completa: x'];
  const L2 = ['· Outra versão da ficha'];

  it('a primeira linha e o corpo ficam como estavam; o bloco vai no fim', () => {
    const nova = aplicarBloco(obs, L1);
    expect(nova.split('\n')[0]).toBe(obs.split('\n')[0]);
    expect(semBloco(nova)).toBe(obs);
    expect(nova.endsWith('FIM DA FICHA')).toBe(true);
    expect(nova).toContain('\n\nFICHA 5040\n· Ficha Solar · Ana');
  });

  it('idempotente: aplicar de novo (igual ou outra versão) troca o bloco e nunca deixa dois', () => {
    const a = aplicarBloco(obs, L1);
    expect(aplicarBloco(a, L1)).toBe(a);
    const b = aplicarBloco(a, L2);
    expect(b.match(/FICHA 5040/g)).toHaveLength(1);
    expect(b).toContain('Outra versão');
    expect(b).not.toContain('Ficha Solar · Ana');
    expect(aplicarBloco(b, L2)).toBe(b);
  });

  it('observação com quebras no fim, nula ou vazia também fecha igual', () => {
    for (const o of [obs + '\n', obs + '\n\n\n', null, '']) {
      const a = aplicarBloco(o, L1);
      expect(aplicarBloco(a, L1)).toBe(a);
      expect(semBloco(a).trimEnd()).toBe(String(o ?? '').trimEnd());
    }
  });
});

// ── a escrita no card ────────────────────────────────────────────────────────

describe('escreverFichaNoCard', () => {
  it('grava o bloco e devolve ok', async () => {
    h.agend.push(novoCard(10));
    const r = await escreverFichaNoCard(10, ['· Ficha']);
    expect(r).toMatchObject({ ok: true, tentativas: 1, jaEstava: false });
    expect(h.agend[0]!.observacao).toContain('FICHA 5040\n· Ficha\nFIM DA FICHA');
    expect(String(h.agend[0]!.observacao).split('\n')[0]).toBe('LP ELETROPOSTO · Posto de combustível');
  });

  it('a segunda escrita igual não toca no banco (já estava)', async () => {
    h.agend.push(novoCard(10));
    await escreverFichaNoCard(10, ['· Ficha']);
    h.eventos.length = 0;
    expect(await escreverFichaNoCard(10, ['· Ficha'])).toMatchObject({ ok: true, jaEstava: true });
    expect(h.eventos).toEqual([]);
  });

  it('retry otimista: alguém mexeu entre a leitura e a escrita, lê de novo e a edição dele sobrevive', async () => {
    h.agend.push(novoCard(10));
    h.antesDoUpdate = () => { h.agend[0]!.observacao += '\nNota do consultor: ligar depois das 14h'; };
    const r = await escreverFichaNoCard(10, ['· Ficha']);
    expect(r).toMatchObject({ ok: true, tentativas: 2 });
    expect(h.agend[0]!.observacao).toContain('Nota do consultor: ligar depois das 14h');
    expect(h.agend[0]!.observacao).toContain('FICHA 5040');
  });

  it('perde a corrida nas três tentativas: erro dito, nada apagado', async () => {
    h.agend.push(novoCard(10));
    const original = h.agend[0]!.observacao;
    const mexe = (): void => { h.agend[0]!.observacao += '.'; h.antesDoUpdate = mexe; };
    h.antesDoUpdate = mexe;
    const r = await escreverFichaNoCard(10, ['· Ficha']);
    expect(r).toEqual({ ok: false, motivo: 'corrida_perdida' });
    expect(String(h.agend[0]!.observacao).startsWith(original)).toBe(true);
    expect(h.agend[0]!.observacao).not.toContain('FICHA 5040');
  });

  it('observação nula usa .is(null) (eq nunca casa nulo)', async () => {
    h.agend.push(novoCard(10, { observacao: null }));
    const r = await escreverFichaNoCard(10, ['· Ficha']);
    expect(r.ok).toBe(true);
    expect(h.agend[0]!.observacao).toContain('FICHA 5040');
  });

  it('card que não existe: sem_card', async () => {
    expect(await escreverFichaNoCard(999, ['· Ficha'])).toEqual({ ok: false, motivo: 'sem_card' });
  });
});

// ── o texto ──────────────────────────────────────────────────────────────────

describe('a ficha só com os campos do card', () => {
  it('título, reunião em Brasília, campos sem placeholder e o link sem telefone', () => {
    const f = fichaDeCampos(novoCard(42) as any);
    expect(f.origem).toBe('campos');
    expect(f.linhas[0]).toBe('Ficha Eletroposto · Camila Souza, Uberlândia');
    expect(f.linhas[1]).toBe('Reunião com Diego, qua 21/10 às 14h30');
    expect(f.linhas.join('\n')).toContain('Perfil: Posto de combustível');
    expect(f.linhas.join('\n')).toContain('Ponto: Tenho o local');
    expect(f.linhas.join('\n')).toContain('Nota 3, 9/11 pts');
    expect(f.linhas[f.linhas.length - 1]).toBe(`Conversa completa: ${linkDaConversa(42)}`);
    expect(linkDaConversa(42)).toBe('https://solardoc.app/gerador/whatsapp/?card=42');
    expect(linkDaConversa(42)).not.toMatch(/\d{8,}/);
  });

  it('linha com valor vazio ou travessão é omitida (nada de "—")', () => {
    const campos = camposDoCard(novoCard(1, { observacao: 'LP SOLAR — Casa\nConta de luz: —\nImóvel: Próprio\nTelhado:' }) as any);
    expect(campos.join('\n')).toContain('Imóvel: Próprio');
    expect(campos.join('\n')).not.toMatch(/Conta de luz|Telhado|—/);
  });

  it('exemplo da mensagem (caminho sem IA)', () => {
    const f = fichaDeCampos(novoCard(42) as any);
    const texto = textoDaMensagem(blocoSeguro(f.linhas), '5534991113333');
    expect(texto).toBe([
      'Ficha Eletroposto · Camila Souza, Uberlândia',
      'Reunião com Diego, qua 21/10 às 14h30',
      'Perfil - Posto de combustível',
      'Ponto - Tenho o local',
      'Decisor - Eu decido',
      'Nota 3, 9/11 pts',
      'Contato: wa.me/5534991113333',
      'Conversa completa: https://solardoc.app/gerador/whatsapp/?card=42',
    ].join('\n'));
  });

  it('começa com maiúscula, uma bolha só, dentro do teto, e o link nunca leva o telefone', () => {
    const f = fichaDeCampos(novoCard(42, { observacao: 'x\n' + Array.from({ length: 30 }, (_, i) => `Campo ${i}: ${'a'.repeat(150)}`).join('\n') }) as any);
    const texto = textoDaMensagem(blocoSeguro(f.linhas), '34991113333');
    expect(texto[0]).toBe(texto[0]!.toUpperCase());
    expect(texto.length).toBeLessThanOrEqual(1400);
    expect(texto.endsWith(linkDaConversa(42))).toBe(true);
    expect(texto).toContain('Contato: wa.me/5534991113333');
  });
});

describe('montarFicha: IA e fallback', () => {
  const ctxCom = (msgs: any[]) => ({ chave: '3491113333', nome: null, msgs, completa: true, card: null, leadsMeta: null, cadastros: [], ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: AGORA.toISOString() }) as any;
  const msg = (id: number, autor: 'lead' | 'robo', texto: string) => ({ id, from_me: autor !== 'lead', from_api: null, autor, texto, tipo: 'texto', media_url: null, momment: ATRAS(10 - id) });

  it('IA fora (saldo): a ficha sai só com os campos do card e nada de ia_falha é gravado', async () => {
    h.ia.modo = 'fora';
    const f = await montarFicha(novoCard(5) as any, ctxCom([msg(1, 'lead', 'Oi, tenho um posto')]));
    expect(f.origem).toBe('campos');
    expect(h.ia.chamadas).toBe(1);
    expect([...h.estado.keys()].some(k => k.startsWith('ia_falha'))).toBe(false);
  });

  it('resposta torta ou fora do formato: campos', async () => {
    h.ia.modo = 'torto';
    expect((await montarFicha(novoCard(5) as any, ctxCom([msg(1, 'lead', 'Oi')]))).origem).toBe('campos');
    expect(lerRespostaFicha('{"linhas":[],"abertura":"x"}')).toBeNull();
    expect(lerRespostaFicha('{"linhas":["a"]}')).toBeNull();
  });

  it('IA no ar: resume, com o modelo certo e a conversa no pedido', async () => {
    h.ia.modo = 'ok';
    h.ia.texto = JSON.stringify({ linhas: ['Tem posto próprio.', 'Quer saber o prazo.'], abertura: 'Camila, vamos olhar o seu posto?' });
    const f = await montarFicha(novoCard(5) as any, ctxCom([msg(1, 'lead', 'Tenho um posto na Rondon')]));
    expect(f.origem).toBe('ia');
    expect(f.linhas).toContain('Abertura: Camila, vamos olhar o seu posto?');
    expect(h.ia.ultimoPedido).toContain('claude-sonnet-5-5');
    expect(h.ia.ultimoPedido).toContain('Tenho um posto na Rondon');
  });

  it('sem conversa: não gasta IA e diz que o cliente ainda não escreveu', async () => {
    h.ia.modo = 'ok';
    const f = await montarFicha(novoCard(5) as any, ctxCom([]));
    expect(h.ia.chamadas).toBe(0);
    expect(f.linhas).toContain('Ainda sem conversa na 5040');
  });

  it('sem contexto (leitura falhou) ou FICHA_5040_IA_OFF=1: campos, sem afirmar nada sobre a conversa', async () => {
    h.ia.modo = 'ok';
    expect((await montarFicha(novoCard(5) as any, null)).linhas.join('\n')).not.toContain('Ainda sem conversa');
    process.env.FICHA_5040_IA_OFF = '1';
    const f = await montarFicha(novoCard(5) as any, ctxCom([msg(1, 'lead', 'oi')]));
    expect(f.origem).toBe('campos');
    expect(h.ia.chamadas).toBe(0);
  });
});

// ── a chave ──────────────────────────────────────────────────────────────────

describe('chaves: um interruptor liga a ficha e cala os avisos antigos', () => {
  it('env AGENTES5040_FICHA: 1 liga, 0 desliga (sobrescreve o banco); sem segredo de HMAC vale como desligada', async () => {
    expect(await fichaConsultorLigada()).toBe(true);
    for (const v of ['0', ' 0 ']) { process.env.AGENTES5040_FICHA = v; expect(await fichaConsultorLigada()).toBe(false); }
    process.env.AGENTES5040_FICHA = ' 1 ';
    expect(await fichaConsultorLigada()).toBe(true);
    delete process.env.AGENTES5040_HMAC;
    const velha = process.env.SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_KEY;
    expect(await fichaConsultorLigada()).toBe(false);
    if (velha !== undefined) process.env.SUPABASE_SERVICE_KEY = velha;
  });

  it('sem env, vale a chave ag5040_interruptores do banco; ausente ou ilegível = desligada (avisos antigos seguem)', async () => {
    delete process.env.AGENTES5040_FICHA;
    zerarCacheInterruptores();
    expect(await fichaConsultorLigada()).toBe(false);                                    // chave ausente
    zerarCacheInterruptores();
    h.estado.set('ag5040_interruptores', { value: { ficha: true }, updated_at: ATRAS(1) });
    expect(await fichaConsultorLigada()).toBe(true);
    zerarCacheInterruptores();
    h.estado.set('ag5040_interruptores', { value: 'isto não é json {', updated_at: ATRAS(1) });
    expect(await fichaConsultorLigada()).toBe(false);                                    // ilegível
    expect(await fichaSubstituiAviso({ created_by: 'lp_solar', status: 'agendado' })).toBe(false);
  });

  it('os 5 avisos antigos: desligado = seguem; ligado = saem cedo, e só para as origens que a ficha cobre', async () => {
    expect([...ORIGENS_COM_FICHA].sort()).toEqual(['lead-meta', 'lp_eletroposto', 'lp_solar', 'manychat', 'manychat_eletroposto']);
    for (const created_by of ORIGENS_COM_FICHA) {
      expect(await fichaSubstituiAviso({ created_by, status: 'agendado' }), `${created_by} on`).toBe(true);
      process.env.AGENTES5040_FICHA = '0';
      expect(await fichaSubstituiAviso({ created_by, status: 'agendado' }), `${created_by} off`).toBe(false);
      process.env.AGENTES5040_FICHA = '1';
    }
    // Fora da lista, ou cancelado: o aviso antigo segue (a ficha não cobre; zero aviso seria pior).
    for (const created_by of ['cadastro_eletroposto', 'agente_eletroposto', 'thiago', 'indicacao', null, '']) {
      expect(await fichaSubstituiAviso({ created_by, status: 'agendado' })).toBe(false);
    }
    expect(fichaCobre({ created_by: 'lp_solar', status: 'cancelado' })).toBe(false);
    expect(await fichaSubstituiAviso({ created_by: 'lp_solar', status: ' Cancelado ' })).toBe(false);
    expect(fichaCobre({ created_by: 'lp_solar', status: null })).toBe(true);
  });

  it('cada um dos 5 avisos antigos consulta a chave antes de enviar', () => {
    const raiz = join(__dirname, '..');
    const ler = (p: string): string => readFileSync(join(raiz, p), 'utf8');
    const conta = (s: string): number => (s.match(/fichaSubstituiAviso\(/g) ?? []).length;
    expect(conta(ler('services/agenda/leadsMetaService.ts'))).toBe(1);
    expect(conta(ler('services/agenda/manychatLeadService.ts'))).toBe(2);
    expect(conta(ler('routes/ioSolar.ts'))).toBe(2);
    expect(conta(ler('routes/ioEletroposto.ts'))).toBe(1);
    // E nenhum deles importa o envio da ficha (só a chave, que não importa o zapiClient).
    for (const p of ['services/agenda/leadsMetaService.ts', 'services/agenda/manychatLeadService.ts', 'routes/ioSolar.ts', 'routes/ioEletroposto.ts']) {
      expect(ler(p)).toContain("agentes5040/chaves'");
      expect(ler(p)).not.toMatch(/agentes5040\/(fichaEnvio|fichaTick|ficha)'/);
    }
    // Os recados "passou para você" e os outros avisos listados como fora não foram tocados.
    for (const p of ['services/io/solarAgenteQuiz.ts', 'services/io/investidorAgente.ts', 'services/io/eletropostoCardPing.ts', 'services/io/recepcaoIo.ts']) {
      expect(ler(p)).not.toContain('agentes5040/chaves');
    }
  });
});

// ── a rodada ─────────────────────────────────────────────────────────────────

describe('runFichaConsultorTick', () => {
  it('interruptor desligado: não envia, não reserva e não escreve NADA no banco', async () => {
    process.env.AGENTES5040_FICHA = '0';
    h.agend.push(novoCard(1));
    const antes = JSON.stringify([...h.estado.entries()]);
    const r = await rodar();
    expect(r).toMatchObject({ rodou: false, motivo: 'desligada', ligada: false });
    expect(h.enviados).toEqual([]);
    expect(JSON.stringify([...h.estado.entries()])).toBe(antes);
  });

  it('ligada: card antes do envio, 1 bolha pela instância io, para o consultor dono, telefone da tabela', async () => {
    h.agend.push(novoCard(1));
    const r = await rodar();
    expect(r.itens).toEqual([{ id: 1, resultado: 'enviada', origem_da_ficha: 'campos', card_gravado: true, destino: 'consultor' }]);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]).toMatchObject({ tel: '34991172222', inst: 'io' });
    expect(h.enviados[0]!.texto).toContain('Ficha Eletroposto · Camila Souza, Uberlândia');
    expect(h.enviados[0]!.texto).toContain('https://solardoc.app/gerador/whatsapp/?card=1');
    expect(h.eventos.filter(e => ['insert:ficha_card', 'insert:ficha_lead', 'grava_card', 'envio'].includes(e)))
      .toEqual(['insert:ficha_card', 'insert:ficha_lead', 'grava_card', 'envio']);
    expect(h.agend[0]!.observacao).toContain('FICHA 5040');
    expect(String(h.agend[0]!.observacao).split('\n')[0]).toBe('LP ELETROPOSTO · Posto de combustível');
    expect(h.estado.get('ficha_card:1')!.value.estado).toBe('enviada');
  });

  it('nenhuma chave nem valor do system_state leva telefone, nome ou texto', async () => {
    h.agend.push(novoCard(1));
    await rodar();
    const tudo = JSON.stringify([...h.estado.entries()]);
    expect(tudo).not.toMatch(/91113333|5534991113333|Camila|Uberl/);
    expect(tudo).toContain('ficha_lead:');
  });

  it('o carimbo é próprio: nunca aviso_sent: nem um prefixo da lista de frios da linha', async () => {
    h.agend.push(novoCard(1));
    await rodar();
    expect([...h.estado.keys()].some(k => k.startsWith('aviso_sent:'))).toBe(false);
    const lt = readFileSync(join(__dirname, '..', 'services', 'agents', 'whatsapp', 'lineThrottle.ts'), 'utf8');
    expect(lt).not.toMatch(/'ficha_card:'|'ficha_lead:'/);
  });

  it('23505 na reserva do card (outro chamador na frente): não grava e não envia', async () => {
    h.agend.push(novoCard(1));
    h.escondeReservas = true;                                           // a leitura prévia não vê
    h.estado.set('ficha_card:1', { value: { estado: 'reservada' }, updated_at: ATRAS(1) });
    const r = await rodar();
    expect(r.itens[0]!.resultado).toBe('ja_tratado');
    expect(h.enviados).toEqual([]);
    expect(h.eventos).not.toContain('grava_card');
  });

  it('segunda rodada do mesmo card: nada sai de novo', async () => {
    h.agend.push(novoCard(1));
    await rodar(); await rodar();
    expect(h.enviados).toHaveLength(1);
  });

  it('dois cards da mesma chave e do mesmo produto (mesmo cliente): UMA ficha', async () => {
    h.agend.push(novoCard(1), novoCard(2, { created_at: ATRAS(4), cliente_telefone: '(34) 99111-3333' }));
    await rodar(); const r = await rodar();
    expect(h.enviados).toHaveLength(1);
    expect(r.itens.map(i => i.resultado)).toEqual(['ja_tratado', 'lead_ja_avisado']);
    expect(h.estado.get('ficha_card:2')!.value.estado).toBe('lead_ja_avisado');
  });

  it('mesmo cliente com card de solar e de eletroposto: uma ficha em CADA produto (cada consultor recebe a sua)', async () => {
    h.agend.push(novoCard(1), novoCard(2, { created_at: ATRAS(4), created_by: 'lp_solar', vendedor_nome: 'Thiago', observacao: 'LP SOLAR — Casa' }));
    await rodar(); await rodar();
    expect(h.enviados.map(e => e.tel)).toEqual(['34991172222', '34991360223']);
    expect([...h.estado.keys()].filter(k => k.startsWith('ficha_lead:'))).toHaveLength(2);
  });

  it('a reserva do lead vale 30 dias: a de 31 dias é retomada, a de 29 segura', async () => {
    h.agend.push(novoCard(1));
    const chave = [...(await (async () => { await rodar(); return h.estado.keys(); })())].find(k => k.startsWith('ficha_lead:'))!;
    // 29 dias: segura
    h.estado.set(chave, { value: { em: 'x' }, updated_at: new Date(AGORA.getTime() - 29 * 86_400_000).toISOString() });
    h.agend.push(novoCard(2, { created_at: ATRAS(4) }));
    expect((await rodar()).itens.find(i => i.id === 2)!.resultado).toBe('lead_ja_avisado');
    // 31 dias: retomada
    h.estado.set(chave, { value: { em: 'x' }, updated_at: new Date(AGORA.getTime() - 31 * 86_400_000).toISOString() });
    h.agend.push(novoCard(3, { created_at: ATRAS(3) }));
    expect((await rodar()).itens.find(i => i.id === 3)!.resultado).toBe('enviada');
  });

  it('só as origens da lista, e nada de cancelado, card manual ou cadastro em lote', async () => {
    h.agend.push(
      novoCard(1, { created_by: 'cadastro_eletroposto' }), novoCard(2, { created_by: 'thiago' }),
      novoCard(3, { status: 'cancelado' }), novoCard(4, { created_by: 'agente_eletroposto' }),
      novoCard(5, { created_by: 'lp_solar', cliente_telefone: '5534988880000' }),
    );
    const r = await rodar();
    expect(r.itens.map(i => i.id)).toEqual([5]);
    expect(h.enviados).toHaveLength(1);
  });

  it('janela: card com mais de 6 h ou mais novo que 45 s fica de fora', async () => {
    process.env.AGENTES5040_FICHA = '1';
    h.agend.push(novoCard(1, { created_at: ATRAS(500) }), novoCard(2, { created_at: new Date(AGORA.getTime() - 10_000).toISOString() }));
    expect((await rodar()).itens).toEqual([]);
  });

  it('aviso antigo que ENVIOU (marca por card): a ficha pula esse card e cuida do outro', async () => {
    h.agend.push(novoCard(1), novoCard(2, { cliente_telefone: '5534988881111', created_at: ATRAS(4) }));
    h.estado.set('aviso_antigo:1', { value: { em: ATRAS(4) }, updated_at: ATRAS(4) });
    const r = await rodar();
    expect(r.itens).toEqual([
      { id: 1, resultado: 'aviso_antigo' },
      expect.objectContaining({ id: 2, resultado: 'enviada' }),
    ]);
    expect(h.enviados).toHaveLength(1);
    expect(h.estado.has('ficha_card:1')).toBe(false);
  });

  it('a marca que nasce DEPOIS da leitura da rodada, antes de reservar, também segura o card', async () => {
    h.agend.push(novoCard(1));
    h.escondeReservas = true;   // a leitura em lote não vê; a conferência logo antes de reservar vê
    h.estado.set('aviso_antigo:1', { value: { em: ATRAS(1) }, updated_at: ATRAS(1) });
    const r = await rodar();
    expect(r.itens[0]!.resultado).toBe('aviso_antigo');
    expect(h.enviados).toEqual([]);
  });

  it('o aviso antigo (interruptor desligado) grava aviso_antigo:<id>; ligado, não grava e sai cedo', async () => {
    process.env.AGENTES5040_FICHA = '0';
    expect(await fichaSubstituiAviso({ id: 77, created_by: 'lp_solar', status: 'agendado' })).toBe(false);
    expect(h.estado.has('aviso_antigo:77')).toBe(true);
    expect(JSON.stringify([...h.estado.entries()])).not.toMatch(/\d{8,}/);
    process.env.AGENTES5040_FICHA = '1';
    expect(await fichaSubstituiAviso({ id: 78, created_by: 'lp_solar', status: 'agendado' })).toBe(true);
    expect(h.estado.has('aviso_antigo:78')).toBe(false);
  });

  it('a rodada ligada nunca grava marca de horário (a virada do interruptor não depende de relógio)', async () => {
    h.agend.push(novoCard(1));
    await rodar();
    expect(h.estado.has('ficha_5040_desde')).toBe(false);
  });

  it('consultor sem telefone na tabela mas no mapa dos avisos antigos: vai a ele', async () => {
    h.agend.push(novoCard(1, { vendedor_nome: 'Nilce' }));
    const r = await rodar();
    expect(r.itens[0]).toMatchObject({ resultado: 'enviada', destino: 'consultor' });
    expect(h.enviados[0]!.tel).toBe('34991516846');
  });

  it('consultor desconhecido ou card sem vendedor: a ficha vai ao DONO com o motivo na 1ª linha (nunca pula calado)', async () => {
    process.env.RESUMO_DIA_WHATS = '34991360223';
    h.agend.push(novoCard(1, { vendedor_nome: 'Fulano Novo' }), novoCard(2, { vendedor_nome: null, cliente_telefone: '5534988881111', created_at: ATRAS(4) }));
    await rodar(); await rodar();
    expect(h.enviados).toHaveLength(2);
    for (const e of h.enviados) expect(e.tel).toBe('34991360223');
    expect(h.enviados[0]!.texto.split('\n')[0]).toMatch(/^Sem telefone cadastrado para o consultor Fulano Novo\./);
    expect(h.enviados[1]!.texto.split('\n')[0]).toMatch(/^Card sem consultor dono\./);
    expect(h.estado.get('ficha_card:1')!.value.destino).toBe('dono');
    delete process.env.RESUMO_DIA_WHATS;
  });

  it('os números de reserva são os mesmos dos avisos antigos (leadsMetaService)', () => {
    const lm = readFileSync(join(__dirname, '..', 'services', 'agenda', 'leadsMetaService.ts'), 'utf8');
    for (const n of Object.values(TELEFONES_DE_RESERVA)) expect(lm).toContain(`'${n}'`);
  });

  it('cliente sem telefone válido: a ficha vai ao consultor SEM a linha de contato, e sem reserva de lead', async () => {
    h.agend.push(novoCard(1, { cliente_telefone: '123' }));
    const r = await rodar();
    expect(r.itens[0]!.resultado).toBe('enviada');
    expect(h.enviados[0]!.texto).not.toMatch(/Contato:|wa\.me/);
    expect([...h.estado.keys()].some(k => k.startsWith('ficha_lead:'))).toBe(false);
  });

  it('UMA ficha por rodada, sem pausa fixa, e nunca duas ao mesmo tempo', async () => {
    for (let i = 1; i <= 3; i++) h.agend.push(novoCard(i, { cliente_telefone: `55349911100${i}0`, created_at: ATRAS(10 - i) }));
    const r = await rodar();
    expect(h.enviados).toHaveLength(1);
    expect(r.itens.filter(i => i.resultado === 'enviada')).toHaveLength(1);
    await rodar(); await rodar();
    expect(h.enviados).toHaveLength(3);
    expect(h.maxEmVoo).toBe(1);
    expect(fonte('fichaTick.ts')).not.toMatch(/setTimeout|dorme|pausaMs/);
  });

  it('o envio falha (5xx/timeout): o card já está gravado, a reserva fica final, a rodada PARA e não manda duas', async () => {
    h.agend.push(novoCard(1), novoCard(2, { cliente_telefone: '5534988881111', created_at: ATRAS(4) }));
    h.falhaEnvio = true; h.erroEnvio = 'HTTP 502 bad gateway';
    const r = await rodar();
    expect(r.itens[0]).toMatchObject({ resultado: 'falha_envio', card_gravado: true });
    expect(r.itens).toHaveLength(1);
    expect(h.agend[0]!.observacao).toContain('FICHA 5040');
    expect(h.estado.get('ficha_card:1')!.value.estado).toBe('falha_envio');
    h.falhaEnvio = false;
    await rodar();
    expect(h.enviados.every(e => !e.texto.includes('card=1'))).toBe(true);
    expect(h.estado.get('ficha_card:1')!.value.estado).toBe('falha_envio');
  });

  it('erro que PROVA que nada saiu (cooldown, credencial ausente): a reserva volta a pendente e o card sai na rodada seguinte', async () => {
    h.agend.push(novoCard(1));
    h.falhaEnvio = true; h.erroEnvio = '[zapi:io] em cooldown (instância indisponível há <60s) — pulando envio';
    const r = await rodar();
    expect(r.itens[0]!.resultado).toBe('devolvida');
    expect([...h.estado.keys()].filter(k => k.startsWith('ficha_card:') || k.startsWith('ficha_lead:'))).toEqual([]);
    h.falhaEnvio = false;
    expect((await rodar()).itens[0]!.resultado).toBe('enviada');
    expect(h.enviados).toHaveLength(1);
  });

  it('linha io em cooldown ANTES de reservar: sai sem reservar nem gravar no card', async () => {
    h.agend.push(novoCard(1));
    h.cooldown = true;
    const r = await rodar();
    expect(r.itens[0]!.resultado).toBe('linha_em_cooldown');
    expect([...h.estado.keys()].filter(k => k.startsWith('ficha_'))).toEqual([]);
    expect(h.eventos).not.toContain('grava_card');
    h.cooldown = false;
    expect((await rodar()).itens[0]!.resultado).toBe('enviada');
  });

  it('reserva presa em "reservada" há mais de 5 min: tenta de novo UMA vez; presa de novo, avisa o dono (só o id)', async () => {
    process.env.RESUMO_DIA_WHATS = '34991360223';
    h.agend.push(novoCard(1));
    h.estado.set('ficha_card:1', { value: { estado: 'reservada', em: ATRAS(9) }, updated_at: ATRAS(9) });
    let r = await rodar();
    expect(r.itens[0]!.resultado).toBe('enviada');
    expect(h.enviados).toHaveLength(1);
    // Simula nova queda: voltou a ficar presa depois da nova tentativa.
    h.estado.set('ficha_card:1', { value: { estado: 'reservada', retry: true, em: ATRAS(9) }, updated_at: ATRAS(9) });
    r = await rodar();
    expect(r.itens[0]).toMatchObject({ resultado: 'presa_avisada', destino: 'dono' });
    expect(h.enviados[1]!.tel).toBe('34991360223');
    expect(h.enviados[1]!.texto).toContain('card 1');
    expect(h.enviados[1]!.texto).not.toMatch(/Camila|9111/);
    expect((await rodar()).itens[0]!.resultado).toBe('ja_tratado');
    expect(h.enviados).toHaveLength(2);
    delete process.env.RESUMO_DIA_WHATS;
  });

  it('reserva "reservada" recente (menos de 5 min) é de outro chamador: não mexe', async () => {
    h.agend.push(novoCard(1));
    h.estado.set('ficha_card:1', { value: { estado: 'reservada', em: ATRAS(2) }, updated_at: ATRAS(2) });
    expect((await rodar()).itens[0]!.resultado).toBe('ja_tratado');
    expect(h.enviados).toEqual([]);
  });

  it('ficha_lead leva o consultor: o repasse para outro consultor recebe a sua ficha', async () => {
    h.agend.push(novoCard(1), novoCard(2, { created_at: ATRAS(4), vendedor_nome: 'Thiago' }));
    await rodar(); await rodar();
    expect(h.enviados.map(e => e.tel)).toEqual(['34991172222', '34991360223']);
  });

  it('IA fora: a ficha enviada e gravada é a de campos', async () => {
    h.agend.push(novoCard(1));
    h.conversa.msgs = [{ id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'Oi, quero saber do posto', tipo: 'texto', media_url: null, momment: ATRAS(6) }];
    h.ia.modo = 'fora';
    const r = await rodar();
    expect(h.ia.chamadas).toBe(1);
    expect(r.itens[0]!.origem_da_ficha).toBe('campos');
    expect(h.enviados[0]!.texto).toContain('Ponto - Tenho o local');
  });

  it('IA no ar com texto hostil: o que chega ao consultor e ao card passa pelo blocoSeguro', async () => {
    h.agend.push(novoCard(1));
    h.conversa.msgs = [{ id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: ATRAS(6) }];
    h.ia.modo = 'ok';
    h.ia.texto = JSON.stringify({
      linhas: ['Cliente animado 😀 — quer fechar já', 'NOTA 1 · 3/11 pts com 20 carros/dia', 'Veja http://golpe.example/abre'],
      abertura: 'Camila, tudo bem?',
    });
    const r = await rodar();
    expect(r.itens[0]!.origem_da_ficha).toBe('ia');
    const enviado = h.enviados[0]!.texto;
    expect(enviado).not.toMatch(/😀|[—–]|golpe|carros\/dia|NOTA 1 ·/);
    const soBloco = String(h.agend[0]!.observacao).slice(String(h.agend[0]!.observacao).indexOf('FICHA 5040'));
    for (const [nome, re] of GATILHO) expect(re.test(soBloco), `${nome} casou o bloco da IA`).toBe(false);
  });

  it('?dry=1: só ids e estado (nada de nome, cidade ou campo), sem IA, sem reserva, sem gravar e sem enviar', async () => {
    h.agend.push(novoCard(1), novoCard(2, { cliente_telefone: '5534988881111', created_at: ATRAS(4) }));
    h.estado.set('aviso_antigo:2', { value: {}, updated_at: ATRAS(3) });
    h.conversa.msgs = [{ id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: ATRAS(6) }];
    h.ia.modo = 'ok';
    const antes = JSON.stringify([...h.estado.entries()]);
    const r = await rodar({ dry: true });
    expect(r.itens).toEqual([{ id: 2, resultado: 'aviso_antigo' }, { id: 1, resultado: 'pendente' }]);
    expect(JSON.stringify(r)).not.toMatch(/Camila|Uberl|Posto|9111|Ficha /);
    expect(h.ia.chamadas).toBe(0);
    expect(h.enviados).toEqual([]);
    expect(h.eventos).toEqual([]);
    expect(JSON.stringify([...h.estado.entries()])).toBe(antes);
    expect(h.agend[0]!.observacao).not.toContain('FICHA 5040');
  });

  it('sem segredo de HMAC: nada roda', async () => {
    delete process.env.AGENTES5040_HMAC;
    const velha = process.env.SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_KEY;
    h.agend.push(novoCard(1));
    const r = await rodar();
    expect(r.rodou).toBe(false);
    expect(h.enviados).toEqual([]);
    if (velha !== undefined) process.env.SUPABASE_SERVICE_KEY = velha;
  });
});

// ── a estrutura dos arquivos ─────────────────────────────────────────────────

describe('estrutura: quem envia e como', () => {
  it('fichaEnvio.ts é o único arquivo da ficha que importa o zapiClient', () => {
    expect(fonte('fichaEnvio.ts')).toMatch(/from '\.\.\/agents\/zapiClient'/);
    for (const arq of ['chaves.ts', 'ficha.ts', 'fichaTick.ts', 'hmac.ts', 'relogio.ts']) {
      expect(fonte(arq), arq).not.toMatch(/from '[^']*zapiClient'/);
    }
  });

  it('sem Promise.all nem Promise.allSettled no envio e na rodada (um consultor por vez)', () => {
    for (const arq of ['fichaEnvio.ts', 'fichaTick.ts', 'ficha.ts']) expect(fonte(arq), arq).not.toMatch(/Promise\.all/);
  });

  it('o envio usa a instância io e UMA bolha', () => {
    expect(fonte('fichaEnvio.ts')).toMatch(/sendWhatsApp\(tel, corpo, 'io'\)/);
  });

  it('a ficha nunca grava ia_falha:', () => {
    for (const arq of ['ficha.ts', 'fichaTick.ts', 'fichaEnvio.ts']) {
      const semComentario = fonte(arq).split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(semComentario, arq).not.toMatch(/ia_falha/);
    }
  });
});

// ── as provas ────────────────────────────────────────────────────────────────

describe('?sonda=1: escreve num card de verdade, compara e restaura', () => {
  it('card de eletroposto: derivadas e guardadas iguais, primeira linha igual, idempotente, restaurado', async () => {
    h.gatilho = 'real';
    h.agend.push(novoCard(30, { nota: 3, perfil_slug: 'posto', tem_ponto: null, repassar_em: '2026-10-22T10:00:00Z' }));
    const original = h.agend[0]!.observacao;
    const r = await sondaFichaNoCard(30);
    expect(r.ok).toBe(true);
    expect(r.trigger_aplica).toBe(true);
    expect(r.passos).toMatchObject({
      escreveu: true, primeira_linha_igual: true, corpo_original_igual: true, bloco_no_fim: true,
      derivadas_iguais: true, guardadas_iguais: true, idempotente: true, restaurado: true,
    });
    expect(h.agend[0]!.observacao).toBe(original);
    expect(h.agend[0]!.nota).toBe(3);
  });

  it('controle negativo: se o gatilho lesse a ficha, a sonda reprova E devolve a coluna ao que era (nulo inclusive)', async () => {
    h.gatilho = 'malvado';
    h.agend.push(novoCard(31, { nota: null }));
    const original = h.agend[0]!.observacao;
    const r = await sondaFichaNoCard(31);
    expect(r.ok).toBe(false);
    expect(r.passos.derivadas_iguais).toBe(false);
    expect(r.passos.restaurado).toBe(true);
    expect(h.agend[0]!.nota).toBeNull();
    expect(h.agend[0]!.observacao).toBe(original);
  });

  it('card que não existe: erro dito, nada escrito', async () => {
    const r = await sondaFichaNoCard(999);
    expect(r.ok).toBe(false);
    expect(r.passos.motivo).toBe('card_nao_existe');
    expect(h.eventos).not.toContain('grava_card');
  });
});

describe('?teste=1 e ?dry=1 com o interruptor desligado', () => {
  it('teste: uma ficha inventada, uma bolha, SÓ para o destino passado, sem reserva e sem card', async () => {
    process.env.AGENTES5040_FICHA = '0';
    const r = await enviarFichaDeTeste('34991360223', AGORA);
    expect(r.enviado).toBe(true);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]).toMatchObject({ tel: '34991360223', inst: 'io' });
    expect(h.enviados[0]!.texto).toContain('Ficha Eletroposto · Marcos (teste), Uberaba');
    expect(h.enviados[0]!.texto).toContain('ficha de teste');
    expect([...h.estado.keys()].filter(k => k.startsWith('ficha_card:'))).toEqual([]);
  });

  it('dry: mostra o que faria mesmo desligado, sem escrever nada', async () => {
    process.env.AGENTES5040_FICHA = '0';
    h.agend.push(novoCard(1));
    const antes = JSON.stringify([...h.estado.entries()]);
    const r = await rodar({ dry: true });
    expect(r).toMatchObject({ ligada: false, dry: true });
    expect(r.itens[0]).toEqual({ id: 1, resultado: 'pendente' });
    expect(JSON.stringify([...h.estado.entries()])).toBe(antes);
    expect(h.enviados).toEqual([]);
  });
});

describe('blocoSeguro: dado pessoal e rótulos', () => {
  it('tira CPF, CNPJ, e-mail, telefone e qualquer sequência de 8+ dígitos; deixa valores e horários', () => {
    const [l] = blocoSeguro(['Cliente diz: cpf 123.456.789-09, mail joao.silva@exemplo.com, zap (34) 99111-3333 e 34991113333, conta de R$ 1.350 e reunião 14h30, 9/11 pts']);
    expect(l).not.toMatch(/123\.456|@|99111|34991113333/);
    expect(l).toContain('R$ 1.350');
    expect(l).toContain('14h30');
    expect(l).toContain('9/11 pts');
    expect(blocoSeguro(['Cadastro 12345678 e 12.345.678/0001-90'])[0]).not.toMatch(/\d{8}|0001/);
  });

  it('"Endereco:" sem cedilha também é neutralizado', () => {
    expect(blocoSeguro(['Endereco: Rua A, 10'])[0]).toBe('· Endereco - Rua A, 10');
  });
});

describe('escreverFichaNoCard com observação longa', () => {
  it('acima de 1500 caracteres o texto NÃO vai na URL (nenhum .eq("observacao", ...)): lê, confere, grava por id e confere', async () => {
    const longa = 'LP SOLAR — Casa\n' + Array.from({ length: 60 }, (_, i) => `Campo ${i}: ${'x'.repeat(40)}`).join('\n');
    expect(longa.length).toBeGreaterThan(LIMITE_OBSERVACAO_NA_URL);
    h.agend.push(novoCard(50, { observacao: longa }));
    const r = await escreverFichaNoCard(50, ['· Ficha']);
    expect(r).toMatchObject({ ok: true, jaEstava: false });
    expect(h.eqObs).toEqual([]);
    expect(h.agend[0]!.observacao).toContain('FICHA 5040\n· Ficha\nFIM DA FICHA');
    expect(semBloco(h.agend[0]!.observacao)).toBe(longa);
  });

  it('longa e alguém mexe entre a leitura e a conferência: lê de novo e a edição dele sobrevive', async () => {
    const longa = 'Primeira linha\n' + 'y'.repeat(1600);
    h.agend.push(novoCard(51, { observacao: longa }));
    h.aoLer = (n) => { if (n === 1) h.agend[0]!.observacao += '\nnota nova'; };
    const real = h.agend[0]!;
    const r = await escreverFichaNoCard(51, ['· Ficha']);
    expect(r.ok).toBe(true);
    expect(real.observacao).toContain('nota nova');
    expect(real.observacao).toContain('FICHA 5040');
    expect(h.eqObs).toEqual([]);
  });
});

describe('?teste=1 reserva a faixa de 15 minutos', () => {
  it('a segunda chamada na mesma faixa não envia; em outra faixa envia', async () => {
    const a = await enviarFichaDeTeste('34991360223', AGORA);
    expect(a.enviado).toBe(true);
    expect([...h.estado.keys()].some(k => k.startsWith('ficha_teste:'))).toBe(true);
    const b = await enviarFichaDeTeste('34991360223', new Date(AGORA.getTime() + 60_000));
    expect(b).toMatchObject({ enviado: false, motivo: 'ja_enviado_nesta_faixa' });
    expect(h.enviados).toHaveLength(1);
    const c = await enviarFichaDeTeste('34991360223', new Date(AGORA.getTime() + 16 * 60_000));
    expect(c.enviado).toBe(true);
  });
});

describe('janela de 6 horas e card perdido', () => {
  it('um card de 5 h ainda está na janela e sai; rajada de 3 cards sai um por rodada', async () => {
    h.agend.push(novoCard(1, { created_at: ATRAS(300) }));
    expect((await rodar()).itens[0]).toMatchObject({ id: 1, resultado: 'enviada' });
  });

  it('card coberto que saiu da janela (6 a 7 h) sem reserva nem marca: o dono é avisado UMA vez, só com o id', async () => {
    process.env.RESUMO_DIA_WHATS = '34991360223';
    h.agend.push(novoCard(9, { created_at: ATRAS(380) }));
    const r = await rodar();
    expect(r.itens).toEqual([{ id: 9, resultado: 'perdido_avisado', destino: 'dono' }]);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.tel).toBe('34991360223');
    expect(h.enviados[0]!.texto).toContain('card 9');
    expect(h.enviados[0]!.texto).not.toMatch(/Camila|9111/);
    expect(h.estado.has('ficha_perdido:9')).toBe(true);
    await rodar();
    expect(h.enviados).toHaveLength(1);
    delete process.env.RESUMO_DIA_WHATS;
  });

  it('com reserva da ficha ou marca do aviso antigo, não é perdido; fora da hora de folga também não', async () => {
    h.agend.push(
      novoCard(1, { created_at: ATRAS(380) }), novoCard(2, { created_at: ATRAS(381), cliente_telefone: '5534988881111' }),
      novoCard(3, { created_at: ATRAS(500), cliente_telefone: '5534988882222' }),
    );
    h.estado.set('ficha_card:1', { value: { estado: 'enviada' }, updated_at: ATRAS(370) });
    h.estado.set('aviso_antigo:2', { value: {}, updated_at: ATRAS(380) });
    const r = await rodar();
    expect(r.itens).toEqual([]);
    expect(h.enviados).toEqual([]);
  });

  it('?dry=1 lista o perdido só por id e estado', async () => {
    h.agend.push(novoCard(9, { created_at: ATRAS(380) }));
    const r = await rodar({ dry: true });
    expect(r.itens).toEqual([{ id: 9, resultado: 'perdido' }]);
    expect(h.enviados).toEqual([]);
    expect(h.estado.has('ficha_perdido:9')).toBe(false);
  });

  it('interruptor desligado: nem o aviso de perdido sai', async () => {
    process.env.AGENTES5040_FICHA = '0';
    h.agend.push(novoCard(9, { created_at: ATRAS(380) }));
    await rodar();
    expect(h.enviados).toEqual([]);
  });
});


describe('número de TESTE: a ficha vai só ao celular do dono (correção 15 do B1d-2)', () => {
  const alvo = (hmacs: string[], kid: string | null = idChaveHmac()): void => {
    h.estado.set(CHAVE_VIVO_ALVO, { value: { kid, hmacs, modos: {}, atualizado_em: ATRAS(60) }, updated_at: ATRAS(60) });
    zerarCacheInterruptores();
  };

  it('card de lead cujo hmac está na lista de teste: a ficha sai para o dono, nunca para a consultora', async () => {
    h.agend.push(novoCard(1));                                           // vendedor Diego, com telefone na tabela
    alvo([hmacDe('3491113333')!]);
    const r = await rodar();
    expect(r.itens[0]).toMatchObject({ id: 1, resultado: 'enviada', destino: 'dono' });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0]!.tel).toBe('34991360223');                      // o celular do dono (padrão do telefoneDoDono)
    expect(h.enviados[0]!.tel).not.toBe('34991172222');
    expect(h.enviados[0]!.texto).toContain('Lead de teste');
  });

  it('lead que NÃO está na lista (ou kid trocado) segue para a consultora', async () => {
    h.agend.push(novoCard(1));
    alvo([hmacDe('3499999999')!]);
    await rodar();
    expect(h.enviados[0]!.tel).toBe('34991172222');
    h.enviados.length = 0; h.estado.clear(); h.agend.length = 0; h.agend.push(novoCard(2, { cliente_telefone: '5534991113333' }));
    alvo([hmacDe('3491113333')!], 'outro-kid');
    await rodar();
    expect(h.enviados[0]!.tel).toBe('34991172222');
  });

  it('alvo ilegível no fichaTick: destino normal (a ficha de lead de verdade não pode ir parar no dono)', async () => {
    h.agend.push(novoCard(1));
    await rodar();
    expect(h.enviados[0]!.tel).toBe('34991172222');
  });

  it('leadEhDeTeste: true na lista, false fora dela e sem chave, e mesma chave de hmac do kid', async () => {
    alvo([hmacDe('3491113333')!]);
    expect(await leadEhDeTeste('3491113333')).toBe(true);
    expect(await leadEhDeTeste('3400000000')).toBe(false);
    expect(await leadEhDeTeste('')).toBe(false);
    expect(await leadEhDeTeste(null)).toBe(false);
  });
});
