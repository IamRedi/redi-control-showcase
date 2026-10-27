import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

describe("first-owner bootstrap public boundary", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves a script-free POST form with a narrowly scoped CSP", async () => {
    const app = buildApp({ cookieSecure: true });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/auth/bootstrap",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain(
      "form-action 'self'",
    );
    expect(response.body).toContain('method="post"');
    expect(response.body).not.toContain("<script");
  });

  it("rejects malformed tokens before identity or database work", async () => {
    const app = buildApp({ cookieSecure: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/bootstrap",
      payload: { token: "not-a-token" },
    });
    expect(response.statusCode).toBe(400);
  });
});
