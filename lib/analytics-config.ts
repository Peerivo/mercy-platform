import { z } from "zod";

const ytm = z.object({ type: z.literal("ytm"), counterId: z.string().regex(/^[1-9][0-9]{0,11}$/) }).strict();
const gtm = z.object({ type: z.literal("gtm"), containerId: z.string().regex(/^GTM-[A-Z0-9]+$/) }).strict();
const manager = z.discriminatedUnion("type", [ytm, gtm]);
const entry = z.object({
  siteId: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  origin: z.string().url().refine(value => value.startsWith("https://")),
  manager,
}).strict();
const registrySchema = z.object({sites: z.array(entry).min(1).max(100)}).strict();

export type AnalyticsManifest = {
  apiVersion: "peerivo.io/web-observability/v2";
  kind: "SiteObservabilityManifest";
  schemaVersion: 2;
  site: {siteId: string;environment: "production"|"preview"|"staging"|"development"|"test";origin:string};
  manager: z.infer<typeof manager>;
  consent: {jurisdictionAware:true;analyticsStorageDefault:"denied";advertisingStorageDefault:"denied";elevatedCollectionDefault:"disabled"};
  availability: {analyticsFailureMayBreakPage:false};
  secretsAllowed: false;
};

/** No wildcard or fallback counter: duplicate domain, unknown domain, non-HTTPS, extra data fail closed. */
export function resolveAnalyticsManifest(
  raw: unknown, origin: string,
  environment: AnalyticsManifest["site"]["environment"] = "production",
): AnalyticsManifest | null {
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success || !origin.startsWith("https://")) return null;
  const site = parsed.data.sites.filter(item => item.origin === origin);
  if (site.length !== 1) return null;
  return {
    apiVersion: "peerivo.io/web-observability/v2",
    kind: "SiteObservabilityManifest",
    schemaVersion: 2,
    site: {siteId:site[0].siteId,environment,origin:site[0].origin},
    manager: site[0].manager,
    consent: {jurisdictionAware:true,analyticsStorageDefault:"denied",advertisingStorageDefault:"denied",elevatedCollectionDefault:"disabled"},
    availability: {analyticsFailureMayBreakPage:false},
    secretsAllowed:false,
  };
}
