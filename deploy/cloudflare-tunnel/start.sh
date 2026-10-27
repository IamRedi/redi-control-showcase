#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

for command_name in curl docker; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

docker compose version >/dev/null

[[ -f .env ]] || {
  echo "Missing deploy/cloudflare-tunnel/.env" >&2
  exit 1
}

read_setting() {
  local name="$1"
  sed -n "s/^${name}=//p" .env | tail -n 1
}

domain="$(read_setting REDI_DOMAIN)"
origin_url="$(read_setting REDI_ORIGIN_URL)"
token_file="$(read_setting CLOUDFLARE_TUNNEL_TOKEN_FILE)"

[[ "$domain" =~ ^[a-z0-9.-]+$ ]] || {
  echo "REDI_DOMAIN must be an exact lowercase hostname" >&2
  exit 1
}

[[ "$origin_url" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || {
  echo "REDI_ORIGIN_URL must be an HTTP loopback origin such as http://127.0.0.1:8080" >&2
  exit 1
}

[[ -n "$token_file" && -s "$token_file" ]] || {
  echo "Missing or empty Cloudflare tunnel token file" >&2
  exit 1
}

token_metadata="$(stat -c '%u:%g:%a' "$token_file")"
[[ "$token_metadata" == "0:65532:640" ]] || {
  echo "Tunnel token must be root:65532 mode 640 (found $token_metadata)" >&2
  exit 1
}

docker compose config --quiet

curl --fail --silent --show-error \
  --header "Host: $domain" \
  "$origin_url/health/ingress" >/dev/null || {
  echo "The core loopback ingress gate is not ready; tunnel startup refused" >&2
  exit 1
}

issuer="https://$domain/id/realms/redi-control"
discovery="$({
  curl --fail --silent --show-error \
    --header "Host: $domain" \
    "$origin_url/id/realms/redi-control/.well-known/openid-configuration"
} 2>/dev/null)" || {
  echo "The private Keycloak discovery route is not ready" >&2
  exit 1
}
[[ "$discovery" == *"\"issuer\":\"$issuer\""* ]] || {
  echo "The Keycloak issuer does not match the exact public origin" >&2
  exit 1
}

docker compose up -d
docker compose ps
