---
name: vercel-prod-publica-o-branch
enabled: true
event: bash
action: warn
pattern: vercel\s+(.*\s)?--prod
---

**`vercel --prod` publica o BRANCH que está no disco, não o main.**

Isso já apagou correção que só existia no main. Antes de rodar, confirme:
- de que pasta/projeto é este deploy (LimpaPro e a loja de bikes são projetos
  próprios e o CLI é o caminho certo neles)
- se for o solardocs: deployar da RAIZ por worktree limpo, ou empurrar pro main
  e deixar o push disparar
- conferir o deploy até **READY** — push que não vira build acontece aqui
