import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O que estes testes trancam.
//
// São quatro peças novas (10/09/2026) que existem por causa de apagões com data:
//
//  · anthropicClient — em 07, 08 e 10/08/2026 o crédito da Anthropic zerou e os 31
//    `new Anthropic()` espalhados emudeceram juntos. A fábrica existe para trocar de
//    rota por env. O que NÃO pode acontecer: chave de terceiro (a que chega por
//    requisição no /admin) vazar para o nosso Gateway.
//
//  · env — a variável crítica que falta e o código contorna, deixando o sistema de
//    pé mentindo. O que NÃO pode acontecer: a conferência derrubar a API sozinha.
//
//  · tentarDeNovo — o Instagram devolve 500/code 1 e MANDA a mensagem assim mesmo.
//    Retry cego ali dobra a DM do lead. O disjuntor `entregaIncerta` é o ponto todo.
//
//  · filaPgBoss — nasce desligada. O que NÃO pode acontecer: ela responder alguma
//    coisa com o interruptor fora e desviar entrega de mensagem real.

import {
  novoAnthropic,
  rotaIA,
  vaiAdiantarTrocarDeRota,
} from '../utils/anthropicClient';
import { conferirEnv, verificarEnv } from '../utils/env';
import { tentarDeNovo, ehFalhaPassageira } from '../utils/tentarDeNovo';
import { pgBossLigado, obterBoss, enfileirarEnvio, consumirEnvios } from '../services/agents/whatsapp/filaPgBoss';

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV_ORIGINAL };
});
afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('fábrica de cliente de IA', () => {
  it('sem AI_GATEWAY_API_KEY fala direto com a Anthropic, como antes', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
    expect(rotaIA()).toBe('direto');
    const cli = novoAnthropic();
    expect(cli.baseURL).toContain('api.anthropic.com');
  });

  it('com AI_GATEWAY_API_KEY passa a falar pelo Gateway — sem tocar em código', () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-teste';
    expect(rotaIA()).toBe('gateway');
    expect(novoAnthropic().baseURL).toBe('https://ai-gateway.vercel.sh/v1/anthropic');
  });

  it('chave que chega por requisição NUNCA passa pelo nosso Gateway', () => {
    // O /admin aceita chave do próprio usuário em algumas rotas. Mandar ela pro
    // nosso Gateway seria cobrar no nosso contrato e vazar chave de terceiro.
    process.env.AI_GATEWAY_API_KEY = 'gw-teste';
    const cli = novoAnthropic('sk-ant-de-terceiro');
    expect(cli.baseURL).toContain('api.anthropic.com');
    expect(cli.baseURL).not.toContain('ai-gateway');
  });

  it('trocar de rota adianta em crédito e limite, não em chave recusada', () => {
    expect(vaiAdiantarTrocarDeRota(new Error('credit balance is too low'))).toBe(true);
    expect(vaiAdiantarTrocarDeRota(new Error('429 rate_limit_error'))).toBe(true);
    expect(vaiAdiantarTrocarDeRota(new Error('529 overloaded_error'))).toBe(true);
    // Chave errada não melhora em outra rota — só gasta tempo.
    expect(vaiAdiantarTrocarDeRota(new Error('401 authentication_error'))).toBe(false);
    expect(vaiAdiantarTrocarDeRota(new Error('invalid_request_error'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('conferência de variáveis de ambiente', () => {
  const COMPLETO = {
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: '0123456789abcdef',
    ANTHROPIC_API_KEY: 'sk-ant-x',
    SUPABASE_URL: 'https://a.supabase.co',
    STRIPE_SECRET_KEY: 'sk_live_x',
    ZAPI_INSTANCE_ID_IO: '1',
    ZAPI_TOKEN_IO: 't',
    DASHBOARD_URL: 'https://d.co',
  } as NodeJS.ProcessEnv;

  it('acusa exatamente as críticas que faltam', () => {
    const r = conferirEnv({} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('ANTHROPIC_API_KEY');
    expect(r.faltando).toContain('DATABASE_URL');
  });

  it('separa "falta" de "dívida conhecida"', () => {
    // Dívida não impede funcionar — impede saber. Misturar as duas faz o aviso
    // virar barulho e treina a pessoa a ignorar.
    const r = conferirEnv(COMPLETO);
    expect(r.ok).toBe(true);
    expect(r.faltando).toEqual([]);
    expect(r.dividas).toContain('SENTRY_DSN');
    expect(r.dividas).toContain('SUPABASE_GERADOR_SERVICE_KEY');
  });

  it('string vazia conta como ausente — env vazia na Vercel é o caso comum', () => {
    const r = conferirEnv({ ...COMPLETO, ANTHROPIC_API_KEY: '   ' } as NodeJS.ProcessEnv);
    expect(r.faltando).toContain('ANTHROPIC_API_KEY');
  });

  it('POR PADRÃO avisa e segue — nunca derruba a API sozinha', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => verificarEnv({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('só derruba com ENV_STRICT=true, que é uma decisão explícita', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => verificarEnv({ ENV_STRICT: 'true' } as NodeJS.ProcessEnv)).toThrow(/ENV_STRICT/);
    // Com tudo presente, o estrito passa reto.
    expect(() => verificarEnv({ ...COMPLETO, ENV_STRICT: 'true' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('retry com disjuntor de entrega incerta', () => {
  it('classifica passageiro e definitivo', () => {
    expect(ehFalhaPassageira(new Error('429 too many requests'))).toBe(true);
    expect(ehFalhaPassageira(new Error('ETIMEDOUT'))).toBe(true);
    expect(ehFalhaPassageira(new Error('fetch failed'))).toBe(true);
    expect(ehFalhaPassageira(new Error('400 invalid phone'))).toBe(false);
  });

  it('insiste na falha passageira e devolve o resultado', async () => {
    let n = 0;
    const r = await tentarDeNovo(
      async () => {
        n++;
        if (n < 3) throw new Error('503 service unavailable');
        return 'entregue';
      },
      { esperaInicialMs: 1, esperaMaximaMs: 2, rotulo: 'zapi' }
    );
    expect(r).toBe('entregue');
    expect(n).toBe(3);
  });

  it('NÃO insiste quando a falha pode ter entregue — o 500/code 1 do Instagram', async () => {
    // Este é o teste que importa. A Meta devolve 500 e manda a DM assim mesmo:
    // repetir aqui faz o lead receber duas vezes.
    let n = 0;
    await expect(
      tentarDeNovo(
        async () => {
          n++;
          throw new Error('500 code 1');
        },
        {
          esperaInicialMs: 1,
          entregaIncerta: (e) => /\b500\b/.test(String((e as Error).message)),
          rotulo: 'instagram',
        }
      )
    ).rejects.toThrow(/pode ter entregue/);
    expect(n).toBe(1);
  });

  it('não insiste em erro definitivo — telefone inválido não melhora repetindo', async () => {
    let n = 0;
    await expect(
      tentarDeNovo(
        async () => {
          n++;
          throw new Error('400 invalid phone number');
        },
        { esperaInicialMs: 1 }
      )
    ).rejects.toThrow(/invalid phone/);
    expect(n).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('fila em Postgres nasce desligada', () => {
  it('sem FILA_PGBOSS, tudo responde "use o caminho antigo"', async () => {
    delete process.env.FILA_PGBOSS;
    expect(pgBossLigado()).toBe(false);
    expect(await obterBoss()).toBeNull();
    // O `null` aqui é o contrato: quem chama segue pela fila viva de `wa_mensagens`.
    expect(await enfileirarEnvio({ telefone: '5534999999999', texto: 'oi' })).toBeNull();
    expect(await consumirEnvios(async () => {})).toBe(false);
  });

  it('ligado mas sem DATABASE_URL também não desvia entrega', async () => {
    // Meia configuração não pode engolir mensagem: sem banco, volta pro antigo.
    process.env.FILA_PGBOSS = 'true';
    delete process.env.DATABASE_URL;
    expect(pgBossLigado()).toBe(true);
    expect(await obterBoss()).toBeNull();
    expect(await enfileirarEnvio({ telefone: '5534999999999', texto: 'oi' })).toBeNull();
  });
});
