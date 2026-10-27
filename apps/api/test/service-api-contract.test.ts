import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

describe("Installation API OpenAPI contract", () => {
  it("documents only the accepted read-only v1 machine API", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const contract = response.json<{
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    }>();
    expect(contract.openapi).toBe("3.1.0");
    expect(Object.keys(contract.paths)).toEqual([
      "/api/v1/oauth/token",
      "/api/v1/control/summary",
    ]);
    expect(contract.paths["/api/v1/control/summary"]).toHaveProperty("get");
    expect(JSON.stringify(contract.paths)).not.toMatch(
      /article|social|publish/i,
    );
  });
});
