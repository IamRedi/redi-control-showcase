export interface WebsiteDraft {
  id: string;
  itemId: string;
  workspaceId: string;
  currentRevision: number;
  revision: {
    id: string;
    revision: number;
    slug: string;
    title: string;
    excerpt: string;
    bodyText: string;
    mediaAssetIds: string[];
    contentHash: string;
    createdAt: string;
  };
  review?: {
    id: string;
    decision: "pending" | "approved" | "rejected";
    revision: number;
    contentHash: string;
    requestedAt: string;
    requestedByCurrentUser: boolean;
    decidedAt?: string;
    reason?: string;
    publicationAuthorized: false;
  };
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    mfaVerified: boolean;
  };
  createsVariant: false;
  callsConnector: false;
  publicationAuthorized: false;
}

export interface WebsiteReviewQueueItem {
  itemId: string;
  draftId: string;
  workspaceId: string;
  itemTitle: string;
  revision: number;
  contentHash: string;
  requestedAt: string;
  requestedByCurrentUser: boolean;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const uuidArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > 20) return null;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !UUID.test(item)) return null;
    values.push(item);
  }
  return new Set(values).size === values.length ? values : null;
};

export function parseWebsiteDraft(value: unknown): WebsiteDraft | null {
  const wrapper = record(value);
  const draft = record(wrapper?.draft);
  const revision = record(draft?.revision);
  const review = draft?.review === undefined ? null : record(draft.review);
  const permissions = record(wrapper?.permissions);
  const mediaAssetIds = uuidArray(revision?.mediaAssetIds);
  if (
    !draft ||
    !revision ||
    !permissions ||
    typeof draft.id !== "string" ||
    !UUID.test(draft.id) ||
    typeof draft.itemId !== "string" ||
    !UUID.test(draft.itemId) ||
    typeof draft.workspaceId !== "string" ||
    !UUID.test(draft.workspaceId) ||
    typeof draft.currentRevision !== "number" ||
    !Number.isInteger(draft.currentRevision) ||
    draft.currentRevision < 1 ||
    typeof revision.id !== "string" ||
    !UUID.test(revision.id) ||
    revision.revision !== draft.currentRevision ||
    typeof revision.slug !== "string" ||
    !SLUG.test(revision.slug) ||
    revision.slug.length > 180 ||
    typeof revision.title !== "string" ||
    !revision.title ||
    revision.title.length > 240 ||
    typeof revision.excerpt !== "string" ||
    revision.excerpt.length > 1000 ||
    typeof revision.bodyText !== "string" ||
    !revision.bodyText ||
    revision.bodyText.length > 50000 ||
    !mediaAssetIds ||
    typeof revision.contentHash !== "string" ||
    !HASH.test(revision.contentHash) ||
    typeof revision.createdAt !== "string" ||
    !Number.isFinite(Date.parse(revision.createdAt)) ||
    draft.createsVariant !== false ||
    draft.callsConnector !== false ||
    draft.publicationAuthorized !== false
  )
    return null;
  if (
    typeof permissions.canEdit !== "boolean" ||
    typeof permissions.canApprove !== "boolean" ||
    typeof permissions.mfaVerified !== "boolean"
  )
    return null;
  let parsedReview: WebsiteDraft["review"];
  if (review) {
    if (
      typeof review.id !== "string" ||
      !UUID.test(review.id) ||
      !["pending", "approved", "rejected"].includes(
        typeof review.decision === "string" ? review.decision : "",
      ) ||
      review.revision !== draft.currentRevision ||
      review.contentHash !== revision.contentHash ||
      typeof review.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(review.requestedAt)) ||
      typeof review.requestedByCurrentUser !== "boolean" ||
      (review.decidedAt !== undefined &&
        (typeof review.decidedAt !== "string" ||
          !Number.isFinite(Date.parse(review.decidedAt)))) ||
      (review.reason !== undefined &&
        (typeof review.reason !== "string" ||
          review.reason.length < 10 ||
          review.reason.length > 500)) ||
      review.publicationAuthorized !== false
    )
      return null;
    parsedReview = {
      id: review.id,
      decision: review.decision as "pending" | "approved" | "rejected",
      revision: draft.currentRevision,
      contentHash: revision.contentHash,
      requestedAt: new Date(review.requestedAt).toISOString(),
      requestedByCurrentUser: review.requestedByCurrentUser,
      ...(typeof review.decidedAt === "string"
        ? { decidedAt: new Date(review.decidedAt).toISOString() }
        : {}),
      ...(typeof review.reason === "string" ? { reason: review.reason } : {}),
      publicationAuthorized: false,
    };
  }
  return {
    id: draft.id,
    itemId: draft.itemId,
    workspaceId: draft.workspaceId,
    currentRevision: draft.currentRevision,
    revision: {
      id: revision.id,
      revision: draft.currentRevision,
      slug: revision.slug,
      title: revision.title,
      excerpt: revision.excerpt,
      bodyText: revision.bodyText,
      mediaAssetIds,
      contentHash: revision.contentHash,
      createdAt: new Date(revision.createdAt).toISOString(),
    },
    ...(parsedReview ? { review: parsedReview } : {}),
    permissions: {
      canEdit: permissions.canEdit,
      canApprove: permissions.canApprove,
      mfaVerified: permissions.mfaVerified,
    },
    createsVariant: false,
    callsConnector: false,
    publicationAuthorized: false,
  };
}

export function parseWebsiteReviewQueue(value: unknown): {
  items: WebsiteReviewQueueItem[];
  permissions: WebsiteDraft["permissions"];
} | null {
  const wrapper = record(value);
  const permissions = record(wrapper?.permissions);
  if (!wrapper || !permissions || !Array.isArray(wrapper.items)) return null;
  if (
    typeof permissions.canEdit !== "boolean" ||
    typeof permissions.canApprove !== "boolean" ||
    typeof permissions.mfaVerified !== "boolean" ||
    wrapper.items.length > 50
  )
    return null;
  const items: WebsiteReviewQueueItem[] = [];
  for (const valueItem of wrapper.items) {
    const item = record(valueItem);
    if (
      !item ||
      typeof item.itemId !== "string" ||
      !UUID.test(item.itemId) ||
      typeof item.draftId !== "string" ||
      !UUID.test(item.draftId) ||
      typeof item.workspaceId !== "string" ||
      !UUID.test(item.workspaceId) ||
      typeof item.itemTitle !== "string" ||
      !item.itemTitle ||
      item.itemTitle.length > 240 ||
      typeof item.revision !== "number" ||
      !Number.isInteger(item.revision) ||
      item.revision < 1 ||
      typeof item.contentHash !== "string" ||
      !HASH.test(item.contentHash) ||
      typeof item.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(item.requestedAt)) ||
      typeof item.requestedByCurrentUser !== "boolean"
    )
      return null;
    items.push({
      itemId: item.itemId,
      draftId: item.draftId,
      workspaceId: item.workspaceId,
      itemTitle: item.itemTitle,
      revision: item.revision,
      contentHash: item.contentHash,
      requestedAt: new Date(item.requestedAt).toISOString(),
      requestedByCurrentUser: item.requestedByCurrentUser,
    });
  }
  return {
    items,
    permissions: {
      canEdit: permissions.canEdit,
      canApprove: permissions.canApprove,
      mfaVerified: permissions.mfaVerified,
    },
  };
}
