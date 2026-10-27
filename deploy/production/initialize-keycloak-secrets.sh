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
  identity_database_password
  oidc_client_secret
  keycloak_bootstrap_admin_secret
)

for secret_name in "${generated_names[@]}"; do
  if [[ -e "$secrets_dir/$secret_name" ]]; then
    echo "Refusing to overwrite existing secret: $secrets_dir/$secret_name" >&2
    exit 1
  fi
done

install -d -m 700 "$secrets_dir"
temporary_dir="$(mktemp -d "$secrets_dir/.keycloak-initialize.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

for secret_name in "${generated_names[@]}"; do
  openssl rand -hex 32 >"$temporary_dir/$secret_name"
  install -m 600 "$temporary_dir/$secret_name" "$secrets_dir/$secret_name"
done

echo "Generated Keycloak database, OIDC client and temporary bootstrap secrets with mode 600."
echo "The temporary bootstrap service account must be revoked after owner provisioning."
