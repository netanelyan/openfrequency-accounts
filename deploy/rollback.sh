#!/usr/bin/env bash
# deploy/rollback.sh [--to <release folder or commit>] [--restore <backup file>]      on the server, as root
#
# Back to an earlier release (PRA-OPS-004, PRA-OPS-005): the one before the current, from releases/HISTORY, unless
# --to names one. Before it switches, it asks that build whether it can open the database (scripts/schema-check.js):
#
#   it can        `current` points back at it and of-accounts alone is reloaded
#   it cannot     a newer build migrated the database. Without --restore it stops and changes nothing. With
#                 --restore <the backup deploy.sh took before that deploy> it stops of-accounts, moves the database
#                 (and its -wal and -shm) aside as accounts.db.rolled-back-<time>, copies the backup in, switches and
#                 starts. The rows written since that backup stay in the file moved aside, for a look by hand.
#
# Then /readyz on 127.0.0.1:4740 is waited for, 60 seconds at most. Values from SERVER-FACTS.md, as in deploy.sh.

set -euo pipefail

ROOT=/opt/openfrequency-accounts
NODE_DIR=/opt/node24/bin
APP=of-accounts
READY=http://127.0.0.1:4740/readyz
DB="$ROOT/private/data/accounts.db"

TO=
RESTORE=
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO=$2; shift 2 ;;
    --restore) RESTORE=$2; shift 2 ;;
    *) echo "rollback: unknown argument $1" >&2; exit 2 ;;
  esac
done

export PATH="$NODE_DIR:$PATH"
CUR=$(readlink -f "$ROOT/current")
if [ -z "$TO" ]; then
  # The release before the current one in releases/HISTORY.
  TO=$(awk '{print $2}' "$ROOT/releases/HISTORY" | grep -vx "$(basename "$CUR")" | tail -n 1)
  [ -n "$TO" ] || { echo "rollback: no earlier release in $ROOT/releases/HISTORY; name one with --to" >&2; exit 2; }
fi
case "$TO" in /*) REL=$TO ;; *) REL="$ROOT/releases/$TO" ;; esac
[ -d "$REL" ] || { echo "rollback: no release folder $REL" >&2; exit 2; }
[ "$(readlink -f "$REL")" != "$CUR" ] || { echo "rollback: $REL is already current"; exit 0; }

set +e
OF_HOME="$ROOT/private" node "$REL/scripts/schema-check.js" "$DB"
CHECK=$?
set -e
if [ "$CHECK" -ne 0 ]; then
  [ -n "$RESTORE" ] || { echo "rollback: that build cannot open the database (schema-check $CHECK). Run again with --restore <the backup taken before the newer deploy, in releases/HISTORY>" >&2; exit 3; }
  [ -f "$RESTORE" ] || { echo "rollback: no backup at $RESTORE" >&2; exit 2; }
  OF_HOME="$ROOT/private" node "$REL/scripts/schema-check.js" "$RESTORE" || { echo "rollback: that build cannot open the backup either" >&2; exit 3; }
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  pm2 stop "$APP"
  for f in "$DB" "$DB-wal" "$DB-shm"; do [ -e "$f" ] && mv "$f" "$f.rolled-back-$STAMP"; done
  cp "$RESTORE" "$DB"
  echo "rollback: the database is the backup $RESTORE; the one it replaced is $DB.rolled-back-$STAMP"
fi

ln -sfn "$REL" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
if [ "$CHECK" -ne 0 ]; then pm2 start "$APP" --update-env; else pm2 reload "$APP" --update-env; fi

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "$READY"; then
    echo "rollback: $(basename "$REL") is live and ready"
    exit 0
  fi
  sleep 2
done
echo "rollback: $(basename "$REL") did not get ready in 60 seconds: pm2 logs $APP --lines 50" >&2
exit 1
