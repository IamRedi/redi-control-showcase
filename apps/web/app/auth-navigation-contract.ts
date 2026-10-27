export type AuthLocale = "en" | "de" | "sq";

export function localizedLoginHref(locale: AuthLocale, suffix = ""): string {
  if (suffix && (!suffix.startsWith("/") || suffix.startsWith("//")))
    throw new Error("Login return path must be a local path suffix");
  return `/auth/login?returnTo=${encodeURIComponent(`/${locale}${suffix}`)}`;
}
