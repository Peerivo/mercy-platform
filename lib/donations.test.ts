import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_URL,
  getDonationProvider,
  normalizeCloudTipsDonationUrl,
} from "./donations";

describe("normalizeCloudTipsDonationUrl", () => {
  it("accepts secure CloudTips links", () => {
    expect(
      normalizeCloudTipsDonationUrl("https://pay.cloudtips.ru/p/example"),
    ).toBe("https://pay.cloudtips.ru/p/example");
  });

  it("fails closed for non-CloudTips hosts", () => {
    expect(normalizeCloudTipsDonationUrl("https://example.com/donate")).toBeNull();
  });

  it("fails closed for insecure links", () => {
    expect(normalizeCloudTipsDonationUrl("http://cloudtips.ru/p/example")).toBeNull();
  });

  it("uses the verified public Mercy CloudTips page by default", () => {
    const previous = process.env.NEXT_PUBLIC_DONATION_URL;
    delete process.env.NEXT_PUBLIC_DONATION_URL;

    expect(getDonationProvider().href).toBe(DEFAULT_DONATION_URL);
    expect(getDonationProvider().isConfigured).toBe(true);

    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_DONATION_URL;
    } else {
      process.env.NEXT_PUBLIC_DONATION_URL = previous;
    }
  });
});
