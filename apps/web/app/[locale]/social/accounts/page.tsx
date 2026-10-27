import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { SocialAccountsClient } from "./social-accounts-client";

const copy = {
  en: {
    eyebrow: "Social Control",
    title: "Accounts & capabilities",
    body: "A truthful control surface for authorized Facebook Pages and Instagram Professional accounts. Provider access remains closed until the real Meta adapter and test assets pass acceptance.",
    safety: "Human approval · No autonomous publishing",
  },
  de: {
    eyebrow: "Social-Steuerung",
    title: "Konten & Funktionen",
    body: "Eine verlässliche Steuerungsoberfläche für autorisierte Facebook-Seiten und professionelle Instagram-Konten. Der Provider-Zugriff bleibt geschlossen, bis der echte Meta-Adapter und die Test-Assets abgenommen sind.",
    safety: "Menschliche Freigabe · Keine autonome Veröffentlichung",
  },
  sq: {
    eyebrow: "Kontrolli social",
    title: "Llogaritë dhe aftësitë",
    body: "Panel real për Facebook Pages dhe llogari Instagram Professional të autorizuara. Qasja te provider-i mbetet e mbyllur derisa adapteri real Meta dhe asetet testuese të kalojnë pranimin.",
    safety: "Aprovim njerëzor · Pa publikim autonom",
  },
} as const;

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function SocialAccountsPage({
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
      <SocialAccountsClient locale={locale} />
    </main>
  );
}
