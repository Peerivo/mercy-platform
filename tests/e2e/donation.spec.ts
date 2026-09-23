import { expect, test } from "@playwright/test";

test("project donation page uses the verified CloudTips recipient", async ({ page }) => {
  await page.goto("/donate");

  await expect(
    page.getByRole("heading", { name: "Поддержать «Язык милосердия»" }),
  ).toBeVisible();

  const donate = page.getByRole("link", { name: "Перейти к пожертвованию" });

  await expect(donate).toHaveAttribute(
    "href",
    "https://pay.cloudtips.ru/p/4a70a8e5",
  );
  await expect(donate).toHaveAttribute("target", "_blank");
  await expect(
    page.getByText(/Mercy не получает\s+и не хранит данные вашей банковской карты/),
  ).toBeVisible();
});
