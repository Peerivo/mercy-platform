"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { requestSchema } from "@/lib/validation";
import { getRequestConsentVersion } from "@/lib/request-consent";

export type RequestActionState = {
  error?: "validation" | "save" | "auth" | "unknown";
  fieldErrors?: Record<string, string>;
};

const fieldMessages: Record<string, string> = {
  category: "Выберите категорию помощи.",
  country: "Укажите страну: от 2 до 80 символов.",
  city: "Укажите город: от 2 до 120 символов.",
  description: "Опишите просьбу: от 20 до 5000 символов.",
  urgency: "Выберите срочность.",
  contact_window: "Не более 120 символов.",
  external_contact: "Не более 200 символов.",
  consent: "Подтвердите согласие на обработку данных.",
};

export async function createRequest(_: RequestActionState, fd: FormData): Promise<RequestActionState> {
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
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]);
      if (fieldMessages[field]) fieldErrors[field] = fieldMessages[field];
    }
    return { error: "validation", fieldErrors };
  }

  // These checks happen before the write. Do not expose private values in errors.
  let s: Awaited<ReturnType<typeof serverSupabase>>;
  try {
    s = await serverSupabase();
  } catch {
    return { error: "save" };
  }
  try {
    const { data, error } = await s.auth.getUser();
    if (error || !data.user) return { error: "auth" };
  } catch {
    return { error: "auth" };
  }

  const request = { ...parsed.data };
  delete (request as Partial<typeof request>).consent;

  const consentVersion = getRequestConsentVersion(
    parsed.data.country,
  );

  let createdId: string;
  try {
    const { data, error } = await s.rpc("create_help_request", {
      payload: request,
      consent_version: consentVersion,
    });
    if (error) return { error: "save" };
    // A response without an ID could be a committed request. Never suggest an
    // automatic retry when the outcome cannot be established.
    if (typeof data !== "string" || !data) return { error: "unknown" };
    createdId = data;
  } catch {
    // The network can fail after the database committed the request.
    return { error: "unknown" };
  }

  // Keep the Next.js redirect outside catch; redirect itself throws by design.
  redirect(`/cabinet/requests/${createdId}`);
}