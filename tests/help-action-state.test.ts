import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), server: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverSupabase: mocks.server }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { createRequest } from "../app/help/actions";

function validForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ category: "FAMILY", country: "საქართველო", city: "თბილისი", description: "ეს არის სატესტო დახმარების თხოვნის აღწერა", urgency: "NORMAL", can_message: "on", consent: "on", external_contact: "private example" })) form.set(key, value);
  return form;
}

describe("help action preserves retry without exposing submitted data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.server.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-owner" } } });
    mocks.rpc.mockResolvedValue({ data: "case-id", error: null });
    mocks.redirect.mockImplementation((href: string) => { throw new Error(`REDIRECT:${href}`); });
  });
  it("returns field errors without redirect or RPC for invalid data", async () => {
    const form = validForm(); form.set("description", "short"); form.delete("consent");
    const state = await createRequest({}, form);
    expect(state.error).toBe("validation");
    expect(state.fieldErrors).toHaveProperty("description");
    expect(state.fieldErrors).toHaveProperty("consent");
    expect(JSON.stringify(state)).not.toContain("private example");
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("returns an expired-session state without writing a request", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await createRequest({}, validForm())).toEqual({ error: "auth" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("returns save failure without redirect or reflecting private fields", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database details" } });
    expect(await createRequest({}, validForm())).toEqual({ error: "save" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("passes unchanged Georgian consent version to the existing user-JWT RPC", async () => {
    const form = validForm(); form.set("owner_id", "forged");
    await expect(createRequest({}, form)).rejects.toThrow("REDIRECT:/cabinet/requests/case-id");
    expect(mocks.rpc).toHaveBeenCalledWith("create_help_request", {
      payload: { category: "FAMILY", country: "საქართველო", city: "თბილისი", description: "ეს არის სატესტო დახმარების თხოვნის აღწერა", urgency: "NORMAL", can_message: true, can_call: false, contact_window: "", external_contact: "private example" }, consent_version: "request-ge-v2",
    });
  });
});
