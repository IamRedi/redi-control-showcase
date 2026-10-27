import type { SecretProvider } from "@redi-control/connector-sdk";

import type { VideoAspectRatio, VideoTargetLanguage } from "./index.js";

const HEYGEN_CREATE_VIDEO_URL = "https://api.heygen.com/v3/videos";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type HeyGenV3FailureCode =
  | "HEYGEN_EXECUTION_NOT_ACCEPTED"
  | "HEYGEN_INVALID_CONFIGURATION"
  | "HEYGEN_INVALID_REQUEST"
  | "HEYGEN_AUTHENTICATION_FAILED"
  | "HEYGEN_REQUEST_IN_PROGRESS"
  | "HEYGEN_RATE_LIMITED"
  | "HEYGEN_REQUEST_REJECTED"
  | "HEYGEN_UNAVAILABLE"
  | "HEYGEN_TIMEOUT"
  | "HEYGEN_MALFORMED_RESPONSE";

export class HeyGenV3Error extends Error {
  public constructor(
    public readonly code: HeyGenV3FailureCode,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(code);
    this.name = "HeyGenV3Error";
  }
}

export interface HeyGenV3RenderInput {
  readonly preparationId: string;
  readonly outputId: string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly script: string;
  readonly targetLanguage: VideoTargetLanguage;
  readonly aspectRatio: VideoAspectRatio;
}

export interface HeyGenV3CreateVideoPayload {
  readonly type: "avatar";
  readonly avatar_id: string;
  readonly title: string;
  readonly resolution: "720p";
  readonly aspect_ratio: VideoAspectRatio;
  readonly callback_id: string;
  readonly output_format: "mp4";
  readonly script: string;
  readonly voice_id: string;
}

export interface HeyGenV3Submission {
  readonly providerVideoId: string;
  readonly providerStatus: string;
  readonly outputFormat: "mp4";
  readonly callbackId: string;
}

interface HeyGenV3Configuration {
  readonly executionAccepted: boolean;
  readonly secretReference: string;
  readonly tenantId: string;
  readonly connectionId: string;
  readonly avatarId: string;
  readonly voiceId: string;
  readonly timeoutMs?: number;
}

const bounded = (value: string, minimum: number, maximum: number) =>
  value.trim().length >= minimum && value.length <= maximum;

export function buildHeyGenV3CreateVideoPayload(
  input: HeyGenV3RenderInput,
  configuration: Pick<HeyGenV3Configuration, "avatarId" | "voiceId">,
): HeyGenV3CreateVideoPayload {
  if (
    !UUID.test(input.preparationId) ||
    !UUID.test(input.outputId) ||
    !UUID.test(input.idempotencyKey) ||
    !bounded(input.title, 3, 240) ||
    !bounded(input.script, 20, 20_000) ||
    !["en", "de", "sq"].includes(input.targetLanguage) ||
    !["9:16", "16:9"].includes(input.aspectRatio) ||
    !PROVIDER_ID.test(configuration.avatarId) ||
    !PROVIDER_ID.test(configuration.voiceId)
  )
    throw new HeyGenV3Error("HEYGEN_INVALID_REQUEST", 400);
  return {
    type: "avatar",
    avatar_id: configuration.avatarId,
    title: input.title.trim(),
    resolution: "720p",
    aspect_ratio: input.aspectRatio,
    callback_id: input.outputId,
    output_format: "mp4",
    script: input.script,
    voice_id: configuration.voiceId,
  };
}

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const declared = response.headers.get("content-length");
  const declaredLength = declared === null ? null : Number(declared);
  if (
    (declaredLength !== null && !Number.isFinite(declaredLength)) ||
    (declaredLength !== null && declaredLength > MAX_RESPONSE_BYTES)
  )
    throw new HeyGenV3Error("HEYGEN_MALFORMED_RESPONSE", 502);
  if (!response.body) throw new HeyGenV3Error("HEYGEN_MALFORMED_RESPONSE", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HeyGenV3Error("HEYGEN_MALFORMED_RESPONSE", 502);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new HeyGenV3Error("HEYGEN_MALFORMED_RESPONSE", 502);
  }
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const providerFailure = (status: number, payload: unknown): HeyGenV3Error => {
  const error = record(record(payload)?.error);
  const providerCode = typeof error?.code === "string" ? error.code : "unknown";
  if (status === 401 || status === 403)
    return new HeyGenV3Error("HEYGEN_AUTHENTICATION_FAILED", 503);
  if (status === 409 && providerCode === "request_in_progress")
    return new HeyGenV3Error("HEYGEN_REQUEST_IN_PROGRESS", 503, true);
  if (status === 429)
    return new HeyGenV3Error("HEYGEN_RATE_LIMITED", 503, true);
  if (status >= 500) return new HeyGenV3Error("HEYGEN_UNAVAILABLE", 503, true);
  return new HeyGenV3Error("HEYGEN_REQUEST_REJECTED", 502);
};

export class HeyGenV3SandboxAdapter {
  public constructor(
    private readonly secrets: SecretProvider,
    private readonly configuration: HeyGenV3Configuration,
    private readonly request: typeof fetch = fetch,
  ) {
    if (
      !bounded(configuration.secretReference, 3, 500) ||
      !UUID.test(configuration.tenantId) ||
      !UUID.test(configuration.connectionId) ||
      !PROVIDER_ID.test(configuration.avatarId) ||
      !PROVIDER_ID.test(configuration.voiceId) ||
      (configuration.timeoutMs !== undefined &&
        (!Number.isInteger(configuration.timeoutMs) ||
          configuration.timeoutMs < 1_000 ||
          configuration.timeoutMs > 30_000))
    )
      throw new HeyGenV3Error("HEYGEN_INVALID_CONFIGURATION", 500);
  }

  public async submit(
    input: HeyGenV3RenderInput,
    signal?: AbortSignal,
  ): Promise<HeyGenV3Submission> {
    if (!this.configuration.executionAccepted)
      throw new HeyGenV3Error("HEYGEN_EXECUTION_NOT_ACCEPTED", 503);
    const payload = buildHeyGenV3CreateVideoPayload(input, this.configuration);
    const apiKey = await this.secrets.resolve(
      this.configuration.secretReference,
      {
        tenantId: this.configuration.tenantId,
        connectionId: this.configuration.connectionId,
      },
    );
    if (!bounded(apiKey, 1, 1_000))
      throw new HeyGenV3Error("HEYGEN_AUTHENTICATION_FAILED", 503);
    const timeoutSignal = AbortSignal.timeout(
      this.configuration.timeoutMs ?? 30_000,
    );
    try {
      const response = await this.request(HEYGEN_CREATE_VIDEO_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal,
      });
      const responsePayload = await readBoundedJson(response);
      if (!response.ok) throw providerFailure(response.status, responsePayload);
      const data = record(record(responsePayload)?.data);
      if (
        !data ||
        typeof data.video_id !== "string" ||
        !PROVIDER_ID.test(data.video_id) ||
        typeof data.status !== "string" ||
        !bounded(data.status, 1, 80) ||
        data.output_format !== "mp4"
      )
        throw new HeyGenV3Error("HEYGEN_MALFORMED_RESPONSE", 502);
      return {
        providerVideoId: data.video_id,
        providerStatus: data.status,
        outputFormat: "mp4",
        callbackId: input.outputId,
      };
    } catch (error) {
      if (error instanceof HeyGenV3Error) throw error;
      if (
        timeoutSignal.aborted ||
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw new HeyGenV3Error("HEYGEN_TIMEOUT", 503, true);
      throw new HeyGenV3Error("HEYGEN_UNAVAILABLE", 503, true);
    }
  }
}
