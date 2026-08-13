/**
 * FRETE — Uberlândia/MG para o Brasil inteiro, pelo CEP da obra.
 *
 * Kit off-grid é carga pesada: 8 módulos + 2 baterias passam de 400 kg. Correios
 * não leva, então a conta é de transportadora rodoviária de carga fracionada,
 * onde o preço sobe com a DISTÂNCIA e com o PESO.
 *
 * De onde vem cada peça da conta:
 *  - UF: dos dois primeiros dígitos do CEP (faixa oficial dos Correios). Não
 *    depende de API nenhuma — CEP mal digitado vira erro na hora, não frete
 *    errado no orçamento.
 *  - Distância: rodoviária aproximada de Uberlândia até a capital da UF.
 *    Dentro de MG a conta usa uma distância menor, porque é o nosso quintal.
 *  - R$/kg: cresce com a distância. Bateria de lítio é carga com restrição
 *    (ONU 3480) e paga sobretaxa — transportadora cobra, e esconder isso aqui
 *    só transfere a surpresa pro momento da entrega.
 *
 * ISTO É ESTIMATIVA e a tela diz isso. O número que vale é a cotação da
 * transportadora no dia, com o volume real fechado.
 */

/** Origem: nosso galpão. */
export const CEP_ORIGEM = '38400-000';
export const CIDADE_ORIGEM = 'Uberlândia/MG';

/** Faixas oficiais de CEP (limite inicial → UF). */
const FAIXAS: { ate: number; uf: string }[] = [
  { ate: 19999, uf: 'SP' }, { ate: 28999, uf: 'RJ' }, { ate: 29999, uf: 'ES' },
  { ate: 39999, uf: 'MG' }, { ate: 48999, uf: 'BA' }, { ate: 49999, uf: 'SE' },
  { ate: 56999, uf: 'PE' }, { ate: 57999, uf: 'AL' }, { ate: 58999, uf: 'PB' },
  { ate: 59999, uf: 'RN' }, { ate: 63999, uf: 'CE' }, { ate: 64999, uf: 'PI' },
  { ate: 65999, uf: 'MA' }, { ate: 68899, uf: 'PA' }, { ate: 68999, uf: 'AP' },
  { ate: 69299, uf: 'AM' }, { ate: 69399, uf: 'RR' }, { ate: 69899, uf: 'AM' },
  { ate: 69999, uf: 'AC' }, { ate: 72799, uf: 'DF' }, { ate: 72999, uf: 'GO' },
  { ate: 73699, uf: 'DF' }, { ate: 76799, uf: 'GO' }, { ate: 76999, uf: 'RO' },
  { ate: 77999, uf: 'TO' }, { ate: 78899, uf: 'MT' }, { ate: 79999, uf: 'MS' },
  { ate: 87999, uf: 'PR' }, { ate: 89999, uf: 'SC' }, { ate: 99999, uf: 'RS' },
];

/** Distância rodoviária de Uberlândia até a capital de cada UF (km). */
const DISTANCIA_KM: Record<string, number> = {
  MG: 300,  // média dentro do estado: BH dá 540, Uberaba 105, Araguari 35
  GO: 400, DF: 440, SP: 590, TO: 900, MS: 900, RJ: 830, ES: 1000,
  PR: 1000, MT: 1100, SC: 1250, BA: 1450, SE: 1650, RS: 1700,
  AL: 1850, PI: 1900, PE: 2000, MA: 2100, CE: 2100, PB: 2150,
  PA: 2200, RN: 2250, RO: 2400, AC: 2900, AP: 2900, AM: 3300, RR: 4000,
};

const NOME_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
  RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins',
};

/** R$ por kg em função da distância — carga fracionada rodoviária. */
const TARIFA_BASE = 0.45;
const TARIFA_POR_KM = 0.00095;
/** Piso: abaixo disso nenhuma transportadora coleta. */
const PISO = 280;
/** Sobretaxa de carga perigosa (ONU 3480 — lítio). */
const SOBRETAXA_LITIO = 0.18;

export interface FreteCalculado {
  ok: boolean;
  erro?: string;
  cep: string;
  uf: string;
  ufNome: string;
  cidade?: string;
  km: number;
  pesoKg: number;
  valor: number;
  prazo: string;
  regiao: string;
  detalhe: string;
  temLitio: boolean;
}

export function ufDoCep(cep: string): string | null {
  const d = (cep || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  const n = parseInt(d.slice(0, 5), 10);
  for (const f of FAIXAS) if (n <= f.ate) return f.uf;
  return null;
}

function prazoPorKm(km: number): string {
  if (km <= 450) return '2 a 4 dias úteis';
  if (km <= 900) return '3 a 6 dias úteis';
  if (km <= 1500) return '5 a 9 dias úteis';
  if (km <= 2300) return '7 a 12 dias úteis';
  return '12 a 20 dias úteis';
}

/**
 * Calcula o frete. `cidade` é opcional e serve só pra mostrar na tela — a conta
 * não depende dela.
 */
export function calcularFrete(opts: {
  cep: string;
  pesoKg: number;
  temLitio: boolean;
  cidade?: string;
}): FreteCalculado {
  const cep = (opts.cep || '').replace(/\D/g, '');
  const uf = ufDoCep(cep);
  const peso = Math.max(0, opts.pesoKg || 0);

  if (!uf) {
    return {
      ok: false,
      erro: cep.length !== 8 ? 'CEP precisa ter 8 dígitos' : 'CEP fora das faixas dos Correios',
      cep, uf: '', ufNome: '', km: 0, pesoKg: peso, valor: 0,
      prazo: '', regiao: '', detalhe: '', temLitio: opts.temLitio,
    };
  }

  const km = DISTANCIA_KM[uf] ?? 1500;
  const porKg = TARIFA_BASE + km * TARIFA_POR_KM;
  const bruto = peso * porKg;
  const comLitio = opts.temLitio ? bruto * (1 + SOBRETAXA_LITIO) : bruto;
  const valor = Math.max(PISO, Math.round(comLitio));

  const detalhe = [
    `${CIDADE_ORIGEM} → ${opts.cidade ? opts.cidade + '/' : ''}${uf}`,
    `~${km.toLocaleString('pt-BR')} km`,
    `${peso.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`,
    `R$ ${porKg.toFixed(2).replace('.', ',')}/kg`,
    opts.temLitio ? `+${Math.round(SOBRETAXA_LITIO * 100)}% carga perigosa (lítio)` : '',
  ].filter(Boolean).join(' · ');

  return {
    ok: true,
    cep,
    uf,
    ufNome: NOME_UF[uf] || uf,
    cidade: opts.cidade,
    km,
    pesoKg: peso,
    valor,
    prazo: prazoPorKm(km),
    regiao: NOME_UF[uf] || uf,
    detalhe,
    temLitio: opts.temLitio,
  };
}

/**
 * Cidade do CEP, via ViaCEP. Só melhora o texto que aparece na tela ("Uberlândia
 * → Salvador/BA"); o frete não depende disso. Falhou ou demorou, segue sem.
 */
export async function cidadeDoCep(cep: string): Promise<{ cidade: string; uf: string } | null> {
  const d = (cep || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as { localidade?: string; uf?: string; erro?: boolean };
    if (j.erro || !j.localidade) return null;
    return { cidade: j.localidade, uf: j.uf || '' };
  } catch {
    return null;
  }
}
