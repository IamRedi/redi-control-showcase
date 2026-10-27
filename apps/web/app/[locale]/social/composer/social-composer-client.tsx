"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { WorkspaceOnboarding } from "../../../workspace-onboarding";
import { useSocialStudio } from "../use-social-studio";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    loading: "Loading the verified studio…",
    signedOut: "Sign in to create social drafts.",
    unavailable: "The Social Studio is unavailable right now.",
    destinations: "Destinations",
    noAccounts: "No active Facebook or Instagram account is available.",
    media: "Verified media",
    noMedia: "No ready media is available. Upload and verify media first.",
    content: "Content",
    title: "Internal title",
    caption: "Caption",
    description: "Video description / editorial note",
    save: "Save governed draft",
    saving: "Saving…",
    saved: "Draft saved. It has not been submitted or published.",
    failed: "The draft could not be saved.",
    recent: "Recent drafts",
    noDrafts: "No social drafts exist yet.",
    revision: "Revision",
    untitled: "Untitled",
  },
  de: {
    loading: "Geprüftes Studio wird geladen…",
    signedOut: "Anmelden, um Social-Entwürfe zu erstellen.",
    unavailable: "Das Social Studio ist derzeit nicht verfügbar.",
    destinations: "Ziele",
    noAccounts: "Kein aktives Facebook- oder Instagram-Konto ist verfügbar.",
    media: "Geprüfte Medien",
    noMedia:
      "Keine fertigen Medien verfügbar. Medien zuerst hochladen und prüfen.",
    content: "Inhalt",
    title: "Interner Titel",
    caption: "Text",
    description: "Videobeschreibung / redaktionelle Notiz",
    save: "Kontrollierten Entwurf speichern",
    saving: "Wird gespeichert…",
    saved:
      "Entwurf gespeichert. Er wurde weder eingereicht noch veröffentlicht.",
    failed: "Der Entwurf konnte nicht gespeichert werden.",
    recent: "Letzte Entwürfe",
    noDrafts: "Noch keine Social-Entwürfe vorhanden.",
    revision: "Revision",
    untitled: "Ohne Titel",
  },
  sq: {
    loading: "Po ngarkohet studioja e verifikuar…",
    signedOut: "Hyni për të krijuar drafte sociale.",
    unavailable: "Social Studio nuk është i disponueshëm tani.",
    destinations: "Destinacionet",
    noAccounts: "Nuk ka llogari aktive Facebook ose Instagram.",
    media: "Media të verifikuara",
    noMedia: "Nuk ka media të gatshme. Ngarko dhe verifiko median fillimisht.",
    content: "Përmbajtja",
    title: "Titulli i brendshëm",
    caption: "Teksti i postimit",
    description: "Përshkrimi i videos / shënim editorial",
    save: "Ruaj draftin e kontrolluar",
    saving: "Po ruhet…",
    saved:
      "Drafti u ruajt. Nuk është dërguar për review dhe nuk është publikuar.",
    failed: "Drafti nuk mund të ruhej.",
    recent: "Draftet e fundit",
    noDrafts: "Nuk ka ende drafte sociale.",
    revision: "Revizioni",
    untitled: "Pa titull",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};

export function SocialComposerClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const { state, reload } = useSocialStudio();
  const [submission, setSubmission] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready") return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const textValue = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value.trim()
        ? value.trim()
        : undefined;
    };
    const accountIds = form.getAll("accountId");
    const mediaAssetIds = form.getAll("mediaAssetId");
    if (
      accountIds.length === 0 ||
      mediaAssetIds.length === 0 ||
      ![
        textValue("title"),
        textValue("caption"),
        textValue("description"),
      ].some(Boolean)
    ) {
      setSubmission("failed");
      return;
    }
    setSubmission("saving");
    try {
      const response = await fetch("/api/social/studio", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf(),
        },
        body: JSON.stringify({
          workspaceId: state.workspaceId,
          accountIds,
          mediaAssetIds,
          title: textValue("title"),
          caption: textValue("caption"),
          description: textValue("description"),
        }),
      });
      if (!response.ok) throw new Error("draft_failed");
      formElement.reset();
      setSubmission("saved");
      await reload();
    } catch {
      setSubmission("failed");
    }
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

  const accounts = state.snapshot.accounts.filter(
    (account) =>
      account.status === "active" &&
      ["facebook_page", "instagram_account"].includes(account.account_type),
  );
  const media = state.snapshot.media.filter(
    (asset) => asset.status === "ready",
  );
  const canCompose = accounts.length > 0 && media.length > 0;
  return (
    <div className="composer-layout">
      <form
        className="social-composer"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset>
          <legend>{text.destinations}</legend>
          {accounts.length ? (
            <div className="studio-choice-grid">
              {accounts.map((account) => (
                <label key={account.id}>
                  <input name="accountId" type="checkbox" value={account.id} />
                  <span>
                    <strong>{account.display_name}</strong>
                    <small>{account.account_type.replaceAll("_", " ")}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p>{text.noAccounts}</p>
          )}
        </fieldset>
        <fieldset>
          <legend>{text.media}</legend>
          {media.length ? (
            <div className="studio-choice-grid">
              {media.map((asset) => (
                <label key={asset.id}>
                  <input name="mediaAssetId" type="checkbox" value={asset.id} />
                  <span>
                    <strong>{asset.filename}</strong>
                    <small>{asset.mimeType ?? asset.status}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p>{text.noMedia}</p>
          )}
        </fieldset>
        <fieldset className="composer-copy">
          <legend>{text.content}</legend>
          <label>
            {text.title}
            <input name="title" maxLength={100} />
          </label>
          <label>
            {text.caption}
            <textarea name="caption" maxLength={5000} rows={6} />
          </label>
          <label>
            {text.description}
            <textarea name="description" maxLength={5000} rows={4} />
          </label>
        </fieldset>
        <button
          className="social-primary"
          type="submit"
          disabled={!canCompose || submission === "saving"}
        >
          {submission === "saving" ? text.saving : text.save}
        </button>
        <p
          className="composer-result"
          aria-live="polite"
          data-state={submission}
        >
          {submission === "saved"
            ? text.saved
            : submission === "failed"
              ? text.failed
              : ""}
        </p>
      </form>
      <section className="social-panel studio-draft-list">
        <header>
          <h2>{text.recent}</h2>
          <span>{String(state.snapshot.drafts.length)}</span>
        </header>
        {state.snapshot.drafts.length ? (
          <ul>
            {state.snapshot.drafts.slice(0, 12).map((draft) => (
              <li key={draft.id}>
                <div>
                  <strong>
                    {draft.content.title ??
                      draft.content.caption ??
                      text.untitled}
                  </strong>
                  <small>
                    {text.revision} {String(draft.currentRevision)} ·{" "}
                    {draft.targets.map((target) => target.channel).join(" / ")}
                  </small>
                </div>
                <span data-draft-status={draft.status}>{draft.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.noDrafts}</p>
        )}
      </section>
    </div>
  );
}
