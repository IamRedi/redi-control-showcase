#!/usr/bin/env bash
set -euo pipefail

read_secret() {
  local name="$1"
  local path="$2"
  [[ -s "$path" ]] || {
    echo "Missing Keycloak secret: $name" >&2
    exit 1
  }
  printf -v "$name" '%s' "$(<"$path")"
  export "$name"
}

read_secret KC_DB_PASSWORD /run/secrets/identity_database_password
read_secret REDI_OIDC_CLIENT_SECRET /run/secrets/oidc_client_secret
read_secret KC_BOOTSTRAP_ADMIN_CLIENT_SECRET \
  /run/secrets/keycloak_bootstrap_admin_secret

exec /opt/keycloak/bin/kc.sh "$@"
