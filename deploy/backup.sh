#!/usr/bin/env sh
# Nightly D1 backup: consistent sqlite copy inside the web container's /data volume,
# then (optionally) mirrored off the server. Run from the repo dir on the VPS:
#   ./deploy/backup.sh            (cron: deploy/cron.example)
# Env: BACKUP_KEEP (default 14), OFFSITE_DIR (optional host dir, e.g. a mounted remote).
# ENCRYPTION_KEY is NOT in the backup; keep it in a password manager, separately.
set -eu

cd "$(dirname "$0")/.."
KEEP="${BACKUP_KEEP:-14}"

docker compose exec -T -e BACKUP_KEEP="$KEEP" web node scripts/d1-backup.mjs

if [ -n "${OFFSITE_DIR:-}" ]; then
  mkdir -p "$OFFSITE_DIR"
  docker compose cp web:/data/backups/. "$OFFSITE_DIR/"
  # mirror the retention window off-site too
  ls -1 "$OFFSITE_DIR"/uniseller-d1-*.sqlite 2>/dev/null | sort | head -n "-$KEEP" | xargs -r rm -f
fi
