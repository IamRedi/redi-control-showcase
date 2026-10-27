#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
runtime_directory="$repository_root/tmp/local-demo"
environment_file="$runtime_directory/runtime.env"
api_pid_file="$runtime_directory/api.pid"
web_pid_file="$runtime_directory/web.pid"
worker_pid_file="$runtime_directory/worker.pid"
compose_file="$repository_root/compose.local-demo.yaml"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

process_running() {
  local pid_file=$1
  [[ -s "$pid_file" ]] || return 1
  local pid process_directory
  pid=$(<"$pid_file")
  kill -0 "$pid" 2>/dev/null || return 1
  process_directory=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  [[ "$process_directory" == "$repository_root" ]]
}

load_environment() {
  [[ -f "$environment_file" ]] || {
    echo "Local demo has not been initialized. Run: npm run demo:start" >&2
    exit 1
  }
  set -a
  # shellcheck disable=SC1090
  source "$environment_file"
  set +a
}

write_environment() {
  mkdir -p "$runtime_directory"
  chmod 700 "$runtime_directory"
  if [[ ! -f "$environment_file" ]]; then
    umask 077
    local postgres_password runtime_password auth_password storage_secret oauth_secret
    postgres_password=$(openssl rand -hex 32)
    runtime_password=$(openssl rand -hex 32)
    auth_password=$(openssl rand -hex 32)
    storage_secret=$(openssl rand -hex 32)
    oauth_secret=$(openssl rand -hex 32)
    printf '%s\n' \
      "POSTGRES_PASSWORD=$postgres_password" \
      "DATABASE_RUNTIME_PASSWORD=$runtime_password" \
      "DATABASE_AUTH_PASSWORD=$auth_password" \
      "LOCAL_STORAGE_SIGNING_SECRET=$storage_secret" \
      "DATABASE_ADMIN_URL=postgresql://redi_demo_admin:${postgres_password}@127.0.0.1:54348/redi_control_demo" \
      "DATABASE_URL=postgresql://redi_control_runtime:${runtime_password}@127.0.0.1:54348/redi_control_demo" \
      "DATABASE_AUTH_URL=postgresql://redi_control_auth:${auth_password}@127.0.0.1:54348/redi_control_demo" \
      "NODE_ENV=development" \
      "DEPLOYMENT_ENV=local" \
      "API_HOST=127.0.0.1" \
      "API_PORT=8788" \
      "PUBLIC_WEB_ORIGIN=http://127.0.0.1:8787" \
      "PUBLIC_API_ORIGIN=http://127.0.0.1:8788" \
      "PUBLIC_API_URL=http://127.0.0.1:8788" \
      "TRUSTED_PUBLIC_HOSTS=127.0.0.1" \
      "LOCAL_DEMO_MODE=true" \
      "SESSION_COOKIE_SECURE=false" \
      "IDENTITY_ADAPTER=unconfigured" \
      "OBJECT_STORAGE_MODE=local" \
      "LOCAL_STORAGE_BASE_URL=http://127.0.0.1:8789" \
      "MEDIA_SCANNER=deterministic_local" \
      "SECRET_PROVIDER_MODE=local_memory" \
      "SOCIAL_PROVIDER_MODE=deterministic_local" \
      "SOCIAL_OAUTH_STATE_SECRET=$oauth_secret" \
      "EXPECTED_MIGRATION_COUNT=44" >"$environment_file"
    chmod 600 "$environment_file"
  fi
}

stop_process() {
  local pid_file=$1
  if process_running "$pid_file"; then
    local pid
    pid=$(<"$pid_file")
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

wait_for_url() {
  local url=$1 label=$2
  for _ in $(seq 1 80); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "$label did not become ready. Inspect $runtime_directory/*.log" >&2
  return 1
}

start_demo() {
  require_command docker
  require_command npm
  require_command openssl
  require_command curl
  if process_running "$api_pid_file" && process_running "$web_pid_file"; then
    echo "Local demo is already running. Run: npm run demo:status"
    exit 0
  fi
  stop_process "$api_pid_file"
  stop_process "$web_pid_file"
  stop_process "$worker_pid_file"
  write_environment
  load_environment
  export NODE_OPTIONS="--import=$repository_root/scripts/showcase-offline.mjs"
  docker compose --env-file "$environment_file" -f "$compose_file" up -d --wait
  npm run db:migrate
  npm run demo:prepare

  nohup setsid npm run dev:api >"$runtime_directory/api.log" 2>&1 &
  echo "$!" >"$api_pid_file"
  nohup setsid npm run dev --workspace=@redi-control/web -- --hostname 127.0.0.1 --port 8787 >"$runtime_directory/web.log" 2>&1 &
  echo "$!" >"$web_pid_file"

  if ! wait_for_url "http://127.0.0.1:8788/health/ready" "API" ||
    ! wait_for_url "http://127.0.0.1:8787/sq/showcase" "Web app"; then
    stop_process "$api_pid_file"
    stop_process "$web_pid_file"
    stop_process "$worker_pid_file"
    exit 1
  fi
  echo "Offline evaluation workspace is ready. External ingestion and providers are disabled."
  echo "Login: http://127.0.0.1:8788/auth/local-demo"
  echo "One-time token: $repository_root/tmp/local-demo-token"
  echo "No external account or live publication adapter is enabled."
}

refresh_demo() {
  load_environment
  npm run demo:prepare
  echo "A fresh one-time token is available at $repository_root/tmp/local-demo-token"
}

stop_demo() {
  stop_process "$api_pid_file"
  stop_process "$web_pid_file"
  stop_process "$worker_pid_file"
  if [[ -f "$environment_file" ]]; then
    load_environment
    docker compose --env-file "$environment_file" -f "$compose_file" down
  fi
  rm -f "$repository_root/tmp/local-demo-token"
  echo "Local demo stopped. Its tmpfs database and object data were removed."
}

status_demo() {
  local api_status=stopped web_status=stopped worker_status=stopped
  process_running "$api_pid_file" && api_status=running
  process_running "$web_pid_file" && web_status=running
  process_running "$worker_pid_file" && worker_status=running
  echo "API: $api_status"
  echo "Web: $web_status"
  echo "Worker: $worker_status"
  if [[ -f "$environment_file" ]]; then
    load_environment
    docker compose --env-file "$environment_file" -f "$compose_file" ps
  fi
}

case "${1:-}" in
  start) start_demo ;;
  refresh) refresh_demo ;;
  stop) stop_demo ;;
  status) status_demo ;;
  *)
    echo "Usage: $0 {start|refresh|status|stop}" >&2
    exit 2
    ;;
esac
