import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

function requireDisposableStack(): void {
  const url = new URL(baseUrl);
  if (
    process.env.MERCY_DISPOSABLE_SUPABASE !== "true" ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "54321" ||
    !serviceKey ||
    !anonKey ||
    serviceKey === anonKey
  ) {
    throw new Error("The evidence browser acceptance test requires disposable local Supabase only");
  }
}

async function latestMagicLink(email: string) {
  const query = encodeURIComponent('to:"' + email + '"');
  let link = "";
  await expect.poll(async () => {
    const response = await fetch(
      "http://127.0.0.1:54324/view/latest.html?query=" + query
    );
    if (!response.ok) return "";
    const body = (await response.text()).replace(/&amp;/g, "&");
    link = body.match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s<>"']+/)?.[0] ?? "";
    return link;
  }, { timeout: 25_000 }).not.toBe("");
  return link;
}

async function login(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить ссылку для входа" }).click();
  await expect(page).toHaveURL(/\/auth\?sent=1/);
  await page.goto(await latestMagicLink(email));
  await expect(page).toHaveURL(/\/cabinet$/);
}

test("5 MiB Food evidence needs an independent second coordinator and stays private", async ({browser}) => {
  test.setTimeout(160_000);
  requireDisposableStack();

  const svc: SupabaseClient = createClient(baseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID().replaceAll("-","").slice(0,12);
  const emails = [
    "food-review-a-"+suffix+"@mercy.invalid",
    "food-review-b-"+suffix+"@mercy.invalid",
    "food-review-admin-"+suffix+"@mercy.invalid",
  ];
  const users: string[] = [];
  for (const email of emails) {
    const {data, error} = await svc.auth.admin.createUser({
      email, password: "Local-only-evidence-test-42!", email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("Disposable staff setup failed");
    users.push(data.user.id);
  }
  const roles = await svc.from("staff_roles").insert([
    { user_id: users[2], role: "ADMIN", granted_by: users[2] },
    { user_id: users[0], role: "COORDINATOR", granted_by: users[2] },
    { user_id: users[1], role: "COORDINATOR", granted_by: users[2] },
  ]);
  if (roles.error) throw roles.error;

  const first = await browser.newContext({viewport:{width:360,height:800}});
  const second = await browser.newContext({viewport:{width:360,height:800}});
  const anonymous = await browser.newContext({viewport:{width:360,height:800}});

  const reservationId = "reservation_e2e_"+suffix;
  const offerId = "offer_lot_e2e_"+suffix;
  try {
    const p1 = await first.newPage();
    const p2 = await second.newPage();
    const p0 = await anonymous.newPage();

    await p0.goto("/staff/food/evidence");
    await expect(p0).toHaveURL(/\/auth$/);
    await expect(p0.getByText(reservationId)).toHaveCount(0);

    await login(p1, emails[0]);
    await login(p2, emails[1]);
    await p1.goto("/staff/food/evidence");
    await expect(p1.getByRole("heading",{name:"Подтверждение передачи продуктов"})).toBeVisible();

    await p1.getByLabel("ID предложения").fill(offerId);
    await p1.getByLabel("ID резерва").fill(reservationId);
    await p1.getByLabel("Забрано").fill("3");
    await p1.getByLabel("Передано").fill("2");
    const document = Buffer.alloc(5 * 1024 * 1024 - 128, 0x20);
    document.write("%PDF-1.7\n");
    await p1.getByLabel("Фото или PDF подтверждения, до 5 МБ").setInputFiles({
      name: "fictional-evidence.pdf",
      mimeType: "application/pdf",
      buffer: document,
    });
    await p1.getByRole("button",{name:"Отправить на проверку"}).click();
    await expect(p1).toHaveURL(/\/staff\/food\/evidence\?success=submitted/);
    await expect(p1.getByText("Документ сохранён и ожидает независимой проверки.")).toBeVisible();

    let evidence = await svc.from("food_donation_evidence")
      .select("*").eq("reservation_id",reservationId).single();
    expect(evidence.error).toBeNull();
    expect(evidence.data?.status).toBe("PENDING");
    expect(evidence.data?.submitted_by).toBe(users[0]);
    expect(evidence.data?.quantity_picked_up).toBe(3);
    expect(evidence.data?.quantity_delivered).toBe(2);
    const card1 = p1.locator("article.card").filter({hasText:reservationId});
    await expect(card1.getByRole("button",{name:"Одобрить после проверки"})).toHaveCount(0);
    await expect(card1.getByRole("link",{name:"Просмотреть закрытый документ"})).toBeVisible();

    await p2.goto("/staff/food/evidence");
    const card2=p2.locator("article.card").filter({hasText:reservationId});
    await expect(card2.getByRole("button",{name:"Одобрить после проверки"})).toBeVisible();
    await card2.getByLabel("Документ проверен лично; данные соответствуют фактической выдаче.").check();
    await card2.getByRole("button",{name:"Одобрить после проверки"}).click();
    await expect(p2).toHaveURL(/\/staff\/food\/evidence\?success=approved/);

    evidence = await svc.from("food_donation_evidence")
      .select("*").eq("reservation_id",reservationId).single();
    expect(evidence.data?.status).toBe("APPROVED");
    expect(evidence.data?.approved_by).toBe(users[1]);
    expect(evidence.data?.dispatched_at).toBeNull();

    const ordinary = createClient(baseUrl,anonKey,{auth:{persistSession:false}});
    const forbidden = await ordinary.from("food_donation_evidence")
      .select("reservation_id").eq("reservation_id",reservationId);
    expect(forbidden.error).not.toBeNull();
    await expect(p0.getByText(reservationId)).toHaveCount(0);
  } finally {
    await Promise.all([first.close(),second.close(),anonymous.close()]);
  }
});
