#!/usr/bin/env sh
set -eu

admin_url="$(cat /run/secrets/database_admin_url)"
identity_password="$(cat /run/secrets/identity_database_password)"

test -n "$admin_url"
test -n "$identity_password"

psql "$admin_url" --set=ON_ERROR_STOP=1 \
  --set=identity_password="$identity_password" <<'SQL'
SELECT format(
  'CREATE ROLE redi_control_identity LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'identity_password'
)
WHERE NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'redi_control_identity'
) \gexec

ALTER ROLE redi_control_identity
  WITH LOGIN PASSWORD :'identity_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA IF NOT EXISTS keycloak AUTHORIZATION redi_control_identity;
ALTER SCHEMA keycloak OWNER TO redi_control_identity;
REVOKE CREATE ON SCHEMA public FROM redi_control_identity;
SQL

unset admin_url identity_password
echo "Keycloak database role and schema are ready."
