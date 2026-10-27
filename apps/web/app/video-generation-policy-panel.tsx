"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { VideoGenerationPolicyView } from "./video-intelligence-contract";

type Locale = "en" | "de" | "sq";
const copy = {
  en: {
    eyebrow: "Administrator guardrails",
    title: "Video generation limits",
    body: "Reserve capacity per workspace before any provider is connected. These controls do not enable HeyGen or paid execution.",
    daily: "Daily credits",
    monthly: "Monthly credits",
    concurrency: "Concurrent renders",
    enabled: "Allow internal reservations",
    usage: "Reserved usage",
    today: "Today",
    month: "This month",
    active: "Active jobs",
    save: "Save limits",
    saved: "Limits saved. Provider remains disconnected.",
    refused:
      "The policy change was refused. Check administrator access and MFA.",
  },
  de: {
    eyebrow: "Administrator-Schutzregeln",
    title: "Limits für Videogenerierung",
    body: "Kapazität je Arbeitsbereich festlegen, bevor ein Provider verbunden wird. Diese Steuerung aktiviert weder HeyGen noch bezahlte Ausführung.",
    daily: "Credits pro Tag",
    monthly: "Credits pro Monat",
    concurrency: "Parallele Renderings",
    enabled: "Interne Reservierungen erlauben",
    usage: "Reservierte Nutzung",
    today: "Heute",
    month: "Dieser Monat",
    active: "Aktive Jobs",
    save: "Limits speichern",
    saved: "Limits gespeichert. Provider bleibt getrennt.",
    refused: "Änderung abgelehnt. Administratorzugriff und MFA prüfen.",
  },
  sq: {
    eyebrow: "Kufijtë e administratorit",
    title: "Limitet e gjenerimit video",
    body: "Rezervo kapacitetin për çdo workzone para lidhjes së provider-it. Këto kontrolle nuk aktivizojnë HeyGen ose ekzekutim me pagesë.",
    daily: "Kredite ditore",
    monthly: "Kredite mujore",
    concurrency: "Renderime njëkohësisht",
    enabled: "Lejo rezervimet e brendshme",
    usage: "Përdorimi i rezervuar",
    today: "Sot",
    month: "Këtë muaj",
    active: "Job-e aktive",
    save: "Ruaj limitet",
    saved: "Limitet u ruajtën. Provider-i mbetet i palidhur.",
    refused: "Ndryshimi u refuzua. Kontrollo aksesin administrator dhe MFA.",
  },
} as const;

const csrf = () => {
  const entry = document.cookie
    .split("; ")
    .find((value) => value.startsWith("redi_csrf="));
  return entry ? decodeURIComponent(entry.slice("redi_csrf=".length)) : "";
};

export function VideoGenerationPolicyPanel({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const t = copy[locale];
  const [policy, setPolicy] = useState<VideoGenerationPolicyView | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/video-intelligence/generation-policy?workspaceId=${encodeURIComponent(workspaceId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          policy: VideoGenerationPolicyView | null;
        };
        setPolicy(body.policy);
        setVisible(true);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, [workspaceId]);

  if (!visible) return null;
  const values = policy ?? {
    providerId: "heygen" as const,
    dailyCreditLimit: 10,
    monthlyCreditLimit: 100,
    maximumConcurrency: 1,
    billingTimezone: "UTC" as const,
    enabled: false,
    dailyReserved: 0,
    monthlyReserved: 0,
    activeJobs: 0,
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const payload = {
      workspaceId,
      dailyCreditLimit: Number(data.get("dailyCreditLimit")),
      monthlyCreditLimit: Number(data.get("monthlyCreditLimit")),
      maximumConcurrency: Number(data.get("maximumConcurrency")),
      enabled: data.get("enabled") === "on",
    };
    try {
      const response = await fetch(
        "/api/video-intelligence/generation-policy",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf(),
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error("POLICY_REFUSED");
      const body = (await response.json()) as {
        policy: VideoGenerationPolicyView;
      };
      setPolicy(body.policy);
      setMessage(t.saved);
    } catch {
      setMessage(t.refused);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="video-policy-panel"
      aria-labelledby="video-policy-title"
    >
      <header>
        <div>
          <small>{t.eyebrow}</small>
          <h2 id="video-policy-title">{t.title}</h2>
          <p>{t.body}</p>
        </div>
        <span>HeyGen · {values.billingTimezone}</span>
      </header>
      <form
        key={JSON.stringify(values)}
        onSubmit={(event) => void submit(event)}
      >
        <label>
          {t.daily}
          <input
            defaultValue={values.dailyCreditLimit}
            min="0"
            max="1000000"
            name="dailyCreditLimit"
            required
            type="number"
          />
        </label>
        <label>
          {t.monthly}
          <input
            defaultValue={values.monthlyCreditLimit}
            min="0"
            max="10000000"
            name="monthlyCreditLimit"
            required
            type="number"
          />
        </label>
        <label>
          {t.concurrency}
          <input
            defaultValue={values.maximumConcurrency}
            min="1"
            max="20"
            name="maximumConcurrency"
            required
            type="number"
          />
        </label>
        <label className="video-policy-toggle">
          <input
            defaultChecked={values.enabled}
            name="enabled"
            type="checkbox"
          />
          {t.enabled}
        </label>
        <button disabled={busy} type="submit">
          {t.save}
        </button>
      </form>
      <div className="video-policy-usage" aria-label={t.usage}>
        <strong>{t.usage}</strong>
        <span>
          {t.today}: {values.dailyReserved}/{values.dailyCreditLimit}
        </span>
        <span>
          {t.month}: {values.monthlyReserved}/{values.monthlyCreditLimit}
        </span>
        <span>
          {t.active}: {values.activeJobs}/{values.maximumConcurrency}
        </span>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
