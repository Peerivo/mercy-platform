import type { RealtimeChannel, RealtimeSystemPayload } from "@supabase/supabase-js";

type ChannelStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

export type PostgresReadySubscription = {
  ready: Promise<void>;
  failure: Promise<never>;
  unsubscribe: () => Promise<unknown>;
};

function detail(value: unknown) {
  if (value instanceof Error) return value.message;
  return typeof value === "string" && value ? value : "no SDK error detail";
}

/**
 * A Phoenix channel join is not enough to prove that its PostgreSQL change
 * subscription is installed. Realtime 2.43 reports that separately via a
 * channel-scoped `system` message, so require both acknowledgements in either
 * order before declaring the subscription ready.
 */
export function subscribeWhenPostgresReady(
  channel: RealtimeChannel,
  { timeoutMs = 15_000, onReady }: { timeoutMs?: number; onReady?: () => void | Promise<void> } = {},
): PostgresReadySubscription {
  let joined = false;
  let postgresReady = false;
  let settled = false;
  let expectedClose = false;
  let rejectFailure!: (reason: Error) => void;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  // Callers observe this promise only while the channel is expected to remain open.
  void failure.catch(() => undefined);
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const fail = (message: string) => {
    const error = new Error(`Realtime PostgreSQL subscription failed: ${message}`);
    if (!settled) { settled = true; clearTimeout(timer); rejectReady(error); }
    rejectFailure(error);
  };
  const maybeReady = () => {
    if (!joined || !postgresReady) return;
    if (!settled) { settled = true; clearTimeout(timer); resolveReady(); }
    // Consume both acknowledgements so a reconnect needs a fresh pair and a
    // duplicate callback cannot trigger an unnecessary catch-up.
    joined = false;
    postgresReady = false;
    void onReady?.();
  };
  const timer = setTimeout(() => fail("readiness timed out"), timeoutMs);
  const expectedChannel = channel.topic.replace(/^realtime:/, "");

  channel.on("system", {}, (payload: RealtimeSystemPayload) => {
    if (payload.extension !== "postgres_changes" || payload.channel !== expectedChannel) return;
    if (payload.status !== "ok") {
      fail(`postgres_changes system status ${payload.status}: ${payload.message || "no server detail"}`);
      return;
    }
    postgresReady = true;
    maybeReady();
  });
  channel.subscribe((status: ChannelStatus, error?: Error) => {
    if (status === "SUBSCRIBED") { joined = true; maybeReady(); return; }
    joined = false;
    postgresReady = false;
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") fail(`${status}: ${detail(error)}`);
    if (status === "CLOSED" && !expectedClose) fail("channel closed unexpectedly");
  });

  return {
    ready,
    failure,
    unsubscribe: async () => {
      expectedClose = true;
      clearTimeout(timer);
      // RealtimeChannel has no public per-binding `off`; unsubscribe removes the
      // channel and all handlers together.
      return channel.unsubscribe();
    },
  };
}
