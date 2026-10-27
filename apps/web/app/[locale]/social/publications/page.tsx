import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialPublicationsClient } from "./social-publications-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Publication operations",
    body: "Inspect channel delivery, queued work and safe failure details. Provider execution and reconciliation are not activated yet.",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Publikationsbetrieb",
    body: "Kanalauslieferung, Warteschlangen und sichere Fehlerdetails prüfen. Provider-Ausführung und Abgleich sind noch nicht aktiviert.",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Operacionet e publikimit",
    body: "Kontrollo dërgimin për kanal, radhën e punëve dhe gabimet e sigurta. Ekzekutimi te provideri dhe reconciliation nuk janë aktivizuar ende.",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialPublicationsPage({
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
        <span className="social-safety">Read-only · no Meta calls</span>
      </header>
      <SocialPublicationsClient locale={locale} />
    </main>
  );
}
