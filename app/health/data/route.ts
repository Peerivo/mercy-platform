import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const s = await serverSupabase();
    const { error } = await s.rpc("list_public_help_requests", {
      category_filter: null,
      city_filter: null,
      urgency_filter: null,
      state_filter: "ACTIVE",
      result_limit: 1,
      result_offset: 0,
    });

    if (error) {
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
