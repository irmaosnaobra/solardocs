# PLUGCASH — ESPECIFICAÇÃO COMPLETA DE BUILD

> Cole este documento no Claude Code junto com o `PROMPT-Claude-Code-Eletroposto.md`.
> Aquele define o funil e as fases. Este define marca, layout, catálogo e checkout.

---

## 1 · IDENTIDADE

**Nome:** PlugCash
**Domínio:** `plugcash.solardoc.app` (ou domínio próprio, se registrado)
**Assinatura:** o mercado de recarga elétrica, do ponto ao faturamento.

**Arquivos de marca entregues:**
- `plugcash-logo.svg` — lockup horizontal, uso principal
- `plugcash-mark.svg` — símbolo isolado, favicon, ícone de app, avatar social

**O símbolo:** um raio branco atravessado por uma haste vertical, formando a leitura
simultânea de energia e de cifrão, dentro de um token verde arredondado.

**Regras de uso:**
- Área de respiro mínima ao redor do lockup: metade da altura do símbolo.
- Tamanho mínimo do lockup: 120px de largura. Abaixo disso, usar só o símbolo.
- Sobre fundo escuro: trocar `Plug` de `#0A0A0A` para `#FFFFFF`. `Cash` permanece verde.
- Versão monocromática: tudo em branco sobre preto, ou tudo em preto sobre branco.
- Nunca aplicar sombra, gradiente, contorno ou rotação no símbolo.

**Antes de publicar:** converter o texto do lockup para vetor (outline). Hoje ele depende
de fonte instalada; em outline o logo fica idêntico em qualquer ambiente.

---

## 2 · DESIGN TOKENS

```css
:root {
  /* Marca */
  --pc-green:        #00C853;
  --pc-green-deep:   #009B40;   /* hover, estados pressionados */
  --pc-green-soft:   #E6F9EE;   /* fundos de destaque, badges */
  --pc-black:        #0A0A0A;
  --pc-white:        #FFFFFF;

  /* Neutros */
  --pc-gray-900:     #141414;   /* seções escuras */
  --pc-gray-800:     #262626;   /* cards em fundo escuro */
  --pc-gray-600:     #6B6B6B;   /* texto secundário */
  --pc-gray-300:     #D9D9D9;   /* bordas */
  --pc-gray-100:     #F5F5F5;   /* fundo de app */

  /* Sistema */
  --pc-radius:       12px;
  --pc-radius-lg:    20px;
  --pc-border:       1px solid var(--pc-gray-300);
}
```

**Verde é acento, não fundo.** Ele aparece em botões primários, badges de preço,
progresso e no símbolo. Fundo verde em bloco grande deixa o produto com cara de
infoproduto barato — evitar.

**Tipografia:** Inter (ou a família já usada no solardoc.app — verifique antes de
adicionar fonte nova). Títulos em 700, corpo em 400, dados numéricos em 500.
Escala: 40 / 30 / 22 / 18 / 16 / 14.

**Superfícies:**
- Páginas de venda e hero: fundo `--pc-black`, texto branco, acento verde.
- Interior do app: fundo `--pc-gray-100`, cards brancos, texto preto.
- Sem gradiente, sem glassmorphism, sem sombra pesada. Bordas de 1px e raio consistente.

---

## 3 · ESTRUTURA DE ROTAS

```
/                        landing pública do PlugCash
/login                   entrada
/cadastro                criação de conta
/recuperar-senha
/app                     dashboard do aluno (protegida)
/app/curso/[slug]        player e aulas (protegida, exige acesso)
/app/catalogo            todos os cursos, travados e liberados
/app/servicos            esteira de serviços avulsos
/app/conta               perfil, acessos, faturas
/curso/[slug]            PÁGINA DE CONVERSÃO pública de cada curso
/checkout/[slug]         redirecionamento para o gateway
/obrigado/[slug]         pós-compra, libera acesso e orienta o login
/admin                   painel interno (protegido por role)
```

---

## 4 · LOGIN E CONTA

- Supabase Auth, o **mesmo projeto e o mesmo auth do solardoc.app**. Não criar projeto novo.
- Métodos: e-mail e senha, além de magic link por e-mail.
- Usuário que já existe no SolarDoc entra sem novo cadastro. O acesso ao PlugCash é um
  registro na tabela de níveis, não uma conta separada.
- Tabelas do PlugCash com prefixo `pc_` para não colidir com as do SolarDoc.
- Após compra aprovada, provisionar conta automaticamente e enviar e-mail com acesso.
- Tela de login: fundo preto, logo centralizado, card branco com o formulário. Sem
  ilustração, sem carrossel de depoimento.

---

## 5 · CATÁLOGO DE CURSOS

**Todos nascem travados.** O acesso é concedido por compra individual ou por nível.

| # | Curso | Slug | Preço | Libera com |
|---|---|---|---|---|
| 1 | Fundamentos do Eletroposto | `fundamentos` | R$ 197 | compra direta / qualquer nível |
| 2 | Ponto Zero — achar, avaliar e arrendar | `ponto-zero` | R$ 497 | compra direta |
| 3 | Capital — financiamento e sociedade | `capital` | R$ 397 | compra direta |
| 4 | Dossiê do Sócio — convencer quem decide | `dossie` | R$ 297 | compra direta |
| 5 | Projeto e homologação na distribuidora | `homologacao` | R$ 697 | compra direta / Integrador |
| 6 | Equipamento — o que comprar e de quem | `equipamento` | R$ 497 | Integrador |
| 7 | Operação e precificação | `operacao` | R$ 397 | compra direta / Integrador |
| 8 | Credenciamento Integrador | `integrador` | R$ 997 + R$ 97/mês | assinatura |
| 9 | Mentoria Investidor | `mentoria` | R$ 5.997 | venda consultiva |

> **CONFIRMAR TODOS OS PREÇOS ANTES DE PUBLICAR.** Nenhum foi validado em mercado.
> Deixar os valores em tabela editável pelo `/admin`, nunca hardcoded no componente.

**Regra de abatimento:** o valor pago em um curso abate no upgrade para Integrador ou
Mentoria. Implementar como crédito na conta do usuário, com validade configurável.

---

## 6 · CARD DE CURSO (estado travado)

Aparece em `/app/catalogo` e no dashboard.

- Thumbnail em escala de cinza com opacidade reduzida.
- Ícone de cadeado no canto superior direito.
- Título e uma linha de descrição, ambos legíveis (não borrar o texto).
- Badge de preço em `--pc-green-soft` com texto `--pc-green-deep`.
- Botão primário verde: **"Desbloquear — R$ X"** → leva para `/curso/[slug]`.
- Se o curso já foi comprado: thumbnail colorida, barra de progresso verde,
  botão **"Continuar"**.
- Se o curso pertence a um nível que ele não tem: badge "Integrador" no lugar do preço.

**Não borre o conteúdo pra criar curiosidade artificial.** Mostre a grade de aulas
completa com cadeado em cada uma. Saber exatamente o que está perdendo converte melhor
que mistério.

---

## 7 · PÁGINA DE CONVERSÃO DE CADA CURSO — `/curso/[slug]`

Uma página por curso, mesma estrutura, conteúdo próprio. Pública, indexável, acessível
por link direto — serve tanto para o aluno logado quanto para tráfego externo.

**Estrutura (de cima para baixo):**

1. **Hero** — fundo preto. Título do curso, subtítulo de uma linha, badge de preço,
   botão verde de compra. Player de vídeo de vendas ao lado (3 a 4 min).
2. **A dor** — 3 a 4 bullets do problema que esse curso resolve. Escrito na segunda
   pessoa, específico.
3. **Grade de aulas** — lista completa, com duração de cada uma. Transparência total.
4. **O que vem junto** — planilhas, modelos, checklists, materiais em PDF.
5. **Para quem é e para quem não é** — dois blocos lado a lado. O bloco "não é" precisa
   ser honesto de verdade, senão vira reembolso.
6. **Preço e formas de pagamento** — valor à vista, parcelamento, e a nota de abatimento
   no upgrade.
7. **Garantia** — 7 dias, devolução integral, o aluno fica com o material já baixado.
8. **FAQ** — 5 a 6 perguntas, acordeão.
9. **CTA final** — repete o botão de compra.

**Order bump:** no máximo um por checkout, exibido como uma linha com checkbox, nunca
como card com copy longa.

**Proibido:** contador regressivo falso, vagas fictícias, depoimento inventado, "de R$ X
por R$ Y" sem que o preço cheio tenha existido. O público veio de uma peça técnica de
7 minutos; artifício aqui contamina a marca principal.

---

## 8 · CHECKOUT

- Usar o mesmo gateway já utilizado nos outros produtos — verifique no código qual é
  antes de integrar um novo.
- Cada curso tem seu próprio link de compra, armazenado na tabela de cursos e editável
  pelo `/admin`. O código nunca deve conter um link de checkout fixo.
- Webhook de compra aprovada → cria ou atualiza o usuário → concede acesso ao curso →
  envia e-mail → redireciona para `/obrigado/[slug]`.
- Assinatura do Integrador: cobrança de credenciamento única + recorrência mensal,
  com tratamento de falha de pagamento e suspensão de acesso após [N] dias.
- Disparar evento de conversão para pixel e CAPI com deduplicação por `event_id`,
  no mesmo padrão dos outros projetos.

---

## 9 · DASHBOARD DO ALUNO — `/app`

- Saudação com o nome, nível atual e o que está bloqueado.
- **Bloco "seu próximo passo"** no topo: uma única recomendação, definida pelo
  `motivo_descarte` que veio do formulário do eletroposto e pela resposta do onboarding.
  Um cara sem ponto vê Ponto Zero. Um técnico vê Credenciamento Integrador.
- Continue de onde parou.
- Catálogo abaixo, cursos liberados primeiro, travados em seguida.
- Faixa de serviços da esteira, com preço visível.

---

## 10 · ADMIN — `/admin`

- CRUD de cursos: título, slug, preço, link de checkout, thumbnail, grade de aulas,
  nível exigido, status publicado/rascunho.
- CRUD de serviços da esteira, com capacidade máxima mensal por item.
- Gestão de usuários, níveis e créditos de abatimento.
- Métricas: vendas por curso, receita recorrente, churn, progresso médio, conversão da
  página de cada curso.

---

## 11 · ORDEM DE EXECUÇÃO

1. Tokens, layout base, componentes e integração da marca
2. Login, cadastro e provisionamento a partir da compra
3. Schema `pc_*`: cursos, aulas, acessos, compras, créditos
4. Admin com CRUD de cursos (para popular sem depender de deploy)
5. Catálogo e card travado
6. Página de conversão `/curso/[slug]` com um curso real
7. Checkout e webhook ponta a ponta, testado com uma compra real de valor baixo
8. Dashboard e recomendação de próximo passo
9. Esteira de serviços
10. Métricas do admin

Pare e reporte ao final de cada item. Não encadeie tudo de uma vez.

**Nada vai ao ar com conteúdo placeholder.** Um curso publicado sem aula gravada gera
reembolso e queima a base — e a base do PlugCash é a mesma do SolarDoc.
