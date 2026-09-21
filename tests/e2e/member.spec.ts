import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { quickExitGuard } from "../../lib/quick-exit-guard";

type LifecycleObservation = { documentId: string; persisted: boolean; phase: "pagehide" | "pageshow"; route: string };
type BfCacheFailure = { reason?: string; type?: string };
type BfCacheEvent = { frameId: string; loaderId: string; reasons: BfCacheFailure[] };
const bfcacheDiagnosticsPath = path.join(process.cwd(), "test-results", "bfcache-diagnostics.json");

async function getLatestMagicLink(email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  let link = "";
  await expect.poll(async () => {
    const response = await fetch(`http://127.0.0.1:54324/view/latest.html?query=${query}`);
    if (!response.ok) return "";
    const html = (await response.text()).replace(/&amp;/g, "&");
    const match = html.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s<>"']+/);
    link = match?.[0] ?? "";
    return link;
  }, { timeout: 15_000 }).not.toBe("");
  return link;
}

async function register(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить ссылку для входа" }).click();
  await expect(page).toHaveURL(/\/auth\?sent=1/);
  await expect(page.getByText("Письмо отправлено")).toBeVisible();
  const magicLink = await getLatestMagicLink(email);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/cabinet$/);
  await expect(page.locator("main .page-shell")).toBeVisible();
}

async function createRequest(page: Page) {
  await page.goto("/help");
  await page.getByLabel("Страна").fill("XX");
  await page.getByLabel("Город").fill("Test");
  await page.getByLabel("Описание").fill("A fictional browser request long enough for validation");
  await page.getByLabel(/Я согласен/).check();
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(page).toHaveURL(/\/cabinet\/requests\/[0-9a-f-]+$/);
  return page.url();
}

async function installLifecycleDiagnostics(context: BrowserContext, observations: LifecycleObservation[]) {
  await context.exposeBinding("__mercyRecordLifecycle", (_source, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const candidate = value as Partial<LifecycleObservation>;
    if (typeof candidate.documentId === "string" && typeof candidate.persisted === "boolean" &&
        (candidate.phase === "pageshow" || candidate.phase === "pagehide") && typeof candidate.route === "string") {
      observations.push(candidate as LifecycleObservation);
    }
  });
  await context.addInitScript(() => {
    const documentId = crypto.randomUUID();
    const route = location.pathname.replace(/^(\/cabinet\/requests)\/[^/]+$/, "$1/:id");
    const record = (phase: "pageshow" | "pagehide", event: PageTransitionEvent) => {
      const binding = (globalThis as typeof globalThis & {
        __mercyRecordLifecycle: (value: LifecycleObservation) => Promise<void>;
      }).__mercyRecordLifecycle;
      void binding({ documentId, persisted: event.persisted, phase, route });
    };
    addEventListener("pageshow", event => record("pageshow", event));
    addEventListener("pagehide", event => record("pagehide", event));
  });
}

function flattenBfCacheFailures(tree: unknown): BfCacheFailure[] {
  if (!tree || typeof tree !== "object") return [];
  const node = tree as { explanations?: BfCacheFailure[]; children?: unknown[] };
  return [...(node.explanations ?? []), ...(node.children ?? []).flatMap(flattenBfCacheFailures)];
}

async function attachBfCacheDiagnostics(testInfo: TestInfo, lifecycle: LifecycleObservation[], failures: BfCacheEvent[], args: string[]) {
  const diagnostic = JSON.stringify({
    chromiumArguments: args.filter(arg => /back-forward-cache|BackForwardCache/i.test(arg)),
    lifecycle,
    targetNavigationFailures: failures,
  }, null, 2);
  await mkdir(path.dirname(bfcacheDiagnosticsPath), { recursive: true });
  await writeFile(bfcacheDiagnosticsPath, diagnostic, { encoding: "utf8", mode: 0o600 });
  await testInfo.attach("bfcache-diagnostics", {
    body: diagnostic,
    contentType: "application/json",
  });
}

test("two browser contexts stay isolated; create, message, refresh and Quick Exit Back are safe", async ({ browser }) => {
  test.setTimeout(90_000);

  const one = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const two = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const lifecycle: LifecycleObservation[] = [];
  try {
    await installLifecycleDiagnostics(one, lifecycle);
    const p1 = await one.newPage(), p2 = await two.newPage();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const firstEmail = `browser-u1-${suffix}@mercy.invalid`;
    await register(p1, firstEmail);
    await register(p2, `browser-u2-${suffix}@mercy.invalid`);
    const privateUrl = await createRequest(p1);
    await p1.getByLabel(/^Сообщение$/).fill("browser message");
    await p1.getByRole("button", { name: "Отправить" }).click();
    await expect(p1.getByText("browser message")).toBeVisible();
    await p1.reload();
    await expect(p1.getByText("browser message")).toBeVisible();
    await expect.poll(() => lifecycle.filter(item => item.phase === "pageshow" && item.route === "/cabinet/requests/:id").length)
      .toBeGreaterThan(0);
    const privateDocument = lifecycle.findLast(item => item.phase === "pageshow" && item.route === "/cabinet/requests/:id");
    await p2.goto(privateUrl);
    await expect(
      p2.getByText("A fictional browser request")
    ).toHaveCount(0);
    await p1.getByLabel(/^Сообщение$/).fill("private draft must disappear");
    await p1.getByRole("button", { name: "Быстро скрыть приватную страницу" }).click();
    await expect(p1).toHaveURL(/\/auth$/);

    await p1.goBack();

    // Главное: Back не должен вернуть приватную карточку.
    await expect(p1).not.toHaveURL(/\/cabinet\/requests\/[0-9a-f-]+$/);

    await expect(p1.getByText("browser message")).toHaveCount(0);
    await expect(p1.getByText("private draft must disappear")).toHaveCount(0);
    await expect(p1.getByLabel(/^Сообщение$/)).toHaveCount(0);
    const privateReturn = lifecycle.filter(item => item.phase === "pageshow" && item.route === "/cabinet/requests/:id").at(-1);
    const returnPath = privateReturn === privateDocument
      ? "private-entry-not-revisited"
      : privateReturn && privateReturn.documentId === privateDocument?.documentId && privateReturn.persisted
        ? "bfcache-restoration"
        : "new-document-load";
    console.log(`[quick-exit] Back safety path=${returnPath}; private content absent and marker enforced`);
    await p1.goto("/cabinet");
    await expect(p1).toHaveURL(/\/auth/);
    await p1.goto(privateUrl);

    await expect(
      p1.getByText("A fictional browser request")
    ).toBeVisible();

    await expect(
      p1.getByLabel(/^Сообщение$/)
    ).toHaveCount(0);
    await p1.goto("/help");
    await p1.getByLabel("Страна").fill("XX");
    await p1.getByLabel("Город").fill("No session");
    await p1.getByLabel("Описание").fill("This anonymous submission must never be stored");
    await p1.getByLabel(/Я согласен/).check();
    await p1.getByRole("button", { name: "Опубликовать просьбу" }).click();
    await expect(p1).toHaveURL(/\/auth/);
    await p1.getByLabel("Email").fill(firstEmail);
    await p1.getByRole("button", { name: "Получить ссылку для входа" }).click();
    await expect(p1).toHaveURL(/\/auth\?sent=1/);
    const reloginLink = await getLatestMagicLink(firstEmail);
    await p1.goto(reloginLink);
    await expect(p1).toHaveURL(/\/cabinet$/);
    await expect(p1.getByRole("link", { name: /№ .*PREGNANCY/ })).toHaveCount(1);
    await expect(p1.getByText("This anonymous submission must never be stored")).toHaveCount(0);
  } finally {
    await Promise.all([one.close(), two.close()]);
  }
});

test("the production guard protects a genuinely BFCache-eligible document", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const lifecycle: LifecycleObservation[] = [];
  const failures: BfCacheEvent[] = [];
  let collectTargetFailures = false;
  let chromiumArguments: string[] = [];
  try {
    const browserSession = await browser.newBrowserCDPSession();
    const commandLine = await browserSession.send("Browser.getBrowserCommandLine");
    chromiumArguments = commandLine.arguments;
    expect(chromiumArguments, "Chromium must be launched without Playwright's BFCache-disabling argument")
      .not.toContain("--disable-back-forward-cache");
    await installLifecycleDiagnostics(context, lifecycle);
    const page = await context.newPage();
    const pageSession = await context.newCDPSession(page);
    await pageSession.send("Page.enable");
    pageSession.on("Page.backForwardCacheNotUsed", event => {
      if (!collectTargetFailures) return;
      const reasons = flattenBfCacheFailures(event.notRestoredExplanationsTree);
      if (reasons.length === 0) reasons.push(...event.notRestoredExplanations);
      failures.push({ frameId: event.frameId, loaderId: event.loaderId, reasons });
    });

    await context.route("**/__bfcache-fixture/**", async route => {
      const protectedFixture = new URL(route.request().url()).pathname.endsWith("/protected");
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "public, max-age=600" },
        body: protectedFixture
          ? `<!doctype html><html><head><script>${quickExitGuard}</script></head><body><main>synthetic sensitive fixture</main></body></html>`
          : "<!doctype html><html><body><main>neutral fixture</main></body></html>",
      });
    });
    await page.goto("/__bfcache-fixture/protected");
    await expect(page.getByText("synthetic sensitive fixture")).toBeVisible();
    await expect.poll(() => lifecycle.filter(item => item.phase === "pageshow" && item.route === "/__bfcache-fixture/protected").length)
      .toBeGreaterThan(0);
    const protectedDocument = lifecycle.findLast(item => item.phase === "pageshow" && item.route === "/__bfcache-fixture/protected");
    expect(protectedDocument, "the fixture must be a separately loaded document").toBeDefined();

    await page.goto("/__bfcache-fixture/neutral");
    await page.evaluate(() => sessionStorage.setItem("mercy_quick_exit", "1"));
    collectTargetFailures = true;
    await page.goBack();
    await expect(page).toHaveURL(/\/auth$/);
    await expect.poll(() => lifecycle.some(item => item.documentId === protectedDocument?.documentId &&
      item.phase === "pageshow" && item.persisted)).toBe(true);
    await expect(page.getByText("synthetic sensitive fixture")).toHaveCount(0);
    expect(failures, `Chromium rejected the target BFCache restoration: ${JSON.stringify(failures)}`).toEqual([]);
  } finally {
    const reasons = [...new Set(failures.flatMap(event => event.reasons.map(reason => reason.reason ?? reason.type ?? "unknown")))];
    console.log(`[bfcache] target-restoration=${failures.length === 0 ? "no rejection reported" : "rejected"}; reasons=${reasons.join(",") || "none"}`);
    await attachBfCacheDiagnostics(testInfo, lifecycle, failures, chromiumArguments);
    await context.close();
  }
});

test("callback rejects missing code and external next URL", async ({ page }) => {
  await page.goto("/auth/callback?next=https://example.com");
  await expect(page).toHaveURL(/\/auth\?error=callback$/);
});

test("main pages share the responsive shell and Peerivo icon", async ({ page }) => {
  const widths = [
    { width: 390, padding: "16px" },
    { width: 768, padding: "24px" },
    { width: 1200, padding: "40px" },
    { width: 1600, padding: "56px" },
  ];

  for (const viewport of widths) {
    await page.setViewportSize({ width: viewport.width, height: 900 });
    await page.goto("/");
    await expect(page.locator("header .page-shell")).toHaveCSS("padding-left", viewport.padding);
    await expect(page.locator("main .page-shell").first()).toHaveCSS("padding-right", viewport.padding);
    await expect(page.locator("header img")).toHaveAttribute("src", /icon\.svg/);
    await expect.poll(() => page.locator('link[rel="icon"]').first().getAttribute("href"))
      .toMatch(/icon\.svg/);
    expect(await page.locator("main .page-shell").first().evaluate(element => element.getBoundingClientRect().width))
      .toBeLessThanOrEqual(1280);
  }

  await page.setViewportSize({ width: 390, height: 900 });
  for (const route of ["/", "/nearby", "/auth", "/help", "/volunteer", "/safe"]) {
    await page.goto(route);
    await expect(page.locator("main .page-shell").first()).toBeVisible();
    expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
