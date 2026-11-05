#!/usr/bin/env bash
# Publica no main o que está no HEAD, passando pelo CI.
# O ruleset do main recusa push direto: o commit só entra depois que
# "api — typecheck e testes", "Varredura de segredos" e "dashboard — lint" passam.
# Uso, de qualquer clone ou worktree, com os commits já feitos:
#   bash scripts/publicar.sh
# Sai 0 com o sha que entrou no main, ou 1 dizendo o que travou.
set -euo pipefail

REPO="irmaosnaobra/solardocs"
ESPERA_MAX="${ESPERA_MAX:-1500}" # segundos
CHECKS='["api — typecheck e testes","Varredura de segredos","dashboard — lint"]'

gh_() { timeout 90 gh "$@"; }

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
URL="$(gh_ pr create -R "$REPO" --base main --head "$RAMO" --title "$TITULO" --body "$CORPO")"
echo "PR: $URL"
gh_ pr merge -R "$REPO" "$URL" --auto --rebase --delete-branch

INICIO="$(date +%s)"
while :; do
  ESTADO="$(gh_ pr view -R "$REPO" "$URL" --json state -q .state || echo ERRO)"
  if [ "$ESTADO" = MERGED ]; then
    echo "No main: $(gh_ pr view -R "$REPO" "$URL" --json mergeCommit -q .mergeCommit.oid)"
    exit 0
  fi
  if [ "$ESTADO" = CLOSED ]; then
    echo "O PR foi fechado sem entrar no main: $URL"
    exit 1
  fi
  FALHA="$(gh_ pr view -R "$REPO" "$URL" --json statusCheckRollup -q "[.statusCheckRollup[] | select(.name as \$n | $CHECKS | index(\$n)) | select(.conclusion == \"FAILURE\" or .conclusion == \"CANCELLED\" or .conclusion == \"TIMED_OUT\") | .name] | join(\", \")" || true)"
  if [ -n "$FALHA" ]; then
    echo "O CI reprovou: $FALHA"
    echo "O PR continua aberto e com merge automático ligado. Corrija, faça commit e empurre para o mesmo ramo:"
    echo "  git push origin HEAD:refs/heads/$RAMO"
    echo "Para desistir: gh pr close $URL --delete-branch"
    exit 1
  fi
  if [ $(( $(date +%s) - INICIO )) -gt "$ESPERA_MAX" ]; then
    echo "Passou de $ESPERA_MAX s esperando o CI. Veja o PR: $URL"
    exit 1
  fi
  sleep 20
done
