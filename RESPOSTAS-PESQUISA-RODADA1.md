# Respostas da 1ª rodada da pesquisa — pra mandar antes da 2ª

Sete pessoas responderam, cinco pediram coisa concreta e ninguém recebeu retorno.
A 2ª rodada sai amanhã às 9h. Mandar estas antes.

**Cada pedido foi conferido no código antes de escrever.** O que está aqui como
"você tem razão" foi verificado; o que não dá pra prometer está escrito como não
dá pra prometer.

---

## 1. GSI Energia Solar — (38) 99956-9898

*Pediu: quantidade de baterias não sai na proposta em PDF; geração estimada no contrato.*

> Fui atrás dos dois pontos que você apontou.
>
> A quantidade de baterias não é problema do PDF: o campo não existe. Módulo e
> inversor têm quantidade, a bateria só tem marca, capacidade, potência e ciclos.
> Você achou um buraco de verdade — vou abrir o campo, e aí ele sai na proposta e
> no contrato.
>
> A geração estimada no contrato eu também confirmei que não está lá. Faz todo
> sentido, é justamente o número que o cliente cobra depois. Entra junto.
>
> Obrigado por ter sido específico. Com o que você escreveu eu fui direto no
> ponto do código.

**Conferido:** `parseBateria` lê `bateria_marca`, `bateria_capacidade_kwh`,
`bateria_potencia_kw`, `bateria_ciclos` e `bateria_garantia_anos`. **Não existe
`bateria_quantidade` em lugar nenhum.** E "geração estimada" não aparece em
nenhum contrato.

---

## 2. Lucas Paulino — RSC Solar — (43) 99934-5490

*Pediu: tarifa do kWh por região; campo de observação no contrato pra detalhe de pagamento.*

> Ouvi seu áudio inteiro. Duas coisas.
>
> O campo de observação no contrato, pra escrever quanto é à vista e quanto no
> cartão: fui conferir e ele existe só na vistoria, não no contrato. Você está
> certo, vou levar pro contrato.
>
> A tarifa do kWh por região, pra você não ter que calcular na mão quanto o
> cliente vai pagar depois da usina: esse é maior e não vou prometer data. Mas
> foi o pedido mais inteligente que eu recebi na pesquisa, porque é a conta que
> todo mundo faz por fora e ninguém confere.
>
> E o que você falou de responder de qualquer lugar pelo celular virou o
> depoimento que está na nossa página agora.

**Conferido:** o campo `observacoes` está em `vistoriaM1`, item 6. Nenhum contrato
tem campo livre.

---

## 3. Vanderlei — American Energy Solar — (66) 99998-4955

*Pediu: logo maior na proposta com gráfico; não consegue baixar do celular proposta já gerada; monitoramento barato pra poucas usinas.*

> Três pedidos seus, três respostas.
>
> A logo maior na proposta completa: é justo e é fácil. Vou aumentar.
>
> Não conseguir baixar pelo celular uma proposta que já foi gerada: isso não é
> falta de recurso, é falha. Vou olhar essa semana.
>
> Monitoramento com preço acessível pra quem tem poucas usinas: hoje não temos, e
> eu não vou te prometer data pra uma coisa dessas. Mas ficou anotado com o seu
> nome, porque você foi o primeiro a pedir.
>
> E obrigado pela parte que você não precisava falar — que usou três anos outra
> plataforma antes. É o que dá peso no resto.

---

## 4. Melque — MT Energia Solar — (88) 99980-9326

*Pediu: preço individual de placa, inversor e estrutura; kanban de projetos com anexo.*

> Seus dois pedidos foram os que mais se repetiram na pesquisa.
>
> Preço individual de placa, inversor e estrutura: outra pessoa pediu igual. É o
> próximo da fila.
>
> Kanban de projetos com anexo por etapa: esse é grande. Não vou cravar data, mas
> está no plano, não na gaveta.
>
> Vou te avisar quando o primeiro sair.

---

## 5. Juliano Grilo — Grilo Energia Solar — (19) 99626-4359

*Perguntou se tem mais barato que R$ 67; quer poder alterar contrato e procuração; contestou a contagem de documentos.*

> Três coisas do seu áudio.
>
> Você perguntou se tem mais barato que 67. Tem: no plano anual sai **R$ 47 por
> mês**. Se fizer sentido pra você, eu te passo o link.
>
> Alterar o contrato e a procuração: dá, os dois são editáveis antes de gerar.
> Qualquer dúvida na hora de mexer, me chama que eu mostro.
>
> E sobre os 34 documentos: **você estava certo e eu estava errado.** Eu contava
> documento, e refazer a mesma proposta grava linha nova — eram 30 propostas para
> 13 clientes. Já consertei a conta, ninguém mais vai receber esse número
> estranho.

**Atenção:** ele disse *"vou parar"* com a outra plataforma e *"vou fechar com
vocês agora"*. O anual a R$ 47 responde exatamente o que ele pediu — **essa é a
mensagem com venda dentro.**

---

## 6. Ronailson Klesley — Alves Cardoso Solar — (63) 98440-4428

*Respondeu "praticidade e agilidade" e "nada a falar".*

> Valeu pela resposta.
>
> Uma coisa que você falou ficou na minha cabeça: que antes era só venda formal,
> sem nenhum documento apresentando dados reais. É exatamente pra isso que a
> ferramenta existe, e você resumiu melhor do que eu.
>
> Se um dia faltar alguma coisa aí dentro, me chama direto.

---

## 7. Alessandro Goulart — Força Solar — (51) 99994-4150

*Só elogio — vinha de planilha, montava proposta simplificada pra lead frio.*

> Valeu pelo áudio, Alessandro.
>
> Aquilo que você contou de usar a proposta simplificada pro cliente que ainda é
> curioso e a completa pra quem tem interesse de verdade — é exatamente pra isso
> que ela existe, e pouca gente usa desse jeito.
>
> Qualquer coisa que travar, me chama.

---

## O que virou tarefa

| # | O quê | Tamanho | Quem pediu |
|---|---|---|---|
| 1 | Campo **quantidade de baterias** (proposta + contrato) | pequeno, confirmado que não existe | GSI |
| 2 | **Observação livre no contrato** (detalhe de pagamento) | pequeno, o campo já existe na vistoria | Lucas |
| 3 | **Logo maior** na proposta completa | pequeno | Vanderlei |
| 4 | **Geração estimada** no contrato | pequeno | GSI |
| 5 | Baixar do **celular** proposta já gerada | é falha, precisa reproduzir | Vanderlei |
| 6 | **Preço individual** de placa/inversor/estrutura | médio | Melque, Lucas |
| 7 | **Tarifa por região** e conta do "depois" | médio/grande | Lucas |
| 8 | **Kanban** de projetos com anexo | grande | Melque |
| 9 | **Monitoramento** barato pra poucas usinas | grande, sem promessa | Vanderlei |

Os quatro primeiros somam pouca coisa e fecham três dos cinco clientes que
pediram. Se der pra fazer só isso antes de amanhã, já muda a conversa.
