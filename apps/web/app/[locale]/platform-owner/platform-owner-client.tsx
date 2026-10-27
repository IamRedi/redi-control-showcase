"use client";

import { useCallback, useState, type FormEvent } from "react";

import type { PlatformInventory } from "../../platform-owner-contract";

type Locale = "en" | "de" | "sq";
const copy = {
  en: {
    eyebrow: "Platform governance",
    title: "Platform Owner Console",
    intro:
      "Global inventory and safe tenant-shell operations. No account impersonation.",
    unlock: "Open time-limited access",
    reason: "Reason for access",
    duration: "Minutes",
    open: "Open console",
    denied: "Access was refused. Root Owner, recent MFA and CSRF are required.",
    inventory: "Tenant inventory",
    provision: "Provision tenant shell",
    pending: "Independent approvals",
    tenantName: "Tenant name",
    tenantSlug: "Tenant slug",
    installationName: "Installation name",
    installationSlug: "Installation slug",
    workspaceName: "Workspace name",
    region: "Data region",
    create: "Create pending shell",
    lifecycle: "Lifecycle",
    suspend: "Suspend",
    reactivate: "Reactivate",
    deletion: "Request deletion",
    requestReason: "Reason for lifecycle action",
    request: "Request action",
    approve: "Execute approval",
    self: "A different Root Owner must execute this request.",
    empty: "No pending requests.",
    refresh: "Refresh",
    setup: "SaaS setup",
    setupDescription:
      "Apply a server-governed media package. Owner, domain and providers remain pending.",
    package: "Package",
    defaultLanguage: "Default language",
    languages: "Enabled languages",
    accent: "Brand accent",
    applyPackage: "Apply package",
    awaitingOwner: "Configured · awaiting owner and domain",
    apiAccess: "Customer API",
    apiDescription:
      "Issue an installation-bound, read-only machine identity. The secret is shown once.",
    apiName: "Client name",
    apiDays: "Valid days",
    issueApi: "Issue credential",
    revokeApi: "Revoke",
    secretOnce: "Save this credential now. The secret cannot be shown again.",
    noApiClients: "No API clients.",
    confirmApi: "Revoke this client and all of its active tokens?",
    onboarding: "Customer onboarding",
    onboardingDescription:
      "Activation checklist and first-owner handoff. Domain and installation activation remain external approval gates.",
    packageReady: "SaaS package",
    installationReady: "Installation",
    domainReady: "Canonical domain",
    ownerReady: "Customer owner",
    readyToInvite: "Ready for owner invitation",
    ownerActive: "Owner active",
    ownerEmail: "Verified owner email",
    inviteHours: "Valid hours",
    inviteOwner: "Create owner invitation",
    revokeInvite: "Revoke invitation",
    tokenOnce:
      "Deliver this one-time invitation token out-of-band. It cannot be shown again.",
    blocked: "Blocked by",
    confirmInviteRevoke: "Revoke this pending owner invitation?",
  },
  de: {
    eyebrow: "Plattform-Governance",
    title: "Platform Owner Console",
    intro:
      "Globales Inventar und sichere Tenant-Shell-Aktionen. Keine Konto-Imitation.",
    unlock: "Zeitlich begrenzten Zugriff öffnen",
    reason: "Zugriffsgrund",
    duration: "Minuten",
    open: "Konsole öffnen",
    denied:
      "Zugriff verweigert. Root Owner, aktuelle MFA und CSRF sind erforderlich.",
    inventory: "Tenant-Inventar",
    provision: "Tenant-Shell bereitstellen",
    pending: "Unabhängige Freigaben",
    tenantName: "Tenant-Name",
    tenantSlug: "Tenant-Slug",
    installationName: "Installationsname",
    installationSlug: "Installations-Slug",
    workspaceName: "Workspace-Name",
    region: "Datenregion",
    create: "Ausstehende Shell erstellen",
    lifecycle: "Lebenszyklus",
    suspend: "Sperren",
    reactivate: "Reaktivieren",
    deletion: "Löschung beantragen",
    requestReason: "Grund der Aktion",
    request: "Aktion beantragen",
    approve: "Freigabe ausführen",
    self: "Ein anderer Root Owner muss diese Anfrage ausführen.",
    empty: "Keine offenen Anfragen.",
    refresh: "Aktualisieren",
    setup: "SaaS-Einrichtung",
    setupDescription:
      "Server-gesteuertes Medienpaket anwenden. Owner, Domain und Provider bleiben ausstehend.",
    package: "Paket",
    defaultLanguage: "Standardsprache",
    languages: "Aktive Sprachen",
    accent: "Marken-Akzent",
    applyPackage: "Paket anwenden",
    awaitingOwner: "Konfiguriert · Owner und Domain ausstehend",
    apiAccess: "Kunden-API",
    apiDescription:
      "Installationsgebundene, schreibgeschützte Maschinenidentität. Das Secret wird einmal angezeigt.",
    apiName: "Client-Name",
    apiDays: "Gültige Tage",
    issueApi: "Zugang ausstellen",
    revokeApi: "Widerrufen",
    secretOnce:
      "Jetzt sicher speichern. Das Secret wird nicht erneut angezeigt.",
    noApiClients: "Keine API-Clients.",
    confirmApi: "Diesen Client und alle aktiven Tokens widerrufen?",
    onboarding: "Kunden-Onboarding",
    onboardingDescription:
      "Aktivierungscheckliste und Übergabe an den ersten Owner. Domain- und Installationsaktivierung bleiben externe Freigaben.",
    packageReady: "SaaS-Paket",
    installationReady: "Installation",
    domainReady: "Kanonische Domain",
    ownerReady: "Kunden-Owner",
    readyToInvite: "Bereit für Owner-Einladung",
    ownerActive: "Owner aktiv",
    ownerEmail: "Verifizierte Owner-E-Mail",
    inviteHours: "Gültige Stunden",
    inviteOwner: "Owner-Einladung erstellen",
    revokeInvite: "Einladung widerrufen",
    tokenOnce:
      "Dieses einmalige Einladungstoken getrennt übermitteln. Es wird nicht erneut angezeigt.",
    blocked: "Blockiert durch",
    confirmInviteRevoke: "Diese offene Owner-Einladung widerrufen?",
  },
  sq: {
    eyebrow: "Qeverisja e platformës",
    title: "Paneli i pronarit të platformës",
    intro:
      "Inventar global dhe veprime të sigurta mbi tenant shell. Pa hyrje si përdorues tjetër.",
    unlock: "Hap akses me kohë të kufizuar",
    reason: "Arsyeja e aksesit",
    duration: "Minuta",
    open: "Hap panelin",
    denied: "Aksesi u refuzua. Kërkohet Root Owner, MFA e freskët dhe CSRF.",
    inventory: "Inventari i tenantëve",
    provision: "Krijo tenant shell",
    pending: "Aprovime të pavarura",
    tenantName: "Emri i tenant-it",
    tenantSlug: "Slug i tenant-it",
    installationName: "Emri i instalimit",
    installationSlug: "Slug i instalimit",
    workspaceName: "Emri i workzone",
    region: "Rajoni i të dhënave",
    create: "Krijo shell në pritje",
    lifecycle: "Cikli i jetës",
    suspend: "Pezullo",
    reactivate: "Riaktivizo",
    deletion: "Kërko fshirje",
    requestReason: "Arsyeja e veprimit",
    request: "Kërko veprimin",
    approve: "Ekzekuto aprovimin",
    self: "Këtë kërkesë duhet ta ekzekutojë një Root Owner tjetër.",
    empty: "Nuk ka kërkesa në pritje.",
    refresh: "Rifresko",
    setup: "Konfigurimi SaaS",
    setupDescription:
      "Apliko paketë media të kontrolluar nga serveri. Pronari, domain-i dhe provider-at mbeten në pritje.",
    package: "Paketa",
    defaultLanguage: "Gjuha kryesore",
    languages: "Gjuhët aktive",
    accent: "Ngjyra e markës",
    applyPackage: "Apliko paketën",
    awaitingOwner: "Konfiguruar · në pritje të pronarit dhe domain-it",
    apiAccess: "API e klientit",
    apiDescription:
      "Krijo identitet vetëm-lexim të lidhur me instalimin. Sekreti shfaqet vetëm një herë.",
    apiName: "Emri i klientit",
    apiDays: "Ditë vlefshmërie",
    issueApi: "Krijo kredencialin",
    revokeApi: "Revoko",
    secretOnce: "Ruaje tani. Sekreti nuk mund të shfaqet përsëri.",
    noApiClients: "Nuk ka klientë API.",
    confirmApi: "Të revokohet ky klient dhe të gjitha token-at aktive?",
    onboarding: "Onboarding i klientit",
    onboardingDescription:
      "Lista e aktivizimit dhe dorëzimi te pronari i parë. Domain-i dhe aktivizimi i instalimit mbeten porta të jashtme aprovimi.",
    packageReady: "Paketa SaaS",
    installationReady: "Instalimi",
    domainReady: "Domain-i kryesor",
    ownerReady: "Pronari i medias",
    readyToInvite: "Gati për ftesën e pronarit",
    ownerActive: "Pronari aktiv",
    ownerEmail: "Email-i i verifikuar i pronarit",
    inviteHours: "Orë vlefshmërie",
    inviteOwner: "Krijo ftesën e pronarit",
    revokeInvite: "Revoko ftesën",
    tokenOnce:
      "Dërgoje këtë token njëpërdorimësh jashtë platformës. Nuk shfaqet përsëri.",
    blocked: "Bllokuar nga",
    confirmInviteRevoke: "Të revokohet kjo ftesë e pronarit?",
  },
} as const;

const csrf = () =>
  document.cookie
    .split("; ")
    .find((item) => item.startsWith("redi_csrf="))
    ?.split("=")[1] ?? "";

export function PlatformOwnerConsole({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [grant, setGrant] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [inventory, setInventory] = useState<PlatformInventory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issuedCredential, setIssuedCredential] = useState<{
    clientIdentifier: string;
    clientSecret: string;
    scope: string;
  } | null>(null);
  const [issuedInvitation, setIssuedInvitation] = useState<{
    invitationToken: string;
    expiresAt: string;
  } | null>(null);

  const headers = useCallback(
    (mutation = false) => ({
      "x-platform-access-grant": grant,
      ...(mutation
        ? { "content-type": "application/json", "x-csrf-token": csrf() }
        : {}),
    }),
    [grant],
  );
  const refresh = useCallback(
    async (activeGrant = grant) => {
      const response = await fetch("/api/platform-owner/tenants", {
        headers: { "x-platform-access-grant": activeGrant },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("inventory_refused");
      setInventory((await response.json()) as PlatformInventory);
    },
    [grant],
  );

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/platform-owner/access", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({
          reason: values.get("reason"),
          lifetimeMinutes: Number(values.get("duration")),
        }),
      });
      if (!response.ok) throw new Error("access_refused");
      const access = (await response.json()) as {
        id: string;
        expiresAt: string;
      };
      setGrant(access.id);
      setExpiresAt(access.expiresAt);
      await refresh(access.id);
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/platform-owner/tenants", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error("provision_refused");
      event.currentTarget.reset();
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(
    tenantId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(
        `/api/platform-owner/tenants/${tenantId}/lifecycle`,
        {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify(values),
        },
      );
      if (!response.ok) throw new Error("lifecycle_refused");
      event.currentTarget.reset();
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function configureTenant(
    tenantId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/platform-owner/tenants/${tenantId}/setup`,
        {
          method: "PUT",
          headers: headers(true),
          body: JSON.stringify({
            templateId: values.get("templateId"),
            defaultLocale: values.get("defaultLocale"),
            enabledLocales: values.getAll("enabledLocales"),
            brandAccent: values.get("brandAccent"),
          }),
        },
      );
      if (!response.ok) throw new Error("setup_refused");
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function execute(requestId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/platform-owner/lifecycle/${requestId}/execute`,
        {
          method: "POST",
          headers: headers(true),
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("approval_refused");
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function issueApiClient(
    tenantId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setIssuedCredential(null);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/platform-owner/tenants/${tenantId}/api-clients`,
        {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({
            displayName: values.get("displayName"),
            lifetimeDays: Number(values.get("lifetimeDays")),
          }),
        },
      );
      if (!response.ok) throw new Error("api_client_refused");
      setIssuedCredential(
        (await response.json()) as {
          clientIdentifier: string;
          clientSecret: string;
          scope: string;
        },
      );
      event.currentTarget.reset();
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function issueOwnerInvitation(
    tenantId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setIssuedInvitation(null);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/platform-owner/tenants/${tenantId}/owner-invitations`,
        {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({
            email: values.get("email"),
            lifetimeHours: Number(values.get("lifetimeHours")),
          }),
        },
      );
      if (!response.ok) throw new Error("owner_invitation_refused");
      setIssuedInvitation(
        (await response.json()) as {
          invitationToken: string;
          expiresAt: string;
        },
      );
      event.currentTarget.reset();
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function revokeOwnerInvitation(invitationId: string) {
    setBusy(true);
    setError("");
    setIssuedInvitation(null);
    try {
      const response = await fetch(
        `/api/platform-owner/owner-invitations/${invitationId}`,
        { method: "DELETE", headers: headers(true) },
      );
      if (!response.ok) throw new Error("owner_invitation_revoke_refused");
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  async function revokeApiClient(clientId: string) {
    setBusy(true);
    setError("");
    setIssuedCredential(null);
    try {
      const response = await fetch(
        `/api/platform-owner/api-clients/${clientId}`,
        { method: "DELETE", headers: headers(true) },
      );
      if (!response.ok) throw new Error("api_client_revoke_refused");
      await refresh();
    } catch {
      setError(text.denied);
    } finally {
      setBusy(false);
    }
  }

  if (!inventory)
    return (
      <main className="platform-owner-shell">
        <section className="platform-owner-gate">
          <p className="platform-owner-eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
          <form onSubmit={(event) => void unlock(event)}>
            <label>
              {text.reason}
              <textarea name="reason" minLength={10} maxLength={500} required />
            </label>
            <label>
              {text.duration}
              <input
                name="duration"
                type="number"
                min="1"
                max="60"
                defaultValue="15"
                required
              />
            </label>
            <button disabled={busy}>{text.open}</button>
          </form>
          {error && (
            <p className="platform-owner-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );

  return (
    <main className="platform-owner-shell">
      <header className="platform-owner-header">
        <div>
          <p className="platform-owner-eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>
        <div className="platform-owner-access">
          <span>Access expires</span>
          <strong>{new Date(expiresAt).toLocaleTimeString(locale)}</strong>
          <button onClick={() => void refresh()} disabled={busy}>
            {text.refresh}
          </button>
        </div>
      </header>
      {error && (
        <p className="platform-owner-error" role="alert">
          {error}
        </p>
      )}
      {issuedCredential && (
        <section className="platform-credential" role="status">
          <strong>{text.secretOnce}</strong>
          <label>
            Client ID
            <code>{issuedCredential.clientIdentifier}</code>
          </label>
          <label>
            Client secret
            <code>{issuedCredential.clientSecret}</code>
          </label>
          <small>Scope: {issuedCredential.scope}</small>
          <button type="button" onClick={() => setIssuedCredential(null)}>
            Close
          </button>
        </section>
      )}
      {issuedInvitation && (
        <section className="platform-credential" role="status">
          <strong>{text.tokenOnce}</strong>
          <label>
            Invitation token
            <code>{issuedInvitation.invitationToken}</code>
          </label>
          <small>
            Expires:{" "}
            {new Date(issuedInvitation.expiresAt).toLocaleString(locale)}
          </small>
          <button type="button" onClick={() => setIssuedInvitation(null)}>
            Close
          </button>
        </section>
      )}
      <section className="platform-owner-grid">
        <div className="platform-owner-main">
          <h2>{text.inventory}</h2>
          <div className="platform-tenant-list">
            {inventory.tenants.map((tenant) => {
              const setup = inventory.tenantSetups.find(
                (item) => item.targetTenantId === tenant.tenantId,
              );
              const onboarding = inventory.onboarding.find(
                (item) => item.targetTenantId === tenant.tenantId,
              );
              return (
                <article key={tenant.tenantId} className="platform-tenant-card">
                  <div>
                    <span
                      className={`platform-status platform-status-${tenant.tenantStatus}`}
                    >
                      {tenant.tenantStatus}
                    </span>
                    <h3>{tenant.displayName}</h3>
                    <code>{tenant.tenantSlug}</code>
                  </div>
                  <dl>
                    <div>
                      <dt>Installation</dt>
                      <dd>{tenant.installationStatus}</dd>
                    </div>
                    <div>
                      <dt>Workzones</dt>
                      <dd>{tenant.workspaceCount}</dd>
                    </div>
                    <div>
                      <dt>Members</dt>
                      <dd>{tenant.memberCount}</dd>
                    </div>
                  </dl>
                  {tenant.installationStatus === "pending" &&
                    tenant.memberCount === 0 && (
                      <details className="platform-setup" open={!setup}>
                        <summary>
                          <strong>{text.setup}</strong>
                          {setup && <span>{text.awaitingOwner}</span>}
                        </summary>
                        <p>{text.setupDescription}</p>
                        <form
                          onSubmit={(event) =>
                            void configureTenant(tenant.tenantId, event)
                          }
                        >
                          <label>
                            {text.package}
                            <select
                              name="templateId"
                              defaultValue={setup?.templateId ?? "media_team"}
                            >
                              {inventory.templates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name} · {template.maximumUsers}{" "}
                                  users ·{" "}
                                  {Math.round(
                                    template.storageQuotaBytes / 1_073_741_824,
                                  )}{" "}
                                  GB
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {text.defaultLanguage}
                            <select
                              name="defaultLocale"
                              defaultValue={setup?.defaultLocale ?? locale}
                            >
                              <option value="sq">Shqip</option>
                              <option value="en">English</option>
                              <option value="de">Deutsch</option>
                            </select>
                          </label>
                          <fieldset>
                            <legend>{text.languages}</legend>
                            {(["sq", "en", "de"] as const).map((language) => (
                              <label key={language}>
                                <input
                                  type="checkbox"
                                  name="enabledLocales"
                                  value={language}
                                  defaultChecked={
                                    setup
                                      ? setup.enabledLocales.includes(language)
                                      : language === locale || language === "en"
                                  }
                                />
                                {language.toUpperCase()}
                              </label>
                            ))}
                          </fieldset>
                          <label>
                            {text.accent}
                            <input
                              name="brandAccent"
                              type="color"
                              defaultValue="#36b7e5"
                              required
                            />
                          </label>
                          <button disabled={busy}>{text.applyPackage}</button>
                        </form>
                      </details>
                    )}
                  {onboarding && (
                    <details
                      className="platform-setup platform-onboarding"
                      open
                    >
                      <summary>
                        <strong>{text.onboarding}</strong>
                        <span>
                          {onboarding.ownerCount > 0
                            ? text.ownerActive
                            : onboarding.invitationEligible
                              ? text.readyToInvite
                              : `${text.blocked}: ${onboarding.blockers.length}`}
                        </span>
                      </summary>
                      <p>{text.onboardingDescription}</p>
                      <ul className="platform-onboarding-checklist">
                        <li
                          data-ready={
                            onboarding.setupStatus !== "not_configured"
                          }
                        >
                          {text.packageReady}
                        </li>
                        <li
                          data-ready={
                            onboarding.installationStatus === "active"
                          }
                        >
                          {text.installationReady} ·{" "}
                          {onboarding.installationStatus}
                        </li>
                        <li data-ready={onboarding.domainStatus === "active"}>
                          {text.domainReady} · {onboarding.domainStatus}
                        </li>
                        <li data-ready={onboarding.ownerCount > 0}>
                          {text.ownerReady} · {onboarding.invitationStatus}
                        </li>
                      </ul>
                      {onboarding.invitationEligible && (
                        <form
                          onSubmit={(event) =>
                            void issueOwnerInvitation(tenant.tenantId, event)
                          }
                        >
                          <label>
                            {text.ownerEmail}
                            <input
                              name="email"
                              type="email"
                              maxLength={320}
                              required
                            />
                          </label>
                          <label>
                            {text.inviteHours}
                            <input
                              name="lifetimeHours"
                              type="number"
                              min="1"
                              max="168"
                              defaultValue="24"
                              required
                            />
                          </label>
                          <button disabled={busy}>{text.inviteOwner}</button>
                        </form>
                      )}
                      {onboarding.invitationStatus === "active" &&
                        onboarding.pendingInvitationId && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(text.confirmInviteRevoke))
                                void revokeOwnerInvitation(
                                  onboarding.pendingInvitationId!,
                                );
                            }}
                          >
                            {text.revokeInvite}
                          </button>
                        )}
                    </details>
                  )}
                  {tenant.installationStatus === "active" &&
                    tenant.memberCount > 0 && (
                      <details className="platform-setup platform-api-access">
                        <summary>
                          <strong>{text.apiAccess}</strong>
                          <span>control:read · 15 min tokens</span>
                        </summary>
                        <p>{text.apiDescription}</p>
                        <form
                          onSubmit={(event) =>
                            void issueApiClient(tenant.tenantId, event)
                          }
                        >
                          <label>
                            {text.apiName}
                            <input
                              name="displayName"
                              minLength={2}
                              maxLength={120}
                              required
                            />
                          </label>
                          <label>
                            {text.apiDays}
                            <input
                              name="lifetimeDays"
                              type="number"
                              min="1"
                              max="365"
                              defaultValue="90"
                              required
                            />
                          </label>
                          <button disabled={busy}>{text.issueApi}</button>
                        </form>
                        <div className="platform-api-list">
                          {inventory.apiClients.filter(
                            (client) =>
                              client.targetTenantId === tenant.tenantId,
                          ).length === 0 ? (
                            <small>{text.noApiClients}</small>
                          ) : (
                            inventory.apiClients
                              .filter(
                                (client) =>
                                  client.targetTenantId === tenant.tenantId,
                              )
                              .map((client) => (
                                <div key={client.id}>
                                  <span>
                                    <strong>{client.displayName}</strong>
                                    <code>{client.clientIdentifier}</code>
                                  </span>
                                  <small>
                                    {client.status} · {client.scopes.join(" ")}{" "}
                                    ·{" "}
                                    {new Date(
                                      client.expiresAt,
                                    ).toLocaleDateString(locale)}
                                  </small>
                                  {client.status === "active" && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        if (window.confirm(text.confirmApi))
                                          void revokeApiClient(client.id);
                                      }}
                                    >
                                      {text.revokeApi}
                                    </button>
                                  )}
                                </div>
                              ))
                          )}
                        </div>
                      </details>
                    )}
                  <form
                    onSubmit={(event) => void lifecycle(tenant.tenantId, event)}
                    className="platform-lifecycle-form"
                  >
                    <select
                      name="action"
                      aria-label={text.lifecycle}
                      defaultValue="suspend"
                    >
                      <option value="suspend">{text.suspend}</option>
                      <option value="reactivate">{text.reactivate}</option>
                      <option value="request_deletion">{text.deletion}</option>
                    </select>
                    <input
                      name="reason"
                      placeholder={text.requestReason}
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                    <button disabled={busy || tenant.pendingLifecycleCount > 0}>
                      {text.request}
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        </div>
        <aside className="platform-owner-side">
          <section>
            <h2>{text.provision}</h2>
            <form
              onSubmit={(event) => void provision(event)}
              className="platform-provision-form"
            >
              <label>
                {text.tenantName}
                <input name="tenantName" required minLength={2} />
              </label>
              <label>
                {text.tenantSlug}
                <input
                  name="tenantSlug"
                  required
                  pattern="[a-z][a-z0-9-]{1,62}"
                />
              </label>
              <label>
                {text.installationName}
                <input name="installationName" required minLength={2} />
              </label>
              <label>
                {text.installationSlug}
                <input
                  name="installationSlug"
                  required
                  pattern="[a-z][a-z0-9-]{1,62}"
                />
              </label>
              <label>
                {text.workspaceName}
                <input name="workspaceName" required minLength={2} />
              </label>
              <label>
                {text.region}
                <select name="dataRegion">
                  <option>DE</option>
                  <option>EU</option>
                </select>
              </label>
              <button disabled={busy}>{text.create}</button>
            </form>
          </section>
          <section>
            <h2>{text.pending}</h2>
            {inventory.lifecycleRequests.filter(
              (item) => item.status === "pending",
            ).length === 0 ? (
              <p>{text.empty}</p>
            ) : (
              inventory.lifecycleRequests
                .filter((item) => item.status === "pending")
                .map((item) => (
                  <article className="platform-approval" key={item.id}>
                    <strong>{item.targetName}</strong>
                    <span>{item.action}</span>
                    <p>{item.reason}</p>
                    {item.requestedByCurrentUser ? (
                      <small>{text.self}</small>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => void execute(item.id)}
                      >
                        {text.approve}
                      </button>
                    )}
                  </article>
                ))
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
