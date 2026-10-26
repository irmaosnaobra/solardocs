import { describe, it, expect, vi, beforeEach } from 'vitest';

// O robô da Carla do quiz do SolarDoc (B2, 24/10/2026): regras puras, estado (liga e desliga) e a rodada inteira sobre dependências falsas.
// Nada aqui toca banco, Z-API nem relógio de verdade.

const h = vi.hoisted(() => ({
  /** system_state.quiz_rec_pausa / quiz_rec_largada: undefined = linha inexistente; 'erro' = a leitura falha. */
  pausa: undefined as unknown,
  largada: undefined as unknown,
  /** wa_mudos (rpc): as linhas { telefone } que o banco devolveria; 'erro' = a rpc falha. */
  mudos: [] as Array<{ telefone: string }> | 'erro',
  rpcs: [] as Array<{ nome: string; args: unknown }>,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_c: string, chave: string) => ({
          maybeSingle: async () => {
            const v = chave === 'quiz_rec_pausa' ? h.pausa : h.largada;
            if (v === 'erro') return { data: null, error: { message: 'falhou' } };
            return { data: v === undefined ? null : { value: v }, error: null };
          },
        }),
      }),
      insert: async () => ({ error: null }),
    }),
    rpc: (nome: string, args: unknown) => {
      h.rpcs.push({ nome, args });
      return { range: async () => (h.mudos === 'erro' ? { data: null, error: { message: 'falhou' } } : { data: h.mudos, error: null }) };
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  runQuizRecuperacaoTick, depsAvaliarReais, avaliarLead, type DepsRec, type RelatorioRec,
} from '../services/solardoc/recuperacaoCarla';
import { estadoRecuperacaoCarla, envDesligaRecuperacao } from '../services/solardoc/recuperacaoCarlaEstado';
import {
  ordenarFila, semCnpj, foraDoTempo, textoDaCarla, chaveVezRec, FRASE_DO_MOTIVO, type LeadRec,
} from '../services/solardoc/recuperacaoCarlaRegras';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';
import { chaveContato } from '../services/agents/whatsapp/silenciar';

// Quarta-feira, 21/10/2026, 14:00 em Brasília (17:00Z): dentro da janela.
const AGORA = new Date('2026-10-21T17:00:00.000Z');
const min = (n: number): string => new Date(AGORA.getTime() - n * 60_000).toISOString();

const campos = (extra: Array<[string, string[]]> = []) => [
  ['Código', ['SD-AB23']], ['Índice', ['37']], ['Pilar mais fraco', ['Velocidade']], ['Faltam', ['tem_marca', 'economia_25']],
  ['Empresa', ['Solar Andrade']], ['cnpj', ['sim']], ['quando_comecar', ['semana']], ['lp_session', ['lp-1']],
  ...extra,
].map(([name, values]) => ({ name, values }));

let seq = 0;
/** Um lead do quiz com telefone distinto. */
const lead = (over: Partial<LeadRec> = {}, extra: Array<[string, string[]]> = []): LeadRec => {
  seq++;
  return {
    lead_id: `sdquiz_${seq}`, nome: 'carlos andrade', whatsapp: `5534998${String(100000 + seq)}`, cidade: 'Uberlândia-MG',
    created_time: min(30), field_data: campos(extra), ...over,
  };
};
const comCampo = (nome: string, valor: string): Array<[string, string[]]> => [[nome, [valor]]];
const semCampo = (l: LeadRec, nome: string): LeadRec => ({ ...l, field_data: (l.field_data as Array<{ name: string }>).filter(c => c.name !== nome) });
const trocaCampo = (l: LeadRec, nome: string, valor: string): LeadRec => ({
  ...l, field_data: (l.field_data as Array<{ name: string; values: string[] }>).map(c => (c.name === nome ? { name: nome, values: [valor] } : c)),
});

beforeEach(() => {
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  delete process.env.AGENTES5040_HMAC;
  delete process.env.QUIZ_RECUPERACAO_LIGADA;
  h.pausa = undefined; h.largada = undefined; h.mudos = []; h.rpcs = [];
  seq = 0;
});

// ── dependências falsas ──────────────────────────────────────────────────────

interface Espiao {
  chamadas: string[]; enviados: Array<{ tel: string; texto: string }>; avisos: Array<{ tipo: string; arg: string }>; claims: Set<string>;
  marcas: Array<{ chave: string; valor: Record<string, unknown> }>;
}

function falsas(leads: LeadRec[], over: Partial<DepsRec> = {}, esp?: Partial<Espiao>): { d: DepsRec; e: Espiao } {
  const e: Espiao = { chamadas: [], enviados: [], avisos: [], claims: new Set(), marcas: [], ...esp };
  const reg = (n: string): void => { e.chamadas.push(n); };
  const d: DepsRec = {
    estado: async () => ({ ligada: true, motivo: 'ligada' }),
    segredoOk: () => true,
    garantirLargada: async () => AGORA.getTime() - 24 * 3600_000,
    janela: () => { reg('janela'); return true; },
    linhaPausada: async () => { reg('pausa'); return 'nao'; },
    tetoHorario: async () => { reg('teto'); return true; },
    espacamento: async () => { reg('espacamento'); return true; },
    tomarVez: async () => 'tomada',
    limparVezes: async () => undefined,
    leads: async () => leads,
    existentes: async (chaves) => new Set(chaves.filter(c => e.claims.has(c))),
    vendas: async () => ({ sessoes: new Set(), chaves: new Set() }),
    compra: async () => false,
    posse: async () => 'livre',
    conversa: async () => ({ msgs: [], completa: true }),
    mensagemComCodigo: async () => false,
    podeFalar: async () => 'sim',
    supressao: async () => [],
    mudo: async () => 'nao',
    telefoneExiste: async () => 'sim',
    claim: async (c) => { if (e.claims.has(c)) return 'ja'; e.claims.add(c); reg('claim'); return 'ok'; },
    apagarClaim: async (c) => { e.claims.delete(c); reg('apagarClaim'); },
    marcarClaim: async (chave, valor) => { reg('marcarClaim'); e.marcas.push({ chave, valor }); },
    assumirPosse: async () => { reg('assumirPosse'); return 'assumida'; },
    posseAindaNossa: async () => true,
    desfazerPosse: async () => { reg('desfazerPosse'); return true; },
    enviar: async (tel, texto) => { reg('enviar'); e.enviados.push({ tel, texto }); return true; },
    erroDeLinha: async () => { reg('erroDeLinha'); },
    envioOk: async () => { reg('envioOk'); },
    avisarSaiu: async (_l, hora) => { e.avisos.push({ tipo: 'saiu', arg: hora }); return 'pendente'; },
    avisarNaoChama: async (_l, frase) => { e.avisos.push({ tipo: 'nao_chama', arg: frase }); return 'pendente'; },
    avisarSemVaga: async () => { e.avisos.push({ tipo: 'sem_vaga', arg: '' }); return 'enviado'; },
    ...over,
  };
  return { d, e };
}

const rodar = (d: DepsRec, agora: Date = AGORA): Promise<RelatorioRec> => runQuizRecuperacaoTick({ agora }, d);

// ── regras puras ─────────────────────────────────────────────────────────────

describe('a fila e o tempo', () => {
  it('ordena por intenção (hoje, semana, mês, pesquisando) e, dentro dela, do mais antigo ao mais novo', () => {
    const q = (id: string, quando: string | null, minutos: number): LeadRec => {
      const l = lead({ lead_id: id, created_time: min(minutos) });
      return quando ? trocaCampo(l, 'quando_comecar', quando) : semCampo(l, 'quando_comecar');
    };
    const fila = ordenarFila([
      q('pesq', 'pesquisando', 20), q('mes', 'mes', 25), q('hoje-novo', 'hoje', 30), q('semana', 'semana', 10),
      q('sem-resposta', null, 90), q('hoje-antigo', 'hoje', 40),
    ]);
    expect(fila.map(l => l.lead_id)).toEqual(['hoje-antigo', 'hoje-novo', 'semana', 'mes', 'pesq', 'sem-resposta']);
  });
  it('sem CNPJ (abrindo, nao ou sem resposta) não entra', () => {
    expect(semCnpj(lead().field_data)).toBe(false);
    expect(semCnpj(lead({}, comCampo('cnpj', 'empregador')).field_data)).toBe(false);
    expect(semCnpj(trocaCampo(lead(), 'cnpj', 'abrindo').field_data)).toBe(true);
    expect(semCnpj(trocaCampo(lead(), 'cnpj', 'nao').field_data)).toBe(true);
    expect(semCnpj(semCampo(lead(), 'cnpj').field_data)).toBe(true);
  });
  it('espera mínima de 15 min e máxima de 48 h', () => {
    const t = AGORA.getTime();
    expect(foraDoTempo({ created_time: min(5) }, t)).toBe('cedo');
    expect(foraDoTempo({ created_time: min(15) }, t)).toBeNull();
    expect(foraDoTempo({ created_time: min(48 * 60) }, t)).toBeNull();
    expect(foraDoTempo({ created_time: min(48 * 60 + 1) }, t)).toBe('vencido');
    expect(foraDoTempo({ created_time: 'lixo' }, t)).toBe('cedo');
  });
  it('a vez de 10 min é uma chave por faixa', () => {
    expect(chaveVezRec(new Date('2026-10-21T17:00:00Z'))).toBe(chaveVezRec(new Date('2026-10-21T17:09:59Z')));
    expect(chaveVezRec(new Date('2026-10-21T17:00:00Z'))).not.toBe(chaveVezRec(new Date('2026-10-21T17:10:00Z')));
    expect(chaveVezRec(AGORA).startsWith('quiz_rec_vez:')).toBe(true);
  });
});

describe('o texto da Carla (POS.carla do protótipo)', () => {
  it('preenche nome, empresa, índice, pilar e o item que falta, sem campo vazio, sem link e sem travessão', () => {
    const t = textoDaCarla(lead());
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.texto).toBe('Oi, Carlos, aqui é a Carla, do SolarDoc. Olhei o diagnóstico da Solar Andrade e deu 37 de 100, com velocidade pesando mais. O que mais falta na sua proposta é a sua logo e a sua cor. Quer ver como fica a proposta da Solar Andrade no SolarDoc?');
    expect(t.texto).not.toMatch(/\[|\]|undefined|null|https?:|www\.|[–—]|\n/);
  });
  it('sem empresa vale "sua empresa"; sem item que falte, o texto de reserva', () => {
    const t = textoDaCarla(semCampo(semCampo(lead(), 'Empresa'), 'Faltam'));
    expect(t.ok && t.texto).toContain('da sua empresa e deu 37');
    expect(t.ok && t.texto).toContain('é o acompanhamento depois da proposta');
  });
  it('limpa o que a pessoa digitou (emoji, travessão) e recusa link', () => {
    const l = trocaCampo(lead({ nome: 'ANA — Souza' }), 'Empresa', 'Solar 🌞 Sul — Energia');
    const t = textoDaCarla(l);
    expect(t.ok && t.texto).toContain('Oi, Ana,');
    expect(t.ok && t.texto).toContain('Solar Sul - Energia');
    expect(t.ok && t.texto).not.toMatch(/🌞|—/);
    const comLink = textoDaCarla(trocaCampo(lead(), 'Empresa', 'Veja www.solar.com.br'));
    expect(comLink.ok && comLink.texto).toContain('da sua empresa');
    expect(textoDaCarla(lead({ nome: 'http://x.co' })).ok).toBe(false);
  });
  it('sem índice, sem pilar ou sem nome não há mensagem', () => {
    expect(textoDaCarla(semCampo(lead(), 'Índice')).ok).toBe(false);
    expect(textoDaCarla(semCampo(lead(), 'Pilar mais fraco')).ok).toBe(false);
    expect(textoDaCarla(lead({ nome: '' })).ok).toBe(false);
  });
});

// ── liga e desliga ───────────────────────────────────────────────────────────

describe('estadoRecuperacaoCarla', () => {
  it('nasce LIGADO', async () => {
    expect(await estadoRecuperacaoCarla({ env: {} })).toEqual({ ligada: true, motivo: 'ligada' });
  });
  it("a env '0' desliga; qualquer outro valor não liga nem desliga nada", async () => {
    expect((await estadoRecuperacaoCarla({ env: { QUIZ_RECUPERACAO_LIGADA: '0' } })).ligada).toBe(false);
    expect((await estadoRecuperacaoCarla({ env: { QUIZ_RECUPERACAO_LIGADA: ' 0 ' } })).motivo).toBe('env_desligada');
    for (const v of ['1', 'true', 'sim', '', 'off', '00']) {
      expect(envDesligaRecuperacao({ QUIZ_RECUPERACAO_LIGADA: v })).toBe(false);
      expect((await estadoRecuperacaoCarla({ env: { QUIZ_RECUPERACAO_LIGADA: v } })).ligada).toBe(true);
    }
    // e a env nunca liga o que o banco pausou
    h.pausa = { motivo: 'dono' };
    expect((await estadoRecuperacaoCarla({ env: { QUIZ_RECUPERACAO_LIGADA: '1' } })).ligada).toBe(false);
  });
  it('a chave quiz_rec_pausa no banco desliga; com `ate` vencido a pausa expirou', async () => {
    h.pausa = { motivo: 'dono' };
    expect(await estadoRecuperacaoCarla({ env: {} })).toEqual({ ligada: false, motivo: 'pausa_no_banco' });
    h.pausa = { ate: new Date(Date.now() + 3600_000).toISOString() };
    expect((await estadoRecuperacaoCarla({ env: {} })).ligada).toBe(false);
    h.pausa = { ate: new Date(Date.now() - 3600_000).toISOString() };
    expect((await estadoRecuperacaoCarla({ env: {} })).ligada).toBe(true);
    h.pausa = { ate: 'lixo' };
    expect((await estadoRecuperacaoCarla({ env: {} })).ligada).toBe(false);
  });
  it('leitura da chave que falha vale DESLIGADO', async () => {
    h.pausa = 'erro';
    expect(await estadoRecuperacaoCarla({ env: {} })).toEqual({ ligada: false, motivo: 'leitura_falhou' });
  });
});

// ── a rodada ─────────────────────────────────────────────────────────────────

describe('as travas, nesta ordem', () => {
  it('janela > pausa da linha > teto > espaçamento: a primeira que barra encerra e nada é reservado', async () => {
    const ordem = [
      ['janela', { janela: () => false }, 'fora_da_janela', ['janela']],
      ['pausa', { linhaPausada: async () => 'sim' as const }, 'linha_pausada', ['janela', 'pausa']],
      ['teto', { tetoHorario: async () => false }, 'teto_da_linha', ['janela', 'pausa', 'teto']],
      ['espaçamento', { espacamento: async () => false }, 'espacamento_da_linha', ['janela', 'pausa', 'teto', 'espacamento']],
    ] as const;
    for (const [, barra, motivo, vistas] of ordem) {
      const { d, e } = falsas([lead()]);
      // a trava que barra devolve o valor do caso; todas registram a chamada
      const b = barra as Record<string, (...a: never[]) => unknown>;
      if (b.janela) d.janela = () => { e.chamadas.push('janela'); return false; };
      if (b.linhaPausada) d.linhaPausada = async () => { e.chamadas.push('pausa'); return 'sim'; };
      if (b.tetoHorario) d.tetoHorario = async () => { e.chamadas.push('teto'); return false; };
      if (b.espacamento) d.espacamento = async () => { e.chamadas.push('espacamento'); return false; };
      const r = await rodar(d);
      expect(r.motivo).toBe(motivo);
      expect(r.enviou).toBe(false);
      expect(e.chamadas.filter(c => ['janela', 'pausa', 'teto', 'espacamento'].includes(c))).toEqual([...vistas]);
      expect(e.chamadas).not.toContain('claim');
      expect(e.enviados).toHaveLength(0);
    }
  });
  it('leitura da pausa que falha também barra', async () => {
    const { d } = falsas([lead()], { linhaPausada: async () => 'erro' });
    expect((await rodar(d)).motivo).toBe('leitura_da_pausa_falhou');
  });
  it('as quatro travas passam de novo logo antes do claim (o teto muda no meio da rodada)', async () => {
    let n = 0;
    const { d, e } = falsas([lead()], { tetoHorario: async () => ++n < 2 });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.puladas.teto_da_linha).toBe(1);
    expect(e.chamadas).not.toContain('claim');
  });
});

describe('quem entra e quem sai', () => {
  it('envia a mensagem da Carla pela linha, 1 bolha, e o aviso "falou às" entra pendente com a hora de Brasília', async () => {
    const { d, e } = falsas([lead()]);
    const r = await rodar(d);
    expect(r.enviou).toBe(true);
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.texto).toMatch(/^Oi, Carlos, aqui é a Carla, do SolarDoc\./);
    expect(e.avisos).toEqual([{ tipo: 'saiu', arg: '14:00' }]);
    // a ordem: travas, claim, posse, envio, depois o aviso
    expect(e.chamadas.filter(c => ['claim', 'assumirPosse', 'enviar', 'envioOk'].includes(c))).toEqual(['claim', 'assumirPosse', 'enviar', 'envioOk']);
  });
  it('UM envio por rodada, mesmo com vários leads elegíveis; a fila anda por intenção', async () => {
    const hoje = lead({ created_time: min(20) }, []);
    const mes = trocaCampo(lead({ created_time: min(45) }), 'quando_comecar', 'mes');
    const pesq = trocaCampo(lead({ created_time: min(60) }), 'quando_comecar', 'pesquisando');
    const semana = trocaCampo(lead({ created_time: min(35) }), 'quando_comecar', 'semana');
    const l1 = trocaCampo(hoje, 'quando_comecar', 'hoje');
    const { d, e } = falsas([pesq, mes, semana, l1]);
    const r = await rodar(d);
    expect(e.enviados).toHaveLength(1);
    expect(r.decisoes.filter(x => x.resultado === 'enviada')).toHaveLength(1);
    // o de "hoje" saiu primeiro: o hmac dele é o do claim
    const tel = normalizarTelefoneSd(l1.whatsapp)!;
    expect([...e.claims]).toEqual([`quiz_rec_sent:${hmacDe(chaveDoTelefone(tel))}`]);
  });
  it('sem CNPJ fica fora, vencido em 48 h sai, menos de 15 min espera, lead de teste nunca', async () => {
    const semcnpj = trocaCampo(lead(), 'cnpj', 'abrindo');
    const velho = lead({ created_time: min(49 * 60) });
    const cedo = lead({ created_time: min(5) });
    const teste = lead({}, comCampo('teste', 'sim'));
    const utm = lead({}, comCampo('utm_source', 'raio-x-teste'));
    const { d, e } = falsas([semcnpj, velho, cedo, teste, utm]);
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.candidatos).toBe(0);
    expect(e.enviados).toHaveLength(0);
  });
  it('só lead novo: o lead de antes da largada não entra (sem fila acumulada na largada)', async () => {
    const antigo = lead({ created_time: min(60) });
    const { d, e } = falsas([antigo], { garantirLargada: async () => AGORA.getTime() - 10 * 60_000 });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.puladas.antes_da_largada).toBe(1);
    expect(e.enviados).toHaveLength(0);
    // e na 1ª rodada (largada = agora) ninguém tem idade para entrar
    const { d: d2 } = falsas([lead({ created_time: min(30) })], { garantirLargada: async () => AGORA.getTime() });
    expect((await rodar(d2)).enviou).toBe(false);
  });
  it('quem já tem o carimbo quiz_rec_sent não entra; o aviso quiz_aviso só tira da fila sem a marca quiz_rec_ainda (B2.1)', async () => {
    const a = lead();
    const h1 = hmacDe(chaveDoTelefone(normalizarTelefoneSd(a.whatsapp)!))!;
    const b = lead();
    const h2 = hmacDe(chaveDoTelefone(normalizarTelefoneSd(b.whatsapp)!))!;
    const { d, e } = falsas([a, b], {}, { claims: new Set([`quiz_rec_sent:${h1}`, `quiz_aviso:${h2}`]) });
    const r = await rodar(d);
    expect(r.candidatos).toBe(0);
    expect(e.enviados).toHaveLength(0);
  });
  it('o time foi avisado (linha fechada ou 1 h sem vaga): com a marca quiz_rec_ainda a Carla ainda chama, e o aviso dela cai como duplicado', async () => {
    const l = lead();
    const hm = hmacDe(chaveDoTelefone(normalizarTelefoneSd(l.whatsapp)!))!;
    const { d, e } = falsas([l], {}, { claims: new Set([`quiz_aviso:${hm}`, `quiz_rec_ainda:${hm}`]) });
    const r = await rodar(d);
    expect(r.enviou).toBe(true);
    expect(e.enviados).toHaveLength(1);
    // o aviso do robô sempre pede o claim quiz_aviso:<hmac>; ele já existe, então não sai um segundo (ver avisoGrupoSolardoc.test.ts)
    expect(e.avisos).toEqual([{ tipo: 'saiu', arg: '14:00' }]);
  });
  it('claim único: o claim que já existe (outra chamada ganhou) não envia de novo', async () => {
    const l = lead();
    const { d, e } = falsas([l], { claim: async () => 'ja' });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.puladas.ja_reivindicado).toBe(1);
    expect(e.enviados).toHaveLength(0);
    // duas chamadas em paralelo: só uma ganha o claim
    const { d: d2, e: e2 } = falsas([l]);
    await Promise.all([rodar(d2), rodar(d2)]);
    expect(e2.enviados.length).toBeLessThanOrEqual(2);
    expect(e2.chamadas.filter(c => c === 'claim')).toHaveLength(1);
  });
});

describe('antes do claim: compra, posse, já falou, supressão, phone-exists', () => {
  it('comprou: não envia', async () => {
    const { d, e } = falsas([lead()], { compra: async () => true });
    const r = await rodar(d);
    expect(r.puladas.comprou).toBe(1);
    expect(e.enviados).toHaveLength(0);
  });
  it('compra que não dá para ler: não envia', async () => {
    const { d } = falsas([lead()], { compra: async () => { throw new Error('x'); } });
    expect((await rodar(d)).puladas.leitura_falhou).toBe(1);
  });
  it('posse de qualquer dona: não envia, e posse ilegível também não', async () => {
    const a = falsas([lead()], { posse: async () => 'ocupada' });
    expect((await rodar(a.d)).puladas.posse).toBe(1);
    const b = falsas([lead()], { posse: async () => 'erro' });
    expect((await rodar(b.d)).puladas.leitura_falhou).toBe(1);
  });
  it('quem já falou com a linha (qualquer mensagem from_me=false) NUNCA recebe', async () => {
    const { d, e } = falsas([lead()], { conversa: async () => ({ msgs: [{ id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: min(100) } as any], completa: true }) });
    const r = await rodar(d);
    expect(r.puladas.ja_falou).toBe(1);
    expect(e.chamadas).not.toContain('claim');
    expect(e.enviados).toHaveLength(0);
  });
  it('só fala nossa (humano pelo celular) na conversa: também fica fora', async () => {
    const { d } = falsas([lead()], { conversa: async () => ({ msgs: [{ id: 2, from_me: true, from_api: false, autor: 'equipe', texto: 'oi', tipo: 'texto', media_url: null, momment: min(100) } as any], completa: true }) });
    expect((await rodar(d)).puladas.humano_na_conversa).toBe(1);
  });
  it('LID sem mapa conta como já falou: o código do quiz numa mensagem recebida acha o caso', async () => {
    const vistos: string[] = [];
    const { d, e } = falsas([lead()], { mensagemComCodigo: async (codigo) => { vistos.push(codigo); return true; } });
    const r = await rodar(d);
    expect(vistos).toEqual(['SD-AB23']);
    expect(r.puladas.ja_falou).toBe(1);
    expect(e.enviados).toHaveLength(0);
  });
  it('conversa incompleta (lista de LIDs cortada ou banco falhou) vale "falou"; a busca do código que falha também', async () => {
    const a = falsas([lead()], { conversa: async () => ({ msgs: [], completa: false }) });
    expect((await rodar(a.d)).puladas.leitura_falhou).toBe(1);
    const b = falsas([lead()], { mensagemComCodigo: async () => 'erro' });
    expect((await rodar(b.d)).puladas.leitura_falhou).toBe(1);
    expect(a.e.enviados.length + b.e.enviados.length).toBe(0);
  });
  it('pausa humana, opt-out e qualquer registro de supressão calam; leitura que falha também', async () => {
    expect((await rodar(falsas([lead()], { podeFalar: async () => 'nao' }).d)).puladas.humano_na_conversa).toBe(1);
    expect((await rodar(falsas([lead()], { podeFalar: async () => 'erro' }).d)).puladas.leitura_falhou).toBe(1);
    expect((await rodar(falsas([lead()], { supressao: async () => ['opt_out'] }).d)).puladas.suprimido).toBe(1);
    expect((await rodar(falsas([lead()], { supressao: async () => ['nunca_respondeu'] }).d)).puladas.suprimido).toBe(1);
    expect((await rodar(falsas([lead()], { supressao: async () => null }).d)).puladas.leitura_falhou).toBe(1);
  });
  it('mudo (wa_mudos de verdade, 3 toques em 60 dias, estrito): sai da fila com o motivo "mudo"; a lista é lida uma vez por rodada', async () => {
    const mudo = lead();
    const falante = lead();
    h.mudos = [{ telefone: chaveContato(normalizarTelefoneSd(mudo.whatsapp)!)! }];
    const reais = depsAvaliarReais();
    const a = falsas([mudo, falante], { mudo: reais.mudo });
    const ra = await rodar(a.d);
    expect(ra.puladas.mudo).toBe(1);
    expect(ra.decisoes[0]).toMatchObject({ resultado: 'pulou', motivo: 'mudo' });
    expect(ra.enviou).toBe(true);   // o outro lead, que não é mudo, recebe
    expect(a.e.enviados).toHaveLength(1);
    expect(a.e.enviados[0]!.tel).toBe(falante.whatsapp);
    expect(h.rpcs).toEqual([{ nome: 'wa_mudos', args: { min_toques: 3, dias: 60 } }]);
    // rpc que falha: leitura_falhou, nunca "pode falar"
    h.mudos = 'erro';
    const b = falsas([lead()], { mudo: depsAvaliarReais().mudo });
    const rb = await rodar(b.d);
    expect(rb.puladas.leitura_falhou).toBe(1);
    expect(b.e.enviados).toHaveLength(0);
  });
  it('avaliarLead devolve o motivo "mudo" com a frase para o grupo', async () => {
    const l = lead();
    h.mudos = [{ telefone: chaveContato(normalizarTelefoneSd(l.whatsapp)!)! }];
    const { d } = falsas([l], { mudo: depsAvaliarReais().mudo });
    const av = await avaliarLead(l, { agoraMs: AGORA.getTime(), largadaMs: AGORA.getTime() - 24 * 3600_000, vendas: { sessoes: new Set(), chaves: new Set() } }, d);
    expect(av).toEqual({ ok: false, motivo: 'mudo' });
    expect(FRASE_DO_MOTIVO.mudo).toBe('A Carla não vai chamar: ele não respondeu aos últimos toques da linha.');
  });
  it('phone-exists: sem WhatsApp não envia e o grupo é avisado; erro de consulta para a rodada', async () => {
    const a = falsas([lead()], { telefoneExiste: async () => 'nao' });
    const ra = await rodar(a.d);
    expect(ra.enviou).toBe(false);
    expect(a.e.avisos).toEqual([{ tipo: 'nao_chama', arg: FRASE_DO_MOTIVO.sem_whatsapp }]);
    const b = falsas([lead()], { telefoneExiste: async () => 'erro' });
    const rb = await rodar(b.d);
    expect(rb.puladas.phone_exists_falhou).toBe(1);
    expect(b.e.enviados).toHaveLength(0);
    expect(b.e.avisos).toHaveLength(0);
  });
  it('a ordem das conferências: compra antes de posse, posse antes de já falou, já falou antes de supressão, mudo depois, e phone-exists por último', async () => {
    const vistas: string[] = [];
    const { d } = falsas([lead()], {
      compra: async () => { vistas.push('compra'); return false; },
      posse: async () => { vistas.push('posse'); return 'livre'; },
      conversa: async () => { vistas.push('conversa'); return { msgs: [], completa: true }; },
      podeFalar: async () => { vistas.push('podeFalar'); return 'sim'; },
      supressao: async () => { vistas.push('supressao'); return []; },
      mudo: async () => { vistas.push('mudo'); return 'nao'; },
      telefoneExiste: async () => { vistas.push('phone-exists'); return 'sim'; },
    });
    await rodar(d);
    expect(vistas.slice(0, 7)).toEqual(['compra', 'posse', 'conversa', 'podeFalar', 'supressao', 'mudo', 'phone-exists']);
  });
});

describe('antes de enviar: estado, posse e releitura', () => {
  it('a chave do banco é lida antes de CADA envio: desligou no meio da rodada, não envia', async () => {
    let n = 0;
    const { d, e } = falsas([lead()], { estado: async () => (++n === 1 ? { ligada: true, motivo: 'ligada' } : { ligada: false, motivo: 'pausa_no_banco' }) });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(e.chamadas).not.toContain('claim');
    expect(n).toBe(2);
  });
  it('estado desligado ou chave que não lê: a rodada nem começa', async () => {
    for (const motivo of ['env_desligada', 'pausa_no_banco', 'leitura_falhou'] as const) {
      const { d, e } = falsas([lead()], { estado: async () => ({ ligada: false, motivo }) });
      const r = await rodar(d);
      expect(r.ligada).toBe(false);
      expect(r.motivo).toBe(motivo);
      expect(e.chamadas).toEqual([]);
    }
  });
  it('a posse da Carla é assumida antes do envio', async () => {
    const { d, e } = falsas([lead()]);
    await rodar(d);
    expect(e.chamadas.indexOf('assumirPosse')).toBeGreaterThan(e.chamadas.indexOf('claim'));
    expect(e.chamadas.indexOf('assumirPosse')).toBeLessThan(e.chamadas.indexOf('enviar'));
  });
  it('posse tomada por outro no meio: apaga o claim e não envia', async () => {
    const { d, e } = falsas([lead()], { assumirPosse: async () => 'ja_tinha_dona' });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(e.claims.size).toBe(0);
    expect(e.chamadas).not.toContain('desfazerPosse');
    expect(e.enviados).toHaveLength(0);
  });
  it('a releitura acha mensagem nova: desfaz a posse, apaga o claim e NÃO envia', async () => {
    let n = 0;
    const nova = { id: 9, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: min(0) } as any;
    const { d, e } = falsas([lead()], { conversa: async () => ({ msgs: ++n >= 2 ? [nova] : [], completa: true }) });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(r.puladas.releitura_ja_falou).toBe(1);
    expect(e.chamadas).toContain('assumirPosse');
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.claims.size).toBe(0);
    expect(e.enviados).toHaveLength(0);
    expect(e.avisos).toHaveLength(0);
  });
  it('a releitura acha humano (pausa) ou a posse perdida: também aborta', async () => {
    let n = 0;
    const a = falsas([lead()], { podeFalar: async () => (++n >= 2 ? 'nao' : 'sim') });
    expect((await rodar(a.d)).puladas.releitura_humano_na_conversa).toBe(1);
    expect(a.e.enviados).toHaveLength(0);
    const b = falsas([lead()], { posseAindaNossa: async () => false });
    expect((await rodar(b.d)).puladas.releitura_posse_perdida).toBe(1);
    expect(b.e.chamadas).toContain('desfazerPosse');
  });
});

describe('o sendFrio voltou sem enviar (pausa humana calou)', () => {
  it('enviar devolve false: sem aviso "falou às", posse nova desfeita, carimbo FICA marcado nao_saiu e a rodada para', async () => {
    const outro = lead();
    const { d, e } = falsas([lead(), outro], { enviar: async () => false });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(e.avisos).toHaveLength(0);
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).not.toContain('envioOk');
    expect(e.chamadas).not.toContain('apagarClaim');
    expect(e.chamadas.filter(c => c === 'claim')).toHaveLength(1);   // parou: o 2º lead nem foi tentado
    expect(e.claims.size).toBe(1);
    expect(e.marcas).toHaveLength(1);
    expect(e.marcas[0]!.chave).toMatch(/^quiz_rec_sent:/);
    expect(e.marcas[0]!.valor).toMatchObject({ estado: 'nao_saiu' });
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'nao_enviou', motivo: 'envio_nao_saiu' });
  });
  it('retorno que não prova envio (undefined) também vale "não saiu"; o caminho feliz segue igual', async () => {
    const a = falsas([lead()], { enviar: (async () => undefined) as unknown as DepsRec['enviar'] });
    expect((await rodar(a.d)).enviou).toBe(false);
    expect(a.e.avisos).toHaveLength(0);
    const b = falsas([lead()]);
    expect((await rodar(b.d)).enviou).toBe(true);
    expect(b.e.avisos).toEqual([{ tipo: 'saiu', arg: '14:00' }]);
    expect(b.e.marcas).toHaveLength(0);
  });
});

describe('erros de envio', () => {
  it('erro de DESTINO: o claim FICA, a posse volta e não conta como erro da linha', async () => {
    const { d, e } = falsas([lead()], { enviar: async () => { throw new Error('[zapi:io] HTTP 400 — {"error":"invalid phone"}'); } });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(e.claims.size).toBe(1);
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).not.toContain('erroDeLinha');
    expect(e.chamadas).not.toContain('apagarClaim');
    expect(e.avisos[0]!.tipo).toBe('nao_chama');
  });
  it('erro que PROVA que não saiu (cooldown): apaga o claim, desfaz a posse e conta na linha', async () => {
    const { d, e } = falsas([lead()], { enviar: async () => { throw new Error('[zapi:io] em cooldown (instância indisponível há <60s)'); } });
    await rodar(d);
    expect(e.claims.size).toBe(0);
    expect(e.chamadas).toContain('desfazerPosse');
    expect(e.chamadas).toContain('erroDeLinha');
    expect(e.avisos).toHaveLength(0);
  });
  it('timeout ou 5xx (pode ter saído): claim e posse ficam, o erro conta e o grupo não ouve que ela falou', async () => {
    const { d, e } = falsas([lead()], { enviar: async () => { throw new Error('[zapi:io] HTTP 502'); } });
    await rodar(d);
    expect(e.claims.size).toBe(1);
    expect(e.chamadas).not.toContain('desfazerPosse');
    expect(e.chamadas).toContain('erroDeLinha');
    expect(e.chamadas).toContain('marcarClaim');
    expect(e.avisos).toEqual([{ tipo: 'nao_chama', arg: 'A Carla tentou chamar, mas não sei se a mensagem saiu.' }]);
  });
});

describe('sem vaga', () => {
  const NOITE = new Date('2026-10-21T23:30:00.000Z');   // 20h30 de quarta, 21/10, em Brasília
  const MEIO_DIA = Date.parse('2026-10-21T15:00:00.000Z');
  /** A janela estava aberta ao meio-dia de hoje e está fechada agora. */
  const janelaSoAoMeioDia = (a: Date): boolean => a.getTime() === MEIO_DIA;
  const antiga = (): LeadRec => lead({ created_time: new Date(NOITE.getTime() - 5 * 3600_000).toISOString() });
  const largada = async (): Promise<number> => NOITE.getTime() - 48 * 3600_000;

  it('depois das 20h, em dia que a janela abriu, o lead elegível sem vaga ganha o aviso, e a Carla não envia', async () => {
    const { d, e } = falsas([antiga()], { janela: janelaSoAoMeioDia, garantirLargada: largada });
    const r = await runQuizRecuperacaoTick({ agora: NOITE }, d);
    expect(r.motivo).toBe('fora_da_janela');
    expect(e.avisos).toEqual([{ tipo: 'sem_vaga', arg: '' }]);
    expect(r.semVaga).toBe(1);
    expect(e.enviados).toHaveLength(0);
  });
  it('lead que a Carla não chamaria (sem CNPJ) não ganha "sem vaga"', async () => {
    const { d, e } = falsas([trocaCampo(antiga(), 'cnpj', 'nao')], { janela: janelaSoAoMeioDia, garantirLargada: largada });
    await runQuizRecuperacaoTick({ agora: NOITE }, d);
    expect(e.avisos).toHaveLength(0);
  });
  it('o "sem vaga" é UMA vez por lead, para sempre: quem já teve em qualquer dia não ganha outro', async () => {
    const l = antiga();
    const h1 = hmacDe(chaveDoTelefone(normalizarTelefoneSd(l.whatsapp)!))!;
    const { d, e } = falsas([l], { janela: janelaSoAoMeioDia, garantirLargada: largada }, { claims: new Set([`quiz_aviso:${h1}:semvaga`]) });
    await runQuizRecuperacaoTick({ agora: NOITE }, d);
    expect(e.avisos).toHaveLength(0);
  });
  it('se o time já recebeu a desistência do lead (aviso do tick), não sai "sem vaga"', async () => {
    const l = antiga();
    const h1 = hmacDe(chaveDoTelefone(normalizarTelefoneSd(l.whatsapp)!))!;
    // mesmo com a marca quiz_rec_ainda (a Carla ainda pode chamar de manhã), o time já foi avisado: nada de segundo aviso
    const { d, e } = falsas([l], { janela: janelaSoAoMeioDia, garantirLargada: largada }, { claims: new Set([`quiz_aviso:${h1}`, `quiz_rec_ainda:${h1}`]) });
    const r = await runQuizRecuperacaoTick({ agora: NOITE }, d);
    expect(e.avisos).toHaveLength(0);
    expect(r.semVaga).toBe(0);
  });
  it('antes das 20h, ou em dia sem janela (domingo), não há "sem vaga"', async () => {
    const tarde = new Date('2026-10-21T21:00:00.000Z');   // 18h em Brasília
    const a = falsas([antiga()], { janela: () => false, garantirLargada: largada });
    await runQuizRecuperacaoTick({ agora: tarde }, a.d);
    expect(a.e.avisos).toHaveLength(0);
    const domingo = new Date('2026-10-25T23:30:00.000Z');
    const b = falsas([antiga()], { janela: () => false, garantirLargada: largada });
    await runQuizRecuperacaoTick({ agora: domingo }, b.d);
    expect(b.e.avisos).toHaveLength(0);
  });
});
