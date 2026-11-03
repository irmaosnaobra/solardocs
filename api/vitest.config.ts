import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    // Muitos testes importam controller/serviço pesado (vi.resetModules + import dinâmico).
    // Com a máquina ou o runner carregados, os 5 s padrão estouram sem bug nenhum e o
    // teste vira vermelho por tempo. Folga só em tempo: nenhuma asserção muda.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
