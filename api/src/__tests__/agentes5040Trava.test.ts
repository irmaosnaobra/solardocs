import { describe, it, expect } from 'vitest';
import {
  validarFala, pedidoDeReescrita, permiteReescrita, estadoDaConversa,
  MOTIVO_HISTORICO_INCOMPLETO, MOTIVO_SEM_CONTEXTO, type ParametrosTrava,
} from '../services/agentes5040/trava';
import { PERCENTUAIS_PUBLICOS_ELETROPOSTO } from '../services/agentes5040/conhecimento/eletroposto';
import { DOMINIOS_LINK_PERMITIDOS } from '../services/agentes5040/trava';
import { msg, saida, peca, conversaDoLead } from './_agentes5040Util';

const duda: ParametrosTrava = { persona: 'duda', completa: true };
const carla: ParametrosTrava = { persona: 'carla', completa: true };
const helena: ParametrosTrava = { persona: 'helena', completa: true, qualificado: true };
const helenaSemQualificar: ParametrosTrava = { persona: 'helena', completa: true };

const ok = (bolhas: string[], p = duda, conv = conversaDoLead(), extra = {}) =>
  validarFala(saida(bolhas, extra), conv, p);

describe('trava: regras gerais, uma por regra', () => {
  it('fala limpa passa', () => {
    expect(ok(['Oi! Em qual cidade você mora?'])).toEqual([]);
  });

  it('mais de 160 caracteres reprova', () => {
    const longa = 'Oi, tudo bem com você hoje? ' + 'a'.repeat(140);
    expect(ok([longa]).join()).toMatch(/160 caracteres/);
  });

  it('exatamente 160 caracteres passa', () => {
    const t = 'Oi' + 'a'.repeat(158);
    expect(t.length).toBe(160);
    expect(ok([t])).toEqual([]);
  });

  it('mais de 2 bolhas reprova', () => {
    expect(ok(['Oi.', 'Tudo bem.', 'Certo.']).join()).toMatch(/3 bolhas/);
  });

  it('sem bolhas reprova, salvo ação que passa a vez', () => {
    expect(ok([]).join()).toMatch(/sem bolhas/);
    expect(validarFala(saida([], { acao: 'calar' }), conversaDoLead(), { ...duda, acoesSemFala: ['calar'] })).toEqual([]);
  });

  it('segunda bolha só vale como link https sozinho', () => {
    expect(ok(['Segue o link.', 'https://solardoc.app/pagar'], carla, conversaDoLead(), { peca: peca('link') })).toEqual([]);
    expect(ok(['Segue o link.', 'veja em https://solardoc.app/x'], carla, conversaDoLead(), { peca: peca('link') }).join()).toMatch(/só um link https/);
    expect(ok(['Segue o link.', 'http://solardoc.app/a'], carla, conversaDoLead(), { peca: peca('link') }).join()).toMatch(/só um link https/);
  });

  it('"?" e palavras dentro da URL do link não contam como texto da fala', () => {
    const url = 'https://solardoc.app/x?src=wa&utm_content=videos-menu';
    expect(ok(['Pode pagar por aqui?', url], carla, conversaDoLead(), { peca: peca('link') })).toEqual([]);
    // mas uma segunda pergunta na bolha 1 continua barrada
    expect(ok(['Quer pagar? Por aqui?', url], carla, conversaDoLead(), { peca: peca('link') }).join()).toMatch(/mais de uma pergunta/);
  });

  it('segunda bolha sem peça declarada reprova', () => {
    expect(ok(['Oi.', 'Outra frase.']).join()).toMatch(/só existe para link ou Pix/);
  });

  it('peça link ou pix sem segunda bolha reprova', () => {
    expect(ok(['Segue.'], carla, conversaDoLead(), { peca: peca('link') }).join()).toMatch(/sem a segunda bolha/);
  });

  it('Pix na segunda bolha: código sem espaço passa, frase não', () => {
    const codigo = '00020126580014br.gov.bcb.pix0136abc';
    expect(ok(['Pode pagar por aqui.', codigo], carla, conversaDoLead(), { peca: peca('pix') })).toEqual([]);
    expect(ok(['Pode pagar por aqui.', 'chave pix: 123'], carla, conversaDoLead(), { peca: peca('pix') }).join()).toMatch(/Pix/);
  });

  it('link na primeira bolha reprova', () => {
    expect(ok(['Veja https://solardoc.app agora.']).join()).toMatch(/primeira bolha/);
    expect(ok(['Veja solardoc.app agora.']).join()).toMatch(/primeira bolha/);
  });

  it('começar com minúscula reprova; dígito e maiúscula acentuada passam', () => {
    expect(ok(['oi, tudo bem?']).join()).toMatch(/minúscula/);
    expect(ok(['2 horários: terça às 9h ou quarta às 10h?'])).toEqual([]);
    expect(ok(['Éder, tudo bem?'])).toEqual([]);
  });

  it('travessão longo e médio reprovam', () => {
    expect(ok(['Oi — tudo bem?']).join()).toMatch(/travessão/);
    expect(ok(['Oi – tudo bem?']).join()).toMatch(/travessão/);
  });

  it('emoji reprova', () => {
    expect(ok(['Oi \u{1F600}']).join()).toMatch(/emoji/);
    expect(ok(['Oi ❤️']).join()).toMatch(/emoji/);
  });

  it('lista numerada, marcador, menu e "digite 1" reprovam', () => {
    expect(ok(['Escolha:\n1. Solar\n2. Eletroposto']).join()).toMatch(/lista numerada/);
    expect(ok(['Veja:\n- Solar\n- Eletroposto']).join()).toMatch(/marcador/);
    expect(ok(['Digite 1 para solar.']).join()).toMatch(/menu/);
    expect(ok(['Aqui está o menu.']).join()).toMatch(/menu/);
    expect(ok(['Responda com o número 2.']).join()).toMatch(/menu/);
  });

  it('"vídeo", "videochamada" e "assistente virtual" reprovam', () => {
    expect(ok(['Fazemos uma reunião por vídeo?']).join()).toMatch(/proibida/);
    expect(ok(['Podemos fazer uma videochamada?']).join()).toMatch(/proibida/);
    expect(ok(['Sou a assistente virtual da casa.']).join()).toMatch(/proibida/);
    expect(ok(['Posso pedir pra Nilce te ligar?'])).toEqual([]);
  });

  it('negar ser IA reprova; dizer a verdade passa', () => {
    expect(ok(['Não sou um robô, sou gente.']).join()).toMatch(/negou ser IA/);
    expect(ok(['Sou uma pessoa da equipe.']).join()).toMatch(/negou ser IA/);
    expect(ok(['Sou a IA da Irmãos na Obra, sim. Quem te liga é a Nilce, gente de verdade.'])).toEqual([]);
  });

  it('mais de um ponto de interrogação reprova', () => {
    expect(ok(['Onde você mora? Quanto gasta de luz?']).join()).toMatch(/mais de uma pergunta/);
  });
});

describe('trava: imagem', () => {
  const comImagem = (conv = conversaDoLead()) => validarFala(saida(['Veja um caso.'], { peca: peca('imagem') }), conv, carla);

  it('nunca na primeira mensagem', () => {
    expect(comImagem().join()).toMatch(/primeira mensagem/);
  });

  it('depois de falar, passa', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'Oi, tudo bem?'), msg('lead', 'Quero ver gente que usa')];
    expect(comImagem(conv)).toEqual([]);
  });

  it('nunca depois do link', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'https://solardoc.app/pagar'), msg('lead', 'Tem prova?')];
    expect(comImagem(conv).join()).toMatch(/depois do link/);
  });

  it('no máximo 3 imagens por conversa', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'Oi!')];
    for (let i = 0; i < 3; i++) conv.push(msg('robo', null, { tipo: 'image', media_url: 'u' }), msg('lead', 'ok'));
    expect(comImagem(conv).join()).toMatch(/3 imagens/);
  });

  it('entre duas imagens o lead precisa ter falado', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', null, { tipo: 'image', media_url: 'u' }), msg('lead', 'ok'), msg('robo', null, { tipo: 'image', media_url: 'u' })];
    // A última mensagem é nossa: a regra de duas falas seguidas também dispara; o que importa aqui é o motivo da imagem.
    expect(comImagem(conv).join()).toMatch(/desde a última imagem/);
    const conv2 = [...conv, msg('lead', 'legal')];
    expect(comImagem(conv2)).toEqual([]);
  });

  it('imagem não leva segunda bolha', () => {
    expect(ok(['Veja.', 'https://x.com/a'], carla, [msg('lead', 'Oi'), msg('robo', 'Oi!'), msg('lead', 'ok')], { peca: peca('imagem') }).join()).toMatch(/imagem não leva segunda bolha/);
  });
});

describe('trava: duas falas seguidas', () => {
  it('a agente não fala duas vezes sem o lead escrever', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'Oi, tudo bem?')];
    expect(ok(['Posso ajudar?'], duda, conv).join()).toMatch(/duas falas seguidas/);
  });

  it('gente da equipe no celular conta como não-lead', () => {
    const conv = [msg('lead', 'Oi'), msg('equipe', 'Já te respondo')];
    expect(ok(['Posso ajudar?'], duda, conv).join()).toMatch(/duas falas seguidas/);
  });

  it('conversa sem nenhuma fala do lead reprova', () => {
    expect(ok(['Oi, tudo bem?'], duda, []).join()).toMatch(/lead ainda não escreveu/);
  });

  it('reação do lead não conta como fala', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'Oi!'), msg('lead', null, { tipo: 'reacao' })];
    expect(estadoDaConversa(conv).ultimaFoiDoLead).toBe(false);
  });
});

describe('trava: histórico incompleto e falta de contexto', () => {
  it('completa=false: não fala e não ganha reescrita', () => {
    const m = validarFala(saida(['Oi, tudo bem?']), conversaDoLead(), { ...duda, completa: false });
    expect(m).toEqual([MOTIVO_HISTORICO_INCOMPLETO]);
    expect(permiteReescrita(m)).toBe(false);
  });

  it('sabe_contexto=false: não fala e não ganha reescrita', () => {
    const m = validarFala(saida(['Oi, tudo bem?'], { sabe_contexto: false }), conversaDoLead(), duda);
    expect(m).toEqual([MOTIVO_SEM_CONTEXTO]);
    expect(permiteReescrita(m)).toBe(false);
  });

  it('motivo comum ganha reescrita', () => {
    expect(permiteReescrita(['emoji'])).toBe(true);
  });
});

describe('trava: Duda', () => {
  const d = (bolhas: string[], p: Partial<ParametrosTrava> = {}) =>
    validarFala(saida(bolhas), conversaDoLead(), { ...duda, ...p });

  it('furos de preço, cada um barrado', () => {
    expect(d(['Fica uns 25 mil o sistema.']).join()).toMatch(/valor em reais/);
    expect(d(['Sai por uns R$ 20 mil.']).join()).toMatch(/valor em reais/);
    expect(d(['Fica em 30k.']).join()).toMatch(/valor em reais/);
    expect(d(['Sai em 12x sem juros.']).join()).toMatch(/parcela/);
    expect(d(['Dá pra dividir em 12 vezes.']).join()).toMatch(/parcela/);
    expect(d(['Dá pra parcelar.']).join()).toMatch(/parcela/);
    expect(d(['Cai uns 90 por cento.']).join()).toMatch(/percentual/);
    expect(d(['Cai uns 90% da conta.']).join()).toMatch(/percentual/);
    expect(d(['Instala em uma semana.']).join()).toMatch(/prazo de instalação/);
    expect(d(['Fica pronto em 10 dias.']).join()).toMatch(/prazo de instalação/);
    expect(d(['A montagem leva 30 dias.']).join()).toMatch(/prazo de instalação/);
    expect(d(['Em quinze dias fica pronto.']).join()).toMatch(/prazo de instalação/);
    expect(d(['Você economiza metade.']).join()).toMatch(/efeito na conta/);
    expect(d(['A conta cai pela metade.']).join()).toMatch(/efeito na conta/);
    expect(d(['Você economiza 300 por mês.']).join()).toMatch(/economia com número/);
    expect(d(['O preço depende da conta.']).join()).toMatch(/preço/);
  });

  it('"R$" e "reais" sem número passam', () => {
    expect(d(['Sua conta vem em reais ou em kWh?'])).toEqual([]);
    expect(d(['Me manda o valor em R$ que aparece na conta?'])).toEqual([]);
  });

  it('valor em reais só passa se o lead disse ou a conta lida mostrou', () => {
    expect(d(['Vi a média de R$ 310 na sua conta.'])).toContain('Duda citou valor em reais que o lead não disse (R$ 310)');
    expect(d(['Vi a média de R$ 310 na sua conta.'], { valoresDaPessoa: [310] })).toEqual([]);
    expect(d(['Vi a média de R$ 310 na sua conta.'], { valoresDaPessoa: [300] }).length).toBeGreaterThan(0);
  });

  it('energia não é dinheiro: kWh, kWp e "1 mil kWh" passam', () => {
    expect(d(['Você falou em 1 mil kWh por mês?'])).toEqual([]);
    expect(d(['Um sistema de 5 kWp atende?'])).toEqual([]);
    expect(d(['Sua média é de 450 kWh?'])).toEqual([]);
  });

  it('intenção do lead e pedido ao lead não são prazo nosso', () => {
    expect(d(['Você pensa em montar nos próximos 3 meses?'])).toEqual([]);
    expect(d(['Você pensa em montar em uma semana?'])).toEqual([]);
    expect(d(['Anotei: Uberaba, uns 700 kWh e montar em até dois meses.'])).toEqual([]);
    expect(d(['Me diz um mês aproximado?'])).toEqual([]);
    expect(d(['Em quanto tempo você quer instalar, uns dois meses?'])).toEqual([]);
  });

  it('promessa do NOSSO prazo reprova', () => {
    for (const f of [
      'Instala em uma semana.', 'Fica pronto em 10 dias.', 'A gente instala em duas semanas.', 'Montamos em 15 dias.',
      'Instalamos em uma semana, você quer?', 'A obra leva uns 2 meses.', 'A instalação fica pronta em 30 dias.',
      'Em 10 dias está funcionando.', 'Entregamos em 20 dias.', 'A montagem demora 3 semanas.',
    ]) expect(d([f]).join(), f).toMatch(/prazo de instalação/);
  });

  it('eco do prazo que o lead disse passa (prazosDaPessoa), em dígito ou por extenso', () => {
    expect(d(['A gente instala em dois meses.']).join()).toMatch(/prazo de instalação/);
    expect(d(['A gente instala em dois meses.'], { prazosDaPessoa: ['quero montar em até 2 meses'] })).toEqual([]);
    expect(d(['A gente instala em 2 meses.'], { prazosDaPessoa: ['dois meses'] })).toEqual([]);
    expect(d(['A gente instala em 3 meses.'], { prazosDaPessoa: ['dois meses'] }).join()).toMatch(/prazo de instalação/);
  });

  it('fatos públicos passam: 25 anos de garantia, 600W, inversor, app, visita grátis', () => {
    for (const f of [
      'A garantia de geração é de 25 anos.',
      'Usamos módulos de 600W.',
      'O inversor é SAJ, Deye ou Sungrow.',
      'Você acompanha por um app.',
      'O orçamento e a visita são grátis.',
      'Atendemos o Triângulo Mineiro e Catalão.',
    ]) expect(ok([f]), f).toEqual([]);
  });

  it('pergunta de qualificação passa', () => {
    expect(ok(['Quanto você gasta de luz por mês?'])).toEqual([]);
  });

  it('preço ou cupom dentro do link também reprova', () => {
    const r = validarFala(saida(['Segue o link.', 'https://solardoc.app/x?preco=100'], { peca: peca('link') }), conversaDoLead(), duda);
    expect(r.join()).toMatch(/preço/);
  });
});

describe('trava: Helena', () => {
  const h = (bolhas: string[], p: Partial<ParametrosTrava> = {}) =>
    validarFala(saida(bolhas), conversaDoLead(), { ...helena, ...p });

  it('valor público só depois da qualificação', () => {
    expect(h(['O de 60 kW sai por R$ 135 mil.'])).toEqual([]);
    expect(validarFala(saida(['O de 60 kW sai por R$ 135 mil.']), conversaDoLead(), helenaSemQualificar).join()).toMatch(/antes da qualificação/);
  });

  it('valor que não é o público reprova, mesmo qualificado', () => {
    expect(h(['Fica em R$ 150 mil.']).join()).toMatch(/não é o público/);
    expect(h(['Fica em R$ 195 mil no de 120 kW.'])).toEqual([]);
  });

  it('valor que o próprio lead disse pode ser repetido', () => {
    expect(h(['Com R$ 100 mil dá pra começar a conversa.'], { valoresDaPessoa: [100000] })).toEqual([]);
  });

  it('as porcentagens do conhecimento passam (100% e 50%); qualquer outra, não', () => {
    expect(PERCENTUAIS_PUBLICOS_ELETROPOSTO).toEqual([100, 50]);
    expect(h(['No modelo 01 a gente investe 100%.'])).toEqual([]);
    expect(h(['No modelo 02 é 50% cada um.'])).toEqual([]);
    expect(h(['Dá 30% de entrada.']).join()).toMatch(/percentual \(30%\)/);
    expect(h(['Fica 75% por conta de vocês.']).join()).toMatch(/percentual/);
    expect(h(['Fica cinquenta por cento.']).join()).toMatch(/percentual/);
  });

  it('rendimento, retorno e payback SOZINHOS passam', () => {
    expect(h(['Quanto rende, eu não chuto. Isso é na reunião.'])).toEqual([]);
    expect(h(['O retorno a gente mostra na reunião.'])).toEqual([]);
    expect(h(['O payback é assunto da reunião.'])).toEqual([]);
    expect(h(['O rendimento depende do ponto.'])).toEqual([]);
  });

  it('junto de número, valor, porcentagem ou promessa, reprovam', () => {
    for (const f of [
      'O ponto rende 3 mil por mês.',
      'O retorno vem em 2 anos.',
      'O payback de 30 meses é bom.',
      'O rendimento é de 12%.',
      'O retorno é rápido.',
      'O rendimento é bom.',
      'O payback é curto.',
      'Isso tem boa rentabilidade.',
      'O retorno é garantido.',
      'Rende R$ 5 mil.',
    ]) expect(h([f]).length, f).toBeGreaterThan(0);
  });

  it('horário e data junto da palavra não contam como número', () => {
    expect(h(['O retorno a gente mostra na reunião de terça 13/10 às 10:00.'])).toEqual([]);
    expect(h(['Na reunião das 10h eu mostro o retorno.'])).toEqual([]);
    expect(h(['Em 30 minutos a gente fala do retorno.'])).toEqual([]);
  });

  it('"se paga" continua barrado', () => {
    expect(h(['O ponto se paga logo.']).join()).toMatch(/se paga/);
  });

  it('fatos públicos passam: garantia de 2 anos, 18x, 72x, carência de 90 dias, arrendamento', () => {
    for (const f of [
      'O equipamento tem garantia de 2 anos.',
      'No cartão é em até 18x.',
      'No financiamento é em até 72x.',
      'Tem carência de 90 dias.',
      'No modelo 01 você recebe arrendamento todo mês.',
      'Não é franquia, sem taxa nem royalties.',
    ]) expect(h([f]), f).toEqual([]);
  });
});

describe('trava: Carla', () => {
  const c = (bolhas: string[], p: Partial<ParametrosTrava> = {}) =>
    validarFala(saida(bolhas), conversaDoLead(), { ...carla, ...p });

  it('só os valores da tabela: 67, 27, 97', () => {
    for (const f of ['O plano é R$ 67 por mês.', 'O curso sai por R$ 27.', 'O Off-Grid é R$ 97.', 'São 67 reais por mês.']) {
      expect(c([f]), f).toEqual([]);
    }
    expect(c(['O plano é R$ 49 por mês.']).join()).toMatch(/fora da tabela/);
    expect(c(['Tem um Pix de R$ 19.']).join()).toMatch(/fora da tabela/);
  });

  it('valor derivado e centavos não passam', () => {
    expect(c(['Dá R$ 1,12 por proposta.']).join()).toMatch(/fora da tabela/);
    expect(c(['Dá R$ 2,23 por dia.']).join()).toMatch(/fora da tabela/);
    expect(c(['O plano é R$ 67,40 por mês.']).join()).toMatch(/fora da tabela/);
    expect(c(['O plano é R$ 67,00 por mês.'])).toEqual([]);
  });

  it('garantia de 7 dias e cancelamento passam', () => {
    expect(c(['Tem garantia de 7 dias e cancela quando quiser.'])).toEqual([]);
  });

  it('cupom, ACESSO19, plano anual e "devolvi" reprovam', () => {
    for (const f of ['Tenho um cupom pra você.', 'Use o ACESSO19.', 'Temos plano anual.', 'Já devolvi o seu dinheiro.']) {
      expect(c([f]).length, f).toBeGreaterThan(0);
    }
  });

  it('cupom e preço valem também dentro do link', () => {
    const link = (url: string) => validarFala(saida(['Segue o link.', url], { peca: peca('link') }), conversaDoLead(), carla);
    expect(link('https://solardoc.app/pagar?coupon=ACESSO19').join()).toMatch(/cupom/);
    expect(link('https://solardoc.app/pagar?cupom=OFF').join()).toMatch(/cupom/);
    expect(link('https://solardoc.app/pagar?plano=anual').join()).toMatch(/anual/);
    expect(link('https://solardoc.app/pagar?valor=R$19').join()).toMatch(/fora da tabela/);
    expect(link('https://solardoc.app/pagar?utm_source=wa')).toEqual([]);
  });

  it('data da planilha de eletroposto reprova; a promessa sem data passa', () => {
    expect(c(['A planilha de eletroposto sai em 15/11.']).join()).toMatch(/data para a planilha/);
    expect(c(['A planilha de eletroposto sai em novembro.']).join()).toMatch(/data para a planilha/);
    expect(c(['Logo teremos a planilha de eletroposto, e quem fechar hoje terá acesso a ela.'])).toEqual([]);
  });
});

describe('trava: link só de domínio permitido', () => {
  const link = (url: string) => validarFala(saida(['Segue o link.', url], { peca: peca('link') }), conversaDoLead(), carla);

  it('solardoc.app passa; o resto não', () => {
    expect(DOMINIOS_LINK_PERMITIDOS).toEqual(['solardoc.app']);
    expect(link('https://solardoc.app/pagar')).toEqual([]);
    expect(link('https://pay.kiwify.com.br/abc').join()).toMatch(/solardoc\.app/);
    expect(link('https://solardoc.app.evil.com/x').join()).toMatch(/solardoc\.app/);
    expect(link('https://solardoc.app@evil.com/x').join()).toMatch(/solardoc\.app/);
    expect(link('https://evil.com/solardoc.app').join()).toMatch(/solardoc\.app/);
    expect(link('https://solardoc.app:8443/x').join()).toMatch(/solardoc\.app/);
    expect(link('http://solardoc.app/x').join()).toMatch(/solardoc\.app/);
  });
});

describe('trava: ligar agora só em horário comercial', () => {
  const terca10h = '2026-10-20T13:00:00Z';   // terça, 10h em Brasília
  const terca20h = '2026-10-20T23:00:00Z';   // terça, 20h em Brasília
  const sabado = '2026-10-24T15:00:00Z';
  const ligar = (bolhas: string[], agora: string | undefined, acao = 'continuar') =>
    validarFala(saida(bolhas, { acao }), conversaDoLead(), { ...duda, agora });

  it('dentro do horário passa', () => {
    expect(ligar(['Posso pedir pra Nilce te ligar agora?'], terca10h)).toEqual([]);
    expect(ligar(['Certo. Vou passar para a Nilce.'], terca10h, 'ligar_agora')).toEqual([]);
  });

  it('fora do horário, no fim de semana e sem horário de referência reprova', () => {
    expect(ligar(['Posso pedir pra Nilce te ligar agora?'], terca20h).join()).toMatch(/fora do horário comercial/);
    expect(ligar(['Posso pedir pra Nilce te ligar agora?'], sabado).join()).toMatch(/fora do horário comercial/);
    expect(ligar(['Agora a Nilce liga pra você.'], terca20h).join()).toMatch(/fora do horário comercial/);
    expect(ligar(['Certo. Vou passar para a Nilce.'], terca20h, 'ligar_agora').join()).toMatch(/fora do horário comercial/);
    expect(ligar(['Posso pedir pra Nilce te ligar agora?'], undefined).join()).toMatch(/sem horário de referência/);
  });

  it('oferecer horário do próximo dia útil não é ligar agora', () => {
    expect(ligar(['Amanhã às 9h ou às 10h30, qual fica melhor?'], terca20h)).toEqual([]);
  });
});

describe('trava: depoimentos e iniciativa', () => {
  const dep = (conv: ReturnType<typeof conversaDoLead>, extra: Partial<ParametrosTrava> = {}) =>
    validarFala(saida(['Veja um caso.'], { peca: peca('imagem', 'depoimento:lucas-rsc-solar') }), conv, { ...carla, ...extra });
  const imgDep = () => msg('robo', null, { tipo: 'image', media_url: 'https://solardoc.app/depoimentos/card-lucas-rsc-solar.png' });

  it('no máximo 2 depoimentos por conversa', () => {
    const um = [msg('lead', 'Oi'), msg('robo', 'Oi!'), msg('lead', 'ok'), imgDep(), msg('lead', 'legal')];
    expect(dep(um)).toEqual([]);
    const dois = [...um, imgDep(), msg('lead', 'e outro?')];
    expect(dep(dois).join()).toMatch(/2 depoimentos/);
    expect(dep(um, { depoimentosJaEnviados: 2 }).join()).toMatch(/2 depoimentos/);
  });

  it('imagem que não é depoimento não entra nessa conta, mas o teto de 3 continua', () => {
    const conv = [msg('lead', 'Oi'), msg('robo', 'Oi!'), msg('lead', 'ok'), imgDep(), msg('lead', 'a'), imgDep(), msg('lead', 'b')];
    const r = validarFala(saida(['Veja.'], { peca: peca('imagem', 'logo:x') }), conv, carla);
    expect(r).toEqual([]);
  });

  it('abertura: a primeira fala da agente passa sem o lead ter escrito', () => {
    expect(validarFala(saida(['Oi, Ana! Vi seu cadastro. Em que cidade fica o ponto?']), [], { ...helena, permiteIniciativa: 'abertura' })).toEqual([]);
    expect(validarFala(saida(['Oi, Ana! Vi seu cadastro.']), [], helena).join()).toMatch(/lead ainda não escreveu/);
  });

  it('abertura só vale para a primeira fala: depois dela, duas falas seguidas continua barrado', () => {
    const conv = [msg('robo', 'Oi, Ana! Vi seu cadastro.')];
    expect(validarFala(saida(['Posso ajudar?']), conv, { ...helena, permiteIniciativa: 'abertura' }).join()).toMatch(/duas falas seguidas|lead ainda não escreveu/);
  });

  it('abertura não libera as outras regras', () => {
    expect(validarFala(saida(['oi \u{1F600}']), [], { ...helena, permiteIniciativa: 'abertura' }).length).toBeGreaterThan(0);
    expect(validarFala(saida(['Veja.'], { peca: peca('imagem') }), [], { ...carla, permiteIniciativa: 'abertura' }).join()).toMatch(/primeira mensagem/);
  });
});

describe('trava: pedido de reescrita', () => {
  it('leva o pedido, os motivos e o que foi escrito', () => {
    const r = pedidoDeReescrita('PEDIDO', ['emoji', 'travessão'], saida(['Oi \u{1F600}']));
    expect(r).toContain('PEDIDO');
    expect(r).toContain('emoji; travessão');
    expect(r).toContain('Oi \u{1F600}');
  });
});

describe('trava: o aviso de IA na primeira mensagem (exigeAviso)', () => {
  const exige = (persona: 'duda' | 'helena' | 'carla'): ParametrosTrava => ({ persona, completa: true, qualificado: true, exigeAviso: true });
  const NOME = { duda: 'Duda', helena: 'Helena', carla: 'Carla' } as const;

  for (const persona of ['duda', 'helena', 'carla'] as const) {
    it(`${persona}: bolha com a frase passa; sem a frase é barrada com a frase no motivo`, () => {
      const frase = `Aqui é a ${NOME[persona]}, do atendimento com IA da Irmãos na Obra.`;
      expect(ok([`${frase} Em qual cidade você mora?`], exige(persona))).toEqual([]);
      expect(ok([`Oi, Marcos! ${frase} Em qual cidade você mora?`], exige(persona))).toEqual([]);
      const motivos = ok(['Oi! Em qual cidade você mora?'], exige(persona));
      expect(motivos).toHaveLength(1);
      expect(motivos[0]).toContain(frase);
      expect(permiteReescrita(motivos)).toBe(true);
    });
  }

  it('o nome é da própria agente: a frase da Helena não vale para a Duda, e "IA" sem nome não vale', () => {
    expect(ok(['Aqui é a Helena, do atendimento com IA da Irmãos na Obra. Em qual cidade você mora?'], exige('duda')).length).toBe(1);
    expect(ok(['Sou uma IA. Em qual cidade você mora?'], exige('duda')).length).toBe(1);
  });

  it('aceita o "IA" em maiúscula junto do nome, e não aceita o verbo "ia"', () => {
    expect(ok(['Sou a Duda, da IA da Irmãos na Obra. Em qual cidade você mora?'], exige('duda'))).toEqual([]);
    expect(ok(['Aqui é a Duda. Eu ia perguntar em qual cidade você mora.'], exige('duda')).length).toBe(1);
  });

  it('sem exigeAviso nada muda; calar (sem bolha) não precisa do aviso', () => {
    expect(ok(['Oi! Em qual cidade você mora?'])).toEqual([]);
    expect(validarFala(saida([], { acao: 'calar' }), conversaDoLead(), { ...exige('duda'), acoesSemFala: ['calar'] })).toEqual([]);
  });

  it('a frase cabe nos 160 com uma resposta curta', () => {
    const t = 'Aqui é a Helena, do atendimento com IA da Irmãos na Obra. Anotei o posto em Araguari. Qual o consumo de energia?';
    expect(t.length).toBeLessThanOrEqual(160);
  });
});
