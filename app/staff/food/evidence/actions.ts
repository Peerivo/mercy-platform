"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import {
  FOOD_EVIDENCE_BUCKET, evidenceFileKind, evidenceIdentifier, evidenceQuantity,
  evidenceSha256, foodEvidenceOutcome, foodEvidenceService,
  newFoodEvidenceIdentifiers, type FoodEvidenceRow
} from "@/lib/food-donation-evidence";
import {
  buildDonationOutcomeAttestation, createHappyFoodRescueClient, happyFoodRescueConfig
} from "@/lib/happy-food-rescue";

async function staffUser(): Promise<string> {
  const session = await serverSupabase();
  const { data: {user}, error } = await session.auth.getUser();
  if (error || !user) redirect("/auth");
  const role = await session.rpc("current_staff_role");
  if (role.error || !["ADMIN","COORDINATOR"].includes(role.data ?? "")) redirect("/cabinet");
  return user.id;
}

const uuidValid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function submitFoodDonationEvidence(form: FormData) {
  const userId = await staffUser();
  let offerId: string, reservationId: string, picked: number, delivered: number;
  let data: Uint8Array, mime: "application/pdf" | "image/png" | "image/jpeg";
  let ext: "pdf" | "png" | "jpg";
  try {
    offerId = evidenceIdentifier(form.get("offerId"),"offer");
    reservationId = evidenceIdentifier(form.get("reservationId"),"reservation");
    picked = evidenceQuantity(form.get("pickedUp"));
    delivered = evidenceQuantity(form.get("delivered"));
    if (delivered > picked) throw new TypeError("Delivered exceeds picked up");
    const file = form.get("document");
    if (!(file instanceof File) || file.size < 100 || file.size > 5 * 1024 * 1024) {
      throw new TypeError("Evidence must be a document between 100 bytes and 5 MB");
    }
    data = new Uint8Array(await file.arrayBuffer());
    ({mime,ext} = evidenceFileKind(data,file.type));
  } catch {
    redirect("/staff/food/evidence?error=invalid");
  }
  const client = foodEvidenceService();
  const refs = newFoodEvidenceIdentifiers(ext);
  const uploaded = await client.storage.from(FOOD_EVIDENCE_BUCKET).upload(
    refs.document_path, data, { upsert:false,contentType:mime, cacheControl:"0" }
  );
  if (uploaded.error) redirect("/staff/food/evidence?error=upload");
  const {error} = await client.from("food_donation_evidence").insert({
    ...refs,
    offer_id:offerId, reservation_id:reservationId,
    document_sha256:evidenceSha256(data),document_mime:mime,
    quantity_picked_up:picked,quantity_delivered:delivered,submitted_by:userId,
  });
  if (error) {
    // Compensate orphaned object, never expose the database error publicly.
    await client.storage.from(FOOD_EVIDENCE_BUCKET).remove([refs.document_path]);
    redirect("/staff/food/evidence?error=duplicate");
  }
  redirect("/staff/food/evidence?success=submitted");
}

export async function reviewFoodDonationEvidence(form: FormData) {
  const reviewer = await staffUser();
  const id = form.get("id");
  if (!uuidValid(id) || form.get("reviewed") !== "yes") {
    redirect("/staff/food/evidence?error=review");
  }
  const client = foodEvidenceService();
  const {data:raw,error:readError} = await client.from("food_donation_evidence")
    .select("*").eq("id",id).single();
  const row=raw as FoodEvidenceRow | null;
  if (readError || !row || row.status !== "PENDING" || row.submitted_by === reviewer) {
    redirect("/staff/food/evidence?error=review");
  }
  // Validate storage object integrity at approval, not merely its reference.
  const downloaded = await client.storage.from(FOOD_EVIDENCE_BUCKET).download(row.document_path);
  if (downloaded.error || !downloaded.data) redirect("/staff/food/evidence?error=document");
  const rawBytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (evidenceSha256(rawBytes) !== row.document_sha256 ||
      evidenceFileKind(rawBytes,row.document_mime).mime !== row.document_mime) {
    redirect("/staff/food/evidence?error=document");
  }
  const {data:updated,error} = await client.from("food_donation_evidence")
    .update({status:"APPROVED", approved_by:reviewer,approved_at:new Date().toISOString()})
    .eq("id",id).eq("status","PENDING").neq("submitted_by",reviewer)
    .select("id");
  if (error || !updated || updated.length !== 1) redirect("/staff/food/evidence?error=conflict");
  redirect("/staff/food/evidence?success=approved");
}

export async function dispatchFoodDonationEvidence(form: FormData) {
  await staffUser();
  const id = form.get("id");
  if (!uuidValid(id)) redirect("/staff/food/evidence?error=invalid");
  const client = foodEvidenceService();
  const {data:raw,error} = await client.from("food_donation_evidence")
    .select("*").eq("id",id).single();
  const row=raw as FoodEvidenceRow | null;
  if (error || !row || !row.approved_by || !row.approved_at || row.submitted_by === row.approved_by) {
    redirect("/staff/food/evidence?error=review");
  }
  if(row.status === "SENT") redirect("/staff/food/evidence?success=sent");
  if(row.status !== "APPROVED" && row.status !== "SENDING") redirect("/staff/food/evidence?error=conflict");
  // Stale SENDING can retry the exact same event after a network timeout. A
  // fresh SENDING lease prevents concurrent double-dispatch.
  if(row.status === "SENDING" &&
     (!row.processing_started_at || Date.now() - Date.parse(row.processing_started_at) < 120_000)) {
    redirect("/staff/food/evidence?error=busy");
  }
  const updatedAt = new Date().toISOString();
  let claim=client.from("food_donation_evidence").update({
    status:"SENDING",processing_started_at:updatedAt
  }).eq("id",id).eq("status",row.status);
  if (row.status === "SENDING" && row.processing_started_at) {
    claim=claim.eq("processing_started_at",row.processing_started_at);
  }
  const claimed=await claim.select("id");
  if (claimed.error || claimed.data?.length !== 1) redirect("/staff/food/evidence?error=busy");
  try {
    const downloaded=await client.storage.from(FOOD_EVIDENCE_BUCKET).download(row.document_path);
    if(downloaded.error || !downloaded.data) throw new Error("Evidence missing");
    const data=new Uint8Array(await downloaded.data.arrayBuffer());
    if(evidenceSha256(data)!==row.document_sha256) throw new Error("Evidence changed");
    const event=buildDonationOutcomeAttestation({
      eventId:row.event_id,
      occurredAt:row.approved_at,
      region:"GE-AJ",
      correlationId:"corr_evidence_"+id.replaceAll("-",""),
      idempotencyKey:"idem_evidence_"+id.replaceAll("-",""),
      revision:1,
      attestationId:"attestation_evidence_"+id.replaceAll("-",""),
      offerId:row.offer_id,
      reservationId:row.reservation_id,
      quantityPickedUp:row.quantity_picked_up,
      quantityDelivered:row.quantity_delivered,
      unit:"meal",
      outcome:foodEvidenceOutcome(row),
      evidenceRef:row.evidence_ref,
      attestedAt:row.approved_at,
    });
    const sender=createHappyFoodRescueClient({config:happyFoodRescueConfig()});
    const result=await sender.send(event);
    if (result.accepted !== true || result.effect !== "DONATION_OUTCOME_ATTESTED") {
      throw new Error("Food did not accept the attestation");
    }
    await client.from("food_donation_evidence")
      .update({status:"SENT",dispatched_at:new Date().toISOString(),processing_started_at:null})
      .eq("id",id).eq("status","SENDING").eq("processing_started_at",updatedAt);
  } catch {
    await client.from("food_donation_evidence")
      .update({status:"APPROVED",processing_started_at:null})
      .eq("id",id).eq("status","SENDING").eq("processing_started_at",updatedAt);
    redirect("/staff/food/evidence?error=dispatch");
  }
  redirect("/staff/food/evidence?success=sent");
}
