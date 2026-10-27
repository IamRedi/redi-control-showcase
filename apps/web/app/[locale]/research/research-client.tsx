"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Item = Record<string, unknown>;
type Workspace = {
  id: string;
  name: string;
  slug: string;
  description?: string;
};

const csrf = () =>
  document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="))
    ?.split("=")[1] ?? "";

const field = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;
const record = (value: unknown): Item =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Item)
    : {};
const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const commaList = (data: FormData, name: string) =>
  field(data.get(name))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "section";

async function call(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`/api/research/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body
      ? { "content-type": "application/json", "x-csrf-token": csrf() }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as Item;
  if (!response.ok) {
    throw new Error(text(payload.error, `HTTP ${response.status}`));
  }
  return payload;
}

export function ResearchClient({ locale }: { locale: string }) {
  const sq = locale === "sq";
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [profiles, setProfiles] = useState<Item[]>([]);
  const [sources, setSources] = useState<Item[]>([]);
  const [cases, setCases] = useState<Item[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("workspaces")
      .then((payload) => {
        const items = Array.isArray(payload.items)
          ? (payload.items as Workspace[])
          : [];
        setWorkspaces(items);
        setWorkspaceId((current) => current || items[0]?.id || "");
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : sq
              ? "Workzone nuk mund të ngarkohen."
              : "Workzones could not be loaded.",
        ),
      );
  }, [sq]);

  const loadWorkspace = useCallback(async () => {
    if (!workspaceId) {
      setProfiles([]);
      setSources([]);
      setCases([]);
      return;
    }
    try {
      const query = new URLSearchParams({ workspaceId }).toString();
      const [profilePayload, sourcePayload, casePayload] = await Promise.all([
        call(`profiles?${query}`),
        call(`sources?${query}`),
        call(`cases?${query}`),
      ]);
      setProfiles(
        Array.isArray(profilePayload.items)
          ? (profilePayload.items as Item[])
          : [],
      );
      setSources(
        Array.isArray(sourcePayload.items)
          ? (sourcePayload.items as Item[])
          : [],
      );
      setCases(
        Array.isArray(casePayload.items) ? (casePayload.items as Item[]) : [],
      );
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : sq
            ? "Të dhënat e Workzone nuk mund të ngarkohen."
            : "Workzone data could not be loaded.",
      );
    }
  }, [sq, workspaceId]);

  useEffect(() => void loadWorkspace(), [loadWorkspace]);

  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await loadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function createProfile(data: FormData) {
    await submit(async () => {
      await call("profiles", {
        workspaceId,
        name: field(data.get("name")),
        publicationIdentity: field(data.get("identity")),
        locale: field(data.get("locale")),
        audience: field(data.get("audience")),
        categories: commaList(data, "categories"),
      });
    });
  }

  async function createSource(data: FormData) {
    await submit(async () => {
      await call("sources", {
        workspaceId,
        ...(field(data.get("profileId"))
          ? { profileId: field(data.get("profileId")) }
          : {}),
        name: field(data.get("name")),
        sourceType: field(data.get("sourceType")),
        canonicalRef: field(data.get("reference")),
        tier: field(data.get("tier")),
        verificationEligible: data.get("eligible") === "on",
        provenance: { method: "manual", recordedAt: new Date().toISOString() },
      });
    });
  }

  async function createCase(data: FormData) {
    await submit(async () => {
      await call("cases", {
        workspaceId,
        profileId: field(data.get("profileId")),
        title: field(data.get("title")),
        topic: field(data.get("topic")),
        notes: field(data.get("notes")),
      });
    });
  }

  async function updateProfile(data: FormData) {
    if (!selectedProfile) return;
    await submit(async () => {
      const current = record(selectedProfile.editorialConfig);
      const style = record(current.style);
      const languageQuality = record(style.languageQuality);
      const verification = record(current.verification);
      const sourceRequirements = record(current.sourceRequirements);
      const freshness = record(current.freshness);
      const destinations = record(current.destinations);
      const visual = record(current.visual);
      const publishing = record(current.publishing);
      const sectionNames = commaList(data, "sections");
      const currentSections = Array.isArray(current.sections)
        ? current.sections.map(record)
        : [];
      const usedSlugs = new Map<string, number>();
      const sections = sectionNames.map((name, index) => {
        const existing = currentSections.find(
          (section) => text(section.name) === name,
        );
        const base = text(existing?.slug, slugify(name));
        const count = usedSlugs.get(base) ?? 0;
        usedSlugs.set(base, count + 1);
        return {
          ...existing,
          slug: count === 0 ? base : `${base}-${count + 1}`,
          name,
          priority: number(existing?.priority, Math.max(0, 100 - index * 10)),
          enabled: existing?.enabled !== false,
          satire: existing?.satire === true,
        };
      });
      const acceptedTiers = data
        .getAll("acceptedTiers")
        .filter((tier): tier is string => typeof tier === "string");
      await call(`profiles/${String(selectedProfile.id)}/update`, {
        expectedVersion: Number(selectedProfile.configurationVersion),
        name: field(data.get("name")),
        publicationIdentity: field(data.get("identity")),
        tagline: field(data.get("tagline")),
        locale: field(data.get("locale")),
        country: field(data.get("country")),
        region: field(data.get("region")),
        audience: field(data.get("audience")),
        categories: sectionNames,
        excludedTopics: commaList(data, "excludedTopics"),
        restrictedTopics: commaList(data, "restrictedTopics"),
        editorialConfig: {
          ...current,
          sections,
          style: {
            ...style,
            tone: commaList(data, "tone"),
            readability: field(data.get("readability")),
            headlineMaxCharacters: Number(data.get("headlineMaxCharacters")),
            articleMinWords: Number(data.get("articleMinWords")),
            articleMaxWords: Number(data.get("articleMaxWords")),
            languageQuality: {
              ...languageQuality,
              targetLocale: field(data.get("targetLocale")),
            },
          },
          verification: {
            ...verification,
            strict: data.get("strict") === "on",
            requirePrimaryForImportant: data.get("requirePrimary") === "on",
            independentCrossChecks: Number(data.get("crossChecks")),
          },
          sourceRequirements: {
            ...sourceRequirements,
            acceptedTiers:
              acceptedTiers.length > 0
                ? acceptedTiers
                : list(sourceRequirements.acceptedTiers),
          },
          freshness: {
            ...freshness,
            freshHours: Number(data.get("freshHours")),
            staleHours: Number(data.get("staleHours")),
          },
          destinations: {
            ...destinations,
            website: data.get("website") === "on",
            facebook: data.get("facebook") === "on",
            instagram: data.get("instagram") === "on",
          },
          visual: {
            ...visual,
            family: field(data.get("visualFamily")),
            cardHeadlineMaxCharacters: Number(
              data.get("cardHeadlineMaxCharacters"),
            ),
            supportingFactsMax: Number(data.get("supportingFactsMax")),
            generatedImageDisclosure: data.get("generatedDisclosure") === "on",
          },
          publishing: {
            ...publishing,
            targetsPerDay: Number(data.get("targetsPerDay")),
            windows: commaList(data, "publishingWindows"),
          },
        },
      });
      setSelectedProfile(null);
    });
  }

  const activeWorkspace = workspaces.find((item) => item.id === workspaceId);
  const config = record(selectedProfile?.editorialConfig);
  const style = record(config.style);
  const verification = record(config.verification);
  const sourceRequirements = record(config.sourceRequirements);
  const freshness = record(config.freshness);
  const destinations = record(config.destinations);
  const visual = record(config.visual);
  const publishing = record(config.publishing);
  const languageQuality = record(style.languageQuality);
  const sectionNames = Array.isArray(config.sections)
    ? config.sections.map((item) => text(record(item).name)).filter(Boolean)
    : [];

  return (
    <div className="research-shell newsroom-console">
      <section className="newsroom-context" aria-labelledby="workzone-heading">
        <div>
          <span className="eyebrow">
            {sq ? "Konteksti aktiv" : "Active context"}
          </span>
          <h2 id="workzone-heading">
            {sq ? "Workzone e medias" : "Media workzone"}
          </h2>
          <p>
            {sq
              ? "Të gjitha profilet, burimet dhe rastet më poshtë i përkasin vetëm kësaj hapësire."
              : "Every profile, source and case below belongs only to this workzone."}
          </p>
        </div>
        <label>
          <span>{sq ? "Zgjidh Workzone" : "Choose workzone"}</span>
          <select
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.length === 0 ? (
              <option value="">
                {sq ? "Nuk ka Workzone aktive" : "No active workzones"}
              </option>
            ) : null}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? (
        <p className="website-state website-error" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className="newsroom-summary"
        aria-label={sq ? "Përmbledhje" : "Summary"}
      >
        <article>
          <strong>{profiles.length}</strong>
          <span>{sq ? "Profile editoriale" : "Editorial profiles"}</span>
        </article>
        <article>
          <strong>{sources.length}</strong>
          <span>{sq ? "Burime të regjistruara" : "Registered sources"}</span>
        </article>
        <article>
          <strong>{cases.length}</strong>
          <span>{sq ? "Raste kërkimi" : "Research cases"}</span>
        </article>
        <article>
          <strong>{activeWorkspace?.name ?? "—"}</strong>
          <span>{sq ? "Workzone aktive" : "Active workzone"}</span>
        </article>
      </section>

      <section className="research-column">
        <header className="newsroom-section-heading">
          <span>01</span>
          <div>
            <h2>{sq ? "Profili editorial" : "Editorial profile"}</h2>
            <p>
              {sq
                ? "Përcakton zërin, audiencën dhe rregullat e medias."
                : "Defines the publication voice, audience and rules."}
            </p>
          </div>
        </header>
        <details className="newsroom-create-panel">
          <summary>{sq ? "+ Profil i ri" : "+ New profile"}</summary>
          <form action={createProfile}>
            <label>
              {sq ? "Emri i profilit" : "Profile name"}
              <input name="name" required />
            </label>
            <label>
              {sq ? "Identiteti i publikimit" : "Publication identity"}
              <input name="identity" required />
            </label>
            <label>
              {sq ? "Gjuha" : "Language"}
              <input
                name="locale"
                defaultValue={sq ? "sq-AL" : "en"}
                required
              />
            </label>
            <label>
              {sq ? "Audienca" : "Audience"}
              <input name="audience" />
            </label>
            <label className="form-wide">
              {sq ? "Seksionet, ndarë me presje" : "Sections, comma separated"}
              <input
                name="categories"
                placeholder={
                  sq ? "Aktualitet, Ekonomi, Sport" : "News, Business, Sport"
                }
              />
            </label>
            <button disabled={!workspaceId || busy}>
              {sq ? "Krijo profilin" : "Create profile"}
            </button>
          </form>
        </details>
        <div className="newsroom-list">
          {profiles.map((profile) => (
            <article key={String(profile.id)}>
              <div>
                <strong>{String(profile.name)}</strong>
                <span>
                  {String(profile.locale)} ·{" "}
                  {String(profile.publicationIdentity)}
                </span>
              </div>
              <button type="button" onClick={() => setSelectedProfile(profile)}>
                {sq ? "Konfiguro" : "Configure"}
              </button>
            </article>
          ))}
          {profiles.length === 0 ? (
            <p className="website-state">
              {sq
                ? "Krijo profilin e parë editorial për këtë Workzone."
                : "Create the first editorial profile for this workzone."}
            </p>
          ) : null}
        </div>
      </section>

      <section className="research-column">
        <header className="newsroom-section-heading">
          <span>02</span>
          <div>
            <h2>{sq ? "Regjistri i burimeve" : "Source registry"}</h2>
            <p>
              {sq
                ? "Burime me origjinë dhe nivel besueshmërie të dokumentuar."
                : "Sources with documented provenance and trust tier."}
            </p>
          </div>
        </header>
        <details className="newsroom-create-panel">
          <summary>{sq ? "+ Shto burim" : "+ Add source"}</summary>
          <form action={createSource}>
            <label>
              {sq ? "Profili" : "Profile"}
              <select name="profileId">
                <option value="">
                  {sq ? "Për gjithë Workzone" : "Entire workzone"}
                </option>
                {profiles.map((profile) => (
                  <option key={String(profile.id)} value={String(profile.id)}>
                    {String(profile.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {sq ? "Emri i burimit" : "Source name"}
              <input name="name" required />
            </label>
            <label>
              {sq ? "Lloji" : "Type"}
              <select name="sourceType">
                <option value="website">Website</option>
                <option value="feed">RSS / Atom</option>
                <option value="document">Document</option>
                <option value="database">Database</option>
                <option value="social">Social</option>
              </select>
            </label>
            <label>
              {sq ? "Niveli" : "Trust tier"}
              <select name="tier">
                <option value="primary">Primary</option>
                <option value="strong_reporting">Strong reporting</option>
                <option value="discovery">Discovery</option>
              </select>
            </label>
            <label className="form-wide">
              URL / reference
              <input name="reference" required />
            </label>
            <label className="check-row">
              <input type="checkbox" name="eligible" />
              {sq
                ? "Mund të përdoret për verifikim"
                : "Eligible for verification"}
            </label>
            <button disabled={!workspaceId || busy}>
              {sq ? "Ruaj burimin" : "Save source"}
            </button>
          </form>
        </details>
        <div className="newsroom-list">
          {sources.map((source) => (
            <article key={String(source.id)}>
              <div>
                <strong>{String(source.name)}</strong>
                <span>
                  {String(source.tier).replaceAll("_", " ")} ·{" "}
                  {String(source.canonicalRef)}
                </span>
              </div>
            </article>
          ))}
          {sources.length === 0 ? (
            <p className="website-state">
              {sq
                ? "Ende nuk ka burime në këtë Workzone."
                : "No sources in this workzone yet."}
            </p>
          ) : null}
        </div>
      </section>

      <section className="research-column research-cases">
        <header className="newsroom-section-heading">
          <span>03</span>
          <div>
            <h2>{sq ? "Rastet e kërkimit" : "Research cases"}</h2>
            <p>
              {sq
                ? "Nga pyetja te provat, pretendimet dhe drafti editorial."
                : "From question to evidence, claims and editorial draft."}
            </p>
          </div>
        </header>
        <details className="newsroom-create-panel">
          <summary>
            {sq ? "+ Hap rast kërkimi" : "+ Open research case"}
          </summary>
          <form action={createCase}>
            <label>
              {sq ? "Profili editorial" : "Editorial profile"}
              <select name="profileId" required>
                <option value="">
                  {sq ? "Zgjidh profilin" : "Choose profile"}
                </option>
                {profiles.map((profile) => (
                  <option key={String(profile.id)} value={String(profile.id)}>
                    {String(profile.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {sq ? "Titulli i punës" : "Working title"}
              <input name="title" required />
            </label>
            <label className="form-wide">
              {sq ? "Tema / pyetja" : "Topic / question"}
              <input name="topic" required />
            </label>
            <label className="form-wide">
              {sq ? "Konteksti dhe udhëzimet" : "Context and instructions"}
              <textarea name="notes" />
            </label>
            <button disabled={!workspaceId || profiles.length === 0 || busy}>
              {sq ? "Krijo rastin" : "Create case"}
            </button>
          </form>
        </details>
        <div className="newsroom-case-grid">
          {cases.map((researchCase) => (
            <Link
              href={`research/${String(researchCase.id)}`}
              key={String(researchCase.id)}
            >
              <strong>{String(researchCase.title)}</strong>
              <span>
                {String(researchCase.status)} ·{" "}
                {String(researchCase.sourceCount)} {sq ? "burime" : "sources"} ·{" "}
                {String(researchCase.claimCount)} {sq ? "pretendime" : "claims"}
              </span>
            </Link>
          ))}
          {cases.length === 0 ? (
            <p className="website-state">
              {sq
                ? "Ende nuk ka raste kërkimi në këtë Workzone."
                : "No research cases in this workzone yet."}
            </p>
          ) : null}
        </div>
      </section>

      {selectedProfile ? (
        <div
          className="newsroom-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-editor-title"
        >
          <form action={updateProfile} className="profile-control-panel">
            <header>
              <div>
                <span className="eyebrow">
                  {sq ? "Revizion i kontrolluar" : "Controlled revision"}
                </span>
                <h2 id="profile-editor-title">
                  {sq ? "Konfigurimi editorial" : "Editorial configuration"}
                </h2>
                <p>
                  {String(selectedProfile.name)} · v
                  {String(selectedProfile.configurationVersion)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProfile(null)}
                aria-label={sq ? "Mbyll" : "Close"}
              >
                ×
              </button>
            </header>
            <fieldset>
              <legend>{sq ? "Identiteti" : "Identity"}</legend>
              <label>
                {sq ? "Emri" : "Name"}
                <input
                  name="name"
                  defaultValue={String(selectedProfile.name)}
                  required
                />
              </label>
              <label>
                {sq ? "Identiteti i publikimit" : "Publication identity"}
                <input
                  name="identity"
                  defaultValue={String(selectedProfile.publicationIdentity)}
                  required
                />
              </label>
              <label>
                {sq ? "Moto" : "Tagline"}
                <input
                  name="tagline"
                  defaultValue={text(selectedProfile.tagline)}
                />
              </label>
              <label>
                Locale
                <input
                  name="locale"
                  defaultValue={String(selectedProfile.locale)}
                  required
                />
              </label>
              <label>
                {sq ? "Shteti" : "Country"}
                <input
                  name="country"
                  defaultValue={text(selectedProfile.country)}
                />
              </label>
              <label>
                {sq ? "Rajoni" : "Region"}
                <input
                  name="region"
                  defaultValue={text(selectedProfile.region)}
                />
              </label>
              <label className="form-wide">
                {sq ? "Audienca" : "Audience"}
                <textarea
                  name="audience"
                  defaultValue={text(selectedProfile.audience)}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>
                {sq ? "Seksionet dhe kufijtë" : "Sections and boundaries"}
              </legend>
              <label className="form-wide">
                {sq
                  ? "Seksionet, ndarë me presje"
                  : "Sections, comma separated"}
                <input
                  name="sections"
                  defaultValue={sectionNames.join(", ")}
                  required
                />
              </label>
              <label>
                {sq ? "Tema të përjashtuara" : "Excluded topics"}
                <textarea
                  name="excludedTopics"
                  defaultValue={list(selectedProfile.excludedTopics).join(", ")}
                />
              </label>
              <label>
                {sq ? "Tema të kufizuara" : "Restricted topics"}
                <textarea
                  name="restrictedTopics"
                  defaultValue={list(selectedProfile.restrictedTopics).join(
                    ", ",
                  )}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>{sq ? "Stili" : "Style"}</legend>
              <label>
                {sq ? "Toni" : "Tone"}
                <input
                  name="tone"
                  defaultValue={list(style.tone).join(", ")}
                  required
                />
              </label>
              <label>
                {sq ? "Lexueshmëria" : "Readability"}
                <select
                  name="readability"
                  defaultValue={text(style.readability, "general")}
                >
                  <option value="simple">Simple</option>
                  <option value="general">General</option>
                  <option value="specialist">Specialist</option>
                </select>
              </label>
              <label>
                {sq ? "Gjuha finale" : "Output language"}
                <input
                  name="targetLocale"
                  defaultValue={text(
                    languageQuality.targetLocale,
                    text(selectedProfile.locale, "en"),
                  )}
                  required
                />
              </label>
              <label>
                {sq ? "Maks. titulli" : "Headline max"}
                <input
                  type="number"
                  name="headlineMaxCharacters"
                  min="30"
                  max="240"
                  defaultValue={number(style.headlineMaxCharacters, 120)}
                  required
                />
              </label>
              <label>
                {sq ? "Min. fjalë" : "Min words"}
                <input
                  type="number"
                  name="articleMinWords"
                  min="50"
                  max="5000"
                  defaultValue={number(style.articleMinWords, 250)}
                  required
                />
              </label>
              <label>
                {sq ? "Maks. fjalë" : "Max words"}
                <input
                  type="number"
                  name="articleMaxWords"
                  min="100"
                  max="10000"
                  defaultValue={number(style.articleMaxWords, 1200)}
                  required
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>{sq ? "Verifikimi" : "Verification"}</legend>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="strict"
                  defaultChecked={verification.strict !== false}
                />
                {sq ? "Verifikim strikt" : "Strict verification"}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="requirePrimary"
                  defaultChecked={
                    verification.requirePrimaryForImportant !== false
                  }
                />
                {sq
                  ? "Burim primar për lajme të rëndësishme"
                  : "Primary source for important stories"}
              </label>
              <label>
                {sq ? "Kontrolle të pavarura" : "Independent checks"}
                <input
                  type="number"
                  name="crossChecks"
                  min="0"
                  max="10"
                  defaultValue={number(verification.independentCrossChecks, 1)}
                  required
                />
              </label>
              <div className="check-group">
                <span>{sq ? "Nivelet e pranuara" : "Accepted tiers"}</span>
                {["primary", "strong_reporting", "discovery"].map((tier) => (
                  <label className="check-row" key={tier}>
                    <input
                      type="checkbox"
                      name="acceptedTiers"
                      value={tier}
                      defaultChecked={list(
                        sourceRequirements.acceptedTiers,
                      ).includes(tier)}
                    />
                    {tier.replaceAll("_", " ")}
                  </label>
                ))}
              </div>
              <label>
                {sq ? "E freskët deri në orë" : "Fresh up to hours"}
                <input
                  type="number"
                  name="freshHours"
                  min="1"
                  max="8760"
                  defaultValue={number(freshness.freshHours, 48)}
                  required
                />
              </label>
              <label>
                {sq ? "E vjetër pas orësh" : "Stale after hours"}
                <input
                  type="number"
                  name="staleHours"
                  min="2"
                  max="17520"
                  defaultValue={number(freshness.staleHours, 168)}
                  required
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>
                {sq ? "Publikimi dhe pamja" : "Publishing and visual"}
              </legend>
              <div className="check-group">
                <span>{sq ? "Destinacionet" : "Destinations"}</span>
                {["website", "facebook", "instagram"].map((destination) => (
                  <label className="check-row" key={destination}>
                    <input
                      type="checkbox"
                      name={destination}
                      defaultChecked={destinations[destination] === true}
                    />
                    {destination}
                  </label>
                ))}
              </div>
              <label>
                {sq ? "Familja vizuale" : "Visual family"}
                <input
                  name="visualFamily"
                  defaultValue={text(visual.family, "editorial")}
                  required
                />
              </label>
              <label>
                {sq ? "Maks. titulli në kartë" : "Card headline max"}
                <input
                  type="number"
                  name="cardHeadlineMaxCharacters"
                  min="20"
                  max="160"
                  defaultValue={number(visual.cardHeadlineMaxCharacters, 80)}
                  required
                />
              </label>
              <label>
                {sq ? "Fakte mbështetëse" : "Supporting facts"}
                <input
                  type="number"
                  name="supportingFactsMax"
                  min="0"
                  max="6"
                  defaultValue={number(visual.supportingFactsMax, 3)}
                  required
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="generatedDisclosure"
                  defaultChecked={visual.generatedImageDisclosure !== false}
                />
                {sq
                  ? "Shëno imazhet e gjeneruara"
                  : "Disclose generated images"}
              </label>
              <label>
                {sq ? "Objektivi në ditë" : "Daily target"}
                <input
                  type="number"
                  name="targetsPerDay"
                  min="0"
                  max="100"
                  defaultValue={number(publishing.targetsPerDay, 0)}
                  required
                />
              </label>
              <label>
                {sq ? "Oraret, ndarë me presje" : "Windows, comma separated"}
                <input
                  name="publishingWindows"
                  defaultValue={list(publishing.windows).join(", ")}
                  placeholder="08:00 Europe/Berlin"
                />
              </label>
            </fieldset>
            <footer>
              <p>
                {sq
                  ? "Rishikimi njerëzor dhe leja e publikimit mbeten gjithmonë të detyrueshme."
                  : "Human review and publish permission always remain required."}
              </p>
              <button type="button" onClick={() => setSelectedProfile(null)}>
                {sq ? "Anulo" : "Cancel"}
              </button>
              <button disabled={busy}>
                {sq ? "Ruaj revizionin" : "Save revision"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
