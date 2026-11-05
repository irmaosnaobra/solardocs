#!/usr/bin/env bash
# Publica no main o que está no HEAD, passando pelo CI.
# O ruleset do main recusa push direto: o commit só entra depois que
# "api — typecheck e testes", "Varredura de segredos" e "dashboard — lint" passam.
# Uso, de qualquer clone ou worktree, com os commits já feitos:
#   bash scripts/publicar.sh
# Sai 0 com o sha que entrou no main, ou 1 dizendo o que travou.
# Fala direto com a API do GitHub (curl), sem o gh, que trava com a máquina
# carregada. O token vem do GH_TOKEN ou da mesma credencial que o git push usa.
set -euo pipefail

REPO="irmaosnaobra/solardocs"
API="https://api.github.com/repos/$REPO"
ESPERA_MAX="${ESPERA_MAX:-1500}" # segundos
CHECKS="api — typecheck e testes|Varredura de segredos|dashboard — lint"

TOKEN="${GH_TOKEN:-$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')}"
if [ -z "$TOKEN" ]; then
  echo "Sem credencial do GitHub. Rode um git push qualquer para o Git guardar a senha, ou exporte GH_TOKEN."
  exit 1
fi

api() { curl -sS -m 60 --retry 3 --retry-all-errors -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
json() { python3 -c "import sys, json; d = json.load(sys.stdin); $1" 2>/dev/null; } # resposta vazia da API vira falha calada e a volta seguinte tenta de novo

git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "O main andou. Fazendo rebase em cima do origin/main."
  if ! git rebase -q origin/main; then
    git rebase --abort
    echo "Conflito no rebase. Resolva, faça commit e rode de novo."
    exit 1
  fi
fi

N="$(git rev-list --count origin/main..HEAD)"
if [ "$N" -eq 0 ]; then
  echo "Nada para publicar: o HEAD já está no main."
  exit 0
fi

RAMO="pub/$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
TITULO="$(git log -1 --format=%s)"
if [ "$N" -gt 1 ]; then TITULO="$TITULO (+$((N - 1)) commits)"; fi
CORPO="$(git log --reverse --format='- %s' origin/main..HEAD)

Publicado pelo scripts/publicar.sh. Entra sozinho no main quando o CI passar.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

git push -q origin "HEAD:refs/heads/$RAMO"

PEDIDO="$(TITULO="$TITULO" RAMO="$RAMO" CORPO="$CORPO" python3 -c "import json, os; print(json.dumps({'title': os.environ['TITULO'], 'head': os.environ['RAMO'], 'base': 'main', 'body': os.environ['CORPO']}))")"
PR="$(api -X POST "$API/pulls" -d "$PEDIDO" | json "print(d['number'], d['node_id']) if 'number' in d else print('ERRO', d.get('message'), d.get('errors'))")"
case "$PR" in ERRO*) echo "Não consegui abrir o PR: $PR"; exit 1;; esac
NUM="${PR%% *}"
NODE="${PR#* }"
echo "PR: https://github.com/$REPO/pull/$NUM"

MUTACAO="$(NODE="$NODE" python3 -c "import json, os; print(json.dumps({'query': 'mutation{enablePullRequestAutoMerge(input:{pullRequestId:\"%s\",mergeMethod:REBASE}){pullRequest{number}}}' % os.environ['NODE']}))")"
AUTO="$(api https://api.github.com/graphql -d "$MUTACAO" | json "print('ok' if not d.get('errors') else d['errors'][0].get('message'))")"
if [ "$AUTO" != ok ]; then
  echo "O PR abriu, mas o merge automático não ligou: $AUTO"
  exit 1
fi

INICIO="$(date +%s)"
while :; do
  ESTADO="$(api "$API/pulls/$NUM" | json "print('MERGED ' + d['merge_commit_sha'] if d.get('merged') else d['state'].upper())" || echo ERRO)"
  case "$ESTADO" in
    MERGED*) echo "No main: ${ESTADO#MERGED }"; exit 0;;
    CLOSED) echo "O PR foi fechado sem entrar no main."; exit 1;;
  esac
  FALHA="$(api "$API/commits/$RAMO/check-runs" | CHECKS="$CHECKS" json "import os; q = os.environ['CHECKS'].split('|'); print(', '.join(c['name'] for c in d.get('check_runs', []) if c['name'] in q and c.get('conclusion') in ('failure', 'cancelled', 'timed_out')))" || true)"
  if [ -n "$FALHA" ]; then
    echo "O CI reprovou: $FALHA"
    echo "O PR continua aberto e com merge automático ligado. Corrija, faça commit e empurre para o mesmo ramo:"
    echo "  git push origin HEAD:refs/heads/$RAMO"
    echo "Para desistir, feche o PR $NUM no GitHub."
    exit 1
  fi
  if [ $(( $(date +%s) - INICIO )) -gt "$ESPERA_MAX" ]; then
    echo "Passou de $ESPERA_MAX s esperando o CI. Veja o PR $NUM."
    exit 1
  fi
  sleep 20
done
