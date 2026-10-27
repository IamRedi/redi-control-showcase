"use client";

import { useState, type FormEvent } from "react";

import type {
  VideoBriefView,
  VideoIntelligenceSnapshot,
  VideoProgramId,
} from "./video-intelligence-contract";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    title: "Governed brief workspace",
    body: "Evidence, scripts and decisions remain separate and traceable.",
    newBrief: "New video brief",
    program: "Program",
    topic: "Topic",
    objective: "Editorial objective",
    audience: "Audience",
    script: "Script",
    signal: "Aggregated audience question",
    signalRef: "Aggregate reference",
    signalSummary: "What the audience repeatedly asks",
    count: "Aggregated count",
    fact: "Verified product fact",
    factRef: "Approved fact reference",
    factSummary: "Exact verified answer boundary",
    story: "Approved editorial story",
    storyRef: "Editorial story reference",
    storySummary: "Approved facts allowed in the bulletin",
    create: "Create governed brief",
    queue: "Review & production queue",
    empty: "No video briefs yet.",
    evidence: "Evidence",
    revision: "Revision",
    saveRevision: "Save new revision",
    requestReview: "Request human review",
    approve: "Approve exact script",
    reject: "Reject",
    rejectionReason: "Rejection reason (minimum 10 characters)",
    secondApprover: "A different approver must decide this request.",
    renderPreparation: "Render preparation",
    renderBlocked:
      "Prepared, but blocked until the generation add-on and provider are accepted.",
    blockedStatus: "Blocked safely",
    language: "Video language",
    duration: "Maximum duration (seconds)",
    rightsReference: "Rights / consent evidence reference",
    formats: "Requested formats",
    prepareRender: "Prepare blocked render",
    noExecution: "No provider job or paid call was created.",
    renderReview: "Rendered asset review",
    exactAsset: "Exact verified output",
    previewAsset: "Open private preview",
    checksum: "Checksum",
    approveAsset: "Approve exact video",
    rejectAsset: "Reject video",
    assetPending: "Awaiting independent review",
    assetApproved: "Video approved",
    assetRejected: "Video rejected",
    publicationBlocked: "Publication remains blocked after this decision.",
    distributionPreparation: "Distribution preparation",
    distributionBody:
      "Create one ordinary Social Control draft from this exact approved video.",
    distributionTargets: "Destination accounts",
    distributionCaption: "Post caption",
    prepareDistribution: "Create Social Control draft",
    noDistributionTargets:
      "No eligible social account is connected to this Workzone yet.",
    selectDistributionTarget: "Select at least one destination account.",
    draftPrepared: "Draft prepared in Social Control",
    openDraft: "Open Social Composer",
    distributionStillBlocked:
      "The new draft still needs its own review, scheduling and publication authorization.",
    websitePreparation: "Website content preparation",
    websiteBody:
      "Create one ordinary Unified Content draft with this exact approved video attached.",
    websiteSummary: "Website summary",
    prepareWebsite: "Create Unified Content draft",
    websitePrepared: "Draft prepared for Website Control",
    openContent: "Open Unified Content",
    websiteStillBlocked:
      "No article, website variant, connector call or publication was created.",
    portrait: "Portrait 9:16",
    landscape: "Landscape 16:9",
    saved: "Workflow updated.",
    refused: "The command was refused. Check access, MFA and current revision.",
    statuses: {
      draft: "Draft",
      review_required: "In review",
      approved: "Approved",
      rejected: "Rejected",
    },
    faq: "Weekly FAQ Ads",
    news: "Daily News Flash",
  },
  de: {
    title: "Kontrollierter Briefing-Bereich",
    body: "Belege, Skripte und Entscheidungen bleiben getrennt und nachvollziehbar.",
    newBrief: "Neues Video-Briefing",
    program: "Programm",
    topic: "Thema",
    objective: "Redaktionelles Ziel",
    audience: "Zielgruppe",
    script: "Skript",
    signal: "Aggregierte Publikumsfrage",
    signalRef: "Aggregat-Referenz",
    signalSummary: "Was das Publikum wiederholt fragt",
    count: "Aggregierte Anzahl",
    fact: "Geprüfte Produktangabe",
    factRef: "Referenz der freigegebenen Angabe",
    factSummary: "Exakter Rahmen der geprüften Antwort",
    story: "Freigegebene redaktionelle Meldung",
    storyRef: "Referenz der Meldung",
    storySummary: "Freigegebene Fakten für das Bulletin",
    create: "Kontrolliertes Briefing erstellen",
    queue: "Prüf- und Produktionswarteschlange",
    empty: "Noch keine Video-Briefings.",
    evidence: "Belege",
    revision: "Revision",
    saveRevision: "Neue Revision speichern",
    requestReview: "Menschliche Prüfung anfordern",
    approve: "Exaktes Skript freigeben",
    reject: "Ablehnen",
    rejectionReason: "Ablehnungsgrund (mindestens 10 Zeichen)",
    secondApprover: "Eine andere freigabeberechtigte Person muss entscheiden.",
    renderPreparation: "Render-Vorbereitung",
    renderBlocked:
      "Vorbereitet, aber bis zur Freigabe von Add-on und Provider blockiert.",
    blockedStatus: "Sicher blockiert",
    language: "Videosprache",
    duration: "Maximale Dauer (Sekunden)",
    rightsReference: "Referenz für Rechte- / Einwilligungsnachweis",
    formats: "Gewünschte Formate",
    prepareRender: "Blockiertes Rendering vorbereiten",
    noExecution:
      "Kein Provider-Job und kein kostenpflichtiger Aufruf wurde erstellt.",
    renderReview: "Prüfung des gerenderten Assets",
    exactAsset: "Exakt geprüftes Ergebnis",
    previewAsset: "Private Vorschau öffnen",
    checksum: "Prüfsumme",
    approveAsset: "Exaktes Video freigeben",
    rejectAsset: "Video ablehnen",
    assetPending: "Wartet auf unabhängige Prüfung",
    assetApproved: "Video freigegeben",
    assetRejected: "Video abgelehnt",
    publicationBlocked: "Die Veröffentlichung bleibt danach gesperrt.",
    distributionPreparation: "Verteilung vorbereiten",
    distributionBody:
      "Aus diesem exakt freigegebenen Video einen normalen Social-Control-Entwurf erstellen.",
    distributionTargets: "Zielkonten",
    distributionCaption: "Beitragstext",
    prepareDistribution: "Social-Control-Entwurf erstellen",
    noDistributionTargets:
      "Für diesen Arbeitsbereich ist noch kein geeignetes Social-Konto verbunden.",
    selectDistributionTarget: "Mindestens ein Zielkonto auswählen.",
    draftPrepared: "Entwurf in Social Control vorbereitet",
    openDraft: "Social Composer öffnen",
    distributionStillBlocked:
      "Der Entwurf benötigt weiterhin eine eigene Prüfung, Planung und Veröffentlichungsfreigabe.",
    websitePreparation: "Website-Inhalt vorbereiten",
    websiteBody:
      "Einen normalen Unified-Content-Entwurf mit diesem exakt freigegebenen Video erstellen.",
    websiteSummary: "Website-Zusammenfassung",
    prepareWebsite: "Unified-Content-Entwurf erstellen",
    websitePrepared: "Entwurf für Website Control vorbereitet",
    openContent: "Unified Content öffnen",
    websiteStillBlocked:
      "Es wurden kein Artikel, keine Website-Variante, kein Connector-Aufruf und keine Veröffentlichung erstellt.",
    portrait: "Hochformat 9:16",
    landscape: "Querformat 16:9",
    saved: "Workflow aktualisiert.",
    refused: "Befehl abgelehnt. Zugriff, MFA und aktuelle Revision prüfen.",
    statuses: {
      draft: "Entwurf",
      review_required: "In Prüfung",
      approved: "Freigegeben",
      rejected: "Abgelehnt",
    },
    faq: "Wöchentliche FAQ-Anzeigen",
    news: "Täglicher News Flash",
  },
  sq: {
    title: "Hapësira e brief-eve të kontrolluara",
    body: "Evidenca, skenari dhe vendimi qëndrojnë të ndara dhe të gjurmueshme.",
    newBrief: "Brief i ri video",
    program: "Programi",
    topic: "Tema",
    objective: "Objektivi editorial",
    audience: "Audienca",
    script: "Skenari",
    signal: "Pyetja e agreguar e audiencës",
    signalRef: "Referenca e agregatit",
    signalSummary: "Çfarë pyet vazhdimisht audienca",
    count: "Numri i agreguar",
    fact: "Fakti i verifikuar i produktit",
    factRef: "Referenca e faktit të aprovuar",
    factSummary: "Kufiri i saktë i përgjigjes së verifikuar",
    story: "Lajmi editorial i aprovuar",
    storyRef: "Referenca e lajmit",
    storySummary: "Faktet e aprovuara për edicionin",
    create: "Krijo brief-in e kontrolluar",
    queue: "Radha e aprovimit dhe prodhimit",
    empty: "Nuk ka ende brief-e video.",
    evidence: "Evidenca",
    revision: "Revizioni",
    saveRevision: "Ruaj revizion të ri",
    requestReview: "Kërko aprovim njerëzor",
    approve: "Aprovo skenarin ekzakt",
    reject: "Refuzo",
    rejectionReason: "Arsyeja e refuzimit (minimumi 10 karaktere)",
    secondApprover: "Këtë kërkesë duhet ta vendosë një aprovues tjetër.",
    renderPreparation: "Përgatitja e renderimit",
    renderBlocked:
      "E përgatitur, por e bllokuar derisa të pranohen add-on-i dhe provideri.",
    blockedStatus: "Bllokuar në mënyrë të sigurt",
    language: "Gjuha e videos",
    duration: "Kohëzgjatja maksimale (sekonda)",
    rightsReference: "Referenca e provës së të drejtave / pëlqimit",
    formats: "Formatet e kërkuara",
    prepareRender: "Përgatit renderimin e bllokuar",
    noExecution: "Nuk u krijua asnjë job provider-i ose thirrje me pagesë.",
    renderReview: "Aprovimi i videos së renderuar",
    exactAsset: "Output-i ekzakt i verifikuar",
    previewAsset: "Hap preview-n privat",
    checksum: "Checksum",
    approveAsset: "Aprovo videon ekzakte",
    rejectAsset: "Refuzo videon",
    assetPending: "Në pritje të aprovimit të pavarur",
    assetApproved: "Video e aprovuar",
    assetRejected: "Video e refuzuar",
    publicationBlocked: "Publikimi mbetet i bllokuar pas këtij vendimi.",
    distributionPreparation: "Përgatitja e shpërndarjes",
    distributionBody:
      "Krijo një draft normal në Social Control nga kjo video ekzakte e aprovuar.",
    distributionTargets: "Llogaritë e destinacionit",
    distributionCaption: "Teksti i postimit",
    prepareDistribution: "Krijo draftin në Social Control",
    noDistributionTargets:
      "Nuk ka ende llogari sociale të përshtatshme të lidhur me këtë Workzone.",
    selectDistributionTarget: "Zgjidh të paktën një llogari destinacioni.",
    draftPrepared: "Drafti u përgatit në Social Control",
    openDraft: "Hap Social Composer",
    distributionStillBlocked:
      "Drafti i ri kërkon përsëri aprovim, planifikim dhe autorizim publikimi.",
    websitePreparation: "Përgatitja e përmbajtjes për website",
    websiteBody:
      "Krijo një draft normal në Unified Content me këtë video ekzakte të aprovuar.",
    websiteSummary: "Përmbledhja për website",
    prepareWebsite: "Krijo draftin në Unified Content",
    websitePrepared: "Drafti u përgatit për Website Control",
    openContent: "Hap Unified Content",
    websiteStillBlocked:
      "Nuk u krijua artikull, variant website, thirrje connector-i ose publikim.",
    portrait: "Vertikale 9:16",
    landscape: "Horizontale 16:9",
    saved: "Rrjedha u azhornua.",
    refused: "Komanda u refuzua. Kontrollo aksesin, MFA dhe revizionin aktual.",
    statuses: {
      draft: "Draft",
      review_required: "Në aprovim",
      approved: "Aprovuar",
      rejected: "Refuzuar",
    },
    faq: "FAQ Ads javore",
    news: "Flash lajmet e ditës",
  },
} as const;

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};
const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
};

async function command(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf(),
    },
    body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
  });
  if (!response.ok) throw new Error("VIDEO_COMMAND_REFUSED");
}

export function VideoBriefWorkspace({
  locale,
  workspaceId,
  briefs,
  distributionTargets,
  onChanged,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly briefs: readonly VideoBriefView[];
  readonly distributionTargets: VideoIntelligenceSnapshot["distributionTargets"];
  readonly onChanged: () => Promise<void>;
}) {
  const t = copy[locale];
  const [program, setProgram] = useState<VideoProgramId>("product_faq_ads");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      await onChanged();
      setMessage(t.saved);
    } catch {
      setMessage(t.refused);
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const evidence =
      program === "product_faq_ads"
        ? [
            {
              kind: "aggregate_audience_signal",
              title: text(data, "signalTitle"),
              sourceReference: text(data, "signalReference"),
              summary: text(data, "signalSummary"),
              aggregateCount: Number(data.get("aggregateCount")),
            },
            {
              kind: "verified_product_fact",
              title: text(data, "factTitle"),
              sourceReference: text(data, "factReference"),
              summary: text(data, "factSummary"),
            },
          ]
        : [
            {
              kind: "approved_editorial_story",
              title: text(data, "storyTitle"),
              sourceReference: text(data, "storyReference"),
              summary: text(data, "storySummary"),
            },
          ];
    void run(async () => {
      await command("/api/video-intelligence/briefs", {
        workspaceId,
        programId: program,
        topic: text(data, "topic"),
        objective: text(data, "objective"),
        audience: text(data, "audience"),
        script: text(data, "script"),
        evidence,
      });
      form.reset();
      setProgram("product_faq_ads");
    });
  };

  const revise = (event: FormEvent<HTMLFormElement>, brief: VideoBriefView) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() =>
      command(`/api/video-intelligence/briefs/${brief.id}/revisions`, {
        workspaceId,
        expectedRevision: brief.currentRevision,
        script: text(data, "script"),
      }),
    );
  };

  const review = (brief: VideoBriefView) =>
    void run(() =>
      command(`/api/video-intelligence/briefs/${brief.id}/review`, {
        workspaceId,
        expectedRevision: brief.currentRevision,
      }),
    );

  const decide = (
    brief: VideoBriefView,
    decision: "approved" | "rejected",
    reason?: string,
  ) =>
    void run(() =>
      command(`/api/video-intelligence/briefs/${brief.id}/decision`, {
        workspaceId,
        expectedRevision: brief.currentRevision,
        decision,
        ...(reason ? { reason } : {}),
      }),
    );

  const prepareRender = (
    event: FormEvent<HTMLFormElement>,
    brief: VideoBriefView,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const outputs = data
      .getAll("outputs")
      .filter((value): value is string => typeof value === "string");
    void run(() =>
      command(
        `/api/video-intelligence/briefs/${brief.id}/render-preparations`,
        {
          workspaceId,
          expectedRevision: brief.currentRevision,
          targetLanguage: text(data, "targetLanguage"),
          maxDurationSeconds: Number(data.get("maxDurationSeconds")),
          rightsReference: text(data, "rightsReference"),
          outputs,
        },
      ),
    );
  };

  const previewAsset = async (assetId: string) => {
    setMessage("");
    try {
      const response = await fetch(`/api/media/${assetId}/download`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("VIDEO_PREVIEW_REFUSED");
      const payload = (await response.json()) as { downloadUrl?: unknown };
      if (typeof payload.downloadUrl !== "string")
        throw new Error("VIDEO_PREVIEW_INVALID");
      window.open(payload.downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setMessage(t.refused);
    }
  };

  const decideRenderedAsset = (
    jobId: string,
    mediaAssetId: string,
    decision: "approved" | "rejected",
    reason?: string,
  ) =>
    void run(() =>
      command(`/api/video-intelligence/render-jobs/${jobId}/review-decision`, {
        workspaceId,
        mediaAssetId,
        decision,
        ...(reason ? { reason } : {}),
      }),
    );

  const prepareDistribution = (
    event: FormEvent<HTMLFormElement>,
    brief: VideoBriefView,
    jobId: string,
    mediaAssetId: string,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const accountIds = data
      .getAll("accountIds")
      .filter((value): value is string => typeof value === "string");
    if (accountIds.length === 0) {
      setMessage(t.selectDistributionTarget);
      return;
    }
    void run(() =>
      command(
        `/api/video-intelligence/render-jobs/${jobId}/distribution-draft`,
        {
          workspaceId,
          mediaAssetId,
          accountIds,
          title: text(data, "title"),
          caption: text(data, "caption"),
          description: brief.objective,
        },
      ),
    );
  };

  const prepareWebsiteContent = (
    event: FormEvent<HTMLFormElement>,
    jobId: string,
    mediaAssetId: string,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() =>
      command(`/api/video-intelligence/render-jobs/${jobId}/website-content`, {
        workspaceId,
        mediaAssetId,
        title: text(data, "title"),
        summary: text(data, "summary"),
      }),
    );
  };

  return (
    <section className="video-section video-brief-workspace">
      <div className="video-section-heading video-brief-heading">
        <div>
          <h2>{t.title}</h2>
          <p>{t.body}</p>
        </div>
        <div className="video-queue-summary" aria-label={t.queue}>
          <span>{briefs.filter((item) => item.status === "draft").length}</span>
          <small>{t.statuses.draft}</small>
          <span>
            {briefs.filter((item) => item.status === "review_required").length}
          </span>
          <small>{t.statuses.review_required}</small>
          <span>
            {
              briefs
                .flatMap((item) => item.renderedAssets)
                .filter((item) => item.review.decision === "pending").length
            }
          </span>
          <small>{t.renderReview}</small>
        </div>
      </div>

      <details className="video-brief-create">
        <summary>{t.newBrief}</summary>
        <form onSubmit={create}>
          <label>
            {t.program}
            <select
              name="program"
              value={program}
              onChange={(event) =>
                setProgram(event.target.value as VideoProgramId)
              }
            >
              <option value="product_faq_ads">{t.faq}</option>
              <option value="daily_news_flash">{t.news}</option>
            </select>
          </label>
          <label>
            {t.topic}
            <input name="topic" minLength={3} maxLength={240} required />
          </label>
          <label>
            {t.objective}
            <textarea
              name="objective"
              minLength={10}
              maxLength={2000}
              required
            />
          </label>
          <label>
            {t.audience}
            <input name="audience" minLength={3} maxLength={500} required />
          </label>
          <fieldset>
            <legend>{t.evidence}</legend>
            {program === "product_faq_ads" ? (
              <>
                <label>
                  {t.signal}
                  <input
                    name="signalTitle"
                    minLength={3}
                    maxLength={240}
                    required
                  />
                </label>
                <label>
                  {t.signalRef}
                  <input
                    name="signalReference"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <label className="wide">
                  {t.signalSummary}
                  <textarea
                    name="signalSummary"
                    minLength={10}
                    maxLength={2000}
                    required
                  />
                </label>
                <label>
                  {t.count}
                  <input
                    name="aggregateCount"
                    type="number"
                    min={2}
                    max={1000000}
                    required
                  />
                </label>
                <label>
                  {t.fact}
                  <input
                    name="factTitle"
                    minLength={3}
                    maxLength={240}
                    required
                  />
                </label>
                <label>
                  {t.factRef}
                  <input
                    name="factReference"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <label className="wide">
                  {t.factSummary}
                  <textarea
                    name="factSummary"
                    minLength={10}
                    maxLength={2000}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {t.story}
                  <input
                    name="storyTitle"
                    minLength={3}
                    maxLength={240}
                    required
                  />
                </label>
                <label>
                  {t.storyRef}
                  <input
                    name="storyReference"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <label className="wide">
                  {t.storySummary}
                  <textarea
                    name="storySummary"
                    minLength={10}
                    maxLength={2000}
                    required
                  />
                </label>
              </>
            )}
          </fieldset>
          <label className="wide">
            {t.script}
            <textarea
              name="script"
              minLength={20}
              maxLength={20000}
              rows={8}
              required
            />
          </label>
          <button disabled={busy} type="submit">
            {t.create}
          </button>
        </form>
      </details>

      <div className="video-queue-heading">
        <h3>{t.queue}</h3>
        {message ? <p role="status">{message}</p> : null}
      </div>
      {briefs.length === 0 ? (
        <p className="video-queue-empty">{t.empty}</p>
      ) : (
        <div className="video-brief-queue">
          {briefs.map((brief) => (
            <article className="video-brief-card" key={brief.id}>
              <header>
                <div>
                  <span className={`video-brief-status ${brief.status}`}>
                    {t.statuses[brief.status]}
                  </span>
                  <h3>{brief.topic}</h3>
                  <p>
                    {brief.programId === "product_faq_ads" ? t.faq : t.news}
                  </p>
                </div>
                <code>
                  v{brief.currentRevision} · {brief.scriptHash.slice(0, 8)}
                </code>
              </header>
              <div className="video-brief-context">
                <p>
                  <strong>{t.objective}</strong>
                  {brief.objective}
                </p>
                <p>
                  <strong>{t.audience}</strong>
                  {brief.audience}
                </p>
              </div>
              <details>
                <summary>
                  {t.evidence} · {brief.evidence.length}
                </summary>
                <ol>
                  {brief.evidence.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.sourceReference}</span>
                      <p>{item.summary}</p>
                    </li>
                  ))}
                </ol>
              </details>
              <form onSubmit={(event) => revise(event, brief)}>
                <label>
                  {t.script} · {t.revision} {brief.currentRevision}
                  <textarea
                    name="script"
                    defaultValue={brief.script}
                    minLength={20}
                    maxLength={20000}
                    rows={6}
                    disabled={brief.status === "review_required" || busy}
                    required
                  />
                </label>
                {brief.status !== "review_required" ? (
                  <div className="video-brief-actions">
                    <button disabled={busy} type="submit">
                      {t.saveRevision}
                    </button>
                    {brief.status === "draft" ? (
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => review(brief)}
                      >
                        {t.requestReview}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </form>
              {brief.status === "review_required" ? (
                brief.approval?.requestedByCurrentUser ? (
                  <p className="video-second-approver">{t.secondApprover}</p>
                ) : (
                  <form
                    className="video-decision-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      decide(
                        brief,
                        "rejected",
                        text(new FormData(event.currentTarget), "reason"),
                      );
                    }}
                  >
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => decide(brief, "approved")}
                    >
                      {t.approve}
                    </button>
                    <input
                      name="reason"
                      minLength={10}
                      maxLength={500}
                      placeholder={t.rejectionReason}
                      required
                    />
                    <button className="danger" disabled={busy} type="submit">
                      {t.reject}
                    </button>
                  </form>
                )
              ) : null}
              {brief.status === "approved" ? (
                brief.renderPreparation ? (
                  <section
                    className="video-render-preparation"
                    aria-label={t.renderPreparation}
                  >
                    <div>
                      <strong>{t.renderPreparation}</strong>
                      <span>{t.blockedStatus}</span>
                    </div>
                    <p>{t.renderBlocked}</p>
                    <dl>
                      <div>
                        <dt>{t.language}</dt>
                        <dd>
                          {brief.renderPreparation.targetLanguage.toUpperCase()}
                        </dd>
                      </div>
                      <div>
                        <dt>{t.duration}</dt>
                        <dd>{brief.renderPreparation.maxDurationSeconds}s</dd>
                      </div>
                      <div>
                        <dt>{t.formats}</dt>
                        <dd>{brief.renderPreparation.outputs.join(" · ")}</dd>
                      </div>
                      <div className="wide">
                        <dt>{t.rightsReference}</dt>
                        <dd>{brief.renderPreparation.rightsReference}</dd>
                      </div>
                    </dl>
                    <small>{t.noExecution}</small>
                  </section>
                ) : (
                  <form
                    className="video-render-form"
                    onSubmit={(event) => prepareRender(event, brief)}
                  >
                    <h4>{t.renderPreparation}</h4>
                    <p>{t.renderBlocked}</p>
                    <div className="video-render-grid">
                      <label>
                        {t.language}
                        <select name="targetLanguage" defaultValue={locale}>
                          <option value="sq">Shqip</option>
                          <option value="en">English</option>
                          <option value="de">Deutsch</option>
                        </select>
                      </label>
                      <label>
                        {t.duration}
                        <input
                          name="maxDurationSeconds"
                          type="number"
                          min={brief.programId === "product_faq_ads" ? 15 : 30}
                          max={brief.programId === "product_faq_ads" ? 90 : 180}
                          defaultValue={
                            brief.programId === "product_faq_ads" ? 60 : 120
                          }
                          required
                        />
                      </label>
                      <label className="wide">
                        {t.rightsReference}
                        <input
                          name="rightsReference"
                          minLength={3}
                          maxLength={500}
                          required
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>{t.formats}</legend>
                      <label>
                        <input
                          name="outputs"
                          type="checkbox"
                          value="9:16"
                          defaultChecked
                        />
                        {t.portrait}
                      </label>
                      <label>
                        <input
                          name="outputs"
                          type="checkbox"
                          value="16:9"
                          defaultChecked
                        />
                        {t.landscape}
                      </label>
                    </fieldset>
                    <button disabled={busy} type="submit">
                      {t.prepareRender}
                    </button>
                    <small>{t.noExecution}</small>
                  </form>
                )
              ) : null}
              {brief.renderedAssets.length ? (
                <section
                  className="video-render-review"
                  aria-label={t.renderReview}
                >
                  <header>
                    <div>
                      <strong>{t.renderReview}</strong>
                      <p>{t.publicationBlocked}</p>
                    </div>
                  </header>
                  <div className="video-render-assets">
                    {brief.renderedAssets.map((asset) => (
                      <article key={asset.jobId}>
                        <div className="video-render-asset-heading">
                          <div>
                            <small>{t.exactAsset}</small>
                            <strong>{asset.filename}</strong>
                          </div>
                          <span
                            className={`video-asset-${asset.review.decision}`}
                          >
                            {asset.review.decision === "pending"
                              ? t.assetPending
                              : asset.review.decision === "approved"
                                ? t.assetApproved
                                : t.assetRejected}
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>{t.formats}</dt>
                            <dd>
                              {asset.aspectRatio} · {asset.width}×{asset.height}
                            </dd>
                          </div>
                          <div>
                            <dt>{t.duration}</dt>
                            <dd>{Math.round(asset.durationMs / 1000)}s</dd>
                          </div>
                          <div className="wide">
                            <dt>{t.checksum}</dt>
                            <dd>
                              <code>{asset.checksumSha256}</code>
                            </dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void previewAsset(asset.mediaAssetId)}
                        >
                          {t.previewAsset}
                        </button>
                        {asset.review.decision === "pending" ? (
                          asset.review.requestedByCurrentUser ? (
                            <p className="video-second-approver">
                              {t.secondApprover}
                            </p>
                          ) : (
                            <form
                              className="video-decision-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                decideRenderedAsset(
                                  asset.jobId,
                                  asset.mediaAssetId,
                                  "rejected",
                                  text(
                                    new FormData(event.currentTarget),
                                    "reason",
                                  ),
                                );
                              }}
                            >
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  decideRenderedAsset(
                                    asset.jobId,
                                    asset.mediaAssetId,
                                    "approved",
                                  )
                                }
                              >
                                {t.approveAsset}
                              </button>
                              <input
                                name="reason"
                                minLength={10}
                                maxLength={500}
                                placeholder={t.rejectionReason}
                                required
                              />
                              <button
                                className="danger"
                                disabled={busy}
                                type="submit"
                              >
                                {t.rejectAsset}
                              </button>
                            </form>
                          )
                        ) : asset.review.reason ? (
                          <p className="video-render-reason">
                            {asset.review.reason}
                          </p>
                        ) : null}
                        {asset.distributionDraft ? (
                          <div className="video-distribution-ready">
                            <strong>{t.draftPrepared}</strong>
                            <p>{t.distributionStillBlocked}</p>
                            <a href={`/${locale}/social/composer`}>
                              {t.openDraft}
                            </a>
                          </div>
                        ) : asset.review.decision === "approved" ? (
                          <form
                            className="video-distribution-form"
                            onSubmit={(event) =>
                              prepareDistribution(
                                event,
                                brief,
                                asset.jobId,
                                asset.mediaAssetId,
                              )
                            }
                          >
                            <div>
                              <strong>{t.distributionPreparation}</strong>
                              <p>{t.distributionBody}</p>
                            </div>
                            {distributionTargets.some(
                              (target) => target.draftEligible,
                            ) ? (
                              <fieldset>
                                <legend>{t.distributionTargets}</legend>
                                {distributionTargets
                                  .filter((target) => target.draftEligible)
                                  .map((target) => (
                                    <label key={target.accountId}>
                                      <input
                                        name="accountIds"
                                        type="checkbox"
                                        value={target.accountId}
                                      />
                                      <span>
                                        <strong>{target.displayName}</strong>
                                        <small>
                                          {target.channel} · {target.status}
                                        </small>
                                      </span>
                                    </label>
                                  ))}
                              </fieldset>
                            ) : (
                              <p className="video-distribution-empty">
                                {t.noDistributionTargets}
                              </p>
                            )}
                            <label>
                              {t.topic}
                              <input
                                name="title"
                                defaultValue={brief.topic}
                                minLength={1}
                                maxLength={100}
                                required
                              />
                            </label>
                            <label>
                              {t.distributionCaption}
                              <textarea
                                name="caption"
                                defaultValue={brief.objective}
                                minLength={1}
                                maxLength={5000}
                                rows={4}
                                required
                              />
                            </label>
                            <button
                              disabled={
                                busy ||
                                !distributionTargets.some(
                                  (target) => target.draftEligible,
                                )
                              }
                              type="submit"
                            >
                              {t.prepareDistribution}
                            </button>
                            <small>{t.distributionStillBlocked}</small>
                          </form>
                        ) : null}
                        {asset.websiteContent ? (
                          <div className="video-distribution-ready video-website-ready">
                            <strong>{t.websitePrepared}</strong>
                            <p>{t.websiteStillBlocked}</p>
                            <a href={`/${locale}/content`}>{t.openContent}</a>
                          </div>
                        ) : asset.review.decision === "approved" ? (
                          <form
                            className="video-distribution-form video-website-form"
                            onSubmit={(event) =>
                              prepareWebsiteContent(
                                event,
                                asset.jobId,
                                asset.mediaAssetId,
                              )
                            }
                          >
                            <div>
                              <strong>{t.websitePreparation}</strong>
                              <p>{t.websiteBody}</p>
                            </div>
                            <label>
                              {t.topic}
                              <input
                                name="title"
                                defaultValue={brief.topic}
                                minLength={1}
                                maxLength={240}
                                required
                              />
                            </label>
                            <label>
                              {t.websiteSummary}
                              <textarea
                                name="summary"
                                defaultValue={brief.objective}
                                minLength={1}
                                maxLength={2000}
                                rows={4}
                                required
                              />
                            </label>
                            <button disabled={busy} type="submit">
                              {t.prepareWebsite}
                            </button>
                            <small>{t.websiteStillBlocked}</small>
                          </form>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
