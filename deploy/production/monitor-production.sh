#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

for command_name in curl date df docker node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

domain="$(sed -n 's/^REDI_DOMAIN=//p' .env | tail -n 1)"
[[ -n "$domain" ]] || {
  echo "REDI_DOMAIN is missing from .env" >&2
  exit 1
}

configured_value() {
  local name="$1"
  sed -n "s/^${name}=//p" .env | tail -n 1
}

services=(api caddy clamav keycloak openbao postgres web worker)
for service in "${services[@]}"; do
  container_id="$(docker compose --env-file .env -f compose.yaml ps -q "$service")"
  [[ -n "$container_id" ]] || {
    echo "Required service is absent: $service" >&2
    exit 1
  }
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  [[ "$state" == "running" ]] || {
    echo "Required service is not running: $service ($state)" >&2
    exit 1
  }
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")"
  [[ -z "$health" || "$health" == "healthy" ]] || {
    echo "Required service is not healthy: $service ($health)" >&2
    exit 1
  }
done

curl --fail --silent --show-error --max-time 20 \
  "https://$domain/health/ingress" |
  node -e '
    let body = "";
    process.stdin.on("data", (chunk) => (body += chunk));
    process.stdin.on("end", () => {
      const result = JSON.parse(body);
      if (result.status !== "ready") process.exit(1);
    });
  '

disk_usage="$(df --output=pcent . | tail -n 1 | tr -dc '0-9')"
max_disk_usage="${REDI_MONITOR_MAX_DISK_PERCENT:-$(configured_value REDI_MONITOR_MAX_DISK_PERCENT)}"
max_disk_usage="${max_disk_usage:-85}"
[[ "$disk_usage" =~ ^[0-9]+$ && "$max_disk_usage" =~ ^[0-9]+$ ]] || {
  echo "Disk monitoring values must be integers" >&2
  exit 1
}
if ((disk_usage >= max_disk_usage)); then
  echo "Deployment disk usage is ${disk_usage}%, at or above ${max_disk_usage}%" >&2
  exit 1
fi

backup_directory="${REDI_BACKUP_DIRECTORY:-$(configured_value REDI_BACKUP_DIRECTORY)}"
if [[ -n "$backup_directory" ]]; then
  [[ "$backup_directory" = /* ]] || {
    echo "REDI_BACKUP_DIRECTORY must be an absolute path" >&2
    exit 1
  }
  max_backup_age_hours="${REDI_MONITOR_MAX_BACKUP_AGE_HOURS:-$(configured_value REDI_MONITOR_MAX_BACKUP_AGE_HOURS)}"
  max_backup_age_hours="${max_backup_age_hours:-26}"
  [[ "$max_backup_age_hours" =~ ^[0-9]+$ ]] || {
    echo "REDI_MONITOR_MAX_BACKUP_AGE_HOURS must be an integer" >&2
    exit 1
  }
  newest_backup="$(find "$backup_directory" -maxdepth 1 -type f -name 'redi-control-*.dump.gpg' -printf '%T@\n' 2>/dev/null | sort -nr | head -n 1)"
  [[ -n "$newest_backup" ]] || {
    echo "No PostgreSQL backup found in $backup_directory" >&2
    exit 1
  }
  now="$(date +%s)"
  backup_epoch="${newest_backup%%.*}"
  backup_age_seconds=$((now - backup_epoch))
  if ((backup_age_seconds > max_backup_age_hours * 3600)); then
    echo "Newest PostgreSQL backup is older than ${max_backup_age_hours} hours" >&2
    exit 1
  fi
fi

echo "REDI CONTROL monitor passed: public ingress, containers and disk are healthy."
