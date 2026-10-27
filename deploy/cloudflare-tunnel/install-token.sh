#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in install sudo; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

[[ -f .env ]] || {
  echo "Missing deploy/cloudflare-tunnel/.env" >&2
  exit 1
}

token_file="$(sed -n 's/^CLOUDFLARE_TUNNEL_TOKEN_FILE=//p' .env | tail -n 1)"
[[ "$token_file" =~ ^\./secrets/[a-z0-9_-]+$ ]] || {
  echo "CLOUDFLARE_TUNNEL_TOKEN_FILE must be a local ./secrets/ path" >&2
  exit 1
}
[[ ! -e "$token_file" ]] || {
  echo "Refusing to overwrite existing Cloudflare tunnel token" >&2
  exit 1
}

read -r -s -p "Paste the Cloudflare Docker command or tunnel token, then press Enter: " input
echo
token="$input"
if [[ "$input" =~ (^|[[:space:]])--token[[:space:]]+([A-Za-z0-9._~+/=-]{80,4096})($|[[:space:]]) ]]; then
  token="${BASH_REMATCH[2]}"
fi
unset input
[[ "$token" =~ ^[A-Za-z0-9._~+/=-]{80,4096}$ ]] || {
  echo "Tunnel token format is invalid" >&2
  exit 1
}

install -d -m 700 "$(dirname "$token_file")"
temporary_file="$(mktemp "$(dirname "$token_file")/.cloudflare-token.XXXXXX")"
cleanup() {
  rm -f -- "$temporary_file"
}
trap cleanup EXIT

printf '%s' "$token" >"$temporary_file"
unset token
sudo install -o root -g 65532 -m 640 "$temporary_file" "$token_file"

echo "Cloudflare tunnel token saved locally for root and the Cloudflared runtime group."
