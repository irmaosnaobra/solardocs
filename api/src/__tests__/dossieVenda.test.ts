import { describe, it, expect } from 'vitest';
import {
  ARQUIVOS_SOLAR, CAMPOS_SOLAR,
  normalizarDossie, dossieVazio, resumoDossie,
  casarCartao, extensaoDe, caminhoArquivo, textoFichaTecnica, saudeDossie,
  nomeCartaoNovo, LISTA_CARTAO_NOVO,
  type TrelloCard, type PropostaDossie,
} from '../services/gerador/dossieVenda';

// ─────────────────────────────────────────────────────────────────────────────
// O dossiê guarda CNH e conta de luz de cliente vendido, e o destino dele é o
// cartão do Trello. Este arquivo trava as três coisas que, quebradas, não
// aparecem na tela:
//
//   1. Dossiê velho/torto não pode derrubar o modal de venda — a proposta de
//      antes de 30/09/2026 não tem a chave `dossie`, e a de amanhã pode ter
//      uma chave a mais.
//   2. O casamento do cartão não pode CHUTAR. Anexar a CNH do Bruno no cartão
//      do Bruna é o erro que ninguém vê, porque a tela diz "enviado".
//   3. Os 5 campos de texto têm que estar na ficha. Eles não têm anexo pra
//      representar: se caírem do comentário, simplesmente nunca chegam.
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizarDossie — o que vem do banco nunca derruba a tela', () => {
  it('proposta sem dossiê vira dossiê vazio, com todos os slots', () => {
    const d = normalizarDossie(undefined);
    expect(d.versao).toBe(1);
    for (const s of ARQUIVOS_SOLAR) expect(d.arquivos[s.key]).toEqual([]);
    expect(d.trello.status).toBe('pendente');
  });

  it('lixo no lugar do dossiê não explode', () => {
    for (const lixo of [null, 'texto', 42, [], true]) {
      const d = normalizarDossie(lixo);
      expect(resumoDossie(d).arquivos).toBe(0);
    }
  });

  it('slot que virou objeto em vez de lista vira lista vazia', () => {
    // É assim que nasce o `undefined.map`: uma gravação antiga com formato
    // diferente, e a tela inteira do histórico para de renderizar.
    const d = normalizarDossie({ arquivos: { documento: { path: 'x' }, conta_luz: null } });
    expect(d.arquivos.documento).toEqual([]);
    expect(d.arquivos.conta_luz).toEqual([]);
  });

  it('arquivo sem path é descartado — signed url de path vazio é erro 400', () => {
    const d = normalizarDossie({ arquivos: { padrao: [{ nome: 'a.jpg' }, { path: 'AB12/padrao-1.jpg', nome: 'ok' }] } });
    expect(d.arquivos.padrao).toHaveLength(1);
    expect(d.arquivos.padrao[0].path).toBe('AB12/padrao-1.jpg');
  });

  it('preserva o que já estava gravado', () => {
    const base = dossieVazio();
    base.campos = { email: 'a@b.com', qtd_placa: '12' };
    base.arquivos.documento = [{ path: 'AB12/documento-1.jpg', nome: 'cnh.jpg', tipo: 'image/jpeg', bytes: 100, em: '2026-09-30T12:00:00Z', trello_status: 'enviado', trello_anexo_id: 'anx1' }];
    base.trello = { card_id: 'card1', card_nome: 'Bruno', status: 'enviado', motivo: null, em: '2026-09-30T12:00:00Z', comentario_id: 'c1' };
    const d = normalizarDossie(JSON.parse(JSON.stringify(base)));
    expect(d.campos.email).toBe('a@b.com');
    expect(d.arquivos.documento[0].trello_anexo_id).toBe('anx1');
    expect(d.trello.card_id).toBe('card1');
  });
});

describe('resumoDossie — é o que a tela conta', () => {
  it('dossiê vazio: nenhum arquivo e todos os slots e campos faltando', () => {
    const r = resumoDossie(dossieVazio());
    expect(r.arquivos).toBe(0);
    expect(r.slots_vazios).toHaveLength(ARQUIVOS_SOLAR.length);
    expect(r.campos_vazios).toHaveLength(CAMPOS_SOLAR.length);
  });

  it('campo só com espaço conta como vazio', () => {
    // "   " passaria num `if (campo)` e a ficha do Trello sairia com e-mail em
    // branco marcada como completa.
    const d = dossieVazio();
    d.campos = { email: '   ', qtd_placa: '12' };
    const r = resumoDossie(d);
    expect(r.campos_vazios).toContain('email');
    expect(r.campos_vazios).not.toContain('qtd_placa');
  });

  it('conta arquivos de todos os slots somados', () => {
    const d = dossieVazio();
    const arq = (p: string) => ({ path: p, nome: p, tipo: 'image/jpeg', bytes: 1, em: '', trello_status: 'pendente' as const });
    d.arquivos.documento = [arq('a'), arq('b')];
    d.arquivos.medidor = [arq('c')];
    const r = resumoDossie(d);
    expect(r.arquivos).toBe(3);
    expect(r.slots_vazios).not.toContain('documento');
    expect(r.slots_vazios).toContain('fachada');
  });
});

describe('casarCartao — nunca chuta o cliente', () => {
  const card = (id: string, name: string): TrelloCard => ({ id, name, idList: 'l1' });

  it('casa nome parcial com o cartão do quadro', () => {
    const cartoes = [card('1', 'SOLAR #0042 - Bruno Martins Lages - Itaobim MG'), card('2', 'SOLAR #0043 - Ana Paula Souza - Araxá MG')];
    expect(casarCartao(cartoes, 'Bruno Lages', '').c?.id).toBe('1');
  });

  it('ignora acento e caixa', () => {
    const cartoes = [card('1', 'SOLAR #0010 - JOÃO PESSÔA DA SILVA')];
    expect(casarCartao(cartoes, 'joao pessoa da silva', '').c?.id).toBe('1');
  });

  it('uma palavra só não basta — sobrenome comum não escolhe sozinho', () => {
    const cartoes = [card('1', 'SOLAR #0001 - Jose Silva'), card('2', 'SOLAR #0002 - Maria Silva')];
    const r = casarCartao(cartoes, 'Pedro Silva', '');
    expect(r.c).toBeNull();
    expect(r.motivo).toBe('nenhum cartão casou');
  });

  it('empate vira "não sei", não um dos dois', () => {
    const cartoes = [card('1', 'SOLAR - Carlos Eduardo Lima'), card('2', 'OUTRO - Carlos Eduardo Rocha')];
    const r = casarCartao(cartoes, 'Carlos Eduardo', '');
    expect(r.c).toBeNull();
    expect(r.motivo).toBe('mais de um cartão parecido');
  });

  it('o número desempata a favor de quem tem o mesmo número', () => {
    const cartoes = [card('1', 'SOLAR #0042 - Carlos Eduardo Lima'), card('2', 'SOLAR #0099 - Carlos Eduardo Rocha')];
    expect(casarCartao(cartoes, 'Carlos Eduardo', '0042').c?.id).toBe('1');
  });

  it('quadro vazio devolve null sem quebrar', () => {
    expect(casarCartao([], 'Qualquer Nome', '123').c).toBeNull();
  });

  it('nome vazio não casa com ninguém', () => {
    // Proposta sem cliente_nome cairia aqui: sem esta guarda, zero palavras
    // casariam zero pontos em todo cartão — e o primeiro da lista venceria.
    const cartoes = [card('1', 'SOLAR #0042 - Bruno Lages')];
    expect(casarCartao(cartoes, '', '').c).toBeNull();
  });
});

describe('extensaoDe e caminhoArquivo', () => {
  it('tira a extensão do media type', () => {
    expect(extensaoDe('application/pdf', 'conta.pdf')).toBe('pdf');
    expect(extensaoDe('image/jpeg', 'IMG_1.jpg')).toBe('jpg');
    expect(extensaoDe('image/png', 'x')).toBe('png');
  });

  it('media type desconhecido cai no nome do arquivo', () => {
    expect(extensaoDe('application/octet-stream', 'foto.HEIC')).toBe('heic');
  });

  it('sem pista nenhuma vira bin, não string vazia', () => {
    // Caminho terminando em ponto quebra o Storage; `bin` é feio mas funciona.
    expect(extensaoDe('application/octet-stream', 'arquivo_sem_extensao')).toBe('bin');
  });

  it('o caminho começa pelo código da proposta', () => {
    // É o prefixo que a rota de remoção exige pra não deixar uma proposta
    // apagar o documento de outra.
    const p = caminhoArquivo('AB12CD', 'documento', 'jpg');
    expect(p.startsWith('AB12CD/')).toBe(true);
    expect(p.endsWith('.jpg')).toBe(true);
  });

  it('dois uploads seguidos no mesmo slot não colidem', () => {
    const a = caminhoArquivo('AB12CD', 'padrao', 'jpg');
    const b = caminhoArquivo('AB12CD', 'padrao', 'jpg');
    expect(a).not.toBe(b);
  });
});

describe('textoFichaTecnica — os 5 campos que não têm anexo', () => {
  const proposta = (campos: Record<string, string>): { p: PropostaDossie; d: ReturnType<typeof dossieVazio> } => {
    const d = dossieVazio();
    d.campos = campos;
    const p = {
      codigo: 'AB12CD', cliente_nome: 'Bruno Lages', cliente_cidade: 'Itaobim', cliente_uf: 'MG',
      vendido: true, dados: {}, dossie: d, qtd_placas: 12, inversor: 'SAJ', qtd_inversor: 1,
    } as PropostaDossie;
    return { p, d };
  };

  it('leva os cinco campos e o código da proposta', () => {
    const { p, d } = proposta({ email: 'bruno@x.com', qtd_placa: '12', marca_placa: 'DAH', qtd_inversor: '1', marca_inversor: 'SAJ' });
    const t = textoFichaTecnica(p, d);
    expect(t).toContain('bruno@x.com');
    expect(t).toContain('12 x DAH');
    expect(t).toContain('1 x SAJ');
    expect(t).toContain('AB12CD');
    expect(t).toContain('Itaobim / MG');
  });

  it('campo em branco vira travessão, não "undefined"', () => {
    const { p, d } = proposta({ email: 'so@email.com' });
    const t = textoFichaTecnica(p, d);
    expect(t).not.toContain('undefined');
    expect(t).toContain('— x —');
  });

  it('cliente sem cidade não escreve "null / null" no cartão', () => {
    const { p, d } = proposta({});
    const t = textoFichaTecnica({ ...p, cliente_cidade: null, cliente_uf: null }, d);
    expect(t).not.toMatch(/null/);
    expect(t).toContain('Cidade: —');
  });
});

describe('os slots são o que o pedido descreve', () => {
  it('seis anexos, na ordem pedida', () => {
    expect(ARQUIVOS_SOLAR.map((s) => s.key)).toEqual([
      'documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor',
    ]);
  });

  it('só documento e conta de luz aceitam PDF', () => {
    // Foto de padrão em PDF é o consultor mandando o arquivo errado; recusar na
    // hora é mais barato que descobrir na homologação.
    const comPdf = ARQUIVOS_SOLAR.filter((s) => s.aceitaPdf).map((s) => s.key);
    expect(comPdf).toEqual(['documento', 'conta_luz']);
  });

  it('cinco campos de texto, com prefill onde a proposta já sabe', () => {
    expect(CAMPOS_SOLAR.map((c) => c.key)).toEqual([
      'email', 'qtd_placa', 'marca_placa', 'qtd_inversor', 'marca_inversor',
    ]);
    expect(CAMPOS_SOLAR.find((c) => c.key === 'qtd_placa')?.prefill).toBe('qtd_placas');
    expect(CAMPOS_SOLAR.find((c) => c.key === 'marca_inversor')?.prefill).toBe('inversor');
  });

  it('as chaves não têm caractere que quebre caminho de Storage', () => {
    for (const s of ARQUIVOS_SOLAR) expect(s.key).toMatch(/^[a-z_]+$/);
  });
});

describe('saudeDossie — a tela de saúde não pode mentir verde', () => {
  // `geradorComServiceKey` e as credenciais do Trello vêm do ambiente, e no
  // teste nenhuma delas está configurada. É justamente o caso que interessa:
  // é assim que a máquina de quem for ligar isso começa.
  it('sem nada configurado, nunca diz pronto', () => {
    for (const b of ['existe', 'nao_existe', 'indeterminado'] as const) {
      expect(saudeDossie(b).pronto).toBe(false);
    }
  });

  it('bucket indeterminado não vira pronto por otimismo', () => {
    // Era o bug: `list()` devolve [] tanto pro bucket vazio quanto pro que não
    // existe, e a saúde ficava verde num sistema que não subia nada.
    const s = saudeDossie('indeterminado');
    expect(s.pronto).toBe(false);
    expect(s.falta.some((f) => /conferir à mão/.test(f))).toBe(true);
  });

  it('cada peça que falta vira uma linha com o nome da variável', () => {
    const s = saudeDossie('nao_existe');
    expect(s.falta.some((f) => f.includes('SUPABASE_GERADOR_SERVICE_KEY'))).toBe(true);
    expect(s.falta.some((f) => f.includes('dossie-vendas'))).toBe(true);
    expect(s.falta.some((f) => f.includes('TRELLO_KEY'))).toBe(true);
  });

  it('o estado do bucket sai como veio, sem virar booleano', () => {
    // Três estados, não dois: "não sei" é uma resposta legítima aqui e some se
    // alguém espremer isto num true/false.
    expect(saudeDossie('existe').bucket).toBe('existe');
    expect(saudeDossie('nao_existe').bucket).toBe('nao_existe');
    expect(saudeDossie('indeterminado').bucket).toBe('indeterminado');
  });
});

describe('nomeCartaoNovo — o cartão que nasce no lançamento', () => {
  const p = (over: Partial<PropostaDossie>) => ({
    codigo: '202600551', cliente_nome: 'Wesler Vieira Andrade',
    cliente_cidade: 'Uberlândia', cliente_uf: 'MG',
    vendido: true, dados: {}, dossie: dossieVazio(),
    qtd_placas: 14, inversor: 'SAJ', qtd_inversor: 1, ...over,
  } as PropostaDossie);

  it('segue o padrão do quadro, sem o número', () => {
    // O quadro nomeia "#0064 - Cristiano Alves da Silva - Uberlândia MG". O
    // #NNNN sai do cadastro na Planilha Mestre, não daqui.
    expect(nomeCartaoNovo(p({}))).toBe('Wesler Vieira Andrade - Uberlândia MG');
  });

  it('NAO inventa numero nenhum', () => {
    // Trava de proposíto: "maior + 1" acertaria o padrão e quebraria a ponte
    // com a coluna CODIGO no dia em que a planilha já tivesse dado o número.
    expect(nomeCartaoNovo(p({}))).not.toMatch(/#/);
  });

  it('sem cidade, fica só o nome, e não "Nome - "', () => {
    expect(nomeCartaoNovo(p({ cliente_cidade: null, cliente_uf: null }))).toBe('Wesler Vieira Andrade');
  });

  it('sem UF, leva a cidade sozinha', () => {
    expect(nomeCartaoNovo(p({ cliente_uf: null }))).toBe('Wesler Vieira Andrade - Uberlândia');
  });

  it('cliente sem nome cai no código, nunca em cartão anónimo', () => {
    // Cartão chamado "- Uberlândia MG" seria impossível de achar no quadro.
    expect(nomeCartaoNovo(p({ cliente_nome: null }))).toBe('Proposta 202600551 - Uberlândia MG');
    expect(nomeCartaoNovo(p({ cliente_nome: '   ' }))).toBe('Proposta 202600551 - Uberlândia MG');
  });

  it('nasce na lista que NÃO avisa o cliente', () => {
    // Pelo plano da Jornada, DAR ENTRADA dispara "sua documentação entrou na
    // concessionária". Cartão nascendo não pode mandar isso antes de ser verdade.
    expect(LISTA_CARTAO_NOVO).toBe('BASE DE CLIENTES');
  });
});
