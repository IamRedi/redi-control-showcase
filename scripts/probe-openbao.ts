import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { OpenBaoTokenSecretProvider } from "@redi-control/media-social";

function value(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  throw new Error(`Missing ${name} or ${name}_FILE`);
}

async function main(): Promise<void> {
  const secrets = new OpenBaoTokenSecretProvider({
    address: value("OPENBAO_ADDRESS"),
    roleId: value("OPENBAO_APPROLE_ROLE_ID"),
    secretId: value("OPENBAO_APPROLE_SECRET_ID"),
    requestTimeoutMs: 5_000,
  });
  const context = { tenantId: randomUUID(), connectionId: randomUUID() };
  const reference = `secret://probe/${randomUUID()}`;
  const expected = randomBytes(48).toString("base64url");
  let stored = false;

  try {
    if (!(await secrets.health())) throw new Error("OpenBao health failed");
    await secrets.store(reference, expected, context);
    stored = true;
    const resolved = await secrets.resolve(reference, context);
    if (resolved !== expected) throw new Error("OpenBao round-trip mismatch");
  } finally {
    if (stored) await secrets.revoke(reference, context);
  }

  await secrets
    .resolve(reference, context)
    .then(() => {
      throw new Error("Revoked OpenBao probe secret remained readable");
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "SECRET_UNAVAILABLE")
        throw error;
    });

  process.stdout.write(
    "OpenBao AppRole health and tenant-bound store/resolve/revoke probe passed.\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "OpenBao probe failed"}\n`,
  );
  process.exitCode = 1;
});
