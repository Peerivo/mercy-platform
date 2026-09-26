import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { serverSupabase } from "@/lib/supabase/server";

function canonicalRedirect(path: string) {
  return NextResponse.redirect(new URL(path, siteUrl()));
}

function safeNextPath(requested: string | null) {
  if (!requested?.startsWith("/") || requested.startsWith("//")) {
    return "/cabinet";
  }

  const canonical = new URL(siteUrl());
  const resolved = new URL(requested, canonical);

  if (resolved.origin !== canonical.origin) {
    return "/cabinet";
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return canonicalRedirect("/auth?error=callback");
  }

  const supabase = await serverSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return canonicalRedirect("/auth?error=callback");
  }

  return canonicalRedirect(next);
}
