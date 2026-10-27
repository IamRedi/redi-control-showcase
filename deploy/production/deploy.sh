#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

for command_name in docker curl git sudo systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

[[ -z "$(git status --porcelain)" ]] || {
  echo "Refusing deployment from a dirty Git worktree." >&2
  exit 1
}

version="$(sed -n 's/^REDI_VERSION=//p' .env | tail -n 1)"
source_revision="$(git rev-parse --short=7 HEAD)"
[[ -n "$version" && "$version" == "$source_revision" ]] || {
  echo "REDI_VERSION must equal the current Git revision ($source_revision)." >&2
  exit 1
}

docker compose version >/dev/null

for required_file in .env runtime.env; do
  [[ -f "$required_file" ]] || {
    echo "Missing deploy/production/$required_file" >&2
    exit 1
  }
done

required_secrets=(
  postgres_admin_password
  database_admin_url
  database_runtime_password
  database_auth_password
  database_runtime_url
  database_auth_url
  oidc_client_secret
  identity_database_password
  keycloak_bootstrap_admin_secret
  keycloak_member_provisioner_secret
  oidc_transaction_key
  social_oauth_state_secret
  meta_app_secret
  object_storage_access_key_id
  object_storage_secret_access_key
  openbao_ca_cert
  openbao_tls_cert
  openbao_tls_key
  openbao_approle_role_id
  openbao_approle_secret_id
)

for secret_name in "${required_secrets[@]}"; do
  secret_path="secrets/$secret_name"
  [[ -s "$secret_path" ]] || {
    echo "Missing or empty secret file: $secret_path" >&2
    exit 1
  }
  permissions="$(stat -c '%a' "$secret_path")"
  [[ "$permissions" == "600" ]] || {
    echo "Secret file must have mode 600: $secret_path (found $permissions)" >&2
    exit 1
  }
done

[[ -f /etc/systemd/system/redi-control.service ]] || {
  echo "Install the reviewed systemd units before deployment." >&2
  exit 1
}
sudo test -s /etc/credstore.encrypted/openbao_unseal_key || {
  echo "Missing TPM2-encrypted OpenBao credential." >&2
  exit 1
}

# Configuration/build/migration do not start OpenBao. Its real plaintext source
# exists only inside the systemd service credential directory.
export REDI_OPENBAO_UNSEAL_KEY_FILE=/dev/null
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait postgres
docker compose run --rm keycloak-db-init
docker compose run --rm migrate
sudo systemctl enable redi-control.service
sudo systemctl restart redi-control.service

domain="$(sed -n 's/^REDI_DOMAIN=//p' .env | tail -n 1)"
[[ -n "$domain" ]] || {
  echo "REDI_DOMAIN is missing from .env" >&2
  exit 1
}

echo "Containers started. Waiting for hardened readiness at https://$domain/health/ready"
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "https://$domain/health/ready" >/dev/null; then
    docker compose ps
    echo "REDI CONTROL deployment is ready."
    exit 0
  fi
  sleep 2
done

docker compose ps >&2
echo "Deployment is live but hardened readiness did not pass. Inspect: docker compose logs api worker caddy" >&2
exit 1
