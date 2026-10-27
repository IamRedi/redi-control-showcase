#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

replace_existing="${1:-}"
[[ -z "$replace_existing" || "$replace_existing" == "--replace" ]] || {
  echo "Usage: $0 [--replace]" >&2
  exit 1
}

command -v msmtp >/dev/null 2>&1 || {
  echo "Install msmtp first: sudo apt-get install msmtp" >&2
  exit 1
}

existing_configuration=false
for file in secrets/alert_email_from secrets/alert_email_to secrets/alert_email_app_password; do
  [[ -e "$file" ]] && existing_configuration=true
done
if "$existing_configuration"; then
  [[ "$replace_existing" == "--replace" ]] || {
    echo "Existing alert configuration found. Re-run with --replace to change it." >&2
    exit 1
  }
  read -r -p "Type REPLACE_EMAIL_ALERT_CONFIGURATION to continue: " confirmation
  [[ "$confirmation" == "REPLACE_EMAIL_ALERT_CONFIGURATION" ]] || {
    echo "Email alert configuration was not changed." >&2
    exit 1
  }
fi

read -r -p "Gmail sender address: " sender
[[ "$sender" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "Invalid sender email address" >&2
  exit 1
}
read -r -p "Alert recipient address (Enter for same address): " recipient
recipient="${recipient:-$sender}"
[[ "$recipient" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "Invalid recipient email address" >&2
  exit 1
}
read -r -s -p "Gmail App Password: " app_password
printf '\n'
[[ -n "$app_password" ]] || {
  echo "Gmail App Password is required" >&2
  exit 1
}

printf '%s\n' "$sender" >secrets/alert_email_from
printf '%s\n' "$recipient" >secrets/alert_email_to
printf '%s\n' "$app_password" >secrets/alert_email_app_password
chmod 600 secrets/alert_email_from secrets/alert_email_to secrets/alert_email_app_password
unset app_password sender recipient

./send-alert-email.sh setup-test
echo "Email alerts were configured and the test message was sent."
