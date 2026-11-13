import { describe, it, expect, vi } from 'vitest';

// Regra 1.0 (12/11/2026): card `agendado` do lote cuja linha mais recente do historico foi escrita por PESSOA da equipe e cujo
// horario e futuro (ou de ate 24h atras) e reuniao viva. A Helena nao aborda a frio e a agenda nao a esconde.
// Nomes, telefones e ids inventados.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { montarFila, cardReabre, reuniaoDaEquipe, type CardDoContato, type FiltrosDaFila } from '../services/io/investidorAgentePuro';
import { autorDaUltimaLinha, ultimaLinhaEhDePessoa } from '../services/io/investidorAgenteEquipe';
import type { LinhaOrigem } from '../services/io/eletropostoPares';

const AGORA = Date.parse('2026-11-12T15:00:00Z');
const LINHA_ROBO = '[09/11 · 10:15 · Sistema] 🔁 Reagendamento automático (1ª vez): de segunda para terça.';
const LINHA_PESSOA = '[09/11 16h02 · Maria Teste] 📅 Reagendado à mão: 09/11 10:15 → 16/11 14:00.';
const LINHA_HELENA = '[09/11 16h02 · Helena] Reunião marcada pela Helena.';

const lote = (id: number, historico: string | null, quando = '2026-12-01T15:00:00Z'): CardDoContato =>
  ({ id, status: 'agendado', quando, origem: 'cadastro_eletroposto', vendedor: 'Fulano', historico });

describe('quem escreveu a linha mais recente do historico (a primeira do texto: todo escritor poe no topo)', () => {
  it('formato do robo e da pessoa', () => {
    expect(autorDaUltimaLinha(LINHA_ROBO)).toBe('Sistema');
    expect(autorDaUltimaLinha(LINHA_PESSOA)).toBe('Maria Teste');
    expect(autorDaUltimaLinha(LINHA_HELENA)).toBe('Helena');
  });
  it('vale a primeira linha, nao a ultima do texto', () => {
    expect(ultimaLinhaEhDePessoa(`${LINHA_ROBO}\n\n${LINHA_PESSOA}`)).toBe(false);
    expect(ultimaLinhaEhDePessoa(`${LINHA_PESSOA}\n\n${LINHA_ROBO}`)).toBe(true);
  });
  it('robo (Sistema, Helena) nao e pessoa; sem carimbo ou vazio tambem nao', () => {
    for (const h of [LINHA_ROBO, LINHA_HELENA, '', null, undefined, 'texto solto sem carimbo', '[sem autor] oi']) expect(ultimaLinhaEhDePessoa(h)).toBe(false);
  });
  it('nota da pessoa com varias linhas: vale o carimbo da primeira', () => {
    expect(ultimaLinhaEhDePessoa('[10/11 09h00 · Maria Teste] ligou\nmais uma linha da nota\n\n' + LINHA_ROBO)).toBe(true);
  });
});

describe('cardReabre / reuniaoDaEquipe', () => {
  it('lote com ultima linha de pessoa e quando futuro: reuniao viva, nao reabre', () => {
    const c = lote(1, `${LINHA_PESSOA}\n\n${LINHA_ROBO}`);
    expect(reuniaoDaEquipe(c, AGORA)).toBe(true);
    expect(cardReabre(c, AGORA)).toBe(false);
  });
  it('lote com ultima linha do Sistema (ou sem historico lido): segue lote mudo e reabre', () => {
    expect(cardReabre(lote(2, `${LINHA_ROBO}\n\n${LINHA_PESSOA}`), AGORA)).toBe(true);
    expect(cardReabre(lote(3, null), AGORA)).toBe(true);
    expect(cardReabre({ id: 4, status: 'agendado', quando: '2026-12-01T15:00:00Z', origem: 'cadastro_eletroposto', vendedor: null }, AGORA)).toBe(true);
  });
  it('ultima linha de pessoa com quando de 30h atras: volta a ser nao atendido; de 23h atras ainda e viva', () => {
    expect(cardReabre(lote(5, LINHA_PESSOA, '2026-11-11T09:00:00Z'), AGORA)).toBe(true);
    expect(cardReabre(lote(6, LINHA_PESSOA, '2026-11-11T16:00:00Z'), AGORA)).toBe(false);
  });
  it('so vale para agendado do lote: cancelado com linha de pessoa segue reabrindo', () => {
    expect(cardReabre({ ...lote(7, LINHA_PESSOA), status: 'cancelado' }, AGORA)).toBe(true);
  });
});

describe('montarFila com a regra 1.0', () => {
  const cad = (id: number, nome: string, telefone: string): LinhaOrigem =>
    ({ origem: 'parceria', r: { id, nome, telefone, capital_faixa: 'R$ 140 mil', lado: 'capital', status: 'novo', cidade: 'Cidade Exemplo', created_at: '2026-09-01T12:00:00Z' } });
  const livre: FiltrosDaFila = {
    cards: new Map(), comSessao: new Set(), retorno: new Set(), comConversa: new Set(),
    silenciado: () => false, bloqueado: () => false, mudo: () => false, comHumano: () => false, agora: AGORA,
  };

  it('a reuniao da equipe sai da fila com motivo proprio; o lote do Sistema fica; os dois cards de uma pessoa contam juntos', () => {
    const linhas = [cad(1, 'Pessoa Viva', '5534999990001'), cad(2, 'Pessoa Muda', '5534999990002'), cad(3, 'Pessoa Mista', '5534999990003')];
    const r = montarFila(linhas, {
      ...livre,
      cards: new Map([
        ['3499990001', [lote(10, LINHA_PESSOA)]],
        ['3499990002', [lote(11, LINHA_ROBO)]],
        ['3499990003', [lote(12, LINHA_ROBO), lote(13, LINHA_PESSOA)]],
      ]),
    });
    expect(r.fila.map(c => c.nome)).toEqual(['Pessoa Muda']);
    expect(r.excluidos).toMatchObject({ reuniao_da_equipe: 2 });
    expect(r.excluidos.reuniao_real).toBeUndefined();
  });
});
