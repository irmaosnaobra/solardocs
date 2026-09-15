import { describe, it, expect } from 'vitest';
import { montarMensagem } from '../routes/ioEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// O card que o Thiago e o Diego recebem quando a LP do eletroposto marca reunião.
// Desde 15/09/2026 a nota vem só do ponto (11/11 dono, 10/11 quem administra,
// representa ou aluga, 9/11 local em negociação) e é a linha do modelo que diz qual
// conversa é. A ficha é texto
// escrito pela LP: cada rótulo aqui é o mesmo string de `obs` no index.html.
// ─────────────────────────────────────────────────────────────────────────────

const ficha = (linhas: string[], extra: Record<string, unknown> = {}) => ({
  quando: '2026-09-16T17:00:00Z', vendedor_nome: 'Diego', cliente_nome: 'Fulano',
  cliente_telefone: '+55 34 99999-0000', cidade: 'Uberlândia-MG', temperatura: 'quente',
  observacao: linhas.join('\n'), ...extra,
});

describe('montarMensagem — card da reunião de eletroposto', () => {
  it('ponto próprio: prioridade com 11/11 e a linha do modelo', () => {
    const msg = montarMensagem(ficha([
      'LP ELETROPOSTO · Dono de posto de combustível',
      'NOTA 3 · 11/11 pts',
      'Endereço: Av. Brasil, 100 · Centro · Uberlândia-MG',
      'Ponto: Já tenho o ponto definido',
      'Local é seu: Sou o proprietário',
      'Modelo de interesse: 02 · Sociedade meio a meio',
      'Como pretende investir: Recurso próprio',
    ]));
    expect(msg).toContain('*NOTA 3 — PRIORIDADE*  (11/11 pts)');
    expect(msg).toContain('*Modelo:* 02 · Sociedade meio a meio');
    // o prefixo da LP usa ponto médio: o card não pode repetir "LP ELETROPOSTO" no perfil
    expect(msg).toContain('*Perfil:* Dono de posto de combustível');
  });

  it('local em negociação: 9/11, com endereço, e nunca como nutrição', () => {
    const msg = montarMensagem(ficha([
      'LP ELETROPOSTO · Investidor',
      'NOTA 3 · 9/11 pts',
      'Endereço: Rua X, 5 · Bairro · Uberlândia-MG',
      'Ponto: Tenho um local em negociação com o proprietário',
      'Local é seu: Estou negociando com o proprietário',
      'Modelo de interesse: 01 · Cedo o espaço e vocês investem 100%',
      'Como pretende investir: Não se aplica · modelo 01, a NEXUS investe 100%',
    ]));
    expect(msg).toContain('(9/11 pts)');
    expect(msg).toContain('*Endereço:* Rua X, 5');
    expect(msg).toContain('*Local é seu:* Estou negociando com o proprietário');
    expect(msg).toContain('*Como pretende investir:* Não se aplica');
    expect(msg).not.toContain('NUTRIÇÃO');
  });

  it('ficha antiga, sem modelo nem nota: não inventa linha e usa a temperatura', () => {
    const msg = montarMensagem(ficha(
      ['LP ELETROPOSTO — Outro', 'Simulou 80 kW com 10 carros/dia'],
      { temperatura: 'morno' },
    ));
    expect(msg).not.toContain('*Modelo:*');
    expect(msg).toContain('*NOTA 2');
    expect(msg).toContain('*Perfil:* Outro');
  });

  it('vagas e valor (15/09): entram no card quando a ficha traz, e só então', () => {
    const msg = montarMensagem(ficha([
      'LP ELETROPOSTO · Estacionamento',
      'NOTA 3 · 11/11 pts',
      'Ponto: Já tenho o ponto definido',
      'Local é seu: Sou o proprietário',
      'Vagas disponíveis: 6 a 10',
      'Modelo de interesse: 03 · Chave na mão, o eletroposto é meu',
      'Como pretende investir: Recurso próprio',
      'Quanto pretende investir: R$ 280 mil',
    ]));
    expect(msg).toContain('*Vagas:* 6 a 10');
    expect(msg).toContain('*Quanto pretende investir:* R$ 280 mil');
    const semNada = montarMensagem(ficha(['LP ELETROPOSTO · Investidor', 'NOTA 3 · 9/11 pts']));
    expect(semNada).not.toContain('*Vagas:*');
    expect(semNada).not.toContain('*Quanto pretende investir:*');
  });
});
