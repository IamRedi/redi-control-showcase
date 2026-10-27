#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in install mktemp sed sudo systemctl systemd-analyze; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

deployment_directory="$(pwd -P)"
if [[ "$deployment_directory" == *$'\n'* || "$deployment_directory" == *"@"* ]]; then
  echo "Unsupported deployment directory." >&2
  exit 1
fi
escaped_directory="${deployment_directory//\/\\}"
escaped_directory="${escaped_directory//&/\\&}"
escaped_directory="${escaped_directory//|/\\|}"
temporary_dir="$(mktemp -d /dev/shm/redi-control-systemd.XXXXXX)"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

for unit in redi-control.service redi-control-openbao-bootstrap.service redi-control-monitor.service redi-control-monitor.timer redi-control-email-alert@.service redi-control-backup.service redi-control-backup.timer; do
  sed "s|@DEPLOYMENT_DIRECTORY@|$escaped_directory|g" \
    "$unit.in" >"$temporary_dir/$unit"
  systemd-analyze verify "$temporary_dir/$unit"
done

sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control.service" \
  /etc/systemd/system/redi-control.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-openbao-bootstrap.service" \
  /etc/systemd/system/redi-control-openbao-bootstrap.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-monitor.service" \
  /etc/systemd/system/redi-control-monitor.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-monitor.timer" \
  /etc/systemd/system/redi-control-monitor.timer
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-email-alert@.service" \
  /etc/systemd/system/redi-control-email-alert@.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-backup.service" \
  /etc/systemd/system/redi-control-backup.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/redi-control-backup.timer" \
  /etc/systemd/system/redi-control-backup.timer
sudo systemctl daemon-reload

echo "Installed verified REDI CONTROL systemd units; none was started or enabled."
