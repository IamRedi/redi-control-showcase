import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { ContentItemsClient } from "./content-items-client";

const copy = {
  en: {
    eyebrow: "Unified Content",
    title: "Stories and destination variants",
    body: "Create one content item, reuse approved media and inspect independent website, Facebook and Instagram delivery state.",
    workspace: "Workzone",
    itemTitle: "Story or campaign title",
    summary: "Shared editorial summary",
    create: "Create content item",
    loading: "Loading content items…",
    empty: "No content item has been created yet.",
    unavailable:
      "Content data is unavailable. Sign in or check the API connection.",
    signedOut: "Sign in to manage this media's content.",
    signIn: "Sign in securely",
    variants: "Destination variants",
    channelPlan: "Channel preparation plan",
    channelWebsite: "Website",
    channelFacebook: "Facebook",
    channelInstagram: "Instagram",
    channelNotPrepared: "Not prepared yet",
    channelRevision: "revision",
    channelWebsiteHint: "Local editorial workflow",
    channelSocialHint:
      "The provider connection stays deferred until the Meta adapter is accepted.",
    channelSocialDeferred: "Connection deferred",
    focusedItem: "Opened from Research",
    focusedFromReview: "Opened from the review queue",
    workflowTitle: "Simple editorial flow",
    workflow: [
      "Bring an approved story from Newsroom, or create one here.",
      "Prepare the exact Website revision and inspect its read-only readiness.",
      "Request independent review; social connections remain deferred.",
    ],
    media: "Media assets",
    version: "Version",
    delivery: "Delivery",
    websitePreflight: "Website readiness",
    inspectWebsite: "Check Website",
    checkingWebsite: "Checking…",
    preflightReady: "Ready to prepare",
    preflightBlocked: "Action required",
    preflightReadOnly:
      "Read-only check. It creates no variant, calls no connector and authorizes no publication.",
    preflightUnavailable: "Website readiness could not be checked.",
    connections: "Available Website connections",
    eligible: "Eligible",
    unavailableConnection: "Unavailable",
    noConnections: "No Website connection is available in this workzone.",
    websiteDraft: "Local Website draft",
    openDraft: "Open composer",
    closeDraft: "Close composer",
    newDraft: "New local draft",
    draftRevision: "Revision",
    draftSlug: "Article slug",
    draftTitle: "Website title",
    draftExcerpt: "Website excerpt",
    draftBody: "Article body",
    draftMedia: "Attached media snapshot",
    draftGuideTitle: "Editorial check before saving",
    draftGuide:
      "Use a clear title, a short reader-facing excerpt and paragraphs that preserve the verified story. This guidance does not replace independent review.",
    draftCharacters: "characters",
    draftWords: "words",
    saveDraft: "Save exact revision",
    savingDraft: "Saving…",
    draftSafety:
      "Saved only in REDI CONTROL. Every edit creates an immutable revision; no Website variant, connector call or publication is created.",
    draftUnavailable: "The local Website draft could not be loaded or saved.",
    reviewQueue: "Website Review & Approval Queue",
    reviewQueueEmpty: "No Website revision is waiting for review.",
    reviewQueueUnavailable: "The Website review queue could not be loaded.",
    openForReview: "Open exact revision",
    requested: "requested",
    preview: "Website preview",
    previewPath: "website.example/articles",
    previewMedia: "Exact media snapshot",
    previewExact: "Local exact-revision preview",
    reviewStatus: "Editorial review",
    requestReview: "Request review",
    requestingReview: "Requesting…",
    pendingReview: "Waiting for independent review",
    approvedReview: "Exact revision approved",
    rejectedReview: "Revision rejected",
    approveReview: "Approve exact revision",
    rejectReview: "Reject revision",
    rejectionReason: "Rejection reason (at least 10 characters)",
    reviewSelf: "The requester cannot approve their own revision.",
    reviewMfa: "Recent MFA is required to decide this review.",
    reviewSafety:
      "Review is bound to this exact revision and content hash. Approval does not create a Website variant, call a connector or authorize publication.",
    checkLabels: {
      CONTENT_ITEM_EDITABLE: "The content item can be prepared.",
      CONTENT_ITEM_ARCHIVED: "Archived content cannot be prepared.",
      WEBSITE_DESTINATION_ENTITLED: "The Website destination is included.",
      WEBSITE_DESTINATION_NOT_ENTITLED:
        "The Website destination is not included in this package.",
      WEBSITE_VARIANT_ABSENT: "No Website variant exists yet.",
      WEBSITE_VARIANT_ALREADY_EXISTS: "A Website variant already exists.",
      WEBSITE_DRAFT_ABSENT: "No local Website draft exists yet.",
      WEBSITE_DRAFT_AVAILABLE: "A local Website draft is available.",
      WEBSITE_CONNECTION_ELIGIBLE: "An eligible Website connection is ready.",
      WEBSITE_CONNECTION_REQUIRED:
        "An eligible Website connection is required.",
      WEBSITE_CONNECTION_HEALTH_UNCONFIRMED:
        "The connection is eligible, but its latest health is not confirmed.",
      WEBSITE_COPY_AVAILABLE: "Editorial copy is available.",
      WEBSITE_SUMMARY_RECOMMENDED:
        "Add an editorial summary before preparation.",
      WEBSITE_VIDEO_DELIVERY_UNAVAILABLE:
        "Website video delivery is not supported by the current connector contract.",
      WEBSITE_MEDIA_MAPPING_REQUIRES_CONFIRMATION:
        "Confirm image mapping before Website preparation.",
      WEBSITE_TEXT_ONLY_CONTENT: "This item can be prepared as text only.",
    },
  },
  de: {
    eyebrow: "Einheitliche Inhalte",
    title: "Themen und Zielvarianten",
    body: "Einen Inhalt erstellen, freigegebene Medien wiederverwenden und den unabhängigen Status für Website, Facebook und Instagram prüfen.",
    workspace: "Workzone",
    itemTitle: "Titel des Themas oder der Kampagne",
    summary: "Gemeinsame redaktionelle Zusammenfassung",
    create: "Inhalt erstellen",
    loading: "Inhalte werden geladen…",
    empty: "Noch kein Inhalt vorhanden.",
    unavailable:
      "Inhaltsdaten sind nicht verfügbar. Anmeldung und API-Verbindung prüfen.",
    signedOut: "Anmelden, um die Inhalte dieses Mediums zu verwalten.",
    signIn: "Sicher anmelden",
    variants: "Zielvarianten",
    channelPlan: "Plan für die Kanalvorbereitung",
    channelWebsite: "Website",
    channelFacebook: "Facebook",
    channelInstagram: "Instagram",
    channelNotPrepared: "Noch nicht vorbereitet",
    channelRevision: "Revision",
    channelWebsiteHint: "Lokaler redaktioneller Ablauf",
    channelSocialHint:
      "Die Provider-Verbindung bleibt zurückgestellt, bis der Meta-Adapter abgenommen ist.",
    channelSocialDeferred: "Verbindung zurückgestellt",
    focusedItem: "Aus Research geöffnet",
    focusedFromReview: "Aus der Prüfwarteschlange geöffnet",
    workflowTitle: "Einfacher redaktioneller Ablauf",
    workflow: [
      "Eine freigegebene Geschichte aus dem Newsroom übernehmen oder hier anlegen.",
      "Die exakte Website-Revision vorbereiten und die Nur-Lese-Bereitschaft prüfen.",
      "Unabhängige Prüfung anfordern; soziale Verbindungen bleiben zurückgestellt.",
    ],
    media: "Medien",
    version: "Version",
    delivery: "Auslieferung",
    websitePreflight: "Website-Bereitschaft",
    inspectWebsite: "Website prüfen",
    checkingWebsite: "Prüfung…",
    preflightReady: "Bereit zur Vorbereitung",
    preflightBlocked: "Handlung erforderlich",
    preflightReadOnly:
      "Nur-Lese-Prüfung. Sie erstellt keine Variante, ruft keinen Connector auf und autorisiert keine Veröffentlichung.",
    preflightUnavailable:
      "Die Website-Bereitschaft konnte nicht geprüft werden.",
    connections: "Verfügbare Website-Verbindungen",
    eligible: "Geeignet",
    unavailableConnection: "Nicht verfügbar",
    noConnections: "In dieser Workzone ist keine Website-Verbindung verfügbar.",
    websiteDraft: "Lokaler Website-Entwurf",
    openDraft: "Editor öffnen",
    closeDraft: "Editor schließen",
    newDraft: "Neuer lokaler Entwurf",
    draftRevision: "Revision",
    draftSlug: "Artikel-Slug",
    draftTitle: "Website-Titel",
    draftExcerpt: "Website-Auszug",
    draftBody: "Artikelinhalt",
    draftMedia: "Medien-Snapshot",
    draftGuideTitle: "Redaktioneller Check vor dem Speichern",
    draftGuide:
      "Einen klaren Titel, einen kurzen leserorientierten Auszug und Absätze verwenden, die die verifizierte Geschichte bewahren. Dieser Hinweis ersetzt keine unabhängige Prüfung.",
    draftCharacters: "Zeichen",
    draftWords: "Wörter",
    saveDraft: "Exakte Revision speichern",
    savingDraft: "Speichern…",
    draftSafety:
      "Wird nur in REDI CONTROL gespeichert. Jede Bearbeitung erstellt eine unveränderliche Revision; keine Website-Variante, kein Connector-Aufruf und keine Veröffentlichung.",
    draftUnavailable:
      "Der lokale Website-Entwurf konnte nicht geladen oder gespeichert werden.",
    reviewQueue: "Website-Prüf- und Freigabewarteschlange",
    reviewQueueEmpty: "Keine Website-Revision wartet auf Prüfung.",
    reviewQueueUnavailable:
      "Die Website-Prüfwarteschlange konnte nicht geladen werden.",
    openForReview: "Exakte Revision öffnen",
    requested: "angefordert",
    preview: "Website-Vorschau",
    previewPath: "website.example/artikel",
    previewMedia: "Exakter Medien-Snapshot",
    previewExact: "Lokale Vorschau der exakten Revision",
    reviewStatus: "Redaktionelle Prüfung",
    requestReview: "Prüfung anfordern",
    requestingReview: "Wird angefordert…",
    pendingReview: "Wartet auf unabhängige Prüfung",
    approvedReview: "Exakte Revision freigegeben",
    rejectedReview: "Revision abgelehnt",
    approveReview: "Exakte Revision freigeben",
    rejectReview: "Revision ablehnen",
    rejectionReason: "Ablehnungsgrund (mindestens 10 Zeichen)",
    reviewSelf: "Die anfordernde Person darf nicht selbst freigeben.",
    reviewMfa: "Für diese Entscheidung ist eine aktuelle MFA erforderlich.",
    reviewSafety:
      "Die Prüfung ist an diese exakte Revision und ihren Inhalts-Hash gebunden. Eine Freigabe erstellt keine Website-Variante, ruft keinen Connector auf und autorisiert keine Veröffentlichung.",
    checkLabels: {
      CONTENT_ITEM_EDITABLE: "Der Inhalt kann vorbereitet werden.",
      CONTENT_ITEM_ARCHIVED:
        "Archivierte Inhalte können nicht vorbereitet werden.",
      WEBSITE_DESTINATION_ENTITLED: "Das Website-Ziel ist im Paket enthalten.",
      WEBSITE_DESTINATION_NOT_ENTITLED:
        "Das Website-Ziel ist in diesem Paket nicht enthalten.",
      WEBSITE_VARIANT_ABSENT: "Es existiert noch keine Website-Variante.",
      WEBSITE_VARIANT_ALREADY_EXISTS:
        "Eine Website-Variante existiert bereits.",
      WEBSITE_DRAFT_ABSENT: "Noch kein lokaler Website-Entwurf vorhanden.",
      WEBSITE_DRAFT_AVAILABLE: "Ein lokaler Website-Entwurf ist vorhanden.",
      WEBSITE_CONNECTION_ELIGIBLE:
        "Eine geeignete Website-Verbindung ist bereit.",
      WEBSITE_CONNECTION_REQUIRED:
        "Eine geeignete Website-Verbindung ist erforderlich.",
      WEBSITE_CONNECTION_HEALTH_UNCONFIRMED:
        "Die Verbindung ist geeignet, ihr aktueller Zustand ist aber nicht bestätigt.",
      WEBSITE_COPY_AVAILABLE: "Redaktioneller Text ist vorhanden.",
      WEBSITE_SUMMARY_RECOMMENDED:
        "Vor der Vorbereitung eine redaktionelle Zusammenfassung ergänzen.",
      WEBSITE_VIDEO_DELIVERY_UNAVAILABLE:
        "Die aktuelle Connector-Schnittstelle unterstützt keine Website-Videoübertragung.",
      WEBSITE_MEDIA_MAPPING_REQUIRES_CONFIRMATION:
        "Die Bildzuordnung vor der Website-Vorbereitung bestätigen.",
      WEBSITE_TEXT_ONLY_CONTENT:
        "Dieser Inhalt kann nur als Text vorbereitet werden.",
    },
  },
  sq: {
    eyebrow: "Përmbajtje e unifikuar",
    title: "Tema dhe variante sipas destinacionit",
    body: "Krijoni një përmbajtje, ripërdorni media të miratuara dhe kontrolloni veçmas gjendjen e website-it, Facebook-ut dhe Instagram-it.",
    workspace: "Workzone",
    itemTitle: "Titulli i temës ose fushatës",
    summary: "Përmbledhja e përbashkët editoriale",
    create: "Krijo përmbajtjen",
    loading: "Po ngarkohen përmbajtjet…",
    empty: "Nuk është krijuar ende asnjë përmbajtje.",
    unavailable:
      "Të dhënat nuk janë të disponueshme. Kontrolloni hyrjen dhe lidhjen API.",
    signedOut: "Hyni për të menaxhuar përmbajtjen e kësaj mediaje.",
    signIn: "Hyni në mënyrë të sigurt",
    variants: "Variantet e destinacioneve",
    channelPlan: "Plani i përgatitjes sipas kanalit",
    channelWebsite: "Website",
    channelFacebook: "Facebook",
    channelInstagram: "Instagram",
    channelNotPrepared: "Nuk është përgatitur ende",
    channelRevision: "revizioni",
    channelWebsiteHint: "Rrjedhë editoriale lokale",
    channelSocialHint:
      "Lidhja me provider-in mbetet e shtyrë derisa adapteri Meta të pranohet.",
    channelSocialDeferred: "Lidhja e shtyrë",
    focusedItem: "Hapur nga Research",
    focusedFromReview: "Hapur nga radha e kontrollit",
    workflowTitle: "Rrjedhë e thjeshtë editoriale",
    workflow: [
      "Sillni një artikull të aprovuar nga Newsroom ose krijojeni këtu.",
      "Përgatitni revizionin ekzakt për Website dhe kontrolloni gatishmërinë vetëm për lexim.",
      "Kërkoni kontroll të pavarur; lidhjet sociale mbeten të shtyra.",
    ],
    media: "Materialet media",
    version: "Versioni",
    delivery: "Shpërndarja",
    websitePreflight: "Gatishmëria për Website",
    inspectWebsite: "Kontrollo Website-in",
    checkingWebsite: "Po kontrollohet…",
    preflightReady: "Gati për përgatitje",
    preflightBlocked: "Kërkohet veprim",
    preflightReadOnly:
      "Kontroll vetëm për lexim. Nuk krijon variant, nuk thërret connector dhe nuk autorizon publikim.",
    preflightUnavailable: "Gatishmëria për Website nuk mund të kontrollohej.",
    connections: "Lidhjet Website të disponueshme",
    eligible: "E vlefshme",
    unavailableConnection: "Jo e disponueshme",
    noConnections: "Nuk ka lidhje Website të disponueshme në këtë workzone.",
    websiteDraft: "Draft lokal për Website",
    openDraft: "Hap editorin",
    closeDraft: "Mbyll editorin",
    newDraft: "Draft i ri lokal",
    draftRevision: "Revizioni",
    draftSlug: "Slug-u i artikullit",
    draftTitle: "Titulli për Website",
    draftExcerpt: "Përmbledhja për Website",
    draftBody: "Përmbajtja e artikullit",
    draftMedia: "Snapshot-i i medias",
    draftGuideTitle: "Kontroll editorial para ruajtjes",
    draftGuide:
      "Përdorni një titull të qartë, përmbledhje të shkurtër për lexuesin dhe paragrafë që ruajnë artikullin e verifikuar. Ky udhëzim nuk zëvendëson kontrollin e pavarur.",
    draftCharacters: "karaktere",
    draftWords: "fjalë",
    saveDraft: "Ruaj revizionin e saktë",
    savingDraft: "Po ruhet…",
    draftSafety:
      "Ruhet vetëm në REDI CONTROL. Çdo ndryshim krijon revizion të pandryshueshëm; nuk krijohet variant Website, thirrje connector-i apo publikim.",
    draftUnavailable: "Drafti lokal nuk mund të ngarkohej ose ruhej.",
    reviewQueue: "Radha e kontrollit dhe aprovimit për Website",
    reviewQueueEmpty: "Asnjë revizion Website nuk pret kontroll.",
    reviewQueueUnavailable: "Radha e kontrollit nuk mund të ngarkohej.",
    openForReview: "Hap revizionin ekzakt",
    requested: "kërkuar",
    preview: "Preview i Website-it",
    previewPath: "website.example/artikuj",
    previewMedia: "Snapshot-i ekzakt i medias",
    previewExact: "Preview lokal i revizionit ekzakt",
    reviewStatus: "Kontrolli editorial",
    requestReview: "Kërko kontroll",
    requestingReview: "Po kërkohet…",
    pendingReview: "Në pritje të kontrollit të pavarur",
    approvedReview: "Revizioni ekzakt u aprovua",
    rejectedReview: "Revizioni u refuzua",
    approveReview: "Aprovo revizionin ekzakt",
    rejectReview: "Refuzo revizionin",
    rejectionReason: "Arsyeja e refuzimit (të paktën 10 karaktere)",
    reviewSelf: "Kërkuesi nuk mund të aprovojë revizionin e vet.",
    reviewMfa: "Kërkohet MFA e fundit për të vendosur mbi këtë kontroll.",
    reviewSafety:
      "Kontrolli lidhet me këtë revizion dhe hash ekzakt. Aprovimi nuk krijon variant Website, nuk thërret connector dhe nuk autorizon publikim.",
    checkLabels: {
      CONTENT_ITEM_EDITABLE: "Përmbajtja mund të përgatitet.",
      CONTENT_ITEM_ARCHIVED: "Përmbajtja e arkivuar nuk mund të përgatitet.",
      WEBSITE_DESTINATION_ENTITLED:
        "Destinacioni Website përfshihet në paketë.",
      WEBSITE_DESTINATION_NOT_ENTITLED:
        "Destinacioni Website nuk përfshihet në këtë paketë.",
      WEBSITE_VARIANT_ABSENT: "Nuk ekziston ende variant Website.",
      WEBSITE_VARIANT_ALREADY_EXISTS: "Një variant Website ekziston tashmë.",
      WEBSITE_DRAFT_ABSENT: "Nuk ekziston ende draft lokal për Website.",
      WEBSITE_DRAFT_AVAILABLE: "Drafti lokal për Website është gati.",
      WEBSITE_CONNECTION_ELIGIBLE: "Një lidhje Website e vlefshme është gati.",
      WEBSITE_CONNECTION_REQUIRED: "Kërkohet një lidhje Website e vlefshme.",
      WEBSITE_CONNECTION_HEALTH_UNCONFIRMED:
        "Lidhja është e vlefshme, por gjendja e fundit nuk është konfirmuar.",
      WEBSITE_COPY_AVAILABLE: "Teksti editorial është i disponueshëm.",
      WEBSITE_SUMMARY_RECOMMENDED:
        "Shtoni përmbledhjen editoriale para përgatitjes.",
      WEBSITE_VIDEO_DELIVERY_UNAVAILABLE:
        "Kontrata aktuale e connector-it nuk mbështet dërgimin e videos në Website.",
      WEBSITE_MEDIA_MAPPING_REQUIRES_CONFIRMATION:
        "Konfirmoni lidhjen e imazhit para përgatitjes për Website.",
      WEBSITE_TEXT_ONLY_CONTENT:
        "Kjo përmbajtje mund të përgatitet vetëm si tekst.",
    },
  },
} as const;

function isLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function ContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const text = copy[locale];
  return (
    <main className="content-page" lang={locale}>
      <header className="websites-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
          <section
            className="content-flow"
            aria-labelledby="content-flow-title"
          >
            <h2 id="content-flow-title">{text.workflowTitle}</h2>
            <ol>
              {text.workflow.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        </div>
      </header>
      <ContentItemsClient copy={text} locale={locale} />
    </main>
  );
}
