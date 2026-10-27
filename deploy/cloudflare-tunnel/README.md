# Cloudflare Tunnel ingress

This is the independently managed connector for the selected Cloudflare Free
Tunnel ingress. It is intentionally separate from the REDI CONTROL application
Compose project. The connector uses outbound-only connections and host networking
solely so it can reach the Caddy origin bound to `127.0.0.1:8080`.

## Safety boundary

- Keep `deploy/production/` on `Caddyfile.origin`, bind it to `127.0.0.1`, and
  use the exact public host `control.example.invalid`.
- Store only the tunnel-specific run token in
  `secrets/cloudflare_tunnel_token`, with mode `0600`. Never store an
  account-wide certificate or API token on this host.
- The image is pinned to the reviewed multi-architecture digest for
  `cloudflared` 2026.7.3. Review release notes and replace the digest explicitly
  during upgrades.
- `start.sh` refuses to start unless the core ingress gate and exact Keycloak
  issuer discovery both succeed through the loopback origin. Full hardened
  readiness stays separate until the public OIDC/social acceptance is complete.
- Do not create the public hostname route until the Cloudflare zone is active,
  the remote tunnel configuration points to `http://localhost:8080`, and its
  origin request preserves `Host: control.example.invalid`.

## Operator sequence

1. Copy `.env.example` to ignored `.env`.
2. Create `secrets/cloudflare_tunnel_token`, write the remotely managed tunnel
   token without a trailing command, and run `chmod 600` on the file.
3. Configure the remote tunnel with one public hostname and a terminal HTTP 404
   fallback. Do not add private-network routes.
4. Start the application with the reviewed loopback-only production profile and
   require `/health/ingress` plus local Keycloak discovery to pass.
5. Run `./install-token.sh`, paste the tunnel token only into the local terminal
   and authenticate locally with `sudo` when prompted. The script writes an ignored
   `root:65532` mode-`640` token file readable only by root and Cloudflared's
   runtime group. Then run `./start.sh`. Verify the Cloudflare connector is healthy and test the
   public hostname, exact-host rejection, DNS, TLS and application readiness.

This split avoids a bootstrap cycle: OIDC and social callbacks need the public
hostname before their live acceptance can make `/health/ready` green. It does
not weaken the final readiness gate or authorize publication.

The tunnel token can run this tunnel but cannot manage the Cloudflare account.
Rotate it if its confidentiality is in doubt. The Cloudflare API credential used
to create or configure the tunnel must remain outside this repository and host.
