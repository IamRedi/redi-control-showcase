> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# First-owner bootstrap

## Purpose and boundary

This flow creates the first `root_owner` after an installation and its trusted active domain exist. It is not a general invitation system and cannot add a second owner or later users.

The invariant is:

`privileged operator issuance → token entered by POST → OIDC verified email + MFA → atomic invitation consumption + membership + audit + session`

Normal `/auth/login` never provisions a tenant or role.

## Security properties

- 256-bit random token shown once to the operator;
- database stores only SHA-256 token and normalized-email hashes;
- one active invitation per tenant while that tenant has no Root Owner;
- maximum operator CLI lifetime is seven days; 24 hours is the default;
- invitation is bound to an active tenant, active installation and the installation's resolved Host;
- token is submitted in an HTTPS POST body, never a query string or path;
- browser keeps it only in a ten-minute `HttpOnly`, `SameSite=Lax`, Secure `__Host-` cookie;
- verified OIDC email must match the recipient hash;
- trusted OIDC MFA evidence is mandatory;
- consumption, user resolution, `root_owner` membership, audit/outbox and session creation are atomic;
- expired, wrong-email, password-only, cross-installation and replay attempts fail closed;
- issuance and successful consumption create append-only audit/outbox evidence.

The HTML setup page has no remote assets or JavaScript. Its narrowly scoped CSP permits only its same-origin form and inline local styling.

## Preconditions

1. Apply all 31 migrations.
2. Provision the tenant and white-label installation through the controlled deployment process.
3. Activate exactly one trusted canonical installation domain and TLS route.
4. Configure OIDC using [Production OIDC identity](OIDC_IDENTITY.md), including MFA claim mapping.
5. Confirm no `root_owner` membership exists in the target tenant.
6. Use an interactive private operator terminal. Do not run token issuance in CI or a retained deployment log.

## Issue the invitation

Supply the migration/admin database URL through the secret manager or a mounted file. In PowerShell:

```powershell
$env:DATABASE_ADMIN_URL_FILE = "C:\secure\database-admin-url"
$env:BOOTSTRAP_TENANT_ID = "<tenant UUID>"
$env:BOOTSTRAP_INSTALLATION_ID = "<installation UUID>"
$env:BOOTSTRAP_OWNER_EMAIL = "<verified owner email>"
$env:BOOTSTRAP_TTL_HOURS = "24"
$env:BOOTSTRAP_CONFIRM_OUTPUT = "SHOW_ONCE"
npm run identity:invite-first-owner
```

The command refuses an invalid installation, an existing Root Owner in that
tenant, another live invitation for that tenant, invalid email/UUID values or a
lifetime outside 1–168 hours. It prints the random token once; the value cannot
be recovered from PostgreSQL. The governed Platform Owner Console offers the
same one-time handoff only after its package, installation and canonical-domain
checks pass; it never activates those external gates itself.

Clear the one-shot environment values from the terminal after copying the token. Deliver it out-of-band to the intended owner; never place it in Git, tickets, retained chat or product email templates.

## Owner activation

1. Open `https://<trusted-installation-host>/auth/bootstrap`.
2. Paste the invitation into the form.
3. Continue to the configured OIDC provider.
4. Sign in with the exact invited email and complete MFA.
5. Return to the callback. A session is created only after the database transaction commits.

If the token expires before use, issue a replacement. Do not extend or edit the old row. After successful bootstrap, all subsequent user/role changes use authenticated RBAC administration; this endpoint remains unavailable because a Root Owner exists.

## Acceptance evidence

Before staging approval, verify:

- invitation and recipient plaintext are absent from database rows and logs;
- wrong Host, email and missing MFA return denial;
- expired token and replay return denial;
- exactly one `root_owner` membership exists in the target tenant;
- exactly one `identity.first_owner_bootstrapped` audit event exists;
- session uses Secure host-only cookies and sensitive operations require MFA;
- issuing another first-owner invitation is denied.
