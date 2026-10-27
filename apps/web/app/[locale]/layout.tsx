import "@redi-control/ui/tokens.css";
import "../styles.css";
import "../showcase.css";

import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MediaNavigation } from "./media-navigation";

export const metadata: Metadata = {
  title: "REDI CONTROL",
  description: "Multi-tenant control plane foundation",
};

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export default async function MediaLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  return (
    <html lang={locale}>
      <body>
        <aside className="showcase-notice" role="note">
          {locale === "de"
            ? "EVALUATION · Fiktive Daten · Externe Provider deaktiviert"
            : locale === "sq"
              ? "DEMO · Të dhëna fiktive · Provider-at e jashtëm të çaktivizuar"
              : "EVALUATION · Fictional data · External providers disabled"}
        </aside>
        <div className="media-dashboard">
          <MediaNavigation locale={locale} />
          {children}
        </div>
      </body>
    </html>
  );
}
