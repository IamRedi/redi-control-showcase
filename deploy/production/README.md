# Portable production deployment

This directory is the reviewed Docker Compose topology for one multi-tenant REDI CONTROL installation. The first host is an owner-managed Ubuntu mini PC; the application contract is provider-neutral OCI containers, PostgreSQL and S3-compatible object storage.

## Topology and public boundary

`compose.yaml` runs PostgreSQL, OpenBao, ClamAV, Keycloak, one-shot migrations,
API, worker, Web and Caddy. Only Caddy publishes host ports. OpenBao, Keycloak,
PostgreSQL, ClamAV, API, Web and worker remain on Docker networks and the Docker
socket is never mounted.

Choose exactly one ingress profile:

- Direct HTTPS: `REDI_CADDYFILE=./Caddyfile`, bind `0.0.0.0`, forward router TCP 80/443, and let Caddy obtain TLS.
- External HTTPS tunnel/proxy: `REDI_CADDYFILE=./Caddyfile.origin`, bind `127.0.0.1`, use a non-privileged host HTTP port such as 8080, and configure the independently managed ingress to preserve the exact public Host. Never expose that origin port to the LAN or Internet.

The selected first-host connector is packaged separately in
[`deploy/cloudflare-tunnel/`](../cloudflare-tunnel/README.md). Its startup gate
requires the loopback origin's hardened readiness endpoint to pass before the
tunnel can run.

Unknown hosts receive `421`. The tunnel/provider is an operator choice and is not imported by application code.

## Files and configuration

- `.env.example` — Compose/ingress inputs; copy to ignored `.env`.
- `runtime.env.example` — non-secret application inputs; copy to ignored `runtime.env`.
- `secrets/` — ignored runtime secret files, each non-empty and mode `0600`.
- `deploy.sh` — validates files/permissions, builds, migrates, starts and requires hardened readiness.
- `backup-postgres.sh` — creates a custom-format database dump plus SHA-256 checksum; the operator must copy them to encrypted off-host storage.

Required secret filenames (values are never committed or printed):

- `postgres_admin_password`
- `database_admin_url`
- `database_runtime_password`
- `database_auth_password`
- `database_runtime_url`
- `database_auth_url`
- `oidc_client_secret`
- `identity_database_password`
- `keycloak_bootstrap_admin_secret`
- `oidc_transaction_key`
- `social_oauth_state_secret`
- `meta_app_secret`
- `object_storage_access_key_id`
- `object_storage_secret_access_key`
- `openbao_ca_cert`
- `openbao_tls_cert`
- `openbao_tls_key`
- `openbao_approle_role_id`
- `openbao_approle_secret_id`

The OpenBao static auto-unseal key is deliberately not a normal persistent
file in `secrets/`. Enroll it against this host's TPM2 and install the reviewed
systemd units:

```bash
./enroll-openbao-tpm.sh
./install-systemd-units.sh
sudo systemctl start redi-control-openbao-bootstrap.service
```

The enrollment script is create-only, generates a private local TLS CA/server
certificate, seals the 32-byte OpenBao key with `systemd-creds --with-key=tpm2`
and never prints it. The systemd service decrypts the key into protected,
non-swappable runtime credentials; the container copies it and its TLS key to
container `tmpfs`, drops root and runs OpenBao as UID 100.

Initialize OpenBao only when an operator has mounted or selected an encrypted
off-host destination for the recovery bundle:

```bash
./bootstrap-openbao.sh /absolute/off-host/path/openbao-recovery.json.gpg
```

The bootstrap creates five recovery shares with threshold three, KV v2 and a
least-privilege AppRole, writes the AppRole files mode `0600`, then revokes the
initial root token. Never delete the encrypted recovery bundle; verify its
off-host copy before removing the temporary local copy. AppRole SecretIDs expire
after 90 days and must be rotated before expiry.

Generate the installation-specific database passwords/URLs, OIDC transaction
key and OAuth state secret locally without printing them:

```bash
./initialize-local-secrets.sh
```

The initializer is create-only and refuses to overwrite any generated secret.
Generate the three self-hosted identity secrets separately, also create-only:

```bash
./initialize-keycloak-secrets.sh
```

The two existing object-storage credentials must be installed separately by
their external owner; neither initializer invents or copies those values.

Keycloak is built from the official 26.7.1 digest, runs privately with a
read-only root filesystem, and owns only the `keycloak` schema through
`redi_control_identity`. Its declarative realm uses the issuer
`https://<REDI_DOMAIN>/id/realms/redi-control`, an exact callback, confidential
client authentication, PKCE S256 and mandatory LoA-2 TOTP. Once the private
service and public exact-host route are running, create the otherwise-empty
initial tenant, installation and active canonical domain locally:

```bash
./provision-initial-installation.sh
```

The create-only command requires an explicit terminal confirmation and uses
`REDI_DOMAIN` from `.env`. Its conservative initial entitlement enables only
platform, media, website and context capabilities; it enables neither social
providers nor a publication quota. It refuses a database that already has a
tenant, installation or Root Owner. Then provision the identity owner locally:

```bash
./provision-keycloak-owner.sh
```

The script prompts locally, never prints the password, forces password change
and TOTP enrollment, then revokes the temporary Keycloak admin service account.
REDI CONTROL Root Owner rights still require the separate single-use invitation.
Issue it only after the owner identity exists:

```bash
./issue-first-owner-invitation.sh
```

The command prompts for the recipient email in the local terminal, requires a
separate explicit confirmation and prints the 256-bit token once. It uses the
single active installation, binds the token to that email for 24 hours and
leaves only hashes in PostgreSQL. Paste the token directly into
`https://<REDI_DOMAIN>/auth/bootstrap`; never put it in chat, Git, email or a
retained note.

The object-storage endpoint, region, private bucket, key prefix and signed-URL TTLs are non-secret configuration. The current production profile uses the private `showcase-media` bucket through Hetzner's S3-compatible endpoint; credentials stay only in the two storage secret files.

## Validation and deployment

Use the repository-level
`Ubuntu rollout acceptance checklist` (private source reference omitted)
to record the source, recovery, deployment and post-deploy evidence. Completing
its preflight does not authorize a rollout.

From the repository root:

```bash
npm run check:production
```

On Ubuntu, after configuration, OpenBao bootstrap/recovery verification and an
off-host database backup:

```bash
cd deploy/production
chmod 600 secrets/*
./deploy.sh
```

`deploy.sh` builds and migrates, then enables and restarts the reviewed systemd
unit so an already-running installation actually adopts the newly built image
tag.
Do not replace it with a detached manual `docker compose up`: the unit is what
loads the TPM2 credential and keeps its runtime source available across
container restarts.

For a later source-version rollout, build **every** Compose image under the
new `REDI_VERSION` before changing `.env` or restarting the unit. A systemd
restart uses one common image tag for API, worker, Web, migrations and
Keycloak; switching the tag before all five images exist would interrupt the
running stack. `REDI_VERSION` must be the current seven-character Git revision
and the complete Git worktree must be clean. Ignored server-local configuration
and secret files remain permitted. The reviewed `./deploy.sh` sequence enforces
those provenance checks and performs the complete build first.

The deployment intentionally fails its final readiness gate while required production adapters are absent. Never switch to local/deterministic adapters to make production green.

## Local monitoring

`monitor-production.sh` verifies the exact public ingress response, every
long-running Compose service, container health and deployment-disk use. If
`REDI_BACKUP_DIRECTORY` is set in the ignored `.env`, it also fails when no
database dump exists there or its age exceeds
`REDI_MONITOR_MAX_BACKUP_AGE_HOURS` (default: 26). The default disk threshold
is `REDI_MONITOR_MAX_DISK_PERCENT=85`.

`install-systemd-units.sh` installs, but deliberately does not enable, a
five-minute `redi-control-monitor.timer`. Review the journal-only local output
first, then enable it explicitly after a backup destination is configured:

```bash
sudo systemctl enable --now redi-control-monitor.timer
systemctl list-timers redi-control-monitor.timer
```

This is local monitoring, not external alert delivery. Connect a reviewed
notification destination only after the owner explicitly chooses it; never put
its credential in the repository or in `.env`.

## BusinessSite Phase 7 acceptance

Do not place a BusinessSite HMAC secret in `.env` or `runtime.env`. The first
two-system step is the read-only `npm run businesssite:probe`, which also checks
valid, replayed, stale, invalid-signature and unknown-integration authentication
requests, with the secret read from an absolute mode-`0600` file. It calls only
the bounded article/media list operations and prints no provider records. Follow
`docs/BUSINESSSITE_PHASE7_ACCEPTANCE.md` (private source reference omitted)
before creating an OpenBao-backed production connection or enabling any write
scope.

### Gmail alert delivery

The first supported external destination is Gmail SMTP through `msmtp`. Create
a dedicated Gmail App Password with Google two-step verification enabled; use
that App Password, never the Google account password. Google documents that
App Passwords are for clients that cannot use “Sign in with Google” and are
revoked if the Google account password changes. [Google Account Help](https://support.google.com/accounts/answer/185833)

```bash
sudo apt-get install msmtp
./initialize-email-alerts.sh
./install-systemd-units.sh
sudo systemctl restart redi-control-monitor.timer
```

The initializer prompts only in the local terminal and writes sender,
recipient and App Password into ignored mode-`0600` files. It sends one setup
test email. A failed monitor run invokes the email unit automatically; a
successful check never sends email.

With the storage environment and secret-file variables loaded, validate the real private bucket separately:

```bash
npm run storage:probe
```

The probe writes one random object, verifies metadata/content and deletes it in `finally`. Passing local mocks is not evidence that the real bucket works.

The production Compose package also runs digest-pinned ClamAV with persistent
signature data. Port 3310 exists only on the internal Docker network. API
startup waits for the daemon health check, and API readiness verifies both the
private object store and scanner. `clamd.conf` raises stream/file/scan limits
slightly above the application's 512 MiB maximum, enables limit alerts and
bounds concurrency; do not publish the scanner port or replace the policy with
image defaults.

OpenBao 2.6.1 is pinned by multi-architecture digest and uses TLS, integrated
Raft storage and a persistent declarative file audit device. Its AppRole policy
can write/read only tenant- and connection-bound KV data paths and permanently
delete only their metadata paths; it cannot list or administer OpenBao. Verify
the live contract with `npm run openbao:probe` from a network context that can
resolve the private `openbao` service and trusts `openbao_ca_cert`.

## Backup and restore boundary

Run `./backup-postgres.sh /absolute/path` on a schedule, then move the dump and checksum to encrypted storage outside the mini PC and its home network. The dump includes both REDI CONTROL and the separately owned Keycloak schema. S3 objects remain in external object storage; bucket lifecycle/versioning and recovery are the storage operator's responsibility. A backup is accepted only after a restore drill into an isolated database validates migrations, identity realm/client/users, row counts, RLS and media references. Restore is intentionally documented rather than automated because it replaces state.

For the accepted Hetzner S3 destination, use the encrypted uploader instead. It
creates a custom-format dump, prompts only on the local terminal for a new GPG
AES-256 passphrase, verifies decryption, securely removes the plaintext, and
uploads a create-only encrypted object that is downloaded and SHA-256 verified:

```bash
REDI_BACKUP_DIRECTORY=/home/operator/.local/share/redi-control/backups \
  ./backup-postgres-encrypted.sh
```

Keep the passphrase separately from the host and S3 credential. Set the same
absolute `REDI_BACKUP_DIRECTORY` in the ignored `.env` so the enabled local
monitor checks that an encrypted backup is no more than 26 hours old.

To automate the daily backup without retaining a plaintext passphrase, enroll
the existing backup passphrase as a TPM2-encrypted systemd credential, then
install and enable the daily 03:20 timer:

```bash
./enroll-backup-passphrase-tpm.sh /absolute/path/to/redi-control-<timestamp>.dump.gpg
./install-systemd-units.sh
sudo systemctl enable --now redi-control-backup.timer
```

The enrollment verifies the passphrase against the existing encrypted backup
before storing it; the passphrase is never printed or committed. It remains
recoverable only through the owner's separately retained passphrase.

Before accepting any backup, restore it into an isolated temporary PostgreSQL
container. The drill exposes no port, has no network or persistent volume, and
is removed automatically:

```bash
./restore-postgres-drill.sh \
  /home/operator/.local/share/redi-control/backups/redi-control-<timestamp>.dump.gpg
```

The drill requires the encryption passphrase only locally, reads the expected
migration count from the ignored `runtime.env`, verifies migrations plus
installation and Root Owner data, and never changes the running production
database. For unattended operator acceptance,
`REDI_BACKUP_GPG_PASSPHRASE_FILE` may point to a systemd credential file; the
passphrase must never be placed in an environment value, command line or
persistent plaintext file.

## Current fail-closed blockers

The S3-compatible adapter, private ClamAV scanner and OpenBao secret provider
are host-accepted. Keycloak public routing, owner TOTP enrollment and the
end-to-end signed MFA token/first-owner flow are accepted. Hardened readiness
remains intentionally blocked on live social adapters. BusinessSite remains a
separate public system connected only through its versioned API.
