import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { WebsitesClient } from "./websites-client";

const copy = {
  en: {
    eyebrow: "Website Control",
    title: "Connected websites",
    body: "BusinessSite Information connections, capabilities, health and editorial status from the tenant-safe connector registry.",
    loading: "Loading connected websites…",
    empty: "No website connection is configured for this tenant.",
    unavailable:
      "Website data is unavailable. Sign in or check the API connection.",
    provider: "Provider",
    domain: "Domain",
    status: "Status",
    health: "Health",
    capabilities: "Capabilities",
    articles: "Articles",
    preview: "Open / preview",
    lastSync: "Last sync",
  },
  de: {
    eyebrow: "Website-Steuerung",
    title: "Verbundene Websites",
    body: "BusinessSite-Information-Verbindungen, Funktionen, Zustand und redaktioneller Status aus der mandantensicheren Connector-Registry.",
    loading: "Verbundene Websites werden geladen…",
    empty: "Für diesen Mandanten ist keine Website-Verbindung eingerichtet.",
    unavailable:
      "Website-Daten sind nicht verfügbar. Anmeldung und API-Verbindung prüfen.",
    provider: "Anbieter",
    domain: "Domain",
    status: "Status",
    health: "Zustand",
    capabilities: "Funktionen",
    articles: "Artikel",
    preview: "Öffnen / Vorschau",
    lastSync: "Letzte Synchronisierung",
  },
  sq: {
    eyebrow: "Kontrolli i website-ve",
    title: "Website-t e lidhura",
    body: "Lidhjet BusinessSite Information, aftësitë, gjendja dhe statusi editorial nga regjistri i izoluar sipas klientit.",
    loading: "Po ngarkohen website-t e lidhura…",
    empty: "Nuk ka lidhje website-i të konfiguruar për këtë klient.",
    unavailable:
      "Të dhënat e website-ve nuk janë të disponueshme. Kontrolloni hyrjen dhe API-n.",
    provider: "Ofruesi",
    domain: "Domain-i",
    status: "Statusi",
    health: "Gjendja",
    capabilities: "Aftësitë",
    articles: "Artikujt",
    preview: "Hap / shiko paraprakisht",
    lastSync: "Sinkronizimi i fundit",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function WebsitesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  const text = copy[locale];
  return (
    <main className="websites-page" lang={locale}>
      <header className="websites-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>
      </header>
      <WebsitesClient copy={text} />
    </main>
  );
}
