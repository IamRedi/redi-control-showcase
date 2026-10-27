import { NextResponse } from "next/server";
import {
  object,
  platformApiOrigin,
  platformHeaders,
  platformJson,
  UUID,
} from "../../../../../platform-owner-bff";

const templates = ["media_starter", "media_team", "media_network"];
const locales = ["en", "de", "sq"];

export async function PUT(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await context.params;
    if (
      !UUID.test(tenantId) ||
      !UUID.test(request.headers.get("x-platform-access-grant") ?? "")
    )
      return NextResponse.json(
        { error: "Invalid platform request" },
        { status: 400 },
      );
    const body = object(await platformJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          ![
            "templateId",
            "defaultLocale",
            "enabledLocales",
            "brandAccent",
          ].includes(key),
      ) ||
      !templates.includes(String(body.templateId)) ||
      !locales.includes(String(body.defaultLocale)) ||
      !Array.isArray(body.enabledLocales) ||
      body.enabledLocales.length < 1 ||
      body.enabledLocales.length > 3 ||
      new Set(body.enabledLocales).size !== body.enabledLocales.length ||
      body.enabledLocales.some((locale) => !locales.includes(String(locale))) ||
      !body.enabledLocales.includes(body.defaultLocale) ||
      typeof body.brandAccent !== "string" ||
      !/^#[0-9A-Fa-f]{6}$/.test(body.brandAccent)
    )
      return NextResponse.json(
        { error: "Invalid tenant setup" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/tenants/${tenantId}/setup`,
        platformApiOrigin(),
      ),
      {
        method: "PUT",
        headers: platformHeaders(request, true),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Tenant setup refused" },
        { status: upstream.status },
      );
    return NextResponse.json(await upstream.json(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
