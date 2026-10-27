import { InMemorySecretProvider } from "@redi-control/connector-sdk";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildHeyGenV3CreateVideoPayload,
  HeyGenV3Error,
  HeyGenV3SandboxAdapter,
} from "../src/heygen-v3.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const input = () => ({
  preparationId: randomUUID(),
  outputId: randomUUID(),
  idempotencyKey: randomUUID(),
  title: "Daily verified newsroom bulletin",
  script: "This exact approved script is long enough for the render contract.",
  targetLanguage: "sq" as const,
  aspectRatio: "9:16" as const,
});
const configuration = (executionAccepted: boolean) => ({
  executionAccepted,
  secretReference: "secret://video/heygen-sandbox",
  tenantId,
  connectionId,
  avatarId: "avatar_test_01",
  voiceId: "voice_test_01",
});

describe("HeyGen v3 sandbox adapter", () => {
  it("maps one approved output without changing the exact script", () => {
    const request = input();
    expect(
      buildHeyGenV3CreateVideoPayload(request, configuration(false)),
    ).toEqual({
      type: "avatar",
      avatar_id: "avatar_test_01",
      title: request.title,
      resolution: "720p",
      aspect_ratio: "9:16",
      callback_id: request.outputId,
      output_format: "mp4",
      script: request.script,
      voice_id: "voice_test_01",
    });
  });

  it("fails before secret resolution or transport when execution is unaccepted", async () => {
    const secrets = new InMemorySecretProvider();
    const transport = vi.fn<typeof fetch>();
    const adapter = new HeyGenV3SandboxAdapter(
      secrets,
      configuration(false),
      transport,
    );
    await expect(adapter.submit(input())).rejects.toMatchObject({
      code: "HEYGEN_EXECUTION_NOT_ACCEPTED",
      retryable: false,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("resolves the key at call time and sends only the strict v3 request", async () => {
    const secrets = new InMemorySecretProvider();
    secrets.set("secret://video/heygen-sandbox", "sandbox-secret-value");
    let capturedUrl = "";
    let captured: RequestInit | undefined;
    const request = input();
    const adapter = new HeyGenV3SandboxAdapter(
      secrets,
      configuration(true),
      (url, init) => {
        capturedUrl =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        captured = init;
        return Promise.resolve(
          Response.json({
            data: {
              video_id: "video_test_01",
              status: "pending",
              output_format: "mp4",
            },
          }),
        );
      },
    );
    await expect(adapter.submit(request)).resolves.toEqual({
      providerVideoId: "video_test_01",
      providerStatus: "pending",
      outputFormat: "mp4",
      callbackId: request.outputId,
    });
    expect(capturedUrl).toBe("https://api.heygen.com/v3/videos");
    expect(new Headers(captured?.headers).get("x-api-key")).toBe(
      "sandbox-secret-value",
    );
    expect(new Headers(captured?.headers).get("idempotency-key")).toBe(
      request.idempotencyKey,
    );
    expect(
      typeof captured?.body === "string" ? captured.body : "",
    ).not.toContain("sandbox-secret-value");
  });

  it("maps provider failures safely and rejects malformed success", async () => {
    const secrets = new InMemorySecretProvider();
    secrets.set("secret://video/heygen-sandbox", "sandbox-secret-value");
    const failureAdapter = new HeyGenV3SandboxAdapter(
      secrets,
      configuration(true),
      () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "request_in_progress",
                message: "raw provider detail must not escape",
              },
            },
            { status: 409 },
          ),
        ),
    );
    let failure: unknown;
    try {
      await failureAdapter.submit(input());
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(HeyGenV3Error);
    expect(failure).toMatchObject({
      code: "HEYGEN_REQUEST_IN_PROGRESS",
      retryable: true,
    });
    if (!(failure instanceof HeyGenV3Error))
      throw new Error("Expected HeyGenV3Error");
    expect(failure.message).not.toContain("raw provider detail");

    const malformedAdapter = new HeyGenV3SandboxAdapter(
      secrets,
      configuration(true),
      () => Promise.resolve(Response.json({ data: { status: "pending" } })),
    );
    await expect(malformedAdapter.submit(input())).rejects.toMatchObject({
      code: "HEYGEN_MALFORMED_RESPONSE",
    });

    const oversizedAdapter = new HeyGenV3SandboxAdapter(
      secrets,
      configuration(true),
      () =>
        Promise.resolve(
          new Response("x".repeat(65 * 1024), {
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await expect(oversizedAdapter.submit(input())).rejects.toMatchObject({
      code: "HEYGEN_MALFORMED_RESPONSE",
    });
  });
});
