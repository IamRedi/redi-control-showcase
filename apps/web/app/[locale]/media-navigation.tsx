"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Locale = "en" | "de" | "sq";

const labels: Record<Locale, Record<string, string>> = {
  en: {
    mediaControl: "Media control",
    overview: "Overview",
    showcase: "Pilot showcase",
    workzone: "Media Workzone",
    newsroom: "Newsroom",
    articles: "Articles",
    videos: "Video Studio",
    website: "Website",
    channels: "Social Control",
    analytics: "Analytics",
    composer: "Composer",
    review: "Review & approval",
    calendar: "Calendar",
    publications: "Publications",
    preflight: "Preflight",
    people: "People & roles",
    workzoneSetup: "Workzones & team",
    apiAccess: "API access",
    operations: "Operations",
    workspace: "Media workspace",
  },
  de: {
    mediaControl: "Mediensteuerung",
    overview: "Übersicht",
    showcase: "Pilot-Showcase",
    workzone: "Media Workzone",
    newsroom: "Newsroom",
    articles: "Artikel",
    videos: "Video Studio",
    website: "Website",
    channels: "Social Control",
    analytics: "Analysen",
    composer: "Composer",
    review: "Prüfung & Freigabe",
    calendar: "Kalender",
    publications: "Publikationen",
    preflight: "Vorabprüfung",
    people: "Personen & Rollen",
    workzoneSetup: "Workzones & Team",
    apiAccess: "API-Zugriff",
    operations: "Betrieb",
    workspace: "Medienarbeitsbereich",
  },
  sq: {
    mediaControl: "Kontrolli i medias",
    overview: "Përmbledhje",
    showcase: "Prezantimi pilot",
    workzone: "Media Workzone",
    newsroom: "Newsroom",
    articles: "Artikuj",
    videos: "Video Studio",
    website: "Website",
    channels: "Kontrolli social",
    analytics: "Analitika",
    composer: "Composer",
    review: "Review & aprovim",
    calendar: "Kalendari",
    publications: "Publikimet",
    preflight: "Kontrolli paraprak",
    people: "Njerëz dhe role",
    workzoneSetup: "Workzone dhe ekipi",
    apiAccess: "Aksesi API",
    operations: "Operacionet",
    workspace: "Hapësira e medias",
  },
};

export function MediaNavigation({ locale }: { readonly locale: Locale }) {
  const pathname = usePathname();
  const text = labels[locale];
  const home = `/${locale}`;
  const items = [
    [home, text.overview],
    [`${home}/showcase`, text.showcase],
    [`${home}/workzone`, text.workzone],
    [`${home}/research`, text.newsroom],
    [`${home}/content`, text.articles],
    [`${home}/videos`, text.videos],
    [`${home}/websites`, text.website],
    [`${home}/social/accounts`, text.channels],
    [`${home}/social/analytics`, text.analytics],
    [`${home}/social/composer`, text.composer],
    [`${home}/social/review`, text.review],
    [`${home}/social/calendar`, text.calendar],
    [`${home}/social/publications`, text.publications],
    [`${home}/social/preflight`, text.preflight],
    [`${home}/people`, text.people],
    [`${home}/settings/workzones`, text.workzoneSetup],
    [`${home}/settings/api`, text.apiAccess],
    [`${home}/#operations`, text.operations],
  ] as const;
  return (
    <aside className="media-sidebar" aria-label={text.mediaControl}>
      <Link href={home} className="media-brand">
        <span aria-hidden="true">◇</span> REDI CONTROL
      </Link>
      <p className="media-sidebar-label">{text.mediaControl}</p>
      <nav>
        {items.map(([href, label]) => {
          const path = href.split("#")[0] ?? home;
          const active = href.includes("#")
            ? pathname === home
            : path === home
              ? pathname === home
              : pathname.startsWith(path);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "active" : undefined}
              href={href}
              key={href}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="media-account">
        <span>RC</span>
        <p>
          <strong>REDI CONTROL</strong>
          <small>{text.workspace}</small>
        </p>
      </div>
    </aside>
  );
}
