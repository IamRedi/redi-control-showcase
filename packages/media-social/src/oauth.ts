import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { SecretProvider } from "@redi-control/connector-sdk";
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

export type SocialProviderId = "meta" | "youtube" | "tiktok";

export interface TokenSecretProvider extends SecretProvider {
  store(
    reference: string,
    value: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<void>;
  revoke(
    reference: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<void>;
}

export class LocalTokenSecretProvider implements TokenSecretProvider {
  readonly #values = new Map<string, string>();
  public store(reference: string, value: string): Promise<void> {
    this.#values.set(reference, value);
    return Promise.resolve();
  }
  public resolve(reference: string): Promise<string> {
    const value = this.#values.get(reference);
    return value
      ? Promise.resolve(value)
      : Promise.reject(new Error("SECRET_UNAVAILABLE"));
  }
  public revoke(reference: string): Promise<void> {
    this.#values.delete(reference);
    return Promise.resolve();
  }
}

export interface OAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: string;
  readonly grantedScopes: readonly string[];
}

export interface DiscoveredSocialAccount {
  readonly providerAccountId: string;
  readonly accountType:
    | "facebook_page"
    | "instagram_account"
    | "youtube_channel"
    | "tiktok_account";
  readonly displayName: string;
  /** Transient account-scoped token; it is stored only through TokenSecretProvider. */
  readonly token?: OAuthTokenSet;
}

export interface SocialOAuthAdapter {
  readonly id: SocialProviderId;
  readonly configured: boolean;
  readonly supportsPkce: boolean;
  authorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes: readonly string[];
    codeChallenge?: string;
  }): Promise<string>;
  exchange(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthTokenSet>;
  refresh(token: OAuthTokenSet): Promise<OAuthTokenSet>;
  revoke(token: OAuthTokenSet): Promise<void>;
  discoverAccounts(
    token: OAuthTokenSet,
  ): Promise<readonly DiscoveredSocialAccount[]>;
}

export class ProviderConfigurationRequiredError extends Error {
  public readonly statusCode = 503;
  public constructor() {
    super("Provider configuration required");
  }
}

export class UnconfiguredSocialOAuthAdapter implements SocialOAuthAdapter {
  public readonly configured = false;
  public readonly supportsPkce = true;
  public constructor(public readonly id: SocialProviderId) {}
  #fail<T>(): Promise<T> {
    return Promise.reject(new ProviderConfigurationRequiredError());
  }
  public authorizationUrl(): Promise<string> {
    return this.#fail();
  }
  public exchange(): Promise<OAuthTokenSet> {
    return this.#fail();
  }
  public refresh(): Promise<OAuthTokenSet> {
    return this.#fail();
  }
  public revoke(): Promise<void> {
    return this.#fail();
  }
  public discoverAccounts(): Promise<readonly DiscoveredSocialAccount[]> {
    return this.#fail();
  }
}

export type DeterministicOAuthMode =
  | "success"
  | "scope-mismatch"
  | "expired"
  | "failure";
export class DeterministicSocialOAuthAdapter implements SocialOAuthAdapter {
  public readonly configured = true;
  public readonly supportsPkce = true;
  public constructor(
    public readonly id: SocialProviderId,
    private readonly accounts: readonly DiscoveredSocialAccount[],
    private readonly scopes: readonly string[],
    public mode: DeterministicOAuthMode = "success",
  ) {}
  public authorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes: readonly string[];
    codeChallenge?: string;
  }): Promise<string> {
    const query = new URLSearchParams({
      state: input.state,
      redirect_uri: input.redirectUri,
      scope: input.scopes.join(" "),
      ...(input.codeChallenge ? { code_challenge: input.codeChallenge } : {}),
    });
    return Promise.resolve(
      `http://127.0.0.1/local-oauth/${this.id}?${query.toString()}`,
    );
  }
  public exchange(input: {
    code: string;
    codeVerifier?: string;
  }): Promise<OAuthTokenSet> {
    if (
      this.mode === "failure" ||
      input.code !== "local-valid-code" ||
      !input.codeVerifier
    )
      return Promise.reject(new Error("OAUTH_EXCHANGE_FAILED"));
    return Promise.resolve({
      accessToken: `local-access-${randomBytes(24).toString("hex")}`,
      refreshToken: `local-refresh-${randomBytes(24).toString("hex")}`,
      expiresAt: new Date(
        Date.now() + (this.mode === "expired" ? -1000 : 3_600_000),
      ).toISOString(),
      grantedScopes: this.mode === "scope-mismatch" ? [] : this.scopes,
    });
  }
  public refresh(token: OAuthTokenSet): Promise<OAuthTokenSet> {
    return Promise.resolve({
      ...token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }
  public revoke(): Promise<void> {
    return Promise.resolve();
  }
  public discoverAccounts(): Promise<readonly DiscoveredSocialAccount[]> {
    return Promise.resolve(this.accounts);
  }
}

/** Read-only Meta Graph OAuth adapter. It deliberately has no publishing API. */
export class MetaReadOnlyOAuthAdapter implements SocialOAuthAdapter {
  public readonly id = "meta" as const;
  public readonly configured: boolean;
  public readonly supportsPkce = true;
  #origin: string;
  public constructor(
    private readonly appId: string | undefined,
    private readonly appSecret: string | undefined,
    version = "v26.0",
    private readonly businessLoginConfigurationId?: string,
  ) {
    this.configured = Boolean(appId && appSecret);
    this.#origin = `https://graph.facebook.com/${version}`;
  }
  authorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes: readonly string[];
    codeChallenge?: string;
  }): Promise<string> {
    if (!this.configured)
      return Promise.reject(new ProviderConfigurationRequiredError());
    const url = new URL(
      `https://www.facebook.com/${this.#origin.split("/").pop()}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: this.appId!,
      redirect_uri: input.redirectUri,
      state: input.state,
      response_type: "code",
      scope: input.scopes.join(","),
      ...(this.businessLoginConfigurationId
        ? { config_id: this.businessLoginConfigurationId }
        : {}),
      ...(input.codeChallenge
        ? { code_challenge: input.codeChallenge, code_challenge_method: "S256" }
        : {}),
    }).toString();
    return Promise.resolve(url.toString());
  }
  async exchange(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthTokenSet> {
    const short = await this.#token({
      client_id: this.appId!,
      client_secret: this.appSecret!,
      redirect_uri: input.redirectUri,
      code: input.code,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    });
    const long = await this.#token({
      grant_type: "fb_exchange_token",
      client_id: this.appId!,
      client_secret: this.appSecret!,
      fb_exchange_token: short.access_token,
    });
    const permissions = await this.#get("/me/permissions", long.access_token);
    const grantedScopes = Array.isArray(permissions.data)
      ? permissions.data
          .filter(
            (p: unknown): p is { permission: string; status: string } =>
              typeof p === "object" &&
              p !== null &&
              typeof (p as { permission?: unknown }).permission === "string" &&
              (p as { status?: unknown }).status === "granted",
          )
          .map((p) => p.permission)
      : [];
    return {
      accessToken: long.access_token,
      expiresAt: new Date(
        Date.now() + Number(long.expires_in ?? 3600) * 1000,
      ).toISOString(),
      grantedScopes,
    };
  }
  async refresh(token: OAuthTokenSet): Promise<OAuthTokenSet> {
    if (!this.configured) throw new ProviderConfigurationRequiredError();
    const refreshed = await this.#token({
      grant_type: "fb_exchange_token",
      client_id: this.appId!,
      client_secret: this.appSecret!,
      fb_exchange_token: token.accessToken,
    });
    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: new Date(
        Date.now() + Number(refreshed.expires_in ?? 3_600) * 1000,
      ).toISOString(),
    };
  }
  revoke(): Promise<void> {
    return Promise.resolve();
  }
  async discoverAccounts(
    token: OAuthTokenSet,
  ): Promise<readonly DiscoveredSocialAccount[]> {
    const pages = await this.#get(
      "/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}",
      token.accessToken,
    );
    if (!Array.isArray(pages.data))
      throw new Error("META_ACCOUNT_RESPONSE_INVALID");
    const pageRows = pages.data;
    if (pageRows.length === 0) throw new Error("META_NO_AUTHORIZED_PAGES");
    return pageRows.flatMap(
      (page: {
        id?: unknown;
        name?: unknown;
        access_token?: unknown;
        instagram_business_account?: { id?: unknown; username?: unknown };
      }) => {
        if (
          typeof page.id !== "string" ||
          typeof page.name !== "string" ||
          typeof page.access_token !== "string" ||
          page.access_token.length === 0
        )
          throw new Error("META_PAGE_TOKEN_UNAVAILABLE");
        const pageToken: OAuthTokenSet = {
          ...token,
          accessToken: page.access_token,
        };
        const accounts: DiscoveredSocialAccount[] = [
          {
            providerAccountId: page.id,
            accountType: "facebook_page",
            displayName: page.name,
            token: pageToken,
          },
        ];
        if (typeof page.instagram_business_account?.id === "string")
          accounts.push({
            providerAccountId: page.instagram_business_account.id,
            accountType: "instagram_account",
            displayName:
              typeof page.instagram_business_account.username === "string"
                ? page.instagram_business_account.username
                : "Instagram account",
            token: pageToken,
          });
        return accounts;
      },
    );
  }
  async readMetrics(input: {
    providerAccountId: string;
    accountType: "facebook_page" | "instagram_account";
    accessToken: string;
  }): Promise<
    readonly {
      key: string;
      value: number;
      periodStart: string;
      periodEnd: string;
      providerReportedAt?: string;
    }[]
  > {
    if (!this.configured) throw new ProviderConfigurationRequiredError();
    const collectedAt = new Date();
    const periodStart = new Date(
      collectedAt.getTime() - 86_400_000,
    ).toISOString();
    const periodEnd = collectedAt.toISOString();
    const fields =
      input.accountType === "facebook_page"
        ? "fan_count,followers_count"
        : "followers_count,media_count";
    const profile = await this.#get(
      `/${encodeURIComponent(input.providerAccountId)}?fields=${fields}`,
      input.accessToken,
    );
    const metrics = Object.entries(profile).flatMap(([key, value]) =>
      typeof value === "number" && Number.isFinite(value)
        ? [{ key, value, periodStart, periodEnd }]
        : [],
    );
    if (input.accountType !== "instagram_account") return metrics;
    const insights = await this.#get(
      `/${encodeURIComponent(input.providerAccountId)}/insights?metric=impressions,reach,accounts_engaged&period=day`,
      input.accessToken,
    ).catch(() => ({ data: [] }));
    if (!Array.isArray(insights.data)) return metrics;
    return [
      ...metrics,
      ...insights.data.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return [];
        const row = item as { name?: unknown; values?: unknown };
        const value: unknown = Array.isArray(row.values)
          ? row.values.at(-1)
          : undefined;
        if (
          typeof row.name !== "string" ||
          typeof value !== "object" ||
          value === null ||
          typeof (value as { value?: unknown }).value !== "number"
        )
          return [];
        const endTime = (value as { end_time?: unknown }).end_time;
        return [
          {
            key: row.name,
            value: (value as { value: number }).value,
            periodStart,
            periodEnd: typeof endTime === "string" ? endTime : periodEnd,
            providerReportedAt:
              typeof endTime === "string" ? endTime : undefined,
          },
        ];
      }),
    ];
  }
  async #token(
    values: Record<string, string>,
  ): Promise<{ access_token: string; expires_in?: number }> {
    const result = await this.#get(
      "/oauth/access_token?" + new URLSearchParams(values).toString(),
      undefined,
    );
    if (typeof result.access_token !== "string")
      throw new Error("META_TOKEN_EXCHANGE_FAILED");
    return result as { access_token: string; expires_in?: number };
  }
  async #get(
    path: string,
    accessToken?: string,
  ): Promise<Record<string, unknown>> {
    const url = new URL(this.#origin + path);
    if (accessToken) url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("META_GRAPH_REQUEST_FAILED");
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw new Error("META_ACCOUNT_RESPONSE_INVALID");
    return body as Record<string, unknown>;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export interface OAuthBeginResult {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly expiresAt: string;
}

interface OAuthStatePayload {
  readonly transactionId: string;
  readonly nonce: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly provider: SocialProviderId;
  readonly expectedOrigin: string;
  readonly postConnectPath: string;
}

export class OAuthFoundationService {
  readonly #adapters = new Map<SocialProviderId, SocialOAuthAdapter>();
  public constructor(
    private readonly pool: DatabasePool,
    private readonly secrets: TokenSecretProvider,
    private readonly signingSecret: string,
    private readonly redirectAllowlist: ReadonlySet<string>,
  ) {}
  public register(adapter: SocialOAuthAdapter): void {
    this.#adapters.set(adapter.id, adapter);
  }
  public isConfigured(provider: SocialProviderId): boolean {
    return Boolean(this.#adapters.get(provider)?.configured);
  }
  #adapter(provider: SocialProviderId): SocialOAuthAdapter {
    const adapter = this.#adapters.get(provider);
    if (!adapter?.configured) throw new ProviderConfigurationRequiredError();
    return adapter;
  }
  #sign(payload: string): string {
    return createHmac("sha256", this.signingSecret)
      .update(payload)
      .digest("hex");
  }
  #verify(token: string): OAuthStatePayload {
    const [payload, candidate] = token.split(".");
    if (!payload || !candidate || !/^[0-9a-f]{64}$/.test(candidate))
      throw new Error("INVALID_OAUTH_STATE");
    const expected = this.#sign(payload);
    if (
      !timingSafeEqual(
        Buffer.from(candidate, "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      throw new Error("INVALID_OAUTH_STATE");
    try {
      const parsed = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (
        typeof parsed.transactionId !== "string" ||
        typeof parsed.nonce !== "string" ||
        typeof parsed.installationId !== "string" ||
        typeof parsed.tenantId !== "string" ||
        typeof parsed.workspaceId !== "string" ||
        !["meta", "youtube", "tiktok"].includes(String(parsed.provider)) ||
        typeof parsed.expectedOrigin !== "string" ||
        typeof parsed.postConnectPath !== "string"
      )
        throw new Error("INVALID_OAUTH_STATE");
      return parsed as unknown as OAuthStatePayload;
    } catch {
      throw new Error("INVALID_OAUTH_STATE");
    }
  }
  public async begin(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    provider: SocialProviderId;
    redirectUri: string;
    scopes: readonly string[];
    expectedOrigin?: string;
    postConnectPath?:
      | "/en/social/accounts"
      | "/de/social/accounts"
      | "/sq/social/accounts";
  }): Promise<OAuthBeginResult> {
    if (!this.redirectAllowlist.has(input.redirectUri))
      throw new Error("REDIRECT_URI_NOT_ALLOWED");
    const adapter = this.#adapter(input.provider);
    const workspace = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{ installation_id: string }>(
          "SELECT installation_id FROM control.business_workspaces WHERE id=$1",
          [input.workspaceId],
        );
        if (!result.rows[0]) throw new Error("WORKSPACE_NOT_FOUND");
        return result.rows[0];
      },
    );
    const expectedOrigin =
      input.expectedOrigin ?? new URL(input.redirectUri).origin;
    const postConnectPath = input.postConnectPath ?? "/en/social/accounts";
    if (new URL(input.redirectUri).origin !== expectedOrigin)
      throw new Error("OAUTH_ORIGIN_MISMATCH");
    const transactionId = randomUUID();
    const nonce = randomBytes(24).toString("hex");
    const payload = base64url(
      JSON.stringify({
        transactionId,
        nonce,
        installationId: workspace.installation_id,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        expectedOrigin,
        postConnectPath,
      }),
    );
    const state = `${payload}.${this.#sign(payload)}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const verifier = randomBytes(48).toString("base64url");
    const verifierReference = `secret://oauth/${transactionId}`;
    await this.secrets.store(verifierReference, verifier, {
      tenantId: input.tenantId,
      connectionId: transactionId,
    });
    await withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO control.oauth_transactions
         (id, tenant_id, workspace_id, actor_user_id, provider, state_hash,
          pkce_verifier_reference, redirect_uri, requested_scopes, expires_at,
          installation_id, expected_origin, post_connect_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          transactionId,
          input.tenantId,
          input.workspaceId,
          input.actorUserId,
          input.provider,
          sha256(state),
          verifierReference,
          input.redirectUri,
          [...input.scopes],
          expiresAt,
          workspace.installation_id,
          expectedOrigin,
          postConnectPath,
        ],
      );
    });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return {
      authorizationUrl: await adapter.authorizationUrl({
        state,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        ...(adapter.supportsPkce ? { codeChallenge: challenge } : {}),
      }),
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }
  public async complete(input: {
    tenantId: string;
    state: string;
    code: string;
    redirectUri: string;
    expectedOrigin?: string;
    provider?: SocialProviderId;
  }): Promise<{
    readonly accountIds: readonly string[];
    readonly postConnectPath:
      | "/en/social/accounts"
      | "/de/social/accounts"
      | "/sq/social/accounts";
  }> {
    if (!this.redirectAllowlist.has(input.redirectUri))
      throw new Error("REDIRECT_URI_NOT_ALLOWED");
    const parsed = this.#verify(input.state);
    const expectedOrigin =
      input.expectedOrigin ?? new URL(input.redirectUri).origin;
    const provider = input.provider ?? parsed.provider;
    if (
      parsed.tenantId !== input.tenantId ||
      parsed.provider !== provider ||
      parsed.expectedOrigin !== expectedOrigin ||
      new URL(input.redirectUri).origin !== expectedOrigin
    )
      throw new Error("OAUTH_STATE_CONTEXT_MISMATCH");
    const row = await withTenant(this.pool, input.tenantId, async (client) => {
      const transaction = await client.query<{
        id: string;
        workspace_id: string;
        actor_user_id: string;
        provider: SocialProviderId;
        pkce_verifier_reference: string;
        redirect_uri: string;
        requested_scopes: string[];
        installation_id: string;
        expected_origin: string;
        post_connect_path: string;
      }>(
        `UPDATE control.oauth_transactions SET used_at = now()
         WHERE id = $1 AND state_hash = $2 AND used_at IS NULL AND expires_at > now()
           AND redirect_uri = $3 AND installation_id = $4 AND workspace_id = $5
           AND provider = $6 AND expected_origin = $7
         RETURNING id, workspace_id, actor_user_id, provider, pkce_verifier_reference,
                   redirect_uri, requested_scopes, installation_id, expected_origin,
                   post_connect_path`,
        [
          parsed.transactionId,
          sha256(input.state),
          input.redirectUri,
          parsed.installationId,
          parsed.workspaceId,
          provider,
          expectedOrigin,
        ],
      );
      const row = transaction.rows[0];
      if (!row) throw new Error("OAUTH_STATE_EXPIRED_OR_USED");
      return row;
    });
    const adapter = this.#adapter(row.provider);
    const verifier = await this.secrets.resolve(row.pkce_verifier_reference, {
      tenantId: input.tenantId,
      connectionId: row.id,
    });
    try {
      const tokens = await adapter.exchange({
        code: input.code,
        redirectUri: row.redirect_uri,
        ...(adapter.supportsPkce ? { codeVerifier: verifier } : {}),
      });
      if (
        row.requested_scopes.some(
          (scope) => !tokens.grantedScopes.includes(scope),
        )
      )
        throw new Error("OAUTH_SCOPE_MISMATCH");
      const tokenReferences: { reference: string; accountId: string }[] = [];
      try {
        return await withTenant(this.pool, input.tenantId, async (client) => {
          const accountIds: string[] = [];
          for (const account of await adapter.discoverAccounts(tokens)) {
            const accountId = randomUUID();
            const tokenReference = `secret://social/${row.provider}/${randomUUID()}`;
            tokenReferences.push({ reference: tokenReference, accountId });
            await this.secrets.store(
              tokenReference,
              JSON.stringify(account.token ?? tokens),
              { tenantId: input.tenantId, connectionId: accountId },
            );
            const connected = await client.query<{ id: string }>(
              `INSERT INTO control.social_accounts
           (id, tenant_id, workspace_id, provider, account_type, provider_account_id,
            display_name, authorized_scopes, token_reference, token_expires_at, status, health_status, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','healthy',now())
           ON CONFLICT (tenant_id,provider,provider_account_id) DO UPDATE SET
             workspace_id=EXCLUDED.workspace_id, account_type=EXCLUDED.account_type,
             display_name=EXCLUDED.display_name, authorized_scopes=EXCLUDED.authorized_scopes,
             token_reference=EXCLUDED.token_reference, token_expires_at=EXCLUDED.token_expires_at,
             refresh_status='current', status='active', health_status='healthy',
             last_synced_at=now(), updated_at=now()
           RETURNING id`,
              [
                accountId,
                input.tenantId,
                row.workspace_id,
                row.provider,
                account.accountType,
                account.providerAccountId,
                account.displayName,
                [...tokens.grantedScopes],
                tokenReference,
                tokens.expiresAt,
              ],
            );
            accountIds.push(connected.rows[0]!.id);
          }
          await this.secrets.revoke(row.pkce_verifier_reference, {
            tenantId: input.tenantId,
            connectionId: row.id,
          });
          const auditId = randomUUID();
          await client.query(
            `INSERT INTO control.audit_events
         (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
         VALUES ($1,$2,$3,'social.oauth_connected','social_provider',$4,$5,$6)`,
            [
              auditId,
              input.tenantId,
              row.actor_user_id,
              row.provider,
              randomUUID(),
              { accountCount: accountIds.length, scopes: row.requested_scopes },
            ],
          );
          await client.query(
            `INSERT INTO control.outbox_events
         (id,tenant_id,event_type,event_version,payload,correlation_id)
         VALUES ($1,$2,'social.oauth_connected',1,$3,$4)`,
            [
              randomUUID(),
              input.tenantId,
              { auditEventId: auditId, provider: row.provider, accountIds },
              randomUUID(),
            ],
          );
          return {
            accountIds,
            postConnectPath: row.post_connect_path as
              | "/en/social/accounts"
              | "/de/social/accounts"
              | "/sq/social/accounts",
          };
        });
      } catch (error) {
        await Promise.all(
          tokenReferences.map(({ reference, accountId }) =>
            this.secrets.revoke(reference, {
              tenantId: input.tenantId,
              connectionId: accountId,
            }),
          ),
        );
        throw error;
      }
    } finally {
      await this.secrets.revoke(row.pkce_verifier_reference, {
        tenantId: input.tenantId,
        connectionId: row.id,
      });
    }
  }

  public async refreshAccount(input: {
    tenantId: string;
    accountId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    const account = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          provider: SocialProviderId;
          token_reference: string;
        }>(
          "SELECT provider,token_reference FROM control.social_accounts WHERE id=$1 AND status <> 'revoked'",
          [input.accountId],
        );
        if (!result.rows[0]) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND");
        return result.rows[0];
      },
    );
    try {
      const current = JSON.parse(
        await this.secrets.resolve(account.token_reference, {
          tenantId: input.tenantId,
          connectionId: input.accountId,
        }),
      ) as OAuthTokenSet;
      const refreshed = await this.#adapter(account.provider).refresh(current);
      await this.secrets.store(
        account.token_reference,
        JSON.stringify(refreshed),
        { tenantId: input.tenantId, connectionId: input.accountId },
      );
      await withTenant(this.pool, input.tenantId, async (client) => {
        await client.query(
          "UPDATE control.social_accounts SET authorized_scopes=$2,token_expires_at=$3,refresh_status='current',status='active',health_status='healthy',updated_at=now() WHERE token_reference=$1",
          [
            account.token_reference,
            [...refreshed.grantedScopes],
            refreshed.expiresAt,
          ],
        );
        await this.#recordLifecycle(client, input, "social.token_refreshed");
      });
    } catch (error) {
      await withTenant(this.pool, input.tenantId, async (client) => {
        await client.query(
          "UPDATE control.social_accounts SET refresh_status='refresh_failed',status='reauthorization_required',health_status='degraded',updated_at=now() WHERE token_reference=$1",
          [account.token_reference],
        );
      });
      throw error;
    }
  }

  public async revokeAccount(input: {
    tenantId: string;
    accountId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    const account = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          provider: SocialProviderId;
          token_reference: string;
        }>(
          "SELECT provider,token_reference FROM control.social_accounts WHERE id=$1",
          [input.accountId],
        );
        if (!result.rows[0]) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND");
        return result.rows[0];
      },
    );
    const current = JSON.parse(
      await this.secrets.resolve(account.token_reference, {
        tenantId: input.tenantId,
        connectionId: input.accountId,
      }),
    ) as OAuthTokenSet;
    await this.#adapter(account.provider).revoke(current);
    await this.secrets.revoke(account.token_reference, {
      tenantId: input.tenantId,
      connectionId: input.accountId,
    });
    await withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        "UPDATE control.social_accounts SET refresh_status='revoked',status='revoked',health_status='unavailable',updated_at=now() WHERE token_reference=$1",
        [account.token_reference],
      );
      await this.#recordLifecycle(client, input, "social.oauth_revoked");
    });
  }

  async #recordLifecycle(
    client: DatabaseClient,
    input: {
      tenantId: string;
      accountId: string;
      actorUserId: string;
      correlationId: string;
    },
    action: string,
  ): Promise<void> {
    const auditId = randomUUID();
    await client.query(
      "INSERT INTO control.audit_events (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id) VALUES ($1,$2,$3,$4,'social_account',$5,$6)",
      [
        auditId,
        input.tenantId,
        input.actorUserId,
        action,
        input.accountId,
        input.correlationId,
      ],
    );
    await client.query(
      "INSERT INTO control.outbox_events (id,tenant_id,event_type,event_version,payload,correlation_id) VALUES ($1,$2,$3,1,$4,$5)",
      [
        randomUUID(),
        input.tenantId,
        action,
        { auditEventId: auditId, accountId: input.accountId },
        input.correlationId,
      ],
    );
  }
}
