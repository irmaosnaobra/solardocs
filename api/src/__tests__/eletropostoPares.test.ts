import { describe, it, expect } from 'vitest';
import { blocoPares, TETO_KM, MAX_PARES, type Sugestao } from '../services/io/eletropostoPares';
import { montarAvisoPonto, montarAvisoCapital, montarAvisoIntegrador } from '../routes/ioEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// O que este arquivo trava: o TEXTO que chega no WhatsApp do Thiago e do Diego.
// A dica de par é enfeite — o aviso tem que sair inteiro nos quatro casos, e
// nenhum deles pode dizer "não tem ninguém perto" quando a verdade é "não sei
// medir". São coisas diferentes e o consultor age diferente em cada uma.
// ─────────────────────────────────────────────────────────────────────────────

const perto = (n: number): Sugestao => ({
  status: 'ok',
  perto: Array.from({ length: n }, (_, i) => ({
    nome: `Fulano ${i + 1}`, telefone: `5534999${i}0000`, cidade: 'Araguari-MG',
    municipio: 'Araguari', uf: 'MG', km: i * 40, daFicha: i === 1,
    tab: 'nota1' as const, id: i + 1,
  })),
});

describe('blocoPares — as quatro formas', () => {
  it('com par: lista nome, onde, distância e o wa.me', () => {
    const linhas = blocoPares(perto(2), 'capital');
    expect(linhas.join('\n')).toContain('INVESTIDORES MAIS PERTO');
    expect(linhas.join('\n')).toContain('Araguari-MG (mesma cidade)');
    expect(linhas.join('\n')).toContain('(40 km)');
    expect(linhas.join('\n')).toContain('wa.me/553499900000');
  });

  it('marca quem veio da ficha — a conversa com essa pessoa começa diferente', () => {
    // Quem está "da ficha" nunca pediu nada: foi a régua que a classificou.
    expect(blocoPares(perto(2), 'ponto').join('\n')).toContain('da ficha, nunca falamos');
  });

  it('longe: diz quem é o mais próximo E que é longe demais', () => {
    const s: Sugestao = { status: 'longe', perto: [], maisProximo: {
      nome: 'Distante', telefone: '5592999990000', cidade: 'Manaus - AM',
      municipio: 'Manaus', uf: 'AM', km: 2400, daFicha: false, tab: 'parceria', id: 9 } };
    const txt = blocoPares(s, 'ponto').join('\n');
    expect(txt).toContain('Manaus-AM (2400 km)');
    expect(txt).toContain('Longe demais');
  });

  it('sem mapa NÃO vira "ninguém por perto"', () => {
    const txt = blocoPares({ status: 'sem_mapa', perto: [], motivo: 'erro de digitação' }, 'ponto').join('\n');
    expect(txt).toContain('Não consegui localizar');
    expect(txt).not.toContain('Nenhum ponto cadastrado');
  });

  it('pool vazio diz que a fila existe, e não que a medição falhou', () => {
    const txt = blocoPares({ status: 'pool_vazio', perto: [] }, 'ponto').join('\n');
    expect(txt).toContain('Nenhum ponto cadastrado ainda');
    expect(txt).not.toContain('Não consegui localizar');
  });

  it('cabe na tela: no máximo 3 nomes, e o teto é UM só', () => {
    expect(MAX_PARES).toBe(3);
    // 200 km é o número do Thiago. O teste trava o valor porque ele vale nos
    // TRÊS lugares — aviso no WhatsApp, coluna "perto" e aba Match. Mudar aqui
    // sem querer faria a mensagem citar quem a tela não considera par.
    expect(TETO_KM).toBe(200);
  });
});

describe('as mensagens da equipe', () => {
  const ponto = {
    id: 7, nome: 'Maria Souza', telefone: '5534991110000', cidade: 'Uberlândia-MG',
    ponto_relacao: 'Sou o proprietário', ponto_tipo: 'Estacionamento',
    ponto_endereco: 'Av. João Naves, 1200', ponto_vagas: '3 a 5 vagas',
    ponto_fluxo: 'Avenida movimentada', padrao_ligacao: 'Trifásico (4 fios na entrada)',
    padrao_disjuntor: 'De 63 a 100 A', padrao_consumo: 'De 2.000 a 10.000 kWh/mês',
    padrao_foto: 'Sim, mando hoje mesmo',
  };

  it('ponto: traz endereço, padrão e a dica', () => {
    const m = montarAvisoPonto(ponto, blocoPares(perto(1), 'capital'));
    expect(m).toContain('ARRENDAMENTO');
    expect(m).toContain('Av. João Naves, 1200');
    expect(m).toContain('PADRÃO DE ENTRADA');
    expect(m).toContain('Trifásico');
    expect(m).toContain('INVESTIDORES MAIS PERTO');
    expect(m).toContain('Cadastros');
  });

  it('ponto com padrão fraco leva o aviso de pedir a foto', () => {
    const m = montarAvisoPonto({ ...ponto, padrao_ligacao: 'Monofásico (2 fios na entrada)',
                                 padrao_disjuntor: 'Até 40 A' }, []);
    expect(m).toContain('provavelmente não aguenta');
    // Sem o ⚠️ na frente (emoji só na primeira linha), o alarme passou a ser a
    // palavra. Casar o pedido em si, e não a caixa da primeira letra: o que não
    // pode sumir é a instrução de pedir a foto ANTES de marcar.
    expect(m).toContain('a foto do padrão e da conta');
  });

  it('padrão "Não sei" NÃO é tratado como fraco', () => {
    // Desconhecimento não é diagnóstico: marcar como fraco descartaria ponto bom.
    const m = montarAvisoPonto({ ...ponto, padrao_ligacao: 'Não sei', padrao_disjuntor: 'Não sei' }, []);
    expect(m).not.toContain('provavelmente não aguenta');
  });

  it('campo em branco vira travessão, nunca "undefined"', () => {
    const m = montarAvisoPonto({ id: 1, nome: 'X', telefone: '5511999999999' }, []);
    expect(m).not.toContain('undefined');
    expect(m).not.toContain('null');
    expect(m).toContain('*Cidade:* —');
  });

  it('investidor: traz quanto, com quê e prazo', () => {
    const m = montarAvisoCapital({
      id: 3, nome: 'Carlos Andrade', telefone: '5534992220000', cidade: 'Araguari-MG',
      capital_faixa: 'R$ 100 mil a R$ 200 mil', capital_origem: 'Recurso próprio',
      prazo: 'Nos próximos 3 meses',
    }, blocoPares(perto(1), 'ponto'));
    expect(m).toContain('INVESTIDOR');
    expect(m).toContain('R$ 100 mil a R$ 200 mil');
    expect(m).toContain('Nos próximos 3 meses');
    expect(m).toContain('PONTOS MAIS PERTO');
  });

  it('sem dica nenhuma, a mensagem continua inteira', () => {
    const m = montarAvisoCapital({ id: 3, nome: 'Carlos', telefone: '5534992220000' }, []);
    expect(m).toContain('INVESTIDOR');
    expect(m.split('\n').filter(Boolean).length).toBeGreaterThan(5);
  });

  // O integrador não tem contraparte: ele não recebe bloco de pares, e a função
  // nem aceita um. O teste existe pra travar isso — o dia em que alguém
  // "padronizar" as três assinaturas, a mensagem passa a oferecer ponto a quem
  // só quer instalar.
  it('integrador: traz o perfil e NÃO traz bloco de pares', () => {
    const m = montarAvisoIntegrador({
      id: 9, nome: 'Marcos Vieira', telefone: '5534991110000', cidade: 'Uberaba-MG',
      integrador_atuacao: 'Integrador solar (projeto e instalação)',
      integrador_interesse: 'As duas coisas: vender e executar',
      integrador_experiencia: '1 a 3 instalados',
      integrador_equipe: 'Tenho equipe própria',
      obs: 'atendo três cidades',
    });
    expect(m).toContain('INTEGRADOR');
    expect(m).toContain('Integrador solar (projeto e instalação)');
    expect(m).toContain('1 a 3 instalados');
    expect(m).toContain('atendo três cidades');
    expect(m).not.toContain('MAIS PERTO');
    expect(m).not.toContain('undefined');
  });

  // Ordem do Thiago (16/09/2026): "cria uma msg com emojis para diferenciar".
  // Os três avisos caem na MESMA conversa do WhatsApp, um atrás do outro. Se dois
  // começarem parecidos, quem está no celular lê o cabeçalho errado e trata
  // investidor como ponto. A primeira linha é o que separa, então ela é travada.
  it('os três avisos se distinguem na primeira linha', () => {
    const base = { id: 1, nome: 'Fulano de Tal', telefone: '5534991110000', cidade: 'Uberaba-MG' };
    const topo = (m: string) => m.split('\n')[0];
    const ponto = topo(montarAvisoPonto(base, []));
    const capital = topo(montarAvisoCapital(base, []));
    const integrador = topo(montarAvisoIntegrador(base));

    expect(ponto).toContain('PONTO NOVO');
    expect(capital).toContain('INVESTIDOR NOVO');
    expect(integrador).toContain('PARCEIRO INTEGRADOR NOVO');
    expect(new Set([ponto, capital, integrador]).size).toBe(3);

    // E cada um traz emoji no cabeçalho: é o que o olho pega antes de ler.
    const temEmoji = (s: string) => /\p{Extended_Pictographic}/u.test(s);
    expect(temEmoji(ponto)).toBe(true);
    expect(temEmoji(capital)).toBe(true);
    expect(temEmoji(integrador)).toBe(true);
  });

  // Ordem do Thiago (24/09/2026): "emoji so na primeira linha". O cabeçalho só
  // separa os três avisos enquanto for o ÚNICO lugar com símbolo na mensagem —
  // emoji em linha de rótulo rouba exatamente o trabalho que o teste acima trava.
  // Vale para o corpo inteiro, inclusive o bloco de pares, que é colado dentro.
  it('nenhum emoji fora da primeira linha dos três avisos', () => {
    const base = {
      id: 1, nome: 'Fulano de Tal', telefone: '5534991110000', cidade: 'Uberaba-MG',
      ponto_endereco: 'Av. João Naves, 1200', padrao_ligacao: 'Monofásico (2 fios na entrada)',
      padrao_disjuntor: '40 A', empresa: 'Solar Vieira', cnpj: '12345678000190',
      obs: 'recado do lead',
    };
    const pares = blocoPares(perto(2), 'capital');
    const msgs = [montarAvisoPonto(base, pares), montarAvisoCapital(base, pares), montarAvisoIntegrador(base)];
    for (const m of msgs) {
      for (const l of m.split('\n').slice(1)) expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  // A segunda linha diz em uma frase o que aquilo é, pra quem abre o WhatsApp
  // no meio de outra coisa não precisar decifrar o cabeçalho.
  it('cada aviso explica em uma linha o que chegou', () => {
    const base = { id: 2, nome: 'Fulano de Tal', telefone: '5534991110000' };
    expect(montarAvisoCapital(base, []).split('\n')[1]).toContain('falta o ponto');
    expect(montarAvisoIntegrador(base).split('\n')[1]).toContain('canal');
    expect(montarAvisoPonto(base, []).split('\n')[1]).toContain('procura');
  });

  // O banco guarda o CNPJ só com dígitos. Quem lê o aviso copia esse número pra
  // consultar a empresa, e 14 dígitos seguidos ninguém confere de olho.
  it('integrador: CNPJ sai com máscara, e empresa aparece', () => {
    const m = montarAvisoIntegrador({
      id: 11, nome: 'Marcos Vieira', telefone: '5534991110002', cidade: 'Uberaba-MG',
      empresa: 'Solar Vieira', cnpj: '12345678000190',
    });
    expect(m).toContain('*Empresa:* Solar Vieira');
    expect(m).toContain('*CNPJ:* 12.345.678/0001-90');
  });

  // Número torto sai como veio: melhor a equipe estranhar e perguntar do que
  // receber um CNPJ bem formatado que não existe.
  it('integrador: CNPJ fora de 14 dígitos não é maquiado', () => {
    const m = montarAvisoIntegrador({
      id: 12, nome: 'Marcos Vieira', telefone: '5534991110003', cnpj: '1234',
    });
    expect(m).toContain('*CNPJ:* 1234');
  });

  // Sem empresa e sem CNPJ, as duas linhas somem. Linha vazia em aviso de
  // WhatsApp é ruído que a equipe aprende a pular, e aí pula o que importa.
  it('integrador sem empresa não ganha linha vazia', () => {
    const m = montarAvisoIntegrador({ id: 13, nome: 'X Y', telefone: '5534991110004' });
    expect(m).not.toContain('*Empresa:*');
    expect(m).not.toContain('*CNPJ:*');
  });

  it('integrador sem nada preenchido não vaza undefined nem null', () => {
    const m = montarAvisoIntegrador({ id: 10, nome: 'X', telefone: '5534991110001' });
    expect(m).toContain('*Cidade:* —');
    expect(m).toContain('*Equipe:* —');
    expect(m).not.toContain('undefined');
    expect(m).not.toContain('null');
  });
});
