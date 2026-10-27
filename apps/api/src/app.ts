import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formBody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { AiGateway, type AiProvider } from "@redi-control/ai-gateway";
import {
  ConnectorRuntime,
  InMemorySecretProvider,
  ReferenceConnector,
  type SecretProvider,
  type TrustedConnectorContext,
} from "@redi-control/connector-sdk";
import {
  hasPermission,
  roles,
  type Permission,
  type RequestActor,
  type Role,
} from "@redi-control/core";
import {
  createReferenceConnection,
  createBusinessSiteWebsiteConnection,
  disableConnection,
  listWebsiteConnections,
  PostgresConnectorRuntimeStore,
  recordWebsiteArticleStatusCount,
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";
import {
  FirstOwnerInvitationError,
  FirstOwnerInvitationStore,
  LocalDemoBootstrapError,
  MemberIdentityProvisioningError,
  MemberInvitationError,
  MemberInvitationStore,
  type MemberIdentityProvisioner,
  IdentityUnavailableError,
  OidcProtocolError,
  SessionStore,
  UnconfiguredIdentityAdapter,
  type CreatedSession,
  type IdentityAdapter,
  type IdentityPrincipal,
  type SessionIdentity,
} from "@redi-control/identity";
import {
  InstallationApiService,
  PlatformOwnerService,
  WorkzoneProvisioningService,
  type InstallationPolicyService,
  type InstallationResolver,
  type ResolvedInstallation,
} from "@redi-control/installation";
import {
  metaConnectorManifest,
  tiktokConnectorManifest,
  youtubeConnectorManifest,
  type MediaLibraryService,
  type MetaReadOnlyCollectionService,
  type OAuthFoundationService,
  type SocialPublishingService,
} from "@redi-control/media-social";
import {
  BusinessSiteInformationConnector,
  businessSiteConnectionConfigurationSchema,
  businessSiteInformationManifest,
} from "@redi-control/website-control";
import {
  UnifiedContentService,
  contentDestinations,
  type ContentDestination,
} from "@redi-control/unified-content";
import {
  MediaIntelligenceService,
  WorkboardViewService,
} from "@redi-control/media-intelligence";
import { SourceIngestionService } from "@redi-control/source-ingestion";
import { EvidenceIntelligenceService } from "@redi-control/evidence-intelligence";
import { VideoIntelligenceService } from "@redi-control/video-intelligence";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { registerResearchRoutes } from "./research-routes.js";
import { registerSourceIngestionRoutes } from "./source-ingestion-routes.js";
import { registerEvidenceIntelligenceRoutes } from "./evidence-intelligence-routes.js";
import { registerModelStudioRoutes } from "./model-studio-routes.js";
import { registerPlatformOwnerRoutes } from "./platform-owner-routes.js";
import { registerServiceApiRoutes } from "./service-api-routes.js";
import { registerInstallationApiAdminRoutes } from "./installation-api-admin-routes.js";
import { registerWorkzoneProvisioningRoutes } from "./workzone-provisioning-routes.js";
import { registerWorkboardViewRoutes } from "./workboard-view-routes.js";
import { normalizePostLoginPath } from "./auth-redirect.js";
import { registerVideoIntelligenceRoutes } from "./video-intelligence-routes.js";

const SESSION_COOKIE = "redi_session";
const SECURE_SESSION_COOKIE = "__Host-redi_session";
const CSRF_COOKIE = "redi_csrf";
const IDENTITY_TRANSACTION_COOKIE = "redi_identity_tx";
const POST_LOGIN_REDIRECT_COOKIE = "redi_post_login";
const SECURE_POST_LOGIN_REDIRECT_COOKIE = "__Host-redi_post_login";
const FIRST_OWNER_INVITATION_COOKIE = "redi_first_owner_invitation";
const SECURE_FIRST_OWNER_INVITATION_COOKIE =
  "__Host-redi_first_owner_invitation";
const memberInvitationRoles = ["approver", "editor", "analyst"] as const;
const websiteScopes = businessSiteInformationManifest.scopes.map(
  (scope) => scope.id,
);
const uuidProperty = { type: "string", format: "uuid" } as const;
const contentMediaProperty = {
  type: "array",
  maxItems: 20,
  uniqueItems: true,
  items: uuidProperty,
} as const;
const websiteBodyProperty = {
  type: "object",
  additionalProperties: false,
  required: ["version", "blocks"],
  properties: {
    version: { const: 1 },
    blocks: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["type"],
        properties: {
          type: { enum: ["paragraph", "heading", "list", "quote"] },
        },
      },
    },
  },
} as const;
const websiteDraftCopyProperties = {
  slug: {
    type: "string",
    maxLength: 180,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  },
  title: { type: "string", minLength: 1, maxLength: 240 },
  excerpt: { type: "string", maxLength: 1000 },
  bodyText: { type: "string", minLength: 1, maxLength: 50000 },
  mediaAssetIds: contentMediaProperty,
} as const;

export interface AppDatabase {
  readonly runtime: DatabasePool;
  readonly auth: DatabasePool;
}

export interface BuildAppOptions {
  readonly database?: AppDatabase;
  readonly identity?: IdentityAdapter;
  readonly cookieSecure?: boolean;
  readonly publicApiUrl?: string;
  readonly publicWebUrl?: string;
  readonly localDemoEnabled?: boolean;
  readonly referenceConnector?: ReferenceConnector;
  readonly businessSiteConnector?: BusinessSiteInformationConnector;
  readonly connectorSecretProvider?: SecretProvider;
  readonly mediaLibrary?: MediaLibraryService;
  readonly socialOAuth?: OAuthFoundationService;
  /** Optional Meta Business Login configuration for selected business assets. */
  readonly metaBusinessLoginConfigurationId?: string;
  readonly metaReadCollection?: MetaReadOnlyCollectionService;
  readonly socialPublishing?: SocialPublishingService;
  readonly installationResolver?: InstallationResolver;
  readonly installationPolicies?: InstallationPolicyService;
  readonly expectedMigrationCount?: number;
  readonly storageReadiness?: () => Promise<boolean>;
  readonly identityReadiness?: () => Promise<boolean>;
  readonly memberIdentityProvisioner?: MemberIdentityProvisioner;
  readonly criticalConfigurationReady?: boolean;
  readonly aiProviders?: readonly AiProvider[];
}

interface AuthContext {
  readonly session: SessionIdentity;
  readonly actor: RequestActor;
  readonly token: string;
}

function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}

function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

function firstOwnerInvitationCookieName(secure: boolean): string {
  return secure
    ? SECURE_FIRST_OWNER_INVITATION_COOKIE
    : FIRST_OWNER_INVITATION_COOKIE;
}

function firstOwnerInvitationCookiePath(secure: boolean): string {
  return secure ? "/" : "/auth/callback";
}

function postLoginRedirectCookieName(secure: boolean): string {
  return secure
    ? SECURE_POST_LOGIN_REDIRECT_COOKIE
    : POST_LOGIN_REDIRECT_COOKIE;
}

function clearPostLoginRedirectCookie(
  reply: FastifyReply,
  secure: boolean,
): void {
  reply.clearCookie(postLoginRedirectCookieName(secure), {
    path: secure ? "/" : "/auth/callback",
    secure,
  });
}

function clearIdentityFlowCookies(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(IDENTITY_TRANSACTION_COOKIE, {
    path: "/auth/callback",
    secure,
  });
  reply.clearCookie(firstOwnerInvitationCookieName(secure), {
    path: firstOwnerInvitationCookiePath(secure),
    secure,
  });
  clearPostLoginRedirectCookie(reply, secure);
}

function setSessionCookies(
  reply: FastifyReply,
  session: CreatedSession,
  secure: boolean,
): void {
  reply.setCookie(sessionCookieName(secure), session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: session.absoluteExpires,
  });
  reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    path: "/",
    secure,
    expires: session.absoluteExpires,
  });
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(sessionCookieName(secure), { path: "/", secure });
  reply.clearCookie(CSRF_COOKIE, { path: "/", secure });
}

async function insertAuditAndOutbox(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id, tenant_id, actor_user_id, action, target_type, target_id, correlation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.correlationId,
      input.metadata ?? {},
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events
     (id, tenant_id, event_type, event_version, payload, correlation_id)
     VALUES ($1, $2, $3, 1, $4, $5)`,
    [
      randomUUID(),
      input.tenantId,
      input.action,
      { auditEventId: auditId },
      input.correlationId,
    ],
  );
}

async function recordCriticalEvent(
  database: AppDatabase,
  input: Parameters<typeof insertAuditAndOutbox>[1],
): Promise<void> {
  await withTenant(database.runtime, input.tenantId, async (client) =>
    insertAuditAndOutbox(client, input),
  );
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      serializers: {
        req: (request) => ({
          method: request.method,
          // OAuth codes and signed state are transient credentials. Log only
          // the path, never query strings from identity/provider callbacks.
          url: request.url.split("?")[0] ?? "",
          host: request.headers.host ?? "",
          remoteAddress: request.ip,
        }),
      },
    },
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
    genReqId: (request) => {
      const incoming = request.headers["x-correlation-id"];
      return typeof incoming === "string" &&
        /^[a-zA-Z0-9._-]{8,128}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
  });
  const database = options.database;
  const identity = options.identity ?? new UnconfiguredIdentityAdapter();
  const cookieSecure =
    options.cookieSecure ?? process.env.NODE_ENV === "production";
  const apiUrl = options.publicApiUrl ?? "http://127.0.0.1:3001";
  const webUrl = options.publicWebUrl ?? "http://127.0.0.1:3000";
  const localDemoWebOrigin = (() => {
    if (!options.localDemoEnabled) return null;
    const url = new URL(webUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Local demonstration redirects require a loopback web origin",
      );
    return url.origin;
  })();
  const sessions = database ? new SessionStore(database.auth) : null;
  const firstOwnerInvitations = database
    ? new FirstOwnerInvitationStore(database.auth)
    : null;
  const memberInvitations = database
    ? new MemberInvitationStore(database.runtime)
    : null;
  const memberIdentityProvisioner = options.memberIdentityProvisioner;
  const referenceConnector =
    options.referenceConnector ?? new ReferenceConnector();
  const businessSiteConnector =
    options.businessSiteConnector ?? new BusinessSiteInformationConnector();
  const connectorRuntime = database
    ? new ConnectorRuntime(
        new PostgresConnectorRuntimeStore(database.runtime),
        options.connectorSecretProvider ?? new InMemorySecretProvider(),
        "0.2.0",
      )
    : null;
  const mediaLibrary = options.mediaLibrary;
  const socialOAuth = options.socialOAuth;
  const metaBusinessLoginConfigurationId =
    options.metaBusinessLoginConfigurationId;
  const metaReadCollection = options.metaReadCollection;
  const socialPublishing = options.socialPublishing;
  const unifiedContent = database
    ? new UnifiedContentService(database.runtime)
    : null;
  const mediaIntelligence = database
    ? new MediaIntelligenceService(database.runtime)
    : null;
  const sourceIngestion = database
    ? new SourceIngestionService(database.runtime, {
        secretProvider:
          options.connectorSecretProvider ?? new InMemorySecretProvider(),
      })
    : null;
  const evidenceIntelligence = database
    ? new EvidenceIntelligenceService(
        database.runtime,
        new AiGateway(options.aiProviders ?? []),
        unifiedContent!,
      )
    : null;
  const installationResolver = options.installationResolver;
  const installationPolicies = options.installationPolicies;
  const platformOwner = database
    ? new PlatformOwnerService(database.runtime)
    : null;
  const installationApi = database
    ? new InstallationApiService(database.runtime)
    : null;
  const workzoneProvisioning = database
    ? new WorkzoneProvisioningService(database.runtime)
    : null;
  const workboardViews = database
    ? new WorkboardViewService(database.runtime)
    : null;
  const videoIntelligence = database
    ? new VideoIntelligenceService(database.runtime)
    : null;

  async function resolveInstallation(
    request: FastifyRequest,
  ): Promise<ResolvedInstallation> {
    if (!installationResolver)
      throw Object.assign(new Error("Installation resolution unavailable"), {
        statusCode: 503,
      });
    const forwarded = request.headers["x-forwarded-host"];
    if (forwarded && forwarded !== request.headers.host)
      throw Object.assign(new Error("FORWARDED_HOST_MISMATCH"), {
        statusCode: 421,
      });
    return installationResolver.resolve(request.headers.host ?? "");
  }

  app.addHook("onReady", async () => {
    if (connectorRuntime) {
      await connectorRuntime.register(referenceConnector);
      await connectorRuntime.register(businessSiteConnector);
    }
  });

  app.addHook("onRequest", async (request) => {
    if (
      installationResolver &&
      !request.url.startsWith("/health/") &&
      !request.url.startsWith("/api/v1/")
    )
      await resolveInstallation(request);
  });

  void app.register(cookie);
  void app.register(formBody, { bodyLimit: 1024 });
  void app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });

  app.addHook("onSend", async (request, reply) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("x-frame-options", "DENY")
      .header("referrer-policy", "no-referrer")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=()")
      .header(
        "content-security-policy",
        request.method === "GET" &&
          request.url === "/auth/local-demo" &&
          localDemoWebOrigin
          ? `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${localDemoWebOrigin}; frame-ancestors 'none'; base-uri 'none'`
          : request.method === "GET" &&
              (request.url === "/auth/bootstrap" ||
                request.url === "/auth/local-demo")
            ? "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
            : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
      .header("cache-control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      { err: error, correlationId: request.id },
      "request failed",
    );
    const candidateStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof candidateStatus === "number" && candidateStatus >= 400
        ? candidateStatus
        : 500;
    const message = error instanceof Error ? error.message : "Request failed";
    void reply.code(status).send({
      error: status >= 500 ? "Internal server error" : message,
      correlationId: request.id,
    });
  });

  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthContext | null> {
    if (!sessions) {
      await reply.code(503).send({
        error: "Database is not configured",
        correlationId: request.id,
      });
      return null;
    }
    const token = request.cookies[sessionCookieName(cookieSecure)];
    if (!token) {
      await reply
        .code(401)
        .send({ error: "Authentication required", correlationId: request.id });
      return null;
    }
    let session = await sessions.resolve(token);
    if (!session) {
      clearSessionCookies(reply, cookieSecure);
      await reply.code(401).send({
        error: "Session expired or revoked",
        correlationId: request.id,
      });
      return null;
    }
    let currentToken = token;
    if (session.rotationDue.getTime() <= Date.now()) {
      const replacement = await sessions.rotate(token);
      if (!replacement) {
        await reply.code(401).send({
          error: "Session rotation failed",
          correlationId: request.id,
        });
        return null;
      }
      setSessionCookies(reply, replacement, cookieSecure);
      session = replacement;
      currentToken = replacement.token;
    }
    const actor: RequestActor = {
      userId: session.userId as RequestActor["userId"],
      tenantId: session.tenantId as RequestActor["tenantId"],
      roles: session.roles.filter(isRole),
    };
    return { session, actor, token: currentToken };
  }

  async function authorize(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: Permission,
    checks: { csrf?: boolean; mfa?: boolean } = {},
  ): Promise<AuthContext | null> {
    const context = await authenticate(request, reply);
    if (!context) return null;
    if (!hasPermission(context.actor, permission)) {
      await reply
        .code(403)
        .send({ error: "Permission denied", correlationId: request.id });
      return null;
    }
    if (checks.mfa && !context.session.mfaVerified) {
      await reply
        .code(403)
        .send({ error: "MFA is required", correlationId: request.id });
      return null;
    }
    if (checks.csrf) {
      const supplied = request.headers["x-csrf-token"];
      if (
        typeof supplied !== "string" ||
        !(await sessions?.verifyCsrf(context.session.sessionId, supplied))
      ) {
        await reply
          .code(403)
          .send({ error: "CSRF validation failed", correlationId: request.id });
        return null;
      }
    }
    return context;
  }

  async function authorizePlatformOwner(
    request: FastifyRequest,
    reply: FastifyReply,
    mutation: boolean,
  ): Promise<AuthContext | null> {
    const context = await authenticate(request, reply);
    if (!context) return null;
    if (!context.session.roles.includes("root_owner")) {
      await reply.code(403).send({
        error: "Root Owner permission required",
        correlationId: request.id,
      });
      return null;
    }
    if (!(await sessions?.hasRecentMfa(context.session.sessionId, 5))) {
      await reply
        .code(403)
        .send({ error: "Recent MFA is required", correlationId: request.id });
      return null;
    }
    if (mutation) {
      const supplied = request.headers["x-csrf-token"];
      if (
        typeof supplied !== "string" ||
        !(await sessions?.verifyCsrf(context.session.sessionId, supplied))
      ) {
        await reply
          .code(403)
          .send({ error: "CSRF validation failed", correlationId: request.id });
        return null;
      }
    }
    return context;
  }

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ingress", async (_request, reply) => {
    if (!database)
      return reply
        .code(503)
        .send({ status: "not_ready", checks: { database: "unconfigured" } });
    try {
      const result = await database.runtime.query<{ migrations: number }>(
        "SELECT count(*)::int AS migrations FROM control.schema_migrations",
      );
      const migrations = result.rows[0]?.migrations ?? 0;
      const storage = options.storageReadiness
        ? await options.storageReadiness().catch(() => false)
        : true;
      return migrations >= (options.expectedMigrationCount ?? 9) && storage
        ? {
            status: "ready",
            checks: { database: "ok", migrations, storage: "ok" },
          }
        : reply.code(503).send({
            status: "not_ready",
            checks: {
              database: "ok",
              migrations,
              storage: storage ? "ok" : "unavailable",
            },
          });
    } catch {
      return reply
        .code(503)
        .send({ status: "not_ready", checks: { database: "unavailable" } });
    }
  });
  app.get("/health/ready", async (_request, reply) => {
    if (!database)
      return reply
        .code(503)
        .send({ status: "not_ready", checks: { database: "unconfigured" } });
    try {
      const result = await database.runtime.query<{ migrations: number }>(
        "SELECT count(*)::int AS migrations FROM control.schema_migrations",
      );
      const migrations = result.rows[0]?.migrations ?? 0;
      const storage = options.storageReadiness
        ? await options.storageReadiness().catch(() => false)
        : true;
      const identityReady = options.identityReadiness
        ? await options.identityReadiness().catch(() => false)
        : true;
      const configuration = options.criticalConfigurationReady !== false;
      return migrations >= (options.expectedMigrationCount ?? 9) &&
        storage &&
        identityReady &&
        configuration
        ? {
            status: "ready",
            checks: {
              database: "ok",
              migrations,
              storage: "ok",
              identity: "ok",
              configuration: "ok",
            },
          }
        : reply.code(503).send({
            status: "not_ready",
            checks: {
              database: "ok",
              migrations,
              storage: storage ? "ok" : "unavailable",
              identity: identityReady ? "ok" : "unavailable",
              configuration: configuration ? "ok" : "invalid",
            },
          });
    } catch {
      return reply
        .code(503)
        .send({ status: "not_ready", checks: { database: "unavailable" } });
    }
  });

  app.get<{ Querystring: { returnTo?: unknown } }>(
    "/auth/login",
    async (request, reply) => {
      try {
        const result = await identity.begin({
          redirectUri: `${apiUrl}/auth/callback`,
        });
        reply.setCookie(IDENTITY_TRANSACTION_COOKIE, result.transaction, {
          httpOnly: true,
          sameSite: "lax",
          secure: cookieSecure,
          path: "/auth/callback",
          maxAge: 600,
        });
        const postLoginPath = normalizePostLoginPath(request.query.returnTo);
        if (postLoginPath === "/")
          clearPostLoginRedirectCookie(reply, cookieSecure);
        else
          reply.setCookie(
            postLoginRedirectCookieName(cookieSecure),
            postLoginPath,
            {
              httpOnly: true,
              sameSite: "lax",
              secure: cookieSecure,
              path: cookieSecure ? "/" : "/auth/callback",
              maxAge: 600,
            },
          );
        return reply.redirect(result.authorizationUrl);
      } catch (error) {
        if (error instanceof IdentityUnavailableError)
          return reply.code(503).send({ error: error.message });
        throw error;
      }
    },
  );

  app.get("/auth/bootstrap", (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>First owner setup</title>
  <style>
    :root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#09090b;color:#fafafa}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(100%,520px);padding:36px;border:1px solid #303036;border-radius:20px;background:#151518;box-shadow:0 24px 80px #0008}
    p{color:#b4b4bc;line-height:1.6}label{display:block;margin:28px 0 9px;font-weight:700}
    input,button{width:100%;min-height:50px;border-radius:12px;font:inherit}
    input{border:1px solid #414148;background:#0d0d10;color:#fff;padding:0 14px}
    button{margin-top:16px;border:0;background:#ed2f2f;color:#fff;font-weight:800;cursor:pointer}
    small{display:block;margin-top:18px;color:#85858e;line-height:1.5}
  </style>
</head>
<body><main>
  <h1>Activate the first owner</h1>
  <p>Enter the single-use invitation supplied by your deployment operator. You will continue to the configured identity provider and MFA.</p>
  <form method="post" action="/auth/bootstrap">
    <label for="token">Invitation token</label>
    <input id="token" name="token" type="password" required minlength="43" maxlength="43" pattern="[A-Za-z0-9_-]{43}" autocomplete="off" spellcheck="false">
    <button type="submit">Continue securely</button>
  </form>
  <small>The invitation is installation-bound, expires automatically and can be used only once.</small>
</main></body></html>`),
  );

  if (options.localDemoEnabled) {
    app.get("/auth/local-demo", (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open local REDI CONTROL demo</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#f7f7f8;font:16px/1.5 system-ui;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,520px);padding:36px;border:1px solid #303036;border-radius:20px;background:#151518;box-shadow:0 24px 80px #0008}
p{color:#b4b4bc;line-height:1.6}label{display:block;margin:28px 0 9px;font-weight:700}input,button{width:100%;min-height:50px;border-radius:12px;font:inherit}
input{border:1px solid #414148;background:#0d0d10;color:#fff;padding:0 14px}button{margin-top:16px;border:0;background:#ed2f2f;color:#fff;font-weight:800;cursor:pointer}
small{display:block;margin-top:18px;color:#85858e;line-height:1.5}</style></head><body><main>
<h1>Open the local media demo</h1><p>This isolated demo uses synthetic editorial data and no external provider connection.</p>
<form method="post" action="/auth/local-demo"><label for="token">One-time local token</label>
<input id="token" name="token" type="password" required minlength="43" maxlength="43" pattern="[A-Za-z0-9_-]{43}" autocomplete="off" spellcheck="false">
<button type="submit">Enter demo securely</button></form>
<small>The token expires within 15 minutes and can be used only once. This route cannot be enabled outside loopback-only local mode.</small>
</main></body></html>`),
    );

    app.post<{ Body: { token: string } }>(
      "/auth/local-demo",
      {
        config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["token"],
            properties: {
              token: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
            },
          },
        },
      },
      async (request, reply) => {
        if (!sessions || !database)
          return reply.code(503).send({ error: "Database is not configured" });
        try {
          const session = await sessions.createLocalDemo(request.body.token);
          try {
            await recordCriticalEvent(database, {
              tenantId: session.tenantId,
              actorUserId: session.userId,
              action: "session.local_demo_created",
              targetType: "session",
              targetId: session.sessionId,
              correlationId: request.id,
              metadata: { syntheticData: true, mfaVerified: true },
            });
          } catch (error) {
            await sessions.revoke(session.token);
            throw error;
          }
          setSessionCookies(reply, session, cookieSecure);
          return reply.redirect(
            new URL("/sq/showcase", webUrl).toString(),
            303,
          );
        } catch (error) {
          if (!(error instanceof LocalDemoBootstrapError)) throw error;
          const existingToken =
            request.cookies[sessionCookieName(cookieSecure)];
          if (existingToken && (await sessions.resolve(existingToken))) {
            return reply.redirect(
              new URL("/sq/showcase", webUrl).toString(),
              303,
            );
          }
          return reply.code(403).send({ error: error.message });
        }
      },
    );
  }

  app.post<{ Body: { token: string } }>(
    "/auth/bootstrap",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{43}$",
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!firstOwnerInvitations)
        return reply.code(503).send({ error: "Database is not configured" });
      clearPostLoginRedirectCookie(reply, cookieSecure);
      const installation = await resolveInstallation(request);
      if (
        !(await firstOwnerInvitations.isUsable(
          request.body.token,
          installation.installationId,
        ))
      )
        return reply
          .code(403)
          .send({ error: "First-owner invitation is invalid or unavailable" });
      try {
        const result = await identity.begin({
          redirectUri: `${apiUrl}/auth/callback`,
        });
        reply.setCookie(IDENTITY_TRANSACTION_COOKIE, result.transaction, {
          httpOnly: true,
          sameSite: "lax",
          secure: cookieSecure,
          path: "/auth/callback",
          maxAge: 600,
        });
        reply.setCookie(
          firstOwnerInvitationCookieName(cookieSecure),
          request.body.token,
          {
            httpOnly: true,
            sameSite: "lax",
            secure: cookieSecure,
            path: firstOwnerInvitationCookiePath(cookieSecure),
            maxAge: 600,
          },
        );
        return reply.redirect(result.authorizationUrl);
      } catch (error) {
        if (error instanceof IdentityUnavailableError)
          return reply.code(503).send({ error: error.message });
        throw error;
      }
    },
  );

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      if (!sessions || !database)
        return reply.code(503).send({ error: "Database is not configured" });
      const transaction = request.cookies[IDENTITY_TRANSACTION_COOKIE];
      const postLoginPath = normalizePostLoginPath(
        request.cookies[postLoginRedirectCookieName(cookieSecure)],
      );
      if (!request.query.code || !request.query.state || !transaction) {
        clearIdentityFlowCookies(reply, cookieSecure);
        return reply.code(400).send({ error: "Invalid identity callback" });
      }
      let principal: IdentityPrincipal;
      try {
        principal = await identity.complete({
          code: request.query.code,
          state: request.query.state,
          redirectUri: `${apiUrl}/auth/callback`,
          transaction,
        });
      } catch (error) {
        if (!(error instanceof OidcProtocolError)) throw error;
        clearIdentityFlowCookies(reply, cookieSecure);
        return reply
          .code(400)
          .send({ error: "Identity authentication failed" });
      }
      if (!principal.emailVerified)
        return reply.code(403).send({ error: "Verified email is required" });
      const invitationToken =
        request.cookies[firstOwnerInvitationCookieName(cookieSecure)];
      let session: CreatedSession;
      try {
        if (invitationToken) {
          const installation = await resolveInstallation(request);
          session = await sessions.createFirstOwner(
            principal,
            invitationToken,
            installation.installationId,
            request.id,
          );
        } else {
          const installation = await resolveInstallation(request);
          try {
            session = await sessions.createMemberFromInvitation(
              principal,
              installation.installationId,
              request.id,
            );
          } catch (error) {
            if (!(error instanceof MemberInvitationError)) throw error;
            session = await sessions.create(principal);
          }
        }
      } catch (error) {
        if (!(error instanceof FirstOwnerInvitationError)) throw error;
        clearIdentityFlowCookies(reply, cookieSecure);
        return reply.code(403).send({ error: error.message });
      }
      setSessionCookies(reply, session, cookieSecure);
      clearIdentityFlowCookies(reply, cookieSecure);
      await recordCriticalEvent(database, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "session.created",
        targetType: "session",
        targetId: session.sessionId,
        correlationId: request.id,
        metadata: {
          identityProvider: identity.id,
          mfaVerified: session.mfaVerified,
        },
      });
      return reply.redirect(postLoginPath, 303);
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    if (!sessions || !database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "platform:read", {
      csrf: true,
    });
    if (!context) return;
    await sessions.revoke(context.token);
    clearSessionCookies(reply, cookieSecure);
    await recordCriticalEvent(database, {
      tenantId: context.session.tenantId,
      actorUserId: context.session.userId,
      action: "session.revoked",
      targetType: "session",
      targetId: context.session.sessionId,
      correlationId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const context = await authenticate(request, reply);
    if (!context) return;
    return {
      userId: context.session.userId,
      tenantId: context.session.tenantId,
      roles: context.session.roles,
    };
  });

  app.post<{ Body: { tenantId: string } }>(
    "/api/session/tenant",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId"],
          properties: { tenantId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!sessions || !database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      const replacement = await sessions.rotate(
        context.token,
        request.body.tenantId,
      );
      if (!replacement)
        return reply.code(403).send({ error: "Tenant membership not found" });
      setSessionCookies(reply, replacement, cookieSecure);
      await recordCriticalEvent(database, {
        tenantId: context.session.tenantId,
        actorUserId: context.session.userId,
        action: "session.tenant_switched",
        targetType: "tenant",
        targetId: request.body.tenantId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.get("/api/audit", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "audit:read");
    if (!context) return;
    return withTenant(
      database.runtime,
      context.session.tenantId,
      async (client) => {
        const result = await client.query(
          `SELECT id, action, target_type, target_id, occurred_at, correlation_id, metadata
         FROM control.audit_events ORDER BY occurred_at DESC LIMIT 100`,
        );
        return { events: result.rows };
      },
    );
  });

  app.get("/api/features", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    return withTenant(
      database.runtime,
      context.session.tenantId,
      async (client) => {
        const result = await client.query(
          "SELECT name, enabled, configuration FROM control.feature_flags ORDER BY name",
        );
        return { features: result.rows };
      },
    );
  });

  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/dashboard/overview",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const workspace = await client.query<{
            id: string;
            name: string;
          }>(
            `SELECT id, name FROM control.business_workspaces
             WHERE id = coalesce(
               $1::uuid,
               (SELECT id FROM control.business_workspaces ORDER BY created_at, id LIMIT 1)
             )`,
            [request.query.workspaceId ?? null],
          );
          const current = workspace.rows[0];
          if (!current)
            return reply.code(404).send({ error: "Workspace not found" });

          const media = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM control.media_assets
             WHERE workspace_id = $1 AND status = 'ready'`,
            [current.id],
          );
          const accounts = await client.query<{
            count: number;
            healthy: number;
          }>(
            `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE status = 'active' AND health_status = 'healthy')::int AS healthy
             FROM control.social_accounts WHERE workspace_id = $1`,
            [current.id],
          );
          const drafts = await client.query<{
            draft: number;
            scheduled: number;
          }>(
            `SELECT count(*) FILTER (WHERE status = 'draft')::int AS draft,
              count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled
             FROM control.social_drafts WHERE workspace_id = $1`,
            [current.id],
          );
          const approvals = await client.query<{ pending: number }>(
            `SELECT count(*)::int AS pending
             FROM control.social_approvals approval
             JOIN control.social_drafts draft ON draft.id = approval.draft_id
             WHERE draft.workspace_id = $1 AND approval.decision = 'pending'`,
            [current.id],
          );
          const websiteChannels = await client.query<{
            status: string;
            health_status: string;
          }>(
            `SELECT connection.status::text, connection.health_status::text
             FROM control.platform_connections connection
             JOIN control.connector_versions version
               ON version.connector_id = connection.connector_id
              AND version.connector_version = connection.connector_version
             JOIN control.platform_definitions platform
               ON platform.id = version.platform_id
             WHERE connection.workspace_id = $1 AND platform.category = 'website'
             ORDER BY connection.created_at DESC LIMIT 1`,
            [current.id],
          );
          const socialChannels = await client.query<{
            account_type: string;
            status: string;
            health_status: string;
          }>(
            `SELECT account_type::text, status::text, health_status::text
             FROM control.social_accounts WHERE workspace_id = $1
             ORDER BY created_at DESC`,
            [current.id],
          );
          const website = websiteChannels.rows[0];
          const social = new Map(
            socialChannels.rows.map((account) => [
              account.account_type,
              account,
            ]),
          );
          const channel = (
            name:
              | "website"
              | "facebook"
              | "instagram"
              | "tiktok"
              | "email"
              | "whatsapp",
            connection?: { status: string; health_status: string },
          ) => ({
            name,
            status: connection
              ? connection.status === "active" &&
                connection.health_status === "healthy"
                ? "connected"
                : "needs_attention"
              : name === "tiktok" || name === "whatsapp"
                ? "planned"
                : "not_connected",
          });
          const activity = await client.query<{
            action: string;
            occurred_at: string;
          }>(
            `SELECT action, occurred_at FROM control.audit_events
             ORDER BY occurred_at DESC LIMIT 10`,
          );

          return {
            workspace: { id: current.id, displayName: current.name },
            counts: {
              readyMedia: media.rows[0]?.count ?? 0,
              socialAccounts: accounts.rows[0]?.count ?? 0,
              healthySocialAccounts: accounts.rows[0]?.healthy ?? 0,
              draftPosts: drafts.rows[0]?.draft ?? 0,
              scheduledPosts: drafts.rows[0]?.scheduled ?? 0,
              pendingApprovals: approvals.rows[0]?.pending ?? 0,
            },
            channels: [
              channel("website", website),
              channel("facebook", social.get("facebook_page")),
              channel("instagram", social.get("instagram_account")),
              channel("tiktok"),
              channel("email"),
              channel("whatsapp"),
            ],
            activity: activity.rows.map((event) => ({
              action: event.action,
              occurredAt: event.occurred_at,
            })),
          };
        },
      );
    },
  );

  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/workzone/overview",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const workspace = await client.query<{ id: string; name: string }>(
            `SELECT id, name FROM control.business_workspaces
             WHERE id = coalesce(
               $1::uuid,
               (SELECT id FROM control.business_workspaces ORDER BY created_at, id LIMIT 1)
             )`,
            [request.query.workspaceId ?? null],
          );
          const current = workspace.rows[0];
          if (!current)
            return reply.code(404).send({ error: "Workspace not found" });

          const counts = await client.query<{
            research_cases: number;
            content_drafts: number;
            review_queue: number;
            scheduled: number;
            delivery_exceptions: number;
            ready_media: number;
            team_members: number;
          }>(
            `SELECT
              (SELECT count(*)::int FROM control.research_cases
                WHERE workspace_id = $1 AND status IN ('open','researching')) AS research_cases,
              (SELECT count(*)::int FROM control.content_items
                WHERE workspace_id = $1 AND status = 'draft') AS content_drafts,
              (SELECT count(*)::int FROM control.social_approvals approval
                JOIN control.social_drafts draft ON draft.id = approval.draft_id
                WHERE draft.workspace_id = $1 AND approval.decision = 'pending') AS review_queue,
              (SELECT count(*)::int FROM control.social_drafts
                WHERE workspace_id = $1 AND status = 'scheduled') AS scheduled,
              (SELECT count(*)::int FROM control.social_drafts
                WHERE workspace_id = $1
                  AND status IN ('partial','failed','retry_scheduled','needs_reauthorization')) AS delivery_exceptions,
              (SELECT count(*)::int FROM control.media_assets
                WHERE workspace_id = $1 AND status = 'ready') AS ready_media,
              (SELECT count(DISTINCT user_id)::int FROM control.memberships) AS team_members`,
            [current.id],
          );
          const summary = counts.rows[0];

          const websiteChannels = await client.query<{
            status: string;
            health_status: string;
          }>(
            `SELECT connection.status::text, connection.health_status::text
             FROM control.platform_connections connection
             JOIN control.connector_versions version
               ON version.connector_id = connection.connector_id
              AND version.connector_version = connection.connector_version
             JOIN control.platform_definitions platform
               ON platform.id = version.platform_id
             WHERE connection.workspace_id = $1 AND platform.category = 'website'
             ORDER BY connection.created_at DESC LIMIT 1`,
            [current.id],
          );
          const socialChannels = await client.query<{
            account_type: string;
            status: string;
            health_status: string;
          }>(
            `SELECT account_type::text, status::text, health_status::text
             FROM control.social_accounts WHERE workspace_id = $1
             ORDER BY created_at DESC`,
            [current.id],
          );
          const modelRoutes = await client.query<{
            operation: string;
            model: string;
            prompt_version: string;
            max_output_tokens: number;
            enabled: boolean;
          }>(
            `SELECT operation, model, prompt_version, max_output_tokens, enabled
             FROM control.ai_model_routes WHERE workspace_id = $1
             ORDER BY operation`,
            [current.id],
          );

          const social = new Map(
            socialChannels.rows.map((account) => [
              account.account_type,
              account,
            ]),
          );
          const channel = (
            name: "website" | "facebook" | "instagram" | "youtube" | "tiktok",
            connection?: { status: string; health_status: string },
          ) => ({
            name,
            status: connection
              ? connection.status === "active" &&
                connection.health_status === "healthy"
                ? "connected"
                : "needs_attention"
              : name === "youtube" || name === "tiktok"
                ? "planned"
                : "not_connected",
          });

          return {
            workspace: { id: current.id, displayName: current.name },
            pipeline: {
              research: summary?.research_cases ?? 0,
              drafting: summary?.content_drafts ?? 0,
              review: summary?.review_queue ?? 0,
              scheduled: summary?.scheduled ?? 0,
              deliveryExceptions: summary?.delivery_exceptions ?? 0,
            },
            resources: {
              readyMedia: summary?.ready_media ?? 0,
              teamMembers: summary?.team_members ?? 0,
            },
            channels: [
              channel("website", websiteChannels.rows[0]),
              channel("facebook", social.get("facebook_page")),
              channel("instagram", social.get("instagram_account")),
              channel("youtube", social.get("youtube_channel")),
              channel("tiktok", social.get("tiktok_account")),
            ],
            models: {
              externalExecutionAvailable: false,
              routes: modelRoutes.rows.map((route) => ({
                operation: route.operation,
                model: route.model,
                promptVersion: route.prompt_version,
                maxOutputTokens: route.max_output_tokens,
                enabled: route.enabled,
              })),
            },
          };
        },
      );
    },
  );

  app.get<{ Querystring: { workspaceId?: string; limit?: number } }>(
    "/api/workzone/stories",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const workspace = await client.query<{ id: string; name: string }>(
            `SELECT id, name FROM control.business_workspaces
             WHERE id = coalesce(
               $1::uuid,
               (SELECT id FROM control.business_workspaces ORDER BY created_at, id LIMIT 1)
             )`,
            [request.query.workspaceId ?? null],
          );
          const current = workspace.rows[0];
          if (!current)
            return reply.code(404).send({ error: "Workspace not found" });

          type Destination = {
            destination: "website" | "facebook" | "instagram";
            status: string;
            currentRevision: number;
            pendingReview: boolean;
          };
          type StoryRow = {
            record_kind: "research" | "content";
            research_case_id: string | null;
            content_item_id: string | null;
            title: string;
            summary: string;
            research_status: string | null;
            content_status: string | null;
            freshness_at: Date | null;
            source_count: number;
            claim_count: number;
            verified_claim_count: number;
            destinations: Destination[];
            updated_at: Date;
            assignment_id: string | null;
            assignee_user_id: string | null;
            assignee_email: string | null;
            assignment_priority: "normal" | "high" | "urgent" | null;
            assignment_due_at: Date | null;
            assignment_note: string | null;
          };
          const result = await client.query<StoryRow>(
            `WITH research_metrics AS (
               SELECT research.id,research.title,research.topic,research.status,
                 research.freshness_at,research.updated_at,
                 count(DISTINCT source.id)::int AS source_count,
                 count(DISTINCT claim.id)::int AS claim_count,
                 count(DISTINCT claim.id) FILTER (
                   WHERE claim.verification_state IN ('verified','partially_verified')
                 )::int AS verified_claim_count
               FROM control.research_cases research
               LEFT JOIN control.research_case_sources source
                 ON source.research_case_id=research.id
               LEFT JOIN control.research_claims claim
                 ON claim.research_case_id=research.id
               WHERE research.workspace_id=$1 AND research.status<>'archived'
               GROUP BY research.id
             ), promotion_links AS (
               SELECT candidate.research_case_id,candidate.content_item_id,
                 candidate.updated_at AS linked_at
               FROM control.editorial_candidates candidate
               WHERE candidate.workspace_id=$1 AND candidate.content_item_id IS NOT NULL
               UNION ALL
               SELECT promotion.research_case_id,promotion.content_item_id,
                 promotion.promoted_at AS linked_at
               FROM control.synthesis_promotions promotion
               WHERE promotion.workspace_id=$1
               UNION ALL
               SELECT draft.research_case_id,promotion.content_item_id,
                 promotion.promoted_at AS linked_at
               FROM control.editorial_draft_promotions promotion
               JOIN control.editorial_drafts draft ON draft.id=promotion.editorial_draft_id
               WHERE promotion.workspace_id=$1
             ), content_link AS (
               SELECT DISTINCT ON (content_item_id)
                 content_item_id,research_case_id
               FROM promotion_links
               ORDER BY content_item_id,linked_at DESC,research_case_id
             ), variant_state AS (
               SELECT variant.content_item_id,
                 jsonb_agg(
                   jsonb_build_object(
                     'destination',variant.destination,
                     'status',coalesce(draft.status::text,variant.status),
                     'currentRevision',coalesce(draft.current_revision,variant.current_revision),
                     'pendingReview',EXISTS (
                       SELECT 1 FROM control.social_approvals approval
                       JOIN control.social_draft_revisions revision
                         ON revision.id=approval.revision_id
                       WHERE approval.draft_id=draft.id
                         AND revision.revision_number=draft.current_revision
                         AND approval.decision='pending'
                     )
                   ) ORDER BY variant.destination
                 ) AS destinations
               FROM control.content_item_variants variant
               LEFT JOIN control.social_drafts draft ON draft.id=variant.social_draft_id
               WHERE variant.workspace_id=$1
               GROUP BY variant.content_item_id
             ), content_stories AS (
               SELECT 'content'::text AS record_kind,
                 link.research_case_id,item.id AS content_item_id,
                 item.title,item.summary,
                 research.status AS research_status,item.status AS content_status,
                 research.freshness_at,
                 coalesce(research.source_count,0)::int AS source_count,
                 coalesce(research.claim_count,0)::int AS claim_count,
                 coalesce(research.verified_claim_count,0)::int AS verified_claim_count,
                 coalesce(variant.destinations,'[]'::jsonb) AS destinations,
                 greatest(item.updated_at,coalesce(research.updated_at,item.updated_at)) AS updated_at
               FROM control.content_items item
               LEFT JOIN content_link link ON link.content_item_id=item.id
               LEFT JOIN research_metrics research ON research.id=link.research_case_id
               LEFT JOIN variant_state variant ON variant.content_item_id=item.id
               WHERE item.workspace_id=$1 AND item.status<>'archived'
             ), unpromoted_research AS (
               SELECT 'research'::text AS record_kind,
                 research.id AS research_case_id,NULL::uuid AS content_item_id,
                 research.title,research.topic AS summary,
                 research.status AS research_status,NULL::text AS content_status,
                 research.freshness_at,research.source_count,research.claim_count,
                 research.verified_claim_count,'[]'::jsonb AS destinations,
                 research.updated_at
               FROM research_metrics research
               WHERE NOT EXISTS (
                 SELECT 1 FROM promotion_links link
                 WHERE link.research_case_id=research.id
               )
             )
             SELECT workboard.*,
               assignment.id AS assignment_id,
               assignment.assignee_user_id,
               assignee.email AS assignee_email,
               assignment.priority AS assignment_priority,
               assignment.due_at AS assignment_due_at,
               assignment.note AS assignment_note
             FROM (
               SELECT * FROM content_stories
               UNION ALL
               SELECT * FROM unpromoted_research
             ) workboard
             LEFT JOIN LATERAL (
               SELECT candidate.*
               FROM control.editorial_story_assignments candidate
               WHERE candidate.workspace_id=$1 AND (
                 (workboard.research_case_id IS NOT NULL
                   AND candidate.research_case_id=workboard.research_case_id)
                 OR (candidate.research_case_id IS NULL
                   AND workboard.content_item_id IS NOT NULL
                   AND candidate.content_item_id=workboard.content_item_id)
               )
               ORDER BY (candidate.research_case_id IS NOT NULL) DESC,
                 candidate.updated_at DESC
               LIMIT 1
             ) assignment ON true
             LEFT JOIN control.users assignee ON assignee.id=assignment.assignee_user_id
             ORDER BY workboard.updated_at DESC,
               coalesce(workboard.content_item_id,workboard.research_case_id) DESC
             LIMIT ($2 + 1)`,
            [current.id, request.query.limit ?? 80],
          );

          const stage = (row: StoryRow) => {
            const statuses = row.destinations.map(
              (destination) => destination.status,
            );
            if (
              row.research_status === "rejected" ||
              statuses.some((status) =>
                [
                  "partial",
                  "failed",
                  "retry_scheduled",
                  "needs_reauthorization",
                  "rejected",
                ].includes(status),
              )
            )
              return "attention" as const;
            if (
              statuses.length > 0 &&
              statuses.every((status) => status === "published")
            )
              return "done" as const;
            if (
              statuses.some((status) =>
                ["scheduled", "queued", "publishing"].includes(status),
              )
            )
              return "scheduled" as const;
            if (
              row.destinations.some(
                (destination) => destination.pendingReview,
              ) ||
              statuses.some((status) =>
                ["ready_for_review", "approved"].includes(status),
              )
            )
              return "review" as const;
            if (row.content_item_id) return "drafting" as const;
            if (
              row.research_status === "ready_for_review" ||
              row.research_status === "approved"
            )
              return "ready" as const;
            return "research" as const;
          };
          const priority = new Map([
            ["attention", 0],
            ["review", 1],
            ["ready", 2],
            ["drafting", 3],
            ["research", 4],
            ["scheduled", 5],
            ["done", 6],
          ]);
          const evaluatedAt = new Date();
          const dueSoonAt = evaluatedAt.getTime() + 24 * 60 * 60 * 1000;
          const assignmentPriority = new Map([
            ["urgent", 0],
            ["high", 1],
            ["normal", 2],
          ]);
          const operationalRank = (story: {
            stage: string;
            assignment: { dueState: string } | null;
          }) =>
            story.assignment?.dueState === "overdue"
              ? 0
              : story.stage === "attention"
                ? 1
                : story.assignment?.dueState === "due_soon"
                  ? 2
                  : 3;
          const boardLimit = request.query.limit ?? 80;
          const hasMoreStories = result.rows.length > boardLimit;
          type HandoffCheck =
            | "complete"
            | "pending"
            | "blocked"
            | "not_applicable";
          const deliveryHandoffBlockers = new Set([
            "partial",
            "failed",
            "retry_scheduled",
            "needs_reauthorization",
            "rejected",
          ]);
          const deriveHandoff = (input: {
            stage: ReturnType<typeof stage>;
            researchStatus: string | null;
            hasResearch: boolean;
            hasContent: boolean;
            hasAssignment: boolean;
            destinations: Destination[];
          }) => {
            const checks: Record<
              "ownership" | "evidence" | "content" | "review" | "delivery",
              HandoffCheck
            > = {
              ownership:
                input.hasAssignment || input.stage === "done"
                  ? "complete"
                  : "pending",
              evidence: !input.hasResearch
                ? "not_applicable"
                : input.researchStatus === "rejected"
                  ? "blocked"
                  : ["approved", "promoted"].includes(
                        input.researchStatus ?? "",
                      )
                    ? "complete"
                    : "pending",
              content:
                input.hasContent || input.stage === "done"
                  ? "complete"
                  : "pending",
              review: ["scheduled", "done"].includes(input.stage)
                ? "complete"
                : input.destinations.some(
                      (destination) => destination.status === "rejected",
                    )
                  ? "blocked"
                  : "pending",
              delivery:
                input.stage === "done"
                  ? "complete"
                  : input.destinations.some((destination) =>
                        deliveryHandoffBlockers.has(destination.status),
                      )
                    ? "blocked"
                    : "pending",
            };
            const applicable = Object.values(checks).filter(
              (check) => check !== "not_applicable",
            ).length;
            const completed = Object.values(checks).filter(
              (check) => check === "complete",
            ).length;
            const state = Object.values(checks).includes("blocked")
              ? ("blocked" as const)
              : checks.ownership === "pending"
                ? ("needs_owner" as const)
                : checks.evidence === "pending"
                  ? ("evidence" as const)
                  : checks.content === "pending"
                    ? ("content" as const)
                    : checks.review === "pending"
                      ? ("review" as const)
                      : checks.delivery === "pending"
                        ? ("delivery" as const)
                        : ("complete" as const);
            return { state, completed, applicable, checks };
          };
          const stories = result.rows
            .slice(0, boardLimit)
            .map((row) => {
              const currentStage = stage(row);
              const dueTime = row.assignment_due_at?.getTime() ?? null;
              const dueState = !row.assignment_id
                ? ("none" as const)
                : currentStage === "done"
                  ? ("complete" as const)
                  : dueTime === null
                    ? ("none" as const)
                    : dueTime < evaluatedAt.getTime()
                      ? ("overdue" as const)
                      : dueTime <= dueSoonAt
                        ? ("due_soon" as const)
                        : ("scheduled" as const);
              return {
                id: row.content_item_id ?? row.research_case_id!,
                origin: row.record_kind,
                stage: currentStage,
                needsAttention:
                  currentStage === "attention" || dueState === "overdue",
                title: row.title,
                summary: row.summary,
                updatedAt: row.updated_at.toISOString(),
                research: row.research_case_id
                  ? {
                      id: row.research_case_id,
                      status: row.research_status!,
                      freshnessAt: row.freshness_at?.toISOString() ?? null,
                      sourceCount: row.source_count,
                      claimCount: row.claim_count,
                      verifiedClaimCount: row.verified_claim_count,
                    }
                  : null,
                content: row.content_item_id
                  ? { id: row.content_item_id, status: row.content_status! }
                  : null,
                destinations: row.destinations.map((destination) => ({
                  name: destination.destination,
                  status: destination.status,
                  currentRevision: destination.currentRevision,
                  pendingReview: destination.pendingReview,
                })),
                assignment: row.assignment_id
                  ? {
                      id: row.assignment_id,
                      assignee: {
                        userId: row.assignee_user_id!,
                        email: row.assignee_email!,
                      },
                      mine: row.assignee_user_id === context.session.userId,
                      priority: row.assignment_priority!,
                      dueAt: row.assignment_due_at?.toISOString() ?? null,
                      dueState,
                      note: row.assignment_note ?? "",
                    }
                  : null,
                handoff: deriveHandoff({
                  stage: currentStage,
                  researchStatus: row.research_status,
                  hasResearch: row.research_case_id !== null,
                  hasContent: row.content_item_id !== null,
                  hasAssignment: row.assignment_id !== null,
                  destinations: row.destinations,
                }),
              };
            })
            .sort((left, right) => {
              return (
                operationalRank(left) - operationalRank(right) ||
                (assignmentPriority.get(left.assignment?.priority ?? "") ?? 9) -
                  (assignmentPriority.get(right.assignment?.priority ?? "") ??
                    9) ||
                (left.assignment?.dueAt ?? "9999").localeCompare(
                  right.assignment?.dueAt ?? "9999",
                ) ||
                (priority.get(left.stage) ?? 99) -
                  (priority.get(right.stage) ?? 99) ||
                right.updatedAt.localeCompare(left.updatedAt)
              );
            });
          const stages = [
            "research",
            "ready",
            "drafting",
            "review",
            "scheduled",
            "done",
            "attention",
          ] as const;

          const canManageAssignments =
            context.session.mfaVerified &&
            hasPermission(context.actor, "tenant:admin");
          const team = canManageAssignments
            ? await client.query<{
                id: string;
                email: string;
                roles: string[];
              }>(
                `SELECT member.id,member.email,
                   array_agg(membership.role::text ORDER BY membership.role::text) AS roles
                 FROM control.memberships membership
                 JOIN control.users member ON member.id=membership.user_id
                 WHERE membership.tenant_id=$1
                 GROUP BY member.id,member.email
                 ORDER BY lower(member.email),member.id`,
                [context.session.tenantId],
              )
            : null;

          type WorkloadMember = {
            userId: string;
            email: string;
            total: number;
            overdue: number;
            dueSoon: number;
            attention: number;
            urgent: number;
            nextDueAt: string | null;
          };
          const workloadByUser = new Map<string, WorkloadMember>();
          for (const story of stories) {
            if (story.stage === "done" || !story.assignment) continue;
            const member = workloadByUser.get(
              story.assignment.assignee.userId,
            ) ?? {
              userId: story.assignment.assignee.userId,
              email: story.assignment.assignee.email,
              total: 0,
              overdue: 0,
              dueSoon: 0,
              attention: 0,
              urgent: 0,
              nextDueAt: null,
            };
            member.total += 1;
            if (story.assignment.dueState === "overdue") member.overdue += 1;
            if (story.assignment.dueState === "due_soon") member.dueSoon += 1;
            if (story.needsAttention) member.attention += 1;
            if (story.assignment.priority === "urgent") member.urgent += 1;
            if (
              story.assignment.dueAt &&
              (!member.nextDueAt ||
                story.assignment.dueAt.localeCompare(member.nextDueAt) < 0)
            )
              member.nextDueAt = story.assignment.dueAt;
            workloadByUser.set(member.userId, member);
          }
          for (const member of team?.rows ?? []) {
            if (!workloadByUser.has(member.id))
              workloadByUser.set(member.id, {
                userId: member.id,
                email: member.email,
                total: 0,
                overdue: 0,
                dueSoon: 0,
                attention: 0,
                urgent: 0,
                nextDueAt: null,
              });
          }
          const workloadMembers = [...workloadByUser.values()].sort(
            (left, right) =>
              right.overdue - left.overdue ||
              right.attention - left.attention ||
              right.dueSoon - left.dueSoon ||
              right.urgent - left.urgent ||
              right.total - left.total ||
              left.email.localeCompare(right.email),
          );

          return {
            workspace: { id: current.id, displayName: current.name },
            limit: boardLimit,
            evaluatedAt: evaluatedAt.toISOString(),
            permissions: {
              canManageAssignments,
              mfaVerified: context.session.mfaVerified,
            },
            team:
              team?.rows.map((member) => ({
                userId: member.id,
                email: member.email,
                roles: member.roles,
              })) ?? [],
            counts: Object.fromEntries(
              stages.map((name) => [
                name,
                stories.filter((story) => story.stage === name).length,
              ]),
            ),
            queue: {
              mine: stories.filter((story) => story.assignment?.mine).length,
              unassigned: stories.filter((story) => !story.assignment).length,
              overdue: stories.filter(
                (story) => story.assignment?.dueState === "overdue",
              ).length,
              dueSoon: stories.filter(
                (story) => story.assignment?.dueState === "due_soon",
              ).length,
              attention: stories.filter((story) => story.needsAttention).length,
            },
            workload: {
              visibility: canManageAssignments
                ? ("full_team" as const)
                : ("assigned_members_only" as const),
              coverage: {
                loadedStories: stories.length,
                limit: boardLimit,
                complete: !hasMoreStories,
              },
              unassigned: stories.filter(
                (story) => story.stage !== "done" && !story.assignment,
              ).length,
              members: workloadMembers,
            },
            stories,
          };
        },
      );
    },
  );

  const workboardStoryParams = {
    type: "object",
    additionalProperties: false,
    required: ["origin", "storyId"],
    properties: {
      origin: { enum: ["research", "content"] },
      storyId: uuidProperty,
    },
  } as const;

  app.put<{
    Params: { origin: "research" | "content"; storyId: string };
    Body: {
      workspaceId: string;
      assigneeUserId: string;
      priority: "normal" | "high" | "urgent";
      dueAt?: string | null;
      note?: string;
    };
  }>(
    "/api/workzone/stories/:origin/:storyId/assignment",
    {
      schema: {
        params: workboardStoryParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "assigneeUserId", "priority"],
          properties: {
            workspaceId: uuidProperty,
            assigneeUserId: uuidProperty,
            priority: { enum: ["normal", "high", "urgent"] },
            dueAt: {
              anyOf: [
                { type: "string", format: "date-time" },
                { type: "null" },
              ],
            },
            note: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!mediaIntelligence)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      const assignment = await mediaIntelligence.assignStory({
        tenantId: context.session.tenantId,
        workspaceId: request.body.workspaceId,
        origin: request.params.origin,
        storyId: request.params.storyId,
        assigneeUserId: request.body.assigneeUserId,
        priority: request.body.priority,
        ...(request.body.dueAt ? { dueAt: new Date(request.body.dueAt) } : {}),
        ...(request.body.note !== undefined ? { note: request.body.note } : {}),
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return reply.send({ assignment });
    },
  );

  app.delete<{
    Params: { origin: "research" | "content"; storyId: string };
    Querystring: { workspaceId: string };
  }>(
    "/api/workzone/stories/:origin/:storyId/assignment",
    {
      schema: {
        params: workboardStoryParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: uuidProperty },
        },
      },
    },
    async (request, reply) => {
      if (!mediaIntelligence)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      await mediaIntelligence.unassignStory({
        tenantId: context.session.tenantId,
        workspaceId: request.query.workspaceId,
        origin: request.params.origin,
        storyId: request.params.storyId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { name: string } }>(
    "/api/modules/:name",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", pattern: "^[a-z][a-z0-9.-]{1,80}$" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const result = await client.query<{ enabled: boolean }>(
            "SELECT enabled FROM control.feature_flags WHERE name = $1",
            [`module.${request.params.name}`],
          );
          if (result.rows[0]?.enabled !== true) {
            return reply
              .code(404)
              .send({ error: "Module is disabled", correlationId: request.id });
          }
          return { module: request.params.name, enabled: true };
        },
      );
    },
  );

  app.post<{ Body: { userId: string; role: Role } }>(
    "/api/memberships",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId", "role"],
          properties: {
            userId: { type: "string", format: "uuid" },
            role: { type: "string", enum: [...roles] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      await withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          await client.query(
            "INSERT INTO control.memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [context.session.tenantId, request.body.userId, request.body.role],
          );
          await insertAuditAndOutbox(client, {
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            action: "membership.granted",
            targetType: "membership",
            targetId: request.body.userId,
            correlationId: request.id,
            metadata: { role: request.body.role },
          });
        },
      );
      return reply.code(204).send();
    },
  );

  app.get("/auth/member/continue", async (_request, reply) => {
    // Keycloak only redirects here after its one-time, email-delivered action
    // link has completed. Starting a standard OIDC flow then creates the
    // tenant membership atomically in the callback.
    return reply.redirect("/auth/login", 303);
  });

  app.post<{
    Body: { email: string; role: (typeof memberInvitationRoles)[number] };
  }>(
    "/api/member-invitations",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "role"],
          properties: {
            email: {
              type: "string",
              minLength: 3,
              maxLength: 320,
              pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
            },
            role: { type: "string", enum: [...memberInvitationRoles] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database || !memberInvitations || !memberIdentityProvisioner)
        return reply
          .code(503)
          .send({ error: "Member invitations are not configured" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      const installation = await resolveInstallation(request);
      const email = request.body.email.trim().toLowerCase();
      let provisioned: { readonly identitySubject: string } | undefined;
      try {
        provisioned = await memberIdentityProvisioner.provision({
          email,
          redirectUri: `${apiUrl}/auth/member/continue`,
          expiresInSeconds: 24 * 60 * 60,
        });
        const invitationId = await memberInvitations.issue({
          tenantId: context.session.tenantId,
          installationId: installation.installationId,
          email,
          identitySubject: `${identity.id}|${provisioned.identitySubject}`,
          role: request.body.role,
          createdBy: context.session.userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          correlationId: request.id,
        });
        await memberInvitations.markDelivered(
          context.session.tenantId,
          invitationId,
        );
        return reply.code(202).send({ invitationId, expiresIn: 86_400 });
      } catch (error) {
        if (provisioned)
          await memberIdentityProvisioner
            .remove(provisioned.identitySubject)
            .catch(() => undefined);
        if (
          error instanceof MemberIdentityProvisioningError ||
          error instanceof MemberInvitationError
        )
          return reply
            .code(409)
            .send({ error: "Member invitation could not be created" });
        throw error;
      }
    },
  );

  app.get("/api/memberships", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "tenant:admin", {
      mfa: true,
    });
    if (!context) return;
    return withTenant(
      database.runtime,
      context.session.tenantId,
      async (client) => {
        const result = await client.query<{
          user_id: string;
          email: string;
          roles: Role[];
          created_at: string;
        }>(
          `SELECT membership.user_id, user_record.email,
             array_agg(membership.role ORDER BY membership.role)::text[] AS roles,
             min(membership.created_at)::text AS created_at
           FROM control.memberships membership
           JOIN control.users user_record ON user_record.id = membership.user_id
           GROUP BY membership.user_id, user_record.email
           ORDER BY min(membership.created_at), membership.user_id`,
        );
        return {
          members: result.rows.map((member) => ({
            userId: member.user_id,
            email: member.email,
            roles: member.roles,
            joinedAt: member.created_at,
            isCurrentUser: member.user_id === context.session.userId,
          })),
        };
      },
    );
  });

  app.delete<{ Params: { userId: string; role: Role } }>(
    "/api/memberships/:userId/:role",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId", "role"],
          properties: {
            userId: { type: "string", format: "uuid" },
            role: { type: "string", enum: [...roles] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          if (
            request.params.role === "root_owner" ||
            request.params.role === "white_label_owner"
          ) {
            const owners = await client.query<{ count: number }>(
              `SELECT count(DISTINCT user_id)::int AS count FROM control.memberships
             WHERE role IN ('root_owner', 'white_label_owner')`,
            );
            if ((owners.rows[0]?.count ?? 0) <= 1) {
              return reply
                .code(409)
                .send({ error: "The last tenant owner cannot be removed" });
            }
          }
          await client.query(
            "DELETE FROM control.memberships WHERE tenant_id = $1 AND user_id = $2 AND role = $3",
            [
              context.session.tenantId,
              request.params.userId,
              request.params.role,
            ],
          );
          await insertAuditAndOutbox(client, {
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            action: "membership.revoked",
            targetType: "membership",
            targetId: request.params.userId,
            correlationId: request.id,
            metadata: { role: request.params.role },
          });
          return reply.code(204).send();
        },
      );
    },
  );

  function connectorContext(
    context: AuthContext,
    correlationId: string,
    connectionId: string,
  ): TrustedConnectorContext {
    const permissions: string[] = [];
    if (hasPermission(context.actor, "platform:read"))
      permissions.push("platform:read");
    if (hasPermission(context.actor, "platform:connect"))
      permissions.push("platform:connect");
    if (hasPermission(context.actor, "content:edit"))
      permissions.push("content:edit");
    if (hasPermission(context.actor, "content:approve"))
      permissions.push("content:approve");
    return {
      tenantId: context.session.tenantId,
      connectionId,
      actorUserId: context.session.userId,
      permissions,
      correlationId,
    };
  }

  app.get("/api/platforms", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    const result = await database.runtime.query(
      `SELECT platform.id, platform.display_name, platform.category,
        platform.status, platform.documentation_status, version.connector_id,
        version.connector_version, version.status AS connector_status,
        version.manifest->'authentication' AS authentication,
        version.manifest->'scopes' AS scopes,
        version.manifest->'capabilities' AS capabilities,
        version.manifest->'compatibility' AS compatibility,
        version.manifest->'deprecation' AS deprecation
       FROM control.platform_definitions platform
       JOIN control.connector_versions version ON version.platform_id = platform.id
       ORDER BY platform.display_name, version.connector_version DESC`,
    );
    return { platforms: result.rows };
  });

  app.get("/api/connections", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    return withTenant(
      database.runtime,
      context.session.tenantId,
      async (client) => {
        const result = await client.query(
          `SELECT connection.id, connection.workspace_id, connection.connector_id,
          connection.connector_version, connection.environment, connection.status,
          connection.required_scopes, connection.granted_scopes,
          connection.discovered_capabilities, connection.health_status,
          connection.last_health_at, connection.kill_switched, connection.created_at
         FROM control.platform_connections connection ORDER BY connection.created_at DESC`,
        );
        return { connections: result.rows };
      },
    );
  });

  app.get("/api/websites", async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: "Database is not configured" });
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    return {
      websites: await listWebsiteConnections(
        database.runtime,
        context.session.tenantId,
      ),
    };
  });

  app.post<{ Params: { connectionId: string }; Body: Record<string, never> }>(
    "/api/websites/:connectionId/sync",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["connectionId"],
          properties: { connectionId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!database || !connectorRuntime)
        return reply
          .code(503)
          .send({ error: "Website connector is not configured" });
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      const counts = { draft: 0, pending: 0, published: 0, archived: 0 };
      let cursor: { createdAt: string; id: string } | null = null;
      let completed = false;
      for (let page = 0; page < 100; page += 1) {
        const result = (await connectorRuntime.executeRead(
          connectorContext(context, request.id, request.params.connectionId),
          "articles.list",
          {
            limit: 50,
            ...(cursor
              ? { before: cursor.createdAt, cursorId: cursor.id }
              : {}),
          },
        )) as {
          items: Array<{ status: keyof typeof counts }>;
          nextCursor: { createdAt: string; id: string } | null;
        };
        for (const item of result.items) counts[item.status] += 1;
        cursor = result.nextCursor;
        if (!cursor) {
          completed = true;
          break;
        }
      }
      if (!completed)
        return reply.code(409).send({
          error: "Website article summary exceeds the bounded sync limit",
        });
      await Promise.all(
        Object.entries(counts).map(([status, count]) =>
          recordWebsiteArticleStatusCount(database.runtime, {
            tenantId: context.session.tenantId,
            connectionId: request.params.connectionId,
            status: status as keyof typeof counts,
            count,
          }),
        ),
      );
      return { articleStatusSummary: counts };
    },
  );

  app.post<{
    Body: {
      installationId: string;
      workspaceId: string;
      environment: "local" | "test" | "sandbox" | "production";
      secretReference: string;
      apiBaseUrl: string;
      integrationId: string;
      displayName: string;
      domain: string;
      previewUrl?: string;
      grantedScopes: string[];
    };
  }>(
    "/api/websites/connections",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "installationId",
            "workspaceId",
            "environment",
            "secretReference",
            "apiBaseUrl",
            "integrationId",
            "displayName",
            "domain",
            "grantedScopes",
          ],
          properties: {
            installationId: { type: "string", format: "uuid" },
            workspaceId: { type: "string", format: "uuid" },
            environment: {
              type: "string",
              enum: ["local", "test", "sandbox", "production"],
            },
            secretReference: {
              type: "string",
              pattern: "^secret://[a-zA-Z0-9/_-]{3,240}$",
            },
            apiBaseUrl: { type: "string", maxLength: 500 },
            integrationId: {
              type: "string",
              pattern: "^[A-Za-z0-9._:-]{1,300}$",
            },
            displayName: { type: "string", minLength: 1, maxLength: 160 },
            domain: {
              type: "string",
              pattern: "^[a-z0-9.-]{1,253}$",
            },
            previewUrl: { type: "string", maxLength: 500 },
            grantedScopes: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", enum: websiteScopes },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:connect", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      const configurationResult =
        businessSiteConnectionConfigurationSchema.safeParse({
          apiBaseUrl: request.body.apiBaseUrl,
          integrationId: request.body.integrationId,
          displayName: request.body.displayName,
          domain: request.body.domain,
          ...(request.body.previewUrl
            ? { previewUrl: request.body.previewUrl }
            : {}),
          allowLocalHttp: ["local", "test"].includes(request.body.environment),
        });
      if (!configurationResult.success)
        return reply
          .code(400)
          .send({ error: "Invalid website connection configuration" });
      const configuration = configurationResult.data;
      const connectionId = await createBusinessSiteWebsiteConnection(
        database.runtime,
        {
          tenantId: context.session.tenantId,
          installationId: request.body.installationId,
          workspaceId: request.body.workspaceId,
          actorUserId: context.session.userId,
          correlationId: request.id,
          environment: request.body.environment,
          secretReference: request.body.secretReference,
          apiBaseUrl: configuration.apiBaseUrl.replace(/\/$/, ""),
          integrationId: configuration.integrationId,
          displayName: configuration.displayName,
          domain: configuration.domain,
          ...(configuration.previewUrl
            ? { previewUrl: configuration.previewUrl }
            : {}),
          grantedScopes: request.body.grantedScopes,
        },
      );
      return reply.code(201).send({ connectionId, status: "active" });
    },
  );

  app.post<{ Body: { installationId: string; workspaceId: string } }>(
    "/api/connections/test",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["installationId", "workspaceId"],
          properties: {
            installationId: { type: "string", format: "uuid" },
            workspaceId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:connect", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      const id = await createReferenceConnection(database.runtime, {
        tenantId: context.session.tenantId,
        installationId: request.body.installationId,
        workspaceId: request.body.workspaceId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return reply.code(201).send({ connectionId: id, status: "active" });
    },
  );

  app.post<{ Params: { connectionId: string } }>(
    "/api/connections/:connectionId/disable",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["connectionId"],
          properties: { connectionId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:connect", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      const changed = await disableConnection(database.runtime, {
        tenantId: context.session.tenantId,
        connectionId: request.params.connectionId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return changed
        ? reply.code(204).send()
        : reply.code(404).send({ error: "Connection not found" });
    },
  );

  app.post<{ Params: { connectionId: string } }>(
    "/api/connections/:connectionId/health",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["connectionId"],
          properties: { connectionId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!connectorRuntime)
        return reply
          .code(503)
          .send({ error: "Connector runtime is not configured" });
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      return {
        health: await connectorRuntime.health(
          connectorContext(context, request.id, request.params.connectionId),
        ),
      };
    },
  );

  for (const operation of ["refresh", "revoke"] as const) {
    app.post<{ Params: { accountId: string }; Body: Record<string, never> }>(
      `/api/social/accounts/:accountId/${operation}`,
      {
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["accountId"],
            properties: { accountId: { type: "string", format: "uuid" } },
          },
          body: { type: "object", additionalProperties: false },
        },
      },
      async (request, reply) => {
        if (!socialOAuth)
          return reply
            .code(503)
            .send({ error: "Provider configuration required" });
        const context = await authorize(request, reply, "platform:connect", {
          csrf: true,
          mfa: true,
        });
        if (!context) return;
        const input = {
          tenantId: context.session.tenantId,
          accountId: request.params.accountId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        };
        if (operation === "refresh") await socialOAuth.refreshAccount(input);
        else await socialOAuth.revokeAccount(input);
        return reply.code(204).send();
      },
    );
  }

  app.post<{
    Params: { connectionId: string; commandId: string };
    Body: { input: unknown; idempotencyKey?: string };
  }>(
    "/api/connections/:connectionId/commands/:commandId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["connectionId", "commandId"],
          properties: {
            connectionId: { type: "string", format: "uuid" },
            commandId: { type: "string", pattern: "^[a-z][a-z0-9.-]{1,80}$" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["input"],
          properties: {
            input: {},
            idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!connectorRuntime)
        return reply
          .code(503)
          .send({ error: "Connector runtime is not configured" });
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      const result = await connectorRuntime.executeCommand(
        connectorContext(context, request.id, request.params.connectionId),
        request.params.commandId,
        request.body.input,
        request.body.idempotencyKey,
      );
      return { result };
    },
  );

  app.get<{ Querystring: { workspaceId: string } }>(
    "/api/media",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!mediaLibrary)
        return reply
          .code(503)
          .send({ error: "Media storage configuration required" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        assets: await mediaLibrary.list(
          context.session.tenantId,
          request.query.workspaceId,
        ),
      };
    },
  );

  app.post<{ Body: { workspaceId: string } }>(
    "/api/social/meta/read-sync",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!metaReadCollection)
        return reply
          .code(503)
          .send({ error: "Meta read collection is not configured" });
      const context = await authorize(request, reply, "platform:connect", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return metaReadCollection.collect({
        tenantId: context.session.tenantId,
        workspaceId: request.body.workspaceId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
    },
  );

  app.get<{ Querystring: { workspaceId?: string; limit?: number } }>(
    "/api/content-items",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceId: uuidProperty,
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        items: await unifiedContent.list({
          tenantId: context.session.tenantId,
          ...(request.query.workspaceId
            ? { workspaceId: request.query.workspaceId }
            : {}),
          ...(request.query.limit ? { limit: request.query.limit } : {}),
        }),
      };
    },
  );

  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/content-items/website-review-queue",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { workspaceId: uuidProperty },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        items: await unifiedContent.listWebsiteReviewQueue({
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          ...(request.query.workspaceId
            ? { workspaceId: request.query.workspaceId }
            : {}),
        }),
        permissions: {
          canEdit: hasPermission(context.actor, "content:edit"),
          canApprove: hasPermission(context.actor, "content:approve"),
          mfaVerified: context.session.mfaVerified,
        },
      };
    },
  );

  app.get<{ Params: { itemId: string } }>(
    "/api/content-items/:itemId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        item: await unifiedContent.get(
          context.session.tenantId,
          request.params.itemId,
        ),
      };
    },
  );

  app.get<{ Params: { itemId: string } }>(
    "/api/content-items/:itemId/website-preflight",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        preflight: await unifiedContent.websiteDestinationPreflight({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
        }),
      };
    },
  );

  app.get<{ Params: { itemId: string } }>(
    "/api/content-items/:itemId/website-draft",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return {
        draft: await unifiedContent.getWebsiteDraft({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
        }),
        permissions: {
          canEdit: hasPermission(context.actor, "content:edit"),
          canApprove: hasPermission(context.actor, "content:approve"),
          mfaVerified: context.session.mfaVerified,
        },
      };
    },
  );

  app.post<{
    Params: { itemId: string };
    Body: {
      slug: string;
      title: string;
      excerpt?: string;
      bodyText: string;
      mediaAssetIds?: string[];
    };
  }>(
    "/api/content-items/:itemId/website-draft",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "title", "bodyText"],
          properties: websiteDraftCopyProperties,
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send({
        draft: await unifiedContent.createWebsiteDraft({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
          correlationId: request.id,
          ...request.body,
        }),
        permissions: {
          canEdit: true,
          canApprove: hasPermission(context.actor, "content:approve"),
          mfaVerified: context.session.mfaVerified,
        },
      });
    },
  );

  app.post<{
    Params: { itemId: string };
    Body: {
      expectedRevision: number;
      slug: string;
      title: string;
      excerpt?: string;
      bodyText: string;
      mediaAssetIds?: string[];
    };
  }>(
    "/api/content-items/:itemId/website-draft/revisions",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision", "slug", "title", "bodyText"],
          properties: {
            expectedRevision: { type: "integer", minimum: 1 },
            ...websiteDraftCopyProperties,
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send({
        draft: await unifiedContent.reviseWebsiteDraft({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
          correlationId: request.id,
          ...request.body,
        }),
        permissions: {
          canEdit: true,
          canApprove: hasPermission(context.actor, "content:approve"),
          mfaVerified: context.session.mfaVerified,
        },
      });
    },
  );

  app.post<{
    Params: { itemId: string };
    Body: { expectedRevision: number };
  }>(
    "/api/content-items/:itemId/website-draft/review",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision"],
          properties: {
            expectedRevision: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send({
        draft: await unifiedContent.requestWebsiteDraftReview({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
          expectedRevision: request.body.expectedRevision,
          correlationId: request.id,
        }),
        permissions: {
          canEdit: true,
          canApprove: hasPermission(context.actor, "content:approve"),
          mfaVerified: context.session.mfaVerified,
        },
      });
    },
  );

  app.post<{
    Params: { itemId: string };
    Body: {
      expectedRevision: number;
      decision: "approved" | "rejected";
      reason?: string;
    };
  }>(
    "/api/content-items/:itemId/website-draft/review-decision",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision", "decision"],
          properties: {
            expectedRevision: { type: "integer", minimum: 1 },
            decision: { enum: ["approved", "rejected"] },
            reason: { type: "string", minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return {
        draft: await unifiedContent.decideWebsiteDraftReview({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
          expectedRevision: request.body.expectedRevision,
          decision: request.body.decision,
          ...(request.body.reason ? { reason: request.body.reason } : {}),
          correlationId: request.id,
        }),
        permissions: {
          canEdit: hasPermission(context.actor, "content:edit"),
          canApprove: true,
          mfaVerified: true,
        },
      };
    },
  );

  app.post<{
    Body: {
      workspaceId: string;
      title: string;
      summary?: string;
      mediaAssetIds?: string[];
    };
  }>(
    "/api/content-items",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "title"],
          properties: {
            workspaceId: uuidProperty,
            title: { type: "string", minLength: 1, maxLength: 240 },
            summary: { type: "string", maxLength: 2000 },
            mediaAssetIds: contentMediaProperty,
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send({
        item: await unifiedContent.create({
          tenantId: context.session.tenantId,
          workspaceId: request.body.workspaceId,
          actorUserId: context.session.userId,
          title: request.body.title,
          ...(request.body.summary !== undefined
            ? { summary: request.body.summary }
            : {}),
          ...(request.body.mediaAssetIds
            ? { mediaAssetIds: request.body.mediaAssetIds }
            : {}),
          correlationId: request.id,
        }),
      });
    },
  );

  app.patch<{
    Params: { itemId: string };
    Body: {
      expectedVersion: number;
      title?: string;
      summary?: string;
      status?: "draft" | "active" | "archived";
      mediaAssetIds?: string[];
    };
  }>(
    "/api/content-items/:itemId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedVersion"],
          minProperties: 2,
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            title: { type: "string", minLength: 1, maxLength: 240 },
            summary: { type: "string", maxLength: 2000 },
            status: { enum: ["draft", "active", "archived"] },
            mediaAssetIds: contentMediaProperty,
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return {
        item: await unifiedContent.update({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          actorUserId: context.session.userId,
          correlationId: request.id,
          ...request.body,
        }),
      };
    },
  );

  app.post<{
    Params: { itemId: string };
    Body: {
      destination: ContentDestination;
      websiteConnectionId?: string;
      socialAccountId?: string;
      slug?: string;
      title?: string;
      excerpt?: string;
      websiteBody?: Record<string, unknown>;
      caption?: string;
      description?: string;
    };
  }>(
    "/api/content-items/:itemId/variants",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId"],
          properties: { itemId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["destination"],
          properties: {
            destination: { enum: [...contentDestinations] },
            websiteConnectionId: uuidProperty,
            socialAccountId: uuidProperty,
            slug: {
              type: "string",
              maxLength: 180,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            },
            title: { type: "string", minLength: 1, maxLength: 240 },
            excerpt: { type: "string", maxLength: 1000 },
            websiteBody: websiteBodyProperty,
            caption: { type: "string", maxLength: 5000 },
            description: { type: "string", maxLength: 5000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      if (
        request.body.destination === "website" &&
        (!connectorRuntime ||
          !request.body.websiteConnectionId ||
          !request.body.slug ||
          !request.body.websiteBody)
      )
        return reply.code(400).send({ error: "WEBSITE_VARIANT_INPUT_INVALID" });
      if (
        request.body.destination !== "website" &&
        (!socialPublishing || !request.body.socialAccountId)
      )
        return reply.code(400).send({ error: "SOCIAL_VARIANT_INPUT_INVALID" });
      const started = await unifiedContent.beginVariant({
        tenantId: context.session.tenantId,
        itemId: request.params.itemId,
        actorUserId: context.session.userId,
        destination: request.body.destination,
        ...(request.body.websiteConnectionId
          ? { websiteConnectionId: request.body.websiteConnectionId }
          : {}),
        ...(request.body.socialAccountId
          ? { socialAccountId: request.body.socialAccountId }
          : {}),
        correlationId: request.id,
      });
      try {
        if (request.body.destination === "website") {
          if (
            !connectorRuntime ||
            !request.body.websiteConnectionId ||
            !request.body.slug ||
            !request.body.websiteBody
          )
            throw new Error("WEBSITE_VARIANT_INPUT_INVALID");
          const result = (await connectorRuntime.executeWrite(
            connectorContext(
              context,
              request.id,
              request.body.websiteConnectionId,
            ),
            "articles.create",
            {
              externalReference: `content-item:${request.params.itemId}:variant:${started.variantId}`,
              slug: request.body.slug,
              title: request.body.title ?? started.item.title,
              excerpt: request.body.excerpt ?? started.item.summary,
              body: request.body.websiteBody,
            },
            `content-variant-${started.variantId}`,
          )) as { article: { id: string; version: number; status: string } };
          return reply.code(201).send({
            item: await unifiedContent.completeVariant({
              tenantId: context.session.tenantId,
              itemId: request.params.itemId,
              variantId: started.variantId,
              actorUserId: context.session.userId,
              status: result.article.status,
              currentRevision: result.article.version,
              externalId: result.article.id,
              correlationId: request.id,
            }),
          });
        }
        if (!socialPublishing || !request.body.socialAccountId)
          throw new Error("SOCIAL_VARIANT_INPUT_INVALID");
        const draftId = await socialPublishing.createDraft({
          tenantId: context.session.tenantId,
          workspaceId: started.item.workspaceId,
          actorUserId: context.session.userId,
          accountIds: [request.body.socialAccountId],
          content: {
            title: request.body.title ?? started.item.title,
            caption: request.body.caption ?? started.item.summary,
            ...(request.body.description
              ? { description: request.body.description }
              : {}),
            mediaAssetIds: started.item.mediaAssetIds,
          },
          correlationId: request.id,
        });
        return reply.code(201).send({
          item: await unifiedContent.completeVariant({
            tenantId: context.session.tenantId,
            itemId: request.params.itemId,
            variantId: started.variantId,
            actorUserId: context.session.userId,
            status: "draft",
            currentRevision: 1,
            nativeId: draftId,
            correlationId: request.id,
          }),
        });
      } catch (error) {
        await unifiedContent.failVariant({
          tenantId: context.session.tenantId,
          itemId: request.params.itemId,
          variantId: started.variantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        });
        throw error;
      }
    },
  );

  app.patch<{
    Params: { itemId: string; variantId: string };
    Body: {
      expectedRevision: number;
      slug?: string;
      title?: string;
      excerpt?: string;
      websiteBody?: Record<string, unknown>;
      caption?: string;
      description?: string;
    };
  }>(
    "/api/content-items/:itemId/variants/:variantId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "variantId"],
          properties: { itemId: uuidProperty, variantId: uuidProperty },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision"],
          minProperties: 2,
          properties: {
            expectedRevision: { type: "integer", minimum: 1 },
            slug: {
              type: "string",
              maxLength: 180,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            },
            title: { type: "string", minLength: 1, maxLength: 240 },
            excerpt: { type: "string", maxLength: 1000 },
            websiteBody: websiteBodyProperty,
            caption: { type: "string", maxLength: 5000 },
            description: { type: "string", maxLength: 5000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!unifiedContent)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const item = await unifiedContent.get(
        context.session.tenantId,
        request.params.itemId,
      );
      const variant = item.variants.find(
        (candidate) => candidate.id === request.params.variantId,
      );
      if (!variant)
        return reply.code(404).send({ error: "CONTENT_VARIANT_NOT_FOUND" });
      if (variant.currentRevision !== request.body.expectedRevision)
        return reply
          .code(409)
          .send({ error: "CONTENT_VARIANT_VERSION_CONFLICT" });
      let revision: number;
      let status = "draft";
      let externalId = variant.externalId;
      if (variant.destination === "website") {
        if (
          !connectorRuntime ||
          !variant.websiteConnectionId ||
          !variant.externalId ||
          !request.body.websiteBody
        )
          return reply
            .code(400)
            .send({ error: "WEBSITE_VARIANT_INPUT_INVALID" });
        const result = (await connectorRuntime.executeWrite(
          connectorContext(context, request.id, variant.websiteConnectionId),
          "articles.update",
          {
            articleId: variant.externalId,
            expectedVersion: request.body.expectedRevision,
            patch: {
              ...(request.body.slug ? { slug: request.body.slug } : {}),
              ...(request.body.title ? { title: request.body.title } : {}),
              ...(request.body.excerpt
                ? { excerpt: request.body.excerpt }
                : {}),
              body: request.body.websiteBody,
            },
          },
          `content-variant-${variant.id}-revision-${request.body.expectedRevision + 1}`,
        )) as { article: { id: string; version: number; status: string } };
        revision = result.article.version;
        status = result.article.status;
        externalId = result.article.id;
      } else {
        if (
          !socialPublishing ||
          !variant.socialDraftId ||
          !variant.socialAccountId
        )
          return reply
            .code(400)
            .send({ error: "SOCIAL_VARIANT_INPUT_INVALID" });
        revision = await socialPublishing.reviseDraft({
          tenantId: context.session.tenantId,
          draftId: variant.socialDraftId,
          actorUserId: context.session.userId,
          accountIds: [variant.socialAccountId],
          content: {
            title: request.body.title ?? item.title,
            caption: request.body.caption ?? item.summary,
            ...(request.body.description
              ? { description: request.body.description }
              : {}),
            mediaAssetIds: item.mediaAssetIds,
          },
          correlationId: request.id,
        });
      }
      return {
        item: await unifiedContent.completeVariant({
          tenantId: context.session.tenantId,
          itemId: item.id,
          variantId: variant.id,
          actorUserId: context.session.userId,
          status,
          currentRevision: revision,
          ...(variant.socialDraftId ? { nativeId: variant.socialDraftId } : {}),
          ...(externalId ? { externalId } : {}),
          correlationId: request.id,
        }),
      };
    },
  );

  app.post<{
    Body: {
      workspaceId: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string;
    };
  }>(
    "/api/media/uploads",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "originalFilename",
            "mimeType",
            "sizeBytes",
            "checksumSha256",
          ],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            originalFilename: { type: "string", minLength: 1, maxLength: 255 },
            mimeType: {
              type: "string",
              enum: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
            },
            sizeBytes: { type: "integer", minimum: 1 },
            checksumSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!mediaLibrary)
        return reply
          .code(503)
          .send({ error: "Media storage configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send(
        await mediaLibrary.requestUpload({
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
          ...request.body,
        }),
      );
    },
  );

  app.post<{
    Params: { uploadSessionId: string };
    Body: Record<string, never>;
  }>(
    "/api/media/uploads/:uploadSessionId/finalize",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["uploadSessionId"],
          properties: { uploadSessionId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!mediaLibrary)
        return reply
          .code(503)
          .send({ error: "Media storage configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const assetId = await mediaLibrary.finalizeUpload({
        tenantId: context.session.tenantId,
        uploadSessionId: request.params.uploadSessionId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return { assetId, status: "ready" };
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/api/media/:assetId/download",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["assetId"],
          properties: { assetId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!mediaLibrary)
        return reply
          .code(503)
          .send({ error: "Media storage configuration required" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return mediaLibrary.createDownload({
        tenantId: context.session.tenantId,
        assetId: request.params.assetId,
      });
    },
  );

  app.get("/api/social/providers", async (request, reply) => {
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    return {
      providers: [
        {
          id: "meta",
          displayName: metaConnectorManifest.displayName,
          configured: socialOAuth?.isConfigured("meta") ?? false,
          capabilities: metaConnectorManifest.capabilities,
        },
        {
          id: "youtube",
          displayName: youtubeConnectorManifest.displayName,
          configured: socialOAuth?.isConfigured("youtube") ?? false,
          capabilities: youtubeConnectorManifest.capabilities,
        },
        {
          id: "tiktok",
          displayName: tiktokConnectorManifest.displayName,
          configured: false,
          status: "requires_approval",
          capabilities: [],
        },
      ],
    };
  });

  app.get<{ Querystring: { workspaceId: string } }>(
    "/api/social/accounts",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const result = await client.query(
            `SELECT id,provider,account_type,provider_account_id,display_name,
            authorized_scopes,token_expires_at,refresh_status,status,health_status,
            last_synced_at,last_successful_publish_at
           FROM control.social_accounts WHERE workspace_id = $1 ORDER BY provider,display_name`,
            [request.query.workspaceId],
          );
          return { accounts: result.rows };
        },
      );
    },
  );

  // Production routes /api/* directly here; local Next also uses the Meta path.
  for (const metricPath of [
    "/api/social/meta/metrics",
    "/api/social/metrics",
  ]) {
    app.get<{ Querystring: { workspaceId: string } }>(
      metricPath,
      {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            required: ["workspaceId"],
            properties: { workspaceId: { type: "string", format: "uuid" } },
          },
        },
      },
      async (request, reply) => {
        if (!database)
          return reply.code(503).send({ error: "Database is not configured" });
        const context = await authorize(request, reply, "platform:read");
        if (!context) return;
        return withTenant(
          database.runtime,
          context.session.tenantId,
          async (client) => {
            const result = await client.query(
              `SELECT account_id,metric_key,period_start,period_end,value::text AS value,
                  provider_reported_at,collected_at
           FROM control.social_metric_observations
           WHERE workspace_id=$1
           ORDER BY period_end DESC,metric_key ASC
           LIMIT 200`,
              [request.query.workspaceId],
            );
            return { metrics: result.rows };
          },
        );
      },
    );
  }

  for (const provider of ["meta", "youtube"] as const) {
    app.post<{
      Body: {
        workspaceId: string;
        postConnectPath:
          | "/en/social/accounts"
          | "/de/social/accounts"
          | "/sq/social/accounts";
      };
    }>(
      `/api/social/oauth/${provider}/start`,
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["workspaceId", "postConnectPath"],
            properties: {
              workspaceId: { type: "string", format: "uuid" },
              postConnectPath: {
                enum: [
                  "/en/social/accounts",
                  "/de/social/accounts",
                  "/sq/social/accounts",
                ],
              },
            },
          },
        },
      },
      async (request, reply) => {
        if (
          !database ||
          !socialOAuth ||
          !installationResolver ||
          !installationPolicies
        )
          return reply
            .code(503)
            .send({ error: "Provider configuration required" });
        const context = await authorize(request, reply, "platform:connect", {
          csrf: true,
          mfa: true,
        });
        if (!context) return;
        const resolved = await resolveInstallation(request);
        if (resolved.tenantId !== context.session.tenantId)
          throw Object.assign(new Error("CROSS_INSTALLATION_DOMAIN_DENIED"), {
            statusCode: 403,
          });
        const workspace = await withTenant(
          database.runtime,
          context.session.tenantId,
          async (client) => {
            const result = await client.query<{ installation_id: string }>(
              "SELECT installation_id FROM control.business_workspaces WHERE id=$1",
              [request.body.workspaceId],
            );
            if (!result.rows[0])
              throw Object.assign(new Error("WORKSPACE_NOT_FOUND"), {
                statusCode: 404,
              });
            return result.rows[0];
          },
        );
        installationResolver.assertSameInstallation(
          resolved,
          workspace.installation_id,
        );
        await installationPolicies.oauthApplication(
          resolved.tenantId,
          resolved.installationId,
          provider,
        );
        const redirectUri = `${resolved.origin}/api/social/oauth/${provider}/callback`;
        const scopes =
          provider === "meta"
            ? metaBusinessLoginConfigurationId
              ? [
                  "business_management",
                  "pages_show_list",
                  "pages_read_engagement",
                  "instagram_basic",
                  "instagram_manage_insights",
                ]
              : [
                  "pages_show_list",
                  "pages_read_engagement",
                  "instagram_basic",
                  "instagram_manage_comments",
                  "instagram_manage_insights",
                ]
            : ["youtube.readonly", "youtube.upload"];
        return socialOAuth.begin({
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          workspaceId: request.body.workspaceId,
          postConnectPath: request.body.postConnectPath,
          provider,
          redirectUri,
          expectedOrigin: resolved.origin,
          scopes,
        });
      },
    );

    app.get<{ Querystring: { state: string; code: string } }>(
      `/api/social/oauth/${provider}/callback`,
      {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            required: ["state", "code"],
            properties: {
              state: { type: "string", minLength: 64, maxLength: 1024 },
              // OAuth authorization codes are provider-issued opaque values.
              // Meta may issue codes longer than 512 characters; keep a bounded
              // limit while accepting the documented opaque callback payload.
              code: { type: "string", minLength: 1, maxLength: 2048 },
            },
          },
        },
      },
      async (request, reply) => {
        if (!socialOAuth || !installationResolver || !installationPolicies)
          return reply
            .code(503)
            .send({ error: "Provider configuration required" });
        const resolved = await resolveInstallation(request);
        const redirectUri = `${resolved.origin}/api/social/oauth/${provider}/callback`;
        const completion = await socialOAuth.complete({
          tenantId: resolved.tenantId,
          state: request.query.state,
          code: request.query.code,
          provider,
          redirectUri,
          expectedOrigin: resolved.origin,
        });
        return reply.redirect(
          new URL(completion.postConnectPath, resolved.origin).toString(),
          303,
        );
      },
    );
  }

  app.get<{ Querystring: { workspaceId: string; limit?: number } }>(
    "/api/social/drafts",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const result = await client.query<{
            id: string;
            current_revision: number;
            status: string;
            scheduled_for: Date | null;
            schedule_timezone: string | null;
            created_at: Date;
            updated_at: Date;
            title: string | null;
            caption: string | null;
            description: string | null;
            media_attachments: unknown;
            targets: unknown;
            approval: unknown;
          }>(
            `SELECT draft.id,draft.current_revision,draft.status,
               draft.scheduled_for,draft.schedule_timezone,draft.created_at,
               draft.updated_at,revision.title,revision.caption,
               revision.description,revision.media_attachments,
               coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',target.id,
                   'accountId',account.id,
                   'accountName',account.display_name,
                   'channel',target.channel,
                   'status',target.status
                 ) ORDER BY target.channel,account.display_name)
                 FROM control.social_draft_targets target
                 JOIN control.social_accounts account ON account.id=target.account_id
                 WHERE target.revision_id=revision.id
               ),'[]'::jsonb) AS targets,
               (
                 SELECT jsonb_build_object(
                   'decision',approval.decision,
                   'requestedAt',approval.requested_at,
                   'requestedByCurrentUser',approval.requested_by=$3,
                   'decidedAt',approval.decided_at,
                   'reason',approval.reason
                 )
                 FROM control.social_approvals approval
                 WHERE approval.revision_id=revision.id
                 ORDER BY approval.requested_at DESC LIMIT 1
               ) AS approval
             FROM control.social_drafts draft
             JOIN control.social_draft_revisions revision
               ON revision.draft_id=draft.id
              AND revision.revision_number=draft.current_revision
             WHERE draft.workspace_id=$1
             ORDER BY coalesce(draft.scheduled_for,draft.updated_at) DESC,draft.id
             LIMIT $2`,
            [
              request.query.workspaceId,
              request.query.limit ?? 100,
              context.session.userId,
            ],
          );
          return {
            permissions: {
              canEdit: hasPermission(context.actor, "content:edit"),
              canApprove:
                hasPermission(context.actor, "content:approve") &&
                context.session.mfaVerified,
              mfaVerified: context.session.mfaVerified,
            },
            drafts: result.rows.map((row) => ({
              id: row.id,
              currentRevision: row.current_revision,
              status: row.status,
              scheduledFor: row.scheduled_for?.toISOString() ?? null,
              scheduleTimezone: row.schedule_timezone,
              createdAt: row.created_at.toISOString(),
              updatedAt: row.updated_at.toISOString(),
              content: {
                title: row.title,
                caption: row.caption,
                description: row.description,
                mediaAttachments: row.media_attachments,
              },
              targets: row.targets,
              approval: row.approval,
            })),
          };
        },
      );
    },
  );

  app.get<{
    Params: { draftId: string };
    Querystring: { workspaceId: string; limit?: number };
  }>(
    "/api/social/drafts/:draftId/revisions",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          required: ["workspaceId"],
          additionalProperties: false,
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 25 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const draft = await client.query<{
            id: string;
            current_revision: number;
            status: string;
            scheduled_for: Date | null;
            schedule_timezone: string | null;
          }>(
            `SELECT id,current_revision,status,scheduled_for,schedule_timezone
             FROM control.social_drafts WHERE id=$1 AND workspace_id=$2`,
            [request.params.draftId, request.query.workspaceId],
          );
          const aggregate = draft.rows[0];
          if (!aggregate)
            return reply.code(404).send({ error: "Social draft not found" });
          const revisions = await client.query<{
            revision_number: number;
            title: string | null;
            caption: string | null;
            description: string | null;
            created_at: Date;
            media: unknown;
            targets: unknown;
            approval: unknown;
          }>(
            `SELECT revision.revision_number,revision.title,revision.caption,
               revision.description,revision.created_at,
               coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',asset.id,'filename',asset.original_filename
                 ) ORDER BY (attachment.value->>'order')::int)
                 FROM jsonb_array_elements(revision.media_attachments) attachment(value)
                 JOIN control.media_assets asset
                   ON asset.id=(attachment.value->>'assetId')::uuid
               ),'[]'::jsonb) AS media,
               coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',target.id,
                   'accountId',account.id,
                   'accountName',account.display_name,
                   'channel',target.channel,
                   'status',target.status
                 ) ORDER BY target.channel,account.display_name)
                 FROM control.social_draft_targets target
                 JOIN control.social_accounts account ON account.id=target.account_id
                 WHERE target.revision_id=revision.id
               ),'[]'::jsonb) AS targets,
               (
                 SELECT jsonb_build_object(
                   'decision',approval.decision,
                   'requestedAt',approval.requested_at,
                   'requestedByCurrentUser',approval.requested_by=$2,
                   'decidedAt',approval.decided_at,
                   'decidedByCurrentUser',coalesce(approval.decided_by=$2,false),
                   'reason',approval.reason
                 )
                 FROM control.social_approvals approval
                 WHERE approval.revision_id=revision.id
               ) AS approval
             FROM control.social_draft_revisions revision
             WHERE revision.draft_id=$1
             ORDER BY revision.revision_number DESC
             LIMIT $3`,
            [
              request.params.draftId,
              context.session.userId,
              request.query.limit ?? 25,
            ],
          );
          return {
            draft: {
              id: aggregate.id,
              currentRevision: aggregate.current_revision,
              status: aggregate.status,
              scheduledFor: aggregate.scheduled_for?.toISOString() ?? null,
              scheduleTimezone: aggregate.schedule_timezone,
            },
            permissions: {
              canEdit: hasPermission(context.actor, "content:edit"),
              canApprove:
                hasPermission(context.actor, "content:approve") &&
                context.session.mfaVerified,
              mfaVerified: context.session.mfaVerified,
            },
            revisions: revisions.rows.map((revision) => ({
              revisionNumber: revision.revision_number,
              createdAt: revision.created_at.toISOString(),
              isCurrent:
                revision.revision_number === aggregate.current_revision,
              content: {
                title: revision.title,
                caption: revision.caption,
                description: revision.description,
              },
              media: revision.media,
              targets: revision.targets,
              approval: revision.approval,
            })),
          };
        },
      );
    },
  );

  app.get<{ Querystring: { workspaceId: string; limit?: number } }>(
    "/api/social/publications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!database)
        return reply.code(503).send({ error: "Database is not configured" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      return withTenant(
        database.runtime,
        context.session.tenantId,
        async (client) => {
          const result = await client.query<{
            draft_id: string;
            current_revision: number;
            draft_status: string;
            scheduled_for: Date | null;
            schedule_timezone: string | null;
            draft_updated_at: Date;
            title: string | null;
            caption: string | null;
            target_id: string;
            account_name: string;
            provider: string;
            channel: string;
            target_status: string;
            attempt_id: string | null;
            attempt_status: string | null;
            retry_count: number | null;
            failure_category: string | null;
            safe_error: string | null;
            started_at: Date | null;
            completed_at: Date | null;
            attempt_updated_at: Date | null;
            has_provider_reference: boolean | null;
            job_status: string | null;
            available_at: Date | null;
            attempt_count: number | null;
            max_attempts: number | null;
          }>(
            `WITH selected_drafts AS (
               SELECT draft.id,draft.current_revision,draft.status,
                 draft.scheduled_for,draft.schedule_timezone,draft.updated_at
               FROM control.social_drafts draft
               WHERE draft.workspace_id=$1
               ORDER BY coalesce(draft.scheduled_for,draft.updated_at) DESC,draft.id
               LIMIT $2
             )
             SELECT draft.id AS draft_id,draft.current_revision,
               draft.status AS draft_status,draft.scheduled_for,
               draft.schedule_timezone,draft.updated_at AS draft_updated_at,
               revision.title,revision.caption,target.id AS target_id,
               account.display_name AS account_name,account.provider,
               target.channel,target.status AS target_status,
               attempt.id AS attempt_id,attempt.status AS attempt_status,
               attempt.retry_count,attempt.failure_category,
               left(attempt.safe_error,500) AS safe_error,attempt.started_at,
               attempt.completed_at,attempt.updated_at AS attempt_updated_at,
               (attempt.provider_reference IS NOT NULL) AS has_provider_reference,
               job.status AS job_status,job.available_at,job.attempt_count,
               job.max_attempts
             FROM selected_drafts draft
             JOIN control.social_draft_revisions revision
               ON revision.draft_id=draft.id
              AND revision.revision_number=draft.current_revision
             JOIN control.social_draft_targets target
               ON target.revision_id=revision.id
             JOIN control.social_accounts account ON account.id=target.account_id
             LEFT JOIN LATERAL (
               SELECT publication.id,publication.status,
                 publication.retry_count,publication.failure_category,
                 publication.safe_error,publication.started_at,
                 publication.completed_at,publication.updated_at,
                 publication.provider_reference
               FROM control.publication_attempts publication
               WHERE publication.target_id=target.id
                 AND publication.revision_id=revision.id
               ORDER BY publication.updated_at DESC,publication.id
               LIMIT 1
             ) attempt ON true
             LEFT JOIN LATERAL (
               SELECT queued.status,queued.available_at,
                 queued.attempt_count,queued.max_attempts
               FROM control.jobs queued
               WHERE queued.job_type='social.publish'
                 AND queued.payload->>'targetId'=target.id::text
               ORDER BY queued.updated_at DESC,queued.id
               LIMIT 1
             ) job ON true
             ORDER BY coalesce(draft.scheduled_for,draft.updated_at) DESC,
               draft.id,target.channel,account.display_name`,
            [request.query.workspaceId, request.query.limit ?? 100],
          );
          const publications = new Map<
            string,
            {
              id: string;
              currentRevision: number;
              status: string;
              scheduledFor: string | null;
              scheduleTimezone: string | null;
              updatedAt: string;
              content: { title: string | null; caption: string | null };
              targets: unknown[];
            }
          >();
          for (const row of result.rows) {
            let publication = publications.get(row.draft_id);
            if (!publication) {
              publication = {
                id: row.draft_id,
                currentRevision: row.current_revision,
                status: row.draft_status,
                scheduledFor: row.scheduled_for?.toISOString() ?? null,
                scheduleTimezone: row.schedule_timezone,
                updatedAt: row.draft_updated_at.toISOString(),
                content: { title: row.title, caption: row.caption },
                targets: [],
              };
              publications.set(row.draft_id, publication);
            }
            publication.targets.push({
              id: row.target_id,
              accountName: row.account_name,
              provider: row.provider,
              channel: row.channel,
              status: row.target_status,
              attempt: row.attempt_id
                ? {
                    id: row.attempt_id,
                    status: row.attempt_status,
                    retryCount: row.retry_count,
                    failureCategory: row.failure_category,
                    safeError: row.safe_error,
                    startedAt: row.started_at?.toISOString() ?? null,
                    completedAt: row.completed_at?.toISOString() ?? null,
                    updatedAt: row.attempt_updated_at?.toISOString() ?? null,
                    hasProviderReference: row.has_provider_reference ?? false,
                  }
                : null,
              job: row.job_status
                ? {
                    status: row.job_status,
                    availableAt: row.available_at?.toISOString() ?? null,
                    attemptCount: row.attempt_count,
                    maxAttempts: row.max_attempts,
                  }
                : null,
              reconciliation: "not_available",
            });
          }
          return {
            automaticExecution: false,
            reconciliationAvailable: false,
            publications: [...publications.values()],
          };
        },
      );
    },
  );

  app.get<{
    Params: { draftId: string };
    Querystring: { workspaceId: string };
  }>(
    "/api/social/drafts/:draftId/preflight",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["draftId"],
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      const targets = await socialPublishing.preflightDraft({
        tenantId: context.session.tenantId,
        workspaceId: request.query.workspaceId,
        draftId: request.params.draftId,
      });
      return {
        providerExecutionAvailable: false,
        checkedAt: new Date().toISOString(),
        targets,
      };
    },
  );

  app.post<{
    Body: {
      workspaceId: string;
      accountIds: string[];
      title?: string;
      caption?: string;
      description?: string;
      mediaAssetIds: string[];
      channelOverrides?: Record<string, unknown>;
    };
  }>(
    "/api/social/drafts",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "accountIds", "mediaAssetIds"],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            accountIds: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
            title: { type: "string", maxLength: 100 },
            caption: { type: "string", maxLength: 5000 },
            description: { type: "string", maxLength: 5000 },
            mediaAssetIds: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string", format: "uuid" },
            },
            channelOverrides: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const { workspaceId, accountIds, mediaAssetIds, ...copy } = request.body;
      const draftId = await socialPublishing.createDraft({
        tenantId: context.session.tenantId,
        workspaceId,
        actorUserId: context.session.userId,
        accountIds,
        content: { ...copy, mediaAssetIds },
        correlationId: request.id,
      });
      return reply.code(201).send({ draftId, status: "draft" });
    },
  );

  app.post<{ Params: { draftId: string }; Body: Record<string, never> }>(
    "/api/social/drafts/:draftId/review",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      await socialPublishing.submitForReview({
        tenantId: context.session.tenantId,
        draftId: request.params.draftId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { draftId: string };
    Body: {
      accountIds: string[];
      title?: string;
      caption?: string;
      description?: string;
      mediaAssetIds: string[];
      channelOverrides?: Record<string, unknown>;
    };
  }>(
    "/api/social/drafts/:draftId/revisions",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["accountIds", "mediaAssetIds"],
          properties: {
            accountIds: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
            title: { type: "string", maxLength: 100 },
            caption: { type: "string", maxLength: 5000 },
            description: { type: "string", maxLength: 5000 },
            mediaAssetIds: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string", format: "uuid" },
            },
            channelOverrides: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const { accountIds, mediaAssetIds, ...copy } = request.body;
      const revisionNumber = await socialPublishing.reviseDraft({
        tenantId: context.session.tenantId,
        draftId: request.params.draftId,
        actorUserId: context.session.userId,
        accountIds,
        content: { ...copy, mediaAssetIds },
        correlationId: request.id,
      });
      return reply
        .code(201)
        .send({ revisionNumber, status: "draft", approvalReset: true });
    },
  );

  app.post<{
    Params: { draftId: string };
    Body: { decision: "approved" | "rejected"; reason?: string };
  }>(
    "/api/social/drafts/:draftId/decision",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision"],
          properties: {
            decision: { enum: ["approved", "rejected"] },
            reason: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      await socialPublishing.decide({
        tenantId: context.session.tenantId,
        draftId: request.params.draftId,
        reviewerUserId: context.session.userId,
        decision: request.body.decision,
        ...(request.body.reason ? { reason: request.body.reason } : {}),
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { draftId: string };
    Body: { scheduledFor: string; timezone: string };
  }>(
    "/api/social/drafts/:draftId/schedule",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["scheduledFor", "timezone"],
          properties: {
            scheduledFor: { type: "string", format: "date-time" },
            timezone: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      await socialPublishing.schedule({
        tenantId: context.session.tenantId,
        draftId: request.params.draftId,
        actorUserId: context.session.userId,
        scheduledFor: new Date(request.body.scheduledFor),
        timezone: request.body.timezone,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { targetId: string }; Body: Record<string, never> }>(
    "/api/social/targets/:targetId/publish",
    {
      schema: {
        params: {
          type: "object",
          required: ["targetId"],
          additionalProperties: false,
          properties: { targetId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      return socialPublishing.publishTarget({
        tenantId: context.session.tenantId,
        targetId: request.params.targetId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
    },
  );

  app.post<{ Params: { draftId: string }; Body: Record<string, never> }>(
    "/api/social/drafts/:draftId/cancel",
    {
      schema: {
        params: {
          type: "object",
          required: ["draftId"],
          additionalProperties: false,
          properties: { draftId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!socialPublishing)
        return reply
          .code(503)
          .send({ error: "Social publishing configuration required" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      await socialPublishing.cancel({
        tenantId: context.session.tenantId,
        draftId: request.params.draftId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  registerResearchRoutes(app, mediaIntelligence, authorize);
  registerEvidenceIntelligenceRoutes(app, evidenceIntelligence, authorize);
  registerModelStudioRoutes(app, evidenceIntelligence, authorize);
  registerPlatformOwnerRoutes(app, platformOwner, authorizePlatformOwner);
  registerServiceApiRoutes(app, installationApi);
  registerInstallationApiAdminRoutes(app, installationApi, authorize);
  registerWorkzoneProvisioningRoutes(app, workzoneProvisioning, authorize);
  registerWorkboardViewRoutes(app, workboardViews, authorize);
  registerSourceIngestionRoutes(app, sourceIngestion, authorize);
  registerVideoIntelligenceRoutes(
    app,
    videoIntelligence,
    socialPublishing ?? null,
    unifiedContent ?? null,
    authorize,
  );
  return app;
}
