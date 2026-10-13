import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { etiquetaDeLead } from '../services/agenda/origemEtiqueta';

// A ETIQUETA DE CHEGADA É SÓ UMA PRÉ-SELEÇÃO (13/10/2026). Regra do dono: "quando o lead
// cai com uma etiqueta, ele não precisa manter pra sempre: pode cair COTISTA e depois da
// reunião virar um CHAVE NA MÃO". O card chega agendado com a etiqueta já escolhida; quando
// o consultor escolhe outra, o card passa a mostrar só a nova.
//   · o tipo (`tipo_card:<id>`) só é mostrado enquanto o status não é de negócio nem terminal;
//   · a ORIGEM do card da Helena é "EP Helena": origem nunca muda, então não pode dizer COTISTA.
// A agenda é HTML com script inline: o teste extrai o código REAL dela, não uma cópia.

const GERADOR = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador');
const html = readFileSync(join(GERADOR, 'agenda', 'index.html'), 'utf8').split('\r\n').join('\n');

const fatia = (de: string, ate: string): string => {
  const i = html.indexOf(de), j = html.indexOf(ate, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu da agenda: "${de}" … "${ate}"`);
  return html.slice(i, j);
};

interface Ag { id: number; status: string; created_by?: string }
interface Tela {
  pillStatus: (ag: Ag, curto?: boolean) => string;
  pillTipoDoCard: (ag: Ag) => string;
  set: (etiquetas: Record<string, string>, tipos: Record<string, string>) => void;
}

const tela = (): Tela => new Function(
  'let etiquetasCache = {}; let tiposCache = {};\n'
  // o que pillStatus lê de fora e não interessa aqui
  + 'const semRespostaDoLead = () => false, pillEspera = () => "", pillMotivo = () => "", pillCaminhoQuiz = () => "", foraDoPadrao = () => false;\n'
  + fatia('const ETIQUETAS_NEGOCIO = new Set([', '/** Quem aceita motivo de recusa.')
  + fatia('const STATUS_TERMINAIS = new Set([', 'let slotAtual')
  + fatia('const ETIQUETA_STATUS = {', '/** APRESENTAÇÃO:')
  + fatia('function pillEtiquetaGuardada(ag) {', '/** 13/10/2026: o TIPO com que o card nasceu')
  + fatia('function pillTipoDoCard(ag) {', '\n/**\n * ── CINCO ESTADOS')
  + fatia('function pillStatus(ag, curto) {', 'function semRespostaDoLead(ag)')
  + '\nreturn { pillStatus, pillTipoDoCard, set: (e, t) => { etiquetasCache = e; tiposCache = t; } };',
)() as Tela;

const T = tela();
const rotulos = (h: string): string[] => [...h.matchAll(/<span class="tag-modelo">([^<]*)<\/span>/g)].map(m => m[1]!);
const conta = (h: string, txt: string): number => rotulos(h).filter(r => r === txt).length;

describe('agenda: a pílula do tipo é pré-seleção', () => {
  it('card agendado que chegou COTISTA (LP: etiqueta guardada + tipo) mostra COTISTA uma vez', () => {
    T.set({ '1': 'cotista' }, { '1': 'cotista' });
    const h = T.pillStatus({ id: 1, status: 'agendado', created_by: 'lp_eletroposto' });
    expect(conta(h, 'COTISTA')).toBe(1);
  });

  it('card agendado da Helena (só tipo) mostra COTISTA uma vez', () => {
    T.set({}, { '2': 'cotista' });
    const h = T.pillStatus({ id: 2, status: 'agendado', created_by: 'agente_eletroposto' });
    expect(conta(h, 'COTISTA')).toBe(1);
  });

  it('o mesmo card marcado "Chave na mão" mostra só o novo: nenhuma pílula COTISTA', () => {
    // a tela apaga a etiqueta guardada ao escolher um status de negócio; o tipo fica no banco
    T.set({}, { '2': 'cotista' });
    const h = T.pillStatus({ id: 2, status: 'chave_na_mao', created_by: 'agente_eletroposto' });
    expect(rotulos(h)).toEqual(['CHAVE NA MÃO']);
    expect(h).not.toContain('COTISTA');
    expect(T.pillTipoDoCard({ id: 2, status: 'chave_na_mao' })).toBe('');
  });

  it('vale para qualquer status de negócio, e o tipo some mesmo se for diferente do status', () => {
    for (const st of ['arrendamento', 'carregador', 'meio_a_meio', 'chave_na_mao', 'cotista', 'integrador',
      'em_atendimento', 'proposta_apresentada', 'fez_orcamento', 'falando_whatsapp']) {
      T.set({}, { '3': 'integrador' });
      expect(T.pillTipoDoCard({ id: 3, status: st }), st).toBe('');
    }
  });

  it('card terminal com etiqueta guardada continua como hoje (a guardada, o status; nunca o tipo)', () => {
    T.set({ '4': 'arrendamento' }, { '4': 'cotista' });
    const h = T.pillStatus({ id: 4, status: 'sem_interesse', created_by: 'lp_eletroposto' });
    expect(rotulos(h)).toEqual(['ARRENDAMENTO', 'SEM INTERESSE']);
    for (const st of ['sem_interesse', 'fechou', 'cancelado', 'perdido', 'fechou_concorrente']) {
      expect(T.pillTipoDoCard({ id: 4, status: st }), st).toBe('');
    }
  });

  it('status que não é de negócio nem terminal (nao_atendeu, apalavrado) ainda mostra o tipo', () => {
    T.set({}, { '5': 'integrador' });
    expect(rotulos(T.pillStatus({ id: 5, status: 'nao_atendeu' }))).toContain('INTEGRADOR');
    expect(T.pillTipoDoCard({ id: 5, status: 'apalavrado' })).toContain('INTEGRADOR');
  });

  it('não repete o texto da etiqueta guardada que já está desenhada', () => {
    T.set({ '6': 'integrador' }, { '6': 'integrador' });
    expect(conta(T.pillStatus({ id: 6, status: 'agendado' }), 'INTEGRADOR')).toBe(1);
  });

  it('sem tipo guardado, ou tipo desconhecido, nada é desenhado', () => {
    T.set({}, { '7': 'qualquer' });
    expect(T.pillTipoDoCard({ id: 7, status: 'agendado' })).toBe('');
    expect(T.pillTipoDoCard({ id: 8, status: 'agendado' })).toBe('');
  });
});

describe('origem do card da Helena: EP Helena, da família EP', () => {
  it('no servidor', () => {
    expect(etiquetaDeLead('agente_eletroposto', null, new Set())).toBe('EP Helena');
    expect(etiquetaDeLead('agente_eletroposto', null, new Set())).not.toMatch(/cotista/i);
  });

  it('no /gerador (etiqueta.js, o gêmeo): mesmo rótulo e a cor da família EP', () => {
    const js = readFileSync(join(GERADOR, 'etiqueta.js'), 'utf8');
    const g = new Function(js + '\nreturn { etiquetaDeLead, etiquetaCor };')() as {
      etiquetaDeLead: (c: string, s?: string | null) => string; etiquetaCor: (e: string) => string;
    };
    expect(g.etiquetaDeLead('agente_eletroposto', null)).toBe('EP Helena');
    expect(g.etiquetaCor('EP Helena')).toBe('ep');
    expect(g.etiquetaCor('EP Helena')).toBe(g.etiquetaCor('EP Convite'));
    expect(g.etiquetaCor('EP Helena').startsWith(g.etiquetaCor('EP Tráfego').split('-')[0]!)).toBe(true);
  });
});
