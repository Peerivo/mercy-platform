import { expect, test } from "@playwright/test";

const staffRoutes = [
  "/staff/cases",
  "/staff/roles",
  "/staff/volunteers",
  "/staff/volunteer-offers",
  "/staff/reports",
];

async function localMagicLink(email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  let link = "";
  await expect.poll(async () => {
    const response = await fetch(
      `http://127.0.0.1:54324/view/latest.html?query=${query}`
    );
    if (!response.ok) return "";
    const html = (await response.text()).replace(/&amp;/g, "&");
    link = html.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s<>"']+/)?.[0] ?? "";
    return link;
  }, { timeout: 15_000 }).not.toBe("");
  return link;
}

test("anonymous visitors cannot access the Mercy cabinet or any staff workspace", async ({ page }) => {
  for (const route of ["/cabinet", ...staffRoutes]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Роли и доступ" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Волонтёрская служба" })).toHaveCount(0);
  }
});

test("email-authenticated ordinary user cannot access any staff workspace", async ({ page }) => {
  test.setTimeout(75_000);
  test.skip(
    process.env.MERCY_DISPOSABLE_SUPABASE !== "true" ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321",
    "Never create test accounts outside the disposable local Supabase stack"
  );

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `v1-unprivileged-${suffix}@mercy.invalid`;

  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить ссылку для входа" }).click();
  await expect(page).toHaveURL(/\/auth\?sent=1/);

  await page.goto(await localMagicLink(email));
  await expect(page).toHaveURL(/\/cabinet$/);

  for (const route of staffRoutes) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/cabinet$/);
    await expect(page.getByRole("heading", { name: "Роли и доступ" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Волонтёрская служба" })).toHaveCount(0);
  }
});
