import { loadRuntimeConfig } from "@redi-control/config";
import { createPool, localDemoIds } from "@redi-control/database";
import {
  KeycloakMemberIdentityProvisioner,
  OidcIdentityAdapter,
  PostgresOidcTransactionStore,
  UnconfiguredIdentityAdapter,
  type IdentityAdapter,
} from "@redi-control/identity";
import {
  InstallationPolicyService,
  InstallationResolver,
} from "@redi-control/installation";
import {
  ClamAvMalwareScanner,
  DeterministicMalwareScanner,
  DeterministicMediaInspector,
  DeterministicSocialOAuthAdapter,
  DeterministicSocialProvider,
  LocalObjectStorageClient,
  LocalTokenSecretProvider,
  MediaLibraryService,
  MetaReadOnlyOAuthAdapter,
  MetaReadOnlyCollectionService,
  OAuthFoundationService,
  OpenBaoTokenSecretProvider,
  SocialPublishingService,
  S3CompatibleObjectStorageClient,
  UnconfiguredMalwareScanner,
  metaConnectorManifest,
  youtubeConnectorManifest,
} from "@redi-control/media-social";

import { buildApp } from "./app.js";
import { readFileSync } from "node:fs";

function resolveSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const direct = environment[name]?.trim();
  if (direct) return direct;
  const file = environment[`${name}_FILE`]?.trim();
  return file ? readFileSync(file, "utf8").trim() : undefined;
}

const runtimeEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: resolveSecret(process.env, "DATABASE_URL"),
  DATABASE_AUTH_URL: resolveSecret(process.env, "DATABASE_AUTH_URL"),
  OIDC_CLIENT_SECRET: resolveSecret(process.env, "OIDC_CLIENT_SECRET"),
  OIDC_TRANSACTION_ENCRYPTION_KEY: resolveSecret(
    process.env,
    "OIDC_TRANSACTION_ENCRYPTION_KEY",
  ),
  KEYCLOAK_MEMBER_PROVISIONER_CLIENT_SECRET: resolveSecret(
    process.env,
    "KEYCLOAK_MEMBER_PROVISIONER_CLIENT_SECRET",
  ),
  SOCIAL_OAUTH_STATE_SECRET: resolveSecret(
    process.env,
    "SOCIAL_OAUTH_STATE_SECRET",
  ),
  META_APP_SECRET: resolveSecret(process.env, "META_APP_SECRET"),
  OBJECT_STORAGE_ACCESS_KEY_ID: resolveSecret(
    process.env,
    "OBJECT_STORAGE_ACCESS_KEY_ID",
  ),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: resolveSecret(
    process.env,
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  ),
  OPENBAO_APPROLE_ROLE_ID: resolveSecret(
    process.env,
    "OPENBAO_APPROLE_ROLE_ID",
  ),
  OPENBAO_APPROLE_SECRET_ID: resolveSecret(
    process.env,
    "OPENBAO_APPROLE_SECRET_ID",
  ),
};
const config = loadRuntimeConfig(runtimeEnvironment);
const hardenedDeployment =
  config.DEPLOYMENT_ENV === "staging" || config.DEPLOYMENT_ENV === "production";
const database =
  config.DATABASE_URL && config.DATABASE_AUTH_URL
    ? {
        runtime: createPool(config.DATABASE_URL, "redi-control-api"),
        auth: createPool(config.DATABASE_AUTH_URL, "redi-control-auth"),
      }
    : undefined;
const tokenSecrets =
  config.SECRET_PROVIDER_MODE === "external" &&
  config.OPENBAO_ADDRESS &&
  config.OPENBAO_APPROLE_ROLE_ID &&
  config.OPENBAO_APPROLE_SECRET_ID
    ? new OpenBaoTokenSecretProvider({
        address: config.OPENBAO_ADDRESS,
        roleId: config.OPENBAO_APPROLE_ROLE_ID,
        secretId: config.OPENBAO_APPROLE_SECRET_ID,
        requestTimeoutMs: config.OPENBAO_REQUEST_TIMEOUT_MS,
      })
    : config.SECRET_PROVIDER_MODE === "local_memory"
      ? new LocalTokenSecretProvider()
      : undefined;
const identity: IdentityAdapter =
  config.IDENTITY_ADAPTER === "oidc" &&
  database &&
  config.OIDC_ISSUER &&
  config.OIDC_CLIENT_ID &&
  config.OIDC_CLIENT_SECRET &&
  config.OIDC_TRANSACTION_ENCRYPTION_KEY
    ? new OidcIdentityAdapter({
        issuer: config.OIDC_ISSUER,
        clientId: config.OIDC_CLIENT_ID,
        clientSecret: config.OIDC_CLIENT_SECRET,
        transactionStore: new PostgresOidcTransactionStore(
          database.auth,
          Buffer.from(config.OIDC_TRANSACTION_ENCRYPTION_KEY, "base64url"),
        ),
        allowedIdTokenAlgorithms: config.OIDC_ALLOWED_ID_TOKEN_ALGS.split(","),
        acceptedMfaAcrValues: config.OIDC_ACCEPTED_MFA_ACR_VALUES.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        requestedAcrValues: config.OIDC_REQUESTED_ACR_VALUES.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      })
    : new UnconfiguredIdentityAdapter();
const memberIdentityProvisioner =
  config.KEYCLOAK_MEMBER_PROVISIONER_ORIGIN &&
  config.KEYCLOAK_MEMBER_PROVISIONER_CLIENT_SECRET
    ? new KeycloakMemberIdentityProvisioner({
        adminOrigin: config.KEYCLOAK_MEMBER_PROVISIONER_ORIGIN,
        realm: config.KEYCLOAK_MEMBER_PROVISIONER_REALM,
        clientId: config.KEYCLOAK_MEMBER_PROVISIONER_CLIENT_ID,
        clientSecret: config.KEYCLOAK_MEMBER_PROVISIONER_CLIENT_SECRET,
      })
    : undefined;
const installationResolver = database
  ? new InstallationResolver(
      database.runtime,
      config.DEPLOYMENT_ENV,
      new Set(
        config.TRUSTED_PUBLIC_HOSTS.split(",").map((host) =>
          host.trim().toLowerCase(),
        ),
      ),
      config.LOCAL_DEMO_MODE
        ? {
            tenantId: localDemoIds.tenantId,
            installationId: localDemoIds.installationId,
          }
        : undefined,
    )
  : undefined;
const installationPolicies = database
  ? new InstallationPolicyService(database.runtime)
  : undefined;
const objectStorage =
  config.OBJECT_STORAGE_MODE === "local" &&
  config.LOCAL_STORAGE_BASE_URL &&
  config.LOCAL_STORAGE_SIGNING_SECRET
    ? new LocalObjectStorageClient(
        config.LOCAL_STORAGE_BASE_URL,
        config.LOCAL_STORAGE_SIGNING_SECRET,
      )
    : config.OBJECT_STORAGE_MODE === "s3_compatible" &&
        config.OBJECT_STORAGE_ENDPOINT &&
        config.OBJECT_STORAGE_REGION &&
        config.OBJECT_STORAGE_BUCKET &&
        config.OBJECT_STORAGE_ACCESS_KEY_ID &&
        config.OBJECT_STORAGE_SECRET_ACCESS_KEY
      ? new S3CompatibleObjectStorageClient({
          endpoint: config.OBJECT_STORAGE_ENDPOINT,
          region: config.OBJECT_STORAGE_REGION,
          bucket: config.OBJECT_STORAGE_BUCKET,
          accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY_ID,
          secretAccessKey: config.OBJECT_STORAGE_SECRET_ACCESS_KEY,
          forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
          ...(config.OBJECT_STORAGE_KEY_PREFIX
            ? { keyPrefix: config.OBJECT_STORAGE_KEY_PREFIX }
            : {}),
        })
      : undefined;
const malwareScanner =
  config.MEDIA_SCANNER === "deterministic_local"
    ? new DeterministicMalwareScanner()
    : config.MEDIA_SCANNER === "external" && objectStorage && config.CLAMAV_HOST
      ? new ClamAvMalwareScanner(objectStorage, {
          host: config.CLAMAV_HOST,
          port: config.CLAMAV_PORT,
          timeoutMs: config.CLAMAV_TIMEOUT_MS,
          maxBytes: config.CLAMAV_MAX_BYTES,
          downloadUrlTtlSeconds: config.OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS,
        })
      : new UnconfiguredMalwareScanner();
const mediaLibrary =
  database && objectStorage
    ? new MediaLibraryService(
        database.runtime,
        objectStorage,
        malwareScanner,
        new DeterministicMediaInspector(),
        {
          allowedMimeTypes: new Set([
            "image/jpeg",
            "image/png",
            "image/webp",
            "video/mp4",
          ]),
          maxImageBytes: 25 * 1024 * 1024,
          maxVideoBytes: 512 * 1024 * 1024,
          uploadTtlSeconds: config.OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS,
          downloadTtlSeconds: config.OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS,
          standardRetentionDays: 90,
          multipartThresholdBytes: 10 * 1024 * 1024,
        },
      )
    : undefined;
const socialOAuth =
  database &&
  tokenSecrets &&
  ["deterministic_local", "live"].includes(config.SOCIAL_PROVIDER_MODE) &&
  config.SOCIAL_OAUTH_STATE_SECRET
    ? new OAuthFoundationService(
        database.runtime,
        tokenSecrets,
        config.SOCIAL_OAUTH_STATE_SECRET,
        new Set(
          config.SOCIAL_OAUTH_REDIRECT_URIS.split(",").map((value) =>
            value.trim(),
          ),
        ),
      )
    : undefined;
const socialPublishing =
  database && tokenSecrets
    ? new SocialPublishingService(database.runtime, tokenSecrets)
    : undefined;
const metaReadAdapter =
  config.SOCIAL_PROVIDER_MODE === "live"
    ? new MetaReadOnlyOAuthAdapter(
        config.META_APP_ID,
        config.META_APP_SECRET,
        config.META_GRAPH_API_VERSION,
        config.META_BUSINESS_LOGIN_CONFIGURATION_ID,
      )
    : undefined;
const metaReadCollection =
  database && tokenSecrets && metaReadAdapter?.configured
    ? new MetaReadOnlyCollectionService(
        database.runtime,
        tokenSecrets,
        metaReadAdapter,
      )
    : undefined;
// Production adapters are never inferred from configuration labels. Readiness
// stays closed until real hardened implementations are constructed here.
const hardenedAdaptersReady =
  !hardenedDeployment ||
  (identity.id === "oidc" &&
    Boolean(mediaLibrary) &&
    malwareScanner.configured &&
    Boolean(tokenSecrets) &&
    Boolean(socialOAuth) &&
    Boolean(socialPublishing) &&
    Boolean(metaReadCollection));
if (socialOAuth) {
  if (metaReadAdapter) socialOAuth.register(metaReadAdapter);
  if (config.SOCIAL_PROVIDER_MODE === "deterministic_local")
    socialOAuth.register(
      new DeterministicSocialOAuthAdapter(
        "meta",
        [
          {
            providerAccountId: "local-facebook-page",
            accountType: "facebook_page",
            displayName: "Local Facebook Page",
          },
          {
            providerAccountId: "local-instagram-account",
            accountType: "instagram_account",
            displayName: "Local Instagram Account",
          },
        ],
        [
          "pages.show-list",
          "pages.manage-posts",
          "instagram.basic",
          "instagram.content-publish",
        ],
      ),
    );
  socialOAuth.register(
    new DeterministicSocialOAuthAdapter(
      "youtube",
      [
        {
          providerAccountId: "local-youtube-channel",
          accountType: "youtube_channel",
          displayName: "Local YouTube Channel",
        },
      ],
      ["youtube.readonly", "youtube.upload"],
    ),
  );
}
if (socialPublishing && config.SOCIAL_PROVIDER_MODE === "deterministic_local") {
  socialPublishing.registerProvider(
    new DeterministicSocialProvider("meta", metaConnectorManifest),
  );
  socialPublishing.registerProvider(
    new DeterministicSocialProvider("youtube", youtubeConnectorManifest),
  );
}
const app = buildApp({
  ...(database ? { database } : {}),
  identity,
  ...(memberIdentityProvisioner ? { memberIdentityProvisioner } : {}),
  cookieSecure: config.SESSION_COOKIE_SECURE,
  publicApiUrl: config.PUBLIC_API_ORIGIN,
  publicWebUrl: config.PUBLIC_WEB_ORIGIN,
  localDemoEnabled: config.LOCAL_DEMO_MODE,
  expectedMigrationCount: config.EXPECTED_MIGRATION_COUNT,
  criticalConfigurationReady: hardenedAdaptersReady,
  identityReadiness: () =>
    identity instanceof OidcIdentityAdapter
      ? identity.health()
      : Promise.resolve(!hardenedDeployment),
  storageReadiness: async () => {
    if (objectStorage) {
      const storageReady =
        (await objectStorage.health()) && (await malwareScanner.health());
      if (!storageReady) return false;
      return tokenSecrets instanceof OpenBaoTokenSecretProvider
        ? tokenSecrets.health()
        : !hardenedDeployment;
    }
    const target =
      config.OBJECT_STORAGE_HEALTH_URL ??
      (config.LOCAL_STORAGE_BASE_URL
        ? `${config.LOCAL_STORAGE_BASE_URL}/health/ready`
        : undefined);
    if (!target) return false;
    const response = await fetch(target, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  },
  ...(installationResolver ? { installationResolver } : {}),
  ...(installationPolicies ? { installationPolicies } : {}),
  ...(tokenSecrets ? { connectorSecretProvider: tokenSecrets } : {}),
  ...(mediaLibrary ? { mediaLibrary } : {}),
  ...(socialOAuth ? { socialOAuth } : {}),
  ...(config.META_BUSINESS_LOGIN_CONFIGURATION_ID
    ? {
        metaBusinessLoginConfigurationId:
          config.META_BUSINESS_LOGIN_CONFIGURATION_ID,
      }
    : {}),
  ...(metaReadCollection ? { metaReadCollection } : {}),
  ...(socialPublishing ? { socialPublishing } : {}),
});

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(async () => {
      await Promise.all([database?.runtime.end(), database?.auth.end()]);
    });
  });
}
