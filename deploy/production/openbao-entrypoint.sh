#!/bin/sh
set -eu
umask 077

# Compose file-backed secrets retain host ownership. Copy only the two private
# inputs into container tmpfs, then permanently drop root before OpenBao starts.
install -d -o 0 -g 1000 -m 0750 /run/openbao
install -o 100 -g 1000 -m 0400 \
  /run/secrets/openbao_unseal_key /run/openbao/unseal.key
install -o 100 -g 1000 -m 0400 \
  /run/secrets/openbao_tls_key /run/openbao/tls.key
install -o 100 -g 1000 -m 0400 \
  /run/secrets/openbao_tls_cert /run/openbao/tls.crt

exec /usr/bin/dumb-init -- su-exec openbao bao server -config=/openbao/config
