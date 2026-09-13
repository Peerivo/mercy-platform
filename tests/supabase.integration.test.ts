// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
const password = "Local-only-password-42!";
const ids: Record<string, string> = {};
const clients: Record<string, SupabaseClient> = {};
let case1 = "";
let case2 = "";
let case3 = "";

function assertDisposableLocalConfig() {
  const parsed = new URL(url);
  if (process.env.MERCY_DISPOSABLE_SUPABASE !== "true") throw new Error("explicit disposable marker is required");
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.protocol !== 'http:' || parsed.port !== '54321')
    throw new Error("integration tests only run against local Supabase on port 54321");
  if (!anonKey || !serviceKey || anonKey === serviceKey) throw new Error("local API keys are required");
}

function diagnostic(label: string, detail: unknown) {
  const safe = detail instanceof Error
    ? { name: detail.name, message: detail.message }
    : typeof detail === "string" ? detail : JSON.stringify(detail);
  console.error(`[integration] ${label}:`, safe);
}

async function waitSubscribed(channel: RealtimeChannel) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timeout")), 15_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        diagnostic(`Realtime channel ${status}`, error ?? "no SDK error detail");
        reject(new Error(`Realtime channel ${status}`));
      }
    });
  });
}

async function signIn(name: string) {
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `mercy-integration-${name}-${crypto.randomUUID()}`,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: `${name}@mercy.invalid`, password });
  if (error || !data.session) {
    diagnostic(`Auth sign-in failed for ${name}`, error ?? "session missing");
    throw error ?? new Error(`Auth session missing for ${name}`);
  }
  await client.realtime.setAuth(data.session.access_token);
  clients[name] = client;
}

async function createAssignedCase(owner: string, coordinator: string, label: string) {
  const made = await clients[owner].rpc("create_help_request", {
    payload: { category: "OTHER", country: "XX", city: "Test", description: `${label} sufficiently long fictional request`, urgency: "NORMAL" },
    consent_version: "request-v1",
  });
  if (made.error || typeof made.data !== "string") {
    diagnostic(`${label} fixture request failed`, made.error ?? "request id missing");
    throw made.error ?? new Error("fixture request id missing");
  }
  const assigned = await clients.a1.rpc("assign_case", { case_id: made.data, new_coordinator: ids[coordinator], reason_text: `${label} fixture assignment` });
  if (assigned.error) {
    diagnostic(`${label} fixture assignment failed`, assigned.error);
    throw assigned.error;
  }
  expect((await clients[owner].from("help_requests").select("id").eq("id", made.data)).data).toHaveLength(1);
  expect((await clients[coordinator].from("help_requests").select("id").eq("id", made.data)).data).toHaveLength(1);
  return made.data;
}

describe.sequential("disposable Supabase security boundary", () => {
  beforeAll(async () => {
    assertDisposableLocalConfig();
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const name of ["u1", "u2", "u3", "c1", "c2", "a1"]) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${name}@mercy.invalid`, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("fixture user missing");
      ids[name] = data.user.id;
    }
    const { error: roleError } = await admin.from("staff_roles").insert([
      { user_id: ids.c1, role: "COORDINATOR", granted_by: ids.a1 },
      { user_id: ids.c2, role: "COORDINATOR", granted_by: ids.a1 },
      { user_id: ids.a1, role: "ADMIN", granted_by: ids.a1 },
    ]);
    if (roleError) throw roleError;
    await Promise.all(["u1", "u2", "u3", "c1", "c2", "a1"].map(signIn));
  }, 30_000);

  afterAll(async () => { await Promise.all(Object.values(clients).map(c => c.removeAllChannels())); });

  test("anonymous sees only doubly verified, non-confidential catalog rows", async () => {
    const svc = createClient(url, serviceKey);
    const now = new Date().toISOString();
    const { data: orgs, error } = await svc.from("organizations").insert([
      { name: "Тестовая опубликованная организация", review_status: "VERIFIED", verified_at: now, published_at: now },
      { name: "Тестовая черновая организация", review_status: "PENDING" },
    ]).select();
    expect(error).toBeNull();
    const locations = await svc.from("service_locations").insert([
      { organization_id: orgs![0].id, name: "Тестовая ближняя точка", categories: ["FOOD"], country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, location: "POINT(30 60)", is_confidential_address: false, languages: [], formats: [] },
      { organization_id: orgs![0].id, name: "Тестовая дальняя точка", categories: ["FOOD"], country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, location: "POINT(30.1 60)", is_confidential_address: false, languages: [], formats: [] },
      { organization_id: orgs![1].id, name: "Тестовая скрытая точка", categories: [], country: "XX", city: "Test", cost_type: "FREE", review_status: "PENDING", location: "POINT(30 60)", is_confidential_address: false, languages: [], formats: [] },
      { organization_id: orgs![0].id, name: "Тестовое убежище", categories: [], country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, is_confidential_address: true, languages: [], formats: [] },
    ]);
    expect(locations.error).toBeNull();
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const list = await anon.from("published_service_locations").select("name,address_public");
    expect(list.error).toBeNull(); expect(list.data?.map(x => x.name).sort()).toEqual(["Тестовая ближняя точка", "Тестовая дальняя точка"].sort());
    const geo = await anon.rpc("nearby_service_locations", { user_lat: 60, user_lon: 30, radius_m: 20_000, result_limit: 1, result_offset: 0 });
    expect(geo.error).toBeNull(); expect(geo.data).toHaveLength(1); expect(geo.data![0].name).toBe("Тестовая ближняя точка"); expect(geo.data![0].distance_meters).toBeLessThan(1);
    for (const [fn, args] of [
      ["send_message", { case_id: crypto.randomUUID(), message_body: "forbidden", message_nonce: crypto.randomUUID() }],
      ["assignment_queue", { queue_limit: 1, queue_offset: 0 }],
      ["set_staff_role", { target_user: crypto.randomUUID(), target_role: "COORDINATOR", enabled: true, reason_text: "forbidden" }],
    ] as const) {
      const denied = await anon.rpc(fn, args);
      expect(denied.error?.message.toLowerCase()).toContain("permission denied");
    }
  });

  test("U1 creates a request but U2 and an unassigned coordinator cannot read it", async () => {
    const made = await clients.u1.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "A sufficiently long fictional request", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(made.error).toBeNull(); case1 = made.data as string;
    const second = await clients.u1.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "A second sufficiently long fictional request", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(second.error).toBeNull(); case2 = second.data as string;
    expect((await clients.u1.from("help_requests").select("id").eq("id", case1)).data).toHaveLength(1);
    for (const actor of ["u2", "c1", "a1"]) expect((await clients[actor].from("help_requests").select("id,description").eq("id", case1)).data).toEqual([]);
  });

  test("known UUID, forged ownership/author/assignment, audit and admin RPC attacks fail", async () => {
    expect((await clients.u2.from("help_requests").update({ owner_id: ids.u2 }).eq("id", case1)).error).not.toBeNull();
    expect((await clients.u2.from("messages").insert({ help_request_id: case1, author_id: ids.u1, client_nonce: crypto.randomUUID(), body: "forged" })).error).not.toBeNull();
    expect((await clients.u2.from("case_assignments").insert({ help_request_id: case1, coordinator_id: ids.u2, assigned_by: ids.u2, reason: "forged" })).error).not.toBeNull();
    expect((await clients.u2.from("audit_events").insert({ action: "FORGED", object_type: "case" })).error).not.toBeNull();
    expect((await clients.u2.rpc("assign_case", { case_id: case1, new_coordinator: ids.c1, reason_text: "forged" })).error).not.toBeNull();
    await clients.u2.auth.updateUser({ data: { role: "ADMIN", staff_role: "ADMIN" } });
    expect((await clients.u2.rpc("assignment_queue", { queue_limit: 10, queue_offset: 0 })).data).toEqual([]);
  });

  test("admin sees the minimal queue, assigns C1, but cannot read private content", async () => {
    const queue = await clients.a1.rpc("assignment_queue", { queue_limit: 10, queue_offset: 0 });
    expect(queue.error).toBeNull(); expect(queue.data?.some((r: {id:string}) => r.id === case1)).toBe(true); expect(JSON.stringify(queue.data)).not.toContain("sufficiently long");
    expect((await clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c1, reason_text: "test assignment" })).error).toBeNull();
    expect((await clients.a1.from("help_requests").select("description").eq("id", case1)).data).toEqual([]);
    expect((await clients.c1.from("help_requests").select("id,description").eq("id", case1)).data).toHaveLength(1);
  });

  test("message nonce is idempotent, immutable, and scoped to its author", async () => {
    for (const invalid of [
      { case_id: null, message_body: "valid body", message_nonce: crypto.randomUUID() },
      { case_id: case1, message_body: null, message_nonce: crypto.randomUUID() },
      { case_id: case1, message_body: "valid body", message_nonce: null },
      { case_id: case1, message_body: "   ", message_nonce: crypto.randomUUID() },
    ]) expect((await clients.u1.rpc("send_message", invalid)).error?.message).toContain("invalid message");
    const nonce = crypto.randomUUID();
    const first = await clients.u1.rpc("send_message", { case_id: case1, message_body: "idempotent hello", message_nonce: nonce });
    const retry = await clients.u1.rpc("send_message", { case_id: case1, message_body: "  idempotent hello  ", message_nonce: nonce });
    expect(first.error).toBeNull(); expect(retry.data.id).toBe(first.data.id);
    const bodyConflict = await clients.u1.rpc("send_message", { case_id: case1, message_body: "different body", message_nonce: nonce });
    const caseConflict = await clients.u1.rpc("send_message", { case_id: case2, message_body: "idempotent hello", message_nonce: nonce });
    expect(bodyConflict.error?.message).toContain("message nonce conflict");
    expect(caseConflict.error?.message).toContain("message nonce conflict");
    expect(bodyConflict.error?.message).not.toContain(first.data.id);
    expect(caseConflict.error?.message).not.toContain(case1);
    expect((await clients.u1.from("messages").select("id").eq("client_nonce", nonce)).data).toHaveLength(1);
    expect((await clients.u2.rpc("send_message", { case_id: case1, message_body: "steal nonce", message_nonce: nonce })).error).not.toBeNull();
    expect((await clients.u1.from("messages").update({ body: "edited" }).eq("id", first.data.id)).error).not.toBeNull();
    expect((await clients.u1.from("messages").delete().eq("id", first.data.id)).error).not.toBeNull();
  });

  test("open Realtime subscription loses access after reassignment and reconnect", async () => {
    const realtimeCase = await createAssignedCase("u1", "c1", "reassignment");
    const seen = { u1: [] as string[], c1: [] as string[], c2: [] as string[], u2: [] as string[] };
    const channels = Object.fromEntries(Object.keys(seen).map(name => [name, clients[name]
      .channel(`reassignment-${name}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
        const body = (payload.new as {body?: unknown}).body;
        if (typeof body === "string") seen[name as keyof typeof seen].push(body);
        else diagnostic(`Realtime payload without a body for ${name}`, { eventType: payload.eventType });
      })])) as Record<string, RealtimeChannel>;
    let reconnect: RealtimeChannel | undefined;
    try {
      await Promise.all(Object.entries(channels).map(async ([name, channel]) => {
        await waitSubscribed(channel);
        expect((await clients[name].auth.getSession()).data.session).not.toBeNull();
      }));
      const before = `reassignment-before-${crypto.randomUUID()}`;
      const initial = await clients.u1.rpc("send_message", { case_id: realtimeCase, message_body: before, message_nonce: crypto.randomUUID() });
      if (initial.error) diagnostic("reassignment control send failed", initial.error);
      expect(initial.error).toBeNull(); expect(initial.data?.id).toBeTruthy();
      expect((await clients.u1.from("messages").select("id").eq("id", initial.data.id)).data).toHaveLength(1);
      expect((await clients.c1.from("messages").select("id").eq("id", initial.data.id)).data).toHaveLength(1);
      await expect.poll(() => ({ u1: seen.u1.includes(before), c1: seen.c1.includes(before) }), { timeout: 10_000 })
        .toEqual({ u1: true, c1: true });
      expect(seen.u2).not.toContain(before);

      const reassigned = await clients.a1.rpc("assign_case", { case_id: realtimeCase, new_coordinator: ids.c2, reason_text: "reassignment access test" });
      if (reassigned.error) diagnostic("reassignment RPC failed", reassigned.error);
      expect(reassigned.error).toBeNull(); expect(reassigned.data).toBeNull();
      const after = `reassignment-after-${crypto.randomUUID()}`;
      const allowed = await clients.u1.rpc("send_message", { case_id: realtimeCase, message_body: after, message_nonce: crypto.randomUUID() });
      if (allowed.error) diagnostic("post-reassignment control send failed", allowed.error);
      expect(allowed.error).toBeNull(); expect(allowed.data?.id).toBeTruthy();
      expect((await clients.c2.from("messages").select("id").eq("id", allowed.data.id)).data).toHaveLength(1);
      await expect.poll(() => ({ owner: seen.u1.includes(after), assigned: seen.c2.includes(after) }), { timeout: 10_000 })
        .toEqual({ owner: true, assigned: true });
      expect(seen.c1).not.toContain(after); expect(seen.u2).not.toContain(after);
      expect((await clients.c1.from("messages").select("id").eq("help_request_id", realtimeCase)).data).toEqual([]);
      expect((await clients.u2.from("messages").select("id").eq("help_request_id", realtimeCase)).data).toEqual([]);
      expect((await clients.c1.rpc("send_message", { case_id: realtimeCase, message_body: "denied", message_nonce: crypto.randomUUID() })).error?.message).toContain("access denied");
      expect((await clients.u2.rpc("send_message", { case_id: realtimeCase, message_body: "outsider denied", message_nonce: crypto.randomUUID() })).error?.message).toContain("access denied");

      await clients.c1.removeChannel(channels.c1);
      const reconnectSeen: string[] = [];
      reconnect = clients.c1.channel(`reassignment-reconnect-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `help_request_id=eq.${realtimeCase}` }, payload => {
          const body = (payload.new as {body?: unknown}).body;
          if (typeof body === "string") reconnectSeen.push(body);
        });
      await waitSubscribed(reconnect);
      const afterReconnect = `reassignment-reconnect-after-${crypto.randomUUID()}`;
      const reconnectControl = await clients.u1.rpc("send_message", { case_id: realtimeCase, message_body: afterReconnect, message_nonce: crypto.randomUUID() });
      expect(reconnectControl.error).toBeNull();
      await expect.poll(() => seen.u1.includes(afterReconnect), { timeout: 10_000 }).toBe(true);
      expect(reconnectSeen).toEqual([]);
      expect((await clients.c1.from("messages").select("id").eq("help_request_id", realtimeCase)).data).toEqual([]);
    } finally {
      await Promise.all(Object.values(channels).map(channel => channel.unsubscribe()));
      if (reconnect) await reconnect.unsubscribe();
    }
  }, 45_000);

  test("open Realtime subscription loses access after staff-role revocation and reconnect", async () => {
    const roleCase = await createAssignedCase("u1", "c2", "role revocation");
    const seen = { u1: [] as string[], c2: [] as string[], u2: [] as string[] };
    const channels = Object.fromEntries(Object.keys(seen).map(name => [name, clients[name]
      .channel(`role-${name}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
        const body = (payload.new as {body?: unknown}).body;
        if (typeof body === "string") seen[name as keyof typeof seen].push(body);
      })])) as Record<string, RealtimeChannel>;
    let reconnect: RealtimeChannel | undefined;
    try {
      await Promise.all(Object.values(channels).map(waitSubscribed));
      const retryNonce = crypto.randomUUID();
      const before = `role-before-${crypto.randomUUID()}`;
      const accepted = await clients.c2.rpc("send_message", { case_id: roleCase, message_body: before, message_nonce: retryNonce });
      if (accepted.error) diagnostic("role control send failed", accepted.error);
      expect(accepted.error).toBeNull(); expect(accepted.data?.id).toBeTruthy();
      expect((await clients.u1.from("messages").select("id").eq("id", accepted.data.id)).data).toHaveLength(1);
      expect((await clients.c2.from("messages").select("id").eq("id", accepted.data.id)).data).toHaveLength(1);
      await expect.poll(() => ({ owner: seen.u1.includes(before), coordinator: seen.c2.includes(before) }), { timeout: 10_000 })
        .toEqual({ owner: true, coordinator: true });
      expect(seen.u2).not.toContain(before);

      const revoked = await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: false, reason_text: "role revocation access test" });
      if (revoked.error) diagnostic("staff-role revocation failed", revoked.error);
      expect(revoked.error).toBeNull();
      const after = `role-after-${crypto.randomUUID()}`;
      const allowed = await clients.u1.rpc("send_message", { case_id: roleCase, message_body: after, message_nonce: crypto.randomUUID() });
      expect(allowed.error).toBeNull(); expect(allowed.data?.id).toBeTruthy();
      await expect.poll(() => seen.u1.includes(after), { timeout: 10_000 }).toBe(true);
      expect(seen.c2).not.toContain(after); expect(seen.u2).not.toContain(after);
      expect((await clients.c2.from("messages").select("id").eq("help_request_id", roleCase)).data).toEqual([]);
      expect((await clients.u2.from("messages").select("id").eq("help_request_id", roleCase)).data).toEqual([]);
      expect((await clients.c2.rpc("send_message", { case_id: roleCase, message_body: before, message_nonce: retryNonce })).error?.message).toContain("access denied");
      expect((await clients.u2.rpc("send_message", { case_id: roleCase, message_body: "outsider denied", message_nonce: crypto.randomUUID() })).error?.message).toContain("access denied");

      await clients.c2.removeChannel(channels.c2);
      const reconnectSeen: string[] = [];
      reconnect = clients.c2.channel(`role-reconnect-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `help_request_id=eq.${roleCase}` }, payload => {
          const body = (payload.new as {body?: unknown}).body;
          if (typeof body === "string") reconnectSeen.push(body);
        });
      await waitSubscribed(reconnect);
      const afterReconnect = `role-reconnect-after-${crypto.randomUUID()}`;
      expect((await clients.u1.rpc("send_message", { case_id: roleCase, message_body: afterReconnect, message_nonce: crypto.randomUUID() })).error).toBeNull();
      await expect.poll(() => seen.u1.includes(afterReconnect), { timeout: 10_000 }).toBe(true);
      expect(reconnectSeen).toEqual([]);
      expect((await clients.c2.from("messages").select("id").eq("help_request_id", roleCase)).data).toEqual([]);
    } finally {
      await Promise.all(Object.values(channels).map(channel => channel.unsubscribe()));
      if (reconnect) await reconnect.unsubscribe();
      const restored = await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: true, reason_text: "restore after role test" });
      expect(restored.error).toBeNull();
    }
  }, 45_000);

  test("invalid status transition and concurrent assignments cannot violate invariants", async () => {
    expect((await clients.u1.rpc("change_case_status", { case_id: case1, new_status: "RESOLVED" })).error).not.toBeNull();
    await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: true, reason_text: "restore for concurrency" });
    await Promise.allSettled([
      clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c1, reason_text: "concurrent one" }),
      clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c2, reason_text: "concurrent two" }),
    ]);
    const svc = createClient(url, serviceKey);
    const active = await svc.from("case_assignments").select("id").eq("help_request_id", case1).is("revoked_at", null);
    expect(active.data).toHaveLength(1);
  });

  test("concurrent sends serialize the per-author quota while retry remains free", async () => {
    const made = await clients.u3.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "A quota-only sufficiently long fictional request", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(made.error).toBeNull(); case3 = made.data as string;
    let acceptedNonce = "";
    let acceptedId = "";
    for (let i = 0; i < 19; i++) {
      const nonce = crypto.randomUUID();
      const sent = await clients.u3.rpc("send_message", { case_id: case3, message_body: `quota message ${i}`, message_nonce: nonce });
      expect(sent.error).toBeNull();
      if (i === 0) { acceptedNonce = nonce; acceptedId = sent.data.id; }
    }
    const contenders = await Promise.all(["parallel A", "parallel B"].map(message_body =>
      clients.u3.rpc("send_message", { case_id: case3, message_body, message_nonce: crypto.randomUUID() })));
    expect(contenders.filter(result => result.error === null)).toHaveLength(1);
    expect(contenders.find(result => result.error)?.error?.message).toContain("rate limit");
    const svc = createClient(url, serviceKey);
    const count = await svc.from("messages").select("id", { count: "exact", head: true }).eq("author_id", ids.u3);
    expect(count.error).toBeNull(); expect(count.count).toBe(20);
    const retry = await clients.u3.rpc("send_message", { case_id: case3, message_body: " quota message 0 ", message_nonce: acceptedNonce });
    expect(retry.error).toBeNull(); expect(retry.data.id).toBe(acceptedId);
  });
});
