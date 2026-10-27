import type { EnabledLocale } from "@redi-control/config";

export interface PeopleCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly inviteEyebrow: string;
  readonly inviteTitle: string;
  readonly inviteBody: string;
  readonly email: string;
  readonly role: string;
  readonly roles: Readonly<Record<string, string>>;
  readonly sending: string;
  readonly send: string;
  readonly sent: string;
  readonly inviteError: string;
  readonly currentUser: string;
  readonly empty: string;
}

export const peopleCopy = {
  en: {
    eyebrow: "Media access",
    title: "People & roles",
    intro:
      "Invite verified journalists and manage the people who can work only inside this media.",
    loading: "Loading verified members…",
    unavailable:
      "Member data is unavailable. Sign in with an administrator role and recent MFA.",
    inviteEyebrow: "Invite journalist",
    inviteTitle: "Give media-only access",
    inviteBody:
      "The journalist receives a verified email link, creates their own password and activates TOTP. The invitation expires after 24 hours.",
    email: "Email address",
    role: "Role",
    roles: {
      root_owner: "Root Owner",
      white_label_owner: "White-label Owner",
      admin: "Administrator",
      approver: "Approver",
      editor: "Editor",
      analyst: "Analyst",
    },
    sending: "Sending…",
    send: "Send secure invitation",
    sent: "Invitation sent. It will expire automatically after 24 hours.",
    inviteError:
      "The invitation could not be sent. Confirm that identity email delivery is active.",
    currentUser: "Current user",
    empty: "No members were found for this media.",
  },
  de: {
    eyebrow: "Medienzugang",
    title: "Personen & Rollen",
    intro:
      "Verifizierte Redaktionsmitglieder einladen und die Personen verwalten, die ausschließlich in diesem Medium arbeiten dürfen.",
    loading: "Verifizierte Mitglieder werden geladen…",
    unavailable:
      "Mitgliedsdaten sind nicht verfügbar. Melden Sie sich mit Administratorrolle und aktueller MFA an.",
    inviteEyebrow: "Redaktionsmitglied einladen",
    inviteTitle: "Zugriff nur auf dieses Medium gewähren",
    inviteBody:
      "Das Redaktionsmitglied erhält einen verifizierten E-Mail-Link, erstellt ein eigenes Passwort und aktiviert TOTP. Die Einladung läuft nach 24 Stunden ab.",
    email: "E-Mail-Adresse",
    role: "Rolle",
    roles: {
      root_owner: "Root Owner",
      white_label_owner: "White-Label Owner",
      admin: "Administrator",
      approver: "Freigabe",
      editor: "Redaktion",
      analyst: "Analyse",
    },
    sending: "Wird gesendet…",
    send: "Sichere Einladung senden",
    sent: "Einladung gesendet. Sie läuft automatisch nach 24 Stunden ab.",
    inviteError:
      "Die Einladung konnte nicht gesendet werden. Prüfen Sie, ob der E-Mail-Versand der Identitätsverwaltung aktiv ist.",
    currentUser: "Aktueller Benutzer",
    empty: "Für dieses Medium wurden keine Mitglieder gefunden.",
  },
  sq: {
    eyebrow: "Aksesi i medias",
    title: "Njerëzit dhe rolet",
    intro:
      "Fto gazetarë të verifikuar dhe menaxho personat që mund të punojnë vetëm brenda kësaj mediaje.",
    loading: "Po ngarkohen anëtarët e verifikuar…",
    unavailable:
      "Të dhënat e anëtarëve nuk janë të disponueshme. Hyni me rol administratori dhe MFA të freskët.",
    inviteEyebrow: "Fto gazetar",
    inviteTitle: "Jep akses vetëm për këtë media",
    inviteBody:
      "Gazetari merr një lidhje të verifikuar me email, krijon fjalëkalimin e vet dhe aktivizon TOTP. Ftesa skadon pas 24 orësh.",
    email: "Adresa e emailit",
    role: "Roli",
    roles: {
      root_owner: "Pronari kryesor",
      white_label_owner: "Pronari White-label",
      admin: "Administrator",
      approver: "Aprovues",
      editor: "Redaktor",
      analyst: "Analist",
    },
    sending: "Po dërgohet…",
    send: "Dërgo ftesën e sigurt",
    sent: "Ftesa u dërgua. Ajo do të skadojë automatikisht pas 24 orësh.",
    inviteError:
      "Ftesa nuk mund të dërgohej. Kontrolloni që dërgimi i emailit të identitetit është aktiv.",
    currentUser: "Përdoruesi aktual",
    empty: "Nuk u gjet asnjë anëtar për këtë media.",
  },
} as const satisfies Readonly<Record<EnabledLocale, PeopleCopy>>;

export function peopleRoleLabel(copy: PeopleCopy, role: string): string {
  return copy.roles[role] ?? role.replaceAll("_", " ");
}
