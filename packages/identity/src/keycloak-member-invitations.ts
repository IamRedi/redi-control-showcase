export interface MemberIdentityProvisioner {
  provision(input: {
    readonly email: string;
    readonly redirectUri: string;
    readonly expiresInSeconds: number;
  }): Promise<{ readonly identitySubject: string }>;
  remove(identitySubject: string): Promise<void>;
}

export class MemberIdentityProvisioningError extends Error {
  public constructor(message = "Member identity could not be provisioned") {
    super(message);
    this.name = "MemberIdentityProvisioningError";
  }
}

interface KeycloakTokenResponse {
  readonly access_token?: string;
}

/**
 * Minimal Keycloak Admin API adapter. It is intentionally limited to creating
 * an unverified invitee, triggering Keycloak's own verified action email, and
 * deleting that newly created identity if REDI CONTROL cannot persist its
 * corresponding tenant-bound invitation.
 */
export class KeycloakMemberIdentityProvisioner implements MemberIdentityProvisioner {
  public constructor(
    private readonly options: {
      readonly adminOrigin: string;
      readonly realm: string;
      readonly clientId: string;
      readonly clientSecret: string;
    },
  ) {}

  public async provision(input: {
    readonly email: string;
    readonly redirectUri: string;
    readonly expiresInSeconds: number;
  }): Promise<{ readonly identitySubject: string }> {
    const token = await this.accessToken();
    const users = this.adminUrl("users");
    const create = await fetch(users, {
      method: "POST",
      headers: this.authHeaders(token),
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        enabled: true,
        emailVerified: false,
        requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (create.status === 409)
      throw new MemberIdentityProvisioningError(
        "An identity already exists for this email",
      );
    if (create.status !== 201) throw new MemberIdentityProvisioningError();
    const location = create.headers.get("location");
    const identitySubject = location?.split("/").at(-1);
    if (!identitySubject || !/^[0-9a-f-]{36}$/i.test(identitySubject))
      throw new MemberIdentityProvisioningError();

    const actionUrl = new URL(
      this.adminUrl(`users/${identitySubject}/execute-actions-email`),
    );
    actionUrl.searchParams.set("client_id", "redi-control");
    actionUrl.searchParams.set("redirect_uri", input.redirectUri);
    actionUrl.searchParams.set("lifespan", String(input.expiresInSeconds));
    const delivery = await fetch(actionUrl, {
      method: "PUT",
      headers: this.authHeaders(token),
      body: JSON.stringify([
        "VERIFY_EMAIL",
        "UPDATE_PASSWORD",
        "CONFIGURE_TOTP",
      ]),
      signal: AbortSignal.timeout(10_000),
    });
    if (delivery.status !== 204) {
      await this.deleteWithToken(identitySubject, token).catch(() => undefined);
      throw new MemberIdentityProvisioningError(
        "The verified identity email could not be delivered",
      );
    }
    return { identitySubject };
  }

  public async remove(identitySubject: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(identitySubject)) return;
    await this.deleteWithToken(identitySubject, await this.accessToken());
  }

  private async accessToken(): Promise<string> {
    const url = new URL(
      `realms/${encodeURIComponent(this.options.realm)}/protocol/openid-connect/token`,
      this.normalizedOrigin(),
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response
      .json()
      .catch(() => ({}))) as KeycloakTokenResponse;
    if (!response.ok || !payload.access_token)
      throw new MemberIdentityProvisioningError();
    return payload.access_token;
  }

  private async deleteWithToken(
    identitySubject: string,
    token: string,
  ): Promise<void> {
    const response = await fetch(this.adminUrl(`users/${identitySubject}`), {
      method: "DELETE",
      headers: this.authHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 204) throw new MemberIdentityProvisioningError();
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  }

  private adminUrl(path: string): URL {
    return new URL(
      `admin/realms/${encodeURIComponent(this.options.realm)}/${path}`,
      this.normalizedOrigin(),
    );
  }

  private normalizedOrigin(): URL {
    const origin = new URL(this.options.adminOrigin);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new MemberIdentityProvisioningError();
    return new URL(origin.href.endsWith("/") ? origin.href : `${origin.href}/`);
  }
}
