# Security boundaries

Do not put credentials, production URLs, account identifiers, runtime databases,
tokens or local environment files into issues, screenshots or Git. Keep all
real providers disabled during evaluation. The demo's local roles/MFA state is
synthetic and must never be used as a production authentication shortcut.

Preserve tenant/RLS isolation, actor-derived authority, exact approvals,
idempotency, CSRF, SSRF controls, audit/outbox and secret-provider interfaces.
The offline preload is an evaluation guard for Node network calls; it is not
an OS-level sandbox or a production egress policy. Do not point the fixtures,
integration tests or browser bootstrap at existing data.
