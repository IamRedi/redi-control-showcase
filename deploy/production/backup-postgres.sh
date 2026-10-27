#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"
backup_directory="${1:-}"
[[ -n "$backup_directory" ]] || {
  echo "Usage: ./backup-postgres.sh /absolute/off-host-staging-directory" >&2
  exit 1
}
[[ "$backup_directory" = /* ]] || {
  echo "Backup directory must be an absolute path" >&2
  exit 1
}
mkdir -p "$backup_directory"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
archive="$backup_directory/redi-control-$timestamp.dump"
checksum="$archive.sha256"

docker compose exec -T postgres sh -c \
  'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; pg_dump --format=custom --no-owner --no-acl --username redi_control_admin --dbname redi_control' \
  >"$archive"

[[ -s "$archive" ]] || {
  rm -f "$archive"
  echo "PostgreSQL backup is empty" >&2
  exit 1
}

sha256sum "$archive" >"$checksum"
echo "Created $archive and checksum. Copy both to encrypted off-host storage now."
