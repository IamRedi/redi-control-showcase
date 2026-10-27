import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("local demonstration form destination", () => {
  it("allows only the configured loopback web origin for the local form", async () => {
    const app = buildApp({
      localDemoEnabled: true,
      publicWebUrl: "http://127.0.0.1:8787",
    });
    try {
      const form = await app.inject({ method: "GET", url: "/auth/local-demo" });
      expect(form.statusCode).toBe(200);
      expect(form.headers["content-security-policy"]).toContain(
        "form-action 'self' http://127.0.0.1:8787;",
      );
      expect(form.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      const bootstrap = await app.inject({
        method: "GET",
        url: "/auth/bootstrap",
      });
      expect(bootstrap.headers["content-security-policy"]).toContain(
        "form-action 'self';",
      );
      expect(bootstrap.headers["content-security-policy"]).not.toContain(
        "127.0.0.1:8787",
      );
    } finally {
      await app.close();
    }
  });
  it("rejects external or non-HTTP destinations instead of expanding form authority", () => {
    for (const url of [
      "https://example.com",
      "http://127.0.0.1.example.com",
      "file:///tmp/demo",
    ]) {
      expect(() =>
        buildApp({ localDemoEnabled: true, publicWebUrl: url }),
      ).toThrow("Local demonstration redirects require a loopback web origin");
    }
  });
});
