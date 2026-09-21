import { siteUrl } from "@/lib/config";

export async function notifyRequestReview(input: {
  id: string;
  caseNumber: number;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to =
    process.env.REQUEST_REVIEW_TO_EMAIL || process.env.FEEDBACK_TO_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.warn("REQUEST REVIEW EMAIL: Resend environment is not configured");
    return;
  }

  let reviewUrl: string;
  try {
    reviewUrl = new URL(
      `/staff/requests#request-${input.id}`,
      siteUrl()
    ).toString();
  } catch {
    console.warn("REQUEST REVIEW EMAIL: site URL is not configured");
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
      subject: `Mercy: просьба № ${input.caseNumber} ждёт проверки`,
      text: [
        `Новая просьба № ${input.caseNumber} сохранена, но ещё не опубликована.`,
        "",
        "Откройте очередь проверки:",
        reviewUrl,
        "",
        "Для просьбы за другого человека отдельно подтвердите его согласие.",
        "Для домашнего визита отдельно подтвердите личность автора просьбы.",
        "Документы и их копии в Mercy не сохраняйте.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    console.error("REQUEST REVIEW EMAIL: Resend returned", response.status);
  }
}
