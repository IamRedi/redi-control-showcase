import { NextResponse } from "next/server";
import {
  bounded,
  object,
  platformApiOrigin,
  platformHeaders,
  platformJson,
  UUID,
} from "../../../platform-owner-bff";

export async function GET(request: Request) {
  try {
    if (!UUID.test(request.headers.get("x-platform-access-grant") ?? ""))
      return NextResponse.json(
        { error: "Active platform access is required" },
        { status: 403 },
      );
    const upstream = await fetch(
      new URL("/api/platform-owner/tenants", platformApiOrigin()),
      {
        headers: platformHeaders(request),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Platform inventory refused" },
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

export async function POST(request: Request) {
  try {
    if (!UUID.test(request.headers.get("x-platform-access-grant") ?? ""))
      return NextResponse.json(
        { error: "Active platform access is required" },
        { status: 403 },
      );
    const body = object(await platformJson(request));
    const keys = [
      "tenantSlug",
      "tenantName",
      "installationSlug",
      "installationName",
      "workspaceName",
      "dataRegion",
    ];
    if (
      !body ||
      Object.keys(body).some((key) => !keys.includes(key)) ||
      typeof body.tenantSlug !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(body.tenantSlug) ||
      typeof body.installationSlug !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(body.installationSlug) ||
      !bounded(body.tenantName, 2, 160) ||
      !bounded(body.installationName, 2, 160) ||
      !bounded(body.workspaceName, 2, 160) ||
      !["EU", "DE"].includes(String(body.dataRegion))
    )
      return NextResponse.json(
        { error: "Invalid tenant shell" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL("/api/platform-owner/tenants", platformApiOrigin()),
      {
        method: "POST",
        headers: platformHeaders(request, true),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Tenant provisioning refused" },
        { status: upstream.status },
      );
    return NextResponse.json(await upstream.json(), {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
