import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialReviewClient } from "./social-review-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Review & approval",
    body: "Inspect immutable revisions, enforce independent approval and schedule only the exact approved revision. No provider publication is triggered from this screen.",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Prüfung & Freigabe",
    body: "Unveränderliche Revisionen prüfen, unabhängige Freigabe erzwingen und nur die exakt freigegebene Revision planen. Dieser Bildschirm veröffentlicht nichts beim Anbieter.",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Review & aprovim",
    body: "Kontrollo revizionet immutable, ruaj aprovimin e pavarur dhe planifiko vetëm revizionin e aprovuar saktësisht. Ky ekran nuk publikon asgjë te provideri.",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialReviewPage({
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
      <SocialReviewClient locale={locale} />
    </main>
  );
}
