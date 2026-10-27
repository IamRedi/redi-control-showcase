"use client";

import { useEffect, useState } from "react";

import { localizedLoginHref } from "../../../auth-navigation-contract";
import {
  parseSocialAccounts,
  parseSocialProviders,
  type SocialAccountSummary,
  type SocialProviderSummary,
} from "../../../social-contract";
import { classifyWorkspaceResponse } from "../../../workspace-onboarding-contract";
import { WorkspaceOnboarding } from "../../../workspace-onboarding";

type Locale = "en" | "de" | "sq";

const copy = {
  en: {
    loading: "Loading verified social configuration…",
    signedOut: "Sign in to inspect this media's social accounts.",
    signIn: "Sign in securely",
    unavailable: "Social account data is not available right now.",
    accounts: "Connected accounts",
    empty: "No real social account is connected to this media.",
    providerReadiness: "Provider readiness",
    configured: "Adapter configured",
    blocked: "Real adapter required",
    capabilities: "Declared capabilities",
    read: "Read",
    write: "Write",
    health: "Health",
    connection: "Connection",
    refresh: "Token state",
    expiry: "Token expiry",
    lastSync: "Last synchronization",
    lastPublish: "Last successful publication",
    scopes: "Authorized scopes",
    never: "Never",
    connect: "Connect Meta",
    connectHint:
      "Connection will be enabled only after the real adapter, Meta test app and review evidence are accepted.",
  },
  de: {
    loading: "Geprüfte Social-Konfiguration wird geladen…",
    signedOut: "Anmelden, um die Social-Konten dieses Mediums zu prüfen.",
    signIn: "Sicher anmelden",
    unavailable: "Social-Kontodaten sind derzeit nicht verfügbar.",
    accounts: "Verbundene Konten",
    empty: "Mit diesem Medium ist kein echtes Social-Konto verbunden.",
    providerReadiness: "Provider-Bereitschaft",
    configured: "Adapter konfiguriert",
    blocked: "Echter Adapter erforderlich",
    capabilities: "Deklarierte Funktionen",
    read: "Lesen",
    write: "Schreiben",
    health: "Zustand",
    connection: "Verbindung",
    refresh: "Token-Status",
    expiry: "Token-Ablauf",
    lastSync: "Letzte Synchronisierung",
    lastPublish: "Letzte erfolgreiche Veröffentlichung",
    scopes: "Autorisierte Scopes",
    never: "Nie",
    connect: "Meta verbinden",
    connectHint:
      "Die Verbindung wird erst nach Abnahme des echten Adapters, der Meta-Test-App und der Review-Nachweise aktiviert.",
  },
  sq: {
    loading: "Po ngarkohet konfigurimi social i verifikuar…",
    signedOut: "Hyni për të kontrolluar llogaritë sociale të kësaj mediaje.",
    signIn: "Hyni në mënyrë të sigurt",
    unavailable: "Të dhënat e llogarive sociale nuk janë të disponueshme tani.",
    accounts: "Llogaritë e lidhura",
    empty: "Nuk ka llogari sociale reale të lidhur me këtë media.",
    providerReadiness: "Gatishmëria e provider-it",
    configured: "Adapteri është konfiguruar",
    blocked: "Kërkohet adapteri real",
    capabilities: "Aftësitë e deklaruara",
    read: "Lexim",
    write: "Shkrim",
    health: "Gjendja",
    connection: "Lidhja",
    refresh: "Gjendja e tokenit",
    expiry: "Skadimi i tokenit",
    lastSync: "Sinkronizimi i fundit",
    lastPublish: "Publikimi i fundit i suksesshëm",
    scopes: "Scopes të autorizuara",
    never: "Asnjëherë",
    connect: "Lidh Meta",
    connectHint:
      "Lidhja aktivizohet vetëm pasi të pranohen adapteri real, Meta test app dhe evidenca e App Review.",
  },
} as const satisfies Record<Locale, Record<string, string>>;

interface OverviewEnvelope {
  readonly workspace?: { readonly id?: unknown };
}

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};

function formatDate(value: string | null, locale: Locale, never: string) {
  if (!value) return never;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function SocialAccountsClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "signed-out" }
    | { readonly status: "workspace-required" }
    | { readonly status: "error" }
    | {
        readonly status: "ready";
        readonly workspaceId: string;
        readonly accounts: readonly SocialAccountSummary[];
        readonly providers: readonly SocialProviderSummary[];
      }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/dashboard/overview", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (overviewResponse) => {
        if (!overviewResponse.ok) {
          const status = classifyWorkspaceResponse(overviewResponse.status);
          if (status !== "unavailable") setState({ status });
          else throw new Error("overview_unavailable");
          return;
        }
        const overview = (await overviewResponse.json()) as OverviewEnvelope;
        const workspaceId = overview.workspace?.id;
        if (typeof workspaceId !== "string")
          throw new Error("invalid_workspace");
        const [accountResponse, providerResponse] = await Promise.all([
          fetch(
            `/api/social/accounts?workspaceId=${encodeURIComponent(workspaceId)}`,
            {
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
            },
          ),
          fetch("/api/social/providers", {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!accountResponse.ok || !providerResponse.ok)
          throw new Error("social_api_unavailable");
        const accounts = parseSocialAccounts(await accountResponse.json());
        const providers = parseSocialProviders(await providerResponse.json());
        if (!accounts || !providers) throw new Error("invalid_social_response");
        setState({ status: "ready", workspaceId, accounts, providers });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status !== "ready")
    return (
      <section className="social-state" role="status">
        {state.status === "workspace-required" ? (
          <WorkspaceOnboarding locale={locale} linkClassName="social-primary" />
        ) : (
          <p>
            {state.status === "loading"
              ? text.loading
              : state.status === "signed-out"
                ? text.signedOut
                : text.unavailable}
          </p>
        )}
        {state.status === "signed-out" ? (
          <a
            className="social-primary"
            href={localizedLoginHref(locale, "/social/accounts")}
          >
            {text.signIn} →
          </a>
        ) : null}
      </section>
    );

  const meta = state.providers.find((provider) => provider.id === "meta");
  const connectMeta = async () => {
    const response = await fetch("/api/social/oauth/meta/start", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf(),
      },
      body: JSON.stringify({
        workspaceId: state.workspaceId,
        postConnectPath: `/${locale}/social/accounts`,
      }),
      cache: "no-store",
    });
    const result = (await response.json()) as { authorizationUrl?: unknown };
    if (response.ok && typeof result.authorizationUrl === "string")
      window.location.assign(result.authorizationUrl);
  };
  return (
    <div className="social-layout">
      <section className="social-panel social-provider-panel">
        <header>
          <div>
            <p className="eyebrow">Meta</p>
            <h2>{text.providerReadiness}</h2>
          </div>
          <strong data-ready={String(Boolean(meta?.configured))}>
            {meta?.configured ? text.configured : text.blocked}
          </strong>
        </header>
        <p>{text.connectHint}</p>
        <button
          className="social-primary"
          type="button"
          disabled={!meta?.configured}
          onClick={() => void connectMeta()}
        >
          {text.connect}
        </button>
      </section>

      <section className="social-panel social-capabilities">
        <header>
          <h2>{text.capabilities}</h2>
          <span>{String(meta?.capabilities.length ?? 0)}</span>
        </header>
        <ul>
          {(meta?.capabilities ?? []).map((capability) => (
            <li key={capability.id}>
              <span>{capability.id}</span>
              <small data-mode={capability.mode}>
                {capability.mode === "read" ? text.read : text.write} ·{" "}
                {capability.risk}
              </small>
            </li>
          ))}
        </ul>
      </section>

      <section className="social-panel social-accounts-panel">
        <header>
          <h2>{text.accounts}</h2>
          <span>{String(state.accounts.length)}</span>
        </header>
        {!state.accounts.length ? (
          <p className="social-empty">{text.empty}</p>
        ) : (
          <div className="social-account-grid">
            {state.accounts.map((account) => (
              <article className="social-account-card" key={account.id}>
                <header>
                  <div>
                    <small>{account.account_type.replaceAll("_", " ")}</small>
                    <h3>{account.display_name}</h3>
                  </div>
                  <strong data-health={account.health_status}>
                    {account.health_status}
                  </strong>
                </header>
                <dl>
                  <div>
                    <dt>{text.connection}</dt>
                    <dd>{account.status}</dd>
                  </div>
                  <div>
                    <dt>{text.refresh}</dt>
                    <dd>{account.refresh_status}</dd>
                  </div>
                  <div>
                    <dt>{text.expiry}</dt>
                    <dd>
                      {formatDate(account.token_expires_at, locale, text.never)}
                    </dd>
                  </div>
                  <div>
                    <dt>{text.lastSync}</dt>
                    <dd>
                      {formatDate(account.last_synced_at, locale, text.never)}
                    </dd>
                  </div>
                  <div>
                    <dt>{text.lastPublish}</dt>
                    <dd>
                      {formatDate(
                        account.last_successful_publish_at,
                        locale,
                        text.never,
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="social-scopes">
                  <span>{text.scopes}</span>
                  <ul>
                    {account.authorized_scopes.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
