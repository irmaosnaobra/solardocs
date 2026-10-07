---
name: aviso-envio-passa-pelo-chefe-antiban
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx|js|jsx|mjs|cjs|py)$
  - field: file_path
    operator: not_contains
    pattern: __tests__
  - field: content
    operator: regex_match
    pattern: api\.z-api\.io|Client-Token|send-[a-z]|\bsend(WhatsApp|Human|Frio|ZAPI|ToGroup|Image|Document|Audio|Video|Sticker)\s*\(|\b(enviarZapiIO|zapiPost|sendDM|sendPrivateReply|replyToComment)\s*\(|graph\.(facebook|instagram)\.com[^\n]*/(messages|private_replies|replies|comments)|\$\{GRAPH\}[^\n]*/(messages|private_replies|replies|comments)
---

**Mudança que faz algo sair pelo WhatsApp, Instagram ou Facebook.**

Antes do commit:
- chame o subagente `chefe-antiban` com o diff e siga o veredito (BLOQUEIA ou NÃO BLOQUEIA);
- de dentro de `api/`, rode `npx vitest run src/__tests__/chefeGuarda.test.ts` (guarda vermelha = bloqueia).

O que ele confere: 1 toque = 1 mensagem, carimbo que o teto enxerga, teto por
hora e por dia, rampa, janela, para no erro, pausa humana, Pix em bolha própria
e Instagram por conta. As 4 quedas da linha 5040 tiveram o mesmo formato:
alguém fora da conta, ou contado com o carimbo errado, mandando em rajada ou em
várias bolhas.
