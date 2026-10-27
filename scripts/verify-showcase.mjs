import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import process from "node:process";
import console from "node:console";
const root = process.cwd();
const sha = (path) =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");
let files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
if (!files.length) {
  const walk = (dir = "") =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (
        [".git", "node_modules", ".next", "dist", "tmp", ".showcase"].includes(
          e.name,
        )
      )
        return [];
      return e.isDirectory() ? walk(p) : [p.replaceAll("\\", "/")];
    });
  files = walk();
}
for (const path of files) {
  assert.ok(
    ![".env", "AGENTS.md", "CLAUDE.md"].includes(basename(path)),
    "Forbidden private file: " + path,
  );
  assert.ok(
    ![
      ".pem",
      ".key",
      ".dump",
      ".sqlite",
      ".db",
      ".pdf",
      ".p12",
      ".pfx",
    ].includes(extname(path)),
    "Forbidden asset: " + path,
  );
  assert.ok(
    !/(^|\/)(NEXT_AGENT_HANDOFF|WORKLOG|LOCAL_AUDIT|TASKS)\.md$/.test(path),
  );
}
const snapshot = JSON.parse(readFileSync("docs/source-snapshot.json", "utf8"));
assert.equal(
  snapshot.source_commit,
  "3816fb4757596a7e5cae7913734dc4d36969ec5d",
);
for (const item of [
  ...snapshot.unchanged_production_files,
  ...snapshot.sanitized_production_files,
])
  assert.equal(
    sha(item.path),
    item.sha256,
    "Source manifest drift: " + item.path,
  );
const media = JSON.parse(
  readFileSync("docs/assets/media-manifest.json", "utf8"),
);
assert.equal(media.review_state, "DRAFT_OWNER_REVIEW");
assert.equal(media.real_provider_calls, 0);
assert.equal(media.real_publications, 0);
for (const item of media.media)
  assert.equal(sha(item.path), item.sha256, "Media drift: " + item.path);
for (const path of [
  "README.md",
  "README.en.md",
  "EVIDENCE.md",
  "docs/ENGINEERING.md",
  "docs/DEMO.md",
]) {
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const dest = m[1];
    if (/^(https?:|#)/.test(dest)) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    assert.ok(
      existsSync(join(root, dir, dest.split("#")[0])),
      "Missing documentation link: " + path + " -> " + dest,
    );
  }
}
console.log(
  `Showcase verified: ${files.length} files; source/media hashes and privacy file guard passed.`,
);
