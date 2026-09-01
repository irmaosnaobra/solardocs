import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));

import { chaveContato } from '../services/agents/whatsapp/silenciar';

// ═══════════════════════════════════════════════════════════════════════════
// A chave de contato.
//
// Este é o bug mais silencioso do sistema de supressão, e o mais caro: falha de
// chave não dá erro, dá silêncio do lado errado. Quem pediu para parar volta a
// receber e ninguém fica sabendo, até virar denúncia.
//
// A regra antiga casava por slice(-10). No Brasil isso quebra, porque a Z-API
// alterna o nono dígito entre mensagens do MESMO contato. Foi medido: 3.043
// registros de 13 dígitos convivendo com os de 12 na mesma base.
// ═══════════════════════════════════════════════════════════════════════════

describe('chaveContato', () => {
  it('o mesmo celular com e sem o nono dígito dá a MESMA chave', () => {
    // O caso que a regra antiga errava: slice(-10) daria "4991360172" e
    // "3491360172", duas chaves para o mesmo telefone.
    expect(chaveContato('5534991360172')).toBe(chaveContato('553491360172'));
    expect(chaveContato('5534991360172')).toBe('3491360172');
  });

  it('sobrevive a DDI, espaço, parênteses e traço', () => {
    const esperado = chaveContato('5534991360172');
    for (const forma of [
      '+55 34 99136-0172',
      '(34) 99136-0172',
      '34991360172',
      '5534991360172@c.us',
    ]) {
      expect(chaveContato(forma), forma).toBe(esperado);
    }
  });

  it('telefones diferentes no mesmo DDD não colidem', () => {
    expect(chaveContato('5534991360172')).not.toBe(chaveContato('5534991360223'));
  });

  it('o mesmo número em DDDs diferentes não colide', () => {
    // Sem o DDD na chave, dois assinantes distintos do país virariam a mesma
    // pessoa e um deles seria silenciado por engano.
    expect(chaveContato('5534991360172')).not.toBe(chaveContato('5511991360172'));
  });

  it('id de grupo não vira contato', () => {
    // Grupos têm 18 dígitos e nenhum DDD. Tratar como pessoa silenciaria um
    // grupo inteiro por engano.
    expect(chaveContato('120363424419098566')).toBeNull();
  });

  it('lixo e vazio devolvem null, e null nunca casa', () => {
    for (const v of ['', '   ', null, undefined, '123', 'abc']) {
      expect(chaveContato(v as string)).toBeNull();
    }
  });

  it('fixo de 8 dígitos com DDD continua identificável', () => {
    expect(chaveContato('553432221100')).toBe('3432221100');
  });
});
