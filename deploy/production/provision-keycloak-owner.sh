#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in docker jq; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

[[ -f .env ]] || {
  echo "Missing deploy/production/.env" >&2
  exit 1
}
[[ -s secrets/keycloak_bootstrap_admin_secret ]] || {
  echo "Missing Keycloak bootstrap secret" >&2
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

read -r -p "Owner email: " owner_email
owner_email="${owner_email,,}"
[[ "$owner_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "Invalid owner email" >&2
  exit 1
}

read -r -s -p "Temporary identity password (minimum 16 characters): " owner_password
echo
read -r -s -p "Repeat temporary identity password: " owner_password_repeat
echo
[[ "$owner_password" == "$owner_password_repeat" ]] || {
  echo "Passwords do not match" >&2
  exit 1
}
[[ ${#owner_password} -ge 16 && ${#owner_password} -le 128 ]] || {
  echo "Password length must be between 16 and 128 characters" >&2
  exit 1
}
unset owner_password_repeat

"${compose[@]}" exec -T keycloak /bin/bash -c '
  set -euo pipefail
  secret="$(</run/secrets/keycloak_bootstrap_admin_secret)"
  /opt/keycloak/bin/kcadm.sh config credentials \
    --config /tmp/redi-control-kcadm.config \
    --server http://127.0.0.1:8080/id \
    --realm master \
    --client redi-control-bootstrap \
    --secret "$secret" >/dev/null
  unset secret
'

kcadm=(
  "${compose[@]}" exec -T keycloak
  /opt/keycloak/bin/kcadm.sh
)
config=(--config /tmp/redi-control-kcadm.config)

existing="$("${kcadm[@]}" get users -r redi-control \
  -q exact=true -q "username=$owner_email" --fields id "${config[@]}")"
[[ "$(jq 'length' <<<"$existing")" == "0" ]] || {
  echo "The owner identity already exists; refusing duplicate provisioning" >&2
  exit 1
}

"${kcadm[@]}" create users -r redi-control \
  -s "username=$owner_email" \
  -s "email=$owner_email" \
  -s enabled=true \
  -s emailVerified=true \
  "${config[@]}" >/dev/null

created="$("${kcadm[@]}" get users -r redi-control \
  -q exact=true -q "username=$owner_email" --fields id "${config[@]}")"
owner_id="$(jq -er 'if length == 1 then .[0].id else error("owner lookup failed") end' <<<"$created")"

export KC_CLI_PASSWORD="$owner_password"
"${compose[@]}" exec -T -e KC_CLI_PASSWORD keycloak \
  /opt/keycloak/bin/kcadm.sh set-password \
  -r redi-control --userid "$owner_id" --temporary \
  "${config[@]}" >/dev/null
unset KC_CLI_PASSWORD owner_password

"${kcadm[@]}" update "users/$owner_id" -r redi-control \
  -s 'requiredActions=["UPDATE_PASSWORD","CONFIGURE_TOTP"]' \
  "${config[@]}" >/dev/null

bootstrap_clients="$("${kcadm[@]}" get clients -r master \
  -q clientId=redi-control-bootstrap --fields id "${config[@]}")"
bootstrap_id="$(jq -er 'if length == 1 then .[0].id else error("bootstrap client lookup failed") end' <<<"$bootstrap_clients")"
"${kcadm[@]}" delete "clients/$bootstrap_id" -r master "${config[@]}" >/dev/null

unset existing created owner_id bootstrap_clients bootstrap_id owner_email

echo "Owner identity created with forced password change and TOTP enrollment."
echo "The temporary Keycloak admin service account was revoked."
echo "Complete one identity login, then issue and consume the REDI CONTROL first-owner invitation."
