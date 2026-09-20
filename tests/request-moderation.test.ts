import { describe, expect, test } from "vitest";
import {
  createRequestModerationToken,
  hashRequestModerationToken,
} from "../lib/request-moderation";

describe("request moderation capability tokens", () => {
  test("generates opaque unique tokens and stores only deterministic hashes", () => {
    const first = createRequestModerationToken();
    const second = createRequestModerationToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashRequestModerationToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRequestModerationToken(first)).toBe(
      hashRequestModerationToken(first)
    );
  });
});
