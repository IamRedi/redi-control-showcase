import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { PeopleClient } from "./people-client";
import { peopleCopy } from "./people-copy";

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function PeoplePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  const text = peopleCopy[locale];
  return (
    <main className="content-page" lang={locale}>
      <header className="websites-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>
      </header>
      <PeopleClient copy={text} />
    </main>
  );
}
