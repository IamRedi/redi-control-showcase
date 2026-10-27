import type { EnabledLocale } from "@redi-control/config";

export interface Messages {
  readonly overview: string;
  readonly security: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly status: string;
  readonly identityTitle: string;
  readonly identityBody: string;
  readonly tenancyTitle: string;
  readonly tenancyBody: string;
  readonly disabledTitle: string;
  readonly disabledBody: string;
  readonly platforms: string;
  readonly connections: string;
  readonly registryTitle: string;
  readonly registryBody: string;
  readonly referenceTitle: string;
  readonly referenceBody: string;
  readonly connectionTitle: string;
  readonly connectionBody: string;
  readonly auditTitle: string;
  readonly auditBody: string;
  readonly media: string;
  readonly publishing: string;
  readonly mediaTitle: string;
  readonly mediaBody: string;
  readonly composerTitle: string;
  readonly composerBody: string;
  readonly calendarTitle: string;
  readonly calendarBody: string;
  readonly accountsTitle: string;
  readonly accountsBody: string;
  readonly tiktokTitle: string;
  readonly tiktokBody: string;
  readonly owner: string;
  readonly searchLabel: string;
  readonly notifications: string;
  readonly help: string;
  readonly systemStatus: string;
  readonly sampleLabel: string;
  readonly sampleNotice: string;
  readonly visitors: string;
  readonly users: string;
  readonly bookings: string;
  readonly leads: string;
  readonly healthy: string;
  readonly sampleChart: string;
  readonly commandCenter: string;
  readonly commandSubtitle: string;
  readonly commandPlaceholder: string;
  readonly send: string;
  readonly analyse: string;
  readonly analyseHint: string;
  readonly suggest: string;
  readonly suggestHint: string;
  readonly keyMetrics: string;
  readonly activeClients: string;
  readonly scheduledPosts: string;
  readonly systemHealth: string;
  readonly sampleTrend: string;
  readonly socialPublishing: string;
  readonly demoMode: string;
  readonly viewCalendar: string;
  readonly calendarWeek: string;
  readonly mon: string;
  readonly tue: string;
  readonly wed: string;
  readonly thu: string;
  readonly fri: string;
  readonly sat: string;
  readonly sun: string;
  readonly samplePost: string;
  readonly demoCalendar: string;
  readonly viewAll: string;
  readonly operations: string;
  readonly approvalQueue: string;
  readonly websiteUpdate: string;
  readonly socialPost: string;
  readonly blogPost: string;
  readonly pendingReview: string;
  readonly approve: string;
  readonly review: string;
  readonly alerts: string;
  readonly sampleAlert: string;
  readonly alertHint: string;
  readonly activity: string;
  readonly activityWebsite: string;
  readonly activityLead: string;
  readonly activitySocial: string;
  readonly activityAutomation: string;
  readonly activityBackup: string;
  readonly hoursAgo: string;
  readonly liveLoading: string;
  readonly liveSignedOut: string;
  readonly liveUnavailable: string;
  readonly readyMedia: string;
}

export const messages: Readonly<Record<EnabledLocale, Messages>> = {
  en: {
    overview: "Overview",
    security: "Security",
    eyebrow: "Milestone 3A",
    title: "Media Library & Social Publishing",
    status: "Local verification · providers disabled by default",
    identityTitle: "Identity & sessions",
    identityBody:
      "Provider-neutral identity with secure rotating server-side sessions.",
    tenancyTitle: "Tenant isolation",
    tenancyBody:
      "RBAC and PostgreSQL row-level security are enforced together.",
    disabledTitle: "External modules disabled",
    disabledBody:
      "Live provider publishing, AI, BusinessSite and PitLaneOne remain outside this milestone.",
    platforms: "Platforms",
    connections: "Connections",
    registryTitle: "Connector registry",
    registryBody:
      "Versioned manifests expose only declared scopes, capabilities, health and compatibility.",
    referenceTitle: "Reference SaaS (local)",
    referenceBody:
      "Available for deterministic local read-only verification; no external account or credential.",
    connectionTitle: "Connection status",
    connectionBody:
      "Test connections can be created, health-checked and disabled through the authenticated API.",
    auditTitle: "Audit trail",
    auditBody:
      "Connection lifecycle, health and read commands produce tenant-scoped audit and outbox evidence.",
    media: "Media library",
    publishing: "Publishing",
    mediaTitle: "Media library",
    mediaBody:
      "Upload images and videos directly to tenant-scoped storage, then verify scan and processing status.",
    composerTitle: "Draft & review",
    composerBody:
      "Create immutable revisions, request review and publish only the exact approved content.",
    calendarTitle: "Publishing calendar",
    calendarBody:
      "Schedule approved targets with an explicit IANA timezone and inspect per-channel outcomes.",
    accountsTitle: "Social accounts",
    accountsBody:
      "Meta and YouTube require provider configuration. Tokens are stored only through secret references.",
    tiktokTitle: "TikTok",
    tiktokBody:
      "Requires provider approval and remains disabled in this milestone.",
    owner: "Owner",
    searchLabel: "Search platforms, websites, posts, automations…",
    notifications: "Notifications",
    help: "Help",
    systemStatus: "Sample data · no live providers",
    sampleLabel: "Preview",
    sampleNotice:
      "Dashboard values below are sample data until a verified API source is connected.",
    visitors: "Visitors (7d)",
    users: "Users (7d)",
    bookings: "Bookings (7d)",
    leads: "Leads (7d)",
    healthy: "Sample status",
    sampleChart: "Sample trend chart",
    commandCenter: "AI Command Center",
    commandSubtitle:
      "Future AI actions require approved tools, budgets and human review.",
    commandPlaceholder: "What should we improve today?",
    send: "Send",
    analyse: "Analyse last week's performance",
    analyseHint: "Available after verified analytics are connected.",
    suggest: "Suggest content ideas",
    suggestHint: "AI generation is not enabled yet.",
    keyMetrics: "Key metrics",
    activeClients: "Active clients",
    scheduledPosts: "Scheduled posts",
    systemHealth: "System health",
    sampleTrend: "sample",
    socialPublishing: "Social Publishing",
    demoMode: "Demo mode",
    viewCalendar: "View calendar",
    calendarWeek: "May 19 – May 25",
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
    samplePost: "Sample post",
    demoCalendar: "Sample schedule — publishing disabled",
    viewAll: "View all",
    operations: "Operations",
    approvalQueue: "Approval Queue",
    websiteUpdate: "Website update",
    socialPost: "Social post",
    blogPost: "Blog post",
    pendingReview: "Sample item · pending review",
    approve: "Approve",
    review: "Review",
    alerts: "Alerts",
    sampleAlert: "Sample alert",
    alertHint:
      "Operational alerts appear here after a verified source is connected.",
    activity: "Activity",
    activityWebsite: "Website update published",
    activityLead: "New lead captured",
    activitySocial: "Social post queued",
    activityAutomation: "Automation preview completed",
    activityBackup: "Backup check recorded",
    hoursAgo: "sample",
    liveLoading: "Loading verified workspace data…",
    liveSignedOut: "Sign in to view verified workspace data.",
    liveUnavailable: "Verified workspace data is not available yet.",
    readyMedia: "Ready media",
  },
  de: {
    overview: "Übersicht",
    security: "Sicherheit",
    eyebrow: "Meilenstein 3A",
    title: "Medienbibliothek & Social Publishing",
    status: "Lokale Prüfung · Provider standardmäßig deaktiviert",
    identityTitle: "Identität & Sitzungen",
    identityBody:
      "Anbieterneutrale Identität mit sicheren, rotierenden serverseitigen Sitzungen.",
    tenancyTitle: "Mandantentrennung",
    tenancyBody:
      "RBAC und PostgreSQL Row-Level Security werden gemeinsam erzwungen.",
    disabledTitle: "Externe Module deaktiviert",
    disabledBody:
      "Live-Publishing, KI, BusinessSite und PitLaneOne bleiben außerhalb dieses Meilensteins.",
    platforms: "Plattformen",
    connections: "Verbindungen",
    registryTitle: "Connector-Register",
    registryBody:
      "Versionierte Manifeste geben nur deklarierte Scopes, Fähigkeiten, Health und Kompatibilität frei.",
    referenceTitle: "Referenz-SaaS (lokal)",
    referenceBody:
      "Für deterministische lokale Nur-Lese-Prüfungen verfügbar; kein externes Konto oder Zugangsdaten.",
    connectionTitle: "Verbindungsstatus",
    connectionBody:
      "Testverbindungen können über die authentifizierte API erstellt, geprüft und deaktiviert werden.",
    auditTitle: "Audit-Trail",
    auditBody:
      "Lebenszyklus, Health und Lese-Befehle erzeugen mandantenspezifische Audit- und Outbox-Nachweise.",
    media: "Medienbibliothek",
    publishing: "Veröffentlichung",
    mediaTitle: "Medienbibliothek",
    mediaBody:
      "Bilder und Videos direkt in mandantenspezifischen Speicher laden und Scan- sowie Verarbeitungsstatus prüfen.",
    composerTitle: "Entwurf & Freigabe",
    composerBody:
      "Unveränderliche Revisionen erstellen, Prüfung anfordern und nur exakt freigegebene Inhalte veröffentlichen.",
    calendarTitle: "Veröffentlichungskalender",
    calendarBody:
      "Freigegebene Ziele mit expliziter IANA-Zeitzone planen und Ergebnisse je Kanal prüfen.",
    accountsTitle: "Social-Konten",
    accountsBody:
      "Meta und YouTube benötigen Provider-Konfiguration. Tokens werden nur über Secret-Referenzen gespeichert.",
    tiktokTitle: "TikTok",
    tiktokBody:
      "Erfordert Provider-Freigabe und bleibt in diesem Meilenstein deaktiviert.",
    owner: "Inhaber",
    searchLabel: "Plattformen, Websites, Beiträge und Automationen suchen…",
    notifications: "Benachrichtigungen",
    help: "Hilfe",
    systemStatus: "Beispieldaten · keine Live-Provider",
    sampleLabel: "Vorschau",
    sampleNotice:
      "Die folgenden Werte sind Beispieldaten, bis eine verifizierte API-Quelle verbunden ist.",
    visitors: "Besucher (7 T.)",
    users: "Nutzer (7 T.)",
    bookings: "Buchungen (7 T.)",
    leads: "Leads (7 T.)",
    healthy: "Beispielstatus",
    sampleChart: "Beispiel-Trenddiagramm",
    commandCenter: "KI-Kommandozentrale",
    commandSubtitle:
      "Zukünftige KI-Aktionen benötigen freigegebene Tools, Budgets und Prüfung durch Menschen.",
    commandPlaceholder: "Was sollen wir heute verbessern?",
    send: "Senden",
    analyse: "Leistung der letzten Woche analysieren",
    analyseHint: "Verfügbar nach verifizierter Analytics-Anbindung.",
    suggest: "Content-Ideen vorschlagen",
    suggestHint: "KI-Generierung ist noch nicht aktiviert.",
    keyMetrics: "Kennzahlen",
    activeClients: "Aktive Kunden",
    scheduledPosts: "Geplante Beiträge",
    systemHealth: "Systemzustand",
    sampleTrend: "Beispiel",
    socialPublishing: "Social Publishing",
    demoMode: "Demo-Modus",
    viewCalendar: "Kalender öffnen",
    calendarWeek: "19. Mai – 25. Mai",
    mon: "Mo",
    tue: "Di",
    wed: "Mi",
    thu: "Do",
    fri: "Fr",
    sat: "Sa",
    sun: "So",
    samplePost: "Beispielbeitrag",
    demoCalendar: "Beispielplan · Veröffentlichung deaktiviert",
    viewAll: "Alle anzeigen",
    operations: "Betrieb",
    approvalQueue: "Freigaben",
    websiteUpdate: "Website-Update",
    socialPost: "Social-Beitrag",
    blogPost: "Blog-Beitrag",
    pendingReview: "Beispiel · Prüfung ausstehend",
    approve: "Freigeben",
    review: "Prüfen",
    alerts: "Hinweise",
    sampleAlert: "Beispielhinweis",
    alertHint:
      "Betriebshinweise erscheinen nach einer verifizierten Anbindung hier.",
    activity: "Aktivität",
    activityWebsite: "Website-Update veröffentlicht",
    activityLead: "Neuer Lead erfasst",
    activitySocial: "Social-Beitrag eingeplant",
    activityAutomation: "Automationsvorschau abgeschlossen",
    activityBackup: "Backup-Prüfung protokolliert",
    hoursAgo: "Beispiel",
    liveLoading: "Verifizierte Workspace-Daten werden geladen…",
    liveSignedOut: "Anmelden, um verifizierte Workspace-Daten zu sehen.",
    liveUnavailable: "Verifizierte Workspace-Daten sind noch nicht verfügbar.",
    readyMedia: "Bereite Medien",
  },
  sq: {
    overview: "Përmbledhje",
    security: "Siguria",
    eyebrow: "Milestone 3B-0",
    title: "Biblioteka e medias dhe publikimi social",
    status: "Verifikim lokal · ofruesit janë të çaktivizuar si parazgjedhje",
    identityTitle: "Identiteti dhe sesionet",
    identityBody:
      "Identitet i pavarur nga ofruesi, me sesione të sigurta që ruhen dhe rrotullohen në server.",
    tenancyTitle: "Izolimi i tenantëve",
    tenancyBody:
      "RBAC dhe siguria në nivel rreshti e PostgreSQL zbatohen së bashku.",
    disabledTitle: "Modulet e jashtme janë të çaktivizuara",
    disabledBody:
      "Publikimi me ofrues realë, AI, BusinessSite dhe PitLaneOne mbeten jashtë këtij milestone-i.",
    platforms: "Platformat",
    connections: "Lidhjet",
    registryTitle: "Regjistri i connector-ëve",
    registryBody:
      "Manifestet e versionuara ekspozojnë vetëm scopes, aftësi, health dhe pajtueshmëri të deklaruara.",
    referenceTitle: "SaaS referencë (lokal)",
    referenceBody:
      "I disponueshëm për verifikim lokal deterministik vetëm për lexim; pa llogari ose kredenciale të jashtme.",
    connectionTitle: "Gjendja e lidhjes",
    connectionBody:
      "Lidhjet testuese mund të krijohen, kontrollohen dhe çaktivizohen përmes API-së së autentikuar.",
    auditTitle: "Gjurmët e auditimit",
    auditBody:
      "Cikli i lidhjes, health checks dhe komandat e leximit krijojnë prova auditimi dhe outbox të izoluara sipas tenant-it.",
    media: "Biblioteka e medias",
    publishing: "Publikimi",
    mediaTitle: "Biblioteka e medias",
    mediaBody:
      "Ngarko imazhe dhe video drejtpërdrejt në storage-in e tenant-it dhe kontrollo gjendjen e skanimit e përpunimit.",
    composerTitle: "Drafti dhe shqyrtimi",
    composerBody:
      "Krijo versione të pandryshueshme, kërko shqyrtim dhe publiko vetëm përmbajtjen e miratuar saktësisht.",
    calendarTitle: "Kalendari i publikimeve",
    calendarBody:
      "Planifiko publikimet e miratuara me zonë kohore IANA dhe kontrollo rezultatin për çdo kanal.",
    accountsTitle: "Llogaritë sociale",
    accountsBody:
      "Meta dhe YouTube kërkojnë konfigurimin e ofruesit. Token-at ruhen vetëm përmes referencave të sekreteve.",
    tiktokTitle: "TikTok",
    tiktokBody:
      "Kërkon miratimin e ofruesit dhe mbetet i çaktivizuar në këtë milestone.",
    owner: "Pronari",
    searchLabel: "Kërko platforma, website, postime ose automatizime…",
    notifications: "Njoftimet",
    help: "Ndihmë",
    systemStatus: "Të dhëna demo · pa ofrues live",
    sampleLabel: "Parapamje",
    sampleNotice:
      "Vlerat më poshtë janë të dhëna demo derisa të lidhet një burim API i verifikuar.",
    visitors: "Vizitorë (7d)",
    users: "Përdorues (7d)",
    bookings: "Rezervime (7d)",
    leads: "Leads (7d)",
    healthy: "Status demo",
    sampleChart: "Grafik trendi demo",
    commandCenter: "Qendra e komandës AI",
    commandSubtitle:
      "Veprimet e ardhshme të AI kërkojnë mjete të miratuara, buxhete dhe shqyrtim njerëzor.",
    commandPlaceholder: "Çfarë duhet të përmirësojmë sot?",
    send: "Dërgo",
    analyse: "Analizo performancën e javës së kaluar",
    analyseHint: "Disponohet pasi të lidhen analytics të verifikuara.",
    suggest: "Sugjero ide për përmbajtje",
    suggestHint: "Gjenerimi me AI ende nuk është aktiv.",
    keyMetrics: "Metrikat kryesore",
    activeClients: "Klientë aktivë",
    scheduledPosts: "Postime të planifikuara",
    systemHealth: "Gjendja e sistemit",
    sampleTrend: "demo",
    socialPublishing: "Publikimi social",
    demoMode: "Modalitet demo",
    viewCalendar: "Shiko kalendarin",
    calendarWeek: "19 Maj – 25 Maj",
    mon: "Hën",
    tue: "Mar",
    wed: "Mër",
    thu: "Enj",
    fri: "Pre",
    sat: "Sht",
    sun: "Die",
    samplePost: "Postim demo",
    demoCalendar: "Plan demo · publikimi është i çaktivizuar",
    viewAll: "Shiko të gjitha",
    operations: "Operimet",
    approvalQueue: "Radha e miratimeve",
    websiteUpdate: "Përditësim i website-it",
    socialPost: "Postim social",
    blogPost: "Postim blogu",
    pendingReview: "Element demo · në pritje të shqyrtimit",
    approve: "Mirato",
    review: "Shqyrto",
    alerts: "Njoftime",
    sampleAlert: "Njoftim demo",
    alertHint:
      "Njoftimet operative do të shfaqen këtu pas një burimi të verifikuar.",
    activity: "Aktiviteti",
    activityWebsite: "Përditësimi i website-it u publikua",
    activityLead: "U regjistrua një lead i ri",
    activitySocial: "Postimi social u planifikua",
    activityAutomation: "Parapamja e automatizimit përfundoi",
    activityBackup: "Kontrolli i backup-it u regjistrua",
    hoursAgo: "demo",
    liveLoading: "Po ngarkohen të dhënat e verifikuara të workspace-it…",
    liveSignedOut: "Hyr për të parë të dhënat e verifikuara të workspace-it.",
    liveUnavailable:
      "Të dhënat e verifikuara të workspace-it ende nuk janë të disponueshme.",
    readyMedia: "Media gati",
  },
};
