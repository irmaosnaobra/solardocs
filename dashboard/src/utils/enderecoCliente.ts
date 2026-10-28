// Endereço completo do cliente na proposta solar (opcional). O formulário guarda as
// partes (cep, logradouro, numero, complemento, bairro) e o texto composto em
// `endereco`, que é o que os modelos imprimem.

export type EnderecoPartes = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  endereco: string;
};

const aparar = (s: unknown) => String(s ?? '').trim();

/** 38400100 -> "38400-100" (aceita o que a pessoa digitou). */
export function maskCep(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Há alguma parte (CEP, rua, número, complemento, bairro) preenchida? */
export function temPartesDoEndereco(e: Partial<EnderecoPartes>): boolean {
  return [e.cep, e.logradouro, e.numero, e.complemento, e.bairro].some(p => aparar(p) !== '');
}

/**
 * Texto antigo (cadastro, leitura da conta de luz, documento antigo): só `endereco`,
 * sem nenhuma parte de rua. O CEP não conta, porque a leitura da conta traz os dois.
 * Nesse caso o texto fica como está e aparece no campo Rua, sem recompor.
 */
export function enderecoLegado(e: Partial<EnderecoPartes>): boolean {
  return aparar(e.endereco) !== ''
    && [e.logradouro, e.numero, e.complemento, e.bairro].every(p => aparar(p) === '');
}

/**
 * "Rua, Número, Complemento, Bairro, Cidade - UF, CEP 00000-000". Pula as partes
 * vazias, sem vírgula sobrando. Sem nenhuma parte preenchida devolve '' (só a cidade
 * não vira endereço). Texto legado intacto volta como está.
 */
export function comporEndereco(e: Partial<EnderecoPartes>, cidade: string, uf: string): string {
  if (enderecoLegado(e)) return aparar(e.endereco);
  if (!temPartesDoEndereco(e)) return '';
  const cidadeUf = [aparar(cidade), aparar(uf)].filter(Boolean).join(' - ');
  const cep = maskCep(aparar(e.cep));
  return [
    aparar(e.logradouro), aparar(e.numero), aparar(e.complemento), aparar(e.bairro),
    cidadeUf, cep ? `CEP ${cep}` : '',
  ].filter(Boolean).join(', ');
}
