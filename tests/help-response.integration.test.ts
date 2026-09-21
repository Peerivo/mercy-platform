// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
const password = "Response-integration-password-42!";

const ids: Record<string, string> = {};
const clients: Record<string, SupabaseClient> = {};
let caseId = "";

function assertDisposableLocalConfig() {
  const parsed = new URL(url);
  if (process.env.MERCY_DISPOSABLE_SUPABASE !== "true") {
    throw new Error("explicit disposable marker is required");
  }
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.protocol !== "http:" ||
    parsed.port !== "54321"
  ) {
    throw new Error("integration tests only run against local Supabase on port 54321");
  }
  if (!anonKey || !serviceKey || anonKey === serviceKey) {
    throw new Error("local API keys are required");
  }
}

async function signIn(name: string) {
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `mercy-response-${name}-${crypto.randomUUID()}`,
    },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: `${name}@response.mercy.invalid`,
    password,
  });

  if (error || !data.session) {
    throw error ?? new Error(`missing session for ${name}`);
  }

  clients[name] = client;
}

describe.sequential("direct help responses and public feedback", () => {
  beforeAll(async () => {
    assertDisposableLocalConfig();

    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const name of ["response-owner", "response-helper", "response-outsider", "response-coordinator", "response-admin"]) {
      const { data, error } = await service.auth.admin.createUser({
        email: `${name}@response.mercy.invalid`,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error(`missing ${name} fixture`);
      ids[name] = data.user.id;
    }

    const { error: staffError } = await service.from("staff_roles").insert([
      {
        user_id: ids["response-coordinator"],
        role: "COORDINATOR",
        granted_by: ids["response-admin"],
      },
      {
        user_id: ids["response-admin"],
        role: "ADMIN",
        granted_by: ids["response-admin"],
      },
    ]);
    if (staffError) throw staffError;

    await Promise.all(
      ["response-owner", "response-helper", "response-outsider", "response-coordinator", "response-admin"].map(signIn)
    );

    const made = await clients["response-owner"].rpc("create_help_request", {
      payload: {
        category: "OTHER",
        country: "XX",
        city: "Test",
        description: "A fictional request for direct-response integration coverage",
        urgency: "NORMAL",
      },
      consent_version: "request-ru-v2",
    });
    if (made.error || typeof made.data !== "string") {
      throw made.error ?? new Error("request fixture missing");
    }
    caseId = made.data;

    const approved = await clients["response-admin"].rpc(
      "moderate_help_request",
      {
        request_id: caseId,
        new_status: "VERIFIED",
        reason_text: "fictional integration review",
        beneficiary_consent_confirmed: false,
        requester_identity_confirmed: false,
      }
    );
    if (approved.error) throw approved.error;

    const assigned = await clients["response-admin"].rpc("assign_case", {
      case_id: caseId,
      new_coordinator: ids["response-coordinator"],
      reason_text: "direct response integration coverage",
    });
    if (assigned.error) throw assigned.error;
  }, 30_000);

  afterAll(async () => {
    await Promise.all(Object.values(clients).map((client) => client.removeAllChannels()));
  });

  test("response contact stays private to helper, request owner and assigned coordinator", async () => {
    const directInsert = await clients["response-helper"]
      .from("help_request_responses")
      .insert({
        help_request_id: caseId,
        responder_id: ids["response-helper"],
        message: "forged direct insert must fail",
        contact_method: "forged",
      });
    expect(directInsert.error).not.toBeNull();

    const created = await clients["response-helper"].rpc("respond_to_help_request", {
      case_id: caseId,
      payload: {
        message: "I can help with this fictional request today",
        contact_method: "Telegram @integration-helper",
      },
      consent_version: "help-response-v1",
    });
    expect(created.error).toBeNull();
    expect(typeof created.data).toBe("string");
    const responseId = created.data as string;

    for (const actor of ["response-helper", "response-owner", "response-coordinator"]) {
      const rows = await clients[actor]
        .from("help_request_responses")
        .select("id,message,contact_method")
        .eq("id", responseId);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      expect(rows.data?.[0].contact_method).toBe("Telegram @integration-helper");
    }

    expect(
      (await clients["response-outsider"].from("help_request_responses").select("id").eq("id", responseId)).data
    ).toEqual([]);
    expect(
      (await clients["response-admin"].from("help_request_responses").select("id").eq("id", responseId)).data
    ).toEqual([]);

    const ownerAttempt = await clients["response-owner"].rpc("respond_to_help_request", {
      case_id: caseId,
      payload: {
        message: "owner cannot answer own request",
        contact_method: "none",
      },
      consent_version: "help-response-v1",
    });
    expect(ownerAttempt.error?.message).toContain("owner cannot respond");

    const service = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    const consent = await service
      .from("consents")
      .select("user_id,kind,help_response_id")
      .eq("help_response_id", responseId);
    expect(consent.error).toBeNull();
    expect(consent.data).toEqual([
      {
        user_id: ids["response-helper"],
        kind: "HELP_RESPONSE",
        help_response_id: responseId,
      },
    ]);
  });

  test("anonymous feedback is accepted without exposing the feedback inbox", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });

    const sent = await anon.rpc("submit_feedback", {
      message_text: "Registration felt too complicated",
      reply_email: "feedback@example.invalid",
      page_path: "/auth",
    });
    expect(sent.error).toBeNull();
    expect(typeof sent.data).toBe("string");

    expect((await anon.from("feedback_messages").select("*")).error).not.toBeNull();

    const service = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    const stored = await service
      .from("feedback_messages")
      .select("message,page_path")
      .eq("id", sent.data)
      .single();

    expect(stored.error).toBeNull();
    expect(stored.data).toEqual({
      message: "Registration felt too complicated",
      page_path: "/auth",
    });
  });
});
