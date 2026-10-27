import { createHash, randomUUID } from "node:crypto";
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";
import { z } from "zod";

export const sourceTiers = [
  "primary",
  "strong_reporting",
  "discovery",
] as const;
export const verificationStates = [
  "verified",
  "partially_verified",
  "developing",
  "unverified",
  "conflicting",
  "stale",
] as const;
export const evidenceRelationships = [
  "supports",
  "contradicts",
  "mentions",
  "primary_evidence",
] as const;
type SourceType =
  | "website"
  | "feed"
  | "document"
  | "database"
  | "social"
  | "manual"
  | "other";
const rankingSchema = z
  .object({
    freshness: z.number().min(0).max(100),
    trend: z.number().min(0).max(100),
    publicInterest: z.number().min(0).max(100),
    audienceRelevance: z.number().min(0).max(100),
    reliability: z.number().min(0).max(100),
    evidenceStrength: z.number().min(0).max(100),
    wowFactor: z.number().min(0).max(100).default(0),
    visualPotential: z.number().min(0).max(100).default(0),
  })
  .strict();

const shortList = z.array(z.string().min(1).max(240)).max(100);
const defaultLanguageQuality = {
  targetLocale: "en",
  forbidInternalIdentifiers: true as const,
  namedEntityPolicy: "preserve_source_spelling" as const,
  forbiddenTerms: [] as string[],
  glossary: [] as {
    sourceTerm: string;
    preferredTerm: string;
    forbiddenAlternatives: string[];
  }[],
  editorialExamples: [] as string[],
};
export const editorialConfigSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
            name: z.string().min(1).max(160),
            priority: z.number().int().min(0).max(100),
            enabled: z.boolean(),
            satire: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    topicPriorities: z
      .array(
        z
          .object({
            topic: z.string().min(1).max(160),
            priority: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(100),
    style: z
      .object({
        tone: shortList,
        readability: z.enum(["simple", "general", "specialist"]),
        headlineMaxCharacters: z.number().int().min(30).max(240),
        headlineRules: shortList,
        articleMinWords: z.number().int().min(50).max(5000),
        articleMaxWords: z.number().int().min(100).max(10000),
        terminologyRules: shortList,
        languageQuality: z
          .object({
            targetLocale: z.string().min(2).max(20),
            forbidInternalIdentifiers: z.literal(true),
            namedEntityPolicy: z.literal("preserve_source_spelling"),
            forbiddenTerms: shortList,
            glossary: z
              .array(
                z
                  .object({
                    sourceTerm: z.string().min(1).max(160),
                    preferredTerm: z.string().min(1).max(160),
                    forbiddenAlternatives: shortList,
                  })
                  .strict(),
              )
              .max(200),
            editorialExamples: shortList,
          })
          .strict()
          .default(defaultLanguageQuality),
      })
      .strict()
      .refine((v) => v.articleMaxWords >= v.articleMinWords),
    verification: z
      .object({
        strict: z.boolean(),
        allowUnverifiedAsConfirmed: z.literal(false),
        requirePrimaryForImportant: z.boolean(),
        independentCrossChecks: z.number().int().min(0).max(10),
        checkNamesNumbersDatesLocationsInstitutions: z.boolean(),
        scientific: z
          .object({
            requireOriginalSource: z.boolean(),
            requireInstitution: z.boolean(),
            distinguishPeerReview: z.boolean(),
            requireLimitations: z.boolean(),
            distinguishStudySubject: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    sourceRequirements: z
      .object({
        acceptedTiers: z.array(z.enum(sourceTiers)).min(1),
        seriousCrossCheckForImportant: z.boolean(),
      })
      .strict(),
    freshness: z
      .object({
        freshHours: z.number().int().min(1).max(8760),
        staleHours: z.number().int().min(2).max(17520),
        discloseStale: z.boolean(),
      })
      .strict()
      .refine((v) => v.staleHours > v.freshHours),
    destinations: z
      .object({
        website: z.boolean(),
        facebook: z.boolean(),
        instagram: z.boolean(),
      })
      .strict(),
    visual: z
      .object({
        family: z.string().min(1).max(160),
        categoryThemes: z.record(z.string(), z.string().max(160)),
        cardHeadlineMaxCharacters: z.number().int().min(20).max(160),
        supportingFactsMax: z.number().int().min(0).max(6),
        requireSourceAttribution: z.boolean(),
        fullCaptionInsideImage: z.literal(false),
        realPeoplePolicy: z.enum(["licensed_photo_or_thematic_graphic"]),
        generatedImageDisclosure: z.boolean(),
      })
      .strict(),
    approval: z
      .object({
        humanReviewRequired: z.literal(true),
        publishPermissionRequired: z.literal(true),
      })
      .strict(),
    publishing: z
      .object({
        targetsPerDay: z.number().int().min(0).max(100),
        windows: shortList,
      })
      .strict(),
  })
  .strict();
export type EditorialConfig = z.infer<typeof editorialConfigSchema>;

export const defaultEditorialConfig: EditorialConfig = {
  sections: [
    {
      slug: "general",
      name: "General",
      priority: 50,
      enabled: true,
      satire: false,
    },
  ],
  topicPriorities: [],
  style: {
    tone: ["clear", "accurate"],
    readability: "general",
    headlineMaxCharacters: 120,
    headlineRules: ["Never exceed the evidence"],
    articleMinWords: 250,
    articleMaxWords: 1200,
    terminologyRules: ["Explain specialist terms"],
    languageQuality: defaultLanguageQuality,
  },
  verification: {
    strict: true,
    allowUnverifiedAsConfirmed: false,
    requirePrimaryForImportant: true,
    independentCrossChecks: 1,
    checkNamesNumbersDatesLocationsInstitutions: true,
    scientific: {
      requireOriginalSource: true,
      requireInstitution: true,
      distinguishPeerReview: true,
      requireLimitations: true,
      distinguishStudySubject: true,
    },
  },
  sourceRequirements: {
    acceptedTiers: ["primary", "strong_reporting"],
    seriousCrossCheckForImportant: true,
  },
  freshness: { freshHours: 48, staleHours: 168, discloseStale: true },
  destinations: { website: true, facebook: true, instagram: true },
  visual: {
    family: "editorial",
    categoryThemes: {},
    cardHeadlineMaxCharacters: 80,
    supportingFactsMax: 3,
    requireSourceAttribution: true,
    fullCaptionInsideImage: false,
    realPeoplePolicy: "licensed_photo_or_thematic_graphic",
    generatedImageDisclosure: true,
  },
  approval: { humanReviewRequired: true, publishPermissionRequired: true },
  publishing: { targetsPerDay: 0, windows: [] },
};

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function failure(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
async function audit(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events(id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.correlationId,
      input.metadata ?? {},
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id) VALUES($1,$2,$3,1,$4,$5)`,
    [
      randomUUID(),
      input.tenantId,
      input.action,
      { auditEventId: auditId, targetId: input.targetId },
      input.correlationId,
    ],
  );
}
async function available(
  client: DatabaseClient,
  tenantId: string,
  workspaceId: string,
) {
  const r = await client.query(
    `SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.media-intelligence' AND f.enabled WHERE w.tenant_id=$1 AND w.id=$2 AND 'media_intelligence'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now())`,
    [tenantId, workspaceId],
  );
  if (r.rowCount !== 1) throw failure("MEDIA_INTELLIGENCE_NOT_ENTITLED", 403);
}
function map(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}

export class MediaIntelligenceService {
  constructor(private readonly pool: DatabasePool) {}
  async listWorkspaces(input: { tenantId: string }) {
    return withTenant(this.pool, input.tenantId, async (client) =>
      (
        await client.query(
          `SELECT DISTINCT workspace.id,workspace.name,workspace.slug,workspace.description
           FROM control.business_workspaces workspace
           JOIN control.installation_entitlements entitlement
             ON entitlement.tenant_id=workspace.tenant_id
            AND entitlement.installation_id=workspace.installation_id
           WHERE workspace.tenant_id=$1
             AND workspace.lifecycle_status='active'
             AND 'media_intelligence'=ANY(entitlement.enabled_modules)
             AND entitlement.effective_from<=now()
             AND (entitlement.effective_until IS NULL OR entitlement.effective_until>now())
             AND EXISTS (
               SELECT 1 FROM control.feature_flags feature
               WHERE feature.tenant_id=workspace.tenant_id
                 AND feature.name='module.media-intelligence'
                 AND feature.enabled
             )
           ORDER BY workspace.name,workspace.id
           LIMIT 100`,
          [input.tenantId],
        )
      ).rows.map((row) => map(row as Record<string, unknown>)),
    );
  }
  private async resolveAssignmentTarget(
    client: DatabaseClient,
    input: {
      workspaceId: string;
      origin: "research" | "content";
      storyId: string;
    },
  ): Promise<{ researchCaseId: string | null; contentItemId: string | null }> {
    if (input.origin === "research") {
      const research = await client.query<{ id: string }>(
        `SELECT id FROM control.research_cases
         WHERE id=$1 AND workspace_id=$2 AND status<>'archived'`,
        [input.storyId, input.workspaceId],
      );
      if (!research.rows[0]) throw failure("EDITORIAL_STORY_NOT_FOUND", 404);
      return { researchCaseId: research.rows[0].id, contentItemId: null };
    }
    const content = await client.query<{
      id: string;
      research_case_id: string | null;
    }>(
      `WITH promotion_links AS (
         SELECT research_case_id,content_item_id,updated_at AS linked_at
         FROM control.editorial_candidates
         WHERE workspace_id=$2 AND content_item_id IS NOT NULL
         UNION ALL
         SELECT research_case_id,content_item_id,promoted_at AS linked_at
         FROM control.synthesis_promotions WHERE workspace_id=$2
         UNION ALL
         SELECT draft.research_case_id,promotion.content_item_id,promotion.promoted_at AS linked_at
         FROM control.editorial_draft_promotions promotion
         JOIN control.editorial_drafts draft ON draft.id=promotion.editorial_draft_id
         WHERE promotion.workspace_id=$2
       ), linked AS (
         SELECT DISTINCT ON (content_item_id) content_item_id,research_case_id
         FROM promotion_links ORDER BY content_item_id,linked_at DESC,research_case_id
       )
       SELECT item.id,linked.research_case_id
       FROM control.content_items item
       LEFT JOIN linked ON linked.content_item_id=item.id
       WHERE item.id=$1 AND item.workspace_id=$2 AND item.status<>'archived'`,
      [input.storyId, input.workspaceId],
    );
    const row = content.rows[0];
    if (!row) throw failure("EDITORIAL_STORY_NOT_FOUND", 404);
    return row.research_case_id
      ? { researchCaseId: row.research_case_id, contentItemId: null }
      : { researchCaseId: null, contentItemId: row.id };
  }

  async assignStory(input: {
    tenantId: string;
    workspaceId: string;
    origin: "research" | "content";
    storyId: string;
    assigneeUserId: string;
    priority: "normal" | "high" | "urgent";
    dueAt?: Date;
    note?: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const target = await this.resolveAssignmentTarget(c, input);
      const member = await c.query(
        `SELECT 1 FROM control.memberships
         WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`,
        [input.tenantId, input.assigneeUserId],
      );
      if (!member.rows[0]) throw failure("ASSIGNEE_NOT_IN_TENANT", 409);

      if (target.researchCaseId && input.origin === "content") {
        await c.query(
          `DELETE FROM control.editorial_story_assignments
           WHERE content_item_id=$1 AND workspace_id=$2`,
          [input.storyId, input.workspaceId],
        );
      }
      const proposedId = randomUUID();
      const values = [
        proposedId,
        input.tenantId,
        input.workspaceId,
        target.researchCaseId,
        target.contentItemId,
        input.assigneeUserId,
        input.actorUserId,
        input.priority,
        input.dueAt ?? null,
        input.note?.trim() ?? "",
      ];
      const result = target.researchCaseId
        ? await c.query(
            `INSERT INTO control.editorial_story_assignments
             (id,tenant_id,workspace_id,research_case_id,content_item_id,
              assignee_user_id,assigned_by_user_id,priority,due_at,note)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (tenant_id,research_case_id)
               WHERE research_case_id IS NOT NULL
             DO UPDATE SET assignee_user_id=EXCLUDED.assignee_user_id,
               assigned_by_user_id=EXCLUDED.assigned_by_user_id,
               priority=EXCLUDED.priority,due_at=EXCLUDED.due_at,
               note=EXCLUDED.note,updated_at=now()
             RETURNING *`,
            values,
          )
        : await c.query(
            `INSERT INTO control.editorial_story_assignments
             (id,tenant_id,workspace_id,research_case_id,content_item_id,
              assignee_user_id,assigned_by_user_id,priority,due_at,note)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (tenant_id,content_item_id)
               WHERE content_item_id IS NOT NULL
             DO UPDATE SET assignee_user_id=EXCLUDED.assignee_user_id,
               assigned_by_user_id=EXCLUDED.assigned_by_user_id,
               priority=EXCLUDED.priority,due_at=EXCLUDED.due_at,
               note=EXCLUDED.note,updated_at=now()
             RETURNING *`,
            values,
          );
      const id = String((result.rows[0] as Record<string, unknown>).id);
      await audit(c, {
        ...input,
        action: "workzone.story_assigned",
        targetType: "editorial_story_assignment",
        targetId: id,
        metadata: {
          origin: input.origin,
          storyId: input.storyId,
          workspaceId: input.workspaceId,
          assigneeUserId: input.assigneeUserId,
          priority: input.priority,
          dueAt: input.dueAt?.toISOString() ?? null,
        },
      });
      return map(result.rows[0] as Record<string, unknown>);
    });
  }

  async unassignStory(input: {
    tenantId: string;
    workspaceId: string;
    origin: "research" | "content";
    storyId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<boolean> {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const target = await this.resolveAssignmentTarget(c, input);
      const removed = await c.query<{ id: string }>(
        `DELETE FROM control.editorial_story_assignments
         WHERE workspace_id=$1 AND (
           ($2::uuid IS NOT NULL AND research_case_id=$2)
           OR ($3::uuid IS NOT NULL AND content_item_id=$3)
           OR ($4::uuid IS NOT NULL AND content_item_id=$4)
         ) RETURNING id`,
        [
          input.workspaceId,
          target.researchCaseId,
          target.contentItemId,
          input.origin === "content" ? input.storyId : null,
        ],
      );
      if (!removed.rows[0]) return false;
      await audit(c, {
        ...input,
        action: "workzone.story_unassigned",
        targetType: "editorial_story_assignment",
        targetId: removed.rows[0].id,
        metadata: {
          origin: input.origin,
          storyId: input.storyId,
          workspaceId: input.workspaceId,
        },
      });
      return true;
    });
  }
  async createProfile(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    name: string;
    publicationIdentity: string;
    tagline?: string;
    locale: string;
    region?: string;
    country?: string;
    audience?: string;
    categories?: string[];
    toneRules?: string;
    excludedTopics?: string[];
    restrictedTopics?: string[];
    verificationRequirements?: Record<string, unknown>;
    destinationPreferences?: string[];
    cadence?: Record<string, unknown>;
    editorialConfig?: EditorialConfig;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await available(c, input.tenantId, input.workspaceId);
      const id = randomUUID(),
        config = editorialConfigSchema.parse(
          input.editorialConfig ?? defaultEditorialConfig,
        );
      const r = await c.query(
        `INSERT INTO control.media_profiles(id,tenant_id,workspace_id,name,publication_identity,tagline,locale,region,country,audience,categories,tone_rules,excluded_topics,restricted_topics,verification_requirements,destination_preferences,cadence,editorial_config,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.name.trim(),
          input.publicationIdentity.trim(),
          input.tagline?.trim() ?? "",
          input.locale,
          input.region ?? "",
          input.country?.toUpperCase() ?? "",
          input.audience ?? "",
          input.categories ?? [],
          input.toneRules ?? "",
          input.excludedTopics ?? [],
          input.restrictedTopics ?? [],
          input.verificationRequirements ?? {},
          input.destinationPreferences ?? [],
          input.cadence ?? {},
          config,
          input.actorUserId,
        ],
      );
      const snapshot = r.rows[0] as Record<string, unknown>;
      await c.query(
        `INSERT INTO control.media_profile_revisions(id,tenant_id,workspace_id,media_profile_id,version,snapshot,snapshot_hash,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          id,
          snapshot,
          digest(snapshot),
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.profile_created",
        targetType: "media_profile",
        targetId: id,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async updateProfile(input: {
    tenantId: string;
    profileId: string;
    actorUserId: string;
    expectedVersion: number;
    name: string;
    publicationIdentity: string;
    tagline?: string;
    locale: string;
    region?: string;
    country?: string;
    audience?: string;
    categories?: string[];
    toneRules?: string;
    excludedTopics?: string[];
    restrictedTopics?: string[];
    editorialConfig: EditorialConfig;
    correlationId: string;
  }) {
    const config = editorialConfigSchema.parse(input.editorialConfig);
    return withTenant(this.pool, input.tenantId, async (c) => {
      const current = (
        await c.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM control.media_profiles WHERE id=$1`,
          [input.profileId],
        )
      ).rows[0];
      if (!current) throw failure("MEDIA_PROFILE_NOT_FOUND", 404);
      await available(c, input.tenantId, current.workspace_id);
      const r = await c.query(
        `UPDATE control.media_profiles SET name=$3,publication_identity=$4,tagline=$5,locale=$6,region=$7,country=$8,audience=$9,categories=$10,tone_rules=$11,excluded_topics=$12,restricted_topics=$13,editorial_config=$14,configuration_version=configuration_version+1,updated_by=$15,updated_at=now() WHERE id=$1 AND configuration_version=$2 RETURNING *`,
        [
          input.profileId,
          input.expectedVersion,
          input.name.trim(),
          input.publicationIdentity.trim(),
          input.tagline?.trim() ?? "",
          input.locale,
          input.region ?? "",
          input.country?.toUpperCase() ?? "",
          input.audience ?? "",
          input.categories ?? [],
          input.toneRules ?? "",
          input.excludedTopics ?? [],
          input.restrictedTopics ?? [],
          config,
          input.actorUserId,
        ],
      );
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw failure("MEDIA_PROFILE_VERSION_CONFLICT", 409);
      const version = Number(row.configuration_version);
      await c.query(
        `INSERT INTO control.media_profile_revisions(id,tenant_id,workspace_id,media_profile_id,version,snapshot,snapshot_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.tenantId,
          current.workspace_id,
          input.profileId,
          version,
          row,
          digest(row),
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.profile_updated",
        targetType: "media_profile",
        targetId: input.profileId,
        metadata: { version },
      });
      return map(row);
    });
  }
  async listProfiles(input: { tenantId: string; workspaceId?: string }) {
    return withTenant(this.pool, input.tenantId, async (c) =>
      (
        await c.query(
          `SELECT p.* FROM control.media_profiles p WHERE ($1::uuid IS NULL OR p.workspace_id=$1)
           AND EXISTS (SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.media-intelligence' AND f.enabled WHERE w.id=p.workspace_id AND 'media_intelligence'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now()))
           ORDER BY p.updated_at DESC LIMIT 100`,
          [input.workspaceId ?? null],
        )
      ).rows.map((r) => map(r as Record<string, unknown>)),
    );
  }
  async createSource(input: {
    tenantId: string;
    workspaceId: string;
    profileId?: string;
    actorUserId: string;
    name: string;
    sourceType: SourceType;
    canonicalRef: string;
    canonicalDomain?: string;
    tier: (typeof sourceTiers)[number];
    topics?: string[];
    country?: string;
    verificationEligible?: boolean;
    provenance: Record<string, unknown>;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await available(c, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.source_registry(id,tenant_id,workspace_id,media_profile_id,name,source_type,canonical_ref,canonical_domain,tier,topics,country,verification_eligible,provenance,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.profileId ?? null,
          input.name,
          input.sourceType,
          input.canonicalRef,
          input.canonicalDomain ?? "",
          input.tier,
          input.topics ?? [],
          input.country ?? "",
          input.verificationEligible ?? false,
          input.provenance,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.source_created",
        targetType: "research_source",
        targetId: id,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async listSources(input: {
    tenantId: string;
    workspaceId?: string;
    profileId?: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) =>
      (
        await c.query(
          `SELECT s.*,COALESCE(json_agg(json_build_object('metric',o.metric,'value',o.value,'observation',o.observation,'observedAt',o.observed_at)) FILTER(WHERE o.id IS NOT NULL),'[]') observations FROM control.source_registry s LEFT JOIN control.source_performance_observations o ON o.source_id=s.id WHERE ($1::uuid IS NULL OR s.workspace_id=$1) AND ($2::uuid IS NULL OR s.media_profile_id=$2)
           AND EXISTS (SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.media-intelligence' AND f.enabled WHERE w.id=s.workspace_id AND 'media_intelligence'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now()))
           GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 100`,
          [input.workspaceId ?? null, input.profileId ?? null],
        )
      ).rows.map((r) => map(r as Record<string, unknown>)),
    );
  }
  async observeSource(input: {
    tenantId: string;
    workspaceId: string;
    sourceId: string;
    actorUserId: string;
    metric:
      | "reliability"
      | "speed"
      | "freshness"
      | "trend_relevance"
      | "audience_relevance";
    value: number;
    observation: string;
    observedAt: Date;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.source_performance_observations(id,tenant_id,workspace_id,source_id,metric,value,observation,observed_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.sourceId,
          input.metric,
          input.value,
          input.observation,
          input.observedAt,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.source_observed",
        targetType: "research_source",
        targetId: input.sourceId,
        metadata: { metric: input.metric, value: input.value },
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async createCase(input: {
    tenantId: string;
    workspaceId: string;
    profileId: string;
    actorUserId: string;
    title: string;
    topic: string;
    notes?: string;
    freshnessAt?: Date;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await available(c, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.research_cases(id,tenant_id,workspace_id,media_profile_id,title,topic,notes,freshness_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.profileId,
          input.title,
          input.topic,
          input.notes ?? "",
          input.freshnessAt ?? null,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.case_created",
        targetType: "research_case",
        targetId: id,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async listCases(input: {
    tenantId: string;
    workspaceId?: string;
    limit?: number;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) =>
      (
        await c.query(
          `SELECT c.*,count(DISTINCT s.id)::int source_count,count(DISTINCT cl.id)::int claim_count FROM control.research_cases c LEFT JOIN control.research_case_sources s ON s.research_case_id=c.id LEFT JOIN control.research_claims cl ON cl.research_case_id=c.id WHERE ($1::uuid IS NULL OR c.workspace_id=$1)
           AND EXISTS (SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.media-intelligence' AND f.enabled WHERE w.id=c.workspace_id AND 'media_intelligence'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now()))
           GROUP BY c.id ORDER BY c.updated_at DESC LIMIT $2`,
          [input.workspaceId ?? null, Math.min(input.limit ?? 50, 100)],
        )
      ).rows.map((r) => map(r as Record<string, unknown>)),
    );
  }
  async getCase(input: { tenantId: string; caseId: string }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const caseResult = await c.query(
        `SELECT * FROM control.research_cases WHERE id=$1`,
        [input.caseId],
      );
      const sourcesResult = await c.query(
        `SELECT * FROM control.research_case_sources WHERE research_case_id=$1 ORDER BY created_at`,
        [input.caseId],
      );
      const claimsResult = await c.query(
        `SELECT cl.*,COALESCE(json_agg(json_build_object('id',e.id,'caseSourceId',e.case_source_id,'relationship',e.relationship,'notes',e.notes)) FILTER(WHERE e.id IS NOT NULL),'[]') evidence FROM control.research_claims cl LEFT JOIN control.research_evidence e ON e.claim_id=cl.id WHERE cl.research_case_id=$1 GROUP BY cl.id ORDER BY cl.created_at`,
        [input.caseId],
      );
      const candidatesResult = await c.query(
        `SELECT * FROM control.editorial_candidates WHERE research_case_id=$1 ORDER BY created_at`,
        [input.caseId],
      );
      if (!caseResult.rows[0]) throw failure("RESEARCH_CASE_NOT_FOUND", 404);
      await available(
        c,
        input.tenantId,
        String((caseResult.rows[0] as Record<string, unknown>).workspace_id),
      );
      return {
        case: map(caseResult.rows[0] as Record<string, unknown>),
        sources: sourcesResult.rows.map((r) =>
          map(r as Record<string, unknown>),
        ),
        claims: claimsResult.rows.map((r) => map(r as Record<string, unknown>)),
        candidates: candidatesResult.rows.map((r) =>
          map(r as Record<string, unknown>),
        ),
      };
    });
  }
  async attachSource(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    registrySourceId?: string;
    actorUserId: string;
    sourceRef: string;
    title: string;
    publisher?: string;
    publicationAt?: Date;
    retrievedAt: Date;
    sourceType: SourceType;
    tier: (typeof sourceTiers)[number];
    classification?: string;
    notes?: string;
    provenance: Record<string, unknown>;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.research_case_sources(id,tenant_id,workspace_id,research_case_id,registry_source_id,source_ref,title,publisher,publication_at,retrieved_at,source_type,tier,classification,notes,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.registrySourceId ?? null,
          input.sourceRef,
          input.title,
          input.publisher ?? "",
          input.publicationAt ?? null,
          input.retrievedAt,
          input.sourceType,
          input.tier,
          input.classification ?? "",
          input.notes ?? "",
          input.provenance,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.case_source_attached",
        targetType: "research_case",
        targetId: input.caseId,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async addClaim(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    statement: string;
    importance: "low" | "medium" | "high" | "critical";
    verificationState: (typeof verificationStates)[number];
    verificationExplanation: string;
    conflictNotes?: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.research_claims(id,tenant_id,workspace_id,research_case_id,statement,importance,verification_state,verification_explanation,conflict_notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.statement,
          input.importance,
          input.verificationState,
          input.verificationExplanation,
          input.conflictNotes ?? "",
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.claim_added",
        targetType: "research_case",
        targetId: input.caseId,
        metadata: { claimId: id, state: input.verificationState },
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async linkEvidence(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    claimId: string;
    caseSourceId: string;
    actorUserId: string;
    relationship: (typeof evidenceRelationships)[number];
    notes?: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.research_evidence(id,tenant_id,workspace_id,research_case_id,claim_id,case_source_id,relationship,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.claimId,
          input.caseSourceId,
          input.relationship,
          input.notes ?? "",
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.evidence_linked",
        targetType: "research_case",
        targetId: input.caseId,
        metadata: {
          claimId: input.claimId,
          caseSourceId: input.caseSourceId,
          relationship: input.relationship,
        },
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async createCandidate(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    title: string;
    summary?: string;
    ranking: unknown;
    rankingExplanation: string;
    section?: string;
    eventDate?: Date;
    recommendationReason?: string;
    verificationState?: (typeof verificationStates)[number];
    primarySourceId?: string;
    crossCheckSourceIds?: string[];
    correlationId: string;
  }) {
    const ranking = rankingSchema.parse(input.ranking);
    return withTenant(this.pool, input.tenantId, async (c) => {
      const sourceIds = [
        ...(input.primarySourceId ? [input.primarySourceId] : []),
        ...(input.crossCheckSourceIds ?? []),
      ];
      if (sourceIds.length) {
        const found = await c.query(
          `SELECT id FROM control.research_case_sources WHERE research_case_id=$1 AND id=ANY($2::uuid[])`,
          [input.caseId, sourceIds],
        );
        if (found.rowCount !== new Set(sourceIds).size)
          throw failure("CANDIDATE_SOURCE_NOT_FOUND", 400);
      }
      const id = randomUUID();
      const r = await c.query(
        `INSERT INTO control.editorial_candidates(id,tenant_id,workspace_id,research_case_id,title,summary,ranking,ranking_explanation,section,event_date,recommendation_reason,verification_state,primary_source_id,cross_check_source_ids,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.title,
          input.summary ?? "",
          ranking,
          input.rankingExplanation,
          input.section ?? "",
          input.eventDate ?? null,
          input.recommendationReason ?? "",
          input.verificationState ?? "unverified",
          input.primarySourceId ?? null,
          input.crossCheckSourceIds ?? [],
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.candidate_created",
        targetType: "editorial_candidate",
        targetId: id,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async decideCandidate(input: {
    tenantId: string;
    candidateId: string;
    actorUserId: string;
    decision: "approved" | "rejected";
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE control.editorial_candidates SET status=$2,approved_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND status IN ('draft','ready_for_review') AND ($2='rejected' OR verification_state IN ('verified','partially_verified','developing')) RETURNING *`,
        [input.candidateId, input.decision, input.actorUserId],
      );
      if (!r.rows[0]) throw failure("CANDIDATE_NOT_REVIEWABLE", 409);
      await audit(c, {
        ...input,
        action: `research.candidate_${input.decision}`,
        targetType: "editorial_candidate",
        targetId: input.candidateId,
      });
      return map(r.rows[0] as Record<string, unknown>);
    });
  }
  async promoteCandidate(input: {
    tenantId: string;
    candidateId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const existing = await c.query(
        `SELECT c.*,i.id existing_content_id FROM control.editorial_candidates c LEFT JOIN control.content_items i ON i.id=c.content_item_id WHERE c.id=$1 FOR UPDATE OF c`,
        [input.candidateId],
      );
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw failure("CANDIDATE_NOT_FOUND", 404);
      if (row.content_item_id)
        return { contentItemId: row.content_item_id, idempotent: true };
      if (row.status !== "approved")
        throw failure("CANDIDATE_APPROVAL_REQUIRED", 409);
      await available(c, input.tenantId, String(row.workspace_id));
      const id = randomUUID();
      await c.query(
        `INSERT INTO control.content_items(id,tenant_id,workspace_id,title,summary,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6)`,
        [
          id,
          input.tenantId,
          row.workspace_id,
          row.title,
          row.summary,
          input.actorUserId,
        ],
      );
      await c.query(
        `UPDATE control.editorial_candidates SET status='promoted',content_item_id=$2,updated_at=now() WHERE id=$1`,
        [input.candidateId, id],
      );
      await c.query(
        `UPDATE control.research_cases SET status='promoted',updated_by=$2,updated_at=now() WHERE id=$1`,
        [row.research_case_id, input.actorUserId],
      );
      await audit(c, {
        ...input,
        action: "research.candidate_promoted",
        targetType: "editorial_candidate",
        targetId: input.candidateId,
        metadata: { contentItemId: id, researchCaseId: row.research_case_id },
      });
      return { contentItemId: id, idempotent: false };
    });
  }
}

export const workboardViewStages = [
  "all",
  "research",
  "ready",
  "drafting",
  "review",
  "scheduled",
  "done",
  "attention",
] as const;
export type WorkboardViewStage = (typeof workboardViewStages)[number];
export const workboardAssignmentScopes = ["all", "mine", "unassigned"] as const;
export type WorkboardAssignmentScope =
  (typeof workboardAssignmentScopes)[number];
export const workboardFocuses = [
  "all",
  "attention",
  "overdue",
  "due_soon",
] as const;
export type WorkboardFocus = (typeof workboardFocuses)[number];
export const workboardSortOrders = ["smart", "deadline", "updated"] as const;
export type WorkboardSortOrder = (typeof workboardSortOrders)[number];
export const workboardHandoffFilters = [
  "all",
  "blocked",
  "needs_owner",
  "evidence",
  "content",
  "review",
  "delivery",
  "complete",
] as const;
export type WorkboardHandoffFilter = (typeof workboardHandoffFilters)[number];

export interface WorkboardViewSnapshot {
  readonly maximumSavedViews: number;
  readonly defaultViewId: string | null;
  readonly workspaces: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly savedViews: readonly {
    readonly id: string;
    readonly name: string;
    readonly workspaceId: string;
    readonly stage: WorkboardViewStage;
    readonly query: string;
    readonly assignmentScope: WorkboardAssignmentScope;
    readonly focus: WorkboardFocus;
    readonly handoffFilter: WorkboardHandoffFilter;
    readonly sortOrder: WorkboardSortOrder;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
}

function workboardViewFailure(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  const candidate = failure.message?.split("\n")[0] ?? "";
  const known = new Set([
    "WORKBOARD_VIEW_DENIED",
    "INVALID_WORKBOARD_VIEW",
    "WORKBOARD_VIEW_LIMIT_REACHED",
    "WORKBOARD_VIEW_NOT_FOUND",
    "WORKBOARD_VIEW_NAME_CONFLICT",
  ]);
  const statusCode =
    failure.code === "42501"
      ? 403
      : failure.code === "23514" ||
          (failure.code === "23505" &&
            candidate === "WORKBOARD_VIEW_NAME_CONFLICT")
        ? 409
        : failure.code === "22023"
          ? 400
          : 500;
  const message = known.has(candidate)
    ? candidate
    : statusCode >= 500
      ? "WORKBOARD_VIEW_UNAVAILABLE"
      : "INVALID_WORKBOARD_VIEW";
  throw Object.assign(new Error(message), { statusCode });
}

export class WorkboardViewService {
  public constructor(private readonly pool: DatabasePool) {}

  public async snapshot(input: {
    actorUserId: string;
    tenantId: string;
  }): Promise<WorkboardViewSnapshot> {
    const result = await this.pool
      .query<{
        snapshot: WorkboardViewSnapshot;
      }>(`SELECT control.workboard_view_snapshot($1,$2) snapshot`, [
        input.actorUserId,
        input.tenantId,
      ])
      .catch(workboardViewFailure);
    return result.rows[0]!.snapshot;
  }

  public async save(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
    name: string;
    stage: WorkboardViewStage;
    query: string;
    assignmentScope: WorkboardAssignmentScope;
    focus: WorkboardFocus;
    handoffFilter: WorkboardHandoffFilter;
    sortOrder: WorkboardSortOrder;
    correlationId: string;
  }): Promise<{ id: string }> {
    const result = await this.pool
      .query<{
        id: string;
      }>(
        `SELECT control.save_workboard_view($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id`,
        [
          input.actorUserId,
          input.tenantId,
          input.workspaceId,
          input.name,
          input.stage,
          input.query,
          input.assignmentScope,
          input.focus,
          input.handoffFilter,
          input.sortOrder,
          input.correlationId,
        ],
      )
      .catch(workboardViewFailure);
    return { id: result.rows[0]!.id };
  }

  public async delete(input: {
    actorUserId: string;
    tenantId: string;
    viewId: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.delete_workboard_view($1,$2,$3,$4)`, [
        input.actorUserId,
        input.tenantId,
        input.viewId,
        input.correlationId,
      ])
      .catch(workboardViewFailure);
  }

  public async setDefault(input: {
    actorUserId: string;
    tenantId: string;
    viewId: string | null;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.set_workboard_default_view($1,$2,$3,$4)`, [
        input.actorUserId,
        input.tenantId,
        input.viewId,
        input.correlationId,
      ])
      .catch(workboardViewFailure);
  }

  public async rename(input: {
    actorUserId: string;
    tenantId: string;
    viewId: string;
    name: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.rename_workboard_view($1,$2,$3,$4,$5)`, [
        input.actorUserId,
        input.tenantId,
        input.viewId,
        input.name,
        input.correlationId,
      ])
      .catch(workboardViewFailure);
  }

  public async duplicate(input: {
    actorUserId: string;
    tenantId: string;
    viewId: string;
    name: string;
    correlationId: string;
  }): Promise<{ id: string }> {
    const result = await this.pool
      .query<{
        id: string;
      }>(`SELECT control.duplicate_workboard_view($1,$2,$3,$4,$5) id`, [
        input.actorUserId,
        input.tenantId,
        input.viewId,
        input.name,
        input.correlationId,
      ])
      .catch(workboardViewFailure);
    return { id: result.rows[0]!.id };
  }
}
