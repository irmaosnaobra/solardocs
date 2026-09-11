# solardocs

Monorepo informal do ecossistema Irmãos na Obra: SolarDoc (SaaS de propostas
solares), o Gerador, as landing pages e os robôs de atendimento.

**Este repositório é PÚBLICO** (`github.com/irmaosnaobra/solardocs`). Vale para
tudo que está escrito aqui dentro, inclusive `.md` de documentação.

## O que é código de produção

| Pasta | O que é | Onde vai parar |
|---|---|---|
| `api/` | Backend Express em TypeScript, **CommonJS**. Rotas, crons, robôs. | `api.solardoc.app` (Vercel, função de 1 GB, `maxDuration` 300) |
| `dashboard/` | App Next (App Router) e todas as landings em `public/`. | `solardoc.app` (projeto Vercel `solardocs-dashboard`, root `dashboard`, Node 24) |
| `ebike-ecommerce/` | Loja de bikes. | Projeto Vercel próprio |
| `plugcash/`, `widget/`, `worker-prospeccao/`, `cloudflare-worker/` | Satélites menores. | Cada um no seu lugar |

Pastas que aparecem no disco mas **não estão no repositório**: `landing-solar/`,
`BuscAds/`, `claude-mem/` (esta é clone de terceiro, `thedotmack/claude-mem`, não
é nossa). Editar ali não vira deploy deste repo.

Na raiz existem 104 arquivos versionados, 34 deles `.md` de documentação e
contrato. Eles são a memória escrita do projeto, não sobra.

## Comandos

| O quê | Onde | Comando |
|---|---|---|
| Typecheck (bloqueia o CI) | `api/` | `npx tsc --noEmit` |
| Testes | `api/` | `npx vitest run` |
| Build | `api/` | `npm run build` (gera `dist/`) |
| Dev | `api/` | `npm run dev` |
| Build | `dashboard/` | `npm run build` |
| Lint | `dashboard/` | `npm run lint` |
| Dev | `dashboard/` | `npm run dev` |

Não existe script na raiz. Todo comando roda de dentro da pasta do projeto.

## Guardrails

Cada um destes já custou caro pelo menos uma vez.

- **Nenhum valor de segredo em arquivo `.md`**, nem "só de exemplo", nem em
  runbook. O repositório é público e o `.gitleaks.toml` tem regra própria para
  isso (`segredo-em-documentacao`). Existe pre-commit em `.githooks/pre-commit`
  que roda o gitleaks no que está staged e recusa o commit com segredo. Em clone
  novo, ligar com `git config core.hooksPath .githooks` (e ter o gitleaks no
  PATH; sem ele o hook só avisa).
- **Stage por caminho explícito.** `git add -A` leva arquivo solto de outra
  sessão junto e vira deploy alheio. Existe hook que bloqueia.
- **Todo commit tem que compilar sozinho.** `tsc` verde na máquina não prova
  isso: commit parcial deixa a dependência de fora e derruba o build.
- **`vercel --prod` publica o BRANCH que está no disco, não o `main`.** Pior: o
  `.vercel/` da raiz aponta para o projeto `pack-solar`, não para o dashboard.
  No solardocs, empurre para o `main` e deixe o push disparar o build. Existe
  hook que bloqueia o `--prod` sem `--cwd` ou `VERCEL_PROJECT_ID`.
- **Deploy só conta quando chega em READY.** Push que não vira build acontece
  aqui e passa despercebido.
- **A `api/` é CommonJS.** Importar pacote ESM no caminho de boot põe toda rota
  em 500 com o `tsc` VERDE. Teste com `require` no `dist/`, não no fonte.
- **O `/gerador` é PWA.** Mexeu em `dashboard/public/gerador/index.html`? Faça o
  bump do `vNN` em `dashboard/public/gerador/sw.js` no mesmo commit. Existe hook
  que avisa.
- **Asset de landing sempre com caminho absoluto.** O servidor tira a barra
  final e o `./asset.js` resolve um nível acima, deixando a página muda.
- **Supabase é um projeto só, sem staging.** Toda migration e todo
  `execute_sql` batem em produção. `DROP` e `TRUNCATE` são bloqueados por hook;
  `DELETE` com `WHERE` passa normalmente. E arquivo `MIGRATION_*.sql` no repo não
  prova que a migration rodou: confira com sonda.
- **Nada de force push nem `reset --hard`.** Sem branch protection no `main`, o
  force push sobrescreve o remoto sem rede de segurança. `--force-with-lease`
  não é bloqueado e `git revert` resolve quase sempre.

## Estado atual (11/09/2026)

- Typecheck da `api`: **verde**, 0 erro. É o gate que bloqueia no CI.
- Testes da `api`: **17 vermelhos** de 1.253, em 5 arquivos
  (`agendaSolarSocios`, `centralRoteamentoSolar`, `leadSolar700kwh`,
  `nilceParaGiovanna`, `pixSaidaCheckout`). O CI roda com `continue-on-error`
  por causa desse baseline.
- CI `Segurança`: **vermelho**, 4 achados do gitleaks no histórico. Está assim
  em todo push desde 10/09.
- `main` não tem branch protection. Há pre-commit de segredo em `.githooks/`
  (precisa de `core.hooksPath` ligado no clone).
- Hooks: 5 regras em `.claude/hookify.*.local.md`. Quatro bloqueiam (`git add -A`,
  `vercel --prod` sem alvo explícito, force push e `reset --hard`, `DROP` e
  `TRUNCATE`) e uma avisa (bump do `sw.js`). Os padrões são ancorados em posição
  de comando, então mencionar um deles dentro de outro comando não bloqueia.
  Tudo isso depende de `python3` resolver para um Python de verdade no PATH: no
  Windows o atalho da Microsoft Store sai com código 49 e mata os hooks calado.

## Pendências

1. Girar 3 segredos vivos, todos em texto puro neste repo público:
   `CRON_SECRET` e `MCP_TOKEN` (no `SECURITY-RUNBOOK.md`, medidos vivos por probe
   em 11/09/2026) e `JWT_SECRET` (no `SETUP_PROMPT.md`, nunca rotacionado, é forja
   de sessão). O `SETUP_PROMPT.md` ainda tem um `.env` de exemplo com esse
   `JWT_SECRET`, `DATABASE_URL` e chaves de API. Só depois de girar é que se
   limpam os dois arquivos: inverter a ordem deixa os crons mortos.
   Obs: a regra `segredo-em-documentacao` do `.gitleaks.toml` não pega o
   `MCP_TOKEN` (escrito "valor novo:", e a regra só casa "valor:"). Ampliar.
2. Fechar os 17 testes vermelhos e tirar o `continue-on-error` de
   `.github/workflows/qualidade.yml`.
3. Ligar branch protection no `main` exigindo `Qualidade` e `Segurança`. Só
   depois do item 1, senão trava o próprio push.
4. `dashboard/` e `widget/` não têm `.env.example`.
