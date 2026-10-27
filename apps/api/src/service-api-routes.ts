import type { InstallationApiService } from "@redi-control/installation";
import type { FastifyInstance, FastifyReply } from "fastify";

const credentialPattern = /^[A-Za-z0-9_-]{32,100}$/;

function basicCredentials(header: string | undefined): {
  clientIdentifier: string;
  clientSecret: string;
} | null {
  if (!header || header.length > 512 || !header.startsWith("Basic "))
    return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  const clientIdentifier = decoded.slice(0, separator);
  const clientSecret = decoded.slice(separator + 1);
  if (
    !clientIdentifier.startsWith("rc_") ||
    !credentialPattern.test(clientIdentifier.slice(3)) ||
    !credentialPattern.test(clientSecret)
  )
    return null;
  return { clientIdentifier, clientSecret };
}

function bearerToken(header: string | undefined): string | null {
  if (!header || header.length > 256 || !header.startsWith("Bearer "))
    return null;
  const token = header.slice(7);
  return credentialPattern.test(token) ? token : null;
}

const unauthorized = (reply: FastifyReply) =>
  reply
    .header("www-authenticate", 'Basic realm="REDI CONTROL API"')
    .header("cache-control", "no-store")
    .code(401)
    .send({ error: "INVALID_API_CREDENTIALS" });

const statusCode = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  typeof error.statusCode === "number"
    ? error.statusCode
    : 500;

export const serviceApiOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "REDI CONTROL Installation API",
    version: "1.0.0",
    description:
      "Installation-bound read-only API. It has no content write, provider connection or publishing operation.",
  },
  paths: {
    "/api/v1/oauth/token": {
      post: {
        summary: "Exchange installation client credentials",
        security: [{ clientBasic: [] }],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["grant_type", "scope"],
                properties: {
                  grant_type: { const: "client_credentials" },
                  scope: { const: "control:read" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Opaque Bearer token valid for at most 900 seconds",
          },
          "401": { description: "Invalid or inactive client credentials" },
          "429": { description: "Exchange rate limit exceeded" },
        },
      },
    },
    "/api/v1/control/summary": {
      get: {
        summary: "Read the safe installation control summary",
        security: [{ installationBearer: ["control:read"] }],
        responses: {
          "200": {
            description: "Safe plan, workzone, limit and capability projection",
          },
          "401": { description: "Invalid, expired or revoked access token" },
          "429": { description: "Request rate limit exceeded" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      clientBasic: { type: "http", scheme: "basic" },
      installationBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque",
      },
    },
  },
} as const;

export function registerServiceApiRoutes(
  app: FastifyInstance,
  service: InstallationApiService | null,
): void {
  app.get("/api/v1/openapi.json", (_request, reply) =>
    reply.header("cache-control", "no-store").send(serviceApiOpenApi),
  );

  app.post<{ Body: { grant_type: string; scope: string } }>(
    "/api/v1/oauth/token",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["grant_type", "scope"],
          properties: {
            grant_type: { const: "client_credentials" },
            scope: { const: "control:read" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply.code(503).send({ error: "INSTALLATION_API_UNAVAILABLE" });
      const credentials = basicCredentials(request.headers.authorization);
      if (!credentials) return unauthorized(reply);
      let token;
      try {
        token = await service.exchange({
          ...credentials,
          scope: request.body.scope,
        });
      } catch (error) {
        if (statusCode(error) === 401) return unauthorized(reply);
        if (statusCode(error) === 429)
          return reply
            .header("retry-after", "60")
            .header("cache-control", "no-store")
            .code(429)
            .send({ error: "API_RATE_LIMIT_EXCEEDED" });
        throw error;
      }
      return reply.header("cache-control", "no-store").send({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
      });
    },
  );

  app.get(
    "/api/v1/control/summary",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!service)
        return reply.code(503).send({ error: "INSTALLATION_API_UNAVAILABLE" });
      const token = bearerToken(request.headers.authorization);
      if (!token)
        return reply
          .header("www-authenticate", "Bearer")
          .header("cache-control", "no-store")
          .code(401)
          .send({ error: "INVALID_API_CREDENTIALS" });
      try {
        return reply
          .header("cache-control", "private, no-store")
          .send(await service.controlSummary(token));
      } catch (error) {
        if (statusCode(error) === 401)
          return reply
            .header("www-authenticate", "Bearer")
            .header("cache-control", "no-store")
            .code(401)
            .send({ error: "INVALID_API_CREDENTIALS" });
        if (statusCode(error) === 429)
          return reply
            .header("retry-after", "60")
            .header("cache-control", "no-store")
            .code(429)
            .send({ error: "API_RATE_LIMIT_EXCEEDED" });
        throw error;
      }
    },
  );
}
