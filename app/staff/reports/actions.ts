"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { helpRequestReportReviewSchema } from "@/lib/validation";

export async function reviewReport(
  formData: FormData
) {
  const parsed =
    helpRequestReportReviewSchema.safeParse({
      id: formData.get("id"),
      status: formData.get("status"),
      note: formData.get("note"),
    });

  if (!parsed.success) {
    redirect(
      "/staff/reports?error=validation"
    );
  }

  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { error } = await s.rpc(
    "review_help_request_report",
    {
      report_id: parsed.data.id,
      new_status: parsed.data.status,
      note_text: parsed.data.note,
    }
  );

  if (error) {
    redirect(
      "/staff/reports?error=review"
    );
  }

  redirect(
    "/staff/reports?reviewed=1"
  );
}