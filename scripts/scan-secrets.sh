#!/usr/bin/env bash
# Keep this script LF-normalized so Git Bash can run it on Windows checkouts.
set -euo pipefail

matches="$({
  git grep -nIE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{20,}' -- . \
    ':(exclude)scripts/scan-secrets.sh' \
    ':(exclude)redi_control_codex_starter_pack/**' || true
})"

if [[ -n "$matches" ]]; then
  printf '%s\n' "Potential secret material detected:" "$matches" >&2
  exit 1
fi

printf '%s\n' "No known private-key or token patterns detected."
