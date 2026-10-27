import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { DatabasePool } from "./index.js";

export const localDemoIds = {
  tenantId: "d0420000-0000-4000-8000-000000000001",
  installationId: "d0420000-0000-4000-8000-000000000002",
  workspaceId: "d0420000-0000-4000-8000-000000000003",
  ownerUserId: "d0420000-0000-4000-8000-000000000004",
  editorUserId: "d0420000-0000-4000-8000-000000000005",
  approverUserId: "d0420000-0000-4000-8000-000000000006",
  mediaProfileId: "d0420000-0000-4000-8000-000000000007",
  researchCaseOneId: "d0420000-0000-4000-8000-000000000008",
  researchCaseTwoId: "d0420000-0000-4000-8000-000000000009",
  contentOneId: "d0420000-0000-4000-8000-000000000010",
  contentTwoId: "d0420000-0000-4000-8000-000000000011",
  contentThreeId: "d0420000-0000-4000-8000-000000000012",
  mediaOneId: "d0420000-0000-4000-8000-000000000013",
  mediaTwoId: "d0420000-0000-4000-8000-000000000014",
  facebookAccountId: "d0420000-0000-4000-8000-000000000015",
  instagramAccountId: "d0420000-0000-4000-8000-000000000016",
  reviewDraftId: "d0420000-0000-4000-8000-000000000017",
  scheduledDraftId: "d0420000-0000-4000-8000-000000000018",
  websiteDraftId: "d0420000-0000-4000-8000-000000000019",
  websiteRevisionId: "d0420000-0000-4000-8000-000000000020",
  websiteReviewId: "d0420000-0000-4000-8000-000000000021",
} as const;

export interface PreparedLocalDemo {
  readonly token: string;
  readonly expiresAt: Date;
  readonly workspaceId: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function prepareLocalDemoData(
  pool: DatabasePool,
): Promise<PreparedLocalDemo> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const ids = localDemoIds;
  const reviewRevisionOne = "d0420000-0000-4000-8000-000000000022";
  const reviewRevisionTwo = "d0420000-0000-4000-8000-000000000023";
  const scheduledRevision = "d0420000-0000-4000-8000-000000000024";
  const reviewApproval = "d0420000-0000-4000-8000-000000000025";
  const scheduledApproval = "d0420000-0000-4000-8000-000000000026";
  const reviewFacebookTarget = "d0420000-0000-4000-8000-000000000027";
  const reviewInstagramTarget = "d0420000-0000-4000-8000-000000000028";
  const scheduledFacebookTarget = "d0420000-0000-4000-8000-000000000029";
  const scheduledInstagramTarget = "d0420000-0000-4000-8000-000000000030";
  const websiteHash = digest(
    JSON.stringify({
      slug: "si-te-dallojme-nje-lajm-te-verifikuar",
      title: "Si të dallojmë një lajm të verifikuar",
      excerpt: "Pesë kontrolle të thjeshta para se të ndajmë një lajm.",
      body: {
        version: 1,
        blocks: [
          {
            type: "paragraph",
            text: "Ky është material sintetik për demonstrimin lokal të rrjedhës editoriale.",
          },
        ],
      },
    }),
  );
  const reviewHashOne = digest("local-demo-review-revision-one");
  const reviewHashTwo = digest("local-demo-review-revision-two");
  const scheduledHash = digest("local-demo-scheduled-revision-one");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO control.tenants(id,slug,display_name,status)
       VALUES($1,'aurora-media-demo','Aurora Media Demo — Synthetic','active')
       ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active'`,
      [ids.tenantId],
    );
    await client.query(
      `INSERT INTO control.users(id,identity_subject,email) VALUES
       ($1,'local-demo|owner','owner@demo.invalid'),
       ($2,'local-demo|editor','editor@demo.invalid'),
       ($3,'local-demo|approver','approver@demo.invalid')
       ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email`,
      [ids.ownerUserId, ids.editorUserId, ids.approverUserId],
    );
    await client.query(
      `INSERT INTO control.memberships(tenant_id,user_id,role) VALUES
       ($1,$2,'root_owner'),($1,$2,'white_label_owner'),
       ($1,$3,'editor'),($1,$4,'approver')
       ON CONFLICT DO NOTHING`,
      [ids.tenantId, ids.ownerUserId, ids.editorUserId, ids.approverUserId],
    );
    await client.query(
      `INSERT INTO control.white_label_installations
       (id,tenant_id,slug,display_name,data_region,status)
       VALUES($1,$2,'aurora-media-demo','Aurora Media Demo — Local','EU','active')
       ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active'`,
      [ids.installationId, ids.tenantId],
    );
    await client.query(
      `INSERT INTO control.business_workspaces
       (id,tenant_id,installation_id,slug,name,description)
       VALUES($1,$2,$3,'aurora-media-newsroom','Aurora Media Newsroom — Demo',
         'Synthetic local-only newsroom. No external provider is connected.')
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description`,
      [ids.workspaceId, ids.tenantId, ids.installationId],
    );
    await client.query(
      `INSERT INTO control.installation_profiles
       (installation_id,tenant_id,brand,enabled_locales,default_locale,enabled_modules,
        privacy_url,terms_url,data_deletion_url,support_url)
       VALUES($1,$2,$3,ARRAY['en','de','sq'],'sq',
        ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],
        'https://demo.invalid/privacy','https://demo.invalid/terms',
        'https://demo.invalid/data-deletion','https://demo.invalid/support')
       ON CONFLICT(installation_id) DO UPDATE SET brand=EXCLUDED.brand,
        enabled_locales=EXCLUDED.enabled_locales,default_locale=EXCLUDED.default_locale,
        enabled_modules=EXCLUDED.enabled_modules`,
      [
        ids.installationId,
        ids.tenantId,
        { name: "Aurora Media Demo", environment: "synthetic_local" },
      ],
    );
    await client.query(
      `INSERT INTO control.installation_entitlements
       (installation_id,tenant_id,plan_id,enabled_modules,maximum_businesses,
        maximum_workspaces,maximum_social_accounts,monthly_publication_quota,
        storage_quota_bytes,maximum_users,provider_availability,
        shared_oauth_allowed,dedicated_oauth_allowed)
       VALUES($1,$2,'local_demo',
        ARRAY['platforms','media','social','websites','unified_content','media_intelligence'],
        1,2,5,100,1073741824,10,ARRAY['meta']::control.social_provider[],false,false)
       ON CONFLICT(installation_id) DO UPDATE SET enabled_modules=EXCLUDED.enabled_modules,
        provider_availability=EXCLUDED.provider_availability,
        shared_oauth_allowed=false,dedicated_oauth_allowed=false`,
      [ids.installationId, ids.tenantId],
    );
    await client.query(
      `INSERT INTO control.feature_flags(tenant_id,name,enabled) VALUES
       ($1,'module.overview',true),($1,'module.social',true),
       ($1,'module.media',true),($1,'module.websites',true),
       ($1,'module.unified-content',true),($1,'module.media-intelligence',true),
       ($1,'provider.tiktok',false),($1,'module.platform-registry',true)
       ON CONFLICT(tenant_id,name) DO UPDATE SET enabled=EXCLUDED.enabled`,
      [ids.tenantId],
    );
    await client.query(
      `INSERT INTO control.workzone_team_assignments
       (id,tenant_id,workspace_id,user_id,responsibility,assigned_by) VALUES
       ($1,$2,$3,$4,'lead',$4),($5,$2,$3,$6,'editorial',$4),
       ($7,$2,$3,$8,'approval',$4)
       ON CONFLICT(tenant_id,workspace_id,user_id) DO NOTHING`,
      [
        randomUUID(),
        ids.tenantId,
        ids.workspaceId,
        ids.ownerUserId,
        randomUUID(),
        ids.editorUserId,
        randomUUID(),
        ids.approverUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.media_profiles
       (id,tenant_id,workspace_id,name,publication_identity,locale,region,
        audience,categories,tone_rules,verification_requirements,
        destination_preferences,cadence,created_by,updated_by)
       VALUES($1,$2,$3,'Aurora Media Demo','Aurora Media','sq-AL','DE/AL/XK',
        'Albanian-speaking audience; synthetic local demonstration only.',
        ARRAY['lajme','shpjegime','komunitet'],
        'Clear, concise and source-aware. Never present demo copy as a real report.',
        $4,ARRAY['website','facebook','instagram'],$5,$6,$6)
       ON CONFLICT(id) DO UPDATE SET audience=EXCLUDED.audience,tone_rules=EXCLUDED.tone_rules`,
      [
        ids.mediaProfileId,
        ids.tenantId,
        ids.workspaceId,
        { minimumIndependentSources: 2, humanApprovalRequired: true },
        { timezone: "Europe/Berlin", reviewRequired: true },
        ids.ownerUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.research_cases
       (id,tenant_id,workspace_id,media_profile_id,title,topic,status,freshness_at,
        notes,created_by,updated_by) VALUES
       ($1,$3,$4,$5,'Pyetjet më të shpeshta të javës',
        'Tema sintetike nga pyetjet e audiencës','researching',now(),
        'Demo only: no real messages or personal data were ingested.',$6,$6),
       ($2,$3,$4,$5,'Flash lajmet e mbrëmjes',
        'Përmbledhje sintetike për provën e workflow-t','open',now(),
        'Demo only: sources must be attached before approval.',$7,$7)
       ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes`,
      [
        ids.researchCaseOneId,
        ids.researchCaseTwoId,
        ids.tenantId,
        ids.workspaceId,
        ids.mediaProfileId,
        ids.editorUserId,
        ids.approverUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.content_items
       (id,tenant_id,workspace_id,title,summary,status,created_by,updated_by) VALUES
       ($1,$4,$5,'Si të dallojmë një lajm të verifikuar',
        'Material sintetik për preview dhe review të Website.','draft',$6,$6),
       ($2,$4,$5,'Pesë pyetje që morëm këtë javë',
        'Draft sintetik për Facebook dhe Instagram.','draft',$6,$6),
       ($3,$4,$5,'Flash: përmbledhja e mbrëmjes',
        'Postim sintetik i planifikuar në Europe/Berlin.','draft',$7,$7)
       ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary`,
      [
        ids.contentOneId,
        ids.contentTwoId,
        ids.contentThreeId,
        ids.tenantId,
        ids.workspaceId,
        ids.editorUserId,
        ids.approverUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.media_assets
       (id,tenant_id,workspace_id,created_by,source,original_filename,status,
        processing_status,retention_class,retention_until) VALUES
       ($1,$3,$4,$5,'generated_local','demo-editorial-cover.jpg','ready','ready','temporary',now()+interval '7 days'),
       ($2,$3,$4,$5,'generated_local','demo-news-flash.mp4','ready','ready','temporary',now()+interval '7 days')
       ON CONFLICT(id) DO NOTHING`,
      [
        ids.mediaOneId,
        ids.mediaTwoId,
        ids.tenantId,
        ids.workspaceId,
        ids.ownerUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.social_accounts
       (id,tenant_id,workspace_id,provider,account_type,provider_account_id,
        display_name,token_reference,status,health_status) VALUES
       ($1,$3,$4,'meta','facebook_page','synthetic-facebook',
        'Facebook Demo — not connected','secret://local-demo/unconnected/facebook','pending','unknown'),
       ($2,$3,$4,'meta','instagram_account','synthetic-instagram',
        'Instagram Demo — not connected','secret://local-demo/unconnected/instagram','pending','unknown')
       ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status='pending',health_status='unknown'`,
      [
        ids.facebookAccountId,
        ids.instagramAccountId,
        ids.tenantId,
        ids.workspaceId,
      ],
    );
    await client.query(
      `INSERT INTO control.social_drafts
       (id,tenant_id,workspace_id,author_user_id,current_revision,status) VALUES
       ($1,$3,$4,$5,2,'ready_for_review'),
       ($2,$3,$4,$5,1,'scheduled')
       ON CONFLICT(id) DO NOTHING`,
      [
        ids.reviewDraftId,
        ids.scheduledDraftId,
        ids.tenantId,
        ids.workspaceId,
        ids.editorUserId,
      ],
    );
    await client.query(
      `UPDATE control.social_drafts
       SET scheduled_for=CASE WHEN scheduled_for IS NULL OR scheduled_for<=now()
         THEN date_trunc('day',now() AT TIME ZONE 'Europe/Berlin')
              +interval '1 day 19 hours 30 minutes' ELSE scheduled_for END,
         schedule_timezone='Europe/Berlin',updated_at=now()
       WHERE id=$1 AND status='scheduled'`,
      [ids.scheduledDraftId],
    );
    await client.query(
      `INSERT INTO control.social_draft_revisions
       (id,tenant_id,draft_id,revision_number,title,caption,description,
        media_attachments,channel_overrides,content_hash,created_by) VALUES
       ($1,$4,$5,1,'Pesë pyetje të javës',
        'Versioni i parë sintetik për krahasim.','Demo only.',
        jsonb_build_array(jsonb_build_object('assetId',$6::text)),'{}'::jsonb,$7,$8),
       ($2,$4,$5,2,'Pesë pyetje të javës — versioni final',
        'Çfarë pyeti audienca këtë javë? Ky material është vetëm demonstrim lokal.',
        'Demo only. Requires human approval and a real provider connection before use.',
        jsonb_build_array(jsonb_build_object('assetId',$6::text)),'{}'::jsonb,$9,$8),
       ($3,$4,$10,1,'Flash lajmet e ditës',
        'Përmbledhje sintetike e planifikuar për orën 19:30 Europe/Berlin.',
        'No external publication job exists.',jsonb_build_array(jsonb_build_object('assetId',$11::text)),'{}'::jsonb,$12,$13)
       ON CONFLICT(tenant_id,draft_id,revision_number) DO NOTHING`,
      [
        reviewRevisionOne,
        reviewRevisionTwo,
        scheduledRevision,
        ids.tenantId,
        ids.reviewDraftId,
        ids.mediaOneId,
        reviewHashOne,
        ids.editorUserId,
        reviewHashTwo,
        ids.scheduledDraftId,
        ids.mediaTwoId,
        scheduledHash,
        ids.approverUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.social_draft_targets
       (id,tenant_id,draft_id,revision_id,account_id,channel,status) VALUES
       ($1,$5,$6,$7,$8,'facebook','queued'),
       ($2,$5,$6,$7,$9,'instagram','queued'),
       ($3,$5,$10,$11,$8,'facebook','queued'),
       ($4,$5,$10,$11,$9,'instagram','queued')
       ON CONFLICT(tenant_id,draft_id,revision_id,account_id) DO NOTHING`,
      [
        reviewFacebookTarget,
        reviewInstagramTarget,
        scheduledFacebookTarget,
        scheduledInstagramTarget,
        ids.tenantId,
        ids.reviewDraftId,
        reviewRevisionTwo,
        ids.facebookAccountId,
        ids.instagramAccountId,
        ids.scheduledDraftId,
        scheduledRevision,
      ],
    );
    await client.query(
      `INSERT INTO control.social_approvals
       (id,tenant_id,draft_id,revision_id,requested_by,decision,
        approved_content_hash,decided_by,decided_at) VALUES
       ($1,$3,$4,$5,$6,'pending',NULL,NULL,NULL),
       ($2,$3,$7,$8,$6,'approved',$9,$10,now())
       ON CONFLICT(tenant_id,draft_id,revision_id) DO NOTHING`,
      [
        reviewApproval,
        scheduledApproval,
        ids.tenantId,
        ids.reviewDraftId,
        reviewRevisionTwo,
        ids.editorUserId,
        ids.scheduledDraftId,
        scheduledRevision,
        scheduledHash,
        ids.ownerUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.content_website_drafts
       (id,tenant_id,workspace_id,content_item_id,current_revision,created_by)
       VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(id) DO NOTHING`,
      [
        ids.websiteDraftId,
        ids.tenantId,
        ids.workspaceId,
        ids.contentOneId,
        ids.editorUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.content_website_draft_revisions
       (id,tenant_id,workspace_id,draft_id,revision,slug,title,excerpt,body,
        content_hash,created_by)
       VALUES($1,$2,$3,$4,1,'si-te-dallojme-nje-lajm-te-verifikuar',
        'Si të dallojmë një lajm të verifikuar',
        'Pesë kontrolle të thjeshta para se të ndajmë një lajm.',$5,$6,$7)
       ON CONFLICT(tenant_id,draft_id,revision) DO NOTHING`,
      [
        ids.websiteRevisionId,
        ids.tenantId,
        ids.workspaceId,
        ids.websiteDraftId,
        {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              text: "Ky është material sintetik për demonstrimin lokal të rrjedhës editoriale.",
            },
          ],
        },
        websiteHash,
        ids.editorUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.content_website_draft_reviews
       (id,tenant_id,workspace_id,draft_id,revision_id,revision,content_hash,
        decision,requested_by)
       VALUES($1,$2,$3,$4,$5,1,$6,'pending',$7)
       ON CONFLICT(tenant_id,revision_id) DO NOTHING`,
      [
        ids.websiteReviewId,
        ids.tenantId,
        ids.workspaceId,
        ids.websiteDraftId,
        ids.websiteRevisionId,
        websiteHash,
        ids.editorUserId,
      ],
    );
    await client.query(
      `INSERT INTO control.editorial_story_assignments
       (id,tenant_id,workspace_id,research_case_id,assignee_user_id,
        assigned_by_user_id,priority,due_at,note) VALUES
       ($1,$2,$3,$4,$5,$6,'high',now()+interval '1 day',
        'Synthetic demo assignment; verify evidence before promotion.'),
       ($7,$2,$3,$8,$9,$6,'normal',now()+interval '2 days',
        'Synthetic evening-news workflow.')
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        ids.tenantId,
        ids.workspaceId,
        ids.researchCaseOneId,
        ids.editorUserId,
        ids.ownerUserId,
        randomUUID(),
        ids.researchCaseTwoId,
        ids.approverUserId,
      ],
    );
    await client.query(
      `DELETE FROM control.local_demo_bootstrap_tokens
       WHERE tenant_id=$1 AND user_id=$2 AND (consumed_at IS NOT NULL OR expires_at<=now())`,
      [ids.tenantId, ids.ownerUserId],
    );
    await client.query(
      `UPDATE control.local_demo_bootstrap_tokens SET consumed_at=now()
       WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL`,
      [ids.tenantId, ids.ownerUserId],
    );
    await client.query(
      `INSERT INTO control.local_demo_bootstrap_tokens
       (token_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4)`,
      [digest(token), ids.tenantId, ids.ownerUserId, expiresAt],
    );
    await client.query("COMMIT");
    return { token, expiresAt, workspaceId: ids.workspaceId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
