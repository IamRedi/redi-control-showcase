"use client";

import { useEffect, useState } from "react";

interface WebsiteSummary {
  id: string;
  provider: string;
  displayName: string;
  domain: string;
  previewUrl: string | null;
  status: string;
  capabilities: string[];
  healthStatus: string;
  lastSyncedAt: string | null;
  articleStatusSummary: Record<string, number>;
}

interface Copy {
  loading: string;
  empty: string;
  unavailable: string;
  provider: string;
  domain: string;
  status: string;
  health: string;
  capabilities: string;
  articles: string;
  preview: string;
  lastSync: string;
}

function isWebsite(value: unknown): value is WebsiteSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WebsiteSummary>;
  return (
    typeof item.id === "string" &&
    typeof item.displayName === "string" &&
    typeof item.domain === "string" &&
    Array.isArray(item.capabilities) &&
    Boolean(item.articleStatusSummary) &&
    typeof item.articleStatusSummary === "object"
  );
}

export function WebsitesClient({ copy }: { copy: Copy }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; websites: WebsiteSummary[] }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/websites", {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("website_api_unavailable");
        const value = (await response.json()) as { websites?: unknown };
        if (!Array.isArray(value.websites) || !value.websites.every(isWebsite))
          throw new Error("invalid_website_response");
        setState({ status: "ready", websites: value.websites });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading")
    return <p className="website-state">{copy.loading}</p>;
  if (state.status === "error")
    return <p className="website-state website-error">{copy.unavailable}</p>;
  if (!state.websites.length)
    return <p className="website-state">{copy.empty}</p>;

  return (
    <section className="website-grid" aria-live="polite">
      {state.websites.map((website) => (
        <article className="website-card" key={website.id}>
          <div className="website-card-heading">
            <div>
              <span>
                {copy.provider}: {website.provider}
              </span>
              <h2>{website.displayName}</h2>
              <p>
                {copy.domain}: {website.domain}
              </p>
            </div>
            <strong data-status={website.healthStatus}>
              {website.healthStatus}
            </strong>
          </div>
          <dl>
            <div>
              <dt>{copy.status}</dt>
              <dd>{website.status}</dd>
            </div>
            <div>
              <dt>{copy.health}</dt>
              <dd>{website.healthStatus}</dd>
            </div>
            <div>
              <dt>{copy.lastSync}</dt>
              <dd>{website.lastSyncedAt ?? "—"}</dd>
            </div>
            <div>
              <dt>{copy.articles}</dt>
              <dd>
                {Object.entries(website.articleStatusSummary)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(" · ")}
              </dd>
            </div>
          </dl>
          <div className="website-capabilities">
            <span>{copy.capabilities}</span>
            <ul>
              {website.capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </div>
          {website.previewUrl ? (
            <a
              href={website.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="website-open"
            >
              {copy.preview}
            </a>
          ) : null}
        </article>
      ))}
    </section>
  );
}
