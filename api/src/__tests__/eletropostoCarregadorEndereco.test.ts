import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A PORTA DO CARREGADOR TEM QUE ENTREGAR ENDEREÇO LEGÍVEL PELO ESTUDO.
//
// De 24 a 28/09/2026 essa porta trouxe 31 das 64 reuniões da LP, e nenhuma delas
// tinha a linha `Endereço:` — o tick do estudo e o Top 20 pontos filtram por
// `ilike '%Endereço:%'`, então metade da agenda ficava invisível para os dois.
// Este teste lê o JavaScript da PRÓPRIA LP, monta a observação como ela montaria
// e passa pelo `extrairEndereco()` de verdade. Se alguém mudar o formato da linha
// (vírgula, ponto médio, ordem dos campos), o estudo volta a não achar o endereço
// e é aqui que aparece, não em produção.
import { extrairEndereco } from '../services/io/eletropostoEstudoPuro';

const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');
const html = readFileSync(LP, 'utf8');

const fatia = (de: string, ate: string): string => {
  const i = html.indexOf(de);
  const j = html.indexOf(ate, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu da LP: "${de}" … "${ate}"`);
  return html.slice(i, j + ate.length);
};

/** As opções de um <select> da LP, na ordem: [value, texto]. */
function opcoes(id: string): Array<[string, string]> {
  const bloco = fatia(`id="${id}"`, '</select>');
  const out: Array<[string, string]> = [];
  const re = /<option(?:\s+value="([^"]*)")?\s*>([^<]*)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloco))) {
    const texto = m[2].trim();
    if (texto === 'Selecione…') continue;
    out.push([m[1] ?? texto, texto]);
  }
  return out;
}

/** Monta a observação da porta do carregador rodando o código da própria LP. */
function obsDoCarregador(resp: Record<string, string>, comLocal: boolean, projeto: boolean): string {
  // O corte termina na ÚLTIMA linha do array (o marcador PROJETO E ART) e o
  // fechamento é escrito aqui. Dois motivos: `].filter(Boolean)` aparece antes,
  // dentro do próprio `carEnd`, e assim o marcador não precisa carregar a barra
  // invertida do \n — que é o que mais quebra teste que lê código de outro arquivo.
  const corpo = fatia('const carEnd = carregadorComLocal()', "'PROJETO E ART' : '',");
  const NL = String.fromCharCode(10);
  const fn = new Function(
    'val', 'q', 'cidade', 'carregadorComLocal', 'carregadorProjetoCompleto',
    `${corpo}].filter(Boolean).join(String.fromCharCode(10));${NL}return obsCar;`,
  );
  const textoDe = (id: string) => {
    const achou = opcoes(id).find(([v]) => v === resp[id]);
    return achou ? achou[1] : '—';
  };
  return fn(
    (id: string) => resp[id] ?? '',
    textoDe,
    resp.cidade ?? '',
    () => comLocal,
    () => projeto,
  );
}

const RESPOSTAS = {
  'f-car-potencia': '120', 'f-car-qtd': '2_5', 'f-car-uso': 'meu_negocio',
  'f-car-local': 'definido', 'f-car-software': 'sim', 'f-car-instala': 'voces_montam',
  'f-car-prazo': 'agora',
  'f-car-rua': 'Av. João Naves de Ávila', 'f-car-numero': '1200',
  'f-car-bairro': 'Santa Mônica', 'f-car-cep': '38408-100',
  cidade: 'Uberlândia-MG',
};

describe('porta do carregador: o endereço chega ao estudo', () => {
  it('quem tem o local grava a linha Endereço: e o extrairEndereco desmonta ela', () => {
    const obs = obsDoCarregador(RESPOSTAS, true, true);
    expect(obs).toContain('Endereço:');

    const e = extrairEndereco(obs);
    expect(e).not.toBeNull();
    expect(e!.rua).toBe('Av. João Naves de Ávila');
    expect(e!.numero).toBe('1200');
    expect(e!.bairro).toBe('Santa Mônica');
    expect(e!.cidade).toBe('Uberlândia-MG');
    expect(e!.cep).toBe('38408-100');
  });

  it('o tick do estudo e o Top 20 acham a ficha pelo filtro que eles usam', () => {
    // Os dois fazem `ilike '%Endereço:%'` sobre a observação inteira.
    expect(obsDoCarregador(RESPOSTAS, true, true)).toMatch(/Endereço:/);
  });

  it('quem NÃO tem o local não grava endereço nenhum', () => {
    // Endereço de quem não tem ponto é a casa da pessoa, e ela entraria no Top 20
    // ordenada por um local que não existe.
    const obs = obsDoCarregador({ ...RESPOSTAS, 'f-car-local': 'sem_ideia' }, false, false);
    expect(obs).not.toContain('Endereço:');
    expect(extrairEndereco(obs)).toBeNull();
  });

  it('o rótulo do local é o MESMO de f-ponto, que é o que o trigger sabe ler', () => {
    // `eletroposto_estruturar` lê a linha `Ponto:` e chama `ep_slug_ponto`, que casa
    // por prefixo de texto. Rótulo diferente aqui = `tem_ponto` nulo = fora do Top 20.
    expect(opcoes('f-car-local')).toEqual(opcoes('f-ponto'));
  });

  it('a linha Ponto: sai com o texto que ep_slug_ponto reconhece', () => {
    const obs = obsDoCarregador(RESPOSTAS, true, true);
    const linha = obs.split('\n').find(l => l.startsWith('Ponto:'));
    expect(linha).toBe('Ponto: Já tenho o ponto definido');
  });

  it('PROJETO COMPLETO é marcador SOMADO, nunca no lugar de VENDA DE EQUIPAMENTO', () => {
    // `VENDA DE EQUIPAMENTO` é a chave que liga o card desta porta em
    // `montarCardCarregador`. Se algum dia ela virar condicional, quem pede projeto
    // cai no card genérico dos seis traços — o que este teste existe para impedir.
    const completo = obsDoCarregador(RESPOSTAS, true, true);
    expect(completo).toContain('VENDA DE EQUIPAMENTO');
    expect(completo).toContain('PROJETO COMPLETO');

    const soEquipamento = obsDoCarregador(
      { ...RESPOSTAS, 'f-car-instala': 'eu_monto' }, true, false);
    expect(soEquipamento).toContain('VENDA DE EQUIPAMENTO');
    expect(soEquipamento).not.toContain('PROJETO COMPLETO');
  });

  it('"Ainda não sei" não conta como projeto completo', () => {
    // Quem não sabe não pediu projeto. Contá-lo aqui incharia o número que o dono
    // vai medir — é a mesma razão pela qual `nao_sei` ficou fora de CAR_PROJETO.
    const js = fatia('const CAR_PROJETO = new Set(', ']);');
    expect(js).toContain('voces_montam');
    expect(js).toContain('obra_minha_projeto_voces');
    expect(js).not.toContain('nao_sei');
  });
});
