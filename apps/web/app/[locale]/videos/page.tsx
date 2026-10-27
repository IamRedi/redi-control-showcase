import { enabledLocales, type EnabledLocale } from "@redi-control/config";
import { notFound } from "next/navigation";

import { VideoIntelligence } from "../../video-intelligence";

const enabled = (value: string): value is EnabledLocale =>
  enabledLocales.some((locale) => locale === value);

export function generateStaticParams() {
  return enabledLocales.map((locale) => ({ locale }));
}

export default async function VideoIntelligencePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!enabled(locale)) notFound();
  return <VideoIntelligence locale={locale} />;
}
