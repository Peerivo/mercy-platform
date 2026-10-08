"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { requestSchema } from "@/lib/validation";
import { getRequestConsentVersion } from "@/lib/request-consent";
import { helpRequestValidationMessage } from "@/lib/request-form-feedback";

export type RequestActionState = {
  ok: boolean;
  message: string;
};

export async function createRequest(
  _previousState: RequestActionState,
  fd: FormData,
): Promise<RequestActionState> {
  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
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
    consent: fd.get("consent") === "on",
  });

  if (!parsed.success) {
    return { ok: false, message: helpRequestValidationMessage(parsed.error.issues) };
  }

  const request = { ...parsed.data };
  delete (request as Partial<typeof request>).consent;
  const consentVersion = getRequestConsentVersion(parsed.data.country);

  const { data, error } = await s.rpc("create_help_request", {
    payload: request,
    consent_version: consentVersion,
  });

  // Keep form values in client state on storage failures, never redirect with user text.
  if (error || typeof data !== "string") {
    return {
      ok: false,
      message: "Не удалось сохранить просьбу. Ваш текст остался в форме. Повторите попытку чуть позже.",
    };
  }

  redirect(`/cabinet/requests/${data}`);
}
