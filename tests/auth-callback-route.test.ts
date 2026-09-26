import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../app/auth/callback/route";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("Auth callback canonical redirects", () => {
  it("never trusts an internal reverse-proxy request origin for callback errors", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://mercy.peerivo.net";

    const response = await GET(
      new Request(
        "https://0.0.0.0:3000/auth/callback?next=https://example.com/private",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://mercy.peerivo.net/auth?error=callback",
    );
  });
});
