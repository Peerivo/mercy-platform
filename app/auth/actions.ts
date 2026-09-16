"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { serverSupabase } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/config";

const emailSchema = z.email();

function safeNext(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "/cabinet";
  if (!value.startsWith("/") || value.startsWith("//")) return "/cabinet";
  return value.slice(0, 500);
}

export async function sendLoginLink(fd: FormData) {
  const email = emailSchema.parse(fd.get("email"));
  const next = safeNext(fd.get("next"));
  const s = await serverSupabase();

  const callback = new URL("/auth/callback", siteUrl());
  callback.searchParams.set("next", next);

  const { error } = await s.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("AUTH MAGIC LINK:", error.code, error.message);
    redirect(`/auth?error=${encodeURIComponent(error.code ?? "magic-link")}&next=${encodeURIComponent(next)}`);
  }

  redirect(`/auth?sent=1&next=${encodeURIComponent(next)}`);
}

// Legacy password update remains valid for users already in a recovery session.
export async function updatePassword(fd: FormData) {
  const password = z.string().min(10).max(128).parse(fd.get("password"));
  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth?error=session");

  const { error } = await s.auth.updateUser({ password });
  if (error) redirect("/auth/update-password?error=update");
  redirect("/cabinet");
}

export async function signOut() {
  const s = await serverSupabase();
  await s.auth.signOut();
  redirect("/");
}
