export type WorkzoneChannelName =
  | "website"
  | "facebook"
  | "instagram"
  | "youtube"
  | "tiktok";

export type WorkzoneChannelStatus =
  | "connected"
  | "needs_attention"
  | "not_connected"
  | "planned";

export type WorkzoneModelOperation =
  | "claim_extraction"
  | "evidence_comparison"
  | "factual_synthesis"
  | "grounding_validation"
  | "editorial_transformation"
  | "editorial_grounding_validation";

export interface WorkzoneSnapshot {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly pipeline: {
    readonly research: number;
    readonly drafting: number;
    readonly review: number;
    readonly scheduled: number;
    readonly deliveryExceptions: number;
  };
  readonly resources: {
    readonly readyMedia: number;
    readonly teamMembers: number;
  };
  readonly channels: readonly {
    readonly name: WorkzoneChannelName;
    readonly status: WorkzoneChannelStatus;
  }[];
  readonly models: {
    readonly externalExecutionAvailable: false;
    readonly routes: readonly {
      readonly operation: WorkzoneModelOperation;
      readonly model: string;
      readonly promptVersion: string;
      readonly maxOutputTokens: number;
      readonly enabled: boolean;
    }[];
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const channelNames = [
  "website",
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
] as const;
const channelStatuses = [
  "connected",
  "needs_attention",
  "not_connected",
  "planned",
] as const;
const modelOperations = [
  "claim_extraction",
  "evidence_comparison",
  "factual_synthesis",
  "grounding_validation",
  "editorial_transformation",
  "editorial_grounding_validation",
] as const;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const boundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

export function parseWorkzoneSnapshot(value: unknown): WorkzoneSnapshot | null {
  const envelope = record(value);
  const workspace = record(envelope?.workspace);
  const pipeline = record(envelope?.pipeline);
  const resources = record(envelope?.resources);
  const models = record(envelope?.models);
  if (
    !envelope ||
    !workspace ||
    typeof workspace.id !== "string" ||
    !UUID.test(workspace.id) ||
    !boundedString(workspace.displayName, 160) ||
    !pipeline ||
    !integer(pipeline.research) ||
    !integer(pipeline.drafting) ||
    !integer(pipeline.review) ||
    !integer(pipeline.scheduled) ||
    !integer(pipeline.deliveryExceptions) ||
    !resources ||
    !integer(resources.readyMedia) ||
    !integer(resources.teamMembers) ||
    !Array.isArray(envelope.channels) ||
    envelope.channels.length !== channelNames.length ||
    !models ||
    models.externalExecutionAvailable !== false ||
    !Array.isArray(models.routes) ||
    models.routes.length > modelOperations.length
  )
    return null;

  const channels: WorkzoneSnapshot["channels"][number][] = [];
  const seenChannels = new Set<string>();
  for (const candidate of envelope.channels) {
    const channel = record(candidate);
    if (
      !channel ||
      !channelNames.includes(channel.name as WorkzoneChannelName) ||
      !channelStatuses.includes(channel.status as WorkzoneChannelStatus) ||
      seenChannels.has(String(channel.name))
    )
      return null;
    seenChannels.add(String(channel.name));
    channels.push({
      name: channel.name as WorkzoneChannelName,
      status: channel.status as WorkzoneChannelStatus,
    });
  }

  const routes: WorkzoneSnapshot["models"]["routes"][number][] = [];
  const seenOperations = new Set<string>();
  for (const candidate of models.routes) {
    const route = record(candidate);
    if (
      !route ||
      !modelOperations.includes(route.operation as WorkzoneModelOperation) ||
      seenOperations.has(String(route.operation)) ||
      !boundedString(route.model, 160) ||
      !boundedString(route.promptVersion, 80) ||
      !integer(route.maxOutputTokens) ||
      route.maxOutputTokens < 64 ||
      route.maxOutputTokens > 32_000 ||
      typeof route.enabled !== "boolean"
    )
      return null;
    seenOperations.add(String(route.operation));
    routes.push({
      operation: route.operation as WorkzoneModelOperation,
      model: route.model,
      promptVersion: route.promptVersion,
      maxOutputTokens: route.maxOutputTokens,
      enabled: route.enabled,
    });
  }

  return {
    workspace: { id: workspace.id, displayName: workspace.displayName },
    pipeline: {
      research: pipeline.research,
      drafting: pipeline.drafting,
      review: pipeline.review,
      scheduled: pipeline.scheduled,
      deliveryExceptions: pipeline.deliveryExceptions,
    },
    resources: {
      readyMedia: resources.readyMedia,
      teamMembers: resources.teamMembers,
    },
    channels,
    models: { externalExecutionAvailable: false, routes },
  };
}
