import { describe, expect, it } from "vitest";

import { boundedBody, forward } from "../app/workzone-provisioning-bff.js";

describe("Workzone provisioning BFF contract", () => {
  it("preserves successful empty mutation responses without inventing a body", async () => {
    const response = await forward(new Response(null, { status: 204 }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an oversized request even when content-length is absent", async () => {
    await expect(
      boundedBody(
        new Request("http://localhost/api/workzone-provisioning", {
          method: "POST",
          body: "x".repeat(4_001),
        }),
      ),
    ).rejects.toThrow("Request too large");
  });
});
