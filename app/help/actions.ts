"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { requestSchema } from "@/lib/validation";
import { getRequestConsentVersion } from "@/lib/request-consent";

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
    home_visit_required: fd.get("home_visit_required") === "on",
    visit_household_members: fd.get("visit_household_members") || "",
    dogs_present: fd.get("dogs_present") === "on",
    cats_present: fd.get("cats_present") === "on",
    visit_animals_notes: fd.get("visit_animals_notes") || "",
    smoking_present: fd.get("smoking_present") === "on",
    visit_allergen_notes: fd.get("visit_allergen_notes") || "",
    visit_access_notes: fd.get("visit_access_notes") || "",
    visit_other_notes: fd.get("visit_other_notes") || "",
    visit_trusted_contact: fd.get("visit_trusted_contact") || "",
    video_call_possible: fd.get("video_call_possible") === "on",
    visit_safety_acknowledged: fd.get("visit_safety_acknowledged") === "on",
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

  if (error) redirect("/help?error=save");

  redirect(`/cabinet/requests/${data}`);
}