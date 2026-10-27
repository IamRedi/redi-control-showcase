import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { WorkzoneTeamCenter } from "./workzone-team-center";

const enabled = (value: string): value is EnabledLocale =>
  enabledLocales.some((locale) => locale === value);
export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}
export default async function WorkzoneSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!enabled(locale)) notFound();
  return <WorkzoneTeamCenter locale={locale} />;
}
