"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { localizedLoginHref } from "./auth-navigation-contract";
import { classifyWorkspaceResponse } from "./workspace-onboarding-contract";
import { WorkspaceOnboarding } from "./workspace-onboarding";

import {
  matchesWorkboardHandoffFilter,
  type WorkboardAssignmentScope,
  type WorkboardFocus,
  type WorkboardHandoffCheck,
  type WorkboardHandoffFilter,
  type WorkboardHandoffState,
  workboardHandoffStates,
  workboardStages,
  summarizeWorkboardHandoffs,
  type WorkboardSortOrder,
  type WorkboardSnapshot,
  type WorkboardStage,
  type WorkboardStory,
} from "./workboard-contract";
import {
  resolveWorkboardStartupView,
  type WorkboardViewSnapshot,
} from "./workboard-view-contract";

type Locale = "en" | "de" | "sq";

const copy = {
  sq: {
    eyebrow: "Media Workzone",
    title: "Editorial Workboard",
    body: "Të gjitha temat aktive në një pamje: nga burimet dhe verifikimi deri te variantet, aprovimi dhe shpërndarja.",
    safety: "Vetëm gjendje reale · Pa publikim nga bordi",
    loading: "Po ngarkohet bordi editorial…",
    signedOut: "Hyni për të hapur bordin editorial.",
    unavailable: "Bordi editorial nuk është i disponueshëm tani.",
    signIn: "Hyni me siguri",
    search: "Kërko titullin ose përmbledhjen",
    allStages: "Të gjithë hapat",
    noStories: "Nuk ka tema në këtë hap.",
    research: "Në kërkim",
    ready: "Gati për krijim",
    drafting: "Në krijim",
    review: "Në review",
    scheduled: "Planifikuar",
    done: "Përfunduar",
    attention: "Kërkon vëmendje",
    sources: "burime",
    claims: "pretendime të verifikuara",
    variants: "variante",
    direct: "Përmbajtje direkte",
    researchOrigin: "Nga Research",
    updated: "Azhoruar",
    preview: "Përmbledhja e temës",
    selectStory: "Zgjidhni një temë për të parë detajet.",
    evidence: "Gjendja e provave",
    destinationReadiness: "Gatishmëria e destinacioneve",
    noDestinations: "Nuk është krijuar ende asnjë variant destinacioni.",
    pendingReview: "Në pritje review",
    revision: "revizion",
    openResearch: "Hap Research Case",
    openContent: "Hap Content Studio",
    openReview: "Hap revizionet dhe aprovimin",
    freshness: "Freskia",
    unknown: "Pa datë",
    responsibility: "Përgjegjësia",
    unassigned: "Pa përgjegjës",
    due: "Afati",
    overdue: "Me vonesë",
    priority: "Prioriteti",
    normal: "Normal",
    high: "I lartë",
    urgent: "Urgjent",
    assignee: "Përgjegjësi",
    note: "Shënim i shkurtër",
    saveAssignment: "Ruaj përgjegjësinë",
    removeAssignment: "Hiq përgjegjësinë",
    assignmentSaved: "Përgjegjësia u ruajt.",
    assignmentRemoved: "Përgjegjësia u hoq.",
    assignmentFailed: "Ndryshimi nuk u ruajt.",
    saving: "Po ruhet…",
    mfaAdminOnly: "Vetëm administratori me MFA mund ta ndryshojë.",
    workzone: "Workzone",
    savedViews: "Pamjet e ruajtura",
    chooseView: "Zgjidh një pamje",
    viewName: "Emri i pamjes",
    saveView: "Ruaj pamjen aktuale",
    renameView: "Riemërto të zgjedhurën",
    duplicateView: "Dyfisho të zgjedhurën",
    deleteView: "Fshi pamjen",
    setDefaultView: "Hap gjithmonë këtë pamje",
    clearDefaultView: "Hiq hapjen automatike",
    defaultView: "Default",
    viewArchived: "Workzone e arkivuar",
    viewSaved: "Pamja u ruajt.",
    viewRenamed: "Pamja u riemërtua pa ndryshuar default-in.",
    viewDuplicated: "Kopja u krijua si pamje jo-default.",
    viewDeleted: "Pamja u fshi.",
    defaultViewSaved: "Pamja do të hapet automatikisht.",
    defaultViewCleared: "Hapja automatike u hoq.",
    viewFailed: "Pamja nuk mund të ndryshohej.",
    viewLimit: "Është arritur kufiri i pamjeve personale.",
    assignmentScope: "Radha personale",
    allAssignments: "Të gjitha temat",
    mine: "Detyrat e mia",
    focus: "Fokusi",
    allFocus: "Çdo gjendje",
    attentionFocus: "Vëmendje",
    dueSoon: "Afat brenda 24 orëve",
    sort: "Renditja",
    smart: "Prioritet inteligjent",
    deadlineFirst: "Afati më i afërt",
    recentlyUpdated: "Më të fundit",
    queueSummary: "Përmbledhja e punës",
    teamWorkload: "Ngarkesa e ekipit",
    workloadBody:
      "Pamje read-only e përgjegjësive aktive dhe rrezikut të afateve.",
    fullTeam: "Ekipi i plotë",
    assignedOnly: "Vetëm anëtarët me detyra",
    completeCoverage: "Mbulim i plotë",
    partialCoverage: "Mbulim i pjesshëm",
    activeTasks: "Aktive",
    nextDeadline: "Afati i ardhshëm",
    noWorkload: "Nuk ka ende ngarkesë aktive.",
    handoffChecklist: "Handoff editorial",
    handoffBody:
      "Hapat e derivuar nga puna reale; nuk ndryshojnë asnjë status.",
    ownershipCheck: "Përgjegjësia",
    evidenceCheck: "Evidenca",
    contentCheck: "Përmbajtja",
    reviewCheck: "Review",
    deliveryCheck: "Shpërndarja",
    completeStatus: "Plotësuar",
    pendingStatus: "Në pritje",
    blockedStatus: "Bllokuar",
    notApplicableStatus: "Nuk aplikohet",
    handoffNeedsOwner: "Duhet përgjegjës",
    handoffEvidence: "Vazhdo evidencën",
    handoffContent: "Krijo përmbajtjen",
    handoffReview: "Dërgo në review",
    handoffDelivery: "Përgatit shpërndarjen",
    handoffComplete: "Handoff i plotë",
    handoffBlocked: "Kërkon zgjidhje",
    handoffSummary: "Gjendja e handoff-it",
    handoffSummaryBody:
      "Filtër mbi temat e ngarkuara; ruhet vetëm në pamjen tënde personale dhe nuk ndryshon workflow-n.",
    allHandoffs: "Të gjitha",
  },
  en: {
    eyebrow: "Media Workzone",
    title: "Editorial Workboard",
    body: "Every active story in one view: from sources and verification to variants, approval and delivery.",
    safety: "Truthful state only · No publishing from the board",
    loading: "Loading editorial board…",
    signedOut: "Sign in to open the editorial board.",
    unavailable: "The editorial board is unavailable right now.",
    signIn: "Sign in securely",
    search: "Search title or summary",
    allStages: "All stages",
    noStories: "No stories are in this stage.",
    research: "Researching",
    ready: "Ready to create",
    drafting: "Drafting",
    review: "In review",
    scheduled: "Scheduled",
    done: "Completed",
    attention: "Needs attention",
    sources: "sources",
    claims: "verified claims",
    variants: "variants",
    direct: "Direct content",
    researchOrigin: "From Research",
    updated: "Updated",
    preview: "Story summary",
    selectStory: "Select a story to inspect its details.",
    evidence: "Evidence state",
    destinationReadiness: "Destination readiness",
    noDestinations: "No destination variant has been created yet.",
    pendingReview: "Awaiting review",
    revision: "revision",
    openResearch: "Open Research Case",
    openContent: "Open Content Studio",
    openReview: "Open revisions and approval",
    freshness: "Freshness",
    unknown: "No date",
    responsibility: "Responsibility",
    unassigned: "Unassigned",
    due: "Deadline",
    overdue: "Overdue",
    priority: "Priority",
    normal: "Normal",
    high: "High",
    urgent: "Urgent",
    assignee: "Owner",
    note: "Short note",
    saveAssignment: "Save responsibility",
    removeAssignment: "Remove responsibility",
    assignmentSaved: "Responsibility saved.",
    assignmentRemoved: "Responsibility removed.",
    assignmentFailed: "The change could not be saved.",
    saving: "Saving…",
    mfaAdminOnly: "Only an administrator with MFA can change this.",
    workzone: "Workzone",
    savedViews: "Saved views",
    chooseView: "Choose a view",
    viewName: "View name",
    saveView: "Save current view",
    renameView: "Rename selected view",
    duplicateView: "Duplicate selected view",
    deleteView: "Delete view",
    setDefaultView: "Always open this view",
    clearDefaultView: "Clear automatic opening",
    defaultView: "Default",
    viewArchived: "Archived workzone",
    viewSaved: "View saved.",
    viewRenamed: "View renamed without changing its default status.",
    viewDuplicated: "Copy created as a non-default view.",
    viewDeleted: "View deleted.",
    defaultViewSaved: "This view will open automatically.",
    defaultViewCleared: "Automatic opening was cleared.",
    viewFailed: "The view could not be changed.",
    viewLimit: "The personal saved-view limit is reached.",
    assignmentScope: "Personal queue",
    allAssignments: "All stories",
    mine: "My assignments",
    focus: "Focus",
    allFocus: "Every state",
    attentionFocus: "Needs attention",
    dueSoon: "Due within 24 hours",
    sort: "Sort",
    smart: "Smart priority",
    deadlineFirst: "Nearest deadline",
    recentlyUpdated: "Recently updated",
    queueSummary: "Work summary",
    teamWorkload: "Team workload",
    workloadBody: "Read-only view of active ownership and deadline risk.",
    fullTeam: "Full team",
    assignedOnly: "Assigned members only",
    completeCoverage: "Complete coverage",
    partialCoverage: "Partial coverage",
    activeTasks: "Active",
    nextDeadline: "Next deadline",
    noWorkload: "There is no active workload yet.",
    handoffChecklist: "Editorial handoff",
    handoffBody: "Steps derived from real work; they do not change any state.",
    ownershipCheck: "Ownership",
    evidenceCheck: "Evidence",
    contentCheck: "Content",
    reviewCheck: "Review",
    deliveryCheck: "Delivery",
    completeStatus: "Complete",
    pendingStatus: "Pending",
    blockedStatus: "Blocked",
    notApplicableStatus: "Not applicable",
    handoffNeedsOwner: "Owner needed",
    handoffEvidence: "Continue evidence",
    handoffContent: "Create content",
    handoffReview: "Send to review",
    handoffDelivery: "Prepare delivery",
    handoffComplete: "Handoff complete",
    handoffBlocked: "Resolution needed",
    handoffSummary: "Handoff status",
    handoffSummaryBody:
      "Filter over loaded stories; it is saved only in your personal view and changes no workflow state.",
    allHandoffs: "All",
  },
  de: {
    eyebrow: "Media Workzone",
    title: "Editorial Workboard",
    body: "Alle aktiven Themen in einer Ansicht: von Quellen und Verifikation bis zu Varianten, Freigabe und Zustellung.",
    safety: "Nur echter Status · Keine Veröffentlichung im Board",
    loading: "Redaktionsboard wird geladen…",
    signedOut: "Melden Sie sich an, um das Redaktionsboard zu öffnen.",
    unavailable: "Das Redaktionsboard ist derzeit nicht verfügbar.",
    signIn: "Sicher anmelden",
    search: "Titel oder Zusammenfassung suchen",
    allStages: "Alle Stufen",
    noStories: "Keine Themen in dieser Stufe.",
    research: "In Recherche",
    ready: "Bereit zum Erstellen",
    drafting: "In Erstellung",
    review: "In Prüfung",
    scheduled: "Geplant",
    done: "Abgeschlossen",
    attention: "Aufmerksamkeit nötig",
    sources: "Quellen",
    claims: "verifizierte Aussagen",
    variants: "Varianten",
    direct: "Direkter Inhalt",
    researchOrigin: "Aus Recherche",
    updated: "Aktualisiert",
    preview: "Themenübersicht",
    selectStory: "Wählen Sie ein Thema aus, um Details zu sehen.",
    evidence: "Belegstatus",
    destinationReadiness: "Zielbereitschaft",
    noDestinations: "Noch keine Zielvariante erstellt.",
    pendingReview: "Wartet auf Prüfung",
    revision: "Revision",
    openResearch: "Research Case öffnen",
    openContent: "Content Studio öffnen",
    openReview: "Revisionen und Freigabe öffnen",
    freshness: "Aktualität",
    unknown: "Kein Datum",
    responsibility: "Verantwortung",
    unassigned: "Nicht zugewiesen",
    due: "Frist",
    overdue: "Überfällig",
    priority: "Priorität",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    assignee: "Verantwortlich",
    note: "Kurze Notiz",
    saveAssignment: "Verantwortung speichern",
    removeAssignment: "Verantwortung entfernen",
    assignmentSaved: "Verantwortung gespeichert.",
    assignmentRemoved: "Verantwortung entfernt.",
    assignmentFailed: "Die Änderung konnte nicht gespeichert werden.",
    saving: "Wird gespeichert…",
    mfaAdminOnly: "Nur Administratoren mit MFA können dies ändern.",
    workzone: "Workzone",
    savedViews: "Gespeicherte Ansichten",
    chooseView: "Ansicht auswählen",
    viewName: "Name der Ansicht",
    saveView: "Aktuelle Ansicht speichern",
    renameView: "Ausgewählte Ansicht umbenennen",
    duplicateView: "Ausgewählte Ansicht duplizieren",
    deleteView: "Ansicht löschen",
    setDefaultView: "Diese Ansicht immer öffnen",
    clearDefaultView: "Automatisches Öffnen entfernen",
    defaultView: "Standard",
    viewArchived: "Archivierte Workzone",
    viewSaved: "Ansicht gespeichert.",
    viewRenamed: "Ansicht umbenannt; der Standardstatus blieb erhalten.",
    viewDuplicated: "Kopie als Nicht-Standardansicht erstellt.",
    viewDeleted: "Ansicht gelöscht.",
    defaultViewSaved: "Diese Ansicht wird automatisch geöffnet.",
    defaultViewCleared: "Automatisches Öffnen wurde entfernt.",
    viewFailed: "Die Ansicht konnte nicht geändert werden.",
    viewLimit: "Das Limit persönlicher Ansichten ist erreicht.",
    assignmentScope: "Persönliche Warteschlange",
    allAssignments: "Alle Themen",
    mine: "Meine Aufgaben",
    focus: "Fokus",
    allFocus: "Jeder Status",
    attentionFocus: "Aufmerksamkeit nötig",
    dueSoon: "In 24 Stunden fällig",
    sort: "Sortierung",
    smart: "Intelligente Priorität",
    deadlineFirst: "Nächste Frist",
    recentlyUpdated: "Zuletzt aktualisiert",
    queueSummary: "Arbeitsübersicht",
    teamWorkload: "Teamauslastung",
    workloadBody:
      "Schreibgeschützte Sicht auf aktive Verantwortung und Fristrisiken.",
    fullTeam: "Vollständiges Team",
    assignedOnly: "Nur zugewiesene Mitglieder",
    completeCoverage: "Vollständige Abdeckung",
    partialCoverage: "Teilweise Abdeckung",
    activeTasks: "Aktiv",
    nextDeadline: "Nächste Frist",
    noWorkload: "Noch keine aktive Auslastung.",
    handoffChecklist: "Redaktionelle Übergabe",
    handoffBody:
      "Aus echter Arbeit abgeleitete Schritte; sie ändern keinen Status.",
    ownershipCheck: "Verantwortung",
    evidenceCheck: "Belege",
    contentCheck: "Inhalt",
    reviewCheck: "Prüfung",
    deliveryCheck: "Zustellung",
    completeStatus: "Abgeschlossen",
    pendingStatus: "Ausstehend",
    blockedStatus: "Blockiert",
    notApplicableStatus: "Nicht anwendbar",
    handoffNeedsOwner: "Verantwortliche Person nötig",
    handoffEvidence: "Belege fortsetzen",
    handoffContent: "Inhalt erstellen",
    handoffReview: "Zur Prüfung senden",
    handoffDelivery: "Zustellung vorbereiten",
    handoffComplete: "Übergabe abgeschlossen",
    handoffBlocked: "Klärung erforderlich",
    handoffSummary: "Übergabestatus",
    handoffSummaryBody:
      "Filter über geladene Themen; wird nur in Ihrer persönlichen Ansicht gespeichert und ändert keinen Workflow.",
    allHandoffs: "Alle",
  },
} as const;

const destinationLabels = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
} as const;

function handoffStateLabel(
  text: (typeof copy)[Locale],
  state: WorkboardHandoffState,
): string {
  return {
    blocked: text.handoffBlocked,
    needs_owner: text.handoffNeedsOwner,
    evidence: text.handoffEvidence,
    content: text.handoffContent,
    review: text.handoffReview,
    delivery: text.handoffDelivery,
    complete: text.handoffComplete,
  }[state];
}

function handoffCheckLabel(
  text: (typeof copy)[Locale],
  status: WorkboardHandoffCheck,
): string {
  return {
    complete: text.completeStatus,
    pending: text.pendingStatus,
    blocked: text.blockedStatus,
    not_applicable: text.notApplicableStatus,
  }[status];
}

function date(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "sq" ? "sq-AL" : locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EditorialWorkboard({ locale }: { readonly locale: Locale }) {
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<WorkboardSnapshot | null>(null);
  const [views, setViews] = useState<WorkboardViewSnapshot | null>(null);
  const [state, setState] = useState<
    "loading" | "signed-out" | "workspace-required" | "unavailable"
  >("loading");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<WorkboardStage | "all">("all");
  const [assignmentScope, setAssignmentScope] =
    useState<WorkboardAssignmentScope>("all");
  const [focus, setFocus] = useState<WorkboardFocus>("all");
  const [handoffFilter, setHandoffFilter] =
    useState<WorkboardHandoffFilter>("all");
  const [sortOrder, setSortOrder] = useState<WorkboardSortOrder>("smart");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState("");
  const [viewName, setViewName] = useState("");
  const [viewStatus, setViewStatus] = useState<
    | "idle"
    | "saving"
    | "saved"
    | "renamed"
    | "duplicated"
    | "deleted"
    | "defaulted"
    | "defaultCleared"
    | "failed"
  >("idle");

  const load = useCallback((workspaceId?: string) => {
    const target = new URL("/api/workzone/stories", window.location.origin);
    if (workspaceId) target.searchParams.set("workspaceId", workspaceId);
    return fetch(target, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          return setState(classifyWorkspaceResponse(response.status));
        const value = (await response.json()) as WorkboardSnapshot;
        setSnapshot(value);
        setSelectedId((current) =>
          value.stories.some((story) => story.id === current)
            ? current
            : (value.stories[0]?.id ?? null),
        );
      })
      .catch(() => setState("unavailable"));
  }, []);
  const loadViews = useCallback(async () => {
    try {
      const response = await fetch("/api/workzone/views", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("workboard_views_unavailable");
      const next = (await response.json()) as WorkboardViewSnapshot;
      setViews(next);
      return next;
    } catch {
      setViewStatus("failed");
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadViews().then(async (next) => {
      if (!active) return;
      const startup = next ? resolveWorkboardStartupView(next) : null;
      if (!startup) return load();
      setActiveViewId(startup.id);
      setViewName(startup.name);
      setQuery(startup.query);
      setStage(startup.stage);
      setAssignmentScope(startup.assignmentScope);
      setFocus(startup.focus);
      setSortOrder(startup.sortOrder);
      setHandoffFilter(startup.handoffFilter);
      await load(startup.workspaceId);
    });
    return () => {
      active = false;
    };
  }, [load, loadViews]);

  async function changeWorkspace(workspaceId: string) {
    setActiveViewId("");
    setViewName("");
    setViewStatus("idle");
    await load(workspaceId);
  }

  async function applyView(viewId: string) {
    setActiveViewId(viewId);
    setViewStatus("idle");
    const view = views?.savedViews.find((candidate) => candidate.id === viewId);
    if (!view || view.availability !== "active") return;
    setViewName(view.name);
    setQuery(view.query);
    setStage(view.stage);
    setAssignmentScope(view.assignmentScope);
    setFocus(view.focus);
    setSortOrder(view.sortOrder);
    setHandoffFilter(view.handoffFilter);
    await load(view.workspaceId);
  }

  async function saveView() {
    if (!snapshot || viewName.trim().length < 2) return;
    setViewStatus("saving");
    const response = await fetch("/api/workzone/views", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf(),
      },
      body: JSON.stringify({
        workspaceId: snapshot.workspace.id,
        name: viewName,
        stage,
        query,
        assignmentScope,
        focus,
        handoffFilter,
        sortOrder,
      }),
    }).catch(() => null);
    if (!response?.ok) return setViewStatus("failed");
    const saved = (await response.json()) as { id?: unknown };
    setActiveViewId(typeof saved.id === "string" ? saved.id : "");
    setViewName("");
    const refreshed = await loadViews();
    if (!refreshed) return;
    setViewStatus("saved");
  }

  async function deleteView() {
    if (!activeViewId) return;
    setViewStatus("saving");
    const response = await fetch(`/api/workzone/views/${activeViewId}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf() },
    }).catch(() => null);
    if (!response?.ok) return setViewStatus("failed");
    setActiveViewId("");
    setViewName("");
    const refreshed = await loadViews();
    if (!refreshed) return;
    setViewStatus("deleted");
  }

  async function changeDefaultView() {
    if (!views || !activeViewId) return;
    setViewStatus("saving");
    const clearing = views.defaultViewId === activeViewId;
    const response = await fetch("/api/workzone/views/default", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf(),
      },
      body: JSON.stringify({ viewId: clearing ? null : activeViewId }),
    }).catch(() => null);
    if (!response?.ok) return setViewStatus("failed");
    const refreshed = await loadViews();
    if (!refreshed) return;
    setViewStatus(clearing ? "defaultCleared" : "defaulted");
  }

  async function manageNamedView(action: "rename" | "duplicate") {
    if (!views || !activeViewId || viewName.trim().length < 2) return;
    setViewStatus("saving");
    const response = await fetch(
      action === "rename"
        ? `/api/workzone/views/${activeViewId}`
        : `/api/workzone/views/${activeViewId}/duplicate`,
      {
        method: action === "rename" ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf(),
        },
        body: JSON.stringify({ name: viewName }),
      },
    ).catch(() => null);
    if (!response?.ok) return setViewStatus("failed");
    const result =
      action === "duplicate"
        ? ((await response.json()) as { id?: unknown })
        : null;
    const nextId =
      action === "duplicate" && typeof result?.id === "string"
        ? result.id
        : activeViewId;
    const refreshed = await loadViews();
    if (!refreshed) return;
    const managed = refreshed.savedViews.find((view) => view.id === nextId);
    if (!managed) return setViewStatus("failed");
    setActiveViewId(managed.id);
    setViewName(managed.name);
    if (action === "duplicate") {
      setQuery(managed.query);
      setStage(managed.stage);
      setAssignmentScope(managed.assignmentScope);
      setFocus(managed.focus);
      setSortOrder(managed.sortOrder);
      setHandoffFilter(managed.handoffFilter);
      await load(managed.workspaceId);
    }
    setViewStatus(action === "rename" ? "renamed" : "duplicated");
  }

  const stageLabels: Record<WorkboardStage, string> = {
    research: text.research,
    ready: text.ready,
    drafting: text.drafting,
    review: text.review,
    scheduled: text.scheduled,
    done: text.done,
    attention: text.attention,
  };
  const handoffSummary = useMemo(
    () => summarizeWorkboardHandoffs(snapshot?.stories ?? []),
    [snapshot],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    const priorityRank = { urgent: 0, high: 1, normal: 2 } as const;
    const smartRank = (story: WorkboardStory) =>
      story.assignment?.dueState === "overdue"
        ? 0
        : story.stage === "attention"
          ? 1
          : story.assignment?.dueState === "due_soon"
            ? 2
            : 3;
    return (
      snapshot?.stories
        .filter(
          (story) =>
            (stage === "all" || story.stage === stage) &&
            matchesWorkboardHandoffFilter(story, handoffFilter) &&
            (assignmentScope === "all" ||
              (assignmentScope === "mine" && story.assignment?.mine) ||
              (assignmentScope === "unassigned" && !story.assignment)) &&
            (focus === "all" ||
              (focus === "attention" && story.needsAttention) ||
              (focus === "overdue" &&
                story.assignment?.dueState === "overdue") ||
              (focus === "due_soon" &&
                story.assignment?.dueState === "due_soon")) &&
            (!normalized ||
              story.title.toLocaleLowerCase(locale).includes(normalized) ||
              story.summary.toLocaleLowerCase(locale).includes(normalized)),
        )
        .sort((left, right) => {
          if (sortOrder === "updated")
            return right.updatedAt.localeCompare(left.updatedAt);
          if (sortOrder === "deadline")
            return (
              (left.assignment?.dueAt ?? "9999").localeCompare(
                right.assignment?.dueAt ?? "9999",
              ) || right.updatedAt.localeCompare(left.updatedAt)
            );
          return (
            smartRank(left) - smartRank(right) ||
            (left.assignment ? priorityRank[left.assignment.priority] : 9) -
              (right.assignment
                ? priorityRank[right.assignment.priority]
                : 9) ||
            (left.assignment?.dueAt ?? "9999").localeCompare(
              right.assignment?.dueAt ?? "9999",
            ) ||
            right.updatedAt.localeCompare(left.updatedAt)
          );
        }) ?? []
    );
  }, [
    assignmentScope,
    focus,
    handoffFilter,
    locale,
    query,
    snapshot,
    sortOrder,
    stage,
  ]);
  const selected =
    filtered.find((story) => story.id === selectedId) ?? filtered[0] ?? null;
  const activeSavedView =
    views?.savedViews.find((view) => view.id === activeViewId) ?? null;
  const normalizedViewName = viewName.trim().toLocaleLowerCase(locale);
  const viewNameOwnedByOther =
    views?.savedViews.some(
      (view) =>
        view.id !== activeViewId &&
        view.name.toLocaleLowerCase(locale) === normalizedViewName,
    ) ?? false;
  const savedViewNameExists =
    views?.savedViews.some(
      (view) => view.name.toLocaleLowerCase(locale) === normalizedViewName,
    ) ?? false;

  if (!snapshot)
    return (
      <main className="workboard-page" lang={locale}>
        <header className="workboard-header">
          <div>
            <p className="eyebrow">{text.eyebrow}</p>
            <h1>{text.title}</h1>
            <p>{text.body}</p>
          </div>
        </header>
        <section className="workzone-state" role="status">
          {state === "workspace-required" ? (
            <WorkspaceOnboarding locale={locale} />
          ) : (
            <p>
              {state === "loading"
                ? text.loading
                : state === "signed-out"
                  ? text.signedOut
                  : text.unavailable}
            </p>
          )}
          {state === "signed-out" ? (
            <a href={localizedLoginHref(locale, "/workzone/board")}>
              {text.signIn} →
            </a>
          ) : null}
        </section>
      </main>
    );

  return (
    <main className="workboard-page" lang={locale}>
      <header className="workboard-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
        <span>{text.safety}</span>
      </header>

      <section className="workboard-toolbar" aria-label={text.title}>
        <label>
          <span>{text.workzone}</span>
          <select
            value={snapshot.workspace.id}
            onChange={(event) => void changeWorkspace(event.target.value)}
            disabled={
              !views ||
              views.workspaces.filter(
                (workspace) => workspace.status === "active",
              ).length < 2
            }
          >
            {(
              views?.workspaces.filter(
                (workspace) => workspace.status === "active",
              ) ?? [snapshot.workspace]
            ).map((workspace) => (
              <option value={workspace.id} key={workspace.id}>
                {workspace.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.search}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.search}
            maxLength={160}
          />
        </label>
        <label>
          <span>{text.allStages}</span>
          <select
            value={stage}
            onChange={(event) =>
              setStage(event.target.value as WorkboardStage | "all")
            }
          >
            <option value="all">{text.allStages}</option>
            {workboardStages.map((name) => (
              <option value={name} key={name}>
                {stageLabels[name]} · {snapshot.counts[name]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.assignmentScope}</span>
          <select
            value={assignmentScope}
            onChange={(event) =>
              setAssignmentScope(event.target.value as WorkboardAssignmentScope)
            }
          >
            <option value="all">{text.allAssignments}</option>
            <option value="mine">{text.mine}</option>
            <option value="unassigned">{text.unassigned}</option>
          </select>
        </label>
        <label>
          <span>{text.focus}</span>
          <select
            value={focus}
            onChange={(event) => setFocus(event.target.value as WorkboardFocus)}
          >
            <option value="all">{text.allFocus}</option>
            <option value="attention">{text.attentionFocus}</option>
            <option value="overdue">{text.overdue}</option>
            <option value="due_soon">{text.dueSoon}</option>
          </select>
        </label>
        <label>
          <span>{text.sort}</span>
          <select
            value={sortOrder}
            onChange={(event) =>
              setSortOrder(event.target.value as WorkboardSortOrder)
            }
          >
            <option value="smart">{text.smart}</option>
            <option value="deadline">{text.deadlineFirst}</option>
            <option value="updated">{text.recentlyUpdated}</option>
          </select>
        </label>
      </section>

      <section
        className="workboard-queue-summary"
        aria-label={text.queueSummary}
      >
        <button
          type="button"
          data-active={assignmentScope === "mine" && focus === "all"}
          onClick={() => {
            setAssignmentScope("mine");
            setFocus("all");
          }}
        >
          <strong>{snapshot.queue.mine}</strong>
          <span>{text.mine}</span>
        </button>
        <button
          type="button"
          data-active={focus === "attention"}
          onClick={() => setFocus("attention")}
        >
          <strong>{snapshot.queue.attention}</strong>
          <span>{text.attentionFocus}</span>
        </button>
        <button
          type="button"
          data-active={focus === "overdue"}
          onClick={() => setFocus("overdue")}
        >
          <strong>{snapshot.queue.overdue}</strong>
          <span>{text.overdue}</span>
        </button>
        <button
          type="button"
          data-active={focus === "due_soon"}
          onClick={() => setFocus("due_soon")}
        >
          <strong>{snapshot.queue.dueSoon}</strong>
          <span>{text.dueSoon}</span>
        </button>
        <button
          type="button"
          data-active={assignmentScope === "unassigned" && focus === "all"}
          onClick={() => {
            setAssignmentScope("unassigned");
            setFocus("all");
          }}
        >
          <strong>{snapshot.queue.unassigned}</strong>
          <span>{text.unassigned}</span>
        </button>
      </section>

      <section
        className="workboard-handoff-summary"
        aria-labelledby="handoff-summary-title"
      >
        <header>
          <div>
            <h2 id="handoff-summary-title">{text.handoffSummary}</h2>
            <p>{text.handoffSummaryBody}</p>
          </div>
          <span data-complete={snapshot.workload.coverage.complete}>
            {snapshot.workload.coverage.complete
              ? text.completeCoverage
              : `${text.partialCoverage} · ${snapshot.workload.coverage.loadedStories}/${snapshot.workload.coverage.limit}`}
          </span>
        </header>
        <div>
          <button
            type="button"
            data-active={handoffFilter === "all"}
            aria-pressed={handoffFilter === "all"}
            onClick={() => setHandoffFilter("all")}
          >
            <strong>{handoffSummary.total}</strong>
            <span>{text.allHandoffs}</span>
          </button>
          {workboardHandoffStates.map((handoffState) => (
            <button
              type="button"
              key={handoffState}
              data-state={handoffState}
              data-active={handoffFilter === handoffState}
              aria-pressed={handoffFilter === handoffState}
              onClick={() =>
                setHandoffFilter((current) =>
                  current === handoffState ? "all" : handoffState,
                )
              }
            >
              <strong>{handoffSummary.counts[handoffState]}</strong>
              <span>{handoffStateLabel(text, handoffState)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="workboard-workload" aria-labelledby="workload-title">
        <header>
          <div>
            <h2 id="workload-title">{text.teamWorkload}</h2>
            <p>{text.workloadBody}</p>
          </div>
          <div className="workboard-workload-badges">
            <span>
              {snapshot.workload.visibility === "full_team"
                ? text.fullTeam
                : text.assignedOnly}
            </span>
            <span data-complete={snapshot.workload.coverage.complete}>
              {snapshot.workload.coverage.complete
                ? text.completeCoverage
                : `${text.partialCoverage} · ${snapshot.workload.coverage.loadedStories}/${snapshot.workload.coverage.limit}`}
            </span>
          </div>
        </header>
        <div
          className="workboard-workload-table"
          role="region"
          aria-label={text.teamWorkload}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{text.assignee}</th>
                <th scope="col">{text.activeTasks}</th>
                <th scope="col">{text.overdue}</th>
                <th scope="col">{text.dueSoon}</th>
                <th scope="col">{text.attentionFocus}</th>
                <th scope="col">{text.urgent}</th>
                <th scope="col">{text.nextDeadline}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.workload.members.length === 0 ? (
                <tr>
                  <td colSpan={7}>{text.noWorkload}</td>
                </tr>
              ) : null}
              {snapshot.workload.members.map((member) => (
                <tr key={member.userId}>
                  <th scope="row">{member.email}</th>
                  <td>{member.total}</td>
                  <td data-risk={member.overdue > 0}>{member.overdue}</td>
                  <td>{member.dueSoon}</td>
                  <td data-risk={member.attention > 0}>{member.attention}</td>
                  <td>{member.urgent}</td>
                  <td>
                    {member.nextDueAt
                      ? date(member.nextDueAt, locale)
                      : text.unknown}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <strong>{snapshot.workload.unassigned}</strong>
          <span>{text.unassigned}</span>
        </footer>
      </section>

      <section className="workboard-saved-views" aria-label={text.savedViews}>
        <label>
          <span>{text.savedViews}</span>
          <select
            value={activeViewId}
            onChange={(event) => void applyView(event.target.value)}
          >
            <option value="">{text.chooseView}</option>
            {views?.savedViews.map((view) => (
              <option
                value={view.id}
                key={view.id}
                disabled={view.availability !== "active"}
              >
                {view.name}
                {view.availability === "workspace_archived"
                  ? ` · ${text.viewArchived}`
                  : ""}
                {views.defaultViewId === view.id
                  ? ` · ${text.defaultView}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.viewName}</span>
          <input
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            minLength={2}
            maxLength={80}
            placeholder={text.viewName}
          />
        </label>
        <div className="workboard-saved-view-actions">
          <button
            type="button"
            disabled={
              !views ||
              viewName.trim().length < 2 ||
              viewStatus === "saving" ||
              (views.savedViews.length >= views.maximumSavedViews &&
                !savedViewNameExists)
            }
            onClick={() => void saveView()}
          >
            {text.saveView}
          </button>
          <button
            type="button"
            disabled={
              !activeSavedView ||
              activeSavedView.availability !== "active" ||
              viewName.trim().length < 2 ||
              viewNameOwnedByOther ||
              viewName.trim() === activeSavedView.name ||
              viewStatus === "saving"
            }
            onClick={() => void manageNamedView("rename")}
          >
            {text.renameView}
          </button>
          <button
            type="button"
            disabled={
              !views ||
              !activeSavedView ||
              activeSavedView.availability !== "active" ||
              viewName.trim().length < 2 ||
              savedViewNameExists ||
              views.savedViews.length >= views.maximumSavedViews ||
              viewStatus === "saving"
            }
            onClick={() => void manageNamedView("duplicate")}
          >
            {text.duplicateView}
          </button>
          <button
            type="button"
            disabled={
              !activeSavedView ||
              activeSavedView.availability !== "active" ||
              viewStatus === "saving"
            }
            aria-pressed={views?.defaultViewId === activeViewId}
            onClick={() => void changeDefaultView()}
          >
            {views?.defaultViewId === activeViewId
              ? text.clearDefaultView
              : text.setDefaultView}
          </button>
          <button
            type="button"
            disabled={!activeViewId || viewStatus === "saving"}
            onClick={() => void deleteView()}
          >
            {text.deleteView}
          </button>
        </div>
        <p role="status">
          {viewStatus === "saved"
            ? text.viewSaved
            : viewStatus === "renamed"
              ? text.viewRenamed
              : viewStatus === "duplicated"
                ? text.viewDuplicated
                : viewStatus === "deleted"
                  ? text.viewDeleted
                  : viewStatus === "defaulted"
                    ? text.defaultViewSaved
                    : viewStatus === "defaultCleared"
                      ? text.defaultViewCleared
                      : viewStatus === "failed"
                        ? text.viewFailed
                        : views &&
                            views.savedViews.length >= views.maximumSavedViews
                          ? text.viewLimit
                          : ""}
        </p>
      </section>

      <div className="workboard-layout">
        <section className="workboard-scroll" aria-label={text.title}>
          <div className="workboard-columns">
            {workboardStages
              .filter((name) => stage === "all" || stage === name)
              .map((name) => {
                const stories = filtered.filter(
                  (story) => story.stage === name,
                );
                return (
                  <section
                    className="workboard-column"
                    key={name}
                    data-stage={name}
                  >
                    <header>
                      <h2>{stageLabels[name]}</h2>
                      <span>{stories.length}</span>
                    </header>
                    <div>
                      {stories.length === 0 ? (
                        <p className="workboard-empty">{text.noStories}</p>
                      ) : null}
                      {stories.map((story) => (
                        <StoryCard
                          key={story.id}
                          story={story}
                          active={story.id === selectedId}
                          onSelect={() => setSelectedId(story.id)}
                          text={text}
                          locale={locale}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
          </div>
        </section>

        <aside className="workboard-preview" aria-live="polite">
          {!selected ? (
            <p>{text.selectStory}</p>
          ) : (
            <StoryPreview
              key={selected.id}
              story={selected}
              locale={locale}
              text={text}
              snapshot={snapshot}
              onChanged={() => load(snapshot.workspace.id)}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

function StoryCard({
  story,
  active,
  onSelect,
  text,
  locale,
}: {
  readonly story: WorkboardStory;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly text: (typeof copy)[Locale];
  readonly locale: Locale;
}) {
  return (
    <button
      className="workboard-card"
      data-active={active}
      type="button"
      onClick={onSelect}
    >
      <small>{story.research ? text.researchOrigin : text.direct}</small>
      <strong>{story.title}</strong>
      <p>{story.summary}</p>
      <footer>
        <span>
          {story.research?.sourceCount ?? 0} {text.sources}
        </span>
        <span>
          {story.destinations.length} {text.variants}
        </span>
      </footer>
      <div className="workboard-card-handoff" data-state={story.handoff.state}>
        <span>{handoffStateLabel(text, story.handoff.state)}</span>
        <strong>
          {story.handoff.completed}/{story.handoff.applicable}
        </strong>
      </div>
      <div className="workboard-card-assignment">
        <span>{story.assignment?.assignee.email ?? text.unassigned}</span>
        {story.assignment?.dueAt ? (
          <span data-overdue={story.assignment.dueState === "overdue"}>
            {date(story.assignment.dueAt, locale)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function StoryPreview({
  story,
  locale,
  text,
  snapshot,
  onChanged,
}: {
  readonly story: WorkboardStory;
  readonly locale: Locale;
  readonly text: (typeof copy)[Locale];
  readonly snapshot: WorkboardSnapshot;
  readonly onChanged: () => Promise<void>;
}) {
  const home = `/${locale}`;
  const handoffChecks = [
    ["ownership", text.ownershipCheck],
    ["evidence", text.evidenceCheck],
    ["content", text.contentCheck],
    ["review", text.reviewCheck],
    ["delivery", text.deliveryCheck],
  ] as const;
  return (
    <>
      <header>
        <small>{text.preview}</small>
        <h2>{story.title}</h2>
        <p>{story.summary}</p>
      </header>
      <dl className="workboard-preview-meta">
        <div>
          <dt>{text.updated}</dt>
          <dd>{date(story.updatedAt, locale)}</dd>
        </div>
        <div>
          <dt>{text.freshness}</dt>
          <dd>
            {story.research?.freshnessAt
              ? date(story.research.freshnessAt, locale)
              : text.unknown}
          </dd>
        </div>
      </dl>
      <section className="workboard-handoff">
        <header>
          <div>
            <h3>{text.handoffChecklist}</h3>
            <p>{text.handoffBody}</p>
          </div>
          <span data-state={story.handoff.state}>
            {handoffStateLabel(text, story.handoff.state)} ·{" "}
            {story.handoff.completed}/{story.handoff.applicable}
          </span>
        </header>
        <ul>
          {handoffChecks.map(([key, label]) => {
            const status = story.handoff.checks[key];
            return (
              <li key={key} data-status={status}>
                <span aria-hidden="true" />
                <strong>{label}</strong>
                <small>{handoffCheckLabel(text, status)}</small>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3>{text.responsibility}</h3>
        <div className="workboard-assignment-summary">
          <strong>{story.assignment?.assignee.email ?? text.unassigned}</strong>
          {story.assignment ? (
            <span data-priority={story.assignment.priority}>
              {text[story.assignment.priority]}
            </span>
          ) : null}
          {story.assignment?.dueAt ? (
            <span data-overdue={story.assignment.dueState === "overdue"}>
              {story.assignment.dueState === "overdue"
                ? `${text.overdue} · `
                : `${text.due} · `}
              {date(story.assignment.dueAt, locale)}
            </span>
          ) : null}
        </div>
        {story.assignment?.note ? <p>{story.assignment.note}</p> : null}
        {snapshot.permissions.canManageAssignments ? (
          <AssignmentEditor
            story={story}
            workspaceId={snapshot.workspace.id}
            team={snapshot.team}
            text={text}
            onChanged={onChanged}
          />
        ) : (
          <small>{text.mfaAdminOnly}</small>
        )}
      </section>
      <section>
        <h3>{text.evidence}</h3>
        <div className="workboard-evidence">
          <strong>{story.research?.sourceCount ?? 0}</strong>
          <span>{text.sources}</span>
          <strong>
            {story.research?.verifiedClaimCount ?? 0}/
            {story.research?.claimCount ?? 0}
          </strong>
          <span>{text.claims}</span>
        </div>
      </section>
      <section>
        <h3>{text.destinationReadiness}</h3>
        {story.destinations.length === 0 ? (
          <p>{text.noDestinations}</p>
        ) : (
          <ul className="workboard-destinations">
            {story.destinations.map((destination) => (
              <li key={destination.name}>
                <div>
                  <strong>{destinationLabels[destination.name]}</strong>
                  <small>
                    {text.revision} {destination.currentRevision}
                  </small>
                </div>
                <span data-status={destination.status}>
                  {destination.pendingReview
                    ? text.pendingReview
                    : destination.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav className="workboard-preview-actions">
        {story.research ? (
          <Link href={`${home}/research/${story.research.id}`}>
            {text.openResearch} →
          </Link>
        ) : null}
        {story.content ? (
          <Link href={`${home}/content`}>{text.openContent} →</Link>
        ) : null}
        {story.destinations.length > 0 ? (
          <Link href={`${home}/social/review`}>{text.openReview} →</Link>
        ) : null}
      </nav>
    </>
  );
}

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};

function localInput(value: string | null | undefined): string {
  if (!value) return "";
  const current = new Date(value);
  const local = new Date(
    current.getTime() - current.getTimezoneOffset() * 60_000,
  );
  return local.toISOString().slice(0, 16);
}

function AssignmentEditor({
  story,
  workspaceId,
  team,
  text,
  onChanged,
}: {
  readonly story: WorkboardStory;
  readonly workspaceId: string;
  readonly team: WorkboardSnapshot["team"];
  readonly text: (typeof copy)[Locale];
  readonly onChanged: () => Promise<void>;
}) {
  const [assigneeUserId, setAssigneeUserId] = useState(
    story.assignment?.assignee.userId ?? team[0]?.userId ?? "",
  );
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">(
    story.assignment?.priority ?? "normal",
  );
  const [dueAt, setDueAt] = useState(localInput(story.assignment?.dueAt));
  const [note, setNote] = useState(story.assignment?.note ?? "");
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "removed" | "failed"
  >("idle");
  const endpoint = `/api/workzone/stories/${story.origin}/${story.id}/assignment`;

  async function save() {
    if (!assigneeUserId) return;
    setStatus("saving");
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        workspaceId,
        assigneeUserId,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        note,
      }),
    }).catch(() => null);
    if (!response?.ok) return setStatus("failed");
    setStatus("saved");
    await onChanged();
  }

  async function remove() {
    setStatus("saving");
    const response = await fetch(`${endpoint}?workspaceId=${workspaceId}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf() },
    }).catch(() => null);
    if (!response?.ok) return setStatus("failed");
    setStatus("removed");
    await onChanged();
  }

  return (
    <div className="workboard-assignment-form">
      <label>
        <span>{text.assignee}</span>
        <select
          value={assigneeUserId}
          onChange={(event) => setAssigneeUserId(event.target.value)}
        >
          {team.map((member) => (
            <option value={member.userId} key={member.userId}>
              {member.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.priority}</span>
        <select
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value as typeof priority)
          }
        >
          <option value="normal">{text.normal}</option>
          <option value="high">{text.high}</option>
          <option value="urgent">{text.urgent}</option>
        </select>
      </label>
      <label>
        <span>{text.due}</span>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </label>
      <label>
        <span>{text.note}</span>
        <textarea
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          disabled={!assigneeUserId || status === "saving"}
          onClick={() => void save()}
        >
          {status === "saving" ? text.saving : text.saveAssignment}
        </button>
        {story.assignment ? (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => void remove()}
          >
            {text.removeAssignment}
          </button>
        ) : null}
      </div>
      <p role="status">
        {status === "saved"
          ? text.assignmentSaved
          : status === "removed"
            ? text.assignmentRemoved
            : status === "failed"
              ? text.assignmentFailed
              : ""}
      </p>
    </div>
  );
}
