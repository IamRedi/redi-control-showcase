"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WorkspaceOnboarding } from "./workspace-onboarding";
import {
  modelStudioOperations,
  type ModelStudioSnapshot,
} from "./model-studio-contract";

type Locale = "en" | "de" | "sq";
const copy = {
  sq: {
    eyebrow: "Media Workzone · Administrim",
    title: "Model Studio",
    body: "Krahaso rrugët aktive, kontrollo buxhetin dhe ruaj propozime të versionuara me prova vlerësimi.",
    guard: "Nuk ka aktivizim këtu · Providerët e jashtëm mbeten të palidhur",
    back: "Kthehu te Workzone",
    loading: "Po ngarkohet Model Studio…",
    denied: "Kërkohet administrator me MFA.",
    runtime: "Rrugët aktuale",
    runtimeBody: "Vetëm lexim: kjo është gjendja reale e AI Gateway.",
    noRoutes: "Nuk ka rrugë aktive.",
    budget: "Buxheti",
    daily: "Limiti ditor",
    monthly: "Limiti mujor",
    concurrency: "Punë paralele",
    used: "Përdorur",
    save: "Ruaj buxhetin",
    proposal: "Propozim i ri",
    proposalBody: "Propozimi nuk ndryshon konfigurimin aktiv.",
    operation: "Funksioni",
    provider: "Provider kandidat",
    model: "Modeli",
    prompt: "Versioni i prompt-it",
    tokens: "Token maksimum",
    policy: "Rishikimi i të dhënave",
    rationale: "Arsyetimi",
    create: "Ruaj propozimin",
    history: "Propozime dhe evidencë",
    empty: "Nuk ka ende propozime.",
    evaluate: "Shto evidencë vlerësimi",
    dataset: "Versioni i dataset-it",
    samples: "Shembuj",
    schema: "Skema %",
    grounding: "Grounding %",
    safety: "Siguria %",
    language: "Gjuha %",
    decision: "Vendimi",
    notes: "Shënime",
    record: "Regjistro evidencën",
    passed: "Kaloi",
    failed: "Dështoi",
    saved: "U ruajt me audit.",
    refused: "Veprimi u refuzua.",
    unreviewed: "Pa rishikuar",
    approved: "Miratuar",
    rejected: "Refuzuar",
  },
  en: {
    eyebrow: "Media Workzone · Administration",
    title: "Model Studio",
    body: "Compare live routes, control budget and record versioned proposals with evaluation evidence.",
    guard: "No activation here · External providers remain disconnected",
    back: "Back to Workzone",
    loading: "Loading Model Studio…",
    denied: "An administrator with MFA is required.",
    runtime: "Current routes",
    runtimeBody: "Read-only: this is the truthful AI Gateway state.",
    noRoutes: "No runtime routes are configured.",
    budget: "Budget",
    daily: "Daily limit",
    monthly: "Monthly limit",
    concurrency: "Concurrent runs",
    used: "Used",
    save: "Save budget",
    proposal: "New proposal",
    proposalBody: "A proposal never changes the active configuration.",
    operation: "Operation",
    provider: "Candidate provider",
    model: "Model",
    prompt: "Prompt version",
    tokens: "Maximum tokens",
    policy: "Data review",
    rationale: "Rationale",
    create: "Record proposal",
    history: "Proposals and evidence",
    empty: "No proposals yet.",
    evaluate: "Add evaluation evidence",
    dataset: "Dataset version",
    samples: "Samples",
    schema: "Schema %",
    grounding: "Grounding %",
    safety: "Safety %",
    language: "Language %",
    decision: "Decision",
    notes: "Notes",
    record: "Record evidence",
    passed: "Passed",
    failed: "Failed",
    saved: "Saved with audit evidence.",
    refused: "The action was refused.",
    unreviewed: "Unreviewed",
    approved: "Approved",
    rejected: "Rejected",
  },
  de: {
    eyebrow: "Media Workzone · Verwaltung",
    title: "Model Studio",
    body: "Aktive Routen vergleichen, Budget steuern und versionierte Vorschläge mit Evaluationsbelegen dokumentieren.",
    guard: "Keine Aktivierung hier · Externe Provider bleiben getrennt",
    back: "Zurück zur Workzone",
    loading: "Model Studio wird geladen…",
    denied: "Administrator mit MFA erforderlich.",
    runtime: "Aktuelle Routen",
    runtimeBody: "Nur lesbar: der tatsächliche AI-Gateway-Status.",
    noRoutes: "Keine Laufzeitrouten konfiguriert.",
    budget: "Budget",
    daily: "Tageslimit",
    monthly: "Monatslimit",
    concurrency: "Parallele Läufe",
    used: "Verbraucht",
    save: "Budget speichern",
    proposal: "Neuer Vorschlag",
    proposalBody: "Ein Vorschlag ändert nie die aktive Konfiguration.",
    operation: "Funktion",
    provider: "Provider-Kandidat",
    model: "Modell",
    prompt: "Prompt-Version",
    tokens: "Maximale Tokens",
    policy: "Datenprüfung",
    rationale: "Begründung",
    create: "Vorschlag erfassen",
    history: "Vorschläge und Belege",
    empty: "Noch keine Vorschläge.",
    evaluate: "Evaluationsbeleg hinzufügen",
    dataset: "Dataset-Version",
    samples: "Beispiele",
    schema: "Schema %",
    grounding: "Grounding %",
    safety: "Sicherheit %",
    language: "Sprache %",
    decision: "Entscheidung",
    notes: "Notizen",
    record: "Beleg erfassen",
    passed: "Bestanden",
    failed: "Fehlgeschlagen",
    saved: "Mit Audit-Beleg gespeichert.",
    refused: "Aktion wurde abgelehnt.",
    unreviewed: "Ungeprüft",
    approved: "Freigegeben",
    rejected: "Abgelehnt",
  },
} as const;
const csrf = () =>
  document.cookie
    .split("; ")
    .find((v) => v.startsWith("redi_csrf="))
    ?.slice(10) ?? "";
const operationLabel = (value: string) =>
  value
    .split("_")
    .map((v) => v[0]?.toUpperCase() + v.slice(1))
    .join(" ");

export function ModelStudio({ locale }: { readonly locale: Locale }) {
  const text = copy[locale],
    [snapshot, setSnapshot] = useState<ModelStudioSnapshot | null>(null);
  const [state, setState] = useState<
      "loading" | "denied" | "workspace-required" | "unavailable"
    >("loading"),
    [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      const overview = await fetch("/api/workzone/overview", {
        cache: "no-store",
      });
      if (overview.status === 401 || overview.status === 403)
        return setState("denied");
      if (overview.status === 404) return setState("workspace-required");
      if (!overview.ok) return setState("unavailable");
      const workspace = (await overview.json()) as {
        workspace?: { id?: string };
      };
      const response = await fetch(
        `/api/workzone/model-studio?workspaceId=${encodeURIComponent(workspace.workspace?.id ?? "")}`,
        { cache: "no-store" },
      );
      if (response.status === 401 || response.status === 403)
        return setState("denied");
      if (!response.ok) return setState("unavailable");
      setSnapshot((await response.json()) as ModelStudioSnapshot);
    } catch {
      setState("unavailable");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const mutate = async (url: string, method: "POST" | "PUT", body: object) => {
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": decodeURIComponent(csrf()),
      },
      body: JSON.stringify(body),
    });
    setMessage(response.ok ? text.saved : text.refused);
    if (response.ok) await refresh();
  };
  if (!snapshot)
    return (
      <main className="model-studio-page" lang={locale}>
        <header>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
        </header>
        <section className="workzone-state" role="status">
          {state === "workspace-required" ? (
            <WorkspaceOnboarding locale={locale} />
          ) : state === "loading" ? (
            text.loading
          ) : state === "denied" ? (
            text.denied
          ) : (
            text.refused
          )}
        </section>
      </main>
    );
  return (
    <main className="model-studio-page" lang={locale}>
      <header className="model-studio-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
        <div>
          <span>{text.guard}</span>
          <Link href={`/${locale}/workzone`}>{text.back} →</Link>
        </div>
      </header>
      {message ? (
        <p className="model-studio-message" role="status">
          {message}
        </p>
      ) : null}
      <section className="model-studio-guard">
        <strong>{snapshot.workspace.displayName}</strong>
        <span>{text.guard}</span>
      </section>
      <div className="model-studio-top">
        <section className="model-studio-panel">
          <h2>{text.runtime}</h2>
          <p>{text.runtimeBody}</p>
          <div className="model-route-list">
            {snapshot.runtimeRoutes.length ? (
              snapshot.runtimeRoutes.map((route) => (
                <article key={route.operation}>
                  <div>
                    <strong>{operationLabel(route.operation)}</strong>
                    <small>{route.enabled ? "ON" : "OFF"}</small>
                  </div>
                  <p>
                    {route.providerId} · {route.model}
                  </p>
                  <span>
                    {route.promptVersion} · {route.maxOutputTokens} tokens
                  </span>
                </article>
              ))
            ) : (
              <p>{text.noRoutes}</p>
            )}
          </div>
        </section>
        <section className="model-studio-panel">
          <h2>{text.budget}</h2>
          {snapshot.budget ? (
            <p>
              {text.used}: {snapshot.budget.dailyUsed}/
              {snapshot.budget.dailyCostLimit} · {snapshot.budget.monthlyUsed}/
              {snapshot.budget.monthlyCostLimit}
            </p>
          ) : null}
          <form
            className="model-studio-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void mutate("/api/workzone/model-studio/budget", "PUT", {
                workspaceId: snapshot.workspace.id,
                dailyCostLimit: Number(data.get("daily")),
                monthlyCostLimit: Number(data.get("monthly")),
                maximumConcurrency: Number(data.get("concurrency")),
              });
            }}
          >
            <label>
              {text.daily}
              <input
                name="daily"
                type="number"
                min="0"
                step="0.01"
                defaultValue={snapshot.budget?.dailyCostLimit ?? 10}
                required
              />
            </label>
            <label>
              {text.monthly}
              <input
                name="monthly"
                type="number"
                min="0"
                step="0.01"
                defaultValue={snapshot.budget?.monthlyCostLimit ?? 100}
                required
              />
            </label>
            <label>
              {text.concurrency}
              <input
                name="concurrency"
                type="number"
                min="1"
                max="50"
                defaultValue={snapshot.budget?.maximumConcurrency ?? 1}
                required
              />
            </label>
            <button>{text.save}</button>
          </form>
        </section>
      </div>
      <section className="model-studio-panel">
        <h2>{text.proposal}</h2>
        <p>{text.proposalBody}</p>
        <form
          className="model-proposal-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate("/api/workzone/model-studio/proposals", "POST", {
              workspaceId: snapshot.workspace.id,
              operation: data.get("operation"),
              providerId: data.get("provider"),
              model: data.get("model"),
              promptVersion: data.get("prompt"),
              maxOutputTokens: Number(data.get("tokens")),
              dataPolicyStatus: data.get("policy"),
              rationale: data.get("rationale"),
            });
          }}
        >
          <label>
            {text.operation}
            <select name="operation">
              {modelStudioOperations.map((value) => (
                <option key={value} value={value}>
                  {operationLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text.provider}
            <input name="provider" maxLength={120} required />
          </label>
          <label>
            {text.model}
            <input name="model" maxLength={160} required />
          </label>
          <label>
            {text.prompt}
            <input name="prompt" maxLength={80} required />
          </label>
          <label>
            {text.tokens}
            <input
              name="tokens"
              type="number"
              min="64"
              max="32000"
              defaultValue="1200"
              required
            />
          </label>
          <label>
            {text.policy}
            <select name="policy">
              <option value="unreviewed">{text.unreviewed}</option>
              <option value="approved">{text.approved}</option>
              <option value="rejected">{text.rejected}</option>
            </select>
          </label>
          <label className="wide">
            {text.rationale}
            <textarea name="rationale" maxLength={2000} required />
          </label>
          <button>{text.create}</button>
        </form>
      </section>
      <section className="model-studio-history">
        <h2>{text.history}</h2>
        {snapshot.proposals.length ? (
          snapshot.proposals.map((proposal) => (
            <article key={proposal.id}>
              <header>
                <div>
                  <small>{operationLabel(proposal.operation)}</small>
                  <h3>
                    {proposal.providerId} · {proposal.model}
                  </h3>
                  <p>{proposal.rationale}</p>
                </div>
                <span
                  data-decision={
                    proposal.latestEvaluation?.decision ??
                    proposal.dataPolicyStatus
                  }
                >
                  {proposal.latestEvaluation
                    ? proposal.latestEvaluation.decision === "passed"
                      ? text.passed
                      : text.failed
                    : text[proposal.dataPolicyStatus]}
                </span>
              </header>
              {proposal.latestEvaluation ? (
                <div className="model-evidence">
                  <strong>{proposal.latestEvaluation.datasetVersion}</strong>
                  <span>
                    {proposal.latestEvaluation.sampleSize} {text.samples}
                  </span>
                  <span>
                    {text.schema} {proposal.latestEvaluation.schemaPassRate}
                  </span>
                  <span>
                    {text.grounding}{" "}
                    {proposal.latestEvaluation.groundingPassRate}
                  </span>
                  <span>
                    {text.safety} {proposal.latestEvaluation.safetyPassRate}
                  </span>
                  <span>
                    {text.language} {proposal.latestEvaluation.languagePassRate}
                  </span>
                </div>
              ) : null}
              <details>
                <summary>{text.evaluate}</summary>
                <form
                  className="model-evaluation-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void mutate(
                      `/api/workzone/model-studio/proposals/${proposal.id}/evaluations`,
                      "POST",
                      {
                        workspaceId: snapshot.workspace.id,
                        datasetVersion: data.get("dataset"),
                        sampleSize: Number(data.get("samples")),
                        schemaPassRate: Number(data.get("schema")),
                        groundingPassRate: Number(data.get("grounding")),
                        safetyPassRate: Number(data.get("safety")),
                        languagePassRate: Number(data.get("language")),
                        decision: data.get("decision"),
                        notes: data.get("notes"),
                        evaluatedAt: new Date().toISOString(),
                      },
                    );
                  }}
                >
                  <label>
                    {text.dataset}
                    <input name="dataset" required />
                  </label>
                  <label>
                    {text.samples}
                    <input name="samples" type="number" min="1" required />
                  </label>
                  {["schema", "grounding", "safety", "language"].map((name) => (
                    <label key={name}>
                      {text[name as "schema"]}
                      <input
                        name={name}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        required
                      />
                    </label>
                  ))}
                  <label>
                    {text.decision}
                    <select name="decision">
                      <option value="passed">{text.passed}</option>
                      <option value="failed">{text.failed}</option>
                    </select>
                  </label>
                  <label className="wide">
                    {text.notes}
                    <textarea name="notes" maxLength={2000} />
                  </label>
                  <button>{text.record}</button>
                </form>
              </details>
            </article>
          ))
        ) : (
          <p>{text.empty}</p>
        )}
      </section>
    </main>
  );
}
