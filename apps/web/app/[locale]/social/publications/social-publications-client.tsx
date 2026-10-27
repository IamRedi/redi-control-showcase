"use client";

import { useMemo, useState } from "react";

import type { SocialPublicationSummary } from "../../../social-contract";
import { WorkspaceOnboarding } from "../../../workspace-onboarding";
import { useSocialPublications } from "./use-social-publications";

type Locale = "en" | "de" | "sq";
type Filter = "all" | "queued" | "processing" | "published" | "attention";

const copy = {
  en: {
    loading: "Loading publication operations…",
    signedOut: "Sign in to inspect publication operations.",
    unavailable: "Publication operations are unavailable right now.",
    guardTitle: "Provider execution is not activated",
    guardBody:
      "Scheduled work is recorded safely, but no background worker sends it to Meta. Reconciliation and manual retry remain unavailable.",
    all: "All",
    queued: "Queued",
    processing: "Processing",
    published: "Published",
    attention: "Needs attention",
    empty: "No publications match this view.",
    untitled: "Untitled publication",
    revision: "Revision",
    scheduled: "Scheduled",
    updated: "Updated",
    channelStatus: "Channel status",
    job: "Queue job",
    attempt: "Delivery attempt",
    noAttempt: "No provider attempt",
    reconciliation: "Reconciliation",
    unavailableShort: "Not available",
    retries: "Retries",
    referenceStored: "Provider receipt stored",
    noReference: "No provider receipt",
    summaryDrafts: "Publications",
    summaryChannels: "Channels",
    summaryQueued: "Queued jobs",
    summaryAttention: "Attention",
  },
  de: {
    loading: "Publikationsbetrieb wird geladen…",
    signedOut: "Anmelden, um den Publikationsbetrieb zu prüfen.",
    unavailable: "Der Publikationsbetrieb ist derzeit nicht verfügbar.",
    guardTitle: "Provider-Ausführung ist nicht aktiviert",
    guardBody:
      "Geplante Arbeit wird sicher erfasst, aber kein Hintergrund-Worker sendet sie an Meta. Abgleich und manuelle Wiederholung bleiben nicht verfügbar.",
    all: "Alle",
    queued: "Wartend",
    processing: "In Bearbeitung",
    published: "Veröffentlicht",
    attention: "Prüfung nötig",
    empty: "Keine Publikationen entsprechen dieser Ansicht.",
    untitled: "Publikation ohne Titel",
    revision: "Revision",
    scheduled: "Geplant",
    updated: "Aktualisiert",
    channelStatus: "Kanalstatus",
    job: "Warteschlangenjob",
    attempt: "Auslieferungsversuch",
    noAttempt: "Kein Provider-Versuch",
    reconciliation: "Abgleich",
    unavailableShort: "Nicht verfügbar",
    retries: "Wiederholungen",
    referenceStored: "Provider-Beleg gespeichert",
    noReference: "Kein Provider-Beleg",
    summaryDrafts: "Publikationen",
    summaryChannels: "Kanäle",
    summaryQueued: "Wartende Jobs",
    summaryAttention: "Prüfung",
  },
  sq: {
    loading: "Po ngarkohen operacionet e publikimit…",
    signedOut: "Hyni për të kontrolluar operacionet e publikimit.",
    unavailable: "Operacionet e publikimit nuk janë të disponueshme tani.",
    guardTitle: "Ekzekutimi te provideri nuk është aktivizuar",
    guardBody:
      "Puna e planifikuar regjistrohet në mënyrë të sigurt, por asnjë worker nuk e dërgon te Meta. Reconciliation dhe riprova manuale mbeten të padisponueshme.",
    all: "Të gjitha",
    queued: "Në radhë",
    processing: "Në proces",
    published: "Publikuar",
    attention: "Kërkon vëmendje",
    empty: "Asnjë publikim nuk përputhet me këtë pamje.",
    untitled: "Publikim pa titull",
    revision: "Revizioni",
    scheduled: "Planifikuar",
    updated: "Përditësuar",
    channelStatus: "Statusi i kanalit",
    job: "Job-i në radhë",
    attempt: "Tentativa e dërgimit",
    noAttempt: "Asnjë tentativë te provideri",
    reconciliation: "Reconciliation",
    unavailableShort: "I padisponueshëm",
    retries: "Riprova",
    referenceStored: "Dëshmia e providerit është ruajtur",
    noReference: "Pa dëshmi provideri",
    summaryDrafts: "Publikime",
    summaryChannels: "Kanale",
    summaryQueued: "Job-e në radhë",
    summaryAttention: "Vëmendje",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const attentionStatuses = new Set([
  "failed",
  "dead_letter",
  "needs_reauthorization",
  "partial",
]);

function formatDate(
  value: string | null,
  locale: Locale,
  timezone?: string | null,
) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function matches(publication: SocialPublicationSummary, filter: Filter) {
  if (filter === "all") return true;
  return publication.targets.some((target) => {
    const states = [
      target.status,
      target.job?.status,
      target.attempt?.status,
    ].filter(Boolean);
    if (filter === "attention")
      return states.some((status) => attentionStatuses.has(String(status)));
    if (filter === "processing")
      return states.some((status) =>
        ["running", "publishing", "processing"].includes(String(status)),
      );
    return states.includes(filter);
  });
}

export function SocialPublicationsClient({
  locale,
}: {
  readonly locale: Locale;
}) {
  const text = copy[locale];
  const state = useSocialPublications();
  const [filter, setFilter] = useState<Filter>("all");
  const filters: Filter[] = [
    "all",
    "queued",
    "processing",
    "published",
    "attention",
  ];
  const filtered = useMemo(
    () =>
      state.status === "ready"
        ? state.snapshot.publications.filter((item) => matches(item, filter))
        : [],
    [filter, state],
  );
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
  const targets = state.snapshot.publications.flatMap((item) => item.targets);
  const summary = {
    channels: targets.length,
    queued: targets.filter((target) => target.job?.status === "pending").length,
    attention: targets.filter((target) =>
      [target.status, target.job?.status, target.attempt?.status].some(
        (status) => attentionStatuses.has(String(status)),
      ),
    ).length,
  };
  return (
    <div className="publication-operations">
      <section className="publication-guard" role="note">
        <strong>{text.guardTitle}</strong>
        <p>{text.guardBody}</p>
      </section>
      <section className="publication-summary" aria-label="Publication summary">
        {[
          [text.summaryDrafts, state.snapshot.publications.length],
          [text.summaryChannels, summary.channels],
          [text.summaryQueued, summary.queued],
          [text.summaryAttention, summary.attention],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <div
        className="publication-filters"
        role="group"
        aria-label="Status filters"
      >
        {filters.map((item) => (
          <button
            type="button"
            data-active={String(filter === item)}
            key={item}
            onClick={() => setFilter(item)}
          >
            {text[item]}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <section className="publication-list">
          {filtered.map((publication) => (
            <article
              className="social-panel publication-card"
              key={publication.id}
            >
              <header>
                <div>
                  <small>
                    {text.revision} {publication.currentRevision}
                  </small>
                  <h2>
                    {publication.content.title ??
                      publication.content.caption ??
                      text.untitled}
                  </h2>
                </div>
                <span data-draft-status={publication.status}>
                  {publication.status}
                </span>
              </header>
              <dl className="publication-meta">
                <div>
                  <dt>{text.scheduled}</dt>
                  <dd>
                    {formatDate(
                      publication.scheduledFor,
                      locale,
                      publication.scheduleTimezone,
                    )}
                    {publication.scheduleTimezone
                      ? ` · ${publication.scheduleTimezone}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>{text.updated}</dt>
                  <dd>{formatDate(publication.updatedAt, locale)}</dd>
                </div>
              </dl>
              <div className="publication-targets">
                {publication.targets.map((target) => (
                  <section key={target.id}>
                    <header>
                      <div>
                        <small>
                          {target.provider} · {target.channel}
                        </small>
                        <strong>{target.accountName}</strong>
                      </div>
                      <span data-draft-status={target.status}>
                        {target.status}
                      </span>
                    </header>
                    <dl>
                      <div>
                        <dt>{text.channelStatus}</dt>
                        <dd data-draft-status={target.status}>
                          {target.status}
                        </dd>
                      </div>
                      <div>
                        <dt>{text.job}</dt>
                        <dd data-draft-status={target.job?.status ?? "none"}>
                          {target.job
                            ? `${target.job.status} · ${target.job.attemptCount}/${target.job.maxAttempts}`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{text.attempt}</dt>
                        <dd
                          data-draft-status={target.attempt?.status ?? "none"}
                        >
                          {target.attempt
                            ? target.attempt.status
                            : text.noAttempt}
                        </dd>
                      </div>
                      <div>
                        <dt>{text.reconciliation}</dt>
                        <dd>{text.unavailableShort}</dd>
                      </div>
                    </dl>
                    {target.attempt ? (
                      <footer>
                        <span>
                          {text.retries}: {target.attempt.retryCount}
                        </span>
                        <span>
                          {target.attempt.hasProviderReference
                            ? text.referenceStored
                            : text.noReference}
                        </span>
                        {target.attempt.safeError ? (
                          <strong>{target.attempt.safeError}</strong>
                        ) : null}
                      </footer>
                    ) : null}
                  </section>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="social-state">{text.empty}</section>
      )}
    </div>
  );
}
