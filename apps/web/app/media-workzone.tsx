"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  WorkzoneChannelName,
  WorkzoneModelOperation,
  WorkzoneSnapshot,
} from "./workzone-contract";
import { localizedLoginHref } from "./auth-navigation-contract";
import { classifyWorkspaceResponse } from "./workspace-onboarding-contract";
import { WorkspaceOnboarding } from "./workspace-onboarding";

type Locale = "en" | "de" | "sq";

const copy = {
  sq: {
    eyebrow: "Qendra editoriale",
    title: "Media Workzone",
    body: "Një hapësirë e qartë për të kërkuar, krijuar, kontrolluar dhe përgatitur për shpërndarje përmbajtjen e kësaj mediaje.",
    safety: "E izoluar për median · Aprovim njerëzor",
    loading: "Po ngarkohet workzone…",
    signedOut: "Hyni për të hapur workzone-in e medias.",
    unavailable: "Workzone nuk është i disponueshëm tani.",
    signIn: "Hyni me siguri",
    workflow: "Rrjedha editoriale",
    openBoard: "Hap Editorial Workboard",
    workflowBody:
      "Çdo material lëviz në hapa të dallueshëm. Asnjë lidhje e jashtme ose publikim real nuk aktivizohet këtu.",
    research: "Kërkim",
    researchBody: "Mblidh lajme, burime dhe prova.",
    drafting: "Krijim",
    draftingBody: "Ndërto artikullin dhe variantet.",
    review: "Preview & aprovim",
    reviewBody: "Krahaso revizionet dhe vendos.",
    scheduled: "Planifikuar",
    scheduledBody: "Orari ruhet me timezone të qartë.",
    exceptions: "Për t’u zgjidhur",
    exceptionsBody: "Dërgesa me problem ose riautorizim.",
    open: "Hap",
    quickActions: "Veprimet kryesore",
    discover: "Kërko një lajm",
    create: "Krijo përmbajtje",
    compose: "Përgatit postimet",
    manageTeam: "Menaxho ekipin",
    team: "Ekipi i medias",
    teamBody:
      "Përdoruesit dhe rolet menaxhohen nga administratori dhe mbeten vetëm brenda tenant-it të kësaj mediaje.",
    members: "përdorues aktivë",
    readyMedia: "asete gati",
    destinations: "Destinacionet",
    destinationsBody:
      "Gjendje reale e lidhjeve; kanalet e palidhura nuk paraqiten si aktive.",
    connected: "E lidhur",
    attention: "Kërkon vëmendje",
    disconnected: "Jo e lidhur",
    planned: "E planifikuar",
    modelStudio: "Model Studio",
    openModelStudio: "Hap Model Studio",
    modelBody:
      "Modelet caktohen sipas workzone-it, përmes AI Gateway, me buxhet, skema dhe kontroll njerëzor.",
    externalOff: "Ekzekutimi me provider të jashtëm është i çaktivizuar",
    researchModels: "Kërkim dhe fakte",
    researchModelsBody: "Nxjerrje pretendimesh, krahasim provash dhe validim.",
    imageModels: "Foto editoriale",
    imageModelsBody:
      "Slot i rezervuar; asnjë model imazhi nuk është aktivizuar.",
    adaptationModels: "Përshtatje për kanalet",
    adaptationModelsBody: "Slot i rezervuar për gjuhë, format dhe ton.",
    configured: "E konfiguruar",
    paused: "E ndalur",
    notConfigured: "Pa konfiguruar",
    routes: "rrugë modelesh",
  },
  en: {
    eyebrow: "Editorial command center",
    title: "Media Workzone",
    body: "One clear space to research, create, review and prepare this media organisation's content for distribution.",
    safety: "Media-isolated · Human approval",
    loading: "Loading workzone…",
    signedOut: "Sign in to open this media workzone.",
    unavailable: "The workzone is unavailable right now.",
    signIn: "Sign in securely",
    workflow: "Editorial workflow",
    openBoard: "Open Editorial Workboard",
    workflowBody:
      "Every item moves through explicit stages. No external connection or real publishing is activated here.",
    research: "Research",
    researchBody: "Collect news, sources and evidence.",
    drafting: "Create",
    draftingBody: "Build the article and its variants.",
    review: "Preview & approval",
    reviewBody: "Compare revisions and decide.",
    scheduled: "Scheduled",
    scheduledBody: "Timing retains an explicit timezone.",
    exceptions: "Needs resolution",
    exceptionsBody: "Delivery errors or reauthorization.",
    open: "Open",
    quickActions: "Primary actions",
    discover: "Research a story",
    create: "Create content",
    compose: "Prepare posts",
    manageTeam: "Manage team",
    team: "Media team",
    teamBody:
      "Users and roles are managed by the administrator and remain inside this media tenant.",
    members: "active users",
    readyMedia: "ready assets",
    destinations: "Destinations",
    destinationsBody:
      "Truthful connection state; disconnected channels are never presented as active.",
    connected: "Connected",
    attention: "Needs attention",
    disconnected: "Not connected",
    planned: "Planned",
    modelStudio: "Model Studio",
    openModelStudio: "Open Model Studio",
    modelBody:
      "Models are assigned per workzone through the AI Gateway with budgets, schemas and human control.",
    externalOff: "External-provider execution is disabled",
    researchModels: "Research and facts",
    researchModelsBody: "Claim extraction, evidence comparison and validation.",
    imageModels: "Editorial imagery",
    imageModelsBody: "Reserved slot; no image model has been activated.",
    adaptationModels: "Channel adaptation",
    adaptationModelsBody: "Reserved slot for language, format and tone.",
    configured: "Configured",
    paused: "Paused",
    notConfigured: "Not configured",
    routes: "model routes",
  },
  de: {
    eyebrow: "Redaktionelle Zentrale",
    title: "Media Workzone",
    body: "Ein klarer Arbeitsbereich, um Inhalte dieser Medienorganisation zu recherchieren, erstellen, prüfen und für die Verteilung vorzubereiten.",
    safety: "Medienisoliert · Menschliche Freigabe",
    loading: "Workzone wird geladen…",
    signedOut: "Melden Sie sich an, um die Media Workzone zu öffnen.",
    unavailable: "Die Workzone ist derzeit nicht verfügbar.",
    signIn: "Sicher anmelden",
    workflow: "Redaktioneller Ablauf",
    openBoard: "Editorial Workboard öffnen",
    workflowBody:
      "Jeder Inhalt durchläuft eindeutige Stufen. Externe Verbindungen und echte Veröffentlichungen werden hier nicht aktiviert.",
    research: "Recherche",
    researchBody: "Nachrichten, Quellen und Belege sammeln.",
    drafting: "Erstellen",
    draftingBody: "Artikel und Varianten entwickeln.",
    review: "Vorschau & Freigabe",
    reviewBody: "Revisionen vergleichen und entscheiden.",
    scheduled: "Geplant",
    scheduledBody: "Zeitplanung behält die Zeitzone.",
    exceptions: "Zu klären",
    exceptionsBody: "Zustellfehler oder erneute Autorisierung.",
    open: "Öffnen",
    quickActions: "Hauptaktionen",
    discover: "Thema recherchieren",
    create: "Inhalt erstellen",
    compose: "Beiträge vorbereiten",
    manageTeam: "Team verwalten",
    team: "Medienteam",
    teamBody:
      "Benutzer und Rollen werden vom Administrator verwaltet und bleiben im Tenant dieses Mediums.",
    members: "aktive Benutzer",
    readyMedia: "fertige Assets",
    destinations: "Ziele",
    destinationsBody:
      "Echter Verbindungsstatus; getrennte Kanäle werden niemals als aktiv dargestellt.",
    connected: "Verbunden",
    attention: "Aufmerksamkeit nötig",
    disconnected: "Nicht verbunden",
    planned: "Geplant",
    modelStudio: "Model Studio",
    openModelStudio: "Model Studio öffnen",
    modelBody:
      "Modelle werden pro Workzone über das AI Gateway mit Budgets, Schemas und menschlicher Kontrolle zugewiesen.",
    externalOff: "Ausführung über externe Provider ist deaktiviert",
    researchModels: "Recherche und Fakten",
    researchModelsBody:
      "Behauptungsextraktion, Belegvergleich und Validierung.",
    imageModels: "Redaktionelle Bilder",
    imageModelsBody: "Reservierter Slot; kein Bildmodell ist aktiviert.",
    adaptationModels: "Kanalanpassung",
    adaptationModelsBody: "Reservierter Slot für Sprache, Format und Ton.",
    configured: "Konfiguriert",
    paused: "Pausiert",
    notConfigured: "Nicht konfiguriert",
    routes: "Modellrouten",
  },
} as const;

const channelLabels: Record<WorkzoneChannelName, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
};

const operationLabels: Record<WorkzoneModelOperation, string> = {
  claim_extraction: "Claim extraction",
  evidence_comparison: "Evidence comparison",
  factual_synthesis: "Factual synthesis",
  grounding_validation: "Grounding validation",
  editorial_transformation: "Editorial transformation",
  editorial_grounding_validation: "Editorial grounding validation",
};

export function MediaWorkzone({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<WorkzoneSnapshot | null>(null);
  const [state, setState] = useState<
    "loading" | "signed-out" | "workspace-required" | "unavailable"
  >("loading");

  useEffect(() => {
    void fetch("/api/workzone/overview", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          return setState(classifyWorkspaceResponse(response.status));
        setSnapshot((await response.json()) as WorkzoneSnapshot);
      })
      .catch(() => setState("unavailable"));
  }, []);

  const home = `/${locale}`;
  if (!snapshot)
    return (
      <main className="workzone-page" lang={locale}>
        <header className="workzone-header">
          <div>
            <p className="eyebrow">{text.eyebrow}</p>
            <h1>{text.title}</h1>
            <p>{text.body}</p>
          </div>
        </header>
        <section className="workzone-state" role="status">
          {state === "workspace-required" ? (
            <WorkspaceOnboarding locale={locale} />
          ) : (
            <p>
              {state === "loading"
                ? text.loading
                : state === "signed-out"
                  ? text.signedOut
                  : text.unavailable}
            </p>
          )}
          {state === "signed-out" ? (
            <a href={localizedLoginHref(locale, "/workzone")}>
              {text.signIn} →
            </a>
          ) : null}
        </section>
      </main>
    );

  const stages = [
    {
      key: "research",
      label: text.research,
      body: text.researchBody,
      count: snapshot.pipeline.research,
      href: `${home}/research`,
    },
    {
      key: "drafting",
      label: text.drafting,
      body: text.draftingBody,
      count: snapshot.pipeline.drafting,
      href: `${home}/content`,
    },
    {
      key: "review",
      label: text.review,
      body: text.reviewBody,
      count: snapshot.pipeline.review,
      href: `${home}/social/review`,
    },
    {
      key: "scheduled",
      label: text.scheduled,
      body: text.scheduledBody,
      count: snapshot.pipeline.scheduled,
      href: `${home}/social/calendar`,
    },
    {
      key: "exceptions",
      label: text.exceptions,
      body: text.exceptionsBody,
      count: snapshot.pipeline.deliveryExceptions,
      href: `${home}/social/publications`,
    },
  ] as const;
  const routeCount = snapshot.models.routes.filter(
    (route) => route.enabled,
  ).length;

  return (
    <main className="workzone-page" lang={locale}>
      <header className="workzone-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{snapshot.workspace.displayName}</h1>
          <p>{text.body}</p>
        </div>
        <span>{text.safety}</span>
      </header>

      <section className="workzone-workflow" aria-labelledby="workflow-title">
        <header>
          <div>
            <h2 id="workflow-title">{text.workflow}</h2>
            <p>{text.workflowBody}</p>
          </div>
          <Link className="workzone-board-link" href={`${home}/workzone/board`}>
            {text.openBoard} →
          </Link>
        </header>
        <ol>
          {stages.map((stage, index) => (
            <li
              key={stage.key}
              data-alert={stage.key === "exceptions" && stage.count > 0}
            >
              <div className="workzone-stage-number">{index + 1}</div>
              <strong>{stage.label}</strong>
              <b>{stage.count}</b>
              <p>{stage.body}</p>
              <Link href={stage.href}>{text.open} →</Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="workzone-actions" aria-label={text.quickActions}>
        <h2>{text.quickActions}</h2>
        <div>
          <Link href={`${home}/research`}>
            <span>01</span>
            {text.discover}
          </Link>
          <Link href={`${home}/content`}>
            <span>02</span>
            {text.create}
          </Link>
          <Link href={`${home}/social/composer`}>
            <span>03</span>
            {text.compose}
          </Link>
          <Link href={`${home}/people`}>
            <span>04</span>
            {text.manageTeam}
          </Link>
        </div>
      </section>

      <div className="workzone-grid">
        <section className="workzone-panel workzone-team">
          <header>
            <h2>{text.team}</h2>
            <Link href={`${home}/people`}>{text.open} →</Link>
          </header>
          <p>{text.teamBody}</p>
          <div>
            <strong>{snapshot.resources.teamMembers}</strong>
            <span>{text.members}</span>
            <strong>{snapshot.resources.readyMedia}</strong>
            <span>{text.readyMedia}</span>
          </div>
        </section>

        <section className="workzone-panel workzone-destinations">
          <header>
            <h2>{text.destinations}</h2>
          </header>
          <p>{text.destinationsBody}</p>
          <ul>
            {snapshot.channels.map((channel) => (
              <li key={channel.name}>
                <strong>{channelLabels[channel.name]}</strong>
                <span data-status={channel.status}>
                  {channel.status === "connected"
                    ? text.connected
                    : channel.status === "needs_attention"
                      ? text.attention
                      : channel.status === "planned"
                        ? text.planned
                        : text.disconnected}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="workzone-panel workzone-models">
        <header>
          <div>
            <h2>{text.modelStudio}</h2>
            <p>{text.modelBody}</p>
          </div>
          <div className="workzone-model-actions">
            <span>{text.externalOff}</span>
            <Link href={`${home}/workzone/models`}>
              {text.openModelStudio} →
            </Link>
          </div>
        </header>
        <div className="workzone-model-grid">
          <article>
            <small>01 · AI Gateway</small>
            <h3>{text.researchModels}</h3>
            <p>{text.researchModelsBody}</p>
            <strong data-configured={routeCount > 0}>
              {routeCount > 0
                ? `${routeCount} ${text.routes}`
                : text.notConfigured}
            </strong>
            {snapshot.models.routes.length > 0 ? (
              <ul>
                {snapshot.models.routes.map((route) => (
                  <li key={route.operation}>
                    <span>{operationLabels[route.operation]}</span>
                    <small>
                      {route.enabled ? text.configured : text.paused}
                    </small>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
          <article>
            <small>02 · Image</small>
            <h3>{text.imageModels}</h3>
            <p>{text.imageModelsBody}</p>
            <strong>{text.notConfigured}</strong>
          </article>
          <article>
            <small>03 · Distribution</small>
            <h3>{text.adaptationModels}</h3>
            <p>{text.adaptationModelsBody}</p>
            <strong>{text.notConfigured}</strong>
          </article>
        </div>
      </section>
    </main>
  );
}
