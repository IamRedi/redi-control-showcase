#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"
alert_context="${1:-monitor-failure}"
[[ "$alert_context" =~ ^[A-Za-z0-9_.@:-]{1,160}$ ]] || {
  echo "Invalid alert context" >&2
  exit 1
}

for command_name in msmtp mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

secret_value() {
  local path="secrets/$1"
  [[ -s "$path" && "$(stat -c '%a' "$path")" == "600" ]] || {
    echo "Missing or insecure alert secret: $path" >&2
    exit 1
  }
  tr -d '\r\n' <"$path"
}

sender="$(secret_value alert_email_from)"
recipient="$(secret_value alert_email_to)"
password_path="$PWD/secrets/alert_email_app_password"
temporary_config="$(mktemp /dev/shm/redi-control-msmtp.XXXXXX)"
cleanup() {
  rm -f -- "$temporary_config"
}
trap cleanup EXIT

cat >"$temporary_config" <<EOF
defaults
auth on
tls on
tls_starttls on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile -

account gmail
host smtp.gmail.com
port 587
from $sender
user $sender
passwordeval cat "$password_path"

account default : gmail
EOF
chmod 600 "$temporary_config"

printf 'To: %s\nFrom: %s\nSubject: [REDI CONTROL] Alert: %s\n\nThe REDI CONTROL monitor reported "%s" on %s. Review: journalctl -u redi-control-monitor.service -n 100 --no-pager\n' \
  "$recipient" "$sender" "$alert_context" "$alert_context" "$(hostname -f 2>/dev/null || hostname)" |
  msmtp --file="$temporary_config" "$recipient"
