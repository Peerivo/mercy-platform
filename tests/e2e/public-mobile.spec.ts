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
      const select = card.locator("select").first();
      await expect(select).toHaveCSS("appearance", "none");
      await expect(select).toHaveCSS("padding-right", "40px");
      const mobileChevron = await select.evaluate(element => {
        const styles = getComputedStyle(element);
        return {
          backgroundImage: styles.backgroundImage,
          backgroundPosition: styles.backgroundPosition,
          backgroundRepeat: styles.backgroundRepeat,
          backgroundSize: styles.backgroundSize,
        };
      });
      expect(mobileChevron.backgroundImage).toContain("svg");
      expect(mobileChevron.backgroundPosition).toMatch(/14px|calc\(100% - 14px\)/);
      expect(mobileChevron.backgroundPosition).toMatch(/50%|center/);
      expect(mobileChevron.backgroundRepeat).toBe("no-repeat");
      expect(mobileChevron.backgroundSize).toBe("18px 18px");
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

test("single-value selects keep one chevron position on desktop and forced-colors restores the native indicator", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const route of ["/help", "/requests"]) {
    await page.goto(route);
    const select = page.locator("select").first();
    await expect(select).toBeVisible();
    await expect(select).toHaveCSS("appearance", "none");
    await expect(select).toHaveCSS("padding-right", "42px");

    const chevron = await select.evaluate(element => {
      const styles = getComputedStyle(element);
      return {
        backgroundImage: styles.backgroundImage,
        backgroundPosition: styles.backgroundPosition,
        backgroundRepeat: styles.backgroundRepeat,
        backgroundSize: styles.backgroundSize,
      };
    });
    expect(chevron.backgroundImage).toContain("svg");
    expect(chevron.backgroundPosition).toMatch(/14px|calc\(100% - 14px\)/);
    expect(chevron.backgroundPosition).toMatch(/50%|center/);
    expect(chevron.backgroundRepeat).toBe("no-repeat");
    expect(chevron.backgroundSize).toBe("18px 18px");

    await page.emulateMedia({ forcedColors: "active" });
    await expect(select).toHaveCSS("background-image", "none");
    await page.emulateMedia({ forcedColors: "none" });
  }
});

test("project support starts as an email inquiry and does not collect payment", async ({ page }) => {
  await page.goto("/feedback?topic=support&from=%2Fcabinet");

  await expect(page.getByRole("heading", { name: "Поддержать Mercy" })).toBeVisible();
  await expect(page.getByText(/На этой странице платежи не принимаются/)).toBeVisible();
  await expect(page.locator('input[name="replyEmail"]')).toHaveAttribute("required", "");
  await expect(page.getByRole("button", { name: "Отправить запрос о поддержке" })).toBeVisible();
});
