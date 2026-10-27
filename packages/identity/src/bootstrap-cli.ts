import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPool } from "@redi-control/database";

import { FirstOwnerInvitationStore } from "./index.js";

function required(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  throw new Error(`${name} or ${name}_FILE is required`);
}

function uuid(name: string): string {
  const value = required(name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error(`${name} must be a UUID`);
  return value;
}

const email = required("BOOTSTRAP_OWNER_EMAIL").toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
  throw new Error("BOOTSTRAP_OWNER_EMAIL must be a valid email address");
const ttlHours = Number(process.env.BOOTSTRAP_TTL_HOURS ?? "24");
if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168)
  throw new Error("BOOTSTRAP_TTL_HOURS must be an integer from 1 to 168");
if (process.env.BOOTSTRAP_CONFIRM_OUTPUT !== "SHOW_ONCE")
  throw new Error(
    "Set BOOTSTRAP_CONFIRM_OUTPUT=SHOW_ONCE only in a private operator terminal",
  );

const pool = createPool(
  required("DATABASE_ADMIN_URL"),
  "redi-control-first-owner-invitation",
);
try {
  const token = await new FirstOwnerInvitationStore(pool).issue({
    tenantId: uuid("BOOTSTRAP_TENANT_ID"),
    installationId: uuid("BOOTSTRAP_INSTALLATION_ID"),
    email,
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    correlationId: randomUUID(),
  });
  process.stdout.write(
    `First-owner invitation created. Copy it now; it cannot be recovered.\n${token}\n`,
  );
} finally {
  await pool.end();
}
