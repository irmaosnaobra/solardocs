---
name: vercel-prod-publica-o-branch
enabled: true
event: bash
action: block
pattern: (?s)^(?!.*(?:--cwd|VERCEL_PROJECT_ID)).*?(?:^|[;&|\n])\s*(?:[A-Za-z_][\w-]*=\S+\s+)*(?:npx\s+(?:-y\s+|--yes\s+)?)?vercel(?:@[\w.]+)?\b[^;&|\n]*--prod
---

**`vercel --prod` publica o BRANCH que está no disco, não o main.**

Isso já apagou correção que só existia no main. Antes de rodar, confirme:
- de que pasta/projeto é este deploy (LimpaPro e a loja de bikes são projetos
  próprios e o CLI é o caminho certo neles)
- se for o solardocs: deployar da RAIZ por worktree limpo, ou empurrar pro main
  e deixar o push disparar
- conferir o deploy até **READY** — push que não vira build acontece aqui

Esta regra BLOQUEIA. A saída é deixar o alvo explícito no comando:
`--cwd "<pasta do projeto>"` ou `VERCEL_PROJECT_ID=...`. Com um dos dois
a regra libera, porque aí o deploy não depende de onde você está.
