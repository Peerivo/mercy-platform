import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveAnalyticsManifest } from "@/lib/analytics-config";
import { siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

// File under runtime host configuration; changing counter IDs does not rebuild the site.
// Missing/invalid config is explicit HTTP 503 and never triggers third-party scripts.
export async function GET() {
  try {
    const path = process.env.PEERIVO_ANALYTICS_REGISTRY_PATH;
    if (!path || !path.startsWith("/") || path.includes("..")) throw new Error("not_configured");
    const input = await readFile(path, "utf8");
    if (input.length > 20000) throw new Error("oversized");
    const manifest = resolveAnalyticsManifest(JSON.parse(input), siteUrl());
    if (!manifest) throw new Error("invalid_site_mapping");
    return NextResponse.json(manifest, {headers});
  } catch {
    return NextResponse.json({status:"unconfigured"}, {status:503,headers});
  }
}
