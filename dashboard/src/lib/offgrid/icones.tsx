/**
 * DESENHOS DOS APARELHOS
 *
 * Jogo de ícones próprio, feito à mão pro catálogo off-grid. Não é lucide: os
 * traços aqui são mais grossos e mais arredondados de propósito, pra ler como
 * DESENHO a 20px dentro da linha do aparelho — e não como ícone de barra de
 * ferramenta.
 *
 * Três regras que valem pro jogo inteiro:
 *
 * 1. MONOCROMÁTICO, em `currentColor`. A cor não mora no desenho: mora no
 *    estado. Aparelho não marcado fica no cinza do texto; marcado herda o
 *    âmbar do card. Ícone colorido viraria adesivo e brigaria com a marca de
 *    quem usa a plataforma.
 * 2. UM DESENHO SERVE VÁRIOS APARELHOS. Geladeira, frigobar, freezer vertical
 *    e adega são a mesma silhueta — insistir em 70 desenhos diferentes daria
 *    70 desenhos ruins. São ~40 glifos cobrindo os 70 itens.
 * 3. NUNCA VOLTA VAZIO. Aparelho sem mapa cai no ícone do GRUPO dele; grupo
 *    sem ícone cai numa tomada. Item novo no catálogo entra desenhado.
 */
import type { GrupoCarga } from './catalogo';
// A moldura e os glifos que o Inventário também usa moram em lib/desenhos:
// desenhar o mesmo ar-condicionado duas vezes daria dois ar-condicionados
// ligeiramente diferentes, que é pior do que não ter desenho.
import {
  svg, ArCondicionado, Notebook, Desktop, Impressora, Roteador, Bebedouro,
  Furadeira, Tomada, type IconeDesenho,
} from '@/lib/desenhos';

export type { IconeDesenho };

// ─────────────────────────────────────────────────────────────── ILUMINAÇÃO ──
const Lampada = svg(<>
  <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.2h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
  <path d="M9.6 19h4.8M10.5 21.5h3" />
</>);
const Plafon = svg(<>
  <rect x="3" y="6.5" width="18" height="5.5" rx="2.5" />
  <path d="M12 4.5V3" />
  <path d="M7 15v2M12 15v3M17 15v2" />
</>);
const Refletor = svg(<>
  <path d="M3 7.2 14.5 3.5v11L3 10.8Z" />
  <path d="M17 6.5h3.5M17 10h4M17 13.5h3.5" />
  <path d="M8 14.5V20M5.5 20h5" />
</>);
const Poste = svg(<>
  <path d="M8.5 9.5h7L14 5.5h-4Z" />
  <path d="M12 9.5V21M9 21h6" />
  <path d="M12 5.5V3" />
</>);

// ────────────────────────────────────────────────────────────────── COZINHA ──
const Geladeira = svg(<>
  <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
  <path d="M6 9.5h12" />
  <path d="M9 5.5v2M9 12v3" />
</>);
const Freezer = svg(<>
  <rect x="2.5" y="7.5" width="19" height="10" rx="2.5" />
  <path d="M2.5 11h19" />
  <path d="M16.5 9.2h2.5" />
  <path d="M5.5 17.5v3M18.5 17.5v3" />
</>);
const Microondas = svg(<>
  <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
  <rect x="5" y="9" width="9.5" height="6" rx="1.5" />
  <path d="M18 9.5v.01M18 12v.01M18 14.5v.01" />
</>);
const AirFryer = svg(<>
  <rect x="4.5" y="3" width="15" height="18" rx="3.5" />
  <path d="M4.5 12.5h15" />
  <path d="M9 17h6" />
  <circle cx="12" cy="7.5" r="2.2" />
</>);
const Cooktop = svg(<>
  <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
  <circle cx="8" cy="9.5" r="2.3" /><circle cx="16" cy="9.5" r="2.3" />
  <circle cx="8" cy="15" r="2.3" /><circle cx="16" cy="15" r="2.3" />
</>);
const Panela = svg(<>
  <path d="M3.5 9.5h17v5.5a4.5 4.5 0 0 1-4.5 4.5H8a4.5 4.5 0 0 1-4.5-4.5Z" />
  <path d="M3.5 12H1.8M20.5 12h1.7" />
  <path d="M9.5 6.5c0-1.2 1.2-1.4 1.2-2.6M14 6.5c0-1.2 1.2-1.4 1.2-2.6" />
</>);
const Cafeteira = svg(<>
  <path d="M6 8.5h9.5v8a3.5 3.5 0 0 1-3.5 3.5H9.5A3.5 3.5 0 0 1 6 16.5Z" />
  <path d="M15.5 10.5h1.8a2.2 2.2 0 0 1 0 4.4h-1.8" />
  <path d="M8.5 8.5V5.5h5v3" />
  <path d="M7 21.5h9" />
</>);
const Liquidificador = svg(<>
  <path d="M8 3h8l-.8 3.2H8.8Z" />
  <path d="M8.8 6.2h6.4l-1 8.3H9.8Z" />
  <path d="M7 14.5h10v3.7a2.8 2.8 0 0 1-2.8 2.8H9.8A2.8 2.8 0 0 1 7 18.2Z" />
  <path d="M13.8 17.3h1.4" />
</>);
const Coifa = svg(<>
  <path d="M3 10 6.5 4h11L21 10Z" />
  <path d="M3.5 10h17v3.5h-17Z" />
  <path d="M8 13.5v3.5M12 13.5v5M16 13.5v3.5" />
</>);

// ───────────────────────────────────────────────── SALA E ELETRÔNICOS ──
const Tv = svg(<>
  <rect x="2" y="3.5" width="20" height="13" rx="2.5" />
  <path d="M12 16.5v4M8 20.5h8" />
</>);
const Som = svg(<>
  <rect x="5.5" y="2.5" width="13" height="19" rx="2.5" />
  <circle cx="12" cy="7.5" r="1.8" />
  <circle cx="12" cy="15.5" r="3.2" />
</>);
const Videogame = svg(<>
  <path d="M7.5 8h9a5.5 5.5 0 0 1 5.5 5.5v.7a3 3 0 0 1-5.3 1.9l-1.2-1.4H8.5l-1.2 1.4A3 3 0 0 1 2 14.2v-.7A5.5 5.5 0 0 1 7.5 8Z" />
  <path d="M6.5 11.5v2.2M5.4 12.6h2.2" />
  <circle cx="16.8" cy="12.3" r=".9" />
</>);
const Antena = svg(<>
  <path d="M5 18.5c-2.6-4.5-1.2-10.3 3.3-12.9s10.3-1.2 12.9 3.3Z" />
  <path d="M13.5 11.6 16 7.4" />
  <circle cx="16.8" cy="6" r="1.4" />
  <path d="M5 18.5 3.5 22M1.5 22h6.5" />
</>);
const Celular = svg(<>
  <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
  <path d="M10.5 5.2h3" />
  <path d="M12.8 9.5 11 13h2.2l-1.8 3.5" />
</>);

// ─────────────────────────────────────────────────────── CONFORTO TÉRMICO ──
const Ventilador = svg(<>
  <circle cx="12" cy="9" r="6.5" />
  <circle cx="12" cy="9" r="1.4" />
  <path d="M12 7.6V3.2M10.7 9.8 6.4 12M13.3 9.8l4.3 2.2" />
  <path d="M12 15.5v5M9 20.5h6" />
</>);
const VentTeto = svg(<>
  <path d="M12 2.5v3.5" />
  <circle cx="12" cy="8" r="2" />
  <path d="M10 8H4.5a1.6 1.6 0 0 0 0 4.4H9" />
  <path d="M14 8h5.5a1.6 1.6 0 0 1 0 4.4H15" />
  <path d="M12.6 10c1.4 2 1.4 4.6 0 8.5-1.4-3.9-1.4-6.5 0-8.5Z" />
</>);

// ──────────────────────────────────────────────── LAVANDERIA E LIMPEZA ──
const Maquina = svg(<>
  <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
  <circle cx="12" cy="14" r="4.6" />
  <path d="M7.5 6.2h.01M11 6.2h.01" />
</>);
const Aspirador = svg(<>
  <rect x="11.5" y="10" width="10.5" height="8" rx="3.5" />
  <path d="M15 18v2.5M19 18v2.5" />
  <path d="M11.5 12.8C8.2 12.8 8.6 6.5 5 6.5" />
  <path d="M5 6.5v11" />
  <path d="M2 18h6v3.2H2Z" />
</>);
const Ferro = svg(<>
  <path d="M2 16.8c0-3.8 3-6.8 6.8-6.8H21.5v2.8a4 4 0 0 1-4 4Z" />
  <path d="M9 10V8.6A3.6 3.6 0 0 1 12.6 5h5.2a3.7 3.7 0 0 1 3.7 3.7V10" />
  <path d="M4 20h16" />
</>);

// ────────────────────────────────────────────────────────────────── HIGIENE ──
const Secador = svg(<>
  <path d="M2 8.2h6.2v3.6H2Z" />
  <rect x="8.2" y="5" width="13.3" height="10" rx="5" />
  <path d="M11.5 15v3.6a2.6 2.6 0 0 0 2.6 2.6h1.6" />
  <path d="M14.5 8.5v3" />
</>);
const Chapinha = svg(<>
  <path d="M4 9 17.5 4.5M4 13 17.5 8.5" />
  <path d="M17.5 4.5c2 0 3.5 1 3.5 2.2s-1.5 2.2-3.5 2.2" />
  <path d="M4 9c-1 .3-1.6 1-1.6 2S3 12.7 4 13" />
  <path d="M7 16.5v3" />
</>);
const Barbeador = svg(<>
  <circle cx="9.2" cy="5.2" r="2.2" /><circle cx="14.8" cy="5.2" r="2.2" />
  <circle cx="12" cy="9" r="2.2" />
  <path d="M8 11.8h8v7.4a2.6 2.6 0 0 1-2.6 2.6h-2.8A2.6 2.6 0 0 1 8 19.2Z" />
</>);

// ────────────────────────────────────────────────────────── ÁGUA E BOMBAS ──
const Bomba = svg(<>
  <circle cx="11.5" cy="13.5" r="5.5" />
  <circle cx="11.5" cy="13.5" r="1.5" />
  <path d="M11.5 8V4h5" />
  <path d="M17 13.5h4.5" />
  <path d="M6.5 20.5h10" />
</>);
const Piscina = svg(<>
  <path d="M8 3.5v10M12.5 3.5v10M8 7h4.5M8 10.5h4.5" />
  <path d="M2 16.5c2 0 2 1.6 4 1.6s2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6" />
  <path d="M2 20.5c2 0 2 1.6 4 1.6s2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6" />
</>);
const Gota = svg(<>
  <path d="M12 2.7c3.6 4 6 6.9 6 9.9a6 6 0 0 1-12 0c0-3 2.4-5.9 6-9.9Z" />
  <path d="M9.5 13.5a2.6 2.6 0 0 0 2.5 2.6" />
</>);

// ──────────────────────────────────────────── SEGURANÇA E ÁREA EXTERNA ──
const Camera = svg(<>
  <path d="M2.5 7.5 16.5 3l1.6 5.2L4 12.7Z" />
  <path d="M6.5 12.5v3a2.5 2.5 0 0 0 2.5 2.5h1.5" />
  <path d="M18.6 6 22 5" />
  <path d="M8.5 18h4" />
</>);
const Alarme = svg(<>
  <path d="M18.5 15.5v-5a6.5 6.5 0 0 0-13 0v5L3.5 19h17Z" />
  <path d="M10 21.5h4" />
  <path d="M12 4V2" />
</>);
const Interfone = svg(<>
  <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
  <rect x="8.5" y="5.5" width="7" height="6" rx="1.5" />
  <circle cx="12" cy="16.5" r="1.6" />
</>);
const Portao = svg(<>
  <path d="M3 7h18v12.5H3Z" />
  <path d="M7.5 7v12.5M12 7v12.5M16.5 7v12.5" />
  <path d="M2 21.5h20" />
  <path d="M3 11.5h18" />
</>);
const Cerca = svg(<>
  <path d="M5 6v15M19 6v15" />
  <path d="M5 10h14M5 14h14M5 18h14" />
  <path d="M13 2 10.5 6.5h3L11 10.5" />
</>);
const Escudo = svg(<>
  <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.6 7.5 10 4.4-1.4 7.5-5.4 7.5-10v-6Z" />
  <path d="M9 12l2.2 2.2L15.5 10" />
</>);

// ──────────────────────────────────────────────────── TRABALHO / OFICINA ──
const Compressor = svg(<>
  <rect x="2" y="10" width="16" height="7.5" rx="3.7" />
  <path d="M6 10V7a2.5 2.5 0 0 1 2.5-2.5h2.5A2.5 2.5 0 0 1 13.5 7v3" />
  <path d="M5 17.5v3.5M15 17.5v3.5" />
  <path d="M18 13.5h4" />
</>);
const Solda = svg(<>
  <rect x="2" y="7.5" width="12" height="10" rx="2.5" />
  <path d="M5 11h.01M8 11h.01" />
  <path d="M14 12.5h2.6l2.6 5.2" />
  <path d="M19 3 16.5 7.5h3L17.5 12" />
</>);
const Betoneira = svg(<>
  <path d="M4.5 5.5c0-1.5 2.8-2.7 6.2-2.7s6.3 1.2 6.3 2.7v4.8c0 1.5-2.9 2.7-6.3 2.7s-6.2-1.2-6.2-2.7Z" />
  <path d="M4.5 5.5c0 1.5 2.8 2.7 6.2 2.7s6.3-1.2 6.3-2.7" />
  <path d="M10.7 13.5v3.2" />
  <path d="M6 20.5h9.5l-1.8-3.8H7.8Z" />
  <circle cx="19" cy="18.8" r="2.2" />
</>);

// ─────────────────────────────────────────── SÍTIO E PRODUÇÃO RURAL ──
// Duas tentativas de desenhar uma VACA saíram gato e macaco: cabeça redonda com
// duas orelhas lê como bicho de estimação em qualquer tamanho pequeno. A leiteira
// não tem esse problema — a silhueta (corpo cônico, gargalo, duas alças) não
// parece nenhuma outra coisa, e diz "produção rural" na mesma hora.
const Leiteira = svg(<>
  <path d="M9.8 2.5h4.4v2.6l2.3 3a3.4 3.4 0 0 1 .7 2.1v8.3a3 3 0 0 1-3 3h-4.4a3 3 0 0 1-3-3v-8.3a3.4 3.4 0 0 1 .7-2.1l2.3-3Z" />
  <path d="M7.2 12.6h9.6" />
  <path d="M7.1 9.6H5.6a1.7 1.7 0 0 0 0 3.4M16.9 9.6h1.5a1.7 1.7 0 0 1 0 3.4" />
  <path d="M9.8 5.1h4.4" />
</>);
const Forrageira = svg(<>
  <path d="M2.5 4h14.5l-5.5 7.5v6.5l-3.5 2v-8.5Z" />
  <path d="M18 13.5h.01M21 11.5h.01M19.5 17.5h.01M22 15.5h.01M16.5 19.5h.01" />
</>);
const Aerador = svg(<>
  <circle cx="8" cy="8" r="1.6" /><circle cx="13.5" cy="4.5" r="1.1" /><circle cx="16.5" cy="9" r="1.3" />
  <path d="M2 14c2 0 2 1.6 4 1.6s2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6" />
  <path d="M2 19c2 0 2 1.6 4 1.6s2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6" />
</>);
const Chocadeira = svg(<>
  <rect x="3" y="6" width="18" height="15" rx="2.5" />
  <path d="M12 18c-2 0-3.5-1.5-3.5-3.5S10.2 9 12 9s3.5 3.5 3.5 5.5S14 18 12 18Z" />
  <path d="M6 3.5v2M12 3v2.5M18 3.5v2" />
</>);
const Resfriador = svg(<>
  <rect x="2" y="8" width="20" height="9" rx="4.5" />
  <path d="M8.5 8V5h5v3" />
  <path d="M6 17v3.5M18 17v3.5" />
  <path d="M15 12.5h3.5" />
</>);
const Planta = svg(<>
  <path d="M12 21.5v-8" />
  <path d="M12 14c-4.5 0-7-2.5-7-7 4.5 0 7 2.5 7 7Z" />
  <path d="M12.6 12.5c0-3.6 2-5.8 5.6-5.8 0 3.6-2 5.8-5.6 5.8Z" />
  <path d="M7.5 21.5h9" />
</>);

// ────────────────────────────────────────────────────── PADRÃO / RESERVA ──

// ─────────────────────────────────────────────────────────────────────────────
// MAPA
// ─────────────────────────────────────────────────────────────────────────────

/** Ícone de cada GRUPO — é o que aparece no cabeçalho e o que segura o item novo. */
export const ICONE_GRUPO: Record<GrupoCarga, IconeDesenho> = {
  luz: Lampada,
  cozinha: Panela,
  sala: Tv,
  conforto: ArCondicionado,
  lavanderia: Maquina,
  higiene: Secador,
  agua: Gota,
  seguranca: Escudo,
  trabalho: Furadeira,
  campo: Planta,
};

/**
 * Ícone por aparelho. Um desenho serve vários itens quando a silhueta é a
 * mesma — geladeira, frigobar, freezer vertical e adega são a mesma caixa.
 * O que NÃO estiver aqui cai no ícone do grupo (ver `iconeDaCarga`).
 */
export const ICONE_CARGA: Record<string, IconeDesenho> = {
  // luz
  led: Lampada, ledpainel: Plafon, fita: Plafon, refletor: Refletor, poste: Poste,
  // cozinha
  geladeira: Geladeira, geladeira2: Geladeira, frigobar: Geladeira,
  freezerv: Geladeira, adega: Geladeira, freezer: Freezer,
  microondas: Microondas, torradeira: Microondas,
  airfryer: AirFryer, panelaarroz: AirFryer,
  inducao: Cooktop, cafeteira: Cafeteira, liquid: Liquidificador,
  lavalouca: Maquina, coifa: Coifa, bebedouro: Bebedouro,
  // sala
  tv43: Tv, tv: Tv, tv65: Tv, receptor: Tv,
  som: Som, videogame: Videogame, wifi: Roteador, starlink: Antena,
  celular: Celular, notebook: Notebook, desktop: Desktop, impressora: Impressora,
  // conforto
  ventilador: Ventilador, circulador: Ventilador, ventteto: VentTeto,
  split9: ArCondicionado, split12: ArCondicionado,
  split18: ArCondicionado, split24: ArCondicionado,
  // lavanderia
  maquina: Maquina, tanquinho: Maquina, aspirador: Aspirador,
  ferro: Ferro, vaporizador: Ferro,
  // higiene
  secador: Secador, chapinha: Chapinha, barbeador: Barbeador,
  // água
  bombapoco: Bomba, bomba1cv: Bomba, bomba2cv: Bomba,
  pressurizad: Bomba, boilerbomba: Bomba, piscina: Piscina,
  // segurança
  cameras: Camera, alarme: Alarme, interfone: Interfone,
  portao: Portao, cerca: Cerca,
  // trabalho
  freezer2: Freezer, furadeira: Furadeira, compressor: Compressor,
  solda: Solda, betoneira: Betoneira,
  // campo
  ordenha: Leiteira, resfriador: Resfriador, irrigacao: Bomba,
  forrageira: Forrageira, aerador: Aerador, chocadeira: Chocadeira,
};

/**
 * O desenho de um aparelho. Nunca devolve nada: aparelho sem mapa usa o ícone
 * do grupo, e grupo desconhecido usa a tomada. Item novo no catálogo já nasce
 * com cara de alguma coisa.
 */
export function iconeDaCarga(id: string, grupo: GrupoCarga): IconeDesenho {
  return ICONE_CARGA[id] ?? ICONE_GRUPO[grupo] ?? Tomada;
}

/** Perfis prontos — os quatro usavam o MESMO ícone de casinha e ficavam iguais. */
export const ICONE_PERFIL: Record<string, IconeDesenho> = {
  basico: Lampada,
  completa: ArCondicionado,
  sitio: Bomba,
  produtor: Leiteira,
};

export { Lampada, Gota, Escudo, Planta, Tomada, Leiteira, Bomba, ArCondicionado, Panela };
