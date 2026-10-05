# Checkout Stripe 10/10 — Imagem dos planos SolarDoc

## Estado atual (verificado no Stripe live, 13/06/2026)
- **SolarDoc PRO** (`prod_UIzsyQRzE9mQng`) → `images: []` ❌ checkout pelado
- **SolarDoc VIP** (`prod_UIzsfi8HDwqOvu`) → `images: []` ❌ checkout pelado
- (Pra comparar: os produtos do Pack Solar TÊM imagem e ficam bonitos)

## Como o Stripe Checkout hosted exibe a imagem (specs reais)
- Mostra **APENAS a primeira imagem** do array `images`.
- Renderiza em **quadrado** (1:1), ao lado do nome+preço do item.
- Então a imagem PRECISA ser **quadrada** (ou ter o conteúdo centralizado) — se mandar retangular, ele corta as laterais.
- A imagem tem que estar **hospedada numa URL pública https** (Stripe não faz upload de arquivo local; ele referencia a URL). Ex.: pode subir em `solardoc.app/...` ou no mesmo lugar do Pack (`pack.solardoc.app/showcase/...`).

### Especificação técnica pra imagem 10/10
| Item | Valor |
|---|---|
| Dimensão | **1024 × 1024 px** (quadrada) |
| Proporção | 1:1 obrigatório |
| Formato | PNG (ou JPG) |
| Peso | < 2 MB |
| Margem de segurança | conteúdo principal dentro dos 80% centrais (evita corte) |
| Fundo | sólido ou gradiente da marca (NÃO transparente — fica feio no card branco do Stripe) |

---

## PROMPT PRO CHATGPT (gerar a imagem) — PRO

> Create a premium, professional square product image (1024×1024px, 1:1 ratio) for a SaaS checkout page (Stripe Checkout).
> Product: "SolarDoc PRO" — a document-automation platform for solar energy installers in Brazil.
> Style: clean, modern fintech/SaaS aesthetic. Dark navy (#0f172a) to slate gradient background with subtle solar-amber (#f59e0b) accent glow. Centered composition with safe margins (keep all key elements within the central 80%).
> Show: a sleek floating UI card / dashboard mockup of a solar proposal document, with a small sun/solar panel icon, an amber "PRO" badge, and a faint grid. Crisp, high-contrast, trustworthy. No text paragraphs, no lorem ipsum — at most the word "PRO" on a badge.
> Lighting: soft studio glow. Render quality: photorealistic 3D + UI hybrid, sharp, no noise. Square crop, content centered.

## PROMPT PRO CHATGPT (gerar a imagem) — VIP

> Same as above but for "SolarDoc VIP" — the unlimited/premium tier.
> Make it feel more exclusive: deeper navy background, richer amber-to-gold gradient accent, a subtle "∞" (infinity) motif and a golden "VIP" badge. Same 1024×1024px square, content centered within 80% safe area, brand colors #0f172a + #f59e0b, photorealistic SaaS dashboard mockup. No paragraphs of text; at most "VIP" on the badge.

---

## Quando você me mandar as imagens
1. Você sobe cada uma numa URL pública (me diz onde, ou eu te ajudo a hospedar).
2. Eu carimbo via Stripe API: `POST /v1/products/{id}` com `images: ["https://..."]` em PRO e VIP.
3. Confiro o preview do checkout pra ver se ficou bom.

## Branding global (SÓ você consegue — Dashboard, não tem API)
Stripe Dashboard → Settings → Branding:
- **Logo** SolarDoc (aparece no topo de TODO checkout)
- **Cor de destaque**: #f59e0b (amber da marca)
- **Ícone**
Isso vale pra todos os checkouts de uma vez — faz num lugar só.

## Bônus de confiança (opcional, depois)
- Domínio próprio do checkout: `pay.solardoc.app` em vez de `checkout.stripe.com` (Stripe → Custom domains). Aumenta confiança e reduz abandono — exatamente o que perdeu o Fábio.
