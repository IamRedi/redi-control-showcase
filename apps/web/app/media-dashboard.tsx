"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { localizedLoginHref } from "./auth-navigation-contract";
import {
  classifyWorkspaceResponse,
  workspaceRequiredLabel,
} from "./workspace-onboarding-contract";
import { WorkspaceOnboarding } from "./workspace-onboarding";

type Locale = "en" | "de" | "sq";

interface Overview {
  readonly workspace: { readonly displayName: string };
  readonly counts: {
    readonly readyMedia: number;
    readonly socialAccounts: number;
    readonly healthySocialAccounts: number;
    readonly draftPosts: number;
    readonly scheduledPosts: number;
    readonly pendingApprovals: number;
  };
  readonly channels: readonly {
    readonly name:
      | "website"
      | "facebook"
      | "instagram"
      | "tiktok"
      | "email"
      | "whatsapp";
    readonly status:
      | "connected"
      | "needs_attention"
      | "not_connected"
      | "planned";
  }[];
  readonly activity: readonly {
    readonly action: string;
    readonly occurredAt: string;
  }[];
}

const copy: Record<Locale, Record<string, string>> = {
  sq: {
    mediaControl: "Kontrolli i medias",
    overview: "Përmbledhje",
    newsroom: "Newsroom",
    articles: "Artikuj",
    website: "Website",
    channels: "Kanale",
    people: "Njerëz dhe role",
    operations: "Operacionet",
    signedOut: "Hyni për të parë të dhënat e medias.",
    signIn: "Hyni me siguri",
    unavailable: "Të dhënat e medias nuk janë të disponueshme tani.",
    loading: "Po ngarkohet media…",
    sourceResearch: "Kërko dhe verifiko lajme",
    sourceResearchBody:
      "Mblidh burime, krahasoji dhe ruaj provat para se të krijosh artikullin.",
    articleStudio: "Krijo artikull dhe variante",
    articleStudioBody:
      "Një temë qendrore me versione të pavarura për website dhe rrjete sociale.",
    websiteControl: "Kontrollo website-in",
    websiteControlBody:
      "Lidhjet dhe statusi editorial i website-it; asnjë website nuk publikohet pa integrim të verifikuar.",
    open: "Hap",
    approvalQueue: "Në pritje aprovimi",
    draftPosts: "Drafte postimesh",
    scheduledPosts: "Postime të planifikuara",
    readyMedia: "Media të gatshme",
    channelStatus: "Gjendja e kanaleve",
    notConnected: "Jo e lidhur",
    connected: "E lidhur",
    needsAttention: "Kërkon vëmendje",
    later: "Më vonë",
    externalNote:
      "Kanalet lidhen vetëm pasi të pranohen llogaritë dhe API-të reale. REDI CONTROL nuk publikon automatikisht.",
    latestActivity: "Aktiviteti i fundit",
    noActivity: "Nuk ka aktivitet të regjistruar ende.",
    peopleBody:
      "Gazetarët punojnë vetëm brenda medias së tyre; aprovimi dhe administrimi kërkojnë role të ndara.",
  },
  en: {
    mediaControl: "Media control",
    overview: "Overview",
    newsroom: "Newsroom",
    articles: "Articles",
    website: "Website",
    channels: "Channels",
    people: "People & roles",
    operations: "Operations",
    signedOut: "Sign in to view this media's data.",
    signIn: "Sign in securely",
    unavailable: "Media data is not available right now.",
    loading: "Loading media…",
    sourceResearch: "Research and verify news",
    sourceResearchBody:
      "Collect sources, compare them and retain evidence before creating an article.",
    articleStudio: "Create articles and variants",
    articleStudioBody:
      "One central story with independent website and social-channel versions.",
    websiteControl: "Control the website",
    websiteControlBody:
      "Website connection and editorial status; nothing is published without a verified integration.",
    open: "Open",
    approvalQueue: "Awaiting approval",
    draftPosts: "Post drafts",
    scheduledPosts: "Scheduled posts",
    readyMedia: "Ready media",
    channelStatus: "Channel status",
    notConnected: "Not connected",
    connected: "Connected",
    needsAttention: "Needs attention",
    later: "Later",
    externalNote:
      "Channels connect only after the real accounts and APIs are accepted. REDI CONTROL does not publish autonomously.",
    latestActivity: "Latest activity",
    noActivity: "No activity has been recorded yet.",
    peopleBody:
      "Journalists work only inside their own media; approval and administration require separate roles.",
  },
  de: {
    mediaControl: "Mediensteuerung",
    overview: "Übersicht",
    newsroom: "Newsroom",
    articles: "Artikel",
    website: "Website",
    channels: "Kanäle",
    people: "Personen & Rollen",
    operations: "Betrieb",
    signedOut: "Melden Sie sich an, um die Daten dieser Redaktion zu sehen.",
    signIn: "Sicher anmelden",
    unavailable: "Mediendaten sind momentan nicht verfügbar.",
    loading: "Medium wird geladen…",
    sourceResearch: "Nachrichten recherchieren und prüfen",
    sourceResearchBody:
      "Quellen sammeln, vergleichen und Belege sichern, bevor ein Artikel entsteht.",
    articleStudio: "Artikel und Varianten erstellen",
    articleStudioBody:
      "Eine zentrale Geschichte mit unabhängigen Versionen für Website und soziale Kanäle.",
    websiteControl: "Website steuern",
    websiteControlBody:
      "Website-Verbindung und Redaktionsstatus; ohne geprüfte Integration wird nichts veröffentlicht.",
    open: "Öffnen",
    approvalQueue: "Zur Freigabe",
    draftPosts: "Beitragsentwürfe",
    scheduledPosts: "Geplante Beiträge",
    readyMedia: "Fertige Medien",
    channelStatus: "Kanalstatus",
    notConnected: "Nicht verbunden",
    connected: "Verbunden",
    needsAttention: "Aufmerksamkeit erforderlich",
    later: "Später",
    externalNote:
      "Kanäle werden erst nach Annahme der echten Konten und APIs verbunden. REDI CONTROL veröffentlicht nicht autonom.",
    latestActivity: "Letzte Aktivität",
    noActivity: "Noch keine Aktivität aufgezeichnet.",
    peopleBody:
      "Journalisten arbeiten nur innerhalb ihres Mediums; Freigabe und Verwaltung erfordern getrennte Rollen.",
  },
};

const channelLabels = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  email: "Email",
  whatsapp: "WhatsApp",
} as const;

export function MediaDashboard({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<
    "loading" | "signed-out" | "workspace-required" | "unavailable"
  >("loading");

  useEffect(() => {
    void fetch("/api/dashboard/overview", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          return setState(classifyWorkspaceResponse(response.status));
        setOverview((await response.json()) as Overview);
      })
      .catch(() => setState("unavailable"));
  }, []);

  const home = `/${locale}`;
  const stateMessage =
    state === "loading"
      ? text.loading
      : state === "signed-out"
        ? text.signedOut
        : state === "workspace-required"
          ? workspaceRequiredLabel(locale)
          : text.unavailable;

  return (
    <main className="media-main" lang={locale}>
      <header className="media-header">
        <div>
          <p>{text.mediaControl}</p>
          <h1>{overview?.workspace.displayName ?? "REDI CONTROL"}</h1>
        </div>
        {state === "signed-out" ? (
          <a className="media-sign-in" href={localizedLoginHref(locale)}>
            {text.signIn} →
          </a>
        ) : (
          <span className="media-status">
            ● {overview ? text.overview : stateMessage}
          </span>
        )}
      </header>
      {!overview ? (
        <section className="media-loading" role="status">
          {state === "workspace-required" ? (
            <WorkspaceOnboarding
              locale={locale}
              linkClassName="media-sign-in"
            />
          ) : (
            <p>{stateMessage}</p>
          )}
          {state === "signed-out" ? (
            <a className="media-sign-in" href={localizedLoginHref(locale)}>
              {text.signIn} →
            </a>
          ) : null}
        </section>
      ) : (
        <>
          <section className="media-actions" aria-label={text.mediaControl}>
            <article>
              <span>⌕</span>
              <h2>{text.sourceResearch}</h2>
              <p>{text.sourceResearchBody}</p>
              <Link href={`${home}/research`}>{text.open} →</Link>
            </article>
            <article>
              <span>✎</span>
              <h2>{text.articleStudio}</h2>
              <p>{text.articleStudioBody}</p>
              <Link href={`${home}/content`}>{text.open} →</Link>
            </article>
            <article>
              <span>◫</span>
              <h2>{text.websiteControl}</h2>
              <p>{text.websiteControlBody}</p>
              <Link href={`${home}/websites`}>{text.open} →</Link>
            </article>
          </section>
          <section className="media-counts" aria-label={text.overview}>
            {[
              [text.approvalQueue, overview.counts.pendingApprovals],
              [text.draftPosts, overview.counts.draftPosts],
              [text.scheduledPosts, overview.counts.scheduledPosts],
              [text.readyMedia, overview.counts.readyMedia],
            ].map(([label, value]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <div className="media-lower">
            <section id="channels" className="media-panel">
              <h2>{text.channelStatus}</h2>
              <p>{text.externalNote}</p>
              <ul className="channel-list">
                {overview.channels.map((channel) => (
                  <li key={channel.name}>
                    <strong>{channelLabels[channel.name]}</strong>
                    <span data-channel-status={channel.status}>
                      {channel.status === "connected"
                        ? text.connected
                        : channel.status === "needs_attention"
                          ? text.needsAttention
                          : channel.status === "planned"
                            ? text.later
                            : text.notConnected}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section id="operations" className="media-panel">
              <h2>{text.latestActivity}</h2>
              {overview.activity.length === 0 ? (
                <p>{text.noActivity}</p>
              ) : (
                <ul className="activity-list">
                  {overview.activity.map((event) => (
                    <li key={`${event.action}-${event.occurredAt}`}>
                      {event.action}
                    </li>
                  ))}
                </ul>
              )}
              <div className="people-note">
                <strong>{text.people}</strong>
                <p>
                  {text.peopleBody}{" "}
                  <Link href={`${home}/people`}>{text.open} →</Link>
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
