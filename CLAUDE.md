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
- **Nada de force push nem `reset --hard`.** Sem branch protection no `main`, o
  force push sobrescreve o remoto sem rede de segurança. `--force-with-lease`
  não é bloqueado e `git revert` resolve quase sempre.

## Estado atual (03/11/2026)

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
- **PENDENTE e visível:** o `CRON_SECRET` vazado no runbook ainda é aceito em
  produção como `CRON_SECRET_ANTERIOR`, porque o pg_cron do `/process-messages`
  usa ele. Vale até o dono autorizar o conector do Supabase. Depois disso,
  apagar o `CRON_SECRET_ANTERIOR`.
- Hook de **pre-push** em `.githooks/pre-push`: roda o gitleaks só no intervalo que
  sobe (com `--redact`) e, se o intervalo mexe em `api/`, o `tsc --noEmit`. Recusa
  o push se um dos dois falhar. Sem gitleaks ou sem `api/node_modules` ele avisa e
  segue. O `tsc` confere o que está no disco. Emergência: `git push --no-verify`.
  Vale com `core.hooksPath` ligado, igual ao pre-commit.
- `main` não tem branch protection. Há pre-commit e pre-push em `.githooks/`
  (precisam de `core.hooksPath` ligado no clone).
- Hooks: 6 regras em `.claude/hookify.*.local.md`. Quatro bloqueiam (`git add -A`,
  `vercel --prod` sem alvo explícito, force push e `reset --hard`, `DROP` e
  `TRUNCATE`) e duas avisam (bump do `sw.js`; e envio pelo WhatsApp, Instagram
  ou Facebook passa pelo subagente `chefe-antiban`). Os padrões de git e vercel
  são ancorados em posição de comando, então mencionar um deles dentro de outro
  comando não bloqueia.
  Tudo isso depende de `python3` resolver para um Python de verdade no PATH: no
  Windows o atalho da Microsoft Store sai com código 49 e mata os hooks calado.

## Pendências

1. Segredos, estado em 03/11/2026:
   - `CRON_SECRET`: girado em 03/11. O valor vazado no runbook ainda é aceito
     em produção só como `CRON_SECRET_ANTERIOR`, porque o pg_cron do
     `/process-messages` usa ele, até o dono autorizar o conector do Supabase.
     Depois disso, apagar o `CRON_SECRET_ANTERIOR`. Esta pendência tem que
     ficar visível: enquanto ela existir, o valor vazado ainda abre a rota.
   - `JWT_SECRET`: o valor que estava no `SETUP_PROMPT.md` não é o de produção
     (conferido em 03/11 comparando com a env da Vercel). O de produção nunca
     vazou em arquivo.
   - `MCP_TOKEN`: girado em 03/11, e o vazado dá 401. O OAuth do MCP foi fechado.
   - `api/test-db.js`: a senha do banco escrita ali estava morta (em 03/11 deu
     "password authentication failed"). O arquivo foi apagado.
   - Tokens do Meta: saíram do código (`pixelController.ts`) e o dono precisa
     revogá-los no Meta.
   Os valores saíram do `SECURITY-RUNBOOK.md`, do `SETUP_PROMPT.md`, do
   `cloudflare-worker/webhook.js` (agora lê `env.CRON_SECRET`) e do `setup.ts`
   dos testes. Os valores antigos seguem no histórico do git.
2. Fechar o backlog do eslint do `dashboard` (171 problemas em 11/09/2026) e
   tirar o `continue-on-error` dele em `.github/workflows/qualidade.yml`.
3. Ligar branch protection no `main` exigindo `Qualidade` e `Segurança`:
   **continua aberta**. O pre-push já cobre o caso local, e a protection
   forçaria PR para todas as sessões, que hoje publicam direto no `main`.
   Decisão do dono.
4. `dashboard/` e `widget/` não têm `.env.example`.
