# NEXUS — prompts de geração das imagens

Gerado em 08/09/2026. Cada bloco é um prompt fechado, pronto para colar em
nano-banana / Seedream / Flux. Todos pedem **fundo branco puro, produto recortado,
quadrado 1500×1500**, no mesmo tratamento que a concorrência usa.

**Já gerados nesta sessão** (Morphix, nano-banana-2): D60, D80, D120, D240 e o wallbox.
Estão no ar em `/nexus/img/p-*.webp`. Os créditos acabaram no meio — os demais
prompts abaixo estão prontos e é só rodar quando houver crédito.


---

## Bloco de estilo (repetir em todo prompt)

ESTILO_BASE (paste in every prompt — 195 words)

```
Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.
```

MARCA_NA_PECA (paste in every prompt, right after ESTILO_BASE)

```
Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.
```

Notas de operação (leia antes de gerar as 9)

1. Fundo transparente é PÓS, não prompt. Modelo de imagem não emite alfa: pedir "transparent background" faz ele desenhar o xadrez cinza, e sombra de contato precisa de superfície. Gera no branco #FFFFFF e recorta depois com máscara suave (não varinha mágica), senão a sombra sai com borda dura. O PNG 1500x1500 transparente sai no final.
2. O que faz virar família não é adjetivo, é seed/style-reference fixo + os dois blocos colados byte a byte iguais em todos os prompts. Só troque a frase que descreve o produto.
3. Escala: a regra de 80% (D60–D240) e 55% (W7/W11/W22) existe pra wallbox e gabinete de chão viverem no mesmo grid sem um parecer brinquedo.
4. O logo vai driftar em 9+ peças (letra a mais, gradiente invertido). Caminho confiável: gerar com a face do gabinete limpa e compor o vetor real do NEXUS por cima no pós. Use o MARCA_NA_PECA como plano A e o vetor como garantia.
5. A tela acesa é o único lugar onde invenção entra sozinha na imagem — por isso está travada como "abstract interface + charge arc", sem número legível, sem selo, sem badge de loja.
6. Adaptação honesta das seções da Joult que dependem de lastro: onde a Joult mostra contador de estações/MWh/recargas, logo de parceiro, depoimento ou badge de App Store, nós não colocamos número nenhum na tela nem selo no gabinete. Trocar por texto ao lado da peça com o que é verdade hoje: peça de reposição no Brasil, pronta entrega, OCPP 1.6J aberto (não prende plataforma), NEXUS REDE / NEXUS PAINEL / NEXUS 24, e a especificação real do modelo (kW, CCS2, refrigeração ativa). Prova técnica no lugar de prova social que não existe.


---


## 1. `d60.png` — nexus-d60

**Estado:** gerado, no ar em `/nexus/img/p-d60.webp`
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
Studio product render of ONE NEXUS D60 DC fast charging pillar, a single free-standing unit, nothing else in frame.

PRODUCT: a slim vertical floor-standing charging column, roughly 1.9 m tall, 0.50 m wide and 0.30 m deep, so the body reads clearly narrow and tall, width about one quarter of the height, never a wide fridge-sized box. Squared-off cabinet with softly radiused vertical edges, a flat top cap slightly sloped toward the front, and a low solid plinth base about 12 cm high sitting flat on the floor. Front face is one continuous flush panel divided by two fine horizontal seams. The upper third of that front face is left clean and flat and carries the brand lockup described below. Centred below it, at about 1.35 m from the floor, one small recessed display, about 7 inches on the diagonal and slightly wider than tall, tilted a few degrees downward, inside a slim brushed silver bezel. Directly under the screen a narrow horizontal strip with three plain unmarked round buttons and one flush blank RFID reader pad, no icons, no symbols, no writing. A thin vertical light strip runs down the left edge of the front face glowing soft blue. Two charging cables, exactly two, one on each side of the cabinet and mirrored: thick matte black cable exiting the body through a rounded rubber grommet at about 1.45 m height on each flank, hanging in one loose coil, each ending in a CCS2 Combo 2 European connector, a round Type 2 head with seven small pins on the upper circle plus two large DC pins in a lower extension below it, parked nose-down in a moulded black holster on the side of the cabinet at about 1.15 m. Narrow horizontal cooling louvres for the active cooling system only on the lower side flanks and the top cap, never across the front panel. No door handles, no visible bolts or screws, no payment terminal, no keypad, no lamp head, no canopy, no bollard posts, no cable on the rear.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

MODEL CODE, explicitly stated for this unit and allowed only here: one small model code reading D60, exactly three characters, capital letter D followed by digit six then digit zero, set in the same heavy geometric sans, solid dark navy (#07203D), aligned under the right end of the wordmark on its own baseline, at roughly 30% of the wordmark cap height, wide letter-spacing, flat and printed on the panel. No other characters, words or numbers anywhere on the unit, the screen, the cables or the connectors.

OUTPUT: one square 1:1 image, 1500x1500, pure white #FFFFFF background filling every pixel around the product, generous and equal empty margin on all four sides, the unit reading cleanly isolated against the white with only one soft contact shadow under the plinth.
```


### Negative

```text
transparent checker pattern, alpha checkerboard, gray or colored background, gradient backdrop, floor line, horizon, reflective or glossy floor, mirrored reflection, cast shadow, drop shadow, bokeh, shallow depth of field, lens flare, vignette, colored rim light, harsh specular hotspot, wide squat fridge-shaped cabinet, bulky boxy proportion, ultra thin parking meter post, three or more cables, both cables on the same side, no cable, tangled or dragging cable, cable on the floor, cable across the front panel, CHAdeMO connector, Type 1 J1772 connector, NACS Tesla connector, GB/T connector, household plug, fuel pump nozzle, gas station dispenser, misspelled wordmark, NEXSUS, NEXUSS, NEXVS, NEUXS, extra or missing letter, six letters, lowercase letters, serif or script or condensed type, outlined or 3D or embossed logo, glossy or metallic logo, inverted green to blue gradient, gradient on the vertical legs, solid single color N, four stroke N, connected N strokes, tilted or curved logo, logo wrapped around an edge, second logo, partner logo, certification seal, CE UL TUV INMETRO mark, QR code, app store badge, spec sticker, warning label, price tag, legible numbers, percentage, kWh, kW, voltage readout, clock, menu text or icons on the screen, photo of a person, hands, car, EV, parking lot, showroom, street, plants, sky, watermark, signature, duplicate unit, second charger in frame, cropped product, product touching frame edge
```


### O que conferir

O que costuma sair errado no D60 (é a peça mais "genérica" da linha, o modelo puxa pra bomba de combustível):

1. CABOS — o prompt pede DOIS, um de cada lado, espelhados. Erros comuns: aparecem 3, os dois brotam do mesmo lado, um cabo nasce do nada sem grommet, ou o cabo cai no chão e vira sombra projetada (aí o recorte no pós fica com borda dura). Conferir simetria esquerda/direita e que os dois saem por volta de 1,45 m.
2. CONECTOR — o CCS2 é o que mais dá ruim. Tem que ter o círculo Tipo 2 em cima com pinos pequenos E a extensão embaixo com 2 pinos DC grandes. Se sair só o círculo é Tipo 2 AC (errado, isso é wallbox); se sair pino redondo grosso é CHAdeMO; se sair bico curvo é bomba de gasolina. Dá zoom no conector antes de aceitar.
3. PROPORÇÃO — 60 kW esbelto vira geladeira gorda ou poste de estacionamento fino demais. Regra: largura ≈ 1/4 da altura, e o corpo ocupando ~80% da altura do quadro. Se sair 55-60% a família (D80..D240) não alinha no grid e o D60 parece de outro catálogo.
4. WORDMARK — contar as letras: N-E-X-U-S, cinco. NEXSUS / NEXUSS / NEXVS é o defeito nº1. No monograma conferir os 3 traços SEPARADOS (com folga), perna esquerda azul sólida, diagonal azul em cima-esquerda → verde embaixo-direita, perna direita verde sólida. Gradiente invertido e "N" de peça única passam batido se você não olhar de perto.
5. D60 — vira D80, D6O, DGO ou 060 com facilidade. Se o código não sair perfeito, NÃO tente refazer 5 vezes: gera a face limpa e compõe D60 + logo em vetor no pós. O vetor é a garantia, o MARCA_NA_PECA é só o plano A.
6. TELA — não pode ter número legível, %, kWh, R$, relógio, ícone de app ou selo. Só o arco abstrato azul. Qualquer número na tela vira alegação sem lastro e tem que ser rejeitado.
7. VENTILAÇÃO — a refrigeração ativa às vezes vira grade cobrindo a frente inteira e come o painel da marca. Louvre só nas laterais baixas e no topo.
8. FUNDO/SOMBRA — se aparecer xadrez cinza, piso refletindo ou sombra projetada pro lado, refaz. Só sombra de contato sob a base. O PNG transparente é POST (máscara suave), nunca pede no prompt.
9. Botões e leitor RFID têm que estar SEM ícone/texto — se aparecer escrita miúda, é texto inventado, rejeita.


## 2. `d80.png` — d80

**Estado:** gerado, no ar em `/nexus/img/p-d80.webp`
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
NEXUS D80 DC fast charger — one single freestanding floor-standing charging pillar, complete unit, nothing else in the image.

Physical build: one slim vertical column about 1.9 m tall, 0.62 m wide and 0.40 m deep — roughly three times taller than it is wide — with softly rounded vertical edges and a flat, slightly overhanging top cap. The column stands on a low rectangular plinth base about 0.10 m tall and slightly wider than the body, so the unit reads as bolted to the ground. Cabinet in matte white powder-coated steel, a brushed silver trim strip running down each vertical edge, and a fine horizontal louvered ventilation grille across the lower third of both side panels for the active cooling — shallow, neat louvers, never open holes.

Screen: one single dark charcoal recessed display set into the upper front face at about 1.35 m from the floor, tilted roughly 10 degrees down toward the viewer, about 25 cm diagonal, framed by a thin flush bezel, lit with an abstract deep-blue interface and one simple charge arc — no numbers, no icons, no words on the glass. Directly under the screen a slim blank recessed slot suggests a card reader: matte, unmarked, no keypad, no labels.

Cables and connectors: exactly two charging cables, one on the left side and one on the right side, perfectly symmetrical and both fully visible, and no others. Each is a thick matte black cable that leaves the cabinet through a rubber grommet high on that side flank at about 1.55 m, drops in one gentle relaxed curve, and ends in a CCS2 Combo 2 connector — black pistol-grip handle, round upper Type 2 section with small pins, two large round DC pins below it — parked nose-in in a molded black holster on the same side panel at about 1.10 m. Left and right holsters sit at exactly the same height and are mirror images of each other. Both connectors are holstered on the unit, none lying on the ground, no third cable, no extra socket, no cable running off frame.

Light ring: around the mouth of each holster there is a thin continuous illuminated ring of bright emerald green (#00C46A), about 1 cm wide, flush with the panel, soft, even, low intensity, identical on both sides, no bloom, no light spilling onto the floor or background, and no colored light anywhere else on the unit.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Model code, stated explicitly for this unit: the three characters D80 — one uppercase letter D followed by the digits 8 and 0 — printed once only, small, in the same heavy geometric sans-serif, solid dark navy (#07203D), aligned to the lower right of the front panel near the base, at about one fifth of the wordmark cap height. That is the only text on the machine besides the NEXUS lockup: no other words, part numbers, power ratings, connector labels, warning triangles or stickers anywhere on the cabinet, the holsters, the cables or the connectors.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Output: one square image, 1:1, 1500 x 1500 px, pure white #FFFFFF background with no environment at all, the pillar centered and filling about 80% of the frame height, equal empty white margin on all four sides, one soft contact shadow under the plinth only, clean cut-out-ready commercial catalog look.
```


### Negative

```text
transparent checker pattern, checkerboard background, reflective or glossy floor, floor reflection, bokeh, shallow depth of field, lens flare, vignette, colored rim light, gradient background, horizon line, backdrop seam, environment, showroom, street, parking lot, sky, people, hands, cars, plants, props, second charger, duplicated unit, extra text, invented text, spec stickers, warning labels, certification seals, QR codes, app store badges, legible numbers, counters, statistics, partner logos, any logo other than NEXUS, misspelled wordmark, extra or missing letters in the wordmark, reversed monogram gradient, green left leg, blue right leg, outlined or beveled or glossy logo, drop shadow on logo, tilted or warped logo, one cable only, three or more cables, both cables on the same side, missing far-side cable, asymmetric holsters, cable lying on the ground, connector hanging loose, CHAdeMO connector, gas pump nozzle, blue or red or white glow ring, glowing floor, light bloom, neon halo, LED strip running up the column, numbers or icons or app UI on the screen, photo of a real charger, watermark, signature, frame, border, collage, multiple views, exploded view
```


### O que conferir

Confira nesta ordem, e rejeite na primeira falha:

1. O LADO DE TRAS DA CAMERA. A camera esta travada em ~15 graus fora do eixo, entao o cabo/coldre do lado mais afastado fica parcialmente escondido — e e exatamente ali que o modelo trapaceia. Nao basta contar dois cabos: olhe o lado distante e confira se ele tem cabo, coldre na MESMA altura do outro e o anel verde aceso com o mesmo brilho. Anel apagado ou coldre mais alto de um lado e o erro assinatura desta peca.

2. Contagem e simetria. Exatamente 2 cabos, 1 por lado, os dois com o conector guardado no coldre. Erros comuns: um cabo so, tres cabos, os dois cabos do mesmo lado, cabo caido no chao ou saindo do quadro.

3. O conector. Tem que ser CCS2 (Combo 2): parte de cima redonda tipo Type 2 com pinos pequenos + DOIS pinos DC grandes embaixo. O modelo adora entregar bico de bomba de combustivel ou CHAdeMO. Se nao tiver os dois pinos grandes inferiores, nao e CCS2.

4. Verde so em dois lugares. O #00C46A pode aparecer APENAS nos dois aneis dos coldres e na perna direita / fim do degrade do monograma. Nada de faixa verde subindo a coluna, brilho verde na tela, halo estourado ou luz vazando no chao.

5. Wordmark. Soletre letra por letra: N-E-X-U-S, cinco letras. Confira tambem o degrade do monograma — perna ESQUERDA azul, perna DIREITA verde. Invertido e o defeito mais frequente. Se sair errado, nao fique re-rolando: gere com a face do gabinete limpa e componha o vetor real do NEXUS por cima no pos (plano B do padrao).

6. Texto extra. Alem do lockup, so pode existir "D80" pequeno embaixo a direita. Confira se nao virou D8O / DBO / D80kW, e se nao apareceu adesivo, selo, triangulo de aviso, QR ou numero na tela.

7. Tela. Interface azul abstrata + um arco de carga. Se aparecer numero, porcentagem, relogio ou icone de app, descarta.

8. Escala e sombra. A coluna tem que ocupar ~80% da altura do quadro (mesma regra do D60/D120 — se sair menor a familia fica desalinhada) e ter UMA sombra de contato so embaixo do plinto. Duas sombras ou sombra projetada no chao quebram o recorte.

9. Recorte. Gerar no branco puro e so depois tirar o fundo com MASCARA SUAVE, nunca varinha magica: como e peca de chao com plinto e sombra de contato, a varinha deixa borda dura e come a sombra.


## 3. `d120.png` — d120

**Estado:** gerado, no ar em `/nexus/img/p-d120.webp`
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
Subject: one single NEXUS D120 DC fast charger, a 120 kW dual-outlet free-standing floor cabinet,
alone in frame, nothing else in the image.

Product: a broad upright rectangular floor cabinet, about 1.95 m tall, 0.80 m wide and 0.50 m deep,
so it reads clearly wider and squarer than a slim single-cable charging column while staying about
two and a half times taller than it is wide. It stands flat on the ground on a low plinth base
about 10 cm high with a subtle recessed toe kick, no bolts or anchors visible. Body: matte white
powder-coated steel panels with softly rounded vertical corners and a flat, slightly overhanging
top cap, a slim brushed-silver trim band wrapping the top cap and running down both front
shoulders, fine even panel seams, no visible screws. The front face is split by two fine
horizontal seams into three bands: a clean upper brand panel, a middle display band, and a lower
service panel with a flush door seam. Screen: one large recessed dark charcoal touchscreen set
into the middle band, landscape orientation, about 15-inch class, roughly 38 cm on the diagonal,
spanning about 45% of the cabinet width so it reads noticeably bigger than the small display of a
compact charging column, centered, at chest height (~1.35 m), tilted up about 10 degrees, behind a
thin flush bezel, lit with an abstract deep-blue interface and one simple charge arc, no readable
text and no numbers on the glass. Cooling: active-cooling louvres of thin parallel horizontal
slats in two places only, a full-width band low on each side panel and a narrow band across the
upper rear shoulder; the front face carries no grille and no exposed fan. Cables: exactly two
charging cables, no more and no fewer, one on the left side and one on the right side, mirrored
symmetrically; each is a thick matte black cable leaving the cabinet through a rubber grommet high
on that side flank at about 1.55 m, hanging in one relaxed loop, and ending in a matte black CCS2
Combo 2 connector, a round upper Type 2 body with small signal pins above a wider lower section
with two large round DC pins, parked nose-in in a molded black holster recessed into that same
side panel at about 1.10 m; left and right holsters sit at exactly the same height and are mirror
images of each other. Both connectors are holstered and idle, plugged into nothing, none lying on
the ground, and neither cable crosses the front face or covers the screen or the brand panel.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Model code, stated explicitly for this unit: the four characters D120 - one uppercase letter D
followed by the digits one, two, zero - printed flat and straight once only, small, on the lower
left of the front service panel, in the same heavy geometric sans-serif as the wordmark, solid
dark navy (#07203D), at about one quarter of the wordmark cap height, wide letter-spacing, no box
and no frame around it. That is the only text on the machine besides the NEXUS lockup: no other
words, digits, power ratings, connector labels, part numbers, warning triangles or stickers
anywhere on the cabinet, the screen, the holsters, the cables or the connectors.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Output: one square image, 1:1, 1500 x 1500 px, seamless pure white #FFFFFF background with no
environment at all, the cabinet centered and filling about 80% of the frame height, equal empty
white margin on all four sides, one soft contact shadow under the plinth only. The only lettering
in the image is the NEXUS lockup and the small D120 model code stated above; every other number,
label, sticker and seal stays forbidden.
```


### Negative

```text
only one cable, three or more cables, both cables on the same side, asymmetric or different-height holsters, a third connector, Type 2 Mennekes AC connector, CHAdeMO, GB-T, CCS1 / Type 1, NACS or Tesla connector, household plug, fuel-pump nozzle shape, cable plugged into a car, cable draped across the front face or over the screen, connector lying on the floor, cable hanging from the top of the cabinet; narrow slim column, wallbox or pedestal proportions, tall thin tower, cabinet wider than it is tall, vending machine or humanoid shape; two screens, screen on a side panel, small screen, screen showing legible text, numbers, percentages, kWh, prices, clock, battery icon, app interface or QR code; keypad, push buttons, card reader with icons, emergency stop button, warning triangle, rating plate, spec sticker, serial number, certification seal, CE or INMETRO mark, App Store or Play Store badge, partner logo, tagline; misspelled brand, NEXXUS, NEUXS, NEXU, NEXUSS, NEXSUS, extra or missing letters, reversed blue-to-green gradient, green left leg, blue right leg, gradient on the wordmark, outlined, beveled or glossy logo, drop shadow on the logo, tilted or warped logo, logo repeated more than once, second logo; wrong model code, D12O, D1200, D102, D20, D60, D80, 120kW, 120 kW written out, model code repeated twice; transparent checker pattern, checkerboard, reflective or glossy floor, floor reflection, mirror reflection, gray background, background gradient, backdrop seam, horizon line, showroom, street, parking lot, outdoor scene, car, person, hand, second charger, duplicated unit, bokeh, shallow depth of field, lens flare, vignette, colored rim light, glowing edges, LED strips, harsh specular hotspot, watermark, signature, caption text, border, frame, collage, multiple views, exploded view.
```


### O que conferir

O que costuma sair errado no D120 e o que conferir antes de aceitar:

1) NUMERO DE CABOS. É a falha mais comum da peça: o modelo entrega 1 cabo (vira um D60 gordo) ou 3. Tem que ser exatamente 2, um de cada lado, espelhados, saindo na mesma altura, com os dois holsters na mesma altura. Se um cabo cruzar a frente ou tapar a tela, refaz.

2) CONECTOR. Precisa ser CCS2 (Combo 2): círculo superior com os pinos pequenos MAIS a parte de baixo com os dois pinos grandes de DC. Se vier só o círculo Tipo 2 (sem os dois pinos grandes embaixo), é wallbox AC disfarçado de DC — rejeita. Os dois conectores têm que estar guardados no suporte, nenhum no chão nem plugado em nada.

3) "MAIS LARGO" NÃO SE PROVA SOZINHO. A largura de 0,80 m só aparece comparando com o D60 (0,50) e o D80 (0,62) na MESMA altura de 80% do quadro. Abre d60/d80/d120/d160 lado a lado antes de aprovar: se o D120 não parecer visivelmente mais largo que o D80 e mais estreito que o D160 (0,90), pede outra semente. Aprovar o d120 isolado é o erro clássico.

4) TELA. Tem que ser UMA só, na banda do meio da frente, deitada (landscape), ocupando ~45% da largura — a diferença pro D80 é ela ser maior. Zero número, porcentagem, kWh, relógio, ícone de bateria ou UI de app na tela: só o azul abstrato com o arco. Qualquer caractere legível ali é motivo de refazer.

5) WORDMARK. Contar as letras: N-E-X-U-S, cinco, nem uma a mais. E conferir o sentido do degradê: perna ESQUERDA azul, diagonal azul (em cima à esquerda) → verde (embaixo à direita), perna DIREITA verde. O erro que mais escapa é o degradê invertido — passa fácil no olhar rápido.

6) D120 LEGÍVEL. O bloco de estilo proíbe "número legível" e nós pedimos o código: espere D12O, D1200, D102 ou dígito comido. Se não sair perfeito, NÃO insista no prompt — apague o código no pós e componha o vetor por cima, junto com o lockup NEXUS (é o plano B do padrão, item 4 das notas).

7) FUNDO. Se aparecer xadrez cinza, chão espelhado ou sombra projetada, descarta: o alfa é pós, com máscara suave. A sombra tem que ser só o contato embaixo do rodapé.

8) SEM SELO/ADESIVO. Nenhuma etiqueta de potência, CE/INMETRO, botão de emergência vermelho ou plaqueta — não temos lastro pra selo nenhum. A prova técnica (120 kW, 2 × CCS2, refrigeração ativa, OCPP 1.6J, peça de reposição no Brasil, pronta entrega) vai em TEXTO AO LADO da imagem, nunca dentro do gabinete.


## 4. `d160.png` — d160

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
Studio product catalog render of one NEXUS D160, the highway-duty 160 kW DC fast charger of the NEXUS line. A single floor-standing unit, alone in frame, nothing else present.

PRODUCT PHYSICS — build exactly this object, do not improvise a different machine:
A tall free-standing rectangular cabinet, heavy and industrial, proportions close to 2.0 m high by 0.90 m wide by 0.65 m deep, so it reads about twice as tall as it is wide and clearly deeper and broader than a home wallbox. It sits flat on the floor on a low reinforced plinth base roughly 12 cm high finished in brushed silver, with softly rounded vertical corner posts and visible flat panel seams that split the front face into three horizontal bands. The top is a shallow one-piece drip roof with a small overhang and a brushed silver trim edge; a matching brushed silver band crosses the top of the front panel.
Upper front band: the flat printed brand lockup described in the brand block below, and nothing else.
Middle front band, at about 1.35 m from the floor: one dark charcoal screen in portrait orientation, recessed flush into the panel behind a clean bezel, lit with an abstract deep-blue interface and one simple charge arc, no readable characters.
Lower front band: a full-width horizontal louvered ventilation intake grille, deep-set dark charcoal fins behind the white steel face, evenly spaced and clearly machined and recessed, with matching vertical louver stacks on the upper half of both side panels. This is an actively cooled unit, so the venting must read as real openings cut into the body, never as painted stripes.
Cables: exactly two, one on each side, identical and mirrored. Each matte black heavy liquid-cooled cable leaves the cabinet through a rubber strain-relief gland on the side shoulder at about 1.5 m height, hangs in one relaxed loop, and ends in a European CCS2 combo connector — an oval Type 2 head with a seven-pin round AC section on top and two large round DC pins below — seated nose-down in a holster recessed into the side panel. Both connectors are docked; nothing is unplugged or resting on the floor. No third cable, no AC socket outlets, no overhead cable retractor arm.
The front face carries nothing but the brand lockup, the screen and the vent grille: no card reader, no keypad, no push buttons, no stickers, no rating plate, no LED light strips.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Model code stated explicitly for this unit: the four characters D160, an uppercase D followed by the digits one, six, zero, set small in the same dark navy ink (#07203D), aligned under the right end of the wordmark, at about one third of the wordmark cap height, with wide letter-spacing. That is the only text on the whole cabinet besides the NEXUS wordmark.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Output: square 1:1, 1500 x 1500 px, pure white #FFFFFF background, the whole unit inside the frame filling about 80% of the frame height, generous equal empty margin on all four sides.
```


### Negative

```text
only one cable, three or more cables, both cables on the same side, asymmetric cable holsters, CCS1 / Type 1 / CHAdeMO / GB-T / NACS connector, fuel-pump nozzle shape, connector lying on the floor or plugged into anything, painted fake grille stripes, no ventilation at all, card reader, payment terminal, keypad, push buttons, emergency stop button with lettering, rating plate, spec sticker, QR code, certification seal, app-store badge, partner logo, tagline, misspelled brand NEXSUS NEXXUS NEXUSS NEXU, extra or missing letters, reversed gradient with green on the left leg or blue on the right leg, glossy beveled or outlined logo, wrong model code D150 D16O D1600 160kW, readable numbers percentages prices clock or kWh on the screen, colored LED strips, glowing edges, reflective floor, transparent-checker background, gradient or grey background, second charger, people, cars, road, canopy, gas station, showroom, outdoor scene, bokeh, lens flare, vignette, colored rim light, cast shadow, watermark, tilted or cropped unit, squat 1 m box or thin totem proportions
```


### O que conferir

Confira nesta ordem, que é a ordem em que essa peça costuma quebrar:

1) CONTAR OS CABOS. É a falha número 1 do gabinete de dois cabos: sai com 1 só, com 3, ou com os dois do mesmo lado. Tem que ser 2, um de cada lado, espelhados, saindo na mesma altura (ombro, ~1,5 m), com laço do mesmo tamanho e os dois conectores encaixados no coldre.

2) O CONECTOR. Modelo treinado em foto americana adora desenhar CCS1 (Tipo 1) ou CHAdeMO redondo, e às vezes vira bico de bomba de gasolina. O certo é CCS2: cabeça oval Tipo 2 em cima e DOIS pinos DC redondos grandes embaixo. Se sair CCS1 em uma das pontas só, descarta a imagem — não dá pra consertar no pós.

3) A GRELHA. Como o pedido é "grelha visível", ela costuma virar (a) listra pintada sem profundidade, (b) grade de ar-condicionado gigante comendo metade da face, ou (c) some. Tem que ler como veneziana recessada, escura no fundo, na faixa baixa da frente + laterais, sem invadir a área da marca nem a tela.

4) O WORDMARK. Contar letra por letra: N-E-X-U-S, 5 letras. Sai NEXXUS/NEXUSS/NEXU com frequência. E o monograma inverte muito: perna ESQUERDA azul, perna DIREITA verde, diagonal degradê azul→verde. Se o gradiente estiver invertido ou o N estiver com brilho/contorno, cai no plano B: gerar a face limpa e compor o vetor real por cima no pós.

5) O D160. Código de modelo é onde o modelo mais alucina: D150, D16O (letra O no lugar do zero), D1600, "160kW". Se não sair perfeito, apagar e compor no pós — é texto pequeno, o retoque é barato.

6) A TELA. Não pode ter NADA legível: nem %, nem kW, nem preço, nem relógio, nem barra de progresso com número. Só o azul abstrato e um arco. Qualquer número na tela vira promessa que não temos lastro.

7) ESCALA E MOLDURA. O gabinete tem que parecer ~2 m: alto, robusto, mais fundo que largo na diagonal. Se sair caixa quadrada baixa ou totem fino, refaz — não vai casar com as wallboxes no grid (80% x 55%). Unidade centralizada, 80% da altura do quadro, margem igual nos 4 lados.

8) FUNDO E SOMBRA. Branco puro, sem xadrez, sem chão espelhado, sem degradê. Só a sombra de contato embaixo da base. O PNG transparente é PÓS: recortar com máscara suave preservando a sombra, nunca varinha mágica (a borda sai dura e denuncia o recorte).

9) SEM SELO NENHUM. Zero adesivo de certificação, QR, plaquinha de especificação, leitor de cartão com bandeira, badge de loja de app. Se a Meta pedir "prova", ela vai ao LADO da imagem em texto (160 kW, CCS2, refrigeração ativa, OCPP 1.6J, peça de reposição no Brasil, pronta entrega), nunca impressa no gabinete.

10) FAMÍLIA. Gere as 9 peças com o MESMO seed / style reference, mudando só o parágrafo de descrição do produto. Se este D160 sair bom, trave o seed antes de gerar D240 e as wallboxes.


## 5. `d240.png` — d240

**Estado:** gerado, no ar em `/nexus/img/p-d240.webp`
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
Studio product render of a single NEXUS D240, the flagship 240 kW DC ultra-fast electric-vehicle charging station of the line: one tall freestanding floor cabinet of the hub type, shown alone.

PRODUCT: One monolithic vertical cabinet, roughly 2.1 m tall, 1.15 m wide and 0.60 m deep, so it reads clearly taller than wide and visibly heavier and broader than a mid-power charger. It stands squarely on a low recessed plinth base a few centimetres high, set back from the body so the cabinet appears to float slightly. Straight vertical body, softly radiused vertical corners, flat top cap with a small overhang, one narrow recessed dark charcoal strip inset across the top of the front face (a physical unlit trim recess, not a light). Slim brushed silver trim seams run down both front corners and separate the front panel from the side panels. The front face is divided into three stacked zones: an upper panel carrying the brand lockup, a middle panel carrying one single large recessed touchscreen, and a lower blank panel. Screen: exactly one display, 15-inch landscape format, dark charcoal glass sunk into a shallow bezel, centred on the front face at about 1.3 m from the floor, tilted about 10 degrees downward toward the viewer, showing an abstract deep-blue interface with one simple charge arc. Cables: exactly two, one on the left side and one on the right side, never more and never fewer. Each is a thick liquid-cooled DC cable, matte black, about 35 mm in diameter, noticeably heavier than a domestic charging cable, with a slightly fatter cooled section near the head. Each cable exits the cabinet through a rubber grommet high on its own side panel, hangs in one single neat loop, and ends in a CCS2 Combo-2 connector head docked nose-down in a moulded black holster mounted on that same side panel at about 1.0 m height. Both connector heads are identical CCS2 European Combo-2 heads: a round seven-pin Type-2 upper section with a lower lobe carrying the two large round DC pins, chunky pistol-grip body, short matte black strain relief. Nothing is plugged into anything, no cable touches the ground, no cable crosses the front face. The lower half of both side panels carries fine horizontal ventilation louvres for the active liquid-cooling system. No second screen, no keypad, no card reader, no socket or plug on the front face, no third cable, no third holster.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

This prompt states the model code explicitly: the model code D240 is printed small on the lower left of the front panel, well below the brand lockup, in the same heavy geometric sans-serif, solid dark navy (#07203D), at about one fifth of the wordmark height — the capital letter D followed by two, four, zero. This model code and the NEXUS lockup are the only markings of any kind on the whole unit.

OUTPUT: This is a floor-standing unit, so the ~80% frame-height rule applies — the cabinet fills about 80% of the frame height, perfectly centered, with generous even white margin on all four sides. Pure white #FFFFFF background only, no floor plane, no wall, no room, no props. Square 1:1, 1500x1500, clean commercial catalog look.
```


### Negative

```text
no numbers or text other than the NEXUS wordmark and the model code D240; no three or more cables, no single cable, no third holster, no cable lying on the floor, no cable crossing the front face, no connector plugged into anything; no CCS1 or Type-1 or CHAdeMO or NACS connector, no domestic thin cable; no second screen, no keypad, no card reader, no front-face socket; no misspelled wordmark, no extra or missing letters, no merged or joined strokes on the N, no inverted gradient direction, no outline, bevel or gloss on the logo; no colored glow, LED light strip, rim light or lens flare; no spec sticker, certification seal, QR code, app-store badge, partner logo or legible interface figures; no transparent-checker pattern, no reflective floor, no gradient background, no horizon line, no environment, showroom, car, person, watermark; no bokeh, no shallow depth of field, no vignette, no tilted or low-angle hero shot.
```


### O que conferir

Confira nesta ordem antes de aceitar:

1. CABOS — o erro nº 1 do topo de linha. Tem que ser EXATAMENTE DOIS, um de cada lado, os dois encaixados no coldre, nenhum no chão e nenhum atravessando a frente. O modelo adora enfiar um terceiro cabo ou desenhar um só; num gabinete grande ele também tende a dobrar os coldres do mesmo lado.
2. CONECTOR — tem que ser CCS2 (Combo 2, europeu): se der pra ver os pinos, os DOIS pinos grossos de DC ficam ABAIXO da parte redonda de 7 pinos do Tipo 2. Se sair CCS1/Tipo 1 (americano) ou um bico de bomba de combustível, descarta.
3. WORDMARK — NEXUS com CINCO letras. Conta letra por letra. "NEXUSS", "NEXVS" e "NEUXS" acontecem. Em gabinete alto o lockup costuma sair pequeno demais ou torto no painel superior.
4. MONOGRAMA N — três traços SEPARADOS, com folga entre eles. O degradê corre azul em cima à esquerda → verde embaixo à direita. Inverter o degradê (verde em cima) é a falha mais comum e passa despercebida; compare lado a lado com as outras 8 peças.
5. D240 — leia com zoom: sai D24O (letra O), 0240, D420 ou D24. Se drift ar, gere de novo com esse canto LIMPO e componha o código como vetor no pós, junto com o lockup (nota 4 do padrão).
6. TELA — uma só, na frente, com interface azul abstrata e o arco. Sem número legível, sem porcentagem, sem "kW", sem relógio. Se aparecer figura lida, refaz.
7. LUZ — nenhum brilho colorido, nenhuma faixa de LED acesa, nenhum rim light azul/verde. A tela é o único elemento aceso.
8. ESCALA — a peça tem que ocupar ~80% da altura do quadro e parecer alta e larga (hub), não um totem magrinho. Ponha lado a lado com o D60 e o D80: o D240 tem que ser visivelmente mais robusto, senão a família mente sobre a potência.
9. SOMBRA — só o contato embaixo da base, ~20%, sem sombra projetada e sem chão espelhado.
10. PNG TRANSPARENTE é PÓS. Gere no branco puro e recorte com máscara suave; varinha mágica come a sombra de contato e deixa borda dura.

Se aceitar a imagem, guarde o seed/style-reference: as outras 8 peças da linha têm que sair do mesmo seed pra família fechar.


## 6. `w7.png` — nexus-w7

**Estado:** gerado, no ar em `/nexus/img/p-wallbox.webp`
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
SUBJECT
A single NEXUS W7 residential AC wallbox EV charger, 7.3 kW, one unit only, shown alone and centered, floating against a seamless pure white background with no wall, no mounting plate, no bracket and no surface of any kind rendered behind or under it.

PRODUCT DETAIL
Compact upright rounded-rectangle housing, taller than wide, proportion about 1.4:1 (roughly 34 cm high by 24 cm wide) and shallow, about 12 cm deep, with softly rounded corners, a gently domed front face and a flush hidden back plate. Matte white powder-coated steel body, one slim brushed-silver trim line, subtle panel seams. A small dark charcoal recessed rectangular screen sits in the middle of the front face, below the brand lockup, showing an abstract deep-blue interface with one simple charge arc and no legible digits. One thin unlit LED status strip runs horizontally just above the screen. The unit carries EXACTLY ONE charging cable and ONE holster: a single matte black cable leaves the housing through a grommet at the bottom, is coiled neatly in two loose loops hanging close to the body, and its connector head rests in one hook holster on the right side of the unit; the left side is bare, with no second cable and no second holster. The connector is a Type 2 / Mennekes AC head: a keyed circular face, flat along the top edge, with seven small round pins arranged inside the circle, and a short matte black grip. No large DC pins, no lower CCS pin pair, no CHAdeMO head.

MODEL CODE
The model code W7, exactly two characters, in small dark navy (#07203D) uppercase text, centered on the lower front face, well below the screen and clearly separated from the brand lockup. No other text, number or marking anywhere on the unit.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

OVERRIDE FOR THIS PIECE
Where the style block above mentions cables on holsters at both sides, this wallbox has one cable and one holster only, on the right side.

BACKGROUND AND OUTPUT
Square 1:1, 1500x1500 px. Background pure white #FFFFFF and nothing else: no wall, no floor, no pedestal, no stand, no environment, no gradient. This is a wallbox, so it fills about 55% of the frame height, centered with generous equal white margin on all four sides. One soft contact shadow at 20% opacity directly beneath and slightly behind the unit, nothing else touching the ground. Clean commercial catalog cutout, edges crisp and ready for masking.
```


### Negative

```text
no second cable, no second charging cable, no second holster on the left side, no dual-connector wallbox, no CCS2 or CCS Combo head, no CHAdeMO head, no large DC power pins, no lower DC pin pair under the AC circle, no cable lying on the ground, no cable draped off frame, no wall, no wall panel, no brick or tile surface, no mounting board or backplate visible, no pedestal, floor stand or pole, no floor line, no glowing RGB light ring, no rainbow or multicolor LEDs, no legible numbers, kW, kWh, amps, volts, percentages or clock on the screen, no spec stickers, certification seals, QR codes, app-store badges or partner logos, no other text or numbers besides NEXUS and W7, no misspelling of NEXUS, no extra letters, no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of field, no lens flare, vignette or colored rim light, no logos other than NEXUS, no people, cars, showroom or outdoor scene, no watermark
```


### O que conferir

Ordem de conferencia antes de aceitar a imagem do W7:

1. CABO — erro numero 1. O ESTILO_BASE pede "cables coiled neatly on holsters at both sides" (linguagem de gabinete de chao) e o modelo vai tentar botar dois cabos no wallbox. Tem que sair UM cabo e UM suporte, do lado direito, lado esquerdo limpo. Se saiu dois, descarta e regera; nao tenta consertar no pos.
2. CONECTOR — contar os pinos. Tipo 2 e um circulo chanfrado (topo reto) com 7 pinos redondos pequenos. Se aparecer dois pinos GRANDES embaixo do circulo, o modelo desenhou CCS2 (que e a linha DC, D60-D240) e a peca esta errada. Esse e o segundo erro mais comum porque os prompts da familia falam CCS2 nas outras 5 pecas.
3. WORDMARK — contar as letras: N-E-X-U-S, cinco. "NEXSUS", "NEXVS", "NEXUSS" e letra a mais no fim acontecem direto. Ampliar 200% antes de aprovar.
4. MONOGRAMA — perna ESQUERDA azul solida, perna DIREITA verde solida, diagonal em degrade descendo azul (topo esquerdo) para verde (base direita). Inversao de lado e o defeito classico; se inverteu, e caso de compor o vetor real por cima no pos (plano B da nota 4 do padrao).
5. CODIGO W7 — deve aparecer so uma vez, pequeno, azul-marinho, na parte de baixo da face, longe do lockup. Se virou "W7 kW", "7.3", "W-7" ou colou no NEXUS, refaz. Nenhum outro texto na peca.
6. ESCALA — 55% da altura do quadro, NAO 80%. Se o wallbox encheu o quadro ele vai parecer do tamanho de um D160 quando as 9 pecas entrarem no mesmo grid. Medir de verdade (altura da peca / 1500).
7. TELA — interface azul abstrata com um arco de carga e mais nada. Zero numero legivel, zero selo, zero badge de loja. E o unico lugar onde a invencao entra sozinha.
8. FUNDO — branco #FFFFFF puro. Nada de parede desenhada, suporte cinza, piso ou reflexo. So a sombra de contato suave embaixo/atras.
9. RECORTE — o PNG transparente e POS-producao com mascara suave, nunca pedido no prompt. Se a imagem ja veio com xadrez cinza, o modelo desenhou o xadrez: descarta.
10. TEXTO DE APOIO — os diferenciais (peca de reposicao no Brasil, pronta entrega, OCPP 1.6J aberto, NEXUS REDE / PAINEL / 24, 7,3 kW, Tipo 2) vao AO LADO da peca no layout, nunca dentro da imagem. Nada de contador de estacoes, MWh, recargas, depoimento ou logo de parceiro: nao ha lastro.


## 7. `w11.png` — nexus-w11

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
NEXUS W11 wall-mounted AC electric-vehicle charging station (wallbox), one single unit, shown alone. Upright rounded-rectangle housing in portrait proportions, about 1.6 units tall by 1 unit wide by 0.55 unit deep (roughly 340 mm tall, 210 mm wide, 115 mm deep), soft 20 mm corner radius, slightly domed front face, one-piece matte white powder-coated shell with a thin brushed silver seam running around the perimeter where the front cover meets the back plate. The unit stands upright with its flat bottom edge meeting the white surface. The upper front panel carries the brand lockup described below. Directly under the lockup, in the middle of the front face, a small dark charcoal recessed screen set flush into the panel. Below the screen, a shallow recessed circular card-reader pad about one third of the housing width, matte dark grey with a fine brushed silver ring, marked only by three thin engraved concentric arcs and nothing else: no lettering, no payment mark, no wireless icon. A slim status light strip across the bottom edge of the front face glows a soft even blue. This charger carries exactly one tethered charging cable and exactly one connector holster, both on the right side of the housing only: the thick matte black cable leaves the housing through a rubber strain-relief gland at the lower right, hangs in three neat even loops on a molded holster on the right flank, and ends in a single Type 2 vehicle connector, a round matte black body with a light grey face, a flattened straight top edge and seven small round pins, docked head-down into its matching dock on the right side. The left side of the housing is a clean blank panel: no cable, no holster, no socket, no opening. The rear mounting plate is hidden: no visible screws, no bracket, no wall, no pedestal, no cable running into a wall. One soft contact shadow beneath the bottom edge of the unit only.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Model code, stated explicitly for this piece: the characters W11, exactly three characters, W-1-1, no other digits or letters, printed small in solid dark navy (#07203D) centered directly under the wordmark at about one quarter of the wordmark cap height. That is the only other mark anywhere on the cabinet.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.
```


### Negative

```text
two cables, second cable, second holster, cable on both sides of the unit, extra connector, coiled cable on the left side, opening on the left flank; CCS2 connector, two extra DC pins below the connector, CHAdeMO, Type 1, J1772, fuel nozzle shape, household plug, bare cable end; payment network logo, contactless payment mark, wifi icon, bluetooth icon, RFID lettering, keypad, labeled buttons; wall, brick, drywall, tile, mounting bracket, visible screws, anchors, pedestal, floor stand, second unit, hand or arm; legible numbers, kW figure, voltage or amperage text, spec sticker, certification seal, QR code, app store badge, partner logo, tagline, extra letters in NEXUS, misspelled wordmark, six-letter wordmark, reversed blue-to-green gradient, gradient on the vertical legs; transparent checker pattern, grey checkerboard, reflective floor, horizon line, gradient background, shadow cast on a wall, drop shadow, bokeh, shallow depth of field, lens flare, vignette, colored rim light, people, cars, showroom, outdoor scene, watermark.
```


### O que conferir

O erro nº 1 nesta peça é CABO DUPLO: o ESTILO_BASE diz "cables ... at both sides" e ele fica no fim do prompt (posição de maior peso). Confira: um cabo só, na DIREITA, com um único suporte; flanco esquerdo liso, sem furo nem segundo conector. Se sair dois, é descarte direto.

Segundo erro: o CONECTOR. Tem que ser Tipo 2 (corpo redondo com o topo achatado reto, sete pinos pequenos). O modelo troca por CCS2 (dois pinos grandes embaixo — esse é da linha DC, não do wallbox), por J1772 ou por bico de combustível. Olhe a face do plugue com zoom antes de aceitar.

Terceiro: a marca. NEXUS com CINCO letras (N-E-X-U-S), sem letra extra nem letra comida; o N de três peças com a perna esquerda AZUL, a diagonal descendo azul→verde (topo-esquerda azul, pé-direita verde, nunca invertido) e a perna direita VERDE sólido — as pernas não podem ter degradê. O W11 tem que ler W-1-1, não WII, W1, W111 nem W11.. Se o logo ou o W11 driftar (vai driftar em 9 peças), regere com a face do gabinete limpa e componha o vetor real do NEXUS + o código por cima no pós — é o plano garantido da Nota 4.

Quarto: o pad de aproximação é onde entra logo de bandeira sem pedir. Só três arcos concêntricos gravados. Se aparecer marca de pagamento por aproximação, wifi ou bluetooth, refaz — logo de parceiro é justamente o que não temos lastro pra mostrar.

Quinto, o resto do checklist: tela acesa sem NENHUM número legível (só a interface azul abstrata e o arco); nada de "11 kW", selo, adesivo, QR ou etiqueta no gabinete; fundo branco puro #FFFFFF de ponta a ponta, sem xadrez cinza, sem parede, sem suporte, sem parafuso, sem chão espelhado; sombra SÓ de contato embaixo da borda inferior, nada projetado atrás; peça ocupando ~55% da altura (wallbox), centralizada, muito ar em volta — se ela sair do tamanho de gabinete de chão, a família desalinha no grid.

Operacional: (1) rode com o MESMO seed / style-reference das outras 8 peças — coerência de família vem daí, não de adjetivo; só a frase do produto muda entre os prompts. (2) NÃO peça fundo transparente ao modelo: gera no branco e recorta depois com máscara suave, senão a sombra de contato sai com borda dura. (3) Toda prova técnica (11 kW trifásico, Tipo 2, OCPP 1.6J aberto, peça de reposição no Brasil, pronta entrega, NEXUS REDE / NEXUS PAINEL / NEXUS 24) vai como TEXTO AO LADO da imagem na página, nunca impressa no gabinete — é a adaptação honesta no lugar de contador de estações, depoimento ou selo de loja, que não existem hoje. (4) Se o resultado vier com fundo não-branco ou enquadramento errado, suspeite de truncamento do prompt (~550 palavras) antes de sair reescrevendo texto.


## 8. `w22.png` — w22

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
=== SUBJECT ===
Product render of one single NEXUS W22 AC charging station: a 22 kW three-phase Type 2
wallbox built as a twin charge point on one free-standing floor pedestal, with two charging
cables, one on each side. One unit only, centered, nothing else in the frame.

=== PRODUCT / PHYSICAL BUILD (follow exactly, do not invent extra parts) ===
Overall proportion: a slim vertical column standing on the floor, about 1.35 m tall in total,
roughly 4.5 times taller than it is wide, clearly a floor pedestal and not a box hanging on a
wall. Column: rectangular cross-section about 22 cm wide by 15 cm deep, flat front face, softly
radiused vertical edges, matte white powder-coated steel, one narrow brushed silver trim line
down each front corner, a low brushed silver kick strip at the bottom. Base: a shallow flared
floor plate about 35 x 30 cm in the same matte white, sitting flat on the ground with four small
countersunk anchor points; no wall bracket, no wall plate, no concrete plinth, no ground box.
Head section: the upper third of the column widens slightly into one housing that carries TWO
identical charge heads, side by side on the SAME front face, mirror-symmetric, each head about
30 cm tall and 19 cm wide with rounded vertical corners, separated by a thin brushed silver seam.
Exactly two charge heads, not one, not three.
Screens: each head has its own small dark charcoal screen, portrait orientation, recessed flush
into the upper area of that head, lit with an abstract deep-blue interface and one simple charge
arc — soft glow only, no readable characters, no digits, no percentage, no app icons.
Status light: one narrow vertical bar of soft blue glow inset along the outer edge of each head,
with no text beside it.
Cables: exactly two cables, one per head, matte black, about 20 mm thick, each leaving the unit
through a small rubber strain-relief gland on the LOWER OUTER SIDE of its own head — the left
cable exits left, the right cable exits right, nothing exits the front or the back. Each cable
hangs in a neat figure-eight coil over a curved matte white holster arm on its own side of the
column, at about two thirds of the column height.
Connectors: at the end of each cable a Type 2 AC connector — a short rounded black plastic handle
with a matte grey grip and a small release lever on top, and a mating face that is ONE round disc
with a flat top edge holding seven small round pin holes. AC only: there must be no second section
below the circle, no two large DC pins, no CCS2 lower part. Each connector is parked nose-down in
a matching white dock cup on its own side of the column, with the cable coiled beneath it.
Left and right sides are exact mirror images of each other. No socket outlets, no RFID pad
graphic, no push buttons, no vents on the front face, no second pedestal, no extra cabinet.

=== BRAND ON THE UNIT ===
Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Placement on this unit: "the upper front panel" here means the flat white face of the column
directly BELOW the two charge heads, on the widest part of the front. The lockup appears exactly
once on the whole product — never repeated on the heads, the holsters, the cables, the connectors
or the base plate.

=== STYLE, CAMERA, LIGHT ===
Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

Framing note for this unit: it stands on the floor but it belongs to the wallbox family, so the
whole pedestal, from base plate to the top of the heads, fills about 55% of the frame height,
centered, with wide and equal white margin on all four sides. The single soft contact shadow sits
directly under the base plate only. The three-quarter rotation stays small enough that both charge
heads and both cables remain clearly visible.

=== BACKGROUND AND OUTPUT ===
Seamless pure white #FFFFFF background, flat and empty: no horizon, no gradient, no floor
reflection, no checkerboard, no props, no second object. Product cleanly cut out and centered with
generous white space around it. Square 1:1, 1500 x 1500 pixels, crisp edges suitable for masking
the product out afterwards.
```


### Negative

```text
transparent checker pattern, checkerboard background, reflective or glossy floor, horizon line, gradient background, environment, showroom, garage, parking lot, outdoor scene, car, person, hands, bokeh, shallow depth of field, lens flare, vignette, colored rim light, hard cast shadow, drop shadow, second shadow, floating product, invented text, lorem ipsum, spec stickers, certification seals, CE or UL marks, QR codes, badges, app store badges, partner logos, legible numbers, kW figures, model codes, price tags, taglines, any logo other than NEXUS, misspelled NEXUS, NEXXUS, NEXUSS, NEUXS, extra or missing letters, six letter wordmark, reversed blue to green gradient, green left leg, blue right leg, outlined beveled or glossy logo, logo repeated on base or holster, CCS2 connector, DC pins, two large pins below the round face, CHAdeMO, NACS, Tesla connector, single cable, three or more cables, cable lying on the floor, tangled cable, cable exiting the front, wall bracket, wall mount, mounted on a wall, two separate pedestals, one charge head, three charge heads, heads on opposite faces, socket outlet without cable, readable digits on screen, percentage on screen, watermark, signature, tiled or duplicated product, collage, multiple views
```


### O que conferir

Confira nesta ordem, com zoom de 200% antes de aceitar:

1) CONECTOR — o erro numero um desta peca. W22 e AC: o Tipo 2 e SO o disco redondo com o topo chato e 7 furinhos. Se aparecerem dois pinos grandes embaixo do circulo, virou CCS2 (DC) e a imagem esta mentindo a ficha tecnica. O modelo puxa pra CCS2 porque o resto da familia (D60-D240) e DC. Descarta e regera.

2) NUMERO DE CABOS — tem que ser exatamente 2, um saindo pela lateral inferior de cada cabeca, esquerda pra esquerda e direita pra direita. Sai muito com 1 cabo so (ele "economiza" o segundo), com 3, ou com o segundo cabo escondido atras do poste. Como a camera gira 15 graus, um cabo mal posicionado some.

3) DUAS CABECAS NA MESMA FACE — tem que ser duas cabecas identicas e espelhadas, lado a lado, na frente. O jeito errado classico e ele fazer uma cabeca so mais larga com duas telas, ou colocar uma cabeca de cada lado do poste (frente e verso) — nesse caso o segundo ponto de recarga simplesmente nao aparece.

4) MONOGRAMA — perna esquerda AZUL solida, diagonal em degrade azul->verde, perna direita VERDE solida. Inverteu as cores, descarta ou compoe o vetor real por cima no pos (plano B previsto no padrao).

5) WORDMARK — conte as letras uma a uma: N-E-X-U-S, cinco. Letra a mais ou a menos e o defeito mais frequente e o que mais passa batido em olhada rapida. E logo UNICO na peca: ele adora repetir o N na base, no holster ou na cabeca.

6) TELA — pode ter brilho azul e o arco, nao pode ter numero legivel, porcentagem, relogio nem badge de loja de app. E o unico ponto da imagem onde ele inventa sozinho.

7) PEDESTAL — a base tem que encostar no chao com a sombra de contato so embaixo dela. Se aparecer suporte de parede, furacao de parede ou o poste flutuando, descarta.

8) ESCALA — 55% da altura do quadro, mesmo sendo peca de chao (o pedestal tem ~1,35 m contra ~1,9 m dos gabinetes DC, entao 55% contra 80% da o mesmo grid). Se sair em 80% ele briga com os D no catalogo.

9) O codigo W22 NAO vai no render de proposito — numero legivel na peca e justamente o que mais dribla e sai como "22kW" torto ou "W2Z". Se voce precisar do codigo no catalogo, ele entra no pos junto com o vetor do logo. Especificacao (22 kW, trifasico, Tipo 2, OCPP 1.6J) vai em texto ao lado da peca, nunca impressa no gabinete — e nada de selo de certificacao, contador de estacoes ou badge de app, que nao temos lastro.

10) FUNDO — gera no branco #FFFFFF mesmo. Se pedir transparente ele desenha o xadrez cinza. O PNG transparente sai no pos, com mascara suave, senao a sombra de contato fica com borda dura.


## 9. `display.png` — display

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
NEXUS DISPLAY, a tall free-standing DC fast-charging media totem for shopping mall and supermarket parking, shown as one single complete unit standing upright on the floor.

Physical build, follow it exactly. One slim rectangular slab cabinet about 2.30 m tall, 0.75 m wide and only 0.35 m deep, so the body reads as a thin vertical pillar, softly rounded vertical edges, flat top cap. It stands on a low matte dark-charcoal plinth about 80 mm high, slightly wider than the body, resting flat on the floor, never floating.

The upper 60% of the front face is one large portrait media panel, 9:16, 55-inch class, dark charcoal glass recessed a few millimetres behind a thin brushed silver bezel, matte non-mirroring surface. That large panel is lit only with a smooth abstract deep-blue gradient field and soft abstract light forms: no interface, no charge arc, no photographs, no advertising, no text, no numbers, no icons, no QR code, no logo, nothing legible, no reflection of any scene.

Directly below the media panel a horizontal brushed silver seam separates the media head from the charging section. Under that seam the matte white upper front panel of the charging cabinet is a clean flat brand band, full cabinet width and about 140 mm tall, and this band is the only place any brand appears on the whole unit. No model code, no kW figure and no product name printed anywhere on the unit.

Below the brand band, at about 1.10 m from the floor, a small landscape operator screen of about 8 inches, recessed and tilted a few degrees upward, dark charcoal, lit with the abstract deep-blue interface and one simple charge arc, no readable characters. This small screen is the only lit interface on the unit. Under it a plain recessed circular RFID tap area with no icon and no writing. No keypad, no coin slot, no card reader, no printed labels.

Exactly two matte black charging cables, one per side, symmetric: each leaves the cabinet through a rubber grommet on the flank at about 1.25 m from the floor, hangs in one neat coil and ends in a CCS2 connector parked nose-down in a molded black holster on that same side of the cabinet. Each connector is a CCS2 vehicle plug: round upper body with a small pin cluster and two large DC pins in a squared section below it, black housing, grey release lever. No third cable, no cable across the front face, no cable lying on the floor.

Fine horizontal louver vents for the active cooling on both flanks in the lower third, subtle panel seams and flush fasteners on the white powder-coated steel skin. No wheels, no handles, no open doors. Proportion check: the unit is six to seven times taller than it is deep and reads as human-height equipment, not a vending machine, an ATM, a fridge or a kiosk; being the tallest unit of the family it must still fill about 80% of the frame height.

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Studio product render, not a photograph. Single charging unit centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: floor units fill ~80% of frame
height, wallboxes ~55%, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.
```


### Negative

```text
no advertising content on the media panel, no photographs, faces, products, food, cars, prices, price tags, app-store or play-store badges, QR codes, social icons or partner logos on either screen; no reflections of any scene, people, car, ceiling light or interior in the screen glass, no mirrored or glossy piano-black glass; no legible text or numbers anywhere except the NEXUS wordmark, no letters other than N-E-X-U-S, no misspelling such as NEXSUS NEXUSS NEXVS, no second wordmark, no repeated logo, no logo on the media panel, no tagline, no model code, no kW figure, no CE/UL/certification seal, no spec sticker, no serial plate; no fourth stroke or fused strokes in the N monogram, no inverted gradient with green at the top-left, no outline, bevel, gloss or shadow on the logo; no third cable, no single cable, no cable on the front face, no cable lying on the floor, no detached or floating cable, no Type 2 only connector, no CHAdeMO, no NACS, no household plug, no nozzle or fuel pump shape; no keypad, no coin slot, no receipt printer, no card slot, no handles, no wheels, no open door, no vending machine, ATM, refrigerator, arcade cabinet or kiosk look; no second unit, no duplicate, no cropped unit, no tilted or leaning cabinet, no floating base, no transparent-checker pattern, no reflective or textured floor, no gray gradient background, no horizon line, no environment, no people, no bokeh, no lens flare, no vignette, no colored rim light, no watermark.
```


### O que conferir

Erros que essa peca comete mais que as outras da familia:

1. TELA GRANDE INVENTANDO PROPAGANDA. E o maior risco. Totem de shopping puxa o modelo pra desenhar anuncio: carro, rosto, preco, QR, logo de loja, badge de app. A tela de midia tem que sair como campo azul abstrato, SEM interface e SEM arco. O arco fica so na telinha do operador (8"). Se sair arco nas duas, tem duas UIs brigando e a peca deixa de casar com o resto da familia. Rejeita e regera.
2. REFLEXO NO VIDRO. E a maior area de vidro da linha; o modelo adora colocar teto de estudio, luz, gente ou carro refletido. Amplia a 200% e varre o vidro inteiro antes de aceitar.
3. WORDMARK. Confere no zoom 100%: NEXUS com CINCO letras, legivel na faixa branca. O monograma N precisa ter 3 tracos separados com folga entre eles, perna esquerda AZUL, perna direita VERDE, e o degrade da diagonal descendo azul (cima-esquerda) -> verde (baixo-direita). Degrade invertido e o defeito mais comum. Marca aparece UMA vez so, na faixa; se aparecer tambem na tela grande, e refugo. Plano B (recomendado nessa peca): gerar com a faixa branca limpa e compor o vetor real do NEXUS por cima no pos.
4. FAIXA DA MARCA ESMAGADA. Se a faixa sair fina demais, o modelo espreme o lockup e vira borrao, ou migra a marca pra cima do vidro. Faixa cheia (largura toda do gabinete, ~140 mm) e lockup ocupando ~60% dela.
5. CABOS E CONECTOR. Tem que ser DOIS cabos, um de cada lado, simetricos, saindo pela LATERAL (nao pela frente), cada um num coldre com o CCS2 de bico pra baixo. Confere o conector: parte redonda em cima com os pinos pequenos e DOIS pinos grandes de DC embaixo. Se sair so a parte redonda e Tipo 2 (AC) e esta errado pra linha DC.
6. ESCALA. O totem e alto e fino, entao o modelo tende a encolher a peca pra "equilibrar" as margens laterais. Mede: a altura do produto tem que dar ~1200 px de 1500 (80%). Se sair menor, quando colocar do lado do D60 ele parece de outra familia.
7. PROPORCAO DO CORPO. Profundidade so 0,35 m. Se o gabinete engordar, vira geladeira/maquina de refrigerante. Base tem que tocar o chao (sem flutuar) e a sombra e SO de contato, sem chao espelhado.
8. FUNDO. Antes de recortar, checa os 4 cantos: tem que ser #FFFFFF puro, sem degrade cinza. Recorte por mascara suave, nunca varinha magica, senao a sombra de contato fica com borda dura.

Nao pedir fundo transparente no prompt (o modelo desenha o xadrez). Nada de numero de estacao, MWh, recarga, selo ou depoimento na tela — a prova tecnica (kW, CCS2, refrigeracao ativa, OCPP 1.6J, peca no Brasil, NEXUS REDE/PAINEL/24) vai no texto ao lado da imagem, nunca dentro dela.


## 10. `hero-familia-dc.png` — hero-familia-dc

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
SUBJECT
Studio product render of three NEXUS DC fast chargers from the same product family, standing side by side in one straight row on a seamless pure white background, ordered left to right from smallest to largest, all three built in the identical design language, all three feet resting on the same invisible floor line, all three rotated to the same camera angle: a catalogue family portrait of one product line in three sizes.

PRODUCT DETAIL
All three are free-standing floor cabinets: flat-topped rectangular pillars with softly radiused vertical corners and a slim recessed plinth at the base, matte white powder-coated steel bodies, brushed silver trim strips running down both vertical front edges, subtle horizontal panel seams, and a discreet slotted ventilation grille across the lower third of each side panel.
Front face layout, identical on all three units: the NEXUS brand lockup printed flat and large across the upper front panel; directly below it a dark charcoal touchscreen recessed into the panel at chest height (about 1.2-1.4 m from the floor), tilted very slightly upward, lit with an abstract deep-blue interface and one simple charge arc and no readable characters; below the screen a plain unbroken panel with no stickers, sockets, labels or handles.
Cables, exactly the same on every unit: two matte black charging cables per cabinet, one on each side. Each cable leaves the cabinet through a rubber grommet high on that side panel, hangs in one neat relaxed coil against the side, and ends in a black CCS2 combo connector (Type 2 head with the two large DC pins below it) docked nose-down in a moulded holster on that same side. Two cables per unit, six cables in the whole image, every connector holstered, no cable lying on the floor, no cable crossing between units.
Relative proportions, to be kept exact and clearly visible: the left unit is the slimmest and shortest, roughly 1.7 m tall and about one third as wide as it is tall, shallow depth; the centre unit is noticeably taller and wider, roughly 1.9 m tall; the right unit is the largest, roughly 2.1 m tall, close to twice the width of the left unit, deeper cabinet with a taller ventilation grille. Same family, three different sizes: the height step and the width step between the three must read at a glance, they are not clones. Even empty gaps between the units, no unit overlapping or touching another, all three complete inside the frame with nothing clipped.

BRAND ON THE UNITS
Apply the following brand lockup identically, at the same relative size and the same relative height, on the upper front panel of each of the three cabinets:

Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

This prompt does NOT state a model code: no model number, no kW figure, no price and no other text anywhere in the image, on any of the three cabinets.

STYLE, CAMERA, LIGHT, BACKGROUND, OUTPUT
Studio product render, not a photograph. Three charging units side by side, centered as one group
on a seamless pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables
coiled neatly on holsters at both sides. Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: the row of three floor units fills
~80% of frame width, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

FAMILY-SHOT NOTES (three units, same grid)
1. The subject is the row of three, treated as one centered block: equal margin left and right, generous empty white above and below, the tallest unit reaching about half the frame height.
2. Camera pulled back far enough to hold all three in one frame, still at chest height and still rotated ~15 degrees off-axis so every front face and every logo reads; no wide-angle stretch and no leaning verticals on the outer two units.
3. Shadow: one soft contact shadow directly under each base only, 20% opacity, three separate shadows on the same floor line, no shared cast shadow, no reflection, no floor plane.
```


### Negative

```text
no transparent-checker pattern, no reflective floor, no floor plane or horizon line, no bokeh or shallow depth of field, no lens flare, vignette or colored rim light, no invented text, spec stickers, certification seals, QR codes, badges or legible numbers, no model code or kW figure on the cabinets, no logos other than NEXUS, no people, cars, showroom or outdoor scene, no watermark; not a single unit alone, not two units, not four or more units; no three identical same-size clones, no cabinets overlapping or touching each other, no unit clipped or cut by the frame edge, no unit rotated to a different angle than the others; no cable on the floor, no uncoiled or tangled cable, no cable crossing between units, no CHAdeMO, Type 1, NACS or fuel-nozzle connector, no gun left out of its holster; no leaning, stretched or wide-angle-distorted verticals on the outer units; no wordmark with more or fewer than five letters, no misspelling of NEXUS, no gradient running green-to-blue instead of blue-to-green, no outlined, beveled or glossy logo, no logo differing between the three cabinets
```


### O que conferir

Peça mais difícil das 9: o logo aparece 3x e a contagem de objetos é a parte que o modelo mais erra.

O que costuma sair errado
1. Vem UM carregador só, ou dois, ou quatro. É o erro nº1 de peça em grupo. Antes de gerar, dê um Ctrl+F em "single" no prompt colado — a única ocorrência permitida é "the single word NEXUS". Se a palavra aparecer em outro lugar, o modelo vai desenhar um gabinete só.
2. Três clones do mesmo tamanho. O valor da imagem é a escada D60 → D120 → D240. Meça na tela: o da direita tem que ser visivelmente mais alto E quase o dobro da largura do da esquerda. Se os três têm a mesma altura, refaz.
3. Cabos: são 6 no total (2 por gabinete, um de cada lado), todos com o conector encaixado no coldre, nenhum no chão e nenhum atravessando de um gabinete pro outro. Confira também o bico: CCS2 é a cabeça Tipo 2 com os DOIS pinos grandes de DC embaixo — o modelo adora entregar CHAdeMO, Tipo 1 ou bico de bomba de gasolina.
4. Logo (o pior): confira duas coisas SEPARADAS — (a) cada logo está certo (N de 3 traços, perna esquerda azul, diagonal azul→verde da esquerda pra direita, perna direita verde, wordmark com 5 letras N-E-X-U-S); (b) os três logos são IGUAIS entre si. A falha típica é um certo e dois com a diagonal invertida. Julgue a legibilidade pelo gabinete da ESQUERDA, que é o menor — se o wordmark borrar ali, rejeita.
5. Perspectiva: gabinete das pontas inclinado ou esticado por lente larga. As arestas verticais das três peças têm que estar quase verticais e os três pés na mesma linha de chão.
6. Tela: interface azul abstrata + um arco. Nenhum número, porcentagem, relógio, preço, selo ou badge de loja legível. Isso vale para as três telas.
7. Fundo: branco 255 puro, sem linha de horizonte, sem piso refletindo, três sombras de contato separadas (uma por base). Se aparecer piso espelhado ou o xadrez cinza, rejeita — quebra o recorte.

Pós-produção
Gerou no branco #FFFFFF de propósito (modelo não emite alfa). Recorte com máscara suave, nunca varinha mágica, senão a sombra de contato sai com borda dura. Saída final: PNG 1500x1500 transparente. Se o hero do site precisar de faixa panorâmica, corte a faixa do PNG recortado — não regere em 16:9, senão essa peça sai do mesmo grid das outras 8.
Plano B do logo (recomendado se der 2 tentativas ruins): gerar com a face dos gabinetes limpa e compor o vetor real do NEXUS 3x por cima, escalando proporcional ao tamanho de cada gabinete.

Adaptação honesta (isto é hero, é exatamente onde a Joult põe contador de estações)
Nada de número na imagem e nada de selo no gabinete. Sem contador de estações/usuários/MWh/recargas, sem logo de parceiro, sem depoimento e sem badge de App Store/Play Store — não temos lastro pra nada disso. Os rótulos e a prova vão como TEXTO HTML ao lado/abaixo da imagem, onde dá pra editar e conferir: "NEXUS D60 · 60 kW", "NEXUS D120 · 120 kW", "NEXUS D240 · 240 kW", e a linha de verdades — todos CCS2, refrigeração ativa, OCPP 1.6J aberto (não prende plataforma), peça de reposição no Brasil, pronta entrega, NEXUS REDE / NEXUS PAINEL / NEXUS 24. Prova técnica no lugar de prova social que ainda não existe.


## 11. `app-rede.png` — app-rede

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
Studio product render, not a photograph: a single modern smartphone standing upright on its bottom edge, centered, displaying the NEXUS REDE charging app.

PRODUCT PHYSICS. One phone only, bar-shaped slab about 146 mm tall x 71 mm wide x 8 mm thick, corner radius about 12 mm, matte dark charcoal anodized aluminium frame with a thin flat chamfer, flat cover glass with a uniform 3 mm black bezel on all four sides, front face only, no camera island, no notch, no punch-hole, no button detail visible, no manufacturer logo anywhere on the body. The phone rests on its bottom edge and is turned so the display faces the lens almost perfectly square-on, screen fully readable, no keystone, no tilt of the screen away from camera. The display is rendered perfectly flat and matte: no glass glare, no reflection, no highlight streak, no curvature or bending at the glass edge, no fingerprint.

SCREEN LAYOUT, flat vector UI, solid fills only, no gloss, no glassmorphism, no drop shadows inside the interface. No status bar at all: no clock, no carrier name, no battery or signal icons. Top edge of the screen is a solid dark navy (#07203D) app bar about 9% of screen height, containing the brand lockup and nothing else. Upper 55% of the screen is a map: flat abstract vector street grid, very light warm grey blocks (#EEF1F5) on white with thin white road lines and one soft pale blue water shape, completely unlabeled — no street names, no city name, no district name, no place or POI labels, no compass rose, no scale bar, no attribution strip, no search field, no floating buttons, no text of any kind on the map. Exactly 4 plain teardrop map pins, empty inside, three in solid emerald green (#00C46A) and one larger selected pin in vivid electric blue (#0B5CFF) with a single thin translucent blue ring around its base. Lower 45% of the screen is one white station card with 16 px rounded top corners sitting flush to the bottom of the screen, containing, stacked and left-aligned: a small solid emerald green (#00C46A) status dot with no word beside it; a bold dark navy heading reading NEXUS D80; a lighter grey specification line reading 80 kW · CCS2; a large bold dark navy price line reading R$ 2,49/kWh; and, at the bottom, one full-width pill button, corner radius 28 px, filled with a left-to-right gradient from vivid electric blue (#0B5CFF) to bright emerald green (#00C46A), with the label INICIAR RECARGA centered in pure white heavy uppercase geometric sans-serif, spelled I-N-I-C-I-A-R space R-E-C-A-R-G-A. Nothing else on the card: no icons, no thumbnail photo, no star rating, no distance, no counters, no second button, no list of other stations behind the card.

Brand lockup applied large and flat in the app top bar at the top of the phone screen, printed on the surface, perfectly straight, sharp and fully legible, occupying about 60% of the top bar width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

Because the app bar is solid dark navy (#07203D), the wordmark there is pure white, and no word other than NEXUS appears in the lockup.

Studio product render, not a photograph. Single smartphone centered on a seamless
pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte dark charcoal anodized
aluminium frame with a thin brushed chamfer, flat non-reflective cover glass, uniform black
bezel, flat vector interface printed crisply on the display with no glare and no reflection.
Shadow: one soft contact shadow directly beneath
the base only, 20% opacity, no cast or drop shadow. Framing: the phone fills ~70% of frame
height, always centered with equal margin on all sides. Square 1:1,
1500x1500, clean commercial catalog look.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, cars, showroom or outdoor scene, no watermark.

The single scoped exception to the negative above: exactly five text elements render sharp and fully legible, and no others — the NEXUS wordmark in the app bar, NEXUS D80, 80 kW · CCS2, R$ 2,49/kWh, and INICIAR RECARGA. Every other surface in the image, the map included, carries no readable character at all.

Output: pure white (#FFFFFF) seamless background, product cut out with generous empty margin on all four sides, square 1:1, 1500x1500.
```


### Negative

```text
app store badge, google play badge, apple logo, android logo, phone manufacturer logo, status bar, clock, battery icon, signal bars, carrier name, wifi icon, street names, city name, POI labels, map attribution strip, compass rose, scale bar, search field, star rating, review text, testimonial, user avatar, profile photo, partner logo, station counter, user counter, kWh total, MWh total, session counter, coverage claim, more than four map pins, text inside pins, hand, fingers, arm, person, second phone, tablet, laptop, screen glare, reflection on glass, specular highlight on display, curved edge glass, notch, punch-hole camera, floating phone, drop shadow, cast shadow, reflective floor, gradient background, environment, desk, table, plant, car, charging station in frame, watermark, garbled letters, misspelled words, extra letters in NEXUS
```


### O que conferir

Confira nesta ordem antes de aceitar:
1. NEXUS tem 5 letras. Conte. O erro mais comum é NEXSUS, NEXVS ou NEXUSREDE colado.
2. A palavra REDE NÃO pode aparecer em lugar nenhum da imagem. É de propósito: o bloco de marca proíbe qualquer letra além de N-E-X-U-S no lockup. "NEXUS REDE" só existe no texto ao lado da peça, nunca dentro do render.
3. Diagonal do monograma: azul em cima à esquerda descendo para verde embaixo à direita. Inverte com frequência. Perna esquerda azul sólida, perna direita verde sólida.
4. Mapa: tem que estar 100% mudo. Modelo de imagem adora carpetar mapa de rótulo falso (nome de rua, "Av. Paulista", tarja de atribuição). Qualquer letra no mapa = descartar.
5. Pinos: exatamente 4, nenhum com número ou texto dentro. Mapa cheio de pino vira alegação de cobertura, e cobertura é justamente o que não temos lastro pra afirmar.
6. Barra de status: não pode existir. Se vier relógio, bateria ou nome de operadora, veio texto inventado junto.
7. Botão: INICIAR RECARGA escrito certo. Português quebra muito — sai RECARAGA, RECARCA, INICIAR RECARGA com uma letra a mais. Confira letra por letra.
8. Card: "NEXUS D80", "80 kW · CCS2" e "R$ 2,49/kWh" legíveis e sem dígito trocado (80 virando 8O, 2,49 virando 2,A9).
9. O preço R$ 2,49/kWh é valor de MOCKUP, não é preço nosso — quem define tarifa é o dono do ponto. Se a peça for para proposta de cliente específico, troque no pós pelo número dele. A potência 80 kW e o CCS2 são especificação real do D80, essas podem ficar.
10. Um telefone só, em pé apoiado na borda de baixo, sem mão segurando, sem flutuar. Sombra de contato só embaixo da borda inferior.
11. Tela fosca e frontal: se vier reflexo ou brilho de vidro, o pós de trocar texto fica impossível. Rejeite.
12. Nenhum logo de fabricante de celular no corpo do aparelho.
Plano B (mesma lógica do logo no gabinete): se o texto sair torto em qualquer campo, aceite o render pelo enquadramento e componha os 5 textos por cima em vetor. Por isso a UI está travada em preenchimento chapado, sem gloss e sem reflexo — é o que torna a troca no pós trivial.
Desvios do padrão (auditáveis): troquei 3 trechos do ESTILO_BASE, todos descrevendo o produto — "Single charging unit" virou "Single smartphone", a frase Materials (gabinete/cabos → alumínio/vidro/tela) e a frase Framing (80%/55% → ~70%, terceiro degrau criado de propósito porque aqui o conteúdo da tela é o assunto). Câmera, luz, sombra e Negative estão byte a byte iguais. No MARCA_NA_PECA mudei só a âncora de posição: "on the upper front panel of the cabinet" → "in the app top bar at the top of the phone screen" e "panel width" → "top bar width". O resto do bloco é idêntico.


## 12. `solucoes-carro-carregando.png` — nexus-solucoes-carro-carregando

**Estado:** **falta gerar**
  
**Proporção:** 1:1 1500x1500


### Prompt

```text
SUBJECT
A modern electric crossover parked at a NEXUS floor-standing DC fast charger and plugged into it, staged in a clean, bright, seamless white studio. Exactly two subjects: one charging cabinet and one car, nothing else. The cabinet stands upright in the left third of the frame and is the tallest object in the picture. The car sits to its right at a three-quarter front angle, front bumper pointing down-left toward the cabinet, so we read its front face and its whole left flank. One matte black cable runs from the right flank of the cabinet in a relaxed catenary curve down into the open charging inlet on the car's front-left fender: plugged in, latched, no slack pooled on the floor.

COMPOSITION (deliberate, do not "fix" it)
The car's body continues past the right edge of the frame: we see the front bumper, the front-left fender with the open charging flap, the front wheel, the mirror and the A-pillar, and the body leaves frame around the front door. This crop is intentional. Do not shrink either subject to make the whole car fit, and do not enlarge the car past the cabinet. Generous empty white margin above the cabinet and to its left; the asymmetry is intentional.

PRODUCT DETAIL - the charger
Floor-standing DC fast-charging cabinet, one single upright rectangular column: about 1.90 m tall, 0.75 m wide, 0.40 m deep, roughly 2.5:1 height to width, flat top with a softly rounded front edge, plain flat plinth base sitting flush on the floor, no bolts and no anchor plate visible. Matte white powder-coated steel body, brushed silver trim strips down both vertical front edges, one fine horizontal seam separating the upper front panel from the lower front panel. On the middle of the front face, centred at about 1.25 m height, one dark charcoal recessed screen, portrait format, about 15 inches, tilted roughly 10 degrees up toward the user, lit with an abstract deep-blue interface and one simple charge arc: no digits, no percentage, no words, no icons, no menu. Below the screen one flat matte grey card-reader pad and a single row of three small unlit indicator dots; nothing else on the face. Two cables, one on each side, both identical: each leaves the cabinet through a black rubber strain-relief gland high on its side panel near the top, never from the floor and never through the screen. The left-side cable is coiled neatly on its holster on the cabinet's left flank with its connector parked head-down; the right-side cable is the one in use.
Both connectors are the same CCS2 head: matte black housing, a round-topped Type 2 upper section with seven small pins, a lower squared-off section with two large DC pins, short grey release trigger on top, thick black cable about 30 mm in diameter. The in-use connector is fully seated in the car's matching CCS2 inlet with the body-colour flap swung open behind it.

PRODUCT DETAIL - the car
One generic modern electric crossover, five-door, completely unbranded: smooth closed front fascia with no radiator grille, slim full-width LED light bar, flush door handles, aerodynamic five-spoke silver alloy wheels, light warm-silver metallic paint with clean satin reflections, dark tinted glass, matte black lower cladding. No manufacturer badge, emblem, grille logo, model script, dealer sticker or licence plate anywhere on the body; plate recess left blank and clean. Silhouette generic enough that it matches no real-world model. Wheels straight, car level, tyres flat on the floor.

BRAND ON THE PRODUCT
Brand lockup applied large and flat on the upper front panel of the cabinet, printed on the
surface, perfectly straight, sharp and fully legible, occupying about 60% of the panel width.

Monogram, on the left: a capital letter N built from three separate straight strokes.
Stroke 1, the left vertical leg: solid vivid electric blue (#0B5CFF).
Stroke 2, the diagonal, running from the top of the left leg down to the foot of the right
leg: a smooth gradient from vivid electric blue (#0B5CFF) at the top-left to bright emerald
green (#00C46A) at the bottom-right.
Stroke 3, the right vertical leg: solid bright emerald green (#00C46A).
All three strokes share the same thickness, flat color, squared ends, a small even gap
between them, no bevel, no gloss, no outline, no drop shadow.

Wordmark, to the right of the monogram: the single word NEXUS, spelled N-E-X-U-S, exactly
five uppercase letters and no other letters. Heavy geometric sans-serif: very bold, uniform
stroke weight, closed apertures, flat terminals, letterforms built from circles and straight
lines, wide letter-spacing. Solid dark navy ink (#07203D) on the white cabinet; pure white
when it sits on a dark panel.

Monogram height equals the cap height of the wordmark and both sit on the same baseline.
No tagline, no second logo, no certification seal, no app-store badge, no partner mark, and
no model code unless this prompt states it explicitly.

STYLE, CAMERA, LIGHT
Studio product render, not a photograph. The charging unit and the car staged together on a
seamless pure white (#FFFFFF) background, no horizon line, no gradient, no environment.
Camera: 85-135mm equivalent lens, chest height (~1.3 m), rotated ~15 degrees off-axis
for a slight three-quarter front view, f/8-f/11, edge-to-edge sharp, minimal perspective
distortion. Lighting: large softbox key at 45 degrees, broad even fill, soft diffuse
falloff, no visible hotspots or colored rim light. Materials: matte white powder-coated
steel cabinet with brushed silver trim, subtle panel seams, dark charcoal recessed screen
lit with an abstract deep-blue interface and one simple charge arc, matte black cables, one
coiled neatly on its holster on the far side and one plugged into the car. Shadow: one soft
contact shadow directly beneath the cabinet base and directly beneath the tyres only, 20%
opacity, no cast or drop shadow. Framing: the floor unit fills ~78% of frame height and is
fully inside the frame; the car is lower, slightly behind, and deliberately crops at the
right edge. Square 1:1, 1500x1500, clean commercial catalog look.

BACKGROUND AND OUTPUT
Pure white #FFFFFF everywhere behind and around both subjects, flat and even, no wall, no
floor line, no reflection, no parking bay, no canopy. Square 1:1, 1500x1500 px.
Negative: no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of
field, no lens flare, vignette or colored rim light, no invented text, spec stickers,
certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no
people, showroom or outdoor scene, no watermark, no second car, no third cable, no second
charger, no parking lines, no bollards, no signage, no car manufacturer badge or licence
plate, no CHAdeMO or Type 1 or Type 2 AC connector head, no charge percentage or kW figure
on the screen.
```


### Negative

```text
no transparent-checker pattern, no reflective floor, no bokeh or shallow depth of field, no lens flare, vignette or colored rim light, no invented text, spec stickers, certification seals, QR codes, badges or legible numbers, no logos other than NEXUS, no people, showroom or outdoor scene, no watermark, no second car, no third cable, no second charger, no parking lines, no bollards, no signage, no canopy, no car manufacturer badge or emblem, no licence plate, no dealer sticker, no CHAdeMO or Type 1 or Type 2 AC connector head, no charge percentage or kW figure or clock on the screen, no cable pooled on the floor, no cable passing through bodywork, no fuel-filler door, no extra letters in the word NEXUS, no inverted or reversed blue-to-green gradient, no gloss or bevel or drop shadow on the logo
```


### O que conferir

AVISO DE PADRÃO — esta é a ÚNICA das 9 peças que é cena, não recorte de catálogo. O ESTILO_BASE proíbe "cars" e manda "single charging unit... no environment / 80% de altura / centralizado com margem igual". Peça e proibição não cabem juntas: colar o bloco byte a byte faria o modelo largar o carro OU largar o gabinete, porque Flux e Seedream tratam negação mal. Então mudei CIRURGICAMENTE 4 trechos e mais nada: (1) "Single charging unit centered" virou "the charging unit and the car staged together"; (2) a sombra passou a incluir os pneus; (3) o framing virou 78% + carro cortando na direita; (4) tirei "cars" do Negative. O bloco MARCA_NA_PECA está intacto, palavra por palavra. Todo o resto do ESTILO_BASE está igual.

CONTA QUE FORÇOU O CORTE: gabinete a 78% de um quadro 1:1 dá moldura de ~2,44 m de lado. Um crossover de 4,5 m em três quartos ocupa ~4,1 m de largura aparente. Não cabe. Se você pedir "carro inteiro + gabinete grande + 1:1", o modelo encolhe os dois e sobra um quadrado branco morto, ou inventa um carrinho de brinquedo. Por isso o corte do carro na borda direita está escrito como intencional. Se a seção Soluções for uma faixa larga no site, o certo é regerar em 3:2 (2100x1400) com a mesma seed, aí o carro inteiro cabe.

O QUE CONFERIR ANTES DE ACEITAR:
1. NÚMERO NA TELA. Esta é a peça de MAIOR risco da família nisso: carro plugado sugere carga acontecendo e o modelo quer pintar "80%", "45 kW" ou relógio. Qualquer dígito, % ou kW na tela = rejeitar e regerar. Só arco azul abstrato.
2. CONECTOR ERRADO NO SUPORTE. Modelos treinados em gabinete dual-standard dão CHAdeMO ou Type 2 AC pro cabo em repouso. NEXUS DC é TUDO CCS2. Olhe o conector guardado, não só o plugado: os dois têm que ter a mesma cabeça (parte redonda em cima + dois pinos DC grandes embaixo).
3. GEOMETRIA DO CABO. Exatamente 2 cabos, 1 plugado, 1 na forquilha. O cabo tem que sair da LATERAL alta do gabinete, não do chão nem da tela. Tem que entrar no bocal do para-lama dianteiro esquerdo com a tampa aberta atrás dele — não na grade, não numa tampa de combustível na traseira, não atravessando a lataria.
4. CARRO RECONHECÍVEL. Se a silhueta gritar um fabricante real, rejeite. Carro de marca real ao lado do nosso gabinete afirma uma parceria que não existe — mesma categoria do logo de parceiro na lista de PROIBIDO INVENTAR. Somos importadora/revenda, não temos acordo com montadora. Confira também: zero emblema, zero placa, zero adesivo de concessionária.
5. WORDMARK. Contar letra por letra: N-E-X-U-S, cinco. O erro clássico é NEXSUS/NEXUSS. E o degradê da diagonal do "N" tem que ir AZUL em cima-esquerda → VERDE embaixo-direita; invertido acontece direto. Perna esquerda azul sólida, perna direita verde sólida.
6. SOMBRA. Só contato: embaixo da base e embaixo dos 4 pneus. Se aparecer sombra projetada no chão ou reflexo de piso, o recorte pós vai ficar sujo.
7. ESCALA. O gabinete precisa continuar sendo o objeto mais alto e ficar inteiro no quadro. Se o carro virou o herói e o carregador ficou baixinho ao lado, regenerar — quebra o grid de 80%/55% das outras 8 peças.

TRAVAS DE FAMÍLIA: use a MESMA seed / style-reference do prompt de recorte do D80, e mantenha as medidas do gabinete idênticas às dos outros prompts D80 (1,90 × 0,75 × 0,40 m, tela a ~1,25 m, marca no painel superior). Se mudar aqui, a foto de cena e a de catálogo mostram dois produtos diferentes.

DECISÕES DE HONESTIDADE: não pedi código de modelo na face (regra 4 — menos texto, menos drift); se quiser "D80" ali, componha em vetor no pós junto com o logo real. Nada de contador de estações, MWh, recargas, logo de montadora ou selo de app na imagem — nada disso tem lastro. A prova fica no TEXTO ao lado da imagem, não dentro dela: 80 kW, CCS2, refrigeração ativa, OCPP 1.6J aberto, peça de reposição no Brasil, pronta entrega, NEXUS REDE / NEXUS PAINEL / NEXUS 24.

FUNDO TRANSPARENTE: gera no branco mesmo. Recorte depois com máscara suave (nunca varinha mágica), senão a sombra de contato dos pneus sai com borda dura e denuncia o recorte.


---

## Custo medido (Morphix, plano free)


| Modelo | Resolução | Créditos |
|---|---|---|
| google/nano-banana-2 | 2K | 8 |
| google/nano-banana-2 | 1K | 4 |


O plano free começou com 25 créditos e rendeu 5 imagens. Para as 7 que faltam,
são ~28 créditos em 1K.
