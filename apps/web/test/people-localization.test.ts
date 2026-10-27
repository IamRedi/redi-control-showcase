import { describe, expect, it } from "vitest";

import {
  peopleCopy,
  peopleRoleLabel,
} from "../app/[locale]/people/people-copy";

describe("people localization", () => {
  it("provides complete localized copy for every enabled UI locale", () => {
    expect(peopleCopy.en.title).toBe("People & roles");
    expect(peopleCopy.de.send).toBe("Sichere Einladung senden");
    expect(peopleCopy.sq.title).toBe("Njerëzit dhe rolet");
    expect(peopleCopy.sq.send).toBe("Dërgo ftesën e sigurt");
  });

  it("localizes every accepted role and safely formats unknown future roles", () => {
    for (const role of [
      "root_owner",
      "white_label_owner",
      "admin",
      "approver",
      "editor",
      "analyst",
    ]) {
      expect(peopleRoleLabel(peopleCopy.sq, role)).not.toContain("_");
      expect(peopleRoleLabel(peopleCopy.de, role)).not.toContain("_");
    }

    expect(peopleRoleLabel(peopleCopy.en, "future_role")).toBe("future role");
  });
});
