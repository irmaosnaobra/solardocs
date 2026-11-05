// Conferência do Fio B (Lei 14.300) na proposta do modelo 4, no servidor, ANTES de gerar: o Fio B não pode
// ser maior que a tarifa de energia nem comer a economia do ano 1. Usa os mesmos insumos e as mesmas contas
// do template (propostaSolarCompleta.ts), e há teste que cruza o limite daqui com o que o template imprime.
import { getRef, geracaoMensal } from './propostaSolarData';
import { parseBRL, propostaEmissao, str } from './propostaSolarBase';
import { anoCivil, lerFioB, serieFioB } from './propostaSolarCalculos';

export const MSG_FIO_B_MAIOR_QUE_TARIFA = 'O Fio B não pode ser maior que a tarifa de energia. Confira o valor.';
export const MSG_FIO_B_SEM_ECONOMIA = 'Com esse Fio B a proposta fica sem economia. Confira o valor do Fio B.';

/** Mensagem do primeiro problema econômico do Fio B (só com fio_b_mostrar = true e valores já válidos), ou null. */
export function validarFioBNaProposta(f: Record<string, unknown>, cliente?: { cidade?: string | null; uf?: string | null }): string | null {
  const fio = lerFioB(f);
  if (!fio) return null;

  const cidade = (str(f.cidade) === '___' ? (cliente?.cidade || '') : String(f.cidade)).trim();
  const uf = (str(f.uf) === '___' ? (cliente?.uf || 'SP') : String(f.uf)).trim().toUpperCase();
  const consumoKwh = parseBRL(f.consumo_kwh);
  const qtdModulos = parseInt(String(f.qtd_modulos || '0'), 10) || 0;
  const potenciaModulo = parseInt(String(f.potencia_modulo || '0'), 10) || 0;
  const kwp = (qtdModulos * potenciaModulo) / 1000;
  const taxaMinima = parseFloat(String(f.taxa_minima || '90').replace(',', '.')) || 90;
  const inflacaoPct = parseFloat(String(f.inflacao_aa || '6').replace(',', '.')) || 6;

  const refBase = getRef(uf, cidade);
  const tarifaOverride = parseFloat(String(f.tarifa_kwh || '').replace(',', '.'));
  const tarifa = tarifaOverride > 0 ? tarifaOverride : refBase.tarifa;
  if (fio.tarifa >= tarifa) return MSG_FIO_B_MAIOR_QUE_TARIFA;

  // Sem consumo a proposta não mostra economia: não há o que o Fio B comer.
  if (consumoKwh > 0) {
    const geracaoMediaOverride = parseBRL(f.geracao_media_kwh);
    const hspOverride = parseFloat(String(f.hsp || '').replace(',', '.')) || 0;
    const mensal = geracaoMensal(kwp, uf, cidade, geracaoMediaOverride > 0 ? geracaoMediaOverride : undefined, hspOverride > 0 ? hspOverride : undefined);
    const geracaoAnual = mensal.reduce((a, b) => a + b, 0);
    const serie = serieFioB({ fio, geracaoMediaMensal: geracaoAnual / 12, inflacao: inflacaoPct / 100, anoInicial: anoCivil(propostaEmissao(f)) });
    const contaHoje = Math.round(consumoKwh * tarifa);
    if (contaHoje - (taxaMinima + serie.custoMensal[0]) <= 0) return MSG_FIO_B_SEM_ECONOMIA;
  }
  return null;
}
