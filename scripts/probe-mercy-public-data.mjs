// Standalone, read-only production probe. Also runs when streamed to `node
// --input-type=module -`; never read credentials from argv, files or stdin.
import { createHash } from "node:crypto";

const canonicalOrigin = "https://api.mercy.peerivo.net";
const endpoint = `${canonicalOrigin}/rest/v1/rpc/list_public_help_requests`;
const maxBodyBytes = 65_536;
const transportCodes = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_SSL_WRONG_VERSION_NUMBER", "ABORT_ERR",
]);
// Exact diagnostic identifiers only. Error messages, details, hints and unknown
// codes are deliberately discarded, including on non-JSON error responses.
const postgrestCodes = new Set([
  "PGRST000", "PGRST001", "PGRST002", "PGRST003",
  "PGRST100", "PGRST101", "PGRST102", "PGRST103", "PGRST106",
  "PGRST107", "PGRST108", "PGRST116", "PGRST200", "PGRST201",
  "PGRST202", "PGRST203", "PGRST204", "PGRST205",
  "PGRST300", "PGRST301", "PGRST302", "PGRST303",
  "42501", "42883", "42P01", "57014", "53300", "57P01", "08006",
]);

function jsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicKeyFacts(key) {
  if (typeof key !== "string" || key.length < 20 || key.length > 4096) return null;
  let type;
  let role = null;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    type = "publishable";
  } else {
    // JWT decoding classifies the public credential, not its authenticity. The
    // API must still accept it. Reject malformed/ambiguous encodings and roles
    // before sending anything or even emitting a credential fingerprint.
    const segments = key.split(".");
    if (segments.length !== 3 || segments.some(segment =>
      !/^[A-Za-z0-9_-]+$/.test(segment) ||
      Buffer.from(segment, "base64url").toString("base64url") !== segment)) return null;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const headerText = decoder.decode(Buffer.from(segments[0], "base64url"));
      const claimsText = decoder.decode(Buffer.from(segments[1], "base64url"));
      // Public Supabase API JWTs have literal ASCII claim names. Refuse escaped
      // names and duplicate role/algorithm fields rather than guessing which
      // interpretation an upstream validator will use.
      if (headerText.includes("\\") || claimsText.includes("\\") ||
          (headerText.match(/"alg"\s*:/g) || []).length !== 1 ||
          (claimsText.match(/"role"\s*:/g) || []).length !== 1) return null;
      const header = JSON.parse(headerText);
      const claims = JSON.parse(claimsText);
      if (!jsonObject(header) || !jsonObject(claims) ||
          !["HS256", "RS256", "ES256", "EdDSA"].includes(header.alg) ||
          (header.typ !== undefined && header.typ !== "JWT") ||
          claims.role !== "anon" || Buffer.from(segments[2], "base64url").length < 16) return null;
      type = "jwt";
      role = "anon";
    } catch {
      return null;
    }
  }
  return { type, role, sha256: createHash("sha256").update(key).digest("hex") };
}

async function probe() {
  const started = performance.now();
  const facts = {
    http_status: null,
    failure_category: "invalid_config",
    postgrest_code: null,
    transport_cause: null,
    elapsed_ms: 0,
    public_key: null,
  };
  let deadline;
  let reader;
  let consumed = false;
  const finish = (category) => {
    facts.failure_category = category;
    facts.elapsed_ms = Math.max(0, Math.round(performance.now() - started));
    return facts;
  };
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url !== canonicalOrigin && url !== `${canonicalOrigin}/`) return finish("invalid_config");
    // Same precedence as lib/config.ts, with no fallback from an invalid,
    // nonempty publishable setting to a different credential.
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    facts.public_key = publicKeyFacts(key);
    if (!facts.public_key) return finish("invalid_public_key");

    deadline = AbortSignal.timeout(5_000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        category_filter: null,
        city_filter: null,
        urgency_filter: null,
        state_filter: "ACTIVE",
        result_limit: 1,
        result_offset: 0,
      }),
      cache: "no-store",
      redirect: "error",
      signal: deadline,
    });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      return finish("invalid_response");
    }
    facts.http_status = response.status;
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return finish("redirect_rejected");
    }
    if (!response.body) return finish("body_incomplete");
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (deadline.aborted) return finish("timeout");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) return finish("body_too_large");
      chunks.push(value);
    }
    consumed = true;
    let body;
    try {
      // Fatal decoding rejects malformed UTF-8 instead of silently repairing it.
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    } catch {
      return finish("invalid_json");
    }
    if (facts.http_status !== 200) {
      if (jsonObject(body) && typeof body.code === "string" && postgrestCodes.has(body.code)) {
        facts.postgrest_code = body.code;
      }
      return finish("http_error");
    }
    if (!Array.isArray(body) || body.length > 1 || body.some(row => !jsonObject(row))) {
      return finish("invalid_response");
    }
    if (deadline.aborted) return finish("timeout");
    return finish("none");
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    if (typeof code === "string" && transportCodes.has(code)) facts.transport_cause = code;
    if (deadline?.aborted) return finish("timeout");
    // Node fetch does not expose redirect status when redirect:error rejects.
    // Match its fixed sentinel; never include any exception text in the output.
    if (error?.cause?.message === "unexpected redirect") return finish("redirect_rejected");
    return finish(reader ? "body_incomplete" : "transport_error");
  } finally {
    // Do not let an over-limit or failed response keep downloading. Cancellation
    // is best-effort and never awaited beyond the request deadline.
    if (reader && !consumed) void reader.cancel().catch(() => {});
  }
}

const result = await probe();
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.failure_category === "none" ? 0 : 1;
