---
name: verificar-lp
description: Confere no ar se uma landing page está funcionando de verdade — visual no celular, zero erro de JS, links de checkout com rastreio, pixel carregado e evento gravando no banco. Use quando o Thiago falar "verifica a LP", "confere no ar", "trocou a versão", "subiu a página", "testa o checkout", "a página está funcionando?", antes/depois de qualquer deploy de landing, ou ao editar `LimpaPro/limpapro/index.html`, `Gelatina/*/index.html` e `dashboard/public/**/index.html`.
---

# Verificar LP no ar

O roteiro que separa "a página abriu" de "a página está vendendo". Nasceu de
erros reais: versão trocada com o popup quebrado, pixel derrubando exceção em
toda visita, e uma rodada inteira de análise em cima de um evento que nunca
gravou.

**Rodar SEMPRE depois de trocar versão ou mexer em oferta/checkout/tracking.**

## Antes de começar

Puppeteer e sharp vivem no repo CLAUDE, não nas pastas das landers:

```
NODE_PATH=C:/Users/55349/Desktop/CLAUDE/node_modules            # puppeteer
NODE_PATH=C:/Users/55349/Desktop/CLAUDE/dashboard/node_modules  # sharp
```

Sem isso dá `MODULE_NOT_FOUND` e parece que a ferramenta não existe. (Ela existe:
sharp 0.34.5 com webp **e avif** — não converter imagem com puppeteer+canvas,
que é o jeito antigo e pior.)

## Os 6 checks

### 1. Celular a 390×**700** — não 844

`844` é a altura do aparelho; o Safari come ~145px com barra de URL e toolbar. Já
passou teste a 844 e cortava no celular de verdade. **Sempre 390×700.**

Conferir: os cards de preço aparecem inteiros (preço, itens, botão), nada de
checklist cortado, e o CTA do hero acima da dobra.

### 2. Zero `pageerror`

```js
page.on('pageerror', e => erros.push(e.message));
```

Tem que fechar em **zero**. Um pixel morto já derrubou `TypeError: Cannot read
properties of undefined (reading '_id')` em toda visita sem ninguém ver.

### 3. Links de checkout saindo com rastreio

Todo `a[href*="kiwify"], a[href*="pay."]` — **inclusive os de dentro do popup** —
tem que sair com `sck=` e as `utm_*`. O reescritor roda no `document` inteiro; se
um link ficar de fora, a venda acontece e a atribuição não.

Conferir também que o popup **abre**: no LimpaPro o botão do plano barato é
`<button data-plan="basic">` que abre o `#dsOverlay`, não é link.

### 4. Pixel carregado com a fila drenada

```js
fbq.loaded === true && fbq.queue.length === 0
```

Sem tocar na tela. Fila parada significa evento preso que nunca chega no Meta.

### 5. O evento GRAVOU no banco — este é o que mais engana

Abrir com `?utm_campaign=testeN` e depois conferir no Supabase (`solardoc-pro`):

```sql
select event_type, status, created_at from limpapro_events
where utm_campaign = 'testeN' order by created_at desc;
```

⚠️ **O beacon `api.solardoc.app/_t/limpapro` SEMPRE cospe erro de CORS no
console e os eventos CHEGAM assim mesmo.** Não confundir o barulho com rastreio
quebrado — já custou uma investigação inteira.

⚠️ Abandono é gravado como `event_type='purchase'` com `status='abandoned'`.
**Sempre filtrar por `status`**, senão você conta abandono como venda.

### 6. Peso e pintura

Medir a 390×700 com rede 4G + CPU 4×. Referências reais da LimpaPro: **369–389KB
e LCP ~2,2–2,6s** é bom; acima de 500KB alguma imagem voltou a entrar na frente
da pintura.

Piso conhecido: ~92KB de HTML custa ~1,6s só de parse a 4× CPU. Se o FCP não
desce, o problema é o tamanho do documento, não o JS.

## Armadilhas que já custaram tempo

- **`_` é curinga no `LIKE` do SQL.** `key not like 'limpapro_recovery_%'`
  exclui também `limpapro_recovery:foo@bar`. Use
  `split_part(key,':',1) = 'limpapro_recovery'`.
- **`img{max-width:100%}` sem `height:auto`** faz os atributos `width`/`height`
  travarem a altura, e `aspect-ratio` no CSS não vence isso.
- **Media query não aumenta especificidade** — bloco `@media` de ajuste tem que
  vir DEPOIS das regras que ele sobrescreve, senão é ignorado em silêncio.
- **Comparar conversão entre versões sem olhar o markup mente.** O mesmo evento
  `checkout_click_basic` já significou "foi pro Kiwify" numa versão e "abriu o
  popup" na seguinte.
- **`index.html` do LimpaPro é untracked no git.** Backup manual em
  `_arquivo-limpapro/backups-index/index.bak-<motivo>-<data>.html` **antes** de
  editar — git não te salva lá.

## Saída esperada

Relatar cada check com ✅/❌ e, no fim, **bytes + LCP** medidos. Se algum falhar,
dizer qual e o que foi visto — nunca "está tudo certo" sem os 6.
