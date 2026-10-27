import { z } from "zod";

export const runtimeConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DEPLOYMENT_ENV: z
      .enum(["local", "test", "staging", "production"])
      .default("local"),
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().url().optional(),
    DATABASE_AUTH_URL: z.string().url().optional(),
    PUBLIC_WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    PUBLIC_API_ORIGIN: z.string().url().default("http://localhost:3001"),
    TRUSTED_PUBLIC_HOSTS: z.string().default("localhost,127.0.0.1"),
    LOCAL_DEMO_MODE: z.stringbool().default(false),
    IDENTITY_ADAPTER: z.enum(["unconfigured", "oidc"]).default("unconfigured"),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().min(3).max(240).optional(),
    OIDC_CLIENT_SECRET: z.string().min(16).max(2048).optional(),
    OIDC_TRANSACTION_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    OIDC_ALLOWED_ID_TOKEN_ALGS: z
      .string()
      .regex(/^[A-Z0-9-]+(?:,[A-Z0-9-]+)*$/)
      .default("RS256"),
    OIDC_ACCEPTED_MFA_ACR_VALUES: z.string().max(1000).default(""),
    OIDC_REQUESTED_ACR_VALUES: z
      .string()
      .regex(/^[A-Za-z0-9._~:/-]+(?:,[A-Za-z0-9._~:/-]+)*$/)
      .optional()
      .default(""),
    KEYCLOAK_MEMBER_PROVISIONER_ORIGIN: z.string().url().optional(),
    KEYCLOAK_MEMBER_PROVISIONER_REALM: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,120}$/)
      .default("redi-control"),
    KEYCLOAK_MEMBER_PROVISIONER_CLIENT_ID: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{3,120}$/)
      .default("redi-control-member-provisioner"),
    KEYCLOAK_MEMBER_PROVISIONER_CLIENT_SECRET: z
      .string()
      .min(16)
      .max(2048)
      .optional(),
    SESSION_COOKIE_SECURE: z.stringbool().default(true),
    DATA_REGION: z.string().default("eu"),
    LOCAL_STORAGE_BASE_URL: z.string().url().optional(),
    LOCAL_STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
    OBJECT_STORAGE_MODE: z
      .enum(["unconfigured", "local", "s3_compatible"])
      .default("unconfigured"),
    OBJECT_STORAGE_HEALTH_URL: z.string().url().optional(),
    OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
    OBJECT_STORAGE_REGION: z.string().min(1).max(100).optional(),
    OBJECT_STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(3).max(512).optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(8).max(2048).optional(),
    OBJECT_STORAGE_FORCE_PATH_STYLE: z.stringbool().default(false),
    OBJECT_STORAGE_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9/_-]{0,239}$/)
      .optional(),
    OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),
    OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(300),
    SECRET_PROVIDER_MODE: z
      .enum(["unconfigured", "local_memory", "external"])
      .default("unconfigured"),
    OPENBAO_ADDRESS: z.string().url().optional(),
    OPENBAO_APPROLE_ROLE_ID: z.string().min(1).max(4096).optional(),
    OPENBAO_APPROLE_SECRET_ID: z.string().min(1).max(16_384).optional(),
    OPENBAO_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(30_000)
      .default(5_000),
    ENCRYPTION_KEY_REFERENCE: z
      .string()
      .regex(/^secret:\/\/[a-zA-Z0-9/_-]{3,240}$/)
      .optional(),
    MEDIA_SCANNER: z
      .enum(["unconfigured", "deterministic_local", "external"])
      .default("unconfigured"),
    CLAMAV_HOST: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .default(180_000),
    CLAMAV_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024)
      .default(512 * 1024 * 1024),
    SOCIAL_PROVIDER_MODE: z
      .enum(["unconfigured", "deterministic_local", "live"])
      .default("unconfigured"),
    SOCIAL_OAUTH_STATE_SECRET: z.string().min(32).optional(),
    SOCIAL_OAUTH_REDIRECT_URIS: z
      .string()
      .default(
        "http://127.0.0.1:3001/api/social/oauth/meta/callback,http://127.0.0.1:3001/api/social/oauth/youtube/callback",
      ),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    EXPECTED_MIGRATION_COUNT: z.coerce.number().int().min(1).default(44),
    SOURCE_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(30000)
      .default(10000),
    SOURCE_FETCH_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(10000000)
      .default(2000000),
    SOURCE_FETCH_USER_AGENT: z
      .string()
      .min(16)
      .max(240)
      .default(
        "REDI-CONTROL-Source-Ingestion/1.0 (+https://redi-control.example/source-policy)",
      ),
    META_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v26.0"),
    META_APP_ID: z.string().min(1).max(128).optional(),
    META_APP_SECRET: z.string().min(16).max(2048).optional(),
    META_BUSINESS_LOGIN_CONFIGURATION_ID: z
      .string()
      .regex(/^\d+$/)
      .max(64)
      .optional(),
    YOUTUBE_API_VERSION: z.literal("v3").default("v3"),
  })
  .superRefine((value, context) => {
    const hardened =
      value.DEPLOYMENT_ENV === "staging" ||
      value.DEPLOYMENT_ENV === "production";
    const loopbackApiHost = ["127.0.0.1", "localhost", "::1"].includes(
      value.API_HOST,
    );
    const apiOrigin = new URL(value.PUBLIC_API_ORIGIN);
    const loopbackApiOrigin = ["127.0.0.1", "localhost", "::1"].includes(
      apiOrigin.hostname,
    );
    if (
      value.LOCAL_DEMO_MODE &&
      (value.DEPLOYMENT_ENV !== "local" ||
        !loopbackApiHost ||
        !loopbackApiOrigin ||
        apiOrigin.protocol !== "http:")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Local demo mode requires DEPLOYMENT_ENV=local and loopback-only HTTP API binding",
      });
    }
    const candidates = value.SOCIAL_OAUTH_REDIRECT_URIS.split(",").map(
      (entry) => entry.trim(),
    );
    if (
      Boolean(value.LOCAL_STORAGE_BASE_URL) !==
      Boolean(value.LOCAL_STORAGE_SIGNING_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Local storage URL and signing secret must be configured together",
      });
    }
    if (
      hardened &&
      (value.MEDIA_SCANNER === "deterministic_local" ||
        value.SOCIAL_PROVIDER_MODE === "deterministic_local")
    ) {
      context.addIssue({
        code: "custom",
        message: "Deterministic local providers are forbidden in production",
      });
    }
    if (value.SOCIAL_PROVIDER_MODE === "live") {
      for (const [candidate, name] of [
        [value.META_APP_ID, "META_APP_ID"],
        [value.META_APP_SECRET, "META_APP_SECRET"],
      ] as const) {
        if (!candidate)
          context.addIssue({
            code: "custom",
            message: `${name} is required for live Meta read access`,
          });
      }
    }
    if (hardened) {
      const required = [
        [value.DATABASE_URL, "DATABASE_URL"],
        [value.DATABASE_AUTH_URL, "DATABASE_AUTH_URL"],
        [value.SOCIAL_OAUTH_STATE_SECRET, "SOCIAL_OAUTH_STATE_SECRET"],
        [value.ENCRYPTION_KEY_REFERENCE, "ENCRYPTION_KEY_REFERENCE"],
      ] as const;
      for (const [candidate, name] of required) {
        if (!candidate)
          context.addIssue({ code: "custom", message: `${name} is required` });
      }
      if (!value.SESSION_COOKIE_SECURE)
        context.addIssue({
          code: "custom",
          message: "Secure cookies are required",
        });
      if (value.IDENTITY_ADAPTER !== "oidc")
        context.addIssue({
          code: "custom",
          message: "OIDC identity is required",
        });
      for (const [candidate, name] of [
        [value.OIDC_ISSUER, "OIDC_ISSUER"],
        [value.OIDC_CLIENT_ID, "OIDC_CLIENT_ID"],
        [value.OIDC_CLIENT_SECRET, "OIDC_CLIENT_SECRET"],
        [
          value.OIDC_TRANSACTION_ENCRYPTION_KEY,
          "OIDC_TRANSACTION_ENCRYPTION_KEY",
        ],
      ] as const) {
        if (!candidate)
          context.addIssue({ code: "custom", message: `${name} is required` });
      }
      if (!value.OIDC_ACCEPTED_MFA_ACR_VALUES.trim())
        context.addIssue({
          code: "custom",
          message: "At least one trusted MFA ACR value is required",
        });
      if (!value.OIDC_REQUESTED_ACR_VALUES.trim())
        context.addIssue({
          code: "custom",
          message: "At least one requested MFA ACR value is required",
        });
      if (value.OIDC_ISSUER) {
        const issuer = new URL(value.OIDC_ISSUER);
        if (
          issuer.protocol !== "https:" ||
          issuer.username ||
          issuer.password ||
          issuer.search ||
          issuer.hash ||
          ["localhost", "127.0.0.1", "::1"].includes(issuer.hostname)
        )
          context.addIssue({
            code: "custom",
            message: "OIDC issuer must be a trusted HTTPS origin",
          });
      }
      if (value.SECRET_PROVIDER_MODE !== "external")
        context.addIssue({
          code: "custom",
          message: "External secret provider is required",
        });
      for (const [candidate, name] of [
        [value.OPENBAO_ADDRESS, "OPENBAO_ADDRESS"],
        [value.OPENBAO_APPROLE_ROLE_ID, "OPENBAO_APPROLE_ROLE_ID"],
        [value.OPENBAO_APPROLE_SECRET_ID, "OPENBAO_APPROLE_SECRET_ID"],
      ] as const) {
        if (!candidate)
          context.addIssue({ code: "custom", message: `${name} is required` });
      }
      if (value.OBJECT_STORAGE_MODE !== "s3_compatible")
        context.addIssue({
          code: "custom",
          message: "S3-compatible object storage is required",
        });
      for (const [candidate, name] of [
        [value.OBJECT_STORAGE_ENDPOINT, "OBJECT_STORAGE_ENDPOINT"],
        [value.OBJECT_STORAGE_REGION, "OBJECT_STORAGE_REGION"],
        [value.OBJECT_STORAGE_BUCKET, "OBJECT_STORAGE_BUCKET"],
        [value.OBJECT_STORAGE_ACCESS_KEY_ID, "OBJECT_STORAGE_ACCESS_KEY_ID"],
        [
          value.OBJECT_STORAGE_SECRET_ACCESS_KEY,
          "OBJECT_STORAGE_SECRET_ACCESS_KEY",
        ],
      ] as const) {
        if (!candidate)
          context.addIssue({ code: "custom", message: `${name} is required` });
      }
      if (value.OBJECT_STORAGE_ENDPOINT) {
        const storageEndpoint = new URL(value.OBJECT_STORAGE_ENDPOINT);
        if (
          storageEndpoint.protocol !== "https:" ||
          storageEndpoint.username ||
          storageEndpoint.password ||
          storageEndpoint.search ||
          storageEndpoint.hash
        )
          context.addIssue({
            code: "custom",
            message: "Object storage endpoint must be a trusted HTTPS origin",
          });
      }
      if (value.MEDIA_SCANNER !== "external")
        context.addIssue({
          code: "custom",
          message: "External media scanner is required",
        });
      if (value.MEDIA_SCANNER === "external" && !value.CLAMAV_HOST)
        context.addIssue({
          code: "custom",
          message: "CLAMAV_HOST is required for the external scanner",
        });
      if (value.SOCIAL_PROVIDER_MODE !== "live")
        context.addIssue({
          code: "custom",
          message: "Live social providers are required",
        });
      for (const origin of [value.PUBLIC_WEB_ORIGIN, value.PUBLIC_API_ORIGIN]) {
        const parsed = new URL(origin);
        if (
          parsed.protocol !== "https:" ||
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        )
          context.addIssue({
            code: "custom",
            message: "Public origins must use HTTPS and non-local hosts",
          });
      }
      if (
        value.TRUSTED_PUBLIC_HOSTS.split(",").some(
          (host) =>
            host.trim() === "*" ||
            ["localhost", "127.0.0.1"].includes(host.trim()),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Trusted hosts cannot be wildcard or local",
        });
      for (const secret of [
        value.SOCIAL_OAUTH_STATE_SECRET,
        value.LOCAL_STORAGE_SIGNING_SECRET,
      ]) {
        if (secret && /replace|change.?me|default|example/i.test(secret))
          context.addIssue({
            code: "custom",
            message: "Default or example secrets are forbidden",
          });
      }
    }
    if (
      value.SOCIAL_PROVIDER_MODE === "deterministic_local" &&
      !value.SOCIAL_OAUTH_STATE_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message: "Local social OAuth requires a state signing secret",
      });
    }
    if (value.OPENBAO_ADDRESS) {
      const address = new URL(value.OPENBAO_ADDRESS);
      if (
        address.protocol !== "https:" ||
        address.username ||
        address.password ||
        address.pathname !== "/" ||
        address.search ||
        address.hash
      )
        context.addIssue({
          code: "custom",
          message: "OpenBao address must be a trusted HTTPS origin",
        });
    }
    for (const candidate of candidates) {
      try {
        const parsed = new URL(candidate);
        if (candidate.includes("*") || parsed.username || parsed.password)
          throw new Error("unsafe redirect");
        if (
          hardened &&
          (parsed.protocol !== "https:" ||
            ["localhost", "127.0.0.1"].includes(parsed.hostname))
        )
          throw new Error("insecure redirect");
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid social OAuth redirect URI",
        });
      }
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  return runtimeConfigSchema.parse(environment);
}

export const workerRuntimeConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DEPLOYMENT_ENV: z
    .enum(["local", "test", "staging", "production"])
    .default("local"),
  DATABASE_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_HEALTH_FILE: z
    .string()
    .regex(/^\/[a-zA-Z0-9/_.-]+$/)
    .optional(),
  WORKER_HEALTH_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  EXPECTED_MIGRATION_COUNT: z.coerce.number().int().min(1).default(44),
  SOURCE_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(10000),
  SOURCE_FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10000000)
    .default(2000000),
  SOURCE_FETCH_USER_AGENT: z
    .string()
    .min(16)
    .max(240)
    .default(
      "REDI-CONTROL-Source-Ingestion/1.0 (+https://redi-control.example/source-policy)",
    ),
});

export type WorkerRuntimeConfig = z.infer<typeof workerRuntimeConfigSchema>;

export function loadWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): WorkerRuntimeConfig {
  return workerRuntimeConfigSchema.parse(environment);
}

export const availableLocales = ["en", "de", "sq", "it"] as const;
export const enabledLocales = ["en", "de", "sq"] as const;
export type AvailableLocale = (typeof availableLocales)[number];
export type EnabledLocale = (typeof enabledLocales)[number];

export const whiteLabelConfigSchema = z
  .object({
    brand: z.object({
      name: z.string().min(1),
      logoPath: z.string().nullable(),
      faviconPath: z.string().nullable(),
      colors: z.object({
        primary: z.string().regex(/^#[0-9a-f]{6}$/i),
        background: z.string().regex(/^#[0-9a-f]{6}$/i),
        surface: z.string().regex(/^#[0-9a-f]{6}$/i),
      }),
      fontFamily: z.string().min(1),
    }),
    locales: z.array(z.enum(enabledLocales)).min(1),
    availableLocales: z.array(z.enum(availableLocales)).min(1),
    defaultLocale: z.enum(enabledLocales),
    modules: z.record(z.string(), z.boolean()),
    legal: z.object({
      privacyUrl: z.url().nullable(),
      termsUrl: z.url().nullable(),
    }),
    support: z.object({ email: z.email().nullable() }),
  })
  .superRefine((value, context) => {
    if (!value.locales.includes(value.defaultLocale)) {
      context.addIssue({
        code: "custom",
        message: "defaultLocale must be enabled",
        path: ["defaultLocale"],
      });
    }
    for (const locale of value.locales) {
      if (!value.availableLocales.includes(locale)) {
        context.addIssue({
          code: "custom",
          message: "Enabled locale must be available",
          path: ["locales"],
        });
      }
    }
  });

export type WhiteLabelConfig = z.infer<typeof whiteLabelConfigSchema>;
