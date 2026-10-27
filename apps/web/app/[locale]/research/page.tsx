import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";
import { ResearchClient } from "./research-client";
const valid = (v: string): v is EnabledLocale =>
  enabledLocales.some((x) => x === v);
export default async function ResearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!valid(locale)) notFound();
  return (
    <main className="content-page research-page" lang={locale}>
      <header className="websites-header">
        <div>
          <p className="eyebrow">Media Intelligence</p>
          <h1>{locale === "sq" ? "Newsroom" : "Newsroom"}</h1>
          <p>
            {locale === "sq"
              ? "Kërkim i verifikueshëm, burime të dokumentuara dhe kalim i kontrolluar drejt përmbajtjes së unifikuar."
              : "Explainable research, documented sources and a controlled bridge to Unified Content."}
          </p>
        </div>
      </header>
      <ResearchClient locale={locale} />
    </main>
  );
}
