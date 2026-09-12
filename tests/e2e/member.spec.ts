import { expect, test, type Page } from "@playwright/test";

const password = "Browser-password-42!";
async function register(page: Page, email: string) {
  await page.goto("/auth");
  const form = page.locator("form").filter({ hasText: "Создать аккаунт" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Пароль от 10 символов").fill(password);
  await form.getByRole("button", { name: "Зарегистрироваться" }).click();
  await page.goto("/auth");
  const login = page.locator("form").filter({ hasText: "Войти" });
  await login.getByLabel("Email").fill(email);
  await login.getByLabel("Пароль").fill(password);
  await login.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
}

test("two browser contexts stay isolated; create, message, refresh and Quick Exit are safe", async ({ browser }) => {
  const one = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const two = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const p1 = await one.newPage(), p2 = await two.newPage();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await register(p1, `browser-u1-${suffix}@mercy.invalid`);
  await register(p2, `browser-u2-${suffix}@mercy.invalid`);
  await p1.goto("/help");
  await p1.getByLabel("Страна").fill("XX"); await p1.getByLabel("Город").fill("Test");
  await p1.getByLabel("Описание").fill("A fictional browser request long enough for validation");
  await p1.getByLabel(/Я согласен/).check(); await p1.getByRole("button", { name: "Отправить приватно" }).click();
  await expect(p1).toHaveURL(/\/cabinet\/requests\/[0-9a-f-]+$/);
  const privateUrl = p1.url();
  await p1.getByLabel("Сообщение").fill("browser message"); await p1.getByRole("button", { name: "Отправить" }).click();
  await expect(p1.getByText("browser message")).toBeVisible();
  await p1.reload(); await expect(p1.getByText("browser message")).toBeVisible();
  await p2.goto(privateUrl); await expect(p2.getByText("A fictional browser request")).toHaveCount(0);
  await p1.getByRole("button", { name: "Быстро скрыть приватную страницу" }).click(); await expect(p1).toHaveURL(/\/safe$/);
  await p1.goBack(); await expect(p1).toHaveURL(/\/safe$/); await expect(p1.getByText("browser message")).toHaveCount(0);
  await one.close(); await two.close();
});

test("callback rejects missing code and external next URL", async ({ page }) => {
  await page.goto("/auth/callback?next=https://example.com");
  await expect(page).toHaveURL(/\/auth\?error=callback$/);
});
