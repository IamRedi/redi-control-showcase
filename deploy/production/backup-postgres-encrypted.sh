#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"
configured_backup_directory="$(sed -n 's/^REDI_BACKUP_DIRECTORY=//p' .env | tail -n 1)"
backup_directory="${1:-${REDI_BACKUP_DIRECTORY:-$configured_backup_directory}}"
[[ -n "$backup_directory" && "$backup_directory" = /* ]] || {
  echo "Provide an absolute encrypted-backup directory." >&2
  exit 1
}

for command_name in docker gpg node npm sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

mkdir -p "$backup_directory"
chmod 700 "$backup_directory"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
plain_archive="$backup_directory/redi-control-$timestamp.dump"
encrypted_archive="$plain_archive.gpg"

cleanup() {
  [[ -e "$plain_archive" ]] && shred --remove --zero "$plain_archive"
}
trap cleanup EXIT

docker compose exec -T postgres sh -c \
  'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; pg_dump --format=custom --no-owner --no-acl --username redi_control_admin --dbname redi_control' \
  >"$plain_archive"
[[ -s "$plain_archive" ]] || {
  echo "PostgreSQL backup is empty" >&2
  exit 1
}

if [[ -n "${REDI_BACKUP_GPG_PASSPHRASE_FILE:-}" ]]; then
  [[ -s "$REDI_BACKUP_GPG_PASSPHRASE_FILE" ]] || {
    echo "Automated backup passphrase file is missing or empty." >&2
    exit 1
  }
  gpg --batch --pinentry-mode loopback --passphrase-file "$REDI_BACKUP_GPG_PASSPHRASE_FILE" \
    --quiet --symmetric --cipher-algo AES256 --output "$encrypted_archive" "$plain_archive"
  gpg --batch --pinentry-mode loopback --passphrase-file "$REDI_BACKUP_GPG_PASSPHRASE_FILE" \
    --quiet --decrypt "$encrypted_archive" >/dev/null
else
  echo "Set a new strong passphrase in the terminal prompt; do not reuse an application password."
  gpg --quiet --symmetric --cipher-algo AES256 --output "$encrypted_archive" "$plain_archive"
  gpg --quiet --decrypt "$encrypted_archive" >/dev/null
fi
chmod 600 "$encrypted_archive"
sha256sum "$encrypted_archive" >"$encrypted_archive.sha256"

runtime_value() {
  local name="$1"
  local value
  value="$(sed -n "s/^${name}=//p" runtime.env | tail -n 1)"
  [[ -n "$value" ]] || {
    echo "Missing $name in runtime.env" >&2
    exit 1
  }
  printf '%s' "$value"
}

export OBJECT_STORAGE_ENDPOINT="$(runtime_value OBJECT_STORAGE_ENDPOINT)"
export OBJECT_STORAGE_REGION="$(runtime_value OBJECT_STORAGE_REGION)"
export OBJECT_STORAGE_FORCE_PATH_STYLE="$(runtime_value OBJECT_STORAGE_FORCE_PATH_STYLE)"
export OBJECT_STORAGE_BUCKET="$(runtime_value OBJECT_STORAGE_BUCKET)"
export OBJECT_STORAGE_ACCESS_KEY_ID_FILE="$PWD/secrets/object_storage_access_key_id"
export OBJECT_STORAGE_SECRET_ACCESS_KEY_FILE="$PWD/secrets/object_storage_secret_access_key"
export POSTGRES_BACKUP_OBJECT_KEY="redi-control/production/backups/postgres/redi-control-$timestamp.dump.gpg"
npm run postgres:upload-backup -- "$encrypted_archive"

echo "Encrypted backup retained locally: $encrypted_archive"
