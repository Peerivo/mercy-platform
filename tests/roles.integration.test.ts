// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
const password = "Local-only-password-42!";
const ids: Record<string, string> = {};
const clients: Record<string, SupabaseClient> = {};
let helpRequestId = "";
let assignmentId = "";
let incidentId = "";

function assertDisposableLocalConfig() {
  const parsed = new URL(url);
  if (process.env.MERCY_DISPOSABLE_SUPABASE !== "true") {
    throw new Error("explicit disposable marker is required");
  }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.protocol !== "http:" || parsed.port !== "54321") {
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
      storageKey: `mercy-roles-${name}-${crypto.randomUUID()}`,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: `${name}@mercy.invalid`,
    password,
  });
  if (error || !data.session) throw error ?? new Error("missing test session");
  clients[name] = client;
}

describe.sequential("Mercy roles and volunteer service", () => {
  beforeAll(async () => {
    assertDisposableLocalConfig();
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const name of ["role-admin", "role-curator", "role-volunteer", "role-patron", "role-owner", "role-outsider"]) {
      const { data, error } = await service.auth.admin.createUser({
        email: `${name}@mercy.invalid`,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("test user missing");
      ids[name] = data.user.id;
    }

    const staff = await service.from("staff_roles").insert({
      user_id: ids["role-admin"],
      role: "ADMIN",
      granted_by: ids["role-admin"],
    });
    if (staff.error) throw staff.error;

    for (const name of ["role-curator", "role-volunteer"]) {
      const consent = await service
        .from("consents")
        .insert({
          user_id: ids[name],
          kind: "IDENTITY_INTEGRATION",
          text_version: "roles-test-v1",
        })
        .select("id")
        .single();
      if (consent.error || !consent.data) throw consent.error ?? new Error("identity consent missing");

      const link = await service.from("identity_links").insert({
        local_user_id: ids[name],
        provider: "ESIA",
        external_subject: `roles-test-${name}`,
        verified_at: new Date().toISOString(),
        consent_id: consent.data.id,
      });
      if (link.error) throw link.error;
    }

    await Promise.all(
      ["role-admin", "role-curator", "role-volunteer", "role-patron", "role-owner", "role-outsider"].map(signIn),
    );
  }, 30_000);

  afterAll(async () => {
    await Promise.all(Object.values(clients).map((client) => client.removeAllChannels()));
  });

  test("unverified users cannot receive privileged Mercy roles", async () => {
    const denied = await clients["role-admin"].rpc("manage_mercy_role", {
      target_user: ids["role-outsider"],
      target_role: "VOLUNTEER",
      enabled: true,
      reason_text: "must be ESIA verified first",
      patron_type: null,
    });
    expect(denied.error?.message).toContain("esia verification required");

    const access = await clients["role-outsider"].rpc("current_mercy_access");
    expect(access.error).toBeNull();
    expect(access.data?.[0]).toMatchObject({
      base_role: "USER",
      identity_role: "USER",
      is_esia_verified: false,
      is_volunteer: false,
    });
  });

  test("admin creates curator, curator can grant volunteer and patron but not admin", async () => {
    expect((await clients["role-admin"].rpc("manage_mercy_role", {
      target_user: ids["role-curator"],
      target_role: "CURATOR",
      enabled: true,
      reason_text: "integration curator",
      patron_type: null,
    })).error).toBeNull();

    expect((await clients["role-curator"].rpc("manage_mercy_role", {
      target_user: ids["role-volunteer"],
      target_role: "VOLUNTEER",
      enabled: true,
      reason_text: "integration volunteer",
      patron_type: null,
    })).error).toBeNull();

    expect((await clients["role-curator"].rpc("manage_mercy_role", {
      target_user: ids["role-patron"],
      target_role: "PATRON",
      enabled: true,
      reason_text: "integration patron",
      patron_type: "LEGAL_ENTITY",
    })).error).toBeNull();

    const forbidden = await clients["role-curator"].rpc("manage_mercy_role", {
      target_user: ids["role-volunteer"],
      target_role: "ADMIN",
      enabled: true,
      reason_text: "must not work",
      patron_type: null,
    });
    expect(forbidden.error).not.toBeNull();

    expect((await clients["role-volunteer"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      identity_role: "VISITOR",
      is_esia_verified: true,
      is_volunteer: true,
      volunteer_status: "ONBOARDING",
    });
    expect((await clients["role-patron"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      identity_role: "USER",
      is_esia_verified: false,
      is_patron: true,
      patron_kind: "LEGAL_ENTITY",
    });
  });

  test("curator activates volunteer with home-visit clearance", async () => {
    const updated = await clients["role-curator"].rpc("update_volunteer_profile", {
      target_user: ids["role-volunteer"],
      new_status: "ACTIVE",
      categories: ["FOOD", "TRANSPORT"],
      online_available: true,
      home_clearance: "CLEARED",
      require_supervision: true,
      reason_text: "integration onboarding complete",
    });
    expect(updated.error).toBeNull();

    const list = await clients["role-curator"].rpc("staff_volunteers", {
      city_filter: null,
      status_filter: "ACTIVE",
      category_filter: "FOOD",
      home_filter: "CLEARED",
      result_limit: 20,
      result_offset: 0,
    });
    expect(list.error).toBeNull();
    expect(list.data?.some((row: { user_id: string }) => row.user_id === ids["role-volunteer"])).toBe(true);

    const outsider = await clients["role-outsider"].rpc("staff_volunteers", {
      city_filter: null,
      status_filter: null,
      category_filter: null,
      home_filter: null,
      result_limit: 20,
      result_offset: 0,
    });
    expect(outsider.error).not.toBeNull();
  });

  test("home visit fails closed until beneficiary consent and case approval are recorded", async () => {
    const made = await clients["role-owner"].rpc("create_help_request", {
      payload: {
        category: "OTHER",
        country: "XX",
        city: "Test",
        description: "A sufficiently long volunteer service integration request",
        urgency: "NORMAL",
        home_visit_required: true,
        visit_household_members: "Owner and relative may be present",
        dogs_present: true,
        cats_present: false,
        visit_animals_notes: "One calm dog can be kept in another room",
        smoking_present: false,
        visit_allergen_notes: "No known smoke or other airborne issue",
        visit_access_notes: "Third floor with stairs",
        visit_other_notes: "Call before arriving",
        visit_trusted_contact: "Relative via private chat",
        video_call_possible: true,
        visit_safety_acknowledged: true,
      },
      consent_version: "request-v1",
    });
    expect(made.error).toBeNull();
    helpRequestId = made.data as string;

    expect((await clients["role-admin"].rpc("assign_case", {
      case_id: helpRequestId,
      new_coordinator: ids["role-curator"],
      reason_text: "integration curator assignment",
    })).error).toBeNull();

    const deniedBeforeSafety = await clients["role-curator"].rpc("assign_volunteer_to_case", {
      case_id: helpRequestId,
      target_volunteer: ids["role-volunteer"],
      assignment_mode: "HOME_PAIRED",
      task_text: "Deliver groceries and confirm receipt",
      companion_user: null,
    });
    expect(deniedBeforeSafety.error?.message).toContain("home visit safety gate");

    expect((await clients["role-curator"].rpc("set_help_request_safety", {
      case_id: helpRequestId,
      requester_is_beneficiary: false,
      consent_status: "PENDING",
      allow_home_visit: false,
      reason_text: "waiting for beneficiary consent",
    })).error).toBeNull();

    const deniedPending = await clients["role-curator"].rpc("assign_volunteer_to_case", {
      case_id: helpRequestId,
      target_volunteer: ids["role-volunteer"],
      assignment_mode: "HOME_PAIRED",
      task_text: "Deliver groceries and confirm receipt",
      companion_user: null,
    });
    expect(deniedPending.error?.message).toContain("home visit safety gate");

    expect((await clients["role-curator"].rpc("set_help_request_safety", {
      case_id: helpRequestId,
      requester_is_beneficiary: false,
      consent_status: "CONFIRMED",
      allow_home_visit: true,
      reason_text: "beneficiary consent independently confirmed",
    })).error).toBeNull();

    expect((await clients["role-curator"].rpc("update_volunteer_visit_limitations", {
      target_user: ids["role-volunteer"],
      avoid_dogs_value: true,
      avoid_cats_value: false,
      avoid_smoke_value: false,
      limitations_text: "No dog visits during integration check",
      reason_text: "record volunteer safety preference",
    })).error).toBeNull();

    const deniedDogConflict = await clients["role-curator"].rpc("assign_volunteer_to_case", {
      case_id: helpRequestId,
      target_volunteer: ids["role-volunteer"],
      assignment_mode: "HOME_PAIRED",
      task_text: "Deliver groceries and confirm receipt",
      companion_user: null,
    });
    expect(deniedDogConflict.error?.message).toContain("dogs");

    expect((await clients["role-curator"].rpc("update_volunteer_visit_limitations", {
      target_user: ids["role-volunteer"],
      avoid_dogs_value: false,
      avoid_cats_value: false,
      avoid_smoke_value: false,
      limitations_text: "",
      reason_text: "clear integration dog restriction",
    })).error).toBeNull();

    const deniedBeforeVideo = await clients["role-curator"].rpc("assign_volunteer_to_case", {
      case_id: helpRequestId,
      target_volunteer: ids["role-volunteer"],
      assignment_mode: "HOME_PAIRED",
      task_text: "Deliver groceries and confirm receipt",
      companion_user: null,
    });
    expect(deniedBeforeVideo.error?.message).toContain("video call required");

    expect((await clients["role-curator"].rpc("confirm_home_visit_video_call", {
      case_id: helpRequestId,
      completed: true,
      reason_text: "integration video call completed",
    })).error).toBeNull();

    const assigned = await clients["role-curator"].rpc("assign_volunteer_to_case", {
      case_id: helpRequestId,
      target_volunteer: ids["role-volunteer"],
      assignment_mode: "HOME_PAIRED",
      task_text: "Deliver groceries and confirm receipt",
      companion_user: null,
    });
    expect(assigned.error).toBeNull();
    assignmentId = assigned.data as string;
  });

  test("assigned volunteer gets only case access, not curator mutation authority", async () => {
    expect((await clients["role-volunteer"].from("help_requests").select("id").eq("id", helpRequestId)).data)
      .toEqual([{ id: helpRequestId }]);

    expect((await clients["role-volunteer"].rpc("send_message", {
      case_id: helpRequestId,
      message_body: "Volunteer assignment update",
      message_nonce: crypto.randomUUID(),
    })).error).toBeNull();

    const statusAttempt = await clients["role-volunteer"].rpc("change_case_status", {
      case_id: helpRequestId,
      new_status: "IN_PROGRESS",
    });
    expect(statusAttempt.error?.message).toContain("access denied");

    const role = await clients["role-volunteer"].rpc("current_case_access", {
      case_id: helpRequestId,
    });
    expect(role.data).toBe("VOLUNTEER");

    const privateSafety = await clients["role-volunteer"].rpc("current_case_visit_safety", {
      case_id: helpRequestId,
    });
    expect(privateSafety.error).toBeNull();
    expect(privateSafety.data?.[0]).toMatchObject({
      home_visit_requested: true,
      dogs_present: true,
      video_call_possible: true,
    });
    expect(
      (await clients["role-outsider"].rpc("current_case_visit_safety", {
        case_id: helpRequestId,
      })).error,
    ).not.toBeNull();
  });

  test("opening an incident suspends access until explicit curator reactivation", async () => {
    const opened = await clients["role-curator"].rpc("open_volunteer_incident", {
      target_volunteer: ids["role-volunteer"],
      case_id: helpRequestId,
      incident_category: "TEST_INCIDENT",
      incident_summary: "Fictional integration incident that must suspend access",
    });
    expect(opened.error).toBeNull();
    incidentId = opened.data as string;

    expect((await clients["role-volunteer"].from("help_requests").select("id").eq("id", helpRequestId)).data).toEqual([]);
    expect((await clients["role-volunteer"].rpc("send_message", {
      case_id: helpRequestId,
      message_body: "must be denied while suspended",
      message_nonce: crypto.randomUUID(),
    })).error?.message).toContain("access denied");

    expect((await clients["role-curator"].rpc("resolve_volunteer_incident", {
      incident_id: incidentId,
      resolution_text: "integration incident reviewed",
    })).error).toBeNull();

    expect((await clients["role-volunteer"].from("help_requests").select("id").eq("id", helpRequestId)).data).toEqual([]);

    expect((await clients["role-curator"].rpc("update_volunteer_profile", {
      target_user: ids["role-volunteer"],
      new_status: "ACTIVE",
      categories: ["FOOD", "TRANSPORT"],
      online_available: true,
      home_clearance: "CLEARED",
      require_supervision: true,
      reason_text: "explicit reactivation after incident review",
    })).error).toBeNull();

    expect((await clients["role-volunteer"].from("help_requests").select("id").eq("id", helpRequestId)).data)
      .toEqual([{ id: helpRequestId }]);
  });

  test("curator can close the volunteer assignment without exposing admin role", async () => {
    expect((await clients["role-curator"].rpc("finish_volunteer_assignment", {
      assignment_id: assignmentId,
      outcome: "COMPLETED",
      reason_text: "integration task completed",
    })).error).toBeNull();

    const mine = await clients["role-volunteer"].rpc("my_volunteer_assignments", {
      result_limit: 20,
    });
    expect(mine.error).toBeNull();
    expect(mine.data?.some((row: { id: string }) => row.id === assignmentId)).toBe(false);

    expect((await clients["role-curator"].rpc("current_mercy_access")).data?.[0]).toMatchObject({
      is_curator: true,
      is_admin: false,
    });
  });
});
