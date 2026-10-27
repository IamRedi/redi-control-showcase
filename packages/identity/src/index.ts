import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabasePool } from "@redi-control/database";

export interface IdentityPrincipal {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly mfaVerified: boolean;
}

export interface BeginIdentityRequest {
  readonly redirectUri: string;
}

export interface BeginIdentityResult {
  readonly authorizationUrl: string;
  readonly transaction: string;
}

export interface CompleteIdentityRequest {
  readonly code: string;
  readonly state: string;
  readonly redirectUri: string;
  readonly transaction: string;
}

export interface IdentityAdapter {
  readonly id: string;
  begin(request: BeginIdentityRequest): Promise<BeginIdentityResult>;
  complete(request: CompleteIdentityRequest): Promise<IdentityPrincipal>;
}

export class IdentityUnavailableError extends Error {
  public constructor() {
    super("Identity provider is not configured");
    this.name = "IdentityUnavailableError";
  }
}

export class UnconfiguredIdentityAdapter implements IdentityAdapter {
  public readonly id = "unconfigured";
  public async begin(): Promise<BeginIdentityResult> {
    return Promise.reject(new IdentityUnavailableError());
  }
  public async complete(): Promise<IdentityPrincipal> {
    return Promise.reject(new IdentityUnavailableError());
  }
}

export const sessionPolicy = {
  absoluteLifetimeMs: 8 * 60 * 60 * 1000,
  idleLifetimeMs: 30 * 60 * 1000,
  rotationIntervalMs: 15 * 60 * 1000,
} as const;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeVerifiedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashVerifiedEmail(email: string): string {
  return hashSessionToken(normalizeVerifiedEmail(email));
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly mfaVerified: boolean;
  readonly rotationDue: Date;
  readonly absoluteExpires: Date;
}

export interface CreatedSession extends SessionIdentity {
  readonly token: string;
  readonly csrfToken: string;
}

export interface FirstOwnerInvitationInput {
  readonly tenantId: string;
  readonly installationId: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

export class FirstOwnerInvitationError extends Error {
  public constructor() {
    super("First-owner invitation is invalid or unavailable");
    this.name = "FirstOwnerInvitationError";
  }
}

export class FirstOwnerInvitationStore {
  public constructor(private readonly pool: DatabasePool) {}

  public async issue(input: FirstOwnerInvitationInput): Promise<string> {
    const normalizedEmail = normalizeVerifiedEmail(input.email);
    const maximumExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      normalizedEmail.length > 320 ||
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= Date.now() ||
      input.expiresAt.getTime() > maximumExpiry
    )
      throw new FirstOwnerInvitationError();
    const token = generateSessionToken();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        input.tenantId,
      ]);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [input.tenantId],
      );
      const eligibility = await client.query(
        `SELECT 1
         FROM control.tenants tenant
         JOIN control.white_label_installations installation
           ON installation.tenant_id = tenant.id
         WHERE tenant.id = $1 AND installation.id = $2
           AND tenant.status = 'active' AND installation.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM control.memberships
             WHERE tenant_id = $1 AND role = 'root_owner'
           )
           AND NOT EXISTS (
             SELECT 1 FROM control.first_owner_invitations
             WHERE tenant_id = $1 AND consumed_at IS NULL
               AND revoked_at IS NULL AND expires_at > now()
           )`,
        [input.tenantId, input.installationId],
      );
      if (eligibility.rowCount !== 1) throw new FirstOwnerInvitationError();
      const invitationId = randomUUID();
      await client.query(
        `INSERT INTO control.first_owner_invitations
         (id, tenant_id, installation_id, token_hash, email_hash,
          expires_at, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          invitationId,
          input.tenantId,
          input.installationId,
          hashSessionToken(token),
          hashVerifiedEmail(normalizedEmail),
          input.expiresAt,
          input.correlationId,
        ],
      );
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO control.audit_events
         (id, tenant_id, action, target_type, target_id, correlation_id, metadata)
         VALUES ($1, $2, 'identity.first_owner_invitation_issued',
                 'installation', $3, $4, $5)`,
        [
          auditId,
          input.tenantId,
          input.installationId,
          input.correlationId,
          { invitationId, expiresAt: input.expiresAt.toISOString() },
        ],
      );
      await client.query(
        `INSERT INTO control.outbox_events
         (id, tenant_id, event_type, event_version, payload, correlation_id)
         VALUES ($1, $2, 'identity.first_owner_invitation_issued', 1, $3, $4)`,
        [
          randomUUID(),
          input.tenantId,
          { auditEventId: auditId },
          input.correlationId,
        ],
      );
      await client.query("COMMIT");
      return token;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof FirstOwnerInvitationError) throw error;
      throw error;
    } finally {
      client.release();
    }
  }

  public async isUsable(
    token: string,
    installationId: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const result = await this.pool.query(
      `SELECT 1 FROM control.first_owner_invitations invitation
       WHERE invitation.token_hash = $1
         AND invitation.installation_id = $2
         AND invitation.consumed_at IS NULL
         AND invitation.revoked_at IS NULL
         AND invitation.expires_at > now()`,
      [hashSessionToken(token), installationId],
    );
    return result.rowCount === 1;
  }
}

export interface MemberInvitationInput {
  readonly tenantId: string;
  readonly installationId: string;
  readonly email: string;
  readonly identitySubject: string;
  readonly role: string;
  readonly createdBy: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

export class MemberInvitationError extends Error {
  public constructor() {
    super("Member invitation is invalid or unavailable");
    this.name = "MemberInvitationError";
  }
}

/**
 * Stores the REDI CONTROL side of an invite after Keycloak has created the
 * identity. The invitation is bound to that immutable OIDC subject; no raw
 * recipient address or bearer invitation token is persisted.
 */
export class MemberInvitationStore {
  public constructor(private readonly pool: DatabasePool) {}

  public async issue(input: MemberInvitationInput): Promise<string> {
    const normalizedEmail = normalizeVerifiedEmail(input.email);
    const maximumExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      normalizedEmail.length > 320 ||
      !/^[A-Za-z0-9|:_-]{3,1024}$/.test(input.identitySubject) ||
      !/^[a-z_]{3,80}$/.test(input.role) ||
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= Date.now() ||
      input.expiresAt.getTime() > maximumExpiry
    )
      throw new MemberInvitationError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE control.member_invitations
         SET revoked_at = now()
         WHERE tenant_id = $1 AND email_hash = $2
           AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
        [input.tenantId, hashVerifiedEmail(normalizedEmail)],
      );
      const installation = await client.query(
        `SELECT 1 FROM control.white_label_installations installation
         JOIN control.tenants tenant ON tenant.id = installation.tenant_id
         WHERE installation.id = $1 AND installation.tenant_id = $2
           AND installation.status = 'active' AND tenant.status = 'active'`,
        [input.installationId, input.tenantId],
      );
      if (installation.rowCount !== 1) throw new MemberInvitationError();
      const invitationId = randomUUID();
      await client.query(
        `INSERT INTO control.member_invitations
         (id, tenant_id, installation_id, email_hash, identity_subject, role,
          expires_at, created_by, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6::control.membership_role,$7,$8,$9)`,
        [
          invitationId,
          input.tenantId,
          input.installationId,
          hashVerifiedEmail(normalizedEmail),
          input.identitySubject,
          input.role,
          input.expiresAt,
          input.createdBy,
          input.correlationId,
        ],
      );
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO control.audit_events
         (id, tenant_id, actor_user_id, action, target_type, target_id,
          correlation_id, metadata)
         VALUES ($1,$2,$3,'identity.member_invitation_issued','member_invitation',$4,$5,$6)`,
        [
          auditId,
          input.tenantId,
          input.createdBy,
          invitationId,
          input.correlationId,
          { role: input.role, expiresAt: input.expiresAt.toISOString() },
        ],
      );
      await client.query(
        `INSERT INTO control.outbox_events
         (id, tenant_id, event_type, event_version, payload, correlation_id)
         VALUES ($1,$2,'identity.member_invitation_issued',1,$3,$4)`,
        [
          randomUUID(),
          input.tenantId,
          { auditEventId: auditId },
          input.correlationId,
        ],
      );
      await client.query("COMMIT");
      return invitationId;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new MemberInvitationError();
      throw error;
    } finally {
      client.release();
    }
  }

  public async markDelivered(
    tenantId: string,
    invitationId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      await client.query(
        `UPDATE control.member_invitations
         SET delivered_at = now()
         WHERE id = $1 AND tenant_id = $2 AND consumed_at IS NULL
           AND revoked_at IS NULL AND expires_at > now()`,
        [invitationId, tenantId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface SessionRow {
  session_id: string;
  user_id: string;
  tenant_id: string;
  roles: string[];
  mfa_verified: boolean;
  rotation_due_at: Date;
  absolute_expires_at: Date;
}

export class LocalDemoBootstrapError extends Error {
  public constructor() {
    super("Local demo token is invalid or unavailable");
    this.name = "LocalDemoBootstrapError";
  }
}

export class SessionStore {
  public constructor(private readonly pool: DatabasePool) {}

  public async createLocalDemo(token: string): Promise<CreatedSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LocalDemoBootstrapError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{
        tenant_id: string;
        user_id: string;
      }>(
        `UPDATE control.local_demo_bootstrap_tokens
         SET consumed_at=now()
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()
         RETURNING tenant_id,user_id`,
        [hashSessionToken(token)],
      );
      const resolved = consumed.rows[0];
      if (!resolved) throw new LocalDemoBootstrapError();
      const membership = await client.query<{ roles: string[] }>(
        `SELECT array_agg(role::text ORDER BY role::text) AS roles
         FROM control.memberships
         WHERE tenant_id=$1 AND user_id=$2
         GROUP BY tenant_id,user_id`,
        [resolved.tenant_id, resolved.user_id],
      );
      const roles = membership.rows[0]?.roles;
      if (!roles?.length) throw new LocalDemoBootstrapError();
      const session = await this.insertSession(client, {
        identityProvider: "local-demo",
        mfaVerifiedAt: new Date(),
        roles,
        tenantId: resolved.tenant_id,
        userId: resolved.user_id,
      });
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof LocalDemoBootstrapError) throw error;
      throw error;
    } finally {
      client.release();
    }
  }

  public async create(
    principal: IdentityPrincipal,
    requestedTenantId?: string,
  ): Promise<CreatedSession> {
    if (!principal.emailVerified) {
      throw new Error("Verified email is required");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{ id: string }>(
        `INSERT INTO control.users (id, identity_subject, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (identity_subject) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [
          randomUUID(),
          `${principal.provider}|${principal.subject}`,
          principal.email,
        ],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error("Identity could not be resolved");
      const membership = await client.query<{
        tenant_id: string;
        roles: string[];
      }>(
        `SELECT tenant_id, array_agg(role::text ORDER BY role::text) AS roles
         FROM control.memberships
         WHERE user_id = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
         GROUP BY tenant_id ORDER BY tenant_id LIMIT 1`,
        [userId, requestedTenantId ?? null],
      );
      const selected = membership.rows[0];
      if (!selected)
        throw new Error("Identity has no active tenant membership");
      const created = await this.insertSession(client, {
        identityProvider: principal.provider,
        mfaVerifiedAt: principal.mfaVerified ? new Date() : null,
        roles: selected.roles,
        tenantId: selected.tenant_id,
        userId,
      });
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createMemberFromInvitation(
    principal: IdentityPrincipal,
    installationId: string,
    correlationId: string,
  ): Promise<CreatedSession> {
    if (!principal.emailVerified || !principal.mfaVerified)
      throw new MemberInvitationError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{
        user_id: string;
        tenant_id: string;
        roles: string[];
      }>(
        `SELECT user_id, tenant_id, roles
         FROM control.consume_member_invitation($1,$2,$3,$4,$5,$6,$7)`,
        [
          `${principal.provider}|${principal.subject}`,
          hashVerifiedEmail(principal.email),
          normalizeVerifiedEmail(principal.email),
          principal.provider,
          installationId,
          principal.mfaVerified,
          correlationId,
        ],
      );
      const resolved = consumed.rows[0];
      if (!resolved) throw new MemberInvitationError();
      const session = await this.insertSession(client, {
        identityProvider: principal.provider,
        mfaVerifiedAt: new Date(),
        roles: resolved.roles,
        tenantId: resolved.tenant_id,
        userId: resolved.user_id,
      });
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof MemberInvitationError) throw error;
      if (
        (error as { code?: string; message?: string }).code === "P0001" &&
        (error as { message?: string }).message?.startsWith(
          "MEMBER_INVITATION_",
        )
      )
        throw new MemberInvitationError();
      throw error;
    } finally {
      client.release();
    }
  }

  public async createFirstOwner(
    principal: IdentityPrincipal,
    invitationToken: string,
    installationId: string,
    correlationId: string,
  ): Promise<CreatedSession> {
    if (!principal.emailVerified || !principal.mfaVerified)
      throw new FirstOwnerInvitationError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{
        user_id: string;
        tenant_id: string;
      }>(
        `SELECT user_id, tenant_id
         FROM control.consume_first_owner_invitation($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          hashSessionToken(invitationToken),
          hashVerifiedEmail(principal.email),
          `${principal.provider}|${principal.subject}`,
          normalizeVerifiedEmail(principal.email),
          principal.provider,
          installationId,
          principal.mfaVerified,
          correlationId,
        ],
      );
      const resolved = consumed.rows[0];
      if (!resolved) throw new FirstOwnerInvitationError();
      const session = await this.insertSession(client, {
        identityProvider: principal.provider,
        mfaVerifiedAt: new Date(),
        roles: ["root_owner"],
        tenantId: resolved.tenant_id,
        userId: resolved.user_id,
      });
      await client.query("COMMIT");
      return session;
    } catch {
      await client.query("ROLLBACK");
      throw new FirstOwnerInvitationError();
    } finally {
      client.release();
    }
  }

  public async resolve(token: string): Promise<SessionIdentity | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE control.sessions session
       SET last_seen_at = now(),
           idle_expires_at = LEAST(session.absolute_expires_at, now() + interval '30 minutes')
       WHERE session.token_hash = $1
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > now()
         AND session.absolute_expires_at > now()
       RETURNING session.id AS session_id, session.user_id, session.tenant_id,
         ARRAY(SELECT membership.role::text FROM control.memberships membership
               WHERE membership.user_id = session.user_id AND membership.tenant_id = session.tenant_id
               ORDER BY membership.role::text) AS roles,
         session.mfa_verified_at IS NOT NULL AS mfa_verified,
         session.rotation_due_at, session.absolute_expires_at`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  public async rotate(
    token: string,
    targetTenantId?: string,
  ): Promise<CreatedSession | null> {
    const current = await this.resolve(token);
    if (!current) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const membership = await client.query<{ roles: string[] }>(
        `SELECT array_agg(role::text ORDER BY role::text) AS roles
         FROM control.memberships WHERE user_id = $1 AND tenant_id = $2 GROUP BY tenant_id`,
        [current.userId, targetTenantId ?? current.tenantId],
      );
      const roles = membership.rows[0]?.roles;
      if (!roles) {
        await client.query("ROLLBACK");
        return null;
      }
      const source = await client.query<{
        identity_provider: string;
        mfa_verified_at: Date | null;
      }>(
        `SELECT identity_provider, mfa_verified_at
         FROM control.sessions WHERE id = $1 AND revoked_at IS NULL FOR UPDATE`,
        [current.sessionId],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow) return null;
      const replacement = await this.insertSession(client, {
        identityProvider: sourceRow.identity_provider,
        mfaVerifiedAt: sourceRow.mfa_verified_at,
        roles,
        tenantId: targetTenantId ?? current.tenantId,
        userId: current.userId,
      });
      await client.query(
        "UPDATE control.sessions SET revoked_at = now(), replaced_by = $1 WHERE id = $2",
        [replacement.sessionId, current.sessionId],
      );
      await client.query("COMMIT");
      return replacement;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async revoke(token: string): Promise<SessionIdentity | null> {
    const current = await this.resolve(token);
    if (!current) return null;
    await this.pool.query(
      "UPDATE control.sessions SET revoked_at = now() WHERE id = $1",
      [current.sessionId],
    );
    return current;
  }

  public async verifyCsrf(
    sessionId: string,
    csrfToken: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM control.sessions
       WHERE id = $1 AND csrf_token_hash = $2 AND revoked_at IS NULL
         AND idle_expires_at > now() AND absolute_expires_at > now()`,
      [sessionId, hashSessionToken(csrfToken)],
    );
    return result.rowCount === 1;
  }

  public async hasRecentMfa(
    sessionId: string,
    maximumAgeMinutes = 5,
  ): Promise<boolean> {
    if (
      !Number.isInteger(maximumAgeMinutes) ||
      maximumAgeMinutes < 1 ||
      maximumAgeMinutes > 15
    )
      return false;
    const result = await this.pool.query(
      `SELECT 1 FROM control.sessions WHERE id=$1 AND revoked_at IS NULL
         AND idle_expires_at>now() AND absolute_expires_at>now()
         AND mfa_verified_at>=now()-make_interval(mins=>$2)`,
      [sessionId, maximumAgeMinutes],
    );
    return result.rowCount === 1;
  }

  private async insertSession(
    client: Pick<DatabaseClient, "query">,
    input: {
      userId: string;
      tenantId: string;
      roles: string[];
      identityProvider: string;
      mfaVerifiedAt: Date | null;
    },
  ): Promise<CreatedSession> {
    const now = Date.now();
    const token = generateSessionToken();
    const csrfToken = generateSessionToken();
    const sessionId = randomUUID();
    const rotationDue = new Date(now + sessionPolicy.rotationIntervalMs);
    const idleExpires = new Date(now + sessionPolicy.idleLifetimeMs);
    const absoluteExpires = new Date(now + sessionPolicy.absoluteLifetimeMs);
    await client.query(
      `INSERT INTO control.sessions
       (id, token_hash, csrf_token_hash, user_id, tenant_id, identity_provider, mfa_verified_at,
        rotation_due_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        hashSessionToken(token),
        hashSessionToken(csrfToken),
        input.userId,
        input.tenantId,
        input.identityProvider,
        input.mfaVerifiedAt,
        rotationDue,
        idleExpires,
        absoluteExpires,
      ],
    );
    return {
      token,
      csrfToken,
      sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      roles: input.roles,
      mfaVerified: input.mfaVerifiedAt !== null,
      rotationDue,
      absoluteExpires,
    };
  }

  private mapRow(row: SessionRow): SessionIdentity {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      roles: row.roles,
      mfaVerified: row.mfa_verified,
      rotationDue: row.rotation_due_at,
      absoluteExpires: row.absolute_expires_at,
    };
  }
}

export * from "./oidc.js";
export * from "./keycloak-member-invitations.js";
