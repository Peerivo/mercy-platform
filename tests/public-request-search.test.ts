import {
  describe,
  expect,
  it,
} from "vitest";

import {
  publicRequestSearchSchema,
} from "../lib/validation";

describe(
  "public request search validation",
  () => {
    it("uses active requests by default", () => {
      const result =
        publicRequestSearchSchema.parse(
          {}
        );

      expect(result.state).toBe(
        "ACTIVE"
      );

      expect(result.page).toBe(1);
    });

    it("accepts valid filters", () => {
      const result =
        publicRequestSearchSchema.safeParse(
          {
            category: "FOOD_GOODS",
            city: "Батуми",
            urgency: "URGENT",
            state: "ACTIVE",
            page: "2",
          }
        );

      expect(result.success).toBe(
        true
      );
    });

    it("rejects invalid category", () => {
      const result =
        publicRequestSearchSchema.safeParse(
          {
            category:
              "INVALID_CATEGORY",
          }
        );

      expect(result.success).toBe(
        false
      );
    });

    it("rejects invalid state", () => {
      const result =
        publicRequestSearchSchema.safeParse(
          {
            state: "DELETED",
          }
        );

      expect(result.success).toBe(
        false
      );
    });

    it("rejects oversized city", () => {
      const result =
        publicRequestSearchSchema.safeParse(
          {
            city: "x".repeat(121),
          }
        );

      expect(result.success).toBe(
        false
      );
    });
  }
);