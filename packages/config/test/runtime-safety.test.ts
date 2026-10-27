import { describe, expect, it } from "vitest";

import { loadRuntimeConfig, loadWorkerRuntimeConfig } from "../src/index.js";

const safeStaging = {
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "staging",
  DATABASE_URL: "postgresql://runtime@db.internal/control",
  DATABASE_AUTH_URL: "postgresql://auth@db.internal/control",
  PUBLIC_WEB_ORIGIN: "https://app.staging.example.com",
  PUBLIC_API_ORIGIN: "https://app.staging.example.com",
  TRUSTED_PUBLIC_HOSTS: "app.staging.example.com,customer.example.org",
  IDENTITY_ADAPTER: "oidc",
  OIDC_ISSUER: "https://identity.staging.example.com",
  OIDC_CLIENT_ID: "redi-control-staging",
  OIDC_CLIENT_SECRET: "test-only-client-secret-value",
  OIDC_TRANSACTION_ENCRYPTION_KEY:
    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
  OIDC_ACCEPTED_MFA_ACR_VALUES: "2",
  OIDC_REQUESTED_ACR_VALUES: "2",
  SESSION_COOKIE_SECURE: "true",
  SECRET_PROVIDER_MODE: "external",
  OPENBAO_ADDRESS: "https://openbao.internal:8200",
  OPENBAO_APPROLE_ROLE_ID: "staging-role-id",
  OPENBAO_APPROLE_SECRET_ID: "staging-secret-id",
  ENCRYPTION_KEY_REFERENCE: "secret://staging/data-encryption",
  OBJECT_STORAGE_MODE: "s3_compatible",
  OBJECT_STORAGE_ENDPOINT: "https://objects.internal",
  OBJECT_STORAGE_REGION: "eu-central-1",
  OBJECT_STORAGE_BUCKET: "redi-control-staging",
  OBJECT_STORAGE_ACCESS_KEY_ID: "staging-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "staging-secret-access-key",
  OBJECT_STORAGE_KEY_PREFIX: "redi-control/staging",
  OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS: "900",
  OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS: "300",
  MEDIA_SCANNER: "external",
  CLAMAV_HOST: "clamav",
  SOCIAL_PROVIDER_MODE: "live",
  META_APP_ID: "test-meta-app-id",
  META_APP_SECRET: "test-only-meta-app-secret",
  SOCIAL_OAUTH_STATE_SECRET: "test-only-test-only-test-only-000",
  SOCIAL_OAUTH_REDIRECT_URIS:
    "https://app.staging.example.com/api/social/oauth/meta/callback,https://app.staging.example.com/api/social/oauth/youtube/callback",
} satisfies NodeJS.ProcessEnv;

describe("deployment configuration safety", () => {
  it("accepts an explicit hardened staging profile", () => {
    expect(loadRuntimeConfig(safeStaging).DEPLOYMENT_ENV).toBe("staging");
  });

  it.each([
    ["deterministic provider", { SOCIAL_PROVIDER_MODE: "deterministic_local" }],
    ["HTTP origin", { PUBLIC_API_ORIGIN: "http://app.staging.example.com" }],
    [
      "localhost callback",
      {
        SOCIAL_OAUTH_REDIRECT_URIS:
          "http://localhost:3001/api/social/oauth/meta/callback",
      },
    ],
    [
      "wildcard callback",
      {
        SOCIAL_OAUTH_REDIRECT_URIS:
          "https://*.example.com/api/social/oauth/meta/callback",
      },
    ],
    [
      "default secret",
      { SOCIAL_OAUTH_STATE_SECRET: "replace-with-default-secret-value" },
    ],
    ["local secret provider", { SECRET_PROVIDER_MODE: "local_memory" }],
    ["missing OpenBao role", { OPENBAO_APPROLE_ROLE_ID: undefined }],
    ["insecure OpenBao", { OPENBAO_ADDRESS: "http://openbao.internal:8200" }],
    ["missing external scanner", { CLAMAV_HOST: undefined }],
    ["missing S3 credentials", { OBJECT_STORAGE_SECRET_ACCESS_KEY: undefined }],
    [
      "insecure S3 endpoint",
      { OBJECT_STORAGE_ENDPOINT: "http://objects.internal" },
    ],
    ["unconfigured identity", { IDENTITY_ADAPTER: "unconfigured" }],
    ["HTTP identity issuer", { OIDC_ISSUER: "http://identity.example.com" }],
    ["missing trusted MFA ACR", { OIDC_ACCEPTED_MFA_ACR_VALUES: "" }],
    ["missing requested MFA ACR", { OIDC_REQUESTED_ACR_VALUES: "" }],
    ["unsafe S3 prefix", { OBJECT_STORAGE_KEY_PREFIX: "../shared" }],
    ["excessive upload TTL", { OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS: "7200" }],
    [
      "excessive download TTL",
      { OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS: "7200" },
    ],
  ])("rejects %s in staging", (_name, override) => {
    expect(() => loadRuntimeConfig({ ...safeStaging, ...override })).toThrow();
  });

  it("keeps deterministic providers available only for local/test", () => {
    expect(
      loadRuntimeConfig({
        DEPLOYMENT_ENV: "test",
        SOCIAL_PROVIDER_MODE: "deterministic_local",
        SOCIAL_OAUTH_STATE_SECRET:
          "local-test-secret-value-that-is-long-enough",
      }).SOCIAL_PROVIDER_MODE,
    ).toBe("deterministic_local");
  });

  it("allows demo mode only on an explicit loopback local API", () => {
    expect(
      loadRuntimeConfig({
        DEPLOYMENT_ENV: "local",
        API_HOST: "127.0.0.1",
        PUBLIC_API_ORIGIN: "http://127.0.0.1:3001",
        LOCAL_DEMO_MODE: "true",
      }).LOCAL_DEMO_MODE,
    ).toBe(true);
    expect(() =>
      loadRuntimeConfig({ ...safeStaging, LOCAL_DEMO_MODE: "true" }),
    ).toThrow("Local demo mode requires");
    expect(() =>
      loadRuntimeConfig({
        DEPLOYMENT_ENV: "local",
        API_HOST: "0.0.0.0",
        PUBLIC_API_ORIGIN: "http://127.0.0.1:3001",
        LOCAL_DEMO_MODE: "true",
      }),
    ).toThrow("Local demo mode requires");
  });
});

describe("worker runtime configuration", () => {
  it("accepts a least-privilege hardened worker without API/OIDC secrets", () => {
    const config = loadWorkerRuntimeConfig({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "staging",
      DATABASE_URL: "postgresql://runtime:secret@database.internal/control",
      EXPECTED_MIGRATION_COUNT: "43",
      WORKER_HEALTH_FILE: "/tmp/redi-control-worker-heartbeat",
    });
    expect(config.DEPLOYMENT_ENV).toBe("staging");
    expect(config.EXPECTED_MIGRATION_COUNT).toBe(43);
    expect(config.WORKER_HEALTH_FILE).toBe(
      "/tmp/redi-control-worker-heartbeat",
    );
  });

  it("fails closed without its database or outside bounded worker limits", () => {
    expect(() =>
      loadWorkerRuntimeConfig({ DEPLOYMENT_ENV: "staging" }),
    ).toThrow();
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://runtime:secret@database.internal/control",
        WORKER_HEALTH_FILE: "relative/heartbeat",
      }),
    ).toThrow();
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://runtime:secret@database.internal/control",
        WORKER_CONCURRENCY: "65",
      }),
    ).toThrow();
  });
});
