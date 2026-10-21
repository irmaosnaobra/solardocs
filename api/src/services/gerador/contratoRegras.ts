/**
 * Regras de escrita e de conteúdo dos contratos do /gerador.
 *
 * Fonte única das regras: o especialista de contratos
 * (.claude/agents/especialista-contratos.md) escreve os modelos por elas.
 * A IA de contrato do gerador também as lê: contratoIa.ts (`redesenhar`) e
 * contratoAgente.ts (o agente) importam este texto e o põem no prompt de sistema.
 * Mudar uma regra aqui muda o especialista e a IA do gerador juntos. O prompt do
 * agente é um bloco com cache_control: mudar o texto invalida o cache uma vez.
 */
export const REGRAS_CONTRATO = `REGRAS DOS CONTRATOS DO GERADOR

LINGUAGEM
1. Frase curta, uma ideia por frase, palavra do dia a dia. Não use: "neste ato", "outrossim", "têm entre si justo e contratado", "obriga-se a", "doravante", "supramencionado", "mediante", "consoante", "no que tange", "resolver-se-á". Prefira o verbo direto: "faz", "paga", "entrega", "encerra".
2. As partes aparecem pelo papel, em maiúsculas (SÓCIA OSTENSIVA, SÓCIO PARTICIPANTE, CONTRATANTE, CONTRATADA, CEDENTE, CESSIONÁRIO). Nome próprio só no topo e nas assinaturas.
3. Cada item diz quem faz o quê, quando e quanto. Número sempre com o extenso: "30 (trinta) dias", "R$ 2.000,00 (dois mil reais)".
4. Não repita o que outra cláusula já diz: cite a cláusula.
5. Sem travessão. Use ponto, vírgula ou dois-pontos. Toda frase começa com maiúscula.

TAMANHO
6. Cláusula com até 8 itens, item com até 3 frases. Teto por contrato, na letra padrão do gerador: termos 2 páginas, compra e venda de equipamento 3, solar 4, obra e arrendamento 5, sociedade 7. Para caber, corte repetição e juridiquês, nunca proteção.

CONTEÚDO
7. Justo para os dois lados. Multa, prazo ou consequência que vale para o cliente numa situação (atraso, descumprimento, desistência) tem a contrapartida para a empresa na mesma situação.
8. Cite lei só quando ela produz efeito: sociedade em conta de participação (arts. 991 a 996 do Código Civil), solidariedade de quem trata com terceiros (art. 993), patrimônio especial (art. 994, § 1º), falência da sócia ostensiva (art. 994, § 2º), liquidação (art. 996), outras estações da sócia ostensiva (art. 1.006), sinal (arts. 417 a 420), assinatura eletrônica (MP 2.200-2/2001, art. 10, § 2º), dados pessoais (Lei 13.709/2018).
9. Nenhuma promessa de rentabilidade, retorno, renda mensal ou geração de energia. Estudo e simulação são projeção, não garantia.
10. Nunca escreva "não incluído" nem lista do que fica de fora. Escreva em positivo: "o preço cobre o que está listado; obra que a distribuidora exigir é orçada à parte". O que é tarefa do cliente vira obrigação escrita dele.
11. Não existe cláusula opcional. O que depende do caso entra pelos dados do contrato: cliente pessoa física ou empresa, dono do imóvel diferente do cliente, fiador, dossiê do local.
12. Cliente pessoa física é consumidor: cláusula que limita direito dele vai em negrito (CDC, art. 54, § 4º); não entra limite de responsabilidade nem renúncia de direito (CDC, art. 51); multa por atraso de pagamento até 2% (CDC, art. 52, § 1º); o foro é o da cidade dele.
13. Sinal é parte do preço e vale como arras penitenciais (art. 420 do Código Civil): quem desistir antes de cumprir perde o sinal; se quem desistir for a empresa, devolve o sinal em dobro. Não há indenização além disso.
14. Valor e percentual vêm só dos campos do gerador. O texto nunca inventa número. O pagamento sai da tabela de pagamento, que tem que somar o valor devido.
15. Assinatura eletrônica é sempre aceita. Assinado por plataforma de assinatura, o contrato dispensa testemunhas para ser cobrado direto (CPC, art. 784, § 4º).`;
