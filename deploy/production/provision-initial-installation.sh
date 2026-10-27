#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")"

for command_name in docker grep; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

[[ -f .env ]] || {
  echo "Missing deploy/production/.env" >&2
  exit 1
}

domain="$(grep -E '^REDI_DOMAIN=' .env | cut -d= -f2- | tr -d '[:space:]')"
[[ "$domain" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] || {
  echo "REDI_DOMAIN must be one lowercase public hostname" >&2
  exit 1
}

tenant_slug="${REDI_INITIAL_TENANT_SLUG:-redi-control}"
tenant_name="${REDI_INITIAL_TENANT_NAME:-REDI CONTROL}"
installation_slug="${REDI_INITIAL_INSTALLATION_SLUG:-redi-control}"
installation_name="${REDI_INITIAL_INSTALLATION_NAME:-REDI CONTROL}"

for value_name in tenant_slug installation_slug; do
  value="${!value_name}"
  [[ "$value" =~ ^[a-z][a-z0-9-]{1,62}$ ]] || {
    echo "$value_name must be a lowercase slug" >&2
    exit 1
  }
done
for value_name in tenant_name installation_name; do
  value="${!value_name}"
  [[ -n "$value" && ${#value} -le 160 ]] || {
    echo "$value_name must be between 1 and 160 characters" >&2
    exit 1
  }
done

compose=(docker compose)
if [[ -n "${REDI_COMPOSE_PROJECT_NAME:-}" ]]; then
  [[ "$REDI_COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]] || {
    echo "Invalid REDI_COMPOSE_PROJECT_NAME" >&2
    exit 1
  }
  compose+=(-p "$REDI_COMPOSE_PROJECT_NAME")
fi
export REDI_OPENBAO_UNSEAL_KEY_FILE="${REDI_OPENBAO_UNSEAL_KEY_FILE:-/dev/null}"

"${compose[@]}" ps --status running --services | grep -qx postgres || {
  echo "PostgreSQL is not running" >&2
  exit 1
}

echo "This will create exactly one initial production tenant and installation:"
echo "- tenant: $tenant_name ($tenant_slug)"
echo "- installation: $installation_name ($installation_slug)"
echo "- canonical domain: $domain"
echo "- enabled modules: platforms, media, websites, context_studio"
echo "- social providers and publication quota: disabled"
read -r -p "Type PROVISION_INITIAL_INSTALLATION to continue: " confirmation
[[ "$confirmation" == "PROVISION_INITIAL_INSTALLATION" ]] || {
  echo "No production installation was created." >&2
  exit 1
}

export REDI_INITIAL_DOMAIN="$domain"
export REDI_INITIAL_TENANT_SLUG="$tenant_slug"
export REDI_INITIAL_TENANT_NAME="$tenant_name"
export REDI_INITIAL_INSTALLATION_SLUG="$installation_slug"
export REDI_INITIAL_INSTALLATION_NAME="$installation_name"

"${compose[@]}" exec -T \
  -e REDI_INITIAL_DOMAIN \
  -e REDI_INITIAL_TENANT_SLUG \
  -e REDI_INITIAL_TENANT_NAME \
  -e REDI_INITIAL_INSTALLATION_SLUG \
  -e REDI_INITIAL_INSTALLATION_NAME \
  postgres /bin/sh -ceu '
    exec psql -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -v domain="$REDI_INITIAL_DOMAIN" \
      -v tenant_slug="$REDI_INITIAL_TENANT_SLUG" \
      -v tenant_name="$REDI_INITIAL_TENANT_NAME" \
      -v installation_slug="$REDI_INITIAL_INSTALLATION_SLUG" \
      -v installation_name="$REDI_INITIAL_INSTALLATION_NAME"
  ' <<'SQL'
BEGIN;
LOCK TABLE control.tenants, control.white_label_installations,
  control.installation_domains, control.memberships IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM control.tenants)
    OR EXISTS (SELECT 1 FROM control.white_label_installations)
    OR EXISTS (SELECT 1 FROM control.memberships WHERE role = 'root_owner') THEN
    RAISE EXCEPTION 'initial installation requires an empty tenant/installation/owner state';
  END IF;
END
$$;

SELECT gen_random_uuid() AS tenant_id,
       gen_random_uuid() AS installation_id,
       gen_random_uuid() AS domain_id
\gset

INSERT INTO control.tenants (id, slug, display_name)
VALUES (:'tenant_id', :'tenant_slug', :'tenant_name');

INSERT INTO control.white_label_installations
  (id, tenant_id, slug, display_name, data_region, status)
VALUES
  (:'installation_id', :'tenant_id', :'installation_slug', :'installation_name', 'EU', 'active');

INSERT INTO control.installation_profiles
  (installation_id, tenant_id, brand, enabled_locales, default_locale, enabled_modules)
VALUES
  (:'installation_id', :'tenant_id', jsonb_build_object('name', :'installation_name'),
   ARRAY['en', 'de', 'sq'], 'en', ARRAY['platforms', 'media', 'websites', 'context_studio']);

INSERT INTO control.installation_domains
  (id, tenant_id, installation_id, hostname, domain_kind, status, verified_at, activated_at)
VALUES
  (:'domain_id', :'tenant_id', :'installation_id', :'domain', 'canonical', 'active', now(), now());

INSERT INTO control.installation_entitlements
  (installation_id, tenant_id, plan_id, enabled_modules, maximum_businesses,
   maximum_workspaces, maximum_social_accounts, monthly_publication_quota,
   storage_quota_bytes, maximum_users, provider_availability,
   shared_oauth_allowed, dedicated_oauth_allowed)
VALUES
  (:'installation_id', :'tenant_id', 'initial_production',
   ARRAY['platforms', 'media', 'websites', 'context_studio'], 1, 1, 0, 0,
   10737418240, 5, ARRAY[]::control.social_provider[], false, false);

COMMIT;
SQL

unset REDI_INITIAL_DOMAIN REDI_INITIAL_TENANT_SLUG REDI_INITIAL_TENANT_NAME
unset REDI_INITIAL_INSTALLATION_SLUG REDI_INITIAL_INSTALLATION_NAME

echo "Initial tenant, installation and canonical domain were created."
echo "Next: provision the Keycloak owner, then issue the one-time REDI CONTROL owner invitation."
