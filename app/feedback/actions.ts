"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { feedbackSchema } from "@/lib/validation";

async function emailFeedback(input: {
  id: string;
  message: string;
  replyEmail: string;
  pagePath: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.warn("FEEDBACK EMAIL: Resend environment is not configured");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: input.replyEmail || undefined,
      subject: `Язык милосердия: новая обратная связь ${input.id.slice(0, 8)}`,
      text: [
        `ID: ${input.id}`,
        `Страница: ${input.pagePath || "не указана"}`,
        `Email для ответа: ${input.replyEmail || "не указан"}`,
        "",
        input.message,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    console.error("FEEDBACK EMAIL: Resend returned", response.status);
  }
}

export async function submitFeedback(formData: FormData) {
  const parsed = feedbackSchema.safeParse({
    message: formData.get("message"),
    replyEmail: formData.get("replyEmail") ?? "",
    pagePath: formData.get("pagePath") ?? "",
  });

  if (!parsed.success) {
    redirect("/feedback?error=validation");
  }

  const s = await serverSupabase();
  const { data, error } = await s.rpc("submit_feedback", {
    message_text: parsed.data.message,
    reply_email: parsed.data.replyEmail || null,
    page_path: parsed.data.pagePath || null,
  });

  if (error || typeof data !== "string") {
    console.error("FEEDBACK SAVE:", error?.code, error?.message);
    redirect("/feedback?error=save");
  }

  await emailFeedback({
    id: data,
    message: parsed.data.message,
    replyEmail: parsed.data.replyEmail,
    pagePath: parsed.data.pagePath,
  });

  redirect("/feedback?sent=1");
}
