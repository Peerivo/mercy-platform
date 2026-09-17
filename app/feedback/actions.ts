"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { feedbackSchema } from "@/lib/validation";

type FeedbackTopic = "feedback" | "support";

function feedbackLocation(input: {
  topic: FeedbackTopic;
  sourcePath: string;
  status: "sent" | "validation" | "save";
}) {
  const params = new URLSearchParams();
  params.set("topic", input.topic);
  if (input.sourcePath) params.set("from", input.sourcePath);
  if (input.status === "sent") params.set("sent", "1");
  else params.set("error", input.status);
  return `/feedback?${params.toString()}`;
}

async function emailFeedback(input: {
  id: string;
  message: string;
  replyEmail: string;
  pagePath: string;
  topic: FeedbackTopic;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.warn("FEEDBACK EMAIL: Resend environment is not configured");
    return;
  }

  const isSupport = input.topic === "support";
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
      subject: isSupport
        ? `Язык милосердия: поддержка проекта ${input.id.slice(0, 8)}`
        : `Язык милосердия: новая обратная связь ${input.id.slice(0, 8)}`,
      text: [
        `ID: ${input.id}`,
        `Тип: ${isSupport ? "поддержка проекта" : "обратная связь"}`,
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
  const topic: FeedbackTopic =
    formData.get("topic") === "support" ? "support" : "feedback";
  const rawSourcePath = String(formData.get("sourcePath") ?? "");
  const sourcePath =
    rawSourcePath.startsWith("/") && !rawSourcePath.startsWith("//")
      ? rawSourcePath.slice(0, 500)
      : "";

  const parsed = feedbackSchema.safeParse({
    message: formData.get("message"),
    replyEmail: formData.get("replyEmail") ?? "",
    pagePath:
      topic === "support"
        ? sourcePath || "/feedback?topic=support"
        : formData.get("pagePath") ?? "",
  });

  if (!parsed.success || (topic === "support" && !parsed.data.replyEmail)) {
    redirect(feedbackLocation({ topic, sourcePath, status: "validation" }));
  }

  const s = await serverSupabase();
  const { data, error } = await s.rpc("submit_feedback", {
    message_text: parsed.data.message,
    reply_email: parsed.data.replyEmail || null,
    page_path: parsed.data.pagePath || null,
  });

  if (error || typeof data !== "string") {
    console.error("FEEDBACK SAVE:", error?.code, error?.message);
    redirect(feedbackLocation({ topic, sourcePath, status: "save" }));
  }

  await emailFeedback({
    id: data,
    message: parsed.data.message,
    replyEmail: parsed.data.replyEmail,
    pagePath: parsed.data.pagePath,
    topic,
  });

  redirect(feedbackLocation({ topic, sourcePath, status: "sent" }));
}
