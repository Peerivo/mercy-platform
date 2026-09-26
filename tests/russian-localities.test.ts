import { describe, expect, it } from "vitest";

import {
  findKnownRussianLocality,
  RUSSIAN_LOCALITIES,
} from "../lib/russian-localities";
import { RUSSIAN_URBAN_SETTLEMENTS } from "../lib/russian-urban-settlements";
import { verifyRussianLocality } from "../lib/russian-locality-provider";

describe("Russian locality directory", () => {
  it("extends the city catalogue with more than a thousand urban settlements", () => {
    expect(RUSSIAN_URBAN_SETTLEMENTS.length).toBeGreaterThan(1200);
    expect(RUSSIAN_LOCALITIES.length).toBeGreaterThan(2200);
  });

  it("contains Psebay as a Krasnodar Krai settlement", () => {
    const psebay = findKnownRussianLocality("Псебай");
    expect(psebay).toMatchObject({
      name: "Псебай",
      region: "Краснодарский край",
      kind: "посёлок",
      population: 10666,
    });
  });

  it("accepts a known locality without a network dependency", async () => {
    await expect(verifyRussianLocality("Псебай")).resolves.toMatchObject({
      verified: true,
      providerAvailable: true,
      source: "catalog",
      canonicalName: "Псебай",
      region: "Краснодарский край",
    });
  });
});
