# Criativo de arrendamento: duas vagas
### Restaurante, supermercado, farmácia, academia, clínica e estacionamento · 30/set/2026

> **O pedido:** mostrar duas vagas ocupadas por carro elétrico, num estacionamento ou num
> restaurante, para o dono do comércio entender que aquele pedacinho do pátio vira parceria de
> eletroposto, movimento novo na loja e renda todo mês. Bem direcionado por segmento.
>
> **A ideia do criativo, em uma frase:** o dono não vê um carregador, vê **duas vagas dele**
> ocupadas e o comércio dele cheio atrás. O produto do anúncio é o espaço que ele já tem.
>
> **O que este criativo alimenta:** a lista de **arrendamento**, não a agenda. Está registrado
> em `criativos-catira-eletroposto` que o criativo de "cede o espaço" enche arrendamento e não
> marca reunião. Lá isso foi efeito colateral. Aqui é o objetivo, e a lista de ponto é a mais
> escassa da operação: 217 pessoas com capital para 17 com local.

Companheiro de [PROMPT-GPT-ARRENDAMENTO-PONTO.md](PROMPT-GPT-ARRENDAMENTO-PONTO.md), que é o
que o consultor usa quando o lead chega. Este é o que faz o lead chegar.

---

## 1. A regra física que o criativo não pode quebrar

**Um gabinete, duas vagas, dois carros.** Todas as configurações da linha têm **2 bicos**, e o
item 6 do `PONTO-CERTO-COMO-ESCOLHER.md` exige **2 vagas dedicáveis** ou o ponto é trava.

Então a cena obrigatoriamente mostra **um único carregador no meio de duas vagas**, com um cabo
saindo de cada lado e cada cabo ligado a um carro diferente. Desenhar um carregador por carro
ensina a coisa errada, e a primeira ligação de qualificação vai gastar tempo desfazendo.

É o detalhe que passa batido numa olhada rápida. Conferir peça por peça antes de subir.

## 2. Os segmentos, e o que cada número vale

Medido nas 462 reuniões da landing entre 17/07 e 28/09/2026.

| segmento | reuniões | avançou | taxa | permanência natural | leitura |
|---|---:|---:|---:|---|---|
| estacionamento | 64 | 17 | 26,6% | 20 a 60 min | A janela certa, e o produto do dono já é a vaga |
| academia | 13 | 3 | 23,1% | 60 a 120 min | Bico preso, mas o pátio costuma ser próprio |
| mercado e supermercado | 15 | 3 | 20,0% | 20 a 60 min | A janela certa, movimento próprio alto |
| restaurante | 29 | 2 | **6,9%** | 40 a 60 min | **A pior taxa medida da tabela** |
| farmácia | 6 | 4 | 66,7% | menos de 15 min | Melhor taxa, amostra de **6** |
| clínica | **não medido** | | | 30 a 60 min | Cai em "outro", que dá 29,9% em 144 reuniões |

Três coisas para dizer em voz alta antes de alguém decidir orçamento por esta tabela:

**Restaurante é o pior número medido, 6,9%.** Foi pedido no criativo e está entregue, mas ele
não merece o maior orçamento. A permanência é boa e o resultado é ruim, e quando a medição
contraria a dedução, quem manda é a medição.

**Farmácia tem a melhor taxa e a pior amostra.** São 6 reuniões, e uma a mais muda tudo.
⚠️ Recarga rápida pede 20 a 40 minutos de permanência e farmácia de rua é visita de 5 minutos:
o mais provável é que essas 6 sejam donos do imóvel aproveitando a vaga. O criativo de farmácia
foi desenhado para **loja de rede com estacionamento próprio**, que é onde a permanência existe.

**Clínica não tem número.** Nunca foi um perfil próprio na landing, cai em "outro". ⚠️ Entra
aqui por dedução: pátio próprio, paciente que fica de 30 a 60 minutos e dono que costuma ser
dono do imóvel. Suba com conjunto separado e deixe medir antes de crescer.

---

## 3. Bloco de estilo. Cola igual em todo prompt

O que faz os seis virarem uma família é o bloco abaixo colado byte a byte igual, com a mesma
imagem de referência. Só troca o parágrafo que descreve o comércio.

**ESTILO_CENA**

```
Photoreal commercial photograph, not an illustration and not a 3D render. Late afternoon golden
light, clear sky, natural directional shadows on clean asphalt. Camera at standing eye level
(about 1.6 m), 35mm equivalent lens, f/5.6, sharp from front to back, slight three-quarter angle
so that both parking bays and the storefront behind them read at the same time. Colour is warm
and saturated but natural: no HDR halo, no teal-and-orange grade, no bloom. The upper third of
the frame is open sky or plain facade, deliberately clean and uncluttered, because a headline is
laid over it afterwards. Brazilian street context: Brazilian commercial architecture, Brazilian
number-plate shape on the cars, tropical planting.
```

**COMPOSICAO_OBRIGATORIA**

```
Exactly ONE charging cabinet, standing centred between exactly TWO adjacent marked parking bays.
One thick black cable leaves each side of that single cabinet, and each cable is plugged into a
different car, so the two cars share one machine. Never draw a second cabinet. Never draw one
cabinet per car. Never draw a cable that is not connected to a car.
The cabinet must be the exact machine in reference image [1]: navy blue cabinet, bright emerald
green vertical stripes down both front edges, grey central column running down the front face,
black cable holsters on both flanks, same proportions, same colours, same printed markings.
Do not restyle it, do not recolour it, do not add badges to it.
The two bays are freshly painted with white lines and a green painted floor panel carrying a
simple plug pictogram. Pictogram only, no letters and no numbers on the floor.
Two ordinary modern mass-market electric cars, one white compact SUV and one dark grey sedan,
generic and unbranded, both plugged in, parked straight and neatly inside their bays.
```

**NEGATIVO**

```
No invented text of any kind: no words, no letters, no numbers, no signage copy, no price tags,
no posters, no banners. The only lettering allowed in the whole image is the wordmark already
printed on the reference cabinet. No second charger, no charger per car, no futuristic concept
car, no neon, no lens flare, no vignette, no tilt-shift, no motion blur, no watermark, no people
looking at the camera, no distorted hands or faces, no crowd, no rain, no night scene.
```

**Referência:** `https://solardoc.app/nexus/img/dc-perspectiva.webp` como `[1]` e
`https://solardoc.app/nexus/img/p-dc.webp` como `[2]`. São as vistas oficiais do gabinete final,
de 21/09/2026. Sem elas o modelo inventa uma máquina branca genérica, que é justamente o que
`capa.webp` faz hoje e o que a casa quer parar de mostrar.

---

## 4. Os seis prompts

Cada um é o parágrafo do comércio, seguido dos três blocos acima, nesta ordem. Formato 1:1 em
2K para o feed. Para story, o mesmo prompt com 9:16 e a observação de deixar o terço de cima e o
terço de baixo livres.

### 4.1 Restaurante

```
The two parking bays sit directly in front of a busy mid-range Brazilian restaurant at early
evening. Large glass front with warm interior light spilling onto the pavement, tables and
diners visible inside, a couple in casual clothes walking toward the entrance, a low planted bed
separating the bays from the door. The restaurant looks full and prosperous.
```

### 4.2 Supermercado e mercado de bairro

```
The two parking bays sit in the front apron of a neighbourhood supermarket in late morning. A
line of nested shopping trolleys against the wall, the automatic doors open, a woman pushing a
full trolley toward a car parked further away, produce crates visible just inside the entrance.
Ordinary, busy, everyday.
```

### 4.3 Farmácia de rede com estacionamento próprio

```
The two parking bays sit on the private apron of a modern chain pharmacy, the kind with a wide
clean glass front and its own small car park set back from the street. Bright interior lighting,
orderly shelves visible through the glass, a customer leaving with a small bag, a bicycle rack
at the side.
```

### 4.4 Academia

```
The two parking bays sit in the car park of a gym at the end of the afternoon. Tall windows
along the facade with treadmills and weight equipment visible inside, warm interior light, a
person in sportswear with a gym bag walking toward the entrance, a second person leaving with a
towel over the shoulder.
```

### 4.5 Clínica

```
The two parking bays sit in the small private car park of a neighbourhood medical clinic. Calm
low-rise building with a clean rendered facade, glass entrance with a canopy, planted beds along
the wall, an older patient walking slowly toward the door with a companion. Quiet, tidy,
professional.
```

### 4.6 Estacionamento rotativo e galeria comercial

```
The two parking bays sit in a paid surface car park beside a small commercial gallery, the two
electric bays placed nearest the pedestrian exit where they are most visible. Other ordinary
parked cars fill the rows behind, a small attendant booth at the entrance, shop fronts of the
gallery along the far side.
```

---

## 5. A copy

A chamada vai **por cima** da imagem, no pós, nunca escrita pelo modelo. Modelo de imagem
escrevendo português é onde sai anúncio com erro de ortografia.

### Chamada sobre a imagem, uma por segmento

| segmento | chamada, duas linhas | linha de apoio |
|---|---|---|
| Restaurante | Duas vagas. / Zero investimento. | Nós instalamos. Você recebe todo mês. |
| Supermercado | Seu estacionamento / pode render. | Nós instalamos. Você recebe todo mês. |
| Farmácia | O carregador é nosso. / A vaga é sua. | Nós investimos 100% do equipamento. |
| Academia | Duas vagas. / Renda todo mês. | Nós instalamos. Você recebe todo mês. |
| Clínica | Sobra vaga no pátio? / Sobra renda. | Nós instalamos. Você recebe todo mês. |
| Estacionamento | Duas vagas. / Você não paga nada. | Nós instalamos. Você recebe todo mês. |

Nenhuma delas promete valor. O número entra no texto, com o cenário junto, que é o único jeito
honesto de dizer.

### Texto principal, modelo para adaptar

```
O seu cliente para aí por 40 minutos. O carro dele podia estar carregando nesse tempo.

A gente instala um carregador rápido em duas vagas do seu estacionamento. O equipamento e a
instalação são por nossa conta, você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

E quem para para carregar entra na sua loja.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

### CTA e destino

Botão **Cadastre-se**, destino `https://solardoc.app/io/eletroposto/parceria`.
Sobe com `utm_term={{adset.id}}` e `utm_content={{ad.id}}`, ou o conjunto não aparece no quadro
por conjunto da aba Quiz do `/admin/hubs`.

### A primeira pergunta continua sendo a do imóvel

O anúncio não pergunta, mas o cadastro pergunta, e é o campo que decide tudo depois: dos 17
locais cadastrados, 10 são de inquilino e quem assina a cessão é o dono do imóvel. Quem chegar
por esse criativo cai na régua do `PROMPT-GPT-ARRENDAMENTO-PONTO.md`.

---

## 5.1 A copy pronta para colar no Meta

Um bloco por segmento, na ordem dos campos do gerenciador. Texto principal, título, descrição,
botão e link. Copiar e colar como está.

**Vale para todos:** botão **Cadastre-se**, link
`https://solardoc.app/io/eletroposto/parceria`, e no campo "Parâmetros de URL" do anúncio:

```
utm_source={{site_source_name}}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

Sem esse `utm_term` o conjunto não aparece no quadro por conjunto da aba Quiz do `/admin/hubs`,
e não dá para saber qual segmento pagou a reunião.

---

### Restaurante · arte `restaurante-1080x1350.jpg`

**Texto principal**

```
O seu cliente senta, come e fica 40 minutos aí dentro.

Nesse tempo o carro dele podia estar carregando na sua vaga.

A gente instala um carregador rápido em duas vagas do seu estacionamento. O equipamento e a
instalação são por nossa conta. Você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

E quem para para carregar entra para comer.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `Duas vagas. Zero investimento.`
**Descrição:** `Nós instalamos. Você recebe.`

---

### Supermercado e mercado · arte `supermercado-1080x1350.jpg`

**Texto principal**

```
A sua cliente faz a compra em 40 minutos.

É exatamente o tempo de uma recarga rápida.

A gente instala um carregador em duas vagas do seu estacionamento. O equipamento e a instalação
são por nossa conta. Você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

Quem para para carregar faz a compra aí, não no concorrente.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `Seu estacionamento pode render`
**Descrição:** `Nós instalamos. Você recebe.`

---

### Farmácia de rede · arte `farmacia-1080x1350.jpg`

**Texto principal**

```
A sua loja tem estacionamento próprio?

Então ela já tem o que falta na sua rua, que é lugar para carregar carro elétrico.

A gente instala o carregador em duas vagas. O equipamento e a instalação são por nossa conta,
a NEXUS investe 100%. Você entra com a vaga e com a ligação de energia.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `O carregador é nosso. A vaga é sua.`
**Descrição:** `Nós investimos 100%.`

---

### Academia · arte `academia-1080x1350.jpg`

**Texto principal**

```
O seu aluno treina uma hora.

O carro dele fica parado na sua vaga esse tempo todo, sem fazer nada.

A gente instala um carregador rápido em duas vagas do seu estacionamento. O equipamento e a
instalação são por nossa conta. Você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

E vaga com carregador é motivo para o aluno escolher a sua academia e não a de baixo.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `Duas vagas viram renda mensal`
**Descrição:** `Nós instalamos. Você recebe.`

---

### Clínica · arte `clinica-1080x1350.jpg`

**Texto principal**

```
O seu paciente espera a consulta e o carro dele espera no pátio.

Dá tempo de sobra de carregar.

A gente instala um carregador rápido em duas vagas do seu estacionamento. O equipamento e a
instalação são por nossa conta. Você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `Sobra vaga no pátio? Sobra renda`
**Descrição:** `Nós instalamos. Você recebe.`

---

### Estacionamento e galeria · arte ainda não gerada, prompt no item 4.6

**Texto principal**

```
Você já vive de vaga.

Duas delas podem render bem mais do que rendem hoje.

A gente instala um carregador rápido em duas vagas do seu pátio. O equipamento e a instalação
são por nossa conta. Você não paga nada.

Você recebe um percentual de tudo que o carregador faturar, todo mês. No nosso cenário de
referência, 80 kW e dez carros por dia, 10% dá perto de R$ 1.400 por mês.

E quem carrega deixa o carro mais tempo, não menos.

Cadastre o seu local e a gente faz o estudo do ponto com número.
```

**Título:** `Duas vagas. Você não paga nada.`
**Descrição:** `Nós instalamos. Você recebe.`

---

### O que não mudar nesses textos

**A frase do cenário anda junto com o número.** "No nosso cenário de referência, 80 kW e dez
carros por dia" é o que transforma R$ 1.400 de promessa em conta. Tirar a frase e deixar o
número é a versão que dá problema na segunda reunião e no Meta.

**O pedido é cadastro, não reunião.** Reunião marcada por quem foi procurado tem histórico ruim
na casa: das 7 da fila fria, 3 não apareceram, com confirmação e dois lembretes enviados.

**Nada de piso mensal, valor garantido ou prazo de obra no texto.** A cláusula do piso está em
branco e quem crava é o Thiago.

---

## 6. O que não fazer

**Não escrever valor na arte.** R$ 1.446 é um cenário, não uma promessa, e promessa de renda na
imagem é o caminho curto para reprovação no Meta e para briga na segunda reunião.

**Não desenhar dois carregadores.** Seção 1. É o erro que a cena bonita esconde.

**Não usar a `capa.webp` como base.** Ela mostra uma máquina branca genérica que não é o produto.
O gabinete certo é o das quatro vistas de 21/09.

**Não gerar cena com o gabinete em primeiro plano em 1K.** Em 1K o modelo espelha a escrita do
produto. 2K custa 5 créditos a mais e sai certa. Seção 7.

**Não subir sem conjunto separado por segmento.** Sem `utm_term={{adset.id}}` não dá para saber
se clínica presta, e clínica é o único dos seis que nunca foi medido.

**Não jogar orçamento em restaurante por ele ter sido pedido primeiro.** 6,9% é o pior número
da tabela. Comece por estacionamento, supermercado e academia.

---

## 7. O que foi gerado, e onde está

Cinco cenas renderizadas em 30/09/2026, cada uma em duas proporções, com a chamada já aplicada.
Arquivos em `Criador de Criativos - Irmãos na Obra/arrendamento-duas-vagas/` (pasta local, fora
do git, igual à linha catira).

| segmento | arquivos | base no Cloudinary |
|---|---|---|
| Restaurante | `restaurante-1080x1350.jpg` · `restaurante-1080x1080.jpg` | `arrendamento/duas-vagas-restaurante` (2048) |
| Supermercado | `supermercado-1080x1350.jpg` · `supermercado-1080x1080.jpg` | `arrendamento/duas-vagas-supermercado` (1024) |
| Farmácia | `farmacia-1080x1350.jpg` · `farmacia-1080x1080.jpg` | `arrendamento/duas-vagas-farmacia` (1024) |
| Academia | `academia-1080x1350.jpg` · `academia-1080x1080.jpg` | `arrendamento/duas-vagas-academia` (1024) |
| Clínica | `clinica-1080x1350.jpg` · `clinica-1080x1080.jpg` | `arrendamento/duas-vagas-clinica` (1024) |

**Como foram feitas:** Cloudinary `generate-image-from-images`, modelo `nano-banana-2-edit`,
com `dc-perspectiva.webp` e `p-dc.webp` como referência do gabinete. Custo medido: **14 créditos
em 2K e 9 em 1K**, de uma cota mensal de 50. As cinco consumiram os 50 e **a cota zerou**.
Ela vira no ciclo seguinte, ou se compra em `console.cloudinary.com/app/image/generation/plans`.

**A chamada não gasta crédito.** Ela é transformação de entrega, não geração: troca o texto na
URL e a arte sai na hora. Receita, sobre o `public_id` da cena:

```
c_fill,w_1080,h_1350,g_north,q_auto:good
l_text:Arial_72_bold:<chamada%20linha%201>,co_rgb:0B1A2B,g_north_west,x_64,y_56
l_text:Arial_72_bold:<chamada%20linha%202>,co_rgb:0B1A2B,g_north_west,x_64,y_144
l_text:Arial_34_bold:<apoio>,co_rgb:007A46,g_north_west,x_66,y_246
```

Acento vai percent-encoded (`é` = `%C3%A9`), `?` vira `%3F`, e vírgula dentro do texto tem que
virar `%252C` ou o Cloudinary lê como separador de parâmetro. Chamada de duas linhas em 72px
cabe em 20 caracteres por linha; passando disso, desça para 66 ou 58 e ajuste o `y` da segunda
linha para `56 + tamanho + 16`.

### O achado que muda a receita: 1K espelha a escrita do gabinete

**Em 2K o painel da marca sai certo. Em 1K ele sai espelhado.** No restaurante, gerado em 2K,
"NEXUS ELETROPOSTOS" e "CHARGING STATION" estão legíveis e corretos. Nos quatro de 1K, a escrita
vertical da coluna central saiu invertida, tipo espelho, nos quatro. É o produto da casa com
texto errado estampado, na maior peça do quadro, e não é detalhe que some no celular.

**Corrigido sem gastar geração**, com `e_blur_region` sobre a faixa da escrita antes do corte. A
coluna vira um painel liso e o gabinete continua sendo o nosso. As caixas usadas, sobre a base
de 1024:

| peça | correção |
|---|---|
| supermercado | `e_blur_region:1200,x_492,y_536,w_50,h_100` |
| farmacia | `e_blur_region:1200,x_496,y_568,w_50,h_100` |
| academia | `e_blur_region:1200,x_496,y_554,w_50,h_88` |
| clinica | `e_blur_region:1200,x_494,y_550,w_50,h_128` |
| restaurante | nenhuma, saiu correta em 2K |

**A regra que fica:** cena com o gabinete em primeiro plano se gera em **2K**, que custa 14
créditos contra 9. Economizar 5 créditos custou quatro correções e quase subiu marca espelhada.

**Emblema de montadora visível** nos carros de supermercado e clínica, Hyundai e Toyota, mesmo
com o negativo pedindo carro sem marca. Restaurante, farmácia e academia saíram limpos. É
retoque local, não regeração, e para este público provavelmente não muda nada.

**Estacionamento rotativo não foi renderizado.** O prompt do item 4.6 está pronto e a cota acabou
nas cinco primeiras. É o segmento com o melhor número medido da tabela, 26,6% em 64 reuniões, e
deveria ser o primeiro a rodar quando houver crédito.

---

## 8. De onde veio cada número

| número | fonte |
|---|---|
| Conversão por segmento nas 462 reuniões | `agendamentos`, `created_by = lp_eletroposto`, por perfil |
| 217 capital contra 17 ponto | tabela `eletroposto_parceria`, coluna `lado` |
| 10 inquilinos de 17 | `eletroposto_parceria`, coluna `ponto_relacao` |
| R$ 1.446 por mês no cenário de 80 kW | `CONTRATO-ARRENDAMENTO-PONTO.md`, cláusula 4.3 |
| 2 bicos e 2 vagas dedicáveis | `PONTO-CERTO-COMO-ESCOLHER.md`, item 6 |
| Faixas de permanência por segmento | `PONTO-CERTO-COMO-ESCOLHER.md`, item 4.3 |
| O gabinete das quatro vistas | `dashboard/public/nexus/img/`, commit `ec2ff644` de 21/09/2026 |
