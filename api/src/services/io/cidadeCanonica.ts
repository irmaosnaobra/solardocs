// ─────────────────────────────────────────────────────────────────────────────
// CIDADE EM TEXTO LIVRE → "Município-UF" (nome oficial do IBGE).
//
// O lead digita a cidade do jeito que quer, e os filtros do /gerador ficavam com
// 630 grafias para ~400 cidades ("Uberlândia", "UberlÂndia", "Uberlandia-MG",
// "Uberlândia mg"...). O formato único é o que /io/solar já grava dentro do raio
// e que `acharCidadeRaio` resolve: "Uberlândia-MG".
//
// REGRA QUE MANDA: nunca inventar. Só troca o texto quando o município foi
// achado com segurança: UF digitada junto do nome, capital de estado, ou o DDD do
// telefone confirmando a UF (nome único no país OU nome repetido desempatado).
// Nome único no país SEM UF e sem DDD que bata NÃO basta: "Taguatinga" é do DF e
// existe uma no TO, "Guará" é do DF e existe uma em SP, bairro ("Moema") vira
// cidade de outro estado. Qualquer dúvida devolve o texto original, só limpo de
// espaços sobrando. Quem precisa do texto cru antes da gravação
// (ex.: `dentroDaArea`) continua lendo o cru: isto aqui só decide o valor que
// vai para a coluna `cidade`.
// ─────────────────────────────────────────────────────────────────────────────
import { resolverCidade } from './geoCidade';
import { normalizarCidade, chaveMunicipio, semAcento, ehNomeDeEstado } from './cidadeParse';
import municipios from '../../data/municipios.json';

export type StatusCidadeCanonica = 'ok' | 'ddd' | 'mantida' | 'vazia';

export interface CidadeCanonica {
  valor: string;
  status: StatusCidadeCanonica;
}

/** DDD → UFs que ele atende. 61 é de Brasília e do entorno goiano. */
const UF_DO_DDD: Record<string, string[]> = {};
function ddds(uf: string, lista: number[]): void {
  for (const d of lista) {
    const k = String(d);
    (UF_DO_DDD[k] ||= []).push(uf);
  }
}
ddds('SP', [11, 12, 13, 14, 15, 16, 17, 18, 19]);
ddds('RJ', [21, 22, 24]);
ddds('ES', [27, 28]);
ddds('MG', [31, 32, 33, 34, 35, 37, 38]);
ddds('PR', [41, 42, 43, 44, 45, 46]);
ddds('SC', [47, 48, 49]);
ddds('RS', [51, 53, 54, 55]);
ddds('DF', [61]);
ddds('GO', [61, 62, 64]);
ddds('TO', [63]);
ddds('MT', [65, 66]);
ddds('MS', [67]);
ddds('AC', [68]);
ddds('RO', [69]);
ddds('BA', [71, 73, 74, 75, 77]);
ddds('SE', [79]);
ddds('PE', [81, 87]);
ddds('AL', [82]);
ddds('PB', [83]);
ddds('RN', [84]);
ddds('CE', [85, 88]);
ddds('PI', [86, 89]);
ddds('PA', [91, 93, 94]);
ddds('AM', [92, 97]);
ddds('RR', [95]);
ddds('AP', [96]);
ddds('MA', [98, 99]);

/**
 * DDD (2 dígitos) do telefone, ou '' quando não dá para confiar.
 * 12-13 dígitos com 55 na frente: DDD nos dígitos 3-4. 10-11: os 2 primeiros.
 * "5555319981650" (13 dígitos, 5555 e depois um 3) é telefone quebrado que já
 * apareceu na base: o 55 do país foi colado ao DDD 55 de uma linha que já tinha
 * o código. O celular do RS de verdade teria o 9 na quinta posição.
 */
export function dddDoTelefone(telefone: unknown): string {
  const d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) {
    if (d.length === 13 && d.startsWith('5555') && d[4] !== '9') return '';
    return d.slice(2, 4);
  }
  if (d.length === 10 || d.length === 11) return d.slice(0, 2);
  return '';
}

/** "Santa Luzia-MG" → "MG". Usa o ÚLTIMO hífen: "Ji-Paraná-RO" tem dois. */
function ufDoCandidato(c: string): string {
  const i = c.lastIndexOf('-');
  return i > 0 ? c.slice(i + 1) : '';
}

/**
 * Nomes que são o FIM do nome de outro município ("Conquista" está em "Vitória
 * da Conquista", "Camboriú" em "Balneário Camboriú"). Digitado sem UF, quase
 * sempre é a forma abreviada do maior, e o nome único do país seria um chute
 * com cara de certeza. 307 nomes caem aqui; com o DDD batendo a gente aceita.
 */
const FIM_DE_OUTRO_NOME: Map<string, Set<string>> = (() => {
  const mapa = new Map<string, Set<string>>();
  for (const m of municipios as Array<{ n: string; uf: string }>) {
    const palavras = semAcento(m.n).split(/\s+/);
    for (let i = 1; i < palavras.length; i++) {
      const k = chaveMunicipio(palavras.slice(i).join(' '));
      const ufs = mapa.get(k);
      if (ufs) ufs.add(m.uf); else mapa.set(k, new Set([m.uf]));
    }
  }
  return mapa;
})();

/** Capitais: "João Pessoa" existe também em "Coronel João Pessoa", mas ninguém que digita isso quer o RN. */
const CAPITAIS = new Set([
  'Rio Branco-AC', 'Maceió-AL', 'Macapá-AP', 'Manaus-AM', 'Salvador-BA', 'Fortaleza-CE', 'Brasília-DF',
  'Vitória-ES', 'Goiânia-GO', 'São Luís-MA', 'Cuiabá-MT', 'Campo Grande-MS', 'Belo Horizonte-MG',
  'Belém-PA', 'João Pessoa-PB', 'Curitiba-PR', 'Recife-PE', 'Teresina-PI', 'Rio de Janeiro-RJ',
  'Natal-RN', 'Porto Alegre-RS', 'Porto Velho-RO', 'Boa Vista-RR', 'Florianópolis-SC', 'São Paulo-SP',
  'Aracaju-SE', 'Palmas-TO',
]);

const juntarEspacos = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * A regra ANTIGA (antes de exigir o DDD) aceitaria este texto sem olhar o telefone? Só a prévia
 * do script de limpeza usa, para contar o que a regra nova passou a manter. Texto que a guarda do
 * nome curto ("Conquista") já segurava antes dá false: esse já era "ambígua".
 */
export function aceitariaSemDdd(texto: unknown): boolean {
  const original = juntarEspacos(texto);
  if (!original || normalizarCidade(original).duasCidades) return false;
  const r = resolverCidade(original);
  if (r.status !== 'ok' || !r.municipio || !r.uf) return false;
  return normalizarCidade(original).uf !== null || CAPITAIS.has(`${r.municipio}-${r.uf}`) || !FIM_DE_OUTRO_NOME.has(chaveMunicipio(r.municipio));
}

/**
 * Cidade para falar COM o lead: só o município, sem o "-UF" ("Uberlândia-MG" →
 * "Uberlândia"). Texto que não tem UF reconhecível volta só com os espaços limpos.
 */
export function cidadeParaTexto(texto: unknown): string {
  const limpo = juntarEspacos(texto);
  if (!limpo) return '';
  const p = normalizarCidade(limpo);
  return p.cidade && !p.duasCidades ? p.cidade : limpo;
}

/**
 * Regiões administrativas do Distrito Federal (chave sem acento, caixa e pontuação). O IBGE só
 * conhece Brasília-DF, então "Planaltina" ou "Varjão" digitados no DDD 61 resolveriam para o
 * homônimo de Goiás, sendo que Planaltina-DF tem ~190 mil moradores.
 */
const REGIOES_DO_DF = new Set([
  'Plano Piloto', 'Gama', 'Taguatinga', 'Brazlândia', 'Sobradinho', 'Sobradinho II', 'Planaltina', 'Paranoá',
  'Núcleo Bandeirante', 'Ceilândia', 'Guará', 'Cruzeiro', 'Samambaia', 'Santa Maria', 'São Sebastião',
  'Recanto das Emas', 'Lago Sul', 'Riacho Fundo', 'Riacho Fundo II', 'Lago Norte', 'Candangolândia',
  'Águas Claras', 'Sudoeste', 'Octogonal', 'Varjão', 'Park Way', 'Estrutural', 'SCIA', 'Jardim Botânico',
  'Itapoã', 'SIA', 'Vicente Pires', 'Fercal', 'Sol Nascente', 'Pôr do Sol', 'Arniqueira', 'Arapoanga',
  'Água Quente',
].map(chaveMunicipio));

export function cidadeCanonica(texto: unknown, telefone?: unknown): CidadeCanonica {
  const original = juntarEspacos(texto);
  if (!original) return { valor: '', status: 'vazia' };

  // Duas cidades no mesmo campo: escolher uma seria chute.
  if (normalizarCidade(original).duasCidades) return { valor: original, status: 'mantida' };

  // Região do DF, sem UF digitada e com DDD 61: o homônimo de Goiás seria chute. UF digitada vale.
  if (normalizarCidade(original).uf === null && dddDoTelefone(telefone) === '61'
      && REGIOES_DO_DF.has(chaveMunicipio(original))) return { valor: original, status: 'mantida' };

  const r = resolverCidade(original);
  if (r.status === 'ok' && r.municipio && r.uf) {
    const valor = `${r.municipio}-${r.uf}`;
    // "Goiás", "Amapá" sozinhos são nome de ESTADO: o parse os lê como UF digitada, mas quem
    // escreveu só o estado não disse o município. Fica como veio, mesmo com DDD batendo (só as
    // capitais de mesmo nome, "São Paulo" e "Rio de Janeiro", seguem para o CAPITAIS).
    const soEstado = ehNomeDeEstado(original);
    if (soEstado && !CAPITAIS.has(valor)) return { valor: original, status: 'mantida' };
    if (normalizarCidade(original).uf !== null || CAPITAIS.has(valor)) return { valor, status: 'ok' };
    // Sem UF: o DDD do telefone precisa apontar para a UF deste município. Sem telefone, ou com
    // telefone quebrado, não há como confirmar e o texto fica como veio.
    const ufsDoDdd = UF_DO_DDD[dddDoTelefone(telefone)] ?? [];
    if (!ufsDoDdd.includes(r.uf)) return { valor: original, status: 'mantida' };
    // Com cara de abreviação, o DDD também não pode apontar para a UF de um dos maiores
    // ("Camboriú" no DDD 47: Balneário Camboriú também é SC).
    const dosMaiores = FIM_DE_OUTRO_NOME.get(chaveMunicipio(r.municipio));
    if (dosMaiores && [...dosMaiores].some(u => ufsDoDdd.includes(u))) return { valor: original, status: 'mantida' };
    return { valor, status: 'ddd' };
  }

  if (r.status === 'ambigua' && r.candidatos?.length) {
    const ufsDoDdd = UF_DO_DDD[dddDoTelefone(telefone)];
    if (ufsDoDdd) {
      const dentro = r.candidatos.filter(c => ufsDoDdd.includes(ufDoCandidato(c)));
      if (dentro.length === 1) return { valor: dentro[0], status: 'ddd' };
    }
  }

  return { valor: original, status: 'mantida' };
}

/** O valor que vai para a coluna `cidade`: canônico, ou null quando veio vazio. */
export function cidadeParaGravar(texto: unknown, telefone?: unknown): string | null {
  return cidadeCanonica(texto, telefone).valor || null;
}
