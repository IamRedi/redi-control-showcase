"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Locale = "en" | "de" | "sq";
type Client = {
  id: string;
  displayName: string;
  clientIdentifier: string;
  scopes: ["control:read"];
  status: "active" | "revoked";
  createdAt: string;
  expiresAt: string;
  lastExchangedAt: string | null;
  activeTokenCount: number;
  requestCount24h: string;
  requestCount30d: string;
  exchangeCount30d: string;
};
type Snapshot = {
  clients: Client[];
  policy: {
    scope: "control:read";
    accessTokenLifetimeSeconds: number;
    requestLimitPerMinute: number;
    exchangeLimitPerMinute: number;
    writeApiAvailable: false;
  };
};
type Credential = {
  clientIdentifier: string;
  clientSecret: string;
  scope: string;
};

const copy = {
  en: {
    eyebrow: "Installation API",
    title: "API usage & credentials",
    intro:
      "Manage this media's read-only machine access. No credential can select another tenant or publish content.",
    issue: "Issue API client",
    name: "Client name",
    days: "Valid days",
    create: "Create credential",
    clients: "Installation clients",
    empty: "No API clients have been created.",
    requests24h: "Requests · 24h",
    requests30d: "Requests · 30d",
    exchanges30d: "Token exchanges · 30d",
    tokens: "Active tokens",
    rotate: "Rotate secret",
    revoke: "Revoke client",
    rotated: "Rotation revokes every token issued with the previous secret.",
    secretOnce: "Save this secret now. It is shown only once.",
    copy: "Copy",
    close: "I saved it",
    docs: "OpenAPI contract",
    unavailable: "API administration requires owner access and recent MFA.",
    confirmRotate: "Rotate this secret and revoke all currently active tokens?",
    confirmRevoke: "Revoke this client and all currently active tokens?",
    lastUsed: "Last token exchange",
    never: "Never",
  },
  de: {
    eyebrow: "Installations-API",
    title: "API-Nutzung & Zugänge",
    intro:
      "Schreibgeschützten Maschinenzugriff dieser Medieninstanz verwalten. Kein Zugang kann einen anderen Tenant wählen oder Inhalte veröffentlichen.",
    issue: "API-Client ausstellen",
    name: "Client-Name",
    days: "Gültige Tage",
    create: "Zugang erstellen",
    clients: "Installations-Clients",
    empty: "Es wurden noch keine API-Clients erstellt.",
    requests24h: "Anfragen · 24 Std.",
    requests30d: "Anfragen · 30 Tage",
    exchanges30d: "Token-Austausch · 30 Tage",
    tokens: "Aktive Tokens",
    rotate: "Secret rotieren",
    revoke: "Client widerrufen",
    rotated: "Die Rotation widerruft alle Tokens des vorherigen Secrets.",
    secretOnce: "Jetzt sicher speichern. Das Secret wird nur einmal angezeigt.",
    copy: "Kopieren",
    close: "Gespeichert",
    docs: "OpenAPI-Vertrag",
    unavailable: "API-Verwaltung erfordert Owner-Zugriff und aktuelle MFA.",
    confirmRotate: "Secret rotieren und alle aktiven Tokens widerrufen?",
    confirmRevoke: "Client und alle aktiven Tokens widerrufen?",
    lastUsed: "Letzter Token-Austausch",
    never: "Nie",
  },
  sq: {
    eyebrow: "API e instalimit",
    title: "Përdorimi dhe kredencialet API",
    intro:
      "Menaxho aksesin vetëm-lexim të kësaj mediaje. Asnjë kredencial nuk mund të zgjedhë tenant tjetër ose të publikojë përmbajtje.",
    issue: "Krijo klient API",
    name: "Emri i klientit",
    days: "Ditë vlefshmërie",
    create: "Krijo kredencialin",
    clients: "Klientët e instalimit",
    empty: "Nuk është krijuar asnjë klient API.",
    requests24h: "Kërkesa · 24 orë",
    requests30d: "Kërkesa · 30 ditë",
    exchanges30d: "Shkëmbime token-i · 30 ditë",
    tokens: "Token-a aktive",
    rotate: "Rrotullo sekretin",
    revoke: "Revoko klientin",
    rotated: "Rrotullimi revokon çdo token të krijuar me sekretin e vjetër.",
    secretOnce: "Ruaje tani. Sekreti shfaqet vetëm një herë.",
    copy: "Kopjo",
    close: "E ruajta",
    docs: "Kontrata OpenAPI",
    unavailable: "Menaxhimi API kërkon akses pronari dhe MFA të freskët.",
    confirmRotate:
      "Të rrotullohet sekreti dhe të revokohen të gjitha token-at aktive?",
    confirmRevoke: "Të revokohet klienti dhe të gjitha token-at aktive?",
    lastUsed: "Shkëmbimi i fundit i token-it",
    never: "Asnjëherë",
  },
} as const;

const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("redi_csrf="))
      ?.split("=")[1] ?? "",
  );

export function ApiCredentialCenter({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/installation-api/clients", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("api_admin_unavailable");
    setSnapshot((await response.json()) as Snapshot);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError(true));
  }, [refresh]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setCredential(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch("/api/installation-api/clients", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf(),
        },
        body: JSON.stringify({
          displayName: values.get("displayName"),
          lifetimeDays: Number(values.get("lifetimeDays")),
        }),
      });
      if (!response.ok) throw new Error("issue_refused");
      setCredential((await response.json()) as Credential);
      form.reset();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(client: Client) {
    if (!window.confirm(text.confirmRotate)) return;
    setBusy(true);
    setError(false);
    setCredential(null);
    try {
      const response = await fetch(
        `/api/installation-api/clients/${client.id}/rotate`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf(),
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("rotate_refused");
      setCredential((await response.json()) as Credential);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(client: Client) {
    if (!window.confirm(text.confirmRevoke)) return;
    setBusy(true);
    setError(false);
    setCredential(null);
    try {
      const response = await fetch(
        `/api/installation-api/clients/${client.id}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "x-csrf-token": csrf() },
        },
      );
      if (!response.ok) throw new Error("revoke_refused");
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const active =
    snapshot?.clients.filter((client) => client.status === "active") ?? [];
  const sum = (field: keyof Client) =>
    active.reduce((total, client) => total + Number(client[field] ?? 0), 0);

  return (
    <main className="content-page api-center" lang={locale}>
      <header className="websites-header api-center-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
          {text.docs}
        </a>
      </header>

      {error && (
        <p className="website-state website-error">{text.unavailable}</p>
      )}

      {credential && (
        <section className="api-secret" role="status">
          <strong>{text.secretOnce}</strong>
          <div>
            <span>Client ID</span>
            <code>{credential.clientIdentifier}</code>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(credential.clientIdentifier)
              }
            >
              {text.copy}
            </button>
          </div>
          <div>
            <span>Client secret</span>
            <code>{credential.clientSecret}</code>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(credential.clientSecret)
              }
            >
              {text.copy}
            </button>
          </div>
          <small>Scope: {credential.scope}</small>
          <button type="button" onClick={() => setCredential(null)}>
            {text.close}
          </button>
        </section>
      )}

      <section className="api-usage-grid" aria-live="polite">
        <article>
          <span>{text.requests24h}</span>
          <strong>{sum("requestCount24h")}</strong>
        </article>
        <article>
          <span>{text.requests30d}</span>
          <strong>{sum("requestCount30d")}</strong>
        </article>
        <article>
          <span>{text.exchanges30d}</span>
          <strong>{sum("exchangeCount30d")}</strong>
        </article>
        <article>
          <span>{text.tokens}</span>
          <strong>{sum("activeTokenCount")}</strong>
        </article>
      </section>

      <section className="api-center-layout">
        <form
          className="api-issue-form"
          onSubmit={(event) => void issue(event)}
        >
          <div>
            <p className="eyebrow">control:read</p>
            <h2>{text.issue}</h2>
            <p>{text.rotated}</p>
          </div>
          <label>
            {text.name}
            <input name="displayName" minLength={2} maxLength={120} required />
          </label>
          <label>
            {text.days}
            <input
              name="lifetimeDays"
              type="number"
              min="1"
              max="365"
              defaultValue="90"
              required
            />
          </label>
          <button disabled={busy}>{text.create}</button>
        </form>

        <div className="api-client-list">
          <h2>{text.clients}</h2>
          {!snapshot ? (
            <p className="website-state">Loading…</p>
          ) : snapshot.clients.length === 0 ? (
            <p className="website-state">{text.empty}</p>
          ) : (
            snapshot.clients.map((client) => (
              <article key={client.id}>
                <div className="api-client-title">
                  <div>
                    <span className={`api-client-status ${client.status}`}>
                      {client.status}
                    </span>
                    <h3>{client.displayName}</h3>
                    <code>{client.clientIdentifier}</code>
                  </div>
                  <small>
                    {text.lastUsed}:{" "}
                    {client.lastExchangedAt
                      ? new Date(client.lastExchangedAt).toLocaleString(locale)
                      : text.never}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>24h</dt>
                    <dd>{client.requestCount24h}</dd>
                  </div>
                  <div>
                    <dt>30d</dt>
                    <dd>{client.requestCount30d}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>{client.activeTokenCount}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>
                      {new Date(client.expiresAt).toLocaleDateString(locale)}
                    </dd>
                  </div>
                </dl>
                {client.status === "active" && (
                  <div className="api-client-actions">
                    <button disabled={busy} onClick={() => void rotate(client)}>
                      {text.rotate}
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => void revoke(client)}
                    >
                      {text.revoke}
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
