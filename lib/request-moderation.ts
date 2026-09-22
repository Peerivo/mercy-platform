import { createHash, randomBytes } from "node:crypto";
import { siteUrl } from "./config";
import { adminSupabase } from "./supabase/admin";

const MODERATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

type RequestModerationInput = {
  id: string;
  category: string;
  country: string;
  city: string;
  description: string;
  urgency: string;
};

export function createRequestModerationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashRequestModerationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function moderationBaseUrl() {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return siteUrl();
}

function moderationLink(
  requestId: string,
  token: string,
  intent: "approve" | "reject"
) {
  const url = new URL(
    `/moderation/requests/${requestId}`,
    moderationBaseUrl()
  );
  url.searchParams.set("token", token);
  url.searchParams.set("intent", intent);
  return url.toString();
}

async function sendModerationEmail(
  input: RequestModerationInput,
  token: string,
  expiresAt: Date
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to =
    process.env.REQUEST_MODERATION_TO_EMAIL ??
    process.env.FEEDBACK_TO_EMAIL;

  if (!apiKey || !from || !to) {
    throw new Error("Request moderation email is not configured.");
  }

  const approveUrl = moderationLink(input.id, token, "approve");
  const rejectUrl = moderationLink(input.id, token, "reject");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Mercy: новая просьба требует согласования ${input.id.slice(0, 8)}`,
      text: [
        "Появилась новая просьба о помощи.",
        "",
        `Категория: ${input.category}`,
        `Страна: ${input.country}`,
        `Город: ${input.city}`,
        `Срочность: ${input.urgency}`,
        "",
        input.description,
        "",
        "Утвердить:",
        approveUrl,
        "",
        "Отклонить:",
        rejectUrl,
        "",
        `Ссылка действует до ${expiresAt.toISOString()} (48 часов) и после решения становится недействительной.`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Resend moderation email failed with status ${response.status}`
    );
  }
}

export async function requestHelpRequestModeration(
  input: RequestModerationInput
) {
  const token = createRequestModerationToken();
  const tokenHash = hashRequestModerationToken(token);
  const expiresAt = new Date(Date.now() + MODERATION_TOKEN_TTL_MS);
  const admin = adminSupabase();

  const { error } = await admin.rpc("issue_help_request_moderation_token", {
    case_id: input.id,
    token_hash_text: tokenHash,
    expires_at_input: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to issue moderation token: ${error.message}`);
  }

  await sendModerationEmail(input, token, expiresAt);

  return expiresAt;
}
