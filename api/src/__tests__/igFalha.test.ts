import { describe, it, expect } from 'vitest';

// igFalha é puro (só string do erro entra) — a regra que decide reenviar,
// ficar quieto ou desistir tem que estar coberta: foi ela que dobrou a DM.
import { classificarFalha } from '../services/instagram/igFalha';

// Erro real da fila (ig_queue, 05/08/2026) — o lead recebeu a mensagem DUAS
// vezes e a linha ficou marcada 'failed'.
const CODE_1 = 'sendMessage 500: {"error":{"message":"An unknown error has occurred.","type":"OAuthException","code":1,"fbtrace_id":"Ae9iTwUsCKcH8715KE415OO"}}';
const JANELA = 'sendMessage 403: {"error":{"message":"This message is sent outside of allowed window.","type":"IGApiException","code":10,"error_subcode":2534022}}';
const SEM_USUARIO = 'sendMessage 400: {"error":{"message":"The requested user cannot be found.","type":"IGApiException","code":100,"error_subcode":2534014}}';

describe('classificação da falha de envio', () => {
  it('500 + code 1 é INCERTO — a Meta entrega e devolve erro assim mesmo', () => {
    expect(classificarFalha(CODE_1)).toBe('incerto');
  });

  it('janela fechada e usuário inexistente são falha de verdade', () => {
    // Só nesses vale o "me chama no direct" público: a DM não saiu mesmo.
    expect(classificarFalha(JANELA)).toBe('fatal');
    expect(classificarFalha(SEM_USUARIO)).toBe('fatal');
  });

  it('só reenvia sem botão quando a Meta cita o quick_replies', () => {
    expect(classificarFalha('sendMessage 400: {"error":{"message":"Invalid quick_replies: title too long","code":100}}')).toBe('sem_botao');
    // …e não quando o erro é o genérico de sempre — era esse reenvio cego que
    // colocava a mesma mensagem duas vezes no celular da pessoa.
    expect(classificarFalha(CODE_1)).not.toBe('sem_botao');
  });

  it('code 2 (downtime da Meta) e queda de rede também ficam no incerto', () => {
    expect(classificarFalha('sendMessage 400: {"error":{"message":"Service temporarily unavailable","code":2}}')).toBe('incerto');
    expect(classificarFalha('fetch failed')).toBe('incerto');
  });

  it('erro sem status nem code conhecido não vira reenvio', () => {
    expect(classificarFalha('deu ruim')).toBe('fatal');
  });
});
