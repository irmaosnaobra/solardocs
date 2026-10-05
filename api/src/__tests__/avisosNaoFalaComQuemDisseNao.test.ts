import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  precisaPerguntarDoDono, STATUS_DISSE_NAO, STATUS_LOCAL_OCUPADO,
} from '../services/io/eletropostoPares';

// ── "SEM INTERESSE, EU NÃO QUERO FALAR COM ESSA PESSOA" (05/10/2026) ────────
//
// Ordem do dono, repetida três vezes no mesmo dia.
//
// O MENU DE AVISOS JÁ TINHA ESSA REGRA e ela não valia pro público `sem_dono`.
// Em `avisosTickService` está escrito, com estas palavras:
//
//     if (String(r.status || '') === 'sem_interesse') continue;
//     // a equipe já marcou que não quer
//
// Só que a linha que vem da agenda chega lá com `status: null`, de propósito, pra
// não ser descartada por um desfecho de REUNIÃO. Resultado: `'' !==
// 'sem_interesse'`, a pessoa passa, e a mensagem sai.
//
// Medido no dia, replicando a audiência contra a base: de 111 contatos do
// público `sem_dono`, **37 estavam em `sem_interesse`**. Um em cada três.
//
// Isto não foi achado por teste nem por grep de uma lista: foi achado seguindo o
// caminho de um dado (`status`) de onde ele nasce até onde ele é lido. Duas peças
// do mesmo módulo concordavam na intenção e discordavam no efeito, e cada uma
// estava certa sozinha.

const ficha = (status: string) => ({
  cliente_nome: 'Fulano',
  // `temEndereco` e `respondeuDeQuemE` leem a observação: endereço presente e a
  // pergunta do dono SEM resposta é o que põe alguém na audiência.
  observacao: 'LP ELETROPOSTO · Posto\nEndereço: Rua X, 100 · Centro · Uberlândia-MG',
  ponto_relacao: null,
  status,
});

describe('o Menu de Avisos nao fala com quem disse nao', () => {
  it('card em sem_interesse FICA FORA da audiencia', () => {
    expect(precisaPerguntarDoDono('agenda', ficha('sem_interesse'))).toBe(false);
  });

  it('card em perdido tambem', () => {
    expect(precisaPerguntarDoDono('agenda', ficha('perdido'))).toBe(false);
  });

  it('e os dois que ja estavam cortados continuam cortados', () => {
    expect(precisaPerguntarDoDono('agenda', ficha('fechou'))).toBe(false);
    expect(precisaPerguntarDoDono('agenda', ficha('fechou_concorrente'))).toBe(false);
  });

  // ── O CONTROLE. Sem ele, um corte que barrasse TODO MUNDO passaria. ───────
  it('card VIVO continua entrando: e pra isso que o publico existe', () => {
    // A conta que criou este público, medida em 28/09: de 120 reuniões da LP que
    // responderam "sou o proprietário", 108 morreram sem ninguém perguntar de
    // quem era o local. Cortar demais aqui mata o módulo.
    for (const st of ['agendado', 'nao_atendeu', 'em_atendimento', 'proposta_apresentada',
      'chave_na_mao', 'carregador', 'meio_a_meio']) {
      expect(precisaPerguntarDoDono('agenda', ficha(st)), st + ' deixou de entrar').toBe(true);
    }
  });

  it('`arrendamento` fica fora, e NAO e pelo corte novo', () => {
    // Este controle me pegou: eu tinha posto `arrendamento` na lista de cima e o
    // teste falhou. Ele é cortado por `ehOpcaoArrendamento`, com razão própria —
    // quem aperta ARRENDAMENTO no card já perguntou de quem é o local, então
    // perguntar de novo é gastar mensagem pra saber o que já se sabe.
    //
    // A distinção importa: se um dia alguém mexer no corte novo e este teste
    // continuar verde, é porque a proteção do `arrendamento` é independente — e é
    // isso que eu quero prender aqui, não o resultado.
    expect(precisaPerguntarDoDono('agenda', ficha('arrendamento'))).toBe(false);
    expect(STATUS_DISSE_NAO.has('arrendamento')).toBe(false);
    expect(STATUS_LOCAL_OCUPADO.has('arrendamento')).toBe(false);
  });

  it('`cancelado` continua DENTRO, e isso e escolha, nao esquecimento', () => {
    // Ele é posto por ROBÔ (a régua do SIM cancela sozinha na 3ª cobrança), não é
    // declaração de ninguém. São 34 pessoas com endereço. Se o dono mandar cortar,
    // o lugar é `STATUS_DISSE_NAO` — e este teste cai, avisando que mudou.
    expect(precisaPerguntarDoDono('agenda', ficha('cancelado'))).toBe(true);
    expect(STATUS_DISSE_NAO.has('cancelado')).toBe(false);
  });

  it('o corte vale SO pra origem agenda', () => {
    // Nas outras duas origens `status` é o estágio do CADASTRO, não o desfecho de
    // uma reunião — e lá o `sem_interesse` já é cortado no tick, porque o status
    // chega de verdade.
    const cad = { nome: 'Fulano', ponto_relacao: null, ponto_endereco: 'Rua X, 100', status: 'sem_interesse' };
    expect(precisaPerguntarDoDono('parceria', cad)).toBe(true);
  });

  it('as duas listas nao se misturam: elas respondem perguntas diferentes', () => {
    // `STATUS_LOCAL_OCUPADO` = o local já ganhou carregador, arrendar ali seria
    // alugar ponto ocupado. `STATUS_DISSE_NAO` = a pessoa não quer conversa.
    // Juntar as duas num `Set` só faria o próximo leitor achar que `fechou`
    // significa "disse não", que é o oposto (é venda).
    expect([...STATUS_LOCAL_OCUPADO].sort()).toEqual(['fechou', 'fechou_concorrente']);
    expect([...STATUS_DISSE_NAO].sort()).toEqual(['perdido', 'sem_interesse']);
    expect(STATUS_DISSE_NAO.has('fechou')).toBe(false);
  });
});

// ── A OUTRA PONTA: o corte do tick continua lá, e ele e que explica o porque ─
describe('o corte do tick nao foi apagado', () => {
  const TICK = readFileSync(join(__dirname, '..', 'services', 'io', 'avisosTickService.ts'), 'utf8');

  it('o tick ainda corta `sem_interesse` por nome', () => {
    // Os dois cortes coexistem de propósito: o do tick pega o status do CADASTRO
    // (parceria e curioso), o novo pega o desfecho da REUNIÃO. Apagar um deles
    // reabre metade do buraco, e a metade que reabre é silenciosa.
    expect(TICK).toContain("=== 'sem_interesse') continue");
  });

  it('e a linha que explica por que ele existe continua lá', () => {
    expect(TICK).toMatch(/a equipe j[áa] marcou que n[ãa]o quer/);
  });
});
