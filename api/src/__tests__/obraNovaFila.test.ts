import { describe, it, expect, vi, beforeEach } from 'vitest';

// Obra solar nova, o lado dos robôs (19/11/2026): o "Falta" da escalada não cobra item opcional (B2) e o cron da fila das 08:00 registra os portões que já
// valem com o autor `leitura`, em silêncio (B5). Banco, Storage e envio SIMULADOS; dados inventados. Nada sai de verdade.

const h = vi.hoisted(() => ({
  privadas: new Map<number, any>(),
  estados: new Map<number, any>(),
  arquivos: [] as any[],
  leituras: [] as number[],
  gravacoes: 0,
  falhaCard: 0,
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/gerador/docsClienteBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/docsClienteBanco')>()),
  lerDocsComVersao: vi.fn(async () => ({ reg: { arquivos: h.arquivos, alteracoes: [], apagados: [] }, versao: 'v' })),
}));
vi.mock('../services/gerador/jornadaDinheiroBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/jornadaDinheiroBanco')>()),
  lerLancamentosDaObra: vi.fn(async () => ({ lancamentos: [], ignoradas: 0 })),
}));
vi.mock('../services/gerador/jornadaObraBanco', async (orig) => {
  const m = await orig<typeof import('../services/gerador/jornadaObraBanco')>();
  return {
    ...m,
    lerObraPrivada: vi.fn(async (card: number) => { h.leituras.push(card); if (card === h.falhaCard) throw Object.assign(new Error('x'), { codigo: 'falha' }); return h.privadas.get(card) ?? null; }),
    mudarObra: vi.fn(async (card: number, base: () => any, fn: (e: any) => any) => {
      const novo = fn(h.estados.get(card) ?? base());
      if (novo && typeof novo === 'object' && 'recusa' in novo) return novo;
      h.estados.set(card, novo); h.gravacoes++;
      return novo;
    }),
  };
});

import { faltaDaObra } from '../services/io/jornadaMensagensBase';
import { sincronizarPortoesDaFila } from '../services/io/jornadaPortoesFila';
import { eventosDoCard, type ObraFila } from '../services/io/jornadaMensagensPuro';
import { obraMaterializada, etapaAtualCompleta, type ItemCompra } from '../services/gerador/jornadaObra';
import { obraPrivadaVazia } from '../services/gerador/jornadaObraBanco';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';

const AGORA = '2026-11-19T11:00:30.000Z';
const item = (id: string, o: Partial<ItemCompra> = {}): ItemCompra => ({
  id, origem: 'proposta', tipo: 'outro', descricao: id, quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null,
  garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: null, fornecedor: '', valor_centavos: null, data: null,
  etapa: 4, criado_por: 'thiago', criado_em: AGORA, comprado: false, orcado_centavos: null, lido_de: '', documento_id: '', serie: '', ...o,
});
/** A obra como a leitura do cron a traz; o estado gravado (o que o `mudarObra` lê do banco) é o mesmo `jo`. */
const obraDe = (card: number, etapa: number, o: Partial<ObraFila> = {}): ObraFila => {
  const obra: ObraFila = {
    card, codigo: `#00${card}`, cliente: `Cliente ${card}`, cidade: 'Uberlândia-MG', vendedor: 'nilce',
    js: { ...estadoMaterializado(card, 'nilce', 4, AGORA), origem: 'vendido' as const }, jo: obraMaterializada(card, etapa, AGORA, AGORA), cancelada: false, ...o,
  };
  if (obra.jo) h.estados.set(card, obra.jo);
  return obra;
};
const kitComprado = () => {
  const p = obraPrivadaVazia();
  p.compra.itens = [item('m', { tipo: 'modulo', comprado: true }), item('i', { tipo: 'inversor', comprado: true })];
  return p;
};

beforeEach(() => {
  h.privadas = new Map(); h.estados = new Map(); h.arquivos = []; h.leituras = []; h.gravacoes = 0; h.falhaCard = 0;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('B2: o "Falta" da escalada não cobra item opcional', () => {
  it('na Compra, o kit pendente aparece e o "material elétrico" (opcional) não', async () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [item('m', { tipo: 'modulo' }), item('i', { tipo: 'inversor', comprado: true })];
    h.privadas.set(7, p);
    const falta = await faltaDaObra(obraDe(7, 4), new Map());
    expect(falta).toHaveLength(1);
    expect(falta[0]).toContain('Kit');
    expect(falta.join(' ')).not.toContain('Material elétrico');
  });
});

describe('B5: o cron da fila registra os portões em silêncio antes de montar a fila', () => {
  it('a obra que já cumpriu o portão da Compra avança com autor `leitura`; a fila lê a etapa nova; nenhum aviso "É sua" nasce disso', async () => {
    h.privadas.set(7, kitComprado());
    const o = obraDe(7, 4);
    const [novo] = await sincronizarPortoesDaFila([o], new Date(AGORA));
    expect(h.gravacoes).toBe(1);
    expect(novo.jo?.etapas[4]).toMatchObject({ concluida_por: 'leitura' });
    expect(novo.jo?.etapas[5].aberta_em).toBe(AGORA);
    expect(etapaAtualCompleta(novo.js, novo.jo, null)).toBe(5);
    expect(novo.jo?.historico.filter((x) => x.acao !== 'materializada').every((x) => x.por === 'leitura')).toBe(true);
    // O robô "É sua" não dispara por autor `leitura`.
    const ligados = { venda: null, etapa: '2026-11-01T00:00:00.000Z', fila: '2026-11-01T00:00:00.000Z', liberacao: null, aniversario: null };
    const eventos = eventosDoCard({ card: 7, js: novo.js, jo: novo.jo, vendedor: 'nilce' }, new Date(AGORA), ligados);
    expect(eventos.filter((e) => e.tipo === 'sua')).toEqual([]);
  });

  it('idempotente: sem mudança, nada é gravado; conta fechada, cancelada, sem estado e etapa fora de 4 a 7 nem são lidas', async () => {
    h.privadas.set(7, obraPrivadaVazia());   // nada cumprido
    h.privadas.set(8, kitComprado());
    const obras = [
      obraDe(7, 4),
      obraDe(8, 4, { jo: { ...obraMaterializada(8, 4, AGORA, AGORA), fechada: { em: AGORA, por: 'thiago' } } }),
      obraDe(9, 4, { cancelada: true }),
      obraDe(10, 4, { jo: null }),
      obraDe(11, 8),
    ];
    const r = await sincronizarPortoesDaFila(obras, new Date(AGORA));
    expect(h.gravacoes).toBe(0);
    expect(h.leituras).toEqual([7]);
    expect(r.map((x) => x.card)).toEqual([7, 8, 9, 10, 11]);
    expect(r[0].jo).toBe(obras[0].jo);
  });

  it('a obra que falha na leitura segue com o estado que tinha e as outras seguem', async () => {
    h.privadas.set(7, kitComprado()); h.privadas.set(8, kitComprado());
    h.falhaCard = 7;
    const obras = [obraDe(7, 4), obraDe(8, 4)];
    const r = await sincronizarPortoesDaFila(obras, new Date(AGORA));
    expect(r[0].jo).toBe(obras[0].jo);
    expect(etapaAtualCompleta(r[1].js, r[1].jo, null)).toBe(5);
    expect(h.gravacoes).toBe(1);
  });
});
