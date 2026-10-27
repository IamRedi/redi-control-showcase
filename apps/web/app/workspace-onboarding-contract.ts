export type WorkspaceLocale = "en" | "de" | "sq";

const copy = {
  en: {
    label: "Workzone setup required",
    title: "Create the first Workzone",
    body: "This media does not have an active Workzone yet. Create one to unlock the editorial dashboard, Workboard and Social Control.",
    action: "Set up Workzone",
  },
  de: {
    label: "Workzone-Einrichtung erforderlich",
    title: "Erste Workzone erstellen",
    body: "Dieses Medium hat noch keine aktive Workzone. Erstellen Sie eine, um Dashboard, Workboard und Social Control freizuschalten.",
    action: "Workzone einrichten",
  },
  sq: {
    label: "Kërkohet konfigurimi i Workzone-it",
    title: "Krijo Workzone-in e parë",
    body: "Kjo media nuk ka ende Workzone aktive. Krijoje për të hapur panelin editorial, Workboard-in dhe Social Control.",
    action: "Konfiguro Workzone-in",
  },
} as const satisfies Record<WorkspaceLocale, Record<string, string>>;

export type WorkspaceResponseState =
  | "signed-out"
  | "workspace-required"
  | "unavailable";

export function classifyWorkspaceResponse(
  status: number,
): WorkspaceResponseState {
  if (status === 401) return "signed-out";
  if (status === 404) return "workspace-required";
  return "unavailable";
}

export function workspaceOnboardingCopy(locale: WorkspaceLocale) {
  return copy[locale];
}

export function workspaceRequiredLabel(locale: WorkspaceLocale): string {
  return copy[locale].label;
}
