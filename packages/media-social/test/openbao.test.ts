import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OpenBaoTokenSecretProvider } from "../src/openbao.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const reference = "secret://social/meta/token-1";
const secretValue = "provider-access-token-do-not-log";
const clientToken = "openbao-client-token-000000000000";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function login(): Response {
  return json({
    auth: { client_token: clientToken, lease_duration: 900 },
  });
}

function provider(fetchMock: typeof fetch): OpenBaoTokenSecretProvider {
  return new OpenBaoTokenSecretProvider({
    address: "https://openbao:8200",
    roleId: "role-id",
    secretId: "secret-id",
    fetch: fetchMock,
    now: () => 1_000,
  });
}

describe("OpenBao token secret provider", () => {
  it("logs in once and stores, resolves, then permanently revokes a KV v2 secret", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ data: { version: 1 } }))
      .mockResolvedValueOnce(
        json({ data: { data: { value: secretValue }, metadata: {} } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const secrets = provider(fetchMock);
    const context = { tenantId, connectionId };

    await secrets.store(reference, secretValue, context);
    await expect(secrets.resolve(reference, context)).resolves.toBe(
      secretValue,
    );
    await expect(secrets.revoke(reference, context)).resolves.toBeUndefined();

    const digest = createHash("sha256").update(reference).digest("hex");
    const base = `https://openbao:8200/v1/redi-control`;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://openbao:8200/v1/auth/approle/login",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ role_id: "role-id", secret_id: "secret-id" }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${base}/data/tenants/${tenantId}/connections/${connectionId}/${digest}`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ data: { value: secretValue } }),
    );
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      "x-vault-token": clientToken,
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `${base}/metadata/tenants/${tenantId}/connections/${connectionId}/${digest}`,
    );
  });

  it("binds identical references to separate tenant and connection paths", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValue(json({ data: { version: 1 } }));
    const secrets = provider(fetchMock);

    await secrets.store(reference, secretValue, { tenantId, connectionId });
    await secrets.store(reference, secretValue, {
      tenantId: "00000000-0000-4000-8000-000000000003",
      connectionId,
    });

    expect(fetchMock.mock.calls[1]?.[0]).not.toBe(fetchMock.mock.calls[2]?.[0]);
  });

  it("rejects invalid context before contacting OpenBao", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const secrets = provider(fetchMock);
    await expect(
      secrets.resolve("secret://../../root", {
        tenantId: "not-a-uuid",
        connectionId,
      }),
    ).rejects.toThrow("INVALID_SECRET_CONTEXT");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for missing and malformed secrets without exposing values", async () => {
    const missingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ errors: [] }, 404));
    await expect(
      provider(missingFetch).resolve(reference, { tenantId, connectionId }),
    ).rejects.toThrow("SECRET_UNAVAILABLE");

    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ data: { data: { value: 42 } } }));
    const outcome = provider(malformedFetch).resolve(reference, {
      tenantId,
      connectionId,
    });
    await expect(outcome).rejects.toThrow("SECRET_UNAVAILABLE");
    await expect(outcome).rejects.not.toThrow(secretValue);
  });

  it("discards a rejected client token and retries once with a fresh login", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ errors: ["denied"] }, 403))
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ data: { version: 1 } }));

    await expect(
      provider(fetchMock).store(reference, secretValue, {
        tenantId,
        connectionId,
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports provider health as false on transport or login failure", async () => {
    const unavailable = provider(
      vi.fn<typeof fetch>().mockRejectedValue(new Error(secretValue)),
    );
    await expect(unavailable.health()).resolves.toBe(false);
  });

  it("checks the authenticated token instead of trusting only its cache", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(json({ data: { id: clientToken } }));
    await expect(provider(fetchMock).health()).resolves.toBe(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://openbao:8200/v1/auth/token/lookup-self",
    );
  });

  it("requires an HTTPS origin and bounded credentials", () => {
    expect(
      () =>
        new OpenBaoTokenSecretProvider({
          address: "http://openbao:8200",
          roleId: "role-id",
          secretId: "secret-id",
        }),
    ).toThrow("INVALID_OPENBAO_CONFIGURATION");
    expect(
      () =>
        new OpenBaoTokenSecretProvider({
          address: "https://openbao:8200/untrusted-path",
          roleId: "role-id",
          secretId: "secret-id",
        }),
    ).toThrow("INVALID_OPENBAO_CONFIGURATION");
  });
});
