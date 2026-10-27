import { loadWorkerRuntimeConfig } from "@redi-control/config";
import {
  claimNextSourceIngestionJob,
  createPool,
  finishJob,
} from "@redi-control/database";
import type { SecretProvider } from "@redi-control/connector-sdk";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import {
  HardenedOutboundFetcher,
  SourceIngestionService,
  type ApiFeedProvider,
  type SearchDiscoveryProvider,
} from "@redi-control/source-ingestion";

export async function runWorker(
  environment: NodeJS.ProcessEnv,
  dependencies: {
    secretProvider?: SecretProvider;
    searchProviders?: SearchDiscoveryProvider[];
    apiFeedProviders?: ApiFeedProvider[];
  } = {},
): Promise<() => Promise<void>> {
  const databaseUrl =
    environment.DATABASE_URL?.trim() ||
    (environment.DATABASE_URL_FILE
      ? readFileSync(environment.DATABASE_URL_FILE, "utf8").trim()
      : undefined);
  const config = loadWorkerRuntimeConfig({
    ...environment,
    DATABASE_URL: databaseUrl,
  });
  const pool = createPool(config.DATABASE_URL, "redi-control-worker");
  const migration = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM control.schema_migrations",
  );
  if ((migration.rows[0]?.count ?? 0) < config.EXPECTED_MIGRATION_COUNT) {
    await pool.end();
    throw new Error("WORKER_MIGRATIONS_NOT_READY");
  }
  let stopped = false;
  const workerId = `source-worker-${process.pid}`;
  const ingestion = new SourceIngestionService(pool, {
    fetcher: new HardenedOutboundFetcher({
      timeoutMs: config.SOURCE_FETCH_TIMEOUT_MS,
      maxBytes: config.SOURCE_FETCH_MAX_BYTES,
      userAgent: config.SOURCE_FETCH_USER_AGENT,
    }),
    ...dependencies,
  });
  const active = new Set<Promise<void>>();
  const execute = async (): Promise<void> => {
    while (!stopped && active.size < config.WORKER_CONCURRENCY) {
      const job = await claimNextSourceIngestionJob(pool, workerId);
      if (!job) break;
      const task = ingestion
        .process(job)
        .then(() => finishJob(pool, job, { status: "succeeded" }))
        .catch((error: unknown) =>
          finishJob(pool, job, {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "SOURCE_INGESTION_FAILED",
          }),
        )
        .finally(() => active.delete(task));
      active.add(task);
    }
  };
  const poll = async (): Promise<void> => {
    if (stopped) return;
    await execute();
    const result = await pool.query<{ pending: number }>(
      "SELECT count(*)::int AS pending FROM control.outbox_events WHERE published_at IS NULL",
    );
    process.stdout.write(
      `${JSON.stringify({ level: "info", component: "worker", concurrency: config.WORKER_CONCURRENCY, pendingOutbox: result.rows[0]?.pending ?? 0 })}\n`,
    );
    if (config.WORKER_HEALTH_FILE)
      await writeFile(config.WORKER_HEALTH_FILE, new Date().toISOString(), {
        encoding: "utf8",
        mode: 0o600,
      });
  };
  await poll();
  const timer = setInterval(
    () =>
      void poll().catch((error: unknown) =>
        process.stderr.write(`${String(error)}\n`),
      ),
    1_000,
  );
  return async () => {
    stopped = true;
    clearInterval(timer);
    await Promise.allSettled(active);
    await pool.end();
  };
}

if (process.env.NODE_ENV !== "test") {
  const stop = await runWorker(process.env);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void stop().then(() => process.exit(0)));
  }
}
