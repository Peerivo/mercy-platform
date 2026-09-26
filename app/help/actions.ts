"use server";

import { redirect } from "next/navigation";

import { getRequestConsentVersion } from "@/lib/request-consent";
import { verifyRussianLocality } from "@/lib/russian-locality-provider";
import { serverSupabase } from "@/lib/supabase/server";
import { requestSchema } from "@/lib/validation";

function isRussia(country: string) {
  return country.trim().toLocaleLowerCase("ru-RU") === "россия";
}

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
    consent: fd.get("consent") === "on",
  });

  if (!parsed.success) redirect("/help?error=validation");

  if (isRussia(parsed.data.country)) {
    const locality = await verifyRussianLocality(parsed.data.city);
    if (!locality.verified) {
      redirect(
        locality.providerAvailable
          ? "/help?error=locality"
          : "/help?error=locality-service",
      );
    }
  }

  const request = { ...parsed.data };
  delete (request as Partial<typeof request>).consent;

  const consentVersion = getRequestConsentVersion(parsed.data.country);

  const { data, error } = await s.rpc("create_help_request", {
    payload: request,
    consent_version: consentVersion,
  });

  if (error) redirect("/help?error=save");

  redirect(`/cabinet/requests/${data}`);
}
