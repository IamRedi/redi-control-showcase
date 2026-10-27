#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in install mktemp openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

secrets_dir="${REDI_SECRETS_DIR:-./secrets}"
generated_names=(
  postgres_admin_password
  database_admin_url
  database_runtime_password
  database_auth_password
  database_runtime_url
  database_auth_url
  oidc_transaction_key
  social_oauth_state_secret
)

for secret_name in "${generated_names[@]}"; do
  if [[ -e "$secrets_dir/$secret_name" ]]; then
    echo "Refusing to overwrite existing secret: $secrets_dir/$secret_name" >&2
    exit 1
  fi
done

install -d -m 700 "$secrets_dir"
temporary_dir="$(mktemp -d "$secrets_dir/.initialize.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

postgres_admin_password="$(openssl rand -hex 32)"
database_runtime_password="$(openssl rand -hex 32)"
database_auth_password="$(openssl rand -hex 32)"
oidc_transaction_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
social_oauth_state_secret="$(openssl rand -hex 32)"

printf '%s' "$postgres_admin_password" >"$temporary_dir/postgres_admin_password"
printf 'postgresql://redi_control_admin:%s@postgres:5432/redi_control' \
  "$postgres_admin_password" >"$temporary_dir/database_admin_url"
printf '%s' "$database_runtime_password" >"$temporary_dir/database_runtime_password"
printf '%s' "$database_auth_password" >"$temporary_dir/database_auth_password"
printf 'postgresql://redi_control_runtime:%s@postgres:5432/redi_control' \
  "$database_runtime_password" >"$temporary_dir/database_runtime_url"
printf 'postgresql://redi_control_auth:%s@postgres:5432/redi_control' \
  "$database_auth_password" >"$temporary_dir/database_auth_url"
printf '%s' "$oidc_transaction_key" >"$temporary_dir/oidc_transaction_key"
printf '%s' "$social_oauth_state_secret" >"$temporary_dir/social_oauth_state_secret"

for secret_name in "${generated_names[@]}"; do
  install -m 600 "$temporary_dir/$secret_name" "$secrets_dir/$secret_name"
done

unset postgres_admin_password database_runtime_password database_auth_password
unset oidc_transaction_key social_oauth_state_secret

echo "Generated local database and transaction secrets with mode 600."
echo "Still required from their external owners:"
echo "- oidc_client_secret"
echo "- object_storage_access_key_id"
echo "- object_storage_secret_access_key"
