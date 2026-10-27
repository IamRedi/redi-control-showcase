import { describe, expect, it } from "vitest";

import {
  classifyWorkspaceResponse,
  workspaceRequiredLabel,
} from "../app/workspace-onboarding-contract";

describe("workspace onboarding contract", () => {
  it("distinguishes absence from authentication and infrastructure failures", () => {
    expect(classifyWorkspaceResponse(401)).toBe("signed-out");
    expect(classifyWorkspaceResponse(404)).toBe("workspace-required");
    expect(classifyWorkspaceResponse(403)).toBe("unavailable");
    expect(classifyWorkspaceResponse(500)).toBe("unavailable");
  });

  it("provides a localized compact label for every enabled UI locale", () => {
    expect(workspaceRequiredLabel("en")).toBe("Workzone setup required");
    expect(workspaceRequiredLabel("de")).toBe(
      "Workzone-Einrichtung erforderlich",
    );
    expect(workspaceRequiredLabel("sq")).toBe(
      "Kërkohet konfigurimi i Workzone-it",
    );
  });
});
