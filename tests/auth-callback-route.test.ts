import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  serverSupabase: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
    },
  })),
}));

import { GET } from "../app/auth/callback/route";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  mocks.exchangeCodeForSession.mockReset();
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
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("uses the canonical site after a successful code exchange", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://mercy.peerivo.net";
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        "https://0.0.0.0:3000/auth/callback?code=test-code&next=%2Fcabinet%3Ftab%3Drequests",
      ),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://mercy.peerivo.net/cabinet?tab=requests",
    );
  });

  it("falls back to the canonical cabinet for an external next target", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://mercy.peerivo.net";
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        "https://0.0.0.0:3000/auth/callback?code=test-code&next=https%3A%2F%2Fevil.example",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://mercy.peerivo.net/cabinet",
    );
  });

  it("uses the canonical site when code exchange fails", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://mercy.peerivo.net";
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("invalid code"),
    });

    const response = await GET(
      new Request(
        "https://0.0.0.0:3000/auth/callback?code=bad-code&next=%2Fcabinet",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://mercy.peerivo.net/auth?error=callback",
    );
  });
});
