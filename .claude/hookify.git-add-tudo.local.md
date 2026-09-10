---
name: nao-commitar-a-arvore-inteira
enabled: true
event: bash
action: warn
pattern: git\s+add\s+(-A|--all|\.)(\s|$)|git\s+commit\s+.*-a(m|\s|$)
---

**Stage por caminho explícito, não a árvore toda.**

Outra sessão pode ter arquivo solto aqui — `git add -A` leva a edição dela
junto e vira deploy alheio. E commit parcial já derrubou o build antes:
`tsc` verde local NÃO prova que o commit compila sozinho.

Antes de seguir:
- `git status` e escolher os caminhos um a um
- cada commit tem que compilar sozinho (dependência inclusa)
- depois do push, acompanhar o deploy até **READY**, não até "enviado"
