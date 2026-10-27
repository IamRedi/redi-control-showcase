export interface WebsitePreflight {
  itemId: string;
  workspaceId: string;
  status: "ready" | "blocked";
  checks: Array<{
    code: string;
    severity: "pass" | "warning" | "blocker";
  }>;
  connections: Array<{
    connectionId: string;
    displayName: string;
    domain: string;
    status: string;
    healthStatus: string;
    eligible: boolean;
  }>;
  createsVariant: false;
  callsConnector: false;
  publicationAuthorized: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECK_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function parseWebsitePreflight(value: unknown): WebsitePreflight | null {
  const wrapper = record(value);
  const candidate = record(wrapper?.preflight);
  if (
    !candidate ||
    typeof candidate.itemId !== "string" ||
    !UUID.test(candidate.itemId) ||
    typeof candidate.workspaceId !== "string" ||
    !UUID.test(candidate.workspaceId) ||
    (candidate.status !== "ready" && candidate.status !== "blocked") ||
    !Array.isArray(candidate.checks) ||
    candidate.checks.length > 20 ||
    !Array.isArray(candidate.connections) ||
    candidate.connections.length > 50 ||
    candidate.createsVariant !== false ||
    candidate.callsConnector !== false ||
    candidate.publicationAuthorized !== false
  )
    return null;
  const checks = candidate.checks.map(record);
  if (
    checks.some(
      (check) =>
        !check ||
        typeof check.code !== "string" ||
        !CHECK_CODE.test(check.code) ||
        !["pass", "warning", "blocker"].includes(
          typeof check.severity === "string" ? check.severity : "",
        ),
    )
  )
    return null;
  const hasBlocker = checks.some((check) => check?.severity === "blocker");
  if ((candidate.status === "blocked") !== hasBlocker) return null;
  const connections = candidate.connections.map(record);
  if (
    connections.some(
      (connection) =>
        !connection ||
        typeof connection.connectionId !== "string" ||
        !UUID.test(connection.connectionId) ||
        typeof connection.displayName !== "string" ||
        connection.displayName.length > 160 ||
        typeof connection.domain !== "string" ||
        connection.domain.length > 253 ||
        typeof connection.status !== "string" ||
        connection.status.length > 32 ||
        typeof connection.healthStatus !== "string" ||
        connection.healthStatus.length > 32 ||
        typeof connection.eligible !== "boolean",
    )
  )
    return null;
  return {
    itemId: candidate.itemId,
    workspaceId: candidate.workspaceId,
    status: candidate.status,
    checks: checks.map((check) => ({
      code: check!.code as string,
      severity: check!.severity as "pass" | "warning" | "blocker",
    })),
    connections: connections.map((connection) => ({
      connectionId: connection!.connectionId as string,
      displayName: connection!.displayName as string,
      domain: connection!.domain as string,
      status: connection!.status as string,
      healthStatus: connection!.healthStatus as string,
      eligible: connection!.eligible as boolean,
    })),
    createsVariant: false,
    callsConnector: false,
    publicationAuthorized: false,
  };
}
