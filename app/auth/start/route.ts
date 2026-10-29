import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PEERIVO_COOKIE_OPTIONS,
  PEERIVO_NEXT_COOKIE,
  PEERIVO_STATE_COOKIE,
  PEERIVO_VERIFIER_COOKIE,
  buildPeerivoAuthorizeUrl,
  createPeerivoPkce,
  createPeerivoState,
  isPeerivoAuthEnabled,
  safeNextPath,
} from "@/lib/peerivo-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (!isPeerivoAuthEnabled()) {
    return NextResponse.redirect(new URL(`/auth?next=${encodeURIComponent(next)}&error=peerivo-config`, requestUrl));
  }

  const state = createPeerivoState();
  const { verifier, challenge } = createPeerivoPkce();
  const jar = await cookies();

  jar.set(PEERIVO_STATE_COOKIE, state, PEERIVO_COOKIE_OPTIONS);
  jar.set(PEERIVO_VERIFIER_COOKIE, verifier, PEERIVO_COOKIE_OPTIONS);
  jar.set(PEERIVO_NEXT_COOKIE, next, PEERIVO_COOKIE_OPTIONS);

  const authorize = buildPeerivoAuthorizeUrl({ state, codeChallenge: challenge });
  const provider = requestUrl.searchParams.get("provider");
  if (provider !== null && provider !== "google") {
    return NextResponse.redirect(new URL("/auth?error=invalid_request", requestUrl));
  }
  if (provider === "google") {
    const config = new URL(authorize);
    const destination = new URL("/api/oauth/google", config.origin);
    destination.searchParams.set("returnTo", config.pathname + config.search);
    return NextResponse.redirect(destination);
  }
  return NextResponse.redirect(authorize);
}
