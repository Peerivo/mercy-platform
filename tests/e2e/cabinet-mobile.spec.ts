import { expect, test, type Page } from "@playwright/test";

async function getLatestMagicLink(email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  let link = "";

  await expect
    .poll(async () => {
      const response = await fetch(
        `http://127.0.0.1:54324/view/latest.html?query=${query}`
      );
      if (!response.ok) return "";
      const html = (await response.text()).replace(/&amp;/g, "&");
      const match = html.match(
        /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s<>"']+/
      );
      link = match?.[0] ?? "";
      return link;
    }, { timeout: 15_000 })
    .not.toBe("");

  return link;
}

async function register(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить ссылку для входа" }).click();
  await expect(page).toHaveURL(/\/auth\?sent=1/);
  const magicLink = await getLatestMagicLink(email);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/cabinet$/);
}

test("cabinet keeps a compact vertical rhythm on mobile", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await register(page, `cabinet-mobile-${suffix}@mercy.invalid`);

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cabinet");

    const cabinet = page.locator(".cabinet-page");
    await expect(cabinet).toBeVisible();
    await expect(cabinet).toHaveCSS("row-gap", "14px");
    await expect(page.locator(".cabinet-section").first()).toHaveCSS(
      "padding-top",
      "13px"
    );
    await expect(page.getByRole("link", { name: "Написать о поддержке" })).toBeVisible();
    expect(
      await page
        .locator("body")
        .evaluate((element) => element.scrollWidth <= window.innerWidth)
    ).toBe(true);
  }
});
