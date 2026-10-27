import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const preload = fileURLToPath(
  new URL("./showcase-offline.mjs", import.meta.url),
);
const attempts = [
  'await fetch("https://example.com")',
  '(await import("node:net")).connect({host:"203.0.113.10",port:443})',
  '(await import("node:https")).get("https://example.com")',
];
for (const attempt of attempts) {
  const code = `try { ${attempt}; process.exitCode=2; } catch(e) { if (!String(e).includes("SHOWCASE_OFFLINE")) throw e; console.log("BLOCKED"); }`;
  const result = spawnSync(
    process.execPath,
    ["--import", preload, "--input-type=module", "--eval", code],
    { encoding: "utf8", timeout: 3000 },
  );
  assert.equal(
    result.status,
    0,
    "External transport was not rejected immediately",
  );
  assert.equal(result.stdout.trim(), "BLOCKED");
}
console.log(
  "Offline boundary: fetch, TCP and HTTPS outbound attempts blocked (3 checks).",
);
