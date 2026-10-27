#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

if [[ $# -ne 1 || "$1" != /* ]]; then
  echo "Usage: $0 /absolute/off-host-copy-target/openbao-recovery.json.gpg" >&2
  exit 1
fi
recovery_bundle="$1"
if [[ -e "$recovery_bundle" ]]; then
  echo "Refusing to overwrite recovery bundle: $recovery_bundle" >&2
  exit 1
fi
if [[ ! -d "$(dirname "$recovery_bundle")" ]]; then
  echo "Recovery bundle parent directory does not exist." >&2
  exit 1
fi

for command_name in docker gpg install mktemp node openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

secrets_dir="${REDI_SECRETS_DIR:-./secrets}"
for output_name in openbao_approle_role_id openbao_approle_secret_id; do
  if [[ -e "$secrets_dir/$output_name" ]]; then
    echo "Refusing to overwrite existing credential: $secrets_dir/$output_name" >&2
    exit 1
  fi
done

# The API runtime file and AppRole secrets intentionally do not exist before
# this bootstrap. These overrides let Compose address only the already-running
# OpenBao container without weakening the eventual production configuration.
export REDI_RUNTIME_ENV_FILE="${REDI_RUNTIME_ENV_FILE:-./runtime.env.example}"
export REDI_OPENBAO_UNSEAL_KEY_FILE="${REDI_OPENBAO_UNSEAL_KEY_FILE:-/dev/null}"
compose=(docker compose --env-file .env -f compose.yaml)
set +e
"${compose[@]}" exec -T openbao bao operator init -status >/dev/null 2>&1
init_status=$?
set -e
if [[ $init_status -ne 2 ]]; then
  echo "OpenBao is not in the expected running, uninitialized state." >&2
  exit 1
fi

temporary_dir="$(mktemp -d /dev/shm/redi-openbao-bootstrap.XXXXXX)"
safe_to_cleanup=true
cleanup() {
  if [[ "$safe_to_cleanup" == true ]]; then
    rm -rf -- "$temporary_dir"
  else
    echo "Bootstrap stopped after initialization." >&2
    echo "Emergency plaintext recovery material remains mode-600 in: $temporary_dir" >&2
    echo "Do not reboot; complete encrypted recovery before removing it." >&2
  fi
}
trap cleanup EXIT

# Validate symmetric GPG encryption and the operator's passphrase before the
# irreversible OpenBao initialization call. GPG agent normally caches it for
# the immediately following real encryption.
openssl rand -out "$temporary_dir/preflight" 32
gpg --quiet --symmetric --cipher-algo AES256 \
  --s2k-mode 3 --s2k-digest-algo SHA512 \
  --output "$temporary_dir/preflight.gpg" "$temporary_dir/preflight"
gpg --quiet --decrypt "$temporary_dir/preflight.gpg" >/dev/null

"${compose[@]}" exec -T openbao bao operator init \
  -format=json -recovery-shares=5 -recovery-threshold=3 \
  >"$temporary_dir/init.json"
chmod 600 "$temporary_dir/init.json"
safe_to_cleanup=false

gpg --quiet --symmetric --cipher-algo AES256 \
  --s2k-mode 3 --s2k-digest-algo SHA512 \
  --output "$recovery_bundle" "$temporary_dir/init.json"
chmod 600 "$recovery_bundle"
gpg --quiet --decrypt "$recovery_bundle" >/dev/null

root_token="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (typeof value.root_token !== "string" || value.root_token.length < 16 ||
      !Array.isArray(value.recovery_keys_b64) || value.recovery_keys_b64.length !== 5) {
    process.exit(1);
  }
  process.stdout.write(value.root_token);
' "$temporary_dir/init.json")"

bao_root() {
  printf '%s\n' "$root_token" | "${compose[@]}" exec -T openbao sh -c \
    'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' sh "$@"
}

bao_root secrets enable -path=redi-control -version=2 kv >/dev/null
bao_root auth enable approle >/dev/null

cat >"$temporary_dir/redi-control-api-policy.hcl" <<'EOF'
path "redi-control/data/tenants/*" {
  capabilities = ["create", "read", "update"]
}

path "redi-control/metadata/tenants/*" {
  capabilities = ["read", "delete"]
}
EOF
{
  printf '%s\n' "$root_token"
  cat "$temporary_dir/redi-control-api-policy.hcl"
} | "${compose[@]}" exec -T openbao sh -c \
  'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao policy write redi-control-api -' \
  >/dev/null

bao_root write auth/approle/role/redi-control-api \
  token_policies=redi-control-api \
  token_ttl=15m token_max_ttl=30m \
  secret_id_ttl=2160h secret_id_num_uses=0 >/dev/null
bao_root read -field=role_id auth/approle/role/redi-control-api/role-id \
  >"$temporary_dir/role_id"
bao_root write -field=secret_id -f \
  auth/approle/role/redi-control-api/secret-id \
  >"$temporary_dir/secret_id"

install -d -m 700 "$secrets_dir"
install -m 600 "$temporary_dir/role_id" \
  "$secrets_dir/openbao_approle_role_id"
install -m 600 "$temporary_dir/secret_id" \
  "$secrets_dir/openbao_approle_secret_id"

bao_root token revoke -self >/dev/null
unset root_token
safe_to_cleanup=true

echo "OpenBao initialized with KV v2, least-privilege AppRole and five recovery shares (threshold three)."
echo "The bootstrap root token was revoked and no credential was printed."
echo "Copy the encrypted recovery bundle off this host before continuing: $recovery_bundle"
