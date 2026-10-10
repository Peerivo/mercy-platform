import { expect, test } from "@playwright/test";

test("Georgian language persists across navigation and reload, with complete public copy", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("button", { name: "ქართული", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("მარტო გამკლავება არ გევალებათ");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");

  for (const route of ["/", "/help", "/requests", "/nearby", "/volunteer", "/donate", "/feedback", "/feedback?sent=1", "/auth", "/auth?sent=1", "/auth?error=callback", "/auth/update-password?error=update", "/consent/request?country=ge", "/consent/request?country=ru", "/no-such-page"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("lang", "ka");
    await expect(page.locator("main").first()).toBeVisible();
    expect(await page.locator("body").innerText(), route).not.toMatch(/[А-Яа-яЁё]/);
  }
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("changing language and validation errors preserve all help fields without storage", async ({ page }) => {
  await page.goto("/help");
  await page.locator('[name="country"]').fill("საქართველო");
  await page.locator('[name="city"]').fill("თბილისი");
  await page.locator('[name="description"]').fill("short");
  await page.locator('[name="external_contact"]').fill("fictional private contact");
  await page.locator('[name="contact_window"]').fill("вечером");
  await page.locator('[name="category"]').selectOption("FAMILY");
  await page.locator('[name="urgency"]').selectOption("SOON");
  await page.locator('[name="can_call"]').check();
  await page.getByRole("button", { name: "ქართული", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");
  await expect(page.locator('[name="city"]')).toHaveValue("თბილისი");
  await expect(page.locator('[name="category"]')).toHaveValue("FAMILY");
  await expect(page.locator('[name="urgency"]')).toHaveValue("SOON");
  await expect(page.locator('[name="can_call"]')).toBeChecked();
  await expect(page.locator('a[href="/consent/request?country=ge"]')).toBeVisible();
  await page.getByRole("button", { name: "თხოვნის გამოქვეყნება", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("შეამოწმეთ მონიშნული ველები");
  await expect(page.locator('[name="description"]')).toHaveValue("short");
  await expect(page.locator('[name="external_contact"]')).toHaveValue("fictional private contact");
  await expect(page.locator('[name="contact_window"]')).toHaveValue("вечером");
  await expect(page.locator('[name="description"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('#error-consent')).toContainText("დაადასტურეთ");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Проверьте отмеченные поля");
  await expect(page.locator('[name="external_contact"]')).toHaveValue("fictional private contact");
  const stored = await page.evaluate(() => `${document.cookie} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  expect(stored).not.toContain("fictional private contact");
  expect(stored).not.toContain("вечером");
  expect(page.url()).not.toContain("fictional");
});

test("Georgian mobile pages and keyboard language controls remain usable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const switcher = page.getByRole("button", { name: "ქართული", exact: true });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/help", "/volunteer", "/auth", "/nearby", "/requests", "/consent/request?country=ge"]) {
      await page.goto(route);
      expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth), `${width} ${route}`).toBe(true);
      await expect(page.getByRole("button", { name: "ქართული", exact: true })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator(".mobile-menu summary").click();
  await expect(page.locator(".mobile-menu-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".mobile-menu-panel")).not.toBeVisible();
});
