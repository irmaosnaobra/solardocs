/**
 * DESENHOS DO INVENTÁRIO
 *
 * Mesmo jogo do Kit Off-Grid, agora pro patrimônio da empresa: 46 materiais que
 * eram só texto numa lista suspensa. Quem procura o alicate crimpador MC4 acha
 * pela forma antes de ler.
 *
 * A moldura e os glifos repetidos (ar-condicionado, notebook, impressora,
 * roteador, bebedouro, furadeira) vêm de `lib/desenhos` — são os mesmos objetos
 * dos dois catálogos e precisam ser o MESMO desenho.
 *
 * Como no off-grid: monocromático em `currentColor`, um desenho serve vários
 * itens, e material fora do catálogo cai no ícone do LOCAL em vez de vir vazio.
 */
import {
  svg, ArCondicionado, Notebook, Desktop, Impressora, Roteador, Bebedouro,
  Furadeira, Tomada, type IconeDesenho,
} from '@/lib/desenhos';

// ───────────────────────────────────────────────────────────────── ESCRITÓRIO ──
const Mesa = svg(<>
  <path d="M2 8.5h20" />
  <path d="M3.5 8.5V20M20.5 8.5V20" />
  <path d="M3.5 13h17" />
</>);
const Cadeira = svg(<>
  <path d="M6.5 3.5h11l-1 9h-9Z" />
  <path d="M5.5 12.5h13" />
  <path d="M7 12.5 6 21M17 12.5l1 8.5" />
  <path d="M7.5 17h9" />
</>);
const Monitor = svg(<>
  <rect x="2" y="3.5" width="20" height="13" rx="2.5" />
  <path d="M12 16.5v4M8 20.5h8" />
</>);
const Nobreak = svg(<>
  <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
  <path d="M13.2 7 10 12.5h3.4L10.6 17.5" />
  <path d="M8.5 5h.01M15.5 5h.01" />
</>);
const Armario = svg(<>
  <rect x="4" y="2.5" width="16" height="19" rx="2" />
  <path d="M12 2.5v19" />
  <path d="M10 10.5v2.5M14 10.5v2.5" />
</>);
const Telefone = svg(<>
  <path d="M7.5 3.5h9v4.5h-9Z" />
  <path d="M5.5 12.5h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
  <path d="M7 15.5h.01M10 15.5h.01M13 15.5h.01" />
</>);

// ──────────────────────────────────────────────────────────────────── MONTAGEM ──
const Parafusadeira = svg(<>
  <path d="M3.5 6h8a1.6 1.6 0 0 1 1.6 1.6v3.8A1.6 1.6 0 0 1 11.5 13h-8Z" />
  <path d="M13.1 9.5h3.2" />
  <path d="M16.3 8.2h1.8v2.6h-1.8Z" />
  <path d="M18.1 9.5 21 8v3Z" />
  <path d="M5 13.2 4 20.5h3.6l1-7.3" />
</>);
const Martelo = svg(<>
  <path d="M11.5 8 4 15.5a2.2 2.2 0 0 0 3.1 3.1L14.6 11" />
  <path d="M9.5 5.5 13 2l7 7-3.5 3.5Z" />
  <path d="M12 8.5 15.5 5" />
</>);
const Lixadeira = svg(<>
  <path d="M3.5 13h17v3.5a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5Z" />
  <path d="M7 13V9.5A3 3 0 0 1 10 6.5h4a3 3 0 0 1 3 3V13" />
  <path d="M9.5 6.5V4.2h5v2.3" />
  <path d="M4 21.5h16" />
</>);
const Esmerilhadeira = svg(<>
  <rect x="1.5" y="9" width="10.5" height="6.5" rx="2.5" />
  <path d="M12 10.8h2.6v3H12Z" />
  <path d="M14.6 12.3a4.6 4.6 0 0 1 4.6-4.6v9.2a4.6 4.6 0 0 1-4.6-4.6Z" />
  <path d="M19.2 7.2v10.2" />
  <path d="M4 15.5v3.5h4" />
</>);
const Alicate = svg(<>
  <path d="M10 9.8 6 2.5M14 9.8l4-7.3" />
  <circle cx="12" cy="11.8" r="1.7" />
  <path d="M10.9 13.3 8.2 21.5M13.1 13.3l2.7 8.2" />
</>);
const AlicateMc4 = svg(<>
  <path d="M10 9.8 6.6 3.5M14 9.8l3.4-6.3" />
  {/* o conector MC4 entre os bicos e' o que separa este do alicate comum */}
  <circle cx="12" cy="4.6" r="2" />
  <circle cx="12" cy="11.8" r="1.7" />
  <path d="M10.9 13.3 8.2 21.5M13.1 13.3l2.7 8.2" />
</>);
const Chaves = svg(<>
  <path d="M5 3.5v6.5a2 2 0 0 0 2 2v9" />
  <path d="M3.5 3.5h3M3.5 6h3" />
  <path d="M12 3.5v17" />
  <path d="M10.5 3.5h3M10.5 6h3" />
  <path d="M19 3.5v17" />
  <path d="M17.5 3.5h3M17.5 6h3" />
</>);
const ChaveInglesa = svg(<>
  <path d="M17.5 3a5 5 0 0 0-4.3 7.5L4 19.7a2.2 2.2 0 0 0 3.1 3.1l9.2-9.2A5 5 0 1 0 17.5 3Z" />
  <path d="M15.3 5.2 18 7.9" />
</>);
const Multimetro = svg(<>
  <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
  <rect x="6.5" y="5" width="11" height="5" rx="1.2" />
  <circle cx="12" cy="15" r="2.8" />
  <path d="M7 19h.01M17 19h.01" />
</>);
const Escada = svg(<>
  <path d="M7 2.5 4 21.5M17 2.5l3 19" />
  <path d="M6.3 7h11.4M5.6 11.5h12.8M4.9 16h14.2" />
</>);
const Trena = svg(<>
  <circle cx="8.5" cy="13" r="6.5" />
  <circle cx="8.5" cy="13" r="2" />
  <path d="M15 13h6" />
  <path d="M21 10.8v4.4" />
  <path d="M16.8 11.6v1.2M18.8 11.6v1.2" />
</>);
const NivelLaser = svg(<>
  <rect x="2.5" y="8.5" width="19" height="6" rx="2" />
  <circle cx="12" cy="11.5" r="1.8" />
  <path d="M6 11.5h2M16 11.5h2" />
  <path d="M12 3v3M12 17v3.5" />
</>);
const Capacete = svg(<>
  <path d="M3 15.5a9 9 0 0 1 18 0Z" />
  <path d="M8.5 15.5V6.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v9" />
  <path d="M2 15.5h20" />
  <path d="M4 18.5h16" />
</>);
const Luva = svg(<>
  <path d="M6 21V9a2 2 0 0 1 4 0V4.5a1.8 1.8 0 0 1 3.6 0V9M13.6 9V5.5a1.8 1.8 0 0 1 3.6 0V13a8 8 0 0 1-2.4 5.7L13 21" />
  <path d="M10 9V6" />
</>);
const Cinto = svg(<>
  <path d="M2.5 8.5h19v7h-19Z" />
  <rect x="8.5" y="6.5" width="7" height="11" rx="1.8" />
  <path d="M11 10.5h2v3h-2Z" />
</>);

// ───────────────────────────────────────────────────────────────────── DEPÓSITO ──
const Cabo = svg(<>
  <path d="M3 6.5h4.5a5.5 5.5 0 0 1 0 11H3" />
  <path d="M21 17.5h-4.5a5.5 5.5 0 0 1 0-11H21" />
</>);
const ConectorMc4 = svg(<>
  <path d="M2 12h5" />
  <path d="M7 8.5h4.5v7H7Z" />
  <path d="M12.5 8.5H17v7h-4.5Z" />
  <path d="M17 12h5" />
  <path d="M11.5 10.5h1M11.5 13.5h1" />
</>);
const Parafuso = svg(<>
  <path d="M9 2.5h6v3.5H9Z" />
  <path d="M12 6v14" />
  <path d="M9.5 8.5h5M9.5 11.5h5M9.5 14.5h5" />
  <path d="M11 3.5h2" />
</>);
const Disjuntor = svg(<>
  <rect x="6" y="2.5" width="12" height="19" rx="2" />
  <path d="M9 8h6v5H9Z" />
  <path d="M12 5v3M12 13v3.5" />
  <path d="M6 17.5h12" />
</>);
const StringBox = svg(<>
  <rect x="3" y="4" width="18" height="16" rx="2.5" />
  <path d="M7 8v8M11 8v8M15 8v8" />
  <path d="M18.5 8.5h.01M18.5 11.5h.01" />
</>);
const Dps = svg(<>
  <rect x="6.5" y="2" width="11" height="13" rx="2" />
  <path d="M13.4 4.6 9.8 10.3h3.8L10 14.6" />
  <path d="M7 18h10M8.8 20.4h6.4M10.6 22.5h2.8" />
</>);
const Eletroduto = svg(<>
  <path d="M2 8.5h11a5 5 0 0 1 0 10h-3" />
  <path d="M2 15.5h8" />
  <path d="M13 8.5v10" />
  <path d="M2 8.5v7" />
</>);
const Abracadeira = svg(<>
  <rect x="8" y="2.5" width="7.5" height="5" rx="1.8" />
  <path d="M11.7 7.5v2.2" />
  <path d="M11.7 9.7c4.6 0 7.8 2.6 7.8 6s-3.5 5.8-7.8 5.8-7.8-2.4-7.8-5.8c0-1.7.8-3.1 2.2-4.2" />
</>);
const FitaIsolante = svg(<>
  <circle cx="11" cy="11" r="8.5" />
  <circle cx="11" cy="11" r="3.2" />
  <path d="M19 14.5 22 21l-4-1.5" />
</>);
const Terminal = svg(<>
  <circle cx="6" cy="12" r="3.5" />
  <path d="M9.5 10h9a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-9Z" />
  <path d="M6 12h.01" />
</>);
const Estrutura = svg(<>
  <path d="M2.5 17.5 21.5 6" />
  <path d="M6 15.3v5.2M17.5 8.5v3.5" />
  <path d="M4 20.5h4M15.5 12h4" />
  <path d="M9.5 13.2v3.5M13.5 10.8v3.5" />
</>);
const PainelSolar = svg(<>
  <path d="M2.5 4h19l-2 11h-15Z" />
  <path d="M4 9.5h16" />
  <path d="M9.8 4 8.5 15M14.2 4l1.3 11" />
  <path d="M12 15v5.5M8.5 20.5h7" />
</>);
const Inversor = svg(<>
  <rect x="3" y="4" width="18" height="13" rx="2.5" />
  <path d="M6 9.5h4" />
  <path d="M6.5 12.5h.01M8 12.5h.01M9.5 12.5h.01" />
  <path d="M13 11.8c.9-2.4 1.9-2.4 2.8 0s1.9 2.4 2.8 0" />
  <path d="M8 20.5h8" />
</>);

// ────────────────────────────────────────────────────────────── VEÍCULOS / FROTA ──
const Caminhonete = svg(<>
  <path d="M1.5 15.5v-4h9V7.5h4l3.5 4h4.5v4" />
  <path d="M1.5 15.5h2M8.5 15.5h5.5M19 15.5h3.5" />
  <circle cx="6" cy="16.5" r="2.4" /><circle cx="16.6" cy="16.5" r="2.4" />
</>);
const Van = svg(<>
  <path d="M1.5 16v-8a2 2 0 0 1 2-2h9.5l4.5 4h3a2 2 0 0 1 2 2v4" />
  <path d="M1.5 16h2M8.5 16h6M19 16h3.5" />
  <path d="M13 6v4h5" />
  <circle cx="6" cy="17" r="2.4" /><circle cx="16.6" cy="17" r="2.4" />
</>);
const Moto = svg(<>
  <circle cx="5" cy="16.5" r="3.5" /><circle cx="19" cy="16.5" r="3.5" />
  <path d="M5 16.5h4l3.5-6h4" />
  <path d="M12.5 10.5 15.5 16.5" />
  <path d="M9 10.5h4" />
  <path d="M16.5 10.5 19 16.5" />
</>);
const CarrinhoCarga = svg(<>
  <path d="M4 2.5v13a2.5 2.5 0 0 0 2.5 2.5H18" />
  <path d="M2.5 2.5H4" />
  <path d="M7.5 5h9v8h-9Z" />
  <circle cx="7" cy="20" r="1.8" /><circle cx="17" cy="20" r="1.8" />
</>);

// ───────────────────────────────────────────────────────────── ÍCONE DO LOCAL ──
/** Cada local ganha o seu — e é ele que segura o material fora do catálogo. */
export const ICONE_LOCAL: Record<string, IconeDesenho> = {
  'Escritório': Mesa,
  'Montagem': Furadeira,
  'Depósito': StringBox,
  'Veículos / Frota': Caminhonete,
  // Não estão no catálogo, mas são os dois nomes que o integrador mais cria à
  // mão — e são depósito com outro nome.
  'Galpão': StringBox,
  'Almoxarifado': StringBox,
};

/** Material → desenho. Um glifo serve vários quando a forma é a mesma. */
export const ICONE_MATERIAL: Record<string, IconeDesenho> = {
  // Escritório
  'Mesa': Mesa, 'Cadeira': Cadeira, 'Ar-condicionado': ArCondicionado,
  'Computador': Desktop, 'Notebook': Notebook, 'Monitor': Monitor,
  'Impressora': Impressora, 'Roteador': Roteador, 'Nobreak': Nobreak,
  'Armário': Armario, 'Bebedouro': Bebedouro, 'Telefone': Telefone,
  // Montagem
  'Parafusadeira': Parafusadeira, 'Furadeira': Furadeira, 'Martelo': Martelo,
  'Lixadeira': Lixadeira, 'Esmerilhadeira': Esmerilhadeira, 'Alicate': Alicate,
  'Alicate crimpador MC4': AlicateMc4, 'Jogo de chaves': Chaves,
  'Chave inglesa': ChaveInglesa, 'Multímetro': Multimetro, 'Escada': Escada,
  'Trena': Trena, 'Nível a laser': NivelLaser, 'Capacete (EPI)': Capacete,
  'Luva (EPI)': Luva, 'Cinto de segurança (EPI)': Cinto,
  // Depósito
  'Cabo solar 6mm': Cabo, 'Cabo CA': Cabo, 'Conector MC4': ConectorMc4,
  'Parafuso': Parafuso, 'Disjuntor': Disjuntor, 'String box': StringBox,
  'DPS': Dps, 'Eletroduto': Eletroduto, 'Abraçadeira': Abracadeira,
  'Fita isolante': FitaIsolante, 'Terminal': Terminal,
  'Estrutura de fixação': Estrutura, 'Painel solar': PainelSolar,
  'Inversor': Inversor,
  // Veículos
  'Caminhonete': Caminhonete, 'Van': Van, 'Moto': Moto,
  'Carrinho de carga': CarrinhoCarga,
};

/**
 * O desenho de um material. Item digitado à mão ("Outro") não está no catálogo:
 * cai no ícone do LOCAL, e local desconhecido cai na tomada. Nunca volta vazio.
 *
 * O casamento ignora caixa e acentos porque o nome pode ter sido digitado pelo
 * consultor — "multimetro" e "Multímetro" são o mesmo objeto.
 */
const semAcento = (t: string) =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

const POR_NOME_SOLTO: Record<string, IconeDesenho> = Object.fromEntries(
  Object.entries(ICONE_MATERIAL).map(([k, v]) => [semAcento(k), v]),
);

/**
 * Termos genéricos que NÃO existem no catálogo mas aparecem o tempo todo num
 * inventário de verdade. O catálogo tem "Cabo solar 6mm" e "Cabo CA" — não tem
 * a palavra "cabo" sozinha. Sem esta lista, "Cabo do inversor" não casava com
 * nenhum começo e caía no `inversor` do meio da frase.
 */
const APELIDOS: Record<string, IconeDesenho> = {
  cabo: Cabo, fio: Cabo, chicote: Cabo,
  painel: PainelSolar, modulo: PainelSolar, placa: PainelSolar,
  conector: ConectorMc4, plug: ConectorMc4,
  alicate: Alicate, chave: ChaveInglesa, martelo: Martelo,
  parafuso: Parafuso, porca: Parafuso, arruela: Parafuso, bucha: Parafuso,
  broca: Furadeira, furadeira: Furadeira, parafusadeira: Parafusadeira,
  fita: FitaIsolante, abracadeira: Abracadeira, terminal: Terminal,
  luva: Luva, capacete: Capacete, cinto: Cinto, epi: Capacete,
  escada: Escada, trena: Trena, nivel: NivelLaser, multimetro: Multimetro,
  estrutura: Estrutura, perfil: Estrutura, trilho: Estrutura, suporte: Estrutura,
  eletroduto: Eletroduto, conduite: Eletroduto,
  disjuntor: Disjuntor, dps: Dps, inversor: Inversor, nobreak: Nobreak,
  mesa: Mesa, cadeira: Cadeira, armario: Armario, monitor: Monitor,
  computador: Desktop, notebook: Notebook, impressora: Impressora,
  caminhonete: Caminhonete, caminhao: Caminhonete, carro: Caminhonete,
  veiculo: Caminhonete, van: Van, moto: Moto, carrinho: CarrinhoCarga,
};

const BUSCA: Record<string, IconeDesenho> = { ...APELIDOS, ...POR_NOME_SOLTO };

/**
 * Ordenado da chave MAIS LONGA pra mais curta: "cabo solar 6mm" precisa ganhar
 * de "cabo" quando os dois cabem no nome.
 */
const CHAVES_POR_TAMANHO = Object.keys(BUSCA).sort((a, b) => b.length - a.length);

export function iconeDoMaterial(nome: string, local?: string): IconeDesenho {
  const cru = nome || '';
  const limpo = semAcento(cru);
  const exato = ICONE_MATERIAL[cru] ?? POR_NOME_SOLTO[limpo];
  if (exato) return exato;

  // O nome guardado no banco quase nunca é o do catálogo: o consultor escolhe
  // "Cabo solar 6mm" e depois edita pra "Cabo solar 6mm² preto". Casar só por
  // igualdade fazia a lista inteira de um inventário REAL cair no ícone padrão
  // — funcionava na demonstração e falhava no cliente.
  //
  // O COMEÇO GANHA DO MEIO, e não a chave mais longa. Só por tamanho,
  // "Cabo do inversor" casava com `inversor` (8 letras) em vez de `cabo` (4) e
  // saía com o desenho de um inversor — pior que o ícone padrão, porque erra
  // com confiança. Em português o substantivo principal vem primeiro: o que o
  // item É está no início do nome, o resto qualifica.
  if (limpo) {
    const comeca = CHAVES_POR_TAMANHO.find((k) => limpo.startsWith(k));
    if (comeca) return BUSCA[comeca];
    const contem = CHAVES_POR_TAMANHO.find((k) => limpo.includes(k));
    if (contem) return BUSCA[contem];
  }

  return (local ? ICONE_LOCAL[local] : undefined) ?? Tomada;
}

export { Tomada };
