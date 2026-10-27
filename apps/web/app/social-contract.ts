export interface SocialProviderCapability {
  readonly id: string;
  readonly mode: "read" | "write";
  readonly risk: "low" | "medium" | "high";
}

export interface SocialProviderSummary {
  readonly id: "meta" | "youtube" | "tiktok";
  readonly displayName: string;
  readonly configured: boolean;
  readonly status?: string;
  readonly capabilities: readonly SocialProviderCapability[];
}

export interface SocialAccountSummary {
  readonly id: string;
  readonly provider: string;
  readonly account_type: string;
  readonly display_name: string;
  readonly authorized_scopes: readonly string[];
  readonly token_expires_at: string | null;
  readonly refresh_status: string;
  readonly status: string;
  readonly health_status: string;
  readonly last_synced_at: string | null;
  readonly last_successful_publish_at: string | null;
}

export interface SocialMediaSummary {
  readonly id: string;
  readonly filename: string;
  readonly status: string;
  readonly mimeType: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

export interface SocialDraftTargetSummary {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
  readonly status: string;
}

export interface SocialDraftSummary {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: string;
  readonly scheduledFor: string | null;
  readonly scheduleTimezone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly content: {
    readonly title: string | null;
    readonly caption: string | null;
    readonly description: string | null;
    readonly mediaAssetIds: readonly string[];
  };
  readonly targets: readonly SocialDraftTargetSummary[];
  readonly approval: {
    readonly decision: "pending" | "approved" | "rejected";
    readonly requestedAt: string;
    readonly requestedByCurrentUser: boolean;
    readonly decidedAt: string | null;
    readonly reason: string | null;
  } | null;
}

export interface SocialWorkflowPermissions {
  readonly canEdit: boolean;
  readonly canApprove: boolean;
  readonly mfaVerified: boolean;
}

export interface SocialRevisionSummary {
  readonly revisionNumber: number;
  readonly createdAt: string;
  readonly isCurrent: boolean;
  readonly content: {
    readonly title: string | null;
    readonly caption: string | null;
    readonly description: string | null;
  };
  readonly media: readonly { readonly id: string; readonly filename: string }[];
  readonly targets: readonly SocialDraftTargetSummary[];
  readonly approval: {
    readonly decision: "pending" | "approved" | "rejected";
    readonly requestedAt: string;
    readonly requestedByCurrentUser: boolean;
    readonly decidedAt: string | null;
    readonly decidedByCurrentUser: boolean;
    readonly reason: string | null;
  } | null;
}

export interface SocialWorkflowDetail {
  readonly draft: {
    readonly id: string;
    readonly currentRevision: number;
    readonly status: string;
    readonly scheduledFor: string | null;
    readonly scheduleTimezone: string | null;
  };
  readonly permissions: SocialWorkflowPermissions;
  readonly revisions: readonly SocialRevisionSummary[];
}

export type SocialWorkflowAction =
  | { readonly action: "submit" }
  | {
      readonly action: "decide";
      readonly decision: "approved" | "rejected";
      readonly reason?: string;
    }
  | {
      readonly action: "schedule";
      readonly scheduledFor: string;
      readonly timezone: string;
    };

export interface CreateSocialDraftInput {
  readonly workspaceId: string;
  readonly accountIds: readonly string[];
  readonly mediaAssetIds: readonly string[];
  readonly title?: string;
  readonly caption?: string;
  readonly description?: string;
}

export interface SocialStudioSnapshot {
  readonly accounts: readonly SocialAccountSummary[];
  readonly media: readonly SocialMediaSummary[];
  readonly drafts: readonly SocialDraftSummary[];
  readonly permissions: SocialWorkflowPermissions;
}

export interface SocialPublicationAttemptSummary {
  readonly id: string;
  readonly status: string;
  readonly retryCount: number;
  readonly failureCategory: string | null;
  readonly safeError: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
  readonly hasProviderReference: boolean;
}

export interface SocialPublicationTargetSummary {
  readonly id: string;
  readonly accountName: string;
  readonly provider: "meta" | "youtube" | "tiktok";
  readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
  readonly status: string;
  readonly attempt: SocialPublicationAttemptSummary | null;
  readonly job: {
    readonly status: string;
    readonly availableAt: string | null;
    readonly attemptCount: number;
    readonly maxAttempts: number;
  } | null;
  readonly reconciliation: "not_available";
}

export interface SocialPublicationSummary {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: string;
  readonly scheduledFor: string | null;
  readonly scheduleTimezone: string | null;
  readonly updatedAt: string;
  readonly content: {
    readonly title: string | null;
    readonly caption: string | null;
  };
  readonly targets: readonly SocialPublicationTargetSummary[];
}

export interface SocialPublicationsSnapshot {
  readonly automaticExecution: false;
  readonly reconciliationAvailable: false;
  readonly publications: readonly SocialPublicationSummary[];
}

export interface SocialPreflightSnapshot {
  readonly providerExecutionAvailable: false;
  readonly checkedAt: string;
  readonly targets: readonly {
    readonly targetId: string;
    readonly accountName: string;
    readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
    readonly checks: readonly {
      readonly code: string;
      readonly severity: "pass" | "warning" | "blocker";
    }[];
  }[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

export function parseSocialProviders(
  value: unknown,
): readonly SocialProviderSummary[] | null {
  const envelope = record(value);
  if (!envelope || !Array.isArray(envelope.providers)) return null;
  const providers: SocialProviderSummary[] = [];
  for (const candidate of envelope.providers) {
    const provider = record(candidate);
    if (
      !provider ||
      !["meta", "youtube", "tiktok"].includes(String(provider.id)) ||
      typeof provider.displayName !== "string" ||
      typeof provider.configured !== "boolean" ||
      !Array.isArray(provider.capabilities)
    )
      return null;
    const capabilities: SocialProviderCapability[] = [];
    for (const item of provider.capabilities) {
      const capability = record(item);
      if (
        !capability ||
        typeof capability.id !== "string" ||
        !["read", "write"].includes(String(capability.mode)) ||
        !["low", "medium", "high"].includes(String(capability.risk))
      )
        return null;
      capabilities.push({
        id: capability.id,
        mode: capability.mode as "read" | "write",
        risk: capability.risk as "low" | "medium" | "high",
      });
    }
    providers.push({
      id: provider.id as "meta" | "youtube" | "tiktok",
      displayName: provider.displayName,
      configured: provider.configured,
      ...(typeof provider.status === "string"
        ? { status: provider.status }
        : {}),
      capabilities,
    });
  }
  return providers;
}

export function parseSocialAccounts(
  value: unknown,
): readonly SocialAccountSummary[] | null {
  const envelope = record(value);
  if (!envelope || !Array.isArray(envelope.accounts)) return null;
  const accounts: SocialAccountSummary[] = [];
  for (const candidate of envelope.accounts) {
    const account = record(candidate);
    const scopes = account?.authorized_scopes;
    if (
      !account ||
      typeof account.id !== "string" ||
      typeof account.provider !== "string" ||
      typeof account.account_type !== "string" ||
      typeof account.display_name !== "string" ||
      !Array.isArray(scopes) ||
      !scopes.every((scope) => typeof scope === "string") ||
      typeof account.refresh_status !== "string" ||
      typeof account.status !== "string" ||
      typeof account.health_status !== "string"
    )
      return null;
    const nullableDate = (field: unknown) =>
      field === null || typeof field === "string";
    if (
      !nullableDate(account.token_expires_at) ||
      !nullableDate(account.last_synced_at) ||
      !nullableDate(account.last_successful_publish_at)
    )
      return null;
    accounts.push({
      id: account.id,
      provider: account.provider,
      account_type: account.account_type,
      display_name: account.display_name,
      authorized_scopes: scopes,
      token_expires_at: account.token_expires_at,
      refresh_status: account.refresh_status,
      status: account.status,
      health_status: account.health_status,
      last_synced_at: account.last_synced_at,
      last_successful_publish_at: account.last_successful_publish_at,
    });
  }
  return accounts;
}

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export function parseSocialPublications(
  value: unknown,
): SocialPublicationsSnapshot | null {
  const envelope = record(value);
  if (
    !envelope ||
    envelope.automaticExecution !== false ||
    envelope.reconciliationAvailable !== false ||
    !Array.isArray(envelope.publications)
  )
    return null;
  const publications: SocialPublicationSummary[] = [];
  for (const candidate of envelope.publications) {
    const publication = record(candidate);
    const content = record(publication?.content);
    if (
      !publication ||
      !content ||
      typeof publication.id !== "string" ||
      !nonNegativeInteger(publication.currentRevision) ||
      publication.currentRevision < 1 ||
      typeof publication.status !== "string" ||
      !nullableString(publication.scheduledFor) ||
      !nullableString(publication.scheduleTimezone) ||
      typeof publication.updatedAt !== "string" ||
      !nullableString(content.title) ||
      !nullableString(content.caption) ||
      !Array.isArray(publication.targets)
    )
      return null;
    const targets: SocialPublicationTargetSummary[] = [];
    for (const item of publication.targets) {
      const target = record(item);
      if (
        !target ||
        typeof target.id !== "string" ||
        typeof target.accountName !== "string" ||
        !["meta", "youtube", "tiktok"].includes(String(target.provider)) ||
        !["facebook", "instagram", "youtube", "tiktok"].includes(
          String(target.channel),
        ) ||
        typeof target.status !== "string" ||
        target.reconciliation !== "not_available"
      )
        return null;
      let attempt: SocialPublicationAttemptSummary | null = null;
      if (target.attempt !== null) {
        const value = record(target.attempt);
        if (
          !value ||
          typeof value.id !== "string" ||
          typeof value.status !== "string" ||
          !nonNegativeInteger(value.retryCount) ||
          !nullableString(value.failureCategory) ||
          !nullableString(value.safeError) ||
          (typeof value.safeError === "string" &&
            value.safeError.length > 500) ||
          !nullableString(value.startedAt) ||
          !nullableString(value.completedAt) ||
          typeof value.updatedAt !== "string" ||
          typeof value.hasProviderReference !== "boolean"
        )
          return null;
        attempt = {
          id: value.id,
          status: value.status,
          retryCount: value.retryCount,
          failureCategory: value.failureCategory,
          safeError: value.safeError,
          startedAt: value.startedAt,
          completedAt: value.completedAt,
          updatedAt: value.updatedAt,
          hasProviderReference: value.hasProviderReference,
        };
      }
      let job: SocialPublicationTargetSummary["job"] = null;
      if (target.job !== null) {
        const value = record(target.job);
        if (
          !value ||
          typeof value.status !== "string" ||
          !nullableString(value.availableAt) ||
          !nonNegativeInteger(value.attemptCount) ||
          !nonNegativeInteger(value.maxAttempts) ||
          value.maxAttempts < 1
        )
          return null;
        job = {
          status: value.status,
          availableAt: value.availableAt,
          attemptCount: value.attemptCount,
          maxAttempts: value.maxAttempts,
        };
      }
      targets.push({
        id: target.id,
        accountName: target.accountName,
        provider: target.provider as SocialPublicationTargetSummary["provider"],
        channel: target.channel as SocialPublicationTargetSummary["channel"],
        status: target.status,
        attempt,
        job,
        reconciliation: "not_available",
      });
    }
    publications.push({
      id: publication.id,
      currentRevision: publication.currentRevision,
      status: publication.status,
      scheduledFor: publication.scheduledFor,
      scheduleTimezone: publication.scheduleTimezone,
      updatedAt: publication.updatedAt,
      content: { title: content.title, caption: content.caption },
      targets,
    });
  }
  return {
    automaticExecution: false,
    reconciliationAvailable: false,
    publications,
  };
}

export function parseSocialPreflight(
  value: unknown,
): SocialPreflightSnapshot | null {
  const envelope = record(value);
  if (
    !envelope ||
    envelope.providerExecutionAvailable !== false ||
    typeof envelope.checkedAt !== "string" ||
    !Array.isArray(envelope.targets)
  )
    return null;
  const targets: SocialPreflightSnapshot["targets"][number][] = [];
  for (const candidate of envelope.targets) {
    const target = record(candidate);
    if (
      !target ||
      typeof target.targetId !== "string" ||
      typeof target.accountName !== "string" ||
      !["facebook", "instagram", "youtube", "tiktok"].includes(
        String(target.channel),
      ) ||
      !Array.isArray(target.checks)
    )
      return null;
    const checks: SocialPreflightSnapshot["targets"][number]["checks"][number][] =
      [];
    for (const item of target.checks) {
      const check = record(item);
      if (
        !check ||
        typeof check.code !== "string" ||
        !["pass", "warning", "blocker"].includes(String(check.severity))
      )
        return null;
      checks.push({
        code: check.code,
        severity: check.severity as "pass" | "warning" | "blocker",
      });
    }
    targets.push({
      targetId: target.targetId,
      accountName: target.accountName,
      channel:
        target.channel as SocialPreflightSnapshot["targets"][number]["channel"],
      checks,
    });
  }
  return {
    providerExecutionAvailable: false,
    checkedAt: envelope.checkedAt,
    targets,
  };
}

export function parseSocialMedia(
  value: unknown,
): readonly SocialMediaSummary[] | null {
  const envelope = record(value);
  if (!envelope || !Array.isArray(envelope.assets)) return null;
  const assets: SocialMediaSummary[] = [];
  for (const candidate of envelope.assets) {
    const asset = record(candidate);
    if (
      !asset ||
      typeof asset.id !== "string" ||
      typeof asset.original_filename !== "string" ||
      typeof asset.status !== "string" ||
      !nullableString(asset.mime_type) ||
      !(asset.width === null || typeof asset.width === "number") ||
      !(asset.height === null || typeof asset.height === "number") ||
      !(
        asset.duration_ms === null ||
        typeof asset.duration_ms === "number" ||
        typeof asset.duration_ms === "string"
      )
    )
      return null;
    const duration =
      asset.duration_ms === null ? null : Number(asset.duration_ms);
    if (duration !== null && !Number.isSafeInteger(duration)) return null;
    assets.push({
      id: asset.id,
      filename: asset.original_filename,
      status: asset.status,
      mimeType: asset.mime_type,
      width: asset.width,
      height: asset.height,
      durationMs: duration,
    });
  }
  return assets;
}

const draftTarget = (value: unknown): SocialDraftTargetSummary | null => {
  const target = record(value);
  if (
    !target ||
    typeof target.id !== "string" ||
    typeof target.accountId !== "string" ||
    typeof target.accountName !== "string" ||
    !["facebook", "instagram", "youtube", "tiktok"].includes(
      String(target.channel),
    ) ||
    typeof target.status !== "string"
  )
    return null;
  return {
    id: target.id,
    accountId: target.accountId,
    accountName: target.accountName,
    channel: target.channel as SocialDraftTargetSummary["channel"],
    status: target.status,
  };
};

export function parseSocialDrafts(
  value: unknown,
): readonly SocialDraftSummary[] | null {
  const envelope = record(value);
  if (!envelope || !Array.isArray(envelope.drafts)) return null;
  const drafts: SocialDraftSummary[] = [];
  for (const candidate of envelope.drafts) {
    const draft = record(candidate);
    const content = record(draft?.content);
    const attachments = content?.mediaAttachments;
    const targets = Array.isArray(draft?.targets)
      ? draft.targets.map(draftTarget)
      : null;
    if (
      !draft ||
      !content ||
      typeof draft.id !== "string" ||
      typeof draft.currentRevision !== "number" ||
      !Number.isInteger(draft.currentRevision) ||
      Number(draft.currentRevision) < 1 ||
      typeof draft.status !== "string" ||
      !nullableString(draft.scheduledFor) ||
      !nullableString(draft.scheduleTimezone) ||
      typeof draft.createdAt !== "string" ||
      typeof draft.updatedAt !== "string" ||
      !nullableString(content.title) ||
      !nullableString(content.caption) ||
      !nullableString(content.description) ||
      !Array.isArray(attachments) ||
      !targets ||
      targets.some((target) => target === null)
    )
      return null;
    const mediaAssetIds: string[] = [];
    for (const attachment of attachments) {
      const item = record(attachment);
      if (!item || typeof item.assetId !== "string") return null;
      mediaAssetIds.push(item.assetId);
    }
    let approval: SocialDraftSummary["approval"] = null;
    if (draft.approval !== null) {
      const candidateApproval = record(draft.approval);
      if (
        !candidateApproval ||
        !["pending", "approved", "rejected"].includes(
          String(candidateApproval.decision),
        ) ||
        typeof candidateApproval.requestedAt !== "string" ||
        typeof candidateApproval.requestedByCurrentUser !== "boolean" ||
        !nullableString(candidateApproval.decidedAt) ||
        !nullableString(candidateApproval.reason)
      )
        return null;
      approval = {
        decision: candidateApproval.decision as
          | "pending"
          | "approved"
          | "rejected",
        requestedAt: candidateApproval.requestedAt,
        requestedByCurrentUser: candidateApproval.requestedByCurrentUser,
        decidedAt: candidateApproval.decidedAt,
        reason: candidateApproval.reason,
      };
    }
    drafts.push({
      id: draft.id,
      currentRevision: draft.currentRevision,
      status: draft.status,
      scheduledFor: draft.scheduledFor,
      scheduleTimezone: draft.scheduleTimezone,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      content: {
        title: content.title,
        caption: content.caption,
        description: content.description,
        mediaAssetIds,
      },
      targets: targets as SocialDraftTargetSummary[],
      approval,
    });
  }
  return drafts;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCreateSocialDraftInput(
  value: unknown,
): CreateSocialDraftInput | null {
  const input = record(value);
  if (!input || !UUID.test(String(input.workspaceId))) return null;
  const accountIds = input.accountIds;
  const mediaAssetIds = input.mediaAssetIds;
  if (
    !Array.isArray(accountIds) ||
    accountIds.length < 1 ||
    accountIds.length > 10 ||
    !accountIds.every((id) => typeof id === "string" && UUID.test(id)) ||
    new Set(accountIds).size !== accountIds.length ||
    !Array.isArray(mediaAssetIds) ||
    mediaAssetIds.length < 1 ||
    mediaAssetIds.length > 10 ||
    !mediaAssetIds.every((id) => typeof id === "string" && UUID.test(id)) ||
    new Set(mediaAssetIds).size !== mediaAssetIds.length
  )
    return null;
  const optionalText = (field: unknown, maximum: number) =>
    field === undefined ||
    (typeof field === "string" &&
      field.trim().length > 0 &&
      field.length <= maximum);
  if (
    !optionalText(input.title, 100) ||
    !optionalText(input.caption, 5_000) ||
    !optionalText(input.description, 5_000) ||
    (input.title === undefined &&
      input.caption === undefined &&
      input.description === undefined)
  )
    return null;
  return {
    workspaceId: input.workspaceId as string,
    accountIds,
    mediaAssetIds,
    ...(typeof input.title === "string" ? { title: input.title.trim() } : {}),
    ...(typeof input.caption === "string"
      ? { caption: input.caption.trim() }
      : {}),
    ...(typeof input.description === "string"
      ? { description: input.description.trim() }
      : {}),
  };
}

export function parseSocialStudio(value: unknown): SocialStudioSnapshot | null {
  const envelope = record(value);
  if (!envelope) return null;
  const accounts = parseSocialAccounts({ accounts: envelope.accounts });
  if (!Array.isArray(envelope.media) || !Array.isArray(envelope.drafts))
    return null;
  const media = parseSocialMedia({
    assets: envelope.media.map((candidate) => {
      const item = record(candidate);
      return item
        ? {
            ...item,
            original_filename: item.filename,
            mime_type: item.mimeType,
            duration_ms: item.durationMs,
          }
        : null;
    }),
  });
  const drafts = parseSocialDrafts({
    drafts: envelope.drafts.map((candidate) => {
      const item = record(candidate);
      const content = record(item?.content);
      return item && content && Array.isArray(content.mediaAssetIds)
        ? {
            ...item,
            content: {
              ...content,
              mediaAttachments: content.mediaAssetIds.map(
                (assetId: unknown) => ({
                  assetId,
                }),
              ),
            },
          }
        : null;
    }),
  });
  const permissions = parseSocialWorkflowPermissions(envelope.permissions);
  return accounts && media && drafts && permissions
    ? { accounts, media, drafts, permissions }
    : null;
}

export function parseSocialWorkflowPermissions(
  value: unknown,
): SocialWorkflowPermissions | null {
  const permissions = record(value);
  if (
    !permissions ||
    typeof permissions.canEdit !== "boolean" ||
    typeof permissions.canApprove !== "boolean" ||
    typeof permissions.mfaVerified !== "boolean"
  )
    return null;
  return {
    canEdit: permissions.canEdit,
    canApprove: permissions.canApprove,
    mfaVerified: permissions.mfaVerified,
  };
}

export function parseSocialWorkflowDetail(
  value: unknown,
): SocialWorkflowDetail | null {
  const envelope = record(value);
  const draft = record(envelope?.draft);
  const permissions = parseSocialWorkflowPermissions(envelope?.permissions);
  if (
    !envelope ||
    !draft ||
    !permissions ||
    typeof draft.id !== "string" ||
    typeof draft.currentRevision !== "number" ||
    !Number.isInteger(draft.currentRevision) ||
    draft.currentRevision < 1 ||
    typeof draft.status !== "string" ||
    !nullableString(draft.scheduledFor) ||
    !nullableString(draft.scheduleTimezone) ||
    !Array.isArray(envelope.revisions)
  )
    return null;
  const revisions: SocialRevisionSummary[] = [];
  for (const candidate of envelope.revisions) {
    const revision = record(candidate);
    const content = record(revision?.content);
    const targets = Array.isArray(revision?.targets)
      ? revision.targets.map(draftTarget)
      : null;
    if (
      !revision ||
      !content ||
      typeof revision.revisionNumber !== "number" ||
      !Number.isInteger(revision.revisionNumber) ||
      revision.revisionNumber < 1 ||
      typeof revision.createdAt !== "string" ||
      typeof revision.isCurrent !== "boolean" ||
      !nullableString(content.title) ||
      !nullableString(content.caption) ||
      !nullableString(content.description) ||
      !Array.isArray(revision.media) ||
      !targets ||
      targets.some((target) => target === null)
    )
      return null;
    const media: Array<{ id: string; filename: string }> = [];
    for (const item of revision.media) {
      const asset = record(item);
      if (
        !asset ||
        typeof asset.id !== "string" ||
        typeof asset.filename !== "string"
      )
        return null;
      media.push({ id: asset.id, filename: asset.filename });
    }
    let approval: SocialRevisionSummary["approval"] = null;
    if (revision.approval !== null) {
      const candidateApproval = record(revision.approval);
      if (
        !candidateApproval ||
        !["pending", "approved", "rejected"].includes(
          String(candidateApproval.decision),
        ) ||
        typeof candidateApproval.requestedAt !== "string" ||
        typeof candidateApproval.requestedByCurrentUser !== "boolean" ||
        !nullableString(candidateApproval.decidedAt) ||
        typeof candidateApproval.decidedByCurrentUser !== "boolean" ||
        !nullableString(candidateApproval.reason)
      )
        return null;
      approval = {
        decision: candidateApproval.decision as
          | "pending"
          | "approved"
          | "rejected",
        requestedAt: candidateApproval.requestedAt,
        requestedByCurrentUser: candidateApproval.requestedByCurrentUser,
        decidedAt: candidateApproval.decidedAt,
        decidedByCurrentUser: candidateApproval.decidedByCurrentUser,
        reason: candidateApproval.reason,
      };
    }
    revisions.push({
      revisionNumber: revision.revisionNumber,
      createdAt: revision.createdAt,
      isCurrent: revision.isCurrent,
      content: {
        title: content.title,
        caption: content.caption,
        description: content.description,
      },
      media,
      targets: targets as SocialDraftTargetSummary[],
      approval,
    });
  }
  if (!revisions.some((revision) => revision.isCurrent)) return null;
  return {
    draft: {
      id: draft.id,
      currentRevision: draft.currentRevision,
      status: draft.status,
      scheduledFor: draft.scheduledFor,
      scheduleTimezone: draft.scheduleTimezone,
    },
    permissions,
    revisions,
  };
}

export function parseSocialWorkflowAction(
  value: unknown,
): SocialWorkflowAction | null {
  const input = record(value);
  if (!input) return null;
  if (input.action === "submit") return { action: "submit" };
  if (
    input.action === "decide" &&
    ["approved", "rejected"].includes(String(input.decision))
  ) {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length > 500 || (input.decision === "rejected" && !reason))
      return null;
    return {
      action: "decide",
      decision: input.decision as "approved" | "rejected",
      ...(reason ? { reason } : {}),
    };
  }
  if (
    input.action === "schedule" &&
    typeof input.scheduledFor === "string" &&
    !Number.isNaN(Date.parse(input.scheduledFor)) &&
    typeof input.timezone === "string" &&
    input.timezone.length >= 1 &&
    input.timezone.length <= 80
  ) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
    } catch {
      return null;
    }
    return {
      action: "schedule",
      scheduledFor: new Date(input.scheduledFor).toISOString(),
      timezone: input.timezone,
    };
  }
  return null;
}
