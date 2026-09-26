import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { serverSupabase } from "@/lib/supabase/server";

function canonicalRedirect(path: string) {
  return NextResponse.redirect(new URL(path, siteUrl()));
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const requested = requestUrl.searchParams.get("next");
  const next =
    requested?.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/cabinet";

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
