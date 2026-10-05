# Diário de Obra — desenho do projeto

Módulo novo do SolarDoc, irmão da Vistoria Solar. A Vistoria documenta **antes de vender**
(engenharia, homologação). O Diário documenta **enquanto executa** e devolve duas coisas de
uma vez: o **arquivo da obra** (pro integrador e pro cliente) e o **material pronto pra postar**.

---

## 1. Por que isso vale a pena construir

Os números que mandam aqui não são de funcionalidade, são de retenção:

- CAC de **R$154 por assinante** contra **~R$110 de valor de vida**.
- Cancelamento mediano em **12 dias**.

Ou seja: o cliente paga, gera dois ou três documentos e some. Falta motivo pra abrir o app
**toda semana**. O Diário de Obra é exatamente esse motivo — todo integrador faz obra, toda
obra dura dias, e hoje ele já tira essas fotos no celular e elas morrem na galeria.

E tem um segundo efeito, mais raro: é a **única** feature do SolarDoc cujo resultado o
cliente publica em praça pública. Cada obra vira um post no feed dele e um link que ele
manda no WhatsApp do dono da casa. O rodapé "gerado pela SolarDoc" no link público
(mesmo padrão do `/v/` e `/p/`) roda de graça no meio do público certo.

> Regra de marca: o **criativo** leva a logo do integrador (`company.logo_base64`), nunca a
> nossa — ninguém posta no próprio feed com marca de fornecedor. A marca SolarDoc fica só no
> rodapé do link público. No plano free, um selinho "feito com SolarDoc" opcional (opt-in
> com desconto/bônus) é aceitável.

---

## 2. A decisão que precisa da sua confirmação

**"Material editado e pronto pra postar" tem duas leituras: imagem ou vídeo.**

Este desenho entrega **imagem** na Fase 1 (carrossel de feed + story + legenda pronta) e
deixa **reels/vídeo pra Fase 3**. Motivo: a API já renderiza HTML → PNG em produção
(`api/src/services/agenda/criativoCompositor.ts` faz criativo 1080×1920 com Puppeteer +
`@sparticuz/chromium-min` e sobe no Storage) — isso é reaproveitamento direto, custo quase
zero. Vídeo montado não tem nada no stack do SolarDoc: exige ffmpeg/Remotion, tempo de
render que não cabe na função, e storage de outra ordem.

Se na sua cabeça "editado" era **vídeo desde o começo**, me fala agora — muda a espinha do
projeto (fila de render, provavelmente processo fora da Vercel) e é melhor saber antes.

---

## 3. Como o integrador usa (o fluxo)

**Antes de subir no telhado** — abre `/diario`, escolhe o cliente (mesmo seletor da Vistoria:
cliente cadastrado / cadastrar na hora / só o nome) e preenche 5 campos que alimentam tanto o
relatório quanto os textos do post:

| Campo | Serve pra |
|---|---|
| Potência (kWp) | número do criativo, "Sistema de 8,4 kWp entregue" |
| Nº de módulos | número do criativo |
| Marca do módulo / inversor | legenda, e o integrador gosta de mostrar |
| Cidade / bairro | prova social local ("mais uma em Uberlândia") + hashtag |
| Economia estimada (R$/mês) | o gancho que mais converte |

**Durante a obra** — mesma mecânica da Vistoria, porém organizada em **etapas**, não em
checklist fixo de documento. Cada etapa abre a câmera, aceita várias mídias e sobe **na hora**.
Cada mídia guarda o horário, então o diário se monta sozinho em ordem cronológica e agrupado
por dia (é isso que faz dele um *diário* e não uma pasta).

**Etapas padrão** (editáveis; `key` estável pro Storage, igual `CHECKLIST_VISTORIA`):

1. `antes` — Fachada / telhado antes ⚑ *foto-âncora do antes e depois*
2. `chegada_material` — Kit chegando, caixas, equipe descarregando
3. `estrutura` — Perfis e fixação no telhado
4. `modulos` — Módulos sendo montados
5. `inversor` — Inversor instalado na parede
6. `eletrica` — String box, quadro CA, aterramento
7. `comissionamento` — Sistema ligado, app do inversor gerando
8. `depois` — Fachada / telhado pronto ⚑ *par do antes*
9. `entrega` — Cliente com a equipe / depoimento em vídeo
10. `bastidores` — Livre: equipe, detalhe, o que der post

Em cada mídia, um toque marca **⭐ destaque** — é isso que entra no criativo. Sem IA, sem
espera, sem custo. (A seleção automática por visão da Claude vira Fase 2; já existe
precedente no projeto — `/clients/scan` e `/clients/scan-documento` leem documento por visão.)

**No fim** — botão **Concluir**, e a tela final oferece três saídas:

1. **Link do diário** (`/o/:id`) — manda no WhatsApp do cliente
2. **Baixar arquivos** (`/o/:id/arquivos.zip`) — tudo nomeado e ordenado
3. **Gerar post** — escolhe o formato, revisa, baixa/compartilha

---

## 4. O que sai da obra

### 4.1 O diário público — `/o/:id`

Página HTML servida pela API sem auth, mesmo molde do `publicVistoria.ts`: signed URL
gerada fresca a cada abertura (o banco guarda **caminho**, nunca URL que expira).
Diferenças pro relatório de vistoria: linha do tempo agrupada por dia, cabeçalho com os
dados do sistema, e o par **antes/depois** em destaque no topo.

Esse link é um ativo de venda: o dono da casa recebe uma página bonita com a obra dele
documentada dia a dia. É o que faz o integrador parecer grande — e é o gancho natural pra
pedir indicação e depoimento.

### 4.2 Os arquivos — `/o/:id/arquivos.zip`

Mesmo ZIP do `/v/:id/fotos.zip`: nomes prefixados pela ordem da etapa
(`01-antes-1.jpg`, `07-comissionamento-2.jpg`), sem acento, ordenáveis. É o "ele conseguir
ter os arquivos dessa obra" do seu pedido.

Além disso, ao concluir, as peças que importam ficam **arquivadas no cliente** (mesmo caminho
que a Vistoria já usa: `POST /clients/:id/documento`) — quem abre o cliente meses depois acha
a obra, não só a proposta.

### 4.3 O Kit de Post (o coração da ideia)

A partir das mídias marcadas ⭐ + os dados da obra, o módulo monta:

| Formato | Saída | Onde posta |
|---|---|---|
| **Antes e Depois** | 1 imagem 1080×1350 dividida, com selo de potência | Feed |
| **Obra Entregue** | Carrossel de 4–6 slides 1080×1350 (capa com número + etapas + fechamento com CTA) | Feed |
| **Story da Obra** | 3–5 telas 1080×1920 com barra de progresso | Stories |
| **Números da Obra** | 1 card com kWp / módulos / economia / cidade | Feed |

Cada formato sai com **legenda pronta + hashtags + CTA**, escrita pela Claude Haiku (mesmo
modelo já usado no agente Sol, custo irrisório) a partir dos dados da obra, da cidade e de um
tom escolhido pelo integrador (*Técnico / Orgulho da equipe / Vendedor*). O texto é editável
antes de sair — nunca copia-e-cola cego.

**Motor de render:** HTML → PNG por Puppeteer, exatamente o padrão do `criativoCompositor.ts`.
Templates são funções que devolvem HTML com as fotos por signed URL, a logo do integrador e
tipografia grande. Dois cuidados que o desenho já assume:

- **Um único launch do Chromium por kit**, com N `setContent` + `screenshot` dentro dele.
  Seis slides não podem ser seis launches — `pdfController.ts` já tem `launchWithRetry`, o que
  diz que abrir o Chromium falha de vez em quando.
- **Render assíncrono, com status.** `pendente | gerando | pronto | erro` (mesma máquina de
  estados que o `social_studio` já usa), UI faz polling. Nada de segurar o botão esperando o
  Chromium.

**Entrega do arquivo pro celular:** botão "Baixar todas" (ZIP ou uma a uma) + atalho "Abrir
Instagram". Vale registrar sem promessa: `navigator.share` com **vários arquivos** é
inconsistente entre navegadores e o Instagram nem sempre aparece como destino. Usa quando
existe, cai no download quando não existe — mas o texto da UI não promete "postar em um toque".

---

## 5. Arquitetura

### 5.1 O que copia da Vistoria (e por quê)

O cabeçalho do `api/src/routes/vistorias.ts` (linhas 8–20) já é a especificação certa —
técnico no telhado, sinal ruim. Tudo isso vale igual aqui:

- **Sobe na hora.** Cada mídia vai pro servidor no momento em que é tirada. Se a conexão cai,
  perde uma foto, não a obra. Estado incremental no servidor, nunca "salvar no fim".
- **Append atômico por RPC.** Dois uploads simultâneos não podem se sobrescrever.
- **jsonb guarda caminho, nunca URL assinada.** Signed URL só na hora de exibir
  (`withSignedUrls`).
- **Não abate cota de documento.** É ferramenta de campo, igual Vistoria/Precificação/
  Inventário. A cota só entra na hora de gerar post (§7).
- **Telemetria** via `/feature-events` com `feature: 'diario'`.

⚠️ **Achado:** as RPCs da Vistoria (`vistoria_add_foto`, `vistoria_remove_foto`,
`vistoria_patch_item`) **não estão em nenhum `.sql` do repositório** — foram aplicadas direto
no Supabase. As três novas do Diário nascem versionadas em `MIGRATION_diario_obra.sql`, e vale
resgatar as da vistoria no mesmo arquivo enquanto a memória do que foi feito ainda existe.

### 5.2 O que muda: vídeo não passa pela API

`vistorias.ts:238` rejeita buffer acima de ~9MB — o upload viaja como base64 no corpo do JSON,
o que serve pra foto comprimida e **não serve pra vídeo**. Um depoimento de 20 segundos passa
disso fácil.

Decisão: **vídeo sobe direto do navegador pro Storage** via `createSignedUploadUrl` do
Supabase. A API só assina a URL e, depois, registra o caminho no jsonb. Foto continua no
caminho atual (comprimida no cliente pra 1568px/JPEG 0.82, igual hoje). Limites propostos:
vídeo até **60s e ~50MB**, contado no plano.

### 5.3 Dados

```
obras
  id uuid pk, user_id uuid, cliente_id uuid null, cliente_nome text
  codigo_curto varchar(12)          -- YYYYNNNN, escopo user-ano (igual vistorias)
  cidade text, endereco text
  potencia_kwp numeric, n_modulos int, marca_modulo text, marca_inversor text
  economia_mes numeric
  status varchar(20)                -- em_andamento | concluida
  etapas jsonb                      -- [{key,label,dica,obs,midias:[...]}]
  created_at, updated_at

  midia := { url, ts, tipo: image|video|file, nome?, destaque: bool }

obra_posts
  id uuid pk, obra_id uuid, user_id uuid
  formato text                      -- antes_depois | carrossel | story | numeros
  tom text                          -- tecnico | orgulho | vendedor
  slides jsonb                      -- [{url, ordem}]   (caminhos, não signed)
  legenda text, hashtags text
  status text                       -- pendente | gerando | pronto | erro
  erro text null
  created_at
```

RPCs novas, espelhando as da vistoria: `obra_add_midia`, `obra_remove_midia`,
`obra_patch_etapa`.
Storage: bucket `documentos` (o mesmo), pastas `obras/<user>/<obra>/` e
`obras/<user>/<obra>/posts/`.

### 5.4 Rotas

```
POST   /obras                       cria (cliente_id ou nome) + dados do sistema
GET    /obras/list                  lista do usuário (com contadores)
GET    /obras/clientes              seletor agrupado  (reusa o de vistorias)
GET    /obras/:id                   detalhe com signed urls
PATCH  /obras/:id                   edita dados do sistema
POST   /obras/:id/midia             foto (base64, igual vistoria)
POST   /obras/:id/upload-url        assina upload direto (vídeo)
POST   /obras/:id/midia/confirmar   registra o caminho do vídeo já enviado
DELETE /obras/:id/midia             remove uma mídia
PATCH  /obras/:id/etapa             observação da etapa / marca destaque
POST   /obras/:id/concluir

POST   /obras/:id/post              enfileira um kit  → devolve post_id
GET    /obras/:id/post/:pid         status + slides + legenda (polling)
PATCH  /obras/:id/post/:pid         edita a legenda antes de postar
GET    /obras/posts                 galeria "Meus Posts"

GET    /o/:id                       diário público (sem auth)
GET    /o/:id/arquivos.zip          ZIP de tudo
```

Registro em `api/src/app.ts`: `app.use('/obras', ...)` e `app.use('/o', ...)` — mesmo par que
`/vistorias` + `/v`.

### 5.5 Front

- `dashboard/src/app/(dashboard)/diario/page.tsx` + `diario.css`, no molde do
  `vistoria/page.tsx` (upload otimista, lightbox, compressão em canvas — dá pra extrair
  `compress()` e `readAsDataUrl()` pra um helper compartilhado em vez de duplicar).
- Item no `topoItems` do `Sidebar.tsx`, colado na Vistoria Solar, **sem `requireCompany`**
  (ícone sugerido: `HardHat` ou `CalendarDays`).
- `dashboard/AGENTS.md` manda ler `node_modules/next/dist/docs/` antes de codar — é Next 16.2.2,
  não presuma API antiga.
- O `sw.js` do SolarDoc é carimbado sozinho no build (`prebuild: stamp-sw.mjs`, só na Vercel) —
  aqui **não** existe a regra de bump manual de versão que o /gerador tem.

---

## 6. Autorização de uso de imagem (não é apêndice)

Rosto do cliente, casa do cliente, publicado em rede social. Isso é direito de imagem + LGPD,
e é onde um integrador se queima. Só que o SolarDoc **é uma fábrica de documento** — então a
resposta é a coisa que a plataforma já sabe fazer:

- Novo tipo de documento **"Autorização de Uso de Imagem"** (cliente e/ou empresa), gerado com
  os dados que já estão no cadastro.
- No link público `/o/:id`, um **aceite do cliente** com um toque ("autorizo o uso das imagens
  desta obra"), com data/hora e IP registrados. É a via prática — ninguém imprime nada.
- Na tela de gerar post, se a obra não tem autorização registrada, aparece um aviso
  (não bloqueia: avisa e oferece o link de aceite).
- Regra de ouro na UI: **rosto de terceiro e placa de veículo** — sugerir corte/borrão. Blur
  automático fica pra depois.

Isso vira argumento de venda, não burocracia: "o único que já entrega a autorização junto".

---

## 7. Planos

Convenção do próprio projeto (`Sidebar.tsx:88-90`): a navegação é livre, o **gate é no
generate**. Aplicado aqui:

| | Capturar obra | Link + ZIP | Kits de post / mês |
|---|---|---|---|
| `free` | livre | sim | 1 (com selo opcional) |
| `pro` | livre | sim | 8 |
| `ilimitado` (VIP) | livre | sim | ilimitado + vídeo/reels quando existir |

O hábito é grátis de propósito — o hábito é o que segura o cancelamento de 12 dias. O que
custa dinheiro de verdade (Chromium + Claude) é o que tem contador. Contagem separada da cota
de documentos, para não competir com a proposta.

Retenção de arquivos: espelhar a lógica que o cron `cleanup-pro-docs` já usa por plano — com
vídeo entrando, storage vira custo real e não pode crescer solto.

---

## 8. Fases

**Fase 1 — o Diário funciona (~1 semana)**
Migration + rotas + tela de campo por etapas + concluir + `/o/:id` + ZIP + arquivar no cliente.
Kit de post com **2 templates** (Antes e Depois + Números) e legenda por IA. Render assíncrono
com status. Já é entregável sozinho.

**Fase 2 — o conteúdo fica bom (~1 semana)**
Carrossel de 4–6 slides, Story, escolha de tom, galeria "Meus Posts", seleção sugerida por
visão da Claude, autorização de uso de imagem, referência visual da foto "antes" ao lado do
botão da câmera na etapa "depois".

**Fase 3 — vídeo e publicação (escopo próprio)**
Reels montado (fila de render fora da Vercel) e publicação/agendamento direto no Instagram.
Atenção: o `instagram.ts` que existe hoje é da conta **da Irmãos na Obra** (comentário → DM) e
**não** se reaproveita — publicar pelo integrador exige OAuth por conta, perfil Business e
revisão de app na Meta. Nada disso está meio-pronto.

---

## 9. Riscos, ditos na cara

1. **Foto ruim entra, post ruim sai.** Mitigação barata: dica visual por etapa (igual as `dica`
   da vistoria) + marcação ⭐ manual. Nenhum template salva foto tremida.
2. **Chromium na Vercel é instável.** Já dói no PDF. Por isso: um launch por kit, retry,
   status de erro visível e a possibilidade de regerar sem perder a obra.
3. **Tempo do integrador em obra.** Se custar mais de ~30 segundos por etapa, ele não usa.
   A tela precisa ser botão grande, câmera na hora, zero campo obrigatório além do primeiro.
4. **Storage com vídeo.** Cresce rápido e não tem teto natural. Precisa de política de
   retenção por plano desde o primeiro dia, não depois.
5. **Escopo.** Fase 1 fecha um ciclo inteiro sozinha. Se você quiser reels, é bom decidir isso
   antes da Fase 2, porque muda onde o render mora.

---

## 10. Checklist de implementação

- [ ] `MIGRATION_diario_obra.sql` — tabelas `obras` e `obra_posts` + RPCs `obra_add_midia`,
      `obra_remove_midia`, `obra_patch_etapa` (+ resgatar as três da vistoria)
- [ ] `api/src/routes/obras.ts` — rotas autenticadas
- [ ] `api/src/routes/publicObra.ts` — `/o/:id` e `/o/:id/arquivos.zip`
- [ ] `api/src/services/obraCompositor.ts` — templates HTML → PNG (1 launch por kit)
- [ ] `api/src/services/obraCopy.ts` — legenda/hashtags via Claude Haiku
- [ ] `api/src/app.ts` — registrar `/obras` e `/o`
- [ ] `dashboard/src/app/(dashboard)/diario/` — `page.tsx` + `diario.css`
- [ ] `dashboard/src/components/Sidebar/Sidebar.tsx` — item em `topoItems`
- [ ] Helper compartilhado de compressão de imagem (hoje duplicado na vistoria)
- [ ] Contador de kits por plano + retenção de mídia no cron
