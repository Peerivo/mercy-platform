import { expect, test } from "@playwright/test";

test("public forms and nearby stay compact and readable on mobile", async ({ page }) => {
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });

    for (const route of ["/help", "/volunteer"]) {
      await page.goto(route);

      const card = page.locator(".public-form-card");
      await expect(card).toBeVisible();
      expect(await page.locator(".form-section").count()).toBeGreaterThanOrEqual(3);
      await expect(card.locator("input, select").first()).toHaveCSS("font-size", "16px");
      expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await card.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    }

    await page.goto("/nearby");
    await expect(page.locator(".nearby-search-card")).toBeVisible();
    await expect(page.locator(".nearby-results-block")).toBeVisible();
    await expect(page.locator(".nearby-search-card input")).toHaveCSS("font-size", "16px");
    expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    expect(
      await page.locator(".nearby-results-block").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)
    ).toBe(true);
  }
});
