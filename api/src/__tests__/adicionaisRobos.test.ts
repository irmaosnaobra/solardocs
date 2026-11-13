import { describe, it, expect, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// ROBÔS E OS ADICIONAIS MENSAIS (13/11/2026): os textos novos valem SÓ com ADICIONAIS_MENSAIS ligada. Desligada, os robôs
// falam como hoje (os testes dos robôs existentes cobrem isso; aqui fica o par ligado x desligado de cada ponto).
// ─────────────────────────────────────────────────────────────────────────────

import {
  VALORES_PERMITIDOS_CARLA, textoConhecimentoSolarDoc, textoRetomadaSolarDoc, valoresPermitidosCarla,
} from '../services/agentes5040/conhecimento/solardoc';
import { SISTEMA_FIXO_CARLA, linkDoAvulsoVale, sistemaFixoCarla } from '../services/agentes5040/personas/carla';
import { validarFala, type ParametrosTrava } from '../services/agentes5040/trava';
import { PROMPT_PADRAO, promptComAdicionais } from '../services/agents/whatsapp/atendenteAnuncioPrompt';
import { buildSystemPrompt } from '../services/agents/whatsapp/whatsappAgentService';
import { msg, saida, peca, conversaDoLead } from './_agentes5040Util';

const ENV = { ...process.env };
const ligar = () => { process.env.ADICIONAIS_MENSAIS = '1'; };
afterEach(() => { process.env = { ...ENV }; });

const carla: ParametrosTrava = { persona: 'carla', completa: true };
const fala = (bolha: string) => validarFala(saida([bolha]), conversaDoLead(), carla).join(' | ');
const giovanna = () => buildSystemPrompt({ email: 'x@y.com', nome_empresa: 'ACME', tem_cnpj: true, nome: 'Joao', plano: 'free' } as never);
void msg; void peca;

describe('Carla: tabela de valores', () => {
  it('desligada é a de hoje: 67, 27 e 97', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect([...valoresPermitidosCarla()].sort((a, b) => a - b)).toEqual([27, 67, 97]);
    expect(valoresPermitidosCarla()).toBe(VALORES_PERMITIDOS_CARLA);
  });

  it('ligada aceita 17, 30 e 40 (e o 67 do plano) e tira 27 e 97', () => {
    ligar();
    expect([...valoresPermitidosCarla()].sort((a, b) => a - b)).toEqual([17, 30, 40, 67]);
  });

  it('a trava segue a flag: R$ 17 passa só ligada, R$ 97 só desligada', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(fala('A ferramenta sai por R$ 97.')).toBe('');
    expect(fala('A ferramenta sai por R$ 17 por mês.')).toMatch(/valor fora da tabela/);
    ligar();
    expect(fala('A ferramenta sai por R$ 17 por mês.')).toBe('');
    expect(fala('As 4 saem por R$ 40 por mês.')).toBe('');
    expect(fala('As 4 saem por R$ 30 por mês.')).toBe('');
    expect(fala('A ferramenta sai por R$ 97.')).toMatch(/valor fora da tabela/);
    expect(fala('A ferramenta sai por R$ 27.')).toMatch(/valor fora da tabela/);
  });
});

describe('Carla: conhecimento e retomada', () => {
  it('desligada: avulsos por Kiwify e "Para crescer", como sempre', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(textoConhecimentoSolarDoc()).toContain('Produtos avulsos (Kiwify');
    expect(textoRetomadaSolarDoc().join('\n')).toContain('em Para crescer');
  });

  it('ligada: adicionais mensais, "loja do app", sem Kiwify e sem nomear o LimpaPro no conhecimento', () => {
    ligar();
    const t = textoConhecimentoSolarDoc();
    expect(t).toContain('R$ 17 por mês cada');
    expect(t).toContain('as 4 ferramentas da loja do app por R$ 40 por mês');
    expect(t).toContain('as 4 por R$ 30 por mês');
    expect(t).not.toContain('Kiwify');
    expect(t).not.toMatch(/LimpaPro/i);
    const r = textoRetomadaSolarDoc().join('\n');
    expect(r).toContain('ficam na loja do app');
    expect(r).not.toContain('Para crescer');
    expect(r).toContain('R$ 17 por mês cada, ou as 4 por R$ 40 por mês');
  });
});

describe('Carla: bloco fixo', () => {
  it('desligada: igual ao bloco de sempre (preço único antigo e links de fora)', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    const b = sistemaFixoCarla();
    expect(b).toBe(SISTEMA_FIXO_CARLA);
    expect(b).toContain('Venda Off-Grid (R$ 97, peça avulso:offgrid)');
    expect(b).toContain('- avulso:offgrid: https://solardoc.app/dimensionamento');
    expect(b).toContain('o que fica em Para crescer é vendido à parte.');
  });

  it('ligada: ferramentas adicionais, sem link das páginas de fora das 3 ferramentas, valores novos', () => {
    ligar();
    const b = sistemaFixoCarla();
    expect(b).toContain('- Ferramentas adicionais: Venda Off-Grid, Estoque em Dia e Fecha Vendas, R$ 17 por mês cada');
    expect(b).toContain('Sem link: a compra é no app ou no checkout do plano.');
    expect(b).toContain('as ferramentas da loja do app são adicionais, cobrados à parte por mês.');
    expect(b).not.toContain('avulso:offgrid: https');
    expect(b).not.toContain('avulso:curso-fechamento: https');
    expect(b).not.toContain('avulso:inventario: https');
    expect(b).toContain('avulso:precificacao: https://solardoc.app/calculadora');
    expect(b).toContain('Nunca escreva valor em reais que não seja um destes: R$ 67, R$ 17, R$ 30, R$ 40.');
    expect(b).not.toContain('Para crescer');
  });

  it('a regra do link por ferramenta', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(linkDoAvulsoVale('offgrid')).toBe(true);
    ligar();
    expect(linkDoAvulsoVale('offgrid')).toBe(false);
    expect(linkDoAvulsoVale('curso-fechamento')).toBe(false);
    expect(linkDoAvulsoVale('inventario')).toBe(false);
    expect(linkDoAvulsoVale('precificacao')).toBe(true);
  });
});

describe('Giovanna (whatsappAgentService)', () => {
  it('desligada: o texto de hoje, com "Para crescer"', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(giovanna()).toContain('O que fica em *Para crescer* no menu');
    expect(giovanna()).not.toContain('adicionais por mês');
  });

  it('ligada: adicionais por mês, R$ 17, R$ 40 no app e R$ 30 no checkout', () => {
    ligar();
    const p = giovanna();
    expect(p).toContain('Da loja do app, Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro são adicionais por mês: R$ 17 cada, ou as 4 por R$ 40 por mês dentro do app');
    expect(p).toContain('no checkout do plano, as 4 saem por R$ 30 por mês');
    expect(p).not.toContain('*Para crescer*');
  });
});

describe('Atendente de anúncio (prompt)', () => {
  it('desligada: o prompt sai idêntico', () => {
    delete process.env.ADICIONAIS_MENSAIS;
    expect(promptComAdicionais(PROMPT_PADRAO)).toBe(PROMPT_PADRAO);
    expect(PROMPT_PADRAO).toContain('Não inclui curso nem Kit de Fechamento, são compras à parte,');
  });

  it('ligada: troca os 3 trechos das ferramentas', () => {
    ligar();
    const p = promptComAdicionais(PROMPT_PADRAO);
    expect(p).not.toContain('Não inclui curso nem Kit de Fechamento');
    expect(p).toContain('Fecha Vendas e LimpaPro são adicionais de R$ 17 por mês cada, ou as 4 por\nR$ 40 por mês no app e R$ 30 por mês no checkout do plano.');
    expect(p).toContain('O Estoque em Dia o mensalista pode levar como adicional, R$ 17 por mês.');
    expect(p).toContain('Prometer qualquer ferramenta da loja do app como\nincluída na assinatura: são adicionais pagos por mês.');
    expect(p).not.toContain('Prometer curso ou Kit de Fechamento na assinatura.');
  });

  it('prompt editado no admin sem os trechos antigos não é tocado', () => {
    ligar();
    expect(promptComAdicionais('texto editado à mão')).toBe('texto editado à mão');
  });
});
