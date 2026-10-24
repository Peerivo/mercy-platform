import { describe, expect, it } from "vitest";
import {resolveAnalyticsManifest} from "../lib/analytics-config";

const origin = "https://mercy.peerivo.net";
const registry = {sites: [
  {siteId:"mercy",origin,manager:{type:"ytm",counterId:"12345678"}},
  {siteId:"food",origin:"https://food.peerivo.net",manager:{type:"ytm",counterId:"98765432"}},
]};
describe("per-domain analytics counter isolation", () => {
  it("resolves exact domain and exposes no foreign counter or provider IDs", () => {
    const result=resolveAnalyticsManifest(registry,origin);
    expect(result?.manager).toEqual({type:"ytm",counterId:"12345678"});
    expect(JSON.stringify(result)).not.toContain("98765432");
    expect(result?.consent.analyticsStorageDefault).toBe("denied");
    expect(result?.availability.analyticsFailureMayBreakPage).toBe(false);
    expect(result?.secretsAllowed).toBe(false);
  });
  it("fails closed for unknown domains, non-https, numeric coercion and missing id", () => {
    expect(resolveAnalyticsManifest(registry,"https://unknown.peerivo.net")).toBeNull();
    expect(resolveAnalyticsManifest(registry,"http://mercy.peerivo.net")).toBeNull();
    expect(resolveAnalyticsManifest({sites:[{...registry.sites[0],manager:{type:"ytm",counterId:12345678}}]},origin)).toBeNull();
    expect(resolveAnalyticsManifest({sites:[{...registry.sites[0],manager:{type:"ytm"}}]},origin)).toBeNull();
    expect(resolveAnalyticsManifest({sites:[{...registry.sites[0],manager:{type:"ytm",counterId:"0001"}}]},origin)).toBeNull();
  });
  it("fails closed for duplicate domain and extraneous browser-visible fields",()=>{
    expect(resolveAnalyticsManifest({sites:[registry.sites[0],registry.sites[0]]},origin)).toBeNull();
    expect(resolveAnalyticsManifest({sites:[{...registry.sites[0],apiToken:"secret"}]},origin)).toBeNull();
  });
  it("supports GTM but not both YTM and GTM on one site",()=>{
    const g={sites:[{siteId:"mercy",origin,manager:{type:"gtm",containerId:"GTM-ABC123"}}]};
    expect(resolveAnalyticsManifest(g,origin)?.manager).toEqual({type:"gtm",containerId:"GTM-ABC123"});
    expect(resolveAnalyticsManifest({sites:[{...g.sites[0],manager:{...g.sites[0].manager,counterId:"123"}}]},origin)).toBeNull();
  });
});
