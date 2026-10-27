#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"
backup_path="${1:-}"
[[ "$backup_path" = /* && -f "$backup_path" ]] || {
  echo "Usage: $0 /absolute/encrypted-postgres-backup.dump.gpg" >&2
  exit 1
}
for command_name in gpg mktemp sudo systemd-creds; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done
[[ "$(systemd-creds has-tpm2 2>/dev/null | head -n 1)" == "yes" ]] || {
  echo "A usable TPM2 device is required." >&2
  exit 1
}
credential=/etc/credstore.encrypted/backup_gpg_passphrase
sudo test ! -e "$credential" || {
  echo "Backup passphrase credential already exists; refusing overwrite." >&2
  exit 1
}
temporary_dir="$(mktemp -d /dev/shm/redi-control-backup-passphrase.XXXXXX)"
cleanup() { rm -rf -- "$temporary_dir"; }
trap cleanup EXIT
read -r -s -p "Existing PostgreSQL backup GPG passphrase: " passphrase
printf '\n'
[[ -n "$passphrase" ]] || { echo "Passphrase is required." >&2; exit 1; }
printf '%s' "$passphrase" >"$temporary_dir/passphrase"
chmod 600 "$temporary_dir/passphrase"
unset passphrase
gpg --batch --pinentry-mode loopback --passphrase-file "$temporary_dir/passphrase" \
  --quiet --decrypt "$backup_path" >/dev/null
sudo install -d -o root -g root -m 700 /etc/credstore.encrypted
sudo systemd-creds encrypt --name=backup_gpg_passphrase --with-key=tpm2 --tpm2-device=auto \
  "$temporary_dir/passphrase" "$credential"
sudo chmod 600 "$credential"
sudo systemd-creds decrypt "$credential" /dev/null
echo "The automated backup passphrase is TPM2-encrypted; no passphrase was printed."
