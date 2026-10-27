import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialPreflightClient } from "./social-preflight-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Provider preflight",
    body: "Validate the current immutable revision against known provider prerequisites before review. This is an advisory read only check; it never publishes.",
    safety: "Read-only · no Meta calls",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Provider-Vorabprüfung",
    body: "Die aktuelle unveränderliche Revision vor der Prüfung gegen bekannte Provider-Voraussetzungen validieren. Dies ist eine reine Leseprüfung und veröffentlicht nie.",
    safety: "Nur Lesen · keine Meta-Aufrufe",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Kontrolli paraprak i providerit",
    body: "Verifiko revizionin aktual immutable kundrejt kërkesave të njohura të providerit para review. Ky është kontroll vetëm-lexim dhe nuk publikon kurrë.",
    safety: "Vetëm lexim · pa thirrje Meta",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}
export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialPreflightPage({
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
        <span className="social-safety">{text.safety}</span>
      </header>
      <SocialPreflightClient locale={locale} />
    </main>
  );
}
