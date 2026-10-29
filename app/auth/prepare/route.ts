import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import {
  PEERIVO_COOKIE_OPTIONS, PEERIVO_NEXT_COOKIE, PEERIVO_STATE_COOKIE,
  PEERIVO_VERIFIER_COOKIE, createPeerivoPkce, createPeerivoState,
  isPeerivoAuthEnabled, peerivoClientConfig, safeNextPath,
} from "@/lib/peerivo-auth";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Same-origin preparation: never accepts/stores a username or password. */
export async function POST(request: Request) {
  const source = new URL(request.url);
  if (request.headers.get("origin") !== siteUrl().replace(/\/$/, "") ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return NextResponse.json({ error: "invalid_request" }, { status: 415, headers: noStore });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) throw new Error("large");
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => key !== "next") ||
      (Reflect.get(body, "next") != null && typeof Reflect.get(body, "next") !== "string")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  }
  if (!isPeerivoAuthEnabled() || process.env.PEERIVO_EMBEDDED_PASSWORD_ENABLED !== "1") {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503, headers: noStore });
  }
  let config;
  try {
    config = peerivoClientConfig();
    if (config.clientId !== "mercy" ||
        config.redirectUri !== new URL("/auth/callback", siteUrl()).toString() ||
        new URL(config.authUrl).origin !== "https://auth.peerivo.net") throw new Error("client");
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503, headers: noStore });
  }
  const state = createPeerivoState();
  const { verifier, challenge } = createPeerivoPkce();
  const next = safeNextPath(Reflect.get(body, "next"));
  const response = NextResponse.json({
    action: "https://auth.peerivo.net/api/login/password",
    authorization: {
      client_id: config.clientId, redirect_uri: config.redirectUri, state,
      code_challenge: challenge, code_challenge_method: "S256",
    },
  }, { headers: noStore });
  for (const [name, value] of [
    [PEERIVO_STATE_COOKIE, state], [PEERIVO_VERIFIER_COOKIE, verifier], [PEERIVO_NEXT_COOKIE, next],
  ] as const) response.cookies.set(name, value, PEERIVO_COOKIE_OPTIONS);
  return response;
}
