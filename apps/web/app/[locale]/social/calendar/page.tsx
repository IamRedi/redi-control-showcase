import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialCalendarClient } from "./social-calendar-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Publishing calendar",
    body: "A timezone-aware view of governed social drafts. Only independently approved revisions can enter the scheduled publication flow.",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Veröffentlichungskalender",
    body: "Eine zeitzonenbewusste Ansicht kontrollierter Social-Entwürfe. Nur unabhängig freigegebene Revisionen können geplant werden.",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Kalendari i publikimeve",
    body: "Pamje e drafteve sociale sipas timezone-it. Vetëm revizionet e aprovuara në mënyrë të pavarur mund të hyjnë në planifikim.",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  const text = copy[locale];
  return (
    <main className="social-page" lang={locale}>
      <header className="social-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
      </header>
      <SocialCalendarClient locale={locale} />
    </main>
  );
}
