import { describe, expect, test, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { subscribeWhenPostgresReady } from "../lib/supabase/realtime-ready";

function fakeChannel() {
  let system: (payload: { extension: string; status: string; message: string; channel: string }) => void = () => undefined;
  let status: (value: "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED", error?: Error) => void = () => undefined;
  const channel = {
    topic: "realtime:case-123",
    on: vi.fn((_type, _filter, callback) => { system = callback; return channel; }),
    subscribe: vi.fn(callback => { status = callback; return channel; }),
    unsubscribe: vi.fn(async () => { status("CLOSED"); return "ok"; }),
  };
  return { channel: channel as unknown as RealtimeChannel, system: (payload: Parameters<typeof system>[0]) => system(payload), status: (value: Parameters<typeof status>[0], error?: Error) => status(value, error) };
}

describe("PostgreSQL Realtime readiness", () => {
  test.each(["join-first", "system-first"])("requires both acknowledgements in %s order", async order => {
    const fake = fakeChannel();
    const onReady = vi.fn();
    const subscription = subscribeWhenPostgresReady(fake.channel, { onReady });
    if (order === "join-first") {
      fake.status("SUBSCRIBED");
      fake.system({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL", channel: "case-123" });
    } else {
      fake.system({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL", channel: "case-123" });
      fake.status("SUBSCRIBED");
    }
    await expect(subscription.ready).resolves.toBeUndefined();
    expect(onReady).toHaveBeenCalledOnce();
    await subscription.unsubscribe();
  });

  test("rejects a PostgreSQL system error with server detail", async () => {
    const fake = fakeChannel();
    const subscription = subscribeWhenPostgresReady(fake.channel);
    fake.status("SUBSCRIBED");
    fake.system({ extension: "postgres_changes", status: "error", message: "replication unavailable", channel: "case-123" });
    await expect(subscription.ready).rejects.toThrow("replication unavailable");
    await subscription.unsubscribe();
  });

  test("runs catch-up again only after a reconnected channel is PostgreSQL-ready", async () => {
    const fake = fakeChannel();
    const onReady = vi.fn();
    const subscription = subscribeWhenPostgresReady(fake.channel, { onReady });
    fake.status("SUBSCRIBED");
    fake.system({ extension: "postgres_changes", status: "ok", message: "ready", channel: "case-123" });
    await subscription.ready;
    fake.status("CHANNEL_ERROR", new Error("temporary disconnect"));
    fake.status("SUBSCRIBED");
    expect(onReady).toHaveBeenCalledOnce();
    fake.system({ extension: "postgres_changes", status: "ok", message: "ready again", channel: "case-123" });
    expect(onReady).toHaveBeenCalledTimes(2);
    await subscription.unsubscribe();
  });
});
