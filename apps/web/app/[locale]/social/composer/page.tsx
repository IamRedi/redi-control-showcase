import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialComposerClient } from "./social-composer-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Composer",
    body: "Create one governed draft with explicit destinations and verified media. Saving a draft never publishes it; review and approval remain separate steps.",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Composer",
    body: "Einen kontrollierten Entwurf mit eindeutigen Zielen und geprüften Medien erstellen. Das Speichern veröffentlicht nichts; Prüfung und Freigabe bleiben getrennt.",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Composer",
    body: "Krijo një draft të kontrolluar me destinacione të qarta dhe media të verifikuara. Ruajtja nuk publikon asgjë; review dhe aprovimi mbeten hapa të ndarë.",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialComposerPage({
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
      <SocialComposerClient locale={locale} />
    </main>
  );
}
