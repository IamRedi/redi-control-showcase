"use client";

import { useCallback, useEffect, useState } from "react";

import { localizedLoginHref } from "../../auth-navigation-contract";
import {
  classifyWorkspaceResponse,
  type WorkspaceResponseState,
} from "../../workspace-onboarding-contract";
import { WorkspaceOnboarding } from "../../workspace-onboarding";
import {
  parseWebsitePreflight,
  type WebsitePreflight,
} from "../../content-website-preflight-contract";
import {
  parseWebsiteDraft,
  parseWebsiteReviewQueue,
  type WebsiteDraft,
  type WebsiteReviewQueueItem,
} from "../../content-website-draft-contract";

type Locale = "en" | "de" | "sq";

interface Variant {
  id: string;
  destination: string;
  status: string;
  currentRevision: number;
  safeError?: string;
}
interface Item {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  status: string;
  version: number;
  mediaAssetIds: string[];
  variants: Variant[];
  deliveryStatus: string;
}
interface DraftMetrics {
  title: number;
  excerpt: number;
  bodyCharacters: number;
  bodyWords: number;
}
const deliveryChannels = ["website", "facebook", "instagram"] as const;
type DeliveryChannel = (typeof deliveryChannels)[number];

function variantFor(item: Item, destination: DeliveryChannel): Variant | null {
  return (
    item.variants.find((variant) => variant.destination === destination) ?? null
  );
}
function metricsForDraft(
  title: string,
  excerpt: string,
  bodyText: string,
): DraftMetrics {
  return {
    title: title.length,
    excerpt: excerpt.length,
    bodyCharacters: bodyText.length,
    bodyWords: bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0,
  };
}
interface Copy {
  workspace: string;
  itemTitle: string;
  summary: string;
  create: string;
  loading: string;
  empty: string;
  unavailable: string;
  signedOut: string;
  signIn: string;
  variants: string;
  channelPlan: string;
  channelWebsite: string;
  channelFacebook: string;
  channelInstagram: string;
  channelNotPrepared: string;
  channelRevision: string;
  channelWebsiteHint: string;
  channelSocialHint: string;
  channelSocialDeferred: string;
  focusedItem: string;
  focusedFromReview: string;
  media: string;
  version: string;
  delivery: string;
  websitePreflight: string;
  inspectWebsite: string;
  checkingWebsite: string;
  preflightReady: string;
  preflightBlocked: string;
  preflightReadOnly: string;
  preflightUnavailable: string;
  connections: string;
  eligible: string;
  unavailableConnection: string;
  noConnections: string;
  websiteDraft: string;
  openDraft: string;
  closeDraft: string;
  newDraft: string;
  draftRevision: string;
  draftSlug: string;
  draftTitle: string;
  draftExcerpt: string;
  draftBody: string;
  draftMedia: string;
  draftGuideTitle: string;
  draftGuide: string;
  draftCharacters: string;
  draftWords: string;
  saveDraft: string;
  savingDraft: string;
  draftSafety: string;
  draftUnavailable: string;
  reviewQueue: string;
  reviewQueueEmpty: string;
  reviewQueueUnavailable: string;
  openForReview: string;
  requested: string;
  preview: string;
  previewPath: string;
  previewMedia: string;
  previewExact: string;
  reviewStatus: string;
  requestReview: string;
  requestingReview: string;
  pendingReview: string;
  approvedReview: string;
  rejectedReview: string;
  approveReview: string;
  rejectReview: string;
  rejectionReason: string;
  reviewSelf: string;
  reviewMfa: string;
  reviewSafety: string;
  checkLabels: Readonly<Record<string, string>>;
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 180) || "website-draft"
  );
}

function csrf(): string {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
}

export function ContentItemsClient({
  copy,
  locale,
}: {
  copy: Copy;
  locale: Locale;
}) {
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [focusSource, setFocusSource] = useState<"research" | "review" | null>(
    null,
  );
  const [items, setItems] = useState<Item[] | null>(null);
  const [workspace, setWorkspace] = useState<{
    id: string;
    displayName: string;
  } | null>(null);
  const [state, setState] = useState<
    "loading" | WorkspaceResponseState | "ready"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [websiteBusyItemId, setWebsiteBusyItemId] = useState<string | null>(
    null,
  );
  const [websitePreflights, setWebsitePreflights] = useState<
    Record<string, WebsitePreflight>
  >({});
  const [websiteErrors, setWebsiteErrors] = useState<Record<string, boolean>>(
    {},
  );
  const [websiteDrafts, setWebsiteDrafts] = useState<
    Record<string, WebsiteDraft | null>
  >({});
  const [openDraftItemId, setOpenDraftItemId] = useState<string | null>(null);
  const [draftBusyItemId, setDraftBusyItemId] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, boolean>>({});
  const [draftMetrics, setDraftMetrics] = useState<
    Record<string, DraftMetrics>
  >({});
  const [reviewQueue, setReviewQueue] = useState<WebsiteReviewQueueItem[]>([]);
  const [reviewQueueError, setReviewQueueError] = useState(false);

  const loadReviewQueue = useCallback(async (workspaceId: string) => {
    const response = await fetch(
      `/api/content-items/website-review-queue?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("website_review_queue_unavailable");
    const queue = parseWebsiteReviewQueue(await response.json());
    if (!queue) throw new Error("website_review_queue_invalid");
    setReviewQueue(queue.items);
    setReviewQueueError(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const overviewResponse = await fetch("/api/dashboard/overview", {
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!overviewResponse.ok) {
        setItems(null);
        setWorkspace(null);
        setState(classifyWorkspaceResponse(overviewResponse.status));
        return;
      }
      const overview = (await overviewResponse.json()) as {
        workspace?: { id?: unknown; displayName?: unknown };
      };
      if (
        typeof overview.workspace?.id !== "string" ||
        typeof overview.workspace.displayName !== "string"
      )
        throw new Error("workspace_invalid");
      const response = await fetch("/api/content-items", {
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("content_unavailable");
      const value = (await response.json()) as { items?: unknown };
      if (!Array.isArray(value.items)) throw new Error("content_invalid");
      setWorkspace({
        id: overview.workspace.id,
        displayName: overview.workspace.displayName,
      });
      setItems(value.items as Item[]);
      setState("ready");
      try {
        await loadReviewQueue(overview.workspace.id);
      } catch {
        setReviewQueue([]);
        setReviewQueueError(true);
      }
    } catch {
      setItems(null);
      setWorkspace(null);
      setState("unavailable");
    }
  }, [loadReviewQueue]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get("item");
    setFocusedItemId(itemId);
    setFocusSource(itemId ? "research" : null);
  }, []);
  useEffect(() => {
    if (!focusedItemId || !items?.some((item) => item.id === focusedItemId))
      return;
    document
      .getElementById(`content-item-${focusedItemId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusedItemId, items, openDraftItemId]);

  async function createItem(form: FormData) {
    setBusy(true);
    setState("ready");
    try {
      const response = await fetch("/api/content-items", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          title: form.get("title"),
          summary: form.get("summary"),
        }),
      });
      if (!response.ok) throw new Error("content_create_failed");
      await load();
    } catch {
      setState("unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function inspectWebsite(itemId: string) {
    setWebsiteBusyItemId(itemId);
    setWebsiteErrors((current) => ({ ...current, [itemId]: false }));
    setWebsitePreflights((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    try {
      const response = await fetch(
        `/api/content-items/${encodeURIComponent(itemId)}/website-preflight`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("website_preflight_unavailable");
      const preflight = parseWebsitePreflight(await response.json());
      if (!preflight) throw new Error("website_preflight_invalid");
      setWebsitePreflights((current) => ({
        ...current,
        [itemId]: preflight,
      }));
    } catch {
      setWebsiteErrors((current) => ({ ...current, [itemId]: true }));
    } finally {
      setWebsiteBusyItemId(null);
    }
  }

  async function openWebsiteDraft(itemId: string, forceOpen = false) {
    if (openDraftItemId === itemId && !forceOpen) {
      setOpenDraftItemId(null);
      return;
    }
    setDraftBusyItemId(itemId);
    setDraftErrors((current) => ({ ...current, [itemId]: false }));
    try {
      const response = await fetch(
        `/api/content-items/${encodeURIComponent(itemId)}/website-draft`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
          cache: "no-store",
        },
      );
      if (response.status === 404) {
        setWebsiteDrafts((current) => ({ ...current, [itemId]: null }));
      } else {
        if (!response.ok) throw new Error("website_draft_unavailable");
        const draft = parseWebsiteDraft(await response.json());
        if (!draft || draft.itemId !== itemId)
          throw new Error("website_draft_invalid");
        setWebsiteDrafts((current) => ({ ...current, [itemId]: draft }));
        setDraftMetrics((current) => ({
          ...current,
          [itemId]: metricsForDraft(
            draft.revision.title,
            draft.revision.excerpt,
            draft.revision.bodyText,
          ),
        }));
      }
      setOpenDraftItemId(itemId);
    } catch {
      setDraftErrors((current) => ({ ...current, [itemId]: true }));
    } finally {
      setDraftBusyItemId(null);
    }
  }

  async function openWebsiteReview(itemId: string) {
    setFocusedItemId(itemId);
    setFocusSource("review");
    await openWebsiteDraft(itemId, true);
  }

  async function saveWebsiteDraft(item: Item, form: FormData) {
    const existing = websiteDrafts[item.id];
    setDraftBusyItemId(item.id);
    setDraftErrors((current) => ({ ...current, [item.id]: false }));
    try {
      const response = await fetch(
        `/api/content-items/${encodeURIComponent(item.id)}/website-draft${
          existing ? "/revisions" : ""
        }`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf(),
          },
          body: JSON.stringify({
            ...(existing ? { expectedRevision: existing.currentRevision } : {}),
            slug: form.get("slug"),
            title: form.get("title"),
            excerpt: form.get("excerpt"),
            bodyText: form.get("bodyText"),
            mediaAssetIds: item.mediaAssetIds,
          }),
        },
      );
      if (!response.ok) throw new Error("website_draft_save_failed");
      const draft = parseWebsiteDraft(await response.json());
      if (!draft || draft.itemId !== item.id)
        throw new Error("website_draft_invalid");
      setWebsiteDrafts((current) => ({ ...current, [item.id]: draft }));
      setDraftMetrics((current) => ({
        ...current,
        [item.id]: metricsForDraft(
          draft.revision.title,
          draft.revision.excerpt,
          draft.revision.bodyText,
        ),
      }));
    } catch {
      setDraftErrors((current) => ({ ...current, [item.id]: true }));
    } finally {
      setDraftBusyItemId(null);
    }
  }

  function updateDraftMetrics(itemId: string, form: HTMLFormElement) {
    const values = new FormData(form);
    const text = (name: string) => {
      const value = values.get(name);
      return typeof value === "string" ? value : "";
    };
    setDraftMetrics((current) => ({
      ...current,
      [itemId]: metricsForDraft(
        text("title"),
        text("excerpt"),
        text("bodyText"),
      ),
    }));
  }

  async function requestWebsiteReview(item: Item) {
    const draft = websiteDrafts[item.id];
    if (!draft) return;
    setDraftBusyItemId(item.id);
    setDraftErrors((current) => ({ ...current, [item.id]: false }));
    try {
      const response = await fetch(
        `/api/content-items/${encodeURIComponent(item.id)}/website-draft/review`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf(),
          },
          body: JSON.stringify({ expectedRevision: draft.currentRevision }),
        },
      );
      if (!response.ok) throw new Error("website_review_request_failed");
      const updated = parseWebsiteDraft(await response.json());
      if (!updated || updated.itemId !== item.id)
        throw new Error("website_draft_invalid");
      setWebsiteDrafts((current) => ({ ...current, [item.id]: updated }));
      if (workspace) await loadReviewQueue(workspace.id);
    } catch {
      setDraftErrors((current) => ({ ...current, [item.id]: true }));
    } finally {
      setDraftBusyItemId(null);
    }
  }

  async function decideWebsiteReview(
    item: Item,
    decision: "approved" | "rejected",
    reason?: string,
  ) {
    const draft = websiteDrafts[item.id];
    if (!draft?.review) return;
    setDraftBusyItemId(item.id);
    setDraftErrors((current) => ({ ...current, [item.id]: false }));
    try {
      const response = await fetch(
        `/api/content-items/${encodeURIComponent(item.id)}/website-draft/review-decision`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf(),
          },
          body: JSON.stringify({
            expectedRevision: draft.currentRevision,
            decision,
            ...(decision === "rejected" && reason ? { reason } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error("website_review_decision_failed");
      const updated = parseWebsiteDraft(await response.json());
      if (!updated || updated.itemId !== item.id)
        throw new Error("website_draft_invalid");
      setWebsiteDrafts((current) => ({ ...current, [item.id]: updated }));
      if (workspace) await loadReviewQueue(workspace.id);
    } catch {
      setDraftErrors((current) => ({ ...current, [item.id]: true }));
    } finally {
      setDraftBusyItemId(null);
    }
  }

  return (
    <>
      {state === "workspace-required" ? (
        <section className="website-state" role="status">
          <WorkspaceOnboarding locale={locale} />
        </section>
      ) : null}
      {state === "signed-out" ? (
        <section className="website-state" role="status">
          <p>{copy.signedOut}</p>
          <a href={localizedLoginHref(locale, "/content")}>{copy.signIn} →</a>
        </section>
      ) : null}
      {state === "unavailable" ? (
        <p className="website-state website-error">{copy.unavailable}</p>
      ) : null}
      {state === "loading" ? (
        <p className="website-state">{copy.loading}</p>
      ) : null}
      {state === "ready" && workspace ? (
        <form className="content-create" action={createItem}>
          <div className="content-workspace-context">
            <span>{copy.workspace}</span>
            <strong>{workspace.displayName}</strong>
          </div>
          <label>
            {copy.itemTitle}
            <input name="title" maxLength={240} required />
          </label>
          <label className="content-summary">
            {copy.summary}
            <textarea name="summary" maxLength={2000} />
          </label>
          <button type="submit" disabled={busy}>
            {copy.create}
          </button>
        </form>
      ) : null}
      {items?.length === 0 ? (
        <p className="website-state">{copy.empty}</p>
      ) : null}
      {state === "ready" ? (
        <section
          className="content-review-queue"
          aria-labelledby="website-review-queue-title"
        >
          <div className="content-review-queue-heading">
            <div>
              <span>{copy.reviewStatus}</span>
              <h2 id="website-review-queue-title">{copy.reviewQueue}</h2>
            </div>
            <strong>{reviewQueue.length}</strong>
          </div>
          {reviewQueueError ? (
            <p className="content-preflight-error" role="alert">
              {copy.reviewQueueUnavailable}
            </p>
          ) : reviewQueue.length ? (
            <ul>
              {reviewQueue.map((entry) => (
                <li key={entry.draftId}>
                  <span>
                    <strong>{entry.itemTitle}</strong>
                    <small>
                      {copy.draftRevision} {entry.revision} · {copy.requested}{" "}
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(entry.requestedAt))}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => void openWebsiteReview(entry.itemId)}
                  >
                    {copy.openForReview}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.reviewQueueEmpty}</p>
          )}
        </section>
      ) : null}
      <section className="content-grid" aria-live="polite">
        {items?.map((item) => {
          const preflight = websitePreflights[item.id];
          const focused = item.id === focusedItemId;
          const draft = websiteDrafts[item.id];
          const metrics =
            draftMetrics[item.id] ??
            metricsForDraft(
              draft?.revision.title ?? item.title,
              draft?.revision.excerpt ?? item.summary,
              draft?.revision.bodyText ?? item.summary,
            );
          return (
            <article
              className={`content-card${focused ? " content-card-focused" : ""}`}
              id={`content-item-${item.id}`}
              key={item.id}
            >
              <div className="content-card-heading">
                <span>{item.status}</span>
                <strong>{item.deliveryStatus}</strong>
              </div>
              {focused ? (
                <p className="content-card-focus" role="status">
                  {focusSource === "review"
                    ? copy.focusedFromReview
                    : copy.focusedItem}
                </p>
              ) : null}
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <dl>
                <div>
                  <dt>{copy.version}</dt>
                  <dd>{item.version}</dd>
                </div>
                <div>
                  <dt>{copy.media}</dt>
                  <dd>{item.mediaAssetIds.length}</dd>
                </div>
                <div>
                  <dt>{copy.delivery}</dt>
                  <dd>{item.deliveryStatus}</dd>
                </div>
              </dl>
              <section
                className="content-channel-plan"
                aria-label={copy.channelPlan}
              >
                <div className="content-channel-plan-heading">
                  <h3>{copy.channelPlan}</h3>
                  <span>{copy.variants}</span>
                </div>
                <div className="content-channel-grid">
                  {deliveryChannels.map((destination) => {
                    const variant = variantFor(item, destination);
                    const social = destination !== "website";
                    const label =
                      destination === "website"
                        ? copy.channelWebsite
                        : destination === "facebook"
                          ? copy.channelFacebook
                          : copy.channelInstagram;
                    return (
                      <article
                        className={`content-channel-card content-channel-${destination}`}
                        key={destination}
                      >
                        <div>
                          <strong>{label}</strong>
                          <span>
                            {social
                              ? copy.channelSocialDeferred
                              : copy.channelWebsiteHint}
                          </span>
                        </div>
                        <p>
                          {variant
                            ? `${variant.status} · ${copy.channelRevision} ${variant.currentRevision}`
                            : copy.channelNotPrepared}
                        </p>
                        {social ? (
                          <small>{copy.channelSocialHint}</small>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
              <section className="content-website-preflight">
                <div className="content-preflight-heading">
                  <h3>{copy.websitePreflight}</h3>
                  <button
                    type="button"
                    disabled={websiteBusyItemId !== null}
                    onClick={() => void inspectWebsite(item.id)}
                  >
                    {websiteBusyItemId === item.id
                      ? copy.checkingWebsite
                      : copy.inspectWebsite}
                  </button>
                </div>
                <p className="content-preflight-safety">
                  {copy.preflightReadOnly}
                </p>
                {websiteErrors[item.id] ? (
                  <p className="content-preflight-error" role="alert">
                    {copy.preflightUnavailable}
                  </p>
                ) : null}
                {preflight ? (
                  <div aria-live="polite">
                    <strong
                      className={`content-preflight-status content-preflight-${preflight.status}`}
                    >
                      {preflight.status === "ready"
                        ? copy.preflightReady
                        : copy.preflightBlocked}
                    </strong>
                    <ul className="content-preflight-checks">
                      {preflight.checks.map((check) => (
                        <li
                          className={`content-preflight-check content-preflight-${check.severity}`}
                          key={check.code}
                        >
                          <span aria-hidden="true" />
                          {copy.checkLabels[check.code] ??
                            check.code.toLocaleLowerCase().replaceAll("_", " ")}
                        </li>
                      ))}
                    </ul>
                    <h4>{copy.connections}</h4>
                    {preflight.connections.length ? (
                      <ul className="content-preflight-connections">
                        {preflight.connections.map((connection) => (
                          <li key={connection.connectionId}>
                            <span>
                              <strong>{connection.displayName}</strong>
                              <small>{connection.domain}</small>
                            </span>
                            <em>
                              {connection.eligible
                                ? copy.eligible
                                : copy.unavailableConnection}
                            </em>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="content-preflight-empty">
                        {copy.noConnections}
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
              <section className="content-website-draft">
                <div className="content-preflight-heading">
                  <h3>{copy.websiteDraft}</h3>
                  <button
                    type="button"
                    disabled={draftBusyItemId !== null}
                    onClick={() => void openWebsiteDraft(item.id)}
                  >
                    {openDraftItemId === item.id
                      ? copy.closeDraft
                      : copy.openDraft}
                  </button>
                </div>
                <p className="content-preflight-safety">{copy.draftSafety}</p>
                {draftErrors[item.id] ? (
                  <p className="content-preflight-error" role="alert">
                    {copy.draftUnavailable}
                  </p>
                ) : null}
                {openDraftItemId === item.id ? (
                  <div className="content-draft-workspace">
                    {websiteDrafts[item.id] ? (
                      <article className="content-website-preview">
                        <header>
                          <span>{copy.preview}</span>
                          <small>
                            {copy.previewExact} · r
                            {websiteDrafts[item.id]?.currentRevision}
                          </small>
                        </header>
                        <div className="content-preview-browser">
                          <div className="content-preview-address">
                            {copy.previewPath}/
                            {websiteDrafts[item.id]?.revision.slug}
                          </div>
                          <div className="content-preview-page">
                            <p className="content-preview-kicker">
                              {copy.websiteDraft}
                            </p>
                            <h4>{websiteDrafts[item.id]?.revision.title}</h4>
                            {websiteDrafts[item.id]?.revision.excerpt ? (
                              <p className="content-preview-excerpt">
                                {websiteDrafts[item.id]?.revision.excerpt}
                              </p>
                            ) : null}
                            {websiteDrafts[item.id]?.revision.bodyText
                              .split(/\n{2,}/)
                              .map((paragraph, index) => (
                                <p key={`${index}-${paragraph.slice(0, 24)}`}>
                                  {paragraph}
                                </p>
                              ))}
                            <footer>
                              {copy.previewMedia}:{" "}
                              {
                                websiteDrafts[item.id]?.revision.mediaAssetIds
                                  .length
                              }
                            </footer>
                          </div>
                        </div>
                      </article>
                    ) : null}
                    {websiteDrafts[item.id] ? (
                      <section className="content-website-review">
                        <div>
                          <span>{copy.reviewStatus}</span>
                          <strong>
                            {websiteDrafts[item.id]?.review?.decision ===
                            "pending"
                              ? copy.pendingReview
                              : websiteDrafts[item.id]?.review?.decision ===
                                  "approved"
                                ? copy.approvedReview
                                : websiteDrafts[item.id]?.review?.decision ===
                                    "rejected"
                                  ? copy.rejectedReview
                                  : copy.newDraft}
                          </strong>
                        </div>
                        <p>{copy.reviewSafety}</p>
                        {!websiteDrafts[item.id]?.review &&
                        websiteDrafts[item.id]?.permissions.canEdit ? (
                          <button
                            type="button"
                            disabled={draftBusyItemId === item.id}
                            onClick={() => void requestWebsiteReview(item)}
                          >
                            {draftBusyItemId === item.id
                              ? copy.requestingReview
                              : copy.requestReview}
                          </button>
                        ) : null}
                        {websiteDrafts[item.id]?.review?.decision ===
                          "pending" &&
                        websiteDrafts[item.id]?.review
                          ?.requestedByCurrentUser ? (
                          <p>{copy.reviewSelf}</p>
                        ) : null}
                        {websiteDrafts[item.id]?.review?.decision ===
                          "pending" &&
                        !websiteDrafts[item.id]?.permissions.mfaVerified ? (
                          <p>{copy.reviewMfa}</p>
                        ) : null}
                        {websiteDrafts[item.id]?.review?.decision ===
                          "pending" &&
                        websiteDrafts[item.id]?.permissions.canApprove &&
                        websiteDrafts[item.id]?.permissions.mfaVerified &&
                        !websiteDrafts[item.id]?.review
                          ?.requestedByCurrentUser ? (
                          <div className="content-website-review-actions">
                            <button
                              type="button"
                              disabled={draftBusyItemId === item.id}
                              onClick={() =>
                                void decideWebsiteReview(item, "approved")
                              }
                            >
                              {copy.approveReview}
                            </button>
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                const value = new FormData(
                                  event.currentTarget,
                                ).get("reason");
                                if (typeof value === "string")
                                  void decideWebsiteReview(
                                    item,
                                    "rejected",
                                    value.trim(),
                                  );
                              }}
                            >
                              <label>
                                {copy.rejectionReason}
                                <textarea
                                  name="reason"
                                  required
                                  minLength={10}
                                  maxLength={500}
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={draftBusyItemId === item.id}
                              >
                                {copy.rejectReview}
                              </button>
                            </form>
                          </div>
                        ) : null}
                        {websiteDrafts[item.id]?.review?.reason ? (
                          <blockquote>
                            {websiteDrafts[item.id]?.review?.reason}
                          </blockquote>
                        ) : null}
                      </section>
                    ) : null}
                    <form
                      className="content-website-draft-form"
                      key={draft?.currentRevision ?? 0}
                      action={(form) => saveWebsiteDraft(item, form)}
                      onInput={(event) =>
                        updateDraftMetrics(item.id, event.currentTarget)
                      }
                    >
                      <div className="content-draft-revision">
                        <strong>
                          {websiteDrafts[item.id]
                            ? `${copy.draftRevision} ${websiteDrafts[item.id]?.currentRevision}`
                            : copy.newDraft}
                        </strong>
                        <span>
                          {copy.draftMedia}: {item.mediaAssetIds.length}
                        </span>
                      </div>
                      <label>
                        {copy.draftSlug}
                        <input
                          name="slug"
                          required
                          maxLength={180}
                          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                          defaultValue={
                            websiteDrafts[item.id]?.revision.slug ??
                            slugify(item.title)
                          }
                        />
                      </label>
                      <label>
                        <span>
                          {copy.draftTitle}
                          <small>
                            {metrics.title}/240 {copy.draftCharacters}
                          </small>
                        </span>
                        <input
                          name="title"
                          required
                          maxLength={240}
                          defaultValue={
                            websiteDrafts[item.id]?.revision.title ?? item.title
                          }
                        />
                      </label>
                      <label className="content-draft-wide">
                        <span>
                          {copy.draftExcerpt}
                          <small>
                            {metrics.excerpt}/1000 {copy.draftCharacters}
                          </small>
                        </span>
                        <textarea
                          name="excerpt"
                          maxLength={1000}
                          defaultValue={
                            websiteDrafts[item.id]?.revision.excerpt ??
                            item.summary
                          }
                        />
                      </label>
                      <label className="content-draft-wide">
                        <span>
                          {copy.draftBody}
                          <small>
                            {metrics.bodyWords} {copy.draftWords} ·{" "}
                            {metrics.bodyCharacters}/50000{" "}
                            {copy.draftCharacters}
                          </small>
                        </span>
                        <textarea
                          name="bodyText"
                          required
                          maxLength={50000}
                          defaultValue={
                            websiteDrafts[item.id]?.revision.bodyText ??
                            item.summary
                          }
                        />
                      </label>
                      <aside className="content-draft-guide">
                        <strong>{copy.draftGuideTitle}</strong>
                        <p>{copy.draftGuide}</p>
                      </aside>
                      <button
                        type="submit"
                        disabled={draftBusyItemId === item.id}
                      >
                        {draftBusyItemId === item.id
                          ? copy.savingDraft
                          : copy.saveDraft}
                      </button>
                    </form>
                  </div>
                ) : null}
              </section>
            </article>
          );
        })}
      </section>
    </>
  );
}
