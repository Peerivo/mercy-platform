import { expect, test } from "@playwright/test";

test("SEO discovery stays canonical without exposing private utility routes", async ({ page, request }) => {
  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);
  const robots = await robotsResponse.text();
  expect(robots).toContain("Allow: /");
  expect(robots).not.toContain("Disallow: /auth");
  expect(robots).not.toContain("Disallow: /help");
  expect(robots).toContain("Sitemap: http://localhost:3000/sitemap.xml");

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  const sitemap = await sitemapResponse.text();
  for (const url of [
    "http://localhost:3000/",
    "http://localhost:3000/requests",
    "http://localhost:3000/nearby",
    "http://localhost:3000/volunteer",
  ]) {
    expect(sitemap).toContain(`<loc>${url}</loc>`);
  }
  expect(sitemap).not.toContain("//requests");

  for (const route of ["/auth", "/auth/update-password", "/feedback", "/help", "/consent/request"]) {
    await page.goto(route);
    const robotsMeta = page.locator('meta[name="robots"]');
    await expect(robotsMeta).toHaveAttribute("content", /noindex/i);
  }

  await page.goto("/safe");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);

  await page.goto("/requests?page=2");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:3000/requests?page=2",
  );

  await page.goto("/requests?page=1&city=Test");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:3000/requests",
  );
});
