import { NextResponse } from "next/server";
import {
  bounded,
  object,
  platformApiOrigin,
  platformHeaders,
  platformJson,
} from "../../../platform-owner-bff";

export async function POST(request: Request) {
  try {
    const body = object(await platformJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) => !["reason", "lifetimeMinutes"].includes(key),
      ) ||
      !bounded(body.reason, 10, 500) ||
      !Number.isInteger(body.lifetimeMinutes) ||
      Number(body.lifetimeMinutes) < 1 ||
      Number(body.lifetimeMinutes) > 60
    )
      return NextResponse.json(
        { error: "Invalid access request" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL("/api/platform-owner/access", platformApiOrigin()),
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
        { error: "Platform access refused" },
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
