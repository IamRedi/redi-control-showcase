import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
} from "@redi-control/database";
import { expect, it } from "vitest";

it("upgrades existing social observations from 0043 without losing rows", async () => {
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required`);
    return value;
  };
  const options = {
    adminUrl: required("DATABASE_ADMIN_URL"),
    runtimePassword: required("DATABASE_RUNTIME_PASSWORD"),
    authPassword: required("DATABASE_AUTH_PASSWORD"),
  };
  const directory = fileURLToPath(
    new URL("../../../database/migrations/", import.meta.url),
  );
  const legacyDirectory = await mkdtemp(join(tmpdir(), "redi-metrics-0043-"));
  const admin = createPool(options.adminUrl, "social-metrics-upgrade-test");
  try {
    for (const name of await readdir(directory)) {
      if (name.endsWith(".sql") && name < "0044") {
        await copyFile(join(directory, name), join(legacyDirectory, name));
      }
    }
    await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
    await migrateDatabase({ ...options, migrationsDirectory: legacyDirectory });
    const seed = await seedLocalTestData(options.adminUrl);
    const account = randomUUID();
    const metric = randomUUID();
    await admin.query(
      `INSERT INTO control.social_accounts
       (id,tenant_id,workspace_id,provider,account_type,provider_account_id,display_name,token_reference)
       VALUES($1::uuid,$2,$3,'meta','facebook_page',$1::uuid::text,'Synthetic upgrade account','secret://test/upgrade')`,
      [account, seed.tenantA, seed.workspaceA],
    );
    await admin.query(
      `INSERT INTO control.social_metric_observations
       (id,tenant_id,workspace_id,account_id,metric_key,period_start,period_end,value)
       VALUES($1,$2,$3,$4,'followers_count','2026-09-01','2026-09-02',42)`,
      [metric, seed.tenantA, seed.workspaceA, account],
    );
    const before = await admin.query(
      "SELECT * FROM control.social_metric_observations WHERE id=$1",
      [metric],
    );
    await migrateDatabase(options);
    await migrateDatabase(options); // Replay verifies migration checksums/idempotence.
    const after = await admin.query(
      "SELECT * FROM control.social_metric_observations WHERE id=$1",
      [metric],
    );
    expect(after.rows).toEqual(before.rows);
    await admin.query(
      `UPDATE control.business_workspaces SET lifecycle_status='archived',
       archived_at=now(),archived_by=$2,archive_reason='Synthetic upgrade guard check'
       WHERE id=$1`,
      [seed.workspaceA, seed.adminUser],
    );
    await expect(
      admin.query(
        "UPDATE control.social_metric_observations SET value=99 WHERE id=$1",
        [metric],
      ),
    ).rejects.toMatchObject({ code: "55000", message: "WORKZONE_ARCHIVED" });
  } finally {
    await admin.end();
    await rm(legacyDirectory, { recursive: true, force: true });
  }
});
