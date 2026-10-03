import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { STATUS_QUE_NAO_OCUPAM, FILTRO_NAO_OCUPA, STATUS_TERMINAIS } from '../services/agenda/salaDeEspera';

// ── "PERDIDO E SEM INTERESSE FICAM PARADOS ONDE ESTÃO" (03/10/2026) ─────────
//
// Ordem do dono, depois de notar card encerrado ocupando lugar na agenda.
//
// O defeito não era a regra, era a REPETIÇÃO dela. A mesma lista estava escrita à
// mão em DEZ lugares, e em todos como `(cancelado, sem_interesse)`: `perdido` e
// `fechou_concorrente` ficaram de fora dos dez. O efeito tinha duas caras:
//   · na agenda, card perdido segurava o horário e o robô achava ocupado;
//   · no follow-up, card perdido continuava entrando na fila de cobrança.
//
// O próprio `reagendaSolarNaoAtendido` já carregava o aviso do que acontece quando
// duas pontas discordam: "uma marca onde a outra já marcou", o índice único recusa
// a gravação e o card não anda.
//
// O que este arquivo prende é a UNICIDADE. A lista certa é fácil de escrever de
// novo errado; o que não pode voltar é cada arquivo ter a sua.

describe('o que nao ocupa horario', () => {
  it('sao os quatro status de desfecho que nao sao venda', () => {
    expect([...STATUS_QUE_NAO_OCUPAM].sort())
      .toEqual(['cancelado', 'fechou_concorrente', 'perdido', 'sem_interesse']);
  });

  it('`fechou` fica FORA: a reuniao de quem comprou aconteceu de verdade', () => {
    // Tirar `fechou` daqui liberaria o horário de uma reunião que realmente
    // ocupou a agenda do consultor, e o robô marcaria em cima dela.
    expect(STATUS_QUE_NAO_OCUPAM).not.toContain('fechou');
  });

  it('e o filtro do PostgREST sai da mesma lista, sem texto a mao', () => {
    expect(FILTRO_NAO_OCUPA).toBe(`(${STATUS_QUE_NAO_OCUPAM.join(',')})`);
    // sem espaço: o PostgREST trata `in.(a, b)` com espaço como valor " b".
    expect(FILTRO_NAO_OCUPA).not.toMatch(/,\s/);
  });

  it('é a lista dos TERMINAIS menos a venda', () => {
    // As duas respondem perguntas diferentes (`STATUS_TERMINAIS` é quem APAGA a
    // etiqueta; esta é quem não ocupa horário), mas elas não podem divergir no
    // conteúdo sem alguém ter pensado: `fechou` é a única diferença legítima.
    const so = [...STATUS_TERMINAIS].filter(s => !STATUS_QUE_NAO_OCUPAM.includes(s));
    expect(so).toEqual(['fechou']);
  });
});

// ── NINGUÉM MAIS PODE ESCREVER A LISTA À MÃO ───────────────────────────────
//
// Esta é a trava que importa. Varre `api/src` inteiro e falha se algum arquivo
// voltar a cravar `(cancelado,sem_interesse)` ou um `new Set` equivalente.
describe('a lista nao volta a ser copiada', () => {
  const RAIZ = join(__dirname, '..');
  const arquivos: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) {
        if (nome === '__tests__' || nome === 'node_modules') continue;
        andar(p);
      } else if (nome.endsWith('.ts')) arquivos.push(p);
    }
  };
  andar(RAIZ);

  it('achou os arquivos pra varrer', () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it('nenhum arquivo crava o filtro na CHAMADA do PostgREST', () => {
    // Procura dentro do `.not('status', 'in', '...')`, nao no texto solto: o
    // comentario do modulo neutro CITA a lista velha pra explicar o defeito, e um
    // regex que casa comentario acusaria justamente a documentacao do conserto.
    const culpados = arquivos.filter(p =>
      /\.not\(\s*'status'\s*,\s*'in'\s*,\s*'\(cancelado/.test(readFileSync(p, 'utf8')));
    expect(culpados.map(p => p.replace(RAIZ, 'src'))).toEqual([]);
  });

  it('nenhum arquivo monta a lista num `new Set` proprio', () => {
    // Só o módulo neutro pode declarar o conteúdo. O resto importa.
    // SO a forma EXATA de dois elementos, que e a que eu acabei de migrar.
    //
    // Existem outras listas no repo que COMECAM igual e sao outra pergunta, e elas
    // tem que continuar existindo: `REUNIAO_ENCERRADA` no pontoCertoFunil inclui
    // `nao_atendeu` (a reuniao acabou, mesmo sem desfecho) e `MORTOS` na recepcao
    // inclui `fechou` (nao fale com quem ja comprou). Forcar as tres a serem uma
    // so seria juntar perguntas diferentes, que e o erro oposto.
    const culpados = arquivos
      .filter(p => !p.endsWith(join('agenda', 'salaDeEspera.ts')))
      .filter(p => /new Set\(\s*\[\s*'cancelado'\s*,\s*'sem_interesse'\s*\]\s*\)/.test(readFileSync(p, 'utf8')));
    expect(culpados.map(p => p.replace(RAIZ, 'src'))).toEqual([]);
  });

  it('quem usa o filtro importa do modulo neutro', () => {
    const usam = arquivos.filter(p => /FILTRO_NAO_OCUPA|STATUS_QUE_NAO_OCUPAM/.test(readFileSync(p, 'utf8')));
    // o próprio módulo + os dez que leem dele
    expect(usam.length).toBeGreaterThanOrEqual(10);
    for (const p of usam) {
      const txt = readFileSync(p, 'utf8');
      if (p.endsWith(join('agenda', 'salaDeEspera.ts'))) continue;
      if (p.endsWith(join('__tests__', 'statusParado.test.ts'))) continue;
      expect(txt, p.replace(RAIZ, 'src') + ' usa mas nao importa').toMatch(/import \{[^}]*(FILTRO_NAO_OCUPA|STATUS_QUE_NAO_OCUPAM)/);
    }
  });
});
