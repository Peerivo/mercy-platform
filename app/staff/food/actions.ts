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

export async function attestFoodDonation(form: FormData) {
  await requireCoordinator();
  const offerId = String(form.get("offerId") ?? "").trim();
  const reservationId = String(form.get("reservationId") ?? "").trim();
  const pickedUp = quantity(form.get("pickedUp"));
  const delivered = quantity(form.get("delivered"));
  if (!valid(offerId) || !offerId.startsWith("offer_lot_") || !valid(reservationId) ||
      pickedUp === null || delivered === null || delivered > pickedUp) {
    redirect("/staff/food?error=invalid");
  }
  const now = new Date().toISOString();
  const outcome = pickedUp === 0 ? "FAILED"
    : delivered === 0 ? "PICKED_UP_NOT_DELIVERED"
    : delivered < pickedUp ? "PARTIALLY_DELIVERED" : "DELIVERED";
  try {
    const client = createHappyFoodRescueClient({ config: happyFoodRescueConfig() });
    const event = buildDonationOutcomeAttestation({
      eventId: id("event_mercy_staff_"),
      occurredAt: now,
      region,
      correlationId: id("correlation_mercy_staff_"),
      idempotencyKey: id("idempotency_mercy_staff_"),
      revision: 1,
      attestationId: id("attestation_mercy_staff_"),
      offerId,
      reservationId,
      quantityPickedUp: pickedUp,
      quantityDelivered: delivered,
      unit: "meal",
      outcome,
      evidenceRef: "evidence_fulfillment_" + randomBytes(16).toString("hex"),
      attestedAt: now,
    });
    const response = await client.send(event);
    if (response.accepted !== true || response.effect !== "DONATION_OUTCOME_ATTESTED") {
      throw new Error("Outcome not confirmed by Food");
    }
  } catch {
    redirect("/staff/food?error=attest");
  }
  redirect("/staff/food?success=attested");
}
