import { describe, expect, it } from "vitest";

import { RUSSIAN_CITIES } from "../lib/russian-cities";

describe("Russian city directory", () => {
  it("contains the complete source-sized city catalogue", () => {
    expect(RUSSIAN_CITIES).toHaveLength(1117);
  });

  it.each(["Москва", "Санкт-Петербург", "Владивосток", "Калининград"])(
    "contains %s",
    (city) => {
      expect(RUSSIAN_CITIES.some((entry) => entry.name === city)).toBe(true);
    }
  );

  it("keeps region labels for disambiguation", () => {
    expect(
      RUSSIAN_CITIES.every(
        (entry) => entry.name.trim().length > 0 && entry.region.trim().length > 0
      )
    ).toBe(true);
  });
});
