"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { localizedLoginHref } from "./auth-navigation-contract";
import { VideoBriefWorkspace } from "./video-brief-workspace";
import { VideoGenerationPolicyPanel } from "./video-generation-policy-panel";
import type {
  VideoIntelligenceSnapshot,
  VideoProgramId,
  VideoWorkflowStage,
} from "./video-intelligence-contract";
import { classifyWorkspaceResponse } from "./workspace-onboarding-contract";
import { WorkspaceOnboarding } from "./workspace-onboarding";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    eyebrow: "Video Intelligence",
    title: "One studio. Two clear programs.",
    body: "Turn verified audience needs or approved newsroom stories into governed video briefs without mixing signals, rendering and publishing.",
    safety: "Planning only · Human approval required",
    packageLabel: "Current package",
    core: "Planning workspace included",
    addOn: "Video generation add-on",
    notConfigured: "Not configured",
    programs: "Programs",
    programsBody:
      "Each program owns one purpose, cadence and evidence boundary.",
    faq: "Weekly FAQ Ads",
    faqBody:
      "Find repeated product questions, create a verified answer brief and prepare next week's explanatory ad.",
    faqSource: "Aggregated audience signals",
    faqCadence: "Weekly",
    news: "Daily News Flash",
    newsBody:
      "Create an evening anchor script only from stories already approved by the newsroom.",
    newsSource: "Approved editorial content",
    newsCadence: "Every evening",
    formats: "9:16 + 16:9",
    sourceLabel: "Source",
    cadenceLabel: "Cadence",
    formatsLabel: "Formats",
    foundation: "Foundation ready",
    workflow: "One controlled pipeline",
    workflowBody:
      "The next stage never silently grants authority to the one after it.",
    integrations: "Platforms and boundaries",
    integrationsBody: "Products, providers and destinations stay separate.",
    listening: "Audience listening",
    listeningBody:
      "Meta comments/messages only after permission and privacy acceptance.",
    heygen: "HeyGen rendering",
    heygenBody:
      "A replaceable video provider; no key, model or paid execution is active.",
    distribution: "Distribution",
    distributionBody:
      "Website and social delivery reuse the existing approval and publication workflow.",
    disconnected: "Not connected",
    loading: "Loading Video Intelligence…",
    signedOut: "Sign in to open Video Intelligence.",
    unavailable: "Video Intelligence is unavailable right now.",
    signIn: "Sign in securely",
  },
  de: {
    eyebrow: "Video Intelligence",
    title: "Ein Studio. Zwei klare Programme.",
    body: "Geprüfte Publikumsbedürfnisse oder freigegebene Newsroom-Themen werden zu kontrollierten Video-Briefings, ohne Signale, Rendering und Veröffentlichung zu vermischen.",
    safety: "Nur Planung · Menschliche Freigabe erforderlich",
    packageLabel: "Aktuelles Paket",
    core: "Planungsbereich enthalten",
    addOn: "Videoerstellungs-Add-on",
    notConfigured: "Nicht konfiguriert",
    programs: "Programme",
    programsBody: "Jedes Programm hat einen Zweck, Rhythmus und Belegrahmen.",
    faq: "Wöchentliche FAQ-Anzeigen",
    faqBody:
      "Wiederkehrende Produktfragen erkennen, eine geprüfte Antwort vorbereiten und die Erkläranzeige der nächsten Woche planen.",
    faqSource: "Aggregierte Publikumssignale",
    faqCadence: "Wöchentlich",
    news: "Täglicher News Flash",
    newsBody:
      "Ein abendliches Sprecher-Skript ausschließlich aus redaktionell freigegebenen Meldungen erstellen.",
    newsSource: "Freigegebene redaktionelle Inhalte",
    newsCadence: "Jeden Abend",
    formats: "9:16 + 16:9",
    sourceLabel: "Quelle",
    cadenceLabel: "Rhythmus",
    formatsLabel: "Formate",
    foundation: "Grundlage bereit",
    workflow: "Ein kontrollierter Ablauf",
    workflowBody:
      "Kein Schritt erteilt stillschweigend die Berechtigung für den nächsten.",
    integrations: "Plattformen und Grenzen",
    integrationsBody: "Produkte, Provider und Ziele bleiben getrennt.",
    listening: "Publikumssignale",
    listeningBody:
      "Meta-Kommentare und Nachrichten erst nach Rechte- und Datenschutzfreigabe.",
    heygen: "HeyGen-Rendering",
    heygenBody:
      "Austauschbarer Video-Provider; kein Schlüssel, Modell oder bezahlter Lauf ist aktiv.",
    distribution: "Verteilung",
    distributionBody:
      "Website und Social nutzen den bestehenden Freigabe- und Veröffentlichungsablauf.",
    disconnected: "Nicht verbunden",
    loading: "Video Intelligence wird geladen…",
    signedOut: "Melden Sie sich an, um Video Intelligence zu öffnen.",
    unavailable: "Video Intelligence ist derzeit nicht verfügbar.",
    signIn: "Sicher anmelden",
  },
  sq: {
    eyebrow: "Video Intelligence",
    title: "Një studio. Dy programe të qarta.",
    body: "Kthe nevojat e verifikuara të audiencës ose lajmet e aprovuara në brief-e video të kontrolluara, pa përzier sinjalet, renderimin dhe publikimin.",
    safety: "Vetëm planifikim · Kërkohet aprovim njerëzor",
    packageLabel: "Paketa aktuale",
    core: "Hapësira e planifikimit përfshihet",
    addOn: "Shtesa për gjenerim video",
    notConfigured: "Pa konfiguruar",
    programs: "Programet",
    programsBody: "Çdo program ka vetëm një qëllim, ritëm dhe kufi prove.",
    faq: "FAQ Ads javore",
    faqBody:
      "Gjej pyetjet e përsëritura për produktin, ndërto përgjigjen e verifikuar dhe përgatit reklamën shpjeguese të javës tjetër.",
    faqSource: "Sinjale të agreguara të audiencës",
    faqCadence: "Çdo javë",
    news: "Flash lajmet e ditës",
    newsBody:
      "Krijo skenarin e spikerit të mbrëmjes vetëm nga lajmet e aprovuara nga redaksia.",
    newsSource: "Përmbajtje editoriale e aprovuar",
    newsCadence: "Çdo mbrëmje",
    formats: "9:16 + 16:9",
    sourceLabel: "Burimi",
    cadenceLabel: "Ritmi",
    formatsLabel: "Formatet",
    foundation: "Struktura gati",
    workflow: "Një rrjedhë e kontrolluar",
    workflowBody: "Asnjë hap nuk i jep në heshtje autoritet hapit pasardhës.",
    integrations: "Platformat dhe kufijtë",
    integrationsBody:
      "Produktet, providerët dhe destinacionet qëndrojnë të ndara.",
    listening: "Dëgjimi i audiencës",
    listeningBody:
      "Komentet/mesazhet Meta vetëm pas pranimit të lejeve dhe privatësisë.",
    heygen: "Renderimi HeyGen",
    heygenBody:
      "Provider video i zëvendësueshëm; asnjë key, model ose ekzekutim me pagesë nuk është aktiv.",
    distribution: "Shpërndarja",
    distributionBody:
      "Website dhe rrjetet sociale ripërdorin aprovimin dhe publikimin ekzistues.",
    disconnected: "Jo e lidhur",
    loading: "Po ngarkohet Video Intelligence…",
    signedOut: "Hyni për të hapur Video Intelligence.",
    unavailable: "Video Intelligence nuk është i disponueshëm tani.",
    signIn: "Hyni me siguri",
  },
} as const;

const programKey: Record<VideoProgramId, "faq" | "news"> = {
  product_faq_ads: "faq",
  daily_news_flash: "news",
};
const stageCopy: Record<Locale, Record<VideoWorkflowStage, string>> = {
  en: {
    signals: "Signals",
    brief: "Topic brief",
    script: "Script",
    render: "Render",
    review: "Review",
    distribution: "Distribution",
  },
  de: {
    signals: "Signale",
    brief: "Themenbrief",
    script: "Skript",
    render: "Rendering",
    review: "Freigabe",
    distribution: "Verteilung",
  },
  sq: {
    signals: "Sinjalet",
    brief: "Brief-i",
    script: "Skenari",
    render: "Renderimi",
    review: "Aprovimi",
    distribution: "Shpërndarja",
  },
};

export function VideoIntelligence({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<VideoIntelligenceSnapshot | null>(
    null,
  );
  const [state, setState] = useState<
    "loading" | "signed-out" | "workspace-required" | "unavailable"
  >("loading");

  const load = useCallback(async () => {
    await fetch("/api/video-intelligence/overview", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          setState(classifyWorkspaceResponse(response.status));
          return;
        }
        setSnapshot((await response.json()) as VideoIntelligenceSnapshot);
        setState("loading");
      })
      .catch(() => setState("unavailable"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!snapshot) {
    return (
      <main className="video-intelligence-shell video-intelligence-state">
        {state === "workspace-required" ? (
          <WorkspaceOnboarding locale={locale} />
        ) : (
          <>
            <p>
              {state === "loading"
                ? text.loading
                : state === "signed-out"
                  ? text.signedOut
                  : text.unavailable}
            </p>
            {state === "signed-out" ? (
              <Link href={localizedLoginHref(locale, "/videos")}>
                {text.signIn} →
              </Link>
            ) : null}
          </>
        )}
      </main>
    );
  }

  return (
    <main className="video-intelligence-shell">
      <header className="video-intelligence-header">
        <div>
          <p className="video-intelligence-eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
        <span className="video-safety-badge">{text.safety}</span>
      </header>

      <section className="video-package-bar" aria-label={text.packageLabel}>
        <div>
          <small>{text.packageLabel}</small>
          <strong>{snapshot.package.displayName}</strong>
        </div>
        <div>
          <small>Core</small>
          <strong>{text.core}</strong>
        </div>
        <div>
          <small>{text.addOn}</small>
          <strong>{text.notConfigured}</strong>
        </div>
      </section>

      <VideoGenerationPolicyPanel
        locale={locale}
        workspaceId={snapshot.workspace.id}
      />

      <section className="video-section">
        <div className="video-section-heading">
          <div>
            <h2>{text.programs}</h2>
            <p>{text.programsBody}</p>
          </div>
        </div>
        <div className="video-program-grid">
          {snapshot.programs.map((program) => {
            const key = programKey[program.id];
            const source = key === "faq" ? text.faqSource : text.newsSource;
            const cadence = key === "faq" ? text.faqCadence : text.newsCadence;
            return (
              <article
                className={`video-program-card video-program-${key}`}
                key={program.id}
              >
                <div className="video-program-mark" aria-hidden="true">
                  {key === "faq" ? "FAQ" : "24"}
                </div>
                <div>
                  <span className="video-foundation-status">
                    {text.foundation}
                  </span>
                  <h3>{text[key]}</h3>
                  <p>{key === "faq" ? text.faqBody : text.newsBody}</p>
                </div>
                <dl>
                  <div>
                    <dt>{text.sourceLabel}</dt>
                    <dd>{source}</dd>
                  </div>
                  <div>
                    <dt>{text.cadenceLabel}</dt>
                    <dd>{cadence}</dd>
                  </div>
                  <div>
                    <dt>{text.formatsLabel}</dt>
                    <dd>{text.formats}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <VideoBriefWorkspace
        briefs={snapshot.briefs}
        distributionTargets={snapshot.distributionTargets}
        locale={locale}
        onChanged={load}
        workspaceId={snapshot.workspace.id}
      />

      <section className="video-section">
        <div className="video-section-heading">
          <div>
            <h2>{text.workflow}</h2>
            <p>{text.workflowBody}</p>
          </div>
        </div>
        <ol className="video-workflow">
          {snapshot.workflow.map((item, index) => (
            <li
              className={item.status === "blocked" ? "blocked" : undefined}
              key={item.stage}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{stageCopy[locale][item.stage]}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="video-section">
        <div className="video-section-heading">
          <div>
            <h2>{text.integrations}</h2>
            <p>{text.integrationsBody}</p>
          </div>
        </div>
        <div className="video-integration-grid">
          {snapshot.integrations.map((integration) => {
            const content =
              integration.id === "audience_listening"
                ? [text.listening, text.listeningBody]
                : integration.id === "heygen"
                  ? [text.heygen, text.heygenBody]
                  : [text.distribution, text.distributionBody];
            return (
              <article key={integration.id}>
                <span>{text.disconnected}</span>
                <h3>{content[0]}</h3>
                <p>{content[1]}</p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
