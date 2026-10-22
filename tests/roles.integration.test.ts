// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
const password = "Local-only-password-42!";
const ids: Record<string, string> = {};
const clients: Record<string, SupabaseClient> = {};
let requestId = "";
let assignmentId = "";
let incidentId = "";

function assertDisposableLocalConfig() {
  const parsed = new URL(url);
  if (process.env.MERCY_DISPOSABLE_SUPABASE !== "true") throw new Error("disposable marker required");
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.protocol !== "http:" || parsed.port !== "54321") {
    throw new Error("only disposable local Supabase on port 54321 is permitted");
  }
  if (!anonKey || !serviceKey || anonKey === serviceKey) throw new Error("local keys required");
}

async function signIn(name: string) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
            storageKey: `mercy-v1-${name}-${crypto.randomUUID()}` },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: `${name}@mercy.invalid`, password,
  });
  if (error || !data.session) throw error ?? new Error("missing session");
  clients[name] = client;
}

describe.sequential("Mercy v1 email roles and volunteer access", () => {
  beforeAll(async () => {
    assertDisposableLocalConfig();
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const name of ["v1-admin", "v1-curator", "v1-volunteer", "v1-patron",
                        "v1-owner", "v1-outsider", "v1-unconfirmed"]) {
      const { data, error } = await service.auth.admin.createUser({
        email: `${name}@mercy.invalid`, password, email_confirm: name !== "v1-unconfirmed",
      });
      if (error || !data.user) throw error ?? new Error("test user missing");
      ids[name] = data.user.id;
    }
    const grant = await service.from("staff_roles").insert({
      user_id: ids["v1-admin"], role: "ADMIN", granted_by: ids["v1-admin"],
    });
    if (grant.error) throw grant.error;
    await Promise.all(
      ["v1-admin", "v1-curator", "v1-volunteer", "v1-patron", "v1-owner", "v1-outsider"].map(signIn),
    );
  }, 30_000);

  afterAll(async () => {
    await Promise.all(Object.values(clients).map(c => c.removeAllChannels()));
  });

  test("email-confirmed users may receive roles without external identity links", async () => {
    const initially = await clients["v1-volunteer"].rpc("current_mercy_access");
    expect(initially.error).toBeNull();
    expect(initially.data?.[0]).toMatchObject({ base_role: "USER", identity_role: "USER",
      is_visitor: false, is_volunteer: false });

    const unconfirmed = await clients["v1-admin"].rpc("manage_mercy_role", {
      target_user: ids["v1-unconfirmed"], target_role: "VOLUNTEER",
      enabled: true, reason_text: "should require confirmed email", patron_type: null,
    });
    expect(unconfirmed.error?.message).toContain("confirmed email required");

    expect((await clients["v1-admin"].rpc("manage_mercy_role", {
      target_user: ids["v1-curator"], target_role: "CURATOR",
      enabled: true, reason_text: "curator appointment", patron_type: null,
    })).error).toBeNull();

    expect((await clients["v1-curator"].rpc("manage_mercy_role", {
      target_user: ids["v1-volunteer"], target_role: "VOLUNTEER",
      enabled: true, reason_text: "volunteer appointment", patron_type: null,
    })).error).toBeNull();
    expect((await clients["v1-curator"].rpc("manage_mercy_role", {
      target_user: ids["v1-patron"], target_role: "PATRON",
      enabled: true, reason_text: "patron appointment", patron_type: "LEGAL_ENTITY",
    })).error).toBeNull();

    expect((await clients["v1-curator"].rpc("manage_mercy_role", {
      target_user: ids["v1-outsider"], target_role: "ADMIN",
      enabled: true, reason_text: "unauthorized admin appointment", patron_type: null,
    })).error).not.toBeNull();
    expect((await clients["v1-outsider"].rpc("staff_find_user_by_email", {
      exact_email: "v1-volunteer@mercy.invalid",
    })).error).not.toBeNull();
    expect((await clients["v1-volunteer"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      is_volunteer: true, volunteer_status: "ONBOARDING",
    });
    expect((await clients["v1-patron"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      is_patron: true, patron_kind: "LEGAL_ENTITY",
    });
  });

  test("curator configures, lists and protects volunteer records", async () => {
    expect((await clients["v1-curator"].rpc("update_volunteer_profile", {
      target_user: ids["v1-volunteer"], new_status: "ACTIVE",
      categories: ["FOOD", "TRANSPORT"], online_available: true,
      reason_text: "onboarding completed",
    })).error).toBeNull();
    const list = await clients["v1-curator"].rpc("staff_volunteers", {
      city_filter: null, status_filter: "ACTIVE", category_filter: "FOOD",
      result_limit: 20, result_offset: 0,
    });
    expect(list.error).toBeNull();
    expect(list.data?.some((row: { user_id: string }) => row.user_id === ids["v1-volunteer"])).toBe(true);
    expect((await clients["v1-outsider"].rpc("staff_volunteers", {
      city_filter: null, status_filter: null, category_filter: null,
      result_limit: 20, result_offset: 0,
    })).error).not.toBeNull();
  });

  test("visitor is a request author; curator may assign active volunteer without visit survey", async () => {
    const made = await clients["v1-owner"].rpc("create_help_request", {
      payload: { category: "OTHER", country: "XX", city: "Test",
        description: "A sufficiently long fictional volunteer service request",
        urgency: "NORMAL" },
      consent_version: "request-v1",
    });
    expect(made.error).toBeNull();
    requestId = made.data as string;
    expect((await clients["v1-owner"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      identity_role: "VISITOR", is_visitor: true,
    });

    expect((await clients["v1-admin"].rpc("assign_case", {
      case_id: requestId, new_coordinator: ids["v1-curator"],
      reason_text: "test curator appointment",
    })).error).toBeNull();

    const assigned = await clients["v1-curator"].rpc("assign_volunteer_to_case", {
      case_id: requestId, target_volunteer: ids["v1-volunteer"],
      assignment_mode: "REMOTE", task_text: "Coordinate delivery of food",
    });
    expect(assigned.error).toBeNull();
    assignmentId = assigned.data as string;

    const denied = await clients["v1-outsider"].rpc("assign_volunteer_to_case", {
      case_id: requestId, target_volunteer: ids["v1-outsider"],
      assignment_mode: "HOME", task_text: "Unauthorized appointment",
    });
    expect(denied.error).not.toBeNull();
  });

  test("assigned volunteer may read and message own case but cannot mutate status or see other private data", async () => {
    const volunteer = clients["v1-volunteer"];
    expect((await volunteer.from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([{ id: requestId }]);
    expect((await volunteer.rpc("send_message", { case_id: requestId,
      message_body: "A volunteer update for the assigned request",
      message_nonce: crypto.randomUUID(),
    })).error).toBeNull();
    expect((await volunteer.rpc("change_case_status", {
      case_id: requestId, new_status: "IN_PROGRESS",
    })).error).not.toBeNull();
    expect((await volunteer.rpc("current_case_access", { case_id: requestId })).data).toBe("VOLUNTEER");
    expect((await clients["v1-outsider"].from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([]);
    expect((await clients["v1-outsider"].rpc("current_case_access", { case_id: requestId })).data)
      .toBeNull();
  });

  test("incident suspends existing access; explicit reactivation required", async () => {
    const opened = await clients["v1-curator"].rpc("open_volunteer_incident", {
      target_volunteer: ids["v1-volunteer"], case_id: requestId,
      incident_category: "TEST_INCIDENT", incident_summary: "Fictional suspension integration incident",
    });
    expect(opened.error).toBeNull();
    incidentId = opened.data as string;
    expect((await clients["v1-volunteer"].from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([]);
    expect((await clients["v1-volunteer"].rpc("send_message", { case_id: requestId,
      message_body: "must be denied while suspended", message_nonce: crypto.randomUUID(),
    })).error).not.toBeNull();

    expect((await clients["v1-curator"].rpc("resolve_volunteer_incident", {
      incident_id: incidentId, resolution_text: "incident reviewed",
    })).error).toBeNull();
    expect((await clients["v1-volunteer"].from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([]);

    expect((await clients["v1-curator"].rpc("update_volunteer_profile", {
      target_user: ids["v1-volunteer"], new_status: "ACTIVE",
      categories: ["FOOD"], online_available: true,
      reason_text: "curator manually reactivated service",
    })).error).toBeNull();
    expect((await clients["v1-volunteer"].from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([{ id: requestId }]);
  });

  test("completed appointment revokes the case access", async () => {
    expect((await clients["v1-curator"].rpc("finish_volunteer_assignment", {
      assignment_id: assignmentId, outcome: "COMPLETED", reason_text: "task completed",
    })).error).toBeNull();
    expect((await clients["v1-volunteer"].from("help_requests").select("id").eq("id",requestId)).data)
      .toEqual([]);
    expect((await clients["v1-volunteer"].rpc("my_volunteer_assignments", { result_limit: 20 })).data
      ?.some((row: { id: string }) => row.id === assignmentId)).toBe(false);
  });
});
