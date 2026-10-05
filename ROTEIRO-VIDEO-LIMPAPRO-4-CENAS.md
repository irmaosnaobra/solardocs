# 🎬 LIMPAPRO — VÍDEO DE 4 CENAS (hook · body · CTA)

> **Feito pra não queimar crédito.** Cada cena funciona nos dois cenários: se o nano banana te entregar **imagem**, você anima depois; se te entregar **vídeo**, o mesmo bloco serve.
> **Nenhuma cena tem boca falando.** A voz entra por cima, gravada separada (pode ser a sua). Isso mata três riscos de uma vez: modelo que não fala português direito, lip-sync torto, e depoimento falso de gente que não existe.
> **Formato:** **16:9 horizontal** (definido pelo Thiago em 31/07) · **6 clipes de 8s = 48s** · destino `https://limpapro.solardoc.app/`
> **Ordem de geração: PASSO 1 → 2 → 3 → 4 → 5 → 6.** Ordem de montagem: 3 → 4 → 1 → 6 → 5 → 2 (tabela no fim).
> ⚠️ **Nota de mídia:** 16:9 no Feed do celular aparece pequeno e em Stories/Reels o Meta encaixa numa tarja no meio da tela. Se um dia for rodar nesses posicionamentos, gere de novo em 9:16 — cortar o 16:9 não recupera a área perdida. Os prompts já pedem a ação centralizada, então um corte quadrado (1:1) ainda funciona; 9:16 não.

---

## 📐 REGRAS QUE VALEM PRA TODAS AS CENAS

1. **Nunca peça texto na imagem.** O modelo escreve português errado. Todo texto entra no CapCut (lista pronta no fim).
2. **Rosto nunca aparece nítido** — boné + óculos escuros, câmera por trás/de lado. É o que garante que os 4 clipes pareçam a mesma pessoa, o mesmo dia, o mesmo telhado.
3. **16:9 sempre**, nos quatro clipes. Não misture formato entre clipes.
4. **Texto na tela:** em 16:9 pode ir na parte de baixo, com margem. Só aumente bem o corpo da fonte — quadro deitado no celular fica pequeno e legenda fina some.
5. **Gere na ordem 3 → 4 → 1 → 2** (a cena 3 é a que define uniforme, telhado e luz; as outras copiam dela). A ordem de montagem continua 1 → 2 → 3 → 4. Sequência pronta pra colar no fim deste arquivo.
6. **Ferramenta escolhida: Gemini "Criar vídeos" (Veo/Omni), modelo Pro, Paisagem 16:9.** Não tem campo de negativo — por isso cada bloco já leva `AUDIO:` e `IMPORTANT:` no fim. O `AUDIO:` é obrigatório: sem ele o modelo inventa música e gente falando em inglês por cima da sua locução. **A fala NÃO sai do Veo:** gerado clipe a clipe, ele inventaria uma voz diferente em cada um. A locução é gravada por fora, num take só.

---

## 🎨 BÍBLIA VISUAL — copie e cole DENTRO de cada prompt (ela já está nos 4 blocos abaixo)

```
STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```

**NEGATIVE PROMPT (cole no campo de negativo, ou no fim do prompt):**
```
no text, no letters, no numbers, no watermark, no logo, no captions, no subtitles,
no visible face close-up, no open mouth, no talking, no distorted hands, no extra fingers,
no cartoon, no illustration, no 3D render, no anime, no oversaturated colors, no lens flare
```

---

# CENA 1 — HOOK (0–8s) · “o dinheiro que tá vazando”

**Objetivo:** parar o dedo em 1 segundo com um contraste visual que não precisa de explicação.

### 🖼️ PROMPT (imagem / vídeo)
```
Extreme close-up, macro, of the surface of a solar panel completely covered in thick gray dust,
dried pollen and white bird droppings. A gloved hand drags a soft white brush across the glass
from left to right, revealing one perfectly clean mirror-like stripe that reflects the blue sky
and the sun. Half the frame is filthy, half is spotless — the contrast is the subject. Water
droplets sparkle on the clean stripe.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```

### 🎥 MOVIMENTO (se for animar a imagem)
```
Slow push-in on the panel while the gloved hand drags the brush left to right, uncovering the clean
stripe. The camera holds on the dirty/clean split at the end. Subtle dust particles floating in the
sunlight. No camera shake, no cuts.
```

### 🎙️ LOCUÇÃO — 17 palavras (~6s)
> **“Olha isso. Todo dia que esse painel fica assim, o dono perde dinheiro — e nem desconfia.”**

*Tom: baixo, quase cochichando pra câmera, como quem mostra um segredo. Não é locutor de rádio.*

### 🔤 Texto na tela (CapCut)
`PAINEL SUJO = CONTA MAIS CARA`

---

# CENA 2 — O MERCADO (8–16s) · “tem gente demais precisando e ninguém fazendo”

**Objetivo:** transformar um painel sujo em milhares de painéis sujos. É aqui que vira oportunidade.

### 🖼️ PROMPT (imagem / vídeo)
```
High aerial drone view rising over a Brazilian suburban neighborhood at mid-morning. Dozens of
modest houses with terracotta roofs, and on almost every roof there are solar panels — all of them
visibly dull, gray and dusty under the strong sun, none of them shining. Streets, mango trees and
water tanks between the houses. The scale of the neighborhood is the subject: panels everywhere,
nobody working on them.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```

### 🎥 MOVIMENTO
```
Slow drone ascent and pull-back, revealing more and more rooftops with dusty solar panels toward
the horizon. Steady, smooth, cinematic. No cuts.
```

### 🎙️ LOCUÇÃO — 20 palavras (~7,5s)
> **“São milhões de painéis no Brasil e quase ninguém limpa. Ninguém sobe no telhado, e lavar errado queima a garantia.”**

*Tom: constatação. Sem empolgação ainda — você tá só apresentando o buraco no mercado.*

### 🔤 Texto na tela
`MILHÕES DE PAINÉIS` → (troca em 4s) → `QUASE NINGUÉM LIMPA`

---

# CENA 3 — O SERVIÇO E A RECORRÊNCIA (16–24s) · “o body”

**Objetivo:** mostrar que o trabalho é simples, limpo e profissional — e plantar a recorrência (é ela que faz o cara comprar).

### 🖼️ PROMPT (imagem / vídeo)
```
Wide-to-medium shot from behind and slightly to the side: the technician stands safely on the
rooftop, seen from the back, gliding a telescopic pole with a soft white brush across a long row of
solar panels. Clean water sheets off the glass in a thin curtain, catching the sunlight. Behind the
brush the panels turn deep mirror-blue and reflect the sky; ahead of the brush they are still gray
and dusty. A simple bucket and a coiled blue hose rest on the tiles beside him. His face is not
visible — only his back, the cap and the gloves.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```

### 🎥 MOVIMENTO
```
Smooth lateral tracking shot following the brush as it glides along the row of panels, water
sheeting off the glass. The dirty-to-clean line advances across the frame. Ends holding on a fully
clean row mirroring the blue sky. No camera shake, no cuts.
```

### 🎙️ LOCUÇÃO — 22 palavras (~8s)
> **“Com a técnica certa, são duzentos a oitocentos por serviço. E suja de novo: o mesmo cliente volta a cada poucos meses.”**

*Tom: sobe aqui. É a virada — de problema pra dinheiro. Pause meio segundo antes de “E suja de novo”.*
*Se o seu gerador travar o clipe em 8s exatos, tire o “mesmo”: fica 21 palavras.*

### 🔤 Texto na tela (16:9 — pode ir embaixo com margem, fonte grande)
`R$ 200 a R$ 800 POR SERVIÇO` → (troca em 4s) → `EQUIPAMENTO: MENOS DE R$ 700`

---

# CENA 4 — CTA (24–32s) · “o fecho”

**Objetivo:** fechar com o cliente satisfeito (prova do resultado) e mandar pro link. Frame limpo embaixo pro botão/CTA.

### 🖼️ PROMPT (imagem / vídeo)
```
Ground-level shot in front of a modest Brazilian house at late morning. The technician, seen from
behind and slightly to the side, shakes hands with the homeowner at the front gate; neither face is
clearly visible — the technician's back and cap fill the left of the frame, the homeowner is shown
from the shoulders down holding a phone. Above them, on the roof, the freshly cleaned solar panels
shine deep mirror-blue, reflecting the sky. The telescopic pole and bucket rest against the wall.
Calm, satisfied, everyday-work atmosphere. The house and its roof fill the left and center of the
frame; the handshake anchors the right side.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```

### 🎥 MOVIMENTO
```
Slow dolly backward, widening from the handshake to reveal the whole front of the house with the
clean solar panels shining on the roof. Very gentle, cinematic. No cuts.
```

### 🎙️ LOCUÇÃO — 21 palavras (~7,8s)
> **“Sem faculdade e sem experiência. O Limpa Solar Pro te ensina tudo por quarenta e sete reais. Toque em Saiba mais.”**

*Tom: direto, sem pressa, sem gritar. Frase final pausada.*

### 🔤 Texto na tela (16:9 — pode ir embaixo com margem, fonte grande)
`COMECE POR R$ 47` + `7 DIAS DE GARANTIA` + `PODE SER O FIM DO SEU CLT` + `TOQUE EM SABER MAIS`
*(sem seta: o botão do Meta cai em lugar diferente no Feed, no Stories e no Reels — a seta apontaria pro nada.)*

---

## 🎙️ LOCUÇÃO — **VERSÃO FINAL, é esta que se grava** (31/07, sobre a base escrita pelo Thiago)

Barras `//` = pausa. **Negrito** = pesa a voz.

| Clipe | Fala | Tempo |
|---|---|---|
| 1 · painel sujo | Ninguém tá falando sobre isso. // Olha o tanto de sujeira nesse painel. // O dono **tá perdendo dinheiro** e nem desconfia. | 7,4s |
| 2 · bairro de cima | São **milhões** de painéis no Brasil… e quase nenhuma empresa faz isso. // Tem **dinheiro na mesa** na sua cidade. | 7,4s |
| 3 · limpeza lateral | É trabalho braçal, mas é simples. // Quem não tem preguiça de subir no telhado **sai na frente**. | 6,3s |
| 4 · em ação | Não precisa de máquina cara: uma haste, uma escova e água. // Quem sabe a técnica cobra de **duzentos a oitocentos** por serviço. | 8,1s |
| 5 · Pix | Terminou, o cliente te paga na hora **e paga bem**. // Daqui uns meses suja e ele te chama outra vez. // Trabalho que se repete. | 7,8s |
| 6 · aperto de mão | Sem faculdade, sem experiência. // O Limpa Solar Pro te ensina a técnica e quanto cobrar. // **Quarenta e sete reais**. Toca em Saiba mais. | 8,1s |

**122 palavras ≈ 45s** num corte de 48s.

**Corrido, pra gravar num take só:**
> Ninguém tá falando sobre isso. Olha o tanto de sujeira nesse painel. O dono tá perdendo dinheiro e nem desconfia.
>
> São milhões de painéis no Brasil… e quase nenhuma empresa faz isso. Tem dinheiro na mesa na sua cidade.
>
> É trabalho braçal, mas é simples. Quem não tem preguiça de subir no telhado sai na frente.
>
> Não precisa de máquina cara: uma haste, uma escova e água. Quem sabe a técnica cobra de duzentos a oitocentos por serviço.
>
> Terminou, o cliente te paga na hora e paga bem. Daqui uns meses suja e ele te chama outra vez. Trabalho que se repete.
>
> Sem faculdade, sem experiência. O Limpa Solar Pro te ensina a técnica e quanto cobrar. Quarenta e sete reais. Toca em Saiba mais.

**Versão curta (40s, sem o clipe "em ação"):** junte as falas 3 e 4 numa só — *"É trabalho braçal — quem não tem preguiça sai na frente. Quem sabe a técnica cobra de duzentos a oitocentos por serviço."*

### 🚫 O que NÃO pode voltar pra essa narração (e por quê)

| Frase tentadora | Problema | Substituta |
|---|---|---|
| "temos grupo fechado pra nossa comunidade" | A comunidade é o OB **Rede +Sol R$57** — não entra no R$47. Comprador paga e bate no cadeado (mesmo erro dos 3 bônus). Só volta se a comunidade for incluída no produto de R$47. | (cortar) |
| "não tem empresas pra essa demanda" | Tem: Clean Limpeza Solar-MG, WSH-BH, Evosolar, limpezasolar.com — várias vendem curso igual. Frase absoluta se desmente num comentário. | "quase nenhuma empresa faz isso" |
| "se você não tem preguiça, vai ter muito resultado" | Promessa de renda em troca de esforço — derruba criativo no Meta e vira reembolso. | "quem não tem preguiça sai na frente" (ainda filtra, e se sustenta) |
| "seus vizinhos e sua cidade implorando" | Hipérbole que o público desconta. | "tem dinheiro na mesa na sua cidade" |
| "O LimpaPro" | Nome do domínio. No checkout Kiwify ele lê **Limpa Solar Pro** — nome diferente no anúncio e no pagamento gera desistência. | "Limpa Solar Pro" |

**Como gravar:** não leia, conte. Fale como se fosse pra uma pessoa só. Deixe a respiração — cortar todo o ar entre frases é o que mais rouba naturalidade. Grave 3 takes seguidos e use o terceiro (o 1º sai tenso, o 2º certinho demais, o 3º sai você). Celular no gravador padrão, um palmo da boca, quarto com cama e roupa (pano mata eco). Sem microfone mesmo.
**Se for voz sintética:** ElevenLabs, voz masculina brasileira, estabilidade ~40%, speaker boost ligado; mantenha as reticências e as barras, elas viram pausa.

---

## 🎙️ LOCUÇÃO — versão anterior (mais formal, SUPERADA pela versão final acima)

> Olha isso. Todo dia que esse painel fica assim, o dono perde dinheiro — e nem desconfia.
>
> São milhões de painéis no Brasil e quase ninguém limpa. Ninguém sobe no telhado, e lavar errado queima a garantia.
>
> Com a técnica certa, um serviço desse sai de duzentos a oitocentos reais.
>
> Pix na hora, no fim do serviço. E o painel suja de novo: o mesmo cliente te chama a cada poucos meses.
>
> Sem faculdade e sem experiência. O Limpa Solar Pro te ensina tudo por quarenta e sete reais. Toque em Saiba mais.

**93 palavras ≈ 34,5s** — cabe nos 40s com respiro. Se você acelerar, o anúncio perde. Deixe as pausas.

---

## 🏷️ HEADLINE DO VÍDEO (texto sobre os 2 primeiros segundos)

Existe porque **a maioria vê no mudo** — sem ela, no mudo o vídeo não tem hook.

### AS DUAS QUE VÃO AO AR (decidido 31/07)

| # | Headline | Mecanismo |
|---|---|---|
| **A** | `R$ 200 A R$ 800 PRA LIMPAR UM TELHADO` | Número seco + a atividade. Entrega a novidade que ninguém sabe. |
| **B** | `LIMPAR PAINEL SOLAR PODE SER O FIM DO SEU CLT` | Identidade + mecanismo. Emoção do Thiago, mas nomeando o serviço. |

Rodam **mecanismos opostos** de propósito — número contra identidade. Duas headlines do mesmo tipo ganham uma e não ensinam nada.

**Como rodar:** mesmo vídeo, duas versões, mudando **só os 2 primeiros segundos**. Mesmo conjunto, deixa o Meta dividir. Julga por CTR e retenção aos 3s, não por venda (amostra demora demais). **Para em duas** — os 4 campeões já estão rodando; somar 4 variantes pulveriza, que é o erro que matou a BM 1.

### FECHAMENTO — sobre o clipe do aperto de mão
Junto com `R$ 47` e `7 DIAS DE GARANTIA`, entra:
```
PODE SER O FIM DO SEU CLT
```
Aqui a frase funciona sozinha (sem "limpar painel solar") porque o cara já viu o serviço, o Pix e o preço — deixa de ser promessa e vira conclusão. **Abertura é novidade; fechamento é identidade.**

### DESCARTADAS, e por quê
| Headline | Problema |
|---|---|
| `MILHÕES DE PAINÉIS. QUASE NINGUÉM LIMPA.` | Boa, mas perdeu a vaga pra B. Fica no banco se A ou B cansarem. |
| `A PROFISSÃO QUE NINGUÉM TÁ VENDO` | Curiosidade sem substância, e repete a 1ª frase da narração — no mudo não informa, no som é eco. |
| `SEU VIZINHO TÁ PAGANDO POR ISSO` | Pressupõe que o vizinho tem painel; pra maioria é falso e vira genérica. Deixa "pagando pelo quê?" no ar. |
| `PODE SER O FIM DO SEU CLT` (sozinha, na abertura) | É a headline mais usada do infoproduto BR — liga o escudo de desconfiança antes de mostrar a novidade. Só serve no fechamento. |

**Regras:** já no primeiro frame (sem fade — fade come metade do único segundo que você tem) · sai em 2–3s · **não repete a narração** (texto e voz dizem coisas diferentes) · uma linha, no máximo duas · caixa alta, fonte grossa, contorno preto · **≠ do campo "Título" do anúncio** (lá vai a oferta `Comece por R$ 47`, aqui vai a oportunidade).

**Teste:** assista no seu próprio celular, com o braço esticado. Se você não ler, ninguém lê.

🚫 `R$ 5.000 POR MÊS` fica de fora, mesmo estando na landing. Lá vem cercada de contexto; sozinha em texto grande sobre vídeo, é o formato de promessa de renda que o Meta reprova.

## 🎧 ÁUDIO E MONTAGEM

- **Trilha:** batida seca, sem melodia, volume baixo (–18 dB). A voz manda.
- **Som ambiente:** água caindo no vidro na cena 3 — é o som que vende o serviço. Deixe audível.
- **Cortes:** corte seco entre as cenas, no ritmo da fala. Sem transição, sem fade.
- **Legenda queimada:** obrigatória (a maioria assiste no mudo). Fonte grossa, branca com contorno preto, palavra a palavra. Em 16:9 pode ficar na parte de baixo, com margem — só **aumente bem o corpo da fonte**, que quadro deitado no celular fica pequeno.
- **Primeiro frame:** tem que ser o painel sujo em close. Nunca comece com céu ou logo.

---

## 📝 COPY DO ANÚNCIO (pra colar no Gerenciador)

**Título:** `Comece por R$ 47`
**CTA:** `Saiba mais` · **Destino:** `https://limpapro.solardoc.app/` · **Descrição do link:** `⭐⭐⭐⭐⭐ (4.9/5)`

**Texto principal:**
```
Tem milhões de painéis solares instalados no Brasil… e quase ninguém limpa. 👀

Painel sujo gera menos energia todo dia — e o dono, que pagou caro no sistema, tá perdendo dinheiro sem perceber. Ele quer resolver. Só não acha quem faça.

É aí que mora a oportunidade: quem tem a técnica cobra de R$ 200 a R$ 800 por serviço. E a placa suja de novo a cada poucos meses — então não é bico de uma vez só, é cliente que volta o ano todo. ♻️

✅ Sem faculdade
✅ Sem experiência
✅ Sem loja nem estoque
✅ Menos de R$ 700 de equipamento — a primeira limpeza já cobre

No Limpa Solar Pro você aprende do zero: a técnica que não arranha o vidro nem queima a garantia, quanto cobrar em cada serviço e como fechar os primeiros clientes na sua região.

Tudo por R$ 47. E o risco é nosso: 7 dias de garantia — não gostou, devolvemos cada centavo.

👉 Toque em Saiba mais e comece hoje.
```

---

## ➕ CENA EXTRA (OPCIONAL — só gere se sobrar crédito)

O corte de 4 clipes **fecha sozinho**. Esta entra entre a 3 e a 4 se você quiser reforçar “isso é negócio, não bico”:

### 🖼️ PROMPT
```
Close-up of the open trunk of a simple popular car parked on a residential street in Brazil, with
the cleaning equipment neatly organized inside: a telescopic pole, a soft white brush, a coiled blue
hose, a bucket and a water container. A gloved hand lifts the pole out of the trunk. The clean solar
panels of the house shine on the roof in the blurred background.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles,
rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and
simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight,
high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and
gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush
and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of
field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action
composed in the central area so the shot still reads if cropped square. Keep the lower area of the
frame uncluttered.
```
**Movimento:** `Slow push-in toward the trunk as the gloved hand lifts the telescopic pole out. Steady, no cuts.`

**Locução (16 palavras, ~6s)** — entra ANTES da cena 4:
> **“O equipamento inteiro cabe no porta-malas. Menos de setecentos reais, e a primeira limpeza já cobre.”**

Se usar esta cena, **tire** o texto `EQUIPAMENTO: MENOS DE R$ 700` da cena 3 (vira redundância) e o vídeo passa a ter 40s.

---

## ✅ CHECKLIST ANTES DE ACEITAR CADA CLIPE (economiza regeração)

- [ ] Aparece rosto nítido ou boca falando? → **regerar** (quebra a consistência entre os clipes)
- [ ] Tem letra/número escrito na imagem? → **regerar** (vai sair em português errado)
- [ ] Mão com dedo a mais / escova derretida? → **regerar**
- [ ] O terço inferior tá poluído? → **regerar** (a legenda não cabe)
- [ ] Céu, telhado e uniforme batem com os outros clipes? → se não, regerar **só o clipe divergente**
- [ ] Cena 1: dá pra ver a sujeira ANTES e o vidro limpo DEPOIS no mesmo frame? Se não dá, o hook morreu.

---

## ⚠️ DUAS COISAS QUE EU NÃO COLOQUEI DE PROPÓSITO

1. **“Fature até R$ 5.000 por mês”** — está na sua landing, mas em vídeo de anúncio promessa de renda em número fechado é o que mais derruba criativo no Meta. O vídeo entrega o preço por serviço (R$ 200–800, que é verificável) e a página faz a promessa maior.
2. **Os 3 bônus** — o checkout de **R$ 47 (Essencial) não entrega os bônus**; só o Completo R$ 77 e o popup R$ 60. Por isso o vídeo e a copy falam “R$ 47” sem citar bônus. Se alguém colocar “R$ 47 com os 3 bônus” no anúncio, o comprador paga e bate no cadeado.

## 🧨 COMO SUBIR ESTE CRIATIVO

Este é um anúncio **novo** — sobe com zero curtida e zero comentário. O plano do `CAMPANHA-LIMPAPRO-PRONTA.md` usa “Publicação existente” justamente pra herdar a prova social do campeão (o vídeo “Só Hoje por R$47”, 17 vendas). Então: **suba este AO LADO dos 4 campeões, no mesmo conjunto — não no lugar deles.** Deixe rodar até gastar ~R$ 100 antes de julgar.

---

# 🚀 SEQUÊNCIA PRONTA PRA COLAR (Gemini "Criar vídeos" · Pro · **Paisagem 16:9**)

Um bloco por vez, **na mesma conversa**. Ordem de geração ≠ ordem de montagem.

## PASSO 1 — o serviço *(vira a cena 3)*
> Define uniforme, telhado e luz. Só siga adiante quando ficar boa. **Quando sair boa, pause num frame bom e tire um print — é a sua referência daqui pra frente.**

```
Wide-to-medium shot from behind and slightly to the side: a technician stands safely on a rooftop, seen from the back, gliding a telescopic pole with a soft white brush across a long row of solar panels. Clean water sheets off the glass in a thin curtain, catching the sunlight. Behind the brush the panels turn deep mirror-blue and reflect the sky; ahead of the brush they are still gray and dusty. A simple bucket and a coiled blue hose rest on the tiles beside him. His face is not visible — only his back, the cap and the gloves.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Smooth lateral tracking shot following the brush as it glides along the row of panels, water sheeting off the glass. The dirty-to-clean line advances across the frame. Ends holding on a fully clean row mirroring the blue sky. No camera shake, no cuts.

AUDIO: only natural ambient sound — soft wind and water running over glass. No music, no voice, no narration, no speech of any kind, no on-screen sound effects.

IMPORTANT: the video must contain no writing, no signs, no numbers and no watermarks of any kind. The technician's face stays hidden behind the cap brim and sunglasses, mouth closed, never speaking. Hands have exactly five fingers and hold the equipment naturally. Realistic documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts, no camera shake.
```

## PASSO 2 — o fecho *(vira a cena 4)*
> **Sobe o print do PASSO 1** no botão de imagem antes de mandar.

```
Same technician, same uniform, same rooftop, same time of day and same lighting as the previous video. Now:

Wide horizontal ground-level shot in front of a modest Brazilian house at late morning. On the right side of the frame, the technician — seen from behind and slightly to the side — shakes hands with the homeowner at the front gate; neither face is clearly visible. The technician's back and cap anchor the right of the frame, the homeowner is shown from the shoulders down holding a phone. The house and its roof fill the left and center of the frame, with the freshly cleaned solar panels shining deep mirror-blue and reflecting the sky. The telescopic pole and bucket rest against the wall. Calm, satisfied, everyday-work atmosphere.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Slow dolly backward, widening from the handshake to reveal the whole front of the house with the clean solar panels shining on the roof. Very gentle, cinematic. No cuts.

AUDIO: only natural ambient sound — soft wind and distant street noise. No music, no voice, no narration, no speech of any kind, no on-screen sound effects.

IMPORTANT: the video must contain no writing, no signs, no numbers and no watermarks of any kind. No face is clearly visible, no mouth open, nobody speaking. Hands have exactly five fingers. Realistic documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts, no camera shake.
```

## PASSO 3 — o hook *(vira a cena 1, a primeira do vídeo)*
> Mantém o print do PASSO 1 como referência. **É o único clipe que vale insistir:** se a sujeira não estiver nojenta e o vidro limpo não estiver espelhando, refaz.

```
Same technician, same gloves, same rooftop, same time of day and same lighting as the previous videos. Now:

Extreme close-up, macro, of the surface of a solar panel completely covered in thick gray dust, dried pollen and white bird droppings. A gloved hand drags a soft white brush across the glass from left to right, revealing one perfectly clean mirror-like stripe that reflects the blue sky and the sun. Half the frame is filthy, half is spotless — the contrast is the subject. Water droplets sparkle on the clean stripe.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Slow push-in on the panel while the gloved hand drags the brush left to right, uncovering the clean stripe. The camera holds on the dirty/clean split at the end. Subtle dust particles floating in the sunlight. No camera shake, no cuts.

AUDIO: only natural ambient sound — the soft scrape of the brush on glass and light wind. No music, no voice, no narration, no speech of any kind, no on-screen sound effects.

IMPORTANT: the video must contain no writing, no signs, no numbers and no watermarks of any kind. No face appears, nobody speaks. The hand has exactly five fingers. Realistic documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts, no camera shake.
```

## PASSO 4 — o mercado *(vira a cena 2)*
> Não tem ninguém em cena. Pode mandar sem referência, ou com o print só pra manter o céu igual.

```
Same neighborhood, same time of day and same lighting as the previous videos. Now:

High aerial drone view rising over a Brazilian suburban neighborhood at mid-morning. Dozens of modest houses with terracotta roofs, and on almost every roof there are solar panels — all of them visibly dull, gray and dusty under the strong sun, none of them shining. Streets, mango trees and water tanks between the houses. The scale of the neighborhood is the subject: panels everywhere, nobody working on them.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Photorealistic documentary photography, shot on 35mm lens, natural material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Slow drone ascent and pull-back, revealing more and more rooftops with dusty solar panels toward the horizon. Steady, smooth, cinematic. No cuts.

AUDIO: only natural ambient sound — light wind and faint distant street noise. No music, no voice, no narration, no speech of any kind, no drone motor sound.

IMPORTANT: the video must contain no writing, no signs, no numbers and no watermarks of any kind. No people visible. Realistic aerial documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts.
```

## PASSO 5 — o Pix *(vira a cena 4 na montagem)*
> Gere por último, com o print do PASSO 1 como referência. **A tela do celular fica desfocada de propósito** — o modelo escreveria o texto errado. O `PIX NA HORA` e o som de notificação entram no editor, por cima.

```
Same technician, same uniform, same house, same time of day and same lighting as the previous videos. Now:

Wide horizontal over-the-shoulder shot: the technician, seen from behind and slightly to the side on the right of the frame, holds his phone in his gloved hand and looks down at it. The phone screen is bright and completely out of focus — a soft glow with no readable interface, no icons and no text. His face is not visible, only the cap, the shoulder and the hands. On the left and center of the frame, the front of the modest Brazilian house with the freshly cleaned solar panels shining deep mirror-blue on the roof, slightly out of focus. A quiet, satisfied, end-of-job moment.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Slow push-in toward the phone in his hand as the screen lights up brighter, his shoulders relax slightly. The clean panels stay glowing in the background. No camera shake, no cuts.

AUDIO: only natural ambient sound — light wind and faint distant street noise. No music, no voice, no narration, no speech of any kind, no notification sounds.

IMPORTANT: the video must contain no writing, no signs, no numbers, no readable phone interface and no watermarks of any kind. The phone screen stays out of focus and unreadable. No face is clearly visible, nobody speaks. Hands have exactly five fingers. Realistic documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts, no camera shake.
```

⚠️ **No editor use TEXTO (`PIX NA HORA`), não um comprovante montado.** Comprovante de Pix falso com valor é documento fabricado — problema no Meta e combustível pra reembolso. O texto entrega a mesma ideia como ilustração.

## PASSO 6 — o profissional em ação *(vira a cena 4 na montagem)*
> Gere por último, com o print do PASSO 1 como referência. É a cena que faz parecer **profissão**, não bico. Dois detalhes travados de propósito: **sol atrás dele** (dá silhueta e esconde o rosto de graça) e **pé firme, sem se debruçar na beirada** — telhado é onde o público tem medo, e imagem arriscada convida comentário de "isso é perigoso".

```
Same technician, same uniform, same rooftop, same time of day and same lighting as the previous videos. Now:

Wide horizontal low-angle shot taken from the rooftop tiles, camera close to the surface looking slightly up: the technician stands mid-frame on the roof, seen from behind and to the side, feet planted firmly and safely on a flat section of tiles, holding the telescopic pole extended over a large array of solar panels. The deep blue sky fills the upper half of the frame. A fine mist of water spray drifts off the brush and catches the sunlight around him. The morning sun is behind him, outlining his shoulders and cap with a rim of warm light. His face is not visible. To the left, panels he has already finished shine like mirrors; to the right, the dusty ones he has not reached yet.

STYLE BIBLE (keep identical in every shot): Brazilian suburban rooftop, terracotta roof tiles, rows of dark blue-black solar panels, white water tank in the background, tropical vegetation and simple neighboring houses far behind. Mid-morning sun, clear deep-blue sky, warm golden sunlight, high contrast. Technician wears a plain graphite-gray work polo, black cap, dark sunglasses and gray gloves — his face is never clearly visible. Equipment: telescopic pole with a soft white brush and a blue water hose. Photorealistic documentary photography, shot on 35mm lens, shallow depth of field, natural skin and material texture. Horizontal 16:9 widescreen cinematic framing, main action composed in the central area so the shot still reads if cropped square. Keep the lower area of the frame uncluttered.

MOTION: Slow rise and slight push-in from the tiles up toward the technician working, the water mist drifting through the sunlight. He keeps sweeping the pole steadily across the panels. Steady, cinematic, no camera shake, no cuts.

AUDIO: only natural ambient sound — light wind and water spraying on glass. No music, no voice, no narration, no speech of any kind, no on-screen sound effects.

IMPORTANT: the video must contain no writing, no signs, no numbers and no watermarks of any kind. The technician's face stays hidden behind the cap brim and sunglasses, mouth closed, never speaking. He stands safely and stably on the roof, never leaning off the edge, never climbing. Hands have exactly five fingers and hold the pole naturally. Realistic documentary footage only — not an illustration, not a 3D render, not animation. Single continuous shot, no cuts, no camera shake.
```

## 🎬 NO EDITOR — a ordem inverte (6 clipes · 48s)

| Ordem no vídeo | Clipe gerado | Fala |
|---|---|---|
| 1º | PASSO 3 (painel sujo) | Ninguém tá falando sobre isso. // Olha o tanto de sujeira nesse painel. // O dono **tá perdendo dinheiro** e nem desconfia. |
| 2º | PASSO 4 (bairro) | São **milhões** de painéis no Brasil… e quase nenhuma empresa faz isso. // Tem **dinheiro na mesa** na sua cidade. |
| 3º | PASSO 1 (limpeza lateral) | É trabalho braçal, mas é simples. // Quem não tem preguiça de subir no telhado **sai na frente**. |
| 4º | **PASSO 6 (em ação)** | Não precisa de máquina cara: uma haste, uma escova e água. // Quem sabe a técnica cobra de **duzentos a oitocentos** por serviço. |
| 5º | PASSO 5 (Pix) | Terminou, o cliente te paga na hora **e paga bem**. // Daqui uns meses suja e ele te chama outra vez. // Trabalho que se repete. |
| 6º | PASSO 2 (fecho) | Sem faculdade, sem experiência. // O Limpa Solar Pro te ensina a técnica e quanto cobrar. // **Quarenta e sete reais**. Toca em Saiba mais. |

**122 palavras ≈ 45s** num corte de 48s. O preço saiu da fala 3 e foi pra 4 de propósito — cai junto com a imagem do cara trabalhando, que é onde o número tem lastro. Texto na tela do clipe do Pix: `PIX NA HORA`.

⚠️ **48s já é longo pra anúncio frio.** Se a retenção cair, o PASSO 6 é o clipe a cortar: o vídeo volta pros 40s sem perder argumento, bastando juntar as falas 3 e 4 numa só ("É trabalho braçal — quem não tem preguiça sai na frente. Quem sabe a técnica cobra de duzentos a oitocentos por serviço.").

**Se um clipe fugir do padrão:** refaz só ele, subindo o print do PASSO 1 e escrevendo `match the reference image exactly: same polo, same cap, same gloves, same roof tiles, same sunlight direction`. Se o uniforme sair só um pouco diferente mas o resto bom, **fica com ele** — o corte é seco de 8 em 8s, ninguém compara tom de cinza. O que quebra de verdade é sol forte numa cena e céu nublado na outra.

---
*Roteiro conferido contra a LP no ar (`limpapro.solardoc.app`, 31/jul/2026): R$ 200–800 por serviço, menos de R$ 700 de equipamento, garantia de 7 dias, cliente recorrente a cada 3–6 meses. Preços e claims batem com a página.*
