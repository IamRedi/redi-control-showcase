"use client";

import { useEffect, useState } from "react";

import {
  parseSocialPreflight,
  type SocialPreflightSnapshot,
} from "../../../social-contract";
import { WorkspaceOnboarding } from "../../../workspace-onboarding";
import { useSocialStudio } from "../use-social-studio";

type Locale = "en" | "de" | "sq";
type State =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly snapshot: SocialPreflightSnapshot };

const copy = {
  en: {
    loading: "Loading drafts…",
    signedOut: "Sign in to run preflight.",
    unavailable: "Preflight is unavailable right now.",
    select: "Choose a draft",
    empty: "No social drafts exist yet.",
    checking: "Checking provider prerequisites…",
    noSelection: "Select a draft to inspect its current revision.",
    current: "Current revision",
    blocked: "Blocked",
    warning: "Attention",
    passed: "Passed",
    note: "Provider execution remains disabled. A passed structural check is not permission to publish.",
    account_active: "Destination account is active",
    account_not_active: "Destination account is not active",
    caption_within_control_limit: "Caption is within REDI CONTROL limit",
    caption_missing_or_outside_control_limit:
      "Caption is missing or outside the control limit",
    media_count_supported: "Media count is supported",
    media_count_invalid: "Media count is invalid",
    instagram_jpeg_required: "Instagram images must be JPEG",
    instagram_image_format_supported: "Instagram image format is supported",
    instagram_mp4_required: "Instagram videos must be MP4",
    instagram_video_format_supported: "Instagram video format is supported",
    instagram_carousel_within_limit:
      "Instagram carousel is within the 10-item limit",
    instagram_public_https_delivery_not_configured:
      "Public HTTPS media delivery is not configured",
    instagram_publishing_limit_unavailable_without_live_connection:
      "Instagram publishing quota cannot be checked without a live connection",
    facebook_live_adapter_not_accepted: "Facebook live adapter is not accepted",
    media_dimensions_unavailable: "Media dimensions are unavailable",
    channel_preflight_not_implemented:
      "Channel-specific preflight is not implemented",
  },
  de: {
    loading: "Entwürfe werden geladen…",
    signedOut: "Anmelden, um die Vorabprüfung zu starten.",
    unavailable: "Vorabprüfung ist derzeit nicht verfügbar.",
    select: "Entwurf wählen",
    empty: "Noch keine Social-Entwürfe vorhanden.",
    checking: "Provider-Voraussetzungen werden geprüft…",
    noSelection: "Einen Entwurf wählen, um die aktuelle Revision zu prüfen.",
    current: "Aktuelle Revision",
    blocked: "Blockiert",
    warning: "Hinweis",
    passed: "Bestanden",
    note: "Provider-Ausführung bleibt deaktiviert. Eine bestandene Strukturprüfung ist keine Veröffentlichungserlaubnis.",
    account_active: "Zielkonto ist aktiv",
    account_not_active: "Zielkonto ist nicht aktiv",
    caption_within_control_limit:
      "Text liegt innerhalb des REDI-CONTROL-Limits",
    caption_missing_or_outside_control_limit:
      "Text fehlt oder liegt außerhalb des Kontrolllimits",
    media_count_supported: "Anzahl der Medien wird unterstützt",
    media_count_invalid: "Anzahl der Medien ist ungültig",
    instagram_jpeg_required: "Instagram-Bilder müssen JPEG sein",
    instagram_image_format_supported: "Instagram-Bildformat wird unterstützt",
    instagram_mp4_required: "Instagram-Videos müssen MP4 sein",
    instagram_video_format_supported: "Instagram-Videoformat wird unterstützt",
    instagram_carousel_within_limit:
      "Instagram-Karussell liegt innerhalb des 10-Elemente-Limits",
    instagram_public_https_delivery_not_configured:
      "Öffentliche HTTPS-Medienauslieferung ist nicht konfiguriert",
    instagram_publishing_limit_unavailable_without_live_connection:
      "Instagram-Publikationskontingent ist ohne Live-Verbindung nicht prüfbar",
    facebook_live_adapter_not_accepted:
      "Facebook-Live-Adapter ist nicht akzeptiert",
    media_dimensions_unavailable: "Mediendimensionen sind nicht verfügbar",
    channel_preflight_not_implemented:
      "Kanalspezifische Vorabprüfung ist nicht implementiert",
  },
  sq: {
    loading: "Po ngarkohen draftet…",
    signedOut: "Hyni për të nisur kontrollin paraprak.",
    unavailable: "Kontrolli paraprak nuk është i disponueshëm tani.",
    select: "Zgjidh draftin",
    empty: "Nuk ka ende drafte sociale.",
    checking: "Po kontrollohen kërkesat e providerit…",
    noSelection: "Zgjidh një draft për të kontrolluar revizionin aktual.",
    current: "Revizioni aktual",
    blocked: "I bllokuar",
    warning: "Kërkon vëmendje",
    passed: "Kaloi",
    note: "Ekzekutimi te provideri mbetet i çaktivizuar. Kalimi i kontrollit strukturor nuk është leje për publikim.",
    account_active: "Llogaria e destinacionit është aktive",
    account_not_active: "Llogaria e destinacionit nuk është aktive",
    caption_within_control_limit: "Teksti është brenda limitit të REDI CONTROL",
    caption_missing_or_outside_control_limit:
      "Teksti mungon ose është jashtë limitit të kontrollit",
    media_count_supported: "Numri i mediave mbështetet",
    media_count_invalid: "Numri i mediave nuk është i vlefshëm",
    instagram_jpeg_required: "Imazhet për Instagram duhet të jenë JPEG",
    instagram_image_format_supported:
      "Formati i imazhit për Instagram mbështetet",
    instagram_mp4_required: "Videot për Instagram duhet të jenë MP4",
    instagram_video_format_supported:
      "Formati i videos për Instagram mbështetet",
    instagram_carousel_within_limit:
      "Carousel i Instagram është brenda limitit 10 elemente",
    instagram_public_https_delivery_not_configured:
      "Dërgimi publik HTTPS i medias nuk është konfiguruar",
    instagram_publishing_limit_unavailable_without_live_connection:
      "Kuota e publikimeve në Instagram nuk mund të kontrollohet pa lidhje live",
    facebook_live_adapter_not_accepted:
      "Adapteri live i Facebook nuk është pranuar",
    media_dimensions_unavailable:
      "Dimensionet e medias nuk janë të disponueshme",
    channel_preflight_not_implemented:
      "Kontrolli specifik për kanal nuk është implementuar",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function SocialPreflightClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const { state: studio } = useSocialStudio();
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  useEffect(() => {
    if (studio.status !== "ready") return;
    if (!selected && studio.snapshot.drafts[0])
      setSelected(studio.snapshot.drafts[0].id);
  }, [selected, studio]);
  useEffect(() => {
    if (studio.status !== "ready" || !selected) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch(
      `/api/social/preflight/${encodeURIComponent(selected)}?workspaceId=${encodeURIComponent(studio.workspaceId)}`,
      { credentials: "include", cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("preflight_unavailable");
        const snapshot = parseSocialPreflight(await response.json());
        if (!snapshot) throw new Error("invalid_preflight");
        setState({ status: "ready", snapshot });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, [selected, studio]);
  if (studio.status !== "ready")
    return (
      <section className="social-state" role="status">
        {studio.status === "workspace-required" ? (
          <WorkspaceOnboarding locale={locale} linkClassName="social-primary" />
        ) : studio.status === "loading" ? (
          text.loading
        ) : studio.status === "signed-out" ? (
          text.signedOut
        ) : (
          text.unavailable
        )}
      </section>
    );
  const draftLabel = (draft: (typeof studio.snapshot.drafts)[number]) =>
    draft.content.title ?? draft.content.caption ?? "—";
  return (
    <div className="preflight-layout">
      <aside className="social-panel preflight-queue">
        <header>
          <h2>{text.select}</h2>
          <span>{studio.snapshot.drafts.length}</span>
        </header>
        {studio.snapshot.drafts.length ? (
          <ul>
            {studio.snapshot.drafts.map((draft) => (
              <li key={draft.id}>
                <button
                  type="button"
                  data-selected={String(selected === draft.id)}
                  onClick={() => setSelected(draft.id)}
                >
                  <strong>{draftLabel(draft)}</strong>
                  <small>
                    {text.current} · {draft.currentRevision}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.empty}</p>
        )}
      </aside>
      <section className="preflight-results">
        {state.status === "idle" ? (
          <div className="social-state">{text.noSelection}</div>
        ) : null}
        {state.status === "loading" ? (
          <div className="social-state">{text.checking}</div>
        ) : null}
        {state.status === "error" ? (
          <div className="social-state">{text.unavailable}</div>
        ) : null}
        {state.status === "ready" ? (
          <>
            <section className="preflight-note" role="note">
              {text.note}
            </section>
            {state.snapshot.targets.map((target) => (
              <article
                className="social-panel preflight-target"
                key={target.targetId}
              >
                <header>
                  <div>
                    <small>{target.channel}</small>
                    <h2>{target.accountName}</h2>
                  </div>
                </header>
                <ul>
                  {target.checks.map((check) => (
                    <li data-severity={check.severity} key={check.code}>
                      <strong>
                        {check.severity === "blocker"
                          ? text.blocked
                          : check.severity === "warning"
                            ? text.warning
                            : text.passed}
                      </strong>
                      <span>
                        {text[check.code as keyof typeof text] ?? check.code}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </>
        ) : null}
      </section>
    </div>
  );
}
