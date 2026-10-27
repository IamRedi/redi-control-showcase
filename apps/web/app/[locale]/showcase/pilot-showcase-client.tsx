"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { localizedLoginHref } from "../../auth-navigation-contract";
import {
  parsePilotOverview,
  type PilotChannelName,
  type PilotOverview,
} from "../../pilot-showcase-contract";
import {
  classifyWorkspaceResponse,
  workspaceRequiredLabel,
} from "../../workspace-onboarding-contract";
import { WorkspaceOnboarding } from "../../workspace-onboarding";
import type { PilotShowcaseCopy } from "./page";

type Locale = "en" | "de" | "sq";
type State =
  | "loading"
  | "ready"
  | "signed-out"
  | "workspace-required"
  | "unavailable";

const channelLabels: Record<PilotChannelName, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  email: "Email",
  whatsapp: "WhatsApp",
};

type FeaturedChannelName = "website" | "facebook" | "instagram";

const featuredChannels = new Set<FeaturedChannelName>([
  "website",
  "facebook",
  "instagram",
]);

function isFeaturedChannel(
  channel: PilotOverview["channels"][number],
): channel is PilotOverview["channels"][number] & {
  readonly name: FeaturedChannelName;
} {
  return featuredChannels.has(channel.name as FeaturedChannelName);
}

export function PilotShowcaseClient({
  copy,
  locale,
}: {
  readonly copy: PilotShowcaseCopy;
  readonly locale: Locale;
}) {
  const [overview, setOverview] = useState<PilotOverview | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/dashboard/overview", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setState(classifyWorkspaceResponse(response.status));
          return;
        }
        const parsed = parsePilotOverview(await response.json());
        if (!parsed) {
          setState("unavailable");
          return;
        }
        setOverview(parsed);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState("unavailable");
      });
    return () => controller.abort();
  }, []);

  const home = `/${locale}`;
  const featured = overview?.channels.filter(isFeaturedChannel) ?? [];
  const stateMessage =
    state === "loading"
      ? copy.loading
      : state === "signed-out"
        ? copy.signedOut
        : state === "workspace-required"
          ? workspaceRequiredLabel(locale)
          : copy.unavailable;

  return (
    <main className="pilot-showcase" lang={locale}>
      <header className="pilot-hero">
        <div className="pilot-hero-copy">
          <p className="pilot-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="pilot-actions">
            <Link className="pilot-primary" href={`${home}/research`}>
              {copy.openNewsroom}
            </Link>
            <Link href={`${home}/content`}>{copy.openContent}</Link>
            <Link href={`${home}/social/accounts`}>{copy.openSocial}</Link>
          </div>
        </div>
        <aside className="pilot-proof" aria-live="polite">
          <span data-state={state}>● {copy.verified}</span>
          {overview ? (
            <>
              <small>{copy.liveSnapshot}</small>
              <strong>{overview.workspace.displayName}</strong>
              <dl>
                <div>
                  <dt>{copy.readyMedia}</dt>
                  <dd>{overview.counts.readyMedia}</dd>
                </div>
                <div>
                  <dt>{copy.drafts}</dt>
                  <dd>{overview.counts.draftPosts}</dd>
                </div>
                <div>
                  <dt>{copy.approvals}</dt>
                  <dd>{overview.counts.pendingApprovals}</dd>
                </div>
                <div>
                  <dt>{copy.scheduled}</dt>
                  <dd>{overview.counts.scheduledPosts}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="pilot-state" role="status">
              <p>{stateMessage}</p>
              {state === "workspace-required" ? (
                <WorkspaceOnboarding locale={locale} />
              ) : null}
              {state === "signed-out" ? (
                <a href={localizedLoginHref(locale)}>{copy.signIn} →</a>
              ) : null}
            </div>
          )}
        </aside>
      </header>

      <section className="pilot-section" aria-labelledby="pilot-workflow-title">
        <div className="pilot-section-heading">
          <p>{copy.eyebrow}</p>
          <h2 id="pilot-workflow-title">{copy.workflow}</h2>
          <span>{copy.workflowBody}</span>
        </div>
        <ol className="pilot-workflow">
          {copy.steps.map(([number, title, body]) => (
            <li key={number}>
              <small>{number}</small>
              <strong>{title}</strong>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pilot-section" aria-labelledby="pilot-channels-title">
        <div className="pilot-section-heading">
          <p>{copy.liveSnapshot}</p>
          <h2 id="pilot-channels-title">{copy.channels}</h2>
          <span>{copy.channelsBody}</span>
        </div>
        {featured.length ? (
          <div className="pilot-channels">
            {featured.map((channel) => (
              <article key={channel.name}>
                <div>
                  <span aria-hidden="true">
                    {channel.name === "website"
                      ? "◫"
                      : channel.name === "facebook"
                        ? "f"
                        : "◎"}
                  </span>
                  <p>
                    <strong>{channelLabels[channel.name]}</strong>
                    <small data-channel-status={channel.status}>
                      {copy.status[channel.status]}
                    </small>
                  </p>
                </div>
                <p>{copy.channelCopy[channel.name]}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="pilot-empty">{copy.noChannel}</p>
        )}
      </section>

      <section
        className="pilot-section pilot-saas"
        aria-labelledby="pilot-saas-title"
      >
        <div className="pilot-section-heading">
          <p>SaaS</p>
          <h2 id="pilot-saas-title">{copy.saas}</h2>
          <span>{copy.saasBody}</span>
        </div>
        <div className="pilot-saas-grid">
          {copy.saasCards.map(([title, body]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="pilot-footer">
        <p>{copy.safety}</p>
        <Link href={home}>{copy.openDashboard} →</Link>
      </footer>
    </main>
  );
}
