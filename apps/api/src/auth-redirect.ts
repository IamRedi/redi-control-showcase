import { enabledLocales } from "@redi-control/config";

const validationOrigin = "https://redi-control.invalid";

function hasUnsafePathCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code <= 31 || code === 127;
  });
}

export function normalizePostLoginPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafePathCharacters(value)
  )
    return "/";

  try {
    const parsed = new URL(value, validationOrigin);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const locale = parsed.pathname.split("/")[1];
    if (
      parsed.origin !== validationOrigin ||
      parsed.hash ||
      hasUnsafePathCharacters(decodedPath) ||
      !enabledLocales.some((enabled) => enabled === locale) ||
      (parsed.pathname !== `/${locale}` &&
        !parsed.pathname.startsWith(`/${locale}/`))
    )
      return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}
