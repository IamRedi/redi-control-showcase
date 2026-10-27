import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialAnalyticsClient } from "./social-analytics-client";

const copy = {
  en: {
    eyebrow: "Social Control · Monitoring",
    title: "Social performance",
    body: "One calm view for verified Facebook and Instagram data. It is designed to make the source facts clear before any AI assessment of progress, strengths or risks.",
    safety: "Read-only · No messages · No publishing",
  },
  de: {
    eyebrow: "Social-Steuerung · Monitoring",
    title: "Social Performance",
    body: "Eine klare Ansicht für verifizierte Facebook- und Instagram-Daten. Die Quellfakten bleiben sichtbar, bevor KI Fortschritt, Stärken oder Risiken bewertet.",
    safety: "Nur Lesen · Keine Nachrichten · Keine Veröffentlichung",
  },
  sq: {
    eyebrow: "Kontrolli social · Monitorim",
    title: "Ecuria e rrjeteve sociale",
    body: "Një pamje e pastër për të dhënat e verifikuara nga Facebook dhe Instagram. Faktet e burimit mbeten të qarta para se AI të vlerësojë ecurinë, pikat e forta ose rreziqet.",
    safety: "Vetëm lexim · Pa mesazhe · Pa publikim",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  const text = copy[locale];
  return (
    <main className="social-page social-analytics-page" lang={locale}>
      <header className="social-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
        <span className="social-safety">{text.safety}</span>
      </header>
      <SocialAnalyticsClient locale={locale} />
    </main>
  );
}
