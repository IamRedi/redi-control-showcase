"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
const csrf = () =>
  document.cookie
    .split("; ")
    .find((v) => v.startsWith("redi_csrf="))
    ?.split("=")[1] ?? "";
type Row = Record<string, unknown>;
const display = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const contentItemHref = (locale: string, itemId: unknown) => {
  const value = encodeURIComponent(String(itemId));
  return `/${locale}/content?item=${value}#content-item-${value}`;
};

function EditorialDraftCard({
  entry,
  post,
  sq,
  locale,
}: {
  entry: Row;
  post: (path: string, body: Row) => Promise<void>;
  sq: boolean;
  locale: string;
}) {
  const draft = entry.draft as Row;
  const canRevise =
    entry.status === "review_required" || entry.status === "blocked";

  return (
    <article className="editorial-draft-card">
      <p className="eyebrow">
        {sq ? "Draft editorial" : "Editorial draft"} v{String(entry.version)} ·{" "}
        {String(entry.status)} · {String(entry.verificationState)}
      </p>
      <h3>{String(draft.headline)}</h3>
      <p>{String(draft.essence)}</p>
      <details className="editorial-preview">
        <summary>
          {sq ? "Lexo draftin dhe kontrollin" : "Read draft and validation"}
        </summary>
        <p>{String(draft.articleBody)}</p>
        <dl>
          <div>
            <dt>{sq ? "Verifikimi" : "Verification"}</dt>
            <dd>{String(entry.verificationState)}</dd>
          </div>
          <div>
            <dt>{sq ? "Gjendja" : "State"}</dt>
            <dd>{String(entry.status)}</dd>
          </div>
        </dl>
      </details>
      {canRevise ? (
        <details>
          <summary>
            {sq ? "Ndrysho dhe rivlerëso" : "Edit and revalidate"}
          </summary>
          <form
            action={async (form) =>
              post(`editorial-drafts/${String(entry.id)}/revisions`, {
                draft: {
                  ...draft,
                  headline: form.get("headline"),
                  essence: form.get("essence"),
                  articleBody: form.get("articleBody"),
                },
                reason: form.get("reason"),
                validationIdempotencyKey: `editorial-revision-${String(entry.id)}-${crypto.randomUUID()}`,
              })
            }
          >
            <label>
              {sq ? "Titulli" : "Headline"}
              <textarea
                name="headline"
                defaultValue={display(draft.headline)}
                required
              />
            </label>
            <label>
              {sq ? "Përmbledhja" : "Essence"}
              <textarea
                name="essence"
                defaultValue={display(draft.essence)}
                required
              />
            </label>
            <label>
              {sq ? "Teksti i artikullit" : "Article body"}
              <textarea
                name="articleBody"
                defaultValue={display(draft.articleBody)}
                required
              />
            </label>
            <label>
              {sq ? "Arsyeja e ndryshimit" : "Revision reason"}
              <input
                name="reason"
                placeholder={
                  sq
                    ? "Çfarë u korrigjua?"
                    : "Describe the factual or editorial correction"
                }
                required
              />
            </label>
            <button>
              {sq ? "Ruaj dhe rivlerëso" : "Save revision and revalidate"}
            </button>
          </form>
        </details>
      ) : null}
      {entry.status === "review_required" ? (
        <div className="research-actions">
          <button
            onClick={() =>
              void post(`editorial-drafts/${String(entry.id)}/decision`, {
                decision: "approved",
              })
            }
          >
            {sq ? "Mirato draftin" : "Approve editorial draft"}
          </button>
          <button
            onClick={() =>
              void post(`editorial-drafts/${String(entry.id)}/decision`, {
                decision: "rejected",
              })
            }
          >
            {sq ? "Refuzo" : "Reject"}
          </button>
        </div>
      ) : null}
      {entry.status === "approved" ? (
        <button
          onClick={() =>
            void post(`editorial-drafts/${String(entry.id)}/promote`, {})
          }
        >
          {sq ? "Dërgo te Artikujt" : "Promote to Unified Content"}
        </button>
      ) : null}
      {entry.contentItemId ? (
        <p>
          {sq ? "U krijua artikulli në Content." : "Content Item created."}{" "}
          <Link
            className="case-next-link"
            href={contentItemHref(locale, entry.contentItemId)}
          >
            {sq ? "Vazhdo te Content Studio" : "Continue in Content Studio"} →
          </Link>
        </p>
      ) : null}
      {entry.sourceDraftId ? (
        <p>
          {sq
            ? "Ky është një revizion i draftit të mëparshëm."
            : "This is a revision of an earlier draft."}
        </p>
      ) : null}
    </article>
  );
}

export function CaseClient({
  caseId,
  locale,
}: {
  caseId: string;
  locale: string;
}) {
  const sq = locale === "sq";
  const [data, setData] = useState<Row | null>(null),
    [runs, setRuns] = useState<Row[]>([]),
    [feeds, setFeeds] = useState<Row[]>([]),
    [registrySources, setRegistrySources] = useState<Row[]>([]),
    [intelligence, setIntelligence] = useState<Row>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/research/cases/${caseId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as Row;
      setData(next);
      const workspaceId = String((next.case as Row).workspaceId);
      const [
        discovery,
        configuredFeeds,
        sourcesResponse,
        evidenceIntelligence,
      ] = await Promise.all([
        fetch(
          `/api/research/discovery?caseId=${encodeURIComponent(caseId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
          { credentials: "include", cache: "no-store" },
        ),
        fetch(
          `/api/research/feeds?workspaceId=${encodeURIComponent(workspaceId)}`,
          { credentials: "include", cache: "no-store" },
        ),
        fetch(
          `/api/research/sources?workspaceId=${encodeURIComponent(workspaceId)}`,
          { credentials: "include", cache: "no-store" },
        ),
        fetch(`/api/research/cases/${caseId}/intelligence`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      if (discovery.ok)
        setRuns(((await discovery.json()) as Row).items as Row[]);
      if (configuredFeeds.ok)
        setFeeds(((await configuredFeeds.json()) as Row).items as Row[]);
      if (sourcesResponse.ok)
        setRegistrySources(
          ((await sourcesResponse.json()) as Row).items as Row[],
        );
      if (evidenceIntelligence.ok)
        setIntelligence((await evidenceIntelligence.json()) as Row);
    } catch {
      setError("Research case is unavailable.");
    }
  }, [caseId]);
  useEffect(() => void load(), [load]);
  const processing = runs.some(
    (run) => run.status === "pending" || run.status === "running",
  );
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 1_500);
    return () => window.clearInterval(timer);
  }, [load, processing]);
  async function post(path: string, body: Row) {
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`/api/research/${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf(),
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const detail = (await r.json().catch(() => ({}))) as Row;
        setError(
          display(detail.error) ||
            "Veprimi dështoi. Kontrollo adresën dhe provo përsëri.",
        );
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <p className="website-state">{error || "Loading research evidence…"}</p>
    );
  const c = data.case as Row,
    sources = data.sources as Row[],
    claims = data.claims as Row[],
    candidates = data.candidates as Row[],
    workspaceId = String(c.workspaceId);
  const feedSources = registrySources.filter(
    (source) => source.sourceType === "feed",
  );
  return (
    <div className="case-detail">
      {error ? <p className="website-state website-error">{error}</p> : null}
      <section className="case-hero">
        <Link href={`/${locale}/research`} className="case-back">
          ← {sq ? "Kthehu te Newsroom" : "Back to Newsroom"}
        </Link>
        <p className="eyebrow">
          {sq ? "Rast kërkimi" : "Research case"} · {String(c.status)}
        </p>
        <h1>{String(c.title)}</h1>
        <p>{String(c.topic)}</p>
        {display(c.notes) ? <p>{String(c.notes)}</p> : null}
        <ol
          className="case-journey"
          aria-label={sq ? "Rrjedha editoriale" : "Editorial journey"}
        >
          <li>{sq ? "Burime" : "Sources"}</li>
          <li>{sq ? "Pretendime" : "Claims"}</li>
          <li>{sq ? "Prova" : "Evidence"}</li>
          <li>{sq ? "Draft" : "Draft"}</li>
          <li>{sq ? "Miratim" : "Approval"}</li>
        </ol>
      </section>
      <section className="source-intake">
        <header className="source-intake-heading">
          <div>
            <p className="eyebrow">News Intake</p>
            <h2>Mblidh materiale reale</h2>
            <p>
              URL dhe RSS/Atom përpunohen në sfond, deduplikohen dhe ruhen me
              burimin e plotë. Asgjë nuk bëhet lajm ose postim pa u zgjedhur nga
              redaktori.
            </p>
          </div>
          <span className={`intake-status ${processing ? "is-active" : ""}`}>
            {processing ? "Duke përpunuar…" : "Gati"}
          </span>
        </header>
        <div className="source-intake-grid">
          <form
            className="source-intake-card"
            action={async (form) =>
              post("discovery", {
                workspaceId,
                caseId,
                method: "manual",
                url: form.get("url"),
                idempotencyKey: `manual-${caseId}-${Date.now()}`,
              })
            }
          >
            <strong>Një artikull</strong>
            <small>Vendos adresën HTTPS të artikullit origjinal.</small>
            <input
              name="url"
              type="url"
              pattern="https://.*"
              placeholder="https://media.example/artikulli"
              required
            />
            <button disabled={busy}>Merr dhe analizo</button>
          </form>
          <form
            className="source-intake-card"
            action={async (form) =>
              post("feeds", {
                workspaceId,
                sourceId: form.get("sourceId"),
                feedUrl: form.get("feedUrl"),
              })
            }
          >
            <strong>Burim RSS / Atom</strong>
            <small>Zgjidh burimin editorial dhe adresën e feed-it.</small>
            <select name="sourceId" required defaultValue="">
              <option value="" disabled>
                Zgjidh një burim feed
              </option>
              {feedSources.map((source) => (
                <option key={String(source.id)} value={String(source.id)}>
                  {String(source.name)}
                </option>
              ))}
            </select>
            <input
              name="feedUrl"
              type="url"
              pattern="https://.*"
              placeholder="https://media.example/feed.xml"
              required
            />
            <button disabled={busy || feedSources.length === 0}>
              Shto feed-in
            </button>
            {feedSources.length === 0 ? (
              <small className="website-error">
                Shto fillimisht një burim të tipit RSS/Atom te Source Registry.
              </small>
            ) : null}
          </form>
          <div className="source-intake-card is-muted">
            <strong>Kërkim në web</strong>
            <small>
              Aktivizohet vetëm kur lidhet një provider real me provenance dhe
              kontroll kostoje. Nuk përdorim rezultate sintetike si lajme.
            </small>
            <span className="intake-status">Pa provider</span>
          </div>
        </div>
        {feeds.length ? <h3>Feed-e të gatshme</h3> : null}
        {feeds.map((feed) => (
          <article className="source-run" key={String(feed.id)}>
            <strong>{String(feed.feedUrl)}</strong>
            <span>
              {display(feed.lastStatus)} {display(feed.lastError)}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void post("discovery", {
                  workspaceId,
                  caseId,
                  method: "rss",
                  feedId: feed.id,
                  idempotencyKey: `rss-${String(feed.id)}-${Date.now()}`,
                })
              }
            >
              Merr lajmet e fundit
            </button>
          </article>
        ))}
        {runs.length ? <h3>Aktiviteti i fundit</h3> : null}
        {runs.map((run) => (
          <article className="source-run" key={String(run.id)}>
            <strong>
              {run.method === "manual" ? "URL" : "RSS"} · {String(run.status)}
            </strong>
            <p>{display(run.query) || display(run.requestedUrl)}</p>
            {run.errorCode ? (
              <p className="website-error">
                {display(run.errorCode)}: {display(run.errorDetail)}
              </p>
            ) : null}
            {((run.results ?? []) as Row[]).map((result) => (
              <label key={String(result.id)}>
                <input
                  type="checkbox"
                  name={`result-${String(run.id)}`}
                  value={String(result.id)}
                />
                <b>{String(result.title)}</b> — {String(result.publisher)} ·{" "}
                {display(result.publicationAt) ||
                  display(result.retrievedAt) ||
                  "time unavailable"}
                <small>{String(result.snippet)}</small>
              </label>
            ))}
            {run.status === "succeeded" ? (
              <button
                disabled={busy}
                onClick={() => {
                  const selected = [
                    ...document.querySelectorAll<HTMLInputElement>(
                      `input[name="result-${String(run.id)}"]:checked`,
                    ),
                  ].map((item) => item.value);
                  if (selected.length)
                    void post(`discovery/${String(run.id)}/attach`, {
                      caseId,
                      resultIds: selected,
                    });
                }}
              >
                Bashkëngjit të zgjedhurat
              </button>
            ) : null}
            {run.status === "pending" || run.status === "running" ? (
              <button
                disabled={busy}
                onClick={() =>
                  void post(`discovery/${String(run.id)}/cancel`, {})
                }
              >
                Anulo
              </button>
            ) : null}
          </article>
        ))}
      </section>
      <section>
        <header className="case-section-heading">
          <span>02</span>
          <div>
            <h2>{sq ? "Burimet dhe origjina" : "Sources and provenance"}</h2>
            <p>
              {sq
                ? "Çdo material ruan origjinën e tij; asgjë nuk konsiderohet fakt pa vlerësim editorial."
                : "Every item keeps its origin; nothing is treated as fact without editorial assessment."}
            </p>
          </div>
        </header>
        <form
          action={async (f) =>
            post(`cases/${caseId}/sources`, {
              workspaceId,
              registrySourceId: f.get("registrySourceId") || undefined,
              sourceRef: f.get("sourceRef"),
              title: f.get("title"),
              publisher: f.get("publisher"),
              retrievedAt: new Date().toISOString(),
              sourceType: "website",
              tier: f.get("tier"),
              provenance: {
                method: "manual",
                recordedAt: new Date().toISOString(),
                externalContentTrusted: false,
              },
            })
          }
        >
          <label>
            {sq ? "Burimi i regjistruar" : "Registered source"}
            <select name="registrySourceId" defaultValue="">
              <option value="">
                {sq ? "Burim i ri manual" : "New manual source"}
              </option>
              {registrySources.map((source) => (
                <option key={String(source.id)} value={String(source.id)}>
                  {String(source.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {sq ? "URL / referenca" : "URL / reference"}
            <input name="sourceRef" placeholder="https://…" required />
          </label>
          <label>
            {sq ? "Titulli" : "Title"}
            <input name="title" required />
          </label>
          <label>
            {sq ? "Botuesi" : "Publisher"}
            <input name="publisher" />
          </label>
          <label>
            {sq ? "Niveli i besueshmërisë" : "Trust tier"}
            <select name="tier">
              <option value="primary">Primary</option>
              <option value="strong_reporting">Strong reporting</option>
              <option value="discovery">Discovery</option>
            </select>
          </label>
          <button>{sq ? "Bashkëngjit burimin" : "Attach source"}</button>
        </form>
        {sources.map((s) => (
          <article key={String(s.id)}>
            <strong>{String(s.title)}</strong>
            <p>
              {String(s.publisher)} · {String(s.tier)}
            </p>
            <a href={String(s.sourceRef)} target="_blank" rel="noreferrer">
              {sq ? "Hap burimin" : "Open source"}
            </a>
          </article>
        ))}
      </section>
      <section>
        <header className="case-section-heading">
          <span>03</span>
          <div>
            <h2>{sq ? "Pretendimet dhe provat" : "Claims and evidence"}</h2>
            <p>
              {sq
                ? "Shkruaj pretendimin faktik, pastaj lidhe me burimet që e mbështesin ose e kundërshtojnë."
                : "Write the factual claim, then link the sources that support or contradict it."}
            </p>
          </div>
        </header>
        <form
          action={async (f) =>
            post(`cases/${caseId}/claims`, {
              workspaceId,
              statement: f.get("statement"),
              importance: f.get("importance"),
              verificationState: f.get("state"),
              verificationExplanation: f.get("explanation"),
            })
          }
        >
          <label className="form-wide">
            {sq ? "Pretendimi faktik" : "Factual claim"}
            <textarea name="statement" required />
          </label>
          <label>
            {sq ? "Rëndësia" : "Importance"}
            <select name="importance">
              <option>high</option>
              <option>critical</option>
              <option>medium</option>
              <option>low</option>
            </select>
          </label>
          <label>
            {sq ? "Gjendja e verifikimit" : "Verification state"}
            <select name="state">
              <option>unverified</option>
              <option>developing</option>
              <option>partially_verified</option>
              <option>verified</option>
              <option>conflicting</option>
              <option>stale</option>
            </select>
          </label>
          <label className="form-wide">
            {sq ? "Arsyetimi" : "Reasoning"}
            <textarea name="explanation" required />
          </label>
          <button>{sq ? "Shto pretendimin" : "Add claim"}</button>
        </form>
        <form
          action={async (f) =>
            post(`cases/${caseId}/evidence`, {
              workspaceId,
              claimId: f.get("claimId"),
              caseSourceId: f.get("caseSourceId"),
              relationship: f.get("relationship"),
              notes: f.get("notes"),
            })
          }
        >
          <label>
            {sq ? "Pretendimi" : "Claim"}
            <select name="claimId" required defaultValue="">
              <option value="" disabled>
                {sq ? "Zgjidh pretendimin" : "Choose claim"}
              </option>
              {claims.map((claim) => (
                <option key={String(claim.id)} value={String(claim.id)}>
                  {String(claim.statement)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {sq ? "Burimi" : "Source"}
            <select name="caseSourceId" required defaultValue="">
              <option value="" disabled>
                {sq ? "Zgjidh burimin" : "Choose source"}
              </option>
              {sources.map((source) => (
                <option key={String(source.id)} value={String(source.id)}>
                  {String(source.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {sq ? "Marrëdhënia" : "Relationship"}
            <select name="relationship">
              <option>supports</option>
              <option>contradicts</option>
              <option>mentions</option>
              <option>primary_evidence</option>
            </select>
          </label>
          <label>
            {sq ? "Shënim" : "Note"}
            <input name="notes" />
          </label>
          <button disabled={claims.length === 0 || sources.length === 0}>
            {sq ? "Lidh provën" : "Link evidence"}
          </button>
        </form>
        {claims.map((cl) => (
          <article key={String(cl.id)}>
            <strong>{String(cl.statement)}</strong>
            <p>
              <b>{String(cl.verificationState)}</b> —{" "}
              {String(cl.verificationExplanation)}
            </p>
            <ul>
              {(cl.evidence as Row[]).map((e) => (
                <li key={String(e.id)}>
                  {String(e.relationship)}: {String(e.notes)}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <section>
        <header className="case-section-heading">
          <span>04</span>
          <div>
            <h2>
              {sq
                ? "Analiza dhe drafti editorial"
                : "Analysis and editorial draft"}
            </h2>
            <p>
              {sq
                ? "AI propozon; redaktori pranon provat dhe një person tjetër miraton draftin."
                : "AI proposes; an editor accepts evidence and a different person approves the draft."}
            </p>
          </div>
        </header>
        <p>
          {sq
            ? "Çdo rezultat i AI është propozim. Teksti i burimit mbetet i paverifikuar derisa redaktori ta vlerësojë."
            : "AI output is always a proposal. Source text remains untrusted until an editor assesses it."}
        </p>
        <div className="research-actions">
          <button
            onClick={() =>
              void post(`cases/${caseId}/intelligence/extract`, {
                workspaceId,
                idempotencyKey: `extract-${caseId}-${Date.now()}`,
              })
            }
          >
            {sq ? "Nxirr pretendime" : "Extract claims"}
          </button>
          <button
            onClick={() =>
              void post(`cases/${caseId}/intelligence/compare`, {
                workspaceId,
                idempotencyKey: `compare-${caseId}-${Date.now()}`,
              })
            }
          >
            {sq ? "Krahaso provat" : "Compare evidence"}
          </button>
          <button
            onClick={() =>
              void post(`cases/${caseId}/evidence-packs`, { workspaceId })
            }
          >
            {sq ? "Ndërto paketën e provave" : "Build approved Evidence Pack"}
          </button>
        </div>
        <p>
          {sq ? "Përdorimi:" : "Usage:"}{" "}
          {display((intelligence.usage as Row | undefined)?.inputTokens) || "0"}{" "}
          input /{" "}
          {display((intelligence.usage as Row | undefined)?.outputTokens) ||
            "0"}{" "}
          output tokens · cost{" "}
          {display((intelligence.usage as Row | undefined)?.cost) || "0"}
        </p>
        {((intelligence.runs ?? []) as Row[]).map((run) => (
          <article key={String(run.id)}>
            <strong>
              {String(run.operation)} · {String(run.status)}
            </strong>
            <p>
              {String(run.providerId)} / {String(run.model)} · prompt{" "}
              {String(run.promptVersion)}
            </p>
            {run.safeError ? (
              <p className="website-error">{display(run.safeError)}</p>
            ) : null}
          </article>
        ))}
        {((intelligence.claimProposals ?? []) as Row[]).map((proposal) => (
          <article key={String(proposal.id)}>
            <p className="eyebrow">
              Claim proposal · {String(proposal.decision)}
            </p>
            <strong>{String(proposal.statement)}</strong>
            <p>
              {String(proposal.proposedVerificationState)} ·{" "}
              {String(proposal.explanation)}
            </p>
            {proposal.uncertainty ? (
              <p>Uncertainty: {display(proposal.uncertainty)}</p>
            ) : null}
            {proposal.decision === "proposed" ? (
              <div className="research-actions">
                <button
                  onClick={() =>
                    void post(
                      `claim-proposals/${String(proposal.id)}/decision`,
                      { decision: "accepted" },
                    )
                  }
                >
                  Accept
                </button>
                <button
                  onClick={() =>
                    void post(
                      `claim-proposals/${String(proposal.id)}/decision`,
                      { decision: "rejected" },
                    )
                  }
                >
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {((intelligence.evidenceProposals ?? []) as Row[]).map((proposal) => (
          <article key={String(proposal.id)}>
            <strong>
              {String(proposal.relationship)} · {String(proposal.decision)}
            </strong>
            <p>
              Source {String(proposal.caseSourceId)} · {String(proposal.notes)}
            </p>
            {proposal.decision === "proposed" ? (
              <div className="research-actions">
                <button
                  onClick={() =>
                    void post(
                      `evidence-proposals/${String(proposal.id)}/decision`,
                      { decision: "accepted" },
                    )
                  }
                >
                  Accept evidence
                </button>
                <button
                  onClick={() =>
                    void post(
                      `evidence-proposals/${String(proposal.id)}/decision`,
                      { decision: "rejected" },
                    )
                  }
                >
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {((intelligence.evidencePacks ?? []) as Row[]).map((pack) => (
          <article key={String(pack.id)}>
            <strong>Evidence Pack v{String(pack.version)}</strong>
            <p>
              Unresolved conflicts: {String(pack.unresolvedConflicts)} · hash{" "}
              {String(pack.snapshotHash)}
            </p>
            <button
              onClick={() =>
                void post(`cases/${caseId}/syntheses`, {
                  workspaceId,
                  evidencePackId: pack.id,
                  idempotencyKey: `synthesis-${String(pack.id)}`,
                  validationIdempotencyKey: `validation-${String(pack.id)}`,
                })
              }
            >
              {sq ? "Krijo sintezë faktike" : "Generate factual synthesis"}
            </button>
          </article>
        ))}
        {((intelligence.syntheses ?? []) as Row[]).map((synthesis) => {
          const content = synthesis.synthesis as Row;
          return (
            <article key={String(synthesis.id)}>
              <p className="eyebrow">
                Synthesis v{String(synthesis.version)} ·{" "}
                {synthesis.approvalReady ? "approval-ready" : "blocked"}
              </p>
              <h3>{String(content.headline)}</h3>
              <p>{String(content.summary)}</p>
              <pre>{JSON.stringify(synthesis.validation, null, 2)}</pre>
              {synthesis.approvalReady ? (
                <button
                  onClick={() =>
                    void post(`cases/${caseId}/editorial-context-packs`, {
                      workspaceId,
                    })
                  }
                >
                  {sq
                    ? "Përgatit kontekstin editorial"
                    : "Build editorial context"}
                </button>
              ) : null}
              {synthesis.approvalReady && !synthesis.contentItemId ? (
                <button
                  onClick={() =>
                    void post(`syntheses/${String(synthesis.id)}/promote`, {})
                  }
                >
                  {sq ? "Dërgo te Artikujt" : "Promote to Unified Content"}
                </button>
              ) : null}
              {synthesis.contentItemId ? (
                <p>
                  {sq
                    ? "U krijua artikulli në Content."
                    : "Content Item created."}{" "}
                  <Link
                    className="case-next-link"
                    href={contentItemHref(locale, synthesis.contentItemId)}
                  >
                    {sq
                      ? "Vazhdo te Content Studio"
                      : "Continue in Content Studio"}{" "}
                    →
                  </Link>
                </p>
              ) : null}
            </article>
          );
        })}
        {((intelligence.editorialContextPacks ?? []) as Row[]).map((pack) => (
          <article key={String(pack.id)}>
            <strong>Editorial Context Pack v{String(pack.version)}</strong>
            <p>
              Profile revision {String(pack.profileRevisionId)} ·{" "}
              {String(pack.snapshotHash)}
            </p>
            {((intelligence.syntheses ?? []) as Row[])
              .filter((v) => v.approvalReady)
              .slice(0, 1)
              .map((s) => (
                <button
                  key={String(s.id)}
                  onClick={() =>
                    void post(`cases/${caseId}/editorial-drafts`, {
                      workspaceId,
                      synthesisId: s.id,
                      editorialContextPackId: pack.id,
                      idempotencyKey: `editorial-${String(s.id)}-${String(pack.id)}`,
                      validationIdempotencyKey: `editorial-validation-${String(s.id)}-${String(pack.id)}`,
                    })
                  }
                >
                  {sq ? "Krijo draftin editorial" : "Create editorial draft"}
                </button>
              ))}
          </article>
        ))}
        {((intelligence.editorialDrafts ?? []) as Row[]).map((entry) => (
          <EditorialDraftCard
            key={String(entry.id)}
            entry={entry}
            post={post}
            sq={sq}
            locale={locale}
          />
        ))}
      </section>
      <section>
        <header className="case-section-heading">
          <span>05</span>
          <div>
            <h2>{sq ? "Kandidatët editorialë" : "Editorial candidates"}</h2>
            <p>
              {sq
                ? "Rrugë alternative për përmbajtje që është verifikuar manualisht."
                : "An alternative path for content verified manually."}
            </p>
          </div>
        </header>
        <form
          action={async (f) =>
            post(`cases/${caseId}/candidates`, {
              workspaceId,
              title: f.get("title"),
              summary: f.get("summary"),
              ranking: {
                freshness: Number(f.get("freshness")),
                trend: 50,
                publicInterest: 70,
                audienceRelevance: 80,
                reliability: 70,
                evidenceStrength: 70,
                wowFactor: Number(f.get("wowFactor")),
                visualPotential: Number(f.get("visualPotential")),
              },
              rankingExplanation: f.get("explanation"),
              section: f.get("section"),
              eventDate: f.get("eventDate") || undefined,
              recommendationReason: f.get("recommendationReason"),
              verificationState: f.get("verificationState"),
            })
          }
        >
          <label>
            {sq ? "Titulli" : "Title"}
            <input name="title" required />
          </label>
          <label>
            {sq ? "Përmbledhja" : "Summary"}
            <textarea name="summary" />
          </label>
          <label>
            {sq ? "Seksioni" : "Section"}
            <input name="section" />
          </label>
          <label>
            {sq ? "Data e ngjarjes" : "Event date"}
            <input name="eventDate" type="datetime-local" />
          </label>
          <label>
            {sq ? "Gjendja e verifikimit" : "Verification state"}
            <select name="verificationState">
              <option value="unverified">Unverified</option>
              <option value="developing">Developing</option>
              <option value="partially_verified">Partially verified</option>
              <option value="verified">Verified</option>
              <option value="conflicting">Conflicting</option>
              <option value="stale">Stale</option>
            </select>
          </label>
          <label>
            {sq ? "Pse rekomandohet" : "Why recommended"}
            <textarea name="recommendationReason" />
          </label>
          <label>
            {sq ? "Aktualiteti" : "Freshness"}
            <input
              name="freshness"
              type="number"
              min="0"
              max="100"
              defaultValue="70"
            />
          </label>
          <label>
            Wow
            <input
              name="wowFactor"
              type="number"
              min="0"
              max="100"
              defaultValue="50"
              aria-label="Wow factor"
            />
          </label>
          <label>
            {sq ? "Potenciali vizual" : "Visual potential"}
            <input
              name="visualPotential"
              type="number"
              min="0"
              max="100"
              defaultValue="50"
              aria-label="Visual potential"
            />
          </label>
          <label className="form-wide">
            {sq ? "Arsyetimi i prioritizimit" : "Prioritization reasoning"}
            <textarea name="explanation" required />
          </label>
          <button>{sq ? "Krijo kandidatin" : "Create candidate"}</button>
        </form>
        {candidates.map((candidate) => (
          <article key={String(candidate.id)}>
            <strong>{String(candidate.title)}</strong>
            <p>
              {String(candidate.status)} ·{" "}
              {String(candidate.rankingExplanation)}
            </p>
            <p>
              {display(candidate.section) || "Unassigned"} ·{" "}
              {display(candidate.verificationState)} ·{" "}
              {typeof candidate.eventDate === "string"
                ? new Date(candidate.eventDate).toLocaleDateString()
                : "No event date"}
            </p>
            <p>
              {display(candidate.recommendationReason) ||
                "No recommendation rationale"}
            </p>
            <p>
              Public interest{" "}
              {display(
                (candidate.ranking as Row | undefined)?.publicInterest,
              ) || "0"}{" "}
              · Wow{" "}
              {display((candidate.ranking as Row | undefined)?.wowFactor) ||
                "0"}{" "}
              · Visual{" "}
              {display(
                (candidate.ranking as Row | undefined)?.visualPotential,
              ) || "0"}
            </p>
            <div className="research-actions">
              <button
                onClick={() =>
                  void post(`candidates/${String(candidate.id)}/decision`, {
                    decision: "approved",
                  })
                }
              >
                {sq ? "Mirato" : "Approve"}
              </button>
              <button
                onClick={() =>
                  void post(`candidates/${String(candidate.id)}/decision`, {
                    decision: "rejected",
                  })
                }
              >
                {sq ? "Refuzo" : "Reject"}
              </button>
              <button
                onClick={() =>
                  void post(`candidates/${String(candidate.id)}/promote`, {})
                }
              >
                {sq ? "Dërgo te Artikujt" : "Promote to Unified Content"}
              </button>
            </div>
            {typeof candidate.contentItemId === "string" ? (
              <p>
                {sq
                  ? "U krijua artikulli në Content."
                  : "Content Item created."}{" "}
                <Link
                  className="case-next-link"
                  href={contentItemHref(locale, candidate.contentItemId)}
                >
                  {sq
                    ? "Vazhdo te Content Studio"
                    : "Continue in Content Studio"}{" "}
                  →
                </Link>
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
