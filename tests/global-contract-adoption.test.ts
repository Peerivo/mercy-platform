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
  it("pins Mercy to the latest published canonical 1.12.0 contract with automatic propagation", () => {
    expect(binding.project.repository).toBe("Peerivo/mercy-platform");
    expect(binding.globalRef).toEqual({
      repository: "Peerivo/global",
      id: "peerivo-global",
      version: "1.12.0",
      digest:
        "sha256:9ff754408729013041a0e442ed30002a644df14bc1b390ebcb64ab86c3f0426b",
      gitSha: "d622f79f776e6e8f870a55e6afc1830d859d64f8",
    });
    expect(binding.updatePolicy).toEqual({
      observeAllUpdates: true,
      canonicalMergeAppliesAutomatically: true,
      perConsumerAcknowledgementRequired: false,
      compatibleAdditive: "auto_apply_after_canonical_merge",
      permissionOrSafetyChanging: "auto_apply_after_canonical_merge",
      breaking:
        "apply_policy_after_global_approval_migrate_before_incompatible_effects",
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

  it("retains 1.8.0 public-web migration as unresolved historical evidence", () => {
    expect(adoption18.changeEventId).toBe(
      "contract.updated.peerivo-global.1.8.0",
    );
    expect(adoption18.newContract.version).toBe("1.8.0");
    expect(adoption18.newContract.digest).toBe(
      "sha256:0bea3d062a1105b16baf0512f5a16daccbabdf7881435f6948feb8bd1819cfed",
    );
    expect(adoption18.newContract.gitSha).toBe(
      "223d57cd47ef176272cd9ebfd12ee7c52f887756",
    );
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
