# Recuperação de checkout abandonado (Stripe → Pix na Kiwify)

Atualizado em **14/08/2026**

Quem começa a assinar o SolarDoc e não conclui o pagamento é perseguido por
e-mail + WhatsApp da Giovanna. Quem não vai pagar no cartão recebe o **Pix**, e o
Pix agora é uma **página de checkout da Kiwify** — o acesso libera sozinho.

---

## O que faltava (medido em 14/08/2026)

A automação existia e **nunca entregou um toque**. Duas causas independentes:

1. **"Recuperado" mentia.** A regra de parada era *"o e-mail existe em `users`"*.
   Isso valia quando só o checkout público capturava abandono (ali ninguém tem
   conta antes de pagar). Quando o webhook passou a capturar também o abandono de
   quem **já está logado** (o UpgradeModal), ter conta virou sinônimo de ter
   comprado: **7 de 7** abandonos foram marcados `recovered` sem um toque —
   inclusive um usuário `free` que nunca comprou nada.
2. **Ninguém tinha telefone.** O checkout de quem está logado não coletava
   telefone. `abandoned_checkouts.phone` nascia `null` e a Giovanna nunca falava
   com ninguém: **0 de 7** com número.

Consertado nos dois pontos. Recuperado agora é **ter acesso pago de pé** (plano
pago com billing ativo, ou `plano_expira_em` no futuro) **ou comprar depois do
abandono**. E, sem telefone da Stripe, o toque usa o **WhatsApp do cadastro**.

---

## Como funciona hoje

| Quando | O que acontece |
|---|---|
| Ele clica em **voltar** no checkout da Stripe | Cai em **`/quase-la`** — cartão (com o mesmo cupom) e Pix, na hora |
| A sessão da Stripe expira sem pagar | Webhook grava em `abandoned_checkouts` (e-mail, telefone, plano) |
| ~1h depois | **T1**: e-mail + Giovanna no WhatsApp ("foi o cartão?") |
| +1d, +2d, +3d, +4d, +4d | **T2 a T6**: cada toque com um ângulo diferente, até ~14 dias |
| Ele responde | A Giovanna manda o caminho: **site + cupom** (cartão) |
| Ele pede Pix / diz que não tem cartão | A Giovanna manda o **link do checkout da Kiwify** |
| Ele paga no Pix | O webhook da Kiwify libera 30 dias e manda o e-mail de acesso |
| ~2 dias antes de vencer | A Giovanna manda o **mesmo link** no WhatsApp; pagou, empilha +30 dias sozinho |
| Ele vira pagante (qualquer caminho) | A cadência para sozinha no ciclo seguinte |

Quem está **em dunning** (assinante com cobrança falhando) não entra: essa pessoa
já tem a Giovanna do `dunningService` falando com ela, com outro roteiro.

### A saída na hora: `/quase-la`

O `cancel_url` dos dois checkouts aponta pra `solardoc.app/quase-la`, levando
`plano`, `cupom` e `via` (LP ou conta). Antes ia pra home com `?cancelado=1`, que
**nenhuma linha de código lia** — o momento de maior intenção do funil morria numa
página institucional.

A tela **lidera com o Pix** (decisão do Thiago, 14/08: a dor real do atendimento
é gente que quer a plataforma e não tem cartão de crédito). O cartão fica logo
abaixo, com o cupom na cara — quem tem cartão paga menos no primeiro mês e
precisa ver isso. O bloco de Pix só aparece quando o link está configurado.

Quando `NEXT_PUBLIC_PIX_RECORRENTE=on` (trilho Asaas) e a pessoa **tem conta**, o
bloco vira **assinatura no Pix** e aponta pra `/pix-recorrente` — débito
autorizado uma vez no banco. Quem veio da LP ainda não tem conta (no fluxo
público ela nasce depois do pagamento), então pra ele o caminho segue sendo o Pix
avulso, que cria a conta no ato. Escada, não beco.

O `via` importa: quem já tem conta volta pelo checkout **da conta**, nunca pelo
público — checkout público pra quem já é cliente cria Customer novo na Stripe,
que é a origem das assinaturas duplicadas.

> `/quase-la` precisa estar em `PUBLIC_PATHS` no `dashboard/src/proxy.ts`. Sem
> isso o visitante deslogado toma 307 pro `/auth?mode=login` — e o build não
> acusa nada. Conferido rodando o build local.

#### Dois "voltar" diferentes (15/08)

O `cancel_url` cobre **um gesto só**: o clique na setinha "←" DENTRO da página da
Stripe. O **botão de voltar do navegador** (e o swipe-back do celular, que é como
a maioria desiste no mobile) não passa por ele — o navegador desfaz a navegação e
devolve a pessoa pra LP, com a Stripe fora do caminho. Foi isso que apareceu no
teste do Thiago: sessão criada com o `cancel_url` certo (conferido na API da
Stripe: `https://solardoc.app/quase-la?cancelado=1&via=lp&plano=pro`), `/quase-la`
respondendo 200 — e quem voltava caía na LP mesmo assim.

Coberto agora pelo par:

- `dashboard/src/lib/saidaCheckout.ts` — no instante em que mandamos alguém pro
  checkout, guarda o endereço de saída (o **mesmo** `cancel_url`, que os dois
  endpoints passaram a devolver como `cancelUrl`) no `sessionStorage`.
- `dashboard/src/components/VoltaDoCheckout/` — montado no layout raiz, ouve
  `pageshow` (pega bfcache e carregamento normal) e leva a pessoa pra `/quase-la`
  quando ela reaparece. Quem chegou **pagando** (`welcome=1` ou
  `mode=register&session=`) tem a marca apagada sem redirect: cliente que assinou
  não pode ver "Não tem cartão?".

> **Fechar a aba continua indetectável.** Isso acontece no domínio da Stripe, onde
> a gente não roda JavaScript — nem este código nem nenhum outro. Quem fecha a aba
> só é alcançado pela cadência de abandono acima (`checkout.session.expired`).

---

## Hoje o Pix da página é o WhatsApp (decisão do Thiago, 14/08)

Enquanto `SOLARDOC_PIX_CHECKOUT_URL` estiver vazia, o botão verde da `/quase-la`
abre `wa.me/5534998165040` com "Oi! Quero assinar o SolarDoc pagando por Pix.".

> ⚠️ Desde 14/08 nem todo mundo chega na `/quase-la`: com o Asaas ligado,
> `destinoDeSaida` manda quem tem conta direto pra `/pix-recorrente`. A
> `/quase-la` ficou pra quem está levando o **anual** e (enquanto
> `PIX_PUBLICO_ATIVO` estiver desligada) pra quem veio da LP sem conta.

Duas coisas pra saber sobre esse caminho:

- **A linha está de pé** (conferido em 14/08 às 16:53 UTC: `zapi_io_health` com
  `downStreak: 0`, 696 mensagens em 24h). Ela já caiu duas vezes antes — o
  alerta de queda sai por e-mail.
- **Nenhum robô responde nessa linha.** É a linha IO, e `handleSdrLead` tem
  early-return pra `'io'` de propósito: quem chega ali cai pra **humano**. Ou
  seja, o Pix de hoje converte na velocidade de quem olha o telefone. É esse o
  trabalho que o checkout da Kiwify (abaixo) elimina.

## "Mas o Asaas não resolve isso?" (não — conferido em 24/08)

Pergunta que volta toda vez que o aviso de "falta o link do Pix" chega, porque o
Pix recorrente do Asaas **está ligado em produção** desde 14/08. Está — e atende
outro caminho:

| | Asaas (`/pix-recorrente`, `/pix-automatico`) | Kiwify (`mes_pix`) |
|---|---|---|
| **quem alcança** | quem SAI do checkout da Stripe **já logado**, no mesmo minuto | quem abandonou e é reencontrado **dias depois**, no WhatsApp/e-mail |
| **o que vende** | **assinatura** — débito mensal autorizado no app do banco (`ASAAS_PIX_MODO` padrão `auto`) | **um mês avulso** de R$ 67, acaba e acabou |
| **pede** | e-mail + nome + **CPF/CNPJ** | e-mail |
| **e-mail sem conta** | webhook **não cria** — avisa o Thiago pra fazer na mão | webhook **cria e libera** sozinho |
| **estado** | ligado (`ASAAS_API_KEY` em produção); a tela pública `/pix-automatico` está **desligada**, falta `PIX_PUBLICO_ATIVO=true` | falta criar o produto |

Por que isso importa aqui: **nenhum toque da recuperação conhece o Asaas.** A
Giovanna (`pixRecoveryAgentService`), o e-mail de abandono (`mailer`) e o
lembrete mensal (`pixVipReminderService`) olham só `pixCheckoutUrl()`. Sem essa
env, todos caem no copia-e-cola manual — não no Asaas.

E ligar `PIX_PUBLICO_ATIVO` **não** conserta: o roteiro da Giovanna promete na
lata *"R$ 67, um mês do plano completo"*, e o trilho do Asaas cobra todo mês.
Além disso o `pixVipReminderService` mandaria cobrança de renovação pra quem já
autorizou débito automático. Trocar o trilho da recuperação pro Asaas é
**mudança de produto** — mexe no roteiro, no e-mail e no lembrete —, não flip de
env. Por isso `pixInfo.pixPublicoUrl()` existe mas ninguém a chama nas mensagens.

Medida em 24/08: dos 17 abandonos, **13 já têm conta e 4 não** — esses 4 são
exatamente quem o Asaas não libera sozinho.

## O que falta pra ligar o Pix automático (1 configuração)

Enquanto a env abaixo estiver vazia, o Pix continua **manual** (chave + comprovante
no WhatsApp — o caminho que já custou 2 dias de espera pro Junior em 11/08). A
recuperação **avisa por e-mail** toda vez que roda nesse estado.

1. **Na Kiwify**, crie o produto:
   - Nome: **`SolarDoc — 1 mês`** (pode ser "1 mês de acesso", "mês avulso"…)
   - **NÃO** use "30 dias" no nome: esse nome é da entrada de R$19, que vem com o
     curso junto — o mês avulso entregaria o Kit de Fechamento de graça.
   - Preço: **R$ 67** · Pix habilitado
   - Webhook: o mesmo de sempre (`/webhook/kiwify`), já roteia sozinho.
2. **Na Vercel**, duas env vars:
   - `SOLARDOC_PIX_CHECKOUT_URL` = o link do checkout (ex.: `https://pay.kiwify.com.br/xxxxx`)
   - `KIT_KIWIFY_MES_PIX_IDS` = o `product_id` do produto (à prova de renomeação)
3. Pronto. A Giovanna passa a mandar o link no lugar da chave Pix, e o e-mail de
   abandono troca o bloco de dados bancários por um botão "Pagar no Pix".

O que o comprador recebe: **30 dias de documentos ilimitados** + e-mail com o link
de acesso. **Sem** o curso (Kit de Fechamento continua sendo produto pago à parte).
Reembolso na Kiwify revoga o acesso.

---

## Onde mexer no código

| Arquivo | O que faz |
|---|---|
| `api/src/controllers/paymentsController.ts` | captura o abandono (`checkout.session.expired`) e agora coleta telefone nos dois checkouts |
| `api/src/services/followupService.ts` | a cadência: quem recebe, quando para, por onde fala |
| `api/src/services/agents/whatsapp/pixRecoveryAgentService.ts` | a Giovanna da recuperação (conversa, cupom, Pix) |
| `api/src/utils/pixInfo.ts` | os dois trilhos de Pix (checkout da Kiwify → fallback manual) |
| `api/src/services/kitIntegradorService.ts` | libera o acesso quando o Pix cai (`mes_pix`) |
| `dashboard/src/app/quase-la/` | a tela de saída do checkout (Pix primeiro, cartão depois) |
| `api/src/services/agents/whatsapp/pixVipReminderService.ts` | o lembrete mensal — manda o link quando o valor bate (R$ 67) |

---

## E o Pix recorrente de verdade?

O que está descrito acima é **Pix avulso de 30 dias**: cobra uma vez, e o
lembrete mensal traz a pessoa de volta pra pagar de novo em um clique. Não é
débito automático.

Débito automático por Pix (**Pix Automático** do Banco Central) **já está
construído aqui e desligado**: é o trilho Asaas de 08/08/2026, com os dois modos
(`automatico` e o fallback `assinatura`). Passo a passo em
`PIX-RECORRENTE-SOLARDOC.md`. Falta `ASAAS_API_KEY` e — o mais importante — o
**primeiro teste no sandbox**: nada disso rodou contra a API real, e o ponto de
risco é o `startDate` da autorização (se o Asaas ler diferente do esperado, cobra
duas vezes na adesão).

Assinatura no Pix da **Kiwify não resolve isso**: lá o cliente renova na mão (a
plataforma manda e-mail diário 3 dias antes do vencimento), porque não existe
débito em conta. É o mesmo trabalho de cobrar todo mês, só que por e-mail.

Testes: `api/src/__tests__/abandonoRecuperacao.test.ts` e `kitIntegrador.test.ts`.
