// A IA de contrato do gerador escreve pelas REGRAS_CONTRATO (contratoRegras.ts):
// o texto das regras entra nos dois prompts e o "português jurídico formal" saiu.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: vi.fn() }));

import { REGRAS_CONTRATO } from '../services/gerador/contratoRegras';
import { sistemaPara, OUTROS_CONTRATOS } from '../services/gerador/contratoIa';
import { SISTEMA_AGENTE, BLOCOS_SISTEMA } from '../services/gerador/contratoAgente';

describe('prompts da IA de contrato leem as regras da casa', () => {
  it('o redesenhar traz as REGRAS_CONTRATO em todos os modelos', () => {
    expect(sistemaPara()).toContain(REGRAS_CONTRATO);
    for (const t of Object.keys(OUTROS_CONTRATOS)) {
      expect(sistemaPara(t as keyof typeof OUTROS_CONTRATOS), t).toContain(REGRAS_CONTRATO);
    }
  });
  it('o agente traz as REGRAS_CONTRATO, no bloco com cache_control', () => {
    expect(SISTEMA_AGENTE).toContain(REGRAS_CONTRATO);
    expect(BLOCOS_SISTEMA).toHaveLength(1);
    expect(BLOCOS_SISTEMA[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(BLOCOS_SISTEMA[0].text).toContain(REGRAS_CONTRATO);
  });
  it('nenhum prompt manda escrever em "jurídico formal"', () => {
    const todos = [sistemaPara(), ...Object.keys(OUTROS_CONTRATOS).map(t => sistemaPara(t as keyof typeof OUTROS_CONTRATOS)), SISTEMA_AGENTE];
    for (const p of todos) expect(p.toLowerCase()).not.toContain('jurídico formal');
  });
  it('as regras técnicas continuam nos dois prompts', () => {
    for (const p of [sistemaPara(), SISTEMA_AGENTE]) {
      expect(p).toContain('{{c:KEY}}');
      expect(p).toContain('travad');
    }
    expect(SISTEMA_AGENTE).toContain('VALOR E PERCENTUAL SÓ MUDAM PELO CAMPO');
  });
});
