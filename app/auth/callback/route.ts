import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import {
  PEERIVO_NEXT_COOKIE,
  PEERIVO_STATE_COOKIE,
  PEERIVO_VERIFIER_COOKIE,
  deriveMercyLocalPassword,
  safeNextPath,
  verifyPeerivoCode,
} from "@/lib/peerivo-auth";
import { serverSupabase } from "@/lib/supabase/server";
import { serverSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function canonicalRedirect(path: string) {
  return NextResponse.redirect(new URL(path, siteUrl()));
}

async function findLocalUserByEmail(email: string) {
  const admin = serverSupabaseAdmin();
  const normalized = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });

    if (error) {
      console.error("PEERIVO_AUTH_CALLBACK_STAGE: admin-list");
      throw error;
    }

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user) return user;
    if (data.users.length < 100) return null;
  }

  return null;
}

function peerivoMetadata(identity: Awaited<ReturnType<typeof verifyPeerivoCode>>) {
  return {
    peerivo_user_id: identity.user.peerivo_user_id,
    peerivo_email: identity.user.email.toLowerCase(),
    peerivo_provider: "peerivo",
    peerivo_linked_at: new Date().toISOString(),
  };
}

async function ensureLocalMercyUser(identity: Awaited<ReturnType<typeof verifyPeerivoCode>>) {
  const admin = serverSupabaseAdmin();
  const email = identity.user.email.toLowerCase();
  const password = deriveMercyLocalPassword({
    peerivoUserId: identity.user.peerivo_user_id,
    email,
  });
  const existing = await findLocalUserByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...((existing.user_metadata ?? {}) as User["user_metadata"]),
        ...peerivoMetadata(identity),
      },
    });

    if (error) {
      console.error("PEERIVO_AUTH_CALLBACK_STAGE: admin-update");
      throw error;
    }
    return { email, password };
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: peerivoMetadata(identity),
  });

  if (error) {
    console.error("PEERIVO_AUTH_CALLBACK_STAGE: admin-create");
    throw error;
  }
  return { email, password };
}

async function clearPeerivoHandshakeCookies() {
  const jar = await cookies();
  jar.delete(PEERIVO_STATE_COOKIE);
  jar.delete(PEERIVO_VERIFIER_COOKIE);
  jar.delete(PEERIVO_NEXT_COOKIE);
}

async function handlePeerivoCallback(requestUrl: URL, code: string) {
  const jar = await cookies();
  const state = requestUrl.searchParams.get("state");
  const expectedState = jar.get(PEERIVO_STATE_COOKIE)?.value;
  const verifier = jar.get(PEERIVO_VERIFIER_COOKIE)?.value;
  const next = safeNextPath(jar.get(PEERIVO_NEXT_COOKIE)?.value);

  if (!state || !expectedState || state !== expectedState || !verifier) {
    await clearPeerivoHandshakeCookies();
    return canonicalRedirect("/auth?error=peerivo-state");
  }

  let stage = "verify-code";

  try {
    const identity = await verifyPeerivoCode({ code, codeVerifier: verifier });
    stage = "local-user";
    const local = await ensureLocalMercyUser(identity);
    stage = "local-sign-in";
    const supabase = await serverSupabase();
    const { error } = await supabase.auth.signInWithPassword(local);

    if (error) throw error;

    await clearPeerivoHandshakeCookies();
    return canonicalRedirect(next);
  } catch (error) {
    console.error("PEERIVO_AUTH_CALLBACK_STAGE:", stage);
    console.error("PEERIVO_AUTH_CALLBACK:", error);
    await clearPeerivoHandshakeCookies();
    return canonicalRedirect("/auth?error=peerivo-callback");
  }
}

function legacySafeNextPath(requested: string | null) {
  return safeNextPath(requested);
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return canonicalRedirect("/auth?error=callback");
  }

  if (requestUrl.searchParams.has("state")) {
    return handlePeerivoCallback(requestUrl, code);
  }

  const next = legacySafeNextPath(requestUrl.searchParams.get("next"));
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return canonicalRedirect("/auth?error=callback");
  }

  return canonicalRedirect(next);
}
