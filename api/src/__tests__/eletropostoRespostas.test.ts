import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Recado pra equipe quando o lead responde a automação da agenda. Os riscos:
// avisar duas vezes o mesmo recado, avisar conversa que o humano já estava tendo,
// e não avisar nada porque o telefone do inbound vem sem o 9º dígito.

const state = new Map<string, { key: string; value: any; updated_at: string }>();
let fichas: any[] = [];
let inbound: any[] = [];
/** Linha de posse da agente nova (whatsapp_sessions, tipo ag5040) que o banco falso devolve; null = sem posse. */
let posseDaAgente: any = null;
const avisos: Array<{ phone: string; texto: string }> = [];
const presencas: Array<{ id: number; valor: string | null }> = [];
const respostas: Array<{ id: number; valor: string | null }> = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _del: false,
        select() { return q; },
        eq(col: string, v: any) {
          q._filtros[col] = v;
          if (q._del) { state.delete(String(v)); return Promise.resolve({ error: null }); }
          return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        like() { return q; },
        order() { return q; },
        // O robô de remarcação lê/apaga chave a chave (oferta em aberto e carimbo
        // do bom dia). Sem estes três, o passo de remarcação estourava e o
        // try/catch do tick engolia — a ligação passava nos testes sem existir.
        maybeSingle() {
          if (tabela === 'whatsapp_sessions') return Promise.resolve({ data: posseDaAgente, error: null });
          return Promise.resolve({ data: state.get(String(q._filtros['key'])) ?? null, error: null });
        },
        delete() { q._del = true; return q; },
        upsert(p: any) { for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r); return Promise.resolve({ error: null }); },
        limit() {
          if (tabela === 'system_state') return Promise.resolve({ data: [...state.values()], error: null });
          const de = q._filtros['gte_momment'], ate = q._filtros['lte_momment'];
          return Promise.resolve({
            data: inbound.filter(m => (!de || m.momment >= de) && (!ate || m.momment <= ate)), error: null,
          });
        },
      };
      return q;
    },
  },
}));
/** Agenda de Thiago/Diego que a régua de vagas enxerga (vazia = tarde toda livre). */
let compromissos: any[] = [];
const remarcacoes: Array<{ id: number; patch: any }> = [];
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _update: null as any,
        select() { return q; }, in() { return q; }, gte() { return q; }, or() { return q; }, neq() { return q; },
        // `lte` e `not` são da consulta de vagas do robô de remarcação.
        lte() { return q; }, not() { return q; },
        update(patch: any) { q._update = patch; return q; },
        eq(_c: string, v: any) {
          if (q._update) {
            // Presença e remarcação escrevem na MESMA tabela: separa pelo patch.
            if ('quando' in q._update) remarcacoes.push({ id: Number(v), patch: q._update });
            else {
              // Desde 19/08 o mesmo patch carrega duas coisas: `lead_resposta_at`
              // (vai SEMPRE que a pessoa fala — é o que tira o card do amarelo) e
              // `presenca_confirmada_at` (só quando ela confirma mesmo, ou some
              // quando pede pra remarcar). Separados aqui pra cada teste olhar o seu.
              if ('lead_resposta_at' in q._update) respostas.push({ id: Number(v), valor: q._update.lead_resposta_at });
              if ('presenca_confirmada_at' in q._update) presencas.push({ id: v, valor: q._update.presenca_confirmada_at });
            }
            return Promise.resolve({ error: null });
          }
          return q;
        },
        // A régua de vagas pagina (order + range): uma página só, igual ao limit.
        order() { return q; },
        range() { return q.limit(); },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: [{ nome: 'Diego', whatsapp: '5534991360172' }], error: null });
          // A régua de vagas pergunta por `quando`+`vendedor_nome`; o tick de
          // respostas pergunta pelas fichas. O `select` distingue os dois.
          if (q._vagas) return Promise.resolve({ data: compromissos, error: null });
          return Promise.resolve({ data: fichas, error: null });
        },
      };
      // A consulta de vagas é a única que pede exatamente estas duas colunas.
      const select = q.select;
      // A consulta de vagas passou a pedir `status` e `created_by` também (o
      // vermelho deixou de ocupar horário em 19/08). Casar por prefixo em vez da
      // string inteira: senão uma coluna nova lá faz este mock devolver FICHA no
      // lugar de compromisso, e o teste segue verde testando outra coisa.
      q.select = (cols?: string) => { q._vagas = String(cols || '').startsWith('quando, vendedor_nome'); return select(); };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
/** O que o robô de remarcação fala com o LEAD (o `avisos` é o que vai pra equipe). */
const aoLead: Array<{ phone: string; bolhas: string[] }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => { avisos.push({ phone, texto }); }),
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { aoLead.push({ phone, bolhas }); }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => true),
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223', diego: '34991360172' } }));
// Quem está em conversa com a Helena (agente de investidores) não é atendido aqui.
const helena = vi.hoisted(() => ({ chaves: new Set<string>() as Set<string> | null }));
vi.mock('../services/io/investidorAgentePosse', () => ({ chavesDaHelena: vi.fn(async () => helena.chaves) }));

const AGORA = new Date('2026-08-04T16:00:00.000Z');
const TOQUE = '2026-08-04T15:00:00.000Z';
const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 1, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5569984488158',
    quando: '2026-08-05T16:30:00.000Z', vendedor_nome: 'Diego',
    created_by: 'lp_eletroposto',
    confirmacao_at: TOQUE, lembrete_1h_at: null, lembrete_5min_at: null, ...over,
  };
}
// A Z-API entrega o inbound SEM o 9º dígito: 12 dígitos contra os 13 da ficha.
function msg(over: Partial<any> = {}) {
  return { telefone: '556984488158', texto: 'Sim', tipo: 'texto', momment: antes(5), ...over };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); avisos.length = 0; presencas.length = 0; respostas.length = 0;
  aoLead.length = 0; remarcacoes.length = 0; compromissos = [];
  fichas = [ficha()]; inbound = [msg()];
  helena.chaves = new Set<string>();
  posseDaAgente = null;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/eletropostoRespostas'); }
async function tick(opts: any = {}) { return (await mod()).runEletropostoRespostasTick(opts); }

describe('quem vira recado', () => {
  it('telefone sem o 9º dígito casa com a ficha que tem', async () => {
    expect((await tick()).avisados).toBe(1);
    expect(avisos).toHaveLength(2);                       // Thiago e Diego
    expect(avisos[0].texto).toContain('Irineu de Almeida');
    expect(avisos[0].texto).toContain('Sim');
  });

  it('mensagem ANTERIOR ao toque da automação não vira aviso', async () => {
    inbound = [msg({ momment: '2026-08-04T14:00:00.000Z' })];   // antes do TOQUE
    expect((await tick()).avisados).toBe(0);
    expect(avisos).toHaveLength(0);
  });

  it('ficha que a automação nunca tocou fica de fora', async () => {
    fichas = [ficha({ confirmacao_at: null })];
    expect((await tick()).motivo).toBe('ninguem_tocado');
  });

  it('mensagem de quem não tem reunião é ignorada', async () => {
    inbound = [msg({ telefone: '5511999998888' })];
    expect((await tick()).motivo).toBe('ninguem_respondeu');
  });

  it('mensagem recém-chegada espera o próximo tick (não corta a frase no meio)', async () => {
    inbound = [msg({ momment: new Date(AGORA.getTime() - 5_000).toISOString() })];
    expect((await tick()).motivo).toBe('sem_inbound');
  });

  it('avisa uma vez: o marcador guarda até onde já foi', async () => {
    expect((await tick()).avisados).toBe(1);
    avisos.length = 0;
    expect((await tick()).motivo).toBe('ninguem_respondeu');
    expect(avisos).toHaveLength(0);
  });

  it('mensagem NOVA depois do aviso vira um aviso novo', async () => {
    await tick();
    avisos.length = 0;
    inbound.push(msg({ texto: 'mandei a foto do terreno', momment: antes(1) }));
    expect((await tick()).avisados).toBe(1);
    expect(avisos[0].texto).toContain('foto do terreno');
    expect(avisos[0].texto).not.toContain('• Sim');       // o que já foi avisado não repete
  });

  it('várias mensagens na mesma janela viram UM recado só', async () => {
    inbound = [msg({ texto: 'Sim' }), msg({ texto: 'tenho um posto na BR-354', momment: antes(4) })];
    expect((await tick()).avisados).toBe(1);
    expect(avisos).toHaveLength(2);                       // 2 destinatários, 1 recado
    expect(avisos[0].texto).toContain('BR-354');
  });
});

// "Confirmaram quando confirmar mesmo" (regra do dono, 04/08). O risco aqui é o
// painel encher de gente que não vai aparecer.
describe('o que conta como confirmar mesmo', () => {
  it('afirmativa inteira conta', async () => {
    const { confirmouMesmo } = await mod();
    for (const t of ['Sim', 'sim!', 'Ok', 'blz', 'combinado', '👍', 'Confirmado', 'Perfeito 👍', 'estarei']) {
      expect(confirmouMesmo([t]), t).toBe(true);
    }
  });

  it('verbo explícito conta mesmo no meio da frase', async () => {
    const { confirmouMesmo } = await mod();
    expect(confirmouMesmo(['Bom dia, confirmo a reunião de quarta'])).toBe(true);
    expect(confirmouMesmo(['pode deixar que eu vou estar lá'])).toBe(true);
  });

  it('afirmativa que vira pergunta NÃO conta', async () => {
    const { confirmouMesmo } = await mod();
    for (const t of ['ok, mas quanto vou gastar?', 'sim, e o financiamento?', 'certo. me manda o valor']) {
      expect(confirmouMesmo([t]), t).toBe(false);
    }
  });

  it('pedido de remarcar derruba a confirmação, mesmo começando com ok', async () => {
    const { confirmouMesmo, selo } = await mod();
    expect(confirmouMesmo(['ok', 'mas preciso remarcar'])).toBe(false);
    expect(selo(['ok, mas preciso remarcar']).titulo).toBe('PODE QUERER REMARCAR');
  });

  it('pergunta pura não é presença', async () => {
    const { confirmouMesmo } = await mod();
    expect(confirmouMesmo(['quanto vou gastar?'])).toBe(false);
    expect(confirmouMesmo(['tenho um terreno na BR-354'])).toBe(false);
  });
});

describe('o que o recado diz', () => {
  it('lê a intenção sem decidir por ela', async () => {
    const { selo } = await mod();
    expect(selo(['Sim']).titulo).toBe('CONFIRMOU PRESENÇA');
    expect(selo(['não vou conseguir, dá pra remarcar?']).titulo).toBe('PODE QUERER REMARCAR');
    expect(selo(['quanto vou gastar?']).titulo).toBe('RESPONDEU');
  });

  it('o recado leva reunião, consultor e link do WhatsApp', async () => {
    await tick();
    const t = avisos[0].texto;
    expect(t).toContain('quarta-feira, 05/08 às 13h30');
    expect(t).toContain('Diego');
    expect(t).toContain('wa.me/5569984488158');
  });

  it('áudio e foto aparecem contados — voz sobre o ponto não pode passar batido', async () => {
    inbound = [
      msg({ texto: '', tipo: 'audio' }),
      msg({ texto: '', tipo: 'imagem', momment: antes(4) }),
      msg({ texto: '', tipo: 'imagem', momment: antes(3) }),
    ];
    await tick();
    expect(avisos[0].texto).toContain('1 áudio');
    expect(avisos[0].texto).toContain('2 imagens');
    expect(avisos[0].texto).toContain('só mídia, sem texto');
  });
});

describe('presença na ficha', () => {
  it('quem confirma sobe o campo', async () => {
    await tick();
    expect(presencas).toEqual([{ id: 1, valor: expect.any(String) }]);
  });

  it('quem só pergunta não sobe presença — mas o silêncio acaba do mesmo jeito', async () => {
    inbound = [msg({ texto: 'quanto vou gastar?' })];
    await tick();
    expect(presencas).toHaveLength(0);
    // Pergunta não é presença, mas é resposta: o card sai do amarelo na agenda e
    // as duas réguas de vermelho param de mirar nele.
    expect(respostas).toEqual([{ id: 1, valor: expect.any(String) }]);
  });

  it('quem confirmou e depois pediu remarcar CAI da conta', async () => {
    await tick();
    expect(presencas[0].valor).toEqual(expect.any(String));
    presencas.length = 0;
    inbound.push(msg({ texto: 'preciso remarcar, não vou conseguir', momment: antes(1) }));
    await tick();
    expect(presencas).toEqual([{ id: 1, valor: null }]);
  });
});

describe('travas', () => {
  it('kill-switch desliga', async () => {
    process.env.EP_RESPOSTAS_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
    expect(avisos).toHaveLength(0);
  });

  it('dry mostra o recado e não manda nem marca', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(r.previa?.[0]).toMatchObject({ id: 1, mensagens: 1 });
    expect(avisos).toHaveLength(0);
    expect(state.size).toBe(0);
  });
});

// A remarcação automática mora no eletropostoRemarcar (testado à parte). O que
// estes provam é a LIGAÇÃO: que o tick de respostas chama o robô de verdade, e
// que a equipe recebe o desfecho junto do recado em vez de um alerta órfão.
describe('remarcação automática, pela ponta do tick', () => {
  const pedido = (t: string, min = 5) => msg({ texto: t, momment: antes(min) });

  it('pedido de remarcar vira oferta pro lead e desfecho no recado da equipe', async () => {
    inbound = [pedido('não vai dar, pode ser outro dia?')];
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(aoLead).toHaveLength(1);
    expect(aoLead[0].bolhas.join(' ')).toContain('1)');
    expect(avisos[0].texto).toContain('O robô já ofereceu');
    expect(remarcacoes).toEqual([]);            // nada muda antes de a pessoa escolher
  });

  it('a escolha move a reunião e a equipe é avisada do novo horário', async () => {
    inbound = [pedido('preciso remarcar')];
    await tick();
    const ofertadas = state.get('ep_remarcar:1')!.value.ofertas as string[];
    avisos.length = 0; aoLead.length = 0;

    inbound = [pedido('2', 1)];
    const r = await tick();
    expect(r.remarcadas).toBe(1);
    expect(remarcacoes).toHaveLength(1);
    expect(remarcacoes[0]!.patch.quando).toBe(ofertadas[1]);
    expect(avisos[0]!.texto).toContain('REMARCADO PELO ROBÔ');
    // O selo do topo também vira "resolvido", e o cabeçalho já mostra o horário
    // NOVO: recado que abre em ⚠️ manda o Thiago resolver o que não existe mais.
    expect(avisos[0]!.texto).not.toContain('PODE QUERER REMARCAR');
    expect(avisos[0]!.texto).toContain('🔄');
  });

  it('quem pede pra CANCELAR não recebe horário nenhum — segue como alerta', async () => {
    inbound = [pedido('quero cancelar por favor')];
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(r.remarcadas).toBe(0);
    expect(aoLead).toHaveLength(0);
    expect(avisos[0].texto).toContain('PODE QUERER REMARCAR');   // o selo antigo, pro humano
  });

  it('kill-switch do remarcar não derruba o recado da equipe', async () => {
    process.env.EP_REMARCAR_OFF = '1';
    vi.resetModules();
    inbound = [pedido('não vai dar, pode ser outro dia?')];
    expect((await tick()).avisados).toBe(1);
    expect(aoLead).toHaveLength(0);
    expect(avisos).toHaveLength(2);
  });

  it('dry mostra o que o robô faria e não envia nem grava', async () => {
    inbound = [pedido('preciso remarcar')];
    const r = await tick({ dry: true });
    expect(r.previa?.[0]?.aviso).toContain('O robô já ofereceu');
    expect(aoLead).toHaveLength(0);
    expect(remarcacoes).toEqual([]);
    expect(state.has('ep_remarcar:1')).toBe(false);
  });

  // O caminho perigoso do dry não é a oferta, é a ESCOLHA: com uma oferta viva no
  // system_state, um "2" no inbound leva o passo até a beira do UPDATE. Uma prévia
  // que move reunião de verdade seria o pior tipo de bug — o endpoint existe
  // justamente pra olhar sem tocar.
  it('dry com oferta em aberto e escolha no inbound NÃO move a agenda', async () => {
    inbound = [pedido('preciso remarcar')];
    await tick();                                    // deixa uma oferta viva
    remarcacoes.length = 0; aoLead.length = 0;

    inbound = [pedido('2', 1)];
    const r = await tick({ dry: true });
    expect(remarcacoes).toEqual([]);
    expect(aoLead).toHaveLength(0);
    expect(r.previa?.[0]?.aviso).toContain('REMARCADO PELO ROBÔ');   // decide igual, só não faz
    expect(state.has('ep_remarcar:1')).toBe(true);                   // a oferta continua de pé
  });
});

// ── "TRAVA O HORÁRIO" (22/09/2026) ──────────────────────────────────────────
// Caso real do primeiro dia da régua do SIM: o Vitor perdeu o horário às 15h32,
// respondeu "Trava o horário" às 15h38, e nada aconteceu, porque `confirmouMesmo`
// exige que a mensagem INTEIRA seja uma afirmativa. Ele fez o que a mensagem
// pediu e o robô ficou mudo.
describe('querODeVolta', () => {
  it('entende o pedido de segurar o horário', async () => {
    const { querODeVolta } = await import('../services/io/eletropostoRespostas');
    expect(querODeVolta(['Trava o horário'])).toBe(true);
    expect(querODeVolta(['pode manter'])).toBe(true);
    expect(querODeVolta(['ainda quero sim'])).toBe(true);
    expect(querODeVolta(['segura pra mim'])).toBe(true);
  });

  it('não confunde palavra dentro de outra palavra', async () => {
    const { querODeVolta } = await import('../services/io/eletropostoRespostas');
    expect(querODeVolta(['quando eu entrava no site dava erro'])).toBe(false);
  });

  it('pedido de remarcar ganha: quem quer outro dia não está pedindo esse de volta', async () => {
    const { querODeVolta } = await import('../services/io/eletropostoRespostas');
    expect(querODeVolta(['pode manter, mas preciso remarcar'])).toBe(false);
  });

  it('conversa comum não vira pedido de horário', async () => {
    const { querODeVolta } = await import('../services/io/eletropostoRespostas');
    expect(querODeVolta(['Boa tarde'])).toBe(false);
    expect(querODeVolta(['Pra mim fica muito difícil fazer reunião.'])).toBe(false);
  });
});

describe('quem está em conversa com a Helena (agente de investidores)', () => {
  it('não vira recado nem remarcação aqui: a conversa é dela', async () => {
    helena.chaves = new Set(['6984488158']);   // DDD + 8 últimos da ficha
    const r = await tick();
    expect(r.avisados).toBe(0);
    expect(r.motivo).toBe('ninguem_tocado');
    expect(avisos).toHaveLength(0);
    expect(aoLead).toHaveLength(0);
  });

  it('a chave casa com e sem o nono dígito', async () => {
    fichas = [ficha({ cliente_telefone: '556984488158' })];
    helena.chaves = new Set(['6984488158']);
    expect((await tick()).avisados).toBe(0);
  });

  it('quem não é dela segue sendo avisado', async () => {
    helena.chaves = new Set(['3499990000']);
    expect((await tick()).avisados).toBe(1);
  });

  it('sem conseguir ler as sessões, a rodada espera a próxima em vez de arriscar dois robôs', async () => {
    helena.chaves = null;
    const r = await tick();
    expect(r).toMatchObject({ avisados: 0, erros: 1, motivo: 'erro_posse_investidor' });
    expect(avisos).toHaveLength(0);
  });
});

// AGENDA EM LOTE (13/10/2026): criar o card não pode mudar o que os robôs fazem com
// o lead. O robô não responde a ele e não mexe no card; só AVISA o consultor dono,
// porque com o card na agenda a recepção se cala e a Helena fecha a sessão.
describe('a origem da agenda em lote só avisa o consultor dono', () => {
  const doLote = (over: Partial<any> = {}) => ficha({ created_by: 'cadastro_eletroposto', ...over });
  const escreve = () => [msg({ texto: 'Sim', momment: antes(5) }), msg({ texto: 'Quero remarcar', momment: antes(4) })];

  it('"sim" e "quero remarcar" na mesma leva: UM aviso ao dono, nada ao lead, nada gravado no card', async () => {
    fichas = [doLote()]; inbound = escreve();
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.phone).toBe('5534991360172');          // o celular do Diego, dono do card
    expect(avisos[0]!.texto).toContain('Sim\nQuero remarcar'); // as duas juntas
    expect(aoLead).toHaveLength(0);       // nem passoDeRemarcacao, nem mensagem ao lead
    expect(respostas).toHaveLength(0);    // sem lead_resposta_at
    expect(presencas).toHaveLength(0);    // sem presença
    expect(remarcacoes).toHaveLength(0);  // sem mover card
    expect(r.remarcadas).toBe(0);
  });

  it('o texto é o combinado: emoji só na 1ª linha, campos preenchidos, sem travessão', async () => {
    fichas = [doLote({ cliente_nome: 'Marcos Silva' })]; inbound = escreve();
    await tick();
    const t = avisos[0]!.texto;
    const linhas = t.split('\n');
    expect(linhas[0]).toBe('💬 *LEAD DA SUA AGENDA ESCREVEU NA 5040*');
    expect(linhas[1]).toBe('*Cliente:* Marcos Silva');
    expect(linhas[2]).toBe('*WhatsApp:* wa.me/5569984488158');
    expect(linhas[3]).toMatch(/^\*Reunião:\* .+, com Diego$/);
    expect(t).toContain('\n\n*O que escreveu:* Sim\nQuero remarcar\n\n_Card do cadastro de investidores. O robô não respondeu a ele: quem responde é você._');
    expect(t).not.toMatch(/[—–]/);
    expect(linhas.slice(1).join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('campo vazio some com a linha dele, e o texto é cortado em 400 caracteres', async () => {
    fichas = [doLote({ cliente_nome: '   ' })]; inbound = [msg({ texto: 'x'.repeat(900), momment: antes(5) })];
    await tick();
    const t = avisos[0]!.texto;
    expect(t).not.toContain('*Cliente:*');
    expect(t).toContain(`*O que escreveu:* ${'x'.repeat(400)}\n`);
    expect(t).not.toContain('x'.repeat(401));
  });

  it('o mesmo controle de repetição: a mesma mensagem não avisa duas vezes', async () => {
    fichas = [doLote()]; inbound = escreve();
    await tick();
    await tick();
    expect(avisos).toHaveLength(1);
  });

  it('mensagem de ANTES do card não vira aviso (o corte é o carimbo da criação)', async () => {
    fichas = [doLote()]; inbound = [msg({ texto: 'Sim', momment: '2026-08-04T14:00:00.000Z' })];
    const r = await tick();
    expect(r.avisados).toBe(0);
    expect(avisos).toHaveLength(0);
  });

  it('dry mostra o aviso e não manda nem marca', async () => {
    fichas = [doLote()]; inbound = escreve();
    const r = await tick({ dry: true });
    expect(r.previa?.[0]?.aviso).toContain('LEAD DA SUA AGENDA ESCREVEU NA 5040');
    expect(avisos).toHaveLength(0);
    expect(state.size).toBe(0);
  });

  it('o mesmo lead com card de lp_eletroposto se comporta como sempre', async () => {
    fichas = [ficha()]; inbound = escreve();
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(avisos.length).toBeGreaterThan(0);
    expect(respostas.map(x => x.id)).toEqual([1]);
  });

  it('com DOIS cards do mesmo telefone, só o da origem nova sai: o outro continua valendo', async () => {
    fichas = [doLote({ id: 2 }), ficha({ id: 1 })]; inbound = escreve();
    await tick();
    expect(respostas.map(x => x.id)).toEqual([1]);
    expect(avisos.length).toBeGreaterThan(0);
    // o aviso novo NÃO sai em duplicidade: só o aviso normal do outro card
    expect(avisos.some(a => a.texto.includes('LEAD DA SUA AGENDA ESCREVEU'))).toBe(false);
    // e na ordem inversa também
    respostas.length = 0; avisos.length = 0; state.clear();
    fichas = [ficha({ id: 1 }), doLote({ id: 2 })];
    await tick();
    expect(respostas.map(x => x.id)).toEqual([1]);
    expect(avisos.some(a => a.texto.includes('LEAD DA SUA AGENDA ESCREVEU'))).toBe(false);
  });
});

describe('agente nova da linha 5040 com posse viva (Fase B1b)', () => {
  // A régua antiga NÃO cede a conversa: ela segue gravando lead_resposta_at e a presença, avisando o time e
  // remarcando. Quem cala por posse são os robôs que falam com o lead (Carla, Duda, Helena), não esta régua.
  async function comPosseViva() {
    process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    process.env.AGENTES5040_DUDA_VIVO = '1';
    const { hmacDe, idChaveHmac } = await import('../services/agentes5040/hmac');
    const { chaveContato } = await import('../services/agents/whatsapp/silenciar');
    const chave = chaveContato('5569984488158')!;
    state.set('ag5040_vivo_alvo', { key: 'ag5040_vivo_alvo', updated_at: AGORA.toISOString(), value: { kid: idChaveHmac(), hmacs: [hmacDe(chave)], modos: {} } });
    posseDaAgente = { lead_data: { dona: 'duda', estado: 'viva', desde: TOQUE, ate_wa_id: 1, respostas: 1, imagens: [], links: [] } };
    // prova de que o cenário é de posse viva de verdade: o corte da posse diria "cala"
    const { cedeAAgente } = await import('../services/agentes5040/posse');
    expect(await cedeAAgente('5569984488158')).toBe(true);
  }

  it('a régua AINDA grava lead_resposta_at e a presença e avisa o time (duda_vivo ligado, alvo no número, posse viva)', async () => {
    await comPosseViva();
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(avisos).toHaveLength(2);                                  // Thiago e Diego
    expect(avisos[0].texto).toContain('Irineu de Almeida');
    expect(respostas).toEqual([{ id: 1, valor: expect.any(String) }]);   // o update de lead_resposta_at: 1 vez
    expect(presencas).toEqual([{ id: 1, valor: expect.any(String) }]);
  });

  it('e a remarcação automática ainda roda: o pedido de remarcar vira oferta ao lead', async () => {
    await comPosseViva();
    inbound = [msg({ texto: 'preciso remarcar' })];
    const r = await tick();
    expect(r.avisados).toBe(1);
    expect(aoLead).toHaveLength(1);
    expect(aoLead[0].bolhas.join(' ')).toContain('1)');
    expect(respostas).toHaveLength(1);
    expect(avisos[0].texto).toContain('O robô já ofereceu');
  });
});
