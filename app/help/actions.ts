"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { requestSchema } from "@/lib/validation";
import { getRequestConsentVersion } from "@/lib/request-consent";
import { notifyRequestReview } from "@/lib/request-review-notification";

export async function createRequest(fd: FormData) {
  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth");

  const parsed = requestSchema.safeParse({
    category: fd.get("category"),
    country: fd.get("country"),
    city: fd.get("city"),
    description: fd.get("description"),
    urgency: fd.get("urgency"),
    can_message: fd.get("can_message") === "on",
    can_call: fd.get("can_call") === "on",
    contact_window: fd.get("contact_window") || "",
    external_contact: fd.get("external_contact") || "",
    beneficiary_scope: fd.get("beneficiary_scope") || "SELF",
    beneficiary_consent_attested:
      fd.get("beneficiary_consent_attested") === "on",
    interaction_mode: fd.get("interaction_mode") || "REMOTE_OR_PUBLIC",
    consent: fd.get("consent") === "on",
  });

  if (!parsed.success) redirect("/help?error=validation");

  const request = { ...parsed.data };
  delete (request as Partial<typeof request>).consent;

  const consentVersion = getRequestConsentVersion(
    parsed.data.country,
  );

  const { data, error } = await s.rpc("create_help_request", {
    payload: request,
    consent_version: consentVersion,
  });

  if (error || typeof data !== "string") redirect("/help?error=save");

  const { data: created } = await s
    .from("help_requests")
    .select("case_number")
    .eq("id", data)
    .maybeSingle();

  if (created?.case_number) {
    try {
      await notifyRequestReview({
        id: data,
        caseNumber: created.case_number,
      });
    } catch (notificationError) {
      console.error("REQUEST REVIEW EMAIL:", notificationError);
    }
  }

  redirect(`/cabinet/requests/${data}`);
}