# Cupom de primeiro mês — R$ 19 no site, digitado no checkout

Construído em 08/08/2026. **Migration já aplicada** no Supabase (`cupons`, `cupom_usos`, `registrar_uso_cupom`) e o cupom **ACESSO19 está ativo no banco** — R$ 19 no primeiro mês, plano de R$ 67, sem prazo e sem teto de usos.

## O caminho do cliente

1. Ele entra em **solardoc.app** e clica em assinar.
2. Na tela de pagamento, abre **"Adicionar código promocional"** e digita **ACESSO19**.
3. O primeiro mês sai **R$ 19** em vez de R$ 67. Depois é R$ 67/mês, cancelando quando quiser.
4. Ele mesmo cria a conta com o e-mail da compra. Ninguém libera acesso na mão.

Existe também o atalho **`https://solardoc.app/assinar?cupom=ACESSO19`**: mesma coisa, só que o desconto já vem aplicado e ele não digita nada. Serve pra quem se atrapalha com o código.

## O que a Giovanna faz agora

Ela parou de mandar Pix pra converter. Nos dois fluxos de conversão — **carrinho abandonado** e **acesso pausado (cartão recusado)** — o roteiro virou:

- **Mensagens curtas**: 1 bolha, no máximo 2, cada uma com até 2 linhas.
- **Primeiro toque só abre a conversa** ("foi o cartão que não passou?"), sem link.
- **Assim que o cliente responde qualquer coisa, ela manda o caminho** — link + cupom + passo a passo, mesmo que a IA não peça. Quem engajou não fica esperando ela achar o momento certo.
- Depois disso o link só vai de novo quando ela julgar necessário (mandar o mesmo link toda mensagem é o que faz parecer robô).
- Ela **não pede comprovante e não manda Pix** pra assinatura. Quem recusa recebe uma despedida curta e sai da cadência.

As três bolhas que ela manda:

> Entra aqui: https://solardoc.app
> Clica em assinar e, na tela de pagamento, abre *Adicionar código promocional* e digita: *ACESSO19*
> Aí o primeiro mês sai por R$ 19 em vez de R$ 67. Depois é R$ 67/mês e você cancela quando quiser 🙌

O texto sai da tabela `cupons`: **desligou o cupom no banco, ela para de oferecer na mesma hora** e volta a convidar pro site sem prometer desconto. Ela nunca escreve o código sozinha — o sistema anexa o bloco.

## Se o cliente pedir Pix

O site é o caminho oferecido, mas **quem pede Pix recebe Pix** — sem tentar convencer do contrário. E sai sempre com o mesmo pedido: **comprovante e e-mail**.

- Valor: **R$ 67, um mês do plano completo**. O desconto de primeiro mês vive no cartão (é um desconto da Stripe dentro da assinatura) e a Giovanna fala isso na lata se ele perguntar. **Não usei R$ 19 no Pix de propósito**: esse valor já significa "entrada do curso" aqui dentro, e um Pix de R$ 19 libera o Kit de Fechamento e queima a entrada única do cliente. Se você quiser R$ 19 no Pix também, é uma linha — mas aí precisamos separar os dois casos antes.
- **O e-mail não é burocracia.** A liberação automática só sabia a quem creditar quando o telefone batia com um checkout abandonado (que já tinha e-mail). Quem chegou por anúncio, indicação ou Instagram pagava e ficava no limbo. Agora o e-mail que ele mandar na conversa é guardado e usado pra criar/achar a conta.
- **Comprovante antes do e-mail (a ordem mais comum) funciona:** o comprovante fica guardado, a Giovanna pede o e-mail, e quando ele responde o acesso é liberado na hora — cliente avisado, você avisado. Se o comprovante não passar nas travas, cai pra você conferir como sempre.
- Se ele nunca mandar o e-mail, você recebe o aviso com o comprovante em mãos e libera no /admin.

## O que mais continua no Pix

- **O curso Kit de Fechamento (R$ 19, pagamento único)** — outro produto, outro caminho, outra tag. O prompt avisa em letras maiúsculas pra não confundir os dois R$ 19.
- **Os 5 clientes que já pagam por Pix todo mês** — o lembrete mensal deles não mudou.

## Criar, limitar ou desligar um cupom

```sql
-- novo cupom: primeiro mês por R$ 29, 50 pessoas, até 30/09
INSERT INTO cupons (codigo, descricao, primeiro_mes_valor, planos, usos_max, validade)
VALUES ('VOLTA29', 'Primeiro mês R$ 29', 29, ARRAY['ilimitado'], 50, '2026-09-30');

-- quem usou
SELECT email, valor_pago, origem, em FROM cupom_usos WHERE codigo = 'ACESSO19' ORDER BY em DESC;

-- desligar
UPDATE cupons SET ativo = false WHERE codigo = 'ACESSO19';
```

**Desligar exige dois passos**, porque o caminho digitado é validado pela Stripe, não por nós:
1. `ativo = false` no banco → a Giovanna para de oferecer, o link `?cupom=` para de aplicar e o campo de digitar some do checkout;
2. no painel da Stripe, desative o **código promocional** `ACESSO19` → quem já tinha o código guardado para de conseguir usar.

Só o passo 1 já corta 99% dos casos (ninguém mais recebe o código); o passo 2 fecha a porta pra quem anotou.

Pelo mesmo motivo, `usos_max` e `validade` são copiados pro código da Stripe **no momento em que ele é criado**. Mudar esses limites no banco depois não muda o que já está lá — pra apertar de verdade, edite também no painel da Stripe.

## Detalhes que evitam prejuízo

- **O código é criado na Stripe quando alguém abre o checkout**, não na primeira venda. Sem isso o primeiro cliente digitaria ACESSO19 e ouviria "inválido".
- **O campo de digitar só aparece no plano que tem cupom vivo** (hoje o de R$ 67). É o que impede um desconto de R$ 48 cair num plano de R$ 27 e zerar a fatura.
- **Desconto ≥ preço do plano é recusado** pelo código, antes de virar cupom.
- **O uso só conta quando o dinheiro entra** (webhook), nunca na abertura do checkout — link aberto e abandonado não queima cupom limitado.
- **Cupom com `usos_max` pode estourar em uma unidade** se dois pagarem no mesmo segundo. Proposital: o dinheiro entrou, recusar depois seria pior.
- **O webhook reconhece os dois caminhos** — o do link (pelo metadata) e o digitado (pelo desconto na própria sessão) — e grava o valor realmente pago (R$ 19) no ledger, no aviso do WhatsApp, no Purchase da Meta e na UTMify. Venda sem desconto continua exatamente como era.
- **Se a criação do cupom na Stripe falhar**, o cliente compra pelo preço cheio em vez de não conseguir comprar. O erro fica no log.

## Atenção: R$ 19 é o mesmo valor da entrada do curso

No Pix **manual** (comprovante no WhatsApp), um Pix de R$ 19,00 significa *entrada do Kit de Fechamento*: quem paga por lá ganha o curso junto e queima a trava de "entrada uma vez só" do telefone. Como a conversão agora é toda pelo site, o risco caiu bastante — mas se alguém pagar R$ 19 na chave Pix e mandar o comprovante, é isso que acontece. Não mexi na regra: se quiser separar de vez, mudo o cupom para R$ 18/R$ 19,90 ou separo os dois casos no `pixComprovanteService`.

## O que ainda não foi testado

Nenhum cupom nem código promocional foi criado na Stripe de verdade — a chave local é restrita e só me deixou **ler** (a lista está vazia). Os dois nascem na primeira abertura de checkout depois do deploy, com a chave completa da Vercel.

**Faça uma compra de teste antes de mandar o primeiro cliente**: entre em solardoc.app, digite ACESSO19 no checkout e confirme (a) que a fatura sai R$ 19, (b) que a próxima está agendada para R$ 67, e (c) que a venda apareceu no seu WhatsApp com o valor de R$ 19.
