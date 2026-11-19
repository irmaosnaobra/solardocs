// A validação da lista de interesse da Irmãos na Obra (solardoc.app/io/interesse, 19/11/2026). PURA: não fala com banco nem
// com rede. Quatro portas, cada uma com as respostas da página (o slug é o contrato: rótulo pode mudar, slug não):
//   solar        { tipo, conta, pagamento }                 (as do quiz solar)
//   eletroposto  caminho + as 3 respostas do caminho        (as MESMAS da lista NEXUS: PERGUNTAS de nexusInteresse.ts)
//   integrador   { atuacao, equipe, propostas }
//   mobilidade   itens e/ou "outro", objetivo, investimento (sem as faixas antigas ate_10 e 10_50) e recurso
// Só string passa: número, objeto ou array no lugar de texto vira vazio e cai na validação (400), nunca em 500.
// O contato é o da NEXUS. Telefone de teste = faixa fictícia ^5534900000\d{2,3}$ (o corpo não decide).

import { ELETROPOSTO_VALIDOS, PERGUNTAS, UFS } from './nexusInteresse';
import { cidadeParaGravar } from '../services/io/cidadeCanonica';

export type Porta = 'solar' | 'eletroposto' | 'integrador' | 'mobilidade';
export type CaminhoEp = (typeof ELETROPOSTO_VALIDOS)[number];

const SOLAR: Record<string, readonly string[]> = {
  tipo: ['casa', 'empresa', 'rural'],
  conta: ['ate300', '300_600', '600_1050', '1050_2000', '2000_5000', '5000_mais'],
  pagamento: ['vista', 'financiamento', 'cartao', 'naosei'],
};
const INTEGRADOR: Record<string, readonly string[]> = {
  atuacao: ['integrador', 'vendedor', 'engenharia', 'outro'],
  equipe: ['sozinho', '2_5', '6_mais'],
  propostas: ['ate10', '10_30', '30_mais'],
};
export const MOBILIDADE_IO = [
  'carro_compacto', 'carro_suv', 'carro_sedan', 'picape', 'van', 'triciclo', 'quadriciclo', 'bike', 'scooter', 'moto',
] as const;
const OBJETIVOS = new Set(['proprio', 'frota', 'revenda', 'investir']);
const INVESTIMENTOS = new Set(['50_100', '100_250', '250_500', '500_mais', 'naosei']);
const RECURSOS = new Set(['proprio', 'financiamento', 'os_dois', 'naosei']);
const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const RE_TELEFONE_TESTE = /^5534900000\d{2,3}$/;

export interface PortaLida {
  porta: Porta;
  solar: Record<string, string> | null;
  integrador: Record<string, string> | null;
  caminho: CaminhoEp | null;
  respostas: Record<string, string> | null;
  mobilidade: string[];
  outro: string | null;
  objetivo: string | null;
  investimento: string | null;
  recurso: string | null;
}

export interface Contato {
  nome: string; telefone: string; email: string; cidade: string; uf: string;
  cep: string | null; endereco: string | null; bairro: string | null;
  origem: string | null; utm: Record<string, string> | null; teste: boolean;
}

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const txt = (v: unknown, max: number): string | null => str(v).trim().slice(0, max) || null;
const objeto = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** As respostas de uma pergunta fechada: todas obrigatórias, chave estranha descartada. null = faltou ou veio fora da lista. */
function fechadas(bruto: unknown, perguntas: Record<string, readonly string[]>): Record<string, string> | null {
  const b = objeto(bruto);
  const out: Record<string, string> = {};
  for (const [chave, validos] of Object.entries(perguntas)) {
    const v = str(b[chave]).trim();
    if (!validos.includes(v)) return null;
    out[chave] = v;
  }
  return out;
}

const vazia = (porta: Porta): PortaLida => ({
  porta, solar: null, integrador: null, caminho: null, respostas: null, mobilidade: [], outro: null,
  objetivo: null, investimento: null, recurso: null,
});

/** A porta e as respostas dela, ou a frase do erro (400). */
export function lerPorta(b: Record<string, unknown>): PortaLida | { frase: string } {
  const porta = str(b.porta).trim();
  if (porta === 'solar') {
    const solar = fechadas(b.solar, SOLAR);
    return solar ? { ...vazia('solar'), solar } : { frase: 'Responda às perguntas da energia solar.' };
  }
  if (porta === 'integrador') {
    const integrador = fechadas(b.integrador, INTEGRADOR);
    return integrador ? { ...vazia('integrador'), integrador } : { frase: 'Responda às perguntas do integrador.' };
  }
  if (porta === 'eletroposto') {
    const caminho = str(b.caminho).trim() as CaminhoEp;
    if (!(ELETROPOSTO_VALIDOS as readonly string[]).includes(caminho)) return { frase: 'Escolha o seu caminho.' };
    const respostas = fechadas(b.respostas, PERGUNTAS[caminho]);
    if (!respostas) return { frase: 'Responda às perguntas do seu caminho.' };
    const empresa = caminho === 'parceiro' ? txt(objeto(b.respostas).empresa, 80) : null;
    if (empresa) respostas.empresa = empresa;
    return { ...vazia('eletroposto'), caminho, respostas };
  }
  if (porta === 'mobilidade') {
    const mobilidade = Array.isArray(b.mobilidade)
      ? [...new Set(b.mobilidade.slice(0, 30).map((i) => str(i)).filter((i) => (MOBILIDADE_IO as readonly string[]).includes(i)))]
      : [];
    const outro = txt(b.outro, 300);
    if (mobilidade.length === 0 && !outro) return { frase: 'Marque pelo menos uma opção ou escreva o que procura.' };
    const objetivo = str(b.objetivo).trim();
    if (!OBJETIVOS.has(objetivo)) return { frase: 'Diga qual é o seu objetivo.' };
    const investimento = str(b.investimento).trim();
    if (!INVESTIMENTOS.has(investimento)) return { frase: 'Escolha a faixa de investimento.' };
    const recurso = str(b.recurso).trim();
    if (!RECURSOS.has(recurso)) return { frase: 'Diga como pretende pagar.' };
    return { ...vazia('mobilidade'), mobilidade, outro, objetivo, investimento, recurso };
  }
  return { frase: 'Escolha o que você procura.' };
}

function utmDe(v: unknown): Record<string, string> | null {
  const o = objeto(v);
  const out: Record<string, string> = {};
  for (const k of UTM_CHAVES) {
    const s = txt(o[k], 200);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/** Cidade e UF separadas. A UF digitada vale: o canônico só é aceito se a UF dele for a mesma. */
function cidadeEUf(cidadeBruta: string, uf: string, telefone: string): { cidade: string; uf: string } {
  const canonico = cidadeParaGravar(`${cidadeBruta}-${uf}`, telefone);
  const m = canonico ? /^(.+)-([A-Z]{2})$/.exec(canonico) : null;
  if (m && m[2] === uf) return { cidade: m[1].slice(0, 80), uf };
  return { cidade: cidadeBruta, uf };
}

/** O contato (igual ao da NEXUS), ou a frase do erro (400). */
export function lerContato(b: Record<string, unknown>): Contato | { frase: string } {
  const nome = str(b.nome).trim();
  if (nome.length < 2 || nome.length > 80) return { frase: 'Informe seu nome, de 2 a 80 letras.' };
  const telefone = soDigitos(str(b.telefone));
  if (telefone.length < 12 || telefone.length > 13 || !telefone.startsWith('55')) return { frase: 'Confira o WhatsApp, com DDD.' };
  const email = str(b.email).trim().toLowerCase();
  if (email.length > 120 || !EMAIL_RE.test(email)) return { frase: 'Confira o e-mail.' };
  const cidadeBruta = txt(b.cidade, 80);
  if (!cidadeBruta) return { frase: 'Informe a cidade.' };
  const ufBruta = str(b.uf).trim().toUpperCase();
  if (!UFS.has(ufBruta)) return { frase: 'Escolha o estado.' };
  const cep = soDigitos(str(b.cep));
  if (cep !== '' && cep.length !== 8) return { frase: 'Confira o CEP.' };
  const { cidade, uf } = cidadeEUf(cidadeBruta, ufBruta, telefone);
  return {
    nome, telefone, email, cidade, uf, cep: cep || null,
    endereco: txt(b.endereco, 160), bairro: txt(b.bairro, 80), origem: txt(b.origem, 60), utm: utmDe(b.utm),
    teste: RE_TELEFONE_TESTE.test(telefone),
  };
}

/** Os parâmetros da io_instagram_gravar (banco principal). */
export function argumentosDaGravacao(p: PortaLida, c: Contato, whatsappOk: boolean | null): Record<string, unknown> {
  return {
    p_nome: c.nome, p_telefone: c.telefone, p_email: c.email, p_cep: c.cep, p_endereco: c.endereco, p_bairro: c.bairro,
    p_cidade: c.cidade, p_uf: c.uf, p_portas: [p.porta],
    p_solar: p.solar, p_eletroposto: p.caminho ? [p.caminho] : [],
    p_eletroposto_respostas: p.caminho && p.respostas ? { [p.caminho]: p.respostas } : {},
    p_integrador: p.integrador, p_mobilidade: p.mobilidade, p_outro: p.outro, p_objetivo: p.objetivo,
    p_investimento: p.investimento, p_recurso: p.recurso, p_origem: c.origem, p_utm: c.utm, p_teste: c.teste,
    p_whatsapp_ok: whatsappOk,
  };
}
