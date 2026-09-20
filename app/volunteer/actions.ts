"use server";

import { redirect } from "next/navigation";

import { verifyRussianLocality } from "@/lib/russian-locality-provider";
import { serverSupabase } from "@/lib/supabase/server";
import { offerSchema } from "@/lib/validation";

function isRussia(country: string) {
  return country.trim().toLocaleLowerCase("ru-RU") === "россия";
}

export async function createOffer(fd: FormData) {
  const parsed = offerSchema.safeParse({
    category: fd.get("category"),
    country: fd.get("country"),
    city: fd.get("city") ?? "",
    online: fd.get("online") === "on",
    description: fd.get("description"),
    contact_method: fd.get("contact_method"),
    consent: fd.get("consent") === "on",
  });

  if (!parsed.success) redirect("/volunteer?error=validation");

  if (isRussia(parsed.data.country) && parsed.data.city) {
    const locality = await verifyRussianLocality(parsed.data.city);
    if (!locality.verified) {
      redirect(
        locality.providerAvailable
          ? "/volunteer?error=locality"
          : "/volunteer?error=locality-service",
      );
    }
  }

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const payload = { ...parsed.data };
  delete (payload as Partial<typeof payload>).consent;

  const { error } = await s.rpc("create_volunteer_offer", {
    payload,
    consent_version: "volunteer-offer-v1",
  });

  if (error) redirect("/volunteer?error=save");
  redirect("/cabinet?offer=sent");
}
