import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  manifestChecksum,
  referenceConnectorManifest,
  type ConnectionDescriptor,
  type ConnectorHealth,
  type ConnectorManifest,
  type ConnectorRuntimeStore,
  type StoredIdempotentResult,
} from "@redi-control/connector-sdk";
import { businessSiteInformationManifest } from "@redi-control/website-control";
import pg from "pg";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export { localDemoIds, prepareLocalDemoData } from "./local-demo.js";

export function createPool(
  connectionString: string,
  applicationName: string,
): DatabasePool {
  return new Pool({
    application_name: applicationName,
    connectionString,
    max: 10,
    statement_timeout: 10_000,
  });
}

export async function withTenant<T>(
  pool: DatabasePool,
  tenantId: string,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface MigrationOptions {
  readonly adminUrl: string;
  readonly runtimePassword: string;
  readonly authPassword: string;
  readonly migrationsDirectory?: string;
}

export async function migrateDatabase(
  options: MigrationOptions,
): Promise<void> {
  const pool = createPool(options.adminUrl, "redi-control-migrator");
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'redi_control_runtime') THEN
          CREATE ROLE redi_control_runtime LOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'redi_control_auth') THEN
          CREATE ROLE redi_control_auth LOGIN;
        END IF;
      END $$;
      ALTER ROLE redi_control_runtime WITH LOGIN PASSWORD ${sqlLiteral(options.runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
      ALTER ROLE redi_control_auth WITH LOGIN PASSWORD ${sqlLiteral(options.authPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    `);
    await pool.query("CREATE SCHEMA IF NOT EXISTS control");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS control.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const directory =
      options.migrationsDirectory ??
      fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
    const files = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await pool.query<{ checksum: string }>(
        "SELECT checksum FROM control.schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount === 1) {
        if (existing.rows[0]?.checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO control.schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    await pool.query(`
      GRANT USAGE ON SCHEMA control TO redi_control_runtime, redi_control_auth;
      GRANT SELECT ON control.schema_migrations TO redi_control_runtime;
      GRANT SELECT ON control.tenants, control.users TO redi_control_runtime;
      GRANT SELECT, INSERT, DELETE ON control.memberships TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.member_invitations TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.audit_events TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.outbox_events, control.jobs TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON control.feature_flags TO redi_control_runtime;
      GRANT SELECT ON control.platform_definitions, control.connector_versions TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.white_label_installations, control.platform_connections TO redi_control_runtime;
      GRANT SELECT ON control.business_workspaces TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.connector_health_checks, control.connector_idempotency TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON control.connector_rate_limits TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.media_assets, control.media_upload_sessions,
        control.media_deletion_workflows, control.oauth_transactions, control.social_accounts,
        control.social_drafts, control.social_draft_targets, control.social_approvals,
        control.publication_attempts, control.social_metric_observations
        TO redi_control_runtime;
      GRANT SELECT, INSERT, DELETE ON control.media_objects, control.media_usage_references TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.social_draft_revisions TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.installation_profiles,
        control.installation_domains, control.installation_oauth_applications,
        control.installation_entitlements TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.website_connection_profiles TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.content_items, control.content_item_variants TO redi_control_runtime;
      GRANT SELECT, INSERT, DELETE ON control.content_item_media TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.content_website_drafts TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.content_website_draft_revisions,
        control.content_website_draft_media TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.content_website_draft_reviews
        TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON control.editorial_story_assignments TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.media_profiles, control.source_registry,
        control.research_cases, control.research_claims, control.editorial_candidates TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.source_performance_observations,
        control.research_case_sources, control.research_evidence TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.source_provider_configurations,
        control.source_feeds, control.discovery_runs, control.discovery_results TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.provider_usage_events TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.ai_model_routes, control.ai_budget_policies,
        control.ai_runs, control.research_claim_proposals, control.research_evidence_proposals TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.ai_route_proposals, control.ai_route_evaluations TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.video_briefs,
        control.video_script_approvals TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.video_brief_evidence,
        control.video_script_revisions, control.video_command_receipts,
        control.video_render_preparations, control.video_render_outputs,
        control.video_generation_usage_events TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.video_generation_policies,
        control.video_render_jobs, control.video_render_asset_reviews
        TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.video_social_distribution_handoffs
        TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.video_website_content_handoffs
        TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.ai_usage_events TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.evidence_packs, control.factual_syntheses,
        control.synthesis_promotions TO redi_control_runtime;
      GRANT SELECT, INSERT ON control.media_profile_revisions, control.editorial_context_packs,
        control.editorial_draft_promotions TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.editorial_drafts TO redi_control_runtime;
      GRANT EXECUTE ON FUNCTION control.claim_source_ingestion_job(text) TO redi_control_runtime;
      GRANT EXECUTE ON FUNCTION control.resolve_active_installation_domain(text) TO redi_control_runtime;
      GRANT EXECUTE ON FUNCTION control.begin_platform_access(uuid,uuid,text,integer,uuid),
        control.platform_owner_inventory(uuid,uuid,uuid),
        control.platform_owner_lifecycle_requests(uuid,uuid,uuid),
        control.provision_platform_tenant(uuid,uuid,uuid,text,text,text,text,text,text,uuid),
        control.request_platform_tenant_lifecycle(uuid,uuid,uuid,uuid,control.platform_tenant_lifecycle_action,text,uuid),
        control.execute_platform_tenant_lifecycle(uuid,uuid,uuid,uuid,uuid),
        control.platform_owner_tenant_setups(uuid,uuid,uuid),
        control.configure_platform_tenant(uuid,uuid,uuid,uuid,text,text,text[],text,uuid),
        control.platform_owner_api_clients(uuid,uuid,uuid),
        control.issue_platform_api_client(uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid),
        control.revoke_platform_api_client(uuid,uuid,uuid,uuid,uuid),
        control.exchange_installation_api_client(text,text,text,text),
        control.installation_api_control_summary(text),
        control.tenant_api_clients(uuid,uuid),
        control.issue_tenant_api_client(uuid,uuid,text,text,text,timestamptz,uuid),
        control.rotate_tenant_api_client(uuid,uuid,uuid,text,uuid),
        control.revoke_tenant_api_client(uuid,uuid,uuid,uuid),
        control.platform_owner_onboarding(uuid,uuid,uuid),
        control.issue_platform_first_owner_invitation(uuid,uuid,uuid,uuid,text,text,integer,uuid),
        control.revoke_platform_first_owner_invitation(uuid,uuid,uuid,uuid,uuid),
        control.workzone_provisioning_snapshot(uuid,uuid),
        control.workzone_lifecycle_impact(uuid,uuid,uuid),
        control.transition_tenant_workzone(uuid,uuid,uuid,text,text,uuid,uuid),
        control.create_tenant_workzone(uuid,uuid,text,text,text,uuid),
        control.update_tenant_workzone(uuid,uuid,uuid,text,text,uuid),
        control.assign_tenant_workzone_member(uuid,uuid,uuid,uuid,control.workzone_responsibility,uuid),
        control.remove_tenant_workzone_member(uuid,uuid,uuid,uuid,uuid),
        control.workboard_view_snapshot(uuid,uuid),
        control.save_workboard_view(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid),
        control.set_workboard_default_view(uuid,uuid,uuid,uuid),
        control.rename_workboard_view(uuid,uuid,uuid,text,uuid),
        control.duplicate_workboard_view(uuid,uuid,uuid,text,uuid),
        control.delete_workboard_view(uuid,uuid,uuid,uuid)
        TO redi_control_runtime;
      GRANT SELECT, INSERT, UPDATE ON control.users, control.sessions,
        control.identity_transactions TO redi_control_auth;
      GRANT SELECT, UPDATE ON control.local_demo_bootstrap_tokens
        TO redi_control_auth;
      GRANT DELETE ON control.identity_transactions TO redi_control_auth;
      GRANT SELECT ON control.tenants, control.memberships,
        control.first_owner_invitations TO redi_control_auth;
    `);
    await registerConnectorVersion(pool, referenceConnectorManifest, "active");
    await registerConnectorVersion(
      pool,
      businessSiteInformationManifest,
      "active",
    );
  } finally {
    await pool.end();
  }
}

export interface SeedResult {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly adminUser: string;
  readonly analystUser: string;
  readonly adminSubject: string;
  readonly analystSubject: string;
  readonly installationA: string;
  readonly installationB: string;
  readonly workspaceA: string;
  readonly workspaceB: string;
  readonly canonicalDomainA: string;
  readonly canonicalDomainB: string;
}

export async function seedLocalTestData(adminUrl: string): Promise<SeedResult> {
  const pool = createPool(adminUrl, "redi-control-local-seed");
  const ids: SeedResult = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    adminUser: randomUUID(),
    analystUser: randomUUID(),
    adminSubject: `local-${randomUUID()}`,
    analystSubject: `local-${randomUUID()}`,
    installationA: randomUUID(),
    installationB: randomUUID(),
    workspaceA: randomUUID(),
    workspaceB: randomUUID(),
    canonicalDomainA: `local-a-${randomUUID().slice(0, 8)}.example.test`,
    canonicalDomainB: `local-b-${randomUUID().slice(0, 8)}.example.test`,
  };
  try {
    await pool.query("BEGIN");
    await pool.query(
      `INSERT INTO control.tenants (id, slug, display_name) VALUES ($1, $2, 'Local Tenant A'), ($3, $4, 'Local Tenant B')`,
      [
        ids.tenantA,
        `local-a-${ids.tenantA.slice(0, 8)}`,
        ids.tenantB,
        `local-b-${ids.tenantB.slice(0, 8)}`,
      ],
    );
    await pool.query(
      `INSERT INTO control.users (id, identity_subject, email) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        ids.adminUser,
        `local|${ids.adminSubject}`,
        `admin-${ids.adminUser}@example.invalid`,
        ids.analystUser,
        `local|${ids.analystSubject}`,
        `analyst-${ids.analystUser}@example.invalid`,
      ],
    );
    await pool.query(
      `INSERT INTO control.memberships (tenant_id, user_id, role) VALUES ($1, $2, 'white_label_owner'), ($3, $4, 'analyst')`,
      [ids.tenantA, ids.adminUser, ids.tenantB, ids.analystUser],
    );
    await registerConnectorVersion(pool, referenceConnectorManifest, "active");
    await registerConnectorVersion(
      pool,
      businessSiteInformationManifest,
      "active",
    );
    await pool.query(
      `INSERT INTO control.white_label_installations
       (id, tenant_id, slug, display_name, data_region)
       VALUES ($1, $2, $3, 'Local Installation A', 'EU'),
              ($4, $5, $6, 'Local Installation B', 'EU')`,
      [
        ids.installationA,
        ids.tenantA,
        `install-a-${ids.installationA.slice(0, 8)}`,
        ids.installationB,
        ids.tenantB,
        `install-b-${ids.installationB.slice(0, 8)}`,
      ],
    );
    await pool.query(
      `INSERT INTO control.business_workspaces
       (id, tenant_id, installation_id, slug, name)
       VALUES ($1, $2, $3, 'local-workspace-a', 'Local Workspace A'),
              ($4, $5, $6, 'local-workspace-b', 'Local Workspace B')`,
      [
        ids.workspaceA,
        ids.tenantA,
        ids.installationA,
        ids.workspaceB,
        ids.tenantB,
        ids.installationB,
      ],
    );
    await pool.query(
      `INSERT INTO control.feature_flags (tenant_id, name, enabled) VALUES
       ($1, 'module.overview', true), ($1, 'module.social', true), ($1, 'module.media', true), ($1, 'module.websites', true), ($1, 'module.unified-content', true), ($1, 'module.media-intelligence', true),
       ($1, 'provider.tiktok', false), ($1, 'module.platform-registry', true),
       ($2, 'module.overview', true), ($2, 'module.social', true), ($2, 'module.media', true), ($2, 'module.websites', true), ($2, 'module.unified-content', true), ($2, 'module.media-intelligence', true),
       ($2, 'provider.tiktok', false), ($2, 'module.platform-registry', true)`,
      [ids.tenantA, ids.tenantB],
    );
    await pool.query(
      `INSERT INTO control.installation_profiles
       (installation_id,tenant_id,brand,enabled_modules,privacy_url,terms_url,data_deletion_url,support_url)
       VALUES ($1,$2,$3,ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],'https://legal.example.test/privacy','https://legal.example.test/terms','https://legal.example.test/data-deletion','https://support.example.test'),
              ($4,$5,$6,ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],'https://legal.example.test/privacy','https://legal.example.test/terms','https://legal.example.test/data-deletion','https://support.example.test')`,
      [
        ids.installationA,
        ids.tenantA,
        { name: "Local Installation A" },
        ids.installationB,
        ids.tenantB,
        { name: "Local Installation B" },
      ],
    );
    await pool.query(
      `INSERT INTO control.installation_domains
       (id,tenant_id,installation_id,hostname,domain_kind,status,verified_at,activated_at)
       VALUES ($1,$2,$3,$4,'canonical','active',now(),now()),
              ($5,$6,$7,$8,'canonical','active',now(),now())`,
      [
        randomUUID(),
        ids.tenantA,
        ids.installationA,
        ids.canonicalDomainA,
        randomUUID(),
        ids.tenantB,
        ids.installationB,
        ids.canonicalDomainB,
      ],
    );
    await pool.query(
      `INSERT INTO control.installation_oauth_applications
       (id,tenant_id,installation_id,provider,application_mode,client_id_reference,client_secret_reference,status,configured_at)
       VALUES ($1,$2,$3,'meta','shared','secret://shared/meta/client-id','secret://shared/meta/client-secret','active',now()),
              ($4,$2,$3,'youtube','shared','secret://shared/google/client-id','secret://shared/google/client-secret','active',now()),
              ($5,$6,$7,'meta','dedicated','secret://installation-b/meta/client-id','secret://installation-b/meta/client-secret','active',now()),
              ($8,$6,$7,'youtube','dedicated','secret://installation-b/google/client-id','secret://installation-b/google/client-secret','active',now())`,
      [
        randomUUID(),
        ids.tenantA,
        ids.installationA,
        randomUUID(),
        randomUUID(),
        ids.tenantB,
        ids.installationB,
        randomUUID(),
      ],
    );
    await pool.query(
      `INSERT INTO control.installation_entitlements
       (installation_id,tenant_id,plan_id,enabled_modules,maximum_businesses,maximum_workspaces,
        maximum_social_accounts,monthly_publication_quota,storage_quota_bytes,maximum_users,
        provider_availability,shared_oauth_allowed,dedicated_oauth_allowed)
       VALUES ($1,$2,'local_shared',ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],1,2,5,100,1073741824,10,ARRAY['meta','youtube']::control.social_provider[],true,false),
              ($3,$4,'local_dedicated',ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],1,2,5,100,1073741824,10,ARRAY['meta','youtube']::control.social_provider[],false,true)`,
      [ids.installationA, ids.tenantA, ids.installationB, ids.tenantB],
    );
    await pool.query("COMMIT");
    return ids;
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

export async function registerConnectorVersion(
  pool: DatabasePool,
  manifest: ConnectorManifest,
  status: "draft" | "pending" | "active" = "draft",
): Promise<void> {
  await pool.query(
    `INSERT INTO control.platform_definitions
     (id, display_name, category, status, documentation_status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
       category = EXCLUDED.category, status = EXCLUDED.status, updated_at = now()`,
    [
      manifest.platformId,
      manifest.displayName,
      manifest.category,
      status,
      manifest.category === "reference" ? "local_only" : "proposed",
    ],
  );
  await pool.query(
    `INSERT INTO control.connector_versions
     (connector_id, connector_version, platform_id, manifest, manifest_checksum, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (connector_id, connector_version) DO UPDATE
     SET manifest = EXCLUDED.manifest, manifest_checksum = EXCLUDED.manifest_checksum,
         status = EXCLUDED.status`,
    [
      manifest.connectorId,
      manifest.connectorVersion,
      manifest.platformId,
      manifest,
      manifestChecksum(manifest),
      status,
    ],
  );
}

export async function verifyRuntimeRole(pool: DatabasePool): Promise<void> {
  const result = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  if (result.rows[0]?.rolbypassrls || result.rows[0]?.rolsuper) {
    throw new Error("Runtime database role must not be superuser or BYPASSRLS");
  }
}

export interface ClaimedJob {
  readonly id: string;
  readonly tenantId: string;
  readonly jobType: string;
  readonly payload: Record<string, unknown>;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

export async function claimNextJob(
  pool: DatabasePool,
  tenantId: string,
  workerId: string,
): Promise<ClaimedJob | null> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      tenant_id: string;
      job_type: string;
      payload: Record<string, unknown>;
      attempt_count: number;
      max_attempts: number;
    }>(
      `UPDATE control.jobs job
       SET status = 'running', locked_at = now(), locked_by = $1,
           attempt_count = attempt_count + 1, updated_at = now()
       WHERE job.id = (
         SELECT candidate.id FROM control.jobs candidate
         WHERE candidate.status IN ('pending', 'failed') AND candidate.available_at <= now()
           AND candidate.attempt_count < candidate.max_attempts
         ORDER BY candidate.available_at, candidate.created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, tenant_id, job_type, payload, attempt_count, max_attempts`,
      [workerId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          jobType: row.job_type,
          payload: row.payload,
          attemptCount: row.attempt_count,
          maxAttempts: row.max_attempts,
        }
      : null;
  });
}

export async function finishJob(
  pool: DatabasePool,
  job: Pick<ClaimedJob, "id" | "tenantId">,
  outcome:
    | { readonly status: "succeeded" }
    | { readonly status: "failed"; readonly error: string },
): Promise<void> {
  await withTenant(pool, job.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE control.jobs
       SET status = CASE
         WHEN $2 = 'succeeded' THEN 'succeeded'::control.job_status
         WHEN attempt_count >= max_attempts THEN 'dead_letter'::control.job_status
         ELSE 'failed'::control.job_status END,
       last_error = $3, locked_at = NULL, locked_by = NULL, updated_at = now()
       ,available_at = CASE WHEN $2 = 'failed' AND attempt_count < max_attempts
         THEN now() + make_interval(secs => LEAST(300, power(2, attempt_count)::int))
         ELSE available_at END
       WHERE id = $1 AND status = 'running'`,
      [
        job.id,
        outcome.status,
        outcome.status === "failed" ? outcome.error.slice(0, 1000) : null,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("Job is not in a finishable state");
  });
}

export async function claimNextSourceIngestionJob(
  pool: DatabasePool,
  workerId: string,
): Promise<ClaimedJob | null> {
  const result = await pool.query<{
    id: string;
    tenant_id: string;
    job_type: string;
    payload: Record<string, unknown>;
    attempt_count: number;
    max_attempts: number;
  }>("SELECT * FROM control.claim_source_ingestion_job($1)", [workerId]);
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        tenantId: row.tenant_id,
        jobType: row.job_type,
        payload: row.payload,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      }
    : null;
}

async function insertConnectorAuditAndOutbox(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id, tenant_id, actor_user_id, action, target_type, target_id, correlation_id, metadata)
     VALUES ($1, $2, $3, $4, 'platform_connection', $5, $6, $7)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetId,
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
      { auditEventId: auditId, connectionId: input.targetId },
      input.correlationId,
    ],
  );
}

export interface CreateReferenceConnectionInput {
  readonly tenantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
}

export async function createReferenceConnection(
  pool: DatabasePool,
  input: CreateReferenceConnectionInput,
): Promise<string> {
  const id = randomUUID();
  await withTenant(pool, input.tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO control.platform_connections
       (id, tenant_id, installation_id, workspace_id, connector_id,
        connector_version, environment, status, required_scopes,
        granted_scopes, discovered_capabilities)
       SELECT $1, $2, installation.id, workspace.id, 'reference-saas-local',
              '1.0.0', 'local', 'active', ARRAY['profile.read'],
              ARRAY['profile.read'], ARRAY['profile.read']
       FROM control.white_label_installations installation
       JOIN control.business_workspaces workspace
         ON workspace.installation_id = installation.id AND workspace.tenant_id = installation.tenant_id
       WHERE installation.id = $3 AND workspace.id = $4
       RETURNING id`,
      [id, input.tenantId, input.installationId, input.workspaceId],
    );
    if (result.rowCount !== 1)
      throw new Error("Installation or workspace not found");
    await insertConnectorAuditAndOutbox(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "connector.connection_created",
      targetId: id,
      correlationId: input.correlationId,
      metadata: {
        connectorId: "reference-saas-local",
        connectorVersion: "1.0.0",
      },
    });
  });
  return id;
}

export async function disableConnection(
  pool: DatabasePool,
  input: {
    tenantId: string;
    connectionId: string;
    actorUserId: string;
    correlationId: string;
  },
): Promise<boolean> {
  return withTenant(pool, input.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE control.platform_connections SET status = 'disabled',
       disabled_reason = 'disabled_by_operator', updated_at = now()
       WHERE id = $1 AND status NOT IN ('disabled', 'revoked')`,
      [input.connectionId],
    );
    if (result.rowCount !== 1) return false;
    await insertConnectorAuditAndOutbox(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "connector.connection_disabled",
      targetId: input.connectionId,
      correlationId: input.correlationId,
    });
    return true;
  });
}

export interface CreateBusinessSiteWebsiteConnectionInput {
  readonly tenantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly environment: "local" | "test" | "sandbox" | "production";
  readonly secretReference: string;
  readonly apiBaseUrl: string;
  readonly integrationId: string;
  readonly displayName: string;
  readonly domain: string;
  readonly previewUrl?: string;
  readonly grantedScopes: readonly string[];
}

export async function createBusinessSiteWebsiteConnection(
  pool: DatabasePool,
  input: CreateBusinessSiteWebsiteConnectionInput,
): Promise<string> {
  const id = randomUUID();
  const capabilities = businessSiteInformationManifest.capabilities.map(
    (capability) => capability.id,
  );
  const declaredScopes = new Set(
    businessSiteInformationManifest.scopes.map((scope) => scope.id),
  );
  if (
    !input.grantedScopes.length ||
    input.grantedScopes.some((scope) => !declaredScopes.has(scope))
  )
    throw new Error("Invalid website connector scopes");
  await withTenant(pool, input.tenantId, async (client) => {
    const connection = await client.query(
      `INSERT INTO control.platform_connections
       (id,tenant_id,installation_id,workspace_id,connector_id,connector_version,
        environment,status,required_scopes,granted_scopes,discovered_capabilities,
        secret_reference)
       SELECT $1,$2,installation.id,workspace.id,$5,$6,$7,'active',
         $8::text[],$9::text[],$10::text[],$11
       FROM control.white_label_installations installation
       JOIN control.business_workspaces workspace
         ON workspace.tenant_id=installation.tenant_id
        AND workspace.installation_id=installation.id
       JOIN control.installation_entitlements entitlement
         ON entitlement.tenant_id=installation.tenant_id
        AND entitlement.installation_id=installation.id
        AND 'websites'=ANY(entitlement.enabled_modules)
        AND entitlement.effective_from <= now()
        AND (entitlement.effective_until IS NULL OR entitlement.effective_until > now())
       JOIN control.feature_flags flag
         ON flag.tenant_id=installation.tenant_id
        AND flag.name='module.websites' AND flag.enabled=true
       WHERE installation.id=$3 AND workspace.id=$4 AND installation.status='active'
       RETURNING id`,
      [
        id,
        input.tenantId,
        input.installationId,
        input.workspaceId,
        businessSiteInformationManifest.connectorId,
        businessSiteInformationManifest.connectorVersion,
        input.environment,
        [...declaredScopes],
        [...new Set(input.grantedScopes)],
        capabilities,
        input.secretReference,
      ],
    );
    if (connection.rowCount !== 1)
      throw new Error(
        "Website module is not entitled or workspace is unavailable",
      );
    await client.query(
      `INSERT INTO control.website_connection_profiles
       (connection_id,tenant_id,api_base_url,external_integration_id,
        display_name,domain,preview_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        input.tenantId,
        input.apiBaseUrl,
        input.integrationId,
        input.displayName,
        input.domain.toLowerCase(),
        input.previewUrl ?? null,
      ],
    );
    await insertConnectorAuditAndOutbox(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "website.connection_created",
      targetId: id,
      correlationId: input.correlationId,
      metadata: {
        connectorId: businessSiteInformationManifest.connectorId,
        connectorVersion: businessSiteInformationManifest.connectorVersion,
        domain: input.domain.toLowerCase(),
      },
    });
  });
  return id;
}

export interface WebsiteConnectionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly displayName: string;
  readonly domain: string;
  readonly previewUrl: string | null;
  readonly status: ConnectionDescriptor["status"];
  readonly capabilities: readonly string[];
  readonly healthStatus: ConnectorHealth["status"] | "unknown";
  readonly lastHealthAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly articleStatusSummary: Readonly<Record<string, number>>;
}

export function listWebsiteConnections(
  pool: DatabasePool,
  tenantId: string,
): Promise<readonly WebsiteConnectionSummary[]> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      workspace_id: string;
      provider: string;
      display_name: string;
      domain: string;
      preview_url: string | null;
      status: ConnectionDescriptor["status"];
      discovered_capabilities: string[];
      health_status: WebsiteConnectionSummary["healthStatus"];
      last_health_at: Date | null;
      last_synced_at: Date | null;
      article_status_summary: Record<string, number>;
    }>(
      `SELECT connection.id,connection.workspace_id,profile.provider,
        profile.display_name,profile.domain,profile.preview_url,connection.status,
        connection.discovered_capabilities,connection.health_status,
        connection.last_health_at,profile.last_synced_at,
        profile.article_status_summary
       FROM control.platform_connections connection
       JOIN control.website_connection_profiles profile
         ON profile.tenant_id=connection.tenant_id
        AND profile.connection_id=connection.id
       ORDER BY profile.display_name,connection.created_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      provider: row.provider,
      displayName: row.display_name,
      domain: row.domain,
      previewUrl: row.preview_url,
      status: row.status,
      capabilities: row.discovered_capabilities,
      healthStatus: row.health_status,
      lastHealthAt: row.last_health_at?.toISOString() ?? null,
      lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
      articleStatusSummary: row.article_status_summary,
    }));
  });
}

export function recordWebsiteArticleStatusCount(
  pool: DatabasePool,
  input: {
    tenantId: string;
    connectionId: string;
    status: "draft" | "pending" | "published" | "archived";
    count: number;
  },
): Promise<void> {
  return withTenant(pool, input.tenantId, async (client) => {
    await client.query(
      `UPDATE control.website_connection_profiles
       SET article_status_summary=jsonb_set(
         article_status_summary,ARRAY[$2],to_jsonb($3::integer),true
       ),last_synced_at=now(),updated_at=now()
       WHERE connection_id=$1`,
      [input.connectionId, input.status, input.count],
    );
  });
}

export class PostgresConnectorRuntimeStore implements ConnectorRuntimeStore {
  public constructor(private readonly pool: DatabasePool) {}
  public loadConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<ConnectionDescriptor | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        tenant_id: string;
        connector_id: string;
        connector_version: string;
        status: ConnectionDescriptor["status"];
        granted_scopes: string[];
        discovered_capabilities: string[];
        secret_reference: string | null;
        kill_switched: boolean;
        feature_enabled: boolean;
        configuration: Record<string, unknown> | null;
      }>(
        `SELECT connection.id, connection.tenant_id, connection.connector_id,
          connection.connector_version, connection.status, connection.granted_scopes,
          connection.discovered_capabilities, connection.secret_reference,
          connection.kill_switched,
          COALESCE(flag.enabled, false) AND (
            platform.category <> 'website' OR (
              COALESCE(website_flag.enabled, false)
              AND entitlement.installation_id IS NOT NULL
            )
          ) AS feature_enabled,
          CASE WHEN website.connection_id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
            'apiBaseUrl',website.api_base_url,
            'integrationId',website.external_integration_id,
            'displayName',website.display_name,
            'domain',website.domain,
            'previewUrl',website.preview_url,
            'allowLocalHttp',connection.environment IN ('local','test')
          )) END AS configuration
         FROM control.platform_connections connection
         JOIN control.connector_versions version
           ON version.connector_id=connection.connector_id
          AND version.connector_version=connection.connector_version
         JOIN control.platform_definitions platform ON platform.id=version.platform_id
         LEFT JOIN control.feature_flags flag ON flag.tenant_id = connection.tenant_id
           AND flag.name = 'module.platform-registry'
         LEFT JOIN control.feature_flags website_flag
           ON website_flag.tenant_id=connection.tenant_id
          AND website_flag.name='module.websites'
         LEFT JOIN control.installation_entitlements entitlement
           ON entitlement.tenant_id=connection.tenant_id
          AND entitlement.installation_id=connection.installation_id
          AND 'websites'=ANY(entitlement.enabled_modules)
          AND entitlement.effective_from <= now()
          AND (entitlement.effective_until IS NULL OR entitlement.effective_until > now())
         LEFT JOIN control.website_connection_profiles website
           ON website.tenant_id=connection.tenant_id
          AND website.connection_id=connection.id
         WHERE connection.id = $1`,
        [connectionId],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            tenantId: row.tenant_id,
            connectorId: row.connector_id,
            connectorVersion: row.connector_version,
            status: row.status,
            grantedScopes: row.granted_scopes,
            discoveredCapabilities: row.discovered_capabilities,
            ...(row.secret_reference
              ? { secretReference: row.secret_reference }
              : {}),
            ...(row.configuration ? { configuration: row.configuration } : {}),
            killSwitched: row.kill_switched,
            featureEnabled: row.feature_enabled,
          }
        : null;
    });
  }
  public consumeRateLimit(
    tenantId: string,
    connectionId: string,
    requests: number,
    windowSeconds: number,
  ): Promise<boolean> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO control.connector_rate_limits
         (tenant_id, connection_id, window_started_at, request_count)
         VALUES ($1, $2, to_timestamp(floor(extract(epoch FROM now()) / $4) * $4), 1)
         ON CONFLICT (tenant_id, connection_id, window_started_at)
         DO UPDATE SET request_count = control.connector_rate_limits.request_count + 1
         WHERE control.connector_rate_limits.request_count < $3
         RETURNING request_count`,
        [tenantId, connectionId, requests, windowSeconds],
      );
      return result.rowCount === 1;
    });
  }
  public loadIdempotentResult(
    tenantId: string,
    connectionId: string,
    commandId: string,
    key: string,
  ): Promise<StoredIdempotentResult | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        request_hash: string;
        result: unknown;
      }>(
        `SELECT request_hash, result FROM control.connector_idempotency
         WHERE connection_id = $1 AND command_id = $2 AND idempotency_key = $3
           AND expires_at > now()`,
        [connectionId, commandId, key],
      );
      const row = result.rows[0];
      return row ? { requestHash: row.request_hash, result: row.result } : null;
    });
  }
  public recordCommandResult(input: {
    tenantId: string;
    connectionId: string;
    commandId: string;
    key?: string;
    requestHash: string;
    result: unknown;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      if (input.key)
        await client.query(
          `INSERT INTO control.connector_idempotency
         (tenant_id, connection_id, command_id, idempotency_key, request_hash, result, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours')
         ON CONFLICT DO NOTHING`,
          [
            input.tenantId,
            input.connectionId,
            input.commandId,
            input.key,
            input.requestHash,
            input.result,
          ],
        );
      await insertConnectorAuditAndOutbox(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "connector.command_executed",
        targetId: input.connectionId,
        correlationId: input.correlationId,
        metadata: { commandId: input.commandId },
      });
    });
  }
  public recordHealth(input: {
    tenantId: string;
    connectionId: string;
    health: ConnectorHealth;
    latencyMs: number;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO control.connector_health_checks
         (id, tenant_id, connection_id, status, latency_ms, safe_reason, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.tenantId,
          input.connectionId,
          input.health.status,
          input.latencyMs,
          input.health.reason ?? null,
          input.correlationId,
        ],
      );
      await client.query(
        `UPDATE control.platform_connections SET health_status = $2::control.connector_health_status,
         status = CASE WHEN $2::text = 'degraded' THEN 'degraded'::control.connector_lifecycle_status ELSE status END,
         last_health_at = now(), last_healthy_at = CASE WHEN $2::text = 'healthy' THEN now() ELSE last_healthy_at END,
         updated_at = now() WHERE id = $1`,
        [input.connectionId, input.health.status],
      );
      await insertConnectorAuditAndOutbox(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "connector.health_checked",
        targetId: input.connectionId,
        correlationId: input.correlationId,
        metadata: { status: input.health.status, latencyMs: input.latencyMs },
      });
    });
  }
}
