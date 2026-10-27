import {
  KeycloakMemberIdentityProvisioner,
  MemberIdentityProvisioningError,
} from "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const provisioner = () =>
  new KeycloakMemberIdentityProvisioner({
    adminOrigin: "http://keycloak:8080/id",
    realm: "redi-control",
    clientId: "member-provisioner",
    clientSecret: "a-very-long-test-client-secret",
  });

describe("Keycloak member invitation provisioner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates an unverified identity and sends only Keycloak's one-time action email", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push({ url, init });
        if (url.includes("/protocol/openid-connect/token"))
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: "access-token" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        if (url.endsWith("/admin/realms/redi-control/users"))
          return Promise.resolve(
            new Response(null, {
              status: 201,
              headers: {
                location:
                  "http://keycloak:8080/id/admin/realms/redi-control/users/73bc00fd-ecaa-417f-9259-2f204e3f4f1a",
              },
            }),
          );
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    await expect(
      provisioner().provision({
        email: "journalist@example.test",
        redirectUri: "https://control.example.test/auth/member/continue",
        expiresInSeconds: 86_400,
      }),
    ).resolves.toEqual({
      identitySubject: "73bc00fd-ecaa-417f-9259-2f204e3f4f1a",
    });
    expect(calls).toHaveLength(3);
    const createUserBody = calls[1]?.init?.body;
    expect(typeof createUserBody).toBe("string");
    if (typeof createUserBody !== "string")
      throw new Error("Expected a serialized Keycloak user request");
    expect(JSON.parse(createUserBody)).toMatchObject({
      username: "journalist@example.test",
      emailVerified: false,
      requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP"],
    });
    expect(calls[2]?.url).toContain(
      "execute-actions-email?client_id=redi-control",
    );
    expect(calls[2]?.url).toContain("lifespan=86400");
  });

  it("removes a newly created identity when Keycloak cannot deliver its action email", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        methods.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/protocol/openid-connect/token"))
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: "access-token" }), {
              headers: { "content-type": "application/json" },
            }),
          );
        if (init?.method === "POST")
          return Promise.resolve(
            new Response(null, {
              status: 201,
              headers: {
                location:
                  "http://keycloak:8080/id/admin/realms/redi-control/users/73bc00fd-ecaa-417f-9259-2f204e3f4f1a",
              },
            }),
          );
        if (init?.method === "PUT")
          return Promise.resolve(new Response(null, { status: 500 }));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    await expect(
      provisioner().provision({
        email: "journalist@example.test",
        redirectUri: "https://control.example.test/auth/member/continue",
        expiresInSeconds: 86_400,
      }),
    ).rejects.toBeInstanceOf(MemberIdentityProvisioningError);
    expect(methods.some((call) => call.startsWith("DELETE "))).toBe(true);
  });
});
