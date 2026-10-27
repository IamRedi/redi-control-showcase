import type { IdentityAdapter } from "@redi-control/identity";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const identity: IdentityAdapter = {
  id: "test",
  begin: () =>
    Promise.resolve({
      authorizationUrl: "https://identity.test/authorize",
      transaction: "test-transaction",
    }),
  complete: () => Promise.reject(new Error("Not used by this contract test")),
};

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setCookies(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string[] {
  const header = response.headers["set-cookie"];
  return Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
}

describe("OIDC login return cookie", () => {
  it("uses a secure host-only cookie for a valid locale destination", async () => {
    const app = buildApp({
      identity,
      cookieSecure: true,
      publicApiUrl: "https://control.example.test",
    });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/auth/login?returnTo=%2Fsq%2Fworkzone",
    });
    const redirectCookie = setCookies(response).find((value) =>
      value.startsWith("__Host-redi_post_login="),
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://identity.test/authorize");
    expect(redirectCookie).toContain("=/sq/workzone;");
    expect(redirectCookie).toContain("Path=/");
    expect(redirectCookie).toContain("HttpOnly");
    expect(redirectCookie).toContain("Secure");
    expect(redirectCookie).toContain("SameSite=Lax");
  });

  it("expires prior return state when the destination is unsafe", async () => {
    const app = buildApp({
      identity,
      cookieSecure: true,
      publicApiUrl: "https://control.example.test",
    });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/auth/login?returnTo=https%3A%2F%2Fevil.invalid",
    });
    const redirectCookie = setCookies(response).find((value) =>
      value.startsWith("__Host-redi_post_login="),
    );

    expect(response.statusCode).toBe(302);
    expect(redirectCookie).toContain("Max-Age=0");
    expect(redirectCookie).toContain("Path=/");
    expect(redirectCookie).toContain("Secure");
  });
});
