#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in install mktemp openssl sudo systemd-creds; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

if [[ "$(systemd-creds has-tpm2 2>/dev/null | head -n 1)" != "yes" ]]; then
  echo "A usable TPM2 device is required." >&2
  exit 1
fi

secrets_dir="${REDI_SECRETS_DIR:-./secrets}"
encrypted_credential="${REDI_OPENBAO_ENCRYPTED_CREDENTIAL:-/etc/credstore.encrypted/openbao_unseal_key}"
outputs=(openbao_ca_cert openbao_tls_cert openbao_tls_key)

echo "Administrative authorization is required for TPM2 enrollment."
sudo -v

for output_name in "${outputs[@]}"; do
  if [[ -e "$secrets_dir/$output_name" ]]; then
    echo "Refusing to overwrite existing material: $secrets_dir/$output_name" >&2
    exit 1
  fi
done
if sudo test -e "$encrypted_credential"; then
  echo "Refusing to overwrite encrypted credential: $encrypted_credential" >&2
  exit 1
fi

install -d -m 700 "$secrets_dir"
temporary_dir="$(mktemp -d /dev/shm/redi-openbao-enroll.XXXXXX)"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
  -out "$temporary_dir/ca.key" >/dev/null 2>&1
openssl req -x509 -new -sha256 -days 1825 \
  -key "$temporary_dir/ca.key" \
  -subj "/CN=REDI CONTROL OpenBao Local CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out "$temporary_dir/ca.crt"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
  -out "$temporary_dir/server.key" >/dev/null 2>&1
openssl req -new -sha256 -key "$temporary_dir/server.key" \
  -subj "/CN=openbao" \
  -addext "subjectAltName=DNS:openbao,IP:127.0.0.1" \
  -out "$temporary_dir/server.csr"
cat >"$temporary_dir/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:openbao,IP:127.0.0.1
EOF
openssl x509 -req -sha256 -days 825 \
  -in "$temporary_dir/server.csr" \
  -CA "$temporary_dir/ca.crt" \
  -CAkey "$temporary_dir/ca.key" \
  -CAcreateserial \
  -extfile "$temporary_dir/server.ext" \
  -out "$temporary_dir/server.crt" >/dev/null 2>&1
cat "$temporary_dir/server.crt" "$temporary_dir/ca.crt" \
  >"$temporary_dir/server-chain.crt"

openssl rand -out "$temporary_dir/unseal.key" 32
sudo install -d -o root -g root -m 700 "$(dirname "$encrypted_credential")"
sudo systemd-creds encrypt \
  --name=openbao_unseal_key \
  --with-key=tpm2 \
  --tpm2-device=auto \
  "$temporary_dir/unseal.key" "$encrypted_credential"
sudo chmod 600 "$encrypted_credential"
sudo systemd-creds decrypt "$encrypted_credential" /dev/null

install -m 600 "$temporary_dir/ca.crt" "$secrets_dir/openbao_ca_cert"
install -m 600 "$temporary_dir/server-chain.crt" \
  "$secrets_dir/openbao_tls_cert"
install -m 600 "$temporary_dir/server.key" "$secrets_dir/openbao_tls_key"

echo "OpenBao TLS material was generated with mode 600."
echo "The 32-byte auto-unseal key exists persistently only as a TPM2-encrypted systemd credential."
echo "No secret value was printed."
