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
    loading: "Loading verified monitoring status…",
    signedOut: "Sign in to open the social monitoring view.",
    signIn: "Sign in securely",
    unavailable: "Social monitoring data is not available right now.",
    connected: "Connected accounts",
    ready: "Read access ready",
    sources: "Data sources",
    performance: "Performance metrics",
    noMetrics: "No verified Meta performance data has been synchronized yet.",
    noMetricsHint:
      "This dashboard will stay empty rather than estimate reach, engagement, followers or comments before the read-only Meta collection is accepted.",
    ai: "AI-ready assessment",
    aiEmpty: "Waiting for a complete, time-bounded metric series.",
    aiHint:
      "When verified data arrives, analysis can compare periods, identify strengths and risks, and link every conclusion back to its source metric.",
    connection: "Connection readiness",
    providerBlocked: "Real Meta read adapter required",
    providerReady: "Meta read adapter configured",
    accountEmpty:
      "No authorized Facebook Page or Instagram Professional account is available to monitor.",
    account: "Account",
    state: "State",
    lastSync: "Last sync",
    never: "Never",
    dataRules: "What AI may use",
    sync: "Synchronize read-only data",
    ruleOne: "Only provider-returned values with a date range.",
    ruleTwo: "No assumed reach, engagement or audience growth.",
    ruleThree: "Messages are excluded; publishing remains unavailable.",
  },
  de: {
    loading: "Verifizierter Monitoring-Status wird geladen…",
    signedOut: "Anmelden, um das Social-Monitoring zu öffnen.",
    signIn: "Sicher anmelden",
    unavailable: "Social-Monitoring-Daten sind derzeit nicht verfügbar.",
    connected: "Verbundene Konten",
    ready: "Lesezugriff bereit",
    sources: "Datenquellen",
    performance: "Leistungsmetriken",
    noMetrics:
      "Es wurden noch keine verifizierten Meta-Leistungsdaten synchronisiert.",
    noMetricsHint:
      "Dieses Dashboard bleibt leer, statt Reichweite, Engagement, Follower oder Kommentare zu schätzen, bevor die schreibgeschützte Meta-Sammlung abgenommen ist.",
    ai: "KI-bereite Bewertung",
    aiEmpty: "Wartet auf eine vollständige, zeitlich begrenzte Metrikreihe.",
    aiHint:
      "Sobald verifizierte Daten vorliegen, kann die Analyse Zeiträume vergleichen, Stärken und Risiken erkennen und jede Schlussfolgerung auf ihre Quellmetrik zurückführen.",
    connection: "Verbindungsbereitschaft",
    providerBlocked: "Echter Meta-Leseadapter erforderlich",
    providerReady: "Meta-Leseadapter konfiguriert",
    accountEmpty:
      "Es ist keine autorisierte Facebook-Seite oder Instagram-Professional-Konto zur Überwachung verfügbar.",
    account: "Konto",
    state: "Status",
    lastSync: "Letzte Synchronisierung",
    never: "Nie",
    dataRules: "Was KI verwenden darf",
    sync: "Schreibgeschützte Daten synchronisieren",
    ruleOne: "Nur Provider-Werte mit Datumsbereich.",
    ruleTwo: "Keine angenommene Reichweite, Engagement oder Follower-Wachstum.",
    ruleThree:
      "Nachrichten sind ausgeschlossen; Veröffentlichung bleibt nicht verfügbar.",
  },
  sq: {
    loading: "Po ngarkohet statusi i verifikuar i monitorimit…",
    signedOut: "Hyni për të hapur pamjen e monitorimit social.",
    signIn: "Hyni në mënyrë të sigurt",
    unavailable:
      "Të dhënat e monitorimit social nuk janë të disponueshme tani.",
    connected: "Llogari të lidhura",
    ready: "Qasja për lexim është gati",
    sources: "Burimet e të dhënave",
    performance: "Statistikat e ecurisë",
    noMetrics:
      "Ende nuk janë sinkronizuar të dhëna të verifikuara të performancës nga Meta.",
    noMetricsHint:
      "Ky dashboard mbetet bosh në vend se të hamendësojë reach, engagement, ndjekës ose komente, derisa mbledhja read-only nga Meta të pranohet.",
    ai: "Vlerësim i gatshëm për AI",
    aiEmpty: "Pret një seri të plotë metrikash me periudhë të përcaktuar.",
    aiHint:
      "Kur të dhënat e verifikuara të vijnë, analiza mund të krahasojë periudhat, të gjejë pikat e forta dhe rreziqet, dhe ta lidhë çdo përfundim me metrikën e burimit.",
    connection: "Gatishmëria e lidhjes",
    providerBlocked: "Kërkohet adapteri real Meta vetëm-për-lexim",
    providerReady: "Adapteri Meta për lexim është konfiguruar",
    accountEmpty:
      "Nuk ka Facebook Page ose llogari Instagram Professional të autorizuar për monitorim.",
    account: "Llogaria",
    state: "Gjendja",
    lastSync: "Sinkronizimi i fundit",
    never: "Asnjëherë",
    dataRules: "Çfarë mund të përdorë AI",
    sync: "Sinkronizo të dhënat vetëm-për-lexim",
    ruleOne: "Vetëm vlera të kthyera nga provider-i me interval date.",
    ruleTwo: "Pa reach, engagement ose rritje ndjekësish të supozuar.",
    ruleThree: "Mesazhet përjashtohen; publikimi mbetet i çaktivizuar.",
  },
} as const satisfies Record<Locale, Record<string, string>>;

interface OverviewEnvelope {
  readonly workspace?: { readonly id?: unknown };
}
interface SocialMetric {
  readonly account_id: string;
  readonly metric_key: string;
  readonly period_end: string;
  readonly value: string;
  readonly collected_at: string;
}

type State =
  | {
      readonly status:
        | "loading"
        | "signed-out"
        | "workspace-required"
        | "error";
    }
  | {
      readonly status: "ready";
      readonly accounts: readonly SocialAccountSummary[];
      readonly meta: SocialProviderSummary | undefined;
      readonly metrics: readonly SocialMetric[];
      readonly workspaceId: string;
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

export function SocialAnalyticsClient({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [state, setState] = useState<State>({ status: "loading" });
  const [syncing, setSyncing] = useState(false);

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
        const [accountResponse, providerResponse, metricResponse] =
          await Promise.all([
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
            fetch(
              `/api/social/metrics?workspaceId=${encodeURIComponent(workspaceId)}`,
              {
                credentials: "include",
                cache: "no-store",
                signal: controller.signal,
              },
            ),
          ]);
        if (!accountResponse.ok || !providerResponse.ok || !metricResponse.ok)
          throw new Error("social_api_unavailable");
        const accounts = parseSocialAccounts(await accountResponse.json());
        const providers = parseSocialProviders(await providerResponse.json());
        if (!accounts || !providers) throw new Error("invalid_social_response");
        const payload = (await metricResponse.json()) as { metrics?: unknown };
        const metrics = Array.isArray(payload.metrics)
          ? payload.metrics.filter(
              (metric): metric is SocialMetric =>
                typeof metric === "object" &&
                metric !== null &&
                typeof (metric as SocialMetric).account_id === "string" &&
                typeof (metric as SocialMetric).metric_key === "string" &&
                typeof (metric as SocialMetric).value === "string" &&
                typeof (metric as SocialMetric).period_end === "string" &&
                typeof (metric as SocialMetric).collected_at === "string",
            )
          : [];
        setState({
          status: "ready",
          accounts,
          meta: providers.find((provider) => provider.id === "meta"),
          metrics,
          workspaceId,
        });
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
            href={localizedLoginHref(locale, "/social/analytics")}
          >
            {text.signIn} →
          </a>
        ) : null}
      </section>
    );

  const monitorableAccounts = state.accounts.filter(
    (account) => account.provider === "meta",
  );
  const healthyAccounts = monitorableAccounts.filter(
    (account) => account.health_status === "healthy",
  );
  const sourceReady = Boolean(state.meta?.configured && healthyAccounts.length);
  const latestMetrics = state.metrics.slice(0, 8);
  const sync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/social/meta/read-sync", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token":
            document.cookie.match(/(?:^|; )redi_csrf=([^;]+)/)?.[1] ?? "",
        },
        body: JSON.stringify({ workspaceId: state.workspaceId }),
      });
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="social-analytics-layout">
      <section className="social-analytics-kpis" aria-label={text.sources}>
        <article>
          <span>{text.connected}</span>
          <strong>{monitorableAccounts.length}</strong>
          <small>{text.sources}</small>
        </article>
        <article data-ready={String(sourceReady)}>
          <span>{text.ready}</span>
          <strong>{healthyAccounts.length}</strong>
          <small>
            {sourceReady ? text.providerReady : text.providerBlocked}
          </small>
        </article>
        <article className="social-analytics-kpi-muted">
          <span>{text.performance}</span>
          <strong>{state.metrics.length || "—"}</strong>
          <small>
            {state.metrics.length ? "Verified observations" : text.noMetrics}
          </small>
        </article>
      </section>

      <section className="social-analytics-panel social-analytics-performance">
        <header>
          <div>
            <p className="eyebrow">Meta</p>
            <h2>{text.performance}</h2>
          </div>
          <span className="social-analytics-source">
            Verified source required
          </span>
          <button
            className="social-primary"
            type="button"
            disabled={!sourceReady || syncing}
            onClick={() => void sync()}
          >
            {syncing ? "…" : text.sync}
          </button>
        </header>
        {latestMetrics.length ? (
          <ul className="social-analytics-metric-list">
            {latestMetrics.map((metric) => (
              <li
                key={`${metric.account_id}-${metric.metric_key}-${metric.period_end}`}
              >
                <span>{metric.metric_key.replaceAll("_", " ")}</span>
                <strong>{metric.value}</strong>
                <small>
                  {formatDate(metric.period_end, locale, text.never)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div
              className="social-analytics-empty-chart"
              aria-label={text.noMetrics}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
            <strong>{text.noMetrics}</strong>
            <p>{text.noMetricsHint}</p>
          </>
        )}
      </section>

      <section className="social-analytics-panel social-analytics-ai">
        <header>
          <div>
            <p className="eyebrow">REDI AI</p>
            <h2>{text.ai}</h2>
          </div>
          <span className="social-analytics-pending">Pending data</span>
        </header>
        <strong>{text.aiEmpty}</strong>
        <p>{text.aiHint}</p>
        <ul>
          <li>{text.ruleOne}</li>
          <li>{text.ruleTwo}</li>
          <li>{text.ruleThree}</li>
        </ul>
      </section>

      <section className="social-analytics-panel social-analytics-accounts">
        <header>
          <div>
            <p className="eyebrow">Meta</p>
            <h2>{text.connection}</h2>
          </div>
          <span>{monitorableAccounts.length}</span>
        </header>
        {monitorableAccounts.length ? (
          <div className="social-analytics-account-list">
            {monitorableAccounts.map((account) => (
              <article key={account.id}>
                <div>
                  <small>{account.account_type.replaceAll("_", " ")}</small>
                  <strong>{account.display_name}</strong>
                </div>
                <dl>
                  <div>
                    <dt>{text.state}</dt>
                    <dd>{account.health_status}</dd>
                  </div>
                  <div>
                    <dt>{text.lastSync}</dt>
                    <dd>
                      {formatDate(account.last_synced_at, locale, text.never)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="social-empty">{text.accountEmpty}</p>
        )}
      </section>
    </div>
  );
}
