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
| Publicar no `main` | raiz do repo | `bash scripts/publicar.sh` |

Fora o `scripts/publicar.sh`, todo comando roda de dentro da pasta do projeto.

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
  No solardocs, publique com `bash scripts/publicar.sh` e deixe o merge no
  `main` disparar o build. Existe hook que bloqueia o `--prod` sem `--cwd` ou
  `VERCEL_PROJECT_ID`.
- **Push direto no `main` é recusado** (desde 05/11/2026). O ruleset só aceita
  commit que já passou em `api — typecheck e testes`, `Varredura de segredos` e
  `dashboard — lint`. Publique com `bash scripts/publicar.sh`: ele faz rebase no
  `origin/main`, empurra o HEAD para um ramo `pub/...`, abre PR com merge
  automático por rebase e espera. Sai 0 com o sha que entrou no `main`, ou 1
  dizendo qual check reprovou. O CI leva de 2 a 3 minutos. Os ramos `pub/*` não
  geram build na Vercel: o `ignoreCommand` pula.
- **Deploy só conta quando chega em READY.** Push que não vira build acontece
  aqui e passa despercebido.
- **Cada projeto só monta quando a própria pasta muda** (desde 19/10/2026,
  `ignoreCommand` em `api/vercel.json` e `dashboard/vercel.json`, comparando com
  o último deploy). O projeto que não mudou aparece como "Canceled (Ignored
  Build Step)", e isso é o esperado: confira o READY no projeto cuja pasta
  mudou. Env nova na Vercel só vale com commit dentro da pasta do projeto ou
  com redeploy manual. O projeto da loja de bike (`bikes-irmaos-na-obra`) dá
  ERROR em todo push desde 03/09, em ~5 s, porque monta da raiz do repo e não
  de `ebike-ecommerce/`. É esperado e quase não custa; para parar, desligar o
  Git dele no painel da Vercel.
- **A `api/` é CommonJS.** Importar pacote ESM no caminho de boot põe toda rota
  em 500 com o `tsc` VERDE. Teste com `require` no `dist/`, não no fonte.
- **O `/gerador` é PWA.** Mexeu em `dashboard/public/gerador/index.html`? Faça o
  bump do `vNN` em `dashboard/public/gerador/sw.js` no mesmo commit. Existe hook
  que avisa.
- **O `/gerador` tem dois visuais e o novo é o padrão desde 13/10/2026.** O
  visual novo é claro e vive em `dashboard/public/gerador/ui/`, ligado pela
  classe `html.io2`; quem decide é `ui/chave.js` (`PADRAO`, e a chave
  `localStorage['gerador-visual']`). Desde 23/10/2026 o antigo não é mais opção
  do usuário: não há item de menu, e `/gerador/visual-antigo.html` só
  redireciona para `/gerador/`. Ele existe só para o link do cliente (`?p=`) e o
  PDF (`pdf=1`), que sempre o usam, e para a proteção automática de folha que
  falha. A escolha antiga `'antigo'` guardada no aparelho é ignorada e apagada.
  Desligar para todos é `PADRAO = 'antigo'` mais o bump do `sw.js` (freio de
  emergência). Enquanto o link do cliente e o PDF usarem o antigo, tela nova ou
  alterada tem que funcionar nos dois visuais: cor entra pelos tokens de `ui/io2.css` (`--n-*`,
  `--io-*`), nunca escrita à mão para fundo escuro, senão vira texto claro
  sobre branco sem erro nenhum. O sistema está escrito no `DESIGN.md` da raiz. `ui/*` só muda seguindo o plano
  da reforma, e o service worker entrega esses arquivos do cache primeiro: todo
  commit que toca `ui/*` sobe o `vNN` do `sw.js`. Cor de cartão da Agenda e o
  que vira PDF não entram na reforma.
- **Asset de landing sempre com caminho absoluto.** O servidor tira a barra
  final e o `./asset.js` resolve um nível acima, deixando a página muda.
- **Supabase é um projeto só, sem staging.** Toda migration e todo
  `execute_sql` batem em produção. `DROP` e `TRUNCATE` são bloqueados por hook;
  `DELETE` com `WHERE` passa normalmente. E arquivo `MIGRATION_*.sql` no repo não
  prova que a migration rodou: confira com sonda.
- **Nada de force push nem `reset --hard`.** Desde 05/11/2026 um ruleset do
  GitHub no `main` recusa force push (inclusive `--force-with-lease`) e apagar
  o branch, sem exceção nem para o dono. O `reset --hard` local continua sem
  rede de segurança. `git revert` resolve quase sempre.

## Estado atual (05/11/2026)

- Typecheck da `api`: **verde**, 0 erro. É o gate que bloqueia no CI.
- Testes da `api` (medido em 03/11/2026): **zero vermelho** em 367 arquivos e
  11.010 testes. O `continue-on-error` do vitest saiu de
  `.github/workflows/qualidade.yml`: teste vermelho agora derruba o CI. O que
  falhava por tempo virou folga em `api/vitest.config.ts` (`testTimeout` 30 s,
  `hookTimeout` 60 s). Tempo estourado não é bug: não afrouxe asserção para
  "passar". Teste que cria data fixa (`AGORA`) e o código que grava com o
  relógio real (`new Date()`) divergem com o passar dos dias: foi o caso do
  `eletropostoEstudoTick`.
- CI `Segurança`: os achados antigos do histórico estão no `.gitleaksignore` por
  fingerprint, e as regras novas do `.gitleaks.toml` pegam "valor novo:" em
  documentação e valor literal de `CRON_SECRET`, `MCP_TOKEN`, `JWT_SECRET` e
  `GITHUB_CRON_SECRET` em código. `gitleaks git` no histórico todo dá 0 achado.
  Achado novo é vazamento novo: não ponha no `.gitleaksignore` sem girar o segredo.
  O comentário do `.gitleaksignore` diz o estado de cada segredo antigo.
- A troca de segredos de 03/11 a 05/11/2026 terminou. `CRON_SECRET` e
  `MCP_TOKEN` girados, e os valores vazados dão 401. Os tokens do Meta foram
  revogados em 04/11. Os gatilhos antigos da Cloudflare foram apagados. O
  `JWT_SECRET` de produção nunca vazou em arquivo. O `CRON_SECRET_ANTERIOR`
  saiu da Vercel em 05/11. Os valores antigos seguem no histórico do git, todos
  mortos.
- Os jobs do pg_cron que chamam a api (`process-messages`, `sync-leads-meta`)
  ficam no banco do Gerador (`gerador-propostas`), não no do SolarDoc, que nem
  tem pg_cron. Lá também roda o `purge-cron-log`, que todo dia às 03:17 UTC
  apaga o histórico do pg_cron com mais de 7 dias.
- Hook de **pre-push** em `.githooks/pre-push`: roda o gitleaks só no intervalo que
  sobe (com `--redact`) e, se o intervalo mexe em `api/`, o `tsc --noEmit`. Recusa
  o push se um dos dois falhar. Sem gitleaks ou sem `api/node_modules` ele avisa e
  segue. O `tsc` confere o que está no disco. Emergência: `git push --no-verify`.
  Vale com `core.hooksPath` ligado, igual ao pre-commit.
- `main` tem o ruleset "main: só com CI verde, sem force push e sem apagar"
  (05/11/2026). Há pre-commit e pre-push em `.githooks/` (precisam de
  `core.hooksPath` ligado no clone).
- Hooks: 6 regras em `.claude/hookify.*.local.md`. Quatro bloqueiam (`git add -A`,
  `vercel --prod` sem alvo explícito, force push e `reset --hard`, `DROP` e
  `TRUNCATE`) e duas avisam (bump do `sw.js`; e envio pelo WhatsApp, Instagram
  ou Facebook passa pelo subagente `chefe-antiban`). Os padrões de git e vercel
  são ancorados em posição de comando, então mencionar um deles dentro de outro
  comando não bloqueia.
  Tudo isso depende de `python3` resolver para um Python de verdade no PATH: no
  Windows o atalho da Microsoft Store sai com código 49 e mata os hooks calado.

## Pendências

1. Fechar o backlog do eslint do `dashboard` (171 problemas em 11/09/2026) e
   tirar o `continue-on-error` dele em `.github/workflows/qualidade.yml`.
