import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O CAMINHO DA COMPRA DO PLUGCASH.
//
// É o único lugar do sistema onde um bug custa dinheiro de cliente: alguém paga
// R$ 197 e não recebe acesso, ou recebe dois e-mails, ou pede reembolso e
// continua com o curso. Nada disso aparece em log — aparece em reclamação.
//
// Os quatro casos que importam:
//   1. pagou           → conta, acesso, crédito e UM e-mail
//   2. reentrega       → o Pix manda dois webhooks; o segundo não pode duplicar
//                        acesso, crédito nem e-mail
//   3. reembolso       → o acesso e o crédito não usado somem
//   4. produto alheio  → LimpaPro e Kit passam pelo mesmo webhook; o PlugCash
//                        não pode engolir a venda deles
// ─────────────────────────────────────────────────────────────────────────────

type Linha = Record<string, any>;
const db: Record<string, Linha[]> = {};
const emails: Array<{ to: string; curso: string; contaCriada: boolean }> = [];
const alertas: string[] = [];
let falharEmail = false;

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.pc_gateway_produtos = [
    { id: 'g1', gateway: 'kiwify', produto_id: 'kw-fund', produto_nome: 'Fundamentos do Eletroposto',
      item_tipo: 'curso', item_slug: 'fundamentos', concede_nivel: null, gera_credito: true, ativo: true },
    { id: 'g2', gateway: 'kiwify', produto_id: 'kw-bump', produto_nome: 'Planilha de viabilidade',
      item_tipo: 'bump', item_slug: 'planilha', concede_nivel: null, gera_credito: false, ativo: true },
    { id: 'g3', gateway: 'kiwify', produto_id: 'kw-integ', produto_nome: 'Credenciamento Integrador',
      item_tipo: 'curso', item_slug: 'integrador', concede_nivel: 'integrador', gera_credito: false, ativo: true },
  ];
  db.pc_cursos = [
    { id: 'c1', slug: 'fundamentos', titulo: 'Fundamentos do Eletroposto', status: 'publicado', checkout_url: 'https://pay/x' },
    { id: 'c9', slug: 'integrador', titulo: 'Credenciamento Integrador', status: 'rascunho', checkout_url: null },
  ];
  db.pc_servicos = [];
  db.users = [];
  db.pc_compras = [];
  db.pc_acessos = [];
  db.pc_creditos = [];
  db.pc_membros = [];
  db.pc_eventos = [];
  db.pc_servico_pedidos = [];
  emails.length = 0; alertas.length = 0; falharEmail = false;
}

// Fake do PostgREST: só o que este caminho usa (select/eq/in/insert/upsert/
// update/delete/maybeSingle/single). Guarda em memória por tabela.
function fake(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      // `.is(col, null)` no Postgres casa coluna NULL. Em memória a coluna que
      // nunca foi escrita vem `undefined`, então a comparação precisa ser
      // null-ish — senão o teste de reembolso passa achando que o crédito
      // sobreviveu quando no banco real ele seria apagado.
      const filtros: Array<[string, any, 'eq' | 'is']> = [];
      let payload: Linha | Linha[] | null = null;
      let modo: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
      let conflito = '';

      const linhas = () => (tabelas[tabela] ||= []).filter(r =>
        filtros.every(([c, v, tipo]) =>
          tipo === 'is' && v === null ? r[c] == null : String(r[c]) === String(v)));

      const q: any = {
        select() { return q; },
        eq(c: string, v: any) { filtros.push([c, v, 'eq']); return q; },
        is(c: string, v: any) { filtros.push([c, v, 'is']); return q; },
        in(c: string, vs: any[]) {
          const orig = tabelas[tabela] || [];
          tabelas[tabela] = orig.filter(r => vs.map(String).includes(String(r[c])));
          const snapshot = tabelas[tabela]; tabelas[tabela] = orig;
          q._in = snapshot; return q;
        },
        order() { return q; },
        limit() { return q; },
        insert(p: Linha | Linha[]) { modo = 'insert'; payload = p; return q; },
        upsert(p: Linha, opts?: { onConflict?: string }) {
          modo = 'upsert'; payload = p; conflito = opts?.onConflict || ''; return q;
        },
        update(p: Linha) { modo = 'update'; payload = p; return q; },
        delete() { modo = 'delete'; return q; },
        // Sem .single()/.maybeSingle() o PostgREST devolve LISTA. Devolver a
        // primeira linha por padrão faria `lista.find` explodir em quem espera
        // array — foi o que aconteceu na primeira rodada destes testes.
        maybeSingle() { q._um = true; return q.then((r: any) => r); },
        single() { q._um = true; return q.then((r: any) => r); },
        then(res: any, rej: any) {
          const t = (tabelas[tabela] ||= []);
          let out: any = { data: null, error: null };

          if (modo === 'insert') {
            const novos = (Array.isArray(payload) ? payload : [payload!])
              .map(p => ({ id: `${tabela}-${t.length + 1}`, ...p }));
            t.push(...novos);
            out = { data: novos.length === 1 ? novos[0] : novos, error: null };

          } else if (modo === 'upsert') {
            const chaves = conflito.split(',').map(s => s.trim()).filter(Boolean);
            const p = payload as Linha;
            const existente = chaves.length
              ? t.find(r => chaves.every(k => String(r[k]) === String(p[k])))
              : undefined;
            if (existente) { Object.assign(existente, p); out = { data: existente, error: null }; }
            else { const novo = { id: `${tabela}-${t.length + 1}`, ...p }; t.push(novo); out = { data: novo, error: null }; }

          } else if (modo === 'update') {
            const alvo = linhas();
            alvo.forEach(r => Object.assign(r, payload));
            out = { data: alvo, error: null };

          } else if (modo === 'delete') {
            const fora = new Set(linhas());
            tabelas[tabela] = t.filter(r => !fora.has(r));
            out = { data: null, error: null };

          } else {
            const base = q._in ?? linhas();
            out = { data: q._um ? (base.length ? base[0] : null) : base, error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
  };
}

vi.mock('../utils/supabase', () => ({ supabase: fake(db) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: fake({}) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/mailer', () => ({
  sendOpsAlert: (assunto: string) => { alertas.push(assunto); return Promise.resolve(); },
  sendPlugcashAcessoEmail: (o: any) => {
    if (falharEmail) return Promise.reject(new Error('resend fora do ar'));
    emails.push({ to: o.to, curso: o.curso, contaCriada: o.contaCriada });
    return Promise.resolve();
  },
}));

const EVT = {
  orderId: 'ORD-1',
  email: 'comprador@teste.com',
  nome: 'Fulano de Tal',
  telefone: '5534991360223',
  status: 'paid',
  produtoId: 'kw-fund',
  produtoNome: 'Fundamentos do Eletroposto',
  valorCentavos: 19700,
  checkoutLink: null,
  utm: { utm_source: 'ig', utm_campaign: 'ep-agosto', utm_medium: null, utm_content: null, utm_term: null },
  payload: {},
};

async function processar(extra: Record<string, unknown> = {}) {
  const mod = await import('../services/plugcashService');
  return mod.processarEventoPlugcash({ ...EVT, ...extra } as any);
}

beforeEach(() => { reset(); vi.resetModules(); });

describe('compra do plugcash', () => {
  it('pagou: cria conta, libera o curso, gera crédito e manda um e-mail', async () => {
    const r = await processar();

    expect(r.acao).toBe('liberado');
    expect(db.pc_compras).toHaveLength(1);
    expect(db.pc_compras[0].status).toBe('aprovada');
    expect(db.pc_compras[0].gateway_ref).toBe('kiwify:ORD-1:fundamentos');

    // Conta nasce PENDENTE (sem senha): quem já é do SolarDoc não pode ter a
    // senha mexida, e quem é novo define a dele pelo link do e-mail.
    expect(db.users).toHaveLength(1);
    expect(db.users[0].password_hash).toBeNull();
    expect(db.users[0].origem_aquisicao).toBe('plugcash');

    expect(db.pc_acessos).toHaveLength(1);
    expect(db.pc_acessos[0].curso_id).toBe('c1');
    expect(db.pc_creditos).toHaveLength(1);
    expect(db.pc_creditos[0].valor_centavos).toBe(19700);
    expect(emails).toEqual([{ to: 'comprador@teste.com', curso: 'Fundamentos do Eletroposto', contaCriada: true }]);
  });

  // O Pix da Kiwify entrega DOIS webhooks (waiting_payment e depois paid), e
  // reentrega acontece. Se a segunda passagem duplicar qualquer coisa, o cliente
  // recebe dois e-mails de acesso — que lê como cobrança dobrada.
  it('reentrega do mesmo pedido não duplica acesso, crédito nem e-mail', async () => {
    await processar();
    const r2 = await processar();

    expect(r2.acao).toBe('liberado');
    expect(db.pc_compras).toHaveLength(1);
    expect(db.pc_acessos).toHaveLength(1);
    expect(db.pc_creditos).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it('pix aguardando registra a compra mas não libera nada', async () => {
    const r = await processar({ status: 'waiting_payment' });
    expect(r.acao).toBe('registrado');
    expect(db.pc_compras[0].status).toBe('pendente');
    expect(db.pc_acessos).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  // A Kiwify pode reentregar o 'waiting_payment' DEPOIS do 'paid'. Rebaixar aqui
  // trancaria o material de quem já pagou.
  it('waiting_payment que chega depois do paid não rebaixa a compra', async () => {
    await processar();
    await processar({ status: 'waiting_payment' });
    expect(db.pc_compras[0].status).toBe('aprovada');
    expect(db.pc_acessos).toHaveLength(1);
  });

  it('reembolso revoga o acesso e o crédito não usado', async () => {
    await processar();
    const r = await processar({ status: 'refunded' });

    expect(r.acao).toBe('revogado');
    expect(db.pc_acessos).toHaveLength(0);
    expect(db.pc_creditos).toHaveLength(0);
    expect(db.pc_compras[0].status).toBe('reembolsada');
  });

  it('chargeback também revoga', async () => {
    await processar();
    await processar({ status: 'chargeback' });
    expect(db.pc_acessos).toHaveLength(0);
  });

  // O MESMO webhook da Kiwify recebe venda do LimpaPro e do Kit de Fechamento.
  // Engolir a venda deles deixaria o comprador do outro produto sem nada.
  it('produto que não é do plugcash passa direto, sem tocar em nada', async () => {
    const r = await processar({ produtoId: 'kw-outro', produtoNome: 'LimpaPro — Curso de Limpeza' });
    expect(r.acao).toBe('ignorado');
    expect(db.pc_compras).toHaveLength(0);
    expect(db.users).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('abandono de carrinho não vira pedido', async () => {
    const r = await processar({ status: 'abandoned_cart' });
    expect(r.acao).toBe('ignorado');
    expect(db.pc_compras).toHaveLength(0);
  });

  // O bump vem no MESMO order_id do produto principal. Se a chave de
  // idempotência fosse só o pedido, o segundo item sobrescreveria o primeiro.
  it('bump no mesmo pedido vira compra própria e não manda e-mail duplicado', async () => {
    await processar();
    await processar({ produtoId: 'kw-bump', produtoNome: 'Planilha de viabilidade', valorCentavos: 4700 });

    expect(db.pc_compras).toHaveLength(2);
    expect(db.pc_compras.map(c => c.gateway_ref).sort())
      .toEqual(['kiwify:ORD-1:fundamentos', 'kiwify:ORD-1:planilha']);
    expect(emails).toHaveLength(1);          // só o produto principal avisa
    expect(db.pc_creditos).toHaveLength(1);  // bump não gera crédito
  });

  it('item que concede nível sobe o membro', async () => {
    await processar({ orderId: 'ORD-2', produtoId: 'kw-integ', produtoNome: 'Credenciamento Integrador', valorCentavos: 99700 });
    expect(db.pc_membros[0].nivel).toBe('integrador');
    expect(db.pc_creditos).toHaveLength(0);  // nível não gera crédito
  });

  // Falha de e-mail não pode carimbar: a próxima reentrega tem que tentar de
  // novo. O acesso já está liberado — o e-mail é o aviso, não a chave.
  it('e-mail que falha não é dado como enviado, e o acesso continua liberado', async () => {
    falharEmail = true;
    const r = await processar();

    expect(r.acao).toBe('liberado');
    expect(db.pc_acessos).toHaveLength(1);
    expect(db.pc_compras[0].acesso_email_em).toBeUndefined();

    falharEmail = false;
    await processar();
    expect(emails).toHaveLength(1);
  });

  it('venda sem curso no catálogo grita em vez de sumir no log', async () => {
    db.pc_cursos = [];
    await processar();
    expect(alertas.some(a => /venda sem curso/i.test(a))).toBe(true);
  });

  it('pedido sem e-mail não cria nada', async () => {
    const r = await processar({ email: '' });
    expect(r.acao).toBe('ignorado');
    expect(db.users).toHaveLength(0);
  });
});

describe('rede de seguranca do webhook', () => {
  // A versão anterior era uma regex de palavras e pegava 3 dos 20 títulos do
  // catálogo. "Capital" e "Equipamento" passavam batido — justamente os nomes
  // genéricos, que são os mais fáceis de alguém digitar diferente na Kiwify.
  it('reconhece titulo do catalogo mesmo sem palavra-chave no nome', async () => {
    db.pc_cursos.push({ id: 'c3', slug: 'capital', titulo: 'Capital', status: 'rascunho' });
    const mod = await import('../services/plugcashService');
    expect(await mod.pareceProdutoDoPlugcash('Capital')).toBe(true);
    expect(await mod.pareceProdutoDoPlugcash('  capital  ')).toBe(true);
    expect(await mod.pareceProdutoDoPlugcash('LimpaPro — Curso de Limpeza')).toBe(false);
    expect(await mod.pareceProdutoDoPlugcash('')).toBe(false);
  });
});

describe('telefone na forma canonica', () => {
  // A ponte entre os dois bancos. Casar pelos ultimos 10 digitos comeria o
  // primeiro digito do DDD e faria numeros de estados diferentes baterem.
  it('normaliza os tres formatos que aparecem em producao', async () => {
    const { telNorm } = await import('../services/plugcashService');
    expect(telNorm('5534991360223')).toBe('3491360223');   // 13 digitos, com 55
    expect(telNorm('34991360223')).toBe('3491360223');     // 11 digitos
    expect(telNorm('(34) 99136-0223')).toBe('3491360223'); // mascarado
    expect(telNorm('3488226142')).toBe('3488226142');      // 10 digitos (8 no numero)
    expect(telNorm('123')).toBeNull();
    expect(telNorm(null)).toBeNull();
  });

  it('nao confunde DDDs diferentes com final igual', async () => {
    const { telNorm } = await import('../services/plugcashService');
    expect(telNorm('5532999126804')).not.toBe(telNorm('5582999126804'));
  });
});
