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

async function waitSubscribed(channel: RealtimeChannel) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timeout")), 15_000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error(status)); }
    });
  });
}

async function signIn(name: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: `${name}@mercy.invalid`, password });
  expect(error).toBeNull(); clients[name] = client;
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
      { organization_id: orgs![0].id, name: "Тестовая ближняя точка", categories: ["FOOD"], country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, location: "POINT(30 60)" },
      { organization_id: orgs![0].id, name: "Тестовая дальняя точка", categories: ["FOOD"], country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, location: "POINT(30.1 60)" },
      { organization_id: orgs![1].id, name: "Тестовая скрытая точка", country: "XX", city: "Test", cost_type: "FREE", review_status: "PENDING", location: "POINT(30 60)" },
      { organization_id: orgs![0].id, name: "Тестовое убежище", country: "XX", city: "Test", cost_type: "FREE", review_status: "VERIFIED", verified_at: now, published_at: now, is_confidential_address: true },
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
    const seen = { u1: [] as string[], c1: [] as string[], c2: [] as string[], u2: [] as string[] };
    const channels = Object.fromEntries(Object.keys(seen).map(name => [name, clients[name].channel(`access-${name}-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => seen[name as keyof typeof seen].push((p.new as {body:string}).body))])) as Record<string, RealtimeChannel>;
    await Promise.all(Object.values(channels).map(waitSubscribed));
    const control1 = `before-${crypto.randomUUID()}`;
    await clients.u1.rpc("send_message", { case_id: case1, message_body: control1, message_nonce: crypto.randomUUID() });
    await expect.poll(() => seen.u1.includes(control1) && seen.c1.includes(control1), { timeout: 10_000 }).toBe(true);
    expect(seen.u2).not.toContain(control1);
    await clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c2, reason_text: "reassignment test" });
    const control2 = `after-${crypto.randomUUID()}`;
    await clients.u1.rpc("send_message", { case_id: case1, message_body: control2, message_nonce: crypto.randomUUID() });
    await expect.poll(() => seen.u1.includes(control2) && seen.c2.includes(control2), { timeout: 10_000 }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(seen.c1).not.toContain(control2); expect(seen.u2).not.toContain(control2);
    expect((await clients.c1.from("messages").select("id").eq("help_request_id", case1)).data).toEqual([]);
    expect((await clients.c1.rpc("send_message", { case_id: case1, message_body: "denied", message_nonce: crypto.randomUUID() })).error).not.toBeNull();
    await clients.c1.removeChannel(channels.c1);
    const reconnectSeen: string[] = [];
    const reconnect = clients.c1.channel(`revoked-reconnect-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `help_request_id=eq.${case1}` }, p => reconnectSeen.push((p.new as {body:string}).body));
    await waitSubscribed(reconnect);
    const control3 = `reconnect-${crypto.randomUUID()}`;
    await clients.u1.rpc("send_message", { case_id: case1, message_body: control3, message_nonce: crypto.randomUUID() });
    await expect.poll(() => seen.u1.includes(control3), { timeout: 10_000 }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1000)); expect(reconnectSeen).toEqual([]);
  }, 45_000);

  test("open Realtime subscription loses access after staff-role revocation and reconnect", async () => {
    const seen = { u1: [] as string[], c2: [] as string[] };
    const channels = {
      u1: clients.u1.channel(`role-owner-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => seen.u1.push((p.new as {body:string}).body)),
      c2: clients.c2.channel(`role-staff-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => seen.c2.push((p.new as {body:string}).body)),
    };
    let reconnect: RealtimeChannel | undefined;
    try {
      await Promise.all(Object.values(channels).map(waitSubscribed));
      const retryNonce = crypto.randomUUID();
      const before = `role-before-${crypto.randomUUID()}`;
      const accepted = await clients.c2.rpc("send_message", { case_id: case1, message_body: before, message_nonce: retryNonce });
      expect(accepted.error).toBeNull();
      await expect.poll(() => seen.u1.includes(before) && seen.c2.includes(before), { timeout: 10_000 }).toBe(true);
      expect((await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: false, reason_text: "revoke test" })).error).toBeNull();
      const after = `role-after-${crypto.randomUUID()}`;
      expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: after, message_nonce: crypto.randomUUID() })).error).toBeNull();
      await expect.poll(() => seen.u1.includes(after), { timeout: 10_000 }).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(seen.c2).not.toContain(after);
      expect((await clients.c2.from("messages").select("id").eq("help_request_id", case1)).data).toEqual([]);
      expect((await clients.c2.rpc("send_message", { case_id: case1, message_body: before, message_nonce: retryNonce })).error?.message).toContain("access denied");
      await clients.c2.removeChannel(channels.c2);
      const reconnectSeen: string[] = [];
      reconnect = clients.c2.channel(`role-reconnect-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => reconnectSeen.push((p.new as {body:string}).body));
      await waitSubscribed(reconnect);
      const afterReconnect = `role-reconnect-after-${crypto.randomUUID()}`;
      expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: afterReconnect, message_nonce: crypto.randomUUID() })).error).toBeNull();
      await expect.poll(() => seen.u1.includes(afterReconnect), { timeout: 10_000 }).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(reconnectSeen).toEqual([]);
      expect((await clients.c2.from("messages").select("id").eq("help_request_id", case1)).data).toEqual([]);
    } finally {
      await Promise.all([clients.u1.removeChannel(channels.u1), clients.c2.removeChannel(channels.c2), reconnect ? clients.c2.removeChannel(reconnect) : Promise.resolve()]);
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
