"use server";

import { redirect } from "next/navigation";
import { adminSupabase } from "@/lib/supabase/admin";
import { hashRequestModerationToken } from "@/lib/request-moderation";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function moderateRequest(formData: FormData) {
  const requestId = String(formData.get("requestId") ?? "");
  const token = String(formData.get("token") ?? "");
  const decision = String(formData.get("decision") ?? "").toUpperCase();

  if (
    !UUID.test(requestId) ||
    token.length < 32 ||
    token.length > 256 ||
    !["APPROVE", "REJECT"].includes(decision)
  ) {
    redirect("/moderation/requests/invalid?done=invalid");
  }

  const admin = adminSupabase();
  const tokenHash = hashRequestModerationToken(token);
  const { error } = await admin.rpc("moderate_help_request_by_token_hash", {
    token_hash_text: tokenHash,
    decision_text: decision,
  });

  if (error) {
    console.error("REQUEST MODERATION DECISION:", error.message);
    const retry = new URLSearchParams({
      token,
      error: "decision",
    });
    redirect(`/moderation/requests/${requestId}?${retry.toString()}`);
  }

  redirect(
    `/moderation/requests/${requestId}?done=${
      decision === "APPROVE" ? "approved" : "rejected"
    }`
  );
}
