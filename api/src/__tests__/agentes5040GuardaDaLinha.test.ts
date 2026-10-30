import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// O guardaDaLinha.ts guarda cópias dos números do vivoEnvio.ts (não importa dele porque os testes trocam o vivoEnvio por mocks).
// Este teste lê o fonte do vivoEnvio e prova que as cópias não se afastaram.
const lerFonte = (nome: string): string => readFileSync(join(__dirname, '..', 'services', 'agentes5040', nome), 'utf8');

describe('guardaDaLinha: os números são os do vivoEnvio', () => {
  const envio = lerFonte('vivoEnvio.ts');
  const guarda = lerFonte('guardaDaLinha.ts');
  const de = (fonte: string, re: RegExp): string => re.exec(fonte)?.[1] ?? '';

  it('as chaves e o prefixo do carimbo', () => {
    expect(de(guarda, /chavePausa:\s*'([^']+)'/)).toBe(de(envio, /CHAVE_LINHA_PAUSA\s*=\s*'([^']+)'/));
    expect(de(guarda, /chaveErros:\s*'([^']+)'/)).toBe(de(envio, /CHAVE_LINHA_ERROS\s*=\s*'([^']+)'/));
    expect(de(guarda, /prefixoCarimbo:\s*'([^']+)'/)).toBe(de(envio, /PREFIXO_CARIMBO\s*=\s*'([^']+)'/));
    expect(de(envio, /CHAVE_LINHA_PAUSA\s*=\s*'([^']+)'/)).toBe('ag5040_linha_pausa');
  });

  it('o espaçamento de 10 s, os 2 erros seguidos e a pausa de 15 min', () => {
    expect(de(guarda, /espacamentoMs:\s*([\d_]+)/)).toBe(de(envio, /espacamentoMs:\s*([\d_]+)/));
    expect(de(guarda, /errosParaPausar:\s*(\d+)/)).toBe(de(envio, /errosParaPausar:\s*(\d+)/));
    expect(de(guarda, /pausaMs:\s*([\d* _]+),/).trim()).toBe(de(envio, /pausaMs:\s*([\d* _]+),/).trim());
  });

  it('não envia nada: nenhum import de módulo de envio além do fichaEnvio (só para o cooldown em memória)', () => {
    const imports = [...guarda.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map(m => m[1]);
    expect(imports.sort()).toEqual(['../../utils/logger', '../../utils/supabase', '../chefe/decidir', './fichaEnvio']);
  });
});
