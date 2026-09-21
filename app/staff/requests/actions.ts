"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase/server";
import { helpRequestReviewSchema } from "@/lib/validation";

export async function moderateHelpRequest(fd: FormData) {
  const parsed = helpRequestReviewSchema.safeParse({
    id: fd.get("id"),
    status: fd.get("status"),
    reason: fd.get("reason"),
    beneficiaryConsentConfirmed:
      fd.get("beneficiaryConsentConfirmed") === "on",
    requesterIdentityConfirmed:
      fd.get("requesterIdentityConfirmed") === "on",
  });

  if (!parsed.success) redirect("/staff/requests?error=validation");

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth");

  const { error } = await s.rpc("moderate_help_request", {
    request_id: parsed.data.id,
    new_status: parsed.data.status,
    reason_text: parsed.data.reason,
    beneficiary_consent_confirmed:
      parsed.data.beneficiaryConsentConfirmed,
    requester_identity_confirmed:
      parsed.data.requesterIdentityConfirmed,
  });

  if (error) {
    console.error("REQUEST REVIEW:", error.code, error.message);
    redirect("/staff/requests?error=review");
  }

  revalidatePath("/requests");
  revalidatePath("/staff/requests");
  revalidatePath("/cabinet");
  redirect("/staff/requests?reviewed=1");
}
