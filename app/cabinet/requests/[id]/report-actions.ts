"use server";

import { serverSupabase } from "@/lib/supabase/server";
import { helpRequestReportSchema } from "@/lib/validation";

export type ReportActionState = {
  ok: boolean;
  message: string;
};

export async function submitRequestReport(
  _: ReportActionState,
  formData: FormData
): Promise<ReportActionState> {
  const parsed = helpRequestReportSchema.safeParse({
    caseId: formData.get("caseId"),
    reason: formData.get("reason"),
    details: formData.get("details") ?? "",
    reporterToken: formData.get("reporterToken"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Проверьте выбранную причину и комментарий.",
    };
  }

  const s = await serverSupabase();

  const { error } = await s.rpc(
    "submit_help_request_report",
    {
      case_id: parsed.data.caseId,
      reason_code: parsed.data.reason,
      details_text: parsed.data.details,
      reporter_token: parsed.data.reporterToken,
    }
  );

  if (error) {
    if (error.message.includes("rate limit")) {
      return {
        ok: false,
        message:
          "Слишком много жалоб. Попробуйте позже.",
      };
    }

    return {
      ok: false,
      message:
        "Не удалось отправить жалобу. Попробуйте ещё раз.",
    };
  }

  return {
    ok: true,
    message:
      "Спасибо. Жалоба отправлена администратору.",
  };
}