#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"
backup_path="${1:-}"
[[ -n "$backup_path" && "$backup_path" = /* && -f "$backup_path" ]] || {
  echo "Provide an absolute encrypted PostgreSQL backup path." >&2
  exit 1
}
[[ "$(stat -c '%a' "$backup_path")" == "600" ]] || {
  echo "Encrypted PostgreSQL backup must have mode 600." >&2
  exit 1
}

for command_name in docker gpg sed date; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

postgres_image="$(sed -n 's/^REDI_POSTGRES_IMAGE=//p' .env | tail -n 1)"
[[ -n "$postgres_image" ]] || {
  echo "REDI_POSTGRES_IMAGE is missing from .env" >&2
  exit 1
}
expected_migrations="$(sed -n 's/^EXPECTED_MIGRATION_COUNT=//p' runtime.env | tail -n 1)"
[[ "$expected_migrations" =~ ^[1-9][0-9]*$ ]] || {
  echo "EXPECTED_MIGRATION_COUNT is missing or invalid in runtime.env" >&2
  exit 1
}
container_name="redi-control-restore-drill-$(date -u +%Y%m%dT%H%M%SZ)"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "$container_name" --network none \
  --tmpfs /var/lib/postgresql/data:rw,size=2g,uid=999,gid=999,mode=0700 \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$postgres_image" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres >/dev/null
docker exec "$container_name" createdb -U postgres restore_drill
# PostgreSQL dumps do not include global roles. The schema's RLS policies name
# these roles, so create no-login, no-privilege placeholders only for restore.
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d restore_drill -c \
  'CREATE ROLE redi_control_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE redi_control_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE redi_control_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;' \
  >/dev/null

if [[ -n "${REDI_BACKUP_GPG_PASSPHRASE_FILE:-}" ]]; then
  [[ -s "$REDI_BACKUP_GPG_PASSPHRASE_FILE" ]] || {
    echo "Restore passphrase file is missing or empty." >&2
    exit 1
  }
  decrypt_command=(
    gpg --batch --pinentry-mode loopback
    --passphrase-file "$REDI_BACKUP_GPG_PASSPHRASE_FILE"
    --quiet --decrypt "$backup_path"
  )
else
  echo "Decrypt the backup only in the local terminal prompt if GPG requests it."
  decrypt_command=(gpg --quiet --decrypt "$backup_path")
fi
"${decrypt_command[@]}" |
  docker exec -i "$container_name" pg_restore \
    --exit-on-error --no-owner --no-acl --username postgres --dbname restore_drill

migrations="$(docker exec "$container_name" psql -U postgres -d restore_drill -tAc 'SELECT count(*) FROM control.schema_migrations')"
[[ "$migrations" == "$expected_migrations" ]] || {
  echo "Restore drill has an unexpected migration count (expected $expected_migrations, found $migrations)." >&2
  exit 1
}
docker exec "$container_name" psql -U postgres -d restore_drill -tAc \
  "SELECT EXISTS (SELECT 1 FROM control.tenants) AND EXISTS (SELECT 1 FROM control.installation_profiles) AND EXISTS (SELECT 1 FROM control.installation_domains WHERE status = 'active') AND EXISTS (SELECT 1 FROM control.memberships WHERE role = 'root_owner')" |
  grep -qx t || {
  echo "Restore drill is missing required installation data." >&2
  exit 1
}

echo "Isolated PostgreSQL restore drill passed; the temporary database is being removed."
