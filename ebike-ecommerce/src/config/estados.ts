/**
 * Os 27 estados com a coordenada da capital.
 *
 * Serve para quem não quer digitar CEP: um toque no estado já é o bastante
 * para a loja saber de qual galpão as bikes saem mais perto dessa pessoa.
 *
 * A coordenada é da CAPITAL, então é aproximação — e a loja diz isso na tela,
 * com "≈" na distância e sem preço de frete. Preço fechado exige CEP, porque
 * frete de Presidente Prudente não é frete da capital de São Paulo.
 *
 * Tabela fixa de propósito: são 27 linhas que não mudam, e ir buscar isso em
 * serviço de terceiro seria trocar certeza por dependência.
 */
export type Estado = { uf: string; nome: string; capital: string; lat: number; lon: number };

export const ESTADOS: Estado[] = [
  { uf: 'AC', nome: 'Acre', capital: 'Rio Branco', lat: -9.9747, lon: -67.81 },
  { uf: 'AL', nome: 'Alagoas', capital: 'Maceió', lat: -9.6658, lon: -35.7353 },
  { uf: 'AP', nome: 'Amapá', capital: 'Macapá', lat: 0.0349, lon: -51.0694 },
  { uf: 'AM', nome: 'Amazonas', capital: 'Manaus', lat: -3.119, lon: -60.0217 },
  { uf: 'BA', nome: 'Bahia', capital: 'Salvador', lat: -12.9777, lon: -38.5016 },
  { uf: 'CE', nome: 'Ceará', capital: 'Fortaleza', lat: -3.7319, lon: -38.5267 },
  { uf: 'DF', nome: 'Distrito Federal', capital: 'Brasília', lat: -15.7939, lon: -47.8828 },
  { uf: 'ES', nome: 'Espírito Santo', capital: 'Vitória', lat: -20.3155, lon: -40.3128 },
  { uf: 'GO', nome: 'Goiás', capital: 'Goiânia', lat: -16.6869, lon: -49.2648 },
  { uf: 'MA', nome: 'Maranhão', capital: 'São Luís', lat: -2.5297, lon: -44.3028 },
  { uf: 'MT', nome: 'Mato Grosso', capital: 'Cuiabá', lat: -15.6014, lon: -56.0979 },
  { uf: 'MS', nome: 'Mato Grosso do Sul', capital: 'Campo Grande', lat: -20.4697, lon: -54.6201 },
  { uf: 'MG', nome: 'Minas Gerais', capital: 'Belo Horizonte', lat: -19.9167, lon: -43.9345 },
  { uf: 'PA', nome: 'Pará', capital: 'Belém', lat: -1.4558, lon: -48.4902 },
  { uf: 'PB', nome: 'Paraíba', capital: 'João Pessoa', lat: -7.1195, lon: -34.845 },
  { uf: 'PR', nome: 'Paraná', capital: 'Curitiba', lat: -25.4284, lon: -49.2733 },
  { uf: 'PE', nome: 'Pernambuco', capital: 'Recife', lat: -8.0476, lon: -34.877 },
  { uf: 'PI', nome: 'Piauí', capital: 'Teresina', lat: -5.0892, lon: -42.8019 },
  { uf: 'RJ', nome: 'Rio de Janeiro', capital: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { uf: 'RN', nome: 'Rio Grande do Norte', capital: 'Natal', lat: -5.7945, lon: -35.211 },
  { uf: 'RS', nome: 'Rio Grande do Sul', capital: 'Porto Alegre', lat: -30.0346, lon: -51.2177 },
  { uf: 'RO', nome: 'Rondônia', capital: 'Porto Velho', lat: -8.7619, lon: -63.9039 },
  { uf: 'RR', nome: 'Roraima', capital: 'Boa Vista', lat: 2.8235, lon: -60.6758 },
  { uf: 'SC', nome: 'Santa Catarina', capital: 'Florianópolis', lat: -27.5954, lon: -48.548 },
  { uf: 'SE', nome: 'Sergipe', capital: 'Aracaju', lat: -10.9472, lon: -37.0731 },
  { uf: 'SP', nome: 'São Paulo', capital: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { uf: 'TO', nome: 'Tocantins', capital: 'Palmas', lat: -10.1689, lon: -48.3317 },
];
