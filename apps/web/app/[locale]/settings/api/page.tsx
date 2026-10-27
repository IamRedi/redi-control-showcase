import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { ApiCredentialCenter } from "./api-credential-center";

function isEnabledLocale(value: string): value is EnabledLocale {
  return enabledLocales.some((locale) => locale === value);
}

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function ApiCredentialPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isEnabledLocale(locale)) notFound();
  return <ApiCredentialCenter locale={locale} />;
}
