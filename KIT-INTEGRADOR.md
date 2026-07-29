# Kit de Fechamento do Integrador — o que está pronto e o que falta

Isca de R$ 27 para integrador solar: ele compra na Kiwify, **recebe um login** (não um
PDF), consome o material **dentro do SolarDoc** e vê o gerador de documentos funcionando
ao lado todo dia — que é o que converte para o VIP de R$ 67.

Construído e no ar em 28-29/jul/2026. **Falta uma coisa só para vender: apontar o
webhook no produto da Kiwify** (passo 2 abaixo).

---

## O fluxo, ponta a ponta

| Etapa | Onde vive | Estado |
|---|---|---|
| Anúncio → LP de venda | `solardoc.app/kit` | no ar, indexável, com as telas do curso |
| Compra | `pay.kiwify.com.br/TGvxMl0` — Kit Fechamento - SolarDoc, R$ 27 | ligado na LP |
| Webhook da venda | `POST api.solardoc.app/webhook/kiwify` | no ar (o mesmo do LimpaPro) |
| Conta criada + material liberado | `api/src/services/kitIntegradorService.ts` | no ar |
| E-mail de acesso | `sendKitAcessoEmail` (Resend) | no ar |
| Consumo | `solardoc.app/cursos/kit-fechamento` (seção Cursos) | no ar — 6 módulos + bônus, 20 lições |
| Convite para o VIP | fim de cada módulo (abre o UpgradeModal) | no ar |
| Medição | `/admin` → hub SolarDoc → aba **Kit / Isca R$27** | no ar |
| Depoimentos | aba **Comentários do Curso** → publicar → aparece na LP | no ar |

---

## O que só você pode fazer (15 minutos)

### 1. Produto na Kiwify — FEITO

Produto **Kit Fechamento - SolarDoc** (R$ 27) criado e ligado na LP. Order bump
**SolarDoc VIP** cadastrado. Os nomes importam porque o backend reconhece o produto
pelo nome (regex) — os dois batem.

| O que | Nome sugerido (mantenha as palavras) | Preço |
|---|---|---|
| Produto principal | **Kit de Fechamento do Integrador** | R$ 27 |
| Order bump (único) | **SolarDoc VIP — 30 dias** | R$ 19 |

Palavras que o classificador procura (`kitIntegradorService.ts`):
- principal → `kit fechamento` ou `fechamento integrador`
- bump VIP → `30 dias … vip`, `vip … 30 dias`, `solardoc vip` ou `acesso vip`

> **Um bump só.** O "Kit de Prospecção" que seria o bump 2 virou o módulo 5 do
> curso — já está incluso nos R$ 27, e vendê-lo à parte seria cobrar duas vezes.
> Para o AOV, o caminho é o upsell pós-compra (VIP trimestral na página de obrigado).

**Mais seguro que depender do nome:** copie os IDs dos produtos na Kiwify e coloque nas
env vars do projeto `api` na Vercel (aí o nome pode mudar à vontade):

```
KIT_KIWIFY_PRODUCT_IDS=<id-do-principal>
KIT_KIWIFY_BUMP_VIP_IDS=<id-do-bump-vip>
```

### 2. Apontar o webhook — **É O QUE FALTA**

Na Kiwify, no produto do kit (e em cada bump — a Kiwify manda **um webhook por
produto**, order bump vem em pedido separado):

```
https://api.solardoc.app/webhook/kiwify
```

É o mesmo endereço que o LimpaPro já usa. Um produto do kit chegando ali é desviado
para o fluxo do kit e **não entra** no funil do LimpaPro.

### 3. Ligar o checkout na landing — FEITO

`CHECKOUT_URL` aponta para `https://pay.kiwify.com.br/TGvxMl0`, o pixel da página é
o **824905216831401** e ela está `index, follow`. Os botões levam ao checkout com os
UTMs da visita colados na URL e no `sck` (verificado em produção).

### 4. (Opcional) Assinar o webhook

Se ainda não existir, defina `KIWIFY_WEBHOOK_TOKEN` na Vercel com o token do webhook da
Kiwify. Sem ele o endpoint aceita mesmo assim, com aviso no log.

---

## Como testar antes de anunciar

1. Crie um cupom de 100% na Kiwify e compre o kit com um e-mail que você tenha acesso.
2. Confira o e-mail "Kit de Fechamento liberado".
3. Clique em definir senha → entra na plataforma → seção **Cursos** com a trilha dos 6 módulos.
4. `/admin` → hub SolarDoc → aba **Kit / Isca R$27** deve mostrar 1 comprador.

Se algo não chegar, o payload cru fica em `webhook_debug` (busque por `_route: /webhook/kiwify`).

---

## A régua da decisão (do plano aprovado)

O painel mostra as duas taxas que decidem se a isca escala:

- **Visita → compra ≥ 5,9%** → a mídia se paga sozinha a R$ 27. Escala.
- **Entre 3% e 5,9%** → só continua se **comprador → assinante ≥ 20%**.
- **Abaixo de 2%** → desliga: fica mais caro que o tráfego direto, que já custa
  R$ 154 por assinante.

Referência da casa: o LimpaPro converte 1,26% do clique em comprador, com um público
mais barato. Por isso o teste é de R$ 700, não de R$ 5.000.

---

## Detalhes que já estão tratados

- **Pix manda dois webhooks** (`waiting_payment` e depois `paid`). O e-mail de acesso é
  gateado por carimbo (`kit_pedidos.acesso_email_em`), não por "pedido novo" — quem paga
  no Pix recebe o link igual a quem paga no cartão, e reentrega não manda duas vezes.
- **Reembolso/chargeback:** o material se tranca sozinho (só pedido `paid` dá acesso) e o
  trial de 30 dias do bump é revogado. Quem tiver assinatura de verdade é restaurado pelo
  `stripeSyncService` no ciclo seguinte.
- **Produto do LimpaPro no mesmo webhook** continua indo para o funil do LimpaPro e não
  cria conta no SolarDoc. Testado em produção.

## Onde mexer depois

| Quero mudar | Arquivo |
|---|---|
| Texto das objeções | `dashboard/src/app/(dashboard)/cursos/_conteudo/objecoes.ts` |
| Roteiro da visita | `.../_conteudo/roteiro.ts` |
| Custos e margem | `.../_conteudo/precificacao.ts` |
| Mensagens de prospecção | `.../_conteudo/prospeccao.ts` |
| Pós-venda e garantias | `.../_conteudo/posvenda.ts` |
| Estrutura do curso (módulos, lições, XP) | `.../cursos/_conteudo/kit-fechamento.ts` |
| Tela do curso | `.../cursos/[slug]/page.tsx` |
| Conteúdo de cada lição | `.../cursos/_componentes/ConteudoLicao.tsx` |
| Página de venda | `dashboard/public/kit/index.html` |
| Regra da ponte (conta, trial, e-mail) | `api/src/services/kitIntegradorService.ts` |
| Dias de VIP do bump | `KIT_BUMP_TRIAL_DIAS` no mesmo arquivo (hoje 30) |
| E-mail de entrega | `sendKitAcessoEmail` em `api/src/utils/mailer.ts` |

> **Sem download, de propósito.** O curso não tem PDF nem planilha para baixar: o
> conteúdo mora na plataforma, porque é a visita diária dele que vende o VIP. Quando
> uma lição precisa de ferramenta, ela aponta para a que já existe aqui (calculadora,
> gerador de documentos).

> **Curso novo?** O padrão está travado em
> `dashboard/src/app/(dashboard)/cursos/COMO-ADICIONAR-CURSO.md` — declara módulos e
> lições no registro e a casca entrega trilha, XP, níveis e conquistas prontos.


Testes: `cd api && npx vitest run src/__tests__/kitIntegrador.test.ts` (15 casos —
idempotência, conta pendente, trial que não estende na reentrega, assinante que não é
rebaixado).
