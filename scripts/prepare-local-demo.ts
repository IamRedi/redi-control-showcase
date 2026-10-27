import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPool, prepareLocalDemoData } from "@redi-control/database";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertLocalDatabase(connectionString: string): void {
  if (process.env.DEPLOYMENT_ENV !== "local")
    throw new Error("Local demo preparation requires DEPLOYMENT_ENV=local");
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname))
    throw new Error("Local demo preparation refuses a non-loopback database");
}

async function main(): Promise<void> {
  const adminUrl = required("DATABASE_ADMIN_URL");
  assertLocalDatabase(adminUrl);
  const pool = createPool(adminUrl, "redi-control-local-demo-prepare");
  try {
    const prepared = await prepareLocalDemoData(pool);
    const directory = resolve("tmp");
    const tokenFile = resolve(directory, "local-demo-token");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(tokenFile, `${prepared.token}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "w",
    });
    await chmod(tokenFile, 0o600);
    process.stdout.write(
      `Synthetic local demo prepared. One-time token written mode 0600 to ${tokenFile}. It expires at ${prepared.expiresAt.toISOString()}.\n`,
    );
  } finally {
    await pool.end();
  }
}

void main();
