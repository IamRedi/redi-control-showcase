import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";

import {
  businessSiteConnectionConfigurationSchema,
  probeBusinessSiteInformationAuthentication,
  probeBusinessSiteInformationReadOnly,
} from "@redi-control/website-control";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readPrivateSecret(): string {
  const path = required("BUSINESSSITE_SECRET_FILE");
  if (!isAbsolute(path))
    throw new Error("BUSINESSSITE_SECRET_FILE must be an absolute path");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 32 ||
      (metadata.mode & 0o077) !== 0
    )
      throw new Error(
        "BUSINESSSITE_SECRET_FILE must be a private mode-0600 file with a strong secret",
      );
    const secret = readFileSync(descriptor, "utf8").trim();
    if (secret.length < 32)
      throw new Error("BusinessSite integration secret is too short");
    return secret;
  } finally {
    closeSync(descriptor);
  }
}

async function main(): Promise<void> {
  const configuration = businessSiteConnectionConfigurationSchema.parse({
    apiBaseUrl: required("BUSINESSSITE_API_BASE_URL"),
    integrationId: required("BUSINESSSITE_INTEGRATION_ID"),
    displayName:
      process.env.BUSINESSSITE_DISPLAY_NAME?.trim() || "Phase 7 probe",
    domain: required("BUSINESSSITE_DOMAIN"),
  });
  const timeoutCandidate = Number(
    process.env.BUSINESSSITE_PROBE_TIMEOUT_MS ?? "10000",
  );
  const secret = readPrivateSecret();
  const result = await probeBusinessSiteInformationReadOnly(
    configuration,
    secret,
    { timeoutMs: timeoutCandidate },
  );
  const authentication = await probeBusinessSiteInformationAuthentication(
    configuration,
    secret,
    { timeoutMs: timeoutCandidate },
  );
  process.stdout.write(
    [
      "BusinessSite Phase 7 read-only probe passed.",
      `Article sample count: ${String(result.articleSampleCount)}`,
      `Media sample count: ${String(result.mediaSampleCount)}`,
      `Additional article page available: ${String(result.articlePaginationAvailable)}`,
      `Additional media page available: ${String(result.mediaPaginationAvailable)}`,
      `Valid authentication accepted: ${String(authentication.validRequestAccepted)}`,
      `Nonce replay denied: ${String(authentication.nonceReplayDenied)}`,
      `Stale timestamp denied: ${String(authentication.staleTimestampDenied)}`,
      `Invalid signature denied: ${String(authentication.invalidSignatureDenied)}`,
      `Unknown integration denied: ${String(authentication.unknownIntegrationDenied)}`,
    ].join("\n") + "\n",
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "BusinessSite Phase 7 probe failed"}\n`,
  );
  process.exitCode = 1;
});
