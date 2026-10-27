import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import console from "node:console";

const source = new URL(
  "../docs/standards/REDION_WORK_STANDARD-v0.1.0-draft.md",
  import.meta.url,
);
const expected =
  "84a01f22d031aa3a1074db637d39a5e108f080ab3f0da04e579e9d6970d071d4";
const actual = createHash("sha256").update(readFileSync(source)).digest("hex");
if (actual !== expected)
  throw new Error("Frozen RWS standard checksum mismatch");
console.log("Frozen RWS standard: byte-identical SHA-256 verified.");
