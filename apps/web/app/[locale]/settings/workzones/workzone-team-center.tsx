"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";

import {
  parseWorkzoneProvisioningSnapshot,
  parseWorkzoneLifecycleImpact,
  type WorkzoneLifecycleImpact,
  type WorkzoneProvisioningSnapshot,
  type WorkzoneResponsibility,
} from "../../../workzone-provisioning-contract";

type Locale = "en" | "de" | "sq";
type Responsibility = WorkzoneResponsibility;

const responsibilities: Responsibility[] = [
  "lead",
  "editorial",
  "approval",
  "research",
  "social",
  "operations",
];
const copy = {
  en: {
    eyebrow: "Media administration",
    title: "Workzones & team",
    intro:
      "Create focused desks inside this media and assign operational responsibility to verified members.",
    boundary:
      "Workzone assignments organize responsibility. Security permissions remain tenant-wide in People & roles.",
    capacity: "Workzone capacity",
    active: "Active",
    archived: "Archived",
    members: "Verified members",
    create: "Create workzone",
    slug: "Stable slug",
    name: "Workzone name",
    description: "Purpose and scope",
    add: "Add workzone",
    limit: "The package workzone limit is reached.",
    team: "Assigned team",
    assigned: "assigned",
    noTeam: "No team responsibility assigned yet.",
    person: "Member",
    responsibility: "Operational responsibility",
    assign: "Assign member",
    remove: "Remove",
    save: "Save profile",
    error: "Workzone administration requires owner access and recent MFA.",
    saved: "Changes saved.",
    loading: "Loading workzones…",
    lifecycle: "Lifecycle impact preview",
    previewOnly: "Safe lifecycle",
    lifecycleIntro:
      "Archive is reversible and preserves records. Hard delete remains unavailable.",
    reason: "Reason (required)",
    reasonPlaceholder: "Explain why this lifecycle change is needed",
    archive: "Archive workzone",
    restore: "Restore workzone",
    deleteUnavailable: "Hard delete is unavailable",
    lifecycleReady: "This change is ready.",
    lifecycleBlocked: "Resolve the active blockers before archiving.",
    impactLoading: "Evaluating current references…",
    impactError: "The lifecycle preview could not be verified.",
    blocking: "Blocking reference rows",
    informational: "Informational reference rows",
    blockers: {
      active_uploads: "Active uploads",
      active_oauth: "Active OAuth handshakes",
      active_delivery: "Active delivery",
      last_active_workzone: "Last active workzone",
    },
    dependencyKind: { blocking: "Blocking", informational: "Informational" },
    dependencies: {
      publishing_delivery: "Publishing, delivery & connections",
      editorial_content: "Editorial content",
      research_evidence: "Research & evidence",
      ai_governance: "AI governance",
      tenant_setup: "Tenant setup",
      team_assignments: "Team assignments",
      personal_saved_views: "Personal saved views",
    },
    responsibilities: {
      lead: "Lead",
      editorial: "Editorial",
      approval: "Approval",
      research: "Research",
      social: "Social",
      operations: "Operations",
    },
  },
  de: {
    eyebrow: "Medienverwaltung",
    title: "Workzones & Team",
    intro:
      "Fokussierte Ressorts in diesem Medium erstellen und verifizierten Mitgliedern operative Verantwortung zuweisen.",
    boundary:
      "Workzone-Zuweisungen organisieren Verantwortung. Sicherheitsrechte bleiben tenantweit unter Personen & Rollen.",
    capacity: "Workzone-Kapazität",
    active: "Aktiv",
    archived: "Archiviert",
    members: "Verifizierte Mitglieder",
    create: "Workzone erstellen",
    slug: "Stabiler Slug",
    name: "Workzone-Name",
    description: "Zweck und Umfang",
    add: "Workzone hinzufügen",
    limit: "Das Workzone-Limit des Pakets ist erreicht.",
    team: "Zugewiesenes Team",
    assigned: "zugewiesen",
    noTeam: "Noch keine operative Verantwortung zugewiesen.",
    person: "Mitglied",
    responsibility: "Operative Verantwortung",
    assign: "Mitglied zuweisen",
    remove: "Entfernen",
    save: "Profil speichern",
    error: "Workzone-Verwaltung erfordert Owner-Zugriff und aktuelle MFA.",
    saved: "Änderungen gespeichert.",
    loading: "Workzones werden geladen…",
    lifecycle: "Vorschau der Lebenszyklus-Auswirkungen",
    previewOnly: "Sicherer Lebenszyklus",
    lifecycleIntro:
      "Die Archivierung ist reversibel und bewahrt Datensätze. Endgültiges Löschen bleibt gesperrt.",
    reason: "Begründung (erforderlich)",
    reasonPlaceholder: "Warum ist diese Lebenszyklusänderung erforderlich?",
    archive: "Workzone archivieren",
    restore: "Workzone wiederherstellen",
    deleteUnavailable: "Endgültiges Löschen ist nicht verfügbar",
    lifecycleReady: "Diese Änderung ist bereit.",
    lifecycleBlocked: "Aktive Blocker vor der Archivierung auflösen.",
    impactLoading: "Aktuelle Referenzen werden ausgewertet…",
    impactError: "Die Lebenszyklus-Vorschau konnte nicht verifiziert werden.",
    blocking: "Blockierende Referenzzeilen",
    informational: "Informative Referenzzeilen",
    blockers: {
      active_uploads: "Aktive Uploads",
      active_oauth: "Aktive OAuth-Vorgänge",
      active_delivery: "Aktive Auslieferung",
      last_active_workzone: "Letzte aktive Workzone",
    },
    dependencyKind: { blocking: "Blockierend", informational: "Informativ" },
    dependencies: {
      publishing_delivery: "Veröffentlichung, Auslieferung & Verbindungen",
      editorial_content: "Redaktionelle Inhalte",
      research_evidence: "Recherche & Belege",
      ai_governance: "KI-Governance",
      tenant_setup: "Tenant-Einrichtung",
      team_assignments: "Team-Zuweisungen",
      personal_saved_views: "Persönliche Ansichten",
    },
    responsibilities: {
      lead: "Leitung",
      editorial: "Redaktion",
      approval: "Freigabe",
      research: "Recherche",
      social: "Social Media",
      operations: "Betrieb",
    },
  },
  sq: {
    eyebrow: "Administrimi i medias",
    title: "Workzone dhe ekipi",
    intro:
      "Krijo redaksi të fokusuara brenda kësaj mediaje dhe cakto përgjegjësi operative për anëtarët e verifikuar.",
    boundary:
      "Caktimet në workzone organizojnë përgjegjësinë. Lejet e sigurisë mbeten në nivel mediaje te Njerëzit dhe rolet.",
    capacity: "Kapaciteti i workzone-ve",
    active: "Aktive",
    archived: "Arkivuar",
    members: "Anëtarë të verifikuar",
    create: "Krijo workzone",
    slug: "Slug i qëndrueshëm",
    name: "Emri i workzone",
    description: "Qëllimi dhe fusha",
    add: "Shto workzone",
    limit: "Është arritur kufiri i workzone-ve të paketës.",
    team: "Ekipi i caktuar",
    assigned: "të caktuar",
    noTeam: "Nuk është caktuar ende përgjegjësi operative.",
    person: "Anëtari",
    responsibility: "Përgjegjësia operative",
    assign: "Cakto anëtarin",
    remove: "Hiq",
    save: "Ruaj profilin",
    error: "Administrimi i workzone kërkon akses pronari dhe MFA të freskët.",
    saved: "Ndryshimet u ruajtën.",
    loading: "Po ngarkohen workzone-t…",
    lifecycle: "Preview i ndikimit të ciklit jetësor",
    previewOnly: "Cikël jetësor i sigurt",
    lifecycleIntro:
      "Arkivimi është i kthyeshëm dhe ruan të dhënat. Fshirja përfundimtare mbetet e bllokuar.",
    reason: "Arsyeja (e detyrueshme)",
    reasonPlaceholder: "Shpjego pse nevojitet ky ndryshim",
    archive: "Arkivo workzone",
    restore: "Rikthe workzone",
    deleteUnavailable: "Fshirja përfundimtare nuk lejohet",
    lifecycleReady: "Ky ndryshim është gati.",
    lifecycleBlocked: "Zgjidh bllokuesit aktivë para arkivimit.",
    impactLoading: "Po vlerësohen referencat aktuale…",
    impactError: "Preview i ciklit jetësor nuk mund të verifikohej.",
    blocking: "Rreshta reference bllokuese",
    informational: "Rreshta reference informative",
    blockers: {
      active_uploads: "Ngarkime aktive",
      active_oauth: "Lidhje OAuth aktive",
      active_delivery: "Shpërndarje aktive",
      last_active_workzone: "Workzone e fundit aktive",
    },
    dependencyKind: { blocking: "Bllokuese", informational: "Informative" },
    dependencies: {
      publishing_delivery: "Publikim, shpërndarje dhe lidhje",
      editorial_content: "Përmbajtje editoriale",
      research_evidence: "Kërkim dhe evidencë",
      ai_governance: "Qeverisje AI",
      tenant_setup: "Konfigurim tenant-i",
      team_assignments: "Caktime ekipi",
      personal_saved_views: "Pamje personale të ruajtura",
    },
    responsibilities: {
      lead: "Drejtues",
      editorial: "Editorial",
      approval: "Miratim",
      research: "Kërkim",
      social: "Rrjete sociale",
      operations: "Operacione",
    },
  },
} as const;

const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("redi_csrf="))
      ?.split("=")[1] ?? "",
  );
const mutationHeaders = () => ({
  "content-type": "application/json",
  "x-csrf-token": csrf(),
});
const formText = (values: FormData, key: string) => {
  const value = values.get(key);
  return typeof value === "string" ? value : "";
};

export function WorkzoneTeamCenter({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<WorkzoneProvisioningSnapshot | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [lifecycle, setLifecycle] = useState<
    Record<
      string,
      {
        status: "loading" | "ready" | "error";
        impact?: WorkzoneLifecycleImpact;
      }
    >
  >({});
  const [message, setMessage] = useState<"error" | "saved" | "">("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/workzone-provisioning", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) throw new Error("workzone_unavailable");
    const parsed = parseWorkzoneProvisioningSnapshot(await response.json());
    if (!parsed) throw new Error("workzone_contract_invalid");
    setSnapshot(parsed);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setMessage("error"));
  }, [refresh]);

  async function mutate(request: () => Promise<Response>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await request();
      if (!response.ok) throw new Error("workzone_mutation_refused");
      await refresh();
      setLifecycle({});
      setMessage("saved");
      return true;
    } catch {
      setMessage("error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadLifecycle(
    workspaceId: string,
    event: SyntheticEvent<HTMLDetailsElement>,
  ) {
    if (!event.currentTarget.open || lifecycle[workspaceId]?.status === "ready")
      return;
    setLifecycle((current) => ({
      ...current,
      [workspaceId]: { status: "loading" },
    }));
    try {
      const response = await fetch(
        `/api/workzone-provisioning/${workspaceId}/lifecycle-impact`,
        { cache: "no-store", credentials: "include" },
      );
      if (!response.ok) throw new Error("workzone_lifecycle_unavailable");
      const impact = parseWorkzoneLifecycleImpact(
        await response.json(),
        workspaceId,
      );
      if (!impact) throw new Error("workzone_lifecycle_contract_invalid");
      setLifecycle((current) => ({
        ...current,
        [workspaceId]: { status: "ready", impact },
      }));
    } catch {
      setLifecycle((current) => ({
        ...current,
        [workspaceId]: { status: "error" },
      }));
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await mutate(() =>
        fetch("/api/workzone-provisioning", {
          method: "POST",
          credentials: "include",
          headers: mutationHeaders(),
          body: JSON.stringify({
            slug: formText(values, "slug"),
            name: formText(values, "name"),
            description: formText(values, "description"),
          }),
        }),
      )
    )
      form.reset();
  }

  async function update(
    workspaceId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await mutate(() =>
      fetch(`/api/workzone-provisioning/${workspaceId}`, {
        method: "PATCH",
        credentials: "include",
        headers: mutationHeaders(),
        body: JSON.stringify({
          name: formText(values, "name"),
          description: formText(values, "description"),
        }),
      }),
    );
  }

  async function assign(
    workspaceId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const userId = formText(values, "userId");
    await mutate(() =>
      fetch(`/api/workzone-provisioning/${workspaceId}/members/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: mutationHeaders(),
        body: JSON.stringify({
          responsibility: formText(values, "responsibility"),
        }),
      }),
    );
  }

  async function remove(workspaceId: string, userId: string) {
    await mutate(() =>
      fetch(`/api/workzone-provisioning/${workspaceId}/members/${userId}`, {
        method: "DELETE",
        credentials: "include",
        headers: mutationHeaders(),
      }),
    );
  }

  async function transitionLifecycle(
    workspaceId: string,
    action: "archive" | "restore",
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = formText(new FormData(form), "reason").trim();
    if (reason.length < 10) return;
    if (
      await mutate(() =>
        fetch(`/api/workzone-provisioning/${workspaceId}/lifecycle`, {
          method: "POST",
          credentials: "include",
          headers: mutationHeaders(),
          body: JSON.stringify({
            action,
            reason,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      )
    )
      form.reset();
  }

  if (!snapshot)
    return (
      <section className="workzone-admin-state" role="status">
        {message === "error" ? text.error : text.loading}
      </section>
    );
  return (
    <main className="workzone-admin">
      <header className="workzone-admin-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>
        <dl>
          <div>
            <dt>{text.capacity}</dt>
            <dd>
              {snapshot.workzoneCount} / {snapshot.maximumWorkzones}
            </dd>
          </div>
          <div>
            <dt>{text.members}</dt>
            <dd>{snapshot.members.length}</dd>
          </div>
          <div>
            <dt>{text.active}</dt>
            <dd>{snapshot.activeWorkzoneCount}</dd>
          </div>
          <div>
            <dt>{text.archived}</dt>
            <dd>{snapshot.archivedWorkzoneCount}</dd>
          </div>
        </dl>
      </header>
      <aside className="workzone-boundary">{text.boundary}</aside>
      {message && (
        <p
          className={
            message === "error"
              ? "workzone-admin-error"
              : "workzone-admin-success"
          }
          role="status"
        >
          {message === "error" ? text.error : text.saved}
        </p>
      )}
      <section className="workzone-admin-grid">
        <div className="workzone-admin-list">
          {snapshot.workzones.map((workzone) => {
            const impact = lifecycle[workzone.id]?.impact;
            return (
              <article
                key={workzone.id}
                className="workzone-admin-card"
                data-status={workzone.status}
              >
                <header>
                  <div>
                    <code>{workzone.slug}</code>
                    <h2>{workzone.name}</h2>
                  </div>
                  <span className="workzone-status">
                    {workzone.status === "active" ? text.active : text.archived}
                  </span>
                </header>
                <form onSubmit={(event) => void update(workzone.id, event)}>
                  <label>
                    {text.name}
                    <input
                      name="name"
                      defaultValue={workzone.name}
                      minLength={2}
                      maxLength={160}
                      required
                      disabled={workzone.status === "archived"}
                    />
                  </label>
                  <label>
                    {text.description}
                    <textarea
                      name="description"
                      defaultValue={workzone.description}
                      maxLength={500}
                      disabled={workzone.status === "archived"}
                    />
                  </label>
                  <button disabled={busy || workzone.status === "archived"}>
                    {text.save}
                  </button>
                </form>
                <details
                  className="workzone-lifecycle"
                  key={`${workzone.id}:${workzone.lifecycleVersion}`}
                  onToggle={(event) => void loadLifecycle(workzone.id, event)}
                >
                  <summary>
                    <span>{text.lifecycle}</span>
                    <small>{text.previewOnly}</small>
                  </summary>
                  <p>{text.lifecycleIntro}</p>
                  {lifecycle[workzone.id]?.status === "loading" && (
                    <p role="status">{text.impactLoading}</p>
                  )}
                  {lifecycle[workzone.id]?.status === "error" && (
                    <p className="workzone-lifecycle-error" role="alert">
                      {text.impactError}
                    </p>
                  )}
                  {impact && (
                    <>
                      <dl className="workzone-lifecycle-totals">
                        <div>
                          <dt>{text.blocking}</dt>
                          <dd>{impact.blockingReferenceRows}</dd>
                        </div>
                        <div>
                          <dt>{text.informational}</dt>
                          <dd>{impact.informationalReferenceRows}</dd>
                        </div>
                      </dl>
                      <ul>
                        {impact.dependencies.map((dependency) => (
                          <li key={dependency.key}>
                            <span>
                              {text.dependencies[dependency.key]}
                              <small>
                                {text.dependencyKind[dependency.kind]}
                              </small>
                            </span>
                            <strong>{dependency.referenceRows}</strong>
                          </li>
                        ))}
                      </ul>
                      <ul className="workzone-lifecycle-blockers">
                        {impact.transitionBlockers
                          .filter((blocker) => blocker.count > 0)
                          .map((blocker) => (
                            <li key={blocker.key} data-blocked="true">
                              <span>{text.blockers[blocker.key]}</span>
                              <strong>{blocker.count}</strong>
                            </li>
                          ))}
                      </ul>
                      <p>
                        {impact.operations.archiveAvailable ||
                        impact.operations.restoreAvailable
                          ? text.lifecycleReady
                          : text.lifecycleBlocked}
                      </p>
                      <form
                        className="workzone-lifecycle-action"
                        onSubmit={(event) =>
                          void transitionLifecycle(
                            workzone.id,
                            workzone.status === "active"
                              ? "archive"
                              : "restore",
                            event,
                          )
                        }
                      >
                        <label>
                          {text.reason}
                          <textarea
                            name="reason"
                            placeholder={text.reasonPlaceholder}
                            minLength={10}
                            maxLength={1000}
                            required
                          />
                        </label>
                        <button
                          disabled={
                            busy ||
                            (workzone.status === "active"
                              ? !impact.operations.archiveAvailable
                              : !impact.operations.restoreAvailable)
                          }
                        >
                          {workzone.status === "active"
                            ? text.archive
                            : text.restore}
                        </button>
                        <small>{text.deleteUnavailable}</small>
                      </form>
                    </>
                  )}
                </details>
                <section className="workzone-team-list">
                  <h3>{text.team}</h3>
                  {workzone.assignments.length === 0 ? (
                    <p>{text.noTeam}</p>
                  ) : (
                    workzone.assignments.map((assignment) => (
                      <div key={assignment.id}>
                        <span>
                          <strong>{assignment.email}</strong>
                          <small>
                            {text.responsibilities[assignment.responsibility]}
                          </small>
                        </span>
                        <button
                          type="button"
                          disabled={busy || workzone.status === "archived"}
                          onClick={() =>
                            void remove(workzone.id, assignment.userId)
                          }
                        >
                          {text.remove}
                        </button>
                      </div>
                    ))
                  )}
                </section>
                <form
                  className="workzone-assign"
                  onSubmit={(event) => void assign(workzone.id, event)}
                >
                  <label>
                    {text.person}
                    <select name="userId" required>
                      {snapshot.members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.email} · {member.roles.join(", ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {text.responsibility}
                    <select name="responsibility" defaultValue="editorial">
                      {responsibilities.map((responsibility) => (
                        <option key={responsibility} value={responsibility}>
                          {text.responsibilities[responsibility]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      busy ||
                      snapshot.members.length === 0 ||
                      workzone.status === "archived"
                    }
                  >
                    {text.assign}
                  </button>
                </form>
              </article>
            );
          })}
        </div>
        <aside className="workzone-create-card">
          <p className="eyebrow">{text.create}</p>
          {snapshot.remainingCapacity === 0 ? (
            <p>{text.limit}</p>
          ) : (
            <form onSubmit={(event) => void create(event)}>
              <label>
                {text.slug}
                <input
                  name="slug"
                  pattern="[a-z][a-z0-9-]{1,62}"
                  minLength={2}
                  maxLength={63}
                  required
                />
              </label>
              <label>
                {text.name}
                <input name="name" minLength={2} maxLength={160} required />
              </label>
              <label>
                {text.description}
                <textarea name="description" maxLength={500} />
              </label>
              <button disabled={busy}>{text.add}</button>
            </form>
          )}
        </aside>
      </section>
    </main>
  );
}
