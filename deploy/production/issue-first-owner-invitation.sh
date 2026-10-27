#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in docker npm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

[[ -f .env ]] || {
  echo "Missing deploy/production/.env" >&2
  exit 1
}
[[ -s secrets/database_admin_url ]] || {
  echo "Missing database admin URL secret" >&2
  exit 1
}

compose=(docker compose)
if [[ -n "${REDI_COMPOSE_PROJECT_NAME:-}" ]]; then
  [[ "$REDI_COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]] || {
    echo "Invalid REDI_COMPOSE_PROJECT_NAME" >&2
    exit 1
  }
  compose+=(-p "$REDI_COMPOSE_PROJECT_NAME")
fi
export REDI_OPENBAO_UNSEAL_KEY_FILE="${REDI_OPENBAO_UNSEAL_KEY_FILE:-/dev/null}"

"${compose[@]}" ps --status running --services | grep -qx postgres || {
  echo "PostgreSQL is not running" >&2
  exit 1
}

read -r -p "Owner email for the one-time invitation: " owner_email
owner_email="${owner_email,,}"
[[ "$owner_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "Invalid owner email" >&2
  exit 1
}

echo "The one-time invitation will bind to the entered email, the single active installation and 24 hours."
read -r -p "Type ISSUE_FIRST_OWNER_INVITATION to continue: " confirmation
[[ "$confirmation" == "ISSUE_FIRST_OWNER_INVITATION" ]] || {
  echo "No invitation was issued." >&2
  exit 1
}

read -r tenant_id installation_id < <(
  "${compose[@]}" exec -T postgres /bin/sh -ceu '
    exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " " \
      -c "SELECT tenant_id, id FROM control.white_label_installations WHERE status = '\''active'\'' ORDER BY created_at;"
  '
)
[[ "$tenant_id" =~ ^[0-9a-f-]{36}$ && "$installation_id" =~ ^[0-9a-f-]{36}$ ]] || {
  echo "Expected exactly one active installation" >&2
  exit 1
}

second_installation="$(
  "${compose[@]}" exec -T postgres /bin/sh -ceu '
    exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At \
      -c "SELECT count(*) FROM control.white_label_installations WHERE status = '\''active'\'';"
  '
)"
[[ "$second_installation" == "1" ]] || {
  echo "Expected exactly one active installation" >&2
  exit 1
}

repo_root="$(cd ../.. && pwd)"
export BOOTSTRAP_TENANT_ID="$tenant_id"
export BOOTSTRAP_INSTALLATION_ID="$installation_id"
export BOOTSTRAP_OWNER_EMAIL="$owner_email"
export BOOTSTRAP_TTL_HOURS=24
export BOOTSTRAP_CONFIRM_OUTPUT=SHOW_ONCE

trap 'unset BOOTSTRAP_TENANT_ID BOOTSTRAP_INSTALLATION_ID BOOTSTRAP_OWNER_EMAIL BOOTSTRAP_TTL_HOURS BOOTSTRAP_CONFIRM_OUTPUT owner_email' EXIT

cd "$repo_root/deploy/production"
"${compose[@]}" run --rm --no-deps --build \
  -e BOOTSTRAP_TENANT_ID \
  -e BOOTSTRAP_INSTALLATION_ID \
  -e BOOTSTRAP_OWNER_EMAIL \
  -e BOOTSTRAP_TTL_HOURS \
  -e BOOTSTRAP_CONFIRM_OUTPUT \
  identity-bootstrap

echo "Copy the displayed token directly into the local HTTPS bootstrap page now."
echo "Do not place the token in chat, Git, email or a retained note."
