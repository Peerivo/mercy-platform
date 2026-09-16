"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { requestResponseSchema } from "@/lib/validation";

export type RequestResponseState = {
  ok: boolean;
  message: string;
};

export async function respondToRequest(
  _previous: RequestResponseState,
  formData: FormData
): Promise<RequestResponseState> {
  const parsed = requestResponseSchema.safeParse({
    caseId: formData.get("caseId"),
    message: formData.get("message"),
    contactMethod: formData.get("contactMethod"),
    consent: formData.get("consent") === "on",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Проверьте сообщение, способ связи и согласие.",
    };
  }

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) {
    redirect(
      `/auth?next=${encodeURIComponent(
        `/cabinet/requests/${parsed.data.caseId}#help-response`
      )}`
    );
  }

  const { error } = await s.rpc("respond_to_help_request", {
    case_id: parsed.data.caseId,
    payload: {
      message: parsed.data.message,
      contact_method: parsed.data.contactMethod,
    },
    consent_version: "help-response-v1",
  });

  if (error) {
    console.error("HELP RESPONSE:", error.code, error.message);

    if (error.message.includes("owner cannot respond")) {
      return { ok: false, message: "Нельзя откликнуться на собственную просьбу." };
    }
    if (error.message.includes("completed")) {
      return { ok: false, message: "Эта просьба уже завершена." };
    }

    return {
      ok: false,
      message: "Не удалось отправить отклик. Попробуйте ещё раз.",
    };
  }

  revalidatePath(`/cabinet/requests/${parsed.data.caseId}`);

  return {
    ok: true,
    message: "Отклик отправлен. Автор просьбы сможет увидеть ваше сообщение и способ связи.",
  };
}
