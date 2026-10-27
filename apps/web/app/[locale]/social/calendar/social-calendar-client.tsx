"use client";

import { useMemo, useState } from "react";

import type { SocialDraftSummary } from "../../../social-contract";
import { WorkspaceOnboarding } from "../../../workspace-onboarding";
import { useSocialStudio } from "../use-social-studio";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    loading: "Loading the publishing calendar…",
    signedOut: "Sign in to inspect the publishing calendar.",
    unavailable: "The publishing calendar is unavailable right now.",
    previous: "Previous month",
    next: "Next month",
    today: "Today",
    unscheduled: "Workflow queue",
    noUnscheduled: "No unscheduled drafts.",
    emptyDay: "No scheduled publication",
    pending: "Pending approval",
    untitled: "Untitled",
  },
  de: {
    loading: "Veröffentlichungskalender wird geladen…",
    signedOut: "Anmelden, um den Veröffentlichungskalender zu sehen.",
    unavailable: "Der Veröffentlichungskalender ist derzeit nicht verfügbar.",
    previous: "Vorheriger Monat",
    next: "Nächster Monat",
    today: "Heute",
    unscheduled: "Workflow-Warteschlange",
    noUnscheduled: "Keine ungeplanten Entwürfe.",
    emptyDay: "Keine geplante Veröffentlichung",
    pending: "Freigabe ausstehend",
    untitled: "Ohne Titel",
  },
  sq: {
    loading: "Po ngarkohet kalendari i publikimeve…",
    signedOut: "Hyni për të parë kalendarin e publikimeve.",
    unavailable: "Kalendari i publikimeve nuk është i disponueshëm tani.",
    previous: "Muaji i kaluar",
    next: "Muaji tjetër",
    today: "Sot",
    unscheduled: "Radha e workflow-t",
    noUnscheduled: "Nuk ka drafte pa orar.",
    emptyDay: "Nuk ka publikim të planifikuar",
    pending: "Në pritje të aprovimit",
    untitled: "Pa titull",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const dateKey = (date: Date) =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

const draftLabel = (draft: SocialDraftSummary, untitled: string) =>
  draft.content.title ?? draft.content.caption ?? untitled;

function scheduledDateKey(draft: SocialDraftSummary) {
  if (!draft.scheduledFor) return null;
  const date = new Date(draft.scheduledFor);
  if (Number.isNaN(date.valueOf())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: draft.scheduleTimezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function scheduledTime(draft: SocialDraftSummary, locale: Locale) {
  if (!draft.scheduledFor) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: draft.scheduleTimezone ?? "UTC",
    }).format(new Date(draft.scheduledFor));
  } catch {
    return "—";
  }
}

export function SocialCalendarClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const { state } = useSocialStudio();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const cells = useMemo(() => monthCells(month), [month]);

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

  const scheduled = new Map<string, SocialDraftSummary[]>();
  const unscheduled: SocialDraftSummary[] = [];
  for (const draft of state.snapshot.drafts) {
    if (!draft.scheduledFor) {
      unscheduled.push(draft);
      continue;
    }
    const key = scheduledDateKey(draft);
    if (!key) continue;
    scheduled.set(key, [...(scheduled.get(key) ?? []), draft]);
  }
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
      new Date(2026, 7, 24 + index),
    ),
  );
  return (
    <div className="calendar-layout">
      <section className="social-calendar social-panel">
        <header className="calendar-toolbar">
          <button
            type="button"
            aria-label={text.previous}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            ←
          </button>
          <div>
            <h2>
              {new Intl.DateTimeFormat(locale, {
                month: "long",
                year: "numeric",
              }).format(month)}
            </h2>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
            >
              {text.today}
            </button>
          </div>
          <button
            type="button"
            aria-label={text.next}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            →
          </button>
        </header>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((date) => {
            const drafts = scheduled.get(dateKey(date)) ?? [];
            const outside = date.getMonth() !== month.getMonth();
            return (
              <article data-outside={String(outside)} key={dateKey(date)}>
                <time dateTime={dateKey(date)}>{String(date.getDate())}</time>
                {drafts.length ? (
                  <ul>
                    {drafts.map((draft) => (
                      <li key={draft.id} data-draft-status={draft.status}>
                        <strong>{draftLabel(draft, text.untitled)}</strong>
                        <small>
                          {scheduledTime(draft, locale)}
                          {draft.scheduleTimezone
                            ? ` · ${draft.scheduleTimezone}`
                            : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="calendar-empty">{text.emptyDay}</span>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <aside className="social-panel calendar-queue">
        <header>
          <h2>{text.unscheduled}</h2>
          <span>{String(unscheduled.length)}</span>
        </header>
        {unscheduled.length ? (
          <ul>
            {unscheduled.map((draft) => (
              <li key={draft.id}>
                <strong>{draftLabel(draft, text.untitled)}</strong>
                <span data-draft-status={draft.status}>{draft.status}</span>
                {draft.approval?.decision === "pending" ? (
                  <small>{text.pending}</small>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.noUnscheduled}</p>
        )}
      </aside>
    </div>
  );
}
