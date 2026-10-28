/**
 * Chave do cliente: compara nomes sem ligar para acento, maiúscula nem espaço
 * repetido. É a mesma regra do servidor (api/src/utils/chaveCliente.ts): a pasta do
 * cliente no /historico abre pelo id do cliente e por esta chave do nome.
 */
export function chaveCliente(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Endereço da pasta de um cliente no /historico. */
export function linkPastaCliente(id: string | null, nome: string): string {
  const p = new URLSearchParams();
  if (id) p.set('cliente_id', id);
  p.set('cliente_chave', chaveCliente(nome));
  p.set('nome', nome);
  p.set('vista', 'pasta');
  return `/historico?${p.toString()}`;
}
