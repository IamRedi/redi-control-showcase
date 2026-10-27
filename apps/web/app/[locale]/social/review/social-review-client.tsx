"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  parseSocialWorkflowDetail,
  type SocialDraftSummary,
  type SocialRevisionSummary,
  type SocialWorkflowAction,
  type SocialWorkflowDetail,
} from "../../../social-contract";
import { WorkspaceOnboarding } from "../../../workspace-onboarding";
import { useSocialStudio } from "../use-social-studio";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    loading: "Loading the governed review queue…",
    signedOut: "Sign in to review social drafts.",
    unavailable: "The review workflow is unavailable right now.",
    queue: "Workflow queue",
    empty: "No draft currently needs workflow action.",
    select: "Select a draft to inspect its immutable history.",
    revision: "Revision",
    current: "Current",
    previous: "Previous",
    title: "Title",
    caption: "Caption",
    description: "Description",
    media: "Media",
    destinations: "Destinations",
    unchanged: "Unchanged",
    changed: "Changed",
    submit: "Submit for independent review",
    approve: "Approve exact revision",
    reject: "Reject revision",
    reason: "Reason for rejection",
    schedule: "Schedule approved revision",
    scheduleAt: "Local publication time",
    timezone: "Stored timezone",
    mfa: "Approval requires an MFA-verified approver session.",
    self: "The requester cannot approve their own revision.",
    saving: "Applying governed action…",
    success: "Workflow updated. No provider publication was triggered.",
    failure:
      "The action was refused or the workflow changed. Reload and verify.",
    untitled: "Untitled",
    noValue: "No content",
  },
  de: {
    loading: "Kontrollierte Prüfwarteschlange wird geladen…",
    signedOut: "Anmelden, um Social-Entwürfe zu prüfen.",
    unavailable: "Der Prüfablauf ist derzeit nicht verfügbar.",
    queue: "Workflow-Warteschlange",
    empty: "Kein Entwurf benötigt derzeit eine Workflow-Aktion.",
    select: "Entwurf auswählen, um den unveränderlichen Verlauf zu prüfen.",
    revision: "Revision",
    current: "Aktuell",
    previous: "Vorherige",
    title: "Titel",
    caption: "Text",
    description: "Beschreibung",
    media: "Medien",
    destinations: "Ziele",
    unchanged: "Unverändert",
    changed: "Geändert",
    submit: "Zur unabhängigen Prüfung einreichen",
    approve: "Exakte Revision freigeben",
    reject: "Revision ablehnen",
    reason: "Grund der Ablehnung",
    schedule: "Freigegebene Revision planen",
    scheduleAt: "Lokale Veröffentlichungszeit",
    timezone: "Gespeicherte Zeitzone",
    mfa: "Die Freigabe erfordert eine MFA-verifizierte Prüfersitzung.",
    self: "Antragstellende dürfen ihre eigene Revision nicht freigeben.",
    saving: "Kontrollierte Aktion wird angewendet…",
    success:
      "Workflow aktualisiert. Beim Anbieter wurde nichts veröffentlicht.",
    failure: "Aktion abgelehnt oder Workflow geändert. Neu laden und prüfen.",
    untitled: "Ohne Titel",
    noValue: "Kein Inhalt",
  },
  sq: {
    loading: "Po ngarkohet radha e kontrolluar e review-t…",
    signedOut: "Hyni për të kontrolluar draftet sociale.",
    unavailable: "Workflow i review-t nuk është i disponueshëm tani.",
    queue: "Radha e workflow-t",
    empty: "Asnjë draft nuk kërkon veprim në workflow tani.",
    select: "Zgjidh një draft për të kontrolluar historikun immutable.",
    revision: "Revizioni",
    current: "Aktual",
    previous: "I mëparshëm",
    title: "Titulli",
    caption: "Teksti",
    description: "Përshkrimi",
    media: "Media",
    destinations: "Destinacionet",
    unchanged: "Pa ndryshim",
    changed: "Ndryshuar",
    submit: "Dërgo për review të pavarur",
    approve: "Aprovo revizionin e saktë",
    reject: "Refuzo revizionin",
    reason: "Arsyeja e refuzimit",
    schedule: "Planifiko revizionin e aprovuar",
    scheduleAt: "Koha lokale e publikimit",
    timezone: "Timezone i ruajtur",
    mfa: "Aprovimi kërkon sesion aprovuesi të verifikuar me MFA.",
    self: "Kërkuesi nuk mund të aprovojë revizionin e vet.",
    saving: "Po zbatohet veprimi i kontrolluar…",
    success: "Workflow u përditësua. Nuk u publikua asgjë te provideri.",
    failure: "Veprimi u refuzua ose workflow ndryshoi. Ringarko dhe kontrollo.",
    untitled: "Pa titull",
    noValue: "Pa përmbajtje",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};

const label = (draft: SocialDraftSummary, untitled: string) =>
  draft.content.title ?? draft.content.caption ?? untitled;

const workflowRank = (status: string) =>
  ({ ready_for_review: 0, approved: 1, rejected: 2, draft: 3 })[status] ?? 4;

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function RevisionCard({
  revision,
  compare,
  text,
}: {
  readonly revision: SocialRevisionSummary;
  readonly compare?: SocialRevisionSummary;
  readonly text: (typeof copy)[Locale];
}) {
  const rows = [
    [text.title, revision.content.title, compare?.content.title],
    [text.caption, revision.content.caption, compare?.content.caption],
    [
      text.description,
      revision.content.description,
      compare?.content.description,
    ],
  ] as const;
  const media = revision.media.map((asset) => asset.filename);
  const compareMedia = compare?.media.map((asset) => asset.filename) ?? [];
  const targets = revision.targets.map(
    (target) => `${target.accountName} · ${target.channel}`,
  );
  const compareTargets =
    compare?.targets.map(
      (target) => `${target.accountName} · ${target.channel}`,
    ) ?? [];
  return (
    <article className="revision-card">
      <header>
        <strong>
          {text.revision} {String(revision.revisionNumber)}
        </strong>
        {revision.isCurrent ? <span>{text.current}</span> : null}
      </header>
      {rows.map(([name, value, compared]) => {
        const changed = compare ? value !== compared : false;
        return (
          <section key={name} data-changed={String(changed)}>
            <small>{name}</small>
            <p>{value || text.noValue}</p>
            {compare ? (
              <em>{changed ? text.changed : text.unchanged}</em>
            ) : null}
          </section>
        );
      })}
      <section
        data-changed={String(compare ? !sameList(media, compareMedia) : false)}
      >
        <small>{text.media}</small>
        <p>{media.length ? media.join(", ") : text.noValue}</p>
      </section>
      <section
        data-changed={String(
          compare ? !sameList(targets, compareTargets) : false,
        )}
      >
        <small>{text.destinations}</small>
        <p>{targets.length ? targets.join(", ") : text.noValue}</p>
      </section>
    </article>
  );
}

export function SocialReviewClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const { state, reload } = useSocialStudio();
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SocialWorkflowDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [actionState, setActionState] = useState<
    "idle" | "saving" | "success" | "failure"
  >("idle");
  const [compareRevision, setCompareRevision] = useState<number | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const loadDetail = useCallback(
    async (draftId: string, workspaceId: string) => {
      setDetailState("loading");
      try {
        const response = await fetch(
          `/api/social/workflow/${encodeURIComponent(draftId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok) throw new Error("workflow_unavailable");
        const parsed = parseSocialWorkflowDetail(await response.json());
        if (!parsed) throw new Error("workflow_invalid");
        setDetail(parsed);
        setCompareRevision(parsed.revisions[1]?.revisionNumber ?? null);
        setDetailState("idle");
      } catch {
        setDetail(null);
        setDetailState("error");
      }
    },
    [],
  );

  const queue = useMemo(
    () =>
      state.status === "ready"
        ? [...state.snapshot.drafts]
            .filter((draft) =>
              ["draft", "ready_for_review", "approved", "rejected"].includes(
                draft.status,
              ),
            )
            .sort(
              (left, right) =>
                workflowRank(left.status) - workflowRank(right.status) ||
                right.updatedAt.localeCompare(left.updatedAt),
            )
        : [],
    [state],
  );

  useEffect(() => {
    if (state.status !== "ready") return;
    if (!queue.length) {
      setSelected(null);
      setDetail(null);
      return;
    }
    const draftId =
      selected && queue.some((draft) => draft.id === selected)
        ? selected
        : queue[0]!.id;
    if (draftId !== selected) {
      setSelected(draftId);
      return;
    }
    void loadDetail(draftId, state.workspaceId);
  }, [loadDetail, queue, selected, state]);

  async function apply(action: SocialWorkflowAction) {
    if (!selected || state.status !== "ready") return;
    setActionState("saving");
    try {
      const response = await fetch(`/api/social/workflow/${selected}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf(),
        },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error("workflow_refused");
      setActionState("success");
      await reload();
      await loadDetail(selected, state.workspaceId);
    } catch {
      setActionState("failure");
    }
  }

  function decide(form: HTMLFormElement, decision: "approved" | "rejected") {
    const reasonValue = new FormData(form).get("reason");
    const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";
    if (decision === "rejected" && !reason) {
      setActionState("failure");
      return;
    }
    void apply({ action: "decide", decision, ...(reason ? { reason } : {}) });
  }

  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("scheduledFor");
    if (typeof value !== "string") return;
    const instant = new Date(value);
    if (Number.isNaN(instant.valueOf()) || instant.getTime() <= Date.now()) {
      setActionState("failure");
      return;
    }
    void apply({
      action: "schedule",
      scheduledFor: instant.toISOString(),
      timezone,
    });
  }

  if (state.status !== "ready")
    return (
      <section className="social-state" role="status">
        {state.status === "workspace-required" ? (
          <WorkspaceOnboarding locale={locale} linkClassName="social-primary" />
        ) : state.status === "loading" ? (
          text.loading
        ) : state.status === "signed-out" ? (
          text.signedOut
        ) : (
          text.unavailable
        )}
      </section>
    );

  const current = detail?.revisions.find((revision) => revision.isCurrent);
  const compared = detail?.revisions.find(
    (revision) => revision.revisionNumber === compareRevision,
  );
  const pending = current?.approval?.decision === "pending";
  const selfApproval = current?.approval?.requestedByCurrentUser === true;
  const canDecide =
    pending &&
    detail?.permissions.canApprove === true &&
    !selfApproval &&
    actionState !== "saving";
  return (
    <div className="review-layout">
      <aside className="social-panel review-queue">
        <header>
          <h2>{text.queue}</h2>
          <span>{String(queue.length)}</span>
        </header>
        {queue.length ? (
          <ul>
            {queue.map((draft) => (
              <li key={draft.id}>
                <button
                  type="button"
                  data-selected={String(selected === draft.id)}
                  onClick={() => {
                    setSelected(draft.id);
                    setActionState("idle");
                  }}
                >
                  <strong>{label(draft, text.untitled)}</strong>
                  <small>
                    {text.revision} {String(draft.currentRevision)}
                  </small>
                  <span data-draft-status={draft.status}>{draft.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.empty}</p>
        )}
      </aside>
      <section className="review-workspace">
        {!selected ? <div className="social-state">{text.select}</div> : null}
        {detailState === "loading" ? (
          <div className="social-state">{text.loading}</div>
        ) : detailState === "error" ? (
          <div className="social-state">{text.unavailable}</div>
        ) : current && detail ? (
          <>
            <div className="social-panel revision-compare-toolbar">
              <strong>
                {text.current}: {text.revision} {String(current.revisionNumber)}
              </strong>
              {detail.revisions.length > 1 ? (
                <label>
                  {text.previous}
                  <select
                    value={compareRevision ?? ""}
                    onChange={(event) =>
                      setCompareRevision(Number(event.currentTarget.value))
                    }
                  >
                    {detail.revisions
                      .filter((revision) => !revision.isCurrent)
                      .map((revision) => (
                        <option
                          key={revision.revisionNumber}
                          value={revision.revisionNumber}
                        >
                          {text.revision} {String(revision.revisionNumber)}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="revision-compare-grid">
              {compared ? (
                <RevisionCard
                  revision={compared}
                  compare={current}
                  text={text}
                />
              ) : null}
              <RevisionCard
                revision={current}
                {...(compared ? { compare: compared } : {})}
                text={text}
              />
            </div>
            <section className="social-panel workflow-actions">
              {detail.draft.status === "draft" && detail.permissions.canEdit ? (
                <button
                  className="social-primary"
                  type="button"
                  disabled={actionState === "saving"}
                  onClick={() => void apply({ action: "submit" })}
                >
                  {text.submit}
                </button>
              ) : null}
              {pending ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    decide(event.currentTarget, "approved");
                  }}
                >
                  <label>
                    {text.reason}
                    <textarea name="reason" maxLength={500} rows={3} />
                  </label>
                  <div>
                    <button
                      className="social-primary"
                      type="submit"
                      disabled={!canDecide}
                    >
                      {text.approve}
                    </button>
                    <button
                      type="button"
                      disabled={!canDecide}
                      onClick={(event) => {
                        const form = event.currentTarget.form;
                        if (form) decide(form, "rejected");
                      }}
                    >
                      {text.reject}
                    </button>
                  </div>
                </form>
              ) : null}
              {pending && !detail.permissions.mfaVerified ? (
                <p>{text.mfa}</p>
              ) : null}
              {pending && selfApproval ? <p>{text.self}</p> : null}
              {detail.draft.status === "approved" &&
              detail.permissions.canEdit ? (
                <form onSubmit={schedule}>
                  <label>
                    {text.scheduleAt}
                    <input name="scheduledFor" type="datetime-local" required />
                  </label>
                  <p>
                    {text.timezone}: <strong>{timezone}</strong>
                  </p>
                  <button
                    className="social-primary"
                    type="submit"
                    disabled={actionState === "saving"}
                  >
                    {text.schedule}
                  </button>
                </form>
              ) : null}
              <p
                className="composer-result"
                aria-live="polite"
                data-state={actionState}
              >
                {actionState === "saving"
                  ? text.saving
                  : actionState === "success"
                    ? text.success
                    : actionState === "failure"
                      ? text.failure
                      : ""}
              </p>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
