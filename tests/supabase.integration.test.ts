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
let revokedCoordinatorNonce = "";

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
    expect(orgs).toHaveLength(2);
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
  });

  test("U1 creates a request but U2 and an unassigned coordinator cannot read it", async () => {
    const made = await clients.u1.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "A sufficiently long fictional request", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(made.error).toBeNull(); case1 = made.data as string;
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
    const made = await clients.u1.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "A second fictional request for nonce isolation", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(made.error).toBeNull(); case2 = made.data as string;
    const nonce = crypto.randomUUID();
    const first = await clients.u1.rpc("send_message", { case_id: case1, message_body: "idempotent hello", message_nonce: nonce });
    const retry = await clients.u1.rpc("send_message", { case_id: case1, message_body: "idempotent hello", message_nonce: nonce });
    expect(first.error).toBeNull(); expect(retry.error).toBeNull(); expect(retry.data.id).toBe(first.data.id);
    const changedBody = await clients.u1.rpc("send_message", { case_id: case1, message_body: "changed payload", message_nonce: nonce });
    expect(changedBody.data).toBeNull(); expect(changedBody.error?.message).toContain("message nonce conflict");
    const changedCase = await clients.u1.rpc("send_message", { case_id: case2, message_body: "idempotent hello", message_nonce: nonce });
    expect(changedCase.data).toBeNull(); expect(changedCase.error?.message).toContain("message nonce conflict");
    expect((await clients.u1.from("messages").select("id").eq("client_nonce", nonce)).data).toHaveLength(1);
    expect((await clients.u2.rpc("send_message", { case_id: case1, message_body: "steal nonce", message_nonce: nonce })).error).not.toBeNull();
    expect((await clients.u1.from("messages").update({ body: "edited" }).eq("id", first.data.id)).error).not.toBeNull();
    expect((await clients.u1.from("messages").delete().eq("id", first.data.id)).error).not.toBeNull();

    revokedCoordinatorNonce = crypto.randomUUID();
    const coordinatorMessage = await clients.c1.rpc("send_message", { case_id: case1, message_body: "accepted before access loss", message_nonce: revokedCoordinatorNonce });
    expect(coordinatorMessage.error).toBeNull();
  });

  test("open Realtime subscription loses access after reassignment and reconnect", async () => {
    const seen = { u1: [] as string[], c1: [] as string[], c2: [] as string[], u2: [] as string[] };
    const channels = Object.fromEntries(Object.keys(seen).map(name => [name, clients[name].channel(`access-${name}-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => seen[name as keyof typeof seen].push((p.new as {body:string}).body))])) as Record<string, RealtimeChannel>;
    await Promise.all(Object.values(channels).map(waitSubscribed));
    const control1 = `before-${crypto.randomUUID()}`;
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: control1, message_nonce: crypto.randomUUID() })).error).toBeNull();
    await expect.poll(() => seen.u1.includes(control1) && seen.c1.includes(control1), { timeout: 10_000 }).toBe(true);
    expect(seen.u2).not.toContain(control1);
    expect((await clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c2, reason_text: "reassignment test" })).error).toBeNull();
    const revokedRetry = await clients.c1.rpc("send_message", { case_id: case1, message_body: "accepted before access loss", message_nonce: revokedCoordinatorNonce });
    expect(revokedRetry.data).toBeNull(); expect(revokedRetry.error?.message).toContain("access denied");
    const control2 = `after-${crypto.randomUUID()}`;
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: control2, message_nonce: crypto.randomUUID() })).error).toBeNull();
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
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: control3, message_nonce: crypto.randomUUID() })).error).toBeNull();
    await expect.poll(() => seen.u1.includes(control3), { timeout: 10_000 }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1000)); expect(reconnectSeen).toEqual([]);
  }, 45_000);

  test("revoking staff role invalidates an existing assignment", async () => {
    const c2Seen: string[] = [];
    const ownerSeen: string[] = [];
    const c2Channel = clients.c2.channel(`role-revoke-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => c2Seen.push((p.new as {body:string}).body));
    const ownerChannel = clients.u1.channel(`role-revoke-owner-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => ownerSeen.push((p.new as {body:string}).body));
    await Promise.all([waitSubscribed(c2Channel), waitSubscribed(ownerChannel)]);
    const before = `role-before-${crypto.randomUUID()}`;
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: before, message_nonce: crypto.randomUUID() })).error).toBeNull();
    await expect.poll(() => c2Seen.includes(before) && ownerSeen.includes(before), { timeout: 10_000 }).toBe(true);

    expect((await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: false, reason_text: "revoke test" })).error).toBeNull();
    const after = `role-after-${crypto.randomUUID()}`;
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: after, message_nonce: crypto.randomUUID() })).error).toBeNull();
    await expect.poll(() => ownerSeen.includes(after), { timeout: 10_000 }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(c2Seen).not.toContain(after);
    expect((await clients.c2.from("messages").select("id").eq("help_request_id", case1)).data).toEqual([]);
    expect((await clients.c2.rpc("send_message", { case_id: case1, message_body: "denied after role revoke", message_nonce: crypto.randomUUID() })).error).not.toBeNull();

    await clients.c2.removeChannel(c2Channel);
    const reconnectSeen: string[] = [];
    const reconnect = clients.c2.channel(`role-revoke-reconnect-${crypto.randomUUID()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `help_request_id=eq.${case1}` }, p => reconnectSeen.push((p.new as {body:string}).body));
    await waitSubscribed(reconnect);
    const afterReconnect = `role-reconnect-${crypto.randomUUID()}`;
    expect((await clients.u1.rpc("send_message", { case_id: case1, message_body: afterReconnect, message_nonce: crypto.randomUUID() })).error).toBeNull();
    await expect.poll(() => ownerSeen.includes(afterReconnect), { timeout: 10_000 }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(reconnectSeen).toEqual([]);
  });

  test("invalid status transition and concurrent assignments cannot violate invariants", async () => {
    expect((await clients.u1.rpc("change_case_status", { case_id: case1, new_status: "RESOLVED" })).error).not.toBeNull();
    expect((await clients.a1.rpc("set_staff_role", { target_user: ids.c2, target_role: "COORDINATOR", enabled: true, reason_text: "restore for concurrency" })).error).toBeNull();
    const assignments = await Promise.allSettled([
      clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c1, reason_text: "concurrent one" }),
      clients.a1.rpc("assign_case", { case_id: case1, new_coordinator: ids.c2, reason_text: "concurrent two" }),
    ]);
    expect(assignments.some(result => result.status === "fulfilled" && result.value.error === null)).toBe(true);
    const svc = createClient(url, serviceKey);
    const active = await svc.from("case_assignments").select("id").eq("help_request_id", case1).is("revoked_at", null);
    expect(active.error).toBeNull();
    expect(active.data).toHaveLength(1);
  });

  test("concurrent messages atomically enforce the per-author rate limit", async () => {
    const made = await clients.u3.rpc("create_help_request", { payload: { category: "OTHER", country: "XX", city: "Test", description: "An isolated fictional quota request", urgency: "NORMAL" }, consent_version: "request-v1" });
    expect(made.error).toBeNull();
    const quotaCase = made.data as string;
    for (let i = 0; i < 19; i++) {
      const result = await clients.u3.rpc("send_message", { case_id: quotaCase, message_body: `quota setup ${i}`, message_nonce: crypto.randomUUID() });
      expect(result.error).toBeNull();
    }
    const nonces = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrent = await Promise.all(nonces.map((nonce, i) => clients.u3.rpc("send_message", { case_id: quotaCase, message_body: `concurrent quota ${i}`, message_nonce: nonce })));
    const accepted = concurrent.filter(result => result.error === null);
    const rejected = concurrent.filter(result => result.error !== null);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error?.message).toContain("rate limit");
    const svc = createClient(url, serviceKey);
    const since = new Date(Date.now() - 60_000).toISOString();
    const count = await svc.from("messages").select("id", { count: "exact", head: true }).eq("author_id", ids.u3).gte("created_at", since);
    expect(count.error).toBeNull();
    expect(count.count).toBeLessThanOrEqual(20);
    expect(count.count).toBe(20);
    const acceptedIndex = concurrent.findIndex(result => result.error === null);
    const retry = await clients.u3.rpc("send_message", { case_id: quotaCase, message_body: `concurrent quota ${acceptedIndex}`, message_nonce: nonces[acceptedIndex] });
    expect(retry.error).toBeNull(); expect(retry.data.id).toBe(accepted[0].data.id);
  });
});
