#!/usr/bin/env bash
# deploy/deploy.sh [<commit>] [--skip-tests]       on the server, as root (pm2 runs as root there)
#
# One deploy of accounts in release folders (PRA-OPS-004, PRA-DB-009, PRA-QA-007, PRA-OPS-006), the old build left
# untouched until the new one is ready:
#
#   1. the commit (origin/main unless one is named) checked out on its own in releases/<commit> (a git worktree of the
#      clone at /opt/openfrequency-accounts), its REVISION written, its packages installed
#   2. the tests, in that folder, before anything changes (--skip-tests only in an emergency, and say so)
#   3. a backup of the database, checked (scripts/backup.js --tag pre-<commit>): no backup, no deploy
#   4. `current` pointed at the new folder, and of-accounts alone reloaded (the same pm2 runs other apps: nothing
#      else is touched)
#   5. /readyz on 127.0.0.1:4740 waited for, 60 seconds at most. Not ready: deploy/rollback.sh puts the last release
#      back, with the backup from step 3 if the new build migrated the database
#   6. the newest 5 releases kept; the line "<time> <commit> <backup>" added to releases/HISTORY
#
# Before the first run, the one-time move to release folders: docs/deploy.md, "Release folders, once".
#
# Values from SERVER-FACTS.md (checked on the server 2026-10-29): the clone and private/ in /opt/openfrequency-accounts,
# Node at /opt/node24/bin/node, the pm2 process of-accounts, the site on 127.0.0.1:4740 (checked with curl's own Host
# header: Host accounts.openfrequency.co.il is refused there with 403).

set -euo pipefail

ROOT=/opt/openfrequency-accounts
NODE_DIR=/opt/node24/bin
APP=of-accounts
READY=http://127.0.0.1:4740/readyz
KEEP=5

TARGET=origin/main
TESTS=1
for a in "$@"; do
  case "$a" in
    --skip-tests) TESTS=0 ;;
    -*) echo "deploy: unknown option $a" >&2; exit 2 ;;
    *) TARGET=$a ;;
  esac
done

export PATH="$NODE_DIR:$PATH"
command -v pm2 >/dev/null || { echo "deploy: pm2 is not on PATH (UNVERIFIED where root's pm2 lives: command -v pm2)" >&2; exit 2; }
[ -L "$ROOT/current" ] || { echo "deploy: $ROOT/current is not a link yet: do the one-time move first (docs/deploy.md, \"Release folders, once\")" >&2; exit 2; }

git -C "$ROOT" fetch --quiet origin
SHA=$(git -C "$ROOT" rev-parse --verify "$TARGET^{commit}")
REL="$ROOT/releases/$SHA"
PREV=$(readlink -f "$ROOT/current")
if [ "$PREV" = "$REL" ]; then
  echo "deploy: $SHA is already the current release"
  exit 0
fi

echo "deploy: $SHA into $REL (now: $(basename "$PREV"))"
mkdir -p "$ROOT/releases"
[ -d "$REL" ] || git -C "$ROOT" worktree add --detach "$REL" "$SHA"
echo "$SHA" > "$REL/REVISION"
cd "$REL"
if [ "$TESTS" = 1 ]; then
  npm ci --no-audit --no-fund
  npm test
  npm prune --omit=dev --no-audit --no-fund
else
  echo "deploy: --skip-tests: this commit was not tested here"
  npm ci --omit=dev --no-audit --no-fund
fi

# No backup, no deploy. The tag finds the copy again for a rollback.
BACKUP_LINE=$(OF_HOME="$ROOT/private" node "$REL/scripts/backup.js" --keep 14 --tag "pre-${SHA:0:12}")
echo "$BACKUP_LINE"
BACKUP=$(printf '%s\n' "$BACKUP_LINE" | sed -n 's/^backup: \([^ ]*\) .*/\1/p')
[ -n "$BACKUP" ] || { echo "deploy: no backup file in the backup's answer; stopping" >&2; exit 1; }

ln -sfn "$REL" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
pm2 reload "$APP" --update-env

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "$READY"; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA $BACKUP" >> "$ROOT/releases/HISTORY"
    echo "deploy: $SHA is live and ready"
    # The newest releases stay, the current one always among them.
    ls -1dt "$ROOT"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
      [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/current")" ] && continue
      git -C "$ROOT" worktree remove --force "$old"
    done
    exit 0
  fi
  sleep 2
done

echo "deploy: $SHA did not get ready in 60 seconds; rolling back to $(basename "$PREV")" >&2
"$REL/deploy/rollback.sh" --to "$PREV" --restore "$BACKUP" || true
command -v of-alert >/dev/null && of-alert "accounts: deploy of ${SHA:0:12} rolled back" "It was not ready in 60 seconds. Rolled back to $(basename "$PREV")."
exit 1
