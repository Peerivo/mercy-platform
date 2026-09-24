import { NextResponse } from "next/server";

import { publicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const readinessTimeoutMs = 5_000;

export async function GET() {
  try {
    const { url, key } = publicConfig();
    const endpoint = new URL("/rest/v1/rpc/list_public_help_requests", `${url.replace(/\/$/, "")}/`);

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
      signal: AbortSignal.timeout(readinessTimeoutMs),
    });

    // Consume the bounded one-row response so a stalled body cannot be mistaken
    // for readiness. The content is intentionally discarded and never exposed.
    await response.arrayBuffer();

    if (!response.ok) {
      return NextResponse.json(
        { status: "degraded" },
        { status: 503, headers: noStore },
      );
    }

    return NextResponse.json({ status: "ok" }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { status: "degraded" },
      { status: 503, headers: noStore },
    );
  }
}
