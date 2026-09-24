import { expect, test } from "@playwright/test";

test("health endpoints separate liveness from bounded data readiness", async ({ request }) => {
  const live = await request.get("/health");
  expect(live.ok()).toBe(true);
  expect(await live.json()).toMatchObject({ status: "ok" });

  const data = await request.get("/health/data");
  expect(data.status()).toBe(200);
  expect(await data.json()).toEqual({ status: "ok" });
  expect(data.headers()["cache-control"]).toContain("no-store");
});
