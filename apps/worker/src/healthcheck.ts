import { loadWorkerRuntimeConfig } from "@redi-control/config";
import { createPool } from "@redi-control/database";
import { readFileSync, statSync } from "node:fs";

function databaseUrl(environment: NodeJS.ProcessEnv): string | undefined {
  const direct = environment.DATABASE_URL?.trim();
  if (direct) return direct;
  const file = environment.DATABASE_URL_FILE?.trim();
  return file ? readFileSync(file, "utf8").trim() : undefined;
}

const config = loadWorkerRuntimeConfig({
  ...process.env,
  DATABASE_URL: databaseUrl(process.env),
});

if (!config.WORKER_HEALTH_FILE) throw new Error("WORKER_HEALTH_FILE_REQUIRED");
const heartbeat = statSync(config.WORKER_HEALTH_FILE);
if (Date.now() - heartbeat.mtimeMs > config.WORKER_HEALTH_MAX_AGE_MS)
  throw new Error("WORKER_HEARTBEAT_STALE");

const pool = createPool(config.DATABASE_URL, "redi-control-worker-health");
try {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM control.schema_migrations",
  );
  if ((result.rows[0]?.count ?? 0) < config.EXPECTED_MIGRATION_COUNT)
    throw new Error("WORKER_MIGRATIONS_NOT_READY");
} finally {
  await pool.end();
}
