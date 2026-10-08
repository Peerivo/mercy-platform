import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const localUrl = "http://127.0.0.1:54321";

async function receiveLocalMagicLink(email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  let link = "";
  await expect.poll(async () => {
    const response = await fetch(`http://127.0.0.1:54324/view/latest.html?query=${query}`);
    if (!response.ok) return "";
    const html = (await response.text()).replace(/&amp;/g, "&");
    link = html.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s<>"']+/)?.[0] ?? "";
    return link;
  }, { timeout: 15_000 }).not.toBe("");
  return link;
}

test("email-based admin roles and volunteer directory fit mobile/tablet/desktop", async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
  if (process.env.MERCY_DISPOSABLE_SUPABASE !== "true" ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== localUrl || !key) {
    test.skip(true, "only disposable loopback Supabase may provision test users");
    return;
  }
  const service = createClient(localUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `v1-staff-ui-${suffix}@mercy.invalid`;
  const created = await service.auth.admin.createUser({
    email, email_confirm: true, password: "Local-only-password-42!",
  });
  expect(created.error).toBeNull();
  const userId = created.data.user?.id;
  expect(userId).toBeTruthy();
  const grant = await service.from("staff_roles").insert({
    user_id: userId, role: "ADMIN", granted_by: userId,
  });
  expect(grant.error).toBeNull();

  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить ссылку для входа" }).click();
  await expect(page).toHaveURL(/\/auth\?sent=1/);
  const magicLink = await receiveLocalMagicLink(email);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/cabinet$/);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/staff/roles");
    await expect(page.getByRole("heading", { name: "Роли и доступ" })).toBeVisible();
    await expect(page.locator("body").evaluate(e => e.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Email пользователя")).toBeVisible();

    await page.goto("/staff/volunteers");
    await expect(page.getByRole("heading", { name: "Волонтёрская служба" })).toBeVisible();
    await expect(page.getByLabel("Город")).toBeVisible();
    await expect(page.locator("body").evaluate(e => e.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto("/staff/volunteer-offers");
  await expect(page.getByRole("heading", { name: "Модерация предложений помощи" })).toBeVisible();
});
