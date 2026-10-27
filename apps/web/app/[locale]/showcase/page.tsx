import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { PilotShowcaseClient } from "./pilot-showcase-client";

export type PilotShowcaseCopy = (typeof copy)[EnabledLocale];

const copy = {
  en: {
    eyebrow: "Media Pilot Showcase",
    title: "One governed workspace from verified source to every channel.",
    body: "Demonstrate the real editorial workflow, current Workzone state and channel readiness without presenting sample metrics or a false provider connection.",
    verified: "Verified Workzone data",
    loading: "Loading the current Workzone…",
    signedOut: "Sign in to present verified Workzone data.",
    unavailable: "The verified Workzone overview is unavailable.",
    signIn: "Sign in securely",
    openDashboard: "Open dashboard",
    openNewsroom: "Open Newsroom",
    openContent: "Open Content Studio",
    openSocial: "Open Social Control",
    liveSnapshot: "Current operational snapshot",
    readyMedia: "Ready media",
    drafts: "Post drafts",
    approvals: "Awaiting approval",
    scheduled: "Scheduled",
    workflow: "One clear editorial workflow",
    workflowBody:
      "Every step keeps tenant, actor, source, revision and approval provenance.",
    steps: [
      [
        "01",
        "Research",
        "Collect sources, evidence and freshness before writing.",
      ],
      ["02", "Create", "Build one governed story and approved media set."],
      [
        "03",
        "Adapt",
        "Prepare independent Website, Facebook and Instagram copy.",
      ],
      [
        "04",
        "Review",
        "Compare exact revisions and require an independent human decision.",
      ],
      [
        "05",
        "Distribute",
        "Schedule only approved content to accepted connections.",
      ],
    ],
    channels: "Channel readiness",
    channelsBody:
      "Editorial readiness and provider connectivity are shown separately.",
    noChannel: "No verified channel state is available.",
    status: {
      connected: "Connected",
      needs_attention: "Needs attention",
      not_connected: "Not connected",
      planned: "Planned",
    },
    channelCopy: {
      website:
        "Local draft, preview, immutable revisions and approval are ready. Live transfer waits for the accepted Website connector.",
      facebook:
        "Composer, revision review, calendar and preflight are ready. Live Meta OAuth and publishing remain gated.",
      instagram:
        "Professional workflow is ready. A Professional account, Meta App, OAuth and public media delivery are required for the first live pilot.",
    },
    saas: "Built as a media SaaS",
    saasBody:
      "The same platform can serve independent media organizations without mixing their data or teams.",
    saasCards: [
      [
        "Independent Workzone",
        "Each media receives isolated content, sources, assets, connections and audit history.",
      ],
      [
        "Controlled team",
        "The owner assigns journalists, editors and approvers with separate permissions.",
      ],
      [
        "Package and API",
        "Modules and limits follow the subscription; approved API access can power a simpler customer dashboard.",
      ],
    ],
    safety:
      "Human approval remains mandatory. This presentation never triggers autonomous publication.",
  },
  de: {
    eyebrow: "Media Pilot Showcase",
    title:
      "Ein kontrollierter Arbeitsbereich von der geprüften Quelle bis zu jedem Kanal.",
    body: "Zeigt den echten redaktionellen Ablauf, den aktuellen Workzone-Stand und die Kanalbereitschaft ohne Beispielmetriken oder vorgetäuschte Provider-Verbindung.",
    verified: "Verifizierte Workzone-Daten",
    loading: "Aktuelle Workzone wird geladen…",
    signedOut: "Anmelden, um verifizierte Workzone-Daten zu präsentieren.",
    unavailable: "Die verifizierte Workzone-Übersicht ist nicht verfügbar.",
    signIn: "Sicher anmelden",
    openDashboard: "Dashboard öffnen",
    openNewsroom: "Newsroom öffnen",
    openContent: "Content Studio öffnen",
    openSocial: "Social Control öffnen",
    liveSnapshot: "Aktueller Betriebsstand",
    readyMedia: "Fertige Medien",
    drafts: "Beitragsentwürfe",
    approvals: "Zur Freigabe",
    scheduled: "Geplant",
    workflow: "Ein klarer redaktioneller Ablauf",
    workflowBody:
      "Jeder Schritt bewahrt Mandant, Akteur, Quelle, Revision und Freigabenachweis.",
    steps: [
      [
        "01",
        "Recherche",
        "Quellen, Belege und Aktualität vor dem Schreiben prüfen.",
      ],
      [
        "02",
        "Erstellen",
        "Eine kontrollierte Story und freigegebene Medien aufbauen.",
      ],
      [
        "03",
        "Anpassen",
        "Unabhängige Fassungen für Website, Facebook und Instagram vorbereiten.",
      ],
      [
        "04",
        "Prüfen",
        "Exakte Revisionen vergleichen und unabhängig freigeben lassen.",
      ],
      [
        "05",
        "Verteilen",
        "Nur freigegebene Inhalte für akzeptierte Verbindungen planen.",
      ],
    ],
    channels: "Kanalbereitschaft",
    channelsBody:
      "Redaktionelle Bereitschaft und Provider-Verbindung werden getrennt gezeigt.",
    noChannel: "Kein verifizierter Kanalstatus verfügbar.",
    status: {
      connected: "Verbunden",
      needs_attention: "Aufmerksamkeit erforderlich",
      not_connected: "Nicht verbunden",
      planned: "Geplant",
    },
    channelCopy: {
      website:
        "Lokaler Entwurf, Vorschau, unveränderliche Revisionen und Freigabe sind bereit. Der Live-Transfer wartet auf den akzeptierten Website-Connector.",
      facebook:
        "Composer, Revisionsprüfung, Kalender und Vorabprüfung sind bereit. Live Meta OAuth und Publishing bleiben gesperrt.",
      instagram:
        "Der professionelle Ablauf ist bereit. Für den ersten Live-Piloten werden Professional-Konto, Meta App, OAuth und öffentliche Medienbereitstellung benötigt.",
    },
    saas: "Als Media-SaaS gebaut",
    saasBody:
      "Dieselbe Plattform bedient unabhängige Medien, ohne deren Daten oder Teams zu vermischen.",
    saasCards: [
      [
        "Unabhängige Workzone",
        "Jedes Medium erhält isolierte Inhalte, Quellen, Assets, Verbindungen und Audit-Historie.",
      ],
      [
        "Kontrolliertes Team",
        "Der Eigentümer weist Journalisten, Redakteure und Freigeber mit getrennten Rechten zu.",
      ],
      [
        "Paket und API",
        "Module und Grenzen folgen dem Abo; genehmigter API-Zugriff kann ein einfacheres Kundendashboard versorgen.",
      ],
    ],
    safety:
      "Menschliche Freigabe bleibt Pflicht. Diese Präsentation löst keine autonome Veröffentlichung aus.",
  },
  sq: {
    eyebrow: "Prezantimi i pilotit Media",
    title: "Një Workzone e kontrolluar, nga burimi i verifikuar te çdo kanal.",
    body: "Tregon rrjedhën reale editoriale, gjendjen aktuale të Workzone-it dhe gatishmërinë e kanaleve pa metrika shembull apo lidhje provider-i të shtirur.",
    verified: "Të dhëna të verifikuara të Workzone-it",
    loading: "Po ngarkohet Workzone aktual…",
    signedOut: "Hyni për të prezantuar të dhënat e verifikuara të Workzone-it.",
    unavailable:
      "Përmbledhja e verifikuar e Workzone-it nuk është e disponueshme.",
    signIn: "Hyni me siguri",
    openDashboard: "Hap dashboard-in",
    openNewsroom: "Hap Newsroom",
    openContent: "Hap Content Studio",
    openSocial: "Hap Kontrollin Social",
    liveSnapshot: "Gjendja operative aktuale",
    readyMedia: "Media të gatshme",
    drafts: "Drafte postimesh",
    approvals: "Në pritje aprovimi",
    scheduled: "Të planifikuara",
    workflow: "Një rrjedhë editoriale e qartë",
    workflowBody:
      "Çdo hap ruan provën e medias, përdoruesit, burimit, revizionit dhe aprovimit.",
    steps: [
      ["01", "Kërko", "Mblidh burimet, provat dhe freskinë para shkrimit."],
      ["02", "Krijo", "Ndërto një lajm të kontrolluar dhe median e aprovuar."],
      ["03", "Përshtat", "Përgatit veçmas Website, Facebook dhe Instagram."],
      [
        "04",
        "Kontrollo",
        "Krahaso revizionet ekzakte dhe kërko aprovim të pavarur.",
      ],
      [
        "05",
        "Shpërndaj",
        "Planifiko vetëm përmbajtjen e aprovuar në lidhjet e pranuara.",
      ],
    ],
    channels: "Gatishmëria e kanaleve",
    channelsBody:
      "Gatishmëria editoriale dhe lidhja me provider-in tregohen veçmas.",
    noChannel: "Nuk ka gjendje kanali të verifikuar.",
    status: {
      connected: "E lidhur",
      needs_attention: "Kërkon vëmendje",
      not_connected: "Jo e lidhur",
      planned: "E planifikuar",
    },
    channelCopy: {
      website:
        "Drafti lokal, preview, revizionet e pandryshueshme dhe aprovimi janë gati. Transferimi real pret connector-in Website të pranuar.",
      facebook:
        "Composer, kontrolli i revizioneve, kalendari dhe preflight janë gati. Meta OAuth dhe publikimi real mbeten të bllokuara.",
      instagram:
        "Rrjedha profesionale është gati. Piloti real kërkon llogari Professional, Meta App, OAuth dhe media të arritshme publikisht.",
    },
    saas: "Ndërtuar si Media SaaS",
    saasBody:
      "E njëjta platformë u shërben mediave të pavarura pa përzier të dhënat apo ekipet e tyre.",
    saasCards: [
      [
        "Workzone e pavarur",
        "Çdo media ka përmbajtjen, burimet, asetet, lidhjet dhe historikun e auditimit të izoluar.",
      ],
      [
        "Ekip i kontrolluar",
        "Pronari cakton gazetarë, editorë dhe aprovues me leje të ndara.",
      ],
      [
        "Paketë dhe API",
        "Modulet dhe kufijtë ndjekin abonimin; aksesi API i aprovuar mund të furnizojë një dashboard më të thjeshtë për klientin.",
      ],
    ],
    safety:
      "Aprovimi njerëzor mbetet i detyrueshëm. Ky prezantim nuk nis publikim autonom.",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function PilotShowcasePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  return <PilotShowcaseClient copy={copy[locale]} locale={locale} />;
}
