/**
 * Onde a loja mora dentro do domínio.
 *
 * Fica num arquivo .mjs sozinho porque DOIS lugares precisam do mesmo valor: o
 * next.config (que define o basePath) e o endereço das fotos (que precisa do
 * prefixo escrito na mão, veja src/lib/fotos.ts). Se os dois discordarem, as
 * imagens voltam a dar 404 e nada mais quebra, que é o pior tipo de defeito.
 */
export const BASE_PATH = '/bike';
