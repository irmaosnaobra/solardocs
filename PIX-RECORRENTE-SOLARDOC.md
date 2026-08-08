# Pix recorrente no SolarDoc

Construído em 08/08/2026. **Está no código e desligado** — liga com as variáveis de ambiente do passo 3.

---

## Por que não é pela Stripe

Não é implicância da Stripe com a gente, é regra de país. Dois fatos conferidos hoje:

1. **A doc da Stripe, na página do Pix, diz literalmente:** *"As contas Stripe no Brasil podem aceitar pagamentos únicos via Pix com liquidação de fundos em BRL. **O Pix Automático não está disponível no Brasil.** (Apenas por convite)"*. O Pix Automático da Stripe roda via EBANX e é oferecido a contas de **fora** do Brasil (US, UK, UE, CA, AU, SG, CH) cobrando clientes brasileiros — com IOF de 3,5% em cima.

2. **A nossa conta é BR e o Pix nem está habilitado nela.** Consultado pela API em 08/08/2026:
   - conta `acct_1TKNGNCkkgzQ4IHe`, `country: BR`, `default_currency: brl`
   - capabilities ativas: `card_payments`, `boleto_payments`, `transfers` — **não existe `pix_payments`**
   - payment method configuration `pmc_1TKNGw…`: `pix: { available: false, preference: "off" }`

Ou seja: hoje a Stripe não nos dá nem Pix avulso, quanto mais recorrente. Se a promessa de maio se referia ao Pix avulso para contas BR (o tal "apenas por convite"), ela **não chegou nesta conta**.

### O que dá pra fazer com a Stripe (em paralelo, custa 5 minutos)

Pedir o convite. Dashboard → **Configurações → Formas de pagamento → Pix → Solicitar acesso**; se não aparecer o botão, abrir chamado no suporte. Texto pronto:

> Olá. Nossa conta é `acct_1TKNGNCkkgzQ4IHe` (Brasil, BRL). Precisamos cobrar assinaturas mensais em Pix.
> 1. O Pix não aparece como disponível na nossa conta (`pix.available: false`, sem capability `pix_payments`). Como solicitamos o acesso ao Pix para contas BR (a documentação menciona "apenas por convite")?
> 2. A documentação diz que o Pix Automático não está disponível no Brasil. Existe programa de acesso antecipado para contas BR e qual a previsão? Fomos informados de uma liberação em maio.
> Somos SaaS por assinatura (ticket R$ 27 a R$ 67/mês, cobrança mensal recorrente).

Mesmo que respondam bem, o Pix Automático em conta BR **ainda não existe** — então o trilho abaixo é o que resolve agora. Quando a Stripe liberar, migrar é trocar um endpoint: o acesso do cliente continua sendo `plano` + `plano_expira_em`, igual nos dois caminhos.

---

## O que foi construído

Um trilho de Pix recorrente pelo **Asaas** (PSP brasileiro, autorizado pelo BCB para Pix Automático). Ele tem **dois modos**, no mesmo código e no mesmo webhook:

| Modo | Como o cliente vive | Quando é usado |
|---|---|---|
| `automatico` | Paga o 1º mês num QR e **autoriza o débito mensal no app do banco**. Dos meses seguintes em diante não faz mais nada — o banco avisa 3 dias antes e debita. | Padrão. É o substituto real do cartão. |
| `assinatura` | Recebe um QR novo todo mês e paga na mão — **mas a confirmação é automática** (nada de mandar comprovante). | Rede de segurança: cai aqui sozinho se a conta não estiver elegível ao Pix Automático ou se o banco do cliente não suportar. |

**Elegibilidade do Pix Automático (regra do Asaas):** conta PJ, aprovada, sem pendência cadastral, sem marcação de fraude e **CNPJ ativo há ≥ 6 meses**. A AIOROS LTDA abriu em **12/11/2025** (consultado na Receita) → passa desde maio/2026.

### Arquivos

| Arquivo | Papel |
|---|---|
| `MIGRATION_asaas_pix_recorrente.sql` | tabelas `asaas_pix_assinaturas` e `asaas_webhook_events` |
| `api/src/services/asaas/asaasClient.ts` | cliente HTTP (header `access_token`, sandbox por padrão) |
| `api/src/services/asaas/pixRecorrenteService.ts` | cria autorização/assinatura, consulta e cancela |
| `api/src/services/asaas/asaasWebhookService.ts` | pagamento → mês de acesso, com as travas |
| `api/src/controllers/asaasPixController.ts` | `/payments/pix-recorrente` (POST/GET), `/cancelar`, `/asaas/webhook` |
| `dashboard/.../pix-recorrente/page.tsx` | tela: escolhe plano, informa CPF, mostra QR e libera sozinha |

Os três lugares onde o cliente sem cartão trava agora têm saída: o **modal de upgrade**, a **tela de free esgotado** e a **tela de conta suspensa**. Enquanto o trilho estiver dark, esse link vai pro **WhatsApp do atendimento** (o Pix manual, que funciona hoje) em vez de uma tela dizendo "ainda não está no ar" — quem clica ali está com a carteira na mão. Ele passa a apontar pra `/pix-recorrente` quando `NEXT_PUBLIC_PIX_RECORRENTE=on` entrar no projeto do dashboard.

A tela de Pix também ficou de fora dos portões do layout (CNPJ obrigatório, suspensão, free esgotado) — bloquear quem está tentando pagar é o único erro caro aqui. Nos casos de suspensão e free esgotado ela abre **sozinha, sem o resto do app em volta**: a pessoa precisa poder pagar, não voltar a navegar no produto.

### As travas (por que isto não vira o problema dos chargebacks)

- **Crédito duplo:** `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` chegam para o mesmo pagamento com ids de evento diferentes. Além da PK em `asaas_webhook_events`, o mês só é creditado por quem conseguir gravar o `payment_id` em `ultimo_pagamento_id` — `UPDATE … WHERE ultimo_pagamento_id <> $id`, um filtro só, atômico (a coluna é `NOT NULL DEFAULT ''` justamente pra esse `<>` funcionar na primeira cobrança).
- **Folga que não acumula:** a renovação calcula o mês em cima da data **sem** a folga anterior. Somar 7 dias por cima de uma data que já tinha 7 daria ao cliente mais de um mês grátis ao longo de seis renovações.
- **Cobrança em dobro entre provedores:** no primeiro pagamento por Pix, as assinaturas de cartão daquele e-mail são canceladas na Stripe. De quebra, `cancelStripeSubsForEmail` passou a varrer **100 Customers** em vez de 5 — o checkout cria um Customer novo a cada clique, que é a origem de todos os chargebacks do SolarDoc.
- **Contrato duplicado:** cliente com contrato vivo recebe o mesmo de volta, não um segundo.
- **Folga de 7 dias** em cima do mês pago: o Pix Automático debita no ciclo **+3 dias** e ainda retenta por até 3. Sem a folga, o acesso cairia com o débito a caminho.
- **Webhook fecha por padrão:** sem `ASAAS_WEBHOOK_TOKEN` configurado, ele recusa tudo (503). Falha no processamento devolve 500 de propósito, pro Asaas reenviar.

---

## Como ligar (na ordem)

1. **Criar a conta Asaas** no CNPJ da AIOROS LTDA (63.636.043/0001-88) e concluir a aprovação cadastral. Pedir a habilitação do **Pix Automático** — vale confirmar com eles a tarifa por Pix recebido antes de virar a chave (a página de preços exige login, não dá pra citar número aqui sem chutar).
2. ~~Rodar `MIGRATION_asaas_pix_recorrente.sql`~~ — **já aplicada em 08/08/2026** (tabelas `asaas_pix_assinaturas` e `asaas_webhook_events` criadas, vazias).
3. **Variáveis na Vercel** (projeto da API):
   - `ASAAS_API_KEY` — chave da conta
   - `ASAAS_ENV` — `sandbox` para testar, `prod` para valer
   - `ASAAS_WEBHOOK_TOKEN` — string de 32+ caracteres, inventada por nós
   - `ASAAS_PIX_MODO` — `auto` (recomendado)

   E no projeto do **dashboard**: `NEXT_PUBLIC_PIX_RECORRENTE=on` — é o que faz os
   links das telas de bloqueio saírem do WhatsApp e passarem a apontar pra tela de
   assinatura. Deixe por último, depois do teste no sandbox.
4. **Cadastrar o webhook no Asaas** apontando para
   `https://api.solardoc.app/payments/asaas/webhook`,
   com o mesmo `authToken` do passo 3, `sendType: SEQUENTIALLY`, e os eventos:
   `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED`, `..._CANCELLED`, `..._EXPIRED`, `..._REFUSED`,
   `PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED`.
5. **Testar no sandbox antes de tudo** (`ASAAS_ENV=sandbox`): assinar pela tela `/pix-recorrente`, pagar o QR de teste, e conferir que (a) `plano_expira_em` andou um mês e sete dias, (b) chegou o aviso no seu WhatsApp, (c) reenviar o mesmo evento **não** dá um segundo mês.

## O que ainda não foi verificado

Nada disto rodou contra a API real — a conta Asaas não existe ainda. Os nomes de campo saíram da referência oficial deles, mas o primeiro teste em sandbox é obrigatório. Dois pontos merecem atenção nesse teste:

- **`startDate` da autorização** está em "hoje + 1 mês", porque o 1º mês é o QR imediato. Se o Asaas interpretar diferente, o cliente pode ser cobrado duas vezes no mês da adesão — é a primeira coisa a conferir.
- **`payload`/`encodedImage`** vêm na resposta da criação da autorização. No exemplo da doc eles aparecem nulos; se vierem nulos de verdade, a tela mostra o aviso em vez do código, e aí o QR precisa ser buscado em outro endpoint.

## O que continua igual

O trilho manual de Pix (comprovante lido por IA no WhatsApp, `pixComprovanteService`) **segue funcionando e não foi tocado** — hoje são 5 clientes nele. Quem já paga assim continua pagando assim; o novo trilho é para quem chega agora.
