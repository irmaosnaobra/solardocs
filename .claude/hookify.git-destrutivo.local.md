---
name: git-que-apaga-historia
enabled: true
event: bash
action: block
pattern: (?:^|[;&|\n]\s*)git\s+push\s+[^;&|]*(--force(?!-with-lease)|(?<![\w-])-f(?![\w-]))|(?:^|[;&|\n]\s*)git\s+reset\s+--hard
---

**Isso apaga trabalho que não dá para recuperar.**

O `main` deste repo não tem branch protection: force push aqui sobrescreve o
histórico remoto sem nada para segurar. E `reset --hard` joga fora o que está
na árvore, inclusive edição de outra sessão rodando em paralelo.

Antes de insistir:
- Para desfazer commit já empurrado, `git revert` resolve e mantém o histórico.
- Para guardar a árvore antes de mexer, `git stash` ou um branch novo.
- Se for mesmo necessário reescrever, `--force-with-lease` pelo menos falha
  quando o remoto andou, em vez de atropelar. Essa forma não é bloqueada.
