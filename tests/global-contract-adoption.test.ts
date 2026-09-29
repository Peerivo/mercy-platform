import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readJson = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const binding = readJson(".peerivo/global-contract.json");
const adoption17 = readJson(
  ".peerivo/adoptions/contract.updated.peerivo-global.1.7.0.json",
);
const adoption18 = readJson(
  ".peerivo/adoptions/contract.updated.peerivo-global.1.8.0.json",
);

describe("Peerivo Global Contract adoption", () => {
  it("pins Mercy to the exact canonical 1.10.0 contract", () => {
    expect(binding.project.repository).toBe("Peerivo/mercy-platform");
    expect(binding.globalRef).toEqual({
      repository: "Peerivo/global",
      id: "peerivo-global",
      version: "1.10.0",
      digest:
        "sha256:90b04165dc60a5ce3c2fa5aaeef329515dc85ae6d2d02a29b56d5dbe5cf037f9",
      gitSha: "7ef6771ec51fdd8359d30aad25a12d1deb130835",
    });
    expect(binding.updatePolicy).toEqual({
      observeAllUpdates: true,
      canonicalMergeAppliesAutomatically: true,
      perConsumerAcknowledgementRequired: false,
      compatibleAdditive: "auto_apply_after_canonical_merge",
      permissionOrSafetyChanging: "auto_apply_after_canonical_merge",
      breaking:
        "apply_policy_after_canonical_merge_migrate_before_incompatible_effects",
    });
  });

  it("records the required cumulative 1.7.0 safety migration", () => {
    expect(adoption17.changeEventId).toBe(
      "contract.updated.peerivo-global.1.7.0",
    );
    expect(adoption17.oldContract.version).toBe("1.6.0");
    expect(adoption17.newContract.version).toBe("1.7.0");
    expect(adoption17.migration.requiredByEvent).toBe(true);
    expect(adoption17.migration.runtimeMutationInThisChange).toBe(false);
    expect(adoption17.migration.securityThresholdWeakeningInThisChange).toBe(
      false,
    );
  });

  it("records 1.8.0 public-web migration as unresolved instead of claiming compliance", () => {
    expect(adoption18.changeEventId).toBe(
      "contract.updated.peerivo-global.1.8.0",
    );
    expect(adoption18.newContract).toEqual({
      id: "peerivo-global",
      version: "1.8.0",
      digest:
        "sha256:0bea3d062a1105b16baf0512f5a16daccbabdf7881435f6948feb8bd1819cfed",
      gitSha: "223d57cd47ef176272cd9ebfd12ee7c52f887756",
    });
    expect(adoption18.migration.requiredByEvent).toBe(true);
    expect(adoption18.migration.runtimeMutationInThisChange).toBe(false);
    expect(adoption18.migration.dnsMutationInThisChange).toBe(false);
    expect(adoption18.migration.analyticsProviderMutationInThisChange).toBe(
      false,
    );
    expect(adoption18.migration.productionReleaseBlockedUntilMigrationVerified).toBe(
      true,
    );
    expect(adoption18.migration.record).toContain("unknown_not_verified");
  });
});
