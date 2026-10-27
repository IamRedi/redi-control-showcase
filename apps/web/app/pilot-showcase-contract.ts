export type PilotChannelName =
  | "website"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "email"
  | "whatsapp";

export type PilotChannelStatus =
  | "connected"
  | "needs_attention"
  | "not_connected"
  | "planned";

export interface PilotOverview {
  readonly workspace: { readonly displayName: string };
  readonly counts: {
    readonly readyMedia: number;
    readonly socialAccounts: number;
    readonly healthySocialAccounts: number;
    readonly draftPosts: number;
    readonly scheduledPosts: number;
    readonly pendingApprovals: number;
  };
  readonly channels: readonly {
    readonly name: PilotChannelName;
    readonly status: PilotChannelStatus;
  }[];
  readonly activity: readonly {
    readonly action: string;
    readonly occurredAt: string;
  }[];
}

const channelNames = new Set<PilotChannelName>([
  "website",
  "facebook",
  "instagram",
  "tiktok",
  "email",
  "whatsapp",
]);
const channelStatuses = new Set<PilotChannelStatus>([
  "connected",
  "needs_attention",
  "not_connected",
  "planned",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parsePilotOverview(value: unknown): PilotOverview | null {
  const root = record(value);
  const workspace = record(root?.workspace);
  const counts = record(root?.counts);
  if (
    !root ||
    !workspace ||
    !counts ||
    !boundedText(workspace.displayName, 160) ||
    !count(counts.readyMedia) ||
    !count(counts.socialAccounts) ||
    !count(counts.healthySocialAccounts) ||
    !count(counts.draftPosts) ||
    !count(counts.scheduledPosts) ||
    !count(counts.pendingApprovals) ||
    !Array.isArray(root.channels) ||
    root.channels.length > 12 ||
    !Array.isArray(root.activity) ||
    root.activity.length > 25
  )
    return null;

  const channels: Array<{
    name: PilotChannelName;
    status: PilotChannelStatus;
  }> = [];
  for (const entry of root.channels) {
    const channel = record(entry);
    if (
      !channel ||
      typeof channel.name !== "string" ||
      !channelNames.has(channel.name as PilotChannelName) ||
      typeof channel.status !== "string" ||
      !channelStatuses.has(channel.status as PilotChannelStatus)
    )
      return null;
    channels.push({
      name: channel.name as PilotChannelName,
      status: channel.status as PilotChannelStatus,
    });
  }

  const activity: Array<{ action: string; occurredAt: string }> = [];
  for (const entry of root.activity) {
    const event = record(entry);
    if (
      !event ||
      !boundedText(event.action, 200) ||
      typeof event.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(event.occurredAt))
    )
      return null;
    activity.push({
      action: event.action,
      occurredAt: event.occurredAt,
    });
  }

  return {
    workspace: { displayName: workspace.displayName },
    counts: {
      readyMedia: counts.readyMedia,
      socialAccounts: counts.socialAccounts,
      healthySocialAccounts: counts.healthySocialAccounts,
      draftPosts: counts.draftPosts,
      scheduledPosts: counts.scheduledPosts,
      pendingApprovals: counts.pendingApprovals,
    },
    channels,
    activity,
  };
}
