import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Limite por IP em /quiz/agora e /quiz/agendar (24/10/2026): quem cria card da Nilce não pode fazê-lo em massa com celulares aleatórios.
// Fora dos testes o limitador vale; aqui ele é ligado de propósito e o teto vem da env.

describe('quizCardLimiter', () => {
  it('passa até o teto da hora e depois responde 429; a sonda com teste:true e o header fica fora da conta', async () => {
    vi.resetModules();
    process.env.QUIZ_CARD_LIMITE_NO_TESTE = '1';
    process.env.QUIZ_CARD_MAX_HORA = '3';
    const { quizCardLimiter } = await import('../middleware/rateLimiter');
    const app = express();
    app.use(express.json());
    app.post('/x', quizCardLimiter, (_q, r) => { r.json({ ok: true }); });
    const codigos: number[] = [];
    for (let i = 0; i < 5; i++) codigos.push((await request(app).post('/x').send({})).status);
    expect(codigos).toEqual([200, 200, 200, 429, 429]);
    // A sonda fica fora da conta (a rota devolve 401 para segredo errado, então o header não abre nada).
    expect((await request(app).post('/x').set('x-cron-secret', 'qualquer').send({ teste: true })).status).toBe(200);
    delete process.env.QUIZ_CARD_LIMITE_NO_TESTE; delete process.env.QUIZ_CARD_MAX_HORA;
  });
  it('as duas rotas que criam card usam o limitador', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(__dirname, '../routes/ioSolar.ts'), 'utf8');
    expect(fonte).toContain("router.post('/quiz/agora', quizCardLimiter,");
    expect(fonte).toContain("router.post('/quiz/agendar', quizCardLimiter,");
  });
});
