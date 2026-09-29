import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { siteUrl } from "@/lib/config";

export const PEERIVO_STATE_COOKIE = "mercy_peerivo_state";
export const PEERIVO_VERIFIER_COOKIE = "mercy_peerivo_verifier";
export const PEERIVO_NEXT_COOKIE = "mercy_peerivo_next";

export const PEERIVO_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 10 * 60,
};

const clientConfigSchema = z.object({
  authUrl: z.string().url(),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
});

const localSecretSchema = z.string().min(32);

const verifyResponseSchema = z.object({
  active: z.literal(true),
  user: z.object({
    peerivo_user_id: z.string().min(1),
    email: z.string().email(),
  }),
  claims: z
    .object({
      aud: z.string().min(1),
      state: z.string().nullable().optional(),
      redirect_uri: z.string().url().optional(),
    })
    .passthrough(),
});

export type PeerivoVerifiedIdentity = z.infer<typeof verifyResponseSchema>;

export function isPeerivoAuthEnabled() {
  return process.env.PEERIVO_AUTH_ENABLED === "1" || Boolean(process.env.PEERIVO_AUTH_URL);
}

export function peerivoClientConfig() {
  const origin = siteUrl();
  const parsed = clientConfigSchema.safeParse({
    authUrl: process.env.PEERIVO_AUTH_URL,
    clientId: process.env.PEERIVO_AUTH_CLIENT_ID ?? "mercy",
    redirectUri: process.env.PEERIVO_AUTH_REDIRECT_URI ?? new URL("/auth/callback", origin).toString(),
  });

  if (!parsed.success) {
    throw new Error(
      "Peerivo Auth не настроен: задайте PEERIVO_AUTH_URL, PEERIVO_AUTH_CLIENT_ID и " +
        "PEERIVO_AUTH_REDIRECT_URI через canonical secrets store.",
    );
  }

  return parsed.data;
}

function peerivoLocalPasswordSecret() {
  const parsed = localSecretSchema.safeParse(process.env.PEERIVO_AUTH_LOCAL_PASSWORD_SECRET);

  if (!parsed.success) {
    throw new Error(
      "Не настроен PEERIVO_AUTH_LOCAL_PASSWORD_SECRET для Mercy local-session bridge. " +
        "Значение должно приходить из canonical Peerivo secrets store.",
    );
  }

  return parsed.data;
}

export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/cabinet";
  }

  const canonical = new URL(siteUrl());
  const resolved = new URL(value, canonical);

  if (resolved.origin !== canonical.origin) {
    return "/cabinet";
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`.slice(0, 500);
}

function base64Url(input: Buffer) {
  return input.toString("base64url");
}

export function createPeerivoPkce() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createPeerivoState() {
  return base64Url(randomBytes(32));
}

export function buildPeerivoAuthorizeUrl(input: { state: string; codeChallenge: string }) {
  const config = peerivoClientConfig();
  const url = new URL("/authorize", config.authUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export async function verifyPeerivoCode(input: { code: string; codeVerifier: string }) {
  const config = peerivoClientConfig();
  const response = await fetch(new URL("/api/verify-code", config.authUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      client_id: config.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Peerivo Auth verify-code failed: ${response.status}`);
  }

  const parsed = verifyResponseSchema.safeParse(await response.json());

  if (!parsed.success || parsed.data.claims.aud !== config.clientId) {
    throw new Error("Peerivo Auth returned invalid identity payload.");
  }

  return parsed.data;
}

export function deriveMercyLocalPassword(input: { peerivoUserId: string; email: string }) {
  const config = peerivoClientConfig();
  return createHmac("sha256", peerivoLocalPasswordSecret())
    .update(`${config.clientId}:${input.peerivoUserId}:${input.email.toLowerCase()}`)
    .digest("base64url");
}

export function peerivoLogoutUrl(returnTo = "/") {
  if (!isPeerivoAuthEnabled()) return null;
  const config = peerivoClientConfig();
  const url = new URL("/logout", config.authUrl);
  url.searchParams.set("returnTo", new URL(returnTo, siteUrl()).toString());
  return url.toString();
}
