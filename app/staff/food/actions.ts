"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import {
  buildDonationOutcomeAttestation,
  buildDonationReservationUpsert,
  createHappyFoodRescueClient,
  happyFoodRescueConfig,
} from "@/lib/happy-food-rescue";

const region = "GE-AJ";
const id = (prefix: string) => prefix + randomBytes(16).toString("hex");
const valid = (x: unknown) =>
  typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(x);
const quantity = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= 200 ? n : null;
};

async function requireCoordinator() {
  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");
  const { data: role, error } = await s.rpc("current_staff_role");
  if (error || (role !== "ADMIN" && role !== "COORDINATOR")) {
    redirect("/cabinet");
  }
}

export async function reserveFoodDonation(form: FormData) {
  await requireCoordinator();
  const offerId = String(form.get("offerId") ?? "").trim();
  const qty = quantity(form.get("quantity"));
  if (!valid(offerId) || !offerId.startsWith("offer_lot_") || qty === null || qty < 1) {
    redirect("/staff/food?error=invalid");
  }
  const time = new Date();
  const now = time.toISOString();
  const reservationId = id("reservation_mercy_staff_");
  const correlationId = id("correlation_mercy_staff_");
  try {
    const client = createHappyFoodRescueClient({ config: happyFoodRescueConfig() });
    const event = buildDonationReservationUpsert({
      eventId: id("event_mercy_staff_"),
      occurredAt: now,
      region,
      correlationId,
      idempotencyKey: id("idempotency_mercy_staff_"),
      reservationRevision: 1,
      reservationId,
      offerId,
      quantity: qty,
      unit: "meal",
      expiresAt: new Date(time.getTime() + 20 * 60_000).toISOString(),
      mercyMissionRef: id("mission_mercy_staff_"),
    });
    const response = await client.send(event);
    if (response.accepted !== true || response.effect !== "DONATION_RESERVED") {
      throw new Error("Reservation not confirmed by Food");
    }
  } catch {
    redirect("/staff/food?error=reserve");
  }
  redirect("/staff/food?reservation=" + encodeURIComponent(reservationId));
}

export async function attestFoodDonation(_form: FormData) {
  await requireCoordinator();
  // Legacy path cannot attest without the private document workflow.
  redirect("/staff/food/evidence");
}
