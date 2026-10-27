import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  verifyRuntimeRole,
} from "./index.js";
import { readFileSync } from "node:fs";

function required(name: string): string {
  const value = process.env[name];
  if (value) return value;
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, "utf8").trim();
  throw new Error(`${name} or ${name}_FILE is required`);
}

const command = process.argv[2];

if (command === "migrate") {
  await migrateDatabase({
    adminUrl: required("DATABASE_ADMIN_URL"),
    runtimePassword: required("DATABASE_RUNTIME_PASSWORD"),
    authPassword: required("DATABASE_AUTH_PASSWORD"),
  });
  process.stdout.write("Migrations applied successfully.\n");
} else if (command === "seed") {
  const result = await seedLocalTestData(required("DATABASE_ADMIN_URL"));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (command === "verify") {
  const pool = createPool(
    required("DATABASE_URL"),
    "redi-control-role-verifier",
  );
  try {
    await verifyRuntimeRole(pool);
    process.stdout.write(
      "Runtime role is non-superuser and does not bypass RLS.\n",
    );
  } finally {
    await pool.end();
  }
} else {
  throw new Error("Expected command: migrate, seed, or verify");
}
