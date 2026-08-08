// ─────────────────────────────────────────────────────────────────────────────
// A OFERTA que as agentes mandam no WhatsApp: link do site + cupom pra digitar.
//
// Decisão do Thiago (08/08/2026): parou de mandar Pix copia-e-cola pra converter.
// Agora o caminho é um só — a pessoa entra em solardoc.app, assina no cartão e
// DIGITA o cupom no checkout pra pagar R$ 19 no primeiro mês. Ela mesma se
// cadastra, ninguém precisa liberar acesso na mão.
//
// O cupom vem do BANCO, não de constante: desligar o cupom lá (`ativo = false`)
// faz a Giovanna parar de oferecer sozinha, sem deploy. Sem cupom vivo, ela
// convida pro site do mesmo jeito — só não promete desconto que não existe.
// ─────────────────────────────────────────────────────────────────────────────

import { buscarCupomValido, aplicarCupom, cupomAtivoParaPlano } from '../services/cuponsService';
import { PLANO_PUBLICO } from './planos';

export const LINK_ASSINATURA = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

export interface OfertaCupom {
  codigo: string;
  primeiroMes: number;
  precoCheio: number;
}

// A oferta viva do plano público. Devolve null quando não há cupom válido.
export async function ofertaCupomAtiva(): Promise<OfertaCupom | null> {
  const aplicado = aplicarCupom(await cupomAtivoParaPlano(PLANO_PUBLICO.plano), PLANO_PUBLICO.valor);
  if (!aplicado) return null;
  return { codigo: aplicado.cupom.codigo, primeiroMes: aplicado.primeiroMes, precoCheio: aplicado.precoCheio };
}

// Confere um código específico (quando já sabemos qual oferecer).
export async function ofertaDoCupom(codigo: string): Promise<OfertaCupom | null> {
  const aplicado = aplicarCupom(await buscarCupomValido(codigo, PLANO_PUBLICO.plano), PLANO_PUBLICO.valor);
  if (!aplicado) return null;
  return { codigo: aplicado.cupom.codigo, primeiroMes: aplicado.primeiroMes, precoCheio: aplicado.precoCheio };
}

// As bolhas do WhatsApp com o passo a passo. Curtas de propósito: é isto que a
// pessoa vai ler no celular enquanto abre o site. Uma ideia por bolha.
export function bolhasOferta(oferta: OfertaCupom | null): string[] {
  if (!oferta) {
    return [
      `É rapidinho: ${LINK_ASSINATURA}`,
      `Clica em assinar e o acesso libera na hora, R$ ${PLANO_PUBLICO.valor}/mês. Cancela quando quiser 🙌`,
    ];
  }
  return [
    `Entra aqui: ${LINK_ASSINATURA}`,
    `Clica em assinar e, na tela de pagamento, abre *Adicionar código promocional* e digita: *${oferta.codigo}*`,
    `Aí o primeiro mês sai por R$ ${oferta.primeiroMes} em vez de R$ ${oferta.precoCheio}. Depois é R$ ${oferta.precoCheio}/mês e você cancela quando quiser 🙌`,
  ];
}

// Resumo de uma linha pro prompt das agentes (elas escrevem o texto; isto é só
// o fato que elas não podem errar).
export function resumoOfertaParaPrompt(oferta: OfertaCupom | null): string {
  if (!oferta) {
    return `Assinatura do SolarDoc: R$ ${PLANO_PUBLICO.valor}/mês em ${LINK_ASSINATURA}, acesso na hora, cancela quando quiser. Hoje NÃO há cupom de desconto — não invente nenhum.`;
  }
  return [
    `OFERTA DE HOJE: primeiro mês por R$ ${oferta.primeiroMes} (depois R$ ${oferta.precoCheio}/mês, sem fidelidade).`,
    `O desconto só entra se ele DIGITAR o cupom ${oferta.codigo} no checkout, em "Adicionar código promocional". O acesso libera na hora, ele mesmo faz tudo em ${LINK_ASSINATURA}.`,
  ].join(' ');
}
