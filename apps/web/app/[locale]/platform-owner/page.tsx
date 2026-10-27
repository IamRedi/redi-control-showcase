import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { PlatformOwnerConsole } from "./platform-owner-client";

const enabled = (value: string): value is EnabledLocale =>
  enabledLocales.some((locale) => locale === value);
export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}
export default async function PlatformOwnerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!enabled(locale)) notFound();
  return <PlatformOwnerConsole locale={locale} />;
}
