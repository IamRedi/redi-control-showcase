import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const deployment = join(root, "deploy", "production");
const tunnelDeployment = join(root, "deploy", "cloudflare-tunnel");
const secretDirectory = mkdtempSync(join(tmpdir(), "redi-production-secrets-"));
const secretNames = [
  "postgres_admin_password",
  "database_admin_url",
  "database_runtime_password",
  "database_auth_password",
  "database_runtime_url",
  "database_auth_url",
  "oidc_client_secret",
  "identity_database_password",
  "keycloak_bootstrap_admin_secret",
  "keycloak_member_provisioner_secret",
  "oidc_transaction_key",
  "social_oauth_state_secret",
  "meta_app_secret",
  "object_storage_access_key_id",
  "object_storage_secret_access_key",
  "openbao_ca_cert",
  "openbao_tls_cert",
  "openbao_tls_key",
  "openbao_unseal_key",
  "openbao_approle_role_id",
  "openbao_approle_secret_id",
];

try {
  const deployScript = readFileSync(join(deployment, "deploy.sh"), "utf8");
  if (
    !deployScript.includes('git status --porcelain)"') ||
    deployScript.includes("--untracked-files=no")
  )
    throw new Error("deploy.sh must reject tracked and untracked build input");

  const migrationCount = readdirSync(join(root, "database", "migrations"), {
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).length;
  const runtimeExample = readFileSync(
    join(deployment, "runtime.env.example"),
    "utf8",
  );
  const expectedMigrationCount = Number(
    runtimeExample.match(/^EXPECTED_MIGRATION_COUNT=(\d+)$/m)?.[1],
  );
  if (expectedMigrationCount !== migrationCount)
    throw new Error(
      `runtime.env.example expects ${expectedMigrationCount} migrations, found ${migrationCount}`,
    );

  for (const unit of [
    "redi-control.service.in",
    "redi-control-openbao-bootstrap.service.in",
  ]) {
    const source = readFileSync(join(deployment, unit), "utf8");
    if (!source.includes("--force-recreate openbao"))
      throw new Error(
        `${unit} must recreate OpenBao when changing systemd credential namespace`,
      );
  }

  const productionScripts = readdirSync(deployment)
    .filter((name) => name.endsWith(".sh"))
    .sort();
  for (const script of productionScripts) {
    const syntax = spawnSync("bash", ["-n", script], {
      cwd: deployment,
      encoding: "utf8",
    });
    if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout);
  }

  for (const script of ["start.sh", "install-token.sh"]) {
    const syntax = spawnSync("bash", ["-n", script], {
      cwd: tunnelDeployment,
      encoding: "utf8",
    });
    if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout);
  }

  for (const name of secretNames) {
    writeFileSync(join(secretDirectory, name), `validation-only-${name}`);
  }

  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "-f",
      "compose.yaml",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: deployment,
      encoding: "utf8",
      env: {
        ...process.env,
        COMPOSE_PROFILES: "operator",
        REDI_RUNTIME_ENV_FILE: "./runtime.env.example",
        REDI_SECRETS_DIR: secretDirectory.replaceAll("\\", "/"),
      },
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exitCode = result.status ?? 1;
  } else {
    const rendered = JSON.parse(result.stdout);
    const services = rendered.services ?? {};
    const requiredServices = [
      "postgres",
      "migrate",
      "clamav",
      "openbao",
      "keycloak-db-init",
      "keycloak",
      "api",
      "worker",
      "web",
      "caddy",
    ];
    for (const service of requiredServices) {
      if (!services[service]) throw new Error(`Missing service: ${service}`);
    }
    for (const [name, service] of Object.entries(services)) {
      if (name !== "caddy" && (service.ports?.length ?? 0) > 0)
        throw new Error(`Unexpected public port on ${name}`);
      if (service.privileged || service.network_mode === "host")
        throw new Error(`Unsafe container privileges on ${name}`);
      if (
        !["migrate", "keycloak-db-init", "identity-bootstrap"].includes(name) &&
        !service.healthcheck
      )
        throw new Error(`Missing health check on ${name}`);
    }
    if (!rendered.networks?.backend?.internal)
      throw new Error("Database network must remain internal");
    for (const service of ["api", "worker"]) {
      const networks = Object.keys(services[service].networks ?? {});
      if (!networks.includes("backend") || !networks.includes("egress"))
        throw new Error(`${service} requires private DB and outbound networks`);
    }
    if (
      services.api.depends_on?.migrate?.condition !==
        "service_completed_successfully" ||
      services.web.depends_on?.api?.condition !== "service_healthy"
    )
      throw new Error("Startup ordering is not fail-closed");
    const identityBootstrap = services["identity-bootstrap"];
    if (
      !identityBootstrap ||
      !identityBootstrap.profiles?.includes("operator") ||
      identityBootstrap.restart !== "no" ||
      (identityBootstrap.ports?.length ?? 0) > 0 ||
      Object.keys(identityBootstrap.networks ?? {}).join(",") !== "backend" ||
      !identityBootstrap.entrypoint?.includes(
        "packages/identity/dist/bootstrap-cli.js",
      )
    )
      throw new Error(
        "First-owner invitation runner must stay private and one-shot",
      );
    const identityBootstrapSecrets = new Set(
      (identityBootstrap.secrets ?? []).map((secret) => secret.source),
    );
    if (
      identityBootstrapSecrets.size !== 1 ||
      !identityBootstrapSecrets.has("database_admin_url")
    )
      throw new Error(
        "First-owner invitation runner requires only the admin DB URL",
      );
    if (!services.worker.environment?.WORKER_HEALTH_FILE)
      throw new Error("Worker heartbeat is not configured");
    if (services.api.environment?.WORKER_HEALTH_FILE)
      throw new Error("Worker heartbeat leaked into API configuration");
    const apiSecretSources = new Set(
      (services.api.secrets ?? []).map((secret) => secret.source),
    );
    for (const secret of [
      "object_storage_access_key_id",
      "object_storage_secret_access_key",
      "keycloak_member_provisioner_secret",
    ]) {
      if (!apiSecretSources.has(secret))
        throw new Error(`API is missing ${secret}`);
      if (
        (services.worker.secrets ?? []).some((item) => item.source === secret)
      )
        throw new Error(`API-only secret leaked into worker: ${secret}`);
    }
    if (!rendered.volumes?.postgres_data)
      throw new Error("PostgreSQL persistent volume is missing");
    if (!rendered.volumes?.clamav_signatures)
      throw new Error("ClamAV signature volume is missing");
    if (!services.clamav.image?.includes("@sha256:"))
      throw new Error("ClamAV image must be pinned by digest");
    if (
      !(services.clamav.volumes ?? []).some(
        (volume) =>
          volume.target === "/etc/clamav/clamd.conf" && volume.read_only,
      )
    )
      throw new Error("ClamAV policy must be mounted read-only");
    if (
      services.api.depends_on?.clamav?.condition !== "service_healthy" ||
      (services.clamav.ports?.length ?? 0) > 0
    )
      throw new Error("ClamAV must stay private and gate API startup");
    if (
      !services.openbao.image?.includes("@sha256:") ||
      (services.openbao.ports?.length ?? 0) > 0 ||
      !Object.keys(services.openbao.networks ?? {}).includes("backend") ||
      Object.keys(services.openbao.networks ?? {}).length !== 1
    )
      throw new Error("OpenBao must be digest-pinned and backend-private");
    if (!rendered.volumes?.openbao_raft || !rendered.volumes?.openbao_audit)
      throw new Error("OpenBao Raft and audit volumes are required");
    if (services.api.depends_on?.openbao?.condition !== "service_healthy")
      throw new Error("OpenBao must gate API startup");
    if (
      !(services.openbao.tmpfs ?? []).some(
        (mount) =>
          (typeof mount === "string" && mount.startsWith("/run/openbao:")) ||
          mount.target === "/run/openbao",
      ) ||
      !(services.openbao.volumes ?? []).some(
        (mount) => mount.target === "/openbao-entrypoint.sh" && mount.read_only,
      )
    )
      throw new Error("OpenBao private inputs must be copied into tmpfs");
    const openBaoApiSecrets = [
      "openbao_ca_cert",
      "openbao_approle_role_id",
      "openbao_approle_secret_id",
    ];
    for (const secret of openBaoApiSecrets) {
      if (!apiSecretSources.has(secret))
        throw new Error(`API is missing ${secret}`);
      if (
        (services.worker.secrets ?? []).some((item) => item.source === secret)
      )
        throw new Error(`OpenBao credential leaked into worker: ${secret}`);
    }
    if (
      !services.keycloak.build?.args?.KEYCLOAK_BASE_IMAGE?.includes(
        "@sha256:",
      ) ||
      (services.keycloak.ports?.length ?? 0) > 0 ||
      !Object.keys(services.keycloak.networks ?? {}).includes("backend") ||
      Object.keys(services.keycloak.networks ?? {}).length !== 1 ||
      !services.keycloak.read_only
    )
      throw new Error(
        "Keycloak base must be digest-pinned and runtime read-only/private",
      );
    if (
      services.api.depends_on?.keycloak?.condition !== "service_healthy" ||
      services.caddy.depends_on?.keycloak?.condition !== "service_healthy" ||
      services.keycloak.depends_on?.["keycloak-db-init"]?.condition !==
        "service_completed_successfully"
    )
      throw new Error("Keycloak startup ordering is not fail-closed");
    const keycloakSecrets = new Set(
      (services.keycloak.secrets ?? []).map((secret) => secret.source),
    );
    for (const secret of [
      "identity_database_password",
      "oidc_client_secret",
      "keycloak_bootstrap_admin_secret",
    ]) {
      if (!keycloakSecrets.has(secret))
        throw new Error(`Keycloak is missing ${secret}`);
    }

    const tunnelTokenPath = join(secretDirectory, "cloudflare_tunnel_token");
    writeFileSync(tunnelTokenPath, "validation-only-tunnel-token");
    const tunnelResult = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env.example",
        "-f",
        "compose.yaml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: tunnelDeployment,
        encoding: "utf8",
        env: {
          ...process.env,
          CLOUDFLARE_TUNNEL_TOKEN_FILE: tunnelTokenPath.replaceAll("\\", "/"),
        },
      },
    );
    if (tunnelResult.status !== 0)
      throw new Error(tunnelResult.stderr || tunnelResult.stdout);

    const tunnelRendered = JSON.parse(tunnelResult.stdout);
    const tunnelServices = tunnelRendered.services ?? {};
    if (Object.keys(tunnelServices).join(",") !== "cloudflared")
      throw new Error("Tunnel project must contain only cloudflared");
    const tunnel = tunnelServices.cloudflared;
    if (!tunnel.image?.includes("@sha256:"))
      throw new Error("cloudflared image must be pinned by digest");
    if (tunnel.network_mode !== "host" || (tunnel.ports?.length ?? 0) > 0)
      throw new Error(
        "Tunnel must use host networking without published ports",
      );
    if (!tunnel.read_only || tunnel.privileged)
      throw new Error("Tunnel filesystem or privileges are unsafe");
    if (!(tunnel.cap_drop ?? []).includes("ALL"))
      throw new Error("Tunnel must drop all Linux capabilities");
    if (!(tunnel.security_opt ?? []).includes("no-new-privileges:true"))
      throw new Error("Tunnel must disable privilege escalation");
    const tunnelCommand = tunnel.command ?? [];
    if (
      !tunnelCommand.includes("--token-file") ||
      tunnelCommand.includes("--token") ||
      !tunnelCommand.includes("127.0.0.1:20241")
    )
      throw new Error("Tunnel must use a token file and loopback-only metrics");
    if (
      !(tunnel.secrets ?? []).some(
        (secret) => secret.source === "cloudflare_tunnel_token",
      )
    )
      throw new Error("Tunnel run token is not mounted as a secret");
    process.stdout.write(
      "Production Compose and Cloudflare Tunnel contracts are valid.\n",
    );
  }
} finally {
  rmSync(secretDirectory, { recursive: true, force: true });
}
